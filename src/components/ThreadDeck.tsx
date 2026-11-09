// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A collapsed thread as its opening request over everything it produced (charts, reports, apps, files). Charts sit in justified rows of
 * one height (see justifyRows), each in its own shape; reports, apps and files follow as rows. Clicking one focuses it.
 * The tiles settle into place when the thread collapses.
 */

import React from 'react';
import { Box, Typography } from '@mui/material';
import { alpha, Theme } from '@mui/material/styles';
import { keyframes } from '@mui/system';
import { useSelector } from 'react-redux';
import { DataFormulatorState } from '../app/dfSlice';
import { getCachedChart } from '../app/chartCache';
import { textVar } from '../app/layout';
import { AppMiniature, ReportMiniature } from './ArtifactMiniatures';
import { FileTypeIcon } from '../icons';
import { iconTone } from '../app/tokens';

/**
 * Something a thread produced: a chart (`src` overrides its own picture), a report, an app, another file, a
 * workflow definition, or a table with no chart.
 * Charts tile a mosaic; the rest are compact rows with their titles.
 */
export type ThreadOutput =
    | { kind?: 'chart'; id: string; title?: string; src?: string }
    | { kind: 'report'; id: string; title: string; chartIds: string[] }
    | { kind: 'app'; id: string; title: string; path: string; version?: string }
    | { kind: 'file'; id: string; title: string; path: string }
    /** A workflow definition, shown by its icon. */
    | { kind: 'workflow'; id: string; title: string; icon: React.ReactNode }
    /** A table with no chart: it counts toward a sub-thread's size, but has no tile. */
    | { kind: 'table'; id: string; title: string };

const DEFAULT_ASPECT = 4 / 3;
const MINIATURE_WIDTH = 22;

/** Height of the mosaic below the thread header, for column layout before it is measured. */
export const THREAD_DECK_HEIGHT = 190;

/** Every row of charts aims at this height, as a share of the column width (about three 4:3 charts side by side). */
export const ROW_HEIGHT = 0.28;
// A row stretches to the column's width only while that keeps its height within this share of the target.
const ROW_STRETCH = 0.35;
const ROW_MAX = 4;
/**
 * A tile's shape: the chart's own, kept between square and 2:1, so tall or very wide charts don't leave rows
 * short or crowd them out. A chart outside that range is fitted inside its tile with a little space around it.
 */
export const tileAspect = (aspect: number) => Math.min(2, Math.max(1, aspect));

export type JustifiedRow = { size: number; fill: boolean };
/**
 * Lays charts (by their width ÷ height) out in rows, in order, as a photo gallery does: every row aims at
 * one height, so tiles look alike however many share a row. A row fills the column when that keeps its
 * height near the target (a crowded row shrinks to fit); one that can't (a lone chart, a short row) keeps
 * the target height and its own width instead of growing. The split is chosen as a whole, so no row
 * ends up much taller or shorter than the others.
 */
export const justifyRows = (aspects: number[], target = ROW_HEIGHT): JustifiedRow[] => {
    const rowCost = (from: number, to: number) => {
        const sum = aspects.slice(from, to).reduce((total, aspect) => total + aspect, 0);
        const filled = 1 / sum;
        if (filled <= target * (1 + ROW_STRETCH)) return { cost: Math.log(filled / target) ** 2, fill: true };
        // Too narrow to fill: it keeps the target height, and the space it leaves costs a little.
        return { cost: (1 - sum * target) ** 2, fill: false };
    };
    const best: { cost: number; from: number; fill: boolean }[] = [{ cost: 0, from: 0, fill: true }];
    for (let to = 1; to <= aspects.length; to++) {
        best[to] = { cost: Infinity, from: 0, fill: true };
        for (let from = Math.max(0, to - ROW_MAX); from < to; from++) {
            const row = rowCost(from, to);
            if (best[from].cost + row.cost < best[to].cost) best[to] = { cost: best[from].cost + row.cost, from, fill: row.fill };
        }
    }
    const rows: JustifiedRow[] = [];
    for (let to = aspects.length; to > 0; to = best[to].from) rows.unshift({ size: to - best[to].from, fill: best[to].fill });
    return rows;
};

const settle = keyframes`
    from { transform: translateY(-8px); opacity: 0; }
    to { transform: none; opacity: 1; }`;
const motionSx = (delay: number) => ({
    animation: `${settle} 240ms cubic-bezier(0.2, 0.8, 0.2, 1) ${delay}ms both`,
    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
});

/** A chart's sharpest picture: its full render, else its stored thumbnail. */
const useChartPicture = (chartId: string): string | undefined => {
    // The stored thumbnail changes whenever the chart is re-rendered, and with it the cached render.
    const stored = useSelector((state: DataFormulatorState) => state.chartThumbnails?.[chartId]);
    return getCachedChart(chartId)?.fullPngDataUrl || stored;
};

const ChartPicture: React.FC<{ output: ThreadOutput & { kind?: 'chart' }; onAspect: (aspect: number) => void }> = ({ output, onAspect }) => {
    const own = useChartPicture(output.id);
    const src = output.src ?? own;
    return src
        ? <Box component="img" src={src} alt="" onLoad={(event: React.SyntheticEvent<HTMLImageElement>) => {
            const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
            if (w && h) onAspect(w / h);
        }} sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
        : <Box sx={{ width: '100%', height: '100%', bgcolor: 'rgba(0,0,0,0.03)' }} />;
};

type Artifact = Exclude<ThreadOutput, { kind?: 'chart' } | { kind: 'table' }>;
const isArtifact = (output: ThreadOutput): output is Artifact => !!output.kind && output.kind !== 'chart' && output.kind !== 'table';
// Reports and apps are the agent's authored outputs: tinted purple, as their cards in the thread.
const isAuthored = (output: ThreadOutput) => output.kind === 'report' || output.kind === 'app';

/** What clicking an output does, and how it shows it is focused. */
const selectableProps = (output: ThreadOutput, selected: boolean, onSelect?: () => void) => ({
    component: onSelect ? 'button' : 'span', type: onSelect ? 'button' : undefined, 'data-deck-tile': true,
    'aria-label': onSelect ? output.title : undefined, 'aria-pressed': onSelect ? selected : undefined,
    onClick: onSelect ? (event: React.MouseEvent) => { event.stopPropagation(); onSelect(); } : undefined,
}) as const;
const selectableSx = (selected: boolean, tone: 'primary' | 'secondary' = 'primary', tinted = false) => ({
    boxSizing: 'border-box', m: 0, font: 'inherit', cursor: 'pointer', borderRadius: '6px', overflow: 'hidden',
    bgcolor: (theme: Theme) => tinted ? theme.palette[tone].bgcolor || alpha(theme.palette[tone].main, 0.08) : theme.palette.background.paper,
    border: '1px solid', borderColor: (theme: Theme) => selected ? theme.palette[tone].main
        : tinted ? alpha(theme.palette[tone].main, 0.2) : 'rgba(0,0,0,0.08)',
    outline: selected ? '1px solid' : 'none', outlineColor: `${tone}.main`, transition: 'border-color 150ms ease',
    '&:hover': { borderColor: (theme: Theme) => selected || tinted ? theme.palette[tone].main : 'rgba(0,0,0,0.3)' },
    '&:focus-visible': { outline: '2px solid', outlineColor: `${tone}.main`, outlineOffset: 1 },
}) as const;

/** One chart in the mosaic, framed by a thin edge; clicking it focuses the chart. */
const Tile: React.FC<{ output: ThreadOutput & { kind?: 'chart' }; aspect: number; width?: string; delay: number; animate: boolean;
    selected: boolean; onSelect?: () => void; onAspect: (aspect: number) => void }> =
    ({ output, aspect, width, delay, animate, selected, onSelect, onAspect }) =>
    <Box {...selectableProps(output, selected, onSelect)}
        sx={{ ...selectableSx(selected), display: 'flex', minWidth: 0, aspectRatio: `${aspect}`, p: '2px',
            // A filling row grows each tile by its aspect ratio, so all share one height; otherwise each keeps the target height.
            ...(width ? { width, flex: 'none' } : { flex: `${aspect} 1 0` }), ...(animate ? motionSx(delay) : {}) }}>
        <ChartPicture output={output} onAspect={onAspect} />
    </Box>;

/** A report, app or file as one compact row: its miniature or icon beside its title; clicking it focuses it. */
const ArtifactRow: React.FC<{ output: Artifact; delay: number; animate: boolean; selected: boolean; onSelect?: () => void }> =
    ({ output, delay, animate, selected, onSelect }) =>
    <Box {...selectableProps(output, selected, onSelect)}
        sx={{ ...selectableSx(selected, isAuthored(output) ? 'secondary' : 'primary', isAuthored(output)),
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', minWidth: 0,
            p: '3px 8px 3px 4px', textAlign: 'left', ...(animate ? motionSx(delay) : {}) }}>
        <Box sx={{ flexShrink: 0, display: 'flex' }}>
            {output.kind === 'report' ? <ReportMiniature chartIds={output.chartIds} width={MINIATURE_WIDTH} />
                : output.kind === 'app' ? <AppMiniature path={output.path} version={output.version} width={MINIATURE_WIDTH * 1.25} />
                : output.kind === 'file' ? <FileTypeIcon path={output.path} size={16} sx={{ color: iconTone.rest, mx: '4px' }} />
                : <Box sx={{ display: 'flex', mx: '4px', color: iconTone.rest, '& svg': { width: 16, height: 16 } }}>{output.icon}</Box>}
        </Box>
        <Typography component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: textVar.xs, color: isAuthored(output) ? 'text.primary' : 'text.secondary' }}>{output.title}</Typography>
    </Box>;

export const ThreadDeck: React.FC<{
    outputs: ThreadOutput[];
    /** The thread's opening request. */
    heading?: string;
    animate?: boolean;
    /** The output in focus, outlined. */
    selectedId?: string;
    /** Focus an output. */
    onSelect?: (output: ThreadOutput) => void;
}> = ({ outputs, heading, animate = false, selectedId, onSelect }) => {
    const [aspects, setAspects] = React.useState<Record<string, number>>({});
    // Outputs present when the view first showed; any that arrive later (a run still working) settle in.
    const [initial] = React.useState(() => new Set(outputs.map(output => output.id)));
    const settles = (output: ThreadOutput) => animate || !initial.has(output.id);
    const noteAspect = React.useCallback((id: string, aspect: number) =>
        setAspects(prev => Math.abs((prev[id] ?? 0) - aspect) < 0.01 ? prev : { ...prev, [id]: aspect }), []);
    // Charts tile a mosaic; reports, apps and files follow as compact rows.
    const charts = outputs.filter((output): output is ThreadOutput & { kind?: 'chart' } => !output.kind || output.kind === 'chart');
    const artifacts = outputs.filter(isArtifact);
    const aspectOf = (output: ThreadOutput) => tileAspect(aspects[output.id] ?? DEFAULT_ASPECT);
    const tile = (output: ThreadOutput & { kind?: 'chart' }, index: number, width?: string) =>
        <Tile key={output.id} output={output} aspect={aspectOf(output)} width={width} delay={animate ? index * 40 : 0} animate={settles(output)}
            selected={output.id === selectedId} onSelect={onSelect && (() => onSelect(output))}
            onAspect={aspect => noteAspect(output.id, aspect)} />;
    let start = 0;
    // Only the thread header expands it; here a click on an output focuses it.
    return <Box data-thread-deck sx={{ width: '100%', minWidth: 0 }}>
        {heading && <Typography component="span" data-deck-heading sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', px: 0.25, fontSize: textVar.xs, lineHeight: 1.45, color: 'text.secondary', mb: outputs.length ? '6px' : 0 }}>
            {heading}</Typography>}
        {outputs.length > 0 && <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {justifyRows(charts.map(aspectOf)).map(({ size, fill }) => {
                const row = charts.slice(start, start += size);
                return <Box key={start} sx={{ display: 'flex', gap: '4px' }}>
                    {row.map((output, index) => tile(output, start - size + index,
                        fill ? undefined : `${(ROW_HEIGHT * aspectOf(output) * 100).toFixed(1)}%`))}
                </Box>;
            })}
            {artifacts.map((output, index) => <ArtifactRow key={output.id} output={output} delay={animate ? (charts.length + index) * 40 : 0}
                animate={settles(output)} selected={output.id === selectedId} onSelect={onSelect && (() => onSelect(output))} />)}
        </Box>}
    </Box>;
};
