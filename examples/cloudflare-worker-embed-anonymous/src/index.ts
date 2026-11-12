/**
 * Cloudflare Worker serving embed client staging test page
 * Protected by Cloudflare Access with JWT validation
 *
 * Features a tabbed interface to explore different embed script attribute options
 */

import { jwtVerify, createRemoteJWKSet, JWTPayload } from "jose";

export interface Env {
  // Cloudflare Access configuration
  TEAM_DOMAIN: string;
  POLICY_AUD: string;

  // Embed configuration
  EMBED_SCRIPT_URL: string;
  RELEASE_ID: string;
  ENVIRONMENT: string;

  // Feature flags
  REQUIRE_ACCESS_AUTH: string;
}

interface AccessJWTPayload extends JWTPayload {
  email?: string;
}

/**
 * Validate Cloudflare Access JWT token
 */
async function validateAccessJWT(
  request: Request,
  env: Env
): Promise<{ valid: boolean; payload?: AccessJWTPayload; error?: string }> {
  if (env.REQUIRE_ACCESS_AUTH !== "true") {
    return { valid: true };
  }

  if (!env.TEAM_DOMAIN || !env.POLICY_AUD) {
    return { valid: false, error: "Server configuration error" };
  }

  const token =
    request.headers.get("cf-access-jwt-assertion") ||
    getCookieValue(request.headers.get("cookie"), "CF_Authorization");

  if (!token) {
    return { valid: false, error: "Missing Cloudflare Access token" };
  }

  try {
    const JWKS = createRemoteJWKSet(
      new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`)
    );
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
    });
    return { valid: true, payload: payload as AccessJWTPayload };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { valid: false, error: `Invalid token: ${message}` };
  }
}

function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

/**
 * Configuration presets for different embed scenarios
 */
const CONFIG_PRESETS = [
  {
    id: "default",
    name: "Default",
    description: "Basic anonymous chat with no extra features",
    options: {
      externalUser: false,
      toggleable: false,
      debug: true,
    },
  },
  {
    id: "context-bubbles",
    name: "Context Bubbles",
    description: "Shows RAG document sources as clickable bubbles",
    options: {
      externalUser: false,
      toggleable: false,
      debug: true,
      contextBubbles: true,
    },
  },
  {
    id: "product-recommendations",
    name: "Product Recommendations",
    description: "Displays product cards in AI responses",
    options: {
      externalUser: false,
      toggleable: false,
      debug: true,
      productRecommendations: true,
    },
  },
  {
    id: "metrics",
    name: "Metrics",
    description: "Enables usage metrics tracking",
    options: {
      externalUser: false,
      toggleable: false,
      debug: true,
      metrics: true,
    },
  },
  {
    id: "help-requests",
    name: "Help Requests",
    description: "Allows users to request human assistance",
    options: {
      externalUser: false,
      toggleable: false,
      debug: true,
      helpRequests: true,
    },
  },
  {
    id: "notifications",
    name: "Notifications",
    description: "Enables notification features",
    options: {
      externalUser: false,
      toggleable: false,
      debug: true,
      notifications: true,
    },
  },
  {
    id: "quick-menu",
    name: "Quick Menu",
    description: "Shows hover actions on messages (copy, emoji, read aloud)",
    options: {
      externalUser: false,
      toggleable: false,
      debug: true,
      quickMenu: true,
    },
  },
  {
    id: "message-feedback",
    name: "Message Feedback",
    description: "Thumbs up/down + feedback dropdown on assistant replies",
    options: {
      externalUser: false,
      toggleable: false,
      debug: true,
      messageFeedback: true,
    },
  },
  {
    id: "share-chat",
    name: "Share Chat",
    description: "Share-this-chat affordance on the conversation",
    options: {
      externalUser: false,
      toggleable: false,
      debug: true,
      shareChat: true,
    },
  },
  {
    id: "toggleable",
    name: "Toggleable Widget",
    description: "Chat appears as a floating button that expands on click",
    options: {
      externalUser: false,
      toggleable: true,
      debug: true,
    },
  },
  {
    id: "all-features",
    name: "All Features",
    description: "Every feature enabled at once",
    options: {
      externalUser: false,
      toggleable: false,
      debug: true,
      contextBubbles: true,
      productRecommendations: true,
      metrics: true,
      helpRequests: true,
      notifications: true,
      messageFeedback: true,
      quickMenu: true,
      shareChat: true,
    },
  },
];

/**
 * Generate the staging test page HTML with tabbed interface
 */
function generateHTML(env: Env, userEmail?: string): string {
  const presetsJSON = JSON.stringify(CONFIG_PRESETS);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Embed Staging Test - ${env.ENVIRONMENT}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: #1e1b4b;
      color: white;
      padding: 0.75rem 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.875rem;
    }
    header .env {
      background: rgba(255,255,255,0.2);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-family: monospace;
    }
    header .user { opacity: 0.8; }

    /* Tab navigation */
    .tabs-container {
      background: white;
      border-bottom: 1px solid #e5e7eb;
      padding: 0 1rem;
      overflow-x: auto;
      white-space: nowrap;
    }
    .tabs {
      display: flex;
      gap: 0;
    }
    .tab {
      padding: 0.75rem 1rem;
      border: none;
      background: none;
      cursor: pointer;
      font-size: 0.875rem;
      color: #6b7280;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .tab:hover {
      color: #1e1b4b;
      background: #f9fafb;
    }
    .tab.active {
      color: #1e1b4b;
      border-bottom-color: #6366f1;
      font-weight: 500;
    }

    /* Config info panel */
    .config-panel {
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      padding: 0.75rem 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }
    .config-info {
      flex: 1;
    }
    .config-info h3 {
      font-size: 0.875rem;
      font-weight: 600;
      color: #1e1b4b;
      margin-bottom: 0.25rem;
    }
    .config-info p {
      font-size: 0.75rem;
      color: #6b7280;
    }
    .config-code {
      background: #1e1b4b;
      color: #a5b4fc;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.7rem;
      max-width: 400px;
      overflow-x: auto;
      white-space: pre;
    }

    /* Chat container */
    #divinci-chat-container {
      flex: 1;
      display: flex;
      padding: 1rem;
      position: relative;
    }
    #divinci-chat-container iframe {
      flex: 1;
      border: none;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      background: white;
    }

    /* Loading overlay */
    .loading-overlay {
      position: absolute;
      inset: 1rem;
      background: rgba(255,255,255,0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      z-index: 10;
    }
    .loading-overlay.hidden {
      display: none;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #e5e7eb;
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Toggleable mode indicator */
    .toggleable-hint {
      position: absolute;
      bottom: 2rem;
      right: 2rem;
      background: #fef3c7;
      color: #92400e;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-size: 0.75rem;
      display: none;
    }
    .toggleable-hint.visible {
      display: block;
    }
  </style>
</head>
<body>
  <header>
    <span>Embed Staging Test (Anonymous)</span>
    <span class="env">${env.ENVIRONMENT} | ${env.RELEASE_ID}</span>
    ${userEmail ? `<span class="user">${userEmail}</span>` : ""}
  </header>

  <div class="tabs-container">
    <div class="tabs" id="tabs"></div>
  </div>

  <div class="config-panel">
    <div class="config-info">
      <h3 id="config-title">Default</h3>
      <p id="config-description">Basic anonymous chat with no extra features</p>
    </div>
    <pre class="config-code" id="config-code"></pre>
  </div>

  <div id="divinci-chat-container">
    <div class="loading-overlay" id="loading">
      <div class="spinner"></div>
    </div>
    <div class="toggleable-hint" id="toggleable-hint">
      Look for the chat button in the bottom-right corner
    </div>
  </div>

  <script defer src="${env.EMBED_SCRIPT_URL}"></script>
  <script>
    const CONFIG_PRESETS = ${presetsJSON};
    const RELEASE_ID = "${env.RELEASE_ID}";

    let currentChat = null;
    let currentPresetId = null;

    function initTabs() {
      const tabsContainer = document.getElementById('tabs');
      CONFIG_PRESETS.forEach((preset, index) => {
        const tab = document.createElement('button');
        tab.className = 'tab';
        tab.textContent = preset.name;
        tab.dataset.presetId = preset.id;
        tab.onclick = () => switchPreset(preset.id, true);
        tabsContainer.appendChild(tab);
      });
    }

    function updateConfigDisplay(preset) {
      document.getElementById('config-title').textContent = preset.name;
      document.getElementById('config-description').textContent = preset.description;

      const codeDisplay = { releaseId: RELEASE_ID, ...preset.options };
      document.getElementById('config-code').textContent = JSON.stringify(codeDisplay, null, 2);
    }

    function getPresetFromHash() {
      const hash = window.location.hash.slice(1); // Remove '#'
      const preset = CONFIG_PRESETS.find(p => p.id === hash);
      return preset || CONFIG_PRESETS[0];
    }

    function switchPreset(presetId, updateHash = false) {
      if (presetId === currentPresetId) return;

      const preset = CONFIG_PRESETS.find(p => p.id === presetId);
      if (!preset) return;

      currentPresetId = presetId;

      // Update URL hash without triggering hashchange
      if (updateHash) {
        history.pushState(null, '', '#' + presetId);
      }

      // Update tab active state
      document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.presetId === presetId);
      });

      // Update config display
      updateConfigDisplay(preset);

      // Show loading
      document.getElementById('loading').classList.remove('hidden');

      // Properly destroy existing chat (including toggleable widget)
      if (currentChat) {
        try {
          currentChat.destroy();
        } catch (e) {
          console.warn('Error destroying chat:', e);
        }
        currentChat = null;
      }

      // Create new chat with preset options
      setTimeout(() => {
        createChat(preset);
      }, 100);
    }

    // Handle browser back/forward
    window.addEventListener('hashchange', () => {
      const preset = getPresetFromHash();
      switchPreset(preset.id, false);
    });

    function createChat(preset) {
      const { DivinciChat } = window.DIVINCI_AI;
      const container = document.getElementById('divinci-chat-container');
      const toggleableHint = document.getElementById('toggleable-hint');

      const options = {
        releaseId: RELEASE_ID,
        ...preset.options,
      };

      currentChat = new DivinciChat(options);

      if (preset.options.toggleable) {
        // In toggleable mode, the widget handles its own rendering
        toggleableHint.classList.add('visible');
        document.getElementById('loading').classList.add('hidden');
      } else {
        toggleableHint.classList.remove('visible');
        const chatIframe = currentChat.iframe;
        container.appendChild(chatIframe);

        chatIframe.onload = () => {
          document.getElementById('loading').classList.add('hidden');
        };

        // Fallback hide loading after timeout
        setTimeout(() => {
          document.getElementById('loading').classList.add('hidden');
        }, 3000);
      }
    }

    window.addEventListener('DOMContentLoaded', function() {
      initTabs();

      // Load preset from URL hash or default to first preset
      const initialPreset = getPresetFromHash();
      switchPreset(initialPreset.id, false);
    });
  </script>
</body>
</html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    const authResult = await validateAccessJWT(request, env);

    if (!authResult.valid) {
      return new Response(`Access Denied: ${authResult.error}`, {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      });
    }

    if (url.pathname === "/" || !url.pathname.includes(".")) {
      return new Response(generateHTML(env, authResult.payload?.email), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
