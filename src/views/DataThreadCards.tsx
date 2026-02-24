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
) => {
    let selectedClassName = trigger.chart?.id == focusedChartId ? 'selected-card' : '';
    
    let triggerCard = <div key={'thread-card-trigger-box'}>
        <Box sx={{ flex: 1 }} >
            <TriggerCard className={selectedClassName} trigger={trigger} 
                hideFields={trigger.instruction != ""} 
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
}

export let buildTableCard = (props: BuildTableCardProps) => {
    const {
        tableId, tables, charts, chartElements, usedIntermediateTableIds,
        highlightedTableIds, focusedTableId, focusedChartId, focusedChart,
        parentTable, tableIdList, collapsed, scrollRef, dispatch,
        handleOpenTableMenu, primaryBgColor,
    } = props;

    if (parentTable && tableId == parentTable.id && parentTable.anchored && tableIdList.length > 1) {
        let table = tables.find(t => t.id == tableId);
        return <Typography sx={{ background: 'transparent', }} >
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
                    <Typography fontSize="inherit" sx={{
                        textAlign: 'center',
                        color: 'rgba(0,0,0,0.7)', 
                        maxWidth: '100px',
                        wordWrap: 'break-word',
                        whiteSpace: 'normal'
                    }}>
                        {table?.displayId || tableId}
                    </Typography>
                </Stack>
            </Box>
        </Typography>
    }

    // filter charts relevant to this
    let relevantCharts = chartElements.filter(ce => ce.tableId == tableId && !usedIntermediateTableIds.includes(tableId));

    let table = tables.find(t => t.id == tableId);

    let selectedClassName = tableId == focusedTableId ? 'selected-card' : '';

    let collapsedProps = collapsed ? { width: '50%', "& canvas": { width: 60, maxHeight: 50 } } : { width: '100%' }

    let releventChartElements = relevantCharts.map((ce, j) =>
        <Box key={`relevant-chart-${ce.chartId}`}
            sx={{ 
                display: 'flex', padding: 0, ...collapsedProps }}>
            {buildChartCard(ce, focusedChartId)}
        </Box>)

    const isHighlighted = highlightedTableIds.includes(tableId);

    let regularTableBox = <Box key={`regular-table-box-${tableId}`} ref={relevantCharts.some(c => c.chartId == focusedChartId) ? scrollRef : null} 
        sx={{ padding: '0px' }}>
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
            <Box sx={{ margin: '0px', display: 'flex', minWidth: 0 }}>
                <Stack direction="row" sx={{ marginLeft: 0.5, marginRight: 'auto', fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden' }} alignItems="center" gap={"2px"}>
                    <Box sx={{ margin: '4px 8px 4px 2px', display: 'flex', alignItems: 'center', minWidth: 0, flex: 1 }}>
                        <Typography fontSize="inherit" sx={{
                            color: 'text.primary', 
                            fontWeight: 500,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            wordBreak: 'break-all',
                        }}>{table?.displayId || tableId}</Typography>
                    </Box>
                </Stack>
                <ButtonGroup aria-label="Basic button group" variant="text" sx={{ textAlign: 'end', margin: "auto 2px auto auto", flexShrink: 0 }}>
                    <Tooltip key="create-chart-btn-tooltip" title="create chart">
                        <IconButton className="create-chart-btn" color="primary" aria-label="create chart" size="small" sx={{ padding: 0.25, '&:hover': {
                            transform: 'scale(1.2)',
                            transition: transition.fast
                            } }}
                            onClick={(event) => {
                                event.stopPropagation();
                                dispatch(dfActions.setFocused({ type: 'table', tableId }));
                            }}
                        >
                            <AddchartIcon fontSize="small" sx={{ fontSize: 16 }} />
                        </IconButton>
                    </Tooltip>
                    <Tooltip key="more-options-btn-tooltip" title="more options">
                        <IconButton className="more-options-btn" color="primary" aria-label="more options" size="small" sx={{ padding: 0.25, '&:hover': {
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
            </Box>
        </Card>
    </Box>

    return [
        regularTableBox,
        ...releventChartElements,
    ]
}
