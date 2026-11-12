/**
 * `divinci user-skills` command group
 *
 * Owner-scoped (end-user) skill instances — today the only integration is
 * `email-user` (send email to yourself + your org via Divinci's CF worker).
 *
 * These live on a DIFFERENT route than release-owned skills
 * (/white-label/:id/skills): `/white-label/:id/user-skills`. Every instance is
 * owned by the authenticated end user (enforced server-side), so a user only
 * ever sees/manages their own. Recipient scoping (self + org) is enforced
 * inside the skill's run(), not here.
 *
 * No typed SDK method exists yet, so we use client.getHttpClient() (raw
 * express-style calls) the same way `release create` does.
 */

import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, outputSuccess } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import type { DivinciServer } from "@divinci-ai/server";

interface CommandContext {
  client: DivinciServer;
  workspaceId: string;
}

async function buildContext(
  opts: { workspace?: string },
  cmd: Command
): Promise<CommandContext> {
  const globalOpts = cmd.optsWithGlobals();
  let config = requireConfig(globalOpts);
  config = await ensureValidToken(config);
  const client = createClient(config);
  const workspaceId = opts.workspace || config.workspaceId;
  if (!workspaceId) throw new Error("--workspace required (no active workspace set)");
  return { client, workspaceId };
}

export function registerUserSkillsCommands(parent: Command): void {
  /* ── catalog (user-eligible integrations) ──────────────────────── */

  parent
    .command("catalog")
    .description("List user-skill integrations available to install (e.g. email-user)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const http = client.getHttpClient();
        const data = await withSpinner("Fetching user-skill catalog…", () =>
          http.get<Array<Record<string, unknown>>>(
            `/white-label/${workspaceId}/user-skills/catalog`
          )
        );
        output(data, {
          table: {
            columns: [
              { key: "id", header: "Integration" },
              { key: "label", header: "Label" },
              { key: "description", header: "Description" },
              { key: "authType", header: "Auth" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });

  /* ── list (this user's installed instances) ────────────────────── */

  parent
    .command("list")
    .alias("ls")
    .description("List your installed user-skill instances")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const http = client.getHttpClient();
        const data = await withSpinner("Fetching your user-skills…", () =>
          http.get<Array<Record<string, unknown>>>(
            `/white-label/${workspaceId}/user-skills`
          )
        );
        output(data, {
          table: {
            columns: [
              { key: "_id", header: "ID" },
              { key: "integrationId", header: "Integration" },
              { key: "title", header: "Title" },
              { key: "draftState", header: "State" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });

  /* ── get ───────────────────────────────────────────────────────── */

  parent
    .command("get <skillId>")
    .description("Get one user-skill instance by id")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (skillId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const http = client.getHttpClient();
        const data = await withSpinner("Fetching user-skill…", () =>
          http.get<Record<string, unknown>>(
            `/white-label/${workspaceId}/user-skills/${skillId}`
          )
        );
        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });

  /* ── create (install an integration for this user) ─────────────── */

  parent
    .command("create")
    .description("Install a user-skill integration for yourself (e.g. email-user)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .requiredOption("--integration-id <id>", "Catalog integration id (e.g. email-user)")
    .requiredOption("--title <title>", "Display name for this instance")
    .option("--reply-to <email>", "Reply-To address (email-user requires it)")
    .option("--mode <mode>", "Recipient scope (email-user is locked to 'user')", "user")
    .option("--instance-description <text>", "Note to disambiguate multiple instances")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const http = client.getHttpClient();
        const config: Record<string, unknown> = { mode: opts.mode };
        if (opts.replyTo) config.replyTo = opts.replyTo;
        const body: Record<string, unknown> = {
          integrationId: opts.integrationId,
          title: opts.title,
          ...(opts.instanceDescription
            ? { instanceDescription: opts.instanceDescription }
            : {}),
          config,
        };
        const data = await withSpinner("Installing user-skill…", () =>
          http.post<Record<string, unknown>>(
            `/white-label/${workspaceId}/user-skills`,
            body
          )
        );
        output(data, { keyValue: true });
        outputSuccess(
          `User-skill installed. Attach it to a release so the agent can invoke it.`
        );
      } catch (error) {
        handleCommandError(error);
      }
    });

  /* ── delete ────────────────────────────────────────────────────── */

  parent
    .command("delete <skillId>")
    .alias("rm")
    .description("Delete one of your user-skill instances")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (skillId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const http = client.getHttpClient();
        await withSpinner("Deleting user-skill…", () =>
          http.delete<Record<string, unknown>>(
            `/white-label/${workspaceId}/user-skills/${skillId}`
          )
        );
        outputSuccess(`User-skill ${skillId} deleted.`);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
