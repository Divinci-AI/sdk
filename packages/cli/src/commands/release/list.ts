import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

interface Release {
  _id: string;
  title?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

// The SDK's `client.releases.list` hits `/api/v1/whitelabel/.../releases`,
// which is API-key-only — Bearer-authed CLI sessions get 404. Same
// pattern as `qa/runs.ts`: hit the OAuth-friendly white-label route
// directly with the access token.

export function registerReleaseListCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List releases")
    .option("--status <status>", "Filter by status (draft, published, archived)")
    .option("--limit <number>", "Maximum results", "20")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const limit = Math.max(1, parseInt(opts.limit, 10) || 20);
        const params = new URLSearchParams();
        if (opts.status) params.set("status", String(opts.status));
        const url = `${baseUrl}/white-label/${workspaceId}/release${params.toString() ? `?${params}` : ""}`;

        const releases = await withSpinner("Fetching releases...", async () => {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${config.accessToken}` },
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
          try { return JSON.parse(text) as Release[]; }
          catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
        });

        // The OAuth handler returns the full list with no server-side pagination —
        // honor --limit client-side so the SDK and CLI behave the same way.
        const limited = releases.slice(0, limit);

        output(limited, {
          table: {
            columns: [
              { key: "_id", header: "ID" },
              { key: "title", header: "Title" },
              { key: "status", header: "Status" },
              { key: "createdAt", header: "Created" },
              { key: "updatedAt", header: "Updated" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
