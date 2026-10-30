from __future__ import annotations

import pytest

from data_formulator.analyst.session_files import SessionFiles
from data_formulator.analyst.session_layer import SessionLayer
from data_formulator.analyst.skills import SkillContext, build_registry
from data_formulator.analyst.skills.report.excerpts import (
    check_report_excerpts,
    compact,
    find_excerpts,
    summarize_checks,
)
from data_formulator.datalake.workspace import Workspace

pytestmark = pytest.mark.backend

PAPER = """# Self-Refine

## 3 Method

The model first generates an output, then **critiques** its own output and
refines it, repeating until a stopping condition is met. We find that iterative
refinement improves performance across all seven tasks we evaluate.
"""


@pytest.fixture()
def workspace(tmp_path):
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.save_workspace_file(PAPER.encode(), "papers/self-refine.md", "text/markdown", agent_managed=True)
    return workspace


def _state():
    return {"derivedTables": [], "charts": [], "conceptShelfItems": [], "generatedReports": [], "textTurns": []}


def _ctx(workspace):
    return SkillContext(client=None, workspace=workspace, payload={"session_layer": SessionLayer(_state(), workspace)})


def test_find_excerpts_reads_attributes_text_and_nesting() -> None:
    report = """# Brief

:::callout{kind="finding"}
Outer.
:::excerpt{source='files/a.md' page=4 title="A paper"}
Quoted *words*.
:::
:::

:::quote{source=files/b.md}
Second.
"""
    excerpts = find_excerpts(report)
    assert [(e.line, e.attrs, e.text) for e in excerpts] == [
        (5, {"source": "files/a.md", "page": "4", "title": "A paper"}, "Quoted *words*."),
        (10, {"source": "files/b.md"}, "Second."),
    ]


def test_compact_ignores_markdown_spacing_and_link_targets() -> None:
    assert compact("The **model** [critiques](https://x.y/z)  its\noutput &amp; more") == \
        "themodelcritiquesitsoutputmore"


def test_excerpts_are_checked_against_their_sources(workspace) -> None:
    report = """# Brief

:::excerpt{source="files/papers/self-refine.md" section="§3"}
The model first generates an output, then critiques its own output and refines it
:::

:::excerpt{source="files/papers/self-refine.md"}
The model first generates an output … improves performance across all seven tasks
:::

:::excerpt{source="files/papers/self-refine.md"}
The model first generates an output, then critiques its own output and refines it, repeating until a stopping rule is met.
:::

:::excerpt{source="files/papers/self-refine.md"}
Self-improvement leads to an intelligence explosion within months of deployment.
:::

:::excerpt{source="https://arxiv.org/abs/2303.17651"}
Anything at all here.
:::

:::excerpt{source="files/papers/missing.md"}
Anything at all here.
:::
"""
    checks = check_report_excerpts(report, SessionFiles(_ctx(workspace)))
    assert [check.status for check in checks] == ["verified", "verified", "close", "not_found", "unchecked", "unchecked"]
    assert "stopping condition" in (checks[2].closest or "")

    summary = summarize_checks(checks)
    assert summary.startswith("[EXCERPTS] 6 excerpt(s): 2 match their sources, 1 are close but not exact, "
                              "1 were not found in their sources, 2 could not be checked.")
    assert "line 15" in summary and "web link" in summary and "does not exist" in summary
    assert summarize_checks([]) is None


def _pdf(pages: list[str]) -> bytes:
    """A minimal PDF with one line of Helvetica text per page."""
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", None, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for text in pages:
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET"
        objects.append(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {len(objects)} 0 R "
                       "/Resources << /Font << /F1 3 0 R >> >> >>")
        kids.append(f"{len(objects)} 0 R")
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
    out, offsets = b"%PDF-1.4\n", []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{offset:010d} 00000 n \n" for offset in offsets).encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def test_pdf_excerpts_are_found_on_their_page_or_reported_on_another(workspace) -> None:
    content = _pdf(["Intro page about nothing in particular.", "Refinement improves accuracy on math tasks."])
    workspace.save_workspace_file(content, "papers/paper.pdf", "application/pdf", agent_managed=True)

    report = """:::excerpt{source="files/papers/paper.pdf" page=2}
Refinement improves accuracy on math tasks.
:::
:::excerpt{source="files/papers/paper.pdf" page=9}
Refinement improves accuracy
:::
"""
    first, second = check_report_excerpts(report, SessionFiles(_ctx(workspace)))
    assert (first.status, first.reason) == ("verified", None)
    assert (second.status, second.reason) == ("verified", "found on page 2, not page 9")


def test_write_report_tells_the_agent_about_misquotes(workspace) -> None:
    skill = build_registry().get_skill("report")
    report = """# Brief

:::excerpt{source="files/papers/self-refine.md"}
Self-improvement leads to an intelligence explosion within months of deployment.
:::
"""
    events = []
    gen = skill.handle_action("write_report", {"report": report}, _ctx(workspace))
    try:
        while True:
            events.append(next(gen))
    except StopIteration as stop:
        observation = stop.value
    assert [event["type"] for event in events] == ["action", "text_delta"]
    assert observation.startswith("[REPORT DELIVERED]")
    assert "were not found in their sources" in observation and "exact words" in observation


def test_write_report_without_excerpts_is_unchanged(workspace) -> None:
    skill = build_registry().get_skill("report")
    events = list(skill.handle_action("write_report", {"report": "# Plain\n\nText."}, _ctx(workspace)))
    assert [event["type"] for event in events] == ["action", "text_delta"]


def test_citation_markers_are_not_part_of_the_quote(workspace) -> None:
    assert compact("Quoted words[^madaan].") == "quotedwords"
    report = """---
style: research
---
:::excerpt{source="files/papers/self-refine.md"}
We find that iterative refinement improves performance[^madaan] across all seven tasks we evaluate.
:::

[^madaan]: Madaan et al. (2023)
"""
    [check] = check_report_excerpts(report, SessionFiles(_ctx(workspace)))
    assert check.status == "verified"
