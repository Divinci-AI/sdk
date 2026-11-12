import { readFileSync } from "node:fs";
import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { colors } from "../../output/colors.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import { acceptTerms, promptAndAcceptTerms, TermsGateDetails } from "../../utils/terms.js";
import { safeLabel } from "../../output/safe-text.js";

type TosGateResponse = {
  required: boolean,
  tosId?: string,
  version?: number,
  title?: string,
  content?: string,
};

type TosDoc = {
  _id: string,
  title: string,
  draftContent: string,
  publishedContent?: string,
  publishedVersion: number,
};

/** Resolve --content / --file into the draft body (at most one). */
function resolveContent(opts: { content?: string, file?: string }): string | undefined {
  if (opts.content && opts.file) throw new Error("Use either --content or --file, not both");
  if (opts.file) return readFileSync(opts.file, "utf8");
  return opts.content;
}

function printDoc(doc: TosDoc): void {
  const state = doc.publishedVersion > 0 ? `published v${doc.publishedVersion}` : "draft only (never published — inert)";
  console.log(`${colors.cyanBold(safeLabel(doc.title))}  ${colors.dim(`[${doc._id}]`)}  ${colors.yellow(state)}`);
}

export function registerTermsCommand(program: Command): void {
  const terms = program
    .command("terms")
    .description("View/accept a release's Terms of Service, and manage the workspace's ToS documents");

  // ---- Admin lifecycle (workspace-scoped) -----------------------------------

  terms
    .command("list")
    .description("List the workspace's Terms of Service documents")
    .action(async (_opts, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const httpClient = createClient(config).getHttpClient();
        const docs = await withSpinner("Listing Terms of Service documents", () =>
          httpClient.get<TosDoc[]>(`/white-label/${workspaceId}/terms-of-service`),
        );
        if (isJsonMode()) return output(docs);
        if (!docs.length) return console.log(colors.dim("No Terms of Service documents yet. Create one: divinci terms create --title <t> --file <md>"));
        docs.forEach(printDoc);
      } catch (error) {
        handleCommandError(error);
      }
    });

  terms
    .command("create")
    .description("Create a Terms of Service document (a draft — inert until published)")
    .requiredOption("--title <title>", "Document title (shown in the acceptance modal)")
    .option("--content <markdown>", "Draft body as an inline string")
    .option("--file <path>", "Read the draft body from a markdown file")
    .action(async (opts: { title: string, content?: string, file?: string }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const httpClient = createClient(config).getHttpClient();
        const draftContent = resolveContent(opts);
        const doc = await withSpinner("Creating Terms of Service document", () =>
          httpClient.request<TosDoc>(`/white-label/${workspaceId}/terms-of-service`, {
            method: "POST",
            body: { title: opts.title, ...(draftContent !== undefined ? { draftContent } : {}) },
          }),
        );
        if (isJsonMode()) return output(doc);
        printDoc(doc);
        console.log(colors.dim(`Publish when ready (forces acceptance): divinci terms publish ${doc._id}`));
        console.log(colors.dim(`Attach to a release draft via its termsOfService field: { "id": "${doc._id}" }`));
      } catch (error) {
        handleCommandError(error);
      }
    });

  terms
    .command("get <tosId>")
    .description("Show a Terms of Service document (draft + published state)")
    .action(async (tosId: string, _opts, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const httpClient = createClient(config).getHttpClient();
        const doc = await httpClient.get<TosDoc>(`/white-label/${workspaceId}/terms-of-service/${tosId}`);
        if (isJsonMode()) return output(doc);
        printDoc(doc);
        console.log("");
        console.log(doc.draftContent || "(empty draft)");
      } catch (error) {
        handleCommandError(error);
      }
    });

  terms
    .command("update <tosId>")
    .description("Update a document's draft title/content (never bumps the published version)")
    .option("--title <title>", "New title")
    .option("--content <markdown>", "New draft body as an inline string")
    .option("--file <path>", "Read the new draft body from a markdown file")
    .action(async (tosId: string, opts: { title?: string, content?: string, file?: string }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const httpClient = createClient(config).getHttpClient();
        const draftContent = resolveContent(opts);
        if (opts.title === undefined && draftContent === undefined) {
          throw new Error("Nothing to update — pass --title, --content, or --file");
        }
        const doc = await withSpinner("Updating Terms of Service draft", () =>
          httpClient.request<TosDoc>(`/white-label/${workspaceId}/terms-of-service/${tosId}`, {
            method: "PATCH",
            body: {
              ...(opts.title !== undefined ? { title: opts.title } : {}),
              ...(draftContent !== undefined ? { draftContent } : {}),
            },
          }),
        );
        if (isJsonMode()) return output(doc);
        printDoc(doc);
      } catch (error) {
        handleCommandError(error);
      }
    });

  terms
    .command("publish <tosId>")
    .description("Publish the draft — bumps the version; EVERY user must re-accept before chatting")
    .option("--yes", "Skip the confirmation prompt")
    .action(async (tosId: string, opts: { yes?: boolean }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const httpClient = createClient(config).getHttpClient();
        if (!opts.yes) {
          console.log(colors.yellow("Publishing bumps the version: all prior acceptances stop matching, and every user of releases referencing this document must accept again before chatting."));
          console.log(colors.yellow("Re-run with --yes to confirm."));
          process.exit(1);
        }
        const doc = await withSpinner("Publishing Terms of Service", () =>
          httpClient.request<TosDoc>(`/white-label/${workspaceId}/terms-of-service/${tosId}/publish`, {
            method: "POST",
            body: {},
          }),
        );
        if (isJsonMode()) return output(doc);
        printDoc(doc);
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ---- Consumer gate (per-release) ------------------------------------------

  terms
    .command("show <releaseId>")
    .description("Show the Terms of Service gate for a release (and whether you still need to accept)")
    .action(async (releaseId: string, _opts, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();

        const gate = await httpClient.get<TosGateResponse>(
          `/white-label-release/${releaseId}/terms-of-service`,
        );

        if (isJsonMode()) {
          output(gate);
          return;
        }

        if (!gate.required) {
          console.log(colors.dim("No acceptance required — either no published Terms of Service, or you already accepted the current version."));
          return;
        }
        console.log(colors.cyanBold(`${gate.title || "Terms of Service"} (v${gate.version})`));
        console.log("");
        console.log(gate.content || "(no content)");
        console.log("");
        console.log(colors.yellow(`You must accept v${gate.version} before chatting: divinci terms accept ${releaseId}`));
      } catch (error) {
        handleCommandError(error);
      }
    });

  terms
    .command("accept <releaseId>")
    .description("Accept the current published Terms of Service for a release")
    .option("--yes", "Accept without the interactive confirmation (non-TTY/script use)")
    .action(async (releaseId: string, opts: { yes?: boolean }, cmd: Command) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();

        const gate = await httpClient.get<TosGateResponse>(
          `/white-label-release/${releaseId}/terms-of-service`,
        );

        if (!gate.required) {
          console.log(colors.dim("Nothing to accept — no published Terms of Service, or already accepted."));
          return;
        }
        if (!gate.tosId || typeof gate.version !== "number") {
          throw new Error("Malformed gate response from the server");
        }

        const details: TermsGateDetails = {
          tosId: gate.tosId,
          version: gate.version,
          title: gate.title,
          content: gate.content,
          releaseId,
        };

        if (opts.yes) {
          await acceptTerms(httpClient, details);
          console.log(colors.dim(`Accepted Terms of Service v${gate.version}.`));
          return;
        }

        const accepted = await promptAndAcceptTerms(httpClient, details);
        if (!accepted) {
          console.error(colors.red("Not accepted. Use --yes for non-interactive acceptance."));
          process.exit(1);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
