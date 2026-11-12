import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

export function registerProposalsListCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List proposals")
    .option("--status <status>", "Filter by status: pending, accepted, rejected, expired")
    .option("--limit <number>", "Maximum results", "20")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const proposals = await withSpinner("Fetching proposals...", () =>
          client.metaHarness.proposals.list({
            status: opts.status,
            limit: parseInt(opts.limit, 10),
          })
        );

        output(proposals, {
          table: {
            columns: [
              { key: "id", header: "ID" },
              { key: "kind", header: "Kind" },
              { key: "status", header: "Status" },
              { key: "title", header: "Title" },
              { key: "lastError", header: "Error" },
              { key: "createdAt", header: "Created" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export function registerProposalsAcceptCommand(parent: Command): void {
  parent
    .command("accept <proposalId>")
    .description("Accept a proposal (triggers its underlying action)")
    .action(async (proposalId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const proposal = await withSpinner("Accepting proposal...", () =>
          client.metaHarness.proposals.accept(proposalId)
        );

        output(proposal, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export function registerProposalsRejectCommand(parent: Command): void {
  parent
    .command("reject <proposalId>")
    .description("Reject a proposal")
    .requiredOption("--reason <reason>", "Reason for rejection (required for audit trail)")
    .action(async (proposalId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);

        const proposal = await withSpinner("Rejecting proposal...", () =>
          client.metaHarness.proposals.reject(proposalId, { reason: opts.reason })
        );

        output(proposal, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
