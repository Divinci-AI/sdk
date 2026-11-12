# Changesets

This folder contains changesets - files that describe a change to the packages in this monorepo.

## Adding a Changeset

To add a changeset, run:

```bash
pnpm changeset
```

This will prompt you to:
1. Select which packages have changed
2. Choose the type of change (major, minor, patch)
3. Write a summary of the change

## Changeset Types

- **major**: Breaking changes
- **minor**: New features (backwards compatible)
- **patch**: Bug fixes (backwards compatible)

## Release Process

1. Merge PRs with changesets into `preview` (this repo's main branch)
2. The release workflow (`.github/workflows/sdk-release.yml`) opens a "Version Packages" PR that bumps package versions, updates CHANGELOG entries, and regenerates `cli-commands.json`
3. A maintainer reviews the Version PR
4. Merging the Version PR triggers the publish job, which runs the security audit gate and then `pnpm changeset publish`

See `packages/cli/RELEASING.md` for the full runbook, including prerequisites
(NPM_TOKEN secret, npm organization membership) and the manual fallback if the
workflow needs to be bypassed.

## More Information

See [changesets documentation](https://github.com/changesets/changesets) for more details.
