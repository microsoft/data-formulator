# Changelog

Notable changes to Data Formulator are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[PEP 440](https://peps.python.org/pep-0440/).

## [Unreleased]

### Changed

- The agent finds and reads session content with three path-based tools:
  `list_files`, `read_file` and `search`. `search` returns whole matching
  table rows, so looking up a code by its label (for example a UIS indicator)
  takes one call instead of two or three. `read_file` reads several items at
  once, with rows for tables, sheets for Excel and pages for PDFs. Large text
  files are read in pages. Earlier agent memory now appears as ordinary files
  under `memory/`. See design-docs/65.
- Saved and built-in workflows are read-only files under `workflows/`, so the
  agent can read a saved workflow's full definition and revise it. Charts are
  read as session files, and requests no longer carry sample rows for every
  chart.
- Connected-source catalogs are read-only files under `sources/`. One search
  now covers both the session and the catalogs: it shows the session's matches
  first, then matching catalog tables. Reading a table shows its columns and
  the identifiers needed to query or load it. The four separate catalog
  discovery tools are gone.
- Report writing is always available to the agent, so a report request no
  longer spends a model turn loading it first.

### Fixed

- After the agent edits a report to remove a chart, it can now delete that
  chart in the same request. When a deletion is refused because a report was
  made from the table being removed, the agent is told that only the user can
  remove that report, so it asks instead of retrying.
- The agent no longer tries to edit notes the user wrote (it is not allowed
  to); it adds its own notes file instead.

- Agent requests no longer wait for the Python sandbox to start before calling
  the model: the worker now starts in the background. In a new UIS demo session,
  the first model call starts 5–6 s sooner.
- Demo-site sessions share warm Python workers like other local sessions, so a
  new demo session no longer starts its own worker (5–8 s on the first Python step).
- While the model is rate limited, the agent now tells the user it is retrying
  and when, instead of going silent for up to 70 s. It waits as long as the
  provider asks when the provider says so.

## [0.8.0b1] - 2026-08-15

### Added

- A unified Data Thread for questions, clarifications, explanations, tables,
  charts, and branching exploration.
- Conversational data loading with source discovery, plan review, and previews.
- Persistent file attachments and local-folder access in the desktop app.
- Databricks Unity Catalog support and expanded enterprise authentication.
- Self-contained Windows and macOS preview builds.

### Changed

- Expanded the Flint-powered chart gallery, recommendations, themes, and style
  refinement.
- Improved catalog spacing on large displays and made code and identifier
  typography consistent across operating systems.
- Standardized button sizing, icon spacing, and action styles across display
  densities, starting with model management.
- Made sessions default to recent activity and simplified session sorting,
  creation, and import controls.
- Improved workspace persistence, credential handling, connector diagnostics,
  and analyst context across an exploration.

## [0.7] - 2026-05-28

### Added

- Governed data connectors, agent-assisted loading, a unified Data Thread,
  persistent workspaces, chart refinement, reports, and multilingual UI.

## [0.6] - 2026-01-26

### Added

- Live data from URLs and databases with automatic refresh.

## [0.5.1] - 2025-12-08

### Added

- Community data loaders, US maps, pie charts, and editable reports.

### Changed

- Improved application responsiveness.

For earlier releases, see the
[GitHub release history](https://github.com/microsoft/data-formulator/releases).

[Unreleased]: https://github.com/microsoft/data-formulator/compare/0.8.0b1...HEAD
[0.8.0b1]: https://github.com/microsoft/data-formulator/releases/tag/0.8.0b1
[0.7]: https://github.com/microsoft/data-formulator/releases/tag/0.7
[0.6]: https://github.com/microsoft/data-formulator/releases/tag/0.6
[0.5.1]: https://github.com/microsoft/data-formulator/releases/tag/0.5.1