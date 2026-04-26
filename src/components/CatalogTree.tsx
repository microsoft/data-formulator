// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared catalog-tree types, helpers, and styled components.
 * Used by both DBTableManager (inside dialogs) and DataSourceSidebar (persistent panel).
 */

import React from 'react';
import { styled, Box, Tooltip, Typography } from '@mui/material';
import { TreeItem, treeItemClasses } from '@mui/x-tree-view/TreeItem';

import CheckIcon from '@mui/icons-material/Check';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import { TableIcon } from '../icons';

// ---------- Types ----------

/** A node returned by the catalog/tree endpoint */
export interface CatalogTreeNode {
    name: string;
    node_type: 'namespace' | 'table' | 'table_group' | 'load_more';
    path: string[];
    metadata: Record<string, any> | null;
    children?: CatalogTreeNode[];
}

// ---------- Helpers ----------

/** Collect expandable (namespace + table_group) item IDs for default-expanded state */
export function collectNamespaceIds(nodes: CatalogTreeNode[]): string[] {
    const ids: string[] = [];
    for (const n of nodes) {
        if (n.node_type === 'namespace' || n.node_type === 'table_group') {
            ids.push(n.path.join('/'));
            if (n.children) ids.push(...collectNamespaceIds(n.children));
        }
    }
    return ids;
}

/** Recursively merge lazily-loaded children into the tree at the given path. */
export function mergeChildrenAtPath(
    tree: CatalogTreeNode[],
    parentPath: string[],
    children: CatalogTreeNode[],
): CatalogTreeNode[] {
    const parentKey = parentPath.join('/');
    return tree.map(node => {
        const nodeKey = node.path.join('/');
        if (nodeKey === parentKey) {
            return { ...node, children };
        }
        if (node.children && parentKey.startsWith(nodeKey + '/')) {
            return { ...node, children: mergeChildrenAtPath(node.children, parentPath, children) };
        }
        return node;
    });
}

/** Append lazily-loaded children under a parent path, replacing any previous load-more sentinel. */
export function appendChildrenAtPath(
    tree: CatalogTreeNode[],
    parentPath: string[],
    children: CatalogTreeNode[],
): CatalogTreeNode[] {
    const parentKey = parentPath.join('/');
    return tree.map(node => {
        const nodeKey = node.path.join('/');
        if (nodeKey === parentKey) {
            const existing = (node.children || []).filter(child => child.node_type !== 'load_more');
            return { ...node, children: [...existing, ...children] };
        }
        if (node.children && parentKey.startsWith(nodeKey + '/')) {
            return { ...node, children: appendChildrenAtPath(node.children, parentPath, children) };
        }
        return node;
    });
}

/** Find a node by path in the catalog tree */
export function findNodeByPath(nodes: CatalogTreeNode[], itemId: string): CatalogTreeNode | null {
    for (const n of nodes) {
        if (n.path.join('/') === itemId) return n;
        if (n.children) {
            const found = findNodeByPath(n.children, itemId);
            if (found) return found;
        }
    }
    return null;
}

// ---------- Styled components ----------

/** Styled TreeItem — clean, compact, GitHub-flavoured. */
export const StyledTreeItem = styled(TreeItem)(({ theme }) => ({
    [`& .${treeItemClasses.groupTransition}`]: {
        marginLeft: 12,
        paddingLeft: 8,
        borderLeft: `1px solid ${theme.palette.divider}`,
    },
    [`& > .${treeItemClasses.content}`]: {
        padding: '2px 6px',
        borderRadius: 6,
        gap: 4,
        [`& .${treeItemClasses.iconContainer}`]: {
            width: 16, minWidth: 16,
            color: theme.palette.text.disabled,
        },
        // Hide the empty icon container on leaf items (no expand/collapse arrow)
        [`& .${treeItemClasses.iconContainer}:empty`]: {
            display: 'none',
        },
        [`& .${treeItemClasses.label}`]: {
            fontSize: 13,
        },
        '&:hover': { backgroundColor: theme.palette.action.hover },
    },
    [`& > .${treeItemClasses.content}.Mui-selected`]: {
        backgroundColor: theme.palette.action.selected,
        fontWeight: 500,
        '&:hover': { backgroundColor: theme.palette.action.selected },
    },
})) as typeof TreeItem;

/** Shared count-badge style */
export const countBadgeSx = {
    fontSize: 11, color: 'text.disabled', bgcolor: 'action.selected',
    borderRadius: 10, px: 0.8, lineHeight: '18px', flexShrink: 0,
    fontVariantNumeric: 'tabular-nums', minWidth: 22, textAlign: 'center',
} as const;

// ---------- Tree renderer ----------

export interface RenderCatalogTreeOptions {
    /** Map of table name or full path → loaded indicator (any truthy string) */
    loadedMap: Record<string, string>;
    /** Set of currently expanded item IDs */
    expandedSet: Set<string>;
    /** Optional: extra content rendered at the end of each table-leaf label */
    renderTableActions?: (node: CatalogTreeNode) => React.ReactNode;
    /** Optional: called when a table node starts being dragged (HTML5 drag). */
    onDragStart?: (node: CatalogTreeNode, event: React.DragEvent) => void;
    /** Optional: called when the load-more sentinel is clicked. */
    onLoadMore?: (node: CatalogTreeNode, event: React.MouseEvent) => void;
}

/** Recursively render CatalogTreeNode[] as styled TreeItem elements */
export function renderCatalogTreeItems(
    nodes: CatalogTreeNode[],
    opts: RenderCatalogTreeOptions,
): React.ReactNode {
    const { loadedMap, expandedSet, renderTableActions, onDragStart, onLoadMore } = opts;

    return nodes.map((node) => {
        const itemId = node.path.join('/');
        const isLoadMore = node.node_type === 'load_more';
        const isTable = node.node_type === 'table';
        const isGroup = node.node_type === 'table_group';
        const sourceName = node.metadata?._source_name;
        const loaded = isTable ? loadedMap[node.name] || loadedMap[itemId] || (sourceName ? loadedMap[sourceName] : undefined) : undefined;
        const groupLoaded = isGroup ? loadedMap[itemId] : undefined;
        const childCount = !isTable && !isGroup && !isLoadMore ? (node.children?.length ?? 0) : 0;
        const tableCount = isGroup ? (node.metadata?.tables?.length ?? 0) : 0;
        const isExpanded = expandedSet.has(itemId);

        const nodeDescription = (isTable || isGroup) ? (node.metadata?.description || '') : '';

        const labelContent = isLoadMore ? (
            <Typography
                component="span"
                sx={{ fontSize: 12, color: 'primary.main', cursor: 'pointer' }}
                onClick={(e) => {
                    e.stopPropagation();
                    onLoadMore?.(node, e);
                }}
            >
                {node.name}
            </Typography>
        ) : (
            <Tooltip
                title={nodeDescription}
                placement="right"
                enterDelay={400}
                disableHoverListener={!nodeDescription}
            >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                {isGroup
                    ? <DashboardOutlinedIcon sx={{ fontSize: 16, color: groupLoaded ? 'success.main' : 'text.secondary', flexShrink: 0, opacity: 0.7 }} />
                    : isTable
                        ? <TableIcon sx={{ fontSize: 16, color: loaded ? 'success.main' : 'text.secondary', flexShrink: 0, opacity: 0.7 }} />
                        : <FolderOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0, opacity: 0.7 }} />
                }
                <Typography noWrap component="span" sx={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                    {node.name}
                </Typography>
                {(loaded || groupLoaded) && <CheckIcon sx={{ fontSize: 13, color: 'success.main', flexShrink: 0 }} />}
                {isTable && node.metadata?.row_count != null && (
                    <Typography component="span" sx={{ fontSize: 11, color: 'text.disabled', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                        {Number(node.metadata.row_count).toLocaleString()}
                    </Typography>
                )}
                {isGroup && tableCount > 0 && (
                    <Box component="span" sx={countBadgeSx}>
                        {tableCount}
                    </Box>
                )}
                {childCount > 0 && !isExpanded && (
                    <Box component="span" sx={countBadgeSx}>
                        {childCount}
                    </Box>
                )}
                {isTable && renderTableActions?.(node)}
            </Box>
            </Tooltip>
        );

        const dragProps = isTable && onDragStart
            ? {
                draggable: true,
                onDragStart: (e: React.DragEvent) => onDragStart(node, e),
            }
            : {};

        const isLazyNode = (node.node_type === 'namespace' || node.node_type === 'table_group') && !node.children;

        return (
            <StyledTreeItem key={itemId} itemId={itemId} label={labelContent} {...dragProps}>
                {node.children && renderCatalogTreeItems(node.children, opts)}
                {isLazyNode && <StyledTreeItem itemId={`${itemId}/__loading`} label={
                    <Typography sx={{ fontSize: 11, color: 'text.disabled', fontStyle: 'italic' }}>Loading…</Typography>
                } />}
            </StyledTreeItem>
        );
    });
}
