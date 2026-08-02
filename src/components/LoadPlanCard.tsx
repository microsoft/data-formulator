// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useState } from 'react';
import {
    Box, Button, Checkbox, Chip, CircularProgress, Tooltip, Typography,
    alpha, useTheme,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../app/apiClient';
import { CONNECTOR_ACTION_URLS } from '../app/utils';
import { getConnectorIcon } from '../icons';
import { transition } from '../app/tokens';
import { TablePreviewRow, TablePreviewData } from './TablePreviewRow';
import { formatFilterChipLabel } from './filterFormat';
import type { LoadPlan, LoadPlanCandidate, PendingTableLoad } from './ComponentType';

interface LoadPlanCardProps {
    plan: LoadPlan;
    onConfirm: (selected: LoadPlanCandidate[], opts?: { newWorkspace?: boolean }) => void;
    confirmed?: boolean;
    /** When true, a workspace with existing data is already open, so the
     *  destination of the load is ambiguous. We then offer two explicit
     *  actions: add to the current workspace, or load into a fresh one.
     *  When false (empty/new workspace), a single "Load selected" button
     *  loads directly with no ambiguity. */
    canLoadInNewWorkspace?: boolean;
}

// Reserve a stable area while a remote preview request is in flight. Resolved
// previews return to natural height: five data rows plus a quiet row-count
// caption provide enough validation without making multi-candidate plans tall.
const LOAD_PLAN_LOADING_HEIGHT = 158;

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

export const LoadPlanCard: React.FC<LoadPlanCardProps> = ({ plan, onConfirm, confirmed, canLoadInNewWorkspace }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const [selection, setSelection] = useState<Record<number, boolean>>(
        () => Object.fromEntries(plan.candidates.map((c, i) => [
            i,
            !c.resolutionError && c.selected !== false,
        ]))
    );
    const [loading, setLoading] = useState(false);
    // Every resolvable candidate preview is always open. Seed loading state on
    // the first render so the fixed-height spinner area is reserved before the
    // asynchronous preview requests begin.
    const [previews, setPreviews] = useState<Record<number, PreviewState>>(() => {
        const seed: Record<number, PreviewState> = {};
        plan.candidates.forEach((c, i) => {
            if (!c.resolutionError) {
                seed[i] = { loading: true, expanded: true, rows: [], columns: [] };
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

    // Fetch every preview once on mount. We don't await — each row already
    // displays its fixed-height spinner and resolves independently.
    React.useEffect(() => {
        plan.candidates.forEach((c, i) => {
            if (!c.resolutionError) {
                fetchPreview(c, i);
            }
        });
        // Intentionally run once; the plan doesn't mutate after mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleConfirm = async (newWorkspace = false) => {
        const selected = plan.candidates.filter((c, i) => selection[i] && !c.resolutionError);
        if (selected.length === 0) return;
        setLoading(true);
        try {
            await onConfirm(selected, { newWorkspace });
        } finally {
            setLoading(false);
        }
    };

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
                    <Box key={i} sx={{
                        ...(i > 0 ? {
                            mt: 0.75,
                            pt: 0.75,
                            borderTop: '1px solid',
                            borderColor: 'divider',
                        } : {}),
                    }}>
                      <TablePreviewRow
                        name={c.displayName}
                        leading={confirmed
                            ? <CheckIcon sx={{ fontSize: 16, color: 'success.main', mx: 0.25 }} />
                            : <Checkbox size="small" checked={!!selection[i]} disabled={unresolved}
                                onChange={() => toggleItem(i)} sx={{ p: 0.25 }} />}
                        trailing={!unresolved ? (
                            <Tooltip title={`${t('dataLoading.loadPlan.fromSource', { defaultValue: 'from' })} ${c.sourceId}`}>
                                <Box sx={{
                                    display: 'flex', alignItems: 'center', gap: 0.4,
                                    maxWidth: 180, minWidth: 0, flexShrink: 0,
                                    color: 'text.secondary',
                                }}>
                                    {getConnectorIcon(c.sourceId.split(':', 1)[0], {
                                        sx: { fontSize: 13, flexShrink: 0, color: 'text.secondary' },
                                    })}
                                    <Typography noWrap sx={{ fontSize: 10.5, color: 'text.secondary' }}>
                                        {c.sourceId}
                                    </Typography>
                                </Box>
                            </Tooltip>
                        ) : undefined}
                        filterChips={hasFilters ? (
                            <>
                                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, mr: 0.25, color: 'text.secondary' }}>
                                    <FilterAltOutlinedIcon sx={{ fontSize: 12 }} />
                                    <Typography sx={{ fontSize: 10.5, fontWeight: 600, color: 'text.secondary' }}>
                                        {t('dataLoading.loadPlan.filtersLabel', { defaultValue: 'Filters:' })}
                                    </Typography>
                                </Box>
                                {c.filters?.map((f, fi) => (
                                    <Chip key={fi}
                                        label={formatFilterChipLabel(f.column, f.operator, f.value)}
                                        size="small" variant="outlined"
                                        sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.75 } }} />
                                ))}
                                {c.sortBy && (
                                    <Chip label={`${c.sortBy} ${c.sortOrder === 'desc' ? '↓' : '↑'}`}
                                        size="small" variant="outlined"
                                        sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.75 } }} />
                                )}
                            </>
                        ) : undefined}
                        preview={previewData}
                        expanded={!unresolved}
                        loadingHeight={LOAD_PLAN_LOADING_HEIGHT}
                        dim={unresolved}
                        unresolved={unresolved ? {
                            message: t('dataLoading.loadPlan.unresolved', {
                                defaultValue: "Couldn't resolve this table — the agent should rerun search and try again.",
                            }),
                            detail: c.resolutionError,
                        } : undefined}
                      />
                    </Box>
                );
            })}

            {/* Footer: keep actions available after loading and show the
                prior-load status immediately to their left. */}
            <Box sx={{ mt: 0.75, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ flex: 1 }} />
                {confirmed && (
                    <Typography sx={{ fontSize: 11, color: 'success.main', fontWeight: 500 }}>
                        {t('dataLoading.loadPlan.loadedCount', {
                            count: plan.candidates.filter(c => !c.resolutionError).length,
                            defaultValue: '✓ Loaded',
                        })}
                    </Typography>
                )}
                {canLoadInNewWorkspace ? (
                    // A workspace with data is already open — make the load
                    // destination explicit rather than silently appending.
                    <>
                        <Button
                            size="small"
                            variant="outlined"
                            disabled={selectedCount === 0 || loading}
                            onClick={() => handleConfirm(true)}
                            startIcon={loading ? <CircularProgress size={14} color="inherit" /> : undefined}
                            sx={{
                                textTransform: 'none', fontSize: 12,
                                py: 0.5, px: 1.5, minHeight: 0,
                                borderRadius: 1.5,
                            }}
                        >
                            {t('dataLoading.loadPlan.loadInNewWorkspace', { defaultValue: 'Load in new workspace' })}
                        </Button>
                        <Button
                            size="small"
                            variant="contained"
                            disabled={selectedCount === 0 || loading}
                            onClick={() => handleConfirm(false)}
                            startIcon={loading ? <CircularProgress size={14} color="inherit" /> : undefined}
                            sx={{
                                textTransform: 'none', fontSize: 12,
                                py: 0.5, px: 2, minHeight: 0,
                                borderRadius: 1.5, boxShadow: 'none',
                            }}
                        >
                            {`${t('dataLoading.loadPlan.addToCurrent', { defaultValue: 'Add to current workspace' })} (${selectedCount})`}
                        </Button>
                    </>
                ) : (
                    <Button
                        size="small"
                        variant="contained"
                        disabled={selectedCount === 0 || loading}
                        onClick={() => handleConfirm(false)}
                        startIcon={loading ? <CircularProgress size={14} color="inherit" /> : undefined}
                        sx={{
                            textTransform: 'none', fontSize: 12,
                            py: 0.5, px: 2, minHeight: 0,
                            borderRadius: 1.5, boxShadow: 'none',
                        }}
                    >
                        {`${t('dataLoading.loadPlan.loadSelected')} (${selectedCount})`}
                    </Button>
                )}
            </Box>
        </Box>
    );
};

// ---------------------------------------------------------------------------
// PendingLoadsCard
// ---------------------------------------------------------------------------
// Renders one or more agent-proposed scratch-CSV table loads using the
// same visual shell as `LoadPlanCard` above, so users see a consistent
// multi-table import UI regardless of whether candidates come from a
// connector plan or a notebook-style extract step.

interface PendingLoadsCardProps {
    pendingLoads: PendingTableLoad[];
    onLoad: (pending: PendingTableLoad) => Promise<void> | void;
}

export const PendingLoadsCard: React.FC<PendingLoadsCardProps> = ({ pendingLoads, onLoad }) => {
    const theme = useTheme();
    const { t } = useTranslation();

    // Confirmed = already loaded earlier; unconfirmed = selectable.
    const [selection, setSelection] = useState<Record<number, boolean>>(
        () => Object.fromEntries(pendingLoads.map((p, i) => [i, !p.confirmed]))
    );
    // Auto-expand previews — scratch CSV samples are already inlined
    // client-side, so there's no fetch cost to showing them by default.
    const [expanded, setExpanded] = useState<Record<number, boolean>>(
        () => Object.fromEntries(pendingLoads.map((_, i) => [i, true]))
    );
    const [loading, setLoading] = useState(false);

    const allConfirmed = pendingLoads.every(p => p.confirmed);
    const selectedCount = Object.entries(selection)
        .filter(([i, on]) => on && !pendingLoads[Number(i)].confirmed).length;

    const toggleItem = (idx: number) =>
        setSelection(prev => ({ ...prev, [idx]: !prev[idx] }));
    const togglePreview = (idx: number) =>
        setExpanded(prev => ({ ...prev, [idx]: !prev[idx] }));

    const handleConfirm = async () => {
        if (selectedCount === 0) return;
        setLoading(true);
        try {
            for (let i = 0; i < pendingLoads.length; i++) {
                if (selection[i] && !pendingLoads[i].confirmed) {
                    await onLoad(pendingLoads[i]);
                }
            }
        } finally {
            setLoading(false);
        }
    };

    const isDark = theme.palette.mode === 'dark';
    const borderColorBase = allConfirmed
        ? alpha(theme.palette.success.main, 0.3)
        : alpha(theme.palette.primary.main, isDark ? 0.25 : 0.15);
    const borderColorHover = allConfirmed
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
            {pendingLoads.map((p, i) => {
                const preview = p.preview;
                const rowLabel = preview.totalRows > preview.sampleRows.length
                    ? `${preview.totalRows.toLocaleString()} ${t('dataLoading.rows')}`
                    : '';
                const meta = [rowLabel, `${preview.columns.length} ${t('dataLoading.cols')}`]
                    .filter(Boolean).join(' · ');

                const previewData: TablePreviewData = {
                    state: 'ready',
                    columns: preview.columns,
                    rows: preview.sampleRows,
                    totalRows: preview.totalRows,
                };

                return (
                    <TablePreviewRow
                        key={i}
                        name={p.name}
                        meta={meta}
                        leading={p.confirmed
                            ? <CheckIcon sx={{ fontSize: 16, color: 'success.main', mx: 0.25 }} />
                            : <Checkbox size="small" checked={!!selection[i]}
                                onChange={() => toggleItem(i)} sx={{ p: 0.25 }} />}
                        preview={previewData}
                        expanded={!!expanded[i]}
                        onTogglePreview={preview.sampleRows.length > 0 ? () => togglePreview(i) : undefined}
                    />
                );
            })}

            <Box sx={{ mt: 0.75, display: 'flex', alignItems: 'center' }}>
                <Box sx={{ flex: 1 }} />
                {allConfirmed ? (
                    <Typography sx={{ fontSize: 11, color: 'success.main', fontWeight: 500 }}>
                        {t('dataLoading.loadPlan.loadedCount', {
                            count: pendingLoads.length,
                            defaultValue: '✓ Loaded',
                        })}
                    </Typography>
                ) : (
                    <Button
                        size="small"
                        variant="contained"
                        disabled={selectedCount === 0 || loading}
                        onClick={handleConfirm}
                        startIcon={loading ? <CircularProgress size={14} color="inherit" /> : undefined}
                        sx={{
                            textTransform: 'none', fontSize: 12,
                            py: 0.5, px: 2, minHeight: 0,
                            borderRadius: 1.5, boxShadow: 'none',
                        }}
                    >
                        {`${t('dataLoading.loadPlan.loadSelected')} (${selectedCount})`}
                    </Button>
                )}
            </Box>
        </Box>
    );
};
