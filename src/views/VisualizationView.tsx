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
    Card,
    ListSubheader,
    Menu,
    CardContent,
    Slider,
    Dialog,
    DialogTitle,
    DialogContent,
    TextField,
    Popover,
    Popper,
    Paper,
    ClickAwayListener,
    Snackbar,
    Alert,
    Fade,
    Grow,
} from '@mui/material';

import _ from 'lodash';

import { floatingPillSx } from '../app/tokens';

import ButtonGroup from '@mui/material/ButtonGroup';


import '../scss/VisualizationView.scss';
import '../scss/DataView.scss';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { assembleVegaChart, extractFieldsFromEncodingMap, getUrls, prepVisTable, fetchWithIdentity } from '../app/utils';
import { displayRowsCache } from '../app/displayRowsCache';
import { buildEmbeddedDataForChart, applyVariantConfigUI } from '../app/restyle';
import { apiRequest } from '../app/apiClient';
import embed from 'vega-embed';
import { Chart, EncodingItem, EncodingMap, FieldItem, computeInsightKey } from '../components/ComponentType';

import TerminalIcon from '@mui/icons-material/Terminal';
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer';
import TuneIcon from '@mui/icons-material/Tune';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import CasinoIcon from '@mui/icons-material/Casino';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CloseIcon from '@mui/icons-material/Close';
import { AgentToyIcon, AnimatedAgentToyIcon } from './AgentToyIcon';

import { CHART_TEMPLATES, getChartTemplate } from '../components/ChartTemplates';

import Prism from 'prismjs'
import 'prismjs/components/prism-python' // Language
import 'prismjs/components/prism-sql' // Language
import 'prismjs/components/prism-markdown' // Language
import 'prismjs/components/prism-typescript' // Language
import 'prismjs/themes/prism.css'; //Example style, you can use another

import { useTranslation } from 'react-i18next';

import { ChatDialog } from './ChatDialog';
import { EncodingShelfCard } from './EncodingShelfCard';
import { ChartQuickConfig } from './ChartQuickConfig';
import { ChartVariantStrip } from './ChartVariantStrip';
import { CustomReactTable } from './ReactTable';
import { InsightIcon } from '../icons';
import { FreeDataViewFC } from './DataView';
import { formatCellValue } from './ViewUtils';


import { dfSelectors } from '../app/dfSlice';
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
        const isNumeric = rows.some(row => typeof row[name] === 'number');
        return {
            id: name, label: fieldDisplayNames?.[name] || name, minWidth: 30,
            align: (isNumeric ? 'right' : undefined) as 'right' | undefined, 
            format: (value: any) => formatCellValue(value), source: field.source
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
 * Recursively scale every width/height in a Vega-Lite spec by `factor`.
 * Used to apply the zoom resizer to style-variant specs, which bypass the
 * compiler's canvas sizing. Handles numeric sizes, `{step: N}` band sizes,
 * `config.view.continuousWidth/Height` (how continuous-scale charts encode
 * their plot size), and nested view-composition specs (spec / layer /
 * concat / facet).
 */
const scaleSpecSize = (node: any, factor: number): void => {
    if (!node || typeof node !== 'object') return;
    for (const dim of ['width', 'height'] as const) {
        const v = node[dim];
        if (typeof v === 'number') {
            node[dim] = Math.round(v * factor);
        } else if (v && typeof v === 'object' && typeof v.step === 'number') {
            node[dim] = { ...v, step: Math.round(v.step * factor) };
        }
    }
    // Continuous-scale charts (e.g. line/area with quantitative or temporal
    // axes) carry no top-level numeric width/height; their plot size lives in
    // config.view.continuousWidth / continuousHeight. Scale those too so the
    // zoom resizer affects continuous variant charts, not just discrete ones.
    const view = node.config?.view;
    if (view && typeof view === 'object') {
        for (const dim of ['continuousWidth', 'continuousHeight'] as const) {
            if (typeof view[dim] === 'number') {
                view[dim] = Math.round(view[dim] * factor);
            }
        }
    }
    for (const key of ['spec', 'layer', 'concat', 'hconcat', 'vconcat', 'facet'] as const) {
        const child = node[key];
        if (Array.isArray(child)) {
            child.forEach(c => scaleSpecSize(c, factor));
        } else if (child && typeof child === 'object') {
            scaleSpecSize(child, factor);
        }
    }
};

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
    insightTitle?: string;
    onSpecReady?: (spec: any | null) => void;
}> = React.memo(({ chart, conceptShelfItems, visTableRows, tableMetadata, chartWidth, chartHeight, scaleFactor, maxStretchFactor, chartUnavailable, insightTitle, onSpecReady }) => {

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

        // If a style variant is active, render its stored Vega-Lite spec instead of
        // re-assembling from the encodingMap. Variants are user-authored "skins" of
        // the chart (see ChartStyleVariant in components/ComponentType.tsx and
        // design-docs/28-chart-style-refinement-agent.md). The variant spec was
        // stored with the data block stripped — we re-attach live rows + override
        // width/height here so the same variant works at any panel size.
        const activeVariant = chart.activeVariantId
            ? chart.styleVariants?.find(v => v.id === chart.activeVariantId)
            : undefined;

        let spec: any;
        if (activeVariant) {
            spec = JSON.parse(JSON.stringify(activeVariant.vlSpec));
            // Re-attach data using the same conversion the assemble pipeline
            // would apply (e.g. Year 1980 → "1980"). Variants store axis
            // formats and timeUnit choices that were chosen against the
            // converted data; plugging in raw rows here would mismatch
            // those formats. See buildEmbeddedDataForChart.
            const variantValues = buildEmbeddedDataForChart(
                chart, visTableRows, tableMetadata, conceptShelfItems,
            );
            spec.data = { values: variantValues };

            // Apply the variant's generative-UI controls (agent-authored simple
            // knobs) onto the spec using the user's current values. This is a
            // pure "set value at path" transform (no code execution) and runs
            // before size scaling so a control that touches width/height is
            // still scaled by the resizer. See applyVariantConfigUI.
            spec = applyVariantConfigUI(spec, activeVariant.configUI, activeVariant.configValues);

            // Variants bypass assembleVegaChart, so the zoom resizer's
            // scaleFactor (which normally flows through the compiler's canvas
            // sizing) wouldn't affect them. Apply it directly by scaling every
            // width/height in the stored spec — numeric sizes and {step: N}
            // band sizes alike — so the resizer works on restyled charts too.
            if (scaleFactor !== 1) {
                scaleSpecSize(spec, scaleFactor);
            }

        } else {
            spec = assembleVegaChart(
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
        }

        if (!spec || spec === "Table") {
            onSpecReady?.(null);
            return;
        }

        spec['background'] = 'white';

        // Inject the insight title into the Vega-Lite spec instead of rendering
        // it as outside HTML. Vega-Lite anchors the title against the plot group
        // (frame: 'group'), so it stays centered over the actual chart area even
        // when a legend pushes the embed wrapper off-center. We don't override a
        // title already supplied by a style variant.
        if (insightTitle && !spec.title) {
            const faceted = !!(chart.encodingMap.column?.fieldID || chart.encodingMap.row?.fieldID);
            spec.title = {
                text: insightTitle,
                anchor: 'middle',
                fontWeight: 500,
                fontSize: 13,
                color: '#555',
                offset: 12,
            };
        }

        onSpecReady?.(spec);

        const el = document.getElementById(elementId);
        if (!el) return;

        let cancelled = false;
        const embedResult: { current?: Awaited<ReturnType<typeof embed>> } = {};

        el.innerHTML = '';
        embed(el, { ...spec }, { actions: false, renderer: 'canvas' })
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

    }, [chart.id, chart.chartType, chart.encodingMap, chart.config, chart.activeVariantId, chart.styleVariants, conceptShelfItems, visTableRows, tableMetadata, chartWidth, chartHeight, scaleFactor, maxStretchFactor, chartUnavailable, insightTitle, onSpecReady, elementId]);

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
        <Box sx={{ mx: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '100%', overflow: 'visible' }}>
            <Box
                id={elementId}
                sx={{
                    maxWidth: '100%',
                    overflow: 'hidden',
                    // vega-embed adds its `.vega-embed` class to THIS element (the
                    // div we pass to embed()) and renders the <canvas>/<svg> as a
                    // direct child. Vega writes explicit inline width/height (in CSS
                    // px) on that canvas/svg, so we must override them with
                    // !important to let the chart shrink to the panel width while
                    // keeping its aspect ratio (height: auto). A descendant
                    // `.vega-embed` selector would NOT match — the class is on this
                    // element itself, not a child.
                    '& > canvas, & > svg': {
                        maxWidth: '100%',
                        height: 'auto !important',
                    },
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

    const [codeDialogOpen, setCodeDialogOpen] = useState<boolean>(false);
    const [localScaleFactor, setLocalScaleFactor] = useState<number>(1);
    const [chatDialogOpen, setChatDialogOpen] = useState<boolean>(false);
    // Floating encoding-shelf popover. The button lives in the stable outer
    // panel (not inside the chart's <Fade>), so it never remounts or shifts
    // when the chart re-renders. We anchor the popover to that button via a ref.
    const [encodingOpen, setEncodingOpen] = useState<boolean>(false);
    const editButtonRef = useRef<HTMLButtonElement | null>(null);

    // Reset local UI state when focused chart changes
    useEffect(() => {
        setCodeDialogOpen(false);
        // Restore the persisted zoom for the newly focused chart (stored on
        // the Chart object so it survives switching charts and session
        // save/load). Falls back to 1 for charts that have never been zoomed.
        setLocalScaleFactor(focusedChart?.scaleFactor ?? 1);
        setChatDialogOpen(false);
        setEncodingOpen(false);
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
            apiRequest<any>(getUrls().SAMPLE_TABLE, {
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
            .then(({ data }) => {
                // Only update if this is still the current request (not stale)
                if (currentRequestRef.current === requestId) {
                    const versionId = computeVersionId();
                    setVisTableRows(data.rows);
                    setVisTableTotalRowCount(data.total_row_count);
                    setDataVersion(versionId);
                    displayRowsCache.set(versionId, { rows: data.rows, totalCount: data.total_row_count });
                    dispatch(dfActions.bumpDisplayRowsTick());
                }
                // Else: this response is stale, ignore it
            })
            .catch(error => {
                if (currentRequestRef.current === requestId) {
                    setSystemMessage('Failed to sample table data', 'error');
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
            dispatch(dfActions.bumpDisplayRowsTick());
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

    // Chart title: surfaced as the rendered chart heading. The title is kept
    // only while its key matches the chart's current encoded fields (chartType
    // + field ids), so it stays through property edits (e.g. sort order) but is
    // dropped once the encoded fields change.
    const titleFresh = !!focusedChart.title && focusedChart.titleKey === computeInsightKey(focusedChart);
    
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
                                {/*
                                  Chart container chrome
                                  ──────────────────────
                                  - pt: 40  → reserves a strip at the top so the absolutely
                                    positioned zoom-slider overlay (chartResizer, ~32px tall
                                    anchored top-left) never covers chart content. Without this,
                                    full-width charts like KPI grids run right up under the slider.
                                  - pr: 28  → reserves a strip on the right for the floating
                                    "edit chart" button overlay (see the focused-box in `content`).
                                  - minHeight: 280 → guarantees the chart has vertical room to
                                    render even when a chart's intrinsic height is very small
                                    (e.g. one row of compact cards).
                                  These are view-level concerns and intentionally NOT solved per
                                  chart template.
                                */}
                                <Box sx={{minHeight: 280, maxWidth: '100%', overflow: 'hidden', pt: '40px', pr: '28px'}}>
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
                                        insightTitle={titleFresh ? focusedChart.title : undefined}
                                        onSpecReady={handleSpecReady}
                                    />
                                </Box>
                                {/* Quick chart-config controls (toggles/sliders/selects) for
                                    fast in-place tweaks without opening the full encoding
                                    popover. Kept INSIDE the chart-box so it reads as part of
                                    the same chart component rather than drifting down toward
                                    the data panel below. The bar also hosts the built-in
                                    delete-chart action, so it always renders even when there
                                    are no property controls (e.g. Table/Auto charts or while
                                    synthesis is running — in which case property controls are
                                    suppressed but delete stays reachable). */}
                                <ChartQuickConfig
                                    chartId={focusedChart.id}
                                    tableMetadata={table.metadata}
                                    options={(!chartUnavailable && !chartSynthesisInProgress.includes(focusedChart.id) && focusedChart.chartType !== "Table" && focusedChart.chartType !== "Auto") ? renderedSpec?._options : undefined}
                                    deleteDisabled={trigger != undefined}
                                />
                                {chartActionItems}
                            </Box>
                        </Fade>;

    focusedComponent = [
        <Box key="chart-focused-element" className="chart-focused-box"  sx={{ minHeight: 'min(75vh, 800px)', width: "100%", display: "flex", flexDirection: "column", flexShrink: 0}}>
            {/* Style-variant switcher now lives in the floating top toolbar
                (see vis-view-canvas return) so it stays pinned alongside the
                zoom resizer instead of scrolling with the chart content. */}
            <Box sx={{ my: 'auto' }}>
                {focusedElement}
            </Box>
        </Box>,
        <React.Fragment key="bottom-panels">
            {(() => {
                return <Box sx={{ px: 2 }}>
                    {(() => {
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
                        // +34px gutter so the maximize button can sit just outside the table on the right.
                        const adaptiveWidth = Math.max(MIN_TABLE_WIDTH, Math.min(MAX_TABLE_WIDTH, totalColWidth + SCROLLBAR_WIDTH + 16)) + 34;

                        return (
                            <Box sx={{ margin: '8px auto 24px auto', padding: 0, height: adaptiveHeight, width: '100%', minWidth: '80%', maxWidth: adaptiveWidth, overflow: 'hidden' }}>
                                <FreeDataViewFC maximizable />
                            </Box>
                        );
                    })()}
                </Box>;
            })()}
        </React.Fragment>,
        <Box key="bottom-spacer" sx={{ flexShrink: 0, height: 16 }} />,
        hasDerived ? <ChatDialog key="chat-dialog-overlay" open={chatDialogOpen}
            handleCloseDialog={() => setChatDialogOpen(false)}
            code={transformCode}
            dialog={triggerTable?.derive?.dialog || table.derive?.dialog as any[]} /> : null,
        // Code inspector: derivation code + formula/concept metadata, opened from
        // the floating top-right cluster. A clickaway/close dialog (not a bottom
        // tab) so the bottom panel stays a pure data table.
        hasDerived ? (
            <Dialog key="code-dialog-overlay" open={codeDialogOpen} onClose={() => setCodeDialogOpen(false)}
                sx={{ '& .MuiDialog-paper': { maxHeight: '90%' } }}
                maxWidth="md" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.25 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <TerminalIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{t('chart.code')}</Typography>
                    </Box>
                    <IconButton size="small" aria-label={t('app.close')} onClick={() => setCodeDialogOpen(false)}>
                        <CloseIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                </DialogTitle>
                <DialogContent sx={{ overflowY: 'auto', overflowX: 'hidden' }} dividers>
                    {hasConcepts && (
                        <Box sx={{ pb: 1.5, mb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                            <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.disabled', mb: 0.75 }}>
                                {t('chart.derivedConcepts')}
                            </Typography>
                            <ConceptExplCards
                                concepts={extractConceptExplanations(table)}
                                maxCards={8}
                            />
                        </Box>
                    )}
                    <CodeBox code={transformCode.trimStart()} language={table.virtual ? "sql" : "python"} />
                </DialogContent>
            </Dialog>
        ) : null,
    ]
    
    let content = [
        <Box key='focused-box' className="vega-focused vis-scroll" sx={{ display: "flex", overflowY: 'auto', overflowX: 'hidden', flexDirection: 'column', position: 'relative', flex: 1 }}>
            {focusedComponent}
        </Box>,
        /* Encoding shelf popover, anchored to the floating "edit chart" button.
           Rendered as a non-modal Popper (not a Modal-based Popover) so it does
           NOT mount a full-viewport backdrop/focus-trap. That backdrop used to
           swallow pointer events outside the panel, which broke dragging fields
           from the data table into the encoding channels while the shelf is
           open. A ClickAwayListener keeps the "click outside closes it"
           behavior. It listens on `onMouseUp` (mirroring EncodingBox): MUI
           menus/selects portal to document.body but remain REACT descendants of
           this listener, so their events bubble through the React tree on
           mouseUp (before the menu closes on click) and are correctly treated as
           "inside" — picking a chart type therefore does not collapse the shelf.
           A native HTML5 drag from the table fires no mouseUp, so dragging a
           field in does not close the shelf either. */
        <Popper
            key='encoding-popover'
            open={encodingOpen && Boolean(editButtonRef.current)}
            anchorEl={editButtonRef.current}
            placement='bottom-end'
            style={{ zIndex: 1300 }}
        >
            <ClickAwayListener
                mouseEvent="onMouseUp"
                touchEvent="onTouchStart"
                onClickAway={() => setEncodingOpen(false)}
            >
                <Paper
                    elevation={8}
                    sx={{ width: 280, maxHeight: '78vh', overflowY: 'auto', mt: 0.5, py: 0.5, borderRadius: '10px', overflowX: 'visible' }}
                >
                    <EncodingShelfCard chartId={focusedChart.id} />
                    {/* Footer: low-emphasis link to inspect the assembled
                        Vega-Lite spec in the external Vega editor. */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', px: 1.5, pb: 1 }}>
                        <Button
                            size="small"
                            startIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
                            disabled={!renderedSpec || focusedChart.chartType === "Table" || focusedChart.chartType === "Auto"}
                            onClick={handleOpenInVegaEditor}
                            sx={{ textTransform: 'none', fontSize: '0.65rem', color: 'text.disabled', minWidth: 'auto', py: 0, '&:hover': { color: 'text.secondary', backgroundColor: 'transparent' } }}
                        >
                            {t('chart.openInVegaEditor')}
                        </Button>
                    </Box>
                </Paper>
            </ClickAwayListener>
        </Popper>
    ]

    let [scaleMin, scaleMax] = [0.2, 2.4]

    // Persist the zoom onto the chart so it survives switching charts.
    // Called on commit (button click / slider release) rather than on every
    // drag tick, to avoid churning the charts array ref mid-drag.
    const persistScaleFactor = React.useCallback((value: number) => {
        if (!focusedChartId) return;
        dispatch(dfActions.updateChartScaleFactor({
            chartId: focusedChartId,
            scaleFactor: value,
        }));
    }, [dispatch, focusedChartId]);

    // Memoize chart resizer to avoid re-creating Material-UI components on every render
    let chartResizer = useMemo(() => <Stack spacing={1} direction="row" sx={{ 
        width: 160, flexShrink: 0,
    }} alignItems="center">
        <Tooltip key="zoom-out-tooltip" title={t('chart.zoomOut')}>
            <span>
                <IconButton color="primary" size='small' disabled={localScaleFactor <= scaleMin} onClick={() => {
                    const next = Math.max(scaleMin, Math.round((localScaleFactor - 0.1) * 10) / 10);
                    setLocalScaleFactor(next);
                    persistScaleFactor(next);
                }}>
                    <ZoomOutIcon fontSize="small" />
                </IconButton>
            </span>
        </Tooltip>
        <Slider aria-label={t('chart.resizeSliderAria')} size='small' defaultValue={1} step={0.1} min={scaleMin} max={scaleMax} 
                value={localScaleFactor}
                onChange={(event: Event, newValue: number | number[]) => {
                    setLocalScaleFactor(newValue as number);
                }}
                onChangeCommitted={(event, newValue) => {
                    persistScaleFactor(newValue as number);
                }} />
        <Tooltip key="zoom-in-tooltip" title={t('chart.zoomIn')}>
            <span>
                <IconButton color="primary" size='small' disabled={localScaleFactor >= scaleMax} onClick={() => {
                    const next = Math.min(scaleMax, Math.round((localScaleFactor + 0.1) * 10) / 10);
                    setLocalScaleFactor(next);
                    persistScaleFactor(next);
                }}>
                    <ZoomInIcon fontSize="small" />
                </IconButton>
            </span>
        </Tooltip>
    </Stack>, [localScaleFactor, t, persistScaleFactor]);

    return <Box ref={componentRef} id="vis-view-canvas" sx={{overflow: "hidden", display: 'flex', flex: 1, position: 'relative'}}>
        {/* No full-screen block while the agent works: the previous chart
            stays visible, and progress is signaled non-intrusively on the
            chat box + encoding shelf (see EncodingShelfCard). */}
        {/* Floating top toolbar: zoom resizer + style-variant strip live
            together here (NOT inside the scrolling chart content), so every
            control stays pinned to the top of the panel instead of some
            floating and some scrolling away. pointerEvents are disabled on the
            empty bar area so it never blocks chart interaction underneath. */}
        <Box sx={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
            display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: '8px',
            backgroundColor: '#fff',
            pointerEvents: 'none', '& > *': { pointerEvents: 'auto' },
        }}>
            {chartResizer}
            {focusedChart && focusedChart.chartType !== 'Table' && focusedChart.chartType !== 'Auto' && (
                <ChartVariantStrip chartId={focusedChart.id} />
            )}
            {/* Right-aligned floating cluster near the top-right: "inspect /
                edit this chart" controls grouped together (agent log + code +
                encoding shelf). Chart deletion lives in the chart property-config
                bar below the chart. */}
            <Box sx={{ ml: 'auto', mr: '8px', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {hasDerived && (
                    <Tooltip title={t('chart.log')} placement="bottom">
                        <IconButton
                            size="small"
                            onClick={() => setChatDialogOpen(true)}
                            sx={floatingPillSx}>
                            <QuestionAnswerIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                    </Tooltip>
                )}
                {/* Code inspector button — opens the derivation code + formula
                    metadata in a dialog. Only shown for derived tables. */}
                {hasDerived && (
                    <Tooltip title={t('chart.code')} placement="bottom">
                        <IconButton
                            size="small"
                            onClick={() => setCodeDialogOpen(true)}
                            sx={floatingPillSx}>
                            <TerminalIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                    </Tooltip>
                )}
                {/* Edit-chart (encoding shelf) button — opens the encoding shelf
                    popover; stays available even when the chart can't render yet,
                    so users can fix the encoding. */}
                {focusedChart && focusedChart.chartType !== 'Table' && focusedChart.chartType !== 'Auto' && (
                    <Tooltip title={t('chart.editChart')} placement="left">
                        <IconButton
                            ref={editButtonRef}
                            size="small"
                            onClick={() => setEncodingOpen(o => !o)}
                            sx={{
                                ...floatingPillSx,
                                ...(encodingOpen ? {
                                    backgroundColor: 'primary.main',
                                    color: 'primary.contrastText',
                                    '&:hover': { backgroundColor: 'primary.dark', color: 'primary.contrastText' },
                                } : {}),
                            }}>
                            <TuneIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                    </Tooltip>
                )}
            </Box>
        </Box>
        {content}
    </Box>
}

// Landing / empty-state hero shown when no chart is focused AND there is
// no existing thread (no charts, no derived/ancestor tables) for the
// focused table — i.e., the very first moment after data is loaded.
// Leads with a friendly welcome and points the user toward the chat input
// at the bottom-left, then presents the manual chart palette below an
// "or" divider so it's still one click away.
const EmptyStateHero: FC<{ chartSelectionBox: React.ReactNode }> = ({ chartSelectionBox }) => {
    const { t } = useTranslation();
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, width: '100%', py: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, maxWidth: 820, textAlign: 'center' }}>
                <AnimatedAgentToyIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.6 }}>
                    {t('chart.emptyStateSubtitle')}
                </Typography>
            </Box>
            {/* "or" divider + manual chart picker — always visible on the
                fresh-start landing so a user who'd rather start manually
                isn't gated behind an extra click. */}
            <Divider sx={{ mt: 3, mb: 2, width: '100%', maxWidth: 960 }} textAlign='left'>
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                    {t('chart.orCreateYourself')}
                </Typography>
            </Divider>
            <Box sx={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                {chartSelectionBox}
            </Box>
        </Box>
    );
};

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
        let chartSelectionBox = <Box sx={{ display: "flex", flexDirection: "row", flexWrap: "wrap", rowGap: 3, columnGap: 2.5, justifyContent: 'center', maxWidth: 1100 }}>
            {Object.entries(CHART_TEMPLATES)
                .filter(([category, templates]) => category !== "Custom" && templates.some(t => t.chart !== "Auto"))
                .map(([category, templates]) => (
                    <Box key={category} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', px: 0.5, py: 0.5, gap: 0.25 }}>
                        <Typography sx={{
                            fontSize: 11,
                            color: 'text.secondary',
                            fontWeight: 400,
                            mb: 1.5,
                            pl: 1,
                        }}>{category}</Typography>
                        {templates
                            .filter(t => t.chart !== "Auto")
                            .map((t, index) => (
                                <Button
                                    disabled={synthesisRunning}
                                    key={`${category}-${index}-${t.chart}-btn`}
                                    sx={{
                                        margin: 0, padding: '4px 8px 4px 4px',
                                        display: 'flex', flexDirection: 'row',
                                        textTransform: 'none', justifyContent: 'flex-start',
                                        minWidth: 0,
                                    }}
                                    onClick={() => {
                                        let focusedChart = allCharts.find(c => c.id == focusedChartId);
                                        if (focusedChart?.chartType == "?") {
                                            dispatch(dfActions.updateChartType({ chartType: t.chart, chartId: focusedChartId as string }));
                                        } else {
                                            dispatch(dfActions.createNewChart({ chartType: t.chart, tableId: focusedTableId as string }));
                                        }
                                    }}
                                >
                                    <Box sx={{ opacity: synthesisRunning ? 0.5 : 1, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        {typeof t?.icon == 'string'
                                            ? <img height="30px" width="30px" src={t?.icon} alt="" role="presentation" />
                                            : <Box sx={{ '& svg': { width: 30, height: 30 } }}>{t.icon}</Box>}
                                    </Box>
                                    <Typography sx={{ ml: '6px', whiteSpace: "nowrap", fontSize: '11px', lineHeight: 1.2 }}>{t?.chart}</Typography>
                                </Button>
                            ))
                        }
                    </Box>
                ))
            }
        </Box>
        return (
            <Box id="vis-view-canvas" sx={{ width: "100%", overflow: "hidden", display: "flex", flexDirection: "row", position: 'relative' }}>
                <Box sx={{ overflow: "hidden", display: 'flex', flex: 1 }}>
                    <Box className="vis-scroll" sx={{ display: 'flex', overflowY: 'auto', overflowX: 'hidden', flexDirection: 'column', flex: 1 }}>
                        <Box sx={{ minHeight: 'min(75vh, 600px)', width: '100%', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                            <Box sx={{ margin: 'auto', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                {(() => {
                                    // "Has thread" = the focused table is
                                    // already part of an exploration: it has
                                    // real charts, or it's derived from /
                                    // feeds into another table. In that case
                                    // we keep the original compact layout
                                    // (provenance ribbon + "or" + palette).
                                    // Otherwise (fresh start, just-loaded
                                    // data) we show the welcoming hero with
                                    // a chat pointer.
                                    const hasRealCharts = !!focusedTableId && allCharts.some(c =>
                                        c.tableRef === focusedTableId
                                        && c.chartType !== '?'
                                        && c.chartType !== 'Auto'
                                        && c.source !== 'trigger'
                                    );
                                    const focusedTable = focusedTableId ? tables.find(t => t.id === focusedTableId) : undefined;
                                    const hasDerivation = !!focusedTable && (
                                        focusedTable.derive !== undefined
                                        || tables.some(t => t.derive?.trigger?.tableId === focusedTableId)
                                    );
                                    const hasThread = hasRealCharts || hasDerivation;

                                    if (hasThread) {
                                        return chartSelectionBox;
                                    }
                                    return <EmptyStateHero chartSelectionBox={chartSelectionBox} />;
                                })()}
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
                            // +34px gutter so the maximize button can sit just outside the table on the right.
                            const adaptiveWidth = Math.max(MIN_TABLE_WIDTH, Math.min(MAX_TABLE_WIDTH, totalColWidth + SCROLLBAR_WIDTH + 16)) + 34;
                            return (
                                <Box sx={{
                                    margin: '8px auto 24px auto', padding: 0,
                                    height: adaptiveHeight, width: adaptiveWidth,
                                    overflow: 'hidden', flexShrink: 0,
                                }}>
                                    <FreeDataViewFC maximizable />
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
