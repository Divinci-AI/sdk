import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { createReadStream, createWriteStream } from "fs";
import { createInterface } from "readline";

/**
 * RAG-augment a training JSONL file for QLoRA v3 (Set C).
 *
 * For each item in the training set, queries the specified RAG vector and
 * prepends retrieved context to the user message in the same format as
 * production serving. The resulting file is used to retrain QLoRA so the
 * model sees (context, question) → answer at training time, matching inference.
 *
 *   divinci qa augment-training-set training_set.jsonl \
 *     --rag-vector-id <qdrant-gemini-1536-id> \
 *     --output rag_training_set.jsonl \
 *     --rag-fraction 0.6
 */
export function registerQAAugmentTrainingSetCommand(parent: Command): void {
  parent
    .command("augment-training-set <inputFile>")
    .description("RAG-augment a QLoRA training JSONL file for Set C (fixes prompt-shape collapse)")
    .requiredOption("--rag-vector-id <id>", "RAG vector ID to retrieve context from (use winning backend from Set A)")
    .option("--output <path>", "Output path for augmented JSONL", "rag_training_set.jsonl")
    .option("--rag-fraction <n>", "Fraction of items to augment (0–1)", "0.6")
    .option("--max-items <n>", "Cap total items processed")
    .option("--concurrency <n>", "Parallel retrieval requests", "8")
    .option("--max-context-chars <n>", "Max characters of retrieved context per item", "4000")
    .option("--limit <n>", "Max RAG chunks per query", "5")
    .option("--smoke", "Smoke test: process 20 items only")
    .action(async (inputFile: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);

        const baseUrl = config.apiUrl.replace(/\/+$/, "");
        const ragFraction = parseFloat(opts.ragFraction);
        const concurrency = parseInt(opts.concurrency, 10);
        const maxContextChars = parseInt(opts.maxContextChars, 10);
        const ragLimit = parseInt(opts.limit, 10);
        const maxItems = opts.maxItems ? parseInt(opts.maxItems, 10) : (opts.smoke ? 20 : undefined);

        const RAG_INJECTION_TEMPLATE =
          "Here is some relevant information that may help you answer:\n\n{chunks}";
        const CHUNK_SEPARATOR = "\n\n---\n\n";

        // ── Read input JSONL ───────────────────────────────────────────────
        // eslint-disable-next-line no-console
        console.log(colors.dim(`Reading ${inputFile}...`));
        const rows: any[] = [];
        await new Promise<void>((resolve, reject) => {
          const rl = createInterface({ input: createReadStream(inputFile) });
          rl.on("line", (line) => {
            if (line.trim()) {
              try { rows.push(JSON.parse(line)); } catch { /* skip malformed */ }
              if (maxItems && rows.length >= maxItems) rl.close();
            }
          });
          rl.on("close", resolve);
          rl.on("error", reject);
        });

        // eslint-disable-next-line no-console
        console.log(`  ${rows.length.toLocaleString()} items loaded`);
        const ragMask = rows.map(() => Math.random() < ragFraction);
        const nRag = ragMask.filter(Boolean).length;
        // eslint-disable-next-line no-console
        console.log(`  RAG-augmented: ${nRag} (${Math.round(ragFraction * 100)}%)  bare: ${rows.length - nRag}`);

        // ── Retrieval via POST /rag-vector/:id/retrieve ───────────────────
        // Returns full chunk content (unlike test-retrieval which caps at ~200 chars).
        // Response: { ragId, query, chunks: Array<{content, score, id}>, embeddingModel }
        const retrieveContext = async (question: string): Promise<string | null> => {
          const url = `${baseUrl}/white-label/${workspaceId}/rag-vector/${opts.ragVectorId}/retrieve`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.accessToken!}`,
            },
            body: JSON.stringify({ query: question.substring(0, 500), maxChunks: ragLimit }),
          });
          if (!res.ok) return null;
          const text = await res.text();
          let parsed: any;
          try { parsed = JSON.parse(text); } catch { return null; }

          const chunks: Array<{ content: string; score: number; id: string }> = parsed?.chunks ?? [];
          if (!chunks.length) return null;

          const texts = chunks
            .map((c) => (c.content ?? "").trim())
            .filter(Boolean);
          if (!texts.length) return null;

          let combined = texts.join(CHUNK_SEPARATOR);
          if (combined.length > maxContextChars) combined = combined.substring(0, maxContextChars) + "…";
          return RAG_INJECTION_TEMPLATE.replace("{chunks}", combined);
        };

        // ── Process with concurrency ───────────────────────────────────────
        const outStream = createWriteStream(opts.output);
        let written = 0;
        let retrieved = 0;
        let bare = 0;

        const processRow = async (row: any, doRag: boolean): Promise<void> => {
          const userMsg = row.messages?.find((m: any) => m.role === "user")?.content ?? "";
          const asstMsg = row.messages?.find((m: any) => m.role === "assistant")?.content ?? "";
          if (!userMsg || !asstMsg) return;

          let ragContext: string | null = null;
          let ragSource = "bare";

          if (doRag) {
            try {
              ragContext = await retrieveContext(userMsg);
              ragSource = ragContext ? "live_retrieval" : "bare";
            } catch {
              ragSource = "bare";
            }
          }

          const userContent = ragContext ? `${ragContext}\n\n${userMsg}` : userMsg;
          const augmented = {
            ...row,
            messages: [
              ...(row.messages?.filter((m: any) => m.role === "system") ?? []),
              { role: "user", content: userContent },
              { role: "assistant", content: asstMsg },
            ],
            rag_augmented: doRag && !!ragContext,
            rag_source: ragSource,
          };

          outStream.write(JSON.stringify(augmented) + "\n");
          written++;
          if (ragContext) retrieved++;
          else bare++;
        };

        // eslint-disable-next-line no-console
        console.log(colors.dim(`\nRetrieving context (concurrency=${concurrency})...`));

        // Process in concurrency-bounded batches
        for (let i = 0; i < rows.length; i += concurrency) {
          const batch = rows.slice(i, i + concurrency);
          const mask = ragMask.slice(i, i + concurrency);
          await Promise.all(batch.map((row, j) => processRow(row, mask[j])));

          if ((i + concurrency) % 500 === 0 || i + concurrency >= rows.length) {
            const done = Math.min(i + concurrency, rows.length);
            // eslint-disable-next-line no-console
            console.log(`  ${done.toLocaleString()}/${rows.length.toLocaleString()} — live=${retrieved} bare=${bare}`);
          }
        }

        await new Promise<void>((resolve) => outStream.end(resolve));
        outStream.on("error", (err) => { throw err; });

        // eslint-disable-next-line no-console
        console.log(colors.green(`\n✔ Done: ${written.toLocaleString()} items → ${opts.output}`));
        // eslint-disable-next-line no-console
        console.log(`  live_retrieval: ${retrieved}  bare: ${bare}`);
        // eslint-disable-next-line no-console
        console.log(colors.dim("\nNext: upload to Modal volume, then train:"));
        // eslint-disable-next-line no-console
        console.log(colors.dim("  modal volume put arena-training rag_training_set.jsonl"));
        // eslint-disable-next-line no-console
        console.log(colors.dim("  modal run eval_harness/scripts/qlora_rag_modal.py --smoke"));
        // eslint-disable-next-line no-console
        console.log(colors.dim("  modal run eval_harness/scripts/qlora_rag_modal.py"));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
