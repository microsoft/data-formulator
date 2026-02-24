// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useCallback, useRef, useEffect } from 'react';

import {
    Box,
    IconButton,
    Tooltip,
    Typography,
    useTheme,
    TextField,
    CircularProgress,
    Card,
    ClickAwayListener,
    LinearProgress,
    Button,
} from '@mui/material';

import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors, fetchCodeExpl, fetchFieldSemanticType, fetchChartInsight, generateFreshChart } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { resolveRecommendedChart, getUrls, fetchWithIdentity, getTriggers } from '../app/utils';
import { Chart, DictTable, FieldItem, createDictTable } from "../components/ComponentType";

import { alpha } from '@mui/material/styles';
import SendIcon from '@mui/icons-material/Send';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import TableRowsOutlinedIcon from '@mui/icons-material/TableRowsOutlined';

import RefreshIcon from '@mui/icons-material/Refresh';
import ClearIcon from '@mui/icons-material/Clear';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { renderTextWithEmphasis } from './EncodingShelfCard';
import { UnifiedDataUploadDialog } from './UnifiedDataUploadDialog';
import { ThinkingBufferEffect } from '../components/FunComponents';
import { Theme } from '@mui/material/styles';

const AgentWorkingOverlay: FC<{ relevantAgentActions: any[]; theme: Theme; onCancel?: () => void }> = ({ relevantAgentActions, theme, onCancel }) => {
    const runningAction = relevantAgentActions.find(a => a.status === 'running');
    const latestMessage = runningAction?.description || 'thinking...';
    return (
        <Box sx={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: alpha(theme.palette.background.paper, 0.88),
            backdropFilter: 'blur(3px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.5,
            zIndex: 2,
            borderRadius: 'inherit',
            px: 2,
            overflow: 'hidden',
        }}>
            <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}>
                <Typography sx={{
                    fontSize: 10,
                    animation: 'agentWriting 1.2s ease-in-out infinite',
                    '@keyframes agentWriting': {
                        '0%, 100%': { transform: 'rotate(-15deg) translate(0, 0)' },
                        '25%': { transform: 'rotate(-8deg) translate(2px, 1px)' },
                        '50%': { transform: 'rotate(-15deg) translate(0, 0)' },
                        '75%': { transform: 'rotate(-20deg) translate(-2px, 1px)' },
                    },
                    transformOrigin: 'bottom right',
                }}>
                    ✏️
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, fontSize: 10 }}>
                    Agent is working...
                </Typography>
            </Box>
            {onCancel && (
                <IconButton
                    size="small"
                    onClick={onCancel}
                    sx={{ position: 'absolute', bottom: 6, right: 6, p: 1.5, width: 16, height: 16, color: theme.palette.warning.main }}
                >
                    <StopCircleOutlinedIcon sx={{ fontSize: 14 }} />
                </IconButton>
            )}
            <Typography variant="caption" sx={{
                color: 'text.disabled',
                fontSize: 10,
                textAlign: 'center',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                lineHeight: 1.3,
                wordBreak: 'break-word',
            }}>
                {latestMessage}
            </Typography>
            <LinearProgress sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, borderRadius: '0 0 8px 8px' }} />
        </Box>
    );
};

export const SimpleChartRecBox: FC<{ onExpandedChange?: (expanded: boolean) => void }> = function ({ onExpandedChange }) {

    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const charts = useSelector(dfSelectors.getAllCharts);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const config = useSelector((state: DataFormulatorState) => state.config);
    const agentRules = useSelector((state: DataFormulatorState) => state.agentRules);
    const activeModel = useSelector(dfSelectors.getActiveModel);
    const agentActions = useSelector((state: DataFormulatorState) => state.agentActions);

    const theme = useTheme();
    const dispatch = useDispatch<AppDispatch>();

    const [chatPrompt, setChatPrompt] = useState("");
    const [isChatFormulating, setIsChatFormulating] = useState(false);
    const [expanded, setExpandedRaw] = useState(false);
    const setExpanded = useCallback((v: boolean) => { setExpandedRaw(v); onExpandedChange?.(v || isChatFormulating); }, [onExpandedChange, isChatFormulating]);
    const [ideas, setIdeas] = useState<{text: string, goal: string, difficulty: 'easy' | 'medium' | 'hard'}[]>([]);
    const [isLoadingIdeas, setIsLoadingIdeas] = useState(false);
    const [thinkingBuffer, setThinkingBuffer] = useState('');
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const [panelHeight, setPanelHeight] = useState(180);
    const [isDragging, setIsDragging] = useState(false);
    const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
    const agentAbortRef = useRef<AbortController | null>(null);
    const ideasAbortRef = useRef<AbortController | null>(null);

    // Notify parent when formulating state changes
    useEffect(() => {
        onExpandedChange?.(expanded || isChatFormulating);
    }, [isChatFormulating]);

    const inputCardRef = useRef<HTMLDivElement>(null);
    const threadScrollRef = useRef<HTMLDivElement>(null);
    const [inputCardHeight, setInputCardHeight] = useState(0);

    // Track input card height so the dialog panel sits above it
    useEffect(() => {
        const el = inputCardRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // total height including margin: element height + mb(1)=8 + mt(0.5)=4
                setInputCardHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const focusedTableId = useCallback(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        const chartId = focusedId.chartId;
        const chart = charts.find(c => c.id === chartId);
        return chart?.tableRef;
    }, [focusedId, charts])();

    // Clear ideas when focused table changes — ideas are scoped per table
    useEffect(() => {
        setIdeas([]);
        setIsLoadingIdeas(false);
    }, [focusedTableId]);

    // Root tables and priority ordering for API calls
    const rootTables = tables.filter(t => t.derive === undefined || t.anchored);
    const currentTable = tables.find(t => t.id === focusedTableId);
    const priorityIds = (currentTable?.derive && !currentTable.anchored)
        ? currentTable.derive.source
        : focusedTableId ? [focusedTableId] : [];
    const selectedTableIds = [
        ...priorityIds.filter(id => rootTables.some(t => t.id === id)),
        ...rootTables.map(t => t.id).filter(id => !priorityIds.includes(id))
    ];

    // Collect table IDs from root up to (and including) the focused table for agent action matching
    const threadTableIds = React.useMemo(() => {
        if (!focusedTableId) return new Set<string>();
        const ids = new Set<string>();

        // Walk up from focused table to root — only ancestors, not descendants
        let current = tables.find(t => t.id === focusedTableId);
        while (current) {
            ids.add(current.id);
            if (current.derive && !current.anchored && current.derive.trigger) {
                const parentId = current.derive.trigger.tableId;
                if (ids.has(parentId)) break;
                current = tables.find(t => t.id === parentId);
            } else {
                break;
            }
        }

        return ids;
    }, [focusedTableId, tables]);

    // Agent actions relevant to all tables in this thread, sorted by creation time
    const relevantAgentActions = React.useMemo(() => {
        if (threadTableIds.size === 0) return [];
        return agentActions
            .filter(a => threadTableIds.has(a.tableId) && !a.hidden)
            .sort((a, b) => (a.messages?.[0]?.timestamp || a.lastUpdate) - (b.messages?.[0]?.timestamp || b.lastUpdate));
    }, [agentActions, threadTableIds]);

    // Flatten all messages from all relevant agent actions for display,
    // expanding sourceTable/resultTable into separate timeline items
    type ThreadItem = { content: string; role: 'user' | 'thinking' | 'completion' | 'error' | 'clarify' | 'source-table' | 'result-table'; timestamp: number; actionId: string; isRunning: boolean };
    const allThreadMessages = React.useMemo((): ThreadItem[] => {
        const items: ThreadItem[] = [];
        for (const action of relevantAgentActions) {
            if (action.messages && action.messages.length > 0) {
                for (const m of action.messages) {
                    // Insert source-table item only for the very first action in the thread
                    if (m.sourceTable && items.length === 0) {
                        items.push({ content: m.sourceTable, role: 'source-table', timestamp: m.timestamp, actionId: action.actionId, isRunning: false });
                    }
                    // The message itself
                    items.push({ content: m.content, role: m.role, timestamp: m.timestamp, actionId: action.actionId, isRunning: false });
                    // Insert result-table item after thinking message
                    if (m.resultTable) {
                        items.push({ content: m.resultTable, role: 'result-table', timestamp: m.timestamp, actionId: action.actionId, isRunning: false });
                    }
                }
            }
            // If it's currently running and the description isn't already in messages, show live status
            if (action.status === 'running') {
                const lastMsg = action.messages?.[action.messages.length - 1];
                if (!lastMsg || lastMsg.content !== action.description) {
                    items.push({ content: action.description || 'thinking...', role: 'thinking', timestamp: action.lastUpdate, actionId: action.actionId, isRunning: true });
                }
            }
        }
        return items;
    }, [relevantAgentActions]);

    const hasRunningAgent = relevantAgentActions.some(a => a.status === 'running');
    const hasThreadContent = allThreadMessages.length > 0;

    // Auto-scroll thread panel to bottom when new messages arrive
    useEffect(() => {
        if (threadScrollRef.current && allThreadMessages.length > 0) {
            threadScrollRef.current.scrollTop = threadScrollRef.current.scrollHeight;
        }
    }, [allThreadMessages.length]);

    const getIdeasFromAgent = useCallback(async () => {
        if (!currentTable || isLoadingIdeas) return;
        setIsLoadingIdeas(true);
        setIdeas([]);
        setThinkingBuffer('');
        setExpanded(true);

        try {
            let explorationThread: any[] = [];
            const sourceTables = selectedTableIds.map(id => tables.find(t => t.id === id) as DictTable);

            if (currentTable.derive && !currentTable.anchored) {
                const triggers = getTriggers(currentTable, tables);
                explorationThread = triggers.map(trigger => ({
                    name: trigger.resultTableId,
                    rows: tables.find(t2 => t2.id === trigger.resultTableId)?.rows,
                    description: `Derive from ${tables.find(t2 => t2.id === trigger.resultTableId)?.derive?.source} with instruction: ${trigger.instruction}`,
                }));
            }

            const messageBody = JSON.stringify({
                token: String(Date.now()),
                model: activeModel,
                mode: 'interactive',
                input_tables: sourceTables.map(t => ({
                    name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
                    rows: t.rows,
                    attached_metadata: t.attachedMetadata
                })),
                exploration_thread: explorationThread,
                agent_exploration_rules: agentRules.exploration
            });

            const controller = new AbortController();
            ideasAbortRef.current = controller;
            const timeoutId = setTimeout(() => controller.abort(), config.formulateTimeoutSeconds * 1000);

            const response = await fetchWithIdentity(getUrls().GET_RECOMMENDATION_QUESTIONS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: messageBody,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body reader available');

            const decoder = new TextDecoder();
            let buffer = '';
            let lines: string[] = [];

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const newLines = buffer.split('data: ').filter(l => l.trim() !== '');
                    buffer = newLines.pop() || '';
                    if (newLines.length > 0) {
                        lines.push(...newLines);
                        const parsed = lines
                            .map(l => { try { return JSON.parse(l.trim()); } catch { return null; } })
                            .filter(Boolean)
                            .map(b => ({ text: b.text, goal: b.goal, difficulty: b.difficulty }));
                        setIdeas(parsed);
                    }
                    setThinkingBuffer(buffer.replace(/^data: /, ''));
                }
            } finally {
                reader.releaseLock();
            }
            lines.push(buffer);
            const finalIdeas = lines
                .map(l => { try { return JSON.parse(l.trim()); } catch { return null; } })
                .filter(Boolean)
                .map(b => ({ text: b.text, goal: b.goal, difficulty: b.difficulty }));
            setIdeas(finalIdeas);
        } catch (error) {
            console.error('Error getting ideas:', error);
        } finally {
            setIsLoadingIdeas(false);
            setThinkingBuffer('');
            ideasAbortRef.current = null;
        }
    }, [currentTable, isLoadingIdeas, selectedTableIds, tables, activeModel, agentRules, config, dispatch]);

    const exploreFromChat = useCallback((prompt: string) => {
        if (!focusedTableId || prompt.trim() === "") return;

        const rootTables = tables.filter(t => t.derive === undefined || t.anchored);
        const currentTable = tables.find(t => t.id === focusedTableId);
        const priorityIds = (currentTable?.derive && !currentTable.anchored)
            ? currentTable.derive.source
            : [focusedTableId];
        const selectedTableIds = [
            ...priorityIds.filter(id => rootTables.some(t => t.id === id)),
            ...rootTables.map(t => t.id).filter(id => !priorityIds.includes(id))
        ];
        if (selectedTableIds.length === 0) return;

        const actionId = `exploreDataFromNL_${String(Date.now())}`;
        const actionTables = selectedTableIds.map(id => tables.find(t => t.id === id) as DictTable);

        setIsChatFormulating(true);
        // User instruction with source table context
        const sourceTableName = currentTable?.id || focusedTableId;
        dispatch(dfActions.updateAgentWorkInProgress({ actionId, tableId: focusedTableId, description: prompt, status: 'running', hidden: false,
            message: { content: prompt, role: 'user', sourceTable: sourceTableName } }));

        // Build exploration thread from derivation chain for API context
        let explorationThread: any[] = [];
        if (currentTable?.derive && !currentTable.anchored) {
            const triggers = getTriggers(currentTable, tables);
            explorationThread = triggers.map(trigger => ({
                name: trigger.resultTableId,
                rows: tables.find(t2 => t2.id === trigger.resultTableId)?.rows,
                description: `Derive from ${tables.find(t2 => t2.id === trigger.resultTableId)?.derive?.source} with instruction: ${trigger.instruction}`,
            }));
        }

        // Collect previous conversation messages for context
        const conversationHistory: { role: string; content: string }[] = [];
        for (const action of relevantAgentActions) {
            if (action.messages) {
                for (const m of action.messages) {
                    if (m.role === 'user') {
                        conversationHistory.push({ role: 'user', content: m.content });
                    } else if (m.role === 'thinking' || m.role === 'completion') {
                        conversationHistory.push({ role: 'assistant', content: m.content });
                    }
                }
            }
        }

        const token = String(Date.now());
        const messageBody = JSON.stringify({
            token,
            input_tables: actionTables.map(t => ({
                name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
                rows: t.rows,
                attached_metadata: t.attachedMetadata
            })),
            initial_plan: [prompt],
            exploration_thread: explorationThread.length > 0 ? explorationThread : undefined,
            conversation_history: conversationHistory.length > 0 ? conversationHistory : undefined,
            model: activeModel,
            max_iterations: 3,
            agent_exploration_rules: agentRules.exploration,
            agent_coding_rules: agentRules.coding
        });

        const controller = new AbortController();
        agentAbortRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), config.formulateTimeoutSeconds * 6 * 1000);

        let allResults: any[] = [];
        let createdTables: DictTable[] = [];
        let createdCharts: Chart[] = [];
        let allNewConcepts: FieldItem[] = [];
        let isCompleted = false;

        const genTableId = () => {
            let tableSuffix = Number.parseInt((Date.now() - Math.floor(Math.random() * 10000)).toString().slice(-6));
            let tId = `table-${tableSuffix}`;
            while (tables.find(t => t.id === tId) !== undefined) {
                tableSuffix += 1;
                tId = `table-${tableSuffix}`;
            }
            return tId;
        };

        const processStreamingResult = (result: any) => {
            if (result.type === "planning") {
                dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: result.content.message, status: 'running', hidden: false,
                    message: { content: result.content.message, role: 'thinking' } }));
            }
            if (result.type === "data_transformation" && result.status === "success") {
                const transformResult = result.content.result;
                if (!transformResult || transformResult.status !== 'ok') return;

                const transformedData = transformResult.content;
                const code = transformResult.code;
                const dialog = transformResult.dialog;
                const refinedGoal = transformResult.refined_goal;
                const question = result.content.question;
                if (!transformedData || !transformedData.rows || transformedData.rows.length === 0) return;

                const rows = transformedData.rows;
                const candidateTableId = transformedData.virtual?.table_name || genTableId();
                const displayInstruction = refinedGoal?.display_instruction || `Exploration step ${createdTables.length + 1}: ${question}`;

                const isFirstIteration = createdTables.length === 0;
                const triggerTableId = isFirstIteration ? focusedTableId! : createdTables[createdTables.length - 1].id;

                const candidateTable = createDictTable(candidateTableId, rows, undefined);
                candidateTable.derive = {
                    code: code || `# Exploration step ${createdTables.length + 1}`,
                    outputVariable: refinedGoal?.output_variable || 'result_df',
                    source: selectedTableIds,
                    dialog: dialog || [],
                    trigger: {
                        tableId: triggerTableId,
                        instruction: question,
                        displayInstruction,
                        chart: undefined,
                        resultTableId: candidateTableId
                    }
                };
                if (transformedData.virtual) {
                    candidateTable.virtual = { tableId: transformedData.virtual.table_name, rowCount: transformedData.virtual.row_count };
                }
                createdTables.push(candidateTable);
                // Agent's generated instruction with result table
                dispatch(dfActions.updateAgentWorkInProgress({ actionId, tableId: candidateTable.id, description: displayInstruction, status: 'running', hidden: false,
                    message: { content: displayInstruction, role: 'thinking', resultTable: candidateTableId } }));

                const names = candidateTable.names;
                const missingNames = names.filter(name =>
                    !conceptShelfItems.some(field => field.name === name) &&
                    !allNewConcepts.some(concept => concept.name === name)
                );
                const conceptsToAdd = missingNames.map(name => ({
                    id: `concept-${name}-${Date.now()}-${Math.random()}`,
                    name,
                    source: "custom",
                    tableRef: "custom",
                } as FieldItem));
                allNewConcepts.push(...conceptsToAdd);

                let triggerChart = generateFreshChart(actionTables[0].id, 'Auto') as Chart;
                triggerChart.source = 'trigger';
                if (candidateTable.derive?.trigger) {
                    candidateTable.derive.trigger.chart = triggerChart;
                }

                if (refinedGoal) {
                    const currentConcepts = [...conceptShelfItems.filter(c => names.includes(c.name)), ...allNewConcepts, ...conceptsToAdd];
                    let newChart = resolveRecommendedChart(refinedGoal, currentConcepts, candidateTable);
                    createdCharts.push(newChart);
                    dispatch(dfActions.addChart(newChart));
                    dispatch(dfActions.setFocused({ type: 'chart', chartId: newChart.id }));
                }

                if (conceptsToAdd.length > 0) {
                    dispatch(dfActions.addConceptItems(conceptsToAdd));
                }
                dispatch(dfActions.insertDerivedTables(candidateTable));
                dispatch(fetchFieldSemanticType(candidateTable));
                dispatch(fetchCodeExpl(candidateTable));

                if (createdCharts.length > 0) {
                    const lastChart = createdCharts[createdCharts.length - 1];
                    setTimeout(() => {
                        dispatch(fetchChartInsight({ chartId: lastChart.id, tableId: candidateTable.id }) as any);
                    }, 1500);
                }
            }
        };

        const handleCompletion = () => {
            if (isCompleted) return;
            isCompleted = true;
            setIsChatFormulating(false);
            agentAbortRef.current = null;
            clearTimeout(timeoutId);

            const completionResult = allResults.find((r: any) => r.type === "completion");
            if (completionResult) {
                const summary = completionResult.content.message || "";
                const status: "completed" | "warning" = completionResult.status === "success" ? "completed" : "warning";
                dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: summary, status, hidden: false,
                    message: { content: summary, role: 'completion' } }));
                setChatPrompt("");
            } else {
                dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: "The agent got lost in the data.", status: 'warning', hidden: false,
                    message: { content: "The agent got lost in the data.", role: 'clarify' } }));
            }
        };

        fetchWithIdentity(getUrls().EXPLORE_DATA_STREAMING, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: messageBody,
            signal: controller.signal
        })
        .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body reader available');

            const decoder = new TextDecoder();
            let buffer = '';

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) { handleCompletion(); break; }
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (let line of lines) {
                        if (line.trim() !== "") {
                            try {
                                const data = JSON.parse(line);
                                if (data.token === token) {
                                    if (data.status === "ok" && data.result) {
                                        allResults.push(data.result);
                                        processStreamingResult(data.result);
                                        if (data.result.type === "completion") { handleCompletion(); return; }
                                    } else if (data.status === "error") {
                                        setIsChatFormulating(false);
                                        clearTimeout(timeoutId);
                                        dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: data.error_message || "Error during exploration", status: 'failed', hidden: false,
                                            message: { content: data.error_message || "Error during exploration", role: 'error' } }));
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
            setIsChatFormulating(false);
            agentAbortRef.current = null;
            clearTimeout(timeoutId);
            const isCancelled = error.name === 'AbortError' && !isCompleted;
            const errorMessage = isCancelled ? "Exploration cancelled" : error.name === 'AbortError' ? "Exploration timed out" : `Exploration failed: ${error.message}`;
dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: errorMessage, status: isCancelled ? 'warning' : 'failed', hidden: false,
                    message: { content: errorMessage, role: isCancelled ? 'clarify' : 'error' } }));
        });
    }, [focusedTableId, tables, activeModel, agentRules, config, conceptShelfItems, dispatch]);

    const cancelAgent = useCallback(() => {
        if (agentAbortRef.current) {
            agentAbortRef.current.abort();
            agentAbortRef.current = null;
        }
    }, []);

    const inputBox = (
        <Card ref={inputCardRef} variant="outlined" sx={{
            display: 'flex', flexDirection: 'column',
            mx: 1, mb: 1, mt: 0.5,
            px: 1, pt: 0.5, pb: 0.25,
            borderWidth: 1.5,
            borderColor: isChatFormulating ? alpha(theme.palette.action.disabled, 0.2) : alpha(theme.palette.primary.main, 0.5),
            borderRadius: '8px',
            overflow: isChatFormulating ? 'hidden' : 'visible',
            flexShrink: 0,
            position: 'relative',
            zIndex: expanded ? 11 : 0,
            cursor: !expanded ? 'pointer' : undefined,
            transition: 'box-shadow 0.2s ease, background-color 0.2s ease, border-color 0.2s ease',
            ...(isChatFormulating ? { backgroundColor: alpha(theme.palette.action.disabledBackground, 0.06) } : {}),
            '&:hover': !expanded ? {
                boxShadow: `0 0 0 1px ${alpha(theme.palette.primary.main, 0.3)}`,
            } : {},
        }}
            onClick={(e) => {
                if (!expanded) {
                    const target = e.target as HTMLElement;
                    if (target.closest('input, textarea, button, .MuiIconButton-root')) return;
                    setExpanded(true);
                }
            }}
        >
            <TextField
                variant="standard"
                sx={{
                    flex: 1,
                    "& .MuiInput-input": { fontSize: '12px', lineHeight: 1.5 },
                    "& .MuiInput-underline:before": { borderBottom: 'none !important' },
                    "& .MuiInput-underline:hover:not(.Mui-disabled):before": { borderBottom: 'none !important' },
                    "& .MuiInput-underline:after": { borderBottom: 'none !important' },
                    "& .MuiInputBase-root": { borderBottom: 'none !important' },
                    ...(isChatFormulating ? {
                        "& .MuiInput-input": { fontSize: '12px', lineHeight: 1.5, color: 'text.disabled' },
                    } : {}),
                }}
                onChange={(event: any) => { if (!isChatFormulating) setChatPrompt(event.target.value); }}
                onKeyDown={(event: any) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (chatPrompt.trim().length > 0 && !isChatFormulating) {
                            exploreFromChat(chatPrompt);
                        }
                    }
                }}
                onFocus={() => {
                    if (!expanded) setExpanded(true);
                    // Scroll to the focused table card, positioning it near the bottom of the visible area
                    const el = document.querySelector('.data-thread-card.selected-card') as HTMLElement | null;
                    if (el) {
                        // Find nearest scrollable ancestor
                        let scrollContainer: HTMLElement | null = el.parentElement;
                        while (scrollContainer) {
                            const ov = getComputedStyle(scrollContainer).overflowY;
                            if (ov === 'auto' || ov === 'scroll') break;
                            scrollContainer = scrollContainer.parentElement;
                        }
                        if (scrollContainer) {
                            const containerRect = scrollContainer.getBoundingClientRect();
                            const elRect = el.getBoundingClientRect();
                            // Place the element so its bottom sits ~80px above the container's bottom edge
                            const targetBottom = containerRect.bottom - 80;
                            const offset = elRect.bottom - targetBottom;
                            scrollContainer.scrollBy({ top: offset, behavior: 'smooth' });
                        } else {
                            el.scrollIntoView({ behavior: 'smooth', block: 'end' });
                        }
                    }
                }}
                slotProps={{ 
                    inputLabel: { shrink: true },
                    input: { readOnly: isChatFormulating },
                }}
                value={chatPrompt}
                placeholder={"explore a new direction"}
                fullWidth
                multiline
                minRows={2}
                maxRows={4}
            />
            <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
                {/* Action buttons */}
                <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0.5, overflow: 'hidden', flex: 1 }}>
                    <Tooltip title="Add more data to the workspace">
                        <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); setUploadDialogOpen(true); }}
                            sx={{ p: 0, width: 18, height: 18, color: theme.palette.text.secondary,
                                borderRadius: '4px',
                                '&:hover': { color: theme.palette.primary.main, borderColor: alpha(theme.palette.primary.main, 0.5) } }}
                        >
                            <AddIcon sx={{ fontSize: 12 }} />
                        </IconButton>
                    </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                {isChatFormulating ? (
                    <CircularProgress size={18} sx={{ m: 0.5 }} />
                ) : (
                    <>
                        <Tooltip title="Get idea suggestions">
                            <span>
                                <IconButton
                                    size="small"
                                    sx={{ p: 0.5, color: theme.palette.custom.main }}
                                    disabled={!focusedTableId || isLoadingIdeas}
                                    onClick={() => { 
                                        if (ideas.length > 0) {
                                            setExpanded(true);
                                        } else {
                                            getIdeasFromAgent(); 
                                        }
                                    }}
                                >
                                    {isLoadingIdeas
                                        ? <CircularProgress size={18} sx={{ color: theme.palette.warning.main }} />
                                        : <TipsAndUpdatesIcon sx={{ fontSize: 18 }} />}
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title="Explore">
                            <span>
                                <IconButton
                                    size="small"
                                    color="primary"
                                    sx={{ p: 0.5 }}
                                    disabled={chatPrompt.trim().length === 0 || !focusedTableId}
                                    onClick={() => { exploreFromChat(chatPrompt); }}
                                >
                                    <SendIcon sx={{ fontSize: 18 }} />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </>
                )}
                </Box>
            </Box>
            {/* Agent working overlay */}
            {(isChatFormulating || isLoadingIdeas) && (
                <AgentWorkingOverlay 
                    relevantAgentActions={isLoadingIdeas && !isChatFormulating 
                        ? [{ status: 'running', description: 'Generating exploration ideas...' }] 
                        : relevantAgentActions}
                    theme={theme}
                    onCancel={isLoadingIdeas && !isChatFormulating ? () => { ideasAbortRef.current?.abort(); ideasAbortRef.current = null; setIsLoadingIdeas(false); setIdeas([]); } : cancelAgent}
                />
            )}
        </Card>
    );

    return (
        <ClickAwayListener onClickAway={() => { if (expanded) setExpanded(false); }}>
        <Box>
            {/* Overlay that expands upward from the input box */}
            <Box sx={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                top: 0,
                pointerEvents: 'none',
                zIndex: expanded ? 10 : -1,
            }}>
                {/* Dialog panel — anchored above the input card, slides up */}
                <Box sx={{
                    position: 'absolute',
                    bottom: `${inputCardHeight + 12}px`,
                    left: 0,
                    right: 0,
                    pointerEvents: expanded ? 'auto' : 'none',
                    maxHeight: (expanded && (ideas.length > 0 || isLoadingIdeas || hasThreadContent)) ? `${panelHeight}px` : '0px',
                    opacity: (expanded && (ideas.length > 0 || isLoadingIdeas || hasThreadContent)) ? 1 : 0,
                    transform: (expanded && (ideas.length > 0 || isLoadingIdeas || hasThreadContent)) ? 'translateY(0)' : 'translateY(8px)',
                    transition: dragRef.current ? 'none' : 'max-height 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease, transform 0.25s ease',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    mx: 1,
                    borderRadius: '8px',
                    background: theme.palette.background.paper,
                    boxShadow: expanded ? '0 -4px 20px rgba(0,0,0,0.12)' : 'none',
                    border: expanded ? `1px solid ${theme.palette.divider}` : 'none',
                }}>
                    {/* Draggable top edge handle */}
                    <Box
                        sx={{
                            height: 8,
                            flexShrink: 0,
                            cursor: 'ns-resize',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            '&:hover > div': { backgroundColor: alpha(theme.palette.text.secondary, 0.4) },
                        }}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            dragRef.current = { startY: e.clientY, startHeight: panelHeight };
                            setIsDragging(true);
                            const onMouseMove = (ev: MouseEvent) => {
                                ev.preventDefault();
                                if (!dragRef.current) return;
                                const delta = dragRef.current.startY - ev.clientY;
                                const newHeight = Math.max(100, Math.min(600, dragRef.current.startHeight + delta));
                                setPanelHeight(newHeight);
                            };
                            const onMouseUp = (ev: MouseEvent) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                                dragRef.current = null;
                                setIsDragging(false);
                                document.removeEventListener('mousemove', onMouseMove);
                                document.removeEventListener('mouseup', onMouseUp);
                            };
                            document.addEventListener('mousemove', onMouseMove);
                            document.addEventListener('mouseup', onMouseUp);
                        }}
                    >
                        <Box sx={{ width: 32, height: 3, borderRadius: 1.5, backgroundColor: alpha(theme.palette.text.disabled, 0.25), transition: 'background-color 0.15s' }} />
                    </Box>
                    {/* Floating collapse button */}
                    <IconButton
                        size="small"
                        onClick={() => setExpanded(false)}
                        sx={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            zIndex: 1,
                            width: 22,
                            height: 22,
                            background: alpha(theme.palette.background.paper, 0.85),
                            '&:hover': { background: alpha(theme.palette.action.hover, 0.15) },
                        }}
                    >
                        <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                    {/* Thread messages & Idea suggestions */}
                    <Box ref={threadScrollRef} sx={{
                        flex: 1,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        px: 1, py: 0.5,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                    }}>
                        {/* Timeline-style thread messages (always shown when present) */}
                        {allThreadMessages.map((msg, idx) => {
                            const isLast = idx === allThreadMessages.length - 1;
                            const TIMELINE_W = 14;
                            const TIMELINE_GAP = '6px';

                            // Determine timeline icon for each role
                            const primaryColor = theme.palette.primary.main;
                            const customColor = theme.palette.custom?.main || theme.palette.warning.main;
                            // Skip source-table and result-table — they're rendered inline as quotes
                            if (msg.role === 'source-table' || msg.role === 'result-table') return null;

                            // Find adjacent table references to embed as quotes
                            const prevMsg = idx > 0 ? allThreadMessages[idx - 1] : null;
                            const nextMsg2 = idx < allThreadMessages.length - 1 ? allThreadMessages[idx + 1] : null;
                            const sourceTableRef = (msg.role === 'user' && prevMsg?.role === 'source-table') ? prevMsg.content : null;
                            const resultTableRef = (msg.role === 'thinking' && nextMsg2?.role === 'result-table') ? nextMsg2.content : null;

                            const getTimelineIcon = () => {
                                if (msg.isRunning) {
                                    return <CircularProgress size={10} thickness={5} sx={{ color: customColor }} />;
                                }
                                switch (msg.role) {
                                    case 'user':
                                        return <PersonOutlineIcon sx={{ fontSize: 12, color: primaryColor }} />;
                                    case 'thinking':
                                        return <SmartToyOutlinedIcon sx={{ fontSize: 11, color: customColor }} />;
                                    case 'completion':
                                        return <SmartToyOutlinedIcon sx={{ fontSize: 11, color: theme.palette.success.main }} />;
                                    case 'error':
                                        return <SmartToyOutlinedIcon sx={{ fontSize: 11, color: theme.palette.error.main }} />;
                                    case 'clarify':
                                        return <SmartToyOutlinedIcon sx={{ fontSize: 11, color: theme.palette.warning.main }} />;
                                    default:
                                        return <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.2)' }} />;
                                }
                            };

                            const lineColor = msg.role === 'error' ? alpha(theme.palette.error.main, 0.2)
                                : msg.role === 'clarify' ? alpha(theme.palette.warning.main, 0.3)
                                : 'rgba(0,0,0,0.12)';

                            // Find the next *visible* message (skipping table items) for bottom line color
                            let nextVisibleMsg: ThreadItem | null = null;
                            for (let j = idx + 1; j < allThreadMessages.length; j++) {
                                if (allThreadMessages[j].role !== 'source-table' && allThreadMessages[j].role !== 'result-table') {
                                    nextVisibleMsg = allThreadMessages[j];
                                    break;
                                }
                            }
                            const bottomLineColor = nextVisibleMsg
                                ? (nextVisibleMsg.role === 'error' ? alpha(theme.palette.error.main, 0.2)
                                    : nextVisibleMsg.role === 'clarify' ? alpha(theme.palette.warning.main, 0.3)
                                    : 'rgba(0,0,0,0.12)')
                                : lineColor;

                            // Determine if this is the first/last visible item for timeline lines
                            let isFirstVisible = true;
                            for (let j = 0; j < idx; j++) {
                                if (allThreadMessages[j].role !== 'source-table' && allThreadMessages[j].role !== 'result-table') {
                                    isFirstVisible = false;
                                    break;
                                }
                            }
                            const isLastVisible = nextVisibleMsg === null;

                            const tableQuote = (tableId: string) => (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: '3px', py: '1px' }}>
                                    <TableRowsOutlinedIcon sx={{ fontSize: 10, color: theme.palette.text.disabled }} />
                                    <Typography sx={{ fontSize: 9, color: theme.palette.text.disabled }}>
                                        {tables.find(t => t.id === tableId)?.displayId || tableId}
                                    </Typography>
                                </Box>
                            );

                            const renderContent = () => {
                                if (msg.isRunning) {
                                    return <ThinkingBufferEffect text={msg.content || 'thinking...'} sx={{ width: '100%' }} />;
                                }
                                switch (msg.role) {
                                    case 'user':
                                        return (
                                            <Box>
                                                {sourceTableRef && tableQuote(sourceTableRef)}
                                                <Typography component="div" sx={{ fontSize: 10, color: primaryColor,
                                                    fontStyle: 'italic',
                                                    whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                                    {msg.content}
                                                </Typography>
                                            </Box>
                                        );
                                    case 'thinking':
                                        return (
                                            <Box>
                                                <Typography component="div" sx={{ fontSize: 10, color: customColor,
                                                    whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                                    {renderTextWithEmphasis(msg.content, {
                                                        borderRadius: '2px',
                                                        fontSize: '10px',
                                                        backgroundColor: alpha(customColor, 0.08),
                                                    })}
                                                </Typography>
                                                {resultTableRef && tableQuote(resultTableRef)}
                                            </Box>
                                        );
                                    case 'completion':
                                        return (
                                            <Typography sx={{ fontSize: 10, color: theme.palette.success.main,
                                                whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                                {msg.content}
                                            </Typography>
                                        );
                                    case 'error':
                                        return (
                                            <Typography sx={{ fontSize: 10, color: theme.palette.error.main,
                                                whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                                {msg.content}
                                            </Typography>
                                        );
                                    case 'clarify':
                                        return (
                                            <Typography sx={{ fontSize: 10, color: theme.palette.warning.main,
                                                whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                                {msg.content}
                                            </Typography>
                                        );
                                    default:
                                        return null;
                                }
                            };

                            return (
                                <Box key={`thread-msg-${idx}`} sx={{
                                    display: 'flex', flexDirection: 'row', position: 'relative',
                                }}>
                                    {/* Timeline column: icon at top, line extends down */}
                                    <Box sx={{
                                        width: TIMELINE_W, flexShrink: 0,
                                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                                        pt: '5px',
                                    }}>
                                        <Box sx={{ flexShrink: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {getTimelineIcon()}
                                        </Box>
                                        {!isLastVisible
                                            ? <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `1px solid ${bottomLineColor}` }} />
                                            : <Box sx={{ flex: '1 1 0', minHeight: 2 }} />
                                        }
                                    </Box>
                                    {/* Content column */}
                                    <Box sx={{ flex: 1, minWidth: 0, py: '4px', pl: TIMELINE_GAP }}>
                                        {renderContent()}
                                    </Box>
                                </Box>
                            );
                        })}
                        {/* Idea suggestions section */}
                        {isLoadingIdeas && ideas.length === 0 ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                                <ThinkingBufferEffect text={thinkingBuffer.slice(-60) || 'thinking...'} sx={{ width: '100%' }} />
                            </Box>
                        ) : !hasThreadContent && ideas.length === 0 ? (
                            <Typography variant="caption" sx={{ color: theme.palette.text.disabled, fontSize: 11 }}>
                                Click 💡 to get exploration ideas for your data.
                            </Typography>
                        ) : ideas.length > 0 ? (
                            <Box sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '5px',
                                p: 0.75,
                                borderRadius: '6px',
                                backgroundColor: alpha(theme.palette.custom?.main || theme.palette.warning.main, 0.04),
                            }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <TipsAndUpdatesIcon sx={{ fontSize: 12, color: theme.palette.custom?.main || theme.palette.warning.main }} />
                                    <Typography sx={{ fontSize: 10, fontWeight: 600, color: theme.palette.custom?.main || theme.palette.warning.main, flex: 1 }}>
                                        Ideas
                                    </Typography>
                                    {!isLoadingIdeas && (
                                        <>
                                            <Tooltip title="Regenerate ideas">
                                                <IconButton
                                                    size="small"
                                                    onClick={() => getIdeasFromAgent()}
                                                    sx={{ p: '2px', color: theme.palette.text.secondary, '&:hover': { color: theme.palette.primary.main } }}
                                                >
                                                    <RefreshIcon sx={{ fontSize: 13 }} />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Clear ideas">
                                                <IconButton
                                                    size="small"
                                                    onClick={() => setIdeas([])}
                                                    sx={{ p: '2px', color: theme.palette.text.secondary, '&:hover': { color: theme.palette.error.main } }}
                                                >
                                                    <ClearIcon sx={{ fontSize: 13 }} />
                                                </IconButton>
                                            </Tooltip>
                                        </>
                                    )}
                                </Box>
                                {ideas.map((idea, idx) => {
                                    const color = idea.difficulty === 'easy' ? theme.palette.success.main
                                        : idea.difficulty === 'hard' ? theme.palette.warning.main
                                        : theme.palette.primary.main;
                                    return (
                                        <Box
                                            key={idx}
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                px: 1, py: 0.5,
                                                borderRadius: '5px',
                                                backgroundColor: theme.palette.background.paper,
                                                border: `1px solid ${alpha(color, 0.18)}`,
                                                cursor: 'pointer',
                                                transition: 'all 0.15s ease',
                                                '&:hover': {
                                                    borderColor: alpha(color, 0.6),
                                                    background: alpha(color, 0.06),
                                                    transform: 'translateY(-1px)',
                                                },
                                            }}
                                            onClick={() => {
                                                setChatPrompt(idea.text);
                                                exploreFromChat(idea.text);
                                                setExpanded(false);
                                            }}
                                        >
                                            <Typography component="div" sx={{ fontSize: '11px', lineHeight: 1.4, color }}>
                                                {renderTextWithEmphasis(idea.goal, {
                                                    borderRadius: '0px',
                                                    borderBottom: `1px solid`,
                                                    borderColor: alpha(color, 0.4),
                                                    fontSize: '11px',
                                                    lineHeight: 1.4,
                                                    backgroundColor: alpha(color, 0.05),
                                                })}
                                            </Typography>
                                        </Box>
                                    );
                                })}
                                {isLoadingIdeas && thinkingBuffer && (
                                    <ThinkingBufferEffect text={thinkingBuffer.slice(-60)} sx={{ width: '100%' }} />
                                )}
                            </Box>
                        ) : null}

                    </Box>
                </Box>
            </Box>
            {/* Full-viewport overlay during drag to capture all pointer events */}
            {isDragging && (
                <Box sx={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    zIndex: 9999,
                    cursor: 'ns-resize',
                    userSelect: 'none',
                }} />
            )}
            {/* The input box always at the bottom */}
            {inputBox}
            <UnifiedDataUploadDialog
                open={uploadDialogOpen}
                onClose={() => setUploadDialogOpen(false)}
                initialTab="menu"
            />
        </Box>
        </ClickAwayListener>
    );
};
