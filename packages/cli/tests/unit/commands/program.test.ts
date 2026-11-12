import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// Mock all command registration modules
vi.mock("../../../src/output/colors.js", () => ({
  setColorsEnabled: vi.fn(),
  colors: {},
}));

vi.mock("../../../src/output/spinner.js", () => ({
  setQuietMode: vi.fn(),
}));

vi.mock("../../../src/output/formatter.js", () => ({
  setJsonMode: vi.fn(),
  setOutputQuietMode: vi.fn(),
}));

vi.mock("../../../src/commands/auth/login.js", () => ({
  registerLoginCommand: vi.fn(),
}));

vi.mock("../../../src/commands/auth/logout.js", () => ({
  registerLogoutCommand: vi.fn(),
}));

vi.mock("../../../src/commands/auth/status.js", () => ({
  registerStatusCommand: vi.fn(),
}));

vi.mock("../../../src/commands/chat/index.js", () => ({
  registerChatCommand: vi.fn(),
}));

vi.mock("../../../src/commands/rag/search.js", () => ({
  registerRagSearchCommand: vi.fn(),
}));

vi.mock("../../../src/commands/rag/files.js", () => ({
  registerRagFilesCommand: vi.fn(),
}));

vi.mock("../../../src/commands/rag/status.js", () => ({
  registerRagStatusCommand: vi.fn(),
}));

vi.mock("../../../src/commands/release/list.js", () => ({
  registerReleaseListCommand: vi.fn(),
}));

vi.mock("../../../src/commands/release/get.js", () => ({
  registerReleaseGetCommand: vi.fn(),
}));

vi.mock("../../../src/commands/workspace/list.js", () => ({
  registerWorkspaceListCommand: vi.fn(),
}));

vi.mock("../../../src/commands/workspace/get.js", () => ({
  registerWorkspaceGetCommand: vi.fn(),
}));

vi.mock("../../../src/commands/workspace/use.js", () => ({
  registerWorkspaceUseCommand: vi.fn(),
}));

vi.mock("../../../src/commands/api.js", () => ({
  registerApiCommand: vi.fn(),
}));

import { createProgram } from "../../../src/index.js";
import { registerLoginCommand } from "../../../src/commands/auth/login.js";
import { registerLogoutCommand } from "../../../src/commands/auth/logout.js";
import { registerStatusCommand } from "../../../src/commands/auth/status.js";
import { registerChatCommand } from "../../../src/commands/chat/index.js";
import { registerRagSearchCommand } from "../../../src/commands/rag/search.js";
import { registerRagFilesCommand } from "../../../src/commands/rag/files.js";
import { registerRagStatusCommand } from "../../../src/commands/rag/status.js";
import { registerReleaseListCommand } from "../../../src/commands/release/list.js";
import { registerReleaseGetCommand } from "../../../src/commands/release/get.js";
import { registerWorkspaceListCommand } from "../../../src/commands/workspace/list.js";
import { registerWorkspaceGetCommand } from "../../../src/commands/workspace/get.js";
import { registerWorkspaceUseCommand } from "../../../src/commands/workspace/use.js";
import { registerApiCommand } from "../../../src/commands/api.js";

describe("createProgram", () => {
  it("creates a Commander program named 'divinci'", () => {
    const program = createProgram();

    expect(program.name()).toBe("divinci");
  });

  it("has the correct version", () => {
    const program = createProgram();

    // createProgram reads its version from package.json at runtime
    // (readPackageVersion in src/index.ts), so assert against the same source
    // of truth rather than a hardcoded literal that skews on every release bump.
    const pkg = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf-8"),
    ) as { version: string };
    expect(program.version()).toBe(pkg.version);
  });

  it("has a description", () => {
    const program = createProgram();

    expect(program.description()).toBe("Official Divinci AI CLI");
  });

  it("registers global options", () => {
    const program = createProgram();
    const optionNames = program.options.map((o) => o.long ?? o.short);

    expect(optionNames).toContain("--api-key");
    expect(optionNames).toContain("--workspace");
    expect(optionNames).toContain("--json");
    expect(optionNames).toContain("--no-color");
    expect(optionNames).toContain("--quiet");
    expect(optionNames).toContain("--verbose");
    expect(optionNames).toContain("--profile");
    expect(optionNames).toContain("--api-url");
  });

  it("registers auth command group", () => {
    const program = createProgram();
    const authCmd = program.commands.find((c) => c.name() === "auth");

    expect(authCmd).toBeDefined();
    expect(authCmd!.description()).toBe("Authentication management");
    expect(registerLoginCommand).toHaveBeenCalled();
    expect(registerLogoutCommand).toHaveBeenCalled();
    expect(registerStatusCommand).toHaveBeenCalled();
  });

  it("registers chat command", () => {
    createProgram();

    expect(registerChatCommand).toHaveBeenCalled();
  });

  it("registers rag command group", () => {
    const program = createProgram();
    const ragCmd = program.commands.find((c) => c.name() === "rag");

    expect(ragCmd).toBeDefined();
    expect(ragCmd!.description()).toBe("Knowledge base and RAG operations");
    expect(registerRagSearchCommand).toHaveBeenCalled();
    expect(registerRagFilesCommand).toHaveBeenCalled();
    expect(registerRagStatusCommand).toHaveBeenCalled();
  });

  it("registers release command group", () => {
    const program = createProgram();
    const releaseCmd = program.commands.find((c) => c.name() === "release");

    expect(releaseCmd).toBeDefined();
    expect(releaseCmd!.description()).toBe("Release management");
    expect(registerReleaseListCommand).toHaveBeenCalled();
    expect(registerReleaseGetCommand).toHaveBeenCalled();
  });

  it("registers workspace command group with alias", () => {
    const program = createProgram();
    const wsCmd = program.commands.find((c) => c.name() === "workspace");

    expect(wsCmd).toBeDefined();
    expect(wsCmd!.description()).toBe("Workspace management");
    expect(wsCmd!.alias()).toBe("ws");
    expect(registerWorkspaceListCommand).toHaveBeenCalled();
    expect(registerWorkspaceGetCommand).toHaveBeenCalled();
    expect(registerWorkspaceUseCommand).toHaveBeenCalled();
  });

  it("registers api command", () => {
    createProgram();

    expect(registerApiCommand).toHaveBeenCalled();
  });

  it("has all expected top-level command groups", () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());

    expect(commandNames).toContain("auth");
    expect(commandNames).toContain("rag");
    expect(commandNames).toContain("release");
    expect(commandNames).toContain("workspace");
  });
});
