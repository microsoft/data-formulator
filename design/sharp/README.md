# Sharp — toward an "instrument" design language

Status: **decided** — Instrument (direction B) replaces the current sharp look. Code structure and phases:
[plan.md](./plan.md). Open [directions.html](./directions.html) in a browser to see the same session slice drawn in
each direction.

The look as built differs from these principles in a few places, after review: cards keep their palette tints
(principle 2), and the status line, step numbers and artifact ids were dropped. See the status section of
[plan.md](./plan.md) for the current state and what was tried.

## Where we are

Sharp contrast today ([theme.ts](../../src/app/theme.ts) `lineVariables`, [tokens.ts](../../src/app/tokens.ts))
is a **line pass**: near-black anchors, a mid-grey frame level, 4px corners, no decorative shadows. That got us
from "soft web app" to "minimal". It does not yet read as a *modern precision tool*, because sharp only changes
lines and corners. Everything else is still the soft look's vocabulary:

| Layer | What sharp still inherits | Effect |
|---|---|---|
| Fill | Tinted surfaces: peach user prompts (`custom` @ 8–10%), blue artifact labels (`primary.bgcolor`), beige table header with 2px orange underline ([SelectableDataGrid.tsx](../../src/views/SelectableDataGrid.tsx)) | Three colour systems compete with the chart, which should be the only colourful thing |
| Type | One voice (Inter, ~same weight) for content, labels, counts, ids; italic as the "quiet" voice (24 uses across views, incl. tabs and thread notes) | No hierarchy between *what you said* and *what the system knows*; italic reads document-like, not tool-like |
| Surface | Graph-paper canvas, floating toast + popover with shadows, rounded chips and send button | Several physical metaphors at once (paper, cards, bubbles) |
| Marks | Mixed icon sets on the thread rail (person, bot, chart glyphs), emoji logo | Busy rail; no rhythm |

So the gap is not "more lines" — it is **too many systems at once**. Futuristic-minimal tools (Linear, Vercel/Geist,
Raycast, Warp, Teenage Engineering, Nothing) feel that way because they commit to very few systems and execute
them precisely.

## Principles (proposal)

1. **Colour belongs to data.** Charts, maps and field-type marks carry colour. Chrome is ink on paper.
   One accent, used only as a *signal*: focus, selection, live/running state, the primary action.
2. **Structure is drawn, not filled.** Hierarchy comes from line weight (anchor / frame / inner) and type weight,
   never from tinted backgrounds. A fill means state (hover, pressed), not category.
3. **Two voices.** Content in the sans (prompts, titles, prose). System knowledge in a *meta voice* — mono, small,
   tracked, uppercase — for counts, ids, types, units, keyboard hints, status. This is the single biggest
   "instrument" cue and replaces italic as the quiet voice.
4. **Identifiers are data.** Field, table, model and session names keep their case and spelling even inside the meta
   voice (`indexed_value`, `gpt-6.1-sol`), and sit in mono so they read as exact.
5. **Square, on a grid.** One corner (0–2px) for every outlined surface; spacing on a 4px grid; numbers tabular.
   Only true overlays (menus, dialogs, drag ghosts) float and keep a shadow.
6. **Address everything.** Steps are numbered (`01`, `02`), artifacts have a short reference (`T1·03`), panels
   state what they show (`Line · date × indexed_value × symbol`). Precision is a visual style *and* useful.
7. **State lives in place.** A persistent status line (ready / running / rows / model / tools) instead of transient
   toasts; focus marked with corner ticks rather than glow rings.

## Directions

| | A · Ink | B · Instrument (recommended) | C · Console |
|---|---|---|---|
| Idea | Subtract: remove fills, lighten lines | Ink + a precision layer | B inverted (dark) |
| Fills | none | none (canvas off-white) | none |
| Lines | anchor `#111`, frame 0.16, inner 0.09 | anchor `#0a0a0a`, frame 0.18, inner 0.10 | white at the same steps |
| Corners | 2px | 0px | 0px |
| Type | Inter only; weight for hierarchy | Inter + mono meta voice (uppercase, +0.06em) | same |
| User prompt | 2px ink rule, no box | `›` prefix in accent, no box | same |
| Focus | 1.5px accent ring | accent corner ticks | same |
| Canvas | plain | 16px dot grid | dim dot grid |
| Feedback | quiet toast | status line | status line |
| Risk | can feel plain / editorial | mono overuse → "terminal cosplay" | a whole second theme to QA |

**Recommendation: B, built so that C falls out of the tokens.** A is a strict subset of B, so the first step of B
*is* A — we can ship incrementally and stop at A if B feels like too much.

Guard-rails for B so it stays tasteful:
- Meta voice only for short system strings (≤ ~4 words). Never for prompts, titles, prose, or table cell text.
- At most one row of meta text per component.
- Corner ticks only for the *one* focused thing on screen.
- Accent never fills a large area; the primary button can be solid ink rather than accent.

## Mapping to the code

Most of this is reachable through the existing sharp variable layer:

| Need | Mechanism |
|---|---|
| Lighter line steps, 0px corners | adjust `--df-line-*`, `--df-card-radius` in `lineVariables('sharp')` |
| Drop category fills | new `--df-fill-user`, `--df-fill-artifact`, `--df-fill-header` (unset in soft, `transparent` in sharp), used where `custom.bgcolor` / `primary.bgcolor` are applied today ([DataThreadCards.tsx](../../src/views/DataThreadCards.tsx), [SelectableDataGrid.tsx](../../src/views/SelectableDataGrid.tsx), [DataThread.tsx](../../src/views/DataThread.tsx)) |
| Meta voice | `fontMono` + a `metaText` sx token in tokens.ts (`--df-meta-font`, `--df-meta-case`, `--df-meta-track`); soft keeps today's small sans. `@fontsource/roboto-mono` is already a dependency — or bundle JetBrains Mono / Geist Mono |
| Replace italic quiet voice | route the thread's italic notes/labels through `metaText` (or plain `text.secondary` in soft) |
| Numbered steps, `T1·03` refs | small render change in the thread rail and panel toolbar; show in both contrasts or sharp only |
| Corner-tick focus | `selectionRing()` gains a sharp variant (background-gradient ticks) |
| Status line | new component; toasts for routine success ("Loaded …") move into it, errors stay as toasts |
| Dark (C) | the same variables plus `palette.mode` — only viable once every fill goes through tokens |

## Rollout sketch

1. **Ink pass** (low risk): fills → tokens, lighter line steps, 2px→0px corners, kill italic in sharp.
2. **Meta voice**: add `fontMono` + `metaText`; apply to thread header, artifact meta, panel toolbar, table header,
   composer footer.
3. **Addressing**: step numbers + artifact refs.
4. **Status line**; demote routine toasts.
5. Evaluate dark (C) only after 1–4 hold up.

## Open questions

- ~~Should B become *the* sharp, or a third contrast option?~~ Decided: B replaces sharp.
- Accent: keep the palette's primary, or make sharp use a fixed signal colour (electric blue, or signal orange)?
- Which mono: Roboto Mono (already bundled), JetBrains Mono, or Geist Mono (closest to the Linear/Vercel feel)?
- Do step numbers and artifact refs earn their place in soft too? (They help referencing in chat: "compare 03 and 05".)
- Logo/mark: the emoji-style logo fights a monochrome UI — a monochrome glyph for sharp?
