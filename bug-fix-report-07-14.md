# Security Bug-Fix Report — 2026-07-14

Systematic inspection of Dependabot (dependency vulnerability) and Code-Scanning
(CodeQL) issues, based on the `dev` branch.

## Summary

| Area | Status |
| --- | --- |
| Python dependencies (`uv.lock`, 139 pkgs) | ✅ Clean — `pip-audit` reports no known vulnerabilities |
| JavaScript dependencies (`yarn.lock`, 986 pkgs) | ✅ Fixed the one actionable advisory; 1 remaining is not exploitable (details below) |
| Code scanning (CodeQL) | ⚠️ Could not enumerate alerts from this environment — see "Uncertain / needs maintainer review" |

Most of the heavy lifting was already done on `dev` in commit `fe5d3aa`
("build(deps): apply Dependabot updates + fix security vulnerabilities"), which
brought JS `npm audit` from 6→1 and Python `pip-audit` from 14→0. This pass
handles the remainder and adds systematic prevention.

## Fixed in this PR

### 1. `brace-expansion` DoS (GHSA — moderate)
- **Advisory:** "Large numeric range defeats documented `max` DoS protection",
  vulnerable `>=5.0.0 <5.0.6`.
- **Where:** transitive dependency of the ESLint tooling
  (`@typescript-eslint/* → minimatch@10 → brace-expansion@^5.0.2`), which
  resolved to `5.0.5`. Dev-only, but still flagged.
- **Fix:** re-resolved the `brace-expansion@^5.0.2` entry in `yarn.lock` to
  `5.0.7`. The already-patched `1.1.16` and `2.1.2` lines are untouched, so no
  major-version forcing of other consumers. `yarn audit` moderate count dropped
  5 → 1.

### 2. Dependabot coverage (systematic prevention)
- **Problem:** `.github/dependabot.yml` only monitored the `devcontainers`
  ecosystem. The actual application dependencies (frontend `npm`/yarn and backend
  Python/`uv`) and CI (`github-actions`) were **not** monitored, so future
  vulnerable versions would not be surfaced automatically.
- **Fix:** added `npm`, `uv`, and `github-actions` update configs (weekly,
  `target-branch: dev`, matching the existing convention). This is the root-cause
  fix that keeps both dependency surfaces watched going forward.

## Assessed — intentionally not changed

### `uuid` "missing buffer bounds check" (GHSA — moderate)
- **Advisory:** affects `uuid < 11.1.1`, specifically **`v3`/`v5`/`v6` when a
  `buf` argument is provided**.
- **Where:** `exceljs@4.4.0 → uuid@^8.3.0` (resolves to `8.3.2`). `exceljs` pins
  `uuid` at `^8.3.0`.
- **Why not changed:** `exceljs` uses **only `uuid.v4()`** with no `buf`
  argument (`node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`),
  so the vulnerable code path (`v3`/`v5`/`v6` + `buf`) is never reached — it is
  not exploitable via this dependency. Forcing `uuid@11` through a `resolutions`
  override would be a major (8→11) bump of a transitive, pinned dependency with
  real risk of breaking `exceljs`, for no actual security benefit. This matches
  the prior maintainer decision noted in `fe5d3aa` ("remaining uuid is
  exceljs-pinned"). Recommend leaving until `exceljs` itself bumps `uuid`.

## Uncertain / needs maintainer review

### Code scanning (CodeQL) alerts could not be enumerated here
- The repository uses CodeQL **default setup** (there is no CodeQL workflow file
  under `.github/workflows/`), so alert data lives only in the GitHub Security
  tab.
- From this sandboxed agent environment the code-scanning and secret-scanning
  REST endpoints return `403 Resource not accessible by integration` (the token
  lacks the `security_events` scope), so I could **not** read the live alert list
  to fix specific findings.
- What I could verify statically:
  - The two `exec(code, namespace)` calls in
    `py-src/data_formulator/sandbox/local_sandbox.py:207` and
    `py-src/data_formulator/sandbox/not_a_sandbox.py:49` are the app's
    intentional code-execution sandbox and are already annotated
    (`# nosec  # codeql[py/code-injection]`).
  - `app.run(..., debug=debug_mode, ...)` in `py-src/data_formulator/app.py:549`
    is gated on an explicit debug flag (not hard-coded `True`).
- **Ask:** if you can share the specific open CodeQL alerts (rule id + file/line)
  from the Security tab, or grant the agent `security_events: read`, I will fix
  the localized ones in a follow-up. I intentionally avoided speculative,
  unrelated code changes without the concrete alert list.

## Verification
- `yarn install` succeeds; `yarn audit` → `moderate: 1` (the non-exploitable
  `uuid` above), down from 5.
- `pip-audit` against all 139 locked `uv.lock` versions → "No known
  vulnerabilities found".
