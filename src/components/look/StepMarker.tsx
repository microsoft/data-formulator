// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import { useTheme } from '@mui/material/styles';

import { lookOf } from '../../app/look';
import { iconTone } from '../../app/tokens';
import { SharpGlyph, type GlyphKind } from './SharpGlyphs';

/** A kind's colour on the focused chain, as its cards are drawn: the user's in the user colour, what the agent authors
 *  (reports, apps, maps) in secondary, the rest (agent messages, tables, charts, files) in primary. */
const kindColor = (palette: any, kind: GlyphKind): string =>
    kind === 'user' ? palette.custom?.main ?? palette.primary.main
        : kind === 'report' || kind === 'app' || kind === 'map' ? palette.secondary.main
        : palette.primary.main;

/**
 * The mark of a step on the thread's rail: `icon` (its kind's icon, or a dot) where the look draws icons; where it
 * draws sharp glyphs, the glyph for the step's `kind` (a user or agent message, a table, a chart of `chartType`, a
 * report, app, map or file), in its kind's colour when `on` the focused chain and muted off it. A step of no known kind
 * keeps its icon, and a `live` step (running, waiting on the user, streaming) always does, since the icon carries that
 * state.
 */
export const StepMarker: React.FC<{ icon: React.ReactNode; on: boolean; kind?: GlyphKind; chartType?: string; live?: boolean }> =
    ({ icon, on, kind, chartType, live = false }) => {
        const theme = useTheme();
        if (live || !kind || lookOf(theme).thread.stepMarker !== 'glyph') return <>{icon}</>;
        return <SharpGlyph kind={kind} chartType={chartType} sx={{
            color: on ? kindColor(theme.palette, kind) : iconTone.muted, bgcolor: 'background.paper',
            // A margin of paper breaks the rail around the mark.
            boxShadow: `0 0 0 2px ${theme.palette.background.paper}`,
        }} />;
    };
