/**
 * Test-fixture discovery via the ux API layer (JWT-authenticated) — the
 * same endpoints the production web client uses, so they're a reliable
 * way to find a workspace + release the test user can chat against.
 */
import { integrationConfig } from "./env.js";
import { record } from "./shape-report.js";

function anyId(obj: unknown): string | undefined {
  const rec = obj as Record<string, unknown> | null;
  const candidate = rec?.id ?? rec?._id;
  return typeof candidate === "string" ? candidate : undefined;
}

async function getJson(path: string, accessToken: string): Promise<unknown> {
  const response = await fetch(`${integrationConfig.apiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${path} → ${response.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GET ${path} returned non-JSON (status ${response.status})`);
  }
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  const rec = value as Record<string, unknown> | null;
  for (const key of ["page", "data", "whitelabels", "releases", "items"]) {
    if (Array.isArray(rec?.[key])) return rec![key] as Array<Record<string, unknown>>;
  }
  return [];
}

export interface DiscoveredFixtures {
  workspaceId: string;
  releaseId: string;
  /** The release's primary assistant/model id, when present on the wire. */
  assistantId?: string;
}

/** Find a workspace owned by the test user and an active release in it. */
export async function discoverFixtures(accessToken: string): Promise<DiscoveredFixtures> {
  const rawWorkspaces = await getJson("/white-label/", accessToken);
  record("ux.GET /white-label/", rawWorkspaces, "workspace discovery");
  const workspaces = asArray(rawWorkspaces);

  // Prefer the configured test workspace when the user can see it.
  const preferred = workspaces.find((w) => anyId(w) === integrationConfig.testWorkspaceId);
  const candidates = preferred ? [preferred, ...workspaces] : workspaces;

  for (const workspace of candidates) {
    const workspaceId = anyId(workspace);
    if (!workspaceId) continue;

    let rawReleases: unknown;
    try {
      rawReleases = await getJson(`/white-label/${workspaceId}/release`, accessToken);
    } catch {
      continue; // no permission on this workspace — try the next
    }
    record(`ux.GET /white-label/{id}/release`, rawReleases, `workspace ${workspaceId}`);

    const releases = asArray(rawReleases);
    const active =
      releases.find((r) => r.status === "active" || r.live === true) ?? releases[0];
    const releaseId = anyId(active);
    if (releaseId) {
      const assistant = (active?.assistant ?? {}) as Record<string, unknown>;
      const assistantId = typeof assistant.id === "string" ? assistant.id : undefined;
      console.log(
        `[integration] discovered workspace=${workspaceId} release=${releaseId} assistant=${assistantId ?? "none"}`,
      );
      return { workspaceId, releaseId, assistantId };
    }
  }

  throw new Error(
    `no usable workspace/release found for the test user (saw ${workspaces.length} workspaces)`,
  );
}
