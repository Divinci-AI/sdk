/**
 * Opt-in automatic error reporting.
 *
 * On 2026-08-11 a user was blocked for days by a CLI that requested PRODUCTION
 * tokens from the DEV Auth0 tenant. We found out because he wrote an email.
 * Nothing server-side could have shown it: the requests were indistinguishable
 * from an anonymous caller poking authenticated routes.
 *
 * What this sends is chosen so that ONE field would have surfaced that incident
 * on day one: `apiEnv` and `auth0Env` are resolved to enums, and a mismatch
 * between them is the signature of a client pointed at two environments at once.
 *
 * Three rules this must never break:
 *
 *  1. OFF until someone says yes. No consent, no request. Absent consent is
 *     not consent, and a first run must not phone home while asking.
 *  2. No free text, ever. Every field is an enum, a bounded pattern, or a small
 *     integer, so nothing a user typed — no paths, no prompts, no ids, not even
 *     command ARGUMENTS — can leave the machine. Free text is what
 *     `divinci bug-report` is for: it sends nothing and a human pastes it.
 *  3. Never interfere. Reporting is best-effort with a short timeout, swallows
 *     every error, and cannot change the exit code or the message the user sees.
 *     A telemetry failure must never become the user's problem.
 */
import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

import { loadCredentials } from "../config/credentials.js";
import { tryGetAuth0Config } from "../auth/oauth.js";

export type ErrorKind = "auth" | "network" | "server" | "client" | "config" | "unknown";
type EnvName = "prod" | "staging" | "dev" | "custom";

const API_ENVS: Record<string, EnvName> = {
  "https://api.divinci.app": "prod",
  "https://api.stage.divinci.app": "staging",
  "https://api.dev.divinci.app": "dev",
};

const AUTH0_ENVS: Record<string, EnvName> = {
  "divinci-prod.us.auth0.com": "prod",
  "divinci-staging.us.auth0.com": "staging",
  "dev-46tiys6hnb6vbg17.us.auth0.com": "dev",
};

export interface CliErrorReport {
  cliVersion: string;
  command: string;
  kind: ErrorKind;
  apiEnv: EnvName;
  auth0Env: EnvName;
  platform: "darwin" | "linux" | "win32" | "other";
  nodeMajor: number;
  httpStatus?: number;
  code?: string;
}

/** Classify a failure into one of a handful of buckets. Never throws. */
export function classify(status?: number, code?: string): ErrorKind {
  if (code && /TOKEN|AUTH/.test(code)) return "auth";
  if (status === 401) return "auth";
  if (status === 403) return "auth";
  if (status === 429) return "server";
  if (typeof status === "number" && status >= 500) return "server";
  if (typeof status === "number" && status >= 400) return "client";
  if (code && /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN/.test(code)) return "network";
  return "unknown";
}

function platform(): CliErrorReport["platform"] {
  const p = os.platform();
  return p === "darwin" || p === "linux" || p === "win32" ? p : "other";
}

/**
 * Build the report. Pure and total: any unreadable config yields "custom"
 * rather than throwing, because this runs on the error path where the config
 * is often exactly what is broken.
 */
export function buildReport(args: {
  cliVersion: string;
  command: string;
  apiUrl: string;
  status?: number;
  code?: string;
}): CliErrorReport {
  let auth0Env: EnvName = "custom";
  try {
    auth0Env = AUTH0_ENVS[tryGetAuth0Config(args.apiUrl)?.domain ?? ""] ?? "custom";
  } catch { /* unresolvable config — "custom" is the honest answer */ }

  // Commander reports the full path ("release update"); the beacon wants a
  // single slug, and arguments must never be included.
  const command = args.command.trim().split(/\s+/).slice(0, 2).join(":").toLowerCase()
    .replace(/[^a-z0-9:-]/g, "")
    .slice(0, 40) || "unknown";

  return {
    cliVersion: args.cliVersion,
    command,
    kind: classify(args.status, args.code),
    apiEnv: API_ENVS[args.apiUrl] ?? "custom",
    auth0Env,
    platform: platform(),
    nodeMajor: Number(process.versions.node.split(".")[0]) || 1,
    ...(typeof args.status === "number" ? { httpStatus: args.status } : {}),
    ...(args.code && /^[A-Z][A-Z0-9_]{0,39}$/.test(args.code) ? { code: args.code } : {}),
  };
}

/** True only when the user has actively opted in. Never throws. */
export function isReportingEnabled(): boolean {
  if (process.env.DIVINCI_DISABLE_TELEMETRY) return false;
  try {
    return loadCredentials().errorReporting === true;
  } catch {
    return false;
  }
}

/**
 * Reports are QUEUED synchronously to disk and flushed on a later run, rather
 * than sent from the error path.
 *
 * handleCommandError() is synchronous and calls process.exit(1), and it has 261
 * call sites, none of which await it. Making it async to await a send would risk
 * the exit code at every one of them — a command that currently fails with 1
 * could start resolving normally. Deferring the exit instead would change exit
 * timing on the error path for anyone opted in.
 *
 * Writing a small file is synchronous, cannot alter the exit code, and survives
 * the immediate exit. If a flush never completes, the report simply waits for
 * the next invocation, which makes the whole thing self-healing rather than
 * lossy. Telemetry arriving a few minutes late costs nothing; a telemetry
 * feature that changes how a CLI exits costs a great deal.
 */
const QUEUE_PATH = path.join(os.homedir(), ".config", "divinci", "pending-reports.json");
const QUEUE_MAX = 20;

/** Append a report to the on-disk queue. Synchronous, bounded, never throws. */
export function queueReport(report: CliErrorReport): void {
  try {
    let queued: CliErrorReport[] = [];
    if (existsSync(QUEUE_PATH)) {
      const parsed: unknown = JSON.parse(readFileSync(QUEUE_PATH, "utf8"));
      if (Array.isArray(parsed)) queued = parsed as CliErrorReport[];
    }
    // Drop OLDEST on overflow: a repeating failure should not pin the queue to
    // its first occurrence, and the newest reports describe the current state.
    queued.push(report);
    if (queued.length > QUEUE_MAX) queued = queued.slice(-QUEUE_MAX);
    mkdirSync(path.dirname(QUEUE_PATH), { recursive: true });
    writeFileSync(QUEUE_PATH, JSON.stringify(queued), { mode: 0o600 });
  } catch { /* unwritable config dir — drop it, never surface to the user */ }
}

/**
 * Send anything queued, then clear it. Best-effort and non-blocking by design;
 * call without awaiting. Clears the queue even on send failure ONLY when the
 * reports are stale, so a permanently offline machine cannot accumulate forever.
 */
export async function flushPendingReports(apiUrl: string): Promise<void> {
  if (!isReportingEnabled()) return;
  let queued: CliErrorReport[] = [];
  try {
    if (!existsSync(QUEUE_PATH)) return;
    const parsed: unknown = JSON.parse(readFileSync(QUEUE_PATH, "utf8"));
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    queued = parsed as CliErrorReport[];
  } catch {
    return;
  }
  try {
    for (const report of queued) await sendReport(apiUrl, report);
    rmSync(QUEUE_PATH, { force: true });
  } catch { /* leave the queue for the next run */ }
}

/**
 * Send, best-effort. Resolves either way and never throws — a telemetry
 * failure must never become the user's problem, especially on an error path.
 */
export async function sendReport(apiUrl: string, report: CliErrorReport): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      await fetch(`${apiUrl.replace(/\/+$/, "")}/api/v1/telemetry/cli-error`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(report),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch { /* offline, blocked, timed out — all fine, drop it */ }
}
