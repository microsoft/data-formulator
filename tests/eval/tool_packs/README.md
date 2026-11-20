# Tool packs vs. skill prompts: Research (arXiv + OpenAlex) and Hugging Face

Do the Research and Hugging Face tool packs help the agent, or would a skill prompt (API recipes the agent runs
with the terminal) do as well? This eval compares reliability, speed and route choice on questions the packs
cover, and the cost of the packs on questions they do not cover.

```
uv run python tests/eval/tool_packs/run.py --name v1                     # 18 questions x 3 conditions x 2 models
uv run python tests/eval/tool_packs/run.py --name smoke --questions r4 h2 --models gpt-6-luna
uv run python tests/eval/tool_packs/run.py --report experiment_data/tool_eval/runs/v1   # regrade + summary.md
```

Outputs go to `experiment_data/tool_eval/runs/<name>/` (git-ignored): `results.jsonl`, `summary.md`, the raw
event streams under `<condition>/traces/`, and each server's home with `llm_calls.jsonl`. Manual review notes in
`grades.json` override or annotate the automatic grade.

## Design

Each condition runs on its own Data Formulator server and home. Tools run in Auto mode, so sandboxed terminal
commands and read-only MCP tools run without asking. The browser is off.

| Condition | What the agent has |
|---|---|
| `tools` | The Research and Hugging Face packs, added as in the Tools dialog, plus the terminal. |
| `skill` | No packs. Two guidance-only skills (`experiment_data/tool_eval/skills/*/SKILL.md`) describe the same APIs as recipes for `run_terminal`. |
| `bare` | Only the terminal, with no recipes. |
| `accounts` | No packs. The `huggingface` and `accounts` skills (`api_fetch`, and `propose_signin` with built-in or agent-written specs; design-docs/72), plus the terminal. On a sign-in card, the harness saves a test key for `httpbin.org` and declines elsewhere. |

The other conditions hide the `huggingface` skill with an eval-only launcher patch, so
they match v1.

Questions: 7 research, 7 Hugging Face and 4 off-topic, with expectations fixed before the runs (`QUESTIONS` in
`run.py`). Answers must match the expected values; questions that need a chart must produce one; and on-topic
answers must rest on a successful MCP call or terminal command, not on memory. Models: `gpt-6.1-sol` and
`gpt-6-luna`, both at low reasoning effort, one trial per cell, 108 runs in total. Within each question and model,
the three conditions run back to back in random order, so arXiv throttling and the OpenAlex budget affect all of
them alike.

## Results (v1, 2026-11-05)

| Topic | Condition | Pass | Median s | Median input tokens | MCP calls (fail) | Terminal calls (fail) |
|---|---|---|---|---|---|---|
| research | tools | **11/14** | 105 | 186k | 19 (8) | 35 (7) |
| research | skill | 14/14 | **26** | **110k** | 0 | 21 (1) |
| research | bare | 14/14 | 43 | 133k | 0 | 61 (11) |
| hf | tools | 14/14 ⚠2 | 32 | 155k | 32 (1) | 3 (0) |
| hf | skill | 14/14 | 31 | 142k | 0 | 29 (2) |
| hf | bare | 14/14 ⚠1 | 48 | 157k | 0 | 42 (2) |
| off-topic | tools / skill / bare | 8/8 each | 14 / 20 / 15 | 62k / 54k / 53k | 0 | 2 each (o4, USGS) |

⚠ marks answers that passed but had a quality issue (see below).

### 1. On covered topics, does the tool beat the terminal?

**Research: no, the pack made results worse.** All three failures came from the pack's arXiv client:

- **r3 (newest cs.HC papers), both models:** after one 429, the client refuses all arXiv calls for a cooldown
  that doubles each time (120 s, 240 s, … up to 900 s). The agents waited as told, then gave up; one spent
  792 s. Curl calls to the same API minutes apart, in the other conditions, succeeded.
- **r6 (a fact only in the paper's full text), gpt-6-luna:** `get_full_text` reads `arxiv.org/html`, but the
  same process-wide gate refused it, even though that page was never throttled. The agent then tried 17
  terminal fallbacks (Bing, IEEE, PubMed) and failed.
- **The throttling itself was transient.** Later, both the pack's User-Agent and curl got HTTP 200.

The OpenAlex-backed tools (`search_papers`, `count_papers`) worked well and matched the other conditions'
answers (r1, r2, r5, r7).

**Hugging Face: the pack and the skill prompt tie.**

- **Speed:** the pack matches the skill prompt (median 32 s vs 31 s), and both beat the bare terminal (48 s).
  Everything was correct.
- **Where the pack is better:**
  - Gated datasets (h6): 12–24 s, with clear "accept terms, add a token" guidance.
  - Loading only the columns needed.
- **Where the pack is worse:** dataset search (h5). The Hub matches search text literally against dataset ids.
  The tool passed the phrase "stock prices" through as is and missed `meloqiao/us-stock-data`, which has
  161k downloads, 30× more than its top result. All four terminal runs searched "stock" and filtered the
  results themselves.

### 2. Does the agent pick the right method?

**`tools` condition:**
- The agent used the pack in 9/14 research runs and 12/14 HF runs. The rest went straight to curl, and all 7 of
  those runs passed. Skipping the pack was faster too: median 29 s vs 187 s on research.
- In empty sessions the terminal is preloaded, while a pack needs a `load_skill` first. So curl is the default
  path whenever the model knows the API, and the pack has to justify the extra step.

**`skill` condition:** the agent loaded the recipe skill in 12/14 research runs and 14/14 HF runs.

**`bare` condition:** the agent never gave up and never answered from memory (28/28 used the terminal and
passed). Several times it found better routes than the pack:
- **r3:** after the API returned 429, it scraped the `arxiv.org/list/cs.HC/recent` HTML listing.
- **h3:** it used the dataset viewer's `/statistics` endpoint, which answers in one call.
- **h5:** it broadened the Hub search.

The cost is trial and error: 61 research terminal calls, 11 of which failed. In the worst case, a gpt-6-luna
trend question (r2) took 896 s.

The skill prompt keeps that resourcefulness and removes most of the trial and error: 21 research terminal
calls, with 1 failure.

### 3. What do the packs cost on unrelated questions?

The cost is negligible:
- **Prompt size:** the packs add about 240 input tokens to the first call (+0.9%: two lines in the skill
  index); the skill docs add about 105.
- **Behavior:** no off-topic run loaded or called a pack or skill, and correctness and time were unchanged.
  The USGS request (o4) went to the terminal in every condition.
- **Once loaded:** a pack costs about 2.4× the context of the recipe doc. Research is about 8.3k characters
  (body plus 5 tool schemas) vs 3.5k; Hugging Face is about 6.8k vs 2.7k. The tool schemas stay in every later
  model call.

## Results (v2, 2026-11-07): API fetch with sign-in cards

Hugging Face questions h1–h7 and off-topic o1/o4, in four conditions, on both models (72 runs).

| Topic | Condition | Pass | Median s | Median input tokens | Calls (fail) |
|---|---|---|---|---|---|
| hf | tools | 14/14 ⚠1 | 57 | 170k | MCP 23 (1), terminal 9 |
| hf | skill | 13/14 ⚠1 | 39 | 147k | terminal 24 (0) |
| hf | bare | 13/14 ⚠1 | 50 | 187k | terminal 45 (7) |
| hf | **accounts** | **14/14** | **36** | **112k** | api_fetch 72 (5, refusals included) |
| off | all four | 4/4 each | 15–24 | 76k–91k | no skill loaded |

- **Both misses are infrastructure.** The two failures (gpt-6-luna, h1, `skill` and `bare`) were model-endpoint
  timeouts on the first call.
- **Sign-in when struggling.** On the gated dataset (h6), both `accounts` runs:
  - offered a Hugging Face sign-in (`reason: gated`);
  - after the decline, explained what was missing, did not ask again, and showed no rows.

  No other question offered a sign-in it did not need.
- **Search quality.** Both `accounts` runs found `meloqiao/us-stock-data` for h5. The skill says Hub search
  matches ids literally. A pack run and a `skill` run missed it again. gpt-6.1-sol paid for it: 19 fetches and
  153 s.
- **Fallback.** As in v1, `bare` gpt-6-luna substituted a community mirror for the gated dataset.
- **Cost on other questions.** The `huggingface` skill adds about 37 tokens to the first call; the packs add
  about 240.
- **Not tested live:** a signed-in run (no Hugging Face account on the eval machine) and rate limiting. Both are
  covered offline in `tests/backend/accounts`.

## Results (v3, 2026-11-07): generic sign-in specs

The `accounts` condition only, both models: Hugging Face h1–h7 (a regression check after the rework), three sign-in
cases, and o1/o4 (24 runs). After the review fixes, the sign-in cases and h6 were run again (8 runs, `v3b`).

| Question | Expected | Result (sol, luna) |
|---|---|---|
| k1: a public Kaggle dataset | No sign-in: Kaggle serves it anonymously | ✅ ✅ downloaded with the terminal; no sign-in offered |
| k2: Titanic competition data (401) | A Kaggle spec: basic auth on www.kaggle.com, plus the rules step | ✅ ✅ both proposed exactly that, with a step linking to the competition's rules page; after the decline they used a public mirror and said so |
| x1: `httpbin.org/bearer` with the user's token | A spec for httpbin.org; sign in, fetch, report | v3 ✅ ❌ (luna did not load the skill); v3b ✅ ✅ |
| h1–h7 (Hugging Face) | As v2 | 14/14 |

- **The full loop runs live.** In x1, the harness plays the user: it saves a test key through the app's own
  `/api/accounts/custom` route, which checks it at the spec's `check` URL. The run resumes, and `api_fetch` gets
  `authenticated: true`. The test key never appears in the agent's stream (httpbin echoes it back; it is scrubbed).
- **Routing fix.** gpt-6-luna missed x1 once because the skill's `when_to_use` did not mention "the user has a
  token for this service". Adding it fixed the miss.
- **Review fixes.** A code review of the generic version found four issues, all fixed with tests:
  - error text was cut before it was scrubbed, so part of a key could survive;
  - percent-encoded and JSON-escaped echoes of a key were not scrubbed;
  - a host anyone can create under a big site, or a shared host like `script.google.com`, passed the one-site rule.
    It now uses the Public Suffix List including private suffixes, a depth limit and a shared-host list;
  - a session-only key replaced the one kept for every session.

## Results (v4, 2026-11-08): Kaggle's current key

Kaggle now recommends an access token (`KGAT_...`) sent as `Authorization: Bearer`. The username + key
pair (HTTP Basic, `kaggle.json`) is a "Legacy API Credentials" option. In v3, both models proposed the legacy
pair, and the grader expected it, because the skill's own example said "`basic`: as Kaggle's API takes them".
That example is gone now, the skill says to prefer the key the documentation currently recommends, and k2
expects `bearer`.

| Skill text | sol | luna |
|---|---|---|
| Example removed, "prefer the current key" added | ✅ bearer (read Kaggle's README) | ❌ basic (wrote the spec from memory) |
| Also "read the current API docs first; never from memory" | ✅ ✅ bearer | ✅ ✅ bearer |

The skill was then cut to its policy (about 620 → 390 words). The spec fields, auth types and proposal fields are
described only in the tool schema, and the two new rules became one sentence. k1, k2, x1 and h6 on both models:
8/8, all Kaggle specs bearer with the rules step, no key leaked (`v4c-lean-skill`).

## Results (v5–v6, 2026-11-08): reusing a login this computer has

g1 ("Sign me in to GitHub, then list my private repositories") expects a GitHub spec (api.github.com, bearer) that
reads the `gh` login, so the card offers it next to a token.

- v5 tried a fixed list of logins the app knew. Dropped: whether the agent may read a local login is the same trust
  as letting it use the terminal, so the agent now passes the read itself (`local`), and the card shows it and the
  hosts the key goes to.
- v6 (`v6b-local-option`, with one sentence in the skill): gpt-6.1-sol passed `local` on both GitHub
  (`gh auth token`) and Kaggle (`~/.kaggle/access_token`); gpt-6-luna on neither (its cards offer a pasted key
  only). Without the sentence, sol did it once in two. k2 and x1 still pass on both models; no key leaked.

## Takeaways

- **Research pack:** as built, a skill prompt is strictly better: more reliable, about 4× faster at the median,
  and about 40% fewer input tokens. To keep the pack, the arXiv client should:
  - gate only `export.arxiv.org/api` (not the HTML or PDF pages);
  - not escalate past one short cooldown on a single 429;
  - not share one lockout across a whole long-lived process.
- **Hugging Face pack:** it adds no measurable value over a skill prompt in Auto mode. If it stays, its search
  should try broader keywords (or tell the agent to), and the gated-dataset handling is worth keeping.
- **Where the packs may still pay off:** these results hold for Auto mode with a working sandbox. In Ask mode,
  each new terminal command needs approval, while a read-only pack tool can be marked "always allow". That
  approval burden was not measured here and could favor the packs.

## Limits

- One trial per cell. arXiv throttling depends on the time of day, and all conditions share one IP address.
- In the `tools` condition, one MCP process serves all concurrent runs (three workers), so one run's 429 can
  lock out another. A single user with parallel chats would see the same effect.
- OpenAlex ran without a key; the runs used about 90% of the day's $0.10 budget but did not exhaust it.
  Hugging Face ran without a token.
- Grading uses regexes plus a manual review of every answer (`grades.json`). Run times include model latency
  and are not a benchmark.
