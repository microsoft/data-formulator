# Set up a local Data Formulator development environment
How to set up your local machine.

## Prerequisites
* Python >= 3.11
* Node.js
* Yarn
* [uv](https://docs.astral.sh/uv/) (recommended) or pip

## Backend (Python)

### Option 1: With uv (recommended)

uv is faster and provides reproducible builds via lockfile.

```bash
uv sync                        # Creates .venv and installs all dependencies
uv run data_formulator         # Run app (opens browser automatically)
uv run data_formulator --dev   # Run backend only (for frontend development)
```

**Which command to use:**
- **End users / testing the full app**: `uv run data_formulator` - starts server and opens browser to http://localhost:5567
- **Frontend development**: `uv run data_formulator --dev` - starts backend server only, then run `yarn start` separately for the Vite dev server on http://localhost:5173

### Option 2: With pip (fallback)

- **Create a Virtual Environment**  
    ```bash
    python -m venv venv
    source venv/bin/activate  # Unix
    # or .\venv\Scripts\activate  # Windows
    ```

- **Install Dependencies**  
    ```bash
    pip install -r requirements.txt
    ```
- **Configure environment variables (optional)**
    - copy `.env.template` to `.env` and fill in your values:
        - **API keys**: set `{PROVIDER}_ENABLED=true`, `{PROVIDER}_API_KEY=...`, and `{PROVIDER}_MODELS=...` for each LLM provider you want to use. See the [LiteLLM setup](https://docs.litellm.ai/docs#litellm-python-sdk) guide for provider-specific fields.
        - **Server settings**: `DISABLE_DISPLAY_KEYS`, `SANDBOX`, etc.
        - **Azure Blob workspace** (optional): see [Azure Blob Storage Workspace](#azure-blob-storage-workspace) below.
    - this lets Data Formulator automatically load API keys at startup so you don't need to enter them in the UI.


- **Run the app**
    ```bash
    # Unix
    ./local_server.sh
    
    # Windows
    .\local_server.bat
    
    # Or directly
    data_formulator         # Opens browser automatically
    data_formulator --dev   # Backend only (for frontend development)
    ```

## Frontend (TypeScript)

- **Install NPM packages**  
    
    ```bash
    yarn
    ```

- **Development mode**

    First, start the backend server (in a separate terminal):
    ```bash
    uv run data_formulator --dev   # or ./local_server.sh
    ```

    Then, run the frontend in development mode with hot reloading:
    ```bash
    yarn start
    ```
    Open [http://localhost:5173](http://localhost:5173) to view it in the browser.
    The page will reload if you make edits. You will also see any lint errors in the console.

## Build for Production

- **Build the frontend and then the backend**

    Compile the TypeScript files and bundle the project:
    ```bash
    yarn build
    ```
    This builds the app for production to the `py-src/data_formulator/dist` folder.  

    Then, build python package:

    ```bash
    # With uv
    uv build
    
    # Or with pip
    pip install build
    python -m build
    ```
    This will create a python wheel in the `dist/` folder. The name would be `data_formulator-<version>-py3-none-any.whl`

- **Test the artifact**

    You can then install the build result wheel (testing in a virtual environment is recommended):
    ```bash
    # replace <version> with the actual build version. 
    pip install dist/data_formulator-<version>-py3-none-any.whl 
    ```

    Once installed, you can run Data Formulator with:
    ```bash
    data_formulator
    ```
    or 
    ```bash
    python -m data_formulator
    ```

    Open [http://localhost:5567](http://localhost:5567) to view it in the browser.


## Docker

Docker is the easiest way to run Data Formulator without installing Python or Node.js locally.

### Quick start

1. **Copy the environment template and add your API keys:**

    ```bash
    cp .env.template .env
    # Edit .env and set your OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.
    ```

2. **Build and start the container:**

    ```bash
    docker compose up --build
    ```

3. Open [http://localhost:5567](http://localhost:5567) in your browser.

To stop the container: `docker compose down`

Workspace data (uploaded files, sessions) is persisted in a Docker volume (`data_formulator_home`) so it survives container restarts.

### Build the image manually

```bash
docker build -t data-formulator .
docker run --rm -p 5567:5567 --env-file .env data-formulator
```

### Docker sandbox (`SANDBOX=docker`) is not supported inside a container

The Docker sandbox backend works by calling `docker run -v <host_path>:...` to bind-mount temporary workspace directories into child containers. When Data Formulator itself runs in a Docker container those paths refer to the *container* filesystem, not the host, so Docker daemon cannot mount them and the feature does not work.

Use `SANDBOX=docker` only when running Data Formulator **directly on the host** (e.g. with `uv run data_formulator --sandbox docker` or `python -m data_formulator --sandbox docker`). When using the Docker image, keep the default `SANDBOX=local`.


## Sandbox

AI-generated Python code runs inside a **sandbox** to isolate it from the main server process. Two backends are available:

| Backend | Flag | How it works | Overhead |
|---------|------|--------------|----------|
| **local** (default) | `--sandbox local` | Persistent warm subprocess with pre-imported pandas/numpy/duckdb. Audit hooks block file writes and dangerous operations (subprocess, shutil, etc.). | ~1 ms |
| **docker** | `--sandbox docker` | Each execution runs in a disposable `docker run --rm` container. Workspace is mounted read-only; output is returned via a bind-mounted parquet file. Memory/CPU/PID limits enforced. | ~700 ms |

```bash
# Use the default local sandbox
python -m data_formulator

# Use Docker sandbox (requires Docker daemon)
python -m data_formulator --sandbox docker
```

The Docker sandbox image is built from `py-src/data_formulator/sandbox/Dockerfile.sandbox`:

```bash
docker build -t data-formulator-sandbox -f py-src/data_formulator/sandbox/Dockerfile.sandbox .
```

Source: [`py-src/data_formulator/sandbox/`](py-src/data_formulator/sandbox/)


## Azure Blob Storage Workspace

By default, workspace data (uploaded files, parquet tables, metadata) is stored on the **local filesystem** under `~/.data_formulator/workspaces/`. For cloud deployments you can switch to **Azure Blob Storage** so all workspace data lives in a blob container instead.

### Quick start (local dev with connection string)

1. **Install extra dependencies:**

   ```bash
   pip install azure-storage-blob
   # or with uv:
   uv pip install azure-storage-blob
   ```

2. **Create a storage account & container** (one-time setup):

   ```bash
   az storage account create -n <account> -g <resource-group> -l eastus --sku Standard_LRS
   az storage container create -n data-formulator --account-name <account>
   ```

3. **Get the connection string:**

   ```bash
   az storage account show-connection-string -n <account> -g <resource-group> -o tsv
   ```

4. **Add to `.env`:**

   ```env
   WORKSPACE_BACKEND=azure_blob
   AZURE_BLOB_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
   # AZURE_BLOB_CONTAINER=data-formulator   # default, change if needed
   ```

5. **Run normally:**

   ```bash
   uv run data_formulator --dev
   ```

   Or pass as CLI flags:

   ```bash
   data_formulator --workspace-backend azure_blob \
     --azure-blob-connection-string "DefaultEndpointsProtocol=https;AccountName=..."
   ```

### Production setup with Entra ID (no secrets)

In production (Azure App Service, AKS, etc.) you can authenticate the app to blob storage via **Managed Identity** instead of a connection string. This eliminates secrets entirely.

1. **Install extra dependencies:**

   ```bash
   pip install azure-storage-blob azure-identity
   ```

2. **Assign a role to the app's Managed Identity:**

   ```bash
   # Get the App Service's principal ID
   PRINCIPAL_ID=$(az webapp identity show -n <app-name> -g <rg> --query principalId -o tsv)

   # Grant it "Storage Blob Data Contributor" on the storage account
   az role assignment create \
     --assignee "$PRINCIPAL_ID" \
     --role "Storage Blob Data Contributor" \
     --scope "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Storage/storageAccounts/<account>"
   ```

3. **Set environment variables** (no secrets needed):

   ```env
   WORKSPACE_BACKEND=azure_blob
   AZURE_BLOB_ACCOUNT_URL=https://<account>.blob.core.windows.net
   # AZURE_BLOB_CONTAINER=data-formulator
   ```

   The app uses [`DefaultAzureCredential`](https://learn.microsoft.com/python/api/azure-identity/azure.identity.defaultazurecredential), which automatically picks up the Managed Identity.

4. **For local development** with the same Entra ID path, log in with the Azure CLI:

   ```bash
   az login
   # Grant your user the same "Storage Blob Data Contributor" role
   az role assignment create \
     --assignee "<your-email@example.com>" \
     --role "Storage Blob Data Contributor" \
     --scope "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Storage/storageAccounts/<account>"
   ```

   Then set:

   ```env
   WORKSPACE_BACKEND=azure_blob
   AZURE_BLOB_ACCOUNT_URL=https://<account>.blob.core.windows.net
   ```

   `DefaultAzureCredential` will use your `az login` session.

### Authentication methods summary

| Method | Env var | When to use |
|--------|---------|-------------|
| **Connection string** | `AZURE_BLOB_CONNECTION_STRING` | Local dev, quick tests |
| **Entra ID (Managed Identity)** | `AZURE_BLOB_ACCOUNT_URL` | Azure App Service, AKS — no secrets |
| **Entra ID (az login)** | `AZURE_BLOB_ACCOUNT_URL` | Local dev without secrets |
| **Entra ID (service principal)** | `AZURE_BLOB_ACCOUNT_URL` + `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_CLIENT_SECRET` | CI/CD pipelines |

If both `AZURE_BLOB_CONNECTION_STRING` and `AZURE_BLOB_ACCOUNT_URL` are set, the connection string takes precedence.

### Blob layout

All workspace data is stored under `<datalake_root>/<sanitized_identity_id>/` inside the container:

```
data-formulator/                          ← container
  workspaces/                             ← datalake_root (default)
    browser_550e8400.../                  ← anonymous user workspace
      workspace.yaml
      sales_data.parquet
    user_alice_example_com/               ← authenticated user workspace
      workspace.yaml
      quarterly_report.parquet
```

### CLI flags reference

| Flag | Env var | Default | Description |
|------|---------|---------|-------------|
| `--workspace-backend` | `WORKSPACE_BACKEND` | `local` | `local`, `azure_blob`, or `ephemeral` |
| `--azure-blob-connection-string` | `AZURE_BLOB_CONNECTION_STRING` | — | Shared-key connection string |
| `--azure-blob-account-url` | `AZURE_BLOB_ACCOUNT_URL` | — | Account URL for Entra ID auth |
| `--azure-blob-container` | `AZURE_BLOB_CONTAINER` | `data-formulator` | Blob container name |


## Deployment Profiles

Data Formulator supports three deployment configurations. **All defaults are optimized for Profile 1 (single-user local)** — you only need to set flags when deploying as multi-user.

### Profile 1: Single-User Local (default)

A personal instance running on `localhost`. No login required, full feature access.

```bash
# Everything uses defaults — just run it:
data_formulator

# Or equivalently:
data_formulator \
  --workspace-backend local \
  --sandbox local
```

| Setting | Value | Why |
|---------|-------|-----|
| `AUTH_PROVIDER` | *(unset)* | Single user, no login needed |
| `WORKSPACE_BACKEND` | `local` | Persist workspaces to `~/.data_formulator/` |
| `DISABLE_DATA_CONNECTORS` | `false` | Full access to MySQL, PostgreSQL, etc. |
| `DISABLE_CUSTOM_MODELS` | `false` | User can add any LLM endpoint |
| `DISABLE_DISPLAY_KEYS` | `false` | User can see/manage their own API keys |
| Credential vault | auto-enabled | Remembers DB credentials across restarts |
| Identity | `local:<os_username>` | Fixed, OS-derived — survives localStorage clear |

**Security notes:** In single-user localhost mode, the server ignores the `X-Identity-Id` header entirely and uses a fixed identity derived from the OS username (e.g., `local:alice`). This means vault credentials and workspaces are tied to your OS account, not a random browser UUID — clearing localStorage won't orphan your data.

### Profile 2: Multi-User Anonymous (demo / public hosting)

A shared server (e.g., for demos, workshops, public access). No login, no server-side state, no sensitive features.

```bash
data_formulator \
  --workspace-backend ephemeral \
  --disable-data-connectors \
  --disable-custom-models \
  --disable-display-keys
```

> **Shortcut:** `--disable-database` (or `DISABLE_DATABASE=true`) bundles all of the above into a single flag.

Or via environment variables:

```env
WORKSPACE_BACKEND=ephemeral
DISABLE_DATA_CONNECTORS=true
DISABLE_CUSTOM_MODELS=true
DISABLE_DISPLAY_KEYS=true
# Pre-configure the LLM models users can access:
OPENAI_ENABLED=true
OPENAI_API_KEY=sk-...
OPENAI_MODELS=gpt-4.1
```

| Setting | Value | Why |
|---------|-------|-----|
| `AUTH_PROVIDER` | *(unset)* | Anonymous access for demos |
| `WORKSPACE_BACKEND` | `ephemeral` | No server-side persistence — data lives only in browser IndexedDB |
| `DISABLE_DATA_CONNECTORS` | `true` | **Critical** — prevents DB credential exposure via identity spoofing |
| `DISABLE_CUSTOM_MODELS` | `true` | Prevents users from adding arbitrary LLM endpoints (SSRF risk) |
| `DISABLE_DISPLAY_KEYS` | `true` | Hides server-configured API keys from UI |
| Credential vault | N/A | No connectors → no credentials to store |
| Identity | anonymous (`browser:<uuid>`) | Acceptable — no sensitive server-side state to protect |

**Security notes:** With data connectors disabled, the anonymous identity spoofing risk is eliminated — there are no DB credentials or persistent workspaces on the server to access. Each user's data lives entirely in their browser. The only server-side resource is the LLM proxy, which is locked down by `DF_ALLOWED_API_BASES`.

### Profile 3: Multi-User Authenticated (enterprise / team)

A shared server with SSO login. Full features, proper identity isolation.

```bash
data_formulator \
  --workspace-backend azure_blob \
  --disable-display-keys
```

```env
AUTH_PROVIDER=oidc
OIDC_ISSUER_URL=https://your-idp.example.com/realms/main
OIDC_CLIENT_ID=data-formulator
ALLOW_ANONYMOUS=false
WORKSPACE_BACKEND=azure_blob
AZURE_BLOB_ACCOUNT_URL=https://<account>.blob.core.windows.net
DISABLE_DISPLAY_KEYS=true
DISABLE_CUSTOM_MODELS=true
FLASK_SECRET_KEY=<generate-with-secrets-token-hex-32>
```

| Setting | Value | Why |
|---------|-------|-----|
| `AUTH_PROVIDER` | `oidc` / `github` / `azure_easyauth` | Verified identity from SSO |
| `ALLOW_ANONYMOUS` | `false` | Login required — no anonymous fallback |
| `WORKSPACE_BACKEND` | `azure_blob` or `local` | Persistent per-user workspaces |
| `DISABLE_DATA_CONNECTORS` | `false` | Safe — identity comes from auth provider, not spoofable |
| `DISABLE_CUSTOM_MODELS` | `true` | Users only use server-configured models |
| `DISABLE_DISPLAY_KEYS` | `true` | Hide server keys; users add their own |
| `FLASK_SECRET_KEY` | set explicitly | Required for stable sessions across server restarts |
| Credential vault | auto-enabled | DB credentials scoped to verified `user:<id>` |
| Identity | `user:<sub>` from auth provider | Server-verified, cannot be spoofed |

**Security notes:** With an auth provider, `get_identity_id()` returns `user:<verified_id>` from the IdP token — the `X-Identity-Id` header is ignored entirely. Workspaces, vault credentials, and DB connections are all scoped to the verified identity. Set `ALLOW_ANONYMOUS=false` to prevent unauthenticated access.

### Profile Comparison

| Feature | Profile 1 (Local) | Profile 2 (Demo) | Profile 3 (Enterprise) |
|---------|:-:|:-:|:-:|
| Login required | No | No | Yes |
| Data connectors (DB) | Yes | **No** | Yes |
| Custom LLM endpoints | Yes | **No** | Operator choice |
| Credential vault | Yes | N/A | Yes |
| Workspace persistence | Local disk | Browser only | Cloud / disk |
| Identity | `local:<os_user>` (fixed) | `browser:<uuid>` (client) | `user:<sub>` (SSO) |

### CLI Flags Reference (complete)

| Flag | Env var | Default | Description |
|------|---------|---------|-------------|
| `--workspace-backend` | `WORKSPACE_BACKEND` | `local` | `local`, `azure_blob`, or `ephemeral` |
| `--sandbox` | `SANDBOX` | `local` | Code execution backend: `local` or `docker` |
| `--disable-database` | `DISABLE_DATABASE` | `false` | **Multi-user anonymous preset**: bundles ephemeral + no connectors + no custom models + hide keys |
| `--disable-display-keys` | `DISABLE_DISPLAY_KEYS` | `false` | Hide API keys in frontend UI |
| `--disable-data-connectors` | `DISABLE_DATA_CONNECTORS` | `false` | Disable external DB connectors |
| `--disable-custom-models` | `DISABLE_CUSTOM_MODELS` | `false` | Prevent users from adding custom LLM endpoints |
| `--max-display-rows` | `MAX_DISPLAY_ROWS` | `10000` | Max rows sent to frontend |
| `--data-dir` | `DATA_FORMULATOR_HOME` | `~/.data_formulator` | Data directory |
| `--host` | `HOST` | `127.0.0.1` | Network interface to bind |
| `-p`, `--port` | — | `5567` | Port number |
| `--dev` | `DEV_MODE` | `false` | Development mode (no auto-open browser) |
| — | `AUTH_PROVIDER` | *(unset)* | `oidc`, `github`, `azure_easyauth`, or unset for anonymous |
| — | `ALLOW_ANONYMOUS` | `true` | Allow unauthenticated access when auth provider is set |
| — | `DF_ALLOWED_API_BASES` | *(unset, all allowed)* | Comma-separated URL globs for LLM endpoint allowlist |
| — | `FLASK_SECRET_KEY` | auto-generated | Session signing key (set explicitly for production) |
| `--azure-blob-connection-string` | `AZURE_BLOB_CONNECTION_STRING` | — | Azure Blob shared-key connection string |
| `--azure-blob-account-url` | `AZURE_BLOB_ACCOUNT_URL` | — | Azure Blob account URL for Entra ID auth |
| `--azure-blob-container` | `AZURE_BLOB_CONTAINER` | `data-formulator` | Azure Blob container name |


## Security Considerations for Production Deployment

⚠️ **IMPORTANT SECURITY WARNING FOR PRODUCTION DEPLOYMENT**

### Identity System

Data Formulator uses a **namespaced identity** system with three tiers:
- **Local mode** (`127.0.0.1`, no auth provider): Identity is `local:<os_username>`, determined by the server. The `X-Identity-Id` header is ignored. Vault and workspaces are tied to the OS user.
- **Anonymous mode** (multi-user, no auth provider): Identity is `browser:<uuid>` where the UUID is generated in the browser's `localStorage`. The server trusts the client-provided `X-Identity-Id` header, but always forces the `browser:` prefix.
- **Authenticated mode** (auth provider configured): Identity is `user:<verified_id>` from the auth provider. The `X-Identity-Id` header is ignored entirely.

**Key security principle**: An attacker sending `X-Identity-Id: user:alice@...` gets `browser:alice@...` — completely separate from the real `user:alice@...` that only authenticated Alice can access.

**Anonymous spoofing risk**: In anonymous mode, if an attacker knows another user's browser UUID, they can impersonate them via the `X-Identity-Id` header. This is why **Profile 2 disables data connectors** (no DB credentials to steal) and **Profile 3 requires authentication** (header is ignored).

### Data Storage

| Backend | Flag | Storage | Persistence |
|---------|------|---------|-------------|
| **local** (default) | `--workspace-backend local` | `~/.data_formulator/users/<identity>/workspaces/` | Server filesystem |
| **azure_blob** | `--workspace-backend azure_blob` | Azure Blob container | Cloud |
| **ephemeral** | `--workspace-backend ephemeral` | Browser IndexedDB (frontend) + temp dirs (backend) | Browser session only |

### Recommended Security Measures

1. **Multi-user anonymous (demos)**: Use Profile 2 — `--workspace-backend ephemeral --disable-data-connectors --disable-custom-models --disable-display-keys` (or `--disable-database` as shortcut)
2. **Multi-user authenticated**: Use Profile 3 — set `AUTH_PROVIDER`, `ALLOW_ANONYMOUS=false`, and `DISABLE_CUSTOM_MODELS=true`
3. **HTTPS**: Use a reverse proxy (nginx, Azure App Gateway) with TLS termination
4. **`FLASK_SECRET_KEY`**: Set explicitly for production (auto-generated key changes on restart)

### Server Migration Checklist

When migrating Data Formulator to a new server (or rebuilding a Docker container), the following secrets and data files **must** be carried over. Losing any of them will break the corresponding functionality.

| Item | Location | What breaks if lost |
|------|----------|---------------------|
| `FLASK_SECRET_KEY` | `.env` (env var) | All user sessions invalidated (SSO login, plugin tokens). Agent code signatures fail verification — saved charts cannot refresh until re-executed. |
| `.vault_key` | `DATA_FORMULATOR_HOME/.vault_key` | `credentials.db` becomes undecryptable — all stored database passwords / service credentials are lost. |
| `credentials.db` | `DATA_FORMULATOR_HOME/credentials.db` | Same as above — the encrypted credential store itself. |
| `DF_CODE_SIGNING_SECRET` | `.env` (env var, optional) | If set, overrides Flask-derived signing key. Must match the old value or all code signatures break. |
| `CREDENTIAL_VAULT_KEY` | `.env` (env var, optional) | If set, overrides `.vault_key` file. Must match or vault data is unreadable. |
| `users/` & `workspaces/` | `DATA_FORMULATOR_HOME/` | User workspace data (parquet files, session metadata). |

**Minimum migration steps:**

```bash
# On the OLD server — back up secrets + data
cp .env                             /backup/.env
cp $DATA_FORMULATOR_HOME/.vault_key /backup/.vault_key
cp $DATA_FORMULATOR_HOME/credentials.db /backup/credentials.db
# Copy workspace data if using local backend
cp -r $DATA_FORMULATOR_HOME/users   /backup/users
cp -r $DATA_FORMULATOR_HOME/workspaces /backup/workspaces

# On the NEW server — restore before first start
cp /backup/.env .env
cp /backup/.vault_key $DATA_FORMULATOR_HOME/.vault_key
cp /backup/credentials.db $DATA_FORMULATOR_HOME/credentials.db
cp -r /backup/users $DATA_FORMULATOR_HOME/users
cp -r /backup/workspaces $DATA_FORMULATOR_HOME/workspaces
```

> **Tip:** If you forgot to back up `FLASK_SECRET_KEY` and it was auto-generated, there is no way to recover it. Users will need to log in again, and any chart with a cached code signature will need to be re-executed by the Agent.

> **中文版:** 详细的迁移操作指南见 [docs-cn/7-server-migration-guide.md](docs-cn/7-server-migration-guide.md)。

## Authentication Architecture

Data Formulator supports a **hybrid identity system** with anonymous and authenticated modes.
See **Deployment Profiles** above for which mode to use in each scenario.

### Identity Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend Request                             │
├─────────────────────────────────────────────────────────────────────┤
│  Headers:                                                            │
│    X-Identity-Id: "local:alice" / "browser:550e8400-..." / ...      │
│    Authorization: Bearer <jwt>  (if auth provider configured)        │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Backend Identity Resolution                       │
│                       (auth.py: get_identity_id)                    │
├─────────────────────────────────────────────────────────────────────┤
│  Priority 1: Auth provider (OIDC/GitHub/EasyAuth) → "user:<id>"     │
│  Priority 2: Localhost mode (127.0.0.1)           → "local:<user>"  │
│              (ignores X-Identity-Id header)                          │
│  Priority 3: X-Identity-Id header                 → "browser:<id>"  │
│              (client-provided namespace prefix is IGNORED)           │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Storage Isolation                               │
├─────────────────────────────────────────────────────────────────────┤
│  "user:alice@example.com"  → alice's workspace (ONLY via auth)       │
│  "local:alice"             → localhost user's workspace (fixed)      │
│  "browser:550e8400-..."    → anonymous user's workspace              │
└─────────────────────────────────────────────────────────────────────┘
```

### Auth Provider Setup

See the `AUTH_PROVIDER` section in `.env.template` for configuration details.

| Provider | `AUTH_PROVIDER` | Setup |
|----------|----------------|-------|
| OIDC / OAuth2 | `oidc` | Set `OIDC_ISSUER_URL` + `OIDC_CLIENT_ID` |
| GitHub | `github` | Set `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` |
| Azure EasyAuth | `azure_easyauth` | Enable in Azure App Service (no extra env vars) |
| Anonymous only | *(unset)* | Default — no login, `browser:<uuid>` identity |

## Usage
See the [Usage section on the README.md page](README.md#usage).
