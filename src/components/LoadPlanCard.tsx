// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useState } from 'react';
import {
    Box, Button, Checkbox, Chip, Typography,
    alpha, useTheme,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../app/apiClient';
import { CONNECTOR_ACTION_URLS } from '../app/utils';
import { transition } from '../app/tokens';
import { TablePreviewRow, TablePreviewData } from './TablePreviewRow';
import type { LoadPlan, LoadPlanCandidate } from './ComponentType';

interface LoadPlanCardProps {
    plan: LoadPlan;
    onConfirm: (selected: LoadPlanCandidate[]) => void;
    confirmed?: boolean;
}

// Plans this small auto-expand each row's preview on first render so the
// user can see what they're loading without an extra click. Larger plans
// (4+) stay collapsed to avoid overwhelming the chat surface.
const AUTO_PREVIEW_THRESHOLD = 3;

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
        () => Object.fromEntries(plan.candidates.map((c, i) => [i, !c.resolutionError]))
    );
    const [loading, setLoading] = useState(false);
    // Auto-expand previews for small plans. We seed the map with empty
    // expanded entries; the actual data fetch happens lazily inside the
    // Collapse's first paint via the same code path as a manual click.
    const shouldAutoPreview = plan.candidates.length <= AUTO_PREVIEW_THRESHOLD;
    const [previews, setPreviews] = useState<Record<number, PreviewState>>(() => {
        if (!shouldAutoPreview) return {};
        const seed: Record<number, PreviewState> = {};
        plan.candidates.forEach((c, i) => {
            if (!c.resolutionError) {
                seed[i] = { loading: false, expanded: true, rows: [], columns: [] };
            }
        });
        return seed;
    });

    const toggleItem = (idx: number) => {
        setSelection(prev => ({ ...prev, [idx]: !prev[idx] }));
    };

    const selectedCount = Object.values(selection).filter(Boolean).length;

    const fetchPreview = React.useCallback(async (candidate: LoadPlanCandidate, idx: number) => {
        setPreviews(prev => ({
            ...prev,
            [idx]: { ...(prev[idx] || { rows: [], columns: [] }), loading: true, expanded: true },
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
    }, [t]);

    // Kick off auto-preview fetches once on mount. We don't await — each
    // row paints its loading state and resolves independently.
    React.useEffect(() => {
        if (!shouldAutoPreview) return;
        plan.candidates.forEach((c, i) => {
            if (!c.resolutionError) {
                fetchPreview(c, i);
            }
        });
        // Intentionally run once; the plan doesn't mutate after mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handlePreview = (candidate: LoadPlanCandidate, idx: number) => {
        const current = previews[idx];
        // Toggle if we already have data or are currently fetching.
        if (current?.expanded) {
            setPreviews(prev => ({ ...prev, [idx]: { ...current, expanded: false } }));
            return;
        }
        if (current?.rows.length) {
            setPreviews(prev => ({ ...prev, [idx]: { ...current, expanded: true } }));
            return;
        }
        fetchPreview(candidate, idx);
    };

    const handleConfirm = async () => {
        const selected = plan.candidates.filter((c, i) => selection[i] && !c.resolutionError);
        if (selected.length === 0) return;
        setLoading(true);
        try {
            await onConfirm(selected);
        } finally {
            setLoading(false);
        }
    };

    // Whether all candidates resolve to a single source — used to decide
    // if the per-row source label is informative or just redundant.
    const sources = new Set(plan.candidates.map(c => c.sourceId));
    const showSourceLabel = sources.size > 1;
    const sharedSourceId = sources.size === 1 ? plan.candidates[0].sourceId : undefined;

    const isDark = theme.palette.mode === 'dark';
    const borderColorBase = confirmed
        ? alpha(theme.palette.success.main, 0.3)
        : alpha(theme.palette.primary.main, isDark ? 0.25 : 0.15);
    const borderColorHover = confirmed
        ? alpha(theme.palette.success.main, 0.45)
        : alpha(theme.palette.primary.main, isDark ? 0.4 : 0.3);
    const shadowBase = isDark
        ? '0 1px 2px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.2)'
        : '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03)';
    const shadowHover = isDark
        ? '0 2px 4px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.3)'
        : '0 2px 4px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04)';

    return (
        <Box sx={{
            my: 0.75,
            p: 1,
            border: `1px solid ${borderColorBase}`,
            borderRadius: 1.5,
            boxShadow: shadowBase,
            transition: transition.fast,
            '&:hover': {
                borderColor: borderColorHover,
                boxShadow: shadowHover,
            },
        }}>
            {/* Candidate list */}
            {plan.candidates.map((c, i) => {
                const preview = previews[i];
                const unresolved = !!c.resolutionError;
                const hasFilters = !unresolved && (!!c.filters?.length || !!c.sortBy);

                const previewData: TablePreviewData =
                    unresolved ? { state: 'idle' }
                    : preview?.loading ? { state: 'loading' }
                    : preview?.error ? { state: 'error', error: preview.error }
                    : preview ? { state: 'ready', columns: preview.columns, rows: preview.rows, totalRows: preview.totalRows }
                    : { state: 'idle' };

                return (
                    <TablePreviewRow
                        key={i}
                        name={c.displayName}
                        leading={confirmed
                            ? <CheckIcon sx={{ fontSize: 16, color: 'success.main', mx: 0.25 }} />
                            : <Checkbox size="small" checked={!!selection[i]} disabled={unresolved}
                                onChange={() => toggleItem(i)} sx={{ p: 0.25 }} />}
                        trailing={showSourceLabel
                            ? <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>({c.sourceId})</Typography>
                            : undefined}
                        filterChips={hasFilters ? (
                            <>
                                {c.filters?.map((f, fi) => (
                                    <Chip key={fi}
                                        label={`${f.column} ${f.operator}${formatFilterValue(f.value) ? ` ${formatFilterValue(f.value)}` : ''}`}
                                        size="small" variant="outlined"
                                        sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.75 } }} />
                                ))}
                                {c.sortBy && (
                                    <Chip label={`${c.sortBy} ${c.sortOrder || 'asc'}`}
                                        size="small" variant="outlined"
                                        sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.75 } }} />
                                )}
                            </>
                        ) : undefined}
                        preview={previewData}
                        expanded={!!preview?.expanded}
                        onTogglePreview={unresolved ? undefined : () => handlePreview(c, i)}
                        dim={unresolved}
                        unresolved={unresolved ? {
                            message: t('dataLoading.loadPlan.unresolved', {
                                defaultValue: "Couldn't resolve this table — the agent should rerun search and try again.",
                            }),
                            detail: c.resolutionError,
                        } : undefined}
                    />
                );
            })}

            {/* Footer: action button (unconfirmed) or quiet caption (confirmed).
                When every candidate shares one source, surface it once down
                here instead of duplicating it on each row. */}
            <Box sx={{ mt: 0.75, display: 'flex', alignItems: 'center', gap: 1 }}>
                {!showSourceLabel && sharedSourceId && (
                    <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>
                        {t('dataLoading.loadPlan.fromSource', { defaultValue: 'from' })} {sharedSourceId}
                    </Typography>
                )}
                <Box sx={{ flex: 1 }} />
                {confirmed ? (
                    <Typography sx={{ fontSize: 11, color: 'success.main', fontWeight: 500 }}>
                        {t('dataLoading.loadPlan.loadedCount', {
                            count: plan.candidates.filter(c => !c.resolutionError).length,
                            defaultValue: '✓ Loaded',
                        })}
                    </Typography>
                ) : (
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
                )}
            </Box>
        </Box>
    );
};

