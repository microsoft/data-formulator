// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Legends for map layers: gradients, classes, categories (click to hide), and sizes. */

import React, { FC } from 'react';
import { Box, Typography } from '@mui/material';

import { arrowPath, type LegendModel } from './scales';

const swatch = { width: 12, height: 12, borderRadius: '2px', flexShrink: 0 } as const;


export const MapLegend: FC<{
    legend: LegendModel;
    hidden?: Set<string>;
    onToggle?: (value: string) => void;
    onHover?: (item: { value?: string; from?: number; to?: number } | null) => void;
}> = ({ legend, hidden, onToggle, onHover }) => {
    return <Box data-map-legend sx={{ minWidth: 0 }}>
        {legend.kind !== 'bivariate' && <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: 'text.secondary', mb: 0.5, lineHeight: 1.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{legend.title}</Typography>}
        {legend.kind === 'gradient' && <Box sx={{ width: 180 }}>
            <Box sx={{ height: 10, borderRadius: '2px', background: `linear-gradient(to right, ${legend.stops.join(', ')})` }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.25 }}>
                {(legend.midpoint !== undefined ? [legend.domain[0], legend.midpoint, legend.domain[1]] : legend.domain).map((value, index) =>
                    <Typography key={index} sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>{legend.format(value)}</Typography>)}
            </Box>
        </Box>}
        {legend.kind === 'classes' && <Box sx={{ width: 200, pb: 1.75 }}>
            <Box sx={{ display: 'flex', height: 10, borderRadius: '2px', overflow: 'hidden' }}>
                {legend.items.map(item => <Box key={item.label} title={item.label} onMouseEnter={() => onHover?.({ from: item.from, to: item.to })}
                    onMouseLeave={() => onHover?.(null)} sx={{ flex: 1, bgcolor: item.color }} />)}
            </Box>
            <Box sx={{ position: 'relative' }}>
                {legend.items.slice(1).map((item, index) => <Typography key={item.label} sx={{ position: 'absolute', top: 2,
                    left: `${(index + 1) * 100 / legend.items.length}%`, transform: 'translateX(-50%)', fontSize: '0.66rem', color: 'text.secondary',
                    whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{item.tick}</Typography>)}
            </Box>
        </Box>}
        {legend.kind === 'categories' && <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: 180, overflowY: 'auto' }}>
            {legend.items.map(item => {
                const off = hidden?.has(item.value);
                return <Box key={item.value} component={onToggle ? 'button' : 'div'} type={onToggle ? 'button' : undefined}
                    aria-pressed={onToggle ? !off : undefined}
                    onClick={() => onToggle?.(item.value)} onMouseEnter={() => onHover?.({ value: item.value })} onMouseLeave={() => onHover?.(null)}
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.75, p: '1px 2px', m: 0, border: 0, bgcolor: 'transparent', font: 'inherit',
                        textAlign: 'left', cursor: onToggle ? 'pointer' : 'default', borderRadius: '3px', opacity: off ? 0.4 : 1,
                        '&:hover': onToggle ? { bgcolor: 'action.hover' } : {} }}>
                    <Box sx={{ ...swatch, borderRadius: '50%', bgcolor: off ? 'transparent' : item.color, border: `1.5px solid ${item.color}` }} />
                    <Typography sx={{ fontSize: '0.7rem', color: 'text.primary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>{item.label}</Typography>
                </Box>;
            })}
        </Box>}
        {legend.kind === 'bivariate' && <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5 }}>
            <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary', writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap',
                maxHeight: 72, overflow: 'hidden', textOverflow: 'ellipsis' }}>{legend.title2} →</Typography>
            <Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 18px)', gridAutoRows: '18px' }}>
                    {legend.colors.slice().reverse().flatMap((row, rowIndex) => row.map((color, columnIndex) =>
                        <Box key={`${rowIndex}-${columnIndex}`} sx={{ bgcolor: color }} />))}
                </Box>
                <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary', mt: 0.25, whiteSpace: 'nowrap' }}>{legend.title} →</Typography>
            </Box>
        </Box>}
        {legend.kind === 'sizes' && legend.shape === 'circle' && <NestedCircles items={legend.items} />}
        {legend.kind === 'sizes' && legend.shape !== 'circle' && <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1.25 }}>
            {legend.items.map(item => <Box key={item.label} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                {legend.shape === 'circle'
                    ? <Box sx={{ width: Math.max(4, item.radius * 2), height: Math.max(4, item.radius * 2), borderRadius: '50%', border: '1px solid', borderColor: 'text.disabled' }} />
                    : legend.shape === 'spike'
                        ? <svg width={8} height={Math.max(4, Math.min(80, item.radius))}><path d={`M0,${Math.min(80, item.radius)}L4,0L8,${Math.min(80, item.radius)}`} fill="none" stroke="currentColor" opacity={0.7} /></svg>
                        : legend.shape === 'arrow'
                        ? <svg width={Math.max(8, item.radius) + 2} height={10} style={{ overflow: 'visible' }}><path d={arrowPath(1, 5, Math.max(6, item.radius) + 1, 5)}
                            fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" opacity={0.75} /></svg>
                        : <Box sx={{ width: 28, height: Math.max(1, item.radius), bgcolor: 'text.secondary', opacity: 0.7, borderRadius: 1 }} />}
                <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>{item.label}</Typography>
            </Box>)}
        </Box>}
    </Box>;
};

/** Bubble sizes as nested circles on one baseline, each labelled at its top: compact and true to scale. */
const NestedCircles: FC<{ items: { radius: number; label: string }[] }> = ({ items }) => {
    const sorted = items.filter(item => item.radius > 0).sort((a, b) => b.radius - a.radius);
    if (!sorted.length) return null;
    const largest = Math.max(2, sorted[0].radius);
    const size = largest * 2 + 2;
    const labelX = size + 18;
    return <svg width={labelX + 44} height={size + 2} style={{ display: 'block', overflow: 'visible' }} aria-hidden>
        {sorted.map((item, index) => {
            const radius = Math.max(1.5, item.radius);
            const cy = size + 1 - radius;
            const top = cy - radius;
            // Labels too close to the previous one are dropped.
            const crowded = index > 0 && top - (size + 1 - 2 * Math.max(1.5, sorted[index - 1].radius)) < 9;
            return <g key={item.label}>
                <circle cx={largest + 1} cy={cy} r={radius} fill="none" stroke="currentColor" strokeOpacity={0.35} />
                {!crowded && <>
                    <line x1={largest + 1} x2={labelX - 3} y1={top} y2={top} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="2 2" />
                    <text x={labelX} y={top} dominantBaseline="middle" fontSize={10.5} fill="currentColor" opacity={0.7}>{item.label}</text>
                </>}
            </g>;
        })}
    </svg>;
};
