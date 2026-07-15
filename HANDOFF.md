# Session Handoff

**Last updated**: 2026-07-15 17:10 EDT

## Governed MCP Resume Point

- Governed MCP implementation baseline: commit `10cf74c`, pushed to
  `origin/main`.
- Commit `10cf74c` contains the governed MCP adapter lifecycle: 37 files, 5492 additions, 57 deletions.
- Combined local verification before push: 273 passed, staged diff and whitespace clean, sensitive-literal scan clean, no blocking code-review findings.
- Shipped local capabilities: immutable profile and source manifests, offline bootstrap, exact connector plus audience TokenStore lookup, authenticated fixed-operation product client, same-subject single-use approval confirmation, denial, race handling, and no-replay after consumption, plus a catalog-only governed loader with stable `table_key`, refresh, provenance, and identity visibility.
- Not performed: gateway deployment, tenant call, Fabric call, or bulk Arrow path.
- The Markdown converter validator now scopes table column checks to each
  contiguous table; converter QA passes 231 tests with 6 skipped.
- Selected for next implementation, not yet implemented: 15-minute approval TTL, generic unavailable behavior for expired, restarted, unknown, denied, consumed, and other-subject IDs, process-local single-replica fail-closed state, request-time Microsoft Entra OBO, exact connector plus gateway-audience caching, startup composition from existing manifests and client, and `enableMcpGateway=false` as the infrastructure default.
- Resume from `docs/plans/2026-07-15-governed-mcp-production-composition.md`, `docs/plans/2026-07-14-governed-mcp-adapter-tracker.md`, and `docs/plans/ISSUES.md`.

## External Gates

- These gates do not block the offline six-step implementation below. They
  block tenant access, infrastructure preview/deployment, and live validation.
- Entra tenant-wide consent.
- MCP operations owner, Fabric fixture owner, and enterprise security reviewer
  are not yet assigned.
- Source-paired Fabric fixture.
- Deployment preview and approval.
- Live upstream validation.
- Direct-versus-MCP comparison.
- Bounded Arrow contract approval.

## Azure SQL and Deployment Safety

- Last verified production revision: `ca-dataformulator--azd-1784046335`.
- Deployed image: `azd-deploy-1784045589`; the current source tip has not been
  deployed.
- Production domain: `data.gcxteam.com`.
- Azure SQL delegated authentication still requires tenant-wide administrator
  consent before the interactive popup/MFA smoke test can complete.
- Restart-durable delegated-token sessions and the tracked DF-022 signer-cookie
  migration remain pending; keep one worker and one replica until state is
  shared.
- PR #376 remains the active integration PR; check its current CI state before
  merge.
- Keep the custom domain, managed certificate, and one-replica safety posture intact.
- Do not run `azd provision` by itself.
- No infrastructure preview or deployment is authorized by the MCP
  implementation plan. When authorization is later granted, review a what-if
  before applying changes.
- Preserve `enableMcpGateway=false` until the gated Bicep phase is approved.

## Resume Order

This is the authoritative local implementation order:

1. Read the new production-composition plan, tracker, and issue log.
2. Implement TTL cleanup with an injected monotonic clock.
3. Add restart fail-closed coverage for generic unavailable behavior.
4. Add the OBO provider with client-secret and managed-identity assertion modes.
5. Add startup composition tests with no startup network calls.
6. Wire the disabled-by-default Bicep path and run the full validation set.
