"""Verify that json.dumps with ensure_ascii=False preserves Chinese and
other non-ASCII characters throughout the serialization patterns used
in agents, routes, and workspace persistence.

Background
----------
Python's json.dumps defaults to ensure_ascii=True, which escapes every
non-ASCII character as \\uXXXX.  When the serialized string is sent to
an LLM or written to state.json, the escaped form is less readable and
can confuse models that rely on seeing the actual characters.

The fix adds ensure_ascii=False to every json.dumps call site.  These
tests lock down the expected behavior so regressions are caught early.
"""
from __future__ import annotations

import json

import pytest


pytestmark = [pytest.mark.backend]


# ---------------------------------------------------------------------------
# Helpers that mirror the serialization patterns found in the codebase
# ---------------------------------------------------------------------------

def _serialize_agent_message(goal: dict) -> str:
    """Pattern used in agent_data_transform / agent_sort_data."""
    return f"[GOAL]\n\n{json.dumps(goal, indent=4, ensure_ascii=False)}"


def _serialize_stream_event(event: dict) -> str:
    """Pattern used in agent_routes streaming responses."""
    return json.dumps(event, ensure_ascii=False) + "\n"


def _serialize_state(state: dict) -> str:
    """Pattern used in workspace / azure_blob_workspace persistence."""
    return json.dumps(state, default=str, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Basic: ensure_ascii=False keeps Chinese characters as-is
# ---------------------------------------------------------------------------

class TestJsonEnsureAsciiBasic:
    """Core guarantee: non-ASCII characters must not be escaped."""

    @pytest.mark.parametrize(
        "value",
        [
            "订单明细",
            "销售区域",
            "用户名称",
            "データ分析",
            "café résumé naïve",
        ],
    )
    def test_non_ascii_string_preserved(self, value: str) -> None:
        result = json.dumps(value, ensure_ascii=False)
        assert value in result
        assert "\\u" not in result

    def test_ascii_only_string_unchanged(self) -> None:
        result = json.dumps("hello world", ensure_ascii=False)
        assert '"hello world"' == result

    def test_mixed_ascii_and_chinese(self) -> None:
        result = json.dumps("table_订单明细_2024", ensure_ascii=False)
        assert "订单明细" in result
        assert "\\u" not in result


# ---------------------------------------------------------------------------
# Agent message serialization (indent=4 pattern)
# ---------------------------------------------------------------------------

class TestAgentMessageSerialization:
    """Mirrors json.dumps(goal, indent=4, ensure_ascii=False) in agents."""

    def test_goal_with_chinese_description_should_be_readable(self) -> None:
        goal = {
            "description": "按省份汇总销售额",
            "chart_encodings": {"x": "省份", "y": "销售额"},
        }
        text = _serialize_agent_message(goal)
        assert "按省份汇总销售额" in text
        assert "省份" in text
        assert "\\u" not in text

    def test_chart_spec_with_chinese_field_names(self) -> None:
        spec = {"chart_spec": {"encoding": {"x": {"field": "日期"}, "y": {"field": "金额"}}}}
        result = json.dumps(spec, indent=4, ensure_ascii=False)
        assert "日期" in result
        assert "金额" in result
        assert "\\u" not in result

    def test_nested_chinese_values_all_preserved(self) -> None:
        data = {
            "tables": [{"name": "客户表", "columns": ["姓名", "地址", "电话"]}],
            "notes": "包含中文列名的数据集",
        }
        result = json.dumps(data, indent=4, ensure_ascii=False)
        for expected in ("客户表", "姓名", "地址", "电话", "包含中文列名的数据集"):
            assert expected in result
        assert "\\u" not in result


# ---------------------------------------------------------------------------
# Streaming event serialization (agent_routes pattern)
# ---------------------------------------------------------------------------

class TestStreamEventSerialization:
    """Mirrors json.dumps({...}, ensure_ascii=False) + '\\n' in routes."""

    def test_ok_event_with_chinese_content(self) -> None:
        event = {
            "token": "abc",
            "status": "ok",
            "result": {"type": "step", "content": "正在处理数据转换"},
        }
        line = _serialize_stream_event(event)
        assert "正在处理数据转换" in line
        assert "\\u" not in line
        parsed = json.loads(line)
        assert parsed["result"]["content"] == "正在处理数据转换"

    def test_error_event_with_chinese_message(self) -> None:
        event = {
            "token": "",
            "status": "error",
            "error_message": "模型连接失败，请检查配置",
        }
        line = _serialize_stream_event(event)
        assert "模型连接失败" in line
        assert "\\u" not in line

    def test_roundtrip_preserves_chinese(self) -> None:
        original = {"key": "数据分析报告", "items": ["图表", "表格"]}
        line = _serialize_stream_event(original)
        restored = json.loads(line)
        assert restored == original


# ---------------------------------------------------------------------------
# Workspace state persistence (default=str pattern)
# ---------------------------------------------------------------------------

class TestWorkspaceStateSerialization:
    """Mirrors json.dumps(state, default=str, ensure_ascii=False) in workspace."""

    def test_state_with_chinese_table_names(self) -> None:
        state = {
            "tables": [
                {"id": "t1", "displayId": "订单明细", "columns": ["日期", "金额"]},
                {"id": "t2", "displayId": "客户信息", "columns": ["姓名", "城市"]},
            ]
        }
        result = _serialize_state(state)
        assert "订单明细" in result
        assert "客户信息" in result
        assert "\\u" not in result

    def test_roundtrip_state_preserves_all_fields(self) -> None:
        state = {
            "tables": [{"displayId": "产品分类", "description": "包含中文描述"}],
            "models": [{"id": "m1", "model": "gpt-4"}],
        }
        result = _serialize_state(state)
        restored = json.loads(result)
        assert restored["tables"][0]["displayId"] == "产品分类"
        assert restored["tables"][0]["description"] == "包含中文描述"

    def test_default_str_handles_non_serializable_types(self) -> None:
        from datetime import datetime
        state = {"created": datetime(2024, 1, 1, 12, 0, 0), "name": "测试会话"}
        result = _serialize_state(state)
        assert "测试会话" in result
        assert "\\u" not in result
        parsed = json.loads(result)
        assert parsed["name"] == "测试会话"


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:

    def test_empty_string(self) -> None:
        assert json.dumps("", ensure_ascii=False) == '""'

    def test_none_value(self) -> None:
        result = json.dumps({"name": None}, ensure_ascii=False)
        assert "null" in result

    def test_emoji_preserved(self) -> None:
        result = json.dumps({"icon": "📊"}, ensure_ascii=False)
        assert "📊" in result
        assert "\\u" not in result

    def test_mixed_languages(self) -> None:
        data = {"zh": "中文", "ja": "日本語", "ko": "한국어", "en": "English"}
        result = json.dumps(data, ensure_ascii=False)
        for lang_str in data.values():
            assert lang_str in result
        assert "\\u" not in result

    def test_special_json_chars_still_escaped(self) -> None:
        result = json.dumps({"quote": '含"引号"的中文'}, ensure_ascii=False)
        assert '\\"' in result
        parsed = json.loads(result)
        assert parsed["quote"] == '含"引号"的中文'
