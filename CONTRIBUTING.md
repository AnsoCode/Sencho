# Contributing to Sencho

Thank you for your interest in contributing to Sencho!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/Sencho.git`
3. Create a branch: `git checkout -b feature/your-feature`
4. Install dependencies:
   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```
5. Start the dev servers:
   ```bash
   cd backend && npm run dev    # Express + nodemon on :1852
   cd frontend && npm run dev   # Vite on :5173
   ```

## Development

- **Backend:** Node.js + Express + TypeScript in `backend/`
- **Frontend:** React 19 + Vite + TypeScript in `frontend/`
- **Tests:** `cd backend && npm test` (Vitest) and `npm run test:e2e` (Playwright)
- **Lint:** `npm run lint` in both `backend/` and `frontend/`

## Pull Request Process

- All PRs target `main`
- Ensure CI passes before requesting review
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages
- Update documentation if your change affects user-facing behavior
- Add tests for new functionality
- Keep PRs focused - one feature or fix per PR
- Do not edit `CHANGELOG.md` directly. It is generated from your conventional-commit subjects by release-please. If a user-facing change needs more context than the commit subject captures, enrich the auto-opened Release PR description before it is merged.

## Reporting Bugs

Use the [bug report template](https://github.com/AnsoCode/Sencho/issues/new?template=bug_report.yml). Include: deployment method, Sencho version, browser (for UI issues), steps to reproduce, and expected vs actual behavior.

## Code Style

- TypeScript with `strict: true` - no `any` casts or `@ts-ignore`
- ESLint 9 flat config for both backend and frontend
- Tailwind CSS + shadcn/ui for frontend styling
- Follow existing patterns in the codebase
