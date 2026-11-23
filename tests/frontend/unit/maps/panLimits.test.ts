import * as d3 from 'd3';
import { expect, it } from 'vitest';

import { constrainPan, PAN_SLACK } from '../../../../src/maps/MapRenderer';

const viewport: [[number, number], [number, number]] = [[0, 0], [800, 600]];
// The whole map, in the fitted projection's pixels: here it fills the panel at the start.
const extent: [[number, number], [number, number]] = [[0, 0], [800, 600]];
const pan = (x: number, y: number, k = 1) => constrainPan(d3.zoomIdentity.translate(x, y).scale(k), viewport, extent, 800, 600);

it('lets the map be dragged past its edges by a share of the panel, so what a panel covers can be brought into view', () => {
    expect(PAN_SLACK).toBe(0.5);
    // Down from under a controls row at the top, as far as half the panel and no further.
    expect(pan(0, 250).y).toBe(250);
    expect(pan(0, 500).y).toBe(300);
    expect(pan(-900, 0).x).toBe(-400);
    // Zoomed in, the slack is the same on screen: the map's top edge comes down at most half the panel.
    expect(pan(0, 200, 4).y).toBe(200);
    expect(pan(0, 400, 4).y).toBe(300);
    // And its bottom edge comes up at most half the panel (bottom at 600·4 + y ≥ 300).
    expect(pan(0, -2200, 4).y).toBe(-2100);
});
