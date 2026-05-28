// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unified UI for "agent pause" panels that sit above the chat input in
 * `SimpleChartRecBox`. All three variants share the same chrome (accent
 * background, collapsible header with dismiss + minimize, body area) and
 * differ only in their body content and the callback wired to the primary
 * action:
 *
 *  - `ClarificationPanel` — agent asks a question (warning palette).
 *  - `ExplanationPanel`   — agent gives an answer with follow-ups (info palette).
 *    (rendered by `ClarificationPanel` with `variant="explain"`)
 *  - `DelegatePanel`      — agent recommends handing off to a peer
 *                           agent (Data Loading or Report Gen).
 *
 * Keeping them in one file makes shared styling/layout tweaks (header
 * spacing, palette use, collapse animation) trivial to maintain.
 */

import React, { FC, ReactNode, useEffect, useRef, useState } from 'react';
import {
    Box, Collapse, IconButton, Tooltip, Typography, useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { dfActions } from '../app/dfSlice';
import { AgentToyIcon } from './AgentToyIcon';
import {
    ClarificationQuestion,
    ClarificationResponse,
    DelegateTarget,
} from '../components/ComponentType';
import { renderFieldHighlights } from './InteractionEntryCard';

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------

interface AgentPauseShellProps {
    /** Localized header label shown both when expanded and minimized. */
    title: string;
    /** Short preview text shown next to the title when the panel is minimized. */
    minimizedPreview?: string;
    /** Tooltip + behavior for the dismiss (×) icon. */
    dismissTooltip: string;
    /** Tooltip labels for the minimize/expand toggle. */
    minimizeTooltip: string;
    expandTooltip: string;
    /**
     * Icon glyph rendered in the header. Callers pass a fully-styled
     * `AgentToyIcon` (or any node) so the shell stays agnostic of icon
     * variants and colors. The shell only fades the icon when minimized.
     */
    icon: ReactNode;
    /**
     * Optional accent color driving the panel's chrome (bg fill, border,
     * hover). When omitted the panel uses neutral greyscale chrome. Each
     * pause variant passes its own semantic hue so clarify / explain /
     * suggest panels read as visually distinct moments in the timeline
     * (parallel to the tinted bubbles in `InteractionEntryCard`).
     */
    accentColor?: string;
    /** Called when the user dismisses the pause. */
    onCancel: () => void;
    /** Reset minimized state whenever this value changes (e.g. new questions). */
    resetKey?: unknown;
    children: ReactNode;
}

const AgentPauseShell: FC<AgentPauseShellProps> = ({
    title,
    minimizedPreview,
    dismissTooltip,
    minimizeTooltip,
    expandTooltip,
    icon,
    accentColor,
    onCancel,
    resetKey,
    children,
}) => {
    const theme = useTheme();
    const [minimized, setMinimized] = useState(false);

    // Chrome is either neutral greyscale (no accent) or a soft tinted fill
    // in the variant's semantic hue (clarify=warning, explain/suggest=primary).
    // The tint is intentionally faint so the panel sits quietly above the
    // chat input — interactive affordances (option chips, CTAs) still carry
    // the strongest color.
    const tinted = !!accentColor;
    const panelBg = tinted
        ? alpha(accentColor!, 0.05)
        : alpha(theme.palette.text.primary, 0.03);
    const panelBorder = tinted
        ? alpha(accentColor!, 0.18)
        : alpha(theme.palette.text.primary, 0.10);
    const panelHover = tinted
        ? alpha(accentColor!, 0.09)
        : alpha(theme.palette.text.primary, 0.04);
    const primaryColor = theme.palette.primary.main;

    // Reset minimize when the underlying pause changes so a brand-new
    // pause shows up expanded by default.
    useEffect(() => { setMinimized(false); }, [resetKey]);

    return (
        <Box sx={{
            display: 'flex', flexDirection: 'column',
            px: 0.5, pt: 0,
            borderBottom: `1px solid ${panelBorder}`,
            backgroundColor: panelBg,
            // Inset slightly under the parent Card's gradient border (1.5px
            // stroke + 12px outer radius → ~10.5px inner radius). Match
            // that inner curve so the panel's rounded corners hug the
            // gradient border instead of sticking out as squared edges.
            borderRadius: '10.5px 10.5px 0 0',
            overflow: 'hidden',
            mx: '-10px', mt: '-8px', mb: '4px',
        }}>
            <Box
                onClick={() => setMinimized(prev => !prev)}
                sx={{
                    display: 'flex', alignItems: 'center', gap: '6px', minHeight: 16,
                    cursor: 'pointer',
                    // Stretch hover background to the panel's full content
                    // width by extending past the parent's px: 0.5 padding,
                    // then re-add it on the inside. Header owns the top
                    // spacing so the hover bg fills cleanly to the panel's
                    // rounded top edge.
                    px: 0.5, mx: -0.5, pt: '8px', pb: '6px',
                    '&:hover': { backgroundColor: panelHover },
                }}
            >
                <Box sx={{
                    display: 'inline-flex', flexShrink: 0,
                    opacity: minimized ? 0.5 : 1,
                }}>
                    {icon}
                </Box>
                {minimized ? (
                    <Box sx={{
                        flex: 1, display: 'flex', alignItems: 'baseline',
                        gap: '6px', minWidth: 0,
                    }}>
                        <Typography sx={{
                            fontSize: 10, fontWeight: 600,
                            color: theme.palette.text.disabled,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em', flexShrink: 0,
                        }}>
                            {title}
                        </Typography>
                        {minimizedPreview && (
                            <Typography sx={{
                                fontSize: 11,
                                color: theme.palette.text.secondary,
                                fontStyle: 'italic',
                                overflow: 'hidden', textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap', minWidth: 0, flex: 1,
                            }}>
                                {minimizedPreview.slice(0, 120)}
                            </Typography>
                        )}
                    </Box>
                ) : (
                    <Typography sx={{
                        fontSize: 11, fontWeight: 600,
                        color: theme.palette.text.primary,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em', flex: 1,
                    }}>
                        {title}
                    </Typography>
                )}
                <Tooltip title={dismissTooltip}>
                    <IconButton
                        size="small"
                        onClick={(e) => { e.stopPropagation(); onCancel(); }}
                        sx={{
                            p: 0, width: 16, height: 16,
                            color: theme.palette.text.disabled,
                            '&:hover': { color: theme.palette.error.main },
                        }}
                    >
                        <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                </Tooltip>
                <Tooltip title={minimized ? expandTooltip : minimizeTooltip}>
                    <IconButton
                        size="small"
                        // The whole header row is clickable to toggle; this
                        // dedicated button just provides the affordance and a
                        // tooltip.
                        sx={{
                            p: 0, width: 16, height: 16,
                            color: theme.palette.text.secondary,
                            '&:hover': { color: primaryColor },
                        }}
                        tabIndex={-1}
                    >
                        {minimized
                            ? <UnfoldMoreIcon sx={{ fontSize: 14 }} />
                            : <UnfoldLessIcon sx={{ fontSize: 14 }} />}
                    </IconButton>
                </Tooltip>
            </Box>

            <Collapse in={!minimized} timeout={180} unmountOnExit={false}>
                {children}
            </Collapse>
        </Box>
    );
};

// ---------------------------------------------------------------------------
// ClarificationPanel (also handles `variant="explain"`)
// ---------------------------------------------------------------------------

interface ClarificationPanelProps {
    questions: ClarificationQuestion[];
    /**
     * 'clarify' (default) — agent is asking the user a question (warning palette).
     * 'explain'           — agent gave an answer; options are suggested chart
     *                       follow-ups the user can click (info palette).
     */
    variant?: 'clarify' | 'explain';
    /**
     * Optional. Currently selected answer per question (keyed by question
     * index). When provided together with `onSelectAnswer`, the panel will
     * route option clicks (and free-text Enter) through `onSelectAnswer`
     * instead of submitting immediately. The parent decides when to submit
     * (e.g. after all questions are answered).
     */
    selectedAnswers?: Record<number, ClarificationResponse>;
    onSelectAnswer?: (questionIndex: number, response: ClarificationResponse) => void;
    onSubmit: (responses: ClarificationResponse[]) => void;
    onCancel: () => void;
}

export const ClarificationPanel: FC<ClarificationPanelProps> = ({
    questions,
    variant = 'clarify',
    selectedAnswers,
    onSelectAnswer,
    onSubmit,
    onCancel,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const submittedRef = useRef(false);

    useEffect(() => { submittedRef.current = false; }, [questions]);

    const submitResponses = (responses: ClarificationResponse[]) => {
        if (responses.length === 0 || submittedRef.current) return;
        submittedRef.current = true;
        onSubmit(responses);
    };

    /**
     * Handle a single answer (option click or free-text Enter). When the
     * parent provides `onSelectAnswer`, the panel defers to it and the
     * parent decides when to actually submit. Otherwise we fall back to
     * the legacy "click = submit immediately" behavior.
     */
    const handleAnswer = (response: ClarificationResponse) => {
        if (onSelectAnswer) {
            onSelectAnswer(response.question_index, response);
            return;
        }
        submitResponses([response]);
    };

    const isExplain = variant === 'explain';
    // Per-variant accent color drives both the panel chrome (bg/border) and
    // the option chip affordances (border, hover, selection) so a clarify
    // panel reads entirely in the warning hue and an explain panel entirely
    // in the primary hue — no cross-color clashes between chrome and chips.
    const chromeAccent = isExplain
        ? theme.palette.primary.main
        : theme.palette.warning.main;
    // Field highlights (`**name**` tokens in question/option text) also use
    // the variant accent so the underline color matches the panel.
    const accentColor = chromeAccent;
    const title = t(isExplain ? 'chartRec.explanationTitle' : 'chartRec.clarificationTitle');

    return (
        <AgentPauseShell
            icon={<AgentToyIcon
                variant={isExplain ? 'explain' : 'clarify'}
                sx={{ fontSize: 16, color: chromeAccent }}
            />}
            accentColor={chromeAccent}
            title={title}
            minimizedPreview={questions[0]?.text || ''}
            dismissTooltip={t('chartRec.cancelClarification')}
            minimizeTooltip={t('chartRec.minimizeClarification')}
            expandTooltip={t('chartRec.expandClarification')}
            onCancel={onCancel}
            resetKey={questions}
        >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px', pb: '8px' }}>
                {questions.map((question, questionIndex) => (
                    <Box key={questionIndex} sx={{ display: 'flex', flexDirection: 'column', gap: '4px', pl: '20px' }}>
                        {/* Text portion is height-bounded and scrollable so very
                            long explanations don't push options off-screen.
                            Options remain fixed below the scrolling region. */}
                        <Box sx={{
                            maxHeight: 'clamp(144px, 28vh, 288px)',
                            overflowY: 'auto',
                            pr: '4px',
                        }}>
                            <Typography component="div" sx={{ fontSize: 12, color: theme.palette.text.primary, lineHeight: 1.5 }}>
                                {!isExplain && questions.length > 1 && (
                                    <>
                                        {t('chartRec.clarificationQuestionLabel', { index: questionIndex + 1 })}{' '}
                                    </>
                                )}
                                {renderFieldHighlights(question.text, accentColor)}
                            </Typography>
                        </Box>

                        {question.responseType === 'free_text' ? (
                            // Free-text questions don't render their own input.
                            // The user types the answer in the main chat box
                            // below and hits Send (or Enter).
                            <Typography sx={{
                                fontSize: 10,
                                color: theme.palette.text.disabled,
                                fontStyle: 'italic',
                                mt: '2px',
                            }}>
                                {t('chartRec.freeTextClarificationHint')}
                            </Typography>
                        ) : (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {isExplain && (question.options || []).length > 0 && (
                                    <Typography sx={{
                                        fontSize: 10,
                                        color: theme.palette.text.disabled,
                                        fontStyle: 'italic',
                                        mt: '2px',
                                    }}>
                                        {t('chartRec.explanationFollowupsLabel')}
                                    </Typography>
                                )}
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                    {(question.options || []).map((option, optionIndex) => {
                                        const selected = selectedAnswers?.[questionIndex];
                                        const isSelected = !!selected && selected.answer === option.label;
                                        return (
                                            <Box key={optionIndex} sx={{ position: 'relative', overflow: 'hidden', borderRadius: '6px' }}>
                                                <Typography
                                                    component="button"
                                                    type="button"
                                                    onClick={() => handleAnswer({
                                                        question_index: questionIndex,
                                                        answer: option.label,
                                                        source: 'option',
                                                    })}
                                                    sx={{
                                                        position: 'relative', zIndex: 1,
                                                        px: '8px', py: '4px',
                                                        borderRadius: '6px',
                                                        border: `1px solid ${isSelected ? alpha(accentColor, 0.6) : alpha(theme.palette.text.primary, 0.12)}`,
                                                        backgroundColor: isSelected ? alpha(accentColor, 0.12) : theme.palette.background.paper,
                                                        cursor: 'pointer',
                                                        fontSize: 11,
                                                        fontWeight: isSelected ? 600 : 400,
                                                        display: 'inline-block',
                                                        whiteSpace: 'normal',
                                                        wordBreak: 'break-word',
                                                        lineHeight: 1.4,
                                                        color: theme.palette.text.primary,
                                                        textAlign: 'left',
                                                        fontFamily: theme.typography.fontFamily,
                                                        '&:hover': { backgroundColor: alpha(accentColor, isSelected ? 0.16 : 0.08) },
                                                    }}
                                                >
                                                    {renderFieldHighlights(option.label, accentColor)}
                                                </Typography>
                                            </Box>
                                        );
                                    })}
                                </Box>
                            </Box>
                        )}
                    </Box>
                ))}
            </Box>
        </AgentPauseShell>
    );
};

// ---------------------------------------------------------------------------
// DelegatePanel
// ---------------------------------------------------------------------------

interface DelegatePanelProps {
    /** Which peer agent the Data Agent recommends handing off to. */
    target: DelegateTarget;
    /** Short user-facing message from the Data Agent. */
    message: string;
    /** One or two hand-off option prompts (cards). Each string is shown
     *  on the button and used as the seed prompt for the target agent. */
    options: string[];
    /** Dismiss the suggestion (treated as cancelling the pause). */
    onCancel: () => void;
}

/**
 * Renders when the Data Agent emits a `delegate` action. The card shows
 * a short message plus 1–2 one-click hand-off buttons. Picking one
 * dispatches an `agentHandoffRequest` to Redux; the matching consumer
 * (Data Formulator for `data_loading`, SimpleChartRecBox for
 * `report_gen`) picks it up and starts the target agent with the
 * selected option as its seed prompt.
 */
export const DelegatePanel: FC<DelegatePanelProps> = ({
    target,
    message,
    options,
    onCancel,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch();

    const handleHandoff = (prompt: string) => {
        const cleanPrompt = prompt.trim();
        if (!cleanPrompt) return;
        dispatch(dfActions.requestAgentHandoff({ target, prompt: cleanPrompt }));
        // Hand off — the user's attention moves to the target agent
        // and the data-agent run is done.
        onCancel();
    };

    const isReport = target === 'report_gen';
    const ctaCaption = isReport
        ? t('chartRec.delegateToReportGen')
        : t('chartRec.delegateToDataLoading');
    const CtaIcon = isReport ? DescriptionOutlinedIcon : SearchIcon;

    const validOptions = (options || [])
        .map(o => (o || '').trim())
        .filter(o => o.length > 0)
        .slice(0, 2);

    return (
        <AgentPauseShell
            icon={<AgentToyIcon
                variant="explain"
                sx={{ fontSize: 16, color: theme.palette.primary.main }}
            />}
            accentColor={theme.palette.primary.main}
            title={t('chartRec.delegateTitle')}
            minimizedPreview={message}
            dismissTooltip={t('chartRec.delegateDismiss')}
            minimizeTooltip={t('chartRec.delegateMinimize')}
            expandTooltip={t('chartRec.delegateExpand')}
            onCancel={onCancel}
            resetKey={`${target}|${validOptions.join('||')}`}
        >
            <Box sx={{
                display: 'flex', flexDirection: 'column',
                gap: '8px', pb: '8px', pl: '20px', pr: '4px',
            }}>
                {message && (
                    <Box sx={{
                        maxHeight: 'clamp(96px, 20vh, 240px)',
                        overflowY: 'auto',
                    }}>
                        <Typography component="div" sx={{
                            fontSize: 12,
                            color: theme.palette.text.primary,
                            lineHeight: 1.5,
                        }}>
                            {message}
                        </Typography>
                    </Box>
                )}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <Typography sx={{
                        fontSize: 10,
                        color: theme.palette.text.disabled,
                        fontStyle: 'italic',
                    }}>
                        {ctaCaption}
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {validOptions.map((prompt, idx) => (
                            <Box
                                key={`${idx}|${prompt}`}
                                sx={{ position: 'relative', overflow: 'hidden', borderRadius: '6px' }}
                            >
                                <Typography
                                    component="button"
                                    type="button"
                                    onClick={() => handleHandoff(prompt)}
                                    title={prompt}
                                    sx={{
                                        position: 'relative', zIndex: 1,
                                        width: '100%',
                                        px: '8px', py: '6px',
                                        borderRadius: '6px',
                                        border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
                                        backgroundColor: theme.palette.background.paper,
                                        cursor: 'pointer',
                                        fontSize: 11,
                                        fontWeight: 400,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        whiteSpace: 'normal',
                                        wordBreak: 'break-word',
                                        lineHeight: 1.4,
                                        color: theme.palette.text.primary,
                                        textAlign: 'left',
                                        fontFamily: theme.typography.fontFamily,
                                        '&:hover': {
                                            backgroundColor: alpha(theme.palette.primary.main, 0.08),
                                        },
                                    }}
                                >
                                    <CtaIcon sx={{
                                        fontSize: 14,
                                        color: theme.palette.primary.main,
                                        flexShrink: 0,
                                    }} />
                                    <span>{prompt}</span>
                                </Typography>
                            </Box>
                        ))}
                    </Box>
                </Box>
            </Box>
        </AgentPauseShell>
    );
};
