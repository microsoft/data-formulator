# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Cut the curated UIS story sessions down to small story seeds (maintainer tool).

Each story on the UIS page opens on a seed: one question an AI analyst answered, the table it
made, and two charts of that table (a map and a ranking where the story has a map), so it
opens instantly and the visitor asks the next question. A seed is the trimmed session state
plus the table's parquet file, committed under stories/<story id>/; build.py combines it with
the dataset session at install time. Agent transcripts are not kept.

    uv run python py-src/data_formulator/demos/unesco/make_seeds.py ~/data-formulator-demo-backups/unesco-2026-02

The input folder holds full story sessions as stories/<story id>.zip (exported from the app).
Rerun after replacing a story session; it rewrites that story's seed and its profile prompt.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
PROFILE = HERE / "profile.yaml"
STORIES = HERE / "stories"

# Questions asked mid-conversation ("Where do they go?") rewritten to stand on their own.
STANDALONE = {
    "culture-c22": "Where does nature get the bigger share of heritage spending?",
    "education-opri-o20": "Where do out-of-school children and young people live? Show me on a map.",
    "education-opri-o21": "Where do students who study abroad go?",
    "education-sdg4-e21": "Where is the gap between rich and poor children in finishing school biggest?",
    "education-sdg4-e22": "Where do most children reach a minimum reading level by the end of primary school?",
    "science-s20": "Which countries spend the most on research?",
}

# A second chart for stories without a map, where the table has a natural ranking:
# story id -> (value column, label column, title).
RANKINGS = {
    "culture-c23": ("change_percent", "country_after", "Change in public heritage spending per person since before the pandemic"),
}

# Session state a seed keeps; everything else (model and connection settings, UI layout,
# messages, other answers) is dropped.
KEEP = ("__stateVersion", "derivedTables", "charts", "conceptShelfItems", "textTurns", "tableSemantics")
EMPTY_CHANNELS = ("color", "opacity", "column", "row")


def _stable(*parts: str) -> str:
    return hashlib.sha1("/".join(parts).encode()).hexdigest()


def _concept(state: dict, name: str, story_id: str) -> str:
    """The id of the concept (field) named ``name``, adding one if the session has none."""
    for item in state["conceptShelfItems"]:
        if item.get("name") == name:
            return item["id"]
    digest = _stable(story_id, name)
    concept_id = f"concept-{name}-{int(digest[:10], 16) % 10**13}-0.{int(digest[10:26], 16)}"
    state["conceptShelfItems"].append({"id": concept_id, "name": name, "source": "custom", "tableRef": "custom"})
    return concept_id


def _fingerprint(chart: dict) -> str:
    """Same as computeEncodingFingerprint in src/components/ComponentType.tsx."""
    tuples = sorted(f"{channel}:{(enc or {}).get('fieldID', '') or ''}:{(enc or {}).get('aggregate', '') or ''}"
                    for channel, enc in chart["encodingMap"].items())
    return f"{chart['chartType']}|{'|'.join(tuples)}"


def _ranking(state: dict, story_id: str, table: dict, value_field: str, label: str, title: str, subtitle: str) -> dict:
    chart = {
        "id": f"chart-{_stable(story_id, 'ranking')[:12]}",
        "chartType": "Bar Chart",
        "encodingMap": {
            "x": {"fieldID": value_field, "dtype": "quantitative"},
            "y": {"fieldID": _concept(state, label, story_id), "dtype": "nominal", "sortOrder": "descending", "sortBy": "x"},
            **{channel: {"channel": channel, "bin": False} for channel in EMPTY_CHANNELS},
        },
        "tableRef": table["id"],
        "source": "user",
        "title": title,
        "subtitle": subtitle,
        "unread": False,
        "themeId": "datawrapper",
    }
    chart["titleKey"] = _fingerprint(chart)
    return chart


def _chosen_table(state: dict) -> dict:
    """The story's map table when it has one, else its first answer's table."""
    tables = sorted(state["derivedTables"], key=lambda table: table.get("createdAt") or 0)
    kinds = {chart["tableRef"]: chart["chartType"] for chart in state["charts"]}
    return next((table for table in tables if kinds.get(table["id"]) == "Choropleth"), tables[0])


def _without_transcripts(table: dict) -> dict:
    """The table without the agent conversations that made it (system prompts, tool calls)."""
    derive = {key: value for key, value in (table.get("derive") or {}).items() if key != "dialog"}
    if isinstance(derive.get("explanation"), dict):
        derive["explanation"] = {key: value for key, value in derive["explanation"].items() if key != "dialog"}
    return {**table, "derive": derive}


def make_seed(story_id: str, session: Path, headline: str) -> tuple[dict, dict[str, bytes], str]:
    """The seed state, its tables' parquet files, and the question it answers."""
    with zipfile.ZipFile(session) as archive:
        state = json.loads(archive.read("state.json"))
        table = _chosen_table(state)
        turns = {turn["id"]: turn for turn in state["textTurns"]}
        action = turns[table["parentNodeId"]]["actionId"]
        # Every table the question made (usually one): its answer.
        tables = [t for t in state["derivedTables"] if turns.get(t.get("parentNodeId"), {}).get("actionId") == action]
        parquets = {t["virtual"]["tableId"]: archive.read(f"workspace/data/{t['virtual']['tableId']}.parquet") for t in tables}

    kept_turns = [dict(turn) for turn in state["textTurns"] if turn.get("actionId") == action]
    prompt = next(turn for turn in kept_turns if turn.get("prompt"))
    # The kept question becomes the conversation's first.
    root = next(turn["parentNodeId"] for turn in state["textTurns"] if str(turn.get("parentNodeId", "")).startswith("conversation-root:"))
    prompt["parentNodeId"] = root
    prompt["prompt"] = STANDALONE.get(story_id, prompt["prompt"])

    table_ids = {t["id"] for t in tables}
    charts = sorted((dict(chart, unread=False) for chart in state["charts"] if chart["tableRef"] in table_ids),
                    key=lambda chart: chart["tableRef"] != table["id"])
    seed = {key: state[key] for key in KEEP if key in state}
    seed["conceptShelfItems"] = [dict(item) for item in state.get("conceptShelfItems") or []]
    first = charts[0]
    if first["chartType"] == "Choropleth":
        charts.append(_ranking(seed, story_id, table, first["encodingMap"]["color"]["fieldID"], "country",
                               f"{first.get('title') or headline}: highest first", first.get("subtitle", "")))
    elif story_id in RANKINGS:
        value, label, title = RANKINGS[story_id]
        charts.append(_ranking(seed, story_id, table, _concept(seed, value, story_id), label, title, first.get("subtitle", "")))
    chart_ids = {chart["id"] for chart in charts}
    for turn in kept_turns:
        if turn.get("sourceChartId") and turn["sourceChartId"] not in chart_ids:
            del turn["sourceChartId"]

    used = {enc.get("fieldID") for chart in charts for enc in chart["encodingMap"].values() if isinstance(enc, dict)}
    seed.update({
        "activeWorkspace": {"id": story_id, "displayName": headline},
        "derivedTables": [_without_transcripts(t) for t in tables],
        "charts": charts,
        "conceptShelfItems": [item for item in seed["conceptShelfItems"] if item["id"] in used],
        "textTurns": kept_turns,
        "tableSemantics": [entry for entry in state.get("tableSemantics") or [] if entry.get("tableId") in table_ids],
        "focusedId": {"type": "chart", "chartId": first["id"]},
    })
    return seed, parquets, prompt["prompt"]


def set_prompts(prompts: dict[str, str]) -> None:
    """Make each story's profile prompt the question its seed answers (also the live fallback)."""
    lines = PROFILE.read_text(encoding="utf-8").split("\n")
    out, story, index = [], None, 0
    while index < len(lines):
        line = lines[index]
        match = re.match(r"^      - id: (\S+)$", line)
        if match:
            story = match.group(1)
        if story in prompts and line.startswith("        prompt:"):
            out.append(f"        prompt: {json.dumps(prompts[story], ensure_ascii=False)}")
            index += 1
            while index < len(lines) and lines[index].startswith("          "):
                index += 1
            continue
        out.append(line)
        index += 1
    PROFILE.write_text("\n".join(out), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("sessions", type=Path, help="folder with stories/<story id>.zip session exports")
    parser.add_argument("--only", nargs="*", help="only these story ids")
    args = parser.parse_args()

    profile = yaml.safe_load(PROFILE.read_text(encoding="utf-8"))
    prompts = {}
    for starter in profile["starters"]:
        for story in starter.get("stories") or []:
            if args.only and story["id"] not in args.only:
                continue
            session = args.sessions / "stories" / f"{story['id']}.zip"
            if not session.is_file():
                print(f"{story['id']}: no session at {session}, skipped", file=sys.stderr)
                continue
            seed, parquets, question = make_seed(story["id"], session, story["headline"])
            folder = STORIES / story["id"]
            shutil.rmtree(folder, ignore_errors=True)
            folder.mkdir(parents=True)
            (folder / "state.json").write_text(json.dumps(seed, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            for name, data in parquets.items():
                (folder / f"{name}.parquet").write_bytes(data)
            prompts[story["id"]] = question
            kinds = " + ".join(chart["chartType"] for chart in seed["charts"])
            size = sum(path.stat().st_size for path in folder.iterdir())
            print(f"{story['id']}: {question!r} -> {kinds} ({size / 1024:.0f} KB)")
    set_prompts(prompts)


if __name__ == "__main__":
    main()
