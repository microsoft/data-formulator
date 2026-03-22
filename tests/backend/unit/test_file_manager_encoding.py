from __future__ import annotations

import pytest

from data_formulator.datalake.file_manager import normalize_text_encoding


pytestmark = [pytest.mark.backend]

CHINESE_CSV = "姓名,年龄\n张三,25\n李四,30\n"
ASCII_CSV = "name,age\nAlice,25\nBob,30\n"


# ---- UTF-8 fast path ----

def test_utf8_passthrough() -> None:
    raw = CHINESE_CSV.encode("utf-8")
    assert normalize_text_encoding(raw, "csv") == raw


def test_ascii_passthrough() -> None:
    raw = ASCII_CSV.encode("ascii")
    assert normalize_text_encoding(raw, "csv") == raw


def test_empty_content() -> None:
    assert normalize_text_encoding(b"", "csv") == b""


# ---- BOM handling ----

def test_utf8_bom_stripped() -> None:
    bom = b"\xef\xbb\xbf"
    body = CHINESE_CSV.encode("utf-8")
    result = normalize_text_encoding(bom + body, "csv")
    assert result == body


def test_utf8_bom_stripped_for_txt() -> None:
    bom = b"\xef\xbb\xbf"
    body = CHINESE_CSV.encode("utf-8")
    result = normalize_text_encoding(bom + body, "txt")
    assert result == body


# ---- GBK / GB18030 conversion ----

def test_gbk_converted_to_utf8() -> None:
    raw = CHINESE_CSV.encode("gbk")
    result = normalize_text_encoding(raw, "csv")
    assert result.decode("utf-8") == CHINESE_CSV


def test_gb18030_converted_to_utf8() -> None:
    raw = CHINESE_CSV.encode("gb18030")
    result = normalize_text_encoding(raw, "csv")
    assert result.decode("utf-8") == CHINESE_CSV


def test_gbk_txt_converted_to_utf8() -> None:
    tsv = "姓名\t年龄\n张三\t25\n"
    raw = tsv.encode("gbk")
    result = normalize_text_encoding(raw, "txt")
    assert result.decode("utf-8") == tsv


# ---- Non-text file types are skipped ----

def test_excel_type_not_converted() -> None:
    raw = CHINESE_CSV.encode("gbk")
    assert normalize_text_encoding(raw, "excel") == raw


def test_json_type_not_converted() -> None:
    raw = CHINESE_CSV.encode("gbk")
    assert normalize_text_encoding(raw, "json") == raw


def test_parquet_type_not_converted() -> None:
    raw = b"\x00\x01\x02\x03"
    assert normalize_text_encoding(raw, "parquet") == raw


# ---- Realistic multi-column GBK CSV ----

def test_gbk_multicolumn_csv() -> None:
    content = "编号,姓名,部门,薪资\n1,王五,技术部,15000\n2,赵六,市场部,12000\n"
    raw = content.encode("gbk")
    result = normalize_text_encoding(raw, "csv")
    assert result.decode("utf-8") == content
