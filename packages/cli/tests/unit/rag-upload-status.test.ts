/**
 * `divinci rag upload --wait` status classification.
 *
 * The loop this guards used to break only on "CHUNKED_AND_EMBEDDED" | "ready"
 * and "FAILED_TO_CHUNK" | "failed". None of those four is a status the server
 * actually returns -- two are enum KEY names from
 * RagVectorTextChunksStatus, two were invented -- so `--wait` could not
 * terminate on ANY upload. Measured 2026-09-20: a file that indexed in ~12s
 * left the loop polling for 40,092s (11.1 hours).
 */

import { describe, it, expect } from "vitest";
import { classifyUploadStatus } from "../../src/commands/rag/upload.js";

describe("classifyUploadStatus", () => {
  // The regression itself: this is what the server returns on success, and
  // it matched none of the old checks.
  it("treats the server's real success value as done", () => {
    expect(classifyUploadStatus("completed")).toBe("done");
  });

  it.each([
    ["file to chunks", "running"],
    ["chunks to storage", "running"],
    ["transcribing", "running"],
    ["completed", "done"],
    ["editing chunks", "done"],
    ["failed to chunk", "failed"],
    ["source missing", "failed"],
  ])("models vocabulary: %s -> %s", (status, phase) => {
    expect(classifyUploadStatus(status)).toBe(phase);
  });

  it.each([
    ["pending", "running"],
    ["uploading", "running"],
    ["processing", "running"],
    ["chunking", "running"],
    ["embedding", "running"],
    ["completed", "done"],
    ["error", "failed"],
  ])("types vocabulary: %s -> %s", (status, phase) => {
    expect(classifyUploadStatus(status)).toBe(phase);
  });

  it.each([
    ["ready", "done"],
    ["failed", "failed"],
  ])("legacy vocabulary: %s -> %s", (status, phase) => {
    expect(classifyUploadStatus(status)).toBe(phase);
  });

  it("is tolerant of case and surrounding whitespace", () => {
    expect(classifyUploadStatus("  Completed ")).toBe("done");
    expect(classifyUploadStatus("FILE TO CHUNKS")).toBe("running");
  });

  it("reports an unrecognized status as unknown, never as done", () => {
    // "unknown" keeps the caller waiting (bounded by --timeout) instead of
    // claiming success. Returning "done" here would silently pass a broken
    // upload; returning "running" would hide that the vocabulary drifted.
    for (const s of ["CHUNKED_AND_EMBEDDED", "FAILED_TO_CHUNK", "banana", ""]) {
      expect(classifyUploadStatus(s)).toBe("unknown");
    }
  });

  it("never throws on a missing status", () => {
    expect(classifyUploadStatus(undefined)).toBe("unknown");
    expect(classifyUploadStatus(null)).toBe("unknown");
  });

  it("the enum KEY names are NOT statuses -- that was the bug", () => {
    // Pinning this explicitly: if someone 'restores' these they reintroduce
    // an infinite wait loop.
    expect(classifyUploadStatus("CHUNKED_AND_EMBEDDED")).not.toBe("done");
    expect(classifyUploadStatus("FAILED_TO_CHUNK")).not.toBe("failed");
  });
});

// Production 2026-10-04: 85 of 386 files reported "completed" while in no
// vector. "completed" means chunked; the attach is a separate, later step.
import { classifyTargetAttach } from "../../src/commands/rag/upload.js";

describe("classifyTargetAttach", () => {
  it("is attached only when every target reports indexed", () => {
    expect(classifyTargetAttach(
      [{ _id: "a", fileStatus: "indexed" }, { _id: "b", fileStatus: "indexed" }], ["a", "b"],
    ).state).toBe("attached");
  });

  it("keeps waiting when the file is in no vector yet — the take-11 shape", () => {
    const r = classifyTargetAttach([], ["a"]);
    expect(r.state).toBe("waiting");
    expect(r.waitingOn).toEqual(["a"]);
  });

  it("keeps waiting on a pending or partially attached file", () => {
    const r = classifyTargetAttach(
      [{ _id: "a", fileStatus: "indexed" }, { _id: "b", fileStatus: "pending" }], ["a", "b"],
    );
    expect(r.state).toBe("waiting");
    expect(r.waitingOn).toEqual(["b"]);
  });

  it("fails with the server's reason when a target recorded a failure", () => {
    const r = classifyTargetAttach(
      [{ _id: "a", fileStatus: "failed", failedReason: "429 Too Many Requests" }], ["a"],
    );
    expect(r.state).toBe("failed");
    expect(r.failures).toEqual([{ vectorId: "a", reason: "429 Too Many Requests" }]);
  });

  it("ignores vectors the upload did not target", () => {
    expect(classifyTargetAttach(
      [{ _id: "a", fileStatus: "indexed" }, { _id: "z", fileStatus: "failed" }], ["a"],
    ).state).toBe("attached");
  });
});
