# Divinci Embed on Cloudflare Workers — Authenticated Chat

A single-file Cloudflare Worker that serves a page with the Divinci embed
client against an **auth-required release** — visitors log in via Divinci's
built-in authentication before chatting.

The demo page is a tabbed playground: each tab re-mounts the chat with a
different feature-flag preset and shows the exact `DivinciChat` constructor
config it used — including **external-user mode** for sites that already
have their own auth and want to pass the user into the embed via JWT.

Use it as a **starter template**: copy this directory, set `RELEASE_ID` in
`wrangler.toml` to one of your releases (login required), and deploy.
Annotated walkthrough: https://sdk.divinci.ai/embed/examples/

## Quick start

```bash
pnpm install        # or npm install
# edit wrangler.toml → RELEASE_ID
pnpm dev            # local preview at localhost:8787
pnpm deploy         # deploy to your Cloudflare account
```

## Configuration (`wrangler.toml` vars)

| Variable | Description |
|----------|-------------|
| `EMBED_SCRIPT_URL` | Embed script host (`https://assets.divinci.app/embed-script.js`) |
| `RELEASE_ID` | Your Divinci release id (auth required) |
| `ENVIRONMENT` | Label shown in the demo header |
| `REQUIRE_ACCESS_AUTH` | `"true"` to gate the page behind Cloudflare Access |

### Optional: gate the demo behind Cloudflare Access

1. Zero Trust Dashboard → **Access** → **Applications** → create a
   self-hosted app for the worker URL
2. `wrangler secret put TEAM_DOMAIN` (e.g. `https://your-team.cloudflareaccess.com`)
3. `wrangler secret put POLICY_AUD` (the application audience tag)
4. Set `REQUIRE_ACCESS_AUTH = "true"`

## External-user mode

The "External User Mode" tab demonstrates `externalUser: true` — for sites
with their own login system. In production you call
`chat.auth.login(yourUserJwt)` once your user is authenticated, and the
embed maps them to a Divinci identity (with optional per-tier quotas). See
the [embed reference](https://sdk.divinci.ai/embed/reference/) for the auth
API.

## Terms of Service gate

If your release references a **published Terms of Service** document, the
embed automatically shows a blocking acceptance modal before the first
message — no extra embed option needed. Authenticated users are tracked per
account; publishing a new ToS version forces re-acceptance on the next
interaction. Configure it in the Divinci release editor under
*Terms of Service*.

## See also

- [`../cloudflare-worker-embed-anonymous`](../cloudflare-worker-embed-anonymous) —
  the same playground against an anonymous release
- [Embed reference](https://sdk.divinci.ai/embed/reference/) — every script
  attribute and constructor option
