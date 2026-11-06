// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// A mock of the hint shown above the chat when an example session or demo dataset opens, styled as in
// SimpleChartRecBox (design-docs/69); /dev only.

import React from 'react';
import { Box, ButtonBase, IconButton, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
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

const MockInput: React.FC = () =>
    <Box sx={{ px: 1.5, pt: 1.25, pb: 1, minHeight: 64, border: 1, borderColor: 'divider', bgcolor: 'background.paper',
        borderRadius: '10px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)', fontSize: 13, color: 'text.disabled' }}>
        Ask questions or describe what to explore (add context with @)
    </Box>;

const Close: React.FC = () =>
    <IconButton size="small" sx={{ p: 0.25, mt: '-2px', color: 'text.disabled', flexShrink: 0 }}>
        <CloseIcon sx={{ fontSize: 14 }} />
    </IconButton>;

const QuestionLink: React.FC<{ q: string; color: string }> = ({ q, color }) =>
    <ButtonBase sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.5, py: 0.25, textAlign: 'left',
        fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.45, fontWeight: 500, color,
        '&:hover': { textDecoration: 'underline', textUnderlineOffset: '2px' } }}>
        <ArrowForwardRoundedIcon sx={{ fontSize: 12, alignSelf: 'center', flexShrink: 0, opacity: 0.8 }} />{q}
    </ButtonBase>;

const Pointer: React.FC<{ fill: string }> = ({ fill }) =>
    <Box sx={{ position: 'absolute', left: 24, bottom: -5, width: 8, height: 8, transform: 'rotate(45deg)', bgcolor: fill }} />;

/** A faint tint of the primary colour, no shadow or border. */
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

export const STARTER_HINTS: [string, React.FC][] = [
    ['faint primary tint', Tint],
];

export const StarterHintMock: React.FC<{ Hint: React.FC }> = ({ Hint }) =>
    <Box sx={{ width: 620, pt: 2, px: 2, pb: 2, bgcolor: 'background.default' }}>
        <Hint /><MockInput />
    </Box>;
