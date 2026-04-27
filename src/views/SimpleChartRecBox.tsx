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
    Chip,
    Popper,
    Paper,
    MenuList,
    MenuItem,
} from '@mui/material';

import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors, fetchCodeExpl, fetchFieldSemanticType, fetchChartInsight, generateFreshChart, GeneratedReport } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { resolveRecommendedChart, getUrls, fetchWithIdentity, getTriggers, translateBackend, translateBackendOptions } from '../app/utils';
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

import RefreshIcon from '@mui/icons-material/Refresh';
import ClearIcon from '@mui/icons-material/Clear';
import KeyboardDoubleArrowDownIcon from '@mui/icons-material/KeyboardDoubleArrowDown';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CallMergeIcon from '@mui/icons-material/CallMerge';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
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
    const activeModel = useSelector(dfSelectors.getActiveModel);
    const draftNodes = useSelector((state: DataFormulatorState) => state.draftNodes);

    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const [chatPrompt, setChatPrompt] = useState("");
    const [isChatFormulating, setIsChatFormulating] = useState(false);
    const [ideas, setIdeas] = useState<{text: string, goal: string, tag: string}[]>([]);
    const [isLoadingIdeas, setIsLoadingIdeas] = useState(false);
    const [thinkingBuffer, setThinkingBuffer] = useState('');
    const [mentionedTableIds, setMentionedTableIds] = useState<string[]>([]);
    const [mentionDropdownOpen, setMentionDropdownOpen] = useState(false);
    const [mentionHighlightIdx, setMentionHighlightIdx] = useState(0);
    const [selectedAgent, setSelectedAgent] = useState<'explore' | 'report'>('explore');
    const [attachedImages, setAttachedImages] = useState<string[]>([]);
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const agentAbortRef = useRef<AbortController | null>(null);
    const ideasAbortRef = useRef<AbortController | null>(null);

    // pendingClarification is now derived from Redux (stored on the agentAction itself)
    // so it persists when user clicks away and comes back.

    // Stale draft detection is handled by loadState in dfSlice (marks running/clarifying drafts as interrupted)

    const inputCardRef = useRef<HTMLDivElement>(null);

    const generatedReports = useSelector((state: DataFormulatorState) => state.generatedReports);

    const focusedTableId = useCallback(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        if (focusedId.type === 'chart') {
            const chart = charts.find(c => c.id === focusedId.chartId);
            return chart?.tableRef;
        }
        if (focusedId.type === 'report') {
            const report = generatedReports.find(r => r.id === focusedId.reportId);
            return report?.triggerTableId;
        }
        return undefined;
    }, [focusedId, charts, generatedReports])();

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

    // Default primary tables: source tables the focused table uses (or the focused source table itself)
    const defaultPrimaryTableIds = React.useMemo(() => {
        if (!currentTable) return [];
        if (currentTable.derive && !currentTable.anchored) {
            // Derived table: all its source inputs that are root tables
            return (currentTable.derive.source as string[]).filter(id => rootTables.some(t => t.id === id));
        }
        // Source table: just this table
        return rootTables.some(t => t.id === currentTable.id) ? [currentTable.id] : [];
    }, [currentTable, rootTables]);

    // Combined primary table IDs: defaults + user @-mentioned (deduplicated, source tables only)
    const primaryTableIds = React.useMemo(() => {
        const ids = new Set(defaultPrimaryTableIds);
        for (const id of mentionedTableIds) {
            if (rootTables.some(t => t.id === id)) ids.add(id);
        }
        return [...ids];
    }, [defaultPrimaryTableIds, mentionedTableIds, rootTables]);

    // Extract the filter text from after the last @ in the prompt
    const mentionFilter = React.useMemo(() => {
        if (!mentionDropdownOpen) return "";
        const lastAt = chatPrompt.lastIndexOf('@');
        if (lastAt < 0) return "";
        return chatPrompt.slice(lastAt + 1).toLowerCase();
    }, [chatPrompt, mentionDropdownOpen]);

    // Filtered available options for the @ dropdown (tables only)
    const mentionAvailableTables = React.useMemo(() => {
        return rootTables
            .filter(t => !primaryTableIds.includes(t.id))
            .filter(t => {
                if (!mentionFilter) return true;
                const name = (t.displayId || t.id).toLowerCase();
                return name.includes(mentionFilter);
            });
    }, [rootTables, primaryTableIds, mentionFilter]);

    // Reset highlight index when filter changes
    React.useEffect(() => {
        setMentionHighlightIdx(0);
    }, [mentionFilter]);

    // Helper: confirm selection of a mention (table only)
    const confirmMention = (optionId: string) => {
        const tbl = tables.find(t => t.id === optionId);
        const tableName = tbl?.displayId || optionId;
        setMentionedTableIds(prev => [...prev, optionId]);
        setChatPrompt(prev => {
            const lastAt = prev.lastIndexOf('@');
            if (lastAt < 0) return prev + `@${tableName} `;
            return prev.slice(0, lastAt) + `@${tableName} `;
        });
        setMentionDropdownOpen(false);
        setMentionHighlightIdx(0);
    };

    // Reset @-mentions when focused table changes (keep images — user removes manually)
    React.useEffect(() => {
        setMentionedTableIds([]);
        setMentionDropdownOpen(false);
        setMentionHighlightIdx(0);
    }, [focusedTableId]);

    // Handle paste events to capture images
    const handlePaste = React.useCallback((e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                e.preventDefault();
                const file = items[i].getAsFile();
                if (!file) continue;
                const reader = new FileReader();
                reader.onload = () => {
                    const dataUrl = reader.result as string;
                    setAttachedImages(prev => [...prev, dataUrl]);
                };
                reader.readAsDataURL(file);
            }
        }
    }, []);

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
                input_tables: sourceTables.map(t => ({
                    name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
                    rows: t.rows,
                    attached_metadata: t.attachedMetadata
                })),
                exploration_thread: explorationThread,
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
                    const ndjsonLines = buffer.split('\n');
                    buffer = ndjsonLines.pop() || '';
                    for (const rawLine of ndjsonLines) {
                        const trimmed = rawLine.trim();
                        if (!trimmed) continue;
                        try {
                            const parsed = JSON.parse(trimmed);
                            if (parsed.type === 'error') {
                                const msg = parsed.error?.message ?? parsed.content ?? 'Unknown error';
                                dispatch(dfActions.addMessages({
                                    timestamp: Date.now(), type: 'error',
                                    component: 'exploration', value: msg,
                                    diagnostics: parsed.error,
                                }));
                                continue;
                            }
                            if (parsed.type === 'warning') {
                                dispatch(dfActions.addMessages({
                                    timestamp: Date.now(), type: 'warning',
                                    component: 'exploration',
                                    value: parsed.warning?.message ?? 'Warning from server',
                                }));
                                continue;
                            }
                            if (parsed.text) {
                                lines.push(parsed);
                                setIdeas([...lines].map(b => ({ text: b.text, goal: b.goal, tag: b.tag || 'deep-dive' })));
                            }
                        } catch {
                            setThinkingBuffer(trimmed);
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
            if (buffer.trim()) {
                try {
                    const parsed = JSON.parse(buffer.trim());
                    if (parsed.type === 'error') {
                        const msg = parsed.error?.message ?? parsed.content ?? 'Unknown error';
                        dispatch(dfActions.addMessages({
                            timestamp: Date.now(), type: 'error',
                            component: 'exploration', value: msg,
                            diagnostics: parsed.error,
                        }));
                    } else if (parsed.type === 'warning') {
                        dispatch(dfActions.addMessages({
                            timestamp: Date.now(), type: 'warning',
                            component: 'exploration',
                            value: parsed.warning?.message ?? 'Warning from server',
                        }));
                    } else if (parsed.text) {
                        lines.push(parsed);
                    }
                } catch { /* partial non-JSON remainder, ignore */ }
            }
            setIdeas([...lines].map(b => ({ text: b.text, goal: b.goal, tag: b.tag || 'deep-dive' })));
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                // user cancelled, no notification needed
            } else {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(), type: 'error',
                    component: 'exploration',
                    value: t('messages.agent.unexpectedError'),
                    detail: error instanceof Error ? error.message : String(error),
                }));
            }
        } finally {
            setIsLoadingIdeas(false);
            setThinkingBuffer('');
            ideasAbortRef.current = null;
        }
    }, [currentTable, isLoadingIdeas, selectedTableIds, tables, activeModel, config, dispatch, t]);

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

        // ── Build structured thread context (Tier 2 + Tier 3) ──
        let focusedThread: any[] | undefined = undefined;
        let otherThreads: any[] | undefined = undefined;
        if (!isResume) {
            // Tier 2: Focused thread — detailed per-step info
            const focusedSteps: any[] = [];
            let walkTable = tables.find(t => t.id === focusedTableId);
            const visited = new Set<string>();
            const focusedChainIds = new Set<string>();
            while (walkTable?.derive?.trigger) {
                if (visited.has(walkTable.id)) break;
                visited.add(walkTable.id);
                focusedChainIds.add(walkTable.id);
                const trigger = walkTable.derive.trigger;
                const interaction = trigger.interaction || [];
                const userPrompt = interaction.find(e => e.role === 'prompt')?.content;
                const instruction = interaction.find(e => e.role === 'instruction');
                const summary = interaction.find(e => e.role === 'summary');

                // Find the actual resolved chart (not the trigger's "Auto" stub)
                const resolvedChart = charts.find(c => c.tableRef === walkTable!.id && c.source === 'trigger')
                    || charts.find(c => c.tableRef === walkTable!.id);
                const chartType = resolvedChart?.chartType || '';
                // Map field IDs to field names for readable context
                const encodings = resolvedChart?.encodingMap
                    ? Object.fromEntries(
                        Object.entries(resolvedChart.encodingMap)
                            .filter(([, v]: [string, any]) => v?.fieldID)
                            .map(([k, v]: [string, any]) => {
                                const field = conceptShelfItems.find(f => f.id === v.fieldID);
                                return [k, field?.name || v.fieldID];
                            })
                      )
                    : {};

                const step: any = {
                    table_name: walkTable.virtual?.tableId || walkTable.id,
                    columns: walkTable.names,
                    row_count: walkTable.virtual?.rowCount ?? walkTable.rows.length,
                    user_question: userPrompt || '',
                    agent_thinking: instruction?.plan || '',
                    display_instruction: instruction?.displayContent || instruction?.content || '',
                    chart_type: chartType,
                    encodings,
                    agent_summary: summary?.content || '',
                };

                // Include chart thumbnail for the focused leaf table (the one the user is looking at)
                if (walkTable.id === focusedTableId && resolvedChart?.thumbnail) {
                    step.chart_thumbnail = resolvedChart.thumbnail;
                }

                focusedSteps.unshift(step);

                walkTable = tables.find(t => t.id === trigger.tableId);
            }
            if (focusedSteps.length > 0) focusedThread = focusedSteps;

            // Tier 3: Peripheral threads — one-line summary per step
            // Find all leaf tables (no children or all children are anchored)
            const leafTables = tables.filter(t => {
                const children = tables.filter(c => c.derive?.trigger.tableId === t.id);
                return children.length === 0 || children.every(c => c.anchored);
            });

            const peripheralThreads: any[] = [];
            for (const leaf of leafTables) {
                // Skip the focused thread's leaf
                if (focusedChainIds.has(leaf.id)) continue;
                // Skip root/source tables
                if (!leaf.derive) continue;

                const triggers = getTriggers(leaf, tables);
                if (triggers.length === 0) continue;

                const steps: string[] = [];
                for (const trig of triggers) {
                    const tt = tables.find(t2 => t2.id === trig.resultTableId);
                    const instr = trig.interaction?.find((e: InteractionEntry) => e.role === 'instruction');
                    const label = instr?.displayContent || instr?.content || '';
                    // Look up the actual resolved chart from state, not the trigger's "Auto" stub
                    const chartForStep = charts.find(c => c.tableRef === trig.resultTableId && c.source === 'trigger')
                        || charts.find(c => c.tableRef === trig.resultTableId);
                    const chartType = chartForStep?.chartType || '';
                    const encStr = chartForStep?.encodingMap
                        ? Object.entries(chartForStep.encodingMap)
                            .filter(([, v]: [string, any]) => v?.fieldID)
                            .map(([k, v]: [string, any]) => {
                                const field = conceptShelfItems.find(f => f.id === v.fieldID);
                                return `${k}: ${field?.name || v.fieldID}`;
                            })
                            .join(', ')
                        : '';
                    steps.push(`${label}${chartType ? ` → ${chartType}` : ''}${encStr ? ` (${encStr})` : ''}`);
                }

                if (steps.length > 0) {
                    const sourceTableId = triggers[0].tableId;
                    const sourceTable = tables.find(t => t.id === sourceTableId);
                    peripheralThreads.push({
                        source_table: sourceTable?.virtual?.tableId || sourceTableId,
                        leaf_table: leaf.virtual?.tableId || leaf.id,
                        step_count: steps.length,
                        steps,
                    });
                }
            }
            if (peripheralThreads.length > 0) otherThreads = peripheralThreads;
        }

        const token = String(Date.now());
        // Resolve primary table names from primaryTableIds (includes defaults + @-mentioned)
        const primaryTableNames = primaryTableIds.map(id => {
            const t = tables.find(tbl => tbl.id === id);
            return t?.virtual?.tableId || id.replace(/\.[^/.]+$/, "");
        });
        const requestBody: any = {
            token,
            input_tables: actionTables.map(t => ({
                name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
                attached_metadata: t.attachedMetadata
            })),
            primary_tables: primaryTableNames,
            ...(attachedImages.length > 0 ? { attached_images: attachedImages } : {}),
            model: activeModel,
            max_iterations: 5,
        };

        if (isResume) {
            // Stateless resume: send back trajectory + user answer
            requestBody.trajectory = clarificationContext!.trajectory;
            requestBody.clarification_response = prompt;
            requestBody.completed_step_count = clarificationContext!.completedStepCount;
        } else {
            requestBody.user_question = prompt;
            if (focusedThread) requestBody.focused_thread = focusedThread;
            if (otherThreads) requestBody.other_threads = otherThreads;
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
        let currentDraftParentTableId: string | null = null;
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
            currentDraftParentTableId = parentTableId;
            currentDraftInteraction = [...initialInteraction];
            return draftId;
        };

        // Create the initial draft (or reuse existing for clarification resume)
        if (isResume && pendingClarification?.draftId) {
            currentDraftId = pendingClarification.draftId;
            // Seed local accumulator from the existing draft's interaction (fresh at this point)
            const existingDraft = draftNodes.find(d => d.id === pendingClarification.draftId);
            currentDraftParentTableId = existingDraft?.derive?.trigger?.tableId || null;
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
        let lastAgentInputTables: string[] = [];

        const genTableId = () => {
            let tableSuffix = Number.parseInt((Date.now() - Math.floor(Math.random() * 10000)).toString().slice(-6));
            let tId = `table-${tableSuffix}`;
            while (tables.find(t => t.id === tId) !== undefined || createdTables.some(t => t.id === tId)) {
                tableSuffix += 1;
                tId = `table-${tableSuffix}`;
            }
            return tId;
        };

        // Accumulate thinking phase steps for progressive display
        // Steps are joined with \x1E (Record Separator) to avoid splitting multi-line content
        const STEP_SEP = '\x1E';
        let thinkingSteps: string[] = [];
        let pendingThought: string = '';

        const processStreamingResult = (result: any) => {
            // ── thinking_text: LLM reasoning alongside tool calls ──
            // Accumulate into pendingThought; don't create a visible step
            if (result.type === "thinking_text") {
                pendingThought += (pendingThought ? '\n' : '') + result.content;
                // Only show as a step if there are no tool/action steps yet (initial thinking)
                if (thinkingSteps.length === 0) {
                    // Show a temporary "thinking..." indicator
                    if (currentDraftId) {
                        dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId, plan: t('dataThread.thinking') }));
                    }
                }
            }

            // ── tool_start: agent is calling a tool (explore/inspect) ──
            // (think tool is handled via thinking_text event, not here)
            if (result.type === "tool_start" && result.tool !== "think") {
                // Show pending thought as a visible step before the tool step
                if (pendingThought) {
                    thinkingSteps.push(pendingThought);
                    pendingThought = '';
                }
                if (result.tool === "explore") {
                    const purpose = result.purpose || '';
                    if (purpose) {
                        thinkingSteps.push(t('dataThread.runningCode') + ' ' + purpose);
                    } else {
                        const codePreview = result.code || '';
                        const meaningfulLine = codePreview.split('\n').find((l: string) => l.trim() && !l.trim().startsWith('import ') && !l.trim().startsWith('from ')) || codePreview.split('\n')[0] || '';
                        thinkingSteps.push(t('dataThread.runningCode') + (meaningfulLine ? `: ${meaningfulLine.trim()}` : ''));
                    }
                } else if (result.tool === "inspect_source_data") {
                    const tableNames = result.table_names?.join(', ') || '';
                    thinkingSteps.push(t('dataThread.inspectingData') + (tableNames ? ` ${tableNames}` : ''));
                }
                if (currentDraftId) {
                    dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId, plan: thinkingSteps.join(STEP_SEP) }));
                }
            }

            // ── tool_result: mark the last tool step as done ──
            // (skip for think tool — it doesn't add steps)
            if (result.type === "tool_result" && result.tool !== "think") {
                // Find the last non-✓ tool step (skip over any thinking entries)
                for (let i = thinkingSteps.length - 1; i >= 0; i--) {
                    if (!thinkingSteps[i].startsWith('✓')) {
                        thinkingSteps[i] = '✓ ' + thinkingSteps[i];
                        break;
                    }
                }
                if (currentDraftId) {
                    dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId, plan: thinkingSteps.join(STEP_SEP) }));
                }
            }

            // ── action: agent chose what to do ──
            if (result.type === "action") {
                lastAgentThought = result.thought || null;
                lastAgentInputTables = result.input_tables || [];
                if (result.action === "visualize") {
                    lastAgentDisplayInstruction = result.display_instruction || null;
                    thinkingSteps.push(t('dataThread.creatingChart') + (lastAgentDisplayInstruction ? ` ${lastAgentDisplayInstruction}` : ''));
                    if (currentDraftId) {
                        dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId, plan: thinkingSteps.join(STEP_SEP) }));
                    }
                }
            }

            // ── result: visualization checkpoint — create table + render chart ──
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
                const backendTableName = transformedData.virtual?.table_name;
                // Use backend name as ID only if it doesn't conflict with existing tables
                let candidateTableId = backendTableName || genTableId();
                if (tables.find(t => t.id === candidateTableId) || createdTables.some(t => t.id === candidateTableId)) {
                    candidateTableId = genTableId();
                }
                const displayInstruction = lastAgentDisplayInstruction || refinedGoal?.display_instruction || t('chartRec.explorationStep', { step: createdTables.length + 1, question });

                const triggerTableId = lastCreatedTableId || focusedTableId!;

                const candidateTable = createDictTable(candidateTableId, rows, undefined);
                // Resolve source tables from agent's input_tables (names it chose to use)
                const agentInputNames = lastAgentInputTables.length > 0 ? lastAgentInputTables : (refinedGoal?.input_tables || []);
                const resolvedSourceIds = (agentInputNames as string[]).length > 0
                    ? selectedTableIds.filter((id: string) => {
                        const tbl = tables.find(t2 => t2.id === id);
                        if (!tbl) return false;
                        const name = tbl.virtual?.tableId || tbl.id.replace(/\.[^/.]+$/, "");
                        return (agentInputNames as string[]).some((n: string) => n.replace(/\.[^/.]+$/, "") === name);
                    })
                    : selectedTableIds;
                const resolvedSourceNames = (resolvedSourceIds.length > 0 ? resolvedSourceIds : selectedTableIds).map((id: string) => {
                    const tbl = tables.find(t2 => t2.id === id);
                    return tbl?.displayId || tbl?.virtual?.tableId || id.replace(/\.[^/.]+$/, "");
                });
                candidateTable.derive = {
                    code: code || t('chartRec.explorationStepCodeComment', { step: createdTables.length + 1 }),
                    codeSignature: result.content?.result?.code_signature,
                    outputVariable: refinedGoal?.output_variable || 'result_df',
                    source: resolvedSourceIds.length > 0 ? resolvedSourceIds : selectedTableIds,
                    dialog: dialog || [],
                    trigger: {
                        tableId: triggerTableId,
                        resultTableId: candidateTableId,
                        chart: undefined,
                        interaction: [
                            ...currentDraftInteraction,
                            {
                                from: 'data-agent' as const, to: 'datarec-agent' as const, role: 'instruction' as const,
                                plan: [lastAgentThought, pendingThought, ...thinkingSteps.filter(s => s.trim())].filter(Boolean).join('\n') || undefined,
                                content: question || displayInstruction,
                                displayContent: displayInstruction,
                                inputTableNames: resolvedSourceNames,
                                timestamp: Date.now(),
                            },
                        ],
                    }
                };
                lastAgentThought = null;
                lastAgentDisplayInstruction = null;
                lastAgentInputTables = [];
                thinkingSteps = []; // reset for next chart
                pendingThought = ''; // reset for next chart
                if (transformedData.virtual) {
                    candidateTable.virtual = { tableId: transformedData.virtual.table_name, rowCount: transformedData.virtual.row_count };
                    // Use the backend name as display name even if ID was regenerated to avoid conflicts
                    candidateTable.displayId = transformedData.virtual.table_name;
                }

                const fieldMetadata = refinedGoal?.['field_metadata'];
                if (fieldMetadata && typeof fieldMetadata === 'object') {
                    for (const [fieldName, meta] of Object.entries(fieldMetadata)) {
                        if (!candidateTable.metadata[fieldName]) continue;
                        if (typeof meta === 'string') {
                            candidateTable.metadata[fieldName].semanticType = meta;
                        } else if (typeof meta === 'object' && meta !== null) {
                            const m = meta as Record<string, any>;
                            if (m['semantic_type']) candidateTable.metadata[fieldName].semanticType = m['semantic_type'];
                            if (m['unit']) candidateTable.metadata[fieldName].unit = m['unit'];
                            if (m['intrinsic_domain']) candidateTable.metadata[fieldName].intrinsicDomain = m['intrinsic_domain'];
                        }
                    }
                }

                const fieldDisplayNames = refinedGoal?.['field_display_names'];
                if (fieldDisplayNames && typeof fieldDisplayNames === 'object') {
                    for (const [fieldName, displayName] of Object.entries(fieldDisplayNames)) {
                        if (candidateTable.metadata[fieldName] && typeof displayName === 'string') {
                            candidateTable.metadata[fieldName].displayName = displayName;
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

                if (currentDraftId) {
                    dispatch(dfActions.removeDraftNode(currentDraftId));
                    currentDraftId = null;
                }
                createNextDraft(candidateTableId, []);

                if (createdCharts.length > 0) {
                    const lastChart = createdCharts[createdCharts.length - 1];
                    setTimeout(() => {
                        dispatch(fetchChartInsight({ chartId: lastChart.id, tableId: candidateTable.id }) as any);
                    }, 1500);
                }
            }

            // ── clarify: pause and let user respond ──
            if (result.type === "clarify") {
                const clarifyMsg = translateBackend(result.message, result.message_code, result.message_params) || t('chartRec.couldYouClarify');
                const rawOptions: string[] = Array.isArray(result.options) ? result.options : [];
                const clarifyOptions = translateBackendOptions(rawOptions, result.option_codes);
                if (currentDraftId) {
                    // Snapshot thinking steps into the clarify entry so they render
                    // inline (as 二级) between the user prompt and the clarify question.
                    const priorSteps = thinkingSteps.filter(s => s.trim()).join('\n');
                    thinkingSteps = [];
                    pendingThought = '';
                    dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId, plan: '' }));

                    const clarifyEntry: InteractionEntry = {
                        from: 'data-agent', to: 'user', role: 'clarify',
                        plan: priorSteps || result.thought || undefined,
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
                    if (currentDraftParentTableId) {
                        dispatch(dfActions.setFocused({ type: 'table', tableId: currentDraftParentTableId }));
                    }
                }
                setIsChatFormulating(false);
                agentAbortRef.current = null;
                clearTimeout(timeoutId);
                setChatPrompt("");
                setAttachedImages([]);
                isCompleted = true;
            }

            // ── completion: final summary ──
            if (result.type === "completion") {
                if (lastCreatedTableId) {
                    const rawSummary = result.content?.summary || "";
                    const summary = result.status === "max_iterations"
                        ? translateBackend(rawSummary, result.content?.summary_code) || t('chartRec.maxIterationsReached')
                        : rawSummary;
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
                setAttachedImages([]);
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

                                // Unified error event: {type: "error", error: {message, ...}}
                                if (data.type === "error") {
                                    const errMsg = data.error?.message || data.error_message || t('chartRec.errorDuringExploration');
                                    setIsChatFormulating(false);
                                    clearTimeout(timeoutId);
                                    dispatch(dfActions.addMessages({
                                        timestamp: Date.now(), type: 'error',
                                        component: 'data-agent', value: errMsg,
                                    }));
                                    if (currentDraftId) {
                                        dispatch(dfActions.appendDraftInteraction({ draftId: currentDraftId, entry: {
                                            from: 'data-agent', to: 'user', role: 'error',
                                            content: errMsg, timestamp: Date.now(),
                                        }}));
                                        dispatch(dfActions.updateDeriveStatus({ nodeId: currentDraftId, status: 'error' }));
                                        currentDraftId = null;
                                    }
                                    return;
                                }

                                if (data.type === "warning") {
                                    dispatch(dfActions.addMessages({
                                        timestamp: Date.now(), type: 'warning',
                                        component: 'data-agent',
                                        value: data.warning?.message ?? 'Warning from server',
                                    }));
                                    continue;
                                }

                                if (data.token === token) {
                                    if (data.status === "ok" && data.result) {
                                        allResults.push(data.result);
                                        processStreamingResult(data.result);
                                        if (data.result.type === "completion" || data.result.type === "clarify") { handleCompletion(); return; }
                                    } else if (data.status === "error") {
                                        const errMsg = data.error_message || t('chartRec.errorDuringExploration');
                                        setIsChatFormulating(false);
                                        clearTimeout(timeoutId);
                                        dispatch(dfActions.addMessages({
                                            timestamp: Date.now(), type: 'error',
                                            component: 'data-agent', value: errMsg,
                                        }));
                                        if (currentDraftId) {
                                            dispatch(dfActions.appendDraftInteraction({ draftId: currentDraftId, entry: {
                                                from: 'data-agent', to: 'user', role: 'error',
                                                content: errMsg, timestamp: Date.now(),
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
    }, [focusedTableId, tables, draftNodes, activeModel, config, conceptShelfItems, dispatch, t]);

    // ── Report generation via report agent ──────────────────────────

    const reportFromChat = useCallback(async (prompt: string) => {
        if (!focusedTableId) return;

        const cleanPrompt = prompt.trim() || 'Create a report summarizing the exploration.';

        setChatPrompt('');
        setIsChatFormulating(true);

        // Build available charts list
        const availableCharts = charts
            .filter(c => c.chartType !== 'Table' && c.chartType !== 'Auto')
            .filter(c => tables.some(t => t.id === c.tableRef))
            .map(c => {
                const tbl = tables.find(t => t.id === c.tableRef);
                const encodings: Record<string, string> = {};
                if (c.encodingMap) {
                    for (const [ch, enc] of Object.entries(c.encodingMap)) {
                        if ((enc as any)?.fieldID) {
                            const field = conceptShelfItems.find(f => f.id === (enc as any).fieldID);
                            if (field) encodings[ch] = field.name;
                        }
                    }
                }
                return {
                    chart_id: c.id,
                    chart_type: c.chartType,
                    encodings,
                    table_ref: tbl?.virtual?.tableId || c.tableRef,
                    code: tbl?.derive?.code || '',
                    chart_data: tbl ? { name: tbl.virtual?.tableId || tbl.id, rows: tbl.rows.slice(0, 50) } : undefined,
                };
            });

        const selectedChartIds = availableCharts.map(c => c.chart_id);

        // Create a report entry and switch to report view
        const reportId = `report-${Date.now()}`;
        const inProgressReport: GeneratedReport = {
            id: reportId,
            content: '',
            selectedChartIds,
            createdAt: Date.now(),
            status: 'generating',
            prompt: cleanPrompt,
            triggerTableId: focusedTableId,
        };
        dispatch(dfActions.saveGeneratedReport(inProgressReport));
        dispatch(dfActions.setFocused({ type: 'report', reportId }));
        dispatch(dfActions.setViewMode('report'));

        const actionTables = selectedTableIds.map(id => tables.find(t => t.id === id) as DictTable).filter(Boolean);

        const body = JSON.stringify({
            model: activeModel,
            input_tables: actionTables.map(t => ({
                name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ''),
            })),
            primary_tables: primaryTableIds.map(id => {
                const t = tables.find(tbl => tbl.id === id);
                return t?.virtual?.tableId || id.replace(/\.[^/.]+$/, '');
            }),
            charts: availableCharts,
            user_prompt: cleanPrompt,
        });

        const controller = new AbortController();
        agentAbortRef.current = controller;
        let accumulatedMarkdown = '';

        try {
            const response = await fetchWithIdentity(getUrls().GENERATE_REPORT_CHAT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: controller.signal,
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No reader');

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const event = JSON.parse(trimmed);
                        if (event.type === 'text_delta') {
                            accumulatedMarkdown += event.content;
                        } else if (event.type === 'error') {
                            const errMsg = event.error?.message || event.content || 'Unknown error';
                            accumulatedMarkdown += `\n\n**Error:** ${errMsg}`;
                            dispatch(dfActions.addMessages({
                                timestamp: Date.now(), type: 'error',
                                component: 'report-agent', value: errMsg,
                            }));
                        } else if (event.type === 'warning') {
                            dispatch(dfActions.addMessages({
                                timestamp: Date.now(), type: 'warning',
                                component: 'report-agent',
                                value: event.warning?.message ?? 'Warning from server',
                            }));
                        }
                        const titleMatch = accumulatedMarkdown.match(/^#\s+(.+)$/m);
                        dispatch(dfActions.updateGeneratedReportContent({
                            id: reportId,
                            content: accumulatedMarkdown,
                            title: titleMatch ? titleMatch[1].trim() : undefined,
                        }));
                    } catch { /* skip malformed lines */ }
                }
            }
            reader.releaseLock();

            // Final update with completed status
            const titleMatch = accumulatedMarkdown.match(/^#\s+(.+)$/m);
            dispatch(dfActions.updateGeneratedReportContent({
                id: reportId,
                content: accumulatedMarkdown,
                status: 'completed',
                title: titleMatch ? titleMatch[1].trim() : undefined,
            }));
        } catch (error: any) {
            if (error.name !== 'AbortError') {
                dispatch(dfActions.updateGeneratedReportContent({
                    id: reportId,
                    content: accumulatedMarkdown + `\n\n**Error:** ${error.message}`,
                    status: 'error',
                }));
            }
        } finally {
            agentAbortRef.current = null;
            setIsChatFormulating(false);
        }
    }, [focusedTableId, charts, tables, selectedTableIds, primaryTableIds, conceptShelfItems, activeModel, dispatch]);

    // ── Unified submit handler ───────────────────────────────────────
    const submitChat = useCallback((prompt: string, clarificationCtx?: any) => {
        if (selectedAgent === 'report') {
            reportFromChat(prompt);
        } else if (clarificationCtx) {
            exploreFromChat(prompt, clarificationCtx);
        } else {
            exploreFromChat(prompt);
        }
    }, [reportFromChat, exploreFromChat, selectedAgent]);

    const cancelAgent = useCallback(() => {
        if (agentAbortRef.current) {
            agentAbortRef.current.abort();
            agentAbortRef.current = null;
        }
        // Always clear busy state — the async finally blocks also clear this,
        // but a direct cancel should guarantee the UI unblocks immediately.
        setIsChatFormulating(false);
        // Also dismiss any pending clarification draft
        if (pendingClarification?.draftId) {
            dispatch(dfActions.removeDraftNode(pendingClarification.draftId));
        }
    }, [pendingClarification, dispatch, t]);

    const isReportMode = selectedAgent === 'report';
    const gradientBorder = isReportMode
        ? `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.6)}, ${alpha(theme.palette.warning.dark, 0.5)})`
        : `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.6)}, ${alpha(theme.palette.secondary.main, 0.55)})`;
    const workingBorder = isReportMode
        ? `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.3)}, ${alpha(theme.palette.warning.dark, 0.25)})`
        : `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.3)}, ${alpha(theme.palette.secondary.main, 0.25)})`;

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
            transition: 'box-shadow 0.25s ease, background-color 0.3s ease',
            backgroundColor: isChatFormulating
                ? alpha(theme.palette.action.disabledBackground, 0.06)
                : isReportMode
                    ? alpha(theme.palette.warning.main, 0.03)
                    : 'transparent',
            '&:focus-within': {
                boxShadow: `0 0 0 3px ${alpha(isReportMode ? theme.palette.warning.main : theme.palette.primary.main, 0.10)}`,
            },
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
                            const tagConfig: Record<string, { color: string; icon: React.ReactNode }> = {
                                'deep-dive': { color: theme.palette.primary.main, icon: <KeyboardDoubleArrowDownIcon sx={{ fontSize: 10 }} /> },
                                'pivot': { color: theme.palette.info.main, icon: <SyncAltIcon sx={{ fontSize: 10 }} /> },
                                'broaden': { color: theme.palette.success.main, icon: <OpenInFullIcon sx={{ fontSize: 10 }} /> },
                                'cross-data': { color: theme.palette.warning.main, icon: <CallMergeIcon sx={{ fontSize: 10, transform: 'rotate(180deg)' }} /> },
                                'statistical': { color: theme.palette.secondary.main, icon: <TrendingUpIcon sx={{ fontSize: 10 }} /> },
                            };
                            const cfg = tagConfig[idea.tag] || tagConfig['deep-dive'];
                            const color = cfg.color;
                            return (
                                <Box key={idx} sx={{
                                    px: '6px', py: '3px',
                                    borderRadius: '4px',
                                    border: `1px solid ${alpha(color, 0.2)}`,
                                    backgroundColor: alpha(color, 0.04),
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                    display: 'flex', alignItems: 'flex-start', gap: '3px',
                                    '&:hover': { borderColor: alpha(color, 0.6), backgroundColor: alpha(color, 0.08) },
                                }} onClick={() => { setChatPrompt(idea.text); exploreFromChat(idea.text); }}>
                                    <Box sx={{ color, mt: '1px', flexShrink: 0 }}>{cfg.icon}</Box>
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
            {/* Input area wrapper — ideas-loading overlay is scoped to this region */}
            <Box sx={{ position: 'relative' }}>
            {/* @-mention table chips and image attachments */}
            {(primaryTableIds.length > 0 || attachedImages.length > 0) && !isChatFormulating && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px', px: 0.5, pb: '2px' }}>
                    {primaryTableIds.map(id => {
                        const tbl = tables.find(t => t.id === id);
                        const isDefault = defaultPrimaryTableIds.includes(id);
                        return (
                            <Chip
                                key={id}
                                size="small"
                                label={`@${tbl?.displayId || id}`}
                                onDelete={isDefault ? undefined : () => setMentionedTableIds(prev => prev.filter(mid => mid !== id))}
                                sx={{
                                    height: 20,
                                    fontSize: 10,
                                    color: theme.palette.text.secondary,
                                    backgroundColor: 'rgba(0,0,0,0.04)',
                                    border: 'none',
                                    borderRadius: '4px',
                                    '& .MuiChip-label': { px: '6px' },
                                    '& .MuiChip-deleteIcon': { fontSize: 12, color: theme.palette.text.disabled, mr: '2px' },
                                }}
                            />
                        );
                    })}
                    {attachedImages.map((_, idx) => (
                        <Chip
                            key={`img-${idx}`}
                            size="small"
                            icon={<Box component="img" src={attachedImages[idx]} sx={{ width: 14, height: 14, objectFit: 'cover', borderRadius: '2px' }} />}
                            label={`image${attachedImages.length > 1 ? idx + 1 : ''}`}
                            onDelete={() => setAttachedImages(prev => prev.filter((_, i) => i !== idx))}
                            sx={{
                                height: 20,
                                fontSize: 10,
                                color: theme.palette.text.secondary,
                                backgroundColor: 'rgba(0,0,0,0.04)',
                                border: 'none',
                                borderRadius: '4px',
                                '& .MuiChip-label': { px: '4px' },
                                '& .MuiChip-icon': { ml: '4px', mr: '-2px' },
                                '& .MuiChip-deleteIcon': { fontSize: 12, color: theme.palette.text.disabled, mr: '2px' },
                            }}
                        />
                    ))}
                </Box>
            )}
            {/* @-mention dropdown */}
            <Popper open={mentionDropdownOpen && mentionAvailableTables.length > 0} anchorEl={inputCardRef.current} placement="top-start" style={{ zIndex: 1300 }}>
                <Paper elevation={4} sx={{ maxHeight: 200, overflow: 'auto', minWidth: 180, mb: 0.5 }}>
                    <MenuList dense sx={{ py: 0.5 }}>
                        {mentionAvailableTables.map((opt, idx) => (
                            <MenuItem
                                key={opt.id}
                                selected={idx === mentionHighlightIdx}
                                sx={{ fontSize: 11, py: 0.5 }}
                                onClick={() => confirmMention(opt.id)}
                            >
                                @{opt.displayId || opt.id}
                            </MenuItem>
                        ))}
                    </MenuList>
                </Paper>
            </Popper>
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
                onChange={(event: any) => {
                    if (isChatFormulating) return;
                    const val = event.target.value;
                    // Open dropdown when @ is typed
                    if (!mentionDropdownOpen && val.includes('@')) {
                        const lastAt = val.lastIndexOf('@');
                        const afterAt = val.slice(lastAt + 1);
                        // Only open if @ is at end or followed by partial filter (no space yet)
                        if (!afterAt.includes(' ')) {
                            setMentionDropdownOpen(true);
                            setMentionHighlightIdx(0);
                        }
                    }
                    // Close dropdown if no active @ remaining
                    if (mentionDropdownOpen) {
                        const lastAt = val.lastIndexOf('@');
                        if (lastAt < 0 || val.slice(lastAt + 1).includes(' ')) {
                            setMentionDropdownOpen(false);
                            setMentionHighlightIdx(0);
                        }
                    }
                    // Remove mentioned tables whose @name is no longer in the text
                    setMentionedTableIds(prev => prev.filter(id => {
                        const tbl = tables.find(t2 => t2.id === id);
                        const name = tbl?.displayId || id;
                        return val.includes(`@${name}`);
                    }));
                    setChatPrompt(val);
                }}
                onKeyDown={(event: any) => {
                    // @-mention keyboard navigation
                    if (mentionDropdownOpen && mentionAvailableTables.length > 0) {
                        if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            setMentionHighlightIdx(prev => Math.min(prev + 1, mentionAvailableTables.length - 1));
                            return;
                        }
                        if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            setMentionHighlightIdx(prev => Math.max(prev - 1, 0));
                            return;
                        }
                        if (event.key === 'Tab' || event.key === 'Enter') {
                            event.preventDefault();
                            confirmMention(mentionAvailableTables[mentionHighlightIdx].id);
                            return;
                        }
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            setMentionDropdownOpen(false);
                            setMentionHighlightIdx(0);
                            return;
                        }
                    }
                    if (event.key === 'Tab' && !event.shiftKey && chatPrompt.trim() === '' && !isChatFormulating) {
                        event.preventDefault();
                        setChatPrompt(isReportMode ? t('chartRec.threadReportPrompt') : t('chartRec.threadExplorePrompt'));
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (chatPrompt.trim().length > 0 && !isChatFormulating) {
                            if (pendingClarification) {
                                submitChat(chatPrompt, pendingClarification);
                            } else {
                                submitChat(chatPrompt);
                            }
                        }
                    }
                }}
                onPaste={handlePaste}
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
                placeholder={pendingClarification ? t('chartRec.replyPlaceholder') : isReportMode ? t('chartRec.reportPlaceholder') : t('chartRec.explorePlaceholder')}
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
                    {/* Agent mode toggle */}
                    <Tooltip title={selectedAgent === 'explore' ? t('chartRec.switchToReport') : t('chartRec.switchToExplore')}>
                        <Button
                            size="small"
                            onClick={() => setSelectedAgent(prev => prev === 'explore' ? 'report' : 'explore')}
                            sx={{
                                textTransform: 'none',
                                fontSize: 10,
                                minWidth: 0,
                                px: 0.75,
                                py: 0,
                                height: 20,
                                color: isReportMode ? theme.palette.warning.main : theme.palette.primary.main,
                                borderRadius: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '2px',
                                '&:hover': { backgroundColor: alpha(isReportMode ? theme.palette.warning.main : theme.palette.primary.main, 0.08) },
                            }}
                        >
                            {selectedAgent === 'explore'
                                ? <AutoGraphIcon sx={{ fontSize: '10px !important' }} />
                                : <DescriptionOutlinedIcon sx={{ fontSize: '10px !important' }} />}
                            {selectedAgent === 'explore' ? t('chartRec.modeExplore') : t('chartRec.modeReport')}
                        </Button>
                    </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                {isChatFormulating ? (
                    <CircularProgress size={18} sx={{ m: 0.5 }} />
                ) : (
                    <>
                        {!isReportMode && (
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
                        )}
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
                                            submitChat(chatPrompt, pendingClarification);
                                        } else {
                                            submitChat(chatPrompt);
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
            {/* Ideas-loading overlay — scoped to input area only, keeps idea chips visible */}
            {isLoadingIdeas && !isChatFormulating && (
                <AgentWorkingOverlay 
                    message={t('chartRec.generatingIdeas')}
                    theme={theme}
                    onCancel={() => { ideasAbortRef.current?.abort(); ideasAbortRef.current = null; setIsLoadingIdeas(false); setIdeas([]); }}
                />
            )}
            </Box>
            {/* Agent working overlay — covers entire card during chat formulation */}
            {isChatFormulating && (
                <AgentWorkingOverlay 
                    message={draftNodes.find(d => d.derive?.status === 'running' && threadTableIds.has(d.derive.trigger.tableId))
                            ?.derive?.runningPlan}
                    theme={theme}
                    onCancel={cancelAgent}
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
