# @divinci-ai/cli

Official command-line interface for Divinci AI. Manage workspaces, chat with AI assistants, search knowledge bases, and interact with the Divinci API from your terminal.

## Installation

```bash
npm install -g @divinci-ai/cli
```

Or run directly with npx:

```bash
npx @divinci-ai/cli auth login
```

**Requirements:** Node.js >= 22.14.0

## Quick Start

```bash
# Authenticate with your API key
divinci auth login

# List your workspaces
divinci workspace list

# Set a default workspace
divinci workspace use <workspaceId>

# Start an interactive chat session
divinci chat
```

## Authentication

The CLI supports multiple authentication methods. Use `divinci auth login` for interactive setup, or provide credentials via environment variables or flags for CI/CD.

```bash
# Interactive login (prompts for API key, validates it)
divinci auth login

# Login with a named profile
divinci auth login --profile staging

# Check current auth status
divinci auth status

# Remove stored credentials
divinci auth logout
```

Credentials are stored in `~/.config/divinci/credentials.json` with `0600` file permissions. The file supports multiple named profiles.

## Configuration

Configuration is resolved in the following priority order:

| Priority | Source | Example |
|----------|--------|---------|
| 1 (highest) | CLI flags | `--api-key`, `--workspace`, `--profile` |
| 2 | Environment variables | `DIVINCI_API_KEY`, `DIVINCI_WORKSPACE_ID` |
| 3 | Project config | `.divinci/config.json` in current directory |
| 4 (lowest) | User credentials | `~/.config/divinci/credentials.json` |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DIVINCI_API_KEY` | API key for authentication |
| `DIVINCI_WORKSPACE_ID` | Default workspace ID |
| `DIVINCI_API_URL` | API base URL (default: `https://api.divinci.app`) |
| `DIVINCI_PROFILE` | Named profile to use (default: `default`) |

### Project Configuration

Create a `.divinci/config.json` in your project root to share settings across a team:

```json
{
  "workspaceId": "ws_abc123",
  "apiUrl": "https://api.divinci.app"
}
```

## Commands Reference

### auth

Manage authentication credentials.

```bash
divinci auth login              # Interactive API key login
divinci auth login --profile ci # Login with a named profile
divinci auth logout             # Remove stored credentials
divinci auth logout -y          # Skip confirmation prompt
divinci auth status             # Show current auth info
divinci auth whoami             # Alias for status
```

### chat

Interactive chat and conversation management.

```bash
# Start an interactive REPL session
# Supports slash commands: /help, /new, /exit
divinci chat

# Send a one-shot message to an existing conversation
divinci chat send <transcriptId> "What is the return policy?"

# Stream the response token-by-token
divinci chat send <transcriptId> "Summarize this document" --stream

# List conversations
divinci chat list
divinci chat list --limit 20 --offset 10

# View conversation history
divinci chat history <transcriptId>
divinci chat history <transcriptId> --limit 50
```

### rag

Search and manage your knowledge base.

```bash
# Search the knowledge base
divinci rag search "pricing information"
divinci rag search "refund policy" --limit 5 --min-score 0.7

# List indexed files
divinci rag files
divinci rag files --page 2 --limit 25

# Check file processing status
divinci rag status <fileId>
```

#### RAG vector targets (advanced tools)

When creating a target, both per-field flags and raw JSON config are supported:

```bash
# RAPTOR (hierarchical tree-organized retrieval)
divinci rag targets create \
  --title "Research papers" \
  --tool raptor \
  --raptor-tree-depth 3 \
  --raptor-cluster-size 10 \
  --raptor-retrieval-mode collapsed

# LightRAG (graph-enhanced)
divinci rag targets create \
  --title "Product docs" \
  --tool lightrag \
  --lightrag-retrieval-mode hybrid

# Update RAPTOR query-time knobs (tree structure is immutable after creation)
divinci rag targets config <collectionId> --raptor-retrieval-mode tree-traversal
```

Build-time RAPTOR fields (`--raptor-tree-depth`, `--raptor-cluster-size`,
`--raptor-summary-model`) can only be set at creation. The tree is built once
against the initial embedding model; changing those knobs later has no effect
on existing files. Re-create the vector if you need different tree parameters.

### release

View and manage releases.

```bash
# List releases
divinci release list
divinci release list --status active --limit 10

# Get release details
divinci release get <releaseId>
```

### workspace

Manage workspaces. Also available via the `ws` alias.

```bash
# List available workspaces
divinci workspace list
divinci ws list --limit 50

# Get workspace details
divinci workspace get <workspaceId>

# Set the default workspace for subsequent commands
divinci workspace use <workspaceId>
```

### api

Make raw API requests. Useful for accessing endpoints not covered by dedicated commands.

```bash
# GET request
divinci api GET /v1/workspace

# POST request with a JSON body
divinci api POST /v1/chat/message --body '{"content": "Hello"}'

# Pass query parameters
divinci api GET /v1/files --param limit=10 --param status=ready
```

## Global Options

| Option | Description |
|--------|-------------|
| `--api-key <key>` | Override API key for this invocation |
| `--workspace <id>` | Override workspace ID |
| `--json` | Output as JSON (for scripting and piping) |
| `--no-color` | Disable colored output |
| `--quiet` | Minimal output |
| `--verbose` | Debug output |
| `--profile <name>` | Use a named profile (default: `default`) |
| `--api-url <url>` | Override API base URL |

## Scripting with --json

All commands support `--json` for machine-readable output. Combine with standard tools like `jq`:

```bash
# Get workspace IDs as a JSON array
divinci workspace list --json | jq '.[].id'

# Search and extract top result
divinci rag search "shipping" --json | jq '.[0]'

# Use in shell scripts
WORKSPACE_ID=$(divinci workspace list --json | jq -r '.[0].id')
divinci workspace use "$WORKSPACE_ID"
```

## Examples

**CI/CD pipeline authentication:**

```bash
export DIVINCI_API_KEY="dv_key_..."
export DIVINCI_WORKSPACE_ID="ws_abc123"
divinci rag search "deployment checklist" --json
```

**Multi-profile setup (e.g., dev and production):**

```bash
divinci auth login --profile dev
divinci auth login --profile production

# Use a specific profile
divinci workspace list --profile production
divinci rag search "docs" --profile dev
```

**Check if a file has been indexed:**

```bash
divinci rag status abc123-file-id --json | jq '.status'
```

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build
pnpm build

# Type-check
pnpm typecheck

# Run tests
pnpm test

# Run integration tests (requires DIVINCI_API_KEY)
pnpm test:integration
```
