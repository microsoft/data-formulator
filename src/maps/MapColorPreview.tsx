// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * /dev/map-colors: diverging maps on the light and dark styles, with the scheme the spec names (drawn as designed)
 * and with no scheme (the default ramp, which suits the style), on data shaped like real diverging measures: most
 * values near the middle, a few far out, some places without data.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';

import { DevNav } from '../views/DevNav';
import { loadGeoSet } from './geography';
import { useMapInputs, useMapLook } from './MapPreview';
import { MapView } from './MapView';
import { hash01, US_STATE_ROWS, worldIndicators } from './samples';
import { parseMapSpec } from './spec';

/** −1…1 with most values near 0: a signed power of a uniform draw. */
const skewed = (key: string, power: number) => { const u = 2 * hash01(key) - 1; return Math.sign(u) * Math.abs(u) ** power; };
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

interface Case { id: string; label: string; note: string; spec: Record<string, unknown> }

function cases(countyIds: string[]): Case[] {
    const states = US_STATE_ROWS.filter(([, abbr]) => hash01(`${abbr}gap`) > 0.06);
    const countries = Array.from(new Set(worldIndicators().map(row => String(row.iso3)))).filter(iso3 => iso3 !== 'WLD' && hash01(`${iso3}gap`) > 0.15);
    return [
        {
            id: 'margin', label: 'Vote margin · rdBu, fixed −100…100', note: 'Like tt-map-test-16 q3: most states within ±30 on a ±100 scale.',
            spec: {
                template: 'choropleth', data: { values: states.map(([state, abbr]) => ({ state, abbr, margin: round(70 * skewed(`${abbr}m`, 1.6)) })) },
                encoding: { region: 'abbr', color: 'margin' },
                fields: { margin: { semanticType: 'PercentageChange', unit: 'pts', divergingMidpoint: 0, displayName: 'Margin' } },
                properties: { geography: 'us-states', keyType: 'us-state', scheme: 'rdBu', method: 'continuous', domain: [-100, 100] },
            },
        },
        {
            id: 'retail', label: 'Year-over-year change · theme ramp', note: 'Like tt-map-test-25: mostly small gains, a few losses; names no scheme, so the theme picks the ramp.',
            spec: {
                template: 'choropleth', data: { values: states.map(([state, abbr]) => ({ state, abbr, yoy: round(4 + 9 * skewed(`${abbr}r`, 1.3)) })) },
                encoding: { region: 'abbr', color: 'yoy' },
                fields: { yoy: { semanticType: 'PercentageChange', unit: '%', divergingMidpoint: 0, displayName: 'YoY change' } },
                properties: { geography: 'us-states', keyType: 'us-state', method: 'continuous' },
            },
        },
        {
            id: 'forest', label: 'Net change as bubbles · brBG', note: 'Like tt-map-test-01: coloured marks on the land, heavy tails.',
            spec: {
                template: 'bubbles', data: { values: countries.map(iso3 => { const change = Math.round(2e5 * skewed(`${iso3}f`, 3)); return { iso3, change, magnitude: Math.abs(change) }; }) },
                encoding: { region: 'iso3', size: 'magnitude', color: 'change' },
                fields: { change: { semanticType: 'Quantity', divergingMidpoint: 0, displayName: 'Net change' }, magnitude: { semanticType: 'Quantity', displayName: 'Size of change' } },
                properties: { keyType: 'iso3', scheme: 'brBG', method: 'continuous' },
            },
        },
        {
            id: 'county', label: 'Difference from national rate · puOr, counties', note: 'Dense small fills: whether near-zero and no-data still read apart.',
            spec: {
                template: 'choropleth',
                data: { values: countyIds.filter(fips => hash01(`${fips}gap`) > 0.03).map(fips => ({ fips, diff: round(12 * skewed(`${fips}p`, 1.8)) })) },
                encoding: { region: 'fips', color: 'diff' },
                fields: { diff: { semanticType: 'PercentageChange', unit: 'pts', divergingMidpoint: 0, displayName: 'vs national' } },
                properties: { geography: 'us-counties', keyType: 'fips', scheme: 'puOr', method: 'continuous' },
            },
        },
    ];
}

interface Treatment { id: string; label: string; note: string; light?: boolean; noScheme?: boolean }

const TREATMENTS: Treatment[] = [
    { id: 'light-named', label: 'Light · scheme named', note: 'The case’s scheme, as designed.', light: true },
    { id: 'dark-named', label: 'Dark · scheme named', note: 'Drawn as designed: a pale middle is the brightest colour.' },
    { id: 'light-default', label: 'Light · no scheme', note: 'The default ramp (app theme or field semantics).', light: true, noScheme: true },
    { id: 'dark-default', label: 'Dark · no scheme', note: 'The default ramp suits the style: the middle recedes, the ends glow.', noScheme: true },
];

const Cell: React.FC<{ item: Case; treatment: Treatment; defaultTheme?: string }> = ({ item, treatment, defaultTheme }) => {
    const base = item.spec;
    const spec = useMemo(() => {
        const properties = { ...(base.properties as Record<string, unknown>) };
        if (treatment.noScheme) delete properties.scheme;
        return parseMapSpec(JSON.stringify({ ...base, properties, ...(treatment.light ? { view: { style: 'light' } } : {}) })).spec;
    }, [base, treatment]);
    const inputs = useMapInputs(spec);
    if (!spec || inputs.loading) return <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}><Typography variant="caption">Loading…</Typography></Box>;
    return <MapView spec={spec} data={inputs.data} geoSets={inputs.geoSets} still defaultTheme={defaultTheme} />;
};

export default function MapColorPreview() {
    const [countyIds, setCountyIds] = useState<string[] | null>(null);
    useEffect(() => { loadGeoSet('us-counties').then(set => setCountyIds(set.features.map(item => item.properties.id))); }, []);
    const list = useMemo(() => countyIds ? cases(countyIds) : [], [countyIds]);
    const { defaultTheme } = useMapLook(null);
    return <Box sx={{ minHeight: '100vh', fontFamily: 'var(--df-font)' }}>
        <DevNav sections={list.map(item => [item.id, item.label.split(' · ')[0]])} />
        <Box sx={{ p: 2 }}>
            <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Diverging colours on the dark map style</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 900 }}>
                Each row is one diverging map, drawn with the scheme it names and with none (the default), on each style. Synthetic data shaped like the eval sessions’ maps
                (most places near the midpoint, a few far out, some without data). App chart theme: {defaultTheme ?? 'none'}.
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${TREATMENTS.length}, minmax(300px, 1fr))`, gap: 1.5, overflowX: 'auto' }}>
                {TREATMENTS.map(treatment => <Box key={treatment.id}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{treatment.label}</Typography>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{treatment.note}</Typography>
                </Box>)}
                {list.map(item => <React.Fragment key={item.id}>
                    <Box id={item.id} sx={{ gridColumn: '1 / -1', mt: 1.5, scrollMarginTop: 48 }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{item.label}</Typography>
                        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{item.note}</Typography>
                    </Box>
                    {TREATMENTS.map(treatment => <Box key={treatment.id} sx={{ height: 360, position: 'relative', borderRadius: 1, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
                        <Cell item={item} treatment={treatment} defaultTheme={defaultTheme} />
                    </Box>)}
                </React.Fragment>)}
            </Box>
        </Box>
    </Box>;
}
