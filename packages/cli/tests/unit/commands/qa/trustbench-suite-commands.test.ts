/**
 * The CLI half of signing TrustBench runs from a workspace suite, and of the
 * held-out mark: `divinci qa publish-to-trust`, `qa publish-to-trust-batch`,
 * `qa held-out`. Until 2026-10-15 none of the three had a test.
 *
 * Pins: the exact route and body (private by default; public only with
 * --public, and the prompts-public acknowledgement only when asked for), the
 * suite id encoded into the path, and an API-key-only profile refused before
 * any request, since those routes need a signed-in member.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  config: { apiUrl: "https://api.example/", accessToken: "tok" as string | undefined },
}));

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn(() => ({ ...h.config })),
  requireWorkspaceId: vi.fn().mockReturnValue("ws-1"),
  ensureValidToken: vi.fn().mockImplementation((c) => Promise.resolve(c)),
}));
vi.mock("../../../../src/output/formatter.js", () => ({ output: vi.fn(), isJsonMode: vi.fn().mockReturnValue(true) }));
vi.mock("../../../../src/output/spinner.js", () => ({ withSpinner: vi.fn((_m: string, fn: () => unknown) => fn()) }));
vi.mock("../../../../src/utils/errors.js", () => ({ handleCommandError: vi.fn() }));

import { Command } from "commander";
import { registerQAPublishToTrustCommand } from "../../../../src/commands/qa/publish-to-trust.js";
import { registerQAPublishToTrustBatchCommand } from "../../../../src/commands/qa/publish-to-trust-batch.js";
import { registerQAHeldOutCommand } from "../../../../src/commands/qa/held-out.js";
import { handleCommandError } from "../../../../src/utils/errors.js";

const SUITE = "65aa00000000000000000001";
const BASE = `https://api.example/white-label/ws-1/scored-qa/suites/${SUITE}`;

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const bodyOf = (i: number) => JSON.parse(fetchMock.mock.calls[i][1].body as string);

function cli(): Command {
  const program = new Command();
  program.option("--json");
  const qa = program.command("qa");
  registerQAPublishToTrustCommand(qa);
  registerQAPublishToTrustBatchCommand(qa);
  registerQAHeldOutCommand(qa);
  return program;
}
const run = (args: string[]) => cli().parseAsync(["node", "cli", "--json", "qa", ...args]);

beforeEach(() => {
  h.config = { apiUrl: "https://api.example/", accessToken: "tok" };
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  (handleCommandError as ReturnType<typeof vi.fn>).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("divinci qa publish-to-trust", () => {
  it("signs privately by default and sends no acknowledgement", async () => {
    fetchMock.mockResolvedValueOnce(json({ trustRunId: "tr_X" }));
    await run(["publish-to-trust", SUITE, "--release", "r1", "--scorer", "llm-factual", "--run", "65aa00000000000000000003"]);
    expect(handleCommandError).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/publish-to-trust`);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
    expect(bodyOf(0)).toEqual({
      releaseId: "r1", scorerKey: "llm-factual", visibility: "private", runResultId: "65aa00000000000000000003",
    });
  });

  it("goes public only with --public, and acknowledges only with the flag", async () => {
    fetchMock.mockResolvedValue(json({ trustRunId: "tr_X" }));
    await run(["publish-to-trust", SUITE, "--release", "r1", "--scorer", "s", "--public"]);
    expect(bodyOf(0).visibility).toBe("public");
    expect(bodyOf(0)).not.toHaveProperty("acknowledgePromptsPublic");
    await run(["publish-to-trust", SUITE, "--release", "r1", "--scorer", "s", "--public", "--acknowledge-prompts-public"]);
    expect(bodyOf(1).acknowledgePromptsPublic).toBe(true);
  });

  it("encodes the suite id into the path", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await run(["publish-to-trust", "a/../b", "--release", "r1", "--scorer", "s"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example/white-label/ws-1/scored-qa/suites/a%2F..%2Fb/publish-to-trust");
  });

  it("refuses an API-key-only profile before any request", async () => {
    h.config.accessToken = undefined;
    await run(["publish-to-trust", SUITE, "--release", "r1", "--scorer", "s"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String((handleCommandError as ReturnType<typeof vi.fn>).mock.calls[0][0])).toMatch(/signed-in workspace member/);
  });
});

describe("divinci qa publish-to-trust-batch", () => {
  it("posts the run, scorer and releases, and nothing about visibility", async () => {
    fetchMock.mockResolvedValueOnce(json({ signed: 2, alreadySigned: 0, refused: 0, results: [] }));
    await run(["publish-to-trust-batch", SUITE, "--run", "65aa00000000000000000003", "--scorer", "s", "--release", "r1", "r2"]);
    expect(handleCommandError).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/publish-to-trust/batch`);
    expect(bodyOf(0)).toEqual({ runResultId: "65aa00000000000000000003", scorerKey: "s", releaseIds: ["r1", "r2"] });
  });

  it("reports per-row refusals instead of failing the whole command", async () => {
    fetchMock.mockResolvedValueOnce(json({ signed: 0, refused: 1, results: [{ releaseId: "r1", status: "refused", reason: "x" }] }, 207));
    await run(["publish-to-trust-batch", SUITE, "--run", "65aa00000000000000000003", "--scorer", "s"]);
    expect(handleCommandError).not.toHaveBeenCalled();
  });

  it("refuses an API-key-only profile before any request", async () => {
    h.config.accessToken = undefined;
    await run(["publish-to-trust-batch", SUITE, "--run", "65aa00000000000000000003", "--scorer", "s"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(handleCommandError).toHaveBeenCalled();
  });
});

describe("divinci qa held-out", () => {
  it("PUTs heldOut true for on and false for off", async () => {
    fetchMock.mockResolvedValue(json({ heldOut: true, publicRunsStillPublic: 0 }));
    await run(["held-out", SUITE, "on"]);
    await run(["held-out", SUITE, "off"]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/held-out`);
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(bodyOf(0)).toEqual({ heldOut: true });
    expect(bodyOf(1)).toEqual({ heldOut: false });
  });

  it("rejects a state other than on/off without a request", async () => {
    await run(["held-out", SUITE, "maybe"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(handleCommandError).toHaveBeenCalled();
  });

  it("refuses an API-key-only profile before any request", async () => {
    h.config.accessToken = undefined;
    await run(["held-out", SUITE, "on"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
