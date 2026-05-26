# Kế Hoạch Sửa Logic Chọn Field Cho Biểu Đồ (Chart Recommendation)

> **Tác giả:** Bui Van Thanh
> **Ngày tạo:** 2026-05-25
> **Trạng thái:** Đã chốt spec, chưa implement
> **Phạm vi:** `agent_sql_data_rec.py`, `agent_py_data_rec.py`, `qc_chart_config.py` + module mới
> **Liên quan tới:** Hệ thống recommendation biểu đồ trong Data Formulator (GDIS AI Agent)

---

## Mục Lục

1. [Bối cảnh & Vấn đề](#1-bối-cảnh--vấn-đề)
2. [Phân tích nguyên nhân gốc rễ](#2-phân-tích-nguyên-nhân-gốc-rễ)
3. [Nguyên tắc thiết kế](#3-nguyên-tắc-thiết-kế)
4. [Spec đã chốt](#4-spec-đã-chốt)
5. [Compatibility Matrix chi tiết](#5-compatibility-matrix-chi-tiết)
6. [Reject Reason Catalog](#6-reject-reason-catalog)
7. [Pipeline Flow mới](#7-pipeline-flow-mới)
8. [Files Plan](#8-files-plan)
9. [Test Strategy](#9-test-strategy)
10. [Lộ trình triển khai (Milestones)](#10-lộ-trình-triển-khai-milestones)
11. [Rủi ro & Mitigation](#11-rủi-ro--mitigation)
12. [Quyết định đã chốt](#12-quyết-định-đã-chốt)
13. [Câu hỏi cần xác nhận trước M1](#13-câu-hỏi-cần-xác-nhận-trước-m1)

---

## 1. Bối cảnh & Vấn đề

### 1.1 Triệu chứng người dùng báo cáo

> "Tại agent phân tích data, chọn biểu đồ để vẽ đang chưa được tốt. Ví dụ: nếu biểu đồ có channel x, data có cột INDEX thì mặc định lấy field này. Nhưng line chart dùng INDEX cho x thì đẹp, còn bar chart phải chọn x là dạng thời gian thì mới đúng, và vô vàn trường hợp khác."

### 1.2 Mục tiêu cuối cùng

- Agent chọn field **phù hợp với từng loại biểu đồ**, không áp đặt 1 default cho tất cả.
- **Reject hẳn** khi data không thể vẽ được biểu đồ đã chọn (không vẽ ra biểu đồ vô nghĩa).
- Linh hoạt cho **cả QC data và Generic data** — 2 domain hoàn toàn khác biệt về cách xử lý.

---

## 2. Phân tích nguyên nhân gốc rễ

### 2.1 Code hiện tại có 2 vấn đề lớn

**Vấn đề 1: One-size-fits-all defaults**

Tại [`agent_sql_data_rec.py:84-98`](py-src/data_formulator/agents/agent_sql_data_rec.py#L84-L98) và [`agent_sql_data_rec.py:140-170`](py-src/data_formulator/agents/agent_sql_data_rec.py#L140-L170), prompt dạy LLM:

```
x default = "INDEX"
y default = "VALUE"
color default = "QCSTDPARAMNAME"
```

Cho **TẤT CẢ** chart types: `point, histogram, bar, line, area, heatmap, group_bar, boxplot, linear_regression, rolling_average, radial_plot`.

**Hậu quả:**

| Chart type | Default x=INDEX có hợp lý không? | Lý do |
|---|---|---|
| line / area / linear_regression / rolling_average | OK | Trend over sequence — INDEX hợp lý nếu không có time field |
| point (scatter) | Tùy | Tốt khi xem trend; xấu khi xem correlation 2 metrics |
| **bar / group_bar** | **SAI** | Bar cần x là categorical — INDEX = 1..1000 → 1000 thanh nhỏ vô nghĩa |
| **histogram** | **SAI NGHIÊM TRỌNG** | Histogram cần x là quantitative cần distribute (chính là VALUE), không phải INDEX (INDEX uniform → 1 hình chữ nhật phẳng) |
| **heatmap** | **SAI** | Heatmap cần x, y là 2 categorical, INDEX phá vỡ ô lưới |
| **boxplot** | **SAI** | Boxplot cần x là categorical group |
| **pie / donut / funnel / treemap / pyramid** | **SAI** | Không dùng channel x/y theo nghĩa thông thường |

**Vấn đề 2: Lẫn lộn 2 domain (QC vs Generic)**

3 tên cột mặc định (`INDEX`, `VALUE`, `QCSTDPARAMNAME`) **chỉ tồn tại trong QC data**. Khi user load CSV bán hàng `[date, product, region, revenue]`:
- Prompt vẫn dạy LLM tìm INDEX/VALUE/QCSTDPARAMNAME (không có)
- LLM phải đoán bừa
- Kết quả linh tinh

→ Code đang viết cho QC nhưng pretend là generic. Phải tách 2 domain rõ ràng.

### 2.2 Vấn đề phụ: Token waste

Prompt nhắc lại default `x="INDEX"` **4 lần** ở các vị trí khác nhau:
- Lines 84-98: "DEFAULT AXIS MAPPINGS"
- Lines 140-170: "chart_encodings should specify..."
- Lines 158-168: Per-chart-type defaults
- Lines 177-220: Guidelines for choosing chart type

→ Tăng xác suất LLM bám cứng vào default mà bỏ qua ngữ cảnh.

---

## 3. Nguyên tắc thiết kế

### N1 — Reject-first

Thà không vẽ còn hơn vẽ rác. Validator có quyền veto, **không "fallback im lặng"**.

### N2 — Hai domain tách bạch

| Layer | QC mode | Generic mode |
|---|---|---|
| Detect | `is_qc_data(columns)` = True (TARGET + ≥1 limit + ≥1 QC signature) | False |
| Field discovery | Tên cột cố định: INDEX/VALUE/QCDATE/QCSHIFT/QCSTDPARAMNAME | Tính metadata semantic từ data |
| Default picker | Lookup table cố định cho QC columns | Pick theo `cardinality_class` + `is_temporal` + `is_quantitative` |
| Available chart types | Standard + 3 QC charts | Chỉ standard |
| Control limit handling | TARGET/LL/UL/ARLL/ARUL render thành đường ngang, KHÔNG vào encoding | N/A |

### N3 — Validation dựa trên FieldMeta, không trên tên thuần

Mọi quyết định pick/validate đều dựa trên metadata semantic (`is_temporal`, `is_quantitative`, `cardinality_class`...), không trên tên cột.

### N4 — Knowledge base declarative

`CHART_REQUIREMENTS` là dict declarative — dễ test, dễ tune, không nhúng logic trong prompt.

### N5 — Early reject

Reject ngay khi có thể, **trước khi gọi LLM** — tiết kiệm chi phí, fail-fast UX.

---

## 4. Spec đã chốt

### S1 — Domain detection (Q1: đã chốt)

Upgrade `is_qc_data()` để tránh false positive:

```python
def is_qc_data(columns: list[str]) -> bool:
    upper = {c.upper() for c in columns}
    has_target_limits = 'TARGET' in upper and bool({'LL','UL','ARLL','ARUL'} & upper)
    has_qc_signature  = bool({'QCDATE','QCSHIFT','QCSTDPARAMNAME','SLIPNO'} & upper)
    return has_target_limits and has_qc_signature
```

**Lý do:** data bán hàng có thể có cột tên "TARGET" (doanh số mục tiêu) + "LL" (low limit budget) sẽ bị detect nhầm là QC. Thêm signature column (QCDATE/QCSHIFT/QCSTDPARAMNAME/SLIPNO) để chắc chắn.

### S2 — INDEX handling (Q2: đã chốt — option a)

| Domain | INDEX role | Pick logic |
|---|---|---|
| **QC** | 1st-class semantic field | Default x cho line/area/qc_trend_line khi không có temporal |
| **Generic** | Technical artifact | **KHÔNG bao giờ** pick INDEX vào default encoding, dù tên cột là `INDEX`/`id`/`row_num` |

Trong generic mode, x default chỉ pick từ:
- temporal columns (cho line/area/timeline)
- categorical_low/mid (cho bar/group_bar)
- quantitative (cho histogram/scatter)

INDEX phải user explicit chọn.

### S3 — Reject contract (Q3: đã chốt — option a, modal blocking)

**Backend response:**

```json
{
  "status": "rejected_incompatible",
  "agent": "SQLDataRecAgent",
  "reject": {
    "reason_code": "R3",
    "reason_short": "cardinality_explosion",
    "message_vi": "Bar chart với 837 categories sẽ không đọc được.",
    "context_columns": ["ITEMNAME"],
    "suggested_chart_types": ["histogram", "treemap"],
    "suggested_actions": ["Lọc top-20 ITEMNAME phổ biến", "GROUP BY level cao hơn"]
  },
  "refined_goal": {},
  "code": "",
  "content": null
}
```

**Frontend:**
- Bắt status này → mở **Modal blocking**
- Không tạo Chart object trong Redux store
- Hiển thị reason + suggestions
- Có nút "Apply suggestion" để user 1-click chọn alternative

### S4 — FieldMeta data class

```python
@dataclass
class FieldMeta:
    name: str
    sql_type: str                # INTEGER, VARCHAR, DATE, TIMESTAMP, ...
    cardinality: int             # COUNT(DISTINCT col)
    null_ratio: float            # NULL count / total rows
    cardinality_class: Literal["low","mid","high","huge"]
                                 # ≤12 / ≤50 / ≤500 / >500
    is_temporal: bool            # sql_type ∈ {DATE,TIMESTAMP} OR parseable
    is_sequential: bool          # int + (max - min + 1 == count distinct)
    is_quantitative: bool        # numeric + stddev > 0 + cardinality > 10
    is_categorical: bool         # cardinality_class ∈ {low, mid}
    qc_role: Optional[Literal["control_limit","measurement","time",
                              "shift","param","slip","item"]]
    looks_like_id: bool          # tên matches id/no/code/seq + high cardinality
```

**Compute strategy:** 1 query DuckDB cho toàn bộ table:
```sql
SELECT
  COUNT(*),
  COUNT(DISTINCT col1), STDDEV(col1), MIN(col1), MAX(col1),
  COUNT(DISTINCT col2), STDDEV(col2), MIN(col2), MAX(col2),
  ...
FROM table_name
```

Cache trong session để tránh re-compute.

### S5 — qc_role auto-assignment

```python
QC_ROLE_MAP = {
    "TARGET": "control_limit",
    "LL": "control_limit", "UL": "control_limit",
    "ARLL": "control_limit", "ARUL": "control_limit",
    "VALUE": "measurement",
    "QCDATE": "time", "LASTUPDATE": "time",
    "QCSHIFT": "shift",
    "QCSTDPARAMNAME": "param",
    "SLIPNO": "slip",
    "ITEMNAME": "item",
}
```

Field có `qc_role == "control_limit"` **không bao giờ** đưa vào encoding channel — luôn render thành đường ngang reference.

---

## 5. Compatibility Matrix chi tiết

### 5.1 Cấu trúc knowledge base

```python
CHART_REQUIREMENTS = {
    "<chart_type>": {
        "domain": ["qc", "generic"],     # chart có thể dùng trong domain nào
        "channels": {
            "<channel_name>": {
                "required": bool,
                "accept_roles": [...],    # field roles được phép
                "reject_roles": [...],    # field roles cấm
                "soft_priority": [...]    # thứ tự ưu tiên khi pick default
            }
        },
        "min_distinct_x": int,            # số unique value tối thiểu
        "max_distinct_x": int,            # số unique value tối đa
        "uniqueness_check": (col1, col2), # check duplicate keys
        "forbidden_channels": [...],      # channel không được phép
        "required_signature": [...]       # QC chart cần data có signature này
    }
}
```

**Field roles tổng hợp** (used trong accept/reject):
- `temporal` — datetime/date
- `sequential` — int đơn điệu (INDEX)
- `quantitative` — numeric với variance > 0
- `categorical_low` — cardinality ≤ 12
- `categorical_mid` — cardinality 13-50
- `categorical_high` — cardinality 51-500
- `categorical_huge` — cardinality > 500

### 5.2 Bảng đầy đủ cho từng chart type

#### Nhóm A — Trend over time/sequence

**`line`, `area`, `rolling_average`, `linear_regression`**

| Channel | Required | Accept | Reject | Soft Priority |
|---|---|---|---|---|
| x | YES | temporal, sequential, quantitative | categorical_high, categorical_huge | temporal > sequential > quantitative |
| y | YES | quantitative | sequential, categorical | (first quantitative ≠ x) |
| color | NO | categorical_low | categorical_high, categorical_huge, quantitative | (smallest cardinality_low) |

- `min_distinct_x`: 2
- `uniqueness_check`: ("x", "color") — duplicate (x, color) với y khác → R5

#### Nhóm B — Compare across categories

**`bar`, `group_bar`**

| Channel | Required | Accept | Reject | Soft Priority |
|---|---|---|---|---|
| x | YES | categorical_low, categorical_mid, temporal | sequential, categorical_huge, quantitative | categorical_low > temporal > categorical_mid |
| y | YES | quantitative | sequential | (first quantitative) |
| color | NO | categorical_low | categorical_high, categorical_huge | |

- `max_distinct_x`: 200 — vượt → R3

#### Nhóm C — Distribution của 1 biến

**`histogram`**

| Channel | Required | Accept | Reject | Soft Priority |
|---|---|---|---|---|
| x | YES | quantitative | sequential, categorical (mọi class), temporal | (first quantitative — INDEX bị cấm tuyệt đối) |
| color | NO | categorical_low | categorical_high, categorical_huge, quantitative | |

- `min_distinct_x`: 10

**`boxplot`**

| Channel | Required | Accept | Reject | Soft Priority |
|---|---|---|---|---|
| x | YES | categorical_low, categorical_mid | sequential, categorical_huge, quantitative | categorical_low |
| y | YES | quantitative | sequential | |

#### Nhóm D — Relationship 2 biến

**`point` (scatter)**

| Channel | Required | Accept | Reject | Soft Priority |
|---|---|---|---|---|
| x | YES | quantitative, temporal | sequential, categorical_huge | quantitative > temporal |
| y | YES | quantitative ≠ x | sequential | (quantitative ≠ x) |
| color | NO | categorical_low, categorical_mid | categorical_huge, quantitative | |
| size | NO | quantitative | | |

#### Nhóm E — Matrix

**`heatmap`**

| Channel | Required | Accept | Reject | Soft Priority |
|---|---|---|---|---|
| x | YES | categorical_low, categorical_mid, temporal | sequential, categorical_huge, quantitative | temporal > categorical_low |
| y | YES | categorical_low, categorical_mid | sequential, categorical_huge, quantitative | categorical_low |
| color | YES | quantitative | categorical | (aggregated quantitative) |

#### Nhóm F — Composition

**`pie`, `donut`, `funnel`, `pyramid`**

| Channel | Required | Accept | Reject | Soft Priority |
|---|---|---|---|---|
| label | YES | categorical_low | categorical_mid, categorical_high, categorical_huge, quantitative | |
| value | YES | quantitative | sequential, categorical | |

- `max_distinct_label`: 12
- `forbidden_channels`: ["x", "y"] — LLM hay sai → R6

#### Nhóm G — Specialty

**`pareto`**

| Channel | Required | Accept | Reject |
|---|---|---|---|
| x | YES | categorical_low, categorical_mid | sequential, categorical_huge, quantitative |
| y | YES | quantitative | sequential, categorical |

**`gauge`**: 1 quantitative scalar (single value)
**`waterfall`**: x = stages (ordered), y = changes (signed)
**`radar`**: 3-12 dimensions, mỗi dim 1 quantitative
**`sankey`**: source + target + flow value
**`timeline`**: temporal x bắt buộc + event labels
**`threshold`**: x ordered + y quantitative + threshold lines
**`bubble`**: x, y, size — cả 3 quantitative
**`treemap`, `sunburst`**: hierarchical (category + value)

#### Nhóm H — QC Charts

**`qc_trend_line`**

| Channel | Required | Accept |
|---|---|---|
| INDEX | YES | sequential |
| VALUE | YES | quantitative |
| QCDATE | YES | temporal, categorical |
| QCSHIFT | YES | categorical_low |
| color | YES | categorical_low, categorical_mid |

- `domain`: ["qc"] only
- `required_signature`: TARGET + (LL|UL|ARLL|ARUL) + QC signature column
- Nếu data không phải QC → R2 reject

**`qc_histogram`**

| Channel | Required | Accept |
|---|---|---|
| VALUE | YES | quantitative |
| INDEX | YES | sequential |
| color | YES | categorical_low, categorical_mid |

**`qc_trend_bar`**

| Channel | Required | Accept |
|---|---|---|
| VALUE | YES | categorical, quantitative |
| QCDATE | YES | temporal, categorical |
| QCSHIFT | YES | categorical_low |

---

## 6. Reject Reason Catalog

### Reject Codes

| Code | Tên ngắn | Trigger | Detection layer | Severity |
|---|---|---|---|---|
| **R1** | `no_data_fit` | Required channel không có field nào accept role | `pick_default_encoding()` | Hard |
| **R2** | `qc_chart_non_qc_data` | `chart_type ∈ qc_*` AND `is_qc_data == False` | Domain check (early) | Hard |
| **R3** | `cardinality_explosion` | Field cardinality vượt `max_distinct_x` | `validate_chart()` | Hard |
| **R4** | `wrong_dimensionality` | Không đủ field thỏa accept role (vd scatter chỉ có 1 quantitative) | `validate_chart()` | Hard |
| **R5** | `duplicate_keys` | line/area: tồn tại duplicate (x, color) với y khác | DuckDB query | Soft (warn + suggest aggregate) |
| **R6** | `channel_mismatch` | LLM trả về channel có trong `forbidden_channels` | Post-process LLM | Hard |
| **R7** | `control_limit_in_encoding` | LLM cho TARGET/LL/UL/ARLL/ARUL vào x/y/color | Post-process LLM | Hard |

### Format message_vi

Tất cả messages bằng tiếng Việt, format chung:

```
[Lý do cụ thể với column reference]
[Vì sao sai - 1 câu]
[Gợi ý alternative - 1-2 actions cụ thể]
```

### Ví dụ messages

**R1 — Bar chart trên data toàn text:**
```
"Bar chart cần ít nhất 1 cột số. Data hiện tại chỉ có text columns: [date, product, region].
Vì bar chart cần height (y) là giá trị số đo được.
Thử: (1) Tạo cột count = COUNT(*) GROUP BY product, (2) Pie chart với label=product."
```

**R2 — QC chart trên data không QC:**
```
"QC Trend Line cần data có cột TARGET + (LL/UL/ARLL/ARUL) + (QCDATE/QCSHIFT).
Data hiện tại không phải QC data: [date, product, sales, region].
Dùng Line chart thay thế với x=date, y=sales."
```

**R3 — Bar chart với 837 ITEMNAME:**
```
"Bar chart với 837 ITEMNAME sẽ không đọc được (mỗi thanh < 1px).
Bar chart chỉ phù hợp với dưới 200 categories.
Thử: (1) Lọc top-20 ITEMNAME phổ biến nhất, (2) GROUP BY category level cao hơn."
```

---

## 7. Pipeline Flow mới

### 7.1 Sequence diagram

```
User → Frontend → POST /api/agent/derive-data
                      ↓
          [SQLDataRecAgent.run()]
                      ↓
          1. Compute FieldMeta (DuckDB query, S4)
                      ↓
          2. Detect domain (S1) → is_qc_data?
                      ↓
          3. EARLY REJECT layer 1
             - chart_type ∈ qc_* AND not QC → R2
             - chart_type vs data fields → R1, R4
             → return rejected_incompatible (no LLM call)
                      ↓
          4. Build prompt with FieldMeta as hints
             (no more "x=INDEX" hardcoded)
                      ↓
          5. Call LLM
                      ↓
          6. POST VALIDATE layer 2
             - validate_chart(chart_type, encoding, fields, domain)
             - Check R3, R5, R6, R7
             → return rejected_incompatible nếu fail
                      ↓
          7. Execute SQL
                      ↓
          8. Return result OR rejected_incompatible
```

### 7.2 Code skeleton

```python
def run(self, input_tables, description, ...):
    # === 1. Compute metadata ===
    field_metas = {}
    for table in input_tables:
        field_metas[table['name']] = compute_field_metadata(
            self.conn, sanitize_table_name(table['name'])
        )
    
    # === 2. Detect domain ===
    all_cols = extract_all_columns_from_input_tables(input_tables)
    domain = "qc" if is_qc_data(all_cols) else "generic"
    
    # === 3. Early reject ===
    if user_preferred_chart_type:
        early_reject = check_chart_data_compatibility(
            user_preferred_chart_type, field_metas, domain
        )
        if early_reject:
            return [self._build_reject_response(early_reject)]
    
    # === 4. Build prompt ===
    # Inject FieldMeta into [CONTEXT], not hardcoded defaults
    user_query = self._build_prompt_with_metadata(
        description, field_metas, domain, user_preferred_chart_type
    )
    
    # === 5. Call LLM ===
    response = self.client.get_completion(messages=...)
    
    # === 6-7. Post-validate + execute ===
    return self.process_gpt_response(
        input_tables, messages, response,
        field_metas=field_metas, domain=domain,
        user_preferred_chart_type=user_preferred_chart_type
    )


def process_gpt_response(self, ..., field_metas, domain, ...):
    # Parse LLM
    refined_goal = ...
    
    # === Post-validate ===
    validation = validate_chart(
        chart_type=refined_goal['chart_type'],
        encoding=refined_goal['chart_encodings'],
        field_metas=field_metas,
        domain=domain,
    )
    if not validation.is_valid:
        return [self._build_reject_response(validation.reject)]
    
    # === Execute SQL ===
    ...
```

---

## 8. Files Plan

### 8.1 Backend (Python)

| # | File | Action | Mô tả |
|---|---|---|---|
| 1 | `py-src/data_formulator/agents/field_metadata.py` | **NEW** | `FieldMeta` dataclass + `compute_field_metadata(conn, table) -> Dict[str, FieldMeta]` |
| 2 | `py-src/data_formulator/agents/chart_compatibility.py` | **NEW** | `CHART_REQUIREMENTS` dict (knowledge base) + `validate_chart()`, `check_chart_data_compatibility()`, `ValidationResult`, `RejectInfo` dataclasses |
| 3 | `py-src/data_formulator/agents/chart_defaults.py` | **NEW** | `pick_default_encoding(chart_type, field_metas, domain) -> Dict[channel, col]` (returns None nếu R1) |
| 4 | `py-src/data_formulator/agents/qc_chart_config.py` | **MODIFY** | Update `is_qc_data()` (S1). Add `QC_ROLE_MAP` (S5). Đồng bộ với CHART_REQUIREMENTS. |
| 5 | `py-src/data_formulator/agents/agent_sql_data_rec.py` | **MODIFY** | Slim prompt (bỏ 4 chỗ INDEX/VALUE/QCSTDPARAMNAME defaults). Integrate pipeline S7. |
| 6 | `py-src/data_formulator/agents/agent_py_data_rec.py` | **MODIFY** (sau M4) | Tương tự, sau khi sql agent ổn định |
| 7 | `py-src/data_formulator/agent_routes.py` | **MODIFY** | Pass-through status `rejected_incompatible` đến frontend |

### 8.2 Frontend (TypeScript/React)

| # | File | Action | Mô tả |
|---|---|---|---|
| 8 | `src/components/ChartIncompatibleModal.tsx` | **NEW** | Modal blocking với reject reason + suggestions + nút "Apply suggestion" |
| 9 | `src/app/dfSlice.tsx` | **MODIFY** | Handler cho `rejected_incompatible` status — không tạo Chart, trigger modal |
| 10 | `src/views/ChartRecBox.tsx` | **MODIFY** | Hook vào reject flow, hiển thị modal |

### 8.3 Tests (NEW directory)

| # | File | Action | Mô tả |
|---|---|---|---|
| 11 | `py-src/data_formulator/tests/__init__.py` | **NEW** | Module marker |
| 12 | `py-src/data_formulator/tests/conftest.py` | **NEW** | Pytest fixtures: in-memory DuckDB, mock tables |
| 13 | `py-src/data_formulator/tests/test_field_metadata.py` | **NEW** | 30 cases — accuracy của metadata detection |
| 14 | `py-src/data_formulator/tests/test_chart_defaults.py` | **NEW** | 50 cases — pick đúng field cho từng chart |
| 15 | `py-src/data_formulator/tests/test_chart_compatibility.py` | **NEW** | 50 cases reject — đúng reason_code + suggestion |
| 16 | `py-src/data_formulator/tests/test_qc_detection.py` | **NEW** | 15 cases — QC detection (true positive + false positive) |
| 17 | `py-src/data_formulator/tests/fixtures/` | **NEW** | CSV files cho integration test |

### 8.4 Dependencies

| File | Action |
|---|---|
| `pyproject.toml` | Add `pytest` to dev dependencies (chưa có pytest trong project) |

---

## 9. Test Strategy

### 9.1 Lớp 1 — Unit test rule table (rẻ, mỗi commit)

**Mục đích:** Đảm bảo logic mapping không regression.

**Phương pháp:** Mock các schema giả + chart_type, assert hàm `pick_default_encoding()` trả về đúng field.

**Test fixtures:**

```python
SCHEMAS = {
    # QC fixtures
    "qc_full": ["INDEX","QCDATE","QCSHIFT","VALUE","QCSTDPARAMNAME","TARGET","LL","UL","ARLL","ARUL","SLIPNO","ITEMNAME"],
    "qc_no_arl": ["INDEX","QCDATE","QCSHIFT","VALUE","QCSTDPARAMNAME","TARGET","LL","UL","SLIPNO","ITEMNAME"],
    "qc_partial": ["INDEX","QCDATE","VALUE","TARGET","LL"],
    
    # Generic fixtures
    "sales_long": ["date","product","region","revenue","quantity"],
    "single_ts": ["timestamp","value"],
    "categorical_heavy": ["country","city","district","status","count"],
    "wide_format": ["month","jan","feb","mar","apr","may"],
    "fake_qc": ["date","sales_target","ll","ul","revenue"],  # tên giống QC nhưng không phải QC
}

# Test matrix
CASES = [
    # (schema, chart_type, expected_encoding)
    ("qc_full",       "bar",          {"x": "QCSHIFT",         "y": "VALUE"}),
    ("qc_full",       "histogram",    {"x": "VALUE"}),
    ("qc_full",       "line",         {"x": "QCDATE",          "y": "VALUE"}),
    ("qc_full",       "heatmap",      {"x": "QCDATE", "y": "QCSHIFT", "color": "VALUE"}),
    ("qc_full",       "pie",          {"label": "QCSTDPARAMNAME", "value": "VALUE"}),
    ("sales_long",    "bar",          {"x": "product",         "y": "revenue"}),
    ("sales_long",    "line",         {"x": "date",            "y": "revenue"}),
    ("single_ts",     "line",         {"x": "timestamp",       "y": "value"}),
    ("fake_qc",       "bar",          {"x": "date",            "y": "revenue"}),  # NOT detected as QC
    # ... 50+ cases total
]
```

### 9.2 Lớp 2 — Reject path

**Mục đích:** Kiểm tra rule HARD bị vi phạm sẽ bị bắt với đúng reason code.

```python
REJECT_CASES = [
    # (schema, chart_type, encoding, expected_reason_code)
    ("sales_long",     "histogram", {"x": "INDEX"},     "R1"),  # no INDEX in sales
    ("qc_full",        "histogram", {"x": "INDEX"},     "R6"),  # INDEX not quantitative
    ("qc_full",        "bar",       {"x": "INDEX"},     "R6"),  # INDEX not categorical
    ("sales_long",     "qc_trend_line", {},             "R2"),  # non-QC data
    ("huge_categories","bar",       {"x": "id"},        "R3"),  # 1000+ unique
    ("single_numeric", "scatter",   {"x": "value"},     "R4"),  # only 1 quantitative
    ("qc_full",        "pie",       {"x": "QCSHIFT"},   "R6"),  # pie has no x
    ("qc_full",        "line",      {"y": "TARGET"},    "R7"),  # control limit in encoding
    # ... 50+ cases
]
```

### 9.3 Lớp 3 — Field metadata accuracy

```python
META_CASES = [
    # In-memory DuckDB with known data
    # (col_definition, expected_meta_field, expected_value)
    ("INDEX INT 1..1000 sequential",  "is_sequential",      True),
    ("INDEX INT 1..1000 sequential",  "cardinality_class",  "huge"),
    ("QCDATE DATE",                   "is_temporal",        True),
    ("QCDATE DATE",                   "qc_role",            "time"),
    ("QCSHIFT VARCHAR ('A','B','C')", "is_categorical",     True),
    ("QCSHIFT VARCHAR ('A','B','C')", "cardinality_class",  "low"),
    ("VALUE FLOAT (1.0..100.0)",      "is_quantitative",    True),
    ("VALUE FLOAT (1.0..100.0)",      "qc_role",            "measurement"),
    ("TARGET FLOAT (50.0)",           "qc_role",            "control_limit"),
    ("CONST_COL INT all=5",           "is_quantitative",    False),  # variance = 0
    ("NULL_COL all NULL",             "null_ratio",         1.0),
    # ... 30+ cases
]
```

### 9.4 Lớp 4 — Snapshot end-to-end (chạy thủ công khi đổi prompt)

**Mục đích:** Test với real LLM + real data để bắt regression sau khi sửa prompt.

**Cases:** 30 prompts đại diện cho user actual workflow.

```python
SNAPSHOT_CASES = [
    # (dataset_name, user_prompt, expected_chart_type, expected_encoding_keys)
    ("qc_dataset_1", "Vẽ trend value theo thời gian",        "line",      {"x", "y"}),
    ("qc_dataset_1", "So sánh value theo ca",                "bar",       {"x", "y"}),
    ("qc_dataset_1", "Phân bố giá trị",                      "histogram", {"x"}),
    ("qc_dataset_1", "Heatmap ngày × ca",                    "heatmap",   {"x", "y", "color"}),
    ("qc_dataset_1", "Pie theo loại param",                  "pie",       {"label", "value"}),
    ("sales_data",   "Doanh thu theo tháng",                 "line",      {"x", "y"}),
    ("sales_data",   "So sánh region",                       "bar",       {"x", "y"}),
    # ... 30 cases
]
```

Output lưu vào `tests/snapshots/baseline.json`. Khi sửa prompt → so sánh diff:
- Chart type khác → review case
- Encoding khác → review case
- New reject → review case

**Estimate cost:** 30 × 2-3s LLM call = ~2 phút/lần chạy.

### 9.5 Test framework setup

Project hiện chưa có pytest. Cần:
1. Add `pytest` + `pytest-mock` vào `pyproject.toml`
2. Tạo `py-src/data_formulator/tests/__init__.py`
3. Tạo `py-src/data_formulator/tests/conftest.py` với fixtures:
   - `duckdb_conn`: in-memory DuckDB
   - `qc_full_table`, `qc_partial_table`, `sales_table`, ... seed data

---

## 10. Lộ trình triển khai (Milestones)

### M1 — Foundation: Field Metadata (1 buổi)

**Goals:**
- Có thể tính FieldMeta cho bất kỳ DuckDB table nào
- Test đầy đủ accuracy

**Deliverables:**
- `field_metadata.py` (FieldMeta dataclass + compute function)
- `tests/__init__.py`, `tests/conftest.py`
- `tests/test_field_metadata.py` (30 test cases)
- Add pytest to `pyproject.toml`

**Acceptance criteria:**
- All 30 tests pass
- `compute_field_metadata()` chạy < 100ms cho table 100k rows
- Coverage > 90% cho `field_metadata.py`

**Commit message:** `feat(agents): add FieldMeta computation for chart recommendation`

---

### M2 — Knowledge Base + Defaults (1 ngày)

**Goals:**
- `CHART_REQUIREMENTS` đầy đủ cho ~25 chart types
- `pick_default_encoding()` hoạt động chính xác
- `validate_chart()` bắt được tất cả R1-R7

**Deliverables:**
- `chart_compatibility.py` (knowledge base + validators)
- `chart_defaults.py` (picker)
- `tests/test_chart_defaults.py` (50 cases)
- `tests/test_chart_compatibility.py` (50 reject cases)

**Acceptance criteria:**
- All 100 tests pass
- Tất cả R1-R7 đều có test case
- Mọi chart trong frontend dropdown đều có CHART_REQUIREMENTS entry

**Commit message:** `feat(agents): add chart compatibility validator and default picker`

---

### M3 — Integration vào agent_sql_data_rec.py (1 buổi)

**Goals:**
- Pipeline S7 hoạt động: early reject → LLM → post validate
- **Chưa đụng vào prompt** — để dễ debug separation
- QC detection upgrade (S1)

**Deliverables:**
- `qc_chart_config.py` updated với S1 + S5
- `tests/test_qc_detection.py` (15 cases)
- `agent_sql_data_rec.py` integrate pipeline (giữ prompt cũ)
- `agent_routes.py` pass-through reject status

**Acceptance criteria:**
- Existing functionality không bị break
- Early reject hoạt động (R1, R2, R4 không gọi LLM)
- Post validate bắt được R3, R5, R6, R7
- Manual test với 5 case thực tế

**Commit message:** `feat(agents): integrate chart compatibility validation pipeline`

---

### M4 — Prompt Refactor (1 buổi)

**Goals:**
- Xóa bỏ 4 chỗ INDEX/VALUE/QCSTDPARAMNAME defaults trong prompt
- Inject FieldMeta vào prompt context như semantic hints
- Snapshot test pass

**Deliverables:**
- `agent_sql_data_rec.py` SYSTEM_PROMPT slim down ~40%
- Format mới cho `[CONTEXT]` section trong prompt (kèm FieldMeta)
- Baseline snapshot updated
- `tests/test_pipeline_snapshot.py` (30 cases — chạy manual)

**Acceptance criteria:**
- Prompt giảm ≥ 30% tokens
- Snapshot diff: cải thiện > 70% case (đặc biệt bar/histogram/heatmap)
- No regression cho line/area/QC cases

**Commit message:** `refactor(agents): replace hardcoded defaults with FieldMeta hints`

---

### M5 — Frontend Modal + Python Agent (1 ngày)

**Goals:**
- UX modal blocking khi reject
- Parity cho `agent_py_data_rec.py`

**Deliverables:**
- `ChartIncompatibleModal.tsx` (NEW)
- `dfSlice.tsx` handler cho reject status
- `ChartRecBox.tsx` trigger modal
- `agent_py_data_rec.py` same pipeline as SQL agent

**Acceptance criteria:**
- Modal hiển thị đúng reason + suggestions
- "Apply suggestion" button hoạt động (auto-fill chart_type mới)
- Python agent parity với SQL agent

**Commit message:** `feat(ui): add chart incompatibility modal + python agent parity`

---

### Timeline tổng

| Milestone | Estimate | Người làm | Dependencies |
|---|---|---|---|
| M1 | 1 buổi | Bui Van Thanh | None |
| M2 | 1 ngày | Bui Van Thanh | M1 |
| M3 | 1 buổi | Bui Van Thanh | M1, M2 |
| M4 | 1 buổi | Bui Van Thanh | M3 |
| M5 | 1 ngày | Bui Van Thanh | M3, M4 |
| **Tổng** | **~3-4 ngày** | | |

Mỗi milestone là 1 PR/commit riêng biệt, có thể revert độc lập.

---

## 11. Rủi ro & Mitigation

### Rủi ro

| # | Rủi ro | Xác suất | Impact | Mitigation |
|---|---|---|---|---|
| R1 | False positive QC detection | Trung bình | Cao (data bán hàng bị treat như QC) | S1 upgrade với signature column requirement (đã chốt) |
| R2 | LLM vẫn không tuân thủ rule (sau slim prompt) | Trung bình | Trung bình | Post-validate ở backend chặn → R3-R7 reject |
| R3 | Performance: compute FieldMeta chậm | Thấp | Trung bình | Cache per-session, 1 DuckDB query gộp |
| R4 | Frontend chưa biết handle reject status | Cao | Cao | M5 phải sẵn sàng cùng lúc với M3 deploy |
| R5 | Snapshot test bị nhiễu do LLM stochastic | Cao | Thấp | Run 3 lần, lấy majority. Allow tolerance trong assertion |
| R6 | Breaking change cho user đang dùng | Trung bình | Cao | Feature flag `ENABLE_STRICT_CHART_VALIDATION=true/false` trong env |
| R7 | Existing charts trong saved sessions không tương thích | Thấp | Trung bình | Migration: existing charts giữ nguyên, chỉ áp validation cho chart mới |

### Feature flag (rollback strategy)

Add env var:
```env
ENABLE_STRICT_CHART_VALIDATION=true   # default: true
```

Nếu phát hiện regression sau deploy → set `false` → behavior cũ.

---

## 12. Quyết định đã chốt

| Q | Câu hỏi | Quyết định | Lý do |
|---|---|---|---|
| Q1 | Strict QC detection (cần signature column ngoài TARGET+limits)? | **Có** | Tránh false positive trên data bán hàng có cột "TARGET", "LL" |
| Q2 | INDEX trong generic mode? | **Không bao giờ default pick** | INDEX trong generic là technical artifact, không có semantic meaning |
| Q3 | Reject UX? | **Modal blocking** | "Thà không vẽ còn hơn vẽ rác" — user explicit chứ không silent fallback |

---

## 13. Quyết định kỹ thuật bổ sung

### Q4 — Tests location: `py-src/data_formulator/tests/`

**Chốt: Option A.**

```
py-src/data_formulator/
├── agents/
├── data_loader/
├── tests/                    ← tests ở ĐÂY
│   ├── __init__.py
│   ├── conftest.py
│   └── test_*.py
└── ...
```

**Lý do:**
- Path imports đơn giản: `from data_formulator.agents.field_metadata import FieldMeta`
- Tests đi cùng package được install (`pip install -e .`)
- Theo Python packaging convention (numpy, pandas, scikit-learn đều dùng pattern này)

**Để package không ship test code khi build wheel**, thêm vào `pyproject.toml`:

```toml
[tool.setuptools.packages.find]
where = ["py-src"]
exclude = ["data_formulator.tests*"]
```

### Q5 — Pytest qua optional dependencies group `dev`

**Chốt:** Pytest không phải runtime dep, đưa vào optional group.

**Thay đổi `pyproject.toml`:**

```toml
[project.optional-dependencies]
dev = [
    "pytest>=7.0",
    "pytest-mock>=3.10",
    "pytest-cov>=4.0",        # coverage report
]
```

**Cách install:**
```bash
pip install -e ".[dev]"
```

**Cách chạy test:**
```bash
# Chạy toàn bộ
pytest py-src/data_formulator/tests/

# Chạy 1 file
pytest py-src/data_formulator/tests/test_field_metadata.py -v

# Với coverage
pytest --cov=data_formulator.agents py-src/data_formulator/tests/
```

**Pytest config** — thêm vào `pyproject.toml`:

```toml
[tool.pytest.ini_options]
testpaths = ["py-src/data_formulator/tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
addopts = "-v --tb=short"
```

---

## 14. Phụ lục — Cấu trúc thư mục sau khi xong

```
data-formulator/
├── KEHOACH_SUA_CHART_RECOMMENDATION.md         (file này)
├── py-src/data_formulator/
│   ├── agents/
│   │   ├── field_metadata.py                   (NEW — M1)
│   │   ├── chart_compatibility.py              (NEW — M2)
│   │   ├── chart_defaults.py                   (NEW — M2)
│   │   ├── qc_chart_config.py                  (MODIFY — M3)
│   │   ├── agent_sql_data_rec.py               (MODIFY — M3, M4)
│   │   └── agent_py_data_rec.py                (MODIFY — M5)
│   ├── agent_routes.py                         (MODIFY — M3)
│   └── tests/                                  (NEW — M1)
│       ├── __init__.py
│       ├── conftest.py
│       ├── test_field_metadata.py              (M1)
│       ├── test_chart_defaults.py              (M2)
│       ├── test_chart_compatibility.py         (M2)
│       ├── test_qc_detection.py                (M3)
│       ├── test_pipeline_snapshot.py           (M4)
│       └── fixtures/                           (M1)
│           ├── qc_sample.csv
│           ├── sales_sample.csv
│           └── ...
├── src/
│   ├── components/
│   │   └── ChartIncompatibleModal.tsx          (NEW — M5)
│   ├── app/dfSlice.tsx                         (MODIFY — M5)
│   └── views/ChartRecBox.tsx                   (MODIFY — M5)
└── pyproject.toml                              (MODIFY — M1, add pytest)
```

---

## 15. Checklist trước khi merge

Mỗi PR phải qua checklist:

- [ ] Tests pass (unit + reject)
- [ ] Không break existing functionality
- [ ] Code review (self-review or peer)
- [ ] Manual test với 5 case thực tế trên UI
- [ ] Document update (nếu thay đổi API contract)
- [ ] Feature flag set đúng (default: true cho M3+)
- [ ] Snapshot baseline updated (nếu sửa prompt)

---

**Ghi chú cuối:**
- Plan này có thể được update khi có thông tin mới trong quá trình implement.
- Mọi thay đổi spec lớn cần update lại file này và note trong commit.
- Mỗi milestone hoàn thành sẽ tick vào section 10.
