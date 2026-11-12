import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../../config/config-manager.js";
import { createClient } from "../../../client/create-client.js";
import { output } from "../../../output/formatter.js";
import { colors } from "../../../output/colors.js";
import { withSpinner } from "../../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../../utils/errors.js";

/**
 * `divinci admin rate-limit-requests decide <id>` — platform-admin
 * approve or deny. On approval with single-key scope, the server
 * auto-PATCHes the target api-key's customLimits in the same call
 * and returns applyOutcome="applied".
 *
 * Backed by PATCH /api/v1/admin/rate-limit-requests/:id. OAuth-only.
 */
export function registerAdminRateLimitRequestsDecideCommand(parent: Command): void {
  parent
    .command("decide <requestId>")
    .description("Approve or deny a pending rate-limit request (platform admin)")
    .option("--approve", "Approve the request (auto-applies on single-key scope)")
    .option("--deny", "Deny the request")
    .option("--note <text>", "Optional decision note attached to the audit log + record")
    .action(async (requestId, opts, cmd) => {
      try {
        if (Boolean(opts.approve) === Boolean(opts.deny)) {
          throw new Error("Pass exactly one of --approve or --deny.");
        }
        if (!/^[a-f0-9]{24}$/.test(requestId)) {
          throw new Error("requestId must be a 24-char hex ObjectId.");
        }

        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const action = opts.approve ? "approve" : "deny";
        const body: Record<string, unknown> = { action };
        if (opts.note) body.decisionNote = opts.note;

        const httpClient = client.getHttpClient();
        const data = await withSpinner(
          `${action === "approve" ? "Approving" : "Denying"} request ${requestId}...`,
          () => httpClient.patch<{
            request: Record<string, unknown>;
            applyOutcome: "applied" | "apply_failed" | "skipped" | "n/a";
            applyError?: string;
          }>(`/api/v1/admin/rate-limit-requests/${requestId}`, body),
        );

        // Surface the apply outcome clearly — that's the operational
        // payload, separate from the request-record state-flip.
        const tone = data.applyOutcome === "apply_failed" ? colors.red : colors.green;
        console.log(`\n  Outcome: ${tone(data.applyOutcome)}`);
        if (data.applyError) {
          console.log(`  Apply error: ${colors.red(data.applyError)}`);
          console.log("  The approval was recorded but the api-key PATCH failed.");
          console.log("  Operator should investigate and either retry or fix manually.\n");
        } else if (data.applyOutcome === "skipped") {
          console.log("  Workspace-wide scope — per-key apply is manual for now.\n");
        }

        output(data.request, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
