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
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';

import RefreshIcon from '@mui/icons-material/Refresh';
import ClearIcon from '@mui/icons-material/Clear';
import { renderTextWithEmphasis } from './EncodingShelfCard';
import { UnifiedDataUploadDialog } from './UnifiedDataUploadDialog';
import { Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

const AgentWorkingOverlay: FC<{ relevantAgentActions: any[]; theme: Theme; onCancel?: () => void }> = ({ relevantAgentActions, theme, onCancel }) => {
    const { t } = useTranslation();
    const runningAction = relevantAgentActions.find(a => a.status === 'running');
    const latestMessage = runningAction?.description || t('dataThread.thinking');
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
                    {t('chartRec.agentWorking')}
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

export const SimpleChartRecBox: FC = function () {

    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const charts = useSelector(dfSelectors.getAllCharts);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const config = useSelector((state: DataFormulatorState) => state.config);
    const agentRules = useSelector((state: DataFormulatorState) => state.agentRules);
    const activeModel = useSelector(dfSelectors.getActiveModel);
    const agentActions = useSelector((state: DataFormulatorState) => state.agentActions);

    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const [chatPrompt, setChatPrompt] = useState("");
    const [isChatFormulating, setIsChatFormulating] = useState(false);
    const [ideas, setIdeas] = useState<{text: string, goal: string, difficulty: 'easy' | 'medium' | 'hard'}[]>([]);
    const [isLoadingIdeas, setIsLoadingIdeas] = useState(false);
    const [thinkingBuffer, setThinkingBuffer] = useState('');
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const agentAbortRef = useRef<AbortController | null>(null);
    const ideasAbortRef = useRef<AbortController | null>(null);

    // pendingClarification is now derived from Redux (stored on the agentAction itself)
    // so it persists when user clicks away and comes back.

    // On mount, clean up any stale "running" agent actions left over from a page refresh.
    // The streaming connection is lost on refresh, so these will never complete.
    // Only mark actions whose lastUpdate predates the current page load as stale.
    useEffect(() => {
        const pageLoadTime = performance.timeOrigin; // ms timestamp of when the page was loaded
        const staleRunning = agentActions.filter(a => a.status === 'running' && a.lastUpdate < pageLoadTime);
        if (staleRunning.length === 0) return;
        // The last stale action gets the visible message; others are silently marked warning
        const lastStale = staleRunning[staleRunning.length - 1];
        for (const action of staleRunning) {
            dispatch(dfActions.updateAgentWorkInProgress({
                actionId: action.actionId,
                description: action === lastStale ? t('chartRec.interruptedByRefresh') : action.description,
                status: 'warning',
                hidden: false,
                ...(action === lastStale ? { message: { content: t('chartRec.interruptedByRefresh'), role: 'clarify' } } : {}),
            }));
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const inputCardRef = useRef<HTMLDivElement>(null);

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
    // Agent actions relevant to the focused table's thread.
    // An action is relevant if:
    //  - its originTableId is in the ancestor chain, AND
    //  - it produced a table in the ancestor chain (resultTableId ∈ threadTableIds),
    //    OR is still running, OR the focused table is the originTableId itself.
    const relevantAgentActions = React.useMemo(() => {
        if (threadTableIds.size === 0) return [];
        return agentActions
            .filter(a => {
                if (a.hidden) return false;
                if (!threadTableIds.has(a.originTableId)) return false;
                // Include if still running or waiting for clarification (live progress)
                if (a.status === 'running' || a.status === 'warning') return true;
                // Include if any message produced a table in the ancestor chain
                if (a.messages?.some(m => m.resultTableId && threadTableIds.has(m.resultTableId))) return true;
                // Include if the focused table IS the origin (user is at the starting table)
                if (focusedTableId === a.originTableId) return true;
                return false;
            })
            .sort((a, b) => (a.messages?.[0]?.timestamp || a.lastUpdate) - (b.messages?.[0]?.timestamp || b.lastUpdate));
    }, [agentActions, threadTableIds, focusedTableId]);

    const hasRunningAgent = relevantAgentActions.some(a => a.status === 'running');

    // Derive pending clarification from the current thread's relevant actions (stored in Redux)
    const pendingClarification = React.useMemo(() => {
        const action = relevantAgentActions.find(a => a.pendingClarification);
        if (!action || !action.pendingClarification) return null;
        return { ...action.pendingClarification, actionId: action.actionId };
    }, [relevantAgentActions]);

    // Extract the clarification question text from the last 'clarify' message
    const clarificationQuestion = React.useMemo(() => {
        if (!pendingClarification) return null;
        const action = agentActions.find(a => a.actionId === pendingClarification.actionId);
        if (!action?.messages) return null;
        const clarifyMsgs = action.messages.filter(m => m.role === 'clarify');
        return clarifyMsgs.length > 0 ? clarifyMsgs[clarifyMsgs.length - 1].content : null;
    }, [pendingClarification, agentActions]);

    const getIdeasFromAgent = useCallback(async () => {
        if (!currentTable || isLoadingIdeas) return;
        setIsLoadingIdeas(true);
        setIdeas([]);
        setThinkingBuffer('');

        try {
            let explorationThread: any[] = [];
            const sourceTables = selectedTableIds.map(id => tables.find(t => t.id === id) as DictTable);

            if (currentTable.derive && !currentTable.anchored) {
                const triggers = getTriggers(currentTable, tables);
                explorationThread = triggers.map(trigger => ({
                    name: trigger.resultTableId,
                    rows: tables.find(t2 => t2.id === trigger.resultTableId)?.rows,
                    description: t('chartRec.explorationThreadDeriveDescription', {
                        source: String(tables.find(t2 => t2.id === trigger.resultTableId)?.derive?.source ?? ''),
                        instruction: trigger.instruction,
                    }),
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
                agent_exploration_rules: agentRules.exploration,
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
            if (!reader) throw new Error(t('chartRec.noResponseReader'));

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
    }, [currentTable, isLoadingIdeas, selectedTableIds, tables, activeModel, agentRules, config, dispatch, t]);

    const exploreFromChat = useCallback((prompt: string, clarificationContext?: {
        trajectory: any[];
        completedStepCount: number;
        actionId: string;
        lastCreatedTableId: string | null;
    }) => {
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

        const isResume = !!clarificationContext;
        const actionId = isResume ? clarificationContext!.actionId : `exploreDataFromNL_${String(Date.now())}`;
        const actionTables = selectedTableIds.map(id => tables.find(t => t.id === id) as DictTable);

        setIsChatFormulating(true);

        if (isResume) {
            // Show user's clarification reply in the thread; clear pendingClarification in Redux
            dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: prompt, status: 'running', hidden: false,
                    message: { content: prompt, role: 'user' }, pendingClarification: null }));
        } else {
            // User instruction with source table context
            dispatch(dfActions.updateAgentWorkInProgress({ actionId, originTableId: focusedTableId, description: prompt, status: 'running', hidden: false,
                message: { content: prompt, role: 'user' } }));
        }

        // Collect previous conversation messages for context (only for fresh starts)
        let conversationHistory: { role: string; content: string }[] | undefined = undefined;
        if (!isResume) {
            const history: { role: string; content: string }[] = [];
            for (const action of relevantAgentActions) {
                if (action.messages) {
                    for (const m of action.messages) {
                        if (m.role === 'user') {
                            history.push({ role: 'user', content: m.content });
                        } else if (m.role === 'thinking' || m.role === 'completion') {
                            history.push({ role: 'assistant', content: m.content });
                        }
                    }
                }
            }
            if (history.length > 0) conversationHistory = history;
        }

        const token = String(Date.now());
        const requestBody: any = {
            token,
            input_tables: actionTables.map(t => ({
                name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
                rows: t.rows,
                attached_metadata: t.attachedMetadata
            })),
            model: activeModel,
            max_iterations: 5,
            agent_exploration_rules: agentRules.exploration,
            agent_coding_rules: agentRules.coding
        };

        if (isResume) {
            // Stateless resume: send back trajectory + user answer
            requestBody.trajectory = clarificationContext!.trajectory;
            requestBody.clarification_response = prompt;
            requestBody.completed_step_count = clarificationContext!.completedStepCount;
        } else {
            requestBody.user_question = prompt;
            if (conversationHistory) requestBody.conversation_history = conversationHistory;
        }

        const messageBody = JSON.stringify(requestBody);

        const controller = new AbortController();
        agentAbortRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), config.formulateTimeoutSeconds * 6 * 1000);

        let allResults: any[] = [];
        let createdTables: DictTable[] = [];
        let createdCharts: Chart[] = [];
        let allNewConcepts: FieldItem[] = [];
        let isCompleted = false;
        let lastCreatedTableId: string | null = isResume ? clarificationContext!.lastCreatedTableId : null;

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
            // Agent thinking / choosing next action
            if (result.type === "action" && result.action === "visualize") {
                const thinkingMsg = result.thought || t('dataThread.thinking');
                const currentObserveId = lastCreatedTableId || focusedTableId;
                dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: thinkingMsg, status: 'running', hidden: false,
                    message: { content: thinkingMsg, role: 'thinking', observeTableId: currentObserveId } }));
            }
            // Visualization result (same shape as old data_transformation)
            if (result.type === "result" && result.status === "success") {
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
                const displayInstruction = refinedGoal?.display_instruction || t('chartRec.explorationStep', { step: createdTables.length + 1, question });

                // Chain from last created table, or focused table if first
                const triggerTableId = lastCreatedTableId || focusedTableId!;

                const candidateTable = createDictTable(candidateTableId, rows, undefined);
                candidateTable.derive = {
                    code: code || t('chartRec.explorationStepCodeComment', { step: createdTables.length + 1 }),
                    codeSignature: result.content?.result?.code_signature,
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

                // Bootstrap metadata from agent field_metadata (temporary until fetchFieldSemanticType completes)
                const fieldMetadata = refinedGoal?.['field_metadata'];
                if (fieldMetadata && typeof fieldMetadata === 'object') {
                    for (const [fieldName, meta] of Object.entries(fieldMetadata)) {
                        if (!candidateTable.metadata[fieldName]) continue;
                        if (typeof meta === 'string') {
                            // Plain string format: { "field": "SemanticType" }
                            candidateTable.metadata[fieldName].semanticType = meta;
                        } else if (typeof meta === 'object' && meta !== null) {
                            // Dict format: { "field": { "semantic_type": "...", "unit": "...", ... } }
                            const m = meta as Record<string, any>;
                            if (m['semantic_type']) {
                                candidateTable.metadata[fieldName].semanticType = m['semantic_type'];
                            }
                            if (m['unit']) {
                                candidateTable.metadata[fieldName].unit = m['unit'];
                            }
                            if (m['intrinsic_domain']) {
                                candidateTable.metadata[fieldName].intrinsicDomain = m['intrinsic_domain'];
                            }
                        }
                    }
                }

                createdTables.push(candidateTable);
                const observedTableId = lastCreatedTableId || focusedTableId; // table the agent was looking at before this step
                lastCreatedTableId = candidateTableId;

                dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: displayInstruction, status: 'running', hidden: false,
                    message: { content: displayInstruction, role: 'action', observeTableId: observedTableId, resultTableId: candidateTableId } }));

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
                if (candidateTable.derive) {
                    candidateTable.derive.trigger.chart = triggerChart;
                }

                // DataRecAgent always returns a refined_goal (with chart info),
                // so we can rely on it to create the chart for every step.
                const currentConcepts = [...conceptShelfItems.filter(c => names.includes(c.name)), ...allNewConcepts, ...conceptsToAdd];
                let newChart = resolveRecommendedChart(refinedGoal, currentConcepts, candidateTable);
                createdCharts.push(newChart);
                dispatch(dfActions.addChart(newChart));
                dispatch(dfActions.setFocused({ type: 'chart', chartId: newChart.id }));

                if (conceptsToAdd.length > 0) {
                    dispatch(dfActions.addConceptItems(conceptsToAdd));
                }
                dispatch(dfActions.insertDerivedTables(candidateTable));
                dispatch(fetchFieldSemanticType(candidateTable));
                dispatch(fetchCodeExpl(candidateTable));

                if (createdCharts.length > 0 && config.autoChartInsight) {
                    const lastChart = createdCharts[createdCharts.length - 1];
                    setTimeout(() => {
                        dispatch(fetchChartInsight({ chartId: lastChart.id, tableId: candidateTable.id }) as any);
                    }, 1500);
                }
            }
            // Agent asks for clarification — pause and let user respond
            if (result.type === "clarify") {
                const clarifyMsg = result.message || t('chartRec.couldYouClarify');
                dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: clarifyMsg, status: 'warning', hidden: false,
                    message: { content: clarifyMsg, role: 'clarify' },
                    pendingClarification: {
                        trajectory: result.trajectory || [],
                        completedStepCount: result.completed_step_count || 0,
                        lastCreatedTableId,
                    }
                }));
                setIsChatFormulating(false);
                agentAbortRef.current = null;
                clearTimeout(timeoutId);
                setChatPrompt("");
                isCompleted = true; // prevent handleCompletion from firing
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
                const summary = completionResult.status === "max_iterations"
                    ? t('chartRec.maxIterationsReached')
                    : (completionResult.content.summary || completionResult.content.message || "");
                const status: "completed" | "warning" = completionResult.status === "success" ? "completed" : "warning";
                dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: summary, status, hidden: false,
                    message: { content: summary, role: 'completion' } }));
                setChatPrompt("");
            } else {
                dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: t('chartRec.agentLost'), status: 'warning', hidden: false,
                    message: { content: t('chartRec.agentLost'), role: 'clarify' } }));
            }
        };

        fetchWithIdentity(getUrls().DATA_AGENT_STREAMING, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: messageBody,
            signal: controller.signal
        })
        .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const reader = response.body?.getReader();
            if (!reader) throw new Error(t('chartRec.noResponseReader'));

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
                                        if (data.result.type === "completion" || data.result.type === "clarify") { handleCompletion(); return; }
                                    } else if (data.status === "error") {
                                        setIsChatFormulating(false);
                                        clearTimeout(timeoutId);
                                        dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: data.error_message || t('chartRec.errorDuringExploration'), status: 'failed', hidden: false,
                                            message: { content: data.error_message || t('chartRec.errorDuringExploration'), role: 'error' } }));
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
            const errorMessage = isCancelled ? t('chartRec.explorationCancelled') : error.name === 'AbortError' ? t('chartRec.explorationTimedOut') : t('chartRec.explorationFailed', { message: error.message });
            dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: errorMessage, status: isCancelled ? 'warning' : 'failed', hidden: false,
                    message: { content: errorMessage, role: isCancelled ? 'clarify' : 'error' } }));
        });
    }, [focusedTableId, tables, activeModel, agentRules, config, conceptShelfItems, dispatch, relevantAgentActions, t]);

    const cancelAgent = useCallback(() => {
        if (agentAbortRef.current) {
            agentAbortRef.current.abort();
            agentAbortRef.current = null;
        }
        // Also dismiss any pending clarification
        if (pendingClarification) {
            dispatch(dfActions.updateAgentWorkInProgress({
                actionId: pendingClarification.actionId,
                description: t('chartRec.conversationEnded'),
                status: 'completed',
                hidden: false,
                message: { content: t('chartRec.conversationEnded'), role: 'completion' },
                pendingClarification: null,
            }));
        }
    }, [pendingClarification, dispatch, t]);

    const gradientBorder = `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.6)}, ${alpha(theme.palette.secondary.main, 0.55)})`;
    const workingBorder = `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.3)}, ${alpha(theme.palette.secondary.main, 0.25)})`;

    const inputBox = (
        <Card ref={inputCardRef} variant="outlined" sx={{
            display: 'flex', flexDirection: 'column',
            mx: 1.5, mb: 1.5, mt: 0.5,
            px: 1, pt: 0.5, pb: 0.25,
            borderRadius: '12px',
            border: 'none',
            outline: 'none',
            position: 'relative',
            overflow: isChatFormulating ? 'hidden' : 'visible',
            flexShrink: 0,
            transition: 'box-shadow 0.25s ease, background-color 0.2s ease',
            boxShadow: `0 2px 12px ${alpha(theme.palette.common.black, 0.08)}, 0 0 0 1px ${alpha(theme.palette.divider, 0.12)}`,
            backdropFilter: 'blur(12px)',
            backgroundColor: alpha(theme.palette.background.paper, 0.92),
            '&:focus-within': {
                boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.10)}, 0 2px 12px ${alpha(theme.palette.common.black, 0.08)}`,
            },
            ...(isChatFormulating ? { backgroundColor: alpha(theme.palette.action.disabledBackground, 0.06) } : {}),
            // Gradient border via pseudo-element (works with border-radius)
            '&::before': {
                content: '""',
                position: 'absolute',
                inset: 0,
                borderRadius: 'inherit',
                padding: '1.5px',
                background: isChatFormulating 
                    ? workingBorder 
                    : gradientBorder,
                WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                WebkitMaskComposite: 'xor',
                maskComposite: 'exclude',
                pointerEvents: 'none',
                zIndex: 3,
            },
        }}
        >
            {/* Show clarification question above input when agent is asking */}
            {clarificationQuestion && pendingClarification && !isChatFormulating && (
                <Box sx={{
                    display: 'flex', alignItems: 'flex-start', gap: '6px',
                    px: 0.5, py: '6px',
                    borderBottom: `1px solid ${alpha(theme.palette.warning.main, 0.2)}`,
                    backgroundColor: alpha(theme.palette.warning.main, 0.05),
                    borderRadius: '8px 8px 0 0',
                    mx: '-8px', mt: '-4px', mb: '4px', pt: '8px', pb: '6px',
                }}>
                    <SmartToyOutlinedIcon sx={{ fontSize: 14, color: theme.palette.warning.main, mt: '1px', flexShrink: 0 }} />
                    <Typography sx={{ fontSize: 12, color: theme.palette.text.primary, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {clarificationQuestion}
                    </Typography>
                </Box>
            )}
            {/* Idea chips inline */}
            {ideas.length > 0 && !isChatFormulating && (
                <Box sx={{
                    display: 'flex', flexDirection: 'column', gap: '4px',
                    borderBottom: `1px solid ${alpha(theme.palette.secondary.main, 0.15)}`,
                    backgroundColor: alpha(theme.palette.secondary.main, 0.03),
                    borderRadius: clarificationQuestion ? 0 : '8px 8px 0 0',
                    mx: '-8px', mt: clarificationQuestion ? 0 : '-4px', mb: '4px', px: '10px', pt: '6px', pb: '6px',
                }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', mb: '2px' }}>
                        <TipsAndUpdatesIcon sx={{ fontSize: 12, color: theme.palette.secondary.main }} />
                        <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.palette.secondary.main, flex: 1 }}>{t('chartRec.ideas')}</Typography>
                        <Tooltip title={t('chartRec.regenerateIdeas')}>
                            <IconButton size="small" onClick={() => getIdeasFromAgent()}
                                sx={{ p: '2px', color: theme.palette.text.secondary, '&:hover': { color: theme.palette.primary.main } }}>
                                <RefreshIcon sx={{ fontSize: 12 }} />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title={t('chartRec.clearIdeas')}>
                            <IconButton size="small" onClick={() => setIdeas([])}
                                sx={{ p: '2px', color: theme.palette.text.secondary, '&:hover': { color: theme.palette.error.main } }}>
                                <ClearIcon sx={{ fontSize: 12 }} />
                            </IconButton>
                        </Tooltip>
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {ideas.map((idea, idx) => {
                            const color = idea.difficulty === 'easy' ? theme.palette.success.main
                                : idea.difficulty === 'hard' ? theme.palette.warning.main
                                : theme.palette.primary.main;
                            return (
                                <Box key={idx} sx={{
                                    px: '6px', py: '3px',
                                    borderRadius: '4px',
                                    border: `1px solid ${alpha(color, 0.2)}`,
                                    backgroundColor: alpha(color, 0.04),
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                    '&:hover': { borderColor: alpha(color, 0.6), backgroundColor: alpha(color, 0.08) },
                                }} onClick={() => { setChatPrompt(idea.text); exploreFromChat(idea.text); }}>
                                    <Typography component="div" sx={{ fontSize: 10, lineHeight: 1.3, color }}>
                                        {renderTextWithEmphasis(idea.goal, {
                                            borderRadius: '0px', borderBottom: '1px solid',
                                            borderColor: alpha(color, 0.4), fontSize: '10px', lineHeight: 1.3,
                                            backgroundColor: alpha(color, 0.05),
                                        })}
                                    </Typography>
                                </Box>
                            );
                        })}
                    </Box>
                </Box>
            )}
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
                    if (event.key === 'Tab' && !event.shiftKey && chatPrompt.trim() === '' && !isChatFormulating) {
                        event.preventDefault();
                        setChatPrompt(t('chartRec.threadExplorePrompt'));
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (chatPrompt.trim().length > 0 && !isChatFormulating) {
                            if (pendingClarification) {
                                exploreFromChat(chatPrompt, pendingClarification);
                            } else {
                                exploreFromChat(chatPrompt);
                            }
                        }
                    }
                }}
                onFocus={() => {
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
                placeholder={pendingClarification ? t('chartRec.replyPlaceholder') : t('chartRec.explorePlaceholder')}
                fullWidth
                multiline
                minRows={2}
                maxRows={4}
            />
            <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
                {/* Action buttons */}
                <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0.5, overflow: 'hidden', flex: 1 }}>
                    <Tooltip title={t('chartRec.addMoreData')}>
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
                        <Tooltip title={t('chartRec.getIdeaSuggestions')}>
                            <span>
                                <IconButton
                                    size="small"
                                    sx={{ p: 0.5, color: theme.palette.secondary.main }}
                                    disabled={!focusedTableId || isLoadingIdeas}
                                    onClick={() => { 
                                        if (ideas.length > 0) {
                                            setIdeas([]);
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
                        {pendingClarification && !isChatFormulating && (
                            <Tooltip title={t('chartRec.endConversation')}>
                                <IconButton
                                    size="small"
                                    sx={{ p: 0.5, color: theme.palette.warning.main }}
                                    onClick={() => cancelAgent()}
                                >
                                    <StopCircleOutlinedIcon sx={{ fontSize: 18 }} />
                                </IconButton>
                            </Tooltip>
                        )}
                        <Tooltip title={pendingClarification ? t('chartRec.sendReply') : t('chartRec.explore')}>
                            <span>
                                <IconButton
                                    size="small"
                                    color="primary"
                                    sx={{ p: 0.5 }}
                                    disabled={chatPrompt.trim().length === 0 || !focusedTableId}
                                    onClick={() => {
                                        if (pendingClarification) {
                                            exploreFromChat(chatPrompt, pendingClarification);
                                        } else {
                                            exploreFromChat(chatPrompt);
                                        }
                                    }}
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
                        ? [{ status: 'running', description: t('chartRec.generatingIdeas') }] 
                        : relevantAgentActions}
                    theme={theme}
                    onCancel={isLoadingIdeas && !isChatFormulating ? () => { ideasAbortRef.current?.abort(); ideasAbortRef.current = null; setIsLoadingIdeas(false); setIdeas([]); } : cancelAgent}
                />
            )}
        </Card>
    );

    return (
        <Box>
            {/* The input box */}
            {inputBox}
            <UnifiedDataUploadDialog
                open={uploadDialogOpen}
                onClose={() => setUploadDialogOpen(false)}
                initialTab="menu"
            />
        </Box>
    );
};
