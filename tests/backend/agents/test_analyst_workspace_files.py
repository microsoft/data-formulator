from __future__ import annotations

import io
import hashlib
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
    render_external_reference_context,
)
from data_formulator.datalake.file_manager import save_uploaded_file
from data_formulator.datalake.workspace import Workspace
from data_formulator.datalake.workspace_metadata import MemorySource


pytestmark = [pytest.mark.backend]


def test_agent_workspace_file_storage_preserves_ownership_and_guards_edits(tmp_path, monkeypatch):
    workspace = Workspace("test-user", root_dir=tmp_path)
    created = workspace.save_workspace_file(b"first", "notes.md", "text/markdown",
                                            agent_managed=True, display_name="Notes")
    with pytest.raises(ValueError, match="already exists"):
        workspace.save_workspace_file(b"collision", "notes.md", agent_managed=True)
    updated = workspace.save_workspace_file(b"second", "notes.md", "text/markdown",
                                            agent_managed=True, expected_content_hash=created.content_hash)
    write_bytes = Path.write_bytes

    def interrupted_write(path, content):
        write_bytes(path, b"partial")
        raise OSError("interrupted write")

    with monkeypatch.context() as patched:
        patched.setattr(Path, "write_bytes", interrupted_write)
        with pytest.raises(OSError, match="interrupted"):
            workspace.save_workspace_file(b"replacement", "notes.md", agent_managed=True,
                                          expected_content_hash=updated.content_hash)
    assert workspace.read_workspace_file("notes.md")[1] == b"second"
    assert workspace.read_workspace_file("notes.md")[0].content_hash == updated.content_hash
    with pytest.raises(ValueError, match="changed"):
        workspace.save_workspace_file(b"stale", "notes.md", agent_managed=True,
                                      expected_content_hash=created.content_hash)
    protected = workspace.save_workspace_file(b"original", "source.txt")
    with pytest.raises(ValueError, match="protected"):
        workspace.save_workspace_file(b"overwrite", "source.txt", agent_managed=True,
                                      expected_content_hash=protected.content_hash)
    workspace.save_workspace_text_file("notes.md", "user revision", updated.content_hash)
    workspace.rename_workspace_file("notes.md", "renamed.md")
    restored, content = Workspace("test-user", root_dir=tmp_path).read_workspace_file("renamed.md")
    assert content == b"user revision"
    assert restored.origin == "agent"
    assert restored.edit_policy == "agent_editable"
    assert restored.display_name == "Notes"
    assert workspace.list_scratch_files() == []
    skill = WorkspaceSkill()
    context = SkillContext(client=None, workspace=workspace)
    output = json.loads(skill.handle_tool("create_file", {
        "filename": "generated.md", "content": "First", "display_name": "Generated Notes",
    }, context).text)
    assert output["path"] == "files/generated.md"
    assert output["temporary"] is False
    revised = json.loads(skill.handle_tool("edit_file", {
        "path": output["path"], "expected_content_hash": output["content_hash"], "append_text": " revision",
    }, context).text)
    assert workspace.read_workspace_file("generated.md")[1] == b"First revision"
    assert revised["display_name"] == "Generated Notes"
    assert any(item.display_name == "generated.md" for item in context.payload["workspace_inputs"].files)
    assert workspace.list_scratch_files() == []


def test_agent_data_create_update_and_protected_sources(tmp_path):
    registry = build_registry()
    assert {"create_data", "update_data", "create_file", "edit_file"} <= set(registry.metas["workspace"].tool_names)
    workspace = Workspace("test-user", root_dir=tmp_path)
    skill = WorkspaceSkill()
    ctx = SkillContext(client=None, workspace=workspace)
    created = json.loads(skill.handle_tool("create_data", {
        "table_name": "measurements", "rows": [{"value": 1}], "input_sources": [],
    }, ctx).text)
    assert created["table_name"] == "measurements"
    assert workspace.read_data_as_df("measurements")["value"].tolist() == [1]
    with pytest.raises(ValueError, match="exists"):
        skill.handle_tool("create_data", {
            "table_name": "measurements", "rows": [{"value": 2}], "input_sources": [],
        }, ctx)
    updated = json.loads(skill.handle_tool("update_data", {
        "table_name": "measurements", "rows": [{"value": 3}], "input_sources": [],
        "expected_content_hash": created["content_hash"],
    }, ctx).text)
    assert updated["table_name"] == created["table_name"]
    assert workspace.read_data_as_df("measurements")["value"].tolist() == [3]
    inventory = json.loads(skill.handle_tool("list_workspace_items", {"scope": "input"}, ctx).text)
    assert inventory["items"][0]["content_hash"] == updated["content_hash"]
    assert ctx.payload["workspace_inputs"].data[0].display_name == "measurements"
    with pytest.raises(ValueError, match="changed"):
        skill.handle_tool("update_data", {
            "table_name": "measurements", "rows": [{"value": 4}], "input_sources": [],
            "expected_content_hash": created["content_hash"],
        }, ctx)
    workspace.write_parquet(pd.DataFrame({"value": [9]}), "uploaded")
    with pytest.raises(ValueError, match="protected"):
        skill.handle_tool("update_data", {
            "table_name": "uploaded", "rows": [{"value": 0}], "input_sources": [],
            "expected_content_hash": workspace.get_table_metadata("uploaded").content_hash,
        }, ctx)
    assert workspace.read_data_as_df("uploaded")["value"].tolist() == [9]


def test_agent_data_python_provenance_staleness_and_failed_update(tmp_path):
    workspace = Workspace("test-user", root_dir=tmp_path)
    skill = WorkspaceSkill()
    ctx = SkillContext(client=None, workspace=workspace, runtime=_agent(workspace))
    created = json.loads(skill.handle_tool("create_data", {
        "table_name": "measurements", "rows": [{"value": 2}], "input_sources": [],
    }, ctx).text)
    source = ctx.payload["workspace_inputs"].data[0]
    workspace.save_scratch_file("factor.txt", b"2")
    derived = json.loads(skill.handle_tool("create_data", {
        "table_name": "doubled", "input_sources": [{"id": source.id, "kind": "data"},
                                                      {"id": "scratch/factor.txt", "kind": "file"}],
        "code": f"import pandas as pd\nresult = pd.read_parquet({created['path']!r})\nresult['value'] *= int(open('scratch/factor.txt').read())",
        "output_variable": "result",
    }, ctx).text)
    assert workspace.read_data_as_df("doubled")["value"].tolist() == [4]
    assert workspace.get_table_metadata("doubled").role == "derived"
    assert derived["input_sources"][0]["content_hash"] == created["content_hash"]
    assert derived["input_sources"][1]["content_hash"] == hashlib.sha256(b"2").hexdigest()
    original_file = workspace.get_table_metadata("measurements").filename
    with pytest.raises(ValueError):
        skill.handle_tool("update_data", {
            "table_name": "measurements", "expected_content_hash": created["content_hash"],
            "input_sources": [], "code": "result = 'not a table'", "output_variable": "result",
        }, ctx)
    assert workspace.get_table_metadata("measurements").filename == original_file
    assert workspace.read_data_as_df("measurements")["value"].tolist() == [2]
    skill.handle_tool("update_data", {
        "table_name": "measurements", "expected_content_hash": created["content_hash"],
        "rows": [{"value": 3}], "input_sources": [],
    }, ctx)
    assert workspace.get_table_metadata("doubled").stale
    assert workspace.read_data_as_df("doubled")["value"].tolist() == [4]
    restored = Workspace("test-user", root_dir=tmp_path).get_table_metadata("measurements")
    assert restored.origin == "agent"
    assert restored.edit_policy == "agent_editable"


def test_create_file_is_create_only_and_listed_as_input(tmp_path):
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.save_workspace_file(b"original", "source.md", "text/markdown")
    skill = WorkspaceSkill()
    ctx = SkillContext(client=None, workspace=workspace)
    result = json.loads(skill.handle_tool("create_file", {
        "filename": "summary.md", "content": "# Summary", "display_name": "  UNESCO Education  ",
    }, ctx).text)
    assert result["path"] == "files/summary.md"
    assert result["url"] == "/api/workspace/files/summary.md"
    assert result["display_name"] == "UNESCO Education"
    assert Workspace("test-user", root_dir=tmp_path).read_workspace_file("summary.md")[0].display_name == "UNESCO Education"
    assert workspace.list_scratch_files() == []
    assert workspace.read_workspace_file("summary.md")[1] == b"# Summary"
    assert workspace.read_workspace_file("source.md")[1] == b"original"
    listed = json.loads(skill.handle_tool("list_workspace_items", {"scope": "input", "query": "summary"}, ctx).text)
    item = listed["items"][0]
    assert item["path"] == result["path"]
    assert item["display_name"] == "UNESCO Education"
    assert item["managed_by"] == "agent"
    assert item["edit_policy"] == "agent_editable"
    assert item["content_hash"] == result["content_hash"]
    assert "# Summary" in skill.handle_tool("read_workspace_item", {"item_id": item["id"]}, ctx).text
    assert json.loads(skill.handle_tool("search_workspace_items", {"query": "Summary"}, ctx).text)["matches"]
    with pytest.raises(ValueError, match="already exists"):
        skill.handle_tool("create_file", {"filename": "summary.md", "content": "overwrite"}, ctx)
    assert workspace.read_workspace_file("summary.md")[1] == b"# Summary"
    for filename in ("../escape.md", "/absolute.md", "sub/file.md", "sub\\file.md", "_internal.md", ".hidden", "data_operations"):
        with pytest.raises(ValueError):
            skill.handle_tool("create_file", {"filename": filename, "content": "bad"}, ctx)
    with pytest.raises(ValueError, match="2 MB"):
        skill.handle_tool("create_file", {"filename": "large.md", "content": "x" * 2_000_001}, ctx)
    for display_name in ("", "   ", "x" * 81, "two\nlines", 42):
        with pytest.raises(ValueError, match="display_name"):
            skill.handle_tool("create_file", {
                "filename": "invalid.md", "content": "bad", "display_name": display_name,
            }, ctx)
    assert "invalid.md" not in workspace.get_metadata().files


def test_obsolete_write_tools_are_not_available(tmp_path):
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.save_workspace_file(b"original", "summary.md", "text/markdown")
    workspace.confined_scratch.write("summary.md", b"# Generated")
    workspace.set_scratch_display_name("summary.md", "Education Summary")
    ctx = SkillContext(client=None, workspace=workspace)
    for name in ("create_temp_file", "add_to_workspace", "manage_workspace_memory", "create_scratch_file", "edit_scratch_file"):
        result = WorkspaceSkill().handle_tool(name, {
            "path": "scratch/summary.md", "filename": "new.md", "content": "changed",
            "action": "save", "kind": "text", "name": "new", "description": "notes",
        }, ctx)
        assert "has no tool" in result.text
    assert [item.name for item in workspace.list_workspace_files()] == ["summary.md"]
    assert workspace.list_memory() == []
    assert workspace.read_workspace_file("summary.md")[1] == b"original"
    assert workspace.confined_scratch.read_text("summary.md") == "# Generated"


def test_python_artifact_combines_user_source_and_prior_scratch(tmp_path):
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.write_parquet(pd.DataFrame({"value": [2, 3]}), "source")
    workspace.confined_scratch.write("factor.txt", b"4")
    ctx = SkillContext(client=None, workspace=workspace, runtime=_agent(workspace))
    result = json.loads(WorkspaceSkill().handle_tool("create_file", {
        "filename": "computed.parquet",
        "code": "import pandas as pd\nresult = pd.read_parquet('data/source.parquet')\n"
                "result['value'] *= int(open('scratch/factor.txt').read())",
        "output_variable": "result",
    }, ctx).text)
    assert result["path"] == "files/computed.parquet"
    assert pd.read_parquet(io.BytesIO(workspace.read_workspace_file("computed.parquet")[1]))["value"].tolist() == [8, 12]
    assert workspace.read_data_as_df("source")["value"].tolist() == [2, 3]
    revised = json.loads(WorkspaceSkill().handle_tool("edit_file", {
        "path": result["path"], "expected_content_hash": result["content_hash"],
        "code": "import pandas as pd\nresult = pd.read_parquet('files/computed.parquet')\nresult['value'] += 1",
        "output_variable": "result",
    }, ctx).text)
    computed = ctx.runtime.run_explore_code(
        f"import pandas as pd\nprint(pd.read_parquet({revised['path']!r})['value'].sum())", [],
    )
    assert computed["status"] == "ok"
    assert computed["stdout"].strip() == "22"
    assert workspace.read_data_as_df("source")["value"].tolist() == [2, 3]
    assert ctx.payload.get("input_tables", []) == []


def test_file_edits_do_not_register_or_overwrite_sources(tmp_path):
    registry = build_registry()
    assert "add_to_workspace" not in registry.metas["workspace"].tool_names
    schema = next(tool["function"] for tool in registry.tools_for(["workspace"])
                  if tool["function"]["name"] == "create_file")
    assert "code" in schema["parameters"]["properties"]
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.write_parquet(pd.DataFrame({"value": [1]}), "computed")
    original = pd.DataFrame({"value": [8, 12]}).to_parquet(index=False)
    workspace.save_workspace_file(original, "computed.parquet", agent_managed=True)
    ctx = SkillContext(client=None, workspace=workspace, payload={"input_tables": []})
    skill = WorkspaceSkill()
    result = json.loads(skill.handle_tool("edit_file", {
        "path": "files/computed.parquet", "expected_content_hash": hashlib.sha256(original).hexdigest(),
        "content": original,
    }, ctx).text)
    assert result["path"] == "files/computed.parquet"
    assert workspace.read_data_as_df("computed")["value"].tolist() == [1]
    assert workspace.get_table_metadata("computed_2") is None
    assert ctx.payload["input_tables"] == []
    items = json.loads(skill.handle_tool("list_workspace_items", {"scope": "input"}, ctx).text)["items"]
    assert not any(item["name"] == "computed_2" for item in items)
    workspace.confined_scratch.write("nested/prior.txt", b"prior")
    workspace.confined_scratch.write("_explore_ns/private.txt", b"private")
    items = json.loads(skill.handle_tool("list_workspace_items", {"scope": "temp"}, ctx).text)["items"]
    assert {item["path"] for item in items} == {"scratch/nested/prior.txt"}
    for path in ("data/computed.parquet", "scratch/../data/computed.parquet", "scratch/_explore_ns/private.txt"):
        with pytest.raises(ValueError):
            skill.handle_tool("edit_file", {
                "path": path, "expected_content_hash": result["content_hash"], "content": "bad",
            }, ctx)


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
    assert "current locally readable input inventory" in rendered
    assert "additional user-selected workspace sources" in rendered
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


def test_external_table_reference_is_session_context_not_file_or_computation_data(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    reference = {
        "kind": "external-table-reference", "id": "external:adx:events-key",
        "connectorId": "adx", "tableKey": "events-key",
        "sourceTable": {"id": "events", "name": "events"},
        "displayName": "Events", "capturedAt": "2026-09-18T12:00:00Z",
        "summary": {"rowCount": 19521849, "columns": [{"name": "timestamp", "type": "datetime"}],
                "sampleRows": [{"timestamp": "2026-09-18"}], "sampleTruncated": False},
    }
    manifest = build_workspace_input_manifest([], workspace.list_workspace_files(), workspace)
    rendered = render_external_reference_context([reference], reference["id"])

    assert not manifest.data
    assert not manifest.files
    assert "events-key" in rendered
    assert "timestamp" in rendered
    assert "workspace Data Access Paths" in rendered
    assert "untrusted data" in rendered
    assert "not an executed query" in rendered
    assert "not the full population or a random sample" in rendered
    assert json.loads(rendered.splitlines()[-1])["references"][0]["summary"]["sampleRows"] == reference["summary"]["sampleRows"]
    assert "not Python-readable files or tables" in rendered
    assert "connectorId to source_id" in rendered
    assert json.loads(rendered.splitlines()[-1])["focused_reference"] == reference["id"]
    empty = render_external_reference_context([], reference["id"])
    assert json.loads(empty.splitlines()[-1]) == {"focused_reference": None, "references": []}
    assert "supersedes earlier" in empty
    assert len(empty) < 250
    assert json.loads(render_external_reference_context([None, {}]).splitlines()[-1])["references"] == []
    context = SkillContext(client=None, workspace=workspace, payload={"external_references": [reference]})
    skill = WorkspaceSkill()
    listed = json.loads(skill.handle_tool("list_workspace_items", {"scope": "input"}, context).text)
    assert listed["count"] == 1
    assert listed["items"][0]["source_id"] == "adx"
    assert listed["items"][0]["table_key"] == "events-key"
    assert "path" not in listed["items"][0]
    assert "python" not in listed["items"][0]["capabilities"]
    data_items = json.loads(skill.handle_tool("list_workspace_items", {"kinds": ["data"]}, context).text)["items"]
    assert data_items == listed["items"]
    assert json.loads(skill.handle_tool("list_workspace_items", {"kinds": ["file"]}, context).text)["count"] == 0
    assert json.loads(skill.handle_tool("list_workspace_items", {"kinds": ["external-table-reference"]}, context).text)["count"] == 1
    assert json.loads(skill.handle_tool("list_workspace_items", {"query": "missing"}, context).text)["count"] == 0
    read = json.loads(skill.handle_tool("read_workspace_item", {"item_id": reference["id"]}, context).text)
    assert read["reference"]["summary"] == reference["summary"]
    assert "propose_data_operation" not in rendered
    assert "connector_inputs" not in rendered
    assert "query_capabilities" in json.loads(rendered.splitlines()[-1])["references"][0]

    workspace.save_workspace_file(b"timestamp notes", "notes.txt", "text/plain")
    for selection in ({}, {"kinds": ["data"]}, {"kinds": ["external-table-reference"]},
                      {"item_ids": [reference["id"]]}):
        searched = json.loads(skill.handle_tool("search_workspace_items", {
            "query": "TIMESTAMP", **selection,
        }, context).text)
        reference_matches = [match for match in searched["matches"] if match["input_id"] == reference["id"]]
        assert len(reference_matches) == 1
        assert reference_matches[0]["match_type"] == "metadata"
        assert reference_matches[0]["table_key"] == "events-key"
        assert "not remote rows" in searched["note"]
        assert searched["count"] == (1 if selection else 2)
    missing = json.loads(skill.handle_tool("search_workspace_items", {
        "query": "unknown value", "item_ids": [reference["id"]],
    }, context).text)
    assert missing["matches"] == []
    assert missing["metadata_only_sources"][0]["input_id"] == reference["id"]
    assert "probe_data" in missing["note"]
    files = json.loads(skill.handle_tool("search_workspace_items", {
        "query": "timestamp", "kinds": ["file"],
    }, context).text)
    assert files["count"] == 1
    assert "metadata_only_sources" not in files
    bounded = json.loads(skill.handle_tool("search_workspace_items", {
        "query": "timestamp", "max_results": 1,
    }, context).text)
    assert bounded["count"] == 1
    assert bounded["metadata_only_sources"][0]["input_id"] == reference["id"]
    with pytest.raises(ValueError, match="Input not found"):
        skill.handle_tool("search_workspace_items", {
            "query": "timestamp", "item_ids": ["external:missing"],
        }, context)


def test_external_reference_agent_context_bounds_large_ui_samples() -> None:
    reference = {
        "kind": "external-table-reference", "id": "external:test:reviews",
        "connectorId": "test", "tableKey": "reviews", "displayName": "Reviews",
        "summary": {"columns": [{"name": "review", "type": "string"}],
                    "sampleRows": [{"review": f"review {index}"} for index in range(50)]},
    }
    rendered = render_external_reference_context([reference])
    normalized = json.loads(rendered.splitlines()[-1])["references"]
    assert len(normalized[0]["summary"]["sampleRows"]) == 5
    assert normalized[0]["summary"]["cachedSampleRowCount"] == 50
    assert len(reference["summary"]["sampleRows"]) == 50
    assert json.loads(render_external_reference_context(normalized).splitlines()[-1])["references"] == normalized


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
    }
    assert {"create_file", "edit_file"} <= tool_names
    assert not {"create_scratch_file", "edit_scratch_file"} & tool_names
    edit_schema = next(
        tool["function"]["parameters"]
        for tool in tools
        if tool["function"]["name"] == "edit_file"
    )
    assert edit_schema["required"] == ["path", "expected_content_hash"]
    assert {"content", "code", "replacements", "append_text"} <= edit_schema["properties"].keys()


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


def test_edit_file_patches_replaces_and_rejects_stale_writes(tmp_path):
    workspace = Workspace("test-user", root_dir=tmp_path)
    protected = workspace.save_workspace_file(b"Protected", "source.md")
    ctx = SkillContext(client=None, workspace=workspace)
    skill = WorkspaceSkill()
    created = json.loads(skill.handle_tool("create_file", {
        "filename": "notes.md", "content": "Owner: Casey\n", "display_name": "Team Notes",
    }, ctx).text)
    patched = json.loads(skill.handle_tool("edit_file", {
        "path": created["path"], "expected_content_hash": created["content_hash"],
        "replacements": [{"old_text": "Casey", "new_text": "Morgan"}], "append_text": "Ready\n",
    }, ctx).text)
    assert workspace.read_workspace_file("notes.md")[1] == b"Owner: Morgan\nReady\n"
    assert patched["display_name"] == "Team Notes"
    assert patched["content_hash"] != created["content_hash"]
    with pytest.raises(ValueError, match="changed"):
        skill.handle_tool("edit_file", {
            "path": created["path"], "expected_content_hash": created["content_hash"], "content": "stale",
        }, ctx)
    replaced = json.loads(skill.handle_tool("edit_file", {
        "path": created["path"], "expected_content_hash": patched["content_hash"],
        "content": "Revised", "display_name": "Revised Notes",
    }, ctx).text)
    assert replaced["display_name"] == "Revised Notes"
    assert workspace.read_workspace_file("notes.md")[1] == b"Revised"
    assert workspace.read_workspace_file("source.md")[1] == b"Protected"
    assert ctx.payload.get("scratch_files", []) == []
    with pytest.raises(ValueError, match="protected"):
        skill.handle_tool("edit_file", {"path": "files/source.md", "expected_content_hash": protected.content_hash,
                                      "content": "overwrite"}, ctx)
    for path in ("files/../notes.md", "scratch/../files/notes.md", "scratch/_private.txt", "files/missing.md"):
        with pytest.raises((ValueError, FileNotFoundError)):
            skill.handle_tool("edit_file", {
                "path": path, "expected_content_hash": replaced["content_hash"], "content": "bad",
            }, ctx)


def test_workspace_lists_visible_temp_items_from_storage(tmp_path: Path) -> None:
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

    context.workspace.confined_scratch.write("report.pdf", b"report")
    context.workspace.confined_scratch.write("sales.csv", b"sales")
    context.workspace.confined_scratch.write("_internal/report.pdf", b"private")
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
            "content_hash": hashlib.sha256(b"report").hexdigest(),
            "path": "scratch/report.pdf",
            "capabilities": ["python"],
        }],
        "count": 1,
    }


def test_file_binary_edits_recheck_hash_after_computation(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    context = SkillContext(client=None, workspace=workspace, runtime=_agent(workspace))
    skill = WorkspaceSkill()
    saved = json.loads(skill.handle_tool("create_file", {
        "filename": "report.bin", "code": "result = bytes([0, 1, 255])", "output_variable": "result",
    }, context).text)
    assert workspace.read_workspace_file("report.bin")[1] == bytes([0, 1, 255])
    arguments = {"path": saved["path"], "expected_content_hash": saved["content_hash"], "output_variable": "result"}
    with pytest.raises(ValueError):
        skill.handle_tool("edit_file", {**arguments, "code": "raise ValueError('failed')"}, context)
    assert workspace.read_workspace_file("report.bin")[1] == bytes([0, 1, 255])
    revised = json.loads(skill.handle_tool("edit_file", {
        **arguments, "code": "result = bytes([0, 2, 254])",
    }, context).text)
    assert workspace.read_workspace_file("report.bin")[1] == bytes([0, 2, 254])

    class ConcurrentRuntime:
        def run_explore_code(self, *args, **kwargs):
            workspace.save_workspace_file(b"concurrent", "report.bin", agent_managed=True,
                                          expected_content_hash=revised["content_hash"])
            return {"status": "ok", "output": b"stale output"}

    context.runtime = ConcurrentRuntime()
    with pytest.raises(ValueError, match="changed"):
        skill.handle_tool("edit_file", {
            **arguments, "expected_content_hash": revised["content_hash"], "code": "result = b'stale output'",
        }, context)
    assert workspace.read_workspace_file("report.bin")[1] == b"concurrent"
    assert workspace.list_scratch_files() == []


def test_file_text_edits_preserve_bytes_and_reject_invalid_patches(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    context = SkillContext(client=None, workspace=workspace)
    skill = WorkspaceSkill()
    saved = json.loads(skill.handle_tool("create_file", {
        "filename": "notes.txt", "content": "Owner: Casey\r\nOwner: Casey\r\n",
    }, context).text)
    arguments = {"path": saved["path"], "expected_content_hash": saved["content_hash"]}
    for changes in ({}, {"content": "bad", "append_text": "bad"}, {"content": None},
                    {"replacements": [{"old_text": "missing", "new_text": "bad"}]},
                    {"replacements": [{"old_text": "Casey", "new_text": "Morgan"}]}):
        with pytest.raises(ValueError):
            skill.handle_tool("edit_file", {**arguments, **changes}, context)
        assert workspace.read_workspace_file("notes.txt")[1] == b"Owner: Casey\r\nOwner: Casey\r\n"
    revised = json.loads(skill.handle_tool("edit_file", {
        **arguments, "replacements": [{"old_text": "Casey", "new_text": "Morgan", "replace_all": True}],
        "append_text": "Status: active\r\n",
    }, context).text)
    content = workspace.read_workspace_file("notes.txt")[1]
    assert content == b"Owner: Morgan\r\nOwner: Morgan\r\nStatus: active\r\n"
    assert revised["content_hash"] == hashlib.sha256(content).hexdigest()


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