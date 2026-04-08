# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x+  | Yes                |
| < 0.2   | No                 |

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

You can report security issues in two ways:

1. **Email:** Send details to **security@sencho.io**
2. **GitHub:** Use [private vulnerability reporting](https://github.com/AnsoCode/Sencho/security/advisories/new) in the Security tab

In your report, include: steps to reproduce, impact assessment, and any suggested fixes.

You can expect an initial response within 72 hours. We will work with you to understand and address the issue before any public disclosure.

## Security Considerations

Sencho manages Docker containers and has access to the Docker socket. When deploying:

- Always run behind a reverse proxy with TLS in production
- Use strong passwords and rotate JWT secrets
- Restrict network access to the Sencho port
- Review the [security configuration docs](https://docs.sencho.io) for hardening guidance
