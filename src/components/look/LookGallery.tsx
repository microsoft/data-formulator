// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * /dev/look: every look role and a few real components, drawn in the soft and sharp looks side by side, so a change
 * to a look (looks.ts) or a role (roles.ts, tokens.ts) can be reviewed in one place. Each half carries its own MUI
 * theme and sets its look's CSS variables on its wrapper (`initial` for those the look leaves to call sites, so the
 * page root's look does not leak in).
 */

import React from 'react';
import { useSelector } from 'react-redux';
import { Box, Button, Chip, MenuItem, MenuList, Paper, TextField, Tooltip, Typography } from '@mui/material';
import { ThemeProvider, useTheme } from '@mui/material/styles';
import AppsOutlinedIcon from '@mui/icons-material/AppsOutlined';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import BarChartIcon from '@mui/icons-material/BarChart';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';

import type { DataFormulatorState } from '../../app/dfSlice';
import { textVar } from '../../app/layout';
import { LOOKS, focusColor, frameColor, inkColor, lineColor, tableHeaderSurface, type Look } from '../../app/look';
import { createDfTheme } from '../../app/theme';
import {
    ambientShadow, borderColor, canvasPattern, cardRadius, identText, metaText, quietText, selectionMark,
} from '../../app/tokens';
import { ToolsChipFace } from '../ToolsAccess';
import type { InteractionEntry } from '../ComponentType';
import { InteractionEntryCard } from '../../views/InteractionEntryCard';
import { ThreadArtifactCard } from '../../views/DataThreadCards';
import { StepMarker } from './StepMarker';
import type { GlyphKind } from './SharpGlyphs';

const scopedVariables = (look: Look): React.CSSProperties =>
    Object.fromEntries(Object.entries(LOOKS[look].vars).map(([name, value]) => [name, value ?? 'initial'])) as React.CSSProperties;

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) =>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: 2, borderTop: `1px solid ${borderColor.divider}` }}>
        <Typography sx={{ ...metaText({ fontSize: textVar.xs, textTransform: 'uppercase', letterSpacing: '0.04em' }),
            fontWeight: 600, color: 'text.secondary' }}>{title}</Typography>
        {children}
    </Box>;

const MARKERS: [GlyphKind, React.ReactNode][] = [
    ['user', <PersonOutlineIcon key="user" />], ['agent', <ChatBubbleOutlineIcon key="agent" />],
    ['table', <TableChartOutlinedIcon key="table" />], ['chart', <BarChartIcon key="chart" />],
    ['report', <ArticleOutlinedIcon key="report" />], ['app', <AppsOutlinedIcon key="app" />],
    ['map', <MapOutlinedIcon key="map" />], ['file', <InsertDriveFileOutlinedIcon key="file" />],
];

const prompt = (content: string): InteractionEntry => ({ from: 'user', to: 'data-agent', role: 'prompt', content } as InteractionEntry);

const LookColumn: React.FC = () => {
    const theme = useTheme();
    return <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <Section title="Lines: anchor · frame · inner">
            <Box sx={{ display: 'flex', gap: 1.5 }}>
                {[['anchor', lineColor(theme, 0.2)], ['frame', borderColor.view], ['inner', borderColor.component]].map(([name, color]) =>
                    <Box key={name} sx={{ flex: 1, height: 44, border: `1px solid ${color}`, borderRadius: cardRadius('6px'),
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: textVar.xs }}>{name}</Box>)}
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5, fontSize: textVar.sm }}>
                <span style={{ color: inkColor(theme, 0.55) }}>quiet ink 0.55</span>
                <span style={{ color: 'var(--df-icon-muted, rgba(0,0,0,0.15))' }}>muted icon</span>
            </Box>
        </Section>
        <Section title="Thread">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 260 }}>
                <InteractionEntryCard entry={prompt('How have these stocks performed?')} />
                <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>Which stocks gained or lost most from the shared start?</Typography>
                <ThreadArtifactCard artifactType="table" title="Indexed Stock Performance" selected={false} onClick={() => {}} />
                <ThreadArtifactCard artifactType="report" title="Equity performance review" notes="Report" selected={false} onClick={() => {}} />
                <Box sx={{ '& .selected-artifact-card': { ...selectionMark('var(--artifact-selection-color)', 1), borderColor: 'transparent' } }}>
                    <ThreadArtifactCard artifactType="table" title="Selected artifact" selected onClick={() => {}} />
                </Box>
                <Box sx={{ position: 'relative', height: 40, border: `1px solid ${borderColor.component}`, borderRadius: cardRadius('6px'),
                    ...selectionMark(focusColor(theme, theme.palette.primary), 1), display: 'flex', alignItems: 'center', px: 1, fontSize: textVar.xs }}>
                    selected chart card
                </Box>
            </Box>
        </Section>
        <Section title="Step markers: on chain · off chain">
            {[true, false].map(on =>
                <Box key={String(on)} sx={{ display: 'flex', gap: 1.5, alignItems: 'center', color: 'text.secondary', '& svg': { fontSize: 16 } }}>
                    {MARKERS.map(([kind, icon]) => <StepMarker key={kind} kind={kind} icon={icon} on={on} chartType="bar" />)}
                </Box>)}
        </Section>
        <Section title="Section frame · corners in theme units (1 · 1.5 · 2 · 3)">
            <Box sx={{ px: 1, py: 0.75, border: `1px solid ${frameColor(theme, 0.1)}`, borderRadius: cardRadius('8px'), fontSize: textVar.xs }}>
                workspace summary
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5 }}>
                {[1, 1.5, 2, 3].map(units => <Box key={units} sx={{ flex: 1, height: 28, border: `1px solid ${borderColor.component}`,
                    borderRadius: units, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: textVar.xxs }}>{units}</Box>)}
            </Box>
        </Section>
        <Section title="Type voices">
            <Typography sx={{ fontSize: textVar.sm }}>Content: How did META&apos;s largest drawdown unfold?</Typography>
            <Typography sx={{ ...metaText({ fontSize: textVar.xs }), color: 'text.secondary' }}>Meta: Line · 1,247 rows · 6 series</Typography>
            <Typography sx={{ fontSize: textVar.sm, ...identText }}>Ident: indexed_value · gpt-6.1-sol</Typography>
            <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary', ...quietText }}>Quiet: Replaced the earlier version</Typography>
            <ToolsChipFace count={2} mode="auto" />
        </Section>
        <Section title="Table header">
            <Box sx={{ display: 'flex' }}>
                {([['date', theme.palette.primary], ['indexed_value', theme.palette.custom]] as const).map(([name, color]) =>
                    <Box key={name} sx={{ flex: 1, px: 1, py: 0.5, borderBottomStyle: 'solid', ...tableHeaderSurface(theme, color) }}>
                        <Typography sx={{ fontSize: textVar.sm, ...identText }}>{name}</Typography>
                    </Box>)}
            </Box>
        </Section>
        <Section title="Canvas">
            <Box sx={{ height: 80, border: `1px solid ${borderColor.view}`, borderRadius: cardRadius('8px'),
                ...canvasPattern('linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px), linear-gradient(0deg, rgba(0,0,0,0.02) 1px, transparent 1px)', '24px 24px'),
                boxShadow: ambientShadow('0 2px 8px rgba(0,0,0,0.12)') }} />
        </Section>
        <Section title="Controls (MUI)">
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button variant="contained" size="small">Contained</Button>
                <Button variant="outlined" size="small">Outlined</Button>
                <Chip size="small" label="Chip" />
                <Chip size="small" variant="outlined" label="Outlined chip" />
                <Tooltip title="Tooltip" open placement="right"><Box component="span" sx={{ fontSize: textVar.xs }}>tooltip →</Box></Tooltip>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mt: 4 }}>
                <TextField size="small" label="Text field" defaultValue="value" />
                <Paper elevation={4}><MenuList dense><MenuItem>Menu item</MenuItem><MenuItem>Another</MenuItem></MenuList></Paper>
            </Box>
        </Section>
    </Box>;
};

const LookGallery: React.FC = () => {
    const paletteKey = useSelector((state: DataFormulatorState) => state.config.paletteKey) ?? '';
    return <Box sx={{ height: '100vh', overflowY: 'auto', boxSizing: 'border-box', p: 3, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, alignItems: 'start' }}>
        {(['soft', 'sharp'] as Look[]).map(look =>
            <ThemeProvider key={look} theme={createDfTheme(paletteKey, look)}>
                <Box style={scopedVariables(look)} sx={{ p: 2, bgcolor: 'background.paper', color: 'text.primary',
                    border: '1px solid rgba(0,0,0,0.12)' }}>
                    <Typography sx={{ fontSize: textVar.xl, fontWeight: 600, mb: 1 }}>{look}</Typography>
                    <LookColumn />
                </Box>
            </ThemeProvider>)}
    </Box>;
};

export default LookGallery;
