import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";
import { readFileSync } from "node:fs";

/**
 * The auth payload, from --auth-file (a path, or "-" for stdin) or --auth.
 * --auth-file keeps the credential out of shell history and `ps`, which every
 * user on the machine can read. A parse error never echoes the input: it is a
 * credential.
 */
export function readAuthPayload(opts: { auth?: string, authFile?: string }, readStdin: () => string = ()=>readFileSync(0, "utf8")): Record<string, unknown> {
  if (opts.auth !== undefined && opts.authFile !== undefined) {
    throw new Error("Pass either --auth or --auth-file, not both.");
  }
  let raw: string;
  let source: string;
  if (opts.authFile !== undefined) {
    raw = opts.authFile === "-" ? readStdin() : readFileSync(opts.authFile, "utf8");
    source = "--auth-file";
  } else if (opts.auth !== undefined) {
    raw = opts.auth;
    source = "--auth";
  } else {
    throw new Error("--auth-file <path|-> (recommended) or --auth <json> is required.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${source} must contain valid JSON (contents not shown: they are a credential).`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function registerByokCreateCommand(parent: Command): void {
  parent
    .command("create")
    .description("Create a new BYOK (provider credentials) record")
    .requiredOption("--name <name>", 'BYOK display name (e.g. "Neo4j Aura (GCP)")')
    .requiredOption("--provider <id>", 'Provider id (e.g. NEO4J_HYBRID, OPENAI, ANTHROPIC, VOYAGE)')
    .option("--auth-file <path>", 'File holding the provider auth payload as JSON, or "-" to read it from stdin (keeps the secret out of shell history and process listings)')
    .option("--auth <json>", 'Provider auth payload as inline JSON. Visible in shell history and `ps`: prefer --auth-file. (e.g. \'{"uri":"neo4j+s://...","username":"neo4j","password":"...","database":"neo4j"}\')')
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--endpoint <url>", "openai-compatible only: your /v1/chat/completions URL (https, port 443). Cannot be changed later.")
    .option("--model <id>", "openai-compatible only: the model id sent to --endpoint. Cannot be changed later.")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const workspaceId = opts.workspace || config.workspaceId;
        if (!workspaceId) throw new Error("--workspace required (no active workspace set)");

        const auth = readAuthPayload(opts);

        const created = await withSpinner("Creating BYOK record (validating against provider)…", () =>
          client.byok.create(workspaceId, {
            name: opts.name,
            providerId: opts.provider,
            auth,
            ...(opts.endpoint ? { customEndpoint: opts.endpoint } : {}),
            ...(opts.model ? { customModel: opts.model } : {}),
          }),
        );

        output(created, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
