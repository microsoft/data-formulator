# Session Handoff

**Last updated**: 2026-07-09

## Current State

- The upstream baseline is `00d0f5e`.
- PR #376 is open.
- The stale `yarn.lock` fix is `4e185e9`.
- The source, test, IaC, audit, meditation, and handoff work listed below is included in this handoff's publication commit. Use `git log -1` for its final SHA.
- `ISSUES.md`, titled Data Formulator Audit and Change Log, contains the validated audit findings and operations record.

## Live Production

- Resource group: `rg-data-formulator`
- Revision: `ca-dataformulator--0000004`
- Image: `azd-deploy-1783629787`
- Domain: `data.gcxteam.com`
- `gpt-5.4-mini`: connected, 260K TPM, default model
- `gpt-5.4-nano`: connected, 2.009M TPM
- `gpt-5.4`: connected, 260K TPM
- All three production models pass connectivity checks.
- The managed Pro deployment was deleted. Its quota use is 0 of 160.
- The cross-subscription custom domain and managed TLS certificate are healthy.
- Live state was verified directly; it does not imply that every committed Bicep declaration has been applied as a full deployment.

## Published Files

Files included from the working tree:

- `.vscode/settings.json` (unrelated user change; preserve)
- `MANIFEST.in`
- `infra/modules/containerapp.bicep`
- `infra/modules/openai.bicep`
- `py-src/data_formulator/agent_config.py`
- `py-src/data_formulator/agents/client_utils.py`
- `py-src/data_formulator/app.py`
- `py-src/data_formulator/error_handler.py`
- `py-src/data_formulator/routes/agents.py`
- `py-src/data_formulator/routes/tables.py`
- `py-src/data_formulator/security/sanitize.py`
- `tests/backend/agents/test_client_image_strip.py`
- `tests/backend/agents/test_client_utils.py`
- `tests/backend/security/test_global_model_security.py`

Files added by the publication commit:

- `ISSUES.md`
- `tests/backend/agents/test_agent_config.py`
- `tests/backend/test_static_mime_types.py`
- `.github/episodic/INDEX.md`
- `.github/episodic/meditation-2026-07-09-azure-production-hardening.md`
- `HANDOFF.md`

## Validation Completed

- Bicep compilation completed with zero diagnostics.
- Python `compileall` completed successfully.
- Editor diagnostics are clean for the reviewed changes.
- `git diff --check` passed.
- Markdown lint passed.
- Browser and API checks confirmed demo assets, the custom domain, and all three production models.
- Full `pytest` was not run because the local environment lacks the complete backend test dependencies.

## Pending Queue

1. Review `ISSUES.md` and confirm the issue priorities.
2. Implement DF-011 with ETag concurrency, starting with a failing regression test.
3. Address DF-012 and DF-001.
4. Add bounded HTTP 429 retries for DF-009.
5. Run the full backend test suite in a dependency-complete environment.
6. Monitor PR #376 checks and address any failures against the publication commit.

## Resume Point

Read these files before changing code:

- `HANDOFF.md`
- `ISSUES.md`
- `/memories/repo/azd-deployment-gotchas.md`
- `docs/dev-guides/9-workspace-storage-architecture.md`

For continued implementation, write the DF-011 regression test first and confirm that it fails for the expected concurrency reason.

Before merging the publication commit, run the backend tests in the devcontainer and review PR #376 checks.

## Safety Notes

- Do not run `azd provision` by itself. It can reset the Container App image to a placeholder.
- Use `azd deploy web` for code-only releases.
- After every deployment, verify the live image and revision.
- Preserve `raiPolicyName` on Azure OpenAI model writes.
- Run a what-if operation before applying live infrastructure changes.
- Preserve the healthy custom domain and managed TLS binding.
- Preserve the unrelated `.vscode/settings.json` user change.
- Active Owner PIM is required for Container App writes.
- Do not recreate the Pro deployment without explicit cost approval.
- Keep the generic Pro compatibility code and tests unless a source-level review proves they are no longer valid.
