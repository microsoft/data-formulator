# Credential Vault

## What It Does

When a user logs into a plugin (e.g. Superset) and checks "Remember credentials", the password is **Fernet-encrypted** and stored in a server-side SQLite database. The next time the plugin is opened, the credentials are automatically retrieved and used to log in — no re-entry needed.

## Zero Configuration

No setup is required for local use. On first access the system automatically:

1. Generates a Fernet encryption key → writes to `DATA_FORMULATOR_HOME/.vault_key`
2. Creates the encrypted database → `DATA_FORMULATOR_HOME/credentials.db`

```
~/.data_formulator/
├── .vault_key         ← auto-generated encryption key
├── credentials.db     ← encrypted credential database
└── users/             ← user workspace data
```

Both files persist across restarts and upgrades.

## Security Model

| Aspect | Design |
|--------|--------|
| Encryption | Fernet (AES-128-CBC + HMAC-SHA256) |
| Key storage | File system (`DATA_FORMULATOR_HOME/.vault_key`), or `CREDENTIAL_VAULT_KEY` env var |
| Access isolation | Keyed by `(user_identity, source_key)` — users can only access their own credentials |
| Frontend isolation | Plaintext credentials never leave the server; the frontend only knows whether stored credentials exist |
| Transport | Production deployments should use HTTPS |

## How It Works

### First Login

```
User enters password → checks "Remember credentials" → backend login succeeds
                                                          ↓
                                                    encrypt & store in credentials.db
```

### Subsequent Visits

```
Frontend: GET /auth/status
             ↓
Backend: Session has token? → yes → use it
             ↓ no
         Vault has credentials? → yes → retrieve → attempt login to external system
             ↓                                       ↓
             ↓                                 success → auto-enter (seamless)
             ↓                                 failure → return vault_stale (password changed)
             ↓ no
         Show login form
```

### External System Password Changes

When a third-party system's password is changed, the stale vault credential is detected on the next auto-login attempt:

1. Backend retrieves credentials from Vault → attempts login → fails (401)
2. Returns `vault_stale: true` to the frontend
3. Frontend shows the login form with a warning: "Your saved credentials are no longer valid"
4. User enters new password:
   - Checks "Remember" → new credentials overwrite the old ones
   - Unchecks "Remember" → old credentials are deleted from the Vault

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/credentials/list` | List plugin IDs with stored credentials (no secrets exposed) |
| POST | `/api/credentials/store` | Store or update credentials |
| POST | `/api/credentials/delete` | Delete credentials |

`/list` returns only source_key names (e.g. `["superset"]`) — **never passwords or tokens**.

When the Vault is not available: `/list` returns an empty array; `/store` and `/delete` return 503.

## Plugin Integration

Plugins use `PluginAuthHandler` (see [Plugin Development Guide](../../../design-docs/5-plugin-development-guide.md) § 6–7), which has Vault lifecycle built in. Plugin authors do **not** need to write vault helpers manually.

```python
from data_formulator.plugins.auth_base import PluginAuthHandler

class MyAuthHandler(PluginAuthHandler):
    def do_login(self, username, password):
        ...  # authenticate with external system

# Vault store/delete/auto-login handled automatically by the base class:
# - login route: remember=true → vault_store, remember=false → vault_delete
# - logout route: always vault_delete (enforced)
# - status route: try_vault_login (auto-login with stored credentials)
```

Key principle: vault operations are best-effort — when the vault is unavailable, they silently skip without crashing.

## Docker Deployment

Mount the entire data directory; the key and database are included automatically:

```yaml
volumes:
  - df-data:/root/.data_formulator
```

No environment variables needed. The key file and database both live under `DATA_FORMULATOR_HOME`.

## Advanced: Manual Key Override

In rare cases (e.g. key must be injected by an external secrets manager), set the environment variable:

```bash
CREDENTIAL_VAULT_KEY=<your-fernet-key>
```

Generate a key:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

When set, the `.vault_key` file is ignored and the env var key is used directly.

## File Reference

```
credential_vault/
├── __init__.py      # get_credential_vault() factory — key auto-resolution + singleton
├── base.py          # CredentialVault abstract base class
├── local_vault.py   # LocalCredentialVault: SQLite + Fernet implementation
└── README.md        # this document
```
