# @divinci-ai/client

## 0.6.6

### Patch Changes

- Updated dependencies []:
  - @divinci-ai/types@0.1.16

## 0.6.5

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

- Updated dependencies [[`9f7a2c6`](https://github.com/Divinci-AI/server/commit/9f7a2c6f5630802ce68d740cdb38a977b99f3716)]:
  - @divinci-ai/types@0.1.15

## 0.6.2

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
  - @divinci-ai/types@0.1.13

## 0.6.1

### Patch Changes

- Updated dependencies [[`3033037`](https://github.com/Divinci-AI/server/commit/30330374091d662fc55f551e2775b2c4b87dcf9a)]:
  - @divinci-ai/types@0.1.12

## 0.5.0

### Minor Changes

- [`1d0eede`](https://github.com/Divinci-AI/server/commit/1d0eede46b51f13c0540e75b74babf64e49717e5) Thanks [@mikeumus](https://github.com/mikeumus)! - Fix `HttpClient`'s internal token refresh: it was posting to `POST /api/v1/auth/refresh`, a route that has never existed server-side, so every automatic refresh (triggered on a 401 after `client.setRefreshToken()`) permanently 404'd and silently cleared the stored token with no visible error. It now calls the actual working exchange endpoint, `POST /embed/validate-login`, with the refresh token, release ID, and a new required-for-refresh `origin` config field (checked against the API key's `allowedOrigins`). Refresh failures (network error, non-2xx, or a `{ valid: false }` response) now always log a `console.warn` instead of being swallowed.

  Added `DivinciClientConfig.origin` — set it if you use `client.setRefreshToken()` for automatic refresh; otherwise automatic refresh is skipped with a warning and callers must re-authenticate manually.

### Patch Changes

- Updated dependencies [[`1ac9388`](https://github.com/Divinci-AI/server/commit/1ac9388a8f19dfcf4fc7ac4957777ad1285da715), [`1d0eede`](https://github.com/Divinci-AI/server/commit/1d0eede46b51f13c0540e75b74babf64e49717e5)]:
  - @divinci-ai/types@0.1.10

## 0.2.0

### Minor Changes

- `@divinci-ai/client@0.2.0` — first feature release since 0.1.0.

  **New namespaces**

  - `byok` — bring-your-own-key provider credentials (create, list, rotate, delete).
    Endpoint URL corrected from `/tools/providers/keys` → `/tools/byok/keys`.
  - `style-pattern` — admin surfaces for the style-pattern capture pipeline
    (Captured Edits, training-run creation, JSONL export, status transitions).
  - `rag` — public-API surface for vector indexes, groups, context, chunks,
    including create/migrate/bulk-reindex flows.

  **Runtime support**

  - Documented Cloudflare Workers + non-browser runtime usage.
  - Fleshed-out error-handling example in README + reference docs.

  **Misc**

  - Docs base URL corrected to `sdk.divinci.ai` across all SDK packages.
  - Dev-deps aligned (vitest `^3.2.4`) with the rest of the SDK workspace.

  No breaking changes since `0.1.0`.
