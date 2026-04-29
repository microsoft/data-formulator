import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, TextField, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
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
    onSubmit: (responses: ClarificationResponse[]) => void;
    onCancel: () => void;
}

export const ClarificationPanel: FC<ClarificationPanelProps> = ({
    questions,
    autoSelectQuestionId,
    autoSelectOptionId,
    autoSelectTimeoutMs,
    onSubmit,
    onCancel,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const [selected, setSelected] = useState<Record<string, ClarificationResponse>>({});
    const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
    const [freeform, setFreeform] = useState('');
    const [autoProgress, setAutoProgress] = useState(1);
    const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
    const submittedRef = useRef(false);

    const autoOption = useMemo(() => {
        if (!autoSelectQuestionId || !autoSelectOptionId) return null;
        const question = questions.find(q => q.id === autoSelectQuestionId);
        const option = question?.options?.find(o => o.id === autoSelectOptionId);
        return question && option ? { question, option } : null;
    }, [autoSelectOptionId, autoSelectQuestionId, questions]);

    const buildStructuredResponses = () => {
        const trimmedFreeform = freeform.trim();
        if (trimmedFreeform) {
            return [{
                question_id: '__freeform__',
                answer: trimmedFreeform,
                source: 'freeform' as const,
            }];
        }

        const responses: ClarificationResponse[] = [];
        for (const question of questions) {
            const selectedResponse = selected[question.id];
            if (selectedResponse) {
                responses.push(selectedResponse);
                continue;
            }

            const textAnswer = (textAnswers[question.id] || '').trim();
            if (textAnswer) {
                responses.push({
                    question_id: question.id,
                    answer: textAnswer,
                    source: 'free_text',
                });
            }
        }
        return responses;
    };

    const requiredQuestionIds = questions
        .filter(question => question.required !== false)
        .map(question => question.id);
    const canSubmit = freeform.trim().length > 0 || requiredQuestionIds.every(questionId =>
        selected[questionId] || (textAnswers[questionId] || '').trim().length > 0
    );

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

    return (
        <Box sx={{
            display: 'flex', flexDirection: 'column', gap: '8px',
            px: 0.5, py: '8px',
            borderBottom: `1px solid ${alpha(theme.palette.warning.main, 0.2)}`,
            backgroundColor: alpha(theme.palette.warning.main, 0.05),
            borderRadius: '8px 8px 0 0',
            mx: '-8px', mt: '-4px', mb: '4px',
        }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <SmartToyOutlinedIcon sx={{ fontSize: 14, color: theme.palette.warning.main, flexShrink: 0 }} />
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: theme.palette.text.primary }}>
                    {t('chartRec.clarificationTitle')}
                </Typography>
            </Box>

            {questions.map((question, questionIndex) => (
                <Box key={question.id} sx={{ display: 'flex', flexDirection: 'column', gap: '4px', pl: '20px' }}>
                    <Typography component="div" sx={{ fontSize: 12, color: theme.palette.text.primary, lineHeight: 1.4 }}>
                        {t('chartRec.clarificationQuestionLabel', { index: questionIndex + 1 })}{' '}
                        {renderFieldHighlights(question.text, alpha(theme.palette.warning.main, 0.12))}
                        {question.required === false && (
                            <Typography component="span" sx={{ ml: 0.5, fontSize: 10, color: theme.palette.text.secondary }}>
                                {t('chartRec.optionalClarification')}
                            </Typography>
                        )}
                    </Typography>

                    {question.responseType === 'free_text' ? (
                        <TextField
                            size="small"
                            value={textAnswers[question.id] || ''}
                            onChange={(event) => setTextAnswers(prev => ({ ...prev, [question.id]: event.target.value }))}
                            placeholder={t('chartRec.freeTextClarificationPlaceholder')}
                            multiline
                            minRows={1}
                            maxRows={3}
                            sx={{ '& .MuiInputBase-input': { fontSize: 11 } }}
                        />
                    ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {(question.options || []).map(option => {
                                const isSelected = selected[question.id]?.option_id === option.id;
                                const isAutoOption = autoOption?.question.id === question.id && autoOption?.option.id === option.id;
                                return (
                                    <Box key={option.id || option.label} sx={{ position: 'relative', width: 'fit-content', overflow: 'hidden', borderRadius: '6px' }}>
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
                                            onClick={() => {
                                                const response = {
                                                    question_id: question.id,
                                                    answer: option.label,
                                                    option_id: option.id,
                                                    source: 'option' as const,
                                                };
                                                if (questions.length === 1) {
                                                    submitResponses([response]);
                                                    return;
                                                }
                                                setSelected(prev => ({ ...prev, [question.id]: response }));
                                            }}
                                            sx={{
                                                position: 'relative', zIndex: 1,
                                                px: '8px', py: '4px',
                                                borderRadius: '6px',
                                                border: `1px solid ${isSelected ? alpha(theme.palette.primary.main, 0.65) : alpha(theme.palette.text.primary, 0.12)}`,
                                                backgroundColor: isSelected ? alpha(theme.palette.primary.main, 0.08) : theme.palette.background.paper,
                                                cursor: 'pointer',
                                                fontSize: 11,
                                                width: 'fit-content',
                                                lineHeight: 1.4,
                                                color: theme.palette.text.primary,
                                                textAlign: 'left',
                                                fontFamily: 'inherit',
                                                '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.06) },
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

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px', pl: '20px' }}>
                <Typography sx={{ fontSize: 11, color: theme.palette.text.secondary }}>
                    {t('chartRec.directClarificationLabel')}
                </Typography>
                <TextField
                    size="small"
                    value={freeform}
                    onChange={(event) => setFreeform(event.target.value)}
                    placeholder={t('chartRec.directClarificationPlaceholder')}
                    multiline
                    minRows={1}
                    maxRows={3}
                    sx={{ '& .MuiInputBase-input': { fontSize: 11 } }}
                />
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', pl: '20px' }}>
                <Button size="small" onClick={onCancel} sx={{ fontSize: 11, minHeight: 24 }}>
                    {t('chartRec.cancelClarification')}
                </Button>
                <Button
                    size="small"
                    variant="contained"
                    disabled={!canSubmit}
                    onClick={() => submitResponses(buildStructuredResponses())}
                    sx={{ fontSize: 11, minHeight: 24 }}
                >
                    {t('chartRec.submitClarification')}
                </Button>
            </Box>
        </Box>
    );
};
