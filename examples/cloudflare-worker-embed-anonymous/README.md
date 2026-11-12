# Divinci Embed on Cloudflare Workers — Anonymous Chat

A single-file Cloudflare Worker that serves a page with the Divinci embed
client against an **anonymous release** (visitors chat without logging in).

The demo page is a tabbed playground: each tab re-mounts the chat with a
different feature-flag preset and shows the exact `DivinciChat` constructor
config it used — context bubbles, product recommendations, metrics, help
requests, notifications, quick menu, message feedback, share chat, and the
toggleable floating widget.

Use it as a **starter template**: copy this directory, set `RELEASE_ID` in
`wrangler.toml` to one of your releases (with anonymous chat enabled), and
deploy. Annotated walkthrough: https://sdk.divinci.ai/embed/examples/

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
| `RELEASE_ID` | Your Divinci release id (anonymous chat enabled) |
| `ENVIRONMENT` | Label shown in the demo header |
| `REQUIRE_ACCESS_AUTH` | `"true"` to gate the page behind Cloudflare Access |

### Optional: gate the demo behind Cloudflare Access

1. Zero Trust Dashboard → **Access** → **Applications** → create a
   self-hosted app for the worker URL
2. `wrangler secret put TEAM_DOMAIN` (e.g. `https://your-team.cloudflareaccess.com`)
3. `wrangler secret put POLICY_AUD` (the application audience tag)
4. Set `REQUIRE_ACCESS_AUTH = "true"`

The Worker then validates the `CF_Authorization` JWT against your team's
certs and shows the visitor's email in the header.

## Terms of Service gate

If your release references a **published Terms of Service** document, the
embed automatically shows a blocking acceptance modal before the first
message — no extra embed option needed. Anonymous visitors are tracked per
device (a persistent anonymous session id in localStorage); publishing a
new ToS version forces re-acceptance on the next interaction. Configure it
in the Divinci release editor under *Terms of Service*.

## See also

- [`../cloudflare-worker-embed-auth`](../cloudflare-worker-embed-auth) —
  the same playground against an auth-required release
- [Embed reference](https://sdk.divinci.ai/embed/reference/) — every script
  attribute and constructor option
- [Landing page with server-signed API calls](https://sdk.divinci.ai/guides/cloudflare-workers/) —
  the non-iframe pattern (HMAC, one free message per visitor)
