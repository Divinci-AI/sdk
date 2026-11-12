import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { registerConnectorsCommands } from "../../../src/commands/connectors/index.js";

/**
 * Connector command surface. The CLI is one of three places connectors are
 * driven from (CLI / API / MCP) and they are expected to stay at parity, so
 * these assert the command set exists and the WordPress option contract —
 * the two things a partial port silently gets wrong.
 */
function buildConnectors(): Command {
  const connectors = new Command("connectors");
  registerConnectorsCommands(connectors);
  return connectors;
}

function find(name: string): Command {
  const cmd = buildConnectors().commands.find((c) => c.name() === name);
  if (!cmd) throw new Error(`no 'connectors ${name}' command`);
  return cmd;
}

function optionFlags(name: string): string[] {
  return find(name).options.map((o) => o.long ?? o.short ?? "");
}

describe("connectors command registration", () => {
  it("registers the full connector lifecycle", () => {
    const names = buildConnectors().commands.map((c) => c.name());
    for (const expected of [
      "web-crawl",
      "wordpress",
      "wordpress-discover",
      "list",
      "status",
      "settings",
      "sync",
      "sync-status",
      "sync-cancel",
      "disconnect",
      "stats",
    ]) {
      expect(names, `missing 'connectors ${expected}'`).toContain(expected);
    }
  });

  it("requires a target vector for wordpress", () => {
    const vector = find("wordpress").options.find((o) => o.long === "--vector");
    expect(vector?.required).toBe(true);
  });

  it("exposes the WordPress ingestion controls", () => {
    const flags = optionFlags("wordpress");
    for (const expected of [
      "--post-types",
      "--username",
      "--app-password",
      "--include-non-published",
      "--limit",
      "--modified-after",
      "--category-slugs",
      "--exclude-slugs",
      "--recurring",
      "--cadence",
      "--swap",
    ]) {
      expect(flags, `missing 'connectors wordpress ${expected}'`).toContain(expected);
    }
  });
});

describe("connectors wordpress credentials", () => {
  const OLD_ENV = process.env.DIVINCI_WP_APP_PASSWORD;

  beforeEach(() => {
    delete process.env.DIVINCI_WP_APP_PASSWORD;
  });

  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.DIVINCI_WP_APP_PASSWORD;
    else process.env.DIVINCI_WP_APP_PASSWORD = OLD_ENV;
    vi.restoreAllMocks();
  });

  /**
   * Driving the action directly would need a live client; what these cover is
   * the argument validation that runs before any network call, by invoking the
   * command and asserting on the error the action surfaces.
   */
  async function runWordPress(argv: string[]): Promise<string> {
    const errors: string[] = [];
    // handleCommandError exits the process; capture the message instead.
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
    const stderr = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      });

    try {
      await buildConnectors().parseAsync(["node", "connectors", ...argv]);
    } catch {
      // exit() or a thrown validation error — the message is what matters.
    } finally {
      exit.mockRestore();
      stderr.mockRestore();
    }
    return errors.join("\n");
  }

  it("rejects a username with no Application Password", async () => {
    const out = await runWordPress([
      "wordpress",
      "https://example.com",
      "--vector",
      "vec-1",
      "--username",
      "editor",
    ]);
    expect(out).toMatch(/Application Password/i);
  });

  // WordPress refuses non-public statuses to anonymous callers, so this
  // combination produces a sync that reports success and ingests nothing.
  // Catching it here beats an empty vector with no explanation.
  it("rejects --include-non-published without credentials", async () => {
    const out = await runWordPress([
      "wordpress",
      "https://example.com",
      "--vector",
      "vec-1",
      "--include-non-published",
    ]);
    expect(out).toMatch(/include-non-published requires/i);
  });
});

describe("connectors settings", () => {
  it("exposes the recurring-sync switches", () => {
    const flags = optionFlags("settings");
    expect(flags).toContain("--auto-sync");
    expect(flags).toContain("--cadence");
  });

  /**
   * The server redacts before sending, but `connectors settings` prints to a
   * terminal whose scrollback outlives the command and is routinely pasted into
   * issues and CI logs. The CLI talks to whatever server its profile points at,
   * including deployments that predate server-side redaction — "the server
   * promised not to send it" is not a control this side can rely on.
   *
   * Asserted against the source because the scrubber is module-private; the
   * behaviour is what matters, and the field list is the part that rots.
   */
  it("never prints a secret field, whatever the server sent", async () => {
    const src = await readFile(
      new URL("../../../src/commands/connectors/index.ts", import.meta.url),
      "utf8"
    );

    // Every field the server encrypts at rest must be scrubbed client-side too.
    for (const field of [
      "applicationPassword",
      "password",
      "cookie",
      "accessToken",
      "refreshToken",
      "secretAccessKey",
      "accessKeyId",
      "serviceAccountKey",
      "clientSecret",
      "webhookSigningSecret",
      "webhookVerificationToken",
    ]) {
      expect(src, `CLI scrubber is missing ${field}`).toContain(`"${field}"`);
    }

    // And the print path must actually go through it — a scrubber that is
    // defined but not called is the failure this test exists to catch.
    expect(src).toContain("scrubSecrets(result.providerSettings");
  });
});
