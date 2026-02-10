// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { memo } from 'react';

import {
    Box,
    Divider,
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
import AddchartIcon from '@mui/icons-material/Addchart';
import { AnchorIcon } from '../icons';
import SettingsIcon from '@mui/icons-material/Settings';
import CloseIcon from '@mui/icons-material/Close';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';

import { TriggerCard } from './EncodingShelfCard';
import { ThinkingBanner } from './DataThread';
import { ComponentBorderStyle, shadow, transition } from '../app/tokens';


// ─── Agent Status Box ────────────────────────────────────────────────────────

export const AgentStatusBox = memo<{
    tableId: string;
    relevantAgentActions: any[];
    dispatch: any;
}>(({ tableId, relevantAgentActions, dispatch }) => {

    let theme = useTheme();

    let agentStatus = undefined;

    let getAgentStatusColor = (status: string) => {
        switch (status) {
            case 'running':
                return `${theme.palette.text.secondary} !important`;
            case 'completed':
                return `${theme.palette.success.main} !important`;
            case 'failed':
                return `${theme.palette.error.main} !important`;
            case 'warning':
                return `${theme.palette.warning.main} !important`;
            default:
                return `${theme.palette.text.secondary} !important`;
        }
    }

    let currentActions = relevantAgentActions;

    if (currentActions.some(a => a.status == 'running')) {
        agentStatus = 'running';
    } else if (currentActions.every(a => a.status == 'completed')) {
        agentStatus = 'completed';
    } else if (currentActions.every(a => a.status == 'failed')) {
        agentStatus = 'failed';
    } else {
        agentStatus = 'warning';
    }
    
    if (currentActions.length === 0) {
        return null;
    }

    return (
        <Box sx={{ padding: '0px 8px' }}>
            {(
                <Box sx={{ 
                    py: 1, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'left',
                    '& .MuiSvgIcon-root, .MuiTypography-root': {
                        fontSize: 10,
                        color: getAgentStatusColor(agentStatus)
                    },
                }}>
                    {agentStatus === 'running' && ThinkingBanner('thinking...', { py: 0.5 })}
                    {agentStatus === 'completed' && <CheckCircleOutlineIcon />}
                    {agentStatus === 'failed' && <CancelOutlinedIcon />}
                    {agentStatus === 'warning' && <HelpOutlineIcon />}
                    <Typography variant="body2" sx={{ 
                        ml: 0.5, 
                        fontSize: 10,
                    }}>
                        {agentStatus === 'warning' && 'hmm...'}
                        {agentStatus === 'failed' && 'oops...'}
                        {agentStatus === 'completed' && 'completed'}
                        {agentStatus === 'running' && ''}
                    </Typography>
                    <Tooltip title="Delete message">
                        <IconButton
                            className="delete-button"
                            size="small"
                            sx={{
                                padding: '2px',
                                ml: 'auto',
                                transition: 'opacity 0.1s ease-in-out',
                                '& .MuiSvgIcon-root': { fontSize: 12, color: 'darkgray !important' }
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                dispatch(dfActions.deleteAgentWorkInProgress(relevantAgentActions[0].actionId));
                            }}
                        >
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
            )}
            {currentActions.map((a, index, array) => {
                let descriptions = String(a.description).split('\n');
                return (
                    <React.Fragment key={a.actionId + "-" + index}>
                        <Box sx={{ 
                            position: 'relative',
                        }}>
                            {descriptions.map((line: string, lineIndex: number) => (
                                <React.Fragment key={lineIndex}>
                                    <Typography variant="body2" sx={{ 
                                        fontSize: 10, 
                                        color: getAgentStatusColor(a.status),
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word'
                                    }}>
                                        {line}
                                    </Typography>
                                    {lineIndex < descriptions.length - 1 && <Divider sx={{ my: 0.5, }} />}
                                </React.Fragment>
                            ))}
                        </Box>
                        {index < array.length - 1 && array.length > 1 && (
                            <Box sx={{ 
                                ml: 1, 
                                height: '1px', 
                                backgroundColor: 'rgba(0, 0, 0, 0.2)', 
                                my: 0.5 
                            }} />
                        )}
                    </React.Fragment>
                )
            })}
        </Box>
    );
});

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
    agentActions: any[];
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
        highlightedTableIds, agentActions, focusedTableId, focusedChartId, focusedChart,
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
                    transition: transition.fast,
                    '&:hover': {
                        backgroundColor: 'rgba(0, 0, 0, 0.04)',
                        boxShadow: shadow.sm
                    }
                }}
                onClick={(event) => {
                    event.stopPropagation();
                    dispatch(dfActions.setFocusedTable(tableId));
                    
                    // Find and set the first chart associated with this table
                    let firstRelatedChart = charts.find((c: Chart) => c.tableRef == tableId && c.source != "trigger");
                    
                    if (firstRelatedChart) {
                        dispatch(dfActions.setFocusedChart(firstRelatedChart.id));
                    }
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
                ...(isHighlighted ? { borderColor: 'primary.main' } : {}),
                borderRadius: '6px',
                }}
            onClick={() => {
                dispatch(dfActions.setFocusedTable(tableId));
                if (focusedChart?.tableRef != tableId) {
                    let firstRelatedChart = charts.find((c: Chart) => c.tableRef == tableId && c.source != 'trigger');
                    if (firstRelatedChart) {
                        dispatch(dfActions.setFocusedChart(firstRelatedChart.id));
                    }
                }
            }}>
            <Box sx={{ margin: '0px', display: 'flex' }}>
                <Stack direction="row" sx={{ marginLeft: 0.5, marginRight: 'auto', fontSize: 12 }} alignItems="center" gap={"2px"}>
                    <Box sx={{ margin: '4px 8px 4px 2px', display: 'flex', alignItems: 'center' }}>
                        <Typography fontSize="inherit" sx={{
                            textAlign: 'center',
                            color: 'text.primary', 
                            fontWeight: 500,
                            maxWidth: 160,
                            wordWrap: 'break-word',
                            whiteSpace: 'normal'
                        }}>{table?.displayId || tableId}</Typography>
                    </Box>
                </Stack>
                <ButtonGroup aria-label="Basic button group" variant="text" sx={{ textAlign: 'end', margin: "auto 2px auto auto" }}>
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
                            <SettingsIcon fontSize="small" sx={{ fontSize: 16 }} />
                        </IconButton>
                    </Tooltip>
                    <Tooltip key="create-new-chart-btn-tooltip" title="create a new chart">
                        <IconButton aria-label="create chart" size="small" sx={{ padding: 0.25, '&:hover': {
                            transform: 'scale(1.2)',
                            transition: transition.fast
                            } }}
                            onClick={(event) => {
                                event.stopPropagation();
                                dispatch(dfActions.setFocusedTable(tableId));
                                dispatch(dfActions.setFocusedChart(undefined));
                            }}
                        >   
                            <AddchartIcon fontSize="small" sx={{ fontSize: 18 }} color='primary'/>
                        </IconButton>
                    </Tooltip>
                </ButtonGroup>
            </Box>
        </Card>
    </Box>

    let relevantAgentActions = agentActions.filter(a => a.tableId == tableId).filter(a => a.hidden == false);

    let agentActionBox = (
        <AgentStatusBox 
            tableId={tableId}
            relevantAgentActions={relevantAgentActions}
            dispatch={dispatch}
        />
    )

    return [
        regularTableBox,
        ...releventChartElements,
        ...(relevantAgentActions.length > 0 ? [
            <Box key={`table-agent-actions-box-${tableId}`}
                sx={{ flex: 1, padding: '0px', minHeight: '0px' }}>
                {agentActionBox}
            </Box>
        ] : [])
    ]
}
