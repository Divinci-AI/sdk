// Guard for notes/KNOWN-GAPS.yaml `multi-release-qa-runs-die-on-every-prod-deploy`
// and `qa-sweeps-past-the-overall-cap-leave-tests-unscored`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({ apiUrl: "https://api.example", accessToken: "tok", workspaceId: "ws-1" }),
  requireWorkspaceId: vi.fn().mockReturnValue("ws-1"),
  ensureValidToken: vi.fn().mockImplementation((c) => Promise.resolve(c)),
}));
vi.mock("../../../../src/output/formatter.js", () => ({ output: vi.fn(), isJsonMode: vi.fn().mockReturnValue(true) }));
vi.mock("../../../../src/output/spinner.js", () => ({ withSpinner: vi.fn((_m: string, fn: () => unknown) => fn()) }));
vi.mock("../../../../src/utils/errors.js", () => ({ handleCommandError: vi.fn() }));

import { Command } from "commander";
import { decideRunOutcome, registerQAMultiReleaseRunCommand } from "../../../../src/commands/qa/multi-release-run.js";
import { handleCommandError } from "../../../../src/utils/errors.js";
import { output } from "../../../../src/output/formatter.js";

const errs = (n: number) => [{ errorCount: n }];

describe("decideRunOutcome", () => {
  it("is done when every test scored", () => {
    expect(decideRunOutcome({ status: "complete" }, null, 3).action).toBe("done");
  });

  it("resumes past the overall cap — take 11 left 19 of 86 unscored", () => {
    const o = decideRunOutcome({ status: "complete", variantErrors: errs(19) }, null, 3);
    expect(o).toMatchObject({ action: "resume", unfinished: 19 });
  });

  it("resumes an orphaned run", () => {
    expect(decideRunOutcome({ status: "orphaned" }, null, 1).action).toBe("resume");
  });

  it("stops when a resume finished none of the remaining tests", () => {
    expect(decideRunOutcome({ status: "complete", variantErrors: errs(4) }, 4, 3).action).toBe("stop");
  });

  it("stops with no resumes left, and never resumes a cancelled run", () => {
    expect(decideRunOutcome({ status: "complete", variantErrors: errs(2) }, null, 0).action).toBe("stop");
    expect(decideRunOutcome({ status: "orphaned" }, null, 0).action).toBe("stop");
    expect(decideRunOutcome({ status: "cancelled", variantErrors: errs(5) }, null, 3).action).toBe("done");
  });
});

describe("qa multi-release-run --auto-resume", () => {
  const fetchMock = vi.fn();
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const cli = () => {
    const program = new Command();
    registerQAMultiReleaseRunCommand(program.command("qa"));
    return program;
  };
  const posts = () => fetchMock.mock.calls.filter((c) => c[1]?.method === "POST").map((c) => JSON.parse(c[1].body));

  // Restore only these spies: vi.restoreAllMocks() would also strip the
  // module mocks above (withSpinner would start returning undefined).
  let spies: Array<{ mockRestore: () => void }> = [];
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    spies = [
      vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => { fn(); return 0; }) as never),
      vi.spyOn(process.stderr, "write").mockImplementation(() => true),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
    ];
    (handleCommandError as ReturnType<typeof vi.fn>).mockReset();
    (output as ReturnType<typeof vi.fn>).mockReset();
    process.exitCode = undefined;
  });
  afterEach(() => {
    spies.forEach((sp) => sp.mockRestore());
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  it("resumes an orphaned run, then a capped one, and prints the final report", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ runResultId: "run1" }))
      .mockResolvedValueOnce(json({ run: { status: "orphaned" }, orphanReason: "no heartbeat" }))
      .mockResolvedValueOnce(json({ runResultId: "run2" }))
      .mockResolvedValueOnce(json({ run: { status: "complete", variantErrors: errs(19), report: { n: 1 } } }))
      .mockResolvedValueOnce(json({ runResultId: "run3" }))
      .mockResolvedValueOnce(json({ run: { status: "complete", report: { n: 3 } } }));
    await cli().parseAsync(["node", "cli", "qa", "multi-release-run", "suite1", "-r", "rel1", "--auto-resume", "3"]);

    expect(handleCommandError).not.toHaveBeenCalled();
    const p = posts();
    expect(p).toHaveLength(3);
    expect(p[0].resumeRunId).toBeUndefined();
    expect(p[1].resumeRunId).toBe("run1");
    expect(p[2].resumeRunId).toBe("run2");
    expect((output as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ n: 3 });
    expect(process.exitCode).toBeUndefined();
  });

  it("without --auto-resume, an orphaned run exits non-zero instead of printing nothing", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ runResultId: "run1" }))
      .mockResolvedValueOnce(json({ run: { status: "orphaned" } }));
    await cli().parseAsync(["node", "cli", "qa", "multi-release-run", "suite1", "-r", "rel1"]);
    expect(posts()).toHaveLength(1);
    expect(process.exitCode).toBe(1);
    expect((console.warn as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n"))
      .toContain("--resume run1");
  });
});
