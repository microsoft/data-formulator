# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Install the Power Apps demo (``powerapps``) into the sites folder; see README.md.

Reads the sales tables of a Dataverse environment (accounts and opportunities) with the Dataverse
loader, as the deployment's Dataverse connector (id ``dataverse``) loads them, into one Data Formulator
session (the ``sales`` starter): its tables keep their Dataverse source, so visitors can refresh them
from it. Then it makes one session per example analysis (story): the dataset plus the story's seed from
stories/<id>/ (see make_stories.py). It installs those sessions with profile.yaml, the analyst's demo
guidance (skill/) and the front-page images (assets/) into ``<sites dir>/powerapps/`` (default
``DF_SITES_DIR``). No AI models are involved.

    uv run python py-src/data_formulator/demos/powerapps/build.py
    uv run python py-src/data_formulator/demos/powerapps/build.py --sites-dir /srv/df-sites

Dataverse is read with the Azure identity at hand (``az login``, or a managed identity on a server),
which needs read access to the environment's accounts and opportunities.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path
from typing import Callable

import yaml

from data_formulator.datalake.workspace_manager import WorkspaceManager
from data_formulator.sites import sites_dir
from data_formulator.sites.builder import InstallError, build_stories, dataset_state, finish, save_session

HERE = Path(__file__).resolve().parent
PROFILE = HERE / "profile.yaml"
SITE_ID = "powerapps"
# The deployment's Dataverse connector (DF_SOURCES__dataverse__*): the sessions' tables refresh through it.
CONNECTOR_ID = "dataverse"
DEFAULT_ENVIRONMENT = "https://org56805191.crm.dynamics.com"

# Each table: its Dataverse logical name (also its name in the session), the columns read, and what it holds.
TABLES = {
    "account": (
        ["accountid", "name", "address1_city", "address1_stateorprovince", "address1_country",
         "address1_latitude", "address1_longitude", "cr746_salesregionname", "industrycodename", "revenue",
         "numberofemployees"],
        "Accounts (customers), one row per account: accountid (its id), name, address1_city, "
        "address1_stateorprovince, address1_country, address1_latitude / address1_longitude (where it is, for "
        "maps), cr746_salesregionname (its sales region: North America West, North America East, Latin America, "
        "Europe, Asia Pacific), industrycodename (industry), revenue (annual revenue, USD) and numberofemployees."),
    "cr746_opportunity": (
        ["cr746_opportunityid", "cr746_name", "cr746_accountid", "cr746_accountidname", "cr746_estimatedvalue",
         "cr746_probability", "cr746_outcomename", "cr746_salesstagename", "cr746_productlinename",
         "cr746_leadsourcename", "cr746_estimatedclosedate", "cr746_actualclosedate", "createdon"],
        "Sales opportunities (deals), one row per opportunity: cr746_name, cr746_accountid (the account's "
        "accountid; cr746_accountidname is its name), cr746_estimatedvalue (USD), cr746_probability (0–100), "
        "cr746_outcomename (Open, Won or Lost), cr746_salesstagename (Qualify, Develop, Propose, Close), "
        "cr746_productlinename (Cloud Platform, Analytics, Security, Services), cr746_leadsourcename (Web, "
        "Referral, Partner, Event, Outbound), cr746_estimatedclosedate, cr746_actualclosedate (won and lost "
        "deals only) and createdon."),
}

STARTERS = {"sales": ["account", "cr746_opportunity"]}


def environment_url(value: str | None = None) -> str:
    """The Dataverse environment: given, else the deployment's connector setting, else the demo's own."""
    return (value or os.environ.get(f"DF_SOURCES__{CONNECTOR_ID}__params__environment_url") or DEFAULT_ENVIRONMENT)


def dataverse(url: str):
    """A Dataverse loader signed in with the Azure identity at hand."""
    from data_formulator.data_loader.dataverse_data_loader import DataverseDataLoader
    params = {"environment_url": url, "_auth_path": "ambient"}
    DataverseDataLoader.validate_params(params)
    loader = DataverseDataLoader(params)
    loader.test_connection()
    return loader


def data_guide(starter: dict, profile: dict, tables: list[tuple[str, int]]) -> str:
    steps = [
        "Join opportunities to accounts on cr746_opportunity.cr746_accountid = account.accountid.",
        "Show labels, not ids: the columns ending in `name` (cr746_outcomename, cr746_salesstagename, "
        "cr746_productlinename, cr746_leadsourcename, cr746_accountidname, cr746_salesregionname, "
        "industrycodename) hold what Power Apps shows.",
        "Open pipeline is the estimated value of Open opportunities; weighted pipeline multiplies each by "
        "cr746_probability / 100.",
        "Win rate is Won / (Won + Lost) opportunities; open ones are not closed yet. Date won and lost deals "
        "by cr746_actualclosedate, open ones by cr746_estimatedclosedate.",
        "For a world map, use the map skill (`write_map`): bubbles at address1_latitude / "
        "address1_longitude.",
        "Never show Dataverse logical names in answers, charts, maps or apps: say Accounts, Opportunities, "
        "Estimated value, Sales stage, Product line, Lead source.",
        "Cite the source with each result: \"Source: Dataverse (Power Apps)\".",
    ]
    lines = [
        f"# Data guide: {starter['title']}", "", f"Source: {profile['attribution'].strip()}", "",
        f"These tables came from the Dataverse connector (`{CONNECTOR_ID}`): refreshing one reads it from "
        "Dataverse again. Other Dataverse tables load from the connector.", "", "## Tables", "",
        *[f"- `{name}` ({rows:,} rows): {TABLES[name][1]}" for name, rows in tables], "",
        "## How to answer questions", "", *[f"{n}. {step}" for n, step in enumerate(steps, 1)], "",
    ]
    return "\n".join(lines)


def build_starter(starter: dict, profile: dict, loader, work: Path, out: Path) -> Path:
    workspace = WorkspaceManager(work / "sessions").create_and_open_workspace(starter["id"], "local:site-builder")
    tables = []
    for name in STARTERS[starter["id"]]:
        columns, description = TABLES[name]
        meta = loader.ingest_to_workspace(workspace, name, name, {"columns": columns, "size": 5000})
        meta.description = description
        workspace.add_table_metadata(meta)
        tables.append((name, meta.row_count))
    workspace.save_workspace_file(data_guide(starter, profile, tables).encode("utf-8"), "Sales data guide.md",
                                  "text/markdown")
    # Its tables as loaded from the Dataverse connector, so they refresh from it.
    state = dataset_state(workspace, starter, [name for name, _ in tables], connector_id=CONNECTOR_ID,
                          source_table=lambda name: name, loader_type="DataverseDataLoader")
    target = save_session(workspace, state, out / starter["file"])
    for name, rows in tables:
        _log(f"  {name}: {rows:,} rows")
    return target


_log: Callable[[str], None] = print


def install(sites: Path | None = None, environment: str | None = None, *, log: Callable[[str], None] = print) -> Path:
    """Build and install the demo into ``<sites>/powerapps/``; returns that folder. The dataset is read from
    Dataverse again each time, and the story sessions are assembled again."""
    global _log
    _log = log
    try:
        profile = yaml.safe_load(PROFILE.read_text(encoding="utf-8"))
        site = (sites or sites_dir()).expanduser() / SITE_ID
        content = site / str(profile["release"])
        url = environment_url(environment)
        try:
            loader = dataverse(url)
        except Exception as exc:
            raise InstallError(f"cannot read Dataverse at {url} ({exc}); sign in with `az login` as a user of the "
                               "environment, or run where the server's identity can read it") from exc
        with tempfile.TemporaryDirectory(prefix="powerapps-build-") as tmp:
            for starter in profile["starters"]:
                log(f"building {starter['id']} from {url}")
                target = build_starter(starter, profile, loader, Path(tmp), content)
                log(f"  -> {target.name} ({target.stat().st_size / 2**20:.1f} MB)")
            build_stories(HERE, profile, profile["starters"], Path(tmp), content, log)
        return finish(HERE, profile, site, log=log)
    finally:
        _log = print


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sites-dir", type=Path, help="where to install (default: DF_SITES_DIR)")
    parser.add_argument("--environment-url", help=f"the Dataverse environment (default: {DEFAULT_ENVIRONMENT})")
    args = parser.parse_args()
    try:
        install(args.sites_dir, args.environment_url)
    except InstallError as exc:
        sys.exit(f"{SITE_ID}: {exc}")


if __name__ == "__main__":
    main()
