# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
- **Added:** TLS certificate support for secure remote Docker daemon connections.
- **Added:** SSH Private Key authentication UI for the Smart Proxy file system.
- **Fixed:** Fatal path.join crash in FileSystemService caused by malformed SSH directory reads.
- **Fixed:** Home dashboard System Stats incorrectly showing local hardware metrics when a remote node was active.
- **Fixed:** UI overlap between the 'Add Node' button and the Settings dialog close icon.
- **Fixed:** Critical port routing conflict — separated Docker API port (`port`) from SSH/SFTP port (`ssh_port`) in the `nodes` schema. Previously, a single `port` field served both protocols, causing ECONNREFUSED.
- **Fixed:** `FileSystemService` now reads the node's `compose_dir` from the database for remote nodes instead of always using the `COMPOSE_DIR` env var.
- **Fixed:** SSH/SFTP connections in `SSHFileAdapter`, `ComposeService.executeRemote()`, and `ComposeService.streamLogs()` now use `ssh_port` (default 22) instead of Docker API `port`.
- **Added:** Full SSH credential fields (SSH Port, Username, Password, Private Key) to the Node Manager Add/Edit forms.
- **Added:** `ssh_port` column to the `nodes` database table with migration support (default: 22).
- **Changed:** Global `FileSystemService` and `ComposeService` singletons refactored into node-aware instances.
- **Added:** `IFileAdapter`, `LocalFileAdapter`, and `SSHFileAdapter` to abstract all filesystem interactions for remote node support.
- **Changed:** `MonitorService` now evaluates limits, fetches metrics, and detects container crashes across all registered nodes concurrently.
- **Added:** Node Context Middleware in Express API to dynamically extract `x-node-id` headers and parse WebSocket query parameters.
- **Added:** Remote Nodes Foundation (Strategy B) — `nodes` table in SQLite with auto-seeded default local node.
- **Added:** `NodeRegistry` service for managing multiple Docker daemon connections (local socket + TCP).
- **Added:** Node management API endpoints: list, get, create, update, delete, and test connection.
- **Added:** Settings Hub → Nodes tab with full CRUD UI, connection testing, and Docker info display.
- **Added:** Node switcher dropdown in sidebar (auto-visible when multiple nodes are configured).
- **Added:** `NodeContext` for frontend-wide active node state management.
- **Fixed:** Global logs false-positive error misclassifications caused by Docker containers writing INFO logs to STDERR. Replaced naive regex with a robust 3-tier classification engine supporting `level=info`, `[INFO]`, and ` INFO ` format standards.
- **Added:** Developer Mode setting to enable true Real-Time (SSE) global log streaming and infinite scroll.
- **Added:** Configurable polling rates for standard global logs monitoring.
- **Added:** React Throttle Buffer to prevent UI freezing during heavy real-time log ingestion.
- **Fixed:** Global Logs aggressive auto-scrolling preventing users from reading log history.
- **Fixed:** Quiet stacks missing from the Global Logs filter dropdown by fetching the definitive stack list independently.
- **Fixed:** Global logs misclassifying INFO messages as errors due to naive string matching.
- **Changed:** Global logs now display chronologically (newest at bottom) with smooth auto-scrolling.
- **Changed:** Renamed Observability navigation tab to Logs.
- **Fixed:** TTY container log streams failing to parse globally.
- **Fixed:** Global logs displaying in UTC instead of local browser timezone.
- **Changed:** Global Logs UI revamped to use a floating, hover-based action bar to maximize terminal space.
- **Fixed:** Docker raw byte multiplex headers leaking into global logs stream.
- **Changed:** Relocated historical CPU/RAM charts to the Home Dashboard and normalized data values (CPU relative to host cores, RAM to GB).
- **Added:** Dozzle-style Action Bar to Global Logs with multi-select stack filtering, search, and STDOUT/STDERR toggles.
- **Added:** Centralized observability dashboard tracking 24-hour historical metrics and aggregating global tail logs across all running containers.
- **Added:** Live Container Logs viewer using Server-Sent Events (SSE) for real-time terminal output.
- **Added:** Pre-deploy folder collision check to prevent silent configuration overwrites in the App Store.
- **Added:** UI subtitle during deployment to reassure users during long image downloads.
- **Changed:** Standardized manual stack deletion to use the Two-Stage Teardown (Compose Down -> File Wipe) to prevent ghost networks.
- **Fixed:** Atomic Rollback failure where non-empty directories caused silent file system errors.
- **Added:** Two-Stage Teardown mechanism to ensure `docker compose down` sweeps up ghost networks before deployment files are deleted.
### Deprecated
- **(Planned)** Port 2375 (TCP) fallback support; future releases may require SSH-only for Node config.

### Fixed
- Fixed backend MonitorService crash (`Cannot read properties of undefined (reading 'cpu_usage')`) occurring when Docker containers lacked CPU telemetry during transition states.
- Handled UI deleted nodes ghost API calls by intercepting 404 errors globally in API and forcing the UI to resync to the default Node context.
- Hardened `nodeContextMiddleware` in Express to intercept queries to invalid or deleted Node IDs gracefully instead of bubbling to Docker API 500 crashes.
- Hardened Remote Node connection testing (`docker.info()`) to explicitly validate expected Docker API daemon properties instead of merely checking string length.
- Caught Unhandled SFTP Promise Rejections in Node registry gracefully returning empty arrays to prevent frontend loading UI stalls.
- Fixed horizontal UI overflowing in Node Manager settings on smaller resolutions.
- **Fixed:** Docker API parsing bug where HTML string responses from misconfigured ports were counted as containers.
- **Fixed:** Stack list crashing when SFTP connections fail by gracefully catching SSH errors and returning empty arrays.

### Changed
- **Changed:** Expanded Node Manager UI width and added horizontal scrollbars for better data visibility.
- **Added:** Smart Error Parser with telemetry-ready rule IDs to translate cryptic Docker output.
- **Added:** Post-Deploy Health Probe to catch immediate container crashes that slip past Compose.
- **Changed:** Rollback engine respects a `canSilentlyRollback` flag to protect user-authored configurations.
- **Changed:** Removed rigid volume sanitization, allowing full user control over bind paths.
- **Added:** Editable Host Volumes in the deployment UI.
- **Added:** Custom Environment Variable injection tool.
- **Fixed:** ScrollArea UI height rendering and dynamic browser timezone detection.
- **Changed:** Rebranded "Templates" to "App Store" across the UI.
- **Added:** Advanced deployment configuration panel (Editable Ports and Environment Variables) with smart defaults.
- **Fixed:** Implemented smart image fallbacks for broken registry logos and added expandable descriptions.
- **Added:** Atomic Deployments: Failed App Store deployments now automatically roll back and delete their orphaned folders.
- **Fixed:** Global dark mode scrollbar styling to eliminate blinding white native scrollbars.
- **Fixed:** Input overlap UI bug in the App Store deployment panel.
### Added
- **Added:** Official LinuxServer.io API integration as the default Template Registry.
- **Added:** Rich metadata display in the App Store (Architectures, Documentation links, GitHub repository links).
- **Added:** Dynamic Template Registry URL support via global settings, defaulting to LinuxServer.io templates.
- **Fixed:** Smart Volume Sanitizer to automatically rewrite messy Portainer bind mounts into clean, relative paths (Sencho 1:1 path rule).
- Git Flow branching strategy and branch protection.
- GitHub Actions CI pipeline for automated TypeScript build verification.
- **Added:** Automated Docker Hub CI/CD pipeline for the `dev` and `latest` tags.
- **Added:** App Templates (App Store) with One-Click deployment, utilizing Portainer v2 JSON registries and auto-generating compose files.
