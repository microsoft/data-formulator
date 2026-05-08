import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
import { Box, IconButton, TextField, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import {
    ClarificationQuestion,
    ClarificationResponse,
} from '../components/ComponentType';
import { renderFieldHighlights } from './InteractionEntryCard';

interface ClarificationPanelProps {
    questions: ClarificationQuestion[];
    autoSelectQuestionId?: string;
    autoSelectOptionId?: string;
    autoSelectTimeoutMs?: number;
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
    onSubmit: (responses: ClarificationResponse[]) => void;
    onCancel: () => void;
}

export const ClarificationPanel: FC<ClarificationPanelProps> = ({
    questions,
    autoSelectQuestionId,
    autoSelectOptionId,
    autoSelectTimeoutMs,
    variant = 'clarify',
    onSubmit,
    onCancel,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
    const [autoProgress, setAutoProgress] = useState(1);
    const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
    const submittedRef = useRef(false);

    const autoOption = useMemo(() => {
        if (!autoSelectQuestionId || !autoSelectOptionId) return null;
        const question = questions.find(q => q.id === autoSelectQuestionId);
        const option = question?.options?.find(o => o.id === autoSelectOptionId);
        return question && option ? { question, option } : null;
    }, [autoSelectOptionId, autoSelectQuestionId, questions]);

    const submitResponses = (responses: ClarificationResponse[]) => {
        if (responses.length === 0 || submittedRef.current) return;
        submittedRef.current = true;
        onSubmit(responses);
    };

    useEffect(() => {
        submittedRef.current = false;
    }, [questions]);

    useEffect(() => {
        if (!autoOption || !autoSelectTimeoutMs) {
            setAutoProgress(1);
            setSecondsRemaining(null);
            return;
        }

        const startedAt = Date.now();
        const timer = window.setInterval(() => {
            const elapsed = Date.now() - startedAt;
            const remaining = Math.max(autoSelectTimeoutMs - elapsed, 0);
            setAutoProgress(remaining / autoSelectTimeoutMs);
            setSecondsRemaining(Math.ceil(remaining / 1000));
            if (remaining <= 0) {
                window.clearInterval(timer);
                submitResponses([{
                    question_id: autoOption.question.id,
                    answer: autoOption.option.label,
                    option_id: autoOption.option.id,
                    source: 'option',
                }]);
            }
        }, 250);

        return () => window.clearInterval(timer);
    }, [autoOption, autoSelectTimeoutMs]);

    // Variant-specific styling. Explain uses the info palette; clarify uses warning.
    const isExplain = variant === 'explain';
    const accentColor = isExplain ? theme.palette.info.main : theme.palette.warning.main;
    const headerKey = isExplain ? 'chartRec.explanationTitle' : 'chartRec.clarificationTitle';

    return (
        <Box sx={{
            display: 'flex', flexDirection: 'column', gap: '4px',
            px: 0.5, py: '8px',
            borderBottom: `1px solid ${alpha(accentColor, 0.2)}`,
            backgroundColor: alpha(accentColor, 0.05),
            borderRadius: '8px 8px 0 0',
            mx: '-8px', mt: '-4px', mb: '4px',
        }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', minHeight: 16 }}>
                <SmartToyOutlinedIcon sx={{ fontSize: 14, color: accentColor, flexShrink: 0 }} />
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
                <IconButton
                    size="small"
                    onClick={onCancel}
                    sx={{
                        ml: 'auto', p: 0, width: 16, height: 16,
                        color: theme.palette.text.secondary,
                        '&:hover': { color: theme.palette.error.main },
                    }}
                >
                    <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
            </Box>

            {questions.map((question, questionIndex) => (
                <Box key={question.id} sx={{ display: 'flex', flexDirection: 'column', gap: '4px', pl: '20px' }}>
                    <Typography component="div" sx={{ fontSize: 12, color: theme.palette.text.primary, lineHeight: 1.5 }}>
                        {!isExplain && questions.length > 1 && (
                            <>
                                {t('chartRec.clarificationQuestionLabel', { index: questionIndex + 1 })}{' '}
                            </>
                        )}
                        {renderFieldHighlights(question.text, alpha(accentColor, 0.06))}
                    </Typography>

                    {question.responseType === 'free_text' ? (
                        <TextField
                            size="small"
                            value={textAnswers[question.id] || ''}
                            onChange={(event) => setTextAnswers(prev => ({ ...prev, [question.id]: event.target.value }))}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    const value = (textAnswers[question.id] || '').trim();
                                    if (value) {
                                        event.preventDefault();
                                        submitResponses([{
                                            question_id: question.id,
                                            answer: value,
                                            source: 'free_text',
                                        }]);
                                    }
                                }
                            }}
                            placeholder={t('chartRec.freeTextClarificationPlaceholder')}
                            multiline
                            minRows={1}
                            maxRows={3}
                            sx={{ '& .MuiInputBase-input': { fontSize: 11 } }}
                        />
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
                            {(question.options || []).map(option => {
                                const isAutoOption = autoOption?.question.id === question.id && autoOption?.option.id === option.id;
                                return (
                                    <Box key={option.id || option.label} sx={{ position: 'relative', maxWidth: '100%', overflow: 'hidden', borderRadius: '6px' }}>
                                        {isAutoOption && secondsRemaining != null && (
                                            <Box sx={{
                                                position: 'absolute',
                                                left: 0,
                                                right: 0,
                                                bottom: 0,
                                                height: 3,
                                                transformOrigin: 'left center',
                                                transform: `scaleX(${autoProgress})`,
                                                background: `linear-gradient(90deg, ${theme.palette.primary.dark}, ${theme.palette.primary.main})`,
                                                borderRadius: '0 0 6px 6px',
                                                pointerEvents: 'none',
                                                zIndex: 2,
                                            }} />
                                        )}
                                        <Typography
                                            component="button"
                                            type="button"
                                            // Click immediately submits — single-question is the only
                                            // shape we emit now (multi-question clarify is rare and
                                            // can also be answered via the main chat box).
                                            onClick={() => submitResponses([{
                                                question_id: question.id,
                                                answer: option.label,
                                                option_id: option.id,
                                                source: 'option',
                                            }])}
                                            sx={{
                                                position: 'relative', zIndex: 1,
                                                px: '8px', py: '4px',
                                                borderRadius: '6px',
                                                border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
                                                backgroundColor: theme.palette.background.paper,
                                                cursor: 'pointer',
                                                fontSize: 11,
                                                // Allow long labels to wrap gracefully instead of overflowing.
                                                display: 'block',
                                                maxWidth: '100%',
                                                whiteSpace: 'normal',
                                                wordBreak: 'break-word',
                                                lineHeight: 1.4,
                                                color: theme.palette.text.primary,
                                                textAlign: 'left',
                                                fontFamily: theme.typography.fontFamily,
                                                '&:hover': { backgroundColor: alpha(accentColor, 0.08) },
                                            }}
                                        >
                                            {option.label}
                                            {isAutoOption && secondsRemaining != null && (
                                                <Typography component="span" sx={{ ml: 0.5, fontSize: 10, color: theme.palette.text.secondary }}>
                                                    {t('chartRec.autoContinueCountdown', { seconds: secondsRemaining })}
                                                </Typography>
                                            )}
                                        </Typography>
                                    </Box>
                                );
                            })}
                        </Box>
                    )}
                </Box>
            ))}
        </Box>
    );
};
