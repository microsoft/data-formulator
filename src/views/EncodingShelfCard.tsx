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
import { Channel, Chart, FieldItem, Trigger, duplicateChart } from "../components/ComponentType";

import _ from 'lodash';

import '../scss/EncodingShelf.scss';
import { DictTable } from "../components/ComponentType";

import { resolveChartFields, assembleVegaChart, resolveRecommendedChart } from '../app/utils';
import { EncodingBox } from './EncodingBox';

import { channelGroups, CHART_TEMPLATES, getChartChannels, getChartTemplate } from '../components/ChartTemplates';
import { checkChartAvailability, getDataTable } from './VisualizationView';
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

    let theme = useTheme();

    let fieldItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    const dispatch = useDispatch<AppDispatch>();

    let handleClick = () => {
        if (trigger.chart) {
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

    let prompt: string = trigger.displayInstruction;
    if (trigger.instruction == '' && encFields.length > 0) {
        prompt = '';
    } else if (!trigger.displayInstruction || (trigger.instruction != '' && trigger.instruction.length <= trigger.displayInstruction.replace(/\*\*/g, '').length)) {
        prompt = trigger.instruction;
    }

    // Process the prompt to highlight content in ** **
    const processedPrompt = renderTextWithEmphasis(prompt, {
        fontSize: mini ? 10 : 11, padding: '1px 4px',
        borderRadius: radius.sm,
        background: alpha(theme.palette.custom.main, 0.08), 
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
            {processedPrompt} 
            {hideFields ? "" : encodingComp}
        </Typography> 
    }

    return  <Typography component="div" className={`${className}`}
        sx={{
            cursor: 'pointer', 
            fontSize: '11px',
            color: 'rgba(0,0,0,0.75)',
            textAlign: 'left',
            py: 0.5,
            px: 1,
            borderRadius: radius.sm,
            backgroundColor: theme.palette.custom.bgcolor,
            border: `1px solid ${borderColor.component}`,
            ...(highlighted ? { borderLeft: `2px solid ${theme.palette.custom.main}` } : {}),
            '& .MuiChip-label': { px: 0.5, fontSize: "10px"},
            ...sx,
        }} 
        onClick={handleClick}>
            {processedPrompt}
            {hideFields ? "" : <>{" "}{encodingComp}</>}
    </Typography>
}


export const EncodingShelfCard: FC<EncodingShelfCardProps> = function ({ chartId }) {
    const { t } = useTranslation();
    const theme = useTheme();

    // reference to states
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const config = useSelector((state: DataFormulatorState) => state.config);
    const agentRules = useSelector((state: DataFormulatorState) => state.agentRules);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);

    let activeModel = useSelector(dfSelectors.getActiveModel);
    let allCharts = useSelector(dfSelectors.getAllCharts);

    // The table the user is currently looking at (from focused state)
    const focusedTableId = (() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        const focusedChart = allCharts.find(c => c.id === focusedId.chartId);
        return focusedChart?.tableRef;
    })();

    let chart = allCharts.find(c => c.id == chartId) as Chart;
    let trigger = chart.source == "trigger" ? tables.find(t => t.derive?.trigger?.chart?.id == chartId)?.derive?.trigger : undefined;

    let [prompt, setPrompt] = useState<string>(trigger?.instruction || "");

    useEffect(() => {
        setPrompt(trigger?.instruction || "");
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

    let currentTable = getDataTable(chart, tables, allCharts, conceptShelfItems);

    // Check if chart is available
    let isChartAvailable = checkChartAvailability(chart, conceptShelfItems, currentTable.rows);


    // Consolidated chart state - maps chartId to its ideas, thinkingBuffer, and loading state
    const [chartState, setChartState] = useState<Record<string, {
        ideas: {text: string, goal: string, difficulty: 'easy' | 'medium' | 'hard'}[],
        thinkingBuffer: string,
        isLoading: boolean
    }>>({});
    
    // Get current chart's state
    const currentState = chartState[chartId] || { ideas: [], thinkingBuffer: "", isLoading: false };
    const currentChartIdeas = currentState.ideas;
    const thinkingBuffer = currentState.thinkingBuffer;
    const isLoadingIdeas = currentState.isLoading;
    
    // Helper functions to update current chart's state
    const setIdeas = (ideas: {text: string, goal: string, difficulty: 'easy' | 'medium' | 'hard'}[]) => {
        setChartState(prev => ({
            ...prev,
            [chartId]: { ...prev[chartId] || { thinkingBuffer: "", isLoading: false }, ideas }
        }));
    };
    
    const setThinkingBuffer = (thinkingBuffer: string) => {
        setChartState(prev => ({
            ...prev,
            [chartId]: { ...prev[chartId] || { ideas: [], isLoading: false }, thinkingBuffer }
        }));
    };
    
    const setIsLoadingIdeas = (isLoading: boolean) => {
        setChartState(prev => ({
            ...prev,
            [chartId]: { ...prev[chartId] || { ideas: [], thinkingBuffer: "" }, isLoading }
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
            const { downscaleImageForAgent } = await import('../app/chartCache');
            currentChartPng = await downscaleImageForAgent(currentChartPng);
        }

        await streamIdeas({
            actionTableIds,
            currentTable,
            onIdeas: setIdeas,
            onThinkingBuffer: setThinkingBuffer,
            onLoadingChange: setIsLoadingIdeas,
            currentChartImage: currentChartPng,
            currentDataSample: currentTable.rows.slice(0, 10),
            filterByType: true,
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
        dispatch(dfActions.updateAgentWorkInProgress({
            actionId, originTableId, description: actionDescription, status: 'running', hidden: false,
            message: { content: actionDescription, role: 'user', observeTableId: originTableId }
        }));

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
                const { downscaleImageForAgent } = await import('../app/chartCache');
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
                dispatch(dfActions.updateAgentWorkInProgress({
                    actionId, description: displayInstruction || actionDescription, status: 'completed', hidden: false,
                    message: { content: displayInstruction || actionDescription, role: 'action', resultTableId: candidateTable.id }
                }));
            },
            onError: () => {
                dispatch(dfActions.updateAgentWorkInProgress({
                    actionId, description: actionDescription, status: 'failed', hidden: false,
                    message: { content: t('encoding.formulationFailed'), role: 'error' }
                }));
            },
            onFinally: () => {
                dispatch(dfActions.changeChartRunningStatus({chartId, status: false}));
            },
        });
    }


    // zip multiple components together
    const w: any = (a: any[], b: any[]) => a.length ? [a[0], ...w(b, a.slice(1))] : b;

    let formulateInputBox = <Card key='text-input-boxes' variant='outlined' sx={{
        display: 'flex', flexDirection: 'column',
        px: 1, pt: 0.5, pb: 0.25,
        borderWidth: 1,
        borderColor: alpha(theme.palette.text.primary, 0.2),
        borderRadius: '8px',
        overflow: 'visible',
        flexShrink: 0,
        transition: transition.fast,
        '&:hover': {
            borderWidth: 1,
            borderColor: alpha(theme.palette.primary.main, 0.6),
        },
        '&:focus-within': {
            borderWidth: 1,
            borderColor: alpha(theme.palette.primary.main, 0.8),
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
                        deriveNewData(prompt, 'formulate');
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
            {trigger ? 
                <Tooltip title={<Typography sx={{fontSize: 11}}>{t('encoding.formulateAndOverride')} <TableIcon sx={{width: 10, height: 10, marginBottom: '-1px'}}/>{trigger.resultTableId}</Typography>}>
                    <span>
                        <IconButton size="small" color={"warning"} sx={{ p: 0.5 }} onClick={() => { 
                            deriveNewData(trigger!.instruction, 'formulate', trigger!.resultTableId); 
                        }}>
                            <ChangeCircleOutlinedIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                    </span>
                </Tooltip>
                : 
                <Tooltip title={t('encoding.formulate')}>
                    <span>
                        <IconButton size="small" color={"primary"} sx={{ p: 0.5 }} onClick={() => { deriveNewData(prompt, 'formulate'); }}>
                            <PrecisionManufacturing sx={{
                                fontSize: 20,
                                ...(isChartAvailable ? {} : {
                                    animation: 'pulseAttention 3s ease-in-out infinite',
                                    '@keyframes pulseAttention': {
                                        '0%, 90%': { scale: 1 },
                                        '95%': { scale: 1.2 },
                                        '100%': { scale: 1 },
                                    },
                                }),
                            }} />
                        </IconButton>
                    </span>
                </Tooltip>
            }           
        </Box>
    </Card>



    let channelComponent = (
        <Box sx={{ width: "100%", minWidth: "210px", height: '100%', display: "flex", flexDirection: "column", gap: '4px' }}>
            <Box key='mark-selector-box' sx={{ flex: '0 0 auto', display: 'flex', alignItems: 'center' }}>
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
                            const t = getChartTemplate(value);
                            return (
                                <div style={{display: 'flex', padding: "0px 0px 0px 4px"}}>
                                    <ListItemIcon sx={{minWidth: "24px"}}>
                                        {typeof t?.icon == 'string' ? <img height="24px" width="24px" src={t?.icon} alt="" role="presentation" /> : 
                                         <Box sx={{width: "24px", height: "24px"}}>{t?.icon}</Box>}
                                        </ListItemIcon>
                                    <ListItemText sx={{marginLeft: "2px", whiteSpace: "initial"}} slotProps={{primary: {fontSize: 12}}}>{t?.chart}</ListItemText>
                                </div>
                            )
                        }}
                        onChange={(event) => { }}>
                        {Object.entries(CHART_TEMPLATES).map(([group, templates]) => {
                            return [
                                <ListSubheader sx={{ 
                                    color: "text.secondary", 
                                    lineHeight: 2, 
                                    fontSize: 12,
                                    gridColumn: '1 / -1' // Make subheader span both columns
                                }} key={group}>{group}</ListSubheader>,
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
                                            // Manually trigger the chart type update (this will also close the menu)
                                            handleUpdateChartType(t.chart);
                                        }}
                                    >
                                        <Box sx={{display: 'flex'}}>
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
                                    </MenuItem>
                                ))
                            ]
                        })}
                    </Select>
                </FormControl>
            </Box>
            {/* Template-driven config property selectors */}
            <Box key='encoding-and-config' sx={{ 
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
                                // App-level visibility: hide certain properties unless relevant channels are assigned
                                if (propDef.key === 'independentYAxis') {
                                    const hasFacet = chart.encodingMap['column' as Channel]?.fieldID != null
                                        || chart.encodingMap['row' as Channel]?.fieldID != null;
                                    if (!hasFacet) return null;
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
                                            <Slider
                                                size="small"
                                                value={currentValue}
                                                min={propDef.min}
                                                max={propDef.max}
                                                step={propDef.step}
                                                onChange={(_event, newValue) => {
                                                    dispatch(dfActions.updateChartConfig({chartId, key: propDef.key, value: newValue as number}));
                                                }}
                                                valueLabelDisplay="auto"
                                                sx={{
                                                    flex: 1, height: 3, mx: 0.5,
                                                    '& .MuiSlider-thumb': { width: 10, height: 10 },
                                                    '& .MuiSlider-valueLabel': { fontSize: 10, padding: '2px 4px', lineHeight: 1.2 },
                                                }}
                                            />
                                            <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary', minWidth: '20px', textAlign: 'right' }}>
                                                {currentValue}
                                            </Typography>
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
            {formulateInputBox}
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
                    flexWrap: 'wrap', 
                    gap: 0.5,
                    pt: 0.5,
                }}>
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
            )}
            {isLoadingIdeas && !thinkingBuffer && (
                <Box sx={{ padding: '2px 0' }}>
                    {ThinkingBanner(t('encoding.ideating'))}
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
