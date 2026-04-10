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
import { DataFormulatorState, dfActions, dfSelectors, fetchCodeExpl, fetchFieldSemanticType, fetchChartInsight, generateFreshChart, GeneratedReport } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { resolveRecommendedChart, getUrls, fetchWithIdentity, getTriggers } from '../app/utils';
import { Chart, DictTable, FieldItem, createDictTable, InteractionEntry } from "../components/ComponentType";

import { alpha } from '@mui/material/styles';
import { WritingPencil } from '../components/FunComponents';
import SendIcon from '@mui/icons-material/Send';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import ArticleIcon from '@mui/icons-material/Article';

import RefreshIcon from '@mui/icons-material/Refresh';
import ClearIcon from '@mui/icons-material/Clear';
import { renderTextWithEmphasis } from './EncodingShelfCard';
import { renderFieldHighlights } from './InteractionEntryCard';
import { UnifiedDataUploadDialog } from './UnifiedDataUploadDialog';
import { Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

const AgentWorkingOverlay: FC<{ message?: string; theme: Theme; onCancel?: () => void }> = ({ message, theme, onCancel }) => {
    const { t } = useTranslation();
    const latestMessage = message || t('dataThread.thinking');
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
                <WritingPencil size={10} />
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
    const draftNodes = useSelector((state: DataFormulatorState) => state.draftNodes);

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

    // Stale draft detection is handled by loadState in dfSlice (marks running/clarifying drafts as interrupted)

    const inputCardRef = useRef<HTMLDivElement>(null);

    const focusedTableId = useCallback(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        if (focusedId.type === 'chart') {
            const chart = charts.find(c => c.id === focusedId.chartId);
            return chart?.tableRef;
        }
        return undefined;
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
    const hasRunningAgent = draftNodes.some(d => d.derive?.status === 'running' && threadTableIds.has(d.derive.trigger.tableId));

    // Derive pending clarification from DraftNodes
    const pendingClarification = React.useMemo(() => {
        const clarifyingDraft = draftNodes.find(d =>
            d.derive?.status === 'clarifying' && d.derive?.pendingClarification &&
            threadTableIds.has(d.derive.trigger.tableId)
        );
        if (clarifyingDraft?.derive?.pendingClarification) {
            return { ...clarifyingDraft.derive.pendingClarification, actionId: clarifyingDraft.actionId || '', draftId: clarifyingDraft.id };
        }
        return null;
    }, [draftNodes, threadTableIds]);

    // Extract the clarification question text and options from DraftNode interaction log
    const clarificationQuestion = React.useMemo(() => {
        if (!pendingClarification?.draftId) return null;
        const draft = draftNodes.find(d => d.id === pendingClarification.draftId);
        const clarifyEntries = draft?.derive?.trigger?.interaction?.filter(e => e.role === 'clarify');
        return clarifyEntries && clarifyEntries.length > 0 ? clarifyEntries[clarifyEntries.length - 1].content : null;
    }, [pendingClarification, draftNodes]);

    const clarificationOptions = React.useMemo(() => {
        if (!pendingClarification?.draftId) return [];
        const draft = draftNodes.find(d => d.id === pendingClarification.draftId);
        const clarifyEntries = draft?.derive?.trigger?.interaction?.filter(e => e.role === 'clarify');
        const lastEntry = clarifyEntries && clarifyEntries.length > 0 ? clarifyEntries[clarifyEntries.length - 1] : null;
        return lastEntry?.options || [];
    }, [pendingClarification, draftNodes]);

    // Clarification auto-select countdown (60s)
    const CLARIFY_TIMEOUT_MS = 60_000;
    const [clarifyDeadline, setClarifyDeadline] = useState<number | null>(null);
    const [clarifyProgress, setClarifyProgress] = useState(1); // 1 → 0
    const clarifyTimerRef = useRef<number | null>(null);

    // Start / reset deadline whenever a new clarification appears
    useEffect(() => {
        if (pendingClarification && clarificationOptions.length > 0 && !isChatFormulating) {
            setClarifyDeadline(Date.now() + CLARIFY_TIMEOUT_MS);
            setClarifyProgress(1);
        } else {
            setClarifyDeadline(null);
            setClarifyProgress(1);
        }
    }, [pendingClarification?.draftId, clarificationOptions.length, isChatFormulating]);

    // Animate the countdown bar & auto-select on expiry
    useEffect(() => {
        if (clarifyDeadline == null) {
            if (clarifyTimerRef.current) cancelAnimationFrame(clarifyTimerRef.current);
            return;
        }
        const tick = () => {
            const remaining = clarifyDeadline - Date.now();
            if (remaining <= 0) {
                setClarifyProgress(0);
                setClarifyDeadline(null);
                // Auto-select first option
                if (clarificationOptions.length > 0 && pendingClarification) {
                    const first = clarificationOptions[0];
                    setChatPrompt(first);
                    exploreFromChat(first, pendingClarification);
                }
                return;
            }
            setClarifyProgress(remaining / CLARIFY_TIMEOUT_MS);
            clarifyTimerRef.current = requestAnimationFrame(tick);
        };
        clarifyTimerRef.current = requestAnimationFrame(tick);
        return () => { if (clarifyTimerRef.current) cancelAnimationFrame(clarifyTimerRef.current); };
    }, [clarifyDeadline]);

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
                explorationThread = triggers.map((trigger) => {
                    const tt = tables.find(t2 => t2.id === trigger.resultTableId);
                    return {
                        name: trigger.resultTableId,
                        rows: tt?.rows,
                        description: t('chartRec.explorationThreadDeriveDescription', {
                            source: String(tt?.derive?.source ?? ''),
                            instruction: trigger.interaction?.find((e: any) => e.role === 'instruction')?.content || '',
                        }),
                    };
                });
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

        // DraftNode handles status
        // If resuming from clarification, reuse the old draft (append reply, clear clarification)
        if (isResume && pendingClarification?.draftId) {
            dispatch(dfActions.appendDraftInteraction({ draftId: pendingClarification.draftId, entry: {
                from: 'user', to: 'data-agent', role: 'prompt', content: prompt, timestamp: Date.now()
            }}));
            dispatch(dfActions.updateDraftClarification({ draftId: pendingClarification.draftId, pendingClarification: null }));
            dispatch(dfActions.updateDeriveStatus({ nodeId: pendingClarification.draftId, status: 'running' }));
        }

        // Collect previous conversation from trigger interaction chains
        let conversationHistory: { role: string; content: string }[] | undefined = undefined;
        if (!isResume) {
            const history: { role: string; content: string }[] = [];
            // Walk the ancestor chain from the focused table, collecting interaction entries
            let walkTable = tables.find(t => t.id === focusedTableId);
            const visited = new Set<string>();
            while (walkTable?.derive?.trigger) {
                if (visited.has(walkTable.id)) break;
                visited.add(walkTable.id);
                const interaction = walkTable.derive.trigger.interaction;
                if (interaction && interaction.length > 0) {
                    for (const entry of interaction) {
                        if (entry.role === 'prompt') {
                            history.unshift({ role: 'user', content: entry.content });
                        } else if (entry.role === 'summary') {
                            history.unshift({ role: 'assistant', content: entry.content });
                        } else if (entry.plan) {
                            history.unshift({ role: 'assistant', content: entry.plan });
                        }
                    }
                }
                walkTable = tables.find(t => t.id === walkTable!.derive!.trigger.tableId);
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

        // ── DraftNode tracking ──
        // Local accumulator mirrors the DraftNode's interaction (avoids stale closure reads)
        let currentDraftInteraction: InteractionEntry[] = [];
        let currentDraftId: string | null = null;
        const createNextDraft = (parentTableId: string, initialInteraction: InteractionEntry[]) => {
            const draftId = `draft-${actionId}-${Date.now()}`;
            dispatch(dfActions.createDraftNode({
                id: draftId,
                displayId: draftId,
                parentTableId,
                source: selectedTableIds,
                interaction: initialInteraction,
                actionId,
            }));
            currentDraftId = draftId;
            currentDraftInteraction = [...initialInteraction];
            return draftId;
        };

        // Create the initial draft (or reuse existing for clarification resume)
        if (isResume && pendingClarification?.draftId) {
            currentDraftId = pendingClarification.draftId;
            // Seed local accumulator from the existing draft's interaction (fresh at this point)
            const existingDraft = draftNodes.find(d => d.id === pendingClarification.draftId);
            currentDraftInteraction = [...(existingDraft?.derive?.trigger?.interaction || [])];
            // The user reply was already appended above, add to local accumulator too
            currentDraftInteraction.push({ from: 'user', to: 'data-agent', role: 'prompt', content: prompt, timestamp: Date.now() });
        } else {
            const initialEntries: InteractionEntry[] = [
                { from: 'user', to: 'data-agent', role: 'prompt', content: prompt, timestamp: Date.now() }
            ];
            createNextDraft(lastCreatedTableId || focusedTableId!, initialEntries);
        }

        // Track the last agent thought and display_instruction (from "action" events)
        let lastAgentThought: string | null = null;
        let lastAgentDisplayInstruction: string | null = null;

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
            // Agent planning / choosing next action
            if (result.type === "action" && result.action === "visualize") {
                lastAgentThought = result.thought || null;
                lastAgentDisplayInstruction = result.display_instruction || null;
                // Plan is stored as a field on the upcoming instruction entry — not as a separate entry.
                // Show the plan text on the running draft so the user sees live reasoning.
                if (currentDraftId) {
                    dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId, plan: lastAgentThought || t('dataThread.thinking') }));
                }
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
                const displayInstruction = lastAgentDisplayInstruction || refinedGoal?.display_instruction || t('chartRec.explorationStep', { step: createdTables.length + 1, question });

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
                        resultTableId: candidateTableId,
                        chart: undefined,
                        // Use the full interaction log accumulated in the DraftNode,
                        // plus the instruction entry for this step
                        interaction: [
                            // Use the local accumulator (avoids stale closure)
                            ...currentDraftInteraction,
                            // The instruction to the sub-agent (plan folded in)
                            {
                                from: 'data-agent' as const, to: 'datarec-agent' as const, role: 'instruction' as const,
                                plan: lastAgentThought || undefined,
                                content: question || displayInstruction,
                                displayContent: displayInstruction,
                                timestamp: Date.now(),
                            },
                        ],
                    }
                };
                lastAgentThought = null; // consumed
                lastAgentDisplayInstruction = null; // consumed
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
                lastCreatedTableId = candidateTableId;

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

                // ── DraftNode: append instruction, remove draft, create next ──
                if (currentDraftId) {
                    dispatch(dfActions.appendDraftInteraction({ draftId: currentDraftId, entry: {
                        from: 'data-agent', to: 'datarec-agent', role: 'instruction',
                        plan: lastAgentThought || undefined,
                        content: question || displayInstruction,
                        displayContent: displayInstruction,
                        timestamp: Date.now(),
                    }}));
                    // Remove the draft — the table was already inserted via insertDerivedTables
                    dispatch(dfActions.removeDraftNode(currentDraftId));
                    currentDraftId = null;
                }
                // Create a new draft for the next potential step, chained from this table
                createNextDraft(candidateTableId, []);

                if (createdCharts.length > 0) {
                    const lastChart = createdCharts[createdCharts.length - 1];
                    setTimeout(() => {
                        dispatch(fetchChartInsight({ chartId: lastChart.id, tableId: candidateTable.id }) as any);
                    }, 1500);
                }
            }
            // Agent asks for clarification — pause and let user respond
            if (result.type === "clarify") {
                const clarifyMsg = result.message || t('chartRec.couldYouClarify');
                const clarifyOptions: string[] = Array.isArray(result.options) ? result.options : [];
                // Append clarify entry (with plan folded in) to draft
                if (currentDraftId) {
                    const clarifyEntry: InteractionEntry = {
                        from: 'data-agent', to: 'user', role: 'clarify',
                        plan: result.thought || undefined,
                        content: clarifyMsg,
                        options: clarifyOptions.length > 0 ? clarifyOptions : undefined,
                        timestamp: Date.now(),
                    };
                    dispatch(dfActions.appendDraftInteraction({ draftId: currentDraftId, entry: clarifyEntry }));
                    currentDraftInteraction.push(clarifyEntry);
                    dispatch(dfActions.updateDeriveStatus({ nodeId: currentDraftId, status: 'clarifying' }));
                    dispatch(dfActions.updateDraftClarification({ draftId: currentDraftId, pendingClarification: {
                        trajectory: result.trajectory || [],
                        completedStepCount: result.completed_step_count || 0,
                        lastCreatedTableId,
                    }}));
                }
                setIsChatFormulating(false);
                agentAbortRef.current = null;
                clearTimeout(timeoutId);
                setChatPrompt("");
                isCompleted = true; // prevent handleCompletion from firing
            }

            // ── Capture completion summary (with plan folded in) on the last created table's trigger ──
            if (result.type === "completion") {
                if (lastCreatedTableId) {
                    const summary = result.status === "max_iterations"
                        ? t('chartRec.maxIterationsReached')
                        : (result.content?.summary || result.content?.message || "");
                    if (summary) {
                        const entry: InteractionEntry = {
                            from: 'data-agent', to: 'user', role: 'summary',
                            plan: result.content?.thought || undefined,
                            content: summary,
                            timestamp: Date.now(),
                        };
                        dispatch(dfActions.appendTriggerInteraction({ tableId: lastCreatedTableId, entries: [entry] }));
                    }
                }
            }
        };

        const handleCompletion = () => {
            if (isCompleted) return;
            isCompleted = true;
            setIsChatFormulating(false);
            agentAbortRef.current = null;
            clearTimeout(timeoutId);

            // Clean up any remaining draft (the last step created a new draft that was never filled)
            if (currentDraftId) {
                dispatch(dfActions.removeDraftNode(currentDraftId));
                currentDraftId = null;
            }

            const completionResult = allResults.find((r: any) => r.type === "completion");
            if (completionResult) {
                setChatPrompt("");
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
                                        // Mark draft as error
                                        if (currentDraftId) {
                                            dispatch(dfActions.appendDraftInteraction({ draftId: currentDraftId, entry: {
                                                from: 'data-agent', to: 'user', role: 'error',
                                                content: data.error_message || t('chartRec.errorDuringExploration'),
                                                timestamp: Date.now(),
                                            }}));
                                            dispatch(dfActions.updateDeriveStatus({ nodeId: currentDraftId, status: 'error' }));
                                            currentDraftId = null;
                                        }
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
            // Clean up draft on error/cancel
            if (currentDraftId) {
                if (isCancelled) {
                    dispatch(dfActions.removeDraftNode(currentDraftId));
                } else {
                    dispatch(dfActions.appendDraftInteraction({ draftId: currentDraftId, entry: {
                        from: 'data-agent', to: 'user', role: 'error', content: errorMessage, timestamp: Date.now(),
                    }}));
                    dispatch(dfActions.updateDeriveStatus({ nodeId: currentDraftId, status: 'error' }));
                }
                currentDraftId = null;
            }
        });
    }, [focusedTableId, tables, draftNodes, activeModel, agentRules, config, conceptShelfItems, dispatch, t]);

    const cancelAgent = useCallback(() => {
        if (agentAbortRef.current) {
            agentAbortRef.current.abort();
            agentAbortRef.current = null;
        }
        // Also dismiss any pending clarification draft
        if (pendingClarification?.draftId) {
            dispatch(dfActions.removeDraftNode(pendingClarification.draftId));
        }
    }, [pendingClarification, dispatch, t]);

    const gradientBorder = `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.6)}, ${alpha(theme.palette.secondary.main, 0.55)})`;
    const workingBorder = `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.3)}, ${alpha(theme.palette.secondary.main, 0.25)})`;

    const inputBox = (
        <Card ref={inputCardRef} variant="outlined" sx={{
            display: 'flex', flexDirection: 'column',
            mx: 1, mb: 1, mt: 0.5,
            px: 1, pt: 0.5, pb: 0.25,
            borderRadius: '8px',
            border: 'none',
            outline: 'none',
            position: 'relative',
            overflow: isChatFormulating ? 'hidden' : 'visible',
            flexShrink: 0,
            transition: 'box-shadow 0.25s ease, background-color 0.2s ease',
            '&:focus-within': {
                boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.10)}`,
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
                    display: 'flex', flexDirection: 'column', gap: '6px',
                    px: 0.5, py: '6px',
                    borderBottom: `1px solid ${alpha(theme.palette.warning.main, 0.2)}`,
                    backgroundColor: alpha(theme.palette.warning.main, 0.05),
                    borderRadius: '8px 8px 0 0',
                    mx: '-8px', mt: '-4px', mb: '4px', pt: '8px', pb: '6px',
                }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                        <SmartToyOutlinedIcon sx={{ fontSize: 14, color: theme.palette.warning.main, mt: '1px', flexShrink: 0 }} />
                        <Typography component="div" sx={{ fontSize: 12, color: theme.palette.text.primary, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {renderFieldHighlights(clarificationQuestion, alpha(theme.palette.warning.main, 0.12))}
                        </Typography>
                    </Box>
                    {clarificationOptions.length > 0 && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px', pl: '20px' }}>
                            {clarificationOptions.map((option, idx) => (
                                <Box key={idx} sx={{ position: 'relative', width: 'fit-content', overflow: 'hidden', borderRadius: '6px' }}>
                                    {/* Countdown fill behind the first (default) option */}
                                    {idx === 0 && clarifyDeadline != null && (
                                        <Box sx={{
                                            position: 'absolute',
                                            inset: 0,
                                            transformOrigin: 'left center',
                                            transform: `scaleX(${clarifyProgress})`,
                                            background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.12)}, ${alpha(theme.palette.primary.light, 0.06)})`,
                                            borderRadius: 'inherit',
                                            pointerEvents: 'none',
                                            zIndex: 0,
                                        }} />
                                    )}
                                    <Typography component="div" variant="body2" onClick={() => { setClarifyDeadline(null); setChatPrompt(option); exploreFromChat(option, pendingClarification); }} sx={{
                                        position: 'relative', zIndex: 1,
                                        px: '8px', py: '4px',
                                        borderRadius: '6px',
                                        border: `1px solid ${idx === 0 ? alpha(theme.palette.primary.main, 0.25) : alpha(theme.palette.text.primary, 0.12)}`,
                                        backgroundColor: idx === 0 ? 'transparent' : 'white',
                                        cursor: 'pointer',
                                        fontSize: 11,
                                        width: 'fit-content',
                                        lineHeight: 1.4,
                                        color: theme.palette.text.primary,
                                        transition: 'all 0.1s linear',
                                        '&:hover': {
                                            backgroundColor: alpha(theme.palette.primary.main, 0.06),
                                            borderColor: alpha(theme.palette.primary.main, 0.3),
                                        },
                                    }}>
                                        {renderFieldHighlights(option, alpha(theme.palette.primary.main, 0.08))}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    )}
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
                        <Tooltip title={t('report.createNewReport')}>
                            <span>
                                <IconButton
                                    size="small"
                                    sx={{ p: 0.5, color: theme.palette.secondary.main }}
                                    disabled={!focusedTableId || charts.filter(c => tables.some(t => t.id === c.tableRef)).length === 0}
                                    onClick={() => {
                                        dispatch(dfActions.setFocused(undefined));
                                        dispatch(dfActions.setViewMode('report'));
                                    }}
                                >
                                    <ArticleIcon sx={{ fontSize: 18 }} />
                                </IconButton>
                            </span>
                        </Tooltip>
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
                    message={isLoadingIdeas && !isChatFormulating 
                        ? t('chartRec.generatingIdeas')
                        : draftNodes.find(d => d.derive?.status === 'running' && threadTableIds.has(d.derive.trigger.tableId))
                            ?.derive?.runningPlan}
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
                hideSampleDatasets
            />
        </Box>
    );
};
