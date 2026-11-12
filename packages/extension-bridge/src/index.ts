/**
 * @divinci-ai/extension-bridge
 *
 * One call to run AI chat that prefers the user's Divinci Local Inference
 * browser extension (on-device, private, free) and falls back to the Divinci
 * cloud API when the extension isn't installed. Also exposes the extension's
 * WebMCP/A2A surfaces when present.
 *
 *   import { createDivinciBridge } from "@divinci-ai/extension-bridge";
 *   const divinci = createDivinciBridge({ cloudChat });
 *   const { fullText, source } = await divinci.chat(
 *     { messages: [{ role: "user", content: "hi" }] },
 *     { onToken: (t) => process.stdout.write(t) },
 *   );
 *
 * The dispatch logic is pure and dependency-injected (window + cloudChat are
 * options), so it's fully unit-testable without a browser or network.
 */

export type ConsentScope = "chat" | "webmcp" | "a2a";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BridgeChatRequest {
  messages: ChatMessage[];
  maxNewTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface ChatHandlers {
  onToken?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface BridgeChatResult {
  fullText: string;
  /** Where the answer came from — lets the caller surface "running on-device". */
  source: "extension" | "cloud";
}

/** The `window.divinci` surface injected by the extension's MAIN-world script. */
export interface DivinciExtensionApi {
  readonly protocolVersion: number;
  ping(): Promise<{ extensionVersion: string; supportedModels: string[] }>;
  requestAccess(scopes: ConsentScope[]): Promise<ConsentScope[]>;
  chat(
    req: BridgeChatRequest,
    handlers?: ChatHandlers,
  ): Promise<{ fullText: string; tokensGenerated: number; durationMs: number }>;
  agentCard(): Promise<unknown>;
  task(prompt: string): Promise<unknown>;
}

/** Cloud fallback. Wire your existing @divinci-ai/client here, or any function. */
export type CloudChat = (req: BridgeChatRequest, handlers?: ChatHandlers) => Promise<{ fullText: string }>;

export interface DivinciBridgeOptions {
  /** Cloud fallback used when the extension is absent. Omit to make chat() throw without it. */
  cloudChat?: CloudChat;
  /** Window-like object exposing `.divinci`. Defaults to globalThis. Injectable for tests. */
  win?: { divinci?: DivinciExtensionApi };
  /** Probe timeout for detect() (ms). Default 1500. */
  probeTimeoutMs?: number;
}

export interface DetectResult {
  present: boolean;
  extensionVersion?: string;
  supportedModels?: string[];
}

function getExtension(opts: DivinciBridgeOptions): DivinciExtensionApi | undefined {
  const w = opts.win ?? (globalThis as unknown as { divinci?: DivinciExtensionApi });
  return w?.divinci;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export interface DivinciBridge {
  /** Is the extension installed + responsive? Resolves present:false on absence/timeout. */
  detect(): Promise<DetectResult>;
  /** Run chat: extension first (prompts for consent), else cloud fallback. */
  chat(req: BridgeChatRequest, handlers?: ChatHandlers): Promise<BridgeChatResult>;
  /** Pre-request a consent scope (extension only). Returns granted scopes, or [] if no extension. */
  requestAccess(scopes: ConsentScope[]): Promise<ConsentScope[]>;
  /** Fetch the extension's local A2A Agent Card. Rejects if no extension. */
  agentCard(): Promise<unknown>;
  /** Submit an A2A task to the extension's local agent. Rejects if no extension. */
  task(prompt: string): Promise<unknown>;
  /** Synchronous check that `window.divinci` exists (no round-trip). */
  hasExtension(): boolean;
}

export function createDivinciBridge(opts: DivinciBridgeOptions = {}): DivinciBridge {
  const probeTimeoutMs = opts.probeTimeoutMs ?? 1500;

  return {
    hasExtension() {
      return !!getExtension(opts);
    },

    async detect() {
      const ext = getExtension(opts);
      if (!ext) return { present: false };
      try {
        const info = await withTimeout(ext.ping(), probeTimeoutMs);
        return { present: true, extensionVersion: info.extensionVersion, supportedModels: info.supportedModels };
      } catch {
        return { present: false };
      }
    },

    async chat(req, handlers) {
      const ext = getExtension(opts);
      if (ext) {
        const r = await ext.chat(req, handlers);
        return { fullText: r.fullText, source: "extension" };
      }
      if (opts.cloudChat) {
        const r = await opts.cloudChat(req, handlers);
        return { fullText: r.fullText, source: "cloud" };
      }
      throw new Error(
        "No Divinci extension detected and no cloudChat fallback configured. " +
          "Install the Divinci Local Inference extension or pass { cloudChat } to createDivinciBridge().",
      );
    },

    async requestAccess(scopes) {
      const ext = getExtension(opts);
      if (!ext) return [];
      return ext.requestAccess(scopes);
    },

    async agentCard() {
      const ext = getExtension(opts);
      if (!ext) throw new Error("No Divinci extension detected");
      return ext.agentCard();
    },

    async task(prompt) {
      const ext = getExtension(opts);
      if (!ext) throw new Error("No Divinci extension detected");
      return ext.task(prompt);
    },
  };
}
