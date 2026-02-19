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
} from '@mui/material';

import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors, fetchCodeExpl, fetchFieldSemanticType, fetchChartInsight, generateFreshChart } from '../app/dfSlice';
import { resolveRecommendedChart, getUrls, fetchWithIdentity, getTriggers } from '../app/utils';
import { Chart, DictTable, FieldItem, createDictTable } from "../components/ComponentType";

import { alpha } from '@mui/material/styles';
import SendIcon from '@mui/icons-material/Send';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { renderTextWithEmphasis } from './EncodingShelfCard';
import { UnifiedDataUploadDialog } from './UnifiedDataUploadDialog';
import { ThinkingBufferEffect } from '../components/FunComponents';

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
    const dispatch = useDispatch();

    const [chatPrompt, setChatPrompt] = useState("");
    const [isChatFormulating, setIsChatFormulating] = useState(false);
    const [expanded, setExpandedRaw] = useState(false);
    const setExpanded = useCallback((v: boolean) => { setExpandedRaw(v); onExpandedChange?.(v || isChatFormulating); }, [onExpandedChange, isChatFormulating]);
    const [ideas, setIdeas] = useState<{text: string, goal: string, difficulty: 'easy' | 'medium' | 'hard'}[]>([]);
    const [isLoadingIdeas, setIsLoadingIdeas] = useState(false);
    const [thinkingBuffer, setThinkingBuffer] = useState('');
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

    // Notify parent when formulating state changes
    useEffect(() => {
        onExpandedChange?.(expanded || isChatFormulating);
    }, [isChatFormulating]);

    const inputCardRef = useRef<HTMLDivElement>(null);
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

    // Agent actions relevant to the focused table
    const relevantAgentActions = React.useMemo(() => {
        if (!focusedTableId) return [];
        return agentActions.filter(a => a.tableId === focusedTableId && !a.hidden);
    }, [agentActions, focusedTableId]);
    const hasRunningAgent = relevantAgentActions.some(a => a.status === 'running');
    const hasAgentMessages = relevantAgentActions.length > 0;

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
        dispatch(dfActions.updateAgentWorkInProgress({ actionId, tableId: focusedTableId, description: prompt, status: 'running', hidden: false }));

        const token = String(Date.now());
        const messageBody = JSON.stringify({
            token,
            input_tables: actionTables.map(t => ({
                name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
                rows: t.rows,
                attached_metadata: t.attachedMetadata
            })),
            initial_plan: [prompt],
            model: activeModel,
            max_iterations: 3,
            agent_exploration_rules: agentRules.exploration,
            agent_coding_rules: agentRules.coding
        });

        const controller = new AbortController();
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
                dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: result.content.message, status: 'running', hidden: false }));
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
                dispatch(dfActions.updateAgentWorkInProgress({ actionId, tableId: candidateTable.id, description: '', status: 'running', hidden: false }));

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
            clearTimeout(timeoutId);

            const completionResult = allResults.find((r: any) => r.type === "completion");
            if (completionResult) {
                const summary = completionResult.content.message || "";
                const status: "completed" | "warning" = completionResult.status === "success" ? "completed" : "warning";
                dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: summary, status, hidden: false }));
                setChatPrompt("");
            } else {
                dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: "The agent got lost in the data.", status: 'warning', hidden: false }));
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
                                        dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: data.error_message || "Error during exploration", status: 'failed', hidden: false }));
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
            clearTimeout(timeoutId);
            const errorMessage = error.name === 'AbortError' ? "Exploration timed out" : `Exploration failed: ${error.message}`;
            dispatch(dfActions.updateAgentWorkInProgress({ actionId, description: errorMessage, status: 'failed', hidden: false }));
        });
    }, [focusedTableId, tables, activeModel, agentRules, config, conceptShelfItems, dispatch]);

    const inputBox = (
        <Card ref={inputCardRef} variant="outlined" sx={{
            display: 'flex', flexDirection: 'column',
            mx: 1, mb: 1, mt: 0.5,
            px: 1, pt: 0.5, pb: 0.25,
            borderWidth: 1.5,
            borderColor: alpha(theme.palette.primary.main, 0.5),
            borderRadius: '8px',
            overflow: 'visible',
            flexShrink: 0,
            position: 'relative',
            zIndex: expanded ? 11 : 0,
            cursor: !expanded ? 'pointer' : undefined,
            transition: 'box-shadow 0.2s ease',
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
                }}
                onChange={(event: any) => { setChatPrompt(event.target.value); }}
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
                slotProps={{ inputLabel: { shrink: true } }}
                value={chatPrompt}
                placeholder={"explore a new direction"}
                fullWidth
                multiline
                minRows={2}
                maxRows={4}
                disabled={isChatFormulating}
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
                                    sx={{ p: 0.5, color: theme.palette.warning.main }}
                                    disabled={!focusedTableId || isLoadingIdeas}
                                    onClick={() => { getIdeasFromAgent(); }}
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
                    maxHeight: (expanded && (ideas.length > 0 || isLoadingIdeas || hasAgentMessages)) ? '240px' : '0px',
                    opacity: (expanded && (ideas.length > 0 || isLoadingIdeas || hasAgentMessages)) ? 1 : 0,
                    transform: (expanded && (ideas.length > 0 || isLoadingIdeas || hasAgentMessages)) ? 'translateY(0)' : 'translateY(8px)',
                    transition: 'max-height 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease, transform 0.25s ease',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    mx: 1,
                    borderRadius: '8px',
                    background: theme.palette.background.paper,
                    boxShadow: expanded ? '0 -4px 20px rgba(0,0,0,0.12)' : 'none',
                    border: expanded ? `1px solid ${theme.palette.divider}` : 'none',
                }}>
                    {/* Floating close button */}
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
                        <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                    {/* Agent status messages / Idea suggestions */}
                    <Box sx={{
                        flex: 1,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        px: 1.5, py: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                    }}>
                        {/* Agent action messages */}
                        {hasAgentMessages && (
                            <>
                                {relevantAgentActions.map((action, idx) => {
                                    const statusColor = action.status === 'completed' ? theme.palette.success.main
                                        : action.status === 'failed' ? theme.palette.error.main
                                        : action.status === 'warning' ? theme.palette.warning.main
                                        : theme.palette.text.secondary;
                                    const StatusIcon = action.status === 'completed' ? CheckCircleOutlineIcon
                                        : action.status === 'failed' ? CancelOutlinedIcon
                                        : action.status === 'warning' ? HelpOutlineIcon
                                        : null;
                                    return (
                                        <Box key={action.actionId + '-' + idx} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                                            {action.status === 'running' ? (
                                                <ThinkingBufferEffect text={action.description || 'thinking...'} sx={{ width: '100%' }} />
                                            ) : (
                                                <>
                                                    {StatusIcon && <StatusIcon sx={{ fontSize: 12, color: statusColor, mt: '2px', flexShrink: 0 }} />}
                                                    <Typography sx={{ fontSize: 10, color: statusColor, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                                        {action.description}
                                                    </Typography>
                                                    <IconButton
                                                        size="small"
                                                        onClick={(e) => { e.stopPropagation(); dispatch(dfActions.deleteAgentWorkInProgress(action.actionId)); }}
                                                        sx={{ p: 0, width: 14, height: 14, flexShrink: 0, ml: 'auto',
                                                            '& .MuiSvgIcon-root': { fontSize: 10, color: 'darkgray' } }}
                                                    >
                                                        <CloseIcon />
                                                    </IconButton>
                                                </>
                                            )}
                                        </Box>
                                    );
                                })}
                            </>
                        )}
                        {/* Idea suggestions */}
                        {isLoadingIdeas && ideas.length === 0 && !hasAgentMessages ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                                <ThinkingBufferEffect text={thinkingBuffer.slice(-60) || 'thinking...'} sx={{ width: '100%' }} />
                            </Box>
                        ) : !hasAgentMessages && ideas.length === 0 ? (
                            <Typography variant="caption" sx={{ color: theme.palette.text.disabled, fontSize: 11 }}>
                                Click 💡 to get exploration ideas for your data.
                            </Typography>
                        ) : (
                            ideas.map((idea, idx) => {
                                const color = idea.difficulty === 'easy' ? theme.palette.success.main
                                    : idea.difficulty === 'hard' ? theme.palette.warning.main
                                    : theme.palette.primary.main;
                                return (
                                    <Box
                                        key={idx}
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            px: 1, py: 0.75,
                                            borderRadius: '6px',
                                            border: `1px solid ${alpha(color, 0.2)}`,
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease',
                                            '&:hover': {
                                                borderColor: alpha(color, 0.6),
                                                background: alpha(color, 0.04),
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
                            })
                        )}
                        {isLoadingIdeas && thinkingBuffer && ideas.length > 0 && (
                            <ThinkingBufferEffect text={thinkingBuffer.slice(-60)} sx={{ width: '100%' }} />
                        )}
                    </Box>
                </Box>
            </Box>
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
