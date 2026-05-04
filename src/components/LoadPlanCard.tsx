// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useState } from 'react';
import {
    Box, Button, Checkbox, Chip, CircularProgress, Collapse, Typography,
    alpha, useTheme,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StorageIcon from '@mui/icons-material/Storage';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../app/apiClient';
import { CONNECTOR_ACTION_URLS } from '../app/utils';
import { transition } from '../app/tokens';
import { DataFrameTable } from '../views/DataFrameTable';
import type { LoadPlan, LoadPlanCandidate } from './ComponentType';

interface LoadPlanCardProps {
    plan: LoadPlan;
    onConfirm: (selected: LoadPlanCandidate[]) => void;
    confirmed?: boolean;
}

interface PreviewState {
    loading: boolean;
    expanded: boolean;
    rows: Record<string, any>[];
    columns: string[];
    totalRows?: number;
    error?: string;
}

const buildImportOptions = (candidate: LoadPlanCandidate, size: number) => ({
    size,
    ...(candidate.filters?.length ? { source_filters: candidate.filters } : {}),
    ...(candidate.sortBy ? {
        sort_columns: [candidate.sortBy],
        sort_order: candidate.sortOrder,
    } : {}),
});

const formatFilterValue = (value: any) => {
    if (value === undefined || value === null || value === '') return '';
    return Array.isArray(value) ? value.join(', ') : String(value);
};

export const LoadPlanCard: React.FC<LoadPlanCardProps> = ({ plan, onConfirm, confirmed }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const [selection, setSelection] = useState<Record<number, boolean>>(
        () => Object.fromEntries(plan.candidates.map((_, i) => [i, true]))
    );
    const [loading, setLoading] = useState(false);
    const [previews, setPreviews] = useState<Record<number, PreviewState>>({});

    const toggleItem = (idx: number) => {
        setSelection(prev => ({ ...prev, [idx]: !prev[idx] }));
    };

    const selectedCount = Object.values(selection).filter(Boolean).length;

    const handlePreview = async (candidate: LoadPlanCandidate, idx: number) => {
        const current = previews[idx];
        if (current?.expanded && current.rows.length > 0) {
            setPreviews(prev => ({ ...prev, [idx]: { ...current, expanded: false } }));
            return;
        }
        if (current?.rows.length) {
            setPreviews(prev => ({ ...prev, [idx]: { ...current, expanded: true } }));
            return;
        }

        setPreviews(prev => ({
            ...prev,
            [idx]: { loading: true, expanded: true, rows: [], columns: [] },
        }));
        try {
            const { data } = await apiRequest<any>(CONNECTOR_ACTION_URLS.PREVIEW_DATA, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    connector_id: candidate.sourceId,
                    source_table: { id: candidate.sourceTable, name: candidate.displayName },
                    import_options: buildImportOptions(candidate, 10),
                }),
            });
            const columnNames = (data.columns || []).map((col: any) => typeof col === 'string' ? col : col.name).filter(Boolean);
            setPreviews(prev => ({
                ...prev,
                [idx]: {
                    loading: false,
                    expanded: true,
                    rows: data.rows || [],
                    columns: columnNames,
                    totalRows: data.total_row_count,
                },
            }));
        } catch (err: any) {
            setPreviews(prev => ({
                ...prev,
                [idx]: {
                    loading: false,
                    expanded: true,
                    rows: [],
                    columns: [],
                    error: err?.message || t('dataLoading.loadPlan.previewFailed'),
                },
            }));
        }
    };

    const handleConfirm = async () => {
        const selected = plan.candidates.filter((_, i) => selection[i]);
        if (selected.length === 0) return;
        setLoading(true);
        try {
            await onConfirm(selected);
        } finally {
            setLoading(false);
        }
    };

    const pillBg = confirmed
        ? alpha(theme.palette.success.main, 0.08)
        : alpha(theme.palette.primary.main, 0.04);

    return (
        <Box sx={{
            my: 1, p: 1.5,
            borderRadius: 2,
            border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
            bgcolor: pillBg,
            transition: transition.fast,
        }}>
            {/* Title */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                {confirmed
                    ? <CheckCircleIcon sx={{ fontSize: 15, color: 'success.main' }} />
                    : <StorageIcon sx={{ fontSize: 15, color: 'primary.main' }} />
                }
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: confirmed ? 'success.main' : 'text.primary' }}>
                    {confirmed ? t('dataLoading.loadPlan.loaded') : t('dataLoading.loadPlan.title')}
                </Typography>
            </Box>

            {/* Reasoning */}
            {plan.reasoning && (
                <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 1, lineHeight: 1.4 }}>
                    {plan.reasoning}
                </Typography>
            )}

            {/* Candidate list */}
            {plan.candidates.map((c, i) => {
                const preview = previews[i];
                return (
                <Box key={i} sx={{
                    py: 0.5, px: 0.5,
                    borderRadius: 1,
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) },
                }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {!confirmed && (
                            <Checkbox
                                size="small"
                                checked={!!selection[i]}
                                onChange={() => toggleItem(i)}
                                sx={{ p: 0.25 }}
                            />
                        )}
                        <Typography sx={{ fontSize: 12, fontWeight: 500, minWidth: 0 }} noWrap>
                            {c.displayName}
                        </Typography>
                        <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>
                            ({c.sourceId})
                        </Typography>
                        <Box sx={{ flex: 1 }} />
                        <Button
                            size="small"
                            variant="text"
                            disabled={preview?.loading}
                            onClick={() => handlePreview(c, i)}
                            sx={{ textTransform: 'none', fontSize: 10, py: 0, px: 0.75, minHeight: 0 }}
                        >
                            {preview?.loading ? t('dataLoading.loadPlan.previewing') : t('dataLoading.loadPlan.preview')}
                        </Button>
                    </Box>
                    {/* Filter/sort/limit details */}
                    <Box sx={{ pl: confirmed ? 0 : 3.5, mt: 0.25, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {c.filters?.length ? c.filters.map((f, fi) => (
                                <Chip key={fi}
                                    label={`${f.column} ${f.operator}${formatFilterValue(f.value) ? ` ${formatFilterValue(f.value)}` : ''}`}
                                    size="small" variant="outlined"
                                    sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.75 } }}
                                />
                            )) : (
                                <Chip
                                    label={t('dataLoading.loadPlan.noFilters')}
                                    size="small" variant="outlined"
                                    sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.75 } }}
                                />
                            )}
                            {c.sortBy && (
                                <Chip
                                    label={`${c.sortBy} ${c.sortOrder || 'asc'}`}
                                    size="small" variant="outlined"
                                    sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.75 } }}
                                />
                            )}
                            {c.rowLimit && (
                                <Chip
                                    label={`${t('dataLoading.loadPlan.rowLimit')}: ${c.rowLimit.toLocaleString()}`}
                                    size="small" variant="outlined"
                                    sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.75 } }}
                                />
                            )}
                    </Box>
                    <Collapse in={!!preview?.expanded}>
                        <Box sx={{ pl: confirmed ? 0 : 3.5, mt: 0.75 }}>
                            {preview?.loading ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                                    <CircularProgress size={14} />
                                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                                        {t('dataLoading.loadPlan.previewing')}
                                    </Typography>
                                </Box>
                            ) : preview?.error ? (
                                <Typography sx={{ fontSize: 11, color: 'error.main' }}>
                                    {preview.error}
                                </Typography>
                            ) : preview && preview.rows.length > 0 ? (
                                <DataFrameTable
                                    columns={preview.columns}
                                    rows={preview.rows}
                                    totalRows={preview.totalRows}
                                    maxRows={5}
                                    maxColumns={8}
                                    maxCellLength={18}
                                    fontSize={10.5}
                                    headerFontSize={10}
                                />
                            ) : preview ? (
                                <Typography sx={{ fontSize: 11, color: 'text.disabled', fontStyle: 'italic' }}>
                                    {t('connectorPreview.noMatchingRows')}
                                </Typography>
                            ) : null}
                        </Box>
                    </Collapse>
                </Box>
                );
            })}

            {/* Load button */}
            {!confirmed && (
                <Box sx={{ mt: 1 }}>
                    <Button
                        size="small"
                        variant="contained"
                        disabled={selectedCount === 0 || loading}
                        onClick={handleConfirm}
                        sx={{
                            textTransform: 'none', fontSize: 12,
                            py: 0.5, px: 2, minHeight: 0,
                            borderRadius: 1.5, boxShadow: 'none',
                        }}
                    >
                        {loading
                            ? '...'
                            : `${t('dataLoading.loadPlan.loadSelected')} (${selectedCount})`
                        }
                    </Button>
                </Box>
            )}
        </Box>
    );
};
