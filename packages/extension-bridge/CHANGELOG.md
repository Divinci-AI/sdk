# @divinci-ai/extension-bridge

## 0.1.2

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

## 0.1.1

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
