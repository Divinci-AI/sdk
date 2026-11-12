/**
 * Command tests for `divinci trust set-visibility <runId> <public|private>`.
 *
 * The CLI half of the visibility flip. The server route owns auth and
 * persistence; this pins the wiring: correct path + body + surface header,
 * JSON output, and the client-side visibility enum check (so a typo never
 * reaches the API).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

const h = vi.hoisted(() => ({
  mockTrustPost: vi.fn(),
  mockOutput: vi.fn(),
  mockIsJson: vi.fn(() => true),
  mockHandleError: vi.fn(),
}));

vi.mock("../../../../src/commands/trust/_client.js", () => ({
  resolveTrustHttp: vi.fn(async () => ({
    baseUrl: "https://api.divinci.app",
    authToken: "tok",
  })),
  trustPost: h.mockTrustPost,
}));

vi.mock("../../../../src/output/formatter.js", () => ({
  output: h.mockOutput,
  isJsonMode: h.mockIsJson,
}));

vi.mock("../../../../src/output/colors.js", () => ({
  colors: {
    cyanBold: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

vi.mock("../../../../src/utils/errors.js", () => ({
  handleCommandError: h.mockHandleError,
}));

import { registerTrustSetVisibilityCommand } from "../../../../src/commands/trust/set-visibility";

const RUN_ID = "tr_793H62GCEK3W9GAS6YYTWEP0KC";

function buildProgram() {
  const program = new Command();
  registerTrustSetVisibilityCommand(program);
  return program;
}

async function run(args: string[]) {
  const program = buildProgram();
  await program.parseAsync(["node", "test", "set-visibility", ...args]);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.mockIsJson.mockReturnValue(true);
  h.mockTrustPost.mockResolvedValue({
    run: {
      runId: RUN_ID,
      status: "complete",
      visibility: "public",
      manifestR2Key: "runs/tr_793H62GCEK3W9GAS6YYTWEP0KC/manifest.json",
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("divinci trust set-visibility", () => {
  it("POSTs the visibility to the run's sub-resource with the cli surface header", async () => {
    await run([RUN_ID, "public"]);

    expect(h.mockTrustPost).toHaveBeenCalledTimes(1);
    const [http, path, body, headers] = h.mockTrustPost.mock.calls[0] as [
      { baseUrl: string },
      string,
      Record<string, unknown>,
      Record<string, string>,
    ];
    expect(path).toBe(`/v1/trustbench/runs/${RUN_ID}/visibility`);
    expect(body).toEqual({ visibility: "public" });
    expect(headers["X-Trustbench-Surface"]).toBe("cli");
  });

  it("emits the full response in json mode", async () => {
    await run([RUN_ID, "public"]);

    expect(h.mockOutput).toHaveBeenCalledTimes(1);
    expect(
      (h.mockOutput.mock.calls[0]![0] as { run: { visibility: string } }).run
        .visibility
    ).toBe("public");
  });

  it("prints a human line in table mode and keeps the verify hint", async () => {
    h.mockIsJson.mockReturnValue(false);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run([RUN_ID, "public"]);

    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("is now public"))).toBe(true);
    expect(lines.some((l) => l.includes("divinci trust verify"))).toBe(true);
  });

  it("rejects an invalid visibility client-side before any request", async () => {
    await run([RUN_ID, "everyone"]);

    expect(h.mockTrustPost).not.toHaveBeenCalled();
    expect(h.mockHandleError).toHaveBeenCalledTimes(1);
  });
});