import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerTrustRunCommand } from "../../../src/commands/trust/run.js";
import { registerTrustVerifyCommand } from "../../../src/commands/trust/verify.js";
import { registerTrustListCommand } from "../../../src/commands/trust/list.js";
import { registerTrustBenchmarksCommand } from "../../../src/commands/trust/benchmarks.js";

function buildTrust(): Command {
  const trust = new Command("trust");
  registerTrustRunCommand(trust);
  registerTrustVerifyCommand(trust);
  registerTrustListCommand(trust);
  registerTrustBenchmarksCommand(trust);
  return trust;
}

describe("trust command registration", () => {
  it("registers run / verify / list / benchmarks subcommands", () => {
    const names = buildTrust().commands.map((c) => c.name());
    expect(names).toContain("run");
    expect(names).toContain("verify");
    expect(names).toContain("list");
    expect(names).toContain("benchmarks");
  });

  it("list has the 'ls' alias", () => {
    const list = buildTrust().commands.find((c) => c.name() === "list");
    expect(list?.aliases()).toContain("ls");
  });

  it("run declares its options (incl. required --model and --no-wait)", () => {
    const run = buildTrust().commands.find((c) => c.name() === "run")!;
    const longs = run.options.map((o) => o.long);
    expect(longs).toContain("--model");
    expect(longs).toContain("--whitelabel");
    expect(longs).toContain("--public");
    expect(longs).toContain("--no-wait");
    expect(longs).toContain("--timeout");
    expect(longs).toContain("--output");
    expect(run.options.find((o) => o.long === "--model")?.mandatory).toBe(true);
  });

  it("verify declares --strict and --remote", () => {
    const verify = buildTrust().commands.find((c) => c.name() === "verify")!;
    const longs = verify.options.map((o) => o.long);
    expect(longs).toContain("--strict");
    expect(longs).toContain("--remote");
  });

  it("list declares its filter options", () => {
    const list = buildTrust().commands.find((c) => c.name() === "list")!;
    const longs = list.options.map((o) => o.long);
    expect(longs).toEqual(
      expect.arrayContaining([
        "--mine",
        "--benchmark",
        "--model",
        "--status",
        "--limit",
        "--since",
      ])
    );
  });

  it("benchmarks has 'list' and 'show' subcommands", () => {
    const bench = buildTrust().commands.find((c) => c.name() === "benchmarks")!;
    const subs = bench.commands.map((c) => c.name());
    expect(subs).toContain("list");
    expect(subs).toContain("show");
    expect(subs).toContain("board");
  });

  it("benchmarks list can name a workspace, and offers owner=user", () => {
    const list = buildTrust()
      .commands.find((c) => c.name() === "benchmarks")!
      .commands.find((c) => c.name() === "list")!;
    const flags = list.options.map((o) => o.long);
    expect(flags).toContain("--workspace");
    const owner = list.options.find((o) => o.long === "--owner")!;
    expect(owner.description).toContain("user");
  });
});
