# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from __future__ import annotations

import urllib.parse
from datetime import datetime
from types import SimpleNamespace

import pytest

from data_formulator.data_loader import dataverse_data_loader as dv
from data_formulator.data_loader.dataverse_data_loader import DataverseDataLoader, EnvironmentAuth

pytestmark = [pytest.mark.backend]

_ORG = "https://contoso.crm.dynamics.com"
_TENANT = "11111111-2222-3333-4444-555555555555"
_ACCOUNT = "aaaaaaaa-0000-0000-0000-000000000001"
_FMT = "@OData.Community.Display.V1.FormattedValue"


def _label(text):
    return {"UserLocalizedLabel": {"Label": text}}


_ENTITIES = [
    {"LogicalName": "opportunity", "EntitySetName": "opportunities", "DisplayName": _label("Opportunity"),
     "PrimaryIdAttribute": "opportunityid", "PrimaryNameAttribute": "name"},
    {"LogicalName": "account", "EntitySetName": "accounts", "DisplayName": _label("Account"),
     "PrimaryIdAttribute": "accountid", "PrimaryNameAttribute": "name"},
]
_ATTRIBUTES = [
    {"LogicalName": "opportunityid", "AttributeType": "Uniqueidentifier"},
    {"LogicalName": "name", "AttributeType": "String", "DisplayName": _label("Topic")},
    {"LogicalName": "estimatedvalue", "AttributeType": "Money"},
    {"LogicalName": "estimatedclosedate", "AttributeType": "DateTime"},
    {"LogicalName": "statecode", "AttributeType": "State"},
    {"LogicalName": "statecodename", "AttributeType": "Virtual", "AttributeOf": "statecode"},
    {"LogicalName": "parentaccountid", "AttributeType": "Lookup"},
    {"LogicalName": "parentaccountidname", "AttributeType": "String", "AttributeOf": "parentaccountid"},
    {"LogicalName": "customerid", "AttributeType": "Customer"},
    {"LogicalName": "tags", "AttributeType": "Virtual", "AttributeTypeName": {"Value": "MultiSelectPicklistType"}},
    {"LogicalName": "entityimage", "AttributeType": "Virtual", "AttributeTypeName": {"Value": "ImageType"}},
    {"LogicalName": "secret", "AttributeType": "String", "IsValidForRead": False},
]
_RELATIONSHIPS = [
    {"ReferencingAttribute": "parentaccountid", "ReferencedEntity": "account", "ReferencedAttribute": "accountid",
     "ReferencingEntityNavigationPropertyName": "parentaccountid"},
    {"ReferencingAttribute": "customerid", "ReferencedEntity": "account", "ReferencedAttribute": "accountid",
     "ReferencingEntityNavigationPropertyName": "customerid_account"},
    {"ReferencingAttribute": "customerid", "ReferencedEntity": "contact", "ReferencedAttribute": "contactid",
     "ReferencingEntityNavigationPropertyName": "customerid_contact"},
]


@pytest.fixture
def loader(monkeypatch):
    monkeypatch.setattr(dv, "discover_environment_auth", lambda origin: EnvironmentAuth(_TENANT, origin))
    monkeypatch.setattr("azure.identity.DefaultAzureCredential", lambda **_: None)
    instance = DataverseDataLoader({"environment_url": "contoso.crm.dynamics.com"})
    monkeypatch.setattr(instance._tokens, "token", lambda: "token")
    instance.calls = []
    instance.pages = []

    def get(url, params=None, timeout=None, headers=None):
        instance.calls.append((url, params, headers))
        path = url.removeprefix(_ORG + "/api/data/v9.2/")
        if path == "EntityDefinitions":
            payload = {"value": _ENTITIES}
        elif path.endswith("/ManyToOneRelationships"):
            payload = {"value": _RELATIONSHIPS}
        elif path.endswith("StateAttributeMetadata"):
            payload = {"value": [{"LogicalName": "statecode", "OptionSet": {"Options": [
                {"Value": 0, "Label": _label("Open")}, {"Value": 1, "Label": _label("Won")},
                {"Value": 2, "Label": _label("Lost")}]}}]}
        elif "Attributes/" in path:
            payload = {"value": []}
        elif path.endswith("/Attributes"):
            payload = {"value": _ATTRIBUTES}
        else:
            payload = instance.pages.pop(0)
        return SimpleNamespace(status_code=200, headers={}, json=lambda: payload)

    monkeypatch.setattr(instance._session, "get", get)
    return instance


def test_metadata_adds_label_columns_and_lookup_joins(loader):
    metadata = loader.get_metadata(["opportunity"])
    columns = {column["name"]: column for column in metadata["columns"]}

    assert list(columns)[:2] == ["opportunityid", "name"]
    assert {"statecodename", "parentaccountidname", "customeridtype", "tagsname"} <= set(columns)
    assert "statecode_name" not in columns and "entityimage" not in columns and "secret" not in columns
    assert "0=Open; 1=Won; 2=Lost" in columns["statecode"]["description"]
    assert "account.accountid" in columns["parentaccountid"]["description"]
    assert {"from": "opportunity.parentaccountid", "to": "account.accountid"} in metadata["relationships"]


def test_fetch_pushes_filters_and_converts_labels(loader):
    loader.pages = [{"value": [{
        "name": "Big deal", "statecode": 0, "statecode" + _FMT: "Open", "estimatedvalue": 1200.5,
        "estimatedclosedate": "2026-03-01T08:00:00Z", "_parentaccountid_value": _ACCOUNT,
        "_parentaccountid_value" + _FMT: "Contoso",
    }]}]
    table = loader.fetch_data_as_arrow("opportunity", {
        "size": 10,
        "columns": ["name", "statecodename", "estimatedvalue", "estimatedclosedate", "parentaccountid", "parentaccountidname"],
        "source_filters": [
            {"column": "statecodename", "operator": "IN", "value": ["Open", "won"]},
            {"column": "parentaccountidname", "operator": "EQ", "value": "O'Neil"},
            {"column": "estimatedclosedate", "operator": "GTE", "value": "2026-01-01T09:00:00+02:00"},
        ],
    })

    params = loader.calls[-1][1]
    assert params["$top"] == 10
    assert params["$select"] == "name,statecode,estimatedvalue,estimatedclosedate,_parentaccountid_value"
    assert params["$filter"] == ("(statecode eq 0 or statecode eq 1) and (parentaccountid/name eq 'O''Neil') "
                                 "and (estimatedclosedate ge 2026-01-01T07:00:00Z)")
    assert table.to_pylist() == [{
        "name": "Big deal", "statecodename": "Open", "estimatedvalue": 1200.5,
        "estimatedclosedate": datetime(2026, 3, 1, 8, 0), "parentaccountid": _ACCOUNT, "parentaccountidname": "Contoso",
    }]


def test_fetch_follows_next_links_within_the_environment(loader, monkeypatch):
    monkeypatch.setattr(dv, "_PAGE_SIZE", 2)
    next_link = _ORG + "/api/data/v9.2/opportunities?$skiptoken=abc"
    loader.pages = [{"value": [{"name": "a"}, {"name": "b"}], "@odata.nextLink": next_link},
                    {"value": [{"name": "c"}, {"name": "d"}], "@odata.nextLink": next_link}]

    table = loader.fetch_data_as_arrow("opportunity", {"size": 3, "columns": ["name"]})

    assert table.column("name").to_pylist() == ["a", "b", "c"]
    assert "$top" not in loader.calls[-2][1] and "odata.maxpagesize=2" in loader.calls[-2][2]["Prefer"]
    assert loader.calls[-1][0] == next_link
    loader.pages = [{"value": [], "@odata.nextLink": "https://evil.example/api/data/v9.2/x"}, {"value": []}]
    with pytest.raises(ValueError, match="outside the environment"):
        loader.fetch_data_as_arrow("opportunity", {"size": 5, "columns": ["name"]})


def test_grouped_query_runs_locally_and_refuses_truncated_input(loader, monkeypatch):
    rows = [{"statecode": 0, "statecode" + _FMT: "Open", "estimatedvalue": 10.0},
            {"statecode": 0, "statecode" + _FMT: "Open", "estimatedvalue": 5.0},
            {"statecode": 1, "statecode" + _FMT: "Won", "estimatedvalue": 7.0}]
    loader.pages = [{"value": rows}]
    query = {"group_by": ["statecodename"], "aggregates": [{"op": "sum", "column": "estimatedvalue", "as": "pipeline"}],
             "filters": [{"column": "statecodename", "op": "NEQ", "value": "Lost"}],
             "order_by": [{"column": "pipeline", "dir": "desc"}]}

    assert loader.query_data_as_arrow("opportunity", query, 10).to_pylist() == [
        {"statecodename": "Open", "pipeline": 15.0}, {"statecodename": "Won", "pipeline": 7.0}]
    assert loader.calls[-1][1]["$filter"] == "(statecode ne 2)"

    monkeypatch.setattr(dv, "_AGGREGATE_SCAN_ROWS", 2)
    loader.pages = [{"value": rows}]
    with pytest.raises(ValueError, match="More than 2 rows match"):
        loader.query_data_as_arrow("opportunity", query, 10)


def test_fetchxml_pages_with_cookie_and_flattens_joined_columns(loader):
    cookie = '<cookie page="1"><opportunityid last="{X}" /></cookie>'
    encoded = urllib.parse.quote(urllib.parse.quote(cookie))
    loader.pages = [
        {"value": [{"name": "a", "acct.address1_stateorprovince": "WA", "statecode": 0, "statecode" + _FMT: "Open"}],
         "@Microsoft.Dynamics.CRM.morerecords": True,
         "@Microsoft.Dynamics.CRM.fetchxmlpagingcookie": f'<cookie pagenumber="2" pagingcookie="{encoded}" istracking="False" />'},
        {"value": [{"name": "b", "_parentaccountid_value": _ACCOUNT, "_parentaccountid_value" + _FMT: "Contoso"}]},
    ]
    text = ("<fetch top='50'><entity name='opportunity'><attribute name='name'/><link-entity name='account' "
            "from='accountid' to='parentaccountid' alias='acct'><attribute name='address1_stateorprovince'/>"
            "</link-entity></entity></fetch>")

    table = loader.query_data_as_arrow("opportunity", {"native": {"language": "fetchxml", "text": text}}, 100)

    second = loader.calls[-1][1]["fetchXml"]
    assert loader.calls[-1][0].endswith("/opportunities")
    assert 'page="2"' in second and 'count="50"' in second and "top=" not in second
    assert f'paging-cookie="{cookie.replace(chr(34), "&quot;").replace("<", "&lt;").replace(">", "&gt;")}"' in second
    assert table.to_pylist() == [
        {"name": "a", "acct_address1_stateorprovince": "WA", "statecode": 0, "statecodename": "Open",
         "parentaccountid": None, "parentaccountidname": None},
        {"name": "b", "acct_address1_stateorprovince": None, "statecode": None, "statecodename": None,
         "parentaccountid": _ACCOUNT, "parentaccountidname": "Contoso"},
    ]


@pytest.mark.parametrize("text", [
    "<!DOCTYPE fetch [<!ENTITY x 'y'>]><fetch><entity name='account'/></fetch>",
    "<fetch><entity name='account'/><entity name='contact'/></fetch>",
    "<query><entity name='account'/></query>",
])
def test_fetchxml_validation_rejects_unsafe_or_ambiguous_queries(loader, text):
    with pytest.raises(ValueError):
        loader.validate_native_query("fetchxml", text)


@pytest.mark.parametrize("url", ["https://evil.example.com", "http://contoso.crm.dynamics.com", "https://a.crm.dynamics.com:8443"])
def test_environment_url_must_be_a_dataverse_host(url):
    with pytest.raises(ValueError):
        dv.normalize_environment_url(url)


def test_discovery_reads_tenant_from_challenge(monkeypatch):
    dv._discovery_cache.clear()
    header = (f'Bearer authorization_uri=https://login.microsoftonline.com/{_TENANT}/oauth2/authorize, '
              'resource_id=https://contoso.api.crm.dynamics.com/')
    monkeypatch.setattr(dv.requests, "get", lambda *a, **k: SimpleNamespace(headers={"WWW-Authenticate": header}))

    auth = dv.discover_environment_auth(_ORG)

    assert auth.tenant_id == _TENANT
    assert auth.scope == "https://contoso.api.crm.dynamics.com/.default"


def test_ambient_token_targets_environment_tenant(monkeypatch):
    requested = {}

    class Credential:
        def __init__(self, **kwargs):
            requested["allowed"] = kwargs.get("additionally_allowed_tenants")

        def get_token(self, scope, tenant_id=None):
            requested.update(scope=scope, tenant=tenant_id)
            return SimpleNamespace(token="t", expires_on=9_999_999_999)

    monkeypatch.setattr(dv, "discover_environment_auth", lambda origin: EnvironmentAuth(_TENANT, origin))
    monkeypatch.setattr("azure.identity.DefaultAzureCredential", Credential)

    assert DataverseDataLoader({"environment_url": _ORG})._tokens.token() == "t"
    assert requested == {"allowed": ["*"], "scope": _ORG + "/.default", "tenant": _TENANT}


def test_browser_sign_in_reuses_record_without_prompting_and_resets_when_expired(monkeypatch, tmp_path):
    import azure.identity as identity

    record_path = tmp_path / "contoso.json"
    record_path.write_text("record", encoding="utf-8")
    created = []

    class Credential:
        def __init__(self, **kwargs):
            created.append(kwargs)

        def get_token(self, scope):
            if created[-1].get("expired"):
                raise identity.AuthenticationRequiredError(scopes=[scope])
            return SimpleNamespace(token="t", expires_on=9_999_999_999)

    monkeypatch.setattr(dv, "_local_mode", lambda: True)
    monkeypatch.setattr(dv, "_browser_record_path", lambda origin: record_path)
    monkeypatch.setattr(dv, "discover_environment_auth", lambda origin: EnvironmentAuth(_TENANT, origin))
    monkeypatch.setattr(identity, "InteractiveBrowserCredential", Credential)
    monkeypatch.setattr(identity.AuthenticationRecord, "deserialize",
                        staticmethod(lambda text: SimpleNamespace(username="me@contoso.com")))
    params = {"environment_url": _ORG, "_auth_path": "browser_sign_in", "login_hint": "me@contoso.com"}

    assert DataverseDataLoader(params)._tokens.token() == "t"
    assert created[-1]["disable_automatic_authentication"] is True and created[-1]["tenant_id"] == _TENANT

    monkeypatch.setattr(Credential, "__init__", lambda self, **kw: created.append({**kw, "expired": True}))
    with pytest.raises(PermissionError, match="connect again"):
        DataverseDataLoader(params)._tokens.token()
    assert not record_path.exists()
