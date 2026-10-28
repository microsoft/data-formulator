// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Prototypes for the hint shown above the chat after a demo dataset loads (design-docs/69); /dev only.

import React from 'react';
import { Box, ButtonBase, IconButton, Typography, useTheme } from '@mui/material';
import { alpha, Theme } from '@mui/material/styles';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import TipsAndUpdatesOutlinedIcon from '@mui/icons-material/TipsAndUpdatesOutlined';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CloseIcon from '@mui/icons-material/Close';

const NAME = 'Education: SDG 4';
const QUESTIONS = [
    'Where do young people finish high school least often?',
    'Where is the gap between rich and poor children in finishing school biggest?',
    'Where do most children reach a minimum reading level by the end of primary school?',
];
const INTRO = `${NAME} is loaded. Ask the analyst anything about it in the chat, or start with one of these:`;

const MockInput: React.FC<{ attached?: boolean }> = ({ attached }) =>
    <Box sx={{ px: 1.5, pt: 1.25, pb: 1, minHeight: 64, border: 1, borderColor: 'divider', bgcolor: 'background.paper',
        borderRadius: attached ? '0 0 10px 10px' : '10px', borderTop: attached ? 0 : undefined,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)', fontSize: 13, color: 'text.disabled' }}>
        Ask questions or describe what to explore (add context with @)
    </Box>;

const Close: React.FC<{ color?: string }> = ({ color }) =>
    <IconButton size="small" sx={{ p: 0.25, mt: '-2px', color: color || 'text.disabled', flexShrink: 0 }}>
        <CloseIcon sx={{ fontSize: 14 }} />
    </IconButton>;

const QuestionLink: React.FC<{ q: string; color: string; weight?: number }> = ({ q, color, weight = 500 }) =>
    <ButtonBase sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.5, py: 0.25, textAlign: 'left',
        fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.45, fontWeight: weight, color,
        '&:hover': { textDecoration: 'underline', textUnderlineOffset: '2px' } }}>
        <ArrowForwardRoundedIcon sx={{ fontSize: 12, alignSelf: 'center', flexShrink: 0, opacity: 0.8 }} />{q}
    </ButtonBase>;

const Pill: React.FC<{ q: string; sx?: object }> = ({ q, sx }) =>
    <ButtonBase sx={{ px: 1.25, py: 0.625, borderRadius: '16px', textAlign: 'left', fontFamily: 'inherit',
        fontSize: 12.5, lineHeight: 1.4, color: 'text.primary', bgcolor: (t: Theme) => alpha(t.palette.text.primary, 0.05),
        '&:hover': { bgcolor: (t: Theme) => alpha(t.palette.primary.main, 0.1), color: 'primary.main' }, ...sx }}>
        {q}
    </ButtonBase>;

const Pointer: React.FC<{ fill: string; border?: string }> = ({ fill, border }) =>
    <Box sx={{ position: 'absolute', left: 24, bottom: -5, width: 8, height: 8, transform: 'rotate(45deg)', bgcolor: fill,
        ...(border ? { borderRight: `1px solid ${border}`, borderBottom: `1px solid ${border}` } : {}) }} />;

/** A: today's dark tooltip, for reference. */
const Dark = () => {
    const theme = useTheme(); const fill = alpha(theme.palette.grey[700], 0.92);
    return <Box sx={{ position: 'relative', width: 440, px: 1.25, pt: 0.875, pb: 1, borderRadius: '4px', bgcolor: fill, color: 'common.white', mb: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
            <TipsAndUpdatesIcon sx={{ fontSize: 14, mt: '2px' }} />
            <Typography sx={{ flex: 1, fontSize: 12, lineHeight: 1.5 }}>{INTRO}</Typography><Close color="inherit" />
        </Box>
        <Box sx={{ mt: 0.5, pl: 2.5, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            {QUESTIONS.map(q => <QuestionLink key={q} q={q} color="inherit" weight={600} />)}
        </Box>
        <Pointer fill={fill} />
    </Box>;
};

/** B: a white floating sheet with a soft shadow, questions in the link colour. */
const Sheet = () => {
    const theme = useTheme();
    return <Box sx={{ position: 'relative', width: 440, px: 1.5, pt: 1.125, pb: 1.25, borderRadius: '8px', bgcolor: 'background.paper', mb: 1.5,
        boxShadow: '0 4px 16px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06)' }}>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
            <TipsAndUpdatesOutlinedIcon sx={{ fontSize: 15, mt: '2px', color: 'primary.main' }} />
            <Typography sx={{ flex: 1, fontSize: 12.5, lineHeight: 1.5, color: 'text.secondary' }}>{INTRO}</Typography><Close />
        </Box>
        <Box sx={{ mt: 0.5, pl: 2.75, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            {QUESTIONS.map(q => <QuestionLink key={q} q={q} color={theme.palette.primary.main} />)}
        </Box>
        <Pointer fill={theme.palette.background.paper} />
    </Box>;
};

/** C: a faint blue tint, no shadow or border. */
const Tint = () => {
    const theme = useTheme(); const fill = alpha(theme.palette.primary.main, 0.06);
    return <Box sx={{ position: 'relative', width: 440, px: 1.5, pt: 1, pb: 1.125, borderRadius: '8px', bgcolor: fill, mb: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
            <TipsAndUpdatesOutlinedIcon sx={{ fontSize: 15, mt: '2px', color: 'primary.main' }} />
            <Typography sx={{ flex: 1, fontSize: 12.5, lineHeight: 1.5, color: 'text.primary' }}>{INTRO}</Typography><Close />
        </Box>
        <Box sx={{ mt: 0.5, pl: 2.75, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            {QUESTIONS.map(q => <QuestionLink key={q} q={q} color={theme.palette.primary.dark} />)}
        </Box>
        <Pointer fill={fill} />
    </Box>;
};

/** D: no container; a quiet lead-in and soft pills that sit on the page, left-aligned with the input. */
const Pills = () =>
    <Box sx={{ mb: 1.25, px: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.875 }}>
            <Typography sx={{ flex: 1, fontSize: 12.5, color: 'text.secondary' }}>
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{NAME}</Box> is loaded. Ask anything, or try:
            </Typography><Close />
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>{QUESTIONS.map(q => <Pill key={q} q={q} />)}</Box>
    </Box>;

/** E: plain text list, no container; reads like a message from the page. */
const Plain = () => {
    const theme = useTheme();
    return <Box sx={{ mb: 1.25, px: 0.5 }}>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
            <Typography sx={{ flex: 1, fontSize: 12.5, lineHeight: 1.5, color: 'text.secondary' }}>{INTRO}</Typography><Close />
        </Box>
        <Box sx={{ mt: 0.375, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            {QUESTIONS.map(q => <QuestionLink key={q} q={q} color={theme.palette.text.primary} />)}
        </Box>
    </Box>;
};

/** F: a tray joined to the top of the input, so the hint and the chat read as one object. */
const Tray = () => {
    const theme = useTheme();
    return <Box sx={{ px: 1.5, pt: 1, pb: 0.875, border: 1, borderColor: 'divider', borderBottom: 0, borderRadius: '10px 10px 0 0',
        bgcolor: alpha(theme.palette.text.primary, 0.025) }}>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
            <Typography sx={{ flex: 1, fontSize: 12, lineHeight: 1.5, color: 'text.secondary' }}>
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{NAME}</Box> is loaded. Ask anything, or start with:
            </Typography><Close />
        </Box>
        <Box sx={{ mt: 0.25, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            {QUESTIONS.map(q => <QuestionLink key={q} q={q} color={theme.palette.primary.main} />)}
        </Box>
    </Box>;
};

export const STARTER_HINTS: [string, React.FC, boolean?][] = [
    ['A · current (dark tooltip)', Dark],
    ['B · white sheet, soft shadow', Sheet],
    ['C · faint blue tint (chosen for the demo)', Tint],
    ['D · lead-in + soft pills, no box', Pills],
    ['E · plain text, no box', Plain],
    ['F · tray joined to the input', Tray, true],
];

export const StarterHintMock: React.FC<{ Hint: React.FC; attached?: boolean }> = ({ Hint, attached }) =>
    <Box sx={{ width: 620, pt: 2, px: 2, pb: 2, bgcolor: 'background.default' }}>
        <Hint /><MockInput attached={attached} />
    </Box>;
