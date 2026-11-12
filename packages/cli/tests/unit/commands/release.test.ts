import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerReleaseListCommand } from "../../../src/commands/release/list.js";
import { registerReleaseGetCommand } from "../../../src/commands/release/get.js";
import { registerReleaseCreateCommand } from "../../../src/commands/release/create.js";
import { registerReleaseUpdateCommand } from "../../../src/commands/release/update.js";
import { registerReleaseDeleteCommand } from "../../../src/commands/release/delete.js";
import { registerReleasePublishCommand } from "../../../src/commands/release/publish.js";
import { registerReleaseCreateFromMcpCommand } from "../../../src/commands/release/create-from-mcp.js";
import { registerReleaseCloneCommand } from "../../../src/commands/release/clone.js";

/**
 * QA §19.3 — Release via CLI. Confirms the `divinci release` command group
 * exists and is fully wired (the checklist's "commands exist" requirement),
 * plus the key arg/option contract for the lifecycle verbs.
 */
function buildRelease(): Command {
  const release = new Command("release");
  registerReleaseListCommand(release);
  registerReleaseGetCommand(release);
  registerReleaseCreateCommand(release);
  registerReleaseUpdateCommand(release);
  registerReleaseDeleteCommand(release);
  registerReleasePublishCommand(release);
  registerReleaseCreateFromMcpCommand(release);
  registerReleaseCloneCommand(release);
  return release;
}

describe("release command registration (§19.3 Release via CLI)", () => {
  it("registers the full lifecycle subcommand set", () => {
    const names = buildRelease().commands.map((c) => c.name());
    for (const expected of [
      "list",
      "get",
      "create",
      "update",
      "delete",
      "publish",
      "create-from-mcp",
      "clone",
    ]) {
      expect(names, `missing 'release ${expected}'`).toContain(expected);
    }
  });

  it("list has the 'ls' alias and filter options", () => {
    const list = buildRelease().commands.find((c) => c.name() === "list")!;
    expect(list.aliases()).toContain("ls");
    const longs = list.options.map((o) => o.long);
    expect(longs).toContain("--status");
    expect(longs).toContain("--limit");
  });

  it("create requires --name and accepts --from / --assistant-id", () => {
    const create = buildRelease().commands.find((c) => c.name() === "create")!;
    const nameOpt = create.options.find((o) => o.long === "--name");
    expect(nameOpt?.mandatory, "--name must be required on `release create`").toBe(true);
    const longs = create.options.map((o) => o.long);
    expect(longs).toContain("--from");
    expect(longs).toContain("--assistant-id");
  });

  it("lifecycle verbs that act on one release take a <releaseId> argument", () => {
    const release = buildRelease();
    for (const verb of ["get", "update", "delete", "publish", "clone"]) {
      const cmd = release.commands.find((c) => c.name() === verb)!;
      const argNames = cmd.registeredArguments?.map((a) => a.name()) ?? [];
      expect(argNames, `'release ${verb}' should take a releaseId arg`).toContain("releaseId");
    }
  });
});
