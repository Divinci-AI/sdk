import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/output/colors.js", () => ({
  colors: {
    cyanBold: (s: string) => `[cyan-bold]${s}[/]`,
    greenBold: (s: string) => `[green-bold]${s}[/]`,
    dim: (s: string) => `[dim]${s}[/]`,
  },
}));

import {
  printStreamChunk,
  printStreamDone,
  printAssistantLabel,
  printUserLabel,
  printSystemMessage,
} from "../../../src/output/stream.js";

describe("stream output utilities", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  describe("printStreamChunk", () => {
    it("should write chunk to stdout", () => {
      printStreamChunk("Hello");
      expect(stdoutSpy).toHaveBeenCalledWith("Hello");
    });

    it("should write empty string", () => {
      printStreamChunk("");
      expect(stdoutSpy).toHaveBeenCalledWith("");
    });
  });

  describe("printStreamDone", () => {
    it("should write newline to stdout", () => {
      printStreamDone();
      expect(stdoutSpy).toHaveBeenCalledWith("\n");
    });
  });

  describe("printAssistantLabel", () => {
    it("should write colored assistant label", () => {
      printAssistantLabel();
      expect(stdoutSpy).toHaveBeenCalledWith("[cyan-bold]Assistant: [/]");
    });
  });

  describe("printUserLabel", () => {
    it("should write colored user label", () => {
      printUserLabel();
      expect(stdoutSpy).toHaveBeenCalledWith("[green-bold]You: [/]");
    });
  });

  describe("printSystemMessage", () => {
    it("should write dimmed message to stderr with newline", () => {
      printSystemMessage("Something happened");
      expect(stderrSpy).toHaveBeenCalledWith("[dim]Something happened[/]\n");
    });
  });
});
