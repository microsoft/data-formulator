# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The Hugging Face toolkit's MCP server: find datasets on the Hugging Face Hub and load them as tables.

Started by Data Formulator over stdio (``python -m data_formulator.tool_packs.huggingface``). It reads the Hub's dataset
search and the dataset viewer's API (sizes, row previews, and the Parquet copy the viewer keeps of each dataset). Public
datasets need no token (the Hub allows this computer 500 API calls per 5 minutes); with the user's token (``HF_TOKEN``,
from the credential vault) the limits are the user's own, and gated datasets the user accepted on huggingface.co open.
``load_dataset`` returns a Parquet file the conversation saves to scratch: of a large split it reads only the columns and
rows asked for, with HTTP range requests. Answers are cached on disk.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
from pathlib import Path
from typing import Any, Literal

import httpx
import pyarrow as pa
import pyarrow.parquet as pq
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import BlobResourceContents, EmbeddedResource, TextContent, ToolAnnotations

from data_formulator.tool_packs.cache import DiskCache, Response

HUB = "https://huggingface.co"
VIEWER = "https://datasets-server.huggingface.co"
TTL_SEARCH = 3600
TTL_DATASET = 24 * 3600
MAX_LIMIT = 50
MAX_PREVIEW = 100
MAX_README = 12_000
MAX_CELL = 300
MAX_FILE_BYTES = 25 * 1024 * 1024
DEFAULT_MAX_ROWS = 100_000
MAX_ROWS = 1_000_000
READ_TIMEOUT = 60.0
PARQUET_MIME = "application/vnd.apache.parquet"

INSTRUCTIONS = """\
Find datasets on the Hugging Face Hub and load them as tables.
- search_datasets finds datasets (tabular ones by default), most downloaded first. Many Hub datasets are machine-learning
  benchmarks or synthetic: check each one's summary, license, size and `synthetic` flag, prefer real, documented data,
  and tell the user which dataset you chose and why.
- dataset_details gives a dataset's card (README), its subsets (configs) and splits with row counts, and its columns.
- preview_rows shows up to 100 rows of a split, to check the data before loading it.
- load_dataset returns a Parquet file saved to scratch; load it with create_data (in Python, pandas.read_parquet). Ask
  only for the columns you need, and set max_rows for a large split.
- If a dataset is gated or private, tell the user to accept its terms on huggingface.co and add a Hugging Face token to
  the toolkit in Tools. If a tool says the Hub is rate-limiting, wait as long as it says."""

READ_ONLY = ToolAnnotations(read_only_hint=True, idempotent_hint=True, open_world_hint=True)
_DATASET = re.compile(r"^(?:https?://huggingface\.co/datasets/)?(?P<id>(?:[A-Za-z0-9][\w.-]{0,95}/)?[A-Za-z0-9][\w.-]{0,95})/?$")


class HuggingFaceError(ToolError):
    """A failure the agent should read (the MCP SDK shows a ``ToolError``'s message to the model)."""


def parse_dataset(value: str) -> str:
    match = _DATASET.match(str(value or "").strip())
    if not match:
        raise HuggingFaceError(f"Name a dataset by its Hub id, owner/name (or its huggingface.co link), not {value!r}.")
    return match.group("id")


def _wait_seconds(reply: httpx.Response) -> str:
    """Seconds until the Hub's rate limit resets, from its ``RateLimit: "api";r=0;t=109`` header."""
    match = re.search(r"\bt=(\d+)", reply.headers.get("ratelimit", ""))
    return match.group(1) if match else reply.headers.get("retry-after") or "60"


def _failure(reply: httpx.Response, dataset: str | None, signed_in: bool) -> HuggingFaceError:
    try:
        message = str(reply.json().get("error") or "")
    except Exception:
        message = ""
    page = f"https://huggingface.co/datasets/{dataset}" if dataset else "the dataset's page on huggingface.co"
    if reply.status_code == 429:
        hint = "" if signed_in else " Adding a Hugging Face token to the toolkit (in Tools) raises the limit to the user's own."
        return HuggingFaceError(f"The Hugging Face Hub is rate-limiting these requests: wait about {_wait_seconds(reply)} "
                                f"seconds before asking again.{hint}")
    if reply.status_code in (401, 403) or "without authentication" in message or "gated" in message.lower():
        if signed_in:
            return HuggingFaceError(f"{dataset or 'This dataset'} is gated or private, and the token cannot open it: the user "
                                    f"must accept its terms at {page} with the same account.")
        return HuggingFaceError(f"{dataset or 'This dataset'} is gated or private. If it is gated, the user must accept its "
                                f"terms at {page} and add a Hugging Face token to the toolkit in Tools.")
    if reply.status_code == 404:
        return HuggingFaceError(message or f"Not found on Hugging Face: check the dataset id ({dataset or 'owner/name'}).")
    return HuggingFaceError(f"Hugging Face answered HTTP {reply.status_code}{': ' + message if message else ''}.")


class RemoteFile(io.RawIOBase):
    """A file on the Hub read with HTTP range requests, so a Parquet reader fetches only the parts it needs."""

    def __init__(self, http: httpx.Client, url: str, size: int, headers: dict[str, str]) -> None:
        self._http, self._url, self._size, self._headers = http, url, size, headers
        self._position = 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self._position, io.SEEK_END: self._size}[whence]
        self._position = max(0, base + offset)
        return self._position

    def readinto(self, buffer) -> int:  # type: ignore[override]
        if self._position >= self._size or not len(buffer):
            return 0
        end = min(self._size, self._position + len(buffer)) - 1
        try:
            reply = self._http.get(self._url, headers={**self._headers, "Range": f"bytes={self._position}-{end}"})
        except httpx.HTTPError as exc:
            raise HuggingFaceError(f"Could not read the dataset's file from Hugging Face ({type(exc).__name__}). "
                                   "Try again in a moment.") from None
        if reply.status_code not in (200, 206):
            raise _failure(reply, None, bool(self._headers))
        data = reply.content if reply.status_code == 206 else reply.content[self._position:end + 1]
        buffer[:len(data)] = data
        self._position += len(data)
        return len(data)


class Client:
    """The Hub's and the dataset viewer's APIs, as the user when there is a token, cached."""

    def __init__(self, cache_dir: Path | None = None, token: str | None = None, *,
                 transport: httpx.BaseTransport | None = None) -> None:
        self.token = (token or "").strip() or None
        self._cache = DiskCache(cache_dir)
        self._http = httpx.Client(transport=transport, follow_redirects=True, timeout=httpx.Timeout(READ_TIMEOUT, connect=10.0),
                                  headers={"User-Agent": "DataFormulator-HuggingFace/1.0 (+https://github.com/microsoft/data-formulator)"})

    @property
    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def _fetch(self, url: str, params: dict[str, Any] | None, ttl: float | None, dataset: str | None,
               missing_ok: bool = False) -> bytes | None:
        """GET ``url``'s body, cached. The token goes in a header, never the cache key."""
        full = str(httpx.URL(url, params=params or {}))
        key = full + ("#signed-in" if self.token else "")
        if (hit := self._cache.get(key, ttl)) is not None:
            return hit.content
        try:
            reply = self._http.get(full, headers=self._auth)
        except httpx.HTTPError as exc:
            raise HuggingFaceError(f"Could not reach Hugging Face ({type(exc).__name__}). Try again in a moment.") from None
        if reply.status_code == 200:
            self._cache.put(key, Response(200, reply.content, dict(reply.headers), full))
            return reply.content
        if missing_ok and reply.status_code == 404:
            return None
        raise _failure(reply, dataset, bool(self.token))

    def get_json(self, url: str, params: dict[str, Any] | None = None, *, ttl: float | None = TTL_SEARCH,
                 dataset: str | None = None) -> Any:
        return json.loads(self._fetch(url, params, ttl, dataset) or b"null")

    def get_text(self, url: str, *, ttl: float | None = TTL_DATASET) -> str | None:
        """A text file's contents, or None if there is none."""
        content = self._fetch(url, None, ttl, None, missing_ok=True)
        return content.decode("utf-8", errors="replace") if content is not None else None

    def open(self, url: str, size: int) -> io.BufferedReader:
        """A remote file to read in parts. Redirects resolve once, to the file's final address."""
        try:
            final = self._http.head(url, headers=self._auth)
        except httpx.HTTPError as exc:
            raise HuggingFaceError(f"Could not reach Hugging Face ({type(exc).__name__}). Try again in a moment.") from None
        if final.status_code not in (200, 206):
            raise _failure(final, None, bool(self.token))
        # A redirect to the file's storage needs no token (and must not get one).
        headers = self._auth if final.url.host == httpx.URL(url).host else {}
        return io.BufferedReader(RemoteFile(self._http, str(final.url), size, headers), buffer_size=1 << 20)

    def close(self) -> None:
        self._http.close()


_client: Client | None = None


def client() -> Client:
    global _client
    if _client is None:
        _client = Client(token=os.environ.get("HF_TOKEN"))
    return _client


def _tagged(tags: list[str], prefix: str) -> list[str]:
    return [tag.split(":", 1)[1] for tag in tags if tag.startswith(prefix + ":")]


def _summary(text: Any, limit: int = 240) -> str | None:
    words = " ".join(str(text or "").split())
    return (words if len(words) <= limit else words[:limit].rsplit(" ", 1)[0] + "…") or None


def _dataset_row(data: dict[str, Any]) -> dict[str, Any]:
    tags = [str(tag) for tag in data.get("tags") or []]
    card = data.get("cardData") or {}
    license_ = _tagged(tags, "license") or ([card["license"]] if isinstance(card.get("license"), str) else card.get("license") or [])
    return {
        "dataset": data.get("id"),
        "title": card.get("pretty_name"),
        "summary": _summary(data.get("description")),
        "downloads": data.get("downloads"),
        "likes": data.get("likes"),
        "license": ", ".join(license_) or None,
        "size": ", ".join(_tagged(tags, "size_categories")) or None,
        "formats": ", ".join(_tagged(tags, "format")) or None,
        "modalities": ", ".join(_tagged(tags, "modality")) or None,
        "gated": bool(data.get("gated")),
        "synthetic": any("synthetic" in tag.lower() for tag in tags),
        "updated": (data.get("lastModified") or "")[:10] or None,
        "url": f"{HUB}/datasets/{data.get('id')}",
    }


def _splits(dataset: str) -> list[dict[str, str]]:
    data = client().get_json(f"{VIEWER}/splits", {"dataset": dataset}, ttl=TTL_DATASET, dataset=dataset)
    splits = [{"config": item["config"], "split": item["split"]} for item in data.get("splits") or []]
    if not splits:
        raise HuggingFaceError(f"The dataset viewer has no copy of {dataset}, so it cannot be previewed or loaded here.")
    return splits


def _choose(dataset: str, config: str, split: str) -> tuple[str, str]:
    """The subset and split to read: the ones named, else "default" (or the first) and "train" (or the first)."""
    splits = _splits(dataset)
    configs = list(dict.fromkeys(item["config"] for item in splits))
    config = config.strip() or ("default" if "default" in configs else configs[0])
    if config not in configs:
        raise HuggingFaceError(f"{dataset} has no subset {config!r}; its subsets are: {', '.join(configs)}.")
    names = [item["split"] for item in splits if item["config"] == config]
    split = split.strip() or ("train" if "train" in names else names[0])
    if split not in names:
        raise HuggingFaceError(f"Subset {config!r} of {dataset} has no split {split!r}; its splits are: {', '.join(names)}.")
    return config, split


def _feature_type(feature: Any) -> str:
    if isinstance(feature, list):
        return f"list of {_feature_type(feature[0])}" if feature else "list"
    if not isinstance(feature, dict):
        return str(feature)
    kind = feature.get("_type")
    if kind == "Value":
        return str(feature.get("dtype"))
    if kind == "ClassLabel":
        names = feature.get("names") or []
        return f"label ({', '.join(map(str, names[:10]))}{', …' if len(names) > 10 else ''})"
    if kind in ("Sequence", "List", "LargeList"):
        return f"list of {_feature_type(feature.get('feature'))}"
    if kind:
        return kind.lower()
    return "struct"


def _cell(value: Any) -> Any:
    """A preview cell: long text cut, images and audio named rather than inlined."""
    if isinstance(value, dict) and "src" in value:
        return "[image]" if "height" in value or str(value.get("type", "")).startswith("image") else "[media]"
    if isinstance(value, list) and value and isinstance(value[0], dict) and "src" in value[0]:
        return "[media]"
    if isinstance(value, str):
        return value if len(value) <= MAX_CELL else value[:MAX_CELL] + "…"
    if isinstance(value, (list, dict)):
        text = json.dumps(value, ensure_ascii=False, default=str)
        return value if len(text) <= MAX_CELL else text[:MAX_CELL] + "…"
    return value


def _media(field: pa.Field) -> bool:
    """Whether a column holds file bytes (images, audio): too big for a table, so not loaded unless asked for."""
    kind = field.type
    if pa.types.is_binary(kind) or pa.types.is_large_binary(kind):
        return True
    return pa.types.is_struct(kind) and any(child.name == "bytes" for child in kind)


# -- tools --

app = MCPServer("huggingface", instructions=INSTRUCTIONS)


@app.tool(annotations=READ_ONLY)
def search_datasets(query: str, tabular_only: bool = True,
                    sort: Literal["downloads", "likes", "trending", "updated"] = "downloads",
                    limit: int = 20) -> dict[str, Any]:
    """Search datasets on the Hugging Face Hub by keywords, e.g. `stock prices` or `world happiness`. Tabular datasets
    only unless `tabular_only` is false. Each row has the dataset's id, summary, downloads (last month), likes, license,
    size, gated and synthetic flags. Up to 50."""
    params: dict[str, Any] = {"search": query.strip(), "limit": max(1, min(MAX_LIMIT, int(limit))), "full": "true",
                              "sort": {"trending": "trendingScore", "updated": "lastModified"}.get(sort, sort), "direction": -1}
    if tabular_only:
        params["filter"] = "modality:tabular"
    items = [item for item in client().get_json(f"{HUB}/api/datasets", params) or []
             if not item.get("private") and not item.get("disabled")]
    return {"query": query, "tabular_only": tabular_only, "returned": len(items), "datasets": [_dataset_row(item) for item in items]}


@app.tool(annotations=READ_ONLY)
def dataset_details(dataset: str, include_readme: bool = True) -> dict[str, Any]:
    """A dataset's facts, its card (README), its subsets and splits with row counts and sizes, and the columns of
    its default subset. Read this before loading a dataset."""
    dataset = parse_dataset(dataset)
    data = client().get_json(f"{HUB}/api/datasets/{dataset}", ttl=TTL_DATASET, dataset=dataset)
    result: dict[str, Any] = {**_dataset_row(data), "citation": (data.get("cardData") or {}).get("citation")}
    try:
        size = client().get_json(f"{VIEWER}/size", {"dataset": dataset}, ttl=TTL_DATASET, dataset=dataset).get("size") or {}
        result["tables"] = [{"config": item.get("config"), "split": item.get("split"), "rows": item.get("num_rows"),
                             "parquet_mb": round((item.get("num_bytes_parquet_files") or 0) / 1e6, 1)}
                            for item in size.get("splits") or []]
        config, _ = _choose(dataset, "", "")
        info = client().get_json(f"{VIEWER}/info", {"dataset": dataset, "config": config}, ttl=TTL_DATASET, dataset=dataset)
        features = (info.get("dataset_info") or {}).get("features") or {}
        result["columns"] = {"config": config, "types": {name: _feature_type(feature) for name, feature in features.items()}}
    except HuggingFaceError as exc:
        result["tables"] = None
        result["viewer"] = str(exc)
    if include_readme:
        readme = client().get_text(f"{HUB}/datasets/{dataset}/resolve/main/README.md")
        if readme:
            readme = re.sub(r"\A---\n.*?\n---\n", "", readme, flags=re.S).strip()
            result["readme"] = readme if len(readme) <= MAX_README else readme[:MAX_README] + f"\n\n[… cut at {MAX_README:,} characters]"
        else:
            result["readme"] = None
    return result


@app.tool(annotations=READ_ONLY)
def preview_rows(dataset: str, config: str = "", split: str = "", offset: int = 0, length: int = 20) -> dict[str, Any]:
    """Up to 100 rows of one split of a dataset, from `offset`, with its column types and total rows. `config` (the
    subset) and `split` default to "default" and "train". Long text is cut and images are named, not shown."""
    dataset = parse_dataset(dataset)
    config, split = _choose(dataset, config, split)
    data = client().get_json(f"{VIEWER}/rows", {"dataset": dataset, "config": config, "split": split,
                                                 "offset": max(0, int(offset)), "length": max(1, min(MAX_PREVIEW, int(length)))},
                             ttl=TTL_DATASET, dataset=dataset)
    return {"dataset": dataset, "config": config, "split": split, "total_rows": data.get("num_rows_total"),
            "columns": {item["name"]: _feature_type(item.get("type")) for item in data.get("features") or []},
            "rows": [{name: _cell(value) for name, value in (item.get("row") or {}).items()} for item in data.get("rows") or []]}


@app.tool(annotations=READ_ONLY)
def load_dataset(dataset: str, config: str = "", split: str = "", columns: list[str] | None = None,
                 max_rows: int = DEFAULT_MAX_ROWS) -> list[TextContent | EmbeddedResource]:
    """Load one split of a dataset as a table: a Parquet file Data Formulator saves to scratch, to load with
    create_data. Reads the first `max_rows` rows (100,000 by default, up to 1,000,000) of only the `columns` named (all
    but image and audio columns if none), so a large dataset is read in part; the file is kept under 25 MB."""
    dataset = parse_dataset(dataset)
    config, split = _choose(dataset, config, split)
    listing = client().get_json(f"{VIEWER}/parquet", {"dataset": dataset, "config": config, "split": split},
                                ttl=TTL_DATASET, dataset=dataset)
    files = sorted((item for item in listing.get("parquet_files") or [] if item.get("config") == config and item.get("split") == split),
                   key=lambda item: item.get("filename", ""))
    if not files:
        raise HuggingFaceError(f"The dataset viewer has no Parquet copy of {dataset} ({config}/{split}) to load.")
    limit = max(1, min(MAX_ROWS, int(max_rows)))
    batches: list[pa.RecordBatch] = []
    rows = 0
    chosen: list[str] | None = None
    dropped: list[str] = []
    for item in files:
        parquet = pq.ParquetFile(client().open(item["url"], int(item["size"])))
        if chosen is None:
            schema = parquet.schema_arrow
            names = schema.names
            if columns:
                unknown = [name for name in columns if name not in names]
                if unknown:
                    raise HuggingFaceError(f"{dataset} ({config}/{split}) has no column {', '.join(map(repr, unknown))}; "
                                           f"its columns are: {', '.join(names)}.")
                chosen = list(dict.fromkeys(columns))
            else:
                dropped = [field.name for field in schema if _media(field)]
                chosen = [name for name in names if name not in dropped]
            if not chosen:
                raise HuggingFaceError(f"{dataset} ({config}/{split}) holds only image or audio columns; name them in "
                                       "`columns` to load them anyway.")
        for batch in parquet.iter_batches(batch_size=10_000, columns=chosen):
            take = min(batch.num_rows, limit - rows)
            batches.append(batch.slice(0, take))
            rows += take
            if rows >= limit:
                break
        if rows >= limit:
            break
    table = pa.Table.from_batches(batches) if batches else pa.table({name: [] for name in chosen or []})
    data, cut = _parquet_bytes(table)
    total = _total_rows(dataset, config, split)
    kept = cut if cut is not None else table.num_rows
    note = [f"Loaded {kept:,}" + (f" of {total:,}" if total else "") + f" rows and {len(table.schema)} columns of {dataset} "
            f"({config}/{split}): {', '.join(table.schema.names)}."]
    if cut is not None:
        note.append(f"Cut to {kept:,} rows to keep the file under {MAX_FILE_BYTES // (1024 * 1024)} MB; name fewer columns for more rows.")
    elif total and kept < total:
        note.append(f"These are the first {kept:,} rows; raise max_rows (up to {MAX_ROWS:,}) or name fewer columns for more.")
    if dropped:
        note.append(f"Left out image or audio columns: {', '.join(dropped)}.")
    if listing.get("partial"):
        note.append("The viewer's copy of this dataset is partial (its first part only).")
    return [TextContent(type="text", text=" ".join(note)),
            EmbeddedResource(type="resource", resource=BlobResourceContents(
                uri=f"hf://datasets/{dataset}/{config}/{split}.parquet", mime_type=PARQUET_MIME,
                blob=base64.b64encode(data).decode()))]


def _parquet_bytes(table: pa.Table) -> tuple[bytes, int | None]:
    """The table as Parquet, and how many rows it was cut to (None if whole) to stay under the size limit."""
    def write(part: pa.Table) -> bytes:
        buffer = io.BytesIO()
        pq.write_table(part, buffer, compression="zstd")
        return buffer.getvalue()

    data = write(table)
    if len(data) <= MAX_FILE_BYTES:
        return data, None
    rows = table.num_rows
    while len(data) > MAX_FILE_BYTES and rows > 1:
        rows = max(1, int(rows * MAX_FILE_BYTES / len(data) * 0.9))
        data = write(table.slice(0, rows))
    return data, rows


def _total_rows(dataset: str, config: str, split: str) -> int | None:
    try:
        size = client().get_json(f"{VIEWER}/size", {"dataset": dataset}, ttl=TTL_DATASET, dataset=dataset).get("size") or {}
    except HuggingFaceError:
        return None
    return next((item.get("num_rows") for item in size.get("splits") or []
                 if item.get("config") == config and item.get("split") == split), None)


def main(argv: list[str] | None = None) -> None:
    global _client
    parser = argparse.ArgumentParser(description="Data Formulator's Hugging Face toolkit as an MCP server.")
    parser.add_argument("--cache", default="", help="Directory for cached Hugging Face responses.")
    options = parser.parse_args(argv)
    # The user's Hugging Face token, if any, comes from the credential vault as an environment variable.
    _client = Client(Path(options.cache).expanduser() if options.cache else None, os.environ.get("HF_TOKEN"))
    app.run("stdio")
