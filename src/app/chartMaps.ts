// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** The largest US state FIPS code (US territories included); larger numeric ids can only be countries. */
const MAX_US_FIPS = 78;

/**
 * Flint picks a choropleth's base map from its ids, and treats any bare number as a US state FIPS code,
 * so a world map keyed by ISO 3166-1 numeric codes (4 = Afghanistan, … 894 = Zambia) is drawn as US
 * states. Unless the chart already chose a region, an id beyond the FIPS range selects the world map.
 */
export function choroplethRegion(chartType: string, encodings: Record<string, { field?: string } | undefined>,
    rows: Record<string, unknown>[], chartProperties?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (chartType !== 'Choropleth' || (chartProperties?.region && chartProperties.region !== 'auto')) return chartProperties;
    const field = encodings.id?.field;
    if (!field) return chartProperties;
    const countryCodes = rows.some(row => {
        const value = row[field];
        const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
        return Number.isFinite(number) && number > MAX_US_FIPS;
    });
    return countryCodes ? { ...chartProperties, region: 'world' } : chartProperties;
}

/** Light grey for places with no value, so a map keeps its land where data is missing. */
export const NO_DATA_FILL = '#e4e6e8';

/**
 * A choropleth joins its rows into the map's shapes; a shape with no row gets an empty value, which
 * Vega-Lite filters out, so countries without data vanish and the map loses its outline. Keep them and
 * draw them in a quiet grey instead. Mutates and returns the (Vega-Lite) spec.
 */
export function keepUnmatchedRegions<T extends Record<string, any>>(spec: T): T {
    const visit = (node: Record<string, any>) => {
        const mark = node.mark;
        const isGeo = mark === 'geoshape' || mark?.type === 'geoshape';
        const color = node.encoding?.color;
        if (isGeo && color?.field && !color.condition) {
            node.mark = { ...(typeof mark === 'string' ? { type: mark } : mark), invalid: null };
            // A log colour scale reads as "0.01, 1, 100" to most readers and lets a near-zero report
            // set the whole map's range; shade by the plain value instead.
            if (color.scale?.type === 'log' || color.scale?.type === 'symlog') {
                const { type: _type, ...scale } = color.scale;
                color.scale = scale;
            }
            const ref = `datum[${JSON.stringify(color.field)}]`;
            node.encoding.color = { ...color, condition: { test: `${ref} === null || !isValid(${ref})`, value: NO_DATA_FILL } };
        }
        for (const child of node.layer ?? []) visit(child);
    };
    visit(spec);
    // The world base map includes Antarctica (id 10), which no UIS indicator covers.
    if (typeof spec.data?.url === 'string' && spec.data.url.includes('world-110m')) {
        (spec as Record<string, any>).transform = [{ filter: 'datum.id !== 10' }, ...(spec.transform ?? [])];
    }
    return spec;
}
