// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * GallerySidebar — persistent left-side navigation for ChartGallery.
 *
 * Tree structure: Section > Category > Page.
 * Built on @mui/x-tree-view (same stack as DataSourceSidebar) so keyboard
 * navigation comes for free. Styling follows the `StyledTreeItem` look from
 * `components/CatalogTree.tsx` but kept local to the gallery to avoid
 * over-coupling.
 */

import React, { useMemo } from 'react';
import { styled, Box, Typography } from '@mui/material';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem, treeItemClasses } from '@mui/x-tree-view/TreeItem';
import QuestionMarkIcon from '@mui/icons-material/QuestionMark';

import { borderColor } from '../app/tokens';
import { CHART_ICONS } from '../components/ChartTemplates';
import { GALLERY_TREE, type GalleryTreeSection } from '../lib/agents-chart/test-data';

// ---------- Styled tree item (local copy of the CatalogTree look) ----------

const StyledTreeItem = styled(TreeItem)(({ theme }) => ({
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
        [`& .${treeItemClasses.iconContainer}:empty`]: { display: 'none' },
        [`& .${treeItemClasses.label}`]: { fontSize: 13 },
        '&:hover': { backgroundColor: theme.palette.action.hover },
    },
    [`& > .${treeItemClasses.content}.Mui-selected`]: {
        backgroundColor: theme.palette.action.selected,
        fontWeight: 500,
        '&:hover': { backgroundColor: theme.palette.action.selected },
    },
})) as typeof TreeItem;

// ---------- Helpers ----------

/** Short labels (used in EC/CJS chart-type pages) to canonical CHART_ICONS keys. */
const CHART_ICON_ALIAS: Record<string, string> = {
    'Scatter':     'Scatter Plot',
    'Bar':         'Bar Chart',
    'Stacked Bar': 'Stacked Bar Chart',
    'Grouped Bar': 'Grouped Bar Chart',
    'Line':        'Line Chart',
    'Area':        'Area Chart',
    'Pie':         'Pie Chart',
    'Rose':        'Rose Chart',
    'Radar':       'Radar Chart',
    'Bump':        'Bump Chart',
    'Pyramid':     'Pyramid Chart',
    'Candlestick': 'Candlestick Chart',
    'Waterfall':   'Waterfall Chart',
    'Dotted Line': 'Dotted Line Chart',
    'Ranged Dot':  'Ranged Dot Plot',
    'Density':     'Density Plot',
    'Strip':       'Strip Plot',
};

function chartIconFor(label: string): React.ReactElement {
    const hit = CHART_ICONS[label] ?? CHART_ICONS[CHART_ICON_ALIAS[label] ?? ''];
    if (hit) return hit;
    // Fallback for chart-type pages without a dedicated icon.
    return <QuestionMarkIcon sx={{ fontSize: 12, color: 'text.disabled' }} />;
}

export type GalleryPath = readonly [string, string, string];

function itemIdForPath(path: GalleryPath): string {
    return path.join('/');
}
function pathFromItemId(id: string): GalleryPath | null {
    const parts = id.split('/');
    if (parts.length !== 3) return null;
    return [parts[0], parts[1], parts[2]] as const;
}

/** Compute which items should be expanded to reveal the selected leaf. */
export function ancestorsOf(path: GalleryPath): string[] {
    const [s, c] = path;
    return [s, `${s}/${c}`];
}

// ---------- Component ----------

const PANEL_WIDTH = 260;

export const GallerySidebar: React.FC<{
    selected: GalleryPath;
    expanded: string[];
    onSelect: (path: GalleryPath) => void;
    onExpandedChange: (expanded: string[]) => void;
}> = ({ selected, expanded, onSelect, onExpandedChange }) => {
    const selectedItemId = useMemo(() => itemIdForPath(selected), [selected]);

    return (
        <Box
            sx={{
                width: PANEL_WIDTH,
                minWidth: PANEL_WIDTH,
                borderRight: `1px solid ${borderColor.view}`,
                bgcolor: 'background.paper',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            }}
        >
            <Box sx={{ flex: 1, overflow: 'auto', py: 1, pb: 8, px: 0.5 }}>
                <SimpleTreeView
                    selectedItems={selectedItemId}
                    expandedItems={expanded}
                    onExpandedItemsChange={(_e, items) => onExpandedChange(items)}
                    onItemClick={(_e, itemId) => {
                        const p = pathFromItemId(itemId);
                        if (p) onSelect(p);
                    }}
                    itemChildrenIndentation={8}
                >
                    {GALLERY_TREE.map(section => renderSection(section))}
                </SimpleTreeView>
            </Box>
        </Box>
    );
};

// ---------- Tree rendering ----------

function renderSection(section: GalleryTreeSection): React.ReactNode {
    // If a section has exactly one page (e.g. overview), render it as a direct leaf.
    const isLeafOnly =
        section.categories.length === 1 &&
        section.categories[0].pages.length === 1 &&
        section.categories[0].id === 'overview';

    if (isLeafOnly) {
        const cat = section.categories[0];
        const page = cat.pages[0];
        const itemId = `${section.id}/${cat.id}/${page.id}`;
        return (
            <StyledTreeItem
                key={section.id}
                itemId={itemId}
                label={<Row label={section.label} bold />}
            />
        );
    }

    // Section as an expandable parent.  Use a synthetic itemId (sectionId only)
    // so expand/collapse works; sections are not selectable themselves.
    return (
        <StyledTreeItem
            key={section.id}
            itemId={section.id}
            label={<Row label={section.label} bold />}
        >
            {section.categories.flatMap(cat => {
                const catId = `${section.id}/${cat.id}`;
                const isChartTypes = cat.id === 'chart-types';
                // When the section has only one category, skip the category
                // wrapper so pages sit directly under the section.
                if (section.categories.length === 1) {
                    return cat.pages.map(page => (
                        <StyledTreeItem
                            key={page.id}
                            itemId={`${catId}/${page.id}`}
                            label={<Row label={page.label} icon={isChartTypes ? chartIconFor(page.label) : null} />}
                        />
                    ));
                }
                return [
                    <StyledTreeItem
                        key={catId}
                        itemId={catId}
                        label={<Row label={cat.label} />}
                    >
                        {cat.pages.map(page => (
                            <StyledTreeItem
                                key={page.id}
                                itemId={`${catId}/${page.id}`}
                                label={<Row label={page.label} icon={isChartTypes ? chartIconFor(page.label) : null} />}
                            />
                        ))}
                    </StyledTreeItem>,
                ];
            })}
        </StyledTreeItem>
    );
}

const Row: React.FC<{ label: string; bold?: boolean; icon?: React.ReactNode | null }> = ({ label, bold, icon }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        {icon && (
            <Box sx={{ width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.8 }}>
                {icon}
            </Box>
        )}
        <Typography
            noWrap
            component="span"
            sx={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: bold ? 600 : 400 }}
        >
            {label}
        </Typography>
    </Box>
);
