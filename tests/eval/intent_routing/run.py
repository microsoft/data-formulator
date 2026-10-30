"""Run intent-routing evals against live models (see GUIDELINES.md).

    uv run python tests/eval/intent_routing/run.py --models gpt-6.1-sol gpt-5.6-terra gpt-6-luna
    uv run python tests/eval/intent_routing/run.py --regrade experiment_data/intent_eval/runs/<run>
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import harness  # noqa: E402
from cases import CASES, CASES_BY_ID, GRADES, PASS, grade  # noqa: E402
from harness import Step, Trace  # noqa: E402

DEFAULT_MODELS = ["gpt-6.1-sol", "gpt-5.6-terra", "gpt-6-luna"]


def _model_id(model: str) -> str:
    from data_formulator.model_registry import ModelRegistry
    return ModelRegistry.make_id("azure", model)


def _load_trace(data: dict) -> Trace:
    trace = Trace(steps=[Step(**step) for step in data["steps"]], final_text=data.get("final_text", ""),
                  seconds=data.get("seconds", 0.0), error=data.get("error"))
    return trace


def _row(case_id: str, model: str, repeat: int, trace: Trace) -> dict:
    case = CASES_BY_ID[case_id]
    result, move, reason = grade(case, trace)
    return {
        "case": case_id, "model": model, "repeat": repeat, "session": case.session, "intent": case.intent,
        "split": case.split, "prompt": case.prompt, "ideal": sorted(case.ideal), "acceptable": sorted(case.acceptable),
        "grade": result, "move": move, "reason": reason,
        "path": [f"{s.kind}:{s.name}" for s in trace.path()],
        "seconds": trace.seconds, "trace": trace.to_json(),
    }


def run(args: argparse.Namespace) -> Path:
    harness.snapshot_templates(force=args.refresh_templates)
    name = args.name or time.strftime("%Y%m%d-%H%M%S")
    run_dir = harness.EVAL_ROOT / "runs" / name
    run_dir.mkdir(parents=True, exist_ok=True)
    cases = [c for c in CASES if (not args.cases or c.id in args.cases)
             and (args.set == "all" or c.split == args.set) and (not args.intents or c.intent in args.intents)]
    jobs = [(case, model, rep) for rep in range(args.repeat) for case in cases for model in args.models]
    print(f"{len(jobs)} runs → {run_dir}", flush=True)
    server = harness.Server(run_dir)
    server.start()
    out = open(run_dir / "results.jsonl", "a")
    lock = threading.Lock()
    slots = {model: threading.Semaphore(args.per_model) for model in args.models}
    (run_dir / "traces").mkdir(exist_ok=True)

    def one(case, model, rep):
        for attempt in range(6):
            workspace_id = f"eval-{case.id}-{model.replace('.', '')}-{rep}" + (f"-r{attempt}" if attempt else "")
            with slots[model]:
                state = server.prepare_workspace(case.session, workspace_id, case.focus)
                body = harness.request_body(state, case.prompt, _model_id(model))
                trace = harness.run_case(server, workspace_id, body, tail=1e9 if args.full else 5.0, budget=600 if args.full else 420,
                                         raw_path=run_dir / "traces" / f"{workspace_id}.jsonl")
            limited = any(s.kind == "error" and "Rate limit" in str(s.detail) for s in trace.steps)
            if not limited:
                break
            time.sleep(30 * (attempt + 1))
        return {**_row(case.id, model, rep, trace), "workspace_id": workspace_id}

    try:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(one, *job) for job in jobs]
            for done, future in enumerate(as_completed(futures), 1):
                try:
                    row = future.result()
                except Exception as exc:  # harness failure, not a model failure
                    print(f"  harness error: {exc!r}", flush=True)
                    continue
                with lock:
                    out.write(json.dumps(row, ensure_ascii=False) + "\n")
                    out.flush()
                print(f"[{done}/{len(jobs)}] {row['model']:<14} {row['case']:<26} {row['grade']:<12} "
                      f"{row['move']:<11} {row['seconds']:>6}s  {' > '.join(row['path'])[:90]}", flush=True)
    finally:
        out.close()
        server.stop()
    report(run_dir)
    return run_dir


def regrade(run_dir: Path) -> None:
    rows = [json.loads(line) for line in open(run_dir / "results.jsonl")]
    with open(run_dir / "results.jsonl", "w") as out:
        for row in rows:
            if row["case"] not in CASES_BY_ID:
                continue
            out.write(json.dumps(_row(row["case"], row["model"], row["repeat"], _load_trace(row["trace"])),
                                 ensure_ascii=False) + "\n")
    report(run_dir)


def report(run_dir: Path) -> None:
    rows = [json.loads(line) for line in open(run_dir / "results.jsonl")]
    overrides_path = run_dir / "overrides.json"
    overrides = json.loads(overrides_path.read_text()) if overrides_path.exists() else {}
    for row in rows:
        key = f"{row['model']}/{row['case']}/{row['repeat']}"
        if key in overrides:
            row["auto_grade"], row["grade"] = row["grade"], overrides[key]["grade"]
            row["reason"] = f"[manual] {overrides[key]['reason']}"
    models = sorted({r["model"] for r in rows}, key=lambda m: DEFAULT_MODELS.index(m) if m in DEFAULT_MODELS else 99)
    lines = [f"# Intent routing results — {run_dir.name}", ""]
    header = "| Model | Runs | Pass | Ideal | " + " | ".join(g for g in GRADES[2:]) + " |"
    lines += [header, "|" + "---|" * (header.count("|") - 1)]
    for model in models:
        mine = [r for r in rows if r["model"] == model]
        counts = Counter(r["grade"] for r in mine)
        passed = sum(counts[g] for g in PASS)
        lines.append(f"| {model} | {len(mine)} | {passed} ({100 * passed / max(len(mine), 1):.0f}%) | "
                     f"{counts['IDEAL']} | " + " | ".join(str(counts[g]) for g in GRADES[2:]) + " |")
    lines += ["", "## By intent (pass / runs)", ""]
    intents = sorted({r["intent"] for r in rows})
    lines += ["| Intent | " + " | ".join(models) + " |", "|---|" + "---|" * len(models)]
    for intent in intents:
        cells = []
        for model in models:
            mine = [r for r in rows if r["model"] == model and r["intent"] == intent]
            cells.append(f"{sum(r['grade'] in PASS for r in mine)}/{len(mine)}")
        lines.append(f"| {intent} | " + " | ".join(cells) + " |")
    lines += ["", "## Not passing", ""]
    by_case = defaultdict(list)
    for row in rows:
        by_case[row["case"]].append(row)
    for case_id in sorted(by_case):
        bad = [r for r in by_case[case_id] if r["grade"] not in PASS]
        if not bad:
            continue
        lines.append(f"- **{case_id}** ({bad[0]['session']}) “{bad[0]['prompt']}” — ideal {'/'.join(bad[0]['ideal'])}")
        for r in bad:
            lines.append(f"  - {r['model']} #{r['repeat']}: {r['grade']} ({r['move']}) {r['reason']} — path: "
                         f"{' > '.join(r['path']) or '∅'}")
    lines += ["", "## Mean seconds", ""]
    for model in models:
        mine = [r["seconds"] for r in rows if r["model"] == model]
        lines.append(f"- {model}: {sum(mine) / max(len(mine), 1):.1f}s")
    (run_dir / "summary.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines[:4 + len(models)]))


def scenarios(path: Path) -> None:
    """Write the scenario catalog (one table per intent) from cases.py."""
    lines = ["# Intent routing scenarios", "",
             "Generated from `cases.py` (`run.py --scenarios`). Sessions and sources are described there.", ""]
    for intent in dict.fromkeys(case.intent for case in CASES):
        lines += [f"## {intent}", "", "| Case | Session | Prompt | Ideal | Acceptable | Set | Note |",
                  "|---|---|---|---|---|---|---|"]
        for case in (c for c in CASES if c.intent == intent):
            grounded = "; ".join(f"{move} only after {'/'.join(sorted(tools))}"
                                 for move, tools in case.grounded_by.items())
            note = " ".join(part for part in (case.note, f"({grounded})" if grounded else "") if part)
            focus = f" (focus: {case.focus.get('chartId') or case.focus.get('referenceId')})" if case.focus else ""
            lines.append(f"| `{case.id}` | {case.session}{focus} | {case.prompt} | {', '.join(sorted(case.ideal))} | "
                         f"{', '.join(sorted(case.acceptable)) or '—'} | {case.split} | {note} |")
        lines.append("")
    path.write_text("\n".join(lines))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    parser.add_argument("--cases", nargs="*")
    parser.add_argument("--intents", nargs="*")
    parser.add_argument("--set", choices=["dev", "heldout", "all"], default="all")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--workers", type=int, default=9)
    parser.add_argument("--per-model", type=int, default=3)
    parser.add_argument("--full", action="store_true", help="run each case to completion (for timing), not just its first move")
    parser.add_argument("--name")
    parser.add_argument("--refresh-templates", action="store_true")
    parser.add_argument("--regrade", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--scenarios", action="store_true")
    args = parser.parse_args()
    if args.scenarios:
        scenarios(Path(__file__).resolve().parent / "SCENARIOS.md")
    elif args.regrade:
        regrade(args.regrade)
    elif args.report:
        report(args.report)
    else:
        run(args)


if __name__ == "__main__":
    main()
