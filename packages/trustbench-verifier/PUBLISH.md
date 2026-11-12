# Publishing `@divinci-ai/trustbench-verifier`

The package is MIT-licensed and ready to publish. One command from this directory:

```bash
cd workspace/sdk/packages/trustbench-verifier
pnpm publish --access public
```

## Pre-publish checklist (one-time)

- [ ] `npm login` (or `npm whoami` to confirm) — must be a member of the `@divinci-ai` npm scope
- [ ] Bump `version` in `package.json` if iterating (initial publish at `0.1.0` is fine)
- [ ] Confirm tests pass: `pnpm test` — should report 30/30
- [ ] Confirm build is clean: `pnpm build` — produces `dist/`
- [ ] Spot-check the published files: `npm pack --dry-run` shows what would ship; should exclude `src/`, `tests/`, `tsconfig.json` (per `.npmignore`)

## What ships in the tarball

- `dist/` — compiled JS + `.d.ts` files
- `README.md` — public usage docs
- `package.json` — manifest

## What does NOT ship

Everything else (per `.npmignore`):
- `src/` — TypeScript source
- `tests/` — test fixtures
- `tsconfig.json` — build config
- `node_modules/` — git-ignored anyway

## After publishing

- Verify on npmjs.com: `https://www.npmjs.com/package/@divinci-ai/trustbench-verifier`
- Try a fresh install in a separate shell: `cd /tmp && npm install @divinci-ai/trustbench-verifier`
- Update `workspace/servers/public-api/package.json` to switch from `file:../../sdk/packages/trustbench-verifier` to `^0.1.0` (or whatever version was published) — this lets the public-api Docker build skip the workspace COPY for the verifier package. **Optional optimization, not required for v1.**

## Versioning

Stick to semver. Breaking changes to the `verify()` signature or to the `TrustRunManifestV1` schema are MAJOR bumps. Adding new VerifyOptions fields or new exports is MINOR. Bug fixes are PATCH.

The schema URL pinned in the package (`trustrun-v1.json`) is part of the public contract — any breaking change to the schema must bump it to `trustrun-v2.json` AND keep `TrustRunManifestV1` exported alongside `TrustRunManifestV2` so old manifests stay verifiable.

## Tagging

For pre-1.0 we can publish under tags:

```bash
pnpm publish --access public --tag next     # for 0.x.y betas
pnpm publish --access public --tag latest   # for 1.0+
```
