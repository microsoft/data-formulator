---
description: "Require Yarn v1.22.22 as the sole Node package manager for this repo — never npm or pnpm — when touching package.json or yarn.lock"
applyTo: "package.json,yarn.lock"
lastReviewed: 2026-07-09
---

# Package Manager Conventions (Data Formulator)

Ported from `.cursor/rules/package-manager-conventions.mdc`. Source frontmatter combined `alwaysApply: true` with a glob — rescoped here to the glob (pattern-applied, not always-on): this brain already carries a wide always-on instruction set, and this rule's fire condition (editing `package.json`/`yarn.lock`, or running a package-manager command) is narrow and detectable, so scoping it avoids adding always-on token cost for no behavioral gain.

## Rules

| Rule            | Detail                                                       |
| --------------- | ------------------------------------------------------------ |
| Package manager | Yarn v1.22.22 only — never `npm install`/`npx` or `pnpm`     |
| `yarn.lock`     | Never hand-edit; keep diffs minimal when adding dependencies |
| Registry        | Must be `https://registry.yarnpkg.com`                       |

## Anti-Patterns

| Anti-pattern                                   | Correction                                                 |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `npm install <pkg>`                            | `yarn add <pkg>`                                           |
| Hand-editing `yarn.lock` to resolve a conflict | Re-run `yarn install` and let Yarn regenerate the lockfile |
| `pnpm add <pkg>`                               | `yarn add <pkg>`                                           |

## Would Revise If

Revise if the repo migrates off Yarn to a different package manager (npm workspaces, pnpm) — this entire file would then need replacement, not just an edit.
