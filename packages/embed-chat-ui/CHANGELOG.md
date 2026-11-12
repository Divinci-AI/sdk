# @divinci-ai/embed-chat-ui

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @divinci-ai/client@0.6.6

## 0.3.0

### Minor Changes

- [`9f7a2c6`](https://github.com/Divinci-AI/server/commit/9f7a2c6f5630802ce68d740cdb38a977b99f3716) - The widget can now honour a first-party `chat.divinci.app` login.

  A docs widget on another origin is anonymous and Turnstile-gated, and cannot see the Auth0 session on the chat app because the domains differ (`.ai` vs `.app`). A first-party session page now `postMessage`s a token to allowlisted docs origins only; the widget sends it as `Authorization`, and the free-chat gate skips the per-IP free-tier counters only when both a valid Auth0 subject and a trusted origin are present.

  New exports: `isFirstPartyDocsParentOrigin`, `isTrustedChatOrigin`, `parseDocsSessionMessage`, `docsSessionUrl`. Origin checks are allowlist-based on both ends — widen them deliberately, since the token is the thing being handed across origins.

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
  - @divinci-ai/client@0.6.5

## 0.2.1

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
  - @divinci-ai/client@0.6.2

## 0.2.0

### Minor Changes

- [`53dca23`](https://github.com/Divinci-AI/server/commit/53dca2398e360906f523036dc647e99f7ac1ff30) - The widget can now honour a first-party `chat.divinci.app` login.

  A docs widget on another origin is anonymous and Turnstile-gated, and cannot see the Auth0 session on the chat app because the domains differ (`.ai` vs `.app`). A first-party session page now `postMessage`s a token to allowlisted docs origins only; the widget sends it as `Authorization`, and the free-chat gate skips the per-IP free-tier counters only when both a valid Auth0 subject and a trusted origin are present.

  New exports: `isFirstPartyDocsParentOrigin`, `isTrustedChatOrigin`, `parseDocsSessionMessage`, `docsSessionUrl`. Origin checks are allowlist-based on both ends — widen them deliberately, since the token is the thing being handed across origins.

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
