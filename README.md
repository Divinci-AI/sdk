# Divinci AI SDK

The official SDK for [Divinci AI](https://divinci.ai) — a CLI, TypeScript
clients, an MCP server, and embeddable UI components.

**Documentation: [sdk.divinci.ai](https://sdk.divinci.ai)**

## Packages

| Package | npm | What it is |
|---|---|---|
| [`@divinci-ai/cli`](https://www.npmjs.com/package/@divinci-ai/cli) | `npm i -g @divinci-ai/cli` | Command-line interface — workspaces, RAG, releases, evals, red-teaming |
| [`@divinci-ai/client`](https://www.npmjs.com/package/@divinci-ai/client) | `npm i @divinci-ai/client` | Browser/isomorphic API client |
| [`@divinci-ai/server`](https://www.npmjs.com/package/@divinci-ai/server) | `npm i @divinci-ai/server` | Server-side API client |
| [`@divinci-ai/types`](https://www.npmjs.com/package/@divinci-ai/types) | `npm i @divinci-ai/types` | Shared TypeScript types |
| [`@divinci-ai/mcp`](https://www.npmjs.com/package/@divinci-ai/mcp) | `npm i @divinci-ai/mcp` | Model Context Protocol server |
| [`@divinci-ai/embed-chat-ui`](https://www.npmjs.com/package/@divinci-ai/embed-chat-ui) | `npm i @divinci-ai/embed-chat-ui` | Embeddable chat UI components |
| [`@divinci-ai/robot-avatar`](https://www.npmjs.com/package/@divinci-ai/robot-avatar) | `npm i @divinci-ai/robot-avatar` | Animated robot avatar component |
| [`@divinci-ai/trustbench-verifier`](https://www.npmjs.com/package/@divinci-ai/trustbench-verifier) | `npm i @divinci-ai/trustbench-verifier` | Offline verifier for TrustBench run manifests |

## What this repository is

This is the **public home** for the SDK: issues, changelogs, and the place the
packages' `repository` and `bugs` fields point to.

**The SDK source is not currently public.** It is developed in a private
monorepo alongside the Divinci platform and published from there. We are not
pretending otherwise — if you came here from an npm page expecting source, this
paragraph is the answer.

What you *can* rely on, without the source:

- **Releases are published by a GitHub Actions workflow using
  [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC)**, not
  by a person with a long-lived npm token. Nobody holds a credential that can
  publish these packages.

  **They do NOT carry [npm provenance](https://docs.npmjs.com/generating-provenance-statements),
  and cannot today.** npm only accepts a provenance attestation when the source
  repository is public, and this SDK is built in a private monorepo — the
  registry rejects the publish outright with
  `Unsupported GitHub Actions source repository visibility: "private"`. So
  there is no cryptographic attestation you can check, and `npm view
  @divinci-ai/<pkg> dist.attestations` is empty for every version. Versions
  published before 2026-08-19 were released manually and have none either.

  We are stating this plainly rather than leaving it unsaid: if verifiable
  provenance matters to your supply chain, these packages do not offer it yet.
  Making the source public would, which is the tracked path.

- **`@divinci-ai/trustbench-verifier` is MIT and dependency-free by design** —
  it exists so TrustBench run manifests can be verified offline, by someone who
  does not trust Divinci. Its source belongs in the open; opening it here is
  tracked in the issues.
- **Changelogs are mirrored here** under [`changelogs/`](./changelogs), so you
  can read what changed in a release without installing it.

## Issues and questions

Please [open an issue](https://github.com/Divinci-AI/sdk/issues). Bug reports
against a specific package are most useful with the package name, its version
(`npm ls @divinci-ai/cli`), and what you expected to happen.

For account, billing, or platform questions rather than SDK bugs, use
[divinci.ai/support](https://divinci.ai/support).

## License

MIT — see [LICENSE](./LICENSE).
