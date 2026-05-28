# Kế Hoạch: Smart Chat Agent — "Suy Nghĩ Thay Vì Phân Loại"

> **Tác giả:** Bui Van Thanh  
> **Ngày tạo:** 2026-05-26  
> **Trạng thái:** Đang triển khai (đã hoàn thành phần lớn luồng Smart Chat + UX gợi ý, cập nhật tới 2026-05-26)  
> **Thay thế:** [KEHOACH_LLM_CLASSIFIER.md](KEHOACH_LLM_CLASSIFIER.md) — kế hoạch này sâu hơn và đúng hướng hơn  
> **Tư tưởng:** Agent **suy nghĩ về context + data** thay vì chỉ gán nhãn prompt

---

## 1. Tư Tưởng Cốt Lõi

### Ràng buộc Domain — Quy tắc căn bản cần hiểu trước

> Đây là nền tảng logic của toàn bộ hệ thống. Mọi quyết định của agent đều phải tuân theo.

| Data | Domain | Chart có thể vẽ | QC Charts |
|---|---|---|---|
| **QC data** (có TARGET + LL/UL + QCDATE/QCSHIFT...) | `qc` | **Tất cả 25 loại** — cả generic lẫn QC | ✅ Vẽ được |
| **Generic data** (không đủ cột QC) | `generic` | **20 loại generic** — Bar, Line, Scatter... | ❌ Không vẽ được |

**Lý do QC chart không vẽ được trên generic data:** 3 biểu đồ QC cần các cột đặc trưng (`VALUE`, `TARGET`, `LL`, `UL`, `QCDATE`, `QCSHIFT`, `INDEX`...) mà data thông thường không có. Nếu user cố vẽ QC chart trên generic data → agent phải **giải thích rõ lý do + gợi ý chart thay thế có thể vẽ được**.

**Điều này đã được enforce trong code** qua:
- `chart_compatibility.py`: reject code `R2 qc_chart_non_qc_data` — QC chart spec có `domain=["qc"]`
- `drawable_catalog.py`: `_is_template_domain_match()` — catalog generic sẽ không có 3 QC entries
- **Mới (plan này)**: SmartChatAgent phát hiện sớm và trả message thân thiện *trước khi* gọi derive pipeline

---

### Vấn đề với classifier-based approach (hiện tại)

Hiện tại `smart_chat` chạy theo mô hình:

```
prompt → classify (keyword/LLM) → gán nhãn CONCRETE/PARTIAL/VAGUE → route cứng
```

Hạn chế cơ bản: **Classifier không biết gì về data của người dùng.** Nó chỉ nhìn vào prompt text, không biết data có phải QC không, không biết data có bao nhiêu columns, không biết có thể vẽ được chart gì.

### Mô hình mới: Agent suy nghĩ có context

```
prompt + data context → Agent suy nghĩ → quyết định hành động + sinh message tự nhiên
```

**Agent nhận đầy đủ context:**
- Prompt người dùng
- Danh sách cột (columns)
- Domain đã xác định: `qc` hoặc `generic`  
- Catalog chart có thể vẽ (pre-computed, không tốn LLM)

**Agent tự quyết định:**
- Người dùng muốn gì?
- Data phù hợp vẽ chart nào?
- Nên vẽ ngay hay gợi ý?
- Nên nói gì với người dùng (tự sinh ngôn ngữ tự nhiên, không canned text)?

---

## 2. Luồng Xử Lý Tổng Thể

```
User gõ prompt
       │
       ▼
[BACKEND — smart_chat endpoint]
       │
       ├─ 1. extract columns từ input_tables
       │
       ├─ 2. is_qc_data(columns) → domain = "qc" | "generic"
       │
       ├─ 3. build_drawable_catalog(field_metas, domain)
       │       → danh sách chart có thể vẽ với data này (pure function, no LLM)
       │
       └─ 4. SmartChatAgent.run(prompt, columns, domain, catalog)
                   │
                   │  [LLM gọi 1 lần — nhận đủ context]
                   │
                   ├─ LLM "suy nghĩ":
                   │   - User muốn QC chart với data QC?
                   │   - User chỉ rõ chart + cột → vẽ ngay?
                   │   - User mơ hồ → gợi ý catalog?
                   │   - Nói gì với user cho thân thiện?
                   │
                   └─ Trả về: SmartChatResult
                               action: "draw" | "qc_suggest" | "suggest" | "confirm" | "info"
                               message_vi: "<LLM tự sinh, ngôn ngữ tự nhiên>"
                               chart_type_hint: "QC Trend Line" | ""
                               detected_fields: ["VALUE", "QCSHIFT"]
                       │
                       ▼
          Route theo action:
          ┌─ "draw"       → gọi _run_derive_data_core() → vẽ ngay
          ├─ "qc_suggest" → trả 3 QC templates + message_vi của agent
          ├─ "suggest"    → trả catalog top-6 + message_vi của agent
          ├─ "confirm"    → trả top-3 candidates + message_vi của agent
          └─ "info"       → trả sample prompts + message_vi của agent
```

---

## 3. Scenario Chi Tiết — Theo Mô Tả Người Dùng

### Scenario A: "Vẽ QC chart" + QC data

```
User: "Vẽ QC chart"
Data: [VALUE, QCDATE, QCSHIFT, QCSTDPARAMNAME, TARGET, LL, UL, INDEX]
Domain: qc ✓

Agent suy nghĩ:
  → User nói "QC chart" nhưng chưa nói loại cụ thể
  → Data là QC data ✓
  → Nên gợi ý 3 QC templates

LLM sinh message_vi:
  "Có vẻ như bạn đang muốn vẽ biểu đồ QC.
   Dữ liệu của bạn có đầy đủ các cột QC (TARGET, LL, UL, QCDATE...).
   Chọn loại biểu đồ QC phù hợp bên dưới:"

action = "qc_suggest"
suggestions = [QC Trend Line, QC Histogram, QC Trend Bar]
```

### Scenario B: "Vẽ QC Trend Bar" + QC data

```
User: "Vẽ QC Trend Bar"
Data: QC data
Domain: qc

Agent suy nghĩ:
  → User chỉ rõ "QC Trend Bar"
  → Data là QC data ✓ → đủ điều kiện
  → Vẽ ngay

action = "draw"
chart_type_hint = "QC Trend Bar"
```

### Scenario C: Prompt mơ hồ + bất kỳ data nào

```
User: "Vẽ biểu đồ cho tôi" / "show me something"
Data: generic sales data với [month, revenue, product, region]

Agent suy nghĩ:
  → User không chỉ rõ chart gì
  → Có catalog: Bar Chart (revenue/month), Line Chart (revenue/month), Pie (revenue/product)...
  → Gợi ý catalog

LLM sinh message_vi:
  "Dựa trên dữ liệu của bạn, tôi gợi ý một số biểu đồ có thể vẽ ngay:"

action = "suggest"
suggestions = catalog top-6
```

### Scenario D: "Phân tích doanh thu theo tháng" (partial)

```
User: "Phân tích doanh thu theo tháng"
Data: [month, revenue, product]

Agent suy nghĩ:
  → Có cột: month (temporal), revenue (numeric)
  → Không nói chart type cụ thể
  → Đề xuất 3 chart phù hợp: Line (tốt nhất), Bar, Area

LLM sinh message_vi:
  "Tôi thấy bạn muốn phân tích doanh thu theo tháng.
   Đây là 3 cách vẽ phù hợp nhất với dữ liệu này:"

action = "confirm"
suggestions = [Line Chart (x=month, y=revenue), Bar Chart, Area Chart]
```

### Scenario E: Off-topic

```
User: "Hôm nay trời thế nào?"

Agent suy nghĩ:
  → Không liên quan vẽ chart

LLM sinh message_vi:
  "Tôi chỉ có thể giúp bạn vẽ biểu đồ từ dữ liệu.
   Thử hỏi tôi những câu như: 'Vẽ bar chart doanh thu theo tháng'
   hoặc chọn một gợi ý bên dưới để bắt đầu."

action = "info"
sample_prompts = từ catalog của data hiện tại
```

### Scenario F: Yêu cầu QC chart nhưng data KHÔNG phải QC ← QUAN TRỌNG

```
User: "Vẽ QC Trend Line"  (hoặc "QC Histogram", "vẽ biểu đồ QC trend bar")
Data: [month, revenue, product, region]   ← generic data, không có TARGET/LL/UL
Domain: generic

Agent suy nghĩ:
  → User muốn vẽ QC chart (phát hiện từ prompt)
  → Nhưng domain = "generic" → data KHÔNG có đủ cột QC
  → KHÔNG thể vẽ QC chart này
  → Phải giải thích rõ + gợi ý các chart có thể vẽ với data này

LLM sinh message_vi:
  "Biểu đồ QC cần các cột đặc trưng như TARGET, LL, UL, QCDATE, QCSHIFT...
   mà dữ liệu hiện tại không có. Dưới đây là các biểu đồ có thể vẽ được với data của bạn:"

action = "info"   ← không phải "draw" hay "qc_suggest"
suggestions = catalog generic của data hiện tại (Bar, Line, Scatter...)
```

**Điểm then chốt:**
- `action = "info"` (không phải `qc_suggest` vì đó là khi data CÓ QC)
- Frontend hiển thị `message_vi` giải thích + catalog gợi ý thay thế
- KHÔNG cố gắng vẽ → tránh lỗi R2 ở pipeline sau

### Scenario G: QC data nhưng vẽ chart thông thường ← hoạt động bình thường

```
User: "Vẽ bar chart VALUE theo QCSHIFT"
Data: QC data đầy đủ
Domain: qc

Agent suy nghĩ:
  → User muốn bar chart (chart thông thường, không phải QC-specific)
  → Data là QC data → có thể vẽ tất cả chart types
  → Bar chart + cột rõ ràng → vẽ ngay

action = "draw"
chart_type_hint = "Bar Chart"
```

**QC data có thể vẽ tất cả 25 chart types.** Agent không cần ưu tiên QC charts
nếu user yêu cầu chart thông thường — tôn trọng ý định của user.

### Scenario H: QC data + muốn khám phá (vague)

```
User: "Vẽ biểu đồ cho tôi" / "phân tích data"
Data: QC data
Domain: qc

Agent suy nghĩ:
  → User mơ hồ, không chỉ rõ chart gì
  → Data là QC → catalog sẽ có cả QC lẫn generic charts
  → Nên ưu tiên QC charts trong gợi ý (confidence cao hơn)

action = "suggest"
suggestions = catalog top-6 (QC charts được xếp trên do confidence cao hơn)
```

> Catalog đã tự ưu tiên QC charts cho QC domain (`_compute_confidence` cộng +0.2 cho `chart_type.startswith("QC")`).
> Agent không cần làm gì thêm — chỉ cần gợi ý catalog.

---

## 4. Thiết Kế `SmartChatAgent`

### 4.1 Cấu trúc class

```python
# py-src/data_formulator/agents/agent_smart_chat.py (FILE MỚI)

@dataclass
class SmartChatResult:
    action: str              # "draw" | "qc_suggest" | "suggest" | "confirm" | "info"
    message_vi: str          # LLM tự sinh — ngôn ngữ tự nhiên, thân thiện
    chart_type_hint: str     # Exact name từ 25 templates, hoặc ""
    detected_fields: List[str]  # Cột user đề cập trong prompt
    confidence: float
    rationale: str           # Giải thích nội bộ (log)


class SmartChatAgent:
    def __init__(self, client: Client):
        self.client = client

    def run(
        self,
        prompt: str,
        columns: List[str],
        domain: str,                              # "qc" | "generic"
        drawable_catalog: List[DrawableChartEntry],  # pre-computed, no LLM
    ) -> SmartChatResult:
        ...
```

### 4.2 System Prompt — Trái Tim của Agent

System prompt phải truyền đạt:
1. Agent là ai và nhiệm vụ là gì
2. Ngữ cảnh: domain QC hay generic, các cột có trong data
3. Danh sách 25 chart types + 3 QC chart templates đặc biệt
4. Catalog chart đã có thể vẽ với data hiện tại (dạng tóm tắt ngắn)
5. 5 action và khi nào dùng cái nào
6. Format JSON output

```
Bạn là trợ lý phân tích dữ liệu thông minh trong công cụ vẽ biểu đồ.
Nhiệm vụ: đọc prompt người dùng + ngữ cảnh data → quyết định hành động tốt nhất → sinh message thân thiện.

=== NGỮ CẢNH DATA ===
Domain: {domain}
Cột trong data: {columns}

{qc_section}
(Nếu domain=qc, section này xuất hiện:)
"⭐ ĐÂY LÀ QC DATA. Data có đủ cột QC (TARGET, LL/UL, QCDATE/QCSHIFT...).
 3 biểu đồ QC chuyên biệt CHỈ dùng được với QC data:
   - QC Trend Line: theo dõi VALUE theo thời gian kèm control limits
   - QC Histogram: phân bố giá trị VALUE
   - QC Trend Bar: xu hướng dạng cột theo ca/ngày
 Ngoài ra, QC data CÒN CÓ THỂ vẽ tất cả 20 biểu đồ thông thường."

(Nếu domain=generic, section này xuất hiện:)
"⚠️ DATA THÔNG THƯỜNG — Không phải QC data (thiếu cột TARGET/LL/UL/QCDATE...).
 KHÔNG THỂ vẽ 3 biểu đồ QC (QC Trend Line, QC Histogram, QC Trend Bar).
 Nếu user yêu cầu QC chart → action='info', giải thích và gợi ý chart thay thế."

=== CHART CÓ THỂ VẼ NGAY VỚI DATA NÀY ===
{catalog_summary}

=== 25 CHART TYPES HỢP LỆ (dùng ĐÚNG tên) ===
Generic (20): Scatter Plot, Linear Regression, Loess Regression, Ranged Dot Plot,
              Boxplot, Bar Chart, Pyramid Chart, Grouped Bar Chart, Stacked Bar Chart,
              Histogram, Threshold Bar Chart, Line Chart, Dotted Line Chart,
              Rolling Average, Heat Map, Pie Chart, Radial Plot, Bubble Plot, Area Chart, Waterfall
QC only (3):  QC Trend Line, QC Histogram, QC Trend Bar

=== 5 HÀNH ĐỘNG ===

"draw" → Vẽ ngay không hỏi thêm.
  Dùng khi: Prompt có chart type RÕ RÀNG + có field/cột.
  Lưu ý: Với QC chart, PHẢI kiểm tra domain="qc" trước khi dùng "draw".
  Ví dụ: "vẽ bar chart VALUE theo QCSHIFT", "scatter VALUE vs INDEX", "QC Trend Line"(domain=qc)

"qc_suggest" → Gợi ý 3 biểu đồ QC, kèm message thân thiện.
  Dùng khi: domain=qc VÀ user muốn vẽ QC chart nhưng CHƯA chọn loại cụ thể.
  Ví dụ: "vẽ QC chart", "biểu đồ QC", "draw QC chart for this data"
  KHÔNG dùng khi domain=generic (dùng "info" thay thế).

"confirm" → Đề xuất 2-3 chart phù hợp nhất, user chọn.
  Dùng khi: User đề cập metric/cột cụ thể nhưng không nói chart type.
  Ví dụ: "phân tích revenue theo month", "so sánh VALUE giữa các ca"

"suggest" → Mở gallery gợi ý từ catalog.
  Dùng khi: User mơ hồ, không có chart type lẫn cột cụ thể.
  Ví dụ: "vẽ chart đi", "show me something", "giúp tôi phân tích data"

"info" → Giải thích + gợi ý thay thế.
  Dùng khi: (1) Không liên quan vẽ chart/data.
            (2) ⚠️ User yêu cầu QC chart nhưng domain=generic — LUÔN dùng "info" cho case này.
  Ví dụ: "hôm nay trời thế nào", spam, hoặc "vẽ QC Trend Line"(domain=generic)

=== QUY TẮC QUAN TRỌNG ===

1. DOMAIN CHECK cho QC charts:
   - domain=qc  + user muốn QC chart cụ thể → "draw"
   - domain=qc  + user muốn QC chart chưa rõ loại → "qc_suggest"
   - domain=generic + user muốn QC chart → "info" (giải thích + gợi ý thay thế)

2. QC data vẽ được tất cả:
   - domain=qc + user muốn Bar Chart / Line Chart / Scatter → "draw" hoặc "confirm" bình thường
   - Không cần ép user vẽ QC chart khi họ muốn chart thông thường

3. message_vi phải tự nhiên:
   - KHÔNG: "Prompt của bạn còn thiếu thông tin"
   - CÓ: "Tôi thấy bạn muốn...", "Có vẻ như...", "Dựa trên data của bạn..."
   - Với case domain mismatch: giải thích nhẹ nhàng tại sao không vẽ được + hướng dẫn

4. Ngôn ngữ: theo ngôn ngữ của user (Việt/Anh/...), ngắn gọn 1-3 câu.

=== OUTPUT — CHỈ JSON ===
{
  "action": "draw|qc_suggest|suggest|confirm|info",
  "message_vi": "...",
  "chart_type_hint": "<exact name hoặc empty string>",
  "detected_fields": ["FIELD1", "FIELD2"],
  "confidence": 0.0-1.0,
  "rationale": "<1 câu tiếng Anh>"
}
```

### 4.3 Input building trong code

```python
def _build_catalog_summary(catalog: List[DrawableChartEntry], max_items: int = 8) -> str:
    """Tóm tắt catalog thành text ngắn để đưa vào prompt."""
    if not catalog:
        return "(Không có biểu đồ nào phù hợp với data hiện tại)"
    lines = []
    for e in catalog[:max_items]:
        enc_str = ", ".join(f"{k}={v}" for k, v in e.encoding.items())
        lines.append(f"- {e.chart_type} ({enc_str}) — confidence {e.confidence:.1f}")
    return "\n".join(lines)
```

---

## 5. Response Contract — Backend → Frontend

### 5.1 Cấu trúc response `/api/agent/smart-chat`

```json
{
  "token": "...",
  "status": "ok",
  "category": "CONCRETE | PARTIAL | VAGUE | OFF_TOPIC",  // giữ cho telemetry
  "action": "draw | qc_suggest | suggest | confirm | info",

  // message_vi: LLM tự sinh, thân thiện — KHÔNG còn canned text
  "message_vi": "Có vẻ như bạn muốn vẽ biểu đồ QC. Chọn loại phù hợp bên dưới:",

  // Cho action = "draw": toàn bộ chart data như hiện tại
  "results": [...],      // chỉ có khi action = "draw"

  // Cho action = "qc_suggest" | "suggest" | "confirm"
  "suggestions": [
    {
      "chart_type": "QC Trend Line",
      "encoding": {"QCDATE": "QCDATE", "VALUE": "VALUE", ...},
      "confidence": 0.9,
      "rationale_vi": "Phù hợp vì data có QCDATE và VALUE",
      "sample_prompt_vi": "Vẽ QC trend line VALUE theo QCDATE / QCSHIFT"
    }
  ],

  // Cho action = "info"
  "sample_prompts": ["Vẽ bar chart...", "Phân tích..."],

  // Debug / telemetry
  "classifier_hints": {
    "chart_type_hint": "QC Trend Bar",
    "detected_fields": ["VALUE", "QCSHIFT"]
  }
}
```

### 5.2 So sánh Before / After

| Trường hợp | Data | Before (hiện tại) | After (plan này) |
|---|---|---|---|
| "Vẽ QC Trend Line" | QC | Modal: "Prompt còn thiếu thông tin" ❌ | Vẽ ngay ✓ |
| "Vẽ QC chart" | QC | Modal generic (không biết là QC) ❌ | Modal QC_SUGGEST: 3 QC templates + message thân thiện ✓ |
| "Vẽ bar chart VALUE theo QCSHIFT" | QC | Modal: "Prompt còn thiếu" ❌ | Vẽ ngay ✓ |
| "Vẽ QC Trend Line" | Generic | Gọi derive → lỗi R2 ở pipeline ❌ | Modal INFO: giải thích + gợi ý chart thay thế ✓ |
| "Phân tích doanh thu theo tháng" | Generic | Modal: "Prompt còn thiếu" ❌ | Modal CONFIRM: "Tôi thấy bạn muốn..." + 3 gợi ý ✓ |
| "Vẽ chart đi" | Any | Modal gallery (không có message) | Modal: "Dựa trên data..." + gallery ✓ |
| message_vi | Any | Canned string hardcoded ❌ | LLM tự sinh, ngôn ngữ tự nhiên ✓ |

---

## 6. Files Cần Thay Đổi

### 6.1 File MỚI

#### `py-src/data_formulator/agents/agent_smart_chat.py`

Toàn bộ logic SmartChatAgent:
- `SmartChatResult` dataclass
- `SmartChatAgent` class với `run()` method
- `_build_system_prompt()` — xây dựng system prompt động
- `_build_catalog_summary()` — tóm tắt catalog thành text
- `_build_qc_section()` — thêm QC context nếu domain == "qc"
- `_parse_llm_response()` — parse JSON + fallback

```
Kích thước ước tính: ~200 dòng
Dependencies: client_utils, drawable_catalog, qc_chart_config, chart_template_registry
```

### 6.2 File SỬA

#### `py-src/data_formulator/agent_routes.py` — hàm `smart_chat`

**Thay đổi:**

```python
# TRƯỚC (~30 dòng, không có client)
def smart_chat():
    ...
    classification = classify_prompt(instruction, data_columns)
    # route hardcoded theo category...

# SAU (~50 dòng, có SmartChatAgent)
def smart_chat():
    content = request.get_json()
    token = content.get("token", "")
    input_tables = content.get("input_tables", [])
    instruction = content.get("extra_prompt", "")

    # Xây dựng context
    data_columns = extract_all_columns_from_input_tables(input_tables)
    domain = "qc" if is_qc_data(data_columns) else "generic"
    field_metas = _build_field_metas_from_input_tables(input_tables)
    drawable_catalog = build_drawable_catalog(field_metas, domain, top_k=8)

    # SmartChatAgent suy nghĩ (1 LLM call)
    main_client = get_client(content["model"])
    lw_client = get_lightweight_client(main_client)
    agent = SmartChatAgent(client=lw_client)
    result = agent.run(instruction, data_columns, domain, drawable_catalog)

    # Route theo action
    if result.action == "draw":
        # forward chart_type_hint để giảm LLM re-inference
        if result.chart_type_hint:
            content["user_preferred_chart_type"] = result.chart_type_hint
        payload, status_code = _run_derive_data_core(content)
        payload.update({"action": "draw", "message_vi": result.message_vi})
        ...
    
    elif result.action == "qc_suggest":
        # Trả 3 QC templates (fixed, từ catalog)
        qc_entries = [e for e in drawable_catalog if e.chart_type.startswith("QC")]
        ...

    elif result.action in ("suggest", "confirm"):
        top_k = 6 if result.action == "suggest" else 3
        ...

    elif result.action == "info":
        ...
```

#### `py-src/data_formulator/agents/prompt_classifier.py`

**Thay đổi:** File này sẽ được **giữ lại nhưng thu gọn** — chỉ là rule-based fallback nội bộ, không còn là entry point chính.

- Xóa LLM path (vì SmartChatAgent đã đảm nhiệm)
- Fix keyword list (Bug 1 + Bug 2 từ diagnosis)
- Đổi tên thành `_rule_based_classify()` (private)
- `classify_prompt()` vẫn export nhưng chỉ dùng cho unit tests và backward compat

### 6.3 Frontend — Thay đổi tối thiểu

Frontend hiện tại đã xử lý `data.action`:
```javascript
if (data.action === "suggestion" || data.action === "confirm") { ... }
if (data.action === "info") { ... }
```

**Cần thêm:**
1. Xử lý `data.action === "qc_suggest"` (action mới) — tương tự "suggestion" nhưng hiển thị riêng 3 QC templates
2. Dùng `data.message_vi` từ backend thay vì canned string hardcoded:

```javascript
// TRƯỚC (src/views/ChartRecBox.tsx dòng ~1294-1297)
setAssistantMessage(
    data.action === "suggestion"
        ? "Chọn một gợi ý để vẽ nhanh hoặc dùng prompt mẫu."
        : "Prompt của bạn còn thiếu thông tin. Chọn cấu hình phù hợp để tiếp tục.",
);

// SAU — dùng message từ backend
setAssistantMessage(data.message_vi || "Chọn biểu đồ phù hợp bên dưới.");
```

3. `ChartAssistantModal.tsx` — thêm mode `"QC_SUGGEST"` hiển thị badge/label "QC Charts" nổi bật

---

## 7. Chi Tiết `agent_smart_chat.py` — Pseudocode Đầy Đủ

```python
"""
SmartChatAgent — agent suy nghĩ về context, không chỉ classify keyword.

Nhận: prompt + columns + domain + catalog (pre-computed)
LLM suy nghĩ 1 lần → trả action + message_vi tự nhiên
"""

from __future__ import annotations
import json, logging, re
from dataclasses import dataclass, field
from typing import List, TYPE_CHECKING

if TYPE_CHECKING:
    from data_formulator.agents.client_utils import Client
    from data_formulator.agents.drawable_catalog import DrawableChartEntry

logger = logging.getLogger(__name__)


@dataclass
class SmartChatResult:
    action: str                       # "draw"|"qc_suggest"|"suggest"|"confirm"|"info"
    message_vi: str                   # Natural language message cho user
    chart_type_hint: str = ""         # Exact chart name nếu action="draw"
    detected_fields: List[str] = field(default_factory=list)
    confidence: float = 0.8
    rationale: str = ""


_CHART_TYPE_LIST_STR = """Scatter Plot, Linear Regression, Loess Regression, Ranged Dot Plot,
Boxplot, Bar Chart, Pyramid Chart, Grouped Bar Chart, Stacked Bar Chart,
Histogram, Threshold Bar Chart, Line Chart, Dotted Line Chart, Rolling Average,
Heat Map, Pie Chart, Radial Plot, Bubble Plot, Area Chart, Waterfall,
QC Trend Line, QC Histogram, QC Trend Bar"""


def _build_system_prompt(
    columns: List[str],
    domain: str,
    catalog_summary: str,
) -> str:
    columns_str = ", ".join(columns) if columns else "(chưa load data)"

    qc_section = ""
    if domain == "qc":
        qc_section = """
⭐ ĐÂY LÀ QC DATA — 3 biểu đồ QC chuyên biệt:
  - QC Trend Line: theo dõi VALUE theo thời gian kèm control limits (TARGET, LL, UL...)
  - QC Histogram: phân bố giá trị VALUE
  - QC Trend Bar: xu hướng dạng cột theo QCDATE/QCSHIFT
→ Ưu tiên gợi ý QC charts khi user muốn vẽ chart liên quan QC data.
"""

    return f"""Bạn là trợ lý phân tích dữ liệu trong công cụ vẽ biểu đồ GDIS.
Nhiệm vụ: Đọc prompt người dùng + ngữ cảnh data → quyết định hành động tốt nhất → sinh message thân thiện.

=== NGỮ CẢNH DATA ===
Domain: {domain}
Cột trong data: {columns_str}
{qc_section}
=== CHART CÓ THỂ VẼ NGAY VỚI DATA NÀY ===
{catalog_summary}

=== 25 CHART TYPES HỢP LỆ (dùng ĐÚNG tên này) ===
{_CHART_TYPE_LIST_STR}

=== 5 HÀNH ĐỘNG VÀ KHI NÀO DÙNG ===

"draw" → Vẽ ngay không hỏi thêm.
  Dùng khi: Prompt có chart type RÕ RÀNG và có field/cột cụ thể.
  Cũng dùng khi: User gọi tên QC chart (QC Trend Line/Bar/Histogram) và domain=qc.
  Ví dụ: "vẽ bar chart VALUE theo QCSHIFT", "QC Trend Line", "histogram of VALUE"

"qc_suggest" → Gợi ý 3 biểu đồ QC, kèm message thân thiện.
  Dùng khi: domain=qc VÀ user muốn vẽ QC chart nhưng CHƯA chọn loại cụ thể.
  Ví dụ: "vẽ QC chart", "vẽ biểu đồ QC", "draw QC chart for this data"

"confirm" → Đề xuất 2-3 chart phù hợp nhất, user chọn.
  Dùng khi: User đề cập cột cụ thể hoặc metric/measure nhưng không nói chart type.
  Ví dụ: "phân tích revenue theo month", "so sánh VALUE giữa các ca"

"suggest" → Mở gallery gợi ý từ catalog.
  Dùng khi: User muốn vẽ gì đó nhưng mơ hồ, không có chart type lẫn cột cụ thể.
  Ví dụ: "vẽ chart đi", "show me something", "giúp tôi phân tích data"

"info" → Giải thích + sample prompts.
  Dùng khi: Không liên quan vẽ chart hoặc phân tích data.
  Ví dụ: spam, câu hỏi ngoài lề, gibberish

=== QUY TẮC SINH message_vi ===
- Ngôn ngữ: theo ngôn ngữ của user (Việt/Anh/...)
- Tone: thân thiện, ngắn gọn (1-3 câu), như đang trò chuyện
- KHÔNG dùng: "Prompt của bạn còn thiếu thông tin" — quá robotic
- DÙNG: "Tôi thấy bạn muốn...", "Có vẻ như...", "Dựa trên data của bạn..."
- Với action="draw": có thể để trống ("") vì chart sẽ hiện ra ngay
- Với action="qc_suggest": giải thích tại sao gợi ý QC chart
- Với action="confirm": nói rõ AI hiểu user muốn gì, đề xuất cách vẽ
- Với action="suggest": ngắn gọn, mời user chọn
- Với action="info": giải thích tool làm gì, gợi ý thử

=== OUTPUT — CHỈ JSON, KHÔNG MARKDOWN ===
{{
  "action": "draw|qc_suggest|suggest|confirm|info",
  "message_vi": "...",
  "chart_type_hint": "<exact name hoặc empty string>",
  "detected_fields": ["FIELD1", "FIELD2"],
  "confidence": 0.0-1.0,
  "rationale": "<1 câu tiếng Anh>"
}}"""


def _build_catalog_summary(catalog: List["DrawableChartEntry"], max_items: int = 8) -> str:
    if not catalog:
        return "(Không có biểu đồ phù hợp với data hiện tại)"
    lines = []
    for e in catalog[:max_items]:
        enc = ", ".join(f"{k}={v}" for k, v in e.encoding.items())
        lines.append(f"- {e.chart_type} ({enc}) — conf {e.confidence:.1f}")
    return "\n".join(lines)


def _parse_llm_response(raw: str) -> dict:
    """Parse JSON từ LLM response. Xử lý markdown fence nếu có."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"```[a-z]*\n?", "", text).strip("`").strip()
    return json.loads(text)


def _fallback_result(prompt: str, domain: str) -> SmartChatResult:
    """Trả về kết quả an toàn khi LLM fail."""
    text = prompt.lower()
    if "qc" in text and domain == "qc":
        return SmartChatResult(
            action="qc_suggest",
            message_vi="Dữ liệu QC của bạn có thể vẽ các biểu đồ QC sau:",
            rationale="fallback: qc keyword + qc domain",
        )
    has_chart = any(k in text for k in ["bar", "line", "histogram", "scatter", "chart", "biểu đồ"])
    if has_chart:
        return SmartChatResult(
            action="suggest",
            message_vi="Dựa trên dữ liệu của bạn, đây là các biểu đồ có thể vẽ:",
            rationale="fallback: chart keyword detected",
        )
    return SmartChatResult(
        action="suggest",
        message_vi="Chọn một biểu đồ bên dưới để bắt đầu phân tích:",
        rationale="fallback: default suggest",
    )


class SmartChatAgent:
    """
    Agent suy nghĩ về context data + prompt → quyết định action + sinh message tự nhiên.
    
    Khác với rule-based classifier: agent nhận FULL context (columns, domain, catalog)
    và dùng LLM để hiểu intent một cách linh hoạt, không hardcode keywords.
    """

    def __init__(self, client: "Client"):
        self.client = client

    def run(
        self,
        prompt: str,
        columns: List[str],
        domain: str,
        drawable_catalog: List["DrawableChartEntry"],
    ) -> SmartChatResult:
        catalog_summary = _build_catalog_summary(drawable_catalog)
        system_prompt = _build_system_prompt(columns, domain, catalog_summary)

        try:
            response = self.client.get_completion(messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Prompt của người dùng: {prompt}"},
            ])
            raw = response.choices[0].message.content.strip()
            data = _parse_llm_response(raw)

            action = data.get("action", "suggest")
            valid_actions = {"draw", "qc_suggest", "suggest", "confirm", "info"}
            if action not in valid_actions:
                logger.warning(f"SmartChatAgent: invalid action '{action}', defaulting to suggest")
                action = "suggest"

            return SmartChatResult(
                action=action,
                message_vi=data.get("message_vi", ""),
                chart_type_hint=data.get("chart_type_hint", ""),
                detected_fields=data.get("detected_fields", []),
                confidence=float(data.get("confidence", 0.8)),
                rationale=data.get("rationale", ""),
            )

        except json.JSONDecodeError as e:
            logger.error(f"SmartChatAgent JSON parse error: {e}")
            return _fallback_result(prompt, domain)
        except Exception as e:
            logger.error(f"SmartChatAgent LLM call failed: {e}")
            return _fallback_result(prompt, domain)
```

---

## 8. Chi Tiết Sửa `agent_routes.py` — Hàm `smart_chat`

```python
@agent_bp.route('/smart-chat', methods=['GET', 'POST'])
def smart_chat():
    if not request.is_json:
        return flask.jsonify({"token": "", "status": "error", "message": "Invalid request format"}), 400

    content = request.get_json()
    token = content.get("token", "")
    input_tables = content.get("input_tables", [])
    instruction = content.get("extra_prompt", "")

    # ── 1. Xây dựng context ──────────────────────────────────────────────────
    data_columns = extract_all_columns_from_input_tables(input_tables)
    domain = "qc" if is_qc_data(data_columns) else "generic"
    field_metas = _build_field_metas_from_input_tables(input_tables)
    drawable_catalog = build_drawable_catalog(field_metas, domain, top_k=8)

    # ── 2. Agent suy nghĩ (1 LLM call) ───────────────────────────────────────
    main_client = get_client(content["model"]) if content.get("model") else None
    if main_client is None:
        # Không có model config → fallback về rule-based gợi ý
        _resp = _build_suggest_response(token, drawable_catalog, domain,
                                         "Chọn biểu đồ phù hợp với data của bạn:")
        return flask.jsonify(_resp), 200

    lw_client = get_lightweight_client(main_client)
    agent = SmartChatAgent(client=lw_client)
    result = agent.run(instruction, data_columns, domain, drawable_catalog)

    _log_telemetry_event("prompt_classified", {
        "action": result.action,
        "confidence": result.confidence,
        "domain": domain,
        "column_count": len(data_columns),
    })

    # ── 3. Safety check: LLM đôi khi trả "draw" cho QC chart trên generic data ─
    # Đây là double-check layer, SmartChatAgent đã xử lý ở LLM nhưng ta bảo vệ thêm.
    QC_CHART_NAMES = {"QC Trend Line", "QC Histogram", "QC Trend Bar"}
    if (result.action == "draw"
            and result.chart_type_hint in QC_CHART_NAMES
            and domain == "generic"):
        # Override: redirect sang "info" với message giải thích
        result = SmartChatResult(
            action="info",
            message_vi=(
                "Biểu đồ QC cần các cột đặc trưng như TARGET, LL, UL, QCDATE, QCSHIFT... "
                "mà dữ liệu hiện tại không có. "
                "Dưới đây là các biểu đồ có thể vẽ với data của bạn:"
            ),
            chart_type_hint=result.chart_type_hint,
            detected_fields=result.detected_fields,
            confidence=0.95,
            rationale=f"safety: {result.chart_type_hint} requires qc domain, got generic",
        )

    # ── 4. Route theo action ──────────────────────────────────────────────────

    if result.action == "draw":
        # Forward chart_type_hint để giảm LLM re-inference trong derive pipeline
        if result.chart_type_hint and not content.get("user_preferred_chart_type"):
            content["user_preferred_chart_type"] = result.chart_type_hint
        payload, status_code = _run_derive_data_core(content)
        payload["action"] = "draw"
        payload["message_vi"] = result.message_vi
        payload["classifier_hints"] = {
            "chart_type_hint": result.chart_type_hint,
            "detected_fields": result.detected_fields,
        }
        response = flask.jsonify(payload)
        response.status_code = status_code
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

    if result.action == "qc_suggest":
        # Chỉ có thể đến đây khi domain="qc" (agent đã check, safety check ở trên cũng đảm bảo)
        # Lấy 3 QC entries từ catalog — catalog đã include QC entries vì domain=qc
        qc_entries = [e for e in drawable_catalog if e.chart_type.startswith("QC")]
        if not qc_entries:
            # Fallback: trả 3 QC templates mặc định dù data không đủ cột
            qc_entries = _get_default_qc_entries()
        response = flask.jsonify({
            "token": token, "status": "ok",
            "action": "qc_suggest",
            "message_vi": result.message_vi,
            "suggestions": [_entry_to_dict(e) for e in qc_entries],
            "classifier_hints": {"chart_type_hint": result.chart_type_hint},
        })
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

    if result.action == "confirm":
        top_k = 3
        # Ưu tiên chart gần với chart_type_hint nếu có, sau đó top by confidence
        entries = _filter_catalog_by_hint(drawable_catalog, result.chart_type_hint, top_k)
        response = flask.jsonify({
            "token": token, "status": "ok",
            "action": "confirm",
            "message_vi": result.message_vi,
            "suggestions": [_entry_to_dict(e) for e in entries],
        })
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

    if result.action == "suggest":
        # Catalog đã được sort by confidence — QC data sẽ có QC charts lên đầu
        top_k = 6
        entries = drawable_catalog[:top_k]
        response = flask.jsonify({
            "token": token, "status": "ok",
            "action": "suggest",
            "message_vi": result.message_vi,
            "suggestions": [_entry_to_dict(e) for e in entries],
        })
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

    # action == "info" — bao gồm cả case: generic data + QC chart request
    # Gợi ý catalog generic (không có QC charts) để user biết có thể vẽ gì
    sample_prompts = [e.sample_prompt_vi for e in drawable_catalog[:5]]
    response = flask.jsonify({
        "token": token, "status": "ok",
        "action": "info",
        "message_vi": result.message_vi,
        "sample_prompts": sample_prompts,
        # Trả cả suggestions để frontend có thể hiển thị thumbnail thay thế
        "suggestions": [_entry_to_dict(e) for e in drawable_catalog[:6]],
    })
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response
```

---

## 9. Frontend — Thay Đổi

### 9.1 `ChartRecBox.tsx` — 2 chỗ sửa nhỏ

**Chỗ 1:** Xử lý action mới `"qc_suggest"` (giống "suggestion" nhưng mode khác)

```tsx
// Dòng ~1289 — thêm "qc_suggest" vào condition
if (data.action === "suggestion" || data.action === "suggest" || 
    data.action === "confirm" || data.action === "qc_suggest") {

    const mode = 
        data.action === "qc_suggest" ? "QC_SUGGEST" :
        data.action === "suggest" ? "SUGGESTION" :
        "CONFIRM";
    
    setAssistantMode(mode);
    // Dùng message_vi từ backend thay vì canned text
    setAssistantMessage(data.message_vi || "Chọn biểu đồ phù hợp:");
    ...
}
```

**Chỗ 2:** Dùng `data.message_vi` thay canned text:
```tsx
// TRƯỚC
setAssistantMessage(
    data.action === "suggestion"
        ? "Chọn một gợi ý để vẽ nhanh..."
        : "Prompt của bạn còn thiếu thông tin...",  // ← bỏ cái này
);

// SAU
setAssistantMessage(data.message_vi || "Chọn biểu đồ phù hợp:");
```

### 9.2 `ChartAssistantModal.tsx` — Thêm QC_SUGGEST mode

```tsx
// Thêm case cho QC_SUGGEST
// Về layout giống SUGGESTION nhưng:
// - Header badge: "⭐ QC Charts"
// - Tối đa 3 cards (chỉ QC templates)
// - Màu accent khác (warning/orange thay vì primary/blue)

const isQcMode = mode === "QC_SUGGEST";
// Render tương tự SUGGESTION nhưng với QC accent color
```

---

## 10. Test Strategy

### 10.1 Unit test `SmartChatAgent` với MockClient

```python
# test_smart_chat_agent.py

class MockClient:
    def __init__(self, fixed_response: dict):
        self.fixed_response = fixed_response
    
    def get_completion(self, messages):
        class Msg: content = json.dumps(self.fixed_response)
        class Choice: message = Msg()
        class Resp: choices = [Choice()]
        return Resp()


QC_COLUMNS = ["VALUE", "QCDATE", "QCSHIFT", "QCSTDPARAMNAME", "TARGET", "LL", "UL", "INDEX"]
GENERIC_COLUMNS = ["month", "revenue", "product", "region"]

TEST_CASES = [
    # ── QC data + QC chart ──
    ("Vẽ QC Trend Line", "qc", "draw", "QC chart cụ thể + QC data → draw"),
    ("QC Histogram", "qc", "draw", "QC chart ngắn gọn + QC data → draw"),
    ("vẽ QC trend bar cho data này", "qc", "draw", "QC chart + QC data → draw"),

    # ── QC data + QC intent mơ hồ ──
    ("Vẽ QC chart", "qc", "qc_suggest", "QC intent chưa rõ loại + QC data → qc_suggest"),
    ("vẽ biểu đồ QC", "qc", "qc_suggest", "VI QC intent → qc_suggest"),
    ("draw QC chart for this data", "qc", "qc_suggest", "EN QC intent → qc_suggest"),
    ("biểu đồ kiểm soát chất lượng", "qc", "qc_suggest", "VI mô tả QC → qc_suggest"),

    # ── QC data + generic chart (hoạt động bình thường) ──
    ("bar chart VALUE theo QCSHIFT", "qc", "draw", "Bar chart + cột → draw (QC data vẽ được generic)"),
    ("vẽ histogram của VALUE", "qc", "draw", "Histogram cụ thể + QC data → draw"),
    ("scatter plot VALUE vs INDEX", "qc", "draw", "Scatter + cột → draw"),

    # ── QUAN TRỌNG: Generic data + QC chart request ──
    ("Vẽ QC Trend Line", "generic", "info", "QC chart + generic data → info + giải thích"),
    ("QC Histogram", "generic", "info", "QC chart + generic data → info"),
    ("draw QC trend bar", "generic", "info", "EN QC chart + generic data → info"),
    ("biểu đồ QC trend", "generic", "info", "VI QC intent + generic data → info"),

    # ── Generic data + chart thông thường ──
    ("phân tích doanh thu theo tháng", "generic", "confirm", "Có metric + dimension → confirm"),
    ("bar chart revenue by product", "generic", "draw", "EN bar chart cụ thể → draw"),
    ("vẽ biểu đồ cho tôi", "generic", "suggest", "Mơ hồ → suggest"),
    ("show me something interesting", "generic", "suggest", "Vague EN → suggest"),

    # ── QC data + vague (catalog tự ưu tiên QC) ──
    ("vẽ biểu đồ cho tôi", "qc", "suggest", "Vague + QC data → suggest (QC charts lên đầu)"),
    ("phân tích data này", "qc", "suggest", "Vague VI + QC data → suggest"),

    # ── Off-topic ──
    ("hôm nay trời thế nào", "generic", "info", "Off-topic → info"),
    ("bạn là ai", "generic", "info", "Off-topic → info"),
]
```

### 10.2 Test fallback khi LLM fail

```python
class ErrorClient:
    def get_completion(self, messages):
        raise RuntimeError("Timeout")

def test_fallback_qc_domain():
    agent = SmartChatAgent(client=ErrorClient())
    result = agent.run("vẽ qc chart", QC_COLUMNS, "qc", [])
    assert result.action == "qc_suggest"  # fallback logic nhận ra "qc" + qc domain

def test_fallback_generic_domain():
    agent = SmartChatAgent(client=ErrorClient())
    result = agent.run("vẽ chart đi", [], "generic", [])
    assert result.action == "suggest"  # safe default
    # Không crash, trả về kết quả hợp lệ
```

### 10.3 E2E manual tests

| Journey | Test case | Expected |
|---|---|---|
| J1 | Load **QC data** → gõ "Vẽ QC chart" | Modal QC_SUGGEST: message thân thiện + 3 QC templates |
| J2 | Load **QC data** → gõ "QC Trend Line" | Chart vẽ ngay, không qua modal |
| J3 | Load **QC data** → gõ "vẽ bar chart VALUE theo QCSHIFT" | Chart vẽ ngay (generic chart trên QC data) |
| J4 | Load **QC data** → gõ "vẽ biểu đồ cho tôi" | Modal SUGGEST: QC charts lên đầu catalog |
| J5 | Load **generic data** → gõ "Vẽ QC Trend Line" | Modal INFO: giải thích data không phải QC + gợi ý chart thay thế |
| J6 | Load **generic data** → gõ "QC Histogram" | Modal INFO: giải thích + catalog generic |
| J7 | Load **generic data** → gõ "phân tích revenue theo tháng" | Modal CONFIRM: 3 gợi ý (Line/Bar/Area) |
| J8 | Load bất kỳ → gõ "vẽ chart đi" | Modal SUGGEST: 6 thumbnail |
| J9 | Gõ "hôm nay trời thế nào" | Modal INFO: giải thích + sample prompts |
| J10 | LLM timeout | Fallback vẫn trả kết quả hợp lệ, app không crash |

---

## 11. Lộ Trình Triển Khai

```
Step 1: Tạo agent_smart_chat.py (~2h)
        ├── SmartChatResult dataclass
        ├── SmartChatAgent.run()
        ├── _build_system_prompt() với QC section
        ├── _fallback_result() cho error case
        └── Unit tests với MockClient

Step 2: Sửa smart_chat endpoint (~1h)
        ├── Gọi SmartChatAgent thay vì classify_prompt
        ├── Route theo 5 actions
        ├── Thêm _get_default_qc_entries() helper
        └── Integration test

Step 3: Sửa Frontend (~1h)
        ├── ChartRecBox.tsx: xử lý "qc_suggest" + dùng message_vi từ backend
        ├── ChartAssistantModal.tsx: thêm QC_SUGGEST mode
        └── Manual test 6 journeys

Step 4: Dọn dẹp (~30min)
        ├── prompt_classifier.py: fix keyword list (Bug 1+2), đánh dấu deprecated
        └── Update TONG_QUAN_DU_AN.md
```

**Tổng: ~4.5 giờ**

---

## 12. Commit Plan

```
[S1] feat(agents): add SmartChatAgent with LLM reasoning + QC-aware suggestions
     Files: agent_smart_chat.py, tests/test_smart_chat_agent.py

[S2] feat(api): wire SmartChatAgent into smart_chat endpoint (5 actions)
     Files: agent_routes.py

[S3] feat(ui): handle qc_suggest action + use backend message_vi in modal
     Files: ChartRecBox.tsx, ChartAssistantModal.tsx

[S4] fix(classifier): fix rule-based keywords as backup (QC + no-diacritics VI)
     Files: prompt_classifier.py
```

---

## 13. Tóm Tắt

```

---

## 14. Cập Nhật Triển Khai (2026-05-26)

### 14.1 Đã hoàn thành

- Backend Smart Chat đã chạy theo hướng context-aware (domain + catalog + field matching), không còn phụ thuộc phân loại cứng đơn thuần.
- Luồng nhận diện chart intent đã xử lý tốt hơn các biến thể prompt người dùng (ví dụ nhập thiếu ký tự như `lin`, `box`, `pie`...).
- Chuẩn hóa mapping tên chart hiển thị ↔ internal chart type để tránh lỗi "chart không được hỗ trợ" khi bấm vẽ từ gợi ý.
- Nội dung gợi ý đã bổ sung rationale có ngữ nghĩa phân tích hơn (nêu mục tiêu tính toán/so sánh), thay vì chỉ liệt kê kênh.
- Frontend `ChartAssistantModal` đã thêm ô **Customize your prompt** dưới vùng gợi ý, cho phép user tự sửa prompt trước khi chạy.
- Frontend `ChartRecBox` đã nối end-to-end luồng submit custom prompt:
  - nhận prompt custom từ modal
  - đóng modal và cập nhật prompt input
  - gửi lại `deriveDataFromNL(...)` để vẽ
  - tự dò chart type ưu tiên từ nội dung custom nếu khớp suggestion hiện tại.

### 14.2 File đã thay đổi chính cho đợt này

- `src/components/ChartAssistantModal.tsx`
- `src/views/ChartRecBox.tsx`
- `py-src/data_formulator/agents/agent_smart_chat.py`

### 14.3 Kết quả xác nhận

- Build frontend thành công (`npm run -s build`).
- Luồng "gợi ý → custom prompt → submit" hoạt động xuyên suốt, không còn bị kẹt ở bước chỉ dùng prompt tự sinh.
TRƯỚC: classify(prompt) → label → route → canned message
SAU:   SmartChatAgent(prompt + columns + domain + catalog) → action + message tự nhiên

Ràng buộc domain (căn bản):
  ✓ QC data  → vẽ được TẤT CẢ 25 charts (QC + generic)
  ✓ Generic data → chỉ vẽ được 20 charts (không QC)
  ✓ Generic data + QC chart request → INFO + giải thích + catalog thay thế

Thay đổi cốt lõi:
  ✓ Agent nhận FULL context (prompt + columns + domain + catalog)
  ✓ LLM hiểu "vẽ QC chart" + QC data = qc_suggest (không cần hardcode keyword)
  ✓ LLM hiểu "vẽ QC Trend Line" + generic data = info + explain (không R2 lỗi tắt)
  ✓ message_vi tự sinh từ LLM (không còn canned "Prompt còn thiếu thông tin")
  ✓ Safety check backend: nếu LLM nhầm trả "draw" QC chart trên generic data → tự override sang "info"
  ✓ Fallback an toàn: LLM fail → rule-based logic, app không crash
  ✓ QC data + generic chart request → hoạt động bình thường (tôn trọng ý user)
  ✓ Tất cả linh hoạt: thêm chart type mới không cần sửa keyword list
```

## Update Note (2026-05-28)

### Smart Chat + Suggestion Reliability

- Fixed repeated modal loop when user clicks a suggestion and expects immediate draw.
  - `/smart-chat` now has a fast path: if `user_preferred_chart_type` is present, backend skips classifier routing and directly calls derive-data.
  - Result: clicking `Draw now` on a suggestion no longer bounces back to confirm/suggest modal.

- Fixed `draw -> confirm` downgrade guard for user-selected chart type.
  - If chart type was explicitly selected from UI, backend no longer downgrades to confirm just because prompt text does not mention fields.

- Normalized chart hint names before suggestion-family selection.
  - Internal names like `point`, `area`, `heatmap` are normalized to display names (`Scatter Plot`, `Area Chart`, `Heat Map`).
  - Result: prompt `draw a scatter plot` now prioritizes scatter suggestions correctly.

### Catalog/Template Channel Consistency

- Fixed channel-schema mismatch for charts whose internal compatibility channels differ from template channels:
  - Pie/Donut: internal `label/value` bridged to template `color/theta`.
  - Radial Plot: internal `x/y` bridged to template `theta/color`.
  - Threshold Bar Chart: mapped to internal `threshold` spec (not `bar`), and required `threshold` channel is enforced.

- Fixed Heat Map false-unavailable on gapminder-like numeric year schemas.
  - Heatmap `x` now accepts quantitative role as fallback (while still rejecting sequential/id-like misuse).
  - Result: Heat Map appears in catalog when data is actually drawable.

### Suggestion Quality + UX Stability

- Increased idea diversity for `Get some idea`.
  - Suggestions are now selected by family round-robin (compare/trend/relation/distribution/composition/matrix) instead of confidence-only top slice.
  - Result: reduced repetition and higher chance to see Pie/Heat suggestions when valid.

- Added safeguard against code-like suggestion text leaking into UI.
  - If enriched `sample_prompt_vi`/`rationale_vi` looks like code (`groupby`, `reset_index`, `data[...]`, etc.), backend keeps safe default natural-language text.

- Updated default suggestion prompt templates to English to avoid mixed-language UI output in suggestion chips.

### Chart Defaults

- Enabled `qcLimitsMode: true` by default for newly created charts.
  - Applied centrally in `generateFreshChart`, so agent-generated and user-created charts share the same default.

### Regression Coverage

- Added and updated tests for:
  - Smart-chat endpoint routing stability.
  - Catalog channel-bridge correctness (Pie/Radial/Threshold).
  - Heat Map availability on gapminder-like metadata.
  - Template constraints and suggestion drawability.
