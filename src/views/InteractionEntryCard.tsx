// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { memo, useState } from 'react';
import { Box, Collapse, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import PersonIcon from '@mui/icons-material/Person';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { InteractionEntry } from '../components/ComponentType';
import { AgentIcon } from '../icons';
import { radius, borderColor } from '../app/tokens';

/** Render text with **field** markers as styled spans with subtle background. */
function renderFieldHighlights(text: string, bgColor: string): React.ReactNode {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
        const match = part.match(/^\*\*(.+)\*\*$/);
        if (match) {
            return (
                <Box key={i} component="span" sx={{
                    backgroundColor: bgColor,
                    borderRadius: '3px',
                    px: '3px',
                    py: '1px',
                }}>
                    {match[1]}
                </Box>
            );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
    });
}

export interface InteractionEntryCardProps {
    entry: InteractionEntry;
    highlighted?: boolean;
    resolved?: boolean;
    onClick?: (entry: InteractionEntry) => void;
}

export const InteractionEntryCard: React.FC<InteractionEntryCardProps> = memo(({ entry, highlighted = false, resolved = false, onClick }) => {
    const theme = useTheme();
    const text = entry.displayContent || entry.content;
    const clickable = !!onClick;
    const clickSx = clickable ? { cursor: 'pointer', '&:hover': { opacity: 0.8 } } : {};

    const handleClick = onClick ? () => onClick(entry) : undefined;

    // User prompts and user instructions — card with custom palette
    if (entry.from === 'user' && (entry.role === 'prompt' || entry.role === 'instruction')) {
        const palette = theme.palette.custom;
        const fieldBg = alpha(palette.main, 0.08);
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
                {renderFieldHighlights(text, fieldBg)}
            </Typography>
        );
    }

    // ── Agent entries (instruction, clarify, summary, error, etc.) ──
    // Unified collapsible rendering: collapsed shows short text, expand shows 💭 thinking + full text
    if (entry.from !== 'user') {
        const fieldBg = alpha(theme.palette.primary.main, 0.08);

        // Role-specific color and collapsed label
        let color: string;
        let collapsedLabel: string | null = null; // if set, show this when collapsed instead of the main text
        switch (entry.role) {
            case 'instruction':
                color = theme.palette.text.secondary;
                break;
            case 'clarify':
                color = resolved ? theme.palette.text.secondary : theme.palette.warning.main;
                if (resolved) collapsedLabel = 'asked for clarification';
                break;
            case 'summary':
                color = theme.palette.success.main;
                break;
            case 'error':
                color = theme.palette.error.main;
                break;
            default:
                color = theme.palette.text.secondary;
        }

        const displayText = entry.role === 'instruction'
            ? (entry.displayContent || entry.content)
            : text;
        const hasPlan = !!entry.plan && entry.plan !== displayText;
        const isCollapsible = hasPlan || !!collapsedLabel;
        const [expanded, setExpanded] = useState(false);

        return (
            <Box
                sx={{
                    cursor: isCollapsible ? 'pointer' : 'default',
                    ...(isCollapsible ? {
                        borderRadius: '4px',
                        px: '2px',
                        mx: '-2px',
                        '&:hover': { backgroundColor: 'rgba(0,0,0,0.04)' },
                    } : {}),
                }}
                onClick={() => isCollapsible && setExpanded(!expanded)}
            >
                <Collapse in={expanded}>
                    {hasPlan && (
                        <Typography component="div" sx={{
                            fontSize: '10px',
                            color: theme.palette.text.disabled,
                            fontStyle: 'italic',
                            py: '2px',
                        }}>
                            💭 {entry.plan}
                        </Typography>
                    )}
                    {hasPlan && <Box sx={{ borderBottom: `1px solid ${borderColor.component}`, my: '2px' }} />}
                    {collapsedLabel && (
                        <Typography component="div" sx={{
                            fontSize: '10px',
                            color,
                            py: '1px',
                        }}>
                            {entry.role === 'instruction'
                                ? renderFieldHighlights(displayText, fieldBg)
                                : displayText}
                        </Typography>
                    )}
                </Collapse>
                {/* Collapsed view or always-visible main text */}
                {collapsedLabel ? (
                    !expanded && (
                        <Typography component="div" sx={{
                            fontSize: '10px',
                            color: theme.palette.text.disabled,
                            fontStyle: 'italic',
                            py: '1px',
                        }}>
                            {collapsedLabel}
                        </Typography>
                    )
                ) : (
                    <Typography component="div" sx={{
                        fontSize: '10px',
                        color,
                        py: '1px',
                    }}>
                        {entry.role === 'instruction'
                            ? renderFieldHighlights(displayText, fieldBg)
                            : displayText}
                    </Typography>
                )}
            </Box>
        );
    }

    // Fallback for any remaining entries
    return (
        <Typography component="div" onClick={handleClick} sx={{
            fontSize: '11px',
            color: theme.palette.text.secondary,
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
