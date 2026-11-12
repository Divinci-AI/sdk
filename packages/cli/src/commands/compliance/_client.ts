import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";

/**
 * Shared HTTP for the compliance commands.
 *
 * Uses the OAuth-friendly white-label route with a Bearer token — the same
 * reasoning as release/list.ts: the /api/v1 surface is API-key-only, so a CLI
 * session authenticated by `divinci auth login` gets a 404 there.
 */
export async function complianceFetch(
  globalOpts: Record<string, unknown>,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ text: string; json: <T>() => T }> {
  let config = requireConfig(globalOpts);
  config = await ensureValidToken(config);
  const workspaceId = requireWorkspaceId(config);
  const baseUrl = config.apiUrl.replace(/\/+$/, "");

  const res = await fetch(`${baseUrl}/white-label/${workspaceId}/compliance${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    // Surface the server's own message — the dossier service returns a specific
    // one for an unanswerable gap, and losing it would leave the user guessing.
    let detail = text.substring(0, 400);
    try {
      const parsed = JSON.parse(text) as { error?: string | { message?: string } };
      const e = parsed.error;
      if (typeof e === "string") detail = e;
      else if (e?.message) detail = e.message;
    } catch { /* keep the raw body */ }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }

  return {
    text,
    json: <T>(): T => {
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Non-JSON response: ${text.substring(0, 200)}`);
      }
    },
  };
}

export interface DossierGap {
  id: string;
  text: string;
  kind: "requires-answer" | "requires-change";
  prompt?: string;
}
export interface DossierSection {
  point: string;
  title: string;
  status: "generated" | "partial" | "requires-input";
  fields: Array<{ label: string; value: string }>;
  gaps: DossierGap[];
}
export interface Dossier {
  dossierId: string;
  generatedAt: string;
  system: { releaseId: string; name: string; version: string };
  sections: DossierSection[];
  completeness: {
    generated: number;
    partial: number;
    requiresInput: number;
    openGaps: number;
  };
}
