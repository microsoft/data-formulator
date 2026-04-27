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
    tables: DictTable[];
    /** If true, render as a full button. Otherwise a small icon button. */
    variant?: 'button' | 'icon';
}

/**
 * True leaf: derived table with no un-anchored children deriving from it.
 * Layout-promoted "extra leaves" in DataThread still have children, so they
 * won't pass this check.
 */
export function isLeafDerivedTable(table: DictTable, tables: DictTable[]): boolean {
    if (!table.derive) return false;
    return !tables.some(
        t => t.derive?.trigger.tableId === table.id && !t.anchored,
    );
}

/**
 * Walk the visible chain from `leaf` back to the root source table,
 * collecting only tables that still exist in `tables`.
 * Returns the chain ordered root-first.
 */
function walkVisibleChain(leaf: DictTable, tables: DictTable[]): DictTable[] {
    const chain: DictTable[] = [leaf];
    const visited = new Set<string>([leaf.id]);
    let current = leaf;
    while (current.derive) {
        const parentId = current.derive.trigger.tableId;
        if (visited.has(parentId)) break;
        visited.add(parentId);
        const parent = tables.find(t => t.id === parentId);
        if (!parent) break;
        chain.push(parent);
        if (!parent.derive) break;
        current = parent;
    }
    chain.reverse();
    return chain;
}

export function buildExperienceContext(
    table: DictTable,
    tables: DictTable[],
): ExperienceContext | null {
    const derive = table.derive;
    if (!derive) return null;

    const chain = walkVisibleChain(table, tables);

    const allInteraction = chain.flatMap(
        t => t.derive?.trigger.interaction || [],
    );
    const userEntry = allInteraction.find(
        e => e.from === 'user' && e.role === 'prompt',
    ) || allInteraction.find(
        e => e.from === 'user',
    );
    const userQuestion = userEntry?.content || '';
    if (!userQuestion) return null;

    const allDialog = chain.flatMap(t => t.derive?.dialog || []);

    const instruction = allInteraction.find(
        e => e.from === 'data-agent' && e.role === 'instruction',
    );
    const chart = derive.trigger.chart as any;

    return {
        context_id: table.id,
        source_table_id: derive.trigger.tableId,
        user_question: userQuestion,
        dialog: allDialog,
        interaction: allInteraction,
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
    tables,
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
        const experienceContext = buildExperienceContext(table, tables);
        if (!experienceContext || !selectedModel) return;
        setDistilling(true);
        try {
            const modelConfig = {
                endpoint: selectedModel.endpoint,
                api_key: selectedModel.api_key,
                model: selectedModel.model,
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
    }, [table, tables, selectedModel, categoryHint, dispatch, t]);

    if (!buildExperienceContext(table, tables)) return null;

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
