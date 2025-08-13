// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { DataFormulatorState, dfActions, dfSelectors, fetchCodeExpl, fetchFieldSemanticType, generateFreshChart } from '../app/dfSlice';

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
} from '@mui/material';

import React from 'react';

import { Chart, FieldItem } from "../components/ComponentType";

import _ from 'lodash';

import '../scss/EncodingShelf.scss';
import { createDictTable, DictTable } from "../components/ComponentType";

import { getUrls, resolveChartFields, getTriggers } from '../app/utils';

import AddIcon from '@mui/icons-material/Add';

import { AppDispatch } from '../app/store';
import PrecisionManufacturing from '@mui/icons-material/PrecisionManufacturing';
import { Type } from '../data/types';
import CloseIcon from '@mui/icons-material/Close';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';

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
    idea: {text: string, goal: string, difficulty: 'easy' | 'medium' | 'hard'}, 
    theme: Theme, 
    onClick: () => void, 
    sx?: SxProps,
    disabled?: boolean
}> = function ({mini, idea, theme, onClick, sx, disabled}) {
    const getDifficultyColor = (difficulty: 'easy' | 'medium' | 'hard') => {
        switch (difficulty) {
            case 'easy':
                return 'success';
            case 'medium':
                return 'warning';
            case 'hard':
                return 'warning';
            default:
                return 'default';
        }
    };
    return (
        <Chip
            label={mini ? idea.goal : idea.text}
            size={mini ? "small" : "medium"}
            color={getDifficultyColor(idea.difficulty) as any}
            variant="outlined"
            sx={{
                fontSize: '11px',
                minHeight: '24px',
                height: 'auto',
                borderRadius: 2,
                '& .MuiChip-label': {
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    lineHeight: 1.1,
                    padding: '4px 8px'
                },
                ...sx
            }}
            onClick={onClick}
            disabled={disabled}
        />
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

    const [prompt, setPrompt] = useState<string>("");
    const [isFormulating, setIsFormulating] = useState<boolean>(false);
    const [ideas, setIdeas] = useState<{text: string, goal: string, difficulty: 'easy' | 'medium' | 'hard'}[]>(
        activeChallenges.find(ac => ac.tableId === tableId)?.challenges || []);
    
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

    // Function to handle challenge chip click
    const handleChallengeClick = (challengeText: string) => {
        setPrompt(challengeText);
        // Automatically start the data formulation process
        deriveDataFromNL(challengeText);
    };

    // Function to get a question from the list with cycling
    const getQuestion = (random: boolean = false): string => {
        if (currentTable?.explorativeQuestions && currentTable.explorativeQuestions.length > 0) {
            if (random) {
                const index = Math.floor(Math.random() * currentTable.explorativeQuestions.length);
                return currentTable.explorativeQuestions[index];
            } else {
                // Cycle through questions sequentially
                return currentTable.explorativeQuestions[currentQuestionIndex];
            }
        }
        return "Show something interesting about the data";
    };

    // Function to get ideas from the interactive explore agent
    const getIdeasFromAgent = async () => {
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
                    const newIdeas = result.content.exploration_questions.map((question: {text: string, goal: string, difficulty: 'easy' | 'medium' | 'hard'}) => ({
                        text: question.text,
                        goal: question.goal,
                        difficulty: question.difficulty
                    }));
                    setIdeas(newIdeas);
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

    // Effect to cycle through questions every 3 seconds
    useEffect(() => {
        if (!currentTable?.explorativeQuestions || currentTable.explorativeQuestions.length <= 1) {
            return;
        }

        const interval = setInterval(() => {
            setCurrentQuestionIndex((prevIndex) => 
                (prevIndex + 1) % currentTable.explorativeQuestions.length
            );
        }, 5000); // 5 seconds

        return () => clearInterval(interval);
    }, [currentTable?.explorativeQuestions]);

    useEffect(() => {
        let defaultIdeas = activeChallenges.find(ac => ac.tableId === tableId)?.challenges;
        setIdeas(defaultIdeas || []);
    }, [tableId]);

    // Handle tab key press for auto-completion
    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault();
            if (prompt.trim() === "") {
                setPrompt(getQuestion(false));
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
        } else {
            let newChart = generateFreshChart(tableId, "?") as Chart;
            dispatch(dfActions.addAndFocusChart(newChart));
            dispatch(dfActions.changeChartRunningStatus({chartId: newChart.id, status: true}));
            originateChartId = newChart.id;
        }

        const actionTables = selectedTableIds.map(id => tables.find(t => t.id === id) as DictTable);

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
        
        // Set formulating status without creating Auto chart
        setIsFormulating(true);

        const token = String(Date.now());
        const messageBody = JSON.stringify({
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

        if (process.env.NODE_ENV !== 'production') {
            console.debug("debug: messageBody", messageBody);
        }

        const engine = getUrls().DERIVE_DATA;
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

                        // Generate table ID
                        const genTableId = () => {
                            let tableSuffix = Number.parseInt((Date.now() - Math.floor(Math.random() * 10000)).toString().slice(-2));
                            let tableId = `table-${tableSuffix}`;
                            while (tables.find(t => t.id === tableId) !== undefined) {
                                tableSuffix = tableSuffix + 1;
                                tableId = `table-${tableSuffix}`;
                            }
                            return tableId;
                        };

                        const candidateTableId = candidate["content"]["virtual"] 
                            ? candidate["content"]["virtual"]["table_name"] 
                            : genTableId();

                        // Create new table
                        const candidateTable = createDictTable(
                            candidateTableId,
                            rows,
                            undefined // No derive info for ChartRecBox - it's NL-driven without triggers
                        );

                        let refChart = generateFreshChart(firstTableId, 'Auto') as Chart;
                        refChart.source = 'trigger';
                        
                        // Add derive info manually since ChartRecBox doesn't use triggers
                        candidateTable.derive = {
                            code: code,
                            source: selectedTableIds,
                            dialog: dialog,
                            trigger: {
                                tableId: firstTableId,
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
                        

                        console.log("refinedGoal", refinedGoal);

                        const chartType = chartTypeMap[refinedGoal?.['chart_type']] || 'Scatter Plot';
                        let newChart = generateFreshChart(candidateTable.id, chartType) as Chart;
                        newChart = resolveChartFields(newChart, currentConcepts, refinedGoal, candidateTable);

                        console.log("newChart", newChart);
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

                        dispatch(dfActions.deleteChartById(originateChartId));
                    }
                }
            } else {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder", 
                    "type": "error",
                    "value": "No result is returned from the data formulation agent. Please try again."
                }));
                
                setIsFormulating(false);
            }
        })
        .catch((error) => {
            setIsFormulating(false);

            console.log("error", error);
            
            if (error.name === 'AbortError') {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "error", 
                    "value": `Data formulation timed out after ${config.formulateTimeoutSeconds} seconds. Consider breaking down the task, using a different model or prompt, or increasing the timeout limit.`,
                    "detail": "Request exceeded timeout limit"
                }));
            } else {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "error",
                    "value": `Data formulation failed, please try again.`,
                    "detail": error.message
                }));
            }
        });
    };

    const showTableSelector = availableTables.length > 1 && currentTable;

    return (
        <Card variant='outlined' sx={{ 
            ...sx,
            padding: 2, 
            maxWidth: "600px", 
            display: 'flex', 
            flexDirection: 'column',
            gap: 1,
            position: 'relative'
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
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={handleKeyDown}
                    slotProps={{
                        inputLabel: { shrink: true },
                        input: {
                            endAdornment: <Tooltip title="Generate chart from description">
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
                            </Tooltip>
                        }
                    }}
                    value={prompt}
                    label="Describe what you want to visualize"
                    placeholder={`e.g., ${getQuestion(false)}`}
                    fullWidth
                    multiline
                    variant="standard"
                    maxRows={4}
                    minRows={1}
                />
                <Divider orientation="vertical" flexItem />
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 0.5, my: 1}}>
                    <Typography sx={{ fontSize: 10, color: "text.secondary", marginBottom: 0.5 }}>
                        ideas?
                    </Typography>
                    <Tooltip title="Get some ideas!">   
                        <IconButton 
                            size="medium"
                            disabled={isFormulating || !currentTable || isLoadingIdeas}
                            color="primary" 
                            onClick={getIdeasFromAgent}
                        >
                            {isLoadingIdeas ? <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                                <CircularProgress size={24} />
                            </Box> : <TipsAndUpdatesIcon sx={{fontSize: 24}} />}
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>
            {/* Challenge Chips Section */}
            {ideas.length > 0 && (
                <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, marginBottom: 1 }}>
                        <EmojiEventsIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                        <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                            Ideas
                        </Typography>
                    </Box>
                    <Box sx={{
                        display: 'flex', 
                        flexWrap: 'wrap', 
                        gap: 0.5,
                        marginBottom: 1
                    }}>
                        {ideas.map((challenge, index) => (
                            <IdeaChip
                                mini
                                key={index}
                                idea={challenge}
                                theme={theme}
                                onClick={() => handleChallengeClick(challenge.text)}
                                disabled={isFormulating}
                                sx={{
                                    width: '48%',
                                }}
                            />
                        ))}
                    </Box>
                </Box>
            )}
        </Card>
    );
};