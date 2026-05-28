# Kế Hoạch: Nâng Cấp Agent Flow — Đảm Bảo "Gợi Ý Nào Cũng Vẽ Được"

> **Tác giả:** Bui Van Thanh
> **Ngày tạo:** 2026-05-28
> **Trạng thái:** Đề xuất (chưa triển khai)
> **Phụ thuộc:** [KEHOACH_SMART_CHAT_AGENT.md](KEHOACH_SMART_CHAT_AGENT.md), [KEHOACH_DATA_SAMPLE_CONTEXT.md](KEHOACH_DATA_SAMPLE_CONTEXT.md)
> **Mục tiêu:** Vá các điểm trượt còn lại trong luồng `prompt → suggestion → draw` để đạt đủ tiêu chí:
> 1. Agent hiểu data + hiểu prompt
> 2. Đối chiếu data với template
> 3. Vẽ được luôn nếu đủ ngữ cảnh
> 4. Nếu chưa đủ thì gợi ý — và mọi gợi ý **PHẢI** vẽ được

---

## 1. Bối Cảnh

Trace code thực tế (xem báo cáo đánh giá 2026-05-28) cho thấy luồng hiện tại đã đạt **~80%** mục tiêu. Phần còn lại bị trượt do:

- **Hai nguồn FieldMeta khác nhau** (`pandas-path` trong `agent_routes.py` vs `DuckDB-path` trong `field_metadata.py`) → catalog do smart_chat sinh có thể không khớp với metadata mà SQLDataRecAgent validate → "gợi ý một đằng, vẽ một nẻo" trong edge cases.
- **Chart type regex bị duplicate ở 3 chỗ** (`agent_smart_chat.py`, `agent_sql_data_rec.py`, `agent_routes.py`) → thêm chart mới phải sửa 3 file, dễ inconsistency.
- **Registry backend (23 templates)** không đồng bộ với frontend `ChartTemplates.tsx` (30+ types) → LLM gen chart "pareto/radar/sankey" sẽ fail R8/R2.
- **SmartChatAgent không validate `chart_type_hint` LLM trả** → có thể trả chart không tồn tại trong registry, tốn 1 LLM call trước khi fail ở SQLDataRecAgent.
- **`_enrich_suggestions_with_agent` gọi LLM lần 2** rewrite rationale nhưng không re-validate encoding → có rủi ro LLM bịa.
- **Fast Path bypass smart_chat** không yêu cầu `chart_encodings` → khi rỗng, SQLDataRec đi mode "recommendation" → LLM tự gen, có thể không match chart_type user chọn.

Kế hoạch này phân thành **3 tier ưu tiên**, có thể triển khai song song theo nhóm.

---

## 2. Phạm Vi

### Files dự kiến thay đổi

| File | Loại | Mô tả |
|---|---|---|
| `py-src/data_formulator/agents/field_metadata.py` | Sửa | Thêm `compute_from_dataframe()` — unified API |
| `py-src/data_formulator/agent_routes.py` | Sửa | Xóa `_build_field_metas_from_input_tables`, dùng API mới |
| `py-src/data_formulator/agents/chart_type_resolver.py` | **MỚI** | Centralized chart type detection + validation |
| `py-src/data_formulator/agents/agent_smart_chat.py` | Sửa | Dùng resolver mới + validate chart_type_hint |
| `py-src/data_formulator/agents/agent_sql_data_rec.py` | Sửa | Xóa regex list 50 dòng, gọi resolver |
| `py-src/data_formulator/agents/chart_template_registry.py` | Sửa | Audit + thêm/đánh dấu chart types thiếu |
| `py-src/data_formulator/agents/chart_compatibility.py` | Sửa | Thêm ChartSpec cho các chart bổ sung |
| `py-src/data_formulator/tests/test_unified_field_metadata.py` | **MỚI** | Test đồng bộ giữa 2 path cũ |
| `py-src/data_formulator/tests/test_chart_type_resolver.py` | **MỚI** | Test resolver |
| `src/components/ChartTemplates.tsx` | Audit | Đối chiếu danh sách với backend |
| `src/components/ChartAssistantModal.tsx` | Sửa | Thêm badge QC_SUGGEST + tooltip "Why this chart?" |

---

## 3. Ưu Tiên Triển Khai

### TIER 1 — Sửa gốc rễ "gợi ý một đằng, vẽ một nẻo"

- **T1.1** Unified FieldMeta API (D.1)
- **T1.2** Centralized chart type resolver (D.2, C.4)
- **T1.3** Audit & sync template registry FE ↔ BE (D.10, C.8)

→ Sau Tier 1: tỉ lệ "click suggestion → vẽ thành công" tiệm cận 100%.

### TIER 2 — Vá lỗ hổng validate & UX

- **T2.1** SmartChatAgent validate `chart_type_hint` LLM trả (C.2)
- **T2.2** Encoding pre-validation sau enrichment (D.3, C.5)
- **T2.3** Fast Path require `chart_encodings` hoặc force hint (C.6)
- **T2.4** Tighten `_is_prompt_explicit_fields` (C.3)
- **T2.5** Feasibility hint trong catalog summary (D.4)
- **T2.6** Thêm badge QC_SUGGEST + "Why this chart?" tooltip (C.11, D.6)

### TIER 3 — Performance & observability

- **T3.1** Cache catalog/field_metas per session (D.8, C.10)
- **T3.2** Telemetry feedback loop bổ sung (D.7)
- **T3.3** Multi-turn context cho SmartChatAgent (D.5)
- **T3.4** Unify ngôn ngữ message_vi vs message_text (D.9, C.9)
- **T3.5** "Show me onboarding again" button (C.12)

---

## 4. Chi Tiết Từng Nhiệm Vụ

---

### TIER 1

#### T1.1 — Unified FieldMeta API

**Vấn đề hiện tại:**

| Path | Vị trí | Logic |
|---|---|---|
| Pandas | `agent_routes.py:242 _build_field_metas_from_input_tables` | `pd.api.types.is_*`, không có `looks_like_id` (luôn False), regex `_ID_NAME_PATTERN` không được dùng |
| DuckDB | `field_metadata.py:176 compute_field_metadata` | `DESCRIBE` + query gộp, có đầy đủ `looks_like_id`, dùng `MIN_DISTINCT_FOR_QUANTITATIVE = 10` |

Cùng một bảng có thể ra FieldMeta khác nhau giữa 2 path → catalog sinh từ pandas-path có thể chứa entry mà DuckDB-path sẽ reject.

**Giải pháp:**

Thêm vào `field_metadata.py`:

```python
def compute_from_dataframe(df: "pd.DataFrame") -> Dict[str, FieldMeta]:
    """Compute FieldMeta from a pandas DataFrame.

    Mirrors compute_field_metadata() (DuckDB path) but works on in-memory
    DataFrames so callers without DuckDB (smart_chat endpoint) get the same
    semantics. Used by agent_routes._build_field_metas_from_input_tables.

    The two functions MUST stay logically equivalent. test_unified_field_metadata
    verifies parity on a shared fixture.
    """
    import pandas as pd
    row_count = len(df.index)
    metas: Dict[str, FieldMeta] = {}
    if row_count == 0:
        return metas
    for col in df.columns:
        series = df[col]
        metas[col] = _compute_one_from_series(col, series, row_count)
    return metas


def _compute_one_from_series(col_name: str, series, row_count: int) -> FieldMeta:
    # Centralize all detection logic that today lives in two places.
    # Mirror _compute_one() in DuckDB path:
    # - cardinality, null_ratio, cardinality_class
    # - is_temporal, is_sequential, is_quantitative, is_categorical
    # - qc_role, looks_like_id (use _looks_like_id_name(col_name))
    # - stddev, min_value, max_value, sample_values
    ...
```

Rồi sửa `agent_routes.py`:

```python
def _build_field_metas_from_input_tables(input_tables) -> dict:
    """Backward-compat wrapper. Delegates to compute_from_dataframe()."""
    from data_formulator.agents.field_metadata import compute_from_dataframe
    metas = {}
    for table in input_tables:
        rows = table.get("rows", [])
        df = pd.DataFrame.from_records(rows)
        table_metas = compute_from_dataframe(df)
        for col_name, meta in table_metas.items():
            metas.setdefault(col_name, meta)
    return metas
```

**Test:**

```python
# test_unified_field_metadata.py
def test_pandas_and_duckdb_paths_agree(tmp_duckdb):
    # Fixture: same data loaded both ways
    rows = [...]
    df = pd.DataFrame(rows)
    pandas_metas = compute_from_dataframe(df)

    tmp_duckdb.execute("CREATE TABLE t AS SELECT * FROM df")
    duckdb_metas = compute_field_metadata(tmp_duckdb, "t")

    for col in pandas_metas:
        a, b = pandas_metas[col], duckdb_metas[col]
        assert a.cardinality_class == b.cardinality_class
        assert a.is_temporal == b.is_temporal
        assert a.is_sequential == b.is_sequential
        assert a.is_quantitative == b.is_quantitative
        assert a.is_categorical == b.is_categorical
        assert a.qc_role == b.qc_role
        assert a.looks_like_id == b.looks_like_id
```

**Ước tính:** ~2.5h (1h code, 1h tests, 0.5h fix các sai khác biệt phát hiện ra)

---

#### T1.2 — Centralized chart type resolver

**Vấn đề hiện tại:**

Có **3 nơi** detect chart type từ text:

| Nơi | Loại detection |
|---|---|
| `agent_smart_chat.py:160 _extract_chart_hint` | Exact match + alias dict (32 entries) + difflib fuzzy |
| `agent_sql_data_rec.py:812 chart_patterns` | 50 regex pattern |
| `agent_routes.py:445 _normalize_chart_type_hint` | Display name → internal map (21 entries) |

Trong đó **24 chart types** có ở 1 trong 3 nơi nhưng **không có trong `CHART_TEMPLATE_REGISTRY`** (Pareto, Gauge, Funnel, Treemap, Sankey, Radar, Timeline, Pyramid Chart, Donut, Sunburst, Network, Violin, Bubble, Rect Tree...). LLM gen các chart này → reject R8.

**Giải pháp:**

Tạo `py-src/data_formulator/agents/chart_type_resolver.py`:

```python
"""
Single source of truth for chart type detection and validation.

Replaces:
- agent_smart_chat.py::_extract_chart_hint
- agent_smart_chat.py::_normalize_chart_hint_name
- agent_sql_data_rec.py::chart_patterns (50 regex)
- agent_routes.py::_normalize_chart_type_hint
"""

from __future__ import annotations
import re
import difflib
import unicodedata
from typing import Dict, List, Optional

from data_formulator.agents.chart_template_registry import CHART_TEMPLATE_REGISTRY


# ─── Bảng tra duy nhất ────────────────────────────────────────────────────

# Alias text (lowercase) → Template display name
_ALIAS_TO_DISPLAY: Dict[str, str] = {
    "bar": "Bar Chart",
    "bar chart": "Bar Chart",
    "line": "Line Chart",
    "line chart": "Line Chart",
    "lin": "Line Chart",
    "scatter": "Scatter Plot",
    "scatter plot": "Scatter Plot",
    "point": "Scatter Plot",
    "histogram": "Histogram",
    "hist": "Histogram",
    "pie": "Pie Chart",
    "pie chart": "Pie Chart",
    "area": "Area Chart",
    "area chart": "Area Chart",
    "heatmap": "Heat Map",
    "heat map": "Heat Map",
    "heat": "Heat Map",
    "boxplot": "Boxplot",
    "box": "Boxplot",
    "waterfall": "Waterfall",
    "rolling average": "Rolling Average",
    "rolling": "Rolling Average",
    "linear regression": "Linear Regression",
    "regression": "Linear Regression",
    "loess regression": "Loess Regression",
    "loess": "Loess Regression",
    "radial plot": "Radial Plot",
    "radial": "Radial Plot",
    "bubble plot": "Bubble Plot",
    "bubble": "Bubble Plot",
    "pyramid chart": "Pyramid Chart",
    "threshold bar chart": "Threshold Bar Chart",
    "threshold": "Threshold Bar Chart",
    "grouped bar chart": "Grouped Bar Chart",
    "group bar": "Grouped Bar Chart",
    "stacked bar chart": "Stacked Bar Chart",
    "stacked bar": "Stacked Bar Chart",
    "ranged dot plot": "Ranged Dot Plot",
    "dot plot": "Ranged Dot Plot",
    "dotted line chart": "Dotted Line Chart",
    "qc trend line": "QC Trend Line",
    "qc histogram": "QC Histogram",
    "qc trend bar": "QC Trend Bar",
    "qc chart": "QC Trend Line",  # default QC chart
    # Tiếng Việt
    "biểu đồ cột": "Bar Chart",
    "biểu đồ đường": "Line Chart",
    "biểu đồ tròn": "Pie Chart",
}

# Display name → internal chart type used by SQLDataRecAgent
_DISPLAY_TO_INTERNAL: Dict[str, str] = {
    "Scatter Plot": "point",
    "Linear Regression": "linear_regression",
    "Loess Regression": "loess",
    "Ranged Dot Plot": "ranged_dot_plot",
    "Boxplot": "boxplot",
    "Bar Chart": "bar",
    "Pyramid Chart": "bar",  # alias
    "Grouped Bar Chart": "group_bar",
    "Stacked Bar Chart": "group_bar",
    "Histogram": "histogram",
    "Threshold Bar Chart": "threshold",
    "Line Chart": "line",
    "Dotted Line Chart": "line",
    "Rolling Average": "rolling_average",
    "Heat Map": "heatmap",
    "Pie Chart": "pie",
    "Radial Plot": "radial_plot",
    "Bubble Plot": "bubble",
    "Area Chart": "area",
    "Waterfall": "waterfall",
    "QC Trend Line": "qc_trend_line",
    "QC Trend Bar": "qc_trend_bar",
    "QC Histogram": "qc_histogram",
}

_INTERNAL_TO_DISPLAY = {v: k for k, v in _DISPLAY_TO_INTERNAL.items()}


def _normalize_text(text: str) -> str:
    t = (text or "").lower().strip()
    t = unicodedata.normalize("NFD", t)
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
    return t


def detect_chart_type(prompt: str) -> str:
    """Detect chart type from user prompt.

    Returns display name (e.g. "Bar Chart") that exists in CHART_TEMPLATE_REGISTRY,
    or empty string if nothing matches.

    Process:
      1. n-gram match against alias map (1-3 grams)
      2. fuzzy match against template names (difflib, cutoff 0.65)
      3. validate result is in CHART_TEMPLATE_REGISTRY
    """
    if not prompt:
        return ""
    text = _normalize_text(prompt)
    tokens = [t for t in re.split(r"[^a-z0-9_]+", text) if t]

    # n-gram alias match (3 → 1 grams; longer = more specific)
    for n in (3, 2, 1):
        if len(tokens) < n:
            continue
        for i in range(len(tokens) - n + 1):
            key = " ".join(tokens[i : i + n])
            if key in _ALIAS_TO_DISPLAY:
                candidate = _ALIAS_TO_DISPLAY[key]
                if candidate in CHART_TEMPLATE_REGISTRY:
                    return candidate

    # Fuzzy fallback
    names = list(CHART_TEMPLATE_REGISTRY.keys())
    normalized_names = {_normalize_text(n): n for n in names}
    close = difflib.get_close_matches(text, normalized_names.keys(), n=1, cutoff=0.65)
    if close:
        return normalized_names[close[0]]
    return ""


def to_internal(display_name: str) -> str:
    """Convert display name → internal chart type (or pass-through)."""
    if not display_name:
        return ""
    return _DISPLAY_TO_INTERNAL.get(display_name, display_name)


def to_display(internal_name: str) -> str:
    """Convert internal name → display name (or pass-through)."""
    if not internal_name:
        return ""
    return _INTERNAL_TO_DISPLAY.get(internal_name, internal_name)


def is_valid_chart_type(chart_type: str) -> bool:
    """Check if chart_type (display OR internal) is in the supported registry."""
    if not chart_type:
        return False
    if chart_type in CHART_TEMPLATE_REGISTRY:
        return True
    display = to_display(chart_type)
    return display in CHART_TEMPLATE_REGISTRY
```

**Migration:**

- `agent_smart_chat.py:_extract_chart_hint` → `from chart_type_resolver import detect_chart_type`
- `agent_smart_chat.py:_normalize_chart_hint_name` → `to_display`
- `agent_routes.py:_normalize_chart_type_hint` → `to_internal`
- `agent_sql_data_rec.py:812 chart_patterns` → xóa toàn bộ block 50 dòng, dùng `detect_chart_type` thay thế

**Test:**

```python
# test_chart_type_resolver.py
@pytest.mark.parametrize("prompt,expected", [
    ("Vẽ bar chart", "Bar Chart"),
    ("draw a scatter plot", "Scatter Plot"),
    ("lin", "Line Chart"),
    ("biểu đồ cột doanh thu", "Bar Chart"),
    ("QC Trend Line VALUE theo QCSHIFT", "QC Trend Line"),
    ("hôm nay trời thế nào", ""),
    ("vẽ pareto chart", ""),  # KHÔNG có trong registry
])
def test_detect_chart_type(prompt, expected):
    assert detect_chart_type(prompt) == expected
```

**Ước tính:** ~3h (1.5h code resolver, 1h migration 3 file, 0.5h tests)

---

#### T1.3 — Audit & sync template registry FE ↔ BE

**Vấn đề hiện tại:**

- Backend `CHART_TEMPLATE_REGISTRY` có **23 templates** (trừ Auto/Table).
- Frontend `ChartTemplates.tsx` có **30+** (theo TONG_QUAN_DU_AN.md).
- LLM regex trong SQLDataRecAgent detect được nhưng registry không có: Pareto, Gauge, Funnel, Treemap, Sankey, Radar, Timeline, Sunburst, Network, Violin, Rect Tree, Donut.

**Giải pháp 2 bước:**

**Bước A — Audit:**

Chạy script một lần đầu để liệt kê chart types:
```bash
# Đếm chart types ở FE
grep -E "chart: ['\"]" src/components/ChartTemplates.tsx | sort -u

# Liệt kê chart types ở BE registry
python -c "from data_formulator.agents.chart_template_registry import CHART_TEMPLATE_REGISTRY; \
           print('\n'.join(sorted(CHART_TEMPLATE_REGISTRY)))"
```

Tạo bảng đối chiếu trong PR description.

**Bước B — Đồng bộ:**

Với mỗi chart **chỉ có ở FE**, quyết định 1 trong 2:

**Option 1 — Hỗ trợ đầy đủ:** Thêm vào `CHART_TEMPLATE_REGISTRY` + `CHART_REQUIREMENTS` + `COMPAT_CHART_TYPE_MAP` (drawable_catalog.py) + `_DISPLAY_TO_INTERNAL` (resolver).

Ví dụ Pareto Chart:
```python
# chart_template_registry.py
"Pareto Chart": ChartTemplateSpec(
    "Pareto Chart", ["x", "y", "cumulative"], ["x", "y"], "generic"
),

# chart_compatibility.py CHART_REQUIREMENTS
"pareto": ChartSpec(
    domain=["qc", "generic"],
    channels={
        "x": ChannelSpec(required=True, accept_roles=_CATEGORICAL_X_ACCEPT,
                         reject_roles=_CATEGORICAL_X_REJECT, max_distinct=30),
        "y": ChannelSpec(required=True, accept_roles=_QUANTITATIVE_Y_ACCEPT,
                         reject_roles=_QUANTITATIVE_Y_REJECT),
    },
),

# drawable_catalog.py
COMPAT_CHART_TYPE_MAP = {
    ...,
    "Pareto Chart": "pareto",
}
```

**Option 2 — Tạm gỡ:** Comment ra khỏi `ChartTemplates.tsx` + xóa khỏi alias map resolver. Ghi nhận trong CHANGELOG.

**Khuyến nghị tier:** Donut, Pareto, Funnel, Pyramid, Treemap nên hỗ trợ (Option 1) — chúng phổ biến. Radar, Gauge, Sunburst, Network, Sankey, Timeline có thể tạm gỡ (Option 2) — ít dùng + khó validate.

**Test:**

```python
def test_all_frontend_charts_have_backend_template():
    """Đảm bảo mọi chart frontend export đều có template backend."""
    fe_charts = _parse_frontend_chart_templates()  # đọc ChartTemplates.tsx
    for chart in fe_charts:
        assert chart in CHART_TEMPLATE_REGISTRY, \
            f"Frontend chart '{chart}' không có ChartTemplateSpec backend"
```

**Ước tính:** ~3h (1h audit, 1.5h thêm spec cho Option 1 charts, 0.5h tests)

---

### TIER 2

#### T2.1 — SmartChatAgent validate `chart_type_hint`

**File:** `agent_smart_chat.py`

**Thay:**
```python
inferred_hint = _extract_chart_hint(prompt, drawable_catalog)
llm_hint = str(parsed.get("chart_type_hint", "")).strip()
final_hint = _normalize_chart_hint_name(llm_hint or inferred_hint)
```

**Bằng:**
```python
from data_formulator.agents.chart_type_resolver import detect_chart_type, is_valid_chart_type, to_display

inferred_hint = detect_chart_type(prompt)
llm_hint_raw = str(parsed.get("chart_type_hint", "")).strip()
llm_hint = to_display(llm_hint_raw) if llm_hint_raw else ""

# Validate LLM hint — nếu LLM bịa, fall back sang detected hint
if llm_hint and not is_valid_chart_type(llm_hint):
    logger.warning(f"SmartChatAgent: LLM returned invalid chart_type_hint '{llm_hint_raw}', ignoring")
    llm_hint = ""

final_hint = llm_hint or inferred_hint
```

**Test:**

```python
def test_invalid_llm_chart_hint_falls_back_to_detected():
    mock = MockClient({"action": "draw", "chart_type_hint": "Pareto Chart", ...})
    result = agent.run("vẽ bar chart VALUE theo QCSHIFT", QC_COLUMNS, "qc", catalog)
    assert result.chart_type_hint == "Bar Chart"  # detected từ prompt, không phải Pareto LLM bịa
```

**Ước tính:** ~30min

---

#### T2.2 — Encoding pre-validation sau enrichment

**File:** `agent_routes.py:_enrich_suggestions_with_agent` + `_fallback_suggestions_from_fields`

Hiện tại `_enrich_suggestions_with_agent` chỉ copy `rationale_vi` và `sample_prompt_vi` (đã đúng), nhưng `_fallback_suggestions_from_fields` (line 820) **không qua `validate_chart()`**. Nó pick fields by role naive và build encoding thẳng → có thể fail khi vẽ.

**Sửa `_fallback_suggestions_from_fields`:**

```python
from data_formulator.agents.chart_compatibility import validate_chart
from data_formulator.agents.drawable_catalog import COMPAT_CHART_TYPE_MAP

def _fallback_suggestions_from_fields(field_metas, chart_type_hint, domain, top_k=4):
    ...
    suggestions = []
    def add(chart_type, encoding, rationale, prompt):
        if not encoding:
            return
        # NEW: validate before adding
        compat_type = COMPAT_CHART_TYPE_MAP.get(chart_type, chart_type.lower())
        result = validate_chart(compat_type, encoding, field_metas, domain)
        if not result.is_valid:
            logger.debug(f"Fallback suggestion {chart_type} rejected: {result.reject.short}")
            return
        suggestions.append({...})
    ...
```

**Test:**

```python
def test_fallback_suggestions_are_all_drawable(qc_field_metas):
    suggestions = _fallback_suggestions_from_fields(qc_field_metas, "bar", "qc", top_k=6)
    for s in suggestions:
        compat = COMPAT_CHART_TYPE_MAP.get(s["chart_type"], s["chart_type"].lower())
        v = validate_chart(compat, s["encoding"], qc_field_metas, "qc")
        assert v.is_valid, f"Suggestion {s['chart_type']} not drawable: {v.reject}"
```

**Ước tính:** ~1h

---

#### T2.3 — Fast Path require `chart_encodings`

**File:** `agent_routes.py:smart_chat:1166`

**Sửa:**

```python
selected_chart_type = str(content.get("user_preferred_chart_type", "")).strip()
selected_encodings = content.get("chart_encodings") or {}

if selected_chart_type:
    if not selected_encodings:
        # Force SQLDataRecAgent to use the selected chart type and infer encodings.
        # Add a synthetic instruction so LLM knows user picked this type explicitly.
        logger.info(f"Fast path: chart_type '{selected_chart_type}' selected, encodings empty — agent will infer")
    payload, status_code = _run_derive_data_core(content)
    ...
```

**Ước tính:** ~30min

---

#### T2.4 — Tighten `_is_prompt_explicit_fields`

**File:** `agent_routes.py:607`

**Vấn đề:** `if hit_count >= 1: return True` → quá lỏng, cột tên ngắn (`id`, `no`) trùng từ thông thường.

**Sửa:**

```python
_FIELD_CONTEXT_PATTERNS = [
    r"\bby\s+{col}\b",
    r"\bof\s+{col}\b",
    r"\bvs\.?\s+{col}\b",
    r"\bagainst\s+{col}\b",
    r"\btheo\s+{col}\b",       # tiếng Việt
    r"\bcủa\s+{col}\b",
    r"\b{col}\s*=\s*",          # x=col
    r"\bx\s*[:=]\s*{col}\b",
    r"\by\s*[:=]\s*{col}\b",
]

def _is_prompt_explicit_fields(prompt: str, columns: list[str]) -> bool:
    text = (prompt or "").lower()
    if not text or not columns:
        return False
    for col in columns:
        c = (col or "").strip().lower()
        if len(c) < 2:
            continue
        col_escaped = re.escape(c)
        # Context-aware match: cột phải đứng sau preposition hoặc =
        for pat_tpl in _FIELD_CONTEXT_PATTERNS:
            if re.search(pat_tpl.format(col=col_escaped), text):
                return True
        # Hoặc 2+ cột match bằng word boundary (đủ để xác định)
    # Nếu không match context, fallback đếm word-boundary và yêu cầu >= 2
    hit_count = sum(
        1 for col in columns
        if len(col) >= 2 and re.search(rf"(?<![a-z0-9_]){re.escape(col.lower())}(?![a-z0-9_])", text)
    )
    return hit_count >= 2
```

**Test:**

```python
@pytest.mark.parametrize("prompt,cols,expected", [
    ("vẽ bar chart", ["VALUE", "QCSHIFT"], False),           # không nêu cột
    ("vẽ bar chart theo QCSHIFT", ["VALUE", "QCSHIFT"], True), # "theo QCSHIFT"
    ("VALUE by QCSHIFT", ["VALUE", "QCSHIFT"], True),         # 2 cột match
    ("show me id", ["id", "name"], False),                    # "id" thông thường, không context
    ("group by id", ["id", "name"], True),                    # "by id" context match
])
def test_is_prompt_explicit_fields(prompt, cols, expected):
    assert _is_prompt_explicit_fields(prompt, cols) == expected
```

**Ước tính:** ~1h

---

#### T2.5 — Feasibility hint trong catalog summary

**File:** `agent_smart_chat.py:_build_catalog_summary`

**Hiện tại:**
```
- Bar Chart (x=QCSHIFT, y=VALUE) [conf=1.00]
```

**Sau:**
```
- Bar Chart (x=QCSHIFT, y=VALUE) [conf=1.00] — QCSHIFT has 3 values (CA1, CA2, CA3); VALUE range [0.5, 2.1]
```

**Sửa:**

```python
def _build_catalog_summary(catalog, field_metas=None, max_items=15):
    if not catalog:
        return "(No drawable chart template found for current data.)"
    lines = []
    for entry in catalog[:max_items]:
        enc = ", ".join(f"{k}={v}" for k, v in entry.encoding.items())
        line = f"- {entry.chart_type} ({enc}) [conf={entry.confidence:.2f}]"
        if field_metas:
            hints = _channel_field_hints(entry.encoding, field_metas)
            if hints:
                line += " — " + "; ".join(hints)
        elif entry.rationale_vi:
            line += f" — {entry.rationale_vi}"
        lines.append(line)
    return "\n".join(lines)


def _channel_field_hints(encoding, field_metas):
    """Tạo hint ngắn cho mỗi field trong encoding."""
    hints = []
    for ch, col in encoding.items():
        m = field_metas.get(col)
        if not m:
            continue
        if m.is_categorical and m.sample_values:
            vals = ", ".join(str(v) for v in m.sample_values[:3])
            suffix = "..." if len(m.sample_values) > 3 else ""
            hints.append(f"{col} = [{vals}{suffix}]")
        elif m.is_quantitative and m.min_value is not None:
            hints.append(f"{col} range [{m.min_value:.1f}, {m.max_value:.1f}]")
        elif m.is_temporal:
            hints.append(f"{col} temporal")
    return hints
```

Và sửa caller trong `SmartChatAgent.run`:
```python
catalog_summary = _build_catalog_summary(drawable_catalog, field_metas=field_metas)
```

**Ước tính:** ~1h

---

#### T2.6 — UI Polish: badge QC_SUGGEST + tooltip "Why this chart?"

**File:** `src/components/ChartAssistantModal.tsx`

**Thêm:**

```tsx
// Header với badge QC_SUGGEST
<DialogTitle>
  {title}
  {mode === "QC_SUGGEST" && (
    <Chip label="QC Charts" color="warning" size="small" sx={{ ml: 1 }} />
  )}
</DialogTitle>
```

**File:** `src/components/SuggestionGrid.tsx` (assume tồn tại) hoặc `ChartThumbnail.tsx`

Thêm tooltip cho mỗi suggestion card:

```tsx
<Tooltip
  title={
    <Box>
      <Typography variant="caption">
        Drawable because:
      </Typography>
      {Object.entries(suggestion.encoding || {}).map(([ch, col]) => (
        <Typography key={ch} variant="caption" display="block">
          • {ch} ← {col}
        </Typography>
      ))}
      {suggestion.confidence && (
        <Typography variant="caption" color="text.secondary">
          Confidence: {(suggestion.confidence * 100).toFixed(0)}%
        </Typography>
      )}
    </Box>
  }
>
  <Card>...</Card>
</Tooltip>
```

**Ước tính:** ~1h

---

### TIER 3

#### T3.1 — Cache catalog/field_metas per session

**File:** `agent_routes.py`

```python
from functools import lru_cache
import hashlib
import json

def _table_signature(input_tables) -> str:
    """Hash key for catalog cache: column names + first 100 rows fingerprint."""
    sig_parts = []
    for table in input_tables:
        cols = list((table.get("rows") or [{}])[0].keys()) if table.get("rows") else []
        sig_parts.append(table.get("name", ""))
        sig_parts.append(",".join(cols))
        sig_parts.append(str(len(table.get("rows", []))))
    return hashlib.md5("|".join(sig_parts).encode()).hexdigest()


# Cache catalog per session per signature (TTL 60s via expiring dict)
_catalog_cache: Dict[str, Tuple[float, dict, list, list]] = {}
_CATALOG_TTL_SEC = 60


def _get_cached_catalog(session_id, signature):
    key = f"{session_id}:{signature}"
    cached = _catalog_cache.get(key)
    if cached:
        ts, field_metas, sample_rows, catalog = cached
        if time.time() - ts < _CATALOG_TTL_SEC:
            return field_metas, sample_rows, catalog
        del _catalog_cache[key]
    return None
```

Trong `smart_chat`:

```python
sig = _table_signature(input_tables)
cached = _get_cached_catalog(session.get('session_id'), sig)
if cached:
    field_metas, sample_rows, drawable_catalog = cached
else:
    field_metas = _build_field_metas_from_input_tables(input_tables)
    sample_rows = _extract_sample_rows(input_tables)
    drawable_catalog = build_drawable_catalog(field_metas, domain, top_k=None)
    _catalog_cache[f"{sid}:{sig}"] = (time.time(), field_metas, sample_rows, drawable_catalog)
```

**Ước tính:** ~1h

---

#### T3.2 — Telemetry feedback loop bổ sung

**Thêm 3 events:**

| Event | Khi nào fire | Payload |
|---|---|---|
| `draw_failed_after_suggestion_click` | Click suggestion → derive-data fail | `chart_type`, `reject_code`, `source_mode` |
| `chart_rendered_successfully` | Chart render xong trên FE | `chart_type`, `latency_ms`, `prompt_source` |
| `time_from_prompt_to_chart` | Smart-chat enter → chart hiển thị | `total_ms`, `breakdown` (classifier, derive, render) |

**File:** `src/views/ChartRecBox.tsx`

Hook vào nơi handle response sau derive-data + nơi Vega-Lite onRender callback.

**Ước tính:** ~1.5h

---

#### T3.3 — Multi-turn context cho SmartChatAgent

**File:** `agent_smart_chat.py`

Mở rộng `SmartChatResult` → cho phép FE truyền `previous_chart_state`:

```python
def run(self, prompt, columns, domain, drawable_catalog,
        field_metas=None, sample_rows=None,
        previous_chart_state=None):  # NEW
    ...
    if previous_chart_state:
        system_prompt += f"\n\n=== PREVIOUS CHART CONTEXT ===\n{json.dumps(previous_chart_state)}"
```

FE gửi kèm `previous_chart_state = {chart_type, encoding, last_instruction}` khi user trong cùng table thread.

**Ước tính:** ~2h

---

#### T3.4 — Unify ngôn ngữ message_vi vs message_text

**Quyết định kỹ thuật:** Đổi `message_vi` → `message_text` ở:
- Backend response payloads (`agent_routes.py`)
- Frontend state vars (`assistantMessage`)
- Loại bỏ khỏi system prompt rằng "natural language in English" — để LLM tự match ngôn ngữ user.

Rule mới trong system prompt:
```
8) message_text: natural language matching user's prompt language. 1-3 sentences.
```

**Migration:** 1 commit đổi tên field + bumb response schema version, FE đọc cả 2 trong 1-2 release.

**Ước tính:** ~1h (đổi tên không phá vỡ logic)

---

#### T3.5 — "Show me onboarding again" button

**File:** `src/views/ChartRecBox.tsx`

Trong toolbar (cạnh nút Get some idea), thêm:

```tsx
<IconButton
  size="small"
  onClick={() => {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    setOnboardingOpen(true);
  }}
  title="Show onboarding tips"
>
  <HelpOutlineIcon fontSize="small" />
</IconButton>
```

**Ước tính:** ~15min

---

## 5. Test Strategy Tổng Hợp

### 5.1 Test mới cần thêm

| File | Số test cases | Mục đích |
|---|---|---|
| `test_unified_field_metadata.py` | ~10 | Parity giữa pandas-path và DuckDB-path |
| `test_chart_type_resolver.py` | ~25 | Detection + alias + fuzzy + validation |
| `test_template_registry_sync.py` | ~3 | FE templates ⊆ BE registry |
| `test_fallback_suggestions_drawable.py` | ~6 | Mọi fallback suggestion đều validate pass |
| `test_explicit_fields_detection.py` | ~10 | Tight detection không false positive |
| `test_smart_chat_invalid_hint.py` | ~5 | LLM trả hint không hợp lệ → fallback đúng |

### 5.2 E2E manual journeys bổ sung

| ID | Test case | Expected |
|---|---|---|
| E1 | QC data → "vẽ pareto chart" | Modal info, không cố gen Pareto (trừ khi đã thêm spec) |
| E2 | Sales data → "vẽ chart theo product" | Confirm modal vì 1 cột match nhưng không có context "by"; agent gợi ý Bar/Pie với product=x |
| E3 | Click QC Trend Line gợi ý → vẽ ngay không bouncing | Pass Fast Path |
| E4 | Click suggestion với encoding rỗng → vẽ ngay với encoding tự suy luận | Pass T2.3 |
| E5 | LLM trả `chart_type_hint = "Sankey"` (không có spec) → result.chart_type_hint = fallback từ regex hoặc rỗng | Pass T2.1 |

---

## 6. Roadmap & Commit Plan

### Tuần 1 — Tier 1 (foundational fixes)

```
Day 1-2: T1.1 Unified FieldMeta
  ├── feat(field-meta): add compute_from_dataframe() unified API
  ├── refactor(routes): delegate _build_field_metas to compute_from_dataframe
  └── test(field-meta): pandas/duckdb parity tests

Day 3-4: T1.2 Chart type resolver
  ├── feat(agents): add chart_type_resolver as single source of truth
  ├── refactor(smart-chat): use resolver instead of local regex
  ├── refactor(data-rec): remove 50-line chart_patterns block
  ├── refactor(routes): use to_internal/to_display from resolver
  └── test(resolver): detection + alias + fuzzy + validation

Day 5: T1.3 Template registry audit
  ├── chore: audit FE vs BE chart types (PR description has table)
  ├── feat(template): add Pareto/Donut/Funnel/Pyramid/Treemap specs
  ├── chore(fe): remove Radar/Gauge/Sunburst from ChartTemplates.tsx
  └── test(registry): FE templates subset of BE
```

### Tuần 2 — Tier 2 (validate & UX)

```
Day 1: T2.1 Validate LLM chart_type_hint
  └── fix(smart-chat): drop invalid hints, fall back to detected

Day 1-2: T2.2 + T2.3 Validation hardening
  ├── fix(fallback): validate fallback suggestions before serving
  └── fix(fast-path): guard chart_encodings, allow infer if empty

Day 3: T2.4 Tighten explicit field detection
  └── fix(routes): context-aware field matching

Day 4: T2.5 Feasibility hints in catalog summary
  └── feat(smart-chat): inject field hints into catalog summary

Day 5: T2.6 UI polish
  ├── feat(ui): QC_SUGGEST badge + accent color
  └── feat(ui): "Why this chart?" tooltip on suggestion cards
```

### Tuần 3 — Tier 3 (perf & observability)

```
Day 1: T3.1 Catalog cache
  └── perf(routes): TTL cache for catalog/field_metas per session

Day 2: T3.2 Telemetry events
  └── feat(telemetry): add draw_failed/render_success/timing events

Day 3-4: T3.3 Multi-turn context
  └── feat(smart-chat): accept previous_chart_state for thread continuity

Day 5: T3.4 + T3.5 Cleanup
  ├── chore(api): rename message_vi → message_text (schema v2)
  └── feat(ui): "Show onboarding again" button
```

**Tổng ước tính:** ~18 ngày làm việc (~3 tuần) cho 1 dev. Có thể chạy song song T2.5 + T2.6 + T3.5 (FE-only) với các task BE.

---

## 7. Acceptance Criteria

Plan này được coi là DONE khi:

- ✅ **A1:** Không còn 2 đường tính FieldMeta. Tất cả callers gọi `field_metadata.compute_from_dataframe()` hoặc `compute_field_metadata()` (DuckDB).
- ✅ **A2:** Chỉ còn **1 alias map duy nhất** cho chart type. Thêm chart mới = sửa 1 file.
- ✅ **A3:** `assert FE_chart_set ⊆ BE_chart_set` pass trong CI.
- ✅ **A4:** Mọi suggestion render trong modal đã pass `validate_chart()` — đo bằng metric `draw_failed_after_suggestion_click / suggestion_clicked < 1%`.
- ✅ **A5:** SmartChatAgent không bao giờ trả `chart_type_hint` không có trong registry — đo bằng log warn count = 0 sau 1 tuần prod.
- ✅ **A6:** Latency smart-chat ổn định (p95 < 3s) nhờ catalog cache — đo qua telemetry `time_from_prompt_to_chart`.
- ✅ **A7:** Test suite mở rộng từ 178 → ~240 cases, pass 100%.

---

## 8. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| T1.1 unified API gây regression cho QC data (logic phức tạp) | Medium | Parity test trên QC fixture; rollout sau test môi trường staging |
| T1.3 thêm Pareto/Donut spec nhưng ChannelSpec sai dẫn tới R6 oan | Medium | Test với data thật cho mỗi chart mới thêm |
| T2.4 tighten detection làm "draw" path khó trigger hơn → user phàn nàn | Low-Med | A/B telemetry: đếm draw vs confirm ratio trước/sau |
| T3.4 rename `message_vi` phá FE cũ | Low | FE đọc cả 2 trong 1 release, BE gửi cả 2 trong 1 release |
| T3.3 multi-turn context tăng token cost ~30% | Low | Cap previous_chart_state ≤ 500 tokens; bật flag tắt được |

---

## 9. Phụ Lục — Tham Chiếu File:Line

Tất cả lý do và file:line cụ thể đã có trong báo cáo đánh giá ngày 2026-05-28. Mục dưới đây liệt kê các điểm trượt chính để dev tra cứu nhanh khi triển khai:

| Mục | File:Line | Mô tả |
|---|---|---|
| C.1 | `agent_routes.py:242` vs `field_metadata.py:176` | 2 nguồn FieldMeta |
| C.2 | `agent_smart_chat.py:418-434` | Không validate LLM hint |
| C.3 | `agent_routes.py:607-621` | hit_count >= 1 quá lỏng |
| C.4 | `agent_sql_data_rec.py:812-869` | 50 regex pattern duplicate |
| C.5 | `agent_routes.py:746-817` | Enrichment không re-validate |
| C.6 | `agent_routes.py:1166-1179` | Fast Path không check encodings |
| C.8 | `chart_template_registry.py` vs `ChartTemplates.tsx` | FE > BE chart count |
| C.11 | `ChartAssistantModal.tsx:85` | Không có badge phân biệt mode |

---

**Sẵn sàng cho review.**
