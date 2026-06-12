# Agent instructions for e-marq

## Branch workflow — main only (critical)

This repo is co-developed with **Lovable**, which works **only on `main`** and auto-pushes to `origin/main` (github.com/smith77788/e-marq). Every agent and human on this project works on `main` too:

1. **Do not create feature branches.** All work happens directly on `main`.
2. **Before starting any work:** `git fetch origin` and check `git status -sb`. If behind, **merge** `origin/main` first (never rebase or force-push `main` — Lovable's history must stay intact).
3. **After finishing work:** commit and `git push origin main` promptly, so Lovable and other agents see your changes and divergence never accumulates.
4. **Never use destructive git operations** (`reset --hard`, discarding changes) without explicit permission from the user.

## After merging Lovable's commits

Lovable does not run TypeScript checks or tests, and its cleanup passes have deleted test infrastructure before. After every merge of Lovable's commits:

- Run `npx tsc --noEmit` — fix type errors Lovable introduced.
- Run `npm test` (vitest) — all tests must pass.
- Verify test infra survived: `vitest.config.ts`, the `test`/`test:watch` scripts in `package.json`, and `git ls-files '*.test.ts'`. Restore from git history if Lovable deleted them.
- In conflicts: Lovable's UI/localization (Ukrainian) is usually the better side; our test/type/hardening work must be preserved.

## Line endings

`.gitattributes` enforces LF for all text files. Do not flip `core.autocrlf` to `true`. If `git status` ever shows hundreds of phantom modified files, verify with `git diff --ignore-cr-at-eol --numstat` (almost certainly 0 real changes) and clear with `git add -u`.

## Commands

- Tests: `npm test` (vitest)
- Typecheck: `npx tsc --noEmit`
- Lint: `npm run lint`
- Build: `npm run build`
