# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Redraw the UIS demo's story covers from the story seeds (maintainers).

A story's cover (``image``) is its seed's first chart; its stack (``stack``) shows the seed's charts in order.
Each is drawn as the app draws it, in the site's chart theme, at the size of the image it replaces, by
``render_covers.mjs`` (beside this script) (needs the frontend's ``node_modules``):

    uv run python py-src/data_formulator/demos/unesco/make_covers.py                      # every story
    uv run python py-src/data_formulator/demos/unesco/make_covers.py --only education-sdg4-e20
    uv run python py-src/data_formulator/demos/unesco/make_covers.py --out /tmp/covers    # to review first

World maps load their outlines from the Vega datasets site, so drawing them needs network access.
"""

from __future__ import annotations

import argparse
import json
import struct
import subprocess
import tempfile
from pathlib import Path

import pyarrow.parquet as pq
import yaml

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
ASSETS = HERE / "assets"
STORIES = HERE / "stories"
RENDERER = Path(__file__).with_name("render_covers.mjs")
# A new image without one to replace: a map card, or a ranking card (cut to its first rows).
DEFAULT_SIZE = (665, 480)
RANKING_SIZE = (440, 480)


def png_size(path: Path) -> tuple[int, int] | None:
    """An existing image's size in CSS pixels (it is drawn at 2x)."""
    if not path.is_file():
        return None
    with path.open("rb") as file:
        header = file.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    width, height = struct.unpack(">II", header[16:24])
    return width // 2, height // 2


def story_jobs(story: dict, rows_dir: Path, out: Path) -> list[dict]:
    seed = STORIES / story["id"]
    state = json.loads((seed / "state.json").read_text(encoding="utf-8"))
    charts = state.get("charts") or []
    targets = [(0, story.get("image"), False)] + [(index, item.get("image"), True)
                                                  for index, item in enumerate(story.get("stack") or [])]
    jobs = []
    for index, image, stacked in targets:
        if not image or index >= len(charts):
            continue
        table = charts[index].get("tableRef")
        rows = rows_dir / f"{story['id']}-{table}.json"
        if not rows.is_file():
            records = pq.read_table(seed / f"{table}.parquet").to_pylist()
            rows.write_text(json.dumps(records, default=str), encoding="utf-8")
        ranking = charts[index].get("chartType") == "Bar Chart"
        width, height = png_size(ASSETS / image) or (RANKING_SIZE if ranking else DEFAULT_SIZE)
        target = out / Path(image).name
        # A ranking in a story's stack is a card of its first rows; a cover shows its whole chart.
        jobs.append({"state": str(seed / "state.json"), "chart": index, "rows": str(rows), "out": str(target),
                     "width": width, "height": height, "crop": ranking and stacked})
    return jobs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--only", nargs="*", help="Story ids to redraw (default: all with a seed).")
    parser.add_argument("--out", type=Path, default=ASSETS / "stories", help="Folder to write the images to.")
    args = parser.parse_args()
    profile = yaml.safe_load((HERE / "profile.yaml").read_text(encoding="utf-8"))
    stories = [story for starter in profile.get("starters") or [] for story in starter.get("stories") or []
               if (STORIES / story["id"] / "state.json").is_file() and (not args.only or story["id"] in args.only)]
    args.out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="uis-covers-") as tmp:
        jobs = [job for story in stories for job in story_jobs(story, Path(tmp), args.out)]
        spec = Path(tmp) / "jobs.json"
        spec.write_text(json.dumps({"theme": profile.get("chart_theme"), "jobs": jobs}), encoding="utf-8")
        subprocess.run(["node", "--no-warnings", str(RENDERER), str(spec)], cwd=REPO, check=True)


if __name__ == "__main__":
    main()
