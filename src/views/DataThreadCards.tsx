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
} from '@mui/material';

import { dfActions } from '../app/dfSlice';
import { Chart, DictTable, Trigger } from "../components/ComponentType";

import DeleteIcon from '@mui/icons-material/Delete';
import { AnchorIcon } from '../icons';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AddchartIcon from '@mui/icons-material/Addchart';

import { TriggerCard } from './EncodingShelfCard';
import { ComponentBorderStyle, shadow, transition } from '../app/tokens';
import { SaveExperienceButton, isLeafDerivedTable } from './SaveExperienceButton';


// ─── Chart Card ──────────────────────────────────────────────────────────────

export let buildChartCard = (
    chartElement: { tableId: string, chartId: string, element: any },
    focusedChartId?: string,
) => {
    let selectedClassName = focusedChartId == chartElement.chartId ? 'selected-card' : '';
    return <Card className={`data-thread-card ${selectedClassName}`} elevation={0}
        sx={{
            width: 'fit-content',
            display: 'flex',
            position: 'relative',
            border: 'none',
            borderRadius: '6px',
            backgroundColor: 'white',
            px: 1,
        }}>
        {chartElement.element}
    </Card>
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
    charts: Chart[];
    chartElements: { tableId: string, chartId: string, element: any }[];
    usedIntermediateTableIds: string[];
    highlightedTableIds: string[];
    focusedTableId: string | undefined;
    focusedChartId: string | undefined;
    focusedChart: Chart | undefined;
    parentTable: DictTable | undefined;
    tableIdList: string[];
    collapsed: boolean;
    scrollRef: any;
    dispatch: any;
    handleOpenTableMenu: (table: DictTable, anchorEl: HTMLElement) => void;
    primaryBgColor: string | undefined;
    /** i18n `t` from `useTranslation()` */
    t: (key: string, options?: Record<string, unknown>) => string;
    /** Whether to show the original file name under the table name (default: true) */
    showOriginalName?: boolean;
    /** Whether this card should appear dimmed (unfocused, not highlighted) */
    dimmed?: boolean;
}

export let buildTableCard = (props: BuildTableCardProps) => {
    const {
        tableId, tables, charts, chartElements, usedIntermediateTableIds,
        highlightedTableIds, focusedTableId, focusedChartId, focusedChart,
        parentTable, tableIdList, collapsed, scrollRef, dispatch,
        handleOpenTableMenu, primaryBgColor, t, showOriginalName = true,
        dimmed = false,
    } = props;

    const getOriginalName = (tbl: DictTable | undefined): string | null => {
        if (!tbl || tbl.derive) return null;
        const name = tbl.source?.originalTableName;
        if (!name || name === (tbl.displayId || tbl.id)) return null;
        return name;
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

    if (parentTable && tableId == parentTable.id && parentTable.anchored && tableIdList.length > 1) {
        let table = tables.find(t => t.id == tableId);
        const anchoredOriginalName = getOriginalName(table);
        const anchoredTooltip = getSourceTooltip(table);
        const anchoredContent = (
            <Box 
                sx={{ 
                    margin: '0px', 
                    width: 'fit-content',
                    display: 'flex', 
                    cursor: 'pointer',
                    padding: '2px 4px',
                    borderRadius: '4px',
                    '&:hover': {
                        backgroundColor: 'rgba(0, 0, 0, 0.04)',
                        boxShadow: shadow.sm
                    }
                }}
                onClick={(event) => {
                    event.stopPropagation();
                    dispatch(dfActions.setFocused({ type: 'table', tableId }));
                }}
            >
                <Stack direction="row" sx={{ marginLeft: 0.25, marginRight: 'auto', fontSize: 12 }} alignItems="center" gap={"2px"}>
                    <AnchorIcon sx={{ fontSize: 14, color: 'rgba(0,0,0,0.5)' }} />
                    <Box>
                        <Typography fontSize="inherit" sx={{
                            textAlign: 'center',
                            color: 'rgba(0,0,0,0.7)', 
                            maxWidth: '100px',
                            wordWrap: 'break-word',
                            whiteSpace: 'normal'
                        }}>
                            {table?.displayId || tableId}
                        </Typography>
                        {anchoredOriginalName && (
                            <Typography sx={{
                                fontSize: 9,
                                color: 'text.disabled',
                                lineHeight: 1.2,
                                mt: 0.5,
                                wordBreak: 'break-all',
                                maxWidth: '100px',
                            }}>
                                {anchoredOriginalName}
                            </Typography>
                        )}
                    </Box>
                </Stack>
            </Box>
        );
        return <Typography sx={{ background: 'transparent' }}>
            {anchoredTooltip
                ? <Tooltip title={anchoredTooltip} placement="right" arrow><span>{anchoredContent}</span></Tooltip>
                : anchoredContent}
        </Typography>
    }

    // filter charts relevant to this
    let relevantCharts = chartElements.filter(ce => ce.tableId == tableId && !usedIntermediateTableIds.includes(tableId));

    let table = tables.find(t => t.id == tableId);
    const originalName = getOriginalName(table);
    const sourceTooltip = getSourceTooltip(table);

    let selectedClassName = tableId == focusedTableId ? 'selected-card' : '';

    let collapsedProps = collapsed ? { width: '50%', "& canvas": { width: 60, maxHeight: 50 } } : { width: '100%' }

    let releventChartElements = relevantCharts.map((ce, j) =>
        <Box key={`relevant-chart-${ce.chartId}`}
            sx={{ 
                display: 'flex', padding: 0, ...collapsedProps }}>
            {buildChartCard(ce, focusedChartId)}
        </Box>)

    const isHighlighted = highlightedTableIds.includes(tableId);

    const tableNameBlock = (
        <Box sx={{ margin: '4px 8px 4px 2px', minWidth: 0, flex: 1 }}>
            <Typography fontSize="inherit" sx={{
                color: 'text.primary', 
                fontWeight: 500,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-all',
            }}>{table?.displayId || tableId}</Typography>
            {showOriginalName && originalName && (
                <Typography sx={{
                    fontSize: 10,
                    color: 'text.disabled',
                    lineHeight: 1.3,
                    mt: 0.5,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}>
                    {originalName}
                </Typography>
            )}
        </Box>
    );

    let regularTableBox = <Box key={`regular-table-box-${tableId}`} ref={relevantCharts.some(c => c.chartId == focusedChartId) ? scrollRef : null} 
        className="data-thread-card-wrapper"
        sx={{ padding: '0px', display: 'flex', alignItems: 'center', gap: '2px' }}>
        <Card className={`data-thread-card ${selectedClassName}`} elevation={0}
            sx={{ width: '100%', 
                backgroundColor: primaryBgColor,
                ...(dimmed ? { opacity: 0.45 } : {}),
                ...ComponentBorderStyle,
                ...(isHighlighted ? { borderLeft: '2px solid', borderLeftColor: 'primary.main' } : {}),
                borderRadius: '6px',
                }}
            onClick={() => {
                dispatch(dfActions.setFocused({ type: 'table', tableId }));
            }}>
            <Box sx={{ margin: '0px', display: 'flex', minWidth: 0, alignItems: 'center',
                '& .delete-table-btn, & .save-exp-btn': { opacity: 0, transition: 'opacity 0.15s' },
                '&:hover .delete-table-btn, &:hover .save-exp-btn': { opacity: 1 },
            }}>
                <Stack direction="row" sx={{ marginLeft: 0.5, marginRight: 'auto', fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden' }} alignItems="center" gap={"2px"}>
                    {sourceTooltip
                        ? <Tooltip title={sourceTooltip} placement="top" arrow><span style={{ minWidth: 0, flex: 1 }}>{tableNameBlock}</span></Tooltip>
                        : tableNameBlock}
                </Stack>
                {!table?.derive && (
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
                                <MoreVertIcon fontSize="small" sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Tooltip>
                    </ButtonGroup>
                )}
                {table?.derive && (
                    <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                        {isLeafDerivedTable(table, tables) && (
                            <Box className="save-exp-btn" onClick={(e) => e.stopPropagation()}>
                                <SaveExperienceButton
                                    table={table!}
                                    tables={tables}
                                />
                            </Box>
                        )}
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
                                <DeleteIcon sx={{ fontSize: 16 }} />
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
