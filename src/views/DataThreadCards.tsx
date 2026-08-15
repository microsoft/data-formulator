// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { memo } from 'react';

import {
    Box,
    Typography,
    Stack,
    Card,
    IconButton,
    Tooltip,
    ButtonGroup,
    useTheme,
    alpha,
} from '@mui/material';

import { dfActions } from '../app/dfSlice';
import { DictTable, Trigger } from "../components/ComponentType";

import DeleteIcon from '@mui/icons-material/Delete';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AddchartIcon from '@mui/icons-material/Addchart';

import { TriggerCard } from './EncodingShelfCard';
import { ComponentBorderStyle, shadow, transition } from '../app/tokens';
import { iconVar, textVar } from '../app/layout';


// ─── Chart Card ──────────────────────────────────────────────────────────────

export let buildChartCard = (
    chartElement: { tableId: string, chartId: string, element: any, onDelete?: () => void, deleteTooltip?: string, unread?: boolean },
    focusedChartId?: string,
) => {
    let selectedClassName = focusedChartId == chartElement.chartId ? 'selected-card' : '';
    const isUnread = !!chartElement.unread;
    return <Box
        className="data-thread-chart-card-wrapper"
        sx={{
            position: 'relative',
            display: 'flex',
            alignItems: 'flex-start',
            width: 'fit-content',
            mx: 1,
            '& .data-thread-chart-delete-btn-external': { opacity: 0, transition: 'opacity 0.15s' },
            '&:hover .data-thread-chart-delete-btn-external': { opacity: 1 },
            '@keyframes unreadPulse': {
                '0%, 100%': { transform: 'scale(1)', opacity: 0.75 },
                '50%': { transform: 'scale(1.2)', opacity: 1 },
            },
        }}>
        <Card className={`data-thread-card ${selectedClassName}`} elevation={0}
            sx={{
                width: 'fit-content',
                display: 'flex',
                position: 'relative',
                border: 'none',
                borderRadius: '6px',
                backgroundColor: 'transparent',
                zIndex: 1,
                overflow: 'hidden',
            }}>
            {chartElement.element}
            {isUnread && (
                <Box sx={{
                    position: 'absolute',
                    top: 5,
                    right: 5,
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: '#FFC107',
                    boxShadow: '0 0 4px rgba(255, 193, 7, 0.85), 0 0 1px rgba(0,0,0,0.25)',
                    pointerEvents: 'none',
                    zIndex: 2,
                    animation: 'unreadPulse 1.6s ease-in-out infinite',
                }} />
            )}
        </Card>
        {chartElement.onDelete && (
            <Tooltip title={chartElement.deleteTooltip ?? ''}>
                <IconButton
                    className="data-thread-chart-delete-btn-external"
                    size="small"
                    color="error"
                    aria-label={chartElement.deleteTooltip ?? 'delete chart'}
                    sx={{
                        alignSelf: 'flex-start',
                        ml: 0.25,
                        padding: 0.5,
                        flexShrink: 0,
                        '&:hover': { transform: 'scale(1.15)' },
                    }}
                    onClick={(event) => { event.stopPropagation(); chartElement.onDelete?.(); }}
                >
                    <DeleteIcon sx={{ fontSize: iconVar.md }} />
                </IconButton>
            </Tooltip>
        )}
    </Box>
}

/** Wrap chart elements as thumbnail rows under their table. */
export let buildChartCards = (
    relevantCharts: { tableId: string, chartId: string, element: any }[],
    focusedChartId: string | undefined,
    collapsed: boolean = false,
) => {
    let collapsedProps = collapsed ? { width: '50%', "& canvas": { width: 60, maxHeight: 50 } } : { width: '100%' };
    return relevantCharts.map((ce) =>
        <Box key={`relevant-chart-${ce.chartId}`}
            data-chart-id={ce.chartId}
            sx={{
                display: 'flex', padding: 0, ...collapsedProps }}>
            {buildChartCard(ce, focusedChartId)}
        </Box>);
}

// ─── Table Reference Card ────────────────────────────────────────────────────

/**
 * A pointer to a table whose real card lives elsewhere — the shelf (a thread's
 * source origin) or an earlier column (a continuation's carried-over parent).
 * It is a reference, not a node: clickable, but it never carries charts, turns
 * or drafts.
 *
 * Focus is shown as `selected-ref-card`, not the full `selected-card` ring: the
 * ring means "this card is what the canvas is showing", and a focused table can
 * appear in several places at once. Only its owning card wears the ring, so a
 * single focused table never looks like several selections.
 */
export let buildTableRefChip = (props: {
    tableId: string;
    table: DictTable | undefined;
    displayName?: string;
    focused: boolean;
    dispatch: any;
}) => {
    const { tableId, table, displayName, focused, dispatch } = props;
    return <Box key={`regular-table-box-${tableId}`}
        data-table-id={tableId}
        className="data-thread-card-wrapper"
        sx={{ padding: '0px', display: 'flex', alignItems: 'center', gap: '2px' }}>
        <Card className={`data-thread-card ${focused ? 'selected-ref-card' : ''}`} elevation={0}
            sx={{ width: '100%',
                ...ComponentBorderStyle,
                borderRadius: '6px',
            }}
            onClick={() => {
                dispatch(dfActions.setFocused({ type: 'table', tableId }));
            }}>
            <Box sx={{ margin: '0px', display: 'flex', minWidth: 0, alignItems: 'center' }}>
                <Stack direction="row" sx={{ marginLeft: 0.5, marginRight: 'auto', fontSize: textVar.sm, flex: 1, minWidth: 0, overflow: 'hidden' }} alignItems="center" gap={"2px"}>
                    <Box sx={{ margin: '4px 8px 4px 2px', minWidth: 0, flex: 1 }}>
                        <Typography fontSize="inherit" sx={{
                            color: 'text.primary',
                            fontWeight: 500,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            wordBreak: 'break-all',
                        }}>{displayName?.trim() || table?.displayId || tableId}</Typography>
                    </Box>
                </Stack>
            </Box>
        </Card>
    </Box>
}

// ─── Trigger Card Wrapper ────────────────────────────────────────────────────

export let buildTriggerCard = (
    trigger: Trigger,
    focusedChartId: string | undefined,
    highlighted: boolean = false,
    dimmed: boolean = false,
) => {
    let selectedClassName = trigger.chart?.id == focusedChartId ? 'selected-card' : '';
    
    let triggerCard = <div key={'thread-card-trigger-box'}>
        <Box sx={{ flex: 1 }} >
            <TriggerCard className={selectedClassName} trigger={trigger} 
                hideFields={!!(trigger.interaction && trigger.interaction.length > 0)} 
                highlighted={highlighted}
                sx={{
                    '& .MuiBox-root': { mx: 0.5, my: 0.25 },
                    '& .MuiSvgIcon-root': { width: '12px', height: '12px' },
                }}
            />
        </Box>
    </div>;

    return <Box sx={{ display: 'flex', flexDirection: 'column' }} key={`trigger-card-${trigger.chart?.id}`}>
        {triggerCard}
    </Box>;
}

// ─── Table Card ──────────────────────────────────────────────────────────────

export interface BuildTableCardProps {
    tableId: string;
    tables: DictTable[];
    inferredDisplayName?: string;
    chartElements: { tableId: string, chartId: string, element: any }[];
    usedIntermediateTableIds: string[];
    highlightedTableIds: string[];
    focusedTableId: string | undefined;
    focusedChartId: string | undefined;
    parentTable: DictTable | undefined;
    tableIdList: string[];
    collapsed: boolean;
    dispatch: any;
    /** Only the source-table shelf offers a table menu; thread cards omit it. */
    handleOpenTableMenu?: (table: DictTable, anchorEl: HTMLElement) => void;
    primaryBgColor: string | undefined;
    /** i18n `t` from `useTranslation()` */
    t: (key: string, options?: Record<string, unknown>) => string;
    /** Whether source cards show their original name alongside the workspace identifier. */
    showOriginalName?: boolean;
}

export let buildTableCard = (props: BuildTableCardProps) => {
    const {
        tableId, tables, inferredDisplayName, chartElements, usedIntermediateTableIds,
        highlightedTableIds, focusedTableId, focusedChartId,
        parentTable, tableIdList, collapsed, dispatch,
        handleOpenTableMenu, primaryBgColor, t, showOriginalName = true,
    } = props;

    const getOriginalName = (tbl: DictTable | undefined): string | null => {
        if (!tbl || tbl.derive) return null;
        return tbl.source?.originalTableName || tbl.virtual?.tableId || tbl.id;
    };

    const getSourceTooltip = (tbl: DictTable | undefined): string | null => {
        if (!tbl || tbl.derive) return null;
        const src = tbl.source;
        if (!src) return null;
        switch (src.type) {
            case 'file': return src.fileName || t('dataThread.sourceFile');
            case 'paste': return t('dataThread.sourcePaste');
            case 'url': return src.url || t('dataThread.sourceUrl');
            case 'stream': return src.url || t('dataThread.sourceStream');
            case 'database': return src.databaseTable || t('dataThread.sourceDatabase');
            case 'example': return t('dataThread.sourceExample');
            case 'extract': return t('dataThread.sourceExtract');
            default: return null;
        }
    };

    // filter charts relevant to this
    let relevantCharts = chartElements.filter(ce => ce.tableId == tableId && !usedIntermediateTableIds.includes(tableId));

    let table = tables.find(t => t.id == tableId);
    const originalName = getOriginalName(table);
    const sourceTooltip = getSourceTooltip(table);
    const workspaceName = table?.displayId || tableId;
    const normalizeTableName = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, '');
    const friendlyName = inferredDisplayName?.trim()
        ? inferredDisplayName.trim()
        : workspaceName;
    const rawName = showOriginalName
        && originalName
        && normalizeTableName(originalName) !== normalizeTableName(friendlyName)
        ? originalName
        : null;

    let selectedClassName = tableId == focusedTableId ? 'selected-card' : '';

    let collapsedProps = collapsed ? { width: '50%', "& canvas": { width: 60, maxHeight: 50 } } : { width: '100%' }

    let releventChartElements = relevantCharts.map((ce, j) =>
        <Box key={`relevant-chart-${ce.chartId}`}
            data-chart-id={ce.chartId}
            sx={{ 
                display: 'flex', padding: 0, ...collapsedProps }}>
            {buildChartCard(ce, focusedChartId)}
        </Box>)

    const isHighlighted = highlightedTableIds.includes(tableId);

    const tableNameBlock = (
        <Box sx={{
            margin: '4px 8px 4px 2px', minWidth: 0, flex: 1,
            display: 'flex', alignItems: 'baseline', flexWrap: 'wrap',
            columnGap: 0.75, rowGap: 0.25,
        }}>
            <Typography fontSize="inherit" sx={{
                color: 'text.primary',
                fontWeight: 500,
                flex: '0 0 auto',
                minWidth: 0,
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            }}>{friendlyName}</Typography>
            {rawName && (
                <Typography sx={{
                    fontSize: textVar.xxs,
                    color: 'text.disabled',
                    lineHeight: 1.3,
                    flex: '0 0 auto',
                    minWidth: 0,
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}>
                    {rawName}
                </Typography>
            )}
        </Box>
    );

    let regularTableBox = <Box key={`regular-table-box-${tableId}`}
        data-table-id={tableId}
        className="data-thread-card-wrapper"
        sx={{ padding: '0px', display: 'flex', alignItems: 'center', gap: '2px' }}>
        <Card className={`data-thread-card ${selectedClassName}`} elevation={0}
            sx={{ width: '100%', 
                backgroundColor: primaryBgColor,
                ...ComponentBorderStyle,
                ...(isHighlighted ? { borderLeft: '2px solid', borderLeftColor: 'primary.main' } : {}),
                borderRadius: '6px',
                }}
            onClick={() => {
                dispatch(dfActions.setFocused({ type: 'table', tableId }));
            }}>
            <Box sx={{ margin: '0px', display: 'flex', minWidth: 0, alignItems: 'center',
                '& .delete-table-btn': { opacity: 0, transition: 'opacity 0.15s' },
                '&:hover .delete-table-btn': { opacity: 1 },
            }}>
                <Stack direction="row" sx={{ marginLeft: 0.5, marginRight: 'auto', fontSize: textVar.sm, flex: 1, minWidth: 0, overflow: 'hidden' }} alignItems="center" gap={"2px"}>
                    {sourceTooltip
                        ? <Tooltip title={sourceTooltip} placement="top" arrow><span style={{ minWidth: 0, flex: 1 }}>{tableNameBlock}</span></Tooltip>
                        : tableNameBlock}
                </Stack>
                {!table?.derive && handleOpenTableMenu && (
                    <ButtonGroup aria-label={t('dataThread.tableCardActionsAria')} variant="text" sx={{ textAlign: 'end', margin: "auto 2px auto auto", flexShrink: 0 }}>
                        <Tooltip key="more-options-btn-tooltip" title={t('dataThread.moreOptions')}>
                            <IconButton className="more-options-btn" color="primary" aria-label={t('dataThread.moreOptions')} size="small" sx={{ padding: 0.25, '&:hover': {
                                transform: 'scale(1.2)',
                                transition: transition.fast
                                } }}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleOpenTableMenu(table!, event.currentTarget);
                                }}
                            >
                                <MoreVertIcon fontSize="small" sx={{ fontSize: iconVar.md }} />
                            </IconButton>
                        </Tooltip>
                    </ButtonGroup>
                )}
                {table?.derive && (
                    <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                        <Tooltip title={t('dataThread.deleteTable')}>
                            <IconButton className="delete-table-btn" aria-label={t('dataThread.deleteTable')} size="small" color="error" sx={{ 
                                padding: 0.5, flexShrink: 0, mr: 0.25,
                                '&:hover': { transform: 'scale(1.15)' },
                            }}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    dispatch(dfActions.deleteTable(tableId));
                                }}
                            >
                                <DeleteIcon sx={{ fontSize: iconVar.md }} />
                            </IconButton>
                        </Tooltip>
                    </Box>
                )}
            </Box>
        </Card>
    </Box>

    return [
        regularTableBox,
        ...releventChartElements,
    ]
}
