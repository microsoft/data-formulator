// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * VirtualizedCatalogTree — virtualized catalog tree for large catalogs
 * (5000+ nodes).
 *
 * Windows against an ancestor scroll element via react-virtuoso
 * `customScrollParent` when a `scrollParent` is supplied (avoids a nested
 * scrollbar); otherwise falls back to a self-contained react-window
 * `FixedSizeList`. Small trees render flat (non-virtualized).
 *
 * Preserves lazy-load expand, load-more pagination, drag-to-import,
 * and source_metadata_status hints.
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import { Virtuoso } from 'react-virtuoso';
import { Box, Tooltip, Typography, useTheme } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import IndeterminateCheckBoxIcon from '@mui/icons-material/IndeterminateCheckBox';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { TableIcon } from '../icons';
import type { CatalogTreeNode } from './CatalogTree';
import { CountBadge } from './CatalogTree';

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
): FlatRow[] {    const rows: FlatRow[] = [];
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
    /** Rich hover card (metadata glance) shown as the row tooltip for tables.
     *  Built from data already in the node — no network fetch. */
    renderHoverCard?: (node: CatalogTreeNode) => React.ReactNode;
    selectedItemId?: string | null;
    /** Enable multi-select checkboxes on table + namespace rows. */
    selectionEnabled?: boolean;
    /** Path-keys (path.join('/')) of currently selected table rows. */
    selectedIds?: Set<string>;
    /** Toggle a single table's selection. */
    onToggleSelectTable?: (node: CatalogTreeNode, checked: boolean) => void;
    /** Toggle all tables under a namespace (tri-state select-all). */
    onToggleSelectNamespace?: (node: CatalogTreeNode, tables: CatalogTreeNode[], checked: boolean) => void;
    /** Max height when auto-sizing (default 600). Pass "none" for unconstrained. */
    maxHeight?: number | 'none';
    rowHeight?: number;
    /** When provided, virtualization windows against this ancestor scroll
     *  element (via react-virtuoso `customScrollParent`) instead of creating
     *  its own inner scroll container — avoids a nested scrollbar. */
    scrollParent?: HTMLElement | null;
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
    renderHoverCard?: (node: CatalogTreeNode) => React.ReactNode;
    selectedItemId?: string | null;
    selectionEnabled?: boolean;
    selectedIds?: Set<string>;
    onToggleSelectTable?: (node: CatalogTreeNode, checked: boolean) => void;
    onToggleSelectNamespace?: (node: CatalogTreeNode, tables: CatalogTreeNode[], checked: boolean) => void;
}

// Recursively collect all table leaves under a node (for namespace select-all).
function collectDescendantTables(node: CatalogTreeNode): CatalogTreeNode[] {
    const out: CatalogTreeNode[] = [];
    const walk = (n: CatalogTreeNode) => {
        if (n.node_type === 'table') { out.push(n); return; }
        for (const c of n.children ?? []) walk(c);
    };
    for (const c of node.children ?? []) walk(c);
    return out;
}

// ─── Row component (react-window v1 API) ────────────────────────────────────

// ── Layout constants (Notion/outliner-style: one glyph per row) ──
// Each row has exactly ONE leading glyph in the "item slot":
//   - Namespace (folder-like, no semantic icon): chevron itself acts as the
//     slot glyph; its rotation signals expanded vs collapsed.
//   - Table leaf:  TableIcon.
//   - Group:       DashboardOutlinedIcon (semantic — distinguishes a multi-
//                  table dataset from a plain namespace; clickable to toggle).
// No separate chevron-in-gutter, so adjacent folder/table rows automatically
// share the same icon-and-label columns.
//
//   | depth*INDENT | slot(16) | GAP | label …
//
// Outer leading inset is provided by the catalog tree's wrapper (in
// DataSourceSidebar.tsx), not by this component, so it can be tuned to align
// with the connector header's icon column.
const INDENT_PER_LEVEL = 12;
const ITEM_SLOT = 16;
const ITEM_LABEL_GAP = 4;
/** Left padding for the row's content (slot + label). */
const rowPadLeft = (depth: number) => depth * INDENT_PER_LEVEL;

function CatalogRowInner({ row, style, data }: { row: FlatRow; style?: React.CSSProperties; data: RowContext }) {
    const { loadedMap, onToggle, onItemClick, onLoadMore, onDragStart, renderTableActions, selectedItemId,
        selectionEnabled, selectedIds, onToggleSelectTable, onToggleSelectNamespace, renderHoverCard } = data;
    const { node, depth, isExpanded, isLazyPlaceholder } = row;
    const theme = useTheme();
    const { t } = useTranslation();

    const itemId = node.path.join('/');
    const isLoadMore = node.node_type === 'load_more';
    const isTable = node.node_type === 'table';
    const isGroup = node.node_type === 'table_group';
    const isNamespace = node.node_type === 'namespace';
    const isExpandable = isNamespace || isGroup;

    // Lazy / load-more rows: align the leading text with where a real row's
    // label would sit at this depth: pl + slot + gap.
    const placeholderPadLeft = `${rowPadLeft(depth) + ITEM_SLOT + ITEM_LABEL_GAP}px`;

    if (isLazyPlaceholder) {
        return (
            <div style={style}>
                <Box sx={{ pl: placeholderPadLeft, display: 'flex', alignItems: 'center', height: '100%' }}>
                    <Typography sx={{ fontSize: 11, color: 'text.disabled', fontStyle: 'italic' }}>Loading…</Typography>
                </Box>
            </div>
        );
    }

    if (isLoadMore) {
        return (
            <div style={style}>
                <Box sx={{ pl: placeholderPadLeft, display: 'flex', alignItems: 'center', height: '100%' }}>
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
    const nodeDescription = (isTable || isGroup)
        ? (node.metadata?.description || node.metadata?.source_description || '')
        : '';
    const metaStatus = node.metadata?.source_metadata_status;
    const isSelected = selectedItemId === itemId;

    // Rich hover card (metadata glance) for tables — no network fetch.
    const hoverCard = (isTable && renderHoverCard) ? renderHoverCard(node) : null;

    // ── Multi-select checkbox state ──────────────────────────────────────
    // Tables select individually; namespaces are tri-state over their table
    // descendants. The leading glyph slot doubles as the checkbox on hover /
    // when selected, so there's no layout shift.
    const selSet = selectedIds;
    const tableChecked = isTable && !!selSet?.has(itemId);
    const nsTables = (selectionEnabled && isNamespace) ? collectDescendantTables(node) : [];
    const nsSelectedCount = nsTables.reduce((n, tn) => n + (selSet?.has(tn.path.join('/')) ? 1 : 0), 0);
    const nsChecked = nsTables.length > 0 && nsSelectedCount === nsTables.length;
    const nsIndeterminate = nsSelectedCount > 0 && nsSelectedCount < nsTables.length;
    const rowSelectable = !!selectionEnabled && (isTable || (isNamespace && nsTables.length > 0));
    const showAsChecked = isTable ? tableChecked : (nsChecked || nsIndeterminate);

    // Tables show their checkbox persistently so multi-select is obviously
    // available (a checklist). Namespaces keep the type/chevron glyph and only
    // reveal the tri-state select-all box on hover or when (partly) selected.
    const alwaysCheckbox = !!selectionEnabled && isTable;

    const handleCheckboxClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isTable) {
            onToggleSelectTable?.(node, !tableChecked);
        } else if (isNamespace) {
            onToggleSelectNamespace?.(node, nsTables, !nsChecked);
        }
    };

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
                title={hoverCard ?? nodeDescription}
                placement="right"
                enterDelay={hoverCard ? 450 : 400}
                disableHoverListener={hoverCard ? false : !nodeDescription}
                slotProps={hoverCard ? {
                    tooltip: {
                        sx: {
                            maxWidth: 'none', p: 0,
                            bgcolor: 'background.paper',
                            color: 'text.primary',
                            border: '1px solid',
                            borderColor: 'divider',
                            boxShadow: 4,
                        },
                    },
                } : undefined}
            >
                <Box
                    onClick={handleClick}
                    sx={{
                        // Notion/outliner-style: one leading glyph per row.
                        // The glyph is either the chevron (namespace) or the
                        // type icon (table/group); they share the same column.
                        pl: `${rowPadLeft(depth)}px`, pr: 0.5,
                        display: 'flex', alignItems: 'center', gap: `${ITEM_LABEL_GAP}px`, minWidth: 0,
                        height: '100%',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        '&:hover': { backgroundColor: theme.palette.action.hover },
                        '& .catalog-hover-action': { visibility: 'hidden' },
                        '&:hover .catalog-hover-action': { visibility: 'visible' },
                        ...(rowSelectable ? {
                            '&:hover .cat-slot-glyph': { display: 'none' },
                            '&:hover .cat-slot-check': { display: 'flex' },
                        } : {}),
                        ...(isSelected ? { backgroundColor: theme.palette.action.selected, fontWeight: 500 } : {}),
                    }}
                >
                    {/* Single leading glyph (slot) — chevron for namespaces,
                        type icon for tables/groups. When selection is enabled
                        the slot doubles as a checkbox on hover / when checked. */}
                    <Box
                        sx={{
                            width: ITEM_SLOT, minWidth: ITEM_SLOT, height: ITEM_SLOT,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0, position: 'relative',
                        }}
                    >
                        <Box
                            className="cat-slot-glyph"
                            sx={{
                                display: (alwaysCheckbox || (rowSelectable && showAsChecked)) ? 'none' : 'flex',
                                alignItems: 'center', justifyContent: 'center',
                            }}
                        >
                            {isNamespace
                                ? (isExpanded
                                    ? <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                                    : <ChevronRightIcon sx={{ fontSize: 16, color: 'text.disabled' }} />)
                                : isGroup
                                    ? <DashboardOutlinedIcon sx={{ fontSize: 16, color: groupLoaded ? 'success.main' : 'text.secondary', opacity: 0.8 }} />
                                    : isTable
                                        ? <TableIcon sx={{ fontSize: 16, color: loaded ? 'success.main' : 'text.secondary', opacity: 0.8 }} />
                                        : null}
                        </Box>
                        {rowSelectable && (
                            <Box
                                className="cat-slot-check"
                                onClick={handleCheckboxClick}
                                sx={{
                                    position: 'absolute', inset: 0,
                                    display: (alwaysCheckbox || showAsChecked) ? 'flex' : 'none',
                                    alignItems: 'center', justifyContent: 'center',
                                    cursor: 'pointer',
                                    color: showAsChecked ? 'primary.main' : 'action.active',
                                }}
                            >
                                {nsIndeterminate && !isTable
                                    ? <IndeterminateCheckBoxIcon sx={{ fontSize: 15 }} />
                                    : showAsChecked
                                        ? <CheckBoxIcon sx={{ fontSize: 15 }} />
                                        : <CheckBoxOutlineBlankIcon sx={{ fontSize: 15 }} />}
                            </Box>
                        )}
                    </Box>
                    {/* Label */}
                    <Typography noWrap component="span" sx={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                        {node.name}
                    </Typography>
                    {/* Loaded check */}
                    {(loaded || groupLoaded) && <CheckIcon sx={{ fontSize: 13, color: 'success.main', flexShrink: 0 }} />}
                    {/* Metadata status hint — only surfaced when metadata is
                        genuinely unavailable. "partial" just means columns are
                        lazy-loaded (expected during a full-cluster browse), so
                        it's not worth flagging. */}
                    {isTable && metaStatus === 'unavailable' && (
                        <Tooltip title={t('sidebar.metadataUnavailable')} placement="top">
                            <InfoOutlinedIcon sx={{ fontSize: 12, color: 'text.disabled', flexShrink: 0, opacity: 0.6 }} />
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
                        <CountBadge count={tableCount} />
                    )}
                    {childCount > 0 && !isExpanded && (
                        <CountBadge count={childCount} />
                    )}
                    {/* Table actions */}
                    {isTable && renderTableActions?.(node)}
                </Box>
            </Tooltip>
        </div>
    );
}

// react-window adapter: resolves the row by index and delegates to the shared
// row renderer. Used by the FixedSizeList fallback (no scrollParent).
function CatalogRow({ index, style, data }: ListChildComponentProps<RowContext>) {
    return <CatalogRowInner row={data.rows[index]} style={style} data={data} />;
}

// ─── Main component ──────────────────────────────────────────────────────────

const ROW_HEIGHT = 24;
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
    renderHoverCard,
    selectedItemId,
    selectionEnabled,
    selectedIds,
    onToggleSelectTable,
    onToggleSelectNamespace,
    maxHeight: maxHeightProp = 600,
    rowHeight = ROW_HEIGHT,
    scrollParent,
    sx,
}) => {
    const unconstrained = maxHeightProp === 'none';
    const maxHeightNum = unconstrained ? Infinity : maxHeightProp;

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
        selectionEnabled,
        selectedIds,
        onToggleSelectTable,
        onToggleSelectNamespace,
        renderHoverCard,
    }), [flatRows, loadedMap, handleToggle, onItemClick, onLoadMore, onDragStart, renderTableActions, selectedItemId, selectionEnabled, selectedIds, onToggleSelectTable, onToggleSelectNamespace, renderHoverCard]);

    const totalHeight = flatRows.length * rowHeight;
    // When unconstrained, cap at a viewport-relative height so react-window
    // still virtualizes (only renders visible rows). Without a cap, FixedSizeList
    // would set height = totalHeight → all rows "visible" → no virtualization.
    const maxVirtualHeight = unconstrained
        ? Math.min(totalHeight, Math.max(400, (typeof window !== 'undefined' ? window.innerHeight : 800) - 200))
        : Math.min(totalHeight, maxHeightNum);

    // For small trees, render without virtualization for simplicity
    if (flatRows.length < VIRTUALIZE_THRESHOLD) {
        const boxMaxHeight = unconstrained ? undefined : maxHeightNum;
        return (
            <Box sx={{ maxHeight: boxMaxHeight, overflowY: totalHeight > maxHeightNum ? 'auto' : 'visible', ...sx }}>
                {flatRows.map((row) => (
                    <CatalogRowInner
                        key={row.node.path.join('/')}
                        row={row}
                        style={{ height: rowHeight }}
                        data={rowContext}
                    />
                ))}
            </Box>
        );
    }

    // When an ancestor scroll element is provided, window against it instead of
    // creating a bounded inner scroll container — this removes the nested
    // scrollbar while keeping virtualization. react-virtuoso natively supports
    // multiple instances sharing one `customScrollParent`.
    if (scrollParent) {
        return (
            <Box sx={sx}>
                <Virtuoso
                    customScrollParent={scrollParent}
                    data={flatRows}
                    computeItemKey={(_index, row) => row.node.path.join('/')}
                    itemContent={(_index, row) => (
                        <CatalogRowInner row={row} style={{ height: rowHeight }} data={rowContext} />
                    )}
                    increaseViewportBy={200}
                />
            </Box>
        );
    }

    return (
        <Box sx={sx}>
            <FixedSizeList
                height={maxVirtualHeight}
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
