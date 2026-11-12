/**
 * Meta-Harness Client
 *
 * Server-side meta-harness orchestration operations.
 * Provides sub-accessors for loop, iterations, and proposals.
 */

import type {
  MetaHarnessLoop,
  MetaHarnessIteration,
  MetaHarnessProposal,
  UpdateLoopConfigOptions,
  ListIterationsOptions,
  ListProposalsOptions,
  RejectProposalOptions,
} from "@divinci-ai/types";
import { ServerHttpClient } from "../http-client.js";

export class MetaHarnessClient {
  readonly loop: MetaHarnessLoopClient;
  readonly iterations: MetaHarnessIterationsClient;
  readonly proposals: MetaHarnessProposalsClient;

  constructor(httpClient: ServerHttpClient) {
    this.loop = new MetaHarnessLoopClient(httpClient);
    this.iterations = new MetaHarnessIterationsClient(httpClient);
    this.proposals = new MetaHarnessProposalsClient(httpClient);
  }
}

// ─── Loop ────────────────────────────────────────────────────────────

class MetaHarnessLoopClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /** Get or create the orchestration loop for this workspace. */
  async get(): Promise<MetaHarnessLoop> {
    return this.httpClient.get<MetaHarnessLoop>("/api/v1/meta-harness/loop");
  }

  /** Update loop configuration. */
  async update(config: UpdateLoopConfigOptions): Promise<MetaHarnessLoop> {
    const res = await this.httpClient.patch<{ loop: MetaHarnessLoop }>(
      "/api/v1/meta-harness/loop",
      config,
    );
    return res.loop;
  }

  /** Trigger a single iteration. Returns immediately (202 Accepted). */
  async iterate(): Promise<{ accepted: boolean; loopId: string }> {
    return this.httpClient.post<{ accepted: boolean; loopId: string }>(
      "/api/v1/meta-harness/loop/iterate",
      {},
    );
  }

  /** Pause the loop (iterations rejected until resumed). */
  async pause(): Promise<MetaHarnessLoop> {
    return this.httpClient.post<MetaHarnessLoop>(
      "/api/v1/meta-harness/loop/pause",
      {},
    );
  }

  /** Resume a paused loop. */
  async resume(): Promise<MetaHarnessLoop> {
    return this.httpClient.post<MetaHarnessLoop>(
      "/api/v1/meta-harness/loop/resume",
      {},
    );
  }

  /** Cancel the loop (terminal state — requires meta-harness:admin). */
  async cancel(): Promise<MetaHarnessLoop> {
    return this.httpClient.post<MetaHarnessLoop>(
      "/api/v1/meta-harness/loop/cancel",
      {},
    );
  }
}

// ─── Iterations ──────────────────────────────────────────────────────

class MetaHarnessIterationsClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /** List iteration history. */
  async list(options: ListIterationsOptions = {}): Promise<MetaHarnessIteration[]> {
    return this.httpClient.get<MetaHarnessIteration[]>(
      "/api/v1/meta-harness/iterations",
      { limit: options.limit, cursor: options.cursor },
    );
  }

  /** Get a single iteration by ID. */
  async get(iterationId: string): Promise<MetaHarnessIteration> {
    return this.httpClient.get<MetaHarnessIteration>(
      `/api/v1/meta-harness/iterations/${iterationId}`,
    );
  }
}

// ─── Proposals ───────────────────────────────────────────────────────

class MetaHarnessProposalsClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /** List proposals, optionally filtered by status. */
  async list(options: ListProposalsOptions = {}): Promise<MetaHarnessProposal[]> {
    return this.httpClient.get<MetaHarnessProposal[]>(
      "/api/v1/meta-harness/proposals",
      { status: options.status, limit: options.limit, cursor: options.cursor },
    );
  }

  /** Accept a proposal (triggers its underlying action). */
  async accept(proposalId: string): Promise<MetaHarnessProposal> {
    return this.httpClient.post<MetaHarnessProposal>(
      `/api/v1/meta-harness/proposals/${proposalId}/accept`,
      {},
    );
  }

  /** Reject a proposal with an optional reason. */
  async reject(proposalId: string, options: RejectProposalOptions = {}): Promise<MetaHarnessProposal> {
    return this.httpClient.post<MetaHarnessProposal>(
      `/api/v1/meta-harness/proposals/${proposalId}/reject`,
      { reason: options.reason },
    );
  }
}
