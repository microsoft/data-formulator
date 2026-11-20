# PowerApps with Data Formulator (`powerapps`), preview

A front page for exploring the data behind a Power Apps app with Data Formulator, at
`/demo/powerapps`: a Dataverse environment's accounts and sales opportunities, read live through the
deployment's Dataverse connector. See [../README.md](../README.md) for the `profile.yaml` format and
[../neurips/](../neurips/) for the demo this one follows.

Its source is the deployment's Dataverse connection (`sources: [{connector: dataverse}]`): visitors
browse and load other Dataverse tables from it, and the dataset's tables refresh from it.

| File | Purpose |
|---|---|
| `profile.yaml` | The page: text, the dataset (starter), example analyses (stories), analyst guidance |
| `skill/SKILL.md` | The demo's guidance for the analyst |
| `build.py` | Reads the tables from Dataverse, builds the dataset and story sessions, installs the demo |
| `make_stories.py`, `apps/` | Computes the story seeds in `stories/` (maintainers) |
| `make_covers.py` | Pictures the story covers in `assets/stories/` (maintainers) |

## Data

`build.py` reads two tables from the Dataverse environment (`--environment-url`, else
`DF_SOURCES__dataverse__params__environment_url`, else the demo's own environment) with the Azure
identity at hand (`az login` locally, the managed identity on a server), which needs read access to
them:

- `account`: name, address and location, sales region, industry, revenue, employees;
- `cr746_opportunity`: estimated value, probability, outcome (Open, Won, Lost), sales stage, product
  line, lead source, estimated and actual close dates.

They are loaded as the Dataverse connector loads them, so in a session they carry their source
(connector `dataverse`) and refresh from it.

## Stories

Each story is a thread of four or five short questions a sales team would ask, each answered with a
chart, and ends in a map and an app; the session opens on the app.

| Story | Chapters |
|---|---|
| `pipeline` | p1 open pipeline by stage · p2 regions · p3 accounts on a map · p4 deals to chase · p5 pipeline explorer (app) |
| `winning` | w1 win rate over time · w2 product lines · w3 lead sources · w4 where we win (map) · w5 sales forecast (app) |

`make_stories.py` computes every table, map and app from the dataset (no AI model) and writes each
story's and chapter's headline, key figure and file into `profile.yaml`; labels and questions are
edited by hand. When the Dataverse data changes, run it again: a chapter's `expect` checks fail when
the data no longer says what its text says.

```bash
C=py-src/data_formulator/demos/powerapps
uv run python $C/build.py --sites-dir /tmp/powerapps-sites
uv run python $C/make_stories.py --sites-dir /tmp/powerapps-sites
uv run python $C/build.py --sites-dir /tmp/powerapps-sites          # again, with the new seeds
DF_SITES_DIR=/tmp/powerapps-sites uv run data_formulator --port 5600 --data-dir /tmp/powerapps-home   # another shell
uv run python $C/make_covers.py --url http://localhost:5600
```

## Deploy

The server needs the Dataverse connector, with its identity (e.g. the App Service's managed identity)
added to the environment as an application user with a read-only security role:

```text
DF_SOURCES__dataverse__type=dataverse
DF_SOURCES__dataverse__name=Dataverse (demo)
DF_SOURCES__dataverse__auto_connect=true
DF_SOURCES__dataverse__params__environment_url=https://<org>.crm.dynamics.com
DISABLE_DATA_CONNECTORS=true          # only administrator connectors: visitors cannot borrow the server's identity
DF_SITE=powerapps                     # / opens the demo
DF_SITES_DIR=/home/df-sites           # persistent storage on App Service
DF_CODE_SIGNING_SECRET=<secret>       # the same secret build.py signs the stories' code with
DF_DEFAULT_MODEL=<model id>           # e.g. global-<provider>-<model>, listed first
```

Build the content with the server's `DF_CODE_SIGNING_SECRET` set, so the stories' tables can be
refreshed there, and upload `<sites dir>/powerapps/` into `DF_SITES_DIR`.
