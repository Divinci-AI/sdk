import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * Workspace-level MCP settings.
 *
 * This is the OUTER switch: `/api/v1/mcp-config/:whitelabelId` returns
 * `{ enabled: false }` and nothing else unless `mcpSettings.enabled` is true, so
 * a release with `mcpConfig.enabled` is still not served until this is on.
 * Configure this first, then `divinci release update --mcp-enabled`.
 *
 * There was no CLI or SDK path to it at all until 2026-08-21, and no read path
 * anywhere — `mcpSettings` appeared in no serializer. So the setting could be
 * written and never confirmed.
 */

interface McpSettingsBody {
  enabled?: boolean;
  billingMode?: "admin" | "end-user";
  globalRateLimit?: { requestsPerMinute?: number; requestsPerDay?: number };
}

async function callMcpSettings(
  config: { apiUrl: string; accessToken?: string },
  workspaceId: string,
  body: McpSettingsBody | null,
): Promise<unknown> {
  // Explicit rather than cast away: an undefined token interpolates to the
  // string "Bearer undefined", which the API rejects with a 401 that reads like
  // an expired session instead of "you are not logged in".
  if (!config.accessToken) {
    throw new Error("Not authenticated — run `divinci auth login` first.");
  }
  const baseUrl = config.apiUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/white-label/${workspaceId}/mcp-settings`;
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  // Never bare .json(): a proxy or an auth redirect returns HTML, and the raw
  // SyntaxError would say nothing about what happened.
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP settings ${body ? "write" : "read"} failed (HTTP ${res.status}): ${text.substring(0, 300)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.substring(0, 200)}`);
  }
}

export function registerWorkspaceMcpSettingsCommand(parent: Command): void {
  parent
    .command("mcp-settings <workspaceId>")
    .description(
      "Read or set workspace MCP settings. This is the OUTER switch — a release's --mcp-enabled does nothing until this is on.",
    )
    .option("--enable", "Serve this workspace's MCP-enabled releases at https://mcp.divinci.app/<workspaceId>/mcp")
    .option("--disable", "Stop serving any release of this workspace over MCP")
    .option("--billing-mode <mode>", "Who pays for MCP traffic: admin | end-user")
    .option("--rate-per-minute <n>", "Workspace-wide MCP requests per minute")
    .option("--rate-per-day <n>", "Workspace-wide MCP requests per day")
    .action(async (workspaceId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);

        // `--enable --disable` is a contradiction, not a precedence puzzle.
        // Guessing which one wins is how someone turns MCP on believing they
        // turned it off.
        if (opts.enable && opts.disable) {
          throw new Error("Pass either --enable or --disable, not both.");
        }

        const body: McpSettingsBody = {};
        if (opts.enable) body.enabled = true;
        if (opts.disable) body.enabled = false;
        if (opts.billingMode !== undefined) {
          if (!["admin", "end-user"].includes(String(opts.billingMode))) {
            throw new Error("--billing-mode must be one of: admin, end-user");
          }
          body.billingMode = String(opts.billingMode) as "admin" | "end-user";
        }
        const posInt = (flag: string, v: unknown) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n <= 0) throw new Error(`--${flag} must be a positive integer`);
          return n;
        };
        if (opts.ratePerMinute !== undefined || opts.ratePerDay !== undefined) {
          body.globalRateLimit = {
            ...(opts.ratePerMinute !== undefined
              ? { requestsPerMinute: posInt("rate-per-minute", opts.ratePerMinute) }
              : {}),
            ...(opts.ratePerDay !== undefined
              ? { requestsPerDay: posInt("rate-per-day", opts.ratePerDay) }
              : {}),
          };
        }

        const writing = Object.keys(body).length > 0;
        if (writing) {
          await withSpinner("Updating MCP settings...", () =>
            callMcpSettings(config, workspaceId, body),
          );
        }

        // ALWAYS read back — including right after a write. The POST response
        // echoes what the handler built, which is not evidence that Mongoose
        // stored it: a field missing from the schema is dropped silently while
        // the route still answers 200. Print the GET, never the echo.
        const readBack = await withSpinner("Reading MCP settings back...", () =>
          callMcpSettings(config, workspaceId, null),
        ) as { mcpSettings?: unknown };

        if (readBack.mcpSettings === null || readBack.mcpSettings === undefined) {
          output(
            { workspaceId, mcpSettings: "not configured" },
            { keyValue: true },
          );
          return;
        }
        output({ workspaceId, ...(readBack.mcpSettings as Record<string, unknown>) }, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
