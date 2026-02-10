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
    divider: 'rgba(0, 0, 0, 0.2)',

    /** 0.15 — inner components: cards, chips, inputs, thumbnails
     *  DataThreadCards table card, EncodingShelfCard tab divider */
    component: 'rgba(0, 0, 0, 0.3)',

    /** 0.20 — outer containers: panels, dialogs, popovers, drop zones
     *  DataThread popups, UnifiedDataUploadDialog, AgentRulesDialog */
    view: 'rgba(0, 0, 0, 0.3)',
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
    /** Default Material UI inspired palette */
    material: {
        name: 'Material',
        primary:   { main: '#1565c0' },   // blue[800]
        secondary: { main: '#7b1fa2' },   // purple[700]
        derived:   { main: '#f9a825' },   // yellow[800]
        custom:    { main: '#e65100' },    // orange[900]
        warning:   { main: '#bf5600' },
    },

    /** Microsoft Fluent UI palette */
    fluent: {
        name: 'Fluent UI',
        primary:   { main: '#0078d4' },   // Fluent themePrimary
        secondary: { main: '#8764b8' },   // Fluent purple
        derived:   { main: '#ffb900' },   // Fluent gold
        custom:    { main: '#d83b01' },   // Fluent orange
        warning:   { main: '#a4262c' },   // Fluent red
    },

    /** Vivid Spectrum — high saturation, modern */
    vivid: {
        name: 'Vivid',
        primary:   { main: '#2563eb' },
        secondary: { main: '#7c3aed' },
        custom:   { main: '#f59e0b' },
        derived:    { main: '#ea580c' },
        warning:   { main: '#dc2626' },
    },

    /** Deep Jewel — rich, saturated jewel tones */
    jewel: {
        name: 'Jewel',
        primary:   { main: '#1d4ed8' },
        secondary: { main: '#6d28d9' },
        derived:   { main: '#d97706' },
        custom:    { main: '#c2410c' },
        warning:   { main: '#b91c1c' },
    },

    /** Electric Modern — punchy, high contrast */
    electric: {
        name: 'Electric',
        primary:   { main: '#0066ff' },
        secondary: { main: '#8b5cf6' },
        derived:   { main: '#eab308' },
        custom:    { main: '#f97316' },
        warning:   { main: '#ef4444' },
    },

    /** Teal & Coral — distinctive, less corporate */
    tealCoral: {
        name: 'Teal & Coral',
        primary:   { main: '#0891b2' },
        custom:    { main: '#7c3aed' },
        derived:   { main: '#ca8a04' },
        secondary: { main: '#e11d48' },
        warning:   { main: '#dc2626' },
    },

    /** Microsoft Copilot — inspired by the Copilot gradient spectrum
     *  (green → teal → blue → purple → pink) */
    copilot: {
        name: 'Copilot',
        primary:   { main: '#0f6cbd' },   // Fluent 2 blue (main actions)
        secondary: { main: '#0e9a6c' },   // Copilot green (AI accent)
        derived:   { main: '#d946ef' },   // Copilot magenta/pink (derived)
        custom:    { main: '#7160e8' },    // Copilot purple (custom)
        warning:   { main: '#d13438' },    // Fluent 2 red (errors)
    },

    /** Enterprise — clean, confident, professional
     *  Warm neutrals with clear color differentiation */
    enterprise: {
        name: 'Enterprise',
        primary:   { main: '#2b6cb0' },   // Confident blue — clear, approachable
        secondary: { main: '#7e57c2' },   // Soft violet — distinguishable, modern
        derived:   { main: '#43a047' },   // Fresh green — growth, generated data
        custom:    { main: '#e67e22' },    // Warm amber — inviting, user-defined
        warning:   { main: '#c0392b' },    // Clear red — unmistakable alerts
    },
} as const;

/** The currently active palette key. Change this single value to switch themes. */
export const activePaletteKey: keyof typeof palettes = 'fluent';

/** Background tint opacity — applied to `main` to produce `bgcolor`. */
export const bgAlpha = 0.10;
