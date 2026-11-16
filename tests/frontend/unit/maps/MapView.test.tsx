import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import * as d3 from 'd3';
import { beforeAll, expect, it } from 'vitest';

import '../../../../src/i18n';
import { loadGeoSet, type GeoSet } from '../../../../src/maps/geography';
import { MapView } from '../../../../src/maps/MapView';
import { parseMapSpec } from '../../../../src/maps/spec';

let countries: GeoSet;
let panelSize = { width: 900, height: 600 };

beforeAll(async () => {
    countries = await loadGeoSet('countries');
    // jsdom has no layout: report a fixed size.
    globalThis.ResizeObserver = class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(target: Element) {
            this.callback([{ target, contentRect: panelSize } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
});

const rows = [
    { country: 'France', year: 2000, gdp: 1, life: 70 }, { country: 'France', year: 2010, gdp: 3, life: 80 },
    { country: 'Brazil', year: 2000, gdp: 2, life: 60 }, { country: 'Brazil', year: 2010, gdp: 4, life: 75 },
    { country: 'Atlantis', year: 2010, gdp: 9, life: 99 },
];

const map = parseMapSpec(JSON.stringify({
    title: 'Indicators',
    data: { d: { values: rows } },
    layers: [{ id: 'c', type: 'regions', data: 'd', key: 'country', color: { field: { param: 'metric' }, method: 'continuous' } }],
    controls: [
        { type: 'select', param: 'metric', label: 'Measure', options: [{ label: 'GDP', value: 'gdp' }, { label: 'Life', value: 'life' }] },
        { type: 'slider', field: 'year', data: 'd', play: true },
    ],
})).spec!;

const flush = () => act(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))));

it('draws regions with a legend, a timeline, and controls that re-encode the map', async () => {
    const { container } = render(<MapView spec={map} data={{ d: rows }} geoSets={{ countries }} />);
    await flush();

    expect(screen.getByRole('heading', { name: 'Indicators' })).toBeInTheDocument();
    const regions = container.querySelectorAll('[data-layer="c"] path');
    expect(regions).toHaveLength(2);
    // The legend titles itself by the selected option, and unmatched rows are counted.
    const legends = container.querySelector('[data-map-legends]') as HTMLElement;
    expect(within(legends).getByText('GDP')).toBeInTheDocument();
    expect(within(legends).getByText(/1 row is not on the map/)).toBeInTheDocument();
    expect(container.querySelector('[data-map-time-value]')).toHaveTextContent('2010');

    fireEvent.click(screen.getByRole('button', { name: 'Life' }));
    await flush();
    expect(within(legends).getByText('Life')).toBeInTheDocument();

    // Hover shows the tooltip with the aggregated value.
    fireEvent.mouseMove(regions[0]);
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
});

it('selects a region on click and shows its details', async () => {
    const withDetails = { ...map, controls: [...map.controls, { type: 'details' as const, layer: 'c' }] };
    const { container } = render(<MapView spec={withDetails} data={{ d: rows }} geoSets={{ countries }} />);
    await flush();
    fireEvent.click(container.querySelectorAll('[data-layer="c"] path')[0]);
    await flush();
    const details = container.querySelector('[data-map-details]') as HTMLElement;
    expect(details).toBeInTheDocument();
    fireEvent.click(within(details).getByRole('button', { name: 'Clear selection' }));
    expect(container.querySelector('[data-map-details]')).toBeNull();
});

it('places the widgets where they leave the map largest: a globe takes a column beside it, not a row over it', async () => {
    panelSize = { width: 900, height: 600 };
    const globe = { ...map, view: { ...map.view, projection: 'orthographic' as const } };
    const { container, unmount } = render(<MapView spec={globe} data={{ d: rows }} geoSets={{ countries }} />);
    await flush();
    await flush();
    const widgets = container.querySelector('[data-map-widgets]') as HTMLElement;
    expect(widgets).toHaveAttribute('data-map-placement', 'side');
    // Controls and the timeline sit together.
    expect(widgets.querySelector('[data-map-controls]')).not.toBeNull();
    expect(widgets.querySelector('[data-map-timeline]')).not.toBeNull();
    unmount();
    panelSize = { width: 900, height: 600 };
});

it('keeps the chosen layout while the map is used, and follows the spec when it pins one', async () => {
    panelSize = { width: 900, height: 600 };
    const globe = { ...map, view: { ...map.view, projection: 'orthographic' as const } };
    const { container, rerender, unmount } = render(<MapView spec={globe} data={{ d: rows }} geoSets={{ countries }} />);
    await flush();
    const widgets = () => container.querySelector('[data-map-widgets]') as HTMLElement;
    expect(widgets()).toHaveAttribute('data-map-placement', 'side');
    // A filter re-encodes the map; the panels stay put.
    fireEvent.click(screen.getByRole('button', { name: 'Life' }));
    await flush();
    expect(widgets()).toHaveAttribute('data-map-placement', 'side');
    // A pinned layout: the controls run along the bottom, and the legend leaves the bottom left to them.
    rerender(<MapView spec={{ ...globe, view: { ...globe.view, layout: 'bottom' } }} data={{ d: rows }} geoSets={{ countries }} />);
    await flush();
    expect(widgets()).toHaveAttribute('data-map-placement', 'bottom');
    expect(container.querySelector('[data-map-legends][data-map-corner="bottom-left"]')).toBeNull();
    unmount();
});

it('minimises the controls to their values, each opening the whole control, and restores them', async () => {
    panelSize = { width: 900, height: 600 };
    const { container, unmount } = render(<MapView spec={map} data={{ d: rows }} geoSets={{ countries }} />);
    await flush();
    const widgets = () => container.querySelector('[data-map-widgets]') as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: 'Minimize controls' }));
    expect(widgets()).toHaveAttribute('data-map-minimized');
    // No labels, only values: the timeline keeps ▶ and its year; the measure switch shows its choice.
    expect(within(widgets()).queryByText('Measure')).toBeNull();
    expect(within(widgets()).getByRole('button', { name: 'Play' })).toBeInTheDocument();
    const measure = within(widgets()).getByRole('button', { name: 'Measure: GDP' });
    fireEvent.click(measure);
    const life = await screen.findByRole('button', { name: 'Life' });
    fireEvent.click(life);
    fireEvent.keyDown(life, { key: 'Escape' });
    await flush();
    expect(await within(widgets()).findByRole('button', { name: 'Measure: Life' })).toBeInTheDocument();
    expect(within(container.querySelector('[data-map-legends]') as HTMLElement).getByText('Life')).toBeInTheDocument();
    fireEvent.click(within(widgets()).getByRole('button', { name: 'Show all controls' }));
    expect(widgets()).not.toHaveAttribute('data-map-minimized');
    expect(within(widgets()).getByText('Measure')).toBeInTheDocument();
    unmount();
});

it('keeps every control in the row usable: a long-labelled range stacks, and long lists show the first few', async () => {
    panelSize = { width: 600, height: 700 };
    const many = Array.from({ length: 12 }, (_, index) => ({ label: `Option ${index + 1}`, value: index + 1 }));
    const crowded = parseMapSpec(JSON.stringify({
        view: { layout: 'top' },
        data: { d: { values: rows } },
        layers: Array.from({ length: 7 }, (_, index) => ({ id: `layer${index}`, name: `A long layer name number ${index + 1}`,
            type: 'regions', data: 'd', key: 'country', color: { field: 'gdp' } })),
        controls: [
            { type: 'range', field: 'gdp', data: 'd', label: 'Round-trip starting fare (USD) for the selected week' },
            { type: 'checkboxes', param: 'picks', label: 'Picks', options: many },
            { type: 'layers' },
        ],
    })).spec!;
    const { container } = render(<MapView spec={crowded} data={{ d: rows }} geoSets={{ countries }} />);
    await flush();
    await flush();
    const widgets = container.querySelector('[data-map-widgets]') as HTMLElement;
    expect(widgets).toHaveAttribute('data-map-placement', 'top');

    // The range's label sits above its slider (not beside it, where it would squeeze the slider away), cut short with the whole on hover.
    const rangeLabel = within(widgets).getByTitle('Round-trip starting fare (USD) for the selected week');
    const slider = within(widgets).getAllByRole('slider')[0];
    expect(rangeLabel.parentElement!.contains(slider)).toBe(false);
    expect(rangeLabel).toHaveStyle({ textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

    // Twelve chips: eight, then the rest on request, and back.
    const chips = () => within(widgets).getAllByRole('button', { pressed: true });
    expect(chips()).toHaveLength(8);
    fireEvent.click(within(widgets).getByRole('button', { name: '4 more' }));
    expect(chips()).toHaveLength(12);
    fireEvent.click(within(widgets).getByRole('button', { name: 'Show less' }));
    expect(chips()).toHaveLength(8);

    // The layers wrap past the first row: open the row, then seven layers show four, the rest on request.
    fireEvent.click(within(widgets).getByRole('button', { name: /^1 more/ }));
    expect(within(widgets).getAllByRole('checkbox')).toHaveLength(4);
    fireEvent.click(within(widgets).getByRole('button', { name: '3 more' }));
    expect(within(widgets).getAllByRole('checkbox')).toHaveLength(7);
    panelSize = { width: 900, height: 600 };
});

it('shows the first row of controls in the row under the title, the rest on request, and flags a changed one it hides', async () => {
    // Narrow enough that the timeline and the measure switch do not fit side by side.
    panelSize = { width: 400, height: 700 };
    const top = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop')!;
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
    // jsdom has no layout: the first row's height, for the cut.
    const isItem = (element: HTMLElement) => element.hasAttribute('data-map-item');
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true,
        get(this: HTMLElement) { return isItem(this) ? (this.hasAttribute('data-map-timeline') ? 8 : 48) : top.get!.call(this); } });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true,
        get(this: HTMLElement) { return isItem(this) ? 30 : height.get!.call(this); } });
    try {
        const { container } = render(<MapView spec={{ ...map, view: { ...map.view, layout: 'top' } }} data={{ d: rows }} geoSets={{ countries }} />);
        await flush();
        const widgets = container.querySelector('[data-map-widgets]') as HTMLElement;
        expect(widgets).toHaveAttribute('data-map-placement', 'top');
        expect(widgets).toHaveAttribute('data-map-compact');
        // The timeline leads and stays in reach; the switch past the first row is out of reach until opened.
        expect(widgets.querySelector('[data-map-item]')).toHaveAttribute('data-map-timeline');
        expect(screen.queryByRole('button', { name: 'Life' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /1 more/ }));
        await flush();
        expect(widgets).not.toHaveAttribute('data-map-compact');
        fireEvent.click(screen.getByRole('button', { name: 'Life' }));
        fireEvent.click(screen.getByRole('button', { name: /Show less/ }));
        await flush();
        expect(widgets).toHaveAttribute('data-map-compact');
        expect(within(widgets.querySelector('[data-map-more]') as HTMLElement).getByTitle('1 changed')).toBeInTheDocument();
    } finally {
        Object.defineProperty(HTMLElement.prototype, 'offsetTop', top);
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
        panelSize = { width: 900, height: 600 };
    }
});

it('keeps the notes under the legend and a selection\'s details short, the rest on request', async () => {
    const wide = [{ country: 'France', a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, note: 'A long note about how this was measured. '.repeat(6) }];
    const spec = parseMapSpec(JSON.stringify({
        source: 'Snapshots retrieved with a browser; approximate coordinates; not live quotes. '.repeat(4),
        data: { d: { values: wide } },
        layers: [{ id: 'c', type: 'regions', data: 'd', key: 'country', color: { field: 'a' },
            tooltip: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'note'] }],
        controls: [{ type: 'details', layer: 'c' }],
    })).spec!;
    const { container } = render(<MapView spec={spec} data={{ d: wide }} geoSets={{ countries }} />);
    await flush();
    const source = container.querySelector('[data-map-source]') as HTMLElement;
    expect(source).toHaveStyle({ WebkitLineClamp: '2' });
    expect(source).toHaveAttribute('title');
    fireEvent.click(source);
    expect(source).not.toHaveAttribute('title');

    fireEvent.click(container.querySelectorAll('[data-layer="c"] path')[0]);
    await flush();
    const details = container.querySelector('[data-map-details]') as HTMLElement;
    // Nine fields: six, then the rest on request.
    expect(within(details).queryByText('G')).toBeNull();
    fireEvent.click(within(details).getByRole('button', { name: '3 more' }));
    expect(within(details).getByText('G')).toBeInTheDocument();
    expect(within(details).getByTitle(/A long note about how this was measured/)).toHaveStyle({ WebkitLineClamp: '2' });
});

it('locates a searched place and returns to the whole map when the search is cleared', async () => {
    const withSearch = { ...map, controls: [...map.controls, { type: 'search' as const, layer: 'c' }, { type: 'details' as const, layer: 'c' }] };
    const { container } = render(<MapView spec={withSearch} data={{ d: rows }} geoSets={{ countries }} />);
    await flush();
    const search = screen.getByRole('combobox', { name: 'Find a place' });
    fireEvent.change(search, { target: { value: 'Fra' } });
    fireEvent.click(await screen.findByRole('option', { name: 'France' }));
    await flush();
    expect(container.querySelector('[data-map-details]')).not.toBeNull();
    // MUI's clear button (shown on hover).
    fireEvent.click(container.querySelector('.MuiAutocomplete-clearIndicator') as HTMLElement);
    await flush();
    expect(container.querySelector('[data-map-details]')).toBeNull();
    expect(search).toHaveValue('');
});

it('draws a flat world without a sea-coloured oval (land on the page, or water filling the frame) and a globe on the page', async () => {
    const world = (style?: string, projection?: string) => parseMapSpec(JSON.stringify({ ...JSON.parse(JSON.stringify(map)),
        view: { basemap: 'world', fit: 'basemap', ...(style ? { style } : {}), ...(projection ? { projection } : {}) } })).spec!;
    for (const [style, projection, ovals, background] of [[undefined, undefined, 0, 'rgb(29, 34, 39)'], ['light', undefined, 0, 'rgb(255, 255, 255)'],
        ['atlas', undefined, 0, 'rgb(219, 233, 242)'], [undefined, 'orthographic', 1, 'rgb(21, 24, 27)'], ['atlas', 'orthographic', 1, 'rgb(255, 255, 255)']] as const) {
        const { container, unmount } = render(<MapView spec={world(style, projection)} data={{ d: rows }} geoSets={{ countries }} />);
        await flush();
        expect(container.querySelectorAll('.df-map-ocean path')).toHaveLength(ovals);
        expect((container.querySelector('svg') as SVGElement).style.background).toBe(background);
        unmount();
    }
});

it('points vector arrows along their heading and shows flow direction', async () => {
    const wind = parseMapSpec(JSON.stringify({ view: { basemap: 'world', projection: 'equirectangular' }, data: { w: { values: [
        { lon: 0, lat: 0, u: 5, v: 0 }, { lon: 10, lat: 10, u: 0, v: -5 },
    ] } }, layers: [{ id: 'w', type: 'vectors', data: 'w', lon: 'lon', lat: 'lat', u: 'u', v: 'v' }] })).spec!;
    const { container, unmount } = render(<MapView spec={wind} data={{ w: wind.data.w.values as never }} geoSets={{ countries }} />);
    await flush();
    const arrows = Array.from(container.querySelectorAll('path.df-map-vector')).map(path => path.getAttribute('d')!.match(/-?[\d.]+/g)!.map(Number));
    expect(arrows).toHaveLength(2);
    // The eastward arrow runs left to right; the southward one top to bottom.
    expect(arrows[0][2]).toBeGreaterThan(arrows[0][0]);
    expect(Math.abs(arrows[0][3] - arrows[0][1])).toBeLessThan(0.5);
    expect(arrows[1][3]).toBeGreaterThan(arrows[1][1]);
    unmount();

    const flows = (direction: string) => parseMapSpec(JSON.stringify({ view: { basemap: 'world' }, data: { f: { values: [{ a: 'France', b: 'Brazil', n: 5 }] } },
        layers: [{ id: 'f', type: 'flows', data: 'f', from: { key: 'a' }, to: { key: 'b' }, size: { field: 'n' }, direction }] })).spec!;
    for (const [direction, check] of [
        ['arrow', (root: HTMLElement) => {
            expect(root.querySelectorAll('path.df-map-arrow')).toHaveLength(1);
            expect(root.querySelectorAll('path.df-map-arrow-halo')).toHaveLength(1);
            // Both places are named, so both get a node dot to anchor the name.
            expect(root.querySelectorAll('circle.df-map-node')).toHaveLength(2);
            // Halos, then dots, then heads: the head's halo never cuts the dot it lands on.
            const order = Array.from(root.querySelectorAll('path.df-map-arrow-halo, circle.df-map-node, path.df-map-arrow')).map(node => node.getAttribute('class'));
            expect(order).toEqual(['df-map-arrow-halo', 'df-map-node', 'df-map-node', 'df-map-arrow']);
            // The line ends square at its head, whose tip is on the destination itself.
            const line = root.querySelector('path.df-map-line')!;
            expect(line.getAttribute('stroke-linecap')).toBe('butt');
            const tip = root.querySelector('path.df-map-arrow')!.getAttribute('d')!.match(/-?[\d.]+/g)!.map(Number).slice(0, 2);
            const lineEnd = line.getAttribute('d')!.match(/-?[\d.]+/g)!.map(Number).slice(-2);
            const brazil = Array.from(root.querySelectorAll('circle.df-map-node')).map(node => [Number(node.getAttribute('cx')), Number(node.getAttribute('cy'))])
                .sort((a, b) => Math.hypot(a[0] - tip[0], a[1] - tip[1]) - Math.hypot(b[0] - tip[0], b[1] - tip[1]))[0];
            expect(Math.hypot(tip[0] - brazil[0], tip[1] - brazil[1])).toBeCloseTo(0, 0);
            expect(Math.hypot(lineEnd[0] - brazil[0], lineEnd[1] - brazil[1])).toBeGreaterThan(9);
        }],
        ['taper', (root: HTMLElement) => expect(root.querySelector('path.df-map-line')!.getAttribute('fill')).not.toBe('none')],
        ['animate', (root: HTMLElement) => expect((root.querySelector('path.df-map-line') as SVGElement).style.animation).toContain('df-map-flow')],
    ] as const) {
        const view = render(<MapView spec={flows(direction)} data={{ f: [{ a: 'France', b: 'Brazil', n: 5 }] }} geoSets={{ countries }} />);
        await flush();
        check(view.container);
        view.unmount();
    }
});

it('marks an unnamed flow’s end by its head alone, and lays a point layer beneath the arrows whatever its place in the list', async () => {
    const tracks = [{ x0: -97, y0: 35, x1: -95, y1: 36, n: 5 }, { x0: -90, y0: 33, x1: -87, y1: 34.5, n: 9 }];
    const spec = parseMapSpec(JSON.stringify({ view: { basemap: 'world' }, data: { t: { values: tracks } },
        layers: [
            { id: 'paths', type: 'flows', data: 't', from: { lon: 'x0', lat: 'y0' }, to: { lon: 'x1', lat: 'y1' }, size: { field: 'n' }, direction: 'arrow' },
            { id: 'lift', type: 'points', data: 't', lon: 'x1', lat: 'y1' },
        ] })).spec!;
    const { container, unmount } = render(<MapView spec={spec} data={{ t: tracks }} geoSets={{ countries }} />);
    await flush();
    // A dot where each track starts; where it ends, its head.
    expect(container.querySelectorAll('path.df-map-arrow')).toHaveLength(2);
    expect(container.querySelectorAll('circle.df-map-node')).toHaveLength(2);
    // The lift-off points come first in the marks, beneath the arrows.
    expect(Array.from(container.querySelectorAll('.df-map-marks > g.df-map-layer')).map(group => group.getAttribute('data-layer'))).toEqual(['lift', 'paths']);
    unmount();

    // With a touchdown layer too, the flows draw no dot of their own: each end is already marked.
    const both = parseMapSpec(JSON.stringify({ view: { basemap: 'world' }, data: { t: { values: tracks } },
        layers: [...JSON.parse(JSON.stringify(spec.layers)), { id: 'touch', type: 'points', data: 't', lon: 'x0', lat: 'y0' }] })).spec!;
    const marked = render(<MapView spec={both} data={{ t: tracks }} geoSets={{ countries }} />);
    await flush();
    expect(marked.container.querySelectorAll('circle.df-map-node')).toHaveLength(0);
    marked.unmount();
});

it('checks every value of a checklist once its rows arrive, though it first drew with none', async () => {
    const rows = [{ lon: 0, lat: 0, kind: 'a' }, { lon: 10, lat: 10, kind: 'b' }];
    const spec = parseMapSpec(JSON.stringify({ view: { basemap: 'world' }, data: { p: { values: rows } },
        layers: [{ id: 'p', type: 'points', data: 'p', lon: 'lon', lat: 'lat' }],
        controls: [{ type: 'checkboxes', field: 'kind', data: 'p' }] })).spec!;
    const view = render(<MapView spec={spec} data={{ p: [] }} geoSets={{ countries }} />);
    await flush();
    view.rerender(<MapView spec={spec} data={{ p: rows }} geoSets={{ countries }} />);
    await flush();
    expect(view.container.querySelectorAll('[data-layer="p"] circle')).toHaveLength(2);
    view.unmount();
});

it('fans the heads of flows arriving at one place round a ring, and keeps heads for the largest twelve only', async () => {
    const spokes = (count: number) => Array.from({ length: count }, (_, index) => {
        const angle = (2 * Math.PI * index) / count;
        return { x0: 10 + 25 * Math.cos(angle), y0: 20 + 18 * Math.sin(angle), x1: 10, y1: 20, n: index + 1 };
    });
    const draw = async (rows: Record<string, number>[]) => {
        const spec = parseMapSpec(JSON.stringify({ view: { basemap: 'world' }, data: { f: { values: rows } },
            layers: [{ id: 'f', type: 'flows', data: 'f', from: { lon: 'x0', lat: 'y0' }, to: { lon: 'x1', lat: 'y1' }, size: { field: 'n' }, direction: 'arrow' }] })).spec!;
        const view = render(<MapView spec={spec} data={{ f: rows }} geoSets={{ countries }} />);
        await flush();
        const tips = Array.from(view.container.querySelectorAll('path.df-map-arrow')).map(head => head.getAttribute('d')!.match(/-?[\d.]+/g)!.map(Number).slice(0, 2));
        view.unmount();
        return tips;
    };
    const tips = await draw(spokes(4));
    expect(tips).toHaveLength(4);
    // Four arrivals: the tips stand on a ring round the place, apart from each other.
    const [cx, cy] = [tips.reduce((sum, tip) => sum + tip[0], 0) / 4, tips.reduce((sum, tip) => sum + tip[1], 0) / 4];
    for (const tip of tips) expect(Math.hypot(tip[0] - cx, tip[1] - cy)).toBeGreaterThan(3);
    expect(await draw(spokes(20))).toHaveLength(12);
});

it('names the most salient regions first, within a budget of the plot’s area', async () => {
    const names = ['France', 'Brazil', 'China', 'India', 'Canada', 'Australia', 'Mexico', 'Germany', 'Spain', 'Italy', 'Egypt', 'Kenya', 'Japan', 'Peru',
        'Chile', 'Argentina', 'Nigeria', 'Russia', 'Turkey', 'Iran'];
    const rows = names.map((country, index) => ({ country, v: index }));
    const spec = parseMapSpec(JSON.stringify({ view: { basemap: 'world' }, data: { d: { values: rows } },
        layers: [{ id: 'c', type: 'regions', data: 'd', key: 'country', color: { field: 'v' }, text: 'country' }] })).spec!;
    panelSize = { width: 400, height: 300 };
    const { container, unmount } = render(<MapView spec={spec} data={{ d: rows }} geoSets={{ countries }} />);
    await flush();
    const named = Array.from(container.querySelectorAll('.df-map-labels text')).map(text => text.textContent);
    panelSize = { width: 900, height: 600 };
    unmount();
    // A 400 × 300 plot names at most a dozen; Russia, the largest and at the top of the scale, is among them.
    expect(named.length).toBeLessThanOrEqual(12);
    expect(named).toContain('Russia');
});

it('switches a world map between flat and globe without changing the saved spec', async () => {
    const world = parseMapSpec(JSON.stringify({ ...JSON.parse(JSON.stringify(map)), view: { basemap: 'world' } })).spec!;
    const { container } = render(<MapView spec={world} data={{ d: rows }} geoSets={{ countries }} />);
    await flush();
    expect(container.querySelectorAll('.df-map-ocean path')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Globe view' }));
    await flush();
    expect(container.querySelectorAll('.df-map-ocean path')).toHaveLength(1);
    expect(world.view.projection).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Flat map' }));
    await flush();
    expect(container.querySelectorAll('.df-map-ocean path')).toHaveLength(0);
});

it('draws a map on light street tiles in the light look unless it names a style', async () => {
    const places = [{ name: 'Oakland', lon: -122.2, lat: 37.75 }];
    const titleColor = async (tiles: string) => {
        const spec = parseMapSpec(JSON.stringify({ title: 'Places', view: { basemap: 'world', tiles },
            data: { p: { values: places } }, layers: [{ id: 'p', type: 'points', data: 'p', lon: 'lon', lat: 'lat' }] })).spec!;
        const { unmount } = render(<MapView spec={spec} data={{ p: places }} geoSets={{ countries }} />);
        await flush();
        const color = getComputedStyle(screen.getByRole('heading', { name: 'Places' })).color;
        unmount();
        return color;
    };
    expect(await titleColor('dark')).toBe('rgb(232, 234, 236)');
    expect(await titleColor('light')).not.toBe('rgb(232, 234, 236)');
});

it('names marks close together that share a name once', async () => {
    const turbines = [{ farm: 'Moose Lake', lon: -110, lat: 52 }, { farm: 'Moose Lake', lon: -110.02, lat: 52.01 }, { farm: 'Moose Lake', lon: -110.01, lat: 51.99 },
        { farm: 'Blue Trail', lon: -100, lat: 50 }];
    const spec = parseMapSpec(JSON.stringify({ template: 'points', data: { values: turbines }, encoding: { lat: 'lat', lon: 'lon', label: 'farm' } })).spec!;
    const { container, unmount } = render(<MapView spec={spec} data={{ main: turbines }} geoSets={{ countries }} />);
    await flush();
    await flush();
    const labels = Array.from(container.querySelectorAll('.df-map-labels text')).map(text => text.textContent);
    expect(labels.filter(text => text === 'Moose Lake')).toHaveLength(1);
    expect(labels).toContain('Blue Trail');
    unmount();
});

it('labels every size of small bubbles, and tells apart legends of layers sized by the same field', async () => {
    const places = [{ iso3: 'FRA', n: 65 }, { iso3: 'BRA', n: 1900 }, { iso3: 'IND', n: 3750 }];
    const small = parseMapSpec(JSON.stringify({ template: 'bubbles', data: { values: places }, encoding: { region: 'iso3', size: 'n' }, properties: { keyType: 'iso3', sizeRange: [1.5, 9] } })).spec!;
    const first = render(<MapView spec={small} data={{ main: places }} geoSets={{ countries }} />);
    await flush();
    const legend = first.container.querySelector('[data-map-legends]') as HTMLElement;
    for (const label of ['380', '1,900', '3,800']) expect(within(legend).getByText(label)).toBeInTheDocument();
    first.unmount();

    const bars = places.map(({ iso3, n }) => ({ iso3, reviewed_bars: n }));
    const twice = parseMapSpec(JSON.stringify({ data: { d: { values: bars } }, layers: [
        { id: 'a', name: 'Origins', type: 'bubbles', data: 'd', key: 'iso3', keyType: 'iso3', size: { field: 'reviewed_bars' } },
        { id: 'b', name: 'Makers (reviewed bars)', type: 'bubbles', data: 'd', key: 'iso3', keyType: 'iso3', size: { field: 'reviewed_bars' } },
    ] })).spec!;
    const second = render(<MapView spec={twice} data={{ d: bars }} geoSets={{ countries }} />);
    await flush();
    const legends = second.container.querySelector('[data-map-legends]') as HTMLElement;
    expect(within(legends).getByText('Origins · Reviewed bars')).toBeInTheDocument();
    expect(within(legends).getByText('Makers (reviewed bars)')).toBeInTheDocument();
    second.unmount();
});

it('shrinks bubbles with a small panel, and edges each in a darker shade of its own colour', async () => {
    const places = [{ iso3: 'FRA', n: 10 }, { iso3: 'BRA', n: 100 }];
    const spec = parseMapSpec(JSON.stringify({ template: 'bubbles', data: { values: places }, encoding: { region: 'iso3', size: 'n' }, properties: { keyType: 'iso3' } })).spec!;
    const largest = async (width: number, height: number) => {
        panelSize = { width, height };
        const { container, unmount } = render(<MapView spec={spec} data={{ main: places }} geoSets={{ countries }} still />);
        await flush();
        const circles = Array.from(container.querySelectorAll('circle.df-map-point'));
        const radius = Math.max(...circles.map(circle => Number(circle.getAttribute('r'))));
        const circle = circles[0];
        const [fill, stroke] = [circle.getAttribute('fill')!, circle.getAttribute('stroke')!];
        unmount();
        return { radius, fill, stroke };
    };
    const full = await largest(1000, 800);
    const thumbnail = await largest(340, 240);
    panelSize = { width: 900, height: 600 };
    expect(full.radius).toBeCloseTo(32, 0);
    expect(thumbnail.radius).toBeLessThan(full.radius / 2);
    expect(full.stroke).not.toBe('#ffffff');
    expect(d3.hcl(full.stroke).h).toBeCloseTo(d3.hcl(full.fill).h, -1);
    expect(d3.lab(full.stroke).l).toBeLessThan(d3.lab(full.fill).l);
});

it('draws Antarctica on a world map when places lie there', async () => {
    const drawsAntarctica = async (finds: { lon: number; lat: number }[]) => {
        const map = parseMapSpec(JSON.stringify({ template: 'points', data: { values: finds }, encoding: { lat: 'lat', lon: 'lon' } })).spec!;
        const { container, unmount } = render(<MapView spec={map} data={{ main: finds }} geoSets={{ countries }} />);
        await flush();
        const ids = Array.from(container.querySelectorAll('.df-map-land path')).map(path => (path as unknown as { __data__?: { properties?: { id?: string } } }).__data__?.properties?.id);
        unmount();
        return ids.includes('ATA');
    };
    expect(await drawsAntarctica([{ lon: 10, lat: 45 }, { lon: 150, lat: -75 }, { lon: -60, lat: -10 }])).toBe(true);
    expect(await drawsAntarctica([{ lon: 10, lat: 45 }, { lon: -60, lat: -10 }])).toBe(false);
});

it('frames bubbles keyed to countries by the countries, not their centres', async () => {
    const places = [{ iso3: 'USA', n: 5 }, { iso3: 'BRA', n: 3 }];
    const map = parseMapSpec(JSON.stringify({ template: 'bubbles', data: { values: places }, encoding: { region: 'iso3', size: 'n' }, properties: { keyType: 'iso3' } })).spec!;
    const { container, unmount } = render(<MapView spec={map} data={{ main: places }} geoSets={{ countries }} />);
    await flush();
    // Alaska's land (west of the USA's centre by far) lies inside the panel.
    const xs = Array.from(container.querySelectorAll('.df-map-land path')).filter(path => (path as unknown as { __data__?: { properties?: { id?: string } } }).__data__?.properties?.id === 'USA')
        .flatMap(path => (path.getAttribute('d')!.match(/-?[\d.]+/g) ?? []).filter((_, index) => index % 2 === 0).map(Number));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1);
    unmount();
});

it('folds the legend into a chip on a small interactive map, and keeps a compact one in a small still picture', async () => {
    panelSize = { width: 360, height: 260 };
    const interactive = render(<MapView spec={map} data={{ d: rows }} geoSets={{ countries }} />);
    await flush();
    const toggle = screen.getByRole('button', { name: /Legend/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(interactive.container.querySelector('[data-map-legend]')).toBeNull();
    fireEvent.click(toggle);
    expect(interactive.container.querySelector('[data-map-legend][data-map-legend-compact]')).not.toBeNull();
    interactive.unmount();
    const still = render(<MapView spec={map} data={{ d: rows }} geoSets={{ countries }} still />);
    await flush();
    expect(screen.queryByRole('button', { name: /Legend/ })).toBeNull();
    expect(still.container.querySelector('[data-map-legend][data-map-legend-compact]')).not.toBeNull();
    still.unmount();
    panelSize = { width: 900, height: 600 };
    const full = render(<MapView spec={map} data={{ d: rows }} geoSets={{ countries }} />);
    await flush();
    expect(full.container.querySelector('[data-map-legend]:not([data-map-legend-compact])')).not.toBeNull();
    full.unmount();
});

it('keeps a set centre and zoom on a flat web map when it redraws', async () => {
    panelSize = { width: 900, height: 600 };
    const places = [{ name: 'Oakland', lon: -122.2, lat: 37.75 }];
    const spec = parseMapSpec(JSON.stringify({ view: { basemap: 'world', projection: 'mercator', center: [-122.2, 37.75], zoom: 8 },
        data: { p: { values: places } }, layers: [{ id: 'p', type: 'points', data: 'p', lon: 'lon', lat: 'lat' }] })).spec!;
    const { container, rerender, unmount } = render(<MapView spec={spec} data={{ p: places }} geoSets={{ countries }} />);
    await flush();
    rerender(<MapView spec={spec} data={{ p: [...places] }} geoSets={{ countries }} />);
    await flush();
    const point = container.querySelector('circle.df-map-point')!;
    expect(Number(point.getAttribute('cx'))).toBeCloseTo(450, 0);
    expect(Number(point.getAttribute('cy'))).toBeCloseTo(300, 0);
    unmount();
});

it('draws bubbles on a globe as circles on the sphere, clipped at the horizon', async () => {
    const places = [{ name: 'Front', lon: 0, lat: 0, n: 10 }, { name: 'Edge', lon: 85, lat: 0, n: 10 }];
    const globe = parseMapSpec(JSON.stringify({ view: { basemap: 'world', projection: 'orthographic', rotate: [0, 0, 0] }, data: { p: { values: places } },
        layers: [{ id: 'b', type: 'bubbles', data: 'p', lon: 'lon', lat: 'lat', size: { field: 'n', max: 30 } }] })).spec!;
    const { container } = render(<MapView spec={globe} data={{ p: places }} geoSets={{ countries }} />);
    await flush();
    expect(container.querySelectorAll('circle.df-map-point')).toHaveLength(0);
    const discs = container.querySelectorAll('path.df-map-disc');
    expect(discs).toHaveLength(2);
    // The disc near the horizon is foreshortened: narrower than tall.
    const extent = (element: Element) => {
        const numbers = element.getAttribute('d')!.match(/-?[\d.]+/g)!.map(Number);
        const xs = numbers.filter((_, index) => index % 2 === 0);
        const ys = numbers.filter((_, index) => index % 2 === 1);
        return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    };
    const [frontWidth, frontHeight] = extent(discs[0]);
    const [edgeWidth, edgeHeight] = extent(discs[1]);
    expect(Math.abs(frontWidth - frontHeight)).toBeLessThan(frontHeight * 0.1);
    expect(edgeWidth).toBeLessThan(edgeHeight * 0.6);
});

it('draws small flows over large ones, each on its own casing, and fades only crowded maps', async () => {
    const flowsOf = (rows: Record<string, unknown>[]) => parseMapSpec(JSON.stringify({ view: { basemap: 'world' }, data: { f: { values: rows } },
        layers: [{ id: 'f', type: 'flows', data: 'f', from: { lon: 'x0', lat: 'y0' }, to: { lon: 'x1', lat: 'y1' }, size: { field: 'n' }, direction: 'arrow' }] })).spec!;
    const few = [{ x0: 0, y0: 0, x1: 30, y1: 10, n: 4 }, { x0: 0, y0: 0, x1: 30, y1: -10, n: 10 }, { x0: 5, y0: 5, x1: -30, y1: 20, n: 7 }];
    const { container, unmount } = render(<MapView spec={flowsOf(few)} data={{ f: few }} geoSets={{ countries }} />);
    await flush();
    const group = container.querySelector('[data-layer="f"]')!;
    const order = Array.from(group.children).filter(element => element.matches('path.df-map-line, path.df-map-casing'));
    // Casing, line, casing, line…: widest first.
    expect(order.map(element => element.getAttribute('class'))).toEqual(['df-map-casing', 'df-map-line', 'df-map-casing', 'df-map-line', 'df-map-casing', 'df-map-line']);
    const widths = order.filter(element => element.matches('.df-map-line')).map(element => Number(element.getAttribute('stroke-width')));
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
    expect(Number(order[1].getAttribute('stroke-opacity'))).toBeCloseTo(0.92);
    unmount();

    const many = Array.from({ length: 120 }, (_, index) => ({ x0: index - 60, y0: 0, x1: index - 50, y1: 20, n: index + 1 }));
    const crowded = render(<MapView spec={flowsOf(many)} data={{ f: many }} geoSets={{ countries }} />);
    await flush();
    const opacity = Number(crowded.container.querySelector('path.df-map-line')!.getAttribute('stroke-opacity'));
    expect(opacity).toBeGreaterThanOrEqual(0.65);
    expect(opacity).toBeLessThan(0.7);
    // Lines under 1.5 px take no halo, so a crowd of hairlines does not darken the map.
    const thin = Array.from(crowded.container.querySelectorAll('path.df-map-line')).filter(line => Number(line.getAttribute('stroke-width')) < 1.5).length;
    expect(crowded.container.querySelectorAll('path.df-map-casing').length).toBe(120 - thin);
    expect(thin).toBeGreaterThan(0);
    // Its lines also thin: the widest of 120 is narrower than the widest of three.
    const widest = (root: HTMLElement) => Math.max(...Array.from(root.querySelectorAll('path.df-map-line')).map(line => Number(line.getAttribute('stroke-width'))));
    expect(widest(crowded.container)).toBeLessThan(Math.max(...widths));
    crowded.unmount();
});

it('turns a flat world to the Pacific-centred view when that cuts fewer routes, and names the hub', async () => {
    const routes = [['Tokyo', 139.7, 35.7], ['Sydney', 151.2, -33.9], ['Manila', 121, 14.6], ['London', -0.1, 51.5], ['Lima', -77, -12]]
        .map(([name, lon, lat]) => ({ hub: 'Seattle', hx: -122.3, hy: 47.6, name, lon, lat }));
    const spec = parseMapSpec(JSON.stringify({ title: 'Routes', template: 'flows', data: { values: routes },
        encoding: { origin: 'hub', destination: 'name', originLat: 'hy', originLon: 'hx', destinationLat: 'lat', destinationLon: 'lon' },
        properties: { geography: 'world', curve: 'great-circle', direction: 'none' } })).spec!;
    const { container } = render(<MapView spec={spec} data={{ main: routes }} geoSets={{ countries }} />);
    await flush();
    await flush();
    // The map turns to the Pacific-centred view (edge in the Atlantic, near 20°W): the Pacific routes stay
    // whole; the one to London crosses the new edge, as on Datawrapper's Pacific map.
    const pieces = Object.fromEntries(Array.from(container.querySelectorAll('path.df-map-line')).map(line =>
        [(line as unknown as { __data__: { ends: [string, string] } }).__data__.ends[1], (line.getAttribute('d')!.match(/M/g) ?? []).length]));
    expect([pieces.Tokyo, pieces.Sydney, pieces.Manila, pieces.Lima]).toEqual([1, 1, 1, 1]);
    const labels = Array.from(container.querySelectorAll('.df-map-labels text'));
    const hub = labels.find(label => label.textContent === 'Seattle');
    expect(hub?.getAttribute('font-weight')).toBe('650');
    expect(labels.some(label => label.textContent === 'Tokyo')).toBe(true);
});

it('uses World Bank boundaries: areas of non-determined status apart from countries, their borders dotted', async () => {
    const { container } = render(<MapView spec={parseMapSpec(JSON.stringify({ view: { basemap: 'world', style: 'light' }, data: {}, layers: [] })).spec!} data={{}} geoSets={{ countries }} />);
    await flush();
    // The UN depiction: Taiwan is part of China, Crimea of Ukraine; Jammu and Kashmir and Western Sahara stand apart.
    expect(countries.byId.has('TWN')).toBe(false);
    expect(countries.byId.has('ESH')).toBe(true);
    expect(countries.byId.get('NDLSA-Jammu-and-Kashmir-IND')?.properties.ndlsa).toBe(true);
    expect(countries.byId.has('ATA')).toBe(false);
    const borders = Array.from(container.querySelectorAll('.df-map-borders path'));
    const dotted = borders.filter(path => path.getAttribute('stroke-dasharray'));
    expect(dotted).toHaveLength(1);
    expect(dotted[0].getAttribute('stroke')).toBe('#888888');
    // The basemap is cited along the bottom, linking to the source, with the disclaimer on hover.
    const credit = container.querySelector('[data-map-boundaries]')!;
    expect(credit.textContent).toBe('Map based on World Bank Official Boundaries (CC BY 4.0)');
    expect(credit.querySelector('a')?.getAttribute('href')).toContain('datacatalog.worldbank.org');
    expect(container.querySelector('[data-map-legends] [data-map-boundaries]')).toBeNull();
});

it('colours hexagon counts piled into a few cells by their logarithm, so the rest are not all the palest', async () => {
    // One cell of 2,000 finds among cells of a handful each.
    const finds = [...Array.from({ length: 2000 }, () => ({ lon: 0, lat: -80 })),
        ...Array.from({ length: 30 }, (_, index) => Array.from({ length: 1 + (index % 4) }, () => ({ lon: -150 + 10 * index, lat: 30 }))).flat()];
    const spec = parseMapSpec(JSON.stringify({ view: { basemap: 'world' }, data: { p: { values: finds } },
        layers: [{ id: 'h', type: 'hexbin', data: 'p', lon: 'lon', lat: 'lat', radius: 8 }] })).spec!;
    const { container, unmount } = render(<MapView spec={spec} data={{ p: finds }} geoSets={{ countries }} />);
    await flush();
    const fills = new Set(Array.from(container.querySelectorAll('[data-layer="h"] path')).map(hex => hex.getAttribute('fill')));
    unmount();
    // A linear scale would draw every small cell in one colour; a log one tells 1 from 2 from 3.
    expect(fills.size).toBeGreaterThan(2);
    expect(container.textContent ?? '').not.toContain('NaN');
});
