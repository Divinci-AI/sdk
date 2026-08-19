# @divinci-ai/client

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
