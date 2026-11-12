/**
 * `divinci external-tools` command group
 *
 * The third-party RAG ecosystem: register an HTTPS endpoint the workspace
 * controls as a document PARSER (`RAG/Chunker` — raw file in, NDJSON chunks
 * out, once per file) or a search backend (`RAG/Retriever` — JSON query in,
 * JSON results out, on EVERY chat turn against a vector that selected it).
 * Divinci never hosts the code; it only calls the endpoint.
 *
 * Added 2026-09-07. The v1 API, the SDK and MCP had each carried six
 * capabilities since the ecosystem shipped; the CLI had NONE — zero references
 * in the whole package — and nothing failed because of it. Pinned now by
 * scripts/ci/tests/test_external_tool_surface_parity.py.
 *
 * ⚠️ THE CREDENTIAL IS WRITE-ONLY. `--auth-secret` is sent on create/update and
 * is never returned by any read path; a listing shows `hasAuth` instead. It is
 * read from an ENV VAR by default rather than a flag, because a secret in argv
 * is world-readable via `ps`.
 */

import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";
import type { DivinciServer } from "@divinci-ai/server";

async function buildContext(
  opts: { workspace?: string },
  cmd: Command
): Promise<{ client: DivinciServer; workspaceId: string }> {
  const globalOpts = cmd.optsWithGlobals();
  let config = requireConfig(globalOpts);
  requireOAuthAuth(config);
  config = await ensureValidToken(config);
  const client = createClient(config);
  const workspaceId = opts.workspace || config.workspaceId;
  if (!workspaceId) throw new Error("--workspace required (no active workspace set)");
  return { client, workspaceId };
}

/**
 * Resolve the credential without putting it in argv.
 *
 * `ps` is world-readable, and several agents share a developer laptop — a
 * secret passed as `--auth-secret sk-...` is visible to every process on the
 * machine for the lifetime of the command. So the flag names an ENV VAR to
 * read, and the literal form exists only behind an explicit opt-in.
 */
function resolveSecret(opts: { authSecretEnv?: string, authSecretUnsafe?: string }): string | undefined {
  if (opts.authSecretEnv) {
    const value = process.env[opts.authSecretEnv];
    if (!value) throw new Error(`--auth-secret-env ${opts.authSecretEnv} is not set in the environment`);
    return value;
  }
  return opts.authSecretUnsafe;
}

export function registerExternalToolsCommands(group: Command): void {
  group
    .command("list")
    .description("List the workspace's registered external tools")
    .option("-w, --workspace <id>", "Workspace ID")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const tools = await withSpinner("Loading external tools", () =>
          client.externalTools.list(workspaceId));
        if (tools.length === 0) {
          // eslint-disable-next-line no-console
          // eslint-disable-next-line no-console
        console.log(colors.dim("No external tools registered."));
          return;
        }
        output(
          tools.map((t) => ({
            id: t.id,
            type: t.toolType,
            slug: t.slug,
            enabled: t.enabled ? "yes" : "no",
            auth: t.hasAuth ? t.authType : "none",
            health: t.health?.status ?? "unknown",
            endpoint: t.endpointUrl,
          })),
          {
            table: {
              columns: [
                { key: "id", header: "ID" },
                { key: "type", header: "TYPE" },
                { key: "slug", header: "SLUG" },
                { key: "enabled", header: "ENABLED" },
                { key: "auth", header: "AUTH" },
                { key: "health", header: "HEALTH" },
                { key: "endpoint", header: "ENDPOINT" },
              ],
            },
          }
        );
      } catch (error) { handleCommandError(error); }
    });

  group
    .command("get <externalToolId>")
    .description("Show one registered external tool")
    .option("-w, --workspace <id>", "Workspace ID")
    .action(async (externalToolId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const tool = await withSpinner("Loading external tool", () =>
          client.externalTools.get(workspaceId, externalToolId));
        output(tool, { keyValue: true });
      } catch (error) { handleCommandError(error); }
    });

  group
    .command("create")
    .description("Register an external parser or retriever")
    .requiredOption("--type <type>", "RAG/Chunker (parser) or RAG/Retriever (search backend)")
    .requiredOption("--slug <slug>", "Immutable id fragment — lowercase letters, digits, hyphens")
    .requiredOption("--title <title>", "Human-readable name")
    .requiredOption("--endpoint <url>", "https URL Divinci will call (must be publicly resolvable)")
    .option("--description <text>", "What it does")
    .option("--vendor-name <name>", "Vendor name")
    .option("--vendor-url <url>", "Vendor URL")
    .option("--auth-type <type>", "none | bearer | header", "none")
    .option("--auth-header-name <name>", "Header name when --auth-type header")
    .option("--auth-secret-env <VAR>", "Read the credential from this environment variable (preferred)")
    .option("--auth-secret-unsafe <value>", "Credential as a literal — visible in `ps`, avoid")
    .option("--timeout-ms <n>", "Per-call timeout; clamped to the ceiling for the type", (v) => parseInt(v, 10))
    .option("--disabled", "Register without enabling it")
    .option("-w, --workspace <id>", "Workspace ID")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const tool = await withSpinner("Registering external tool", () =>
          client.externalTools.create(workspaceId, {
            toolType: opts.type,
            slug: opts.slug,
            title: opts.title,
            endpointUrl: opts.endpoint,
            description: opts.description,
            vendorName: opts.vendorName,
            vendorUrl: opts.vendorUrl,
            authType: opts.authType,
            authHeaderName: opts.authHeaderName,
            authSecret: resolveSecret(opts),
            timeoutMs: opts.timeoutMs,
            enabled: !opts.disabled,
          }));
        // eslint-disable-next-line no-console
        console.log(colors.green(`Registered ${tool.toolId}`));
        // eslint-disable-next-line no-console
        console.log(colors.dim(`  id           ${tool.id}`));
        // eslint-disable-next-line no-console
        console.log(colors.dim(`  tenant token ${tool.tenantToken}  (sent to the vendor as \`tenant\`)`));
        // eslint-disable-next-line no-console
        console.log(colors.dim(`  credential   ${tool.hasAuth ? "stored (never readable again)" : "none"}`));
        // eslint-disable-next-line no-console
        console.log(colors.dim(`\nRun a health check before pointing a vector at it:`));
        // eslint-disable-next-line no-console
        console.log(colors.dim(`  divinci external-tools health-check ${tool.id}`));
      } catch (error) { handleCommandError(error); }
    });

  group
    .command("update <externalToolId>")
    .description("Update a registration (type and slug are immutable)")
    .option("--title <title>", "Human-readable name")
    .option("--description <text>", "What it does")
    .option("--endpoint <url>", "https URL Divinci will call")
    .option("--auth-type <type>", "none | bearer | header")
    .option("--auth-header-name <name>", "Header name when --auth-type header")
    .option("--auth-secret-env <VAR>", "Read the credential from this environment variable (preferred)")
    .option("--auth-secret-unsafe <value>", "Credential as a literal — visible in `ps`, avoid")
    .option("--timeout-ms <n>", "Per-call timeout", (v) => parseInt(v, 10))
    .option("--enable", "Enable it")
    .option("--disable", "Disable it")
    .option("-w, --workspace <id>", "Workspace ID")
    .action(async (externalToolId, opts, cmd) => {
      try {
        if (opts.enable && opts.disable) throw new Error("--enable and --disable are mutually exclusive");
        const { client, workspaceId } = await buildContext(opts, cmd);
        const tool = await withSpinner("Updating external tool", () =>
          client.externalTools.update(workspaceId, externalToolId, {
            title: opts.title,
            description: opts.description,
            endpointUrl: opts.endpoint,
            authType: opts.authType,
            authHeaderName: opts.authHeaderName,
            authSecret: resolveSecret(opts),
            timeoutMs: opts.timeoutMs,
            enabled: opts.enable ? true : opts.disable ? false : undefined,
          }));
        // eslint-disable-next-line no-console
        console.log(colors.green(`Updated ${tool.toolId}`));
      } catch (error) { handleCommandError(error); }
    });

  group
    .command("health-check <externalToolId>")
    .description("Probe the vendor with a synthetic request and store the verdict")
    .option("-w, --workspace <id>", "Workspace ID")
    .action(async (externalToolId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const tool = await withSpinner("Probing vendor", () =>
          client.externalTools.healthCheck(workspaceId, externalToolId));
        const status = tool.health?.status ?? "unknown";
        const line = `${status}${tool.health?.detail ? ` — ${tool.health.detail}` : ""}`;
        // A reachable vendor that breaks the contract is NOT ok, and the probe
        // says so; print it as a failure rather than dressing it up.
        // eslint-disable-next-line no-console
        console.log(status === "ok" ? colors.green(line) : colors.yellow(line));
      } catch (error) { handleCommandError(error); }
    });

  group
    .command("delete <externalToolId>")
    .description("Delete a registration")
    .option("-w, --workspace <id>", "Workspace ID")
    .action(async (externalToolId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        await withSpinner("Deleting external tool", () =>
          client.externalTools.delete(workspaceId, externalToolId));
        // eslint-disable-next-line no-console
        console.log(colors.green("Deleted."));
        // eslint-disable-next-line no-console
        console.log(colors.dim("Any vector still selecting it will now retrieve nothing."));
      } catch (error) { handleCommandError(error); }
    });
}
