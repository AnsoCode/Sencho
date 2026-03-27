# Manual Steps Required

These actions could not be performed automatically and need to be done manually in the GitHub UI.

## 1. Branch Protection Rules for `main`

Go to **Settings > Branches > Add branch ruleset** for `main`:

- [x] Require a pull request before merging
  - Required approvals: 0 (solo dev - you merge your own PRs after CI passes)
  - Dismiss stale reviews when new commits are pushed: ON
- [x] Require status checks to pass before merging
  - Add these job names: `Backend (Build, Test, Lint)`, `Frontend (Build, Lint)`, `Docker Build & Scan`, `E2E Tests (Playwright)`
- [x] Require conversation resolution before merging
- [x] Do not allow bypassing the above settings (even you must go through PRs)
- [x] Do not allow deletions
- [ ] Require signed commits (optional - future improvement)

## 2. Repository Settings

Go to **Settings > General > Pull Requests**:
- [x] Check **"Automatically delete head branches"**
- [x] Set **squash merge** as default merge strategy

## 3. Security Settings

Go to **Settings > Code security and analysis**:
- [x] Enable **Dependabot alerts**
- [x] Enable **Dependabot security updates**
- [x] Enable **Secret scanning**
- [x] Enable **Secret scanning push protection**
- [x] Enable **Private vulnerability reporting**

## 4. Default Branch

Verify that `main` is set as the default branch:
- Go to **Settings > Branches > Default branch**
- Should already be `main`

## 5. Delete `develop` Branch (When Ready)

The `develop` branch has 1 unmerged commit (`37f751c docs: refresh screenshots`).

**Before deleting**, decide whether to:
- Cherry-pick that commit to main via a PR, OR
- Let it go (it's just a screenshot refresh)

Then delete via: **Branches page > delete `develop`**

Also clean up stale feature branches that have been merged:
- `chore/refresh-screenshots`
- `fix/editor-loading`
- `fix/release-please-config`
- `feat/automated-versioning`
- `fix/docker-publish-tag-trigger`
- `feat/arm64-docker-build`
- `chore/migrate-to-docs-json`
- `fix/sync-docs-rsync-excludes-git`
- `fix/ci-docs-jobs`, `fix/ci-docs-jobs-v2`

## 6. Delete This File

Once all manual steps are complete, delete `MANUAL_STEPS.md` from the repo.
