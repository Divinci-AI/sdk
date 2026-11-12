import { Command } from "commander";
import { requireConfig, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError, requireOAuthAuth } from "../../utils/errors.js";
import type { HermesProactiveConfigInput } from "@divinci-ai/server";

/**
 * Parse `HH:MM` into hour/minute.
 *
 * Deliberately NOT a cron expression. A customer-facing cron field is a support
 * burden and lets someone type `* * * * *`; the server decides who is due, at
 * most once per local day.
 */
export function parseAtTime(raw: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) throw new Error(`--at must be HH:MM (24-hour), got "${raw}"`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23) throw new Error("--at hour must be 0-23");
  if (minute < 0 || minute > 59) throw new Error("--at minute must be 0-59");
  return { hour, minute };
}

/**
 * Parse `--items`.
 *
 * Refused rather than coerced, same as `--every`: this changes how much an
 * unattended, owner-billed turn produces, and a silently-coerced 0 ("say
 * nothing") or 50 ("write a report") is not what anyone typed.
 */
function parseItems(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new Error(`--items must be a whole number 1-5 (got "${raw}")`);
  }
  if (n < 1 || n > 5) {
    throw new Error(
      `--items must be 1-5 (got ${n}). A wake is a nudge, not a report, and every ` +
        `item ships inside the same single message.`,
    );
  }
  return n;
}

/**
 * Parse `--every`.
 *
 * `"daily"` / `"off"` / `"none"` return null, which is how a caller says "back
 * to once a day" — distinct from omitting the flag, which changes nothing. The
 * three words exist because `--every 0` reads like "never" and would otherwise
 * have to be an error; giving the intent a name is cheaper than explaining why
 * the obvious spelling is rejected.
 *
 * Whole hours only, 1-24, matching the server. Rejecting `1.5` here rather than
 * rounding is deliberate: the server would reject it anyway, and a CLI that
 * quietly rounds a schedule teaches people to trust a number that is not what
 * they typed.
 */
export function parseEvery(raw: string): number | null {
  const v = raw.trim().toLowerCase();
  if (v === "daily" || v === "off" || v === "none") return null;
  if (!/^\d+$/.test(v)) {
    throw new Error(`--every must be a whole number of hours 1-24, or "daily" (got "${raw}")`);
  }
  const n = Number(v);
  if (n < 1 || n > 24) {
    throw new Error(
      `--every must be 1-24 hours (got ${n}). The sweep runs every 10 minutes, so anything ` +
        `under an hour is not a schedule; beyond a day, use --at with no --every.`,
    );
  }
  return n;
}

/**
 * Parse `--partner`.
 *
 * Validated client-side to the exact shape the server mints so a typo fails
 * here, naming the flag, instead of arriving as a server 400 about a field the
 * user never typed. Rejecting the empty string is the important half: `--partner
 * "$AGENT_KEY"` with an unset variable would otherwise be indistinguishable
 * from a deliberate unpair. `--unpair` is the way to say that.
 */
export function parsePartner(raw: string): string {
  const key = raw.trim();
  if (key === "") {
    throw new Error("--partner needs an agentKey (use --unpair to remove a pairing)");
  }
  if (!/^agent-[0-9a-f]{24}$/.test(key)) {
    throw new Error(
      `--partner must be an agentKey — "agent-" followed by 24 hex characters (got "${raw}"). ` +
        "Find it with `divinci hermes list`.",
    );
  }
  return key;
}

/**
 * Parse `--transcript`.
 *
 * Same shape check the server applies, so a typo fails here naming the flag
 * rather than arriving as a 400 about a field nobody typed. The empty string is
 * rejected on purpose — `--transcript "$TID"` with an unset variable would
 * otherwise be indistinguishable from a deliberate detach.
 */
export function parseTranscriptId(raw: string): string {
  const id = raw.trim();
  if (id === "") {
    throw new Error("--transcript needs a transcript id (use --detach-transcript to remove one)");
  }
  if (!/^[a-f0-9]{24}$/i.test(id)) {
    throw new Error(
      `--transcript must be a 24-character hex transcript id (got "${raw}"). ` +
        "Find it in the transcript's URL.",
    );
  }
  return id;
}

/** Collect a repeatable flag into an array. */
/**
 * Decide the final value of `goals` / `memories` for a PATCH.
 *
 * Returns `undefined` when the field should be omitted entirely — sending
 * `[]` and sending nothing are very different to the server, and conflating
 * them is how an update that meant to touch only the schedule wipes an agent's
 * cognition.
 *
 * `--goal` APPENDS. It is documented as "Add … (repeatable)" and `--clear-*`
 * exists so that clearing is explicit. Until 2026-08-10 it assigned instead,
 * which destroyed six goals and five memories on the production agent hours
 * after they were written. The logic lived inline in the command handler and
 * so was never unit-tested; that is the actual reason it shipped, and why it
 * is a pure exported function now.
 *
 * `clear` together with `added` means REPLACE, in one call. As two calls there
 * is a window where the agent has no goals at all, and a failure on the second
 * makes that permanent.
 */
export function resolveList(
  existing: string[],
  added: string[],
  clear: boolean,
): string[] | undefined {
  if (added.length === 0) return clear ? [] : undefined;
  if (clear) return [...added];
  // De-duplicate on trimmed text so re-running the same command is idempotent
  // rather than accumulating a goal N times — these reach a model verbatim.
  const seen = new Set(existing.map((s) => s.trim()));
  return [...existing, ...added.filter((s) => !seen.has(s.trim()))];
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * `divinci hermes proactive <agentId>` — read or configure the proactive
 * ("tick awake") loop, and read its run log.
 *
 * With no mutating flags it PRINTS the current config plus recent wakes, which
 * is the common case during a shadow week: you are reading what the agent would
 * have said, not changing anything.
 */
export function registerHermesProactiveCommand(parent: Command): void {
  parent
    .command("proactive <agentId>")
    .description("Configure or inspect an agent's proactive wake loop (and read its run log)")
    .option("--enable", "Wake this agent on a schedule")
    .option("--disable", "Stop waking this agent")
    .option("--mode <mode>", "shadow (record only, never posts) | live (posts to the Slack home channel)")
    .option("--at <HH:MM>", "Wake time, 24-hour, in the agent's timezone (anchors the first wake)")
    .option("--tz <zone>", "IANA timezone, e.g. America/Los_Angeles")
    .option(
      "--every <hours>",
      "Wake every N hours (1-24) instead of once a day. Costs 24/N billed turns per day — " +
        '3 means 8/day, not 1. Use "daily" to go back to once a day.',
    )
    .option(
      "--partner <agentKey>",
      "Pair with a sibling agent (its agentKey) so each wake sees what the other has been " +
        "thinking. Best with a DIFFERENT model on each. They cannot wake each other.",
    )
    .option("--unpair", "Remove the sibling pairing")
    .option(
      "--transcript <id>",
      "Write this agent's wakes into a shared Divinci transcript. Point several " +
        "agents at the SAME transcript to make them a fleet you can read as one " +
        "conversation. Must be a branched (non-linear) transcript.",
    )
    .option("--detach-transcript", "Stop writing wakes into a transcript")
    .option(
      "--items <n>",
      "How many items one wake may raise (1-5). Default 1. A CEILING, not a quota — " +
        "the whole wake is still delivered as ONE message, and silence stays the " +
        'expected outcome. Use "1" to go back to a single item.',
    )
    .option("--goal <text>", "Add a goal (repeatable)", collect, [] as string[])
    .option("--memory <text>", "Add a memory (repeatable)", collect, [] as string[])
    .option("--clear-goals", "Remove all goals")
    .option("--clear-memories", "Remove all memories")
    .option("--slack", "Deliver to the Slack home channel")
    .option("--no-slack", "Do NOT deliver to Slack")
    .option("--email <addr>", "Also email this address (empty string clears)")
    .option("--sms <e164>", "Also SMS this number, e.g. +15551234567 (empty string clears)")
    .option("--clear", "Turn it off and clear the whole config")
    .option("--runs [n]", "Show the N most recent wakes (default 10)")
    .option("--workspace <id>", "Workspace ID (defaults to active workspace)")
    .action(async (agentId, opts, cmd) => {
      try {
        if (opts.enable && opts.disable) {
          throw new Error("--enable and --disable are mutually exclusive");
        }
        if (opts.mode && opts.mode !== "shadow" && opts.mode !== "live") {
          throw new Error('--mode must be "shadow" or "live"');
        }
        if (opts.partner !== undefined && opts.unpair) {
          throw new Error("--partner and --unpair are mutually exclusive");
        }
        if (opts.transcript !== undefined && opts.detachTranscript) {
          throw new Error("--transcript and --detach-transcript are mutually exclusive");
        }
        // `--clear-goals --goal X` is deliberately ALLOWED and means "replace
        // with exactly X". It used to be refused, which forced a replace to be
        // two commands — and between them the agent has no goals at all, so a
        // failure on the second leaves it permanently empty. One call, or an
        // all-or-nothing failure.
        // --at and --tz travel together: the server needs a complete schedule,
        // and half of one would silently keep the previous zone while moving
        // the hour — the kind of change nobody notices until it fires at 3am.
        if (opts.at && !opts.tz) throw new Error("--at requires --tz (IANA zone)");
        if (opts.tz && !opts.at) throw new Error("--tz requires --at (HH:MM)");

        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        requireOAuthAuth(config);
        config = await ensureValidToken(config);
        const client = createClient(config);
        const workspaceId = opts.workspace || config.workspaceId;
        if (!workspaceId) throw new Error("--workspace required (no active workspace set)");

        if (opts.clear) {
          const updated = await withSpinner("Clearing proactive config…", () =>
            client.hermesAgents.update(workspaceId, agentId, { proactive: null }),
          );
          output(updated, { keyValue: true });
          return;
        }

        const proactive: HermesProactiveConfigInput = {};
        if (opts.enable) proactive.enabled = true;
        if (opts.disable) proactive.enabled = false;
        if (opts.mode) proactive.mode = opts.mode;
        if (opts.at) {
          const { hour, minute } = parseAtTime(opts.at);
          proactive.schedule = { hour, minute, timezone: String(opts.tz) };
        }
        if (opts.every !== undefined) proactive.intervalHours = parseEvery(String(opts.every));
        if (opts.items !== undefined) proactive.maxItemsPerWake = parseItems(String(opts.items));
        if (opts.partner !== undefined) proactive.partnerAgentKey = parsePartner(String(opts.partner));
        // Separate flag rather than `--partner ""`: an empty string is what a
        // shell hands you when a variable is unset, so `--partner "$KEY"` with a
        // typo'd variable would silently UNPAIR instead of failing. Unpairing
        // has to be something you asked for by name.
        if (opts.unpair) proactive.partnerAgentKey = null;
        if (opts.transcript !== undefined) {
          proactive.transcriptId = parseTranscriptId(String(opts.transcript));
        }
        // Separate flag rather than `--transcript ""`, for the same reason as
        // --unpair: an unset shell variable expands to empty, and that must not
        // silently detach an agent from its fleet.
        if (opts.detachTranscript) proactive.transcriptId = null;
        // `--goal` / `--memory` APPEND. They are documented as "Add … (repeatable)"
        // and `--clear-*` exists precisely so that clearing is explicit — but until
        // 2026-08-10 this assigned the array, silently discarding every existing
        // entry. It destroyed six goals and five memories on the production agent
        // within hours of that agent being given them; the only reason it was
        // caught is that the write was read back.
        //
        // Appending needs the current value, so fetch it — but ONLY when there is
        // something to append to, so the common paths (enable/disable/schedule)
        // stay a single round trip.
        const wantsAppend = opts.goal.length > 0 || opts.memory.length > 0;
        let existingGoals: string[] = [];
        let existingMemories: string[] = [];
        if (wantsAppend && !(opts.clearGoals && opts.clearMemories)) {
          const current = (await withSpinner("Reading current goals…", () =>
            client.hermesAgents.get(workspaceId, agentId),
          )) as { proactive?: { goals?: string[]; memories?: string[] } | null };
          existingGoals = current.proactive?.goals ?? [];
          existingMemories = current.proactive?.memories ?? [];
        }

        const goals = resolveList(existingGoals, opts.goal, Boolean(opts.clearGoals));
        if (goals !== undefined) proactive.goals = goals;

        const memories = resolveList(existingMemories, opts.memory, Boolean(opts.clearMemories));
        if (memories !== undefined) proactive.memories = memories;

        // deliver is sent WHOLE when any part is given — the server merges it
        // wholesale, so a fragment would silently drop the other channels.
        //
        // ⚠️ Test the option SOURCE, not the value. Declaring `--no-slack`
        // makes commander default `opts.slack` to TRUE, so `!== undefined`
        // is always true and every unrelated update would overwrite `deliver`
        // with a Slack-only block — silently dropping a configured email or
        // SMS target.
        const slackGiven = cmd.getOptionValueSource?.("slack") === "cli";
        const emailGiven = cmd.getOptionValueSource?.("email") === "cli";
        const smsGiven = cmd.getOptionValueSource?.("sms") === "cli";
        if (slackGiven || emailGiven || smsGiven) {
          proactive.deliver = {
            ...(slackGiven ? { slack: Boolean(opts.slack) } : {}),
            ...(emailGiven ? { email: opts.email || null } : {}),
            ...(smsGiven ? { sms: opts.sms || null } : {}),
          };
        }

        const mutating = Object.keys(proactive).length > 0;

        if (mutating) {
          const updated = await withSpinner("Updating proactive config…", () =>
            client.hermesAgents.update(workspaceId, agentId, { proactive }),
          );
          output(updated, { keyValue: true });

          if (proactive.mode === "live") {
            // Say the consequence out loud. Someone flipping this is choosing
            // to let software speak to their colleagues unprompted.
            console.warn(
              "\n⚠️  live mode: this agent will now post to its Slack home channel " +
                "without anyone asking it to. Read a week of shadow output first if you have not.",
            );
          }
          if (proactive.deliver?.email || proactive.deliver?.sms) {
            console.warn(
              "ℹ️  Every channel spends from the SAME attention budget — the ceiling for " +
                "unsolicited messages is ~3-5/day across ALL sources, so three channels is " +
                "three interruptions, not three budgets.",
            );
          }
          if (proactive.enabled) {
            console.warn(
              "ℹ️  Every wake is one billed turn against the workspace wallet — including " +
                "the days it decides to stay silent, because the thinking still happened.",
            );
          }
          // Quote the multiplier, not just the interval. "every 3 hours" sounds
          // like a scheduling choice; "8 turns a day instead of 1" is the same
          // fact in the units the bill arrives in.
          if (proactive.intervalHours) {
            const perDay = Math.floor(24 / proactive.intervalHours) || 1;
            console.warn(
              `⚠️  Waking every ${proactive.intervalHours}h is ${perDay} billed turns a day, ` +
                `not 1${proactive.mode === "live" || opts.mode === "live" ? " — and in live mode, up to " + perDay + " interruptions against a 3-5/day ceiling across ALL channels" : ""}.`,
            );
          } else if (proactive.intervalHours === null) {
            console.warn("ℹ️  Back to once a day, at the scheduled time.");
          }
          if (proactive.partnerAgentKey) {
            // Pairing is one-directional per agent, and the asymmetric case is
            // easy to create by accident and invisible afterwards: A reads B
            // while B never hears back, so the "conversation" is one agent
            // talking into a void. Say it here rather than leaving it to be
            // discovered in a week of shadow output.
            console.warn(
              `ℹ️  This agent now reads ${proactive.partnerAgentKey}'s wakes. Pairing is ` +
                "one-directional — run the same command on the OTHER agent if you want it " +
                "mutual. They still cannot wake each other; each fires on its own schedule.",
            );
          } else if (proactive.partnerAgentKey === null) {
            console.warn("ℹ️  Unpaired — this agent no longer sees any sibling's wakes.");
          }
          if (proactive.transcriptId) {
            console.warn(
              `ℹ️  Wakes now go into transcript ${proactive.transcriptId}. Point other agents at the ` +
                "SAME id to build a fleet you can read as one conversation. It must be a BRANCHED " +
                "transcript — the server refuses a linear one rather than converting it.",
            );
          } else if (proactive.transcriptId === null) {
            console.warn("ℹ️  Detached — this agent's wakes are no longer written to a transcript.");
          }
        }

        // Show runs when asked, or by default when nothing was changed —
        // "what has it been saying?" is the question during a shadow week.
        if (opts.runs !== undefined || !mutating) {
          const limit = typeof opts.runs === "string" ? Number(opts.runs) : 10;
          const { runs } = await withSpinner("Fetching recent wakes…", () =>
            client.hermesAgents.proactiveRuns(workspaceId, agentId, limit || 10),
          );
          if (!runs || runs.length === 0) {
            console.warn(
              "No wakes recorded yet. Nothing runs until the agent is enabled and its " +
                "scheduled time arrives.",
            );
          } else {
            output(runs, { keyValue: false });
          }
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}
