# Language Injection for Agent Prompts

Detailed guide for the language injection system. The short version lives in `.cursor/rules/language-injection-conventions.mdc`.

> **Prerequisites**: Read relevant guides in `dev-guides/` (e.g. streaming protocol, log sanitization) before development.
> If your work introduces new language injection patterns or conventions, update this file and related dev-guides accordingly.

## Architecture

```
Frontend i18n.language  →  Accept-Language header  →  get_language_instruction()
                                                           │
                                                   build_language_instruction()
                                                   (agents/agent_language.py)
                                                           │
                                              ┌────────────┴────────────┐
                                              ▼                         ▼
                                        mode="full"               mode="compact"
                                    (text-heavy agents)        (code-gen agents)
```

### Core Modules

| Module | Role |
|--------|------|
| `agents/agent_language.py` | `build_language_instruction(lang, mode)` — generates prompt fragments; `inject_language_instruction()` — injects into system prompts; supports 20 languages; returns `""` for English |
| `routes/agents.py` → `get_language_instruction()` | Reads `Accept-Language` header, delegates to `build_language_instruction` |
| `routes/agents.py` → `_get_ui_lang()` | Extracts primary language code from `Accept-Language` header |
| `src/app/utils.tsx` → `fetchWithIdentity()` | Sets `Accept-Language` header on every API request from `i18n.language` |
| `src/app/utils.tsx` → `translateBackend()` | Translates backend `message_code` / `content_code` using frontend i18n |

## Code Examples

### Route handler — inject language

```python
# In a Flask route handler:
lang_instruction = get_language_instruction(mode="compact")
lang_suffix = f"\n\n{lang_instruction}" if lang_instruction else ""

messages = [
    {"role": "system", "content": "You are a helpful assistant." + lang_suffix},
    {"role": "user", "content": user_input},
]
```

### Agent constructor — use inject_language_instruction()

```python
from data_formulator.agents.agent_language import inject_language_instruction

# Simple append (most agents)
system_prompt = inject_language_instruction(system_prompt, language_instruction)

# Insert before a marker (complex prompts)
system_prompt = inject_language_instruction(
    system_prompt, language_instruction,
    marker="**About the execution environment:**"
)
```

### Python-side user-visible messages — message_code pattern

For fixed strings in Python that appear in the UI, do NOT translate in Python.
Return a `message_code` and let the frontend translate:

```python
# In an Agent or route handler:
yield {
    "type": "error",
    "message": "Output DataFrame is empty (0 rows).",  # English fallback
    "message_code": "agent.emptyDataframe",             # frontend i18n key
}

# With parameters:
result = {
    "status": "error",
    "content": f"Fields not found: {missing}",
    "content_code": "agent.fieldsNotFound",
    "content_params": {"missing": missing, "available": available},
}
```

Frontend consumption:
```tsx
import { translateBackend } from '../app/utils';
const msg = translateBackend(event.message, event.message_code, event.message_params);
```

Translation keys go in `src/i18n/locales/{en,zh}/messages.json` under `messages.agent.*`.

## Anti-Patterns (with explanations)

| Pattern | Why it's wrong |
|---------|---------------|
| `os.environ.get("DF_DEFAULT_LANGUAGE")` | Process-level — all users get same language; breaks multi-user |
| Global LLM client interceptor | Hidden behavior; can't distinguish full/compact mode; fragile string detection |
| New `MessageBuilder` class | Duplicates `agent_language.py`; creates parallel conflicting abstractions |
| Hardcoded `"回答请使用中文"` in prompts | Not configurable; skips the mode system; breaks for other languages |
| Backend-side translation dict (`agent_messages.py`) | Forces adding every new language to Python; translations should all live in `src/i18n/locales/` |
| Hardcoded English UI strings in `.tsx` without `t()` | Not translatable; use `useTranslation` + `t('key')` |

## Adding a New Language

1. Add language code + display name to `LANGUAGE_DISPLAY_NAMES` in `agents/agent_language.py`.
2. Optionally add extra rules to `LANGUAGE_EXTRA_RULES` (e.g. simplified vs traditional Chinese).
3. Add frontend translations in `src/i18n/locales/<lang>/` — copy an existing locale folder as template.
4. No Agent code changes needed — the existing flow picks up new languages automatically.
