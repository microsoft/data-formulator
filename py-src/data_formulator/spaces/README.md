# Spaces

A space is a front page of your own at `/space/<id>`: your title and text, your datasets,
example analyses to open, and questions to start from, around the analyst chat. Visitors go from
the page into the normal Data Formulator workspace, which stays under `/space/<id>`; the standard
app is still at `/app`. In the workspace, the analyst knows the space: it loads the space's datasets
for a question and points visitors to its example analyses (see [The analyst on a space](#the-analyst-in-a-space)).

A space is configuration, not code. Data Formulator's landing page lays it out from a
`profile.yaml` (the space parts are in `src/spaces/`), so customizing it needs no frontend build and
works with a pip-installed Data Formulator. [`shipped/unesco/`](shipped/unesco/) (the
UIS Data Explorer, at `/space/unesco`) ships with Data Formulator and is a complete example to
start from.

A space adds content, not restrictions: what visitors may do (their own connections, linked folders, the
terminal and MCP servers) is set by the deployment, the same as in the standard app. A space on your own
computer offers everything a local Data Formulator does; a public one is as open as its server allows. See
[design-docs/77](../../../design-docs/77-spaces.md) for the grid of what each combination offers.

The code is in this folder (`data_formulator.spaces`, and `src/spaces/` for the page); the spaces shipped with
Data Formulator are in [`shipped/`](shipped/). Spaces were called *demos*; a few stored names keep the old words so
that existing work is found: users' work under `<root>/sites/<id>/`, installed content under `site-content/`, browser
storage names ending in `:demo:<id>`, data-folder connectors `demo-<id>-<folder>`, and the `site` field of schedules
and shares.

## How a space is served

The page reads its id from the path and sends it with every API request (header
`X-DF-Space`). That selects the space's profile and analyst guidance, and keeps its visitors'
sessions apart: on the server under `<root>/sites/<id>/`, in the browser under storage names
ending in `:demo:<id>`. Moving between a space and the standard app loads the page again; the
menu on the app name switches between them, listing the spaces that are installed (or, on a
local Data Formulator, installable).
Space names in navigation omit trailing "in Data Formulator" or "with Data Formulator";
the full profile name is kept for the browser title and page branding.
Content (sessions, images) is served from `/api/spaces/<id>/...`.

## Folder

A space's content is installed in its own folder under `DF_SPACES_DIR` (default
`~/.data_formulator/site-content`):

```text
<DF_SPACES_DIR>/<id>/
  profile.yaml            # the page and its datasets (below)
  skill/SKILL.md          # optional: the space's guidance for the analyst (below)
  <release>/              # content: sessions and front-page images
    <starter>.zip         # one per dataset: its tables and notes
    stories/<story>.zip   # one per example analysis: the dataset with the story's question answered
    hero.png, stories/<story>.png
```

`<id>` uses lowercase letters, digits and hyphens. It is in the space's URL and names the
folder where its users' sessions are kept, so keep it stable once deployed.

Sessions are Data Formulator sessions: export one from the app, or build them with a script.

A space of your own is just this folder: no code, no build, no change to Data Formulator. Make its sessions
in the app and export them, write `profile.yaml` (below), and copy the folder into `DF_SPACES_DIR`; a new
folder shows up without a restart (edits to an existing profile need one). Its data usually comes from an
administrator connection (`connectors.yaml` in the data folder, or `DF_SOURCES__<id>__*`). In a checkout of
this repository, `local-spaces/` is git-ignored for the sources of spaces kept on one machine, such as one
built on an internal environment.

## Spaces shipped with Data Formulator

Each space in this folder (`py-src/data_formulator/spaces/shipped/`, part of the Python package) has
everything needed to install it, apart from data it downloads:

```text
shipped/<id>/
  profile.yaml            # the page (below)
  skill/SKILL.md          # the space's guidance for the analyst (below)
  assets/                 # front-page images, laid out as the profile names them
  build.py                # downloads the data, builds the sessions, installs the space
  README.md               # plus anything build.py needs, e.g. story seeds
```

Its page is at `/space/<id>` on every Data Formulator. Until its content is installed, the page
shows its introduction and, on a local Data Formulator, an **Install space** button that runs
`build.py` in the server and reloads once it finishes; elsewhere it says the space is not
available yet. A profile installed in `DF_SPACES_DIR` takes precedence over the shipped one.

`build.py` defines `install(spaces_dir, *, log)`, which the button calls, and runs it from the
command line with `--spaces-dir` and other options. Only making its datasets' sessions is its own
(downloading UIS files, reading NeurIPS's collected data, reading Dataverse); the rest is shared in
`data_formulator.spaces.builder`. `dataset_state` records each dataset table as loaded from the space's
source (`sources`), as the sidebar records a table it loads, so the session shows where it came from
and Refresh reads it again; `build_stories` assembles the stories from their seeds; and `finish`
copies `profile.yaml`, `skill/` and `assets/` beside them, writes the data folders, and fails if any
file the profile names is missing.
It must not call AI models: data goes in as downloaded and processed, and an analysis made with
the AI analyst goes in as curated content, as the UIS space does with its small story seeds (see
[unesco/README.md](unesco/README.md)). Tests are in `tests/backend/spaces/`.

## Settings

| Setting | Effect |
|---|---|
| `DF_SPACE=<id>` | `/` opens the space (`/app` is still the standard app) |
| `DF_SPACES_DIR=/path/to/spaces` | Where space content is installed (default `<DATA_FORMULATOR_HOME>/site-content`) |
| `DF_SPACES=<id>,<id>` | The spaces the server offers; any other (installed or shipped) is treated as missing. Default all |
| `DF_SPACES__<id>__models=<id>,<id>` | The server models offered in that space, overriding the profile's `models` |
| `DF_SPACES__<id>__connectors=<id>,<id>` | More administrator connections shown in that space besides its `sources`, e.g. `sample_datasets` for the example datasets |

The `DF_SPACES__<id>__…` settings are the operator's: what a space costs and exposes on this server, kept out of
the profile so the same space runs unchanged on a laptop and on a public server. A `-` in the id may be written
`_`. Everything else visitors may do (their own connections and models, uploads, the terminal) follows the
deployment's settings as in the standard app.

Profiles are read once per server start (and again after an install); restart after editing
one. If a profile is invalid, the server logs why and `/space/<id>` says there is no such space.

## `profile.yaml`

Text fields marked *links* may contain `[text](url)` links to `https://`, `http://`,
`mailto:`, `/path` or `#anchor` URLs; other URLs show as plain text. `{release}` in `about`
and `intro` reads as the release's month and year (e.g. `2026-02` → February 2026).

### Page

| Field | Shows |
|---|---|
| `name` | The space's name: browser title and app bar, and the page title unless `headline` is set |
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
| `logo` | An image in the release folder (`.svg`, `.png`, `.jpg`, `.webp`), shown above the page title and beside the name in the app bar |
| `chart_theme` | The space's chart theme, a Flint ThemeSpec (as saved by the theme skill: `id`, `label`, `extends`, `ink`, `type`, …): new charts and maps on the space use it unless the visitor picks another default, and it is listed with the chart themes |
| `attribution` | A line at the foot of the page, e.g. the data's source and license |
| `links` | Links at the foot: a list of `{label, url}` |
| `workspace_collapsed` | `true` to start sessions with the workspace folded into one card (its name and a few tables) |
| `sources` | Where the space's data comes from: a list of `{connector: <id>}` (a deployment administrator connection, e.g. `{connector: dataverse}` for `DF_SOURCES__dataverse__*`) and `{folder: <name>, name: <label>}` (the datasets' tables, extracted on install into `<release>/<name>/<dataset id>/<table>.parquet` by `spaces.data_folder.write_data_folders`, offered as a read-only folder). They are shown and connected first; other administrator connections, including the example datasets, are hidden in the space unless the operator exposes them (`DF_SPACES__<id>__connectors`). Visitors' own connections and folders follow the deployment. Default none |
| `models` | The server models the space offers, by id, unless the operator sets `DF_SPACES__<id>__models`; others are hidden and refused on space requests. Default all (see [design-docs/76](../../../design-docs/76-scopes.md)) |
| `workflows` | The server workflows (`server/<name>.yaml`) the space offers; Data Formulator's example workflows are the standard app's. Default none |
| `disclaimer` | A note after "Powered by Data Formulator" (*links*); a generic note on AI-written analyses by default |
| `install_note` | Before the space is installed: what installing it downloads and builds |
| `analyst_rules` | Guidance added to every analyst request on the space, e.g. audience and tone (not shown) |
| `starters` | The datasets, in order |

### Each dataset (`starters`)

| Field | Shows |
|---|---|
| `id` | The dataset's id for the analyst, its example-sessions anchor (`#<id>`) and download name |
| `title` | The heading in its tab under the chat and of its example sessions |
| `kicker` | A short name: its tab's label |
| `description` | What the dataset holds, for the analyst; shown in its tab when there is no `summary` |
| `summary` | What the dataset holds, in a couple of plain sentences for visitors, shown in its tab instead of the description (which shows on hover) |
| `source_url` | A "View the source" link in its tab |
| `source_name` | The dataset's name at its source (e.g. "UIS SDG 4 Global and Thematic Indicators"), as the label of that link, so titles can stay in plain words |
| `icon` | Its tab's icon: `school`, `science`, `landmark`, `chart` or `table` (default) |
| `file` | The dataset session ZIP in the release folder: what **Analyze in Data Formulator** opens and the analyst loads; until it exists, the dataset shows "Not available yet" |
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
| `id` | Required; unique across the space |
| `prompt` | Required: the question the story starts from, shown on the lead card ("Question: …") and on hover for the others; asked live when there is no session |
| `file` | The story's session ZIP, under the release folder |
| `title` | Its card's title: what its map or dashboard shows, in plain words |
| `headline` | Its finding: the card's title when there is no `title` (on hover otherwise); the analyst sees it too |
| `dek` | A summary (not shown on the page) |
| `featured` | `true` for the dataset's lead analysis: its chart is in front of the stack in the dataset's tab |
| `image` | Its cover chart: on its card and in the dataset's tab |
| `stack` | Images of the lead analysis's findings, `{label, image}` (not shown on the page) |
| `chapters` | For a session holding several findings: each `{label, kind, headline, stat, message}` (`kind`: story, dashboard, map or chart; `stat`, optional, a short key figure such as "67%" shown large beside `message`, in place of the headline). A story with chapters shows as one large card listing them; it opens on the session |
| `follow_ups` | Questions offered to continue the analysis |

## The analyst in a space

In a space the analyst has everything the deployment offers in the standard app (uploads, apps, workflows,
visitors' own connections, the terminal and MCP servers on a local install), the space's sources, and a `space` skill (design-docs/69). The skill lists the
space's datasets (from their installed session ZIPs) and example questions (the stories' `prompt`s), and
has one action, `load_datasets`, which copies whole datasets (tables, data guide, docs) into the session.
Typing a question on the front page opens an empty session; the analyst picks the datasets and loads
them. Asked for an example ("Show me your analysis of …"), it runs one of the example questions itself:
it loads the dataset and answers simply with a chart.

Spaces differ only in their data. Its sources are what its profile lists (`sources`): a connection
the deployment configures, such as a Dataverse environment (`{connector: dataverse}`), or a folder of the
datasets' own tables, as in [`shipped/unesco/`](shipped/unesco/) and [`shipped/neurips/`](shipped/neurips/), which a build writes
with `write_data_folders`. Either way the dataset sessions' tables are loaded from that source and
refresh from it. Visitors may add their own data as the deployment allows; the example datasets are not
shown unless the operator exposes them.

`skill/SKILL.md` adds the space's own guidance: what the space shows, which dataset answers what, and
how to work with its data. Without one, the analyst gets the `tagline`. `analyst_rules` (audience and
tone) still apply to every request.

The skill is never available in the standard app: it is added only for a request carrying a space's
`X-DF-Space` header.

Each space is its own scope ([design-docs/76](../../../design-docs/76-scopes.md)): a visitor's sessions,
workflows, schedules and connections on a space are kept apart from the standard app's and other spaces'.

## Deploying

Hosted servers do not offer the Install button: install the space into the server's
`DF_SPACES_DIR`, either by running its `build.py` there or by uploading a folder built with
`--spaces-dir <folder>`. It is then at `/space/<id>`; set `DF_SPACE` to make it the server's home
page as well, and `DF_SPACES` to offer only the spaces the deployment is for (the shipped ones are
otherwise all listed, uninstalled ones as "not available yet"). Nothing in the app build changes. Spaces get the same
agents, workspaces, access controls and sandbox as the rest of the app; on a public space,
visitors' questions use the deployment's model and its sandboxed Python, so plan rate limits
and model budget accordingly (`DF_SPACES__<id>__models`). To keep a public space to its own data, turn off
user connections for the deployment (`DISABLE_DATA_CONNECTORS`, or "Disable user-created connections" under
Administration), as for the standard app.
