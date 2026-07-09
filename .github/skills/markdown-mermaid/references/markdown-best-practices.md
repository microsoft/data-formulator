# Markdown Best Practices

> Reference: companion to [SKILL.md](../SKILL.md). Document structure template, figure/table conventions, badges, emoji usage.

## Document Structure Template

```markdown
# Title

> Brief description or tagline

---

## Overview

Introductory paragraph explaining the purpose.

---

## Section 1

Content with proper formatting.

### Subsection 1.1

More detailed content.

---

## Tables

**Table N:** *Description of what the table shows*

| Column 1 | Column 2 |
| -------- | -------- |
| Data     | Data     |

---

## Diagrams

` ` `mermaid
flowchart LR
    A --> B
` ` `

**Figure N:** *Description of what the diagram shows*

---

*Footer or closing statement*
```

### Figure and Table Conventions

**Mandatory Labeling**: Every diagram and table MUST have a label:

```markdown
**Figure 1:** *Description in italics*
**Table 1:** *Description in italics*
```

- **Numbering**: Sequential within document, reset per document
- **Placement**: Label immediately follows the diagram/table block

---

## 🏷️ Shields.io Badges

Badges use [Shields.io](https://shields.io). URL structure: `https://img.shields.io/badge/{LABEL}-{MESSAGE}-{COLOR}?{OPTIONS}`

```markdown
[![Alt Text](https://img.shields.io/badge/Label-Message-color?style=for-the-badge&logo=iconname&logoColor=white)](#)
```

| Style | Parameter |
| ----- | --------- |
| Flat | `style=flat` |
| **For-the-Badge** | `style=for-the-badge` |

| Encode | As |
| ------ | -- |
| Space | `_` or `%20` |
| Dash | `--` |
| Underscore | `__` |

Icons from [Simple Icons](https://simpleicons.org/) via `logo=iconname&logoColor=white`. Colors: `blue`, `green`, `gold`, `red`, `purple`, or custom hex without `#`.

---

### Emoji Usage

**Recommended** (renders reliably across GitHub, VS Code, and terminal): Use actual emoji characters, not HTML entities or unicode escapes.

| Good ✅ | Bad ❌ |
| ------- | ------ |
| `# 🧠 Brain` | `# &#x1F9E0; Brain` |
| `**💻 Local**` | `**\ud83d\udcbb Local**` |

---

