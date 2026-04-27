// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * VirtualizedCatalogTree — react-window FixedSizeList backed virtualized tree
 * for large catalogs (5000+ nodes).
 *
 * Drop-in replacement for SimpleTreeView + renderCatalogTreeItems.
 * Preserves lazy-load expand, load-more pagination, drag-to-import,
 * and source_metadata_status hints.
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import { Box, Tooltip, Typography, useTheme } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { TableIcon } from '../icons';
import type { CatalogTreeNode } from './CatalogTree';
import { countBadgeSx } from './CatalogTree';

// ─── Flattened row representation ────────────────────────────────────────────

interface FlatRow {
    node: CatalogTreeNode;
    depth: number;
    isExpanded: boolean;
    isLazyPlaceholder: boolean;
}

function flattenTree(
    nodes: CatalogTreeNode[],
    expandedSet: Set<string>,
    depth: number = 0,
): FlatRow[] {
    const rows: FlatRow[] = [];
    for (const node of nodes) {
        const itemId = node.path.join('/');
        const isExpandable = node.node_type === 'namespace' || node.node_type === 'table_group';
        const isExpanded = expandedSet.has(itemId);
        rows.push({ node, depth, isExpanded, isLazyPlaceholder: false });

        if (isExpandable && isExpanded) {
            if (node.children) {
                rows.push(...flattenTree(node.children, expandedSet, depth + 1));
            } else {
                rows.push({
                    node: { name: 'Loading…', node_type: 'namespace', path: [...node.path, '__loading'], metadata: null },
                    depth: depth + 1,
                    isExpanded: false,
                    isLazyPlaceholder: true,
                });
            }
        }
    }
    return rows;
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface VirtualizedCatalogTreeProps {
    nodes: CatalogTreeNode[];
    loadedMap: Record<string, string>;
    expandedIds: string[];
    onExpandedChange?: (newIds: string[]) => void;
    /** Called when a namespace node is toggled open and has no children (lazy-load). */
    onLazyExpand?: (node: CatalogTreeNode) => void;
    /** Called when a table/table_group leaf is clicked. */
    onItemClick?: (node: CatalogTreeNode, event: React.MouseEvent) => void;
    onLoadMore?: (node: CatalogTreeNode) => void;
    onDragStart?: (node: CatalogTreeNode, event: React.DragEvent) => void;
    renderTableActions?: (node: CatalogTreeNode) => React.ReactNode;
    selectedItemId?: string | null;
    /** Max height when auto-sizing (default 600). */
    maxHeight?: number;
    rowHeight?: number;
    sx?: Record<string, any>;
}

// ─── Row context (passed via rowProps) ───────────────────────────────────────

interface RowContext {
    rows: FlatRow[];
    loadedMap: Record<string, string>;
    onToggle: (node: CatalogTreeNode, itemId: string) => void;
    onItemClick?: (node: CatalogTreeNode, event: React.MouseEvent) => void;
    onLoadMore?: (node: CatalogTreeNode) => void;
    onDragStart?: (node: CatalogTreeNode, event: React.DragEvent) => void;
    renderTableActions?: (node: CatalogTreeNode) => React.ReactNode;
    selectedItemId?: string | null;
}

// ─── Row component (react-window v1 API) ────────────────────────────────────

function CatalogRow({ index, style, data }: ListChildComponentProps<RowContext>) {
    const { rows, loadedMap, onToggle, onItemClick, onLoadMore, onDragStart, renderTableActions, selectedItemId } = data;
    const row = rows[index];
    const { node, depth, isExpanded, isLazyPlaceholder } = row;
    const theme = useTheme();
    const { t } = useTranslation();

    const itemId = node.path.join('/');
    const isLoadMore = node.node_type === 'load_more';
    const isTable = node.node_type === 'table';
    const isGroup = node.node_type === 'table_group';
    const isNamespace = node.node_type === 'namespace';
    const isExpandable = isNamespace || isGroup;

    if (isLazyPlaceholder) {
        return (
            <div style={style}>
                <Box sx={{ pl: `${depth * 16 + 24}px`, display: 'flex', alignItems: 'center', height: '100%' }}>
                    <Typography sx={{ fontSize: 11, color: 'text.disabled', fontStyle: 'italic' }}>Loading…</Typography>
                </Box>
            </div>
        );
    }

    if (isLoadMore) {
        return (
            <div style={style}>
                <Box sx={{ pl: `${depth * 16 + 24}px`, display: 'flex', alignItems: 'center', height: '100%' }}>
                    <Typography
                        component="span"
                        sx={{ fontSize: 12, color: 'primary.main', cursor: 'pointer' }}
                        onClick={() => onLoadMore?.(node)}
                    >
                        {node.name}
                    </Typography>
                </Box>
            </div>
        );
    }

    const sourceName = node.metadata?._source_name;
    const loaded = isTable
        ? loadedMap[node.name] || loadedMap[itemId] || (sourceName ? loadedMap[sourceName] : undefined)
        : undefined;
    const groupLoaded = isGroup ? loadedMap[itemId] : undefined;
    const childCount = isNamespace ? (node.children?.length ?? 0) : 0;
    const tableCount = isGroup ? (node.metadata?.tables?.length ?? 0) : 0;
    const nodeDescription = (isTable || isGroup) ? (node.metadata?.description || '') : '';
    const metaStatus = node.metadata?.source_metadata_status;
    const isSelected = selectedItemId === itemId;

    const dragProps = isTable && onDragStart
        ? {
            draggable: true,
            onDragStart: (e: React.DragEvent<HTMLDivElement>) => onDragStart(node, e),
        }
        : {};

    const handleClick = (e: React.MouseEvent) => {
        if (isExpandable) {
            onToggle(node, itemId);
        }
        if (isTable || isGroup) {
            onItemClick?.(node, e);
        }
    };

    return (
        <div style={style} {...dragProps}>
            <Tooltip
                title={nodeDescription}
                placement="right"
                enterDelay={400}
                disableHoverListener={!nodeDescription}
            >
                <Box
                    onClick={handleClick}
                    sx={{
                        pl: `${depth * 16 + 4}px`, pr: 0.5,
                        display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0,
                        height: '100%',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        '&:hover': { backgroundColor: theme.palette.action.hover },
                        ...(isSelected ? { backgroundColor: theme.palette.action.selected, fontWeight: 500 } : {}),
                    }}
                >
                    {/* Expand/collapse arrow */}
                    {isExpandable ? (
                        <Box sx={{ width: 16, minWidth: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled' }}>
                            {isExpanded
                                ? <ExpandMoreIcon sx={{ fontSize: 16 }} />
                                : <ChevronRightIcon sx={{ fontSize: 16 }} />}
                        </Box>
                    ) : (
                        <Box sx={{ width: 16, minWidth: 16 }} />
                    )}
                    {/* Icon */}
                    {isGroup
                        ? <DashboardOutlinedIcon sx={{ fontSize: 16, color: groupLoaded ? 'success.main' : 'text.secondary', flexShrink: 0, opacity: 0.7 }} />
                        : isTable
                            ? <TableIcon sx={{ fontSize: 16, color: loaded ? 'success.main' : 'text.secondary', flexShrink: 0, opacity: 0.7 }} />
                            : <FolderOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0, opacity: 0.7 }} />
                    }
                    {/* Label */}
                    <Typography noWrap component="span" sx={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                        {node.name}
                    </Typography>
                    {/* Loaded check */}
                    {(loaded || groupLoaded) && <CheckIcon sx={{ fontSize: 13, color: 'success.main', flexShrink: 0 }} />}
                    {/* Metadata status hint */}
                    {isTable && metaStatus && metaStatus !== 'ok' && (
                        <Tooltip title={metaStatus === 'partial' ? t('sidebar.metadataPartial') : t('sidebar.metadataUnavailable')} placement="top">
                            <InfoOutlinedIcon sx={{ fontSize: 12, color: metaStatus === 'partial' ? 'warning.main' : 'text.disabled', flexShrink: 0, opacity: 0.6 }} />
                        </Tooltip>
                    )}
                    {/* Row count */}
                    {isTable && node.metadata?.row_count != null && (
                        <Typography component="span" sx={{ fontSize: 11, color: 'text.disabled', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                            {Number(node.metadata.row_count).toLocaleString()}
                        </Typography>
                    )}
                    {/* Count badges */}
                    {isGroup && tableCount > 0 && (
                        <Box component="span" sx={countBadgeSx}>{tableCount}</Box>
                    )}
                    {childCount > 0 && !isExpanded && (
                        <Box component="span" sx={countBadgeSx}>{childCount}</Box>
                    )}
                    {/* Table actions */}
                    {isTable && renderTableActions?.(node)}
                </Box>
            </Tooltip>
        </div>
    );
}

// ─── Main component ──────────────────────────────────────────────────────────

const ROW_HEIGHT = 28;
const VIRTUALIZE_THRESHOLD = 100;

export const VirtualizedCatalogTree: React.FC<VirtualizedCatalogTreeProps> = ({
    nodes,
    loadedMap,
    expandedIds,
    onExpandedChange,
    onLazyExpand,
    onItemClick,
    onLoadMore,
    onDragStart,
    renderTableActions,
    selectedItemId,
    maxHeight = 600,
    rowHeight = ROW_HEIGHT,
    sx,
}) => {
    const expandedSet = useMemo(() => new Set(expandedIds), [expandedIds]);
    const flatRows = useMemo(() => flattenTree(nodes, expandedSet), [nodes, expandedSet]);

    const handleToggle = useCallback((node: CatalogTreeNode, itemId: string) => {
        if (!onExpandedChange) return;
        const isCurrentlyExpanded = expandedSet.has(itemId);
        let newIds: string[];
        if (isCurrentlyExpanded) {
            newIds = expandedIds.filter(id => id !== itemId);
        } else {
            newIds = [...expandedIds, itemId];
            if ((node.node_type === 'namespace' || node.node_type === 'table_group') && !node.children) {
                onLazyExpand?.(node);
            }
        }
        onExpandedChange(newIds);
    }, [expandedIds, expandedSet, onExpandedChange, onLazyExpand]);

    const rowContext: RowContext = useMemo(() => ({
        rows: flatRows,
        loadedMap,
        onToggle: handleToggle,
        onItemClick,
        onLoadMore,
        onDragStart,
        renderTableActions,
        selectedItemId,
    }), [flatRows, loadedMap, handleToggle, onItemClick, onLoadMore, onDragStart, renderTableActions, selectedItemId]);

    const totalHeight = flatRows.length * rowHeight;
    const effectiveHeight = Math.min(totalHeight, maxHeight);

    // For small trees, render without virtualization for simplicity
    if (flatRows.length < VIRTUALIZE_THRESHOLD) {
        return (
            <Box sx={{ maxHeight, overflowY: totalHeight > maxHeight ? 'auto' : 'visible', ...sx }}>
                {flatRows.map((row, index) => (
                    <CatalogRow
                        key={row.node.path.join('/')}
                        index={index}
                        style={{ height: rowHeight }}
                        data={rowContext}
                    />
                ))}
            </Box>
        );
    }

    return (
        <Box sx={sx}>
            {/* @ts-expect-error react-window v1 class component vs React 19 JSX type */}
            <FixedSizeList
                height={effectiveHeight}
                width="100%"
                itemCount={flatRows.length}
                itemSize={rowHeight}
                itemData={rowContext}
                overscanCount={10}
            >
                {CatalogRow}
            </FixedSizeList>
        </Box>
    );
};

export default VirtualizedCatalogTree;
