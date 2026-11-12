/**
 * Auth0 ROPC (Resource Owner Password Credentials) token acquisition —
 * the same flow the Playwright E2E suite uses (see
 * workspace/clients/tests/src/auth/api-auth.setup.ts).
 *
 * SECURITY: never log token or password values.
 */
import { integrationConfig } from "./env.js";

let cachedToken: string | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  const { auth0Domain, auth0ClientId, auth0Audience, testUserEmail, testUserPassword } =
    integrationConfig;

  if (!auth0Domain || !auth0ClientId || !testUserEmail || !testUserPassword) {
    throw new Error("Integration credentials are not configured");
  }

  const body = new URLSearchParams({
    grant_type: "password",
    username: testUserEmail,
    password: testUserPassword,
    client_id: auth0ClientId,
    scope: "openid profile email",
  });
  if (auth0Audience) body.set("audience", auth0Audience);

  const response = await fetch(`${auth0Domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    // Auth0 error bodies don't contain secrets; safe to surface for debugging.
    throw new Error(`ROPC token request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  let parsed: { access_token?: string };
  try {
    parsed = JSON.parse(text) as { access_token?: string };
  } catch {
    throw new Error(`ROPC response was not JSON (status ${response.status})`);
  }
  if (!parsed.access_token) {
    throw new Error("ROPC response had no access_token");
  }

  console.log(`[integration] acquired access token (length=${parsed.access_token.length})`);
  cachedToken = parsed.access_token;
  return cachedToken;
}
