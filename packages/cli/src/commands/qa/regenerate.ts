import { Command } from "commander";
import {
  requireConfig,
  requireWorkspaceId,
  ensureValidToken,
} from "../../config/config-manager.js";
import { handleCommandError } from "../../utils/errors.js";

// 24-char hex (Mongo ObjectId). Used for suiteId, testId, releaseId,
// ragVectorGroupIdOverride, ragVectorIdOverride.
const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
// Assistant IDs are slugs / Cloudflare model paths / vendor-prefixed
// names — e.g. "@cf/meta/llama-4-scout-17b-16e-instruct",
// "gemini-3-1-pro", "vertex-llama-3-3-70b". Allow alphanumerics, dot,
// hyphen, underscore, slash, colon, @. Cap at 128 chars.
const ASSISTANT_ID_RE = /^[A-Za-z0-9@./:_-]{1,128}$/;

function assertObjectId(value: string, label: string): string {
  if (!OBJECT_ID_RE.test(value)) {
    throw new Error(`Invalid ${label}: expected a 24-char hex ObjectId, got '${value.substring(0, 32)}'`);
  }
  return value;
}

function assertAssistantId(value: string, label: string): string {
  if (!ASSISTANT_ID_RE.test(value)) {
    throw new Error(`Invalid ${label}: expected an assistant key like '@cf/meta/...' or 'gemini-3-1-pro', got '${value.substring(0, 64)}'`);
  }
  return value;
}

/**
 * `divinci qa regenerate` — synchronously generate a new QATestResult
 * for a single (gold question, model, RAG) combo. Wraps the C.3
 * /scored-qa/calibration-ratings/regenerate endpoint.
 *
 * The fresh result is tagged iterationResultId="calibration-<testId>-..."
 * so it's distinguishable from arena-run results downstream. Same
 * pipeline arena-run uses (buildArenaVariantEnv + runReleaseEnv); just
 * runs ONE (test, variant) instead of a full sweep. Failed scorers are
 * fail-soft — the response still persists.
 *
 * Usage:
 *   divinci qa regenerate \\
 *     --suite-id <suiteId> \\
 *     --test-id  <testId> \\
 *     --release-id 69ec98bbc410b34ce6688489 \\
 *     [--assistant-id @cf/meta/llama-4-scout-17b-16e-instruct] \\
 *     [--rag-vector-group-id 699baba5057cfee5aa1bf39c] \\
 *     [--json]
 */

interface RegenerateResponse {
  triple: {
    testResultId: string;
    testId: string | null;
    prompt: string;
    response: string;
    releaseTitle?: string | null;
    assistantId?: string | null;
    ragVectorGroupName?: string | null;
    llmScores?: Record<string, number | null>;
  };
  attribution: {
    requested: string | null;
    used: string | null;
    source: string;
    note?: string;
    ragVectorGroupId?: string | null;
    elapsedMs: number;
    iterationResultId: string;
    failedScorers?: Array<{ scoreId: string; error: string }>;
  };
}

async function fetchJson<T>(url: string, token: string, body: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${text.substring(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Failed to parse response (status ${resp.status}): ${text.substring(0, 300)}`);
  }
}

export function registerQARegenerateCommand(parent: Command): void {
  parent
    .command("regenerate")
    .description("Generate a new QATestResult for a (test, model, RAG) combo (calibration tag)")
    .requiredOption("--suite-id <id>", "Suite to scope to (IDOR check + scorer config)")
    .requiredOption("--test-id <id>", "ScoredQATest._id — the gold question")
    .requiredOption("--release-id <id>", "Base release config (persona, response-type, etc.)")
    .option("--assistant-id <id>", "LLM override (defaults to release's assistant)")
    .option("--rag-vector-group-id <id>", "RAG vector group override")
    .option("--rag-vector-id <id>", "Single RAG vector override (rare; usually use group)")
    .option("--json", "Output the full response as JSON instead of a summary")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const apiBase = config.apiUrl;
        const token = config.accessToken ?? config.apiKey ?? "";

        // Format-validate IDs client-side so a typo'd CLI invocation
        // fails locally with a clear message instead of round-tripping
        // to the server, getting a 404, and silently falling back to
        // release defaults.
        assertObjectId(opts.suiteId, "--suite-id");
        assertObjectId(opts.testId, "--test-id");
        assertObjectId(opts.releaseId, "--release-id");

        const body: Record<string, unknown> = {
          suiteId: opts.suiteId,
          testId: opts.testId,
          releaseId: opts.releaseId,
        };
        if (opts.assistantId) {
          body.assistantIdOverride = assertAssistantId(opts.assistantId, "--assistant-id");
        }
        if (opts.ragVectorGroupId) {
          body.ragVectorGroupIdOverride = assertObjectId(opts.ragVectorGroupId, "--rag-vector-group-id");
        }
        if (opts.ragVectorId) {
          body.ragVectorIdOverride = assertObjectId(opts.ragVectorId, "--rag-vector-id");
        }

        const url = `${apiBase}/white-label/${workspaceId}/scored-qa/calibration-ratings/regenerate`;
        console.warn(`Generating new variant — POST /regenerate (sync, ~5-30s) ...`);
        const result = await fetchJson<RegenerateResponse>(url, token, body);

        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const t = result.triple;
        const a = result.attribution;
        console.warn("");
        console.warn(`✓ New testResultId: ${t.testResultId}`);
        console.warn(`  iterationResultId: ${a.iterationResultId}`);
        console.warn(`  release: ${t.releaseTitle ?? "?"}`);
        console.warn(`  assistant: ${a.used ?? t.assistantId ?? "?"} (source=${a.source})`);
        console.warn(`  RAG group: ${t.ragVectorGroupName ?? a.ragVectorGroupId ?? "(none)"}`);
        console.warn(`  elapsed: ${a.elapsedMs}ms`);
        if (t.llmScores) {
          console.warn(`  llmScores:`);
          for (const [sk, score] of Object.entries(t.llmScores)) {
            console.warn(`    ${sk}: ${score ?? "(skipped)"}`);
          }
        }
        if (a.failedScorers && a.failedScorers.length > 0) {
          console.warn(`  ⚠ ${a.failedScorers.length} scorer(s) failed (response persisted anyway):`);
          for (const f of a.failedScorers) {
            console.warn(`    ${f.scoreId}: ${f.error.substring(0, 120)}`);
          }
        }
        console.warn("");
        console.warn(`Response (first 400 chars):`);
        console.warn(`  ${t.response.substring(0, 400)}${t.response.length > 400 ? "..." : ""}`);
      } catch (e) {
        handleCommandError(e);
      }
    });
}
