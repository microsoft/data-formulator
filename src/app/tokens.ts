// ════════════════════════════════════════════════════════════════════════
// Design tokens — single source of truth for visual constants.
//
// Usage:
//   import { borderColor, shadow, transition, radius, ComponentBorderStyle } from '../app/tokens';
//   sx={{ ...ComponentBorderStyle, borderRadius: radius.md, transition: transition.fast }}
//   sx={{ borderBottom: `1px solid ${borderColor.divider}`, boxShadow: shadow.sm }}
// ════════════════════════════════════════════════════════════════════════

import type { SxProps } from '@mui/material';

// ── Border colors ──────────────────────────────────────────────────────

export const borderColor = {
    /** 0.12 — section dividers, table borders, tab underlines, sidebar edges
     *  DataLoadingChat, ExplComponents, RefreshDataDialog, ReportView tables,
     *  TableSelectionView, DataLoadingThread, DBTableManager */
    divider: 'rgba(0, 0, 0, 0.12)',

    /** 0.15 — inner components: cards, chips, inputs, thumbnails
     *  DataThreadCards table card, EncodingShelfCard tab divider */
    component: 'rgba(0, 0, 0, 0.15)',

    /** 0.20 — outer containers: panels, dialogs, popovers, drop zones
     *  DataThread popups, UnifiedDataUploadDialog, AgentRulesDialog */
    view: 'rgba(0, 0, 0, 0.2)',
} as const;

// ── Composite border styles (spread into sx) ───────────────────────────

/** Section divider border — tabs, sidebars, table wrappers */
export const DividerBorderStyle: SxProps = { border: `1px solid ${borderColor.divider}` };

/** Inner component border — cards, chips, input fields */
export const ComponentBorderStyle: SxProps = { border: `1px solid ${borderColor.component}` };

/** Outer container border — panels, dialogs, popovers */
export const ViewBorderStyle: SxProps = { border: `1px solid ${borderColor.view}` };

// ── Box shadows ────────────────────────────────────────────────────────

export const shadow = {
    /** Resting cards, chips
     *  ExplComponents, DataLoadingThread, DataThreadCards */
    sm: '0 1px 2px rgba(0,0,0,0.05)',

    /** Hovered cards, table headers
     *  DataThreadCards, SelectableDataGrid, DataLoadingThread hover */
    md: '0 2px 4px rgba(0,0,0,0.08)',

    /** Expanded items, hovered panels
     *  ExplComponents hover, ReportView compose toolbar */
    lg: '0 2px 8px rgba(0,0,0,0.12)',

    /** Floating overlays, dialogs, snackbars
     *  ReportView hover, DataFormulator overlay, MessageSnackbar */
    xl: '0 4px 12px rgba(0,0,0,0.10)',
} as const;

// ── Transitions ────────────────────────────────────────────────────────

export const transition = {
    /** Hover highlights, tab toggles, icon reactions
     *  DataThread, EncodingShelfCard, DataThreadCards, ChartRecBox */
    fast: 'all 0.1s linear',

    /** Panel animations, hover effects, expand/collapse
     *  ReportView, RefreshDataDialog, UnifiedDataUploadDialog, SelectableDataGrid */
    normal: 'all 0.2s ease',

    /** Drawer slides, focus rings, snackbar entrances
     *  MessageSnackbar, DataLoadingChat, AgentRulesDialog */
    slow: 'all 0.3s ease',
} as const;

// ── Border radius ──────────────────────────────────────────────────────
// Values are MUI spacing units (1 unit = 4px via theme.spacing)

export const radius = {
    /** Cards, chips, inputs, code blocks
     *  UnifiedDataUploadDialog, AgentRulesDialog, ChatDialog, ExplComponents */
    sm: 1,

    /** Floating panels, dialogs, chat cards, table containers
     *  DataThread popups, ChatDialog, About, DataLoadingChat, TableSelectionView */
    md: 2,

    /** Status indicators, model icons
     *  ModelSelectionDialog status badges */
    lg: 3,

    /** Fully rounded pill shape — FABs, floating overlays
     *  DataFormulator chart overlay */
    pill: '16px',
} as const;

// ── Color palettes ─────────────────────────────────────────────────────
// Each palette defines five color roles: primary, secondary, derived, custom, warning.
// `main` is the prominent color; `bgcolor` is a light tint for backgrounds.

export interface AppPaletteEntry {
    main: string;
    bgcolor?: string;
    textColor?: string;
}

export interface AppPalette {
    name: string;
    primary: AppPaletteEntry;
    secondary: AppPaletteEntry;
    derived: AppPaletteEntry;
    custom: AppPaletteEntry;
    warning: AppPaletteEntry;
}

export const palettes: Record<string, AppPalette> = {
    /** Default Material UI inspired palette
     *  Primary/Custom: split-complementary pair (blue 215° ↔ orange 25°) */
    material: {
        name: 'Material',
        primary:   { main: '#1565c0' },   // H215 S83 L42 — blue
        secondary: { main: '#7b1fa2' },   // purple
        derived:   { main: '#f9a825' },   // yellow
        custom:    { main: '#c75b1e' },    // H25 S83 L45 — warm orange (matched S/L)
        warning:   { main: '#bf5600' },
    },

    /** Microsoft Fluent UI palette
     *  Primary/Custom: split-complementary (blue 205° ↔ orange 18°) */
    fluent: {
        name: 'Fluent UI',
        primary:   { main: '#0078d4' },   // H205 S100 L42 — Fluent blue
        secondary: { main: '#8764b8' },   // Fluent purple
        derived:   { main: '#ffb900' },   // Fluent gold
        custom:    { main: '#c85a17' },    // H18 S85 L44 — warm burnt orange (matched L)
        warning:   { main: '#a4262c' },   // Fluent red
    },

    /** Vivid Spectrum — high saturation, modern
     *  Primary/Custom: split-complementary (blue 224° ↔ amber 38°) */
    vivid: {
        name: 'Vivid',
        primary:   { main: '#2563eb' },   // H224 S84 L54
        secondary: { main: '#7c3aed' },
        custom:    { main: '#d97218' },    // H38 S84 L47 — vivid amber
        derived:   { main: '#ea580c' },
        warning:   { main: '#dc2626' },
    },

    /** Deep Jewel — rich, saturated jewel tones
     *  Primary/Custom: split-complementary (blue 224° ↔ copper 24°) */
    jewel: {
        name: 'Jewel',
        primary:   { main: '#1d4ed8' },   // H224 S80 L48
        secondary: { main: '#6d28d9' },
        derived:   { main: '#d97706' },
        custom:    { main: '#b85a1a' },    // H24 S80 L41 — deep copper
        warning:   { main: '#b91c1c' },
    },

    /** Electric Modern — punchy, high contrast
     *  Primary/Custom: split-complementary (blue 220° ↔ tangerine 28°) */
    electric: {
        name: 'Electric',
        primary:   { main: '#0066ff' },   // H220 S100 L50
        secondary: { main: '#8b5cf6' },
        derived:   { main: '#eab308' },
        custom:    { main: '#e07020' },    // H28 S78 L50 — electric tangerine
        warning:   { main: '#ef4444' },
    },

    /** Coastal — teal & coral, distinctive, less corporate
     *  Primary/Custom: split-complementary (teal 190° ↔ coral 350°) */
    coastal: {
        name: 'Coastal',
        primary:   { main: '#0891b2' },   // H190 S93 L37
        custom:    { main: '#c03050' },    // H350 S75 L47 — coral rose
        derived:   { main: '#ca8a04' },
        secondary: { main: '#7c3aed' },
        warning:   { main: '#dc2626' },
    },

    /** Microsoft Copilot — inspired by the Copilot gradient spectrum
     *  Primary/Custom: analogous pair from the gradient (blue → purple) */
    copilot: {
        name: 'Copilot',
        primary:   { main: '#0f6cbd', textColor: '#0e5ea3' },   // Fluent 2 blue — darker for text
        secondary: { main: '#0e9a6c', textColor: '#087a55' },   // Copilot green — darker for text
        derived:   { main: '#d946ef', textColor: '#a020c0' },   // Copilot magenta — darker for text
        custom:    { main: '#7160e8', textColor: '#5a48c8' },    // Copilot purple — darker for text
        warning:   { main: '#d13438' },   // Fluent 2 red
    },

    /** Evergreen — Shopify Polaris green, proven in data-heavy merchant dashboards
     *  Primary/Custom: complement (green 162° ↔ terracotta 345°) */
    evergreen: {
        name: 'Evergreen',
        primary:   { main: '#008060' },   // Shopify Polaris green — WCAG AA on white
        secondary: { main: '#5c6ac4' },   // Polaris indigo
        derived:   { main: '#b98900' },   // dark gold
        custom:    { main: '#b4456e' },    // H345 S50 L49 — muted rose
        warning:   { main: '#d72c0d' },   // Polaris critical red
    },

    /** Orchid — Figma purple, designed as accent-on-white in professional design tools
     *  Primary/Custom: complement (purple 270° ↔ olive 90°) */
    orchid: {
        name: 'Orchid',
        primary:   { main: '#9747ff', bgcolor: '#f3ecff', textColor: '#7030d4' },   // Figma purple — darkened for text
        secondary: { main: '#1264a3' },   // strong blue
        derived:   { main: '#e0a526', textColor: '#a87b10' },   // warm gold — darkened for text
        custom:    { main: '#538a3a', bgcolor: '#ecf4e8', textColor: '#3d6e28' },    // leaf green — darkened for text
        warning:   { main: '#cc3333' },
    },

    /** Mono — minimalist black & white, ink-on-paper
     *  Achromatic palette with pure grayscale tones */
    mono: {
        name: 'Mono',
        primary:   { main: '#1a1a1a', bgcolor: '#f0f0f0', textColor: '#1a1a1a' },   // near-black (same as main)
        secondary: { main: '#555555', bgcolor: '#f2f2f2', textColor: '#3a3a3a' },   // darkened for readability
        derived:   { main: '#777777', bgcolor: '#f5f5f5', textColor: '#4a4a4a' },   // darkened for readability
        custom:    { main: '#444444', bgcolor: '#f0f0f0', textColor: '#333333' },   // darkened for readability
        warning:   { main: '#8b2020' },   // muted dark red
    },
} as const;

/** Default palette key (used when no user preference is stored). */
export const defaultPaletteKey: keyof typeof palettes = 'fluent';

/** List of palette keys in display order */
export const paletteKeys = Object.keys(palettes) as (keyof typeof palettes)[];

/** Background tint opacity — applied to `main` to produce `bgcolor`. */
export const bgAlpha = 0.1;
