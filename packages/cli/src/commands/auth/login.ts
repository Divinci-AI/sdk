import { Command } from "commander";
import { input, password } from "@inquirer/prompts";
import { randomBytes } from "node:crypto";
import { DivinciServer } from "@divinci-ai/server";
import { setProfile, getProfile } from "../../config/credentials.js";
import { colors } from "../../output/colors.js";
import { withSpinner } from "../../output/spinner.js";
import { handleCommandError } from "../../utils/errors.js";
import {
  getAuth0Config,
  generatePKCE,
  startCallbackServer,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchUserInfo,
  openBrowser,
  OAUTH_SCOPE_DESCRIPTIONS,
} from "../../auth/oauth.js";

/**
 * Map a well-known profile name to its API URL, so `--profile staging`
 * (without an explicit --api-url) targets the right environment/Auth0 tenant.
 * Unknown profile names return undefined and fall back to the production default.
 */
function apiUrlForProfile(profile: string | undefined): string | undefined {
  switch (profile?.toLowerCase()) {
    case "prod":
    case "production":
      return "https://api.divinci.app";
    case "stage":
    case "staging":
      return "https://api.stage.divinci.app";
    case "dev":
    case "develop":
    case "development":
      return "https://api.dev.divinci.app";
    default:
      return undefined;
  }
}

export function registerLoginCommand(parent: Command): void {
  parent
    .command("login")
    .description("Authenticate with your Divinci account")
    .option("--use-api-key", "Use API key authentication instead of browser login")
    .option("--no-browser", "Print login URL instead of opening browser (for SSH/headless)")
    .option("--api-url <url>", "API URL (determines Auth0 environment)")
    .option(
      "--switch-account",
      "Also re-show the permissions-consent screen (login already always shows " +
      "the account chooser) — use after a scope change, or to double-confirm what's granted",
    )
    .action(async (opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        // `--profile` is a GLOBAL option (declared once on the root program), so
        // `login --profile prod` parses the value into globalOpts — NOT the
        // subcommand's local opts. login used to ALSO declare its own local
        // `--profile` (default "default"); the global captured "prod" while the
        // local default "default" won at the save site, so credentials were
        // written to the "default" profile and the named profile stayed stale
        // (the "login succeeds but --profile prod is still expired" bug). The
        // local option is removed; read the authoritative global value here and
        // thread it through apiUrl inference + the credential save.
        const profile: string = globalOpts.profile ?? "default";
        // Infer the API URL (and therefore the Auth0 tenant) from the profile name
        // when --api-url isn't given, so `--profile staging` actually targets staging
        // instead of silently falling through to the production default.
        const apiUrl =
          opts.apiUrl ?? globalOpts.apiUrl ?? apiUrlForProfile(profile) ?? "https://api.divinci.app";
        // OPTION C (security hardening): the PUBLIC build of the CLI only targets
        // production. Staging/dev are reachable only in internal builds that set
        // DIVINCI_ALLOW_NONPROD=1 (which also permits an explicit --api-url override).
        // This prevents a normal user from accidentally or deliberately pointing the
        // CLI at a non-prod environment. We hard-error rather than silently fall
        // through to prod, so a typo'd `--profile staging` fails loudly instead of
        // authenticating against the wrong tenant.
        if (process.env.DIVINCI_ALLOW_NONPROD !== "1" && apiUrl !== "https://api.divinci.app") {
          throw new Error(
            "This build of the Divinci CLI only targets production (api.divinci.app). " +
              "To target staging/dev, run an internal build with DIVINCI_ALLOW_NONPROD=1.",
          );
        }
        // `--api-key <value>` is the GLOBAL root-level override option (declared
        // once on the root program, distinct from this subcommand's boolean
        // `--use-api-key` intent flag — the two used to share the name
        // `--api-key`, which meant commander resolved the root's value-taking
        // definition first and this subcommand's boolean flag was permanently
        // unreachable). An explicit root-level key value already signals
        // API-key-auth intent, so it's honored here even without --use-api-key.
        const providedApiKey: string | undefined =
          typeof globalOpts.apiKey === "string" && globalOpts.apiKey.length > 0 ? globalOpts.apiKey : undefined;
        const mergedOpts = { ...opts, apiUrl, profile, apiKey: providedApiKey };

        const existing = getProfile(mergedOpts.profile);
        if (existing) {
          console.log(colors.yellow(`Profile "${mergedOpts.profile}" already exists. This will overwrite it.`));
        }

        if (mergedOpts.useApiKey || mergedOpts.apiKey) {
          // API key flow — triggered by --use-api-key, or implicitly by
          // supplying an explicit root-level --api-key <value>.
          await apiKeyLogin(mergedOpts);
        } else {
          // OAuth browser flow (default)
          await oauthLogin(mergedOpts);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}

async function apiKeyLogin(opts: { profile: string; apiUrl: string; apiKey?: string }): Promise<void> {
  const apiKey =
    opts.apiKey ??
    (await password({
      message: "Enter your Divinci API key:",
      mask: "*",
      validate: (val) => {
        if (!val || val.trim().length === 0) return "API key is required";
        return true;
      },
    }));

  let apiUrl = await input({
    message: "API URL:",
    default: opts.apiUrl,
  });
  // OPTION C: public build is prod-only — ignore any non-prod URL entered here
  // so the saved profile can never point at staging/dev.
  if (process.env.DIVINCI_ALLOW_NONPROD !== "1" && apiUrl !== "https://api.divinci.app") {
    console.log(
      colors.yellow("Non-production API URLs are disabled in this build; using https://api.divinci.app."),
    );
    apiUrl = "https://api.divinci.app";
  }

  const validation = await withSpinner("Validating API key...", async () => {
    const client = new DivinciServer({ apiKey: apiKey.trim(), baseUrl: apiUrl });
    const valid = await client.validateApiKey();
    if (!valid) {
      throw new Error("Invalid API key. Please check your key and try again.");
    }
    return true;
  });

  if (validation) {
    setProfile(opts.profile, {
      apiKey: apiKey.trim(),
      apiUrl,
      authType: "api-key",
      lastValidated: new Date().toISOString(),
    });

    console.log(
      colors.green(`\nAuthenticated successfully! Credentials saved to profile "${opts.profile}".`)
    );
    console.log(colors.dim("Run `divinci workspace use <id>` to set your default workspace."));
  }
}

async function oauthLogin(
  opts: { profile: string; apiUrl: string; browser: boolean; switchAccount?: boolean },
): Promise<void> {
  const apiUrl = opts.apiUrl;
  const auth0Config = getAuth0Config(apiUrl);
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = randomBytes(16).toString("hex");

  // Start callback server on 127.0.0.1 with CSRF state validation.
  // Uses preferred ports (8666-8668) registered in Auth0 allowed callbacks.
  const { port, codePromise } = await startCallbackServer(state);
  const redirectUri = `http://localhost:${port}/callback`;

  // Build authorize URL
  const authorizeUrl = buildAuthorizeUrl({
    auth0Config,
    codeChallenge,
    redirectUri,
    state,
    switchAccount: opts.switchAccount,
  });

  // Always shown, every login: which environment this targets and exactly
  // what a successful login grants — so a silently-reused SSO session never
  // surprises anyone about which account or scopes they ended up with.
  console.log(`\n${colors.dim("Environment:")}  ${apiUrl} ${colors.dim(`(${auth0Config.domain})`)}`);
  console.log(colors.dim("This will grant the Divinci CLI permission to:"));
  for (const scope of ["openid", "profile", "email", "offline_access"]) {
    console.log(colors.dim(`  - ${OAUTH_SCOPE_DESCRIPTIONS[scope] ?? scope}`));
  }
  console.log(
    colors.dim(
      opts.switchAccount
        ? "The browser will show the account chooser and ask you to re-confirm these permissions.\n"
        : "The browser will confirm which account you're continuing as before signing in.\n",
    ),
  );

  if (opts.browser) {
    console.log(colors.dim("Opening browser for authentication..."));
    openBrowser(authorizeUrl);
  } else {
    console.log("\nOpen this URL in your browser to log in:\n");
    console.log(colors.cyan(authorizeUrl));
  }

  console.log(colors.dim("\nWaiting for authentication..."));

  // Wait for callback
  const code = await codePromise;

  // Exchange code for tokens
  const tokens = await withSpinner("Exchanging authorization code...", () =>
    exchangeCodeForTokens({
      auth0Config,
      code,
      codeVerifier,
      redirectUri,
    })
  );

  // Fetch user info
  const userInfo = await withSpinner("Fetching user info...", () =>
    fetchUserInfo({
      auth0Domain: auth0Config.domain,
      accessToken: tokens.access_token,
    })
  );

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Save profile
  setProfile(opts.profile, {
    apiUrl,
    authType: "oauth",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    userId: userInfo.sub,
    email: userInfo.email,
    lastValidated: new Date().toISOString(),
  });

  console.log(colors.green(`\nAuthenticated successfully as ${colors.cyan(userInfo.email ?? userInfo.sub)}!`));
  console.log(colors.dim(`Credentials saved to profile "${opts.profile}".`));
  console.log(colors.dim("Run `divinci workspace use <id>` to set your default workspace."));
}
