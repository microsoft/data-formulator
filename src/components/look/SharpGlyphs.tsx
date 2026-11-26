// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';

import { isAppFile } from '../../icons';

/** What a step or item is, for its sharp glyph. */
export type GlyphKind = 'user' | 'agent' | 'table' | 'chart' | 'report' | 'app' | 'map' | 'file';

/** A workspace file's glyph kind: a map, an app, or another file. */
export const fileGlyphKind = (path: string): GlyphKind =>
    /\.map\.json$/i.test(path) ? 'map' : isAppFile(path) ? 'app' : 'file';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.25 } as const;

const globe = <g {...stroke}><circle cx="6" cy="6" r="4.375" /><ellipse cx="6" cy="6" rx="1.875" ry="4.375" /><path d="M1.625 6h8.75" /></g>;

/** A chart's glyph by its type's family (the soft look's `chartFamilyIcon`, reduced to a few forms). */
const chartGlyph = (chartType = ''): React.ReactNode => {
    const type = chartType.toLowerCase();
    if (/heatmap|custom rect/.test(type)) return [0, 1, 2].flatMap(r => [0, 1, 2].map(c =>
        <rect key={`${r}${c}`} x={1.5 + c * 3.25} y={1.5 + r * 3.25} width="2.5" height="2.5" fill="currentColor"
            opacity={[[1, 0.7, 0.4], [0.7, 0.5, 0.3], [0.4, 0.3, 0.2]][r][c]} />));
    if (/map|choropleth/.test(type)) return globe;
    if (/pie|rose|donut/.test(type)) return <g {...stroke}><circle cx="6" cy="6" r="4.375" /><path d="M6 1.625V6l3.25 2.875" /></g>;
    if (/candlestick|box ?plot|violin/.test(type)) return <g><path d="M3.5 1.5v9M8.5 2.5v8" {...stroke} />
        <rect x="2.25" y="3.5" width="2.5" height="5" fill="currentColor" /><rect x="7.25" y="5" width="2.5" height="3.5" fill="currentColor" /></g>;
    if (/area|density|streamgraph/.test(type)) return <path d="M1.5 10.5V7.5L4.5 4.5L7 6.5L10.5 2.5V10.5z" fill="currentColor" />;
    if (/scatter|regression|point|dot|strip/.test(type)) return <g fill="currentColor">
        <rect x="1.75" y="7.75" width="2" height="2" /><rect x="4.75" y="4.25" width="2" height="2" />
        <rect x="8.25" y="2.25" width="2" height="2" /><rect x="7.75" y="7" width="2" height="2" /></g>;
    if (/line|slope|sparkline|ecdf|bump|timeline/.test(type)) return <path d="M1.25 9.5L4.5 5.75L7 7.75L10.75 2.75" {...stroke} strokeLinejoin="miter" />;
    // Bars: bar, grouped and stacked bars, histograms, and anything unrecognised.
    return <g fill="currentColor"><rect x="1.5" y="6" width="2.5" height="4.5" /><rect x="4.75" y="2.5" width="2.5" height="8" />
        <rect x="8" y="4.5" width="2.5" height="6" /></g>;
};

const GLYPHS: Record<Exclude<GlyphKind, 'chart'>, React.ReactNode> = {
    // The user solid: a round head over chamfered shoulders.
    user: <g fill="currentColor"><circle cx="6" cy="3.25" r="2.25" /><path d="M1.5 11.5V9.25L3.25 7.5h5.5L10.5 9.25V11.5z" /></g>,
    // The agent in outline: a square head with solid eyes and a capped antenna.
    agent: <g><rect x="1.625" y="4.125" width="8.75" height="7.25" {...stroke} /><path d="M6 1.75v2.375" {...stroke} />
        <g fill="currentColor"><rect x="5" y="0.5" width="2" height="1.75" /><rect x="3.5" y="6.5" width="1.75" height="1.75" />
            <rect x="6.75" y="6.5" width="1.75" height="1.75" /></g></g>,
    table: <g {...stroke}><rect x="1.625" y="1.625" width="8.75" height="8.75" /><path d="M1.625 4.75h8.75M5.25 4.75v5.625" /></g>,
    report: <g {...stroke}><rect x="2.125" y="1.125" width="7.75" height="9.75" /><path d="M4 4h4M4 6h4M4 8h2.5" /></g>,
    app: <g {...stroke}><rect x="1.125" y="2.125" width="9.75" height="7.75" /><path d="M1.125 4.625h9.75" /></g>,
    map: globe,
    file: <g {...stroke}><path d="M2.625 1.125h4.5l2.25 2.25v7.5h-6.75z" /><path d="M7.125 1.125v2.25h2.25" /></g>,
};

/**
 * A sharp glyph: a 12px mark drawn on a pixel grid (square ends, mitred corners, no rounding), for the precise look's
 * thread rail and status bar. Takes the current colour.
 */
export const SharpGlyph: React.FC<{ kind: GlyphKind; chartType?: string; size?: number; sx?: SxProps<Theme> }> =
    ({ kind, chartType, size = 12, sx }) =>
        <Box component="svg" viewBox="0 0 12 12" aria-hidden data-sharp-glyph={kind}
            sx={[{ width: size, height: size, display: 'block', flexShrink: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}>
            {kind === 'chart' ? chartGlyph(chartType) : GLYPHS[kind]}
        </Box>;
