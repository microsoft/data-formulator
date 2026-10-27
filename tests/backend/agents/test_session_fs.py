"""The path-based list/read/search engine behind list_files, read_file and search (design-docs/65)."""
from __future__ import annotations

import io

import duckdb
import pandas as pd
import pytest

from data_formulator.analyst import session_files, session_fs
from data_formulator.analyst.session_files import SessionFiles
from data_formulator.analyst.session_fs import Matcher
from data_formulator.analyst.session_layer import SessionLayer
from data_formulator.analyst.skills import SkillContext
from data_formulator.datalake.workspace import Workspace

pytestmark = pytest.mark.backend


@pytest.fixture()
def workspace(tmp_path):
    return Workspace("test-user", root_dir=tmp_path)


def _files(workspace, state=None) -> SessionFiles:
    return SessionFiles(SkillContext(client=None, workspace=workspace,
                                     payload={"session_layer": SessionLayer(state or {}, workspace)}))


def _text_pdf(*pages: str) -> bytes:
    """A small PDF with one line of text per page."""
    objects = ["<< /Type /Catalog /Pages 2 0 R >>",
               "<< /Type /Pages /Kids [" + " ".join(f"{4 + 2 * i} 0 R" for i in range(len(pages)))
               + f"] /Count {len(pages)} >>",
               "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    for index, text in enumerate(pages):
        stream = f"BT /F1 12 Tf 10 50 Td ({text}) Tj ET"
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] "
                       f"/Resources << /Font << /F1 3 0 R >> >> /Contents {5 + 2 * index} 0 R >>")
        objects.append(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
    out, offsets = io.BytesIO(), []
    out.write(b"%PDF-1.4\n")
    for number, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1"))
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


# ── matching ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("query", "text", "expected"), [
    ("school out", "Out-of-school rate", True),           # every word, any order
    ("out school", "children without schooling", False),  # "out" starts a word; "without" does not count
    ("rate", "Out-of-school RATE", True),                 # case-insensitive
    ('"out-of-school rate"', "Out-of-school rate, primary", True),
    ('"school out"', "Out-of-school rate", False),        # a quoted phrase is exact
    ("学校", "失学儿童 学校", True),                          # other scripts match anywhere
])
def test_matcher_words_phrases_and_word_starts(query, text, expected) -> None:
    matcher = Matcher(query)
    assert matcher.matches(text) is expected
    # The DuckDB condition used for table rows agrees with the Python one.
    condition, parameters = matcher.sql(["label"])
    with duckdb.connect() as con:
        con.execute("CREATE TABLE t AS SELECT ? AS label", [text])
        assert bool(con.execute(f"SELECT count(*) FROM t WHERE {condition}", parameters).fetchone()[0]) is expected


def test_matcher_regex_and_invalid_queries() -> None:
    matcher = Matcher(r"OFST\.\d\.CP", regex=True)
    assert matcher.matches("code OFST.1.CP") and not matcher.matches("OFST.X.CP")
    for query, regex in (("", False), ("   ", False), ("(", True)):
        with pytest.raises(ValueError):
            Matcher(query, regex)


# ── search ────────────────────────────────────────────────────────────────


def test_search_returns_whole_rows_codebook_first_with_the_shared_budget(workspace) -> None:
    workspace.write_parquet(pd.DataFrame({
        "indicator_id": ["OFST.1.CP", "OFST.2.CP", "LR.AG15T99"],
        "label": ["Out-of-school children, primary", "Out-of-school adolescents", "Literacy rate"],
    }), "indicators")
    workspace.write_parquet(pd.DataFrame({
        "indicator_id": ["OFST.1.CP"] * 30, "country": [f"C{i}" for i in range(30)], "value": range(30),
    }), "facts")
    workspace.save_workspace_file(b"About out-of-school data\n", "notes.md", "text/markdown")

    result = _files(workspace).search("ofst.1.cp", max_results=6)

    sections = [line for line in result.splitlines() if line.startswith("## ")]
    assert sections[0].startswith("## session/tables/indicators.json")     # the small codebook first
    assert sections[1].startswith("## session/tables/facts.json")
    assert "| 1 | OFST.1.CP | Out-of-school children, primary |" in result  # whole row, 1-based row number
    assert "Matched in: 30 rows" in result
    assert "… 5 of 30 rows shown" in result                                 # the codebook took its 1 row
    assert "notes.md" not in result                                         # "ofst" is not in the note

    words = _files(workspace).search("children out school")
    assert "Out-of-school children, primary" in words and "Out-of-school adolescents" not in words
    assert "## files/notes.md" not in words


def test_search_counts_every_matching_row_beyond_the_shown_ones(workspace) -> None:
    workspace.write_parquet(pd.DataFrame({"kind": ["match"] * 12_500 + ["other"] * 10}), "big")
    result = _files(workspace).search("match", max_results=3)
    assert "Matched in: 12,500 rows" in result and "… 3 of 12,500 rows shown" in result


def test_search_column_name_hits_show_sample_values(workspace) -> None:
    workspace.write_parquet(pd.DataFrame({"region": ["East", "West", "East"], "sales": [1, 2, 3]}), "sales")
    result = _files(workspace).search("region")
    assert "Matched in: column names: region" in result
    assert '"region" — sample values (~2 distinct): East, West' in result


def test_search_covers_table_names_descriptions_and_code_of_tables_without_rows(workspace) -> None:
    state = {"derivedTables": [{
        "kind": "table", "id": "t-sales", "displayId": "Sales by region", "names": ["region", "sales"],
        "metadata": {}, "virtual": {"tableId": "d_sales", "rowCount": 3},
        "derive": {"source": [], "code": "df = sales.groupby('region').sum()", "trigger": {}},
    }]}
    files = _files(workspace, state)
    result = files.search("groupby")
    assert '## session/tables/d_sales.json "Sales by region" — table, data missing from the workspace' in result
    assert "Matched in: code (1 line)" in result
    assert "- code line 1: df = sales.groupby('region').sum()" in result
    assert '"Sales by region"' in files.search("sales by region")


def test_a_session_table_without_workspace_data_reads_as_missing_not_empty(workspace) -> None:
    state = {"derivedTables": [{
        "kind": "table", "id": "t-sales", "displayId": "Sales by region", "names": ["region", "sales"],
        "metadata": {}, "virtual": {"tableId": "d_sales", "rowCount": 3},
        "derive": {"source": [], "code": "df = sales.groupby('region').sum()", "trigger": {}},
    }]}
    files = _files(workspace, state)

    with pytest.raises(ValueError, match="data is missing from the workspace"):
        files.read_item({"path": "session/tables/d_sales.json", "rows": "1-5"})
    assert "data is missing from the workspace" in files.read_item({"path": "session/tables/d_sales.json"})["note"]
    listed = {item["path"]: item for item in files.list("")["files"]}
    assert listed["session/tables/d_sales.json"]["detail"] == \
        "data missing from the workspace (listed as 3 rows × 2 columns)"

    workspace.write_parquet(pd.DataFrame({"region": ["East", "West", "North"], "sales": [1, 2, 3]}), "d_sales")
    files = _files(workspace, state)
    assert files.read_item({"path": "session/tables/d_sales.json", "rows": "1-5"})["total_rows"] == 3
    assert "note" not in files.read_item({"path": "session/tables/d_sales.json"})


def test_search_shows_a_column_window_for_wide_tables(workspace) -> None:
    frame = pd.DataFrame({"id": ["A"], **{f"col_{i:02d}": ["x" * 60] for i in range(20)}, "target": ["needle"]})
    workspace.write_parquet(frame, "wide")
    result = _files(workspace).search("needle")
    row = next(line for line in result.splitlines() if line.startswith("| 1 |"))
    assert "needle" in row and "| A |" in row
    assert "more columns: col_00" in result
    assert len(row) <= session_fs.WIDE_ROW + 100


def test_search_path_filters_and_globs(workspace) -> None:
    workspace.save_workspace_file(b"alpha needle\n", "notes/a.md", "text/markdown")
    workspace.save_workspace_file(b"beta needle\n", "other.txt", "text/plain")
    workspace.save_scratch_file("probe.txt", b"needle in scratch\n")
    files = _files(workspace)
    assert {line.split()[1] for line in files.search("needle").splitlines() if line.startswith("## ")} == {
        "files/notes/a.md", "files/other.txt", "scratch/probe.txt"}
    only_notes = files.search("needle", path="files/notes/")
    assert "files/notes/a.md" in only_notes and "other.txt" not in only_notes
    by_glob = files.search("needle", path=["files/*.txt", "scratch/"])
    assert "other.txt" in by_glob and "scratch/probe.txt" in by_glob and "notes/a.md" not in by_glob
    assert files.search("absent words", path="files/").startswith('No matches for "absent words" in files/')
    with pytest.raises(ValueError):
        files.search("needle", max_results=0)


def test_search_reads_excel_sheets_csv_and_pdf_pages(workspace) -> None:
    excel = io.BytesIO()
    with pd.ExcelWriter(excel) as writer:
        pd.DataFrame({"game": ["Wii Sports", "Tetris"]}).to_excel(writer, sheet_name="Sales", index=False)
        pd.DataFrame({"platform": ["PS2"]}).to_excel(writer, sheet_name="Platforms", index=False)
    workspace.save_workspace_file(excel.getvalue(), "games.xlsx",
                                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    workspace.save_workspace_file(b"city,population\nLagos,15000000\nCairo,10000000\n", "cities.csv", "text/csv")
    workspace.save_workspace_file(_text_pdf("First page intro", "World Population Prospects"), "report.pdf",
                                  "application/pdf")
    files = _files(workspace)

    sheet = files.search("tetris")
    assert '## files/games.xlsx — Excel sheet "Sales", 2 rows' in sheet and "| 2 | Tetris |" in sheet
    assert "| 2 | Cairo | 10000000 |" in files.search("cairo")
    pdf = files.search("population prospects")
    assert "## files/report.pdf — PDF" in pdf and "- page 2: World Population Prospects" in pdf


# ── read ──────────────────────────────────────────────────────────────────


def test_read_items_use_the_unit_that_fits_each_kind(workspace) -> None:
    workspace.write_parquet(pd.DataFrame({"code": [f"K{i}" for i in range(300)], "value": range(300)}), "facts")
    excel = io.BytesIO()
    with pd.ExcelWriter(excel) as writer:
        pd.DataFrame({"game": ["Wii Sports", "Tetris"]}).to_excel(writer, sheet_name="Sales", index=False)
        pd.DataFrame({"platform": ["PS2"]}).to_excel(writer, sheet_name="Platforms", index=False)
    workspace.save_workspace_file(excel.getvalue(), "games.xlsx",
                                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    workspace.save_workspace_file(b"a,b\n1,2\n3,4\n", "small.csv", "text/csv")
    workspace.save_workspace_file(_text_pdf(*(f"Page {i}" for i in range(1, 13))), "long.pdf", "application/pdf")
    files = _files(workspace)

    read = files.read_items([
        {"path": "session/tables/facts.json", "rows": "250-"},
        {"path": "files/games.xlsx#Platforms", "rows": "1"},
        {"path": "files/games.xlsx"},
        {"path": "files/small.csv"},
        {"path": "files/small.csv", "rows": "2"},
        {"path": "files/long.pdf"},
        {"path": "files/long.pdf", "pages": "11-12"},
    ])["files"]

    facts, platforms, sheets, csv_text, csv_rows, pdf, pdf_end = read
    assert facts["total_rows"] == 300 and facts["content"].splitlines()[1].startswith("| 250 | K249 |")
    assert platforms["sheet"] == "Platforms" and "| 1 | PS2 |" in platforms["content"]
    assert set(sheets["sheets"]) == {"Sales", "Platforms"}
    assert csv_text["content"] == "a,b\n1,2\n3,4\n"                       # CSV is text by default
    assert "| 2 | 3 | 4 |" in csv_rows["content"]
    assert pdf["pages"] == "1-5" and pdf["total_pages"] == 12 and "PARTIAL view" in pdf["more"]
    assert pdf_end["pages"] == "11-12" and "Page 12" in pdf_end["content"] and "more" not in pdf_end


def test_read_rows_are_capped(workspace) -> None:
    workspace.write_parquet(pd.DataFrame({"value": range(500)}), "many")
    read = _files(workspace).read_item({"path": "session/tables/many.json", "rows": "1-500"})
    assert read["content"].count("\n") <= session_fs.ROW_LIMIT
    assert read["total_rows"] == 500


def test_large_text_files_are_read_in_pages(workspace, monkeypatch) -> None:
    monkeypatch.setattr(session_files, "MAX_TEXT_BYTES", 100)
    workspace.save_workspace_file("".join(f"line {i}\n" for i in range(1, 101)).encode(), "big.log", "text/plain")
    files = _files(workspace)

    first = files.read_item({"path": "files/big.log", "limit": 10})
    assert first["content"].splitlines() == [f"line {i}" for i in range(1, 11)]
    assert first["total_lines"] == 100 and "PARTIAL view of a large file" in first["more"]
    last = files.read_item({"path": "files/big.log", "offset": 95})
    assert last["content"].splitlines()[-1] == "line 100" and "this is its end" in last["more"]
    assert "- line 42: line 42" in files.search('"line 42"')


def test_read_refuses_images_and_binaries_and_reports_missing_paths(workspace) -> None:
    workspace.save_workspace_file(b"\x89PNG", "chart.png", "image/png")
    files = _files(workspace)
    with pytest.raises(ValueError, match="execute_python_script"):
        files.read_item({"path": "files/chart.png"})
    with pytest.raises(ValueError, match="does not exist"):
        files.read_item({"path": "files/missing.txt"})


# ── list ──────────────────────────────────────────────────────────────────


def test_list_shows_kinds_details_ui_names_and_accepts_globs(workspace) -> None:
    workspace.write_parquet(pd.DataFrame({"a": [1, 2], "b": [3, 4]}), "sales")
    workspace.save_workspace_file(b"# notes", "notes/plan.md", "text/markdown", display_name="Plan")
    workspace.save_workspace_file(b"a,b\n1,2\n", "raw.csv", "text/csv")
    files = _files(workspace)

    listed = {item["path"]: item for item in files.list()["files"]}
    assert listed["session/tables/sales.json"]["kind"] == "table"
    assert listed["session/tables/sales.json"]["detail"] == "2 rows × 2 columns"
    assert listed["files/notes/plan.md"]["name"] == "Plan"
    assert listed["files/raw.csv"]["kind"] == "CSV"
    assert [item["path"] for item in files.list("files/*.csv")["files"]] == ["files/raw.csv"]
    assert [item["path"] for item in files.list("files/notes/")["files"]] == ["files/notes/plan.md"]


# ── storage ───────────────────────────────────────────────────────────────


def test_legacy_memory_moves_into_ordinary_files(workspace) -> None:
    workspace.write_memory_text("Renewal owner: Casey\n", "customer notes", description="Account context.")
    workspace.write_memory_table(pd.DataFrame({"region": ["east"], "revenue": [10]}), "quarterly")

    moved = workspace.migrate_legacy_memory()

    assert sorted(moved) == ["memory/customer_notes.md", "memory/quarterly.parquet"]
    assert workspace.list_memory() == []
    note = workspace.read_workspace_file("memory/customer_notes.md")[1].decode()
    assert note.startswith('---\ndescription: "Account context."\n---') and "Renewal owner: Casey" in note
    table = pd.read_parquet(io.BytesIO(workspace.read_workspace_file("memory/quarterly.parquet")[1]))
    assert table.to_dict("records") == [{"region": "east", "revenue": 10}]
    assert workspace.migrate_legacy_memory() == []
    assert "Casey" in _files(workspace).search("casey")


def test_local_workspace_file_resolves_only_registered_files(workspace) -> None:
    workspace.save_workspace_file(b"x", "notes.txt", "text/plain")
    local = workspace.local_workspace_file("notes.txt")
    assert local is not None and local.read_bytes() == b"x"
    assert workspace.local_workspace_file("missing.txt") is None


# ── charts and workflows ─────────────────────────────────────────────────


def test_a_chart_view_names_the_table_it_shows(workspace) -> None:
    state = {
        "derivedTables": [{"kind": "table", "id": "t-sales", "displayId": "Sales", "names": ["region", "sales"],
                           "metadata": {}, "virtual": {"tableId": "d_sales", "rowCount": 3},
                           "derive": {"source": [], "code": "df = sales", "trigger": {}}}],
        "charts": [{"id": "chart-1", "chartType": "Bar Chart", "tableRef": "t-sales",
                    "encodingMap": {"x": {"fieldID": "f-region"}}}],
        "conceptShelfItems": [{"id": "f-region", "name": "region"}],
    }
    layer = SessionLayer(state, workspace)
    files = SessionFiles(SkillContext(client=None, workspace=workspace, payload={"session_layer": layer}))
    assert "Its data: session/tables/d_sales.json" in files.read("session/charts/chart-1.json")["note"]
    layer.add_run_chart("chart-2", {"chart_type": "Bar Chart", "table": "d_made", "encodings": {}}, ["a"])
    assert "Its data: session/tables/d_made.json" in files.read("session/charts/chart-2.json")["note"]


@pytest.fixture()
def local_workflows(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "home"))
    monkeypatch.setattr("data_formulator.auth.identity._localhost_identity", "local:test")
    monkeypatch.setattr("data_formulator.workflows.scheduler.scheduling_available", lambda: False)
    from data_formulator.datalake.workspace import get_user_home
    from data_formulator.workflows.instances import WorkflowStore
    store = WorkflowStore(get_user_home("test-user"))
    store.save("fuel.workflow.yaml", store.read("demo/gas-price-review.yaml").replace("name:", "name: My", 1))
    return store


def test_workflows_are_read_only_files_listed_and_searched_only_when_named(workspace, local_workflows) -> None:
    from data_formulator.analyst.skills.workspace.skill import WorkspaceSkill
    ctx = SkillContext(client=None, workspace=workspace, payload={"session_layer": SessionLayer({}, workspace)})
    files = SessionFiles(ctx)

    root = files.list()
    assert not any(item["path"].startswith("workflows/") for item in root["files"])
    assert "workflows/: the user's saved" in root["also"]
    listed = {item["path"]: item for item in files.list("workflows/")["files"]}
    assert listed["workflows/fuel.workflow.yaml"]["name"].startswith("My")
    assert listed["workflows/fuel.workflow.yaml"]["detail"].startswith("saved by the user")
    assert listed["workflows/demo/gas-price-review.yaml"]["detail"].startswith("built-in example")
    assert listed["workflows/schedules.json"]["detail"].startswith("scheduling unavailable")

    read = files.read_item({"path": "workflows/demo/gas-price-review.yaml", "limit": 3})
    assert read["content"].startswith("version: 1") and "not replaced" in read["note"] and "editable" not in read
    assert "No matches" in files.search("fuel price")
    assert "## workflows/fuel.workflow.yaml" in files.search("fuel price", path="workflows/")
    with pytest.raises(ValueError):
        WorkspaceSkill().handle_tool("edit_file", {"path": "workflows/fuel.workflow.yaml",
                                                   "expected_content_hash": read["content_hash"], "content": "x"}, ctx)

    in_run = SessionFiles(SkillContext(client=None, workspace=workspace, payload={"in_workflow_run": True}))
    assert in_run.list("workflows/")["files"] == [] and "workflows/" not in in_run.list().get("also", "")


# ── sources/ ─────────────────────────────────────────────────────────────


@pytest.fixture()
def catalogs(workspace):
    from data_formulator.datalake.catalog_cache import save_catalog
    save_catalog(workspace.user_home, "kusto:samples", [
        {"name": "StormEvents", "table_key": "StormEvents", "path": ["StormEvents"],
         "metadata": {"description": "US storm events", "row_count": 59066,
                      "columns": [{"name": "State", "type": "string"}, {"name": "DamageCrops", "type": "int"}]}},
        *({"name": f"storm_log_{i}", "table_key": f"log{i}", "path": ["logs", f"storm_log_{i}"],
           "metadata": {"description": "storm logs"}} for i in range(12)),
        {"name": "a/b", "table_key": "slash", "path": ["odd", "a/b"], "metadata": {}},
    ])
    save_catalog(workspace.user_home, "powerbi:sales", [{
        "name": "Sales Model", "table_key": "c798-guid", "path": ["Sales Model"],
        "metadata": {"query_model": "semantic", "description": "Governed sales",
                     "inspection": {"schema_source": "inferred", "columns_omitted": 2},
                     "relationships": [{"from": "Sales[Key]", "to": "Date[Key]"}],
                     "columns": [{"name": "Revenue", "role": "measure", "aggregation": "sum"},
                                 {"name": "Order Date", "role": "time_dimension", "granularities": ["month"]},
                                 *({"name": f"Dim {i}", "role": "dimension"} for i in range(30))]}}])
    return workspace


def test_sources_list_one_level_with_escaped_segments_and_globs(catalogs) -> None:
    files = _files(catalogs)
    root = {item["path"]: item for item in files.list("sources/")["files"]}
    assert root["sources/kusto:samples/"]["detail"] == "14 tables in 2 top-level folders"
    assert root["sources/powerbi:sales/"]["detail"] == "1 table"
    level = files.list("sources/kusto:samples/")["files"]
    assert [item["path"] for item in level] == ["sources/kusto:samples/logs/", "sources/kusto:samples/odd/",
                                                 "sources/kusto:samples/StormEvents"]
    assert level[2]["detail"] == "2 columns · 59,066 rows" and level[2]["kind"] == "source table"
    assert files.list("sources/kusto:samples/odd/")["files"][0]["path"] == "sources/kusto:samples/odd/a%2Fb"
    assert len(files.list("sources/kusto:samples/*storm_log*")["files"]) == 12
    assert files.list("sources/kusto:samples/StormEvents")["files"] == [level[2]]
    assert "sources/" in files.list()["also"]


def test_a_source_table_reads_as_lines_with_its_identity(catalogs) -> None:
    files = _files(catalogs)
    view = files.read_item({"path": "sources/powerbi:sales/Sales Model"})
    content = view["content"]
    assert "source_id: powerbi:sales\ntable_key: c798-guid" in content
    assert "Semantic model: 1 measures, 30 dimensions, 1 time dimensions" in content
    assert "- Order Date (time_dimension, granularities=month)" in content
    assert 'Inspection: {"schema_source": "inferred", "columns_omitted": 2}' in content
    assert '- {"from": "Sales[Key]", "to": "Date[Key]"}' in content
    page = files.read_item({"path": "sources/powerbi:sales/Sales Model", "offset": 15, "limit": 5})
    assert page["start_line"] == 15 and len(page["content"].splitlines()) == 5 and "more" in page
    assert "time_dimension" in files.search("time_dimension", path="sources/powerbi:sales/")
    with pytest.raises(ValueError, match="folder"):
        files.read_item({"path": "sources/kusto:samples/logs"})
    with pytest.raises(ValueError, match="does not exist"):
        files.read_item({"path": "sources/kusto:samples/Missing"})


def test_a_default_search_covers_catalogs_after_the_session(catalogs) -> None:
    catalogs.write_parquet(pd.DataFrame({"event": [f"storm {i}" for i in range(30)]}), "storms")
    files = _files(catalogs)

    result = files.search("storm", max_results=10)
    headers = [line for line in result.splitlines() if line.startswith("## ")]
    assert headers[0].startswith("## session/tables/storms.json")
    assert headers[1].startswith("## sources/kusto:samples/StormEvents")   # name hits first among catalog tables
    assert len([header for header in headers if header.startswith("## sources/")]) == 10
    assert "… 3 more connected-source tables match" in result
    # The session's rows take the budget first; catalog tables show what is left.
    assert "… 10 of 30 rows shown" in result and "- description:" not in result
    named = files.search("storm", path="sources/")
    assert "more connected-source tables" not in named and "session/tables" not in named
    assert "- description: US storm events" in named
    assert "sources/" not in files.search("storm", path="session/")
