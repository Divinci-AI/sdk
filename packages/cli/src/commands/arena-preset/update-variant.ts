import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * Partial-update one variant on an arena preset. Only fields passed on the
 * CLI are changed — everything else on the variant is left alone.
 *
 * Hits the internal PATCH endpoint via the user's OAuth token (same pattern
 * as `divinci api`). Kept lean: no extra input-validation beyond what the
 * server does.
 */
export function registerArenaPresetUpdateVariantCommand(parent: Command): void {
  parent
    .command("update-variant <presetId> <variantIndex>")
    .description("Update a single variant on an arena preset in-place")
    .option("--name <name>", "Variant display name")
    .option("--release-id <id>", "Release ID for this variant")
    .option("--rag-vector-id <id>", "Single RAG vector ID (clears ragVectorGroupId)")
    .option("--rag-vector-group-id <id>", "RAG vector group ID (clears ragVectorId)")
    .option("--output-workflow <w>", "Output workflow: default|hybrid|extensible|pageindex-pruned")
    .option("--product-workflow <w>", "Product workflow: simple|advanced")
    .option("--assistant-id <id>", "Per-variant assistant override (written to variant.config.assistantId)")
    .action(async (presetId: string, variantIndex: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const body: Record<string, unknown> = {};
        if (opts.name !== undefined) body.name = opts.name;
        if (opts.releaseId !== undefined) body.releaseId = opts.releaseId;
        if (opts.ragVectorId !== undefined) body.ragVectorId = opts.ragVectorId;
        if (opts.ragVectorGroupId !== undefined) body.ragVectorGroupId = opts.ragVectorGroupId;
        if (opts.outputWorkflow !== undefined) body.outputWorkflow = opts.outputWorkflow;
        if (opts.productWorkflow !== undefined) body.productWorkflow = opts.productWorkflow;
        if (opts.assistantId !== undefined) body.assistantId = opts.assistantId;

        if (Object.keys(body).length === 0) {
          throw new Error("No fields to update. Pass at least one --* flag.");
        }

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const url = `${baseUrl}/white-label/${workspaceId}/arena/presets/${presetId}/variants/${variantIndex}`;

        const data = await withSpinner(
          `Patching variant ${variantIndex} on preset ${presetId}...`,
          async () => {
            const res = await fetch(url, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.accessToken}`,
              },
              body: JSON.stringify(body),
            });
            const text = await res.text();
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 300)}`);
            try { return JSON.parse(text) as any; } catch { throw new Error(`Non-JSON response: ${text.substring(0, 200)}`); }
          },
        );

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
