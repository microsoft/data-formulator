---
name: deploy-data-formulator
description: 'Create, configure, update, or troubleshoot a Data Formulator deployment. Use for hosted installations, managed mode, administrator access, shared models and connectors, persistent workspaces, packaging, and deployment verification. Focuses on Data Formulator application requirements; adapts infrastructure and commands to the chosen platform and existing resources.'
---

# Deploy Data Formulator

Help the user deploy a working Data Formulator installation, not just a reachable
web page. Reuse their infrastructure, identity provider, models, and storage when
appropriate. This skill does not prescribe a cloud subscription, region, resource
name, provisioning tool, or deployment script.

## Establish the Target

Ask only questions not already answered by the request or environment:

- New installation, upgrade, configuration change, or migration? Which source
  revision or released image/package should be deployed?
- Host/platform, public URL, and target environment? Existing resources or new
  ones? Confirm the account, tenant, subscription/project, and slot when relevant.
- Audience: local owner, authenticated team, or anonymous demonstration?
- Managed mode? Who administers it? Must personal connectors/models be blocked
  by deployment policy, or may administrators decide?
- Persistent or disposable workspaces? Which storage is available?
- Approved shared model and data sources? Authentication method for each?
- Execution isolation, network restrictions, backup, and availability requirements?

Summarize the target and application settings before making changes. Get approval
for resource creation, costs, permission grants, public exposure, destructive
changes, and changes to an existing deployment's authentication or data retention.
Do not change the active cloud account or reuse a similarly named resource without
confirming its identity. Resource creation is platform-specific: the agent may
choose suitable tools and resources with the user, subject to these requirements.

## Verify the Selected Revision

Read [DEVELOPMENT.md](../../DEVELOPMENT.md), especially Managed Mode, Deployment
Profiles, sandbox limitations, and Server Migration Checklist. Check
[pyproject.toml](../../pyproject.toml), [package.json](../../package.json),
[Dockerfile](../../Dockerfile), and [MANIFEST.in](../../MANIFEST.in) for the
selected revision's runtime, build, and packaged-asset requirements.

When a setting is unclear, check its implementation in
[app.py](../../py-src/data_formulator/app.py),
[configuration.py](../../py-src/data_formulator/configuration.py),
[identity.py](../../py-src/data_formulator/auth/identity.py), and
[configurations.py](../../py-src/data_formulator/routes/configurations.py).
Do not confuse this agent skill with the application's internal analyst skills.
Do not rely on ignored local deployment scripts or assume their targets apply.

## Choose Application Settings

Treat authentication, managed administration, resource policies, workspace
storage, and execution isolation as separate decisions.

| Setting | Application meaning |
| --- | --- |
| `DF_MANAGED=true` | Enables administration for authorized users. Does not configure authentication, storage, or isolation. |
| `AUTH_PROVIDER` | Select the supported provider appropriate to the host. Configure the provider itself, not just this variable. |
| `ALLOW_ANONYMOUS=false` | Require authenticated application identity for a team installation. |
| `DF_ADMIN_EMAILS` | Comma-separated full sign-in addresses, currently supported by Azure EasyAuth. Case-insensitive exact matching; no directory lookup or owner/role synchronization. |
| `DF_ADMIN_IDENTITIES` | Alternative comma-separated verified `user:<subject>` IDs. Either allowlist can grant administration when both are set. |
| `DISABLE_DATA_CONNECTORS=true` | Block personal connector creation and use; shared administrator-configured sources remain available. Administrators cannot override this deployment lock. |
| `DISABLE_CUSTOM_MODELS=true` | Block personal models; shared models remain available. Administrators cannot override this deployment lock. |
| `DISABLE_DISPLAY_KEYS=true` | Hide server keys in the UI. Not a substitute for backend authorization or secret storage. |
| `WORKSPACE_BACKEND` | `local`, `azure_blob`, or `ephemeral`, according to durability requirements. |
| `DATA_FORMULATOR_HOME` | Writable installation data directory on storage with the required persistence. Do not assume a platform's default home is durable. |
| `FLASK_SECRET_KEY` | Signs Flask session cookies (normally containing a server-side session ID) and supplies the default production generated-code signing key. A leak compromises these signatures, not just code validation. Store in a secret manager; keep stable across restarts, workers, and upgrades. |
| `DF_CODE_SIGNING_SECRET` | Optional independent secret for generated-code signing and verification, overriding derivation from the Flask key. Store separately and keep stable; a leak permits forging code signatures. |
| `CREDENTIAL_VAULT_KEY` | Separate Fernet key encrypting stored credentials. Required for saving shared connections through Administration on remote servers. A leak plus access to the encrypted vault exposes credentials. Store in a secret manager and preserve with vault backups; rotation requires credential migration. |
| `SANDBOX` | Choose an execution backend supported by the host and threat model. Managed mode does not select one. |

Fresh managed installations default to shared-only resources. Without deployment
locks, administrators can relax these defaults. Existing saved policies remain
active when managed mode is turned off. Avoid the deprecated `DISABLE_DATABASE`
preset for new installations: it also selects ephemeral storage and other legacy
restrictions.

### Secret Storage and Rotation

- Generate independent cryptographically random secrets once per installation.
  Prefer a managed secret store such as Azure Key Vault. For App Service, use Key
  Vault references for the environment settings and grant the app's managed
  identity only the necessary secret-read access. Verify reference resolution
  without printing values. Other hosts can use equivalent secure secret injection.
- Never commit keys, bundle them in deployment archives, or expose them in logs,
  commands recorded in chat, or configuration API responses. Secret managers
  protect storage and access management, not a compromised runtime that can read
  the resolved secrets.
- Flask normally stores session data on the server and signs the session-ID cookie;
  knowing the key alone does not reveal stored sessions or mint an Entra identity.
  If Flask-Session is unavailable, this app falls back to Flask's signed cookie
  sessions. Verify the expected session backend in production.
- After a Flask key leak, investigate and rotate consistently across workers;
  expect signed session cookies to become invalid. Generated-code signatures also
  become invalid when derived from that key, but not when a separate unchanged
  `DF_CODE_SIGNING_SECRET` is used. Rotating the code-signing key requires affected
  generated code to be regenerated/re-signed through the trusted application flow.
- Do not replace `CREDENTIAL_VAULT_KEY` blindly or enable unattended key rotation:
  existing vault entries require decryption with the old key and re-encryption
  with the new one, or deliberate credential re-provisioning. Preserve recovery
  material securely and rotate exposed upstream credentials as appropriate.
- Do not deploy with `--dev`: without an explicit code-signing secret, development
  mode uses a fixed, publicly known signing key. Keep production signing secrets
  stable rather than relying on automatically generated per-process Flask keys.

### Identity Boundary

- Local-owner administration is only for genuine single-user localhost operation.
  A reverse proxy or a WSGI listener does not make local-owner identity safe for
  remote users. Explicitly configure hosted authentication.
- For Azure EasyAuth, enable App Service Authentication with the approved issuer,
  audience, and user/guest policy. Prevent direct access bypassing the trusted
  ingress. The provider trusts platform-injected principal headers; client-supplied
  headers are not authentication proof.
- `DF_ADMIN_EMAILS` must match the actual EasyAuth sign-in name, which can differ
  from a secondary email alias or guest user's home email. Missing names deny
  email-based admin access. Access follows an address if reassigned; maintain the
  list. Object IDs still identify workspaces and credentials.
- For other providers use verified identity IDs unless the selected revision
  explicitly supports authenticated email-based administration for that provider.
- Never grant administration through an anonymous browser identity. Check for
  stale entries in both admin allowlists when removing access.

### Persistence and Isolation

- Persist the installation home even with Blob-backed workspaces: configuration,
  workflow files, credentials, and sessions are not all stored in Blob.
- For `azure_blob`, configure `AZURE_BLOB_ACCOUNT_URL` and `AZURE_BLOB_CONTAINER`
  with working runtime identity permissions, or an approved connection-string
  alternative. Use the actual endpoint, including sovereign-cloud suffixes.
- Keep private per-user workspace storage separate from shared published data
  sources. Shared resources may be available to every application user; do not
  imply they provide group-specific data permissions.
- Do not treat Python audit-hook restrictions as equivalent to container/OS
  isolation. Review the current sandbox limitations. In particular, the Docker
  sandbox's host bind mounts are not supported by simply nesting the application
  inside another container. Arrange supported isolation or disclose the gap.
- Multiple workers/instances need consistent keys and installation state. Verify
  session storage, file locking, and credential-store support on the selected
  filesystem. Blob workspace support alone does not establish multi-instance safety.

## Build and Deploy

Use the chosen platform's native deployment mechanism. Generate commands as
needed instead of committing scripts containing deployment-specific targets.

1. Inspect existing non-secret settings with a narrow allowlist. Avoid printing
   full app-setting lists, environment files, vault contents, keys, or tokens.
   Use the host's secure secret-entry/store mechanism; never ask for secrets in chat.
2. Build from the approved revision using its package-manager/lockfile conventions.
   The frontend build must produce the assets the backend serves. For source
   builds, verify `py-src/data_formulator/dist/index.html` exists. Use `uv` for
   Python installation and execution when working in this repository.
3. Package only runtime code, built frontend, dependency metadata, and required
   package data. Include analyst modes/skills and bundled workflow assets; confirm
   the chosen wheel, image, or ZIP actually contains them. Exclude `.env`, local
   configuration, credentials, keys, databases, workspaces, caches, and logs.
   Inspect the artifact manifest; a broad directory ZIP is not a secret audit.
4. Choose a startup command matching the artifact. The installed CLI is
   `data_formulator`; for a source-layout WSGI deployment the import target is
   `data_formulator.app:app` with `py-src` on the module path (for example through
   Gunicorn's `--chdir py-src`). Verify which source or installed package is actually
   imported. Align the listening port and host with platform routing and health checks.
5. Apply approved app settings and secrets without rotating existing keys. Merge
   operations may retain obsolete settings: remove them explicitly only after
   review. On Azure App Service, distinguish a prebuilt artifact from an Oryx build;
   ensure the startup path serves the uploaded frontend and backend, not stale files.
6. Deploy/restart using the platform tools. Preserve the previous artifact and a
   consistent state backup for rollback. A code rollback alone may not restore
   configuration, workflow, or credential compatibility.

Never reuse the application-wide secret as a connector password. Do not infer
success merely because packaging or the platform upload command succeeded.

## Configure Data Formulator

As an authorized administrator:

1. Open `/configurations`. An installation with no models can still use this route
   to configure the first shared model.
2. Add/test shared models and select a default. Verify provider names, deployment
   names, endpoint URLs, API versions, and runtime identity permissions. Azure
   managed identity is distinct from the end user's application sign-in.
3. Add/test shared connectors with approved credentials. Some connectors need
   per-user interactive authentication and cannot use the shared setup form.
   Inspect the selected loader's schema rather than inventing parameter names.
4. Configure workflows, examples, limits, and permitted personal-resource policies.
   Environment-controlled restrictions must remain locked. Environment-defined
   resources may require deployment changes rather than in-app credential edits.
5. Optionally set App name and Tagline under Appearance. These are saved admin
   settings, not deployment environment variables. Blank values restore defaults.
6. Save and verify the resulting configuration. Check each operation's actual
   persistence behavior: connection dialogs can test and save immediately, while
   other form edits remain drafts until Save changes.

Keep administrator-provided credentials out of public API payloads and logs. When
testing a data source, use the smallest approved read and avoid importing an
entire large dataset just to prove connectivity.

## Verify and Hand Off

- Load the public URL and confirm frontend assets and backend version match the
  intended deployment. Inspect startup warnings and failures with secrets redacted.
- Test real sign-in through the deployed ingress, not forged principal headers.
  Check admin and ordinary-user access separately. A user without administration
  must be denied by the configuration API, not merely have a hidden menu.
- Test one shared model request and one authorized connector listing/small read.
  Verify deployment-locked personal resources cannot be created or used.
- Disable a shared resource and verify new direct-ID/agent access is rejected;
  re-enable after the check if approved. Existing in-flight calls are not cancelled.
- Save branding or a harmless policy change, reload, and verify persistence after
  an approved restart. Test a normal user's workspace isolation with separate users.
- Back up installation configuration, workflow files, vault, and encryption keys
  consistently, with workers stopped or an approved snapshot procedure. Back up
  workspace data according to its backend. Include deployment settings and admin
  allowlists in the recovery plan, without exposing secrets in the handoff.
- Report deployed revision/artifact, URL, selected settings, persistence locations,
  admin access method, verification results, rollback approach, and any remaining
  risks or unverified requirements. Distinguish local tests from live verification.

Do not claim production readiness if authentication, persistence, required resource
permissions, or execution isolation remains unverified. State the exact missing
prerequisite and let the user choose an appropriate platform-specific resolution.