# @divinci-ai/types

## 0.1.12

### Patch Changes

- [`3033037`](https://github.com/Divinci-AI/server/commit/30330374091d662fc55f551e2775b2c4b87dcf9a) - `bugs` now points at a channel reachable from outside the org (https://divinci.ai/support and engineering@divinci.app), instead of a GitHub repo that returns 404 without org access.

## 0.1.10

### Patch Changes

- [`1ac9388`](https://github.com/Divinci-AI/server/commit/1ac9388a8f19dfcf4fc7ac4957777ad1285da715) Thanks [@mikeumus](https://github.com/mikeumus)! - Docs: clarify that `DivinciClientConfig.userToken` must be a short-lived access token (e.g. the `accessToken` from `POST /embed/validate-login`), never the long-lived refresh token returned by `POST /embed/login` — and that the SDK does not auto-refresh it. Also documents the headless external-user login flow (`/embed/login` → `/embed/validate-login` → `userToken`) for integrations driving `@divinci-ai/client` directly without `embed-script.js`.

- [`1d0eede`](https://github.com/Divinci-AI/server/commit/1d0eede46b51f13c0540e75b74babf64e49717e5) Thanks [@mikeumus](https://github.com/mikeumus)! - Fix `HttpClient`'s internal token refresh: it was posting to `POST /api/v1/auth/refresh`, a route that has never existed server-side, so every automatic refresh (triggered on a 401 after `client.setRefreshToken()`) permanently 404'd and silently cleared the stored token with no visible error. It now calls the actual working exchange endpoint, `POST /embed/validate-login`, with the refresh token, release ID, and a new required-for-refresh `origin` config field (checked against the API key's `allowedOrigins`). Refresh failures (network error, non-2xx, or a `{ valid: false }` response) now always log a `console.warn` instead of being swallowed.

  Added `DivinciClientConfig.origin` — set it if you use `client.setRefreshToken()` for automatic refresh; otherwise automatic refresh is skipped with a warning and callers must re-authenticate manually.
