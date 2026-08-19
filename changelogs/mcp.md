# @divinci-ai/mcp

## 0.1.4

### Patch Changes

- [`c97eefa`](https://github.com/Divinci-AI/server/commit/c97eefa2bce2e03820351b2033812e7a986697bc) - Fix a build failure in the Streamable HTTP transport. `postJson` returns a union that includes `Record<string, unknown>`, so narrowing on `"error" in response` left the value typed as `{}` and reading `.message`/`.code` off it did not compile. The error is now read as a `Partial<McpError>`, which is also more honest — the response comes from a remote server, so neither field is guaranteed, and the existing fallbacks already assumed that.

  This broke `pnpm -r build` for the whole SDK workspace, and therefore every release. It went unnoticed because the release pipeline had been failing one step earlier since at least 2026-08-07.

- Updated dependencies [[`3033037`](https://github.com/Divinci-AI/server/commit/30330374091d662fc55f551e2775b2c4b87dcf9a)]:
  - @divinci-ai/types@0.1.12

## 0.1.2

### Patch Changes

- Republish with resolved dependency versions (second occurrence). `server@0.1.13`, `cli@0.2.16`, `embed-chat-ui@0.1.4`, and `mcp@0.1.1` again shipped literal `workspace:*` dependencies: the publish guard was wired into `prepublishOnly`, which `npm publish` runs but `npm pack` does not — so an `npm pack` in the package directory produced an unrewritten tarball without tripping the guard, and publishing a tarball runs no lifecycle scripts. The guard now runs from `prepack` (fires on both `npm pack` and `npm publish`; pnpm-driven packs remain exempt since pnpm rewrites the protocol), and `scripts/publish-all.sh` performs the full pack → verify-tarball → publish → verify-registry sequence with hard stops. No code changes.

## 0.1.1

### Patch Changes

- Updated dependencies [[`1ac9388`](https://github.com/Divinci-AI/server/commit/1ac9388a8f19dfcf4fc7ac4957777ad1285da715), [`1d0eede`](https://github.com/Divinci-AI/server/commit/1d0eede46b51f13c0540e75b74babf64e49717e5)]:
  - @divinci-ai/types@0.1.10
