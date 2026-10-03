import os
import json
import shutil
import subprocess
import sys
import threading
from datetime import datetime
from functools import lru_cache
from pathlib import Path


_COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default"
_provider_lock = threading.Lock()


class DesktopAzureCliCredential:
    def __init__(self, config_dir: str | None):
        self.config_dir = config_dir

    def get_token(self, *scopes, **kwargs):
        from azure.core.credentials import AccessToken
        from azure.core.exceptions import ClientAuthenticationError
        from azure.identity import CredentialUnavailableError

        if scopes != (_COGNITIVE_SERVICES_SCOPE,):
            raise ValueError("Unsupported desktop Azure CLI token scope")
        executable = find_azure_cli()
        if not executable:
            raise CredentialUnavailableError("Azure CLI was not found. Install it and run 'az login'.")

        environment = dict(os.environ, AZURE_CORE_NO_COLOR="true")
        if self.config_dir is not None:
            environment["AZURE_CONFIG_DIR"] = self.config_dir
        else:
            environment.pop("AZURE_CONFIG_DIR", None)
        options = {}
        if sys.platform == "win32":
            options["creationflags"] = subprocess.CREATE_NO_WINDOW
        try:
            result = subprocess.run(
                [executable, "account", "get-access-token", "--resource",
                 "https://cognitiveservices.azure.com", "--output", "json"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=True,
                timeout=30,
                cwd=os.environ.get("SYSTEMROOT", "C:\\Windows") if sys.platform == "win32" else "/",
                env=environment,
                **options,
            )
        except subprocess.CalledProcessError:
            raise ClientAuthenticationError(
                "Azure CLI could not acquire an Azure OpenAI token. "
                "Run 'az login' in a terminal with the intended account and tenant, then retry."
            ) from None
        except (OSError, subprocess.TimeoutExpired):
            raise CredentialUnavailableError(
                "Azure CLI could not be run or timed out. Check that 'az account show' works in a terminal."
            ) from None

        try:
            payload = json.loads(result.stdout)
            expires_on = (
                int(payload["expires_on"])
                if "expires_on" in payload
                else int(datetime.fromisoformat(payload["expiresOn"]).timestamp())
            )
            token = payload["accessToken"]
            if not isinstance(token, str) or not token:
                raise ValueError("Missing access token")
            return AccessToken(token, expires_on)
        except (KeyError, ValueError, TypeError, OverflowError):
            raise CredentialUnavailableError("Azure CLI returned an invalid token response.") from None


@lru_cache(maxsize=8)
def _desktop_token_provider(config_dir: str | None):
    from azure.identity import get_bearer_token_provider

    provider = get_bearer_token_provider(DesktopAzureCliCredential(config_dir), _COGNITIVE_SERVICES_SCOPE)
    token_lock = threading.Lock()

    def get_token():
        with token_lock:
            return provider()

    return get_token


def get_desktop_azure_token_provider():
    with _provider_lock:
        return _desktop_token_provider(os.environ.get("AZURE_CONFIG_DIR"))


def find_azure_cli() -> str | None:
    executable = shutil.which("az")
    if executable:
        return executable

    if sys.platform == "darwin":
        candidates = (
            "/opt/homebrew/bin/az",
            "/usr/local/bin/az",
        )
    elif sys.platform == "win32":
        candidates = tuple(
            str(Path(root) / "Microsoft SDKs" / "Azure" / "CLI2" / "wbin" / "az.cmd")
            for root in filter(None, (
                os.environ.get("ProgramFiles"),
                os.environ.get("ProgramFiles(x86)"),
            ))
        )
    else:
        candidates = ("/usr/bin/az", "/usr/local/bin/az")

    return next((path for path in candidates if Path(path).is_file()), None)


def expose_azure_cli() -> str | None:
    executable = find_azure_cli()
    if not executable:
        return None

    executable_dir = str(Path(executable).parent)
    path_entries = os.environ.get("PATH", "").split(os.pathsep)
    if executable_dir not in path_entries:
        os.environ["PATH"] = os.pathsep.join((executable_dir, *path_entries))
    return executable