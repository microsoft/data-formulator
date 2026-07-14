// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import { Box, Collapse, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import PersonIcon from '@mui/icons-material/Person';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { AgentToyIcon, AgentToyVariant } from './AgentToyIcon';
import TerminalIcon from '@mui/icons-material/Terminal';
import SearchIcon from '@mui/icons-material/Search';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckIcon from '@mui/icons-material/Check';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { InteractionEntry } from '../components/ComponentType';
import { AgentIcon } from '../icons';
import { radius, borderColor } from '../app/tokens';

/** Pick the icon component for a step line based on known prefixes. */
export const getStepIconComponent = (line: string) => {
    if (line.startsWith('✗')) return ErrorOutlineIcon;
    if (line.startsWith('⚠')) return WarningAmberIcon;
    if (line.startsWith('📋')) return InfoOutlinedIcon;
    const stripped = line.startsWith('✓') ? line.slice(2) : line;
    const lbl = stripped.toLowerCase();
    if (lbl.startsWith('running code') || lbl.startsWith('运行')) return TerminalIcon;
    if (lbl.startsWith('inspecting') || lbl.startsWith('检查')) return SearchIcon;
    if (lbl.startsWith('searching') || lbl.startsWith('搜索')) return SearchIcon;
    if (lbl.startsWith('creating chart') || lbl.startsWith('图表') || lbl.startsWith('生成图表')) return AutoGraphIcon;
    return AutoAwesomeIcon;
};

/** A single step line with 2-line clamp + click to expand. */
const PlanStepItem: React.FC<{
    step: string;
    showShimmer: boolean;
    trailing?: React.ReactNode;
}> = ({ step, showShimmer, trailing }) => {
    const theme = useTheme();
    const [expanded, setExpanded] = useState(false);
    const isChecked = step.startsWith('✓');
    const isFailed = step.startsWith('✗');
    const isWarning = step.startsWith('⚠');
    const isInfo = step.startsWith('📋');
    const displayLine = (isChecked || isFailed) ? step.slice(2) : (isWarning || isInfo) ? step.slice(2).trimStart() : step;
    const IconComp = getStepIconComponent(step);

    // Text stays in the normal muted color even for failed/warning steps — the
    // icon already signals the state, so loud red/orange body text is overkill.
    const textColor = showShimmer ? 'text.secondary' : 'text.disabled';
    // The icon carries the state hint, lightly tinted (not full-strength).
    const iconColor = isFailed ? alpha(theme.palette.error.main, 0.7)
        : isWarning ? alpha(theme.palette.warning.main, 0.7)
        : isInfo ? alpha(theme.palette.info.main, 0.7)
        : textColor;

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
            <IconComp sx={{ width: 10, height: 10, color: iconColor, flexShrink: 0, mt: '2px' }} />
            <Typography component="span" sx={{
                fontSize: '10px',
                color: textColor,
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
            {trailing}
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
    /** Inline node appended after the text of the last (active) step — used for live timers. */
    trailing?: React.ReactNode;
}> = ({ steps, activeLastStep = false, filterCreatingChart = false, trailing }) => {
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
                return <PlanStepItem key={idx} step={step} showShimmer={showShimmer} trailing={isLast ? trailing : undefined} />;
            })}
        </Box>
    );
};

/** Compact Markdown for summary entries — inherits parent font-size (10px). */
export const CompactMarkdown: React.FC<{ content: string; color: string }> = ({ content, color }) => (
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
                        fontSize: '0.9em',
                        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
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

/** Render text with `**field**` markers as styled spans. The marker is
 *  rendered as a flat "highlighter underline" — a thin colored bar sitting
 *  just below the text baseline. Text weight, size, and color stay
 *  unchanged so the cue scales gracefully with marker density (one or many)
 *  without dominating the prose.
 *
 *  `accentColor` is the solid base color; alpha is applied internally. */
export function renderFieldHighlights(text: string, accentColor: string): React.ReactNode {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
        const match = part.match(/^\*\*(.+)\*\*$/);
        if (match) {
            return (
                <Box key={i} component="span" sx={{
                    // Flat highlighter bar beneath the text. `text-underline-*`
                    // tokens are used (rather than border-bottom) so the bar
                    // wraps with the text and doesn't push line-height.
                    textDecorationLine: 'underline',
                    textDecorationColor: alpha(accentColor, 0.22),
                    textDecorationThickness: '2px',
                    textUnderlineOffset: '3px',
                    textDecorationSkipInk: 'none',
                }}>
                    {match[1]}
                </Box>
            );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
    });
}

/** Strip `**field**` markers from text, leaving plain inline text. Used in
 *  agent prose where the field-highlight chip is suppressed but the raw
 *  markers should not leak through. */
export function stripFieldMarkers(text: string): string {
    return text.replace(/\*\*([^*]+)\*\*/g, '$1');
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
        // Provenance for multi-input derivations is rendered as a structural
        // "merge node" in the timeline gutter (see DataThread), so the
        // instruction card itself stays free of chip-strip chrome.
        return (
            <Box onClick={handleClick} sx={{
                fontSize: '11px',
                color: theme.palette.text.primary,
                py: 0.5, px: 1,
                borderRadius: radius.sm,
                // Keep the user card visually weighted (full bgcolor tint) —
                // user prompts/instructions are the anchors of the thread,
                // so they should read stronger than the agent's bubbles.
                backgroundColor: palette.bgcolor,
                border: `1px solid ${borderColor.component}`,
                // Cap very long instructions (e.g. a replayed workflow) so the
                // card stays compact; the full text scrolls within the cap.
                maxHeight: 160,
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                ...(highlighted ? { borderLeft: `2px solid ${palette.main}` } : {}),
                ...clickSx,
            }}>
                <Typography component="div" sx={{ fontSize: 'inherit', color: 'inherit', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                    {renderFieldHighlights(text, palette.main)}
                </Typography>
                {entry.attachments && entry.attachments.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px', mt: 0.5 }}>
                        {entry.attachments.map((name, i) => (
                            <Box key={i} sx={{
                                display: 'inline-flex', alignItems: 'center', gap: '2px',
                                maxWidth: '100%', fontSize: 10, fontFamily: theme.typography.fontFamily,
                                color: theme.palette.text.secondary,
                                backgroundColor: alpha(theme.palette.text.primary, 0.05),
                                border: `1px solid ${borderColor.divider}`,
                                borderRadius: '4px', px: '5px', py: '1px',
                            }}>
                                <AttachFileIcon sx={{ fontSize: 11, transform: 'rotate(45deg)' }} />
                                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Box>
                            </Box>
                        ))}
                    </Box>
                )}
            </Box>
        );
    }

    // ── Agent entries (instruction, clarify, summary, error, etc.) ──
    // Unified collapsible rendering: collapsed shows short text, expand shows 💭 thinking + full text
    if (entry.from !== 'user') {
        const fieldBg = alpha(theme.palette.primary.main, 0.05);

        const displayText = stripFieldMarkers(entry.role === 'instruction'
            ? (entry.displayContent || entry.content)
            : text);

        // Role-specific color: secondary for content, semantic colors for status
        let color: string;
        let collapsedLabel: string | null = null;
        switch (entry.role) {
            case 'instruction':
                color = theme.palette.text.secondary;
                break;
            case 'clarify':
                // Active conversational entries (clarify / explain /
                // suggest_data_search) use neutral text — the semantic cue
                // is carried by the icon, not by recoloring whole paragraphs.
                color = resolved ? theme.palette.text.secondary : theme.palette.text.primary;
                if (resolved) collapsedLabel = (displayText || t('interaction.askedForClarification')).replace(/\s+/g, ' ').trim();
                break;
            case 'explain': {
                color = resolved ? theme.palette.text.secondary : theme.palette.text.primary;
                if (resolved) {
                    collapsedLabel = (displayText || t('interaction.gaveExplanation')).replace(/\s+/g, ' ').trim();
                }
                break;
            }
            case 'delegate': {
                color = resolved ? theme.palette.text.secondary : theme.palette.text.primary;
                if (resolved) {
                    const target = entry.delegateTarget || 'data_loading';
                    const defaultLabel = target === 'report_gen'
                        ? t('interaction.delegatedToReportGen')
                        : t('interaction.delegatedToDataLoading');
                    collapsedLabel = (displayText || defaultLabel).replace(/\s+/g, ' ').trim();
                }
                break;
            }
            case 'summary':
                // Chrome-less prose trailing the turn — recede into ambient
                // text (matching `instruction`); the gutter icon carries the
                // "finding" cue, not a heavier text color.
                color = theme.palette.text.secondary;
                break;
            case 'error':
                color = theme.palette.error.main;
                break;
            default:
                color = theme.palette.text.secondary;
        }

        const hasPlan = !!entry.plan && entry.plan !== displayText;

        // Active clarify/explain entries are read in the ClarificationPanel
        // at the bottom (the outer timeline row already refocuses there on
        // click). Their truncated preview here should always stay clamped —
        // no in-place expand, to avoid duplicating the panel content.
        const isActiveAgentPause = !resolved
            && (entry.role === 'clarify' || entry.role === 'explain' || entry.role === 'delegate');

        // Auto-clamp very long agent text bubbles. Tied to the same
        // `expanded` state as thinking — one parent click reveals both —
        // except for active clarify/explain, which clamp permanently.
        const TEXT_CLAMP_LINES = 8;
        const TEXT_CLAMP_CHAR_THRESHOLD = 600;
        const canClampText = !collapsedLabel
            && !isActiveAgentPause
            && (displayText?.length ?? 0) > TEXT_CLAMP_CHAR_THRESHOLD;
        const forceClampText = isActiveAgentPause
            && (displayText?.length ?? 0) > TEXT_CLAMP_CHAR_THRESHOLD;

        const isCollapsible = hasPlan || !!collapsedLabel || canClampText;
        const [expanded, setExpanded] = useState(false);

        // Provenance for multi-input derivations is rendered as a structural
        // "merge node" in the timeline gutter (see DataThread), so the
        // instruction card itself stays free of chip-strip chrome.

        // Conversational agent entries (instruction / clarify / explain /
        // summary) all read as "the agent talking" — wrap them in a bordered
        // bubble matching the user's instruction card so the timeline reads
        // as a sibling pair of cards. Active clarify/explain and error keep
        // their semantic color via a left-border accent rather than a
        // tinted fill. `summary` entries are the agent's findings/conclusions,
        // so they get a distinct soft info-tinted fill (boxed color only —
        // same border/shape as other bubbles) to read as "insight" rather
        // than "in-progress discussion".
        const isConversational = entry.role === 'instruction'
            || entry.role === 'clarify'
            || entry.role === 'explain'
            || entry.role === 'delegate'
            || entry.role === 'summary';
        // Bubble chrome stays close to neutral, but the special states earn
        // a soft tinted fill in their per-variant semantic hue. The hues
        // here match `AgentPausePanel` so a paused entry and its panel
        // above the input read as the same color family:
        //   clarify              → warning   ("you're being asked")
        //   explain / suggest    → primary   ("here's an answer / handoff")
        //   summary              → secondary ("agent's finding")
        //   error                → error
        const isActiveClarify = entry.role === 'clarify' && !resolved;
        const isActiveExplain = (entry.role === 'explain'
            || entry.role === 'delegate') && !resolved;
        const isSummary = entry.role === 'summary';
        // Resolved clarify / explain / delegate entries collapse
        // into a "light timeline trace" — no card chrome, just a faded
        // one-line note. They still expand on click (the full text is
        // preserved via `collapsedLabel`/`displayText`), but at rest the
        // data thread foregrounds charts/data instead of back-and-forth.
        const isResolvedPause = resolved
            && (entry.role === 'clarify'
                || entry.role === 'explain'
                || entry.role === 'delegate');
        const bubbleAccent = entry.role === 'error'
            ? theme.palette.error.main
            : isSummary
                ? theme.palette.primary.main
                : isActiveClarify
                    ? theme.palette.warning.main
                    : isActiveExplain
                        ? theme.palette.primary.main
                        : null;
        const bubbleBg = bubbleAccent
            ? alpha(bubbleAccent, 0.05)
            : alpha(theme.palette.text.primary, 0.03);
        const bubbleHover = bubbleAccent
            ? alpha(bubbleAccent, 0.09)
            : alpha(theme.palette.text.primary, 0.05);
        // Conversational bubbles get card chrome, except resolved pauses and
        // summaries — both render chrome-less. A summary is the agent's
        // closing remark on a turn; reading it as plain prose (no box, no
        // fill) keeps the timeline foregrounding charts/data rather than
        // persisting the remark as a card.
        const bubbleSx = (isConversational && !isResolvedPause && !isSummary) ? {
            py: 0.5, px: 1,
            borderRadius: radius.sm,
            backgroundColor: bubbleBg,
            border: `1px solid ${borderColor.component}`,
        } : isResolvedPause ? {
            // Minimal trace: just inline padding so the text aligns with
            // the gutter icon and adjacent bubbles. No bg, no border.
            py: '2px', px: '4px',
            opacity: 0.7,
        } : isSummary ? {
            // Summary as flowing prose: no card chrome, just inline padding
            // so it aligns with the gutter icon and adjacent bubbles.
            py: '2px', px: '4px',
        } : {};

        return (
            <Box
                sx={{
                    // Active clarify/explain entries don't expand in place,
                    // but the surrounding timeline row is clickable to
                    // refocus — show pointer here too so the affordance
                    // reads consistently across icon, gutter, and text.
                    cursor: (isCollapsible || isActiveAgentPause) ? 'pointer' : 'default',
                    ...bubbleSx,
                    ...(isCollapsible && !isConversational ? {
                        borderRadius: '4px',
                        px: '2px',
                        mx: '-2px',
                        '&:hover': { backgroundColor: 'rgba(0,0,0,0.03)' },
                    } : {}),
                    ...(isCollapsible && isSummary ? {
                        // Gentle hover that doesn't reintroduce a card fill.
                        borderRadius: '4px',
                        '&:hover': { backgroundColor: 'rgba(0,0,0,0.03)' },
                    } : {}),
                    ...(isCollapsible && isConversational && !isSummary ? {
                        '&:hover': { backgroundColor: bubbleHover },
                    } : {}),
                }}
                onClick={() => isCollapsible && setExpanded(!expanded)}
            >
                <Collapse in={expanded}>
                    {hasPlan && (() => {
                        const planLines = (entry.plan!.includes('\x1E') ? entry.plan!.split('\x1E') : entry.plan!.split('\n')).filter(l => l.trim());
                        return (
                            <Box sx={{ py: '2px' }}>
                                <PlanStepsView steps={planLines} filterCreatingChart />
                            </Box>
                        );
                    })()}
                    {hasPlan && <Box sx={{ borderBottom: `1px solid ${borderColor.component}`, my: '2px' }} />}
                    {collapsedLabel && (
                        <Typography component="div" sx={{
                            fontSize: '11px',
                            color,
                            py: '1px',
                        }}>
                            {displayText}
                        </Typography>
                    )}
                </Collapse>
                {/* Collapsed view or always-visible main text */}
                {collapsedLabel ? (
                    !expanded && (
                        <Typography component="div" sx={{
                            fontSize: isResolvedPause ? '10px' : '11px',
                            color: theme.palette.text.secondary,
                            fontStyle: isResolvedPause ? 'italic' : 'normal',
                            py: '1px',
                            display: '-webkit-box',
                            WebkitLineClamp: isResolvedPause ? 1 : 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                        }}>
                            {collapsedLabel}
                        </Typography>
                    )
                ) : entry.role === 'summary' ? (
                    <Box sx={{ fontSize: '11px', py: '1px' }}>
                        <CompactMarkdown content={displayText} color={color} />
                    </Box>
                ) : (
                    <Typography component="div" sx={{
                        fontSize: '11px',
                        color,
                        py: '1px',
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                        ...((forceClampText || (canClampText && !expanded)) ? {
                            display: '-webkit-box',
                            WebkitLineClamp: TEXT_CLAMP_LINES,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                        } : {}),
                    }}>
                        {(entry.role === 'clarify' || entry.role === 'explain' || entry.role === 'delegate') && !resolved && (
                            <Box component="span" sx={{
                                display: 'inline',
                                fontWeight: 600,
                                fontSize: '10px',
                                mr: '4px',
                            }}>
                                ({entry.role === 'delegate'
                                    ? (entry.delegateTarget === 'report_gen'
                                        ? t('interaction.delegateLabelReportGen')
                                        : t('interaction.delegateLabelDataLoading'))
                                    : t('interaction.clarificationNeeded')})
                            </Box>
                        )}
                        {/* Active conversational bubbles render `**field**`
                            markers as highlights tinted in the bubble's own
                            accent color, so the underline matches the
                            bubble bg (and the matching panel above the input). */}
                        {(isActiveClarify || isActiveExplain)
                            ? renderFieldHighlights(text, bubbleAccent ?? theme.palette.primary.main)
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

export interface ResolvedConversationCardProps {
    pairs: { agentEntry: InteractionEntry; userEntry: InteractionEntry }[];
    highlighted?: boolean;
}

/** Render one or more resolved clarify/explain/suggest_data_search
 *  exchanges (each followed by a user reply) folded together into a
 *  single compact "conversation" timeline item. Collapsed by default to
 *  a one-line trace prefixed with a chat-bubble glyph; clicking expands
 *  to show every Q & A in order as paired bubbles.
 *
 *  This declutters the data thread once a back-and-forth is resolved —
 *  the timeline foregrounds charts/data; the exchange recedes into a
 *  hinted "💬 conversation happened here" marker that stays openable
 *  for context.
 */
export const ResolvedConversationCard: React.FC<ResolvedConversationCardProps> = memo(({ pairs }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);

    if (pairs.length === 0) return null;

    // Preview uses the LAST user reply (most recent resolution); fall back
    // to the last agent question if that reply is empty.
    const lastPair = pairs[pairs.length - 1];
    const lastUserText = stripFieldMarkers(lastPair.userEntry.displayContent || lastPair.userEntry.content).replace(/\s+/g, ' ').trim();
    const lastAgentText = stripFieldMarkers(lastPair.agentEntry.displayContent || lastPair.agentEntry.content).replace(/\s+/g, ' ').trim();
    const previewText = lastUserText || lastAgentText;

    const dim = theme.palette.text.secondary;
    const customPalette = theme.palette.custom;
    const turnCount = pairs.length;

    return (
        <Box
            onClick={() => setExpanded(v => !v)}
            sx={{
                cursor: 'pointer',
                py: '2px',
                px: '4px',
                borderRadius: '4px',
                '&:hover': { backgroundColor: 'rgba(0,0,0,0.03)' },
            }}
        >
            {!expanded ? (
                <Box sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '6px',
                    fontSize: '11px',
                    color: dim,
                    opacity: 0.8,
                }}>
                    {turnCount > 1 && (
                        <Typography component="span" sx={{
                            fontSize: '10px',
                            color: 'inherit',
                            opacity: 0.7,
                            flexShrink: 0,
                            fontVariantNumeric: 'tabular-nums',
                            lineHeight: 1.4,
                            mt: '1px',
                        }}>
                            ×{turnCount}
                        </Typography>
                    )}
                    <Typography component="span" sx={{
                        fontSize: 'inherit',
                        color: 'inherit',
                        fontStyle: 'italic',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        flex: 1,
                        minWidth: 0,
                        lineHeight: 1.4,
                    }}>
                        {previewText}
                    </Typography>
                </Box>
            ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px', py: '2px' }}>
                    {pairs.map((p, idx) => (
                        <React.Fragment key={idx}>
                            <Box sx={{
                                fontSize: '11px',
                                color: theme.palette.text.primary,
                                py: 0.5, px: 1,
                                borderRadius: radius.sm,
                                backgroundColor: alpha(theme.palette.text.primary, 0.03),
                                border: `1px solid ${borderColor.component}`,
                            }}>
                                <Typography component="div" sx={{ fontSize: 'inherit', color: 'inherit' }}>
                                    {renderFieldHighlights(p.agentEntry.displayContent || p.agentEntry.content, theme.palette.primary.main)}
                                </Typography>
                            </Box>
                            <Box sx={{
                                fontSize: '11px',
                                color: theme.palette.text.primary,
                                py: 0.5, px: 1,
                                borderRadius: radius.sm,
                                backgroundColor: customPalette.bgcolor,
                                border: `1px solid ${borderColor.component}`,
                            }}>
                                <Typography component="div" sx={{ fontSize: 'inherit', color: 'inherit' }}>
                                    {renderFieldHighlights(p.userEntry.displayContent || p.userEntry.content, customPalette.main)}
                                </Typography>
                            </Box>
                        </React.Fragment>
                    ))}
                </Box>
            )}
        </Box>
    );
});
ResolvedConversationCard.displayName = 'ResolvedConversationCard';

/** Returns the appropriate gutter icon for an InteractionEntry. */
export function getEntryGutterIcon(entry: InteractionEntry, color: string): React.ReactNode {
    const iconSx = { width: 18, height: 18, color };
    if (entry.from === 'user') {
        return <PersonIcon sx={iconSx} />;
    }
    // Pick a role-specific variant of the agent toy so the gutter conveys
    // state at a glance (thinking / summary / clarify / explain).
    const variant: AgentToyVariant = (() => {
        switch (entry.role) {
            case 'clarify': return 'clarify';
            case 'explain': return 'explain';
            case 'delegate': return 'explain';
            case 'summary': return 'summary';
            case 'instruction': return 'thinking';
            default: return 'default';
        }
    })();
    return <AgentToyIcon variant={variant} sx={iconSx} />;
}

/** Returns the appropriate gutter icon when no entry is available (fallback). */
export function getDefaultGutterIcon(color: string): React.ReactNode {
    return <AgentIcon sx={{ width: 18, height: 18, color }} />;
}
