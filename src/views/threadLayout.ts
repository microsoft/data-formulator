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

/** About how many artifacts a sub-thread holds before the next block starts a new one. */
export const THREAD_SEGMENT_BUDGET = 5;

/** How many chat entries in a row (between results) make a stretch long: as many as fold into a stack. */
export const CHAT_RUN_MIN_ENTRIES = 6;

/** One node of a block, for weighing: how many artifacts it made, a chat entry, or neither. */
export type BlockItem = number | 'chat' | 'skip';

/**
 * Block weights for wrapping: each block's artifacts, plus one for every long stretch of conversation
 * (at least `minEntries` chat entries between results, the stretches the thread folds into stacks). The
 * stretch's unit sits on the first block that starts inside it (a user message), else on the block it is
 * in, so a long chat takes room in a part like a result does and a break before it starts at a request.
 */
export const weighThreadBlocks = (blocks: BlockItem[][], minEntries = CHAT_RUN_MIN_ENTRIES): number[] => {
    const weights = blocks.map(items => items.reduce<number>((sum, item) => sum + (typeof item === 'number' ? item : 0), 0));
    let entries = 0;
    let firstBlock = -1;
    let startedBlock = -1;
    const close = () => {
        if (entries >= minEntries) weights[startedBlock >= 0 ? startedBlock : firstBlock] += 1;
        entries = 0;
        firstBlock = -1;
        startedBlock = -1;
    };
    blocks.forEach((items, block) => items.forEach((item, position) => {
        if (typeof item === 'number' && item > 0) { close(); return; }
        if (item !== 'chat') return;
        if (firstBlock < 0) firstBlock = block;
        if (position === 0 && startedBlock < 0) startedBlock = block;
        entries += 1;
    }));
    close();
    return weights;
};

/**
 * Where a long thread breaks into sub-threads: the block indices each part starts at.
 *
 * A block is one request and everything it produced (answers, plan, workflow output); its weight is
 * how many artifacts it made (an exchange that made none weighs nothing and joins the part it falls in;
 * a long stretch of conversation weighs one, see `weighThreadBlocks`). Blocks wrap like words on a line: a part takes blocks until
 * the next would pass `budget`, a block over the budget gets a part to itself, and none is ever cut.
 * A thread up to a quarter over the budget stays whole. `sealed` are breaks already made: they stay
 * where they are, and only the blocks after the last of them wrap, so new turns move nothing above.
 */
export const wrapThreadBlocks = (weights: number[], budget: number, sealed: number[] = []): number[] => {
    const kept = [...new Set(sealed)].filter(index => index > 0 && index < weights.length).sort((a, b) => a - b);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (!kept.length && total <= budget * 1.25) return [0];
    const starts = [0, ...kept];
    let current = 0;
    for (let index = starts[starts.length - 1]; index < weights.length; index++) {
        if (current > 0 && current + weights[index] > budget) {
            starts.push(index);
            current = 0;
        }
        current += weights[index];
    }
    return starts;
};
