# Demos

A demo is a front page of your own at `/demo/<id>`: your title and text, your datasets,
example analyses to open, and questions to start from, around the analyst chat. Visitors go from
the page into the normal Data Formulator workspace, which stays under `/demo/<id>`; the standard
app is still at `/app`. In the workspace, the analyst knows the demo: it loads the demo's datasets
for a question and points visitors to its example analyses (see [The analyst on a demo](#the-analyst-on-a-demo)).

A demo is configuration, not code. Data Formulator's landing page lays it out from a
`profile.yaml` (the demo parts are in `src/sites/`), so customizing it needs no frontend build and
works with a pip-installed Data Formulator. [`unesco/`](unesco/) (the
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
  skill/SKILL.md          # optional: the demo's guidance for the analyst (below)
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
  skill/SKILL.md          # the demo's guidance for the analyst (below)
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
`profile.yaml`, `skill/` and `assets/` beside them, and fails if any file the profile names is missing.
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
| `tagline` | The line under the title; also replaces the app's tagline |
| `suggestions` | More questions as chips above the chat, after "What datasets do we have here?" and "Show me your analysis of <the dataset in the tab>" |
| `chat_placeholder` | The chat box's placeholder (default "Ask a question about the data…") |
| `about` | A list of short points at the foot of the page (*links*) |
| `intro` | A paragraph after them (*links*) |
| `release` | The content folder to use (`<release>/`), e.g. `2026-02` |
| `hero_image` | A picture in the release folder; installed, but no longer shown on the page |
| `attribution` | A line at the foot of the page, e.g. the data's source and license |
| `links` | Links at the foot: a list of `{label, url}` |
| `disclaimer` | A note after "Powered by Data Formulator" (*links*); a generic note on AI-written analyses by default |
| `install_note` | Before the demo is installed: what installing it downloads and builds |
| `analyst_rules` | Guidance added to every analyst request on the demo, e.g. audience and tone (not shown) |
| `starters` | The datasets, in order |

### Each dataset (`starters`)

| Field | Shows |
|---|---|
| `id` | The dataset's id for the analyst, its example-sessions anchor (`#<id>`) and download name |
| `title` | The heading in its tab under the chat and of its example sessions |
| `kicker` | A short name: its tab's label |
| `description` | A paragraph in its tab; also tells the analyst what the dataset holds |
| `source_url` | A "View the source" link in its tab |
| `icon` | Its tab's icon: `school`, `science`, `landmark`, `chart` or `table` (default) |
| `file` | The dataset session ZIP in the release folder: what **Load dataset** opens and the analyst loads; until it exists, the dataset shows "Not available yet" |
| `start_note` | A line on the new-session card (default "With <kicker> loaded") |
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
| `headline` | Its card's title; the analyst sees it too |
| `dek` | A summary (not shown on the page) |
| `featured` | `true` for the dataset's lead analysis: its chart is in front of the stack in the dataset's tab |
| `image` | Its cover chart: on its card and in the dataset's tab |
| `stack` | Images of the lead analysis's findings, `{label, image}` (not shown on the page) |
| `follow_ups` | Questions offered to continue the analysis |

## The analyst on a demo

On a demo, the analyst has a `demo` skill (design-docs/69) instead of the standard data paths: it
has no connected sources, uploads, local folders or terminal. The skill lists the demo's datasets
(from their installed session ZIPs) and example questions (the stories' `prompt`s), and has one action,
`load_datasets`, which copies whole datasets (tables, data guide, docs) into the session. Typing a
question on the front page opens an empty session; the analyst picks the datasets and loads them. Asked
for an example ("Show me your analysis of …"), it runs one of the example questions itself: it loads the
dataset and answers simply with a chart. Its scope is focused questions about the demo's data; for
more (modelling, forecasts, long studies, dashboards, other data) it does the basic part and points
the visitor to the full Data Formulator. On a demo it has no connected-source tools or app building.

`skill/SKILL.md` adds the demo's own guidance: what the demo shows, which dataset answers what, and
how to work with its data. Without one, the analyst gets the `tagline`. `analyst_rules` (audience and
tone) still apply to every request.

The skill is never available in the standard app: it is added only for a request carrying a demo's
`X-DF-Demo` header.

## Deploying

Hosted servers do not offer the Install button: install the demo into the server's
`DF_SITES_DIR`, either by running its `build.py` there or by uploading a folder built with
`--sites-dir <folder>`. It is then at `/demo/<id>`; set `DF_SITE` to make it the server's home
page as well. Nothing in the app build changes. Demos get the same
agents, workspaces, access controls and sandbox as the rest of the app; on a public demo,
visitors' questions use the deployment's model and its sandboxed Python, so plan rate limits
and model budget accordingly.
