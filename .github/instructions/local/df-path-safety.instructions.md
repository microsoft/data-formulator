---
description: "Server-side path-safety coding rules — require ConfinedDir for all user-controlled path access in routes, agents, data loaders, and the datalake; auto-reminds when editing those directories"
applyTo: "py-src/data_formulator/routes/**/*.py,py-src/data_formulator/agents/**/*.py,py-src/data_formulator/data_loader/**/*.py,py-src/data_formulator/datalake/**/*.py,py-src/data_formulator/security/**/*.py,py-src/data_formulator/knowledge/**/*.py"
lastReviewed: 2026-07-09
---

# Path Safety (Data Formulator)

Ported from `.cursor/rules/path-safety.mdc` (source content is in Chinese — kept as-is; bilingual convention across this repo's dev docs). Expanded the original brace-group glob (`{routes,agents,data_loader,datalake,security,knowledge}`) into an explicit comma list since brace-expansion support in VS Code's `applyTo` matcher wasn't verified at port time. Canonical source: [`docs/dev-guides/8-path-safety.md`](../../docs/dev-guides/8-path-safety.md) and [`.github/skills/path-safety/SKILL.md`](../skills/path-safety/SKILL.md).

## `ConfinedDir` is the only path-constraint primitive

Any code accepting a user-controlled path MUST go through a `ConfinedDir` instance:

```python
from data_formulator.security.path_safety import ConfinedDir

jail = ConfinedDir(root_dir, mkdir=False)
try:
    target = jail.resolve(user_input)
except ValueError:
    return {"error": "Access denied"}
```

## Banned Patterns

| Anti-pattern                                              | Why it's banned                                          |
| --------------------------------------------------------- | -------------------------------------------------------- |
| `target = Path(root) / user_input`                        | Bare path concatenation — no traversal check             |
| `target.relative_to(root)` after manual `resolve()`       | Deprecated hand-rolled check — use `ConfinedDir`         |
| `resolved.is_relative_to(root.resolve())` written by hand | Deprecated — `ConfinedDir` does this internally          |
| `str(target).startswith(str(root))`                       | Prefix-collision bug (`/workspace` vs `/workspace_evil`) |

## Correct Patterns

| Scenario            | Pattern                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Agent tool          | `workspace_jail = self.workspace.confined_root`; `target = workspace_jail.resolve(rel_path)`                       |
| File download route | `scratch_jail = workspace.confined_scratch`; `target = scratch_jail.resolve(filename)`; `return send_file(target)` |
| File upload         | `safe_name = secure_filename(raw_filename)`; `target = scratch_jail.resolve(safe_name)` (two-layer defense)        |
| Workspace data file | `path = workspace.get_file_path(filename)` (uses `ConfinedDir` internally)                                         |

## Deployment Guards

- A new Loader that reads the host filesystem must be registered in `_enforce_deployment_restrictions()` to be disabled in multi-user mode.
- Multi-user mode (`WORKSPACE_BACKEND != "local"`) must enable the sandbox (`SANDBOX=docker` or `SANDBOX=local`).

## Would Revise If

Revise if `docs/dev-guides/8-path-safety.md` adds a new required rule (R1–R6 in the original guide) not reflected here, or if VS Code's `applyTo` glob matcher is confirmed to support brace-expansion — at that point this file's glob can be simplified back to the compact brace form.
