# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

We take the security of the Divinci AI SDK seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please send an email to security@divinci.app with:

1. Description of the vulnerability
2. Steps to reproduce the issue
3. Potential impact
4. Any suggested fixes (optional)

### What to Expect

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Timeline**: Depends on severity

### Disclosure Policy

- We will acknowledge receipt of your report
- We will confirm the vulnerability and determine its impact
- We will release a fix as soon as possible, depending on complexity
- We will publicly acknowledge your responsible disclosure (unless you prefer to remain anonymous)

## Security Best Practices

When using the Divinci AI SDK:

### API Keys

- Never commit API keys to source control
- Use environment variables for sensitive configuration
- Rotate API keys periodically
- Use separate keys for development and production

### Client SDK

- Always use HTTPS endpoints
- Validate and sanitize user inputs before sending to the API
- Implement proper error handling to avoid exposing sensitive information

### Server SDK

- Store API keys securely (environment variables, secrets manager)
- Implement rate limiting on your endpoints
- Log security-relevant events
- Keep dependencies up to date

## Dependencies

We regularly update dependencies to address known vulnerabilities. You can check for outdated dependencies with:

```bash
pnpm outdated
```

## Security Updates

Security updates will be released as patch versions and announced through:

- GitHub Security Advisories
- Release notes
- npm package updates

Subscribe to repository notifications to stay informed about security updates.
