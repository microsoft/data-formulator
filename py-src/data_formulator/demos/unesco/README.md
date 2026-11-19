# UIS Data Explorer (`unesco`)

A front page for exploring UNESCO Institute for Statistics (UIS) data with Data Formulator, at
`/demo/unesco`, and the example to start from for your own demo. See [../README.md](../README.md) for the
`profile.yaml` format.

| File | Purpose |
|---|---|
| `profile.yaml` | The page: text, datasets (starters), example analyses (stories), analyst guidance |
| `assets/` | Front-page images: the hero picture and story covers |
| `stories/<story>/` | Story seeds: one answered question, its tables (parquet), its map or app (`files/`) and a ranking chart |
| `build.py` | Downloads the UIS data, builds the dataset and story sessions, installs the demo |
| `make_stories.py` | Computes the story seeds from the built dataset sessions (maintainers) |
| `apps/` | The React code of the stories' dashboards, used by `make_stories.py` |
| `make_covers.py` | Pictures the story covers in `assets/stories/` from the stories as the app shows them (maintainers) |
| `iso3166_numeric.csv` | Country codes for world maps, used by `build.py` |

## Install

On a local Data Formulator, open `/demo/unesco` and click **Install demo**. Or, from a checkout:

```bash
uv run python py-src/data_formulator/demos/unesco/build.py                        # into DF_SITES_DIR (~/.data_formulator/site-content)
uv run python py-src/data_formulator/demos/unesco/build.py --sites-dir /some/dir  # elsewhere, e.g. to upload to a server
uv run python py-src/data_formulator/demos/unesco/build.py --only culture --rebuild
```

It downloads the UIS bulk release (cached in `~/.cache/data-formulator/uis-raw/<release>/`), builds
the four dataset sessions (about 50 MB; no AI models involved), adds each story's seed to its
dataset to make the 16 story sessions, and copies `profile.yaml` and `assets/` beside them. Datasets
already built are kept unless you pass `--rebuild` or `--only`; stories are always rebuilt.

## Stories

Each story opens on one question an AI analyst would answer on the site, already answered: the
tables it made and what it drew from them, a map (a map file, often with a ranking chart), a small
dashboard (an app), or both, opening on the one its card shows (`Story.lead` in `make_stories.py`).
The stories under one dataset vary their form so its cards do not all look alike. Visitors ask the
next question themselves.

The seeds in `stories/` (about 20–50 KB each) are computed from the data by `make_stories.py`, not
written by an AI model: each story there says how its tables are computed (Python that the app runs
again when a visitor refreshes a table), its map spec or app (in `apps/`), and how its answer,
headline and dek read, with every figure taken from the computed rows. Maps and apps are checked as
the analyst's `write_map` and `write_app` check them. To change or add a story, edit it there, then
build the datasets and run it:

```bash
uv run python py-src/data_formulator/demos/unesco/build.py --sites-dir /tmp/uis-sites
uv run python py-src/data_formulator/demos/unesco/make_stories.py --sites-dir /tmp/uis-sites --only <story id>
```

It rewrites the story's seed and its `headline` and `dek` in `profile.yaml`; the `title`, `prompt`
and `follow_ups` are edited by hand. Then install the stories again (`build.py --sites-dir …`) and
redraw their covers, pictures of the story's map or app in a running Data Formulator (Playwright's
Chromium: `uv run playwright install chromium` once):

```bash
DF_SITES_DIR=/tmp/uis-sites uv run data_formulator --port 5600 --data-dir /tmp/uis-home   # a scratch home
uv run python py-src/data_formulator/demos/unesco/make_covers.py --url http://localhost:5600 --only <story id>
```

Data: UIS Bulk Data Download Service (<https://databrowser.uis.unesco.org/resources/bulk>):
education (SDG 4, OPRI) and demographic data from the November 2026 release, research and
development (SCN) and heritage spending (SDG 11) from the February 2026 release, their latest;
licensed CC BY-SA 3.0 IGO.

## Run locally

```bash
uv run data_formulator                     # then open /demo/unesco
DF_SITE=unesco uv run data_formulator      # / opens the demo
```

## Deploy

Install with `--sites-dir` pointing at the server's `DF_SITES_DIR` (or upload a folder built
that way). The demo is then at `/demo/unesco`; set `DF_SITE=unesco` to make it the home page.

## New UIS release

UIS updates its datasets on their own schedules. Update the dataset's folder in `RELEASES` (and the
background notes in `DOCS`) in `build.py`, `release` in `profile.yaml` when education moves (it names
the content folder and the page's "{release}"), and the release dates in `profile.yaml`'s `about`
and `attribution` and in `skill/SKILL.md`, and the years in each dataset's `summary`. Rebuild the datasets, then run `make_stories.py`: its
checks stop on a story whose text no longer fits the data (for example when another country ranks
first), to reword. Redraw the covers last.
