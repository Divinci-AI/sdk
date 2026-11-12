/**
 * Model Edits namespace — activation-level knowledge editing.
 *
 * Suppress or restore a single association the model carries, without
 * fine-tuning. An edit is a structural overlay on the model's weights, applied
 * live and revertible.
 *
 * The intended flow is browse → edit → verify → (optionally) revert:
 *
 * @example
 * ```typescript
 * // 1. See what the model associates with an entity.
 * const { associations } = await client.modelEdits.describe("Paris");
 *
 * // 2. Suppress the strongest one.
 * const top = associations[0];
 * const edit = await client.modelEdits.create({
 *   entity: "Paris",
 *   relation: top.relation,
 *   target: top.target,
 *   op: "DELETE",
 * });
 *
 * // 3. The probe brackets the edit — see `probeResult`.
 * console.log(edit.probeResult?.deltaLogit);
 *
 * // 4. Undo it.
 * await client.modelEdits.revert(edit.id);
 * ```
 *
 * ## What an edit does and does not do
 *
 * A `DELETE` is rank-1: it removes the model's *primary* association for the
 * fact. Paraphrases, implications and multi-hop routes to the same fact may
 * survive it. Multi-hop deletion is not something this API can promise.
 *
 * `probeResult` is a DIAGNOSTIC, not proof of erasure. It is measured in
 * larql's `walk` inference path, which is uncalibrated against the served
 * model, and on LarQL runtimes built before 2026-08-30 a DELETE reached the
 * gate index without reaching the forward pass at all — so a delta from such
 * a build cannot reflect the suppression. Report it as a signal and say what
 * it is; do not tell end users it proves the fact is gone.
 *
 * Requires the `model-edits:read` / `model-edits:write` API-key permissions.
 * Every method throws `ApiError` with code `LARQL_UNAVAILABLE` (503) when the
 * editing service is not configured for the deployment.
 */
import { BaseNamespace } from "../base.js";
import { NotFoundError } from "../../errors.js";

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
 * successful `DELETE` is negative and a successful `INSERT` positive. It is
 * optional because the probe is best-effort — a service hiccup leaves the
 * edit applied but unmeasured, which is reported rather than hidden.
 */
/**
 * Timeout for the two calls that reach larql, rather than only Mongo.
 *
 * The client default is 30s, which is right for CRUD and wrong for this.
 * larql-service serves a ~10 GiB vindex on an L4 and runs at minScale 0, so a
 * request arriving after an idle period pays a cold start: measured on
 * 2026-09-01, 23 seconds from "Starting new instance" to the model being
 * loaded, before any of the work.
 *
 * That mattered more than it sounds. A create that exceeded 30s still COMMITTED
 * server-side, so the caller saw a timeout, retried, and left a duplicate
 * suppression behind — which is exactly how three stray edits reached the
 * Dr. Fuhrman workspace while this was being verified. The visible failure and
 * the invisible success are the bad combination; lengthening the timeout past a
 * realistic cold start removes it for the common case.
 *
 * `list`, `get` and `revert` keep the default: they touch Mongo only.
 */
const LARQL_BACKED_TIMEOUT_MS = 120_000;

export interface ModelEditOutputShift {
  top1Before: string | null;
  top1After: string | null;
  top1Changed: boolean;
  /** Share of probability mass that moved, in [0,1]. */
  totalVariation: number;
  k: number;
}

export interface ModelEditGateEvidence {
  scoreBefore: number | null;
  /** null means the association is absent, which is a suppression that worked. */
  scoreAfter: number | null;
  layer: number;
  feature: number;
}

export interface ModelEditProbeResult {
  deltaLogit: number;
  probeBefore: number;
  probeAfter: number;
}

/** One association the model carries for an entity. */
export interface ModelEditAssociation {
  /**
   * Relation label. A probe-confirmed label when the model has one for this
   * feature, otherwise the placeholder `"associated-with"` — the association
   * is resolved by target token, not by a stored relation.
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
   * How much of the model's next-token probability mass moved. Unlike
   * `probeResult` this needs no target token, so it is measurable for every
   * edit — prefer it when deciding whether an edit did anything.
   */
  outputShift?: ModelEditOutputShift;
  /** The gate score either side of the edit. `scoreAfter: null` means the edge is gone. */
  gateEvidence?: ModelEditGateEvidence;
  /** The larql image that produced the measurements; neither is interpretable without it. */
  larqlRuntime?: string;
  /**
   * Which primitive the edit is. `ffn_delete` / `ffn_insert` change the
   * model's feature index (structural); `output_override` is a retrieval
   * entry that changes the answer and leaves the index untouched
   * (behavioural). An `ffn_delete` does not by itself establish that the
   * model answers differently. `null` on older rows whose kind cannot be derived.
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
  /** Canonical id of the edit. */
  id: string;
  /** @deprecated Use `id`. */
  editId: string;
  status: "reverted";
  entity: string;
  relation: string;
  target: string;
  revertedAt: string;
}

/** What the edited model predicts next for a question. */
export interface ModelEditProbeResult {
  prompt: string;
  /** The exact text the model ran, after chat-format wrapping. */
  modelPrompt: string;
  style: string;
  predictions: Array<{ token: string; probability: number }> | null;
  /** Set when an added fact answered: its token, layer and match score. */
  override: { token: string; layer: number; cosine: number } | null;
}

/** An immutable, numbered snapshot of the active edits (content-addressed). */
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

/** A QA run that scored while a version was in force (provenance). */
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
  /** The target the model holds now; suppressed first. */
  oldTarget: string;
  /** The target to teach instead. */
  newTarget: string;
}

export interface ListModelEditsFilter {
  status?: ModelEditStatus;
  entity?: string;
  /** Target a specific workspace; required on the OAuth surface when the
   *  client was not constructed with one. Ignored for API-key callers, whose
   *  key already binds the workspace. */
  workspaceId?: string;
}

export class ModelEditsNamespace extends BaseNamespace {
  private route(params?: { workspaceId?: string }): {
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
    if (this.httpClient.hasApiKey) return build("/api/v1/model-edits", true);
    return build(`/white-label/${this.getWorkspaceId(params)}/larql`, false);
  }

  /**
   * Browse what the model associates with an entity. Pass `target` to pin a
   * specific association into the result even when it ranks below the
   * strongest ones — the fact you came to edit often does.
   */
  async describe(entity: string, params?: { workspaceId?: string; target?: string }): Promise<DescribeEntityResult> {
    return this.httpClient.get<DescribeEntityResult>(
      this.route(params).describe,
      { entity, ...(params?.target ? { target: params.target } : {}) },
      { timeout: LARQL_BACKED_TIMEOUT_MS },
    );
  }

  /**
   * Ask the edited model a question and see its next-token distribution. An
   * added fact shows up as `override`. Sent in the model's chat format; keep
   * the phrasing an added fact was keyed on ("What is the <relation> of
   * <entity>? Answer with one word.").
   */
  async probe(prompt: string, params?: { workspaceId?: string; top?: number }): Promise<ModelEditProbeResult> {
    return this.httpClient.post<ModelEditProbeResult>(this.route(params).probe, {
      prompt,
      top: params?.top ?? 10,
    });
  }

  async list(filter: ListModelEditsFilter = {}): Promise<ModelEdit[]> {
    const { edits } = await this.httpClient.get<{ edits: ModelEdit[] }>(this.route(filter).edits, {
      status: filter.status,
      entity: filter.entity,
    });
    return edits;
  }

  async get(editId: string, params?: { workspaceId?: string }): Promise<ModelEdit> {
    const route = this.route(params);
    if (route.apiKey) {
      return this.httpClient.get<ModelEdit>(route.one(editId));
    }
    const edits = await this.list({ workspaceId: params?.workspaceId });
    const found = edits.find((e) => String((e as { id?: string }).id ?? "") === editId);
    if (!found) {
      throw new NotFoundError(`Model edit ${editId} not found`, {
        code: "NOT_FOUND",
        status: 404,
      });
    }
    return found;
  }

  async create(
    input: CreateModelEditInput,
    params?: { workspaceId?: string }
  ): Promise<CreateModelEditResult> {
    return this.httpClient.post<CreateModelEditResult>(this.route(params).edits, input, {
      timeout: LARQL_BACKED_TIMEOUT_MS,
    });
  }

  /**
   * Change a fact: suppress the association the model holds, then add the
   * new one for the same relation. Two edits, each revertible on its own.
   */
  async replace(
    input: ReplaceModelEditInput,
    params?: { workspaceId?: string }
  ): Promise<{ suppressed: CreateModelEditResult; added: CreateModelEditResult }> {
    const suppressed = await this.create(
      { entity: input.entity, relation: input.relation, target: input.oldTarget, op: "DELETE" },
      params
    );
    const added = await this.create(
      { entity: input.entity, relation: input.relation, target: input.newTarget, op: "INSERT" },
      params
    );
    return { suppressed, added };
  }

  async revert(editId: string, params?: { workspaceId?: string }): Promise<RevertModelEditResult> {
    return this.httpClient.delete<RevertModelEditResult>(this.route(params).one(editId));
  }

  /** Numbered snapshots of the active edits, newest first. */
  async listVersions(params?: { workspaceId?: string; limit?: number }): Promise<ModelEditsVersion[]> {
    const { versions } = await this.httpClient.get<{ versions: ModelEditsVersion[] }>(
      this.route(params).versions,
      params?.limit ? { limit: params.limit } : undefined
    );
    return versions;
  }

  /** One version by id or number ("3" or "v3"). */
  async getVersion(ref: string, params?: { workspaceId?: string }): Promise<ModelEditsVersion> {
    const { version } = await this.httpClient.get<{ version: ModelEditsVersion }>(this.route(params).version(ref));
    return version;
  }

  /** Freeze the active edits as a version. Returns the existing one when the set is unchanged. */
  async saveVersion(
    params?: { workspaceId?: string; changelog?: string }
  ): Promise<{ version: ModelEditsVersion; created: boolean }> {
    return this.httpClient.post<{ version: ModelEditsVersion; created: boolean }>(this.route(params).versions, {
      changelog: params?.changelog,
    });
  }

  /** Make the active edits equal to a version's set. Itself recorded as a version. */
  async restoreVersion(ref: string, params?: { workspaceId?: string }): Promise<RestoreModelEditsVersionResult> {
    return this.httpClient.post<RestoreModelEditsVersionResult>(this.route(params).restore(ref), {});
  }

  /** QA runs that scored while this version was in force. */
  async versionQaRuns(
    ref: string,
    params?: { workspaceId?: string }
  ): Promise<{ version: ModelEditsVersion; runs: ModelEditsVersionQaRun[] }> {
    return this.httpClient.get<{ version: ModelEditsVersion; runs: ModelEditsVersionQaRun[] }>(this.route(params).qaRuns(ref));
  }

  /** The receipt: model, every edit with evidence, every version, what is active now. */
  async export(params?: { workspaceId?: string }): Promise<Record<string, unknown>> {
    return this.httpClient.get<Record<string, unknown>>(this.route(params).export);
  }
}
