// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * SaveExperienceButton — a button that distills the current session's
 * reasoning log into a reusable experience document via the backend.
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
import { distillExperience } from '../api/knowledgeApi';

export interface SaveExperienceButtonProps {
    userQuestion: string;
    /** Defaults to the active workspace id */
    sessionId?: string;
    /** If true, render as a full button. Otherwise a small icon button. */
    variant?: 'button' | 'icon';
}

export const SaveExperienceButton: React.FC<SaveExperienceButtonProps> = ({
    userQuestion,
    sessionId: explicitSessionId,
    variant = 'button',
}) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const workspaceId = useSelector((s: DataFormulatorState) => s.activeWorkspace?.id);
    const selectedModelId = useSelector((s: DataFormulatorState) => s.selectedModelId);
    const allModels = useSelector((s: DataFormulatorState) => [...s.globalModels, ...s.models]);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [categoryHint, setCategoryHint] = useState('');
    const [distilling, setDistilling] = useState(false);

    const sessionId = explicitSessionId || workspaceId;

    const selectedModel = allModels.find(m => m.id === selectedModelId);

    const handleDistill = useCallback(async () => {
        if (!sessionId || !selectedModel) return;
        setDistilling(true);
        try {
            const modelConfig = {
                endpoint: selectedModel.endpoint,
                key: selectedModel.key,
                model: selectedModel.model,
                provider: (selectedModel as any).provider,
            };
            await distillExperience(sessionId, userQuestion, modelConfig, categoryHint.trim() || undefined);
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
    }, [sessionId, selectedModel, userQuestion, categoryHint, dispatch, t]);

    if (!sessionId) return null;

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
