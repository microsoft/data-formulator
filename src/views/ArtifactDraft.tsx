// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * An app or map a run is writing (design-docs/58): the run's open end (its draft node, `derive.writing`) stands for
 * it until it lands. Focused, the draft owns the canvas and shows the artifact taking shape; in the thread it is a
 * card like the artifact's own. Reports are not drafts: they are written live into their own node, readable as
 * they stream.
 */

import React, { FC, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Box, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';

import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { textVar } from '../app/layout';
import { useAppDraftLines } from '../app/appDraft';
import { MiniMap, MiniWindow } from '../components/ArtifactMiniatures';
import { ThreadArtifactCard } from './DataThreadCards';

const VISIBLE_LINES = 12;
/** Code is drawn as dots like the map's: a 3px square per character, 4px apart along a line, lines 8px apart. */
const GLYPH_SIZE = 3;
const GLYPH_PITCH = 4;
const LINE_PITCH = 8;
/** The height of a draft's preview, an app's lines or a map. */
const DRAFT_HEIGHT = LINE_PITCH * VISIBLE_LINES;

/** The tools whose artifact a draft stands for while they are written. */
export const DRAFT_ARTIFACT_TOOLS = ['write_app', 'write_html_app', 'write_map'];

const isMapTool = (tool: string) => tool === 'write_map';

/** The i18n key of "Generating app" / "Generating page" / "Generating map", by the tool writing it. */
export const draftLabelKey = (tool: string) =>
    isMapTool(tool) ? 'map.generating' : tool === 'write_html_app' ? 'htmlApp.generatingPage' : 'htmlApp.generating';

const useDraftLabel = (tool: string) => {
    const { t } = useTranslation();
    return t(draftLabelKey(tool));
};

const glyphPath = (columns: number[], y: number, pitch: number, size: number) =>
    columns.map(column => `M${column * pitch} ${y}h${size}v${size}h-${size}z`).join('');

/** A masked line: every character a muted dot, spaces kept; with `caret`, the last dot written, in the primary
 * color, is the cursor (or one dot after the spaces written so far). */
const MaskedLine: FC<{ line: string; row: number; caret: boolean }> = ({ line, row, caret }) => {
    const theme = useTheme();
    const columns = [...line].flatMap((ch, column) => ch === 'x' ? [column] : []);
    const caretColumn = caret ? (line.endsWith('x') ? columns.pop()! : line.length) : undefined;
    const y = row * LINE_PITCH;
    return (
        <g data-draft-line>
            <path d={glyphPath(columns, y, GLYPH_PITCH, GLYPH_SIZE)} fill={alpha(theme.palette.text.primary, 0.14)} />
            {caretColumn !== undefined && <rect data-caret x={caretColumn * GLYPH_PITCH} y={y} width={GLYPH_SIZE} height={GLYPH_SIZE}
                fill={theme.palette.primary.main} />}
        </g>
    );
};

/** World land on a coarse grid (Natural Earth 110m land, 78°N–56°S), one cell per glyph; `x` is land. */
const WORLD_DOTS = [
    '........x.........xxxxxx...........x....xxx...........',
    'x..xxxxxxxxxxxx.xx.xxx.......xxxx.xxxxxxxxxxxxxxxxxxxx',
    '...x..xxxxxxx..xx...........xx.xxxxxxxxxxxxxxxxxx.....',
    '........xxxxxxxxxxx.......x.xxxxxxxxxxxxxxxxxxxx..x...',
    '........xxxxxxxxx..........xxxx..x.xxxxxxxxxxxx.......',
    '.........xxxxxxx..........x.x..xxxxxxxxxxxxxx..x......',
    '..........xxxxx...........xxxxxxxx.xxxxxxxxxx.........',
    '...........x.............xxxxxxxxxxx.xxxxxxx..........',
    '.............xx.........xxxxxxxxxx....x...x...........',
    '...............xxx.......xxxxxxxxx....................',
    '...............xxxxx........xxxxx.........xxx.........',
    '...............xxxxxxx.......xxxx..........x....x.....',
    '................xxxxx........xxxx.x...........x.x.....',
    '................xxxxx........xxx.x..........xxxxxx....',
    '................xxx...........xx............xxxxxx....',
    '................xx..............................x.....',
    '................x...................................x.',
    '................x.....................................',
];
const DOT_PITCH = 5;
const DOT_SIZE = 3;
const MAP_WIDTH = WORLD_DOTS[0].length * DOT_PITCH;
const MAP_HEIGHT = WORLD_DOTS.length * DOT_PITCH;
const WORLD_DOTS_PATH = WORLD_DOTS.map((row, r) =>
    glyphPath([...row].flatMap((cell, c) => cell === 'x' ? [c] : []), r * DOT_PITCH, DOT_PITCH, DOT_SIZE)).join('');

/** How many dot columns the scan's fading trail spans behind its leading column. */
const SCAN_TRAIL_COLUMNS = 10;
const SCAN_TRAIL = SCAN_TRAIL_COLUMNS * DOT_PITCH;
/** Steps from the leading column on the map's first dot column until the trail has left the right edge. */
const SCAN_STEPS = Math.ceil((MAP_WIDTH + SCAN_TRAIL - DOT_SIZE) / DOT_PITCH);
/** The mask's left edge when its leading (opaque) end sits on the first dot column. */
const SCAN_START = DOT_SIZE - SCAN_TRAIL;

/** A map taking shape: the world in the app draft's muted dots, with a primary-colored scan stepping across it one
 * dot column at a time, its trail fading behind. */
const MapDraftDots: FC = () => {
    const theme = useTheme();
    const dots = (fill: string) => <svg width={MAP_WIDTH} height={MAP_HEIGHT} viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} style={{ display: 'block' }}>
        <path d={WORLD_DOTS_PATH} fill={fill} />
    </svg>;
    // Opaque at the leading edge, fading out over the trail; it moves in whole dot pitches, so each step lands on a column.
    const trail = 'linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.3) 60%, #000)';
    const position = (x: number) => ({ maskPosition: `${x}px 0`, WebkitMaskPosition: `${x}px 0` });
    return (
        <Box aria-hidden data-testid="map-draft-placeholder" sx={{ height: DRAFT_HEIGHT, display: 'flex', alignItems: 'center' }}>
            <Box sx={{ position: 'relative', maxWidth: '100%', overflow: 'hidden' }}>
                {dots(alpha(theme.palette.text.primary, 0.14))}
                <Box sx={{
                    position: 'absolute', inset: 0,
                    maskImage: trail, WebkitMaskImage: trail,
                    maskSize: `${SCAN_TRAIL}px 100%`, WebkitMaskSize: `${SCAN_TRAIL}px 100%`,
                    maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
                    ...position(SCAN_START),
                    animation: `map-draft-scan 3s steps(${SCAN_STEPS}, end) infinite`,
                    '@keyframes map-draft-scan': {
                        from: position(SCAN_START),
                        to: position(SCAN_START + SCAN_STEPS * DOT_PITCH),
                    },
                    '@media (prefers-reduced-motion: reduce)': { display: 'none' },
                }}>
                    {dots(theme.palette.primary.main)}
                </Box>
            </Box>
        </Box>
    );
};

const useElapsedSeconds = (since: number) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [since]);
    return Math.max(0, Math.floor((now - since) / 1000));
};

export interface ArtifactDraftViewProps {
    tool: string;
    title?: string;
    /** The last lines of the code so far, masked (`x` for every visible character); none for a map. */
    lines: string[];
    lineCount: number;
    startedAt: number;
}

/**
 * "Generating app… (12s) · title" over the artifact taking shape: an app's code going by, the last lines with
 * every character a dot; a map, the world in dots with a scan crossing it.
 */
export const ArtifactDraftView: FC<ArtifactDraftViewProps> = ({ tool, title, lines: allLines, lineCount, startedAt }) => {
    const seconds = useElapsedSeconds(startedAt);
    const label = useDraftLabel(tool);
    const lines = allLines.slice(-VISIBLE_LINES);
    const firstLine = lineCount - lines.length;
    return (
        <Box role="status" aria-live="polite" aria-label={title ? `${label}: ${title}` : label}
            sx={{ width: 'min(440px, 80%)', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {/* The wipe sweeps the label while the artifact is written; sized to the text so it crosses the words. */}
            <Typography noWrap className="window-wipe" sx={{ width: 'fit-content', maxWidth: '100%',
                fontSize: textVar.xs, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                {`${label}… (${seconds}s)${title ? ` · ${title}` : ''}`}
            </Typography>
            {isMapTool(tool)
                ? <MapDraftDots />
                : <Box aria-hidden data-testid="app-draft-lines" sx={{ height: DRAFT_HEIGHT, overflow: 'hidden' }}>
                    <svg width="100%" height={DRAFT_HEIGHT} style={{ display: 'block' }}>
                        {lines.map((line, index) => (
                            <MaskedLine key={firstLine + index} line={line} row={index} caret={index === lines.length - 1} />
                        ))}
                    </svg>
                </Box>}
        </Box>
    );
};

const useDraftWriting = (draftId: string) =>
    useSelector((state: DataFormulatorState) => state.draftNodes.find(draft => draft.id === draftId)?.derive.writing);

/** The canvas of a focused draft that is writing an app or map. */
export const ArtifactDraftCanvas: FC<{ draftId: string }> = ({ draftId }) => {
    const writing = useDraftWriting(draftId);
    const code = useAppDraftLines(draftId);
    if (!writing) return null;
    return (
        <Box data-artifact-draft-canvas sx={{ flex: 1, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ArtifactDraftView tool={writing.tool} title={writing.title} lines={code?.lines ?? []} lineCount={code?.lineCount ?? 0}
                startedAt={writing.startedAt} />
        </Box>
    );
};

/**
 * A draft that is writing an app or map, in the thread: a card like the artifact's own (which takes its place once
 * written), with how long it has taken. Clicking it shows the draft on the canvas.
 */
export const ArtifactDraftCard: FC<{ draftId: string }> = ({ draftId }) => {
    const dispatch = useDispatch();
    const writing = useDraftWriting(draftId);
    const selected = useSelector((state: DataFormulatorState) => state.focusedId?.type === 'draft' && state.focusedId.draftId === draftId);
    const seconds = useElapsedSeconds(writing?.startedAt ?? 0);
    const label = `${useDraftLabel(writing?.tool ?? '')}…`;
    if (!writing) return null;
    return (
        <Box data-artifact-draft-card sx={{ display: 'flex', width: '100%', minWidth: 0 }}>
            <ThreadArtifactCard artifactType="app" title={writing.title || label} selected={selected}
                preview={isMapTool(writing.tool) ? <MiniMap /> : <MiniWindow />}
                notes={writing.title ? `${label} (${seconds}s)` : `${seconds}s`}
                onClick={() => dispatch(dfActions.setFocused({ type: 'draft', draftId }))} />
        </Box>
    );
};
