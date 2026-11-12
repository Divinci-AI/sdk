/**
 * ModelList — interactive model catalog for the sdk.divinci.ai "Models" page.
 *
 * Lists every model Divinci offers across the App, SDK, API, MCP, and CLI.
 * Supports live filtering with a search box AND a `?q=` query parameter, so a
 * deep link like `https://sdk.divinci.ai/guides/models?q=gemini` opens
 * already filtered. The query param is kept in sync (pushState) so the URL is
 * shareable and the browser back button works.
 */
import React, { useEffect, useMemo, useState } from "react";

type ModelProvider =
  | "Cloudflare"
  | "Google"
  | "Meta"
  | "Mistral"
  | "OpenAI"
  | "xAI"
  | "Divinci AI"
  | "Hermes";

interface ModelEntry {
  id: string;
  name: string;
  provider: ModelProvider;
  hosting: "Cloudflare Workers AI" | "Google Vertex AI" | "Divinci-hosted" | "BYO / local";
  category: "text" | "image" | "embedding" | "audio";
  freeTier: boolean;
  notes?: string;
  docs?: string;
}

// Source of truth: the server-side WHITE_LABEL_AI_ASSISTANT registry
// (resources/server-resources/.../collections/whitelabel-base.ts) plus the
// app's UnifiedSearch AVAILABLE_MODELS. This is a curated, documented
// snapshot — the live catalog is dynamic; verify availability in-app.
const MODELS: ModelEntry[] = [
  // ── Google Gemini (Vertex AI) ──────────────────────────────────────
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash-Lite",
    provider: "Google",
    hosting: "Google Vertex AI",
    category: "text",
    freeTier: true,
    notes: "Newest cheap Gemini workhorse (released 2026-07-22). Fast, low-cost, tool-capable.",
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    provider: "Google",
    hosting: "Google Vertex AI",
    category: "text",
    freeTier: true,
    notes: "Newest Gemini Flash release. Frontier reasoning at Flash latency; replaces 3.6/3.7 Flash (being discontinued).",
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash-Lite",
    provider: "Google",
    hosting: "Google Vertex AI",
    category: "text",
    freeTier: true,
    notes: "Stable GA Flash-Lite. Predecessor to 3.5-flash-lite.",
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    provider: "Google",
    hosting: "Google Vertex AI",
    category: "text",
    freeTier: true,
    notes: "Best Gemini reasoning for complex workflows & analysis.",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    hosting: "Google Vertex AI",
    category: "text",
    freeTier: true,
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite",
    provider: "Google",
    hosting: "Google Vertex AI",
    category: "text",
    freeTier: true,
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    hosting: "Google Vertex AI",
    category: "text",
    freeTier: true,
  },
  // ── Cloudflare Workers AI (open weights) ─────────────────────────────
  {
    id: "@cf/meta/llama-4-scout-17b-16e-instruct",
    name: "Llama 4 Scout 17B",
    provider: "Meta",
    hosting: "Cloudflare Workers AI",
    category: "text",
    freeTier: true,
    notes: "Open-weight MoE, tool-capable.",
  },
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    name: "Llama 3.3 70B (open)",
    provider: "Meta",
    hosting: "Cloudflare Workers AI",
    category: "text",
    freeTier: true,
  },
  {
    id: "@cf/openai/gpt-oss-120b",
    name: "GPT-OSS 120B (open)",
    provider: "OpenAI",
    hosting: "Cloudflare Workers AI",
    category: "text",
    freeTier: true,
  },
  {
    id: "@cf/openai/gpt-oss-20b",
    name: "GPT-OSS 20B (open)",
    provider: "OpenAI",
    hosting: "Cloudflare Workers AI",
    category: "text",
    freeTier: true,
  },
  {
    id: "@cf/google/gemma-4-26b-a4b-it",
    name: "Gemma 4 26B",
    provider: "Google",
    hosting: "Cloudflare Workers AI",
    category: "text",
    freeTier: true,
    notes: "Google — built from Gemini 3, 256k ctx, vision.",
  },
  {
    id: "@cf/nvidia/nemotron-3-120b-a12b",
    name: "Nemotron 3 Super 120B",
    provider: "NVIDIA",
    hosting: "Cloudflare Workers AI",
    category: "text",
    freeTier: true,
    notes: "Hybrid MoE — multi-agent / agentic AI.",
  },
  {
    id: "@cf/google/embeddinggemma-300m",
    name: "EmbeddingGemma-300m",
    provider: "Google",
    hosting: "Cloudflare Workers AI",
    category: "embedding",
    freeTier: true,
    notes: "Compact embedding model (768d).",
  },
  // ── Divinci-hosted / fine-tunes / local ─────────────────────────────
  {
    id: "byo:custom",
    name: "Custom / Self-hosted (BYO proxy)",
    provider: "Divinci AI",
    hosting: "BYO / local",
    category: "text",
    freeTier: true,
    notes: "Bring-your-own OpenAI-compatible endpoint (Ollama / vLLM / LM Studio).",
  },
  {
    id: "local:gemma-4-e2b",
    name: "Gemma 4 E2B (Local, Free)",
    provider: "Google",
    hosting: "BYO / local",
    category: "text",
    freeTier: true,
    notes: "Runs locally on your GPU via WebGPU.",
  },
  {
    id: "@cf/moonshotai/kimi-k2.6",
    name: "Kimi K2.6",
    provider: "Moonshot",
    hosting: "Cloudflare Workers AI",
    category: "text",
    freeTier: false,
    notes: "Agentic coding model (per-user key).",
  },
];

function readQuery(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q") ?? "";
}

export default function ModelList() {
  const [query, setQuery] = useState<string>(() => readQuery());

  // Keep the URL ?q= in sync so the filtered view is shareable / back-button safe.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const trimmed = query.trim();
    if (trimmed) params.set("q", trimmed);
    else params.delete("q");
    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    window.history.replaceState(null, "", next);
  }, [query]);

  // Seed the box from the URL on first mount (handles back/forward nav).
  useEffect(() => {
    const onPop = () => setQuery(readQuery());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return MODELS;
    return MODELS.filter((m) =>
      [m.id, m.name, m.provider, m.hosting, m.category, m.notes ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [q]);

  return (
    <div className="model-list-island">
      <input
        type="search"
        className="model-list-search"
        placeholder="Search models by name, provider, or id…  (e.g. gemini, llama, vertex)"
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        aria-label="Search models"
      />

      <div className="model-list-meta">
        Showing <strong>{filtered.length}</strong> of {MODELS.length} models
        {q ? (
          <>
            {" "}matching <code>{query.trim()}</code>
          </>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="model-list-empty">No models match “{query.trim()}”.</p>
      ) : (
        <table className="model-list-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Provider</th>
              <th>Hosting</th>
              <th>Type</th>
              <th>Free tier</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id}>
                <td>
                  <code>{m.id}</code>
                  <div className="model-list-name">{m.name}</div>
                  {m.notes ? <div className="model-list-notes">{m.notes}</div> : null}
                </td>
                <td>{m.provider}</td>
                <td>{m.hosting}</td>
                <td>{m.category}</td>
                <td>{m.freeTier ? "✓" : "BYOK"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="model-list-foot">
        Filter via URL too: append <code>?q=gemini</code> to this page’s address.
        The live catalog is dynamic — verify a model is available in your plan inside the
        Divinci App, SDK, API, MCP server, or CLI.
      </p>
    </div>
  );
}
