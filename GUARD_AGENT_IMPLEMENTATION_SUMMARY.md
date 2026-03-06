# PromptGuardAgent Implementation Summary

## Overview

The PromptGuardAgent is a middleware validation layer that prevents spam/off-topic chart requests from consuming expensive LLM tokens. It uses lightweight semantic analysis (gpt-4o-mini) to validate user prompts before passing them to main agents.

## Key Characteristics

### Language Support (Current Implementation)

- **Input**: Accepts prompts in ANY language (English, Vietnamese, French, Spanish, etc.)
- **Output**: Returns output in the SAME LANGUAGE as detected in the input
- **Fallback**: If language cannot be detected, defaults to English
- **Design Principle**: Multilingual input → Multilingual output (same language match)

### Core Architecture

- **Model**: `gpt-4o-mini` (lightweight, efficient)
- **Client**: LiteLLM wrapper (unified interface across providers)
- **API Method**: `client.get_completion()` (NOT OpenAI SDK)
- **Response Format**: JSON with explicit output structure

## Component Files

### 1. `prompt_guard_agent.py`

**Purpose**: Main guard agent implementation

**Class**: `PromptGuardAgent`

- Accepts: prompts in any language
- Returns: validation dict with English-only output

**Method**: `validate(prompt: str, data_columns: List[str] = None) -> Dict`

**Response Structure**:

```json
{
  "ok": boolean,
  "reason_code": "valid|spam|not_chart_related|too_vague|empty|too_short|qc_data_mismatch|guard_error",
  "reason": "Internal log message in English (for internal logging only)",
  "detected_language": "en|vi|fr|es|de|zh|ja|...",
  "is_qc_chart_request": boolean,
  "is_qc_data": boolean,
  "user_message": "Friendly message for user (in detected input language, or English default)"
}
```

**Validation Criteria**:

- ✅ **ACCEPT**: Has specific chart type keyword (bar, line, pie, bubble, etc.) in any language
- ✅ **ACCEPT**: Data visualization/analysis related request
- ✅ **ACCEPT**: QC chart type (qc_trend_bar, qc_histogram, etc.) WITH QC data (VALUE, LL, UL, CENTER_LINE columns)
- ❌ **REJECT**: Spam/gibberish (repeated chars, meaningless like "alo 1234")
- ❌ **REJECT**: Off-topic (not chart-related)
- ❌ **REJECT**: Too vague (wants "draw chart" without specifying type)
- ❌ **REJECT**: QC chart type requested BUT data doesn't have QC characteristics (no VALUE, LL, UL, etc.)

**QC-Specific Validation**:

The guard agent now automatically detects:

- QC-specific chart types: `qc_trend_bar`, `qc_trend_line`, `qc_histogram`, `qc_box_plot`, `qc_pareto`, `qc_control_chart`, etc.
- QC data characteristics: columns like `VALUE`, `LL` (Lower Limit), `UL` (Upper Limit), `LSL`, `USL`, `CENTER_LINE`, `UCL`, `LCL`, etc.

If a user requests a QC chart but provides non-QC data columns, the guard warns them with a message like:

> "⚠️ You selected a QC chart type. These chart types are designed for QC data with columns like VALUE, LL, UL, CENTER_LINE. Your data doesn't appear to have these QC characteristics. Please choose a different chart type or select data with QC measurements."

This message is delivered in the user's input language (Vietnamese, French, etc.)

**Error Handling**:

- **Fail-Closed Design**: On any error, rejects request with guard_error code
- **Why**: Safer than passing through invalid requests
- **Logging**: All errors logged with full context for debugging

### 2. `agent_sql_data_rec.py` (Integration Point 1)

**Location**: SQLDataRecAgent class

**Integration Points**:

- Line 296: Guard initialization
- Line 452-467: First guard call in `run()` method
- Line 627-642: Second guard call in `followup()` method

**Pattern**:

```python
guard_result = self.guard.validate(user_prompt)
if not guard_result["ok"]:
    return {
        "status": "error",
        "content": guard_result["user_message"],  # English message to user
        "guard": guard_result  # Full result for logging
    }
```

### 3. `agent_py_data_rec.py` (Integration Point 2)

**Location**: PythonDataRecAgent class

**Integration Points**:

- Line 261: Guard initialization
- Line 338-353: First guard call in `run()` method
- Line 388-403: Second guard call in `followup()` method

**Same integration pattern as SQLDataRecAgent**

### 4. `test_prompt_guard_agent.py` (Test Suite)

**Test Coverage**:

- Empty prompt rejection
- Very short prompt rejection
- Client unavailable handling
- Valid English chart prompt
- Valid Vietnamese chart prompt (accepts, returns English output)
- Spam prompt rejection with English message
- Off-topic prompt rejection with English message
- Vague prompt rejection with English message
- JSON decode error handling
- API error handling

**Key Test Assertions**:

- All user_message fields checked for English content
- LiteLLM API format verified (get_completion method)
- Error codes properly set (guard_error for client/API issues)

## System Prompt

The LLM system prompt instructs the model to:

1. **Detect input language** (English, Vietnamese, French, Spanish, etc.)
2. **Return ONLY JSON** output (no extra text)
3. **Output in detected language** (user_message in same language as input)
4. **Provide contextual user_message** (friendly, specific suggestions on rejection, in user's language)

Key excerpt from system prompt:

```
STEP 1: DETECT INPUT LANGUAGE
- Analyze the user's prompt to identify their language
- Common codes: 'en' (English), 'vi' (Vietnamese), 'fr' (French), 'es' (Spanish), etc.
- If language cannot be clearly identified, default to 'en' (English)

IMPORTANT ABOUT user_message:
- MUST BE IN THE SAME LANGUAGE AS THE USER'S INPUT
- If detected_language is 'vi', respond in Vietnamese
- If detected_language is 'en', respond in English
- If detected_language is 'fr', respond in French
```

## Error Messages (Multilingual Defaults)

### Default Fallback Messages by Language

**English (en)**:

```python
{
  "valid": "✓ Ready. Processing your request...",
  "spam": "❌ That request doesn't make sense. Please enter a clear chart visualization request.",
  "not_chart_related": "❌ That's not related to chart visualization. What chart would you like to create?",
  "too_vague": "❌ Please specify which chart type you want: 'draw line chart', 'bar chart', 'pie chart', 'scatter plot', etc.",
}
```

**Vietnamese (vi)**:

```python
{
  "valid": "✓ Sẵn sàng. Đang xử lý yêu cầu của bạn...",
  "spam": "❌ Yêu cầu đó không có ý nghĩa. Vui lòng nhập yêu cầu trực quan hóa biểu đồ rõ ràng.",
  "not_chart_related": "❌ Đó không liên quan đến biểu đồ. Bạn muốn tạo biểu đồ gì?",
  "too_vague": "❌ Vui lòng chỉ định loại biểu đồ: 'vẽ biểu đồ line', 'bar chart', 'pie chart', 'scatter plot', v.v.",
}
```

**French (fr)**:

```python
{
  "valid": "✓ Prêt. Traitement de votre demande...",
  "spam": "❌ Cette demande n'a pas de sens. Veuillez entrer une demande de visualisation graphique claire.",
  "not_chart_related": "❌ Ce n'est pas lié à la visualisation graphique. Quel graphique souhaitez-vous créer?",
  "too_vague": "❌ Veuillez spécifier le type de graphique: 'tracer un graphique linéaire', 'graphique en barres', 'graphique circulaire', etc.",
}
```

### Example Outputs

**Input**: "vẽ biểu đồ line" (Vietnamese)
**Output** (in Vietnamese):

```json
{
  "ok": true,
  "reason_code": "valid",
  "detected_language": "vi",
  "reason": "Clear chart request",
  "user_message": "Sẵn sàng. Đang xử lý yêu cầu của bạn..."
}
```

**Input**: "Draw a bar chart" (English)
**Output** (in English):

```json
{
  "ok": true,
  "reason_code": "valid",
  "detected_language": "en",
  "reason": "Clear chart request",
  "user_message": "Ready. Processing your request..."
}
```

**Input**: "Créer un graphique" (French - too vague)
**Output** (in French):

```json
{
  "ok": false,
  "reason_code": "too_vague",
  "detected_language": "fr",
  "reason": "No specific chart type mentioned",
  "user_message": "Veuillez spécifier le type de graphique: 'tracer un graphique linéaire', 'graphique en barres', 'graphique circulaire', etc."
}
```

**Input**: "alo 1234" (spam, unrecognized language)
**Output** (defaults to English):

```json
{
  "ok": false,
  "reason_code": "spam",
  "detected_language": "en",
  "reason": "Meaningless content",
  "user_message": "That request doesn't make sense. Please enter a clear chart visualization request."
}
```

## Integration Pattern

### Standard Flow

```
User Input (Any Language: Vietnamese, English, French, Spanish, etc.)
    ↓
Guard.validate() → LLM language detection & analysis
    ↓
    ├─ VALID → Continue to data agent
    │          (user_message returned in user's language)
    │
    └─ INVALID → Return error with user_message in user's language
                 (never reaches main agent)
```

### Benefits

1. **Token Savings**: Spam/off-topic rejected before expensive processing
2. **Better UX**: Contextual error messages in user's language
3. **Consistent Behavior**: All agents have same validation logic
4. **Professional Output**: Multilingual support improves user experience globally
5. **Language Preservation**: Users receive feedback in their own language

## Changes from Previous Version

### Language Implementation

- **Previous**: Always returns English, accepts any input language
- **Current**: Detects input language and returns output in the same language
- **Reason**: Better user experience - users receive feedback in their own language
- **Fallback**: If language cannot be detected, defaults to English (safer default)

### Supported Languages

Current multilingual support includes:

- English (en) - complete
- Vietnamese (vi) - complete
- French (fr) - complete
- Spanish (es) - complete
- German (de) - LLM-generated fallback
- Chinese (zh) - LLM-generated fallback
- Japanese (ja) - LLM-generated fallback
- Any other language - LLM-generated fallback

### API Compatibility

- **Before**: Used OpenAI SDK format (chat.completions.create)
- **After**: Uses LiteLLM format (get_completion)
- **Reason**: Matches actual client interface in codebase

### Error Handling

- **Before**: Attempted graceful pass-through on errors
- **After**: Reject on errors (fail-closed)
- **Reason**: Safer design - prevents invalid requests from consuming tokens

### Response Format

- **Before**: Optional user_message field
- **After**: Always includes user_message with fallback defaults
- **Reason**: Ensures user always gets helpful message

## Testing Validation

All tests updated to:

1. Use LiteLLM API format (get_completion)
2. Expect detected_language field in response
3. Test multilingual input → corresponding language output
4. Test Vietnamese input → Vietnamese output
5. Test English input → English output
6. Test French input → French output
7. Test language fallback to English when unrecognized
8. Check fallback defaults work when LLM doesn't provide message
9. Test QC chart detection and QC data validation
10. Test QC data mismatch warnings

**Test Cases for QC Validation**:

- `test_qc_chart_with_qc_data`: QC chart type + QC data columns → VALID
- `test_qc_chart_without_qc_data`: QC chart type + non-QC data → REJECT with warning
- `test_qc_chart_vietnamese_without_qc_data`: Vietnamese QC request + non-QC data → REJECT in Vietnamese
- `test_non_qc_chart_with_qc_data`: Regular chart type + QC data → VALID (no mismatch)

**Run tests**:

```bash
pytest py-src/data_formulator/agents/test_prompt_guard_agent.py -v
```

## QC Data Validation Feature

The guard agent now includes intelligent QC data validation:

### How It Works

1. **Detect QC Chart Types**: Automatically recognizes QC-specific chart requests:

   - `qc_trend_bar`, `qc_trend_line`, `qc_histogram`, `qc_box_plot`
   - `qc_pareto`, `qc_control_chart`, `qc_cpk`, `qc_scatter`, `qc_dispersion`, `qc_capability`
   - Works in multiple languages: "vẽ qc trend bar" (Vietnamese), "créer qc graphique" (French)

2. **Check Data Characteristics**: Validates if provided data has QC indicators:

   - **Required**: `VALUE` column (main measurement)
   - **Plus at least one**: `LL` (Lower Limit), `UL` (Upper Limit), `LSL`, `USL`, `CENTER_LINE`, `UCL`, `LCL`

3. **Smart Warnings**: If QC chart type is requested but data lacks QC characteristics:
   - ✅ User gets a friendly, contextual warning
   - ✅ Message is in their input language
   - ✅ Suggests alternative chart types
   - ✅ Prevents token waste on incompatible chart generation

### Usage

```python
from data_formulator.agents.prompt_guard_agent import PromptGuardAgent

guard = PromptGuardAgent(client=client)

# Input with QC data columns
qc_columns = ['VALUE', 'LL', 'UL', 'CENTER_LINE', 'timestamp', 'product_id']

# This passes - valid QC chart + QC data
result = guard.validate("Draw a QC Trend Bar chart", data_columns=qc_columns)
assert result["ok"] is True

# This fails - QC chart but no QC data
non_qc_columns = ['sales', 'quantity', 'timestamp']
result = guard.validate("Draw a QC Trend Bar chart", data_columns=non_qc_columns)
assert result["ok"] is False
assert result["reason_code"] == "qc_data_mismatch"
assert result["is_qc_chart_request"] is True
assert result["is_qc_data"] is False
```

### Response Fields for QC Validation

```json
{
  "is_qc_chart_request": boolean,  // True if user requested QC-specific chart
  "is_qc_data": boolean,            // True if data has QC characteristics
  "reason_code": "qc_data_mismatch" // Set when QC chart requested but no QC data
}
```

### Example Warning Message (Vietnamese)

User prompt: "vẽ qc trend line"  
Data columns: `['sales', 'quantity', 'date']` (non-QC)

Guard response:

```
⚠️ Bạn đã chọn loại biểu đồ QC (như QC Trend Bar, QC Histogram).
Các loại biểu đồ này được thiết kế cho dữ liệu QC với các cột như VALUE, LL, UL, CENTER_LINE.
Dữ liệu của bạn không có các đặc trưng QC.
Vui lòng chọn loại biểu đồ khác hoặc sử dụng dữ liệu có đo lường QC.
```

## Deployment Checklist

- [x] Guard agent fully implemented with QC validation
- [x] Language detection in system prompt
- [x] Multilingual default messages (en, vi, fr, es)
- [x] QC chart type detection (regex patterns)
- [x] QC data validation (column name checking)
- [x] QC mismatch warnings in user's language
- [x] Integrated into SQLDataRecAgent
- [x] Integrated into PythonDataRecAgent
- [x] All test cases updated for multilingual + QC validation
- [x] Tests verify language detection
- [x] Tests verify QC data mismatch detection
- [x] Fallback defaults for multiple languages
- [x] LiteLLM API compatibility verified
- [x] System prompt supports language detection
- [x] Documentation updated with QC examples
- [x] detected_language, is_qc_chart_request, is_qc_data fields in response

## Known Limitations

1. **Language Detection**: While LLM is good at language detection, some edge cases (code-like prompts) may be misclassified
2. **Uncommon Languages**: Languages not specifically translated in defaults will use LLM-generated fallback
3. **QC Data Heuristics**: Detection based on column names; some QC variants may use different naming conventions
4. **Context Length**: Very long prompts may trigger length limits (handled gracefully)
5. **Special Characters**: Unusual Unicode or mixed-language text may be challenging (rare, logged)
6. **Accent Marks**: Vietnamese text without proper diacritics may be partially misunderstood (acceptable for technical requests)

## Future Improvements

1. **Performance**: Cache guard results for identical prompts
2. **Analytics**: Track rejection patterns for system improvements
3. **Customization**: Allow different validation rules per use case
4. **Multi-User**: Add user profile awareness for personalized messages

## Support & Debugging

**Check guard logs**:

```python
import logging
logger = logging.getLogger("data_formulator.agents.prompt_guard_agent")
logger.setLevel(logging.DEBUG)
```

**Monitor rejection patterns**:

- Guard logs all rejections with reason_code
- user_message shown to user (always in English)
- reason field available in response dict for debugging

**Common Issues**:

1. Client not initialized → guard returns guard_error
2. LLM response malformed → falls back to default English message
3. API timeout → caught and returns guard_error

---

**Status**: ✅ COMPLETE - Ready for production deployment
**Language**: English (output), Multilingual (input)
**Last Updated**: Current session
