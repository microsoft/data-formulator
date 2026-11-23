"""The Finance tool pack: SEC company figures and filings, FRED series and Twelve Data prices.

Offline: the SEC, FRED and Twelve Data are a mock transport.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from data_formulator.tool_packs.finance import server

pytestmark = [pytest.mark.backend]

TICKERS = {"0": {"cik_str": 789019, "ticker": "MSFT", "title": "MICROSOFT CORP"},
           "1": {"cik_str": 1067983, "ticker": "BRK-B", "title": "BERKSHIRE HATHAWAY INC"},
           "2": {"cik_str": 1, "ticker": "MSFTX", "title": "MICRO SOFTWARE HOLDINGS"}}


def fact(start, end, val, form="10-K", filed="2026-07-30"):
    return {**({"start": start} if start else {}), "end": end, "val": val, "form": form, "filed": filed}


FACTS = {"entityName": "MICROSOFT CORP", "facts": {"us-gaap": {
    # Revenue moved concepts: both count, and a restated period keeps its latest filing.
    "Revenues": {"units": {"USD": [fact("2023-07-01", "2024-06-30", 200, filed="2024-07-30")]}},
    "RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": [
        fact("2023-07-01", "2024-06-30", 245, filed="2025-07-30"),
        fact("2024-07-01", "2025-06-30", 280),
        fact("2024-07-01", "2024-09-30", 65, "10-Q"), fact("2024-10-01", "2024-12-31", 70, "10-Q"),
        fact("2025-01-01", "2025-03-31", 70, "10-Q"),
        fact("2024-07-01", "2024-12-31", 135, "10-Q")]}},  # a half year: neither annual nor quarterly
    "Assets": {"units": {"USD": [fact(None, "2025-06-30", 600), fact(None, "2025-03-31", 590, "10-Q")]}},
    "EarningsPerShareDiluted": {"units": {"USD/shares": [fact("2024-07-01", "2025-06-30", 12.5)]}}}}}


def sources(requests: list[httpx.Request]):
    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        url = request.url
        if url.path == "/files/company_tickers.json":
            return httpx.Response(200, json=TICKERS)
        if url.path == "/api/xbrl/companyfacts/CIK0000789019.json":
            return httpx.Response(200, json=FACTS)
        if url.path == "/submissions/CIK0000789019.json":
            return httpx.Response(200, json={"name": "MICROSOFT CORP", "tickers": ["MSFT"], "fiscalYearEnd": "0630",
                                             "sicDescription": "Services-Prepackaged Software", "filings": {"recent": {
                "form": ["8-K", "10-K", "10-K/A", "10-Q"], "filingDate": ["2026-10-30", "2026-07-30", "2026-08-02", "2026-04-29"],
                "reportDate": ["", "2026-06-30", "2026-06-30", "2026-03-31"],
                "accessionNumber": ["0001-26-1", "0001-26-2", "0001-26-3", "0001-26-4"],
                "primaryDocument": ["a.htm", "msft-10k.htm", "b.htm", "c.htm"], "primaryDocDescription": ["8-K", "10-K", "", "10-Q"]}}})
        if url.path == "/graph/fredgraph.csv":
            series = url.params["id"]
            if series == "NOPE":
                return httpx.Response(404, text="<html>Error</html>")
            return httpx.Response(200, text=f"observation_date,{series}\n2026-08-01,4.1\n2026-09-01,.\n")
        if url.path == "/fred/series/search":
            return httpx.Response(200, json={"seriess": [{"id": "CPIAUCSL", "title": "CPI", "units": "Index", "frequency": "Monthly",
                                                          "observation_start": "1947-01-01", "observation_end": "2026-09-01",
                                                          "popularity": 95}]})
        if url.path == "/fred/series":
            return httpx.Response(200, json={"seriess": [{"title": "Unemployment Rate", "units": "Percent", "frequency": "Monthly"}]})
        if url.path == "/time_series":
            if url.params["symbol"] == "ZZZZ":
                return httpx.Response(200, json={"code": 400, "message": "symbol not found", "status": "error"})
            return httpx.Response(200, json={"meta": {"symbol": url.params["symbol"], "exchange": "NASDAQ", "currency": "USD"},
                                             "values": [{"datetime": "2026-10-27", "open": "1", "high": "2", "low": "0.5",
                                                         "close": "1.5", "volume": "100"}], "status": "ok"})
        return httpx.Response(404)
    return handle


@pytest.fixture
def finance(monkeypatch, tmp_path):
    def install(**keys):
        requests: list[httpx.Request] = []
        client = server.Client(tmp_path, transport=httpx.MockTransport(sources(requests)), **{"email": "me@example.com", **keys})
        monkeypatch.setattr(server, "_client", client)
        monkeypatch.setattr(server, "SEC_INTERVAL", 0)
        return requests
    return install


def test_finds_companies_by_ticker_or_name(finance):
    requests = finance()
    assert [item["ticker"] for item in server.find_company("msft")["companies"]] == ["MSFT", "MSFTX"]
    assert server.find_company("brk.b")["companies"][0]["cik"] == 1067983
    assert server.find_company("berkshire")["companies"][0]["ticker"] == "BRK-B"
    # The SEC gets the contact email it asks for.
    assert "me@example.com" in requests[0].headers["user-agent"]


def test_reported_figures_annual_and_quarterly(finance):
    finance()
    annual = server.company_financials("Microsoft", metrics=["revenue", "total_assets", "eps_diluted", "rd_expense"])
    revenue = [(row["year"], row["value"], row["concept"]) for row in annual["rows"] if row["metric"] == "revenue"]
    assert revenue == [(2024, 245, "RevenueFromContractWithCustomerExcludingAssessedTax"),
                       (2025, 280, "RevenueFromContractWithCustomerExcludingAssessedTax")]
    assert [(row["period_end"], row["value"]) for row in annual["rows"] if row["metric"] == "total_assets"] == [("2025-06-30", 600)]
    assert [row["unit"] for row in annual["rows"] if row["metric"] == "eps_diluted"] == ["USD/shares"]
    assert annual["missing"] == ["rd_expense"] and annual["ticker"] == "MSFT"

    quarterly = server.company_financials("MSFT", metrics=["revenue"], period="quarterly")
    rows = [(row["quarter"], row["value"], row["derived"]) for row in quarterly["rows"]]
    # The fiscal year's fourth quarter is the year minus its first three.
    assert rows == [("2024Q3", 65, False), ("2024Q4", 70, False), ("2025Q1", 70, False), ("2025Q2", 75, True)]
    with pytest.raises(server.FinanceError, match="Unknown metric 'profit'"):
        server.company_financials("MSFT", metrics=["profit"])
    with pytest.raises(server.FinanceError, match="No company filing with the SEC matches"):
        server.company_financials("Nonexistent Widgets")


def test_filings_with_links(finance):
    finance()
    found = server.list_filings("MSFT", form="10-k")
    assert [item["form"] for item in found["filings"]] == ["10-K", "10-K/A"] and found["fiscal_year_end"] == "0630"
    assert found["filings"][0]["url"] == "https://www.sec.gov/Archives/edgar/data/789019/0001262/msft-10k.htm"
    assert len(server.list_filings("MSFT", form="any", limit=2)["filings"]) == 2


def test_economic_series_need_no_key_but_search_does(finance):
    requests = finance()
    found = server.economic_series(["unrate"], start="2026-08-01")
    assert found["rows"] == [{"series": "UNRATE", "date": "2026-08-01", "value": 4.1}, {"series": "UNRATE", "date": "2026-09-01", "value": None}]
    assert requests[-1].url.params["cosd"] == "2026-08-01"
    with pytest.raises(server.FinanceError, match="FRED has no series 'NOPE'"):
        server.economic_series(["NOPE"])
    with pytest.raises(server.FinanceError, match="YYYY-MM-DD"):
        server.economic_series(["UNRATE"], start="August")
    with pytest.raises(server.FinanceError, match="needs a free FRED API key"):
        server.search_economic_series("cpi")


def test_with_keys_search_series_and_stock_prices(finance, tmp_path):
    requests = finance(fred_key="fredsecret", twelve_data_key="tdsecret")
    assert server.search_economic_series("cpi")["series"][0]["series"] == "CPIAUCSL"
    assert server.economic_series(["UNRATE"])["series"][0]["title"] == "Unemployment Rate"
    prices = server.stock_prices(["aapl", "AAPL", "msft"], start="2026-10-01")
    assert [row["symbol"] for row in prices["rows"]] == ["AAPL", "MSFT"] and prices["rows"][0]["close"] == 1.5
    assert requests[-1].url.params["start_date"] == "2026-10-01" and requests[-1].url.params["apikey"] == "tdsecret"
    # Keys go in the request, never in the cache.
    assert not any(secret in path.read_text() for path in tmp_path.glob("*.json") for secret in ("fredsecret", "tdsecret"))
    with pytest.raises(server.FinanceError, match="no prices for ZZZZ"):
        server.stock_prices(["ZZZZ"])


def test_stock_prices_and_sec_need_their_settings(finance):
    finance(email="")
    with pytest.raises(server.FinanceError, match="free Twelve Data API key"):
        server.stock_prices(["AAPL"])
    with pytest.raises(server.FinanceError, match="contact email"):
        server.find_company("MSFT")
