# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""A run's plan: the Markdown checklist the agent writes in its own narration.

There is no plan tool. The agent writes ``- [ ] step`` lines alongside its first
action and restates the list only when it changes. Each chart, report, or app it
delivers names the step it serves (``plan_step``), so a step can collect several
results; a step is done once a later step gets a result or the run finishes with
it answered. Without ``plan_step`` the next open step is ticked instead. The
harness asks once before the run ends with steps still open.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

_ITEM = re.compile(r"^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$")
_DROPPED = re.compile(r"^~~(.+?)~~\s*(.*)$")
# Emphasis markers and a "Step 2:" label add nothing to a checklist row.
_EMPHASIS = re.compile(r"(\*\*|__)(.+?)\1")
_STEP_LABEL = re.compile(r"^step\s*\d+\s*[:.)\-–—]\s*", re.IGNORECASE)
# "Plan: short title" (optionally a heading or bold) names the checklist.
_TITLE = re.compile(r"^\s*(?:#{1,6}\s*)?(?:\*\*|__)?plan(?:\*\*|__)?\s*[:：—–-]\s*(?:\*\*|__)?(.+?)(?:\*\*|__)?\s*$", re.IGNORECASE)
# A single checkbox line in prose is not a plan.
_MIN_ITEMS = 2


@dataclass
class PlanItem:
    text: str
    status: str  # "open" | "done" | "dropped"
    note: str = ""
    # Ids of the charts (or kinds of the reports/apps) delivered for this step.
    results: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"text": self.text, "status": self.status, **({"note": self.note} if self.note else {}),
                **({"results": list(self.results)} if self.results else {})}


def _clean(text: str) -> str:
    return _STEP_LABEL.sub("", _EMPHASIS.sub(r"\2", text)).strip()


def _parse_item(match: re.Match) -> PlanItem:
    checked, body = match.group(1), _clean(match.group(2))
    dropped = _DROPPED.match(body)
    if dropped:
        note = dropped.group(2).strip().strip("()").lstrip("—–-:").strip()
        return PlanItem(_clean(dropped.group(1)), "dropped", note)
    return PlanItem(body, "done" if checked.lower() == "x" else "open")


def read_plan(text: str) -> tuple[list[PlanItem] | None, str | None, str]:
    """The checklist in ``text`` (None when there is none), its ``Plan:`` title, and the text without them."""
    lines = (text or "").splitlines()
    matches = [(index, _ITEM.match(line)) for index, line in enumerate(lines)]
    found = [(index, match) for index, match in matches if match]
    if len(found) < _MIN_ITEMS:
        return None, None, (text or "").strip()
    items = [_parse_item(match) for _, match in found]
    indexes = {index for index, _ in found}
    title = None
    for index, line in enumerate(lines[:found[0][0]]):
        match = _TITLE.match(line)
        if match:
            title = match.group(1).strip()
            indexes.add(index)
    rest = "\n".join(line for index, line in enumerate(lines) if index not in indexes)
    return items, title, re.sub(r"\n{3,}", "\n\n", rest).strip()


def split_plan(text: str) -> tuple[list[PlanItem] | None, str]:
    """The checklist in ``text`` (None when there is none) and the text without it or its title."""
    items, _, rest = read_plan(text)
    return items, rest


@dataclass
class RunPlan:
    items: list[PlanItem] = field(default_factory=list)
    title: str | None = None
    reminded: bool = False

    def revise(self, items: list[PlanItem], title: str | None = None) -> None:
        if title:
            self.title = title
        # A restated checklist keeps the results already delivered for its steps. Agents often
        # reword steps when restating, so a list of the same length is matched by position.
        by_text = {item.text: item.results for item in self.items}
        same_shape = len(items) == len(self.items)
        for index, item in enumerate(items):
            kept = self.items[index].results if same_shape else by_text.get(item.text, [])
            item.results = list(kept)
        self.items = items

    def tick(self) -> bool:
        """Mark the first open step done after a delivered result."""
        for item in self.items:
            if item.status == "open":
                item.status = "done"
                return True
        return False

    def record(self, step: Any, result: str) -> bool:
        """Attach a delivered result to the step it serves; earlier open steps are then done.

        Without a valid ``step`` the next open step is ticked and takes the result.
        """
        if not self.items:
            return False
        index = step - 1 if isinstance(step, int) and not isinstance(step, bool) and 1 <= step <= len(self.items) else None
        if index is None:
            target = next((item for item in self.items if item.status == "open"), None)
            if target is None:
                return False
            target.status = "done"
            target.results.append(result)
            return True
        for item in self.items[:index]:
            if item.status == "open":
                item.status = "done"
        self.items[index].results.append(result)
        return True

    def finish(self) -> bool:
        """At the end of the run, steps that received results are done."""
        changed = False
        for item in self.items:
            if item.status == "open" and item.results:
                item.status = "done"
                changed = True
        return changed

    def open_items(self) -> list[PlanItem]:
        return [item for item in self.items if item.status == "open"]

    def event(self, revised: bool) -> dict[str, Any]:
        return {"type": "plan", "revised": revised, "items": [item.to_dict() for item in self.items],
                **({"title": self.title} if self.title else {})}

    def reminder(self) -> str | None:
        """The one reminder before ending with open steps, or None."""
        if self.reminded or not self.open_items():
            return None
        self.reminded = True
        steps = "; ".join(f"{number}) {item.text}" for number, item in enumerate(self.open_items(), start=1))
        return (f"[Automatic message] Your plan still has open steps: {steps}. Continue with the next one. If a "
                "step no longer serves the request, restate the checklist with it struck through "
                "(`- [ ] ~~step~~ (reason)`) and finish.")
