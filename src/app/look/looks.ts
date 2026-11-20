// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The looks Data Formulator can be drawn in, and the one place where they differ. Views never ask which look is
 * active: they use the roles in `roles.ts` (and the CSS-variable tokens in `../tokens.ts`), which read these specs.
 * See design/sharp/plan.md.
 */

/** Soft (the default: grey lines, tinted surfaces, rounded), sharp (the "instrument" look) or dark (the instrument
 *  look, light on dark). */
export type Look = 'soft' | 'sharp' | 'dark';

export interface LookSpec {
    /** CSS variables set on the document root. `null` leaves each call site's own (soft) value. */
    vars: Record<string, string | null>;
    /** Light or dark: MUI's palette mode, and the browser's colour scheme (form controls, scrollbars). */
    mode: 'light' | 'dark';
    /** Palette overrides for text, dividers and surfaces; absent keeps MUI's. */
    palette?: {
        text: { primary: string; secondary: string; disabled: string }; divider: string;
        background?: { default: string; paper: string };
    };
    /** The fill of every tinted card (artifacts, prompts, chips): `null` keeps each palette colour's own light tint;
     *  a colour gives all of them that one surface (the dark look stays in one slate family; kinds are told apart by
     *  their icons and outlines). */
    tint: string | null;
    /** Corners: MUI's shape unit (sx `borderRadius: n` is n units) and the px radius of buttons and menus. */
    corner: { unit: number; control: number };
    /** Anchor lines (`lineColor`): `null` keeps the soft opacity; else `base + soft * gain` of `color` (by default the
     *  text colour). */
    anchorLine: { base: number; gain: number; color?: string } | null;
    /** Quiet text (`inkColor`): how far a soft opacity is pulled toward full ink (0 keeps it). */
    inkLift: number;
    /** Frames (`frameColor`): the soft opacity of the text colour, or the shared frame tokens. */
    frames: 'opacity' | 'tokens';
    focus: {
        /** A chat input's focus: a soft halo with a lift, or a crisp edge doubled inside. */
        input: 'halo' | 'edge';
        /** Selection rings in the palette's full colour rather than its lighter shade. */
        strongRing: boolean;
        /** A hovered chart card's outline opacity in the accent; `null` for none. */
        chartHoverOutline: number | null;
    };
    tone: {
        /** A tinted card's outline as an opacity of its own colour; `null` for the grey component line. */
        line: number | null;
        /** Hover deepens a tinted card's outline to its full colour. */
        hoverLine: boolean;
        /** Tinted cards (artifacts, table chips) carry their tint as a fill; otherwise they sit on the paper. */
        fill: boolean;
    };
    /** A user's prompt in the thread: a tinted card, or plain text marked by a rule in the user's colour. */
    userPrompt: 'card' | 'rule';
    /** Table column headers: a tinted fill over a 2px rule in the field's colour, or no fill over a 1px rule. */
    tableHeader: 'tinted' | 'ruled';
    /** Cards that lift on hover: their hover outline is the accent, or a darker grey. */
    cardHoverLine: 'accent' | 'grey';
    /** The landing chat box outline: tinted with the accent, or an anchor line. */
    heroInputLine: 'accent' | 'anchor';
    thread: {
        /** Off the focused chain, an agent step is just a dot on the rail. */
        quietOffChain: boolean;
        /** What marks a step on the rail: its kind's icon, or a sharp glyph for its kind (components/look/SharpGlyphs).
         *  Live steps keep their icon. */
        stepMarker: 'icon' | 'glyph';
    };
    /** CSS variables for sandboxed apps, applied after the app kit (htmlApp/dfAppKit.css) so they override it. */
    app: Record<string, string>;
    /** The page's paper and inks for charts drawn with Flint's defaults (savedThemes.ts `chartLookConfig`); charts with
     *  a theme keep it as authored. `null` leaves charts as Flint draws them. */
    chartInk: Record<string, unknown> | null;
}

const soft: LookSpec = {
    vars: {
        '--df-line-view': null, '--df-line-component': null, '--df-line-divider': null, '--df-line-edge': null,
        '--df-line-rail': null, '--df-icon-muted': null,
        '--df-ambient-shadow': null, '--df-hover-lift': null, '--df-rail-width': null, '--df-ring-width': null,
        '--df-pill-line': null, '--df-card-radius': null,
        '--df-meta-font': null, '--df-meta-tracking': null, '--df-meta-case': null, '--df-meta-scale': null,
        '--df-quiet-style': null, '--df-canvas-pattern': null, '--df-canvas-pattern-size': null,
        '--df-selection-outline': null, '--df-selection-rule': null, '--df-selection-tint': null, '--df-selection-overlay': null,
        '--df-thread-inset': null, '--df-thread-row-pr': null, '--df-thread-entry-pr': null, '--df-thread-inner-pr': null, '--df-thread-text-inset': null,
        '--df-ink-rgb': null, '--df-paper-rgb': null, '--df-selection-blend': null, '--df-weight-shift': null, '--df-surface-sunk': null, '--df-text-muted': null,
        '--df-reading-text': null, '--df-reading-quiet': null, '--df-reading-wash': null,
    },
    mode: 'light',
    tint: null,
    corner: { unit: 4, control: 4 },
    anchorLine: null,
    inkLift: 0,
    frames: 'opacity',
    focus: { input: 'halo', strongRing: false, chartHoverOutline: null },
    tone: { line: null, hoverLine: false, fill: true },
    userPrompt: 'card',
    tableHeader: 'tinted',
    cardHoverLine: 'grey',
    heroInputLine: 'accent',
    thread: { quietOffChain: false, stepMarker: 'icon' },
    app: {},
    chartInk: null,
};

/** Instrument: ink on paper, colour only for data and signals (focus, selection, who said what). Lines in three
 *  levels, so a page keeps one strong frame per area:
 *  - anchors (the chat box, callouts; `lineColor`) a dark slate;
 *  - sections (the canvas and its tabs, the workspace card, popovers, the sidebar edge) a firm slate line;
 *  - what sits inside a frame (thread cards, map panels, tables, dividers) lighter still.
 *  Lines and quiet text are cool slate greys rather than plain black.
 *  Short system text (counts, ids, section labels) speaks in a mono "meta" voice; corners are square. */
const sharp: LookSpec = {
    vars: {
        // Sections (the canvas and its active tab, the folded workspace card, the sidebar edge, floating panels) a
        // firm slate line, so the page reads as a few drafted areas; cards and panels inside stay much lighter.
        '--df-line-view': '#8a93a3', '--df-line-component': '#e2e5ea',
        '--df-line-divider': '#e6e8ec', '--df-line-edge': '#8a93a3',
        // The data thread off its focused chain: its rail and icons readable rather than faint.
        '--df-line-rail': '#c8cdd5', '--df-icon-muted': '#8a93a3',
        // Flat: no decorative shadows, a small even hover lift (its outline does the rest), and finer lines.
        '--df-ambient-shadow': 'none', '--df-hover-lift': 'translateY(-1px)', '--df-rail-width': '1.5px', '--df-ring-width': '0px',
        '--df-pill-line': 'transparent',
        // One small corner for every outlined surface (tokens.ts `cardRadius`); floating overlays keep their own.
        '--df-card-radius': '2px',
        // The meta voice (tokens.ts `metaText`): mono, slightly smaller, tracked.
        '--df-meta-font': 'var(--df-font-mono)', '--df-meta-tracking': '0.04em', '--df-meta-case': 'uppercase', '--df-meta-scale': '0.92',
        // Quiet asides (tokens.ts `quietText`) are upright: italics read as a document, not a tool.
        '--df-quiet-style': 'normal',
        // A dot grid on the soft grid's 24px rhythm, as faint as its lines: texture, never competing with content.
        '--df-canvas-pattern': 'radial-gradient(rgba(0, 0, 0, 0.1) 0.75px, transparent 1px)', '--df-canvas-pattern-size': '24px 24px',
        // The selected item: outlined in its colour, a rule down its left side, a faint wash (tokens.ts `selectionMark`).
        '--df-selection-outline': '1px', '--df-selection-rule': '2px', '--df-selection-tint': '6%', '--df-selection-overlay': 'block',
        // One left edge in the thread for card borders, thumbnails, the prompt rule and unboxed agent text.
        '--df-thread-inset': '0px', '--df-thread-text-inset': '0px',
        // Cards run to the column's right edge (2px left for a selected thumbnail's outline) instead of mirroring the
        // rail's gutter there: about 20px more width per column.
        '--df-thread-row-pr': '2px', '--df-thread-entry-pr': '2px', '--df-thread-inner-pr': '0px',
        '--df-ink-rgb': null, '--df-paper-rgb': null, '--df-selection-blend': null, '--df-weight-shift': null, '--df-surface-sunk': null, '--df-text-muted': null,
        '--df-reading-text': null, '--df-reading-quiet': null, '--df-reading-wash': null,
    },
    mode: 'light',
    palette: {
        text: { primary: '#161a22', secondary: '#4a5363', disabled: '#8a93a3' },
        divider: '#e6e8ec',
    },
    tint: null,
    corner: { unit: 1, control: 2 },
    anchorLine: { base: 0.85, gain: 1, color: '#5b6576' },
    inkLift: 0.6,
    frames: 'tokens',
    focus: { input: 'edge', strongRing: true, chartHoverOutline: 0.55 },
    tone: { line: null, hoverLine: true, fill: true },
    userPrompt: 'card',
    tableHeader: 'ruled',
    cardHoverLine: 'accent',
    heroInputLine: 'anchor',
    thread: { quietOffChain: true, stepMarker: 'glyph' },
    app: {
        '--df-radius-sm': '2px', '--df-radius-md': '2px', '--df-radius-lg': '2px', '--df-radius-control': '2px',
        '--df-shadow-sm': 'none', '--df-shadow-md': 'none', '--df-control-shadow': 'none',
        '--df-border': '#e2e5ea', '--df-control-border': '#d4d8df',
    },
    chartInk: null,
};

/** The instrument look on a dark page: sharp's geometry and voice, with its line levels, ink and paper inverted.
 *  Two slate surfaces only: the page (panels, canvas, dialogs share it) and one raised slate for every card and
 *  sunken header. Colour stays for data and signals. Lines are a step brighter than a straight inversion, and the
 *  rail a little wider, since thin dark-on-dark lines vanish. */
const dark: LookSpec = {
    ...sharp,
    vars: {
        ...sharp.vars,
        '--df-line-view': '#566070', '--df-line-component': '#363d48',
        '--df-line-divider': '#2e343e', '--df-line-edge': '#566070',
        '--df-line-rail': '#465060', '--df-icon-muted': '#7d8696', '--df-rail-width': '2px',
        '--df-canvas-pattern': 'radial-gradient(rgba(255, 255, 255, 0.09) 0.75px, transparent 1px)',
        // Ink and paper (tokens.ts `ink`, `paper`): the colour of text-alpha greys and of white surfaces.
        '--df-ink-rgb': '255, 255, 255', '--df-paper-rgb': '23, 27, 33',
        // Light text on a dark page reads thinner (halation), so body text weighs a full step more and headings half a
        // step (tokens.ts `weight`).
        '--df-weight-shift': '100',
        // Opaque greys that would glare: a sunken surface (sticky table headers) and muted fixed-grey text.
        '--df-surface-sunk': '#1f242b', '--df-text-muted': '#b4bbc6',
        // Report prose (reportThemes.ts): its warm near-black text, quieter quotes and tables, and code wash.
        '--df-reading-text': '#d9dde3', '--df-reading-quiet': '#b6bdc8', '--df-reading-wash': '#1f242b',
        // A selection's wash lightens on a dark page (multiplying would darken it away).
        // The selection is its outline and rule; no coloured wash, so the card keeps the slate fill.
        '--df-selection-blend': 'screen', '--df-selection-tint': '0%',
    },
    mode: 'dark',
    palette: {
        text: { primary: '#e3e6eb', secondary: '#b4bbc6', disabled: '#7d8696' },
        divider: '#272c35',
        background: { default: '#171b21', paper: '#171b21' },
    },
    tint: '#1f242b',
    anchorLine: { base: 0.85, gain: 1, color: '#8b94a3' },
    app: {
        ...sharp.app,
        '--df-border': '#2c323c', '--df-control-border': '#3a414d',
    },
    chartInk: (() => {
        const [paper, primary, secondary, muted] = ['#171b21', '#e3e6eb', '#b4bbc6', '#8b94a3'];
        const color = (value: string) => ({ color: value });
        return {
            ink: {
                surface: { source: 'house', canvas: paper, plot: paper, panel: paper },
                text: { primary, secondary, muted, inverse: paper },
                structure: { grid: '#2a3039', rule: '#3a414d', connector: '#566070', axis: muted, zero: muted, frame: '#566070' },
            },
            type: {
                headline: color(primary), deck: color(secondary), valueLabel: color(primary), annotation: color(secondary),
                axisLabel: color(secondary), axisTitle: color(secondary), keyLabel: color(secondary), keyTitle: color(secondary),
                footnote: color(muted),
            },
        };
    })(),
};

export const LOOKS: Record<Look, LookSpec> = { soft, sharp, dark };

/** Every look, in the order the Settings toggle offers them. */
export const LOOK_NAMES = Object.keys(LOOKS) as Look[];
