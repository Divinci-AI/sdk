import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { safeLabel } from "../../output/safe-text.js";
import {
  fetchJson,
  inferVectorDbType,
  parseCommaSeparatedIds,
  pollCloneJob,
} from "./clone-utils.js";

interface SourceRagVector {
  _id: string;
  title?: string;
  vectorIndexTool?: string;
}

interface CloneStartResponse {
  jobId: string;
  status: string;
}

/**
 * Clone selected RAG vectors from a source workspace into a new workspace,
 * optionally re-embedding with a new model (e.g. EmbeddingGemma).
 *
 * Wraps POST /white-label/:id/clone with selectedRagVectorIds + vectorConfig.
 */
export function registerWorkspaceCloneCommand(parent: Command): void {
  parent
    .command("clone")
    .description(
      "Clone selected RAG vectors into a new workspace (async job).\n" +
      "Re-embed with --embedding-model; use `divinci release clone --to-workspace` after the job completes.",
    )
    .requiredOption("--title <title>", "Title for the new workspace")
    .option(
      "--from-workspace <id>",
      "Source workspace id (default: active workspace from config)",
    )
    .requiredOption(
      "--rag-vector-ids <ids>",
      "Comma-separated source RAG vector ObjectIds to clone",
    )
    .option(
      "--embedding-model <model>",
      "Target embedding model for every selected vector (e.g. @cf/google/embeddinggemma-300m)",
    )
    .option("--description <text>", "Description for the new workspace")
    .option("--include-releases", "Also clone all releases from the source (default: off)")
    .option("--no-auto-queue", "Skip auto-queueing files for re-indexing after clone")
    .option("--wait", "Poll until the clone job completes (up to ~10 min)")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const sourceWorkspaceId = opts.fromWorkspace ?? config.workspaceId;
        if (!sourceWorkspaceId) {
          throw new Error("No source workspace. Pass --from-workspace or run `divinci workspace use <id>`.");
        }
        if (config.authType !== "oauth" || !config.accessToken) {
          throw new Error("Workspace clone requires OAuth. Run `divinci auth login`.");
        }

        const ragVectorIds = parseCommaSeparatedIds(opts.ragVectorIds);
        const authHeader = { Authorization: `Bearer ${config.accessToken}` };

        // Load each source vector so we can infer vector DB type per id.
        const perVectorConfigs: Record<string, { targetVectorDbType: string; targetEmbeddingModel?: string }> = {};
        for (const vid of ragVectorIds) {
          const v = await withSpinner(`Loading source vector ${vid}...`, () =>
            fetchJson<SourceRagVector>(
              `${baseUrl}/white-label/${sourceWorkspaceId}/rag-vector/${vid}`,
              { headers: authHeader },
            ),
          );
          perVectorConfigs[vid] = {
            targetVectorDbType: inferVectorDbType(v.vectorIndexTool),
            ...(opts.embeddingModel ? { targetEmbeddingModel: opts.embeddingModel } : {}),
          };
        }

        const body: Record<string, unknown> = {
          title: opts.title,
          ...(opts.description ? { description: opts.description } : {}),
          selectedRagVectorIds: ragVectorIds,
          resourceSelection: {
            knowledgeBase: true,
            releases: !!opts.includeReleases,
            chatCustomization: false,
            productData: false,
            mediaAI: false,
            pipelines: false,
            agentsMemory: false,
          },
          autoQueueFiles: !opts.noAutoQueue,
        };

        if (opts.embeddingModel) {
          body.vectorConfig = {
            applyToAll: false,
            perVectorConfigs,
          };
        }

        const started = await withSpinner("Starting workspace clone job...", () =>
          fetchJson<CloneStartResponse>(
            `${baseUrl}/white-label/${sourceWorkspaceId}/clone`,
            {
              method: "POST",
              headers: { ...authHeader, "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
          ),
        );

        let finalJob = started as unknown as { jobId: string; status: string; multiTargetMap?: Record<string, string[]> };
        if (opts.wait) {
          if (!isJsonMode()) {
            console.log(colors.dim(`Job ${started.jobId} started — waiting for completion...`));
          }
          finalJob = await pollCloneJob({
            baseUrl,
            sourceWorkspaceId,
            jobId: started.jobId,
            accessToken: config.accessToken,
          });
        }

        const payload = {
          jobId: started.jobId,
          status: finalJob.status ?? started.status,
          sourceWorkspaceId,
          targetWhitelabel: (finalJob as { whitelabel?: { _id: string; title?: string } }).whitelabel,
          multiTargetMap: (finalJob as { multiTargetMap?: Record<string, string[]> }).multiTargetMap,
          ragVectorIdMap: (finalJob as { multiTargetMap?: Record<string, string[]> }).multiTargetMap,
        };

        if (isJsonMode()) {
          output(payload);
          return;
        }

        console.log(colors.green("Workspace clone job started."));
        console.log(`  ${colors.dim("Job ID:")} ${colors.cyan(started.jobId)}`);
        if (payload.targetWhitelabel?._id) {
          console.log(`  ${colors.dim("New workspace:")} ${colors.cyan(payload.targetWhitelabel._id)} ${safeLabel(payload.targetWhitelabel.title ?? "")}`);
        }
        if (payload.multiTargetMap && Object.keys(payload.multiTargetMap).length > 0) {
          console.log(`  ${colors.dim("RAG id map (source → target):")}`);
          for (const [src, targets] of Object.entries(payload.multiTargetMap)) {
            console.log(`    ${src} → ${(targets as string[]).join(", ")}`);
          }
        }
        if (!opts.wait) {
          console.log("");
          console.log(colors.dim("Poll status:"));
          console.log(`  divinci workspace clone status ${started.jobId} --from-workspace ${sourceWorkspaceId}`);
          console.log(colors.dim("Then clone a release:"));
          console.log(`  divinci release clone <releaseId> --to-workspace <newWlId> --name "..." --from-clone-job ${started.jobId} --from-workspace ${sourceWorkspaceId}`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("clone-status <jobId>")
    .description("Poll a workspace clone job started by `divinci workspace clone`")
    .option("--from-workspace <id>", "Source workspace id (default: active workspace)")
    .option("--wait", "Block until completed or failed")
    .action(async (jobId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const sourceWorkspaceId = opts.fromWorkspace ?? config.workspaceId;
        if (!sourceWorkspaceId) {
          throw new Error("No source workspace. Pass --from-workspace or run `divinci workspace use <id>`.");
        }
        if (config.authType !== "oauth" || !config.accessToken) {
          throw new Error("Requires OAuth. Run `divinci auth login`.");
        }

        const fetchStatus = () =>
          fetchJson(`${baseUrl}/white-label/${sourceWorkspaceId}/clone/${jobId}/status`, {
            headers: { Authorization: `Bearer ${config.accessToken}` },
          });

        const job = opts.wait
          ? await pollCloneJob({
            baseUrl,
            sourceWorkspaceId,
            jobId,
            accessToken: config.accessToken,
          })
          : await withSpinner("Fetching clone job...", fetchStatus);

        output(job, { keyValue: !isJsonMode() });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
