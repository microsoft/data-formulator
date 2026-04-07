// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { memo } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { InteractionEntry } from '../components/ComponentType';
import { AgentIcon } from '../icons';
import { radius, borderColor } from '../app/tokens';

export interface InteractionEntryCardProps {
    entry: InteractionEntry;
    highlighted?: boolean;
    onClick?: (entry: InteractionEntry) => void;
}

export const InteractionEntryCard: React.FC<InteractionEntryCardProps> = memo(({ entry, highlighted = false, onClick }) => {
    const theme = useTheme();
    const text = entry.displayContent || entry.content;
    const clickable = !!onClick;
    const clickSx = clickable ? { cursor: 'pointer', '&:hover': { opacity: 0.8 } } : {};

    const handleClick = onClick ? () => onClick(entry) : undefined;

    // User prompts and user instructions — card with custom palette
    if (entry.from === 'user' && (entry.role === 'prompt' || entry.role === 'instruction')) {
        const palette = theme.palette.custom;
        return (
            <Typography component="div" onClick={handleClick} sx={{
                fontSize: '11px',
                color: 'rgba(0,0,0,0.75)',
                py: 0.5, px: 1,
                borderRadius: radius.sm,
                backgroundColor: palette.bgcolor,
                border: `1px solid ${borderColor.component}`,
                ...(highlighted ? { borderLeft: `2px solid ${palette.main}` } : {}),
                ...clickSx,
            }}>
                {text}
            </Typography>
        );
    }

    // Agent instructions — show the plan (user-friendly reasoning) instead of the raw instruction
    if (entry.from !== 'user' && entry.role === 'instruction') {
        const planText = entry.plan || text;
        return (
            <Typography component="div" onClick={handleClick} sx={{
                fontSize: '11px',
                color: theme.palette.text.secondary,
                py: '1px',
                ...clickSx,
            }}>
                {planText}
            </Typography>
        );
    }

    // Role-based text styling
    let color: string;
    switch (entry.role) {
        case 'summary':
            color = theme.palette.success.main;
            break;
        case 'error':
            color = theme.palette.error.main;
            break;
        case 'clarify':
            color = theme.palette.warning.main;
            break;
        default:
            color = theme.palette.text.secondary;
    }

    return (
        <Typography component="div" onClick={handleClick} sx={{
            fontSize: '11px',
            color,
            py: '1px',
            ...clickSx,
        }}>
            {text}
        </Typography>
    );
});

/** Returns the appropriate gutter icon for an InteractionEntry. */
export function getEntryGutterIcon(entry: InteractionEntry, color: string): React.ReactNode {
    const iconSx = { width: 14, height: 14, color };
    if (entry.from === 'user') {
        return <PersonIcon sx={iconSx} />;
    }
    return <SmartToyOutlinedIcon sx={iconSx} />;
}

/** Returns the appropriate gutter icon when no entry is available (fallback). */
export function getDefaultGutterIcon(color: string): React.ReactNode {
    return <AgentIcon sx={{ width: 14, height: 14, color }} />;
}
