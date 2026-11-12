/**
 * `divinci connectors` command group
 *
 * Manage data connectors: point one at a website (web_crawl) or a WordPress
 * install (wordpress) and it ingests into a chosen RAG vector, optionally on a
 * recurring schedule. Plus the lifecycle around that — status, settings,
 * on-demand sync, cancel, disconnect. The same surface as the Connectors page
 * in the web app.
 */

import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import type { DivinciServer, WebCrawlSettings, WordPressSettings } from "@divinci-ai/server";
import { followWebCrawl, reportWebCrawlOutcome } from "./web-crawl-follow.js";
import { parseUrlList } from "./url-list.js";
import { readFile } from "node:fs/promises";

async function buildContext(
  opts: { workspace?: string },
  cmd: Command
): Promise<{ client: DivinciServer; workspaceId: string; config: ReturnType<typeof requireConfig> }> {
  const globalOpts = cmd.optsWithGlobals();
  let config = requireConfig(globalOpts);
  // Deliberately NO OAuth guard here. Every /api/v1/connectors route is
  // gated by requirePermissions("connector:read" | "connector:write") from
  // middleware/apikey/api-key-auth -- i.e. it is BUILT for api-key auth.
  // That guard is for endpoints with OAuth-only server middleware (API-key
  // management, which cannot authenticate with an API key). Applying it here
  // blocked the exact auth mode these endpoints were designed for, making
  // every connector command unreachable from an api-key session.
  config = await ensureValidToken(config);
  const client = createClient(config);
  const workspaceId = opts.workspace || config.workspaceId;
  if (!workspaceId) throw new Error("--workspace required (no active workspace set)");
  return { client, workspaceId, config };
}

function csv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

/**
 * Field names that must never be printed, whatever the server sent.
 *
 * Mirrors the server's encryption/redaction lists. Duplicated deliberately:
 * the CLI talks to whatever server the profile points at, including older
 * deployments that predate server-side redaction, and "the server promised not
 * to send it" is not a control this side can rely on.
 */
const SECRET_FIELDS = new Set([
  "applicationPassword",
  "password",
  "cookie",
  "accessToken",
  "refreshToken",
  "secretAccessKey",
  "accessKeyId",
  "serviceAccountKey",
  "clientSecret",
  "apiKey",
  "webhookSigningSecret",
  "webhookVerificationToken",
]);

function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_FIELDS.has(k) && v !== undefined && v !== null && v !== ""
      ? "[redacted]"
      : scrubSecrets(v);
  }
  return out;
}

/**
 * Resolve the WordPress Application Password, preferring the environment over
 * the flag: anything passed in argv is world-readable via `ps` for the life of
 * the process, and this is a credential to a customer's own site.
 */
function wordpressAuth(opts: {
  username?: string;
  appPassword?: string;
}): WordPressSettings["auth"] | undefined {
  const applicationPassword = process.env.DIVINCI_WP_APP_PASSWORD || opts.appPassword;
  if (!opts.username && !applicationPassword) return undefined;
  if (!opts.username || !applicationPassword) {
    throw new Error(
      "WordPress auth needs both --username and an Application Password " +
        "(--app-password, or the DIVINCI_WP_APP_PASSWORD env var)."
    );
  }
  return { username: opts.username, applicationPassword };
}

export function registerConnectorsCommands(parent: Command): void {
  parent
    .command("web-crawl <url>")
    .description(
      "Create (or update) a web_crawl connector and start crawling <url> into a RAG vector"
    )
    .requiredOption("--vector <id>", "Target RAG vector ID the crawl ingests into")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--limit <n>", "Max pages to crawl", "80")
    .option("--feed", "Treat <url> as a sitemap/URL feed instead of a crawl root", false)
    .option("--feed-format <fmt>", "Feed parser (with --feed): sitemap | url-list | json", "sitemap")
    .option(
      "--urls-file <path>",
      "Ingest exactly the URLs in a local file (one per line, or a JSON array) — no hosted feed needed. " +
        "<url> then names the site (e.g. its home page); the list is sent inline"
    )
    .option("--no-sitemap", "Don't follow sitemap.xml during the crawl")
    .option("--subdomains", "Also crawl sub-domains of the root's domain", false)
    .option("--product-catalog", "Build the product catalog from schema.org Product data", false)
    .option("--recurring", "Re-crawl on a recurring schedule", false)
    .option("--cadence <minutes>", "Recurrence cadence in minutes (default 10080 = weekly)")
    .option(
      "--swap",
      "Crawl into a draft vector and swap on success — REQUIRED when the vector backs a published release",
      false
    )
    .option("--allowed-paths <prefixes>", "Comma-separated path prefixes to restrict the crawl to")
    .option("--exclude-paths <prefixes>", "Comma-separated path prefixes to skip")
    .option("--wait", "Follow the crawl until the vector is ready to query, printing progress", false)
    .option("--poll-interval <seconds>", "Polling interval under --wait", "10")
    .option("--timeout <seconds>", "Max time to wait under --wait (the crawl keeps going server-side after)", "900")
    .action(async (url, opts, cmd) => {
      try {
        const { client, workspaceId, config } = await buildContext(opts, cmd);

        const feedUrls = opts.urlsFile ? parseUrlList(await readFile(opts.urlsFile, "utf8")) : undefined;
        const isFeed = Boolean(opts.feed || feedUrls);
        const settings: WebCrawlSettings = feedUrls
          ? {
              mode: "feed",
              feedUrl: url,
              feedFormat: "url-list",
              feedUrls,
              targetVectorId: opts.vector,
            }
          : opts.feed
          ? {
              mode: "feed",
              feedUrl: url,
              feedFormat: opts.feedFormat,
              targetVectorId: opts.vector,
            }
          : {
              mode: "crawl",
              rootUrl: url,
              runSitemap: opts.sitemap !== false,
              targetVectorId: opts.vector,
            };
        if (opts.limit) settings.limit = parseInt(opts.limit, 10);
        // `limit` caps a CRAWL's frontier. A feed has no frontier -- every URL
        // the feed lists is ingested, across continuation hops if it takes
        // more than one budget window -- so the flag is accepted and does
        // nothing here. Say so rather than let an operator believe a 733-URL
        // sitemap was capped at 80. Scope a feed with --allowed-paths /
        // --exclude-paths, which DO filter it.
        // Only when --limit was actually passed: it defaults to 80, so testing
        // the value alone warned on every feed, including every --urls-file run.
        if (isFeed && cmd.getOptionValueSource("limit") === "cli") {
          // eslint-disable-next-line no-console
          console.warn(
            colors.yellow(
              "warning: --limit does not bound a --feed run; the whole feed is " +
                "ingested. Use --allowed-paths / --exclude-paths to scope it."
            )
          );
        }
        if (opts.subdomains) settings.crawlSubdomains = true;
        if (opts.productCatalog) settings.buildProductCatalog = true;
        if (opts.recurring) {
          settings.autoSync = true;
          if (opts.cadence) settings.syncIntervalMinutes = parseInt(opts.cadence, 10);
        }
        if (opts.swap) settings.swapOnSuccess = true;
        const allowed = csv(opts.allowedPaths);
        if (allowed) settings.allowedPaths = allowed;
        const excluded = csv(opts.excludePaths);
        if (excluded) settings.excludePaths = excluded;

        const since = Date.now();
        const result = await withSpinner("Starting web crawl…", () =>
          client.connectors.webCrawlStart(workspaceId, settings)
        );
        if (!opts.wait) {
          output(result, { keyValue: true });
          // eslint-disable-next-line no-console
          console.log(
            colors.dim(
              "\nCrawl queued (runs server-side). Follow it to the end with --wait, or: " +
                "divinci connectors list, then divinci connectors sync-status <connectionId>."
            )
          );
          return;
        }

        const json = isJsonMode();
        const outcome = await followWebCrawl({
          client, config, workspaceId, json,
          vectorId: opts.vector,
          siteUrl: url,
          since,
          pollIntervalSeconds: opts.pollInterval,
          timeoutSeconds: opts.timeout,
        });
        reportWebCrawlOutcome(outcome, opts.vector, json);
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("wordpress-discover <siteUrl>")
    .description(
      "Inspect a WordPress site before connecting it — post types it exposes, timezone, canonical URL"
    )
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--username <user>", "WordPress username (for non-public content)")
    .option(
      "--app-password <pw>",
      "WordPress Application Password. Prefer the DIVINCI_WP_APP_PASSWORD env var — an argv secret is world-readable via ps"
    )
    .action(async (siteUrl, opts, cmd) => {
      try {
        // Resolve credentials before authenticating: a malformed --username /
        // --app-password pair is an argument error, not an auth failure.
        const auth = wordpressAuth(opts);
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Inspecting WordPress site…", () =>
          client.connectors.wordpressDiscover(workspaceId, { siteUrl, auth })
        );

        output(
          {
            name: result.site?.name ?? "—",
            home: result.site?.home ?? "—",
            timezone: result.site?.timezoneString ?? `UTC${result.site?.gmtOffsetHours ?? 0}`,
            resolvedSiteUrl: result.site?.resolvedSiteUrl ?? siteUrl,
            redirected: result.site?.redirected ? "yes" : "no",
          },
          { keyValue: true }
        );

        const types = result.postTypes ?? [];
        if (types.length > 0) {
          // eslint-disable-next-line no-console
          console.log(colors.dim("\nContent post types (pass these to --post-types):"));
          output(
            types.map((t) => ({ restBase: t.restBase, label: t.label ?? "—", name: t.name })),
            {
              table: {
                columns: [
                  { key: "restBase", header: "REST BASE" },
                  { key: "label", header: "LABEL" },
                  { key: "name", header: "NAME" },
                ],
              },
            }
          );
        }

        // A custom post type registered without `show_in_rest: true` is
        // invisible to the REST API entirely, and that is the single most
        // common reason a sync silently produces nothing. Saying so here beats
        // an empty vector with no explanation.
        // eslint-disable-next-line no-console
        console.log(
          colors.dim(
            "\nA post type missing from this list is not REST-exposed (needs show_in_rest: true on the site)."
          )
        );
        if (result.site?.redirected) {
          // eslint-disable-next-line no-console
          console.log(
            colors.dim(
              `The site redirected — connect using ${result.site.resolvedSiteUrl}, ` +
                "or an Application Password will be withheld across the cross-origin hop."
            )
          );
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("wordpress <siteUrl>")
    .description(
      "Create (or update) a wordpress connector and sync a WordPress install into a RAG vector"
    )
    .requiredOption("--vector <id>", "Target RAG vector ID the sync ingests into")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option(
      "--post-types <list>",
      "Comma-separated REST bases to ingest (default: posts,pages). Run wordpress-discover to see what a site exposes"
    )
    .option("--username <user>", "WordPress username (required for non-public content)")
    .option(
      "--app-password <pw>",
      "WordPress Application Password. Prefer the DIVINCI_WP_APP_PASSWORD env var — an argv secret is world-readable via ps"
    )
    .option("--include-non-published", "Also ingest drafts and private posts (requires auth)", false)
    .option("--limit <n>", "Max items per post type")
    .option("--modified-after <iso>", "Only ingest items modified at/after this ISO-8601 instant")
    .option("--category-slugs <list>", "Comma-separated category slugs to restrict to (posts only)")
    .option("--exclude-slugs <list>", "Comma-separated slugs to skip")
    .option("--recurring", "Re-sync on a recurring schedule", false)
    .option("--cadence <minutes>", "Recurrence cadence in minutes (default 1440 = daily)")
    .option(
      "--swap",
      "Sync into a draft vector and swap on success — REQUIRED when the vector backs a published release",
      false
    )
    .action(async (siteUrl, opts, cmd) => {
      try {
        // Validate before buildContext: these are argument errors, and there
        // is no reason to make someone authenticate to be told a flag is wrong.
        const settings: WordPressSettings = {
          siteUrl,
          targetVectorId: opts.vector,
        };
        const postTypes = csv(opts.postTypes);
        if (postTypes) settings.postTypes = postTypes;
        const auth = wordpressAuth(opts);
        if (auth) settings.auth = auth;
        if (opts.includeNonPublished) settings.includeNonPublished = true;
        if (opts.limit) settings.limit = parseInt(opts.limit, 10);
        if (opts.modifiedAfter) settings.modifiedAfter = opts.modifiedAfter;
        const categorySlugs = csv(opts.categorySlugs);
        if (categorySlugs) settings.categorySlugs = categorySlugs;
        const excludeSlugs = csv(opts.excludeSlugs);
        if (excludeSlugs) settings.excludeSlugs = excludeSlugs;
        if (opts.recurring) {
          settings.autoSync = true;
          if (opts.cadence) settings.syncIntervalMinutes = parseInt(opts.cadence, 10);
        }
        if (opts.swap) settings.swapOnSuccess = true;

        // Fail here rather than at the server: includeNonPublished without
        // credentials produces a sync that reports success and returns nothing,
        // because WordPress refuses non-public statuses to anonymous callers.
        if (settings.includeNonPublished && !settings.auth) {
          throw new Error(
            "--include-non-published requires --username and an Application Password " +
              "(WordPress refuses drafts and private posts to anonymous callers)."
          );
        }

        const { client, workspaceId } = await buildContext(opts, cmd);

        const result = await withSpinner("Starting WordPress sync…", () =>
          client.connectors.wordpressStart(workspaceId, settings)
        );
        output(result, { keyValue: true });
        // eslint-disable-next-line no-console
        console.log(
          colors.dim(
            `\nSync queued (runs server-side). Track it: divinci connectors sync-status ${result.connectionId}.`
          )
        );
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("list")
    .alias("ls")
    .description("List the workspace's connector connections (all providers)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching connectors…", () =>
          client.connectors.list(workspaceId)
        );
        const rows = (result.connections ?? []).map((c) => ({
          id: c._id,
          provider: c.provider,
          status: c.connectionStatus,
          recurring: c.syncConfig?.autoSync ? `every ${c.syncConfig.syncIntervalMinutes ?? 1440}m` : "off",
          lastSync: c.syncConfig?.lastSyncAt ?? "—",
          source:
            (c.providerSettings as WebCrawlSettings | undefined)?.rootUrl ??
            (c.providerSettings as WebCrawlSettings | undefined)?.feedUrl ??
            "—",
        }));
        if (rows.length === 0) {
          // eslint-disable-next-line no-console
          console.log(colors.dim("No connectors found."));
          return;
        }
        output(rows, {
          table: {
            columns: [
              { key: "id", header: "ID" },
              { key: "provider", header: "PROVIDER" },
              { key: "status", header: "STATUS" },
              { key: "recurring", header: "RECURRING" },
              { key: "lastSync", header: "LAST SYNC" },
              { key: "source", header: "SOURCE" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("sync-status <connectionId>")
    .description("Sync-job history for a connection (most recent first)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (connectionId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching sync jobs…", () =>
          client.connectors.syncJobs(workspaceId, connectionId)
        );
        const rows = (result.jobs ?? []).map((j) => ({
          id: j._id,
          status: j.status,
          processed: `${j.progress?.processedFiles ?? 0}/${j.progress?.totalFiles ?? 0}`,
          failed: j.progress?.failedFiles ?? 0,
          started: j.startedAt ?? j.createdAt ?? "—",
          completed: j.completedAt ?? "—",
          errors: (j.errorMessages ?? []).slice(0, 2).join("; ") || "—",
        }));
        if (rows.length === 0) {
          // eslint-disable-next-line no-console
          console.log(colors.dim("No sync jobs found for this connection."));
          return;
        }
        output(rows, {
          table: {
            columns: [
              { key: "id", header: "JOB" },
              { key: "status", header: "STATUS" },
              { key: "processed", header: "PAGES" },
              { key: "failed", header: "FAILED" },
              { key: "started", header: "STARTED" },
              { key: "completed", header: "COMPLETED" },
              { key: "errors", header: "ERRORS" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("sync <connectionId>")
    .description("Trigger a sync now for an existing connection")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (connectionId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Triggering sync…", () =>
          client.connectors.syncStart(workspaceId, connectionId)
        );
        output(result, { keyValue: true });
        // eslint-disable-next-line no-console
        console.log(
          colors.dim(`\nTrack it: divinci connectors sync-status ${connectionId}.`)
        );
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("sync-cancel <connectionId>")
    .description("Cancel every pending/running sync job for a connection")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (connectionId, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Cancelling sync jobs…", () =>
          client.connectors.syncCancel(workspaceId, connectionId)
        );
        // eslint-disable-next-line no-console
        console.log(
          result.cancelledCount > 0
            ? `Cancelled ${result.cancelledCount} sync job(s).`
            : colors.dim("No pending or running sync jobs to cancel.")
        );
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("status <provider>")
    .description("Connection status for one provider (e.g. wordpress, web_crawl, google_drive)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (provider, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching status…", () =>
          client.connectors.get(workspaceId, provider)
        );
        if (!result.connected && !result.connection) {
          // eslint-disable-next-line no-console
          console.log(colors.dim(`No ${provider} connection in this workspace.`));
          return;
        }
        const conn = result.connection;
        output(
          {
            id: conn?._id ?? "—",
            provider: conn?.provider ?? provider,
            connected: result.connected ? "yes" : "no",
            status: conn?.connectionStatus ?? "—",
            files: result.fileCount ?? 0,
            recurring: conn?.syncConfig?.autoSync
              ? `every ${conn.syncConfig.syncIntervalMinutes ?? 1440}m`
              : "off",
            lastSync: conn?.syncConfig?.lastSyncAt ?? "—",
          },
          { keyValue: true }
        );
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("settings <provider>")
    .description(
      "Show a provider's settings, or change its recurring-sync schedule with --auto-sync/--cadence"
    )
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .option("--auto-sync <on|off>", "Turn the recurring sync on or off")
    .option("--cadence <minutes>", "Recurrence cadence in minutes (minimum 15)")
    .action(async (provider, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);

        const syncConfig: { autoSync?: boolean; syncIntervalMinutes?: number } = {};
        if (opts.autoSync !== undefined) {
          const raw = String(opts.autoSync).toLowerCase();
          if (!["on", "off", "true", "false"].includes(raw)) {
            throw new Error("--auto-sync takes on|off");
          }
          syncConfig.autoSync = raw === "on" || raw === "true";
        }
        if (opts.cadence !== undefined) {
          const minutes = parseInt(opts.cadence, 10);
          // The server silently ignores anything under 15, which would look
          // like the write succeeded and did nothing.
          if (!Number.isInteger(minutes) || minutes < 15) {
            throw new Error("--cadence must be an integer of at least 15 minutes");
          }
          syncConfig.syncIntervalMinutes = minutes;
        }

        const result =
          Object.keys(syncConfig).length > 0
            ? await withSpinner("Updating settings…", () =>
                client.connectors.updateSettings(workspaceId, provider, { syncConfig })
              )
            : await withSpinner("Fetching settings…", () =>
                client.connectors.settings(workspaceId, provider)
              );

        output(
          {
            autoSync: result.syncConfig?.autoSync ? "on" : "off",
            cadenceMinutes: result.syncConfig?.syncIntervalMinutes ?? 1440,
            targetTypes: Array.isArray(result.syncConfig?.targetTypes)
              ? (result.syncConfig.targetTypes as string[]).join(",")
              : "rag",
          },
          { keyValue: true }
        );
        // eslint-disable-next-line no-console
        console.log(colors.dim("\nProvider settings:"));
        // The server redacts secrets before sending, but this prints to a
        // terminal whose scrollback outlives the command and is routinely
        // pasted into issues and CI logs. Strip locally too, so an older or
        // misconfigured server cannot put a customer's credential on screen.
        output(scrubSecrets(result.providerSettings ?? {}), { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("disconnect <provider>")
    .description("Revoke a provider's connection")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (provider, opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        await withSpinner("Disconnecting…", () =>
          client.connectors.disconnect(workspaceId, provider)
        );
        // eslint-disable-next-line no-console
        console.log(`Disconnected ${provider}.`);
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("stats")
    .description("Connection and sync statistics across every connector in the workspace")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (opts, cmd) => {
      try {
        const { client, workspaceId } = await buildContext(opts, cmd);
        const result = await withSpinner("Fetching stats…", () =>
          client.connectors.stats(workspaceId)
        );
        output(result, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
