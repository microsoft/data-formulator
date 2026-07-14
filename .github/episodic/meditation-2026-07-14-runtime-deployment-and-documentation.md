# Meditation: Runtime Reliability, Deployment, and Documentation Truth

**Date**: 2026-07-14 \
**Session focus**: Repository audit completion, frontend state recovery, connector lifecycle repair, LiteLLM/Azure OpenAI hardening, production rollout, Agency tooling sync, and living-document reconciliation \
**Outcome**: Runtime source commit `f960263` is deployed and production-verified on revision `ca-dataformulator--azd-1784046335`; DF-024 and DF-025 are closed. Agency tooling and deployment records are published through `bf1ff5f`. Entra admin consent and durable shared sessions remain open.

## Accomplished

- Completed and published the audit, architecture, meeting, and Data Formulator 2 paper package.
- Distinguished the built-in non-deletable Example Datasets connector from user connectors and traced its generic sidebar error to a no-auth lifecycle inconsistency.
- Fixed no-auth connectors so status, catalog, preview, import, and refresh share lazy per-identity loader initialization.
- Added startup reconciliation so persisted browser state cannot recreate server state after a production reset.
- Audited the model layer against current LiteLLM documentation and narrowed the findings to the Azure OpenAI deployment actually in use.
- Added 90-second per-attempt and 120-second logical completion budgets, safe pre-first-chunk streaming retries, composed compatibility fallbacks, and typed timeout classification.
- Pinned LiteLLM 1.91.1 across package metadata and the lockfile.
- Synchronized hardened Agency installer/verifier behavior, protected the generated local tool snapshot, and removed broken target-project links.
- Deployed source commit `f960263` as image `azd-deploy-1784045589` with digest `sha256:34755ba63b62236cf2bb023a00c9b9cae6a89acf361fff5cef8041c17cbbf482`.
- Verified one ready replica, zero restarts, 100% traffic, preserved custom domain/identity/environment/port/scale/Azure SQL settings, LiteLLM 1.91.1, ODBC Driver 18, all Azure models connected, 16 Example Datasets nodes, successful non-streaming and streaming tool-enabled completions, clean browser reload, and zero residual smoke workspaces.
- Published three independently reviewable commits:
  - `f960263`: connector and Azure OpenAI/LiteLLM runtime hardening.
  - `8fd15e6`: Agency installer, verifier, and local-snapshot hygiene.
  - `bf1ff5f`: verified production deployment record and living-doc alignment.

## Final State Ledger

| Fact | Verified state |
| --- | --- |
| Git source and documentation tip | `bf1ff5f` on local and `origin/main` |
| Deployed runtime source | `f960263` |
| ACR image | `azd-deploy-1784045589` |
| Image digest | `sha256:34755ba63b62236cf2bb023a00c9b9cae6a89acf361fff5cef8041c17cbbf482` |
| Production revision | `ca-dataformulator--azd-1784046335` |
| Traffic and replica | 100%; one ready replica; zero restarts |
| Immediate rollback artifact | Retained image `recreate-11dfb1fd3d3c` from `11dfb1f`; no live rollback revision is retained |
| Next operational action | Obtain Entra admin consent, then run interactive Azure SQL popup/MFA and staging catalog smoke |

## Patterns Extracted

### Build, activation, and readiness are separate deployment gates

An ACR image can be published while the Container App remains on its prior image. Treat deployment as three independently observable events:

1. The image tag and digest exist.
2. The app template references that image and creates a new revision.
3. The revision is ready, receives intended traffic, and passes behavioral smoke tests.

If event 1 succeeded and event 2 did not occur, continue with `azd deploy web --from-package <image>` rather than rebuilding or provisioning.

### Dirty worktree risk should be evaluated at the build-input boundary

A dirty repository does not automatically imply a contaminated container image. The discriminating check is whether any path copied by the Dockerfile differs from the committed source. Enumerate `COPY` inputs and compare only those paths to `HEAD`; keep unrelated changes outside the build and outside the runtime commit.

For this deployment, the check covered `Dockerfile`, frontend package/config and
source paths, `public/`, Python package metadata, `README.md`, and `py-src/`.
Every copied input matched `f960263`; only Agency and documentation files outside
the Docker build inputs were dirty. The remote image therefore represented the
committed runtime source despite the non-clean worktree.

### HTTP success is not application success

Data Formulator intentionally returns HTTP 200 for controlled application errors. Production validation must inspect response envelopes (`status`, structured `error`) and correlate request IDs with logs. A generic browser message such as “Data connector error” is a symptom, not the cause.

### Smoke tests must cross the intended abstraction boundary

A streaming-agent request without `X-Workspace-Id` failed before model invocation. It was not evidence about LiteLLM or Azure OpenAI. Production smoke tests must satisfy route prerequisites, prove the model path was reached, inspect the NDJSON event sequence, and clean up disposable state independently.

### Source status and runtime status must stay separate

The source tip, deployed source commit, deployment-record commit, image tag/digest, revision, and rollback artifact are different facts. Living documents must state each explicitly. Dated historical checkpoints retain their original evidence; current-state sections supersede them without rewriting history.

### Server reset is incomplete while persisted clients can write back

Clearing container-local sessions and workspaces does not produce a clean system if redux-persist still holds an active workspace and autosave mounts immediately. Reconcile the resolved identity and server workspace list before mounting autosave; reset stale local state only when the authoritative non-ephemeral server proves the workspace is absent.

The end-to-end regression seeded a stale workspace and table in IndexedDB, then
reloaded against an isolated empty backend. The client cleared `activeWorkspace`
and tables, the server session list remained empty, and no `/api/sessions/save`
request occurred during the five-second autosave window.

## Mistakes and Corrections

- A first deployment process built and published the image but did not update the app. Azure ground truth showed no new revision; the rollout resumed from the immutable image with `--from-package`.
- The first streaming smoke request omitted `X-Workspace-Id`, creating an expected pre-agent traceback. The corrected workspace-bound request produced `text_delta,text_delta,done` and exact `STREAM_OK`.
- PowerShell follow-up checks printed stale variables after timed-out requests. Cleanup was re-verified with `curl.exe` and a fresh server list instead of trusting prior shell state.
- A maintainer review initially reported contradictory verifier exit behavior that the source did not contain. Reading the actual control-flow tail rejected the false positive; validation then exposed the real issue, an unignored machine-specific `agency/VERSION.json` with broken links in target docs.
- A formatter/tool-output rendering made a correct Chinese word appear split. Reading the source prevented an unnecessary edit.
- A broad documentation update initially left stale revision and rollback claims in lower sections. A no-context comprehension review found them, and the living documents were reconciled before commit.

## Validation Evidence

- Backend: 2,032 passed, 13 skipped.
- Frontend: 35 files, 277 tests passed.
- Model/client focused suite: 90 passed; adjacent error/stream/security suite: 172 passed.
- Agency: both PowerShell scripts parse; disposable installer dry run passes; generated baseline and no-flag verifier pass; local snapshot is ignored.
- Documentation: Markdown diagnostics and `git diff --check` clean; no-context reviews pass.
- Git: local and remote `main` match `bf1ff5f`; working tree clean before meditation.
- Azure: revision `ca-dataformulator--azd-1784046335`, image `azd-deploy-1784045589`, digest recorded above, one ready replica, zero restarts, and 100% traffic.
- Docker input purity: every path copied by the Dockerfile matched runtime commit
  `f960263`; unrelated dirty files were outside the build context inputs.
- Persisted-client reset: stale IndexedDB state cleared, server sessions stayed
  empty, and autosave did not reconstruct the removed workspace.

## Remaining Gates

| Gate | Owner | Next action | Completion evidence |
| --- | --- | --- | --- |
| Azure SQL delegated consent and MFA | Fabio coordinates an eligible Entra administrator | Grant tenant-wide `user_impersonation`, then run the production popup against the approved staging database | Delegated grant exists; popup completes; catalog is accessible |
| Durable shared sessions and DF-022 | Fabio drives the decision and assigns the implementation owner | Select the approved shared session/token backend and one cookie-migration strategy | Restart and cross-worker tests pass; signer warning is absent; one-worker/replica cap can be reconsidered |
| PR #376 decomposition | Fabio with upstream maintainers | Split or reframe the bundled adaptation into reviewable contribution surfaces | CI is current and each accepted surface has an owner and maintenance contract |
| DF-023 direct-versus-MCP decision | Fabio and Chenglong establish priorities; implementation owner follows the decision | Run the same-source direct/MCP spike under the documented identity, data, provenance, reliability, and operations contract | Decision record accepts or rejects a generic runtime MCP facility using measured evidence |

## Continuity Contract

This chronicle matches the current state and queue in `HANDOFF.md`; it does not
supersede the handoff. Future sessions should read the handoff for current live
facts and use this chronicle for the reasoning, failure modes, and reusable
patterns behind those facts.

## Durable References

- `HANDOFF.md`
- `docs/plans/ISSUES.md`
- `docs/plans/2026-07-14-chenglong-adaptation-meeting.md`
- `docs/plans/2026-07-14-enterprise-data-access-architecture.md`
- `docs/dev-guides/14-model-capability-runtime-degradation.md`
- `/memories/repo/azd-deployment-gotchas.md`
- `/memories/repo/project-conventions.md`
