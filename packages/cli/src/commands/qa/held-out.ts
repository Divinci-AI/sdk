import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { handleCommandError } from "../../utils/errors.js";
import { SIGNED_IN_ONLY } from "./trust-auth.js";

/**
 * divinci qa held-out <suiteId> on|off
 *
 * Marks a ScoredQA suite as a held-out test set: its questions must never be
 * published, so no TrustBench run on it can be made public. Turning it off
 * needs trustbench:manage-run-visibility in the workspace. Runs already public
 * stay public; the reply says how many.
 */
export function registerQAHeldOutCommand(parent: Command): void {
  parent
    .command("held-out <suiteId> <state>")
    .description("Mark a suite held-out (on) so no TrustBench run on it can be made public, or clear it (off)")
    .action(async (suiteId: string, state: string, _opts, cmd) => {
      try {
        if (state !== "on" && state !== "off") throw new Error("state must be 'on' or 'off'");
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        if (!config.accessToken) throw new Error(SIGNED_IN_ONLY);
        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const res = await fetch(`${baseUrl}/white-label/${workspaceId}/scored-qa/suites/${encodeURIComponent(suiteId)}/held-out`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ heldOut: state === "on" }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
        let data: { heldOut?: boolean; publicRunsStillPublic?: number };
        try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
        if (!globalOpts.json && data.heldOut && (data.publicRunsStillPublic ?? 0) > 0) {
          console.warn(`⚠ ${data.publicRunsStillPublic} run(s) on this suite are already public and stay public until withdrawn.`);
        }
        output(data, { keyValue: !globalOpts.json });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
