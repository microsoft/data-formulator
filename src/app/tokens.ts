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
