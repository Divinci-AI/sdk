# Contributing to Divinci AI SDK

Thank you for your interest in contributing to the Divinci AI SDK! This document provides guidelines and instructions for contributing.

## How this repository works

This repository is a **mirror**. The source of truth is Divinci's internal
monorepo, and `scripts/oss/export-sdk.py` there publishes it here. So:

- Open issues and pull requests here as usual.
- A maintainer reviews your pull request and applies it to the monorepo, with
  you credited as the commit author (`Co-authored-by`). The next sync carries it
  back, and we then close your pull request with a link to the commit.
- Releases to npm are cut from the monorepo, so a merged change is published in
  the next release rather than immediately.
- A few tests check contracts against server source that is not in this
  repository. They skip here, on the `.oss-mirror` marker, and run internally.

## Getting Started

### Prerequisites

- Node.js >= 22.14.0
- pnpm >= 10

### Setup

```bash
# Clone the repository
git clone https://github.com/Divinci-AI/sdk.git
cd sdk

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Development Workflow

### Branch Naming

- `feat/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring
- `test/description` - Test additions or fixes

### Making Changes

1. Create a new branch from `main`
2. Make your changes
3. Add or update tests as needed
4. Run `pnpm test` to ensure all tests pass
5. Run `pnpm typecheck` to ensure type safety
6. Run `pnpm lint` to check code style
7. Commit your changes with a descriptive message

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Code style (formatting, semicolons, etc.)
- `refactor` - Code change that neither fixes a bug nor adds a feature
- `test` - Adding or updating tests
- `chore` - Maintenance tasks

Examples:
```
feat(client): add streaming support for chat messages
fix(server): handle timeout errors in workspace API
docs(readme): update installation instructions
```

### Pull Requests

1. Update your branch with the latest `main`
2. Push your branch to GitHub
3. Open a Pull Request
4. Fill out the PR template
5. Wait for review

#### PR Requirements

- All tests must pass
- TypeScript must compile without errors
- Code must pass linting
- Changes must be documented if applicable
- Breaking changes must be noted

## Project Structure

```
sdk/
├── packages/
│   ├── client/     # @divinci-ai/client - Browser SDK
│   ├── server/     # @divinci-ai/server - Node.js SDK
│   ├── mcp/        # @divinci-ai/mcp - MCP Protocol SDK
│   └── types/      # @divinci-ai/types - Shared types
├── docs/           # Documentation website
├── examples/       # Example applications
└── scripts/        # Build and release scripts
```

## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @divinci-ai/client test

# Run tests with coverage
pnpm test:coverage

# Run tests in watch mode
pnpm --filter @divinci-ai/client test -- --watch
```

### Writing Tests

- Place tests in `__tests__/` directories or alongside source files with `.test.ts` extension
- Use descriptive test names
- Test both success and error cases
- Mock external dependencies

## Documentation

### Code Documentation

- Add JSDoc comments to public APIs
- Include examples in documentation
- Keep documentation up to date with code changes

### Updating Docs Website

Documentation lives in `docs/` and uses Astro + Starlight:

```bash
cd docs
pnpm dev    # Start dev server
pnpm build  # Build for production
```

## Releasing

Releases are managed through changesets:

```bash
# Create a changeset
pnpm changeset

# Version packages (CI only)
pnpm changeset version

# Publish packages (CI only)
pnpm changeset publish
```

## Code Style

- Use TypeScript for all code
- Use double quotes for strings
- Use semicolons
- Use camelCase for variables and functions
- Use PascalCase for classes and types
- Prefer arrow functions
- Use strict equality (`===`)

## Getting Help

- Open an issue for bugs or feature requests
- Join our Discord for questions
- Check existing issues before creating new ones

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
