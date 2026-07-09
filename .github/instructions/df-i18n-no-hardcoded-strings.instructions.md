---
description: "Require all user-visible frontend text to go through the i18n system (react-i18next) instead of hardcoded strings, for any TypeScript/TSX file under src/"
applyTo: "src/**/*.{ts,tsx}"
lastReviewed: 2026-07-09
---

# i18n: No Hardcoded UI Strings (Data Formulator)

Ported from `.cursor/rules/i18n-no-hardcoded-strings.mdc` (source combined `alwaysApply: true` with a glob — scoped here to the glob only, since unscoped always-on would inject frontend i18n guidance into backend Python work).

All user-visible text in the frontend MUST go through i18n. Never hardcode Chinese, English, or any other language string directly in components.

## How to Use

In components, use `useTranslation()` → `t('common.save')`. In non-component contexts (Redux thunks, plain `.ts` utilities — hooks aren't available there), import the i18n instance directly: `i18n.t('messages.rowLimitReached', { count })`.

## Translation Files

- English: `src/i18n/locales/en/<namespace>.json`; Chinese: `src/i18n/locales/zh/<namespace>.json`.
- Namespaces: `common`, `upload`, `chart`, `model`, `encoding`, `messages`, `navigation`, `dataLoading`, `errors`.
- Add new keys to **both** `en` and `zh`. Create a new namespace only if none fits.

## What Counts as User-Visible

Must use `t()`: button labels, tooltips, placeholders, error messages, dialog titles, tab names, toasts, table headers, empty-state text.

May stay hardcoded: `console.log` messages, thrown-but-never-displayed errors, internal constants, CSS class names, test IDs. Cross-stack sentinel values (e.g. `UNTITLED_SESSION` shared between Redux and the backend workspace API) must NOT be translated — they're internal identity markers, translate only at the rendering layer.

## Backend Messages (`message_code` pattern)

When the backend returns a `message_code`/`content_code`/`error_code`, translate with `translateBackend(fallback, code, params)` from `src/app/utils.tsx` — never translate in Python. Keys live in `messages.json` under `agent`.

## Anti-Patterns

| Anti-pattern                                          | Correction                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `<Button>保存</Button>` or `<Button>Save</Button>`    | `<Button>{t('common.save')}</Button>`                             |
| `const { t } = useTranslation()` inside a Redux thunk | `import i18n from '../i18n'; i18n.t('key')`                       |
| Adding a key to `en` only                             | Add to both `en` and `zh` in the same change                      |
| Translating a cross-stack sentinel constant           | Keep the sentinel untranslated; map to `t()` only at the UI layer |

## Would Revise If

Revise if the namespace list changes and this file isn't updated in the same change, or if a non-en/zh locale is added and the "add to both" rule needs to become "add to all."
