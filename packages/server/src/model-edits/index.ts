/**
 * Model Edits Client
 *
 * Activation-level knowledge editing: suppress or restore a single association
 * the model carries, without fine-tuning. An edit is a structural overlay on
 * the model's weights — applied live, recorded durably, and revertible.
 *
 * The intended flow is browse → edit → verify:
 * {@link ModelEditsClient.describe} shows what the model actually holds for an
 * entity, and its `relation`/`target` are what {@link ModelEditsClient.create}
 * expects, so an edit targets something demonstrable rather than a guess.
 *
 * ## What an edit does and does not do
 *
 * A `DELETE` is rank-1: it removes the model's *primary* association for the
 * fact. Paraphrases, implications and multi-hop routes to the same fact may
 * survive it. `probeResult` is the measured evidence of what actually moved —
 * treat that, not the presence of a COMMITTED record, as the answer to
 * "did this work?". Multi-hop deletion is not something this API promises.
 *
 * Requires `model-edits:read` / `model-edits:write` on the API key. Every
 * method throws with code `LARQL_UNAVAILABLE` (503) when the editing service
 * is not configured for the deployment.
 */

import { ServerHttpClient } from "../http-client.js";

/**
 * How long to wait on the calls that reach larql-service.
 *
 * larql-service serves a ~10 GiB vindex on an L4 and runs at minScale 0, so a
 * request arriving after an idle period pays a cold start: measured on
 * 2026-09-01, 23 seconds from "Starting new instance" to the model being
 * loaded, before any of the work begins.
 *
 * That mattered more than it sounds. A create that exceeded the 30s default
 * still COMMITTED server-side, so the caller saw a timeout, retried, and left a
 * duplicate suppression behind — which is how three stray edits reached a
 * production workspace while this was being verified. The visible failure and
 * the invisible success are the bad combination; a timeout past a realistic
 * cold start removes it for the common case.
 *
 * `list`, `get` and `revert` keep the default: they touch Mongo only.
 */
const LARQL_BACKED_TIMEOUT_MS = 120_000;

/** An operation on the model's knowledge. */
export type ModelEditOp = "INSERT" | "DELETE";

/**
 * Lifecycle of an edit record. Only `COMMITTED` edits are carried into a read.
 *
 * The WAL is the source of truth. A request derives its patch set from the
 * COMMITTED records and carries it, so any instance can serve it — the record,
 * not any instance's memory, is what makes an edit durable.
 */
export type ModelEditStatus = "PENDING" | "COMMITTED" | "REVERTED";

/**
 * Before/after evidence for an edit, measured by re-running inference against
 * the patched model.
 *
 * `deltaLogit` is `probeAfter - probeBefore` for the target token, so a
 * successful `DELETE` is negative and a successful `INSERT` positive. Optional
 * because the probe is best-effort: a service hiccup leaves the edit applied
 * but unmeasured, which is reported rather than hidden.
 */
export interface ModelEditProbeResult {
  deltaLogit: number;
  probeBefore: number;
  probeAfter: number;
}

/** One association the model carries for an entity. */
export interface ModelEditAssociation {
  /**
   * Relation label — probe-confirmed when the model has one for this feature,
   * otherwise the placeholder `"associated-with"`. Associations resolve by
   * target token, not by a stored relation.
   */
  relation: string;
  target: string;
  /**
   * 0..1, normalized against this entity's strongest edge. Raw gate scores are
   * unbounded (~10–50), so this is the value to render; `rawScore` is the
   * unnormalized one, comparable only within the same response.
   */
  confidence: number;
  rawScore: number;
  /** Layer the association is carried on. */
  layer: number;
  /** Neighbouring tokens at the same feature. */
  neighbors: string[];
}

export interface DescribeEntityResult {
  entity: string;
  associations: ModelEditAssociation[];
}

export interface ModelEdit {
  id: string;
  op: ModelEditOp;
  entity: string;
  relation: string;
  target: string;
  status: ModelEditStatus;
  /** The model build this edit was authored against. */
  modelVersion: string;
  appliedAt: string;
  committedAt?: string;
  revertedAt?: string;
  probeResult?: ModelEditProbeResult;
  /**
   * How much of the model's next-token distribution moved. Measurable for every
   * edit, unlike `probeResult`, which needs the target token to surface in the
   * model's top-k and usually finds it absent.
   */
  outputShift?: {
    top1Before: string | null;
    top1After: string | null;
    top1Changed: boolean;
    totalVariation: number;
    k: number;
  };
  /** Gate score either side of the edit. `scoreAfter: null` means the edge is gone. */
  gateEvidence?: {
    scoreBefore: number | null;
    scoreAfter: number | null;
    layer: number;
    feature: number;
  };
  /** The larql image that produced these measurements. */
  larqlRuntime?: string;
  /**
   * Which primitive the edit is. `ffn_delete` / `ffn_insert` change the
   * model's feature index (structural); `output_override` is a retrieval
   * entry that changes the answer and leaves the index untouched
   * (behavioural). They certify different things — an `ffn_delete` does not
   * by itself establish that the model answers differently. `null` on rows
   * older than the field whose kind cannot be derived.
   */
  kind?: ModelEditKind | null;
  /** INSERT only: what larql reported it did. */
  insertMode?: "knn" | "constellation" | "embedding";
  /** The before/after top-k behind `outputShift`, on the prompt it was read with. */
  readings?: ModelEditReadings;
}

export type ModelEditKind = "ffn_delete" | "ffn_insert" | "output_override";

export interface ModelEditReadings {
  k: number;
  /** Both sides read in the same request that applied the patch. */
  measuredAtomically: boolean;
  prompts: Array<{
    prompt: string;
    /** null = that side could not be read; never an empty list. */
    before: Array<{ token: string; probability: number }> | null;
    after: Array<{ token: string; probability: number }> | null;
  }>;
}

export interface CreateModelEditInput {
  entity: string;
  relation: string;
  target: string;
  op: ModelEditOp;
}

export interface CreateModelEditResult extends ModelEdit {
  /** Confidence of the association this edit resolved to. */
  confidence: number;
  /** Edits live on the model after this one was applied. */
  activeEditCount: number;
}

export interface RevertModelEditResult {
  editId: string;
  status: "reverted";
  entity: string;
  relation: string;
  target: string;
  revertedAt: string;
}

export interface ModelEditProbeResult {
  prompt: string;
  modelPrompt: string;
  style: string;
  predictions: Array<{ token: string; probability: number }> | null;
  override: { token: string; layer: number; cosine: number } | null;
}

export interface ModelEditsVersion {
  id: string;
  version: number;
  modelVersion: string;
  contentHash: string;
  patchCount: number;
  source: "manual" | "qa-run" | "api" | "restore";
  createdBy: string;
  createdAt: string;
  changelog?: string;
  parentVersionId?: string;
  patches: Array<{ patchId: string; op: ModelEditOp; entity: string; relation: string; target: string; layer: number; feature: number }>;
}

export interface RestoreModelEditsVersionResult {
  restoredFrom: { id: string; version: number };
  reverted: number;
  reapplied: number;
  version: ModelEditsVersion;
}

export interface ModelEditsVersionQaRun {
  iterationResultId: string;
  suiteId?: string;
  status?: string;
  completedAt?: number;
  releaseId?: string;
  releaseSlugVersion?: string;
  releaseSnapshotId: string;
  tests: number;
  avgScore: number | null;
}

export interface ReplaceModelEditInput {
  entity: string;
  relation: string;
  oldTarget: string;
  newTarget: string;
}

export interface ListModelEditsFilter {
  status?: ModelEditStatus;
  entity?: string;
  /** Workspace to target on the OAuth surface. Ignored for API-key callers,
   *  whose key already binds the workspace. */
  workspaceId?: string;
}

export class ModelEditsClient {
  private readonly httpClient: ServerHttpClient;
  private readonly defaultWorkspaceId?: string;

  constructor(httpClient: ServerHttpClient, defaultWorkspaceId?: string) {
    this.httpClient = httpClient;
    this.defaultWorkspaceId = defaultWorkspaceId;
  }

  private route(workspaceId?: string): {
    apiKey: boolean;
    describe: string;
    probe: string;
    edits: string;
    one: (id: string) => string;
    versions: string;
    version: (ref: string) => string;
    restore: (ref: string) => string;
    qaRuns: (ref: string) => string;
    export: string;
  } {
    const build = (base: string, apiKey: boolean) => ({
      apiKey,
      describe: `${base}/describe`,
      probe: `${base}/probe`,
      edits: apiKey ? base : `${base}/edits`,
      one: (id: string) => `${apiKey ? base : `${base}/edits`}/${encodeURIComponent(id)}`,
      versions: `${base}/versions`,
      version: (ref: string) => `${base}/versions/${encodeURIComponent(ref)}`,
      restore: (ref: string) => `${base}/versions/${encodeURIComponent(ref)}/restore`,
      qaRuns: (ref: string) => `${base}/versions/${encodeURIComponent(ref)}/qa-runs`,
      export: `${base}/export`,
    });
    if (this.httpClient.usesApiKey) return build("/api/v1/model-edits", true);
    const ws = workspaceId ?? this.defaultWorkspaceId;
    if (!ws) {
      throw new Error(
        "A workspace id is required for model edits when authenticating with OAuth. " +
          "Pass --workspace <id>, or set a default workspace."
      );
    }
    return build(`/white-label/${ws}/larql`, false);
  }

  /**
   * Browse the associations the model carries for an entity, strongest first.
   * This is the discovery step that makes an edit targetable. `target` pins one
   * association that ranks past the cut.
   */
  async describe(entity: string, workspaceId?: string, target?: string): Promise<DescribeEntityResult> {
    return this.httpClient.get<DescribeEntityResult>(
      this.route(workspaceId).describe,
      { entity, ...(target ? { target } : {}) },
      { timeout: LARQL_BACKED_TIMEOUT_MS }
    );
  }

  /** What the edited model predicts next; an added fact shows as `override`. */
  async probe(prompt: string, workspaceId?: string, top = 10): Promise<ModelEditProbeResult> {
    return this.httpClient.post<ModelEditProbeResult>(this.route(workspaceId).probe, { prompt, top });
  }

  async list(filter: ListModelEditsFilter = {}): Promise<ModelEdit[]> {
    const { edits } = await this.httpClient.get<{ edits: ModelEdit[] }>(
      this.route(filter.workspaceId).edits,
      { status: filter.status, entity: filter.entity }
    );
    return edits;
  }

  async get(editId: string, workspaceId?: string): Promise<ModelEdit> {
    const route = this.route(workspaceId);
    if (route.apiKey) {
      return this.httpClient.get<ModelEdit>(route.one(editId));
    }
    // The OAuth surface exposes list and delete but no fetch-one, so filter
    // the list rather than call a route that does not exist.
    const edits = await this.list({ workspaceId });
    const found = edits.find((e) => String((e as { id?: string }).id ?? "") === editId);
    if (!found) throw new Error(`Model edit ${editId} not found`);
    return found;
  }

  async create(
    input: CreateModelEditInput,
    workspaceId?: string
  ): Promise<CreateModelEditResult> {
    return this.httpClient.post<CreateModelEditResult>(this.route(workspaceId).edits, input, {
      timeout: LARQL_BACKED_TIMEOUT_MS,
    });
  }

  /** Suppress the held target, then add the new one. Two revertible edits. */
  async replace(
    input: ReplaceModelEditInput,
    workspaceId?: string
  ): Promise<{ suppressed: CreateModelEditResult; added: CreateModelEditResult }> {
    const suppressed = await this.create(
      { entity: input.entity, relation: input.relation, target: input.oldTarget, op: "DELETE" },
      workspaceId
    );
    const added = await this.create(
      { entity: input.entity, relation: input.relation, target: input.newTarget, op: "INSERT" },
      workspaceId
    );
    return { suppressed, added };
  }

  /**
   * Revert an edit, restoring the association.
   *
   * Throws `ALREADY_REVERTED` (409) if it has already been undone. The stored
   * record is the source of truth: a revert takes effect on the next read,
   * because a reverted record simply stops being part of the patch set the
   * request carries. No instance holds state that has to be undone.
   */
  async revert(editId: string, workspaceId?: string): Promise<RevertModelEditResult> {
    return this.httpClient.delete<RevertModelEditResult>(this.route(workspaceId).one(editId));
  }

  async listVersions(workspaceId?: string, limit?: number): Promise<ModelEditsVersion[]> {
    const { versions } = await this.httpClient.get<{ versions: ModelEditsVersion[] }>(
      this.route(workspaceId).versions,
      limit ? { limit } : undefined
    );
    return versions;
  }

  async getVersion(ref: string, workspaceId?: string): Promise<ModelEditsVersion> {
    const { version } = await this.httpClient.get<{ version: ModelEditsVersion }>(this.route(workspaceId).version(ref));
    return version;
  }

  async saveVersion(workspaceId?: string, changelog?: string): Promise<{ version: ModelEditsVersion; created: boolean }> {
    return this.httpClient.post<{ version: ModelEditsVersion; created: boolean }>(this.route(workspaceId).versions, { changelog });
  }

  async restoreVersion(ref: string, workspaceId?: string): Promise<RestoreModelEditsVersionResult> {
    return this.httpClient.post<RestoreModelEditsVersionResult>(this.route(workspaceId).restore(ref), {});
  }

  async versionQaRuns(ref: string, workspaceId?: string): Promise<{ version: ModelEditsVersion; runs: ModelEditsVersionQaRun[] }> {
    return this.httpClient.get<{ version: ModelEditsVersion; runs: ModelEditsVersionQaRun[] }>(this.route(workspaceId).qaRuns(ref));
  }

  async export(workspaceId?: string): Promise<Record<string, unknown>> {
    return this.httpClient.get<Record<string, unknown>>(this.route(workspaceId).export);
  }
}
