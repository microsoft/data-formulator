from __future__ import annotations

import pytest

from data_formulator.analyst.tool_records import (
    CODE_CHARS, ERROR_CHARS, LIST_ITEMS, OUTPUT_HEAD_CHARS, OUTPUT_TAIL_CHARS, TEXT_CHARS, tool_call_record,
)

pytestmark = [pytest.mark.backend]


def _record(**overrides):
    values = dict(call_id="call-1", tool="read_file", args={"files": [{"path": "session/index.md"}]},
                  output="ok", error=None, status="ok", started=10.0, ended=10.25)
    values.update(overrides)
    return tool_call_record(**values)


def test_a_short_call_is_kept_whole():
    assert _record() == {"id": "call-1", "tool": "read_file", "args": {"files": [{"path": "session/index.md"}]},
                         "status": "completed", "createdAt": 10_000, "durationMs": 250, "output": "ok"}


def test_long_output_keeps_its_start_and_end_and_reports_its_size():
    output = "a" * OUTPUT_HEAD_CHARS + "b" * 20_000 + "c" * OUTPUT_TAIL_CHARS
    record = _record(output=output)
    assert record["output"].startswith("a" * OUTPUT_HEAD_CHARS) and record["output"].endswith("c" * OUTPUT_TAIL_CHARS)
    assert "20,000 characters omitted" in record["output"]
    assert record["truncated"] == {"output": len(output)}


def test_code_is_kept_longer_than_other_text_and_errors_keep_their_end():
    code, content = "x" * (CODE_CHARS - 1), "y" * (TEXT_CHARS + 10)
    error = "start " + "z" * ERROR_CHARS + " KeyError: 'year'"
    record = _record(tool="execute_python_script", args={"code": code, "content": content, "rows": list(range(LIST_ITEMS + 5))},
                     error=error, status="error")
    assert record["args"]["code"] == code
    assert record["args"]["content"].startswith("y" * TEXT_CHARS) and "10 more characters" in record["args"]["content"]
    assert len(record["args"]["rows"]) == LIST_ITEMS
    assert record["error"].endswith("KeyError: 'year'") and record["status"] == "failed"
    assert record["truncated"] == {"args.content": len(content), "args.rows": LIST_ITEMS + 5, "error": len(error)}


def test_a_read_keeps_each_file_as_plain_text_under_its_path():
    import json
    output = json.dumps({"files": [
        {"path": "session/tables/sales.json", "name": "Sales", "content": '{\n  "name": "sales"\n}'},
        {"path": "files/missing.md", "error": "no such file"},
    ], "no_match": ["files/*.pdf"]})
    record = _record(output=output)
    assert record["output"] == ('# session/tables/sales.json\n{\n  "name": "sales"\n}\n\n'
                                '# files/missing.md (no such file)\n\n# No match: files/*.pdf')
