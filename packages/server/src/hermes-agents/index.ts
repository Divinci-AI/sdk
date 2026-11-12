/**
 * Hosted Hermes Agents Client
 *
 * Manage Divinci-hosted Hermes agents per whitelabel — each an isolated
 * NousResearch/hermes-agent running in its own Cloudflare Sandbox container.
 * Create one, get its `hsk-` proxy key, and drive it from a local Hermes, the
 * desktop app, or any OpenAI-compatible client.
 *
 * Models: pick a Divinci-paid PLATFORM model (Gemini on Vertex AI, open models
 * on Cloudflare Workers AI) with no key, or bring your own key for
 * openai/anthropic/openrouter/gemini. See the model catalog in @divinci-ai/models.
 */

import { ServerHttpClient } from "../http-client.js";

export type HermesAgentStatus = "provisioned" | "active" | "stopped";

/**
 * Client-safe hosted Hermes agent WITHOUT the proxy key.
 *
 * This is what `list()` and `update()` return. The `hsk-` proxy key is a live
 * inference credential, so the API emits it only where a caller asked for one
 * specific agent's key — `create()`, `get()`, `regenerateKey()`.
 */
export interface HermesAgentSummary {
  _id: string;
  target: string;
  /** Stable per-agent key routed to the hosted Worker. */
  agentKey: string;
  title: string;
  description?: string;
  hermesModel: string;
  systemPrompt?: string;
  status: HermesAgentStatus;
  enabled: boolean;
  /** Linked White Label release for per-turn RAG grounding (24-hex id), if any. */
  releaseId?: string | null;
  /** BYOK provider name, when a customer key is attached. */
  provider?: string | null;
  /** Whether a BYOK provider key is stored (the key itself is never returned). */
  hasProviderApiKey: boolean;
  /**
   * Slack Socket Mode config (client-safe). Tokens never returned — only
   * hasBotToken / hasAppToken. Use allowedChannels with G… ids for private channels.
   */
  slack?: HermesSlackConfigClient | null;
  lastActiveAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** A hosted Hermes agent INCLUDING its `hsk-…` proxy key (create / get / regenerate). */
export interface HermesAgent extends HermesAgentSummary {
  /**
   * Customer-facing `hsk-…` proxy key for OpenAI-compatible clients.
   *
   * A live spend credential: every completion it buys is billed to the
   * workspace. Do not log it, and do not print it from a bulk listing — that is
   * exactly the leak `list()` no longer has.
   */
  proxyApiKey: string;
}

/** Client-safe Slack config on a Hermes agent (no token ciphertext). */
export interface HermesSlackConfigClient {
  enabled: boolean;
  hasBotToken: boolean;
  hasAppToken: boolean;
  allowedUsers: string[];
  allowedChannels: string[];
  homeChannelId?: string | null;
  homeChannelName?: string | null;
  freeResponseChannels?: string[];
  replyInThread?: boolean;
  requireMention?: boolean;
  applyStatus?: "never" | "pending" | "applied" | "error" | "not_supported";
  applyError?: string | null;
  appliedAt?: string | Date | null;
}

/** PATCH body for Slack Socket Mode (private-channel ready). */
export interface HermesSlackConfigInput {
  enabled?: boolean;
  /** Bot User OAuth Token (xoxb-…). Empty string clears. */
  botToken?: string;
  /** App-Level Token for Socket Mode (xapp-…). Empty string clears. */
  appToken?: string;
  /** Slack Member IDs (U…), array or comma-separated. */
  allowedUsers?: string[] | string;
  /**
   * Channel allowlist: C… public, G… private. Empty = unrestricted.
   * Private org channels must list their G… id here when allowlisting.
   */
  allowedChannels?: string[] | string;
  homeChannelId?: string | null;
  homeChannelName?: string | null;
  freeResponseChannels?: string[] | string;
  replyInThread?: boolean;
  requireMention?: boolean;
  /** Wipe all Slack config. */
  clear?: boolean;
}

export interface CreateHermesAgentBody {
  title: string;
  description?: string;
  /** Model id, e.g. `vertex_ai/gemini-2.5-flash` (platform) or `anthropic/claude-sonnet-4-5` (BYOK). */
  hermesModel?: string;
  systemPrompt?: string;
  /**
   * Link a White Label release for per-turn RAG grounding. Each chat turn
   * retrieves context from the release's knowledge base and injects it into the
   * user message. 24-hex release id, or "" to leave unlinked.
   */
  releaseId?: string;
  /** BYOK provider — only for a bring-your-own-key model. */
  provider?: string;
  /** BYOK plaintext key — encrypted server-side, never stored raw. */
  providerApiKey?: string;
  /** Optional Slack Socket Mode config at create time. */
  slack?: HermesSlackConfigInput;
}

export interface UpdateHermesAgentBody {
  title?: string;
  description?: string;
  hermesModel?: string;
  systemPrompt?: string;
  enabled?: boolean;
  /** Link/unlink a release for RAG grounding. 24-hex id, or "" to unlink. */
  releaseId?: string;
  provider?: string;
  providerApiKey?: string;
  /** Slack Socket Mode / private channel config. */
  slack?: HermesSlackConfigInput | null;
  /** Proactive ("tick awake") config. `null` clears it entirely. */
  proactive?: HermesProactiveConfigInput | null;
}

/**
 * Proactive ("tick awake") config — the agent wakes on its own schedule and
 * decides whether it has anything worth saying.
 *
 * Agent-level rather than nested under `slack`: goals and memories are the
 * agent's cognition, not Slack transport config, even though delivery targets
 * `slack.homeChannelId`.
 *
 * `lastRunAt` is deliberately absent — it is server-managed. A client able to
 * rewind it could make the agent due again immediately, which is the one field
 * that turns a config edit into unbounded spend on the owner's wallet.
 */
export interface HermesProactiveConfigInput {
  /** Master switch. Default false — an agent never ticks unless asked to. */
  enabled?: boolean;
  /**
   * `shadow` runs the full metered turn and writes a run row WITHOUT posting to
   * Slack; `live` also posts. Defaults to `shadow`, so enabling the feature can
   * never by itself put a message in a customer's channel.
   */
  mode?: "shadow" | "live";
  /**
   * Wake time in the agent's own timezone (IANA zone). With `intervalHours`
   * set this is the anchor for the FIRST wake rather than the only one.
   */
  schedule?: { hour: number; minute: number; timezone: string };
  /**
   * Wake every N hours (1-24) instead of once a day. `null` ⇒ once a day.
   *
   * ⚠️ Multiplies spend and interruptions by `24 / N`: every wake is one billed
   * turn against the workspace wallet, including the ticks that stay silent.
   * At 3 hours that is 8 turns a day rather than 1. Prefer `shadow` mode for
   * short intervals unless the loop is watching something that really does
   * change that often.
   *
   * Whole hours only — `0.5` is rejected rather than rounded, because silently
   * reinterpreting a schedule shows up later as an unexplained bill.
   */
  intervalHours?: number | null;
  /**
   * How many distinct items ONE wake may raise (1-5). `null` ⇒ 1.
   *
   * ⚠️ A CEILING, not a quota. The whole wake is still delivered as a SINGLE
   * message — this does not multiply interruptions, it stops a genuinely
   * multi-part answer from being truncated to one item on a turn that was
   * billed either way. Silence remains the expected outcome at every budget,
   * and an agent that pads to the ceiling has made the loop worse.
   */
  maxItemsPerWake?: number | null;
  /**
   * `agentKey` of a SIBLING agent in the SAME workspace whose recent wakes this
   * agent reads. `null` ⇒ unpaired.
   *
   * Pair two agents on DIFFERENT models and each one sees what the other has
   * been thinking, so one can disagree with the other instead of both
   * monologuing past each other.
   *
   * ⚠️ This is not a chat channel between them, and cannot become one. Nothing
   * either agent says can WAKE the other: each still fires only on its own
   * server-side schedule under its own daily cap, and simply finds the
   * sibling's latest thinking already there. Two bots answering each other
   * directly is exactly what the Slack bridge refuses, because it does not
   * terminate and it bills both wallets.
   *
   * ⚠️ Cross-workspace pairing is not possible: the lookup is scoped to the
   * agent's own workspace, so a key from elsewhere resolves to nothing and the
   * agent simply runs unpaired.
   */
  partnerAgentKey?: string | null;
  /**
   * Transcript this agent writes its wakes into. `null` ⇒ writes nowhere.
   *
   * Point SEVERAL agents at the SAME transcript and they become a fleet: one
   * conversation a human can open and read, with each message attributed to
   * the agent that produced it. There is no separate "group" object — the
   * shared transcript is the group.
   *
   * ⚠️ Must be a BRANCHED transcript. Linear is the restricted form (one
   * unbranched thread), and each agent wake is an assistant message with no
   * `replyTo` — another root — which linear cannot represent. The server
   * refuses rather than silently converting an existing linear chat.
   *
   * ⚠️ Writing here does NOT charge. The wake was already escrowed and
   * finalized before it reached the transcript; the message carries the cost
   * as attribution so the spend is visible beside what it bought.
   */
  transcriptId?: string | null;
  /** What the agent is working toward. Admin-authored. */
  goals?: string[];
  /** What it should remember. Admin-authored, never auto-harvested. */
  memories?: string[];
  /**
   * Where a `live` message goes. Merged as a WHOLE, not field-by-field: a
   * partial merge would let "set an SMS number" silently retain a stale email
   * target. Absent ⇒ Slack home channel only.
   *
   * ⚠️ Every channel spends from the SAME human attention budget — the ceiling
   * for unsolicited AI messages is 3-5/day across ALL sources combined, so
   * three channels is three interruptions, not one budget each.
   */
  deliver?: { slack?: boolean; email?: string | null; sms?: string | null } | null;
  /** Clear the whole config (equivalent to sending `proactive: null`). */
  clear?: boolean;
}

/** One recorded proactive wake. */
export interface HermesProactiveRun {
  ranAt: string;
  mode: "shadow" | "live";
  /** What the agent produced, verbatim — including a `[SILENT]` sentinel. */
  output: string;
  delivered: boolean;
  deliveredTs?: string | null;
  skipReason?: string | null;
  error?: string | null;
  /** What the owner's wallet was charged. A silent turn still costs. */
  costCents: number;
}

/** OpenAI-compatible chat message. */
export interface HermesChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** OpenAI-compatible chat-completion response (non-streaming). */
export interface HermesChatResponse {
  id?: string;
  object?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  [key: string]: unknown;
}

export class HermesAgentsClient {
  private readonly httpClient: ServerHttpClient;

  constructor(httpClient: ServerHttpClient) {
    this.httpClient = httpClient;
  }

  /** Create a hosted Hermes agent. Returns the record incl. its `hsk-` proxy key. */
  async create(workspaceId: string, body: CreateHermesAgentBody): Promise<HermesAgent> {
    return this.httpClient.post<HermesAgent>(
      `/white-label/${workspaceId}/hermes-agent`,
      body,
    );
  }

  /**
   * List the workspace's hosted Hermes agents (tenant-scoped to the caller).
   *
   * Returns summaries — NO `proxyApiKey`. Fetch one agent's key with `get()`.
   */
  async list(workspaceId: string): Promise<HermesAgentSummary[]> {
    return this.httpClient.get<HermesAgentSummary[]>(
      `/white-label/${workspaceId}/hermes-agent`,
    );
  }

  /** Get one agent by id. */
  async get(workspaceId: string, agentId: string): Promise<HermesAgent> {
    return this.httpClient.get<HermesAgent>(
      `/white-label/${workspaceId}/hermes-agent/${agentId}`,
    );
  }

  /**
   * Update an agent's config (title/model/persona/enabled or BYOK).
   *
   * Returns a summary — a rename does not re-emit the proxy key.
   */
  async update(
    workspaceId: string,
    agentId: string,
    body: UpdateHermesAgentBody,
  ): Promise<HermesAgentSummary> {
    return this.httpClient.patch<HermesAgentSummary>(
      `/white-label/${workspaceId}/hermes-agent/${agentId}`,
      body,
    );
  }

  /**
   * Recent proactive wakes, newest first.
   *
   * In shadow mode this IS the feature — the point of a shadow week is reading
   * what the agent WOULD have said before letting it say it, so a run log
   * nobody can read makes shadow indistinguishable from the feature being off.
   */
  async proactiveRuns(
    workspaceId: string,
    agentId: string,
    limit?: number,
  ): Promise<{ runs: HermesProactiveRun[] }> {
    const q = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
    return this.httpClient.get<{ runs: HermesProactiveRun[] }>(
      `/white-label/${workspaceId}/hermes-agent/${agentId}/proactive-runs${q}`,
    );
  }

  /** Delete an agent (stops its container and removes the record). */
  async delete(workspaceId: string, agentId: string): Promise<{ ok: boolean }> {
    return this.httpClient.delete<{ ok: boolean }>(
      `/white-label/${workspaceId}/hermes-agent/${agentId}`,
    );
  }

  /** Regenerate (rotate) the `hsk-` proxy key, revoking the old one. */
  async regenerateKey(workspaceId: string, agentId: string): Promise<HermesAgent> {
    return this.httpClient.post<HermesAgent>(
      `/white-label/${workspaceId}/hermes-agent/${agentId}/regenerate-key`,
      {},
    );
  }

  /**
   * Send one OpenAI-compatible chat turn to the agent's container and get the
   * full response back (non-streaming). The agent's stored model + persona are
   * applied server-side; the turn is metered to the workspace wallet.
   */
  async chat(
    workspaceId: string,
    agentId: string,
    messages: HermesChatMessage[],
    opts: { maxTokens?: number } = {},
  ): Promise<HermesChatResponse> {
    return this.httpClient.post<HermesChatResponse>(
      `/white-label/${workspaceId}/hermes-agent/${agentId}/chat`,
      {
        messages,
        stream: false,
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      },
    );
  }
}
