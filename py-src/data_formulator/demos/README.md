# Demos

A demo is a front page of your own at `/demo/<id>`: your title and text, your datasets,
example analyses to open, and questions to start from. Visitors go from the page into the
normal Data Formulator workspace, which stays under `/demo/<id>`; the standard app is still at
`/app`.

A demo is configuration, not code. Data Formulator's built-in page
(`src/sites/SitePage.tsx`) lays it out from a `profile.yaml`, so customizing it needs no
frontend build and works with a pip-installed Data Formulator. [`unesco/`](unesco/) (the
UIS Data Explorer, at `/demo/unesco`) ships with Data Formulator and is a complete example to
start from.

In code and settings a demo is called a *site* (`DF_SITE`, `DF_SITES_DIR`).

## How a demo is served

The page reads its id from the path and sends it with every API request (header
`X-DF-Demo`). That selects the demo's profile and analyst guidance, and keeps its visitors'
sessions apart: on the server under `<root>/sites/<id>/`, in the browser under storage names
ending in `:demo:<id>`. Moving between a demo and the standard app loads the page again; the
menu on the app name switches between them, listing the demos that are installed (or, on a
local Data Formulator, installable).
Content (sessions, images) is served from `/api/demos/<id>/...`.

## Folder

A demo's content is installed in its own folder under `DF_SITES_DIR` (default
`~/.data_formulator/site-content`):

```text
<DF_SITES_DIR>/<id>/
  profile.yaml            # the page and its datasets (below)
  <release>/              # content: sessions and front-page images
    <starter>.zip         # one per dataset: its tables and notes
    stories/<story>.zip   # one per example analysis: the dataset with the story's question answered
    hero.png, stories/<story>.png
```

`<id>` uses lowercase letters, digits and hyphens. It is in the demo's URL and names the
folder where its users' sessions are kept, so keep it stable once deployed.

Sessions are Data Formulator sessions: export one from the app, or build them with a script.

## Demos shipped with Data Formulator

Each demo in this folder (`py-src/data_formulator/demos/`, part of the Python package) has
everything needed to install it, apart from data it downloads:

```text
demos/<id>/
  profile.yaml            # the page (below)
  assets/                 # front-page images, laid out as the profile names them
  build.py                # downloads the data, builds the sessions, installs the demo
  README.md               # plus anything build.py needs, e.g. story seeds
```

Its page is at `/demo/<id>` on every Data Formulator. Until its content is installed, the page
shows its introduction and, on a local Data Formulator, an **Install demo** button that runs
`build.py` in the server and reloads once it finishes; elsewhere it says the demo is not
available yet. A profile installed in `DF_SITES_DIR` takes precedence over the shipped one.

`build.py` defines `install(sites_dir, *, log)`, which the button calls, and runs it from the
command line with `--sites-dir` and other options. It builds the sessions, copies
`profile.yaml` and `assets/` beside them, and fails if any file the profile names is missing.
It must not call AI models: data goes in as downloaded and processed, and an analysis made with
the AI analyst goes in as curated content, as the UIS demo does with its small story seeds (see
[unesco/README.md](unesco/README.md)). Tests are in `tests/backend/demos/`.

## Settings

| Setting | Effect |
|---|---|
| `DF_SITE=<id>` | `/` opens the demo (`/app` is still the standard app) |
| `DF_SITES_DIR=/path/to/demos` | Where demo content is installed (default `<DATA_FORMULATOR_HOME>/site-content`) |

Profiles are read once per server start (and again after an install); restart after editing
one. If a profile is invalid, the server logs why and `/demo/<id>` says there is no such demo.

## `profile.yaml`

Text fields marked *links* may contain `[text](url)` links to `https://`, `http://`,
`mailto:`, `/path` or `#anchor` URLs; other URLs show as plain text. `{release}` in `about`
and `intro` reads as the release's month and year (e.g. `2026-02` → February 2026).

### Page

| Field | Shows |
|---|---|
| `name` | The demo's name: browser title and app bar, and the page title unless `headline` is set |
| `headline` | The page title |
| `badge` | A small label beside the title, e.g. `Beta` |
| `headline_note` | A line under the title with the Data Formulator logo (*links*) |
| `tagline` | The opening line; also replaces the app's tagline |
| `about` | A list of short points (*links*) |
| `intro` | A paragraph after them (*links*) |
| `release` | The content folder to use (`<release>/`), e.g. `2026-02` |
| `hero_image` | A picture in the release folder, framed as a browser window |
| `attribution` | A line at the foot of the page, e.g. the data's source and license |
| `links` | Links at the foot: a list of `{label, url}` |
| `disclaimer` | A note after "Powered by Data Formulator" (*links*); a generic note on AI-written analyses by default |
| `install_note` | Before the demo is installed: what installing it downloads and builds |
| `analyst_rules` | Guidance added to every analyst request on the demo, e.g. audience and tone (not shown) |
| `starters` | The datasets, in order |

### Each dataset (`starters`)

| Field | Shows |
|---|---|
| `id` | Section anchor (`#<id>`) and download name |
| `title` | Section heading |
| `kicker` | A short name, used in the quick links and "Create your own analysis of …" |
| `description` | A paragraph under the heading |
| `source_url` | A "View the source" button |
| `icon` | Quick-link icon: `school`, `science`, `landmark`, `chart` or `table` (default) |
| `file` | The dataset session ZIP in the release folder; until it exists, the dataset shows "Not available yet" |
| `start_note` | A line on the new-session card (default "Start from the full dataset") |
| `questions` | Questions to start from, shown while the dataset has no stories |
| `stories` | Example analyses, below |

### Each example analysis (`stories`)

A story opens on its session (`file`): the dataset with the story's question already answered,
so it opens instantly and the visitor asks the next question. Until that session exists, opening
the story asks the AI analyst its `prompt` live instead, which takes a minute or more, uses the
deployment's model, and can differ from run to run.

| Field | Shows |
|---|---|
| `id` | Required; unique across the demo |
| `prompt` | Required: the question the story starts from, shown on the lead card ("Question: …") and on hover for the others; asked live when there is no session |
| `file` | The story's session ZIP, under the release folder |
| `headline`, `dek` | Title and summary |
| `featured` | `true` for the dataset's lead analysis, shown large (else the first) |
| `image` | Its cover image |
| `stack` | For the lead analysis: up to three images shown as stacked chart cards, `{label, image}` |
| `follow_ups` | Questions offered to continue the analysis |

## Deploying

Hosted servers do not offer the Install button: install the demo into the server's
`DF_SITES_DIR`, either by running its `build.py` there or by uploading a folder built with
`--sites-dir <folder>`. It is then at `/demo/<id>`; set `DF_SITE` to make it the server's home
page as well. Nothing in the app build changes. Demos get the same
agents, workspaces, access controls and sandbox as the rest of the app; on a public demo,
visitors' questions use the deployment's model and its sandboxed Python, so plan rate limits
and model budget accordingly.
