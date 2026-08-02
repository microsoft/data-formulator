// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unified UI for "agent pause" panels that sit above the chat input in
 * `SimpleChartRecBox`. All three variants share the same chrome (accent
 * background, collapsible header with dismiss + minimize, body area) and
 * differ only in their body content and the callback wired to the primary
 * action:
 *
 *  - `ClarificationPanel` — agent asks a question.
 *  - `ExplanationPanel`   — agent gives an answer with follow-ups.
 *    (rendered by `ClarificationPanel` with `variant="explain"`)
 *  - `DelegatePanel`      — agent recommends handing off to a peer
 *                           agent (Data Loading or Report Gen).
 *
 * Clarify and explain share a unified muted (neutral greyscale) chrome; the
 * only spot of color is the header icon's badge (`?` / `i`).
 * Keeping them in one file makes shared styling/layout tweaks (header
 * spacing, palette use, collapse animation) trivial to maintain.
 */

import React, { FC, ReactNode, useEffect, useRef, useState } from 'react';
import {
    Box, IconButton, InputAdornment, TextField, Tooltip, Typography, useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { dfActions } from '../app/dfSlice';
import { AgentToyIcon } from './AgentToyIcon';
import {
    ClarificationQuestion,
    ClarificationResponse,
    DelegateTarget,
} from '../components/ComponentType';
import { renderFieldHighlights, CompactMarkdown } from './InteractionEntryCard';

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------

interface AgentPauseShellProps {
    /** Localized header label. */
    title: string;
    /** Tooltip for the close (×) icon — de-highlights / switches focus. */
    closeTooltip: string;
    /** Deprecated: delete is handled from the thread card directly, so the
     *  panel no longer renders a delete button. Kept optional for callers. */
    deleteTooltip?: string;
    /**
     * Icon glyph rendered in the header. Callers pass a fully-styled
     * `AgentToyIcon` (or any node) so the shell stays agnostic of icon
     * variants and colors.
     */
    icon: ReactNode;
    /**
     * Optional accent color driving the panel's chrome (bg fill, border).
     * When omitted the panel uses a faint wash of the theme's SECONDARY color.
     * Each pause variant passes its own semantic hue so clarify / explain /
     * suggest panels read as visually distinct moments in the timeline
     * (parallel to the tinted bubbles in `InteractionEntryCard`).
     */
    accentColor?: string;
    /** Close: de-highlight the pause and switch focus to the previous chart. */
    onClose: () => void;
    /** Deprecated: delete is handled from the thread card directly. */
    onDelete?: () => void;
    children: ReactNode;
}

const AgentPauseShell: FC<AgentPauseShellProps> = ({
    title,
    closeTooltip,
    icon,
    accentColor,
    onClose,
    children,
}) => {
    const theme = useTheme();

    // Chrome is a soft tinted fill in the accent hue. When no explicit accent
    // is given the panel falls back to a faint wash of the theme's SECONDARY
    // color — a different, theme-derived hue from the primary blue used by the
    // chat affordances, so the panel reads as its own subtle surface.
    const fillAccent = accentColor ?? theme.palette.secondary.main;
    const panelBg = alpha(fillAccent, 0.05);
    const panelBorder = alpha(fillAccent, 0.18);
    const primaryColor = theme.palette.primary.main;

    return (
        <Box sx={{
            display: 'flex', flexDirection: 'column',
            px: 0.5, pt: 0,
            borderBottom: `1px solid ${panelBorder}`,
            backgroundColor: panelBg,
            // Inset slightly under the parent Card's gradient border (1.5px
            // stroke + 12px outer radius → ~10.5px inner radius) so the panel's
            // rounded corners hug the gradient border cleanly.
            borderRadius: '10.5px 10.5px 0 0',
            overflow: 'hidden',
            mx: '-10px', mt: '-8px', mb: '4px',
        }}>
            <Box sx={{
                display: 'flex', alignItems: 'center', gap: '6px', minHeight: 16,
                px: 0.5, mx: -0.5, pt: '8px', pb: '6px',
            }}>
                <Box sx={{ display: 'inline-flex', flexShrink: 0 }}>
                    {icon}
                </Box>
                <Typography sx={{
                    fontSize: 11, fontWeight: 600,
                    color: theme.palette.text.primary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em', flex: 1,
                }}>
                    {title}
                </Typography>
                <Tooltip title={closeTooltip}>
                    <IconButton
                        size="small"
                        onClick={onClose}
                        sx={{
                            p: 0, width: 16, height: 16,
                            color: theme.palette.text.secondary,
                            '&:hover': { color: primaryColor },
                        }}
                    >
                        <CloseRoundedIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                </Tooltip>
            </Box>

            {children}
        </Box>
    );
};

// ---------------------------------------------------------------------------
// ClarificationPanel (also handles `variant="explain"`)
// ---------------------------------------------------------------------------

interface ClarificationPanelProps {
    questions: ClarificationQuestion[];
    /**
     * 'clarify' (default) — agent is asking the user a question.
     * 'explain'           — agent gave an answer; options are suggested chart
     *                       follow-ups the user can click.
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
    /**
     * Record an answer for a question. `autoSubmit` (default true) lets the
     * caller distinguish an explicit confirm (option click / check button /
     * Enter — which may auto-submit the whole panel once every question is
     * answered) from an implicit one (blur auto-confirm — which records the
     * answer but must never trigger a submission).
     */
    onSelectAnswer?: (questionIndex: number, response: ClarificationResponse, autoSubmit?: boolean) => void;
    /** Clear a question's recorded answer (e.g. the user edits its field). */
    onClearAnswer?: (questionIndex: number) => void;
    onSubmit: (responses: ClarificationResponse[]) => void;
    /** Close: de-highlight the pause and switch focus to the previous chart. */
    onClose: () => void;
    /** Delete: remove this pending pause block. */
    onDelete: () => void;
}

export const ClarificationPanel: FC<ClarificationPanelProps> = ({
    questions,
    variant = 'clarify',
    selectedAnswers,
    onSelectAnswer,
    onClearAnswer,
    onSubmit,
    onClose,
    onDelete,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const submittedRef = useRef(false);

    // Freeform replies typed directly inside the panel, keyed by the question
    // they answer. A question's own index holds its typed text; the sentinel
    // key -1 holds the explain variant's panel-level custom-followup override.
    const [freeTexts, setFreeTexts] = useState<Record<number, string>>({});

    useEffect(() => { submittedRef.current = false; setFreeTexts({}); }, [questions]);

    const setFreeText = (key: number, value: string) =>
        setFreeTexts(prev => ({ ...prev, [key]: value }));

    const isExplain = variant === 'explain';
    // Two-context color scheme, kept gentle. Each pause carries its own
    // semantic hue (clarify=warning, explain=info) so the two read as distinct
    // moments — but the hue only tints the quiet chrome (panel wash, border,
    // chips, focus underline, field highlights, badge). The strong CTA (submit
    // button) stays in the neutral brand primary so a clarify panel never
    // shouts in aggressive amber. `chromeAccent` = the variant hue, used
    // everywhere except the submit button (`submitAccent`).
    const chromeAccent = isExplain
        ? theme.palette.info.main
        : theme.palette.warning.main;
    const badgeAccent = chromeAccent;
    const submitAccent = theme.palette.primary.main;
    // Field highlights (`**name**` tokens) follow the variant hue too.
    const accentColor = chromeAccent;

    const submitResponses = (responses: ClarificationResponse[]) => {
        if (responses.length === 0 || submittedRef.current) return;
        submittedRef.current = true;
        onSubmit(responses);
    };

    // A question counts as answered once it has either a clicked option (held
    // by the parent in `selectedAnswers`) OR non-empty typed text. No explicit
    // "confirm" step — typing is the answer. Submit enables when every
    // question is answered. Explain additionally accepts a panel-level custom
    // followup (sentinel -1).
    const isAnswered = (idx: number) =>
        !!selectedAnswers?.[idx] || (freeTexts[idx] || '').trim().length > 0;
    const allQuestionsAnswered = questions.every((_q, idx) => isAnswered(idx));
    const explainOverrideTyped = (freeTexts[-1] || '').trim().length > 0;
    const canSubmit = isExplain ? (allQuestionsAnswered || explainOverrideTyped) : allQuestionsAnswered;

    // A clarify panel auto-submits (on the click that completes it) only when
    // EVERY answer is a clicked option — a pure "click your way through" flow.
    // The moment any text answer is in play (a free_text question, or the user
    // typed into a single_choice's "type your own" field), we show an explicit
    // shared submit button instead, so a stray option click can never sweep up
    // an unfinished typed answer. The button belongs to the panel, not a row.
    const hasFreeTextQuestion = !isExplain && questions.some(q => q.responseType === 'free_text');
    const anyTextTyped = questions.some((_q, idx) => (freeTexts[idx] || '').trim().length > 0);
    const showPanelSubmit = !isExplain && (hasFreeTextQuestion || anyTextTyped);

    // Gather the reply: each question's clicked option, else its typed
    // free-text; plus (explain only) the optional panel-level custom override.
    // The backend formats these by index, so the correlation stays intact.
    const handlePanelSubmit = () => {
        const responses: ClarificationResponse[] = [];
        questions.forEach((_q, idx) => {
            const sel = selectedAnswers?.[idx];
            if (sel) {
                responses.push(sel);
            } else {
                const typed = (freeTexts[idx] || '').trim();
                if (typed) responses.push({ question_index: idx, answer: typed, source: 'free_text' });
            }
        });
        if (isExplain) {
            const custom = (freeTexts[-1] || '').trim();
            if (custom) responses.push({ question_index: -1, answer: custom, source: 'freeform' });
        }
        submitResponses(responses);
    };

    // Typing in a question's field IS the answer — recorded live (never
    // auto-submitting). Clearing the text removes the answer; a prior option
    // pick is invalidated the moment the user starts typing.
    const recordFreeText = (idx: number, value: string) => {
        setFreeText(idx, value);
        const typed = value.trim();
        if (typed) {
            onSelectAnswer?.(idx, { question_index: idx, answer: typed, source: 'free_text' }, false);
        } else {
            onClearAnswer?.(idx);
        }
    };

    // Shared muted standard-input chrome for all freeform fields.
    const freeTextSx = {
        '& .MuiInput-root': {
            fontSize: 11,
            color: theme.palette.text.secondary,
            '&:before': { borderBottomColor: alpha(theme.palette.text.primary, 0.1) },
            '&:hover:not(.Mui-disabled):before': { borderBottomColor: alpha(theme.palette.text.primary, 0.25) },
            '&:after': { borderBottomColor: alpha(chromeAccent, 0.6) },
        },
        '& .MuiInput-input::placeholder': {
            color: theme.palette.text.disabled,
            opacity: 0.7,
            fontSize: 11,
        },
    } as const;

    // Per-question freeform field with a lightweight inline "answered" check.
    // free_text questions use it as their sole input; single_choice questions
    // use it as a "type your own instead" companion beneath the chips.
    // `trailing` docks a control (the panel submit button) to the right of the
    // input on the same line — used on the last clarify question so submit
    // shares the row instead of taking its own.
    const renderQuestionField = (idx: number, placeholder: string, trailing?: ReactNode) => {
        // A small inline check appears once the user has typed an answer (an
        // option click is already self-evident from the highlighted chip). It
        // sits at the end of the input line via an InputAdornment for tight
        // spacing rather than floating in its own column.
        const hasTypedAnswer = (freeTexts[idx] || '').trim().length > 0;
        return (
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '8px', pr: '4px' }}>
                <Box sx={{ flex: '0 1 auto', width: '100%', maxWidth: 320 }}>
                    <TextField
                        value={freeTexts[idx] || ''}
                        onChange={(e) => recordFreeText(idx, e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (canSubmit) handlePanelSubmit();
                            }
                        }}
                        placeholder={placeholder}
                        variant="standard"
                        multiline
                        maxRows={4}
                        fullWidth
                        slotProps={{
                            input: {
                                endAdornment: hasTypedAnswer ? (
                                    <InputAdornment position="end">
                                        <CheckRoundedIcon sx={{ fontSize: 14, color: alpha(chromeAccent, 0.7) }} />
                                    </InputAdornment>
                                ) : undefined,
                            },
                        }}
                        sx={freeTextSx}
                    />
                </Box>
                {trailing && <Box sx={{ flexShrink: 0, mb: '2px', ml: 'auto' }}>{trailing}</Box>}
            </Box>
        );
    };

    // Shared panel-level submit button. Shown whenever a text answer is in
    // play (otherwise the panel auto-submits on the completing option click).
    // Muted outline until every question is answered, then fills with the
    // accent and becomes clickable.
    const panelSubmitButton = (
        <Tooltip title={t('chartRec.submitClarification')}>
            <span>
                <IconButton
                    size="small"
                    aria-label={t('chartRec.submitClarification')}
                    disabled={!canSubmit}
                    onClick={handlePanelSubmit}
                    sx={{
                        width: 26, height: 26, flexShrink: 0,
                        color: canSubmit ? theme.palette.common.white : alpha(theme.palette.text.primary, 0.3),
                        backgroundColor: canSubmit ? submitAccent : 'transparent',
                        border: `1px solid ${canSubmit ? submitAccent : alpha(theme.palette.text.primary, 0.2)}`,
                        '&:hover': { backgroundColor: canSubmit ? alpha(submitAccent, 0.85) : alpha(theme.palette.text.primary, 0.06) },
                        '&.Mui-disabled': {
                            color: alpha(theme.palette.text.primary, 0.3),
                            border: `1px solid ${alpha(theme.palette.text.primary, 0.2)}`,
                        },
                    }}
                >
                    <ArrowForwardRoundedIcon sx={{ fontSize: 16 }} />
                </IconButton>
            </span>
        </Tooltip>
    );

    // Explain's panel-level override keeps a plain field (no per-question
    // confirm): clicking a followup or typing here + the panel submit button
    // is the flow.
    const renderOverrideInput = (placeholder: string) => (
        <TextField
            value={freeTexts[-1] || ''}
            onChange={(e) => setFreeText(-1, e.target.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (canSubmit) handlePanelSubmit();
                }
            }}
            placeholder={placeholder}
            variant="standard"
            multiline
            maxRows={4}
            fullWidth
            sx={freeTextSx}
        />
    );

    /**
     * Handle a clicked option. When the parent provides `onSelectAnswer` the
     * panel defers to it (the parent decides when to submit); otherwise we
     * fall back to the legacy "click = submit immediately" behavior.
     */
    const handleAnswer = (response: ClarificationResponse) => {
        // Clicking an option supersedes any text typed for this question, so
        // clear the field to keep the answer unambiguous.
        if ((freeTexts[response.question_index] || '').length > 0) {
            setFreeText(response.question_index, '');
        }
        if (onSelectAnswer) {
            onSelectAnswer(response.question_index, response);
            return;
        }
        submitResponses([response]);
    };

    const title = t(isExplain ? 'chartRec.explanationTitle' : 'chartRec.clarificationTitle');


    return (
        <AgentPauseShell
            icon={<AgentToyIcon
                variant={isExplain ? 'explain' : 'clarify'}
                sx={{ fontSize: 16, color: badgeAccent }}
            />}
            accentColor={chromeAccent}
            title={title}
            closeTooltip={t('chartRec.pauseClose')}
            deleteTooltip={t('chartRec.pauseDelete')}
            onClose={onClose}
            onDelete={onDelete}
        >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: questions.length > 1 ? '14px' : '4px', pb: '8px' }}>
                {questions.map((question, questionIndex) => {
                    // free_text → freeform field only. single_choice → chips
                    // PLUS a "type your own" freeform companion. explain keeps
                    // its lightweight clickable-followups display (no per-question
                    // freeform; the user types custom followups in the override).
                    const isFreeTextOnly = !isExplain && question.responseType === 'free_text';
                    const showChips = isExplain || question.responseType !== 'free_text';
                    // Dock the shared submit button to the right of the LAST
                    // clarify question's input (only when a text answer is in
                    // play; pure-choice panels auto-submit and need no button).
                    const isLast = questionIndex === questions.length - 1;
                    const fieldTrailing = (!isExplain && isLast && showPanelSubmit)
                        ? panelSubmitButton : undefined;
                    return (
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

                        {isFreeTextOnly ? (
                            // A free_text question is answered right here, with
                            // its own input directly beneath the text.
                            renderQuestionField(questionIndex, t('chartRec.freeTextClarificationPlaceholder'), fieldTrailing)
                        ) : (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {showChips && (question.options || []).length > 0 && (
                                    <>
                                        {isExplain && (
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
                                                const isSelected = selected?.source === 'option' && selected.answer === option.label;
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
                                    </>
                                )}
                                {/* single_choice questions also accept a typed
                                    answer (chips are shortcuts, not the only
                                    option). explain has no per-question freeform. */}
                                {!isExplain && renderQuestionField(questionIndex, t('chartRec.customAnswerPlaceholder'), fieldTrailing)}
                            </Box>
                        )}
                    </Box>
                    );
                })}
            </Box>

            {/* Footer. Explain keeps a row: panel-level custom-followup input +
                submit. Clarify docks its shared submit button inline to the
                right of the last question's input (above), so no footer row. */}
            {isExplain && (
                <Box sx={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    pl: '20px', pr: '4px', pb: '8px',
                }}>
                    {renderOverrideInput(t('chartRec.customAnswerPlaceholder'))}
                    <Tooltip title={t('chartRec.submitClarification')}>
                        <span>
                            <IconButton
                                size="small"
                                aria-label={t('chartRec.submitClarification')}
                                disabled={!canSubmit}
                                onClick={handlePanelSubmit}
                                sx={{
                                    width: 26, height: 26, flexShrink: 0,
                                    color: theme.palette.common.white,
                                    backgroundColor: canSubmit ? submitAccent : alpha(theme.palette.text.primary, 0.18),
                                    '&:hover': { backgroundColor: canSubmit ? alpha(submitAccent, 0.85) : alpha(theme.palette.text.primary, 0.18) },
                                    '&.Mui-disabled': { color: theme.palette.common.white, backgroundColor: alpha(theme.palette.text.primary, 0.18) },
                                }}
                            >
                                <ArrowForwardRoundedIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Box>
            )}
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
    /** Close: de-highlight the suggestion and switch focus to the previous chart. */
    onClose: () => void;
    /** Delete: remove this suggestion block. */
    onDelete: () => void;
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
    onClose,
    onDelete,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch();

    const handleHandoff = (prompt: string) => {
        const cleanPrompt = prompt.trim();
        if (!cleanPrompt) return;
        dispatch(dfActions.requestAgentHandoff({ target, prompt: cleanPrompt }));
        // Hand off — the user's attention moves to the target agent
        // and the data-agent run is done, so the suggestion block is removed.
        onDelete();
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
            closeTooltip={t('chartRec.pauseClose')}
            deleteTooltip={t('chartRec.pauseDelete')}
            onClose={onClose}
            onDelete={onDelete}
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

// ---------------------------------------------------------------------------
// ExplanationPanel
// ---------------------------------------------------------------------------

interface ExplanationPanelProps {
    /** The agent's plain-text answer (markdown) to display read-only. */
    content: string;
    /** Close: de-highlight the panel and switch focus to the previous chart. */
    onClose: () => void;
    /** Delete: remove this explanation block from the thread. */
    onDelete: () => void;
}

/**
 * Read-only display of a completed plain-text answer, surfaced above the
 * chat box when the user clicks that answer's collapsed trace in the data
 * thread. Reuses the `explain` pause chrome (primary accent + AgentToyIcon)
 * but carries no inputs or actions — it's purely "here's what I said",
 * dismissible by the header's delete button or by focusing another item.
 */
export const ExplanationPanel: FC<ExplanationPanelProps> = ({ content, onClose, onDelete }) => {
    const theme = useTheme();
    const { t } = useTranslation();

    return (
        <AgentPauseShell
            icon={<AgentToyIcon
                variant="explain"
                sx={{ fontSize: 16, color: theme.palette.primary.main }}
            />}
            accentColor={theme.palette.primary.main}
            title={t('chartRec.explanationTitle')}
            closeTooltip={t('chartRec.pauseClose')}
            deleteTooltip={t('chartRec.pauseDelete')}
            onClose={onClose}
            onDelete={onDelete}
        >
            <Box sx={{
                maxHeight: 'clamp(120px, 32vh, 360px)',
                overflowY: 'auto',
                pb: '8px', pl: '20px', pr: '8px',
                fontSize: 12,
            }}>
                <CompactMarkdown content={content} color={theme.palette.text.primary} />
            </Box>
        </AgentPauseShell>
    );
};
