/**
 * divinci rag groups — RAG vector group management
 *
 * Subcommands:
 *   rag groups ls                        — List all groups
 *   rag groups get <groupId>             — Get group details
 *   rag groups create <name>             — Create a new group
 *   rag groups update <groupId>          — Update group metadata or vectors
 *   rag groups delete <groupId>          — Archive (soft-delete) a group
 */

import { Command } from "commander";
import { requireConfig, ensureValidToken, getRouteBase } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output, isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import { safeLabel, stripControlChars } from "../../output/safe-text.js";

interface RagVectorRef {
  _id: string;
  title?: string;
  vectorIndexTool?: string;
}

interface RagGroup {
  _id: string;
  name: string;
  description?: string;
  ragVectorIds: string[];
  ragVectors?: RagVectorRef[];
  mergeStrategy: string;
  maxChunksPerVector: number;
  archived: boolean;
  createdAt?: string;
}

function printGroup(group: RagGroup): void {
  console.log(`${colors.cyanBold(safeLabel(group.name))} ${colors.dim(`(${group._id})`)}`);
  if (group.description) {
    console.log(`  ${colors.dim("Description:")} ${stripControlChars(group.description)}`);
  }
  console.log(`  ${colors.dim("Strategy:")} ${group.mergeStrategy}  ${colors.dim("Chunks/vector:")} ${group.maxChunksPerVector}`);
  const vectors = group.ragVectors || group.ragVectorIds.map(id => ({ _id: id }));
  if (vectors.length > 0) {
    console.log(`  ${colors.dim(`Vectors (${vectors.length}):`)}`)
    for (const v of vectors) {
      const tool = (v as RagVectorRef).vectorIndexTool ? colors.dim(` [${(v as RagVectorRef).vectorIndexTool}]`) : "";
      console.log(`    • ${safeLabel((v as RagVectorRef).title || v._id)}${tool} ${colors.dim(v._id)}`);
    }
  }
}

export function registerRagGroupsCommand(parent: Command): void {
  const groups = parent
    .command("groups")
    .description("Manage RAG vector groups (merged multi-index retrieval)");

  // ── ls ──────────────────────────────────────────────────────────────────
  groups
    .command("ls")
    .description("List all RAG vector groups")
    .action(async (_opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const data = await withSpinner("Fetching groups...", () =>
          httpClient.get<{ groups: RagGroup[] }>(`${routeBase}/rag/groups`)
        );

        if (isJsonMode()) {
          output(data.groups);
          return;
        }

        if (data.groups.length === 0) {
          console.log(colors.dim("No groups found."));
          return;
        }

        for (const g of data.groups) {
          printGroup(g);
          console.log("");
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── get ──────────────────────────────────────────────────────────────────
  groups
    .command("get <groupId>")
    .description("Get details of a specific group")
    .action(async (groupId, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const data = await withSpinner("Fetching group...", () =>
          httpClient.get<{ group: RagGroup }>(`${routeBase}/rag/groups/${groupId}`)
        );

        if (isJsonMode()) {
          output(data.group);
          return;
        }

        printGroup(data.group);
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── create ───────────────────────────────────────────────────────────────
  groups
    .command("create <name>")
    .description("Create a new RAG vector group")
    .requiredOption("--vectors <ids>", "Comma-separated list of at least 2 vector IDs")
    .option("--description <text>", "Group description")
    .option("--strategy <type>", "Merge strategy: interleave | concatenate", "interleave")
    .option("--chunks-per-vector <n>", "Max chunks per vector (1-10)", "3")
    .action(async (name, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const ragVectorIds = opts.vectors.split(",").map((s: string) => s.trim()).filter(Boolean);
        if (ragVectorIds.length < 2) {
          console.error(colors.red("Error: --vectors must contain at least 2 vector IDs"));
          process.exit(1);
        }

        const body: Record<string, unknown> = {
          name,
          ragVectorIds,
          mergeStrategy: opts.strategy,
          maxChunksPerVector: parseInt(opts.chunksPerVector, 10),
        };
        if (opts.description) {
          body.description = opts.description;
        }

        const data = await withSpinner("Creating group...", () =>
          httpClient.post<{ group: RagGroup }>(`${routeBase}/rag/groups`, body)
        );

        if (isJsonMode()) {
          output(data.group);
          return;
        }

        console.log(colors.green("Group created successfully."));
        printGroup(data.group);
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── update ───────────────────────────────────────────────────────────────
  groups
    .command("update <groupId>")
    .description("Update a group — name, description, merge strategy, or vectors")
    .option("--name <name>", "New group name")
    .option("--description <text>", "New description")
    .option("--strategy <type>", "Merge strategy: interleave | concatenate")
    .option("--chunks-per-vector <n>", "Max chunks per vector (1-10)")
    .option("--add-vector <id>", "Add a vector ID to the group (repeatable)", (val, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
    .option("--remove-vector <id>", "Remove a vector ID from the group (repeatable)", (val, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
    .option("--vectors <ids>", "Replace entire vector list (comma-separated, ≥2 IDs)")
    .action(async (groupId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        const body: Record<string, unknown> = {};
        if (opts.name) body.name = opts.name;
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.strategy) body.mergeStrategy = opts.strategy;
        if (opts.chunksPerVector) body.maxChunksPerVector = parseInt(opts.chunksPerVector, 10);
        if (opts.vectors) {
          body.ragVectorIds = opts.vectors.split(",").map((s: string) => s.trim()).filter(Boolean);
        }
        if ((opts.addVector as string[]).length > 0) body.addVectorIds = opts.addVector;
        if ((opts.removeVector as string[]).length > 0) body.removeVectorIds = opts.removeVector;

        if (Object.keys(body).length === 0) {
          console.error(colors.red("Error: provide at least one option to update (--name, --add-vector, --remove-vector, etc.)"));
          process.exit(1);
        }

        const data = await withSpinner("Updating group...", () =>
          httpClient.patch<{ group: RagGroup }>(`${routeBase}/rag/groups/${groupId}`, body)
        );

        if (isJsonMode()) {
          output(data.group);
          return;
        }

        console.log(colors.green("Group updated successfully."));
        printGroup(data.group);
      } catch (error) {
        handleCommandError(error);
      }
    });

  // ── delete ───────────────────────────────────────────────────────────────
  groups
    .command("delete <groupId>")
    .description("Archive (soft-delete) a group")
    .option("--yes", "Skip confirmation prompt")
    .action(async (groupId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const httpClient = client.getHttpClient();
        const routeBase = getRouteBase(config);

        if (!opts.yes && !isJsonMode()) {
          const { default: readline } = await import("readline");
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const confirmed = await new Promise<boolean>((resolve) => {
            rl.question(colors.yellow(`Archive group ${groupId}? This cannot be undone. (y/N) `), (answer) => {
              rl.close();
              resolve(answer.toLowerCase() === "y");
            });
          });
          if (!confirmed) {
            console.log(colors.dim("Aborted."));
            return;
          }
        }

        await withSpinner("Archiving group...", () =>
          httpClient.delete<{ success: boolean }>(`${routeBase}/rag/groups/${groupId}`)
        );

        if (isJsonMode()) {
          output({ success: true, groupId });
          return;
        }

        console.log(colors.green(`Group ${groupId} archived.`));
      } catch (error) {
        handleCommandError(error);
      }
    });
}
