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
} from '@mui/material';

import ButtonGroup from '@mui/material/ButtonGroup';


import { styled } from "@mui/material/styles";

import embed from 'vega-embed';
import AnimateOnChange from 'react-animate-on-change'


import '../scss/VisualizationView.scss';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { assembleChart, baseTableToExtTable  } from '../app/utils';
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

import { CHART_TEMPLATES, getChartTemplate } from '../components/ChartTemplates';
import { findBaseFields } from './ViewUtils';

import Prism from 'prismjs'
import 'prismjs/components/prism-python' // Language
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
    let activeBaseFields = conceptShelfItems.filter((field) => {
        return activeFields.some(f => findBaseFields(f, conceptShelfItems).flat().map(x => x.id).includes(field.id));
    });

    let workingTableCandidates = tables.filter(t => activeBaseFields.every(f => t.names.includes(f.name)));
    
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

export let CodeBox : FC<{code: string, language: string}> = function  CodeBox({ code, language }) {
    useEffect(() => {
      Prism.highlightAll();
    }, []);

    return (
        <pre style={{fontSize: 10}}>
          <code className={`language-${language}`} >{code}</code>
        </pre>
    );
  }

export const chartAvailabilityCheck = (encodingMap: EncodingMap, conceptShelfItems: FieldItem[], data: any[]) => {
    let unfilledFields = [];
    let dataFields = [...Object.keys(data[0])];

    for (const [channel, encoding] of Object.entries(encodingMap)) {
        if (encoding.fieldID == undefined) continue;

        let field = conceptShelfItems.find(f => f.id == encoding.fieldID);

        if (field && !dataFields.includes(field.name)) {
            unfilledFields.push(field.name);
        }
    }
    let unavailable = (unfilledFields.length > 0 || Object.entries(encodingMap).filter(entry => entry[1].fieldID != undefined).length == 0);
    return [!unavailable, unfilledFields];
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
            aria-labelledby="demo-positioned-button"
            anchorEl={anchorEl}
            open={open}
            onClose={() => { setAnchorEl(null); }}
            anchorOrigin={{
                vertical: 'top',
                horizontal: 'right',
            }}
            transformOrigin={{
                vertical: 'top',
                horizontal: 'left',
            }}
        >
            {Object.entries(CHART_TEMPLATES).map(([group, templates]) => {
                return [
                    <ListSubheader sx={{ color: "darkgray", lineHeight: 2, fontSize: 12 }} key={group}>{group}</ListSubheader>,
                    ...templates.map((t, i) => (
                        <MenuItem sx={{ fontSize: 12, paddingLeft: 3, paddingRight: 3 }} 
                                  value={t.chart} key={`${group}-${i}`} 
                                  onClick={(e) => { dispatch(dfActions.createNewChart({tableId: tableId, chartType: t.chart})); 
                                                    setAnchorEl(null);  
                                                    e.stopPropagation(); }}>
                            <ListItemIcon>
                                <img height="24px" width="24px" src={t?.icon} alt="" role="presentation" />
                            </ListItemIcon>
                            <ListItemText primaryTypographyProps={{fontSize: '12px'}}>{t.chart}</ListItemText>
                        </MenuItem>
                    ))
                ]
            })}
        </Menu>

    return <>
        <IconButton size="large" color="primary"  key="save-btn" sx={{ textTransform: "none" }} {...other}
                onClick={handleClick}>
            {buttonElement}
        </IconButton>
        {menu}
    </>;
}

export const ChartCreationMenu = styled(BaseChartCreationMenu)({});


export const ChartEditorFC: FC<{  cachedCandidates: DictTable[],
            handleUpdateCandidates: (chartId: string, tables: DictTable[]) => void,
    }> = function ChartEditorFC({ cachedCandidates, handleUpdateCandidates }) {

    const componentRef = useRef<HTMLHeadingElement>(null);

    let tables = useSelector((state: DataFormulatorState) => state.tables);
    let charts = useSelector((state: DataFormulatorState) => state.charts);
    let focusedChartId = useSelector((state: DataFormulatorState) => state.focusedChartId);
    let chartSynthesisInProgress = useSelector((state: DataFormulatorState) => state.chartSynthesisInProgress);
    let threadDrawerOpen = useSelector((state: DataFormulatorState) => state.threadDrawerOpen);

    let synthesisRunning = focusedChartId ? chartSynthesisInProgress.includes(focusedChartId) : false;
    let handleDeleteChart = () => { focusedChartId && dispatch(dfActions.deleteChartById(focusedChartId)) }

    let focusedChart = charts.find(c => c.id == focusedChartId) as Chart;

    const dispatch = useDispatch();

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    let derivedFields = conceptShelfItems.filter(f => f.source == "derived");

    const [candidatesViewAnchorEl, setCandidatesViewAnchorEl] = useState<null | HTMLElement>(null);

    const [codeViewOpen, setCodeViewOpen] = useState<boolean>(false);
    const [codeExplViewOpen, setCodeExplViewOpen] = useState<boolean>(false);

    const [chatDialogOpen, setChatDialogOpen] = useState<boolean>(false);
    const [focusUpdated, setFocusUpdated] = useState<boolean>(true);

    let [collapseEditor, setCollapseEditor] = useState<boolean>(false);

    let scaleFactor = focusedChart.scaleFactor || 1;

    useEffect(() => {
        setFocusUpdated(true);
    }, [focusedChartId])

    useEffect(() => {
        let width = componentRef.current ? componentRef.current.offsetWidth : 0
        if (width < 640 && threadDrawerOpen == true) {
            setCollapseEditor(threadDrawerOpen);
        }
    }, [threadDrawerOpen])

    let chartUnavailable = true;
    
    let table = getDataTable(focusedChart, tables, charts, conceptShelfItems);

    let resultTable = tables.find(t => t.id == focusedChart.intermediate?.resultTableId);

    let candidates = cachedCandidates.length > 0 ? cachedCandidates : [table];

    useEffect(() => {
        if (candidates.length == 0) {
            setCandidatesViewAnchorEl(null);
        }
    }, [candidates])

    let codeExpl = table.derive?.codeExpl || "";

    let toDeriveFields = derivedFields.filter(f => f.name != "").filter(f => findBaseFields(f, conceptShelfItems).every(f2 => table.names.includes(f2.name)))
    let focusedExtTable = baseTableToExtTable(JSON.parse(JSON.stringify(table.rows)), toDeriveFields, conceptShelfItems);

    let createChartElement = (chart: Chart, extTable: any[], id: string) => {
        let chartTemplate = getChartTemplate(chart.chartType);
 
        if (chart.chartType == "Auto") {
            return <Box sx={{ position: "relative", display: "flex", flexDirection: "column", margin: 'auto', color: 'darkgray' }}>
                <InsightsIcon fontSize="large"/>
            </Box>
        }

        if (chart.chartType == "Table") {
            return renderTableChart(chart, conceptShelfItems, extTable);
        }

        let element = <></>;
        if (!chart || !chartAvailabilityCheck(chart.encodingMap, conceptShelfItems, extTable)[0]) {
            return generateChartSkeleton(chartTemplate?.icon);
        }  

        chartUnavailable = false;

        element = <Box id={id} key={`focused-chart`} ></Box>    

        let assembledChart = assembleChart(chart, conceptShelfItems, extTable);
        assembledChart['resize'] = true;

        embed('#' + id, { ...assembledChart }, { actions: true, renderer: "svg" }).then(function (result) {
            // Access the Vega view instance (https://vega.github.io/vega/docs/api/view/) as result.view

            // the intermediate data used by vega-lite
            //let data_0 = (result.view as any)._runtime.data.data_0.values.value;
            if (result.view.container()?.getElementsByTagName("svg")) {
                let comp = result.view.container()?.getElementsByTagName("svg")[0];
                if (comp) {
                    const { width, height } = comp.getBoundingClientRect();
                    // console.log(`main chart; width = ${width} height = ${height}`)
                    comp?.setAttribute("style", `width: ${width * scaleFactor}px; height: ${height * scaleFactor}px;`);
                }
            }

            if (result.view.container()?.getElementsByTagName("canvas")) {
                let comp = result.view.container()?.getElementsByTagName("canvas")[0];
                if (comp) {
                    const { width, height } = comp.getBoundingClientRect();
                    // console.log(`main chart; width = ${width} height = ${height}`)
                    comp?.setAttribute("style", `width: ${width * scaleFactor}px; height: ${height * scaleFactor}px;`);
                }
            }

            // if (result.view.container()?.getElementsByTagName("canvas")) {
            //     let comp = result.view.container()?.getElementsByTagName("canvas")[0];
            //     if (comp) {
            //         const { width, height } = comp.getBoundingClientRect();
            //         // console.log(`main chart; width = ${width} height = ${height}`)
            //         // comp?.setAttribute("style", `width: ${width * 1.6}px; height: ${height * 1.6}px;`);
            //     }
            // }
        }).catch((error) => {
            //console.log(assembledChart)
            //console.error(error)
        });
        return element;
    }

    let focusedChartElement = createChartElement(focusedChart, focusedExtTable, `focused-element-${focusedChart.id}`);
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
                    // trackEvent('save-chart', { 
                    //     vlspec: focusedChartVgSpec,
                    //     data_sample: focusedExtTable.slice(0, 100)
                    // });
                    dispatch(dfActions.saveUnsaveChart(focusedChart.id));
                }}>
                    <StarBorderIcon  />
                </IconButton>
            </Tooltip>
        );

    let duplicateButton = <Tooltip title="duplicate the chart">
        <IconButton color="primary" key="duplicate-btn" size="small" sx={{ textTransform: "none" }}
        disabled={focusedChart.intermediate != undefined}
        onClick={() => {
            // trackEvent('save-chart', { 
            //     vlspec: focusedChartVgSpec,
            //     data_sample: focusedExtTable.slice(0, 100)
            // });
            dispatch(dfActions.duplicateChart(focusedChart.id));
        }}>
        
            <ContentCopyIcon  />
        </IconButton>
    </Tooltip>

    let createNewChartButton =  <ChartCreationMenu tableId={focusedChart.tableRef} buttonElement={
            <Tooltip title="create a new chart">
                <AddchartIcon sx={{ fontSize: "3rem" }} />
            </Tooltip>} />


    let deleteButton = (
        <Tooltip title="delete" key="delete-btn-tooltip">
            <IconButton color="warning" size="small" sx={{ textTransform: "none" }}  disabled={focusedChart.intermediate != undefined}
                        onClick={() => { handleDeleteChart() }}>
                <DeleteIcon />
            </IconButton>
        </Tooltip>
    );

    let transformCode = "";
    if (table.derive?.code) {
        transformCode = `${table.derive.code}`
    }

    //console.log(focusedChart)

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
            <Typography component="span" sx={{}} fontSize="inherit">
                data: {table.id}
            </Typography>
        </Box>,
        ...derivedTableItems,
        <Divider key="dv4" orientation="vertical" variant="middle" flexItem sx={{ marginLeft: "8px", marginRight: "4px" }} />,
        focusedChart.chartType == "Table" && focusedChart.intermediate == undefined ? createNewChartButton : saveButton,
        duplicateButton,
        deleteButton,
    ]

    let chartActionItems = chartUnavailable ?
        <Box key="chart-unavailable-box" sx={{ display: 'flex', flexDirection: "column", textAlign: 'center', paddingTop: 1 }} component="div" color="text.secondary">
            {synthesisRunning || Boolean(candidatesViewAnchorEl) ? "" : <Typography component="div" fontSize="small" sx={{ maxWidth: 640, margin: 'auto' }}>
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
    if (candidatesViewAnchorEl) {
        focusedComponent = [
            //chartActionItems,
            <Box key="derived-dialog" sx={{ margin: "16px", display: "flex", flexDirection: "column", flex: "1", justifyContent: 'flex-start'}}>
                <DerivedDataDialog  chart={focusedChart} candidateTables={candidates} 
                    open={Boolean(candidatesViewAnchorEl) && candidates.length > 0}
                    handleCloseDialog={() => {
                        setCandidatesViewAnchorEl(null);
                    }}
                    handleSelection={(selectionIdx: number) => {
                        console.log(`selected: ${selectionIdx}`)
                        console.log(candidates[selectionIdx]);
                        dispatch(dfActions.replaceTable({chartId: focusedChart.id, table: candidates[selectionIdx]}))
                        dispatch(dfActions.setFocusedTable(candidates[selectionIdx].id));
                        setCandidatesViewAnchorEl(null);
                    }}
                    handleDeleteChart={() => { handleDeleteChart() }}
                    bodyOnly
                />
             </Box>
        ]
    } else {
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
                                    {/* <Tooltip title="view data derivation dialog" key="focused-view-chat-history-btn-tooltip">
                                        <IconButton color="secondary" sx={{ textTransform: "none" }} 
                                                onClick={() => { setChatDialogOpen(!chatDialogOpen) }}><QuestionAnswerIcon />
                                        </IconButton>
                                    </Tooltip>
                                    <Divider />
                                    <Tooltip title="go to explanation view" key="view-code-expl-btn-tooltip">
                                        <IconButton color="primary" sx={{ textTransform: "none" }} 
                                                onClick={() => { setCodeViewOpen(false); setCodeExplViewOpen(true) }}><AssistantIcon />
                                        </IconButton>
                                    </Tooltip> */}
                                    <IconButton onClick={() => {setCodeViewOpen(false)}}  color='primary' aria-label="delete">
                                        <CloseIcon />
                                    </IconButton>
                                </ButtonGroup>
                                {/* <Typography fontSize="small" sx={{color: 'gray'}}>{table.derive?.source} → {table.id}</Typography> */}
                                <Card variant="outlined" key={`code-view-card`}
                                    sx={{minWidth: "280px", maxWidth: "1920px", display: "flex", flexGrow: 1,
                                        border: "1px solid rgba(33, 33, 33, 0.1)"}}>
                                    <CardContent sx={{display: "flex", flexDirection: "column", flexGrow: 1, padding: '0', paddingBottom: '0px !important'}}>
                                        <Typography sx={{ fontSize: 14, margin: 1 }}  gutterBottom>
                                            Data transformation code ({table.derive?.source} → {table.id})
                                        </Typography>
                                        <Box sx={{display: 'flex', flexDirection: "row", alignItems: "center", flex: 'auto', padding: 1, background: '#f5f2f0'}}>
                                            <Box sx={{maxWidth: 800, width: 'fit-content',  display: 'flex',}}>
                                                <CodeBox code={transformCode.trimStart()} language="python" />
                                            </Box>
                                        </Box>
                                    </CardContent>
                                </Card>
                            </Box>
                        </Collapse>
                        <Collapse in={codeExplViewOpen}>
                            <Box sx={{minWidth: 440, maxWidth: 800, padding: "0px 8px", position: 'relative', margin: '8px auto'}}>
                                <ButtonGroup sx={{position: 'absolute', right: 8, top: 0}}>
                                    {/* <Tooltip title="view data derivation dialog" key="view-chat-history-btn-tooltip">
                                        <IconButton color="secondary" sx={{ textTransform: "none" }} 
                                                onClick={() => { setChatDialogOpen(!chatDialogOpen) }}><QuestionAnswerIcon />
                                        </IconButton>
                                    </Tooltip>
                                    <Divider />
                                    <Tooltip title="go to code view" key="view-code-expl-btn-tooltip">
                                        <IconButton color="primary" sx={{ textTransform: "none" }} 
                                                onClick={() => { setCodeViewOpen(true); setCodeExplViewOpen(false) }}><TerminalIcon />
                                        </IconButton>
                                    </Tooltip> */}
                                    <IconButton onClick={() => {setCodeExplViewOpen(false)}}  color='primary' aria-label="delete">
                                        <CloseIcon />
                                    </IconButton>
                                </ButtonGroup>
                                <Card variant="outlined" key={`code-explanation`}
                                    sx={{minWidth: "280px", maxWidth: "1920px", display: "flex", flexGrow: 1, margin: "0px", 
                                        border: "1px solid rgba(33, 33, 33, 0.1)"}}>
                                    <CardContent sx={{display: "flex", flexDirection: "column", flexGrow: 1, padding: '0', paddingBottom: '0px !important'}}>
                                        <Typography sx={{ fontSize: 14, margin: 1 }}  gutterBottom>
                                            Data transformation explanation ({table.derive?.source} → {table.id})
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
    }
    //sticky for encodingshelfthread: sx={{position: 'absolute', right: 0, zIndex: 1000, paddingTop: 1}}
    
    let content = [
        <Box key='focused-box' className="vega-focused" sx={{ display: "flex", overflow: 'auto', flexDirection: 'column', position: 'relative' }}>
            {focusedComponent}
        </Box>,
        // <EncodingShelf key='encoding-shelf' synthesisRunning={synthesisRunning} chartId={chart.id} 
        //                handleUpdateCandidates={handleUpdateCandidates} handleSetSynthesisStatus={handleSetSynthesisStatus} />
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
            <IconButton color="primary" size='small' disabled={scaleFactor <= scaleMin} onClick={() => {
                dispatch(dfActions.updateChartScaleFactor({ chartId: focusedChart.id, scaleFactor: scaleFactor - 0.1 }))
            }}>
                <ZoomOutIcon fontSize="small" />
            </IconButton>
        </Tooltip>
        <Slider aria-label="chart-resize" defaultValue={1} step={0.1} min={scaleMin} max={scaleMax} 
                value={scaleFactor} onChange={(event: Event, newValue: number | number[]) => {
            dispatch(dfActions.updateChartScaleFactor({chartId: focusedChart.id, scaleFactor: newValue as number}))
        }} />
        <Tooltip title="zoom in">
            <IconButton color="primary" size='small' disabled={scaleFactor >= scaleMax} onClick={() => {
                dispatch(dfActions.updateChartScaleFactor({ chartId: focusedChart.id, scaleFactor: scaleFactor + 0.1 }))
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
    let charts = useSelector((state: DataFormulatorState) => state.charts);
    let focusedChartId = useSelector((state: DataFormulatorState) => state.focusedChartId);

    let visViewMode = useSelector((state: DataFormulatorState) => state.visViewMode);

    let [cachedCandidates, setCachedCandidates] = useState<{chartId: string, tables: DictTable[]}[]>([])
    let handleUpdateCandidates = (chartId: string, candidates: DictTable[]) => {
        setCachedCandidates([{chartId, tables: candidates}, ...cachedCandidates.filter(l => l.chartId != chartId)]);
    }

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    const dispatch = useDispatch();

    // when there is no result and synthesis is running, just show the waiting panel
    if (charts.length == 0 || focusedChartId == undefined || !charts.find(c => c.id == focusedChartId) || charts.find(c => c.id == focusedChartId)?.chartType == "?") {
        let chartSelectionBox = <Box sx={{display: "flex", flexDirection: "row", width: '720px', flexWrap: "wrap"}}> 
            {Object.entries(CHART_TEMPLATES).map(([cls, templates])=>templates).flat().filter(t => t.template["name"] != "?").map(t =>
                <Button 
                    key={`${t.chart}-btn`}
                    sx={{margin: '2px', padding:'2px', display:'flex', flexDirection: 'column', 
                            textTransform: 'none', justifyContent: 'flex-start'}}
                    onClick={() => { 
                        let focusedChart = charts.find(c => c.id == focusedChartId);
                        if (focusedChart?.chartType == "?") { 
                            dispatch(dfActions.updateChartType({chartType: t.chart, chartId: focusedChartId as string}));
                        } else {
                            dispatch(dfActions.createNewChart({chartType: t.chart, tableId: tables[0].id}));
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

    let chartEditor = <ChartEditorFC key={focusedChartId}
                        cachedCandidates={cachedCandidates.find(l => l.chartId == focusedChartId)?.tables || []}
                        handleUpdateCandidates={handleUpdateCandidates} />

    //console.log(tables);

    //let vegaSpec: any = createVegaObj(markType, encodingMap, conceptShelfItems)[0];
    // if (tables.length > 0) {
    //     vegaSpec = createVegaObj(markType, encodingMap, conceptShelfItems)[0];
    // }
    let derivedFields = conceptShelfItems.filter(f => f.source == "derived");

    let finalView = <Box></Box>;

    if (visViewMode == "gallery") {

        let chartElements = charts.filter(c => !c.intermediate).map((chart, index) => {

            let table = getDataTable(chart, tables, charts, conceptShelfItems);
    
            let toDeriveFields = derivedFields.filter(f => f.name != "").filter(f => findBaseFields(f, conceptShelfItems).every(f2 => table.names.includes(f2.name)))
            let extTable = baseTableToExtTable(JSON.parse(JSON.stringify(table.rows)), toDeriveFields, conceptShelfItems);

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
                >{renderTableChart(chart, conceptShelfItems, extTable)}</Box>
            }

            let [available, unfilledFields] = chartAvailabilityCheck(chart.encodingMap, conceptShelfItems, extTable);
            if (!available) {
                return <Box className={"vega-thumbnail" + (focusedChartId === chart.id ? " focused-vega-thumbnail" : "")} 
                            key="skeleton" onClick={setIndexFunc}>{generateChartSkeleton(chartTemplate?.icon)}</Box>;
            }

            let assembledChart = assembleChart(chart, conceptShelfItems, extTable);

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
