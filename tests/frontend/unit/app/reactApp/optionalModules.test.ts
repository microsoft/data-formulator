import { screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import * as vega from 'vega';
import * as vegaLite from 'vega-lite';
import runtimeBundle from 'virtual:df-react-runtime';
import d3Bundle from 'virtual:df-react-runtime/d3';
import geoBundle from 'virtual:df-react-runtime/geo';
import lodashBundle from 'virtual:df-react-runtime/lodash';
import bridgeSource from '../../../../../src/app/htmlApp/dfAppRuntime.js?raw';
import { compileReactApp, mountScript } from '../../../../../src/app/reactApp/compile';

// An app using the optional modules (d3, lodash, @df/geo), workspace SQL, a live
// source query, and a Flint map, run through the real compiler and bundles.
const APP = `// @df-app {"version": 2, "title": "Quakes", "tables": ["quakes"], "sources": ["external:kusto:Events"]}
import _ from 'lodash';
import { groupBy } from 'lodash';
import * as d3 from 'd3';
import { countries, states } from '@df/geo';
import { useSql, useSourceQuery } from '@df/data';
import { Page } from '@df/ui';
import { FlintChart } from '@df/chart';
export default function App() {
  const byRegion = useSql('select region, count(*) as n from quakes where magnitude >= ? group by 1', [5]);
  const live = useSourceQuery('external:kusto:Events', { group_by: ['day'], aggregates: [{ op: 'count', as: 'events' }] });
  const total = _.sumBy(byRegion.rows, 'n');
  const regions = Object.keys(groupBy(byRegion.rows, 'region')).length;
  return <Page title="Quakes">
    <p>Total {d3.format(',')(total)} in {regions} regions</p>
    <p>{countries().length} countries, {states().length} states, {live.rows.length} live days</p>
    <FlintChart chartType="Map" data={[{ lat: 35, lon: 139, mag: 6 }]} encodings={{ latitude: 'lat', longitude: 'lon', size: 'mag' }} />
  </Page>;
}
`;

let sql: ReturnType<typeof vi.fn>;
let sourceQuery: ReturnType<typeof vi.fn>;
let chart: ReturnType<typeof vi.fn>;
let network: ReturnType<typeof vi.fn>;

beforeAll(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 900, height: 300 } as DOMRect);
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    (window as any).__DF_APP_CONFIG__ = { channel: 'test', manifest: { tables: ['quakes'] }, theme: {}, paletteKey: 'fluent' };
    new Function(bridgeSource)();
    const format = (window as any).DF.format;
    sql = vi.fn(async () => ({ rows: [{ region: 'Pacific', n: 1200 }, { region: 'Atlantic', n: 34 }], totalRowCount: 2, truncated: false }));
    sourceQuery = vi.fn(async () => ({ rows: [{ day: '2026-10-11', events: 9 }], totalRowCount: 1, truncated: false }));
    chart = vi.fn(async () => ({ finalize: vi.fn() }));
    (window as any).DF = { ready: Promise.resolve(), manifest: { tables: ['quakes'], sources: ['external:kusto:Events'] },
        theme: { palette: ['#4c78a8'] }, query: vi.fn(), sql, sourceQuery, chart,
        sparkline: vi.fn(async () => ({ finalize: vi.fn() })), format, reportError: vi.fn() };
    // The frame loads vega and vega-lite as scripts before the runtime, and has no network.
    network = vi.fn(async () => { throw new Error('the sandbox has no network'); });
    Object.assign(window, { vega, vegaLite, fetch: network });
    for (const source of [runtimeBundle, d3Bundle, lodashBundle, geoBundle]) new Function(source)();
});

afterAll(() => {
    vi.restoreAllMocks();
    for (const name of ['DF', '__DF_REACT__', '__DF_OPTIONAL_MODULES__', 'vega', 'vegaLite', '__dfBasemapFetch']) delete (window as any)[name];
});

it('runs an app using d3, lodash, @df/geo, workspace SQL, a live source, and an offline Flint map', async () => {
    const compiled = compileReactApp(APP);
    expect(compiled).toMatchObject({ ok: true, optionalModules: ['d3', 'lodash', '@df/geo'] });
    if (!compiled.ok) return;
    const root = document.createElement('div');
    root.id = 'df-app-root';
    document.body.appendChild(root);
    const appRoot = new Function(`return ${mountScript(compiled.code)}`)();

    await waitFor(() => expect(screen.getByText('Total 1,234 in 2 regions')).toBeInTheDocument());
    expect(sql).toHaveBeenCalledWith('select region, count(*) as n from quakes where magnitude >= ? group by 1', [5], {});
    await waitFor(() => expect(screen.getByText(/^1\d\d countries, 5\d states, 1 live days$/)).toBeInTheDocument());
    expect(sourceQuery).toHaveBeenCalledWith('external:kusto:Events',
        { group_by: ['day'], aggregates: [{ op: 'count', as: 'events' }] }, {});

    // Flint draws the map, its basemap served from @df/geo instead of vega.github.io (no network in the sandbox).
    await waitFor(() => expect(document.querySelectorAll('[data-flint-chart] svg path').length).toBeGreaterThan(100), { timeout: 5000 });
    expect(network).not.toHaveBeenCalled();
    expect((window as any).DF.reportError).not.toHaveBeenCalled();
    appRoot.unmount();
});
