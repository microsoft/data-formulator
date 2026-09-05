from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pandas as pd
import pytest
from pypdf import PdfWriter

from data_formulator.analyst.agent import AnalystAgent
from data_formulator.analyst.skills import build_registry
from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.skills.core.skill import CoreSkill
from data_formulator.analyst.workspace_inputs import (
    WorkspaceInputEngine,
    build_workspace_input_manifest,
    build_workspace_input_preview,
    render_workspace_input_context,
)
from data_formulator.datalake.file_manager import save_uploaded_file
from data_formulator.datalake.workspace import Workspace


pytestmark = [pytest.mark.backend]


def _docx(text: str) -> bytes:
    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body>
</w:document>""".encode()
    content = io.BytesIO()
    with zipfile.ZipFile(content, "w") as archive:
        archive.writestr("word/document.xml", document_xml)
    return content.getvalue()


def _agent(workspace: Workspace) -> AnalystAgent:
    agent = AnalystAgent(client=None, workspace=workspace)
    agent._build_lightweight_table_context = lambda *args, **kwargs: "TABLE_CTX"
    agent._build_system_prompt = lambda *args, **kwargs: "SYS"
    return agent


def test_workspace_input_manifest_normalizes_scoped_data_and_files(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    saved_file = workspace.save_workspace_file(
        b"# Dataset notes", "README.md", "text/markdown",
    )

    manifest = build_workspace_input_manifest(
        [{"name": "orders"}], workspace.list_workspace_files(),
    )

    assert [(item.kind, item.display_name) for item in manifest.inputs] == [
        ("data", "orders"),
        ("file", "README.md"),
    ]
    assert manifest.data[0].id == "data:orders"
    assert manifest.files[0].id == f"file:{saved_file.content_hash}:README.md"
    assert manifest.has_analysis_capability is True


def test_workspace_input_manifest_uses_only_run_scoped_data(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)

    manifest = build_workspace_input_manifest(
        [{"name": "selected"}, {"name": ""}], workspace.list_workspace_files(),
    )

    assert [item.display_name for item in manifest.data] == ["selected"]


def test_workspace_input_preview_is_bounded_and_rendered_with_data(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.save_workspace_file(b"abcdefghij", "notes.txt", "text/plain")
    manifest = build_workspace_input_manifest(
        [{"name": "orders"}], workspace.list_workspace_files(),
    )

    preview = build_workspace_input_preview(
        manifest, workspace, budget_chars=4, max_file_chars=10,
    )
    rendered = render_workspace_input_context(manifest, preview, "TABLE_CTX")

    assert preview.selected[0].content == "abcd"
    assert preview.selected[0].truncated is True
    assert "[WORKSPACE INPUTS]" in rendered
    assert f"- {manifest.data[0].id}: orders" in rendered
    assert "\n\nTABLE_CTX" in rendered
    assert "### Preview: notes.txt (truncated)" in rendered
    assert "<workspace-input-content>\nabcd\n</workspace-input-content>" in rendered


def test_unsupported_file_stays_visible_without_preview(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.save_workspace_file(b"\x00\x01", "archive.bin", "application/octet-stream")
    manifest = build_workspace_input_manifest([], workspace.list_workspace_files())

    preview = build_workspace_input_preview(manifest, workspace)
    rendered = render_workspace_input_context(manifest, preview, "")

    assert manifest.files[0].capabilities == ("python",)
    assert preview.selected == ()
    assert preview.omitted_input_ids == (manifest.files[0].id,)
    assert "archive.bin" in rendered
    assert "1 file input(s) omitted from eager preview." in rendered


def test_file_only_workspace_is_an_analysis_input(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.save_workspace_file(b"# Dataset notes", "README.md", "text/markdown")
    workspace_files = workspace.list_workspace_files()
    agent = _agent(workspace)

    messages = agent._build_initial_messages(
        [], "Summarize the notes", workspace_files=workspace_files,
    )
    user_content = messages[1]["content"]

    manifest = build_workspace_input_manifest([], workspace_files, workspace)
    assert agent._initial_loaded_skills(manifest) == {"core"}
    assert "[WORKSPACE INPUTS]" in user_content
    assert "## Files" in user_content
    assert "README.md (text/markdown" in user_content
    assert "# Dataset notes" in user_content
    assert "read_workspace_input" in user_content
    assert user_content.index("[WORKSPACE INPUTS]") < user_content.index("[USER QUESTION]")


def test_core_workspace_file_tool_reads_docx(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.save_workspace_file(
        _docx("Turn one Turn two"), "transcript.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )

    result = CoreSkill().handle_tool(
        "read_workspace_file",
        {"name": "transcript.docx"},
        SkillContext(client=None, workspace=workspace),
    )

    assert result.text == "[WORKSPACE FILE: transcript.docx]\n\nTurn one Turn two"


def test_core_registry_exposes_workspace_file_tool() -> None:
    tool_names = {
        tool["function"]["name"]
        for tool in build_registry().tools_for(["core"])
    }

    assert {
        "list_workspace_inputs",
        "preview_workspace_input",
        "read_workspace_input",
        "search_workspace_inputs",
        "read_workspace_file",
    } <= tool_names


def test_core_unified_input_tools_list_read_and_search(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    saved_file = workspace.save_workspace_file(
        b"alpha\nneedle value\nomega", "notes.txt", "text/plain",
    )
    context = SkillContext(
        client=None,
        workspace=workspace,
        payload={"input_tables": [{"name": "orders"}]},
    )
    core = CoreSkill()
    file_id = f"file:{saved_file.content_hash}:notes.txt"

    listed = json.loads(core.handle_tool("list_workspace_inputs", {}, context).text)
    assert [(item["kind"], item["name"]) for item in listed["inputs"]] == [
        ("data", "orders"),
        ("file", "notes.txt"),
    ]
    assert listed["inputs"][0]["adapter"] == {
        "name": "data",
        "locator_fields": ["row"],
        "option_fields": ["columns"],
    }
    assert listed["inputs"][1]["adapter"] == {
        "name": "text",
        "locator_fields": ["line"],
        "option_fields": [],
    }

    previewed = core.handle_tool(
        "preview_workspace_input",
        {"input_id": file_id, "locator": {"line": 2}, "limit": 1},
        context,
    ).text
    preview_header, preview_content = previewed.split("\n\n", 1)
    assert json.loads(preview_header)["locator"] == {"line": 2}
    assert preview_content == "needle value"

    searched = json.loads(core.handle_tool(
        "search_workspace_inputs",
        {"query": "needle", "kinds": ["file"]},
        context,
    ).text)
    assert searched["matches"] == [{
        "input_id": file_id,
        "locator": {"line": 2},
        "text": "needle value",
    }]


def test_unified_input_tool_rejects_library_specific_options(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    saved_file = workspace.save_workspace_file(b"notes", "notes.txt", "text/plain")
    context = SkillContext(client=None, workspace=workspace)

    with pytest.raises(ValueError, match="Unsupported option fields.*dtype"):
        CoreSkill().handle_tool(
            "read_workspace_input",
            {
                "input_id": f"file:{saved_file.content_hash}:notes.txt",
                "options": {"dtype": "str"},
            },
            context,
        )


def test_processed_data_uses_versioned_id_and_source_metadata(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    metadata = save_uploaded_file(
        workspace,
        b"city,value\nSeattle,1\nPortland,2\n",
        "cities.csv",
    )

    manifest = build_workspace_input_manifest(
        [{"name": metadata.name}],
        workspace.list_workspace_files(),
        workspace,
    )

    data_input = manifest.data[0]
    assert data_input.id == f"data:{metadata.content_hash}:{metadata.name}"
    assert data_input.source is not None
    assert data_input.source.name == metadata.filename
    assert data_input.source.content_hash == metadata.content_hash


def test_stale_file_id_reports_current_version(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    original = workspace.save_workspace_file(b"old", "notes.txt", "text/plain")
    old_id = f"file:{original.content_hash}:notes.txt"
    workspace.delete_workspace_file("notes.txt")
    replacement = workspace.save_workspace_file(b"new", "notes.txt", "text/plain")
    engine = WorkspaceInputEngine(workspace, [])

    with pytest.raises(ValueError, match=f"current input ID: file:{replacement.content_hash}:notes.txt"):
        engine.read_input(old_id)


def test_file_adapter_rejects_replacement_after_engine_creation(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    original = workspace.save_workspace_file(b"old", "notes.txt", "text/plain")
    engine = WorkspaceInputEngine(workspace, [])
    workspace.delete_workspace_file("notes.txt")
    workspace.save_workspace_file(b"new", "notes.txt", "text/plain")

    with pytest.raises(ValueError, match="Input changed while reading"):
        engine.read_input(f"file:{original.content_hash}:notes.txt")


def test_file_input_id_encodes_unusual_name(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    saved_file = workspace.save_workspace_file(b"value", "notes #1.txt", "text/plain")

    file_input = WorkspaceInputEngine(workspace, []).manifest.files[0]

    assert file_input.id == f"file:{saved_file.content_hash}:notes%20%231.txt"
    assert WorkspaceInputEngine(workspace, []).read_input(file_input.id).endswith("value")


def test_data_adapter_reads_pages_and_searches_rows(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    metadata = workspace.write_parquet(
        pd.DataFrame({
            "city": ["Seattle", "Portland", "Boston"],
            "value": [10, 20, 30],
        }),
        "cities",
    )
    engine = WorkspaceInputEngine(workspace, [{"name": metadata.name}])
    data_id = engine.manifest.data[0].id

    page = json.loads(engine.read_input(
        data_id,
        locator={"row": 2},
        options={"columns": ["city"]},
        limit=1,
    ))
    assert page["rows"] == [{"city": "Portland"}]
    assert page["next_locator"] == {"row": 3}

    search = json.loads(engine.search_inputs(
        "Boston",
        input_ids=[data_id],
    ))
    assert search == {
        "matches": [{
            "input_id": data_id,
            "locator": {"row": 3},
            "columns": ["city"],
            "text": "city=Boston",
        }],
        "count": 1,
        "errors": [],
    }


def test_search_rejects_unknown_input_ids(tmp_path: Path) -> None:
    engine = WorkspaceInputEngine(Workspace("test-user", root_dir=tmp_path), [])

    with pytest.raises(ValueError, match="Input not found"):
        engine.search_inputs("needle", input_ids=["file:missing:notes.txt"])


def test_spreadsheet_adapter_reads_and_searches_sheets(tmp_path: Path) -> None:
    workbook = io.BytesIO()
    with pd.ExcelWriter(workbook, engine="openpyxl") as writer:
        pd.DataFrame({"city": ["Seattle", "Boston"], "value": [10, 20]}).to_excel(
            writer,
            sheet_name="Summary",
            index=False,
        )
        pd.DataFrame({"note": ["ordinary", "needle value"]}).to_excel(
            writer,
            sheet_name="Notes",
            index=False,
        )

    workspace = Workspace("test-user", root_dir=tmp_path)
    saved_file = workspace.save_workspace_file(
        workbook.getvalue(),
        "report.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    engine = WorkspaceInputEngine(workspace, [])
    file_id = f"file:{saved_file.content_hash}:report.xlsx"

    listed = json.loads(engine.list_inputs())
    assert listed["inputs"][0]["adapter"] == {
        "name": "spreadsheet",
        "locator_fields": ["sheet", "row"],
        "option_fields": ["columns"],
    }
    page = json.loads(engine.read_input(
        file_id,
        locator={"sheet": "Summary", "row": 2},
        options={"columns": ["city"]},
        limit=1,
    ))
    assert page["rows"] == [{"city": "Boston"}]
    assert page["sheet_names"] == ["Summary", "Notes"]

    search = json.loads(engine.search_inputs("needle", input_ids=[file_id]))
    assert search["matches"] == [{
        "input_id": file_id,
        "locator": {"sheet": "Notes", "row": 2},
        "columns": ["note"],
        "text": "note=needle value",
    }]


def test_pdf_adapter_exposes_page_reads_and_eager_preview(tmp_path: Path) -> None:
    pdf = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.add_blank_page(width=72, height=72)
    writer.write(pdf)

    workspace = Workspace("test-user", root_dir=tmp_path)
    saved_file = workspace.save_workspace_file(
        pdf.getvalue(),
        "notes.pdf",
        "application/pdf",
    )
    engine = WorkspaceInputEngine(workspace, [])
    file_id = f"file:{saved_file.content_hash}:notes.pdf"

    listed = json.loads(engine.list_inputs())
    assert listed["inputs"][0]["adapter"] == {
        "name": "pdf",
        "locator_fields": ["page"],
        "option_fields": [],
    }
    page = json.loads(engine.read_input(
        file_id,
        locator={"page": 1},
        limit=1,
    ))
    assert page["page_count"] == 2
    assert page["pages"] == [{"page": 1, "text": ""}]
    assert page["next_locator"] == {"page": 2}

    preview = build_workspace_input_preview(engine.manifest, workspace)
    assert preview.selected[0].preview_format == "structured"
    assert json.loads(preview.selected[0].content)["page_count"] == 2