# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""A disk cache of HTTP answers, shared by the tool packs (Research: arXiv, OpenAlex; GitHub)."""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Response:
    status: int
    content: bytes
    headers: dict[str, str] = field(default_factory=dict)
    url: str = ""


class DiskCache:
    """Answers by URL in ``directory`` (none without one), each fresh for the ``ttl`` its reader gives (None: forever)."""

    def __init__(self, directory: Path | None) -> None:
        self.directory = directory

    def _path(self, url: str) -> Path | None:
        if not self.directory:
            return None
        return self.directory / hashlib.sha256(url.encode()).hexdigest()[:40]

    def get(self, url: str, ttl: float | None) -> Response | None:
        path = self._path(url)
        if not path or not path.exists():
            return None
        try:
            meta = json.loads(path.with_suffix(".json").read_text())
            if ttl is not None and time.time() - meta["at"] > ttl:
                return None
            return Response(200, path.read_bytes(), meta.get("headers", {}), meta.get("url", url))
        except (OSError, ValueError, KeyError):
            return None

    def put(self, url: str, response: Response) -> None:
        path = self._path(url)
        if not path:
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(response.content)
            keep = {key: value for key, value in response.headers.items() if key.lower() == "content-type"}
            path.with_suffix(".json").write_text(json.dumps({"at": time.time(), "url": response.url, "headers": keep}))
        except OSError:
            pass
