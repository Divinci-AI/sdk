# @divinci-ai/embed-chat-ui

## 0.1.6

### Patch Changes

- Updated dependencies []:
  - @divinci-ai/client@0.6.1

## 0.1.5

### Patch Changes

- Republish with resolved dependency versions (second occurrence). `server@0.1.13`, `cli@0.2.16`, `embed-chat-ui@0.1.4`, and `mcp@0.1.1` again shipped literal `workspace:*` dependencies: the publish guard was wired into `prepublishOnly`, which `npm publish` runs but `npm pack` does not — so an `npm pack` in the package directory produced an unrewritten tarball without tripping the guard, and publishing a tarball runs no lifecycle scripts. The guard now runs from `prepack` (fires on both `npm pack` and `npm publish`; pnpm-driven packs remain exempt since pnpm rewrites the protocol), and `scripts/publish-all.sh` performs the full pack → verify-tarball → publish → verify-registry sequence with hard stops. No code changes.

## 0.1.4

### Patch Changes

- Republish with resolved dependency versions. The previous versions (`server@0.1.12`, `cli@0.2.15`, `embed-chat-ui@0.1.3`) were published from the package directory with plain `npm publish`, which does not rewrite pnpm's `workspace:*` protocol — so they shipped with unresolved `workspace:*` dependencies and fail to install from the registry. No code changes. A `prepublishOnly` guard now blocks `npm`-driven publishes of any package whose manifest still contains `workspace:*` dependencies.

## 0.1.3

### Patch Changes

- Updated dependencies [[`1d0eede`](https://github.com/Divinci-AI/server/commit/1d0eede46b51f13c0540e75b74babf64e49717e5)]:
  - @divinci-ai/client@0.5.0
