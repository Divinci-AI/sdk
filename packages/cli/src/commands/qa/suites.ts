import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

// The SDK's `client.qa.listSuites` / `getSuite` hit `/api/v1/qa/...`,
// which is API-key-only — Bearer-authed CLI sessions get 401. Same
// pattern as `qa/runs.ts`: call the OAuth-friendly white-label route
// directly with the access token.

export function registerQASuitesListCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List QA test suites")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const url = `${baseUrl}/white-label/${workspaceId}/scored-qa/suites`;

        const suites = await withSpinner("Fetching QA suites...", async () => {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${config.accessToken}` },
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
          try { return JSON.parse(text) as unknown[]; }
          catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
        });

        output(suites, {
          table: {
            columns: [
              { key: "_id", header: "ID" },
              { key: "name", header: "Name" },
              { key: "tests.length", header: "Tests" },
              { key: "scoreGenerators.length", header: "Scorers" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export function registerQASuitesGetCommand(parent: Command): void {
  parent
    .command("get <suiteId>")
    .description("Get QA suite details")
    .action(async (suiteId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const url = `${baseUrl}/white-label/${workspaceId}/scored-qa/suites/${suiteId}`;

        const suite = await withSpinner("Fetching suite...", async () => {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${config.accessToken}` },
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
          try { return JSON.parse(text) as unknown; }
          catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
        });

        output(suite, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
