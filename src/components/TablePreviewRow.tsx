// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import { Box, Button, CircularProgress, Collapse, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useTranslation } from 'react-i18next';
import { DataFrameTable } from '../views/DataFrameTable';

// Shared header+collapsible-preview row used by LoadPlanCard and the
// inline previews in DataLoadingChat. Pure visual; no fetching, no state.

export interface TablePreviewData {
    state: 'idle' | 'loading' | 'error' | 'ready';
    error?: string;
    columns?: string[];
    rows?: Record<string, any>[];
    totalRows?: number;
}

export interface TablePreviewRowProps {
    name: string;
    meta?: string;
    leading?: React.ReactNode;       // checkbox/check icon
    trailing?: React.ReactNode;      // e.g. source-id caption
    filterChips?: React.ReactNode;   // optional chip row under header
    preview: TablePreviewData;
    expanded: boolean;
    /** Optional height reserved only while a remote preview is loading.
     *  Ready/error/empty states return to their natural content height. */
    loadingHeight?: number;
    onTogglePreview?: () => void;
    unresolved?: { message: string; detail?: string };
    dim?: boolean;
}

export const TablePreviewRow: React.FC<TablePreviewRowProps> = ({
    name, meta, leading, trailing, filterChips,
    preview, expanded, loadingHeight, onTogglePreview, unresolved, dim = false,
}) => {
    const { t } = useTranslation();
    const showPreviewButton = !!onTogglePreview && !unresolved;
    const isLoading = preview.state === 'loading';
    const indent = leading ? 3.5 : 0;

    const buttonLabel = isLoading
        ? t('dataLoading.loadPlan.previewing')
        : expanded
            ? t('dataLoading.loadPlan.hidePreview', { defaultValue: 'Hide' })
            : t('dataLoading.loadPlan.preview');

    return (
        <Box sx={{ py: 0.5, opacity: dim ? 0.6 : 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {leading}
                {unresolved && <ErrorOutlineIcon sx={{ fontSize: 14, color: 'warning.main' }} />}
                <Typography title={name} sx={{ fontSize: 12, fontWeight: 500, minWidth: 0 }} noWrap>{name}</Typography>
                {meta && <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>{meta}</Typography>}
                <Box sx={{ flex: 1 }} />
                {trailing}
                {showPreviewButton && (
                    <Button size="small" variant="text" disabled={isLoading} onClick={onTogglePreview}
                        sx={{ textTransform: 'none', fontSize: 10, py: 0, px: 0.75, minHeight: 0 }}>
                        {buttonLabel}
                    </Button>
                )}
            </Box>

            {unresolved ? (
                <Typography sx={{ pl: indent, mt: 0.25, fontSize: 10.5, color: 'warning.dark', fontStyle: 'italic' }}>
                    {unresolved.message}
                    {unresolved.detail && (
                        <Box component="span" sx={{ display: 'block', color: 'text.disabled', fontSize: 10 }}>
                            {unresolved.detail}
                        </Box>
                    )}
                </Typography>
            ) : (
                <>
                    {filterChips && (
                        <Box sx={{ pl: indent, mt: 0.3, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {filterChips}
                        </Box>
                    )}
                    <Collapse in={expanded}>
                        <Box sx={{
                            pl: indent,
                            mt: 0.75,
                            // Reserve space only for the asynchronous loading
                            // state. Once resolved, the table uses natural
                            // height: five rows plus the truncation row fit
                            // without a scroller, while short tables stay compact.
                            ...(loadingHeight && preview.state === 'loading' ? {
                                height: loadingHeight,
                                overflow: 'hidden',
                                boxSizing: 'border-box',
                            } : {
                                overflowX: 'auto',
                                overflowY: 'visible',
                            }),
                        }}>
                            {preview.state === 'loading' ? (
                                <Box sx={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
                                    height: loadingHeight ? '100%' : undefined,
                                    py: loadingHeight ? 0 : 1,
                                }}>
                                    <CircularProgress size={14} />
                                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                                        {t('dataLoading.loadPlan.previewing')}
                                    </Typography>
                                </Box>
                            ) : preview.state === 'error' ? (
                                <Typography sx={{ fontSize: 11, color: 'error.main' }}>
                                    {preview.error || t('dataLoading.loadPlan.previewFailed')}
                                </Typography>
                            ) : preview.state === 'ready' && (preview.rows?.length ?? 0) > 0 ? (
                                <DataFrameTable
                                    columns={preview.columns || []}
                                    rows={preview.rows || []}
                                    totalRows={preview.totalRows}
                                    maxRows={5} maxColumns={8} maxCellLength={18}
                                    fontSize={10.5} headerFontSize={10}
                                    truncationIndicator="row"
                                />
                            ) : preview.state === 'ready' ? (
                                <Typography sx={{ fontSize: 11, color: 'text.disabled', fontStyle: 'italic' }}>
                                    {t('connectorPreview.noMatchingRows')}
                                </Typography>
                            ) : null}
                        </Box>
                    </Collapse>
                </>
            )}
        </Box>
    );
};
