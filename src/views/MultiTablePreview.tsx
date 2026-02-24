// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { useState, useEffect } from 'react';
import {
    Box,
    Chip,
    IconButton,
    Typography,
    Tooltip,
    LinearProgress,
    alpha,
    Card,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { DictTable } from '../components/ComponentType';
import { CustomReactTable } from './ReactTable';

export interface MultiTablePreviewProps {
    /** Loading state indicator */
    loading?: boolean;
    /** Error message to display */
    error?: string | null;
    /** Single table for backwards compatibility */
    table?: DictTable | null;
    /** Array of tables to preview */
    tables?: DictTable[] | null;
    /** Label to show when no tables are available */
    emptyLabel?: string;
    /** Optional metadata string to display */
    meta?: string;
    /** Callback when a table is removed (enables delete button) */
    onRemoveTable?: (index: number) => void;
    /** Controlled active index */
    activeIndex?: number;
    /** Callback when active index changes */
    onActiveIndexChange?: (index: number) => void;
    /** Maximum height for the table container */
    maxHeight?: number;
    /** Maximum number of rows to display */
    maxRows?: number;
    /** Whether to use compact mode for the table */
    compact?: boolean;
    /** Whether to show the "Preview" label */
    showPreviewLabel?: boolean;
}

export const MultiTablePreview: React.FC<MultiTablePreviewProps> = ({
    loading = false,
    error = null,
    table,
    tables,
    emptyLabel = 'No tables to preview.',
    meta,
    onRemoveTable,
    activeIndex: controlledActiveIndex,
    onActiveIndexChange,
    maxHeight = 200,
    maxRows = 12,
    compact = true,
}) => {
    const previewTables = tables ?? (table ? [table] : null);
    const [internalActiveIndex, setInternalActiveIndex] = useState(0);
    const activeIndex = controlledActiveIndex !== undefined ? controlledActiveIndex : internalActiveIndex;
    const setActiveIndex = onActiveIndexChange || setInternalActiveIndex;

    useEffect(() => {
        if (!previewTables || previewTables.length === 0) {
            if (onActiveIndexChange) {
                onActiveIndexChange(0);
            } else {
                setInternalActiveIndex(0);
            }
            return;
        }
        if (activeIndex > previewTables.length - 1) {
            const newIndex = previewTables.length - 1;
            if (onActiveIndexChange) {
                onActiveIndexChange(newIndex);
            } else {
                setInternalActiveIndex(newIndex);
            }
        }
    }, [previewTables, activeIndex, onActiveIndexChange]);

    const activeTable = previewTables && previewTables.length > 0 ? previewTables[activeIndex] : null;

    return (
        <Box
            sx={{
                p: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                minHeight: 120,
            }}
        >
            {loading && <LinearProgress />}

            {error && (
                <Typography variant="caption" color="error">
                    {error}
                </Typography>
            )}

            {!loading && !error && (!previewTables || previewTables.length === 0) && (
                <Typography variant="caption" color="text.secondary">
                    {emptyLabel}
                </Typography>
            )}

            {previewTables && previewTables.length > 0 && (
                <Box>
                    {/* Table selection chips */}
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 0.25,
                            mb: 0.5,
                            pb: 0.25,
                        }}
                    >
                        <Typography variant="caption" sx={{ mx: 0.5 }}>
                            Preview
                        </Typography>
                        {previewTables.map((t, idx) => {
                            const label = t.displayId || t.id;
                            const isSelected = idx === activeIndex;
                            return (
                                <Tooltip key={`${t.id}-${idx}`} title={label} placement="top" arrow>
                                    <Chip
                                        label={label}
                                        size="small"
                                        onClick={() => {
                                            if (onActiveIndexChange) {
                                                onActiveIndexChange(idx);
                                            } else {
                                                setInternalActiveIndex(idx);
                                            }
                                        }}
                                        sx={{
                                            borderRadius: 1,
                                            cursor: 'pointer',
                                            maxWidth: 160,
                                            backgroundColor: (theme) =>
                                                isSelected
                                                    ? alpha(theme.palette.primary.main, 0.12)
                                                    : 'transparent',
                                            borderColor: (theme) =>
                                                isSelected
                                                    ? alpha(theme.palette.primary.main, 0.5)
                                                    : undefined,
                                            color: (theme) =>
                                                isSelected
                                                    ? theme.palette.primary.main
                                                    : theme.palette.text.secondary,
                                            '& .MuiChip-label': {
                                                fontSize: '0.625rem',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                maxWidth: 140,
                                            },
                                            '&:hover': {
                                                backgroundColor: (theme) =>
                                                    isSelected
                                                        ? alpha(theme.palette.primary.main, 0.16)
                                                        : alpha(theme.palette.primary.main, 0.08),
                                            },
                                        }}
                                    />
                                </Tooltip>
                            );
                        })}
                        {onRemoveTable && (
                            <Tooltip title="Remove table" placement="top" arrow>    
                                <IconButton
                                    size="small"
                                    color="error"
                                    onClick={() => onRemoveTable(activeIndex)}
                                    sx={{ ml: 'auto', flexShrink: 0 }}
                                    aria-label="Remove table"
                                >
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        )}
                    </Box>

                    {activeTable && (
                        <Box>
                            <Card variant="outlined" sx={{ pb: 0.5 }}>
                                <CustomReactTable
                                    rows={activeTable.rows.slice(0, maxRows)}
                                    columnDefs={activeTable.names.map(name => ({
                                        id: name,
                                        label: name,
                                        minWidth: 60,
                                    }))}
                                    rowsPerPageNum={-1}
                                    compact={compact}
                                    isIncompleteTable={activeTable.rows.length > maxRows}
                                    maxHeight={maxHeight}
                                />
                            </Card>
                            <Typography variant="caption" color="text.secondary">
                                {activeTable.rows.length} rows × {activeTable.names.length} columns
                            </Typography>
                        </Box>
                    )}

                    {meta && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                            {meta}
                        </Typography>
                    )}
                </Box>
            )}
        </Box>
    );
};

export default MultiTablePreview;
