// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux'
import { DataFormulatorState, dfActions, dfSelectors, generateFreshChart } from '../app/dfSlice';

import embed from 'vega-embed';

import {
    Box,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    ListSubheader,
    ListItemIcon,
    ListItemText,
    IconButton,
    Tooltip,
    TextField,
    Card,
    Chip,
    Autocomplete,
    Menu,
    Divider,
    alpha,
    useTheme,
    SxProps,
    Theme,
    Slider,
    CircularProgress,
    Button,
    Collapse,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import React from 'react';
import { useDragLayer } from 'react-dnd';
import { ThinkingBufferEffect } from '../components/FunComponents';
import { Channel, Chart, FieldItem, Trigger, duplicateChart, ChartStyleVariant, computeEncodingFingerprint, isVariantStale } from "../components/ComponentType";

import _ from 'lodash';

const ConfigSlider: FC<{
    value: number;
    propDef: { label: string; min?: number; max?: number; step?: number };
    onCommit: (value: number) => void;
}> = ({ value, propDef, onCommit }) => {
    const [localValue, setLocalValue] = useState(value);
    useEffect(() => { setLocalValue(value); }, [value]);

    return (
        <>
            <Slider
                size="small"
                value={localValue}
                min={propDef.min}
                max={propDef.max}
                step={propDef.step}
                onChange={(_event, newValue) => setLocalValue(newValue as number)}
                onChangeCommitted={(_event, newValue) => onCommit(newValue as number)}
                valueLabelDisplay="auto"
                sx={{
                    flex: 1, height: 3, mx: 0.5,
                    '& .MuiSlider-thumb': { width: 10, height: 10 },
                    '& .MuiSlider-valueLabel': { fontSize: 10, padding: '2px 4px', lineHeight: 1.2 },
                }}
            />
            <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary', minWidth: '20px', textAlign: 'right' }}>
                {localValue}
            </Typography>
        </>
    );
};

import '../scss/EncodingShelf.scss';
import { DictTable } from "../components/ComponentType";

import { resolveChartFields, assembleVegaChart, resolveRecommendedChart } from '../app/utils';
import { buildSpecForRestyle, buildDataContext, callRestyleAgent, makeVariant } from '../app/restyle';
import { classifyChartIntent } from '../app/intentClassifier';
import { downscaleImageForAgent } from '../app/chartCache';
import { EncodingBox } from './EncodingBox';

import { channelGroups, CHART_TEMPLATES, getChartChannels, getChartTemplate } from '../components/ChartTemplates';
import { checkChartAvailability, getDataTable } from './ChartUtils';

const chartNameToI18nKey: Record<string, string> = {
    "Auto": "auto", "Table": "table",
    "Scatter Plot": "scatterPlot", "Regression": "regression",
    "Ranged Dot Plot": "rangedDotPlot", "Boxplot": "boxplot", "Strip Plot": "stripPlot",
    "Bar Chart": "barChart", "Grouped Bar Chart": "groupedBarChart",
    "Stacked Bar Chart": "stackedBarChart", "Histogram": "histogram",
    "Lollipop Chart": "lollipopChart", "Pyramid Chart": "pyramidChart",
    "Line Chart": "lineChart", "Dotted Line Chart": "dottedLineChart",
    "Bump Chart": "bumpChart", "Area Chart": "areaChart", "Streamgraph": "streamgraph",
    "Pie Chart": "pieChart", "Rose Chart": "roseChart",
    "Heatmap": "heatmap", "Waterfall Chart": "waterfallChart",
    "Density Plot": "densityPlot", "Radar Chart": "radarChart",
    "Candlestick Chart": "candlestickChart",
    "US Map": "usMap", "World Map": "worldMap",
    "Custom Point": "customPoint", "Custom Line": "customLine",
    "Custom Bar": "customBar", "Custom Rect": "customRect", "Custom Area": "customArea",
};

const chartCategoryToI18nKey: Record<string, string> = {
    "Scatter & Point": "scatterAndPoint", "Bar": "bar",
    "Line & Area": "lineAndArea", "Part-to-Whole": "partToWhole",
    "Statistical": "statistical", "Map": "map", "Custom": "custom",
};
import { TableIcon, AgentIcon as PrecisionManufacturing } from '../icons';
import ChangeCircleOutlinedIcon from '@mui/icons-material/ChangeCircleOutlined';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import { ThinkingBanner } from './DataThread';

import { AppDispatch } from '../app/store';
import { borderColor, radius, transition } from '../app/tokens';

import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';

import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { IdeaChip } from './ChartRecBox';
import { useFormulateData } from '../app/useFormulateData';

// Property and state of an encoding shelf
export interface EncodingShelfCardProps { 
    chartId: string;
    trigger?: Trigger;
    noBorder?: boolean;
}



// Add this utility function before the TriggerCard component
export const renderTextWithEmphasis = (text: string | any, highlightChipSx?: SxProps<Theme>) => {
    
    if (typeof text !== 'string') {
        text = text == null ? '' : String(text);
    }
    text = text.replace(/_/g, '_\u200B');
    // Split the prompt by ** patterns and create an array of text and highlighted segments
    const parts = text.split(/(\*\*.*?\*\*)/g);
    
    return parts.map((part: string, index: number) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            // This is a highlighted part - remove the ** and wrap with styled component
            const content = part.slice(2, -2).replaceAll('_', ' ');
            return (
                <Typography
                    key={index}
                    component="span"
                    sx={{
                        color: 'inherit',
                        padding: '0px 2px',
                        borderRadius: radius.sm,
                        ...highlightChipSx
                    }}
                >
                    {content}
                </Typography>
            );
        }
        return part;
    });
};

export const TriggerCard: FC<{
    className?: string, 
    trigger: Trigger, 
    hideFields?: boolean, 
    mini?: boolean,
    highlighted?: boolean,
    sx?: SxProps<Theme>}> = function ({ className, trigger, hideFields, mini = false, highlighted = false, sx }) {

    const { t } = useTranslation();
    let theme = useTheme();

    let fieldItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    let charts = useSelector((state: DataFormulatorState) => state.charts);
    let tables = useSelector((state: DataFormulatorState) => state.tables);

    const dispatch = useDispatch<AppDispatch>();

    let handleClick = () => {
        // Find the actual chart for the table that owns this trigger
        const ownerTable = tables.find(t => t.derive?.trigger === trigger);
        const realChart = ownerTable ? charts.find(c => c.tableRef === ownerTable.id && c.source === 'user') : null;
        if (realChart) {
            dispatch(dfActions.setFocused({ type: 'chart', chartId: realChart.id }));
        } else if (trigger.chart) {
            dispatch(dfActions.setFocused({ type: 'chart', chartId: trigger.chart.id }));
        }
    }

    let encodingComp : any = '';
    let encFields = [];

    if (trigger.chart) {

        let chart = trigger.chart;
        let encodingMap = chart?.encodingMap;

        encFields = Object.entries(encodingMap)
            .filter(([channel, encoding]) => {
                return encoding.fieldID != undefined;
            })
            .map(([channel, encoding], index) => {
                let field = fieldItems.find(f => f.id == encoding.fieldID) as FieldItem;
                return field.name;
            });

        encodingComp = <Typography component="span" key="enc-fields" sx={{ fontSize: 'inherit', color: 'inherit' }}>
            {Object.entries(encodingMap)
                .filter(([channel, encoding]) => encoding.fieldID != undefined)
                .map(([channel, encoding], index) => {
                    let field = fieldItems.find(f => f.id == encoding.fieldID) as FieldItem;
                    return <React.Fragment key={`trigger-${channel}-${field?.id}`}>
                        {index > 0 ? <span style={{ margin: '0 2px', opacity: 0.5 }}> × </span> : ''}
                        <span>{field?.name}</span>
                    </React.Fragment>;
                })}
        </Typography>
    }

    // Derive prompt text from interaction log — show user's own entry
    let prompt: string = '';
    const interaction = trigger.interaction;
    if (interaction && interaction.length > 0) {
        // For user-initiated (single entry: user→subagent instruction), use that entry
        // For agent sessions, this card is rendered for the user prompt entry
        const userEntry = interaction.find(e => e.from === 'user');
        prompt = userEntry?.content || '';
    }

    // Card always uses custom (orange) palette — only user entries are rendered as cards
    const triggerPalette = theme.palette.custom;

    // Process the prompt to highlight content in ** **
    const processedPrompt = renderTextWithEmphasis(prompt, {
        fontSize: mini ? 10 : 11, padding: '1px 4px',
        borderRadius: radius.sm,
        background: alpha(triggerPalette.main, 0.08), 
    });

    if (mini) {
        return <Typography component="div" sx={{
            fontSize: '10px', color: theme.palette.text.secondary,
            my: '2px', textWrap: 'balance',
            '&:hover': {
                cursor: 'pointer',
                color: theme.palette.text.primary,
            },
            '& .MuiChip-label': { px: 0.5, fontSize: "10px"},
            ...sx,
        }} onClick={handleClick}>
            {processedPrompt}{hideFields ? "" : encodingComp}
        </Typography> 
    }

    return  <Typography component="div" className={`${className}`}
        sx={{
            cursor: 'pointer', 
            fontSize: '11px',
            color: 'text.primary',
            textAlign: 'left',
            py: 0.5,
            px: 1,
            borderRadius: radius.sm,
            backgroundColor: triggerPalette.bgcolor,
            border: `1px solid ${borderColor.component}`,
            ...(highlighted ? { borderLeft: `2px solid ${triggerPalette.main}` } : {}),
            '& .MuiChip-label': { px: 0.5, fontSize: "10px"},
            ...sx,
        }} 
        onClick={handleClick}>
            {processedPrompt}{hideFields ? "" : <>{" "}{encodingComp}</>}
    </Typography>
}


export const EncodingShelfCard: FC<EncodingShelfCardProps> = function ({ chartId }) {
    const { t } = useTranslation();
    const theme = useTheme();

    const getChartNameTip = (chartName: string) => {
        const key = chartNameToI18nKey[chartName];
        return key ? t(`chart.templateNames.${key}`) : '';
    };
    const getChartCategoryTip = (category: string) => {
        const key = chartCategoryToI18nKey[category];
        return key ? t(`chart.chartCategoryTip.${key}`) : '';
    };

    // reference to states
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);

    let allCharts = useSelector(dfSelectors.getAllCharts);

    // The table the user is currently looking at (from focused state)
    const focusedTableId = (() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        if (focusedId.type === 'chart') {
            const focusedChart = allCharts.find(c => c.id === focusedId.chartId);
            return focusedChart?.tableRef;
        }
        return undefined;
    })();

    let chart = allCharts.find(c => c.id == chartId) as Chart;
    let trigger = chart.source == "trigger" ? tables.find(t => t.derive?.trigger?.chart?.id == chartId)?.derive?.trigger : undefined;

    const triggerPrompt = trigger?.interaction?.find(e => e.role === 'instruction')?.content || '';
    let [prompt, setPrompt] = useState<string>(triggerPrompt);

    // Restyle (chart style refinement agent) — see design-docs/28-chart-style-refinement-agent.md
    const [isRestyling, setIsRestyling] = useState<boolean>(false);
    // Per-variant refresh in progress (variantId being refreshed, or null).
    const [refreshingVariantId, setRefreshingVariantId] = useState<string | null>(null);
    // Intent-classifier round-trip in progress. Distinct from isRestyling so
    // the UI can show a single "thinking" state on the submit button covering
    // classify → route → execute. See submitPrompt() and the discussion in
    // chat about routing on Enter.
    const [isClassifying, setIsClassifying] = useState<boolean>(false);
    // Phase shown in the inline status banner below the prompt input. Covers
    // the whole submit pipeline so the user always knows what's happening:
    //   classifying → restyling | formulating → idle.
    // Set explicitly inside submitPrompt() and cleared by the effect below
    // that watches chartSynthesisInProgress for the data-agent path.
    const [submitPhase, setSubmitPhase] = useState<
        'idle' | 'classifying' | 'restyling' | 'formulating'
    >('idle');
    const chartSynthesisInProgress = useSelector(
        (state: DataFormulatorState) => state.chartSynthesisInProgress,
    );
    const isDataAgentRunning = chartSynthesisInProgress.includes(chartId);
    // While we're in 'formulating' phase, watch the redux flag and clear the
    // banner once the data agent finishes (success or error). The data agent
    // is fire-and-forget from this card's perspective, so we can't rely on
    // an explicit callback to mark completion.
    useEffect(() => {
        if (submitPhase === 'formulating' && !isDataAgentRunning) {
            setSubmitPhase('idle');
        }
    }, [submitPhase, isDataAgentRunning]);

    useEffect(() => {
        setPrompt(triggerPrompt);
    }, [chartId]);

    let encodingMap = chart?.encodingMap;

    const dispatch = useDispatch<AppDispatch>();
    const { streamIdeas, formulateData } = useFormulateData();

    const [chartTypeMenuOpen, setChartTypeMenuOpen] = useState<boolean>(false);
    const [encodingHovered, setEncodingHovered] = useState<boolean>(false);

    // Auto-expand encoding shelf when dragging a concept or operator card
    const { isDraggingField } = useDragLayer((monitor) => ({
        isDraggingField: monitor.isDragging() && 
            (monitor.getItemType() === 'concept-card' || monitor.getItemType() === 'operator-card'),
    }));

    const shouldExpand = encodingHovered || isDraggingField;

    // When no fields are assigned to any channel, show all channels expanded
    const hasAnyField = Object.values(encodingMap).some(enc => enc?.fieldID);
    const shouldExpandAll = !hasAnyField || shouldExpand;
    

    let handleUpdateChartType = (newChartType: string) => {
        dispatch(dfActions.updateChartType({chartId, chartType: newChartType}));
        // Close the menu after selection
        setChartTypeMenuOpen(false);
    }

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const activeModel = useSelector(dfSelectors.getActiveModel);

    let currentTable = getDataTable(chart, tables, allCharts, conceptShelfItems);

    // Check if chart is available
    let isChartAvailable = checkChartAvailability(chart, conceptShelfItems, currentTable.rows);


    // Consolidated chart state - maps chartId to its ideas, thinkingBuffer, and loading state
    const [chartState, setChartState] = useState<Record<string, {
        ideas: {text: string, goal: string, tag: string}[],
        thinkingBuffer: string,
        isLoading: boolean,
        phase: string,
    }>>({});
    const [ideaElapsed, setIdeaElapsed] = useState(0);

    // Get current chart's state
    const currentState = chartState[chartId] || { ideas: [], thinkingBuffer: "", isLoading: false, phase: "" };
    const currentChartIdeas = currentState.ideas;
    const thinkingBuffer = currentState.thinkingBuffer;
    const isLoadingIdeas = currentState.isLoading;
    const ideaPhase = currentState.phase;

    useEffect(() => {
        if (!isLoadingIdeas) { setIdeaElapsed(0); return; }
        const timer = setInterval(() => setIdeaElapsed(e => e + 1), 1000);
        return () => clearInterval(timer);
    }, [isLoadingIdeas]);
    
    const defaultChartState = { ideas: [] as any[], thinkingBuffer: "", isLoading: false, phase: "" };

    const setIdeas = (ideas: {text: string, goal: string, tag: string}[]) => {
        setChartState(prev => ({
            ...prev,
            [chartId]: { ...defaultChartState, ...prev[chartId], ideas }
        }));
    };

    const setThinkingBuffer = (thinkingBuffer: string) => {
        setChartState(prev => ({
            ...prev,
            [chartId]: { ...defaultChartState, ...prev[chartId], thinkingBuffer }
        }));
    };

    const setIsLoadingIdeas = (isLoading: boolean) => {
        setChartState(prev => ({
            ...prev,
            [chartId]: { ...defaultChartState, ...prev[chartId], isLoading }
        }));
    };

    const setIdeaPhase = (phase: string) => {
        setChartState(prev => ({
            ...prev,
            [chartId]: { ...defaultChartState, ...prev[chartId], phase }
        }));
    };
    
    let encodingBoxGroups = Object.entries(channelGroups)
        .filter(([group, channelList]) => channelList.some(ch => Object.keys(encodingMap).includes(ch)))
        .map(([group, channelList]) => {
            let channels = channelList.filter(channel => Object.keys(encodingMap).includes(channel));
            let occupiedChannels = channels.filter(ch => encodingMap[ch as Channel]?.fieldID);
            let unoccupiedChannels = channels.filter(ch => !encodingMap[ch as Channel]?.fieldID);

            let hasVisibleContent = occupiedChannels.length > 0 || shouldExpandAll;

            let component = <Box key={`encoding-group-box-${group}`} sx={{ mt: (group && shouldExpandAll) ? '6px' : 0 }}>
                {channels.map(channel => {
                    const isOccupied = encodingMap[channel as Channel]?.fieldID;
                    const box = <EncodingBox key={`shelf-${channel}`} channel={channel as Channel} chartId={chartId} tableId={currentTable.id} />;
                    return isOccupied ? box : (
                        <Collapse key={`collapse-${channel}`} in={shouldExpandAll} timeout={200}>
                            {box}
                        </Collapse>
                    );
                })}
            </Box>
            return component;
        });

    // derive active fields from encoding map so that we can keep the order of which fields will be visualized
    let activeFields = Object.values(encodingMap).map(enc => enc.fieldID).filter(fieldId => fieldId && conceptShelfItems.map(f => f.id)
                                .includes(fieldId)).map(fieldId => conceptShelfItems.find(f => f.id == fieldId) as FieldItem);
    let activeSimpleEncodings: { [key: string]: string } = {};
    for (let channel of getChartChannels(chart.chartType)) {
        if (chart.encodingMap[channel as Channel]?.fieldID) {
            activeSimpleEncodings[channel] = activeFields.find(f => f.id == chart.encodingMap[channel as Channel].fieldID)?.name as string;
        }
    }
    
    let activeCustomFields = activeFields.filter(field => field.source == "custom");

    // check if the current table contains all fields already exists a table that fullfills the user's specification
    let existsWorkingTable = activeFields.length == 0 || activeFields.every(f => currentTable.names.includes(f.name));
    
    // All root/anchored tables, with current source tables ordered first for context priority
    let rootTables = tables.filter(t => t.derive === undefined || t.anchored);
    let priorityIds = (currentTable.derive && !currentTable.anchored)
        ? currentTable.derive.source
        : [currentTable.id];
    let actionTableIds = [
        ...priorityIds.filter(id => rootTables.some(t => t.id === id)),
        ...rootTables.map(t => t.id).filter(id => !priorityIds.includes(id))
    ];

    let getIdeasForVisualization = async () => {
        if (!currentTable || isLoadingIdeas) return;

        let chartAvailable = checkChartAvailability(chart, conceptShelfItems, currentTable.rows);
        let currentChartPng = chartAvailable ? await vegaLiteSpecToPng(assembleVegaChart(
            chart.chartType, chart.encodingMap, activeFields, currentTable.rows,
            currentTable.metadata, 100, 80, false, chart.config)) : undefined;
        if (currentChartPng) {
            currentChartPng = await downscaleImageForAgent(currentChartPng);
        }

        await streamIdeas({
            actionTableIds,
            currentTable,
            onIdeas: setIdeas,
            onThinkingBuffer: setThinkingBuffer,
            onLoadingChange: setIsLoadingIdeas,
            onProgress: setIdeaPhase,
            currentChartImage: currentChartPng,
            currentDataSample: currentTable.rows.slice(0, 10),
        });
    }

    // Function to handle idea chip click
    const handleIdeaClick = (ideaText: string) => {
        setPrompt(ideaText);
        // Automatically start the data formulation process
        deriveNewData(ideaText, 'ideate');
    };


    let deriveNewData = async (
        instruction: string, 
        mode: 'formulate' | 'ideate' = 'formulate', 
        overrideTableId?: string,
    ) => {

        if (actionTableIds.length == 0) return;

        // Short-circuit: if all fields exist in source table, just reference it
        if (currentTable.derive == undefined && instruction == "" && 
                (activeFields.length > 0 && activeCustomFields.length == 0) && 
                tables.some(t => t.derive == undefined && 
                activeFields.every(f => currentTable.names.includes(f.name)))) {
            let tempTable = getDataTable(chart, tables, allCharts, conceptShelfItems, true);
            dispatch(dfActions.updateTableRef({chartId: chartId, tableRef: tempTable.id}));
            dispatch(dfActions.changeChartRunningStatus({chartId, status: true}));
            setTimeout(function(){
                dispatch(dfActions.changeChartRunningStatus({chartId, status: false}));
                dispatch(dfActions.clearUnReferencedTables());
            }, 400);
            return;
        }

        dispatch(dfActions.clearUnReferencedTables());

        let fieldNamesStr = activeFields.map(f => f.name).reduce(
            (a: string, b: string, i, array) => a + (i == 0 ? "" : (i < array.length - 1 ? ', ' : ' and ')) + b, "");

        const actionId = `deriveNewData_${String(Date.now())}`;
        const originTableId = focusedTableId || currentTable.id;
        const actionDescription = instruction || `Derive ${fieldNamesStr}`;

        // Build chart visualization context
        let chartComplete = checkChartAvailability(chart, conceptShelfItems, currentTable.rows);
        let chartSpec = (mode == 'formulate' && Object.keys(activeSimpleEncodings).length > 0) ? {
            chart_type: chart.chartType,
            encodings: activeSimpleEncodings,
            ...(chart.config ? { config: chart.config } : {})
        } : undefined;

        let currentChartImage: string | null | undefined = undefined;
        if (chartComplete && chartSpec) {
            currentChartImage = await vegaLiteSpecToPng(assembleVegaChart(
                chart.chartType, chart.encodingMap, activeFields, currentTable.rows,
                currentTable.metadata, 100, 80, false, chart.config
            ));
            if (currentChartImage) {
                currentChartImage = await downscaleImageForAgent(currentChartImage);
            }
        }

        let currentVisualization = (chartComplete && chartSpec) ? {
            chart_spec: chartSpec,
            ...(currentChartImage ? { chart_image: currentChartImage } : {})
        } : undefined;
        let expectedVisualization = (!chartComplete && chartSpec) ? { chart_spec: chartSpec } : undefined;

        let triggerChartSpec = duplicateChart(chart);
        triggerChartSpec.source = "trigger";

        formulateData({
            instruction,
            mode,
            actionTableIds,
            currentTable,
            overrideTableId,
            currentVisualization,
            expectedVisualization,
            triggerChart: triggerChartSpec,
            createChart: ({ candidateTable, refinedGoal, currentConcepts }) => {
                let needToCreateNewChart = true;
                let focusedChartId: string | undefined;
                
                if (mode != "ideate" && chart.chartType != "Auto" && overrideTableId != undefined && 
                    allCharts.filter(c => c.source == "user").find(c => c.tableRef == overrideTableId)) {
                    let chartsFromOverrideTable = allCharts.filter(c => c.source == "user" && c.tableRef == overrideTableId);
                    let chartsWithSameEncoding = chartsFromOverrideTable.filter(c => {
                        let getSimpliedChartEnc = (ch: Chart) => {
                            return ch.chartType + ":" + Object.entries(ch.encodingMap)
                                .filter(([channel, enc]) => enc.fieldID != undefined)
                                .map(([channel, enc]) => `${channel}:${enc.fieldID}:${enc.aggregate}:${enc.sortOrder}:${enc.sortBy}:${enc.scheme}`)
                                .join(";");
                        }
                        return getSimpliedChartEnc(c) == getSimpliedChartEnc(triggerChartSpec);
                    });
                    if (chartsWithSameEncoding.length > 0) {
                        focusedChartId = chartsWithSameEncoding[0].id;
                        dispatch(dfActions.setFocused({ type: 'chart', chartId: focusedChartId }));
                        needToCreateNewChart = false;
                    }
                }
                
                if (needToCreateNewChart) {
                    let newChart: Chart;
                    if (mode == "ideate" || chart.chartType == "Auto") {
                        newChart = resolveRecommendedChart(refinedGoal, currentConcepts, candidateTable);
                    } else if (chart.chartType == "Table") {
                        newChart = generateFreshChart(candidateTable.id, 'Table');
                    } else {
                        newChart = structuredClone(chart) as Chart;
                        newChart.source = "user";
                        newChart.id = `chart-${Date.now() - Math.floor(Math.random() * 10000)}`;
                        newChart.saved = false;
                        newChart.tableRef = candidateTable.id;
                        // Style variants belong to the chart they were authored
                        // against — don't carry them over to a follow-up chart.
                        // (See design-docs/28-chart-style-refinement-agent.md.)
                        newChart.styleVariants = undefined;
                        newChart.activeVariantId = undefined;
                        let chartEncodings = refinedGoal['chart']?.['encodings'] || refinedGoal['chart_encodings'] || {};
                        newChart = resolveChartFields(newChart, currentConcepts, chartEncodings, candidateTable);
                    }
                    focusedChartId = newChart.id;
                    dispatch(dfActions.addAndFocusChart(newChart));
                }
                return focusedChartId;
            },
            onStarted: () => {
                dispatch(dfActions.changeChartRunningStatus({chartId, status: true}));
            },
            onSuccess: ({ displayInstruction, candidateTable, focusedChartId }) => {
                if (chart.chartType == "Table" || chart.chartType == "Auto" || (existsWorkingTable == false)) {
                    dispatch(dfActions.deleteChartById(chartId));
                }
                dispatch(dfActions.clearUnReferencedTables());
                dispatch(dfActions.clearUnReferencedCustomConcepts());
                dispatch(dfActions.setFocused({ type: 'chart', chartId: focusedChartId as string }));
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "success",
                    "value": t('encoding.formulationSucceeded', { fields: fieldNamesStr })
                }));
            },
            onError: () => {
            },
            onFinally: () => {
                dispatch(dfActions.changeChartRunningStatus({chartId, status: false}));
            },
        });
    }

    // --- Style variants (see design-docs/28-chart-style-refinement-agent.md) ---
    // Chip strip for navigating user-authored "skins" of the current chart's
    // Vega-Lite spec. The active variant is rendered both in the focused
    // canvas (VisualizationView) and in the data-thread thumbnail
    // (ChartRenderService) so the preview matches what the user is editing.
    // This UI is the only surface that manages variants for now.
    const variants: ChartStyleVariant[] = chart.styleVariants ?? [];
    const activeVariantId = chart.activeVariantId;

    /**
     * Build the spec to send to the restyle agent.
     *
     * If a style variant is currently active, we use ITS stored vlSpec as the
     * starting point — that's the "stacking edits" path (e.g. `v2 = v1 + new
     * tweak`). Otherwise we assemble the default spec from the chart's
     * encodingMap. In both cases we strip the data block before sending; the
     * agent never sees row content (we re-attach live data on render).
     */

    /**
     * Choose a chip label for a new variant.
     *
     * The agent is asked to return a concise two-word label (e.g. "dark
     * theme", "rotated labels"). We prefer that, falling back to a sequential
     * `v1`, `v2`, ... if the agent didn't supply one. If the suggested label
     * collides with an existing variant on the same chart, append a small
     * suffix to keep chips unique.
     */
    const pickVariantLabel = (
        suggested: string | undefined,
        existing: ChartStyleVariant[],
    ): string => {
        const taken = new Set(existing.map(v => (v.label || v.id).toLowerCase()));
        const cleaned = (suggested || '').trim().replace(/^["']+|["']+$/g, '').slice(0, 24);
        const base = cleaned || `v${existing.length + 1}`;
        if (!taken.has(base.toLowerCase())) return base;
        for (let i = 2; i < 100; i++) {
            const candidate = `${base} ${i}`;
            if (!taken.has(candidate.toLowerCase())) return candidate;
        }
        return base;
    };

    /**
     * Send the prompt to the chart restyle agent.
     *
     * Returns:
     *   - 'success'      → variant added & activated
     *   - 'out_of_scope' → restyle agent refused (data change in disguise);
     *                      caller may chain to deriveNewData()
     *   - 'error'        → infra failure (model not configured, transport, etc.)
     *
     * Either way the appropriate user-facing message is dispatched here, so
     * the caller usually doesn't need to add its own. Exception: callers
     * doing automatic style→data fallback typically want to *suppress* the
     * out_of_scope toast since the system is already escalating.
     */
    const handleRestyleSubmit = async (
        opts: { suppressOutOfScopeMessage?: boolean } = {},
    ): Promise<'success' | 'out_of_scope' | 'error'> => {
        const text = prompt.trim();
        if (!text || isRestyling) return 'error';
        if (!activeModel) {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'chart restyle',
                type: 'error',
                value: 'No model is configured. Please select a model before restyling.',
            }));
            return 'error';
        }
        const activeVariant = activeVariantId
            ? variants.find(v => v.id === activeVariantId)
            : undefined;
        const prepared = buildSpecForRestyle(chart, currentTable, conceptShelfItems, activeVariant);
        if (!prepared) {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'chart restyle',
                type: 'error',
                value: 'Cannot restyle this chart yet — make sure all required fields are encoded first.',
            }));
            return 'error';
        }

        const { dataSample, columnDtypes } = buildDataContext(currentTable);

        setIsRestyling(true);
        // Standard "chart agent working" signal — the visualization panel
        // overlays a progress bar, the data thread shows a running indicator,
        // and any duplicate triggers are blocked.
        dispatch(dfActions.changeChartRunningStatus({ chartId, status: true }));
        try {
            const result = await callRestyleAgent({
                instruction: text,
                vlSpec: prepared.spec,
                chartType: chart.chartType,
                dataSample,
                columnDtypes,
                model: activeModel,
            });

            if (result.kind === 'out_of_scope') {
                if (!opts.suppressOutOfScopeMessage) {
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(),
                        component: 'chart restyle',
                        type: 'info',
                        value: result.rationale
                            ? `Style agent: "${result.rationale}" — try the formulate button instead for data changes.`
                            : 'This looks like a data change. Use the formulate button instead.',
                    }));
                }
                return 'out_of_scope';
            }

            const variant = makeVariant({
                chart,
                prompt: text,
                vlSpec: result.vlSpec,
                rationale: result.rationale,
                // Prefer the agent-suggested two-word label; fall back to a
                // sequential vN if the agent didn't supply one or it's empty.
                // Disambiguate against existing labels so chips never collide.
                label: pickVariantLabel(result.label, variants),
                basedOnVariantId: prepared.basedOnVariantId,
            });
            dispatch(dfActions.addStyleVariant({ chartId, variant, activate: true }));
            setPrompt('');
            return 'success';
        } catch (err: any) {
            console.warn('[chart-restyle] failed', err);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'chart restyle',
                type: 'error',
                value: `Restyle failed: ${err?.message || String(err)}`,
            }));
            return 'error';
        } finally {
            setIsRestyling(false);
            dispatch(dfActions.changeChartRunningStatus({ chartId, status: false }));
        }
    };

    /**
     * Single entry point for the input bubble's primary submit (Enter or the
     * primary button). Routes the prompt to either the chart restyle agent
     * (visual changes) or the data agent (data shape / chart-type changes)
     * via a tiny LLM intent classifier.
     *
     * Style → data fallback: if the restyle agent comes back with
     * out_of_scope (i.e. it decided this was actually a data change), we
     * automatically retry with the data agent so the user doesn't have to
     * re-press anything. The original out_of_scope toast is suppressed in
     * that case to avoid the misleading "click formulate instead" hint.
     *
     * Heuristics-free: see src/app/intentClassifier.ts for the rationale
     * behind a tiny LLM call vs. a keyword list (multilingual support).
     */
    const submitPrompt = async () => {
        const text = prompt.trim();
        if (!text) return;
        if (isRestyling || isClassifying) return;
        if (!activeModel) {
            // Both agents need a model; the data agent path will surface its
            // own error too, but failing fast here saves a classifier call.
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'chart builder',
                type: 'error',
                value: 'No model is configured. Please select a model before submitting.',
            }));
            return;
        }

        // If the chart isn't rendered yet there's nothing for the style
        // agent to refine; just go straight to the data agent.
        if (!isChartAvailable) {
            setSubmitPhase('formulating');
            deriveNewData(text, 'formulate');
            return;
        }

        setIsClassifying(true);
        setSubmitPhase('classifying');
        let intent: 'style' | 'data' = 'data';
        try {
            intent = await classifyChartIntent(text, activeModel);
        } finally {
            setIsClassifying(false);
        }

        if (intent === 'data') {
            setSubmitPhase('formulating');
            deriveNewData(text, 'formulate');
            return;
        }

        // intent === 'style' — try restyle first, fall back to data on out_of_scope
        setSubmitPhase('restyling');
        const result = await handleRestyleSubmit({ suppressOutOfScopeMessage: true });
        if (result === 'out_of_scope') {
            // The restyle agent decided this was actually a data change.
            // Hand off to the data agent. The banner switches from
            // "restyling…" to "formulating data…" so the user sees the route
            // change without an extra click.
            setSubmitPhase('formulating');
            deriveNewData(text, 'formulate');
            // submitPhase will flip to 'idle' once the data agent finishes
            // (see the chartSynthesisInProgress effect above).
        } else {
            // success or error — restyle path is fully done, clear banner.
            setSubmitPhase('idle');
        }
    };

    /**
     * Refresh a stale variant: re-run its stored prompt against the
     * freshly-assembled current default spec, then replace the variant in
    /**
     * Refresh a stale variant: re-run its stored prompt against the
     * freshly-assembled current default spec, then replace the variant in
     * place (same id, new vlSpec, fresh fingerprint). The OLD variant spec
     * is sent as a `styleReferenceSpec` so the agent preserves the visual
     * choices the user originally made — refresh should feel like
     * "re-apply this style with the new encoding", not "re-roll from
     * scratch".
     *
     * Triggered automatically by clicking a stale chip.
     */
    const handleRefreshVariant = async (variant: ChartStyleVariant) => {
        if (refreshingVariantId) return;
        if (!activeModel) {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'chart restyle',
                type: 'error',
                value: 'No model is configured. Please select a model before refreshing.',
            }));
            return;
        }
        // Refresh always starts from the current default spec (NOT the stale
        // variant's spec) so we don't compound staleness. We re-run the
        // variant's original prompt against the freshly-assembled spec, with
        // the previous variant spec as a STYLE REFERENCE so visual choices
        // carry forward.
        const prepared = buildSpecForRestyle(chart, currentTable, conceptShelfItems);
        if (!prepared) {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'chart restyle',
                type: 'error',
                value: 'Cannot refresh — chart is not currently renderable.',
            }));
            return;
        }
        const { dataSample, columnDtypes } = buildDataContext(currentTable);

        setRefreshingVariantId(variant.id);
        // Surface the standard "chart agent working" signal in the canvas
        // (LinearProgress overlay) while the refresh request is in flight.
        dispatch(dfActions.changeChartRunningStatus({ chartId, status: true }));
        try {
            const result = await callRestyleAgent({
                instruction: variant.prompt,
                vlSpec: prepared.spec,
                chartType: chart.chartType,
                dataSample,
                columnDtypes,
                model: activeModel,
                styleReferenceSpec: variant.vlSpec,
            });
            if (result.kind === 'out_of_scope') {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    component: 'chart restyle',
                    type: 'info',
                    value: result.rationale
                        ? `Style agent: "${result.rationale}"`
                        : 'Could not refresh this variant against the current encoding.',
                }));
                return;
            }
            dispatch(dfActions.updateStyleVariant({
                chartId,
                variantId: variant.id,
                vlSpec: result.vlSpec,
                rationale: result.rationale,
                encodingFingerprint: computeEncodingFingerprint(chart),
            }));
        } catch (err: any) {
            console.warn('[chart-restyle] refresh failed', err);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'chart restyle',
                type: 'error',
                value: `Refresh failed: ${err?.message || String(err)}`,
            }));
        } finally {
            setRefreshingVariantId(null);
            dispatch(dfActions.changeChartRunningStatus({ chartId, status: false }));
        }
    };

    const renderVariantChip = (label: string, opts: {
        active: boolean,
        stale?: boolean,
        refreshing?: boolean,
        tooltip?: string,
        onClick: () => void,
        onDelete?: () => void,
    }) => {
        // Match the project's quiet-pill idiom (see IdeaChip in ChartRecBox.tsx):
        // outlined, low-alpha border, neutral text color, very subtle hover.
        // Active state is conveyed by a slightly stronger border + bg, not a
        // saturated primary fill.
        const accent = theme.palette.text.primary;
        return (
            <Box
                key={label}
                component="span"
                onClick={opts.onClick}
                title={opts.tooltip}
                sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    height: 20,
                    px: '6px',
                    fontSize: 11,
                    fontWeight: 400,
                    lineHeight: 1.4,
                    color: accent,
                    fontFamily: theme.typography.fontFamily,
                    borderRadius: '6px',
                    border: `1px solid ${alpha(accent, opts.active ? 0.45 : 0.12)}`,
                    borderStyle: opts.stale ? 'dashed' : 'solid',
                    backgroundColor: opts.active ? alpha(accent, 0.1) : theme.palette.background.paper,
                    cursor: 'pointer',
                    opacity: opts.stale ? 0.65 : 1,
                    transition: transition.fast,
                    '&:hover': {
                        backgroundColor: alpha(accent, opts.active ? 0.13 : 0.04),
                    },
                }}
            >
                {opts.refreshing && (
                    <CircularProgress size={10} sx={{ color: alpha(accent, 0.5), mr: '-1px' }} />
                )}
                <span>{label}</span>
                {opts.onDelete && (
                    <Box
                        component="span"
                        role="button"
                        aria-label="delete variant"
                        onClick={(e) => { e.stopPropagation(); opts.onDelete?.(); }}
                        sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            color: alpha(accent, 0.4),
                            cursor: 'pointer',
                            '&:hover': {
                                color: accent,
                                backgroundColor: alpha(accent, 0.08),
                            },
                        }}
                    >
                        <CloseIcon sx={{ fontSize: 11 }} />
                    </Box>
                )}
            </Box>
        );
    };

    let variantChipStrip = (variants.length > 0) ? (
        <Box key='variant-chip-strip' sx={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5,
            px: 0.5, mb: 0.5,
        }}>
            <Typography sx={{ fontSize: 10, color: 'text.secondary', mr: 0.25 }}>
                style:
            </Typography>
            {renderVariantChip('default', {
                active: !activeVariantId,
                tooltip: 'Render the chart from its current encoding (no style refinement applied).',
                onClick: () => dispatch(dfActions.setActiveVariant({ chartId, variantId: undefined })),
            })}
            {variants.map(v => {
                const stale = isVariantStale(chart, v);
                const refreshing = refreshingVariantId === v.id;
                return renderVariantChip(v.label || v.id, {
                    active: v.id === activeVariantId,
                    stale,
                    refreshing,
                    tooltip: stale
                        ? `Encoding has changed since this variant was created. Clicking will re-run the style agent against the current encoding.\n\nPrompt: ${v.prompt}`
                        : (v.rationale ? `${v.rationale}\n\nPrompt: ${v.prompt}` : `Prompt: ${v.prompt}`),
                    onClick: () => {
                        // Activate immediately so the canvas shows what's
                        // being refreshed; the spinner on the chip indicates
                        // the agent call is in flight. On success the variant
                        // is replaced in place and re-renders fresh.
                        if (v.id !== activeVariantId) {
                            dispatch(dfActions.setActiveVariant({ chartId, variantId: v.id }));
                        }
                        if (stale && !refreshing) {
                            handleRefreshVariant(v);
                        }
                    },
                    onDelete: () => dispatch(dfActions.deleteStyleVariant({ chartId, variantId: v.id })),
                });
            })}
        </Box>
    ) : null;


    // zip multiple components together
    const w: any = (a: any[], b: any[]) => a.length ? [a[0], ...w(b, a.slice(1))] : b;

    let formulateInputBox = <Card key='text-input-boxes' variant='outlined' sx={{
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        px: 1, pt: 0.5, pb: 0.25,
        ml: '8px', // leave room for the speech-bubble tail on the left
        borderWidth: 1,
        borderColor: alpha(theme.palette.text.primary, 0.2),
        borderRadius: '8px',
        overflow: 'visible',
        flexShrink: 0,
        transition: transition.fast,
        // Speech-bubble tail: outer triangle (border)
        '&::before': {
            content: '""',
            position: 'absolute',
            top: 12,
            left: -8,
            width: 0,
            height: 0,
            borderTop: '7px solid transparent',
            borderBottom: '7px solid transparent',
            borderRight: `8px solid ${alpha(theme.palette.text.primary, 0.2)}`,
            transition: transition.fast,
            pointerEvents: 'none',
        },
        // Speech-bubble tail: inner triangle (fill, masks the border edge)
        '&::after': {
            content: '""',
            position: 'absolute',
            top: 13,
            left: -6,
            width: 0,
            height: 0,
            borderTop: '6px solid transparent',
            borderBottom: '6px solid transparent',
            borderRight: `7px solid ${theme.palette.background.paper}`,
            transition: transition.fast,
            pointerEvents: 'none',
        },
        '&:hover': {
            borderWidth: 1,
            borderColor: alpha(theme.palette.primary.main, 0.6),
        },
        '&:hover::before': {
            borderRightColor: alpha(theme.palette.primary.main, 0.6),
        },
        '&:focus-within': {
            borderWidth: 1,
            borderColor: alpha(theme.palette.primary.main, 0.8),
        },
        '&:focus-within::before': {
            borderRightColor: alpha(theme.palette.primary.main, 0.8),
        },
    }}>
        <TextField
            variant="standard"
            sx={{
                flex: 1,
                "& .MuiInput-input": { fontSize: '12px', lineHeight: 1.5 },
                "& .MuiInput-underline:before": { borderBottom: 'none' },
                "& .MuiInput-underline:hover:not(.Mui-disabled):before": { borderBottom: 'none' },
                "& .MuiInput-underline:after": { borderBottom: 'none' },
            }}
            onChange={(event: any) => {
                setPrompt(event.target.value);
            }}
            onKeyDown={(event: any) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (prompt.trim().length > 0) {
                        // submitPrompt routes via the intent classifier:
                        // style requests go to the restyle agent; data /
                        // chart-type requests go to deriveNewData.
                        submitPrompt();
                    }
                }
            }}
            slotProps={{
                inputLabel: { shrink: true },
            }}
            value={prompt}
            placeholder={t('encoding.followUpChartPlaceholder')}
            fullWidth
            multiline
            minRows={2}
            maxRows={5}
        />
        <Box sx={{
            display: 'flex', flexDirection: 'row', alignItems: 'center',
            justifyContent: 'flex-end',
        }}>
            <Tooltip title={currentChartIdeas.length > 0 ? t('encoding.refreshIdeas') : t('encoding.getIdeas')}>
                <span>
                    <IconButton size="small"
                        disabled={isLoadingIdeas}
                        sx={{ p: 0.5, color: theme.palette.custom.textColor || theme.palette.custom.main,
                            '&:hover': { backgroundColor: alpha(theme.palette.custom.main, 0.08) } }}
                        onClick={() => getIdeasForVisualization()}>
                        {isLoadingIdeas 
                            ? <CircularProgress size={20} sx={{ color: theme.palette.custom.main }} />
                            : <TipsAndUpdatesIcon sx={{ fontSize: 20 }} />}
                    </IconButton>
                </span>
            </Tooltip>
            {/* Primary submit. The Enter key and this button both go through
                submitPrompt(), which uses an LLM intent classifier to route
                between the restyle agent and the data agent. The brush /
                style-only button was removed in favor of this unified entry
                point — if the classifier (or the user) is wrong, the restyle
                agent's out_of_scope signal triggers an automatic data-agent
                fallback. The trigger-override button below is kept because
                it does something neither path does (re-derive into the same
                table). See src/app/intentClassifier.ts. */}
            {trigger ? (() => {
                const overrideTableId = tables.find(t => t.derive?.trigger === trigger)?.id;
                return overrideTableId ? (
                <Tooltip title={<Typography sx={{fontSize: 11}}>{t('encoding.formulateAndOverride')} <TableIcon sx={{width: 10, height: 10, marginBottom: '-1px'}}/>{overrideTableId}</Typography>}>
                    <span>
                        <IconButton size="small" color={"warning"} sx={{ p: 0.5 }} onClick={() => { 
                            deriveNewData(trigger!.interaction?.find(e => e.role === 'instruction')?.content || '', 'formulate', overrideTableId); 
                        }}>
                            <ChangeCircleOutlinedIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                    </span>
                </Tooltip>) : null;
            })()
                : 
                <Tooltip title={t('encoding.formulate')}>
                    <span>
                        <IconButton size="small" color={"primary"} sx={{ p: 0.5 }}
                            disabled={(!prompt.trim() && activeCustomFields.length === 0) || isClassifying || isRestyling}
                            onClick={() => {
                                if (prompt.trim()) {
                                    submitPrompt();
                                } else {
                                    // No text — only the field shelf has
                                    // changes. Skip the classifier and run
                                    // the data agent directly.
                                    deriveNewData(prompt, 'formulate');
                                }
                            }}>
                            {(isClassifying || isRestyling)
                                ? <CircularProgress size={18} sx={{ color: theme.palette.primary.main }} />
                                : <PrecisionManufacturing sx={{
                                    fontSize: 20,
                                    ...(isChartAvailable ? {} : {
                                        animation: 'pulseAttention 3s ease-in-out infinite',
                                        '@keyframes pulseAttention': {
                                            '0%, 90%': { scale: 1 },
                                            '95%': { scale: 1.2 },
                                            '100%': { scale: 1 },
                                        },
                                    }),
                                }} />}
                        </IconButton>
                    </span>
                </Tooltip>
            }           
        </Box>
    </Card>



    let channelComponent = (
        <Box sx={{ width: "100%", minWidth: "256px", height: '100%', display: "flex", flexDirection: "column", gap: '4px' }}>
            <Box key='mark-selector-box' sx={{ ml: 1, flex: '0 0 auto', display: 'flex', alignItems: 'center' }}>
                <FormControl sx={{ m: 1, minWidth: 120, flex: 1, margin: "0px 0"}} size="small">
                    <Select
                        variant="standard"
                        labelId="chart-mark-select-label"
                        id="chart-mark-select"
                        value={chart.chartType}
                        // Add these props to control the open state
                        open={chartTypeMenuOpen}
                        onOpen={() => setChartTypeMenuOpen(true)}
                        onClose={() => setChartTypeMenuOpen(false)}
                        MenuProps={{
                            anchorOrigin: {
                                vertical: 'bottom',
                                horizontal: 'left',
                            },
                            transformOrigin: {
                                vertical: 'top',
                                horizontal: 'left',
                            },
                            PaperProps: {
                                sx: {
                                    '& .MuiList-root': {
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr',
                                        gap: 0,
                                        padding: '8px'
                                    }
                                }
                            }
                        }}
                        renderValue={(value: string) => {
                            const tmpl = getChartTemplate(value);
                            return (
                                <Tooltip title={getChartNameTip(value)} placement="left" arrow>
                                <div style={{display: 'flex', padding: "0px 0px 0px 4px"}}>
                                    <ListItemIcon sx={{minWidth: "24px"}}>
                                        {typeof tmpl?.icon == 'string' ? <img height="24px" width="24px" src={tmpl?.icon} alt="" role="presentation" /> : 
                                         <Box sx={{width: "24px", height: "24px"}}>{tmpl?.icon}</Box>}
                                        </ListItemIcon>
                                    <ListItemText sx={{marginLeft: "2px", whiteSpace: "initial"}} slotProps={{primary: {fontSize: 12}}}>{tmpl?.chart}</ListItemText>
                                </div>
                                </Tooltip>
                            )
                        }}
                        onChange={(event) => { }}>
                        {Object.entries(CHART_TEMPLATES).map(([group, templates]) => {
                            return [
                                <ListSubheader sx={{ 
                                    color: "text.secondary", 
                                    lineHeight: 2, 
                                    fontSize: 12,
                                    gridColumn: '1 / -1'
                                }} key={group}>
                                    <Tooltip title={getChartCategoryTip(group)} placement="left" arrow>
                                        <span>{group}</span>
                                    </Tooltip>
                                </ListSubheader>,
                                ...templates.map((t, i) => (
                                    <MenuItem 
                                        sx={{ 
                                            fontSize: 12, 
                                            paddingLeft: 2, 
                                            paddingRight: 2,
                                            minHeight: '32px',
                                            margin: '1px 0'
                                        }} 
                                        value={t.chart} 
                                        key={`${group}-${i}`}
                                        onClick={(e) => {
                                            console.log('MenuItem clicked:', t.chart);
                                            handleUpdateChartType(t.chart);
                                        }}
                                    >
                                        <Tooltip title={getChartNameTip(t.chart)} placement="left" arrow>
                                        <Box sx={{display: 'flex', width: '100%'}}>
                                            <ListItemIcon sx={{minWidth: "20px"}}>
                                                {typeof t?.icon == 'string' ? 
                                                    <img height="20px" width="20px" src={t?.icon} alt="" role="presentation" /> : 
                                                    <Box sx={{width: "20px", height: "20px"}}>{t?.icon}</Box>
                                                }
                                            </ListItemIcon>
                                            <ListItemText 
                                                slotProps={{primary: {fontSize: 11}}} 
                                                sx={{ margin: 0 }}
                                            >
                                                {t.chart}
                                            </ListItemText>
                                        </Box>
                                        </Tooltip>
                                    </MenuItem>
                                ))
                            ]
                        })}
                    </Select>
                </FormControl>
            </Box>
            {/* Template-driven config property selectors */}
            <Box key='encoding-and-config' sx={{
                    ml: 1,
                    flex: '1 1 auto',
                }} style={{ height: "calc(100% - 100px)" }} className="encoding-list"
                onMouseEnter={() => setEncodingHovered(true)}
                onMouseLeave={() => setEncodingHovered(false)}>
            {(() => {
                    const template = getChartTemplate(chart.chartType);
                    const configProps = template?.properties;
                    if (!configProps || configProps.length === 0) return null;
                    return (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1px', mb: '6px' }}>
                            {configProps.map((propDef) => {
                                // App-level visibility: hide properties whose visibleWhen channels aren't assigned
                                if (propDef.visibleWhen?.channels) {
                                    const hasAny = propDef.visibleWhen.channels.some(
                                        ch => chart.encodingMap[ch as Channel]?.fieldID != null
                                    );
                                    if (!hasAny) return null;
                                }
                                if (propDef.type === 'continuous') {
                                    const currentValue = chart.config?.[propDef.key] ?? propDef.defaultValue ?? propDef.min ?? 0;
                                    return (
                                        <Box key={`config-${propDef.key}`} sx={{
                                            display: 'flex', alignItems: 'center', 
                                            borderRadius: '12px',
                                            minHeight: '18px',
                                            overflow: 'hidden', padding: '0px 10px 0px 0px',
                                        }}>
                                            <Typography variant="caption" sx={{
                                                padding: '0px 6px', color: 'text.secondary', fontSize: 10,
                                                whiteSpace: 'nowrap', fontWeight: 500, minWidth: '40px', userSelect: 'none',
                                            }}>
                                                {propDef.label}
                                            </Typography>
                                            <ConfigSlider
                                                value={currentValue}
                                                propDef={propDef}
                                                onCommit={(newValue) => dispatch(dfActions.updateChartConfig({chartId, key: propDef.key, value: newValue}))}
                                            />
                                        </Box>
                                    );
                                }
                                if (propDef.type === 'binary') {
                                    const currentValue = chart.config?.[propDef.key] ?? propDef.defaultValue ?? false;
                                    return (
                                        <Box key={`config-${propDef.key}`} sx={{
                                            display: 'flex', alignItems: 'center',
                                            borderRadius: '12px',
                                            minHeight: '18px',
                                            overflow: 'hidden', padding: '0px 8px',
                                            cursor: 'pointer',
                                            '&:hover': { backgroundColor: 'rgba(0,0,0,0.04)' },
                                        }}
                                        onClick={() => {
                                            dispatch(dfActions.updateChartConfig({chartId, key: propDef.key, value: !currentValue}));
                                        }}>
                                            <Typography variant="caption" sx={{
                                                flex: 1, color: 'text.secondary', fontSize: 10,
                                                whiteSpace: 'nowrap', fontWeight: 500, userSelect: 'none',
                                            }}>
                                                {propDef.label}
                                            </Typography>
                                            <Box sx={{
                                                width: 28, height: 14, borderRadius: '7px',
                                                backgroundColor: currentValue ? theme.palette.primary.main : 'rgba(0,0,0,0.2)',
                                                position: 'relative', transition: 'background-color 0.2s',
                                                flexShrink: 0,
                                            }}>
                                                <Box sx={{
                                                    width: 10, height: 10, borderRadius: '50%',
                                                    backgroundColor: 'white',
                                                    position: 'absolute', top: 2,
                                                    left: currentValue ? 16 : 2,
                                                    transition: 'left 0.2s',
                                                }} />
                                            </Box>
                                        </Box>
                                    );
                                }
                                if (propDef.type !== 'discrete' || !propDef.options) return null;
                                const currentValue = chart.config?.[propDef.key] ?? propDef.defaultValue;
                                const options = propDef.options;
                                // Find the index of the current value in options (deep compare via JSON)
                                const currentSerialized = JSON.stringify(currentValue);
                                let selectedIndex = options.findIndex(o => JSON.stringify(o.value) === currentSerialized);
                                if (selectedIndex < 0) selectedIndex = 0;
                                return (
                                    <Box key={`config-${propDef.key}`} sx={{
                                        display: 'flex', alignItems: 'center', 
                                        borderRadius: '12px',
                                        minHeight: '22px',
                                        overflow: 'hidden',
                                    }}>
                                        <Typography variant="caption" sx={{
                                            padding: '0px 8px', color: 'text.secondary', fontSize: 10,
                                            whiteSpace: 'nowrap', fontWeight: 500, userSelect: 'none',
                                        }}>
                                            {propDef.label}
                                        </Typography>
                                        <Select
                                            variant="standard"
                                            id={`config-${propDef.key}-select`}
                                            value={selectedIndex}
                                            onChange={(event) => {
                                                const idx = event.target.value as number;
                                                dispatch(dfActions.updateChartConfig({chartId, key: propDef.key, value: options[idx].value}));
                                            }}
                                            disableUnderline
                                            sx={{
                                                flex: 1, fontSize: 11, height: '22px',
                                                backgroundColor: 'rgba(0,0,0,0.04)',
                                                borderRadius: '6px',
                                                '&:hover': { backgroundColor: 'rgba(0,0,0,0.07)' },
                                                '& .MuiSelect-select': { padding: '1px 20px 1px 6px !important', fontSize: 11 },
                                                '& .MuiSvgIcon-root': { fontSize: 14, right: 2 },
                                            }}
                                            renderValue={(idx: number) => {
                                                return <span style={{fontSize: 11}}>{options[idx]?.label || "Default"}</span>;
                                            }}
                                        >
                                            {options.map((opt, i) => (
                                                <MenuItem value={i} key={`config-${propDef.key}-${i}`} sx={{ fontSize: 11, minHeight: '28px' }}>
                                                    {opt.label}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </Box>
                                );
                            })}
                        </Box>
                    );
                })()}
                {encodingBoxGroups}
            </Box>
            {variantChipStrip}
            {formulateInputBox}
            {/* Inline status banner — shown right under the input bubble so
                the user always knows what stage the agent is in. Covers the
                three submit phases (classify → restyle/formulate). The data
                agent has its own progress indicators elsewhere (running spinner
                on the chart, status messages in the data thread); we keep this
                line short and focused on telling the user *which* path was
                chosen so the routing decision feels visible. */}
            {submitPhase !== 'idle' && (
                <Box sx={{ px: 1, py: 0.25, ml: '8px' }}>
                    {ThinkingBanner(
                        submitPhase === 'classifying' ? 'thinking…'
                          : submitPhase === 'restyling' ? 'updating the chart…'
                          : 'preparing data for the chart…'
                    )}
                </Box>
            )}
        </Box>);

    const encodingShelfCard = (
        <Box sx={{ 
            padding: '4px 6px', 
            maxWidth: "400px", 
            display: 'flex', 
            flexDirection: 'column', 
        }}>
            <Box sx={{ padding: '4px 0px' }}>
                {channelComponent}
            </Box>
            {/* Ideas chips shown inline below the formulate box */}
            {(currentChartIdeas.length > 0 || (isLoadingIdeas && thinkingBuffer)) && (
                <Box sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.5,
                    pt: 0.5,
                }}>
                    {currentChartIdeas.length > 0 && (
                        <Typography sx={{
                            fontSize: 11,
                            color: 'text.secondary',
                        }}>
                            {t('encoding.ideasHeading')}
                        </Typography>
                    )}
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {currentChartIdeas.map((idea, index) => (
                            <IdeaChip
                                mini={true}
                                key={index}
                                idea={idea}
                                theme={theme}
                                onClick={() => handleIdeaClick(idea.text)}
                            />
                        ))}
                        {isLoadingIdeas && thinkingBuffer && <ThinkingBufferEffect text={thinkingBuffer.slice(-40)} sx={{ width: '100%' }} />}
                    </Box>
                </Box>
            )}
            {isLoadingIdeas && !thinkingBuffer && (
                <Box sx={{ padding: '2px 0' }}>
                    {ThinkingBanner(
                        (ideaPhase === 'building_context' ? t('chartRec.progressBuildingContext')
                           : ideaPhase === 'generating' ? t('chartRec.progressGenerating')
                           : t('encoding.ideating'))
                        + (ideaElapsed > 0 ? ` (${ideaElapsed}s)` : '')
                    )}
                </Box>
            )}
        </Box>
    );

    return encodingShelfCard;
}

// Function to convert Vega-Lite spec to PNG data URL with improved resolution
const vegaLiteSpecToPng = async (spec: any, scale: number = 2.0, quality: number = 1.0): Promise<string | null> => {
    try {
        // Create a temporary container
        const tempId = `temp-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const tempContainer = document.createElement('div');
        tempContainer.id = tempId;
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '-9999px';
        document.body.appendChild(tempContainer);

        // Embed the chart with higher resolution settings
        const result = await embed('#' + tempId, spec, { 
            actions: false, 
            renderer: "canvas",
            scaleFactor: scale // Apply scale factor for higher resolution
        });

        // Get the canvas and apply high-resolution rendering
        const canvas = await result.view.toCanvas(scale); // Pass scale to toCanvas
        const pngDataUrl = canvas.toDataURL('image/png', quality);

        // Clean up
        document.body.removeChild(tempContainer);

        return pngDataUrl;
    } catch (error) {
        console.error('Error converting Vega-Lite spec to PNG:', error);
        return null;
    }
};

// Alternative method using toImageURL for even better quality
const vegaLiteSpecToPngWithImageURL = async (spec: any, scale: number = 2.0): Promise<string | null> => {
    try {
        // Create a temporary container
        const tempId = `temp-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const tempContainer = document.createElement('div');
        tempContainer.id = tempId;
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '-9999px';
        document.body.appendChild(tempContainer);

        // Embed the chart
        const result = await embed('#' + tempId, spec, { 
            actions: false, 
            renderer: "canvas",
            scaleFactor: scale
        });

        // Use toImageURL for better quality
        const pngDataUrl = await result.view.toImageURL('png', scale);

        // Clean up
        document.body.removeChild(tempContainer);

        return pngDataUrl;
    } catch (error) {
        console.error('Error converting Vega-Lite spec to PNG:', error);
        return null;
    }
};
