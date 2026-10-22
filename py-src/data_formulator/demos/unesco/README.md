# UIS Data Explorer (`unesco`)

A front page for exploring UNESCO Institute for Statistics (UIS) data with Data Formulator, at
`/demo/unesco`, and the example to start from for your own demo. See [../README.md](../README.md) for the
`profile.yaml` format.

| File | Purpose |
|---|---|
| `profile.yaml` | The page: text, datasets (starters), example analyses (stories), analyst guidance |
| `assets/` | Front-page images: the hero picture and story covers |
| `stories/<story>/` | Story seeds: one answered question, its table (parquet) and two charts |
| `build.py` | Downloads the UIS data, builds the dataset and story sessions, installs the demo |
| `make_seeds.py` | Cuts full story sessions exported from the app down to seeds (maintainers) |
| `iso3166_numeric.csv` | Country codes for world maps, used by `build.py` |

## Install

On a local Data Formulator, open `/demo/unesco` and click **Install demo**. Or, from a checkout:

```bash
uv run python py-src/data_formulator/demos/unesco/build.py                        # into DF_SITES_DIR (~/.data_formulator/site-content)
uv run python py-src/data_formulator/demos/unesco/build.py --sites-dir /some/dir  # elsewhere, e.g. to upload to a server
uv run python py-src/data_formulator/demos/unesco/build.py --only culture --rebuild
```

It downloads the UIS bulk release (cached in `~/.cache/data-formulator/uis-raw`), builds the
four dataset sessions (about 46 MB; no AI models involved), adds each story's seed to its dataset
to make the 16 story sessions, and copies `profile.yaml` and `assets/` beside them. Datasets
already built are kept unless you pass `--rebuild` or `--only`; stories are always rebuilt.

## Stories

Each story opens on one question an AI analyst already answered: the table it made and two
charts of it (a map and a ranking where the story has one). Visitors ask the next question
themselves. The seeds in `stories/` (about 50 KB each) were cut from full curated sessions,
which are kept outside the repository; to change a story, export its session from the app as
`<folder>/stories/<story id>.zip` and run:

```bash
uv run python py-src/data_formulator/demos/unesco/make_seeds.py <folder> --only <story id>
```

It keeps the question that made the story's map (else its first question), adds the ranking
chart, drops model settings, UI state and agent transcripts, and writes the question into
`profile.yaml` as the story's `prompt`.

Data: UIS Bulk Data Download Service, February 2026 release
(<https://download.uis.unesco.org/bdds/202602/>), licensed CC BY-SA 3.0 IGO.

## Run locally

```bash
uv run data_formulator                     # then open /demo/unesco
DF_SITE=unesco uv run data_formulator      # / opens the demo
```

## Deploy

Install with `--sites-dir` pointing at the server's `DF_SITES_DIR` (or upload a folder built
that way). The demo is then at `/demo/unesco`; set `DF_SITE=unesco` to make it the home page.

## New UIS release

Update `BASE_URL` and the file names in `build.py`, `release` in `profile.yaml`, then rebuild.
Seeds hold their answers' tables, so redo the stories on the new data and run `make_seeds.py`.
