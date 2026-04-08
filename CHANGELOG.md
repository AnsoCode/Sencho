# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

* **fleet:** fix false "Update available" on remote nodes whose `api_url` has a trailing slash, causing `fetchRemoteMeta` to construct a double-slash URL that fails silently

## [0.41.1](https://github.com/AnsoCode/Sencho/compare/v0.41.0...v0.41.1) (2026-04-08)


### Fixed

* **fleet:** resolve self-update compose file access and improve completion detection ([#441](https://github.com/AnsoCode/Sencho/issues/441)) ([6fff2c2](https://github.com/AnsoCode/Sencho/commit/6fff2c2d35dcc4fb13a363c803b5c16e24879694))

## [0.41.0](https://github.com/AnsoCode/Sencho/compare/v0.40.0...v0.41.0) (2026-04-08)


### Added

* **contact:** add official contact emails throughout app and docs ([#428](https://github.com/AnsoCode/Sencho/issues/428)) ([8e0857e](https://github.com/AnsoCode/Sencho/commit/8e0857e7f62d89434768da5f57223ae25276b33d))
* **dashboard:** add node badge to Recent Alerts for remote node alerts ([#423](https://github.com/AnsoCode/Sencho/issues/423)) ([a6849ae](https://github.com/AnsoCode/Sencho/commit/a6849aedabc06cd85a74a915445765ff6f857f6f))
* **resources:** add loading toast for prune, delete, and purge operations ([#426](https://github.com/AnsoCode/Sencho/issues/426)) ([f6d2199](https://github.com/AnsoCode/Sencho/commit/f6d219997875be46c5c207a7960dd13dad118f3e))


### Fixed

* **billing:** hide billing portal for lifetime licenses ([#427](https://github.com/AnsoCode/Sencho/issues/427)) ([be7eda8](https://github.com/AnsoCode/Sencho/commit/be7eda85f19afe34c311f1fcf751f9a3180cc837))
* **console:** send proxy tier headers for remote node console-token requests ([#424](https://github.com/AnsoCode/Sencho/issues/424)) ([2354bee](https://github.com/AnsoCode/Sencho/commit/2354beed02b52ef4ddd90a861e0037e7d3d090b8))
* **resources:** unify container/resource classification with multi-fallback resolution ([#425](https://github.com/AnsoCode/Sencho/issues/425)) ([662bc1a](https://github.com/AnsoCode/Sencho/commit/662bc1a210386e32cd24b33f155ecf6adfda6d8f))

## [Unreleased]

### Added

* **dashboard:** show remote node badge on Recent Alerts card, matching the notification panel style, so users can identify which node generated each alert.

### Fixed

* **fleet:** resolve self-update "compose file not found" failure by using a helper container that mounts the compose directory from the host, eliminating the dependency on the compose file being accessible inside the main container.
* **fleet:** improve update completion detection with a new "version current" signal (fires when the remote reaches the gateway version) and extend the early failure heuristic from 90 seconds to 3 minutes for slower connections.
* **fleet:** distinguish between "node unreachable" and "node does not support self-update" error messages when triggering remote updates.
* **fleet:** add admin role requirement to the `/api/system/update` endpoint, preventing non-admin users from triggering self-updates.

## [0.40.0](https://github.com/AnsoCode/Sencho/compare/v0.39.6...v0.40.0) (2026-04-07)


### Added

* **nav:** add pulsing animation to local node status dot ([#418](https://github.com/AnsoCode/Sencho/issues/418)) ([8920d8c](https://github.com/AnsoCode/Sencho/commit/8920d8c55a95e3b4e799489dd757627f218a3d11))


### Fixed

* **auto-update:** proxy update execution to remote nodes via Distributed API ([#419](https://github.com/AnsoCode/Sencho/issues/419)) ([ca8f227](https://github.com/AnsoCode/Sencho/commit/ca8f22734d1c6f960cf564cf9fa9588396fbd1fd))
* **nav:** remove toggle behavior on navigation tabs ([#417](https://github.com/AnsoCode/Sencho/issues/417)) ([5b06992](https://github.com/AnsoCode/Sencho/commit/5b06992e055a8a30c2b3f1cf746cbd2c9b099061))
* **schedules:** filter auto-update policies from Scheduled Operations view ([#420](https://github.com/AnsoCode/Sencho/issues/420)) ([455bfa8](https://github.com/AnsoCode/Sencho/commit/455bfa8734bf70ffad54b6fc3192ba1f9f16ce39))
* **sidebar:** resolve stacks showing unknown status when compose name field is set ([#416](https://github.com/AnsoCode/Sencho/issues/416)) ([88011e1](https://github.com/AnsoCode/Sencho/commit/88011e1b16975033e9212de3d61aa4987237ead2))

## [Unreleased]

### Added

* **resources:** loading toast notification during prune, delete, and purge operations in the Resources Hub. A spinning indicator with an indeterminate progress bar now appears while the operation runs, replacing the previous dead moment between confirmation and result.
* **contact:** add official contact emails throughout the app, website, and documentation. Six dedicated channels (support, contact, licensing, security, privacy, conduct) are now surfaced in contextually appropriate locations including upgrade prompts, legal pages, security policy, and a new Contact & Support docs page.
* **security:** add `.well-known/security.txt` to both the app and marketing website per RFC 9116.

### Fixed

* **console:** fix remote node Host Console failing with "Connection error" / 502. The gateway's console-token request to the remote node was missing license tier headers, causing the remote's Admiral license gate to reject the request. Both the HTTP fetch and the WS upgrade handler now correctly propagate proxy tier headers for console_session tokens.
* **billing:** hide the Billing button in the profile dropdown for lifetime licenses. Previously it was shown but always failed with "No billing portal available" because lifetime licenses have no recurring subscription. The Manage Subscription button in Settings already had this guard; now both entry points are consistent.
* **auto-update:** resolve failure when executing auto-update policies on remote Distributed API nodes. Previously, the scheduler tried to access the remote Docker daemon directly, which is not supported. Now the update execution is proxied to the remote Sencho instance via HTTP, matching the existing Distributed API architecture.
* **schedules:** auto-update policies no longer appear in the Scheduled Operations list. Each view now fetches only its relevant task type via server-side action filtering.
* **console:** fix remote node Console returning 502 by injecting proxy tier headers into console-token fetch and WS upgrade handler.
* **sidebar:** strengthen stack-to-container resolution with a multi-fallback strategy (project label, working_dir, service name, config_files path) to handle containers that predate Sencho's compose file reorganization.
* **resources:** fix incorrect "External" tagging in Resources Hub by applying the same multi-fallback resolution to image, volume, and network classification. Extracted shared helpers (`resolveContainerStack`, `resolveProjectLabel`, `buildAbsDirMap`) to unify logic across all classification and prune methods.
* **dashboard:** fix "active" label on Containers card to use correct plural form ("actives").

## [0.39.6](https://github.com/AnsoCode/Sencho/compare/v0.39.5...v0.39.6) (2026-04-07)


### Fixed

* **fleet:** resolve ENOENT when triggering remote node self-update ([#413](https://github.com/AnsoCode/Sencho/issues/413)) ([1b890b4](https://github.com/AnsoCode/Sencho/commit/1b890b4d03f1e3dcf813cb74105192f49328df17))

## [0.39.5](https://github.com/AnsoCode/Sencho/compare/v0.39.4...v0.39.5) (2026-04-07)


### Fixed

* **fleet:** resolve version detection using package.json over stale generated constant ([#410](https://github.com/AnsoCode/Sencho/issues/410)) ([8ba4532](https://github.com/AnsoCode/Sencho/commit/8ba4532995bd8c92c92dae2a2c05b5d8c6abc4d5))

## [0.39.4](https://github.com/AnsoCode/Sencho/compare/v0.39.3...v0.39.4) (2026-04-07)


### Fixed

* **fleet:** resolve stuck update states and improve detection ([#405](https://github.com/AnsoCode/Sencho/issues/405)) ([cc2da99](https://github.com/AnsoCode/Sencho/commit/cc2da99d6f2ac4fad5fba03006377f54262a6dd2))

## [Unreleased]

### Fixed

* **sidebar:** fix stacks showing "--" (unknown) instead of "UP" when their compose file uses a top-level `name:` field. The bulk status endpoint matched containers by the `com.docker.compose.project` Docker label against directory names, but a `name:` override causes the label to differ. The fix parses compose files to build a correct project-name-to-directory mapping (cached with 60s TTL), with a fallback to the `working_dir` label for edge cases.
* **sidebar:** fix stacks still showing "--" after Sencho reorganized compose files into subdirectories. Containers that predate the reorganization carry stale Docker labels (project set to the COMPOSE_DIR basename). Added service name and config_files path fallbacks to the container-to-stack matching logic.
* **fleet:** fix `spawnSync /bin/sh ENOENT` when triggering remote node self-update. The `execSync` call used `cwd: workingDir` from Docker Compose labels, which is a host-side path that does not exist inside the container. Removed `cwd` (the `-f` flag already provides the absolute compose file path), added `shell: true`, and added a Docker Compose CLI availability check at startup.
* **fleet:** fix version detection returning stale value from `generated/version.ts` instead of the authoritative `package.json`. This caused remote nodes to show "unknown" version and false "Update available" badges when both nodes were on the same version. `resolveVersion()` now reads the root `package.json` first and only falls back to the build-time constant if the walk fails.
* **fleet:** fix permanently stuck "Timed out" / "Failed" badges after node update attempts. The in-memory update tracker now supports clearing via a new DELETE endpoint, and terminal states are automatically clearable through the Recheck button.
* **fleet:** fix update completion detection for remote nodes that cannot report their version. The gateway now uses three completion signals: version change, process restart detection (`startedAt`), and offline/online detection (node went unreachable during update and came back). This eliminates false timeouts on nodes running older Sencho versions.
* **fleet:** fix 409 race condition where retrying a timed-out update was rejected because the tracker still showed "updating". The POST trigger now detects expired timeouts and allows re-triggering.
* **fleet:** populate error messages in the update tracker so users can see why an update failed or timed out.
* **fleet:** detect probable image pull failures within 90 seconds instead of waiting the full 5-minute timeout. If the node is still running unchanged after 90 seconds, the update is marked as "Failed" with a descriptive message.
* **fleet:** surface remote self-update pull errors via `/api/meta` so the gateway can immediately report failures instead of timing out.

### Added

* **fleet:** retry and dismiss buttons on failed/timed-out update badges, with animated cursor hover detail showing the error message
* **fleet:** "Recheck" button now clears all failed and timed-out states before fetching fresh status, with a loading spinner
* **fleet:** auto-expire "completed" update status after 60 seconds so nodes return to "Up to date" automatically
* **fleet:** "Update All" now retries nodes that previously timed out or failed

## [0.39.3](https://github.com/AnsoCode/Sencho/compare/v0.39.2...v0.39.3) (2026-04-06)


### Fixed

* **fleet:** resolve version detection pipeline for Docker builds ([#402](https://github.com/AnsoCode/Sencho/issues/402)) ([a55d124](https://github.com/AnsoCode/Sencho/commit/a55d1245f88b377a6a940cee38bc673987465d75))

## [0.39.2](https://github.com/AnsoCode/Sencho/compare/v0.39.1...v0.39.2) (2026-04-06)


### Fixed

* **fleet:** filter invalid version strings from UI display ([#399](https://github.com/AnsoCode/Sencho/issues/399)) ([2089e75](https://github.com/AnsoCode/Sencho/commit/2089e75ef1e973f3e04aa6cc448211db35d95848))

## [0.39.1](https://github.com/AnsoCode/Sencho/compare/v0.39.0...v0.39.1) (2026-04-06)


### Fixed

* **fleet:** resolve getSenchoVersion crash in Docker containers ([#396](https://github.com/AnsoCode/Sencho/issues/396)) ([670a429](https://github.com/AnsoCode/Sencho/commit/670a42916899954f805ddb0aa50d106e5617d037))

## [0.39.0](https://github.com/AnsoCode/Sencho/compare/v0.38.6...v0.39.0) (2026-04-06)


### Added

* add automated docs pipeline and scaffold /docs folder ([9496b14](https://github.com/AnsoCode/Sencho/commit/9496b14f723858d7134e90bf27d921791045dacf))
* add Community/Pro licensing, fleet view, and UI reorganization ([#145](https://github.com/AnsoCode/Sencho/issues/145)) ([4f26f22](https://github.com/AnsoCode/Sencho/commit/4f26f22ccef89441be032a266723cf6fca0a488a))
* add dynamic template registry and smart volume path sanitizer ([536a714](https://github.com/AnsoCode/Sencho/commit/536a714d9b9c5f41d694df9f89733356ea61d167))
* add update-screenshots CI job and screenshot capture spec ([ed8b8e3](https://github.com/AnsoCode/Sencho/commit/ed8b8e33b6b52d9cefef9a2a677a9e12a1b34e61))
* Advanced Error Handling & Probes ([b90db01](https://github.com/AnsoCode/Sencho/commit/b90db0124ce168c08c7356a4b94ccb9599c0edc9))
* **api-tokens:** add scoped API tokens for CI/CD automation (Team Pro) ([#220](https://github.com/AnsoCode/Sencho/issues/220)) ([8d8118c](https://github.com/AnsoCode/Sencho/commit/8d8118c963a1c3b10872041ea0f645d8f0a65196))
* **api:** add global rate limiter for all API endpoints ([#317](https://github.com/AnsoCode/Sencho/issues/317)) ([b28ebfa](https://github.com/AnsoCode/Sencho/commit/b28ebfa6ffff7fa76657c67e5fdb3494a76bd8a1))
* App Store Polish ([5c7e08a](https://github.com/AnsoCode/Sencho/commit/5c7e08a3912d85c82964ae9bed1e5f56254eacac))
* App Templates & One-Click Installs ([b519fbb](https://github.com/AnsoCode/Sencho/commit/b519fbbddff66cedcd191ccb7d3290cdcfd6f541))
* **app-store:** category filter bar + custom registry settings ([ae4540b](https://github.com/AnsoCode/Sencho/commit/ae4540bf4613c2ae416c828b622bb4e198f1a11f))
* **app-store:** category filter bar and custom registry settings ([34cad76](https://github.com/AnsoCode/Sencho/commit/34cad76d45fe7212bd61aa514f40e13217e2fd8e))
* audit logging, secrets at rest, and legacy cleanup ([#205](https://github.com/AnsoCode/Sencho/issues/205)) ([1799030](https://github.com/AnsoCode/Sencho/commit/179903006035280d5c1655daaf3dbe3384588bf0))
* **audit-log:** add configurable retention, export, Auditor role, and enhanced filtering ([#258](https://github.com/AnsoCode/Sencho/issues/258)) ([d586ce3](https://github.com/AnsoCode/Sencho/commit/d586ce393af34c8cc34cd046d2d90a70e0d79964))
* **auth:** redesign Login and Setup pages with split-panel branding layout ([#153](https://github.com/AnsoCode/Sencho/issues/153)) ([e0319b5](https://github.com/AnsoCode/Sencho/commit/e0319b5daebbae88b942ba55f6891ce0e2ecaf29))
* **auth:** redesign Login and Setup pages with split-panel branding layout ([#168](https://github.com/AnsoCode/Sencho/issues/168)) ([f80190d](https://github.com/AnsoCode/Sencho/commit/f80190d926c1d768ee1282861dffc7d272f06e21))
* auto-refresh doc screenshots on develop push ([eaf2177](https://github.com/AnsoCode/Sencho/commit/eaf217720c42a07cce7afadd673178c886717878))
* **auto-update:** add auto-update policies and fix image update detection ([#297](https://github.com/AnsoCode/Sencho/issues/297)) ([28c7a8f](https://github.com/AnsoCode/Sencho/commit/28c7a8fd544f33ea0fbe90f19ed96154743eb527))
* automated docs pipeline ([05a6b93](https://github.com/AnsoCode/Sencho/commit/05a6b93af0b2de04e70565445178873d5f858348))
* **ci:** add release-please automated versioning workflow ([c2d5d37](https://github.com/AnsoCode/Sencho/commit/c2d5d37be41267e71bb8515010b049fcd31f5d6b))
* **ci:** add release-please automated versioning workflow ([c2d5d37](https://github.com/AnsoCode/Sencho/commit/c2d5d37be41267e71bb8515010b049fcd31f5d6b))
* **ci:** add release-please automated versioning workflow ([c294def](https://github.com/AnsoCode/Sencho/commit/c294def7ccce1705be55e38e19c7da4f7341c3f4))
* **ci:** automated versioning with release-please ([c991b81](https://github.com/AnsoCode/Sencho/commit/c991b8121edcd30bd6806e959d0dcd14711f439f))
* **ci:** automated versioning with release-please ([c991b81](https://github.com/AnsoCode/Sencho/commit/c991b8121edcd30bd6806e959d0dcd14711f439f))
* **dashboard:** redesign as DevOps command center ([#371](https://github.com/AnsoCode/Sencho/issues/371)) ([2ee959e](https://github.com/AnsoCode/Sencho/commit/2ee959ec3b696c5beba7b8b62bec2221ca65d525))
* Deployment Freedom & Polish ([a6bf1a3](https://github.com/AnsoCode/Sencho/commit/a6bf1a3b9672c098187991e01a47247ee1008f07))
* **design:** animated design system foundation with animate-ui and motion ([c34092f](https://github.com/AnsoCode/Sencho/commit/c34092f8ec07fa84e1bb83775ac767c6cb2dd744))
* **design:** animated design system foundation with animate-ui and motion ([0cb5fae](https://github.com/AnsoCode/Sencho/commit/0cb5fae947ac69b5e3b6c06c82d2f2870e6600de))
* **docker:** add linux/arm64 platform support via xx cross-compilation ([cf19390](https://github.com/AnsoCode/Sencho/commit/cf19390fd559a0ee49b9c2b08675565afd715dd5))
* **docker:** add linux/arm64 platform support via xx cross-compilation ([cf19390](https://github.com/AnsoCode/Sencho/commit/cf19390fd559a0ee49b9c2b08675565afd715dd5))
* Dynamic Templates & Sanitizer ([c05654b](https://github.com/AnsoCode/Sencho/commit/c05654bdf9eacdd11c35a3eadf10ba8573e40bae))
* Enterprise Logs & Dev Mode ([b32cf54](https://github.com/AnsoCode/Sencho/commit/b32cf5490c36c6ad42dce13c847233d4855d91c3))
* **fleet:** add Pro fleet management features and container drill-down ([#174](https://github.com/AnsoCode/Sencho/issues/174)) ([0630f57](https://github.com/AnsoCode/Sencho/commit/0630f57ca87451352e7c50d511522ac621771458))
* **fleet:** add remote node update management ([#353](https://github.com/AnsoCode/Sencho/issues/353)) ([87b5908](https://github.com/AnsoCode/Sencho/commit/87b59082887902af24ad2bf88ae3d4d4c941411e))
* **host-console:** gate Host Console behind Admiral tier ([#277](https://github.com/AnsoCode/Sencho/issues/277)) ([b5d3f49](https://github.com/AnsoCode/Sencho/commit/b5d3f497cb1a09fdc2107f4ef720ebb7f07cbd87))
* implement app templates storefront and deployment engine ([1676dc2](https://github.com/AnsoCode/Sencho/commit/1676dc22dfc62a4584e4896732a99b951bfb2fe2))
* implement centralized logging and historical metrics dashboard ([a4a5365](https://github.com/AnsoCode/Sencho/commit/a4a5365da1036a5fc381f49d09f353b1bff6ec43))
* implement dynamic volumes, custom env vars, and timezone detection ([f2fbca1](https://github.com/AnsoCode/Sencho/commit/f2fbca17b719f72c139a6e18c420ca8bddfbdb98))
* implement enterprise sse global logs and developer mode ([448a64a](https://github.com/AnsoCode/Sencho/commit/448a64a10deb022a7c96c10fac7463bd83e231e6))
* implement pre-deploy collision checks and universal two-stage t… ([12aab3a](https://github.com/AnsoCode/Sencho/commit/12aab3a5aef1ef2dcb80631646220190919d36a1))
* implement pre-deploy collision checks and universal two-stage teardown ([b979525](https://github.com/AnsoCode/Sencho/commit/b97952567d23448fcc5c0ae3fe2a34e3c704c326))
* implement real-time container log streaming via SSE ([49cef7a](https://github.com/AnsoCode/Sencho/commit/49cef7acfa6cb8176accfa4019933d94f5aa114d))
* implement real-time container log streaming via SSE ([b765403](https://github.com/AnsoCode/Sencho/commit/b765403dcfb4319fbe178d1b3a19d9823f74d2d5))
* implement remote tls/ssh security, isolate system stats, and polish ux ([2a37e11](https://github.com/AnsoCode/Sencho/commit/2a37e114df76a7f09a262b634074c4c190ecd38d))
* implement smart error parser and post-deploy health probe ([953049a](https://github.com/AnsoCode/Sencho/commit/953049a45dfba4f413e71767004f69c601469e43))
* integrate official lsio api and rich template metadata ([f9e8874](https://github.com/AnsoCode/Sencho/commit/f9e8874f6c6ef454912ca69dac12802e59000df5))
* **labels:** add stack labels for organizing, filtering, and bulk actions ([#341](https://github.com/AnsoCode/Sencho/issues/341)) ([28e7be6](https://github.com/AnsoCode/Sencho/commit/28e7be652cb18abdd51ca6df8eda2104d213dc30))
* **license:** distributed license enforcement across multi-node setups ([#359](https://github.com/AnsoCode/Sencho/issues/359)) ([6c26ae3](https://github.com/AnsoCode/Sencho/commit/6c26ae3f501d438dcde5331bae588ee6e26c2c3e))
* **multi-node:** warn when configuring remote node with plain HTTP URL ([#292](https://github.com/AnsoCode/Sencho/issues/292)) ([e587256](https://github.com/AnsoCode/Sencho/commit/e587256086997a784007a69d8a7fd56881d0a9b1))
* **nodes:** add capability-based node compatibility negotiation ([#350](https://github.com/AnsoCode/Sencho/issues/350)) ([ee75811](https://github.com/AnsoCode/Sencho/commit/ee75811e255e8d5f9ae87117d12c2902185d98f1))
* **nodes:** add per-node scheduling and update visibility ([#344](https://github.com/AnsoCode/Sencho/issues/344)) ([efbd20f](https://github.com/AnsoCode/Sencho/commit/efbd20fed57299acae43ecaee3b1d9ff52da5aae))
* **notifications:** add shared notification routing rules (Admiral tier) ([#347](https://github.com/AnsoCode/Sencho/issues/347)) ([1b573f5](https://github.com/AnsoCode/Sencho/commit/1b573f542a36cde3e94c05f285d34330df96edb1))
* **notifications:** aggregate alerts from all connected nodes in the notification panel ([16f55bb](https://github.com/AnsoCode/Sencho/commit/16f55bbb40fedc4e8ae6344671ddd016faf78151))
* **notifications:** aggregate alerts from all nodes in the notification panel ([1690f0d](https://github.com/AnsoCode/Sencho/commit/1690f0d3c6b80f0825d71d32f4c6bdd3f07a1290))
* **notifications:** replace polling with WebSocket push ([4d1aef7](https://github.com/AnsoCode/Sencho/commit/4d1aef744b8fe9195ceb5dcafbaf593d216ff8e0))
* **notifications:** replace polling with WebSocket push ([a5ac3e4](https://github.com/AnsoCode/Sencho/commit/a5ac3e4981383eda70f4817c530e89872c3639b6))
* Official LSIO API Integration ([33b4881](https://github.com/AnsoCode/Sencho/commit/33b48811d80a413b394fc85a5f03cfabeed26761))
* polish app store ui and add advanced deployment configuration ([44acfd7](https://github.com/AnsoCode/Sencho/commit/44acfd7d90d283a734b225b086f44d63bfac7e0e))
* RBAC, atomic deployments, and fleet-wide backups (Pro) ([#181](https://github.com/AnsoCode/Sencho/issues/181)) ([db73d76](https://github.com/AnsoCode/Sencho/commit/db73d7671a22b72756a16594004d9767970d4190))
* RBAC, atomic deployments, fleet backups, and licensing (Pro) ([#185](https://github.com/AnsoCode/Sencho/issues/185)) ([32a7d53](https://github.com/AnsoCode/Sencho/commit/32a7d53b2b1b9b3d2a067433c9e77709ade96697))
* **rbac:** add Deployer & Node Admin roles with scoped permissions (Team Pro) ([#253](https://github.com/AnsoCode/Sencho/issues/253)) ([8380fba](https://github.com/AnsoCode/Sencho/commit/8380fbad4b617b004e2d2f19595d1490eaa1e005))
* **registries:** add private registry credential management (Team Pro) ([#240](https://github.com/AnsoCode/Sencho/issues/240)) ([244c83a](https://github.com/AnsoCode/Sencho/commit/244c83a0c3102a797658d35d087bf47366f6df75))
* Remote Nodes Foundation ([457c997](https://github.com/AnsoCode/Sencho/commit/457c9976bc40e5e48f0415c6ca13f435d3713424))
* Remote Nodes Foundation (Strategy B) - Add nodes table with auto-seeded default local node in DatabaseService - Create NodeRegistry service for multi-instance Docker daemon connections - Add 6 Node management API endpoints (CRUD + test connection) - Create NodeManager component with table UI and connection testing - Add NodeContext for frontend-wide active node state management - Add node switcher dropdown to sidebar (visible when &gt;1 node) - Add Nodes tab to Settings Hub ([02e1ebe](https://github.com/AnsoCode/Sencho/commit/02e1ebe1b66a75d24f967fefe3839b4ad7ec4cfc))
* Remote Nodes Security & Polish ([2373043](https://github.com/AnsoCode/Sencho/commit/23730430d747c23dc13cbb90ed07186240a1d0e0))
* Remote Nodes Wiring & SSH Adapters ([8a4f887](https://github.com/AnsoCode/Sencho/commit/8a4f8874dede12443129c1ab87a8c581513b5cf4))
* Remote Nodes Wiring & SSH Adapters ([8c51198](https://github.com/AnsoCode/Sencho/commit/8c51198468805a20410a0e9eaed7cc5b0a53546b))
* **resources:** add network management with create, inspect, and topology ([#338](https://github.com/AnsoCode/Sencho/issues/338)) ([24299a0](https://github.com/AnsoCode/Sencho/commit/24299a0115ce0371f44608f8d64248e6474df8ce))
* **resources:** add network management with create, inspect, and topology visualization ([#335](https://github.com/AnsoCode/Sencho/issues/335)) ([4488637](https://github.com/AnsoCode/Sencho/commit/4488637656b8a19f8df2fcea7ffafff023786068))
* **resources:** managed/unmanaged resource separation across Resources Hub ([2a444bd](https://github.com/AnsoCode/Sencho/commit/2a444bde99e13b2e94fa2476f463399840d0e3bf))
* **resources:** managed/unmanaged resource separation across Resources Hub ([5191737](https://github.com/AnsoCode/Sencho/commit/5191737d5365fcc607358993298aad40ab7c2d26))
* **scheduled-ops:** add failure notifications, granular targeting, and history export ([#286](https://github.com/AnsoCode/Sencho/issues/286)) ([eccdd1b](https://github.com/AnsoCode/Sencho/commit/eccdd1b87903c17af822edb0cdb4236812929bd2))
* **scheduled-ops:** add scheduled operations for Team Pro users ([#231](https://github.com/AnsoCode/Sencho/issues/231)) ([31e1795](https://github.com/AnsoCode/Sencho/commit/31e1795af06beaa68ec6e2240d83b7656ab549f7))
* **settings:** harden settings API and overhaul SettingsModal ([23a2259](https://github.com/AnsoCode/Sencho/commit/23a22598abb9185996b6180cb2c78f0311efd4c6))
* **settings:** harden settings API and overhaul SettingsModal ([322e717](https://github.com/AnsoCode/Sencho/commit/322e7175140b1b11db79854d43c322fe2b860b93))
* **settings:** replace static license CTA with dynamic upgrade cards ([#201](https://github.com/AnsoCode/Sencho/issues/201)) ([d3828e8](https://github.com/AnsoCode/Sencho/commit/d3828e885d78b23902a3a82186dcd009e3f2c0d9))
* **settings:** scope split — developer settings always target local node ([f7e8e40](https://github.com/AnsoCode/Sencho/commit/f7e8e409158e038404d4a531331b09d7c37f5113))
* SSO & LDAP authentication for Team Pro ([#209](https://github.com/AnsoCode/Sencho/issues/209)) ([bd4008f](https://github.com/AnsoCode/Sencho/commit/bd4008f5091122f74967b4debdd4c4f046693f46))
* stack context menu, tier icons, centered logo & support ([#194](https://github.com/AnsoCode/Sencho/issues/194)) ([dda1671](https://github.com/AnsoCode/Sencho/commit/dda1671e5a4c6788ba5ad97b00cbac98910f3ef0))
* **stack-management:** add scan stacks folder button ([#332](https://github.com/AnsoCode/Sencho/issues/332)) ([6f74153](https://github.com/AnsoCode/Sencho/commit/6f7415351f648120ab4039f1fcc9a1226cfa52f4))
* **stacks:** per-stack action tracking, optimistic status, and bulk status endpoint ([#362](https://github.com/AnsoCode/Sencho/issues/362)) ([dfd4d28](https://github.com/AnsoCode/Sencho/commit/dfd4d2858a023ed013afbe93c077a3152a0773c5))
* **stacks:** state-aware sidebar context menu and Open App action ([#368](https://github.com/AnsoCode/Sencho/issues/368)) ([55d3b8c](https://github.com/AnsoCode/Sencho/commit/55d3b8ca1dea6958cecf9d1672a6d891751f7ae3))
* **system:** background image update checker with stack badges ([ef5621e](https://github.com/AnsoCode/Sencho/commit/ef5621e48457341719dc743045c0923178d3b280))
* **system:** background image update checker with stack badges ([d64d23f](https://github.com/AnsoCode/Sencho/commit/d64d23fc5011f00ffd740589078613634e29bb84))
* UI polish sprint — 7 items + logs toolbar redesign ([#365](https://github.com/AnsoCode/Sencho/issues/365)) ([f9ebd1d](https://github.com/AnsoCode/Sencho/commit/f9ebd1d77c74434e641e2fc41f4f6d3de8cbeeee))
* **ui:** glassmorphism redesign with settings decomposition ([#274](https://github.com/AnsoCode/Sencho/issues/274)) ([7637091](https://github.com/AnsoCode/Sencho/commit/7637091e84838047c462e3dbce38122d4c24d007))
* **ui:** Phase 57 - Remote Context Navigation ([b7748b4](https://github.com/AnsoCode/Sencho/commit/b7748b4d170bb712db5f0851ed9cf2f9fa473f78))
* **ui:** Phase 57 - remote context UX (Option A) + network layer fixes ([04c770c](https://github.com/AnsoCode/Sencho/commit/04c770c198892618fa69713f47d3b8efbd44eab7))
* **ui:** redesign top bar with three-zone navigation layout ([#237](https://github.com/AnsoCode/Sencho/issues/237)) ([b7e7ee8](https://github.com/AnsoCode/Sencho/commit/b7e7ee8f55ec6bf89acc7bb54d47eab12ac940c5))
* **ui:** theme-aware sidebar logo with dark/light variants ([#74](https://github.com/AnsoCode/Sencho/issues/74)) ([b25574a](https://github.com/AnsoCode/Sencho/commit/b25574a427fcfabd69d13f7515e100fe652fbef7))
* Unified Observability ([935c2b0](https://github.com/AnsoCode/Sencho/commit/935c2b016a70d79a7c1249cd1ddbab0a6745d3f3))
* **webhooks:** add CI/CD webhook integration for triggering stack actions (Pro) ([#177](https://github.com/AnsoCode/Sencho/issues/177)) ([4fc3633](https://github.com/AnsoCode/Sencho/commit/4fc363301a1aaa442adbed83aebd21ca0e71c9c5))


### Fixed

* add --exclude='.git' to the rsync invocation. ([8902f6f](https://github.com/AnsoCode/Sencho/commit/8902f6fb4ccddb06f8dec7ef193fca817d2e686a))
* add linux/arm64 platform to Docker build for ARM server support ([12467c3](https://github.com/AnsoCode/Sencho/commit/12467c3fc1d19f43eb234802944300d7a36ccf56))
* add tls_ca, tls_cert, tls_key to frontend Node interface ([96b1105](https://github.com/AnsoCode/Sencho/commit/96b1105343402b888ddda98f76c0445b6b3aedf1))
* **alerts:** overhaul alerts & notifications system for local and remote nodes ([33c4976](https://github.com/AnsoCode/Sencho/commit/33c4976dc78832e0c8a53c92b1ad03ba01c44175))
* **alerts:** overhaul alerts & notifications system for local and remote nodes ([e190f3a](https://github.com/AnsoCode/Sencho/commit/e190f3ad8a0532d400a59216ccdc32218e7568c0))
* **api-tokens:** harden scope enforcement and add expiration support ([#224](https://github.com/AnsoCode/Sencho/issues/224)) ([954994c](https://github.com/AnsoCode/Sencho/commit/954994cdc01e5cee3e65153c2a302afed2da2b44))
* **api-tokens:** harden scope enforcement and block sensitive endpoints ([#228](https://github.com/AnsoCode/Sencho/issues/228)) ([5b607de](https://github.com/AnsoCode/Sencho/commit/5b607de227eecf4000208b347d8157f2d5d94651))
* App Store Polish & Rollbacks ([7935029](https://github.com/AnsoCode/Sencho/commit/7935029369e19ec1924e12979a5fcd7089fbe446))
* **backend,frontend:** correct docker socket connection on windows and fix api proxy in vite config ([4aa4bf1](https://github.com/AnsoCode/Sencho/commit/4aa4bf1b804bfee2046f17aea15cea1e96293db2))
* **backend:** remove broken remote branch in /api/system/stats ([3f473c5](https://github.com/AnsoCode/Sencho/commit/3f473c5c97d3d914df898dc8b590b04c838b85ff))
* cast req.params.id as string to resolve TS2345 type errors ([d2c5b2d](https://github.com/AnsoCode/Sencho/commit/d2c5b2de6711351df5947ebd4004c1fbbc659628))
* **charts:** suppress Recharts dimension warnings on initial render ([#141](https://github.com/AnsoCode/Sencho/issues/141)) ([c6633b0](https://github.com/AnsoCode/Sencho/commit/c6633b0245d10671aac78fedac875be63c62a1e1))
* **ci:** add linux/arm64 Docker build support with QEMU optimization ([#76](https://github.com/AnsoCode/Sencho/issues/76)) ([278f7f1](https://github.com/AnsoCode/Sencho/commit/278f7f18d91ccae8afda48275e8e62b9c2b86d4f))
* **ci:** add load: true to buildx so Trivy can find the built image ([353fd25](https://github.com/AnsoCode/Sencho/commit/353fd253e93356720243f2ccde8b34a5801cfc10))
* **ci:** correct release-please changelog section names and tag format ([ea57cbe](https://github.com/AnsoCode/Sencho/commit/ea57cbe97f7f4166c747f3e3710f85e57ab476a1))
* **ci:** correct release-please changelog section names and tag format ([ea57cbe](https://github.com/AnsoCode/Sencho/commit/ea57cbe97f7f4166c747f3e3710f85e57ab476a1))
* **ci:** correct release-please changelog section names and tag format ([e653bc2](https://github.com/AnsoCode/Sencho/commit/e653bc2210f07d83fcf16ca97e3c2863a40e2cdf))
* **ci:** docker-publish tag trigger ([6cd84ba](https://github.com/AnsoCode/Sencho/commit/6cd84ba9c6b40f2a1630e783c49b397e6d6969dc))
* **ci:** docker-publish tag trigger + re-release v0.1.0 ([6cd84ba](https://github.com/AnsoCode/Sencho/commit/6cd84ba9c6b40f2a1630e783c49b397e6d6969dc))
* **ci:** exclude .git from rsync --delete in sync-docs ([aefeb7a](https://github.com/AnsoCode/Sencho/commit/aefeb7a35febb6fb33843f2c407fce70b40bcb56))
* **ci:** exclude .git from rsync --delete in sync-docs ([8902f6f](https://github.com/AnsoCode/Sencho/commit/8902f6fb4ccddb06f8dec7ef193fca817d2e686a))
* **ci:** fix sync-docs empty-repo crash and update-screenshots protected-branch push ([bed63f8](https://github.com/AnsoCode/Sencho/commit/bed63f8b4725065988254c5d5113866033de38ac))
* **ci:** fix sync-docs empty-repo crash and update-screenshots protected-branch push ([9505132](https://github.com/AnsoCode/Sencho/commit/9505132aaf3c1457383040f5356f6c1d9d4296d0))
* **ci:** fix update-screenshots token and sync-docs empty-repo handling ([392a49e](https://github.com/AnsoCode/Sencho/commit/392a49e0bd27894249f918b6a918b0642ae7c41f))
* **ci:** fix update-screenshots token and sync-docs empty-repo handling ([b24863d](https://github.com/AnsoCode/Sencho/commit/b24863db66ffdc015f723d8c24428f271fcd98b4))
* **ci:** release-please config corrections ([b6391b9](https://github.com/AnsoCode/Sencho/commit/b6391b96ffd4edf7a303350f7416ab1945136e1b))
* **ci:** release-please config corrections ([b6391b9](https://github.com/AnsoCode/Sencho/commit/b6391b96ffd4edf7a303350f7416ab1945136e1b))
* **ci:** trigger docker-publish on v* tag push instead of GitHub Release event ([c8047c2](https://github.com/AnsoCode/Sencho/commit/c8047c209cfb98fd56e7484b5db01f564aa6d027))
* **ci:** trigger docker-publish on v* tag push instead of GitHub Release event ([c8047c2](https://github.com/AnsoCode/Sencho/commit/c8047c209cfb98fd56e7484b5db01f564aa6d027))
* **ci:** trigger docker-publish on v* tag push instead of GitHub Release event ([6c911fd](https://github.com/AnsoCode/Sencho/commit/6c911fd67fa55548173678f08504541fede52299))
* **ci:** update lock files after adding ESLint deps and fixing high CVEs ([3cf9f02](https://github.com/AnsoCode/Sencho/commit/3cf9f023d3f5bc798bfbea5ffeebaee940dfe546))
* **ci:** use double-quoted string for if condition to fix YAML parse error ([f5c5eda](https://github.com/AnsoCode/Sencho/commit/f5c5eda30a65ba7fc4443a1a927f818e339c34f4))
* **ci:** YAML syntax error and sync-docs git directory failure ([dfa93c0](https://github.com/AnsoCode/Sencho/commit/dfa93c0bba9f3cbf684140b9a456359c6745a98f))
* **ci:** YAML syntax error in if condition and safe.directory for sync-docs ([dc79683](https://github.com/AnsoCode/Sencho/commit/dc79683b01690cfe16293660481aa5fdb030603d))
* **csp:** allow external images in App Store and suppress console warnings ([#138](https://github.com/AnsoCode/Sencho/issues/138)) ([c5217cd](https://github.com/AnsoCode/Sencho/commit/c5217cd96de3dd8d2971668373b6eabd2c1654a4))
* dashboard cards and stacks list do not update on remote node switch ([497a48c](https://github.com/AnsoCode/Sencho/commit/497a48c2ed1bc81f53533b49e30e975122d41b65))
* dashboard cards and stacks list do not update on remote node switch ([ee9311a](https://github.com/AnsoCode/Sencho/commit/ee9311ad030fa813a0433b2fbdb0810f8829584f))
* **dashboard:** correct stale Stats reset with inactive field ([0d5dc57](https://github.com/AnsoCode/Sencho/commit/0d5dc574a42e6550bf0e58cc5f60988a970201db))
* **dashboard:** surface server error messages in create-stack flow ([9367abf](https://github.com/AnsoCode/Sencho/commit/9367abf8d36fd6769b59f25dac01e7385eaf20c0))
* **dashboard:** surface server error messages in create-stack flow ([3b2634f](https://github.com/AnsoCode/Sencho/commit/3b2634f9dd0bc2a8386028605aa935b62f6e1dd9))
* **db:** recreate stack_update_status table with composite primary key ([#356](https://github.com/AnsoCode/Sencho/issues/356)) ([4fe4ac5](https://github.com/AnsoCode/Sencho/commit/4fe4ac5d19cddc7db3d05563e8977d0c70d963f2))
* Distributed API Auth ([45a6420](https://github.com/AnsoCode/Sencho/commit/45a642014f10eb08a3cc69d5043194ecf4ca00e7))
* Distributed API auth hardening — Bearer tokens and URL normalization ([5932bce](https://github.com/AnsoCode/Sencho/commit/5932bced3660f285b8ec43636c49a93c45d02113))
* Distributed API Proxy & Auth Refinement ([9e6f721](https://github.com/AnsoCode/Sencho/commit/9e6f72111df97b11be7c8a7f62e062fe97881ab9))
* Distributed API proxy memory leak, node switcher refresh, and copy button ([fddd855](https://github.com/AnsoCode/Sencho/commit/fddd85562432e28de2ac879b804a5111eb802c96))
* Distributed API UI & Metrics Polish ([ebec4a5](https://github.com/AnsoCode/Sencho/commit/ebec4a5943bc27ded5ad14443b5da676e852fbf8))
* Distributed API UI & metrics polish + DEP0060 suppression ([eb0c026](https://github.com/AnsoCode/Sencho/commit/eb0c0263c7519ea40720fc992d87409fb01acdb6))
* **docker:** add entrypoint for volume permission handling ([593a709](https://github.com/AnsoCode/Sencho/commit/593a7091978a2024080ef1bbd394d86acb185b17))
* **docker:** entrypoint for volume permission handling ([c743f6c](https://github.com/AnsoCode/Sencho/commit/c743f6cd45ed8adf97e5bc49f88dbb4b69b41561))
* **docker:** fix xx cross-compilation sysroot for native modules ([#80](https://github.com/AnsoCode/Sencho/issues/80)) ([381701e](https://github.com/AnsoCode/Sencho/commit/381701ee258727b24031c09695c11bdf2cc7c854))
* **docker:** fix xx cross-compilation sysroot for node-pty and C++ modules ([518b0af](https://github.com/AnsoCode/Sencho/commit/518b0afb85023dbd32d7e90bdebaa139f9688d44))
* **docker:** install Docker CLI v29.3.1 from static binaries to resolve CVEs ([#268](https://github.com/AnsoCode/Sencho/issues/268)) ([f9b86e6](https://github.com/AnsoCode/Sencho/commit/f9b86e6f53e83ea0b5e8de7c1c916196d3345aee))
* **docker:** repair broken entrypoint from bad merge conflict resolution ([987fc3d](https://github.com/AnsoCode/Sencho/commit/987fc3d3396f7d66d5b847bb2700be5e87c20af4))
* **docker:** replace QEMU npm execution with tonistiigi/xx cross-compilation ([#78](https://github.com/AnsoCode/Sencho/issues/78)) ([1e0014e](https://github.com/AnsoCode/Sencho/commit/1e0014e1832653a0d8ce23182a2c2c7ef9efde2e))
* **docker:** upgrade Compose v2.40.3 → v5.1.1 to remediate dependency CVEs ([#283](https://github.com/AnsoCode/Sencho/issues/283)) ([36ebd5a](https://github.com/AnsoCode/Sencho/commit/36ebd5a9c1c82b5d7631d32831ac8ac420b0c782))
* **docker:** use native g++ for same-platform builds, xx-clang only for cross ([f23d8c6](https://github.com/AnsoCode/Sencho/commit/f23d8c660dc817f8e4486e656a38aadd9e6e5414))
* **e2e:** fill api_token in nodes tests so submit button is enabled ([707a5e8](https://github.com/AnsoCode/Sencho/commit/707a5e81c1865a45ee1789b7d43fa08eeb81b00b))
* **e2e:** fix stacks timeout and nodes skip in CI ([14c24c8](https://github.com/AnsoCode/Sencho/commit/14c24c82456cd8792cfb5d9f45d6c27b35dac32e))
* **e2e:** fully rewrite nodes tests to handle Radix UI Select and remote type flow ([12bbe51](https://github.com/AnsoCode/Sencho/commit/12bbe51a3af2ef8e48b5165b48026dd4566e9777))
* **e2e:** get all E2E tests passing and fix AlertDialog crash on delete ([f7471a1](https://github.com/AnsoCode/Sencho/commit/f7471a1a18f28c20e903b838ab4bcc8f8e0b73f8))
* **e2e:** use #node-name locator instead of getByLabel in nodes tests ([e01c0d6](https://github.com/AnsoCode/Sencho/commit/e01c0d6b4818c815897fd13b6ec319721a226b73))
* **e2e:** use button role for Resources nav item in screenshots spec ([b0e2b2d](https://github.com/AnsoCode/Sencho/commit/b0e2b2d025b86fca26b193f3eeda7e20c285da53))
* **e2e:** wait for sidebar stacks to finish loading before assertions ([#149](https://github.com/AnsoCode/Sencho/issues/149)) ([9ba9a3a](https://github.com/AnsoCode/Sencho/commit/9ba9a3a4565702135f22736a6b2310fc0da1d2f1))
* **editor:** bundle Monaco locally to fix stuck Loading state ([0eaa45b](https://github.com/AnsoCode/Sencho/commit/0eaa45bd7f5a4b5db9d51a577d25175bbcb4ff77))
* **editor:** bundle Monaco locally to fix stuck Loading state ([0eaa45b](https://github.com/AnsoCode/Sencho/commit/0eaa45bd7f5a4b5db9d51a577d25175bbcb4ff77))
* **editor:** bundle Monaco locally to fix stuck Loading state and CSP block ([79fde6e](https://github.com/AnsoCode/Sencho/commit/79fde6e2bd598085abfc7c702f5745bdfd692aec))
* **editor:** ESLint unused params fix ([dd5b698](https://github.com/AnsoCode/Sencho/commit/dd5b698b3f96e643af608a36128f05874a3b1f3c))
* **editor:** ESLint unused params fix ([dd5b698](https://github.com/AnsoCode/Sencho/commit/dd5b698b3f96e643af608a36128f05874a3b1f3c))
* **editor:** Monaco CSP fix + release pipeline fixes ([36a9bf3](https://github.com/AnsoCode/Sencho/commit/36a9bf3109c096ddd5d8095089a6ffb7bd6dee8d))
* **editor:** Monaco CSP fix + release pipeline fixes — v0.2.1 ([36a9bf3](https://github.com/AnsoCode/Sencho/commit/36a9bf3109c096ddd5d8095089a6ffb7bd6dee8d))
* **editor:** remove unused params from getWorker to satisfy ESLint ([34172a9](https://github.com/AnsoCode/Sencho/commit/34172a99226a4810465968ff9d238b85b1430829))
* **editor:** remove unused params from getWorker to satisfy ESLint ([34172a9](https://github.com/AnsoCode/Sencho/commit/34172a99226a4810465968ff9d238b85b1430829))
* **editor:** remove unused params from getWorker to satisfy ESLint ([59290e9](https://github.com/AnsoCode/Sencho/commit/59290e9e9d00cc97698e0223ab2810ae9f7b06d2))
* **env:** resolve 404 when loading env files and CSP inline script violation ([#134](https://github.com/AnsoCode/Sencho/issues/134)) ([1e6367a](https://github.com/AnsoCode/Sencho/commit/1e6367a147dddb323799a3cd1947507c595d21db))
* **error-handling:** surface silent errors across the codebase ([#326](https://github.com/AnsoCode/Sencho/issues/326)) ([10597d2](https://github.com/AnsoCode/Sencho/commit/10597d213a5dfdc47dddd53998336fb09889962b))
* fix dashboard out of memory crash on remote nodes ([e027a94](https://github.com/AnsoCode/Sencho/commit/e027a94492a94a4370f578c189065404908f47ef))
* fix dashboard out of memory crashing from massive historical metrics payloads ([4e9777d](https://github.com/AnsoCode/Sencho/commit/4e9777d47fb8c1361cad0454c3bcdefc4cee645d))
* **fleet:** navigate to editor instead of dashboard on "Open in Editor" click ([#289](https://github.com/AnsoCode/Sencho/issues/289)) ([71ce6b3](https://github.com/AnsoCode/Sencho/commit/71ce6b3e1b6cb974d44279e503f9a158d027555a))
* **fleet:** resolve getSenchoVersion crash in Docker containers ([#391](https://github.com/AnsoCode/Sencho/issues/391)) ([d437a19](https://github.com/AnsoCode/Sencho/commit/d437a195b695f6cb60411db8dbf1f23f22e298db))
* **fleet:** resolve remote node capability detection failures ([#388](https://github.com/AnsoCode/Sencho/issues/388)) ([dee7c66](https://github.com/AnsoCode/Sencho/commit/dee7c6685b22b3daf9e57363564133f6d7f0639f))
* **frontend:** remove duplicate ScrollArea tag causing build failure ([d38d48f](https://github.com/AnsoCode/Sencho/commit/d38d48fafe8f2b332be3f0b8ef58712e15d3ce65))
* **frontend:** sync NodeContext with localStorage on initial load ([eb58f30](https://github.com/AnsoCode/Sencho/commit/eb58f302a1bafb7afd155a1a2ca31e874dc8e60d))
* **frontend:** sync NodeContext with localStorage on initial load ([f400959](https://github.com/AnsoCode/Sencho/commit/f400959a4b633f3a230ecd88bc17f7331d3405e4))
* gate SSO and Audit behind Team Pro license tier ([#213](https://github.com/AnsoCode/Sencho/issues/213)) ([8d48b0a](https://github.com/AnsoCode/Sencho/commit/8d48b0abff08195a436f98bf8d42c45de51930df))
* Global Logs Polish ([f501fa4](https://github.com/AnsoCode/Sencho/commit/f501fa47128ac9a57591897c77ff87334325a5e8))
* Global Logs UX Polish ([7336ea8](https://github.com/AnsoCode/Sencho/commit/7336ea896e995b0a1aef0c9de95de94c9b9ecb4b))
* harden docker api validation, handle sftp errors, and fix node manager ui ([4bd80e2](https://github.com/AnsoCode/Sencho/commit/4bd80e29bf52f463a9024932a180b82e682f19f0))
* harden telemetry parsing and null node fallbacks ([f1f8e34](https://github.com/AnsoCode/Sencho/commit/f1f8e34da5fa9efe59dbe08b6ba5d136cfcb5be8))
* implement atomic deployment rollbacks and custom scrollbar UI ([6940825](https://github.com/AnsoCode/Sencho/commit/69408257d23803ba3fd1c8fd4a153d7a1a34df9e))
* implement smart auto-scroll and definitive stack filtering in global logs ([b267408](https://github.com/AnsoCode/Sencho/commit/b2674080c4a28888b5fbe98b085ec53c93f19aac))
* implement two-stage teardown for reliable atomic rollbacks ([c4805a1](https://github.com/AnsoCode/Sencho/commit/c4805a17ac2dff894e0db6df4605248098e77053))
* implement two-stage teardown for reliable atomic rollbacks ([fb3a288](https://github.com/AnsoCode/Sencho/commit/fb3a28834e30999ab3adcf06e452826681ed706c))
* **license:** default 14-day trial to Personal Pro instead of Team Pro ([#216](https://github.com/AnsoCode/Sencho/issues/216)) ([f99abe9](https://github.com/AnsoCode/Sencho/commit/f99abe907d5a39f4f32fb08bf25eda9b00dae88b))
* **licensing:** backward-compatible tier/variant enforcement and self-healing variant detection ([#385](https://github.com/AnsoCode/Sencho/issues/385)) ([9e0c9d3](https://github.com/AnsoCode/Sencho/commit/9e0c9d3f2d59f3330becc2153e2b638823c96b10))
* **licensing:** rename variant values to skipper/admiral and store resolved type ([#379](https://github.com/AnsoCode/Sencho/issues/379)) ([797623e](https://github.com/AnsoCode/Sencho/commit/797623e56fb97e6233f27fb9cc5be12613672707))
* **licensing:** resolve Admiral variant detection and lifetime license handling ([#376](https://github.com/AnsoCode/Sencho/issues/376)) ([f841c40](https://github.com/AnsoCode/Sencho/commit/f841c402b2e75874b066400adadcd8dcdfa9ac5f))
* **licensing:** resolve variant from product_name when variant_name lacks tier info ([#382](https://github.com/AnsoCode/Sencho/issues/382)) ([b08f698](https://github.com/AnsoCode/Sencho/commit/b08f698e8f1a2578bdecd274e923f63818239dd1))
* **lint:** resolve all backend ESLint errors to pass CI lint step ([e876a91](https://github.com/AnsoCode/Sencho/commit/e876a91a2e54267b82805731722f4a80ff2ad193))
* **lint:** resolve all ESLint errors to pass CI lint step ([c8a54a9](https://github.com/AnsoCode/Sencho/commit/c8a54a988bc86ea6a9acf05a116e571a735cd4a3))
* **logs:** cap DOM rendering to 300 rows to prevent browser OOM crash ([ec3a249](https://github.com/AnsoCode/Sencho/commit/ec3a2495a2cf71feb1bd8880a8a2ee1d2cc46c10))
* **logs:** cap DOM rendering to 300 rows to prevent OOM crash ([0db6c94](https://github.com/AnsoCode/Sencho/commit/0db6c946e7dcb38de84346fdd3d0f38450ee3eef))
* **logs:** use monotonic _id key to prevent O(n) DOM mutations on scroll ([753b0c3](https://github.com/AnsoCode/Sencho/commit/753b0c35399f0e564f40970328212ed06393e9d3))
* Memory Leak & Reload Loop ([ac5032d](https://github.com/AnsoCode/Sencho/commit/ac5032d3635614af682f7917a057467ea7b916d3))
* memory leak in SSE log accumulation and infinite reload loop in NodeContext ([fd07374](https://github.com/AnsoCode/Sencho/commit/fd073749563e993524c7d567886b10587f695f1a))
* **merge:** resolve CHANGELOG conflict with develop ([9f0257e](https://github.com/AnsoCode/Sencho/commit/9f0257e94fb6dddaa2287103e0f6bad7b3f3fac9))
* Observability Polish & Normalization ([da5a74a](https://github.com/AnsoCode/Sencho/commit/da5a74a4246fbe691c1a64b00d992bc96da5196f))
* Observability UI & TTY Parsing ([1f544c6](https://github.com/AnsoCode/Sencho/commit/1f544c656804443b221322091b8317aefabb549d))
* proxy forwards browser cookie to remote causing 401; fix nodeContextMiddleware loop ([7b2f28f](https://github.com/AnsoCode/Sencho/commit/7b2f28f505cd58c29baaff3f542bbdc7e4963dd2))
* **proxy:** prevent remote 401 from triggering local session logout ([278aa22](https://github.com/AnsoCode/Sencho/commit/278aa2298f2874cb5b86c5e38d6e550a792b689b))
* **proxy:** prevent remote 401 from triggering local session logout ([aeefd79](https://github.com/AnsoCode/Sencho/commit/aeefd79b50eb8a864db69ef1625e2a905a521db2))
* **proxy:** re-stream express.json()-consumed body to remote nodes for POST/PUT/PATCH ([a703707](https://github.com/AnsoCode/Sencho/commit/a703707aa0b5bd30cb6715c0371b6822ced353f3))
* **proxy:** skip express.json() for remote proxy requests to fix body forwarding ([ed69543](https://github.com/AnsoCode/Sencho/commit/ed6954307b82370fb8205f359eb412efaaf38d63))
* refine log level parsing and implement bottom auto-scroll ([9af0f85](https://github.com/AnsoCode/Sencho/commit/9af0f857498a7caf2b7e4b8c0faac649393c3bf5))
* remediate Dependabot and Docker Scout security vulnerabilities ([#265](https://github.com/AnsoCode/Sencho/issues/265)) ([59fd528](https://github.com/AnsoCode/Sencho/commit/59fd5285351c14f6e9cde073bd983de073fa3a75))
* remediate observability dashboard and global logs parsing ([29b1015](https://github.com/AnsoCode/Sencho/commit/29b10150b43103cdf0a234717b989df0c4660939))
* Remote Nodes Hardening ([7f23c88](https://github.com/AnsoCode/Sencho/commit/7f23c88c7393d82ef7ecfbc09dfd3427f31c4bf2))
* Remote Nodes Remediation — Port Routing, SSH Credentials & compose_dir ([1fb0494](https://github.com/AnsoCode/Sencho/commit/1fb0494e2e155847e83b3f14c4244727bc2fc7fa))
* Remote Nodes Telemetry Fixes ([792e977](https://github.com/AnsoCode/Sencho/commit/792e97709891d197bdc0ee01f4e8c40b4055de10))
* remote proxy strips /api prefix — remote Sencho returns SPA HTML instead of JSON ([efd3d7b](https://github.com/AnsoCode/Sencho/commit/efd3d7bd7f7104550e6a6f793b9a9c4e5b83b9ff))
* remote proxy strips /api prefix causing remote Sencho to return SPA HTML ([a26c255](https://github.com/AnsoCode/Sencho/commit/a26c255e7c2edfc6740f99aef879c9ec870ef420))
* **remote:** harden WS stream lifecycle, auth precedence, and proxy error handling ([1831411](https://github.com/AnsoCode/Sencho/commit/18314119b037b1adcbb16abc2d1e94e66b7168d5))
* **remote:** harden WS stream lifecycle, auth precedence, and proxy error handling ([abefd5e](https://github.com/AnsoCode/Sencho/commit/abefd5e1f6b594158eb2536aba805717cc51e579))
* **remote:** repair stats, bash exec, and Open App for remote nodes ([dbf8ec8](https://github.com/AnsoCode/Sencho/commit/dbf8ec8a2a0429dc58097cfaa63aa0e1b18cabb2))
* **remote:** repair stats, bash exec, and Open App for remote nodes ([94018d1](https://github.com/AnsoCode/Sencho/commit/94018d167fc09070c1baac99b0cdaf7f35dd7751))
* **remote:** strip cookie & nodeId from WS/HTTP proxy to remote nodes ([f115a48](https://github.com/AnsoCode/Sencho/commit/f115a48cfe995461db9a89ca5cb4c80d692a8f3c))
* **remote:** strip cookie header and nodeId from WS/HTTP proxy to remote nodes ([774190c](https://github.com/AnsoCode/Sencho/commit/774190cbb8363948b0a738c2174bd7e7b09177aa))
* remove unused React import in TemplatesView ([9c66a4f](https://github.com/AnsoCode/Sencho/commit/9c66a4f783d2463cc929080f8d8c3f98de61207c))
* replace naive log level detection with robust 3-tier regex class… ([c324d98](https://github.com/AnsoCode/Sencho/commit/c324d987ead2474ca5629a6fa75a3db0871b48e2))
* replace naive log level detection with robust 3-tier regex classification engine ([b7e6b5a](https://github.com/AnsoCode/Sencho/commit/b7e6b5a21c39c30995e5b3c22ce5fdb2950a7570))
* Resolve DatabaseService SQL syntax error and add concrete IFileAdapter implementations ([69e86a0](https://github.com/AnsoCode/Sencho/commit/69e86a0a37da11573bb4f5a72bbba16b4299452c))
* **scheduled-ops:** audit log text, run attribution, prune targets, and pagination ([#234](https://github.com/AnsoCode/Sencho/issues/234)) ([330eec4](https://github.com/AnsoCode/Sencho/commit/330eec4bff6f194aafdcbe499ab893bef06254b6))
* **security:** disable COOP header and Vite module-preload polyfill ([c36ee93](https://github.com/AnsoCode/Sencho/commit/c36ee9341630b3170c17a03d60bab90d387d09be))
* **security:** disable COOP header and Vite module-preload polyfill ([35a57e5](https://github.com/AnsoCode/Sencho/commit/35a57e5fa7ccbaa735cb3f684993b313cb465792))
* **security:** enforce stack name validation on all routes ([#314](https://github.com/AnsoCode/Sencho/issues/314)) ([1ab04be](https://github.com/AnsoCode/Sencho/commit/1ab04be235cc0d3020d17dfb3028e4679206b886))
* **security:** explicitly disable upgrade-insecure-requests via Helmet 8 API ([50df5b3](https://github.com/AnsoCode/Sencho/commit/50df5b3c028cc7dea75f93b994a6feb908988849))
* **security:** harden encryption key permissions, increase password minimum, remove sensitive logs ([#323](https://github.com/AnsoCode/Sencho/issues/323)) ([f317a83](https://github.com/AnsoCode/Sencho/commit/f317a83814fda3a98eb009c1a05a955bfadd6f0d))
* **security:** pre-launch security hardening audit & remediation ([#320](https://github.com/AnsoCode/Sencho/issues/320)) ([2d6b4c2](https://github.com/AnsoCode/Sencho/commit/2d6b4c233daa178de485dfeb198fc90376949ca4))
* **security:** prevent path traversal via env_file resolution ([#311](https://github.com/AnsoCode/Sencho/issues/311)) ([dc545dd](https://github.com/AnsoCode/Sencho/commit/dc545dd61337904e26e18e5e5bed190675432406))
* **security:** remove CSP upgrade-insecure-requests and HSTS for HTTP deployments ([25012a0](https://github.com/AnsoCode/Sencho/commit/25012a07caa7b545cbdbbdb033778cccc42a618c))
* **security:** remove CSP upgrade-insecure-requests and HSTS over HTTP ([cf2946c](https://github.com/AnsoCode/Sencho/commit/cf2946cfa67157db716e15544fdd547945ec0c3e))
* separate Docker API port from SSH port, add SSH credential UI, fix compose_dir routing ([26b8f62](https://github.com/AnsoCode/Sencho/commit/26b8f629685867b3c1ff98d6c02b1a089087b3b6))
* **settings:** prevent X button overlap and add tooltip to Always Local badge ([ed0817b](https://github.com/AnsoCode/Sencho/commit/ed0817b2c59187b3a1ac9dc52a9ce6ec6e3427bd))
* Skip remote nodes in MonitorService ([880919f](https://github.com/AnsoCode/Sencho/commit/880919fb7835ad37c79949e8c923cd3cf351d7b3))
* skip remote nodes in MonitorService to prevent direct Docker access errors ([b48cf62](https://github.com/AnsoCode/Sencho/commit/b48cf62e5b1c3eef35c01da381f2c0528e0cf2fa))
* **stacks:** avoid resource busy error in Docker fallback deletion ([#271](https://github.com/AnsoCode/Sencho/issues/271)) ([10d1636](https://github.com/AnsoCode/Sencho/commit/10d16361fae2869367a9f757bfc0ab4c3e04ca2c))
* **stacks:** resolve permission denied error on stack deletion ([#261](https://github.com/AnsoCode/Sencho/issues/261)) ([116f15d](https://github.com/AnsoCode/Sencho/commit/116f15dae9c3b530145316ea8b2954ed478fed76))
* **stats:** classify managed containers by working_dir instead of project name ([16e978b](https://github.com/AnsoCode/Sencho/commit/16e978bf4e360f59b3f79b7a38194509fcaddda2))
* **stats:** classify managed containers by working_dir instead of project name ([d62ac09](https://github.com/AnsoCode/Sencho/commit/d62ac095031ae203b2d29a1f0caa85a113884da7))
* **stats:** throttle container stat WebSocket updates via ref buffer ([74964b0](https://github.com/AnsoCode/Sencho/commit/74964b0e264f856bb3f8204496a57f48bfbbbe7e))
* stop infinite page reload caused by premature NodeProvider mount and 401 hard-redirect ([67c7078](https://github.com/AnsoCode/Sencho/commit/67c7078128560a7823c6a190ce90ea5b3278a455))
* strip browser cookie from proxy requests; fix nodeContextMiddleware self-heal loop ([39e63be](https://github.com/AnsoCode/Sencho/commit/39e63bea8e66e404bae4a8420bc2f04d6602e09f))
* trigger docs sync on develop instead of main ([7d1b996](https://github.com/AnsoCode/Sencho/commit/7d1b996bb7c10d33330ed645c8cfd1fc302a93e0))
* **ts:** remove unused motion import from alert-dialog ([0dd72b3](https://github.com/AnsoCode/Sencho/commit/0dd72b3eb467598452938133f563042df15c8596))
* **ts:** use type-only import for Node to satisfy verbatimModuleSyntax ([94d6c8f](https://github.com/AnsoCode/Sencho/commit/94d6c8fc0f8f3afce0e95d80f6a75a3884cca2af))
* tty parsing, timezone mapping, and floating action bar for global logs ([8203dd6](https://github.com/AnsoCode/Sencho/commit/8203dd6a1464553c451cb93bd4725128616d3f80))
* **ui:** resolve 9 animated design system bugs including Monaco tab height accumulation ([22e6462](https://github.com/AnsoCode/Sencho/commit/22e646286e9321e66101f9aedc89a99edce1d3c4))
* **ui:** settings modal sidebar nav clipped on smaller viewports ([#280](https://github.com/AnsoCode/Sencho/issues/280)) ([9e14ce9](https://github.com/AnsoCode/Sencho/commit/9e14ce999f89052b218d2e3f974644f41355955c))
* update lsio template registry url to valid endpoint ([e45915f](https://github.com/AnsoCode/Sencho/commit/e45915f014668bcc97550b2eb3043f5ac6dbd392))
* update lsio template registry url to valid endpoint ([7d59400](https://github.com/AnsoCode/Sencho/commit/7d59400114f55b817b5524a36079262b002d30ad))
* **ws:** fix remote node console — delegate console session tokens ([6c518ce](https://github.com/AnsoCode/Sencho/commit/6c518cee5a8735dea3f06cc662706b900c8d93f1))
* **ws:** fix remote node console by delegating console session tokens ([30fe77c](https://github.com/AnsoCode/Sencho/commit/30fe77cd5d57b1dbae6a8b40aebf4f14453d571c))


### Security

* harden terminal WebSocket endpoints against three attack vectors ([2e0f3e2](https://github.com/AnsoCode/Sencho/commit/2e0f3e2711e02c2350342e1fdb56878a81658e38))
* pre-release hardening, automated testing, and production readiness ([ce50db0](https://github.com/AnsoCode/Sencho/commit/ce50db0fdee160e20b658f98b5d8fee86215afc3))

## [0.38.6](https://github.com/AnsoCode/Sencho/compare/v0.38.5...v0.38.6) (2026-04-06)


### Fixed

* **fleet:** resolve getSenchoVersion crash in Docker containers ([#391](https://github.com/AnsoCode/Sencho/issues/391)) ([d437a19](https://github.com/AnsoCode/Sencho/commit/d437a195b695f6cb60411db8dbf1f23f22e298db))

## [0.38.5](https://github.com/AnsoCode/Sencho/compare/v0.38.4...v0.38.5) (2026-04-06)


### Fixed

* **fleet:** resolve remote node capability detection failures ([#388](https://github.com/AnsoCode/Sencho/issues/388)) ([dee7c66](https://github.com/AnsoCode/Sencho/commit/dee7c6685b22b3daf9e57363564133f6d7f0639f))

## [0.38.4](https://github.com/AnsoCode/Sencho/compare/v0.38.3...v0.38.4) (2026-04-06)


### Fixed

* **licensing:** backward-compatible tier/variant enforcement and self-healing variant detection ([#385](https://github.com/AnsoCode/Sencho/issues/385)) ([9e0c9d3](https://github.com/AnsoCode/Sencho/commit/9e0c9d3f2d59f3330becc2153e2b638823c96b10))

## [0.38.3](https://github.com/AnsoCode/Sencho/compare/v0.38.2...v0.38.3) (2026-04-05)


### Fixed

* **licensing:** resolve variant from product_name when variant_name lacks tier info ([#382](https://github.com/AnsoCode/Sencho/issues/382)) ([b08f698](https://github.com/AnsoCode/Sencho/commit/b08f698e8f1a2578bdecd274e923f63818239dd1))

## [0.38.2](https://github.com/AnsoCode/Sencho/compare/v0.38.1...v0.38.2) (2026-04-05)


### Fixed

* **licensing:** rename variant values to skipper/admiral and store resolved type ([#379](https://github.com/AnsoCode/Sencho/issues/379)) ([797623e](https://github.com/AnsoCode/Sencho/commit/797623e56fb97e6233f27fb9cc5be12613672707))

## [0.38.1](https://github.com/AnsoCode/Sencho/compare/v0.38.0...v0.38.1) (2026-04-05)


### Fixed

* **licensing:** resolve Admiral variant detection and lifetime license handling ([#376](https://github.com/AnsoCode/Sencho/issues/376)) ([f841c40](https://github.com/AnsoCode/Sencho/commit/f841c402b2e75874b066400adadcd8dcdfa9ac5f))

## [Unreleased]

### Changed

* **licensing:** internal variant values renamed from `personal`/`team` to `skipper`/`admiral`, aligning code with user-facing tier names
* **licensing:** variant type is now resolved once at activation/validation and stored in DB, instead of string-matching the Lemon Squeezy variant name on every read; `variant_id` is also captured for future lookups
* **licensing:** pre-existing installs auto-migrate on first `getVariant()` call (resolves from stored name, persists the result)

### Fixed

* **licensing:** trial users can now see Skipper/Admiral purchase cards in Settings > License (previously hidden due to a condition bug)
* **licensing:** Admiral licenses (including lifetime) are now correctly identified; previously, Lemon Squeezy variant names containing "Admiral" were not matched, causing the tier to display as "Skipper" and Admiral features to remain locked
* **licensing:** "Manage Subscription" button is now hidden for lifetime licenses, which have no billing portal by design
* **licensing:** license card now shows "Duration: Lifetime" for lifetime licenses instead of an empty renewal date
* **fleet:** remote node capability detection now works reliably; `/api/meta` and `/api/health` are exempt from the global rate limiter so they are never blocked by proxied traffic, and a backend-side cache with stale-while-revalidate prevents transient failures from disabling capability-gated features (Auto-Update, Schedules, Audit, Console) on remote nodes
* **fleet:** failed capability fetches now retry after 30 seconds instead of being cached for the full 5-minute TTL
* **fleet:** `getSenchoVersion()` no longer crashes in Docker containers; version is now baked in at build time via a prebuild script that reads the root `package.json` and generates a TypeScript constant, with a filesystem walk fallback for dev environments where the prebuild hook may not have run

### Changed

* **licensing:** rename internal tier value from `pro` to `paid` across backend and frontend; no user-facing behavior change beyond corrected branding
* **licensing:** all user-facing text now uses actual tier names (Community, Skipper, Admiral) instead of the generic "Pro" label
* **licensing:** `ProGate` component renamed to `PaidGate`, `isPro` renamed to `isPaid` throughout the codebase
* **licensing:** backend error code `PRO_REQUIRED` renamed to `PAID_REQUIRED`; `requirePro` guard renamed to `requirePaid`
* **docs:** all documentation updated to replace "Sencho Pro" references with proper tier names
* **licensing:** `LicenseInfo` API response now includes `isLifetime` boolean field

## [0.38.0](https://github.com/AnsoCode/Sencho/compare/v0.37.0...v0.38.0) (2026-04-04)


### Added

* **dashboard:** redesign as DevOps command center ([#371](https://github.com/AnsoCode/Sencho/issues/371)) ([2ee959e](https://github.com/AnsoCode/Sencho/commit/2ee959ec3b696c5beba7b8b62bec2221ca65d525))

## [0.37.0](https://github.com/AnsoCode/Sencho/compare/v0.36.0...v0.37.0) (2026-04-04)


### Added

* **stacks:** state-aware sidebar context menu and Open App action ([#368](https://github.com/AnsoCode/Sencho/issues/368)) ([55d3b8c](https://github.com/AnsoCode/Sencho/commit/55d3b8ca1dea6958cecf9d1672a6d891751f7ae3))

## [Unreleased]

### Added

* **dashboard:** redesign as DevOps command center with 5 operational sections: health status bar, resource gauges with progress bars, paginated stack health table, historical charts, and recent alerts feed
* **dashboard:** stack health table with per-stack UP/DN status, aggregated CPU/memory metrics, click-to-navigate, and pagination (8 per page)
* **dashboard:** system health derivation (Healthy/Degraded/Critical) based on resource thresholds and alert state
* **stacks:** state-aware sidebar context menu, actions now adapt to stack state (running stacks show Stop/Restart/Update, stopped stacks show Deploy)
* **stacks:** "Open App" action in sidebar context menu, quickly open a stack's web interface without navigating to the detail view
* **stacks:** bulk status endpoint now returns detected web port per stack for Open App support

### Changed

* **dashboard:** replaced 6 flat stat cards with 5 denser resource gauge cards featuring visual progress bars and threshold coloring
* **dashboard:** extracted monolithic HomeDashboard.tsx (447 lines) into composable sub-components under `dashboard/` directory
* **updates:** reduced manual image update check cooldown from 10 minutes to 2 minutes
* **updates:** rate limit error message now dynamically derives from the configured cooldown constant

### Removed

* **dashboard:** removed Docker Run to Compose converter from the dashboard (utility that doesn't belong on the primary landing surface)

### Fixed

* **dashboard:** resolved OOM caused by unbounded concurrent Docker stats polling. Added overlap guard to `updateGlobalDockerNetwork`, increased its interval from 3s to 5s, downsampled historical metrics from 1-minute to 5-minute buckets, and paused all dashboard polling when the browser tab is hidden
* **stacks:** added missing `.ok` check on container status fallback response in EditorLayout, preventing potential JSON parse errors on failed requests

## [0.36.0](https://github.com/AnsoCode/Sencho/compare/v0.35.0...v0.36.0) (2026-04-04)


### Added

* UI polish sprint — 7 items + logs toolbar redesign ([#365](https://github.com/AnsoCode/Sencho/issues/365)) ([f9ebd1d](https://github.com/AnsoCode/Sencho/commit/f9ebd1d77c74434e641e2fc41f4f6d3de8cbeeee))

## [0.35.0](https://github.com/AnsoCode/Sencho/compare/v0.34.0...v0.35.0) (2026-04-03)


### Added

* **stacks:** per-stack action tracking, optimistic status, and bulk status endpoint ([#362](https://github.com/AnsoCode/Sencho/issues/362)) ([dfd4d28](https://github.com/AnsoCode/Sencho/commit/dfd4d2858a023ed013afbe93c077a3152a0773c5))

## [Unreleased]

### Added

* **stacks:** bulk `/api/stacks/statuses` endpoint — fetches all stack statuses in a single Docker API call instead of N individual `docker compose ps` invocations. Falls back to per-stack queries for remote nodes on older versions.
* **fleet:** tag filter dropdown — replaced inline pills with a multi-select combobox for cleaner filtering
* **editor:** ⌘K / Ctrl+K keyboard shortcut to focus the sidebar stack search
* **billing:** signed Lemon Squeezy Customer Portal URLs — "Billing" button now opens an auto-authenticated portal session via the sencho.io proxy, available for all license tiers

### Fixed

* **stacks:** sidebar status indicators showing "--" (unknown) after stopping a stack instead of "DN". Root cause was a race condition where `refreshStacks` queried container state before Docker had fully transitioned containers.
* **logs:** toolbar (search, filters, actions) was a hover-only floating bar that could disappear — now a permanent pinned toolbar always visible at the top
* **logs:** replaced all hardcoded colors with design tokens for proper light/dark theme support
* **audit:** Export dropdown caused toolbar to scroll out of view due to Radix scroll-locking (`modal={false}` fix)
* **audit:** light theme button contrast — outline buttons were invisible due to `--input` matching `--background`
* **toast:** notification colors used hardcoded Tailwind values instead of oklch design tokens
* **editor:** button row (Discard / Save Only / Save & Deploy) had inconsistent heights across variants

### Changed

* **stacks:** stack actions (deploy, stop, restart, update) are now tracked per-stack instead of globally. Users can fire actions on multiple stacks concurrently without the UI blocking. Sidebar shows a spinner per stack during in-flight actions.
* **resources:** removed redundant inner border and background on tab navigation wrapper

## [0.34.0](https://github.com/AnsoCode/Sencho/compare/v0.33.1...v0.34.0) (2026-04-03)


### Added

* **license:** distributed license enforcement across multi-node setups ([#359](https://github.com/AnsoCode/Sencho/issues/359)) ([6c26ae3](https://github.com/AnsoCode/Sencho/commit/6c26ae3f501d438dcde5331bae588ee6e26c2c3e))

## [0.33.1](https://github.com/AnsoCode/Sencho/compare/v0.33.0...v0.33.1) (2026-04-03)


### Fixed

* **db:** recreate stack_update_status table with composite primary key ([#356](https://github.com/AnsoCode/Sencho/issues/356)) ([4fe4ac5](https://github.com/AnsoCode/Sencho/commit/4fe4ac5d19cddc7db3d05563e8977d0c70d963f2))

## [0.33.0](https://github.com/AnsoCode/Sencho/compare/v0.32.0...v0.33.0) (2026-04-03)


### Added

* **fleet:** add remote node update management ([#353](https://github.com/AnsoCode/Sencho/issues/353)) ([87b5908](https://github.com/AnsoCode/Sencho/commit/87b59082887902af24ad2bf88ae3d4d4c941411e))

## [Unreleased]

### Added

* **fleet:** remote node update management (Pro tier) — check for outdated nodes and trigger over-the-air updates from Fleet View. Nodes self-update by pulling the latest Docker image and recreating their container. Includes version badges on node cards, per-node and bulk "Update All" actions, real-time progress tracking with 5-second polling, reconnecting overlay for local node updates, and `POST /api/system/update` endpoint for programmatic self-updates. Requires Docker Compose deployment with Docker socket access.

* **license:** distributed license enforcement across multi-node setups — the primary instance's license tier (Skipper/Admiral) is now automatically asserted to remote nodes on every proxied request. Remote nodes honor the assertion only when the request arrives with a valid node proxy token, preventing unauthorized elevation. No per-node license activation required. Includes type guards and header constants in `LicenseService`, and comprehensive test coverage for all trust chain scenarios.

## [0.32.0](https://github.com/AnsoCode/Sencho/compare/v0.31.0...v0.32.0) (2026-04-03)


### Added

* **nodes:** add capability-based node compatibility negotiation ([#350](https://github.com/AnsoCode/Sencho/issues/350)) ([ee75811](https://github.com/AnsoCode/Sencho/commit/ee75811e255e8d5f9ae87117d12c2902185d98f1))

## [0.31.0](https://github.com/AnsoCode/Sencho/compare/v0.30.0...v0.31.0) (2026-04-03)


### Added

* **notifications:** add shared notification routing rules (Admiral tier) ([#347](https://github.com/AnsoCode/Sencho/issues/347)) ([1b573f5](https://github.com/AnsoCode/Sencho/commit/1b573f542a36cde3e94c05f285d34330df96edb1))

## [Unreleased]

### Added

* **notifications:** shared notification routing rules (Admiral tier) — route stack alerts to specific Discord, Slack, or webhook channels instead of the global endpoint. Includes per-rule enable/disable, priority ordering, and fallback to global agents when no rule matches.
* **nodes:** capability-based node compatibility negotiation — each Sencho instance now exposes a `/api/meta` endpoint advertising its version and supported features. When switching nodes, the frontend fetches this metadata and disables features the remote node doesn't support, with a clear overlay explanation. Version is shown in the node switcher dropdown and connection test results. Lays the groundwork for future fleet-wide update management.

## [0.30.0](https://github.com/AnsoCode/Sencho/compare/v0.29.0...v0.30.0) (2026-04-03)


### Added

* **nodes:** add per-node scheduling and update visibility ([#344](https://github.com/AnsoCode/Sencho/issues/344)) ([efbd20f](https://github.com/AnsoCode/Sencho/commit/efbd20fed57299acae43ecaee3b1d9ff52da5aae))

## [0.29.0](https://github.com/AnsoCode/Sencho/compare/v0.28.0...v0.29.0) (2026-04-02)


### Added

* **labels:** add stack labels for organizing, filtering, and bulk actions ([#341](https://github.com/AnsoCode/Sencho/issues/341)) ([28e7be6](https://github.com/AnsoCode/Sencho/commit/28e7be652cb18abdd51ca6df8eda2104d213dc30))

## [0.28.0](https://github.com/AnsoCode/Sencho/compare/v0.27.0...v0.28.0) (2026-04-02)


### Added

* **resources:** add network management with create, inspect, and topology ([#338](https://github.com/AnsoCode/Sencho/issues/338)) ([24299a0](https://github.com/AnsoCode/Sencho/commit/24299a0115ce0371f44608f8d64248e6474df8ce))

## [0.27.0](https://github.com/AnsoCode/Sencho/compare/v0.26.0...v0.27.0) (2026-04-02)


### Added

* **resources:** add network management with create, inspect, and topology visualization ([#335](https://github.com/AnsoCode/Sencho/issues/335)) ([4488637](https://github.com/AnsoCode/Sencho/commit/4488637656b8a19f8df2fcea7ffafff023786068))

## [Unreleased]

### Added

* **nodes:** Per-node scheduling and update visibility in the Nodes table
  * New "Schedules" and "Updates" columns show active task counts, next run time, and auto-update status per node
  * Calendar action button navigates to Schedules/Auto-Update views filtered to that node
  * Filter bar in schedule views with pre-selected node when creating tasks
* **nodes:** Fleet-wide image update aggregation endpoint (`/api/image-updates/fleet`) with 2-minute cache
* **nodes:** Node scheduling summary endpoint (`/api/nodes/scheduling-summary`)

### Fixed

* **scheduler:** `stack_update_status` table now includes `node_id` — stacks with the same name on different nodes no longer collide
* **scheduler:** Scheduled tasks targeting offline or deleted nodes now fail with clear error messages instead of cryptic Docker connection errors
* **nodes:** Deleting a node now cascades cleanup to its scheduled tasks and update status data (wrapped in a transaction)
* **labels:** Stack Labels — organize stacks with custom colored labels for filtering and bulk actions (Pro)
  * Create, edit, and delete labels from Settings → Labels
  * Assign labels to stacks via right-click context menu or dropdown menu
  * Filter sidebar stack list by label (OR logic with clickable pill bar)
  * Filter Fleet View by label
  * Bulk actions on labeled stacks: deploy all, stop all, restart all
  * 10 curated oklch label colors with light/dark theme support
  * Label data persists across tier downgrades — upgrading restores all labels
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
