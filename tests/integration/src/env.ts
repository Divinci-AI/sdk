/**
 * Environment loading for integration tests.
 *
 * Reads staging credentials from the repo's private-keys directory
 * (override the location with DIVINCI_PRIVATE_KEYS_DIR). Tests skip
 * gracefully when credentials are unavailable, so this suite is safe to
 * invoke anywhere — it only runs for real when creds exist.
 *
 * SECURITY: never log secret VALUES from this module. Log booleans/lengths.
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
// tests/integration/src → repo root is five levels up (sdk → workspace → repo)
const repoRoot = join(here, "..", "..", "..", "..", "..");

const envName = process.env.DIVINCI_INTEGRATION_ENV ?? "staging";
const privateKeysDir =
  process.env.DIVINCI_PRIVATE_KEYS_DIR ?? join(repoRoot, "private-keys", envName);

// Load order matters: dotenv keeps the FIRST value it sees for a key.
// endpoints.shared.env carries the SPA AUTH0_AUDIENCE the API validates
// (the S2S audience in auth0.env is a different API identifier).
for (const file of ["test.env", "endpoints.shared.env", "auth0.env", "web-client-dev.env"]) {
  const p = join(privateKeysDir, file);
  if (existsSync(p)) loadEnv({ path: p });
}

export interface IntegrationConfig {
  apiBaseUrl: string;
  auth0Domain: string | undefined;
  auth0ClientId: string | undefined;
  auth0Audience: string | undefined;
  testUserEmail: string | undefined;
  testUserPassword: string | undefined;
  testWorkspaceId: string | undefined;
}

function normalizeDomain(domain: string | undefined): string | undefined {
  if (!domain) return undefined;
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

export const integrationConfig: IntegrationConfig = {
  apiBaseUrl: process.env.API_URL ?? "https://api.stage.divinci.app",
  auth0Domain: normalizeDomain(
    process.env.AUTH0_BASE_URL ?? process.env.AUTH0_DOMAIN ?? process.env.AUTH0_CLIENT_DOMAIN,
  ),
  auth0ClientId: process.env.AUTH0_CLIENT_ID,
  auth0Audience: process.env.AUTH0_AUDIENCE,
  testUserEmail: process.env.AUTH0_TEST_USER_EMAIL,
  testUserPassword: process.env.AUTH0_TEST_USER_PASSWORD,
  testWorkspaceId: process.env.TEST_WHITELABEL_ID,
};

export const hasCredentials = Boolean(
  integrationConfig.auth0Domain &&
    integrationConfig.auth0ClientId &&
    integrationConfig.testUserEmail &&
    integrationConfig.testUserPassword &&
    integrationConfig.testWorkspaceId,
);

/**
 * These suites are a LIVE-staging drift oracle: they acquire a real OAuth
 * token and exercise deployed routes, so they depend on mutable remote
 * account state (the test user must own a usable whitelabel + release).
 * That makes them flaky as a gate in the default unit-test loop — a
 * deprovisioned fixture throws in beforeAll and registers as "drift" when
 * it's really "nothing provisioned to test against".
 *
 * So they are OPT-IN: run only when explicitly requested via
 * RUN_SDK_INTEGRATION_TESTS=true (and creds exist), the same pattern the
 * Playwright e2e suite uses (RUN_LOCAL_UI_TESTS). Invoke deliberately when
 * you want to check SDK↔API shape drift against a provisioned environment.
 */
export const integrationOptIn = /^(1|true|yes)$/i.test(
  process.env.RUN_SDK_INTEGRATION_TESTS ?? "",
);

/** Run the live suites only when opted in AND credentials are present. */
export const shouldRunIntegration = integrationOptIn && hasCredentials;

if (hasCredentials && !integrationOptIn) {
  console.warn(
    "[integration] credentials present but RUN_SDK_INTEGRATION_TESTS is not set — " +
      "skipping live-staging drift suites (set RUN_SDK_INTEGRATION_TESTS=true to run them)",
  );
}

if (!hasCredentials) {
  // Diagnostic without leaking values.
  console.warn("[integration] missing credentials — suite will be skipped", {
    privateKeysDir,
    hasAuth0Domain: Boolean(integrationConfig.auth0Domain),
    hasAuth0ClientId: Boolean(integrationConfig.auth0ClientId),
    hasAudience: Boolean(integrationConfig.auth0Audience),
    hasTestUser: Boolean(integrationConfig.testUserEmail),
    hasTestPassword: Boolean(integrationConfig.testUserPassword),
    hasWorkspaceId: Boolean(integrationConfig.testWorkspaceId),
  });
}
