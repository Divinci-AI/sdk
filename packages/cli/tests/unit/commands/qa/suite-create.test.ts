// RAG race take 11 (2026-10-04): no CLI command created a suite; the agent
// got "400 bad form data" from POST /scored-qa/suites 15+ times.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({ apiUrl: "https://api.example/", accessToken: "tok", workspaceId: "ws-1" }),
  requireWorkspaceId: vi.fn().mockReturnValue("ws-1"),
  ensureValidToken: vi.fn().mockImplementation((c) => Promise.resolve(c)),
}));
vi.mock("../../../../src/output/formatter.js", () => ({ output: vi.fn(), isJsonMode: vi.fn().mockReturnValue(true) }));
vi.mock("../../../../src/output/spinner.js", () => ({ withSpinner: vi.fn((_m: string, fn: () => unknown) => fn()) }));
vi.mock("../../../../src/utils/errors.js", () => ({ handleCommandError: vi.fn() }));

import { Command } from "commander";
import { parseTestsFile, registerQASuitesCreateCommand, registerQATestsAddCommand } from "../../../../src/commands/qa/suite-create.js";
import { handleCommandError } from "../../../../src/utils/errors.js";
import { output } from "../../../../src/output/formatter.js";

describe("parseTestsFile", () => {
  it("reads a JSON array, a {tests} object (a qa export) and JSONL", () => {
    const row = { prompt: "p", expectedResponse: "e" };
    expect(parseTestsFile(JSON.stringify([row]))).toEqual([row]);
    expect(parseTestsFile(JSON.stringify({ divinciQASuite: "v1", tests: [row] }))).toEqual([row]);
    expect(parseTestsFile(`${JSON.stringify(row)}\n${JSON.stringify(row)}\n`)).toEqual([row, row]);
  });

  it("accepts question/expected/answer aliases", () => {
    expect(parseTestsFile('[{"question":"q","answer":"a"},{"prompt":"p","expected":"x"}]'))
      .toEqual([{ prompt: "q", expectedResponse: "a" }, { prompt: "p", expectedResponse: "x" }]);
  });

  it("names the first bad row instead of letting the server 400", () => {
    expect(() => parseTestsFile('[{"prompt":"ok","expectedResponse":"ok"},{"prompt":"no answer"}]')).toThrow(/row 2/);
    expect(() => parseTestsFile("not json\n")).toThrow(/line 1/);
    expect(() => parseTestsFile("  ")).toThrow(/empty/);
  });
});

describe("qa suites create / qa tests add", () => {
  const fetchMock = vi.fn();
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  function cli(): Command {
    const program = new Command();
    const qa = program.command("qa");
    registerQASuitesCreateCommand(qa.command("suites"));
    registerQATestsAddCommand(qa.command("tests"));
    return program;
  }
  const bodyOf = (i: number) => JSON.parse(fetchMock.mock.calls[i][1].body as string);

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    (handleCommandError as ReturnType<typeof vi.fn>).mockReset();
    (output as ReturnType<typeof vi.fn>).mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates a suite and lets the server default the scorers", async () => {
    fetchMock.mockResolvedValueOnce(json({ _id: "s1", name: "N" }));
    await cli().parseAsync(["node", "cli", "qa", "suites", "create", "--name", "N"]);
    expect(handleCommandError).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example/white-label/ws-1/scored-qa/suites");
    // No scorer fields: the server defaults them. An empty merger is rejected
    // by the real validator ("Invalid merger configuration", seen on staging).
    expect(bodyOf(0)).toEqual({ name: "N", description: "" });
  });

  it("copies scorers from another suite and adds tests from a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-"));
    const f = join(dir, "t.jsonl");
    writeFileSync(f, '{"prompt":"a","expectedResponse":"b"}\n{"prompt":"c","expectedResponse":"d"}\n');
    const sg = [{ source: { type: "hard-coded", _id: "llm-correctness" }, weight: 1 }];
    const sug = { suggestor: [{ id: "x", authId: "", config: {} }], merger: { id: "y", authId: "", config: {} } };
    fetchMock
      .mockResolvedValueOnce(json({ scoreGenerators: sg, suggestionGeneration: sug }))
      .mockResolvedValueOnce(json({ _id: "s2", name: "N" }))
      .mockResolvedValueOnce(json({ addedTestIds: ["t1", "t2"] }));
    await cli().parseAsync(["node", "cli", "qa", "suites", "create", "--name", "N", "--scorers-from", "src1", "--tests", f]);
    expect(handleCommandError).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/scored-qa\/suites\/src1$/);
    expect(bodyOf(1).scoreGenerators).toEqual(sg);
    expect(bodyOf(1).suggestionGeneration).toEqual(sug);
    expect(fetchMock.mock.calls[2][0]).toMatch(/\/scored-qa\/suites\/s2\/tests\/bulk$/);
    expect(bodyOf(2)).toEqual({ tests: [{ prompt: "a", expectedResponse: "b" }, { prompt: "c", expectedResponse: "d" }] });
    expect((output as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ _id: "s2", testsAdded: 2, scorers: 1 });
  });

  it("adds one test from flags", async () => {
    fetchMock.mockResolvedValueOnce(json({ addedTestIds: ["t1"] }));
    await cli().parseAsync(["node", "cli", "qa", "tests", "add", "s1", "--prompt", "p", "--expected", "e"]);
    expect(bodyOf(0)).toEqual({ tests: [{ prompt: "p", expectedResponse: "e" }] });
  });

  it("refuses with no input rather than sending an empty request", async () => {
    await cli().parseAsync(["node", "cli", "qa", "tests", "add", "s1"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(handleCommandError).toHaveBeenCalled();
  });
});
