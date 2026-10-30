import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

it('groups the widgets beside a wide panel, or under the title, with the legend in its own corner', async () => {
    for (const [size, placement] of [[{ width: 1600, height: 500 }, 'side'], [{ width: 600, height: 700 }, 'top']] as const) {
        panelSize = size;
        const { container, unmount } = render(<MapView spec={map} data={{ d: rows }} geoSets={{ countries }} />);
        await flush();
        await flush();
        const widgets = container.querySelector('[data-map-widgets]') as HTMLElement;
        expect(widgets).toHaveAttribute('data-map-placement', placement);
        // Controls and the timeline sit together; the legend does not.
        expect(widgets.querySelector('[data-map-controls]')).not.toBeNull();
        expect(widgets.querySelector('[data-map-timeline]')).not.toBeNull();
        expect(widgets.querySelector('[data-map-legends]')).toBeNull();
        unmount();
    }
    panelSize = { width: 900, height: 600 };
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
    for (const [style, projection, ovals, background] of [[undefined, undefined, 0, 'rgb(255, 255, 255)'], ['atlas', undefined, 0, 'rgb(219, 233, 242)'],
        [undefined, 'orthographic', 1, 'rgb(255, 255, 255)'], ['atlas', 'orthographic', 1, 'rgb(255, 255, 255)']] as const) {
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
            // Both places get a node dot.
            expect(root.querySelectorAll('circle.df-map-node')).toHaveLength(2);
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
    const few = [{ x0: 0, y0: 0, x1: 30, y1: 10, n: 1 }, { x0: 0, y0: 0, x1: 30, y1: -10, n: 10 }, { x0: 5, y0: 5, x1: -30, y1: 20, n: 5 }];
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
    expect(opacity).toBeGreaterThanOrEqual(0.55);
    expect(opacity).toBeLessThan(0.6);
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
    const { container } = render(<MapView spec={parseMapSpec(JSON.stringify({ view: { basemap: 'world' }, data: {}, layers: [] })).spec!} data={{}} geoSets={{ countries }} />);
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
