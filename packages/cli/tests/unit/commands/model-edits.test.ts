/**
 * `divinci model-edits` registration tests.
 *
 * Asserts the command surface exists and is shaped as documented. A command
 * that fails to register is invisible until a user types it, so this is the
 * cheapest place to catch a broken wire-up.
 */

import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import { createProgram } from "../../../src/index.js";

function findCommand(program: Command, name: string): Command | undefined {
  return program.commands.find((c) => c.name() === name);
}

describe("divinci model-edits", () => {
  const program = createProgram();
  const group = findCommand(program, "model-edits");

  it("is registered on the program", () => {
    expect(group).toBeDefined();
    expect(group?.description()).toMatch(/associates/i);
  });

  it("exposes the full browse/edit/verify surface", () => {
    const names = group?.commands.map((c) => c.name()).sort();
    // Browse (describe, get, list, ask), edit (suppress, replace, revert,
    // restore), verify (export), and the versions group (save/get/list/restore
    // under `versions`). A command added without landing here is a command the
    // documented-commands guard cannot see.
    expect(names).toEqual([
      "ask",
      "describe",
      "export",
      "get",
      "list",
      "replace",
      "restore",
      "revert",
      "suppress",
      "versions",
    ]);
  });

  it("requires relation and target on suppress, so an edit cannot be half-specified", () => {
    const suppress = findCommand(group as Command, "suppress");
    const required = suppress?.options.filter((o) => o.required || o.mandatory).map((o) => o.long);
    expect(required).toContain("--relation");
    expect(required).toContain("--target");
  });

  it("gates the mutating commands behind a confirmation that -y can skip", () => {
    // suppress/restore/revert change the served model. Each must offer --yes
    // so scripts and CI have a non-interactive path that is still explicit.
    for (const name of ["suppress", "restore", "revert"]) {
      const cmd = findCommand(group as Command, name);
      const longs = cmd?.options.map((o) => o.long);
      expect(longs, `${name} should accept --yes`).toContain("--yes");
    }
  });

  it("does not put a confirmation flag on the read-only commands", () => {
    for (const name of ["describe", "list", "get"]) {
      const cmd = findCommand(group as Command, name);
      const longs = cmd?.options.map((o) => o.long) ?? [];
      expect(longs, `${name} should not have --yes`).not.toContain("--yes");
    }
  });

  it("offers status and entity filters on list", () => {
    const list = findCommand(group as Command, "list");
    const longs = list?.options.map((o) => o.long);
    expect(longs).toContain("--status");
    expect(longs).toContain("--entity");
  });
});
