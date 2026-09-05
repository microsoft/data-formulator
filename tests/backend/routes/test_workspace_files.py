from __future__ import annotations

import io
import shutil
import zipfile
from unittest.mock import patch

import pytest
from flask import Flask

from data_formulator.datalake.workspace import Workspace
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


def test_duplicate_filenames_are_kept(client):
    assert _upload(client, "notes.md").get_json()["data"]["name"] == "notes.md"
    assert _upload(client, "notes.md").get_json()["data"]["name"] == "notes_2.md"


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