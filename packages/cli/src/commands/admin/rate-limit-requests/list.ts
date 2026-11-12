import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../../config/config-manager.js";
import { createClient } from "../../../client/create-client.js";
import { output } from "../../../output/formatter.js";
import { withSpinner } from "../../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../../utils/errors.js";

/**
 * `divinci admin rate-limit-requests list` — platform-admin queue
 * view. Defaults to `status=pending` oldest-first; pass --status to
 * filter by other states or `--status all` for an audit listing.
 *
 * Backed by GET /api/v1/admin/rate-limit-requests. OAuth-only — the
 * server gates with `isPlatformAdmin`, so callers without the role
 * will get HTTP 403.
 */
export function registerAdminRateLimitRequestsListCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List rate-limit upgrade requests across all workspaces (platform admin)")
    .option(
      "--status <status>",
      "Filter by status: pending | approved | denied | applied | withdrawn | all",
      "pending",
    )
    .option("--workspace <id>", "Filter to a specific workspace")
    .option("--limit <n>", "Max results (default 50, max 200)", v => parseInt(v, 10))
    .option("--cursor <c>", "Opaque pagination cursor from a prior call")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const params: Record<string, string> = { status: opts.status };
        if (opts.workspace) params.workspaceId = opts.workspace;
        if (opts.limit) params.limit = String(opts.limit);
        if (opts.cursor) params.cursor = String(opts.cursor);
        const query = new URLSearchParams(params).toString();

        const httpClient = client.getHttpClient();
        const data = await withSpinner("Fetching rate-limit requests...", () =>
          httpClient.get<{ requests: Array<Record<string, unknown>>; nextCursor: string | null }>(
            `/api/v1/admin/rate-limit-requests${query ? `?${query}` : ""}`,
          ),
        );

        output(data.requests, {
          table: {
            columns: [
              { key: "_id", header: "ID" },
              { key: "workspaceId", header: "Workspace" },
              { key: "feature", header: "Feature" },
              { key: "requestedPoints", header: "Pts" },
              { key: "requestedDuration", header: "Win(s)" },
              { key: "status", header: "Status" },
              { key: "requesterAuthMethod", header: "From" },
              { key: "createdAt", header: "Created" },
            ],
          },
        });

        if (data.nextCursor) {
          console.log(`\n  More results available. Pass --cursor ${data.nextCursor} to continue.`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
