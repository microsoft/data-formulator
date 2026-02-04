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
- **End users / testing the full app**: `uv run data_formulator` - starts server and opens browser to http://localhost:5000
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
- **Configure environment variable (optional)s**
    - copy `api-keys.env.example` to `api-keys.env` and add your API keys.
        - required fields for different providers are different, please refer to the [LiteLLM setup](https://docs.litellm.ai/docs#litellm-python-sdk) guide for more details.
            - currently only endpoint, model, api_key, api_base, api_version are supported.
        - this helps data formulator to automatically load the API keys when you run the app, so you don't need to set the API keys in the app UI.

    - set `.env` to configure server properties:
        - copy `.env.template` to `.env`
        - configure settings as needed:
            - DISABLE_DISPLAY_KEYS: if true, API keys will not be shown in the frontend
            - EXEC_PYTHON_IN_SUBPROCESS: if true, Python code runs in a subprocess (safer but slower), you may consider setting it true when you are hosting Data Formulator for others
            - External database settings (when USE_EXTERNAL_DB=true):
                - DB_NAME: name to refer to this database connection
                - DB_TYPE: mysql or postgresql (currently only these two are supported)
                - DB_HOST: database host address
                - DB_PORT: database port
                - DB_DATABASE: database name
                - DB_USER: database username
                - DB_PASSWORD: database password


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

    Open [http://localhost:5000](http://localhost:5000) to view it in the browser.


## Security Considerations for Production Deployment

⚠️ **IMPORTANT SECURITY WARNING FOR PRODUCTION DEPLOYMENT**

When deploying Data Formulator to production, please be aware of the following security considerations:

### Database and Data Storage Security

1. **Workspace and table data**: Table data is stored in per-identity workspaces (e.g. parquet files). DuckDB is used only in-memory per request when needed (e.g. for SQL mode); no persistent DuckDB database files are created by the app.

2. **Identity Management**: 
   - Each user's data is isolated by a namespaced identity key (e.g., `user:alice@example.com` or `browser:550e8400-...`)
   - Anonymous users get a browser-based UUID stored in localStorage
   - Authenticated users get their verified user ID from the auth provider

3. **Data persistence**: User data may be written to workspace storage (e.g. parquet) on the server. In multi-tenant deployments, ensure workspace directories are isolated and access-controlled.

### Recommended Security Measures

For production deployment, consider:

1. **Use `--disable-database` flag** to disable table-connector routes when you do not need external or uploaded table support
2. **Implement proper authentication, authorization, and other security measures** as needed for your specific use case, for example:
   - User authentication (OAuth, JWT tokens, etc.)
   - Role-based access control
   - API rate limiting
   - HTTPS/TLS encryption
   - Input validation and sanitization 

### Configuration for Production

```bash
# For stateless deployment (recommended for public hosting)
python -m data_formulator.app --disable-database
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
│  "user:alice@example.com"  → alice's DuckDB file (ONLY via auth)     │
│  "browser:550e8400-..."    → anonymous user's DuckDB file            │
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

1. **Backend** (`tables_routes.py`): Uncomment and configure the JWT verification code in `get_identity_id()`
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
