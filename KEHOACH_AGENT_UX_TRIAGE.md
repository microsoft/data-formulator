# Kế Hoạch Thay Đổi Chiến Lược AI Agent — Triage UX

> **Tác giả:** Bui Van Thanh
> **Ngày tạo:** 2026-05-26 · **Cập nhật:** 2026-05-26 (v2)
> **Trạng thái:** Đã chốt spec lớn — sẵn sàng triển khai
> **Phạm vi:** Xóa Agent Mode + Modal đa năng + Drawable catalog ràng buộc ChartTemplates
> **Liên quan tới:** Chart Recommendation Pipeline (v0.5.2 — đã hoàn thành M1–M5)
> **File spec gốc trước đó:** [KEHOACH_SUA_CHART_RECOMMENDATION.md](KEHOACH_SUA_CHART_RECOMMENDATION.md)

---

## Tóm Tắt Quyết Định Quan Trọng (v2)

| # | Quyết định | Ghi chú |
|---|---|---|
| D1 | **Xóa hoàn toàn Agent Mode** — chỉ giữ Interactive với 1 ô chat duy nhất | Bỏ tab toggle, bỏ exploration_flow, bỏ agentRules |
| D2 | **Catalog chỉ chứa 25 chart types có trong [ChartTemplates.tsx](src/components/ChartTemplates.tsx)** | Không sinh chart type ngoài template |
| D3 | **Channel mỗi chart cố định theo template** — không thêm/bớt | Lấy nguyên `channels: [...]` từ template |
| D4 | **Bỏ "soft validation"** — strict validate cho mọi prompt, tôn trọng "thà không vẽ còn hơn vẽ rác" | Bỏ luôn force-draw button |
| D5 | **Sample prompt template-based** (không LLM) | Zero cost, đa ngôn ngữ |
| D6 | **Mỗi thumbnail 2 nút: "Vẽ ngay" + "💬 Dùng"** | Quick path vs Learning path |

---

## Mục Lục

1. [Bối Cảnh & Pain Points Thật Từ User](#1-bối-cảnh--pain-points-thật-từ-user)
2. [Phân Tích Nguyên Nhân Gốc Rễ](#2-phân-tích-nguyên-nhân-gốc-rễ)
3. [Triết Lý Thiết Kế Mới](#3-triết-lý-thiết-kế-mới)
4. [Phân Loại Prompt (4 categories)](#4-phân-loại-prompt-4-categories)
5. [Drawable Chart Catalog](#5-drawable-chart-catalog)
6. [Triage Pipeline Mới](#6-triage-pipeline-mới)
7. [UX Flow Chi Tiết Cho Từng Loại](#7-ux-flow-chi-tiết-cho-từng-loại)
8. [Backend Architecture](#8-backend-architecture)
9. [Frontend Architecture — Modal Redesign](#9-frontend-architecture--modal-redesign)
10. [Xóa Agent Mode (D1)](#10-xóa-agent-mode-d1)
11. [Ràng Buộc ChartTemplates (D2 + D3)](#11-ràng-buộc-charttemplates-d2--d3)
12. [Files Plan](#12-files-plan)
13. [Lộ Trình Triển Khai (Milestones)](#13-lộ-trình-triển-khai-milestones)
14. [Test Strategy](#14-test-strategy)
15. [Rủi Ro & Mitigation](#15-rủi-ro--mitigation)
16. [Phụ Lục — Danh Sách 25 ChartTemplate](#16-phụ-lục--danh-sách-25-charttemplate)

---

## 1. Bối Cảnh & Pain Points Thật Từ User

### 1.1 Quote từ user

> "User chưa biết phải viết gì cho đúng. Viết sai hoặc nội dung không liên quan đến biểu đồ thì bị chặn, viết không đủ thì vẽ ra biểu đồ không ứng ý, các channel thì truyền sai field, vô vàn vấn đề."

### 1.2 Pain points cụ thể (mapping theo user journey)

| # | Tình huống user | Hệ quả hiện tại (v0.5.2) | Cảm xúc user |
|---|---|---|---|
| P1 | User mới load data, không biết bắt đầu từ đâu | Không có gợi ý nào, ô chat trống | Bối rối, bỏ cuộc |
| P2 | User gõ "vẽ biểu đồ cho tôi" | Prompt Guard chặn vì mơ hồ | Tưởng tool hỏng |
| P3 | User gõ "biểu đồ doanh thu" (thiếu chart type, thiếu chiều) | Agent đoán bừa → biểu đồ sai channel | Mất niềm tin |
| P4 | User gõ "bar chart x=ITEMNAME y=VALUE" (đủ thông tin) nhưng ITEMNAME có 837 giá trị | Reject R3 → modal chỉ báo lỗi, không gợi ý gì hữu ích | Cảm thấy bị từ chối, không biết làm gì tiếp |
| P5 | User chat hỏi "doanh thu tháng nào cao nhất?" (analytical question, không phải chart request) | Bị chặn vì không phải chart prompt | Tưởng AI không hiểu |
| P6 | User load data QC, không biết cột TARGET/LL/UL có ý nghĩa đặc biệt | Không được gợi ý dùng QC charts | Bỏ qua tính năng giá trị nhất |

### 1.3 Mục tiêu sản phẩm

- **Không bao giờ để user "đứng hình"** sau khi gõ chat — luôn có hướng đi tiếp.
- **Tận dụng tối đa data đã load** — nếu data có 10 columns, user phải thấy được ít nhất 5 chart options có thể vẽ.
- **Tôn trọng intent rõ ràng** — nếu user gõ đủ thông tin, vẽ ngay không phỏng đoán lại.
- **Giáo dục từ từ** — qua từng tương tác, user học được cách diễn đạt yêu cầu hiệu quả hơn.

---

## 2. Phân Tích Nguyên Nhân Gốc Rễ

### 2.1 Pipeline hiện tại = Binary gate

Hiện tại (v0.5.2) chỉ có 2 outcome cho prompt:

```
prompt → PromptGuard → [PASS] → ChartRec pipeline → [valid] → vẽ
                                                  → [reject R1-R7] → modal blocking
                    → [BLOCK] → từ chối với reason
```

**Vấn đề:** không có "lối thoát" cho prompt mơ hồ. PromptGuard hoặc cho qua (rồi LLM đoán bừa), hoặc chặn (user bế tắc).

### 2.2 Modal hiện tại quá nghèo nàn

[`ChartIncompatibleModal.tsx`](src/components/ChartIncompatibleModal.tsx) hiện chỉ hiển thị:
- 1 dòng message_vi
- Bullet list "suggested_actions" (text)
- Vài button "Apply suggestion: <chart_type>" (chỉ chart type, không kèm encoding gợi ý)

**Thiếu:** danh sách chart **có thể vẽ ngay với data hiện tại** + preview encoding + 1-click vẽ thử.

### 2.3 Không có "intent classifier"

Không có layer nào trả lời câu hỏi: **prompt này thực sự muốn gì?** — vẽ chart cụ thể, hỏi gợi ý, hỏi data, hay chỉ tán gẫu.

→ Mọi prompt đều đi qua cùng một pipeline, dẫn tới đoán mò hoặc chặn nhầm.

---

## 3. Triết Lý Thiết Kế Mới

### TL1 — "Never dead-end the user"

Không có outcome nào để user phải gõ lại từ đầu. Mọi trả lời đều mở ra ≥ 1 action user có thể click tiếp.

### TL2 — "Respect explicit intent"

Nếu user gõ đủ rõ (chart type + fields hoặc công thức), **vẽ luôn** không qua bước phỏng đoán/gợi ý. Validate vẫn chạy nhưng chỉ chặn ở hard rule (R2 QC mismatch, R7 control limit in encoding).

### TL3 — "Assist when ambiguous, don't guess"

Khi prompt mơ hồ, **KHÔNG đoán bừa rồi tạo chart sai**. Thay vào đó mở UI hỗ trợ: gallery các chart có thể vẽ với data hiện tại + cho user chọn.

### TL4 — "Show, don't tell"

Thay vì text "Bar chart cần x là categorical", hiển thị **thumbnail mini-preview** của bar chart đã được fill encoding sẵn để user thấy ngay.

### TL5 — "Progressive disclosure"

Bắt đầu với suggestion đơn giản, expand chi tiết khi user cần (advanced encoding, formula custom).

### TL6 — "Tận dụng FieldMeta sẵn có"

Cơ sở của mọi gợi ý là FieldMeta đã compute từ M1 — không gọi thêm LLM cho việc gợi ý cơ bản.

---

## 4. Phân Loại Prompt (4 categories)

Layer mới `PromptClassifier` phân prompt thành 4 nhóm:

### 4.1 CONCRETE — Vẽ ngay

**Định nghĩa:** Prompt chứa đủ thông tin để dựng chart không cần phỏng đoán.

**Tín hiệu nhận biết:**
- Chứa **chart type** rõ ràng: "bar chart", "line chart", "histogram", "biểu đồ cột"…
- Chứa **field reference** cụ thể: "x là QCDATE", "trục Y = revenue", tên column khớp với data
- HOẶC chứa **công thức/SQL**: "SUM(revenue) GROUP BY month"
- HOẶC chứa **mô tả tính toán cụ thể**: "tổng doanh thu theo tháng", "trung bình value theo ca"

**Ví dụ:**
- "Vẽ bar chart x=QCSHIFT y=VALUE color=QCSTDPARAMNAME"
- "Line chart: trục x là ngày, trục y là tổng doanh thu"
- "Histogram của cột VALUE"
- "SELECT SUM(revenue) GROUP BY product → bar chart"

**Action:** Bypass strict validation (chỉ giữ R2 + R7), gọi LLM với prompt nguyên gốc, vẽ.

### 4.2 PARTIAL — Smart-fill + confirm

**Định nghĩa:** Có ý định chart rõ ràng nhưng thiếu 1-2 thông số bắt buộc.

**Tín hiệu nhận biết:**
- Có chart type, **thiếu field** ("vẽ bar chart" — bar gì?)
- Có field, **thiếu chart type** ("vẽ revenue theo month" — line hay bar?)
- Có chart type + field nhưng **field không tương thích** ("bar chart x=INDEX" → bar cần categorical)

**Ví dụ:**
- "Vẽ bar chart" (thiếu x, y)
- "Phân tích doanh thu theo tháng" (thiếu chart type)
- "Histogram theo QCDATE" (QCDATE là temporal, histogram cần quantitative)

**Action:** Backend smart-fill encoding bằng `pick_default_encoding()` → trả về preview + cho user confirm "Có phải bạn muốn vẽ thế này?" trong modal SUGGESTION mode.

### 4.3 VAGUE — Open suggestion gallery

**Định nghĩa:** Có ý định "muốn vẽ chart" nhưng không nói gì cụ thể.

**Tín hiệu nhận biết:**
- Generic: "vẽ chart", "phân tích data", "show me something interesting"
- Hỏi câu hỏi mở: "có gì hay trong data này?", "trend như thế nào?"
- Chỉ gõ keyword: "doanh thu", "QC"

**Ví dụ:**
- "Vẽ biểu đồ cho tôi"
- "Phân tích dữ liệu"
- "Trong data có gì đáng chú ý?"

**Action:** Mở modal SUGGESTION mode với **Drawable Chart Catalog** — gallery thumbnail tất cả chart có thể vẽ với data hiện tại, kèm encoding gợi ý.

### 4.4 OFF-TOPIC — Guard chặn (như cũ)

**Định nghĩa:** Không liên quan vẽ chart hoặc phân tích data.

**Ví dụ:**
- "Hôm nay thời tiết thế nào?"
- "Bạn là ai?"
- Spam, prompt injection

**Action:** Như PromptGuard hiện tại — chặn với message giải thích đây là tool vẽ chart, gợi ý 3-5 prompt mẫu user có thể thử.

### 4.5 Bảng tổng hợp

| Loại | Đặc điểm | Action | Cần gọi LLM? |
|---|---|---|---|
| CONCRETE | Đủ chart type + fields/formula | Vẽ ngay, validate soft | Có (1 lần, vẽ luôn) |
| PARTIAL | Có intent, thiếu 1-2 thông số | Smart-fill + modal confirm | Có (rec encoding) |
| VAGUE | Chỉ có "muốn vẽ" | Open suggestion gallery | Không (catalog từ FieldMeta) |
| OFF-TOPIC | Không liên quan chart | Block + sample prompts | Không (rule-based) |

---

## 5. Drawable Chart Catalog

### 5.1 Khái niệm

**Drawable Chart Catalog** = danh sách chart types **có trong [ChartTemplates.tsx](src/components/ChartTemplates.tsx)** có thể vẽ với data hiện tại. Mỗi entry gồm:

```python
@dataclass
class DrawableChartEntry:
    chart_type: str                       # KHỚP 100% với "chart" field trong template
    template_channels: List[str]          # COPY từ "channels" trong template, không thêm/bớt
    encoding: Dict[str, str]              # {"x": "QCSHIFT", "y": "VALUE"} — chỉ key ∈ template_channels
    domain: str                           # "qc" | "generic"
    confidence: float                     # 0.0-1.0 — chart phù hợp data ra sao
    rationale_vi: str                     # "Bar chart vì QCSHIFT có 3 giá trị (low cardinality)"
    preview_spec: Optional[dict]          # Vega-Lite spec mini (cho thumbnail)
    sample_prompt_vi: str                 # "Vẽ bar chart so sánh value theo ca"
```

**Quan trọng (D2 + D3):**
- `chart_type` phải nằm trong danh sách 25 templates (xem [Section 16](#16-phụ-lục--danh-sách-25-charttemplate))
- `encoding.keys()` luôn ⊆ `template_channels` — không bao giờ encode channel ngoài template
- Channel `required` của template = phải có trong encoding (validate strict)
- Channel `optional` của template = có thể bỏ trống

### 5.2 Cách tính catalog

Pure function dựa trên FieldMeta + CHART_TEMPLATES (mirror từ frontend) + CHART_REQUIREMENTS, **không cần LLM**:

```python
# py-src/data_formulator/agents/chart_template_registry.py (NEW)
# Mirror cứng từ src/components/ChartTemplates.tsx — sync bằng codegen hoặc manual
CHART_TEMPLATES: Dict[str, ChartTemplate] = {
    "Bar Chart":  ChartTemplate(channels=["x","y","color","opacity","column","row"], required=["x","y"]),
    "Line Chart": ChartTemplate(channels=["x","y","color","column","row"], required=["x","y"]),
    "Histogram":  ChartTemplate(channels=["x","y","color","column","row"], required=["x"]),
    # ... 25 entries total
}

def build_drawable_catalog(
    field_metas: Dict[str, FieldMeta],
    domain: str,
) -> List[DrawableChartEntry]:
    catalog = []
    # CHỈ duyệt chart types có trong CHART_TEMPLATES
    for chart_type, template in CHART_TEMPLATES.items():
        if chart_type in {"Auto", "Table"}:
            continue  # special types, không vào catalog
        spec = CHART_REQUIREMENTS.get(chart_type)
        if not spec or domain not in spec.domain:
            continue
        # pick_default_encoding TRẢ VỀ ENCODING CHỈ DÙNG template.channels
        encoding = pick_default_encoding(chart_type, field_metas, domain,
                                          allowed_channels=template.channels,
                                          required_channels=template.required)
        if encoding is None:
            continue  # Không đủ field cho required channels → skip
        validation = validate_chart(chart_type, encoding, field_metas, domain)
        if not validation.is_valid:
            continue
        catalog.append(DrawableChartEntry(
            chart_type=chart_type,
            template_channels=template.channels,
            encoding=encoding,
            domain=domain,
            confidence=_compute_confidence(chart_type, encoding, field_metas),
            rationale_vi=_explain_choice(chart_type, encoding, field_metas),
            preview_spec=_build_vl_preview(chart_type, encoding, field_metas),
            sample_prompt_vi=_generate_sample_prompt(chart_type, encoding),
        ))
    return sorted(catalog, key=lambda x: -x.confidence)
```

**Sample prompt template-based (D5):**

```python
SAMPLE_PROMPT_TEMPLATES_VI = {
    "Bar Chart":         "Vẽ bar chart so sánh {y} theo {x}",
    "Line Chart":        "Vẽ line chart {y} theo {x}",
    "Histogram":         "Phân bố giá trị {x}",
    "Heat Map":          "Heatmap {x} × {y} với màu {color}",
    "Scatter Plot":      "Vẽ scatter {y} theo {x}",
    "Pie Chart":         "Vẽ pie chart tỉ trọng {theta} theo {color}",
    "QC Trend Line":     "Vẽ QC trend line VALUE theo QCDATE / QCSHIFT",
    "QC Histogram":      "QC histogram phân bố VALUE",
    "QC Trend Bar":      "QC trend bar VALUE theo QCDATE",
    # ... 25 entries total
}

def _generate_sample_prompt(chart_type: str, encoding: Dict[str, str]) -> str:
    template = SAMPLE_PROMPT_TEMPLATES_VI[chart_type]
    return template.format(**encoding)
```

### 5.3 Cache strategy

- Cache catalog **per (session_id, table_id)** — invalidate khi data đổi.
- Compute lazy: chỉ build khi user mở modal lần đầu hoặc đổi table.
- TTL: theo session, không persist DB.

### 5.4 Preview thumbnail

- Mini Vega-Lite spec render bằng `react-vega` ở client (chỉ 50 sample rows, kích thước 120×80px).
- Tối ưu: backend không trả full data — frontend dùng `tableRef` đã load sẵn trong Redux.

### 5.5 Confidence scoring

```python
def _compute_confidence(chart_type, encoding, field_metas) -> float:
    score = 1.0
    # Bonus: temporal x cho time-series chart
    if chart_type in ["line", "area"] and field_metas[encoding["x"]].is_temporal:
        score *= 1.2
    # Penalty: y cardinality quá cao cho bar
    if chart_type == "bar" and field_metas[encoding["x"]].cardinality > 50:
        score *= 0.6
    # QC bonus: QC chart trong QC domain
    if chart_type.startswith("qc_"):
        score *= 1.3
    return min(score, 1.0)
```

---

## 6. Triage Pipeline Mới

### 6.1 Sequence diagram

```
User prompt
    ↓
[Layer 0] PromptClassifier (LLM lightweight call)
    ↓
    ├── OFF-TOPIC → PromptGuard reject + 5 sample prompts
    │
    ├── VAGUE → Build Drawable Catalog (no LLM)
    │           → Open Modal SUGGESTION_MODE
    │
    ├── PARTIAL → pick_default_encoding for inferred chart type
    │             → Open Modal CONFIRM_MODE (preview + edit + draw)
    │
    └── CONCRETE → Skip ChartRec validation strict
                   → Direct call SQL/Py DataRec Agent
                   → Soft validate (chỉ R2 + R7)
                   → Vẽ ngay
                   → Nếu fail validate → fallback Modal CONFIRM_MODE
```

### 6.2 Cấu trúc Classifier response

```json
{
  "category": "CONCRETE | PARTIAL | VAGUE | OFF_TOPIC",
  "confidence": 0.85,
  "detected_chart_type": "bar",          // null nếu không detect
  "detected_fields": ["QCSHIFT", "VALUE"],
  "detected_formula": null,
  "missing_info": [],                     // ["chart_type"] hoặc ["x_channel"]
  "user_intent_vi": "User muốn vẽ bar chart so sánh VALUE theo QCSHIFT"
}
```

### 6.3 Khi nào dùng LLM, khi nào không

| Bước | LLM? | Lý do |
|---|---|---|
| Classifier | **Có** (lightweight model, ~150 tokens) | Cần hiểu ngữ nghĩa đa ngôn ngữ |
| Drawable catalog | **Không** | Pure function từ FieldMeta + CHART_REQUIREMENTS |
| Smart-fill encoding (PARTIAL) | Tùy chọn | Có thể dùng `pick_default_encoding()` thuần; LLM chỉ khi muốn chất lượng cao |
| Vẽ chart (CONCRETE) | **Có** | Như hiện tại |
| Reject suggestion (sau fail validate) | **Không** | Lấy top-N từ catalog |

### 6.4 Cost analysis

- Mỗi user prompt: **+1 LLM call lightweight** (~150 tokens output, ~500 tokens input) cho Classifier.
- Với 1000 prompts/ngày → ~$0.10/ngày extra ở model gpt-4o-mini.
- Tiết kiệm lại: VAGUE prompts hiện tại đi qua full DataRec pipeline (~3000 tokens) → bây giờ skip LLM cho catalog → tiết kiệm ~70%.

→ **Net cost giảm.**

---

## 7. UX Flow Chi Tiết Cho Từng Loại

### 7.1 CONCRETE flow

```
User: "Vẽ bar chart x=QCSHIFT y=VALUE color=QCSTDPARAMNAME"
   ↓
[Classifier] → CONCRETE, confidence=0.95
   ↓
[Backend] gọi thẳng SQLDataRecAgent với hint:
   - chart_type = "bar"
   - encoding = {x: QCSHIFT, y: VALUE, color: QCSTDPARAMNAME}
   - validation_mode = "soft"  ← chỉ check R2 + R7
   ↓
[LLM] sinh SQL → execute → trả chart
   ↓
Frontend hiển thị chart ngay, không có modal
```

**Edge case:** Nếu CONCRETE nhưng validate fail (vd field user chỉ định bị R3 cardinality explosion):
- **KHÔNG vẽ chart sai** (D4 — "thà không vẽ còn hơn vẽ rác")
- Mở Modal REJECT_MODE với message: "Bar chart không vẽ được với QCSHIFT 837 giá trị. Đây là các chart có thể vẽ:"
  - Grid 4 alternatives từ catalog (treemap, top-20 bar, line theo thời gian, heatmap)
  - Mỗi alternative có 2 nút: **[Vẽ ngay]** (quick) + **[💬 Dùng prompt]** (fill chat)
  - **KHÔNG có force-draw button** (D4)

### 7.2 PARTIAL flow

```
User: "Phân tích doanh thu theo tháng"
   ↓
[Classifier] → PARTIAL, detected_fields=["month", "revenue"], missing=["chart_type"]
   ↓
[Backend] smart-fill:
   - pick_default_encoding(chart_type=?, hint_fields=[month, revenue])
   - Trả 3 candidates: line / bar / area (rank by confidence)
   ↓
Modal CONFIRM_MODE hiển thị:
   ┌──────────────────────────────────────────────┐
   │  AI đề xuất 3 cách vẽ — chọn 1 hoặc đổi:    │
   │                                              │
   │  [Thumbnail Line]   [Thumbnail Bar]          │
   │  Line chart         Bar chart                │
   │  x=month y=revenue  x=month y=revenue        │
   │  ★★★★★               ★★★★☆                    │
   │  [Vẽ]               [Vẽ]                     │
   │                                              │
   │  [Tùy chỉnh nâng cao ▼]                     │
   └──────────────────────────────────────────────┘
```

### 7.3 VAGUE flow

```
User: "Vẽ chart đi"
   ↓
[Classifier] → VAGUE
   ↓
[Backend] build_drawable_catalog(field_metas, domain) — KHÔNG gọi LLM
   ↓
Modal SUGGESTION_MODE hiển thị grid 6-12 chart suggestions:
   ┌─────────────────────────────────────────────────┐
   │  Dựa trên data của bạn, đây là các gợi ý:      │
   │                                                 │
   │  [Bar]      [Line]     [Histogram]              │
   │  So sánh    Trend      Phân bố                  │
   │  VALUE/ca   theo ngày  VALUE                    │
   │  [Vẽ]       [Vẽ]       [Vẽ]                    │
   │                                                 │
   │  [QC Trend] [Heatmap]  [Pie]                    │
   │  ...                                            │
   │                                                 │
   │  🔍 Hoặc gõ chi tiết hơn:                       │
   │  "Vẽ bar chart x=QCSHIFT y=VALUE"               │
   └─────────────────────────────────────────────────┘
```

### 7.4 OFF-TOPIC flow

```
User: "Hôm nay trời thế nào?"
   ↓
[Classifier] → OFF_TOPIC
   ↓
Modal INFO_MODE:
   ┌────────────────────────────────────────────┐
   │  ⓘ Đây là công cụ vẽ biểu đồ từ data.     │
   │                                            │
   │  Thử các câu hỏi như:                      │
   │  • "Vẽ bar chart doanh thu theo tháng"     │
   │  • "Phân bố giá trị VALUE"                 │
   │  • "Trend theo ca sản xuất"                │
   │                                            │
   │  Hoặc click 1 trong các gợi ý dưới đây:    │
   │  [Bar chart] [Line chart] [Histogram]      │
   └────────────────────────────────────────────┘
```

---

## 8. Backend Architecture

### 8.1 Module mới

#### `prompt_classifier.py` (NEW)

```python
class PromptClassifier:
    def __init__(self, client, model="gpt-4o-mini"):
        self.client = client
        self.model = model

    def classify(
        self,
        prompt: str,
        available_columns: List[str],
        field_metas: Dict[str, FieldMeta],
        domain: str,
    ) -> ClassifierResult:
        """Returns category + extracted hints."""
        ...
```

**Prompt template (cho classifier):**

```
You are a chart prompt classifier. Given a user prompt and the available data columns,
classify the prompt into ONE of: CONCRETE, PARTIAL, VAGUE, OFF_TOPIC.

CONCRETE: User specified chart type AND fields, or provided a formula.
PARTIAL:  User has chart intent but missing chart_type OR field.
VAGUE:    User wants a chart but no specifics.
OFF_TOPIC: Not related to charts/data.

Available columns: {columns}
User prompt: {prompt}

Return JSON only:
{
  "category": "...",
  "confidence": 0.0-1.0,
  "detected_chart_type": "..." | null,
  "detected_fields": [...],
  "missing_info": [...],
  "user_intent_vi": "..."
}
```

#### `drawable_catalog.py` (NEW)

```python
@dataclass
class DrawableChartEntry:
    chart_type: str
    encoding: Dict[str, str]
    domain: str
    confidence: float
    rationale_vi: str
    preview_spec: Optional[dict]
    sample_prompt_vi: str


def build_drawable_catalog(
    field_metas: Dict[str, FieldMeta],
    domain: str,
    top_k: int = 12,
) -> List[DrawableChartEntry]:
    ...


def get_top_alternatives_for_reject(
    field_metas: Dict[str, FieldMeta],
    domain: str,
    failed_chart_type: str,
    top_k: int = 4,
) -> List[DrawableChartEntry]:
    """For modal REJECT_MODE — exclude the failed chart type."""
    ...
```

### 8.2 Module modify

#### `agent_routes.py`

**New endpoint:**

```python
@bp.route("/api/agent/classify-prompt", methods=["POST"])
def classify_prompt():
    """Layer 0 classifier — runs before main agent."""
    ...
```

**Modify existing `/derive-data`:**

- Thêm param `prompt_category` (FE truyền sau khi classify)
- Nếu `prompt_category == CONCRETE` → `validation_mode = "soft"` (chỉ R2 + R7)
- Nếu fail validate → response thêm field `drawable_alternatives: [...]` (top 4 từ catalog)

#### `agent_sql_data_rec.py` + `agent_py_data_rec.py`

- Thêm `validation_mode: Literal["strict", "soft"]` param
- `soft` mode chỉ check R2 + R7 (hard-block rules), skip R3 (cardinality) + R6 (channel mismatch)
- Khi reject, attach `drawable_alternatives` từ catalog

#### `chart_compatibility.py`

- Tách `validate_chart()` thành 2 hàm:
  - `validate_chart_strict()` — như hiện tại, check R1-R7
  - `validate_chart_soft()` — chỉ R2 + R7 (hard block)
- Hoặc thêm param `mode: Literal["strict", "soft"]`

### 8.3 Workflow Backend

```
POST /api/agent/classify-prompt
   → ClassifierResult
   ↓
Frontend route theo category:
   - VAGUE  → POST /api/agent/get-drawable-catalog
   - PARTIAL → POST /api/agent/get-partial-suggestions (smart-fill)
   - CONCRETE → POST /api/agent/derive-data (validation_mode=soft)
   - OFF_TOPIC → Frontend hiển thị info modal local (không gọi backend)
```

**Alternative:** Gộp tất cả vào 1 endpoint `POST /api/agent/smart-chat` để giảm round-trip — backend tự classify + route. Trade-off: ít linh hoạt frontend hơn.

→ **Đề xuất:** Đi theo phương án 1 endpoint `/smart-chat` để UX mượt hơn (1 request = 1 response).

### 8.4 Response contract `/smart-chat`

```json
{
  "category": "VAGUE | PARTIAL | CONCRETE | OFF_TOPIC",
  "action": "render_chart | open_suggestion_modal | open_confirm_modal | open_info_modal",
  "chart": {                                // chỉ khi action=render_chart
    "chart_type": "bar",
    "encoding": {...},
    "code": "SELECT ...",
    "data": [...]
  },
  "suggestions": [                           // catalog cho VAGUE / PARTIAL / fail
    {
      "chart_type": "bar",
      "encoding": {...},
      "preview_spec": {...},
      "rationale_vi": "...",
      "confidence": 0.9
    },
    ...
  ],
  "message_vi": "...",                       // cho INFO modal
  "sample_prompts_vi": [...],                // cho OFF_TOPIC
  "classifier_result": {...}                 // debug info
}
```

---

## 9. Frontend Architecture — Modal Redesign

### 9.1 Single component, 4 modes

Refactor `ChartIncompatibleModal.tsx` → `ChartAssistantModal.tsx` với 4 modes:

```tsx
type ModalMode = "REJECT" | "SUGGESTION" | "CONFIRM" | "INFO";

interface ChartAssistantModalProps {
  open: boolean;
  mode: ModalMode;
  suggestions: DrawableChartEntry[];
  rejectInfo?: ChartRejectInfo;
  partialContext?: { intent: string; missing: string[] };
  samplePrompts?: string[];
  onClose: () => void;
  onPickSuggestion: (entry: DrawableChartEntry) => void;
  onForceDraw?: () => void;
}
```

### 9.2 Mode-specific layouts

#### REJECT mode (sau khi fail validate)

```
┌──────────────────────────────────────────────────────┐
│  ⚠ Không thể vẽ <chart_type> với data hiện tại     │
│  Lý do: <message_vi>                                 │
│                                                      │
│  ─── Đây là các biểu đồ có thể vẽ với data này: ─── │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ [thumb]  │  │ [thumb]  │  │ [thumb]  │           │
│  │ Bar      │  │ Line     │  │ Histogram│           │
│  │ "Vẽ bar  │  │ "Vẽ line │  │ "Phân bố │           │
│  │  x=SHIFT │  │  VALUE   │  │  VALUE"  │           │
│  │  y=VALUE"│  │  theo    │  │          │           │
│  │          │  │  QCDATE" │  │          │           │
│  │[Vẽ][💬] │  │[Vẽ][💬] │  │[Vẽ][💬] │           │
│  └──────────┘  └──────────┘  └──────────┘           │
│                                                      │
│  [Xem thêm gợi ý ▼]                          [Đóng] │
└──────────────────────────────────────────────────────┘
```

**Không có force-draw button (D4).** Mọi chart vẽ ra đều phải qua validate strict — đảm bảo "thà không vẽ còn hơn vẽ rác".

- **[Vẽ]** = quick path: skip LLM, gọi thẳng SQL transform từ encoding đã có trong entry
- **[💬]** = learning path: fill `sample_prompt_vi` vào chat box (user xem rồi tự submit, có thể sửa)

#### SUGGESTION mode (VAGUE)

```
┌─────────────────────────────────────────────────┐
│  💡 Gợi ý dựa trên data của bạn                 │
│                                                 │
│  [Grid 3x4 thumbnails — top 12 drawable]        │
│                                                 │
│  📝 Hoặc gõ chi tiết: ___________________  Gửi  │
└─────────────────────────────────────────────────┘
```

#### CONFIRM mode (PARTIAL)

```
┌─────────────────────────────────────────────────┐
│  AI hiểu ý bạn: "<user_intent_vi>"              │
│  Chọn 1 trong các cách vẽ:                     │
│                                                 │
│  [Thumb Line]    [Thumb Bar]   [Thumb Area]     │
│  ★★★★★            ★★★★☆        ★★★☆☆              │
│  [Vẽ]            [Vẽ]          [Vẽ]            │
│                                                 │
│  [Tùy chỉnh nâng cao ▼]                        │
│  [Đóng]                                         │
└─────────────────────────────────────────────────┘
```

#### INFO mode (OFF_TOPIC)

```
┌─────────────────────────────────────────────────┐
│  ⓘ Tôi là công cụ vẽ chart từ data            │
│  Thử các prompt như:                           │
│  • "..."                                       │
│  • "..."                                       │
│                                                 │
│  Hoặc click luôn 1 chart gợi ý:                │
│  [Thumb1] [Thumb2] [Thumb3]                     │
└─────────────────────────────────────────────────┘
```

### 9.3 Thumbnail component

```tsx
const ChartThumbnail: FC<{ entry: DrawableChartEntry; tableRef: string }> = ({ entry, tableRef }) => {
  const table = useSelector(selectTable(tableRef));
  const sampleData = table.rows.slice(0, 50);

  return (
    <Box sx={{ width: 140, cursor: "pointer" }} onClick={...}>
      <VegaLite spec={entry.preview_spec} data={{ values: sampleData }} />
      <Typography fontSize={12}>{entry.chart_type}</Typography>
      <Typography fontSize={11} color="text.secondary">
        {entry.rationale_vi}
      </Typography>
    </Box>
  );
};
```

### 9.4 Redux state

Thêm vào `dfSlice.tsx`:

```typescript
interface DfState {
  // ... existing
  chartAssistant: {
    open: boolean;
    mode: ModalMode;
    suggestions: DrawableChartEntry[];
    rejectInfo?: ChartRejectInfo;
    partialContext?: PartialContext;
    samplePrompts?: string[];
  };
}
```

Action creators:
- `openAssistantSuggestion(entries)`
- `openAssistantConfirm(intent, candidates)`
- `openAssistantReject(rejectInfo, alternatives)`
- `openAssistantInfo(samplePrompts, fallbackCatalog)`
- `closeAssistant()`

---

## 10. Xóa Agent Mode (D1)

### 10.1 Hiện trạng cần xóa

**Frontend:**
| File | Cần xóa/sửa |
|---|---|
| [src/views/ChartRecBox.tsx](src/views/ChartRecBox.tsx) | Bỏ `useState<"agent" \| "interactive">`, bỏ ToggleButton mode (line 1976-2007), bỏ branch `if (mode === "agent")` (line 705-1995). Giữ duy nhất Interactive logic. |
| [src/views/AgentRulesDialog.tsx](src/views/AgentRulesDialog.tsx) | **XÓA HẲN** file (dialog tùy chỉnh agent rules) |
| [src/app/dfSlice.tsx](src/app/dfSlice.tsx) | Bỏ state `agentRules: { exploration, coding }` + actions liên quan |
| [src/app/utils.tsx](src/app/utils.tsx) | Bỏ constant `EXPLORE_DATA_STREAMING: '/api/agent/explore-data-streaming'` |
| [src/views/About.tsx](src/views/About.tsx) | Bỏ video reference `feature-agent-mode.mp4` |
| `public/feature-agent-mode.mp4` | **XÓA file asset** (nếu có) |

**Backend:**
| File | Cần xóa/sửa |
|---|---|
| [py-src/data_formulator/workflows/exploration_flow.py](py-src/data_formulator/workflows/exploration_flow.py) | **XÓA HẲN** file |
| [py-src/data_formulator/agents/agent_exploration.py](py-src/data_formulator/agents/agent_exploration.py) | **XÓA HẲN** file |
| [py-src/data_formulator/agent_routes.py](py-src/data_formulator/agent_routes.py) | Xóa endpoint `/explore-data-streaming` + handler |
| `prompt_guard_agent.py` | Bỏ check `prompt_source == "agent"` — giờ chỉ còn 1 source |

### 10.2 Backward compat

- Saved sessions có `chart.source = "agent"` → migrate thành `"interactive"` ở load time
- Chart đã vẽ trong Redux store → giữ nguyên, không re-render
- Endpoint `/explore-data-streaming` → trả 410 Gone trong 1 sprint, sau đó delete

### 10.3 Acceptance

- UI chỉ còn 1 ô chat duy nhất trong [ChartRecBox.tsx](src/views/ChartRecBox.tsx)
- Code search `grep -ri "agent.mode\|exploration_flow\|AgentRulesDialog"` không còn kết quả (trừ comment lịch sử)
- Existing data analysis features vẫn hoạt động bình thường

---

## 11. Ràng Buộc ChartTemplates (D2 + D3)

### 11.1 Nguyên tắc

> **AI tuyệt đối không sinh chart type ngoài 25 templates, và không bao giờ encode channel ngoài template.**

### 11.2 Frontend là nguồn sự thật (source of truth)

[ChartTemplates.tsx](src/components/ChartTemplates.tsx) đã định nghĩa sẵn 25 templates với `channels: [...]` cố định. Backend phải **mirror** danh sách này để validate.

### 11.3 Cách sync frontend ↔ backend

**Option A — Codegen (đề xuất):**
- Script `scripts/sync_chart_templates.py` parse ChartTemplates.tsx → sinh `chart_template_registry.py`
- Chạy thủ công khi thêm template mới
- CI check: nếu hash khác → fail build

**Option B — Manual sync với guard test:**
- Backend hardcode dict `CHART_TEMPLATES`
- Test snapshot so sánh với ChartTemplates.tsx (regex extract)
- Fail nếu lệch

**Đề xuất:** Option B trước (đơn giản), Option A nếu thêm template thường xuyên.

### 11.4 Required channels per template

ChartTemplates.tsx chỉ định nghĩa `channels: []` (full list cho phép). **Required subset** cần khai báo riêng ở backend:

```python
@dataclass
class ChartTemplate:
    name: str                  # "Bar Chart"
    channels: List[str]        # mirror từ ChartTemplates.tsx — full set
    required: List[str]        # subset của channels — phải có
    semantic_check: Optional[callable] = None  # vd Pie cần label categorical_low
```

| Chart Template | channels (template) | required (backend) |
|---|---|---|
| Bar Chart | x, y, color, opacity, column, row | **x, y** |
| Line Chart | x, y, color, column, row | **x, y** |
| Histogram | x, y, color, column, row | **x** (y = auto count) |
| Pie Chart | theta, color, text, column, row | **theta, color** |
| Heat Map | x, y, color, column, row | **x, y, color** |
| QC Trend Line | QCDATE, QCSHIFT, INDEX, VALUE, color | **QCDATE, INDEX, VALUE** |
| Scatter Plot | x, y, color, size, opacity, column, row | **x, y** |
| Bubble Plot | x, y, size, color | **x, y, size** |
| Threshold Bar Chart | x, y, threshold | **x, y, threshold** |
| Waterfall | x, y | **x, y** |
| Radial Plot | theta, color | **theta** |
| Ranged Dot Plot | x, y, color | **x, y** |
| Pyramid Chart | x, y, color | **x, y** |
| Area Chart | x, y, x2, y2, color, column, row | **x, y** |
| Grouped Bar / Stacked Bar / Boxplot / Linear Reg / Loess Reg / Rolling Avg / Dotted Line | (xem template) | **x, y** |
| QC Histogram | VALUE, INDEX, color | **VALUE, INDEX** |
| QC Trend Bar | QCDATE, QCSHIFT, VALUE | **QCDATE, VALUE** |

### 11.5 Validate enforcement (backend)

Khi AI/Classifier trả về `chart_type` + `encoding`:

```python
def validate_against_template(chart_type: str, encoding: Dict[str, str]) -> ValidationResult:
    template = CHART_TEMPLATES.get(chart_type)
    if not template:
        return reject(R8_chart_not_in_template, suggested=top_alternatives_from_catalog())

    # D3: encoding chỉ được dùng channel có trong template
    extra_channels = set(encoding.keys()) - set(template.channels)
    if extra_channels:
        return reject(R9_channel_not_in_template,
                      context=f"Channels {extra_channels} không có trong template {chart_type}")

    # required check
    missing = set(template.required) - set(encoding.keys())
    if missing:
        return reject(R4_wrong_dimensionality,
                      context=f"Thiếu channel bắt buộc: {missing}")

    return validate_chart_against_field_meta(chart_type, encoding, field_metas, domain)
```

### 11.6 Reject codes mới (mở rộng R1–R7)

| Code | Tên ngắn | Trigger |
|---|---|---|
| **R8** | `chart_not_in_template` | LLM trả về chart_type không có trong 25 templates |
| **R9** | `channel_not_in_template` | LLM trả encoding với channel ngoài `template.channels` |

→ Khi LLM gặp R8/R9, **tự động map** sang chart gần nhất có trong template (vd "donut" → "Pie Chart"), không trả lỗi cho user.

### 11.7 Prompt LLM thay đổi

System prompt cho SQL/Py DataRec Agent thêm constraint:

```
HARD CONSTRAINT: chart_type MUST be one of:
["Scatter Plot", "Linear Regression", "Loess Regression", "Ranged Dot Plot",
 "Boxplot", "Bar Chart", "Pyramid Chart", "Grouped Bar Chart", "Stacked Bar Chart",
 "Histogram", "Threshold Bar Chart", "Line Chart", "Dotted Line Chart",
 "Rolling Average", "Heat Map", "Pie Chart", "Radial Plot", "Bubble Plot",
 "Area Chart", "Waterfall", "QC Trend Line", "QC Histogram", "QC Trend Bar"]

Each chart has FIXED channels. You MUST use exactly the channels listed below
for that chart, no more no less:
- Bar Chart: x, y, color (opt), opacity (opt), column (opt), row (opt)
- Line Chart: x, y, color (opt), column (opt), row (opt)
- ... (full list)
```

---

## 12. Files Plan

### 12.1 Backend (Python)

| # | File | Action | Mô tả |
|---|---|---|---|
| 1 | `py-src/data_formulator/agents/chart_template_registry.py` | **NEW** | `CHART_TEMPLATES` dict (25 entries mirror frontend) + `ChartTemplate` dataclass + required/optional channels |
| 2 | `py-src/data_formulator/agents/prompt_classifier.py` | **NEW** | `PromptClassifier` + `ClassifierResult` dataclass |
| 3 | `py-src/data_formulator/agents/drawable_catalog.py` | **NEW** | `DrawableChartEntry` + `build_drawable_catalog()` + `get_top_alternatives_for_reject()` |
| 4 | `py-src/data_formulator/agents/sample_prompts.py` | **NEW** | `SAMPLE_PROMPT_TEMPLATES_VI` + `_generate_sample_prompt()` |
| 5 | `py-src/data_formulator/agents/chart_compatibility.py` | **MODIFY** | Thêm R8 (chart_not_in_template) + R9 (channel_not_in_template). Bỏ ý tưởng soft mode (D4) |
| 6 | `py-src/data_formulator/agents/chart_defaults.py` | **MODIFY** | `pick_default_encoding()` nhận thêm `allowed_channels` + `required_channels` từ template |
| 7 | `py-src/data_formulator/agents/agent_sql_data_rec.py` | **MODIFY** | Inject HARD CONSTRAINT vào system prompt (25 chart types + channel list). Attach `drawable_alternatives` khi reject |
| 8 | `py-src/data_formulator/agents/agent_py_data_rec.py` | **MODIFY** | Parity với SQL agent |
| 9 | `py-src/data_formulator/agents/prompt_guard_agent.py` | **MODIFY** | Bỏ check `prompt_source == "agent"` (D1). Trả về `OFF_TOPIC` flag cho classifier consume |
| 10 | `py-src/data_formulator/agent_routes.py` | **MODIFY** | (a) Endpoint mới `/smart-chat`. (b) Xóa `/explore-data-streaming` (D1) |
| 11 | `py-src/data_formulator/agents/preview_spec_builder.py` | **NEW** (optional) | Build mini Vega-Lite spec cho thumbnail |
| 12 | `py-src/data_formulator/workflows/exploration_flow.py` | **DELETE** | D1 — agent mode bị xóa |
| 13 | `py-src/data_formulator/agents/agent_exploration.py` | **DELETE** | D1 — agent mode bị xóa |

### 12.2 Frontend (TypeScript/React)

| # | File | Action | Mô tả |
|---|---|---|---|
| 14 | `src/components/ChartAssistantModal.tsx` | **NEW** (replace `ChartIncompatibleModal.tsx`) | Modal 4 modes (REJECT/SUGGESTION/CONFIRM/INFO) |
| 15 | `src/components/ChartThumbnail.tsx` | **NEW** | Vega-Lite mini preview + 2 nút "Vẽ ngay" / "💬 Dùng" (D6) |
| 16 | `src/components/SuggestionGrid.tsx` | **NEW** | Layout grid thumbnails responsive |
| 17 | `src/app/dfSlice.tsx` | **MODIFY** | (a) State `chartAssistant` + actions. (b) Bỏ state `agentRules` (D1) |
| 18 | `src/app/utils.tsx` | **MODIFY** | (a) Helper gọi `/smart-chat`. (b) Bỏ `EXPLORE_DATA_STREAMING` constant (D1) |
| 19 | `src/views/ChatbotPanel.tsx` | **MODIFY** | Thay flow gọi `/derive-data` bằng `/smart-chat` |
| 20 | `src/views/ChartRecBox.tsx` | **MAJOR REWRITE** | Bỏ ToggleButton mode + branch agent (lines 705-1995). Chỉ giữ Interactive flow. Hook vào modal mới |
| 21 | `src/components/ChartIncompatibleModal.tsx` | **DELETE** | Thay bằng `ChartAssistantModal.tsx` |
| 22 | `src/views/AgentRulesDialog.tsx` | **DELETE** | D1 — agent mode bị xóa |
| 23 | `src/views/About.tsx` | **MODIFY** | Bỏ video reference `feature-agent-mode.mp4` (D1) |
| 24 | `public/feature-agent-mode.mp4` | **DELETE** | D1 (nếu file tồn tại) |

### 12.3 Tests

| # | File | Action | Mô tả |
|---|---|---|---|
| 25 | `py-src/data_formulator/tests/test_chart_template_registry.py` | **NEW** | 10 cases — sync với frontend, 25 templates đầy đủ |
| 26 | `py-src/data_formulator/tests/test_prompt_classifier.py` | **NEW** | 30 cases — classify đúng 4 categories |
| 27 | `py-src/data_formulator/tests/test_drawable_catalog.py` | **NEW** | 25 cases — catalog đầy đủ + đúng confidence + chỉ 25 templates |
| 28 | `py-src/data_formulator/tests/test_sample_prompts.py` | **NEW** | 25 cases — mỗi template có sample prompt hợp lệ |
| 29 | `py-src/data_formulator/tests/test_smart_chat_endpoint.py` | **NEW** | 15 integration cases |
| 30 | `py-src/data_formulator/tests/test_agent_mode_removed.py` | **NEW** | Guard test — không còn import nào reference exploration_flow/agent_exploration |

---

## 13. Lộ Trình Triển Khai (Milestones)

### M0 — Xóa Agent Mode (1 ngày)

**Goals:**
- Xóa hoàn toàn agent mode (D1) — codebase chỉ còn 1 mode duy nhất
- Migrate saved sessions (nếu có chart.source = "agent")

**Deliverables:**
- Xóa các file ở Section 10.1 (Frontend + Backend)
- `ChartRecBox.tsx` rewrite bỏ ToggleButton + branch agent
- `dfSlice.tsx` bỏ `agentRules` state
- `tests/test_agent_mode_removed.py` — guard không còn import reference

**Acceptance:**
- `grep -ri "agentRules\|AgentMode\|exploration_flow"` không còn match
- App vẫn chạy bình thường ở Interactive mode
- Saved sessions cũ vẫn load được

**Commit:** `refactor: remove agent mode entirely — interactive-only chat`

---

### M1 — Chart Template Registry (0.5 ngày)

**Goals:**
- Mirror 25 templates từ frontend ChartTemplates.tsx sang backend
- Snapshot test đảm bảo sync

**Deliverables:**
- `chart_template_registry.py` với 25 entries (channels + required)
- `tests/test_chart_template_registry.py` parse ChartTemplates.tsx + compare

**Acceptance:**
- 25 templates đầy đủ + required channels khớp UI behavior
- Snapshot test fail nếu frontend đổi template

**Commit:** `feat(agents): mirror ChartTemplates registry to backend`

---

### M2 — Drawable Catalog (1 ngày)

**Goals:**
- Build catalog ràng buộc 25 templates (D2 + D3)
- Sample prompt template-based (D5)
- Preview spec Vega-Lite mini cho thumbnail

**Deliverables:**
- `drawable_catalog.py` (pure function, không LLM)
- `sample_prompts.py` (25 templates VI + EN)
- `preview_spec_builder.py` (Vega-Lite mini)
- `tests/test_drawable_catalog.py` (25 cases) + `tests/test_sample_prompts.py` (25 cases)

**Acceptance:**
- Catalog chỉ chứa chart_type ∈ 25 templates
- Encoding luôn ⊆ `template.channels`
- Catalog cho QC table chứa ≥ 5 entries (line/histogram/QC charts)
- Catalog cho generic sales table chứa ≥ 4 entries
- Build time < 50ms cho 20 columns

**Commit:** `feat(agents): add drawable chart catalog bound to 25 templates`

---

### M3 — Prompt Classifier (1 ngày)

**Goals:**
- Classifier LLM-based phân 4 categories
- Snapshot test với prompts thực tế

**Deliverables:**
- `prompt_classifier.py`
- `tests/test_prompt_classifier.py` (30 cases)

**Acceptance:**
- Classifier accuracy ≥ 85% trên test set
- Latency P95 < 800ms
- Cost < $0.001/call

**Commit:** `feat(agents): add prompt classifier (concrete/partial/vague/off-topic)`

---

### M4 — Smart-Chat Endpoint + Template Validate (1 ngày)

**Goals:**
- Endpoint `/smart-chat` orchestrate classifier + route
- Template validate enforcement (R8/R9) trong chart_compatibility
- Inject HARD CONSTRAINT 25 templates vào system prompt
- Attach drawable_alternatives khi reject

**Deliverables:**
- `agent_routes.py` endpoint mới `/smart-chat`
- `chart_compatibility.py` thêm R8 + R9
- `agent_sql_data_rec.py` + `agent_py_data_rec.py` integrate
- System prompt updated với danh sách 25 templates + channels
- `tests/test_smart_chat_endpoint.py` (15 cases)

**Acceptance:**
- 4 categories đều route đúng action
- LLM trả chart_type lạ → R8 → tự map sang template gần nhất
- LLM trả encoding channel ngoài template → R9 → reject + alternatives
- CONCRETE prompt với validation fail → trả về alternatives
- E2E latency P95 < 4s

**Commit:** `feat(api): add /smart-chat orchestrator with template constraints`

---

### M5 — Frontend Modal Redesign (1.5 ngày)

**Goals:**
- `ChartAssistantModal.tsx` với 4 modes (REJECT/SUGGESTION/CONFIRM/INFO)
- `ChartThumbnail.tsx` Vega-Lite mini preview + 2 nút "Vẽ ngay" / "💬 Dùng" (D6)
- **KHÔNG có force-draw button** (D4)
- Redux state + dispatch flow

**Deliverables:**
- 3 components mới (Modal, Thumbnail, Grid)
- `dfSlice.tsx` state mới `chartAssistant`
- `ChatbotPanel.tsx` integrate

**Acceptance:**
- 4 modes render đúng theo design ở Section 9.2
- Click "Vẽ ngay" → chart hiện < 1s (quick path, skip LLM)
- Click "💬 Dùng" → sample_prompt fill vào chat box (learning path)
- Không có force-draw button (D4 enforce)
- Manual test 5 user journey end-to-end

**Commit:** `feat(ui): redesign chart modal with 4 modes + dual-button thumbnail`

---

### M6 — Polish + Education (1 ngày)

**Goals:**
- Onboarding tour cho user mới (modal lần đầu mở data)
- Sample prompts theo data domain (QC vs generic)
- Telemetry: log category distribution, accept rate
- Tinh chỉnh classifier prompt dựa trên real logs

**Deliverables:**
- Onboarding component
- Telemetry events
- Classifier prompt v2

**Acceptance:**
- Onboarding hiển thị lần đầu, không lặp lại
- Telemetry log đủ event cần phân tích
- 5 user thực tế test → feedback dương tính ≥ 70%

**Commit:** `feat(ux): onboarding tour + telemetry for prompt classifier`

---

### Timeline tổng

| Milestone | Estimate | Dependencies |
|---|---|---|
| M0 (xóa agent mode) | 1 ngày | M1-M5 cũ (đã xong) |
| M1 (template registry) | 0.5 ngày | M0 |
| M2 (drawable catalog) | 1 ngày | M1 |
| M3 (prompt classifier) | 1 ngày | None (parallel với M1-M2) |
| M4 (smart-chat endpoint) | 1 ngày | M2, M3 |
| M5 (frontend modal) | 1.5 ngày | M4 |
| M6 (polish + telemetry) | 1 ngày | M5 |
| **Tổng** | **~7 ngày** | |

---

## 14. Test Strategy

### 12.1 Test cases cho Classifier

```python
CLASSIFIER_CASES = [
    # CONCRETE
    ("Vẽ bar chart x=QCSHIFT y=VALUE", "CONCRETE", {"chart_type": "bar"}),
    ("Line chart trục x là ngày, y là doanh thu", "CONCRETE", {"chart_type": "line"}),
    ("Histogram của VALUE", "CONCRETE", {"chart_type": "histogram"}),
    ("SUM(revenue) GROUP BY month → bar", "CONCRETE", {"chart_type": "bar"}),

    # PARTIAL
    ("Vẽ bar chart", "PARTIAL", {"missing_info": ["fields"]}),
    ("Phân tích doanh thu theo tháng", "PARTIAL", {"missing_info": ["chart_type"]}),
    ("Vẽ chart về QCSHIFT", "PARTIAL", {"missing_info": ["chart_type", "y_field"]}),

    # VAGUE
    ("Vẽ chart đi", "VAGUE", {}),
    ("Phân tích data", "VAGUE", {}),
    ("Trong data có gì hay?", "VAGUE", {}),

    # OFF_TOPIC
    ("Hôm nay thời tiết thế nào?", "OFF_TOPIC", {}),
    ("Bạn là ai?", "OFF_TOPIC", {}),
    ("Hack giùm tôi", "OFF_TOPIC", {}),
    # ... 30 cases total, mix tiếng Anh + Việt
]
```

### 12.2 Test cases cho Drawable Catalog

```python
CATALOG_CASES = [
    # (schema, domain, expected_min_entries, expected_top_chart_type)
    ("qc_full",       "qc",      5, "qc_trend_line"),
    ("sales_long",    "generic", 4, "line"),                  # has temporal
    ("categorical_heavy", "generic", 3, "bar"),
    ("single_numeric",    "generic", 1, "histogram"),
    # ... 25 cases
]
```

### 12.3 E2E user journey tests

Manual, không tự động hóa:
- J1: User mới load data → gõ "vẽ chart" → modal SUGGESTION → click thumbnail → chart hiện
- J2: User gõ prompt cụ thể đúng → chart hiện ngay (no modal)
- J3: User gõ prompt cụ thể nhưng vi phạm R3 → modal REJECT với alternatives → click alternative → chart hiện
- J4: User gõ tiếng nước ngoài "draw bar chart" → classify CONCRETE → vẽ ngay
- J5: User gõ off-topic → modal INFO với sample prompts → click sample → chart hiện

---

## 15. Rủi Ro & Mitigation (cập nhật v2)

| # | Rủi ro | Xác suất | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Classifier sai loại (vd CONCRETE → PARTIAL) | Trung bình | Trung bình | Snapshot test 30 cases real prompts; tune prompt v2 sau M6 |
| R2 | Drawable catalog quá nhiều entries (overwhelming) | Cao | Thấp | `top_k=6` default grid 2x3, "Xem thêm" expand 12 |
| R3 | Latency tăng do +1 LLM call (classifier) | Cao | Trung bình | Cache classifier kết quả nếu prompt giống hệt cũ; dùng lightweight model |
| R4 | Thumbnail render chậm với 12 mini-charts | Trung bình | Trung bình | Lazy render (intersection observer), pre-compute spec ở backend |
| R5 | User overwhelmed bởi quá nhiều options | Trung bình | Cao | Onboarding tour M6; default 6 thumbnails thay vì 12 |
| R6 | Xóa agent mode làm vỡ saved sessions | Trung bình | Cao | Migrate `chart.source = "agent"` → `"interactive"` ở load time |
| R7 | Frontend ChartTemplates đổi nhưng backend không sync | Cao | Cao | Snapshot test parse ChartTemplates.tsx — fail CI nếu lệch |
| R8 | LLM trả chart type ngoài 25 templates dù prompt cấm | Trung bình | Trung bình | Backend bắt R8 → auto-map sang template gần nhất, không trả lỗi user |

### Feature flag

```env
ENABLE_PROMPT_TRIAGE=true                  # default: true sau M6
ENABLE_DRAWABLE_CATALOG_PREVIEW=true       # default: true
PROMPT_CLASSIFIER_MODEL=gpt-4o-mini        # override để A/B test model
STRICT_TEMPLATE_VALIDATE=true              # default: true — block R8/R9
```

---

## 16. Phụ Lục — Danh Sách 25 ChartTemplate

> Trích xuất từ [src/components/ChartTemplates.tsx](src/components/ChartTemplates.tsx) — **không thêm/bớt** khi xây catalog.

### Special (không vào catalog)

| # | Template | Channels | Mục đích |
|---|---|---|---|
| 1 | Auto | [] | AI tự chọn chart type — không hiển thị riêng |
| 2 | Table | [] | Hiển thị data dạng bảng — không phải chart |

### Generic Charts (20)

| # | Template | Channels (template) | Required | Domain |
|---|---|---|---|---|
| 3 | Scatter Plot | x, y, color, size, opacity, column, row | x, y | generic |
| 4 | Linear Regression | x, y, size, color, column | x, y | generic |
| 5 | Loess Regression | x, y, size, color, column | x, y | generic |
| 6 | Ranged Dot Plot | x, y, color | x, y | generic |
| 7 | Boxplot | x, y, color, opacity, column, row | x, y | generic |
| 8 | Bar Chart | x, y, color, opacity, column, row | x, y | generic |
| 9 | Pyramid Chart | x, y, color | x, y | generic |
| 10 | Grouped Bar Chart | x, y, color, column, row | x, y, color | generic |
| 11 | Stacked Bar Chart | x, y, color, column, row | x, y, color | generic |
| 12 | Histogram | x, y, color, column, row | x | generic |
| 13 | Threshold Bar Chart | x, y, threshold | x, y, threshold | generic |
| 14 | Line Chart | x, y, color, column, row | x, y | generic |
| 15 | Dotted Line Chart | x, y, color, column, row | x, y | generic |
| 16 | Rolling Average | x, y, color, column, row | x, y | generic |
| 17 | Heat Map | x, y, color, column, row | x, y, color | generic |
| 18 | Pie Chart | theta, color, text, column, row | theta, color | generic |
| 19 | Radial Plot | theta, color | theta | generic |
| 20 | Bubble Plot | x, y, size, color | x, y, size | generic |
| 21 | Area Chart | x, y, x2, y2, color, column, row | x, y | generic |
| 22 | Waterfall | x, y | x, y | generic |

### QC Charts (3)

| # | Template | Channels (template) | Required | Domain |
|---|---|---|---|---|
| 23 | QC Trend Line | QCDATE, QCSHIFT, INDEX, VALUE, color | QCDATE, INDEX, VALUE | qc |
| 24 | QC Histogram | VALUE, INDEX, color | VALUE, INDEX | qc |
| 25 | QC Trend Bar | QCDATE, QCSHIFT, VALUE | QCDATE, VALUE | qc |

### Ghi chú quan trọng

- **Channel names case-sensitive** — `QCDATE` ≠ `qcdate` ≠ `QcDate`
- QC charts dùng tên cột làm tên channel (vd `QCDATE`) thay vì semantic role (`x`/`y`) — đây là pattern đặc thù
- **Required column phải có giá trị** trong data table — vd `QC Trend Line` không vẽ được nếu data thiếu `INDEX`
- **`Auto`** không xuất hiện trong catalog, nhưng có thể là default khi user chưa chọn template nào
- Khi thêm template mới: update đồng thời 2 nơi — `ChartTemplates.tsx` (frontend) + `chart_template_registry.py` (backend) → CI snapshot test phải pass

---

## 17. Câu Hỏi Còn Lại (đã chốt nhiều phần trong v2)

### ✅ Q1 — Smart-chat có gộp tất cả endpoint cũ không?

**Chốt:** Endpoint `/smart-chat` mới + giữ `/derive-data` cũ làm internal call (smart-chat sẽ gọi xuống derive-data sau khi classify). Sau 2 tuần stable mới deprecate frontend usage của `/derive-data` trực tiếp.

### ✅ Q2 — Thumbnail preview bao nhiêu sample rows?

**Chốt:** 50 rows.

### ✅ Q3 — Default mode cho VAGUE — top mấy?

**Chốt:** Top 6 grid 2x3, "Xem thêm" expand thành 12.

### ✅ Q4 — CONCRETE bypass strict validate?

**Chốt:** **KHÔNG bypass.** Strict validate cho mọi prompt theo nguyên tắc "thà không vẽ còn hơn vẽ rác". Khi fail → modal REJECT mode với danh sách chart có thể vẽ + sample prompt → user 1-click chọn. Bỏ luôn force-draw button.

### ✅ Q5 — Classifier dùng model nào?

**Chốt:** Lightweight (`gpt-4o-mini`) default, env var `PROMPT_CLASSIFIER_MODEL` override để A/B test.

### Q6 — Sync ChartTemplates frontend ↔ backend như thế nào?

- **Option A:** Codegen script parse TSX → sinh Python
- **Option B:** Manual sync + snapshot test guard

**Đề xuất:** Option B cho M1 (đơn giản), nếu thêm template thường xuyên thì chuyển A sau.

### Q7 — Khi click "💬 Dùng" thì sample prompt fill vào chat box và auto-submit hay chỉ fill?

- **Option A:** Auto-submit ngay (1 click → có chart)
- **Option B:** Chỉ fill, user xem rồi sửa rồi submit (2 click)

**Đề xuất:** Option B — cho user thấy được prompt rồi học, có thể tinh chỉnh trước khi submit.

### Q8 — Telemetry log gì?

Đề xuất events:
- `prompt_classified`: {category, confidence, latency_ms}
- `suggestion_clicked`: {chart_type, position_in_grid, source_mode, button: "draw_now"|"use_prompt"}
- `modal_closed_no_action`: {mode}
- `agent_mode_attempted` (1 sprint sau D1): {endpoint} — bắt user nào vẫn gọi endpoint cũ

→ Pivot data sau 2 tuần để tune classifier prompt + catalog ranking.

---

## 18. Phụ Lục — So Sánh Before/After

### 18.1 Bảng so sánh UX

| Tình huống | v0.5.2 (hiện tại) | v0.6 (sau plan này) |
|---|---|---|
| Toggle Interactive/Agent | 2 tab confusing, agent rules dialog | **Chỉ 1 ô chat duy nhất** (D1) |
| "Vẽ chart đi" | Prompt Guard chặn hoặc đoán bừa | Modal SUGGESTION với 6 thumbnail từ 25 templates |
| "Bar chart x=INDEX y=VALUE" (QC) | Reject R6 → modal text-only | Modal REJECT với 4 alternatives + 2-button thumbnail |
| "Phân tích doanh thu theo tháng" | LLM đoán chart type → 50% sai | Modal CONFIRM 3 candidates → user chọn |
| "Bar x=QCSHIFT y=VALUE" (rõ + đúng) | LLM phỏng đoán + validate strict | Vẽ ngay (validate strict, pass) |
| "Bar x=ITEMNAME y=VALUE" (rõ nhưng card explosion) | Reject text-only, user bế tắc | Modal REJECT + drawable alternatives + sample prompt (D4) |
| "Hôm nay trời mưa?" | Block với "off-topic" message | Modal INFO + 3 sample prompts từ catalog |
| LLM trả "donut" (không có trong template) | Render fail hoặc lỗi vẽ | R8 auto-map sang "Pie Chart" (D2) |
| Vẽ thử thấy không hợp | Phải gõ lại prompt từ đầu | Click thumbnail trong modal → vẽ chart khác |

### 18.2 Metrics dự kiến

- **Time-to-first-chart** (từ load data → chart đầu tiên hiện): giảm 60% (từ 3 lần gõ prompt → 1 click)
- **Prompt abandonment rate** (gõ prompt rồi không submit): giảm 50%
- **Reject-to-recovery rate**: % user click thumbnail trong REJECT modal — kỳ vọng ≥ 70% (nếu thấp → catalog suggestion chưa relevant)
- **"💬 Dùng prompt" click rate**: tỉ lệ user chọn learning path vs quick path — đo mức độ user muốn học cách viết prompt

---

## 19. Phụ Lục — Cấu trúc thư mục sau khi xong

```
data-formulator/
├── KEHOACH_AGENT_UX_TRIAGE.md          (file này — v2)
├── KEHOACH_SUA_CHART_RECOMMENDATION.md (plan cũ — đã xong v0.5.2)
├── py-src/data_formulator/
│   ├── agents/
│   │   ├── chart_template_registry.py  (NEW — M1, mirror 25 templates)
│   │   ├── drawable_catalog.py         (NEW — M2)
│   │   ├── sample_prompts.py           (NEW — M2)
│   │   ├── preview_spec_builder.py     (NEW — M2, optional)
│   │   ├── prompt_classifier.py        (NEW — M3)
│   │   ├── chart_compatibility.py      (MODIFY — M4, R8 + R9)
│   │   ├── chart_defaults.py           (MODIFY — M2, allowed_channels param)
│   │   ├── agent_sql_data_rec.py       (MODIFY — M4, HARD CONSTRAINT)
│   │   ├── agent_py_data_rec.py        (MODIFY — M4)
│   │   ├── prompt_guard_agent.py       (MODIFY — M0 + M4)
│   │   ├── agent_exploration.py        (DELETE — M0)
│   │   └── ../workflows/exploration_flow.py (DELETE — M0)
│   ├── agent_routes.py                 (MODIFY — M4 /smart-chat + xóa /explore-data-streaming)
│   └── tests/
│       ├── test_chart_template_registry.py (M1)
│       ├── test_drawable_catalog.py    (M2)
│       ├── test_sample_prompts.py      (M2)
│       ├── test_prompt_classifier.py   (M3)
│       ├── test_smart_chat_endpoint.py (M4)
│       └── test_agent_mode_removed.py  (M0, guard test)
├── src/
│   ├── components/
│   │   ├── ChartAssistantModal.tsx     (NEW — M5, replace ChartIncompatibleModal)
│   │   ├── ChartThumbnail.tsx          (NEW — M5, 2-button)
│   │   ├── SuggestionGrid.tsx          (NEW — M5)
│   │   └── ChartIncompatibleModal.tsx  (DELETE — M5)
│   ├── app/
│   │   ├── dfSlice.tsx                 (MODIFY — M0 bỏ agentRules + M5 add chartAssistant)
│   │   └── utils.tsx                   (MODIFY — M0 + M5)
│   └── views/
│       ├── ChartRecBox.tsx             (MAJOR REWRITE — M0 + M5)
│       ├── ChatbotPanel.tsx            (MODIFY — M5)
│       ├── AgentRulesDialog.tsx        (DELETE — M0)
│       └── About.tsx                   (MODIFY — M0 bỏ video ref)
├── public/
│   └── feature-agent-mode.mp4          (DELETE — M0 nếu tồn tại)
└── (env var update cho feature flags — M6)
```

---

## 20. Checklist Trước Khi Merge Mỗi PR

- [ ] Unit tests pass (pytest)
- [ ] Snapshot test ChartTemplates sync (nếu touch M1)
- [ ] Snapshot test classifier (nếu touch M3)
- [ ] Guard test `test_agent_mode_removed.py` pass (nếu touch M0)
- [ ] Manual test 5 user journey
- [ ] Telemetry events log đúng (sau M6)
- [ ] Feature flag check default values
- [ ] Backward compat: saved sessions với `chart.source = "agent"` vẫn load được
- [ ] Update tài liệu `TONG_QUAN_DU_AN.md` mục Phiên bản
- [ ] Update mục Lịch Sử Phát Triển trong `TONG_QUAN_DU_AN.md`

---

**Ghi chú cuối:**
- Plan này build trên nền M1-M5 cũ (Chart Recommendation Pipeline đã ship v0.5.2).
- Không break existing functionality — `/derive-data` cũ vẫn hoạt động trong giai đoạn migration.
- Mỗi milestone là 1 PR độc lập, có thể revert.
- Open questions Q1-Q6 cần chốt trước khi bắt đầu M1.
