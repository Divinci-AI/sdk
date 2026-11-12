# Divinci Agent Skills

Distributable [Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills)
for coding agents (Claude Code, and any agent that reads `SKILL.md` packages).

## `divinci` — SDK / CLI / API skill

Teaches an agent how to build with the Divinci platform: the `divinci` CLI,
`@divinci-ai/client`, `@divinci-ai/server`, `@divinci-ai/mcp`, and the raw
REST API.

### Install (Claude Code)

Per-project:

```bash
mkdir -p .claude/skills
cp -R skills/divinci .claude/skills/divinci
```

Or globally for all projects:

```bash
cp -R skills/divinci ~/.claude/skills/divinci
```

Or download the packaged zip from https://sdk.divinci.ai/divinci-skill.zip
and unzip it into either location. The skill activates automatically when a
task involves Divinci; you can also invoke it explicitly with `/divinci`.

### Layout

```
divinci/
  SKILL.md                 # entry point — concepts, auth, surface picker
  references/
    cli.md                 # divinci CLI command reference
    client-sdk.md          # @divinci-ai/client (browser)
    server-sdk.md          # @divinci-ai/server (Node.js)
    mcp.md                 # hosted MCP server + @divinci-ai/mcp
```

### Regenerating the distributable zip

From `workspace/sdk`:

```bash
./scripts/build-skill-zip.sh
```

Writes `docs/public/divinci-skill.zip`, which the docs site serves at
`https://sdk.divinci.ai/divinci-skill.zip`.
