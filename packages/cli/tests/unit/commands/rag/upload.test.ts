import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../../../src/config/config-manager.js", () => ({
  requireConfig: vi.fn().mockReturnValue({
    apiKey: "test-key",
    apiUrl: "https://api.divinci.app",
    workspaceId: "ws-123",
    profile: "default",
    source: "env",
  }),
  ensureValidToken: vi.fn().mockImplementation((config) => Promise.resolve(config)),
  getRouteBase: vi.fn().mockReturnValue("/white-label/wl-test"),
}));

const { mockPost, mockGet, mockUpload, mockOutput } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockGet: vi.fn(),
  mockUpload: vi.fn(),
  mockOutput: vi.fn(),
}));

vi.mock("../../../../src/client/create-client.js", () => ({
  createClient: vi.fn().mockReturnValue({
    getHttpClient: () => ({
      post: mockPost,
      get: mockGet,
      upload: mockUpload,
    }),
  }),
}));

vi.mock("../../../../src/output/formatter.js", () => ({
  output: mockOutput,
  isJsonMode: vi.fn().mockReturnValue(true),
}));

vi.mock("../../../../src/output/spinner.js", () => ({
  withSpinner: vi.fn((_msg: string, fn: () => unknown) => fn()),
}));

vi.mock("../../../../src/output/colors.js", () => ({
  colors: {
    cyanBold: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
    greenBold: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    cyan: (s: string) => s,
  },
}));

vi.mock("../../../../src/utils/errors.js", () => ({
  handleCommandError: vi.fn(),
}));

import { Command } from "commander";
import {
  registerRagUploadCommand,
  VALID_UPLOAD_CHUNKING_TOOLS,
} from "../../../../src/commands/rag/upload.js";
import { isJsonMode } from "../../../../src/output/formatter.js";

function createCli(): Command {
  const program = new Command();
  const rag = program.command("rag");
  registerRagUploadCommand(rag);
  return program;
}

describe("rag upload — non-audio multipart response shape", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockReset();
    mockUpload.mockReset();
    mockOutput.mockReset();

    tmpDir = mkdtempSync(join(tmpdir(), "cli-upload-test-"));
    filePath = join(tmpDir, "doc.pdf");
    writeFileSync(filePath, "fake pdf content");

    // The real endpoint (directCreateRagVectorFile) returns a plain array of
    // saved file records — not a { file, workflow } object.
    mockUpload.mockResolvedValue([
      { _id: "file-abc", title: "doc.pdf", status: "CHUNKING" },
    ]);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts the file id from the array response instead of a nonexistent .file property", async () => {
    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "upload", filePath,
      "--targets", "vec-1",
    ]);

    expect(mockOutput).toHaveBeenCalledTimes(1);
    const [outputArg] = mockOutput.mock.calls[0];
    expect(Array.isArray(outputArg)).toBe(true);
    expect(outputArg[0]._id).toBe("file-abc");
  });

  it("polls status via --wait using the extracted file id", async () => {
    // The polling/console-output branch only runs when isJsonMode() is
    // false — the other tests in this suite rely on it being true to
    // short-circuit into output(result); flip it for this test.
    (isJsonMode as ReturnType<typeof vi.fn>).mockReturnValue(false);

    // Stub setTimeout to fire immediately instead of waiting on the real
    // (minimum 5s) poll interval.
    const setTimeoutSpy = vi
      .spyOn(global, "setTimeout")
      .mockImplementation(((fn: () => void) => {
        fn();
        return 0 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout);

    mockGet
      .mockResolvedValueOnce({ _id: "file-abc", status: "CHUNKING" })
      .mockResolvedValueOnce({
        _id: "file-abc", status: "completed",
        ragVectors: [{ _id: "vec-1", fileStatus: "indexed" }],
      });

    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "upload", filePath,
      "--targets", "vec-1",
      "--wait",
      "--poll-interval", "5",
    ]);

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet.mock.calls[0][0]).toBe("/white-label/wl-test/rag/files/file-abc");
    setTimeoutSpy.mockRestore();
    (isJsonMode as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  // Production 2026-10-04: 85 files reported "completed" while in no vector.
  // --wait must keep polling past "completed" until the target lists the file.
  it("keeps polling after 'completed' until the target vector indexes the file", async () => {
    (isJsonMode as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const setTimeoutSpy = vi
      .spyOn(global, "setTimeout")
      .mockImplementation(((fn: () => void) => {
        fn();
        return 0 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout);

    mockGet
      .mockResolvedValueOnce({ _id: "file-abc", status: "completed", ragVectors: [] })
      .mockResolvedValueOnce({ _id: "file-abc", status: "completed", ragVectors: [{ _id: "vec-1", fileStatus: "pending" }] })
      .mockResolvedValueOnce({ _id: "file-abc", status: "completed", ragVectors: [{ _id: "vec-1", fileStatus: "indexed" }] });

    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "upload", filePath,
      "--targets", "vec-1",
      "--wait",
      "--poll-interval", "5",
    ]);

    expect(mockGet).toHaveBeenCalledTimes(3);
    setTimeoutSpy.mockRestore();
    (isJsonMode as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it("passes --chunking-tool through to the multipart upload fields", async () => {
    const cli = createCli();
    await cli.parseAsync([
      "node", "cli",
      "rag", "upload", filePath,
      "--targets", "vec-1",
      // liteparse-langextract, NOT bare "liteparse" — bare "liteparse" is not
      // a registered server-side chunker (see rejection test below) and
      // previously this fixture enshrined it as if it were accepted, hiding
      // the real 400 every actual invocation hit.
      "--chunking-tool", "liteparse-langextract",
    ]);

    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [, , , fields] = mockUpload.mock.calls[0];
    expect(fields).toMatchObject({ chunkingTool: "liteparse-langextract" });
  });

  it("rejects bare --chunking-tool liteparse client-side instead of sending a value the server 400s on", async () => {
    const cli = createCli();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await cli.parseAsync([
        "node", "cli",
        "rag", "upload", filePath,
        "--targets", "vec-1",
        "--chunking-tool", "liteparse",
      ]);
    } catch {
      // process.exit threw — expected
    }

    expect(mockUpload).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("accepts every value it advertises as valid", async () => {
    for (const tool of VALID_UPLOAD_CHUNKING_TOOLS) {
      mockUpload.mockClear();
      const cli = createCli();
      await cli.parseAsync([
        "node", "cli",
        "rag", "upload", filePath,
        "--targets", "vec-1",
        "--chunking-tool", tool,
      ]);
      expect(mockUpload).toHaveBeenCalledTimes(1);
      const [, , , fields] = mockUpload.mock.calls[0];
      expect(fields).toMatchObject({ chunkingTool: tool });
    }
  });
});

/**
 * The public mirror (github.com/Divinci-AI/sdk) carries no server source, so
 * this contract can only be checked in the monorepo. scripts/oss/export-sdk.py
 * writes `.oss-mirror` at the mirror's root; that marker, and nothing else,
 * turns the block off. In the monorepo a missing registry still throws.
 */
const IN_PUBLIC_MIRROR = existsSync(join(__dirname, "../../../../../../.oss-mirror"));

describe.skipIf(IN_PUBLIC_MIRROR)("rag upload — chunking-tool contract", () => {
  /**
   * DERIVED from the server registry, not hand-copied.
   *
   * This block used to hold a hardcoded mirror with a comment asking the next
   * person to keep it in sync. It rotted the first time it was tested: the
   * record-chunker was registered server-side on 2026-08-13 and the mirror was
   * never updated, so the suite went red on `preview` and STAYED red.
   *
   * Two things made that worse than a stale list. The assertion is
   * `CLI subset of SERVER`, so a stale SERVER list accuses the CLI of
   * advertising something unregistered -- it pointed at the innocent side. And
   * a permanently-red test is not a test; it is training to ignore the suite.
   *
   * So the list is read from the registry SOURCE. The CLI package cannot import
   * @divinci-ai/server-resources (a heavy backend package with its own env
   * requirements), but it can read the file, and reading the source of truth is
   * the difference between a contract test and two copies of an opinion.
   */
  // vitest still runs a skipped describe's body to collect it, so the
  // lookups below must stand down too, or the mirror throws at collection.
  const REGISTRY_DIR = (() => {
    if (IN_PUBLIC_MIRROR) return "";
    let dir = __dirname;
    for (let i = 0; i < 12; i++) {
      const candidate = join(dir, "workspace/resources/server-resources/src/tools/rag/raw-to-chunks");
      if (existsSync(candidate)) return candidate;
      dir = join(dir, "..");
    }
    // Loudly, never a skip: a contract test that quietly stops checking is
    // indistinguishable from one that passes, and this file has already been
    // wrong once in exactly that direction.
    throw new Error("could not locate raw-to-chunks registry from " + __dirname);
  })();

  /** Mirrors normalizeChunkingToolId() in create-file/direct.ts. */
  function toShortName(id: string): string {
    return id.replace(/^@divinci-ai\//, "").replace(/^@/, "");
  }

  const SERVER_REGISTERED_SHORT_NAMES = (() => {
    if (IN_PUBLIC_MIRROR) return [] as string[];
    const index = readFileSync(join(REGISTRY_DIR, "index.ts"), "utf8");
    // Strip line comments first: a chunker is just as effectively unregistered
    // by commenting its .add(...) out as by deleting it, and a parser that
    // matched commented text would report it as still available.
    const live = index
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    const registered = [...live.matchAll(/RAWFILE_TO_CHUNKS\.add\(\s*(\w+)\.tool/g)].map((m) => m[1]);
    return registered.map((constName) => {
      const imp = new RegExp("import\\s*\\{\\s*" + constName + "\\s*\\}\\s*from\\s*\"\\./([\\w-]+)\"").exec(live);
      if (!imp) throw new Error("no import found for registered chunker " + constName);
      const info = readFileSync(join(REGISTRY_DIR, imp[1], "info.ts"), "utf8");
      const id = /const ID\s*=\s*"([^"]+)"/.exec(info);
      if (!id) throw new Error("no ID constant in " + imp[1] + "/info.ts");
      return toShortName(id[1]);
    });
  })();

it("reads a plausible registry, so a pass means something", () => {
    // Guard the guard: a parser that silently matched nothing would make every
    // assertion below vacuously true.
    expect(SERVER_REGISTERED_SHORT_NAMES.length).toBeGreaterThanOrEqual(4);
    expect(SERVER_REGISTERED_SHORT_NAMES).toContain("openparse");
  });

  it("every value the CLI advertises/accepts for upload is actually registered server-side", () => {
    for (const tool of VALID_UPLOAD_CHUNKING_TOOLS) {
      expect(SERVER_REGISTERED_SHORT_NAMES).toContain(tool);
    }
  });

  it("does not advertise/accept the unregistered bare 'liteparse' value", () => {
    // `liteparse` alone is not a registered chunker -- only the combined
    // `liteparse-langextract` is. Sending the bare value earns a server 400.
    expect(VALID_UPLOAD_CHUNKING_TOOLS).not.toContain("liteparse");
    expect(SERVER_REGISTERED_SHORT_NAMES).not.toContain("liteparse");
  });
});
