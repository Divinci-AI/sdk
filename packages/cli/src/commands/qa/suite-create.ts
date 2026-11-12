import { Command } from "commander";
import { readFileSync } from "node:fs";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

/**
 * `divinci qa suites create` and `divinci qa tests add`.
 *
 * Until these existed there was no way to make a suite from the CLI. RAG race
 * take 11 (2026-10-04): the agent tried POST /scored-qa/suites at least 15
 * times and got "400 bad form data" — scoreGenerators and suggestionGeneration
 * are required, strict, and documented nowhere a CLI user can see — before
 * reverse-engineering `qa export` output and hand-writing an import file.
 *
 * Both call the OAuth-friendly white-label routes directly, like
 * `qa suites list` (the SDK's /api/v1/qa routes are API-key-only).
 */

export interface QATestRow {
  prompt: string;
  expectedResponse: string;
}

const BULK_LIMIT = 1000;

/**
 * Parse a tests file. Accepts a JSON array, an object with a `tests` array
 * (so a `qa export` file works), or JSONL. Each row needs `prompt` and
 * `expectedResponse`; `question`/`expected`/`answer` are accepted as aliases.
 * Throws naming the first bad row rather than sending a 400-bound request.
 */
export function parseTestsFile(text: string): QATestRow[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("tests file is empty");

  let rows: unknown[];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = undefined;
    }
    if (Array.isArray(parsed)) rows = parsed;
    else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { tests?: unknown }).tests)) {
      rows = (parsed as { tests: unknown[] }).tests;
    } else {
      rows = parseJsonl(trimmed);
    }
  } else {
    rows = parseJsonl(trimmed);
  }

  return rows.map((row, i) => {
    const r = (row ?? {}) as Record<string, unknown>;
    const prompt = pickString(r, ["prompt", "question"]);
    const expectedResponse = pickString(r, ["expectedResponse", "expected", "answer"]);
    if (!prompt || !expectedResponse) {
      throw new Error(`row ${i + 1}: needs a non-empty "prompt" and "expectedResponse"`);
    }
    return { prompt, expectedResponse };
  });
}

function parseJsonl(text: string): unknown[] {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((line, i) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`line ${i + 1} is not valid JSON (expected a JSON array, {"tests": [...]}, or JSONL)`);
    }
  });
}

function pickString(r: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

type Ctx = { baseUrl: string, workspaceId: string, token: string };

async function context(cmd: Command): Promise<Ctx> {
  let config = requireConfig(cmd.optsWithGlobals());
  config = await ensureValidToken(config);
  return {
    baseUrl: config.apiUrl.replace(/\/+$/, ""),
    workspaceId: requireWorkspaceId(config),
    token: config.accessToken as string,
  };
}

async function call<T>(ctx: Ctx, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ctx.baseUrl}/white-label/${ctx.workspaceId}/scored-qa${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${path}: ${text.substring(0, 400)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response from ${path}: ${text.substring(0, 200)}`);
  }
}

async function addTests(ctx: Ctx, suiteId: string, tests: QATestRow[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < tests.length; i += BULK_LIMIT) {
    const batch = tests.slice(i, i + BULK_LIMIT);
    const r = await call<{ addedTestIds?: string[] }>(ctx, "POST", `/suites/${suiteId}/tests/bulk`, { tests: batch });
    added += r.addedTestIds?.length ?? batch.length;
  }
  return added;
}

export function registerQASuitesCreateCommand(parent: Command): void {
  parent
    .command("create")
    .description("Create a QA suite, optionally with tests from a file")
    .requiredOption("--name <name>", "Suite name")
    .option("--description <text>", "Suite description", "")
    .option("--scorers-from <suiteId>", "Copy scoreGenerators + suggestionGeneration from this suite instead of the defaults")
    .option("--tests <file>", "Add tests from a file: JSON array, {\"tests\": [...]}, or JSONL of {prompt, expectedResponse}")
    .addHelpText("after", `
With no --scorers-from the server gives the suite its default scorers
(correctness, relevance, completeness) and suggestion setup, so it is ready
for \`qa run\` and \`qa auto-fix\`. Use --scorers-from to copy a specific set.

Tests file example (JSONL):
  {"prompt": "How many moons does Mars have?", "expectedResponse": "Two: Phobos and Deimos."}`)
    .action(async (opts: { name: string, description: string, scorersFrom?: string, tests?: string }, cmd: Command) => {
      try {
        const tests = opts.tests ? parseTestsFile(readFileSync(opts.tests, "utf8")) : [];
        const ctx = await context(cmd);

        // Left out unless copied: the server fills in the platform defaults
        // (correctness/relevance/completeness + the jev-select-passage
        // suggestor). The empty merger the web form starts from is rejected,
        // so there is no valid "empty" body to send.
        let scoreGenerators: unknown[] | undefined;
        let suggestionGeneration: unknown;
        if (opts.scorersFrom) {
          const src = await call<{ scoreGenerators?: unknown[], suggestionGeneration?: unknown }>(
            ctx, "GET", `/suites/${opts.scorersFrom}`,
          );
          scoreGenerators = src.scoreGenerators ?? [];
          suggestionGeneration = src.suggestionGeneration;
        }

        const suite = await withSpinner("Creating suite...", () => call<{ _id: string, name: string, scoreGenerators?: unknown[] }>(
          ctx, "POST", "/suites",
          {
            name: opts.name,
            description: opts.description,
            ...(scoreGenerators !== undefined && { scoreGenerators }),
            ...(suggestionGeneration !== undefined && { suggestionGeneration }),
          },
        ));
        const added = tests.length > 0
          ? await withSpinner(`Adding ${tests.length} test(s)...`, () => addTests(ctx, suite._id, tests))
          : 0;

        output({
          _id: suite._id,
          name: suite.name,
          testsAdded: added,
          scorers: suite.scoreGenerators?.length ?? scoreGenerators?.length ?? 0,
        }, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export function registerQATestsAddCommand(parent: Command): void {
  parent
    .command("add <suiteId>")
    .description("Add tests to a QA suite from a file, or one test from flags")
    .option("--file <file>", "JSON array, {\"tests\": [...]}, or JSONL of {prompt, expectedResponse}")
    .option("--prompt <text>", "A single test's prompt")
    .option("--expected <text>", "A single test's expected response")
    .action(async (suiteId: string, opts: { file?: string, prompt?: string, expected?: string }, cmd: Command) => {
      try {
        let tests: QATestRow[];
        if (opts.file) {
          tests = parseTestsFile(readFileSync(opts.file, "utf8"));
        } else if (opts.prompt && opts.expected) {
          tests = [{ prompt: opts.prompt, expectedResponse: opts.expected }];
        } else {
          throw new Error("Pass --file <file>, or both --prompt and --expected");
        }
        const ctx = await context(cmd);
        const added = await withSpinner(`Adding ${tests.length} test(s)...`, () => addTests(ctx, suiteId, tests));
        output({ suiteId, testsAdded: added }, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
