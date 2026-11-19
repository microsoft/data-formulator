"""Collect the raw NeurIPS data for the NeurIPS demo (maintainers).

Raw downloads are cached under ``<root>/raw/`` and never fetched twice; tables are written under
``<root>/tables/`` with every value as the source gave it (no merging of names: that is analysis).

    uv run python py-src/data_formulator/demos/neurips/crawl.py schedule --years 2020-2026
    uv run python py-src/data_formulator/demos/neurips/crawl.py pages --years 2026
    uv run python py-src/data_formulator/demos/neurips/crawl.py proceedings --years 1987-2025
    uv run python py-src/data_formulator/demos/neurips/crawl.py proceedings-pages --years 1987-2019
    uv run python py-src/data_formulator/demos/neurips/crawl.py openalex --years 1987-2026
    uv run python py-src/data_formulator/demos/neurips/crawl.py ror --years 2020-2026
    uv run python py-src/data_formulator/demos/neurips/crawl.py tables --years 1987-2026
    uv run python py-src/data_formulator/demos/neurips/crawl.py status --years 1987-2026

Page crawls are resumable: stop them any time (or lose the network) and run them again; they wait
out outages, never run twice at once, and skip pages already cached.

Sources: neurips.cc's virtual-site data (``/static/virtual/data/neurips-<year>-orals-posters.json``,
one download per snapshot, 2020 on; abstracts in it except 2026's) and each paper's public page
(``/virtual/<year>/poster/<id>``) for 2026's abstracts; papers.nips.cc, the proceedings, for every
year's list and, for years before 2020, each paper's page (abstract, authors as cited). Pages are
fetched one at a time with a delay between requests.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import gzip
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

import pandas as pd
import requests
from bs4 import BeautifulSoup

DEFAULT_ROOT = Path.home() / ".cache" / "data-formulator" / "neurips"
SITE = "https://neurips.cc"
USER_AGENT = "DataFormulator-NeurIPS-demo/0.1 (+https://github.com/microsoft/data-formulator)"


def session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    return s


def now() -> str:
    return dt.datetime.now().strftime("%H:%M:%S")


def get(s: requests.Session, url: str, *, tries: int | None = 5) -> requests.Response:
    """GET with backoff (capped at 5 minutes) on rate limits, server errors and network failures.

    ``tries=None`` waits out any outage (e.g. the laptop going offline) instead of failing.
    """
    attempt = 0
    while True:
        attempt += 1
        last = tries is not None and attempt >= tries
        wait = min(300.0, 10 * 2 ** min(attempt - 1, 5))
        try:
            r = s.get(url, timeout=60)
        except requests.RequestException as e:
            if last:
                raise
            print(f"{now()} {url}: {type(e).__name__}; retrying in {wait:.0f}s", file=sys.stderr, flush=True)
            time.sleep(wait)
            continue
        if (r.status_code == 429 or r.status_code >= 500) and not last:
            retry_after = r.headers.get("Retry-After", "")
            wait = float(retry_after) if retry_after.isdigit() else wait
            print(f"{now()} {url}: HTTP {r.status_code}; retrying in {wait:.0f}s", file=sys.stderr, flush=True)
            time.sleep(wait)
            continue
        return r


@contextlib.contextmanager
def single_run(lock: Path):
    """Exit if another run already holds ``lock`` (two crawlers would fetch every page twice)."""
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("w") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            sys.exit(f"Another crawl is running ({lock})")
        yield


def year_dir(root: Path, year: int) -> Path:
    return root / "raw" / "neurips.cc" / str(year)


def schedule_snapshots(root: Path, year: int) -> list[Path]:
    return sorted(year_dir(root, year).glob("orals-posters-*.json"))


def latest_schedule(root: Path, year: int) -> list[dict]:
    snaps = schedule_snapshots(root, year)
    if not snaps:
        sys.exit(f"No schedule for {year}: run `crawl.py schedule --years {year}` first.")
    return json.loads(snaps[-1].read_text())["results"]


def cmd_schedule(root: Path, year: int, refresh: bool) -> None:
    """Download the year's orals-and-posters data, one dated snapshot per day (it changes before the conference)."""
    folder = year_dir(root, year)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"orals-posters-{dt.date.today().isoformat()}.json"
    if path.exists() and not refresh:
        print(f"{path} already downloaded today")
        return
    r = get(session(), f"{SITE}/static/virtual/data/neurips-{year}-orals-posters.json")
    if r.status_code == 404:
        sys.exit(f"neurips.cc has no orals-posters data for {year}")
    r.raise_for_status()
    data = r.json()
    path.write_text(json.dumps(data, ensure_ascii=False))
    print(f"{path}: {len(data['results'])} events")


def paper_events(events: list[dict]) -> list[dict]:
    """Events that have a paper page (posters and orals), not the session placeholders; each event once
    (a schedule can list one twice)."""
    seen, out = set(), []
    for e in events:
        if any(f"/{kind}/" in (e.get("virtualsite_url") or "") for kind in ("poster", "oral")) and e["id"] not in seen:
            seen.add(e["id"])
            out.append(e)
    return out


def page_path(root: Path, year: int, event_id: int) -> Path:
    return year_dir(root, year) / "pages" / f"{event_id}.html.gz"


def fetch_all(pages: list[tuple[Path, str]], log_path: Path, delay: float, limit: int | None) -> None:
    """Fetch ``(path, url)`` pages not cached yet, one at a time, into gzipped files.

    Safe to stop and run again at any time: pages are written whole, and network outages are waited out.
    Each attempt is logged to ``log_path`` (key = the page's file name without ``.html.gz``).
    """
    for folder in {path.parent for path, _ in pages}:
        folder.mkdir(parents=True, exist_ok=True)
        for tmp in folder.glob("*.tmp"):
            tmp.unlink()
    todo = [(path, url) for path, url in pages if not path.exists()]
    if limit:
        todo = todo[:limit]
    print(f"{now()} {len(todo)} pages to fetch, ~{len(todo) * (delay + 0.5) / 60:.0f} min", flush=True)
    s = session()
    with log_path.open("a") as log:
        for i, (path, url) in enumerate(todo, 1):
            r = get(s, url, tries=None)
            key = path.name.removesuffix(".html.gz")
            log.write(json.dumps({"id": int(key) if key.isdigit() else key, "url": r.url, "status": r.status_code,
                                  "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat()}) + "\n")
            log.flush()
            if r.ok:
                tmp = path.with_suffix(".tmp")
                tmp.write_bytes(gzip.compress(r.content))
                tmp.rename(path)
            else:
                print(f"{now()} {url}: HTTP {r.status_code}", file=sys.stderr, flush=True)
            if i % 100 == 0:
                print(f"{now()} {i}/{len(todo)}", flush=True)
            time.sleep(delay)
    print(f"{now()} done", flush=True)


def read_log(log_path: Path) -> dict:
    """The last logged attempt per page."""
    entries = {}
    if log_path.exists():
        for line in log_path.read_text().splitlines():
            entry = json.loads(line)
            entries[entry["id"]] = entry
    return entries


def is_running(lock: Path) -> bool:
    if not lock.exists():
        return False
    with lock.open() as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
    return False


def page_url(event: dict) -> str:
    """A paper's page; in a multi-city year, its city's page directly (the general one redirects there)."""
    url = event["virtualsite_url"]
    city = re.match(r"^(.+?) Poster Session", event.get("session") or "")
    if city and "/poster/" in url:
        url = re.sub(r"^/virtual/(\d+)/", lambda m: f"/virtual/{m.group(1)}/loc/{city.group(1).lower().replace(' ', '-')}/", url)
    return SITE + url


def cmd_pages(root: Path, year: int, delay: float, limit: int | None) -> None:
    """Fetch every paper's neurips.cc page (for its abstract)."""
    with single_run(year_dir(root, year) / "pages.lock"):
        pages = [(page_path(root, year, e["id"]), page_url(e)) for e in paper_events(latest_schedule(root, year))]
        fetch_all(pages, year_dir(root, year) / "pages.log.jsonl", delay, limit)


def page_abstract(html: bytes) -> str | None:
    node = BeautifulSoup(html, "lxml").select_one(".abstract-section .abstract-text-inner")
    return node.get_text().strip() if node else None


# papers.nips.cc: the proceedings, every year since 1987 (titles, authors, abstracts; no affiliations).

PROCEEDINGS = "https://papers.nips.cc"


def proceedings_dir(root: Path, year: int) -> Path:
    return root / "raw" / "papers.nips.cc" / str(year)


def cmd_proceedings(root: Path, years: list[int], refresh: bool) -> None:
    """Download each year's list of papers."""
    s = session()
    for year in years:
        path = proceedings_dir(root, year) / "index.html"
        if path.exists() and not refresh:
            continue
        r = get(s, f"{PROCEEDINGS}/paper_files/paper/{year}")
        r.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)
        print(f"{now()} {year}: {len(proceedings_index(root, year))} papers", flush=True)
        time.sleep(1)


def proceedings_index(root: Path, year: int) -> list[dict]:
    """The year's papers as its list shows them (values verbatim)."""
    path = proceedings_dir(root, year) / "index.html"
    if not path.exists():
        sys.exit(f"No proceedings list for {year}: run `crawl.py proceedings --years {year}` first.")
    papers = []
    for li in BeautifulSoup(path.read_bytes(), "lxml").select("li"):
        link = li.select_one('a[title="paper title"]')
        if not link:
            continue
        authors = li.select_one(".paper-authors")
        badge = li.select_one(".paper-track-badge")
        papers.append({"year": year, "key": Path(link["href"]).stem, "track": li.get("data-track"),
                       "track_label": badge.get_text(strip=True) if badge else None,
                       "title": link.get_text(), "authors": authors.get_text() if authors else None,
                       "abstract_url": PROCEEDINGS + link["href"]})
    return papers


def proceedings_page(root: Path, year: int, key: str) -> Path:
    return proceedings_dir(root, year) / "pages" / f"{key}.html.gz"


def cmd_proceedings_pages(root: Path, years: list[int], delay: float, limit: int | None) -> None:
    """Fetch each paper's proceedings page (for its abstract and authors as cited)."""
    with single_run(root / "raw" / "papers.nips.cc" / "pages.lock"):
        for year in years:
            pages = [(proceedings_page(root, year, p["key"]), p["abstract_url"]) for p in proceedings_index(root, year)]
            print(f"{now()} {year}", flush=True)
            fetch_all(pages, proceedings_dir(root, year) / "pages.log.jsonl", delay, limit)


def proceedings_details(html: bytes) -> dict:
    soup = BeautifulSoup(html, "lxml")
    meta = lambda name: [m.get("content") for m in soup.find_all("meta", attrs={"name": name})]
    node = soup.select_one(".paper-abstract")
    # Some pages nest <p> inside .paper-abstract, which the parser closes early: read the whole section.
    section = node.find_parent("section") if node else None
    paragraphs = [p.get_text().strip() for p in (section or node).find_all("p")] if node else []
    abstract = "\n\n".join(p for p in paragraphs if p)
    return {"citation_title": next(iter(meta("citation_title")), None),
            "citation_authors": json.dumps(meta("citation_author"), ensure_ascii=False),
            "pdf_url": next(iter(meta("citation_pdf_url")), None),
            "abstract": abstract or None}


def proceedings_tables(root: Path, year: int) -> None:
    """Write the year's papers.nips.cc table (values verbatim), with page details where fetched."""
    log = read_log(proceedings_dir(root, year) / "pages.log.jsonl")
    rows = []
    for p in proceedings_index(root, year):
        path = proceedings_page(root, year, p["key"])
        details = proceedings_details(gzip.decompress(path.read_bytes())) if path.exists() else {}
        rows.append({**p, "fetched_at": log.get(p["key"], {}).get("fetched_at") if details else None, **details})
    out = root / "tables" / "papers.nips.cc" / str(year)
    out.mkdir(parents=True, exist_ok=True)
    columns = ["year", "key", "track", "track_label", "title", "authors", "abstract_url", "fetched_at",
               "citation_title", "citation_authors", "pdf_url", "abstract"]
    pd.DataFrame(rows, columns=columns).to_parquet(out / "papers.parquet", index=False)
    print(f"{out}: {len(rows)} papers, {sum(bool(r.get('abstract')) for r in rows)} abstracts")


# OpenAlex: NeurIPS works (authorships with institutions and countries, citations). Its records of the
# proceedings are partial before 2022. Without an API key it allows ~1,000 list requests a day.

OPENALEX = "https://api.openalex.org"
OPENALEX_NEURIPS = "S4363606243"
OPENALEX_FIELDS = ("id,doi,display_name,publication_year,type,authorships,cited_by_count,counts_by_year,"
                   "primary_topic,keywords,primary_location,locations,ids")


def openalex_dir(root: Path, year: int) -> Path:
    return root / "raw" / "openalex" / "works" / str(year)


def cmd_openalex(root: Path, years: list[int]) -> None:
    """Download the NeurIPS works OpenAlex lists for each year (any location at the NeurIPS source)."""
    s = session()
    for year in years:
        folder = openalex_dir(root, year)
        if (folder / "done").exists():
            continue
        folder.mkdir(parents=True, exist_ok=True)
        for old in folder.glob("page-*.json"):
            old.unlink()
        cursor, n, count = "*", 0, 0
        while cursor:
            n += 1
            # Plain paging (cursor paging needs an API key); a year has well under its 10,000-result cap.
            key = f"&api_key={os.environ['OPENALEX_API_KEY']}" if os.environ.get("OPENALEX_API_KEY") else ""
            r = get(s, f"{OPENALEX}/works?filter=locations.source.id:{OPENALEX_NEURIPS},publication_year:{year}"
                       f"&per-page=200&page={n}&select={OPENALEX_FIELDS}{key}")
            r.raise_for_status()
            data = r.json()
            (folder / f"page-{n:03d}.json").write_text(json.dumps(data, ensure_ascii=False))
            count += len(data["results"])
            cursor = len(data["results"]) == 200 and count < data["meta"]["count"]
            time.sleep(0.2)
        (folder / "done").write_text(dt.datetime.now(dt.timezone.utc).isoformat())
        print(f"{now()} {year}: {count} works", flush=True)


def openalex_tables(root: Path, years: list[int]) -> None:
    """Write OpenAlex's works and authorships (values verbatim; lists as JSON text)."""
    works, authorships = [], []
    for year in years:
        for page in sorted(openalex_dir(root, year).glob("page-*.json")):
            for w in json.loads(page.read_text())["results"]:
                works.append({"year": year, "openalex_id": w["id"], "doi": w.get("doi"), "title": w.get("display_name"),
                              "type": w.get("type"), "cited_by_count": w.get("cited_by_count"),
                              "counts_by_year": as_cell(w.get("counts_by_year")),
                              "primary_topic": as_cell(w.get("primary_topic")), "keywords": as_cell(w.get("keywords")),
                              "landing_page_urls": as_cell([loc.get("landing_page_url") for loc in w.get("locations") or []]),
                              "ids": as_cell(w.get("ids"))})
                for i, a in enumerate(w.get("authorships") or [], 1):
                    insts = [{k: inst.get(k) for k in ("id", "display_name", "ror", "country_code", "type")}
                             for inst in a.get("institutions") or []]
                    authorships.append({"openalex_id": w["id"], "position": i, "author_position": a.get("author_position"),
                                        "author_id": (a.get("author") or {}).get("id"),
                                        "author_name": (a.get("author") or {}).get("display_name"),
                                        "raw_author_name": a.get("raw_author_name"),
                                        "raw_affiliation_strings": as_cell(a.get("raw_affiliation_strings")),
                                        "institutions": as_cell(insts), "countries": as_cell(a.get("countries"))})
    if not works:
        return
    out = root / "tables" / "openalex"
    out.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(works).to_parquet(out / "works.parquet", index=False)
    pd.DataFrame(authorships).to_parquet(out / "work_authorships.parquet", index=False)
    print(f"{out}: {len(works)} works, {len(authorships)} authorships")


# ROR (Research Organization Registry): its affiliation matching for each institution string neurips.cc
# gives, kept beside the string (a candidate match, not a replacement).

ROR = "https://api.ror.org/v2/organizations"
ROR_KEEP = ("id", "names", "types", "locations", "relationships", "status", "domains", "established")


def ror_path(root: Path) -> Path:
    return root / "raw" / "ror" / "affiliations.jsonl"


def institution_strings(root: Path, years: list[int]) -> list[str]:
    strings = set()
    for year in years:
        if schedule_snapshots(root, year):
            strings |= {a["institution"].strip() for e in latest_schedule(root, year)
                        for a in e.get("authors") or [] if (a.get("institution") or "").strip()}
    return sorted(strings)


def cmd_ror(root: Path, years: list[int], delay: float) -> None:
    """Ask ROR to match each institution string (resumable; strings already asked are skipped)."""
    path = ror_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    with single_run(path.parent / "ror.lock"):
        done = {json.loads(line)["affiliation"] for line in path.read_text().splitlines()} if path.exists() else set()
        todo = [x for x in institution_strings(root, years) if x not in done]
        print(f"{now()} {len(todo)} institution strings to match, ~{len(todo) * (delay + 0.3) / 60:.0f} min", flush=True)
        s = session()
        with path.open("a") as out:
            for i, text in enumerate(todo, 1):
                r = get(s, f"{ROR}?{urlencode({'affiliation': text})}", tries=None)
                items = []
                if r.ok:
                    items = [{"chosen": it.get("chosen"), "score": it.get("score"), "matching_type": it.get("matching_type"),
                              "substring": it.get("substring"),
                              "organization": {k: it["organization"].get(k) for k in ROR_KEEP}}
                             for it in r.json().get("items", [])[:5]]
                else:
                    print(f"{now()} {text!r}: HTTP {r.status_code}", file=sys.stderr, flush=True)
                out.write(json.dumps({"affiliation": text, "status": r.status_code, "items": items,
                                      "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat()}, ensure_ascii=False) + "\n")
                out.flush()
                if i % 500 == 0:
                    print(f"{now()} {i}/{len(todo)}", flush=True)
                time.sleep(delay)
        print(f"{now()} done", flush=True)


def ror_tables(root: Path) -> None:
    """Write ROR's candidates for each institution string: one row per candidate (up to 5), best first."""
    path = ror_path(root)
    if not path.exists():
        return
    rows = []
    for line in path.read_text().splitlines():
        entry = json.loads(line)
        if entry["status"] != 200:
            continue
        for rank, it in enumerate(entry["items"], 1):
            org = it["organization"]
            loc = ((org.get("locations") or [{}])[0] or {}).get("geonames_details") or {}
            name = next((n["value"] for n in org.get("names") or [] if "ror_display" in n.get("types", [])), None)
            parents = [rel["id"] for rel in org.get("relationships") or [] if rel.get("type") == "parent"]
            rows.append({"affiliation": entry["affiliation"], "rank": rank, "chosen": it["chosen"], "score": it["score"],
                         "matching_type": it["matching_type"], "substring": it["substring"], "ror_id": org.get("id"),
                         "ror_name": name, "types": as_cell(org.get("types")), "country_code": loc.get("country_code"),
                         "country_name": loc.get("country_name"), "city": loc.get("name"), "lat": loc.get("lat"),
                         "lng": loc.get("lng"), "parents": as_cell(parents)})
    out = root / "tables" / "ror"
    out.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_parquet(out / "affiliation_matches.parquet", index=False)
    print(f"{out}: {len(rows)} candidates for {len({r['affiliation'] for r in rows})} strings")


def as_cell(value):
    """Lists and dicts kept as JSON text, so a column has one type."""
    return json.dumps(value, ensure_ascii=False) if isinstance(value, (list, dict)) else value


def schedule_tables(root: Path, year: int) -> None:
    """Write the year's neurips.cc tables (values verbatim): events, event_authors, abstracts (from pages)."""
    snap = schedule_snapshots(root, year)[-1]
    events = latest_schedule(root, year)
    out = root / "tables" / "neurips.cc" / str(year)
    out.mkdir(parents=True, exist_ok=True)

    rows = [{"year": year, "snapshot": snap.stem.removeprefix("orals-posters-"),
             **{k: as_cell(v) for k, v in e.items() if k != "authors"}} for e in events]
    pd.DataFrame(rows).to_parquet(out / "events.parquet", index=False)

    authors = [{"event_id": e["id"], "position": i, "author_id": a.get("id"), "fullname": a.get("fullname"),
                "institution": a.get("institution"), "url": a.get("url")}
               for e in events for i, a in enumerate(e.get("authors") or [], 1)]
    pd.DataFrame(authors).to_parquet(out / "event_authors.parquet", index=False)

    log = read_log(year_dir(root, year) / "pages.log.jsonl")
    abstracts = []
    for e in paper_events(events):
        path = page_path(root, year, e["id"])
        if path.exists():
            entry = log.get(e["id"], {})
            abstracts.append({"event_id": e["id"], "page_url": entry.get("url"), "fetched_at": entry.get("fetched_at"),
                              "abstract": page_abstract(gzip.decompress(path.read_bytes()))})
    pd.DataFrame(abstracts, columns=["event_id", "page_url", "fetched_at", "abstract"]).to_parquet(
        out / "abstracts.parquet", index=False)
    print(f"{out}: {len(rows)} events, {len(authors)} authorships, {len(abstracts)} page abstracts")


def cmd_tables(root: Path, years: list[int]) -> None:
    for year in years:
        if schedule_snapshots(root, year):
            schedule_tables(root, year)
        if (proceedings_dir(root, year) / "index.html").exists():
            proceedings_tables(root, year)
    openalex_tables(root, years)
    ror_tables(root)


def page_counts(pages: list[Path], log_path: Path) -> tuple[int, int]:
    """(fetched, failed): failed = last attempt not 200 and not cached."""
    log = read_log(log_path)
    have = sum(path.exists() for path in pages)
    failed = 0
    for path in pages:
        key = path.name.removesuffix(".html.gz")
        entry = log.get(int(key) if key.isdigit() else key)
        failed += bool(entry and entry["status"] != 200 and not path.exists())
    return have, failed


def cmd_status(root: Path, years: list[int]) -> None:
    for year in years:
        if schedule_snapshots(root, year):
            events = latest_schedule(root, year)
            pages = [page_path(root, year, e["id"]) for e in paper_events(events)]
            have, failed = page_counts(pages, year_dir(root, year) / "pages.log.jsonl")
            print(f"{year} neurips.cc: {len(schedule_snapshots(root, year))} snapshot(s), {len(events)} events, "
                  f"pages {have}/{len(pages)} fetched, {failed} failed")
        if (proceedings_dir(root, year) / "index.html").exists():
            pages = [proceedings_page(root, year, p["key"]) for p in proceedings_index(root, year)]
            have, failed = page_counts(pages, proceedings_dir(root, year) / "pages.log.jsonl")
            print(f"{year} papers.nips.cc: pages {have}/{len(pages)} fetched, {failed} failed")
    running = [str(lock.parent.relative_to(root / "raw")) for lock in sorted((root / "raw").rglob("pages.lock"))
               if is_running(lock)]
    print(f"running crawls: {', '.join(running) or 'none'} (rerun a stopped crawl to resume or retry failures)")


def parse_years(text: str) -> list[int]:
    """'2026', '1987-2019' or '2020,2022-2024'."""
    years = []
    for part in text.split(","):
        start, _, end = part.partition("-")
        years += range(int(start), int(end or start) + 1)
    return years


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT,
                        help="cache and tables folder (default: ~/.cache/data-formulator/neurips)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("schedule", "pages", "proceedings", "proceedings-pages", "openalex", "ror", "tables", "status"):
        p = sub.add_parser(name)
        p.add_argument("--years", type=parse_years, required=True, help="e.g. 2026, 1987-2019 or 2020,2022-2024")
        if name in ("schedule", "proceedings"):
            p.add_argument("--refresh", action="store_true", help="download again")
        if name in ("pages", "proceedings-pages", "ror"):
            p.add_argument("--delay", type=float, default=1.0 if name != "ror" else 0.3,
                           help="seconds between requests (default 1; ror 0.3)")
            p.add_argument("--limit", type=int, help="fetch at most this many pages per year")
    args = parser.parse_args()
    if args.cmd == "schedule":
        for year in args.years:
            cmd_schedule(args.root, year, args.refresh)
    elif args.cmd == "pages":
        for year in args.years:
            cmd_pages(args.root, year, args.delay, args.limit)
    elif args.cmd == "proceedings":
        cmd_proceedings(args.root, args.years, args.refresh)
    elif args.cmd == "proceedings-pages":
        cmd_proceedings_pages(args.root, args.years, args.delay, args.limit)
    elif args.cmd == "openalex":
        cmd_openalex(args.root, args.years)
    elif args.cmd == "ror":
        cmd_ror(args.root, args.years, args.delay)
    elif args.cmd == "tables":
        cmd_tables(args.root, args.years)
    else:
        cmd_status(args.root, args.years)


if __name__ == "__main__":
    main()
