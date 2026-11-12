# Divinci CLI reference (`@divinci-ai/cli`)

Install: `npm install -g @divinci-ai/cli` (Node >= 22.14) or `npx @divinci-ai/cli …`.
Binary name: `divinci`.

## Global options

`--api-key <key>` · `--workspace <id>` · `--profile <name>` · `--api-url <url>`
· `--json` · `--quiet` · `--verbose` · `--no-color`

Env vars: `DIVINCI_API_KEY`, `DIVINCI_WORKSPACE_ID`, `DIVINCI_API_URL`,
`DIVINCI_PROFILE`. Project config: `.divinci/config.json`
(`{ "workspaceId": "ws_…", "apiUrl": "…" }`).

## Command groups

| Group | Purpose |
|---|---|
| `auth` | `login`, `logout`, `status` / `whoami`; `--profile` for multi-env |
| `workspace` (`ws`) | `list`, `get <id>`, `use <id>` (sets default) |
| `chat` | interactive REPL (`divinci chat`), `send <transcriptId> "msg" [--stream]`, `list`, `history <id>` |
| `rag` | `search <q> [--limit --min-score]`, `files`, `status <fileId>`, `targets create/config` (raptor/lightrag flags) |
| `release` | `list [--status active]`, `get <id>` |
| `trust` | TrustBench attested eval runs: `run`, `verify`, `list`, `benchmarks` |
| `red-team` (`redteam`) | Probe a deployed release: `plan`, `run --release <id> --category <name>\|--all` |
| `hermes` | Hosted Hermes agents |
| `audio` | Audio transcript management |
| `training-data` | Generate training data from RAG files |
| `qa` | `suites`, `runs`, `tests` — QA test suites and validation |
| `fine-tune` | Fine-tuning management |
| `config` | Workspace configuration |
| `group` / `permissions` | User groups and permission management |
| `byok` | Bring-your-own-key provider credentials (OpenAI, Anthropic, Neo4j, …) |
| `api-key` | Workspace API key management |
| `phone` | Phone/SMS number management |
| `connectors` | Web-crawl / data connectors |
| `feedback` | Message feedback |
| `notifications`, `analytics`, `metrics`, `flagger`, `arena-preset`, `style-pattern`, `terms`, `admin`, `rate-limit-requests` | See `divinci <group> --help` |
| `user-skills` | Your user-owned skill instances (e.g. `email-user`) — installed per user, not per release. See [Email tool](./email.md) |
| `api` | Raw REST escape hatch (below) |

`divinci <group> --help` prints subcommands and flags — prefer that over
guessing.

## Raw API escape hatch

```bash
divinci api GET /v1/workspace
divinci api POST /v1/chat/message --body '{"content": "Hello"}'
divinci api GET /v1/files --param limit=10 --param status=ready
```

Base URL defaults to `https://api.divinci.app`; authenticated with the
resolved API key. Use this for any endpoint without a dedicated command.

## RAG targets: advanced retrieval tools

```bash
# RAPTOR (hierarchical tree retrieval)
divinci rag targets create --title "Research papers" --tool raptor \
  --raptor-tree-depth 3 --raptor-cluster-size 10 --raptor-retrieval-mode collapsed

# LightRAG (graph-enhanced)
divinci rag targets create --title "Product docs" --tool lightrag \
  --lightrag-retrieval-mode hybrid

# Query-time knobs can change later; build-time RAPTOR knobs cannot
divinci rag targets config <collectionId> --raptor-retrieval-mode tree-traversal
```

Build-time RAPTOR fields (`--raptor-tree-depth`, `--raptor-cluster-size`,
`--raptor-summary-model`) are creation-only. Re-create the vector to change
them.

## Scripting patterns

```bash
# CI auth — no interactive login needed
export DIVINCI_API_KEY="dv_key_…"
export DIVINCI_WORKSPACE_ID="ws_abc123"

# Pipe JSON everywhere
WORKSPACE_ID=$(divinci workspace list --json | jq -r '.[0].id')
divinci rag search "shipping" --json | jq '.[0]'
divinci rag status <fileId> --json | jq '.status'
```

Multi-environment: `divinci auth login --profile staging`, then
`divinci … --profile staging` per invocation.
