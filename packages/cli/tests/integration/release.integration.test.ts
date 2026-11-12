import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { Command } from "commander";
import { setJsonMode } from "../../src/output/formatter.js";
import { registerReleaseCreateCommand } from "../../src/commands/release/create.js";
import { registerReleaseListCommand } from "../../src/commands/release/list.js";
import { registerReleaseDeleteCommand } from "../../src/commands/release/delete.js";

/**
 * QA §19.3 — Release via CLI, DEEPER (live) integration.
 *
 * Drives the REAL `divinci release` command actions in-process against a live
 * workspace: create a draft → confirm it lists → delete it. The commands
 * resolve config from env (DIVINCI_API_URL / DIVINCI_WORKSPACE_ID /
 * DIVINCI_API_KEY — see config-manager), so the test just sets those and runs
 * the actual command code path + real HTTP. JSON output mode lets us capture
 * the created release `_id` from the command's own output.
 *
 * OPT-IN — self-skips unless creds are present, so normal `vitest run` stays
 * green. Run with:
 *   divinci login          # once; the test uses the CLI's saved login
 *   CLI_INTEGRATION=1 DIVINCI_WORKSPACE_ID=<wl> \
 *     DIVINCI_API_URL=https://api.divinci.app \
 *     pnpm exec vitest run tests/integration/release.integration.test.ts
 *
 * AUTH IS THE SAVED LOGIN, NOT AN API KEY. `release create` posts to /white-label/:id/release, the Auth0-gated admin endpoint, which an API key
 * is never allowed to call ("Permission denied. forbidden", measured 2026-11-03 with a release:read+write key that DID work on /api/v1/releases).
 * The old header told you to set DIVINCI_API_KEY, so the documented invocation could not pass. beforeAll drops any DIVINCI_API_KEY from the
 * environment so a key left in your shell cannot shadow the login.
 *
 * The create passes --assistant-id (DIVINCI_TEST_ASSISTANT_ID, default gemini-3-5-flash: the server's id uses hyphens; the CLI's own hint
 * "gemini-3.5-flash" is rejected as "bad form data") so a workspace with no defaultAssistant works. Creating a draft calls no model.
 * A try/finally always deletes the created draft. Point it at a throwaway workspace, never a customer's.
 */
const RUN =
  process.env.CLI_INTEGRATION === "1" &&
  !!process.env.DIVINCI_WORKSPACE_ID;
const ASSISTANT_ID = process.env.DIVINCI_TEST_ASSISTANT_ID || "gemini-3-5-flash";

/** Build a fresh release command group with commander errors as throws. */
function buildRelease(): Command {
  // Saved-login mode takes the workspace from --workspace, not DIVINCI_WORKSPACE_ID (that env var is only read in API-key mode), and the commands
  // read it through optsWithGlobals(), so the group declares it.
  const release = new Command("release").exitOverride().option("--workspace <id>", "Override workspace ID");
  registerReleaseCreateCommand(release);
  registerReleaseListCommand(release);
  registerReleaseDeleteCommand(release);
  return release;
}

/** Run `release <args...>`, returning the JSON objects the command emitted. */
async function runRelease(args: string[]): Promise<any[]> {
  const captured: any[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    if (typeof line === "string") {
      try {
        captured.push(JSON.parse(line));
      } catch {
        /* non-JSON chrome line — ignore */
      }
    }
  });
  try {
    await buildRelease().parseAsync(["--workspace", process.env.DIVINCI_WORKSPACE_ID as string, ...args], { from: "user" });
  } finally {
    spy.mockRestore();
  }
  return captured;
}

describe.skipIf(!RUN)("release CLI — live integration (§19.3)", () => {
  let releaseId: string | undefined;
  const title = `E2E CLI Release ${process.env.GITHUB_RUN_ID ?? "local"}-${process.pid}`;

  beforeAll(() => {
    setJsonMode(true); // make output() emit parseable JSON
    delete process.env.DIVINCI_API_KEY; // an API key would shadow the saved login and the admin endpoint refuses keys
  });

  afterEach(async () => {
    // Safety net: if a test created a release but didn't delete it, clean up.
    if (releaseId) {
      await runRelease(["delete", releaseId]).catch(() => undefined);
      releaseId = undefined;
    }
  });

  it("create → list → delete a release draft via the CLI", async () => {
    // create
    const created = await runRelease(["create", "--name", title, "--assistant-id", ASSISTANT_ID]);
    const createdDoc = created.find((d) => d && (d._id || d.id));
    expect(createdDoc, "create emitted no release object").toBeTruthy();
    releaseId = createdDoc._id ?? createdDoc.id;
    expect(releaseId).toBeTruthy();

    // list — the new draft must appear
    const listed = await runRelease(["list", "--status", "draft", "--limit", "100"]);
    const flat = JSON.stringify(listed);
    expect(flat.includes(releaseId as string), "created draft not in `release list`").toBe(true);

    // delete — and confirm cleanup so afterEach has nothing to do
    await runRelease(["delete", releaseId as string]);
    releaseId = undefined;
  });
});

// Visibility when skipped, so a normal run shows WHY it didn't execute.
describe.skipIf(RUN)("release CLI — live integration (skipped)", () => {
  it("requires CLI_INTEGRATION=1 + DIVINCI_WORKSPACE_ID (and a saved `divinci login`)", () => {
    expect(RUN).toBe(false);
  });
});
