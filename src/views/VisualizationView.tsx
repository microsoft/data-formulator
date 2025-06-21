// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useRef, useState } from 'react';

import {
    Box,
    Button,
    Divider,
    Icon,
    IconButton,
    Stack,
    Tooltip,
    Typography,
    ListItemIcon,
    ListItemText,
    MenuItem,
    LinearProgress,
    Card,
    Collapse,
    ListSubheader,
    Menu,
    CardContent,
    Slider,
    Dialog,
    DialogContent,
    TextField,
    CircularProgress,
    Popover,
    Snackbar,
    Alert,
} from '@mui/material';

import ButtonGroup from '@mui/material/ButtonGroup';


import { styled } from "@mui/material/styles";

import embed from 'vega-embed';
import AnimateOnChange from 'react-animate-on-change'


import '../scss/VisualizationView.scss';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, getSessionId } from '../app/dfSlice';
import { assembleVegaChart, extractFieldsFromEncodingMap, getUrls, prepVisTable  } from '../app/utils';
import { Chart, EncodingItem, EncodingMap, FieldItem } from '../components/ComponentType';
import { DictTable } from "../components/ComponentType";

import AddchartIcon from '@mui/icons-material/Addchart';
import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import TerminalIcon from '@mui/icons-material/Terminal';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import CheckIcon from '@mui/icons-material/Check';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';

import { CHART_TEMPLATES, getChartTemplate } from '../components/ChartTemplates';

import Prism from 'prismjs'
import 'prismjs/components/prism-python' // Language
import 'prismjs/components/prism-sql' // Language
import 'prismjs/components/prism-markdown' // Language
import 'prismjs/components/prism-typescript' // Language
import 'prismjs/themes/prism.css'; //Example style, you can use another

import { DerivedDataDialog } from './DerivedDataDialog';
import { ChatDialog } from './ChatDialog';
import { EncodingShelfThread } from './EncodingShelfThread';
import { CustomReactTable } from './ReactTable';
import InsightsIcon from '@mui/icons-material/Insights';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import { MuiMarkdown, getOverrides } from 'mui-markdown';

import { dfSelectors } from '../app/dfSlice';

export interface VisPanelProps { }

export interface VisPanelState {
    focusedIndex: number;
    focusUpdated: boolean;
    viewMode: "gallery" | "carousel";
}

export let generateChartSkeleton = (iconPath: string | undefined, width: number = 160, height: number = 160) => (
    <Box width={width} height={height} sx={{ display: "flex" }}>
        {iconPath == undefined ?
            <AddchartIcon sx={{ color: "lightgray", margin: "auto" }} /> :
            <Box width="100%" sx={{ display: "flex", opacity: 0.5 }}>
                <img height={Math.min(64, height)} width={Math.min(64, width)}
                     style={{ maxHeight: Math.min(height, Math.max(32, 0.5 * height)), maxWidth: Math.min(width, Math.max(32, 0.5 * width)), margin: "auto" }} 
                     src={iconPath} alt="" role="presentation" />
            </Box>}
    </Box>
)

export let renderTableChart = (
    chart: Chart, conceptShelfItems: FieldItem[], extTable: any[], 
    width: number = 120, height: number = 120) => {

    let fields = Object.entries(chart.encodingMap).filter(([channel, encoding]) => {
        return encoding.fieldID != undefined;
    }).map(([channel, encoding]) => conceptShelfItems.find(f => f.id == encoding.fieldID) as FieldItem);

    if (fields.length == 0) {
        fields = conceptShelfItems.filter(f => Object.keys(extTable[0]).includes(f.name));
    }

    let rows = extTable.map(row => Object.fromEntries(fields.filter(f => Object.keys(row).includes(f.name)).map(f => [f.name, row[f.name]])))

    let colDefs = fields.map(field => {
        let name = field.name;
        return {
            id: name, label: name, minWidth: 30, align: undefined, 
            format: (value: any) => `${value}`, source: field.source
        }
    })

    return <Box sx={{ position: "relative", display: "flex", flexDirection: "column", margin: 'auto' }}>
        <CustomReactTable rows={rows} columnDefs={colDefs} rowsPerPageNum={10} maxCellWidth={180} compact />
    </Box>
}

export let getDataTable = (chart: Chart, tables: DictTable[], charts: Chart[], 
                           conceptShelfItems: FieldItem[], ignoreTableRef = false) => {
    // given a chart, determine which table would be used to visualize the chart

    // return the table directly
    if (chart.tableRef && !ignoreTableRef) {
        return tables.find(t => t.id == chart.tableRef) as DictTable;
    }

    let activeFields = conceptShelfItems.filter((field) => Array.from(Object.values(chart.encodingMap)).map((enc: EncodingItem) => enc.fieldID).includes(field.id));

    let workingTableCandidates = tables.filter(t => {
        return activeFields.every(f => t.names.includes(f.name));
    });
    
    let confirmedTableCandidates = workingTableCandidates.filter(t => !charts.some(c => c.saved && c.tableRef == t.id));
    if(confirmedTableCandidates.length > 0) {
        return confirmedTableCandidates[0];
    } else if (workingTableCandidates.length > 0) {
        return workingTableCandidates[0];
    } else {
        // sort base tables based on how many active fields are covered by existing tables
        return tables.filter(t => t.derive == undefined).sort((a, b) => activeFields.filter(f => a.names.includes(f.name)).length 
                                        - activeFields.filter(f => b.names.includes(f.name)).length).reverse()[0];
    }
}

export let CodeBox : FC<{code: string, language: string, fontSize?: number}> = function  CodeBox({ code, language, fontSize = 10 }) {
    useEffect(() => {
        Prism.highlightAll();
      }, [code]);

    return (
        <pre style={{fontSize: fontSize}}>
            <code className={`language-${language}`} >{code}</code>
        </pre>
    );
  }

const BaseChartCreationMenu: FC<{tableId: string; buttonElement: any}> = function BaseChartCreationMenu({ tableId, buttonElement, ...other }) {

    const dispatch = useDispatch();

    const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);
    const handleClick = (event: React.MouseEvent<HTMLElement>) => {
        event.stopPropagation();
        setAnchorEl(event.currentTarget);
    };

    let menu = <Menu
            aria-labelledby="chart-creation-menu"
            anchorEl={anchorEl}
            open={open}
            onClose={() => { setAnchorEl(null); }}
            slotProps={{
                paper: {
                    sx: {
                        maxWidth: '400px', // Adjust width to accommodate two columns
                    }
                }
            }}
        >
            <Box sx={{ 
                display: 'grid', 
                gridTemplateColumns: '1fr 1fr',
                px: 1,
                gap: 0,
                minWidth: '240px'
            }}>
                {Object.entries(CHART_TEMPLATES).map(([group, templates]) => {
                    return [
                        <Divider textAlign='left' sx={{gridColumn: '1 / -1', my: 0, color: "darkgray"}} key={`${group}-divider`}> 
                            <Typography variant="caption" sx={{fontSize: "0.625rem", color: "darkgray"}}>{group}</Typography> 
                        </Divider>,
                        ...templates.map((t, i) => (
                            <MenuItem sx={{ fontSize: 12, pl: 1 }} 
                                      value={t.chart} key={`${group}-${i}`} 
                                      onClick={(e) => { dispatch(dfActions.createNewChart({tableId: tableId, chartType: t.chart})); 
                                                        setAnchorEl(null);  
                                                        e.stopPropagation(); }}>
                                <ListItemIcon>
                                    {typeof t?.icon == 'string' ? <img height="24px" width="24px" src={t?.icon} alt="" role="presentation" /> : t?.icon}
                                </ListItemIcon>
                                <ListItemText slotProps={{ primary: {fontSize: 12}}} sx={{fontSize: '12px'}}>{t.chart}</ListItemText>
                            </MenuItem>
                        )),
                        
                    ]
                })}
            </Box>
        </Menu>

    return <>
        <IconButton size="large" color="primary"  key="save-btn" sx={{ textTransform: "none" }} {...other}
                onClick={handleClick}>
            {buttonElement}
        </IconButton>
        {menu}
    </>;
}

export let checkChartAvailabilityOnPreparedData = (chart: Chart, conceptShelfItems: FieldItem[], visTableRows: any[]) => {
    let visFieldsFinalNames = Object.keys(chart.encodingMap)
            .filter(key => chart.encodingMap[key as keyof EncodingMap].fieldID != undefined)
            .map(key => [chart.encodingMap[key as keyof EncodingMap].fieldID, chart.encodingMap[key as keyof EncodingMap].aggregate])
            .map(([id, aggregate]) => {
                let field = conceptShelfItems.find(f => f.id == id);
                if (field) {
                    if (aggregate) {
                        return aggregate == "count" ? "_count" : `${field.name}_${aggregate}`;
                    } else {
                        return field.name;
                    }
                }
                return undefined;
            }).filter(f => f != undefined);
    return visFieldsFinalNames.length > 0 && visTableRows.length > 0 && visFieldsFinalNames.every(name => Object.keys(visTableRows[0]).includes(name));
}

export let checkChartAvailability = (chart: Chart, conceptShelfItems: FieldItem[], visTableRows: any[]) => {
    let visFieldIds = Object.keys(chart.encodingMap)
            .filter(key => chart.encodingMap[key as keyof EncodingMap].fieldID != undefined)
            .map(key => chart.encodingMap[key as keyof EncodingMap].fieldID);
    let visFields = conceptShelfItems.filter(f => visFieldIds.includes(f.id));
    return visFields.length > 0 && visTableRows.length > 0 && visFields.every(f => Object.keys(visTableRows[0]).includes(f.name));
}

export let SampleSizeEditor: FC<{
    initialSize: number;
    totalSize: number;
    onSampleSizeChange: (newSize: number) => void;
}> = function SampleSizeEditor({ initialSize, totalSize, onSampleSizeChange }) {

    const [localSampleSize, setLocalSampleSize] = useState<number>(initialSize);
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);

    useEffect(() => {
        setLocalSampleSize(initialSize);
    }, [initialSize])

    let maxSliderSize = Math.min(totalSize, 30000);

    const handleClick = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    return <Box component="span" sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
        <Button 
            onClick={handleClick}
            sx={{ textTransform: 'none', fontSize: '12px' }}
        >
            {localSampleSize} / {totalSize}
        </Button>
        <Popover
            open={open}
            anchorEl={anchorEl}
            onClose={handleClose}
            anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'left',
            }}
            transformOrigin={{
                vertical: 'top',
                horizontal: 'left',
            }}
        >
            <Box sx={{ p: 2, width: 300 }}>
                <Typography fontSize="small" gutterBottom>
                    Adjust sample size: {localSampleSize} / {totalSize} rows
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>100</Typography>
                    <Slider
                        size="small"
                        min={100}
                        max={maxSliderSize}
                        sx={{ mr: 1 }}
                        value={localSampleSize}
                        onChange={(_, value) => setLocalSampleSize(value as number)}
                        valueLabelDisplay="auto"
                        aria-label="Sample size"
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>{maxSliderSize}</Typography>
                    <Button sx={{ textTransform: 'none', ml: 2, fontSize: '12px' }} onClick={() => {
                        onSampleSizeChange(localSampleSize);
                        setAnchorEl(null);
                    }}>
                        Resample
                    </Button>
                </Box>
            </Box>
        </Popover>
    </Box>
}

export const ChartEditorFC: FC<{}> = function ChartEditorFC({}) {

    const config = useSelector((state: DataFormulatorState) => state.config);
    const componentRef = useRef<HTMLHeadingElement>(null);

    let tables = useSelector((state: DataFormulatorState) => state.tables);
    
    let charts = useSelector(dfSelectors.getAllCharts);
    let focusedChartId = useSelector((state: DataFormulatorState) => state.focusedChartId);
    let chartSynthesisInProgress = useSelector((state: DataFormulatorState) => state.chartSynthesisInProgress);

    let synthesisRunning = focusedChartId ? chartSynthesisInProgress.includes(focusedChartId) : false;
    let handleDeleteChart = () => { focusedChartId && dispatch(dfActions.deleteChartById(focusedChartId)) }

    let focusedChart = charts.find(c => c.id == focusedChartId) as Chart;
    let trigger = focusedChart.source == "trigger" ? tables.find(t => t.derive?.trigger?.chart?.id == focusedChartId)?.derive?.trigger : undefined;

    const dispatch = useDispatch();

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    const [codeViewOpen, setCodeViewOpen] = useState<boolean>(false);
    const [codeExplViewOpen, setCodeExplViewOpen] = useState<boolean>(false);

    const [chatDialogOpen, setChatDialogOpen] = useState<boolean>(false);
    const [focusUpdated, setFocusUpdated] = useState<boolean>(true);

    let [collapseEditor, setCollapseEditor] = useState<boolean>(false);

    const [localScaleFactor, setLocalScaleFactor] = useState<number>(1);

    let table = getDataTable(focusedChart, tables, charts, conceptShelfItems);
    
    let visFieldIds = Object.keys(focusedChart.encodingMap).filter(key => focusedChart.encodingMap[key as keyof EncodingMap].fieldID != undefined).map(key => focusedChart.encodingMap[key as keyof EncodingMap].fieldID);
    let visFields = conceptShelfItems.filter(f => visFieldIds.includes(f.id));
    let dataFieldsAllAvailable = visFields.every(f => table.names.includes(f.name));

    let setSystemMessage = (content: string, severity: "error" | "warning" | "info" | "success") => {
        dispatch(dfActions.addMessages({
            "timestamp": Date.now(),
            "component": "Chart Builder",
            "type": severity,
            "value": content
        }));
    }

    let createVisTableRowsLocal = (rows: any[]) => {
        if (visFields.length == 0) {
            return rows;
        }
        let filteredRows = rows.map(row => Object.fromEntries(visFields.filter(f => table.names.includes(f.name)).map(f => [f.name, row[f.name]])));
        let visTable = prepVisTable(filteredRows, conceptShelfItems, focusedChart.encodingMap);
        return visTable;
    }

    let initialVisTableRows = createVisTableRowsLocal(structuredClone(table.rows));
    const [visTableRows, setVisTableRows] = useState<any[]>(initialVisTableRows);
    const [visTableTotalRowCount, setVisTableTotalRowCount] = useState<number>(table.virtual?.rowCount || initialVisTableRows.length);

    async function fetchDisplayRows(sampleSize?: number) {
        if (sampleSize == undefined) {
            sampleSize = 5000;
        }
        if (table.virtual) {
            let { aggregateFields, groupByFields } = extractFieldsFromEncodingMap(focusedChart.encodingMap, conceptShelfItems);
            fetch(getUrls().SAMPLE_TABLE, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    table: table.id,
                    size: sampleSize,
                    method: 'random',
                    select_fields: groupByFields,
                    aggregate_fields_and_functions: aggregateFields,
                }),
            })
            .then(response => response.json())
            .then(data => {
                if (data.status == "success") {
                    setVisTableRows(data.rows);
                    setVisTableTotalRowCount(data.total_row_count);
                } else {
                    setVisTableRows([]);
                    setVisTableTotalRowCount(0);
                    setSystemMessage(data.message, "error");
                }
            })
            .catch(error => {
                console.error('Error sampling table:', error);
            });
        }
    }   

    useEffect(() => {
        if (table.virtual && visFields.length > 0 && dataFieldsAllAvailable) {
            fetchDisplayRows();
        }
    }, [])

    useEffect(() => {
        if (visFields.length > 0 && dataFieldsAllAvailable) {
            // table changed, we need to update the rows to display
            if (table.virtual) {
                // virtual table, we need to sample the table
                fetchDisplayRows();
            } else {
                setVisTableRows(createVisTableRowsLocal(structuredClone(table.rows)));
            }
        } 
    }, [focusedChart])
    
    useEffect(() => {
        setFocusUpdated(true);
    }, [focusedChartId])

    let chartUnavailable = true;
    let resultTable = tables.find(t => t.id == trigger?.resultTableId);

    let codeExpl = table.derive?.codeExpl || "";

    let createChartElement = (chart: Chart, id: string) => {
        let chartTemplate = getChartTemplate(chart.chartType);
 
        if (chart.chartType == "Auto") {
            return <Box sx={{ position: "relative", display: "flex", flexDirection: "column", margin: 'auto', color: 'darkgray' }}>
                <InsightsIcon fontSize="large"/>
            </Box>
        }

        if (chart.chartType == "Table") {
            return renderTableChart(chart, conceptShelfItems, visTableRows);
        }


        let element = <></>;
        if (!chart || !checkChartAvailabilityOnPreparedData(chart, conceptShelfItems, visTableRows)) {
            return   generateChartSkeleton(chartTemplate?.icon);
        }

        chartUnavailable = false;

        element = <Box id={id} key={`focused-chart`} ></Box>    

        let assembledChart = assembleVegaChart(chart.chartType, chart.encodingMap, conceptShelfItems, visTableRows, 48, true);
        
        assembledChart['resize'] = true;
        assembledChart['config'] = {
            "view": {
                "continuousWidth": config.defaultChartWidth,
                "continuousHeight": config.defaultChartHeight
            }
        }

        embed('#' + id, { ...assembledChart }, { actions: true, renderer: "svg" }).then(function (result) {
            // Access the Vega view instance (https://vega.github.io/vega/docs/api/view/) as result.view

            // the intermediate data used by vega-lite
            //let data_0 = (result.view as any)._runtime.data.data_0.values.value;
            if (result.view.container()?.getElementsByTagName("svg")) {
                let comp = result.view.container()?.getElementsByTagName("svg")[0];
                if (comp) {
                    const { width, height } = comp.getBoundingClientRect();
                    comp?.setAttribute("style", `width: ${width * localScaleFactor}px; height: ${height * localScaleFactor}px;`);
                }
            }

            if (result.view.container()?.getElementsByTagName("canvas")) {
                let comp = result.view.container()?.getElementsByTagName("canvas")[0];
                if (comp) {
                    const { width, height } = comp.getBoundingClientRect();
                    // console.log(`main chart; width = ${width} height = ${height}`)
                    comp?.setAttribute("style", `width: ${width * localScaleFactor}px; height: ${height * localScaleFactor}px;`);
                }
            }
        }).catch((error) => {
            //console.log(assembledChart)
            //console.error(error)
        });
        return element;
    }

    let focusedChartElement = createChartElement(focusedChart, `focused-element-${focusedChart.id}`);
    let arrowCard = <></>;
    let resultChartElement = <></>;

    let focusedElement = <Box sx={{margin: "auto", display: 'flex', flexDirection: 'row'}}>
                                {focusedChartElement}
                                {arrowCard}
                                {resultChartElement}
                            </Box>;

    
    let saveButton = focusedChart.saved ?
        (
            <IconButton size="large" key="save-btn" sx={{ textTransform: "none" }}
                onClick={() => {
                    //dispatch(dfActions.saveChart({chartId: chart.id, tableRef: undefined}));
                    dispatch(dfActions.saveUnsaveChart(focusedChart.id));
                }}>
                <Tooltip title="unsave">
                    <StarIcon sx={{ fontSize: "3rem", color: "gold" }} />
                </Tooltip>
            </IconButton>
        ) : (
            <Tooltip title="save a copy">
            <IconButton color="primary" key="unsave-btn" size="small" sx={{ textTransform: "none" }}
                disabled={chartUnavailable}
                onClick={() => {
                    dispatch(dfActions.saveUnsaveChart(focusedChart.id));
                }}>
                    <StarBorderIcon  />
                </IconButton>
            </Tooltip>
        );

    let duplicateButton = <Tooltip title="duplicate the chart">
        <IconButton color="primary" key="duplicate-btn" size="small" sx={{ textTransform: "none" }}
        disabled={trigger != undefined}
        onClick={() => {
            dispatch(dfActions.duplicateChart(focusedChart.id));
        }}>
            <ContentCopyIcon  />
        </IconButton>
    </Tooltip>

    let createNewChartButton =  <BaseChartCreationMenu tableId={focusedChart.tableRef} buttonElement={
            <Tooltip title="create a new chart">
                <AddchartIcon sx={{ fontSize: "3rem" }} />
            </Tooltip>} />


    let deleteButton = (
        <Tooltip title="delete" key="delete-btn-tooltip">
            <IconButton color="warning" size="small" sx={{ textTransform: "none" }}  disabled={trigger != undefined}
                        onClick={() => { handleDeleteChart() }}>
                <DeleteIcon />
            </IconButton>
        </Tooltip>
    );

    let transformCode = "";
    if (table.derive?.code) {
        transformCode = `${table.derive.code}`
    }

    let derivedTableItems =  (resultTable?.derive || table.derive) ? [
        <Tooltip title={`${codeViewOpen ? 'hide' : 'view'} transformation code`} key="code-view-btn-tooltip">
            <IconButton color="primary" size="small" sx={{ textTransform: "none",  marginLeft: 1,
                                                            backgroundColor: !codeViewOpen ? "" : "rgba(2, 136, 209, 0.3)", 
                                                            "&:hover": { backgroundColor: !codeViewOpen ? "default" : "rgba(2, 136, 209, 0.3)" }}} 
                    onClick={() => { setCodeViewOpen(!codeViewOpen) }}><TerminalIcon />
            </IconButton>
        </Tooltip>,
        <Tooltip title={`${codeExplViewOpen ? 'hide' : 'view'} transformation explanation`} key="code-expl-view-btn-tooltip">
            <IconButton color="primary" size="small" sx={{ textTransform: "none",  
                                                            backgroundColor: !codeExplViewOpen ? "" : "rgba(2, 136, 209, 0.3)", 
                                                            "&:hover": { backgroundColor: !codeExplViewOpen ? "default" : "rgba(2, 136, 209, 0.3)" }}} 
                    onClick={() => { setCodeExplViewOpen(!codeExplViewOpen) }}><TextSnippetIcon />
            </IconButton>
        </Tooltip>,
        <Divider key="dv3" orientation="vertical" variant="middle" flexItem sx={{ marginLeft: "8px", marginRight: "4px" }} />,
        <Tooltip title="view agent dialog" key="view-chat-history-btn-tooltip">
            <IconButton color="primary" size="small" sx={{ textTransform: "none" }} 
                    onClick={() => { setChatDialogOpen(!chatDialogOpen) }}><QuestionAnswerIcon />
            </IconButton>
        </Tooltip>,
        <ChatDialog key="chat-dialog-button" open={chatDialogOpen} 
                    handleCloseDialog={() => { setChatDialogOpen(false) }}
                    code={transformCode}
                    dialog={resultTable?.derive?.dialog || table.derive?.dialog as any[]} />
    ] : [];
    
    let chartActionButtons = [
        <Box key="data-source" fontSize="small" sx={{ margin: "auto", display: "flex", flexDirection: "row"}}>
            <Typography component="span" sx={{display: 'flex', flexDirection: 'row', alignItems: 'center'}} fontSize="inherit">
                data: {table.virtual ? <Tooltip title="this table resides in the backend database, sample rows are used for visualization"><CloudQueueIcon  sx={{ fontSize: '12px', color: 'text.secondary', mx: 0.5}} /></Tooltip> : ""} {table.displayId || table.id}
            </Typography>
        </Box>,
        ...derivedTableItems,
        <Divider key="dv4" orientation="vertical" variant="middle" flexItem sx={{ marginLeft: "8px", marginRight: "4px" }} />,
        focusedChart.chartType == "Table" ? createNewChartButton : saveButton,
        duplicateButton,
        deleteButton,
    ]

    let chartActionItems = chartUnavailable ?
        <Box key="chart-unavailable-box" sx={{ display: 'flex', flexDirection: "column", textAlign: 'center', paddingTop: 1 }} component="div" color="text.secondary">
            {synthesisRunning ? "" : <Typography component="div" fontSize="small" sx={{ maxWidth: 640, margin: 'auto' }}>
                {Object.entries(focusedChart.encodingMap).filter(entry => entry[1].fieldID != undefined).length == 0  ?
                    <Typography component="span" fontSize="inherit" >
                        {focusedChart.chartType == "Table" ? 
                            "Provide a data transformation prompt to create a new data" 
                            : (focusedChart.chartType == "Auto" ? "Say something to get chart recommendations!" 
                                    : "To create a chart, put data fields to chart builder.")}
                    </Typography> :
                    <Typography component="span" fontSize="inherit">
                        Once you provided all fields, "formulate" to create the visualization.</Typography>}
                    <Typography fontSize="inherit">
                        The AI agent will help you transform data along the way.
                    </Typography>
            </Typography>}
            <Box sx={{ display: 'flex', flexDirection: "row", margin: "auto" }}>
                {chartActionButtons}
            </Box>
        </Box> :
        <>
            {table.derive ? <Typography component="span" fontSize="small" color="text.secondary" sx={{textAlign:'center'}}>
                AI generated results can be inaccurate, inspect it!
            </Typography> : ""}
            {table.virtual ? (
                <Box sx={{ display: 'flex', flexDirection: "row", margin: "auto", justifyContent: 'center', alignItems: 'center'}}>
                    
                    <Typography component="span" fontSize="small" color="text.secondary" sx={{textAlign:'center'}}>
                        visualizing
                    </Typography>
                    <SampleSizeEditor 
                        initialSize={visTableRows.length}
                        totalSize={visTableTotalRowCount}
                        onSampleSizeChange={(newSize) => {
                            fetchDisplayRows(newSize);
                        }}
                    />
                    <Typography component="span" fontSize="small" color="text.secondary" sx={{textAlign:'center'}}>
                        sample rows
                    </Typography>
                </Box>
            ) : ""}
            <Box key='chart=action-buttons' sx={{ display: 'flex', flexDirection: "row", margin: "auto", paddingTop: 1 }}>
                {chartActionButtons}
            </Box>
        </>
    
    let codeExplComp = <MuiMarkdown
            overrides={{
                ...getOverrides(), // This will keep the other default overrides.
                code: {
                  props: {
                    style: {
                        padding: "2px 4px",
                        color: 'darkblue'
                    }
                  }
                },
                p: {
                    props: {
                        style: { 
                            fontFamily: "Arial, Roboto, Helvetica Neue, sans-serif",
                            fontWeight: 400,
                            fontSize: 12,
                            lineHeight: 2,
                            margin: 0
                        },
                    } as React.HTMLProps<HTMLParagraphElement>,
                },
                ol: {
                    props: {
                        style: { 
                            margin: 0
                        },
                    } as React.HTMLProps<HTMLParagraphElement>,
                },
                li: {
                    props: {
                        style: { 
                            fontFamily: "Arial, Roboto, Helvetica Neue, sans-serif",
                            fontWeight: 400,
                            fontSize: 12,
                            lineHeight: 2
                        },
                } as React.HTMLProps<HTMLParagraphElement>,
                },
            }}>{codeExpl}</MuiMarkdown>

    let focusedComponent = [];

    let transformationIndicatorText = table.derive?.source ? 
        `${table.derive.source.map(s => tables.find(t => t.id === s)?.displayId || s).join(", ")} → ${table.displayId || table.id}` : "";

    focusedComponent = [
        <Box key="chart-focused-element"  sx={{ margin: "auto", display: "flex", flexDirection: "column"}}>
            <AnimateOnChange
                baseClassName="chart-box"
                animationClassName="chart-box-animation"
                animate={focusUpdated}
                onAnimationEnd={() => { setFocusUpdated(false); }}>
                <Box sx={{display: 'flex', flexDirection: 'column'}}>
                    {focusedElement}
                    <Collapse in={codeViewOpen}>
                        <Box sx={{minWidth: 440, maxWidth: 800, padding: "0px 8px", position: 'relative', margin: '8px auto'}}>
                            <ButtonGroup sx={{position: 'absolute', right: 8, top: 1}}>
                                <IconButton onClick={() => {setCodeViewOpen(false)}}  color='primary' aria-label="delete">
                                    <CloseIcon />
                                </IconButton>
                            </ButtonGroup>
                            {/* <Typography fontSize="small" sx={{color: 'gray'}}>{table.derive?.source} → {table.id}</Typography> */}
                            <Card variant="outlined" key={`code-view-card`}
                                sx={{minWidth: "280px", maxWidth: "1920px",  display: "flex", flexGrow: 1,
                                    border: "1px solid rgba(33, 33, 33, 0.1)"}}>
                                <CardContent sx={{display: "flex", flexDirection: "column", flexGrow: 1, padding: 0, paddingBottom: '0px !important'}}>
                                    <Typography sx={{ fontSize: 14, margin: 1 }}  gutterBottom>
                                        Data transformation code ({transformationIndicatorText})
                                    </Typography>
                                    <Box sx={{display: 'flex', flexDirection: "row", alignItems: "center", flex: 'auto'}}>
                                        <Box sx={{maxHeight: '400px', overflow: 'auto', width: '100%', p: 0.5}}>   
                                            <CodeBox code={transformCode.trimStart()} language={table.virtual ? "sql" : "python"} />
                                        </Box>
                                    </Box>
                                </CardContent>
                            </Card>
                        </Box>
                    </Collapse>
                    <Collapse in={codeExplViewOpen}>
                        <Box sx={{minWidth: 440, maxWidth: 800, padding: "0px 8px", position: 'relative', margin: '8px auto'}}>
                            <ButtonGroup sx={{position: 'absolute', right: 8, top: 0}}>
                                <IconButton onClick={() => {setCodeExplViewOpen(false)}}  color='primary' aria-label="delete">
                                    <CloseIcon />
                                </IconButton>
                            </ButtonGroup>
                            <Card variant="outlined" key={`code-explanation`}
                                sx={{minWidth: "280px", maxWidth: "1920px", display: "flex", flexGrow: 1, margin: "0px", 
                                    border: "1px solid rgba(33, 33, 33, 0.1)"}}>
                                <CardContent sx={{display: "flex", flexDirection: "column", flexGrow: 1, padding: '0', paddingBottom: '0px !important'}}>
                                    <Typography sx={{ fontSize: 14, margin: 1 }}  gutterBottom>
                                        Data transformation explanation ({transformationIndicatorText})
                                    </Typography>
                                    <Box sx={{display: 'flex', flexDirection: "row", alignItems: "center", flex: 'auto', padding: 1, background: '#f5f2f0'}}>
                                        <Box sx={{width: 'fit-content',  display: 'flex',}}>
                                            {codeExplComp}
                                            {/* <Typography sx={{ fontSize: 12, whiteSpace: 'pre-wrap' }}  color="text.secondary">
                                                {codeExpl}
                                            </Typography> */}
                                        </Box>
                                    </Box>
                                </CardContent>
                            </Card>
                        </Box>
                    </Collapse>
                </Box>
            </AnimateOnChange>
            {chartActionItems}
        </Box>
    ]
    
    let content = [
        <Box key='focused-box' className="vega-focused" sx={{ display: "flex", overflow: 'auto', flexDirection: 'column', position: 'relative' }}>
            {focusedComponent}
        </Box>,
        <Collapse 
            key='encoding-shelf'
            collapsedSize={48} in={!collapseEditor} orientation='horizontal' 
            sx={{position: 'relative'}}>
            <Box sx={{display: 'flex', flexDirection: 'row', height: '100%'}}>
                <Tooltip placement="left" title={collapseEditor ? "open editor" : "hide editor"}>
                    <Button color="primary"
                            sx={{width: 24, minWidth: 24}}
                        onClick={()=>{setCollapseEditor(!collapseEditor)}}
                    >{collapseEditor ? <ChevronLeftIcon /> : <ChevronRightIcon />}</Button>
                </Tooltip>
                <EncodingShelfThread key='encoding-shelf' chartId={focusedChart.id} />
            </Box>
        </Collapse>,
    ]

    let [scaleMin, scaleMax] = [0.2, 2.4]

    let chartResizer = <Stack spacing={1} direction="row" sx={{ padding: '8px', width: 160, position: "absolute", zIndex: 10, color: 'darkgray' }} alignItems="center">
        <Tooltip title="zoom out">
            <IconButton color="primary" size='small' disabled={localScaleFactor <= scaleMin} onClick={() => {
                setLocalScaleFactor(prev => Math.max(scaleMin, prev - 0.1));
            }}>
                <ZoomOutIcon fontSize="small" />
            </IconButton>
        </Tooltip>
        <Slider aria-label="chart-resize" size='small' defaultValue={1} step={0.1} min={scaleMin} max={scaleMax} 
                value={localScaleFactor} onChange={(event: Event, newValue: number | number[]) => {
            setLocalScaleFactor(newValue as number);
        }} />
        <Tooltip title="zoom in">
            <IconButton color="primary" size='small' disabled={localScaleFactor >= scaleMax} onClick={() => {
                setLocalScaleFactor(prev => Math.min(scaleMax, prev + 0.1));
            }}>
                <ZoomInIcon fontSize="small" />
            </IconButton>
        </Tooltip>
    </Stack>

    return <Box ref={componentRef} sx={{overflow: "hidden", display: 'flex', flex: 1}}>
        {synthesisRunning ? <Box sx={{
                    position: "absolute", height: "calc(100%)", width: "calc(100%)", zIndex: 1001, 
                    backgroundColor: "rgba(243, 243, 243, 0.8)", display: "flex", alignItems: "center"
                }}>
                    <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.05 }} />
                </Box> : ''}
        {chartUnavailable ? "" : chartResizer}
        {content}
    </Box>
}

export const VisualizationViewFC: FC<VisPanelProps> = function VisualizationView({ }) {

    let tables = useSelector((state: DataFormulatorState) => state.tables);

    let allCharts = useSelector(dfSelectors.getAllCharts);
    let focusedChartId = useSelector((state: DataFormulatorState) => state.focusedChartId);
    let focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);

    let visViewMode = useSelector((state: DataFormulatorState) => state.visViewMode);

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    const dispatch = useDispatch();

    let focusedChart = allCharts.find(c => c.id == focusedChartId) as Chart;

    // when there is no result and synthesis is running, just show the waiting panel
    if (!focusedChart || focusedChart?.chartType == "?") {
        let chartSelectionBox = <Box sx={{display: "flex", flexDirection: "row", width: '720px', flexWrap: "wrap"}}> 
            {Object.entries(CHART_TEMPLATES).map(([cls, templates])=>templates).flat().filter(t => t.template["name"] != "?").map(t =>
                <Button 
                    key={`${t.chart}-btn`}
                    sx={{margin: '2px', padding:'2px', display:'flex', flexDirection: 'column', 
                            textTransform: 'none', justifyContent: 'flex-start'}}
                    onClick={() => { 
                        let focusedChart = allCharts.find(c => c.id == focusedChartId);
                        if (focusedChart?.chartType == "?") { 
                            dispatch(dfActions.updateChartType({chartType: t.chart, chartId: focusedChartId as string}));
                        } else {
                            dispatch(dfActions.createNewChart({chartType: t.chart, tableId: focusedTableId}));
                        }
                    }}
                >
                    <Icon sx={{width: 48, height: 48}} >
                        {typeof t?.icon == 'string' ? <img height="48px" width="48px" src={t?.icon} alt="" role="presentation" /> : t.icon}
                    </Icon>
                    <Typography sx={{marginLeft: "2px", whiteSpace: "initial", fontSize: '10px', width: '64px'}} >{t?.chart}</Typography>
                </Button>
            )}
            </Box>
        return (
            <Box sx={{  margin: "auto" }}>
                {chartSelectionBox}
            </Box>
        )
    }

    let chartEditor = <ChartEditorFC key={focusedChartId} />


    let finalView = <Box></Box>;

    if (visViewMode == "gallery") {

        let chartElements = allCharts.map((chart, index) => {

            let table = getDataTable(chart, tables, allCharts, conceptShelfItems);
    
            let visTableRows = structuredClone(table.rows);

            let chartTemplate = getChartTemplate(chart.chartType);

            let setIndexFunc = () => {
                dispatch(dfActions.setFocusedChart(chart.id));
                dispatch(dfActions.setFocusedTable(table.id));
                dispatch(dfActions.setVisViewMode('carousel'));
            }

            if (chart.chartType == "Table") {
                return <Box key={`animateOnChange-${index}`}
                     className="vega-thumbnail-box"
                     onClick={setIndexFunc}
                     sx={{  position: 'relative', backgroundColor: chart.saved ? "rgba(255,215,0,0.05)" : "white",
                            border: chart.saved ? '2px solid gold' : '1px solid lightgray', margin: 1, 
                            display: 'flex', flexDirection: 'column', maxWidth: '800px', maxHeight: '600px', overflow:'hidden'}}
                >{renderTableChart(chart, conceptShelfItems, visTableRows)}</Box>
            }

            if (!checkChartAvailability(chart, conceptShelfItems, table.rows)) {
                return <Box className={"vega-thumbnail" + (focusedChartId === chart.id ? " focused-vega-thumbnail" : "")} 
                            key="skeleton" onClick={setIndexFunc}>{generateChartSkeleton(chartTemplate?.icon)}</Box>;
            }

            let assembledChart = assembleVegaChart(chart.chartType, chart.encodingMap, conceptShelfItems, visTableRows);

            const id = `chart-element-${index}`;

            let element =
                <Box key={`animateOnChange-${index}`}
                     className="vega-thumbnail-box"
                     onClick={setIndexFunc}
                     sx={{  position: 'relative', backgroundColor: chart.saved ? "rgba(255,215,0,0.05)" : "white",
                            border: chart.saved ? '2px solid gold' : '1px solid lightgray', margin: 1, 
                            display: 'flex', flexDirection: 'column', maxWidth: '800px', maxHeight: '600px', overflow:'hidden'}}
                >
                    {/* <Box className="vega-thumbnail" id={id} key={`chart-${index}`} sx={{ margin: "auto" }}
                        onClick={setIndexFunc}></Box> */}
                    {chart.saved ? <Typography key='chart-saved-star-icon' sx={{ position: "absolute", margin: "5px", zIndex: 2, right: 0 }}>
                                        <StarIcon sx={{ color: "gold" }} fontSize="small" />
                                    </Typography> : ""}
                    <Typography fontSize="small">data: {chart.tableRef}</Typography>
                    <Box className={"vega-thumbnail" + (focusedChartId == chart.id ? " focused-vega-thumbnail" : "")}
                        id={id} key={`chart-gallery-${index}`} sx={{ margin: "auto",  }}
                        >
                    </Box>
                </Box>;

            embed('#' + id, assembledChart, { actions: false, renderer: "canvas", defaultStyle: true, }); //, config: powerbi

            return element;
        });

        finalView = (
            <Box className="visualization-gallery">
                <Box className="vega-container" key="vega-container">
                    {chartElements}
                </Box>
            </Box>
        );
    } else if (visViewMode == "carousel") {

        finalView = (
            <Box sx={{ width: "100%", overflow: "hidden", display: "flex", flexDirection: "row" }}>
                <Box className="visualization-carousel" sx={{display: "contents"}} >
                    {chartEditor}
                </Box>
            </Box>
        );
    }

    let visPanel = finalView;

    return visPanel;
}
