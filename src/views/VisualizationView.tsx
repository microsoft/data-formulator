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
    Fade,
    Grow,
    alpha,
} from '@mui/material';

import _ from 'lodash';

import { borderColor, transition } from '../app/tokens';
import { WritingIndicator } from '../components/FunComponents';

import ButtonGroup from '@mui/material/ButtonGroup';


import '../scss/VisualizationView.scss';
import '../scss/DataView.scss';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, fetchChartInsight } from '../app/dfSlice';
import { assembleVegaChart, extractFieldsFromEncodingMap, getUrls, prepVisTable, fetchWithIdentity } from '../app/utils';
import embed from 'vega-embed';
import { Chart, EncodingItem, EncodingMap, FieldItem, computeInsightKey } from '../components/ComponentType';
import { DictTable } from "../components/ComponentType";

import AddchartIcon from '@mui/icons-material/Addchart';
import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import TerminalIcon from '@mui/icons-material/Terminal';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
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
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import { FreeDataViewFC } from './DataView';


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

// Re-export shared utilities from ChartUtils (canonical location)
import { generateChartSkeleton, getDataTable, checkChartAvailability } from './ChartUtils';
export { generateChartSkeleton, getDataTable, checkChartAvailability };

export let renderTableChart = (
    chart: Chart, conceptShelfItems: FieldItem[], extTable: any[], 
    width: number = 120, height: number = 120,
    fieldDisplayNames?: Record<string, string>) => {

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
            id: name, label: fieldDisplayNames?.[name] || name, minWidth: 30, align: undefined, 
            format: (value: any) => `${value}`, source: field.source
        }
    })

    return <Box sx={{ position: "relative", display: "flex", flexDirection: "column", margin: 'auto' }}>
        <CustomReactTable rows={rows} columnDefs={colDefs} rowsPerPageNum={10} maxCellWidth={180} compact />
    </Box>
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
 * Module-level cache: avoids re-fetching server data when switching back to a chart.
 */
const displayRowsCache = new Map<string, { rows: any[], totalCount: number }>();

/** Main chart uses vega-embed (interactive tooltips). Static toSVG() removes hover behavior. */
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

    const dispatch = useDispatch();
    const elementId = `focused-chart-element-${chart.id}`;

    useEffect(() => {

        if (chart.chartType === "Auto" || chart.chartType === "Table" || chartUnavailable) {
            onSpecReady?.(null);
            return;
        }

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
            onSpecReady?.(null);
            return;
        }

        // Seed chart config with heuristic-computed defaults for properties
        // the user hasn't explicitly set (e.g. independentYAxis toggle).
        if (spec._computedConfig) {
            for (const [key, value] of Object.entries(spec._computedConfig)) {
                if (chart.config?.[key] === undefined) {
                    dispatch(dfActions.updateChartConfig({ chartId: chart.id, key, value }));
                }
            }
        }

        spec['background'] = 'white';
        onSpecReady?.(spec);

        const el = document.getElementById(elementId);
        if (!el) return;

        let cancelled = false;
        const embedResult: { current?: Awaited<ReturnType<typeof embed>> } = {};

        el.innerHTML = '';
        embed(el, { ...spec }, { actions: true, renderer: 'canvas' })
            .then((result) => {
                if (cancelled) {
                    result.finalize();
                    return;
                }
                embedResult.current = result;
            })
            .catch((err) => {
                if (!cancelled) {
                    console.warn('VegaChartRenderer: embed failed', err);
                }
            });

        return () => {
            cancelled = true;
            embedResult.current?.finalize();
            embedResult.current = undefined;
            el.innerHTML = '';
        };

    }, [chart.id, chart.chartType, chart.encodingMap, chart.config, conceptShelfItems, visTableRows, tableMetadata, chartWidth, chartHeight, scaleFactor, maxStretchFactor, chartUnavailable, onSpecReady, elementId]);

    if (chart.chartType === "Auto") {
        return <Box sx={{ position: "relative", display: "flex", flexDirection: "column", margin: 'auto', color: 'darkgray' }}>
            <InsightIcon fontSize="large"/>
        </Box>
    }

    if (chart.chartType === "Table") {
        const displayNames: Record<string, string> = {};
        if (tableMetadata) {
            for (const [k, v] of Object.entries(tableMetadata)) {
                if ((v as any)?.displayName) displayNames[k] = (v as any).displayName;
            }
        }
        return visTableRows.length > 0 ? renderTableChart(chart, conceptShelfItems, visTableRows, 120, 120, Object.keys(displayNames).length > 0 ? displayNames : undefined) : <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} >
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
            <Box
                id={elementId}
                sx={{
                    maxWidth: '100%',
                    '& .vega-embed': { margin: 'auto' },
                }}
            />
        </Box>
    );
});


export const ChartEditorFC: FC<{}> = function ChartEditorFC({}) {

    const { t } = useTranslation();
    const config = useSelector((state: DataFormulatorState) => state.config);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const componentRef = useRef<HTMLHeadingElement>(null);

    // Add ref for the container box that holds all exploration components


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

    const [bottomTab, setBottomTab] = useState<string>('data');
    const [localScaleFactor, setLocalScaleFactor] = useState<number>(1);
    const [chatDialogOpen, setChatDialogOpen] = useState<boolean>(false);

    // Reset local UI state when focused chart changes
    useEffect(() => {
        setBottomTab('data');
        setLocalScaleFactor(1);
        setChatDialogOpen(false);
    }, [focusedChartId]);



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

    let triggerTable = tables.find(t => t.derive?.trigger?.chart?.id == focusedChart?.id);

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
    const hasDerived = !!(triggerTable?.derive || table.derive);

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

    // Toggle buttons for bottom-panel content (icon + text label)
    const toggleBtnSx = (active: boolean) => ({
        textTransform: 'none' as const,
        fontSize: '0.7rem',
        padding: '2px 8px',
        borderRadius: '6px',
        color: active ? 'primary.main' : 'text.secondary',
        backgroundColor: active ? 'rgba(25, 118, 210, 0.08)' : 'transparent',
        transition: 'all 0.15s ease',
        minWidth: 'auto',
        '&:hover': {
            backgroundColor: 'rgba(25, 118, 210, 0.08)',
            color: 'primary.main',
        },
    });

    let dataButton = (
        <Button key="data-btn" size="small"
            sx={toggleBtnSx(bottomTab === 'data')}
            startIcon={<TableChartOutlinedIcon sx={{ fontSize: 14 }} />}
            onClick={() => setBottomTab(prev => prev === 'data' ? '' : 'data')}>
            {t('chart.data')}
        </Button>
    );

    let derivedTableItems = hasDerived ? [
        <Button key="code-btn" size="small"
            sx={toggleBtnSx(bottomTab === 'code')}
            startIcon={<TerminalIcon sx={{ fontSize: 14 }} />}
            onClick={() => setBottomTab(prev => prev === 'code' ? '' : 'code')}>
            {t('chart.code')}
        </Button>,
        ...(hasConcepts ? [
            <Button key="concepts-btn" size="small"
                sx={toggleBtnSx(bottomTab === 'concepts')}
                startIcon={<AutoStoriesIcon sx={{ fontSize: 14 }} />}
                onClick={() => setBottomTab(prev => prev === 'concepts' ? '' : 'concepts')}>
                {t('chart.concepts')}
            </Button>
        ] : []),
    ] : [];

    let logButton = hasDerived ? (
        <Tooltip key="log-btn-tooltip" title={t('chart.log')}>
            <span>
                <IconButton key="log-btn" size="small" sx={actionBtnSx}
                    onClick={() => setChatDialogOpen(true)}>
                    <QuestionAnswerIcon sx={{ fontSize: 18 }} />
                </IconButton>
            </span>
        </Tooltip>
    ) : null;

    let insightButton = (!chartUnavailable && focusedChart.chartType !== "Table") ? (
        <Button key="insight-btn" size="small"
            sx={toggleBtnSx(bottomTab === 'insight')}
            startIcon={insightLoading ? <CircularProgress size={12} /> : <InsightIcon sx={{ fontSize: 14 }} />}
            onClick={() => {
                setBottomTab(prev => {
                    if (prev === 'insight') return '';
                    if (!insightFresh && !insightLoading) {
                        dispatch(fetchChartInsight({ chartId: focusedChart.id, tableId: table.id }) as any);
                    }
                    return 'insight';
                });
            }}>
            {t('chart.insight')}
        </Button>
    ) : null;

    let chartActionButtons = [
        dataButton,
        insightButton,
        ...derivedTableItems,
        <Divider key="action-divider" orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />,
        logButton,
        saveButton,
        // vegaEditorButton,
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
                            <Box sx={{display: "flex", flexDirection: "column", flexShrink: 0, justifyContent: 'center', justifyItems: 'center', maxWidth: '100%', mt: 'max(120px, 4vh)', mb: 'max(120px, 4vh)'}} className="chart-box">
                                {insightFresh && focusedChart.insight?.title && (
                                    <Typography fontSize="small" sx={{
                                        fontWeight: (focusedChart.encodingMap.column?.fieldID || focusedChart.encodingMap.row?.fieldID) ? 400 : 600,
                                        textAlign: 'center', mb: 0.5, color: 'text.secondary',
                                    }}>
                                        {focusedChart.insight.title}
                                    </Typography>
                                )}
                                <Box sx={{minHeight: 240, maxWidth: '100%', overflow: 'hidden'}}>
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
        <Box key="chart-focused-element" className="chart-focused-box"  sx={{ minHeight: 'min(75vh, 800px)', width: "100%", display: "flex", flexDirection: "column", flexShrink: 0}}>
            <Box sx={{ my: 'auto' }}>
                {focusedElement}
            </Box>
            <Box key='chart-action-buttons' sx={{ 
                display: 'flex', flexShrink: 0, flexDirection: "row", alignItems: 'center',
                mx: "auto", py: 0.5, gap: 0.25,
            }}>
                {chartActionButtons}
            </Box>
        </Box>,
        <React.Fragment key="bottom-panels">
            {(() => {
                const panelBoxSx = {
                    margin: '8px auto 24px auto', padding: '8px', borderRadius: '8px',
                    border: `1px solid ${borderColor.divider}`,
                    transition: 'box-shadow 0.2s ease',
                    '&:hover': { boxShadow: '0 0 8px rgba(25, 118, 210, 0.25)' },
                };
                return <Box sx={{ px: 2 }}>
                    {bottomTab === 'data' && (() => {
                        const ROW_HEIGHT = 25;
                        const HEADER_HEIGHT = 32;
                        const FOOTER_HEIGHT = 32;
                        const MIN_TABLE_HEIGHT = 150;
                        const MAX_TABLE_HEIGHT = 400;
                        const MIN_TABLE_WIDTH = 300;
                        const MAX_TABLE_WIDTH = 900;
                        const rowCount = table.virtual?.rowCount || table.rows?.length || 0;
                        const contentHeight = HEADER_HEIGHT + rowCount * ROW_HEIGHT + FOOTER_HEIGHT;
                        const adaptiveHeight = Math.max(MIN_TABLE_HEIGHT, Math.min(MAX_TABLE_HEIGHT, contentHeight));

                        // Estimate total width from columns (generous: account for type icons, sort arrows, padding)
                        const ROW_ID_COL_WIDTH = 56;
                        const sampleSize = Math.min(29, table.rows.length);
                        const step = table.rows.length > sampleSize ? table.rows.length / sampleSize : 1;
                        const sampledRows = Array.from({ length: sampleSize }, (_, i) => table.rows[Math.floor(i * step)]);
                        const totalColWidth = table.names.reduce((sum, name) => {
                            const values = sampledRows.map(row => String(row[name] || ''));
                            const avgLen = values.length > 0
                                ? values.reduce((s, v) => s + v.length, 0) / values.length
                                : 0;
                            const nameSegs = name.split(/[\s-]+/);
                            const maxNameSegLen = nameSegs.reduce((m, seg) => Math.max(m, seg.length), 0);
                            const contentLen = Math.max(maxNameSegLen, avgLen);
                            return sum + Math.max(80, Math.min(280, contentLen * 10)) + 60;
                        }, ROW_ID_COL_WIDTH);
                        const SCROLLBAR_WIDTH = 17;
                        const adaptiveWidth = Math.max(MIN_TABLE_WIDTH, Math.min(MAX_TABLE_WIDTH, totalColWidth + SCROLLBAR_WIDTH + 16));

                        return (
                            <Box sx={{ ...panelBoxSx, padding: 0, height: adaptiveHeight, width: adaptiveWidth, overflow: 'hidden', flexShrink: 0 }}>
                                <FreeDataViewFC />
                            </Box>
                        );
                    })()}
                    {bottomTab === 'code' && hasDerived && (
                        <Box sx={{ ...panelBoxSx, minWidth: 440, maxWidth: 800 }}>
                            <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
                                <CodeBox code={transformCode.trimStart()} language={table.virtual ? "sql" : "python"} />
                            </Box>
                        </Box>
                    )}
                    {bottomTab === 'concepts' && hasConcepts && (
                        <Box sx={{ ...panelBoxSx, minWidth: 440, maxWidth: 800 }}>
                            <ConceptExplCards
                                concepts={extractConceptExplanations(table)}
                                title={t('chart.derivedConcepts')}
                                maxCards={8}
                            />
                        </Box>
                    )}
                    {bottomTab === 'insight' && (
                        <Box sx={{ ...panelBoxSx, minWidth: 440, maxWidth: 800 }}>
                            {insightLoading ? (
                                <Box sx={{ p: 2 }}>
                                    <WritingIndicator label={t('chart.analyzingChart')} />
                                </Box>
                            ) : insightFresh && focusedChart.insight ? (
                                <Box sx={{ p: 1.5 }}>
                                    <Box sx={{ 
                                        display: 'grid', 
                                        gridTemplateColumns: 'repeat(2, 1fr)',
                                        gap: 1,
                                    }}>
                                        {(focusedChart.insight.takeaways || []).map((takeaway, i) => (
                                            <Box key={i} sx={{
                                                padding: '8px 12px',
                                                borderLeft: '3px solid',
                                                borderLeftColor: 'primary.light',
                                                borderRadius: '2px',
                                                backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.5),
                                                transition: transition.normal,
                                                '&:hover': {
                                                    backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.04),
                                                },
                                            }}>
                                                <Typography sx={{ fontSize: '12px', lineHeight: 1.5, color: 'text.primary' }}>
                                                    {takeaway}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                    <Button
                                        size="small"
                                        sx={{ mt: 1.5, textTransform: 'none', fontSize: '0.7rem' }}
                                        onClick={() => {
                                            dispatch(fetchChartInsight({ chartId: focusedChart.id, tableId: table.id }) as any);
                                        }}
                                    >
                                        {t('chart.regenerate')}
                                    </Button>
                                </Box>
                            ) : (
                                <Box sx={{ p: 1.5 }}>
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
                        </Box>
                    )}
                </Box>;
            })()}
        </React.Fragment>,
        <Box key="bottom-spacer" sx={{ flexShrink: 0, height: 16 }} />,
        hasDerived ? <ChatDialog key="chat-dialog-overlay" open={chatDialogOpen}
            handleCloseDialog={() => setChatDialogOpen(false)}
            code={transformCode}
            dialog={triggerTable?.derive?.dialog || table.derive?.dialog as any[]} /> : null,
    ]
    
    const ENCODING_SHELF_WIDTH = 240;

    let content = [
        <Box key='focused-box' className="vega-focused vis-scroll" sx={{ display: "flex", overflowY: 'auto', overflowX: 'hidden', flexDirection: 'column', position: 'relative', flex: 1, pr: `${ENCODING_SHELF_WIDTH}px` }}>
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
        const chartId = (focusedId as { type: 'chart'; chartId: string }).chartId;
        const chart = allCharts.find(c => c.id === chartId);
        return chart?.tableRef;
    }, [focusedId, allCharts]);
    let chartSynthesisInProgress = useSelector((state: DataFormulatorState) => state.chartSynthesisInProgress) || [];

    const dispatch = useDispatch();

    let tables = useSelector((state: DataFormulatorState) => state.tables);

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
            <Box sx={{ width: "100%", overflow: "hidden", display: "flex", flexDirection: "row" }}>
                <Box sx={{ overflow: "hidden", display: 'flex', flex: 1 }}>
                    <Box className="vis-scroll" sx={{ display: 'flex', overflowY: 'auto', overflowX: 'hidden', flexDirection: 'column', flex: 1 }}>
                        <Box sx={{ minHeight: 'min(75vh, 600px)', width: '100%', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                            <Box sx={{ margin: 'auto' }}>
                                {focusedTableId ? <ChartRecBox sx={{margin: 'auto'}} tableId={focusedTableId as string} placeHolderChartId={focusedChartId as string} /> : null}
                                <Divider sx={{my: 3}} textAlign='left'>
                                    <Typography sx={{fontSize: 12, color: "text.secondary"}}>
                                        {t('chart.orStartWithChartType')}
                                    </Typography>
                                </Divider>
                                {chartSelectionBox}
                            </Box>
                        </Box>
                        {focusedId?.type === 'table' && focusedTableId && (() => {
                            const focusedTable = tables.find(t => t.id === focusedTableId);
                            if (!focusedTable) return null;
                            const ROW_HEIGHT = 25;
                            const HEADER_HEIGHT = 32;
                            const FOOTER_HEIGHT = 32;
                            const MIN_TABLE_HEIGHT = 150;
                            const MAX_TABLE_HEIGHT = 400;
                            const MIN_TABLE_WIDTH = 300;
                            const MAX_TABLE_WIDTH = 900;
                            const rowCount = focusedTable.virtual?.rowCount || focusedTable.rows?.length || 0;
                            const contentHeight = HEADER_HEIGHT + rowCount * ROW_HEIGHT + FOOTER_HEIGHT;
                            const adaptiveHeight = Math.max(MIN_TABLE_HEIGHT, Math.min(MAX_TABLE_HEIGHT, contentHeight));
                            const ROW_ID_COL_WIDTH = 56;
                            const sampleSize = Math.min(29, focusedTable.rows.length);
                            const step = focusedTable.rows.length > sampleSize ? focusedTable.rows.length / sampleSize : 1;
                            const sampledRows = Array.from({ length: sampleSize }, (_, i) => focusedTable.rows[Math.floor(i * step)]);
                            const totalColWidth = focusedTable.names.reduce((sum, name) => {
                                const values = sampledRows.map(row => String(row[name] || ''));
                                const avgLen = values.length > 0 ? values.reduce((s, v) => s + v.length, 0) / values.length : 0;
                                const nameSegs = name.split(/[\s-]+/);
                                const maxNameSegLen = nameSegs.reduce((m, seg) => Math.max(m, seg.length), 0);
                                const contentLen = Math.max(maxNameSegLen, avgLen);
                                return sum + Math.max(80, Math.min(280, contentLen * 10)) + 60;
                            }, ROW_ID_COL_WIDTH);
                            const SCROLLBAR_WIDTH = 17;
                            const adaptiveWidth = Math.max(MIN_TABLE_WIDTH, Math.min(MAX_TABLE_WIDTH, totalColWidth + SCROLLBAR_WIDTH + 16));
                            return (
                                <Box sx={{
                                    margin: '8px auto 24px auto', padding: 0,
                                    height: adaptiveHeight, width: adaptiveWidth,
                                    borderRadius: '8px',
                                    border: `1px solid ${borderColor.divider}`,
                                    transition: 'box-shadow 0.2s ease',
                                    '&:hover': { boxShadow: '0 0 8px rgba(25, 118, 210, 0.25)' },
                                    overflow: 'hidden', flexShrink: 0,
                                }}>
                                    <FreeDataViewFC />
                                </Box>
                            );
                        })()}
                    </Box>
                </Box>
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
