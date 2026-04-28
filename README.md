# Sencho

[![Docker Hub](https://img.shields.io/docker/v/saelix/sencho?sort=semver&label=Docker%20Hub)](https://hub.docker.com/r/saelix/sencho)
[![Docker Pulls](https://img.shields.io/docker/pulls/saelix/sencho)](https://hub.docker.com/r/saelix/sencho)
[![License](https://img.shields.io/badge/license-BSL--1.1-blue)](#license)

Self-hosted Docker Compose management with self-healing infrastructure, atomic deployments, and multi-network fleet control. Built for engineers who want Kubernetes-grade reliability without the complexity.

![Sencho Dashboard](docs/images/dashboard.png?v=2)

---

## Why Sencho?

**Works across every network**

Pilot Agent tunnels through NAT and firewalls so every node in your fleet is reachable from the dashboard, regardless of network topology. No port-forwarding. No VPN. No SSH.

**Containers crash. Sencho fixes them.**

Auto-heal policies watch your stacks and take action (restart, redeploy, notify) before you even open your laptop. Define the rules once; the recovery runs itself.

**Deploy safely without Kubernetes**

Atomic deployments mean a failed stack never leaves you in a broken half-up state. Rollback is one click. Deploy enforcement policies block non-compliant images before they ever run.

**Define behavior, not procedures**

Auto-update policies, scheduled operations, webhooks, and deploy enforcement let you codify how your infrastructure behaves. The UI is for oversight; the engine runs the work.

---

## Features

### Stack Management
- Monaco editor with syntax highlighting and multi-file support
- Atomic deployments with live progress tracking and one-click rollback
- Git-sourced stacks: pull and sync from any repository
- Stack file explorer and label management

### Monitoring & Observability
- Live log streaming with search and filtering across all containers
- CPU, RAM, and disk threshold alerts with configurable actions
- Container stats, health checks, and image update notifications
- Global observability view across all nodes in your fleet

### Fleet Management
- Multi-node via authenticated HTTP/WebSocket proxy (no SSH, no remote socket)
- Fleet view and sync for coordinated updates across nodes
- Pilot Agent for NAT traversal and firewall-crossing connections
- Node compatibility checks before deploying

### Automation
- Auto-heal policies: detect and recover from container failures automatically
- Auto-update policies: roll out new image versions on your terms
- Scheduled operations with cron expressions
- Webhooks and deploy enforcement rules

### Security
- SSO: custom OIDC (any spec-compliant provider), Google/GitHub/Okta presets, LDAP/Active Directory
- Two-factor authentication and RBAC with deployer, node-admin, and auditor roles
- Audit log, vulnerability scanning with VEX suppression, and private registry support
- Deploy enforcement to block non-compliant images

### Operations
- App Store with one-click LinuxServer.io template deployments
- Sencho Cloud Backup for off-site stack archives
- Notification routing to Slack, Discord, email, and webhooks
- Global search across stacks and containers

---

## Architecture

Sencho's architecture combines a **Distributed API model** with an optional **Pilot Agent** for complex networks.

- **Distributed API:** Remote nodes are managed by proxying authenticated HTTP/WebSocket requests to autonomous Sencho instances running on each server. No SSH. No remote Docker socket exposure. No polling agent. Each node speaks the same Sencho API, so the dashboard is just another client.
- **Pilot Agent:** For nodes behind NAT or strict firewalls, the Pilot Agent establishes secure outbound tunnels to the primary dashboard instance. This guarantees full fleet visibility and management without requiring port-forwarding, VPNs, or inbound network access.

---

## Quick Start

**Docker run (quickest):**

```bash
docker run -d --name sencho \
  -p 1852:1852 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v sencho_data:/app/data \
  -e COMPOSE_DIR=/opt/docker \
  saelix/sencho:latest
```

**Docker Compose (recommended for production):**

```yaml
services:
  sencho:
    image: saelix/sencho:latest
    container_name: sencho
    restart: unless-stopped
    ports:
      - "1852:1852"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/app/data
      # 1:1 Compose Path Rule: the host path MUST match the container path
      - /opt/docker:/opt/docker
    environment:
      - COMPOSE_DIR=/opt/docker
      - DATA_DIR=/app/data
```

```bash
docker compose up -d
```

Then open `http://your-server:1852` and create your admin account.

See the [full documentation](https://docs.sencho.io) for configuration details, multi-node setup, and more.

---

## Tiers

| | Community | Skipper | Admiral |
|---|---|---|---|
| **Nodes** | Unlimited | Unlimited | Unlimited |
| Stack management, logs, alerts, app store | All | All | All |
| Two-factor authentication | Yes | Yes | Yes |
| SSO (custom OIDC) | Yes | Yes | Yes |
| Atomic deployments and auto-update policies | No | Yes | Yes |
| Fleet view, sync, and Sencho Cloud Backup | No | Yes | Yes |
| SSO (Google, GitHub, Okta presets) | No | Yes | Yes |
| RBAC, audit log, and host console | No | No | Yes |
| SSO (LDAP / Active Directory) | No | No | Yes |
| API tokens, private registries, notification routing | No | No | Yes |
| Scheduled operations | No | No | Yes |

Full tier comparison and pricing at [docs.sencho.io/features/licensing](https://docs.sencho.io/features/licensing). Lifetime licenses available for a limited time.

---

## Documentation

- [Quick Start](https://docs.sencho.io/getting-started/quickstart)
- [Multi-Node Setup](https://docs.sencho.io/features/multi-node)
- [App Store](https://docs.sencho.io/features/app-store)
- [Security Hardening](https://docs.sencho.io/security)
- [Full Documentation](https://docs.sencho.io)

---

## Development

```bash
# Backend (Express + TypeScript)
cd backend && npm install && npm run dev

# Frontend (React + Vite)
cd frontend && npm install && npm run dev
```

The frontend dev server proxies `/api` requests to the backend on port 1852.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and PR guidelines.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting. **Do not open public issues for security vulnerabilities.**

## License

Sencho is licensed under the [Business Source License 1.1](LICENSE). Production use is allowed; the only restriction is offering Sencho as a competing hosted or managed service. On **2030-03-25**, the license automatically converts to [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0).
