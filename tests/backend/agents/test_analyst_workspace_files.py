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
from data_formulator.analyst.skills.workspace.skill import WorkspaceSkill
from data_formulator.analyst.workspace_inputs import (
    WorkspaceInputEngine,
    build_workspace_input_manifest,
    build_workspace_input_preview,
    render_workspace_input_context,
)
from data_formulator.datalake.file_manager import save_uploaded_file
from data_formulator.datalake.workspace import Workspace
from data_formulator.datalake.workspace_metadata import MemorySource


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


def test_table_memory_is_a_reusable_data_input_with_provenance(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    saved_file = workspace.save_workspace_file(
        b"%PDF current report", "report.pdf", "application/pdf",
    )
    source_id = f"file:{saved_file.content_hash}:report.pdf"
    memory = workspace.write_memory_table(
        pd.DataFrame({"region": ["east", "west"], "revenue": [10, 20]}),
        "quarterly revenue",
        sources=[MemorySource(
            input_id=source_id,
            name="report.pdf",
            content_hash=saved_file.content_hash,
            media_type="application/pdf",
            locator={"page": 2},
        )],
    )

    engine = WorkspaceInputEngine(workspace, [])
    item = engine.manifest.data[0]
    listed = json.loads(engine.list_items())["inputs"][0]
    preview = json.loads(engine.read_item(item.id, limit=1))

    assert item.origin == "memory"
    assert item.memory_id == memory.id
    assert item.path == f"memory/{memory.filename}"
    assert listed["adapter"]["name"] == "memory-table"
    assert listed["sources"] == [{
        "name": "report.pdf",
        "input_id": source_id,
        "media_type": "application/pdf",
        "content_hash": saved_file.content_hash,
        "locator": {"page": 2},
    }]
    assert preview["rows"] == [{"region": "east", "revenue": 10}]


def test_stale_table_memory_is_not_an_analysis_input(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    original = workspace.save_workspace_file(
        b"%PDF original", "report.pdf", "application/pdf",
    )
    memory = workspace.write_memory_table(
        pd.DataFrame({"value": [1]}),
        "report values",
        sources=[MemorySource(
            input_id=f"file:{original.content_hash}:report.pdf",
            name="report.pdf",
            content_hash=original.content_hash,
            media_type="application/pdf",
        )],
    )
    assert any(item.memory_id == memory.id for item in WorkspaceInputEngine(workspace, []).manifest.data)

    workspace.delete_workspace_file("report.pdf")
    workspace.save_workspace_file(b"%PDF revised", "report.pdf", "application/pdf")

    assert all(item.memory_id != memory.id for item in WorkspaceInputEngine(workspace, []).manifest.data)
    assert workspace.get_memory_metadata(memory.id) is not None


def test_text_memory_is_readable_and_searchable_workspace_item(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    memory = workspace.write_memory_text(
        "# Customer notes\n\nRenewal owner: Casey\n",
        "customer notes",
        description="Remembered account context.",
    )
    engine = WorkspaceInputEngine(workspace, [])
    item = next(item for item in engine.manifest.files if item.memory_id == memory.id)

    assert item.origin == "memory"
    assert item.path == f"memory/{memory.filename}"
    assert engine.read_item(item.id, locator={"line": 3}).endswith("Renewal owner: Casey")
    assert json.loads(engine.search_items("Casey", input_ids=[item.id]))["matches"] == [{
        "input_id": item.id,
        "locator": {"line": 3},
        "text": "Renewal owner: Casey",
    }]


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
    assert "complete current input inventory" in rendered
    assert "do not call list_workspace_items before reading or searching" in rendered
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
    assert agent._initial_loaded_skills(manifest) == {"meta"}
    assert "[WORKSPACE INPUTS]" in user_content
    assert "## Files" in user_content
    assert "README.md (text/markdown" in user_content
    assert "# Dataset notes" in user_content
    assert "read_workspace_item" in user_content
    assert user_content.index("[WORKSPACE INPUTS]") < user_content.index("[USER QUESTION]")


def test_workspace_workspace_item_tool_reads_docx(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    saved = workspace.save_workspace_file(
        _docx("Turn one Turn two"), "transcript.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )

    result = WorkspaceSkill().handle_tool(
        "read_workspace_item",
        {"item_id": f"file:{saved.content_hash}:transcript.docx"},
        SkillContext(client=None, workspace=workspace),
    )

    assert result.text.endswith("Turn one Turn two")


def test_workspace_registry_exposes_workspace_file_tool() -> None:
    tools = build_registry().tools_for(["meta"])
    tool_names = {tool["function"]["name"] for tool in tools}

    assert {name for name in tool_names if "workspace" in name} == {
        "list_workspace_items",
        "read_workspace_item",
        "search_workspace_items",
        "manage_workspace_memory",
    }
    manage_schema = next(
        tool["function"]["parameters"]
        for tool in tools
        if tool["function"]["name"] == "manage_workspace_memory"
    )
    assert "patch" in manage_schema["properties"]["action"]["enum"]
    assert "text" in manage_schema["properties"]["kind"]["enum"]


def test_workspace_unified_input_tools_list_read_and_search(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    saved_file = workspace.save_workspace_file(
        b"alpha\nneedle value\nomega", "notes.txt", "text/plain",
    )
    context = SkillContext(
        client=None,
        workspace=workspace,
        payload={"input_tables": [{"name": "orders"}]},
    )
    workspace_skill = WorkspaceSkill()
    file_id = f"file:{saved_file.content_hash}:notes.txt"

    listed = json.loads(workspace_skill.handle_tool("list_workspace_items", {}, context).text)
    assert [(item["kind"], item["name"]) for item in listed["items"]] == [
        ("data", "orders"),
        ("file", "notes.txt"),
    ]
    assert listed["items"][0]["adapter"] == {
        "name": "data",
        "locator_fields": ["row"],
        "option_fields": ["columns"],
    }
    assert listed["items"][1]["adapter"] == {
        "name": "text",
        "locator_fields": ["line"],
        "option_fields": [],
    }

    previewed = workspace_skill.handle_tool(
        "read_workspace_item",
        {"item_id": file_id, "locator": {"line": 2}, "limit": 1},
        context,
    ).text
    preview_header, preview_content = previewed.split("\n\n", 1)
    assert json.loads(preview_header)["locator"] == {"line": 2}
    assert preview_content == "needle value"

    searched = json.loads(workspace_skill.handle_tool(
        "search_workspace_items",
        {"query": "needle", "kinds": ["file"]},
        context,
    ).text)
    assert searched["matches"] == [{
        "input_id": file_id,
        "locator": {"line": 2},
        "text": "needle value",
    }]


def test_workspace_lists_only_scoped_top_level_temp_items(tmp_path: Path) -> None:
    context = SkillContext(
        client=None,
        workspace=Workspace("test-user", root_dir=tmp_path),
        payload={
            "scratch_files": [
                "scratch/report.pdf",
                "scratch/sales.csv",
                "scratch/nested/private.txt",
                "../outside.txt",
            ],
        },
    )

    listed = json.loads(WorkspaceSkill().handle_tool(
        "list_workspace_items",
        {"scope": "temp", "query": "report"},
        context,
    ).text)

    assert listed == {
        "scope": "temp",
        "items": [{
            "id": "temp:scratch/report.pdf",
            "name": "report.pdf",
            "kind": "temp",
            "path": "scratch/report.pdf",
            "capabilities": ["python"],
        }],
        "count": 1,
    }


def test_workspace_table_memory_tools_persist_provenance(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    saved_file = workspace.save_workspace_file(
        b"%PDF", "report.pdf", "application/pdf",
    )
    manifest = build_workspace_input_manifest(
        [], workspace.list_workspace_files(), workspace,
    )

    class Sandbox:
        def run_python_code(self, **kwargs):
            return {
                "status": "ok",
                "content": pd.DataFrame({"metric": ["revenue"], "value": [42]}),
            }

    monkeypatch.setattr("data_formulator.sandbox.create_sandbox", lambda mode: Sandbox())
    context = SkillContext(
        client=None,
        workspace=workspace,
        runtime=_agent(workspace),
        payload={"workspace_inputs": manifest},
    )
    workspace_skill = WorkspaceSkill()
    saved = json.loads(workspace_skill.handle_tool(
        "manage_workspace_memory",
        {
            "action": "save",
            "kind": "table",
            "name": "quarterly metrics",
            "description": "Metrics extracted from the quarterly report.",
            "input_sources": [{
                "id": manifest.files[0].id,
                "kind": "file",
                "locator": {"page": 2},
            }],
            "code": "result_df = pd.DataFrame()",
            "output_variable": "result_df",
        },
        context,
    ).text)

    memory = workspace.get_memory_metadata(saved["id"])
    assert memory is not None
    assert memory.sources[0].input_id == f"file:{saved_file.content_hash}:report.pdf"
    assert memory.sources[0].locator == {"page": 2}

    listed = json.loads(workspace_skill.handle_tool(
        "list_workspace_items", {"scope": "memory"}, context,
    ).text)
    assert listed["items"][0]["path"] == saved["path"]
    refreshed = json.loads(workspace_skill.handle_tool(
        "manage_workspace_memory",
        {
            "action": "refresh",
            "memory_id": memory.id,
            "input_sources": [{
                "id": manifest.files[0].id,
                "kind": "file",
                "locator": {"page": 3},
            }],
            "code": "result_df = pd.DataFrame()",
            "output_variable": "result_df",
        },
        context,
    ).text)
    assert refreshed["id"] == memory.id
    assert workspace.get_memory_metadata(memory.id).sources[0].locator == {"page": 3}
    renamed = json.loads(workspace_skill.handle_tool(
        "manage_workspace_memory",
        {"action": "rename", "memory_id": memory.id, "name": "report metrics"},
        context,
    ).text)
    assert renamed == {"id": memory.id, "name": "report_metrics"}
    deleted = json.loads(workspace_skill.handle_tool(
        "manage_workspace_memory",
        {"action": "delete", "memory_id": memory.id},
        context,
    ).text)
    assert deleted == {"id": memory.id, "deleted": True}


def test_workspace_manages_and_patches_text_memory(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    context = SkillContext(client=None, workspace=workspace)
    workspace_skill = WorkspaceSkill()

    saved = json.loads(workspace_skill.handle_tool(
        "manage_workspace_memory",
        {
            "action": "save",
            "kind": "text",
            "name": "customer notes",
            "description": "Remembered account context.",
            "content": "# Customer\n\nOwner: Casey\n",
        },
        context,
    ).text)
    item = next(
        item for item in WorkspaceInputEngine(workspace, []).manifest.files
        if item.memory_id == saved["id"]
    )
    assert workspace_skill.handle_tool(
        "read_workspace_item", {"item_id": item.id}, context,
    ).text.endswith("Owner: Casey")

    patched = json.loads(workspace_skill.handle_tool(
        "manage_workspace_memory",
        {
            "action": "patch",
            "memory_id": saved["id"],
            "expected_content_hash": saved["content_hash"],
            "replacements": [{"old_text": "Owner: Casey", "new_text": "Owner: Morgan"}],
            "append_text": "Status: active\n",
        },
        context,
    ).text)
    assert workspace.read_memory_text(saved["id"]) == (
        "# Customer\n\nOwner: Morgan\nStatus: active\n"
    )
    assert patched["content_hash"] != saved["content_hash"]

    with pytest.raises(ValueError, match="Memory changed while patching"):
        workspace_skill.handle_tool(
            "manage_workspace_memory",
            {
                "action": "patch",
                "memory_id": saved["id"],
                "expected_content_hash": saved["content_hash"],
                "append_text": "stale",
            },
            context,
        )


def test_unified_input_tool_rejects_library_specific_options(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    saved_file = workspace.save_workspace_file(b"notes", "notes.txt", "text/plain")
    context = SkillContext(client=None, workspace=workspace)

    with pytest.raises(ValueError, match="Unsupported option fields.*dtype"):
        WorkspaceSkill().handle_tool(
            "read_workspace_item",
            {
                "item_id": f"file:{saved_file.content_hash}:notes.txt",
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
        engine.read_item(old_id)


def test_file_adapter_rejects_replacement_after_engine_creation(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    original = workspace.save_workspace_file(b"old", "notes.txt", "text/plain")
    engine = WorkspaceInputEngine(workspace, [])
    workspace.delete_workspace_file("notes.txt")
    workspace.save_workspace_file(b"new", "notes.txt", "text/plain")

    with pytest.raises(ValueError, match="Input changed while reading"):
        engine.read_item(f"file:{original.content_hash}:notes.txt")


def test_file_input_id_encodes_unusual_name(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    saved_file = workspace.save_workspace_file(b"value", "notes #1.txt", "text/plain")

    file_input = WorkspaceInputEngine(workspace, []).manifest.files[0]

    assert file_input.id == f"file:{saved_file.content_hash}:notes%20%231.txt"
    assert WorkspaceInputEngine(workspace, []).read_item(file_input.id).endswith("value")


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

    page = json.loads(engine.read_item(
        data_id,
        locator={"row": 2},
        options={"columns": ["city"]},
        limit=1,
    ))
    assert page["rows"] == [{"city": "Portland"}]
    assert page["next_locator"] == {"row": 3}

    search = json.loads(engine.search_items(
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
        engine.search_items("needle", input_ids=["file:missing:notes.txt"])


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

    listed = json.loads(engine.list_items())
    assert listed["inputs"][0]["adapter"] == {
        "name": "spreadsheet",
        "locator_fields": ["sheet", "row"],
        "option_fields": ["columns"],
    }
    page = json.loads(engine.read_item(
        file_id,
        locator={"sheet": "Summary", "row": 2},
        options={"columns": ["city"]},
        limit=1,
    ))
    assert page["rows"] == [{"city": "Boston"}]
    assert page["sheet_names"] == ["Summary", "Notes"]

    search = json.loads(engine.search_items("needle", input_ids=[file_id]))
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

    listed = json.loads(engine.list_items())
    assert listed["inputs"][0]["adapter"] == {
        "name": "pdf",
        "locator_fields": ["page"],
        "option_fields": [],
    }
    page = json.loads(engine.read_item(
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