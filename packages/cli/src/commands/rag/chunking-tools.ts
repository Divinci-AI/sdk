import { colors } from "../../output/colors.js";

/**
 * SINGLE source of truth for the chunking tools the CLI advertises and accepts.
 *
 * The server validates `chunkingTool` against the RAWFILE_TO_CHUNKS registry
 * (see workspace/resources/server-resources/src/tools/rag/raw-to-chunks/index.ts
 * and the short-name normalizer in
 * workspace/servers/public-api/src/ux/whitelabel/router/rag-vector/files/create-file/direct.ts).
 *
 * IMPORTANT: bare "liteparse" is NOT registered — only the combined
 * "liteparse-langextract" pipeline is. A request with bare "liteparse" 400s
 * server-side, so the CLI must never advertise or forward it. Keep this list
 * in sync with the registry above; do NOT hardcode a per-command copy.
 */
export const VALID_CHUNKING_TOOLS = ["langextract", "openparse", "liteparse-langextract", "record-chunker"];

/** Shared `--chunking-tool` help string so every command advertises the same set. */
export const CHUNKING_TOOL_OPTION_DESCRIPTION =
  `Chunking tool: ${VALID_CHUNKING_TOOLS.join(" | ")} (default: langextract)`;

/**
 * Validate a user-supplied `--chunking-tool` value client-side and exit(1) with
 * an actionable message instead of letting the server reject it with a 400.
 * No-ops when the flag was not passed.
 */
export function assertValidChunkingTool(tool: string | undefined): void {
  if(!tool) return;
  if(VALID_CHUNKING_TOOLS.includes(tool)) return;
  console.error(colors.red(
    `Invalid --chunking-tool "${tool}". Valid values: ${VALID_CHUNKING_TOOLS.join(", ")}.` +
    (tool === "liteparse"
      ? " (\"liteparse\" alone is not a standalone chunker — use liteparse-langextract.)"
      : "")
  ));
  process.exit(1);
}
