/**
 * divinci rag products — Inspect product catalogs in a RAG vector
 *
 * Subcommands:
 *   rag products ls --rag <ragId>                List products in a vector
 *   rag products get --rag <ragId> <productId>   Get one product's details
 *   rag products categories --rag <ragId>        Category breakdown (count per category)
 *   rag products gen-queries --rag <ragId>       Generate synthetic eval queries from catalog
 *   rag products validate-queries --suite <p>    Reverse-retrieval validate gen'd queries
 *   rag products prominence set-pages --catalog <id> --page <url[@imp]>  Set crawl landing pages
 *   rag products prominence recompute --catalog <id>                     Run the prominence crawl
 *   rag products prominence pin <productId> --catalog <id> [--weight|--featured|--unpin]
 *
 * Wraps:
 *   GET   /white-label/:wl/rag-vector/:ragId/products
 *   GET   /white-label/:wl/rag-vector/:ragId/products?category=<c>
 *   POST  /white-label/:wl/rag-vector/:ragId/retrieve  (for validate-queries)
 *   PATCH /white-label/:wl/rag-vector/products/catalog/:cat/landing-pages
 *   POST  /white-label/:wl/rag-vector/products/catalog/:cat/recompute-prominence
 *   PATCH /white-label/:wl/rag-vector/products/catalog/:cat/product/:pid/prominence
 */

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";


interface Product {
  id: string;
  title?: string;
  name?: string;
  price?: number | string | null;
  category?: string;
  brand?: string;
  inventory?: number;
  imageUrl?: string;
  url?: string;
  productUrl?: string;
  description?: string | object;  // sometimes stored as object — see [object Object] UI bug
  keywords?: string;
  status?: string;
}

interface CatalogRagVector {
  id: string;
  name: string;
  vectorIndexTool?: string;
  embeddingModel?: string;
  fileCount: number;
}

interface Catalog {
  _id: string;
  filename: string;
  products: Product[];
  ragVectorName?: string | null;
  ragVectors?: CatalogRagVector[];
  ragVectorId?: string;
  ragVectorIds?: string[];
  totalProducts?: number;
  status?: string;
  updatedAt?: string;
}

interface CatalogListResponse {
  catalogs: Catalog[];
  stats?: { totalCatalogs: number; totalProducts: number };
}


// ── pretty printer ──────────────────────────────────────────────────────────

function productName(p: Product): string {
  return p.title || p.name || `(unnamed ${p.id})`;
}

/**
 * Commander collector for `--page <url[@importance]>` (repeatable). A trailing
 * `@<number>` sets the page importance (0-1, default 1); only split on `@` when
 * the tail is numeric so it never mangles a `@` inside a URL.
 */
function collectPages(
  value: string,
  prev: Array<{ url: string; importance: number }>,
): Array<{ url: string; importance: number }> {
  let url = value;
  let importance = 1;
  const at = value.lastIndexOf("@");
  if (at > 0) {
    const tail = value.slice(at + 1);
    if (/^\d*\.?\d+$/.test(tail)) {
      url = value.slice(0, at);
      importance = Math.max(0, Math.min(1, parseFloat(tail)));
    }
  }
  return [...prev, { url: url.trim(), importance }];
}

function printProduct(p: Product, indent = ""): void {
  console.log(`${indent}${colors.cyanBold(productName(p))} ${colors.dim(`(${p.id})`)}`);
  if (p.category) console.log(`${indent}  ${colors.dim("Category:")} ${p.category}`);
  if (p.brand)    console.log(`${indent}  ${colors.dim("Brand:")} ${p.brand}`);
  if (p.price !== undefined && p.price !== null) {
    const priceStr = typeof p.price === "number" ? `$${p.price.toFixed(2)}` : p.price;
    console.log(`${indent}  ${colors.dim("Price:")} ${priceStr}`);
  }
  if (p.inventory !== undefined) console.log(`${indent}  ${colors.dim("Inventory:")} ${p.inventory}`);
  const url = p.productUrl || p.url;
  if (url) console.log(`${indent}  ${colors.dim("URL:")} ${url}`);
}

/** Fetch all catalogs for the workspace + flatten into product list, optionally filtered by ragVectorId. */
async function fetchAllProducts(
  httpClient: { get<T>(url: string): Promise<T> },
  routeBase: string,
  filterRagId?: string,
): Promise<Product[]> {
  const data = await httpClient.get<CatalogListResponse>(`${routeBase}/rag-vector/products/list`);
  const catalogs = data.catalogs || [];
  const filtered = filterRagId
    ? catalogs.filter(cat => {
        const vecIds = new Set<string>();
        if (cat.ragVectorId) vecIds.add(String(cat.ragVectorId));
        if (Array.isArray(cat.ragVectorIds)) cat.ragVectorIds.forEach(id => id && vecIds.add(String(id)));
        if (Array.isArray(cat.ragVectors)) cat.ragVectors.forEach(v => v?.id && vecIds.add(String(v.id)));
        return vecIds.has(filterRagId);
      })
    : catalogs;
  return filtered.flatMap(c => c.products || []);
}


// ── synthetic query generation prompt ───────────────────────────────────────

const QUERY_GEN_PROMPT_TEMPLATE = (product: Product, n: number) => `\
You are generating evaluation queries for a product recommendation RAG system.

Given the product below, generate ${n} distinct user queries that — if a real user
sent them to a chat assistant — should result in this specific product being
retrieved and recommended.

Each query should:
- Sound natural (like something a real user would type, not a search query)
- Reference a need, symptom, goal, or use case (NOT the product name itself)
- Be diverse: vary in length, formality, and angle (e.g., one symptom-focused,
  one goal-focused, one comparison-focused)
- NOT contain the product name or SKU directly — that would make retrieval trivial

Product:
  Name: ${product.name}
  ID: ${product.id}
  Category: ${product.category ?? "(unknown)"}
  Brand: ${product.brand ?? "(unknown)"}
  ${product.productUrl ? `URL: ${product.productUrl}` : ""}

Output JSON only:
{
  "queries": [
    {"text": "<user query 1>", "angle": "<symptom|goal|comparison|context>"},
    {"text": "<user query 2>", "angle": "..."},
    ...
  ]
}`;


// ── command registration ────────────────────────────────────────────────────

export function registerRagProductsCommand(parent: Command): void {
  const products = parent
    .command("products")
    .description("Inspect product catalogs in a RAG vector + generate eval queries");

  // ── ls ─────────────────────────────────────────────────────────────────────
  products
    .command("ls")
    .description("List products from this workspace's catalogs (optionally filtered by RAG vector or category)")
    .option("--rag <ragId>", "Filter to products in a specific RAG vector (matches catalog.ragVectors[].id)")
    .option("--category <c>", "Filter by category (case-insensitive substring match)")
    .option("--brand <b>", "Filter by brand")
    .option("--limit <n>", "Max products to print", "20")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);
        const limit = parseInt(opts.limit, 10);

        let products = await withSpinner("Listing products...", () =>
          fetchAllProducts(httpClient, routeBase, opts.rag),
        );

        if (opts.category) {
          const needle = String(opts.category).toLowerCase();
          products = products.filter(p => (p.category || "").toLowerCase().includes(needle));
        }
        if (opts.brand) {
          products = products.filter(p => p.brand === opts.brand);
        }

        const total = products.length;
        if (limit > 0) products = products.slice(0, limit);

        if (isJsonMode()) { output({ products, total }); return; }

        if (products.length === 0) {
          console.log(colors.dim("No products found."));
          return;
        }
        console.log(colors.dim(`${products.length} product(s) shown of ${total} matching`));
        console.log("");
        for (const p of products) {
          printProduct(p);
          console.log("");
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── get ────────────────────────────────────────────────────────────────────
  products
    .command("get <productId>")
    .description("Get a single product's details by id")
    .option("--rag <ragId>", "Restrict search to a specific RAG vector")
    .action(async (productId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const products = await fetchAllProducts(httpClient, routeBase, opts.rag);
        const found = products.find(p => p.id === productId);
        if (!found) {
          console.error(colors.red(`Product ${productId} not found.`));
          process.exit(1);
        }
        if (isJsonMode()) { output(found); return; }
        printProduct(found);
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── categories ─────────────────────────────────────────────────────────────
  products
    .command("categories")
    .description("Show category coverage across the workspace's product catalogs (count per category)")
    .option("--rag <ragId>", "Restrict to products in a specific RAG vector")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const products = await withSpinner("Scanning products...", () =>
          fetchAllProducts(httpClient, routeBase, opts.rag),
        );

        const counts: Record<string, number> = {};
        for (const p of products) {
          const c = (p.category || "").trim() || "(uncategorized)";
          counts[c] = (counts[c] || 0) + 1;
        }

        const result = { scanned: products.length, counts };
        if (isJsonMode()) { output(result); return; }

        const sorted = Object.entries(result.counts).sort((a, b) => b[1] - a[1]);
        console.log(colors.dim(`Scanned ${result.scanned} products`));
        console.log("");
        if (sorted.length === 0) {
          console.log(colors.dim("(no products to categorize)"));
          return;
        }
        const maxLen = Math.max(...sorted.map(([c]) => c.length));
        for (const [cat, n] of sorted) {
          console.log(`  ${cat.padEnd(maxLen)}  ${colors.cyan(String(n).padStart(5))}`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── gen-queries ────────────────────────────────────────────────────────────
  products
    .command("gen-queries")
    .description("Generate synthetic evaluation queries from the catalog (Gemini 3.1 Pro batch)")
    .option("--rag <ragId>", "Restrict to products in a specific RAG vector")
    .requiredOption("--output <path>", "Output JSONL path (one item per query)")
    .option("--queries-per-product <n>", "Queries to generate per product", "3")
    .option("--max-products <n>", "Cap products processed (0 = all)", "0")
    .option("--category <c>", "Limit to products in a single category")
    .option("--model <m>", "Gemini model id", "gemini-3.1-pro-preview")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const queriesPerProduct = parseInt(opts.queriesPerProduct, 10);
        const maxProducts = parseInt(opts.maxProducts, 10);

        // Step 1: load all products in this RAG vector (or full workspace)
        console.log(colors.dim("Loading catalog..."));
        let allProducts = await fetchAllProducts(httpClient, routeBase, opts.rag);

        if (opts.category) {
          const needle = String(opts.category).toLowerCase();
          allProducts = allProducts.filter(p => (p.category || "").toLowerCase().includes(needle));
        }
        if (maxProducts > 0 && allProducts.length > maxProducts) {
          allProducts = allProducts.slice(0, maxProducts);
        }
        console.log(colors.dim(`  ${allProducts.length} products loaded`));

        if (allProducts.length === 0) {
          console.error(colors.red("No products to process."));
          process.exit(1);
        }

        // Step 2: scaffold the batch input. The actual Gemini batch submission
        // is done via the eval_harness Python pipeline (qlora_serve_31b_modal +
        // batch judge infra), which already handles the Vertex AI batch API.
        // This command emits the seed JSONL that the Python pipeline consumes.
        const outPath = path.resolve(opts.output);
        const outDir = path.dirname(outPath);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        const seedPath = outPath.replace(/\.jsonl$/i, "") + ".seeds.jsonl";
        const out = fs.openSync(seedPath, "w");
        for (const p of allProducts) {
          fs.writeSync(out, JSON.stringify({
            product_id: p.id,
            product_name: p.name,
            category: p.category,
            brand: p.brand,
            url: p.productUrl,
            queries_to_generate: queriesPerProduct,
            prompt: QUERY_GEN_PROMPT_TEMPLATE(p, queriesPerProduct),
          }) + "\n");
        }
        fs.closeSync(out);

        console.log(colors.green(`✓ Wrote ${allProducts.length} seed prompts to ${seedPath}`));
        console.log("");
        console.log(colors.dim("Next step: submit the batch to Gemini via the Python pipeline:"));
        console.log("");
        console.log(`  cd workspace/workers/eval-harness`);
        console.log(`  python -m eval_harness.scripts.batch_gen_product_queries \\`);
        console.log(`      --seeds ${seedPath} \\`);
        console.log(`      --output ${outPath} \\`);
        console.log(`      --model ${opts.model}`);
        console.log("");
        console.log(colors.dim("(That Python script is part of the next phase — uses the Gemini batch path"));
        console.log(colors.dim("we just wired in scorers.BatchJudgeQueue with vertex backend.)"));
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── validate-queries ───────────────────────────────────────────────────────
  products
    .command("validate-queries")
    .description("Reverse-retrieval validation: drop queries that don't actually retrieve their source product")
    .requiredOption("--rag <ragId>", "RAG vector ID")
    .requiredOption("--suite <path>", "Input JSONL of {prompt, expected_product_id} items")
    .requiredOption("--output <path>", "Output JSONL of validated items")
    .option("--top-k <n>", "Consider top-k retrieved chunks", "5")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const topK = parseInt(opts.topK, 10);
        const suiteText = fs.readFileSync(opts.suite, "utf-8");
        const items = suiteText.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
        console.log(colors.dim(`${items.length} candidate items loaded from ${opts.suite}`));

        const outPath = path.resolve(opts.output);
        const outDir = path.dirname(outPath);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const out = fs.openSync(outPath, "w");

        let kept = 0, dropped = 0;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const expectedId = item.expected_product_id || item.expectedProductIds?.[0];
          if (!item.prompt || !expectedId) {
            dropped++;
            continue;
          }
          try {
            const resp = await httpClient.post<{ chunks?: Array<{ content?: string; productId?: string; metadata?: { productId?: string } }> }>(
              `${routeBase}/rag-vector/${opts.rag}/retrieve`,
              { query: item.prompt, maxChunks: topK },
            );
            const ids = (resp.chunks || []).map(c => c.productId || c.metadata?.productId).filter(Boolean);
            const hit = ids.includes(expectedId);
            if (hit) {
              fs.writeSync(out, JSON.stringify({ ...item, _validated: true, _retrieved_top: ids }) + "\n");
              kept++;
            } else {
              dropped++;
            }
            if ((i + 1) % 20 === 0) {
              console.log(colors.dim(`  [${i + 1}/${items.length}] kept=${kept} dropped=${dropped}`));
            }
          } catch {
            dropped++;
          }
        }
        fs.closeSync(out);
        console.log("");
        console.log(colors.green(`✓ ${kept} kept, ${dropped} dropped → ${outPath}`));
        console.log(colors.dim(`  drop rate ${((100 * dropped) / items.length).toFixed(1)}% — bad seeds where reverse retrieval missed`));
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── prominence ───────────────────────────────────────────────────────────
  // Weight products by their storefront landing-page prominence: configure the
  // pages, run the crawl, and pin per-product operator overrides.
  //   PATCH /white-label/:wl/rag-vector/products/catalog/:cat/landing-pages
  //   POST  /white-label/:wl/rag-vector/products/catalog/:cat/recompute-prominence
  //   PATCH /white-label/:wl/rag-vector/products/catalog/:cat/product/:pid/prominence
  const prominence = products
    .command("prominence")
    .description("Weight products by storefront landing-page prominence (config, crawl, pins)");

  prominence
    .command("set-pages")
    .description("Set the storefront landing pages crawled to weight product prominence")
    .requiredOption("--catalog <catalogId>", "Catalog id (see `rag products ls --json`)")
    .option("--page <url[@importance]>", "Landing page URL; optional @importance 0-1 (repeatable)", collectPages, [])
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);
        const landingPages = opts.page as Array<{ url: string; importance: number }>;
        if (landingPages.length === 0) {
          console.error(colors.red("Provide at least one --page <url[@importance]>."));
          process.exit(1);
        }
        const data = await withSpinner("Saving landing pages...", () =>
          httpClient.patch<{ catalogId: string; landingPages: Array<{ url: string; importance: number }> }>(
            `${routeBase}/rag-vector/products/catalog/${opts.catalog}/landing-pages`,
            { landingPages },
          ),
        );
        if (isJsonMode()) { output(data); return; }
        console.log(colors.green(`✓ ${data.landingPages.length} landing page(s) saved for ${data.catalogId}`));
        for (const p of data.landingPages) {
          console.log(`  ${colors.cyan(p.url)} ${colors.dim(`(importance ${p.importance})`)}`);
        }
        console.log(colors.dim(`Next: divinci rag products prominence recompute --catalog ${opts.catalog}`));
      } catch (error) {
        handleCommandError(error);
      }
    });

  prominence
    .command("recompute")
    .description("Run the prominence crawl now (fetch configured pages, write weights back to products)")
    .requiredOption("--catalog <catalogId>", "Catalog id")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);
        const data = await withSpinner("Crawling landing pages...", () =>
          httpClient.post<{
            catalogId: string;
            summary: {
              pagesFetched: number; pagesConfigured: number;
              productsWeighted: number; productsCleared: number; productsPinned: number;
            } | null;
          }>(`${routeBase}/rag-vector/products/catalog/${opts.catalog}/recompute-prominence`, {}),
        );
        if (isJsonMode()) { output(data); return; }
        const s = data.summary;
        if (!s) { console.log(colors.yellow("No summary returned.")); return; }
        console.log(colors.green(`✓ crawl complete for ${data.catalogId}`));
        console.log(`  pages: ${s.pagesFetched}/${s.pagesConfigured} fetched`);
        console.log(`  products: ${colors.cyan(String(s.productsWeighted))} weighted, ${s.productsPinned} pinned (kept), ${s.productsCleared} cleared`);
      } catch (error) {
        handleCommandError(error);
      }
    });

  prominence
    .command("pin <productId>")
    .description("Pin an operator prominence override on a product (the crawl won't overwrite it)")
    .requiredOption("--catalog <catalogId>", "Catalog id")
    .option("--weight <0-1>", "Prominence weight 0-1")
    .option("--featured", "Mark the product as featured")
    .option("--preferred", "Preferred recommendation: force-recommend this product + hard-pin its linked content's chunks")
    .option("--no-preferred", "Clear the preferred-recommendation flag")
    .option("--unpin", "Remove the pin instead (let the crawl manage this product again)")
    .action(async (productId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);
        const body: Record<string, unknown> = { pinned: !opts.unpin };
        if (opts.weight !== undefined) body.prominenceWeight = Math.max(0, Math.min(1, parseFloat(opts.weight)));
        if (opts.featured) body.featured = true;
        // commander sets opts.preferred=false only when --no-preferred is passed.
        if (opts.preferred === true || opts.preferred === false) body.preferred = opts.preferred;
        const data = await withSpinner(opts.unpin ? "Unpinning..." : "Pinning...", () =>
          httpClient.patch<{ productId: string; prominenceWeight: number | null; featured: boolean | null; pinned: boolean; preferred?: boolean }>(
            `${routeBase}/rag-vector/products/catalog/${opts.catalog}/product/${productId}/prominence`,
            body,
          ),
        );
        if (isJsonMode()) { output(data); return; }
        console.log(colors.green(`✓ ${data.pinned ? "pinned" : "unpinned"} ${data.productId}`));
        if (data.pinned) console.log(colors.dim(`  weight=${data.prominenceWeight ?? "—"} featured=${data.featured ?? false} preferred=${data.preferred ?? false}`));
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── calibration ──────────────────────────────────────────────────────────
  // How often the cron re-crawls prominence + checks product-link liveness for
  // a catalog: off | daily | weekly | monthly (unset ⇒ monthly).
  //   PATCH /white-label/:wl/rag-vector/products/catalog/:cat/calibration
  const calibration = products
    .command("calibration")
    .description("Control how often a catalog auto-recalibrates (prominence + link liveness)");

  calibration
    .command("set-cadence <cadence>")
    .description("Set calibration cadence for a catalog: off | daily | weekly | monthly")
    .requiredOption("--catalog <catalogId>", "Catalog id (see `rag products ls --json`)")
    .action(async (cadence, opts, cmd) => {
      try {
        const allowed = ["off", "daily", "weekly", "monthly"];
        if (!allowed.includes(cadence)) {
          console.error(colors.red(`cadence must be one of: ${allowed.join(", ")}`));
          process.exit(1);
        }
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);
        const data = await withSpinner("Updating calibration cadence...", () =>
          httpClient.patch<{ catalogId: string; calibrationCadence: string; calibratedAt: string | null }>(
            `${routeBase}/rag-vector/products/catalog/${opts.catalog}/calibration`,
            { cadence },
          ),
        );
        if (isJsonMode()) { output(data); return; }
        console.log(colors.green(`✓ ${data.catalogId} calibration cadence → ${colors.cyan(data.calibrationCadence)}`));
        console.log(colors.dim(`  last calibrated: ${data.calibratedAt ?? "never"}`));
        if (data.calibrationCadence === "off") console.log(colors.dim("  (auto-recalibration disabled for this catalog)"));
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── merchandising ────────────────────────────────────────────────────────
  // Category-scoped merchandising rankings: for each conversation category
  // (matched against the user's question via matchTerms), an ORDERED product
  // list consumed by the generation injection + sub-reply card selection.
  //   PATCH /white-label/:wl/rag-vector/products/catalog/:cat/merchandising
  type MerchEntry = { category: string; matchTerms: string[]; ranking: string[] };
  const merchandising = products
    .command("merchandising")
    .description("Category-scoped product rankings (category → matchTerms → ordered products)");

  merchandising
    .command("get")
    .description("Show the catalog's merchandising config")
    .requiredOption("--catalog <catalogId>", "Catalog id (see `rag products ls --json`)")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);
        const data = await withSpinner("Fetching catalog...", () =>
          httpClient.get<{ merchandising?: MerchEntry[] }>(
            `${routeBase}/rag-vector/products/catalog/${opts.catalog}`,
          ),
        );
        const entries = data.merchandising ?? [];
        if (isJsonMode()) { output({ merchandising: entries }); return; }
        if (entries.length === 0) {
          console.log(colors.yellow("No merchandising config — legacy per-product 'preferred' pins (if any) apply globally."));
          return;
        }
        for (const e of entries) {
          console.log(colors.cyan(e.category));
          console.log(`  terms:   ${e.matchTerms.join(", ")}`);
          console.log(`  ranking: ${e.ranking.join(colors.dim(" > "))}`);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  merchandising
    .command("set")
    .description("Upsert ONE category's ranking (fetch-merge-replace), or --remove it")
    .requiredOption("--catalog <catalogId>", "Catalog id")
    .requiredOption("--category <slug>", "Category slug, e.g. weight-loss")
    .option("--term <phrase>", "Question phrase identifying this category (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
    .option("--product <productId>", "Product id in ranked order, best first (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
    .option("--remove", "Remove this category from the config instead")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);
        const base = `${routeBase}/rag-vector/products/catalog/${opts.catalog}`;
        // The endpoint replaces the WHOLE array — fetch-merge so a single-
        // category edit can't clobber the other categories.
        const current = await httpClient.get<{ merchandising?: MerchEntry[] }>(base);
        const entries = (current.merchandising ?? []).filter((e) => e.category !== opts.category);
        if (!opts.remove) {
          if ((opts.term as string[]).length === 0 || (opts.product as string[]).length === 0) {
            console.error(colors.red("Provide at least one --term and one --product (or use --remove)."));
            process.exit(1);
          }
          entries.push({ category: opts.category, matchTerms: opts.term, ranking: opts.product });
        }
        const data = await withSpinner("Saving merchandising...", () =>
          httpClient.patch<{ catalogId: string; merchandising: MerchEntry[] }>(
            `${base}/merchandising`, { merchandising: entries },
          ),
        );
        if (isJsonMode()) { output(data); return; }
        console.log(colors.green(`✓ merchandising ${opts.remove ? "category removed" : "saved"} on ${data.catalogId} (${data.merchandising.length} categor${data.merchandising.length === 1 ? "y" : "ies"})`));
        console.log(colors.dim("Takes effect within ~5 min (catalog cache TTL)."));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
