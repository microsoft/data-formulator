---
name: past_sessions
description: Find the user's other sessions and read or copy their tables, charts, reports and files.
when_to_use: >-
  The user refers to work from another session ("last week's analysis", "the table I made before", "reuse the
  chart from my sales session"). Not for this session's items (read_file), nor for renaming, opening or deleting
  sessions (configure).
always_on: false
tools:
  - past_sessions
---

# Past sessions

`past_sessions` reads the user's other saved sessions. It never changes them.

| Call | Returns |
|---|---|
| `{"query": "enso snowfall"}` | Matching sessions: name, date, and the titles of their tables, charts and reports. No query: the most recent. |
| `{"session": "<id or name>"}` | What that session holds, each with its `item` name. |
| `{"session": …, "item": "tables/<name>", "rows": "1-50"}` | One item, read the way `read_file` reads it here (`columns`, `rows` for tables; `offset` for text). |
| `{"session": …, "item": …, "copy": "scratch"}` | A copy for code under `scratch/past/<session>/`. |
| `{"session": …, "item": …, "copy": "session"}` | A new table or file in this session; its provenance names the session it came from. |

Items are `tables/<name>`, `charts/<id>`, `reports/<id>` and `files/<path>`; `item` takes a list of up to 10.

- Use it only when the user points to earlier work. If several sessions could be the one they mean, ask which
  before reading.
- Only results are shared. A session's conversation, notes and memory are not, and names inside a result
  (`tables/…`, a `data_file`) are that session's: to use its data here, copy it.
- Copy what the answer needs, not whole sessions. A second copy of the same table returns the first.
- A chart copied with `"session"` brings its table and returns the chart; make it here with `visualize`, with
  that table as its input. A report is not copied: read it, copy what it shows, and write a new report.
- Say which session you used, by name.
