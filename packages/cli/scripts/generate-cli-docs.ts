/**
 * Generate CLI docs by walking the Commander tree.
 *
 * Imports the built CLI program, introspects every command/flag/argument,
 * and emits a structured JSON file that the /cli docs page reads to render a
 * Redoc-style reference.
 *
 * Run with:
 *   pnpm run docs:generate
 *
 * Outputs:
 *   - Primary:   docs/cli/cli-commands.json (in the server repo, committed)
 *   - Secondary: divinci.ai/new-divinci-zola-site/static/cli-commands.json
 *                (best-effort mirror; skipped silently in CI where the
 *                divinci.ai repo isn't cloned)
 *
 * The primary output is what the CI drift check compares against. The
 * secondary is a convenience for local dev so the Zola site reflects
 * changes without needing a manual copy. Override the primary with
 * --out <path>.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command, Option } from "commander";

import { createProgram } from "../dist/src/index.js";

interface DocOption {
  flags: string;
  short: string | null;
  long: string | null;
  description: string;
  /** True if the option itself must be specified (Commander `.mandatory`). */
  mandatory: boolean;
  /** "required" = takes `<value>`, "optional" = takes `[value]`, "none" = boolean flag. */
  valueMode: "required" | "optional" | "none";
  negate: boolean;
  defaultValue: unknown;
  choices: string[] | null;
}

interface DocArgument {
  name: string;
  required: boolean;
  variadic: boolean;
  description: string;
  defaultValue: unknown;
}

interface DocCommand {
  path: string[];
  name: string;
  aliases: string[];
  description: string;
  summary: string;
  usage: string;
  arguments: DocArgument[];
  options: DocOption[];
  examples: string[];
  subcommands: DocCommand[];
}

interface DocGroup {
  name: string;
  description: string;
  aliases: string[];
  commands: DocCommand[];
}

interface DocOutput {
  version: string;
  binary: string;
  description: string;
  globalOptions: DocOption[];
  groups: DocGroup[];
  standaloneCommands: DocCommand[];
}

function extractOption(opt: Option): DocOption {
  // Commander's Option has both public getters and private fields.
  // We pull what's reliably exposed.
  const flags = opt.flags;
  const short = opt.short ?? null;
  const long = opt.long ?? null;
  const description = opt.description ?? "";
  const defaultValue =
    typeof opt.defaultValue === "function" ? null : (opt.defaultValue ?? null);
  const choices = (opt as unknown as { argChoices?: string[] }).argChoices ?? null;
  const mandatory =
    (opt as unknown as { mandatory?: boolean }).mandatory ?? false;

  // Disambiguate: `.required` means "takes a required value" (`<value>` syntax),
  // `.optional` means "takes an optional value" (`[value]` syntax),
  // neither means it's a boolean flag like `--wait`.
  let valueMode: "required" | "optional" | "none" = "none";
  if (opt.required) valueMode = "required";
  else if (opt.optional) valueMode = "optional";

  return {
    flags,
    short,
    long,
    description,
    mandatory,
    valueMode,
    negate: opt.negate,
    defaultValue,
    choices,
  };
}

function extractArgument(arg: {
  _name?: string;
  name?: () => string;
  description?: string;
  required?: boolean;
  variadic?: boolean;
  defaultValue?: unknown;
}): DocArgument {
  const name =
    typeof arg.name === "function"
      ? arg.name()
      : (arg._name ?? "arg");
  return {
    name,
    required: arg.required ?? false,
    variadic: arg.variadic ?? false,
    description: arg.description ?? "",
    defaultValue: arg.defaultValue ?? null,
  };
}

function buildPath(cmd: Command): string[] {
  const path: string[] = [];
  let node: Command | null = cmd;
  while (node && node.name() !== "divinci") {
    path.unshift(node.name());
    node = node.parent;
  }
  return path;
}

function formatUsage(cmd: DocCommand): string {
  const segments = ["divinci", ...cmd.path];
  for (const arg of cmd.arguments) {
    const label = arg.variadic ? `${arg.name}...` : arg.name;
    segments.push(arg.required ? `<${label}>` : `[${label}]`);
  }
  if (cmd.options.length > 0) segments.push("[options]");
  return segments.join(" ");
}

function deriveExamples(cmd: DocCommand): string[] {
  // Deterministic, minimal examples built from the command shape.
  // A follow-up pass can merge with a hand-curated overrides file.
  const required = cmd.arguments.filter((a) => a.required);
  const base = ["divinci", ...cmd.path];
  const minimal = [...base];
  for (const arg of required) {
    minimal.push(`<${arg.name}>`);
  }
  const examples: string[] = [minimal.join(" ")];

  // Add an example with the first mandatory or value-taking flag if one exists
  const firstValueFlag = cmd.options.find(
    (o) => !o.negate && o.valueMode !== "none" && o.long,
  );
  if (firstValueFlag) {
    examples.push(`${minimal.join(" ")} ${firstValueFlag.long} <value>`);
  }

  return examples;
}

function walkCommand(cmd: Command): DocCommand {
  const path = buildPath(cmd);
  const subcommands: DocCommand[] = [];

  for (const child of cmd.commands ?? []) {
    // Skip the default `help` subcommand Commander auto-adds
    if (child.name() === "help") continue;
    subcommands.push(walkCommand(child));
  }

  const opts = (cmd.options ?? []).map(extractOption);
  const args = (
    (cmd as unknown as { registeredArguments?: unknown[] }).registeredArguments ?? []
  ).map((a) => extractArgument(a as Parameters<typeof extractArgument>[0]));

  const description = cmd.description() ?? "";
  const summary = description.split(/[.\n]/)[0]?.trim() ?? "";

  const doc: DocCommand = {
    path,
    name: cmd.name(),
    aliases: cmd.aliases() ?? [],
    description,
    summary,
    usage: "",
    arguments: args,
    options: opts,
    examples: [],
    subcommands,
  };

  doc.usage = formatUsage(doc);
  doc.examples = deriveExamples(doc);

  return doc;
}

function parseArgs(argv: string[]): { out?: string } {
  const result: { out?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    if ((argv[i] === "--out" || argv[i] === "-o") && argv[i + 1]) {
      result.out = argv[i + 1];
      i++;
    }
  }
  return result;
}

async function main(): Promise<void> {
  const program = createProgram();

  // Global options live on the root program itself.
  const globalOptions: DocOption[] = (program.options ?? []).map(extractOption);

  const groups: DocGroup[] = [];
  const standaloneCommands: DocCommand[] = [];

  for (const child of program.commands ?? []) {
    if (child.name() === "help") continue;
    const walked = walkCommand(child);
    // A "group" is any top-level command that itself has subcommands
    if (walked.subcommands.length > 0) {
      groups.push({
        name: walked.name,
        description: walked.description,
        aliases: walked.aliases,
        commands: walked.subcommands,
      });
    } else {
      standaloneCommands.push(walked);
    }
  }

  const output: DocOutput = {
    version: program.version() ?? "0.0.0",
    binary: program.name(),
    description: program.description() ?? "",
    globalOptions,
    groups,
    standaloneCommands,
  };

  const { out } = parseArgs(process.argv);
  const __dirname = dirname(fileURLToPath(import.meta.url));

  // Primary output: server repo, committed alongside the OpenAPI spec at
  // docs/cli/cli-commands.json. From this file at
  // workspace/sdk/packages/cli/scripts/, that's five directories up.
  const primaryOut = out
    ? resolve(process.cwd(), out)
    : resolve(__dirname, "../../../../../docs/cli/cli-commands.json");

  mkdirSync(dirname(primaryOut), { recursive: true });
  const payload = JSON.stringify(output, null, 2) + "\n";
  writeFileSync(primaryOut, payload, "utf8");

  const totalCommands =
    standaloneCommands.length +
    groups.reduce((sum, g) => sum + g.commands.length, 0);
  console.log(
    `Wrote ${totalCommands} commands across ${groups.length} groups to ${primaryOut}`,
  );

  // Secondary (best-effort) mirror: the divinci.ai Zola site's static folder,
  // so local devs who have the site repo cloned next to the server repo
  // don't need an extra copy step. Skipped silently if the target directory
  // doesn't exist (e.g., in CI where the divinci.ai repo isn't checked out).
  if (!out) {
    const zolaMirror = resolve(
      __dirname,
      "../../../../../../divinci.ai/new-divinci-zola-site/static/cli-commands.json",
    );
    if (existsSync(dirname(zolaMirror))) {
      writeFileSync(zolaMirror, payload, "utf8");
      console.log(`Mirrored to Zola static  → ${zolaMirror}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
