// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
    Collapse,
    Fade,
    Grow,
} from '@mui/material';

import _ from 'lodash';

import { borderColor } from '../app/tokens';

import ButtonGroup from '@mui/material/ButtonGroup';


import '../scss/VisualizationView.scss';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, fetchChartInsight } from '../app/dfSlice';
import { assembleVegaChart, extractFieldsFromEncodingMap, getUrls, prepVisTable, fetchWithIdentity } from '../app/utils';
import { Chart, EncodingItem, EncodingMap, FieldItem, computeInsightKey } from '../components/ComponentType';
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
import InfoIcon from '@mui/icons-material/Info';
import CasinoIcon from '@mui/icons-material/Casino';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import { CHART_TEMPLATES, getChartTemplate } from '../components/ChartTemplates';

import Prism from 'prismjs'
import 'prismjs/components/prism-python' // Language
import 'prismjs/components/prism-sql' // Language
import 'prismjs/components/prism-markdown' // Language
import 'prismjs/components/prism-typescript' // Language
import 'prismjs/themes/prism.css'; //Example style, you can use another

import { useTranslation } from 'react-i18next';

import { ChatDialog } from './ChatDialog';
import { EncodingShelfThread } from './EncodingShelfThread';
import { CustomReactTable } from './ReactTable';
import { InsightIcon } from '../icons';

import { dfSelectors } from '../app/dfSlice';
import { ChartRecBox } from './ChartRecBox';
import { CodeExplanationCard, ConceptExplCards, extractConceptExplanations } from './ExplComponents';
import CodeIcon from '@mui/icons-material/Code';

export interface VisPanelProps { }

export interface VisPanelState {
    focusedIndex: number;
    focusUpdated: boolean;
    viewMode: "gallery" | "carousel";
}

export let generateChartSkeleton = (icon: any, width: number = 160, height: number = 160, opacity: number = 0.5) => (
    <Box width={width} height={height} sx={{ display: "flex" }}>
        {icon == undefined ?
            <AddchartIcon sx={{ color: "lightgray", margin: "auto" }} /> :
            typeof icon == 'string' ?
                <Box width="100%" sx={{ display: "flex", opacity: opacity }}>
                    <img height={Math.min(64, height)} width={Math.min(64, width)}
                         style={{ maxHeight: Math.min(height, Math.max(32, 0.5 * height)), maxWidth: Math.min(width, Math.max(32, 0.5 * width)), margin: "auto" }} 
                         src={icon} alt="" role="presentation" />
                </Box> :
                <Box width="100%" sx={{ display: "flex", opacity: opacity }}>
                    {React.cloneElement(icon, {
                        style: { 
                            maxHeight: Math.min(height, 32),
                            maxWidth: Math.min(width, 32), 
                            margin: "auto" 
                        }
                    })}
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
            }).filter((f): f is string => f != undefined);
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

    const { t } = useTranslation();
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
            <Box sx={{ p: 2, width: 310 }}>
                <Typography fontSize="small" gutterBottom>
                    {t('chart.adjustSampleSize', { sampleSize: localSampleSize, totalSize })}
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
                        aria-label={t('chart.sampleSizeAria')}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>{maxSliderSize}</Typography>
                    <Button sx={{ textTransform: 'none', ml: 2, fontSize: '12px' }} onClick={() => {
                        onSampleSizeChange(localSampleSize);
                        setAnchorEl(null);
                    }}>
                        {t('chart.resample')}
                    </Button>
                </Box>
            </Box>
        </Popover>
    </Box>
}

/**
 * Module-level caches that persist across component remounts.
 * - displayRowsCache: avoids re-fetching server data when switching back to a chart
 * - displaySvgCache: avoids re-running toSVG when chart+data haven't changed
 */
const displayRowsCache = new Map<string, { rows: any[], totalCount: number }>();
const displaySvgCache = new Map<string, { specKey: string; svg: string; spec: any }>();

// Simple component that only handles Vega chart rendering — now uses headless toSVG()
const VegaChartRenderer: FC<{
    chart: Chart;
    conceptShelfItems: FieldItem[];
    visTableRows: any[];
    tableMetadata: any;
    chartWidth: number;
    chartHeight: number;
    scaleFactor: number;
    maxStretchFactor?: number;
    chartUnavailable: boolean;
    onSpecReady?: (spec: any | null) => void;
}> = React.memo(({ chart, conceptShelfItems, visTableRows, tableMetadata, chartWidth, chartHeight, scaleFactor, maxStretchFactor, chartUnavailable, onSpecReady }) => {
    
    // Initialize from display SVG cache for instant display on chart switch
    const svgCached = displaySvgCache.get(chart.id);
    const [svgContent, setSvgContent] = useState<string | null>(svgCached?.svg ?? null);
    const [assembledSpec, setAssembledSpec] = useState<any>(svgCached?.spec ?? null);

    useEffect(() => {
        
        if (chart.chartType === "Auto" || chart.chartType === "Table" || chartUnavailable) {
            setSvgContent(null);
            setAssembledSpec(null);
            return;
        }

        // Skip rendering when we have no data yet (data is being fetched)
        if (visTableRows.length === 0) {
            return;
        }

        const spec = assembleVegaChart(
            chart.chartType, 
            chart.encodingMap, 
            conceptShelfItems, 
            visTableRows, 
            tableMetadata, 
            chartWidth, 
            chartHeight,
            true,
            chart.config,
            scaleFactor,
            maxStretchFactor,
        );

        if (!spec || spec === "Table") {
            setSvgContent(null);
            setAssembledSpec(null);
            onSpecReady?.(null);
            return;
        }

        spec['background'] = 'white';

        // Check display SVG cache — skip toSVG entirely if spec matches
        const specKey = JSON.stringify(spec);
        const cached = displaySvgCache.get(chart.id);
        if (cached && cached.specKey === specKey) {
            setSvgContent(cached.svg);
            setAssembledSpec(cached.spec);
            onSpecReady?.(cached.spec);
            return;
        }

        setAssembledSpec(spec);
        onSpecReady?.(spec);

        // Headless render via Vega: compile VL → parse → View → toSVG()
        let cancelled = false;
        (async () => {
            try {
                const { compile: vlCompile } = await import('vega-lite');
                const vega = await import('vega');
                const vgSpec = vlCompile(spec as any).spec;
                const runtime = vega.parse(vgSpec);
                const view = new vega.View(runtime, { renderer: 'none' });
                await view.runAsync();
                const svg = await view.toSVG();
                view.finalize();
                if (!cancelled) {
                    setSvgContent(svg);
                    // Cache the rendered SVG for instant reuse on revisit
                    displaySvgCache.set(chart.id, { specKey, svg, spec });
                }
            } catch (err) {
                console.warn('VegaChartRenderer: SVG render failed', err);
                if (!cancelled) {
                    setSvgContent(null);
                }
            }
        })();

        return () => { cancelled = true; };

    }, [chart.id, chart.chartType, chart.encodingMap, chart.config, conceptShelfItems, visTableRows, tableMetadata, chartWidth, chartHeight, scaleFactor, maxStretchFactor, chartUnavailable]);

    const handleSavePng = useCallback(async () => {
        if (!assembledSpec) return;
        try {
            const { compile: vlCompile } = await import('vega-lite');
            const vega = await import('vega');
            const vgSpec = vlCompile(assembledSpec as any).spec;
            const runtime = vega.parse(vgSpec);
            const view = new vega.View(runtime, { renderer: 'none' });
            await view.runAsync();
            const pngUrl = await view.toImageURL('png', 2);
            view.finalize();

            // Trigger download
            const link = document.createElement('a');
            link.download = `${chart.chartType}-${chart.id}.png`;
            link.href = pngUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (err) {
            console.error('Save PNG failed:', err);
        }
    }, [assembledSpec, chart.chartType, chart.id]);

    const handleOpenInVegaEditor = useCallback(() => {
        if (!assembledSpec) return;
        // Use postMessage to pass spec to Vega Editor (same approach as vega-embed)
        const editorUrl = 'https://vega.github.io/editor/';
        const editor = window.open(editorUrl);
        if (!editor) return;

        const wait = 10_000;
        const step = 250;
        const { origin } = new URL(editorUrl);
        let count = Math.floor(wait / step);

        function listen(evt: MessageEvent) {
            if (evt.source === editor) {
                count = 0;
                window.removeEventListener('message', listen, false);
            }
        }
        window.addEventListener('message', listen, false);

        function send() {
            if (count <= 0) return;
            editor!.postMessage({
                spec: JSON.stringify(assembledSpec, null, 2),
                mode: 'vega-lite',
            }, origin);
            setTimeout(send, step);
            count -= 1;
        }
        setTimeout(send, step);
    }, [assembledSpec]);

    if (chart.chartType === "Auto") {
        return <Box sx={{ position: "relative", display: "flex", flexDirection: "column", margin: 'auto', color: 'darkgray' }}>
            <InsightIcon fontSize="large"/>
        </Box>
    }

    if (chart.chartType === "Table") {
        return visTableRows.length > 0 ? renderTableChart(chart, conceptShelfItems, visTableRows) : <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} >
            <InsightIcon fontSize="large"/>
        </Box>;
    }

    const chartTemplate = getChartTemplate(chart.chartType);
    if (!checkChartAvailabilityOnPreparedData(chart, conceptShelfItems, visTableRows)) {
        return <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} >
            {generateChartSkeleton(chartTemplate?.icon, 48, 48)}
        </Box>
    }

    return (
        <Box sx={{ mx: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '100%', overflow: 'hidden' }}>
            {svgContent ? (
                <Box 
                    dangerouslySetInnerHTML={{ __html: svgContent }}
                    sx={{
                        maxWidth: '100%',
                        '& svg': { display: 'block', maxWidth: '100%', height: 'auto' },
                    }}
                />
            ) : (
                <Box sx={{ 
                    width: chartWidth, height: chartHeight, 
                    display: 'flex', alignItems: 'center', justifyContent: 'center' 
                }}>
                    {generateChartSkeleton(chartTemplate?.icon, 48, 48, 0.3)}
                </Box>
            )}

        </Box>
    );
});


export const ChartEditorFC: FC<{}> = function ChartEditorFC({}) {

    const { t } = useTranslation();
    const config = useSelector((state: DataFormulatorState) => state.config);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const componentRef = useRef<HTMLHeadingElement>(null);

    // Add ref for the container box that holds all exploration components
    const explanationComponentsRef = useRef<HTMLDivElement>(null);

    let tables = useSelector((state: DataFormulatorState) => state.tables);
    
    let charts = useSelector(dfSelectors.getAllCharts);
    let focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    let focusedChartId = focusedId?.type === 'chart' ? focusedId.chartId : undefined;
    let chartSynthesisInProgress = useSelector((state: DataFormulatorState) => state.chartSynthesisInProgress) || [];

    let synthesisRunning = focusedChartId ? chartSynthesisInProgress.includes(focusedChartId) : false;
    let handleDeleteChart = () => { focusedChartId && dispatch(dfActions.deleteChartById(focusedChartId)) }

    // Track the assembled Vega-Lite spec from the renderer so we can open it in the Vega Editor
    const [renderedSpec, setRenderedSpec] = useState<any | null>(null);
    const handleSpecReady = useCallback((spec: any | null) => { setRenderedSpec(spec); }, []);

    const handleOpenInVegaEditor = useCallback(() => {
        if (!renderedSpec) return;
        const editorUrl = 'https://vega.github.io/editor/';
        const editor = window.open(editorUrl);
        if (!editor) return;
        const wait = 10_000;
        const step = 250;
        const { origin } = new URL(editorUrl);
        let count = Math.floor(wait / step);
        function listen(evt: MessageEvent) {
            if (evt.source === editor) {
                count = 0;
                window.removeEventListener('message', listen, false);
            }
        }
        window.addEventListener('message', listen, false);
        function send() {
            if (count <= 0) return;
            editor!.postMessage({ spec: JSON.stringify(renderedSpec, null, 2), mode: 'vega-lite' }, origin);
            setTimeout(send, step);
            count -= 1;
        }
        setTimeout(send, step);
    }, [renderedSpec]);

    let focusedChart = charts.find(c => c.id == focusedChartId) as Chart;
    let trigger = focusedChart.source == "trigger" ? tables.find(t => t.derive?.trigger?.chart?.id == focusedChartId)?.derive?.trigger : undefined;

    const dispatch = useDispatch();

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    const [codeViewOpen, setCodeViewOpen] = useState<boolean>(false);
    const [conceptExplanationsOpen, setConceptExplanationsOpen] = useState<boolean>(false);
    const [insightViewOpen, setInsightViewOpen] = useState<boolean>(false);
    
    const [chatDialogOpen, setChatDialogOpen] = useState<boolean>(false);
    const [localScaleFactor, setLocalScaleFactor] = useState<number>(1);

    // Reset local UI state when focused chart changes
    useEffect(() => {
        setCodeViewOpen(false);
        setConceptExplanationsOpen(false);
        setInsightViewOpen(false);
        setChatDialogOpen(false);
        setLocalScaleFactor(1);
    }, [focusedChartId]);

    // Combined useEffect to scroll to exploration components when any of them open
    useEffect(() => {
        if ((conceptExplanationsOpen || codeViewOpen || insightViewOpen) && explanationComponentsRef.current) {
            setTimeout(() => {
                explanationComponentsRef.current?.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'start' 
                });
            }, 200); // Small delay to ensure the component is rendered
        }
    }, [conceptExplanationsOpen, codeViewOpen, insightViewOpen]);

    let table = getDataTable(focusedChart, tables, charts, conceptShelfItems);

    let visFieldIds = Object.keys(focusedChart.encodingMap).filter(key => focusedChart.encodingMap[key as keyof EncodingMap].fieldID != undefined).map(key => focusedChart.encodingMap[key as keyof EncodingMap].fieldID);
    let visFields = conceptShelfItems.filter(f => visFieldIds.includes(f.id));
    let dataFieldsAllAvailable = visFields.every(f => table.names.includes(f.name));

    // Create a stable identifier for data requirements (fields + aggregations)
    const dataRequirements = useMemo(() => {
        let { aggregateFields, groupByFields } = extractFieldsFromEncodingMap(focusedChart.encodingMap, conceptShelfItems);
        let sortedFields = [...aggregateFields.map(f => `${f[0]}_${f[1]}`), ...groupByFields].sort();

        return JSON.stringify({
            tableId: table.id,
            sortedFields
        });
    }, [focusedChart.encodingMap, conceptShelfItems, table.id]);

    let setSystemMessage = (content: string, severity: "error" | "warning" | "info" | "success") => {
        dispatch(dfActions.addMessages({
            "timestamp": Date.now(),
            "component": t('chart.chartBuilder'),
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

        if (visTable.length > serverConfig.MAX_DISPLAY_ROWS) {
            let rowSample = _.sampleSize(visTable, serverConfig.MAX_DISPLAY_ROWS);
            visTable = rowSample;
        }

        visTable = structuredClone(visTable);

        return visTable;
    }

    const [visTableRows, setVisTableRows] = useState<any[]>(() => createVisTableRowsLocal(table.rows));

    const [visTableTotalRowCount, setVisTableTotalRowCount] = useState<number>(table.virtual?.rowCount || table.rows.length);

    let { aggregateFields, groupByFields } = extractFieldsFromEncodingMap(focusedChart.encodingMap, conceptShelfItems);
    let sortedVisDataFields = [...aggregateFields.map(f => `${f[0]}_${f[1]}`), ...groupByFields].sort();

    // Track which chart+table+requiredFields the current data belongs to (prevents showing stale data during transitions)
    const computeVersionId = () => {
        const contentSuffix = table.contentHash ? `-${table.contentHash.slice(0, 8)}` : `-${table.rows.length}`;
        return `${table.id}-${sortedVisDataFields.join("_")}${contentSuffix}`;
    };
    const [dataVersion, setDataVersion] = useState<string>(computeVersionId());
    const currentRequestRef = useRef<string>('');
    
    // Check if current data is stale (belongs to different table/fields — ignoring contentHash for stale check 
    // since we want to show the previous render while new data is loading)
    const baseVersionId = `${table.id}-${sortedVisDataFields.join("_")}`;
    const isDataStale = !dataVersion.startsWith(baseVersionId);

    // Use empty data if stale to avoid showing incorrect data during transitions
    const activeVisTableRows = isDataStale ? [] : visTableRows;
    const activeVisTableTotalRowCount = isDataStale ? 0 : visTableTotalRowCount;

    async function fetchDisplayRows(sampleSize?: number) {
        if (sampleSize == undefined) {
            sampleSize = 1000;
        }
        // If all rows are already in browser memory, sample locally (no server call needed).
        // This covers non-virtual tables and virtual tables whose rows have been fully loaded.
        const allRowsInMemory = !table.virtual || table.rows.length >= (table.virtual.rowCount || 0);
        if (!allRowsInMemory) {
            // Generate unique request ID to track this specific request
            const requestId = `${focusedChart.id}-${table.id}-${Date.now()}`;
            currentRequestRef.current = requestId;
            
            let { aggregateFields, groupByFields } = extractFieldsFromEncodingMap(focusedChart.encodingMap, conceptShelfItems);
            fetchWithIdentity(getUrls().SAMPLE_TABLE, {
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
                // Only update if this is still the current request (not stale)
                if (currentRequestRef.current === requestId) {
                    const versionId = computeVersionId();
                    if (data.status == "success") {
                        setVisTableRows(data.rows);
                        setVisTableTotalRowCount(data.total_row_count);
                        setDataVersion(versionId);
                        // Cache for instant reuse on chart revisit
                        displayRowsCache.set(versionId, { rows: data.rows, totalCount: data.total_row_count });
                    } else {
                        setVisTableRows([]);
                        setVisTableTotalRowCount(0);
                        setDataVersion(versionId);
                        setSystemMessage(data.message, "error");
                    }
                }
                // Else: this response is stale, ignore it
            })
            .catch(error => {
                // Only show error if this is still the current request
                if (currentRequestRef.current === requestId) {
                    console.error('Error sampling table:', error);
                }
            });
        } else {
            // All rows available locally — use in-memory data
            // When sample size covers all rows, preserve original order
            // (_.sampleSize shuffles, which destroys data-driven sort order)
            const rowsToUse = sampleSize >= table.rows.length
                ? table.rows
                : _.sampleSize(table.rows, sampleSize);
            const clonedRows = structuredClone(rowsToUse);
            const versionId = computeVersionId();
            setVisTableRows(clonedRows);
            setVisTableTotalRowCount(table.rows.length);
            setDataVersion(versionId);
            // Cache for instant reuse on chart revisit
            displayRowsCache.set(versionId, { rows: clonedRows, totalCount: table.rows.length });
        }
    }

    useEffect(() => {
        const allRowsInMemory = !table.virtual || table.rows.length >= (table.virtual.rowCount || 0);
        if (!allRowsInMemory && visFields.length > 0 && dataFieldsAllAvailable) {
            fetchDisplayRows();
        }
    }, [])

    useEffect(() => {
        // Include contentHash in versionId so the cache invalidates when streaming/refreshed data changes
        const contentSuffix = table.contentHash ? `-${table.contentHash.slice(0, 8)}` : `-${table.rows.length}`;
        const versionId = `${table.id}-${sortedVisDataFields.join("_")}${contentSuffix}`;

        if (visFields.length > 0 && dataFieldsAllAvailable) {
            // Check cache first — avoid server round-trip on chart revisit
            const cached = displayRowsCache.get(versionId);
            if (cached) {
                setVisTableRows(cached.rows);
                setVisTableTotalRowCount(cached.totalCount);
                setDataVersion(versionId);
            } else {
                fetchDisplayRows();
            }
        } else {
            // If no fields, just use the table rows directly
            setVisTableRows(table.rows);
            setVisTableTotalRowCount(table.virtual?.rowCount || table.rows.length);
            setDataVersion(versionId);
        }
    }, [dataRequirements, table.rows])
    


    let encodingShelfEmpty = useMemo(() => {
        return Object.keys(focusedChart.encodingMap).every(key => 
            focusedChart.encodingMap[key as keyof EncodingMap].fieldID == undefined && focusedChart.encodingMap[key as keyof EncodingMap].aggregate == undefined);
    }, [focusedChart.encodingMap]);

    // Calculate chart availability in the parent
    const chartUnavailable = useMemo(() => {
        if (focusedChart.chartType === "Auto" || focusedChart.chartType === "Table") {
            return false;
        }
        
        // Check if fields exist in table and table has rows
        return !(dataFieldsAllAvailable && table.rows.length > 0);
    }, [focusedChart.chartType, dataFieldsAllAvailable, table.rows.length]);

    let resultTable = tables.find(t => t.id == trigger?.resultTableId);

    // Chart insight
    const chartInsightInProgress = useSelector((state: DataFormulatorState) => state.chartInsightInProgress) || [];
    const insightLoading = chartInsightInProgress.includes(focusedChart.id);
    const currentInsightKey = computeInsightKey(focusedChart);
    const insightFresh = focusedChart.insight?.key === currentInsightKey;
    
    const actionBtnSx = {
        padding: '4px',
        borderRadius: '6px',
        color: 'text.secondary',
        transition: 'all 0.15s ease',
        '&:hover': {
            backgroundColor: 'rgba(25, 118, 210, 0.08)',
            color: 'primary.main',
        },
        '&.Mui-disabled': {
            color: 'action.disabled',
        },
    };

    let saveButton = (
        <Tooltip key="save-copy-tooltip" title={focusedChart.saved ? t('chart.notAnymore') : t('chart.iLikeIt')}>
            <span>
                <IconButton key="unsave-btn" size="small" sx={actionBtnSx}
                    onClick={() => {
                        if (!chartUnavailable) {
                            dispatch(dfActions.saveUnsaveChart(focusedChart.id));
                        }
                    }}>
                    {focusedChart.saved ? <StarIcon sx={{ fontSize: 18, color: "goldenrod" }} /> : <StarBorderIcon sx={{ fontSize: 18 }} />}
                </IconButton>
            </span>
        </Tooltip>
    );

    let deleteButton = (
        <Tooltip title={t('chart.delete')} key="delete-btn-tooltip">
            <span>
                <IconButton size="small" disabled={trigger != undefined}
                    sx={{ ...actionBtnSx, color: 'error.main', '&:hover': { backgroundColor: 'rgba(211, 47, 47, 0.08)', color: 'error.main' } }}
                    onClick={() => { handleDeleteChart() }}>
                    <DeleteIcon sx={{ fontSize: 18 }} />
                </IconButton>
            </span>
        </Tooltip>
    );

    let transformCode = "";
    if (table.derive?.code) {
        transformCode = `${table.derive.code}`
    }

    // Check if concepts are available
    const availableConcepts = extractConceptExplanations(table);
    const hasConcepts = availableConcepts.length > 0;

    let derivedTableItems = (resultTable?.derive || table.derive) ? [
        <Box key="explanation-toggle-group" sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            mx: 0.5,
            backgroundColor: 'rgba(0, 0, 0, 0.02)',
            borderRadius: 1,
            padding: '2px',
            border: `1px solid ${borderColor.component}`
        }}>
            <ButtonGroup
                key="explanation-button-group"
                size="small"
                sx={{
                    '& .MuiButton-root': {
                        textTransform: 'none',
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        border: 'none',
                        borderRadius: '3px',
                        padding: '2px 6px',
                        minWidth: 'auto',
                        color: 'text.secondary',
                        '&:hover': {
                            backgroundColor: 'rgba(25, 118, 210, 0.08)',
                        }
                    }
                }}
            >
                <Button 
                    key="chat-dialog-btn"
                    onClick={() => { setChatDialogOpen(!chatDialogOpen) }}
                    sx={{
                        backgroundColor: chatDialogOpen ? 'rgba(25, 118, 210, 0.2)' : 'transparent',
                        color: chatDialogOpen ? 'primary.main' : 'text.secondary',
                        fontWeight: chatDialogOpen ? 600 : 500,
                        '&:hover': {
                            backgroundColor: chatDialogOpen ? 'rgba(25, 118, 210, 0.25)' : 'rgba(25, 118, 210, 0.08)',
                        },
                    }}
                >
                    <QuestionAnswerIcon sx={{ fontSize: '14px', mr: 0.5 }} />
                    {t('chart.log')}
                </Button>
                <Button 
                    key="code-btn"
                    onClick={() => {
                        if (codeViewOpen) {
                            setCodeViewOpen(false);
                        } else {
                            setCodeViewOpen(true);
                            setConceptExplanationsOpen(false);
                            setInsightViewOpen(false);
                        }
                    }}
                    sx={{
                        backgroundColor: codeViewOpen ? 'rgba(25, 118, 210, 0.2)' : 'transparent',
                        color: codeViewOpen ? 'primary.main' : 'text.secondary',
                        fontWeight: codeViewOpen ? 600 : 500,
                        '&:hover': {
                            backgroundColor: codeViewOpen ? 'rgba(25, 118, 210, 0.25)' : 'rgba(25, 118, 210, 0.08)',
                        }
                    }}
                >
                    <TerminalIcon sx={{ fontSize: '14px', mr: 0.5 }} />
                    {t('chart.code')}
                </Button>
                {hasConcepts && (
                    <Button 
                        key="concepts-btn"
                        onClick={() => {
                            if (conceptExplanationsOpen) {
                                setConceptExplanationsOpen(false);
                            } else {
                                setConceptExplanationsOpen(true);
                                setCodeViewOpen(false);
                                setInsightViewOpen(false);
                            }
                        }}
                        sx={{
                            backgroundColor: conceptExplanationsOpen ? 'rgba(25, 118, 210, 0.2)' : 'transparent',
                            color: conceptExplanationsOpen ? 'primary.main' : 'text.secondary',
                            fontWeight: conceptExplanationsOpen ? 600 : 500,
                            '&:hover': {
                                backgroundColor: conceptExplanationsOpen ? 'rgba(25, 118, 210, 0.25)' : 'rgba(25, 118, 210, 0.08)',
                            }
                        }}
                    >
                        <InfoIcon sx={{ fontSize: '14px', mr: 0.5 }} />
                        {t('chart.concepts')}
                    </Button>
                )}
            </ButtonGroup>
        </Box>,
        <ChatDialog key="chat-dialog-button" open={chatDialogOpen} 
                    handleCloseDialog={() => { setChatDialogOpen(false) }}
                    code={transformCode}
                    dialog={resultTable?.derive?.dialog || table.derive?.dialog as any[]} />
    ] : [];

    let insightButton = !chartUnavailable && focusedChart.chartType !== "Table" ? (
        <Box key="insight-toggle-group" sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            mx: 0.5,
            backgroundColor: 'rgba(0, 0, 0, 0.02)',
            borderRadius: 1,
            padding: '2px',
            border: `1px solid ${borderColor.component}`
        }}>
            <Button 
                key="insight-btn"
                size="small"
                onClick={() => {
                    if (insightViewOpen) {
                        setInsightViewOpen(false);
                    } else {
                        setInsightViewOpen(true);
                        setCodeViewOpen(false);
                        setConceptExplanationsOpen(false);
                        if (!insightFresh && !insightLoading) {
                            dispatch(fetchChartInsight({ chartId: focusedChart.id, tableId: table.id }) as any);
                        }
                    }
                }}
                sx={{
                    textTransform: 'none',
                    fontSize: '0.7rem',
                    fontWeight: insightViewOpen ? 600 : 500,
                    minWidth: 'auto',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    backgroundColor: insightViewOpen ? 'rgba(25, 118, 210, 0.2)' : 'transparent',
                    color: insightViewOpen ? 'primary.main' : 'text.secondary',
                    '&:hover': {
                        backgroundColor: insightViewOpen ? 'rgba(25, 118, 210, 0.25)' : 'rgba(25, 118, 210, 0.08)',
                    }
                }}
            >
                <InsightIcon sx={{ fontSize: '14px', mr: 0.5 }} />
                {insightLoading ? <CircularProgress size={10} sx={{ ml: 0.5 }} /> : t('chart.insight')}
            </Button>
        </Box>
    ) : null;
    
    let vegaEditorButton = (
        <Tooltip key="vega-editor-tooltip" title={t('chart.openInVegaEditor')}>
            <span>
                <IconButton key="vega-editor-btn" size="small" sx={actionBtnSx}
                    disabled={!renderedSpec || focusedChart.chartType === "Table" || focusedChart.chartType === "Auto"}
                    onClick={handleOpenInVegaEditor}>
                    <OpenInNewIcon sx={{ fontSize: 18 }} />
                </IconButton>
            </span>
        </Tooltip>
    );

    let chartActionButtons = [
        ...derivedTableItems,
        insightButton,
        saveButton,
        vegaEditorButton,
        deleteButton,
    ]


    let chartMessage = "";
    if (focusedChart.chartType == "Table") {
        chartMessage = t('chart.msgTable');
    } else if (focusedChart.chartType == "Auto") {
        chartMessage = t('chart.msgAuto');
    } else if (encodingShelfEmpty) {
        chartMessage = t('chart.msgEncodingEmpty');
    } else if (chartUnavailable) {
        chartMessage = t('chart.msgUnavailable');
    } else if (chartSynthesisInProgress.includes(focusedChart.id)) {
        chartMessage = t('chart.msgSynthesizing');
    } else if (table.derive) {
        chartMessage = t('chart.msgWarning');
    }

    let chartActionItems = isDataStale ? [] : (
        <Box sx={{display: "flex", flexDirection: "column", flex: 1, my: 1}}>
            {(table.virtual ? activeVisTableTotalRowCount > serverConfig.MAX_DISPLAY_ROWS : table.rows.length > serverConfig.MAX_DISPLAY_ROWS) && !(chartUnavailable || encodingShelfEmpty) ? (
                <Box sx={{ display: 'flex', flexDirection: "row", margin: "auto", justifyContent: 'center', alignItems: 'center'}}>
                    <Typography component="span" fontSize="small" color="text.secondary" sx={{textAlign:'center'}}>
                        {t('chart.visualizing')}
                    </Typography>
                    <SampleSizeEditor 
                        initialSize={activeVisTableRows.length}
                        totalSize={activeVisTableTotalRowCount}
                        onSampleSizeChange={(newSize) => {
                            fetchDisplayRows(newSize);
                        }}
                    />
                    <Typography component="span" fontSize="small" color="text.secondary" sx={{textAlign:'center'}}>
                        {t('chart.sampleRows')}
                    </Typography>
                    <Tooltip title={t('chart.sampleAgain')}>
                        <IconButton size="small" color="primary" onClick={() => {
                            fetchDisplayRows(activeVisTableRows.length);
                        }}>
                            <CasinoIcon sx={{ fontSize: '14px', 
                                transition: 'transform 0.5s ease-in-out', '&:hover': { transform: 'rotate(180deg)' } }}/>
                        </IconButton>
                    </Tooltip>
                </Box>
            ) : ""}
            <Typography component="span" fontSize="small" color="text.secondary" sx={{textAlign:'center'}}>
                {chartMessage}
            </Typography>
        </Box>
    )
    
    let focusedComponent = [];

    let focusedElement = <Fade key={`fade-${focusedChart.id}-${dataVersion}-${focusedChart.chartType}-${JSON.stringify(focusedChart.encodingMap)}`} 
                            in={!isDataStale} timeout={600}>    
                            <Box sx={{display: "flex", flexDirection: "column", flexShrink: 0, justifyContent: 'center', justifyItems: 'center', maxWidth: '100%'}} className="chart-box">
                                {insightFresh && focusedChart.insight?.title && (
                                    <Typography fontSize="small" sx={{
                                        fontWeight: (focusedChart.encodingMap.column?.fieldID || focusedChart.encodingMap.row?.fieldID) ? 400 : 600,
                                        textAlign: 'center', mb: 0.5, color: 'text.secondary',
                                    }}>
                                        {focusedChart.insight.title}
                                    </Typography>
                                )}
                                <Box sx={{m: 'auto', minHeight: 240, maxWidth: '100%', overflow: 'hidden'}}>
                                    <VegaChartRenderer
                                        key={focusedChart.id}
                                        chart={focusedChart}
                                        conceptShelfItems={conceptShelfItems}
                                        visTableRows={activeVisTableRows}
                                        tableMetadata={table.metadata}
                                        chartWidth={config.defaultChartWidth}
                                        chartHeight={config.defaultChartHeight}
                                        scaleFactor={localScaleFactor}
                                        maxStretchFactor={config.maxStretchFactor}
                                        chartUnavailable={chartUnavailable}
                                        onSpecReady={handleSpecReady}
                                    />
                                </Box>
                                {chartActionItems}
                            </Box>                        
                        </Fade>;

    focusedComponent = [
        <Box key="chart-focused-element"  sx={{ width: "100%", minHeight: "calc(100% - 40px)", margin: "auto", mt: 4, mb: 1, display: "flex", flexDirection: "column"}}>
            {focusedElement}
            <Box ref={explanationComponentsRef} sx={{width: "100%", mx: "auto"}}>
                <Collapse in={conceptExplanationsOpen}>
                    <Box sx={{minWidth: 440, maxWidth: 800, padding: "0px 8px", position: 'relative', margin: '8px auto'}}>
                        <ConceptExplCards 
                            concepts={extractConceptExplanations(table)}
                            title={t('chart.derivedConcepts')}
                            maxCards={8}
                        />
                    </Box>
                </Collapse>
                <Collapse in={codeViewOpen}>
                    <Box sx={{minWidth: 440, maxWidth: 800, padding: "0px 8px", position: 'relative', margin: '8px auto'}}>
                        <ButtonGroup sx={{position: 'absolute', right: 8, top: 1}}>
                            <IconButton onClick={() => {
                                setCodeViewOpen(false);
                            }}  color='primary' aria-label={t('app.close')}>
                                <CloseIcon />
                            </IconButton>
                        </ButtonGroup>
                        {/* <Typography fontSize="small" sx={{color: 'gray'}}>{table.derive?.source} → {table.id}</Typography> */}
                        <CodeExplanationCard
                            title={t('chart.dataTransformCode')}
                            icon={<CodeIcon sx={{ fontSize: 16, color: 'primary.main' }} />}
                        >
                            <Box sx={{
                                    maxHeight: '400px', 
                                    overflow: 'auto', 
                                    width: '100%', 
                                    p: 0.5
                                }}
                            >   
                                <CodeBox code={transformCode.trimStart()} language={table.virtual ? "sql" : "python"} />
                            </Box>
                        </CodeExplanationCard>
                    </Box>
                </Collapse>
                <Collapse in={insightViewOpen}>
                    <Box sx={{minWidth: 440, maxWidth: 800, padding: "0px 8px", position: 'relative', margin: '8px auto'}}>
                        <ButtonGroup sx={{position: 'absolute', right: 8, top: 0}}>
                            <IconButton onClick={() => {
                                setInsightViewOpen(false);
                            }}  color='primary' aria-label={t('app.close')}>
                                <CloseIcon />
                            </IconButton>
                        </ButtonGroup>
                        <CodeExplanationCard
                            title={t('chart.chartInsight')}
                            icon={<InsightIcon sx={{ fontSize: 16, color: 'primary.main' }} />}
                        >
                            {insightLoading ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1 }}>
                                    <CircularProgress size={16} />
                                    <Typography fontSize="small" color="text.secondary">{t('chart.analyzingChart')}</Typography>
                                </Box>
                            ) : insightFresh && focusedChart.insight ? (
                                <Box sx={{ p: 0.5 }}>
                                    <Typography fontSize="small" sx={{ fontWeight: 600, mb: 0.5 }}>
                                        {focusedChart.insight.title}
                                    </Typography>
                                    {(focusedChart.insight.takeaways || []).map((t, i) => (
                                        <Typography key={i} fontSize="small" color="text.secondary" sx={{ mb: 0.25, display: 'flex', alignItems: 'baseline' }}>
                                            <span style={{ marginRight: 4, flexShrink: 0 }}>•</span>{t}
                                        </Typography>
                                    ))}
                                    <Button 
                                        size="small" 
                                        sx={{ mt: 1, textTransform: 'none', fontSize: '0.7rem' }}
                                        onClick={() => {
                                            dispatch(fetchChartInsight({ chartId: focusedChart.id, tableId: table.id }) as any);
                                        }}
                                    >
                                        {t('chart.regenerate')}
                                    </Button>
                                </Box>
                            ) : (
                                <Box sx={{ p: 0.5 }}>
                                    <Typography fontSize="small" color="text.secondary">
                                        {t('chart.noInsightAvailable')}
                                    </Typography>
                                    <Button 
                                        size="small" 
                                        sx={{ mt: 0.5, textTransform: 'none', fontSize: '0.7rem' }}
                                        onClick={() => {
                                            dispatch(fetchChartInsight({ chartId: focusedChart.id, tableId: table.id }) as any);
                                        }}
                                    >
                                        {t('chart.generateInsight')}
                                    </Button>
                                </Box>
                            )}
                        </CodeExplanationCard>
                    </Box>
                </Collapse>
            </Box>
            <Box key='chart-action-buttons' sx={{ 
                display: 'flex', flexShrink: 0, flexDirection: "row", alignItems: 'center',
                mx: "auto", py: 0.5, gap: 0.25,
            }}>
                {chartActionButtons}
            </Box>
        </Box>
    ]
    
    const ENCODING_SHELF_WIDTH = 240;

    let content = [
        <Box key='focused-box' className="vega-focused" sx={{ display: "flex", overflow: 'auto', flexDirection: 'column', position: 'relative', flex: 1, pr: `${ENCODING_SHELF_WIDTH}px` }}>
            {focusedComponent}
        </Box>,
        /* Floating encoding shelf panel */
        <Box key='encoding-shelf' sx={{
            position: 'absolute',
            top: 0,
            right: 0,
            zIndex: 10,
            height: '100%',
            pointerEvents: 'none',
        }}>
            <Box sx={{ pointerEvents: 'auto' }}>
                <EncodingShelfThread chartId={focusedChart.id} />
            </Box>
        </Box>
    ]

    let [scaleMin, scaleMax] = [0.2, 2.4]

    // Memoize chart resizer to avoid re-creating Material-UI components on every render
    let chartResizer = useMemo(() => <Stack spacing={1} direction="row" sx={{ 
        margin: 1, width: 160, position: "absolute", zIndex: 10, 
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        borderRadius: '4px',
    }} alignItems="center">
        <Tooltip key="zoom-out-tooltip" title={t('chart.zoomOut')}>
            <span>
                <IconButton color="primary" size='small' disabled={localScaleFactor <= scaleMin} onClick={() => {
                    setLocalScaleFactor(s => Math.max(scaleMin, Math.round((s - 0.1) * 10) / 10));
                }}>
                    <ZoomOutIcon fontSize="small" />
                </IconButton>
            </span>
        </Tooltip>
        <Slider aria-label={t('chart.resizeSliderAria')} size='small' defaultValue={1} step={0.1} min={scaleMin} max={scaleMax} 
                value={localScaleFactor} onChange={(event: Event, newValue: number | number[]) => {
            setLocalScaleFactor(newValue as number);
        }} />
        <Tooltip key="zoom-in-tooltip" title={t('chart.zoomIn')}>
            <span>
                <IconButton color="primary" size='small' disabled={localScaleFactor >= scaleMax} onClick={() => {
                    setLocalScaleFactor(s => Math.min(scaleMax, Math.round((s + 0.1) * 10) / 10));
                }}>
                    <ZoomInIcon fontSize="small" />
                </IconButton>
            </span>
        </Tooltip>
    </Stack>, [localScaleFactor, t]);

    return <Box ref={componentRef} sx={{overflow: "hidden", display: 'flex', flex: 1, position: 'relative'}}>
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

    const { t } = useTranslation();
    let allCharts = useSelector(dfSelectors.getAllCharts);
    let focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    let focusedChartId = focusedId?.type === 'chart' ? focusedId.chartId : undefined;
    let focusedTableId = React.useMemo(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        const chartId = focusedId.chartId;
        const chart = allCharts.find(c => c.id === chartId);
        return chart?.tableRef;
    }, [focusedId, allCharts]);
    let chartSynthesisInProgress = useSelector((state: DataFormulatorState) => state.chartSynthesisInProgress) || [];

    const dispatch = useDispatch();

    let focusedChart = allCharts.find(c => c.id == focusedChartId) as Chart;
    let synthesisRunning = focusedChartId ? chartSynthesisInProgress.includes(focusedChartId) : false;

    // when there is no result and synthesis is running, just show the waiting panel
    if (!focusedChart || focusedChart?.chartType == "?") {
        let chartSelectionBox = <Box sx={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 2 }}>
            {Object.entries(CHART_TEMPLATES)
                .filter(([category, templates]) => category !== "Custom" && templates.some(t => t.chart !== "Auto"))
                .map(([category, templates]) => (
                    <Box key={category} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        {templates
                            .filter(t => t.chart !== "Auto")
                            .map((t, index) => (
                                <Button
                                    disabled={synthesisRunning}
                                    key={`${category}-${index}-${t.chart}-btn`}
                                    sx={{ margin: '1px', padding: '2px', display: 'flex', flexDirection: 'row',
                                        textTransform: 'none', justifyContent: 'flex-start', minWidth: 0, width: '100%' }}
                                    onClick={() => {
                                        let focusedChart = allCharts.find(c => c.id == focusedChartId);
                                        if (focusedChart?.chartType == "?") {
                                            dispatch(dfActions.updateChartType({ chartType: t.chart, chartId: focusedChartId as string }));
                                        } else {
                                            dispatch(dfActions.createNewChart({ chartType: t.chart, tableId: focusedTableId as string }));
                                        }
                                    }}
                                >
                                    <Box sx={{ opacity: synthesisRunning ? 0.5 : 1, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        {typeof t?.icon == 'string' ? <img height="40px" width="40px" src={t?.icon} alt="" role="presentation" /> : t.icon}
                                    </Box>
                                    <Typography sx={{ ml: '4px', whiteSpace: "nowrap", fontSize: '10px', lineHeight: 1.2 }}>{t?.chart}</Typography>
                                </Button>
                            ))
                        }
                    </Box>
                ))
            }
        </Box>
        return (
            <Box sx={{  margin: "auto" }}>
                {focusedTableId ? <ChartRecBox sx={{margin: 'auto'}} tableId={focusedTableId as string} placeHolderChartId={focusedChartId as string} /> : null}
                <Divider sx={{my: 3}} textAlign='left'>
                    <Typography sx={{fontSize: 12, color: "text.secondary"}}>
                        {t('chart.orStartWithChartType')}
                    </Typography>
                </Divider>
                {chartSelectionBox}
            </Box>
        )
    }

    let visPanel = <Box sx={{ width: "100%", overflow: "hidden", display: "flex", flexDirection: "row" }}>
        <Box className="visualization-carousel" sx={{display: "contents"}} >
            <ChartEditorFC />
        </Box>
    </Box>

    return visPanel;
}
