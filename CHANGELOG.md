# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

* **env:** fix 404 when loading env files for stacks with `env_file` paths outside the stack directory (e.g. shared `globals.env`). The `/envs` endpoint now only returns files that exist on disk, and absolute `env_file` paths from compose files are no longer rejected.
* **csp:** fix Content Security Policy violation caused by inline theme-detection script. Moved to an external `theme-init.js` file so it is covered by `script-src 'self'`.

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
* **editor:** Monaco CSP fix + release pipeline fixes — v0.2.1 ([36a9bf3](https://github.com/AnsoCode/Sencho/commit/36a9bf3109c096ddd5d8095089a6ffb7bd6dee8d))

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
- **fix(editor):** Monaco editor stuck on "Loading…" — `@monaco-editor/react` was fetching Monaco's loader from `cdn.jsdelivr.net` at runtime, which the Helmet CSP (`scriptSrc: 'self'`) correctly blocked. Fixed by configuring `loader.config({ monaco })` in `main.tsx` to use the locally bundled `monaco-editor` npm package and wiring a Vite `?worker` blob URL for the editor worker — no CDN requests, no CSP changes needed.
- **fix(ci):** `release-please.yml` used `GITHUB_TOKEN` to create release tags — GitHub's security model prevents `GITHUB_TOKEN`-triggered events from cascading to other workflow runs, so `docker-publish.yml` never fired after a release. Switched to `DOCS_REPO_TOKEN` (PAT) so tag creation correctly triggers the Docker Hub publish workflow.
- **fix(ci):** Screenshot refresh PR now auto-merges via `gh pr merge --auto --squash` after `peter-evans/create-pull-request` creates it — no more manual merge required on every `develop` push.

### Fixed
- **fix(ci):** `docker-publish.yml` was triggered by `release: types: [published]` (GitHub Release event) instead of `push: tags: v*` — pushing a git tag never fired the workflow. Changed trigger to `push: tags: v*` and updated `enable` conditions from `github.event_name == 'release'` to `startsWith(github.ref, 'refs/tags/v')` so any `v*` tag push automatically builds and publishes `latest` + semver tags to Docker Hub without requiring a manual GitHub Release.

### Added
- **feat(ci):** Automated versioning via `release-please` — on every push to `main`, the `release-please` workflow opens or updates a Release PR with a generated CHANGELOG entry and `package.json` version bump. Merging the Release PR creates the `vX.Y.Z` tag which triggers `docker-publish.yml`. Version bumps follow Conventional Commits: `fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` → major.

---

## [0.1.0] - 2026-03-24

### Security

- **Fixed:** Missing `authMiddleware` on `GET /api/notifications`, `POST /api/notifications/read`, `DELETE /api/notifications/:id`, `DELETE /api/notifications`, `POST /api/notifications/test`, and `POST /api/system/console-token` — any unauthenticated client could reach these endpoints.
- **Fixed:** Remote node `api_url` accepted without validation — an attacker could set it to `http://localhost:6379` to SSRF into internal services. Now validates: must be a well-formed `http://` or `https://` URL and the hostname may not be `localhost`, `127.x.x.x`, `[::1]`, or `0.0.0.0`.
- **Fixed:** `env_file` paths in `compose.yaml` were accepted without boundary checking — absolute paths like `/etc/passwd` could be read or written. All resolved env file paths are now validated to stay within the stack directory.
- **Fixed:** Stack name validated in write routes but not GET routes — path-traversal names now return 400 on all routes.
- **Fixed:** `stackParam` query parameter on `/api/system/host-console` now validated against `path.resolve` + `startsWith(baseDir)` to prevent directory traversal when setting the PTY working directory.
- **Fixed:** `HostTerminalService` no longer forwards full `process.env` to spawned PTY shells — `JWT_SECRET`, `AUTH_PASSWORD`, `AUTH_PASSWORD_HASH`, and `DATABASE_URL` are stripped before the shell is spawned.
- **Fixed:** Host Console and container exec WebSocket endpoints now reject `node_proxy` scoped JWT tokens with HTTP 403.
- **Fixed:** `GET /api/settings` no longer leaks `auth_username`, `auth_password_hash`, or `auth_jwt_secret` to the frontend.
- **Fixed:** `POST /api/settings` enforces a strict allowlist of writable keys — auth credential keys and unknown keys are rejected with a 400 error.
- **Added:** Rate limiting on `/api/auth/login` and `/api/auth/setup` — 5 attempts per 15-minute window per IP, using `express-rate-limit`.
- **Added:** `helmet` middleware for security response headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, etc.).
- **Changed:** CORS is now restricted to `FRONTEND_URL` env var in production; development continues to allow any origin.

### Added

#### Infrastructure & CI
- `linux/arm64` platform support in the Docker Hub publish workflow (Raspberry Pi 4/5, Oracle ARM VMs) — native modules (`bcrypt`, `better-sqlite3`, `node-pty`) cross-compiled via `tonistiigi/xx` to eliminate the `SIGILL` crash caused by Node.js v20 using ARMv8.1 LSE atomic instructions unsupported by GitHub Actions QEMU.
- `docker/setup-qemu-action@v3` step to `docker-publish.yml` — without it multi-platform builds hung indefinitely.
- Automated Docker Hub CI/CD pipeline publishing `dev` and `latest` tags.
- Automated documentation pipeline with Mintlify sync and screenshot refresh CI job.
- `HEALTHCHECK` directive in `Dockerfile` — Docker polls `/api/health` every 30 s and restarts an unhealthy container.
- `GET /api/health` public endpoint returning `{ status: "ok", uptime }`.
- `docker-entrypoint.sh` — runs as root, fixes `$DATA_DIR` volume ownership, then drops to the non-root `sencho` user via `su-exec` before starting Node. Eliminates `SQLITE_READONLY` crashes on host-mounted volumes.
- Non-root `sencho` system user in `Dockerfile`; process no longer runs as root.
- Graceful shutdown — backend listens for `SIGTERM`/`SIGINT`, drains HTTP connections, stops `MonitorService` and `ImageUpdateService`, and closes the SQLite connection before exiting.
- Vitest backend test suite — 38 tests covering validation utilities, health endpoint, authentication flows, auth middleware enforcement, console-token security, and SSRF validation. Run with `cd backend && npm test`.
- Playwright E2E test scaffolding (`e2e/`) — auth, stack management, and node management specs with shared login helper. Run with `npm run test:e2e`.
- CI workflow runs Vitest unit tests and ESLint on every PR.
- `isValidStackName`, `isValidRemoteUrl`, `isPathWithinBase` extracted to `backend/src/utils/validation.ts` for reuse and testability.

#### Multi-Node & Distributed API
- Distributed API proxying using `http-proxy-middleware` for HTTP and WebSockets — replaces the SSH/SFTP architecture entirely (~500 lines removed).
- Long-lived JWT generation for Sencho-to-Sencho API authentication (`POST /api/auth/generate-node-token`).
- `nodeContextMiddleware` in Express to dynamically extract `x-node-id` headers and `?nodeId=` query parameters for WebSocket upgrades.
- `NodeRegistry` service managing multiple Docker daemon connections.
- Node management API endpoints: list, get, create, update, delete, and test connection.
- Two-tier scoped navigation UX — context pill in the top header always shows the active node name (pulsing blue for remote, green for local).
- Remote-aware headers in `HostConsole`, `ResourcesView`, `GlobalObservabilityView`, and `AppStoreView`.
- `SettingsModal` scopes its sidebar to the active node type — global-only tabs hidden when a remote node is active.
- Cross-node notification aggregation — notification bell surfaces alerts from all connected remote nodes with dedicated real-time WebSocket connections per remote node.
- Remote node host console and container exec WebSocket proxy — gateway exchanges `node_proxy` token for a short-lived `console_session` JWT (60 s TTL) before forwarding.
- `localOnly` option on `apiFetch` — omits `x-node-id` so requests always route to the local node.

#### Application Features
- **App Store** — LinuxServer.io API integration as default template registry with rich metadata (architectures, docs links, GitHub links), category filter, one-click deployment, atomic rollback on failure, custom Portainer v2 registry URL support, editable ports/volumes/environment variables, post-deploy health probe.
- **Resources Hub** — Images, Volumes, and Networks tabs with Managed/External/Unused classification, Docker Disk Footprint stacked-bar widget, scoped prune operations (Sencho-only vs All Docker), managed/external filter toggles, and classification badges.
- **Global Observability** — centralized dashboard tracking 24-hour historical metrics and aggregating global tail logs across all containers. Dozzle-style Action Bar with multi-select stack filtering, search, STDOUT/STDERR toggles, and Developer Mode SSE real-time streaming.
- **Background image update checker** — polls OCI-compliant registries every 6 hours using manifest digest comparison; results cached in `stack_update_status` table; pulsing blue dot badge on stacks with available updates.
- **Real-time WebSocket notifications** — replaces 5-second polling; `NotificationService.setBroadcaster()` pushes each new alert to all authenticated subscribers the moment it fires.
- **Live Container Logs** viewer using SSE for real-time terminal output.
- **Animated design system** — `motion` package and `animate-ui` library; new brand cyan token; spring-based dialog/tooltip/tab animations; `prefers-reduced-motion` respected globally; Geist font via Google Fonts CDN.
- Theme-aware sidebar logo — dark and light variants auto-switch based on active theme.
- Auto theme option (light/dark/auto) with `window.matchMedia` listener.
- `PATCH /api/settings` bulk-update endpoint — validates all values via Zod schema, persists atomically in a single SQLite transaction.
- `system_state` SQLite table — separates runtime operational state from user-defined config in `global_settings`.
- Configurable `metrics_retention_hours` (default: 24 h) and `log_retention_days` (default: 30 d) — `MonitorService` reads these dynamically each cycle.
- Managed/unmanaged container count split in `GET /api/stats` — Home Dashboard "Active Containers" card shows "N managed · N external".
- Two-Stage Teardown for stack deletion — `docker compose down` sweeps ghost networks before deployment files are deleted.
- Custom Environment Variable injection tool in deployment UI.
- `ErrorBoundary` component now wraps root `<App />` in `main.tsx`.
- Git Flow branching strategy and branch protection.

### Fixed

#### Authentication & Proxy
- Login loop caused by remote node auth failure — `apiFetch` now only fires `sencho-unauthorized` when the `x-sencho-proxy: 1` header is absent (i.e., a genuine local session failure, not a remote node auth error).
- `authMiddleware` and WS upgrade handler now evaluate `bearerToken || cookieToken` (Bearer first) — cookie no longer shadows a valid Bearer token on node-to-node proxy calls.
- Remote node proxy stripping the `/api` path prefix — added `pathRewrite: (path) => '/api' + path` to restore the full path when forwarding to remote instances.
- Remote node HTTP proxy body forwarding — replaced `proxyReq.write(JSON.stringify(req.body))` (raced against `http-proxy`'s `process.nextTick(proxyReq.end)`) with a conditional JSON body parser that skips `express.json()` for remote-targeted requests; the raw `IncomingMessage` stream is left unconsumed so `http-proxy`'s `req.pipe(proxyReq)` forwards it intact.
- Remote node proxy forwarding the browser's `sencho_token` cookie to the remote instance — stripped in `proxyReq` so only the Bearer token is used.
- Remote WebSocket upgrades forwarding the browser `cookie` header — stripped before `wsProxyServer.ws()` so the remote's `authMiddleware` uses the Bearer token exclusively.
- `nodeContextMiddleware` blocking `/api/nodes` when `x-node-id` references a deleted node — exempted alongside `/api/auth/` so the frontend can re-sync a stale node ID.
- Backend memory leak from `createProxyMiddleware` called inside the request handler on every API call — refactored to a single globally-instantiated proxy using the `router` option.
- `remoteNodeProxy` error handler unsafely cast `proxyRes` to `Response` on WebSocket/TCP-level errors — type-narrowed before sending 502.

#### WebSocket & Streaming
- Container stats WebSocket flooding React with up to 20+ `setState` calls per second — replaced with a ref-buffer + 1.5 s flush interval pattern.
- `streamStats` Docker stats stream leaking after WebSocket client disconnect — `ws.on('close')` handler calls `stats.destroy()`; all `ws.send()` calls guarded with `readyState === OPEN`.
- `streamStats` and `execContainer` called unawaited — unhandled promise rejections now chain `.catch()`, log the error, and close the WebSocket cleanly.
- Per-connection `WebSocket.Server` instances for stack logs and host console never closed after upgrade — `wss.close()` called immediately after `handleUpgrade`.
- WebSocket notification reconnect upgraded to exponential backoff (1 s → 30 s max) instead of flat 5-second retry; `ws.onerror` logs the event; cleanup guards against closing an already-closing socket.
- Terminal logs and container stats WebSockets failing with "HTTP Authentication failed" on remote nodes — gateway's `cookie` header stripped before forwarding to remote; `nodeId` query param stripped from forwarded URL.
- LogViewer returning 404 on remote nodes — `nodeId` query param stripped from `proxyReq.path` in `onProxyReq`.

#### UI & Frontend
- Blank page on HTTP deployments (root cause — Helmet 8 default CSP `upgrade-insecure-requests` and HSTS) — `upgradeInsecureRequests: null` and `strictTransportSecurity: false` set explicitly.
- COOP header console warning on HTTP deployments — `crossOriginOpenerPolicy: false`.
- Inline script CSP violation from Vite module-preload polyfill — disabled via `build.modulePreload.polyfill: false`.
- CSP `workerSrc` missing (Monaco editor workers) — added `worker-src 'self' blob:`.
- CSP `connectSrc` implicit — added explicit `connect-src 'self' ws: wss:`.
- Docker socket `EACCES` root:root edge case — entrypoint handles GID 0 in addition to the standard root:docker case.
- Managed container count wrong when stacks launched from COMPOSE_DIR root — classification now uses `com.docker.compose.project.working_dir`.
- Browser Out of Memory crash in `GlobalObservabilityView` — capped DOM rendering to last 300 entries, reduced SSE log cap to 2,000 entries, replaced `key={idx}` with monotonic `_id` counter.
- `HomeDashboard` create-stack error handling — reads JSON error body before throwing; uses defensive toast pattern.
- `AlertDialogContent` using `asChild` with `motion.div` wrapper crashing on delete-stack confirmation — replaced with CSS keyframe animations.
- animate-ui `auto-height.tsx` importing `WithAsChild` without `type` keyword — crashed browser module loader.
- animate-ui `switch.tsx` double-spreading Radix props onto `motion.button` DOM element.
- "Always Local" badge tooltip crashing (`getStrictContext`) — replaced animate-ui tooltip with pure Radix primitives.
- Cancel/Add Node buttons in NodeManager dialogs stuck together.
- Resources/App Store/Logs menu buttons not toggling off on second click.
- Monaco container height accumulation on tab switching — reset to 0×0 and force synchronous reflow before re-measuring.
- `AppStoreView` and `GlobalObservabilityView` using raw `fetch()` instead of `apiFetch()` — all calls now inject `x-node-id`.
- `HostConsole` WebSocket URL missing `?nodeId=` query parameter.
- "Open App" button opening `http://localhost:{port}` for remote node containers — resolves hostname from remote node's `api_url`.
- Dashboard cards showing stale local-node data after switching to a remote node — polling effects now depend on `activeNode?.id` and clear state immediately on node change.
- `refreshStacks` crashing with `SyntaxError` or `TypeError` when the remote proxy returns a non-JSON response — checks `res.ok` before calling `res.json()`.
- Four empty `catch {}` blocks in `EditorLayout` — now surface errors via `toast.error()`.
- `StackAlertSheet` not fetching notification agent status from the active node on open.
- `SettingsModal` Notifications tab hidden when a remote node is active — now visible and configurable on remote nodes.
- `POST /api/alerts` now validates the request body with a Zod schema — rejects unknown metric/operator values, negative thresholds, and missing fields with a structured 400.
- `WebSocket.Server` replaced with named import `WebSocketServer` from `ws` to fix ESM/CJS interop.
- `NodeProvider` mounted outside the auth gate — moved inside the authenticated branch so `refreshNodes` no longer fires before authentication.
- Infinite re-fetch loop in `NodeContext` — `refreshNodes` useCallback no longer depends on `activeNode` state; replaced with `useRef`.
- Infinite page reload loop — `apiFetch` replaced `window.location.href = '/'` with a `sencho-unauthorized` custom event.
- API Token copy button failing silently on HTTP/non-localhost — added `execCommand('copy')` fallback.
- E2E nodes tests permanently timing out because the Add Node submit button requires `api_token` to be non-empty.
- ESLint CI step — replaced all `any` annotations with proper types, fixed unused catch variables.
- `[DEP0060] DeprecationWarning: util._extend` from `http-proxy@1.18.1` — suppressed at call site.
- Global Logs false-positive error misclassifications — replaced naive regex with a robust 3-tier classification engine.
- Memory leak in `GlobalObservabilityView` SSE mode — log array capped at 2,000 entries.
- Historical metrics memory leak — polling throttled to 60 s; SQLite payload downsampled by 12×.
- Active node UI dropdown desyncing from API requests on initial page load — state hydrated from localStorage.
- `MonitorService` crash (`Cannot read properties of undefined (reading 'cpu_usage')`) during Docker container transition states.
- Deleted node ghost API calls — 404 errors intercepted globally, forcing UI to resync to default node.
- Horizontal UI overflow in Node Manager settings on smaller resolutions.
- Docker API parsing bug where HTML string responses from misconfigured ports were counted as containers.

### Changed

- **Architecture:** Replaced SSH/SFTP remote node model with Distributed API proxy (HTTP/WebSocket) — remote nodes now only require an API URL and Bearer token. Node Manager UI vastly simplified.
- **Docs:** Migrated Mintlify config from deprecated `mint.json` to `docs.json` v2 format; bootstrapped full user-facing documentation (configuration, stack management, editor, multi-node, alerts, dashboard, resources, app store, observability, settings reference, troubleshooting, backup & restore).
- **Design system:** Animated UI overhaul — new brand cyan token, spring-based animations on dialogs/tooltips/switches/tabs, dark mode shadow strengthening, Geist font now actually loaded.
- Notification delivery replaced polling with WebSocket push — no more `setInterval` in `EditorLayout`.
- `DatabaseService.addNotificationHistory` returns the full inserted record for real-time broadcasting.
- `SettingsModal` overhauled — per-operation loading states, skeleton loader, unsaved-changes indicator, all saves use `PATCH /api/settings`.
- `MonitorService` evaluates limits and detects container crashes across all registered nodes concurrently.
- `MonitorService` reads retention settings dynamically each cycle.
- Developer settings scoped to the local node — reads/writes always target local via `localOnly` regardless of active node.
- Dark mode scrollbar styling — no more white native scrollbars.
- Rebranded "Templates" → "App Store", "Ghost Containers" → "Unmanaged Containers", "Observability" → "Logs".
- Global logs display chronologically (newest at bottom) with smooth auto-scrolling; UTC → local browser timezone.
- Historical CPU/RAM charts relocated to the Home Dashboard; data normalized (CPU relative to host cores, RAM to GB).
- `EditorLayout` main workspace container keyed to `activeView` — every view switch triggers a fade-up entrance animation.

### Removed

- SSH/SFTP remote node adapters (`IFileAdapter`, `LocalFileAdapter`, `SSHFileAdapter`, `SSHFileAdapter`, `ComposeService.executeRemote`, `ComposeService.streamLogs` SSH path) — ~500 lines.

[0.1.0]: https://github.com/AnsoCode/Sencho/releases/tag/v0.1.0
