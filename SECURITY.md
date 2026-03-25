# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | Yes                |
| < 0.2   | No                 |

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/AnsoCode/Sencho/security) of this repository
2. Click **"Report a vulnerability"**
3. Provide details including: steps to reproduce, impact assessment, and any suggested fixes

You can expect an initial response within 72 hours. We will work with you to understand and address the issue before any public disclosure.

## Security Considerations

Sencho manages Docker containers and has access to the Docker socket. When deploying:

- Always run behind a reverse proxy with TLS in production
- Use strong passwords and rotate JWT secrets
- Restrict network access to the Sencho port
- Review the [security configuration docs](https://docs.sencho.io) for hardening guidance
