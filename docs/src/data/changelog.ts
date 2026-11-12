/**
 * Changelog entries, newest first.
 *
 * DATA, not markup. The page renders whatever is here, so the eventual
 * generator (`scripts/hermes/changelog-miner.py`) can append an object rather
 * than edit a layout — and a human can read the diff of a release announcement
 * without reading HTML.
 *
 * ═══ THE ID IS A PUBLIC URL AND MUST NEVER CHANGE ═══
 *
 * Each entry's `id` becomes the anchor: `/changelog/#2026-08-12-wake-every-n-hours`.
 * Once an entry ships, that fragment may have been linked from a post, a Slack
 * message, or a support reply. Editing an id silently breaks every one of those
 * links — the page still loads, it just lands at the top, which is the kind of
 * failure nobody reports. Fix the wording freely; leave the id alone.
 *
 * Ids are `YYYY-MM-DD-kebab-slug` so they sort, and so a duplicate is obvious.
 *
 * ⚠️ `docs` is a link people will click. Only add one that has actually been
 * fetched — `scripts/hermes/changelog-docs.py --link` does that, and refuses to
 * guess. A changelog is the one place a 404 is most expensive: it is read by
 * people deciding whether to trust the thing it describes.
 */

export interface ChangelogEntry {
  /** Stable anchor. `YYYY-MM-DD-kebab-slug`. Never edit after publishing. */
  id: string;
  /** ISO date the change reached production. */
  date: string;
  title: string;
  /** One or two short paragraphs. What a customer can now do. */
  body: string;
  /** Verified docs URL, if the feature is documented. */
  docs?: string;
  /** Grouping chip. Keep the vocabulary small or it stops meaning anything. */
  category:
    | "Agents"
    | "Knowledge"
    | "Privacy & Compliance"
    | "Voice"
    | "Platform"
    | "Fixes";
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-10-17-charge-callers-with-x402-testnet",
    date: "2026-10-17",
    title: "Charge callers per request with x402 (testnet)",
    body: "Publish a release, set your own wallet and price under Embed → Payments, and give agents a key that pays you in USDC per chat request. A key that cannot charge is refused at creation instead of serving free, and a payment-rail key can call only the paid chat route. Available on Base Sepolia (a test network) today; Base mainnet is not supported yet.",
    docs: "https://sdk.divinci.ai/server/x402-selling/",
    category: "Platform",
  },
  {
    id: "2026-08-28-list-transcripts-over-the-api",
    date: "2026-08-28",
    title: "Listing transcripts over the API works",
    body: "GET /api/v1/transcripts returned 404 for every API key, for as long as it had been published — the handler looked for a workspace id in the URL path, and on that endpoint the workspace comes from the key instead. It now returns the page of transcripts its documentation always described. The four neighbouring transcript endpoints were unaffected.",
    docs: "https://sdk.divinci.ai/openapi-v1.json",
    category: "Fixes",
  },
  {
    id: "2026-08-28-connect-n8n-and-make",
    date: "2026-08-28",
    title: "Connect Divinci to n8n and Make",
    body: "An AI agent in an n8n or Make workflow can now call Divinci directly — chat, knowledge-base search, file ingestion, releases and connectors — by pointing that platform's MCP client at mcp.divinci.app with a workspace API key. No custom code and no HTTP nodes to wire by hand: roughly 200 tools arrive as tools the agent can pick from. Choose the Streamable HTTP transport, not SSE, and mint the key with no permission boxes checked.",
    docs: "https://sdk.divinci.ai/mcp/n8n-and-make/",
    category: "Platform",
  },
  {
    id: "2026-08-28-openapi-spec-typed-and-published",
    date: "2026-08-28",
    title: "The OpenAPI spec is accurate, typed, and published",
    body: "The published API description now covers 225 operations instead of 203, points at the production host that actually answers, and carries real response schemas for the fifteen endpoints an automation platform reaches for — so importing it into a client generator produces typed results rather than opaque ones. Four endpoints were also documented with the wrong success status; a workflow checking for 200 will no longer read a successful upload or sync as a failure.",
    docs: "https://sdk.divinci.ai/openapi-v1.json",
    category: "Platform",
  },
  {
    id: "2026-08-16-red-team-a-deployed-release",
    date: "2026-08-16",
    title: "Red-team a deployed release from the SDK, CLI, and MCP",
    body: "The same 32-probe corpus that ranks models on the TrustBench leaderboard can now be run against your own deployed release — prompt, moderation, RAG, and tools included. One attack class per request so a full sweep cannot time out after charging for the work. Check measured before citing a 0.0; that number is a perfect score on an empty run.",
    docs: "https://sdk.divinci.ai/server/red-team/",
    category: "Platform",
  },
  {
    id: "2026-08-11-pinecone-as-a-vector-store-with-read-your-writes",
    date: "2026-08-11",
    title: "Pinecone as a vector store, with read-your-writes",
    body: "Pinecone serverless can now be selected as the vector store for a knowledge base, alongside Qdrant, and it is configurable from the web app rather than only through the API. It accepts every embedding model the platform supports. Content you have just added is visible to the very next search, so a file you upload can be asked about immediately — the SDK waits for the write to be readable rather than leaving you to guess.",
    // The auto-resolver first offered /client/rag/, which mentioned Pinecone
    // nowhere; the coverage check dropped it, and the docs were written instead
    // of the link being fudged. This one is verified: the page names it.
    docs: "https://sdk.divinci.ai/server/rag/",
    category: "Knowledge",
  },
  {
    id: "2026-08-12-wake-every-n-hours",
    date: "2026-08-12",
    title: "Hosted agents can wake every N hours, not just once a day",
    body: "A hosted Hermes agent's proactive loop can now run on an interval — every 3 hours, every 6, up to 24 — instead of a single daily slot. The scheduled time becomes the anchor for the first wake, and each wake is measured from the last one, so a missed window produces one wake rather than a backlog. Every wake is a billed turn, so the cost scales with the cadence you choose.",
    docs: "https://sdk.divinci.ai/cli/hermes/",
    category: "Agents",
  },
  {
    id: "2026-08-11-visitor-analytics-opt-out",
    date: "2026-08-11",
    title: "Visitors can opt out of chat analytics",
    body: "Anyone using a chat can decline to have their questions counted in the operator's \"what people are asking\" insights. The choice is honoured server-side and applies retroactively — questions already asked are removed from those insights the moment someone opts out. Browsers sending Global Privacy Control are opted out automatically, with no click required.",
    category: "Privacy & Compliance",
  },
  {
    id: "2026-08-11-hipaa-scoped-workspaces",
    date: "2026-08-11",
    title: "Workspaces can be marked HIPAA-scoped",
    body: "Marking a workspace HIPAA-scoped turns on privacy protections that cannot then be switched off: personal details are stripped from every conversation, and a turn is refused unless the model provider is covered by a business associate agreement. Every access to protected health information is logged.",
    category: "Privacy & Compliance",
  },
  {
    id: "2026-08-11-bulk-upload-rate-limit",
    date: "2026-08-11",
    title: "Bulk file uploads are rate limited",
    body: "The daily upload cap — 50 files on free, 100 on premium — now applies to bulk uploads as well as single ones. Previously the bulk route carried no limit at all.",
    category: "Fixes",
  },
  {
    id: "2026-08-11-voice-photo-answers",
    date: "2026-08-11",
    title: "Voice callers who send a photo get an answer",
    body: "If a caller sent a photo after speaking their question, the assistant used to reply by asking what they wanted to know. It now answers using the image and the question already asked.",
    category: "Voice",
  },
  {
    id: "2026-08-11-dark-theme-chat-errors",
    date: "2026-08-11",
    title: "Chat error messages are readable on dark themes",
    body: "Error toasts and the insufficient-funds notice rendered dark-on-dark on the dark and high-contrast themes, making them impossible to read. They are now legible on every theme.",
    category: "Fixes",
  },
  {
    id: "2026-08-07-versioned-terms-of-service",
    date: "2026-08-07",
    title: "Versioned Terms of Service per release",
    body: "Whitelabel admins can write a Terms of Service in markdown and attach it to a release. Publishing bumps the version, and every user must accept the latest version before using any release that references it. Acceptance is recorded per person per version, and the terms are enforced everywhere a message can be sent — anonymous chat, signed-in chat, the API, and the CLI. Drafts never trigger re-acceptance; only publishing does. The feature is opt-in, so existing releases stay untouched until an admin attaches a document.",
    docs: "https://sdk.divinci.ai/server/messaging/",
    category: "Platform",
  },
  {
    id: "2026-08-07-nav-junk-filtered",
    date: "2026-08-07",
    title: "Website navigation junk no longer pollutes your knowledge base",
    body: "When you import website content, navigation junk like \"Skip to Content\" and \"Open Menu Close Menu\" links, and blocked-image placeholders, used to be stored as knowledge and could surface in answers. That junk is now filtered out by default on every import path — the web app, the API, and connectors alike. You can still switch the filter off per import if you want the raw text.",
    docs: "https://sdk.divinci.ai/server/knowledge/",
    category: "Knowledge",
  },
  {
    id: "2026-08-07-byok-speech-to-text",
    date: "2026-08-07",
    title: "Choose your speech-to-text provider, and bring your own key",
    body: "Speech-to-text is now provider-configurable instead of fixed. Deepgram Nova-3 is available as a provider, and you can bring your own key for it. Choose a provider for your whole workspace, or override it for a single release — so one workspace can run different releases on different providers.",
    docs: "https://sdk.divinci.ai/server/channels-access/",
    category: "Voice",
  },
  {
    id: "2026-08-07-publish-site-to-your-own-cloud",
    date: "2026-08-07",
    title: "Publish a converted site to your own GitHub and Cloudflare",
    body: "A converted site can be published to your own GitHub account and your own Cloudflare account. Divinci never holds a Cloudflare credential for it: Cloudflare's own Deploy button creates the repository under your account, and Divinci pushes the site into it. Every later push redeploys automatically, including edits made by an agent. All site assets are committed into your repository, so the published site does not depend on Divinci's storage to keep working.",
    category: "Platform",
  },
  {
    id: "2026-08-07-agent-guidance-cursor",
    date: "2026-08-07",
    title: "The Divinci agent can point at what it is describing",
    body: "The agent joins your workspace session as a visible participant with its own cursor, so it can point at the exact control it is talking about instead of only describing it. Everyone on the page sees the same guidance, not just the person who asked. A setup journey alongside it shows what your workspace still needs: connect a website, upload files, connect other sources, and deploy.",
    category: "Agents",
  },
];
