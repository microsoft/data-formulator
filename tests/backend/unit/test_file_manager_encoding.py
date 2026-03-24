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


def test_gb18030_bmp_converted_to_utf8() -> None:
    """GB18030 BMP characters are a superset of GBK — should still decode."""
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


# ---- Medium GBK content (>100 bytes, around charset_normalizer reliability threshold) ----

def test_gbk_medium_content() -> None:
    """~150 bytes in GBK — past the small-sample danger zone."""
    rows = [
        "编号,姓名,部门,城市,薪资",
        "1,王五,技术部,北京,15000",
        "2,赵六,市场部,上海,12000",
        "3,孙七,财务部,广州,13000",
        "4,周八,人事部,深圳,11000",
        "5,吴九,运维部,杭州,14000",
    ]
    content = "\n".join(rows) + "\n"
    raw = content.encode("gbk")
    assert len(raw) > 100, f"Test content should be >100 bytes, got {len(raw)}"
    result = normalize_text_encoding(raw, "csv")
    assert result.decode("utf-8") == content


# ---- Large GBK content (realistic file size) ----

def test_gbk_large_content() -> None:
    """Larger files are the common real-world case."""
    rows = ["编号,姓名,部门,薪资"]
    for i in range(200):
        rows.append(f"{i},测试用户{i},研发部,{10000 + i}")
    content = "\n".join(rows) + "\n"
    raw = content.encode("gbk")
    result = normalize_text_encoding(raw, "csv")
    assert result.decode("utf-8") == content


# ---- Non-GBK encodings (charset_normalizer / fallback path) ----

def test_shift_jis_with_halfwidth_katakana() -> None:
    """Shift-JIS half-width katakana (0xA1-0xDF single bytes) followed by
    ASCII < 0x40 are invalid in GBK, forcing the fallback path.
    Content must be large enough (>100 bytes) for charset_normalizer to
    reliably detect Shift-JIS."""
    rows = ["id,品名,カテゴリ"]
    for i in range(20):
        rows.append(f"{i},テスト商品{i},ｱｲｳ")
    content = "\n".join(rows) + "\n"
    raw = content.encode("shift_jis")
    assert len(raw) > 100
    result = normalize_text_encoding(raw, "csv")
    assert result.decode("utf-8") == content


def test_pure_kanji_shift_jis_decoded_as_gbk_is_known_tradeoff() -> None:
    """Pure-kanji Shift-JIS is indistinguishable from GBK at the byte level.
    GBK-first strategy deliberately accepts this — document as known limit."""
    content = "名前,年齢\n田中太郎,30\n"
    raw_sjis = content.encode("shift_jis")
    result = normalize_text_encoding(raw_sjis, "csv")
    # GBK decodes the bytes "successfully" to different characters —
    # the result will NOT equal the original.  We just verify it doesn't crash
    # and returns valid UTF-8.
    result.decode("utf-8")  # must not raise


# ---- Korean (EUC-KR) ----

def test_euckr_decoded_as_gbk_is_known_tradeoff() -> None:
    """EUC-KR byte range (0xA1-0xFE, 0xA1-0xFE) overlaps with GBK.
    GBK-first strategy will misinterpret Korean as Chinese — known limit,
    same as the pure-kanji Shift-JIS case."""
    content = "이름,나이\n홍길동,25\n김철수,30\n"
    raw = content.encode("euc-kr")
    result = normalize_text_encoding(raw, "csv")
    result.decode("utf-8")  # must not raise


def test_euckr_with_large_content() -> None:
    """Larger EUC-KR content — GBK will still consume it (known tradeoff).
    Verify no crash and valid UTF-8 output."""
    rows = ["번호,이름,부서,급여"]
    for i in range(20):
        rows.append(f"{i},테스트사용자{i},개발부,{10000 + i}")
    content = "\n".join(rows) + "\n"
    raw = content.encode("euc-kr")
    assert len(raw) > 100
    result = normalize_text_encoding(raw, "csv")
    result.decode("utf-8")  # must not raise


# ---- Western European (Latin-1 / ISO-8859-1) ----

def test_latin1_french_converted_to_utf8() -> None:
    """French text with accented characters in Latin-1.
    Accented chars (0x80-0xFF) at end of fields followed by comma/newline
    (< 0x40) break GBK → falls through to charset_normalizer or latin-1."""
    rows = ["id,nom,département,salaire"]
    for i in range(20):
        rows.append(f"{i},employé numéro {i},côté création,{3000 + i}")
    content = "\n".join(rows) + "\n"
    raw = content.encode("latin-1")
    assert len(raw) > 100
    result = normalize_text_encoding(raw, "csv")
    assert result.decode("utf-8") == content


def test_latin1_german_decoded_as_gbk_is_known_tradeoff() -> None:
    """German umlauts (ö ü ß) followed by ASCII letters (≥0x40)
    form valid GBK double-byte pairs, so GBK 'succeeds' before
    charset_normalizer gets a chance.  Known tradeoff."""
    rows = ["id,name,straße,größe"]
    for i in range(20):
        rows.append(f"{i},Müller Nürnberg {i},Königstraße,{170 + i}")
    content = "\n".join(rows) + "\n"
    raw = content.encode("latin-1")
    result = normalize_text_encoding(raw, "csv")
    result.decode("utf-8")  # must not raise


# ---- Russian (Windows-1251) ----

def test_windows1251_russian_converted_to_utf8() -> None:
    """Russian text in Windows-1251.
    Cyrillic bytes (0xC0-0xFF) followed by newline/comma break GBK →
    falls through to charset_normalizer detection."""
    rows = ["номер,имя,отдел,зарплата"]
    for i in range(20):
        rows.append(f"{i},Тестовый сотрудник {i},Разработка,{50000 + i}")
    content = "\n".join(rows) + "\n"
    raw = content.encode("windows-1251")
    assert len(raw) > 100
    result = normalize_text_encoding(raw, "csv")
    assert result.decode("utf-8") == content
