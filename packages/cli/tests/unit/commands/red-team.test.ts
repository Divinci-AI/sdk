import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerRedTeamCommands } from "../../../src/commands/red-team/index.js";

function build(): Command {
  const parent = new Command("red-team");
  registerRedTeamCommands(parent);
  return parent;
}

describe("red-team command registration", () => {
  it("registers plan and run", () => {
    const names = build().commands.map((c) => c.name());
    expect(names).toContain("plan");
    expect(names).toContain("run");
  });

  it("run requires --release and offers --category / --all / --system-prompt", () => {
    const run = build().commands.find((c) => c.name() === "run")!;
    const longs = run.options.map((o) => o.long);
    expect(run.options.find((o) => o.long === "--release")?.mandatory).toBe(true);
    expect(longs).toEqual(
      expect.arrayContaining([
        "--release",
        "--category",
        "--all",
        "--system-prompt",
        "--workspace",
      ]),
    );
  });
});
