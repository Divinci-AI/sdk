import { Command } from "commander";
import { readFileSync } from "node:fs";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import {
  fetchJson,
  flattenMultiTargetMap,
  pollCloneJob,
} from "../workspace/clone-utils.js";

function remapRagRef(
  ref: { id?: string } | undefined,
  map: Record<string, string>,
): { id: string } | undefined {
  if (!ref?.id) return undefined;
  const mapped = map[ref.id];
  return mapped ? { id: mapped } : undefined;
}

/** Fallback when POST .../clone-to is not deployed yet: GET source + POST create on target. */
async function clientSideCloneReleaseToWorkspace(args: {
  baseUrl: string;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  releaseId: string;
  title: string;
  ragVectorIdMap: Record<string, string>;
  assistantToolId?: string;
  authHeader: Record<string, string>;
}): Promise<Record<string, unknown>> {
  const source = await fetchJson<Record<string, unknown>>(
    `${args.baseUrl}/white-label/${args.sourceWorkspaceId}/release/${args.releaseId}`,
    { headers: args.authHeader },
  );

  const slugBase = String(source.slug ?? "release")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const slugSuffix = `-${Date.now()}`;
  const slug = `${slugBase.substring(0, Math.max(1, 50 - slugSuffix.length))}${slugSuffix}`;

  const assistant = args.assistantToolId
    ? { id: args.assistantToolId, finetune: false }
    : source.assistant;

  const body: Record<string, unknown> = {
    slug,
    title: args.title,
    description: source.description,
    allowAnonymousChat: source.allowAnonymousChat,
    maxAnonymousChatMessages: source.maxAnonymousChatMessages,
    requireSignedAnonymousChat: source.requireSignedAnonymousChat,
    assistant,
    fallbackAssistants: source.fallbackAssistants,
    aiGateway: source.aiGateway,
    promptModeration: source.promptModeration,
    notificationFlaggers: source.notificationFlaggers,
    deIdentification: source.deIdentification,
    threadPrefix: source.threadPrefix,
    msgPrefix: source.msgPrefix,
    conversationStarter: source.conversationStarter,
    chatDisclaimer: source.chatDisclaimer,
    chatWelcomeMessage: source.chatWelcomeMessage,
    chatWelcomeMessageOverrides: source.chatWelcomeMessageOverrides,
    ragIndex: remapRagRef(source.ragIndex as { id?: string }, args.ragVectorIdMap),
    ragIndexes: ((source.ragIndexes as Array<{ id?: string }>) ?? [])
      .map((r) => remapRagRef(r, args.ragVectorIdMap))
      .filter(Boolean),
    hybridSearchConfig: source.hybridSearchConfig,
    contextCache: source.contextCache,
    publicResponseCache: source.publicResponseCache,
    spendCapCentsPerDay: source.spendCapCentsPerDay,
    freeChatGate: source.freeChatGate,
    testingDomains: source.testingDomains,
    mcpConfig: source.mcpConfig,
    supportedLanguages: source.supportedLanguages,
    outputPipelineId: source.outputPipelineId,
    productOutputPipelineId: source.productOutputPipelineId,
    ttsToolOverride: source.ttsToolOverride,
    ttsVoiceOverride: source.ttsVoiceOverride,
    ttsConfigOverride: source.ttsConfigOverride,
    voiceTransport: source.voiceTransport,
    showRagContextTags: source.requireRagContext,
    ragContextDisplayMode: source.ragContextDisplayMode,
  };

  return fetchJson<Record<string, unknown>>(
    `${args.baseUrl}/white-label/${args.targetWorkspaceId}/release/`,
    {
      method: "POST",
      headers: { ...args.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function cloneReleaseToWorkspace(args: {
  baseUrl: string;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  releaseId: string;
  title: string;
  ragVectorIdMap: Record<string, string>;
  assistantToolId?: string;
  authHeader: Record<string, string>;
}): Promise<Record<string, unknown>> {
  const url = `${args.baseUrl}/white-label/${args.sourceWorkspaceId}/release/${args.releaseId}/clone-to`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...args.authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({
      targetWhitelabelId: args.targetWorkspaceId,
      title: args.title,
      ragVectorIdMap: args.ragVectorIdMap,
      ...(args.assistantToolId ? { assistantToolId: args.assistantToolId } : {}),
    }),
  });
  const text = await res.text();
  if (res.status === 404 || res.status === 501) {
    return clientSideCloneReleaseToWorkspace(args);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Non-JSON response: ${text.substring(0, 200)}`);
  }
}

/**
 * Clone a release into another workspace (remaps RAG vector ids).
 * Same-workspace: delegates to fork (POST .../fork).
 */
export function registerReleaseCloneCommand(parent: Command): void {
  parent
    .command("clone <releaseId>")
    .description(
      "Clone a release into another workspace (draft).\n" +
      "Use after `divinci workspace clone` to remap RAG ids via --from-clone-job or --rag-id-map.",
    )
    .requiredOption("--to-workspace <id>", "Target workspace ObjectId")
    .requiredOption("--name <name>", "Title for the new release draft")
    .option("--from-workspace <id>", "Source workspace (default: active workspace)")
    .option(
      "--from-clone-job <jobId>",
      "Workspace clone job id — loads multiTargetMap for RAG id remapping",
    )
    .option(
      "--rag-id-map <json>",
      'Manual RAG remap JSON: {"<sourceVectorId>":"<targetVectorId>",...}',
    )
    .option("--rag-id-map-file <path>", "JSON file with rag id map (same shape as --rag-id-map)")
    .option("--assistant-id <toolId>", "Override assistant model on the new release")
    .option("--wait-for-clone-job", "With --from-clone-job: poll until the clone job completes first")
    .action(async (releaseId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const defaultWorkspaceId = requireWorkspaceId(config);
        const sourceWorkspaceId = opts.fromWorkspace ?? defaultWorkspaceId;
        const targetWorkspaceId = opts.toWorkspace;
        const baseUrl = config.apiUrl.replace(/\/+$/, "");

        if (config.authType !== "oauth" || !config.accessToken) {
          throw new Error("Release clone requires OAuth. Run `divinci auth login`.");
        }
        const authHeader = { Authorization: `Bearer ${config.accessToken}` };

        // Same workspace → existing fork endpoint
        if (sourceWorkspaceId === targetWorkspaceId) {
          const data = await withSpinner(`Forking release ${releaseId}...`, () =>
            fetchJson<Record<string, unknown>>(
              `${baseUrl}/white-label/${sourceWorkspaceId}/release/${releaseId}/fork`,
              {
                method: "POST",
                headers: { ...authHeader, "Content-Type": "application/json" },
                body: JSON.stringify({
                  title: opts.name,
                  ...(opts.assistantId ? { assistantToolId: opts.assistantId } : {}),
                }),
              },
            ),
          );
          output(data, { keyValue: true });
          return;
        }

        let ragVectorIdMap: Record<string, string> = {};

        if (opts.ragIdMapFile) {
          const raw = readFileSync(opts.ragIdMapFile, "utf-8");
          ragVectorIdMap = JSON.parse(raw) as Record<string, string>;
        } else if (opts.ragIdMap) {
          ragVectorIdMap = JSON.parse(opts.ragIdMap) as Record<string, string>;
        }

        if (opts.fromCloneJob) {
          let job = await fetchJson<{ status: string; multiTargetMap?: Record<string, string[]> }>(
            `${baseUrl}/white-label/${sourceWorkspaceId}/clone/${opts.fromCloneJob}/status`,
            { headers: authHeader },
          );
          if (opts.waitForCloneJob && job.status !== "completed" && job.status !== "partial") {
            job = await pollCloneJob({
              baseUrl,
              sourceWorkspaceId,
              jobId: opts.fromCloneJob,
              accessToken: config.accessToken,
            });
          }
          if (job.status !== "completed" && job.status !== "partial") {
            throw new Error(
              `Clone job ${opts.fromCloneJob} is not complete (status=${job.status}). Pass --wait-for-clone-job or run workspace clone --wait.`,
            );
          }
          ragVectorIdMap = { ...ragVectorIdMap, ...flattenMultiTargetMap(job.multiTargetMap) };
        }

        if (Object.keys(ragVectorIdMap).length === 0) {
          throw new Error(
            "Cross-workspace release clone requires RAG id remapping. Pass --from-clone-job <jobId> or --rag-id-map '{\"old\":\"new\"}'.",
          );
        }

        const data = await withSpinner(
          `Cloning release ${releaseId} → workspace ${targetWorkspaceId}...`,
          () =>
            cloneReleaseToWorkspace({
              baseUrl,
              sourceWorkspaceId,
              targetWorkspaceId,
              releaseId,
              title: opts.name,
              ragVectorIdMap,
              assistantToolId: opts.assistantId,
              authHeader,
            }),
        );

        if (isJsonMode()) {
          output(data);
          return;
        }

        const newId = (data as { _id?: string })._id;
        console.log(colors.green("Release cloned to target workspace (draft)."));
        if (newId) {
          console.log(`  ${colors.dim("New release ID:")} ${colors.cyan(newId)}`);
          console.log(`  ${colors.dim("Editor:")} ${baseUrl.replace("api.", "chat.")}/white-label/${targetWorkspaceId}/release/${newId}`);
        }
        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
