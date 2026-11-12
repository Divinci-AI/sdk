import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../config/config-manager.js";
import { createClient } from "../client/create-client.js";
import { output } from "../output/formatter.js";
import { withSpinner } from "../output/spinner.js";
import { handleCommandError } from "../utils/errors.js";

export function registerApiCommand(program: Command): void {
  program
    .command("api <method> <path>")
    .description("Make a raw API request")
    .option("--body <json>", "Request body (JSON string)")
    .option("--param <key=value...>", "Query parameters")
    .action(async (method, path, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();

        const normalizedMethod = method.toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

        let body: unknown;
        if (opts.body) {
          try {
            body = JSON.parse(opts.body);
          } catch {
            throw new Error(`Invalid JSON body: ${opts.body}`);
          }
        }

        const params: Record<string, string> = {};
        if (opts.param) {
          for (const param of opts.param) {
            const [key, ...rest] = param.split("=");
            params[key] = rest.join("=");
          }
        }

        const result = await withSpinner(`${normalizedMethod} ${path}`, () =>
          httpClient.request(path, {
            method: normalizedMethod,
            body,
            params: Object.keys(params).length > 0 ? params : undefined,
          })
        );

        output(result);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
