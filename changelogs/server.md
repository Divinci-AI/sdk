# @divinci-ai/server

## 0.2.1

### Patch Changes

- [`3033037`](https://github.com/Divinci-AI/server/commit/30330374091d662fc55f551e2775b2c4b87dcf9a) - `bugs` now points at a channel reachable from outside the org (https://divinci.ai/support and engineering@divinci.app). It previously pointed at `github.com/Divinci-AI/sdk/issues`, which returns 404 for anyone without repo access — so a user following the package's own instructions had nowhere to report anything.

  The publish guard also now checks **version honesty**: packing refuses when a workspace dependency's version number is already published with different content. `pnpm pack` rewrites `workspace:*` to the local version number, which is only safe if that number means the same code on the registry as it does here — and nothing enforced that.

- Updated dependencies [[`3033037`](https://github.com/Divinci-AI/server/commit/30330374091d662fc55f551e2775b2c4b87dcf9a)]:
  - @divinci-ai/types@0.1.12

> **Note on 0.1.15 and 0.2.0.** Both were published by hand, outside changesets,
> while `sdk-release.yml` was failing on every run (`ERR_PNPM_OUTDATED_LOCKFILE`
> — see `fix(sdk): unbreak the release pipeline`, 2026-08-11). The 0.2.0 entry
> below was reconstructed from its unconsumed changeset when the pipeline was
> restored; 0.1.15 has no recorded entry because none was ever written.

## 0.2.0

### Minor Changes

- **Breaking:** `transcripts.ingestBatch` has been removed. The method now throws, and the endpoint behind it answers `410 Gone`.

  It was the only write path that skipped the message pipeline — as its own documentation stated, it bypassed moderation, de-identification, RAG retrieval and inference, and left PII redaction to the caller. Because the route was mounted on the user surface rather than behind a machine scope, any workspace member could write arbitrary message roles (including `system`, which subsequent turns replay to the model as a real instruction) into any transcript in the workspace, and raw PII persisted this way was re-sent to the provider on every following turn.

  There is no drop-in replacement, deliberately. If you run inference yourself, persist it yourself. To have Divinci generate and record a turn, use `transcripts.addMessage`, which runs the full pipeline.

  The method and its `IngestBatch*` types are retained as deprecated throwing stubs rather than deleted, so callers upgrading from `0.2.x` get an explanatory error instead of "property does not exist".

## 0.1.14

### Patch Changes

- Republish with resolved dependency versions (second occurrence). `server@0.1.13`, `cli@0.2.16`, `embed-chat-ui@0.1.4`, and `mcp@0.1.1` again shipped literal `workspace:*` dependencies: the publish guard was wired into `prepublishOnly`, which `npm publish` runs but `npm pack` does not — so an `npm pack` in the package directory produced an unrewritten tarball without tripping the guard, and publishing a tarball runs no lifecycle scripts. The guard now runs from `prepack` (fires on both `npm pack` and `npm publish`; pnpm-driven packs remain exempt since pnpm rewrites the protocol), and `scripts/publish-all.sh` performs the full pack → verify-tarball → publish → verify-registry sequence with hard stops. No code changes.

## 0.1.13

### Patch Changes

- Republish with resolved dependency versions. The previous versions (`server@0.1.12`, `cli@0.2.15`, `embed-chat-ui@0.1.3`) were published from the package directory with plain `npm publish`, which does not rewrite pnpm's `workspace:*` protocol — so they shipped with unresolved `workspace:*` dependencies and fail to install from the registry. No code changes. A `prepublishOnly` guard now blocks `npm`-driven publishes of any package whose manifest still contains `workspace:*` dependencies.

## 0.1.12

### Patch Changes

- Updated dependencies [[`1ac9388`](https://github.com/Divinci-AI/server/commit/1ac9388a8f19dfcf4fc7ac4957777ad1285da715), [`1d0eede`](https://github.com/Divinci-AI/server/commit/1d0eede46b51f13c0540e75b74babf64e49717e5)]:
  - @divinci-ai/types@0.1.10
