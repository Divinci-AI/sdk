/**
 * `divinci notifications` command group
 *
 * Workspace notifications plus the configuration surfaces for custom
 * notification implementations: delivery channels (email/webhook), delivery
 * triggers (tag → channel routing), and custom LLM-driven flaggers.
 */

import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, outputSuccess } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";
import type { DivinciServer, DeliveryChannelInput } from "@divinci-ai/server";

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
  requireOAuthAuth(config);
  config = await ensureValidToken(config);
  const client = createClient(config);
  const workspaceId = opts.workspace || config.workspaceId;
  if (!workspaceId) throw new Error("--workspace required (no active workspace set)");
  return { client, workspaceId };
}

export function registerNotificationsCommands(parent: Command): void {
  /* ── notifications ──────────────────────────────────────────────── */

  parent
    .command("list")
    .alias("ls")
    .description("List workspace notifications")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--unread", "Only unread notifications")
    .option("--type <type>", "Filter by notification type")
    .option("--tags <tags>", "Comma-separated tag filter")
    .option("--limit <n>", "Max results per page", "25")
    .option("--page <n>", "Page number")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching notifications…", () =>
          client.notifications.list(workspaceId, {
            isRead: opts.unread ? false : undefined,
            type: opts.type,
            tags: opts.tags ? String(opts.tags).split(",") : undefined,
            limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
            page: opts.page ? parseInt(opts.page, 10) : undefined,
          })
        );
        output(result.docs, {
          table: {
            columns: [
              { key: "_id", header: "ID" },
              { key: "notificationType", header: "Type" },
              { key: "title", header: "Title" },
              { key: "isRead", header: "Read" },
              { key: "tags", header: "Tags" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("counts")
    .description("Notification counts (total + unread)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const counts = await withSpinner("Fetching counts…", () =>
          client.notifications.getCounts(workspaceId)
        );
        output(counts, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("mark-read <notificationId>")
    .description("Mark a notification as read (or unread with --unread)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--unread", "Mark as unread instead")
    .action(async (notificationId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        await withSpinner("Updating notification…", () =>
          client.notifications.markAsRead(workspaceId, notificationId, !opts.unread)
        );
        outputSuccess(`Notification ${notificationId} marked ${opts.unread ? "unread" : "read"}.`);
      } catch (error) {
        handleCommandError(error);
      }
    });

  /* ── delivery channels ──────────────────────────────────────────── */

  const channels = parent
    .command("channels")
    .description("Delivery channels — where notifications get sent (email, webhook)");

  channels
    .command("list")
    .alias("ls")
    .description("List delivery channels")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--verified <bool>", "Filter by verified flag (true|false)")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const channelDocs = await withSpinner("Fetching channels…", () =>
          client.notifications.channels.list(workspaceId, {
            verified: opts.verified !== undefined ? opts.verified === "true" : undefined,
          })
        );
        output(channelDocs, {
          table: {
            columns: [
              { key: "_id", header: "ID" },
              { key: "channelName", header: "Name" },
              { key: "deliveryMethod", header: "Method" },
              { key: "verified", header: "Verified" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });

  channels
    .command("create")
    .description("Create a delivery channel (email via --email, webhook via --webhook-url)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .requiredOption("--name <name>", "Channel name")
    .option("--email <address>", "Create an email channel to this address")
    .option("--webhook-url <url>", "Create a webhook channel to this URL")
    .option("--webhook-secret <secret>", "HMAC secret for the webhook (min 32 chars)")
    .option("--webhook-method <method>", "POST or PUT", "POST")
    .option("--webhook-timeout <ms>", "Request timeout 5000–30000 ms", "10000")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);

        let input: DeliveryChannelInput;
        if (opts.email) {
          input = {
            channelName: opts.name,
            deliveryMethod: "email",
            details: { emailAddress: opts.email },
          };
        } else if (opts.webhookUrl) {
          if (!opts.webhookSecret || String(opts.webhookSecret).length < 32) {
            throw new Error("--webhook-secret is required and must be at least 32 characters");
          }
          input = {
            channelName: opts.name,
            deliveryMethod: "webhook",
            details: {
              url: opts.webhookUrl,
              method: opts.webhookMethod === "PUT" ? "PUT" : "POST",
              headers: {},
              secret: opts.webhookSecret,
              retryPolicy: {
                maxRetries: 3,
                backoffType: "exponential",
                initialDelayMs: 1000,
                maxDelayMs: 60000,
              },
              timeout: parseInt(opts.webhookTimeout, 10),
            },
          };
        } else {
          throw new Error("Provide either --email <address> or --webhook-url <url>");
        }

        const channel = await withSpinner("Creating channel…", () =>
          client.notifications.channels.create(workspaceId, input)
        );
        output(channel);
        outputSuccess(
          input.deliveryMethod === "email"
            ? "Channel created. Run `divinci notifications channels verify <id>` to send the verification email."
            : "Webhook channel created."
        );
      } catch (error) {
        handleCommandError(error);
      }
    });

  channels
    .command("verify <channelId>")
    .description("Send a verification email for an email channel")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (channelId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Sending verification email…", () =>
          client.notifications.channels.sendVerificationEmail(workspaceId, channelId)
        );
        output(result, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });

  channels
    .command("test <channelId>")
    .description("Send a test notification to a verified channel")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (channelId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Sending test notification…", () =>
          client.notifications.channels.test(workspaceId, channelId)
        );
        output(result, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });

  channels
    .command("logs <channelId>")
    .description("Recent webhook delivery logs (webhook channels only)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (channelId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const { logs } = await withSpinner("Fetching delivery logs…", () =>
          client.notifications.channels.deliveryLogs(workspaceId, channelId)
        );
        output(logs);
      } catch (error) {
        handleCommandError(error);
      }
    });

  channels
    .command("delete <channelId>")
    .alias("rm")
    .description("Delete a delivery channel")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (channelId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        await withSpinner("Deleting channel…", () =>
          client.notifications.channels.delete(workspaceId, channelId)
        );
        outputSuccess(`Channel ${channelId} deleted.`);
      } catch (error) {
        handleCommandError(error);
      }
    });

  /* ── delivery triggers ──────────────────────────────────────────── */

  const triggers = parent
    .command("triggers")
    .description("Delivery triggers — tag-matching rules routing notifications to channels");

  triggers
    .command("list")
    .alias("ls")
    .description("List delivery triggers")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const triggerDocs = await withSpinner("Fetching triggers…", () =>
          client.notifications.triggers.list(workspaceId)
        );
        output(triggerDocs, {
          table: {
            columns: [
              { key: "_id", header: "ID" },
              { key: "title", header: "Title" },
              { key: "triggerByDefault", header: "Default" },
              { key: "channels", header: "Channels" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });

  triggers
    .command("create")
    .description("Create a delivery trigger routing tagged notifications to channels")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .requiredOption("--title <title>", "Trigger title")
    .option("--description <text>", "Description", "")
    .requiredOption("--channels <ids>", "Comma-separated delivery channel ids")
    .option("--any-tags <tags>", "Trigger when ANY of these comma-separated tags match")
    .option("--all-tags <tags>", "Trigger when ALL of these comma-separated tags match")
    .option("--default", "Also trigger for notifications matching no rule")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const rules: Array<
          | { mode: "if-any-tag"; tags: string[]; action: "triggered" | "fail" }
          | { mode: "if-all-tags"; tags: string[]; action: "triggered" | "fail" }
        > = [];
        if (opts.anyTags) {
          rules.push({ mode: "if-any-tag", tags: String(opts.anyTags).split(","), action: "triggered" });
        }
        if (opts.allTags) {
          rules.push({ mode: "if-all-tags", tags: String(opts.allTags).split(","), action: "triggered" });
        }
        const trigger = await withSpinner("Creating trigger…", () =>
          client.notifications.triggers.create(workspaceId, {
            title: opts.title,
            description: opts.description,
            triggerByDefault: Boolean(opts.default),
            rules,
            channels: String(opts.channels).split(","),
          })
        );
        output(trigger);
      } catch (error) {
        handleCommandError(error);
      }
    });

  triggers
    .command("delete <triggerId>")
    .alias("rm")
    .description("Delete a delivery trigger")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (triggerId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        await withSpinner("Deleting trigger…", () =>
          client.notifications.triggers.delete(workspaceId, triggerId)
        );
        outputSuccess(`Trigger ${triggerId} deleted.`);
      } catch (error) {
        handleCommandError(error);
      }
    });
}

/**
 * `divinci flagger` command group — custom LLM-driven notification flaggers.
 */
export function registerFlaggerCommands(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List custom notification flaggers")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const flaggers = await withSpinner("Fetching flaggers…", () =>
          client.notifications.flaggers.list(workspaceId)
        );
        output(flaggers, {
          table: {
            columns: [
              { key: "_id", header: "ID" },
              { key: "title", header: "Title" },
              { key: "assistant", header: "Assistant" },
              { key: "notifyUser", header: "Notify User" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("get <flaggerId>")
    .description("Get a flagger by id")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (flaggerId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const flagger = await withSpinner("Fetching flagger…", () =>
          client.notifications.flaggers.get(workspaceId, flaggerId)
        );
        output(flagger);
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("create")
    .description("Create a custom notification flagger (LLM evaluation → tagged notification)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .requiredOption("--title <title>", "Flagger title")
    .requiredOption("--assistant <id>", "Assistant/model id that runs the evaluation")
    .requiredOption("--prefix <prompt>", "Prompt prefix for the evaluation")
    .option("--icon <emoji>", "Notification icon", "🚩")
    .option("--message <text>", "Notification message", "")
    .option("--tags <tags>", "Comma-separated notification tags", "")
    .option("--output-keys <keys>", "Comma-separated fields to extract from the LLM output", "")
    .option("--flag-input", "Include the user's input in the flagger call")
    .option("--notify-user", "Also notify the end user (not just admins)")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const flagger = await withSpinner("Creating flagger…", () =>
          client.notifications.flaggers.create(workspaceId, {
            title: opts.title,
            notificationIcon: opts.icon,
            notificationMessage: opts.message,
            notificationTags: opts.tags ? String(opts.tags).split(",") : [],
            assistant: opts.assistant,
            prefix: opts.prefix,
            outputKeys: opts.outputKeys ? String(opts.outputKeys).split(",") : [],
            flagInput: Boolean(opts.flagInput),
            notifyUser: Boolean(opts.notifyUser),
          })
        );
        output(flagger);
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("test <flaggerId> <prompt>")
    .description("Test-run a flagger against a sample prompt (billed like a normal LLM call)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (flaggerId, prompt, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Running flagger…", () =>
          client.notifications.flaggers.testRun(workspaceId, flaggerId, prompt)
        );
        output(result);
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("delete <flaggerId>")
    .alias("rm")
    .description("Delete a flagger")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (flaggerId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        await withSpinner("Deleting flagger…", () =>
          client.notifications.flaggers.delete(workspaceId, flaggerId)
        );
        outputSuccess(`Flagger ${flaggerId} deleted.`);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
