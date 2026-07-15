# Meditation: Governed MCP Lifecycle and Production Composition

**Date**: 2026-07-15

**Focus**: Governed MCP adapter lifecycle, production composition, and the open deployment gates that still block live tenant calls.

**Outcome**: Commit `10cf74c` was pushed to `origin/main` with the governed MCP adapter lifecycle: 37 files, 5492 additions, 57 deletions. Combined local verification before push passed 273 tests, the staged diff and whitespace checks were clean, the sensitive-literal scan was clean, and no blocking code-review findings remained. The local governed MCP surface now includes immutable profile and source manifests, offline bootstrap, exact connector plus audience TokenStore lookup, an authenticated fixed-operation product client, same-subject single-use approval confirmation and denial with race and no-replay handling, and a catalog-only governed loader with stable `table_key`, refresh, provenance, and identity visibility. No gateway deployment, tenant call, Fabric call, or bulk Arrow path was performed.

## Accomplished

- Pushed commit `10cf74c` to `origin/main` after the governed MCP adapter lifecycle landed.
- Verified the shipped local contract for immutable profile and source manifests, offline bootstrap, exact connector plus audience TokenStore lookup, the authenticated fixed-operation product client, and the catalog-only governed loader.
- Proved same-subject approval confirmation, denial, race handling, and no-replay behavior after consumption.
- Kept the implementation offline, with no gateway deployment, no tenant call, no Fabric call, and no bulk Arrow path.
- Confirmed the next implementation decisions for TTL, generic-unavailable behavior, single-replica fail-closed state, request-time OBO, exact caching, and startup composition, but did not implement them yet.
- Fixed the Markdown converter validator after the final documentation check
  exposed cross-table column comparisons; a focused RED test failed first, and
  converter QA then passed 231 tests with 6 skipped.

## Final State

| Fact | Verified state |
| --- | --- |
| Governed MCP implementation baseline | `10cf74c`, pushed to `origin/main` |
| Local verification before push | 273 passed, staged diff and whitespace clean, sensitive-literal scan clean, no blocking code-review findings |
| Governed MCP capability | Immutable manifests, offline bootstrap, exact TokenStore lookup, fixed-operation client, approval lifecycle, and governed loader |
| Unused live paths | No gateway deployment, no tenant call, no Fabric call, no bulk Arrow path |
| Next implementation scope | 15-minute TTL, generic unavailable behavior, single-replica fail-closed state, request-time OBO, exact caching, startup composition, disabled-by-default infra |

## Patterns Extracted

### Select the policy before wiring startup

The approval TTL, generic failure behavior, and replica model were easier to reason about once they were named as selected decisions. Startup wiring should only compose those decisions after the tests pin the contract.

### Keep the cache key exact

The connector and gateway-audience lookup must stay exact. Any fallback to a legacy token or guessed audience turns a precise contract into an inference problem.

### Treat startup as composition, not discovery

The production path should reuse the existing manifests and client. If startup has to discover, probe, or negotiate the boundary, it is doing work that belongs in a request path or an explicitly approved provisioning step.

### Closed state beats ambiguous retry

Expired, restarted, unknown, denied, consumed, and other-subject operation IDs should all look unavailable. That keeps the gateway from leaking state and keeps retries honest.

## Decisions

- Use a 15-minute approval TTL with an injected monotonic clock and race-safe cleanup.
- Map expired, restarted, unknown, denied, consumed, and other-subject operation IDs to the same generic unavailable behavior.
- Keep approval state process-local and fail closed outside a single replica.
- Use request-time Microsoft Entra OAuth 2.0 OBO exchange from the signed-in user assertion.
- Cache exact connector plus gateway-audience TokenStore entries.
- Compose production startup from the existing manifests and fixed client.
- Keep `enableMcpGateway=false` as the infrastructure default.

## Open External Gates

- Entra tenant-wide consent for the gateway audience.
- Named owners and a named security reviewer.
- A source-paired Fabric fixture with a direct comparison path.
- Deployment preview and explicit approval.
- Live upstream validation.
- Direct-versus-MCP comparison.
- Bounded Arrow contract approval.

## Durable References

- `HANDOFF.md`
- `docs/plans/ISSUES.md`
- `docs/plans/2026-07-14-governed-mcp-adapter-tracker.md`
- `docs/plans/2026-07-15-governed-mcp-production-composition.md`
- `docs/plans/2026-07-14-internal-mcp-gateway-provisioning.md`
