# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""DataverseDataLoader — Microsoft Dataverse (Power Apps / Dynamics 365) via the Web API.

Each catalog leaf is one Dataverse table, keyed by its logical name. Lookup and
choice columns load as their raw value plus a ``<column>name`` label column (the
naming Dataverse's own SQL endpoint uses), so charts get readable categories
and joins keep the ids. Filters, ordering and row limits run in Dataverse;
grouping and aggregates of structured queries run locally over the filtered
rows, because OData ``$apply`` cannot group by dates or order by aggregates.
Native FetchXML covers joins (``link-entity``) and server-side aggregation.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

import pandas as pd
import pyarrow as pa
import requests

from data_formulator.data_loader import probe_utils
from data_formulator.data_loader.external_data_loader import MAX_IMPORT_ROWS, ExternalDataLoader
from data_formulator.data_loader.query_runtime import check_cancelled
from data_formulator.security.sanitize import sanitize_error_message

logger = logging.getLogger(__name__)

_API_PATH = "/api/data/v9.2/"
_HOST_SUFFIXES = (".dynamics.com", ".microsoftdynamics.us", ".appsplatform.us", ".dynamics.cn")
_LOGIN_HOSTS = {
    "login.microsoftonline.com",
    "login.microsoftonline.us",
    "login.chinacloudapi.cn",
    "login.partner.microsoftonline.cn",
    "login.windows.net",
}
_TENANT_RE = re.compile(r"^[A-Za-z0-9.-]+$")
_GUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_FORMATTED = "@OData.Community.Display.V1.FormattedValue"
_LOOKUP_TABLE = "@Microsoft.Dynamics.CRM.lookuplogicalname"
_PREFER_ANNOTATIONS = (
    'odata.include-annotations="OData.Community.Display.V1.FormattedValue,'
    'Microsoft.Dynamics.CRM.lookuplogicalname,Microsoft.Dynamics.CRM.fetchxmlpagingcookie,'
    'Microsoft.Dynamics.CRM.morerecords"'
)
_PAGE_SIZE = 5000
_REQUEST_TIMEOUT_SECONDS = 120
_MAX_RETRIES = 3
_AGGREGATE_SCAN_ROWS = 200_000
_NATIVE_MAX_ROWS = 10_001
_FETCHXML_MAX_CHARS = 12_000
_SKIPPED_TYPES = {"EntityName", "PartyList", "ManagedProperty", "CalendarRules", "Virtual"}
_OPTION_CASTS = {
    "Picklist": "PicklistAttributeMetadata",
    "State": "StateAttributeMetadata",
    "Status": "StatusAttributeMetadata",
    "MultiSelectPicklist": "MultiSelectPicklistAttributeMetadata",
}
_COMPARISONS = {"EQ": "eq", "NEQ": "ne", "GT": "gt", "GTE": "ge", "LT": "lt", "LTE": "le"}


def normalize_environment_url(value: Any) -> str:
    """Return the ``https://host`` origin of a Dataverse environment URL, or raise ``ValueError``."""
    text = str(value or "").strip()
    if not text:
        raise ValueError("Enter the Dataverse environment URL, e.g. https://yourorg.crm.dynamics.com")
    if "://" not in text:
        text = "https://" + text
    parsed = urllib.parse.urlparse(text)
    host = (parsed.hostname or "").lower()
    if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443)
            or not host.endswith(_HOST_SUFFIXES)):
        raise ValueError("Enter a Dataverse environment URL such as https://yourorg.crm.dynamics.com "
                         "(Power Apps > Settings > Session details > Instance url).")
    return f"https://{host}"


@dataclass(frozen=True)
class EnvironmentAuth:
    tenant_id: str | None
    resource: str
    login_host: str = "https://login.microsoftonline.com"

    @property
    def scope(self) -> str:
        return f"{self.resource}/.default"


_discovery_cache: dict[str, EnvironmentAuth] = {}
_discovery_lock = threading.Lock()


def discover_environment_auth(origin: str) -> EnvironmentAuth:
    """Read the environment's tenant and token audience from its ``WWW-Authenticate`` challenge.

    The tenant matters for guest accounts: a token from the user's home tenant is rejected. The request goes
    only to a Dataverse host (``normalize_environment_url``), whatever the caller passed.
    """
    origin = normalize_environment_url(origin)
    with _discovery_lock:
        if origin in _discovery_cache:
            return _discovery_cache[origin]
    try:
        response = requests.get(origin + _API_PATH, timeout=10, allow_redirects=False)
        header = response.headers.get("WWW-Authenticate", "")
    except requests.RequestException:
        header = ""
    tenant, login_host, resource = None, "https://login.microsoftonline.com", origin
    authority = re.search(r'authorization_uri="?([^",\s]+)', header)
    if authority:
        parsed = urllib.parse.urlparse(authority.group(1))
        segment = parsed.path.strip("/").split("/")[0]
        if parsed.scheme == "https" and parsed.hostname in _LOGIN_HOSTS and _TENANT_RE.fullmatch(segment):
            tenant, login_host = segment, f"https://{parsed.hostname}"
    resource_match = re.search(r'resource_id="?([^",\s]+)', header)
    if resource_match:
        try:
            resource = normalize_environment_url(resource_match.group(1))
        except ValueError:
            pass
    result = EnvironmentAuth(tenant, resource, login_host)
    if tenant:
        with _discovery_lock:
            _discovery_cache[origin] = result
    return result


def _local_mode() -> bool:
    try:
        from data_formulator.auth.identity import is_local_mode
        return is_local_mode()
    except Exception:
        return False


def _browser_record_path(origin: str):
    from data_formulator.datalake.workspace import get_data_formulator_home
    return get_data_formulator_home() / "auth" / "dataverse" / f"{urllib.parse.urlparse(origin).hostname}.json"


def oauth_client_id() -> str:
    return os.environ.get("DATAVERSE_OAUTH_CLIENT_ID", "")


def refresh_delegated_token(auth: EnvironmentAuth, refresh_token: str) -> dict[str, Any]:
    """Redeem a refresh token from the Microsoft sign-in popup for a new Dataverse token."""
    data = {"client_id": oauth_client_id(), "grant_type": "refresh_token", "refresh_token": refresh_token,
            "scope": f"{auth.scope} offline_access"}
    secret = os.environ.get("DATAVERSE_OAUTH_CLIENT_SECRET", "")
    if secret:
        data["client_secret"] = secret
    tenant = os.environ.get("DATAVERSE_OAUTH_TENANT_ID") or auth.tenant_id or "organizations"
    response = requests.post(f"{auth.login_host}/{tenant}/oauth2/v2.0/token", data=data, timeout=15)
    if not response.ok:
        raise PermissionError("Dataverse sign-in expired; sign in with Microsoft again.")
    return response.json()


class _TokenSource:
    """Cache one bearer token and renew it five minutes before expiry."""

    def __init__(self, acquire: Callable[[], tuple[str, float]], token: str | None = None, expires_at: float = 0):
        self._acquire = acquire
        self._token = token
        self._expires_at = expires_at
        self._lock = threading.Lock()

    def token(self) -> str:
        with self._lock:
            if not self._token or self._expires_at <= time.time() + 300:
                self._token, self._expires_at = self._acquire()
            return self._token


def _label(value: Any) -> str:
    if isinstance(value, dict):
        localized = value.get("UserLocalizedLabel") or next(iter(value.get("LocalizedLabels") or []), None)
        return str((localized or {}).get("Label") or "")
    return ""


def _odata_string(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


@dataclass
class _Field:
    """One output column and how it maps to Dataverse."""

    name: str
    attr: str
    kind: str  # id|string|int|float|bool|datetime|date|lookup|lookup_name|lookup_table|choice|choice_name|multi|multi_name
    source_type: str
    description: str = ""

    @property
    def prop(self) -> str:
        """The OData property that carries this column's value."""
        return f"_{self.attr}_value" if self.kind.startswith("lookup") else self.attr


@dataclass
class _Table:
    logical: str
    entity_set: str
    fields: list[_Field]
    options: dict[str, dict[int, str]]
    navigation: dict[str, tuple[str, str]]  # lookup attr -> (navigation property, target primary name)
    metadata: dict[str, Any]

    def field(self, name: str) -> _Field:
        for item in self.fields:
            if item.name == name:
                return item
        raise ValueError(f"Unknown column {name!r} for Dataverse table {self.logical!r}. "
                         "Read the table's sources/ file for its columns.")


class DataverseDataLoader(ExternalDataLoader):
    DISPLAY_NAME = "Dataverse"
    DESCRIPTION = "Query Microsoft Dataverse tables (Power Apps, Dynamics 365) such as accounts and opportunities."
    AUTH_GUIDE = "dataverse.md"
    QUERY_EXECUTION = "server_query"
    IDENTITY_PARAMS = ("environment_url",)

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {"name": "environment_url", "type": "string", "required": True, "tier": "connection",
             "description": "e.g., https://yourorg.crm.dynamics.com"},
            {"name": "login_hint", "type": "string", "required": False, "tier": "auth",
             "description": "Optional account to sign in with, e.g. you@contoso.com"},
            {"name": "client_id", "type": "string", "required": False, "tier": "auth", "description": "Service principal only"},
            {"name": "client_secret", "type": "string", "required": False, "sensitive": True, "tier": "auth",
             "description": "Service principal only"},
            {"name": "tenant_id", "type": "string", "required": False, "tier": "auth", "description": "Service principal only"},
        ]

    @classmethod
    def auth_paths(cls) -> list[dict[str, Any]]:
        microsoft_sign_in = bool(oauth_client_id())
        paths: list[dict[str, Any]] = [
            {
                "id": "ambient",
                "label": "Azure default identity",
                "description": "Use Azure CLI, managed identity, VS Code, or environment credentials.",
                "fields": [],
                "required_fields": [],
                "kind": "ambient",
                "default": not microsoft_sign_in,
                "cli_login": {
                    "provider": "azure",
                    "label": "Sign in with Azure CLI",
                    "status_url": "/api/local/azure-status",
                    "login_url": "/api/local/azure-login",
                },
            },
            {
                "id": "service_principal",
                "label": "Service principal",
                "description": "Use an Entra application that is an application user in the environment.",
                "fields": ["client_id", "client_secret", "tenant_id"],
                "required_fields": ["client_id", "client_secret", "tenant_id"],
                "kind": "credentials",
            },
        ]
        if _local_mode():
            paths.insert(0, {
                "id": "browser_sign_in",
                "label": "Sign in with Microsoft (browser)",
                "description": "Opens your browser to sign in with the account that can use this environment.",
                "fields": ["login_hint"],
                "required_fields": [],
                "kind": "ambient",
                "default": not microsoft_sign_in,
            })
            paths[1]["default"] = False
        if microsoft_sign_in:
            paths.insert(0, {
                "id": "microsoft_sign_in",
                "label": "Sign in with Microsoft",
                "description": "Use your Microsoft account and its Dataverse security roles.",
                "fields": [],
                "required_fields": [],
                "kind": "delegated_login",
                "default": True,
            })
        return paths

    @classmethod
    def infer_auth_path(cls, params: dict[str, Any]) -> str:
        if all(params.get(name) for name in ("client_id", "client_secret", "tenant_id")):
            return "service_principal"
        if params.get("access_token"):
            return "microsoft_sign_in"
        if params.get("login_hint") and _local_mode():
            return "browser_sign_in"
        return "ambient"

    @staticmethod
    def delegated_login_config() -> dict[str, Any] | None:
        if not oauth_client_id():
            return None
        return {"login_url": "/api/auth/dataverse/login", "label": "Sign in with Microsoft", "params": ["environment_url"]}

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [{"key": "table", "label": "Table"}]

    @classmethod
    def query_capabilities(cls) -> dict[str, Any]:
        return {
            **super().query_capabilities(),
            "guidance": (
                "Dataverse applies filters, column selection, ordering and row limits. Grouping and aggregates in "
                f"structured queries are computed in the app over the filtered rows (at most {_AGGREGATE_SCAN_ROWS:,}), "
                "so filter first. Lookup and choice columns have a <column>name label column for display; filter "
                "and join on the raw column (lookups hold the related row's id)."
            ),
            "native_query_languages": ["fetchxml"],
            "native_query_guidance": (
                "One read-only FetchXML <fetch> with exactly one <entity>, using logical table and column names "
                "from sources/ files. Use it to join tables with <link-entity name=... from=... to=... alias=...> "
                "or to aggregate in Dataverse (<fetch aggregate='true'>, attributes with groupby='true' or "
                "aggregate='sum|avg|min|max|count|countcolumn' and an alias; dategrouping='month|quarter|year'). "
                "Example: pipeline by stage and account region: <fetch aggregate='true'><entity name='opportunity'>"
                "<attribute name='estimatedvalue' aggregate='sum' alias='pipeline'/><attribute name='stepname' "
                "groupby='true' alias='stage'/><link-entity name='account' from='accountid' to='parentaccountid' "
                "alias='acct'><attribute name='address1_stateorprovince' groupby='true' alias='region'/></link-entity>"
                "</entity></fetch>. Linked columns without an alias come back as <alias>_<column>. Aggregates read "
                f"at most 50,000 rows. Maximum {_NATIVE_MAX_ROWS - 1} result rows."
            ),
        }

    def __init__(self, params: dict[str, Any]):
        self.params = params
        self.auth_path = params.get("_auth_path") or self.infer_auth_path(params)
        self.origin = normalize_environment_url(params.get("environment_url"))
        self.auth = discover_environment_auth(self.origin)
        self._tokens = self._token_source(params)
        self._session = requests.Session()
        self._entities: dict[str, dict[str, Any]] | None = None
        self._tables: dict[str, _Table] = {}

    def _token_source(self, params: dict[str, Any]) -> _TokenSource:
        scope = self.auth.scope
        if self.auth_path == "microsoft_sign_in" or params.get("access_token"):
            refresh_token = params.get("refresh_token") or ""

            def refresh() -> tuple[str, float]:
                nonlocal refresh_token
                if not refresh_token or not oauth_client_id():
                    raise PermissionError("Dataverse sign-in expired; sign in with Microsoft again.")
                tokens = refresh_delegated_token(self.auth, refresh_token)
                refresh_token = tokens.get("refresh_token") or refresh_token
                return tokens["access_token"], time.time() + float(tokens.get("expires_in") or 3600)

            return _TokenSource(refresh, params.get("access_token"), float(params.get("token_expires_at") or 0))

        if self.auth_path == "browser_sign_in":
            return self._browser_token_source(params)

        if self.auth_path == "service_principal":
            from azure.identity import ClientSecretCredential
            credential = ClientSecretCredential(params["tenant_id"], params["client_id"], params["client_secret"])

            def service_principal() -> tuple[str, float]:
                token = credential.get_token(scope)
                return token.token, token.expires_on

            return _TokenSource(service_principal)

        from azure.identity import DefaultAzureCredential
        credential = DefaultAzureCredential(additionally_allowed_tenants=["*"])
        tenant = self.auth.tenant_id

        def ambient() -> tuple[str, float]:
            try:
                token = credential.get_token(scope, tenant_id=tenant) if tenant else credential.get_token(scope)
            except Exception as exc:
                login = f"az login --tenant {tenant} --allow-no-subscriptions" if tenant else "az login"
                raise PermissionError(
                    f"Could not get a Dataverse token from your Azure sign-in. Run `{login}` with an account "
                    "that is a user in this environment, then connect again."
                ) from exc
            return token.token, token.expires_on

        return _TokenSource(ambient)

    def _browser_token_source(self, params: dict[str, Any]) -> _TokenSource:
        """Local interactive sign-in; the token cache lives in the OS keychain and only the account record on disk."""
        if not _local_mode():
            raise PermissionError("Browser sign-in is only available when Data Formulator runs on your machine.")
        from azure.identity import (AuthenticationRecord, AuthenticationRequiredError, InteractiveBrowserCredential,
                                    TokenCachePersistenceOptions)
        record_path = _browser_record_path(self.origin)
        hint = str(params.get("login_hint") or "").strip()
        record = None
        if record_path.exists():
            record = AuthenticationRecord.deserialize(record_path.read_text(encoding="utf-8"))
            if hint and hint.casefold() != (record.username or "").casefold():
                record = None
        options: dict[str, Any] = {
            "tenant_id": self.auth.tenant_id or "organizations",
            "cache_persistence_options": TokenCachePersistenceOptions(name="data_formulator_dataverse"),
            "timeout": 180,
        }
        if hint:
            options["login_hint"] = hint
        scope = self.auth.scope

        def acquire() -> tuple[str, float]:
            nonlocal record
            if record is not None:
                # Reconnects must not pop up a browser; an expired sign-in asks the user to connect again.
                credential = InteractiveBrowserCredential(authentication_record=record,
                                                          disable_automatic_authentication=True, **options)
                try:
                    token = credential.get_token(scope)
                    return token.token, token.expires_on
                except AuthenticationRequiredError as exc:
                    record_path.unlink(missing_ok=True)
                    record = None
                    raise PermissionError("Your Dataverse sign-in expired; connect again to sign in.") from exc
            credential = InteractiveBrowserCredential(**options)
            record = credential.authenticate(scopes=[scope])
            record_path.parent.mkdir(parents=True, exist_ok=True)
            record_path.write_text(record.serialize(), encoding="utf-8")
            token = credential.get_token(scope)
            return token.token, token.expires_on

        return _TokenSource(acquire)

    # -- HTTP -----------------------------------------------------------------

    def _request(self, path_or_url: str, params: dict[str, Any] | None = None,
                 page_size: int | None = None) -> dict[str, Any]:
        url = path_or_url if path_or_url.startswith("https://") else self.origin + _API_PATH + path_or_url
        if not url.startswith(self.origin + _API_PATH):
            raise ValueError("Refusing to follow a Dataverse link outside the environment.")
        prefer = _PREFER_ANNOTATIONS + (f",odata.maxpagesize={page_size}" if page_size else "")
        for attempt in range(_MAX_RETRIES + 1):
            check_cancelled()
            response = self._session.get(url, params=params, timeout=_REQUEST_TIMEOUT_SECONDS, headers={
                "Authorization": f"Bearer {self._tokens.token()}", "Accept": "application/json",
                "OData-MaxVersion": "4.0", "OData-Version": "4.0", "Prefer": prefer,
            })
            if response.status_code in (429, 503) and attempt < _MAX_RETRIES:
                try:
                    delay = float(response.headers.get("Retry-After") or 2 ** attempt)
                except ValueError:
                    delay = 2 ** attempt
                time.sleep(min(delay, 30))
                continue
            break
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if response.status_code >= 400:
            raise ValueError(sanitize_error_message(self._error_text(response.status_code, payload)))
        return payload if isinstance(payload, dict) else {}

    def _error_text(self, status: int, payload: Any) -> str:
        error = payload.get("error") if isinstance(payload, dict) else None
        detail = (error.get("message") if isinstance(error, dict) else None) or ""
        if status == 401:
            tenant = f" (tenant {self.auth.tenant_id})" if self.auth.tenant_id else ""
            return (f"Dataverse authentication failed (401): sign in with an account that is a user in this "
                    f"environment{tenant}. {detail}").strip()
        if status == 403:
            return (f"Dataverse access denied (403): {detail or 'missing privileges'}. Your security role needs "
                    "read access to this table.")
        if status == 429:
            return "Dataverse throttled the request (429). Wait a moment and retry with a narrower query."
        return f"Dataverse query failed ({status}): {detail or 'unknown error'}"

    def _get_rows(self, entity_set: str, params: dict[str, Any], limit: int) -> list[dict[str, Any]]:
        params = dict(params)
        if limit <= _PAGE_SIZE:
            params["$top"] = limit
        rows: list[dict[str, Any]] = []
        payload = self._request(entity_set, params, page_size=None if limit <= _PAGE_SIZE else _PAGE_SIZE)
        while True:
            rows.extend(payload.get("value") or [])
            next_link = payload.get("@odata.nextLink")
            if not next_link or len(rows) >= limit:
                return rows[:limit]
            self._report_progress(f"Loaded {len(rows):,} rows from {entity_set}…")
            payload = self._request(next_link, page_size=_PAGE_SIZE)

    # -- Catalog --------------------------------------------------------------

    def test_connection(self) -> bool:
        self._request("WhoAmI")
        return True

    def _entity_map(self) -> dict[str, dict[str, Any]]:
        if self._entities is None:
            payload = self._request("EntityDefinitions", {
                "$select": "LogicalName,EntitySetName,DisplayName,Description,PrimaryIdAttribute,"
                           "PrimaryNameAttribute,IsCustomEntity",
                "$filter": "IsPrivate eq false and IsIntersect eq false and IsValidForAdvancedFind eq true",
            })
            self._entities = {
                item["LogicalName"]: item for item in payload.get("value") or []
                if item.get("LogicalName") and item.get("EntitySetName")
            }
        return self._entities

    def _entity(self, logical: str) -> dict[str, Any]:
        name = str(logical or "").strip().lower()
        entity = self._entity_map().get(name)
        if entity is None:
            raise ValueError(f"Dataverse table {logical!r} was not found or is not readable. "
                             "Use the logical name from the catalog, e.g. account or opportunity.")
        return entity

    def _row_counts(self, names: list[str]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for start in range(0, len(names), 100):
            chunk = names[start:start + 100]
            try:
                payload = self._request("RetrieveTotalRecordCount(EntityNames=@names)",
                                        {"@names": "[" + ",".join(_odata_string(n) for n in chunk) + "]"})
                collection = payload.get("EntityRecordCountCollection") or {}
                for key, value in zip(collection.get("Keys") or [], collection.get("Values") or []):
                    # Counts come from a periodic snapshot, so a new table reads 0 until it refreshes.
                    if isinstance(value, int) and value > 0:
                        counts[key] = value
            except Exception as exc:
                logger.debug("Dataverse row counts unavailable: %s", exc)
        return counts

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        needle = (table_filter or "").casefold()
        entities = [
            item for name, item in sorted(self._entity_map().items())
            if not needle or needle in name.casefold() or needle in _label(item.get("DisplayName")).casefold()
        ]
        counts = self._row_counts([item["LogicalName"] for item in entities])
        tables = []
        for item in entities:
            name = item["LogicalName"]
            metadata: dict[str, Any] = {"entity_set": item["EntitySetName"]}
            description = ": ".join(filter(None, [_label(item.get("DisplayName")), _label(item.get("Description"))]))
            if description:
                metadata["description"] = description
            if name in counts:
                metadata["row_count"] = counts[name]
            tables.append({"name": name, "table_key": name, "path": [name], "metadata": metadata})
        return tables

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        return dict(self._table(path[-1]).metadata) if path else {}

    def get_column_types(self, source_table: str) -> dict[str, Any]:
        metadata = self.get_metadata([source_table])
        result: dict[str, Any] = {"columns": metadata.get("columns", [])}
        if metadata.get("description"):
            result["description"] = metadata["description"]
        return result

    def _attributes(self, logical: str, cast: str = "", **params: str) -> list[dict[str, Any]]:
        path = f"EntityDefinitions(LogicalName={_odata_string(logical)})/Attributes" + (f"/Microsoft.Dynamics.CRM.{cast}" if cast else "")
        return self._request(path, params or None).get("value") or []

    def _table(self, logical: str) -> _Table:
        entity = self._entity(logical)
        name = entity["LogicalName"]
        if name in self._tables:
            return self._tables[name]
        attributes = self._attributes(name, **{
            "$select": "LogicalName,AttributeType,AttributeTypeName,DisplayName,Description,IsValidForRead,"
                       "IsValidODataAttribute,AttributeOf",
        })
        kinds = {item.get("AttributeType") for item in attributes} | {
            (item.get("AttributeTypeName") or {}).get("Value") for item in attributes}
        options: dict[str, dict[int, str]] = {}
        for type_name, cast in _OPTION_CASTS.items():
            if type_name not in kinds and f"{type_name}Type" not in kinds:
                continue
            try:
                for item in self._attributes(name, cast, **{"$select": "LogicalName", "$expand": "OptionSet"}):
                    choices = (item.get("OptionSet") or {}).get("Options") or []
                    options[item["LogicalName"]] = {o["Value"]: _label(o.get("Label")) for o in choices if "Value" in o}
            except Exception as exc:
                logger.debug("Dataverse %s options unavailable for %s: %s", type_name, name, exc)
        relationships: dict[str, list[dict[str, Any]]] = {}
        try:
            payload = self._request(f"EntityDefinitions(LogicalName={_odata_string(name)})/ManyToOneRelationships", {
                "$select": "ReferencingAttribute,ReferencedEntity,ReferencedAttribute,ReferencingEntityNavigationPropertyName",
            })
            for item in payload.get("value") or []:
                relationships.setdefault(item.get("ReferencingAttribute"), []).append(item)
        except Exception as exc:
            logger.debug("Dataverse relationships unavailable for %s: %s", name, exc)
        table = self._build_table(entity, attributes, options, relationships)
        self._tables[name] = table
        return table

    def _build_table(self, entity: dict[str, Any], attributes: list[dict[str, Any]],
                     options: dict[str, dict[int, str]], relationships: dict[str, list[dict[str, Any]]]) -> _Table:
        fields: list[_Field] = []
        navigation: dict[str, tuple[str, str]] = {}
        # Dataverse's own <attr>name helpers (AttributeOf set) are skipped, so their names are free to reuse.
        taken = {item.get("LogicalName") for item in attributes if not item.get("AttributeOf")}
        entities = self._entity_map()

        def companion(attr: str, suffix: str) -> str:
            return f"{attr}{suffix}" if f"{attr}{suffix}" not in taken else f"{attr}_{suffix}"

        for item in sorted(attributes, key=lambda a: (a.get("LogicalName") != entity.get("PrimaryIdAttribute"),
                                                     a.get("LogicalName") != entity.get("PrimaryNameAttribute"),
                                                     a.get("LogicalName") or "")):
            attr, kind = item.get("LogicalName"), item.get("AttributeType") or ""
            type_name = (item.get("AttributeTypeName") or {}).get("Value") or ""
            if (not attr or item.get("AttributeOf") or item.get("IsValidForRead") is False
                    or item.get("IsValidODataAttribute") is False):
                continue
            if type_name == "MultiSelectPicklistType":
                kind = "MultiSelectPicklist"
            elif kind in _SKIPPED_TYPES:
                continue
            description = ": ".join(filter(None, [_label(item.get("DisplayName")), _label(item.get("Description"))]))
            if kind in ("Lookup", "Customer", "Owner"):
                targets = relationships.get(attr) or []
                joins = ", ".join(f"{t['ReferencedEntity']}.{t['ReferencedAttribute']}" for t in targets)
                fields.append(_Field(attr, attr, "lookup", kind, ". ".join(filter(None, [description, f"Lookup id → {joins}" if joins else "Lookup id"]))))
                fields.append(_Field(companion(attr, "name"), attr, "lookup_name", "String", f"Display name of {attr}"))
                if len(targets) > 1:
                    fields.append(_Field(companion(attr, "type"), attr, "lookup_table", "String", f"Table of the row {attr} points to"))
                elif targets and targets[0].get("ReferencingEntityNavigationPropertyName"):
                    target = entities.get(targets[0]["ReferencedEntity"]) or {}
                    if target.get("PrimaryNameAttribute"):
                        navigation[attr] = (targets[0]["ReferencingEntityNavigationPropertyName"], target["PrimaryNameAttribute"])
            elif kind in ("Picklist", "State", "Status", "MultiSelectPicklist"):
                choices = options.get(attr) or {}
                values = "; ".join(f"{value}={text}" for value, text in list(choices.items())[:40])
                base = "multi" if kind == "MultiSelectPicklist" else "choice"
                fields.append(_Field(attr, attr, base, kind, ". ".join(filter(None, [description, f"Choice values: {values}" if values else "Choice value"]))))
                fields.append(_Field(companion(attr, "name"), attr, f"{base}_name", "String", f"Label of {attr}"))
            else:
                field_kind = {"Boolean": "bool", "Integer": "int", "BigInt": "int", "Decimal": "float", "Double": "float",
                              "Money": "float", "DateTime": "datetime", "Uniqueidentifier": "id"}.get(kind, "string")
                fields.append(_Field(attr, attr, field_kind, kind, description))

        sql_types = {"id": "UUID", "string": "VARCHAR", "int": "BIGINT", "float": "DOUBLE", "bool": "BOOLEAN",
                     "datetime": "TIMESTAMP", "lookup": "UUID", "choice": "INTEGER", "multi": "VARCHAR"}
        columns = []
        for field in fields:
            column = {"name": field.name, "type": sql_types.get(field.kind, "VARCHAR"), "source_type": field.source_type}
            if field.kind == "datetime":
                column["is_dttm"] = True
            if field.description:
                column["description"] = field.description
            columns.append(column)
        metadata: dict[str, Any] = {"entity_set": entity["EntitySetName"], "columns": columns}
        description = ": ".join(filter(None, [_label(entity.get("DisplayName")), _label(entity.get("Description"))]))
        if description:
            metadata["description"] = description
        links = [{"from": f"{entity['LogicalName']}.{attr}", "to": f"{t['ReferencedEntity']}.{t['ReferencedAttribute']}"}
                 for attr, targets in relationships.items() for t in targets
                 if attr and any(field.attr == attr for field in fields)]
        if links:
            metadata["relationships"] = links
        return _Table(entity["LogicalName"], entity["EntitySetName"], fields, options, navigation, metadata)

    # -- Filters --------------------------------------------------------------

    def _literal(self, table: _Table, field: _Field, value: Any) -> str:
        if value is None:
            return "null"
        if field.kind in ("lookup", "id"):
            if not _GUID_RE.match(str(value)):
                raise ValueError(f"Filter value for {field.name!r} must be a row id (GUID).")
            return str(value)
        if field.kind == "choice":
            if isinstance(value, str) and not value.strip().lstrip("-").isdigit():
                return str(self._choice_value(table, field, value))
            return str(int(value))
        if field.kind == "bool":
            truthy = value if isinstance(value, bool) else str(value).strip().lower() in {"true", "1", "yes"}
            return "true" if truthy else "false"
        if field.kind in ("int", "float"):
            if isinstance(value, bool):
                raise ValueError(f"Filter value for {field.name!r} must be a number.")
            try:
                number = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Filter value for {field.name!r} must be a number.") from exc
            return str(int(number)) if field.kind == "int" and number.is_integer() else repr(number)
        if field.kind == "datetime":
            try:
                moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            except ValueError as exc:
                raise ValueError(f"Filter value for {field.name!r} must be an ISO date or datetime.") from exc
            if moment.tzinfo is not None:
                moment = moment.astimezone(timezone.utc).replace(tzinfo=None)
            return moment.strftime("%Y-%m-%dT%H:%M:%SZ")
        return _odata_string(value)

    @staticmethod
    def _choice_value(table: _Table, field: _Field, label: Any) -> int:
        choices = table.options.get(field.attr) or {}
        matches = [value for value, text in choices.items() if text.casefold() == str(label).casefold()]
        if not matches:
            raise ValueError(f"{label!r} is not a choice of {field.attr!r}; choices: {', '.join(choices.values())}.")
        return matches[0]

    def _compile_filters(self, table: _Table, filters: list[dict[str, Any]] | None) -> str:
        parts = []
        for item in filters or []:
            if not isinstance(item, dict):
                raise ValueError("Each filter must be an object with column, op and value.")
            field = table.field(item.get("column"))
            op = str(item.get("op") or item.get("operator") or "").upper().strip()
            parts.append(self._compile_filter(table, field, op, item.get("value")))
        return " and ".join(f"({part})" for part in parts)

    def _compile_filter(self, table: _Table, field: _Field, op: str, value: Any) -> str:
        values = list(value) if isinstance(value, (list, tuple)) else [value]
        if field.kind in ("multi", "multi_name", "lookup_table"):
            raise ValueError(f"Filtering on {field.name!r} is not supported in Dataverse; load the table and filter locally.")
        if field.kind == "choice_name":
            base = _Field(field.attr, field.attr, "choice", field.source_type)
            if op in ("ILIKE", "LIKE"):
                needle = str(values[0]).strip("%").casefold()
                matches = [v for v, text in (table.options.get(field.attr) or {}).items() if needle in text.casefold()]
                if not matches:
                    return f"{field.attr} eq null and {field.attr} ne null"
                return " or ".join(f"{field.attr} eq {v}" for v in matches)
            labels = [None if v is None else self._choice_value(table, field, v) for v in values]
            return self._compile_filter(table, base, op, labels if isinstance(value, (list, tuple)) else labels[0])
        prop = field.prop
        if field.kind == "lookup_name":
            if field.attr not in table.navigation:
                raise ValueError(f"Filter on the id column {field.attr!r} instead of {field.name!r}.")
            nav, primary = table.navigation[field.attr]
            prop = f"{nav}/{primary}"
            field = _Field(field.name, field.attr, "string", "String")
        if op in _COMPARISONS:
            return f"{prop} {_COMPARISONS[op]} {self._literal(table, field, values[0])}"
        if op in ("IN", "NOT_IN"):
            if not values:
                raise ValueError(f"{op} filter on {field.name!r} requires at least one value.")
            clause = " or ".join(f"{prop} eq {self._literal(table, field, v)}" for v in values)
            return clause if op == "IN" else f"not ({clause})"
        if op == "IS_NULL":
            return f"{prop} eq null"
        if op == "IS_NOT_NULL":
            return f"{prop} ne null"
        if op == "BETWEEN":
            if len(values) != 2:
                raise ValueError("BETWEEN requires [low, high].")
            return f"{prop} ge {self._literal(table, field, values[0])} and {prop} le {self._literal(table, field, values[1])}"
        if op in ("ILIKE", "LIKE"):
            if field.kind != "string":
                raise ValueError(f"Text matching works on text columns only, not {field.name!r}.")
            pattern = str(values[0])
            core = pattern.strip("%") if op == "LIKE" else pattern
            if op == "LIKE" and "%" in core:
                raise ValueError("LIKE patterns support only leading and/or trailing % wildcards.")
            function = ("contains" if op == "ILIKE" or (pattern.startswith("%") and pattern.endswith("%"))
                        else "endswith" if pattern.startswith("%") else "startswith" if pattern.endswith("%") else None)
            if function is None:
                return f"{prop} eq {_odata_string(core)}"
            return f"{function}({prop},{_odata_string(core)})"
        raise ValueError(f"Unsupported filter operator {op!r}.")

    # -- Fetch ----------------------------------------------------------------

    def fetch_data_as_arrow(self, source_table: str, import_options: dict[str, Any] | None = None) -> pa.Table:
        options = import_options or {}
        table = self._table(source_table)
        size = options.get("size")
        limit = min(size, MAX_IMPORT_ROWS) if isinstance(size, int) and size > 0 else MAX_IMPORT_ROWS
        fields = [table.field(name) for name in options.get("columns") or []] or table.fields
        params: dict[str, Any] = {"$select": ",".join(dict.fromkeys(field.prop for field in fields))}
        where = self._compile_filters(table, [
            {"column": item.get("column"), "op": item.get("operator") or item.get("op"), "value": item.get("value")}
            for item in options.get("source_filters") or []
        ])
        if where:
            params["$filter"] = where
        order = []
        for column in options.get("sort_columns") or []:
            field = table.field(column)
            if field.kind in ("lookup_name", "lookup_table", "choice_name", "multi_name"):
                raise ValueError(f"Sort by a stored column instead of the label column {column!r}.")
            order.append(f"{field.prop} {'desc' if options.get('sort_order') == 'desc' else 'asc'}")
        if order:
            params["$orderby"] = ",".join(order)
        logger.info("Fetching Dataverse table %s (limit %d)", table.logical, limit)
        rows = self._get_rows(table.entity_set, params, limit)
        return self._rows_to_arrow(rows, fields)

    @staticmethod
    def _value(row: dict[str, Any], field: _Field) -> Any:
        if field.kind in ("lookup_name", "choice_name", "multi_name"):
            return row.get(field.prop + _FORMATTED)
        if field.kind == "lookup_table":
            return row.get(field.prop + _LOOKUP_TABLE)
        return row.get(field.prop)

    @staticmethod
    def _column_array(values: list[Any], kind: str) -> pa.Array:
        series = pd.Series(values, dtype="object")
        if kind == "datetime":
            stamps = pd.to_datetime(series, errors="coerce", utc=True, format="mixed").dt.tz_localize(None)
            return pa.array(stamps, type=pa.timestamp("us"), from_pandas=True)
        if kind == "bool":
            return pa.array([None if v is None else bool(v) for v in values], type=pa.bool_())
        if kind in ("int", "choice"):
            return pa.array(pd.to_numeric(series, errors="coerce").astype("Int64"), type=pa.int64(), from_pandas=True)
        if kind == "float":
            return pa.array(pd.to_numeric(series, errors="coerce").astype("float64"), type=pa.float64(), from_pandas=True)
        return pa.array([None if v is None else str(v) for v in values], type=pa.string())

    def _rows_to_arrow(self, rows: list[dict[str, Any]], fields: list[_Field]) -> pa.Table:
        return pa.table({field.name: self._column_array([self._value(row, field) for row in rows], field.kind)
                         for field in fields})

    # -- Structured queries ---------------------------------------------------

    def _local_query(self, source_table: str, query: dict[str, Any], limit: int,
                     scan_rows: int) -> tuple[pa.Table, bool]:
        """Push filters to Dataverse, then project/group/aggregate the rows in DuckDB."""
        import duckdb

        table = self._table(source_table)
        known = {field.name for field in table.fields}
        filters = query.get("filters") or []
        grouped = bool(query.get("group_by") or query.get("aggregates"))
        needed = [*(query.get("columns") or []), *(query.get("group_by") or []),
                  *(agg.get("column") for agg in query.get("aggregates") or [] if isinstance(agg, dict)),
                  *(item.get("column") for item in query.get("order_by") or [] if isinstance(item, dict))]
        columns = [name for name in dict.fromkeys(needed) if name in known]
        unknown = [name for name in (query.get("columns") or []) + (query.get("group_by") or []) if name not in known]
        if unknown:
            raise ValueError(f"Unknown columns {unknown} for Dataverse table {table.logical!r}.")
        if not columns:
            columns = [table.fields[0].name] if grouped else [field.name for field in table.fields]
        options: dict[str, Any] = {
            "columns": columns,
            "source_filters": [{"column": f.get("column"), "operator": f.get("op") or f.get("operator"),
                                "value": f.get("value")} for f in filters],
        }
        sortable = [item for item in query.get("order_by") or [] if isinstance(item, dict)]
        pushable = (not grouped and len({str(i.get("dir", "asc")).lower() for i in sortable}) <= 1
                    and all(table.field(i["column"]).kind not in ("lookup_name", "lookup_table", "choice_name", "multi_name")
                            for i in sortable if i.get("column") in known))
        if pushable:
            options["size"] = limit
            if sortable:
                options["sort_columns"] = [item["column"] for item in sortable]
                options["sort_order"] = str(sortable[0].get("dir", "asc")).lower()
        else:
            options["size"] = scan_rows + 1
        arrow = self.fetch_data_as_arrow(table.logical, options)
        capped = not pushable and arrow.num_rows > scan_rows
        if capped:
            arrow = arrow.slice(0, scan_rows)
        # Dataverse already applied the filters exactly; label filters would not type-check locally.
        local = {**query, "filters": []}
        sql = probe_utils.compile_probe_sql(local, limit, relation="t", dialect=probe_utils.DUCKDB, strict=True)
        with duckdb.connect(config=probe_utils.duckdb_query_config()) as connection:
            connection.register("t", arrow)
            return connection.execute(sql).fetch_arrow_table(), capped

    def query_data_as_arrow(self, source_table: str, query: dict[str, Any], limit: int) -> pa.Table:
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
            raise ValueError("Structured query limit must be a positive integer.")
        if query.get("native") is not None:
            native = query["native"]
            if not isinstance(native, dict):
                raise ValueError("Native query must be an object with language and text.")
            self.validate_native_query(native.get("language"), native.get("text"))
            return self._run_fetchxml(native["text"], min(limit, _NATIVE_MAX_ROWS))
        result, capped = self._local_query(source_table, query, limit, _AGGREGATE_SCAN_ROWS)
        if capped:
            raise ValueError(f"More than {_AGGREGATE_SCAN_ROWS:,} rows match; add filters or use a FetchXML "
                             "aggregate so Dataverse computes the result.")
        return result

    def probe(self, path: list[str], query: dict[str, Any]) -> dict[str, Any]:
        if not path:
            return {"error": "probe requires a non-empty table path"}
        query = query or {}
        out_limit = probe_utils.clamp_probe_limit(query.get("limit"))
        try:
            if query.get("native") is not None:
                table, capped = self.query_data_as_arrow(path[-1], query, out_limit), False
            else:
                table, capped = self._local_query(path[-1], query, out_limit, probe_utils.PROBE_SCAN_ROWS)
        except (ValueError, requests.RequestException, PermissionError) as exc:
            return {"error": f"probe failed: {exc}"}
        note = (f"computed over the first {probe_utils.PROBE_SCAN_ROWS:,} matching rows only (approximate)"
                if capped else None)
        return probe_utils.shape_probe_payload(table, out_limit, exact=not capped, extra_note=note)

    # -- FetchXML -------------------------------------------------------------

    def validate_native_query(self, language: str, text: str) -> None:
        if language != "fetchxml":
            raise ValueError("This connector supports native fetchxml queries only.")
        self._parse_fetchxml(text)

    @staticmethod
    def _parse_fetchxml(text: Any) -> ET.Element:
        if not isinstance(text, str) or not text.strip() or len(text) > _FETCHXML_MAX_CHARS:
            raise ValueError(f"fetchxml must be one <fetch> query of at most {_FETCHXML_MAX_CHARS} characters.")
        if "<!" in text or "<?" in text.lstrip()[2:]:
            raise ValueError("fetchxml may not contain comments, DOCTYPE, entity or CDATA declarations.")
        try:
            root = ET.fromstring(text.strip())
        except ET.ParseError as exc:
            raise ValueError(f"fetchxml is not well-formed XML: {exc}") from exc
        if root.tag != "fetch":
            raise ValueError("fetchxml must have a <fetch> root element.")
        entities = root.findall("entity")
        if len(entities) != 1 or not entities[0].get("name"):
            raise ValueError("fetchxml must contain exactly one <entity name='...'> element.")
        return root

    def _run_fetchxml(self, text: str, limit: int) -> pa.Table:
        root = self._parse_fetchxml(text)
        entity_set = self._entity(root.find("entity").get("name"))["EntitySetName"]
        aggregate = str(root.get("aggregate") or "").lower() == "true"
        top = root.get("top")
        if not aggregate:
            limit = min(limit, int(top)) if top and top.isdigit() else limit
            root.attrib.pop("top", None)
            root.set("count", str(min(_PAGE_SIZE, limit)))
            root.set("page", "1")
        rows: list[dict[str, Any]] = []
        while True:
            payload = self._request(entity_set, {"fetchXml": ET.tostring(root, encoding="unicode")})
            rows.extend(payload.get("value") or [])
            if aggregate or len(rows) >= limit or not payload.get("@Microsoft.Dynamics.CRM.morerecords"):
                break
            page = int(root.get("page") or 1) + 1
            cookie = payload.get("@Microsoft.Dynamics.CRM.fetchxmlpagingcookie") or ""
            match = re.search(r'pagingcookie="([^"]*)"', cookie)
            if match:
                root.set("paging-cookie", urllib.parse.unquote(urllib.parse.unquote(match.group(1))))
            root.set("page", str(page))
            self._report_progress(f"Loaded {len(rows):,} rows from {entity_set}…")
        return self._fetch_rows_to_arrow(rows[:limit])

    def _fetch_rows_to_arrow(self, rows: list[dict[str, Any]]) -> pa.Table:
        """Convert FetchXML rows (which omit null values) into columns, adding labels for lookups and choices."""
        keys = list(dict.fromkeys(key for row in rows for key in row if "@" not in key))
        columns: dict[str, list[Any]] = {}
        for key in keys:
            lookup = re.fullmatch(r"_(.+)_value", key)
            name = (lookup.group(1) if lookup else key).replace(".", "_")
            values = [row.get(key) for row in rows]
            columns[name] = values
            labels = [row.get(key + _FORMATTED) for row in rows]
            if lookup or (any(isinstance(v, int) and not isinstance(v, bool) for v in values)
                          and any(isinstance(label, str) and not re.fullmatch(r"-?[\d,.\s]+", label) for label in labels)):
                columns[name + "name" if name + "name" not in keys else name + "_name"] = labels
        arrays = {}
        for name, values in columns.items():
            present = [v for v in values if v is not None]
            if present and all(isinstance(v, bool) for v in present):
                kind = "bool"
            elif present and all(isinstance(v, int) and not isinstance(v, bool) for v in present):
                kind = "int"
            elif present and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in present):
                kind = "float"
            elif present and all(isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", v) for v in present):
                kind = "datetime"
            else:
                kind = "string"
            arrays[name] = self._column_array(values, kind)
        return pa.table(arrays)
