---
name: workspace
description: Read workspace inputs and manage durable workspace memory.
always_on: false
tools:
  - list_workspace_items
  - read_workspace_item
  - search_workspace_items
  - manage_workspace_memory
actions: []
---

# Workspace

The `[WORKSPACE INPUTS]` block already contains the complete current input
inventory and stable IDs for this run. Reuse those IDs directly with
`read_workspace_item` or `search_workspace_items`; do not call
`list_workspace_items` first. List only when you need all managed memory
(including stale entries), a current memory content hash before patching, the
run-scoped temporary inventory, or an explicit filtered refresh. Temporary
items marked Python-only must be read with `execute_python_script` using their
listed path.

Workspace files are analysis inputs even when no data table exists. Table memory
appears as data and text memory as a file. Reuse fresh memory instead of
re-extracting its source.

Use `manage_workspace_memory` to save or refresh durable table/Markdown results,
patch text with hash-guarded exact replacements, rename entries, or delete them.
Save memory only when an expensive extraction or durable correction is likely to
help later work. Preserve exact source IDs and locators. Before patching, list
memory for its current content hash and read the item; prefer a small exact patch
over replacing the document.