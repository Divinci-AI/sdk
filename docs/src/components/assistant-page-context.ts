/**
 * Per-page configuration for the "Ask Divinci" docs assistant — page-aware
 * conversation starters + hidden context, mirroring how the Divinci Agent in
 * the web app front-loads page context and offers different starters per page.
 *
 * `getAssistantPageConfig(pathname)` is called at build time from
 * DocsAssistant.astro; the result is serialized into data attributes and read
 * by the widget's mount() (which renders the starter chips and injects the
 * context block into the first message — see @divinci-ai/embed-chat-ui).
 *
 * Matching is longest-prefix over `pathname` (leading section), so `/cli`
 * covers `/cli/overview/`, `/cli/...`, etc. Add an entry here to make any
 * section page-aware; sections without an entry fall back to the generic
 * (no starters, no extra context) behavior.
 */

export interface AssistantStarter {
  label: string;
  message: string;
}

export interface AssistantPageConfig {
  suggestions: AssistantStarter[];
  /** Hidden context prepended to the user's first message (never displayed). */
  context: string;
}

const SECTION_CONFIG: Record<string, AssistantPageConfig> = {
  "/client": {
    suggestions: [
      {
        label: "Install the client SDK",
        message: "How do I install and initialize the Divinci client SDK?",
      },
      {
        label: "Stream a chat response",
        message: "How do I send a chat message and stream the response with the client SDK?",
      },
      { label: "Use it in React", message: "How do I use the Divinci client SDK in a React app?" },
    ],
    context:
      "The user is reading the Divinci Client SDK documentation (the @divinci-ai/client " +
      "package). The client SDK builds custom chat UIs in React, Vue, or vanilla JavaScript " +
      "with real-time token streaming. It runs in the browser / front-end, chats against a " +
      "Divinci release, and handles chat sessions, streaming responses, and source citations. " +
      "Prefer client-SDK TypeScript/JavaScript code examples and front-end framework workflows.",
  },
  "/server": {
    suggestions: [
      {
        label: "Install the server SDK",
        message: "How do I install and authenticate the Divinci server SDK?",
      },
      {
        label: "Upload a RAG document",
        message: "How do I upload and index a document into a RAG vector with the server SDK?",
      },
      {
        label: "Manage releases",
        message: "How do I create and manage releases from the server SDK?",
      },
    ],
    context:
      "The user is reading the Divinci Server SDK documentation. The server SDK runs on a " +
      "Node.js backend (server-side, using a secret API key) and manages workspaces, releases, " +
      "and RAG documents — uploading and indexing knowledge, configuring assistants, and " +
      "orchestrating releases. Prefer server-side Node.js/TypeScript examples and backend workflows.",
  },
  "/mcp": {
    suggestions: [
      {
        label: "Connect an MCP client",
        message: "How do I connect Claude Desktop or Cursor to the Divinci MCP server?",
      },
      {
        label: "MCP connection URL",
        message: "What is the Divinci MCP connection URL and how do I configure it?",
      },
      { label: "Available MCP tools", message: "What tools does the Divinci MCP server expose?" },
    ],
    context:
      "The user is reading the Divinci MCP (Model Context Protocol) documentation. Divinci " +
      "exposes an MCP server so MCP-compatible AI assistants (Claude Desktop, Cursor, and " +
      "others) can call Divinci tools — searching knowledge bases, managing releases, handling " +
      "payments, and more — over the MCP protocol. Connection examples use the /mcp endpoint. " +
      "Prefer MCP client configuration (mcp.json / connection URL) and tool-usage guidance.",
  },
  "/embed": {
    suggestions: [
      {
        label: "Add the embed script",
        message: "How do I add the Divinci embed chat widget to my site with a script tag?",
      },
      {
        label: "Configure the widget",
        message: "How do I configure the embed chat widget — release, theme, and options?",
      },
      {
        label: "Show products in chat",
        message: "How do I show products in the embedded chat widget?",
      },
    ],
    context:
      "The user is reading the Divinci Embed Script documentation. The embed script drops a " +
      "fully-rendered 'Ask Divinci' chat widget onto any web page with a single <script> tag — " +
      "no bundler or build step required. It is the @divinci-ai/embed-chat-ui widget, configured " +
      "with a release id and mount options (greeting, placeholder, theme tokens, conversation " +
      "starters). Prefer copy-paste <script>-tag, no-build embedding examples.",
  },
  "/cli": {
    suggestions: [
      { label: "Install the CLI", message: "How do I install and set up the Divinci CLI?" },
      { label: "Authenticate", message: "How do I authenticate the Divinci CLI?" },
      {
        label: "Chat from my terminal",
        message: "How do I start an interactive chat session from the CLI?",
      },
    ],
    context:
      "The user is reading the Divinci CLI documentation. The Divinci CLI is the " +
      "official command-line tool for Divinci AI: authenticate once, then manage " +
      "an entire workspace from the terminal or a CI pipeline. It covers: Chat " +
      "(interactive REPL, one-shot messages, streaming responses, full " +
      "conversation history), Knowledge Base (search the RAG index, list indexed " +
      "files, check processing status), Workspaces (list, inspect, and switch " +
      "between workspaces; set a per-project default), and Releases (view and " +
      "manage AI releases, filter by status, inspect configuration). Prefer CLI " +
      "commands, flags, and terminal/CI workflows when answering.",
  },
  "/": {
    // The splash page is where cold traffic lands, so these starters orient
    // rather than instruct: "which piece do I need" before "how do I call it".
    suggestions: [
      {
        label: "Which SDK do I need?",
        message:
          "I'm new to Divinci. What are the different SDKs — client, server, MCP, CLI, embed — " +
          "and which one should I use for my project?",
      },
      {
        label: "Chatbot on my own docs",
        message:
          "How do I build an AI assistant that answers from my own documents and website content?",
      },
      {
        label: "Fastest way to start",
        message: "What is the shortest path from zero to a working Divinci integration?",
      },
    ],
    context:
      "The user is on the Divinci AI SDK documentation home page and is likely orienting for " +
      "the first time. Divinci ships five entry points: the Client SDK (@divinci-ai/client, " +
      "browser/front-end chat UIs with streaming), the Server SDK (Node.js backend, secret API " +
      "key, manages workspaces/releases/RAG), the MCP server (connect Claude Desktop, Cursor, " +
      "and other MCP clients to Divinci tools), the CLI (terminal and CI workflows), and the " +
      "embed script / @divinci-ai/embed-chat-ui widget (drop-in chat widget, no build step). " +
      "Prefer short orienting answers that name the right SDK for the user's stated goal and " +
      "link onward, rather than long code samples.",
  },
  "/getting-started": {
    suggestions: [
      {
        label: "Install the SDKs",
        message: "How do I install the Divinci SDKs, and what are the version requirements?",
      },
      {
        label: "Get an API key",
        message: "How do I get an API key and authenticate with Divinci?",
      },
      {
        label: "Smallest working example",
        message:
          "Walk me through the quickstart — what is the smallest complete Divinci example I can run?",
      },
      {
        label: "Handle errors",
        message: "What errors do the Divinci SDKs throw, and how should I handle them?",
      },
    ],
    context:
      "The user is reading the Divinci getting-started documentation: Introduction, " +
      "Installation, Authentication, Quick Start, and Error Handling. They are most likely " +
      "setting Divinci up for the first time and have not yet made a successful API call. " +
      "Prefer complete, runnable setup steps — install command, where the API key comes from " +
      "and how it is supplied, then a minimal end-to-end example — over conceptual overviews. " +
      "Call out the difference between the browser-safe client SDK and the secret-key server " +
      "SDK, since new users commonly reach for the wrong one.",
  },
  "/guides": {
    suggestions: [
      {
        label: "Deploy to Cloudflare",
        message: "How do I deploy a Divinci integration to Cloudflare Workers?",
      },
      {
        label: "Connect my store",
        message:
          "How do I connect my e-commerce store so the assistant can answer questions about my products?",
      },
      {
        label: "Add voice or phone",
        message: "How do I add voice, phone, or SMS to my Divinci assistant?",
      },
      {
        label: "Which model should I use?",
        message: "Which models does Divinci support, and how do I choose one for my assistant?",
      },
    ],
    context:
      "The user is reading the Divinci guides — end-to-end, task-shaped walkthroughs rather " +
      "than API reference. The guides cover: deploying to Cloudflare Workers, connecting an " +
      "e-commerce store, the model catalog, Chat CTAs, voice/phone/SMS, and the Divinci " +
      "Agent Skill for Claude Code. Prefer complete " +
      "start-to-finish workflows with the prerequisites stated up front, and name which SDK " +
      "or product surface each step belongs to.",
  },
  "/reference": {
    suggestions: [
      {
        label: "Look up a type",
        message: "What shared types does the Divinci SDK export, and where are they imported from?",
      },
      {
        label: "Release object shape",
        message: "What fields does a Divinci release object have?",
      },
      {
        label: "Transcript shape",
        message: "What does a Divinci transcript and its messages look like?",
      },
    ],
    context:
      "The user is reading the Divinci shared type reference. This section documents the " +
      "TypeScript types shared across the client, server, and CLI SDKs — release, transcript, " +
      "message, and related object shapes. The user is most likely looking up an exact field " +
      "name or shape while already writing code. Prefer precise, literal answers: the type " +
      "definition, its fields and their types, and which package exports it. Do not invent " +
      "fields — if a shape is not documented on this site, say so.",
  },
};

/** Normalize a pathname to its leading section, e.g. "/cli/overview/" → "/cli". */
function sectionOf(pathname: string): string {
  const seg = pathname.replace(/^\/+/, "").split("/")[0] || "";
  return seg ? `/${seg}` : "/";
}

export function getAssistantPageConfig(pathname: string): AssistantPageConfig | null {
  return SECTION_CONFIG[sectionOf(pathname)] ?? null;
}
