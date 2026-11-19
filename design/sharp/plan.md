# Sharp = Instrument — code structure plan

Decision: Instrument (see [README.md](./README.md), [directions.html](./directions.html)) becomes the sharp look.
The stored preference stays `df-contrast = 'sharp'`, so existing choices carry over.

Goal: one module owns *how a look differs*; UI files only say *what something is* (a frame, a user prompt, meta
text, the focused item) and never ask which look is active.

## Status (Nov 2026)

Phases 0–5 are in; phase 4 ended up much smaller than planned (below). Review page: `/dev/look` (every role and
primitive in both looks, side by side). The soft look stays pixel-identical to before: each change is checked with
Playwright screenshots (landing, Stock Prices session, map/chart/app canvases, sidebar) diffed against soft captures
taken before it.

### The sharp look as it stands

- **Corners**: `corner.unit` 1 (soft 4), so every `sx` `borderRadius: n` is `n` px in sharp; controls 2px; outlined
  cards 2px through `cardRadius()`. Floating round buttons, toggle switches and callouts keep their shapes.
- **Surfaces**: flat (no ambient shadows, 1px hover lift); cards keep their palette tint (tables, charts, apps,
  reports, user prompts), just with square corners.
- **Lines** (slate): sections and the canvas frame `#8a93a3`; components `#e2e5ea`; dividers `#e6e8ec`; rail
  `#c8cdd5`; anchors `#5b6576`. Text `#161a22` / `#4a5363` / `#8a93a3`.
- **Type**: meta voice (section labels, counts, kinds, session group headers) in Roboto Mono, uppercase, tracked
  0.04em at 0.92×; identifiers (fields, models, table headers) in mono, never re-cased; no italics.
- **Thread**: rail steps drawn as sharp glyphs by kind (`SharpGlyphs.tsx`): the user's in the user colour, authored
  reports/apps/maps in secondary, the rest in primary, all muted off the focused chain. Live steps keep their icons.
  Selection is a 1px outline, a 2px left rule and a 6% wash.
- **Canvas**: framed (section line), with faint 24px dots in place of soft's grid.
- **Apps**: HTML apps get the look's kit variables; React board apps take their corners from the outer theme and
  their tile radius and shadow from `cardRadius` / `ambientShadow`, so they go square and flat with the look.

### Tried and dropped

- Step numbers (01…) and artifact ids (T1 / C1 / A1) on the rail: noisy; replaced by glyphs.
- `StatusLine` bottom bar, a square messages button, `StepCount` ("29 STEPS") and `ArtifactDetail`
  ("TABLE · 738 ROWS · 4 COLS"): repeated what the thread already shows; removed.
- Transparent card fills and plain-text user prompts (the Ink direction): too austere; tints came back.
- Registration-cross canvas grid, a grid behind the thread, an off-white workspace background, tiled/flush panes,
  tighter thread rows, a gap between exchanges, dark (0.42) card outlines.

### Conventions this left behind

- Views never read the look; they call roles (`src/app/look/roles.ts`) and tokens (`src/app/tokens.ts`). Lint:
  `lookSelectors` in `eslint.config.js`; allowed in `src/app/look/**`, `src/components/look/**`, `theme.ts`,
  `App.tsx`, the React app runtime entry.
- Radii in `sx` are theme units (`borderRadius: 1.5`, not `'6px'`), so they follow the look; string radii are for
  shapes that must not change (pills sized to half their height, circles, illustrations) and for outlined surfaces
  through `cardRadius('8px')`. Report documents (`reportThemes.ts`) and the sandboxed app kit keep their own radii.
- Soft fallbacks live at the call sites (`metaText({ ... })`, `cardRadius('8px')`, `ambientShadow(...)`), so the soft
  spec's CSS variables are `null` (cleared) and soft cannot drift.

### Module layout as built

- `src/app/look/`: `looks.ts` (the two `LookSpec`s: CSS `vars`, palette, corners, and named values such as
  `tone.fill`, `userPrompt`, `focus.strongRing`, `thread.stepMarker`, `app`), `roles.ts`, `variables.ts`,
  `preference.ts` (`useLook`, key still `df-contrast`), `muiOverrides.ts`.
- `src/components/look/`: `StepMarker.tsx`, `SharpGlyphs.tsx`, `LookGallery.tsx` (`/dev/look`).
- The sketches below (`MetaText.tsx`, `FocusMark.tsx`, `StatusLine.tsx`, a soft spec with real values) were not
  built: CSS-variable roles covered them.

## Where we start (survey, Nov 2026)

| Today | Count | Problem for Instrument |
|---|---|---|
| `--df-*` variables from `lineVariables()` injected once at the root ([App.tsx](../../src/app/App.tsx)) | 1 place | Good foundation — keep |
| `theme.contrast === 'sharp'` inside views ([DataThread.tsx](../../src/views/DataThread.tsx), [DataThreadCards.tsx](../../src/views/DataThreadCards.tsx), [SourceTableShelf.tsx](../../src/views/SourceTableShelf.tsx), [InteractionEntryCard.tsx](../../src/views/InteractionEntryCard.tsx), [LandingDataEntry.tsx](../../src/views/LandingDataEntry.tsx), [DemoDatasetTabs.tsx](../../src/sites/DemoDatasetTabs.tsx)) | 13 | The entanglement we want to stop growing |
| Raw literals in views: `borderRadius` numbers / tint fills / italic / `monospace` / `boxShadow` | 254 / 38 / 27 / 41 / 28 | What Instrument has to reach; can't all move at once |
| Sandboxed apps (`createDfTheme(palette)` in reactApp runtime, `HtmlAppTheme`) | — | Never see the look |

## The rule

A look can differ in three ways; each has exactly one home:

| Kind of difference | Example | Mechanism | Lives in |
|---|---|---|---|
| **Value** | line strength, corner, fill, font, case, tracking, shadow, hover lift | CSS variable read by a *role* | `src/app/look/` |
| **MUI component** | Tabs, Chip, Button, Menu, Tooltip, Snackbar, table header cell | theme `components` overrides | `src/app/look/muiOverrides.ts` |
| **Structure** (different DOM) | dot vs numbered step, ring vs corner ticks, toast vs status line | a small primitive that reads the look once | `src/components/look/` |

Views never read the look. Anything that is a *feature* rather than a look (step numbers, artifact refs `T1·03`,
the status line) is built as a feature for both looks; the look only styles it.

## Module layout

```
src/app/look/
  looks.ts         type Look = 'soft' | 'sharp'; LOOKS: Record<Look, LookSpec> — the only file where values differ
  variables.ts     lookVariables(look) → { '--df-…': value }; applied once at the root (replaces lineVariables)
  preference.ts    readLook / saveLook / useLook (moved from theme.ts; key stays 'df-contrast')
  roles.ts         semantic sx fragments and strings over the variables — the API views use
  muiOverrides.ts  lookComponents(look) merged into createDfTheme
  index.ts         public exports
src/components/look/
  MetaText.tsx     the meta voice (+ <Ident> for names that must keep their case)
  StepMarker.tsx   thread rail marker: icon / dot / number
  FocusMark.tsx    selection: ring (soft) or corner ticks (sharp) — or a role if CSS-only suffices
  StatusLine.tsx   (phase 4)
```

`LookSpec` groups values by role, not by component:

```ts
interface LookSpec {
  line:      { anchor; frame; inner; rail; railWidth };
  corner:    { card; control; chip };
  surface:   { canvas; userPrompt; artifactTintMix; header };
  text:      { metaFont; metaCase; metaTracking; metaSize; quietStyle };
  focus:     { ringTint; style: 'ring' | 'ticks' };
  elevation: { ambient; hoverLift };
  thread:    { quietOffChain: boolean };        // read only by StepMarker
}
```

The soft spec holds real values (not `null`), and `tokens.ts` fallbacks import from it, so the soft look has a single
source of truth too, and sandboxed iframes can receive the same values without CSS-variable inheritance.

## Roles: the vocabulary views use

```ts
line.anchor | line.frame | line.inner            // border colours
corner.card | corner.control | corner.chip        // radii
surface.canvas | surface.userPrompt | surface.header
surface.toned(color)                              // palette-tinted card: fill + outline + hover
text.meta | text.quiet | text.ident               // sx fragments
focusRing(color)                                  // replaces selectionRing + the sharp ? main : light branches
elevation.ambient(shadow) | elevation.hoverLift(px)
```

Palette-dependent cases are where most of today's branches come from (`sharp ? palette.main : palette.light`,
`sharp ? alpha(tone, 0.42) : grey`). Roles take the palette colour as an argument and mix it with a look variable via
`color-mix()`, so no branch is needed. Example: MUI's `light` is `main` mixed 20% toward white, so
`focusRing(main)` = `color-mix(in srgb, ${main}, white var(--df-ring-tint))` with soft `20%`, sharp `0%`.

## Enforcement

- ESLint `no-restricted-syntax` (the repo already uses it for `fetchWithIdentity`): forbid `.contrast` / `.look`
  member access on the theme and imports of `useLook` / `readLook` outside `src/app/look/**`,
  `src/components/look/**` and the Settings control. An override block in `eslint.config.js` allows those paths.
- Once migrated, forbid importing the old helpers (`lineColor`, `frameColor`, `inkColor`, `lineVariables`).
- Raw literals are not lint-blocked (too many). Optional: a small vitest ratchet that counts them in `src/views` and
  fails if the count goes *up*, so migration only moves one way.

## Verification

- `/dev/look`: a dev route rendering every role and primitive in both looks side by side (the real-component
  successor of `directions.html`). It is the review surface for each phase.
- Phase 0 must be pixel-neutral: Playwright screenshots of the landing page and the Stock Prices session in soft and
  sharp, before and after.
- `yarn lint`, `yarn test`, `tsc` on every phase.

## Phases

| # | Scope | Visual change |
|---|---|---|
| 0 | Create `src/app/look/`; move preference + `lineVariables`; express existing helpers as roles; migrate the 13 branches (3 `selectionRing` → `focusRing`, 2 thread quiet-dot → `StepMarker`, card tone borders → `surface.toned`, landing/demo borders → `line.*`); add the lint rule | none |
| 1 | **Ink**: sharp spec values (lighter lines, transparent fills, corner 0); route tint fills and italics in the main view (thread, cards, table header, composer, canvas tabs) through roles | sharp only |
| 2 | **Meta voice**: bundle the mono font; `MetaText` / `Ident`; apply to thread header, artifact meta, panel toolbar, table header, composer footer | sharp only |
| 3 | **Precision**: corner-tick focus, dot-grid canvas, MUI overrides (tabs, chips, menus, buttons) | sharp only |
| 4 | **Features**: step numbers, artifact refs, status line (routine success toasts move into it) | both looks |
| 5 | **Apps**: pass the look into sandboxed apps (`HtmlAppTheme`, `createDfTheme(palette, look)`) | sharp apps |

Remaining raw literals migrate opportunistically, outer surfaces first (sidebar, dialogs, landing), guarded by the ratchet.

## Decisions (were open)

- Settings label: kept "Contrast: Soft / Sharp"; the hint text describes the two looks.
- Sandboxed apps follow the look (HTML and React board apps).
- Mono typeface: Roboto Mono (already bundled); switching is one line in `index.css`.
- Step numbers and artifact refs: dropped in both looks.
