import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/** A model as GET /api/v1/rag/embedding-models returns it. */
export interface EmbeddingModelInfo {
  id: string;
  provider: string;
  displayName: string;
  dimensions: number;
  description?: string;
  compatibleVectorDbs: string[];
  recommended?: boolean;
  notes?: string;
  /** Who may hold the credential: Divinci's key, the customer's own (BYOK), or either. */
  keySource: "divinci" | "byok" | "either";
}

export const KEY_SOURCES = ["divinci", "byok", "either"] as const;

/** Pure so it can be tested without a server: narrow the list by the CLI filters. */
export function filterEmbeddingModels(
  models: EmbeddingModelInfo[],
  opts: { provider?: string, vectorDb?: string, keySource?: string },
): EmbeddingModelInfo[] {
  return models.filter((m) =>
    (!opts.provider || m.provider === opts.provider.toLowerCase())
    && (!opts.vectorDb || m.compatibleVectorDbs.includes(opts.vectorDb))
    // "byok" means "a customer key is accepted", which "either" also is; asking for byok must
    // not hide the models that take both.
    && (!opts.keySource || m.keySource === opts.keySource || (opts.keySource === "byok" && m.keySource === "either")),
  );
}

export function registerRagModelsCommand(parent: Command): void {
  parent
    .command("models")
    .description("List embedding models, their dimensions, and whether they use Divinci's key, your own (BYOK), or either")
    .option("--provider <name>", "Only models from this provider (cloudflare | google | voyage | openai | divinci)")
    .option("--vector-db <db>", "Only models this vector database can store (e.g. qdrant, vectorize, couchbase)")
    .option("--key-source <source>", `Only models by who holds the key: ${KEY_SOURCES.join(" | ")} (byok also matches either)`)
    .action(async (opts, cmd) => {
      try {
        if (opts.keySource && !(KEY_SOURCES as readonly string[]).includes(opts.keySource)) {
          console.error(`--key-source must be one of: ${KEY_SOURCES.join(", ")}`);
          process.exit(1);
        }
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const data = await withSpinner("Fetching embedding models...", () =>
          httpClient.get<{ models: EmbeddingModelInfo[]; total: number }>(
            // An OAuth login reaches the workspace router, which serves this list under rag-vector/; an API key
            // reaches the v1 router, which serves it under rag/. rag-cli.ts mirrors neither, so `${routeBase}/rag/...` 404s on OAuth.
            config.authType === "oauth" ? `${routeBase}/rag-vector/embedding-models` : `${routeBase}/rag/embedding-models`,
          ),
        );
        const rows = filterEmbeddingModels(data.models, opts).map((m) => ({
          id: m.id,
          provider: m.provider,
          dimensions: m.dimensions,
          key: m.keySource,
          recommended: m.recommended ? "yes" : "",
          vectorDbs: m.compatibleVectorDbs.join(", "),
        }));
        output(rows, {
          table: {
            columns: [
              { key: "id", header: "Model" },
              { key: "provider", header: "Provider" },
              { key: "dimensions", header: "Dims" },
              { key: "key", header: "Key" },
              { key: "recommended", header: "Recommended" },
              { key: "vectorDbs", header: "Vector DBs" },
            ],
          },
        });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
