/**
 * `divinci style-pattern *` — CLI for per-workspace style-pattern rules.
 *
 * Mirrors the Divinci Agent's stylePattern* tools and the SDK
 * StylePatternNamespace surface: list/test/approve/reject/toggle, plus
 * the captured-edits and audit-log feeds.
 *
 * Spec: notebooks/STYLE_PATTERN_INTEGRATION_GOAL.md
 */

import { Command } from "commander";
import {
  requireConfig,
  requireWorkspaceId,
  ensureValidToken,
} from "../../config/config-manager.js";
import { handleCommandError } from "../../utils/errors.js";

// ─── Shared helpers ─────────────────────────────────────────────────────────

async function fetchJson<T>(
  url: string,
  token: string,
  init: { method?: string; body?: Record<string, unknown> } = {},
): Promise<T> {
  const fetchInit: RequestInit = {
    method: init.method ?? "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  };
  if (init.body) fetchInit.body = JSON.stringify(init.body);

  const resp = await fetch(url, fetchInit);
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

interface CommandContext {
  apiBase: string;
  token: string;
  workspaceId: string;
}

async function resolveContext(globalOpts: Record<string, unknown>): Promise<CommandContext> {
  let config = requireConfig(globalOpts);
  config = await ensureValidToken(config);
  return {
    apiBase: config.apiUrl,
    token: config.accessToken ?? config.apiKey ?? "",
    workspaceId: requireWorkspaceId(config),
  };
}

// ─── Tier resolver (mirrors @divinci-ai/models) ─────────────────────────────

interface MinimalRule {
  substitutionTemplate?: string | null;
  rewriteInstruction?: string;
  rewriteFullResponse?: boolean;
}
function resolveTier(r: MinimalRule): string {
  if (r.rewriteFullResponse === true) return "llm-full";
  if (typeof r.substitutionTemplate === "string" && r.substitutionTemplate.length > 0) return "deterministic";
  if (typeof r.rewriteInstruction === "string" && r.rewriteInstruction.length > 0) return "llm-span";
  return "flag-only";
}

// ─── Command 1: list rules ──────────────────────────────────────────────────

interface ListRulesResponse {
  patterns: Array<{
    _id: string;
    category: string;
    ruleDescription: string;
    substitutionTemplate?: string | null;
    rewriteInstruction?: string;
    rewriteFullResponse?: boolean;
    enforcement?: "cosmetic" | "guardrail";
    failClosed?: boolean;
    useClassifier?: boolean;
    enabled: boolean;
    priority: number;
    severity: number;
    triggerCount: number;
    lastTriggeredAt?: string | null;
  }>;
  total: number;
}

export function registerStylePatternListCommand(parent: Command): void {
  parent
    .command("list")
    .description("List the workspace's style-pattern rules")
    .option("--category <cat>", "Filter to one category (persona-impersonation, rag-metacommentary, chunk-truncation, preamble-verbosity, ai-disclaimer, other)")
    .option("--enabled", "Show only enabled rules")
    .option("--disabled", "Show only disabled rules")
    .option("--json", "Emit JSON instead of a summary")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const { apiBase, token, workspaceId } = await resolveContext(globalOpts);
        const url = new URL(`${apiBase}/white-label/${workspaceId}/style-pattern`);
        if (opts.category) url.searchParams.set("category", opts.category);
        if (opts.enabled) url.searchParams.set("enabled", "true");
        if (opts.disabled) url.searchParams.set("enabled", "false");

        const result = await fetchJson<ListRulesResponse>(url.toString(), token);
        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.warn(`Total: ${result.total} · showing ${result.patterns.length}`);
        for (const r of result.patterns) {
          const state = r.enabled ? "✓" : "✗";
          const tier = resolveTier(r);
          const guard = r.enforcement === "guardrail"
            ? `/GUARDRAIL${r.failClosed ? "+failclosed" : ""}${r.useClassifier ? "+classifier" : ""}` : "";
          console.warn(`  ${state} ${r._id}  [${r.category}/${tier}${guard}]  p=${r.priority} s=${r.severity}  fires=${r.triggerCount}`);
          console.warn(`    ${r.ruleDescription.substring(0, 120)}${r.ruleDescription.length > 120 ? "..." : ""}`);
        }
      } catch (e) { handleCommandError(e); }
    });
}

// ─── Command 2: list proposed ───────────────────────────────────────────────

interface ListProposedResponse {
  proposed: Array<{
    _id: string;
    category: string;
    ruleDescription: string;
    regex: string;
    sampleEditIds: string[];
    reviewed: boolean;
    rejectedReason?: string | null;
    proposedAt: string;
  }>;
  total: number;
}

export function registerStylePatternListProposedCommand(parent: Command): void {
  parent
    .command("list-proposed")
    .description("List proposed rules awaiting review (mining queue)")
    .option("--reviewed", "Show already-actioned proposals instead of pending")
    .option("--limit <n>", "Max rows (default 50)", (v) => parseInt(v, 10))
    .option("--json", "Emit JSON instead of a summary")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const { apiBase, token, workspaceId } = await resolveContext(globalOpts);
        const url = new URL(`${apiBase}/white-label/${workspaceId}/style-pattern/proposed`);
        if (opts.reviewed) url.searchParams.set("reviewed", "true");
        else url.searchParams.set("reviewed", "false");
        if (typeof opts.limit === "number") url.searchParams.set("limit", String(opts.limit));

        const result = await fetchJson<ListProposedResponse>(url.toString(), token);
        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.warn(`Total: ${result.total} · showing ${result.proposed.length}`);
        for (const p of result.proposed) {
          const status = p.reviewed
            ? p.rejectedReason ? `rejected (${p.rejectedReason.substring(0, 40)})` : "approved"
            : "pending";
          console.warn(`  ${p._id}  [${p.category}]  ${status}  · ${p.sampleEditIds.length} examples`);
          console.warn(`    ${p.ruleDescription.substring(0, 120)}`);
          console.warn(`    regex: ${p.regex.substring(0, 120)}`);
        }
      } catch (e) { handleCommandError(e); }
    });
}

// ─── Command 3: list captured edits ─────────────────────────────────────────

interface ListExamplesResponse {
  items: Array<{
    _id: string;
    source: string;
    original: string;
    edited: string;
    category?: string | null;
    lastProcessedAt?: string | null;
    createdAt: string;
  }>;
  count: number;
  limit: number;
}

export function registerStylePatternListEditsCommand(parent: Command): void {
  parent
    .command("list-edits")
    .description("List captured ResponseEditExample docs (raw admin/calibrator edits)")
    .option("--source <s>", "Filter by source: transcript-edit | calibration-edit")
    .option("--processed", "Only return docs the mining worker has already processed")
    .option("--unprocessed", "Only return docs awaiting mining")
    .option("--limit <n>", "Max rows (default 200, capped at 1000)", (v) => parseInt(v, 10))
    .option("--format <fmt>", "Output format: json (default) | jsonl (one example per line for SFT export)")
    .option("--json", "Emit JSON instead of a summary")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const { apiBase, token, workspaceId } = await resolveContext(globalOpts);
        const url = new URL(`${apiBase}/white-label/${workspaceId}/style-pattern/examples`);
        if (opts.source) url.searchParams.set("source", opts.source);
        if (opts.processed) url.searchParams.set("processed", "true");
        if (opts.unprocessed) url.searchParams.set("processed", "false");
        if (typeof opts.limit === "number") url.searchParams.set("limit", String(opts.limit));
        if (opts.format) url.searchParams.set("format", opts.format);

        // jsonl format is streaming-friendly; surface raw text to stdout
        if (opts.format === "jsonl") {
          const resp = await fetch(url.toString(), {
            headers: { "Authorization": `Bearer ${token}` },
          });
          const text = await resp.text();
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.substring(0, 300)}`);
          process.stdout.write(text);
          return;
        }

        const result = await fetchJson<ListExamplesResponse>(url.toString(), token);
        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.warn(`Total: ${result.count} · limit ${result.limit}`);
        if (result.items.length === 0) {
          console.warn("(no captured edits — verify STYLE_PATTERN_CAPTURE_ENABLED=true in Infisical)");
          return;
        }
        for (const e of result.items) {
          const cat = e.category ? ` [${e.category}]` : "";
          const status = e.lastProcessedAt ? " ✓mined" : "";
          console.warn(`  ${e._id}  (${e.source})${cat}${status}  ${e.createdAt}`);
          console.warn(`    before: ${e.original.substring(0, 100)}${e.original.length > 100 ? "..." : ""}`);
          console.warn(`    after:  ${e.edited.substring(0, 100)}${e.edited.length > 100 ? "..." : ""}`);
        }
      } catch (e) { handleCommandError(e); }
    });
}

// ─── Command 4: test rewrite ────────────────────────────────────────────────

interface TestRewriteResponse {
  original: string;
  rewritten: string;
  changed: boolean;
  appliedRuleIds: string[];
  deferredMatches: Array<{ ruleId: string; matchText: string; category: string }>;
  totalMatches: number;
  elapsedMs: number;
}

export function registerStylePatternTestRewriteCommand(parent: Command): void {
  parent
    .command("test-rewrite")
    .description("Dry-run the workspace's enabled rules against a sample text")
    .requiredOption("--sample <text>", "The text to test (use quotes for multi-word; or '-' to read stdin)")
    .option("--release-id <id>", "Restrict to this release's rules (plus workspace-wide rules)")
    .option("--json", "Emit JSON instead of a summary")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const { apiBase, token, workspaceId } = await resolveContext(globalOpts);

        let sample = opts.sample as string;
        if (sample === "-") {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
          sample = Buffer.concat(chunks).toString("utf8");
        }

        const body: Record<string, unknown> = { response: sample };
        if (opts.releaseId) body.releaseId = opts.releaseId;

        const url = `${apiBase}/white-label/${workspaceId}/style-pattern/test-rewrite`;
        const result = await fetchJson<TestRewriteResponse>(url, token, { method: "POST", body });

        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.warn(`changed=${result.changed}  matches=${result.totalMatches}  applied=${result.appliedRuleIds.length}  deferred=${result.deferredMatches.length}  (${result.elapsedMs}ms)`);
        console.warn("");
        console.warn("--- original ---");
        console.warn(result.original);
        console.warn("");
        console.warn("--- rewritten ---");
        console.warn(result.rewritten);
        if (result.deferredMatches.length > 0) {
          console.warn("");
          console.warn("--- deferred (T2 LLM rewrite candidates) ---");
          for (const m of result.deferredMatches) {
            console.warn(`  ${m.ruleId} [${m.category}]: "${m.matchText.substring(0, 100)}"`);
          }
        }
      } catch (e) { handleCommandError(e); }
    });
}

// ─── Command 5/6: approve / reject proposed ─────────────────────────────────

export function registerStylePatternApproveCommand(parent: Command): void {
  parent
    .command("approve <proposedId>")
    .description("Promote a proposed rule into StylePatternKV (created disabled — enable separately)")
    .option("--description <text>", "Updated rule description (optional override)")
    .option("--json", "Emit JSON instead of a summary")
    .action(async (proposedId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const { apiBase, token, workspaceId } = await resolveContext(globalOpts);
        const body: Record<string, unknown> = {};
        if (opts.description) body.editedDescription = opts.description;
        const url = `${apiBase}/white-label/${workspaceId}/style-pattern/proposed/${proposedId}/approve`;
        const result = await fetchJson<{ promotedKvId: string; reviewed: boolean }>(url, token, { method: "POST", body });
        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.warn(`✓ Approved ${proposedId} → KV ${result.promotedKvId} (disabled)`);
        console.warn(`  Run \`divinci style-pattern toggle ${result.promotedKvId} --on\` to enable.`);
      } catch (e) { handleCommandError(e); }
    });
}

export function registerStylePatternRejectCommand(parent: Command): void {
  parent
    .command("reject <proposedId>")
    .description("Reject a proposed rule with a stored reason")
    .requiredOption("--reason <text>", "Short rationale stored on the proposal")
    .option("--json", "Emit JSON instead of a summary")
    .action(async (proposedId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const { apiBase, token, workspaceId } = await resolveContext(globalOpts);
        const url = `${apiBase}/white-label/${workspaceId}/style-pattern/proposed/${proposedId}/reject`;
        const result = await fetchJson<{ reviewed: boolean; rejectedReason: string }>(
          url, token, { method: "POST", body: { rejectedReason: opts.reason } },
        );
        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.warn(`✓ Rejected ${proposedId}: ${opts.reason}`);
      } catch (e) { handleCommandError(e); }
    });
}

// ─── Command 7: toggle rule ─────────────────────────────────────────────────

export function registerStylePatternToggleCommand(parent: Command): void {
  parent
    .command("toggle <ruleId>")
    .description("Enable or disable a StylePatternKV rule")
    .option("--on", "Enable the rule")
    .option("--off", "Disable the rule")
    .option("--json", "Emit JSON instead of a summary")
    .action(async (ruleId, opts, cmd) => {
      try {
        if (!opts.on && !opts.off) {
          throw new Error("Pass either --on or --off");
        }
        if (opts.on && opts.off) {
          throw new Error("--on and --off are mutually exclusive");
        }
        const globalOpts = cmd.optsWithGlobals();
        const { apiBase, token, workspaceId } = await resolveContext(globalOpts);
        const url = `${apiBase}/white-label/${workspaceId}/style-pattern/${ruleId}`;
        const enabled = Boolean(opts.on);
        const result = await fetchJson<{ pattern: { _id: string; enabled: boolean; category: string; priority: number; triggerCount: number } }>(
          url, token, { method: "POST", body: { enabled } },
        );
        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const r = result.pattern;
        console.warn(`✓ Rule ${r._id} ${r.enabled ? "enabled" : "disabled"} (${r.category}, priority ${r.priority}, ${r.triggerCount} fires)`);
      } catch (e) { handleCommandError(e); }
    });
}

// ─── Command 7b: create a rule ──────────────────────────────────────────────

interface CreateRuleResponse {
  item: {
    _id: string;
    category: string;
    regex: string;
    ruleDescription: string;
    substitutionTemplate?: string | null;
    rewriteInstruction?: string;
    enforcement?: "cosmetic" | "guardrail";
    failClosed?: boolean;
    useClassifier?: boolean;
    enabled: boolean;
    enabledForReleaseIds?: string[] | null;
    priority: number;
    severity: number;
  };
}

export function registerStylePatternCreateCommand(parent: Command): void {
  parent
    .command("create")
    .description("Create a style-pattern guideline rule (regex finds non-compliant lines; the rewrite brings them into compliance)")
    .option("--regex <pattern>", "Regex that finds non-compliant spans (DoS-validated server-side). Optional only with --use-classifier.")
    .requiredOption("--rule-description <text>", "Human-readable guideline (what compliance means) — min 10 chars")
    .option("--category <cat>", "Rule category", "domain-guideline")
    .option("--regex-flags <flags>", "Regex flags (subset of i,m,s,u; default i)")
    .option("--substitution-template <tpl>", "Tier-1 deterministic replacement ($1/$2 capture refs). Mutually exclusive with --rewrite-instruction.")
    .option("--rewrite-instruction <text>", "Tier-2 guideline rewrite — an LLM rewrites each matched span to comply (use when there's no fixed substitution)")
    .option("--rewrite-full-response", "Tier-3 full-response rewrite (NOT yet supported at runtime — rejected by the server)")
    .option("--advisory-text <text>", "Soft-advisory banner shown to the user when this rule rewrites a span (e.g. 'Talk to your physician before changing medications')")
    .option("--system-directive <text>", "Proactive prompt directive injected into the chat prompt for releases this rule is active on (prevents the violation up front)")
    .option("--enforcement <tier>", "Enforcement tier: cosmetic (default, fail-open) | guardrail (fail-to-redaction, forces buffer-rewrite, audited)")
    .option("--fail-closed", "Guardrail-only: suppress the whole reply (vs redact the span) when a fix can't be produced")
    .option("--use-classifier", "Guardrail-only T0: detect via an LLM classifier over the full response for violations no regex expresses (regex becomes an optional pre-filter)")
    .option("--release <releaseId...>", "Scope the rule to one or more release IDs (repeatable). Omit for all releases in the workspace.")
    .option("--priority <n>", "Conflict-resolution priority (-100..100, higher wins)", (v) => parseInt(v, 10))
    .option("--severity <n>", "Severity weight 0..1 (default 1)", (v) => parseFloat(v))
    .option("--enabled", "Create the rule enabled (default: disabled — toggle on after review)")
    .option("--json", "Emit JSON instead of a summary")
    .action(async (opts, cmd) => {
      try {
        // failClosed / useClassifier are guardrail-only — auto-promote a rule to
        // guardrail when either is set (the server would otherwise 400), warning
        // so the operator knows the failure posture changed.
        let enforcement: string = opts.enforcement ?? "cosmetic";
        if ((opts.failClosed || opts.useClassifier) && enforcement !== "guardrail") {
          console.warn("ℹ --fail-closed/--use-classifier imply a guardrail rule — setting --enforcement guardrail.");
          enforcement = "guardrail";
        }
        const isGuardrail = enforcement === "guardrail";

        // regex is required unless the classifier is the detector.
        if (!opts.regex && !opts.useClassifier) {
          throw new Error("--regex is required (omit only with --use-classifier, where the classifier is the detector).");
        }
        // A cosmetic rule needs a rewrite action; a guardrail can be flag-only
        // (it redacts on match) so it doesn't require one.
        if (!isGuardrail && !opts.substitutionTemplate && !opts.rewriteInstruction && !opts.rewriteFullResponse && !opts.systemDirective) {
          throw new Error("Provide an action: a rewrite (--substitution-template / --rewrite-instruction / --rewrite-full-response) and/or a --system-directive.");
        }
        const globalOpts = cmd.optsWithGlobals();
        const { apiBase, token, workspaceId } = await resolveContext(globalOpts);
        const body: Record<string, unknown> = {
          category: opts.category,
          ruleDescription: opts.ruleDescription,
        };
        if (opts.regex) body.regex = opts.regex;
        if (opts.regexFlags) body.regexFlags = opts.regexFlags;
        if (opts.substitutionTemplate) body.substitutionTemplate = opts.substitutionTemplate;
        if (opts.rewriteInstruction) body.rewriteInstruction = opts.rewriteInstruction;
        if (opts.rewriteFullResponse) body.rewriteFullResponse = true;
        if (opts.advisoryText) body.advisoryText = opts.advisoryText;
        if (opts.systemDirective) body.systemDirective = opts.systemDirective;
        if (isGuardrail) body.enforcement = "guardrail";
        if (opts.failClosed) body.failClosed = true;
        if (opts.useClassifier) body.useClassifier = true;
        if (opts.release) body.enabledForReleaseIds = opts.release;
        if (typeof opts.priority === "number" && !Number.isNaN(opts.priority)) body.priority = opts.priority;
        if (typeof opts.severity === "number" && !Number.isNaN(opts.severity)) body.severity = opts.severity;
        if (opts.enabled) body.enabled = true;

        const url = `${apiBase}/white-label/${workspaceId}/style-pattern`;
        const result = await fetchJson<CreateRuleResponse>(url, token, { method: "POST", body });
        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const r = result.item;
        const tier = resolveTier(r);
        const scope = r.enabledForReleaseIds && r.enabledForReleaseIds.length > 0
          ? `releases [${r.enabledForReleaseIds.join(", ")}]` : "all releases";
        const guard = r.enforcement === "guardrail"
          ? ` GUARDRAIL${r.failClosed ? "/fail-closed" : ""}${r.useClassifier ? "/classifier" : ""}` : "";
        console.warn(`✓ Created rule ${r._id} (${r.category}, tier=${tier}${guard}, ${r.enabled ? "ENABLED" : "disabled"}, ${scope})`);
        if (!r.enabled) console.warn(`  Toggle on when ready:  divinci sp toggle ${r._id} --on`);
      } catch (e) { handleCommandError(e); }
    });
}

// ─── Command 8: audit log ───────────────────────────────────────────────────

interface AuditResponse {
  entries: Array<{
    _id: string;
    ts: string;
    userId: string;
    action: string;
    entity: string;
    entityId: string;
  }>;
  total: number;
}

export function registerStylePatternAuditCommand(parent: Command): void {
  parent
    .command("audit")
    .description("Read style-pattern admin audit log")
    .option("--action <a>", "Filter to one action type (kv.enable, kv.disable, proposed.approve, ...)")
    .option("--entity-id <id>", "Filter to one rule or proposal")
    .option("--limit <n>", "Max entries (default 50)", (v) => parseInt(v, 10))
    .option("--json", "Emit JSON instead of a summary")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const { apiBase, token, workspaceId } = await resolveContext(globalOpts);
        const url = new URL(`${apiBase}/white-label/${workspaceId}/style-pattern/audit`);
        if (opts.action) url.searchParams.set("action", opts.action);
        if (opts.entityId) url.searchParams.set("entityId", opts.entityId);
        if (typeof opts.limit === "number") url.searchParams.set("limit", String(opts.limit));

        const result = await fetchJson<AuditResponse>(url.toString(), token);
        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.warn(`Total: ${result.total} · showing ${result.entries.length}`);
        for (const e of result.entries) {
          console.warn(`  ${e.ts}  ${e.action}  ${e.entity}/${e.entityId.substring(0, 12)}…  by ${e.userId.substring(0, 16)}…`);
        }
      } catch (e) { handleCommandError(e); }
    });
}

// ─── Command 9: create training run (task #8) ───────────────────────────────

interface CreateTrainingRunCreatedResponse {
  status: "created";
  runId: string;
  examplesIncludedCount: number;
  releaseId: string | null;
}
interface CreateTrainingRunBelowResponse {
  status: "below-threshold";
  availableExamples: number;
  requiredExamples: number;
  releaseId: string | null;
}
type CreateTrainingRunResponse = CreateTrainingRunCreatedResponse | CreateTrainingRunBelowResponse;

export function registerStylePatternCreateTrainingRunCommand(parent: Command): void {
  parent
    .command("training-run-create")
    .description("Create a FineTuneTrainingRun from unprocessed captured edits (task #8). Atomically picks edits + gates on min threshold + marks them so future runs don't double-include.")
    .option("--release-id <id>", "Scope to one release's edits + intended for that release's model")
    .option("--min <n>", "Minimum examples required (default 50)", (v) => parseInt(v, 10))
    .option("--max <n>", "Hard cap on edits per run (default 1000)", (v) => parseInt(v, 10))
    .option("--notes <text>", "Free-form annotation stored on the run")
    .option("--json", "Emit JSON instead of a summary")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const { apiBase, token, workspaceId } = await resolveContext(globalOpts);
        const body: Record<string, unknown> = {};
        if (opts.releaseId) body.releaseId = opts.releaseId;
        if (typeof opts.min === "number") body.minExamples = opts.min;
        if (typeof opts.max === "number") body.maxExamples = opts.max;
        if (opts.notes) body.notes = opts.notes;

        const url = `${apiBase}/white-label/${workspaceId}/style-pattern/training-runs`;
        const result = await fetchJson<CreateTrainingRunResponse>(url, token, { method: "POST", body });

        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (result.status === "created") {
          console.warn(`✓ Created training run ${result.runId} with ${result.examplesIncludedCount} examples${result.releaseId ? ` (release ${result.releaseId})` : ""}`);
          console.warn(`  Status: pending — fine-tune submission is the next phase.`);
        } else {
          console.warn(`⏭  Below threshold: ${result.availableExamples} available, ${result.requiredExamples} required.`);
          console.warn(`   Wait for more captured edits or lower --min.`);
        }
      } catch (e) { handleCommandError(e); }
    });
}

// ─── Command 10: list training runs ────────────────────────────────────────

interface ListTrainingRunsResponse {
  items: Array<{
    _id: string;
    releaseId?: string | null;
    examplesIncludedCount: number;
    status: string;
    triggeredBy: string;
    fineTuneJobId?: string | null;
    resultModelId?: string | null;
    createdAt: string;
  }>;
  count: number;
  limit: number;
}

export function registerStylePatternListTrainingRunsCommand(parent: Command): void {
  parent
    .command("training-run-list")
    .description("List FineTuneTrainingRun docs for the workspace")
    .option("--status <s>", "Filter: pending | submitting | submitted | training | completed | failed")
    .option("--release-id <id>", "Filter to runs scoped to this release")
    .option("--limit <n>", "Max rows (default 50, capped at 500)", (v) => parseInt(v, 10))
    .option("--json", "Emit JSON instead of a summary")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const { apiBase, token, workspaceId } = await resolveContext(globalOpts);
        const url = new URL(`${apiBase}/white-label/${workspaceId}/style-pattern/training-runs`);
        if (opts.status) url.searchParams.set("status", opts.status);
        if (opts.releaseId) url.searchParams.set("releaseId", opts.releaseId);
        if (typeof opts.limit === "number") url.searchParams.set("limit", String(opts.limit));

        const result = await fetchJson<ListTrainingRunsResponse>(url.toString(), token);
        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.warn(`Total: ${result.count} · limit ${result.limit}`);
        for (const r of result.items) {
          const rel = r.releaseId ? ` release=${r.releaseId}` : "";
          const job = r.fineTuneJobId ? ` job=${r.fineTuneJobId}` : "";
          const model = r.resultModelId ? ` model=${r.resultModelId}` : "";
          console.warn(`  ${r._id}  ${r.status}  ${r.examplesIncludedCount} ex  (${r.triggeredBy})${rel}${job}${model}  ${r.createdAt}`);
        }
      } catch (e) { handleCommandError(e); }
    });
}

// ─── Command 11: export JSONL (task #8 Phase 2) ─────────────────────────────

interface ExportJsonlResponse {
  runId: string;
  jsonl: string;
  stats: {
    totalEdits: number;
    emittedLines: number;
    skippedNoEdit: number;
    skippedNoPrompt: number;
    fallbackUsed: number;
  };
}

export function registerStylePatternExportJsonlCommand(parent: Command): void {
  parent
    .command("training-run-export <runId>")
    .description("Materialize the OpenAI-shaped JSONL training file for a run (task #8 Phase 2). Stdout is the raw JSONL; pipe to a file or your fine-tune tool.")
    .option("--allow-fallback-prompt", "Substitute a generic prompt for examples missing userPrompt (instead of skipping)")
    .option("--stats", "Emit JSON stats envelope to stderr alongside the JSONL on stdout")
    .option("--json", "Emit the full JSON envelope (stats + jsonl) to stdout instead of raw JSONL")
    .action(async (runId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const { apiBase, token, workspaceId } = await resolveContext(globalOpts);
        const url = new URL(`${apiBase}/white-label/${workspaceId}/style-pattern/training-runs/${runId}/jsonl`);
        if (opts.allowFallbackPrompt) url.searchParams.set("allowFallbackPrompt", "true");

        if (opts.json || globalOpts.json) {
          const result = await fetchJson<ExportJsonlResponse>(url.toString(), token);
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        // Default: raw JSONL on stdout for pipe-friendly use.
        url.searchParams.set("format", "jsonl");
        const resp = await fetch(url.toString(), { headers: { "Authorization": `Bearer ${token}` } });
        const text = await resp.text();
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${text.substring(0, 300)}`);
        }
        process.stdout.write(text);

        if (opts.stats) {
          // Fetch stats separately (without format=jsonl).
          const statsUrl = new URL(url.toString());
          statsUrl.searchParams.delete("format");
          const statsResp = await fetchJson<ExportJsonlResponse>(statsUrl.toString(), token);
          console.warn(JSON.stringify(statsResp.stats));
        }
      } catch (e) { handleCommandError(e); }
    });
}

// ─── Command 12: transition status (task #8 Phase 2) ────────────────────────

interface TransitionResponse {
  status: "ok" | "invalid-transition";
  runId?: string;
  previousStatus?: string;
  newStatus?: string;
  currentStatus?: string;
  attempted?: string;
}

export function registerStylePatternTransitionCommand(parent: Command): void {
  parent
    .command("training-run-transition <runId>")
    .description("Advance a run's status (forward-only). Persist provider-side fields atomically with the transition.")
    .requiredOption("--to <status>", "Target status: submitting | submitted | training | completed | failed")
    .option("--jsonl-path <p>", "Where the JSONL was uploaded (e.g. gs:// path)")
    .option("--job-id <id>", "Provider-side fine-tune job ID (persist on submit)")
    .option("--model-id <id>", "Trained model ID (persist on completed)")
    .option("--error <msg>", "Required when --to=failed")
    .option("--notes <text>", "Free-form annotation stored on the run")
    .option("--json", "Emit JSON instead of a summary")
    .action(async (runId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const { apiBase, token, workspaceId } = await resolveContext(globalOpts);
        const body: Record<string, unknown> = { toStatus: opts.to };
        if (opts.jsonlPath) body.jsonlPath = opts.jsonlPath;
        if (opts.jobId) body.fineTuneJobId = opts.jobId;
        if (opts.modelId) body.resultModelId = opts.modelId;
        if (opts.error) body.error = opts.error;
        if (opts.notes) body.notes = opts.notes;

        const url = `${apiBase}/white-label/${workspaceId}/style-pattern/training-runs/${runId}/transition`;
        const result = await fetchJson<TransitionResponse>(url, token, { method: "POST", body });

        if (opts.json || globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (result.status === "ok") {
          console.warn(`✓ Run ${runId}: ${result.previousStatus} → ${result.newStatus}`);
        } else {
          console.warn(`✗ Invalid transition: run is in '${result.currentStatus}', cannot move to '${result.attempted}'`);
        }
      } catch (e) { handleCommandError(e); }
    });
}

// ─── Command 13: guardrail firings (runtime audit) ──────────────────────────

interface FiringsListResponse {
  items: Array<{
    _id: string;
    ruleId: string;
    category: string;
    severity: number;
    surface: "authenticated" | "anonymous";
    outcome: "rewritten" | "redacted" | "suppressed";
    releaseId?: string | null;
    ts: number;
  }>;
  count: number;
  limit: number;
}

interface FiringsStatsResponse {
  windowHours: number;
  total: number;
  byOutcome: Record<string, number>;
  bySurface: Record<string, number>;
  byRule: Array<{
    ruleId: string;
    category: string;
    count: number;
    maxSeverity: number;
    suppressedCount: number;
    lastTriggeredAt: string;
  }>;
}

export function registerStylePatternFiringsCommand(parent: Command): void {
  parent
    .command("firings")
    .description("View guardrail-rule firings (a guardrail rewrote/redacted/suppressed a reply). --stats for a windowed summary used for alerting.")
    .option("--stats", "Show the windowed summary (per-rule frequency + severity) instead of a list")
    .option("--rule-id <id>", "Filter the list to one rule")
    .option("--surface <s>", "Filter the list: authenticated | anonymous")
    .option("--outcome <o>", "Filter the list: rewritten | redacted | suppressed")
    .option("--since-hours <h>", "List only firings within the last H hours", (v) => parseInt(v, 10))
    .option("--window-hours <h>", "Stats window in hours (default 24)", (v) => parseInt(v, 10))
    .option("--limit <n>", "Max list rows (default 100, capped 1000)", (v) => parseInt(v, 10))
    .option("--json", "Emit JSON instead of a summary")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const { apiBase, token, workspaceId } = await resolveContext(globalOpts);

        if (opts.stats) {
          const url = new URL(`${apiBase}/white-label/${workspaceId}/style-pattern/guardrail-firings/stats`);
          if (typeof opts.windowHours === "number") url.searchParams.set("windowHours", String(opts.windowHours));
          const result = await fetchJson<FiringsStatsResponse>(url.toString(), token);
          if (opts.json || globalOpts.json) { console.log(JSON.stringify(result, null, 2)); return; }
          console.warn(`Guardrail firings — last ${result.windowHours}h · total ${result.total}`);
          console.warn(`  by outcome: ${JSON.stringify(result.byOutcome)}`);
          console.warn(`  by surface: ${JSON.stringify(result.bySurface)}`);
          if (result.byRule.length === 0) { console.warn("  (no firings in window)"); return; }
          console.warn("  per rule (top by count):");
          for (const r of result.byRule) {
            const sup = r.suppressedCount > 0 ? ` ⛔${r.suppressedCount} suppressed` : "";
            console.warn(`    ${r.ruleId} [${r.category}]  ${r.count}× sev≤${r.maxSeverity}${sup}  last ${r.lastTriggeredAt}`);
          }
          return;
        }

        const url = new URL(`${apiBase}/white-label/${workspaceId}/style-pattern/guardrail-firings`);
        if (opts.ruleId) url.searchParams.set("ruleId", opts.ruleId);
        if (opts.surface) url.searchParams.set("surface", opts.surface);
        if (opts.outcome) url.searchParams.set("outcome", opts.outcome);
        if (typeof opts.sinceHours === "number") url.searchParams.set("sinceHours", String(opts.sinceHours));
        if (typeof opts.limit === "number") url.searchParams.set("limit", String(opts.limit));
        const result = await fetchJson<FiringsListResponse>(url.toString(), token);
        if (opts.json || globalOpts.json) { console.log(JSON.stringify(result, null, 2)); return; }
        console.warn(`Total shown: ${result.count} · limit ${result.limit}`);
        for (const f of result.items) {
          const rel = f.releaseId ? ` rel=${f.releaseId}` : "";
          console.warn(`  ${new Date(f.ts).toISOString()}  ${f.outcome.padEnd(10)} ${f.surface.padEnd(13)} rule=${f.ruleId} [${f.category}] sev=${f.severity}${rel}`);
        }
      } catch (e) { handleCommandError(e); }
    });
}

// ─── Group registration ─────────────────────────────────────────────────────

export function registerStylePatternCommands(program: Command): void {
  const group = program
    .command("style-pattern")
    .alias("sp")
    .description("Per-workspace style-pattern rules (Phase 4 chat-response rewriter)");
  registerStylePatternListCommand(group);
  registerStylePatternCreateCommand(group);
  registerStylePatternListProposedCommand(group);
  registerStylePatternListEditsCommand(group);
  registerStylePatternTestRewriteCommand(group);
  registerStylePatternApproveCommand(group);
  registerStylePatternRejectCommand(group);
  registerStylePatternToggleCommand(group);
  registerStylePatternAuditCommand(group);
  registerStylePatternFiringsCommand(group);
  registerStylePatternCreateTrainingRunCommand(group);
  registerStylePatternListTrainingRunsCommand(group);
  registerStylePatternExportJsonlCommand(group);
  registerStylePatternTransitionCommand(group);
}
