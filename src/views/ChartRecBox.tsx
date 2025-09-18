// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { DataFormulatorState, dfActions, dfSelectors, fetchCodeExpl, fetchFieldSemanticType, generateFreshChart } from '../app/dfSlice';

import { AppDispatch } from '../app/store';

import {
    Box,
    Typography,
    MenuItem,
    IconButton,
    Tooltip,
    TextField,
    Stack,
    Card,
    Chip,
    Autocomplete,
    Menu,
    SxProps,
    LinearProgress,
    CircularProgress,
    Divider,
    List,
    ListItem,
    alpha,
    useTheme,
    Theme,
    ToggleButton,
    ToggleButtonGroup,
    Button,
    ButtonGroup,
} from '@mui/material';

import React from 'react';

import { Chart, FieldItem } from "../components/ComponentType";

import _ from 'lodash';

import '../scss/EncodingShelf.scss';
import { createDictTable, DictTable } from "../components/ComponentType";

import { getUrls, resolveChartFields, getTriggers } from '../app/utils';

import AddIcon from '@mui/icons-material/Add';
import PrecisionManufacturing from '@mui/icons-material/PrecisionManufacturing';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import { Type } from '../data/types';
import CloseIcon from '@mui/icons-material/Close';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import { renderTextWithEmphasis } from './EncodingShelfCard';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import MovingIcon from '@mui/icons-material/Moving';
import RotateRightIcon from '@mui/icons-material/RotateRight';

export interface ChartRecBoxProps {
    tableId: string;
    placeHolderChartId: string;
    sx?: SxProps;
}

// Table selector component for ChartRecBox
const NLTableSelector: FC<{
    selectedTableIds: string[],
    tables: DictTable[],
    updateSelectedTableIds: (tableIds: string[]) => void,
    requiredTableIds?: string[]
}> = ({ selectedTableIds, tables, updateSelectedTableIds, requiredTableIds = [] }) => {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);

    const handleClick = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const handleTableSelect = (table: DictTable) => {
        if (!selectedTableIds.includes(table.id)) {
            updateSelectedTableIds([...selectedTableIds, table.id]);
        }
        handleClose();
    };

    return (
        <Box sx={{ 
            display: 'flex',
            flexWrap: 'wrap',
            gap: '2px',
            padding: '4px',
            marginBottom: 0.5,
        }}>
            {selectedTableIds.map((tableId) => {
                const isRequired = requiredTableIds.includes(tableId);
                return (
                    <Chip
                        key={tableId}
                        label={tables.find(t => t.id == tableId)?.displayId}
                        size="small"
                        sx={{
                            height: 16,
                            fontSize: '10px',
                            borderRadius: '2px',
                            bgcolor: isRequired ? 'rgba(25, 118, 210, 0.2)' : 'rgba(25, 118, 210, 0.1)',
                            color: 'rgba(0, 0, 0, 0.7)',
                            '& .MuiChip-label': {
                                pl: '4px',
                                pr: '6px'
                            }
                        }}
                        deleteIcon={isRequired ? undefined : <CloseIcon sx={{ fontSize: '8px', width: '12px', height: '12px' }} />}
                        onDelete={isRequired ? undefined : () => updateSelectedTableIds(selectedTableIds.filter(id => id !== tableId))}
                    />
                );
            })}
            <Tooltip title="select tables for data formulation">
                <IconButton
                    size="small"
                    onClick={handleClick}
                    sx={{ 
                        width: 16,
                        height: 16,
                        fontSize: '10px',
                        padding: 0
                    }}
                >
                    <AddIcon fontSize="inherit" />
                </IconButton>
            </Tooltip>
            <Menu
                anchorEl={anchorEl}
                open={open}
                onClose={handleClose}
            >
                {tables
                    .filter(t => t.derive === undefined || t.anchored)
                    .map((table) => {
                        const isSelected = selectedTableIds.includes(table.id);
                        const isRequired = requiredTableIds.includes(table.id);
                        return (
                            <MenuItem 
                                disabled={isSelected}
                                key={table.id}
                                onClick={() => handleTableSelect(table)}
                                sx={{ 
                                    fontSize: '12px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}
                            >
                                {table.displayId}
                                {isRequired && <Typography sx={{ fontSize: '10px', color: 'text.secondary' }}>(required)</Typography>}
                            </MenuItem>
                        );
                    })
                }
            </Menu>
        </Box>
    );
};



export const IdeaChip: FC<{
    mini?: boolean,
    mode: 'interactive' | 'agent',
    idea: {text?: string, questions?: string[], goal: string, difficulty: 'easy' | 'medium' | 'hard', type?: 'branch' | 'deep_dive'} 
    theme: Theme, 
    onClick: () => void, 
    sx?: SxProps,
    disabled?: boolean,
}> = function ({mini, mode, idea, theme, onClick, sx, disabled}) {

    const getDifficultyColor = (difficulty: 'easy' | 'medium' | 'hard') => {
        switch (difficulty) {
            case 'easy':
                return theme.palette.success.main;
            case 'medium':
                return theme.palette.primary.main;
            case 'hard':
                return theme.palette.warning.main;
            default:
                return theme.palette.text.secondary;
        }
    };

    let styleColor = getDifficultyColor(idea.difficulty || 'medium');

    let ideaText: string = "";
    if (mode == 'interactive') {
        ideaText = mini ? idea.goal : idea.text || "";
    } else if (idea.questions) {
        ideaText = idea.goal;
    }

    let ideaTextComponent = renderTextWithEmphasis(ideaText, {
        borderRadius: '0px',
        borderBottom: `1px solid`,
        borderColor: alpha(styleColor, 0.4),
        fontSize: '11px',
        lineHeight: 1.4,
        backgroundColor: alpha(styleColor, 0.05),
    });

    return (
        <Box
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px 6px',
                fontSize: '11px',
                minHeight: '24px',
                height: 'auto',
                borderRadius: 2,
                border: `1px solid ${alpha(styleColor, 0.2)}`,
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                transition: 'all 0.2s ease-in-out',
                backgroundColor: alpha(theme.palette.background.paper, 0.9),
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                '&:hover': disabled ? 'none' : {
                    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                    borderColor: alpha(styleColor, 0.7),
                    transform: 'translateY(-1px)',
                },
                ...sx
            }}
            onClick={disabled ? undefined : onClick}
        >
            {idea.type === 'branch' && <CallSplitIcon sx={{color: getDifficultyColor(idea.difficulty), fontSize: 18, mr: 0.5, transform: 'rotate(90deg)'}} />}
            {idea.type === 'deep_dive' && <MovingIcon sx={{color: getDifficultyColor(idea.difficulty), fontSize: 18, mr: 0.5, transform: 'rotate(90deg)'}} />}
            <Typography component="div" sx={{ fontSize: '11px', color: getDifficultyColor(idea.difficulty || 'medium') }}>
                {ideaTextComponent}
            </Typography>
        </Box>
    );
};

export const ChartRecBox: FC<ChartRecBoxProps> = function ({ tableId, placeHolderChartId, sx }) {
    const dispatch = useDispatch<AppDispatch>();
    const theme = useTheme();

    // reference to states
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const config = useSelector((state: DataFormulatorState) => state.config);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const activeModel = useSelector(dfSelectors.getActiveModel);
    const activeChallenges = useSelector((state: DataFormulatorState) => state.activeChallenges);

    const [mode, setMode] = useState<'agent' | 'interactive'>("interactive");
    const [prompt, setPrompt] = useState<string>("");
    const [isFormulating, setIsFormulating] = useState<boolean>(false);
    const [ideas, setIdeas] = useState<{text: string, goal: string, difficulty: 'easy' | 'medium' | 'hard'}[]>(
        activeChallenges.find(ac => ac.tableId === tableId)?.challenges || []);
    
    const [agentIdeas, setAgentIdeas] = useState<{
        questions: string[], goal: string, 
        difficulty: 'easy' | 'medium' | 'hard', 
        tag: string, type: 'branch' | 'deep_dive' }[]>([
            {
                "difficulty": "medium",
                "goal": "Compare and visualize overall and type-specific impacts of natural disasters over time.",
                "questions": [
                    "Which types of natural disasters contributed the most deaths globally from 1900 to 2017?",
                    "How has the total number of deaths from all natural disasters changed over each decade?",
                    "What are the trends in deaths from specific disaster types (e.g., earthquakes vs. floods) over time?",
                    "Which years experienced anomalously high numbers of disaster-related deaths, and which disaster types were responsible?"
                ],
                "tag": "overview_comparison",
                "type": "branch"
            },
            {
                "difficulty": "hard",
                "goal": "Identify trends, cycles, and variability within and across disaster types.",
                "questions": [
                    "Is there seasonality or periodicity in the occurrence of high-fatality disasters?",
                    "Do some disaster types show increasing or decreasing death trends while others remain stable?",
                    "Are there clusters of years with high-impact disasters across multiple types?",
                    "How does the variability (variance) in deaths differ between disaster types?"
                ],
                "tag": "trend_analysis",
                "type": "branch"
            },
            {
                "difficulty": "hard",
                "goal": "Investigate and contextualize extreme outliers in disaster fatalities.",
                "questions": [
                    "Which disaster type had the single deadliest event across the entire dataset?",
                    "For this disaster type, which five years had the highest death tolls?",
                    "What percentage of total deaths from this disaster type occurred in its deadliest year?",
                    "Did similar peaks occur in other disaster types during the same years?"
                ],
                "tag": "outlier_analysis",
                "type": "deep_dive"
            },
            {
                "difficulty": "hard",
                "goal": "test 4:Investigate and contextualize extreme outliers in disaster fatalities.",
                "questions": [
                    "write a function with two input variables df1 and df2 that calculate the correlation between the two dataframes",
                ],
                "tag": "outlier_analysis",
                "type": "deep_dive"
            },
        ]);
    const [recReasoning, setRecReasoning] = useState<string>("");
    
    // Add state for cycling through questions
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
    
    // Add state for loading ideas
    const [isLoadingIdeas, setIsLoadingIdeas] = useState<boolean>(false);

    // Use the provided tableId and find additional available tables for multi-table operations
    const currentTable = tables.find(t => t.id === tableId);

    const availableTables = tables.filter(t => t.derive === undefined || t.anchored);
    const [additionalTableIds, setAdditionalTableIds] = useState<string[]>([]);
    
    // Combine the main tableId with additional selected tables
    const selectedTableIds = currentTable?.derive ? [...currentTable.derive.source, ...additionalTableIds] : [tableId];

    const handleTableSelectionChange = (newTableIds: string[]) => {
        // Filter out the main tableId since it's always included
        const additionalIds = newTableIds.filter(id => id !== tableId);
        setAdditionalTableIds(additionalIds);
    };

    // Function to get a question from the list with cycling
    const getQuestion = (): string => {
        return mode === "agent" ? "generate some explore directions" : "show something interesting about the data";
    };

    // Function to get ideas from the interactive explore agent
    const getIdeasFromAgent = async (mode: 'interactive' | 'agent', startQuestion?: string) => {
        if (!currentTable || isLoadingIdeas) {
            return;
        }

        setIsLoadingIdeas(true);

        try {
            // Determine the root table and derived tables context
            let explorationThread: any[] = [];
            let sourceTables = [currentTable];

            // If current table is derived, find the root table and build exploration thread
            if (currentTable.derive && !currentTable.anchored) {
                // Find the root table (first source table that is anchored or not derived)
                const sourceTableIds = currentTable.derive.source;
                sourceTables = sourceTableIds.map(id => tables.find(t => t.id === id)).filter(Boolean) as DictTable[];
                
                // Find the root table (anchored or not derived)
                let triggers = getTriggers(currentTable, tables);
                
                // Build exploration thread with all derived tables in the chain
                explorationThread = triggers
                    .map(trigger => ({
                        name: trigger.resultTableId,
                        rows: tables.find(t2 => t2.id === trigger.resultTableId)?.rows,
                        description: `Derive from ${trigger.sourceTableIds} with instruction: ${trigger.instruction}`,
                    }));
            }

            const messageBody = JSON.stringify({
                token: String(Date.now()),
                model: activeModel,
                start_question: startQuestion,
                mode: mode,
                input_tables: [{
                    name: sourceTables[0].virtual?.tableId || sourceTables[0].id.replace(/\.[^/.]+$/, ""),
                    rows: sourceTables[0].rows
                }],
                exploration_thread: explorationThread
            });

            const engine = getUrls().GET_RECOMMENDATION_QUESTIONS;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

            const response = await fetch(engine, {
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

            const data = await response.json();

            if (data.status === 'ok' && data.results.length > 0) {
                const result = data.results[0];
                if (result.status === 'ok' && result.content.exploration_questions) {
                    // Convert questions to ideas with 'easy' difficulty
                    if (mode === "agent") {
                    const newIdeas = result.content.exploration_questions.map((question: any) => ({
                            questions: question.questions,
                            goal: question.goal,
                            type: question.type,
                            difficulty: question.difficulty,
                            tag: question.tag
                        }));
                        setAgentIdeas(newIdeas);
                        setRecReasoning(result.content.reasoning);
                    } else {
                        const newIdeas = result.content.exploration_questions.map((question: {text: string, goal: string, difficulty: 'easy' | 'medium' | 'hard', tag: string}) => ({
                            text: question.text,
                            goal: question.goal,
                            difficulty: question.difficulty,
                            tag: question.tag
                        }));
                        setIdeas(newIdeas);
                        setRecReasoning(result.content.reasoning);
                    }
                }
            } else {
                throw new Error('No valid results returned from agent');
            }
        } catch (error) {
            console.error('Error getting ideas from agent:', error);
            dispatch(dfActions.addMessages({
                "timestamp": Date.now(),
                "type": "error",
                "component": "chart builder",
                "value": "Failed to get ideas from the exploration agent. Please try again.",
                "detail": error instanceof Error ? error.message : 'Unknown error'
            }));
        } finally {
            setIsLoadingIdeas(false);
        }
    };

    useEffect(() => {
        if (mode === "agent") {
            setAgentIdeas([]);
        } else {
            setIdeas([]);
        }
        
    }, [tableId]);

    // Handle tab key press for auto-completion
    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault();
            if (prompt.trim() === "") {
                setPrompt(getQuestion());
            }
        }
    };

    const deriveDataFromNL = (instruction: string) => {

        if (selectedTableIds.length === 0 || instruction.trim() === "") {
            return;
        }

        let originateChartId: string;

        if (placeHolderChartId) {
            //dispatch(dfActions.updateChartType({chartType: "Auto", chartId: placeHolderChartId}));
            dispatch(dfActions.changeChartRunningStatus({chartId: placeHolderChartId, status: true}));
            originateChartId = placeHolderChartId;
        } 

        const actionTables = selectedTableIds.map(id => tables.find(t => t.id === id) as DictTable);

        const actionId = `deriveDataFromNL_${String(Date.now())}`;
        dispatch(dfActions.udpateAgentWorkInProgress({actionId: actionId, tableId: tableId, description: instruction, status: 'running', hidden: false}));

        // Validate table selection
        const firstTableId = selectedTableIds[0];
        if (!firstTableId) {
            dispatch(dfActions.addMessages({
                "timestamp": Date.now(),
                "type": "error",
                "component": "chart builder",
                "value": "No table selected for data formulation.",
            }));
            return;
        }

        // Generate table ID
        const genTableId = () => {
            let tableSuffix = Number.parseInt((Date.now() - Math.floor(Math.random() * 10000)).toString().slice(-6));
            let tableId = `table-${tableSuffix}`;
            while (tables.find(t => t.id === tableId) !== undefined) {
                tableSuffix = tableSuffix + 1;
                tableId = `table-${tableSuffix}`;
            }
            return tableId;
        };

        setIsFormulating(true);

        const token = String(Date.now());
        let messageBody = JSON.stringify({
            token: token,
            mode: 'formulate',
            input_tables: actionTables.map(t => ({
                name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
                rows: t.rows
            })),
            new_fields: [], // No specific fields, let AI decide
            extra_prompt: instruction,
            model: activeModel,
            max_repair_attempts: config.maxRepairAttempts,
            language: actionTables.some(t => t.virtual) ? "sql" : "python"
        });
        let engine = getUrls().DERIVE_DATA;
        
        if (currentTable && currentTable.derive?.dialog && !currentTable.anchored) {
            let sourceTableIds = currentTable.derive?.source;

            let startNewDialog = (!sourceTableIds.every(id => selectedTableIds.includes(id)) || 
                !selectedTableIds.every(id => sourceTableIds.includes(id)));

            // Compare if source and base table IDs are different
            if (startNewDialog) {

                let additionalMessages = currentTable.derive.dialog;

                // in this case, because table ids has changed, we need to use the additional messages and reformulate
                messageBody = JSON.stringify({
                    token: token,
                    mode: 'formulate',
                    input_tables: actionTables.map(t => {return { name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/ , ""), rows: t.rows }}),
                    new_fields: [],
                    extra_prompt: instruction,
                    model: activeModel,
                    additional_messages: additionalMessages,
                    max_repair_attempts: config.maxRepairAttempts,
                    language: actionTables.some(t => t.virtual) ? "sql" : "python"
                });
                engine = getUrls().DERIVE_DATA;
            } else {
                messageBody = JSON.stringify({
                    token: token,
                    mode: 'formulate',
                    input_tables: actionTables.map(t => {return { name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/ , ""), rows: t.rows }}),
                    output_fields: [],
                    dialog: currentTable.derive?.dialog,
                    latest_data_sample: currentTable.rows.slice(0, 10),
                    new_instruction: instruction,
                    model: activeModel,
                    max_repair_attempts: config.maxRepairAttempts,
                    language: actionTables.some(t => t.virtual) ? "sql" : "python"
                })
                engine = getUrls().REFINE_DATA;
            } 
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.formulateTimeoutSeconds * 1000);

        fetch(engine, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: messageBody,
            signal: controller.signal
        })
        .then((response) => response.json())
        .then((data) => {
            setIsFormulating(false);

            dispatch(dfActions.changeChartRunningStatus({chartId: originateChartId, status: false}));

            if (data.results.length > 0) {
                if (data["token"] === token) {
                    const candidates = data["results"].filter((item: any) => item["status"] === "ok");

                    if (candidates.length === 0) {
                        const errorMessage = data.results[0].content;
                        const code = data.results[0].code;

                        dispatch(dfActions.addMessages({
                            "timestamp": Date.now(),
                            "type": "error",
                            "component": "chart builder",
                            "value": `Data formulation failed, please try again.`,
                            "code": code,
                            "detail": errorMessage
                        }));
                    } else {
                        const candidate = candidates[0];
                        const code = candidate["code"];
                        const rows = candidate["content"]["rows"];
                        const dialog = candidate["dialog"];
                        const refinedGoal = candidate['refined_goal'];
                        const displayInstruction = refinedGoal['display_instruction'];

                        

                        const candidateTableId = candidate["content"]["virtual"] 
                            ? candidate["content"]["virtual"]["table_name"] 
                            : genTableId();

                        // Create new table
                        const candidateTable = createDictTable(
                            candidateTableId,
                            rows,
                            undefined // No derive info for ChartRecBox - it's NL-driven without triggers
                        );

                        let refChart = generateFreshChart(tableId, 'Auto') as Chart;
                        refChart.source = 'trigger';
                        
                        // Add derive info manually since ChartRecBox doesn't use triggers
                        candidateTable.derive = {
                            code: code,
                            source: selectedTableIds,
                            dialog: dialog,
                            trigger: {
                                tableId: tableId,
                                sourceTableIds: selectedTableIds,
                                instruction: instruction,
                                displayInstruction: displayInstruction,
                                chart: refChart, // No upfront chart reference
                                resultTableId: candidateTableId
                            }
                        };

                        if (candidate["content"]["virtual"] != null) {
                            candidateTable.virtual = {
                                tableId: candidate["content"]["virtual"]["table_name"],
                                rowCount: candidate["content"]["virtual"]["row_count"]
                            };
                        }

                        dispatch(dfActions.insertDerivedTables(candidateTable));

                        // Add missing concept items
                        const names = candidateTable.names;
                        const missingNames = names.filter(name => 
                            !conceptShelfItems.some(field => field.name === name)
                        );

                        const conceptsToAdd = missingNames.map((name) => ({
                            id: `concept-${name}-${Date.now()}`,
                            name: name,
                            type: "auto" as Type,
                            description: "",
                            source: "custom",
                            tableRef: "custom",
                            temporary: true,
                        } as FieldItem));

                        dispatch(dfActions.addConceptItems(conceptsToAdd));
                        dispatch(fetchFieldSemanticType(candidateTable));
                        dispatch(fetchCodeExpl(candidateTable));

                        // Create proper chart based on refined goal
                        const currentConcepts = [...conceptShelfItems.filter(c => names.includes(c.name)), ...conceptsToAdd];
                        
                        let chartTypeMap: any = {
                            "line": "Line Chart",
                            "bar": "Bar Chart", 
                            "point": "Scatter Plot",
                            "boxplot": "Boxplot",
                            "area": "Custom Area",
                            "heatmap": "Heatmap",
                            "group_bar": "Grouped Bar Chart"
                        };

                        const chartType = chartTypeMap[refinedGoal?.['chart_type']] || 'Scatter Plot';
                        let newChart = generateFreshChart(candidateTable.id, chartType) as Chart;
                        newChart = resolveChartFields(newChart, currentConcepts, refinedGoal['visualization_fields'], candidateTable);

                        // Create and focus the new chart directly
                        dispatch(dfActions.addAndFocusChart(newChart));

                        // Clean up
                        dispatch(dfActions.setFocusedTable(candidateTable.id));

                        dispatch(dfActions.addMessages({
                            "timestamp": Date.now(),
                            "component": "chart builder",
                            "type": "success",
                            "value": `Data formulation: "${displayInstruction}"`
                        }));

                        // Clear the prompt after successful formulation
                        setPrompt("");
                    }
                }
                dispatch(dfActions.deleteAgentWorkInProgress(actionId));
            } else {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder", 
                    "type": "error",
                    "value": "No result is returned from the data formulation agent. Please try again."
                }));
                
                setIsFormulating(false);
                dispatch(dfActions.deleteAgentWorkInProgress(actionId));
            }
        })
        .catch((error) => {
            setIsFormulating(false);
            dispatch(dfActions.changeChartRunningStatus({chartId: originateChartId, status: false}));   

            if (error.name === 'AbortError') {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "error", 
                    "value": `Data formulation timed out after ${config.formulateTimeoutSeconds} seconds. Consider breaking down the task, using a different model or prompt, or increasing the timeout limit.`,
                    "detail": "Request exceeded timeout limit"
                }));
                dispatch(dfActions.deleteAgentWorkInProgress(actionId));
            } else {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "error",
                    "value": `Data formulation failed, please try again.`,
                    "detail": error.message
                }));
                dispatch(dfActions.deleteAgentWorkInProgress(actionId));
            }
        });
    };

    const exploreDataFromNL = (startQuestion: string) => {

        let actionId = `exploreDataFromNL_${String(Date.now())}`;

        if (selectedTableIds.length === 0 || startQuestion.trim() === "") {
            return;
        }

        setIsFormulating(true);
        dispatch(dfActions.udpateAgentWorkInProgress({actionId: actionId, tableId: tableId, description: startQuestion, status: 'running', hidden: false}));

        let actionTables = tables.filter(t => selectedTableIds.includes(t.id));

        const token = String(Date.now());
        let messageBody = JSON.stringify({
            token: token,
            input_tables: actionTables.map(t => ({
                name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
                rows: t.rows
            })),
            start_question: startQuestion,
            model: activeModel,
            max_iterations: 5,
            language: actionTables.some(t => t.virtual) ? "sql" : "python"
        });

        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.formulateTimeoutSeconds * 4 * 1000);

        // State for accumulating streaming results
        let allResults: any[] = [];
        let createdTables: DictTable[] = [];
        let createdCharts: Chart[] = [];
        let allNewConcepts: FieldItem[] = [];
        let isCompleted = false;

        // Generate table ID helper
        const genTableId = () => {
            let tableSuffix = Number.parseInt((Date.now() - Math.floor(Math.random() * 10000)).toString().slice(-6));
            let tableId = `table-${tableSuffix}`;
            while (tables.find(t => t.id === tableId) !== undefined) {
                tableSuffix = tableSuffix + 1;
                tableId = `table-${tableSuffix}`;
            }
            return tableId;
        };

        // Function to process a single streaming result
        const processStreamingResult = (result: any) => {

            if (result.type === "planning") {
                dispatch(dfActions.udpateAgentWorkInProgress({actionId: actionId, description: result.content.plan.instruction, status: 'running', hidden: false}));
            }

            if (result.type === "data_transformation" && result.status === "success") {
                // Extract from the new structure: content.result instead of transform_result
                const transformResult = result.content.result;
                
                if (!transformResult || transformResult.status !== 'ok') {
                    return; // Skip failed transformations
                }
                
                const transformedData = transformResult.content;
                const code = transformResult.code;
                const dialog = transformResult.dialog;
                const refinedGoal = transformResult.refined_goal;
                const question = result.content.question;
                
                if (!transformedData || !transformedData.rows || transformedData.rows.length === 0) {
                    return; // Skip empty results
                }

                const rows = transformedData.rows;
                const candidateTableId = transformedData.virtual?.table_name || genTableId();
                const displayInstruction = refinedGoal?.display_instruction || `Exploration step ${createdTables.length + 1}: ${question}`;

                // Determine the trigger table and source tables for this iteration
                const isFirstIteration = createdTables.length === 0;
                const triggerTableId = isFirstIteration ? tableId : createdTables[createdTables.length - 1].id;

                // Create new table
                const candidateTable = createDictTable(
                    candidateTableId,
                    rows,
                    undefined // No derive info initially
                );

                // Add derive info manually for exploration results
                candidateTable.derive = {
                    code: code || `# Exploration step ${createdTables.length + 1}`,
                    source: selectedTableIds,
                    dialog: dialog || [],
                    trigger: {
                        tableId: triggerTableId,
                        sourceTableIds: selectedTableIds,
                        instruction: question,
                        displayInstruction: displayInstruction,
                        chart: undefined, // Will be set after chart creation
                        resultTableId: candidateTableId
                    }
                };

                if (transformedData.virtual) {
                    candidateTable.virtual = {
                        tableId: transformedData.virtual.table_name,
                        rowCount: transformedData.virtual.row_count
                    };
                }

                createdTables.push(candidateTable);

                dispatch(dfActions.udpateAgentWorkInProgress({actionId: actionId, tableId: candidateTable.id, description: '', status: 'running', hidden: false}));

                // Add missing concept items for this table
                const names = candidateTable.names;
                const missingNames = names.filter(name => 
                    !conceptShelfItems.some(field => field.name === name) &&
                    !allNewConcepts.some(concept => concept.name === name)
                );

                const conceptsToAdd = missingNames.map((name) => ({
                    id: `concept-${name}-${Date.now()}-${Math.random()}`,
                    name: name,
                    type: "auto" as Type,
                    description: "",
                    source: "custom",
                    tableRef: "custom",
                    temporary: true,
                } as FieldItem));

                allNewConcepts.push(...conceptsToAdd);

                // Create chart from refined goal or planning data
                let chartType = "Scatter Plot"; // default
                let chartGoal = refinedGoal;

                // If no refined goal, try to extract from the planning result in the same iteration
                if (!chartGoal) {
                    const planningResult = allResults.find((r: any) => 
                        r.type === "planning" && 
                        r.iteration === result.iteration && 
                        r.status === "success"
                    );

                    if (planningResult && planningResult.content?.plan) {
                        const plan = planningResult.content.plan;
                        // Try to extract chart info from the plan if available
                        if (plan.instruction) {
                            chartGoal = {
                                chart_type: "scatter", // default
                                visualization_fields: [], // will be inferred
                                display_instruction: `Exploration: ${plan.instruction}`
                            };
                        }
                    }
                }

                // Map chart types
                const chartTypeMap: any = {
                    "line": "Line Chart",
                    "bar": "Bar Chart", 
                    "point": "Scatter Plot",
                    "boxplot": "Boxplot",
                    "area": "Custom Area",
                    "heatmap": "Heatmap",
                    "group_bar": "Grouped Bar Chart"
                };

                chartType = chartTypeMap[chartGoal?.chart_type] || "Scatter Plot";
                
                // Create trigger chart for derive info
                let triggerChart = generateFreshChart(actionTables[0].id, 'Auto') as Chart;
                triggerChart.source = 'trigger';

                // Update the derive trigger to reference the trigger chart
                if (candidateTable.derive) {
                    candidateTable.derive.trigger.chart = triggerChart;
                }

                // Create regular chart that belongs to the table for visualization
                let newChart = generateFreshChart(candidateTable.id, chartType) as Chart;
                newChart.source = 'user';

                // Resolve chart fields for regular chart if we have them
                if (chartGoal) {
                    const currentConcepts = [...conceptShelfItems.filter(c => names.includes(c.name)), ...allNewConcepts, ...conceptsToAdd];
                    newChart = resolveChartFields(newChart, currentConcepts, chartGoal['visualization_fields'], candidateTable);
                }

                createdCharts.push(newChart);

                // Immediately add the new concepts, table, and chart to the state
                if (conceptsToAdd.length > 0) {
                    dispatch(dfActions.addConceptItems(conceptsToAdd));
                }

                dispatch(dfActions.insertDerivedTables(candidateTable));
                dispatch(fetchFieldSemanticType(candidateTable));
                dispatch(fetchCodeExpl(candidateTable));

                // Add and focus on the new chart
                dispatch(dfActions.addAndFocusChart(newChart));
                dispatch(dfActions.setFocusedTable(candidateTable.id));

                // Show progress message
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "info",
                    "value": `Exploration step ${createdTables.length} completed: ${displayInstruction}`
                }));
            }
        };

        // Function to handle completion
        const handleCompletion = () => {
            if (isCompleted) return;
            isCompleted = true;

            setIsFormulating(false);
            clearTimeout(timeoutId);

            const completionResult = allResults.find((result: any) => result.type === "completion");
            if (completionResult) {
                // Get completion message from completion result if available
                let summary = completionResult.content.plan.instruction || completionResult.content.plan.assessment || "";
                
                dispatch(dfActions.udpateAgentWorkInProgress({actionId: actionId, description: summary, status: completionResult.content.plan.status === 'present' ? 'completed' : 'warning', hidden: false}));

                let completionMessage = `Data exploration completed with ${completionResult.content.total_steps} visualization${completionResult.content.total_steps > 1 ? 's' : ''}.`;

                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "success",
                    "value": completionMessage
                }));

                // Clear the prompt after successful exploration
                setPrompt("");
            } else {
                dispatch(dfActions.udpateAgentWorkInProgress({actionId: actionId, description: "The agent got lost in the data.", status: 'failed', hidden: false}));

                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "error",
                    "value": "The agent got lost in the data. Please try again."
                }));
            }
        };

        fetch(getUrls().EXPLORE_DATA_STREAMING, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: messageBody,
            signal: controller.signal
        })
        .then(async (response) => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body reader available');
            }

            const decoder = new TextDecoder();
            let buffer = '';

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    
                    if (done) {
                        handleCompletion();
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });
                    
                    // Split by newlines to get individual JSON objects
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

                    // should be only one message per line
                    for (let line of lines) {
                        if (line.trim() !== "") {
                            try {
                                const data = JSON.parse(line);
                                if (data.token === token) {
                                    if (data.status === "ok" && data.result) {
                                        allResults.push(data.result);
                                        processStreamingResult(data.result);

                                        // Check if this is a completion result
                                        if (data.result.type === "completion") {
                                            handleCompletion();
                                            return;
                                        }
                                    } else if (data.status === "error") {
                                        setIsFormulating(false);
                                        clearTimeout(timeoutId);
                                        
                                        dispatch(dfActions.addMessages({
                                            "timestamp": Date.now(),
                                            "component": "chart builder", 
                                            "type": "error",
                                            "value": data.error_message || "Error during data exploration. Please try again."
                                        }));
                                        return;
                                    }
                                }
                            } catch (parseError) {
                                console.warn('Failed to parse streaming response:', parseError);
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
        })
        .catch((error) => {
            setIsFormulating(false);
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError') {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "error",
                    "value": "Data exploration timed out. Please try again.",
                    "detail": error.message
                }));
            } else {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "error",
                    "value": `Data exploration failed: ${error.message}`,
                    "detail": error.message
                }));
            }
        });
    };

    const showTableSelector = availableTables.length > 1 && currentTable;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', ...sx }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ButtonGroup
                    size="small"
                    sx={{
                        ml: 1,
                        '& .MuiButton-root': {
                            textTransform: 'none',
                            fontSize: '0.625rem',
                            fontWeight: 500,
                            border: 'none',
                            borderRadius: '4px',
                            borderBottomLeftRadius: 0,
                            borderBottomRightRadius: 0,
                            padding: '2px 6px',
                            minWidth: 'auto',
                        },
                    }}
                >
                    <Button variant="text" value="interactive" sx={{ 
                        color: mode === "interactive" ? "primary" : "text.secondary", 
                        backgroundColor: mode === "interactive" ? "rgba(25, 118, 210, 0.08)" : "transparent",
                        
                    }} onClick={() => {
                        setMode("interactive");
                    }}>
                        interactive
                    </Button>
                    <Button variant="text" value="agent" sx={{ 
                            color: mode === "agent" ? "primary" : "text.secondary", 
                            backgroundColor: mode === "agent" ? "rgba(25, 118, 210, 0.08)" : "transparent"
                        }} onClick={() => {
                            setMode("agent");
                            if (agentIdeas.length === 0) {
                                getIdeasFromAgent("agent");
                            }
                        }}>
                        agent
                    </Button>
                </ButtonGroup>
            </Box>
            <Card variant='outlined' sx={{ 
                padding: 2, 
                maxWidth: "600px", 
                display: 'flex', 
                flexDirection: 'column',
                gap: 1,
                position: 'relative',
                boxShadow: mode === "agent" 
                    ? ' 0 0 20px 0 rgba(25, 118, 210, 0.15)' 
                    : 'none'
            }}>
                {isFormulating && (
                    <LinearProgress 
                        sx={{ 
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            zIndex: 1000,
                            height: '4px'
                        }} 
                    />
                )}
                {showTableSelector && (
                    <Box>
                        <Typography sx={{ fontSize: 12, color: "text.secondary", marginBottom: 0.5 }}>
                            Select additional tables:
                        </Typography>
                        <NLTableSelector
                            selectedTableIds={selectedTableIds}
                            tables={availableTables}
                            updateSelectedTableIds={handleTableSelectionChange}
                            requiredTableIds={[tableId]}
                        />
                    </Box>
                )}

                <Box sx={{ display: 'flex', flexDirection: 'row', gap: 1, alignItems: 'flex-end' }}>
                    <TextField
                        sx={{
                            flex: 1,
                            "& .MuiInputLabel-root": { fontSize: '14px' },
                            "& .MuiInput-input": { fontSize: '14px' }
                        }}
                        disabled={isFormulating || isLoadingIdeas}
                        onChange={(event) => setPrompt(event.target.value)}
                        onKeyDown={handleKeyDown}
                        slotProps={{
                            inputLabel: { shrink: true },
                            input: {
                                endAdornment: mode == "agent" ? <ButtonGroup>
                                    <Tooltip title={agentIdeas.length > 0 ? "regenerate directions" : "generate exploration directions"}>   
                                        <span>
                                            <IconButton 
                                                size="medium"
                                                disabled={isFormulating || !currentTable || isLoadingIdeas}
                                                color="primary" 
                                                onClick={() => getIdeasFromAgent("agent", prompt.trim())}
                                            >
                                                {isLoadingIdeas ? <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                                                    <CircularProgress size={24} />
                                                </Box> : (agentIdeas.length > 0 ? <RotateRightIcon sx={{fontSize: 24}} /> : <TipsAndUpdatesIcon sx={{fontSize: 24}} />)}
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                </ButtonGroup>
                                : <Tooltip title="Generate chart from description">
                                    <span>
                                        <IconButton 
                                            size="medium"
                                            disabled={isFormulating || !currentTable || prompt.trim() === ""}
                                            color="primary" 
                                            onClick={() => deriveDataFromNL(prompt.trim())}
                                        >
                                            {isFormulating ? <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                                                <CircularProgress size={24} />
                                            </Box> : <PrecisionManufacturing sx={{fontSize: 24}} />}
                                        </IconButton>
                                    </span>
                                </Tooltip>
                            }
                        }}
                        value={prompt}
                        label={mode === "agent" ? "Where should the agent go?" : "What do you want to explore?"}
                        placeholder={`${getQuestion()}`}
                        fullWidth
                        multiline
                        variant="standard"
                        maxRows={4}
                        minRows={1}
                    />
                    {mode === "interactive" && <Divider orientation="vertical" flexItem />}
                    {mode === "interactive" && <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 0.5, my: 1}}>
                        <Typography sx={{ fontSize: 10, color: "text.secondary", marginBottom: 0.5 }}>
                            ideas?
                        </Typography>
                        <Tooltip title="Get some ideas!">   
                            <span>
                                <IconButton 
                                    size="medium"
                                    disabled={isFormulating || !currentTable || isLoadingIdeas}
                                    color="primary" 
                                    onClick={() => getIdeasFromAgent("interactive")}
                                >
                                    {isLoadingIdeas ? <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                                        <CircularProgress size={24} />
                                    </Box> : <TipsAndUpdatesIcon sx={{
                                        fontSize: 24,
                                        animation: ideas.length == 0 ? 'colorWipe 5s ease-in-out infinite' : 'none',
                                        '@keyframes colorWipe': {
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
                                    }} />}
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>}
                </Box>
                {/* Ideas Chips Section */}
                {mode === 'interactive' && ideas.length > 0 && (
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, marginBottom: 1 }}>
                            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                                ideas
                            </Typography>
                        </Box>
                        <Box sx={{
                            display: 'flex', 
                            flexWrap: 'wrap', 
                            gap: 0.5,
                            marginBottom: 1
                        }}>
                            {ideas.map((idea, index) => (
                                <IdeaChip
                                    mode="interactive"
                                    mini
                                    key={index}
                                    idea={idea}
                                    theme={theme}
                                    onClick={() => {
                                        setPrompt(idea.text);
                                        deriveDataFromNL(idea.text);
                                    }}
                                    disabled={isFormulating}
                                    sx={{
                                        width: '46%',
                                    }}
                                />
                            ))}
                        </Box>
                    </Box>
                )}
                {mode === 'agent' && agentIdeas.length > 0 && (
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, marginBottom: 1 }}>
                            <Typography sx={{ fontSize: 12, color: "text.secondary", ".MuiSvgIcon-root": { cursor: 'help', transform: 'rotate(90deg)', verticalAlign: 'middle', fontSize: 12} }}>
                                directions <Tooltip title="deep dive"><MovingIcon /></Tooltip>  <Tooltip title="branch"><CallSplitIcon /></Tooltip>
                            </Typography>
                        </Box>
                        <Box sx={{
                            display: 'flex', 
                            flexWrap: 'wrap', 
                            gap: 0.5,
                            marginBottom: 1,
                        }}>
                            {agentIdeas.map((idea, index) => (
                                <IdeaChip
                                    mode="agent"
                                    mini
                                    key={index}
                                    idea={idea}
                                    theme={theme}
                                    onClick={() => {
                                        if (idea.type === "deep_dive" && idea.questions.length > 0) {
                                            exploreDataFromNL(idea.questions[0]);
                                        } else {    
                                            idea.questions.forEach((question, index) => {
                                                setTimeout(() => {
                                                    setPrompt(question);
                                                    deriveDataFromNL(question);
                                                }, index * 1000); // 1000ms delay between each call
                                            });
                                        }
                                    }}
                                    disabled={isFormulating}
                                    sx={{
                                        width: '46%',
                                    }}
                                />
                            ))}
                            
                        </Box>
                    </Box>
                )}
            </Card>
        </Box>
    );
};