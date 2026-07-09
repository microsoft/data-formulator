# Meditation: Azure Production Hardening and Stability Audit

**Date**: 2026-07-09 \
**Session focus**: Azure production deployment, model stability, packaging, and security audit \
**Outcome**: Production hardened and validated, with remaining source, test, IaC, and audit work documented for continuation.

## Accomplished

- Ported the Cursor rules and skills to Copilot without removing the Cursor equivalents. The result includes `COPILOT_PORTING_GUIDE.md` and the `df-*` instructions and skills.
- Added IaC for Azure Container Apps, ACR, Azure OpenAI, private networking, managed identity, and monitoring. Deployed the environment to `rg-data-formulator`.
- Repaired the stale `yarn.lock` and committed the fix as `4e185e9`.
- Fixed missing demo thumbnails. `MANIFEST.in` included only the top-level `dist` content, so nested `dist/demos` assets were absent from the package. The manifest now includes `dist` recursively.
- Added companion MIME hardening for WebP and AVIF images.
- Evolved the model set to Mini as the default, Nano for high-throughput work, and GPT-5.4 for heavier work. Pro was tested and removed because of cost. GPT-5.5 and GPT-5.6 were unavailable because their quota was zero.
- Increased production capacity after Mini returned HTTP 429 at 5 RPM and 5K TPM.
- Fixed the Pro connectivity probe token minimum, classifier regex behavior, and reasoning-effort compatibility in source and tests. Generic Pro compatibility remains even though the managed Pro deployment was deleted.
- Configured `data.gcxteam.com` across subscriptions with managed TLS. This environment-specific domain binding was not added to the generic Bicep.
- Completed a deep adversarial audit. `ISSUES.md`, now titled Data Formulator Audit and Change Log, records 15 issues and 8 change or operations entries as a dated audit snapshot.

## Patterns Extracted

- An `azd` build can succeed while the Container App update fails after Owner PIM expires. Build success does not prove that the new image reached production.
- Running `azd provision` can restore an image placeholder. Code-only releases should use `azd deploy web`, followed by live revision and image verification.
- CloudGov controls can affect both network and model deployment behavior. An NSG can block ingress, and the Azure policy requires `raiPolicyName` on model writes.
- Run a what-if operation before a live infrastructure update, especially when existing custom domains, model deployments, or policy-controlled properties are involved.
- Package manifests can be the root cause even when the required files are present in source and in the local build tree.
- Check telemetry and deployed behavior before reading code. Runtime evidence narrowed both the 429 incident and the missing-thumbnail failure quickly.
- Reject review findings that do not survive direct source tracing. An adversarial review is useful only when each claim is checked against the actual execution path.
- Deployment gotchas are already persisted in `/memories/repo/azd-deployment-gotchas.md`. A duplicate skill would create drift rather than durable value.

## Lessons

- Capacity is part of application correctness for managed LLMs. A valid endpoint with insufficient quota still produces a broken user experience.
- Managed model compatibility and managed deployment lifecycle are separate concerns. Generic Pro behavior remains valuable for external endpoints even after deleting the project's Pro deployment.
- Environment-specific production bindings should not automatically enter reusable IaC. The cross-subscription custom domain is healthy, but encoding it generically would require an explicit design decision.
- Local static-file inspection is insufficient for packaging failures. Validate the installed artifact or deployed container.
- A review result is a hypothesis, not a finding, until direct source tracing confirms the behavior.

## Failure Post-Mortems

### Stale Frontend Lockfile

The frozen Yarn build failed because `yarn.lock` no longer matched the dependency state. Regenerating and committing the lockfile as `4e185e9` restored reproducible ACR builds.

### Missing Demo Thumbnails

The source tree contained the images, but `MANIFEST.in` omitted nested `dist/demos` content. Recursive inclusion fixed the package. Explicit WebP and AVIF MIME registration hardened minimal container environments.

### Mini Rate Limiting

Mini returned HTTP 429 under a 5 RPM and 5K TPM allocation. The application code was not the primary cause. Raising capacity restored repeated successful requests.

### Pro Compatibility

The Pro probe required a larger output-token allowance. Error classification also confused `max_output_tokens` validation with prompt overflow, and some reasoning-effort values were incompatible. Source and regression tests now preserve the corrected generic behavior.

### Deployment Authorization Drift

An `azd` build completed while the live application update failed after PIM expiration. Future releases must verify the active revision and image rather than treating build completion as deployment completion.

## Open Questions

- Which remaining audit findings should be implemented in the current pull request?
- Full `pytest` validation remains unavailable in the current local environment. Which dependency-complete environment should be the release gate?
- DF-011 should be implemented first with ETag concurrency. DF-012 and DF-001 follow.
- DF-009 still needs bounded HTTP 429 retries.
- The publication commit must pass remote checks and CI in PR #376.
- Is `maxReplicas: 3` safe while application state remains local?
- Generic Pro tests remain useful, but should they be isolated from managed-deployment assumptions?

## Durable References

- `ISSUES.md`
- `COPILOT_PORTING_GUIDE.md`
- `/memories/repo/azd-deployment-gotchas.md`
- `docs/dev-guides/9-workspace-storage-architecture.md`
- Production resource group: `rg-data-formulator`
- Production revision: `ca-dataformulator--0000004`
- Production image: `azd-deploy-1783629787`
- Production domain: `data.gcxteam.com`
- Production model capacity: `gpt-5.4-mini` at 260K TPM, `nano` at 2.009M TPM, and `gpt-5.4` at 260K TPM
