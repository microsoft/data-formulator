"""The Research tool pack: the polite arXiv client, the MCP server's tools, and adding the pack.

Offline: arXiv is a mock transport, and time is a fake clock, so spacing and retries are exact.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from data_formulator.tool_packs.research import arxiv, openalex, server

pytestmark = [pytest.mark.backend]


def feed(entries: list[dict], total: int | None = None) -> bytes:
    items = "".join(f"""<entry><id>http://arxiv.org/abs/{entry['id']}v2</id><title>{entry['title']}</title>
        <published>{entry.get('published', '2024-05-02T10:00:00Z')}</published><updated>2024-05-03T10:00:00Z</updated>
        <summary> An abstract
        on two lines. </summary>
        {''.join(f'<author><name>{name}</name></author>' for name in entry.get('authors', ['Ada Lovelace']))}
        <arxiv:primary_category term="cs.HC"/><category term="cs.HC"/><category term="cs.AI"/>
        <arxiv:comment>12 pages</arxiv:comment></entry>""" for entry in entries)
    return f"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"
        xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
        <opensearch:totalResults>{len(entries) if total is None else total}</opensearch:totalResults>{items}</feed>""".encode()


class FakeTime:
    def __init__(self) -> None:
        self.now = 1000.0
        self.slept: list[float] = []

    def clock(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def make_client(handler, tmp_path: Path | None = None, **extra):
    clock = FakeTime()
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        clock.now += 0.5  # each request takes half a second
        return handler(request, len(requests))

    client = arxiv.Client(tmp_path, "me@example.com", transport=httpx.MockTransport(record), sleep=clock.sleep,
                          clock=clock.clock, **extra)
    return client, requests, clock


def test_requests_are_spaced_identified_and_parsed():
    client, requests, clock = make_client(lambda request, count: httpx.Response(200, content=feed([
        {"id": "2405.00001", "title": "Charts  that\n talk", "authors": ["Ada Lovelace", "Alan Turing"]}], total=42)))
    total, papers = client.query(search_query="all:charts")
    client.query(search_query="all:tables")
    assert total == 42 and len(requests) == 2
    assert "mailto:me@example.com" in requests[0].headers["user-agent"]
    # The second request waited arXiv's three seconds after the first one finished.
    assert clock.slept == [pytest.approx(3.0)]
    paper = papers[0]
    assert paper == {**paper, "id": "2405.00001", "version": "v2", "title": "Charts that talk", "year": 2024,
                     "authors": ["Ada Lovelace", "Alan Turing"], "primary_category": "cs.HC", "categories": ["cs.HC", "cs.AI"],
                     "abstract": "An abstract on two lines.", "comment": "12 pages", "url": "https://arxiv.org/abs/2405.00001"}


def test_rate_limits_and_server_errors_are_retried_with_backoff():
    replies = [httpx.Response(429, headers={"Retry-After": "7"}), httpx.Response(503),
               httpx.Response(200, content=feed([{"id": "2405.00001", "title": "Ok"}]))]
    client, requests, clock = make_client(lambda request, count: replies[count - 1])
    with patch("random.uniform", return_value=0):
        total, _ = client.query(search_query="all:charts")
    assert total == 1 and len(requests) == 3
    # Retry-After is honoured; then the backoff doubles from three seconds.
    assert clock.slept[0] == 7 and clock.slept[1] == 6

    client, requests, _ = make_client(lambda request, count: httpx.Response(503))
    with patch("random.uniform", return_value=0), pytest.raises(arxiv.ArxivError, match="did not respond after 4 tries"):
        client.query(search_query="all:charts")
    assert len(requests) == arxiv.RETRIES


def test_a_rate_limit_stops_asking_for_a_while_and_says_so(tmp_path):
    ok = feed([{"id": "2405.00001", "title": "Ok"}])
    replies = {"all:cached": [httpx.Response(200, content=ok)],
               "all:charts": [httpx.Response(429, content=b"Rate exceeded."), httpx.Response(429, content=b"Rate exceeded."),
                              httpx.Response(200, content=ok), httpx.Response(429, content=b"Rate exceeded.")]}
    client, requests, clock = make_client(lambda request, count: replies[request.url.params["search_query"]].pop(0), tmp_path)
    client.query(search_query="all:cached")
    # arXiv's throttle names no wait: no retry (it would extend the limit), and the reason is given at once.
    with pytest.raises(arxiv.ArxivError, match=r"rate-limiting .* Wait about 120 seconds"):
        client.query(search_query="all:charts")
    assert len(requests) == 2
    # During the cooldown nothing is sent; answers already cached still come back.
    clock.now += 60
    with pytest.raises(arxiv.ArxivError, match="Wait about 60 seconds"):
        client.query(search_query="all:charts")
    assert client.query(search_query="all:cached")[1][0]["title"] == "Ok" and len(requests) == 2
    # Still limited when asked again: the next pause is twice as long.
    clock.now += 61
    with pytest.raises(arxiv.ArxivError, match="Wait about 240 seconds"):
        client.query(search_query="all:charts")
    clock.now += 241
    assert client.query(search_query="all:charts", start=1)[1][0]["title"] == "Ok" and len(requests) == 4
    # An answer resets it.
    clock.now += 5
    with pytest.raises(arxiv.ArxivError, match="Wait about 120 seconds"):
        client.query(search_query="all:charts", start=2)


def test_one_call_stops_retrying_at_its_budget():
    def timeout(request: httpx.Request, count: int) -> httpx.Response:
        clock.now += 30  # each attempt waits out the read timeout
        raise httpx.ReadTimeout("The read operation timed out", request=request)

    client, requests, clock = make_client(timeout)
    started = clock.now
    with patch("random.uniform", return_value=0), pytest.raises(arxiv.ArxivError, match="did not respond after 3 tries"):
        client.query(search_query="all:charts")
    assert len(requests) == 3 and clock.now - started <= arxiv.CALL_BUDGET


def test_the_model_reads_why_a_tool_failed(monkeypatch):
    import asyncio

    from mcp.server.mcpserver.exceptions import ToolError, UnexpectedToolError

    client, _, _ = make_client(lambda request, count: httpx.Response(429, content=b"Rate exceeded."))
    monkeypatch.setattr(server, "_client", client)
    with pytest.raises(ToolError) as raised:
        asyncio.run(server.app.call_tool("search_papers", {"query": "charts", "category": "cs.HC"}))
    # Not masked as a crash ("Error executing tool search_papers" alone): the reason reaches the model.
    assert not isinstance(raised.value, UnexpectedToolError)
    assert "arXiv is rate-limiting" in str(raised.value)


def test_results_without_entries_are_asked_again():
    replies = [feed([], total=12), feed([{"id": "2405.00001", "title": "Back"}], total=12)]
    client, requests, _ = make_client(lambda request, count: httpx.Response(200, content=replies[count - 1]))
    with patch("random.uniform", return_value=0):
        _, papers = client.query(search_query="all:charts")
    assert len(requests) == 2 and papers[0]["title"] == "Back"
    # Past the end, an empty page is the real answer.
    client, requests, _ = make_client(lambda request, count: httpx.Response(200, content=feed([], total=3)))
    assert client.query(search_query="all:charts", start=5)[1] == [] and len(requests) == 1


def test_answers_are_cached_on_disk(tmp_path):
    client, requests, _ = make_client(lambda request, count: httpx.Response(200, content=feed([{"id": "2405.00001", "title": "Once"}])),
                                      tmp_path)
    client.query(search_query="all:charts")
    again, _, _ = make_client(lambda request, count: pytest.fail("should come from the cache"), tmp_path)
    assert again.query(search_query="all:charts")[1][0]["title"] == "Once"
    assert len(requests) == 1
    # Stale entries are fetched again.
    for meta in tmp_path.glob("*.json"):
        meta.write_text(json.dumps({**json.loads(meta.read_text()), "at": 0}))
    fresh, more, _ = make_client(lambda request, count: httpx.Response(200, content=feed([{"id": "2405.00002", "title": "Twice"}])), tmp_path)
    assert fresh.query(search_query="all:charts")[1][0]["title"] == "Twice" and len(more) == 1


def test_query_errors_and_bad_ids_are_reported():
    error = b"""<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
        <opensearch:totalResults>1</opensearch:totalResults><entry><id>http://arxiv.org/api/errors#bad</id>
        <title>Error</title><summary>incorrect id format</summary></entry></feed>"""
    client, _, _ = make_client(lambda request, count: httpx.Response(200, content=error))
    with pytest.raises(arxiv.ArxivError, match="incorrect id format"):
        client.query(id_list=["nope"])
    client, _, _ = make_client(lambda request, count: httpx.Response(404))
    with pytest.raises(arxiv.ArxivError, match="HTTP 404"):
        client.get("https://arxiv.org/html/2405.00001")
    assert arxiv.normalize_id("https://arxiv.org/abs/2405.00001v3") == "2405.00001v3"
    assert arxiv.normalize_id("arXiv:2405.00001") == "2405.00001"
    assert arxiv.normalize_id("https://arxiv.org/pdf/2405.00001.pdf") == "2405.00001"
    assert arxiv.normalize_id("10.48550/arXiv.2309.10305") == "2309.10305"
    assert arxiv.normalize_id("hep-th/9901001") == "hep-th/9901001"
    with pytest.raises(arxiv.ArxivError):
        arxiv.normalize_id("not a paper")


def test_queries_from_words_fields_and_dates():
    assert server.build_query("llm chart") == "all:llm AND all:chart"
    assert server.build_query('"data visualization" survey') == 'all:"data visualization" AND all:survey'
    assert server.build_query("ti:transformer AND cat:cs.CL") == "(ti:transformer AND cat:cs.CL)"
    assert server.build_query(author="Chenglong Wang", category="cs.HC, cs.AI", date_from="2024-02", date_to="2024") == \
        'au:"Chenglong Wang" AND (cat:cs.HC OR cat:cs.AI) AND submittedDate:[202402010000 TO 202412312359]'
    assert server.build_query(title="charts", date_to="2023-02") .endswith("TO 202302282359]")
    with pytest.raises(arxiv.ArxivError):
        server.build_query()
    with pytest.raises(arxiv.ArxivError, match="Use a date"):
        server.build_query("x", date_from="last week")


def test_tools_return_tables_and_counts(monkeypatch):
    def handler(request: httpx.Request, count: int) -> httpx.Response:
        query = request.url.params.get("search_query", "")
        if request.url.params.get("max_results") == "1" and "submittedDate" in query:
            return httpx.Response(200, content=feed([{"id": "2405.00001", "title": "x"}], total=10 * count))
        return httpx.Response(200, content=feed([{"id": f"2405.0000{index}", "title": f"Paper {index}",
                                                 "authors": [f"Author {item}" for item in range(7)]} for index in range(3)], total=80))

    client, requests, _ = make_client(handler, min_interval=0)
    monkeypatch.setattr(server, "_client", client)
    result = server.search_papers(query="charts", category="cs.HC", sort="newest", limit=500)
    assert result["total"] == 80 and result["returned"] == 3
    assert requests[0].url.params["max_results"] == "100" and requests[0].url.params["sortBy"] == "submittedDate"
    row = result["papers"][0]
    assert row["authors"] == "Author 0, Author 1, Author 2, Author 3, Author 4 et al. (7 authors)" and "abstract" not in row
    assert "abstract" in server.search_papers(query="charts", category="cs.HC", include_abstracts=True)["papers"][0]
    assert result["source"] == "arxiv"

    counted = server.count_papers(date_from="2021", date_to="2023", category="cs.HC")
    assert counted["counts"] == [{"year": "2021", "papers": 30}, {"year": "2022", "papers": 40}, {"year": "2023", "papers": 50}]
    with pytest.raises(arxiv.ArxivError, match="at most 20 periods"):
        server.count_papers(date_from="2020-01", date_to="2023-12", by="month")
    details = server.paper_details(["2405.00001", "https://arxiv.org/abs/2405.00009"])
    assert details["not_found"] == ["2405.00009"]
    assert requests[-1].url.params["id_list"] == "2405.00001,2405.00009"


def test_full_text_is_markdown_from_html_else_the_pdf(monkeypatch):
    html = b"""<html><body><div class="ltx_page_main"><span>\\vgtccategory Research</span>
        <h1 class="ltx_title">Charts That Talk</h1><div class="ltx_abstract"><h6>Abstract</h6><p class="ltx_p">We study
        <math alttext="x^2">x2</math> charts.</p></div><h2>1 Introduction</h2><div class="ltx_para"><p class="ltx_p">Text.</p></div>
        <figure><figcaption>Figure 1: A chart.</figcaption></figure>
        <table class="ltx_tabular"><tr><td>a</td><td>b</td></tr></table>
        <ul><li class="ltx_bibitem">Ref one.</li></ul></div></body></html>"""
    markdown = server.html_to_markdown(html)
    assert markdown.startswith("# Charts That Talk")
    for piece in ("We study $x^2$ charts.", "## 1 Introduction", "_Figure 1: A chart._", "a | b", "- Ref one."):
        assert piece in markdown
    assert server.html_to_markdown(b"<html><body>No HTML for this paper</body></html>") is None

    def handler(request: httpx.Request, count: int) -> httpx.Response:
        if "/html/" in request.url.path:
            return httpx.Response(404)
        return httpx.Response(200, content=b"%PDF-1.7 fake")

    client, _, _ = make_client(handler, min_interval=0)
    monkeypatch.setattr(server, "_client", client)
    content = server.get_full_text(["2405.00001", "arXiv:2405.00002", "2405.00001"])
    assert [item.resource.mime_type for item in content if hasattr(item, "resource")] == ["application/pdf"] * 2
    with pytest.raises(arxiv.ArxivError, match="at most 5"):
        server.get_full_text([f"2405.0000{index}" for index in range(6)])



# -- OpenAlex search --

def work(arxiv_url: str | None, title: str, cited: int = 3, **extra) -> dict:
    return {"id": "https://openalex.org/W1", "doi": None, "title": title, "publication_date": "2024-05-02", "publication_year": 2024,
            "cited_by_count": cited, "primary_topic": {"display_name": "Data Visualization"},
            "authorships": [{"author": {"display_name": f"Author {index}"}} for index in range(6)],
            "locations": [{"landing_page_url": arxiv_url}] if arxiv_url else [{"landing_page_url": "https://example.org/p"}],
            "abstract_inverted_index": {"We": [0], "chart": [2], "study": [1]}, **extra}


def make_openalex(handler, tmp_path: Path | None = None, key: str | None = None):
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request, len(requests))

    return openalex.Client(tmp_path, key, transport=httpx.MockTransport(record), sleep=lambda seconds: None), requests


def test_openalex_searches_arxiv_papers_by_title_and_abstract(tmp_path):
    reply = {"meta": {"count": 42}, "results": [work("http://arxiv.org/abs/2309.10305v2", "Charts, talking"),
                                               work(None, "Not on arXiv"),
                                               work(None, "Only its DOI", doi="https://doi.org/10.48550/arxiv.2401.00001")]}
    search, requests = make_openalex(lambda request, count: httpx.Response(200, json=reply), tmp_path, key="secret-key")
    total, first, papers = search.search(query="llm, chart: grammar", author="Jeffrey Heer", date_from="2023", date_to="2024-02",
                                         sort="cited", limit=50, offset=100)
    params = requests[0].url.params
    assert params["filter"] == ("locations.source.id:S4306400194,title_and_abstract.search:llm chart grammar,"
                                "raw_author_name.search:Jeffrey Heer,from_publication_date:2023-01-01,to_publication_date:2024-02-29")
    assert params["sort"] == "cited_by_count:desc" and params["per_page"] == "50" and params["page"] == "3"
    # The key goes in a header, never in the URL (or the cache).
    assert requests[0].headers["authorization"] == "Bearer secret-key" and "secret-key" not in str(requests[0].url)
    assert (total, first) == (42, 100)
    assert [(paper["id"], paper["cited_by"]) for paper in papers] == [("2309.10305", 3), ("2401.00001", 3)]
    assert papers[0]["abstract"] == "We study chart" and papers[0]["url"] == "https://arxiv.org/abs/2309.10305"
    again, more = make_openalex(lambda request, count: pytest.fail("should come from the cache"), tmp_path)
    assert again.search(query="llm, chart: grammar", author="Jeffrey Heer", date_from="2023", date_to="2024-02", sort="cited",
                        limit=50, offset=100)[0] == 42
    assert not any("secret-key" in path.read_text() for path in tmp_path.glob("*.json"))


def test_openalex_reports_a_spent_budget_retries_a_busy_second_and_sets_aside_an_inactive_key():
    spent, _ = make_openalex(lambda request, count: httpx.Response(429, headers={"x-ratelimit-remaining-usd": "0"}, text="Daily budget exceeded"))
    with pytest.raises(openalex.OpenAlexError, match="daily budget"):
        spent.search(query="charts")
    replies = [httpx.Response(429, headers={"x-ratelimit-remaining-usd": "0.05", "retry-after": "1"}),
               httpx.Response(200, json={"meta": {"count": 0}, "results": []})]
    busy, requests = make_openalex(lambda request, count: replies.pop(0))
    assert busy.search(query="charts")[0] == 0 and len(requests) == 2
    inactive, requests = make_openalex(lambda request, count: httpx.Response(403, text='{"error": "key_not_activated"}') if count == 1
                                       else httpx.Response(200, json={"meta": {"count": 1}, "results": []}), key="pending")
    assert inactive.search(query="charts")[0] == 1
    assert "authorization" in requests[0].headers and "authorization" not in requests[1].headers


def test_searches_and_counts_go_to_openalex_and_categories_to_arxiv(monkeypatch):
    def openalex_reply(request: httpx.Request, count: int) -> httpx.Response:
        if request.url.params.get("group_by") == "publication_year":
            return httpx.Response(200, json={"meta": {"count": 9}, "group_by": [{"key": "2022", "count": 4}, {"key": "2023", "count": 5}]})
        if request.url.params.get("per_page") == "1":
            return httpx.Response(200, json={"meta": {"count": 7}, "results": []})
        return httpx.Response(200, json={"meta": {"count": 1}, "results": [work("https://arxiv.org/abs/2405.00001", "Found")]})

    search, searched = make_openalex(openalex_reply)
    arxiv_client, asked, _ = make_client(lambda request, count: httpx.Response(200, content=feed([{"id": "2405.00002", "title": "From arXiv"}])),
                                         min_interval=0)
    monkeypatch.setattr(server, "_openalex", search)
    monkeypatch.setattr(server, "_client", arxiv_client)

    found = server.search_papers(query="charts", sort="cited")
    assert found["source"] == "openalex" and found["papers"][0]["cited_by"] == 3 and "topic" in found["papers"][0]
    assert not asked
    # Only arXiv knows its categories and its own query syntax.
    assert server.search_papers(query="charts", category="cs.HC")["source"] == "arxiv"
    assert server.search_papers(query="ti:charts AND cat:cs.HC")["source"] == "arxiv"
    yearly = server.count_papers(date_from="2021", date_to="2023", query="charts")
    assert yearly["source"] == "openalex" and yearly["counts"] == [{"year": "2021", "papers": 0}, {"year": "2022", "papers": 4},
                                                                   {"year": "2023", "papers": 5}]
    assert server.count_papers(date_from="2024-01", date_to="2024-02", by="month", query="charts")["counts"] == [
        {"month": "2024-01", "papers": 7}, {"month": "2024-02", "papers": 7}]

    # OpenAlex out of budget: arXiv answers, and says why.
    spent, _ = make_openalex(lambda request, count: httpx.Response(429, headers={"x-ratelimit-remaining-usd": "0"}))
    monkeypatch.setattr(server, "_openalex", spent)
    fallback = server.search_papers(query="charts")
    assert fallback["source"] == "arxiv" and "daily budget" in fallback["note"] and fallback["papers"][0]["title"] == "From arXiv"
    assert server.count_papers(date_from="2024", query="charts")["source"] == "arxiv"


# -- adding the pack --

HEADERS = {"Origin": "http://localhost", "X-DF-Configuration": "1"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    import flask

    from data_formulator.error_handler import register_error_handlers
    from data_formulator.mcp_servers.routes import mcp_bp

    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("CREDENTIAL_VAULT", "local")
    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: True)
    monkeypatch.setattr("data_formulator.configuration.user_connectors_disabled", lambda: False)
    app = flask.Flask(__name__)
    app.register_blueprint(mcp_bp)
    register_error_handlers(app)
    with patch("data_formulator.auth.identity.get_identity_id", return_value="local:me"):
        yield app.test_client()


def test_the_research_pack_is_added_once_as_a_local_server(client):
    import sys

    packs = client.get("/api/mcp/packs").get_json()["data"]["packs"]
    assert [pack["id"] for pack in packs] == ["research", "github", "huggingface", "finance"] and packs[0]["server_id"] is None
    added = client.post("/api/mcp/packs/research", headers=HEADERS, json={"settings": {"email": "me@example.com"}}).get_json()["data"]
    assert added["pack"] == "research" and added["transport"] == "stdio" and added["command"] == sys.executable
    assert added["args"][:2] == ["-m", "data_formulator.tool_packs.research"] and added["args"][-2:] == ["--email", "me@example.com"]
    again = client.post("/api/mcp/packs/research", headers=HEADERS, json={}).get_json()["data"]
    assert again["id"] == added["id"]
    assert client.get("/api/mcp/packs").get_json()["data"]["packs"][0]["server_id"] == added["id"]
    bad = client.post("/api/mcp/packs/research", headers=HEADERS, json={"settings": {"email": "nope"}})
    assert bad.get_json()["data"]["id"] == added["id"]  # already added: settings are not re-read
    assert client.post("/api/mcp/packs/unknown", headers=HEADERS, json={}).get_json()["error"]["code"] == "INVALID_REQUEST"
    assert client.post("/api/mcp/packs/research", json={}).status_code == 403


def test_an_openalex_key_is_kept_in_the_vault_not_the_command_line(client):
    packs = client.get("/api/mcp/packs").get_json()["data"]["packs"]
    secret = next(setting for setting in packs[0]["settings"] if setting["key"] == "openalex_key")
    assert secret["secret"] is True and "env" not in secret
    added = client.post("/api/mcp/packs/research", headers=HEADERS, json={"settings": {"openalex_key": " abc123 "}}).get_json()["data"]
    assert not any("abc123" in arg for arg in added["args"]) and added["secrets"]["env"] == ["OPENALEX_API_KEY"]
    from data_formulator.mcp_servers import config as mcp_config
    assert mcp_config.read_secrets("local:me", added["id"])["env"] == {"OPENALEX_API_KEY": "abc123"}


def test_a_malformed_openalex_key_is_refused(client):
    reply = client.post("/api/mcp/packs/research", headers=HEADERS, json={"settings": {"openalex_key": "two words"}}).get_json()
    assert reply["error"]["code"] == "INVALID_REQUEST"
    assert client.get("/api/mcp/packs").get_json()["data"]["packs"][0]["server_id"] is None


def test_a_bad_contact_email_is_refused(client):
    reply = client.post("/api/mcp/packs/research", headers=HEADERS, json={"settings": {"email": "not-an-email"}}).get_json()
    assert reply["error"]["code"] == "INVALID_REQUEST" and "email" in reply["error"]["message"]


def test_the_finance_pack_needs_an_email_and_keeps_its_keys_in_the_vault(client):
    finance = next(pack for pack in client.get("/api/mcp/packs").get_json()["data"]["packs"] if pack["id"] == "finance")
    assert next(setting for setting in finance["settings"] if setting["key"] == "email")["required"] is True
    missing = client.post("/api/mcp/packs/finance", headers=HEADERS, json={"settings": {"twelvedata_key": "td1"}}).get_json()
    assert missing["error"]["code"] == "INVALID_REQUEST" and "Contact email" in missing["error"]["message"]
    added = client.post("/api/mcp/packs/finance", headers=HEADERS, json={"settings": {
        "email": "me@example.com", "twelvedata_key": "td1", "fred_key": "fr1"}}).get_json()["data"]
    assert added["args"][:2] == ["-m", "data_formulator.tool_packs.finance"] and added["args"][-2:] == ["--email", "me@example.com"]
    assert not any(key in arg for arg in added["args"] for key in ("td1", "fr1"))
    from data_formulator.mcp_servers import config as mcp_config
    assert mcp_config.read_secrets("local:me", added["id"])["env"] == {"TWELVE_DATA_API_KEY": "td1", "FRED_API_KEY": "fr1"}


def test_an_added_packs_settings_can_change_and_only_their_state_is_shown(client):
    from data_formulator.mcp_servers import config as mcp_config

    added = client.post("/api/mcp/packs/finance", headers=HEADERS, json={"settings": {
        "email": "me@example.com", "twelvedata_key": "td1"}}).get_json()["data"]
    finance = next(pack for pack in client.get("/api/mcp/packs").get_json()["data"]["packs"] if pack["id"] == "finance")
    assert finance["values"] == {"email": {"value": "me@example.com"}, "twelvedata_key": {"set": True}, "fred_key": {"set": False}}
    assert "td1" not in json.dumps(finance)

    changed = client.put("/api/mcp/packs/finance/settings", headers=HEADERS, json={"settings": {
        "email": "you@example.com", "fred_key": "fr2", "twelvedata_key": ""}}).get_json()["data"]
    assert changed["values"] == {"email": {"value": "you@example.com"}, "twelvedata_key": {"set": False}, "fred_key": {"set": True}}
    assert mcp_config.get_server(added["id"])["args"][-2:] == ["--email", "you@example.com"]
    assert mcp_config.read_secrets("local:me", added["id"])["env"] == {"FRED_API_KEY": "fr2"}

    for settings, problem in (({"email": ""}, "Contact email is required"), ({"fred_key": "two words"}, "without spaces"),
                              ({"colour": "x"}, "no setting 'colour'")):
        reply = client.put("/api/mcp/packs/finance/settings", headers=HEADERS, json={"settings": settings}).get_json()
        assert reply["error"]["code"] == "INVALID_REQUEST" and problem in reply["error"]["message"]
    assert client.put("/api/mcp/packs/huggingface/settings", headers=HEADERS, json={"settings": {}}).get_json()["error"]["code"] == "INVALID_REQUEST"


def test_a_packs_tools_are_listed_before_it_is_added(client):
    tools = client.get("/api/mcp/packs/finance/tools").get_json()["data"]["tools"]
    assert [tool["name"] for tool in tools] == ["find_company", "company_financials", "list_filings", "economic_series",
                                                "search_economic_series", "stock_prices"]
    assert all(tool["read_only"] and tool["description"] for tool in tools)
    assert client.get("/api/mcp/packs/unknown/tools").get_json()["error"]["code"] == "INVALID_REQUEST"


def test_large_json_results_save_as_json(tmp_path):
    from mcp import types

    from data_formulator.mcp_servers.results import summarize_result

    table = json.dumps({"papers": [{"id": index, "title": "x" * 80} for index in range(200)]})
    summary = summarize_result(types.CallToolResult(content=[types.TextContent(type="text", text=table)]),
                               scratch_root=tmp_path, server_id="research", tool="search_papers")
    assert summary["display"]["files"][0]["path"].endswith(".json")
