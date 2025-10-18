// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState, useRef } from 'react'
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

import { getUrls, getTriggers, resolveRecommendedChart } from '../app/utils';

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
import EditIcon from '@mui/icons-material/Edit';
import { ThinkingBufferEffect } from '../components/FunComponents';

export interface ChartRecBoxProps {
    tableId: string;
    placeHolderChartId?: string;
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
    idea: {text?: string, questions?: string[], goal: string, difficulty: 'easy' | 'medium' | 'hard', type?: 'branch' | 'deep_dive'} 
    theme: Theme, 
    onClick: () => void, 
    sx?: SxProps,
    disabled?: boolean,
}> = function ({mini, idea, theme, onClick, sx, disabled}) {

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

    let ideaText = idea.goal;

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
            <Typography component="div" sx={{ fontSize: '11px', color: getDifficultyColor(idea.difficulty || 'medium') }}>
                {ideaTextComponent}
            </Typography>
        </Box>
    );
};

export const AgentIdeaChip: FC<{
    mini?: boolean,
    idea: {breadth_questions: string[], depth_questions: string[], goal: string, difficulty: 'easy' | 'medium' | 'hard', focus: 'breadth' | 'depth'} 
    theme: Theme, 
    onClick: () => void, 
    sx?: SxProps,
    disabled?: boolean,
}> = function ({mini, idea, theme, onClick, sx, disabled}) {

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


    let ideaText = idea.goal;

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
            {idea.focus === 'breadth' && <CallSplitIcon sx={{color: getDifficultyColor(idea.difficulty), fontSize: 18, mr: 0.5, transform: 'rotate(90deg)'}} />}
            {idea.focus === 'depth' && <MovingIcon sx={{color: getDifficultyColor(idea.difficulty), fontSize: 18, mr: 0.5, transform: 'rotate(90deg)'}} />}
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
    const agentRules = useSelector((state: DataFormulatorState) => state.agentRules);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const activeModel = useSelector(dfSelectors.getActiveModel);


    let preferredMode = (
        activeModel.model == 'gpt-5' ||
        activeModel.model.startsWith('claude-sonnet-4') ||
        activeModel.model.startsWith('claude-opus-4') ||
        activeModel.model.startsWith('o1') ||
        activeModel.model.startsWith('o3') ||
        activeModel.model == 'gpt-4.1'
    ) ? "agent" : "interactive";

    const [mode, setMode] = useState<'agent' | 'interactive'>(preferredMode as 'agent' | 'interactive');

    const focusNextChartRef = useRef<boolean>(true);
    
    // Color map for different modes - easy to customize!
    const modeColorMap = {
        'agent': theme.palette.primary.main,      // purple for agent mode
        'interactive': theme.palette.secondary.main   // blue for interactive mode
    };
    const modeColor = modeColorMap[mode];
    
    const [prompt, setPrompt] = useState<string>("");
    const [isFormulating, setIsFormulating] = useState<boolean>(false);
    const [ideas, setIdeas] = useState<{text: string, goal: string, difficulty: 'easy' | 'medium' | 'hard'}[]>([]);
    
    const [agentIdeas, setAgentIdeas] = useState<{
        breadth_questions: string[], depth_questions: string[], goal: string, 
        difficulty: 'easy' | 'medium' | 'hard', 
        focus: 'breadth' | 'depth' }[]>([]);
    const [thinkingBuffer, setThinkingBuffer] = useState<string>("");

    let thinkingBufferEffect = <ThinkingBufferEffect text={thinkingBuffer.slice(-60)} sx={{ width: '46%' }} />;
    
    // Add state for loading ideas
    const [isLoadingIdeas, setIsLoadingIdeas] = useState<boolean>(false);

    // Use the provided tableId and find additional available tables for multi-table operations
    const currentTable = tables.find(t => t.id === tableId);

    const availableTables = tables.filter(t => t.derive === undefined || t.anchored);
    const [additionalTableIds, setAdditionalTableIds] = useState<string[]>([]);

    // Combine the main tableId with additional selected tables
    const selectedTableIds = currentTable?.derive ? [...currentTable.derive.source, ...additionalTableIds] : [tableId, ...additionalTableIds];

    const handleTableSelectionChange = (newTableIds: string[]) => {
        // Filter out the main tableId since it's always included
        const additionalIds = newTableIds.filter(id => id !== tableId);
        setAdditionalTableIds(additionalIds);
    };

    // Function to get a question from the list with cycling
    const getQuestion = (): string => {
        return mode === "agent" ? "let's explore something interesting about the data" : "show something interesting about the data";
    };

    // Function to get ideas from the interactive explore agent
    const getIdeasFromAgent = async (mode: 'interactive' | 'agent', startQuestion?: string, autoRunFirstIdea: boolean = false) => {
        if (!currentTable || isLoadingIdeas) {
            return;
        }

        setIsLoadingIdeas(true);
        setThinkingBuffer("");
        if (mode === "agent") {
            setAgentIdeas([]);
        } else {
            setIdeas([]);
        }

        try {
            // Determine the root table and derived tables context
            let explorationThread: any[] = [];
            let sourceTables = selectedTableIds.map(id => tables.find(t => t.id === id) as DictTable);

            // If current table is derived, find the root table and build exploration thread
            if (currentTable.derive && !currentTable.anchored) {
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
                input_tables: sourceTables.map(t => ({
                    name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
                    rows: t.rows,
                    attached_metadata: t.attachedMetadata
                })),
                language: currentTable.virtual ? "sql" : "python",
                exploration_thread: explorationThread,
                agent_exploration_rules: agentRules.exploration
            });

            const engine = getUrls().GET_RECOMMENDATION_QUESTIONS;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.formulateTimeoutSeconds * 1000); 

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

            // Use streaming reader instead of response.json()
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body reader available');
            }

            const decoder = new TextDecoder();

            let lines: string[] = [];
            let buffer = '';

            let runNextIdea = autoRunFirstIdea;
            let updateState = (lines: string[]) => {
                let dataBlocks = lines
                    .map(line => {
                        try { return JSON.parse(line.trim()); } catch (e) { return null; }})
                    .filter(block => block != null);

                if (mode === "agent") {
                    let questions = dataBlocks.map(block => ({
                        breadth_questions: block.breadth_questions,
                        depth_questions: block.depth_questions,
                        goal: block.goal,
                        difficulty: block.difficulty,
                        focus: block.focus
                    }));
                    const newIdeas = questions.map((question: any) => ({
                        breadth_questions: question.breadth_questions,
                        depth_questions: question.depth_questions,
                        goal: question.goal,
                        difficulty: question.difficulty,
                        focus: question.focus
                    }));
                    if (runNextIdea) {
                        runNextIdea = false;
                        for (let i = 1; i < newIdeas[0].breadth_questions.length; i++) {
                            setTimeout(() => {
                                deriveDataFromNL(newIdeas[0].breadth_questions[i]);
                            }, i + 1 * 1000);
                        }
                        setTimeout(() => {
                            exploreDataFromNL(newIdeas[0].depth_questions);
                        }, newIdeas[0].breadth_questions.length + 1 * 1000);
                    }
                    setAgentIdeas(newIdeas);
                } else {
                    let questions = dataBlocks.map(block => ({
                        text: block.text,
                        goal: block.goal,
                        difficulty: block.difficulty,
                        tag: block.tag
                    }));
                    setIdeas(questions);
                }
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
            setThinkingBuffer("");
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
        } else if (event.key === 'Enter' && prompt.trim() !== "") {
            event.preventDefault();
            focusNextChartRef.current = true;
            if (mode === "agent") {
                exploreDataFromNLWithStartingQuestion(prompt.trim());
            } else {
                deriveDataFromNL(prompt.trim());
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
        dispatch(dfActions.updateAgentWorkInProgress({actionId: actionId, tableId: tableId, description: instruction, status: 'running', hidden: false}));

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
                rows: t.rows,
                attached_metadata: t.attachedMetadata
            })),
            
            chart_type: "",
            chart_encodings: {},

            extra_prompt: instruction,
            model: activeModel,
            max_repair_attempts: config.maxRepairAttempts,
            agent_coding_rules: agentRules.coding,
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
                    input_tables: actionTables.map(t => {
                        return { 
                            name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/ , ""), 
                            rows: t.rows, 
                            attached_metadata: t.attachedMetadata 
                        }}),
                    chart_type: "",
                    chart_encodings: {},

                    extra_prompt: instruction,
                    model: activeModel,
                    additional_messages: additionalMessages,
                    max_repair_attempts: config.maxRepairAttempts,
                    agent_coding_rules: agentRules.coding,
                    language: actionTables.some(t => t.virtual) ? "sql" : "python"
                });
                engine = getUrls().DERIVE_DATA;
            } else {
                messageBody = JSON.stringify({
                    token: token,
                    mode: 'formulate',
                    input_tables: actionTables.map(t => {
                        return { 
                            name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/ , ""), 
                            rows: t.rows, 
                            attached_metadata: t.attachedMetadata 
                        }}),
                        
                    chart_type: "",
                    chart_encodings: {},
                    
                    dialog: currentTable.derive?.dialog,
                    latest_data_sample: currentTable.rows.slice(0, 10),
                    new_instruction: instruction,
                    model: activeModel,
                    max_repair_attempts: config.maxRepairAttempts,
                    agent_coding_rules: agentRules.coding,
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
                        
                        let newChart = resolveRecommendedChart(refinedGoal, currentConcepts, candidateTable);

                        dispatch(dfActions.addChart(newChart));
                        // Create and focus the new chart directly
                        if (focusNextChartRef.current) {
                            focusNextChartRef.current = false;  // Immediate, synchronous update
                            dispatch(dfActions.setFocusedChart(newChart.id));
                            dispatch(dfActions.setFocusedTable(candidateTable.id));
                        }

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

    const exploreDataFromNLWithStartingQuestion = (startingQuestion: string) => {
        getIdeasFromAgent('agent', `starting question: ${startingQuestion}\n\n generate only one question group based on the starting question`, true);
    };

    const exploreDataFromNL = (initialPlan: string[]) => {

        let actionId = `exploreDataFromNL_${String(Date.now())}`;

        if (selectedTableIds.length === 0 || initialPlan.length === 0 || initialPlan[0].trim() === "") {
            return;
        }

        setIsFormulating(true);
        dispatch(dfActions.updateAgentWorkInProgress({actionId: actionId, tableId: tableId, description: initialPlan[0], status: 'running', hidden: false}));

        let actionTables = selectedTableIds.map(id => tables.find(t => t.id === id) as DictTable);

        const token = String(Date.now());
        let messageBody = JSON.stringify({
            token: token,
            input_tables: actionTables.map(t => ({
                name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
                rows: t.rows,
                attached_metadata: t.attachedMetadata
            })),
            initial_plan: initialPlan,
            model: activeModel,
            max_iterations: 3,
            max_repair_attempts: config.maxRepairAttempts,
            agent_exploration_rules: agentRules.exploration,
            agent_coding_rules: agentRules.coding,
            language: actionTables.some(t => t.virtual) ? "sql" : "python",
        });
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.formulateTimeoutSeconds * 6 * 1000);

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
                dispatch(dfActions.updateAgentWorkInProgress({actionId: actionId, description: result.content.message, status: 'running', hidden: false}));
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

                dispatch(dfActions.updateAgentWorkInProgress({actionId: actionId, tableId: candidateTable.id, description: '', status: 'running', hidden: false}));

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

                // Create trigger chart for derive info
                let triggerChart = generateFreshChart(actionTables[0].id, 'Auto') as Chart;
                triggerChart.source = 'trigger';

                // Update the derive trigger to reference the trigger chart
                if (candidateTable.derive) {
                    candidateTable.derive.trigger.chart = triggerChart;
                }

                // Resolve chart fields for regular chart if we have them
                if (refinedGoal) {
                    const currentConcepts = [...conceptShelfItems.filter(c => names.includes(c.name)), ...allNewConcepts, ...conceptsToAdd];
                    let newChart = resolveRecommendedChart(refinedGoal, currentConcepts, candidateTable);
                    createdCharts.push(newChart);

                    dispatch(dfActions.addChart(newChart));
                    if (focusNextChartRef.current) {
                        focusNextChartRef.current = false;  // Immediate, synchronous update
                        dispatch(dfActions.setFocusedChart(newChart.id));
                        dispatch(dfActions.setFocusedTable(candidateTable.id));
                    }
                }
                
                // Immediately add the new concepts, table, and chart to the state
                if (conceptsToAdd.length > 0) {
                    dispatch(dfActions.addConceptItems(conceptsToAdd));
                }

                dispatch(dfActions.insertDerivedTables(candidateTable));
                dispatch(fetchFieldSemanticType(candidateTable));
                dispatch(fetchCodeExpl(candidateTable));

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

            console.log('in completion state')

            setIsFormulating(false);
            clearTimeout(timeoutId);

            const completionResult = allResults.find((result: any) => result.type === "completion");

            console.log('completionResult', completionResult)
            if (completionResult) {
                // Get completion message from completion result if available
                let summary = completionResult.content.message || "";
                let status : "running" | "completed" | "warning" | "failed" = completionResult.status === "success" ? "completed" : "warning";

                dispatch(dfActions.updateAgentWorkInProgress({
                    actionId: actionId, description: summary, status: status, hidden: false
                }));

                let completionMessage = `Data exploration completed.`;

                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "success",
                    "value": completionMessage
                }));

                // Clear the prompt after successful exploration
                setPrompt("");
            } else {
                dispatch(dfActions.updateAgentWorkInProgress({actionId: actionId, description: "The agent got lost in the data.", status: 'warning', hidden: false}));

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
                                        
                                        // Clean up the inprogress thinking when streaming fails
                                        dispatch(dfActions.updateAgentWorkInProgress({actionId: actionId, description: data.error_message || "Error during data exploration", status: 'failed', hidden: false}));
                                        
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
            
            // Clean up the inprogress thinking when network errors occur
            const errorMessage = error.name === 'AbortError' ? "Data exploration timed out" : `Data exploration failed: ${error.message}`;
            dispatch(dfActions.updateAgentWorkInProgress({actionId: actionId, description: errorMessage, status: 'failed', hidden: false}));
            
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
                        color: mode === "interactive" ? modeColorMap['interactive'] : "text.secondary", 
                        backgroundColor: mode === "interactive" ? alpha(modeColorMap['interactive'], 0.08) : "transparent",
                        
                    }} onClick={() => {
                        setMode("interactive");
                    }}>
                        interactive
                    </Button>
                    <Button variant="text" value="agent" sx={{ 
                            color: mode === "agent" ? modeColorMap['agent'] : "text.secondary", 
                            backgroundColor: mode === "agent" ? alpha(modeColorMap['agent'], 0.08) : "transparent"
                        }} onClick={() => {
                            setMode("agent");
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
                borderColor: alpha(modeColor, 0.5),
                animation: mode === "agent" ? 'glowAgent 2s ease-in-out infinite alternate' : 'glowInteractive 2s ease-in-out infinite alternate',
                '@keyframes glowAgent': {
                    '0%': {
                        boxShadow: `0 0 5px 0 ${alpha(modeColorMap['agent'], 0.1)}`,
                    },
                    '100%': {
                        boxShadow: `0 0 10px 0 ${alpha(modeColorMap['agent'], 0.3)}, 0 0 10px 0 ${alpha(modeColorMap['agent'], 0.3)}`,
                    }
                },
                '@keyframes glowInteractive': {
                    '0%': {
                        boxShadow: `0 0 5px 0 ${alpha(modeColorMap['interactive'], 0.1)}`,
                    },
                    '100%': {
                        boxShadow: `0 0 10px 0 ${alpha(modeColorMap['interactive'], 0.3)}, 0 0 10px 0 ${alpha(modeColorMap['interactive'], 0.3)}`,
                    }
                }
            }}>
                {isFormulating && (
                    <LinearProgress 
                        sx={{ 
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            zIndex: 1000,
                            height: '4px',
                            backgroundColor: alpha(modeColor, 0.2),
                            '& .MuiLinearProgress-bar': {
                                backgroundColor: modeColor
                            }
                        }} 
                    />
                )}
                {showTableSelector && (
                    <Box>
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
                            "& .MuiInputLabel-root.Mui-focused": { 
                                color: modeColor
                            },
                            "& .MuiInput-input": { fontSize: '14px' },
                            "& .MuiInput-underline:before": {
                                borderBottomColor: alpha(modeColor, 0.42)
                            },
                            "& .MuiInput-underline:hover:not(.Mui-disabled):before": {
                                borderBottomColor: modeColor
                            },
                            "& .MuiInput-underline:after": {
                                borderBottomColor: modeColor
                            }
                        }}
                        disabled={isFormulating || isLoadingIdeas}
                        onChange={(event) => setPrompt(event.target.value)}
                        onKeyDown={handleKeyDown}
                        slotProps={{
                            inputLabel: { shrink: true },
                            input: {
                                endAdornment: <Tooltip title="Generate chart from description">
                                    <span>
                                        <IconButton 
                                            size="medium"
                                            disabled={isFormulating || isLoadingIdeas || !currentTable || prompt.trim() === ""}
                                            sx={{
                                                color: modeColor,
                                                '&:hover': {
                                                    backgroundColor: alpha(modeColor, 0.08)
                                                }
                                            }}
                                            onClick={() => { 
                                                focusNextChartRef.current = true;
                                                if (mode === "agent") {
                                                    exploreDataFromNLWithStartingQuestion(prompt.trim());
                                                } else {
                                                    deriveDataFromNL(prompt.trim());
                                                }
                                            }}
                                        >
                                            {isFormulating ? <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                                                <CircularProgress size={24} sx={{ color: modeColor }} />
                                            </Box> : mode === "agent" ? <MovingIcon sx={{transform: 'rotate(90deg)', fontSize: 24}} /> : <PrecisionManufacturing sx={{fontSize: 24}} />}
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
                    {<Divider orientation="vertical" flexItem />}
                    {<Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 0.5, my: 1}}>
                        <Typography sx={{ fontSize: 10, color: "text.secondary", marginBottom: 0.5 }}>
                            ideas?
                        </Typography>
                        <Tooltip title="Get some ideas!">   
                            <span>
                                <IconButton 
                                    size="medium"
                                    disabled={isFormulating || isLoadingIdeas || !currentTable}
                                    sx={{
                                        color: modeColor,
                                        '&:hover': {
                                            backgroundColor: alpha(modeColor, 0.08)
                                        }
                                    }}
                                    onClick={() => getIdeasFromAgent(mode)}
                                >
                                    {isLoadingIdeas ? <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                                        <CircularProgress size={24} sx={{ color: modeColor }} />
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
                {mode === 'interactive' && (ideas.length > 0 || thinkingBuffer) && (
                    <Box>
                       {ideas.length > 0 && ( <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, marginBottom: 1 }}>
                            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                                ideas
                            </Typography>
                        </Box>)}
                        <Box sx={{
                            display: 'flex', 
                            flexWrap: 'wrap', 
                            gap: 0.5,
                        }}>
                            {ideas.map((idea, index) => (
                                <IdeaChip
                                    mini
                                    key={index}
                                    idea={idea}
                                    theme={theme}
                                    onClick={() => {
                                        focusNextChartRef.current = true;
                                        setPrompt(idea.text);
                                        deriveDataFromNL(idea.text);
                                    }}
                                    disabled={isFormulating}
                                    sx={{
                                        width: '46%',
                                    }}
                                />
                            ))}
                            {isLoadingIdeas && thinkingBuffer && thinkingBufferEffect}
                        </Box>
                    </Box>
                )}
                {mode === 'agent' && (agentIdeas.length > 0 || thinkingBuffer) && (
                    <Box>
                        {agentIdeas.length > 0 && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, marginBottom: 1 }}>
                            <Typography sx={{ fontSize: 12, color: "text.secondary", ".MuiSvgIcon-root": { cursor: 'help', transform: 'rotate(90deg)', verticalAlign: 'middle', fontSize: 12} }}>
                                directions <Tooltip title="deep dive"><MovingIcon /></Tooltip>  <Tooltip title="branch"><CallSplitIcon /></Tooltip>
                            </Typography>
                        </Box>}
                        <Box sx={{
                            display: 'flex', 
                            flexWrap: 'wrap', 
                            gap: 0.5,
                            marginBottom: 1,
                        }}>
                            {agentIdeas.map((idea, index) => (
                                <AgentIdeaChip
                                    mini
                                    key={index}
                                    idea={idea}
                                    theme={theme}
                                    onClick={() => {
                                        focusNextChartRef.current = true;
                                        exploreDataFromNL(idea.depth_questions);
                                        idea.breadth_questions.forEach((question, index) => {
                                            setTimeout(() => {
                                                setPrompt(question);
                                                deriveDataFromNL(question);
                                            }, (index + 1) * 1000); // 1000ms delay between each call
                                        });
                                    }}
                                    disabled={isFormulating}
                                    sx={{
                                        width: '46%',
                                    }}
                                />
                            ))}
                            {isLoadingIdeas && thinkingBuffer && thinkingBufferEffect}
                        </Box>
                    </Box>
                )}
            </Card>
        </Box>
    );
};