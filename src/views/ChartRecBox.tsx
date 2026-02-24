// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState, useRef } from 'react'
import { transition } from '../app/tokens';
import { useSelector, useDispatch } from 'react-redux'
import { DataFormulatorState, dfActions, dfSelectors, fetchCodeExpl, fetchChartInsight, fetchFieldSemanticType, generateFreshChart } from '../app/dfSlice';

import { AppDispatch } from '../app/store';

import {
    Box,
    Typography,
    IconButton,
    Tooltip,
    TextField,
    Card,
    SxProps,
    LinearProgress,
    CircularProgress,
    Divider,
    alpha,
    useTheme,
    Theme,
} from '@mui/material';

import React from 'react';

import { Chart, FieldItem } from "../components/ComponentType";

import '../scss/EncodingShelf.scss';
import { createDictTable, DictTable } from "../components/ComponentType";

import { getUrls, getTriggers, resolveRecommendedChart, fetchWithIdentity } from '../app/utils';

import { AgentIcon as PrecisionManufacturing } from '../icons';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import { renderTextWithEmphasis } from './EncodingShelfCard';
import { ThinkingBufferEffect } from '../components/FunComponents';

// when this is set to true, the new chart will be focused automatically
const AUTO_FOCUS_NEW_CHART = false;

export interface ChartRecBoxProps {
    tableId: string;
    placeHolderChartId?: string;
    sx?: SxProps;
}

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
                transition: transition.fast,
                backgroundColor: alpha(theme.palette.background.paper, 0.9),
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                '&:hover': disabled ? 'none' : {
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

export const ChartRecBox: FC<ChartRecBoxProps> = function ({ tableId, placeHolderChartId, sx }) {
    const dispatch = useDispatch<AppDispatch>();
    const theme = useTheme();

    // reference to states
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const config = useSelector((state: DataFormulatorState) => state.config);
    const agentRules = useSelector((state: DataFormulatorState) => state.agentRules);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const activeModel = useSelector(dfSelectors.getActiveModel);

    const focusNextChartRef = useRef<boolean>(true);
    
    const modeColor = theme.palette.secondary.main;
    
    const [prompt, setPrompt] = useState<string>("");
    const [isFormulating, setIsFormulating] = useState<boolean>(false);
    const [ideas, setIdeas] = useState<{text: string, goal: string, difficulty: 'easy' | 'medium' | 'hard'}[]>([]);

    const [thinkingBuffer, setThinkingBuffer] = useState<string>("");

    let thinkingBufferEffect = <ThinkingBufferEffect text={thinkingBuffer.slice(-60)} sx={{ width: '46%' }} />;
    
    // Add state for loading ideas
    const [isLoadingIdeas, setIsLoadingIdeas] = useState<boolean>(false);

    // Use the provided tableId and find additional available tables for multi-table operations
    const currentTable = tables.find(t => t.id === tableId);

    // All root/anchored tables, with current source tables ordered first for context priority
    const rootTables = tables.filter(t => t.derive === undefined || t.anchored);
    const priorityIds = (currentTable?.derive && !currentTable.anchored)
        ? currentTable.derive.source
        : [tableId];
    let selectedTableIds = [
        ...priorityIds.filter(id => rootTables.some(t => t.id === id)),
        ...rootTables.map(t => t.id).filter(id => !priorityIds.includes(id))
    ];
    
    // Function to get a question from the list with cycling
    const getQuestion = (): string => {
        return "show something interesting about the data";
    };

    // Function to get ideas from the interactive explore agent
    const getIdeasFromAgent = async (startQuestion?: string) => {
        if (!currentTable || isLoadingIdeas) {
            return;
        }

        setIsLoadingIdeas(true);
        setThinkingBuffer("");
        setIdeas([]);

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
                        description: `Derive from ${tables.find(t2 => t2.id === trigger.resultTableId)?.derive?.source} with instruction: ${trigger.instruction}`,
                    }));
            }

            const messageBody = JSON.stringify({
                token: String(Date.now()),
                model: activeModel,
                start_question: startQuestion,
                mode: 'interactive',
                input_tables: sourceTables.map(t => ({
                    name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
                    rows: t.rows,
                    attached_metadata: t.attachedMetadata
                })),
                exploration_thread: explorationThread,
                agent_exploration_rules: agentRules.exploration
            });

            const engine = getUrls().GET_RECOMMENDATION_QUESTIONS;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.formulateTimeoutSeconds * 1000); 

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

                let questions = dataBlocks.map(block => ({
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
        setIdeas([]);
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
            deriveDataFromNL(prompt.trim());
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
        dispatch(dfActions.updateAgentWorkInProgress({actionId: actionId, tableId: tableId, description: instruction, status: 'running', hidden: false,
            message: { content: instruction, role: 'user', sourceTable: tableId }}));

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

            extra_prompt: instruction,
            model: activeModel,
            agent_coding_rules: agentRules.coding
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

                    extra_prompt: instruction,
                    model: activeModel,
                    additional_messages: additionalMessages,
                    agent_coding_rules: agentRules.coding
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
                    
                    dialog: currentTable.derive?.dialog,
                    latest_data_sample: currentTable.rows.slice(0, 10),
                    new_instruction: instruction,
                    model: activeModel,
                    agent_coding_rules: agentRules.coding
                })
                engine = getUrls().REFINE_DATA;
            } 
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.formulateTimeoutSeconds * 1000);

        fetchWithIdentity(engine, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: messageBody,
            signal: controller.signal
        })
        .then((response) => {
            if (!response.ok) {
                return response.text().then(text => {
                    try {
                        const errorData = JSON.parse(text);
                        throw new Error(errorData.error_message || errorData.error || `Server error (${response.status})`);
                    } catch (parseError) {
                        if (parseError instanceof SyntaxError) {
                            throw new Error(`Server error (${response.status}): The server returned an unexpected response.`);
                        }
                        throw parseError;
                    }
                });
            }
            return response.json();
        })
        .then((data) => {
            setIsFormulating(false);

            dispatch(dfActions.changeChartRunningStatus({chartId: originateChartId, status: false}));

            if (data.status === "error" && data.error_message) {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "error",
                    "value": `Data formulation failed: ${data.error_message}`,
                }));
                dispatch(dfActions.deleteAgentWorkInProgress(actionId));
            } else if (data.results && data.results.length > 0) {
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
                            outputVariable: refinedGoal['output_variable'] || 'result_df',
                            source: selectedTableIds,
                            dialog: dialog,
                            trigger: {
                                tableId: tableId,
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
                            source: "custom",
                            tableRef: "custom",
                        } as FieldItem));

                        dispatch(dfActions.addConceptItems(conceptsToAdd));
                        dispatch(fetchFieldSemanticType(candidateTable));
                        dispatch(fetchCodeExpl(candidateTable));

                        // Create proper chart based on refined goal
                        const currentConcepts = [...conceptShelfItems.filter(c => names.includes(c.name)), ...conceptsToAdd];
                        
                        let newChart = resolveRecommendedChart(refinedGoal, currentConcepts, candidateTable);

                        dispatch(dfActions.addChart(newChart));
                        // Create and focus the new chart directly
                        if (focusNextChartRef.current || AUTO_FOCUS_NEW_CHART) {
                            focusNextChartRef.current = false;  // Immediate, synchronous update
                            dispatch(dfActions.setFocused({ type: 'chart', chartId: newChart.id }));
                        }

                        // Auto-generate chart insight after rendering
                        setTimeout(() => {
                            dispatch(fetchChartInsight({ chartId: newChart.id, tableId: candidateTable.id }) as any);
                        }, 1500);

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

    return (
        <Box sx={{ maxWidth: "600px", display: 'flex', flexDirection: 'column', ...sx }}>
            <Card variant='outlined' sx={{ 
                px: 2, 
                display: 'flex', 
                flexDirection: 'column',
                gap: 1,
                position: 'relative',
                borderWidth: 1.5,
                borderColor: alpha(modeColor, 0.8),
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
                <Box sx={{ display: 'flex', flexDirection: 'row', gap: 1, alignItems: 'flex-end' }}>
                    <TextField
                        variant="standard"
                        sx={{
                            flex: 1,
                            "& .MuiInputLabel-root": { fontSize: '14px' },
                            "& .MuiInputLabel-root.Mui-focused": { 
                                color: modeColor
                            },
                            "& .MuiInput-input": { fontSize: '14px' },
                            "& .MuiInput-underline:before": {
                                borderBottom: 'none',
                            },
                            "& .MuiInput-underline:hover:not(.Mui-disabled):before": {
                                borderBottom: 'none',
                            },
                            "& .MuiInput-underline:not(.Mui-disabled):before": {
                                borderBottom: 'none',
                            },
                            "& .MuiInput-underline.Mui-disabled:before": {
                                borderBottom: 'none',
                            },
                            "& .MuiInput-underline.Mui-disabled:after": {
                                borderBottom: 'none',
                            },
                            "& .MuiInput-underline:after": {
                                borderBottom: 'none',
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
                                                deriveDataFromNL(prompt.trim());
                                            }}
                                        >
                                            {isFormulating ? <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                                                <CircularProgress size={24} sx={{ color: modeColor }} />
                                            </Box> : <PrecisionManufacturing sx={{fontSize: 24}} />}
                                        </IconButton>
                                    </span>
                                </Tooltip>
                            }
                        }}
                        value={prompt}
                        placeholder={`${getQuestion()}`}
                        fullWidth
                        multiline
                        maxRows={4}
                        minRows={2}
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
                                    onClick={() => getIdeasFromAgent()}
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
            </Card>
            {(ideas.length > 0 || thinkingBuffer) && (
                <Box sx={{
                    display: 'flex', 
                    flexWrap: 'wrap', 
                    gap: 0.5,
                    py: 1,
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
                                width: 'calc(50% - 16px)',
                            }}
                        />
                    ))}
                    {isLoadingIdeas && thinkingBuffer && thinkingBufferEffect}
                </Box>
            )}
        </Box>
    );
};