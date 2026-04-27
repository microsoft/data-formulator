// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * SaveExperienceButton — a button that distills the current result's
 * user-visible analysis context into a reusable experience document.
 *
 * Placed on result cards after successful DataAgent analyses.
 */

import React, { useState, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    CircularProgress,
    Typography,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';

import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { distillExperience, type ExperienceContext } from '../api/knowledgeApi';
import type { DictTable } from '../components/ComponentType';

export interface SaveExperienceButtonProps {
    table: DictTable;
    /** If true, render as a full button. Otherwise a small icon button. */
    variant?: 'button' | 'icon';
}

function buildExperienceContext(table: DictTable): ExperienceContext | null {
    const derive = table.derive;
    if (!derive) return null;

    const interaction = derive.trigger.interaction || [];
    const userQuestion = interaction.find(
        e => e.from === 'user' && e.role === 'prompt',
    )?.content || '';
    if (!userQuestion) return null;

    const instruction = interaction.find(
        e => e.from === 'data-agent' && e.role === 'instruction',
    );
    const chart = derive.trigger.chart as any;

    return {
        context_id: table.id,
        source_table_id: derive.trigger.tableId,
        user_question: userQuestion,
        dialog: derive.dialog || [],
        interaction,
        result_summary: {
            display_instruction: instruction?.displayContent || instruction?.content,
            output_variable: derive.outputVariable,
            source_tables: derive.source,
            output_fields: table.names,
            output_rows: table.virtual?.rowCount ?? table.rows?.length,
            chart_type: chart?.mark || chart?.chartType || chart?.chart_type,
            code: derive.code,
        },
        execution_attempts: derive.executionAttempts || [],
    };
}

export const SaveExperienceButton: React.FC<SaveExperienceButtonProps> = ({
    table,
    variant = 'button',
}) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const selectedModelId = useSelector((s: DataFormulatorState) => s.selectedModelId);
    const allModels = useSelector((s: DataFormulatorState) => [...s.globalModels, ...s.models]);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [categoryHint, setCategoryHint] = useState('');
    const [distilling, setDistilling] = useState(false);

    const selectedModel = allModels.find(m => m.id === selectedModelId);

    const handleDistill = useCallback(async () => {
        const experienceContext = buildExperienceContext(table);
        if (!experienceContext || !selectedModel) return;
        setDistilling(true);
        try {
            const modelConfig = {
                endpoint: selectedModel.endpoint,
                key: selectedModel.key,
                model: selectedModel.model,
                provider: (selectedModel as any).provider,
            };
            await distillExperience(experienceContext, modelConfig, categoryHint.trim() || undefined);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'success',
                component: 'knowledge',
                value: t('knowledge.distilled'),
            }));
            window.dispatchEvent(new CustomEvent('knowledge-changed', { detail: { category: 'experiences' } }));
            setDialogOpen(false);
        } catch {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'knowledge',
                value: t('knowledge.failedToDistill'),
            }));
        } finally {
            setDistilling(false);
        }
    }, [table, selectedModel, categoryHint, dispatch, t]);

    if (!buildExperienceContext(table)) return null;

    return (
        <>
            <Button
                size="small"
                startIcon={<AutoFixHighIcon sx={{ fontSize: 14 }} />}
                onClick={() => setDialogOpen(true)}
                sx={{
                    textTransform: 'none',
                    fontSize: 10,
                    py: 0.25,
                    px: 0.75,
                    color: 'text.secondary',
                    '&:hover': { color: 'primary.main' },
                }}
            >
                {t('knowledge.saveAsExperience')}
            </Button>

            <Dialog
                open={dialogOpen}
                onClose={() => { if (!distilling) setDialogOpen(false); }}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle sx={{ fontSize: 15, pb: 0.5 }}>
                    {t('knowledge.saveAsExperienceTitle')}
                </DialogTitle>
                <DialogContent>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>
                        {t('knowledge.saveAsExperienceHint')}
                    </Typography>
                    <TextField
                        size="small"
                        fullWidth
                        label={t('knowledge.categoryHint')}
                        placeholder={t('knowledge.categoryHintPlaceholder')}
                        value={categoryHint}
                        onChange={(e) => setCategoryHint(e.target.value)}
                        sx={{ '& .MuiInputBase-input': { fontSize: 12 } }}
                        slotProps={{ inputLabel: { sx: { fontSize: 12 } } }}
                    />
                    {!selectedModel && (
                        <Typography sx={{ fontSize: 11, color: 'error.main', mt: 1 }}>
                            {t('report.noModelSelected')}
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setDialogOpen(false)}
                        disabled={distilling}
                        sx={{ textTransform: 'none', fontSize: 12 }}
                    >
                        {t('app.cancel')}
                    </Button>
                    <Button
                        onClick={handleDistill}
                        disabled={distilling || !selectedModel}
                        variant="contained"
                        sx={{ textTransform: 'none', fontSize: 12 }}
                    >
                        {distilling ? (
                            <>
                                <CircularProgress size={14} sx={{ mr: 0.5 }} />
                                {t('knowledge.distilling')}
                            </>
                        ) : t('knowledge.save')}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
