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
    TextField,
    CircularProgress
} from '@mui/material';

import { VegaLite } from 'react-vega'


import '../scss/VisualizationView.scss';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, SSEMessage } from '../app/dfSlice';
import { assembleVegaChart, getTriggers } from '../app/utils';
import { Chart, DictTable, EncodingItem, FieldItem, Trigger } from "../components/ComponentType";

import DeleteIcon from '@mui/icons-material/Delete';
import AddchartIcon from '@mui/icons-material/Addchart';
import CreateChartifact from '@mui/icons-material/Description';
import StarIcon from '@mui/icons-material/Star';
import SouthIcon from '@mui/icons-material/South';
import TableRowsIcon from '@mui/icons-material/TableRowsOutlined';
import AnchorIcon from '@mui/icons-material/Anchor';
import PanoramaFishEyeIcon from '@mui/icons-material/PanoramaFishEye';
import InsightsIcon from '@mui/icons-material/Insights';
import CheckIcon from '@mui/icons-material/Check';

import _ from 'lodash';
import { getChartTemplate } from '../components/ChartTemplates';
import { ChartElements, ChartifactDialog } from './ChartifactDialog';

import 'prismjs/components/prism-python' // Language
import 'prismjs/components/prism-typescript' // Language
import 'prismjs/themes/prism.css'; //Example style, you can use another

import { checkChartAvailability, generateChartSkeleton, getDataTable } from './VisualizationView';
import { TriggerCard } from './EncodingShelfCard';

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';

import { alpha } from '@mui/material/styles';

import { dfSelectors } from '../app/dfSlice';

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
                        maxWidth: '90px',
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
                            width: '64px',
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
    onOpenChartifactDialog: (chartElements: ChartElements[]) => void,
    sx?: SxProps
}> = function ({
    scrollRef,
    threadIdx,
    leafTable,
    chartElements,
    usedIntermediateTableIds, // tables that have been used
    onOpenChartifactDialog,
    sx
}) {
        let tables = useSelector((state: DataFormulatorState) => state.tables);
        let charts = useSelector(dfSelectors.getAllCharts);
        let focusedChartId = useSelector((state: DataFormulatorState) => state.focusedChartId);
        let focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);
        let pendingSSEActions = useSelector((state: DataFormulatorState) => state.pendingSSEActions);

        let handleUpdateTableDisplayId = (tableId: string, displayId: string) => {
            dispatch(dfActions.updateTableDisplayId({
                tableId: tableId,
                displayId: displayId
            }));
        }   

        const theme = useTheme();

        let focusedChart = useSelector((state: DataFormulatorState) => charts.find(c => c.id == focusedChartId));

        const dispatch = useDispatch();

        let [collapsed, setCollapsed] = useState<boolean>(false);

        const w: any = (a: any[], b: any[], spaceElement?: any) => a.length ? [a[0], b.length == 0 ? "" : (spaceElement || ""), ...w(b, a.slice(1), spaceElement)] : b;

        let content: any = ""

        let tableIdList = [leafTable.id]
        let triggerCards: any[] = []
        let triggers = getTriggers(leafTable, tables);

        let highlightedTableIds: string[] = [leafTable.id];
        
        let threadOriginalTableId: string | undefined =  leafTable.derive?.trigger.sourceTableIds[0];
        let triggerToFirstNewTable: Trigger | undefined = undefined;

        if (leafTable.derive) {

            // find the first table that belongs to this thread, it should not be an intermediate table that has appeared in previous threads
            let firstNewTableIndex = triggers.findIndex(tg => !usedIntermediateTableIds.includes(tg.tableId));
            let firstNewTableId = firstNewTableIndex != -1 ? triggers[firstNewTableIndex].tableId : leafTable.id;

            triggerToFirstNewTable = triggers.find(t => t.resultTableId == firstNewTableId);

            // when firstNewTableIndex is -1, it means the leaf table should be the first one to display at the top of the thread
            if (firstNewTableIndex == -1) {
                triggers = [];
            } else {
                triggers = triggers.slice(firstNewTableIndex);
            }

            tableIdList = [...triggers.map((trigger) => trigger.tableId), leafTable.id];
            highlightedTableIds = focusedTableId && tableIdList.includes(focusedTableId) ? tableIdList : [];

            triggerCards = triggers.map((trigger, i) => {

                let selectedClassName = trigger.chart?.id == focusedChartId ? 'selected-card' : '';
                
                let extractActiveFields = (t: Trigger) => {
                    let encodingMap = t.chart?.encodingMap;
                    if (!encodingMap) {
                        return [];
                    }
                    return Array.from(Object.values(encodingMap)).map((enc: EncodingItem) => enc.fieldID).filter(x => x != undefined);
                };

                let previousActiveFields = new Set(i == 0 ? [] : extractActiveFields(triggers[i - 1]))
                let currentActiveFields = new Set(extractActiveFields(trigger))
                let fieldsIdentical = _.isEqual(previousActiveFields, currentActiveFields)

                let triggerCard = <div key={'thread-card-trigger-box'}>
                    <Box sx={{ flex: 1 }} >
                        <TriggerCard className={selectedClassName} trigger={trigger} hideFields={fieldsIdentical && trigger.instruction != ""} />
                    </Box>
                </div>;

                return <Box sx={{ display: 'flex', flexDirection: 'column' }} key={`trigger-card-${trigger.chart?.id}`}>
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

            // filter charts relavent to this
            let relevantCharts = chartElements.filter(ce => ce.tableId == tableId && !usedIntermediateTableIds.includes(tableId));

            let table = tables.find(t => t.id == tableId);

            let selectedClassName = tableId == focusedTableId ? 'selected-card' : '';

            let collapsedProps = collapsed ? { width: '50%', "& canvas": { width: 60, maxHeight: 50 } } : { width: '100%' }

            let releventChartElements = relevantCharts.map((ce, j) =>
                <Box key={`relevant-chart-${ce.chartId}`}
                    sx={{ display: 'flex', padding: 0, pb: j == relevantCharts.length - 1 ? 1 : 0.5, ...collapsedProps }}>
                    {buildChartCard(ce, focusedChartId)}
                </Box>)

            // only charts without dependency can be deleted
            let tableDeleteEnabled = !tables.some(t => t.derive?.trigger.tableId == tableId);

            let tableCardIcon =  ( table?.anchored ? 
                <AnchorIcon sx={{ 
                    fontSize: tableId === focusedTableId ? 20 : 16,
                    color: tableId === focusedTableId ? theme.palette.primary.main : 'rgba(0,0,0,0.5)',
                    fontWeight: tableId === focusedTableId ? 'bold' : 'normal',
                }} /> : 
                <TableRowsIcon sx={{ fontSize: 16 }} /> )

            let regularTableBox = <Box ref={relevantCharts.some(c => c.chartId == focusedChartId) ? scrollRef : null} 
                sx={{ padding: '0px' }}>
                <Card className={`data-thread-card ${selectedClassName}`} variant="outlined"
                    sx={{ width: '100%', backgroundColor: alpha(theme.palette.primary.light, 0.1),
                        borderLeft: highlightedTableIds.includes(tableId) ? 
                            `3px solid ${theme.palette.primary.light}` : '1px solid lightgray',
                     }}
                    onClick={() => {
                        dispatch(dfActions.setFocusedTable(tableId));
                        if (focusedChart?.tableRef != tableId) {
                            let firstRelatedChart = charts.find((c: Chart) => c.tableRef == tableId && c.source != 'trigger');
                            if (firstRelatedChart) {
                                dispatch(dfActions.setFocusedChart(firstRelatedChart.id));
                            } else {
                                //dispatch(dfActions.createNewChart({ tableId: tableId, chartType: '?' }));
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
                                            {tableCardIcon}
                                        </IconButton>
                                    </span>
                                </Tooltip>
                            </IconButton>
                            <Box sx={{ margin: '4px 8px 4px 2px', display: 'flex', alignItems: 'center' }}>
                                {table?.virtual? <CloudQueueIcon sx={{ fontSize: 10, }} /> : ""}
                                {focusedTableId == tableId ? <EditableTableName
                                    initialValue={table?.displayId || tableId}
                                    tableId={tableId}
                                    handleUpdateTableDisplayId={handleUpdateTableDisplayId}
                                /> : <Typography fontSize="inherit" sx={{
                                    textAlign: 'center',
                                    color:  'rgba(0,0,0,0.7)', 
                                    maxWidth: '90px',
                                    ml: table?.virtual ? 0.5 : 0,
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
                                            dispatch(dfActions.createNewChart({ tableId: tableId, chartType: '?' }));
                                        }} />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="download as Chartifact document">
                                <IconButton aria-label="sdhare" size="small" sx={{ padding: 0.25, '&:hover': {
                                    transform: 'scale(1.2)',
                                    transition: 'all 0.2s ease'
                                } }}>
                                    <CreateChartifact fontSize="small" sx={{ fontSize: 18 }} color='primary'
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onOpenChartifactDialog(relevantCharts);
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
                        {(pendingSSEActions.some(a => a.data?.source_table_ids[0] == tableId) )&& 
                            <Box sx={{ 
                            py: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', }}>
                                <Typography sx={{ mr: 1,fontSize: '10px', color: 'rgba(0,0,0,0.5)' }}>
                                    agent is deriving data...
                                </Typography>
                                <PrecisionManufacturingIcon sx={{ 
                                    fontSize: 16, 
                                    color: 'rgba(0,0,0,0.5)',
                                    animation: 'spin 2s linear infinite',
                                    '@keyframes spin': {
                                        '0%': {
                                            transform: 'scale(1)',
                                        },
                                        '25%': {
                                            transform: 'rotate(30deg) scale(1.5)',
                                        },
                                        '50%': {
                                            transform: 'scale(1)',
                                        },
                                        '75%': {
                                            transform: 'rotate(330deg) scale(1.5)',
                                        },
                                        '100%': {
                                            transform: 'rotate(360deg) scale(1)',
                                        },
                                    }
                                }} />
                            </Box>}
                    </Box>
                </Box>,
                
                ,
                (i == tableIdList.length - 1) ?
                    <Box sx={{ marginLeft: "6px", marginTop: '-10px' }}>
                        <PanoramaFishEyeIcon sx={{ fontSize: 5 }} />
                    </Box> : ""
            ]
        });

        content = w(tableElementList, triggerCards, "")

        let selectedClassName = focusedChartId == triggerToFirstNewTable?.chart?.id ? 'selected-card' : '';

        return <Box sx={{ ...sx, '& .selected-card': { border: `2px solid ${theme.palette.primary.light}` } }} data-thread-index={threadIdx}>
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
                {threadOriginalTableId && !tableIdList.includes(threadOriginalTableId) && 
                    <Box sx={{ direction: 'ltr' }}>
                        <Typography sx={{ ml: 0.25, fontSize: "10px", color: 'text.secondary', textTransform: 'none' }}>
                            {`${tables.find(t => t.id === threadOriginalTableId)?.displayId || threadOriginalTableId}`}
                        </Typography>
                        <Box sx={{
                            height: '14px',
                            ml: 1,
                            borderLeft: highlightedTableIds.includes(threadOriginalTableId) ? `3px solid ${theme.palette.primary.light}` : `1px dashed rgba(0, 0, 0, 0.3)`
                        }}></Box>
                    {triggerToFirstNewTable && threadOriginalTableId != triggerToFirstNewTable.tableId && <React.Fragment>
                            <Typography sx={{ ml: 0.25, fontSize: "10px", color: 'text.secondary', textTransform: 'none' }}>
                                {`${tables.find(t => t.id === triggerToFirstNewTable.tableId)?.displayId || triggerToFirstNewTable.tableId}`}
                            </Typography>
                            <Box sx={{
                                height: '14px',
                                ml: 1,
                                borderLeft: highlightedTableIds.includes((triggerToFirstNewTable as Trigger).resultTableId) ? `3px solid ${theme.palette.primary.light}` : `1px dashed rgba(0, 0, 0, 0.3)`
                            }}></Box>
                        </React.Fragment>}
                    {triggerToFirstNewTable && 
                        <div key={'thread-card-trigger-box'}>
                            <Box sx={{ flex: 1 }} >
                                <TriggerCard className={selectedClassName} trigger={triggerToFirstNewTable} hideFields={false} />
                            </Box>
                        </div>}
                        <Box sx={{
                            height: '14px',
                            ml: 1,
                            borderLeft: highlightedTableIds.includes((triggerToFirstNewTable as Trigger).resultTableId) ? `3px solid ${theme.palette.primary.light}` : `1px dashed rgba(0, 0, 0, 0.3)`
                        }}></Box>
                    </Box>
                }
                {content}
            </div>
        </Box>
    }

const VegaLiteChartElement = memo<{
    chart: Chart,
    assembledSpec: any,
    table: any,
    status: 'available' | 'pending' | 'unavailable',
    isSaved?: boolean,
    onChartClick: (chartId: string, tableId: string) => void,
    onDelete: (chartId: string) => void
}>(({ chart, assembledSpec, table, status, isSaved, onChartClick, onDelete }) => {
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
                {status == 'pending' && <Box sx={{
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

const MemoizedChartObject = memo<{
    chart: Chart;
    table: DictTable;
    conceptShelfItems: FieldItem[];
    status: 'available' | 'pending' | 'unavailable';
    onChartClick: (chartId: string, tableId: string) => void;
    onDelete: (chartId: string) => void;
}>(({ chart, table, conceptShelfItems, status, onChartClick, onDelete }) => {
    
    let visTableRows = structuredClone(table.rows);
    let deleteButton = <Box className='data-thread-chart-card-action-button'
        sx={{ zIndex: 10, color: 'blue', position: "absolute", right: 1, background: 'rgba(255, 255, 255, 0.95)' }}>
        <Tooltip title="delete chart">
            <IconButton size="small" color="warning" onClick={(event) => {
                event.stopPropagation();
                onDelete(chart.id);
            }}><DeleteIcon fontSize="small" /></IconButton>
        </Tooltip>
    </Box>

    if (['Auto', '?'].includes(chart.chartType)) {
        let element = <Box 
            className="vega-thumbnail-box"
            onClick={() => onChartClick(chart.id, table.id)}
            sx={{ width: "100%", color: 'text.secondary', height: 48, display: "flex", backgroundColor: "white", position: 'relative', flexDirection: "column" }}>
            {status == 'pending' ? <Box sx={{
                position: "absolute", height: "100%", width: "100%", zIndex: 20,
                backgroundColor:  "rgba(243, 243, 243, 0.8)" , display: "flex", alignItems: "center", cursor: "pointer"
            }}>
                <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.05 }} />
            </Box> : ''}
            <InsightsIcon sx={{ margin: 'auto', color: 'darkgray' }}  fontSize="medium" />
            {deleteButton}
        </Box>
        return element;
    }

    if (status == 'unavailable' || chart.chartType == "Table") {
        let chartTemplate = getChartTemplate(chart.chartType);

        let element = <Box key={`unavailable-${chart.id}`} width={"100%"}
            className={"vega-thumbnail vega-thumbnail-box"}
            onClick={() => onChartClick(chart.id, table.id)}
            sx={{
                display: "flex", backgroundColor: "white", position: 'relative',
                flexDirection: "column"
            }}>
            {status == 'pending' ? <Box sx={{
                position: "absolute", height: "100%", width: "100%", zIndex: 20,
                backgroundColor:  "rgba(243, 243, 243, 0.8)" , display: "flex", alignItems: "center", cursor: "pointer"
            }}>
                <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.05 }} />
            </Box> : ''}
            <Box sx={{ display: "flex", flexDirection: "column", margin: "auto" }}>
                <Box sx={{ margin: "auto", transform: chart.chartType == 'Table' ? "rotate(15deg)" : undefined }} >
                    {generateChartSkeleton(chartTemplate?.icon, 48, 48, chart.chartType == 'Table' ? 1 : 0.5)} 
                </Box>
                {deleteButton}
            </Box>
        </Box>;
        return element;
    }

    // prepare the chart to be rendered
    let assembledChart = assembleVegaChart(chart.chartType, chart.encodingMap, conceptShelfItems, visTableRows, 20);
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

    const element = <VegaLiteChartElement
        chart={chart}
        assembledSpec={assembledChart}
        table={table}
        status={status}
        isSaved={chart.saved}
        onChartClick={() => onChartClick(chart.id, table.id)}
        onDelete={() => onDelete(chart.id)}
    />;

    return element;
}, (prevProps, nextProps) => {
    // Custom comparison function for memoization
    // Only re-render if the chart or its dependencies have changed

    // when conceptShelfItems change, we only need to re-render the chart if the conceptShelfItems depended by the chart have changed
    let nextReferredConcepts = Object.values(nextProps.chart.encodingMap).map(e => e.fieldID).filter(f => f != null);

    return (
        prevProps.chart.id === nextProps.chart.id &&
        prevProps.chart.chartType === nextProps.chart.chartType &&
        prevProps.chart.saved === nextProps.chart.saved &&
        prevProps.status === nextProps.status &&
        _.isEqual(prevProps.chart.encodingMap, nextProps.chart.encodingMap) &&
        // Only check tables/charts that this specific chart depends on
        _.isEqual(prevProps.table, nextProps.table) &&
        // Check if conceptShelfItems have changed
        _.isEqual(
            prevProps.conceptShelfItems.filter(c => nextReferredConcepts.includes(c.id)), 
            nextProps.conceptShelfItems.filter(c => nextReferredConcepts.includes(c.id)))
    );
});

export const DataThread: FC<{}> = function ({ }) {

    let tables = useSelector((state: DataFormulatorState) => state.tables);

    let charts = useSelector(dfSelectors.getAllCharts);

    let chartSynthesisInProgress = useSelector((state: DataFormulatorState) => state.chartSynthesisInProgress);

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    let [threadDrawerOpen, setThreadDrawerOpen] = useState<boolean>(false);
    let [chartifactDialogOpen, setChartifactDialogOpen] = useState<boolean>(false);
    let [currentChartElements, setCurrentChartElements] = useState<ChartElements[]>([]);

    const scrollRef = useRef<null | HTMLDivElement>(null)

    const executeScroll = () => { if (scrollRef.current != null) scrollRef.current.scrollIntoView() }
    // run this function from an event handler or an effect to execute scroll 

    const dispatch = useDispatch();

    const handleOpenChartifactDialog = (chartElements: ChartElements[]) => {
        setCurrentChartElements(chartElements);
        setChartifactDialogOpen(true);
    };

    useEffect(() => {
        executeScroll();
    }, [threadDrawerOpen])

    // Now use useMemo to memoize the chartElements array
    let chartElements = useMemo(() => {
        return charts.filter(c => c.source == "user").map((chart) => {
            const table = getDataTable(chart, tables, charts, conceptShelfItems);
            let status: 'available' | 'pending' | 'unavailable' = chartSynthesisInProgress.includes(chart.id) ? 'pending' : 
                checkChartAvailability(chart, conceptShelfItems, table.rows) ? 'available' : 'unavailable';
            let element = <MemoizedChartObject
                chart={chart}
                table={table}
                conceptShelfItems={conceptShelfItems}
                status={status}
                onChartClick={() => {
                    dispatch(dfActions.setFocusedChart(chart.id));
                    dispatch(dfActions.setFocusedTable(table.id));
                }}
                onDelete={() => {dispatch(dfActions.deleteChartById(chart.id))}}
            />;
            return { chartId: chart.id, tableId: table.id, element };
        });
    }, [charts, tables, conceptShelfItems, chartSynthesisInProgress]);

    // anchors are considered leaf tables to simplify the view
    let leafTables = [...tables.filter(t => (t.anchored && t.derive)), ...tables.filter(t => !tables.some(t2 => t2.derive?.trigger.tableId == t.id))];
    
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
        overflowX: drawerOpen ? 'auto' : 'hidden', // Add horizontal scroll when drawer is open
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
                onOpenChartifactDialog={handleOpenChartifactDialog}
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
        <Box className="data-thread" sx={{ overflowY: 'hidden', overflowX: 'auto' }}>
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
                transition: 'width 200ms cubic-bezier(0.4, 0, 0.2, 1) 0ms', 
                overflowX: drawerOpen ? 'auto' : 'hidden', // Only allow scroll when drawer is closed
                direction: 'rtl', 
                display: 'block', 
                flex: 1
            }}
                 className="thread-view-mode">
                {view}
            </Box>
        </Box>
    );

    return <Box sx={{ display: 'flex', flexDirection: 'row' }}>
        {carousel}
        <ChartifactDialog
            open={chartifactDialogOpen}
            handleCloseDialog={() => setChartifactDialogOpen(false)}
            tables={tables}
            chartElements={currentChartElements}
        />
    </Box>;
}


