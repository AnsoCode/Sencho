# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
- **Fixed:** A bug where the active node UI dropdown would desync from the actual API requests on initial page load by properly hydrating state from localStorage.
- **Fixed:** Remote node proxy forwarding the browser's `sencho_token` cookie to the remote Sencho instance — the remote's `authMiddleware` evaluates `cookieToken || bearerToken` and the cookie (signed with the local JWT secret) was validated before the valid Bearer token, causing 401 on all proxied API calls. Fixed by stripping the `cookie` header in `proxyReq` so only the Bearer token is used for remote authentication.
- **Fixed:** `nodeContextMiddleware` blocking `/api/nodes` when `x-node-id` references a deleted/non-existent node — the nodes list endpoint must always succeed so the frontend can re-sync a stale node ID in localStorage; exempted alongside `/api/auth/`.
- **Fixed:** Remote node proxy stripping the `/api` path prefix — `remoteNodeProxy` is mounted at `app.use('/api/', ...)` so Express strips that prefix from `req.url` before `http-proxy-middleware` sees it; added `pathRewrite: (path) => '/api' + path` to restore the full path when forwarding to the remote Sencho instance (e.g. `/stats` → `/api/stats`). This was the root cause of all remote API calls returning the remote's SPA HTML instead of JSON.
- **Fixed:** Dashboard cards (Active Containers, Host CPU, Host RAM, Docker Network) showing stale local-node data after switching to a remote node — `HomeDashboard` polling effects now depend on `activeNode?.id` and clear state immediately on node change.
- **Fixed:** `refreshStacks` crashing with `SyntaxError` or `TypeError` when the remote proxy returns a non-JSON response (e.g., connection refused to unreachable remote node) — now checks `res.ok` before calling `res.json()` and iterates a typed `fileList` instead of the raw parsed value.
- **Fixed:** Restored Local/Remote type selector and fixed state resets in the Add Node modal — form now resets to defaults every time the dialog opens, and the title reflects the chosen type dynamically.
- **Fixed:** Remote node connection details failing to display Containers, Images, and CPU metrics — `testRemoteConnection` now fires parallel requests to `/api/stats`, `/api/system/stats`, and `/api/system/images` after auth succeeds, mapping real values into the info panel.
- **Fixed:** Suppressed `[DEP0060] DeprecationWarning: util._extend` from `http-proxy@1.18.1` — override is applied to `process.emitWarning` before the proxy instances are created, cleanly intercepting the warning at its call site without suppressing other warnings.
- **Fixed:** Backend memory leak caused by improper proxy middleware instantiation - `createProxyMiddleware` was called inside the request handler on every API call, spawning a new `http-proxy` instance (and registering new server listeners) per request. Refactored to a single globally-instantiated proxy using the `router` option for dynamic per-request target resolution.
- **Fixed:** `[DEP0060] DeprecationWarning: util._extend` deprecation eliminated as a side-effect of the above fix (deprecation was triggered on every new `http-proxy` initialisation).
- **Fixed:** Remote node authentication failures - `authMiddleware` and WebSocket upgrade handler both accept `Authorization: Bearer` tokens (Sencho-to-Sencho proxy auth).
- **Fixed:** Node connection testing logic updated to perform authenticated HTTP pings to `/api/auth/check` on the remote instance.
- **Fixed:** Node switcher dropdown failing to trigger data refreshes - `EditorLayout` now reacts to `activeNode` changes, re-fetching stacks and clearing stale editor/container state when the user switches nodes.
- **Fixed:** API Token copy button failing silently on HTTP / non-localhost deployments where `navigator.clipboard` is unavailable - added `try/catch` with `document.execCommand('copy')` fallback.
- **Fixed:** Remote node authentication failures by updating middleware to support Bearer tokens in WebSocket upgrade handler (node-to-node WS proxy now authenticates correctly on the receiving instance).
- **Fixed:** Node connection testing logic updated to normalize `api_url` trailing slashes before constructing the authenticated HTTP ping URL.
- **Fixed:** Memory leak in `GlobalObservabilityView` SSE mode - log array now capped at 10,000 entries (`.slice(-10000)`) to prevent unbounded accumulation across long sessions.
- **Fixed:** Infinite re-fetch loop in `NodeContext` - `refreshNodes` useCallback no longer depends on `activeNode` state; replaced with a `useRef` to read current node inside the callback without being a reactive dependency.
- **Fixed:** Infinite page reload loop - `apiFetch` was calling `window.location.href = '/'` on every 401, causing a full browser reload before auth could complete. Replaced with a `sencho-unauthorized` custom event that `AuthContext` handles by setting `appStatus` to `notAuthenticated`.
- **Fixed:** `NodeProvider` was mounted outside the auth gate in `App.tsx`, causing `refreshNodes` to fire before authentication was established (hitting 401 immediately on boot). Moved `NodeProvider` inside the authenticated branch so it only mounts after login.
- **Removed:** SSH/SFTP file adapters and remote Docker TCP connections (net negative ~500 lines of code).
- **Added:** Distributed API proxying using http-proxy-middleware for HTTP and WebSockets.
- **Added:** Long-lived JWT generation for Sencho-to-Sencho API authentication (`POST /api/auth/generate-node-token`).
- **Changed:** Node Manager UI vastly simplified - remote nodes now only require an API URL and Token.
- **Fixed:** Critical port routing conflict - separated Docker API port (`port`) from SSH/SFTP port (`ssh_port`) in the `nodes` schema. Previously, a single `port` field served both protocols, causing ECONNREFUSED.
- **Fixed:** `FileSystemService` now reads the node's `compose_dir` from the database for remote nodes instead of always using the `COMPOSE_DIR` env var.
- **Fixed:** SSH/SFTP connections in `SSHFileAdapter`, `ComposeService.executeRemote()`, and `ComposeService.streamLogs()` now use `ssh_port` (default 22) instead of Docker API `port`.
- **Added:** Full SSH credential fields (SSH Port, Username, Password, Private Key) to the Node Manager Add/Edit forms.
- **Added:** `ssh_port` column to the `nodes` database table with migration support (default: 22).
- **Changed:** Global `FileSystemService` and `ComposeService` singletons refactored into node-aware instances.
- **Added:** `IFileAdapter`, `LocalFileAdapter`, and `SSHFileAdapter` to abstract all filesystem interactions for remote node support.
- **Changed:** `MonitorService` now evaluates limits, fetches metrics, and detects container crashes across all registered nodes concurrently.
- **Added:** Node Context Middleware in Express API to dynamically extract `x-node-id` headers and parse WebSocket query parameters.
- **Added:** Remote Nodes Foundation - `nodes` table in SQLite with auto-seeded default local node.
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
