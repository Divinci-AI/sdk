# @divinci-ai/mcp

## 0.1.7

### Patch Changes

- Updated dependencies []:
  - @divinci-ai/types@0.1.16

## 0.1.6

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

## 0.1.5

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
