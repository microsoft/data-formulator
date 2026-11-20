# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The Finance toolkit's MCP server: company financials and filings, economic series and stock prices.

Started by Data Formulator over stdio (``python -m data_formulator.tool_packs.finance``). Its sources:

- SEC EDGAR (no key): companies, their filings, and the figures they report in them (XBRL "company facts"). The SEC
  asks automated clients to name a contact email in their User-Agent and to stay under 10 requests a second; requests
  without one are refused, so the toolkit is added with the user's email (``--email``).
- FRED (St. Louis Fed): any series by id needs no key; searching series by keyword needs the user's free key
  (``FRED_API_KEY``, from the credential vault).
- Twelve Data: stock prices, with the user's free key (``TWELVE_DATA_API_KEY``; 8 requests a minute, 800 a day).

Results are JSON tables the agent can load with ``create_data``; answers are cached on disk.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import time
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Literal

import httpx
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from data_formulator.tool_packs.cache import DiskCache, Response

SEC_TICKERS = "https://www.sec.gov/files/company_tickers.json"
SEC_FACTS = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
SEC_SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
SEC_ARCHIVE = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{document}"
FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"
FRED_API = "https://api.stlouisfed.org/fred"
TWELVE_DATA = "https://api.twelvedata.com/time_series"

TTL_DAY = 24 * 3600
TTL_PRICES = 6 * 3600
SEC_INTERVAL = 0.12
MAX_LIMIT = 50
MAX_SERIES = 10
MAX_SYMBOLS = 5
READ_TIMEOUT = 30.0

INSTRUCTIONS = """\
Company financials and filings (SEC EDGAR: companies filing with the SEC), economic series (FRED) and stock prices
(Twelve Data).
- find_company resolves a name or ticker to the company the SEC knows; the other company tools take a ticker, name or CIK.
- company_financials returns reported figures (revenue, income, EPS, cash flow, balance sheet) as a tidy table, annual or
  quarterly. A quarterly Q4 is derived (the year minus its first three quarters) and flagged. Figures are as filed, in the
  company's reporting currency, and fiscal years can end in any month: say so when comparing companies.
- list_filings lists recent 10-K, 10-Q, 8-K and other filings, with links.
- economic_series fetches FRED series by id, e.g. UNRATE (unemployment rate), CPIAUCSL (CPI), FEDFUNDS, DGS10 (10-year
  Treasury yield), GDP, PAYEMS (payrolls); search_economic_series finds ids by keyword (it needs a FRED key).
- stock_prices returns daily, weekly or monthly prices (it needs a Twelve Data key; each symbol uses one free credit).
- Results are JSON tables: load a large one with create_data, then chart it, and cite the source (SEC filings, FRED,
  Twelve Data). If a tool asks for a key, tell the user to add it to the Finance toolkit in Tools."""

READ_ONLY = ToolAnnotations(read_only_hint=True, idempotent_hint=True, open_world_hint=True)
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SERIES = re.compile(r"^[A-Za-z0-9_.-]{1,40}$")
_SYMBOL = re.compile(r"^[A-Za-z0-9.:/^=-]{1,20}$")

# A metric and the XBRL concepts that report it, across US GAAP, IFRS and the cover page ("dei"). Companies change
# concepts over the years (revenue especially): every listed one counts, and each period keeps its latest filing.
METRICS: dict[str, tuple[str, list[str]]] = {
    "revenue": ("money", ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
                          "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenue"]),
    "gross_profit": ("money", ["GrossProfit"]),
    "operating_income": ("money", ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"]),
    "net_income": ("money", ["NetIncomeLoss", "ProfitLossAttributableToOwnersOfParent", "ProfitLoss"]),
    "eps_diluted": ("per_share", ["EarningsPerShareDiluted", "DilutedEarningsLossPerShare"]),
    "rd_expense": ("money", ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"]),
    "operating_cash_flow": ("money", ["NetCashProvidedByUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivities"]),
    "capital_expenditure": ("money", ["PaymentsToAcquirePropertyPlantAndEquipment",
                                      "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"]),
    "total_assets": ("money", ["Assets"]),
    "total_liabilities": ("money", ["Liabilities"]),
    "shareholders_equity": ("money", ["StockholdersEquity", "Equity",
                                      "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]),
    "cash": ("money", ["CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalents"]),
    "long_term_debt": ("money", ["LongTermDebtNoncurrent", "LongTermDebt", "NoncurrentPortionOfNoncurrentBorrowings"]),
    "shares_outstanding": ("shares", ["EntityCommonStockSharesOutstanding"]),
}
DEFAULT_METRICS = ["revenue", "gross_profit", "operating_income", "net_income", "eps_diluted", "operating_cash_flow",
                   "total_assets", "shareholders_equity"]
# Values over a period (income, cash flow) as opposed to balances at a date.
_UNITS = {"money": re.compile(r"^[A-Z]{3}$"), "per_share": re.compile(r"^[A-Z]{3}/shares$"), "shares": re.compile(r"^shares$")}
_INSTANT = {"total_assets", "total_liabilities", "shareholders_equity", "cash", "long_term_debt", "shares_outstanding"}
_ANNUAL_FORMS = ("10-K", "20-F", "40-F")


class FinanceError(ToolError):
    """A failure the agent should read (the MCP SDK shows a ``ToolError``'s message to the model)."""


class Client:
    """The sources' HTTP APIs, cached. Keys go in the request, never in the cache key."""

    def __init__(self, cache_dir: Path | None = None, *, email: str | None = None, fred_key: str | None = None,
                 twelve_data_key: str | None = None, transport: httpx.BaseTransport | None = None) -> None:
        self.email = (email or "").strip() or None
        self.fred_key = (fred_key or "").strip() or None
        self.twelve_data_key = (twelve_data_key or "").strip() or None
        self._cache = DiskCache(cache_dir)
        self._last_sec = 0.0
        self._http = httpx.Client(transport=transport, follow_redirects=True, timeout=httpx.Timeout(READ_TIMEOUT, connect=10.0))

    def get(self, url: str, params: dict[str, Any] | None = None, *, ttl: float | None, secret: dict[str, str] | None = None,
            source: Literal["sec", "fred", "twelvedata"]) -> bytes:
        cached = str(httpx.URL(url, params=params or {}))
        if (hit := self._cache.get(cached, ttl)) is not None:
            return hit.content
        headers = {"User-Agent": "DataFormulator-Finance/1.0 (+https://github.com/microsoft/data-formulator)"}
        if source == "sec":
            if not self.email:
                raise FinanceError("The SEC asks for a contact email with each request. Ask the user to add the Finance "
                                   "toolkit again in Tools with their email.")
            headers = {"User-Agent": f"DataFormulator-Finance/1.0 {self.email}"}
            # The SEC allows 10 requests a second.
            time.sleep(max(0.0, self._last_sec + SEC_INTERVAL - time.monotonic()))
            self._last_sec = time.monotonic()
        try:
            reply = self._http.get(url, params={**(params or {}), **(secret or {})}, headers=headers)
        except httpx.HTTPError as exc:
            raise FinanceError(f"Could not reach {_SOURCE_NAMES[source]} ({type(exc).__name__}). Try again in a moment.") from None
        if reply.status_code == 200:
            self._cache.put(cached, Response(200, reply.content, dict(reply.headers), cached))
            return reply.content
        raise _failure(reply, source)

    def close(self) -> None:
        self._http.close()


_SOURCE_NAMES = {"sec": "the SEC", "fred": "FRED", "twelvedata": "Twelve Data"}


def _failure(reply: httpx.Response, source: str) -> FinanceError:
    name = _SOURCE_NAMES[source]
    if source == "twelvedata":
        try:
            return _twelve_data_error(reply.json(), "")
        except ValueError:
            pass
    if reply.status_code == 429:
        return FinanceError(f"{name} is rate-limiting these requests: wait {reply.headers.get('retry-after', 'a minute')} "
                            "seconds before asking again.")
    if source == "sec" and reply.status_code == 403:
        return FinanceError("The SEC refused the request (it limits automated clients to 10 requests a second, with a "
                            "contact email). Wait a minute and try again.")
    if reply.status_code == 404:
        return FinanceError(f"Not found at {name}.")
    return FinanceError(f"{name} answered HTTP {reply.status_code}.")


_client: Client | None = None


def client() -> Client:
    global _client
    if _client is None:
        _client = Client(email=os.environ.get("SEC_CONTACT_EMAIL"), fred_key=os.environ.get("FRED_API_KEY"),
                         twelve_data_key=os.environ.get("TWELVE_DATA_API_KEY"))
    return _client


def _date(value: str, name: str) -> str:
    value = str(value or "").strip()
    if value and not _DATE.match(value):
        raise FinanceError(f"Give {name} as YYYY-MM-DD, not {value!r}.")
    return value


# -- companies (SEC EDGAR) --

def _companies() -> list[dict[str, Any]]:
    data = json.loads(client().get(SEC_TICKERS, ttl=TTL_DAY, source="sec"))
    return [{"ticker": item["ticker"], "name": item["title"], "cik": int(item["cik_str"])} for item in data.values()]


def _matches(query: str) -> list[dict[str, Any]]:
    text = query.strip()
    if not text:
        return []
    if text.isdigit():
        cik = int(text)
        return [item for item in _companies() if item["cik"] == cik] or [{"ticker": None, "name": None, "cik": cik}]
    ticker = text.upper().replace(".", "-")
    words = text.lower().split()
    ranked = []
    for item in _companies():
        name = item["name"].lower()
        rank = (0 if item["ticker"] == ticker else 1 if item["ticker"].startswith(ticker) and len(ticker) > 1
                else 2 if name.startswith(text.lower()) else 3 if all(word in name for word in words) else None)
        if rank is not None:
            ranked.append((rank, len(item["name"]), item))
    return [item for _, _, item in sorted(ranked, key=lambda entry: entry[:2])]


def resolve(company: str) -> dict[str, Any]:
    found = _matches(company)
    if not found:
        raise FinanceError(f"No company filing with the SEC matches {company!r}. Try find_company with part of its name.")
    return found[0]


def _facts(cik: int) -> dict[str, Any]:
    try:
        return json.loads(client().get(SEC_FACTS.format(cik=cik), ttl=TTL_DAY, source="sec"))
    except FinanceError as exc:
        if "Not found" in str(exc):
            raise FinanceError("The SEC has no financial statement data for this company (it may not file 10-K or "
                               "10-Q reports).") from None
        raise


def _reported(facts: dict[str, Any], metric: str) -> list[dict[str, Any]]:
    """Every value reported for ``metric``, in its one most-used unit (the reporting currency)."""
    kind, concepts = METRICS[metric]
    items = []
    for namespace in ("us-gaap", "ifrs-full", "dei"):
        for concept in concepts:
            for unit, values in ((facts.get(namespace) or {}).get(concept) or {}).get("units", {}).items():
                if _UNITS[kind].match(unit):
                    items += [{**value, "unit": unit, "concept": concept} for value in values]
    if items:
        unit = Counter(item["unit"] for item in items).most_common(1)[0][0]
        items = [item for item in items if item["unit"] == unit]
    return items


def _periods(items: list[dict[str, Any]], period: str, instant: bool) -> list[dict[str, Any]]:
    """One value per period (the latest filed), of a year or a quarter, or balances at a year's or quarter's end."""
    best: dict[tuple[str, str], dict[str, Any]] = {}
    for item in items:
        start = item.get("start")
        if instant:
            if start or (period == "annual" and not str(item.get("form", "")).startswith(_ANNUAL_FORMS)):
                continue
        else:
            if not start:
                continue
            days = (date.fromisoformat(item["end"]) - date.fromisoformat(start)).days
            if not (340 <= days <= 390 if period == "annual" else 80 <= days <= 100):
                continue
        key = (start or "", item["end"])
        if key not in best or item.get("filed", "") > best[key].get("filed", ""):
            best[key] = item
    return sorted(best.values(), key=lambda item: item["end"])


def _fourth_quarters(quarters: list[dict[str, Any]], years: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Q4s, which companies report only within the year: the year minus its first three quarters."""
    derived = []
    for year in years:
        inside = [item for item in quarters if item["start"] >= year["start"] and item["end"] <= year["end"]]
        if len(inside) == 3 and all(item["end"] < year["end"] for item in inside):
            last = max(item["end"] for item in inside)
            derived.append({**year, "start": (date.fromisoformat(last) + timedelta(days=1)).isoformat(),
                            "val": year["val"] - sum(item["val"] for item in inside), "derived": True})
    return derived


def _quarter(end: str) -> str:
    day = date.fromisoformat(end)
    return f"{day.year}Q{(day.month - 1) // 3 + 1}"


# -- tools --

app = MCPServer("finance", instructions=INSTRUCTIONS)


@app.tool(annotations=READ_ONLY)
def find_company(query: str, limit: int = 10) -> dict[str, Any]:
    """Companies filing with the SEC that match a ticker (e.g. MSFT, BRK.B) or part of a name, best first, with their
    CIK (the SEC's id)."""
    found = _matches(query)[:max(1, min(MAX_LIMIT, int(limit)))]
    return {"query": query, "companies": found}


@app.tool(annotations=READ_ONLY)
def company_financials(company: str, metrics: list[str] | None = None, period: Literal["annual", "quarterly"] = "annual",
                       years: int = 10) -> dict[str, Any]:
    """A company's reported figures over the last `years` years, as a tidy table (one row per metric and period).
    `metrics` from: revenue, gross_profit, operating_income, net_income, eps_diluted, rd_expense, operating_cash_flow,
    capital_expenditure, total_assets, total_liabilities, shareholders_equity, cash, long_term_debt, shares_outstanding
    (a common set if none). `company` is a ticker, name or CIK. Each row has the period's dates and its `year` (the year
    the fiscal year ends) or `quarter` (the calendar quarter it ends in, so companies line up)."""
    chosen = list(dict.fromkeys(metrics or DEFAULT_METRICS))
    unknown = [metric for metric in chosen if metric not in METRICS]
    if unknown:
        raise FinanceError(f"Unknown metric {', '.join(map(repr, unknown))}; choose from: {', '.join(METRICS)}.")
    match = resolve(company)
    data = _facts(match["cik"])
    facts = data.get("facts") or {}
    rows: list[dict[str, Any]] = []
    missing = []
    for metric in chosen:
        reported = _reported(facts, metric)
        instant = metric in _INSTANT
        values = _periods(reported, period, instant)
        if period == "quarterly" and not instant and METRICS[metric][0] == "money":
            values = sorted(values + _fourth_quarters(values, _periods(reported, "annual", False)), key=lambda item: item["end"])
        if not values:
            missing.append(metric)
            continue
        latest = date.fromisoformat(values[-1]["end"]).year
        for item in values:
            if date.fromisoformat(item["end"]).year <= latest - max(1, int(years)):
                continue
            rows.append({"metric": metric, "period_start": item.get("start"), "period_end": item["end"],
                         **({"quarter": _quarter(item["end"])} if period == "quarterly" else {"year": int(item["end"][:4])}),
                         "value": item["val"], "unit": item["unit"], "form": item.get("form"), "filed": item.get("filed"),
                         "derived": bool(item.get("derived")), "concept": item["concept"]})
    return {"company": data.get("entityName") or match["name"], "ticker": match["ticker"], "cik": match["cik"],
            "period": period, "missing": missing, "rows": rows,
            "source": f"SEC EDGAR company facts, https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={match['cik']}"}


@app.tool(annotations=READ_ONLY)
def list_filings(company: str, form: str = "10-K", limit: int = 20) -> dict[str, Any]:
    """A company's recent SEC filings, newest first, with links: annual reports (10-K, 20-F), quarterly reports (10-Q),
    current reports (8-K), proxy statements (DEF 14A), or "any"."""
    match = resolve(company)
    data = json.loads(client().get(SEC_SUBMISSIONS.format(cik=match["cik"]), ttl=TTL_DAY, source="sec"))
    recent = (data.get("filings") or {}).get("recent") or {}
    wanted = form.strip().upper()
    filings = []
    for index, kind in enumerate(recent.get("form") or []):
        if wanted not in ("", "ANY") and kind != wanted and not kind.startswith(wanted + "/"):
            continue
        accession = recent["accessionNumber"][index]
        document = recent["primaryDocument"][index]
        filings.append({"form": kind, "filed": recent["filingDate"][index], "report_date": recent["reportDate"][index] or None,
                        "description": recent["primaryDocDescription"][index] or None,
                        "url": SEC_ARCHIVE.format(cik=match["cik"], accession=accession.replace("-", ""), document=document)})
        if len(filings) >= max(1, min(MAX_LIMIT, int(limit))):
            break
    return {"company": data.get("name"), "tickers": data.get("tickers"), "cik": match["cik"],
            "industry": data.get("sicDescription"), "fiscal_year_end": data.get("fiscalYearEnd"), "filings": filings}


# -- economic series (FRED) --

def _series_info(series: str) -> dict[str, Any] | None:
    key = client().fred_key
    if not key:
        return None
    try:
        data = json.loads(client().get(f"{FRED_API}/series", {"series_id": series, "file_type": "json"}, ttl=TTL_DAY,
                                       secret={"api_key": key}, source="fred"))
    except FinanceError:
        return None
    item = (data.get("seriess") or [{}])[0]
    return {"series": series, "title": item.get("title"), "units": item.get("units"), "frequency": item.get("frequency"),
            "seasonal_adjustment": item.get("seasonal_adjustment_short")}


@app.tool(annotations=READ_ONLY)
def economic_series(series_ids: list[str], start: str = "", end: str = "") -> dict[str, Any]:
    """Up to 10 FRED series by id (e.g. UNRATE, CPIAUCSL, FEDFUNDS, DGS10, GDP, PAYEMS) as a tidy table of series,
    date and value, between `start` and `end` (YYYY-MM-DD; all of it if empty)."""
    ids = list(dict.fromkeys(str(item).strip().upper() for item in series_ids if str(item).strip()))
    if not ids:
        raise FinanceError("Give at least one FRED series id, e.g. UNRATE.")
    if len(ids) > MAX_SERIES:
        raise FinanceError(f"Ask for at most {MAX_SERIES} series per call.")
    bad = [item for item in ids if not _SERIES.match(item)]
    if bad:
        raise FinanceError(f"{', '.join(map(repr, bad))} is not a FRED series id.")
    params = {key: value for key, value in (("cosd", _date(start, "start")), ("coed", _date(end, "end"))) if value}
    rows: list[dict[str, Any]] = []
    for series in ids:
        missing = FinanceError(f"FRED has no series {series!r}." + ("" if client().fred_key else
                               " Find ids with search_economic_series (it needs a FRED key) or on fred.stlouisfed.org."))
        try:
            text = client().get(FRED_CSV, {"id": series, **params}, ttl=TTL_DAY, source="fred").decode("utf-8", errors="replace")
        except FinanceError as exc:
            raise (missing if "Not found" in str(exc) else exc) from None
        reader = csv.reader(io.StringIO(text))
        header = next(reader, [])
        if len(header) != 2 or header[1].upper() != series:
            raise missing
        for day, value in reader:
            rows.append({"series": series, "date": day, "value": None if value in ("", ".") else float(value)})
    info = [item for item in (_series_info(series) for series in ids) if item]
    return {"series": info or [{"series": series} for series in ids], "rows": rows,
            "source": "FRED, Federal Reserve Bank of St. Louis: " + ", ".join(f"https://fred.stlouisfed.org/series/{series}" for series in ids)}


@app.tool(annotations=READ_ONLY)
def search_economic_series(query: str, limit: int = 20) -> dict[str, Any]:
    """Find FRED series by keyword (e.g. "consumer price index", "unemployment rate California"), most popular first,
    with id, title, units, frequency and date range. Needs a FRED key."""
    key = client().fred_key
    if not key:
        raise FinanceError("Searching FRED needs a free FRED API key: ask the user to add one to the Finance toolkit in "
                           "Tools (fred.stlouisfed.org/docs/api/api_key.html). Common ids work without one: UNRATE, "
                           "CPIAUCSL, FEDFUNDS, DGS10, GDP, PAYEMS, SP500, MORTGAGE30US.")
    data = json.loads(client().get(f"{FRED_API}/series/search", {"search_text": query.strip(), "file_type": "json",
                                                                 "limit": max(1, min(MAX_LIMIT, int(limit))),
                                                                 "order_by": "popularity", "sort_order": "desc"},
                                   ttl=TTL_DAY, secret={"api_key": key}, source="fred"))
    return {"query": query, "series": [{"series": item.get("id"), "title": item.get("title"), "units": item.get("units"),
                                        "frequency": item.get("frequency"), "seasonal_adjustment": item.get("seasonal_adjustment_short"),
                                        "start": item.get("observation_start"), "end": item.get("observation_end"),
                                        "popularity": item.get("popularity")}
                                       for item in data.get("seriess") or []]}


# -- stock prices (Twelve Data) --

@app.tool(annotations=READ_ONLY)
def stock_prices(symbols: list[str], start: str = "", end: str = "",
                 interval: Literal["1day", "1week", "1month"] = "1day") -> dict[str, Any]:
    """Prices of up to 5 stocks, ETFs or indexes (e.g. AAPL, SPY) as a tidy table of symbol, date, open, high, low,
    close and volume, between `start` and `end` (YYYY-MM-DD; the latest 5,000 if empty). Needs a Twelve Data key."""
    key = client().twelve_data_key
    if not key:
        raise FinanceError("Stock prices need a free Twelve Data API key: ask the user to add one to the Finance toolkit "
                           "in Tools (twelvedata.com, the free Basic plan).")
    wanted = list(dict.fromkeys(str(item).strip().upper() for item in symbols if str(item).strip()))
    if not wanted:
        raise FinanceError("Give at least one symbol, e.g. AAPL.")
    if len(wanted) > MAX_SYMBOLS:
        raise FinanceError(f"Ask for at most {MAX_SYMBOLS} symbols per call (each uses one of the key's credits).")
    bad = [item for item in wanted if not _SYMBOL.match(item)]
    if bad:
        raise FinanceError(f"{', '.join(map(repr, bad))} is not a symbol.")
    params = {"interval": interval, "outputsize": 5000, "order": "ASC",
              **{name: value for name, value in (("start_date", _date(start, "start")), ("end_date", _date(end, "end"))) if value}}
    rows: list[dict[str, Any]] = []
    meta = []
    for symbol in wanted:
        data = json.loads(client().get(TWELVE_DATA, {"symbol": symbol, **params}, ttl=TTL_PRICES,
                                       secret={"apikey": key}, source="twelvedata"))
        if data.get("status") == "error":
            raise _twelve_data_error(data, symbol)
        info = data.get("meta") or {}
        meta.append({"symbol": symbol, "name": info.get("symbol"), "exchange": info.get("exchange"),
                     "currency": info.get("currency"), "type": info.get("type")})
        for value in data.get("values") or []:
            rows.append({"symbol": symbol, "date": value.get("datetime"),
                         **{field: _number(value.get(field)) for field in ("open", "high", "low", "close", "volume")}})
    return {"symbols": meta, "interval": interval, "rows": rows, "source": "Twelve Data (twelvedata.com)"}


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _twelve_data_error(data: dict[str, Any], symbol: str) -> FinanceError:
    code, message = data.get("code"), str(data.get("message") or "")
    if code == 401:
        return FinanceError("Twelve Data refused the API key. Ask the user to check the key in the Finance toolkit (Tools).")
    if code == 429:
        return FinanceError("The Twelve Data key is out of credits for now (8 a minute, 800 a day on the free plan): wait "
                            "a minute, or ask for fewer symbols.")
    if code in (400, 404):
        return FinanceError(f"Twelve Data has no prices for {symbol or 'that symbol'}: {message}")
    return FinanceError(f"Twelve Data answered an error ({code}): {message}")


def main(argv: list[str] | None = None) -> None:
    global _client
    parser = argparse.ArgumentParser(description="Data Formulator's Finance toolkit as an MCP server.")
    parser.add_argument("--email", default="", help="Contact address sent to the SEC with each request, as it asks.")
    parser.add_argument("--cache", default="", help="Directory for cached responses.")
    options = parser.parse_args(argv)
    # Keys the user set come from the credential vault as environment variables.
    _client = Client(Path(options.cache).expanduser() if options.cache else None, email=options.email or None,
                     fred_key=os.environ.get("FRED_API_KEY"), twelve_data_key=os.environ.get("TWELVE_DATA_API_KEY"))
    app.run("stdio")
