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
import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined';

import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { textVar } from '../app/layout';
import { useAppDraftLines } from '../app/appDraft';
import { MiniMap, MiniWindow } from '../components/ArtifactMiniatures';
import { ThreadArtifactCard } from './DataThreadCards';

const LINE_HEIGHT = 18;
const VISIBLE_LINES = 5;

/** The glyph each written character shows as. */
const GLYPH = '■';

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

/** A masked line in the code font: every character a muted glyph, spaces kept; the last glyph written, in the
 * primary color, is the cursor. */
const MaskedLine: FC<{ line: string; caret: boolean }> = ({ line, caret }) => {
    const text = line.replace(/x/g, GLYPH);
    // The cursor: the last glyph, or one after the spaces written so far.
    const body = caret && text.endsWith(GLYPH) ? text.slice(0, -1) : text;
    return (
        <Box sx={{ height: LINE_HEIGHT, whiteSpace: 'pre', color: theme => alpha(theme.palette.text.primary, 0.14) }}>
            {body}
            {caret && <Box component="span" sx={{ color: 'primary.main' }}>{GLYPH}</Box>}
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
 * "Generating app… (12s) · title" over the artifact taking shape: an app's code going by, the last few lines with
 * every character a glyph; a map, a muted placeholder of one.
 */
export const ArtifactDraftView: FC<ArtifactDraftViewProps> = ({ tool, title, lines: allLines, lineCount, startedAt }) => {
    const seconds = useElapsedSeconds(startedAt);
    const label = useDraftLabel(tool);
    const lines = allLines.slice(-VISIBLE_LINES);
    const firstLine = lineCount - lines.length;
    return (
        <Box role="status" aria-live="polite" aria-label={title ? `${label}: ${title}` : label}
            sx={{ width: 'min(440px, 80%)', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Typography noWrap sx={{ fontSize: textVar.xs, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                {`${label}… (${seconds}s)${title ? ` · ${title}` : ''}`}
            </Typography>
            {isMapTool(tool)
                ? <Box aria-hidden data-testid="map-draft-placeholder" sx={{
                    height: LINE_HEIGHT * VISIBLE_LINES, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    bgcolor: theme => alpha(theme.palette.text.primary, 0.03), color: theme => alpha(theme.palette.text.primary, 0.14),
                }}>
                    <PublicOutlinedIcon sx={{ fontSize: 56 }} />
                </Box>
                : <Box aria-hidden data-testid="app-draft-lines" sx={{
                    height: LINE_HEIGHT * VISIBLE_LINES, overflow: 'hidden',
                    fontFamily: 'var(--df-font-mono, monospace)', fontSize: 12, lineHeight: `${LINE_HEIGHT}px`,
                }}>
                    {lines.map((line, index) => (
                        <MaskedLine key={firstLine + index} line={line} caret={index === lines.length - 1} />
                    ))}
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
