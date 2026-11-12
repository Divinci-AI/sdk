# @divinci-ai/server

## 0.7.0

### Minor Changes

- [`f4b0917`](https://github.com/Divinci-AI/server/commit/f4b0917ff23a72731dca6939fcd321058259592e) - `BYOKClient.test(workspaceId, keyId)` probes a bring-your-own-key endpoint and reports whether it answered, and `BYOKEndpointTestResult` is exported. Added after 0.6.1 without a version bump, so a CLI built against the repository referenced a name the published package did not have.

## 0.6.1

### Patch Changes

- Updated dependencies []:
  - @divinci-ai/types@0.1.16

## 0.6.0

### Minor Changes

- [`e23aadc`](https://github.com/Divinci-AI/server/commit/e23aadcc5c76e2490eafc89dd36d467b6a2b1227) - Stop the Hermes agent LIST response from carrying every agent's live proxy key, and ship the external-tools client.

  **`hermesAgents.list()` no longer returns `proxyApiKey`.** Each `hsk-` key is a spend primitive — every completion it buys is a billed unattended agent turn — and the list response carried one per agent, so a single `list()` (or `divinci hermes list --json`, or the `hermes_list` MCP tool) emitted a whole workspace's credentials in one payload. Five of them reached agent transcripts that way.

  The key is now returned only where a caller asked for one specific agent's: `create()`, `get()` and `regenerateKey()`. `list()` and `update()` return the new `HermesAgentSummary`, which is `HermesAgent` minus that field.

  This is a breaking change to the shape `list()` returns, which is why it is a minor on 0.x. If you read `proxyApiKey` from a listing, switch to `hermesAgents.get(workspaceId, agentId)` for the one agent you need — the credential should not be travelling in bulk regardless.

  `divinci hermes get` now prints the key as `hsk-abcd… (sha256:…)` rather than in full, because it is the routine read that fleet scripts and CI capture. `divinci hermes key <id>` still prints it, and `divinci hermes get --show-proxy-key` is the escape hatch. The fingerprint is a sha256 prefix rather than a truncation so two keys stay comparable without either being spendable.

  Also exports the external-tools client that has been in the checkout unreleased since 2026-09-07: `ExternalToolsClient`, `ExternalTool`, `ExternalToolType`, `ExternalToolAuthType`, `CreateExternalToolInput`, `UpdateExternalToolInput`.

## 0.5.0

### Minor Changes

- [`9f7a2c6`](https://github.com/Divinci-AI/server/commit/9f7a2c6f5630802ce68d740cdb38a977b99f3716) - Adds `RedTeamClient`, plus `ai-chats` and `hermes-agents` surface.

  `RedTeamClient` runs the same 32-probe adversarial corpus TrustBench uses against a deployed release, so a workspace can be probed from Node without going through the CLI. Exported from the package root alongside the new `ai-chats` helpers and the `hermes-agents` additions that let a proactive agent read a sibling agent's wakes.

  Also carries the linear-transcript vocabulary (`isLinear`) used by single-threaded transcripts.

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

## 0.3.1

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

## 0.3.0

### Minor Changes

- [`53dca23`](https://github.com/Divinci-AI/server/commit/53dca2398e360906f523036dc647e99f7ac1ff30) - Adds `RedTeamClient`, plus `ai-chats` and `hermes-agents` surface.

  `RedTeamClient` runs the same 32-probe adversarial corpus TrustBench uses against a deployed release, so a workspace can be probed from Node without going through the CLI. Exported from the package root alongside the new `ai-chats` helpers and the `hermes-agents` additions that let a proactive agent read a sibling agent's wakes.

  Also carries the linear-transcript vocabulary (`isLinear`) used by single-threaded transcripts.

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
