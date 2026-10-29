"""The Research tool pack: the polite arXiv client, the MCP server's tools, and adding the pack.

Offline: arXiv is a mock transport, and time is a fake clock, so spacing and retries are exact.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from data_formulator.tool_packs.research import arxiv, server

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
    assert "abstract" in server.search_papers(query="charts", include_abstracts=True)["papers"][0]

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
    assert [pack["id"] for pack in packs] == ["research"] and packs[0]["server_id"] is None
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


def test_a_bad_contact_email_is_refused(client):
    reply = client.post("/api/mcp/packs/research", headers=HEADERS, json={"settings": {"email": "not-an-email"}}).get_json()
    assert reply["error"]["code"] == "INVALID_REQUEST" and "email" in reply["error"]["message"]


def test_large_json_results_save_as_json(tmp_path):
    from mcp import types

    from data_formulator.mcp_servers.results import summarize_result

    table = json.dumps({"papers": [{"id": index, "title": "x" * 80} for index in range(200)]})
    summary = summarize_result(types.CallToolResult(content=[types.TextContent(type="text", text=table)]),
                               scratch_root=tmp_path, server_id="research", tool="search_papers")
    assert summary["display"]["files"][0]["path"].endswith(".json")
