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


## Security Considerations for Production Deployment

⚠️ **IMPORTANT SECURITY WARNING FOR PRODUCTION DEPLOYMENT**

When deploying Data Formulator to production, please be aware of the following security considerations:

### Data Storage

Data Formulator supports three workspace backends:

| Backend | Flag | Storage | Persistence |
|---------|------|---------|-------------|
| **local** (default) | `--workspace-backend local` | `~/.data_formulator/users/<identity>/workspaces/<id>/` | Server filesystem |
| **azure_blob** | `--workspace-backend azure_blob` | Azure Blob container | Cloud |
| **ephemeral** | `--workspace-backend ephemeral` | Browser IndexedDB (frontend) + temp dirs (backend) | Browser session only |

Each workspace contains:
- `workspace.yaml` — table metadata
- `session_state.json` — auto-persisted frontend state
- `data/` — table data as parquet files

### Identity and Data Isolation

- Each user's data is isolated by a namespaced identity key (e.g., `user:alice@example.com` or `browser:550e8400-...`)
- Anonymous users get a browser-based UUID stored in localStorage
- Authenticated users get their verified user ID from the auth provider
- In multi-tenant deployments, ensure workspace directories are isolated and access-controlled

### Recommended Security Measures

For production deployment, consider:

1. **Use `--workspace-backend ephemeral`** for stateless public hosting (no server-side persistence; data lives only in the user's browser)
2. **Set `DF_ALLOWED_API_BASES`** to restrict which LLM endpoints users can target from the UI, preventing SSRF attacks (e.g. `DF_ALLOWED_API_BASES=https://api.openai.com*,https://*.openai.azure.com/*`). See `.env.template` for details.
3. **Implement proper authentication, authorization, and other security measures** as needed for your specific use case, for example:
   - User authentication (OAuth, JWT tokens, etc.)
   - Role-based access control
   - API rate limiting
   - HTTPS/TLS encryption
   - Input validation and sanitization 

### Configuration for Production

```bash
# For stateless deployment (recommended for public hosting)
data_formulator --workspace-backend ephemeral
```

## Authentication Architecture

Data Formulator supports a **hybrid identity system** that supports both anonymous and authenticated users.

### Identity Flow Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend Request                             │
├─────────────────────────────────────────────────────────────────────┤
│  Headers:                                                            │
│    X-Identity-Id: "browser:550e8400-..." (namespace sent by client) │
│    Authorization: Bearer <jwt>  (if custom auth implemented)         │
│    (Azure also adds X-MS-CLIENT-PRINCIPAL-ID automatically)          │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Backend Identity Resolution                       │
│                       (auth.py: get_identity_id)                    │
├─────────────────────────────────────────────────────────────────────┤
│  Priority 1: Azure X-MS-CLIENT-PRINCIPAL-ID → "user:<azure_id>"     │
│  Priority 2: JWT Bearer token (if implemented) → "user:<jwt_sub>"    │
│  Priority 3: X-Identity-Id header → ALWAYS "browser:<id>"           │
│              (client-provided namespace is IGNORED for security)     │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Storage Isolation                               │
├─────────────────────────────────────────────────────────────────────┤
│  "user:alice@example.com"  → alice's workspace dir (ONLY via auth)   │
│  "browser:550e8400-..."    → anonymous user's workspace dir          │
└─────────────────────────────────────────────────────────────────────┘
```

### Security Model

**Critical Security Rule:** The backend NEVER trusts the namespace prefix from the client-provided `X-Identity-Id` header. Even if a client sends `X-Identity-Id: "user:alice@..."`, the backend strips the prefix and forces `browser:alice@...`. Only verified authentication (Azure headers or JWT) can result in a `user:` prefixed identity.

The key security principle is **namespaced isolation with forced prefixing**:

| Scenario | X-Identity-Id Sent | Backend Resolution | Storage Key |
|----------|-------------------|-------------------|-------------|
| Anonymous user | `browser:550e8400-...` | Strips prefix, forces `browser:` | `browser:550e8400-...` |
| Azure logged-in user | `browser:550e8400-...` | Uses Azure header (priority 1) | `user:alice@...` |
| Attacker spoofing | `user:alice@...` (forged) | No valid auth, strips & forces `browser:` | `browser:alice@...` |

**Why this is secure:** An attacker sending `X-Identity-Id: user:alice@...` gets `browser:alice@...` as their storage key, which is completely separate from the real `user:alice@...` that only authenticated Alice can access.

### Implementing Custom Authentication

To add JWT-based authentication:

1. **Backend** (`security/auth.py`): Uncomment and configure the JWT verification code in `get_identity_id()`
2. **Frontend** (`utils.tsx`): Implement `getAuthToken()` to retrieve the JWT from your auth context
3. **Add JWT secret** to Flask config: `current_app.config['JWT_SECRET']`

### Azure App Service Authentication

When deployed to Azure with EasyAuth enabled:
- Azure automatically adds `X-MS-CLIENT-PRINCIPAL-ID` header to authenticated requests
- The backend reads this header first (highest priority)
- No frontend changes needed - Azure handles the auth flow

### Frontend Identity Management

The frontend (`src/app/identity.ts`) manages identity as follows:

```typescript
// Identity is always initialized with browser ID
identity: { type: 'browser', id: getBrowserId() }

// If user logs in (e.g., via Azure), it's updated to:
identity: { type: 'user', id: userInfo.userId }

// All API requests send namespaced identity:
// X-Identity-Id: "browser:550e8400-..." or "user:alice@..."
```

This ensures:
1. **Anonymous users**: Work immediately with localStorage-based browser ID
2. **Logged-in users**: Get their verified user ID from the auth provider
3. **Cross-tab consistency**: Browser ID is shared via localStorage across all tabs

## Usage
See the [Usage section on the README.md page](README.md#usage).
