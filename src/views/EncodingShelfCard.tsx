// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { DataFormulatorState, dfActions, dfSelectors, fetchCodeExpl, fetchChartInsight, fetchFieldSemanticType, generateFreshChart } from '../app/dfSlice';

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
import { ThinkingBufferEffect } from '../components/FunComponents';
import { Channel, Chart, FieldItem, Trigger, duplicateChart } from "../components/ComponentType";

import _ from 'lodash';

import '../scss/EncodingShelf.scss';
import { createDictTable, DictTable } from "../components/ComponentType";

import { getUrls, resolveChartFields, getTriggers, assembleVegaChart, resolveRecommendedChart, fetchWithIdentity } from '../app/utils';
import { EncodingBox } from './EncodingBox';

import { channelGroups, CHART_TEMPLATES, getChartChannels, getChartTemplate } from '../components/ChartTemplates';
import { checkChartAvailability, getDataTable } from './VisualizationView';
import { TableIcon, AgentIcon as PrecisionManufacturing } from '../icons';
import ChangeCircleOutlinedIcon from '@mui/icons-material/ChangeCircleOutlined';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import { ThinkingBanner } from './DataThread';

import { AppDispatch } from '../app/store';
import { borderColor, radius } from '../app/tokens';

import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';

import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { IdeaChip } from './ChartRecBox';

// Property and state of an encoding shelf
export interface EncodingShelfCardProps { 
    chartId: string;
    trigger?: Trigger;
    noBorder?: boolean;
}

let selectBaseTables = (activeFields: FieldItem[], currentTable: DictTable, tables: DictTable[]) : DictTable[] => {
    
    let baseTables: DictTable[] = [];

    // if the current table is derived from other tables, then we need to add those tables to the base tables
    if (currentTable.derive && !currentTable.anchored) {
        baseTables = currentTable.derive.source.map(t => tables.find(t2 => t2.id == t) as DictTable);
    } else {
        baseTables.push(currentTable);
    }

    // if there is no active fields at all!!
    if (activeFields.length == 0) {
        return baseTables;
    } else {
        // find what are other tables that was used to derive the active fields
        let relevantTableIds = [...new Set(activeFields.filter(t => t.source != "custom").map(t => t.tableRef))];
        // find all tables that contains the active original fields
        let tablesToAdd = tables.filter(t => relevantTableIds.includes(t.id));

        baseTables.push(...tablesToAdd.filter(t => !baseTables.map(t2 => t2.id).includes(t.id)));
    }

    return baseTables;
}

// Add this utility function before the TriggerCard component
export const renderTextWithEmphasis = (text: string, highlightChipSx?: SxProps<Theme>) => {
    
    text = text.replace(/_/g, '_\u200B');
    // Split the prompt by ** patterns and create an array of text and highlighted segments
    const parts = text.split(/(\*\*.*?\*\*)/g);
    
    return parts.map((part, index) => {
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
            dispatch(dfActions.setFocusedChart(trigger.chart.id));
            dispatch(dfActions.setFocusedTable(trigger.chart.tableRef));
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

        encodingComp = Object.entries(encodingMap)
            .filter(([channel, encoding]) => {
                return encoding.fieldID != undefined;
            })
            .map(([channel, encoding], index) => {
                let field = fieldItems.find(f => f.id == encoding.fieldID) as FieldItem;
                return [index > 0 ? '⨉' : '', 
                        <Chip 
                            key={`trigger-${channel}-${field?.id}`}
                            sx={{color:'inherit', maxWidth: '110px', m: 0.25,
                                   height: 18, fontSize: 12, borderRadius: radius.sm, 
                                   border: `1px solid ${borderColor.component}`, 
                                   background: 'rgb(250 235 215 / 70%)',
                                   '& .MuiChip-label': { px: 0.5 }}} 
                              label={`${field?.name}`} />]
            })
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
    const theme = useTheme();

    // reference to states
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const config = useSelector((state: DataFormulatorState) => state.config);
    const agentRules = useSelector((state: DataFormulatorState) => state.agentRules);

    let activeModel = useSelector(dfSelectors.getActiveModel);
    let allCharts = useSelector(dfSelectors.getAllCharts);

    let chart = allCharts.find(c => c.id == chartId) as Chart;
    let trigger = chart.source == "trigger" ? tables.find(t => t.derive?.trigger?.chart?.id == chartId)?.derive?.trigger : undefined;

    let [prompt, setPrompt] = useState<string>(trigger?.instruction || "");
    let [ideateMode, setIdeateMode] = useState<boolean>(false);

    useEffect(() => {
        setPrompt(trigger?.instruction || "");
        setIdeateMode(false);
    }, [chartId]);

    let encodingMap = chart?.encodingMap;

    const dispatch = useDispatch<AppDispatch>();

    const [chartTypeMenuOpen, setChartTypeMenuOpen] = useState<boolean>(false);
    

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

            let component = <Box key={`encoding-group-box-${group}`}>
                {group && <Typography key={`encoding-group-${group}`} sx={{ fontSize: 10, color: "text.secondary", marginBottom: "3px" }}>{group}</Typography>}
                {channelList.filter(channel => Object.keys(encodingMap).includes(channel))
                    .map(channel => <EncodingBox key={`shelf-${channel}`} channel={channel as Channel} chartId={chartId} tableId={currentTable.id} />)}
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
    
    // this is the base tables that will be used to derive the new data
    // this is the bare minimum tables that are required to derive the new data, based fields that will be used
    let requiredActionTables = selectBaseTables(activeFields, currentTable, tables);
    let actionTableIds = [
        ...requiredActionTables.map(t => t.id),
        ...tables.filter(t => t.derive === undefined || t.anchored).map(t => t.id).filter(id => !requiredActionTables.map(t => t.id).includes(id))
    ];

    let getIdeasForVisualization = async () => {
        if (!currentTable || isLoadingIdeas) {
            return;
        }

        setIsLoadingIdeas(true);
        setThinkingBuffer("");
        setIdeas([]);

        try {
            // Build exploration thread from current table to root
            let explorationThread: any[] = [];
            
            // If current table is derived, build the exploration thread
            if (currentTable.derive && !currentTable.anchored) {
                let triggers = getTriggers(currentTable, tables);
                
                // Build exploration thread with all derived tables in the chain
                explorationThread = triggers
                    .map(trigger => ({
                        name: trigger.resultTableId,
                        rows: tables.find(t2 => t2.id === trigger.resultTableId)?.rows,
                        description: `Derive from ${tables.find(t2 => t2.id === trigger.resultTableId)?.derive?.source} with instruction: ${trigger.instruction}`,
                    }));
            }

            let chartAvailable = checkChartAvailability(chart, conceptShelfItems, currentTable.rows);
            let currentChartPng = chartAvailable ? await vegaLiteSpecToPng(assembleVegaChart(chart.chartType, chart.encodingMap, activeFields, currentTable.rows, currentTable.metadata, 100, 80, false, chart.config)) : undefined;

            let actionTables = actionTableIds.map(id => tables.find(t => t.id == id) as DictTable);

            const token = String(Date.now());
            const messageBody = JSON.stringify({
                token: token,
                model: activeModel,
                input_tables: actionTables.map(t => ({
                    name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
                    rows: t.rows,
                    attached_metadata: t.attachedMetadata,
                })),
                exploration_thread: explorationThread,
                current_data_sample: currentTable.rows.slice(0, 10),
                current_chart: currentChartPng,
                mode: 'interactive',
                agent_exploration_rules: agentRules.exploration
            });

            const engine = getUrls().GET_RECOMMENDATION_QUESTIONS;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

            const response = await fetchWithIdentity(engine, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: messageBody,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Use streaming reader instead of response.json()
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body reader available');
            }

            const decoder = new TextDecoder();

            let lines: string[] = [];
            let buffer = '';

            let updateState = (lines: string[]) => {

                let dataBlocks = lines
                    .map(line => {
                        try { return JSON.parse(line.trim()); } catch (e) { return null; }})
                    .filter(block => block != null);

                let questions = dataBlocks.filter(block => block.type == "question").map(block => ({
                    text: block.text,
                    goal: block.goal,
                    difficulty: block.difficulty,
                    tag: block.tag
                }));

                setIdeas(questions);
            }

            try {
                while (true) {
                    const { done, value } = await reader.read();

                    if (done) { break; }

                    buffer += decoder.decode(value, { stream: true });
                    let newLines = buffer.split('data: ').filter(line => line.trim() !== "");

                    buffer = newLines.pop() || '';
                    if (newLines.length > 0) {
                        lines.push(...newLines);
                        updateState(lines);
                    }
                    setThinkingBuffer(buffer.replace(/^data: /, ""));
                }
            } finally {
                reader.releaseLock();
            }

            lines.push(buffer);
            updateState(lines);

            // Process the final result
            if (lines.length == 0) {
                throw new Error('No valid results returned from agent');
            }
        } catch (error) {
            dispatch(dfActions.addMessages({
                "timestamp": Date.now(),
                "type": "error",
                "component": "encoding shelf",
                "value": "Failed to get ideas from the exploration agent. Please try again.",
                "detail": error instanceof Error ? error.message : 'Unknown error'
            }));
        } finally {
            setIsLoadingIdeas(false);
        }
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

        if (actionTableIds.length == 0) {
            return;
        }

        let actionTables = actionTableIds.map(id => tables.find(t => t.id == id) as DictTable);

        if (currentTable.derive == undefined && instruction == "" && 
                (activeFields.length > 0 && activeCustomFields.length == 0) && 
                tables.some(t => t.derive == undefined && 
                activeFields.every(f => currentTable.names.includes(f.name)))) {

            // if there is no additional fields, directly generate
            let tempTable = getDataTable(chart, tables, allCharts, conceptShelfItems, true);
            dispatch(dfActions.updateTableRef({chartId: chartId, tableRef: tempTable.id}))

            //dispatch(dfActions.resetDerivedTables([])); //([{code: "", data: inputData.rows}]));
            dispatch(dfActions.changeChartRunningStatus({chartId, status: true}));
            // a fake function to give the feel that synthesizer is running
            setTimeout(function(){
                dispatch(dfActions.changeChartRunningStatus({chartId, status: false}));
                dispatch(dfActions.clearUnReferencedTables());
            }, 400);
            return
        }

        dispatch(dfActions.clearUnReferencedTables());
        
        let fieldNamesStr = activeFields.map(f => f.name).reduce(
            (a: string, b: string, i, array) => a + (i == 0 ? "" : (i < array.length - 1 ? ', ' : ' and ')) + b, "")

        let chartType = chart.chartType;

        let token = String(Date.now());

        // Build chart visualization context
        let chartComplete = checkChartAvailability(chart, conceptShelfItems, currentTable.rows);
        let chartSpec = (mode == 'formulate' && Object.keys(activeSimpleEncodings).length > 0) ? {
            chart_type: chartType,
            chart_encodings: activeSimpleEncodings,
            ...(chart.config ? { chart_options: chart.config } : {})
        } : undefined;

        let currentChartImage: string | null | undefined = undefined;
        if (chartComplete && chartSpec) {
            currentChartImage = await vegaLiteSpecToPng(assembleVegaChart(
                chart.chartType, chart.encodingMap, activeFields, currentTable.rows,
                currentTable.metadata, 100, 80, false, chart.config
            ));
        }

        // current_visualization: chart is complete (image optional + spec)
        // expected_visualization: chart is incomplete (spec only)
        let currentVisualization = (chartComplete && chartSpec) ? {
            chart_spec: chartSpec,
            ...(currentChartImage ? { chart_image: currentChartImage } : {})
        } : undefined;
        let expectedVisualization = (!chartComplete && chartSpec) ? { chart_spec: chartSpec } : undefined;

        // if nothing is specified, just a formulation from the beginning
        let messageBody = JSON.stringify({
            token: token,
            mode,
            input_tables: actionTables.map(t => {
                return { 
                    name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/ , ""), 
                    rows: t.rows, 
                    attached_metadata: t.attachedMetadata,
                }}),
            chart_type: chartType,
            chart_encodings: mode == 'formulate' ? activeSimpleEncodings : {},
            extra_prompt: instruction,
            model: activeModel,
            agent_coding_rules: agentRules.coding,
            current_visualization: currentVisualization,
            expected_visualization: expectedVisualization,
        })

        let engine = getUrls().DERIVE_DATA;

        if (currentTable.derive?.dialog && !currentTable.anchored) {
            let sourceTableIds = currentTable.derive?.source;

            let startNewDialog = (!sourceTableIds.every(id => actionTableIds.includes(id)) || 
                !actionTableIds.every(id => sourceTableIds.includes(id))) || mode === 'ideate';

            // Compare if source and base table IDs are different
            if (startNewDialog) {

                console.log("start new dialog", startNewDialog);
                
                let additionalMessages = currentTable.derive.dialog;

                // in this case, because table ids has changed, we need to use the additional messages and reformulate
                messageBody = JSON.stringify({
                    token: token,
                    mode,
                    input_tables: actionTables.map(t => {
                        return { 
                            name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/ , ""), 
                            rows: t.rows, 
                            attached_metadata: t.attachedMetadata,
                        }}),
                    chart_type: chartType,
                    chart_encodings: mode == 'formulate' ? activeSimpleEncodings : {},
                    extra_prompt: instruction,
                    model: activeModel,
                    additional_messages: additionalMessages,
                    agent_coding_rules: agentRules.coding,
                    current_visualization: currentVisualization,
                    expected_visualization: expectedVisualization,
                });
                engine = getUrls().DERIVE_DATA;
            } else {
                messageBody = JSON.stringify({
                    token: token,
                    mode,
                    input_tables: actionTables.map(t => {
                        return { 
                            name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/ , ""), 
                            rows: t.rows, 
                            attached_metadata: t.attachedMetadata,
                        }}),
                    chart_type: chartType,
                    chart_encodings: mode == 'formulate' ? activeSimpleEncodings : {},
                    dialog: currentTable.derive?.dialog,
                    latest_data_sample: currentTable.rows.slice(0, 10),
                    new_instruction: instruction,
                    model: activeModel,
                    agent_coding_rules: agentRules.coding,
                    current_visualization: currentVisualization,
                    expected_visualization: expectedVisualization,
                })
                engine = getUrls().REFINE_DATA;
            } 
        }

        let message = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: messageBody,
        };

        dispatch(dfActions.changeChartRunningStatus({chartId, status: true}));

        // timeout the request after 30 seconds
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.formulateTimeoutSeconds * 1000);
    
        fetchWithIdentity(engine, {...message, signal: controller.signal })
            .then((response: Response) => response.json())
            .then((data) => {
                
                dispatch(dfActions.changeChartRunningStatus({chartId, status: false}))

                if (data.results.length > 0) {
                    if (data["token"] == token) {
                        let candidates = data["results"].filter((item: any) => {
                            return item["status"] == "ok"  
                        });

                        if (candidates.length == 0) {
                            let errorMessage = data.results[0].content;
                            let code = data.results[0].code;

                            dispatch(dfActions.addMessages({
                                "timestamp": Date.now(),
                                "type": "error",
                                "component": "chart builder",
                                "value": `Data formulation failed, please try again.`,
                                "code": code,
                                "detail": errorMessage
                            }));
                        } else {

                            let candidate = candidates[0];
                            let code = candidate["code"];
                            let rows = candidate["content"]["rows"];
                            let dialog = candidate["dialog"];
                            let refinedGoal = candidate['refined_goal']
                            let displayInstruction = refinedGoal["display_instruction"];

                            // determine the table id for the new table
                            let candidateTableId;
                            if (overrideTableId) {
                                candidateTableId = overrideTableId;
                            } else {
                                if (candidate["content"]["virtual"] != null) {
                                    candidateTableId = candidate["content"]["virtual"]["table_name"];
                                } else {
                                    let genTableId = () => {
                                        let tableSuffix = Number.parseInt((Date.now() - Math.floor(Math.random() * 10000)).toString().slice(-2));
                                        let tableId = `table-${tableSuffix}`
                                        while (tables.find(t => t.id == tableId) != undefined) {
                                            tableSuffix = tableSuffix + 1;
                                            tableId = `table-${tableSuffix}`
                                        }
                                        return tableId;
                                    }
                                    candidateTableId = genTableId();
                                }
                            }

                            // PART 1: handle triggers
                            // add the intermediate chart that will be referred by triggers

                            let triggerChartSpec = duplicateChart(chart);
                            triggerChartSpec.source = "trigger";

                            let currentTrigger: Trigger =  { 
                                tableId: currentTable.id, 
                                instruction: instruction, 
                                displayInstruction: displayInstruction,
                                chart: triggerChartSpec,
                                resultTableId: candidateTableId
                            }
                        
                            // PART 2: create new table (or override table)
                            let candidateTable = createDictTable(
                                candidateTableId, 
                                rows, 
                                { 
                                    code: code,
                                    outputVariable: refinedGoal['output_variable'] || 'result_df',
                                    source: actionTableIds, 
                                    dialog: dialog, 
                                    trigger: currentTrigger 
                                }
                            )
                            if (candidate["content"]["virtual"] != null) {
                                candidateTable.virtual = {
                                    tableId: candidate["content"]["virtual"]["table_name"],
                                    rowCount: candidate["content"]["virtual"]["row_count"]
                                };
                            }

                            if (overrideTableId) {
                                dispatch(dfActions.overrideDerivedTables(candidateTable));
                            } else {
                                dispatch(dfActions.insertDerivedTables(candidateTable));
                            }
                            let names = candidateTable.names;
                            let missingNames = names.filter(name => !conceptShelfItems.some(field => field.name == name));
                
                            let conceptsToAdd = missingNames.map((name) => {
                                return {
                                    id: `concept-${name}-${Date.now()}`, 
                                    name: name, 
                                    source: "custom", 
                                    tableRef: "custom", 
                                } as FieldItem
                            })
                            dispatch(dfActions.addConceptItems(conceptsToAdd));

                            dispatch(fetchFieldSemanticType(candidateTable));
                            dispatch(fetchCodeExpl(candidateTable));

                            // concepts from the current table
                            let currentConcepts = [...conceptShelfItems.filter(c => names.includes(c.name)), ...conceptsToAdd];

                            // PART 3: create new charts if necessary
                            let needToCreateNewChart = true;
                            let focusedChartId: string | undefined;
                            
                            // different override strategy -- only override if there exists a chart that share the exact same encoding fields as the planned new chart.
                            if (mode != "ideate" && chart.chartType != "Auto" &&  overrideTableId != undefined && allCharts.filter(c => c.source == "user").find(c => c.tableRef == overrideTableId)) {
                                let chartsFromOverrideTable = allCharts.filter(c => c.source == "user" && c.tableRef == overrideTableId);
                                let chartsWithSameEncoding = chartsFromOverrideTable.filter(c => {
                                    let getSimpliedChartEnc = (chart: Chart) => {
                                        return chart.chartType + ":" + Object.entries(chart.encodingMap).filter(([channel, enc]) => enc.fieldID != undefined).map(([channel, enc]) => {
                                            return `${channel}:${enc.fieldID}:${enc.aggregate}:${enc.sortOrder}:${enc.sortBy}:${enc.scheme}`;
                                        }).join(";");
                                    }
                                    return getSimpliedChartEnc(c) == getSimpliedChartEnc(triggerChartSpec);
                                });
                                if (chartsWithSameEncoding.length > 0) {
                                    // find the chart to set as focus
                                    focusedChartId = chartsWithSameEncoding[0].id;
                                    dispatch(dfActions.setFocusedChart(focusedChartId));
                                    needToCreateNewChart = false;
                                }
                            }
                            
                            if (needToCreateNewChart) {
                                let newChart : Chart; 
                                if (mode == "ideate" || chart.chartType == "Auto") {
                                    newChart = resolveRecommendedChart(refinedGoal, currentConcepts, candidateTable);

                                } else if (chart.chartType == "Table") {
                                    newChart = generateFreshChart(candidateTable.id, 'Table')
                                } else {
                                    newChart = structuredClone(chart) as Chart;
                                    newChart.source = "user";
                                    newChart.id = `chart-${Date.now()- Math.floor(Math.random() * 10000)}`;
                                    newChart.saved = false;
                                    newChart.tableRef = candidateTable.id;
                                    newChart = resolveChartFields(newChart, currentConcepts, refinedGoal['chart_encodings'], candidateTable);
                                }   
                                
                                focusedChartId = newChart.id;
                                dispatch(dfActions.addAndFocusChart(newChart));
                            }

                            // Auto-generate chart insight after rendering
                            if (focusedChartId) {
                                const insightChartId = focusedChartId;
                                setTimeout(() => {
                                    dispatch(fetchChartInsight({ chartId: insightChartId, tableId: candidateTable.id }) as any);
                                }, 1500);
                            }

                            // PART 4: clean up
                            if (chart.chartType == "Table" || chart.chartType == "Auto" || (existsWorkingTable == false)) {
                                dispatch(dfActions.deleteChartById(chartId));
                            }
                            dispatch(dfActions.clearUnReferencedTables());
                            dispatch(dfActions.clearUnReferencedCustomConcepts());
                            dispatch(dfActions.setFocusedTable(candidateTable.id));

                            dispatch(dfActions.addMessages({
                                "timestamp": Date.now(),
                                "component": "chart builder",
                                "type": "success",
                                "value": `Data formulation for ${fieldNamesStr} succeeded.`
                            }));
                        }
                    }
                } else {
                    // TODO: add warnings to show the user
                    dispatch(dfActions.addMessages({
                        "timestamp": Date.now(),
                        "component": "chart builder",
                        "type": "error",
                        "value": "No result is returned from the data formulation agent. Please try again."
                    }));
                }
            }).catch((error) => {
                dispatch(dfActions.changeChartRunningStatus({chartId, status: false}));
                // Check if the error was caused by the AbortController
                if (error.name === 'AbortError') {
                    dispatch(dfActions.addMessages({
                        "timestamp": Date.now(),
                        "component": "chart builder",
                        "type": "error",
                        "value": `Data formulation timed out after ${config.formulateTimeoutSeconds} seconds. Consider breaking down the task, using a different model or prompt, or increasing the timeout limit.`,
                        "detail": "Request exceeded timeout limit"
                    }));
                } else {
                    console.error(error);
                    dispatch(dfActions.addMessages({
                        "timestamp": Date.now(),
                        "component": "chart builder",
                        "type": "error",
                        "value": `Data formulation failed, please try again.`,
                        "detail": error.message
                    }));
                }
            });
    }


    // zip multiple components together
    const w: any = (a: any[], b: any[]) => a.length ? [a[0], ...w(b, a.slice(1))] : b;

    let formulateInputBox = <Box key='text-input-boxes' sx={{display: 'flex', flexDirection: 'row', flex: 1, padding: '0px 2px'}}>
        <TextField
            id="outlined-multiline-flexible"
            sx={{
                "& .MuiInputLabel-root": { fontSize: '12px' },
                "& .MuiInput-input": { fontSize: '12px' },
                "& .MuiInput-underline:before": { borderBottomColor: theme.palette.primary.main },
                "& .MuiInput-underline:after": { borderBottomColor: theme.palette.primary.main },
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
            label=""
            placeholder={"what's next?"}
            fullWidth
            multiline
            variant="standard"
            size="small"
            maxRows={4} 
            minRows={1}
        />
        {trigger ? 
            <Box sx={{display: 'flex'}}>
                <Tooltip title={<Typography sx={{fontSize: 11}}>formulate and override <TableIcon sx={{width: 10, height: 10, marginBottom: '-1px'}}/>{trigger.resultTableId}</Typography>}>
                    <span>
                        <IconButton sx={{ marginLeft: "0"}} size="small"
                             color={"warning"} onClick={() => { 
                                deriveNewData(trigger!.instruction, 'formulate', trigger!.resultTableId); 
                            }}>
                            <ChangeCircleOutlinedIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
            </Box>
            : 
            <Tooltip title={`Formulate`}>
                <span>
                    <IconButton sx={{ marginLeft: "0"}} 
                         color={"primary"} onClick={() => { deriveNewData(prompt, 'formulate'); }}>
                        <PrecisionManufacturing sx={{
                            ...(isChartAvailable ? {} : {
                                animation: 'pulseAttention 3s ease-in-out infinite',
                                '@keyframes pulseAttention': {
                                    '0%, 90%': {
                                        scale: 1,
                                    },
                                    '95%': {
                                        scale: 1.2,
                                    },
                                    '100%': {
                                        scale: 1,
                                    },
                                },
                            }),
                        }} />
                    </IconButton>
                </span>
            </Tooltip>
        }
    </Box>

    // Ideas display section - get ideas for current chart
    let ideasSection = currentChartIdeas.length > 0 ? (
        <Box key='ideas-section'>
            <Box sx={{
                p: 0.5,
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: 0.75,
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
        </Box>
    ) : null;



    let channelComponent = (
        <Box sx={{ width: "100%", minWidth: "210px", height: '100%', display: "flex", flexDirection: "column", gap: '6px' }}>
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
            {(() => {
                    const template = getChartTemplate(chart.chartType);
                    const configProps = template?.properties;
                    if (!configProps || configProps.length === 0) return null;
                    return (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
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
                                        backgroundColor: 'rgba(0,0,0,0.04)', minHeight: '22px',
                                        overflow: 'hidden',
                                        '&:hover': { backgroundColor: 'rgba(0,0,0,0.07)' },
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
                                                '& .MuiSelect-select': { padding: '1px 20px 1px 0px !important', fontSize: 11 },
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
            <Box key='encoding-groups' sx={{ flex: '1 1 auto' }} style={{ height: "calc(100% - 100px)" }} className="encoding-list">
                {encodingBoxGroups}
            </Box>
            {formulateInputBox}
        </Box>);

    const encodingShelfCard = (
        <>
            <Box sx={{ 
                padding: '4px 6px', 
                maxWidth: "400px", 
                display: 'flex', 
                flexDirection: 'column', 
                borderRadius: '8px',
                border: `1px solid ${theme.palette.divider}`,
                backgroundColor: trigger ? "rgba(255, 160, 122, 0.04)" : "white",
            }}>
                {ideateMode ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0px' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Button
                                variant="text"
                                size="small"
                                disabled={isLoadingIdeas}
                                onClick={() => getIdeasForVisualization()}
                                startIcon={<TipsAndUpdatesIcon sx={{ fontSize: 14 }} />}
                                sx={{
                                    fontSize: 11,
                                    textTransform: 'none',
                                    padding: '2px 6px',
                                    borderRadius: '6px',
                                    color: isLoadingIdeas ? 'text.disabled' : (theme.palette.custom.textColor || theme.palette.custom.main),
                                    '&:hover': { backgroundColor: alpha(theme.palette.custom.main, 0.08) },
                                }}
                            >
                                Other ideas?
                            </Button>
                        </Box>
                        {/* Loading state */}
                        {isLoadingIdeas && (
                            <Box sx={{ padding: '2px 0' }}>
                                {ThinkingBanner('ideating...')}
                            </Box>
                        )}
                        {/* Ideas chips */}
                        {ideasSection}
                    </Box>
                ) : (
                    <Box sx={{ padding: '4px 0px' }}>
                        {channelComponent}
                    </Box>
                )}
            </Box>
            {/* Buttons below card */}
            {ideateMode ? (
                <Box sx={{ 
                    display: 'flex', 
                    width: 'fit-content',
                    padding: '6px 2px 0',
                }}>
                    <Button
                        variant="text"
                        size="small"
                        onClick={() => setIdeateMode(false)}
                        startIcon={<ArrowBackIcon sx={{ fontSize: 14 }} />}
                        sx={{
                            fontSize: 11,
                            textTransform: 'none',
                            padding: '2px 6px',
                            borderRadius: '6px',
                            color: 'text.secondary',
                            '&:hover': { backgroundColor: 'rgba(0,0,0,0.04)' },
                        }}
                    >
                        Back to editor
                    </Button>
                </Box>
            ) : (
                <Box sx={{ 
                    display: 'flex', 
                    width: 'fit-content',
                    padding: '6px 2px 0',
                }}>
                    <Button 
                        variant="text"
                        disabled={isLoadingIdeas} 
                        size="small"
                        onClick={() => { setIdeateMode(true); if (currentChartIdeas.length === 0) getIdeasForVisualization(); }}
                        startIcon={isLoadingIdeas ? undefined : <TipsAndUpdatesIcon sx={{ fontSize: 14 }} />}
                        sx={{
                            fontSize: 11,
                            textTransform: 'none',
                            justifyContent: 'flex-start',
                            padding: '2px 6px',
                            borderRadius: '6px',
                            color: theme.palette.custom.textColor || theme.palette.custom.main,
                            '&:hover': {
                                backgroundColor: alpha(theme.palette.custom.main, 0.08),
                            },
                        }}
                    >
                        {currentChartIdeas.length > 0 ? "View ideas" : "Some ideas?"}
                    </Button>
                </Box>
            )}
        </>
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
