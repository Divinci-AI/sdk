import { readFileSync, statSync } from "node:fs";
import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

const MAX_ANSWERS_FILE_BYTES = 5 * 1024 * 1024;
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 20 * 60_000;

/** Accepts `[{testId, text, latencyMs?}, ...]` or `{ "answers": [...] }`. */
export function parseAnswersFile(raw: string): Array<{ testId: string; text: string; latencyMs?: number }> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Answers file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const list = Array.isArray(json) ? json : (json as { answers?: unknown })?.answers;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("Answers file must be a non-empty JSON array of { testId, text } (or { \"answers\": [...] }).");
  }
  return list.map((item, i) => {
    const a = item as { testId?: unknown; text?: unknown; latencyMs?: unknown };
    if (typeof a?.testId !== "string" || typeof a?.text !== "string") {
      throw new Error(`Answer #${i + 1} needs a string "testId" and a string "text".`);
    }
    return {
      testId: a.testId,
      text: a.text,
      ...(typeof a.latencyMs === "number" ? { latencyMs: a.latencyMs } : {}),
    };
  });
}

export function registerQAExternalRunCommand(parent: Command): void {
  parent
    .command("external-run <suiteId>")
    .description(
      "Score answers from an AI system Divinci does not run, using the suite's own scorers. " +
      "Nothing is sent to that system; you supply its answers.",
    )
    .requiredOption("-t, --target <name>", "Name of the system being graded (reused across runs)")
    .requiredOption("-a, --answers <file>", "JSON file: [{ testId, text, latencyMs? }, ...]")
    .option("--description <text>", "Describe the system (kept on the target)")
    .option("--source-note <text>", "Where and when these answers were collected")
    .option("--judge-model <toolId>", "Judge model override for this run")
    .option("--confirm-cost", "Acknowledge a run with many judge calls (the server asks for this above 300)")
    .option("--wait", "Wait for the run to finish and print its summary")
    .action(async (suiteId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        if (statSync(opts.answers).size > MAX_ANSWERS_FILE_BYTES) {
          throw new Error(`Answers file is larger than ${MAX_ANSWERS_FILE_BYTES} bytes.`);
        }
        const answers = parseAnswersFile(readFileSync(opts.answers, "utf8"));

        const started = await withSpinner(
          `Scoring ${answers.length} answers from "${opts.target}"...`,
          () => client.qa.startExternalRun(workspaceId, suiteId, {
            targetName: opts.target,
            targetDescription: opts.description,
            sourceNote: opts.sourceNote,
            answers,
            judgeModelOverride: opts.judgeModel,
            confirmCost: opts.confirmCost ? true : undefined,
          }),
        );

        if (!opts.wait) {
          output(started, { keyValue: true });
          return;
        }

        const deadline = Date.now() + POLL_TIMEOUT_MS;
        for (;;) {
          const { run } = await client.qa.getExternalRun(workspaceId, started.runId);
          if (run.status !== "running") {
            output({ runId: started.runId, status: run.status, error: run.error, ...run.summary }, { keyValue: true });
            if (run.status === "failed") process.exitCode = 1;
            return;
          }
          if (Date.now() > deadline) {
            throw new Error(`Run ${started.runId} still running after ${POLL_TIMEOUT_MS / 60_000} minutes; check it with: divinci qa external-run-get ${started.runId}`);
          }
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("external-runs <suiteId>")
    .description("List a suite's external runs, newest first")
    .action(async (suiteId: string, _opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);
        const { runs } = await client.qa.listExternalRuns(workspaceId, suiteId);
        output(runs.map((r) => ({ runId: r._id, status: r.status, ...r.summary })));
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("external-run-get <runId>")
    .description("Show one external run: summary, report, and optionally the stored answers")
    .option("--answers", "Also fetch the stored answers")
    .action(async (runId: string, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);
        const data = await client.qa.getExternalRun(workspaceId, runId, { includeAnswers: !!opts.answers });
        output(data);
      } catch (error) {
        handleCommandError(error);
      }
    });
}

/** Read the API key from an environment variable or a file. Never from argv: `ps` is world-readable. */
export function readApiKey(opts: { apiKeyEnv?: string; apiKeyFile?: string }): string | undefined {
  if (opts.apiKeyEnv && opts.apiKeyFile) throw new Error("Use either --api-key-env or --api-key-file, not both.");
  if (opts.apiKeyEnv) {
    const v = process.env[opts.apiKeyEnv];
    if (!v) throw new Error(`Environment variable ${opts.apiKeyEnv} is not set.`);
    return v.trim();
  }
  if (opts.apiKeyFile) {
    const v = readFileSync(opts.apiKeyFile, "utf8").trim();
    if (!v) throw new Error(`${opts.apiKeyFile} is empty.`);
    return v;
  }
  return undefined;
}

export function registerQAExternalLiveCommands(parent: Command): void {
  const withClient = async (cmd: Command) => {
    const globalOpts = cmd.optsWithGlobals();
    let config = requireConfig(globalOpts);
    config = await ensureValidToken(config);
    return { workspaceId: requireWorkspaceId(config), client: createClient(config) };
  };

  parent
    .command("external-target-add")
    .description("Register an OpenAI-compatible endpoint to ask. The key is stored encrypted and never shown again.")
    .requiredOption("-n, --name <name>", "Name for this system")
    .requiredOption("--url <url>", "Full chat-completions URL (https, port 443, public hostname)")
    .requiredOption("--model <model>", "Model name to send")
    .option("--description <text>", "Describe the system")
    .option("--api-key-env <VAR>", "Read the API key from this environment variable")
    .option("--api-key-file <path>", "Read the API key from this file")
    .option("--timeout-ms <ms>", "Per-question timeout (default 60000)", (v) => parseInt(v, 10))
    .option("--rpm <n>", "Questions per minute to send (default 20)", (v) => parseInt(v, 10))
    .option("--terms-version <v>", "Terms version to acknowledge (the server names the current one if this is stale)", "2026-10-13")
    .option("--i-may-send-these-questions", "Confirm you may send the suite's questions to this system and that this does not breach its terms")
    .action(async (opts, cmd) => {
      try {
        if (!opts.iMaySendTheseQuestions) {
          throw new Error("Pass --i-may-send-these-questions to confirm you are permitted to send a suite's questions to this system and that doing so does not breach its terms of service.");
        }
        const { workspaceId, client } = await withClient(cmd);
        const apiKey = readApiKey(opts);
        const data = await withSpinner(`Registering "${opts.name}"...`, () =>
          client.qa.createExternalTarget(workspaceId, {
            name: opts.name,
            description: opts.description,
            url: opts.url,
            model: opts.model,
            apiKey,
            timeoutMs: opts.timeoutMs,
            rpmCap: opts.rpm,
            acknowledgeTerms: true,
            termsVersion: opts.termsVersion,
          }),
        );
        output(data.target, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("external-targets")
    .description("List registered external targets (keys are never shown)")
    .action(async (_opts, cmd) => {
      try {
        const { workspaceId, client } = await withClient(cmd);
        output((await client.qa.listExternalTargets(workspaceId)).targets);
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("external-target-remove <targetId>")
    .description("Delete an external target and its stored key")
    .action(async (targetId: string, _opts, cmd) => {
      try {
        const { workspaceId, client } = await withClient(cmd);
        output(await client.qa.deleteExternalTarget(workspaceId, targetId), { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("external-use <suiteId>")
    .description("Show, or set, whether this suite's questions may be sent outside Divinci")
    .option("--allow", "Record that the suite's owner has cleared its questions to be sent to third parties")
    .option("--deny", "Withdraw that")
    .option("--note <text>", "Who agreed and how (kept with the record)")
    .action(async (suiteId: string, opts, cmd) => {
      try {
        if (opts.allow && opts.deny) throw new Error("Use either --allow or --deny.");
        const { workspaceId, client } = await withClient(cmd);
        const data = opts.allow || opts.deny
          ? await client.qa.setExternalUse(workspaceId, suiteId, { allowed: !!opts.allow, note: opts.note })
          : await client.qa.getExternalUse(workspaceId, suiteId);
        output(data.externalUse, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("external-run-live <suiteId>")
    .description("Ask a registered target the suite's questions (prompts only) and score its replies")
    .requiredOption("--target-id <id>", "A target from `divinci qa external-targets`")
    .option("--test-ids <ids>", "Comma-separated subset of the suite's test ids")
    .option("--judge-model <toolId>", "Judge model override for this run")
    .option("--confirm-cost", "Acknowledge a run with many judge calls")
    .option("--wait", "Wait for the run to finish and print its summary")
    .action(async (suiteId: string, opts, cmd) => {
      try {
        const { workspaceId, client } = await withClient(cmd);
        const started = await withSpinner("Asking the target...", () =>
          client.qa.startLiveExternalRun(workspaceId, suiteId, {
            targetId: opts.targetId,
            testIds: opts.testIds ? String(opts.testIds).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined,
            judgeModelOverride: opts.judgeModel,
            confirmCost: opts.confirmCost ? true : undefined,
          }),
        );
        if (!opts.wait) {
          output(started, { keyValue: true });
          return;
        }
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        for (;;) {
          const { run } = await client.qa.getExternalRun(workspaceId, started.runId);
          if (run.status !== "running") {
            output({ runId: started.runId, status: run.status, error: run.error, ...run.summary }, { keyValue: true });
            if (run.status === "failed") process.exitCode = 1;
            return;
          }
          if (Date.now() > deadline) {
            throw new Error(`Run ${started.runId} still running after ${POLL_TIMEOUT_MS / 60_000} minutes; check it with: divinci qa external-run-get ${started.runId}`);
          }
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  parent
    .command("external-run-compare <runId>")
    .description("Compare an external run with another external run or a release (paired, with interval and disclosure)")
    .requiredOption("--against <spec>", "external:<runId> or release:<runResultId>:<releaseId>")
    .option("--replicate-sd <n>", "Judge noise measured on this kind of answer, in score units (0 to 0.5)", (v) => parseFloat(v))
    .action(async (runId: string, opts, cmd) => {
      try {
        const { workspaceId, client } = await withClient(cmd);
        const data = await client.qa.compareExternalRun(workspaceId, runId, { against: opts.against, replicateSd: opts.replicateSd });
        output(data);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
