import os
import json
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from azure.core.credentials import AccessToken
from azure.core.exceptions import ClientAuthenticationError
from azure.identity import CredentialUnavailableError

from data_formulator.auth import azure_cli
from data_formulator.auth.azure_cli import expose_azure_cli


pytestmark = [pytest.mark.backend]


@pytest.fixture(autouse=True)
def clear_provider_cache():
    azure_cli._desktop_token_provider.cache_clear()
    yield
    azure_cli._desktop_token_provider.cache_clear()


def test_expose_azure_cli_adds_executable_directory_to_path(monkeypatch, tmp_path):
    executable = tmp_path / "az"
    executable.touch()
    monkeypatch.setattr(
        "data_formulator.auth.azure_cli.shutil.which",
        lambda _: str(executable),
    )
    monkeypatch.setenv("PATH", "/usr/bin")

    assert expose_azure_cli() == str(executable)
    assert os.environ["PATH"].split(os.pathsep)[0] == str(tmp_path)


@pytest.mark.parametrize("platform", ["win32", "darwin", "linux"])
def test_token_fetch_hides_only_windows_console(monkeypatch, platform):
    monkeypatch.setattr(azure_cli.sys, "platform", platform)
    monkeypatch.setattr(azure_cli, "find_azure_cli", lambda: "/trusted/path/az.cmd")
    monkeypatch.setattr(subprocess, "CREATE_NO_WINDOW", 0x08000000, raising=False)
    run = Mock(return_value=SimpleNamespace(stdout=json.dumps({
        "accessToken": "test-token", "expires_on": 2000000000,
    })))
    monkeypatch.setattr(subprocess, "run", run)

    token = azure_cli.DesktopAzureCliCredential("test-config").get_token(azure_cli._COGNITIVE_SERVICES_SCOPE)

    assert token == AccessToken("test-token", 2000000000)
    args, options = run.call_args
    assert args[0][1:3] == ["account", "get-access-token"]
    assert options["stdin"] == subprocess.DEVNULL
    assert options["timeout"] == 30
    assert options["env"]["AZURE_CONFIG_DIR"] == "test-config"
    if platform == "win32":
        assert options["creationflags"] == 0x08000000
    else:
        assert "creationflags" not in options


def test_shared_provider_caches_and_refreshes_tokens(monkeypatch):
    clock = [time.time()]
    monkeypatch.setattr(time, "time", lambda: clock[0])
    fetch = Mock(side_effect=[
        AccessToken("first", int(clock[0]) + 3600),
        AccessToken("refreshed", int(clock[0]) + 7200),
    ])
    monkeypatch.setattr(azure_cli.DesktopAzureCliCredential, "get_token", fetch)

    provider = azure_cli.get_desktop_azure_token_provider()
    assert provider is azure_cli.get_desktop_azure_token_provider()
    with ThreadPoolExecutor(max_workers=8) as executor:
        assert list(executor.map(lambda _: provider(), range(16))) == ["first"] * 16
    assert fetch.call_count == 1
    clock[0] += 3500
    assert provider() == "refreshed"
    assert fetch.call_count == 2


def test_provider_is_separate_for_cli_config_directories(monkeypatch):
    monkeypatch.setenv("AZURE_CONFIG_DIR", "first")
    first = azure_cli.get_desktop_azure_token_provider()
    monkeypatch.setenv("AZURE_CONFIG_DIR", "second")
    assert azure_cli.get_desktop_azure_token_provider() is not first


@pytest.mark.parametrize("failure", [
    subprocess.CalledProcessError(1, "az", stderr="secret-token"),
    subprocess.TimeoutExpired("az", 30, output="secret-token"),
    OSError("secret-token"),
])
def test_cli_errors_do_not_expose_output(monkeypatch, failure):
    monkeypatch.setattr(azure_cli, "find_azure_cli", lambda: "/trusted/path/az")
    monkeypatch.setattr(subprocess, "run", Mock(side_effect=failure))
    with pytest.raises((ClientAuthenticationError, CredentialUnavailableError)) as caught:
        azure_cli.DesktopAzureCliCredential(None).get_token(azure_cli._COGNITIVE_SERVICES_SCOPE)
    assert "secret-token" not in str(caught.value)
    assert caught.value.__suppress_context__


@pytest.mark.parametrize("output", ["not-json", "{}", "null", '{"accessToken":"secret-token"}'])
def test_invalid_response_does_not_expose_tokens(monkeypatch, output):
    monkeypatch.setattr(azure_cli, "find_azure_cli", lambda: "/trusted/path/az")
    monkeypatch.setattr(subprocess, "run", Mock(return_value=SimpleNamespace(stdout=output)))
    with pytest.raises(CredentialUnavailableError, match="invalid token response"):
        azure_cli.DesktopAzureCliCredential(None).get_token(azure_cli._COGNITIVE_SERVICES_SCOPE)


def test_legacy_cli_expiry_is_supported(monkeypatch):
    from datetime import datetime

    monkeypatch.setattr(azure_cli, "find_azure_cli", lambda: "/trusted/path/az")
    expiry = "2030-01-02 03:04:05.000000"
    monkeypatch.setattr(subprocess, "run", Mock(return_value=SimpleNamespace(stdout=json.dumps({
        "accessToken": "test-token", "expiresOn": expiry,
    }))))
    token = azure_cli.DesktopAzureCliCredential(None).get_token(azure_cli._COGNITIVE_SERVICES_SCOPE)
    assert token.expires_on == int(datetime.fromisoformat(expiry).timestamp())


def test_missing_cli_has_actionable_error(monkeypatch):
    monkeypatch.setattr(azure_cli, "find_azure_cli", lambda: None)
    with pytest.raises(CredentialUnavailableError, match="Install it and run 'az login'"):
        azure_cli.DesktopAzureCliCredential(None).get_token(azure_cli._COGNITIVE_SERVICES_SCOPE)