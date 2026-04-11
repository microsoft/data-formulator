# Language Injection for Agent Prompts

Detailed guide for the language injection system. The short version lives in `.cursor/rules/language-injection-conventions.mdc`.

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
| `agents/agent_language.py` | `build_language_instruction(lang, mode)` — generates prompt fragments; supports 20 languages; returns `""` for English |
| `agent_routes.py` → `get_language_instruction()` | Reads `Accept-Language` header, delegates to `build_language_instruction` |
| `src/app/utils.tsx` → `fetchWithIdentity()` | Sets `Accept-Language` header on every API request from `i18n.language` |

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

### Agent constructor — marker-based insertion

```python
if language_instruction:
    marker = "**About the execution environment:**"
    idx = self.system_prompt.find(marker)
    if idx > 0:
        self.system_prompt = (
            self.system_prompt[:idx]
            + language_instruction + "\n\n"
            + self.system_prompt[idx:]
        )
    else:
        self.system_prompt += "\n\n" + language_instruction
```

## Anti-Patterns (with explanations)

| Pattern | Why it's wrong |
|---------|---------------|
| `os.environ.get("DF_DEFAULT_LANGUAGE")` | Process-level — all users get same language; breaks multi-user |
| Global LLM client interceptor | Hidden behavior; can't distinguish full/compact mode; fragile string detection |
| New `MessageBuilder` class | Duplicates `agent_language.py`; creates parallel conflicting abstractions |
| Hardcoded `"回答请使用中文"` in prompts | Not configurable; skips the mode system; breaks for other languages |

## Adding a New Language

1. Add language code + display name to `LANGUAGE_DISPLAY_NAMES` in `agents/agent_language.py`.
2. Optionally add extra rules to `LANGUAGE_EXTRA_RULES` (e.g. simplified vs traditional Chinese).
3. Add frontend translations in `src/i18n/locales/<lang>/` — copy an existing locale folder as template.
4. No Agent code changes needed — the existing flow picks up new languages automatically.
