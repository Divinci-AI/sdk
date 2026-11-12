import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock colors to avoid ANSI codes and make assertions cleaner
vi.mock("../../../src/output/colors.js", () => ({
  colors: {
    red: (s: string) => `[red]${s}[/red]`,
    yellow: (s: string) => `[yellow]${s}[/yellow]`,
  },
}));

// Mock @divinci-ai/server — define class inside factory so vi.mock hoisting works
vi.mock("@divinci-ai/server", () => {
  class ServerApiError extends Error {
    readonly code: string;
    readonly status?: number;
    readonly details?: Record<string, unknown>;
    readonly requestId?: string;

    constructor(
      message: string,
      options: {
        code?: string;
        status?: number;
        details?: Record<string, unknown>;
        requestId?: string;
      } = {}
    ) {
      super(message);
      this.name = "ServerApiError";
      this.code = options.code ?? "UNKNOWN_ERROR";
      this.status = options.status;
      this.details = options.details;
      this.requestId = options.requestId;
    }
  }
  return { ServerApiError };
});

import { ServerApiError } from "@divinci-ai/server";
import { formatError, handleCommandError } from "../../../src/utils/errors.js";

describe("errors", () => {
  describe("formatError", () => {
    describe("ServerApiError handling", () => {
      it("formats 401 as authentication failure", () => {
        const error = new ServerApiError("Unauthorized", { status: 401 });

        const result = formatError(error);

        expect(result).toBe(
          "[red]Authentication failed. Run `divinci auth login` to re-authenticate.[/red]"
        );
      });

      it("formats 402 as paid plan required", () => {
        const error = new ServerApiError("Payment Required", { status: 402 });

        const result = formatError(error);

        expect(result).toBe(
          "[red]This feature requires a paid plan. See https://divinci.app/pricing[/red]"
        );
      });

      it("formats 403 as permission denied with message", () => {
        const error = new ServerApiError("Insufficient role", { status: 403 });

        const result = formatError(error);

        expect(result).toBe("[red]Permission denied. Insufficient role[/red]");
      });

      it("formats 404 as not found with message", () => {
        const error = new ServerApiError("Release not found", { status: 404 });

        const result = formatError(error);

        expect(result).toBe("[red]Not found: Release not found[/red]");
      });

      it("formats 429 as rate limit with no retry info", () => {
        const error = new ServerApiError("Too many requests", { status: 429 });

        const result = formatError(error);

        expect(result).toBe("[yellow]Rate limit exceeded.[/yellow]");
      });

      it("formats 429 with retryAfter details", () => {
        const error = new ServerApiError("Too many requests", {
          status: 429,
          details: { retryAfter: 30 },
        });

        const result = formatError(error);

        expect(result).toBe("[yellow]Rate limit exceeded. Retry in 30s.[/yellow]");
      });

      it("formats 500 as server error", () => {
        const error = new ServerApiError("Internal server error", { status: 500 });

        const result = formatError(error);

        expect(result).toBe("[red]Server error (500): Internal server error[/red]");
      });

      it("formats 502 as server error", () => {
        const error = new ServerApiError("Bad Gateway", { status: 502 });

        const result = formatError(error);

        expect(result).toBe("[red]Server error (502): Bad Gateway[/red]");
      });

      it("formats 503 as server error", () => {
        const error = new ServerApiError("Service Unavailable", { status: 503 });

        const result = formatError(error);

        expect(result).toBe("[red]Server error (503): Service Unavailable[/red]");
      });

      it("formats other 4xx status codes as generic API error", () => {
        const error = new ServerApiError("Conflict", { status: 409 });

        const result = formatError(error);

        expect(result).toBe("[red]API error (409): Conflict[/red]");
      });

      it("formats error with no status as unknown", () => {
        const error = new ServerApiError("Something broke");

        const result = formatError(error);

        expect(result).toBe("[red]API error (unknown): Something broke[/red]");
      });
    });

    describe("generic Error handling", () => {
      it("formats standard Error", () => {
        const error = new Error("File not found");

        const result = formatError(error);

        expect(result).toBe("[red]Error: File not found[/red]");
      });

      it("formats TypeError", () => {
        const error = new TypeError("Cannot read property");

        const result = formatError(error);

        expect(result).toBe("[red]Error: Cannot read property[/red]");
      });
    });

    describe("non-Error handling", () => {
      it("formats string error", () => {
        const result = formatError("something went wrong");

        expect(result).toBe("[red]Error: something went wrong[/red]");
      });

      it("formats number error", () => {
        const result = formatError(42);

        expect(result).toBe("[red]Error: 42[/red]");
      });

      it("formats null error", () => {
        const result = formatError(null);

        expect(result).toBe("[red]Error: null[/red]");
      });

      it("formats undefined error", () => {
        const result = formatError(undefined);

        expect(result).toBe("[red]Error: undefined[/red]");
      });
    });
  });

  describe("handleCommandError", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let processExitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it("prints formatted error to stderr and exits with code 1", () => {
      const error = new Error("fatal");

      handleCommandError(error);

      expect(consoleErrorSpy).toHaveBeenCalledWith("[red]Error: fatal[/red]");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("handles ServerApiError", () => {
      const error = new ServerApiError("Unauthorized", { status: 401 });

      handleCommandError(error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[red]Authentication failed. Run `divinci auth login` to re-authenticate.[/red]"
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
