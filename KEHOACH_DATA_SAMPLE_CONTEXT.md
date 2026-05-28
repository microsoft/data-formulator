# Kế Hoạch: Data Sample Context — Cho Agent Thực Sự "Đọc" Dữ Liệu

> **Tác giả:** Bui Van Thanh  
> **Ngày tạo:** 2026-05-26  
> **Trạng thái:** Đã hoàn thành (2026-05-28)  
> **Phụ thuộc:** [KEHOACH_SMART_CHAT_AGENT.md](KEHOACH_SMART_CHAT_AGENT.md) (đã hoàn thành)  
> **Mục tiêu:** Agent nhìn thấy vài dòng dữ liệu thực tế + giá trị cụ thể của từng cột → suy luận sâu hơn, gợi ý biểu đồ có ngữ nghĩa thay vì lặp đi lặp lại

---

## 1. Vấn Đề Hiện Tại

### 1.1 Agent chỉ thấy thống kê, không thấy nội dung

Với bảng dữ liệu bán hàng như sau:

| month   | product | region    | revenue | quantity |
|---------|---------|-----------|---------|----------|
| 2024-01 | iPhone  | Hà Nội    | 120000  | 45       |
| 2024-01 | Samsung | TP.HCM    | 98000   | 38       |
| 2024-02 | iPhone  | Đà Nẵng   | 135000  | 52       |

**Agent hiện tại chỉ thấy:**
```
- month [temporal] cards=6(low)
- product [categorical] cards=3(low) → ideal for grouping/color
- region [categorical] cards=3(low) → ideal for grouping/color
- revenue [quantitative] range=[98000, 135000] cards=24(high)
- quantity [quantitative] range=[38, 52] cards=8(low)
```

Agent **không biết** product là `iPhone/Samsung/Oppo` hay `A/B/C`. Không biết region là tỉnh thành hay mã số. Không biết revenue đang nói về tiền VND hay đơn vị khác.

**Kết quả:** Mọi dataset có cấu trúc tương tự đều nhận cùng gợi ý: `Bar Chart (x=product, y=revenue)`, `Line Chart (x=month, y=revenue)`. Lặp đi lặp lại, không phân biệt ngữ nghĩa.

### 1.2 So sánh với ChatGPT

| | ChatGPT | Agent hiện tại | Agent sau upgrade |
|---|---|---|---|
| Thấy tên cột | ✅ | ✅ | ✅ |
| Thấy kiểu dữ liệu | ✅ | ✅ | ✅ |
| Thấy giá trị trong cột | ✅ `"iPhone, Samsung, Oppo"` | ❌ | ✅ |
| Thấy dữ liệu thực tế | ✅ (vài dòng) | ❌ | ✅ (3-5 dòng) |
| Gợi ý có ngữ nghĩa | ✅ "So sánh iPhone vs Samsung" | ❌ chung chung | ✅ |
| Rationale cụ thể | ✅ | ❌ | ✅ |

---

## 2. Giải Pháp Đề Xuất

### 2.1 Nguyên tắc

Thêm **2 lớp context mới** vào prompt của SmartChatAgent:

1. **`sample_values`** — với mỗi cột categorical/temporal có cardinality thấp: toàn bộ giá trị unique (≤ 12 giá trị)
2. **`sample_rows`** — 3 dòng dữ liệu đại diện từ bảng: 1 dòng đầu + 1 dòng giữa + 1 dòng cuối

**Budget token tối đa thêm:** ~300–500 tokens (không đáng kể so với context window của gpt-4o)

### 2.2 Ví dụ prompt sau upgrade

```
=== DATA SAMPLE (3 representative rows) ===
| month   | product | region  | revenue | quantity |
| 2024-01 | iPhone  | Hà Nội  | 120000  | 45       |
| 2024-03 | Samsung | Đà Nẵng | 112000  | 41       |
| 2024-06 | Oppo    | TP.HCM  | 89000   | 33       |

=== COLUMN PROFILES ===
- month [temporal] cards=6(low) values=[2024-01, 2024-02, 2024-03, 2024-04, 2024-05, 2024-06]
- product [categorical] cards=3(low) values=[iPhone, Samsung, Oppo] → ideal for grouping/color
- region [categorical] cards=3(low) values=[Hà Nội, TP.HCM, Đà Nẵng] → ideal for grouping/color
- revenue [quantitative] range=[89000, 135000] stddev≈15000
- quantity [quantitative] range=[33, 52]
```

**Agent LLM có thể suy luận:**
> "Đây là bảng so sánh doanh thu bán hàng điện thoại (iPhone/Samsung/Oppo) theo tháng và vùng. Gợi ý hợp lý nhất: Line Chart theo dõi doanh thu theo thời gian chia theo sản phẩm, Grouped Bar Chart so sánh doanh thu 3 hãng theo tháng, Scatter Plot tương quan revenue vs quantity."

---

## 3. Thiết Kế Kỹ Thuật

### 3.1 Thay đổi `FieldMeta` dataclass

**File:** `py-src/data_formulator/agents/field_metadata.py`

```python
@dataclass
class FieldMeta:
    # --- existing fields (không đổi) ---
    name: str
    sql_type: str
    cardinality: int
    null_ratio: float
    cardinality_class: str
    is_temporal: bool
    is_sequential: bool
    is_quantitative: bool
    is_categorical: bool
    qc_role: Optional[str] = None
    looks_like_id: bool = False
    row_count: int = 0
    stddev: Optional[float] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None

    # --- MỚI: sample values cho categorical/temporal (low cardinality) ---
    sample_values: List[Any] = field(default_factory=list)
    # Chỉ populate khi cardinality_class in ("low", "mid") và is_categorical or is_temporal.
    # Giới hạn MAX_SAMPLE_VALUES = 12 giá trị.
    # Với categorical: toàn bộ unique values (đã sort).
    # Với temporal: 3 giá trị đại diện (min, median, max) dưới dạng string.
```

> **Backward compat:** `sample_values` có default `[]` → không break code cũ.  
> `compute_field_metadata()` trong DuckDB path cũng sẽ được cập nhật tương tự.

---

### 3.2 Thay đổi `_build_field_metas_from_input_tables`

**File:** `py-src/data_formulator/agent_routes.py` — hàm `_build_field_metas_from_input_tables`

**Thêm logic populate `sample_values`:**

```python
MAX_SAMPLE_VALUES = 12  # Tối đa 12 giá trị unique cho categorical

def _build_field_metas_from_input_tables(input_tables) -> dict:
    metas = {}
    for table in input_tables:
        rows = table.get("rows", [])
        df = pd.DataFrame.from_records(rows)
        row_count = len(df.index)
        if row_count == 0:
            continue
        for col in df.columns:
            if col in metas:
                continue
            series = df[col]
            # ... existing logic ... (không đổi)

            # --- MỚI: populate sample_values ---
            sample_values = []
            if cardinality_class in ("low", "mid") and cardinality <= MAX_SAMPLE_VALUES:
                # Categorical: lấy toàn bộ unique values đã sort
                raw_vals = sorted(series.dropna().unique().tolist(),
                                  key=lambda v: str(v))
                sample_values = [_safe_serialize(v) for v in raw_vals[:MAX_SAMPLE_VALUES]]
            elif is_temporal:
                # Temporal: 3 giá trị đại diện (min, median dạng string, max)
                sorted_vals = sorted(series.dropna().unique().tolist(), key=str)
                if len(sorted_vals) >= 3:
                    mid_idx = len(sorted_vals) // 2
                    sample_values = [str(sorted_vals[0]),
                                     str(sorted_vals[mid_idx]),
                                     str(sorted_vals[-1])]
                else:
                    sample_values = [str(v) for v in sorted_vals]

            metas[col] = FieldMeta(
                # ... existing fields ...
                sample_values=sample_values,  # MỚI
            )
    return metas


def _safe_serialize(val) -> str:
    """Chuyển giá trị sang string an toàn, cắt ngắn nếu quá dài."""
    s = str(val)
    return s[:30] + "…" if len(s) > 30 else s
```

---

### 3.3 Trích xuất sample rows ở cấp bảng

**File:** `py-src/data_formulator/agent_routes.py` — hàm mới `_extract_sample_rows`

```python
MAX_SAMPLE_ROWS = 3   # 3 dòng đại diện: đầu + giữa + cuối
MAX_COLS_IN_SAMPLE = 8  # Tối đa 8 cột hiển thị (tránh quá dài)
MAX_CELL_LEN = 25       # Cắt ngắn giá trị ô quá dài


def _extract_sample_rows(input_tables: list) -> list[dict]:
    """Trả về list dòng dict đại diện từ bảng đầu tiên có dữ liệu.
    
    Chiến lược chọn dòng: đầu, giữa, cuối → đại diện toàn bộ range.
    Không cần random vì mục đích chỉ là cho LLM thấy cấu trúc + giá trị.
    """
    for table in input_tables:
        rows = table.get("rows", [])
        if not rows:
            continue
        n = len(rows)
        
        # Chọn dòng đại diện
        if n == 1:
            idxs = [0]
        elif n == 2:
            idxs = [0, 1]
        else:
            idxs = [0, n // 2, n - 1]
        
        # Lấy danh sách cột (giới hạn MAX_COLS)
        all_cols = list(rows[0].keys()) if rows else []
        # Ưu tiên các cột non-QC-control-limit trước
        qc_limit_cols = {"TARGET", "LL", "UL", "ARLL", "ARUL"}
        priority_cols = [c for c in all_cols if c.upper() not in qc_limit_cols]
        display_cols = (priority_cols + [c for c in all_cols if c not in priority_cols])[:MAX_COLS_IN_SAMPLE]
        
        sample = []
        for i in idxs:
            row = rows[i]
            sample.append({
                col: _truncate_cell(row.get(col, ""))
                for col in display_cols
            })
        return sample
    return []


def _truncate_cell(val) -> str:
    s = str(val) if val is not None else ""
    return s[:MAX_CELL_LEN] + "…" if len(s) > MAX_CELL_LEN else s
```

---

### 3.4 Cập nhật `_build_column_profile` trong `agent_smart_chat.py`

**File:** `py-src/data_formulator/agents/agent_smart_chat.py`

**Hiện tại** (chỉ có type + cardinality + range):
```python
def _build_column_profile(field_metas: Dict[str, Any]) -> str:
    ...
    # chỉ xuất: "- VALUE [quantitative] cards=200(high) range=[0.5,2.1]"
```

**Sau upgrade** (thêm sample_values):
```python
def _build_column_profile(field_metas: Dict[str, Any]) -> str:
    if not field_metas:
        return ""
    lines: List[str] = []
    for name, m in field_metas.items():
        # ... existing type_tag logic ...
        parts = [f"- {name} [{type_tag}]"]
        parts.append(f"cards={m.cardinality}({m.cardinality_class})")

        # Range cho numeric
        if m.is_quantitative and m.min_value is not None and m.max_value is not None:
            parts.append(f"range=[{m.min_value:.2f},{m.max_value:.2f}]")
            if m.stddev is not None:
                parts.append(f"stddev≈{m.stddev:.1f}")

        # QC role
        if m.qc_role:
            parts.append(f"qc_role={m.qc_role}")

        # MỚI: Sample values cho categorical và temporal
        sample_vals = getattr(m, "sample_values", [])
        if sample_vals and (m.is_categorical or m.is_temporal):
            vals_str = ", ".join(str(v) for v in sample_vals)
            parts.append(f"values=[{vals_str}]")

        # Gợi ý sử dụng
        if m.is_categorical and m.cardinality_class == "low":
            parts.append("→ ideal for grouping/color")
        elif m.is_categorical and m.cardinality_class == "mid":
            parts.append("→ usable for grouping")
        elif getattr(m, "looks_like_id", False):
            parts.append("⚠ id-like, avoid as axis")

        lines.append(" ".join(parts))
    return "\n".join(lines)
```

---

### 3.5 Thêm hàm `_build_data_sample_section`

**File:** `py-src/data_formulator/agents/agent_smart_chat.py`

```python
def _build_data_sample_section(sample_rows: list[dict]) -> str:
    """Format sample rows thành markdown table để LLM dễ đọc."""
    if not sample_rows:
        return ""
    cols = list(sample_rows[0].keys())
    
    # Header
    header = "| " + " | ".join(cols) + " |"
    separator = "| " + " | ".join(["---"] * len(cols)) + " |"
    
    # Rows
    rows_md = []
    for row in sample_rows:
        cells = [str(row.get(c, "")) for c in cols]
        rows_md.append("| " + " | ".join(cells) + " |")
    
    return "\n".join([header, separator] + rows_md)
```

---

### 3.6 Cập nhật `_build_system_prompt` — thêm section DATA SAMPLE

**File:** `py-src/data_formulator/agents/agent_smart_chat.py`

```python
def _build_system_prompt(
    columns: List[str],
    domain: str,
    catalog_summary: str,
    column_profile: str = "",
    data_sample_md: str = "",        # MỚI
) -> str:
    ...
    # Thêm section data sample nếu có
    data_sample_section = ""
    if data_sample_md:
        data_sample_section = f"""
=== DATA SAMPLE (representative rows) ===
{data_sample_md}
"""

    return f"""
You are a chart assistant. Decide one action and return JSON only.

Data domain: {domain}
{col_section}
{data_sample_section}
Catalog (drawable charts pre-computed for this data — explore all options):
{catalog_summary}

Rules:
1) Actions must be one of: draw, qc_suggest, suggest, confirm, info.
2) {qc_guard}
3) draw: user clearly asks a specific chart and enough fields/context are given.
4) qc_suggest: domain=qc and user asks QC chart in general (not a specific QC chart).
5) confirm: user mentions a specific column or metric but chart type is unclear — propose 2-3 fitting charts.
6) suggest: user is vague but chart-related — show diverse options from catalog.
7) info: off-topic, or QC chart request on generic domain.
8) message_vi: natural language, 1-3 sentences, match user language.
   Use actual column values and data content you observed to make suggestions specific.
   GOOD: "Tôi thấy data có iPhone/Samsung/Oppo — Line Chart theo tháng chia theo sản phẩm sẽ
          cho thấy xu hướng rõ ràng."
   BAD:  "Prompt của bạn còn thiếu thông tin"
9) chart_type_hint: exact chart type name when possible, else empty string.
10) Use column profile AND data sample to reason about suitability:
    - If categorical values are product names → Grouped Bar Chart or Pie Chart
    - If categorical values are time-related (shifts, dates) → Line/Area Chart
    - If quantitative range is very wide → consider log scale or histogram
    - If data has few rows overall → Scatter or Dot Plot better than Bar

Output JSON schema:
{{
  "action": "draw|qc_suggest|suggest|confirm|info",
  "message_vi": "string",
  "chart_type_hint": "string",
  "detected_fields": ["FIELD1"],
  "confidence": 0.0,
  "rationale": "one short english sentence referencing actual data content"
}}
""".strip()
```

---

### 3.7 Cập nhật `SmartChatAgent.run()` — truyền thêm `sample_rows`

**File:** `py-src/data_formulator/agents/agent_smart_chat.py`

```python
class SmartChatAgent:
    def run(
        self,
        prompt: str,
        columns: List[str],
        domain: str,
        drawable_catalog: List[DrawableChartEntry],
        field_metas: Optional[Dict[str, Any]] = None,
        sample_rows: Optional[List[dict]] = None,   # MỚI
    ) -> SmartChatResult:
        catalog_summary = _build_catalog_summary(drawable_catalog)
        column_profile = _build_column_profile(field_metas) if field_metas else ""
        data_sample_md = _build_data_sample_section(sample_rows or [])  # MỚI
        system_prompt = _build_system_prompt(
            columns, domain, catalog_summary,
            column_profile=column_profile,
            data_sample_md=data_sample_md,           # MỚI
        )
        ...
```

---

### 3.8 Cập nhật hàm `smart_chat` trong `agent_routes.py` — truyền `sample_rows`

**File:** `py-src/data_formulator/agent_routes.py`

```python
@agent_bp.route('/smart-chat', methods=['GET', 'POST'])
def smart_chat():
    ...
    data_columns = extract_all_columns_from_input_tables(input_tables)
    domain = "qc" if is_qc_data(data_columns) else "generic"
    field_metas = _build_field_metas_from_input_tables(input_tables)
    sample_rows = _extract_sample_rows(input_tables)   # MỚI
    drawable_catalog = build_drawable_catalog(field_metas, domain, top_k=None)

    ...
    result = agent.run(
        instruction, data_columns, domain, drawable_catalog,
        field_metas=field_metas,
        sample_rows=sample_rows,    # MỚI
    )
```

---

### 3.9 Cập nhật `compute_field_metadata` (DuckDB path)

**File:** `py-src/data_formulator/agents/field_metadata.py`

Khi dùng DuckDB (không qua pandas), hàm `compute_field_metadata` cũng cần populate `sample_values`.

```python
# Sau khi tính toán stats, thêm:
sample_values = []
if cardinality_class in ("low", "mid") and cardinality <= 12:
    rows_q = conn.execute(
        f"SELECT DISTINCT {_quote_ident(col)} FROM {table_q} "
        f"WHERE {_quote_ident(col)} IS NOT NULL "
        f"ORDER BY 1 LIMIT 12"
    ).fetchall()
    sample_values = [_safe_serialize(r[0]) for r in rows_q]
elif is_temporal:
    rows_q = conn.execute(
        f"SELECT {_quote_ident(col)}::VARCHAR FROM {table_q} "
        f"WHERE {_quote_ident(col)} IS NOT NULL "
        f"ORDER BY 1 LIMIT 1 "
        f"UNION ALL "
        f"SELECT {_quote_ident(col)}::VARCHAR FROM {table_q} "
        f"WHERE {_quote_ident(col)} IS NOT NULL "
        f"ORDER BY 1 DESC LIMIT 1"
    ).fetchall()
    sample_values = [r[0] for r in rows_q]
```

> **Lưu ý:** DuckDB path hiện chỉ được dùng khi gọi agent qua `derive-data`, không phải `smart-chat`. Cập nhật này để đảm bảo consistency khi về sau hai path được dùng chung.

---

## 4. Ví Dụ Trước / Sau Upgrade

### Scenario: Data bán hàng điện thoại

**Prompt:** `"Vẽ biểu đồ cho tôi"`  
**Data:** `[month, product, region, revenue, quantity]` với product = `[iPhone, Samsung, Oppo]`

#### Trước:
```
message_vi: "Dựa trên dữ liệu của bạn, đây là các biểu đồ có thể vẽ ngay."
suggestions:
  - Bar Chart (x=product, y=revenue)
  - Line Chart (x=month, y=revenue)
  - Scatter Plot (x=revenue, y=quantity)
```
→ Chung chung, không có ngữ nghĩa.

#### Sau:
```
message_vi: "Mình thấy data theo dõi doanh thu của 3 hãng điện thoại (iPhone, Samsung, Oppo)
             qua 6 tháng tại 3 vùng. Gợi ý tốt nhất: Line Chart để so sánh xu hướng theo tháng,
             Grouped Bar Chart để so sánh trực tiếp 3 hãng, hoặc Scatter để xem mối quan hệ
             doanh thu vs số lượng."
suggestions:
  - Line Chart (x=month, y=revenue, color=product)  ← agent biết product là tên hãng
  - Grouped Bar Chart (x=month, y=revenue, group=product)
  - Scatter Plot (x=quantity, y=revenue, color=product)
```

---

### Scenario: Data QC thực tế

**Prompt:** `"Phân tích data này"`  
**Data:** QC data với `QCSHIFT = [CA1, CA2, CA3]`, `QCSTDPARAMNAME = [Độ dày, Độ bóng]`

#### Trước:
```
message_vi: "Dữ liệu QC của bạn có thể vẽ các biểu đồ sau:"
```

#### Sau:
```
message_vi: "Mình thấy đây là dữ liệu QC theo dõi 2 thông số (Độ dày, Độ bóng) qua 3 ca
             sản xuất (CA1, CA2, CA3). QC Trend Line sẽ cho thấy xu hướng VALUE theo ca,
             QC Histogram giúp kiểm tra phân phối của từng thông số."
```

---

## 5. Files Cần Thay Đổi

| File | Loại thay đổi | Mô tả |
|---|---|---|
| `py-src/data_formulator/agents/field_metadata.py` | Sửa | Thêm `sample_values: List[Any]` vào `FieldMeta` dataclass + cập nhật `compute_field_metadata` (DuckDB path) |
| `py-src/data_formulator/agent_routes.py` | Sửa | (1) Thêm `_safe_serialize()` helper; (2) Cập nhật `_build_field_metas_from_input_tables` populate `sample_values`; (3) Thêm `_extract_sample_rows()` và `_truncate_cell()`; (4) Truyền `sample_rows` vào `agent.run()` |
| `py-src/data_formulator/agents/agent_smart_chat.py` | Sửa | (1) Cập nhật `_build_column_profile()` hiển thị `sample_values`; (2) Thêm `_build_data_sample_section()`; (3) Cập nhật `_build_system_prompt()` thêm section DATA SAMPLE + rule #8 + rule #10 cải thiện; (4) Cập nhật `SmartChatAgent.run()` nhận `sample_rows` param |
| `py-src/data_formulator/tests/test_smart_chat_agent_intent.py` | Sửa | Thêm test cases với `sample_rows` và kiểm tra `message_vi` có đề cập giá trị thực tế |

---

## 6. Token Budget Analysis

### Ước tính token thêm vào:

| Section | Ước tính tokens | Ghi chú |
|---|---|---|
| DATA SAMPLE (3 rows, 6 cols) | ~80–120 tokens | Phụ thuộc độ dài giá trị |
| `values=[...]` trong column profile | ~50–150 tokens | Chỉ với categorical (low/mid) |
| Instruction mới trong system prompt | ~50 tokens | Rule #8, #10 cải thiện |
| **Tổng thêm** | **~180–320 tokens** | |

### Ngưỡng an toàn:
- gpt-4o: 128k context → hoàn toàn OK
- Catalog hiện tại 40–80 entries × ~20 tokens = ~800–1600 tokens → vẫn là phần tốn nhất
- Sample data (180–320 tokens) chỉ tăng ~15–20% tổng prompt

---

## 7. Các Trường Hợp Biên Cần Xử Lý

| Trường hợp | Xử lý |
|---|---|
| Data có nhiều cột categorical với cardinality mid (20-50 values) | Giới hạn `MAX_SAMPLE_VALUES = 12` — chỉ lấy 12 giá trị đầu (sorted) |
| Giá trị ô quá dài (URL, base64, JSON string) | `_truncate_cell()` cắt tại 25 ký tự + "…" |
| Data có PII (tên người, số điện thoại) | **Hiện tại chưa filter** — ghi chú trong plan, để task riêng nếu cần |
| Table rỗng / 0 rows | `_extract_sample_rows()` trả `[]` → `_build_data_sample_section` trả `""` → section không xuất hiện trong prompt |
| Nhiều bảng join (multi-table) | Chỉ lấy sample_rows từ bảng đầu tiên có dữ liệu — đủ để agent hiểu cấu trúc |
| Cột có toàn NULL | `series.dropna().unique()` trả empty → `sample_values = []` → không xuất hiện trong `values=[...]` |
| Giá trị float có nhiều decimal (0.123456789) | `_safe_serialize` → `str(val)` → cắt tại 30 ký tự |
| Unicode / tiếng Việt có dấu | Xử lý tốt qua `str(val)` + json encode = utf-8 |

---

## 8. Test Cases Cần Bổ Sung

### 8.1 Unit test cho `_build_column_profile` với `sample_values`

```python
def test_column_profile_shows_sample_values():
    from data_formulator.agents.field_metadata import FieldMeta
    metas = {
        "product": FieldMeta(
            name="product", sql_type="object",
            cardinality=3, null_ratio=0.0,
            cardinality_class="low",
            is_temporal=False, is_sequential=False,
            is_quantitative=False, is_categorical=True,
            sample_values=["iPhone", "Oppo", "Samsung"],
        ),
    }
    profile = _build_column_profile(metas)
    assert "values=[iPhone, Oppo, Samsung]" in profile
```

### 8.2 Unit test cho `_build_data_sample_section`

```python
def test_data_sample_section_markdown():
    rows = [
        {"month": "2024-01", "product": "iPhone", "revenue": 120000},
        {"month": "2024-04", "product": "Samsung", "revenue": 98000},
    ]
    result = _build_data_sample_section(rows)
    assert "| month |" in result
    assert "| 2024-01 |" in result
    assert "iPhone" in result
```

### 8.3 Test SmartChatAgent với MockClient — kiểm tra message_vi cụ thể hơn

```python
def test_agent_message_mentions_actual_values():
    """Sau khi có sample_values, message_vi của agent phải mention tên cụ thể."""
    mock_response = {
        "action": "suggest",
        "message_vi": "Mình thấy data có iPhone, Samsung, Oppo — gợi ý Line Chart theo tháng.",
        "chart_type_hint": "Line Chart",
        "detected_fields": ["month", "product"],
        "confidence": 0.85,
        "rationale": "product has 3 known brands, monthly data",
    }
    agent = SmartChatAgent(client=MockClient(mock_response))
    field_metas = {
        "product": FieldMeta(..., sample_values=["iPhone", "Samsung", "Oppo"]),
        "month": FieldMeta(..., sample_values=["2024-01", "2024-03", "2024-06"]),
    }
    sample_rows = [{"month": "2024-01", "product": "iPhone", "revenue": 120000}]
    result = agent.run("vẽ biểu đồ", ["month", "product", "revenue"], "generic", [], 
                       field_metas=field_metas, sample_rows=sample_rows)
    assert "iPhone" in result.message_vi or "Samsung" in result.message_vi
```

### 8.4 Test `_extract_sample_rows`

```python
def test_extract_sample_rows_picks_representative():
    rows = [{"a": i, "b": i * 2} for i in range(10)]
    tables = [{"rows": rows}]
    sample = _extract_sample_rows(tables)
    assert len(sample) == 3
    assert sample[0]["a"] == 0   # first
    assert sample[1]["a"] == 5   # middle
    assert sample[2]["a"] == 9   # last

def test_extract_sample_rows_empty():
    assert _extract_sample_rows([]) == []
    assert _extract_sample_rows([{"rows": []}]) == []
```

---

## 9. Lộ Trình Triển Khai

```
Step 1 — Mở rộng FieldMeta + _build_field_metas_from_input_tables (~1h)
  ├── Thêm `sample_values: List[Any]` vào FieldMeta (field_metadata.py)
  ├── Cập nhật _build_field_metas_from_input_tables (agent_routes.py):
  │     populate sample_values cho categorical (low/mid, ≤12 values)
  │     populate sample_values cho temporal (3 giá trị đại diện)
  ├── Thêm _safe_serialize() helper
  └── Unit test: verify sample_values populated đúng

Step 2 — _extract_sample_rows (~30min)
  ├── Thêm hàm _extract_sample_rows() + _truncate_cell() (agent_routes.py)
  └── Unit test: first/mid/last rows, empty table, multi-col truncation

Step 3 — Cập nhật agent_smart_chat.py (~1h)
  ├── Cập nhật _build_column_profile() — thêm values=[...] khi sample_values có
  ├── Thêm _build_data_sample_section() — markdown table
  ├── Cập nhật _build_system_prompt() — thêm DATA SAMPLE section + rule cải thiện
  ├── Cập nhật SmartChatAgent.run() — nhận sample_rows param
  └── Unit test: profile format, sample section format

Step 4 — Wire vào smart_chat endpoint (~20min)
  ├── Gọi _extract_sample_rows(input_tables) trong smart_chat()
  ├── Truyền sample_rows vào agent.run()
  └── Manual test: gõ "vẽ biểu đồ" với data thực → xem message_vi có mention tên cụ thể không

Step 5 — Cập nhật compute_field_metadata DuckDB path (~30min)
  ├── Thêm query DISTINCT ... LIMIT 12 để lấy sample_values
  └── Test với DuckDB fixture

Step 6 — Update TONG_QUAN_DU_AN.md (~15min)
  └── Ghi nhận v0.6.2
```

**Tổng: ~3.5 giờ**

---

## 10. Commit Plan

```
[S1] feat(field-meta): add sample_values to FieldMeta + populate in _build_field_metas
     Files: field_metadata.py, agent_routes.py

[S2] feat(agent-routes): add _extract_sample_rows() + _truncate_cell() helpers
     Files: agent_routes.py

[S3] feat(smart-chat): enrich agent prompt with column sample_values + data sample rows
     Files: agent_smart_chat.py

[S4] feat(smart-chat): wire sample_rows into smart_chat endpoint
     Files: agent_routes.py

[S5] feat(field-meta): populate sample_values in DuckDB compute_field_metadata path
     Files: field_metadata.py

[S6] test: add unit tests for sample_values, extract_sample_rows, enriched profile
     Files: tests/test_smart_chat_agent_intent.py (mới/cập nhật)
```

---

## 11. Kết Quả Mong Đợi

Sau khi hoàn thành, SmartChatAgent sẽ:

✅ Đọc được giá trị thực tế trong data (`iPhone`, `Samsung`, `CA1`, `Độ dày`...)  
✅ Sinh `message_vi` có ngữ nghĩa cụ thể, không còn template chung chung  
✅ Gợi ý biểu đồ phù hợp với **nội dung** data, không chỉ cấu trúc  
✅ `rationale` field giải thích lý do dựa trên dữ liệu thực  
✅ Không tốn thêm nhiều token (~200-300 tokens/request)  
✅ Backward compatible — `sample_values=[]` default, không break code cũ  
✅ Không ảnh hưởng tới pipeline Chart Recommendation (chỉ là SmartChatAgent context)

## Update Note (2026-05-26)

- Suggestion click path now forwards fixed chart context to backend: `user_preferred_chart_type` + `chart_type` + `chart_encodings`.
- Non-QC template constraints now sanitize suggestion encodings before validation:
  - drop unsupported channels for the selected template
  - drop blank channel values (`""`)
- QC special charts remain strict on channel schema.
- Expected result: avoid false rejects such as Boxplot channel mismatch and `Column '' does not exist in the data`.

## Update Note (2026-05-28)

- SmartChat data-context plan remains valid and is now reinforced by runtime routing fixes:
  - suggestion click now bypasses classifier and draws directly when chart type is selected.
  - draw flow no longer downgrades to confirm for UI-selected chart type.

- Additional catalog consistency fixes (important for semantic suggestions):
  - Pie/Donut, Radial Plot, Threshold Bar Chart channel bridging is now aligned between template schema and compatibility schema.
  - Heat Map availability improved for numeric-year datasets (common real-world metadata inference).

- Suggestion robustness improvements to preserve readable natural-language prompts:
  - code-like enriched texts are filtered out and replaced by safe defaults.
  - idea picker now uses family diversity to reduce repetitive suggestions.

- UX baseline:
  - `qcLimitsMode` is enabled by default for all new charts.

## Update Note (2026-05-28) — Xác nhận đã triển khai đầy đủ

Kiểm tra code thực tế xác nhận toàn bộ kế hoạch đã được implement:

### `field_metadata.py`
- `FieldMeta.sample_values: List[Any]` đã có (default `[]`, backward-compatible).
- `MAX_SAMPLE_VALUES = 12` đã có.
- `_safe_serialize()` helper đã có.
- `compute_field_metadata()` (DuckDB path) đã populate `sample_values`:
  - Categorical low/mid (cardinality ≤ 12): lấy toàn bộ unique values, sorted.
  - Temporal: lấy 3 giá trị đại diện (min, median, max).

### `agent_smart_chat.py`
- `_build_column_profile()` đã hiển thị `values=[...]` khi `sample_values` có.
- `_build_data_sample_section()` đã format markdown table từ `sample_rows`.
- `_build_system_prompt()` đã nhận `column_profile` + `data_sample_md` và embed vào section `=== DATA SAMPLE ===`.
- `SmartChatAgent.run()` đã nhận `field_metas` và `sample_rows` params.

### `agent_routes.py`
- `_safe_serialize()` và `_truncate_cell()` đã có.
- `_build_field_metas_from_input_tables()` đã populate `sample_values` qua pandas path.
- `_extract_sample_rows()` đã có (đầu + giữa + cuối, giới hạn 8 cột, cắt 25 ký tự/ô).
- `smart_chat` endpoint đã gọi `_extract_sample_rows()` và truyền `sample_rows` vào `agent.run()`.
