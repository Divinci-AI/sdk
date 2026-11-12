/**
 * Release-aware chat helpers.
 *
 * Chatting with a release "exactly as an end user would" means three things the
 * bare `chat send` did not do for you:
 *   1. pin the message to the release (`{ type: "release", releaseId }`), so the
 *      release's thread/message prefixes, RAG vectors and moderation all apply
 *      whatever the transcript was created with;
 *   2. survive a slow generation — the add-message call is held open by the API
 *      while the model answers, and the SDK's 30s default turned a normal 26s
 *      answer into a failed command whose reply then landed anyway;
 *   3. show the citations, which are on the reply but were never printed.
 */

/** The reply row, as much of it as the CLI reads. Everything is optional: older replies lack most of it. */
export type ReplyRow = {
  role?: string,
  content: string,
  name?: string,
  timestamp?: number,
  citedSources?: string[],
  sources?: string[],
  context?: Array<{
    content?: string,
    metadata?: Record<string, unknown>,
  }>,
};

export type Citation = {
  /** File name / title of the cited source. */
  source: string,
  /** Where the page came from, when the index recorded it (crawled pages do). */
  url?: string,
  similarity?: number,
};

export type ReleaseEnvBody = { type: "release", releaseId: string };

/** The env selector that pins one message to a whole release (any status). */
export function releaseEnvBody(releaseId: string): ReleaseEnvBody {
  return { type: "release", releaseId };
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The sources the answer actually cites, with URLs where the index has them.
 *
 * `citedSources` names the files the model referenced; `context` carries the
 * retrieved passages and their metadata (originalName, sourceUrl, similarity).
 * When nothing is named as cited but passages were retrieved, those are listed
 * instead — an answer with context and no named citation is still worth showing
 * its evidence for.
 */
export function extractCitations(row: ReplyRow | null | undefined): Citation[] {
  if (!row) return [];
  const byName = new Map<string, Citation>();
  const contexts = Array.isArray(row.context) ? row.context : [];
  for (const c of contexts) {
    const meta = c.metadata ?? {};
    const name = textOf(meta.originalName) ?? textOf(meta.title) ?? textOf(meta.sourceUrl);
    if (!name) continue;
    const similarity = typeof meta.similarity === "number" ? meta.similarity : undefined;
    const existing = byName.get(name);
    const url = textOf(meta.sourceUrl) ?? textOf(meta.url);
    if (!existing) {
      byName.set(name, { source: name, ...(url && { url }), ...(similarity !== undefined && { similarity }) });
    } else if (similarity !== undefined && (existing.similarity ?? -1) < similarity) {
      existing.similarity = similarity;
    }
  }

  const cited = Array.isArray(row.citedSources) ? row.citedSources.filter((s) => typeof s === "string" && s) : [];
  if (cited.length > 0) {
    return cited.map((name) => byName.get(name) ?? { source: name });
  }
  return [...byName.values()];
}

export function formatCitations(citations: Citation[]): string[] {
  return citations.map((c, i) => `  [${i + 1}] ${c.source}${c.url ? `  ${c.url}` : ""}`);
}

/** SDK/HTTP timeouts all read "...timed out after Nms". The API may still be working. */
export function isRequestTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || /timed out/i.test(error.message);
}

/** HTTP statuses a gateway in front of the API returns when ITS timer, not the API's, ran out. */
const GATEWAY_TIMEOUT_STATUSES = new Set([502, 504, 524]);

/**
 * True when the request failed in a way that says nothing about the message:
 * the client gave up (timeout), or Cloudflare / the load balancer cut the
 * connection (502 / 504 / 524 — the edge allows ~100s) while the API was still
 * generating. The add-message handler keeps working and the reply lands in the
 * transcript either way, so the caller should poll for it rather than fail.
 *
 * A 4xx or a plain 500 is a real answer from the API and is NOT matched.
 */
export function isStillGenerating(error: unknown): boolean {
  if (isRequestTimeout(error)) return true;
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === "number" && GATEWAY_TIMEOUT_STATUSES.has(status);
}

/**
 * A client-side HTTP timeout long enough for the API to finish generating.
 * Waiting for the reply is the point of `--wait`, so the request may never be
 * shorter than the wait plus a margin; 120s is the floor.
 */
export function replyRequestTimeoutMs(waitSeconds: number): number {
  return Math.max(120_000, (waitSeconds + 30) * 1000);
}

export type ReleaseSummary = { _id?: string, status?: string, title?: string, slug?: string };

/**
 * Turns the release lookup into either a usable summary or an error that says
 * what to do. `status` is "available" once published; "draft" releases still
 * answer for the workspace owner (that is the QA surface) but no end user can
 * reach them.
 */
export function assertReleaseUsable(
  release: ReleaseSummary | null | undefined,
  releaseId: string,
  opts: { publishedOnly: boolean },
): { status: string, warning?: string } {
  if (!release) {
    throw new Error(`Release ${releaseId} not found in this workspace. List them with: divinci release list`);
  }
  const status = release.status ?? "unknown";
  if (status === "available") return { status };
  if (opts.publishedOnly) {
    throw new Error(
      `Release ${releaseId} is "${status}", not published — end users cannot reach it. ` +
      (status === "draft"
        ? `Publish it with: divinci release publish ${releaseId} (or drop --published-only to test the draft as its owner).`
        : "Pick an available release, or drop --published-only to test it as the workspace owner."),
    );
  }
  return {
    status,
    warning: `Release ${releaseId} is "${status}": answering as the workspace owner. End users cannot reach it until it is published.`,
  };
}
