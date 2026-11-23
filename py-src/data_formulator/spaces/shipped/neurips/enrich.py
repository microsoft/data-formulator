"""LLM readings for the NeurIPS space (maintainers); see README.md.

Two readings, each kept in its own table beside the data (never written over it):

- ``institutions``: the organizations each institution string names, with their country, kind and
  parent organization -> ``<root>/llm/institution_orgs.parquet``
- ``topics``: one topic per paper from NeurIPS 2025–2026's topic list, for every year, so topics
  compare across years -> ``<root>/llm/paper_topics.parquet``. ``topics --check`` measures it
  against the topics authors chose in 2025–2026.

    uv run python py-src/data_formulator/spaces/shipped/neurips/enrich.py institutions
    uv run python py-src/data_formulator/spaces/shipped/neurips/enrich.py topics --check 600
    uv run python py-src/data_formulator/spaces/shipped/neurips/enrich.py topics

Reads ``<root>/dataset/`` (assemble.py). Model calls go to the Azure OpenAI deployment in
``AZURE_API_BASE`` (``--model``, default gpt-6.1-sol) with the signed-in Azure identity. Each batch's
answer is cached under ``<root>/llm/cache/``, so a run stopped midway resumes where it was.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import os
import random
import re
import sys
import time
from pathlib import Path

import pandas as pd

DEFAULT_ROOT = Path.home() / ".cache" / "data-formulator" / "neurips"

# NeurIPS 2025–2026's topics (area -> subarea), the list authors chose from.
TOPICS = [
    "Applications->Chemistry and Drug Discovery", "Applications->Climate", "Applications->Everything Else",
    "Applications->Genetics, Cell Biology, etc", "Applications->Health", "Applications->Language, Speech and Dialog",
    "Applications->Neuroscience, Cognitive Science", "Applications->Physics", "Applications->Robotics",
    "Applications->Time Series",
    "Computer Vision->3D Rendering & Reconstruction", "Computer Vision->Classification and Understanding",
    "Computer Vision->Everything Else", "Computer Vision->Image and Video Generation", "Computer Vision->Segmentation",
    "Computer Vision->Vision Models & Multimodal",
    "Data-centric AI->Data augmentation", "Data-centric AI->Data-centric AI methods and tools",
    "Data-centric AI->Everything Else",
    "Deep Learning->Algorithms", "Deep Learning->Attention Mechanisms", "Deep Learning->Everything Else",
    "Deep Learning->Generative Models and Autoencoders", "Deep Learning->Graph Neural Networks",
    "Deep Learning->Robustness", "Deep Learning->Theory",
    "General Machine Learning->Causality", "General Machine Learning->Everything Else",
    "General Machine Learning->Representation Learning", "General Machine Learning->Transfer, Multitask and Meta-learning",
    "Optimization->Bayesian & Black-box Optimization", "Optimization->Discrete Optimization",
    "Optimization->Everything Else", "Optimization->Large Scale, Parallel and Distributed",
    "Optimization->Neural Network Optimization", "Optimization->Optimization and Learning under Uncertainty",
    "Optimization->Stochastic & Convex Optimization",
    "Probabilistic Methods->Bayesian Models and Methods", "Probabilistic Methods->Everything Else",
    "Probabilistic Methods->Gaussian Processes", "Probabilistic Methods->Monte Carlo and Sampling Methods",
    "Reinforcement Learning->Batch Offline", "Reinforcement Learning->Deep RL", "Reinforcement Learning->Everything Else",
    "Reinforcement Learning->Multi-agent",
    "Social Aspects->Accountability, Transparency and Interpretability", "Social Aspects->Everything Else",
    "Social Aspects->Fairness, Equity, Justice and Safety",
    "Social Aspects->Privacy-preserving Statistics and Machine Learning", "Social Aspects->Trustworthy Machine Learning",
    "Theory->Domain Adaptation and Transfer Learning", "Theory->Everything Else", "Theory->Game Theory",
    "Theory->Learning Theory", "Theory->Reinforcement Learning and Planning",
]
KINDS = ("university", "company", "research institute", "government", "hospital", "nonprofit", "independent", "other")

INSTITUTIONS_PROMPT = f"""You read the affiliation strings authors of NeurIPS papers gave. For each string,
list the organizations it names, in the order written. For each organization give:
- "name": its usual English name, as specific as the string is (keep a lab or campus if named, e.g.
  "Microsoft Research Asia", "Google DeepMind", "UC Berkeley"); fix obvious typos, never invent a unit.
- "parent": the top-level organization it belongs to when it is part of a larger one (Microsoft Research
  Asia -> Microsoft, Google DeepMind -> Google, FAIR -> Meta, MIT CSAIL -> MIT, UC Berkeley -> University
  of California), else null.
- "country": ISO 3166-1 alpha-2 code of where it is (for a company named without a place, its
  headquarters), or null if you cannot tell.
- "kind": one of {", ".join(KINDS)} ("independent" for independent or unaffiliated researchers).
Strings that name no organization (e.g. "-", an email address) get an empty list.
Answer with JSON only: {{"results": [{{"i": <index>, "orgs": [{{"name": ..., "parent": ..., "country": ..., "kind": ...}}]}}]}}
with one entry per string."""

TOPICS_PROMPT = """You classify NeurIPS papers into NeurIPS's topic list (area -> subarea). For each paper,
choose the one topic that fits it best, as its authors would have when submitting today; use an area's
"Everything Else" only when no other topic of that area fits. Topics:
{topics}
Answer with JSON only: {{"results": [{{"i": <paper index>, "t": <topic number>}}]}} with one entry per paper."""


def client(model: str):
    from dotenv import load_dotenv

    from data_formulator.agents.client_utils import Client

    load_dotenv(Path.cwd() / ".env")  # a checkout's .env, as the app reads it
    base = os.environ.get("AZURE_API_BASE")
    if not base:
        sys.exit("Set AZURE_API_BASE (e.g. in .env) to the Azure OpenAI endpoint")
    return Client("azure", model, api_base=base)


EFFORT = "low"
# With it, batches not answered yet are left out instead of asked (to preview the readings so far).
CACHED_ONLY = False


def ask(llm, system: str, user: str) -> dict:
    """One model call answered with JSON; retried with backoff on errors and unparseable answers."""
    for attempt in range(6):
        try:
            response = llm.get_completion([{"role": "system", "content": system}, {"role": "user", "content": user}],
                                          reasoning_effort=EFFORT, timeout=240)
            text = response.choices[0].message.content or ""
            text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
            return json.loads(text)
        except Exception as error:  # network, throttling, malformed JSON: all worth another try
            wait = min(120, 5 * 2 ** attempt)
            print(f"  model call failed ({type(error).__name__}: {str(error)[:120]}); retrying in {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError("model calls keep failing")


def run_batches(root: Path, task: str, batches: list[list], make_request, model: str, workers: int) -> list[dict]:
    """Ask each batch once (answers cached by request), in parallel; returns the answers in batch order."""
    cache = root / "llm" / "cache" / task
    cache.mkdir(parents=True, exist_ok=True)
    llm = client(model)
    requests = [make_request(batch) for batch in batches]
    def key(req) -> str:
        return hashlib.sha1(json.dumps([model, *req] + ([EFFORT] if EFFORT != "low" else []),
                                       ensure_ascii=False).encode()).hexdigest()

    paths = [cache / f"{key(req)}.json" for req in requests]
    todo = [] if CACHED_ONLY else [i for i, path in enumerate(paths) if not path.exists()]
    print(f"{task}: {len(batches)} batches, {len(batches) - len(todo)} cached, {len(todo)} to ask", flush=True)

    def work(i: int) -> None:
        answer = ask(llm, *requests[i])
        tmp = paths[i].with_suffix(".tmp")
        tmp.write_text(json.dumps(answer, ensure_ascii=False))
        tmp.rename(paths[i])

    done = 0
    with cf.ThreadPoolExecutor(workers) as pool:
        for future in cf.as_completed([pool.submit(work, i) for i in todo]):
            future.result()
            done += 1
            if done % 20 == 0 or done == len(todo):
                print(f"  {done}/{len(todo)}", flush=True)
    return [json.loads(path.read_text()) if path.exists() else {} for path in paths]


def chunks(items: list, size: int) -> list[list]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def cmd_institutions(root: Path, model: str, workers: int) -> None:
    authorships = pd.read_parquet(root / "dataset" / "authorships.parquet", columns=["institution"])
    strings = sorted(authorships.institution.dropna().unique())
    batches = chunks(strings, 60)
    answers = run_batches(root, "institutions", batches, lambda batch: (
        INSTITUTIONS_PROMPT, "\n".join(f"{i}. {json.dumps(text, ensure_ascii=False)}" for i, text in enumerate(batch))),
        model, workers)
    rows, missing = [], 0
    for batch, answer in zip(batches, answers):
        by_index = {r.get("i"): r.get("orgs") or [] for r in answer.get("results", []) if isinstance(r, dict)}
        for i, text in enumerate(batch):
            if i not in by_index:
                missing += 1
                continue
            for n, org in enumerate(by_index[i], 1):
                country = (org.get("country") or "").upper() or None
                rows.append({"institution": text, "org_index": n, "organization": org.get("name"),
                             "parent": org.get("parent"), "country_code": country if country and len(country) == 2 else None,
                             "kind": org.get("kind") if org.get("kind") in KINDS else "other"})
    out = root / "llm" / "institution_orgs.parquet"
    pd.DataFrame(rows).to_parquet(out, index=False)
    print(f"{out}: {len(rows):,} organizations for {len(strings) - missing:,} strings ({missing} unanswered)")


def paper_text(paper) -> str:
    abstract = re.sub(r"\s+", " ", paper.abstract or "")[:700]
    return json.dumps({"title": paper.title, "abstract": abstract}, ensure_ascii=False)


def topic_answers(root: Path, papers: pd.DataFrame, model: str, workers: int, task: str = "topics") -> pd.DataFrame:
    system = TOPICS_PROMPT.format(topics="\n".join(f"{n}. {topic}" for n, topic in enumerate(TOPICS, 1)))
    # Batches within a year, so a year's batches (and their cached answers) stay the same as other years change.
    batches = [batch for _, year in papers.groupby("year", sort=True) for batch in chunks(list(year.itertuples()), 25)]
    answers = run_batches(root, task, batches, lambda batch: (
        system, "\n".join(f"{i}. {paper_text(paper)}" for i, paper in enumerate(batch))), model, workers)
    out = []
    for batch, answer in zip(batches, answers):
        by_index = {r.get("i"): r.get("t") for r in answer.get("results", []) if isinstance(r, dict)}
        for i, paper in enumerate(batch):
            number = by_index.get(i)
            topic = TOPICS[number - 1] if isinstance(number, int) and 1 <= number <= len(TOPICS) else None
            out.append({"paper_id": paper.paper_id, "topic": topic})
    return pd.DataFrame(out)


def cmd_topics(root: Path, model: str, workers: int, check: int | None, years: list[int] | None = None) -> None:
    papers = pd.read_parquet(root / "dataset" / "papers.parquet", columns=["paper_id", "year", "title", "abstract", "topic"])
    if years:
        # Only fill the cache for these years (e.g. those whose abstracts are all collected); no table is written.
        topic_answers(root, papers[papers.year.isin(years)], model, workers)
        return
    if check:
        known = papers[papers.year.isin([2025, 2026]) & papers.topic.isin(TOPICS) & papers.abstract.notna()]
        sample = known.sample(min(check, len(known)), random_state=7)
        answers = topic_answers(root, sample, model, workers, task="topics-check").set_index("paper_id").topic
        sample = sample.assign(llm=sample.paper_id.map(answers))
        area = lambda s: s.str.split("->").str[0]
        print(f"agreement with authors' topics ({len(sample)} papers of 2025–2026): "
              f"topic {(sample.llm == sample.topic).mean():.0%}, area {(area(sample.llm) == area(sample.topic)).mean():.0%}")
        confused = (sample[area(sample.llm) != area(sample.topic)]
                    .assign(authors=lambda d: area(d.topic), llm_area=lambda d: area(d.llm))
                    .groupby(["authors", "llm_area"]).size().sort_values(ascending=False).head(8))
        print("most common area disagreements (authors -> LLM):\n" + confused.to_string())
        return
    result = topic_answers(root, papers, model, workers)
    out = root / "llm" / "paper_topics.parquet"
    result.to_parquet(out, index=False)
    print(f"{out}: {result.topic.notna().sum():,} of {len(result):,} papers labelled")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--model", default="gpt-6.1-sol")
    parser.add_argument("--workers", type=int, default=8, help="model calls at once (default 8)")
    parser.add_argument("--effort", default="low", help="reasoning effort (default low)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("institutions")
    topics = sub.add_parser("topics")
    topics.add_argument("--check", type=int, metavar="N", help="only measure agreement on N papers of 2025–2026")
    topics.add_argument("--cached-only", action="store_true", help="write the table from answers cached so far")
    topics.add_argument("--years", help="only ask for these years, e.g. 1987-2000,2020-2025 (fills the cache)")
    args = parser.parse_args()
    random.seed(0)
    global EFFORT
    EFFORT = args.effort
    global CACHED_ONLY
    CACHED_ONLY = getattr(args, "cached_only", False)
    if args.cmd == "institutions":
        cmd_institutions(args.root, args.model, args.workers)
    else:
        years = [y for part in args.years.split(",") for y in range(int(part.split("-")[0]), int(part.split("-")[-1]) + 1)] \
            if args.years else None
        cmd_topics(args.root, args.model, args.workers, args.check, years)


if __name__ == "__main__":
    main()
