# Prompt Guard Agent - Documentation

## Overview

**PromptGuardAgent** là một middleware agent được thiết kế để xác thực prompt của người dùng TRƯỚC khi gọi các main agents (`SQLDataRecAgent`, `PythonDataRecAgent`).

**Mục đích:**

- 🛡️ Chặn spam/gibberish/off-topic prompts sớm
- ⏱️ Tiết kiệm tokens bằng cách từ chối requests không hợp lệ ngay tập
- 🧠 Sử dụng LLM để phân tích semantic (không chỉ regex patterns)
- 📊 Chỉ cho phép prompts liên quan đến visualization/chart

## Architecture

```
User Input
    ↓
PromptGuardAgent.validate()  ← 🛡️ LLM-based semantic validation
    ↓
[ok=true]  →  SQLDataRecAgent.run()  →  Main processing
[ok=false] →  Return "blocked" response with user message
```

## Validation Criteria

Guard agent kiểm tra 4 tiêu chí:

### 1. **Empty** (Rỗng)

```python
Input: ""
Output: {
    "ok": False,
    "reason_code": "empty",
    "user_message": "Yêu cầu bị chặn: prompt trống..."
}
```

### 2. **Spam/Gibberish** (Vô nghĩa)

```python
Input: "aaa 123123 asdfgh"
Output: {
    "ok": False,
    "reason_code": "spam",
    "user_message": "Yêu cầu bị chặn: nội dung là spam..."
}
```

### 3. **Off-topic** (Không liên quan visualization)

```python
Input: "Làm sao để nấu cơm?"
Output: {
    "ok": False,
    "reason_code": "not_chart_related",
    "user_message": "Yêu cầu bị chặn: không liên quan vẽ biểu đồ..."
}
```

### 4. **Too Vague** (Quá mơ hồ)

```python
Input: "vẽ cái gì đó"
Output: {
    "ok": False,
    "reason_code": "too_vague",
    "user_message": "Yêu cầu bị chặn: quá mơ hồ. Vui lòng cung cấp chi tiết..."
}
```

### 5. **Valid** (Hợp lệ)

```python
Input: "Vẽ biểu đồ line doanh số bán hàng theo tháng"
Output: {
    "ok": True,
    "reason_code": "valid",
    "user_message": "✓ Prompt hợp lệ. Đang xử lý..."
}
```

## Integration Points

Guard đã được tích hợp vào:

### SQLDataRecAgent

```python
class SQLDataRecAgent:
    def __init__(self, client, conn, ...):
        self.guard = PromptGuardAgent(client=client)

    def run(self, input_tables, description, ...):
        guard_result = self.guard.validate(description)
        if not guard_result["ok"]:
            return [{"status": "blocked", "content": guard_result["user_message"]}]
        # ... continue normal processing

    def followup(self, ..., new_instruction, ...):
        guard_result = self.guard.validate(new_instruction)
        if not guard_result["ok"]:
            return [{"status": "blocked", ...}]
        # ... continue normal processing
```

### PythonDataRecAgent

```python
class PythonDataRecAgent:
    def __init__(self, client, ...):
        self.guard = PromptGuardAgent(client=client)

    def run(self, input_tables, description, ...):
        guard_result = self.guard.validate(description)
        if not guard_result["ok"]:
            return [{"status": "blocked", "content": guard_result["user_message"]}]
        # ... continue normal processing

    def followup(self, ..., new_instruction, ...):
        guard_result = self.guard.validate(new_instruction)
        if not guard_result["ok"]:
            return [{"status": "blocked", ...}]
        # ... continue normal processing
```

## Response Format (Blocked)

Khi prompt bị chặn, response trả về có format:

```json
{
    "status": "blocked",
    "code": "",
    "content": "Nội dung user message (thích hợp hiển thị cho user)",
    "agent": "SQLDataRecAgent" | "PythonDataRecAgent",
    "refined_goal": {
        "mode": "",
        "recommendation": "Lý do internal (VI)",
        "output_fields": [],
        "chart_encodings": {},
        "chart_type": ""
    },
    "guard": {
        "ok": false,
        "reason_code": "spam|not_chart_related|too_vague|empty|too_short",
        "reason": "Giải thích internal (VI)",
        "user_message": "..."
    },
    "dialog": [...]
}
```

## Token Savings

Without Guard:

```
Spam Prompt → MainAgent (expensive LLM call) → Response → Detect spam
                ↓
          Wasted ~100-500 tokens per spam request
```

With Guard:

```
Spam Prompt → GuardAgent (cheap LLM call ~50 tokens) → Blocked
                ↓
          Save ~400 tokens per spam request
          Early rejection = better UX
```

## Error Handling

Guard có robust error handling:

| Scenario         | Behavior                         |
| ---------------- | -------------------------------- |
| Empty input      | Reject (reason: "empty")         |
| API error        | Pass through (graceful fallback) |
| JSON parse error | Pass through (graceful fallback) |
| Missing client   | Pass through (graceful fallback) |

**Philosophy:** Guard should never block legitimate requests due to internal errors.

## Testing

Unit tests tại [test_prompt_guard_agent.py](test_prompt_guard_agent.py):

```bash
pytest test_prompt_guard_agent.py -v
```

Test coverage:

- ✅ Empty prompts
- ✅ Valid chart prompts (EN/VI)
- ✅ Spam detection
- ✅ Off-topic detection
- ✅ Vague prompt detection
- ✅ Error handling (JSON, API)

## Configuration

Guard sử dụng `gpt-4o-mini` mặc định (lightweight, nhanh, rẻ).

Để customize:

```python
guard = PromptGuardAgent(
    client=your_client,
    model="gpt-4-turbo"  # hoặc model khác
)
```

## Future Improvements

1. **Caching**: Cache validation results cho identical prompts
2. **Metrics**: Theo dõi spam rate, false positive rate
3. **Model tuning**: Fine-tune guard model sau khi có dữ liệu real-world
4. **Confidence scores**: Trả về confidence score khi uncertain
5. **Multi-language**: Hỗ trợ tốt hơn các ngôn ngữ khác (hiện tại tuned cho VI/EN)

## Contact & Issues

Nếu gặp vấn đề:

1. Check logs: tìm `Guard validation:` hoặc `🚫 Prompt blocked`
2. Verify client cấu hình: có OpenAI/Azure client không
3. Test standalone: `PromptGuardAgent.validate(prompt)`
