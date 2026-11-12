# @divinci-ai/types

## 0.1.16

### Patch Changes

- Publish the type exports already on `preview` but missing from 0.1.15: `BaaAgreement`, `EmbeddingKeySource`, `EmbeddingModelInfo`, `HipaaCreationAssent` and `HipaaCreationResult`. Packages that depend on `@divinci-ai/types` (the CLI, client and server) import them, and the release guard refuses to pack a dependent against a published `types` that lacks them.

## 0.1.15

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

## 0.1.13

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

## 0.1.12

### Patch Changes

- [`3033037`](https://github.com/Divinci-AI/server/commit/30330374091d662fc55f551e2775b2c4b87dcf9a) - `bugs` now points at a channel reachable from outside the org (https://divinci.ai/support and engineering@divinci.app), instead of a GitHub repo that returns 404 without org access.

## 0.1.10

### Patch Changes

- [`1ac9388`](https://github.com/Divinci-AI/server/commit/1ac9388a8f19dfcf4fc7ac4957777ad1285da715) Thanks [@mikeumus](https://github.com/mikeumus)! - Docs: clarify that `DivinciClientConfig.userToken` must be a short-lived access token (e.g. the `accessToken` from `POST /embed/validate-login`), never the long-lived refresh token returned by `POST /embed/login` — and that the SDK does not auto-refresh it. Also documents the headless external-user login flow (`/embed/login` → `/embed/validate-login` → `userToken`) for integrations driving `@divinci-ai/client` directly without `embed-script.js`.

- [`1d0eede`](https://github.com/Divinci-AI/server/commit/1d0eede46b51f13c0540e75b74babf64e49717e5) Thanks [@mikeumus](https://github.com/mikeumus)! - Fix `HttpClient`'s internal token refresh: it was posting to `POST /api/v1/auth/refresh`, a route that has never existed server-side, so every automatic refresh (triggered on a 401 after `client.setRefreshToken()`) permanently 404'd and silently cleared the stored token with no visible error. It now calls the actual working exchange endpoint, `POST /embed/validate-login`, with the refresh token, release ID, and a new required-for-refresh `origin` config field (checked against the API key's `allowedOrigins`). Refresh failures (network error, non-2xx, or a `{ valid: false }` response) now always log a `console.warn` instead of being swallowed.

  Added `DivinciClientConfig.origin` — set it if you use `client.setRefreshToken()` for automatic refresh; otherwise automatic refresh is skipped with a warning and callers must re-authenticate manually.
