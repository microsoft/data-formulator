# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Sign-in specs: what a sign-in is, where its secret may go, and how it is sent (design-docs/72).

A spec names the hosts its secret is sent to (``send_to``: exact hosts, https only), how the secret is attached
(``auth``: a bearer token, a named header, a query parameter, or HTTP basic with a username), where the user gets the
secret (``get_token``), what to do there (``instructions``), and an optional ``check`` URL that proves it works.

Built-in specs (Hugging Face) are written here, are marked verified, and may sign in other ways than pasting (a code
on the provider's site, reusing a login this computer has). The agent may propose any other service as a spec; it is
validated (``validate_spec``) and shown to the user, who confirms it by saving a key: the spec is saved with the key
and does not change afterwards. A proposed spec must keep everything on one site: every ``send_to`` host,
``get_token`` and ``check`` share one registrable domain, so a spec cannot send the user to a trusted site for a key
and the key somewhere else.
"""

from __future__ import annotations

import base64
import ipaddress
import re
import socket
from dataclasses import dataclass, field
from typing import Any, Callable
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from data_formulator.accounts.local_logins import LocalLogin, LocalLoginError, parse_local

AUTH_TYPES = ("bearer", "header", "query", "basic")
REASONS = ("gated", "private", "rate_limit", "terms", "rejected", "unauthorized", "other")
METHODS = ("reuse", "device", "token")
MAX_HOSTS = 5
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")
_LABEL = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")
_HEADER = re.compile(r"^[A-Za-z0-9-]{1,64}$")
_PARAM = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
_FORBIDDEN_HEADERS = {"host", "cookie", "content-length", "content-type", "transfer-encoding", "connection", "upgrade",
                      "te", "trailer", "keep-alive", "expect", "origin", "referer", "user-agent"}
_RESERVED_SUFFIXES = (".local", ".localhost", ".internal", ".lan", ".home", ".arpa", ".test", ".invalid", ".example")
# Second-level labels under which country domains register names (example.co.uk), for when the Public Suffix List
# cannot be read.
_SECOND_LEVEL = {"co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "gob", "nic", "mil", "ltd", "plc"}
# A key may go at most this many labels below its site (api.example.com, api.eu.example.com): deeper names are where
# big platforms let anyone make a host (name.region.cloudapp.azure.com).
MAX_DEPTH = 2
# Hosts on trusted sites where anyone can publish under a path, so a key sent there could reach anyone.
_SHARED_HOSTS = {"script.google.com", "script.googleusercontent.com", "sites.google.com", "docs.google.com",
                 "drive.google.com", "forms.gle", "gist.github.com", "gist.githubusercontent.com",
                 "raw.githubusercontent.com", "objects.githubusercontent.com", "dl.dropboxusercontent.com",
                 "onedrive.live.com", "1drv.ms", "pastebin.com", "webhook.site", "s3.amazonaws.com", "glitch.me",
                 "repl.co", "replit.app", "workers.dev", "pages.dev", "ngrok.io", "ngrok-free.app", "trycloudflare.com"}


class SpecError(ValueError):
    pass


def _psl():
    """The Public Suffix List, private section included, from the copy bundled with tldextract (never fetched)."""
    global _extract
    if _extract is None:
        import tldextract

        _extract = tldextract.TLDExtract(suffix_list_urls=(), include_psl_private_domains=True, cache_dir=None)
    return _extract


_extract = None


def site_of(host: str) -> str:
    """The registrable domain a host belongs to under the Public Suffix List (private suffixes too: a site on
    github.io is name.github.io), or a conservative guess when the list cannot be read."""
    host = host.lower().rstrip(".")
    try:
        found = _psl()(host)
        site = getattr(found, "top_domain_under_public_suffix", None) or found.registered_domain
        if site:
            return site
    except Exception:  # noqa: BLE001 - fall back to the guess below
        pass
    labels = host.split(".")
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in _SECOND_LEVEL:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def host_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def https_url(url: str) -> bool:
    """https, no credentials in the URL, the default port."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    return parts.scheme == "https" and bool(parts.hostname) and not parts.username and not parts.password and port in (None, 443)


def on_domains(url: str, domains: tuple[str, ...] | list[str]) -> bool:
    """Whether ``url`` is https on one of ``domains`` or a subdomain of one."""
    host = host_of(url)
    return https_url(url) and any(host == domain or host.endswith("." + domain) for domain in domains)


def _public_host(host: str) -> str:
    """A host name a proposed spec may send a secret to: a public DNS name, not an address or a local name."""
    host = str(host or "").strip().lower().rstrip(".")
    try:
        ipaddress.ip_address(host.strip("[]"))
        is_address = True
    except ValueError:
        is_address = False
    if is_address:
        raise SpecError(f"{host!r} is an address; name the service's host instead.")
    labels = host.split(".")
    if len(labels) < 2 or not all(_LABEL.match(label) for label in labels) or labels[-1].isdigit():
        raise SpecError(f"{host!r} is not a host name like api.example.com (no wildcards, ports or paths).")
    if host == "localhost" or any(host.endswith(suffix) for suffix in _RESERVED_SUFFIXES):
        raise SpecError(f"{host!r} is a local or reserved name.")
    return host


def resolves_publicly(host: str) -> bool:
    """Whether every address ``host`` resolves to is public (not loopback, private, link-local or reserved)."""
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except OSError:
        return False
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global or address.is_multicast:
            return False
    return bool(infos)


@dataclass(frozen=True)
class Auth:
    type: str
    # The header (``header``) or query parameter (``query``) that carries the secret.
    name: str | None = None
    username_label: str | None = None
    secret_label: str | None = None

    def apply(self, url: str, headers: dict[str, str], secret: dict[str, str]) -> str:
        """Attach the secret to a request: returns the URL (a query secret goes there) and fills ``headers``."""
        token = secret.get("token", "")
        if self.type == "bearer":
            headers["Authorization"] = f"Bearer {token}"
        elif self.type == "header":
            headers[str(self.name)] = token
        elif self.type == "basic":
            pair = f"{secret.get('username', '')}:{secret.get('key', token)}".encode()
            headers["Authorization"] = "Basic " + base64.b64encode(pair).decode()
        elif self.type == "query":
            parts = urlsplit(url)
            query = [(key, value) for key, values in parse_qs(parts.query, keep_blank_values=True).items()
                     for value in values if key != self.name]
            url = urlunsplit(parts._replace(query=urlencode([*query, (str(self.name), token)])))
        return url

    def public(self) -> dict[str, Any]:
        return {"type": self.type, **({"name": self.name} if self.name else {}),
                **({"username_label": self.username_label} if self.username_label else {}),
                **({"secret_label": self.secret_label} if self.secret_label else {})}


@dataclass(frozen=True)
class SignInSpec:
    id: str
    name: str
    send_to: tuple[str, ...]
    auth: Auth
    get_token: str
    instructions: str = ""
    check: str | None = None
    verified: bool = False
    # How the user can sign in: reuse a login this computer has, a code on the provider's site, or a pasted secret.
    methods: tuple[str, ...] = ("token",)
    # Where a card may link (a dataset's page to accept its terms): a verified spec's sites, else the spec's own site.
    domains: tuple[str, ...] = ()
    # How to read a login this computer may have, for the user to reuse (``local_logins``).
    local: LocalLogin | None = None
    # Built-in only: the account a token belongs to; this computer's own login; refusals signing in would fix.
    whoami: Callable[[str], str | None] | None = field(default=None, compare=False)
    local_token: Callable[[], str | None] | None = field(default=None, compare=False)
    refusal: Callable[[int, str, str, bool], dict | None] | None = field(default=None, compare=False)

    @property
    def link_domains(self) -> tuple[str, ...]:
        return self.domains or (site_of(self.send_to[0]),)

    def public(self) -> dict[str, Any]:
        """The spec as the app and the agent see it (never a secret)."""
        return {"id": self.id, "name": self.name, "send_to": list(self.send_to), "auth": self.auth.public(),
                "get_token": self.get_token, "instructions": self.instructions,
                **({"check": self.check} if self.check else {}), **({"local": self.local.public()} if self.local else {}),
                "verified": self.verified,
                "methods": list(self.methods), "domains": list(self.link_domains)}

    def stored(self) -> dict[str, Any]:
        """What is saved with a key: the spec as the user confirmed it."""
        return {key: value for key, value in self.public().items() if key not in ("verified", "methods", "domains")}


def _text(value: Any, limit: int, field_name: str, required: bool = False) -> str:
    text = " ".join(str(value or "").split())
    if required and not text:
        raise SpecError(f"{field_name} is required.")
    if len(text) > limit:
        raise SpecError(f"{field_name} must be at most {limit} characters.")
    return text


def validate_spec(raw: Any) -> SignInSpec:
    """A sign-in the agent proposed (or the user saved), checked; raises ``SpecError`` saying what is wrong."""
    if not isinstance(raw, dict):
        raise SpecError("A sign-in spec is an object with id, name, send_to, auth and get_token.")
    spec_id = str(raw.get("id") or "").strip().lower()
    if not _ID.match(spec_id) or spec_id in ("activity", "custom"):
        raise SpecError("id must be 2-40 lowercase letters, digits or dashes, like 'kaggle'.")
    name = _text(raw.get("name"), 60, "name", required=True)
    for builtin in BUILTIN.values():
        if spec_id == builtin.id or name.lower() == builtin.name.lower():
            raise SpecError(f"{builtin.name} is built in: propose it by its id ({builtin.id!r}), not as a spec.")
    hosts = raw.get("send_to")
    if isinstance(hosts, str):
        hosts = [hosts]
    if not isinstance(hosts, list) or not 1 <= len(hosts) <= MAX_HOSTS:
        raise SpecError(f"send_to lists 1 to {MAX_HOSTS} exact hosts the secret is sent to.")
    send_to = tuple(dict.fromkeys(_public_host(host) for host in hosts))
    site = site_of(send_to[0])
    if any(site_of(host) != site for host in send_to):
        raise SpecError(f"All send_to hosts must be on one site ({site}).")
    for host in send_to:
        if host in _SHARED_HOSTS or any(host.endswith("." + shared) for shared in _SHARED_HOSTS):
            raise SpecError(f"{host} hosts anyone's content, so a key sent there could reach anyone.")
        if len(host.split(".")) - len(site.split(".")) > MAX_DEPTH:
            raise SpecError(f"{host} is too deep under {site} to receive a key: name the service's API host.")
    get_token = str(raw.get("get_token") or "").strip()
    if not on_domains(get_token, (site,)):
        raise SpecError(f"get_token must be an https page on {site}, the site the secret is sent to.")
    check = str(raw.get("check") or "").strip() or None
    if check and (not https_url(check) or host_of(check) not in send_to):
        raise SpecError("check must be an https URL on one of the send_to hosts.")
    auth_raw = raw.get("auth") if isinstance(raw.get("auth"), dict) else {"type": raw.get("auth")}
    auth_type = str(auth_raw.get("type") or "")
    if auth_type not in AUTH_TYPES:
        raise SpecError(f"auth.type must be one of {', '.join(AUTH_TYPES)}.")
    name_field = str(auth_raw.get("name") or "").strip() or None
    if auth_type == "header" and (not name_field or not _HEADER.match(name_field)
                                  or name_field.lower() in _FORBIDDEN_HEADERS):
        raise SpecError("auth.name must name the header that carries the secret, e.g. 'X-Api-Key'.")
    if auth_type == "query" and (not name_field or not _PARAM.match(name_field)):
        raise SpecError("auth.name must name the query parameter that carries the secret, e.g. 'api_key'.")
    auth = Auth(auth_type, name_field if auth_type in ("header", "query") else None,
                _text(auth_raw.get("username_label"), 40, "auth.username_label") or ("Username" if auth_type == "basic" else None),
                _text(auth_raw.get("secret_label"), 40, "auth.secret_label") or None)
    try:
        local = parse_local(raw["local"], auth_type) if raw.get("local") else None
    except LocalLoginError as exc:
        raise SpecError(str(exc)) from None
    return SignInSpec(id=spec_id, name=name, send_to=send_to, auth=auth, get_token=get_token,
                      instructions=_text(raw.get("instructions"), 400, "instructions"), check=check, local=local,
                      methods=("reuse", "token") if local else ("token",))


def check_secret(spec: SignInSpec, secret: dict[str, Any]) -> dict[str, str]:
    """The secret fields the spec's auth needs, trimmed; raises ``SpecError`` when one is missing or odd."""
    def clean(value: Any, label: str) -> str:
        text = str(value or "").strip()
        if not text or len(text) > 500 or any(char.isspace() for char in text):
            raise SpecError(f"That {label} does not look right: paste it without spaces.")
        return text

    if spec.auth.type == "basic":
        return {"username": clean(secret.get("username"), spec.auth.username_label or "username"),
                "key": clean(secret.get("key") or secret.get("token"), spec.auth.secret_label or "key")}
    return {"token": clean(secret.get("token"), spec.auth.secret_label or "token")}


def secret_values(secret: dict[str, Any]) -> list[str]:
    """The parts of a secret that must never appear in what the agent reads, as sent and as a service may echo
    them back: percent-encoded (in a URL it repeats), JSON-escaped, and basic auth's base64."""
    from urllib.parse import quote, quote_plus

    raw = [str(value) for key, value in secret.items() if key in ("token", "key") and value]
    if secret.get("username") and secret.get("key"):
        raw.append(base64.b64encode(f"{secret['username']}:{secret['key']}".encode()).decode())
    values = []
    for value in raw:
        values += [value, quote(value, safe=""), quote_plus(value), value.replace("/", "\\/")]
    # Longest first, so a longer encoded form is removed before the plain one inside it.
    return sorted(dict.fromkeys(item for item in values if item), key=len, reverse=True)


# -- built-in: Hugging Face --

_HF_DATASET_PATH = re.compile(r"^/(?:api/)?datasets/([A-Za-z0-9][\w.-]*/[A-Za-z0-9][\w.-]*|[A-Za-z0-9][\w.-]*)(?:/|$)")


def _hf_dataset(url: str) -> str | None:
    """The dataset a Hub or dataset-viewer URL is about, if any."""
    parts = urlsplit(url)
    found = parse_qs(parts.query).get("dataset")
    if found:
        return found[0]
    match = _HF_DATASET_PATH.match(parts.path)
    return match.group(1) if match else None


def _hf_refusal(status: int, body: str, url: str, signed_in: bool) -> dict | None:
    dataset = _hf_dataset(url)
    page = {"page": f"https://huggingface.co/datasets/{dataset}"} if dataset else {}
    text = body.lower()
    if status == 429:
        return None if signed_in else {"reason": "rate_limit"}
    gated = "gated" in text or "restricted" in text or "ask for access" in text
    if status in (401, 403) or (status == 404 and "without authentication" in text):
        if signed_in:
            # Signed in and still refused: the account has not accepted the dataset's terms, or cannot see it.
            return {"reason": "terms" if gated or status == 403 else "private", **page}
        return {"reason": "gated" if gated or status == 401 else "private", **page}
    return None


def _hf_local_token() -> str | None:
    from data_formulator.tool_packs.signin import _local_hf_token

    return _local_hf_token()


def _hf_whoami(token: str) -> str | None:
    from data_formulator.tool_packs.signin import hf_login

    return hf_login(token)


HUGGINGFACE = SignInSpec(
    id="huggingface", name="Hugging Face",
    send_to=("huggingface.co", "hf.co", "datasets-server.huggingface.co"),
    auth=Auth("bearer", secret_label="Hugging Face token"),
    get_token="https://huggingface.co/settings/tokens",
    instructions="Make a read token in your Hugging Face settings.",
    check="https://huggingface.co/api/whoami-v2",
    verified=True, methods=("reuse", "device", "token"), domains=("huggingface.co", "hf.co"),
    whoami=_hf_whoami, local_token=_hf_local_token, refusal=_hf_refusal,
)

BUILTIN: dict[str, SignInSpec] = {spec.id: spec for spec in (HUGGINGFACE,)}


def builtin(spec_id: str) -> SignInSpec:
    spec = BUILTIN.get(str(spec_id or ""))
    if spec is None:
        raise SpecError(f"Unknown built-in sign-in {spec_id!r}; built in: {', '.join(BUILTIN)}.")
    return spec


def builtin_for_host(host: str) -> SignInSpec | None:
    return next((spec for spec in BUILTIN.values() if host in spec.send_to), None)


def device_flow(spec: SignInSpec):
    """A built-in spec's device sign-in (the public app its CLI signs in to, unless ours is configured)."""
    import os

    from data_formulator.auth.github_device_flow import DeviceFlow

    if spec.id == "huggingface":
        from data_formulator.tool_packs.signin import HF_CLI_CLIENT_ID, HF_SCOPE, HUGGING_FACE

        return DeviceFlow(f"account-signin:{spec.id}", lambda: os.environ.get("HF_TOOLS_CLIENT_ID") or HF_CLI_CLIENT_ID,
                          HF_SCOPE, HUGGING_FACE)
    raise SpecError(f"{spec.name} has no device sign-in.")
