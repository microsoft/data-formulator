// ════════════════════════════════════════════════════════════════════════
// Layout system — global governance, local interpretation.
//
// The *reference layout* is the app exactly as it is hardcoded today. Every
// number in `REFERENCE` is a value lifted verbatim from a component, not a
// redesign. Density scaling multiplies that reference; it never replaces it.
//
// Rules:
//   1. Layout constants live here, not inline in components.
//   2. Components read tokens via `useLayout()` and are free to interpret
//      them however suits them (see `px()` and `pickByWidth()`).
//   3. Panels are never added, removed, or repositioned by screen size. Only
//      the space split and the density change. See design-docs/45.
// ════════════════════════════════════════════════════════════════════════

export type Density = 'compact' | 'reference' | 'comfortable' | 'spacious';
export type WidthClass = 'floor' | 'compact' | 'standard' | 'wide' | 'ultra';
export type HeightClass = 'short' | 'standard' | 'tall';

/** Smallest viewport (not display — browser chrome takes ~90-110px) we support. */
export const MIN_SUPPORTED = { width: 1024, height: 600 } as const;
export const WIDTH_BREAKPOINTS = {
    compact: 1024,
    standard: 1280,
    wide: 1680,
    ultra: 2560,
} as const;

export const HEIGHT_BREAKPOINTS = {
    standard: 800,
    tall: 1100,
} as const;

/** Multiplier applied to the reference layout. `reference` is exactly today. */
export const DENSITY_SCALE: Record<Density, number> = {
    compact: 0.9,
    reference: 1,
    comfortable: 1.15,
    spacious: 1.3,
};

export interface LayoutTokens {
    /** Text sizes, px. Named for the eight values already in use across src/. */
    text: { xxs: number; xs: number; sm: number; md: number; lg: number; xl: number; xxl: number };
    /** MUI icons are sized via `fontSize`, so they ride the same scale as text. */
    icon: { xs: number; sm: number; md: number; lg: number; xl: number };
    /** Collapsed data-source rail. */
    rail: number;
    sidebar: { min: number; default: number; max: number };
    /** `maxColumns` is a count, not a length — it is never scaled by density. */
    thread: { cardWidth: number; cardGap: number; panelPadding: number; maxColumns: number };
    canvas: { min: number; minChartHeight: number; tabBar: number; padding: number };    grid: { rowHeight: number; headerHeight: number; rowIdWidth: number };
    /** Vega-Lite `width`/`height` are the *inner plot* box, excluding axes and legends. */
    chart: { width: number; height: number };
    appBar: number;
    /** Shell margins + borders outside any panel. */
    shellChrome: number;
}

/**
 * Type and icon ramps — designed stops per density, not a multiplied reference.
 *
 * Multiplying deforms the ramp: at ×1.15 the reference 10/11/12/13/14/16/18
 * rounds to 12/13/14/15/16/18/21, which is off any sensible scale and changes
 * the spacing between steps at every density. Each ramp keeps the reference's
 * 1-1-1-1-2-2 rhythm and steps up by 2 at the small end.
 *
 * Lengths (card width, rail, row height) still scale by `DENSITY_SCALE` — a
 * 322px card is as good as a 320px one, whereas a 21px font is not.
 */
const TEXT_RAMP: Record<Density, LayoutTokens['text']> = {
    compact:     { xxs: 9,  xs: 10, sm: 11, md: 12, lg: 13, xl: 15, xxl: 17 },
    reference:   { xxs: 10, xs: 11, sm: 12, md: 13, lg: 14, xl: 16, xxl: 18 },
    comfortable: { xxs: 12, xs: 13, sm: 14, md: 15, lg: 16, xl: 18, xxl: 20 },
    spacious:    { xxs: 14, xs: 15, sm: 16, md: 17, lg: 18, xl: 20, xxl: 22 },
};

const ICON_RAMP: Record<Density, LayoutTokens['icon']> = {
    compact:     { xs: 10, sm: 12, md: 14, lg: 16, xl: 18 },
    reference:   { xs: 12, sm: 14, md: 16, lg: 18, xl: 20 },
    comfortable: { xs: 14, sm: 16, md: 18, lg: 20, xl: 22 },
    spacious:    { xs: 16, sm: 18, md: 20, lg: 22, xl: 24 },
};

/**
 * The reference layout: the current hardcoded app, transcribed.
 *
 * Sources — do not "fix" a *rendered* dimension here; change it behind a
 * density or a width class so the reference stays a faithful record of the
 * starting point:
 *   text/icon      observed distribution across 710 `fontSize` sites
 *   rail, sidebar  DataSourceSidebar.tsx
 *   thread         threadLayout.ts
 *   grid           VisualizationView.tsx
 *   chart          dfSlice.tsx `config`
 *
 * `canvas.*` are *constraints* rather than rendered sizes, so they are the one
 * place a corrected value belongs — see `canvas.min`.
 */
export const REFERENCE: LayoutTokens = {
    text: TEXT_RAMP.reference,
    icon: ICON_RAMP.reference,
    rail: 40,
    sidebar: { min: 240, default: 280, max: 450 },
    thread: { cardWidth: 248, cardGap: 8, panelPadding: 32, maxColumns: 3 },
    canvas: {
        // Was 300 (Allotment `minSize`), which cannot seat a legible chart:
        // ~300 plot + ~55 y-axis + ~110 legend + ~35 padding. design-docs/45 §6.2.
        min: 500,
        minChartHeight: 360,
        tabBar: 36,
        padding: 20,
    },
    grid: { rowHeight: 25, headerHeight: 32, rowIdWidth: 56 },
    chart: { width: 400, height: 300 },
    appBar: 48,
    shellChrome: 24,
};

// ── Classification ─────────────────────────────────────────────────────

export const resolveWidthClass = (width: number): WidthClass => {
    if (width < WIDTH_BREAKPOINTS.compact) return 'floor';
    if (width < WIDTH_BREAKPOINTS.standard) return 'compact';
    if (width < WIDTH_BREAKPOINTS.wide) return 'standard';
    if (width < WIDTH_BREAKPOINTS.ultra) return 'wide';
    return 'ultra';
};

export const resolveHeightClass = (height: number): HeightClass => {
    if (height < HEIGHT_BREAKPOINTS.standard) return 'short';
    if (height < HEIGHT_BREAKPOINTS.tall) return 'standard';
    return 'tall';
};

/** Density a width class asks for. A user override always wins over this. */
export const densityForWidthClass = (widthClass: WidthClass): Density => {
    switch (widthClass) {
        case 'floor':
        case 'compact':
            return 'compact';
        case 'standard':
            return 'reference';
        case 'wide':
            return 'comfortable';
        case 'ultra':
            return 'spacious';
    }
};

/** Thread columns a width class asks for, before the user drags the pane. */
export const threadColumnsForWidthClass = (widthClass: WidthClass): number => {
    switch (widthClass) {
        case 'floor':
        case 'compact':
            return 1;
        case 'standard':
            return 2;
        case 'wide':
            return 3;
        case 'ultra':
            return 5;
    }
};

/** Max thread columns allowed at a width class (`maxColumns` is a floor of 3). */
export const maxThreadColumnsForWidthClass = (widthClass: WidthClass): number =>
    Math.max(REFERENCE.thread.maxColumns, threadColumnsForWidthClass(widthClass));

/**
 * Columns the thread defaults to: what the width class offers, bounded by what
 * the content can actually fill — but never below two once the screen affords
 * it. The docked chat box sits under the thread, and a single 248px column is
 * too narrow to compose in. A user drag overrides this entirely.
 *
 * When `containerWidth` is given it is the authority on whether a second column
 * fits: the split is what the panes actually divide, and `comfortableThreadColumns`
 * already refuses to squeeze the canvas. The width class is a coarser proxy —
 * a 1279px viewport is `compact` and would otherwise veto a second column that
 * comfortably fits — so it only decides for callers that cannot measure.
 *
 * Pass the active `tokens`: at compact density a column is 223px, not the
 * reference 248px, and judging the fit by reference widths asks for more room
 * than the layout actually takes.
 */
export const defaultThreadColumns = (
    widthClass: WidthClass,
    contentDemand: number,
    containerWidth = Infinity,
    t: LayoutTokens = REFERENCE,
): number => {
    const measured = Number.isFinite(containerWidth) && containerWidth > 0;
    const offered = threadColumnsForWidthClass(widthClass);
    const ceiling = measured
        ? Math.min(Math.max(offered, 2), comfortableThreadColumns(containerWidth, t))
        : offered;
    const floor = Math.min(ceiling, 2);
    return Math.min(ceiling, Math.max(floor, contentDemand));
};

// ── Scaling ────────────────────────────────────────────────────────────

const s = (value: number, scale: number) => Math.round(value * scale);

/** Type comes from the designed ramps; lengths scale. Counts stay put. */
export const layoutFor = (density: Density): LayoutTokens => {
    const k = DENSITY_SCALE[density];
    if (k === 1) return REFERENCE;
    const r = REFERENCE;
    return {
        text: TEXT_RAMP[density],
        icon: ICON_RAMP[density],
        rail: s(r.rail, k),
        sidebar: { min: s(r.sidebar.min, k), default: s(r.sidebar.default, k), max: s(r.sidebar.max, k) },
        thread: {
            cardWidth: s(r.thread.cardWidth, k),
            cardGap: s(r.thread.cardGap, k),
            panelPadding: s(r.thread.panelPadding, k),
            maxColumns: r.thread.maxColumns,
        },
        canvas: {
            min: s(r.canvas.min, k),
            minChartHeight: s(r.canvas.minChartHeight, k),
            tabBar: s(r.canvas.tabBar, k),
            padding: s(r.canvas.padding, k),
        },
        grid: {
            rowHeight: s(r.grid.rowHeight, k),
            headerHeight: s(r.grid.headerHeight, k),
            rowIdWidth: s(r.grid.rowIdWidth, k),
        },
        chart: { width: s(r.chart.width, k), height: s(r.chart.height, k) },
        appBar: s(r.appBar, k),
        shellChrome: s(r.shellChrome, k),
    };
};

// ── Thread geometry (density-aware; threadLayout.ts wraps these) ────────
//
// Two different widths, and conflating them is what makes column counting
// fragile:
//
//   threadPaneWidthFor(n)   what the Allotment pane SNAPS to. Reserves
//                           `panelPadding` on both sides for visual balance.
//   threadStripWidthFor(n)  what the rendered strip actually NEEDS. It only
//                           draws `panelPadding / 2` on the left and nothing on
//                           the right, but the scroller inside it takes a
//                           scrollbar's width.
//
// The difference between them is real headroom (~10px), so a pane sitting a few
// pixels under its snap point still fits its columns. Deriving the column count
// from the *strip* width — not from a second, independently-written formula
// against the pane width — is what keeps the two from drifting apart.

/** Left padding the rendered column strip draws (right side is flush). */
export const stripPaddingLeft = (t: LayoutTokens = REFERENCE): number =>
    Math.round(t.thread.panelPadding / 2);

/**
 * Width the vertical scroller inside the strip takes. `src/scss/App.scss` sets
 * 6px on WebKit; Firefox's `scrollbar-width: thin` is a little wider.
 */
export const SCROLLBAR_ALLOWANCE = 8;

/**
 * Slack for sub-pixel measurement only. Fractional browser zoom makes
 * ResizeObserver report widths like 535.6 instead of 536, and the pane snap has
 * a ~2px deadzone. This is *not* where fit headroom comes from — that lives in
 * the pane/strip difference above.
 */
export const COLUMN_FIT_TOLERANCE = 2;

/** Pane snap target: n cards + gaps + symmetric panel padding. */
export const threadPaneWidthFor = (n: number, t: LayoutTokens = REFERENCE): number =>
    n * t.thread.cardWidth + Math.max(0, n - 1) * t.thread.cardGap + t.thread.panelPadding;

/** Width the rendered strip needs to show `n` columns without clipping. */
export const threadStripWidthFor = (n: number, t: LayoutTokens = REFERENCE): number =>
    stripPaddingLeft(t)
    + n * t.thread.cardWidth
    + Math.max(0, n - 1) * t.thread.cardGap
    + SCROLLBAR_ALLOWANCE;

export const fittableThreadColumnsFor = (
    containerWidth: number,
    t: LayoutTokens = REFERENCE,
    maxColumns: number = t.thread.maxColumns,
): number => {
    let n = 1;
    while (n < maxColumns && threadStripWidthFor(n + 1, t) <= containerWidth + COLUMN_FIT_TOLERANCE) {
        n++;
    }
    return n;
};

// ── Type scale, as CSS variables ───────────────────────────────────────
//
// Components read the scale through these rather than through a hook, so a
// module-scope `sx` object participates just as easily as a function component,
// and `src/scss/*` can use the same variables. `LayoutProvider` republishes
// them on every density change; `src/index.css` seeds the reference values so
// they are defined before React mounts and in isolated test renders.
//
//   sx={{ fontSize: textVar.sm }}
//   <CloseIcon sx={{ fontSize: iconVar.sm }} />
//
// Need an actual number (chart specs, virtualized row heights, measurement)?
// Use `useLayout().tokens` instead.
//
// Migration mapping — the scale names values that were already in use, so the
// conversion is mechanical:
//   text   9,10 → xxs · 10.5,11,11.5 → xs · 12,12.5 → sm · 13 → md
//          14 → lg · 15,16 → xl · 17,18 → xxl
//   icon   12 → xs · 13,14 → sm · 15,16 → md · 18 → lg · 20 → xl
// Deliberately tiny icons (10px status dots) use a `textVar` token instead —
// the icon scale bottoms out at 12. Display type above 18px (landing headings,
// hero numerals) is *not* on this scale and stays as literal px.

export const textVar = {
    xxs: 'var(--df-text-xxs)',
    xs: 'var(--df-text-xs)',
    sm: 'var(--df-text-sm)',
    md: 'var(--df-text-md)',
    lg: 'var(--df-text-lg)',
    xl: 'var(--df-text-xl)',
    xxl: 'var(--df-text-xxl)',
} as const;

export const iconVar = {
    xs: 'var(--df-icon-xs)',
    sm: 'var(--df-icon-sm)',
    md: 'var(--df-icon-md)',
    lg: 'var(--df-icon-lg)',
    xl: 'var(--df-icon-xl)',
} as const;

// ── Canvas content sizing ──────────────────────────────────────────────
//
// The canvas pane grows with the screen but its contents were capped at fixed
// sizes, so a 2560px canvas showed the same ~950px of content as a 1366px one.
// These raise the *ceilings* with the available space — they never force
// anything to grow, so a narrow table or a small chart stays as it is.

/**
 * Upper bounds for the data table in the visualization view.
 *
 * Only a table that actually needs the room takes it: the caller still clamps
 * to the table's natural content size, so raising these adds rows and columns
 * rather than empty space. Never returns less than the previous fixed caps.
 */
export const gridSizeCaps = (canvasWidth: number, viewportHeight: number) => ({
    maxWidth: Math.round(Math.min(2400, Math.max(900, canvasWidth - 40))),
    maxHeight: Math.round(Math.min(900, Math.max(400, viewportHeight * 0.45))),
});

/**
 * How far the chart compiler is *allowed* to stretch beyond the authored size.
 *
 * This is permission, not instruction: flint stretches from the data (band
 * count, gas pressure), so a six-category chart ignores a raised ceiling
 * entirely while a forty-category one finally gets the room. Contrast with
 * inflating `baseSize`, which forces every chart to grow and compounds through
 * flint's step sizing.
 *
 * Quantized because the result feeds the compile: a continuous ceiling changes
 * on every pixel of a window drag, so the chart recompiles continuously and the
 * new size feeds back into the measured width — which reads as size flicker.
 * Stepping means a drag recompiles a handful of times, not hundreds.
 */
export const CHART_STRETCH_STEPS = [1.5, 2, 2.5, 3] as const;

export const chartStretchCeiling = (availableWidth: number, baseWidth: number): number => {
    if (availableWidth <= 0 || baseWidth <= 0) return CHART_STRETCH_STEPS[0];
    const raw = availableWidth / baseWidth;
    let ceiling: number = CHART_STRETCH_STEPS[0];
    for (const step of CHART_STRETCH_STEPS) {
        if (raw >= step) ceiling = step;
    }
    return ceiling;
};

/**
 * Discrete chart sizes the resizer steps through, as multiples of the authored
 * size (`config.defaultChartWidth`). Stops rather than a continuous factor so a
 * chart lands on a predictable size — and so the same chart is the same size
 * across sessions and screens.
 */
export const CHART_SIZE_STOPS = [0.6, 0.8, 1, 1.25, 1.5, 2] as const;

/** Index of `1`, the authored size. Centre of the ramp: two steps either way. */
export const DEFAULT_CHART_SIZE_STOP_INDEX = 2;

/** Index of the closest stop — for persisted factors from the old free slider. */
export const chartSizeStopIndex = (factor: number): number =>
    CHART_SIZE_STOPS.reduce((best, stop, i) =>
        Math.abs(stop - factor) < Math.abs(CHART_SIZE_STOPS[best] - factor) ? i : best, 0);

/**
 * The stop a screen suggests, until the user picks one themselves.
 *
 * This is the only thing that grows a chart with the window. The stretch
 * ceiling cannot: it is permission the compiler takes only when the *data*
 * wants it, so a five-bar chart renders identically at every ceiling — measured
 * step 27 from 1.5 through 3. Scaling the compiled output is also why this is
 * safe where inflating `baseSize` was not: that compounds through flint's step
 * sizing and blows sparse charts up.
 */
const CHART_SIZE_STOP_FOR_WIDTH: Record<WidthClass, number> = {
    floor: 1,       // 0.8
    compact: 1,     // 0.8
    standard: DEFAULT_CHART_SIZE_STOP_INDEX, // 1
    wide: 3,        // 1.25
    ultra: 4,       // 1.5
};

export const defaultChartSizeStop = (widthClass: WidthClass): number =>
    CHART_SIZE_STOPS[CHART_SIZE_STOP_FOR_WIDTH[widthClass]];

// ── Dialogs ────────────────────────────────────────────────────────────

/** Viewport left free around a dialog, so it can never fill the screen edge-to-edge. */
export const DIALOG_VIEWPORT_MARGIN = 64;

/**
 * Clamp a dialog's preferred size to the viewport. A dialog states the size it
 * *wants*; a short or narrow screen silently caps it, and the body scrolls
 * rather than pushing the action row out of reach.
 */
export const dialogHeight = (preferredPx: number): string =>
    `min(${preferredPx}px, calc(100vh - ${DIALOG_VIEWPORT_MARGIN}px))`;

export const dialogWidth = (preferredPx: number): string =>
    `min(${preferredPx}px, calc(100vw - ${DIALOG_VIEWPORT_MARGIN}px))`;

// ── Budget invariant ───────────────────────────────────────────────────

export interface ShellBudget {
    width: number;
    height: number;
    fitsWidth: boolean;
    fitsHeight: boolean;
}

/**
 * Minimum shell footprint: sidebar railed, one thread column, minimum canvas.
 * If this stops fitting `MIN_SUPPORTED`, a constant grew too far — that is a
 * CI failure, not a thing to discover on a small laptop.
 */
export const minimumShellBudget = (t: LayoutTokens = REFERENCE): ShellBudget => {
    const width = t.rail + threadPaneWidthFor(1, t) + t.canvas.min + t.shellChrome;
    const height = t.appBar + t.shellChrome + t.canvas.minChartHeight
        + t.grid.headerHeight + 3 * t.grid.rowHeight + t.canvas.tabBar + t.canvas.padding;
    return {
        width,
        height,
        fitsWidth: width <= MIN_SUPPORTED.width,
        fitsHeight: height <= MIN_SUPPORTED.height,
    };
};

/** Whether the sidebar can stay expanded at a given shell width. */
export const sidebarFitsExpanded = (shellWidth: number, t: LayoutTokens = REFERENCE): boolean =>
    t.rail + t.sidebar.min + threadPaneWidthFor(1, t) + t.canvas.min + t.shellChrome <= shellWidth;

/**
 * Largest column count whose pane still leaves the canvas its minimum.
 *
 * Measured against the actual split container, not the viewport — the sidebar
 * is independently resizable, so viewport arithmetic drifts from what the
 * Allotment really has.
 */
export const maxThreadColumnsForWidth = (
    containerWidth: number,
    t: LayoutTokens = REFERENCE,
    cap: number = t.thread.maxColumns,
): number => {
    let n = 1;
    while (n < cap && threadPaneWidthFor(n + 1, t) + t.canvas.min <= containerWidth) n++;
    return n;
};

/**
 * Canvas width worth defaulting to, as opposed to `canvas.min` which is merely
 * survivable.
 *
 * Set from what actually reads well rather than from the data grid: the table
 * scrolls horizontally, so its 900px cap is not a width the canvas must hold.
 * At a 1245px viewport two columns leave the canvas ~669px, which is a
 * comfortable chart plus a readable slice of table — so the default opens the
 * second column a little below that.
 */
export const COMFORTABLE_CANVAS = 640;

/**
 * Largest column count that still leaves the canvas a *comfortable* width.
 *
 * A soft cap on the default only — `maxThreadColumnsForWidth` remains the hard
 * one, so a drag can still take the space. Two columns cost 536px, so this
 * opens the second column at a ~1176px split, where a percentage rule would
 * not: two columns are already down to 43% of the split at a 1280px viewport,
 * and 50% is only reached at 1072px — narrower than the point where
 * `canvas.min` forces one column anyway, which makes a 50% rule inert.
 */
export const comfortableThreadColumns = (
    containerWidth: number,
    t: LayoutTokens = REFERENCE,
): number => {
    // No measurement is not a constraint — callers without a split fall back to
    // the width class alone.
    if (!Number.isFinite(containerWidth) || containerWidth <= 0) return Infinity;
    let n = 1;
    while (containerWidth - threadPaneWidthFor(n + 1, t) >= COMFORTABLE_CANVAS) n++;
    return n;
};

const DENSITY_ORDER: Density[] = ['compact', 'reference', 'comfortable', 'spacious'];

/**
 * Step density down until the minimum shell fits the viewport.
 *
 * Makes the budget invariant true by construction: a width class (or a user)
 * may *ask* for `comfortable`, but a short viewport can't seat it, and silently
 * clipping the data grid is worse than slightly smaller text.
 */
export const clampDensityForViewport = (density: Density, width: number, height: number): Density => {
    let index = DENSITY_ORDER.indexOf(density);
    while (index > 0) {
        const budget = minimumShellBudget(layoutFor(DENSITY_ORDER[index]));
        if (budget.width <= width && budget.height <= height) break;
        index--;
    }
    return DENSITY_ORDER[index];
};
