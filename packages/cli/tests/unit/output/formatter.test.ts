import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock table module before importing formatter
vi.mock("../../../src/output/table.js", () => ({
  renderTable: vi.fn(() => "<table-output>"),
  renderKeyValue: vi.fn(() => "<key-value-output>"),
}));

import { renderTable, renderKeyValue } from "../../../src/output/table.js";
import {
  output,
  outputSuccess,
  outputError,
  setJsonMode,
  setOutputQuietMode,
  isJsonMode,
} from "../../../src/output/formatter.js";

describe("formatter", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Reset modes
    setJsonMode(false);
    setOutputQuietMode(false);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("setJsonMode / isJsonMode", () => {
    it("defaults to false", () => {
      expect(isJsonMode()).toBe(false);
    });

    it("toggles JSON mode on", () => {
      setJsonMode(true);
      expect(isJsonMode()).toBe(true);
    });

    it("toggles JSON mode off", () => {
      setJsonMode(true);
      setJsonMode(false);
      expect(isJsonMode()).toBe(false);
    });
  });

  describe("output", () => {
    describe("quiet mode", () => {
      it("suppresses all output when quiet mode is on", () => {
        setOutputQuietMode(true);

        output("hello");
        output({ key: "value" });
        output([1, 2, 3]);

        expect(consoleLogSpy).not.toHaveBeenCalled();
      });
    });

    describe("JSON mode", () => {
      it("outputs pretty-printed JSON for objects", () => {
        setJsonMode(true);

        output({ name: "test", count: 42 });

        expect(consoleLogSpy).toHaveBeenCalledWith(
          JSON.stringify({ name: "test", count: 42 }, null, 2)
        );
      });

      it("outputs JSON for strings", () => {
        setJsonMode(true);

        output("hello");

        expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify("hello", null, 2));
      });

      it("outputs JSON for arrays", () => {
        setJsonMode(true);

        output([1, 2, 3]);

        expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify([1, 2, 3], null, 2));
      });

      it("outputs JSON even when table options are provided", () => {
        setJsonMode(true);

        output([{ id: 1 }], { table: { columns: [{ key: "id" }] } });

        expect(consoleLogSpy).toHaveBeenCalledWith(
          JSON.stringify([{ id: 1 }], null, 2)
        );
        expect(renderTable).not.toHaveBeenCalled();
      });
    });

    describe("key-value mode", () => {
      it("renders key-value table for objects with keyValue option", () => {
        output({ name: "test", status: "active" }, { keyValue: true });

        expect(renderKeyValue).toHaveBeenCalledWith({ name: "test", status: "active" });
        expect(consoleLogSpy).toHaveBeenCalledWith("<key-value-output>");
      });

      it("does not use key-value mode for arrays", () => {
        output([1, 2], { keyValue: true });

        expect(renderKeyValue).not.toHaveBeenCalled();
      });

      it("does not use key-value mode for non-objects", () => {
        output("a string", { keyValue: true });

        expect(renderKeyValue).not.toHaveBeenCalled();
        // Falls through to string handler
        expect(consoleLogSpy).toHaveBeenCalledWith("a string");
      });

      it("does not use key-value mode for null", () => {
        output(null, { keyValue: true });

        expect(renderKeyValue).not.toHaveBeenCalled();
      });
    });

    describe("table mode", () => {
      it("renders table for array data with table options", () => {
        const columns = [{ key: "id", header: "ID" }, { key: "name", header: "Name" }];
        const data = [{ id: 1, name: "Test" }];

        output(data, { table: { columns } });

        expect(renderTable).toHaveBeenCalledWith(data, columns);
        expect(consoleLogSpy).toHaveBeenCalledWith("<table-output>");
      });

      it("does not use table mode for non-array data", () => {
        output({ id: 1 }, { table: { columns: [{ key: "id" }] } });

        expect(renderTable).not.toHaveBeenCalled();
      });
    });

    describe("default output", () => {
      it("outputs strings directly", () => {
        output("hello world");

        expect(consoleLogSpy).toHaveBeenCalledWith("hello world");
      });

      it("outputs objects as pretty-printed JSON", () => {
        output({ a: 1, b: 2 });

        expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify({ a: 1, b: 2 }, null, 2));
      });

      it("outputs numbers as JSON", () => {
        output(42);

        expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify(42, null, 2));
      });

      it("outputs arrays as JSON when no table options", () => {
        output([1, 2, 3]);

        expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify([1, 2, 3], null, 2));
      });
    });
  });

  describe("outputSuccess", () => {
    it("prints message to stdout", () => {
      outputSuccess("Operation completed");

      expect(consoleLogSpy).toHaveBeenCalledWith("Operation completed");
    });

    it("suppresses output when quiet mode is on", () => {
      setOutputQuietMode(true);

      outputSuccess("Operation completed");

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe("outputError", () => {
    it("prints message to stderr", () => {
      outputError("Something went wrong");

      expect(consoleErrorSpy).toHaveBeenCalledWith("Something went wrong");
    });

    it("always outputs even in quiet mode", () => {
      setOutputQuietMode(true);

      outputError("Critical error");

      expect(consoleErrorSpy).toHaveBeenCalledWith("Critical error");
    });
  });
});
