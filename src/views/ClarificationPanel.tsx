import React, { FC, useEffect, useRef, useState } from 'react';
import { Box, Collapse, IconButton, Tooltip, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import { useTranslation } from 'react-i18next';
import {
    ClarificationQuestion,
    ClarificationResponse,
} from '../components/ComponentType';
import { renderFieldHighlights } from './InteractionEntryCard';

interface ClarificationPanelProps {
    questions: ClarificationQuestion[];
    /**
     * 'clarify' (default) — agent is asking the user a question (warning palette).
     * 'explain'           — agent gave an answer; options are suggested chart
     *                       follow-ups the user can click (info palette).
     *
     * Both variants share the same simplified layout: a small header with a
     * close (×) icon, the question/explanation text, and clickable options.
     * Long-form replies happen in the main chat box below the panel.
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
    // Local minimize state — collapses the panel to a single header row
    // (still visible so the user can come back and answer). Distinct from
    // dismiss/cancel (the X icon) which actually drops the pause.
    const [minimized, setMinimized] = useState(false);

    // Reset minimize whenever the underlying questions change so a brand-new
    // clarify pause shows up expanded by default.
    useEffect(() => { setMinimized(false); }, [questions]);

    const submitResponses = (responses: ClarificationResponse[]) => {
        if (responses.length === 0 || submittedRef.current) return;
        submittedRef.current = true;
        onSubmit(responses);
    };

    /**
     * Handle a single answer (option click or free-text Enter). When the
     * parent provides `onSelectAnswer`, the panel defers to it and the
     * parent decides when to actually submit (e.g. after all questions
     * have been answered). Otherwise we fall back to the legacy "click =
     * submit immediately" behavior.
     */
    const handleAnswer = (response: ClarificationResponse) => {
        if (onSelectAnswer) {
            onSelectAnswer(response.question_index, response);
            return;
        }
        submitResponses([response]);
    };

    useEffect(() => {
        submittedRef.current = false;
    }, [questions]);

    // Variant-specific styling. Explain uses the info palette; clarify uses warning.
    const isExplain = variant === 'explain';
    const accentColor = isExplain ? theme.palette.info.main : theme.palette.warning.main;
    const headerKey = isExplain ? 'chartRec.explanationTitle' : 'chartRec.clarificationTitle';

    return (
        <Box sx={{
            display: 'flex', flexDirection: 'column',
            px: 0.5, pt: 0,
            borderBottom: `1px solid ${alpha(accentColor, 0.2)}`,
            backgroundColor: alpha(accentColor, 0.05),
            // Inset slightly under the parent Card's gradient border (1.5px
            // stroke + 8px outer radius) so corners visually align.
            borderRadius: '6.5px 6.5px 0 0',
            mx: '-8px', mt: '-4px', mb: '4px',
        }}>
                <Box
                onClick={() => setMinimized(prev => !prev)}
                sx={{
                    display: 'flex', alignItems: 'center', gap: '6px', minHeight: 16,
                    cursor: 'pointer',
                    // Stretch hover background to the panel's full content
                    // width by extending past the parent's px: 0.5 padding,
                    // then re-add it on the inside.
                    px: 0.5, mx: -0.5, py: '6px',
                    '&:hover': { backgroundColor: alpha(accentColor, 0.06) },
                }}
            >
                <SmartToyOutlinedIcon sx={{
                    fontSize: 14,
                    color: minimized ? theme.palette.text.disabled : accentColor,
                    flexShrink: 0,
                }} />
                {minimized ? (
                    // Collapsed header: muted variant label + a short preview of
                    // the first question/explanation so the user keeps context.
                    <Box sx={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '6px',
                        minWidth: 0,
                    }}>
                        <Typography sx={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: theme.palette.text.disabled,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            flexShrink: 0,
                        }}>
                            {t(headerKey)}
                        </Typography>
                        <Typography sx={{
                            fontSize: 11,
                            color: theme.palette.text.secondary,
                            fontStyle: 'italic',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            minWidth: 0,
                            flex: 1,
                        }}>
                            {(questions[0]?.text || '').slice(0, 120)}
                        </Typography>
                    </Box>
                ) : (
                    <Typography sx={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: theme.palette.text.primary,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        flex: 1,
                    }}>
                        {t(headerKey)}
                    </Typography>
                )}
                <Tooltip title={t('chartRec.cancelClarification')}>
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
                <Tooltip title={t(minimized ? 'chartRec.expandClarification' : 'chartRec.minimizeClarification')}>
                    <IconButton
                        size="small"
                        // The whole header row is clickable to toggle; this
                        // dedicated button just provides the affordance and a
                        // tooltip. stopPropagation isn't needed since both
                        // handlers do the same thing.
                        sx={{
                            p: 0, width: 16, height: 16,
                            color: theme.palette.text.secondary,
                            '&:hover': { color: accentColor },
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
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px', pb: '8px' }}>
                {questions.map((question, questionIndex) => (
                <Box key={questionIndex} sx={{ display: 'flex', flexDirection: 'column', gap: '4px', pl: '20px' }}>
                    <Typography component="div" sx={{ fontSize: 12, color: theme.palette.text.primary, lineHeight: 1.5 }}>
                        {!isExplain && questions.length > 1 && (
                            <>
                                {t('chartRec.clarificationQuestionLabel', { index: questionIndex + 1 })}{' '}
                            </>
                        )}
                        {renderFieldHighlights(question.text, alpha(accentColor, 0.06))}
                    </Typography>

                    {question.responseType === 'free_text' ? (
                        // Free-text questions don't render their own input.
                        // The user types the answer in the main chat box
                        // below and hits Send (or Enter). We show a small
                        // hint so the affordance is clear.
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
                                            // Click records the answer for this question. When a parent
                                            // provides `onSelectAnswer`, the panel does NOT submit on
                                            // each click — the parent accumulates answers and submits
                                            // once all questions have been answered (or the user types
                                            // and sends from the main chat box).
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
                                                // Inline-block so options can flex-wrap and size to content.
                                                // Long labels still wrap inside the button if needed.
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
                                            {option.label}
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
            </Collapse>
        </Box>
    );
};
