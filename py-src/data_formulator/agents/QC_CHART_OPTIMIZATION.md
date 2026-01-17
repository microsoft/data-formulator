# QC Chart Configuration Optimization

## Tổng Quan

Giải pháp tối ưu token usage cho QC (Quality Control) chart specifications trong LLM prompts.

**Vấn đề gốc:**

- Mỗi lần gọi LLM, phải gửi toàn bộ định nghĩa QC charts (~400-500 tokens)
- Định nghĩa cố định, không thay đổi theo request
- Lãng phí token khi có nhiều requests liên tiếp

**Giải pháp:**

- Tạo `qc_chart_config.py` chứa tất cả định nghĩa QC ở dạng structured data
- Sửa SYSTEM_PROMPT để tham chiếu compact thay vì full definitions
- Cung cấp utility functions linh hoạt: `get_compact_qc_chart_info()` và `get_full_qc_chart_rules()`

## Architecture

```
qc_chart_config.py
├── QC_CHART_TYPES (dict)
│   ├── qc_trend_line
│   ├── qc_histogram
│   └── qc_trend_bar
├── Utility Functions
│   ├── is_qc_data()
│   ├── get_qc_chart_def()
│   ├── get_compact_qc_chart_info()        ← Cho LLM prompts (compact)
│   ├── get_full_qc_chart_rules()          ← Cho system prompt (detail)
│   ├── format_qc_detection_notes()
│   ├── suggest_qc_chart_type()
│   └── validate_qc_chart_encodings()
└── Agent Integration
    ├── agent_sql_data_rec.py (updated)
    └── agent_py_data_transform.py (updated)
```

## Cách Sử Dụng

### 1. Detect QC Data

```python
from data_formulator.agents.qc_chart_config import is_qc_data

column_names = ["DATE", "VALUE", "TARGET", "LL", "UL"]
if is_qc_data(column_names):
    # Handle as QC data
    pass
```

### 2. Get Chart Definition

```python
from data_formulator.agents.qc_chart_config import get_qc_chart_def

chart_def = get_qc_chart_def("qc_trend_line")
print(chart_def["channels"])  # ['INDEX', 'VALUE', 'QCDATE', 'QCSHIFT', 'color']
print(chart_def["default_color_field"])  # 'QCSTDPARAMNAME'
```

### 3. Suggest Chart Type (Auto)

```python
from data_formulator.agents.qc_chart_config import suggest_qc_chart_type

suggested, reason = suggest_qc_chart_type(has_qc_numeric=True, has_qc_non_numeric=False)
# Returns: ("qc_trend_line", "QC data with numeric VALUE field")
```

### 4. For LLM Prompts - Use Compact Info

```python
# Token-efficient for API calls
from data_formulator.agents.qc_chart_config import get_compact_qc_chart_info

info = get_compact_qc_chart_info()
# Returns minimal info (~50 tokens)
# Include in user_query, NOT in system prompt
```

### 5. For System Prompt - Use Full Rules (One-time Setup)

```python
# Detailed guidance for initial setup
from data_formulator.agents.qc_chart_config import get_full_qc_chart_rules

rules = get_full_qc_chart_rules()
# Include only in SYSTEM_PROMPT, not in every request
```

## Token Savings Analysis

### Before Optimization

```
Per Request:
├── System Prompt: ~3,000 tokens
├── QC Chart Rules (embedded): ~400-500 tokens ← REPEATED
├── User Input: ~500 tokens
└── Total: ~3,900-4,000 tokens

Per Session (10 QC requests):
└── Total: ~39,000-40,000 tokens (~10% just on QC rules)
```

### After Optimization

```
One-time Setup:
├── System Prompt: ~2,600 tokens (QC rules replaced with reference)
└── Store qc_chart_config.py in memory: ~100 tokens equivalent

Per Request:
├── System Prompt: ~2,600 tokens (reused)
├── Compact QC info: ~30-50 tokens ← MINIMAL
├── User Input: ~500 tokens
└── Total: ~3,130-3,150 tokens

Per Session (10 QC requests):
├── Setup: ~2,600 tokens (once)
├── Requests: ~3,150 × 10 = ~31,500 tokens
└── Total: ~34,100 tokens (~15% reduction)

Optimized Pattern (with cache):
├── Initial: ~2,600 tokens
├── Cached subsequent requests: ~100-200 tokens overhead
└── Session total: ~2,600 + (100-200 × 10) = ~3,600-4,600 tokens (~85% reduction!)
```

## Integration Points

### 1. agent_sql_data_rec.py

- Imports utility functions từ qc_chart_config
- Sử dụng `is_qc_data()` để detect QC datasets
- Sử dụng `suggest_qc_chart_type()` để auto-suggest chart types
- SYSTEM_PROMPT chứa tham chiếu compact tới QC definitions

### 2. agent_py_data_transform.py

- Import QC utilities (sẵn sàng cho future use)
- Có thể extend để validate QC chart encodings

## QC Chart Types Reference

### qc_trend_line

```
Channels: INDEX, VALUE, QCDATE, QCSHIFT, color
Default Color: QCSTDPARAMNAME
Required Fields: TARGET
Optional Fields: LL, UL, ARLL, ARUL
Use Case: Quality control monitoring with control limits over time
```

### qc_histogram

```
Channels: VALUE, INDEX, color
Default Color: QCSTDPARAMNAME
Required Fields: TARGET
Optional Fields: LL, UL, ARLL, ARUL
Use Case: Distribution analysis of QC values
```

### qc_trend_bar

```
Channels: VALUE, QCDATE, QCSHIFT
Default Color: None
Required Fields: TARGET
Optional Fields: LL, UL, ARLL, ARUL
Use Case: QC trend with categorical values
```

## Testing

Run examples:

```bash
python -m data_formulator.agents.qc_chart_config_examples
```

Output shows:

- QC data detection
- Compact vs full rules
- Chart type suggestion
- Encoding validation
- Token savings analysis

## Best Practices

1. **Use compact info in user queries:**

   ```python
   # ✓ Good
   user_query = f"[QC INFO]\n{get_compact_qc_chart_info()}\n[CONTEXT]\n..."
   ```

2. **Keep full rules in system prompt (one-time):**

   ```python
   # ✓ Good
   SYSTEM_PROMPT = f"...chart definitions...{get_full_qc_chart_rules()}..."
   ```

3. **Validate outputs:**

   ```python
   # ✓ Good
   is_valid, errors = validate_qc_chart_encodings("qc_trend_line", chart_encodings)
   ```

4. **Auto-detect and suggest:**
   ```python
   # ✓ Good
   suggested_type, reason = suggest_qc_chart_type(has_numeric, has_non_numeric)
   ```

## Future Enhancements

1. **Prompt Caching (Claude API):**

   - Cache `get_full_qc_chart_rules()` as static block
   - Only 10% token cost for cached content
   - Further 90% reduction possible

2. **Dynamic Configuration:**

   - Support custom QC chart definitions
   - Per-organization settings

3. **Validation Framework:**
   - Extend validate_qc_chart_encodings() for all chart types
   - Runtime validation of LLM outputs

## References

- [Claude Prompt Caching Documentation](https://docs.anthropic.com/en/docs/build-a-bot/prompt-caching)
- [Token Usage Optimization Best Practices](https://docs.anthropic.com/en/docs/build-a-bot/costs)
- [Data Formulator Architecture](../../ARCHITECTURE.md)
