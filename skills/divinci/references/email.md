# Email tool

Divinci can send email on your behalf through Cloudflare Email Service (via
the existing notification-email Worker). Two catalog integrations share one
implementation but differ in **recipient scope**, enforced server-side:

| Integration | Scope | Who it emails |
|---|---|---|
| `email-release` | release-owned | **only** the person currently chatting with the assistant |
| `email-user` | user-owned (`UserSkill`) | **only** yourself + members of your workspace org |

`auth.type: "divinci"` — no owner credentials needed. The send is done by the
Worker using Divinci's CF account; owners only enable the skill + set `replyTo`.

The sender is always `no-reply@divinci.app` (CF-verified).

## Dogfooding through a release (recommended)

The email tool is meant to be invoked by an **agent inside a release**, not
called directly. Flow:

1. **Install** the `email-user` (or `email-release`) skill for your user via
   the CLI or MCP (below).
2. **Attach** it to a release (the release's agent picks it up as a callable
   tool — `UserSkill.buildToolDefs` surfaces any catalog integration as a
   tool the agent can invoke).
3. **Chat** with the release and ask it to "email me X" / "email the team Y".
   The agent calls the email tool → the Worker sends the message.

Recipient scoping is enforced inside the skill's `run()`, so a release-owned
`email-release` instance can never email anyone but the chatting user, and a
`email-user` instance can never email outside self + org.

## CLI (`@divinci-ai/cli`)

```bash
# List user-eligible integrations (today: email-user)
divinci user-skills catalog

# Install email-user for yourself (replyTo is required)
divinci user-skills create \
  --integration-id email-user \
  --title "My email" \
  --reply-to you@divinci.app

# List / inspect / remove your instances
divinci user-skills list
divinci user-skills get <skillId>
divinci user-skills delete <skillId>   # alias: rm
```

`--workspace <id>` overrides the active workspace (else `.divinci/config.json`).

## MCP (hosted server `https://mcp.divinci.app/mcp`)

Owner-scoped `user_skills_*` tools mirror the CLI:

| Tool | Purpose |
|---|---|
| `user_skills_catalog` | List installable integrations (`email-user`) |
| `user_skills_list` | List your installed instances |
| `user_skills_get` | Get one instance by id |
| `user_skills_create` | Install `email-user` (pass `integrationId`, `title`, `replyTo`) |
| `user_skills_delete` | Delete an instance |

An MCP-connected assistant can therefore install **and** invoke the email
skill — useful for dogfooding the tool end-to-end from a session without the
web UI.

## API (owner-scoped)

Routes are mounted under `/white-label/:whitelabelId/user-skills` (distinct
from release-owned `/white-label/:whitelabelId/skills`). Every handler
enforces `userId === authenticated user`, so a user only ever sees/manages
their own instances.

| Method | Path | Body / Notes |
|---|---|---|
| `GET` | `/catalog` | user-eligible integrations (`email-user`) |
| `GET` | `/` | your instances |
| `POST` | `/` | `{ integrationId, title, instanceDescription?, config? }` → 201 |
| `GET` | `/:skillId` | one instance |
| `PATCH` | `/:skillId` | update title/description/config/`draftState`/`toolOverrides` |
| `DELETE` | `/:skillId` | `{ ok: true }` |

`config` for `email-user` requires `mode: "user"` and `replyTo`.

## Worker (send path)

The actual send is `POST` to the Cloudflare email Worker
(`divinci-send-notification-email-d011`), which has a generic, secret-gated
send branch (`WORKER_AUTH_HEADER_NAME` / `WORKER_AUTH_VALUE`, per-env in
`wrangler.toml` `[vars]`). The server calls it with `from: no-reply@divinci.app`
+ the resolved recipients — the agent never sees the secret.
