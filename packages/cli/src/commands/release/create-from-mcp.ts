import { Command } from "commander";
import { requireConfig, requireWorkspaceId, ensureValidToken } from "../../config/config-manager.js";
import { createClient } from "../../client/create-client.js";
import { output } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";

/**
 * Parse a Streamable-HTTP body into the JSON-RPC payload. Handles both raw JSON
 * and SSE (`event: message\ndata: {…}` — returns the last data frame's JSON).
 * Mirrors server-resources/mcp-servers/client.ts.
 */
function parseMcpBody(contentType: string, text: string): { result?: unknown; error?: { message?: string } } {
  if (!contentType.includes("text/event-stream")) {
    return JSON.parse(text) as { result?: unknown; error?: { message?: string } };
  }
  let lastData = "";
  for (const line of text.split(/\r?\n/)) {
    const m = /^data:\s?(.*)$/.exec(line);
    if (m && m[1].trim()) lastData = m[1];
  }
  if (!lastData) throw new Error("MCP SSE response had no data frame");
  return JSON.parse(lastData) as { result?: unknown; error?: { message?: string } };
}

/**
 * Discover the tool names an MCP server exposes.
 *
 * Primary path: the MCP Streamable-HTTP handshake against the URL itself —
 * initialize → notifications/initialized → tools/list — over JSON-RPC POSTs that
 * carry the `mcp-session-id` header; responses may be JSON or SSE. This is the
 * protocol current hosted MCP servers (incl. Divinci's) actually speak; mirrors
 * the proven client in server-resources/mcp-servers/client.ts.
 *
 * Fallbacks for legacy/non-standard servers: GET /pricing, GET /info.
 */
async function discoverMcpTools(serverUrl: string): Promise<string[]> {
  const baseUrl = serverUrl.replace(/\/+$/, "");

  // --- Primary: MCP Streamable-HTTP handshake -------------------------------
  try {
    let sessionId: string | undefined;
    let nextId = 1;
    const rpc = async (method: string, params: Record<string, unknown>, notification = false): Promise<unknown> => {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        },
        body: JSON.stringify(
          notification
            ? { jsonrpc: "2.0", method, params }
            : { jsonrpc: "2.0", id: nextId++, method, params },
        ),
      });
      const sid = res.headers.get("mcp-session-id");
      if (sid) sessionId = sid;
      if (notification) return undefined; // 202 Accepted, no body
      const text = await res.text();
      if (!res.ok) throw new Error(`MCP ${method} HTTP ${res.status}: ${text.substring(0, 160)}`);
      const parsed = parseMcpBody(res.headers.get("content-type") ?? "", text);
      if (parsed.error) throw new Error(`MCP ${method}: ${parsed.error.message ?? "error"}`);
      return parsed.result;
    };

    await rpc("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "divinci-cli", version: "1" },
    });
    // Some servers require the initialized notification before tools/list.
    try {
      await rpc("notifications/initialized", {}, true);
    } catch {
      /* non-fatal */
    }
    const listed = (await rpc("tools/list", {})) as { tools?: Array<{ name?: unknown }> } | undefined;
    const tools = Array.isArray(listed?.tools)
      ? listed!.tools.map((t) => t?.name).filter((n): n is string => typeof n === "string")
      : [];
    if (tools.length > 0) return tools;
  } catch {
    // Fall through to the legacy endpoints below.
  }

  // --- Fallback: GET /pricing (legacy Divinci MCP pattern) ------------------
  try {
    const pricingResponse = await fetch(`${baseUrl}/pricing`);
    if (pricingResponse.ok) {
      const responseText = await pricingResponse.text();
      let pricingData: unknown;
      try {
        pricingData = JSON.parse(responseText);
      } catch {
        throw new Error(`Failed to parse pricing response as JSON: ${responseText.substring(0, 200)}`);
      }
      if (Array.isArray(pricingData)) {
        const names = pricingData.map((t: { name?: string; toolName?: string }) => t.name || t.toolName).filter(Boolean) as string[];
        if (names.length > 0) return names;
      }
    }
  } catch {
    // Fall through to info endpoint
  }

  // --- Fallback: GET /info --------------------------------------------------
  try {
    const infoResponse = await fetch(`${baseUrl}/info`);
    if (infoResponse.ok) {
      const responseText = await infoResponse.text();
      let infoData: { tools?: Array<{ name?: string }> };
      try {
        infoData = JSON.parse(responseText);
      } catch {
        throw new Error(`Failed to parse info response as JSON: ${responseText.substring(0, 200)}`);
      }
      if (infoData.tools && Array.isArray(infoData.tools)) {
        const names = infoData.tools.map((t) => t.name).filter(Boolean) as string[];
        if (names.length > 0) return names;
      }
    }
  } catch {
    // All attempts failed
  }

  throw new Error(
    `Could not discover tools from MCP server at ${baseUrl}. ` +
    `Tried: MCP Streamable-HTTP (initialize + tools/list), GET /pricing, GET /info.`,
  );
}

export function registerReleaseCreateFromMcpCommand(parent: Command): void {
  parent
    .command("create-from-mcp")
    .description("Create a release pre-configured with tools from an MCP server")
    .requiredOption("--url <url>", "MCP server URL to discover tools from")
    .requiredOption("--name <name>", "Name for the release")
    .option("--description <description>", "Release description")
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        let config = requireConfig(globalOpts);
        config = await ensureValidToken(config);
        const workspaceId = requireWorkspaceId(config);
        const client = createClient(config);

        // Discover tools from the MCP server
        const tools = await withSpinner(
          `Discovering tools from ${opts.url}...`,
          () => discoverMcpTools(opts.url),
        );

        console.error(`Discovered ${tools.length} tools: ${tools.join(", ")}`);

        // Resolve the assistant createReleaseDraft requires — the workspace's
        // defaultAssistant, same as `release create`.
        const ws = await client.workspaces.get(workspaceId);
        const assistantId = (ws as { defaultAssistant?: { id?: string } } | null)?.defaultAssistant?.id;
        if (!assistantId) {
          throw new Error(
            "This workspace has no default assistant, so a release can't be created. " +
            "Set a default assistant on the workspace first, then retry.",
          );
        }

        // Two-step, because (a) createReleaseDraft does NOT persist mcpConfig and
        // (b) the CLI is OAuth so the api-key /api/v1 routes 401:
        //   1. create the draft via the OAuth admin endpoint (same defaults as
        //      `release create`),
        //   2. set mcpConfig via updateInWorkspace (also OAuth). The schema field
        //      is { enabled, exposedTools } — NOT { mcpEnabled, mcpExposedTools }.
        const httpClient = client.getHttpClient();
        const created = await withSpinner("Creating release...", () =>
          httpClient.post<Record<string, unknown>>(
            `/white-label/${workspaceId}/release`,
            {
              slug: "",
              title: opts.name,
              description: opts.description ?? "",
              allowAnonymousChat: false,
              maxAnonymousChatMessages: 1,
              assistant: { id: assistantId, finetune: false },
              promptModeration: {
                noHarmful: { title: "Message considered harmful", on: true },
                onTopic: { title: "Message considered off topic", minimumContext: 0, minimumTokens: 0 },
                custom: [],
              },
              notificationFlaggers: {
                custom: [],
                helpRequests: { enabled: false },
              },
            },
          ),
        );
        const releaseId = String(created?._id ?? created?.id ?? "");
        if (!releaseId) {
          throw new Error("Release was created but no id was returned; cannot apply MCP tool config.");
        }
        console.error(`Release created (${releaseId}). Applying MCP tool config...`);

        // exposedTools must name SERVED Divinci MCP tools — the server rejects
        // unknown names with a fix hint. If this step fails, the draft above
        // already exists (delete it with `divinci release delete ${releaseId}`).
        const data = await withSpinner("Applying MCP tool config...", () =>
          client.releases.updateInWorkspace(workspaceId, releaseId, {
            mcpConfig: { enabled: true, exposedTools: tools },
          } as Parameters<typeof client.releases.updateInWorkspace>[2]),
        );

        output(data, { keyValue: true });
      } catch (error) {
        handleCommandError(error);
      }
    });
}
