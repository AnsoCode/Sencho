# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

* **resources:** Docker network management — create, inspect, and delete networks from the UI
* **resources:** Network inspect panel showing IPAM config, connected containers with IPs/MACs, and labels
* **resources:** Network creation dialog with driver, subnet, gateway, internal, and attachable options
* **resources:** Network topology visualization (Pro) — interactive graph of networks and connected containers using React Flow
* **resources:** List/Topology view toggle on the Networks tab

### Fixed

* **resources:** Network topology now correctly classifies networks as managed/unmanaged/system instead of showing all as unmanaged
* **resources:** Network inspect returns proper 404 status when a network no longer exists instead of generic 500
* **resources:** Network create route validates driver against allowed values and rejects array-typed labels
* **resources:** Replaced all `any` types in network routes with proper `unknown` narrowing

## [0.26.0](https://github.com/AnsoCode/Sencho/compare/v0.25.3...v0.26.0) (2026-04-02)


### Added

* **stack-management:** add scan stacks folder button ([#332](https://github.com/AnsoCode/Sencho/issues/332)) ([6f74153](https://github.com/AnsoCode/Sencho/commit/6f7415351f648120ab4039f1fcc9a1226cfa52f4))

## [0.25.3](https://github.com/AnsoCode/Sencho/compare/v0.25.2...v0.25.3) (2026-04-02)


### Fixed

* **error-handling:** surface silent errors across the codebase ([#326](https://github.com/AnsoCode/Sencho/issues/326)) ([10597d2](https://github.com/AnsoCode/Sencho/commit/10597d213a5dfdc47dddd53998336fb09889962b))

## [0.25.2](https://github.com/AnsoCode/Sencho/compare/v0.25.1...v0.25.2) (2026-04-02)


### Fixed

* **security:** harden encryption key permissions, increase password minimum, remove sensitive logs ([#323](https://github.com/AnsoCode/Sencho/issues/323)) ([f317a83](https://github.com/AnsoCode/Sencho/commit/f317a83814fda3a98eb009c1a05a955bfadd6f0d))

## [0.25.1](https://github.com/AnsoCode/Sencho/compare/v0.25.0...v0.25.1) (2026-04-02)


### Fixed

* **security:** pre-launch security hardening audit & remediation ([#320](https://github.com/AnsoCode/Sencho/issues/320)) ([2d6b4c2](https://github.com/AnsoCode/Sencho/commit/2d6b4c233daa178de485dfeb198fc90376949ca4))

## [Unreleased]

### Added

* **stack-management:** scan stacks folder button to detect and import manually-placed compose files

### Docs

* **quickstart:** fix Cyrillic character in Docker image reference and correct registry from GHCR to Docker Hub (`saelix/sencho`)
* **backup:** correct WAL mode references — Sencho uses SQLite default journal mode, not WAL
* **configuration:** add SSL/TLS examples for Nginx and Traefik reverse proxies, add Caddy configuration
* **env:** add missing `PORT`, `DATA_DIR`, `NODE_ENV`, `FRONTEND_URL`, `SSO_LDAP_DISPLAY_NAME` to `.env.example`
* **operations:** add upgrade & migration guide, self-hosting best practices page
* **reference:** add architecture overview and development/contributor guide
* **openapi:** update spec from v0.23.0 to v0.25.3, add Registries and Image Updates endpoint groups

### Fixed

* **error-handling:** surface silent errors across the codebase — added `console.warn`/`console.error` logging to 22 silent catch blocks across 10 files (services, index.ts, frontend Login). Errors in cleanup, migrations, SSO, fleet snapshots, shutdown, and validation are now visible in logs without changing any control flow. ENOENT guards added to file-system catches to distinguish missing files from permission errors.
* **security:** self-heal encryption key file permissions on startup — verifies `0600` and corrects if permissive; Docker entrypoint also enforces `chmod 600` before privilege drop
* **security:** increase minimum password length from 6 to 8 characters (NIST SP 800-63B) — applies to setup, password change, and user management; existing short passwords remain valid until changed
* **security:** remove sensitive data from console output — file paths, `.env` locations, stack names, and admin usernames no longer logged to stdout
* **security:** use raw request bytes for webhook HMAC signature verification instead of re-serialized JSON — prevents signature mismatches from serialization differences
* **security:** use NIST-recommended 12-byte IV for AES-256-GCM encryption (backward compatible with existing 16-byte IVs)
* **security:** add 1-year default expiry to node proxy JWT tokens — previously issued without expiry
* **security:** pattern-based env var filtering in host console — blocks variables containing SECRET, PASSWORD, TOKEN, KEY, or CREDENTIAL (previously only filtered 4 explicit keys)
* **security:** deny CORS when `FRONTEND_URL` is unset in production — previously fell back to allowing all origins

## [0.25.0](https://github.com/AnsoCode/Sencho/compare/v0.24.2...v0.25.0) (2026-04-02)


### Added

* **api:** add global rate limiter for all API endpoints ([#317](https://github.com/AnsoCode/Sencho/issues/317)) ([b28ebfa](https://github.com/AnsoCode/Sencho/commit/b28ebfa6ffff7fa76657c67e5fdb3494a76bd8a1))

## [0.24.2](https://github.com/AnsoCode/Sencho/compare/v0.24.1...v0.24.2) (2026-04-01)


### Fixed

* **security:** enforce stack name validation on all routes ([#314](https://github.com/AnsoCode/Sencho/issues/314)) ([1ab04be](https://github.com/AnsoCode/Sencho/commit/1ab04be235cc0d3020d17dfb3028e4679206b886))

## [0.24.1](https://github.com/AnsoCode/Sencho/compare/v0.24.0...v0.24.1) (2026-04-01)


### Fixed

* **security:** prevent path traversal via env_file resolution ([#311](https://github.com/AnsoCode/Sencho/issues/311)) ([dc545dd](https://github.com/AnsoCode/Sencho/commit/dc545dd61337904e26e18e5e5bed190675432406))

## [0.24.0](https://github.com/AnsoCode/Sencho/compare/v0.23.0...v0.24.0) (2026-04-01)


### Added

* **auto-update:** add auto-update policies and fix image update detection ([#297](https://github.com/AnsoCode/Sencho/issues/297)) ([28c7a8f](https://github.com/AnsoCode/Sencho/commit/28c7a8fd544f33ea0fbe90f19ed96154743eb527))

## [Unreleased]

### Added

* **auto-update:** Auto-Update Policies — schedule automatic image checks and container updates per stack (Skipper & Admiral)
* **auto-update:** Dedicated Auto-Update Policies view with create/edit dialog, cron presets, run history, and manual trigger
* **auto-update:** Extends the existing SchedulerService with a new `update` action type, reusing cron scheduling and run history infrastructure
* **docs:** Auto-Update Policies feature documentation page
* **docs:** OpenAPI 3.1 spec covering ~55 public API endpoints across 8 categories (Stacks, Containers, API Tokens, Webhooks, Nodes, Fleet, Scheduled Tasks, Health)
* **docs:** Interactive API Reference tab in Mintlify documentation powered by native OpenAPI rendering
* **docs:** API overview page with authentication guide, token scopes, node routing, error format, and WebSocket examples

### Fixed

* **image-updates:** Fix stack name key mismatch — use `com.docker.compose.project.working_dir` label instead of `com.docker.compose.project` so update indicators work when compose files set `name:`
* **image-updates:** Add 5-minute periodic polling so background check results are picked up without manual refresh
* **image-updates:** Replace fixed 3-second timeout with polling-based refresh that waits for the check to complete (up to 60s)
* **image-updates:** Clear update status (blue dot) after a stack is updated via the UI

## [0.23.0](https://github.com/AnsoCode/Sencho/compare/v0.22.1...v0.23.0) (2026-03-31)


### Added

* **multi-node:** warn when configuring remote node with plain HTTP URL ([#292](https://github.com/AnsoCode/Sencho/issues/292)) ([e587256](https://github.com/AnsoCode/Sencho/commit/e587256086997a784007a69d8a7fd56881d0a9b1))

## [0.22.1](https://github.com/AnsoCode/Sencho/compare/v0.22.0...v0.22.1) (2026-03-31)


### Fixed

* **fleet:** navigate to editor instead of dashboard on "Open in Editor" click ([#289](https://github.com/AnsoCode/Sencho/issues/289)) ([71ce6b3](https://github.com/AnsoCode/Sencho/commit/71ce6b3e1b6cb974d44279e503f9a158d027555a))

## [0.22.0](https://github.com/AnsoCode/Sencho/compare/v0.21.2...v0.22.0) (2026-03-31)


### Added

* **scheduled-ops:** add failure notifications, granular targeting, and history export ([#286](https://github.com/AnsoCode/Sencho/issues/286)) ([eccdd1b](https://github.com/AnsoCode/Sencho/commit/eccdd1b87903c17af822edb0cdb4236812929bd2))

## [0.21.2](https://github.com/AnsoCode/Sencho/compare/v0.21.1...v0.21.2) (2026-03-30)


### Fixed

* **docker:** upgrade Compose v2.40.3 → v5.1.1 to remediate dependency CVEs ([#283](https://github.com/AnsoCode/Sencho/issues/283)) ([36ebd5a](https://github.com/AnsoCode/Sencho/commit/36ebd5a9c1c82b5d7631d32831ac8ac420b0c782))

## [Unreleased]

### Added

* **scheduled-ops:** failure notifications — dispatches error alerts through configured notification channels (Discord, Slack, webhook) when a scheduled task fails, with info-level recovery notifications when a previously-failing task succeeds again
* **scheduled-ops:** per-service restart targeting — scheduled stack restarts can now target specific services rather than restarting the entire stack
* **scheduled-ops:** prune label filter — scheduled system prune operations can be scoped to resources matching a specific Docker label (e.g. `com.docker.compose.project=mystack`)
* **scheduled-ops:** CSV export for execution history — one-click download of the full run history from the execution history panel

### Changed

* **multi-node:** show inline warning when configuring a remote node with an HTTP URL — recommends HTTPS or VPN for public internet connections; HTTP remains fully supported for private networks

### Fixed

* **fleet:** "Open in Editor" button in Fleet View's stack drill-down now correctly navigates to the stack editor instead of the dashboard. Also passes the stack name through the callback chain so the correct file is loaded.
* **scheduled-ops:** `prune_targets` field was silently dropped when creating scheduled tasks due to missing column in the INSERT statement

### Security

* **docker:** upgrade Docker Compose from v2.40.3 to v5.1.1 to remediate 5 Go stdlib/x/crypto CVEs (CVE-2025-68121, CVE-2025-61726, CVE-2025-61729, CVE-2026-25679, CVE-2025-47913). Compose v2.40.3 was compiled with Go 1.24.9 and x/crypto 0.38.0; v5.1.1 ships Go 1.25.8 and x/crypto 0.46.0. Docker CLI remains at v29.3.1 (already patched). CVE-2026-33186 (grpc ≥1.79.3) cannot be resolved until upstream Docker/Compose releases upgrade past grpc 1.78.0.

## [0.21.1](https://github.com/AnsoCode/Sencho/compare/v0.21.0...v0.21.1) (2026-03-30)


### Fixed

* **ui:** settings modal sidebar nav clipped on smaller viewports ([#280](https://github.com/AnsoCode/Sencho/issues/280)) ([9e14ce9](https://github.com/AnsoCode/Sencho/commit/9e14ce999f89052b218d2e3f974644f41355955c))

## [0.21.0](https://github.com/AnsoCode/Sencho/compare/v0.20.0...v0.21.0) (2026-03-30)


### Added

* **host-console:** gate Host Console behind Admiral tier ([#277](https://github.com/AnsoCode/Sencho/issues/277)) ([b5d3f49](https://github.com/AnsoCode/Sencho/commit/b5d3f497cb1a09fdc2107f4ef720ebb7f07cbd87))

## [0.20.0](https://github.com/AnsoCode/Sencho/compare/v0.19.4...v0.20.0) (2026-03-30)


### Added

* **ui:** glassmorphism redesign with settings decomposition ([#274](https://github.com/AnsoCode/Sencho/issues/274)) ([7637091](https://github.com/AnsoCode/Sencho/commit/7637091e84838047c462e3dbce38122d4c24d007))

## [0.19.4](https://github.com/AnsoCode/Sencho/compare/v0.19.3...v0.19.4) (2026-03-30)


### Fixed

* **stacks:** avoid resource busy error in Docker fallback deletion ([#271](https://github.com/AnsoCode/Sencho/issues/271)) ([10d1636](https://github.com/AnsoCode/Sencho/commit/10d16361fae2869367a9f757bfc0ab4c3e04ca2c))

## [0.19.3](https://github.com/AnsoCode/Sencho/compare/v0.19.2...v0.19.3) (2026-03-30)


### Fixed

* **docker:** install Docker CLI v29.3.1 from static binaries to resolve CVEs ([#268](https://github.com/AnsoCode/Sencho/issues/268)) ([f9b86e6](https://github.com/AnsoCode/Sencho/commit/f9b86e6f53e83ea0b5e8de7c1c916196d3345aee))

## [0.19.2](https://github.com/AnsoCode/Sencho/compare/v0.19.1...v0.19.2) (2026-03-30)


### Fixed

* remediate Dependabot and Docker Scout security vulnerabilities ([#265](https://github.com/AnsoCode/Sencho/issues/265)) ([59fd528](https://github.com/AnsoCode/Sencho/commit/59fd5285351c14f6e9cde073bd983de073fa3a75))

## [0.19.1](https://github.com/AnsoCode/Sencho/compare/v0.19.0...v0.19.1) (2026-03-30)


### Fixed

* **stacks:** resolve permission denied error on stack deletion ([#261](https://github.com/AnsoCode/Sencho/issues/261)) ([116f15d](https://github.com/AnsoCode/Sencho/commit/116f15dae9c3b530145316ea8b2954ed478fed76))

## [Unreleased]

### Changed

* **host-console:** moved Host Console from Community tier to Admiral tier. The interactive host terminal now requires a Sencho Admiral license — enforced in the UI (nav item hidden, AdmiralGate upgrade prompt), the REST API (`POST /api/system/console-token` returns 403), and the WebSocket upgrade handler (`/api/system/host-console` rejects connections). Community and Skipper users see an upgrade prompt.

### Security

* **docker:** upgrade base image from `node:20-alpine` to `node:22-alpine` (Node 22.22.2 on Alpine 3.23.3) to remediate 31 CVEs (1 Critical, multiple High/Medium/Low) flagged by Docker Scout against the previous `node:20-alpine` base.
* **docker:** add `apk upgrade --no-cache` to runtime stage to ensure all Alpine system packages are at their latest patched versions at build time.
* **deps:** force `dompurify` to 3.3.3 via npm overrides to resolve two Dependabot advisories (Mutation-XSS via Re-Contextualization and Cross-site Scripting) in the transitive dependency pulled by `monaco-editor`.
* **docker:** install Docker CLI v29.3.1 and Compose v2.40.3 from official static binaries instead of Alpine packages (which ship v29.1.3) to resolve CVE-2026-33186 (Critical), CVE-2026-34040 (High), CVE-2026-33747 (High), CVE-2026-33748 (High), and bundled Go stdlib CVEs.

### Fixed

* **stacks:** resolve permission denied error when deleting stacks with root-owned files. Sencho now falls back to Docker-based cleanup when the normal deletion fails due to EACCES/EPERM, handling directories created by Docker Compose as root without requiring elevated privileges.
* **stacks:** `docker compose down` during stack deletion now includes `--volumes --remove-orphans` to let Docker clean up its own resources before filesystem removal.

## [0.19.0](https://github.com/AnsoCode/Sencho/compare/v0.18.0...v0.19.0) (2026-03-30)


### Added

* **audit-log:** add configurable retention, export, Auditor role, and enhanced filtering ([#258](https://github.com/AnsoCode/Sencho/issues/258)) ([d586ce3](https://github.com/AnsoCode/Sencho/commit/d586ce393af34c8cc34cd046d2d90a70e0d79964))

## [0.18.0](https://github.com/AnsoCode/Sencho/compare/v0.17.0...v0.18.0) (2026-03-29)


### Added

* **rbac:** add Deployer & Node Admin roles with scoped permissions (Team Pro) ([#253](https://github.com/AnsoCode/Sencho/issues/253)) ([8380fba](https://github.com/AnsoCode/Sencho/commit/8380fbad4b617b004e2d2f19595d1490eaa1e005))

## [Unreleased]

### Added

* **audit-log:** configurable retention period (1–365 days) via Settings → Developer → Data Retention, replacing the hardcoded 90-day limit
* **audit-log:** one-click CSV and JSON export of the currently filtered audit log dataset (capped at 10,000 entries)
* **rbac:** new Auditor role — read-only access to the audit log with no administrative privileges, ideal for compliance officers and security reviewers
* **audit-log:** full-text search across action summaries, API paths, and usernames
* **audit-log:** date range filter with From/To date pickers in the UI
* **audit-log:** expandable row details showing full request path, IP address, node ID, and entry ID

* **rbac:** introduce Deployer and Node Admin intermediate roles with scoped permissions (Team Pro)
  - Deployer role: can deploy, restart, stop, and start stacks but cannot edit compose files, delete stacks, or access system settings
  - Node Admin role: full stack and node management but no system settings, user management, or license access
  - Scoped permissions: assign roles per stack or per node for fine-grained access control
  - Permission matrix engine with `checkPermission()` for consistent backend enforcement
  - Frontend `can()` function in AuthContext for consistent UI guards
  - New API endpoints: `GET/POST/DELETE /api/users/:id/roles` for managing scoped assignments
  - New API endpoint: `GET /api/permissions/me` for fetching effective permissions
  - Gated to Team Pro tier — Community and Personal Pro retain binary Admin/Viewer roles

## [0.17.0](https://github.com/AnsoCode/Sencho/compare/v0.16.0...v0.17.0) (2026-03-29)


### Added

* **registries:** add private registry credential management (Team Pro) ([#240](https://github.com/AnsoCode/Sencho/issues/240)) ([244c83a](https://github.com/AnsoCode/Sencho/commit/244c83a0c3102a797658d35d087bf47366f6df75))

## [0.16.0](https://github.com/AnsoCode/Sencho/compare/v0.15.1...v0.16.0) (2026-03-29)


### Added

* **ui:** redesign top bar with three-zone navigation layout ([#237](https://github.com/AnsoCode/Sencho/issues/237)) ([b7e7ee8](https://github.com/AnsoCode/Sencho/commit/b7e7ee8f55ec6bf89acc7bb54d47eab12ac940c5))

## [0.15.1](https://github.com/AnsoCode/Sencho/compare/v0.15.0...v0.15.1) (2026-03-29)


### Fixed

* **scheduled-ops:** audit log text, run attribution, prune targets, and pagination ([#234](https://github.com/AnsoCode/Sencho/issues/234)) ([330eec4](https://github.com/AnsoCode/Sencho/commit/330eec4bff6f194aafdcbe499ab893bef06254b6))

## [0.15.0](https://github.com/AnsoCode/Sencho/compare/v0.14.2...v0.15.0) (2026-03-29)


### Added

* **scheduled-ops:** add scheduled operations for Team Pro users ([#231](https://github.com/AnsoCode/Sencho/issues/231)) ([31e1795](https://github.com/AnsoCode/Sencho/commit/31e1795af06beaa68ec6e2240d83b7656ab549f7))

## [Unreleased]

### Added

* **registries:** add private registry credential management (Team Pro). Store encrypted credentials for Docker Hub, GHCR, AWS ECR, and self-hosted registries. Credentials are automatically injected during deploy/pull via temporary DOCKER_CONFIG. ECR short-lived tokens are refreshed on every operation. Image update checks now authenticate against private registries.

### Changed

* **ui:** redesign top bar into three-zone layout — node pill (left), animated navigation group (center), utilities (right). Replaces flat row of individual buttons with a cohesive tab-style navigation using animated sliding highlight. Includes responsive behavior: icon+text at xl, icons-only at md, sheet drawer on mobile.

### Fixed

* **scheduled-ops:** fix "Run Now" audit log entry incorrectly showing "Created scheduled task" instead of "Triggered scheduled task"
* **scheduled-ops:** add `triggered_by` attribution to run records distinguishing scheduler vs manual executions
* **scheduled-ops:** add pagination to execution history view
* **scheduled-ops:** make system prune targets configurable (containers, images, networks, volumes)

### Docs

* **scheduled-ops:** add screenshots and document Run Now behavior for disabled tasks
* **settings:** fix settings reference to correctly describe profile dropdown access

## [0.14.2](https://github.com/AnsoCode/Sencho/compare/v0.14.1...v0.14.2) (2026-03-29)


### Fixed

* **api-tokens:** harden scope enforcement and block sensitive endpoints ([#228](https://github.com/AnsoCode/Sencho/issues/228)) ([5b607de](https://github.com/AnsoCode/Sencho/commit/5b607de227eecf4000208b347d8157f2d5d94651))

## [0.14.1](https://github.com/AnsoCode/Sencho/compare/v0.14.0...v0.14.1) (2026-03-28)


### Fixed

* **api-tokens:** harden scope enforcement and add expiration support ([#224](https://github.com/AnsoCode/Sencho/issues/224)) ([954994c](https://github.com/AnsoCode/Sencho/commit/954994cdc01e5cee3e65153c2a302afed2da2b44))

## [Unreleased]

### Fixed

* **api-tokens:** harden scope enforcement - fix deploy-only allowlist to match actual routes, add WebSocket scope gating, block API tokens from all sensitive management endpoints (user management, SSO configuration, node management, license management, console access, password change, node-token generation, and token self-management), add configurable expiration support (30/60/90/365 days)

## [0.14.0](https://github.com/AnsoCode/Sencho/compare/v0.13.2...v0.14.0) (2026-03-28)


### Added

* **api-tokens:** add scoped API tokens for CI/CD automation (Team Pro) ([#220](https://github.com/AnsoCode/Sencho/issues/220)) ([8d8118c](https://github.com/AnsoCode/Sencho/commit/8d8118c963a1c3b10872041ea0f645d8f0a65196))

## [0.13.2](https://github.com/AnsoCode/Sencho/compare/v0.13.1...v0.13.2) (2026-03-28)


### Fixed

* **license:** default 14-day trial to Personal Pro instead of Team Pro ([#216](https://github.com/AnsoCode/Sencho/issues/216)) ([f99abe9](https://github.com/AnsoCode/Sencho/commit/f99abe907d5a39f4f32fb08bf25eda9b00dae88b))

## [0.13.1](https://github.com/AnsoCode/Sencho/compare/v0.13.0...v0.13.1) (2026-03-28)


### Fixed

* gate SSO and Audit behind Team Pro license tier ([#213](https://github.com/AnsoCode/Sencho/issues/213)) ([8d48b0a](https://github.com/AnsoCode/Sencho/commit/8d48b0abff08195a436f98bf8d42c45de51930df))

## [0.13.0](https://github.com/AnsoCode/Sencho/compare/v0.12.0...v0.13.0) (2026-03-28)


### Added

* SSO & LDAP authentication for Team Pro ([#209](https://github.com/AnsoCode/Sencho/issues/209)) ([bd4008f](https://github.com/AnsoCode/Sencho/commit/bd4008f5091122f74967b4debdd4c4f046693f46))

## [0.12.0](https://github.com/AnsoCode/Sencho/compare/v0.11.0...v0.12.0) (2026-03-28)


### Added

* audit logging, secrets at rest, and legacy cleanup ([#205](https://github.com/AnsoCode/Sencho/issues/205)) ([1799030](https://github.com/AnsoCode/Sencho/commit/179903006035280d5c1655daaf3dbe3384588bf0))

## [0.11.0](https://github.com/AnsoCode/Sencho/compare/v0.10.0...v0.11.0) (2026-03-28)


### Added

* **settings:** replace static license CTA with dynamic upgrade cards ([#201](https://github.com/AnsoCode/Sencho/issues/201)) ([d3828e8](https://github.com/AnsoCode/Sencho/commit/d3828e885d78b23902a3a82186dcd009e3f2c0d9))

## [0.10.0](https://github.com/AnsoCode/Sencho/compare/v0.9.0...v0.10.0) (2026-03-27)


### Added

* stack context menu, tier icons, centered logo & support ([#194](https://github.com/AnsoCode/Sencho/issues/194)) ([dda1671](https://github.com/AnsoCode/Sencho/commit/dda1671e5a4c6788ba5ad97b00cbac98910f3ef0))

## [Unreleased]

### Added

* **sso:** Team Pro SSO/LDAP integration - authenticate via LDAP/Active Directory, Google, GitHub, or Okta alongside existing password login. Auto-provisions new users on first SSO login with configurable role mapping from identity provider groups/claims. All provider credentials encrypted at rest. Configurable via environment variables or Settings UI. OIDC flows use PKCE and state-based CSRF protection. Added `trust proxy` for correct behavior behind reverse proxies.
* **audit-log:** Team Pro audit logging - records all mutating API actions (deploy, stop, delete, settings changes, user CRUD) with user attribution, timestamp, HTTP method, status code, and node context. Searchable timeline UI with filtering by username and method. 90-day retention with automatic cleanup.
* **security:** encryption at rest for sensitive database values - node API tokens are now encrypted with AES-256-GCM using a per-instance key stored outside the database. Existing plaintext tokens are automatically migrated on startup.

### Removed

* **database:** dropped 9 legacy SSH/TLS columns from the nodes table (`host`, `port`, `ssh_port`, `ssh_user`, `ssh_password`, `ssh_key`, `tls_ca`, `tls_cert`, `tls_key`) - these were superseded by the Distributed API model in v0.7.0 and have been inert since
* **frontend:** removed orphaned `MaintenanceModal.tsx` component (dead code, never imported - prune functionality lives in `ResourcesView.tsx`)

### Changed

* **settings/license:** replaced static "View Pricing" button with dynamic upgrade cards - Community users see Personal Pro and Team Pro options with feature highlights; Personal Pro users see Team Pro upgrade only; each card links directly to Lemon Squeezy checkout

* **docs:** comprehensive documentation audit - updated 11 pages with accurate content and 14 fresh screenshots
* **docs/configuration:** removed JWT_SECRET from required env vars (it's auto-generated), added compose directory reorganization explanation
* **docs/settings:** added missing License, Users, Webhooks, Support, and About sections; removed obsolete Appearance section
* **docs/editor:** fixed container actions table to match actual UI (Open App, View Live Logs, Open Bash Terminal)
* **docs/features-overview:** updated all feature descriptions to match current implementation
* **docs/alerts:** added remote node alerts section with setup checklist
* **docs:** added screenshots for Fleet View, Fleet Backups, RBAC, Webhooks, Multi-Node, Editor, Alerts, and Settings

## [0.9.0](https://github.com/AnsoCode/Sencho/compare/v0.8.0...v0.9.0) (2026-03-27)


### Added

* RBAC, atomic deployments, fleet backups, and licensing (Pro) ([#185](https://github.com/AnsoCode/Sencho/issues/185)) ([32a7d53](https://github.com/AnsoCode/Sencho/commit/32a7d53b2b1b9b3d2a067433c9e77709ade96697))

## [0.8.0](https://github.com/AnsoCode/Sencho/compare/v0.7.0...v0.8.0) (2026-03-26)


### Added

* RBAC, atomic deployments, and fleet-wide backups (Pro) ([#181](https://github.com/AnsoCode/Sencho/issues/181)) ([db73d76](https://github.com/AnsoCode/Sencho/commit/db73d7671a22b72756a16594004d9767970d4190))

## [0.7.0](https://github.com/AnsoCode/Sencho/compare/v0.6.0...v0.7.0) (2026-03-26)


### Added

* **webhooks:** add CI/CD webhook integration for triggering stack actions (Pro) ([#177](https://github.com/AnsoCode/Sencho/issues/177)) ([4fc3633](https://github.com/AnsoCode/Sencho/commit/4fc363301a1aaa442adbed83aebd21ca0e71c9c5))

## [0.6.0](https://github.com/AnsoCode/Sencho/compare/v0.5.0...v0.6.0) (2026-03-26)


### Added

* **fleet:** add Pro fleet management features and container drill-down ([#174](https://github.com/AnsoCode/Sencho/issues/174)) ([0630f57](https://github.com/AnsoCode/Sencho/commit/0630f57ca87451352e7c50d511522ac621771458))

## [0.5.0](https://github.com/AnsoCode/Sencho/compare/v0.4.0...v0.5.0) (2026-03-25)


### Added

* **auth:** redesign Login and Setup pages with split-panel branding layout ([#168](https://github.com/AnsoCode/Sencho/issues/168)) ([f80190d](https://github.com/AnsoCode/Sencho/commit/f80190d926c1d768ee1282861dffc7d272f06e21))

## [0.4.0](https://github.com/AnsoCode/Sencho/compare/v0.3.1...v0.4.0) (2026-03-25)


### Added

* **auth:** redesign Login and Setup pages with split-panel branding layout ([#153](https://github.com/AnsoCode/Sencho/issues/153)) ([e0319b5](https://github.com/AnsoCode/Sencho/commit/e0319b5daebbae88b942ba55f6891ce0e2ecaf29))


## [Unreleased]

### Added

* **auth:** Login and Setup pages redesigned with split-panel branding layout (dark branding panel + theme-aware form)
* **auth:** Optional admin email field on Setup for future license recovery
* **ui:** Mobile-responsive login/setup with compact logo header
* **fleet:** Fleet health summary cards - aggregated container, CPU, memory, and alert counts across all nodes (Pro)
* **fleet:** Container-level drill-down - expand stacks to see individual containers with state, uptime, and quick navigation (Pro)
* **fleet:** Node sorting by name, CPU, memory, container count, or status with persistent preferences (Pro)
* **fleet:** Status, type, and critical resource filtering with pill-style toolbar (Pro)
* **fleet:** Fleet-wide search across node names and stack names (Pro)
* **fleet:** Critical node detection with red badge for nodes exceeding 90% CPU or disk usage
* **fleet:** Error toasts on stack and container fetch failures (replaces silent error swallowing)
* **fleet:** ProGate now wraps placeholder content instead of empty children for a better upgrade preview
* **webhooks:** Custom CI/CD webhooks - create webhooks targeting specific stacks and actions (deploy, restart, stop, start, pull), trigger them from GitHub Actions, GitLab CI, or any HTTP client with HMAC-SHA256 signature authentication (Pro)
* **webhooks:** Execution history tracking - last 100 executions per webhook with status, duration, and error details
* **webhooks:** Webhook management UI in Settings with create/edit/delete, enable/disable toggle, one-time secret reveal, and copy-to-clipboard for trigger URLs
* **rbac:** Role-based access control with admin and viewer roles - viewers get full read-only access to dashboard, stacks, logs, and stats while admins retain full control (Pro)
* **rbac:** User management UI in Settings - create, edit, and delete users with username/password/role controls, protected by admin-only access
* **rbac:** Automatic migration of existing single-admin credentials to the new multi-user system on first boot
* **rbac:** Viewer restrictions across the entire UI - read-only editor, hidden action buttons, disabled host console, and disabled resource management
* **atomic:** Atomic deployments with automatic rollback - Sencho backs up compose.yaml and .env before deploying, and auto-restores if health probes detect crashed containers (Pro)
* **atomic:** Manual rollback button in the stack action bar - restore the previous deployment with one click when a backup exists (Pro)
* **atomic:** Health probes added to stack updates (previously only on deploys) - crashed containers trigger auto-rollback during updates too
* **atomic:** Webhook-triggered deploys and updates now use atomic rollback for Pro users
* **fleet:** Fleet-wide backups - snapshot all compose files and .env files across every node (local and remote) into a central backup stored in SQLite (Pro)
* **fleet:** Snapshot detail view - browse captured files per node and stack with inline preview in a collapsible tree
* **fleet:** Per-stack restore from any snapshot - overwrite current compose files with the snapshot version, with optional one-click redeploy (Pro admin)
* **fleet:** Graceful handling of offline nodes during snapshot creation - skipped nodes are recorded with reason and displayed as warnings

* **licensing:** In-app "View Pricing" button redirects to sencho.io for plan selection - license key activation is the primary flow for self-hosted instances

### Changed

* **pricing:** Personal Pro - $7.99/month, $69.99/year, $249 lifetime (1 admin + 3 viewers)
* **pricing:** Team Pro - $49.99/month, $499.99/year, $1,499 lifetime (unlimited accounts)
* **pricing:** Lifetime pricing marked as time-limited early-adopter offer (90-day launch window)
* **licensing:** License variant (Personal/Team) now stored from Lemon Squeezy metadata and exposed in license API response

### Removed

* **licensing:** Server-side Lemon Squeezy checkout URL generation, webhook endpoint, and billing portal - not applicable to self-hosted model where each user runs their own instance
* **rbac:** Seat limits enforced server-side based on license variant - Personal Pro: 1 admin + 3 viewers, Team Pro: unlimited

### Fixed

* **e2e:** Use explicit `data-stacks-loaded` string values for reliable attribute selector matching
* **app-store:** Fix crash caused by removed `Github` icon in newer lucide-react versions

## [0.3.1](https://github.com/AnsoCode/Sencho/compare/v0.3.0...v0.3.1) (2026-03-25)


### Fixed

* **e2e:** wait for sidebar stacks to finish loading before assertions ([#149](https://github.com/AnsoCode/Sencho/issues/149)) ([9ba9a3a](https://github.com/AnsoCode/Sencho/commit/9ba9a3a4565702135f22736a6b2310fc0da1d2f1))

## [0.3.0](https://github.com/AnsoCode/Sencho/compare/v0.2.5...v0.3.0) (2026-03-25)


### Added

* add Community/Pro licensing, fleet view, and UI reorganization ([#145](https://github.com/AnsoCode/Sencho/issues/145)) ([4f26f22](https://github.com/AnsoCode/Sencho/commit/4f26f22ccef89441be032a266723cf6fca0a488a))

## [0.2.5](https://github.com/AnsoCode/Sencho/compare/v0.2.4...v0.2.5) (2026-03-25)


### Fixed

* **charts:** suppress Recharts dimension warnings on initial render ([#141](https://github.com/AnsoCode/Sencho/issues/141)) ([c6633b0](https://github.com/AnsoCode/Sencho/commit/c6633b0245d10671aac78fedac875be63c62a1e1))

## [0.2.4](https://github.com/AnsoCode/Sencho/compare/v0.2.3...v0.2.4) (2026-03-25)


### Fixed

* **csp:** allow external images in App Store and suppress console warnings ([#138](https://github.com/AnsoCode/Sencho/issues/138)) ([c5217cd](https://github.com/AnsoCode/Sencho/commit/c5217cd96de3dd8d2971668373b6eabd2c1654a4))

## [0.2.3](https://github.com/AnsoCode/Sencho/compare/v0.2.2...v0.2.3) (2026-03-25)


### Fixed

* **env:** resolve 404 when loading env files and CSP inline script violation ([#134](https://github.com/AnsoCode/Sencho/issues/134)) ([1e6367a](https://github.com/AnsoCode/Sencho/commit/1e6367a147dddb323799a3cd1947507c595d21db))

## [Unreleased]

### Added

* **licensing:** Community/Pro tier system with Lemon Squeezy integration. Includes `LicenseService` backend singleton, `/api/license` endpoints (activate, deactivate, validate), `LicenseContext` frontend provider, License settings tab, `ProBadge` and `ProGate` reusable components, and 14-day Pro trial on first install. License data stored in `system_state` table with 72-hour periodic validation and 30-day offline grace period.
* **fleet:** Fleet Overview dashboard showing all nodes in a card grid with status, container counts, CPU/RAM/disk usage bars. Pro tier unlocks stack drill-down, auto-refresh (30s), and per-node stack details via `/api/fleet/overview` and `/api/fleet/node/:nodeId/stacks` endpoints.
* **ui:** User Profile Dropdown replacing scattered Settings/LogOut buttons. Includes theme toggle (System/Light/Dark), billing link (Pro only), documentation, and version display. Appearance tab removed from Settings.
* **settings:** About section displaying version, license tier, status, instance ID, and links to docs/changelog/issues.

### Fixed

* **charts:** suppress Recharts `width(-1) height(-1)` warnings by removing conflicting `aspect-video` default and adding `minWidth={0}` + `minHeight={0}` on `ResponsiveContainer`.

## [0.2.2](https://github.com/AnsoCode/Sencho/compare/v0.2.1...v0.2.2) (2026-03-25)


### Fixed

* **editor:** ESLint unused params fix ([dd5b698](https://github.com/AnsoCode/Sencho/commit/dd5b698b3f96e643af608a36128f05874a3b1f3c))
* **editor:** ESLint unused params fix ([dd5b698](https://github.com/AnsoCode/Sencho/commit/dd5b698b3f96e643af608a36128f05874a3b1f3c))
* **editor:** remove unused params from getWorker to satisfy ESLint ([34172a9](https://github.com/AnsoCode/Sencho/commit/34172a99226a4810465968ff9d238b85b1430829))
* **editor:** remove unused params from getWorker to satisfy ESLint ([34172a9](https://github.com/AnsoCode/Sencho/commit/34172a99226a4810465968ff9d238b85b1430829))
* **editor:** remove unused params from getWorker to satisfy ESLint ([59290e9](https://github.com/AnsoCode/Sencho/commit/59290e9e9d00cc97698e0223ab2810ae9f7b06d2))

## [0.2.1](https://github.com/AnsoCode/Sencho/compare/v0.2.0...v0.2.1) (2026-03-24)


### Fixed

* **editor:** bundle Monaco locally to fix stuck Loading state ([0eaa45b](https://github.com/AnsoCode/Sencho/commit/0eaa45bd7f5a4b5db9d51a577d25175bbcb4ff77))
* **editor:** bundle Monaco locally to fix stuck Loading state ([0eaa45b](https://github.com/AnsoCode/Sencho/commit/0eaa45bd7f5a4b5db9d51a577d25175bbcb4ff77))
* **editor:** bundle Monaco locally to fix stuck Loading state and CSP block ([79fde6e](https://github.com/AnsoCode/Sencho/commit/79fde6e2bd598085abfc7c702f5745bdfd692aec))
* **editor:** Monaco CSP fix + release pipeline fixes ([36a9bf3](https://github.com/AnsoCode/Sencho/commit/36a9bf3109c096ddd5d8095089a6ffb7bd6dee8d))
* **editor:** Monaco CSP fix + release pipeline fixes - v0.2.1 ([36a9bf3](https://github.com/AnsoCode/Sencho/commit/36a9bf3109c096ddd5d8095089a6ffb7bd6dee8d))

## [0.2.0](https://github.com/AnsoCode/Sencho/compare/v0.1.0...v0.2.0) (2026-03-24)


### Added

* **ci:** add release-please automated versioning workflow ([c2d5d37](https://github.com/AnsoCode/Sencho/commit/c2d5d37be41267e71bb8515010b049fcd31f5d6b))
* **ci:** add release-please automated versioning workflow ([c2d5d37](https://github.com/AnsoCode/Sencho/commit/c2d5d37be41267e71bb8515010b049fcd31f5d6b))
* **ci:** add release-please automated versioning workflow ([c294def](https://github.com/AnsoCode/Sencho/commit/c294def7ccce1705be55e38e19c7da4f7341c3f4))
* **ci:** automated versioning with release-please ([c991b81](https://github.com/AnsoCode/Sencho/commit/c991b8121edcd30bd6806e959d0dcd14711f439f))
* **ci:** automated versioning with release-please ([c991b81](https://github.com/AnsoCode/Sencho/commit/c991b8121edcd30bd6806e959d0dcd14711f439f))


### Fixed

* **ci:** correct release-please changelog section names and tag format ([ea57cbe](https://github.com/AnsoCode/Sencho/commit/ea57cbe97f7f4166c747f3e3710f85e57ab476a1))
* **ci:** correct release-please changelog section names and tag format ([ea57cbe](https://github.com/AnsoCode/Sencho/commit/ea57cbe97f7f4166c747f3e3710f85e57ab476a1))
* **ci:** correct release-please changelog section names and tag format ([e653bc2](https://github.com/AnsoCode/Sencho/commit/e653bc2210f07d83fcf16ca97e3c2863a40e2cdf))
* **ci:** release-please config corrections ([b6391b9](https://github.com/AnsoCode/Sencho/commit/b6391b96ffd4edf7a303350f7416ab1945136e1b))
* **ci:** release-please config corrections ([b6391b9](https://github.com/AnsoCode/Sencho/commit/b6391b96ffd4edf7a303350f7416ab1945136e1b))

## [Unreleased]

### Fixed
- **fix(editor):** Monaco editor stuck on "Loading…" - `@monaco-editor/react` was fetching Monaco's loader from `cdn.jsdelivr.net` at runtime, which the Helmet CSP (`scriptSrc: 'self'`) correctly blocked. Fixed by configuring `loader.config({ monaco })` in `main.tsx` to use the locally bundled `monaco-editor` npm package and wiring a Vite `?worker` blob URL for the editor worker - no CDN requests, no CSP changes needed.
- **fix(ci):** `release-please.yml` used `GITHUB_TOKEN` to create release tags - GitHub's security model prevents `GITHUB_TOKEN`-triggered events from cascading to other workflow runs, so `docker-publish.yml` never fired after a release. Switched to `DOCS_REPO_TOKEN` (PAT) so tag creation correctly triggers the Docker Hub publish workflow.
- **fix(ci):** Screenshot refresh PR now auto-merges via `gh pr merge --auto --squash` after `peter-evans/create-pull-request` creates it - no more manual merge required on every `develop` push.

### Fixed
- **fix(ci):** `docker-publish.yml` was triggered by `release: types: [published]` (GitHub Release event) instead of `push: tags: v*` - pushing a git tag never fired the workflow. Changed trigger to `push: tags: v*` and updated `enable` conditions from `github.event_name == 'release'` to `startsWith(github.ref, 'refs/tags/v')` so any `v*` tag push automatically builds and publishes `latest` + semver tags to Docker Hub without requiring a manual GitHub Release.

### Added
- **feat(ci):** Automated versioning via `release-please` - on every push to `main`, the `release-please` workflow opens or updates a Release PR with a generated CHANGELOG entry and `package.json` version bump. Merging the Release PR creates the `vX.Y.Z` tag which triggers `docker-publish.yml`. Version bumps follow Conventional Commits: `fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` → major.

---

## [0.1.0] - 2026-03-24

### Security

- **Fixed:** Missing `authMiddleware` on `GET /api/notifications`, `POST /api/notifications/read`, `DELETE /api/notifications/:id`, `DELETE /api/notifications`, `POST /api/notifications/test`, and `POST /api/system/console-token` - any unauthenticated client could reach these endpoints.
- **Fixed:** Remote node `api_url` accepted without validation - an attacker could set it to `http://localhost:6379` to SSRF into internal services. Now validates: must be a well-formed `http://` or `https://` URL and the hostname may not be `localhost`, `127.x.x.x`, `[::1]`, or `0.0.0.0`.
- **Fixed:** `env_file` paths in `compose.yaml` were accepted without boundary checking - absolute paths like `/etc/passwd` could be read or written. All resolved env file paths are now validated to stay within the stack directory.
- **Fixed:** Stack name validated in write routes but not GET routes - path-traversal names now return 400 on all routes.
- **Fixed:** `stackParam` query parameter on `/api/system/host-console` now validated against `path.resolve` + `startsWith(baseDir)` to prevent directory traversal when setting the PTY working directory.
- **Fixed:** `HostTerminalService` no longer forwards full `process.env` to spawned PTY shells - `JWT_SECRET`, `AUTH_PASSWORD`, `AUTH_PASSWORD_HASH`, and `DATABASE_URL` are stripped before the shell is spawned.
- **Fixed:** Host Console and container exec WebSocket endpoints now reject `node_proxy` scoped JWT tokens with HTTP 403.
- **Fixed:** `GET /api/settings` no longer leaks `auth_username`, `auth_password_hash`, or `auth_jwt_secret` to the frontend.
- **Fixed:** `POST /api/settings` enforces a strict allowlist of writable keys - auth credential keys and unknown keys are rejected with a 400 error.
- **Added:** Rate limiting on `/api/auth/login` and `/api/auth/setup` - 5 attempts per 15-minute window per IP, using `express-rate-limit`.
- **Added:** `helmet` middleware for security response headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, etc.).
- **Changed:** CORS is now restricted to `FRONTEND_URL` env var in production; development continues to allow any origin.

### Added

#### Infrastructure & CI
- `linux/arm64` platform support in the Docker Hub publish workflow (Raspberry Pi 4/5, Oracle ARM VMs) - native modules (`bcrypt`, `better-sqlite3`, `node-pty`) cross-compiled via `tonistiigi/xx` to eliminate the `SIGILL` crash caused by Node.js v20 using ARMv8.1 LSE atomic instructions unsupported by GitHub Actions QEMU.
- `docker/setup-qemu-action@v3` step to `docker-publish.yml` - without it multi-platform builds hung indefinitely.
- Automated Docker Hub CI/CD pipeline publishing `dev` and `latest` tags.
- Automated documentation pipeline with Mintlify sync and screenshot refresh CI job.
- `HEALTHCHECK` directive in `Dockerfile` - Docker polls `/api/health` every 30 s and restarts an unhealthy container.
- `GET /api/health` public endpoint returning `{ status: "ok", uptime }`.
- `docker-entrypoint.sh` - runs as root, fixes `$DATA_DIR` volume ownership, then drops to the non-root `sencho` user via `su-exec` before starting Node. Eliminates `SQLITE_READONLY` crashes on host-mounted volumes.
- Non-root `sencho` system user in `Dockerfile`; process no longer runs as root.
- Graceful shutdown - backend listens for `SIGTERM`/`SIGINT`, drains HTTP connections, stops `MonitorService` and `ImageUpdateService`, and closes the SQLite connection before exiting.
- Vitest backend test suite - 38 tests covering validation utilities, health endpoint, authentication flows, auth middleware enforcement, console-token security, and SSRF validation. Run with `cd backend && npm test`.
- Playwright E2E test scaffolding (`e2e/`) - auth, stack management, and node management specs with shared login helper. Run with `npm run test:e2e`.
- CI workflow runs Vitest unit tests and ESLint on every PR.
- `isValidStackName`, `isValidRemoteUrl`, `isPathWithinBase` extracted to `backend/src/utils/validation.ts` for reuse and testability.

#### Multi-Node & Distributed API
- Distributed API proxying using `http-proxy-middleware` for HTTP and WebSockets - replaces the SSH/SFTP architecture entirely (~500 lines removed).
- Long-lived JWT generation for Sencho-to-Sencho API authentication (`POST /api/auth/generate-node-token`).
- `nodeContextMiddleware` in Express to dynamically extract `x-node-id` headers and `?nodeId=` query parameters for WebSocket upgrades.
- `NodeRegistry` service managing multiple Docker daemon connections.
- Node management API endpoints: list, get, create, update, delete, and test connection.
- Two-tier scoped navigation UX - context pill in the top header always shows the active node name (pulsing blue for remote, green for local).
- Remote-aware headers in `HostConsole`, `ResourcesView`, `GlobalObservabilityView`, and `AppStoreView`.
- `SettingsModal` scopes its sidebar to the active node type - global-only tabs hidden when a remote node is active.
- Cross-node notification aggregation - notification bell surfaces alerts from all connected remote nodes with dedicated real-time WebSocket connections per remote node.
- Remote node host console and container exec WebSocket proxy - gateway exchanges `node_proxy` token for a short-lived `console_session` JWT (60 s TTL) before forwarding.
- `localOnly` option on `apiFetch` - omits `x-node-id` so requests always route to the local node.

#### Application Features
- **App Store** - LinuxServer.io API integration as default template registry with rich metadata (architectures, docs links, GitHub links), category filter, one-click deployment, atomic rollback on failure, custom Portainer v2 registry URL support, editable ports/volumes/environment variables, post-deploy health probe.
- **Resources Hub** - Images, Volumes, and Networks tabs with Managed/External/Unused classification, Docker Disk Footprint stacked-bar widget, scoped prune operations (Sencho-only vs All Docker), managed/external filter toggles, and classification badges.
- **Global Observability** - centralized dashboard tracking 24-hour historical metrics and aggregating global tail logs across all containers. Dozzle-style Action Bar with multi-select stack filtering, search, STDOUT/STDERR toggles, and Developer Mode SSE real-time streaming.
- **Background image update checker** - polls OCI-compliant registries every 6 hours using manifest digest comparison; results cached in `stack_update_status` table; pulsing blue dot badge on stacks with available updates.
- **Real-time WebSocket notifications** - replaces 5-second polling; `NotificationService.setBroadcaster()` pushes each new alert to all authenticated subscribers the moment it fires.
- **Live Container Logs** viewer using SSE for real-time terminal output.
- **Animated design system** - `motion` package and `animate-ui` library; new brand cyan token; spring-based dialog/tooltip/tab animations; `prefers-reduced-motion` respected globally; Geist font via Google Fonts CDN.
- Theme-aware sidebar logo - dark and light variants auto-switch based on active theme.
- Auto theme option (light/dark/auto) with `window.matchMedia` listener.
- `PATCH /api/settings` bulk-update endpoint - validates all values via Zod schema, persists atomically in a single SQLite transaction.
- `system_state` SQLite table - separates runtime operational state from user-defined config in `global_settings`.
- Configurable `metrics_retention_hours` (default: 24 h) and `log_retention_days` (default: 30 d) - `MonitorService` reads these dynamically each cycle.
- Managed/unmanaged container count split in `GET /api/stats` - Home Dashboard "Active Containers" card shows "N managed · N external".
- Two-Stage Teardown for stack deletion - `docker compose down` sweeps ghost networks before deployment files are deleted.
- Custom Environment Variable injection tool in deployment UI.
- `ErrorBoundary` component now wraps root `<App />` in `main.tsx`.
- Git Flow branching strategy and branch protection.

### Fixed

#### Authentication & Proxy
- Login loop caused by remote node auth failure - `apiFetch` now only fires `sencho-unauthorized` when the `x-sencho-proxy: 1` header is absent (i.e., a genuine local session failure, not a remote node auth error).
- `authMiddleware` and WS upgrade handler now evaluate `bearerToken || cookieToken` (Bearer first) - cookie no longer shadows a valid Bearer token on node-to-node proxy calls.
- Remote node proxy stripping the `/api` path prefix - added `pathRewrite: (path) => '/api' + path` to restore the full path when forwarding to remote instances.
- Remote node HTTP proxy body forwarding - replaced `proxyReq.write(JSON.stringify(req.body))` (raced against `http-proxy`'s `process.nextTick(proxyReq.end)`) with a conditional JSON body parser that skips `express.json()` for remote-targeted requests; the raw `IncomingMessage` stream is left unconsumed so `http-proxy`'s `req.pipe(proxyReq)` forwards it intact.
- Remote node proxy forwarding the browser's `sencho_token` cookie to the remote instance - stripped in `proxyReq` so only the Bearer token is used.
- Remote WebSocket upgrades forwarding the browser `cookie` header - stripped before `wsProxyServer.ws()` so the remote's `authMiddleware` uses the Bearer token exclusively.
- `nodeContextMiddleware` blocking `/api/nodes` when `x-node-id` references a deleted node - exempted alongside `/api/auth/` so the frontend can re-sync a stale node ID.
- Backend memory leak from `createProxyMiddleware` called inside the request handler on every API call - refactored to a single globally-instantiated proxy using the `router` option.
- `remoteNodeProxy` error handler unsafely cast `proxyRes` to `Response` on WebSocket/TCP-level errors - type-narrowed before sending 502.

#### WebSocket & Streaming
- Container stats WebSocket flooding React with up to 20+ `setState` calls per second - replaced with a ref-buffer + 1.5 s flush interval pattern.
- `streamStats` Docker stats stream leaking after WebSocket client disconnect - `ws.on('close')` handler calls `stats.destroy()`; all `ws.send()` calls guarded with `readyState === OPEN`.
- `streamStats` and `execContainer` called unawaited - unhandled promise rejections now chain `.catch()`, log the error, and close the WebSocket cleanly.
- Per-connection `WebSocket.Server` instances for stack logs and host console never closed after upgrade - `wss.close()` called immediately after `handleUpgrade`.
- WebSocket notification reconnect upgraded to exponential backoff (1 s → 30 s max) instead of flat 5-second retry; `ws.onerror` logs the event; cleanup guards against closing an already-closing socket.
- Terminal logs and container stats WebSockets failing with "HTTP Authentication failed" on remote nodes - gateway's `cookie` header stripped before forwarding to remote; `nodeId` query param stripped from forwarded URL.
- LogViewer returning 404 on remote nodes - `nodeId` query param stripped from `proxyReq.path` in `onProxyReq`.

#### UI & Frontend
- Blank page on HTTP deployments (root cause - Helmet 8 default CSP `upgrade-insecure-requests` and HSTS) - `upgradeInsecureRequests: null` and `strictTransportSecurity: false` set explicitly.
- COOP header console warning on HTTP deployments - `crossOriginOpenerPolicy: false`.
- Inline script CSP violation from Vite module-preload polyfill - disabled via `build.modulePreload.polyfill: false`.
- CSP `workerSrc` missing (Monaco editor workers) - added `worker-src 'self' blob:`.
- CSP `connectSrc` implicit - added explicit `connect-src 'self' ws: wss:`.
- Docker socket `EACCES` root:root edge case - entrypoint handles GID 0 in addition to the standard root:docker case.
- Managed container count wrong when stacks launched from COMPOSE_DIR root - classification now uses `com.docker.compose.project.working_dir`.
- Browser Out of Memory crash in `GlobalObservabilityView` - capped DOM rendering to last 300 entries, reduced SSE log cap to 2,000 entries, replaced `key={idx}` with monotonic `_id` counter.
- `HomeDashboard` create-stack error handling - reads JSON error body before throwing; uses defensive toast pattern.
- `AlertDialogContent` using `asChild` with `motion.div` wrapper crashing on delete-stack confirmation - replaced with CSS keyframe animations.
- animate-ui `auto-height.tsx` importing `WithAsChild` without `type` keyword - crashed browser module loader.
- animate-ui `switch.tsx` double-spreading Radix props onto `motion.button` DOM element.
- "Always Local" badge tooltip crashing (`getStrictContext`) - replaced animate-ui tooltip with pure Radix primitives.
- Cancel/Add Node buttons in NodeManager dialogs stuck together.
- Resources/App Store/Logs menu buttons not toggling off on second click.
- Monaco container height accumulation on tab switching - reset to 0×0 and force synchronous reflow before re-measuring.
- `AppStoreView` and `GlobalObservabilityView` using raw `fetch()` instead of `apiFetch()` - all calls now inject `x-node-id`.
- `HostConsole` WebSocket URL missing `?nodeId=` query parameter.
- "Open App" button opening `http://localhost:{port}` for remote node containers - resolves hostname from remote node's `api_url`.
- Dashboard cards showing stale local-node data after switching to a remote node - polling effects now depend on `activeNode?.id` and clear state immediately on node change.
- `refreshStacks` crashing with `SyntaxError` or `TypeError` when the remote proxy returns a non-JSON response - checks `res.ok` before calling `res.json()`.
- Four empty `catch {}` blocks in `EditorLayout` - now surface errors via `toast.error()`.
- `StackAlertSheet` not fetching notification agent status from the active node on open.
- `SettingsModal` Notifications tab hidden when a remote node is active - now visible and configurable on remote nodes.
- `POST /api/alerts` now validates the request body with a Zod schema - rejects unknown metric/operator values, negative thresholds, and missing fields with a structured 400.
- `WebSocket.Server` replaced with named import `WebSocketServer` from `ws` to fix ESM/CJS interop.
- `NodeProvider` mounted outside the auth gate - moved inside the authenticated branch so `refreshNodes` no longer fires before authentication.
- Infinite re-fetch loop in `NodeContext` - `refreshNodes` useCallback no longer depends on `activeNode` state; replaced with `useRef`.
- Infinite page reload loop - `apiFetch` replaced `window.location.href = '/'` with a `sencho-unauthorized` custom event.
- API Token copy button failing silently on HTTP/non-localhost - added `execCommand('copy')` fallback.
- E2E nodes tests permanently timing out because the Add Node submit button requires `api_token` to be non-empty.
- ESLint CI step - replaced all `any` annotations with proper types, fixed unused catch variables.
- `[DEP0060] DeprecationWarning: util._extend` from `http-proxy@1.18.1` - suppressed at call site.
- Global Logs false-positive error misclassifications - replaced naive regex with a robust 3-tier classification engine.
- Memory leak in `GlobalObservabilityView` SSE mode - log array capped at 2,000 entries.
- Historical metrics memory leak - polling throttled to 60 s; SQLite payload downsampled by 12×.
- Active node UI dropdown desyncing from API requests on initial page load - state hydrated from localStorage.
- `MonitorService` crash (`Cannot read properties of undefined (reading 'cpu_usage')`) during Docker container transition states.
- Deleted node ghost API calls - 404 errors intercepted globally, forcing UI to resync to default node.
- Horizontal UI overflow in Node Manager settings on smaller resolutions.
- Docker API parsing bug where HTML string responses from misconfigured ports were counted as containers.

### Changed

- **Architecture:** Replaced SSH/SFTP remote node model with Distributed API proxy (HTTP/WebSocket) - remote nodes now only require an API URL and Bearer token. Node Manager UI vastly simplified.
- **Docs:** Migrated Mintlify config from deprecated `mint.json` to `docs.json` v2 format; bootstrapped full user-facing documentation (configuration, stack management, editor, multi-node, alerts, dashboard, resources, app store, observability, settings reference, troubleshooting, backup & restore).
- **Design system:** Animated UI overhaul - new brand cyan token, spring-based animations on dialogs/tooltips/switches/tabs, dark mode shadow strengthening, Geist font now actually loaded.
- Notification delivery replaced polling with WebSocket push - no more `setInterval` in `EditorLayout`.
- `DatabaseService.addNotificationHistory` returns the full inserted record for real-time broadcasting.
- `SettingsModal` overhauled - per-operation loading states, skeleton loader, unsaved-changes indicator, all saves use `PATCH /api/settings`.
- `MonitorService` evaluates limits and detects container crashes across all registered nodes concurrently.
- `MonitorService` reads retention settings dynamically each cycle.
- Developer settings scoped to the local node - reads/writes always target local via `localOnly` regardless of active node.
- Dark mode scrollbar styling - no more white native scrollbars.
- Rebranded "Templates" → "App Store", "Ghost Containers" → "Unmanaged Containers", "Observability" → "Logs".
- Global logs display chronologically (newest at bottom) with smooth auto-scrolling; UTC → local browser timezone.
- Historical CPU/RAM charts relocated to the Home Dashboard; data normalized (CPU relative to host cores, RAM to GB).
- `EditorLayout` main workspace container keyed to `activeView` - every view switch triggers a fade-up entrance animation.

### Removed

- SSH/SFTP remote node adapters (`IFileAdapter`, `LocalFileAdapter`, `SSHFileAdapter`, `SSHFileAdapter`, `ComposeService.executeRemote`, `ComposeService.streamLogs` SSH path) - ~500 lines.

[0.1.0]: https://github.com/AnsoCode/Sencho/releases/tag/v0.1.0
