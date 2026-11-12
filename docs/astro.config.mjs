import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";

// Dogfood: the SDK Docs Assistant — a Divinci RAG release answered through the
// @divinci-ai/client SDK, in a Starlight-native chat panel (see
// src/components/DocsAssistant.astro, mounted via the Footer override). The
// docs site is built WITH the SDK it documents. Configured at BUILD time:
//   PUBLIC_DIVINCI_API_URL     — api host (https://api.divinci.app | .stage.)
//   PUBLIC_DIVINCI_RELEASE_ID  — the SDK Docs Assistant release id
//   PUBLIC_SITE_URL            — canonical origin for the sitemap (must match
//                                the deploy target; a hardcoded prod URL made
//                                staging sitemaps list sdk.divinci.ai pages,
//                                so connector runSitemap against staging was
//                                useless — 2026-08-07 handoff §3.5)
// Unset → the widget no-ops (safe default for local/previews).

/** Canonical site origin. Prefer an explicit PUBLIC_SITE_URL; else infer from
 * the API host so staging deploys don't emit a production sitemap. */
function resolveSiteUrl() {
  if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL;
  const api = process.env.PUBLIC_DIVINCI_API_URL ?? "";
  if (api.includes("stage") || api.includes("staging")) {
    return "https://divinci-sdk-docs-staging.divinci-ai.workers.dev";
  }
  return "https://sdk.divinci.ai";
}

export default defineConfig({
  // Explicit, not the default: on Astro 6.4 + Starlight 0.38 the default did NOT
  // reach the MDX pipeline, so every markdown table on the site (170 of them,
  // e.g. the flag table on /server/trustbench/) rendered as raw "| a | b |" text
  // until 2026-09-25. MDX adds remark-gfm only when this resolves true.
  // Guard: src/markdown-gfm.test.ts.
  markdown: { gfm: true },
  site: resolveSiteUrl(),
  // Bare section paths and published npm `homepage` URLs (e.g. the
  // @divinci-ai/client and @divinci-ai/types package pages point at /client and
  // /reference/types) redirect to their landing page so external links resolve.
  redirects: {
    "/client": "/client/overview",
    "/server": "/server/overview",
    "/mcp": "/mcp/overview",
    "/embed": "/embed/overview",
    "/cli": "/cli/overview",
    "/getting-started": "/getting-started/introduction",
    "/reference": "/reference/types",
    "/vendors/overview": "/vendors",
  },
  integrations: [
    react(),
    starlight({
      title: "Divinci AI SDK",
      description: "Official SDKs for integrating Divinci AI into your applications",
      logo: {
        src: "./src/assets/logo.png",
        replacesTitle: false,
      },
      favicon: "/favicon.png",
      components: {
        // Adds the "Copy page ▾" dropdown (copy-as-Markdown + connect via
        // MCP/CLI) to the upper right of every docs page.
        PageTitle: "./src/components/PageTitle.astro",
        // Renders the default footer + the SDK Docs Assistant chat widget
        // (src/components/DocsAssistant.astro) on every page.
        Footer: "./src/components/Footer.astro",
        // Logo + wordmark over a faint blueprint / technical-drawing backdrop.
        SiteTitle: "./src/components/SiteTitle.astro",
        // Default Pagefind search + a "Popular searches" panel in the empty
        // modal state.
        Search: "./src/components/Search.astro",
        // 3D RobotHero on the splash landing page (replaces the default
        // Starlight hero image area with the WebGL robot mascot).
        Hero: "./src/components/Hero.astro",
        // Per-page og:image pointing at /og/pages/<slug>.png (3D robot + title).
        Head: "./src/components/Head.astro",
      },
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/Divinci-AI/sdk" },
        { icon: "discord", label: "Discord", href: "https://discord.com/channels/1425017107871039572/1425017109074808934" },
      ],
      editLink: {
        baseUrl: "https://github.com/Divinci-AI/sdk/edit/main/docs/",
      },
      sidebar: [
        // Top of the sidebar deliberately: a changelog nobody can find is a
        // changelog nobody reads, and it is the page most likely to be linked
        // from outside the docs.
        { label: "📰 Changelog", slug: "changelog" },
        {
          label: "🚀 Getting Started",
          items: [
            { label: "Introduction", slug: "getting-started/introduction" },
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Quick Start", slug: "getting-started/quickstart" },
            { label: "Authentication", slug: "getting-started/authentication" },
            { label: "Error Handling", slug: "getting-started/error-handling" },
          ],
        },
        {
          label: "📓 Guides",
          items: [
            { label: "Deploy to Cloudflare Workers", slug: "guides/cloudflare-workers" },
            { label: "Connect an E-commerce Store", slug: "guides/ecommerce-integrations" },
            { label: "Voice, Phone & SMS", slug: "guides/voice-phone" },
            { label: "Chat CTAs", slug: "guides/chat-cta" },
            { label: "Agent Skill for Claude Code", slug: "guides/agent-skill" },
            { label: "Bring Your Own Parser or Retriever", slug: "guides/external-tools" },
            { label: "Divinci Docs", slug: "guides/divinci-docs" },
            { label: "The Demo Pipeline (open source)", slug: "guides/demo-pipeline" },
            { label: "Model Catalog", slug: "guides/models" },
            { label: "When your host blocks the embed script", slug: "guides/embed-blocked-host" },
          ],
        },
        {
          label: "🎨 Client SDK",
          items: [
            { label: "Overview", slug: "client/overview" },
            { label: "Chat", slug: "client/chat" },
            { label: "Streaming", slug: "client/streaming" },
            { label: "Realtime & WebSocket", slug: "client/realtime" },
            { label: "RAG & Vectors", slug: "client/rag" },
            { label: "Namespaces", slug: "client/namespaces" },
            { label: "Notifications, Analytics & Metrics", slug: "client/observability" },
          ],
        },
        {
          label: "🖼️ Embed Client",
          items: [
            { label: "Overview", slug: "embed/overview" },
            { label: "On-Device Inference", slug: "embed/on-device" },
            { label: "📔 Reference", slug: "embed/reference" },
            { label: "Example Workers", slug: "embed/examples" },
          ],
        },
        {
          label: "🌐 Server SDK",
          items: [
            { label: "Overview", slug: "server/overview" },
            { label: "Workspaces", slug: "server/workspaces" },
            { label: "Releases", slug: "server/releases" },
            { label: "Model & Routing", slug: "server/model-and-routing" },
            { label: "Knowledge (RAG) Settings", slug: "server/knowledge" },
            { label: "Messaging & Presentation", slug: "server/messaging" },
            { label: "Channels & Access", slug: "server/channels-access" },
            { label: "Hosted Hermes Agents", slug: "server/hermes-agents" },
            { label: "RAG Knowledge Base", slug: "server/rag" },
            { label: "API Keys", slug: "server/api-keys" },
            { label: "Provider Keys (BYOK) & Skills", slug: "server/byok-and-skills" },
            { label: "Transcripts", slug: "server/transcripts" },
            { label: "Arena", slug: "server/arena" },
            { label: "Fine-tuning & Training Data", slug: "server/fine-tuning" },
            { label: "QA Suites", slug: "server/qa" },
            { label: "QA an External AI System", slug: "server/external-qa" },
            { label: "Red Teaming", slug: "server/red-team" },
            { label: "TrustBench (Attested Evals)", slug: "server/trustbench" },
            { label: "TrustBench Leaderboards", slug: "server/trustbench-leaderboards" },
            { label: "Notifications, Analytics & Metrics", slug: "server/observability" },
            { label: "x402 Payments", slug: "server/x402" },
            { label: "Charging with x402", slug: "server/x402-selling" },
            { label: "Spend Guard", slug: "server/spend-guard" },
            { label: "Caching & Performance", slug: "server/caching" },
            { label: "Security & Abuse Protection", slug: "server/security" },
            { label: "Safety: Moderation & Flaggers", slug: "server/safety" },
            { label: "De-Identification (PII)", slug: "server/de-identification" },
            { label: "Assistant Tools", slug: "server/tools" },
          ],
        },
        {
          label: "📞 Divinci MCP",
          items: [
            { label: "Connect Your Assistant", slug: "mcp/connect-assistant" },
            { label: "n8n & Make", slug: "mcp/n8n-and-make" },
            { label: "Tool Catalog", slug: "mcp/tool-catalog" },
            { label: "Release as an MCP Server", slug: "mcp/whitelabel-servers" },
          ],
        },
        {
          label: "🧩 MCP SDK",
          items: [
            { label: "Overview", slug: "mcp/overview" },
            { label: "Connecting", slug: "mcp/connecting" },
            { label: "Tools", slug: "mcp/tools" },
            { label: "Resources & Prompts", slug: "mcp/resources" },
            { label: "Authentication", slug: "mcp/authentication" },
            { label: "x402 Payments", slug: "mcp/payments" },
          ],
        },
        {
          label: "⌨️ Divinci CLI",
          items: [
            { label: "Overview", slug: "cli/overview" },
            { label: "Hermes Agents", slug: "cli/hermes" },
            { label: "Phone Usage", slug: "cli/phone" },
            {
              // Sub-dropdown: one page per connector provider. The group's own
              // landing page keeps the original /cli/connectors/ URL.
              label: "Connectors",
              collapsed: true,
              items: [
                { label: "Overview", slug: "cli/connectors" },
                { label: "Web Crawl", slug: "cli/connectors/web-crawl" },
                { label: "WordPress", slug: "cli/connectors/wordpress" },
                { label: "Google Drive", slug: "cli/connectors/google-drive" },
                { label: "Gmail", slug: "cli/connectors/gmail" },
                { label: "Google Calendar", slug: "cli/connectors/google-calendar" },
                { label: "Dropbox", slug: "cli/connectors/dropbox" },
                { label: "Notion", slug: "cli/connectors/notion" },
                { label: "Zoom", slug: "cli/connectors/zoom" },
                { label: "AWS S3", slug: "cli/connectors/aws-s3" },
                { label: "Cloudflare R2", slug: "cli/connectors/cloudflare-r2" },
                { label: "Google Cloud Storage", slug: "cli/connectors/google-cloud-storage" },
                { label: "Local Files", slug: "cli/connectors/local-files" },
                { label: "Recall.ai", slug: "cli/connectors/recall-ai" },
                { label: "Practice Better", slug: "cli/connectors/practice-better" },
                { label: "Managing connections", slug: "cli/connectors/managing" },
              ],
            },
          ],
        },
        {
          // Vendor catalog: one page per capability, tables generated from the
          // platform's own tool registry (scripts/sdk-docs/build-tool-catalog.mts)
          // and joined with the weekly production usage snapshot.
          label: "🧰 Vendor Catalog",
          items: [
            { label: "Overview", slug: "vendors" },
            { label: "RAG & Vector Stores", slug: "vendors/rag" },
            { label: "Embeddings", slug: "vendors/embeddings" },
            { label: "Parsing & Chunking", slug: "vendors/parsing" },
            { label: "Search & Scraping", slug: "vendors/search-scraping" },
            { label: "Voice & Audio", slug: "vendors/voice" },
            { label: "Fine-tuning", slug: "vendors/fine-tuning" },
            { label: "De-identification", slug: "vendors/de-identification" },
            { label: "Red-teaming & Evals", slug: "vendors/red-teaming" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Shared Types", slug: "reference/types" },
            { label: "Extension Bridge", slug: "reference/extension-bridge" },
          ],
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
