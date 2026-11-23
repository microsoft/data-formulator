# NeurIPS in Data Formulator (`neurips`), preview

A front page for exploring NeurIPS papers with Data Formulator, at `/space/neurips`: NeurIPS 2026
(the first held in three cities), NeurIPS over the years (1987–2026), and Microsoft at NeurIPS. See
[../../README.md](../../README.md) for the `profile.yaml` format and [../unesco/](../unesco/) for the space
this one follows.

| File | Purpose |
|---|---|
| `profile.yaml` | The page: text, datasets (starters), example analyses (stories), analyst guidance |
| `skill/SKILL.md` | The space's guidance for the analyst |
| `crawl.py` | Collects the raw data (neurips.cc, papers.nips.cc, OpenAlex, ROR) |
| `enrich.py` | An AI model's readings: organizations in institution strings, topics for every paper |
| `assemble.py` | Turns the raw data and readings into the space's tables |
| `countries.csv` | Country codes, short names and UN SDG regions (from Data Formulator's maps and UIS) |
| `build.py` | Builds the dataset and story sessions and installs the space |
| `make_stories.py`, `apps/` | Computes the story seeds in `stories/` (maintainers) |
| `make_covers.py` | Pictures the story covers in `assets/stories/` (maintainers) |

## Data

Everything is collected under `~/.cache/data-formulator/neurips/` (`--root` to change):

```text
raw/        # downloads as fetched: neurips.cc schedules and paper pages, proceedings pages, OpenAlex works, ROR matches
tables/     # the raw data as tables, values verbatim (crawl.py tables)
llm/        # the AI model's readings, and its answers cached per batch (enrich.py)
dataset/    # the space's tables (assemble.py): papers, authorships, institutions, institution_orgs, countries, conferences
logs/       # output of detached runs
```

Values stay as their sources give them. Institutions are the strings authors wrote ("Microsoft",
"Microsoft Research", "MSR Asia" stay apart); what a string refers to sits beside it in its own
columns and tables: ROR's match (only where ROR was confident), OpenAlex's institution, and an AI
model's reading of the organizations it names (`institution_orgs`). Grouping them is analysis.

```bash
C=py-src/data_formulator/spaces/shipped/neurips
uv run python $C/crawl.py schedule --years 2020-2026          # neurips.cc's data: one file a year
uv run python $C/crawl.py proceedings --years 1987-2025       # the proceedings' lists: one page a year
uv run python $C/crawl.py openalex --years 1987-2026          # OpenAlex's NeurIPS works: ~140 requests
uv run python $C/crawl.py pages --years 2026                  # 2026 abstracts: ~9,300 pages, ~5 hours
uv run python $C/crawl.py proceedings-pages --years 1987-2019 # older abstracts: ~9,700 pages, ~3 hours
uv run python $C/crawl.py ror --years 2020-2026               # ROR matches for ~13,000 institution strings, ~2 hours
uv run python $C/crawl.py tables --years 1987-2026
uv run python $C/assemble.py
uv run python $C/enrich.py institutions                       # ~330 model calls
uv run python $C/enrich.py topics --check 600                 # agreement with authors' topics (about 70% by area)
uv run python $C/enrich.py topics                             # ~1,600 model calls
uv run python $C/assemble.py                                  # again, with the readings
uv run python $C/crawl.py status --years 1987-2026
```

Crawls fetch one page at a time with a delay and can be stopped and run again at any time: they
skip what is cached, wait out network outages, and refuse to run twice at once; `enrich.py` resumes
from its cached answers. To keep a long run going when the terminal closes, start it detached:

```bash
nohup caffeinate -is uv run python $C/crawl.py pages --years 2026 >> ~/.cache/data-formulator/neurips/logs/pages-2026.log 2>&1 &
```

`enrich.py` calls the Azure OpenAI deployment in `AZURE_API_BASE` (from `.env`; `--model`, default
gpt-6.1-sol) with the signed-in Azure identity. OpenAlex is used without an API key (set
`OPENALEX_API_KEY` to use one).

Coverage: abstracts for every paper; authors' institutions
for 98% of authorships from 2020 (neurips.cc), and before that for the papers OpenAlex records
(most years 70–85%, 2006 almost none). papers.nips.cc has no 2025 papers yet apart from the
Creative AI track; 2020–2026 come from neurips.cc. NeurIPS 2026's schedule changes until the
conference: run `crawl.py schedule --years 2026` again (a new dated snapshot) and rebuild.

## Install

```bash
uv run python $C/build.py                         # into DF_SPACES_DIR (~/.data_formulator/site-content)
uv run python $C/build.py --spaces-dir /some/dir   # elsewhere
```

It builds the three dataset sessions from `dataset/` (about 40 MB; no AI models involved), adds each
story's seed to its dataset to make the story sessions, and copies `profile.yaml`, `skill/` and
`assets/` beside them. Installing from the space page works only on a computer that has collected
the dataset.

## Stories

Each dataset opens on one example session, a story: a thread of a few questions already answered,
each a chapter with its own dashboard or map, computed from the data by `make_stories.py` (no AI
model): its tables (Python the app can run again), its map or dashboard (`apps/`), and its answer,
every figure taken from the computed rows. The front page shows each story as one card listing its
chapters (`chapters` in `profile.yaml`); a chapter opens the session on its own dashboard or map.

| Story | Chapters |
|---|---|
| `this-year` | n21 where authors work (map) · n20 what it is about · n23 who publishes most (map) · n22 three cities and their poster sessions |
| `since-1987` | h23 topics over time · h21 words in titles · h20 growth · h22 where authors work · h24 where NeurIPS met (map) |
| `microsoft-at-neurips` | m20 Microsoft's 2026 papers and when to see them · m23 what it works on · m21 its co-authors (map) · m22 over the years |

`make_stories.py` writes each story's headline and each chapter's finding (`headline`) and lead file
(`file`) into `profile.yaml`; labels, kinds and questions are edited by hand. `make_covers.py`
pictures each story's cover (its first chapter) and each chapter.

```bash
uv run python $C/build.py --spaces-dir /tmp/neurips-spaces
uv run python $C/make_stories.py --spaces-dir /tmp/neurips-spaces [--only <story id> ...]
uv run python $C/build.py --spaces-dir /tmp/neurips-spaces          # again, with the new seeds
DF_SPACES_DIR=/tmp/neurips-spaces uv run data_formulator --port 5600 --data-dir /tmp/neurips-home   # another shell
uv run python $C/make_covers.py --url http://localhost:5600 [--only <story id> ...]
```

Use a fresh `--data-dir` for covers after changing a story: a story already opened there is reopened,
not imported again. `assets/hero.png` is the app at 1280×800 (pictured at 2x) with the `this-year` session open on its organizations map (n4, "Where NeurIPS 2026 papers are written").

## Run locally

```bash
uv run data_formulator                     # then open /space/neurips
DF_SPACE=neurips uv run data_formulator     # / opens the space
```

Sources: [neurips.cc](https://neurips.cc) (the virtual site's data and paper pages),
[papers.nips.cc](https://papers.nips.cc) (the proceedings), [OpenAlex](https://openalex.org) and
[ROR](https://ror.org) (both CC0). The space is independent of NeurIPS and the NeurIPS Foundation.
