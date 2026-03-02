// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState, useRef } from 'react'
import { transition } from '../app/tokens';
import { useSelector, useDispatch } from 'react-redux'
import { DataFormulatorState, dfActions, generateFreshChart } from '../app/dfSlice';

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
    alpha,
    useTheme,
    Theme,
} from '@mui/material';

import React from 'react';

import { Chart } from "../components/ComponentType";

import '../scss/EncodingShelf.scss';

import { resolveRecommendedChart } from '../app/utils';
import { useFormulateData } from '../app/useFormulateData';

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
    const { streamIdeas, formulateData } = useFormulateData();

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
        if (!currentTable || isLoadingIdeas) return;

        await streamIdeas({
            actionTableIds: selectedTableIds,
            currentTable,
            onIdeas: setIdeas,
            onThinkingBuffer: setThinkingBuffer,
            onLoadingChange: setIsLoadingIdeas,
            startQuestion,
        });
        setThinkingBuffer("");
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

        if (placeHolderChartId) {
            dispatch(dfActions.changeChartRunningStatus({chartId: placeHolderChartId, status: true}));
        }

        const actionId = `deriveDataFromNL_${String(Date.now())}`;
        dispatch(dfActions.updateAgentWorkInProgress({actionId: actionId, originTableId: tableId, description: instruction, status: 'running', hidden: false,
            message: { content: instruction, role: 'user', observeTableId: tableId }}));

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

        let refChart = generateFreshChart(tableId, 'Auto') as Chart;
        refChart.source = 'trigger';

        formulateData({
            instruction,
            mode: 'formulate',
            actionTableIds: selectedTableIds,
            currentTable: currentTable!,
            triggerChart: refChart,
            createChart: ({ candidateTable, refinedGoal, currentConcepts }) => {
                let newChart = resolveRecommendedChart(refinedGoal, currentConcepts, candidateTable);
                dispatch(dfActions.addChart(newChart));
                if (focusNextChartRef.current || AUTO_FOCUS_NEW_CHART) {
                    focusNextChartRef.current = false;
                    dispatch(dfActions.setFocused({ type: 'chart', chartId: newChart.id }));
                }
                return newChart.id;
            },
            onStarted: () => {
                setIsFormulating(true);
            },
            onSuccess: ({ displayInstruction, candidateTable }) => {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "success",
                    "value": `Data formulation: "${displayInstruction}"`
                }));
                dispatch(dfActions.updateAgentWorkInProgress({
                    actionId, description: displayInstruction || instruction, status: 'completed', hidden: false,
                    message: { content: displayInstruction || instruction, role: 'action', resultTableId: candidateTable.id }
                }));
                setPrompt("");
            },
            onError: () => {
                dispatch(dfActions.updateAgentWorkInProgress({
                    actionId, description: instruction, status: 'failed', hidden: false,
                    message: { content: 'Data formulation failed.', role: 'error' }
                }));
            },
            onFinally: () => {
                setIsFormulating(false);
                if (placeHolderChartId) {
                    dispatch(dfActions.changeChartRunningStatus({chartId: placeHolderChartId, status: false}));
                }
            },
        });
    };

    return (
        <Box sx={{ maxWidth: "600px", display: 'flex', flexDirection: 'column', ...sx }}>
            <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}>
            <Card variant='outlined' sx={{ 
                flex: 1,
                px: 1, 
                pt: 0.5,
                pb: 0.25,
                display: 'flex', 
                flexDirection: 'column',
                gap: 0.5,
                position: 'relative',
                borderWidth: 1.5,
                borderColor: alpha(theme.palette.text.primary, 0.15),
                borderRadius: '8px',
                overflow: 'visible',
                transition: transition.fast,
                '&:hover': {
                    borderColor: alpha(theme.palette.primary.main, 0.7),
                },
                '&:focus-within': {
                    borderColor: alpha(theme.palette.primary.main, 0.8),
                },
            }}>
                {isFormulating && (
                    <LinearProgress 
                        sx={{ 
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            zIndex: 1000,
                            height: '2px',
                            borderRadius: '0 0 8px 8px',
                            backgroundColor: alpha(modeColor, 0.15),
                            '& .MuiLinearProgress-bar': {
                                backgroundColor: modeColor
                            }
                        }} 
                    />
                )}
                <Box sx={{ display: 'flex', flexDirection: 'row', gap: 0.5, alignItems: 'flex-end' }}>
                    <TextField
                        variant="standard"
                        sx={{
                            flex: 1,
                            "& .MuiInput-input": { fontSize: '14px', lineHeight: 1.5 },
                            "& .MuiInput-underline:before": { borderBottom: 'none' },
                            "& .MuiInput-underline:hover:not(.Mui-disabled):before": { borderBottom: 'none' },
                            "& .MuiInput-underline:not(.Mui-disabled):before": { borderBottom: 'none' },
                            "& .MuiInput-underline.Mui-disabled:before": { borderBottom: 'none' },
                            "& .MuiInput-underline.Mui-disabled:after": { borderBottom: 'none' },
                            "& .MuiInput-underline:after": { borderBottom: 'none' },
                        }}
                        disabled={isFormulating || isLoadingIdeas}
                        onChange={(event) => setPrompt(event.target.value)}
                        onKeyDown={handleKeyDown}
                        slotProps={{
                            inputLabel: { shrink: true },
                            input: {
                                endAdornment: <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                                    <Tooltip title="Generate chart from description">
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
                                </Box>
                            }
                        }}
                        value={prompt}
                        placeholder={`${getQuestion()}`}
                        fullWidth
                        multiline
                        maxRows={4}
                        minRows={1}
                    />
                </Box>
            </Card>
            <Tooltip title={ideas.length > 0 ? "Refresh ideas" : "Get ideas"}>
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
                        {isLoadingIdeas ? 
                            <CircularProgress size={24} sx={{ color: modeColor }} />
                            : <TipsAndUpdatesIcon sx={{
                                fontSize: 24,
                                animation: ideas.length == 0 ? 'colorWipe 5s ease-in-out infinite' : 'none',
                                '@keyframes colorWipe': {
                                    '0%, 90%': { scale: 1 },
                                    '95%': { scale: 1.2 },
                                    '100%': { scale: 1 },
                                },
                            }} />}
                    </IconButton>
                </span>
            </Tooltip>
            </Box>
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