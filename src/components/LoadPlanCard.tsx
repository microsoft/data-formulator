// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useState } from 'react';
import {
    Box, Button, Checkbox, Chip, CircularProgress, FormControlLabel, Radio,
    RadioGroup, Tooltip, Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import { useTranslation } from 'react-i18next';
import { apiRequest, ApiRequestError } from '../app/apiClient';
import { getErrorMessage } from '../app/errorCodes';
import { CONNECTOR_ACTION_URLS } from '../app/utils';
import { getConnectorIcon } from '../icons';
import { iconVar, textVar } from '../app/layout';
import { TablePreviewRow, TablePreviewData } from './TablePreviewRow';
import { formatFilterChipLabel } from './filterFormat';
import type { LoadPlan, LoadPlanCandidate, PendingTableLoad } from './ComponentType';

export type PresentedLoadCandidate =
    | { kind: 'connector'; key: string; candidate: LoadPlanCandidate; loaded: boolean }
    | { kind: 'scratch'; key: string; candidate: PendingTableLoad; loaded: boolean };

interface LoadPlanCardProps {
    plan?: LoadPlan;
    pendingLoads?: PendingTableLoad[];
    onConfirm: (selected: PresentedLoadCandidate[], opts?: { newWorkspace?: boolean }) => void;
    connectorConfirmed?: boolean;
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

// Failures worth re-establishing the connection for. Anything else (a missing
// table, a bad query) will fail again no matter how often we reconnect.
const RECONNECTABLE_CODES = ['CONNECTOR_AUTH_FAILED', 'AUTH_EXPIRED', 'DB_CONNECTION_FAILED', 'CONNECTOR_ERROR'];

interface PreviewState {
    loading: boolean;
    expanded: boolean;
    rows: Record<string, any>[];
    columns: string[];
    totalRows?: number;
    error?: string;
    /** True when the failure looks like a dropped/expired connection rather
     *  than a bad table, so recovery should re-establish the session first. */
    needsReconnect?: boolean;
}

export const buildLoadQueryImportOptions = (candidate: LoadPlanCandidate, previewSize?: number) => {
    const query = candidate.query;
    const filters = query?.filters?.map(filter => ({
        column: filter.column,
        operator: filter.op,
        ...('value' in filter ? { value: filter.value } : {}),
    })) ?? [];
    const order = query?.orderBy?.[0];
    const requestedLimit = query?.limit;
    const size = previewSize === undefined
        ? requestedLimit
        : requestedLimit === undefined ? previewSize : Math.min(previewSize, requestedLimit);
    return {
        ...(size !== undefined ? { size } : {}),
        ...(filters.length ? { source_filters: filters } : {}),
        ...(query?.columns?.length ? { columns: query.columns } : {}),
        ...(order ? {
            sort_columns: [order.column],
            sort_order: order.direction,
        } : {}),
    };
};

const getResolutionError = (item: PresentedLoadCandidate): string | undefined =>
    item.kind === 'connector'
        ? item.candidate.resolutionError
        : (!item.candidate.csvScratchPath ? 'No loadable scratch file was produced.' : undefined);

export const LoadPlanCard: React.FC<LoadPlanCardProps> = ({
    plan,
    pendingLoads,
    onConfirm,
    connectorConfirmed = false,
    canLoadInNewWorkspace,
}) => {
    const { t } = useTranslation();
    const optionGroups = plan?.options.length ? plan.options : undefined;
    const planCandidates = optionGroups
        ? optionGroups.flatMap(option => option.tables)
        : [];
    const candidates: PresentedLoadCandidate[] = [
        ...planCandidates.map((candidate, index): PresentedLoadCandidate => ({
            kind: 'connector',
            key: `connector:${candidate.sourceId}:${candidate.tableKey}:${index}`,
            candidate,
            loaded: connectorConfirmed,
        })),
        ...(pendingLoads || []).map((candidate, index): PresentedLoadCandidate => ({
            kind: 'scratch',
            key: `scratch:${candidate.csvScratchPath}:${candidate.name}:${index}`,
            candidate,
            loaded: candidate.confirmed,
        })),
    ];
    const [selectedOption, setSelectedOption] = useState<number>(0);
    const [selection, setSelection] = useState<Record<number, boolean>>(
        () => Object.fromEntries(candidates.map((item, i) => [
            i,
            !item.loaded && !getResolutionError(item)
                && !item.loaded,
        ]))
    );
    const [loading, setLoading] = useState(false);
    // Every resolvable candidate preview is always open. Seed loading state on
    // the first render so the fixed-height spinner area is reserved before the
    // asynchronous preview requests begin.
    const [previews, setPreviews] = useState<Record<number, PreviewState>>(() => {
        const seed: Record<number, PreviewState> = {};
        candidates.forEach((item, i) => {
            if (item.kind === 'scratch') {
                seed[i] = {
                    loading: false,
                    expanded: true,
                    rows: item.candidate.preview.sampleRows,
                    columns: item.candidate.preview.columns,
                    totalRows: item.candidate.preview.totalRows,
                };
            } else if (!item.candidate.resolutionError) {
                seed[i] = { loading: true, expanded: true, rows: [], columns: [] };
            }
        });
        return seed;
    });

    const toggleItem = (idx: number) => {
        setSelection(prev => ({ ...prev, [idx]: !prev[idx] }));
    };

    const selectOption = (optionIndex: number) => {
        let offset = 0;
        const next = { ...selection };
        optionGroups?.forEach((option, index) => {
            option.tables.forEach((_candidate, candidateIndex) => {
                const item = candidates[offset + candidateIndex];
                next[offset + candidateIndex] = index === optionIndex
                    && !item.loaded && !getResolutionError(item);
            });
            offset += option.tables.length;
        });
        setSelection(next);
        setSelectedOption(optionIndex);
    };

    const visibleOptionIndexes = new Set<number>();
    if (optionGroups && typeof selectedOption === 'number') {
        let offset = 0;
        optionGroups.forEach((option, index) => {
            if (index === selectedOption) {
                option.tables.forEach((_candidate, candidateIndex) => {
                    visibleOptionIndexes.add(offset + candidateIndex);
                });
            }
            offset += option.tables.length;
        });
    }

    const selectedCount = candidates.filter((item, index) =>
        selection[index] && !item.loaded && !getResolutionError(item)
    ).length;

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
                    import_options: buildLoadQueryImportOptions(candidate, 10),
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
            const code = err?.apiError?.code;
            setPreviews(prev => ({
                ...prev,
                [idx]: {
                    loading: false,
                    expanded: true,
                    rows: [],
                    columns: [],
                    error: err instanceof ApiRequestError
                        ? getErrorMessage(err.apiError)
                        : (err?.message || t('dataLoading.loadPlan.previewFailed')),
                    needsReconnect: err instanceof ApiRequestError
                        && (err.isAuthError || RECONNECTABLE_CODES.includes(code)),
                },
            }));
        }
    }, [t]);

    // Recovery for a failed preview. The backend already retries stored
    // credentials / SSO on every request, so a plain retry is enough for
    // transient faults; a dropped session additionally needs an explicit
    // connect, which only succeeds when the source can re-auth unattended.
    const retryPreview = React.useCallback(async (candidate: LoadPlanCandidate, idx: number) => {
        if (previews[idx]?.needsReconnect) {
            setPreviews(prev => ({
                ...prev,
                [idx]: { ...(prev[idx] || { rows: [], columns: [] }), loading: true, expanded: true },
            }));
            try {
                const { data: status } = await apiRequest<any>(CONNECTOR_ACTION_URLS.GET_STATUS, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connector_id: candidate.sourceId }),
                });
                if (!status.connected && (status.has_stored_credentials || status.sso_available)) {
                    await apiRequest<any>(CONNECTOR_ACTION_URLS.CONNECT, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            connector_id: candidate.sourceId,
                            params: {},
                            persist: !status.sso_available,
                        }),
                    });
                }
            } catch {
                // Fall through: the preview below reports why it still fails.
            }
        }
        await fetchPreview(candidate, idx);
    }, [previews, fetchPreview]);

    // Fetch every preview once on mount. We don't await — each row already
    // displays its fixed-height spinner and resolves independently.
    React.useEffect(() => {
        candidates.forEach((item, i) => {
            if (item.kind === 'connector' && !item.candidate.resolutionError) {
                fetchPreview(item.candidate, i);
            }
        });
    }, []);

    const handleConfirm = async (newWorkspace = false) => {
        const selected = candidates.filter((item, i) =>
            selection[i] && !item.loaded && !getResolutionError(item)
        );
        if (selected.length === 0) return;
        setLoading(true);
        try {
            await onConfirm(selected, { newWorkspace });
        } finally {
            setLoading(false);
        }
    };

    const loadableCandidates = candidates.filter(item => !getResolutionError(item));
    const allLoaded = loadableCandidates.length > 0 && loadableCandidates.every(item => item.loaded);

    return (
        <Box sx={{
            display: 'flex', flexDirection: 'column',
            width: '100%', height: '100%', minWidth: 0, minHeight: 0,
        }}>
            {optionGroups && (
                <Box sx={{ flexShrink: 0, pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <RadioGroup
                        value={selectedOption}
                        onChange={(_event, value) => selectOption(Number(value))}
                    >
                        {optionGroups.map((option, index) => (
                            <FormControlLabel
                                key={`${option.label}:${index}`}
                                value={index}
                                control={<Radio size="small" />}
                                label={option.label}
                                sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: textVar.sm } }}
                            />
                        ))}
                    </RadioGroup>
                </Box>
            )}
            {/* Candidate list */}
            <Box sx={{
                flex: 1, minWidth: 0, minHeight: 0,
                overflowY: 'auto', overflowX: 'hidden', pr: 1,
            }}>
            {candidates.map((item, i) => {
                if (optionGroups && i < planCandidates.length && !visibleOptionIndexes.has(i)) return null;
                const preview = previews[i];
                const connector = item.kind === 'connector' ? item.candidate : undefined;
                const scratch = item.kind === 'scratch' ? item.candidate : undefined;
                const resolutionError = getResolutionError(item);
                const unresolved = !!resolutionError;
                const queryFilters = connector?.query?.filters?.map(filter => ({
                    column: filter.column,
                    operator: filter.op,
                    value: filter.value,
                })) ?? [];
                const queryOrder = connector?.query?.orderBy?.[0];
                const hasFilters = !unresolved && (queryFilters.length > 0 || !!queryOrder);
                const rowLabel = scratch && scratch.preview.totalRows > scratch.preview.sampleRows.length
                    ? `${scratch.preview.totalRows.toLocaleString()} ${t('dataLoading.rows')}`
                    : '';
                const meta = scratch
                    ? [rowLabel, `${scratch.preview.columns.length} ${t('dataLoading.cols')}`].filter(Boolean).join(' · ')
                    : undefined;

                const previewData: TablePreviewData =
                    unresolved ? { state: 'idle' }
                    : preview?.loading ? { state: 'loading' }
                    : preview?.error ? { state: 'error', error: preview.error }
                    : preview ? { state: 'ready', columns: preview.columns, rows: preview.rows, totalRows: preview.totalRows }
                    : { state: 'idle' };

                return (
                    <Box key={item.key} sx={{
                        ...(i > 0 ? {
                            mt: 0.75,
                            pt: 0.75,
                            borderTop: '1px solid',
                            borderColor: 'divider',
                        } : {}),
                    }}>
                      <TablePreviewRow
                        name={connector?.displayName || scratch?.name || ''}
                        meta={meta}
                        leading={item.loaded
                            ? <CheckIcon sx={{ fontSize: iconVar.md, color: 'success.main', mx: 0.25 }} />
                            : optionGroups && i < planCandidates.length
                                ? <CheckIcon sx={{ fontSize: iconVar.md, color: 'primary.main', mx: 0.25 }} />
                                : <Checkbox size="small" checked={!!selection[i]} disabled={unresolved}
                                    onChange={() => toggleItem(i)} sx={{ p: 0.25 }} />}
                        trailing={!unresolved && connector ? (
                            <Tooltip title={`${t('dataLoading.loadPlan.fromSource', { defaultValue: 'from' })} ${connector.sourceId}`}>
                                <Box sx={{
                                    display: 'flex', alignItems: 'center', gap: 0.4,
                                    maxWidth: 180, minWidth: 0, flexShrink: 0,
                                    color: 'text.secondary',
                                }}>
                                    {getConnectorIcon(connector.sourceId.split(':', 1)[0], {
                                        sx: { fontSize: iconVar.sm, flexShrink: 0, color: 'text.secondary' },
                                    })}
                                    <Typography noWrap sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
                                        {connector.sourceId}
                                    </Typography>
                                </Box>
                            </Tooltip>
                        ) : undefined}
                        filterChips={hasFilters ? (
                            <>
                                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, mr: 0.25, color: 'text.secondary' }}>
                                    <FilterAltOutlinedIcon sx={{ fontSize: iconVar.xs }} />
                                    <Typography sx={{ fontSize: textVar.xs, fontWeight: 600, color: 'text.secondary' }}>
                                        {t('dataLoading.loadPlan.filtersLabel', { defaultValue: 'Filters:' })}
                                    </Typography>
                                </Box>
                                {queryFilters.map((f, fi) => (
                                    <Chip key={fi}
                                        label={formatFilterChipLabel(f.column, f.operator, f.value)}
                                        size="small" variant="outlined"
                                        sx={{ height: 18, fontSize: textVar.xxs, '& .MuiChip-label': { px: 0.75 } }} />
                                ))}
                                {queryOrder && (
                                    <Chip label={`${queryOrder.column} ${queryOrder.direction === 'desc' ? '↓' : '↑'}`}
                                        size="small" variant="outlined"
                                        sx={{ height: 18, fontSize: textVar.xxs, '& .MuiChip-label': { px: 0.75 } }} />
                                )}
                            </>
                        ) : undefined}
                        preview={previewData}
                        expanded={!!preview?.expanded && !unresolved}
                        loadingHeight={connector ? LOAD_PLAN_LOADING_HEIGHT : undefined}
                        onTogglePreview={!unresolved && preview && !preview.loading
                            ? () => setPreviews(prev => ({
                                ...prev,
                                [i]: { ...prev[i], expanded: !prev[i].expanded },
                            }))
                            : undefined}
                        onRetryPreview={connector && preview?.error
                            ? () => void retryPreview(connector, i)
                            : undefined}
                        retryLabel={preview?.needsReconnect
                            ? t('dataLoading.loadPlan.reconnectAndRetry', { defaultValue: 'Reconnect' })
                            : t('dataLoading.loadPlan.retryPreview', { defaultValue: 'Retry' })}
                        dim={unresolved}
                        unresolved={unresolved ? {
                            message: item.kind === 'scratch'
                                ? t('dataLoading.loadPlan.scratchUnavailable', {
                                    defaultValue: "Couldn't prepare this table for loading.",
                                })
                                : t('dataLoading.loadPlan.unresolved', {
                                    defaultValue: "Couldn't resolve this table — the agent should rerun search and try again.",
                                }),
                            detail: resolutionError,
                        } : undefined}
                      />
                    </Box>
                );
            })}
            </Box>

            {/* Footer: keep actions available after loading and show the
                prior-load status immediately to their left. */}
            <Box sx={{
                mt: 0.75, display: 'flex', alignItems: 'center', gap: 1,
                flexShrink: 0, pt: 1, borderTop: '1px solid', borderColor: 'divider',
            }}>
                <Box sx={{ flex: 1 }} />
                {allLoaded && (
                    <Typography sx={{ fontSize: textVar.xs, color: 'success.main', fontWeight: 500 }}>
                        {t('dataLoading.loadPlan.loadedCount', {
                            count: loadableCandidates.length,
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
                                textTransform: 'none', fontSize: textVar.sm,
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
                                textTransform: 'none', fontSize: textVar.sm,
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
                            textTransform: 'none', fontSize: textVar.sm,
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
