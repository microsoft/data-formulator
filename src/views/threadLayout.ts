// Single source of truth for DataThread column geometry.
//
// Both the DataThread panel (which renders the thread columns) and
// DataFormulator (which snaps the resizable Allotment pane to whole-column
// widths) must agree on these values, otherwise the pane snap points won't
// line up with the actual rendered columns.  Keep all width/padding tuning
// here.

/** Visual width of a single thread card / column (px). */
export const CARD_WIDTH = 248;

/** Horizontal gap between adjacent columns (px). */
export const CARD_GAP = 8;

/** Total horizontal padding inside the thread panel (left + right, px). */
export const PANEL_PADDING = 32;

/** Max number of columns the thread panel will ever lay out. */
export const MAX_THREAD_COLUMNS = 3;

/**
 * Pixel width required to display exactly `n` columns:
 *   n cards + (n-1) gaps + panel padding.
 */
export const threadPaneWidth = (n: number): number =>
    n * CARD_WIDTH + Math.max(0, n - 1) * CARD_GAP + PANEL_PADDING;

/**
 * How many whole columns fit within `containerWidth`, clamped to
 * [1, MAX_THREAD_COLUMNS].  Inverse of `threadPaneWidth`.
 */
export const fittableThreadColumns = (containerWidth: number): number =>
    Math.max(
        1,
        Math.min(
            MAX_THREAD_COLUMNS,
            Math.floor((containerWidth - PANEL_PADDING + CARD_GAP) / (CARD_WIDTH + CARD_GAP)),
        ),
    );
