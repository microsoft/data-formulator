"""Normalized text extraction for durable non-table workspace files."""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from data_formulator.errors import AppError, ErrorCode


MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_DOCX_XML_BYTES = 5 * 1024 * 1024
MAX_TEXT_CHARS = 200_000
MAX_PDF_PREVIEW_PAGES = 20
TEXT_EXTENSIONS = {
    ".csv", ".json", ".log", ".md", ".py", ".sql", ".tsv", ".txt", ".xml", ".yaml", ".yml",
}


@dataclass(frozen=True)
class WorkspaceFileText:
    name: str
    content: str
    truncated: bool


def _bounded_text(content: str) -> tuple[str, bool]:
    if len(content) <= MAX_TEXT_CHARS:
        return content, False
    return content[:MAX_TEXT_CHARS], True


def _extract_docx_text(content: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            info = archive.getinfo("word/document.xml")
            if info.file_size > MAX_DOCX_XML_BYTES:
                raise AppError(ErrorCode.FILE_TOO_LARGE, "Document is too large to read")
            document_xml = archive.read(info)
    except (KeyError, zipfile.BadZipFile) as exc:
        raise AppError(ErrorCode.FILE_PARSE_ERROR, "Invalid DOCX document") from exc

    try:
        root = ElementTree.fromstring(document_xml)
    except ElementTree.ParseError as exc:
        raise AppError(ErrorCode.FILE_PARSE_ERROR, "Invalid DOCX document") from exc

    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs: list[str] = []
    for paragraph in root.iter(f"{namespace}p"):
        parts: list[str] = []
        for node in paragraph.iter():
            if node.tag == f"{namespace}t" and node.text:
                parts.append(node.text)
            elif node.tag == f"{namespace}tab":
                parts.append("\t")
            elif node.tag in {f"{namespace}br", f"{namespace}cr"}:
                parts.append("\n")
        paragraphs.append("".join(parts))
    return "\n".join(paragraphs)


def _extract_pdf_text(content: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(content))
        return "\n\n".join(
            page.extract_text() or "" for page in reader.pages[:MAX_PDF_PREVIEW_PAGES]
        )
    except (PdfReadError, ValueError) as exc:
        raise AppError(ErrorCode.FILE_PARSE_ERROR, "Invalid PDF document") from exc


def extract_workspace_file_text(
    name: str,
    content: bytes,
    media_type: str | None = None,
) -> WorkspaceFileText:
    """Extract bounded text from an uploaded or persisted workspace file."""
    if len(content) > MAX_FILE_BYTES:
        raise AppError(ErrorCode.FILE_TOO_LARGE, "File is too large to read")

    extension = Path(name).suffix.lower()
    if extension == ".docx":
        text = _extract_docx_text(content)
    elif extension == ".pdf":
        text = _extract_pdf_text(content)
    elif extension in TEXT_EXTENSIONS or (media_type or "").startswith("text/"):
        text = content.decode("utf-8", errors="replace")
    else:
        raise AppError(ErrorCode.FILE_PARSE_ERROR, "Text extraction is not available for this file type")

    bounded, truncated = _bounded_text(text)
    return WorkspaceFileText(name=name, content=bounded, truncated=truncated)


def read_workspace_file_text(workspace: Any, name: str) -> WorkspaceFileText:
    """Read a durable workspace file as bounded normalized text."""
    try:
        workspace_file, content = workspace.read_workspace_file(name)
    except FileNotFoundError as exc:
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "File not found") from exc

    return extract_workspace_file_text(
        workspace_file.name,
        content,
        workspace_file.media_type,
    )