// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useMemo, useRef, useState, useCallback, memo } from 'react';

import {
    Box,
    Divider,
    Typography,
    LinearProgress,
    Stack,
    ListItemIcon,
    Card,
    IconButton,
    Tooltip,
    ButtonGroup,
    useTheme,
    SxProps,
    Button,
    TextField
} from '@mui/material';

import { VegaLite } from 'react-vega'


import '../scss/VisualizationView.scss';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { assembleVegaChart, baseTableToExtTable, getTriggers } from '../app/utils';
import { Chart, DictTable, EncodingItem, Trigger } from "../components/ComponentType";

import DeleteIcon from '@mui/icons-material/Delete';
import AddchartIcon from '@mui/icons-material/Addchart';
import StarIcon from '@mui/icons-material/Star';
import SouthIcon from '@mui/icons-material/South';
import TableRowsIcon from '@mui/icons-material/TableRowsOutlined';
import AnchorIcon from '@mui/icons-material/Anchor';
import PanoramaFishEyeIcon from '@mui/icons-material/PanoramaFishEye';
import InsightsIcon from '@mui/icons-material/Insights';
import CheckIcon from '@mui/icons-material/Check';

import _ from 'lodash';
import { getChartTemplate } from '../components/ChartTemplates';
import { findBaseFields } from './ViewUtils';

import 'prismjs/components/prism-python' // Language
import 'prismjs/components/prism-typescript' // Language
import 'prismjs/themes/prism.css'; //Example style, you can use another

import { chartAvailabilityCheck, generateChartSkeleton, getDataTable } from './VisualizationView';
import { TriggerCard } from './EncodingShelfCard';

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

let buildChartCard = (chartElement: { tableId: string, chartId: string, element: any },
    focusedChartId?: string) => {
    let selectedClassName = focusedChartId == chartElement.chartId ? 'selected-card' : '';
    return <Card className={`data-thread-card ${selectedClassName}`} variant="outlined"
        sx={{
            marginLeft: 1,
            width: '100%',
            display: 'flex'
        }}>
        {chartElement.element}
    </Card>
}

const EditableTableName: FC<{
    initialValue: string,
    tableId: string,
    handleUpdateTableDisplayId: (tableId: string, displayId: string) => void,
    nonEditingSx?: SxProps
}> = ({ initialValue, tableId, handleUpdateTableDisplayId, nonEditingSx }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [inputValue, setInputValue] = useState(initialValue);
    
    const handleSubmit = (e?: React.MouseEvent | React.KeyboardEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        if (inputValue.trim() !== '') {  // Only update if input is not empty
            handleUpdateTableDisplayId(tableId, inputValue);
            setIsEditing(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSubmit(e);
        } else if (e.key === 'Escape') {
            setInputValue(initialValue);
            setIsEditing(false);
        }
    };

    if (!isEditing) {
        return (
            <Tooltip title="edit table name">
                <Typography
                    onClick={(event) => {
                        event.stopPropagation();
                        setIsEditing(true);
                    }}
                    sx={{
                        ...nonEditingSx,
                        fontSize: 'inherit',
                        minWidth: '60px',
                        maxWidth: '100px',
                        wordWrap: 'break-word',
                        whiteSpace: 'normal',
                        ml: 0.25,
                        padding: '2px',
                        '&:hover': {
                            backgroundColor: 'rgba(0,0,0,0.04)',
                            borderRadius: '2px',
                            cursor: 'pointer'
                        }
                    }}
                >
                    {initialValue}
                </Typography>
            </Tooltip>
        );
    }

    return (
        <Box
            component="span"
            onClick={(event) => event.stopPropagation()}
            sx={{
                display: 'flex',
                alignItems: 'center',
                position: 'relative',
                ml: 0.25,
            }}
        >
            <TextField
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                variant="filled"
                size="small"
                onBlur={(e) => {
                    // Only reset if click is not on the submit button
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setInputValue(initialValue);
                        setIsEditing(false);
                    }
                }}
                sx={{
                    '& .MuiFilledInput-root': {
                        fontSize: 'inherit',
                        padding: 0,
                        '& input': {
                            padding: '2px 24px 2px 8px',
                            width: '80px',
                        }
                    }
                }}
            />
            <IconButton
                size="small"
                onMouseDown={(e) => {
                    e.preventDefault(); // Prevent blur from firing before click
                }}
                onClick={(e) => handleSubmit(e)}
                sx={{
                    position: 'absolute',
                    right: 2,
                    padding: '2px',
                    minWidth: 'unset',
                    zIndex: 1,
                    '& .MuiSvgIcon-root': {
                        fontSize: '0.8rem'
                    }
                }}
            >
                <CheckIcon />
            </IconButton>
        </Box>
    );
};

let SingleThreadView: FC<{
    scrollRef: any,
    threadIdx: number,
    leafTable: DictTable;
    chartElements: { tableId: string, chartId: string, element: any }[];
    usedIntermediateTableIds: string[],
    sx?: SxProps
}> = function ({
    scrollRef,
    threadIdx,
    leafTable,
    chartElements,
    usedIntermediateTableIds, // tables that have been used
    sx
}) {
        let tables = useSelector((state: DataFormulatorState) => state.tables);
        let charts = useSelector((state: DataFormulatorState) => state.charts);
        let focusedChartId = useSelector((state: DataFormulatorState) => state.focusedChartId);
        let focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);

        let handleUpdateTableDisplayId = (tableId: string, displayId: string) => {
            dispatch(dfActions.updateTableDisplayId({
                tableId: tableId,
                displayId: displayId
            }));
        }   

        const theme = useTheme();

        let focusedChart = charts.find(c => c.id == focusedChartId);

        const dispatch = useDispatch();

        let [collapsed, setCollapsed] = useState<boolean>(false);

        const w: any = (a: any[], b: any[], spaceElement?: any) => a.length ? [a[0], b.length == 0 ? "" : (spaceElement || ""), ...w(b, a.slice(1), spaceElement)] : b;

        let content: any = ""

        let tableIdList = [leafTable.id]
        let triggerCards: any[] = []
        let triggers = getTriggers(leafTable, tables);

        let highlightedTableIds: string[] = [leafTable.id];

        if (leafTable.derive) {

            // find the first table that belongs to this thread, it should not be an intermediate table that has appeared in previous threads
            let firstNewTableIndex = triggers.findIndex(tg => !usedIntermediateTableIds.includes(tg.tableId));

            // when firstNewTableIndex is -1, it means the leaf table should be the first one to display at the top of the thread
            if (firstNewTableIndex == -1) {
                triggers = [];
            } else {
                triggers = triggers.slice(firstNewTableIndex);
            }

            tableIdList = [...triggers.map((trigger) => trigger.tableId), leafTable.id];
            highlightedTableIds = focusedTableId && tableIdList.includes(focusedTableId) ? tableIdList : [];

            triggerCards = triggers.map((trigger, i) => {

                let selectedClassName = trigger.chartRef == focusedChartId ? 'selected-card' : '';

                let extractActiveFields = (t: Trigger) => {
                    let encodingMap = (charts.find(c => c.id == t.chartRef) as Chart).encodingMap
                    return Array.from(Object.values(encodingMap)).map((enc: EncodingItem) => enc.fieldID).filter(x => x != undefined);
                };

                let previousActiveFields = new Set(i == 0 ? [] : extractActiveFields(triggers[i - 1]))
                let currentActiveFields = new Set(extractActiveFields(trigger))
                let fieldsIdentical = _.isEqual(previousActiveFields, currentActiveFields)

                let triggerCard = <div key={'thread-card-trigger-box'}>
                    <Box sx={{ flex: 1 }} >
                        <TriggerCard className={selectedClassName} trigger={trigger} hideFields={fieldsIdentical} />
                    </Box>
                </div>;

                return <Box sx={{ display: 'flex', flexDirection: 'column' }} key={`trigger-card-${trigger.chartRef}`}>
                    {triggerCard}
                    <ListItemIcon key={'down-arrow'} sx={{ minWidth: 0 }}>
                        <SouthIcon sx={{ fontSize: "inherit", 
                            color: highlightedTableIds.includes(trigger.tableId) ? theme.palette.primary.light : 'darkgray' }} />
                    </ListItemIcon>
                </Box>;
            });

        } else {
            highlightedTableIds = focusedTableId && tableIdList.includes(focusedTableId) ? tableIdList : [];
        }

        let originTableIdOfThread  = tables.find(t => t.id == leafTable.id)?.derive?.trigger.sourceTableIds[0];
        if (originTableIdOfThread == tableIdList[0]) {
            originTableIdOfThread = undefined;
        }

        let tableElementList = tableIdList.map((tableId, i) => {

            if (tableId == leafTable.id && leafTable.anchored && tableIdList.length > 1) {
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
                            transition: 'all 0.2s ease',
                            '&:hover': {
                                backgroundColor: 'rgba(0, 0, 0, 0.04)',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                            }
                        }}
                        onClick={(event) => {
                            event.stopPropagation();
                            dispatch(dfActions.setFocusedTable(tableId));
                            
                            // Find and set the first chart associated with this table
                            let firstRelatedChart = charts.find((c: Chart) => c.tableRef == tableId && c.intermediate == undefined) 
                                || charts.find((c: Chart) => c.tableRef == tableId);
                            
                            if (firstRelatedChart) {
                                if (firstRelatedChart.intermediate == undefined) {
                                    dispatch(dfActions.setFocusedChart(firstRelatedChart.id));
                                }
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

            // filter charts relavent to this
            let relevantCharts = chartElements.filter(ce => ce.tableId == tableId && !usedIntermediateTableIds.includes(tableId));

            let table = tables.find(t => t.id == tableId);

            let selectedClassName = tableId == focusedTableId ? 'selected-card' : '';

            let collapsedProps = collapsed ? { width: '50%', "& canvas": { width: 60, maxHeight: 50 } } : { width: '100%' }

            let releventChartElements = relevantCharts.map((ce, j) =>
                <Box key={`relevant-chart-${ce.chartId}`}
                    sx={{
                        display: 'flex', padding: 0, paddingBottom: j == relevantCharts.length - 1 ? 1 : 0.5,
                        ...collapsedProps
                    }}>
                    {buildChartCard(ce, focusedChartId)}
                </Box>)

            // only charts without dependency can be deleted
            let tableDeleteEnabled = !tables.some(t => t.derive?.trigger.tableId == tableId);

            let regularTableBox = <Box ref={relevantCharts.some(c => c.chartId == focusedChartId) ? scrollRef : null} 
                sx={{ padding: '0px' }}>
                <Card className={`data-thread-card ${selectedClassName}`} variant="outlined"
                    sx={{ width: '100%', background: 'aliceblue',
                        borderLeft: highlightedTableIds.includes(tableId) ? 
                            `3px solid ${theme.palette.primary.light}` : '1px solid lightgray',
                     }}
                    onClick={() => {
                        dispatch(dfActions.setFocusedTable(tableId));
                        if (focusedChart?.tableRef != tableId) {
                            let firstRelatedChart = charts.find((c: Chart) => c.tableRef == tableId && c.intermediate == undefined) || charts.find((c: Chart) => c.tableRef == tableId);
                            if (firstRelatedChart) {
                                if (firstRelatedChart.intermediate == undefined) {
                                    dispatch(dfActions.setFocusedChart(firstRelatedChart.id));
                                }
                            } else {
                                dispatch(dfActions.createNewChart({ tableId: tableId }));
                            }
                        }
                    }}>
                    <Box sx={{ margin: '0px', display: 'flex' }}>
                        <Stack direction="row" sx={{ marginLeft: 0.5, marginRight: 'auto', fontSize: 12 }} alignItems="center" gap={"2px"}>
                            <IconButton color="primary" sx={{
                                minWidth: 0, 
                                padding: 0.25,
                                '&:hover': {
                                    transform: 'scale(1.3)',
                                    transition: 'all 0.2s ease'
                                },
                                '&.Mui-disabled': {
                                    color: 'rgba(0, 0, 0, 0.5)'
                                }
                            }} 
                            size="small" 
                            disabled={table?.derive == undefined || tables.some(t => t.derive?.trigger.tableId == tableId)}
                            onClick={(event) => {
                                event.stopPropagation();
                                dispatch(dfActions.updateTableAnchored({tableId: tableId, anchored: !table?.anchored}));
                            }}>
                                <Tooltip title={table?.anchored ? "unanchor table" : "anchor table"}>
                                    <span>  {/* Wrapper span needed for disabled IconButton tooltip */}
                                        <IconButton color="primary" sx={{
                                            minWidth: 0, 
                                            padding: 0.25,
                                            '&:hover': {
                                                transform: 'scale(1.1)',
                                                transition: 'all 0.2s ease',
                                            },
                                            '&.Mui-disabled': {
                                                color: 'rgba(0, 0, 0, 0.5)'
                                            }
                                        }} 
                                        size="small" 
                                        disabled={table?.derive == undefined || tables.some(t => t.derive?.trigger.tableId == tableId)}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            dispatch(dfActions.updateTableAnchored({tableId: tableId, anchored: !table?.anchored}));
                                        }}>
                                            {table?.anchored ? 
                                                <AnchorIcon sx={{ 
                                                    fontSize: tableId === focusedTableId ? 20 : 16,
                                                    color: tableId === focusedTableId ? theme.palette.primary.main : 'rgba(0,0,0,0.5)',
                                                    fontWeight: tableId === focusedTableId ? 'bold' : 'normal',
                                                }} /> : 
                                                <TableRowsIcon sx={{ fontSize: 16 }} />
                                            }
                                        </IconButton>
                                    </span>
                                </Tooltip>
                            </IconButton>
                            <Box sx={{ margin: '4px 8px 4px 2px' }}>
                                {focusedTableId == tableId ? <EditableTableName
                                    initialValue={table?.displayId || tableId}
                                    tableId={tableId}
                                    handleUpdateTableDisplayId={handleUpdateTableDisplayId}
                                /> : <Typography fontSize="inherit" sx={{
                                    textAlign: 'center',
                                    color:  'rgba(0,0,0,0.7)', 
                                    maxWidth: '100px',
                                    wordWrap: 'break-word',
                                    whiteSpace: 'normal'
                                }}>{table?.displayId || tableId}</Typography>}
                            </Box>
                        </Stack>
                        <ButtonGroup aria-label="Basic button group" variant="text" sx={{ textAlign: 'end', margin: "auto 2px auto auto" }}>
                            {tableDeleteEnabled && <Tooltip title="delete table">
                                <IconButton aria-label="share" size="small" sx={{ padding: 0.25, '&:hover': {
                                    transform: 'scale(1.2)',
                                    transition: 'all 0.2s ease'
                                } }}>
                                    <DeleteIcon fontSize="small" sx={{ fontSize: 18 }} color='warning'
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            dispatch(dfActions.deleteTable(tableId));
                                        }} />
                                </IconButton>
                            </Tooltip>}
                            <Tooltip title="create a new chart">
                                <IconButton aria-label="share" size="small" sx={{ padding: 0.25, '&:hover': {
                                    transform: 'scale(1.2)',
                                    transition: 'all 0.2s ease'
                                } }}>
                                    <AddchartIcon fontSize="small" sx={{ fontSize: 18 }} color='primary'
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            dispatch(dfActions.createNewChart({ tableId: tableId }));
                                        }} />
                                </IconButton>
                            </Tooltip>
                        </ButtonGroup>
                    </Box>
                </Card>
            </Box>

            let chartElementProps = collapsed ? { display: 'flex', flexWrap: 'wrap' } : {}

            return [
                regularTableBox,
                <Box
                    key={`table-${tableId}`}
                    sx={{ display: 'flex', flexDirection: 'row' }}>
                    <Box sx={{
                        minWidth: '1px', padding: '0px', width: '8px', flex: 'none', display: 'flex',
                        marginLeft: highlightedTableIds.includes(tableId) ? '7px' : '8px',
                        borderLeft: highlightedTableIds.includes(tableId) ? 
                            `3px solid ${theme.palette.primary.light}` : '1px dashed darkgray',
                    }}>
                        <Box sx={{
                            padding: 0, width: '1px', margin: 'auto',
                            backgroundImage: 'linear-gradient(180deg, darkgray, darkgray 75%, transparent 75%, transparent 100%)',
                            backgroundSize: '1px 6px, 3px 100%'
                        }}></Box>
                    </Box>
                    <Box sx={{ flex: 1, padding: '8px 0px', minHeight: '8px', ...chartElementProps }}>
                        {releventChartElements}
                    </Box>
                </Box>,
                (i == tableIdList.length - 1) ?
                    <Box sx={{ marginLeft: "6px", marginTop: '-10px' }}>
                        <PanoramaFishEyeIcon sx={{ fontSize: 5 }} />
                    </Box> : ""
            ]
        });

        content = w(tableElementList, triggerCards, "")

        return <Box sx={{ ...sx }} data-thread-index={threadIdx}>
            <Box sx={{ display: 'flex', direction: 'ltr', margin: 1 }}>
                <Divider flexItem sx={{
                    margin: 'auto',
                    "& .MuiDivider-wrapper": { display: 'flex', flexDirection: 'row' },
                    "&::before, &::after": { borderColor: 'darkgray', borderWidth: '2px', width: 50 },
                }}>
                    <Typography sx={{ fontSize: "10px", fontWeight: 'bold', color: 'text.secondary', textTransform: 'none' }}>
                        {`thread - ${threadIdx + 1}`}
                    </Typography>
                </Divider>
            </Box>
            <div style={{ padding: '2px 4px 2px 4px', marginTop: 0, marginBottom: '8px', direction: 'ltr' }}>
                {originTableIdOfThread && <Box sx={{ direction: 'ltr' }}>
                    <Typography sx={{ ml: 0.25, fontSize: "10px", color: 'text.secondary', textTransform: 'none' }}>
                        {`${tables.find(t => t.id === originTableIdOfThread)?.displayId || originTableIdOfThread}`}
                    </Typography>
                    <Box sx={{
                        height: '14px',
                        ml: 1,
                        borderLeft: highlightedTableIds.includes(originTableIdOfThread) ? `3px solid ${theme.palette.primary.light}` : `1px dashed rgba(0, 0, 0, 0.3)`
                    }}></Box>
                </Box>}
                {content}
            </div>
        </Box>
    }

const ChartElement = memo<{
    chart: Chart,
    assembledSpec: any,
    table: any,
    chartSynthesisInProgress: string[],
    isSaved?: boolean,
    onChartClick: (chartId: string, tableId: string) => void,
    onDelete: (chartId: string) => void
}>(({ chart, assembledSpec, table, chartSynthesisInProgress, isSaved, onChartClick, onDelete }) => {
    const id = `data-thread-chart-Element-${chart.id}`;

    return (
        <Box
            onClick={() => onChartClick(chart.id, table.id)}
            className="vega-thumbnail-box"
            style={{ width: "100%", position: "relative", cursor: "pointer !important" }}
        >
            <Box sx={{ margin: "auto" }}>
                {isSaved && <Typography sx={{ position: "absolute", margin: "5px", zIndex: 2 }}>
                    <StarIcon sx={{ color: "gold" }} fontSize="small" />
                </Typography>}
                {chartSynthesisInProgress.includes(chart.id) && <Box sx={{
                    position: "absolute", height: "100%", width: "100%", zIndex: 20,
                    backgroundColor: "rgba(243, 243, 243, 0.8)", display: "flex", alignItems: "center", cursor: "pointer"
                }}>
                    <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.05 }} />
                </Box>}
                <Box className='data-thread-chart-card-action-button'
                    sx={{ zIndex: 10, color: 'blue', position: "absolute", right: 1, background: 'rgba(255, 255, 255, 0.95)' }}>
                    <Tooltip title="delete chart">
                        <IconButton 
                            size="small" 
                            color="warning" 
                            onClick={(event) => {
                                event.stopPropagation();
                                onDelete(chart.id);
                            }}
                        >
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
                <Box className={"vega-thumbnail"}
                    id={id}
                    sx={{
                        display: "flex",
                        backgroundColor: isSaved ? "rgba(255,215,0,0.05)" : "white",
                        '& .vega-embed': { margin: 'auto' },
                        '& canvas': { width: 'auto !important', height: 'auto !important', maxWidth: 120, maxHeight: 100 }
                    }}
                >
                    <VegaLite spec={assembledSpec} actions={false} />
                </Box>
            </Box>
        </Box>
    );
});

export const DataThread: FC<{}> = function ({ }) {

    let tables = useSelector((state: DataFormulatorState) => state.tables);
    let charts = useSelector((state: DataFormulatorState) => state.charts);
    let focusedChartId = useSelector((state: DataFormulatorState) => state.focusedChartId);

    let chartSynthesisInProgress = useSelector((state: DataFormulatorState) => state.chartSynthesisInProgress);

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    let [threadDrawerOpen, setThreadDrawerOpen] = useState<boolean>(false);

    const scrollRef = useRef<null | HTMLDivElement>(null)

    const executeScroll = () => { if (scrollRef.current != null) scrollRef.current.scrollIntoView() }
    // run this function from an event handler or an effect to execute scroll 

    const dispatch = useDispatch();

    useEffect(() => {
        executeScroll();
    }, [threadDrawerOpen])

    // excluding base tables or tables from saved charts
    let derivedFields = conceptShelfItems.filter(f => f.source == "derived");

    // when there is no result and synthesis is running, just show the waiting panel

    // // we don't always render it, so make this a function to enable lazy rendering
    const handleChartClick = useCallback((chartId: string, tableId: string) => {
        dispatch(dfActions.setFocusedChart(chartId));
        dispatch(dfActions.setFocusedTable(tableId));
    }, [dispatch]);

    let chartElements = useMemo(() => charts.filter(chart => !chart.intermediate).map((chart) => {
        const table = getDataTable(chart, tables, charts, conceptShelfItems);

        let toDeriveFields = derivedFields.filter(f => f.name != "").filter(f => findBaseFields(f, conceptShelfItems).every(f2 => table.names.includes(f2.name)))
        let extTable = baseTableToExtTable(JSON.parse(JSON.stringify(table.rows)), toDeriveFields, conceptShelfItems);

        if (chart.chartType == "Auto") {
            let element = <Box sx={{ position: "relative", width: "fit-content", display: "flex", flexDirection: "column", margin: 'auto', color: 'darkgray' }}>
                <InsightsIcon fontSize="medium" />
            </Box>
            return { chartId: chart.id, tableId: table.id, element }
        }

        let [available, unfilledFields] = chartAvailabilityCheck(chart.encodingMap, conceptShelfItems, extTable);

        if (!available || chart.chartType == "Table") {

            console.log(">>> chart = ", chart)

            let chartTemplate = getChartTemplate(chart.chartType);

            let element = <Box key={`unavailable-${chart.id}`} width={"100%"}
                className={"vega-thumbnail vega-thumbnail-box"}
                onClick={() => handleChartClick(chart.id, table.id)}
                sx={{
                    display: "flex", backgroundColor: "rgba(0,0,0,0.01)", position: 'relative',
                    //border: "0.5px dashed lightgray", 
                    flexDirection: "column"
                }}>
                {chartSynthesisInProgress.includes(chart.id) ? <Box sx={{
                    position: "absolute", height: "100%", width: "100%", zIndex: 20,
                    backgroundColor: "rgba(243, 243, 243, 0.8)", display: "flex", alignItems: "center", cursor: "pointer"
                }}>
                    <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.05 }} />
                </Box> : ''}
                <Box sx={{ display: "flex", flexDirection: "column", margin: "auto" }}>
                    <Box sx={{ margin: "auto" }} >
                        {generateChartSkeleton(chartTemplate?.icon, 48, 48)}
                    </Box>
                    <Box className='data-thread-chart-card-action-button'
                        sx={{ zIndex: 10, color: 'blue', position: "absolute", right: 1, background: 'rgba(255, 255, 255, 0.95)' }}>
                        <Tooltip title="delete chart">
                            <IconButton size="small" color="warning" onClick={(event) => {
                                event.stopPropagation();
                                dispatch(dfActions.deleteChartById(chart.id));
                            }}><DeleteIcon fontSize="small" /></IconButton>
                        </Tooltip>
                    </Box>
                </Box>
            </Box>;
            return { chartId: chart.id, tableId: table.id, element }
        }

        // prepare the chart to be rendered
        let assembledChart = assembleVegaChart(chart.chartType, chart.encodingMap, conceptShelfItems, extTable, 20);
        assembledChart["background"] = "transparent";

        // Temporary fix, down sample the dataset
        if (assembledChart["data"]["values"].length > 5000) {
            let values = assembledChart["data"]["values"];
            assembledChart = (({ data, ...o }) => o)(assembledChart);

            let getRandom = (seed: number) => {
                let x = Math.sin(seed++) * 10000;
                return x - Math.floor(x);
            }
            let getRandomSubarray = (arr: any[], size: number) => {
                let shuffled = arr.slice(0), i = arr.length, temp, index;
                while (i--) {
                    index = Math.floor((i + 1) * getRandom(233 * i + 888));
                    temp = shuffled[index];
                    shuffled[index] = shuffled[i];
                    shuffled[i] = temp;
                }
                return shuffled.slice(0, size);
            }
            assembledChart["data"] = { "values": getRandomSubarray(values, 5000) };
        }

        assembledChart['config'] = {
            "axis": { "labelLimit": 30 }
        }

        const element = <ChartElement
            chart={chart}
            assembledSpec={assembledChart}
            table={table}
            chartSynthesisInProgress={chartSynthesisInProgress}
            isSaved={chart.saved}
            onChartClick={handleChartClick}
            onDelete={(chartId) => dispatch(dfActions.deleteChartById(chartId))}
        />;

        return { chartId: chart.id, tableId: table.id, element };
    }), [charts, tables, conceptShelfItems, chartSynthesisInProgress, handleChartClick]);


    // anchors are considered leaf tables to simplify the view
    let leafTables = [...tables.filter(t => (t.anchored && t.derive)), ...tables.filter(t => !tables.some(t2 => t2.derive?.trigger.tableId == t.id))];
    
    console.log(`leafTables: ${leafTables.map(t => t.id)}`);

    // we want to sort the leaf tables by the order of their ancestors
    // for example if ancestor of list a is [0, 3] and the ancestor of list b is [0, 2] then b should come before a
    let tableOrder = Object.fromEntries(tables.map((table, index) => [table.id, index]));
    let getAncestorOrders = (leafTable: DictTable) => {
        let triggers = getTriggers(leafTable, tables);
        return [...triggers.map(t => tableOrder[t.tableId]), tableOrder[leafTable.id]];
    }

    leafTables.sort((a, b) => {
        let aAncestors = getAncestorOrders(a);
        let bAncestors = getAncestorOrders(b);
        
        // If lengths are equal, compare ancestors in order
        for (let i = 0; i < Math.min(aAncestors.length, bAncestors.length); i++) {
            if (aAncestors[i] !== bAncestors[i]) {
                return aAncestors[i] - bAncestors[i];
            }
        }
        
        // If all ancestors are equal, compare the leaf tables themselves
        return aAncestors.length - bAncestors.length;
    });

    let drawerOpen = leafTables.length > 1 && threadDrawerOpen;
    let threadDrawerWidth = Math.max(Math.min(600, leafTables.length * 200), 212)

    let view = <Box width={drawerOpen ? threadDrawerWidth + 12 : 224} sx={{ 
        overflowY: 'auto',
        position: 'relative',
        display: 'flex', 
        flexDirection: drawerOpen ? 'row-reverse' : 'column',
        minHeight: '100%',
        transition: 'all 0.3s ease',
    }}>
        {leafTables.map((lt, i) => {
            let usedIntermediateTableIds = leafTables.slice(0, i)
                .map(x => [ ...getTriggers(x, tables).map(y => y.tableId) || []]).flat();
            return <SingleThreadView
                key={`thread-${lt.id}-${i}`}
                scrollRef={scrollRef} 
                threadIdx={i} 
                leafTable={lt} 
                chartElements={chartElements} 
                usedIntermediateTableIds={usedIntermediateTableIds} 
                sx={{
                    backgroundColor: (i % 2 == 1 ? "rgba(0, 0, 0, 0.03)" : 'white'), 
                    padding: '8px 8px',
                    flex: drawerOpen ? 1 : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    height: 'calc(100% - 16px)',
                    width: '208px', 
                    transition: 'all 0.3s ease',
                }} />
        })}
    </Box>


    let jumpButtonsDrawerOpen = <ButtonGroup size="small" color="primary">
        {_.chunk(Array.from({length: leafTables.length}, (_, i) => i), 3).map((group, groupIdx) => {
            const startNum = group[0] + 1;
            const endNum = group[group.length - 1] + 1;
            const label = startNum === endNum ? `${startNum}` : `${startNum}-${endNum}`;
            
            return (
                <Tooltip key={`thread-nav-group-${groupIdx}`} title={`Jump to thread${startNum === endNum ? '' : 's'} ${label}`}>
                    <IconButton
                        size="small"
                        color="primary"
                        sx={{ fontSize: '12px' }}
                        onClick={() => {
                            setTimeout(() => {
                                // Get currently most visible thread index
                                const viewportCenter = window.innerWidth / 2;
                                const currentIndex = Array.from(document.querySelectorAll('[data-thread-index]')).reduce((closest, element) => {
                                    const rect = element.getBoundingClientRect();
                                    const distance = Math.abs(rect.left + rect.width/2 - viewportCenter);
                                    if (!closest || distance < closest.distance) {
                                        return { index: parseInt(element.getAttribute('data-thread-index') || '0'), distance };
                                    }
                                    return closest;
                                }, null as { index: number, distance: number } | null)?.index || 0;

                                // If moving from larger to smaller numbers (scrolling left), target first element
                                // If moving from smaller to larger numbers (scrolling right), target last element
                                const targetIndex = currentIndex > group[0] ? group[0] : group[group.length - 1];
                                
                                const targetElement = document.querySelector(`[data-thread-index="${targetIndex}"]`);
                                if (targetElement) {
                                    targetElement.scrollIntoView({
                                        behavior: 'smooth',
                                        block: 'nearest', // Don't change vertical scroll
                                        inline: currentIndex > group[group.length - 1] ? 'start' : 'end'
                                    });
                                }
                            }, 100);
                        }}
                    >
                        {label}
                    </IconButton>
                </Tooltip>
            );
        })}
    </ButtonGroup>

    let jumpButtonDrawerClosed = <ButtonGroup size="small" color="primary" sx={{ gap: 0 }}>
        {leafTables.map((_, idx) => (
            <Tooltip key={`thread-nav-${idx}`} title={`Jump to thread ${idx + 1}`}>
                <IconButton 
                    size="small" 
                    color="primary"
                    sx={{ fontSize: '12px', padding: '4px' }} 
                    onClick={() => {
                        const threadElement = document.querySelector(`[data-thread-index="${idx}"]`);
                        threadElement?.scrollIntoView({ behavior: 'smooth' });
                    }}
                > 
                    {idx + 1}
                </IconButton>
            </Tooltip>
        ))}
    </ButtonGroup>

    let jumpButtons = drawerOpen ? jumpButtonsDrawerOpen : jumpButtonDrawerClosed;


    let carousel = (
        <Box className="data-thread" sx={{ overflow: 'hidden', }}>
            <Box sx={{
                direction: 'ltr', display: 'flex',
                paddingTop: "10px", paddingLeft: '12px', alignItems: 'center', justifyContent: 'space-between'
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography className="view-title" component="h2" sx={{ marginTop: "6px" }}>
                        Data Threads
                    </Typography>
                    {jumpButtons}
                </Box>
                
                <Tooltip title={drawerOpen ? "collapse" : "expand"}>
                    <IconButton size={'small'} color="primary" disabled={leafTables.length <= 1} onClick={() => { setThreadDrawerOpen(!threadDrawerOpen); }}>
                        {drawerOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
                    </IconButton>
                </Tooltip>
            </Box>
            <Box sx={{
                transition: 'width 200ms cubic-bezier(0.4, 0, 0.2, 1) 0ms', overflowY: 'auto',
                direction: 'rtl', display: 'block', flex: 1
            }}
                 className="thread-view-mode">
                {view}
            </Box>
        </Box>
    );

    return <Box sx={{ display: 'flex', flexDirection: 'row' }}>
        {carousel}
    </Box>;
}


