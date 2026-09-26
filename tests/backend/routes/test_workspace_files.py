from __future__ import annotations

import io
import shutil
import zipfile
from unittest.mock import Mock, patch

import pytest
from flask import Flask

from data_formulator.datalake.workspace import Workspace
from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.skills.workspace.skill import WorkspaceSkill
from data_formulator.routes.workspace_files import workspace_files_bp


pytestmark = [pytest.mark.backend]


@pytest.fixture()
def tmp_workspace(tmp_path):
    workspace = Workspace("test-user", root_dir=tmp_path)
    yield workspace
    shutil.rmtree(tmp_path, ignore_errors=True)


@pytest.fixture()
def client(tmp_workspace):
    from data_formulator.error_handler import register_error_handlers

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(workspace_files_bp)
    register_error_handlers(app)
    with patch(
        "data_formulator.routes.workspace_files._workspace",
        return_value=tmp_workspace,
    ):
        with app.test_client() as test_client:
            yield test_client


def _upload(client, filename: str, content: bytes = b"hello"):
    return client.post(
        "/api/workspace/files",
        data={"file": (io.BytesIO(content), filename)},
        content_type="multipart/form-data",
    )

def test_local_connector_import_preserves_files(tmp_workspace, tmp_path):
    from data_formulator.data_connector import connectors_bp
    from data_formulator.data_loader.local_folder_data_loader import LocalFolderDataLoader
    from data_formulator.error_handler import register_error_handlers

    root = tmp_path / "source"
    root.mkdir()
    (root / "notes.md").write_bytes(b"# Source notes")
    (root / "book.xlsx").write_bytes(b"unchanged workbook")
    loader = LocalFolderDataLoader({"root_dir": str(root)})
    assert loader.test_connection()
    source = Mock()
    source._require_loader.return_value = loader
    app = Flask(__name__)
    app.register_blueprint(connectors_bp)
    register_error_handlers(app)
    with patch("data_formulator.data_connector._resolve_connector", return_value=source), \
         patch("data_formulator.workspace_factory.get_workspace", return_value=tmp_workspace), \
         patch("data_formulator.auth.identity.get_identity_id", return_value="test-user"):
        client = app.test_client()
        preview = client.post("/api/connectors/preview-file", json={"connector_id": "local", "source_path": "notes.md"})
        assert preview.data == b"# Source notes"
        assert tmp_workspace.list_workspace_files() == []
        assert client.post("/api/connectors/preview-file", json={"source_path": "../outside.md"}).get_json()["status"] == "error"
        for name, content in (("notes.md", b"# Source notes"), ("book.xlsx", b"unchanged workbook")):
            response = client.post("/api/connectors/import-file", json={"connector_id": "local", "source_path": name})
            assert response.status_code == 200
            assert response.get_json()["data"]["name"] == name
            assert tmp_workspace.read_workspace_file(name)[1] == content
        duplicate = client.post("/api/connectors/import-file", json={"connector_id": "local", "source_path": "notes.md"})
        assert duplicate.get_json()["data"]["name"] == "notes_2.md"
        for path in ("../outside.md", str(root / "notes.md")):
            assert client.post("/api/connectors/import-file", json={"source_path": path}).get_json()["status"] == "error"
        source._require_loader.return_value = Mock()
        assert client.post("/api/connectors/import-file", json={"source_path": "notes.md"}).get_json()["status"] == "error"


def test_upload_list_download_and_delete(client, tmp_workspace):
    response = _upload(client, "README.md", b"# Dataset")
    assert response.get_json()["data"]["name"] == "README.md"
    assert (tmp_workspace._path / "files" / "README.md").read_bytes() == b"# Dataset"

    listed = client.get("/api/workspace/files").get_json()["data"]["files"]
    assert [item["name"] for item in listed] == ["README.md"]

    downloaded = client.get("/api/workspace/files/README.md")
    assert downloaded.data == b"# Dataset"

    deleted = client.delete("/api/workspace/files/README.md")
    assert deleted.get_json()["status"] == "success"
    assert client.get("/api/workspace/files").get_json()["data"]["files"] == []


def test_diagnostics_include_managed_parquet_files_with_bounded_read_only_access(client, tmp_workspace):
    import pyarrow as pa
    import pyarrow.parquet as pq

    metadata = tmp_workspace.write_parquet_from_arrow(pa.table({"value": list(range(75))}), "events")
    tmp_workspace.confined_scratch.write("note.txt", b"scratch note")
    _upload(client, "notes.md", b"saved note")
    path = f"data/{metadata.filename}"
    ordinary = client.get("/api/workspace/files?include_temp=true").get_json()["data"]["files"]
    assert path not in [item["name"] for item in ordinary]
    files = client.get("/api/workspace/files?include_temp=true&include_tables=true").get_json()["data"]["files"]
    assert [item["name"] for item in files] == [path, "notes.md", "scratch/note.txt"]
    assert files[0]["file_size"] > 0
    preview = client.get(f"/api/workspace/files/{path}/preview").get_json()["data"]
    assert preview["kind"] == "table"
    assert len(preview["rows"]) == 50
    assert preview["row_count"] == 75
    assert preview["truncated"] is True
    downloaded = client.get(f"/api/workspace/files/{path}")
    assert pq.read_table(io.BytesIO(downloaded.data)).num_rows == 75
    assert client.delete(f"/api/workspace/files/{path}").get_json()["status"] == "error"
    for invalid in ("data/missing.parquet", "data/../notes.md", "data/../events.parquet"):
        assert client.get(f"/api/workspace/files/{invalid}").get_json()["status"] == "error"
        assert client.get(f"/api/workspace/files/{invalid}/preview").get_json()["status"] == "error"
    assert tmp_workspace.get_table_metadata("events").row_count == 75


def test_duplicate_filenames_are_kept(client):
    assert _upload(client, "notes.md").get_json()["data"]["name"] == "notes.md"
    assert _upload(client, "notes.md").get_json()["data"]["name"] == "notes_2.md"

def test_excel_file_preview_keeps_workbook_and_bounds_sheets(client):
    from openpyxl import Workbook

    workbook = Workbook()
    workbook.active.title = "Revenue"
    workbook.active.append(["region", "value"])
    for index in range(60):
        workbook.active.append(["East", index])
    workbook.create_sheet("Notes").append(["Original workbook"])
    content = io.BytesIO()
    workbook.save(content)
    raw = content.getvalue()
    _upload(client, "sales.xlsx", raw)
    preview = client.get("/api/workspace/files/sales.xlsx/preview").get_json()["data"]
    assert "Sheet: Revenue" in preview["content"]
    assert "Sheet: Notes" in preview["content"]
    assert "Original workbook" in preview["content"]
    assert preview["truncated"] is True
    assert client.get("/api/workspace/files/sales.xlsx").data == raw


def test_temporary_files_are_visible_read_only_and_confined(client, tmp_workspace, tmp_path):
    tmp_workspace.confined_scratch.write("result.md", b"# Result")
    tmp_workspace.confined_scratch.write("_explore_ns/state.bin", b"internal")
    tmp_workspace.confined_scratch.write("data_operations/operation.json", b"{}")
    outside = tmp_path / "private.txt"
    outside.write_text("private")
    (tmp_workspace.confined_scratch.root / "escape.txt").symlink_to(outside)
    assert client.get("/api/workspace/files").get_json()["data"]["files"] == []
    files = client.get("/api/workspace/files?include_temp=true").get_json()["data"]["files"]
    assert [item["name"] for item in files] == ["scratch/result.md"]
    assert files[0]["temporary"] is True
    assert client.get("/api/workspace/files/scratch/result.md/text").get_json()["data"]["content"] == "# Result"
    assert client.get("/api/workspace/files/scratch/result.md").data == b"# Result"
    assert client.put("/api/workspace/files/scratch/result.md/text", json={"content": "changed", "content_hash": ""}).get_json()["status"] == "error"
    for name in ("scratch/_explore_ns/state.bin", "scratch/data_operations/operation.json", "scratch/escape.txt", "scratch/../private.txt"):
        assert client.get(f"/api/workspace/files/{name}").get_json()["status"] == "error"
        assert client.delete(f"/api/workspace/files/{name}").get_json()["status"] == "error"
    assert outside.read_text() == "private"
    assert tmp_workspace.confined_scratch.resolve("_explore_ns/state.bin").is_file()
    assert tmp_workspace.confined_scratch.resolve("data_operations/operation.json").is_file()
    _upload(client, "result.md", b"Saved result")
    assert client.delete("/api/workspace/files/scratch/result.md").get_json()["status"] == "success"
    assert not tmp_workspace.confined_scratch.resolve("result.md").exists()
    assert client.get("/api/workspace/files/result.md").data == b"Saved result"
    assert client.delete("/api/workspace/files/scratch/result.md").get_json()["status"] == "error"
    files = client.get("/api/workspace/files?include_temp=true").get_json()["data"]["files"]
    assert [item["name"] for item in files] == ["result.md"]


def test_agent_display_name_is_listed_without_changing_filename(client, tmp_workspace):
    WorkspaceSkill().handle_tool("create_file", {
        "filename": "unesco_education_summary.md", "content": "# Education",
        "display_name": "UNESCO Education",
    }, SkillContext(client=None, workspace=tmp_workspace))
    files = client.get("/api/workspace/files").get_json()["data"]["files"]
    assert len(files) == 1
    assert files[0]["display_name"] == "UNESCO Education"
    assert files[0]["name"] == "unesco_education_summary.md"
    assert files[0]["origin"] == "agent"
    assert files[0]["edit_policy"] == "agent_editable"
    assert client.get("/api/workspace/files/unesco_education_summary.md").data == b"# Education"
    preview = client.get("/api/workspace/files/unesco_education_summary.md/text").get_json()["data"]
    assert preview["display_name"] == "UNESCO Education"
    user_edit = client.put("/api/workspace/files/unesco_education_summary.md/text", json={
        "content": "# User revision", "content_hash": preview["content_hash"],
    }).get_json()["data"]
    assert user_edit["origin"] == "agent"
    assert user_edit["display_name"] == "UNESCO Education"
    with pytest.raises(ValueError, match="changed"):
        WorkspaceSkill().handle_tool("edit_file", {
            "path": "files/unesco_education_summary.md", "expected_content_hash": preview["content_hash"],
            "content": "stale",
        }, SkillContext(client=None, workspace=tmp_workspace))
    WorkspaceSkill().handle_tool("edit_file", {
        "path": "files/unesco_education_summary.md",
        "expected_content_hash": user_edit["content_hash"],
        "content": "# Revised Education",
    }, SkillContext(client=None, workspace=tmp_workspace))
    saved_files = client.get("/api/workspace/files").get_json()["data"]["files"]
    assert saved_files[0]["display_name"] == "UNESCO Education"
    assert client.get("/api/workspace/files/unesco_education_summary.md").data == b"# Revised Education"
    assert client.delete("/api/workspace/files/unesco_education_summary.md").get_json()["status"] == "success"


@pytest.mark.parametrize("temporary", [False, True])
def test_parquet_preview_is_bounded(client, tmp_workspace, temporary):
    import pandas as pd
    content = pd.DataFrame({"value": range(70), "details": ["x" * 1500] * 70}).to_parquet(index=False)
    if temporary:
        tmp_workspace.save_scratch_file("computed.parquet", content)
    else:
        tmp_workspace.save_workspace_file(content, "computed.parquet", agent_managed=True)
    name = "scratch/computed.parquet" if temporary else "computed.parquet"
    preview = client.get(f"/api/workspace/files/{name}/preview").get_json()["data"]
    assert preview["kind"] == "table"
    assert preview["row_count"] == 70
    assert len(preview["rows"]) == 50
    assert preview["columns"] == ["value", "details"]
    assert preview["rows"][0] == {"value": 0, "details": "x" * 1000 + "..."}
    assert preview["truncated"] is True


def test_create_and_edit_text_file_without_overwriting_conflicts(client):
    created = client.post("/api/workspace/files/text", json={"name": "query.sql"}).get_json()["data"]
    assert client.get("/api/workspace/files/query.sql/text").get_json()["data"]["content"] == ""
    assert client.post("/api/workspace/files/text", json={"name": "query.sql"}).get_json()["status"] == "error"
    assert client.post("/api/workspace/files/text", json={"name": "../query.sql"}).get_json()["status"] == "error"
    saved = client.put("/api/workspace/files/query.sql/text", json={
        "content": "SELECT 1;", "content_hash": created["content_hash"],
    }).get_json()
    assert saved["data"]["content"] == "SELECT 1;"
    assert client.put("/api/workspace/files/query.sql/text", json={
        "content": "stale", "content_hash": created["content_hash"],
    }).get_json()["status"] == "error"
    assert client.get("/api/workspace/files/query.sql").data == b"SELECT 1;"


def test_rename_preserves_content_and_rejects_conflicts(client):
    original = _upload(client, "notes.md", b"# Notes").get_json()["data"]
    _upload(client, "existing.md", b"keep")
    for invalid in ("existing.md", "../escape.md", "", ".", ".."):
        assert client.patch("/api/workspace/files/notes.md", json={"name": invalid}).get_json()["status"] == "error"
    assert client.get("/api/workspace/files/notes.md").data == b"# Notes"
    assert client.get("/api/workspace/files/existing.md").data == b"keep"
    renamed = client.patch("/api/workspace/files/notes.md", json={"name": "Notes.md"}).get_json()["data"]
    assert renamed == {**original, "name": "Notes.md", "filename": "Notes.md"}
    assert client.get("/api/workspace/files/Notes.md").data == b"# Notes"
    assert client.get("/api/workspace/files/notes.md").get_json()["status"] == "error"
    saved = client.put("/api/workspace/files/Notes.md/text", json={
        "content": "Updated", "content_hash": original["content_hash"],
    }).get_json()
    assert saved["status"] == "success"
    assert client.get("/api/workspace/files/Notes.md").data == b"Updated"


def test_preview_markdown(client):
    _upload(client, "README.md", b"# Dataset\n\nMonthly revenue")

    preview = client.get("/api/workspace/files/README.md/preview").get_json()["data"]

    assert preview["content"] == "# Dataset\n\nMonthly revenue"
    assert preview["truncated"] is False


def test_preview_docx_as_plain_text(client):
    document_xml = b"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>
  <w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body>
</w:document>"""
    content = io.BytesIO()
    with zipfile.ZipFile(content, "w") as archive:
        archive.writestr("word/document.xml", document_xml)
    _upload(client, "paper.docx", content.getvalue())

    preview = client.get("/api/workspace/files/paper.docx/preview").get_json()["data"]

    assert preview["content"] == "First paragraph\nSecond paragraph"


def test_preview_uploaded_docx_without_persisting(client, tmp_workspace):
    document_xml = b"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Staged document</w:t></w:r></w:p></w:body>
</w:document>"""
    content = io.BytesIO()
    with zipfile.ZipFile(content, "w") as archive:
        archive.writestr("word/document.xml", document_xml)

    response = client.post(
        "/api/workspace/files/preview",
        data={"file": (io.BytesIO(content.getvalue()), "draft.docx")},
        content_type="multipart/form-data",
    )

    assert response.get_json()["data"]["content"] == "Staged document"
    assert tmp_workspace.list_workspace_files() == []