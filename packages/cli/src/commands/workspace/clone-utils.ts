/**
 * Helpers for workspace clone + release clone-to-workspace flows.
 */

export interface CloneJobStatusResponse {
  jobId: string;
  status: string;
  stage?: string;
  whitelabel?: { _id: string; title?: string };
  multiTargetMap?: Record<string, string[]>;
  error?: string;
}

/** Map a RAG vector's vectorIndexTool to clone API targetVectorDbType. */
export function inferVectorDbType(vectorIndexTool: string | undefined): string {
  const tool = (vectorIndexTool ?? "").toLowerCase();
  if (tool.includes("vertex")) return "vertex-ai-v2";
  if (tool.includes("qdrant")) return "qdrant";
  if (tool.includes("couchbase")) return "couchbase";
  if (tool.includes("mongo")) return "mongodb-atlas";
  if (tool.includes("redis")) return "redis-vector-search";
  if (tool.includes("pageindex")) return "pageindex";
  if (tool.includes("vectorize") || tool.includes("cloudflare")) return "vectorize";
  return "vectorize";
}

export function parseCommaSeparatedIds(raw: string): string[] {
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const id of ids) {
    if (!/^[a-f0-9]{24}$/.test(id)) {
      throw new Error(`Invalid ObjectId "${id}" — expected 24-char hex.`);
    }
  }
  if (ids.length === 0) {
    throw new Error("At least one id is required.");
  }
  return ids;
}

/** Flatten clone job multiTargetMap (old → new[]) to old → new (first target). */
export function flattenMultiTargetMap(
  map: Record<string, string[]> | undefined,
): Record<string, string> {
  if (!map) return {};
  const out: Record<string, string> = {};
  for (const [oldId, newIds] of Object.entries(map)) {
    if (newIds?.length) out[oldId] = newIds[0];
  }
  return out;
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.substring(0, 400)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response: ${text.substring(0, 200)}`);
  }
}

export async function pollCloneJob(args: {
  baseUrl: string;
  sourceWorkspaceId: string;
  jobId: string;
  accessToken: string;
  intervalMs?: number;
  maxAttempts?: number;
}): Promise<CloneJobStatusResponse> {
  const intervalMs = args.intervalMs ?? 5000;
  const maxAttempts = args.maxAttempts ?? 120;
  const url = `${args.baseUrl.replace(/\/+$/, "")}/white-label/${args.sourceWorkspaceId}/clone/${args.jobId}/status`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const job = await fetchJson<CloneJobStatusResponse>(url, {
      headers: { Authorization: `Bearer ${args.accessToken}` },
    });

    if (job.status === "completed" || job.status === "partial") {
      return job;
    }
    if (job.status === "failed") {
      throw new Error(job.error ?? `Clone job ${args.jobId} failed`);
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  throw new Error(`Clone job ${args.jobId} did not complete within ${(maxAttempts * intervalMs) / 1000}s`);
}
