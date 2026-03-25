# CLAUDE.md

> **Every session:** Read this file fully before starting any task.
> **Every commit:** Before committing, run through the checklist below.

## Project Overview

Sencho is a self-hosted Docker Compose management dashboard - a React + Express full-stack app that provides a GUI for managing Docker Compose stacks. 
**Architecture Model:** It uses a "Distributed API" model. It manages local stacks directly. To manage remote nodes, it acts as a transparent HTTP/WebSocket proxy, routing requests to other autonomous Sencho instances running on those remote servers via long-lived JWT Bearer tokens.

## Development Commands

### Backend
```bash
cd backend
npm install
npm run dev          # nodemon + ts-node, watches src/
npm run build        # tsc → dist/
npm start            # node dist/index.js (production)
```

### Frontend
```bash
cd frontend
npm install
npm run dev          # Vite dev server (proxies /api → localhost:3000)
npm run build        # tsc -b && vite build
npm run lint         # ESLint 9 flat config
npm run preview      # preview production build
```

### Full Docker build
```bash
docker build -t sencho .   # multi-stage: frontend build → backend build → runtime
```

---

## Versioning & Release Flow

Sencho uses **Semantic Versioning** (`MAJOR.MINOR.PATCH`) driven by **Conventional Commits** and automated by the `release-please` GitHub Action.

### How it works (GitHub Flow)

1. Create a short-lived feature branch off `main` (e.g., `feat/my-feature`, `fix/my-bug`).
2. Commit using conventional commit prefixes (see below).
3. Open a PR into `main`. CI runs automatically.
4. Once CI is green, merge the PR (squash-merge recommended for clean history).
5. On every push to `main`, the `release-please` workflow automatically opens or updates a **Release PR** titled `chore(main): release vX.Y.Z`. This PR contains:
   - An updated `CHANGELOG.md` entry generated from commit messages.
   - A `package.json` version bump.
6. When you're ready to publish, **merge the Release PR**. This triggers:
   - A `vX.Y.Z` git tag created by release-please.
   - The `docker-publish.yml` workflow fires on the tag → builds and pushes `latest` + `X.Y.Z` to Docker Hub.

> You never create tags manually. Merging the Release PR is the only release action required.
> There is no `develop` branch. `main` is the only long-lived branch.

### Conventional Commit format

```
<type>(optional scope): <short description>

# Examples
fix(auth): prevent login loop on remote node 401
feat(app-store): add category filter pill bar
feat!: replace SSH with Distributed API proxy   ← BREAKING CHANGE
docs(quickstart): update Docker run command
chore(deps): bump express to 4.19.2
ci: add arm64 platform to docker-publish
```

### Version bump rules

| Commit type | Example | Version bump |
|---|---|---|
| `fix:` / `perf:` / `revert:` | Bug fixes, perf improvements | `PATCH` — 0.1.0 → 0.1.1 |
| `feat:` | New user-facing feature | `MINOR` — 0.1.x → 0.2.0 |
| `feat!:` / `BREAKING CHANGE:` footer | Breaking API or UX change | `MAJOR` — 0.x.y → 1.0.0 |
| `docs:` / `chore:` / `ci:` / `test:` / `refactor:` | Infrastructure, no user impact | No bump (hidden in CHANGELOG) |

> While the version is `0.x`, `feat:` bumps the **minor** digit (0.1 → 0.2), not the patch. `fix:` still bumps patch (0.1.0 → 0.1.1). A `feat!:` will bump to `1.0.0`.

### Enriching the auto-generated Release PR

release-please generates CHANGELOG entries from commit subject lines. If a change deserves more context (e.g. a security fix or complex feature), **edit the Release PR description and CHANGELOG entry directly** before merging — release-please preserves manual edits on subsequent updates.

---

## Architecture & Request Flow

### The Distributed API Proxy Flow
1. **Frontend:** Makes API calls via `apiFetch` (`frontend/src/lib/api.ts`), which injects the `x-node-id` header (or `?nodeId=` query param for WebSockets) from `NodeContext`.
2. **Backend Gateway (`index.ts`):** The `nodeContextMiddleware` evaluates the node ID.
   - **If Local:** The request passes through standard auth and hits the local Express route handlers.
   - **If Remote:** The request hits `http-proxy-middleware`. The backend strips the `x-node-id` header, injects `Authorization: Bearer <api_token>`, and seamlessly proxies the entire HTTP or WebSocket request to the remote Sencho instance's `api_url`. 

### Backend Services (`backend/src/services/`)
All core services execute **locally only**. (Remote execution is handled by proxying the request to the remote Sencho instance, which then executes locally on its own machine).
- **`DockerController`** - Dockerode wrapper for local containers, images, volumes, networks, stats, exec.
- **`ComposeService`** - Spawns `docker compose` CLI child processes locally.
- **`FileSystemService`** - Simple `fs.promises` wrapper. All reads/writes happen against the local `COMPOSE_DIR`.
- **`DatabaseService`** - SQLite via `better-sqlite3`. Stores alerts, settings, metrics, and node routing configs at `/app/data/sencho.db`.
- **`NodeRegistry`** - Manages node configurations. Returns the local Docker socket for local ops, and returns `{ api_url, api_token }` targets for remote proxies.

### Frontend Structure
- **`App.tsx`** - Root router: setup flow → login → `EditorLayout`.
- **`context/AuthContext.tsx`** - JWT auth state; handles first-boot setup detection.
- **`context/NodeContext.tsx`** - Active node selection state.
- **`components/NodeManager.tsx`** - UI for adding nodes (requires Name, Sencho API URL, and API Token).
- **`lib/api.ts`** - `apiFetch` wrapper that handles headers and 401 redirects.

### Authentication
- **Browser-to-Backend:** JWT stored in `httpOnly` cookies.
- **Node-to-Node (Proxy):** Long-lived JWT passed via `Authorization: Bearer <token>` header.
- **Middleware:** `authMiddleware` accepts *both* cookies and Bearer tokens seamlessly.

---

## 🛑 AGENT DIRECTIVES (CRITICAL INSTRUCTIONS)

To prevent hallucinations, regressions, and context loss, you MUST adhere to the following rules:

**1. Targeted Reading of index.ts (Avoid Full-File Context Waste)**
   - Before modifying `index.ts`, do NOT read the entire ~1500-line file. Read only the relevant section: Lines 50-250 (Auth/Setup), Lines 300-500 (Stacks/Compose), Lines 550-750 (Docker Entities), Lines 800-1000 (System/Metrics), Lines 1050-1250 (Nodes/Proxy), Lines 1300+ (WebSockets/Errors). 
   - For middleware ordering, check lines 100-300. 
   - Confirm exact placement by searching for the prefix.

2. **Respect the Architecture:**
   - We do NOT use SSH, SFTP, or remote Docker TCP sockets. For remote file reading, you must use the HTTP Proxy model.
   - Ensure `http-proxy-middleware` catches remote requests before local route handlers.

3. **Limit Repetition & Be Concise:**
   - Do not output massive blocks of unchanged code. Use precise edits, diffs, or surgical replacements.
   - Do not over-explain your steps unless asked. State your intent, perform the file modifications, and report the result.

4. **Strict GitHub Flow & Conventional Commits:**
   - All feature work and bug fixes must happen on a newly created branch off `main`.
   - **Every commit MUST use a conventional commit prefix** (`fix:`, `feat:`, `docs:`, `chore:`, `ci:`, `refactor:`, `test:`, `perf:`). This is what drives automated versioning — no prefix means no version bump and no CHANGELOG entry.
   - Update `CHANGELOG.md` under `## [Unreleased]` before committing (the auto-generated entry from release-please will be terse; add context here for significant changes).
   - Stage, commit, push to `origin`, and **open a PR into `main`**. This is required to trigger automated CI/CD actions.
   - **Do NOT manually create git tags or push version commits.** Versioning is fully automated by `release-please` — it fires on every push to `main` and creates the Release PR automatically.
 
5. **Strict Security & API Standards:**
   - **Default Deny:** EVERY new endpoint in `index.ts` under `/api/` MUST be protected by `authMiddleware` unless explicitly designated as public.
   - **SQL Injection Prevention:** ALWAYS use `better-sqlite3` parameterized statements. Do not manually sanitize or string-escape inputs.
   - **No Secrets in Code:** Never hardcode secrets. Rely on `DatabaseService.getInstance().getGlobalSettings()`.

6. **UX & UI Engineering Constraints:**
   - Use only Tailwind CSS and existing `shadcn/ui` components.
   - Handle loading states. Every frontend API call must be wrapped in `try/catch`. 
   - When using `sonner` toast, use this exact defensive pattern: `toast.error(error?.message || error?.error || error?.data?.error || 'Something went wrong.');`
   - Do not assume `error` is a standard Error instance.

7. **Backend Error Handling:**
   - **Do Not Swallow Errors:** Do not write empty `catch` blocks. 
   - **Standardized Responses:** If a backend operation fails, log the actual error to the console for debugging, but return a clean, standard JSON error to the frontend: `res.status(500).json({ error: "Clear message" });`.
   - **No Server Crashes:** Ensure all asynchronous proxy streams (WebSockets/SSE) have robust error handling and `.on('error')` listeners to prevent the Node event loop from crashing.

8. **WebSocket Nuances & Middleware Bypasses:**
   - Express middlewares (`authMiddleware`, `nodeContextMiddleware`, `cookieParser`) **DO NOT RUN** on WebSocket (`server.on('upgrade')`) connections.
   - You MUST manually parse cookies/headers and manually execute `jwt.verify()` inside the `upgrade` event handler.
   - Extract `nodeId` from URL query parameters (`?nodeId=`) for WebSockets, NOT from the `x-node-id` header.

9. **Filesystem Security & Path Traversal:**
   - Perform strict directory traversal validation at the Express route level before any `FileSystemService` call. 
   - Use this exact pattern: `const safePath = path.resolve(COMPOSE_DIR, stackName, filename);` `if (!safePath.startsWith(path.resolve(COMPOSE_DIR))) { return res.status(400).json({ error: 'Invalid path' }); }`
   - Reject inputs with `..` or absolute paths.

10. **React Dependency Traps (Infinite Loops):**
   - Be extremely cautious fixing `react-hooks/exhaustive-deps` warnings in global context files like `NodeContext.tsx`.
   - We intentionally use `useRef` (e.g., `activeNodeRef`) to hold current state inside `useCallback` functions. **DO NOT blindly add state variables to dependency arrays** to satisfy ESLint, as it will trigger infinite API-fetching loops.

11. **The Monolithic index.ts Constraint:**
   - The backend `index.ts` file is currently a monolith (~1500 lines). 
   - Continue appending new routes into their logical groups (e.g., Auth, Stacks, System, Nodes). **DO NOT** attempt to proactively split or refactor this file into a multi-router architecture unless explicitly instructed by the user.

12. **Environment & File System Context:**
   - `FileSystemService` strictly operates against the `COMPOSE_DIR` environment variable.
   - **DO NOT** hardcode `/app/compose` as an immutable path or implicitly assume it is the only path. It is merely the Docker default. Your code must dynamically read `process.env.COMPOSE_DIR` (or rely on `FileSystemService.getInstance(nodeId).getBaseDir()`) to respect each user's unique volume mounts or local OS paths.

13. **Mandatory Test Validation Before Completing Any Task:**
   - Validate behavior before considering a task done.
   - **Always kill existing services first** — do not assume a running process has the latest code (it may have been started with `npm start` or `node dist/index.js`, not nodemon):
     ```bash
     kill $(lsof -ti:3000) 2>/dev/null; kill $(lsof -ti:5173) 2>/dev/null
     ```
   - Then start fresh in the background using `npm run dev` (nodemon) only:
     ```bash
     cd backend && npm run dev &
     cd frontend && npm run dev &
     ```
   - Wait for readiness before proceeding:
     ```bash
     curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health  # expect 200
     curl -s -o /dev/null -w "%{http_code}" http://localhost:5173              # expect 200
     ```
   - If Playwright MCP is available, use it to navigate and interact with the affected UI and confirm expected behavior.
   - If Playwright is unavailable: explicitly state "Playwright validation unavailable; recommend manual testing: [describe exact steps]".
   - **Always kill both services when done with validation** — never leave orphan processes:
     ```bash
     kill $(lsof -ti:3000) 2>/dev/null; kill $(lsof -ti:5173) 2>/dev/null
     ```
   - Explicitly confirm in your response that services have been stopped after validation.
   - Never open a PR without documented validation.

14. **TypeScript Strictness Rules**
   - `tsconfig.json` has `"strict": true`. 
   - Write code that compiles without `any` casts or `@ts-ignore`. Prefer proper types over `any`. 
   - If a library lacks types, import `@types/...` or use `unknown` + narrowing. 
   - Never add casts to silence errors.

15. **Testing Strategy Reference**
   - **Backend unit tests:** Vitest (`cd backend && npm test`). Add tests for new backend logic.
   - **E2E tests:** Playwright (`npm run test:e2e`). Covers auth, stack management, and node management flows.
   - **Manual validation:** Use the Playwright MCP server for UI changes, or `curl` for backend-only changes.
   - For UI changes: use the Playwright MCP server to navigate to `http://localhost:5173`, interact with the affected components, and confirm expected behavior.
   - For backend-only changes: validate via `curl` against `localhost:3000/api/...` with a valid `Authorization: Bearer <token>` or session cookie.

16. **Environment Variables Reference**
   - Read vars from `process.env` or `DatabaseService`. 
   - Never hardcode. Key vars: `COMPOSE_DIR` (base directory), `JWT_SECRET` (token signing), `PORT` (listen port), `NODE_ENV`. Check `.env.example` for the full list.

17. **Code Review Standards**
   - After completing any implementation, review the code for:
   - Functions longer than 30 lines (likely doing too much)
   - Logic duplicated more than twice (extract to utility)
   - Any `any` type usage in TypeScript (replace with real types)
   - Components with more than 3 props that could be grouped into an object
   - Missing error handling on async operations
   - Run /simplify before presenting code to the user.

---

## Documentation

Whenever you create, modify, or remove a user-facing feature, API endpoint, or configuration option, you MUST also update or create the relevant `.mdx` file inside the `/docs` folder.
- Follow the existing structure in `/docs/docs.json` navigation
- Write docs from the perspective of the end user, not internal implementation
- Use Mintlify MDX components where useful (e.g. `<Card>`, `<CodeGroup>`, `<Note>`)
- Add the new/updated doc page to the `navigation` array in `mint.json` if it's a new file
- Keep tone friendly and concise

### Screenshots
When adding or updating a doc page for a user-facing feature:
1. Follow the service lifecycle in Directive 13: kill any running processes on ports 3000/5173, restart with `npm run dev`, wait for readiness, and kill again when done
2. Use the Playwright MCP server to navigate to the relevant page/feature in the app
3. Take a screenshot and save it to `/docs/images/<feature-name>/<screenshot-name>.png`
4. Use descriptive filenames (e.g. `dashboard-overview.png`, `settings-dark-mode.png`)
5. For multi-step flows, highlight the relevant UI element by injecting a CSS border
   before screenshotting: `element.style.border = '3px solid #0F172A'`
6. Reference screenshots in MDX files using:
   `<img src="/images/<feature-name>/<screenshot-name>.png" alt="..." />`
   or Mintlify's `<Frame>` component for a polished look:
   `<Frame><img src="/images/..." alt="..." /></Frame>`
7. Always take screenshots at 1280x800 desktop resolution for consistency

## Pre-Commit Checklist
- [ ] Am I on a feature branch off `main`? (never commit to main directly)
- [ ] Does my commit message start with a conventional prefix? (`fix:`, `feat:`, `docs:`, `chore:`, `ci:`, `refactor:`, `test:`, `perf:`)
- [ ] Did I update CHANGELOG.md under `## [Unreleased]`? (add context beyond what the commit subject captures)
- [ ] Did I update or create the relevant `/docs/*.mdx` file?
- [ ] Did I take/update screenshots via Playwright MCP if UI changed?
- [ ] Did I validate behavior via Playwright MCP (UI) or `curl` (backend), and kill the dev servers afterwards? (Directive 13)
- [ ] Is the PR going into `main`?

## Release Checklist (when shipping to users)
- [ ] Is `main` stable and CI green?
- [ ] Wait for the `release-please` workflow to open the Release PR (titled `chore(main): release vX.Y.Z`).
- [ ] Review and optionally enrich the auto-generated CHANGELOG entry in the Release PR.
- [ ] Merge the Release PR → tag is created → Docker Hub `latest` + semver tags are published automatically.