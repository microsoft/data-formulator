"""Sign-ins (design-docs/72): specs (built-in and agent-proposed, validated), the vault store (user or session
scope, a key checked before it is kept), api_fetch (the secret only on the spec's hosts, attached its way, scrubbed
from what the agent reads), the /api/accounts routes, and the sign-in card the agent proposes.

Offline: services are a mock transport; DNS, the provider's account lookup and the local login are stubs.
"""

from __future__ import annotations

import base64
import dataclasses
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import flask
import httpx
import pytest

from data_formulator.accounts import fetch, local_logins, specs, store
from data_formulator.accounts.fetch import FetchError, api_fetch
from data_formulator.accounts.specs import SpecError, validate_spec

pytestmark = [pytest.mark.backend]

HEADERS = {"Origin": "http://localhost", "X-DF-Configuration": "1"}
IDENTITY = "local:me"
PUBLIC = lambda host: True  # noqa: E731 - every host resolves publicly here
KAGGLE = {"id": "kaggle", "name": "Kaggle", "send_to": ["www.kaggle.com"],
          "auth": {"type": "basic", "username_label": "Kaggle username", "secret_label": "API key"},
          "get_token": "https://www.kaggle.com/settings", "instructions": "Settings, API, Create New Token.",
          "check": "https://www.kaggle.com/api/v1/competitions/list"}
GITHUB = {"id": "github", "name": "GitHub", "send_to": ["api.github.com"], "auth": {"type": "bearer"},
          "get_token": "https://github.com/settings/tokens"}


@pytest.fixture(autouse=True)
def accounts_home(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("CREDENTIAL_VAULT", "local")
    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: True)
    monkeypatch.setattr("data_formulator.configuration.user_connectors_disabled", lambda: False)
    import data_formulator.auth.vault as vault
    monkeypatch.setattr(vault, "_vault", None)
    monkeypatch.setattr(vault, "_initialized", False)
    monkeypatch.setattr(store, "_logins", {})
    monkeypatch.setattr(fetch, "resolves_publicly", PUBLIC)


@pytest.fixture
def hf(monkeypatch):
    """Hugging Face with a stub account lookup (``good-*`` tokens belong to @ada) and no local login unless set."""
    local: dict[str, str | None] = {"token": None}
    spec = dataclasses.replace(specs.HUGGINGFACE, whoami=lambda token: "ada" if token.startswith("good") else None,
                               local_token=lambda: local["token"])
    monkeypatch.setitem(specs.BUILTIN, "huggingface", spec)
    return local


def service(seen: list[httpx.Request], handler=None) -> httpx.MockTransport:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if handler:
            return handler(request)
        if request.url.path == "/api/datasets/acme/sales/parquet/default/train/0.parquet":
            return httpx.Response(302, headers={"location": "https://cdn.example/sales.parquet"})
        if request.url.host == "cdn.example":
            return httpx.Response(200, content=b"PAR1data", headers={"content-type": "application/octet-stream"})
        if request.url.path == "/rows":
            return httpx.Response(200, json={"rows": [{"row": {"x": 1}}]})
        if request.url.path == "/echo":
            return httpx.Response(200, json={"you_sent": request.headers.get("authorization", "")})
        return httpx.Response(200, json={"ok": True})
    return httpx.MockTransport(handle)


# -- specs --

def test_a_proposed_spec_is_kept_to_one_site_and_public_hosts():
    spec = validate_spec(KAGGLE)
    assert spec.send_to == ("www.kaggle.com",) and spec.link_domains == ("kaggle.com",) and not spec.verified
    assert spec.auth.type == "basic" and spec.stored()["auth"]["username_label"] == "Kaggle username"
    bad = [
        {"send_to": ["api.evil.com"]},                       # the key would go to another site than its page
        {"get_token": "https://evil.com/kaggle"},            # the key's page on another site
        {"check": "https://other.kaggle.com/x"},             # a check off the send_to hosts
        {"send_to": ["10.0.0.5"]}, {"send_to": ["localhost"]}, {"send_to": ["db.internal"]},
        {"send_to": ["*.kaggle.com"]}, {"send_to": ["www.kaggle.com:8443"]},
        {"get_token": "http://www.kaggle.com/settings"},
        {"auth": {"type": "header", "name": "Cookie"}}, {"auth": {"type": "header"}},
        {"auth": {"type": "query", "name": "a b"}}, {"auth": {"type": "oauth"}},
        {"id": "huggingface"}, {"name": "Hugging Face"},     # a built-in's name or id
        {"id": "Bad Id"}, {"send_to": [f"h{i}.kaggle.com" for i in range(6)]},
    ]
    for change in bad:
        with pytest.raises(SpecError):
            validate_spec({**KAGGLE, **change})


@pytest.mark.parametrize("host, site", [("api.example.com", "example.com"), ("www.kaggle.com", "kaggle.com"),
                                        ("data.gov.uk", "data.gov.uk"), ("api.data.co.uk", "data.co.uk")])
def test_sites_are_registrable_domains(host, site):
    assert specs.site_of(host) == site


@pytest.mark.parametrize("auth, check", [
    ({"type": "bearer"}, lambda request: request.headers["authorization"] == "Bearer sekrit-123"),
    ({"type": "header", "name": "X-Api-Key"}, lambda request: request.headers["x-api-key"] == "sekrit-123"),
    ({"type": "query", "name": "api_key"}, lambda request: request.url.params["api_key"] == "sekrit-123"
                                                            and request.url.params["q"] == "1"),
])
def test_each_auth_type_attaches_the_secret_its_way(tmp_path, auth, check):
    spec = validate_spec({**KAGGLE, "auth": auth})
    seen: list[httpx.Request] = []
    result = api_fetch("https://www.kaggle.com/api/v1/x?q=1", spec=spec, secret={"token": "sekrit-123"},
                       scratch_root=tmp_path, transport=service(seen))
    assert check(seen[0]) and result["status"] == 200
    assert "sekrit-123" not in json.dumps(result)


def test_basic_auth_sends_username_and_key_and_scrubs_an_echo(tmp_path):
    spec = validate_spec(KAGGLE)
    seen: list[httpx.Request] = []
    result = api_fetch("https://www.kaggle.com/echo", spec=spec, secret={"username": "ada", "key": "k-123456789"},
                       scratch_root=tmp_path, transport=service(seen))
    sent = "Basic " + base64.b64encode(b"ada:k-123456789").decode()
    assert seen[0].headers["authorization"] == sent
    saved = (tmp_path / result["saved"].removeprefix("scratch/")).read_text()
    assert sent.split()[1] not in saved and sent.split()[1] not in json.dumps(result)
    # The file keeps its length (a binary format keeps its offsets); the agent's preview says what was removed.
    assert "*" * len(sent.split()[1]) in saved and result["bytes"] == len(saved.encode())


# -- api_fetch --

def test_fetch_sends_the_token_only_to_the_specs_hosts_and_saves_the_body(tmp_path):
    seen: list[httpx.Request] = []
    result = api_fetch("https://huggingface.co/api/datasets/acme/sales/parquet/default/train/0.parquet",
                       spec=specs.HUGGINGFACE, secret={"token": "good-secret"}, login="ada", save_as="../sales.parquet",
                       scratch_root=tmp_path, transport=service(seen))
    assert [request.url.host for request in seen] == ["huggingface.co", "cdn.example"]
    assert seen[0].headers["authorization"] == "Bearer good-secret" and "authorization" not in seen[1].headers
    assert result["status"] == 200 and result["signed_in_as"] == "ada" and result["served_from"] == "cdn.example"
    assert result["saved"] == "scratch/api/huggingface/sales.parquet"
    assert (tmp_path / "api" / "huggingface" / "sales.parquet").read_bytes() == b"PAR1data"


@pytest.mark.parametrize("url", ["https://evil.example/x", "http://huggingface.co/api/datasets",
                                 "https://user@huggingface.co/api", "https://cdn-lfs.huggingface.co/x"])
def test_fetch_starts_only_on_the_specs_hosts(tmp_path, url):
    seen: list[httpx.Request] = []
    with pytest.raises(FetchError):
        api_fetch(url, spec=specs.HUGGINGFACE, secret={"token": "good"}, scratch_root=tmp_path, transport=service(seen))
    assert seen == []


def test_fetch_reaches_no_private_address(tmp_path):
    spec = validate_spec(KAGGLE)
    seen: list[httpx.Request] = []
    with pytest.raises(FetchError, match="public address"):
        api_fetch("https://www.kaggle.com/x", spec=spec, secret={"username": "a", "key": "k"}, scratch_root=tmp_path,
                  transport=service(seen), resolve=lambda host: False)
    # Nor through a redirect off the spec's hosts.
    redirect = lambda request: httpx.Response(302, headers={"location": "https://intranet.corp/x"})  # noqa: E731
    with pytest.raises(FetchError, match="public address"):
        api_fetch("https://www.kaggle.com/x", spec=spec, scratch_root=tmp_path, transport=service(seen, redirect),
                  resolve=lambda host: host != "intranet.corp")
    assert [request.url.host for request in seen] == ["www.kaggle.com"]


def test_fetch_does_not_follow_a_redirect_to_plain_http(tmp_path):
    seen: list[httpx.Request] = []
    with pytest.raises(FetchError, match="non-https"):
        api_fetch("https://huggingface.co/a", spec=specs.HUGGINGFACE, secret={"token": "good"}, scratch_root=tmp_path,
                  transport=service(seen, lambda request: httpx.Response(302, headers={"location": "http://cdn.example/x"})))
    assert len(seen) == 1


@pytest.mark.parametrize("spec, signed_in, status, body, reason", [
    (specs.HUGGINGFACE, False, 401, "not accessible without authentication (private or gated)", "gated"),
    (specs.HUGGINGFACE, True, 403, "Access to dataset is restricted.", "terms"),
    (specs.HUGGINGFACE, False, 429, "", "rate_limit"),
    (validate_spec(KAGGLE), False, 401, '{"code":401,"message":"Unauthenticated"}', "unauthorized"),
    (validate_spec(KAGGLE), True, 403, "forbidden", "rejected"),
])
def test_a_refusal_signing_in_would_fix_offers_a_sign_in(tmp_path, spec, signed_in, status, body, reason):
    host = spec.send_to[-1]
    result = api_fetch(f"https://{host}/first-rows?dataset=meta/evals", spec=spec, scratch_root=tmp_path,
                       secret={"token": "good-t", "username": "a", "key": "k-1234567"} if signed_in else None,
                       transport=service([], lambda request: httpx.Response(status, text=body)))
    assert result["needs_signin"]["reason"] == reason and "saved" not in result
    assert "propose_signin" in result["note"]
    if spec is specs.HUGGINGFACE and reason != "rate_limit":
        assert result["needs_signin"]["page"] == "https://huggingface.co/datasets/meta/evals"


@pytest.mark.parametrize("declared", [True, False])
def test_fetch_stops_at_the_size_limit_and_keeps_nothing(tmp_path, monkeypatch, declared):
    monkeypatch.setattr(fetch, "MAX_BYTES", 4)
    body = b"0123456789"
    big = (lambda request: httpx.Response(200, content=body)) if declared \
        else (lambda request: httpx.Response(200, stream=httpx.ByteStream(body)))
    result = api_fetch("https://huggingface.co/big.bin", spec=specs.HUGGINGFACE, scratch_root=tmp_path,
                       transport=service([], big))
    assert "limit" in result["error"] and "saved" not in result
    folder = tmp_path / "api" / "huggingface"
    assert not folder.exists() or not any(folder.iterdir())


# -- the store --

def test_store_keeps_secrets_out_of_its_state(hf):
    assert store.state(IDENTITY, "huggingface")["signed_in"] is False
    assert store.sign_in_with_token(IDENTITY, "huggingface", "good-1-long-token") == "ada"
    state = store.state(IDENTITY, "huggingface")
    assert state["signed_in"] and state["login"] == "ada" and state["source"] == "token" and state["verified"]
    assert state["secret_hint"] == "…oken" and "good-1-long-token" not in json.dumps(state)
    assert store.credential(IDENTITY, "huggingface", None)[1] == {"token": "good-1-long-token"}
    store.sign_out(IDENTITY, "huggingface")
    assert store.credential(IDENTITY, "huggingface", None) is None


def test_a_custom_key_is_checked_then_kept_with_its_spec(monkeypatch):
    calls: list[httpx.Request] = []
    ok = service(calls, lambda request: httpx.Response(200, json=[]))
    spec = store.save_custom(IDENTITY, KAGGLE, {"username": " ada ", "key": "k-123456789"}, transport=ok)
    assert calls[0].url == KAGGLE["check"] and calls[0].headers["authorization"].startswith("Basic ")
    state = store.state(IDENTITY, "kaggle")
    assert state["signed_in"] and state["login"] == "ada" and state["send_to"] == ["www.kaggle.com"] and not state["verified"]
    assert store.spec_for_host(IDENTITY, "www.kaggle.com") == spec
    assert [item["id"] for item in store.all_states(IDENTITY)] == ["huggingface", "kaggle"]
    refused = service([], lambda request: httpx.Response(401))
    with pytest.raises(store.AccountError, match="refused that key"):
        store.save_custom(IDENTITY, {**KAGGLE, "id": "kaggle-2", "name": "Kaggle 2"}, {"username": "a", "key": "bad-key"},
                          transport=refused)
    assert store.spec_of(IDENTITY, "kaggle-2") is None
    store.sign_out(IDENTITY, "kaggle")
    assert store.spec_of(IDENTITY, "kaggle") is None and [item["id"] for item in store.all_states(IDENTITY)] == ["huggingface"]


def test_a_session_sign_in_is_used_only_in_its_session():
    no_check = {key: value for key, value in KAGGLE.items() if key != "check"}
    store.save_custom(IDENTITY, no_check, {"username": "ada", "key": "k-123456789"}, scope="session", workspace="ws-1")
    assert store.credential(IDENTITY, "kaggle", "ws-1") is not None
    assert store.credential(IDENTITY, "kaggle", "ws-2") is None
    assert [item["id"] for item in store.all_states(IDENTITY, "ws-2")] == ["huggingface"]
    assert store.state(IDENTITY, "kaggle", "ws-1")["scope"] == "session"


def test_a_failed_account_lookup_is_asked_again(monkeypatch):
    answers = iter([None, "ada"])  # the provider is unreachable, then answers
    monkeypatch.setitem(specs.BUILTIN, "huggingface", dataclasses.replace(
        specs.HUGGINGFACE, whoami=lambda token: next(answers), local_token=lambda: None))
    with pytest.raises(store.AccountError):
        store.sign_in_with_token(IDENTITY, "huggingface", "good-5")
    assert store.sign_in_with_token(IDENTITY, "huggingface", "good-5") == "ada"


def test_a_reused_local_login_is_followed_and_logging_out_there_signs_out_here(hf):
    assert "reuse" not in store.state(IDENTITY, "huggingface")["methods"]
    hf["token"] = "good-local"
    state = store.state(IDENTITY, "huggingface")
    assert state["reusable_login"] == "ada" and state["methods"][0] == "reuse"
    assert store.reuse_local(IDENTITY, "huggingface") == "ada"
    hf["token"] = "good-relogged"  # `hf auth login` again
    assert store.credential(IDENTITY, "huggingface", None)[1]["token"] == "good-relogged"
    hf["token"] = None  # `hf auth logout`
    assert store.credential(IDENTITY, "huggingface", None) is None
    assert store.state(IDENTITY, "huggingface")["signed_in"] is False


def test_a_first_prototype_sign_in_still_reads(hf):
    from data_formulator.auth.vault import get_credential_vault

    get_credential_vault().store(IDENTITY, "account:huggingface", {"token": "good-old", "login": "ada", "source": "token"})
    assert store.credential(IDENTITY, "huggingface", None)[1] == {"token": "good-old"}


# -- reusing a login this computer has, read the way a spec says --

def fake_cli(folder: Path, script: str) -> None:
    """A ``gh`` on PATH that runs ``script``."""
    fake = folder / "gh"
    fake.write_text("#!/bin/sh\n" + script + "\n")
    fake.chmod(0o755)


@pytest.fixture
def cli_path(tmp_path, monkeypatch):
    folder = tmp_path / "bin"
    folder.mkdir()
    monkeypatch.setenv("PATH", str(folder))
    monkeypatch.setattr(local_logins, "_EXTRA_PATHS", ())
    return folder


GH_LOCAL = {**GITHUB, "local": {"command": ["gh", "auth", "token"]}}
posix = pytest.mark.skipif(not Path("/bin/sh").exists(), reason="needs a POSIX shell")


@pytest.mark.parametrize("local, problem", [
    ({"command": ["gh"], "env": "GH_TOKEN"}, "one of"),
    ({"command": "gh auth token"}, "list of 1 to 12 arguments"),
    ({"env": "GH TOKEN"}, "environment variable"),
    ({"file": "~/.config/x.json", "fields": {"password": "pw"}}, "local.fields maps token"),
])
def test_a_specs_local_login_is_one_clear_read(local, problem):
    with pytest.raises(SpecError, match=problem):
        validate_spec({**GITHUB, "local": local})


def test_a_basic_sign_in_reads_its_username_and_key_from_json():
    with pytest.raises(SpecError, match="give local.fields with both"):
        validate_spec({**KAGGLE, "local": {"file": "~/.kaggle/kaggle.json"}})
    spec = validate_spec({**KAGGLE, "local": {"file": "~/.kaggle/kaggle.json", "fields": {"username": "username", "key": "key"}}})
    assert spec.methods == ("reuse", "token") and spec.stored()["local"]["fields"] == {"username": "username", "key": "key"}


def test_a_local_login_is_offered_as_written_and_read_only_once_chosen(hf, monkeypatch):
    from data_formulator.analyst.skills.accounts.skill import signin_form

    monkeypatch.setattr(local_logins, "_run", lambda command: pytest.fail("read before the user chose it"))
    _, body = signin_form({"spec": GH_LOCAL, "reason": "other", "explanation": "You asked to sign in."}, IDENTITY)
    assert body["spec"]["local"] == {"command": ["gh", "auth", "token"]} and body["spec"]["methods"] == ["reuse", "token"]


@posix
def test_a_local_login_read_with_a_command_is_followed_each_time_it_is_used(cli_path):
    fake_cli(cli_path, '[ "$1 $2" = "auth token" ] && echo gho_first123')
    assert store.reuse_local(IDENTITY, validate_spec(GH_LOCAL)) is None
    assert store.credential(IDENTITY, "github", None)[1] == {"token": "gho_first123"}
    fake_cli(cli_path, "echo gho_second456")  # `gh auth login` again
    assert store.credential(IDENTITY, "github", None)[1] == {"token": "gho_second456"}
    # Showing sign-ins never runs it: a slow or failing command cannot hold up the list.
    fake_cli(cli_path, "exit 1")
    assert store.state(IDENTITY, "github")["signed_in"] is True
    # A read that fails (`gh auth logout`, or a timeout) leaves the key unused, and the sign-in kept.
    assert store.credential(IDENTITY, "github", None) is None
    fake_cli(cli_path, "echo gho_third789")
    assert store.credential(IDENTITY, "github", None)[1] == {"token": "gho_third789"}


@posix
def test_what_a_local_login_reads_must_look_like_a_key(cli_path):
    fake_cli(cli_path, "printf 'line one\\nline two\\n'")
    with pytest.raises(store.AccountError, match="No key found at gh auth token"):
        store.reuse_local(IDENTITY, validate_spec(GH_LOCAL))
    assert store.credential(IDENTITY, "github", None) is None


def test_a_local_login_read_from_a_json_file_is_checked_at_the_specs_check_url(tmp_path):
    (tmp_path / "kaggle.json").write_text(json.dumps({"username": "ada", "key": "k-local-123456"}))
    spec = validate_spec({**KAGGLE, "local": {"file": str(tmp_path / "kaggle.json"),
                                              "fields": {"username": "username", "key": "key"}}})
    with pytest.raises(store.AccountError):
        store.reuse_local(IDENTITY, spec, transport=service([], lambda request: httpx.Response(401)))
    assert store.credential(IDENTITY, "kaggle", None) is None
    seen: list[httpx.Request] = []
    assert store.reuse_local(IDENTITY, spec, transport=service(seen)) == "ada"
    assert seen[0].headers["authorization"] == "Basic " + base64.b64encode(b"ada:k-local-123456").decode()


def test_a_local_login_read_from_the_environment(monkeypatch):
    monkeypatch.setenv("DF_TEST_TOKEN", "tok-env-123456")
    store.reuse_local(IDENTITY, validate_spec({**GITHUB, "local": {"env": "DF_TEST_TOKEN"}}))
    assert store.credential(IDENTITY, "github", None)[1] == {"token": "tok-env-123456"}


# -- routes --

@pytest.fixture
def client():
    from data_formulator.accounts.routes import accounts_bp
    from data_formulator.error_handler import register_error_handlers

    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(accounts_bp)
    register_error_handlers(app)
    with patch("data_formulator.auth.identity.get_identity_id", return_value=IDENTITY):
        yield app.test_client()


def test_routes_sign_in_to_a_built_in_with_a_token_and_out(client, hf):
    listing = client.get("/api/accounts").get_json()["data"]
    assert listing["available"] and listing["accounts"][0]["id"] == "huggingface"
    signed = client.post("/api/accounts/huggingface/token", headers=HEADERS, json={"token": "good-2"}).get_json()["data"]
    assert signed["signed_in"] and signed["login"] == "ada" and "good-2" not in json.dumps(signed)
    out = client.post("/api/accounts/huggingface/signout", headers=HEADERS, json={}).get_json()["data"]
    assert out["signed_in"] is False


def test_routes_keep_a_custom_key_for_the_session(client, monkeypatch):
    real = fetch.probe
    monkeypatch.setattr(fetch, "probe", lambda *args, **kwargs: real(*args, **{**kwargs, "transport": service([])}))
    response = client.post("/api/accounts/custom", headers={**HEADERS, "X-Workspace-Id": "ws-1"},
                           json={"spec": KAGGLE, "secret": {"username": "ada", "key": "k-123456789"}, "scope": "session"})
    saved = response.get_json()["data"]
    assert saved["signed_in"] and saved["scope"] == "session" and "k-123456789" not in json.dumps(saved)
    assert client.get("/api/accounts", headers={"X-Workspace-Id": "ws-2"}).get_json()["data"]["accounts"][-1]["id"] \
        == "huggingface"
    removed = client.post("/api/accounts/kaggle/signout", headers={**HEADERS, "X-Workspace-Id": "ws-1"},
                          json={}).get_json()["data"]
    assert removed == {"id": "kaggle", "removed": True}


def test_routes_reuse_a_local_login_for_a_spec_only_from_the_app(client, monkeypatch):
    monkeypatch.setenv("DF_TEST_TOKEN", "tok-env-123456")
    spec = {**GITHUB, "local": {"env": "DF_TEST_TOKEN"}}
    assert client.post("/api/accounts/custom/reuse", headers={"Origin": "http://localhost"},
                       json={"spec": spec}).status_code == 403
    saved = client.post("/api/accounts/custom/reuse", headers=HEADERS, json={"spec": spec}).get_json()["data"]
    assert saved["signed_in"] and saved["source"] == "local" and "tok-env-123456" not in json.dumps(saved)


def test_routes_keep_a_sign_in_for_the_open_session_unless_asked_for_all(client, hf):
    in_ws1 = {**HEADERS, "X-Workspace-Id": "ws-1"}
    signed = client.post("/api/accounts/huggingface/token", headers=in_ws1, json={"token": "good-1"}).get_json()["data"]
    assert signed["scope"] == "session"
    assert store.credential(IDENTITY, "huggingface", "ws-1") is not None
    assert store.credential(IDENTITY, "huggingface", "ws-2") is None
    everywhere = client.post("/api/accounts/huggingface/token", headers=in_ws1,
                             json={"token": "good-2", "scope": "user"}).get_json()["data"]
    assert store.credential(IDENTITY, "huggingface", "ws-2")[1] == {"token": "good-2"} and everywhere["signed_in"]


def test_a_session_sign_in_follows_this_computers_login_too(hf):
    hf["token"] = "good-local"
    store.reuse_local(IDENTITY, "huggingface", scope="session", workspace="ws-1")
    hf["token"] = "good-relogged"
    assert store.credential(IDENTITY, "huggingface", "ws-1")[1] == {"token": "good-relogged"}
    assert store.state(IDENTITY, "huggingface", "ws-1")["scope"] == "session"
    hf["token"] = None
    assert store.credential(IDENTITY, "huggingface", "ws-1") is None


def test_the_sign_in_activity_says_what_was_signed_in_to_and_used_without_a_secret(client, monkeypatch, tmp_path):
    from data_formulator.analyst.skills.accounts.skill import _fetch

    monkeypatch.setenv("DF_TEST_TOKEN", "tok-env-123456")
    spec = {**GITHUB, "local": {"env": "DF_TEST_TOKEN"}}
    in_ws1 = {**HEADERS, "X-Workspace-Id": "ws-1"}
    client.post("/api/accounts/custom/reuse", headers=in_ws1, json={"spec": spec})
    real = fetch.api_fetch
    monkeypatch.setattr(fetch, "api_fetch", lambda *args, **kwargs: real(*args, **{**kwargs, "transport": service([])}))
    ctx = SimpleNamespace(workspace=SimpleNamespace(confined_scratch=SimpleNamespace(root=tmp_path)))
    with flask.Flask(__name__).test_request_context(headers={"X-Workspace-Id": "ws-1"}), \
            patch("data_formulator.auth.identity.get_identity_id", return_value=IDENTITY):
        _fetch({"url": "https://api.github.com/user/repos?per_page=100&access_token=x"}, ctx)
    client.post("/api/accounts/github/signout", headers=in_ws1, json={})
    events = client.get("/api/accounts/activity").get_json()["data"]["events"]
    assert [event["event"] for event in events] == ["signed_out", "used", "signed_in"]
    signed_out, used, signed_in = events
    assert signed_in == {**signed_in, "service": "github", "send_to": ["api.github.com"], "how": "local",
                         "read": "$DF_TEST_TOKEN", "scope": "session", "session": "ws-1"}
    assert used["url"] == "api.github.com/user/repos" and used["status"] == 200
    assert signed_out["reason"] == "signed out in the app"
    assert "tok-env-123456" not in json.dumps(events)


@pytest.mark.parametrize("spec_id", ["activity", "custom"])
def test_a_spec_cannot_take_a_route_name(spec_id):
    with pytest.raises(SpecError):
        validate_spec({**GITHUB, "id": spec_id})


def test_routes_refuse_a_spec_that_sends_keys_elsewhere(client):
    response = client.post("/api/accounts/custom", headers=HEADERS, json={
        "spec": {**KAGGLE, "send_to": ["api.evil.com"]}, "secret": {"username": "a", "key": "k"}}).get_json()
    assert response["error"]["code"] == "INVALID_REQUEST" and "evil.com" in response["error"]["message"]


@pytest.mark.parametrize("headers", [{"X-DF-Configuration": "1"}, {"Origin": "http://evil.example", "X-DF-Configuration": "1"},
                                     {"Origin": "http://localhost"}])
def test_route_changes_need_the_local_app(client, hf, headers):
    assert client.post("/api/accounts/huggingface/token", headers=headers, json={"token": "good-3"}).status_code == 403
    assert client.post("/api/accounts/custom", headers=headers, json={"spec": KAGGLE, "secret": {}}).status_code == 403
    assert store.credential(IDENTITY, "huggingface", None) is None


def test_routes_are_off_outside_local_mode(client, monkeypatch):
    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: False)
    assert client.get("/api/accounts").get_json()["data"] == {"available": False, "accounts": []}
    assert client.post("/api/accounts/huggingface/token", headers=HEADERS, json={"token": "x"}).status_code == 403


# -- the agent's skill --

def test_the_card_carries_a_checked_spec_and_the_agents_words(hf):
    from data_formulator.analyst.skills.accounts.skill import signin_form

    title, body = signin_form({"spec": KAGGLE, "reason": "unauthorized", "explanation": "  Competition data needs   a key. ",
                               "unlocks": "Download train.csv",
                               "steps": [{"text": "Accept the rules", "url": "https://www.kaggle.com/c/titanic/rules"}]},
                              IDENTITY)
    assert title == "Sign in to Kaggle" and body["provider"] == "kaggle" and body["verified"] is False
    assert body["spec"]["send_to"] == ["www.kaggle.com"] and body["explanation"] == "Competition data needs a key."
    _, builtin_body = signin_form({"provider": "huggingface", "reason": "gated", "explanation": "Gated.", "prefer": "reuse"},
                                  IDENTITY)
    assert builtin_body["verified"] and "prefer" not in builtin_body  # no local login here to reuse
    for bad in ({"steps": [{"text": "x", "url": "https://evil.example/login"}]}, {"steps": [{"text": "x"}] * 4},
                {"reason": "because"}, {"explanation": ""}, {"spec": {**KAGGLE, "send_to": ["api.evil.com"]}},
                {"provider": "huggingface"}, {"spec": None}):
        with pytest.raises(ValueError):
            signin_form({"spec": KAGGLE, "reason": "unauthorized", "explanation": "Needs a key.", **bad}, IDENTITY)


def test_propose_signin_pauses_on_a_signin_form(hf):
    from data_formulator.analyst.skills.accounts.skill import get_skill

    ctx = SimpleNamespace(payload={"action_narration": "This dataset needs your sign-in."})
    with patch("data_formulator.auth.identity.get_identity_id", return_value=IDENTITY):
        events = list(get_skill().handle_action("propose_signin", {
            "provider": "huggingface", "reason": "gated", "explanation": "Gated."}, ctx))
    assert len(events) == 1 and events[0]["type"] == "interact"
    form = events[0]["form"]
    assert form["kind"] == "signin" and form["title"] == "Sign in to Hugging Face"
    assert form["signin"]["provider"] == "huggingface" and form["response"] == "This dataset needs your sign-in."
    assert form["auto_submit"] is False


def test_api_fetch_tool_finds_the_sign_in_by_host_and_acts_as_the_user(tmp_path):
    from data_formulator.analyst.skills.accounts.skill import get_skill

    no_check = {key: value for key, value in KAGGLE.items() if key != "check"}
    store.save_custom(IDENTITY, no_check, {"username": "ada", "key": "k-123456789"})
    seen: list[httpx.Request] = []
    real = fetch.api_fetch
    ctx = SimpleNamespace(workspace=SimpleNamespace(confined_scratch=SimpleNamespace(root=tmp_path)))
    with patch("data_formulator.auth.identity.get_identity_id", return_value=IDENTITY), \
            patch.object(fetch, "api_fetch", lambda *args, **kwargs: real(*args, **kwargs, transport=service(seen))):
        text = get_skill().handle_tool("api_fetch", {"url": "https://www.kaggle.com/api/v1/datasets/list"}, ctx).text
        unknown = json.loads(get_skill().handle_tool("api_fetch", {"url": "https://example.org/data"}, ctx).text)
    result = json.loads(text)
    assert result["service"] == "kaggle" and result["signed_in_as"] == "ada"
    assert seen[0].headers["authorization"].startswith("Basic ") and "k-123456789" not in text
    assert (tmp_path / result["saved"].removeprefix("scratch/")).exists()
    assert "No sign-in" in unknown["error"] and len(seen) == 1


def test_the_skill_index_lists_accounts_and_drops_it_without_sign_ins():
    from data_formulator.analyst.skills import build_registry

    registry = build_registry()
    assert registry.expanded_names(["huggingface"]) == ["huggingface", "accounts"]
    assert {"accounts", "huggingface"} <= set(registry.gated_skill_names())  # listed, though huggingface includes it
    assert registry.action_owner("propose_signin") == "accounts"
    dropped = registry.with_accounts_policy(False)
    assert "huggingface" not in dropped.metas and "accounts" not in dropped.metas
    tools = json.loads(Path(registry._doc_paths["accounts"]).with_name("tools.json").read_text())
    propose = next(spec for spec in tools if spec["function"]["name"] == "propose_signin")
    assert propose["function"]["parameters"]["properties"]["provider"]["enum"] == list(specs.BUILTIN)



# -- what review found --

def test_a_cut_never_leaves_part_of_a_key(tmp_path):
    """Error bodies that echo the URL (with a query key) are scrubbed before they are cut, wherever the cut falls."""
    spec = validate_spec({**KAGGLE, "auth": {"type": "query", "name": "key"}})
    key = "SUPERSECRETKEY1234567890"
    echo = lambda request: httpx.Response(404, text=f"Not found: {request.url}")  # noqa: E731
    for padding in range(540, 600, 3):
        result = api_fetch(f"https://www.kaggle.com/{'a' * padding}", spec=spec, secret={"token": key},
                           scratch_root=tmp_path, transport=service([], echo))
        assert not any(key[:size] in json.dumps(result) for size in range(4, len(key) + 1)), padding


def test_encoded_echoes_of_a_key_are_scrubbed(tmp_path):
    spec = validate_spec({**KAGGLE, "auth": {"type": "query", "name": "api_key"}})
    key = "abc+def/ghi=jkl12345"
    echo = lambda request: httpx.Response(200, json={"next": str(request.url), "escaped": key.replace("/", "\\/")})  # noqa: E731
    result = api_fetch("https://www.kaggle.com/list", spec=spec, secret={"token": key}, scratch_root=tmp_path,
                       transport=service([], echo))
    saved = (tmp_path / result["saved"].removeprefix("scratch/")).read_text()
    for form in (key, "abc%2Bdef%2Fghi%3Djkl12345", "abc%2Bdef%2Fghi%3Djkl12345".replace("%2B", "+")):
        assert form not in saved and form not in json.dumps(result)


def test_a_binary_body_is_masked_in_place_across_chunks(tmp_path):
    key = "k-123456789"
    body = [b"PAR1" + b"x" * 5 + key[:4].encode(), key[4:].encode() + b"\x00" * 8 + key.encode() + b"PAR1"]
    streamed = lambda request: httpx.Response(200, headers={"content-type": "application/octet-stream"},  # noqa: E731
                                              stream=httpx.ByteStream(b"".join(body)))
    spec = validate_spec(KAGGLE)
    result = api_fetch("https://www.kaggle.com/f.parquet", spec=spec, secret={"username": "a", "key": key},
                       scratch_root=tmp_path, transport=service([], streamed))
    saved = (tmp_path / result["saved"].removeprefix("scratch/")).read_bytes()
    assert key.encode() not in saved and len(saved) == len(b"".join(body)) and saved.startswith(b"PAR1")


@pytest.mark.parametrize("change", [
    # Anyone can name a host deep under a big site; the key page is the real one.
    {"name": "Azure Maps", "id": "azure-maps", "send_to": ["maps-api.eastus.cloudapp.azure.com"],
     "auth": {"type": "header", "name": "Subscription-Key"}, "get_token": "https://portal.azure.com/keys",
     "check": "https://maps-api.eastus.cloudapp.azure.com/check"},
    # A host where anyone publishes under a path.
    {"name": "Sheets", "id": "sheets", "send_to": ["script.google.com"], "auth": {"type": "query", "name": "key"},
     "get_token": "https://console.cloud.google.com/apis/credentials", "check": None},
    # A user's own site on a shared suffix is not the platform's site.
    {"name": "Pages", "id": "pages", "send_to": ["evil.github.io"], "auth": {"type": "bearer"},
     "get_token": "https://github.com/settings/tokens", "check": None},
])
def test_a_trusted_key_page_cannot_be_paired_with_a_host_anyone_controls(change):
    with pytest.raises(SpecError):
        validate_spec({**KAGGLE, **change})


def test_a_session_key_never_replaces_the_one_for_every_session():
    no_check = {key: value for key, value in KAGGLE.items() if key != "check"}
    store.save_custom(IDENTITY, no_check, {"username": "ada", "key": "user-key-12345"})
    store.save_custom(IDENTITY, no_check, {"username": "bob", "key": "session-key-1234"}, scope="session", workspace="ws-1")
    assert store.credential(IDENTITY, "kaggle", "ws-1")[1]["key"] == "session-key-1234"
    assert store.credential(IDENTITY, "kaggle", "ws-2")[1]["key"] == "user-key-12345"
    store.sign_out(IDENTITY, "kaggle", "ws-1")  # this session's own key goes; the one for every session stays
    assert store.credential(IDENTITY, "kaggle", "ws-1")[1]["key"] == "user-key-12345"
    assert [item["id"] for item in store.all_states(IDENTITY, "ws-1")] == ["huggingface", "kaggle"]
