// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import { Box, Collapse, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import PersonIcon from '@mui/icons-material/Person';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import TerminalIcon from '@mui/icons-material/Terminal';
import SearchIcon from '@mui/icons-material/Search';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckIcon from '@mui/icons-material/Check';
import { InteractionEntry } from '../components/ComponentType';
import { AgentIcon, TableIcon } from '../icons';
import { radius, borderColor } from '../app/tokens';

/** Pick the icon component for a step line based on known prefixes. */
export const getStepIconComponent = (line: string) => {
    const stripped = line.startsWith('✓') ? line.slice(2) : line;
    const lbl = stripped.toLowerCase();
    if (lbl.startsWith('running code') || lbl.startsWith('运行')) return TerminalIcon;
    if (lbl.startsWith('inspecting') || lbl.startsWith('检查')) return SearchIcon;
    if (lbl.startsWith('creating chart') || lbl.startsWith('图表')) return AutoGraphIcon;
    return AutoAwesomeIcon;
};

/** A single step line with 2-line clamp + click to expand. */
const PlanStepItem: React.FC<{
    step: string;
    showShimmer: boolean;
}> = ({ step, showShimmer }) => {
    const [expanded, setExpanded] = useState(false);
    const isChecked = step.startsWith('✓');
    const displayLine = isChecked ? step.slice(2) : step;
    const IconComp = getStepIconComponent(step);

    return (
        <Box sx={{
            display: 'flex', alignItems: 'flex-start', gap: '4px',
            position: 'relative', overflow: 'hidden',
            cursor: 'pointer',
            ...(showShimmer ? {
                '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: 0, left: 0, width: '100%', height: '100%',
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.8) 50%, transparent 100%)',
                    animation: 'windowWipe 2s ease-in-out infinite',
                    zIndex: 1, pointerEvents: 'none',
                },
                '@keyframes windowWipe': {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(100%)' },
                },
            } : {}),
        }}
        onClick={() => setExpanded(prev => !prev)}
        >
            <IconComp sx={{ width: 10, height: 10, color: 'text.disabled', flexShrink: 0, mt: '2px' }} />
            <Typography component="span" sx={{
                fontSize: '10px',
                color: showShimmer ? 'text.secondary' : 'text.disabled',
                fontStyle: 'italic',
                lineHeight: 1.4,
                ...(!expanded ? {
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                } : {}),
            }}>
                {displayLine}
            </Typography>
        </Box>
    );
};

/** Shared component to render plan steps as a list with icons.
 *  `activeLastStep` adds a shimmer animation to the last incomplete step (for streaming). 
 *  `filterCreatingChart` hides "creating chart..." lines (already shown as instruction text). */
export const PlanStepsView: React.FC<{
    steps: string[];
    activeLastStep?: boolean;
    filterCreatingChart?: boolean;
}> = ({ steps, activeLastStep = false, filterCreatingChart = false }) => {
    const filtered = filterCreatingChart
        ? steps.filter(l => {
            const stripped = l.startsWith('✓') ? l.slice(2) : l;
            const lbl = stripped.trim().toLowerCase();
            return !(lbl.startsWith('creating chart') || lbl.startsWith('图表'));
        })
        : steps;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {filtered.map((step, idx) => {
                const isLast = idx === filtered.length - 1;
                const isChecked = step.startsWith('✓');
                const showShimmer = activeLastStep && isLast && !isChecked;
                return <PlanStepItem key={idx} step={step} showShimmer={showShimmer} />;
            })}
        </Box>
    );
};

/** Compact Markdown for summary entries — inherits parent font-size (10px). */
const CompactMarkdown: React.FC<{ content: string; color: string }> = ({ content, color }) => (
    <Box sx={{
        wordBreak: 'break-word',
        '& > :first-child': { mt: 0 },
        '& > :last-child': { mb: 0 },
    }}>
        <Markdown
            components={{
                p: ({ children }) => (
                    <Typography component="p" sx={{ fontSize: 'inherit', color, lineHeight: 1.6, my: 0.25 }}>
                        {children}
                    </Typography>
                ),
                strong: ({ children }) => (
                    <Box component="span" sx={{ fontWeight: 600 }}>{children}</Box>
                ),
                em: ({ children }) => (
                    <Box component="span" sx={{ fontStyle: 'italic' }}>{children}</Box>
                ),
                ul: ({ children }) => (
                    <Box component="ul" sx={{ m: 0, my: 0.25, pl: 2 }}>{children}</Box>
                ),
                ol: ({ children }) => (
                    <Box component="ol" sx={{ m: 0, my: 0.25, pl: 2 }}>{children}</Box>
                ),
                li: ({ children }) => (
                    <Typography component="li" sx={{ fontSize: 'inherit', color, lineHeight: 1.6 }}>
                        {children}
                    </Typography>
                ),
                code: ({ children }) => (
                    <Box component="code" sx={{
                        fontSize: 'inherit', fontFamily: 'inherit',
                        bgcolor: 'rgba(0,0,0,0.04)', px: 0.4, py: 0.1, borderRadius: '3px',
                    }}>
                        {children}
                    </Box>
                ),
                pre: ({ children }) => <>{children}</>,
            }}
        >
            {content}
        </Markdown>
    </Box>
);

/** Render text with **field** markers as styled spans with subtle background. */
export function renderFieldHighlights(text: string, bgColor: string): React.ReactNode {
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
    const { t } = useTranslation();
    const text = entry.displayContent || entry.content;
    const clickable = !!onClick;
    const clickSx = clickable ? { cursor: 'pointer', '&:hover': { opacity: 0.8 } } : {};

    const handleClick = onClick ? () => onClick(entry) : undefined;

    // User prompts and user instructions — card with custom palette
    if (entry.from === 'user' && (entry.role === 'prompt' || entry.role === 'instruction')) {
        const palette = theme.palette.custom;
        const fieldBg = alpha(palette.main, 0.08);
        const userInputTablesSuffix = entry.inputTableNames && entry.inputTableNames.length > 0 ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px', mt: '2px' }}>
                {entry.inputTableNames.map((name, idx) => (
                    <React.Fragment key={name}>
                        {idx > 0 && <Typography component="span" sx={{ fontSize: 9, color: theme.palette.text.disabled }}>,</Typography>}
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                            <TableIcon sx={{ fontSize: 10, color: theme.palette.text.disabled }} />
                            <Typography component="span" sx={{ fontSize: 9, color: theme.palette.text.disabled }}>
                                {name}
                            </Typography>
                        </Box>
                    </React.Fragment>
                ))}
            </Box>
        ) : null;
        return (
            <Box onClick={handleClick} sx={{
                fontSize: '11px',
                color: theme.palette.text.primary,
                py: 0.5, px: 1,
                borderRadius: radius.sm,
                backgroundColor: palette.bgcolor,
                border: `1px solid ${borderColor.component}`,
                ...(highlighted ? { borderLeft: `2px solid ${palette.main}` } : {}),
                ...clickSx,
            }}>
                <Typography component="div" sx={{ fontSize: 'inherit', color: 'inherit' }}>
                    {renderFieldHighlights(text, fieldBg)}
                </Typography>
                {userInputTablesSuffix}
            </Box>
        );
    }

    // ── Agent entries (instruction, clarify, summary, error, etc.) ──
    // Unified collapsible rendering: collapsed shows short text, expand shows 💭 thinking + full text
    if (entry.from !== 'user') {
        const fieldBg = alpha(theme.palette.primary.main, 0.08);

        // Role-specific color: secondary for content, semantic colors for status
        let color: string;
        let collapsedLabel: string | null = null;
        switch (entry.role) {
            case 'instruction':
                color = theme.palette.text.secondary;
                break;
            case 'clarify':
                color = resolved ? theme.palette.text.secondary : theme.palette.warning.main;
                if (resolved) collapsedLabel = t('interaction.askedForClarification');
                break;
            case 'summary':
                color = theme.palette.text.secondary;
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

        // Render input table names suffix if available
        const inputTablesSuffix = entry.inputTableNames && entry.inputTableNames.length > 0 ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px', mt: '2px' }}>
                {entry.inputTableNames.map((name, idx) => (
                    <React.Fragment key={name}>
                        {idx > 0 && <Typography component="span" sx={{ fontSize: 9, color: theme.palette.text.disabled }}>,</Typography>}
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                            <TableIcon sx={{ fontSize: 10, color: theme.palette.text.disabled }} />
                            <Typography component="span" sx={{ fontSize: 9, color: theme.palette.text.disabled }}>
                                {name}
                            </Typography>
                        </Box>
                    </React.Fragment>
                ))}
            </Box>
        ) : null;

        return (
            <Box
                sx={{
                    cursor: isCollapsible ? 'pointer' : 'default',
                    ...(isCollapsible ? {
                        borderRadius: '4px',
                        px: '2px',
                        mx: '-2px',
                        '&:hover': { backgroundColor: 'rgba(0,0,0,0.03)' },
                    } : {}),
                }}
                onClick={() => isCollapsible && setExpanded(!expanded)}
            >
                <Collapse in={expanded}>
                    {hasPlan && (() => {
                        const planLines = entry.plan!.split('\n').filter(l => l.trim());
                        return (
                            <Box sx={{ py: '2px' }}>
                                <PlanStepsView steps={planLines} filterCreatingChart />
                            </Box>
                        );
                    })()}
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
                ) : entry.role === 'summary' ? (
                    <Box sx={{ fontSize: '10px', py: '1px' }}>
                        <CompactMarkdown content={displayText} color={color} />
                    </Box>
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
                {inputTablesSuffix}
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
