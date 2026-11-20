# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Redraw the Power Apps demo's story covers from the stories as the app shows them (maintainers).

A story's cover (``image``) is a picture of what its session opens on, its map or app, taken in a running
Data Formulator with the demo installed, by Playwright's Chromium (``uv run playwright install chromium``
once):

    uv run python py-src/data_formulator/demos/powerapps/build.py --sites-dir /tmp/powerapps-sites
    DF_SITES_DIR=/tmp/powerapps-sites uv run data_formulator --port 5600 --data-dir /tmp/powerapps-home   # in another shell
    uv run python py-src/data_formulator/demos/powerapps/make_covers.py --url http://localhost:5600
    uv run python py-src/data_formulator/demos/powerapps/make_covers.py --url … --only winning --out /tmp/covers

Use a scratch ``--data-dir``: opening a story adds its session there. Maps draw their boundaries offline; a
map is pictured filling the card with its countries, without its title, legend or controls (the card shows the
story's headline); an app as the canvas shows its top, without the canvas's toolbar.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
STORIES = HERE / "stories"
# Covers fill a 16:10 card. The page opens at this size (CSS pixels, pictured at 2x), then its height is set
# so the canvas is about 16:10 (it has a least height, and narrows in steps as the page grows taller).
VIEWPORT = {"width": 1920, "height": 1050}
RATIO = 16 / 10
# The canvas: what follows the strip of open items' tabs.
CANVAS = '[aria-label="Open items"] + div'
# Controls a picture leaves out: the canvas toolbar and a map's zoom, search and collapse buttons.
CHROME = ['[aria-label="Style"]', '[aria-label="Reload app"]', '[aria-label="More"]', '[aria-label="Zoom in"]',
          '[aria-label="Minimize controls"]', '[role="combobox"]']
HIDE_CHROME = """selectors => {
    const canvas = document.querySelector('%s');
    for (const selector of selectors) {
        for (const element of canvas.querySelectorAll(selector)) {
            // The control's group (a toolbar, the zoom buttons, the search box): up to what holds the drawing.
            let group = element;
            while (group.parentElement && group.parentElement !== canvas) {
                if (group.parentElement.querySelector('[role="img"], iframe, .vega-embed')) break;
                group = group.parentElement;
            }
            group.style.visibility = 'hidden';
        }
    }
}""" % CANVAS


# A map's frame: its title, legend (with the source) and attribution are hidden, as the card names the story and
# a legend is too small to read there; returns the box of its countries and marks, for the picture to fill.
MAP_FRAME = """() => {
    const canvas = document.querySelector('%s');
    const svg = canvas.querySelector('svg[role="img"]');
    if (!svg || canvas.querySelector('iframe')) return null;
    const hide = element => {
        let group = element;
        while (group.parentElement && group.parentElement !== canvas && !group.parentElement.contains(svg)) group = group.parentElement;
        group.style.visibility = 'hidden';
    };
    canvas.querySelectorAll('h2').forEach(hide);
    canvas.querySelectorAll('a[href*="worldbank"]').forEach(hide);
    Array.from(canvas.querySelectorAll('p')).filter(p => /^Dataverse/.test(p.textContent)).forEach(hide);
    const frame = svg.getBoundingClientRect();
    // Regions and marks, not the sphere or background that span the whole map.
    const marks = Array.from(svg.querySelectorAll('path, circle')).map(mark => mark.getBoundingClientRect())
        .filter(box => box.width * box.height > 9 && box.width < frame.width * 0.7);
    if (!marks.length) return null;
    return { frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
        x0: Math.min(...marks.map(box => box.left)), x1: Math.max(...marks.map(box => box.right)),
        y0: Math.min(...marks.map(box => box.top)), y1: Math.max(...marks.map(box => box.bottom)) };
}""" % CANVAS


def map_clip(found: dict, padding: float = 0.04, trim: float = 0.1) -> dict:
    """A 16:10 box around a map's marks (with a margin), kept within the map.

    A world map is wider than 16:10: rather than leave bands above and below, the box may leave out up to
    ``trim`` of its width at the sides (mostly open ocean).
    """
    frame = found["frame"]
    width = (found["x1"] - found["x0"]) * (1 + 2 * padding)
    height = (found["y1"] - found["y0"]) * (1 + 2 * padding)
    width = min(width, max(height * RATIO, width * (1 - trim)))
    width, height = max(width, height * RATIO), max(height, width / RATIO)
    width, height = min(width, frame["width"], frame["height"] * RATIO), min(height, frame["height"], frame["width"] / RATIO)
    centre_x, centre_y = (found["x0"] + found["x1"]) / 2, (found["y0"] + found["y1"]) / 2
    x = min(max(centre_x - width / 2, frame["x"]), frame["x"] + frame["width"] - width)
    y = min(max(centre_y - height / 2, frame["y"]), frame["y"] + frame["height"] - height)
    return {"x": x, "y": y, "width": width, "height": height}


def fit_canvas(page) -> None:
    """Give the canvas the least height that makes it 16:10 or taller (the card's shape); maps and apps lay out again for it."""
    width = page.viewport_size["width"]
    for height in range(540, 1400, 10):
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(300)
        box = page.locator(CANVAS).bounding_box()
        if box["width"] / box["height"] <= RATIO:
            break
    page.wait_for_timeout(3000)


def picture(page, out: Path, title: str) -> None:
    """The story's map, cropped to its countries, or its app as the canvas shows it (its top), without controls."""
    # The story's own tab, in case the visitor's session (reopened, not imported again) shows something else.
    # Its name, at the start: a canvas tab's name also has its close button's, and another file's may contain it.
    page.get_by_role("tab", name=re.compile("^" + re.escape(title) + r"(\s|$)")).first.click()
    page.wait_for_timeout(3000)
    page.evaluate(HIDE_CHROME, CHROME)
    page.evaluate("() => document.querySelector('[aria-label=\"View system messages\"]')?.style.setProperty('visibility', 'hidden')")
    found = page.evaluate(MAP_FRAME)
    page.wait_for_timeout(300)
    if found:
        page.screenshot(path=str(out), clip=map_clip(found))
    else:
        box = page.locator(CANVAS).bounding_box()
        page.screenshot(path=str(out), clip={**box, "height": min(box["height"], box["width"] / RATIO)})
    print(out)


def open_story(browser, url: str, starter: dict, story: dict):
    context = browser.new_context(viewport=VIEWPORT, device_scale_factor=2)
    page = context.new_page()
    page.goto(f"{url}/demo/powerapps", wait_until="networkidle")
    page.get_by_role("tab", name=starter["kicker"]).click()
    # A story's card (or, for a session with chapters, its cover) is a button named by the story's headline.
    page.get_by_role("button", name=re.compile(re.escape(story["headline"]))).first.click()
    page.wait_for_selector(f'{CANVAS} svg, {CANVAS} iframe', timeout=60_000)
    page.wait_for_load_state("networkidle")
    # Maps and apps draw after their data arrives; give them time to settle.
    page.wait_for_timeout(6000)
    fit_canvas(page)
    return context, page


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--url", required=True, help="A running Data Formulator with the demo installed.")
    parser.add_argument("--only", nargs="*", help="Story ids to redraw (default: all with a seed).")
    parser.add_argument("--out", type=Path, default=ASSETS / "stories", help="Folder to write the images to.")
    args = parser.parse_args()
    from playwright.sync_api import sync_playwright

    profile = yaml.safe_load((HERE / "profile.yaml").read_text(encoding="utf-8"))
    stories = [(starter, story) for starter in profile.get("starters") or [] for story in starter.get("stories") or []
               if (STORIES / story["id"] / "state.json").is_file() and (not args.only or story["id"] in args.only)]
    args.out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for starter, story in stories:
            context, page = open_story(browser, args.url.rstrip("/"), starter, story)
            try:
                state = json.loads((STORIES / story["id"] / "state.json").read_text(encoding="utf-8"))
                lead = next(node for node in state["fileNodes"] if node["path"] == state["focusedId"]["fileName"])
                image = story.get("image") or f"stories/{story['id']}.png"
                picture(page, args.out / Path(image).name, lead["displayName"])
            finally:
                context.close()
        browser.close()


if __name__ == "__main__":
    main()
