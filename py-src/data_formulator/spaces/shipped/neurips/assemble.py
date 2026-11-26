"""Assemble the NeurIPS space's tables from the collected data (maintainers); see README.md.

Reads ``<root>/tables/`` (written by ``crawl.py tables``) and ``<root>/llm/`` (``enrich.py``), and
writes ``<root>/dataset/``: the tables the space's sessions carry.

    uv run python py-src/data_formulator/spaces/shipped/neurips/assemble.py

Values stay as the sources give them, apart from HTML entities decoded and surrounding spaces
trimmed. Names are never merged: an institution is the string its author gave, and what it refers
to (a ROR or OpenAlex record, an LLM's reading) sits beside it in its own columns and tables.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import unicodedata
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
DEFAULT_ROOT = Path.home() / ".cache" / "data-formulator" / "neurips"
FIRST_YEAR, LAST_YEAR = 1987, 2026
# Years whose papers come from neurips.cc's virtual-site data (with institutions); earlier ones from the proceedings.
SCHEDULE_YEARS = range(2020, LAST_YEAR + 1)

# Where NeurIPS met (compiled by the space's maintainers; 2025 and 2026 from the schedules' poster sessions).
CONFERENCES = [
    *[(year, "Denver", "US", 39.74, -104.99) for year in range(1987, 2001)],
    *[(year, "Vancouver", "CA", 49.28, -123.12) for year in range(2001, 2011)],
    (2011, "Granada", "ES", 37.18, -3.60),
    (2012, "Lake Tahoe", "US", 38.96, -119.94),
    (2013, "Lake Tahoe", "US", 38.96, -119.94),
    (2014, "Montréal", "CA", 45.50, -73.57),
    (2015, "Montréal", "CA", 45.50, -73.57),
    (2016, "Barcelona", "ES", 41.39, 2.17),
    (2017, "Long Beach", "US", 33.77, -118.19),
    (2018, "Montréal", "CA", 45.50, -73.57),
    (2019, "Vancouver", "CA", 49.28, -123.12),
    (2020, "Online", None, None, None),
    (2021, "Online", None, None, None),
    (2022, "New Orleans", "US", 29.95, -90.07),
    (2023, "New Orleans", "US", 29.95, -90.07),
    (2024, "Vancouver", "CA", 49.28, -123.12),
    (2025, "San Diego", "US", 32.72, -117.16),
    (2025, "Mexico City", "MX", 19.43, -99.13),
    (2026, "Sydney", "AU", -33.87, 151.21),
    (2026, "Atlanta", "US", 33.75, -84.39),
    (2026, "Paris", "FR", 48.86, 2.35),
]


def norm_title(text: str | None) -> str:
    """A title reduced to lowercase letters and digits, for matching the same paper across sources."""
    text = unicodedata.normalize("NFKD", html.unescape(text or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", text)


def clean(text) -> str | None:
    """HTML entities decoded and surrounding spaces trimmed (the sources' only cleanup)."""
    if text is None or (isinstance(text, float) and pd.isna(text)):
        return None
    text = html.unescape(str(text)).strip()
    return text or None


def track_of(source: str | None) -> str:
    """The track a neurips.cc event's source names (its ``sourceurl``)."""
    source = source or ""
    if "Datasets_and_Benchmarks" in source or "Evaluations_and_Datasets" in source:
        return "Datasets & Benchmarks"
    if "Position_Paper" in source:
        return "Position paper"
    if "Conference" in source or not source:
        return "Main"
    if re.search(r"TMLR|JMLR|Jmlr|AoS|annals-of-statistics|jmlr|rescience|journal", source):
        return "Journal"
    return "Other"


def presentation_of(group: pd.DataFrame) -> str:
    decisions = " ".join(group.decision.fillna("").str.lower()) if "decision" in group else ""
    kinds = set(group.eventtype)
    if "oral" in decisions or "Oral" in kinds:
        return "Oral"
    if "spotlight" in decisions or "Spotlight" in kinds:
        return "Spotlight"
    return "Poster"


def city_of(session: str | None) -> str | None:
    """The city in a multi-site year's poster session name ("Sydney Poster Session 5")."""
    match = re.match(r"^(.+?) Poster Session", session or "")
    return match.group(1) if match else None


def schedule_papers(tables: Path, year: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    folder = tables / "neurips.cc" / str(year)
    events = pd.read_parquet(folder / "events.parquet").drop_duplicates("id")
    authors = pd.read_parquet(folder / "event_authors.parquet").drop_duplicates(["event_id", "position"])
    for column in ("virtualsite_url", "topic", "decision", "sourceurl", "paper_url", "poster_position", "room_name",
                   "abstract", "session", "starttime", "endtime"):
        if column not in events:
            events[column] = None
    if (folder / "abstracts.parquet").exists():
        pages = pd.read_parquet(folder / "abstracts.parquet").set_index("event_id").abstract
        events["abstract"] = events.abstract.fillna(events.id.map(pages))
    events = events[events.eventtype.isin(["Poster", "Oral", "Spotlight"]) & events.name.notna()
                    & ~events.virtualsite_url.fillna("").str.contains("/session/")].copy()
    events["key"] = events.name.map(norm_title)
    with_authors = set(authors.event_id)
    rows = []
    for _, group in events.groupby("key", sort=False):
        # The paper's main event: its poster, preferring one that lists the authors.
        ranked = group.assign(rank=(group.eventtype != "Poster").astype(int) * 2 + (~group.id.isin(with_authors)).astype(int))
        main = ranked.sort_values("rank", kind="stable").iloc[0]
        rows.append({
            "paper_id": f"{year}-{main.id}", "year": year, "title": clean(main["name"]), "abstract": clean(main.abstract),
            "track": track_of(main.sourceurl), "presentation": presentation_of(group),
            "topic": clean(main.topic), "city": city_of(main.session), "session": clean(main.session),
            "start_time": main.starttime, "end_time": main.endtime, "poster_position": clean(main.poster_position),
            "room": clean(main.room_name),
            "url": f"https://neurips.cc{main.virtualsite_url}" if main.virtualsite_url else None,
            "openreview_url": main.paper_url, "source": "neurips.cc", "source_track": main.sourceurl,
            "_event": main.id,
        })
    papers = pd.DataFrame(rows)
    event_paper = dict(zip(papers._event, papers.paper_id))
    authors = authors[authors.event_id.isin(event_paper)]
    authorships = pd.DataFrame({
        "paper_id": authors.event_id.map(event_paper), "year": year, "position": authors.position,
        "author": authors.fullname.map(clean), "institution": authors.institution.map(clean),
        "institution_raw": authors.institution.map(lambda text: text.strip() if isinstance(text, str) else None),
        "source": "neurips.cc"})
    return papers.drop(columns="_event"), authorships


def flip(name: str) -> str:
    """'Last, First' (as the proceedings cite authors) -> 'First Last'."""
    last, _, first = name.partition(", ")
    return f"{first} {last}".strip() if first else name


def proceedings_papers(tables: Path, year: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    papers = pd.read_parquet(tables / "papers.nips.cc" / str(year) / "papers.parquet")
    papers["paper_id"] = [f"{year}-{key[:12]}" for key in papers.key]
    out = pd.DataFrame({
        "paper_id": papers.paper_id, "year": year, "title": papers.title.map(clean), "abstract": papers.abstract.map(clean),
        "track": papers.track.map(lambda track: "Datasets & Benchmarks" if "datasets" in (track or "") else "Main"),
        "presentation": None, "topic": None, "city": None, "session": None, "start_time": None, "end_time": None,
        "poster_position": None, "room": None, "url": papers.abstract_url, "openreview_url": None,
        "source": "papers.nips.cc", "source_track": papers.track})
    rows = []
    for paper in papers.itertuples():
        names = json.loads(paper.citation_authors) if isinstance(paper.citation_authors, str) else []
        names = [flip(name) for name in names] or [name.strip() for name in (paper.authors or "").split(", ") if name.strip()]
        rows += [{"paper_id": paper.paper_id, "year": year, "position": i, "author": clean(name), "institution": None,
                  "institution_raw": None, "source": "papers.nips.cc"} for i, name in enumerate(names, 1)]
    return out, pd.DataFrame(rows)


def match_openalex(papers: pd.DataFrame, works: pd.DataFrame) -> pd.Series:
    """OpenAlex work id per paper: same title, published the paper's year or one year either side."""
    works = works.assign(key=works.title.map(norm_title))
    works = works[works.key.str.len() > 10].sort_values("cited_by_count", ascending=False)
    by_key = {}
    for work in works.itertuples():
        by_key.setdefault((work.key, work.year), work.openalex_id)
    keys = papers.title.map(norm_title)
    return pd.Series([by_key.get((key, year)) or by_key.get((key, year + 1)) or by_key.get((key, year - 1))
                      for key, year in zip(keys, papers.year)], index=papers.index)


def openalex_authorships(papers: pd.DataFrame, authorships: pd.DataFrame, oa: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """For proceedings papers OpenAlex knows, its authorships (with institutions) instead of the bare names.

    Returns the authorships and, per institution string they use, OpenAlex's institution for it.
    """
    matched = papers[(papers.source == "papers.nips.cc") & papers.openalex_id.notna()]
    oa = oa[oa.openalex_id.isin(set(matched.openalex_id))]
    by_work = {work: group for work, group in oa.groupby("openalex_id")}
    replaced, rows, institutions = set(), [], {}
    for paper in matched.itertuples():
        group = by_work.get(paper.openalex_id)
        if group is None or group.empty:
            continue
        replaced.add(paper.paper_id)
        for a in group.sort_values("position").itertuples():
            raw = json.loads(a.raw_affiliation_strings or "[]")
            insts = json.loads(a.institutions or "[]")
            text = clean(raw[0]) if raw else (clean(insts[0]["display_name"]) if insts else None)
            if text and insts:
                institutions.setdefault(text, []).append(insts[0])
            rows.append({"paper_id": paper.paper_id, "year": paper.year, "position": a.position,
                         "author": clean(a.raw_author_name or a.author_name), "institution": text,
                         "institution_raw": raw[0] if raw else None, "source": "openalex"})
    kept = authorships[~authorships.paper_id.isin(replaced)]
    return pd.concat([kept, pd.DataFrame(rows)], ignore_index=True), institutions


def institutions_table(authorships: pd.DataFrame, tables: Path, openalex_insts: dict) -> pd.DataFrame:
    used = authorships.dropna(subset=["institution"])
    table = used.groupby("institution").agg(authorships=("paper_id", "size"), papers=("paper_id", "nunique"),
                                            first_year=("year", "min"), last_year=("year", "max")).reset_index()
    raw_of = used.dropna(subset=["institution_raw"]).groupby("institution").institution_raw.first()
    ror_path = tables / "ror" / "affiliation_matches.parquet"
    if ror_path.exists():
        ror = pd.read_parquet(ror_path)
        ror = ror[(ror["rank"] == 1) & ror.chosen].set_index("affiliation")
        keys = table.institution.map(raw_of)
        for column, source in [("ror_id", "ror_id"), ("ror_name", "ror_name"), ("ror_country_code", "country_code"),
                               ("ror_city", "city"), ("ror_lat", "lat"), ("ror_lng", "lng"), ("ror_types", "types")]:
            table[column] = keys.map(ror[source])
    for column, field in [("openalex_institution_id", "id"), ("openalex_institution", "display_name"),
                          ("openalex_country_code", "country_code"), ("openalex_type", "type")]:
        table[column] = table.institution.map(
            lambda text: pd.Series([inst.get(field) for inst in openalex_insts[text]]).mode().iloc[0]
            if text in openalex_insts and any(inst.get(field) for inst in openalex_insts[text]) else None)
    return table.sort_values("authorships", ascending=False, ignore_index=True)


def assemble(root: Path) -> Path:
    tables = root / "tables"
    out = root / "dataset"
    out.mkdir(parents=True, exist_ok=True)
    parts = []
    for year in range(FIRST_YEAR, LAST_YEAR + 1):
        if year in SCHEDULE_YEARS and (tables / "neurips.cc" / str(year) / "events.parquet").exists():
            parts.append(schedule_papers(tables, year))
        elif (tables / "papers.nips.cc" / str(year) / "papers.parquet").exists():
            parts.append(proceedings_papers(tables, year))
    papers = pd.concat([p for p, _ in parts], ignore_index=True)
    authorships = pd.concat([a for _, a in parts], ignore_index=True)

    works = pd.read_parquet(tables / "openalex" / "works.parquet")
    papers["openalex_id"] = match_openalex(papers, works)
    papers["cited_by"] = papers.openalex_id.map(works.set_index("openalex_id").cited_by_count)
    authorships, openalex_insts = openalex_authorships(
        papers, authorships, pd.read_parquet(tables / "openalex" / "work_authorships.parquet"))
    papers["n_authors"] = papers.paper_id.map(authorships.groupby("paper_id").size()).fillna(0).astype(int)

    topics = root / "llm" / "paper_topics.parquet"
    papers["topic_llm"] = None
    if topics.exists():
        llm = pd.read_parquet(topics).set_index("paper_id")
        papers["topic_llm"] = papers.paper_id.map(llm.topic)
    papers = papers.sort_values(["year", "paper_id"], ignore_index=True)
    papers.to_parquet(out / "papers.parquet", index=False)
    authorships = authorships.sort_values(["year", "paper_id", "position"], ignore_index=True)
    authorships.drop(columns="institution_raw").to_parquet(out / "authorships.parquet", index=False)
    institutions = institutions_table(authorships, tables, openalex_insts)
    institutions.to_parquet(out / "institutions.parquet", index=False)

    orgs = root / "llm" / "institution_orgs.parquet"
    if orgs.exists():
        pd.read_parquet(orgs).to_parquet(out / "institution_orgs.parquet", index=False)
    countries = pd.read_csv(HERE / "countries.csv", keep_default_na=False)
    countries["map_id"] = pd.to_numeric(countries.map_id, errors="coerce").astype("Int64")
    countries.to_parquet(out / "countries.parquet", index=False)
    conferences = pd.DataFrame(CONFERENCES, columns=["year", "city", "country_code", "lat", "lng"])
    # The year's main city (listed first); 2025 and 2026 also met elsewhere.
    conferences["main"] = ~conferences.year.duplicated()
    conferences.to_parquet(out / "conferences.parquet", index=False)
    print(f"{out}: {len(papers):,} papers, {len(authorships):,} authorships, {len(institutions):,} institutions")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT,
                        help="cache, tables and dataset folder (default: ~/.cache/data-formulator/neurips)")
    assemble(parser.parse_args().root)


if __name__ == "__main__":
    main()
