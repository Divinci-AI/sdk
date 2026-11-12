# Releasing `@divinci-ai/cli`

This runbook covers how changes land in a published release of the CLI and
how `@divinci-ai/cli` actually gets pushed to npm. It is the reference for
both maintainers and automation.

## High-level flow (Phase 2, auto-publish with approval gate)

```
 feature PR ──┐    review +         reviewer approves       publish runs;
              │    merge            the npm-publish         maintainer verifies
              ▼       ▼             environment step        with `npm view`
  preview branch ──▶ Version ─────▶ publish (guarded) ────▶ npm.js tag
                     Packages PR
```

1. A developer opens a feature PR against `preview`. As part of the PR they
   add a changeset describing what changed and the semver level
   (`pnpm changeset`).
2. CI runs `sdk-drift-and-audit` on the PR:
   - CLI spec drift check (blocking)
   - `pnpm audit --audit-level high --prod` (blocking)
   - Semgrep SAST (blocking)
3. The PR passes review and merges into `preview`.
4. `sdk-release` workflow runs. Because the `npm-publish` GitHub Environment
   is protected, the workflow **pauses on approval** before either job
   (version PR or publish) runs. A designated reviewer sees the pending run
   and clicks Approve.
5. Changesets detects the pending changeset and opens — or updates — a
   **Version Packages** PR that bumps versions, writes CHANGELOG entries,
   and regenerates `cli-commands.json`.
6. A maintainer reviews the Version Packages PR and merges it.
7. `sdk-release` runs again on the merge. The reviewer approves the
   Environment step a second time.
8. Because there are no pending changesets (they were consumed by the
   Version PR), changesets/action calls `pnpm changeset:publish` and the new
   version hits npm with provenance.
9. The maintainer verifies with `npm view @divinci-ai/cli version`.

The double-approval on steps 4 and 7 is deliberate: each approval is
a human saying "yes, I am OK with what's about to happen." This is the
equivalent of the "manual publish" safety net from Phase 1, compressed into
a single button click.

## Adding a changeset on a feature PR

From the `workspace/sdk` directory:

```bash
cd workspace/sdk
pnpm changeset
```

The interactive prompt asks which packages changed, what type of bump each
gets, and a short summary. This writes a `.md` file under
`workspace/sdk/.changeset/` — commit it as part of your PR.

**Semver picking guide:**

| Change type | Bump |
|---|---|
| Removed a command, renamed a flag, changed a flag's value type | **major** |
| Added a new command, added an optional flag, new subcommand | **minor** |
| Fixed a bug, clarified description, no user-visible shape change | **patch** |

If you're unsure, pick the higher level — it's always safer to over-bump than
to ship a breaking change under a minor version.

## GitHub Environment: `npm-publish`

`sdk-release.yml` targets `environment: npm-publish`. This is a GitHub
Environment configured in the repo settings with:

- **Required reviewers**: at least one maintainer must click Approve before
  the job runs.
- **Secrets**: `NPM_TOKEN` scoped to this environment so it's only available
  to runs that have been approved.
- **Protection rules**: (optional) a wait timer and/or restricted branches.

When a run hits this job, it blocks in the Actions UI with a yellow "Waiting
for approval" banner. The reviewer can see the full context (which commit,
which packages about to publish, which versions) before approving. Rejecting
simply ends the run without publishing.

If you want to differentiate major bumps from patches (e.g., patch bumps
auto-approve but majors still need review), add a "prepare release" job that
inspects the pending changesets and routes to a different Environment based
on the highest bump level. Today the pipeline uses one Environment for
simplicity.

## Prerequisites (first-time setup)

Before the first successful publish, these need to exist — and a human has
to do them because they touch npm, GitHub settings, or an npm scope that
doesn't exist yet:

- [ ] **npm organization `@divinci-ai`** exists and is owned by the release
  maintainer. If not, create it at https://www.npmjs.com/org/create.
- [ ] **Publish permission** on `@divinci-ai/cli` for the account whose
  token will be used by CI.
- [ ] **`NPM_TOKEN`** generated as an **Automation** token (not a Classic or
  Granular token — Automation tokens work with CI and 2FA-enabled accounts).
  Generate at https://www.npmjs.com/settings/YOUR_USERNAME/tokens.
- [ ] **`NPM_TOKEN` stored as a GitHub Actions secret** on the
  `npm-publish` Environment (not as a repo secret — Environment-scoped
  secrets are only visible to approved runs).
- [ ] **GitHub Environment `npm-publish`** created in repo Settings →
  Environments with at least one required reviewer.
- [ ] **`preview` is configured as the default branch** or matches the
  `baseBranch` field in `.changeset/config.json`.
- [ ] **`publishConfig.access: "public"`** set on every package being
  published (already done for `@divinci-ai/cli`).
- [ ] **Package has a README** shown to npm users. Currently the CLI ships
  `README.md` via the `files` field.

## Manual publish (fallback path)

If the automation breaks and you need to publish by hand, or the first
release needs to happen before the Environment is set up:

1. **Pull the merge locally**
   ```bash
   git checkout preview && git pull origin preview
   ```

2. **Make sure the sdk builds cleanly**
   ```bash
   cd workspace/sdk
   pnpm install --frozen-lockfile
   pnpm run build
   pnpm run typecheck
   ```

3. **Run the tarball smoke test**
   ```bash
   cd workspace/sdk/packages/cli
   pnpm run smoke:tarball
   ```
   Invokes `scripts/smoke-test-tarball.sh`, which:
   - Builds the package
   - Packs it with `pnpm pack` (must be pnpm, not npm — `npm pack`
     leaves `workspace:*` references unresolved and the install fails
     with `EUNSUPPORTEDPROTOCOL`)
   - Creates a fresh empty project in a temp dir
   - `npm install`s the tarball into that project (pulls real deps)
   - Runs `node_modules/.bin/divinci --version` and asserts it matches
     `package.json`
   - Runs `--help` and asserts ≥10 lines of output
   - Scans the extracted tarball for `.tsbuildinfo` or `.env` leakage
   - Verifies the minimal required files are present (`package.json`,
     `README.md`, `dist/bin/divinci.js`, `dist/src/index.js`)

   If this fails, do not publish — the smoke test is the last cheap
   signal you get before the release is irreversible.

4. **Run the security audit gate manually**
   ```bash
   cd workspace/sdk
   pnpm audit --audit-level high --prod --ignore GHSA-wrwg-2hg8-v723
   ```
   The ignored CVE is documented in `sdk-drift-and-audit.yml`; reassess it
   before every release.

5. **Log in to npm with the release account**
   ```bash
   npm login
   npm whoami  # confirm it's the correct account
   ```

6. **Publish via changesets**
   ```bash
   pnpm changeset:publish
   ```
   This reads the version from `packages/cli/package.json` and publishes
   with the `public` access declared in `.changeset/config.json`.

7. **Push the git tags that `changeset version` prepared**
   ```bash
   git push origin preview --follow-tags
   ```

8. **Verify the published version**
   ```bash
   npm view @divinci-ai/cli version
   npx @divinci-ai/cli@latest --version
   ```

## Emergency unpublish or deprecate

npm allows unpublishing a version **within 72 hours** of publishing. Beyond
that, npm rejects unpublish requests and the only remedy is to `deprecate`:

```bash
# Within 72h — actually removes the version
npm unpublish @divinci-ai/cli@X.Y.Z

# After 72h — leaves the version installable but shows a warning on install
npm deprecate @divinci-ai/cli@X.Y.Z "Critical bug — upgrade to X.Y.(Z+1)"
```

Then ship a fix release immediately via the normal flow. Do not leave users
running a known-broken version.

If a published version contains secrets, **rotate the secrets first** (they
are now in the public npm cache and cannot be retrieved). Unpublishing does
not evict the package from npm's CDN mirrors for some time.

## Security audit gate reference

The `sdk-drift-and-audit.yml` workflow runs three checks on every PR, all
blocking:

| Check | What it catches |
|---|---|
| CLI spec drift | Stale `cli-commands.json` that doesn't match the source |
| `pnpm audit --audit-level high --prod` | Known CVEs in runtime deps |
| Semgrep SAST (`p/typescript`, `p/security-audit`, `p/nodejs`) | eval, shell injection, hardcoded secrets, common anti-patterns |

### Documented audit exceptions

Every `--ignore <CVE>` in `sdk-drift-and-audit.yml` must be paired with a
machine-readable `# revisit-by: YYYY-MM-DD` marker on the same line. A CI
step scans the workflow for expired markers and fails the audit job when
any are in the past, so exceptions can't quietly become permanent fixtures.

**Currently no active exceptions.** The previous astro SSR XSS exception
(GHSA-wrwg-2hg8-v723) was retired on 2026-04-09 by upgrading astro 4.x
→ 6.x in `workspace/sdk/docs` as part of the security triage round.

When a revisit-by date is reached, CI fails with a clear message. Either:

1. Fix the underlying CVE (e.g., bump astro) and delete the `--ignore`
   line entirely, OR
2. Reassess the exception, update the `revisit-by` date to a new future
   date with fresh justification here.

Option 1 is always preferred. Option 2 is how you explicitly acknowledge
that the debt is being deferred, and is visible in the git history the
next time someone looks.
