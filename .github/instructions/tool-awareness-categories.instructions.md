---
description: "Common deferred tool categories and search-query patterns — scoped reference loaded when working with tools, MCP servers, or GitHub APIs"
applyTo: "**/*tool*,**/*mcp*,**/*github*,**/*notebook*,**/*browser*,**/*playwright*,**/*figma*,**/*mcp*/**,**/*tool*/**"
lastReviewed: 2026-05-18
---

# Tool Awareness — Categories Reference

Companion to `tool-awareness.instructions.md`. The always-on rule is *search before calling*; this file is the search-query lookup.

## Common Deferred Tool Categories

| Category | Example tools | Search query |
| --- | --- | --- |
| GitHub operations | issues, PRs, repos, code search, branches, tags | `github` |
| Azure MCP | Storage, KeyVault, Cosmos, SQL, AKS, App Service (48+ services) | `azure` or the specific service name |
| Microsoft Fabric | Eventstream, Kusto, OneLake, items | `fabric` or `onelake` |
| Microsoft docs | docs search, code samples, full-page fetch | `microsoft docs` |
| Browser automation | click, navigate, screenshot, fill form, evaluate JS | `browser` or `playwright` |
| Notebook operations | run cell, edit notebook, read output | `notebook` |
| Mermaid rendering | preview, validate diagrams | `mermaid` |
| Bicep / ARM | best practices, schema, diagnostics, format | `bicep` |
| Figma | design context, code connect, screenshots | `figma` |
| Microsoft Graph | get, list, suggest queries | `microsoft graph` or `entra` |

## Anti-Pattern

Do not hardcode tool names from `availableDeferredTools` without loading them via `tool_search`. The list is informational; actual availability requires the search call.

## When this file does not load

If the topic is not in the glob (e.g., pure prose editing, doc curation), the categories table doesn't load. The always-on `tool-awareness.instructions.md` still fires the *rule*; if a deferred tool is needed, broaden the search query empirically (start with one word, iterate).

## Would Revise If

Revise if the categories table goes stale (VS Code adds new deferred tool families not listed), if the search-query patterns produce zero results for tools that `availableDeferredTools` lists as present, or if the "broaden the search query empirically" guidance fails to recover tools that should be reachable.
