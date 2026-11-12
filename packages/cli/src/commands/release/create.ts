import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import { parseFallbackAssistants } from "./update.js";

export function registerReleaseCreateCommand(parent: Command): void {
  parent
    .command("create")
    .description("Create a new release")
    .requiredOption("--name <name>", "Name for the release")
    .option("--from <releaseId>", "Fork an existing release as the starting point — copies RAG, moderation, prefixes, assistant config, etc.")
    .option("--assistant-id <toolId>", "AI Model (assistant tool ID, e.g. 'gemini-3.5-flash'). On a fresh create, sets the release's assistant (else the workspace's defaultAssistant is used). With --from, overrides the forked release's assistant.")
    .option(
      "--fallback-assistants <json>",
      "Ordered fallback model chain as JSON, e.g. '[{\"id\":\"@cf/google/gemma-4-26b-a4b-it\",\"finetune\":false}]' (max 5). A release created WITHOUT one is single-model: if its provider fails, the release is simply dark. Not supported with --from, which inherits the parent's chain.",
    )
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        // --from forks server-side and inherits the parent's chain; there is no
        // field on that endpoint to override it. Refusing beats accepting the
        // flag and silently dropping it, which is how --catalog-skills shipped
        // inert.
        if (opts.from && opts.fallbackAssistants !== undefined) {
          throw new Error(
            "--fallback-assistants cannot be combined with --from: a fork inherits the parent "
            + "release's chain. Create the fork, then set the chain with `release update "
            + "<id> --fallback-assistants`.",
          );
        }

        if (opts.from) {
          // Fork path: server-side fork endpoint copies all config from the
          // parent release; optional assistantToolId override swaps just the
          // AI Model selection on the new draft.
          const httpClient = client.getHttpClient();
          const data = await withSpinner(
            opts.assistantId
              ? `Forking release ${opts.from} (override assistant=${opts.assistantId})...`
              : `Forking release ${opts.from}...`,
            () => httpClient.post<Record<string, unknown>>(
              `/white-label/${workspaceId}/release/${opts.from}/fork`,
              {
                title: opts.name,
                ...(opts.assistantId ? { assistantToolId: opts.assistantId } : {}),
              },
            )
          );
          output(data, { keyValue: true });
          return;
        }

        // Default path: create a fresh draft via the OAuth admin endpoint
        // (POST /white-label/:ws/release -> createReleaseDraft), the same surface
        // `release list` and the fork branch above use. We deliberately do NOT
        // call client.releases.create() here: that targets the api-key-only
        // /api/v1/releases route (requireAPIKey + requirePermissions), which
        // returns 401 under the CLI's OAuth auth. `assistant` is required by the
        // release schema, so resolve one — the --assistant-id override, else the
        // workspace's configured defaultAssistant (mirrors the web New Release form).
        let assistantId: string | undefined = opts.assistantId;
        if (!assistantId) {
          const ws = await client.workspaces.get(workspaceId);
          assistantId = (ws as { defaultAssistant?: { id?: string } } | null)?.defaultAssistant?.id;
        }
        if (!assistantId) {
          throw new Error(
            "This workspace has no default assistant, so a release can't be created with just a name. " +
            "Pass --assistant-id <toolId> (an AI model id, e.g. 'gemini-3.5-flash').",
          );
        }
        const httpClient = client.getHttpClient();
        const data = await withSpinner("Creating release...", () =>
          httpClient.post<Record<string, unknown>>(
            `/white-label/${workspaceId}/release`,
            {
              // createReleaseDraft (via castDraftBody) requires a full ReleaseInput,
              // so we send the same defaults the web New Release form does. Empty
              // slug → the server derives a unique one from the title.
              slug: "",
              title: opts.name,
              description: "",
              allowAnonymousChat: false,
              maxAnonymousChatMessages: 1,
              assistant: { id: assistantId, finetune: false },
              ...(opts.fallbackAssistants !== undefined
                ? { fallbackAssistants: parseFallbackAssistants(String(opts.fallbackAssistants)) }
                : {}),
              promptModeration: {
                noHarmful: { title: "Message considered harmful", on: true },
                onTopic: { title: "Message considered off topic", minimumContext: 0, minimumTokens: 0 },
                custom: [],
              },
              notificationFlaggers: {
                custom: [],
                helpRequests: { enabled: false },
              },
            },
          )
        );
        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
