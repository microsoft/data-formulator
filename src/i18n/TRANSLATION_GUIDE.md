# Data Formulator — Translation Guide

This document describes how the internationalization (i18n) system works in
Data Formulator. It is intended for contributors who need to add, modify, or
review translation files, and for anyone adding support for a new language.

---

## 1. Architecture Overview

| Layer | File | Purpose |
|---|---|---|
| i18n bootstrap | `src/i18n/index.ts` | Initialises **i18next** with `react-i18next` and `i18next-browser-languagedetector`. |
| Per-language aggregator | `src/i18n/locales/{lang}/index.ts` | Imports every domain JSON and **spreads** them into a single flat `translation` namespace. |
| Domain JSON files | `src/i18n/locales/{lang}/*.json` | Actual key → value translations, grouped by **domain** (not by page). |
| Language registry | `src/i18n/locales/index.ts` | Re-exports all language bundles so the bootstrap file can build the `resources` map. |

```
src/i18n/
├── index.ts                          # i18next init
└── locales/
    ├── index.ts                      # { en, zh }
    ├── en/
    │   ├── index.ts                  # spread-merge all *.json → one object
    │   ├── common.json               # app-wide UI strings
    │   ├── chart.json                # chart rendering & gallery
    │   ├── encoding.json             # encoding shelf & channels
    │   ├── messages.json             # snackbar & system messages
    │   ├── model.json                # LLM model configuration
    │   ├── navigation.json           # nav / routing labels
    │   └── upload.json               # data upload & import
    └── zh/
        └── (same structure as en/)
```

### How Keys Are Resolved

All domain JSON files are **spread-merged** into a single namespace called
`translation`. For example, `chart.json` contains:

```json
{ "chart": { "msgTable": "..." } }
```

and the key `chart.msgTable` is accessed via `t('chart.msgTable')`.

Because keys from all files are merged at runtime, **key prefixes must be
unique across files** — no two files should export the same top-level key.

### Language Detection

The detector checks, in order:

1. `localStorage` (key: `i18nextLng`)
2. Browser `navigator.language`

Fallback language is **`en`** (English).

---

## 2. What CAN Be Translated

The following categories of UI text are safe to translate with `t()`:

| Category | Examples | Typical JSON file |
|---|---|---|
| Button labels, menu items | "Save", "Cancel", "Delete" | `common.json` |
| Dialog titles & descriptions | "Reset Session?", "Import failed" | `common.json` |
| Informational messages | Snackbar text, warnings, errors | `messages.json` |
| Section headings & static labels | "Data Threads", "Reports" | `common.json` / `navigation.json` |
| Tooltip text for icons / buttons | "export session", "create a new chart" | various |
| Form placeholders & hints | "what do you want to visualize?" | `encoding.json` / `chart.json` |
| Encoding shelf labels | "Data Type", "Sort By", "Aggregate" | `encoding.json` |
| Channel **display** labels | "x-axis", "color", "size" (via `encoding.channelX` etc.) | `encoding.json` |
| Gallery section / entry labels | "Bar Chart", "Pie Chart", etc. | `chart.json` |

**Rule of thumb:** If the string is *only* rendered for the user to read and
is never referenced by any computation, matching, serialisation, or code
generation, it is safe to translate.

---

## 3. What MUST NOT Be Translated

> **Cardinal Rule — prefer not translating over introducing bugs.**
>
> If there is any doubt about whether translating a value could affect
> computation, field matching, data binding, code generation, or API
> contracts, **do not translate it**.

### 3.1 Field Names (`FieldItem.name`, `FieldItem.id`)

Field names flow through the entire pipeline:

- They are keys in `encodingMap` entries (`fieldID`).
- They appear in generated Python / SQL code as column references.
- They are used for table-column matching, derived-field resolution, and
  output variable naming.
- They are matched against backend responses and Vega-Lite spec properties.

**Never** replace a `field.name` or `field.id` display with `t(...)`. The
raw value must always be what the user sees in contexts where it is bound to
computation.

### 3.2 Chart Type Identifiers (`chart.chartType`)

Values like `"Bar"`, `"Scatter"`, `"Line"`, `"Auto"`, `"Table"`, `"?"` are
internal identifiers. They are used in:

- `assembleVegaChart(chartType, ...)` — chart assembly.
- Conditional rendering (`chartType === "Auto"`, etc.).
- Redux dispatches (`updateChartType`, `createNewChart`).
- File-name generation (`${chartType}-${id}.png`).

**Never** pass a translated string where `chartType` is expected.

### 3.3 Encoding Channel Keys

The encoding channel **keys** (`"x"`, `"y"`, `"color"`, `"size"`,
`"shape"`, `"column"`, `"row"`, etc.) are part of the Vega-Lite schema and
the internal `EncodingMap` contract.

Translated *display labels* for channels (e.g., `encoding.channelColor` →
"颜色") are fine, but the **programmatic key** must remain the English
identifier.

### 3.4 Aggregate / Transform Tokens

Tokens such as `"sum"`, `"mean"`, `"count"`, `"bin"`, `"median"` are passed
directly into Vega-Lite specs and code-generation prompts. Do not translate
these internal values.

### 3.5 Vega-Lite Spec Properties

Any value written into a Vega-Lite or ECharts specification object (mark
types, scale types, axis format strings, scheme names, etc.) must remain in
its original English form.

### 3.6 API / Redux Action Payloads

Strings that are dispatched to Redux actions or sent to backend API
endpoints (table IDs, chart IDs, model names, etc.) are never translated.

### 3.7 Test Data & Debug Content

Strings originating from test-data generators (e.g., `TestCase.title`,
`TestCase.description`, `TestCase.tags`) are developer-facing debug content
and are not translated.

### Summary Table

| Item | Translate? | Reason |
|---|---|---|
| `FieldItem.name` / `.id` | **NO** | Used in code gen, matching, binding |
| `chart.chartType` | **NO** | Internal identifier for assembly & dispatch |
| Encoding channel keys | **NO** | Vega-Lite schema contract |
| Aggregate / transform tokens | **NO** | Passed to spec & code gen |
| Spec property values | **NO** | Vega-Lite / ECharts contracts |
| Redux action payloads | **NO** | Internal state management |
| Button / label text | YES | Pure display |
| Tooltip explanations | YES | Pure display |
| Error / warning messages | YES | Pure display |
| Gallery entry labels | YES | Pure display (already mapped to keys) |

---

## 4. The Tooltip Strategy for Encoding Channel Labels

Encoding channel labels (x-axis, y-axis, color, opacity, etc.) are already
translated via `encoding.channel*` keys. In addition, each channel has a
**descriptive tooltip** (via `encoding.channel*_tip` keys) that provides a
brief explanation when the user hovers over the label.

1. **Channel display name** uses `encoding.channelX`, `encoding.channelY`, etc.
2. **Channel tooltip** uses `encoding.channelX_tip`, `encoding.channelY_tip`, etc.
3. Both live in `encoding.json`.

### Example (simplified)

```tsx
import { Tooltip, Typography, IconButton } from '@mui/material';
import { useTranslation } from 'react-i18next';

function ChannelLabel({ channel }: { channel: string }) {
    const { t } = useTranslation();
    const display = t(`encoding.channel${channel}`);
    const tip = t(`encoding.channel${channel}_tip`);
    return (
        <Tooltip title={tip} placement="left" arrow>
            <IconButton>
                <Typography variant="caption">{display}</Typography>
            </IconButton>
        </Tooltip>
    );
}
```

### Important Notes

- **Data field names** (e.g., `price`, `date`) are user data and should
  **not** have tooltips — they are displayed as-is.
- The `<Tooltip>` only provides *additional* context — never replaces.
- Adding a `<Tooltip>` must not change the DOM structure in a way that
  breaks existing event handlers, drag-and-drop, or layout.

---

## 5. Locale File Organisation

### Domain-Based Grouping

Files are grouped by **functional domain**, not by page:

| File | Top-level Key | Content |
|---|---|---|
| `common.json` | `app`, `appBar`, `session`, `config`, `landing`, `about`, `footer`, `agentRules`, `refresh`, `report`, `db`, `dataThread`, `dataLoading`, `preview`, `conceptShelf`, `chartRec`, `dataGrid`, `chatDialog`, `dataView`, `auth`, `supersetPanel`, `supersetDashboard`, `supersetCatalog` | App-wide shared strings |
| `chart.json` | `chart` | Chart rendering, gallery, chart-type labels |
| `encoding.json` | `encoding` | Encoding shelf, channels, data types |
| `messages.json` | `messages` | Snackbar & system messages |
| `model.json` | `model` | LLM model configuration UI |
| `navigation.json` | `navigation` | Nav / routing labels |
| `upload.json` | `upload` | Data upload & import |

### Key Naming Conventions

1. **Dot-separated hierarchy**: `"section.subsection.keyName"`.
2. **camelCase** for key segments: `chartRec.placeholderVisualize`.
3. **Interpolation** uses double curly braces: `"{{count}} rows"`.
4. Keys that represent the **same concept** across files should use
   consistent suffixes (e.g., `*.loading`, `*.failed`, `*.success`).
5. Channel display labels use the `encoding.channel*` prefix.
6. Channel tooltip descriptions use the `encoding.channel*_tip` prefix.

### Avoiding Key Collisions

Because all files are spread-merged, top-level keys **must not overlap**.
Before adding a new top-level key, search existing files:

```bash
# Quick check for a proposed top-level key "myFeature"
grep -r '"myFeature"' src/i18n/locales/en/
```

---

## 6. Adding a New Language

To add a new language (e.g., Japanese — `ja`):

### Step 1 — Create the Locale Directory

```
src/i18n/locales/ja/
```

### Step 2 — Copy and Translate JSON Files

Copy every JSON file from `en/` into `ja/` and translate the **values**
(never change the keys):

```
src/i18n/locales/ja/
├── common.json
├── chart.json
├── encoding.json
├── messages.json
├── model.json
├── navigation.json
└── upload.json
```

### Step 3 — Create the Aggregator `index.ts`

Create `src/i18n/locales/ja/index.ts` — identical structure to `en/index.ts`:

```ts
import common from './common.json';
import upload from './upload.json';
import chart from './chart.json';
import model from './model.json';
import encoding from './encoding.json';
import messages from './messages.json';
import navigation from './navigation.json';

export default {
  ...common,
  ...upload,
  ...chart,
  ...model,
  ...encoding,
  ...messages,
  ...navigation,
};
```

### Step 4 — Register the Language

**`src/i18n/locales/index.ts`** — add the import and export:

```ts
import en from './en';
import zh from './zh';
import ja from './ja';

export { en, zh, ja };
```

**`src/i18n/index.ts`** — add the language to the `resources` map:

```ts
import { en, zh, ja } from './locales';

const resources = {
  en: { translation: en },
  zh: { translation: zh },
  ja: { translation: ja },
};
```

### Step 5 — Add a Language Switcher Option

Find the language-switcher component and add the new option. The switcher
typically calls `i18n.changeLanguage('ja')`.

### Step 6 — Validate

- Run the app and switch to the new language.
- Verify that no keys fall back to English unexpectedly (check browser
  console for i18next warnings if `debug: true` is enabled).
- Confirm that all JSON files are valid (no trailing commas, no duplicate
  keys).

---

## 7. Adding New Translation Keys

When adding new translatable text:

1. **Identify the domain** — which JSON file does it belong to?
2. **Check the "must not translate" rules** in section 3. If the string
   participates in computation, use the tooltip strategy (section 4)
   instead.
3. **Add the key** to **every** language file (`en`, `zh`, and any others).
   Use the English value as a placeholder if the translation is not yet
   available.
4. **Use `t()` in the component**:

   ```tsx
   const { t } = useTranslation();
   return <Button>{t('section.newKey')}</Button>;
   ```

5. **Add interpolation** if the string contains dynamic values:

   ```json
   { "section": { "greeting": "Hello, {{name}}!" } }
   ```

   ```tsx
   t('section.greeting', { name: userName })
   ```

6. **Test** in both English and at least one other language.

---

## 8. Common Pitfalls

| Pitfall | Consequence | Prevention |
|---|---|---|
| Translating `field.name` via `t()` | Breaks code generation, matching | Never translate field names — use tooltip |
| Adding a key only to `en/` | Missing translation in other languages | Always update all language directories |
| Using a top-level key that already exists in another file | Silent overwrite at merge time | Search before adding |
| Hard-coding strings in JSX | Not translatable | Always use `t()` for user-visible text |
| Variable shadowing `t` in `.map()` callbacks | Cannot access translation `t` function | Use a different loop variable name (e.g., `tmpl`) |
| Translating strings in `useEffect` dependency arrays or memo keys | Causes unnecessary re-renders on language switch | Keep computation keys language-independent |
| Translating Vega-Lite spec values | Broken chart rendering | Never translate spec values |

---

## 9. Quick Reference

```
To translate a UI label:
  1. Add key to src/i18n/locales/{lang}/{domain}.json
  2. Use t('domain.key') in the component

To add a descriptive tooltip for a channel label:
  1. Add encoding.channel*_tip key to encoding.json
  2. Wrap with <Tooltip title={t('encoding.channelX_tip')}>

To add a new language:
  1. Copy en/ → {lang}/
  2. Translate values (not keys)
  3. Create index.ts aggregator
  4. Register in locales/index.ts and i18n/index.ts
```
