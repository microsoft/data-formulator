// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Where a map's floating panels go. The title keeps the top left. The controls (with the timeline) go in a row
 * under it, a row along the bottom, or a column at the left; the legend takes a bottom corner, the top left, or
 * joins the controls' box when it fits there whole. Each arrangement is tried by fitting the map around its
 * panels (MapRenderer.measureLayouts): the one that leaves the map largest, least covered and most centred wins,
 * with a light preference for the usual places. So a globe (a disc) takes a narrow column rather than a
 * full-width row, and a world map crowded with land in the north moves its controls over the Southern Ocean.
 *
 * The host decides when a map opens, when its projection, layers, data or controls change, or when the panel is
 * resized a lot: filtering, playing, zooming and selecting never move a panel.
 */

export type ControlsPlacement = 'top' | 'bottom' | 'side';
export type LegendPlacement = 'bottom-left' | 'bottom-right' | 'top-left' | 'controls';
export interface MapLayout { controls: ControlsPlacement; legend: LegendPlacement }
/** [x0, y0, x1, y1] in pixels. */
export type Box = [number, number, number, number];
export interface Size { width: number; height: number }

/** The controls' column width, and the legend's width beside the zoom buttons. */
export const WIDGET_WIDTH = 220;
/**
 * Each control's width in a row, label above (as in an app's FilterBar): a dropdown needs less than a slider or
 * a list, so more of them fit in the first row.
 */
export const ROW_WIDTH: Record<string, number> = { select: 150, search: 160, slider: 170, range: 170, checkboxes: 200, layers: 190, timeline: 220 };
/** The row's gap between controls, its box's side padding, and the room its "N more" toggle takes at the end. */
export const ROW_GAP = 16;
export const ROW_PADDING = 12;
export const TOGGLE_SPACE = 90;
/** Panels keep this far from the panel's sides. */
export const EDGE = 16;
/** The zoom buttons' column at the right, with its gap: a bottom row or a bottom-right legend stops short of it. */
export const ZOOM_SPACE = 48;
/** A box's vertical padding and border, and the gap between stacked items. */
const BOX_CHROME = 18;
const ITEM_GAP = 8;

/** Where panels under the title start, from the title block's measured height (0: no title). */
export const panelTop = (headerHeight: number) => headerHeight ? 12 + headerHeight + 8 : 12;
/** Where panels along the bottom end (above the boundaries' credit line when it shows). */
export const bottomInset = (creditLine: boolean) => creditLine ? 26 : 16;

/** Room for a row's controls (inside its box's padding). */
export function rowRoom(layout: MapLayout, width: number, options: { header: boolean; reserveTopRight: number; legendWidth: number }): number {
    // At the top, the host's top-right buttons share the first row only when there is no title; at the bottom,
    // the row stops short of the zoom buttons, and of a legend beside them.
    const taken = layout.controls === 'bottom'
        ? ZOOM_SPACE + (layout.legend === 'bottom-right' ? options.legendWidth + ITEM_GAP : 0)
        : options.header ? 0 : options.reserveTopRight;
    return width - 2 * EDGE - taken - 2 * ROW_PADDING - 2;
}

export interface RowFit { count: number; width: number; openWidth: number }

/**
 * How many items fit in the first row, from their widths and the room (null: all of them fit), and how wide they
 * are together; and, opened, how wide its widest row is (the rows fill in order beside the toggle, as flex-wrap
 * lays them out).
 */
export function rowFit(widths: number[], room: number): RowFit | null {
    const span = (count: number) => widths.slice(0, count).reduce((sum, width) => sum + width, 0) + ROW_GAP * Math.max(0, count - 1);
    if (span(widths.length) <= room) return null;
    let count = 1;
    while (count < widths.length && span(count + 1) <= room - TOGGLE_SPACE) count++;
    const capacity = room - TOGGLE_SPACE;
    let openWidth = 0;
    let line = -ROW_GAP;
    for (const width of widths) {
        if (line >= 0 && line + ROW_GAP + width > capacity) { openWidth = Math.max(openWidth, line); line = -ROW_GAP; }
        line += ROW_GAP + width;
    }
    openWidth = Math.max(openWidth, line);
    return { count, width: span(count), openWidth };
}

export interface LayoutInput extends Size {
    /** The title block's size (null without a title). */
    header: Size | null;
    /** The controls box's items in order (the timeline first): each one's width in a row, and its height. */
    items: Size[];
    /** The controls are only a timeline, which reads as well along the bottom. */
    timelineOnly: boolean;
    legend: Size | null;
    /** Panels that stay put in every layout (the zoom buttons). */
    fixed: Box[];
    creditLine: boolean;
    reserveTopRight: number;
    /** Where a bottom-right panel ends, from the bottom (above a tile attribution, the host's buttons). */
    bottomRight: number;
    /** The spec's choice for the controls (view.layout), when it makes one. */
    pin?: ControlsPlacement;
}

export interface Candidate { layout: MapLayout; boxes: Box[] }

/** How the map sits with a candidate's panels: its fitted scale, the share of its places they cover, how far off-centre it is. */
export interface LayoutFit { scale: number; covered: number; offset: number }

const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Every arrangement that fits the panel, with the boxes its panels would take. */
export function layoutCandidates(input: LayoutInput): Candidate[] {
    const { width, height, legend } = input;
    const top = panelTop(input.header?.height ?? 0);
    const bottom = height - bottomInset(input.creditLine);
    const header: Box[] = input.header?.height ? [[EDGE, 12, EDGE + input.header.width, 12 + input.header.height]] : [];
    const controls: (ControlsPlacement | null)[] = !input.items.length ? [null] : input.pin ? [input.pin] : ['top', 'bottom', 'side'];
    const legends: LegendPlacement[] = legend ? ['bottom-left', 'controls', 'bottom-right', 'top-left'] : ['bottom-left'];
    const candidates: Candidate[] = [];
    for (const place of controls) {
        for (const legendPlace of legends) {
            if (legendPlace === 'controls' && !place) continue;
            // The top left is the controls' when they sit under the title, and the bottom left when they run along the bottom.
            if (legendPlace === 'top-left' && (place === 'top' || place === 'side')) continue;
            if (legendPlace === 'bottom-left' && place === 'bottom') continue;
            const layout: MapLayout = { controls: place ?? 'top', legend: legendPlace };
            const boxes: Box[] = [];
            const merged = legend && legendPlace === 'controls' ? legend : null;
            if (place === 'side') {
                const heights = [...input.items.map(item => item.height), ...(merged ? [merged.height] : [])];
                const natural = heights.reduce((sum, item) => sum + item, 0) + ITEM_GAP * (heights.length - 1) + BOX_CHROME;
                const room = bottom - top - (legend && legendPlace === 'bottom-left' ? legend.height + ITEM_GAP : 0);
                // The legend joins the column only when the column then fits whole (no scrolling past it).
                if (merged && natural > room) continue;
                boxes.push([EDGE, top, EDGE + WIDGET_WIDTH, top + Math.min(natural, room)]);
            } else if (place) {
                const widths = [...input.items.map(item => item.width), ...(merged ? [merged.width] : [])];
                const heights = [...input.items.map(item => item.height), ...(merged ? [merged.height] : [])];
                const fit = rowFit(widths, rowRoom(layout, width, { header: header.length > 0, reserveTopRight: input.reserveTopRight, legendWidth: legend?.width ?? 0 }));
                // The legend joins a row only when the whole row fits (it is never folded away behind "N more"), and only a
                // legend about as short as the controls (a ramp, a few swatches): a tall one would make the whole row tall.
                if (merged && (fit || merged.height > Math.max(...input.items.map(item => item.height)) * 1.25 + 8)) continue;
                const count = fit?.count ?? widths.length;
                const span = fit?.width ?? widths.reduce((sum, item) => sum + item, 0) + ROW_GAP * (widths.length - 1);
                const boxWidth = span + 2 + (fit ? ROW_PADDING + TOGGLE_SPACE : 2 * ROW_PADDING);
                const boxHeight = Math.max(...heights.slice(0, count)) + BOX_CHROME;
                boxes.push(place === 'top' ? [EDGE, top, EDGE + boxWidth, top + boxHeight] : [EDGE, bottom - boxHeight, EDGE + boxWidth, bottom]);
            }
            if (legend && !merged) {
                const right = width - EDGE - ZOOM_SPACE;
                boxes.push(legendPlace === 'bottom-right' ? [right - legend.width, height - input.bottomRight - legend.height, right, height - input.bottomRight]
                    : legendPlace === 'top-left' ? [EDGE, top, EDGE + legend.width, top + legend.height]
                    : [EDGE, bottom - legend.height, EDGE + legend.width, bottom]);
            }
            const all = [...header, ...input.fixed, ...boxes];
            if (all.some(box => box[2] > width || box[3] > height || box[1] < 0)) continue;
            if (all.some((box, index) => all.slice(index + 1).some(other => overlaps(box, other)))) continue;
            candidates.push({ layout, boxes: all });
        }
    }
    return candidates;
}

/**
 * How much a panel covering the map's places costs, and an off-centre map (per share of the panel it is off by):
 * panels should move out of the data's way before the map moves out of theirs.
 */
const COVER_COST = 0.5;
const OFFSET_COST = 0.6;

/** A light preference for the usual places, so a near tie keeps the familiar arrangement. */
function preference(layout: MapLayout, input: LayoutInput): number {
    const controls = layout.controls === 'bottom' && !input.timelineOnly ? 0.97 : 1;
    // One box instead of two reads tidier; a legend away from the bottom left is a little less expected.
    const legend = !input.legend ? 1 : { 'bottom-left': 1, controls: 1.02, 'bottom-right': 0.99, 'top-left': 0.98 }[layout.legend];
    return controls * legend;
}

/** The arrangement that serves the map best; `measure` fits the map around a candidate's boxes. */
export function chooseLayout(input: LayoutInput, measure: (boxes: Box[][]) => (LayoutFit | null)[]): MapLayout {
    const fallback: MapLayout = { controls: input.pin ?? 'top', legend: 'bottom-left' };
    const candidates = layoutCandidates(input);
    if (!candidates.length) return fallback;
    const fits = measure(candidates.map(candidate => candidate.boxes));
    let best: MapLayout | null = null;
    let bestScore = -Infinity;
    for (const [index, candidate] of candidates.entries()) {
        const fit = fits[index];
        if (!fit) continue;
        const score = fit.scale * (1 - COVER_COST * fit.covered) * (1 - OFFSET_COST * fit.offset) * preference(candidate.layout, input);
        // Earlier candidates (the usual places) keep a tie.
        if (score > bestScore * (1 + 1e-6)) { best = candidate.layout; bestScore = score; }
    }
    return best ?? fallback;
}
