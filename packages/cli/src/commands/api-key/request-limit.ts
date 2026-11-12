import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci api-key request-limit <api-key-id>` — submit a rate-limit
 * upgrade request for a specific api-key (or the entire workspace
 * when --workspace-wide is passed). Backed by:
 *
 *   POST /api/v1/workspaces/:wsId/rate-limit-requests
 *
 * The endpoint accepts OAuth (workspace owner) or any api-key that
 * holds the `limits:request` permission. The CLI uses OAuth via
 * the current profile.
 */
export function registerApiKeyRequestLimitCommand(parent: Command): void {
  parent
    .command("request-limit [apiKeyId]")
    .description(
      "Submit a rate-limit upgrade request. Pass an api-key id to scope " +
      "the request to a single key, or --workspace-wide to request a " +
      "default-tier bump for every key in the workspace."
    )
    .option("--workspace-wide", "Request an upgrade for the whole workspace instead of a specific key")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .requiredOption("--feature <feature>", "Feature key to upgrade (e.g. fileUpload, ragSearch, fineTune)")
    .requiredOption("--points <points>", "Requested point quota (integer > 0)", v => parseInt(v, 10))
    .requiredOption(
      "--duration <seconds>",
      "Window size in seconds (>= 60). For a daily quota use 86400.",
      v => parseInt(v, 10),
    )
    .requiredOption("--reason <text>", "Justification — required, helps the admin decide")
    .action(async (apiKeyIdArg, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = opts.workspace || requireWorkspaceId(config);
        const client = createClient(config);

        // Reject conflicting flags.
        if (apiKeyIdArg && opts.workspaceWide) {
          throw new Error("Pass either an api-key id OR --workspace-wide, not both.");
        }
        if (!apiKeyIdArg && !opts.workspaceWide) {
          throw new Error("Pass an api-key id (single-key scope) or --workspace-wide (all keys).");
        }

        if (!Number.isInteger(opts.points) || opts.points <= 0) {
          throw new Error("--points must be a positive integer.");
        }
        if (!Number.isInteger(opts.duration) || opts.duration < 60) {
          throw new Error("--duration must be an integer >= 60 seconds.");
        }

        const body = {
          apiKeyId: apiKeyIdArg ?? null,
          feature: opts.feature,
          requestedPoints: opts.points,
          requestedDuration: opts.duration,
          justification: opts.reason,
        };

        const httpClient = client.getHttpClient();
        const data = await withSpinner("Submitting rate-limit request...", () =>
          httpClient.post<Record<string, unknown>>(
            `/api/v1/workspaces/${workspaceId}/rate-limit-requests`,
            body,
          ),
        );

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
