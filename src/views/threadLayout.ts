// DataThread column geometry, at the reference density.
//
// The numbers now live in `src/app/layout.ts` (the reference layout) so the
// thread, the shell budget, and the density scale can't drift apart. This
// module stays as the module-scope, reference-density view that DataThread and
// DataFormulator already import; density-aware call sites should use
// `threadPaneWidthFor` / `fittableThreadColumnsFor` with live tokens instead.
//
// Both the DataThread panel (which renders the thread columns) and
// DataFormulator (which snaps the resizable Allotment pane to whole-column
// widths) must agree on these values, otherwise the pane snap points won't
// line up with the actual rendered columns.

import {
    COLUMN_FIT_TOLERANCE as LAYOUT_COLUMN_FIT_TOLERANCE,
    REFERENCE,
    fittableThreadColumnsFor,
    threadPaneWidthFor,
} from '../app/layout';

/** Visual width of a single thread card / column (px). */
export const CARD_WIDTH = REFERENCE.thread.cardWidth;

/** Horizontal gap between adjacent columns (px). */
export const CARD_GAP = REFERENCE.thread.cardGap;

/** Total horizontal padding inside the thread panel (left + right, px). */
export const PANEL_PADDING = REFERENCE.thread.panelPadding;

/** Max number of columns the thread panel will ever lay out. */
export const MAX_THREAD_COLUMNS = REFERENCE.thread.maxColumns;

/**
 * Sub-pixel slack when counting columns — fractional browser zoom reports
 * widths like 535.6 instead of 536.
 *
 * Fit *headroom* is separate and comes from the pane/strip difference in
 * `src/app/layout.ts`: the pane reserves `PANEL_PADDING` on both sides, but the
 * rendered strip only draws half of it on the left, so a pane resting a few
 * pixels under its snap point still shows all its columns.
 */
export const COLUMN_FIT_TOLERANCE = LAYOUT_COLUMN_FIT_TOLERANCE;

/**
 * Pixel width required to display exactly `n` columns:
 *   n cards + (n-1) gaps + panel padding.
 */
export const threadPaneWidth = (n: number): number => threadPaneWidthFor(n);

/**
 * How many whole columns fit within `containerWidth`, clamped to
 * [1, MAX_THREAD_COLUMNS].  Inverse of `threadPaneWidth`.
 */
export const fittableThreadColumns = (containerWidth: number): number =>
    fittableThreadColumnsFor(containerWidth);
