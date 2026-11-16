// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * /dev/map-bubbles: crowded bubble maps at a thumbnail, a medium and a full panel size, for judging bubble outlines
 * and sizes (fitted to the data's density and the panel).
 */

import React, { useMemo, useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

import { DevNav } from '../views/DevNav';
import { useMapInputs, useMapLook } from './MapPreview';
import { MapView } from './MapView';
import { CITIES, hash01, stateStats, worldIndicators } from './samples';
import { parseMapSpec } from './spec';

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

interface Case { id: string; label: string; note: string; spec: Record<string, unknown> }

function cases(): Case[] {
    const countries = new Map<string, string>();
    for (const row of worldIndicators()) if (row.iso3 !== 'WLD') countries.set(String(row.iso3), String(row.region));
    const iso3s = Array.from(countries.keys());
    return [
        {
            id: 'hosts', label: 'One colour, heavy tail', note: 'Like tt-map-test-10 q3 / 29: a few huge bubbles over many small ones.',
            spec: {
                template: 'bubbles', data: { values: iso3s.map(iso3 => ({ iso3, people: Math.round(3.6e6 * hash01(`${iso3}h`) ** 4) })) },
                encoding: { region: 'iso3', size: 'people' }, fields: { people: { semanticType: 'Count', displayName: 'People hosted' } },
                properties: { keyType: 'iso3' },
            },
        },
        {
            id: 'continents', label: 'Coloured by category', note: 'Overlapping bubbles of different colours (Europe, West Africa).',
            spec: {
                template: 'bubbles', data: { values: iso3s.map(iso3 => ({ iso3, continent: countries.get(iso3), population: Math.round(2e8 * hash01(`${iso3}p`) ** 2.5) })) },
                encoding: { region: 'iso3', size: 'population', color: 'continent' }, fields: { population: { semanticType: 'Count', displayName: 'Population' } },
                properties: { keyType: 'iso3' },
            },
        },
        {
            id: 'forest', label: 'Diverging colour', note: 'Like tt-map-test-01: the crowded map from the colour preview.',
            spec: {
                template: 'bubbles',
                data: { values: iso3s.map(iso3 => { const u = 2 * hash01(`${iso3}f`) - 1; const change = Math.round(2e5 * Math.sign(u) * Math.abs(u) ** 3); return { iso3, change, magnitude: Math.abs(change) }; }) },
                encoding: { region: 'iso3', size: 'magnitude', color: 'change' },
                fields: { change: { semanticType: 'Quantity', divergingMidpoint: 0, displayName: 'Net change' }, magnitude: { semanticType: 'Quantity', displayName: 'Size of change' } },
                properties: { keyType: 'iso3', method: 'continuous' },
            },
        },
        {
            id: 'cities', label: 'Cities by coordinates', note: 'Point bubbles that crowd in East and South Asia.',
            spec: {
                template: 'bubbles', data: { values: CITIES.map(([city, , lon, lat, pop]) => ({ city, lon, lat, population: round(pop) })) },
                encoding: { lat: 'lat', lon: 'lon', size: 'population', label: 'city' }, fields: { population: { semanticType: 'Count', unit: 'million', displayName: 'Population' } },
            },
        },
        {
            id: 'dense', label: '3,000 points', note: 'Like the meteorites (tt-map-test-03) as bubbles: the floor keeps the largest readable.',
            spec: {
                template: 'bubbles',
                data: { values: Array.from({ length: 3000 }, (_, index) => ({ lon: round(-170 + 340 * hash01(`x${index}`), 2), lat: round(-55 + 125 * hash01(`y${index}`) ** 1.3, 2),
                    mass: Math.round(1e5 * hash01(`m${index}`) ** 6) })) },
                encoding: { lat: 'lat', lon: 'lon', size: 'mass' }, fields: { mass: { semanticType: 'Quantity', unit: 'kg', displayName: 'Mass' } },
            },
        },
        {
            id: 'states', label: 'US states', note: 'Bubbles at state centres; the Northeast crowds.',
            spec: {
                template: 'bubbles', data: { values: stateStats() }, encoding: { region: 'state', size: 'population' },
                fields: { population: { semanticType: 'Count', displayName: 'Population' } }, properties: { geography: 'us-states' },
            },
        },
    ];
}

const SIZES: { label: string; width: number; height: number }[] = [
    { label: 'Thumbnail', width: 340, height: 240 }, { label: 'Medium', width: 600, height: 420 }, { label: 'Full panel', width: 1000, height: 680 },
];

const Cell: React.FC<{ base: Record<string, unknown>; style: 'light' | 'dark'; defaultTheme?: string }> = ({ base, style, defaultTheme }) => {
    const spec = useMemo(() => parseMapSpec(JSON.stringify({ ...base, view: { style } })).spec, [base, style]);
    const inputs = useMapInputs(spec);
    if (!spec || inputs.loading) return <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}><Typography variant="caption">Loading…</Typography></Box>;
    return <MapView spec={spec} data={inputs.data} geoSets={inputs.geoSets} still defaultTheme={defaultTheme} />;
};

export default function MapBubblePreview() {
    const list = useMemo(cases, []);
    const { defaultTheme } = useMapLook(null);
    const [style, setStyle] = useState<'light' | 'dark'>('dark');
    return <Box sx={{ minHeight: '100vh', fontFamily: 'var(--df-font)' }}>
        <DevNav sections={list.map(item => [item.id, item.label])} />
        <Box sx={{ p: 2 }}>
            <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Bubbles at different panel sizes</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 900 }}>
                Each case at a thumbnail, a medium and a full panel size. The largest bubble fits the data and the panel: the
                bubbles cover about 15% of it, never above the default size nor below 40% of it. Synthetic data.
            </Typography>
            <ToggleButtonGroup size="small" exclusive value={style} onChange={(_, value) => value && setStyle(value)} sx={{ mb: 2 }}>
                <ToggleButton value="dark">Dark</ToggleButton><ToggleButton value="light">Light</ToggleButton>
            </ToggleButtonGroup>
            {list.map(item => <Box key={item.id} id={item.id} sx={{ mb: 4, scrollMarginTop: 48 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{item.label}</Typography>
                <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 1 }}>{item.note}</Typography>
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', mb: 1.5, overflowX: 'auto' }}>
                    {SIZES.map(size => <Box key={size.label} sx={{ flexShrink: 0 }}>
                        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{size.label} ({size.width}×{size.height})</Typography>
                        <Box sx={{ width: size.width, height: size.height, position: 'relative', borderRadius: 1, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
                            <Cell base={item.spec} style={style} defaultTheme={defaultTheme} />
                        </Box>
                    </Box>)}
                </Box>
            </Box>)}
        </Box>
    </Box>;
}
