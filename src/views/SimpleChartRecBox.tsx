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
    Chip,
    Popper,
    Paper,
    MenuList,
    MenuItem,
} from '@mui/material';

import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors, fetchCodeExpl, fetchFieldSemanticType, generateFreshChart, GeneratedReport } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { resolveRecommendedChart, getUrls, getTriggers, translateBackend } from '../app/utils';
import { streamRequest } from '../app/apiClient';
import { getErrorMessage } from '../app/errorCodes';
import { persistEphemeralDerivedTable } from '../app/tableThunks';
import { Chart, ClarificationResponse, DictTable, FieldItem, createDictTable, InteractionEntry, computeInsightKey } from "../components/ComponentType";
import { normalizeClarifyEvent, formatClarificationResponses } from '../app/clarification';

import { alpha } from '@mui/material/styles';
import { WritingPencil } from '../components/FunComponents';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import StopIcon from '@mui/icons-material/Stop';

import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { borderColor, transition } from '../app/tokens';
import { Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { shouldAutoFocusGeneratedChart } from '../app/agentInteractionPolicy';
import { ClarificationPanel, DelegatePanel, ExplanationPanel } from './AgentPausePanel';

// Seed prompt used when the user invokes "report" mode (or a report hand-off)
// without typing an explicit instruction. The unified analyst loads its
// `report` skill and emits `write_report` within a normal explore run.
const REPORT_SEED_PROMPT = 'Write a report summarizing the exploration.';

const AgentWorkingOverlay: FC<{ message?: string; elapsed?: number; theme: Theme; onCancel?: () => void; color?: 'primary' | 'warning' }> = ({ message, elapsed, theme, onCancel, color = 'primary' }) => {
    const { t } = useTranslation();
    // `message` is the running plan: steps joined by the STEP_SEP control char
    // ('\x1E'), which renders invisibly and would otherwise collapse every step
    // into one run-on blob. This overlay is a compact status, so show only the
    // latest (active) step rather than the whole accumulated trace.
    const latestStep = (message ?? '')
        .split('\x1E')
        .map(s => s.trim())
        .filter(Boolean)
        .pop();
    const latestMessage = latestStep || t('dataThread.thinking');
    const elapsedSuffix = elapsed != null && elapsed > 0 ? ` (${elapsed}s)` : '';
    const progressColor = color === 'warning' ? theme.palette.warning.main : theme.palette.primary.main;
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
            <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0.75 }}>
                <WritingPencil size={12} />
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, fontSize: 11.5, lineHeight: 1.4 }}>
                    {t('chartRec.agentWorking')}
                </Typography>
            </Box>
            {onCancel && (
                <Tooltip title={t('dataLoading.stopTooltip', { defaultValue: 'Stop' })} placement="top">
                    <IconButton
                        size="small"
                        onClick={onCancel}
                        sx={{
                            position: 'absolute', bottom: 8, right: 8,
                            width: 24, height: 24, p: 0,
                            bgcolor: 'transparent',
                            color: 'error.main',
                            '&:hover': {
                                bgcolor: alpha(theme.palette.error.main, 0.08),
                                color: 'error.dark',
                            },
                        }}
                    >
                        <StopIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                </Tooltip>
            )}
            <Typography variant="body2" sx={{
                color: 'text.disabled',
                fontSize: 11,
                textAlign: 'center',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                lineHeight: 1.45,
                wordBreak: 'break-word',
            }}>
                {latestMessage}{elapsedSuffix}
            </Typography>
            <LinearProgress sx={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, borderRadius: '0 0 8px 8px',
                backgroundColor: alpha(progressColor, 0.15),
                '& .MuiLinearProgress-bar': { backgroundColor: progressColor },
            }} />
        </Box>
    );
};

export const SimpleChartRecBox: FC<{ onInputFocus?: () => void }> = function ({ onInputFocus }) {

    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const charts = useSelector(dfSelectors.getAllCharts);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const config = useSelector((state: DataFormulatorState) => state.config);
    const activeModel = useSelector(dfSelectors.getActiveModel);
    const workspaceBackend = useSelector((state: DataFormulatorState) => state.serverConfig.WORKSPACE_BACKEND);
    const activeWorkspaceId = useSelector((state: DataFormulatorState) => state.activeWorkspace?.id);
    const draftNodes = useSelector((state: DataFormulatorState) => state.draftNodes);

    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const [chatPrompt, setChatPrompt] = useState("");
    // ── Clarification accumulated answers ────────────────────────────
    // When the agent asks one or more clarification questions, clicking an
    // option does NOT submit immediately and does NOT mutate the chat box.
    // We just track the selections here. The agent is invoked when the LAST
    // question is answered via clicks, OR when the user explicitly hits
    // Send / Enter (at which point the selections are formatted into a
    // "Selected answers: ..." prefix and prepended to the typed message).
    const [clarifyAnswers, setClarifyAnswers] = useState<Record<number, ClarificationResponse>>({});
    // Guards against double-submit when the user rapidly clicks the last
    // option twice (state updates are async, so a second click can re-enter
    // handleSelectAnswer with a stale closure before pendingClarification
    // clears). Tracks the draftId we've already auto-submitted for.
    const clarifySubmittedRef = useRef<string | null>(null);
    const [isChatFormulating, setIsChatFormulating] = useState(false);
    const [mentionedTableIds, setMentionedTableIds] = useState<string[]>([]);
    const [mentionDropdownOpen, setMentionDropdownOpen] = useState(false);
    const [mentionHighlightIdx, setMentionHighlightIdx] = useState(0);
    const [attachedImages, setAttachedImages] = useState<string[]>([]);
    const [attachedFiles, setAttachedFiles] = useState<{ name: string; content: string }[]>([]);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const agentAbortRef = useRef<AbortController | null>(null);
    const userChartFocusLockedRef = useRef(false);
    const lastAutoFocusedChartIdRef = useRef<string | null>(null);
    // Whether we've already auto-focused an artifact during the current
    // agent run. We only jump focus once per run (to the FIRST generated
    // chart), so the user isn't yanked around as further charts stream in.
    // Subsequent artifacts rely on the "freshly created" highlight + NEW
    // tag for discoverability instead.
    const firstFocusedThisRunRef = useRef(false);

    useEffect(() => {
        if (!isChatFormulating) {
            userChartFocusLockedRef.current = false;
            lastAutoFocusedChartIdRef.current = null;
            firstFocusedThisRunRef.current = false;
            return;
        }
        if (focusedId?.type === 'chart') {
            if (focusedId.chartId !== lastAutoFocusedChartIdRef.current) {
                userChartFocusLockedRef.current = true;
            }
        } else {
            userChartFocusLockedRef.current = false;
        }
    }, [focusedId, isChatFormulating]);

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

    // Attach files as conversation context. Images become reference images
    // (sent to the model as attachments); text-like files are read as text
    // and folded into the agent prompt as context.
    const handleAttachFiles = React.useCallback((fileList: FileList | null) => {
        if (!fileList) return;
        const MAX_TEXT_CHARS = 50000;
        Array.from(fileList).forEach(file => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = () => setAttachedImages(prev => [...prev, reader.result as string]);
                reader.readAsDataURL(file);
            } else {
                const reader = new FileReader();
                reader.onload = () => {
                    let content = (reader.result as string) || '';
                    if (content.length > MAX_TEXT_CHARS) {
                        content = content.slice(0, MAX_TEXT_CHARS) + '\n…[truncated]';
                    }
                    setAttachedFiles(prev => [...prev, { name: file.name, content }]);
                };
                reader.readAsText(file);
            }
        });
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

    // Extract the active structured clarification (or explanation) from
    // DraftNode interaction log. Both are stored as ClarificationQuestion[]
    // — the entry's role ('clarify' vs 'explain') is what differs.
    // `delegate` pauses share the same slot but render a different panel
    // (a one-click handoff to the target peer agent).
    const clarificationQuestions = React.useMemo(() => {
        if (!pendingClarification?.draftId) return null;
        const draft = draftNodes.find(d => d.id === pendingClarification.draftId);
        const interaction = draft?.derive?.trigger?.interaction || [];
        // Find the most recent pause entry (clarify / explain / delegate).
        for (let i = interaction.length - 1; i >= 0; i--) {
            const entry = interaction[i];
            if (entry.role === 'delegate') {
                return {
                    kind: 'delegate' as const,
                    target: entry.delegateTarget || 'data_loading',
                    message: entry.content || '',
                    options: entry.delegateOptions || [],
                };
            }
            if (entry.role === 'clarify' || entry.role === 'explain') {
                return {
                    kind: 'clarification' as const,
                    questions: entry.clarificationQuestions || null,
                    variant: entry.role === 'explain' ? 'explain' as const : 'clarify' as const,
                    content: entry.content || '',
                };
            }
        }
        return null;
    }, [pendingClarification, draftNodes]);

    // ── Shared structured thread context builder (Tier 2 + Tier 3) ──
    // Produces the focused/peripheral thread context used by the analyst
    // (exploreFromChat), so the report has the actual exploration narrative —
    // user questions, agent thinking, findings — instead of just a flat list
    // of charts.
    const buildThreadContext = useCallback((targetTableId: string): {
        focusedThread: any[] | undefined;
        otherThreads: any[] | undefined;
    } => {
        // Tier 2: Focused thread — detailed per-step info
        const focusedSteps: any[] = [];
        let walkTable = tables.find(t => t.id === targetTableId);
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

            focusedSteps.unshift(step);

            walkTable = tables.find(t => t.id === trigger.tableId);
        }
        const focusedThread = focusedSteps.length > 0 ? focusedSteps : undefined;

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

            const STEP_FINDING_CHAR_LIMIT = 200;
            const steps: string[] = [];
            for (const trig of triggers) {
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
                // Per-step agent commentary: the `summary` entry that the
                // visualize action emits after running this step.
                let finding = trig.interaction?.find(
                    (e: InteractionEntry) => e.role === 'summary',
                )?.content?.trim() || '';
                if (finding.length > STEP_FINDING_CHAR_LIMIT) {
                    finding = finding.slice(0, STEP_FINDING_CHAR_LIMIT - 1).trimEnd() + '…';
                }
                const head = `${label}${chartType ? ` → ${chartType}` : ''}${encStr ? ` (${encStr})` : ''}`;
                steps.push(finding ? `${head} — finding: ${finding}` : head);
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
        const otherThreads = peripheralThreads.length > 0 ? peripheralThreads : undefined;

        return { focusedThread, otherThreads };
    }, [tables, charts, conceptShelfItems]);

    const exploreFromChat = useCallback((prompt: string, clarificationContext?: {
        trajectory: any[];
        completedStepCount: number;
        actionId: string;
        lastCreatedTableId: string | null;
    }, displayPrompt?: string) => {
        if (!focusedTableId || (!clarificationContext && prompt.trim() === "")) return;

        // Fold attached reference files into the prompt the agent sees, while
        // keeping the timeline bubble (displayContent) clean for the user.
        const fileContext = attachedFiles.length > 0
            ? '\n\n' + attachedFiles.map(f => `[Attached file: ${f.name}]\n${f.content}`).join('\n\n')
            : '';
        const agentPrompt = prompt + fileContext;
        const cleanDisplay = displayPrompt ?? (fileContext ? prompt : undefined);

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

        // Seed the auto-focus baseline with whatever chart the user is
        // currently looking at. Otherwise the lock effect would compare the
        // current focused chart to `null` on run-start and trip immediately,
        // blocking the first-artifact auto-focus.
        lastAutoFocusedChartIdRef.current = focusedId?.type === 'chart' ? focusedId.chartId : null;
        firstFocusedThisRunRef.current = false;
        userChartFocusLockedRef.current = false;

        setIsChatFormulating(true);

        // DraftNode handles status
        // If resuming from a clarify or explain pause, reuse the old draft
        // (append reply, clear pause state). Both pause types share the
        // 'clarifying' status and pendingClarification storage.
        if (isResume && pendingClarification?.draftId) {
            dispatch(dfActions.appendDraftInteraction({ draftId: pendingClarification.draftId, entry: {
                from: 'user', to: 'data-agent', role: 'prompt', content: agentPrompt,
                ...(cleanDisplay ? { displayContent: cleanDisplay } : {}),
                timestamp: Date.now()
            }}));
            dispatch(dfActions.updateDraftClarification({ draftId: pendingClarification.draftId, pendingClarification: null }));
            dispatch(dfActions.updateDeriveStatus({ nodeId: pendingClarification.draftId, status: 'running' }));
        }

        // ── Build structured thread context (Tier 2 + Tier 3) ──
        // Skip on resume — the trajectory already carries the prior context.
        const { focusedThread, otherThreads } = isResume
            ? { focusedThread: undefined, otherThreads: undefined }
            : buildThreadContext(focusedTableId);

        // Resolve primary table names from primaryTableIds (includes defaults + @-mentioned)
        const primaryTableNames = primaryTableIds.map(id => {
            const t = tables.find(tbl => tbl.id === id);
            return t?.virtual?.tableId || id.replace(/\.[^/.]+$/, "");
        });
        const requestBody: any = {
            input_tables: actionTables.map(t => ({
                name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
            })),
            primary_tables: primaryTableNames,
            ...(attachedImages.length > 0 ? { attached_images: attachedImages } : {}),
            model: activeModel,
            max_iterations: 10,
            agent_mode: config.miniMode ? 'mini' : 'standard',
        };

        // ── Route through the unified AnalystAgent (design-35/36) ──
        // The unified agent can also write reports inside the same run, so we
        // ship the available charts (same shape the report flow gets) for the
        // report skill's inspect_chart.
        const streamUrl = getUrls().ANALYST_STREAMING;
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
        requestBody.charts = availableCharts;

        if (isResume) {
            // Resume: just send the assembled prompt as user_question. The
            // backend appends it to the trajectory as a normal user message.
            // No special clarification payload needed.
            requestBody.trajectory = clarificationContext!.trajectory;
            requestBody.user_question = agentPrompt;
            requestBody.completed_step_count = clarificationContext!.completedStepCount;
        } else {
            requestBody.user_question = agentPrompt;
            if (focusedThread) requestBody.focused_thread = focusedThread;
            if (otherThreads) requestBody.other_threads = otherThreads;
        }

        const messageBody = JSON.stringify(requestBody);

        const controller = new AbortController();
        agentAbortRef.current = controller;
        let timedOut = false;
        const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, config.formulateTimeoutSeconds * 6 * 1000);

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

        // Create the initial draft (or reuse existing for clarification / explanation resume)
        if (isResume && pendingClarification?.draftId) {
            currentDraftId = pendingClarification.draftId;
            // Seed local accumulator from the existing draft's interaction (fresh at this point)
            const existingDraft = draftNodes.find(d => d.id === pendingClarification.draftId);
            currentDraftParentTableId = existingDraft?.derive?.trigger?.tableId || null;
            currentDraftInteraction = [...(existingDraft?.derive?.trigger?.interaction || [])];
            // The user reply was already appended above, add to local accumulator too
            currentDraftInteraction.push({ from: 'user', to: 'data-agent', role: 'prompt', content: agentPrompt,
                ...(cleanDisplay ? { displayContent: cleanDisplay } : {}),
                timestamp: Date.now() });
        } else {
            const initialEntries: InteractionEntry[] = [
                { from: 'user', to: 'data-agent', role: 'prompt', content: agentPrompt,
                    ...(cleanDisplay ? { displayContent: cleanDisplay } : {}),
                    timestamp: Date.now() }
            ];
            createNextDraft(lastCreatedTableId || focusedTableId!, initialEntries);
        }

        // Track the last agent display_instruction (from "action" events)
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

        // ── Live report streaming (AnalystAgent only) ──
        // The unified agent can write a report inside the same run: it emits an
        // `action`(write_report) commitment followed by `text_delta` events on
        // channel "report". We create a GeneratedReport on first signal, switch
        // to the report view, and stream the markdown in — coalescing (90ms
        // flush so Tiptap re-parses ~10×/sec instead of per-token).
        let reportId: string | null = null;
        let accumulatedReportMarkdown = '';
        let reportLastDispatched = '';
        let reportFlushTimer: ReturnType<typeof setTimeout> | null = null;
        // Ids of charts created during THIS run, adopted from the backend's
        // forwarded chart_id. Merged into the report's selectedChartIds so a
        // same-run report can embed them via chart://<id>.
        const runCreatedChartIds: string[] = [];
        const reportFlushNow = () => {
            if (reportFlushTimer) { clearTimeout(reportFlushTimer); reportFlushTimer = null; }
            if (!reportId || accumulatedReportMarkdown === reportLastDispatched) return;
            reportLastDispatched = accumulatedReportMarkdown;
            const titleMatch = accumulatedReportMarkdown.match(/^#\s+(.+)$/m);
            dispatch(dfActions.updateGeneratedReportContent({
                id: reportId,
                content: accumulatedReportMarkdown,
                title: titleMatch ? titleMatch[1].trim() : undefined,
            }));
        };
        const reportScheduleFlush = () => {
            if (reportFlushTimer) return;
            reportFlushTimer = setTimeout(() => { reportFlushTimer = null; reportFlushNow(); }, 90);
        };
        const ensureReport = () => {
            if (reportId) return reportId;
            const newId = `report-${Date.now()}`;
            const inProgressReport: GeneratedReport = {
                id: newId,
                content: '',
                selectedChartIds: Array.from(new Set([
                    ...availableCharts.map(c => c.chart_id),
                    ...runCreatedChartIds,
                ])),
                createdAt: Date.now(),
                status: 'generating',
                prompt: agentPrompt,
                // Anchor to the run's current table (the draft's table) so the
                // thread can render the generating card. While streaming, the
                // card is rendered INSIDE the draft block (after the thinking
                // steps) — never via pushReportItems — so it sits below the
                // prompt, not above it. On completion it flips to 'completed'
                // and pushReportItems renders it in the artifact slot.
                triggerTableId: lastCreatedTableId || focusedTableId,
            };
            dispatch(dfActions.saveGeneratedReport(inProgressReport));
            dispatch(dfActions.setFocused({ type: 'report', reportId: newId }));
            dispatch(dfActions.setViewMode('report'));
            reportId = newId;
            return newId;
        };

        const processStreamingResult = async (result: any) => {
            // ── interact: the unified agent's clarify/explain pause ──
            // Alias to the legacy clarify path (same questions[] shape + the
            // backend now stamps trajectory/completed_step_count for resume).
            if (result.type === "interact") {
                result = { ...result, type: "clarify" };
            }

            // ── report streaming (AnalystAgent only) ──
            // write_report commitment → create the report + switch view.
            if (result.type === "action" && result.action === "write_report") {
                ensureReport();
                // Flush any buffered agent reasoning as its own step. We do NOT
                // add an "outputting write_report" step — the live generating
                // report card already indicates that the report is being
                // written, so the explicit step would be redundant.
                if (pendingThought) {
                    thinkingSteps.push(pendingThought);
                    pendingThought = '';
                    if (currentDraftId) {
                        dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId, plan: thinkingSteps.join(STEP_SEP) }));
                    }
                }
                return;
            }
            // report-channel markdown deltas → stream into the report content.
            if (result.type === "text_delta" && result.channel === "report") {
                ensureReport();
                accumulatedReportMarkdown += result.content || '';
                reportScheduleFlush();
                return;
            }

            // ── context_info: show injected rules/knowledge at the top ──
            // Rendered as already-completed tool-style steps (✓ prefix) so they
            // visually match the rest of the agent's tool-call timeline.
            if (result.type === "context_info") {
                const rules: string[] = result.rules_injected || [];
                const knowledge: Array<{category: string; title: string}> = result.knowledge_injected || [];
                let added = false;
                if (rules.length > 0) {
                    thinkingSteps.push('✓ ' + t('dataThread.rulesLoaded', { rules: rules.join(', ') }));
                    added = true;
                }
                if (knowledge.length > 0) {
                    const titles = knowledge.map(k => k.title).join(', ');
                    thinkingSteps.push('✓ ' + t('dataThread.knowledgeLoaded', { knowledge: titles }));
                    added = true;
                }
                if (added && currentDraftId) {
                    dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId, plan: thinkingSteps.join(STEP_SEP) }));
                }
            }

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
            if (result.type === "tool_start") {
                // Show pending thought as a visible step before the tool step
                if (pendingThought) {
                    thinkingSteps.push(pendingThought);
                    pendingThought = '';
                }
                if (result.tool === "explore" || result.tool === "execute_python_script") {
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
                } else if (result.tool === "inspect_chart") {
                    thinkingSteps.push(t('dataThread.inspectingChart'));
                } else if (result.tool === "load_skill") {
                    thinkingSteps.push(t('dataThread.loadingSkill', { skill: result.skill || '' }));
                } else if (result.tool === "search_data_tables" || result.tool === "search_knowledge") {
                    const query = result.query || '';
                    thinkingSteps.push(t('dataThread.searching') + (query ? ` "${query}"` : ''));
                } else if (["visualize", "clarify", "present", "action"].includes(result.tool)) {
                    thinkingSteps.push(t('dataThread.producingAction', { action: result.tool }));
                }
                if (currentDraftId) {
                    dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId, plan: thinkingSteps.join(STEP_SEP) }));
                }
            }

            // ── tool_result: mark the last tool step as done ──
            if (result.type === "tool_result") {
                const isError = result.status === "error" || !!result.error;
                for (let i = thinkingSteps.length - 1; i >= 0; i--) {
                    if (!thinkingSteps[i].startsWith('✓') && !thinkingSteps[i].startsWith('✗')) {
                        thinkingSteps[i] = (isError ? '✗ ' : '✓ ') + thinkingSteps[i];
                        break;
                    }
                }
                if (isError && result.error) {
                    const errPreview = String(result.error).split('\n').pop()?.trim() || String(result.error).slice(0, 120);
                    thinkingSteps.push('⚠ ' + errPreview);
                }
                if (currentDraftId) {
                    dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId, plan: thinkingSteps.join(STEP_SEP) }));
                }
            }

            // ── action: agent chose what to do ──
            if (result.type === "action") {
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
                                plan: [pendingThought, ...thinkingSteps.filter(s => s.trim())].filter(Boolean).join('\x1E') || undefined,
                                content: question || displayInstruction,
                                displayContent: displayInstruction,
                                inputTableNames: resolvedSourceNames,
                                timestamp: Date.now(),
                            },
                        ],
                    }
                };
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

                // Ephemeral mode: persist full rows to IndexedDB (keeps only a
                // sample + virtual marker in Redux). Other backends store on the server.
                if (workspaceBackend === 'ephemeral' && activeWorkspaceId) {
                    const persisted = await persistEphemeralDerivedTable(activeWorkspaceId, candidateTable);
                    candidateTable.rows = persisted.rows;
                    candidateTable.virtual = persisted.virtual;
                }

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
                // Adopt the backend's forwarded chart_id so the agent and the
                // frontend share one id (it can embed/inspect this chart in the
                // same run). Guard against an id that somehow already exists.
                const forwardedChartId = transformResult.chart_id;
                if (forwardedChartId
                    && !charts.some(c => c.id === forwardedChartId)
                    && !createdCharts.some(c => c.id === forwardedChartId)) {
                    newChart.id = forwardedChartId;
                }
                // Title comes from the analyst's visualize action (read from the
                // chart data + spec). Stored on the chart so the canvas renders
                // it as the chart heading; keyed for staleness on edit.
                const insightTitle = refinedGoal?.title;
                if (typeof insightTitle === 'string' && insightTitle.trim()) {
                    newChart.title = insightTitle.trim();
                    newChart.titleKey = computeInsightKey(newChart);
                }
                runCreatedChartIds.push(newChart.id);
                // Mark as unread by default; cleared below if we auto-focus it
                // (i.e. it's the first artifact this run) or by setFocused when
                // the user clicks the card.
                newChart.unread = true;
                createdCharts.push(newChart);
                dispatch(dfActions.addChart(newChart));
                if (!firstFocusedThisRunRef.current && shouldAutoFocusGeneratedChart(userChartFocusLockedRef.current)) {
                    firstFocusedThisRunRef.current = true;
                    lastAutoFocusedChartIdRef.current = newChart.id;
                    dispatch(dfActions.setFocused({ type: 'chart', chartId: newChart.id }));
                }

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
            }

            // ── clarify / explain: pause and let user respond ──
            // Both events share the same shape (questions[]) and the same
            // pause storage; the only difference is the InteractionEntry role,
            // which the panel uses to switch palette/labels.
            if (result.type === "clarify" || result.type === "explain") {
                const isExplainEvent = result.type === "explain";
                let normalizedClarification;
                try {
                    normalizedClarification = normalizeClarifyEvent(result);
                } catch {
                    const errMsg = t(isExplainEvent ? 'chartRec.invalidExplanation' : 'chartRec.invalidClarification');
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(), type: 'error',
                        component: 'data-agent', value: errMsg,
                    }));
                    if (currentDraftId) {
                        dispatch(dfActions.updateDeriveStatus({ nodeId: currentDraftId, status: 'error' }));
                    }
                    setIsChatFormulating(false);
                    agentAbortRef.current = null;
                    clearTimeout(timeoutId);
                    isCompleted = true;
                    return;
                }
                if (currentDraftId) {
                    // Snapshot thinking steps into the pause entry so they render
                    // inline (as 二级) between the user prompt and the pause.
                    const priorSteps = thinkingSteps.filter(s => s.trim()).join('\n');
                    thinkingSteps = [];
                    pendingThought = '';
                    dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId, plan: '' }));

                    const pauseEntry: InteractionEntry = {
                        from: 'data-agent', to: 'user',
                        role: isExplainEvent ? 'explain' : 'clarify',
                        plan: priorSteps || result.thought || undefined,
                        content: normalizedClarification.summary,
                        clarificationQuestions: normalizedClarification.questions,
                        timestamp: Date.now(),
                    };
                    dispatch(dfActions.appendDraftInteraction({ draftId: currentDraftId, entry: pauseEntry }));
                    currentDraftInteraction.push(pauseEntry);
                    dispatch(dfActions.updateDeriveStatus({ nodeId: currentDraftId, status: 'clarifying' }));
                    dispatch(dfActions.updateDraftClarification({ draftId: currentDraftId, pendingClarification: {
                        trajectory: result.trajectory || [],
                        completedStepCount: result.completed_step_count || 0,
                        lastCreatedTableId,
                    }}));
                    // Don't change the user's focus — they may have been looking
                    // at a chart and the clarify/explain pause shouldn't yank
                    // their attention back to the parent table.
                }
                setIsChatFormulating(false);
                agentAbortRef.current = null;
                clearTimeout(timeoutId);
                setChatPrompt("");
                setAttachedImages([]);
                setAttachedFiles([]);
                isCompleted = true;
            }

            // ── delegate: agent hands off to a peer agent ──
            // The data agent has decided the conversation is better
            // served by another agent (data loading when the workspace
            // lacks needed data; report gen when the user wants a
            // narrative). We render the rationale + a one-click handoff
            // card. Shares the 'clarifying' status / pending-clarification
            // slot with the clarify/explain pauses so the panel renders in
            // the same UI position above the input box.
            if (result.type === "delegate") {
                const message = String(result.message || '').trim();
                const rawOptions = Array.isArray(result.options) ? result.options : [];
                const options: string[] = rawOptions
                    .map((o: any) => (typeof o === 'string' ? o.trim() : ''))
                    .filter((s: string) => s.length > 0)
                    .slice(0, 2);
                const target = (result.target === 'report_gen' ? 'report_gen' : 'data_loading') as 'data_loading' | 'report_gen';

                if (target === 'report_gen') {
                    // Auto-delegate to the report flow — no user approval gate.
                    // When the user asks for a report, jumping straight into
                    // report generation is the expected behavior, so we pick the
                    // agent's first seed prompt (falling back to its message) and
                    // hand off directly. The report_gen handoff useEffect picks
                    // this up and re-runs the analyst with the seeded prompt. The
                    // placeholder draft has no role in the report view, so we
                    // drop it like a normal completion would.
                    if (currentDraftId) {
                        thinkingSteps = [];
                        pendingThought = '';
                        dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId, plan: '' }));
                        dispatch(dfActions.removeDraftNode(currentDraftId));
                        currentDraftId = null;
                    }
                    const seedPrompt = options[0] || message;
                    if (seedPrompt) {
                        dispatch(dfActions.requestAgentHandoff({ target: 'report_gen', prompt: seedPrompt }));
                    }
                } else if (currentDraftId) {
                    // data_loading: keep the one-click approval panel — that's a
                    // different agent / context the user should confirm.
                    const priorSteps = thinkingSteps.filter(s => s.trim()).join('\n');
                    thinkingSteps = [];
                    pendingThought = '';
                    dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId, plan: '' }));

                    const pauseEntry: InteractionEntry = {
                        from: 'data-agent', to: 'user',
                        role: 'delegate',
                        plan: priorSteps || result.thought || undefined,
                        content: message,
                        delegateTarget: target,
                        delegateOptions: options,
                        timestamp: Date.now(),
                    };
                    dispatch(dfActions.appendDraftInteraction({ draftId: currentDraftId, entry: pauseEntry }));
                    currentDraftInteraction.push(pauseEntry);
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
                setAttachedImages([]);
                setAttachedFiles([]);
                isCompleted = true;
            }

            // ── completion: final summary ──
            if (result.type === "completion") {
                const rawSummary = result.content?.summary || "";
                const summary = result.status === "max_iterations"
                    ? translateBackend(rawSummary, result.content?.summary_code) || t('chartRec.maxIterationsReached')
                    : rawSummary;
                // Finalize any report streamed during this run. A report is an
                // artifact that OWNS its closing summary: it anchors to the
                // newest table created this run, or falls back to the focused
                // table when the run only summarized existing exploration (no
                // new table) — never detached.
                const reportAnchorTableId = reportId ? (lastCreatedTableId || focusedTableId) : null;
                if (reportId) {
                    reportFlushNow();
                    const titleMatch = accumulatedReportMarkdown.match(/^#\s+(.+)$/m);
                    dispatch(dfActions.updateGeneratedReportContent({
                        id: reportId,
                        content: accumulatedReportMarkdown,
                        status: 'completed',
                        title: titleMatch ? titleMatch[1].trim() : undefined,
                        triggerTableId: reportAnchorTableId || undefined,
                        // The closing answer lives on the report (rendered below
                        // its card, deleted with it) — not on a table.
                        summary: summary || undefined,
                        summaryThought: result.content?.thought || undefined,
                    }));
                }
                // For a NON-report run, the closing answer renders once as the
                // created table's after-summary entry — exactly like a chart's
                // summary. (Report runs own their summary; see above.)
                const summaryAnchorTableId = reportId ? null : lastCreatedTableId;
                if (summaryAnchorTableId) {
                    if (summary) {
                        const entry: InteractionEntry = {
                            from: 'data-agent', to: 'user', role: 'summary',
                            plan: result.content?.thought || undefined,
                            content: summary,
                            timestamp: Date.now(),
                        };
                        dispatch(dfActions.appendTriggerInteraction({ tableId: summaryAnchorTableId, entries: [entry] }));
                    }
                } else if (!reportId && summary && currentDraftId) {
                    // Pure Q&A run — the agent committed no action and answered in
                    // plain text (e.g. the user just asked a question). There's no
                    // table to anchor to. Treat the closing answer as an `explain`
                    // pause: the draft enters the pause phase with the answer text,
                    // so it surfaces in the explanation panel above the chat box
                    // and the user can reply to continue the conversation (resume).
                    const priorSteps = thinkingSteps.filter(s => s.trim()).join('\n');
                    thinkingSteps = [];
                    pendingThought = '';
                    dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId, plan: '' }));

                    const pauseEntry: InteractionEntry = {
                        from: 'data-agent', to: 'user', role: 'explain',
                        plan: priorSteps || result.content?.thought || undefined,
                        content: summary,
                        timestamp: Date.now(),
                    };
                    dispatch(dfActions.appendDraftInteraction({ draftId: currentDraftId, entry: pauseEntry }));
                    dispatch(dfActions.updateDeriveStatus({ nodeId: currentDraftId, status: 'clarifying' }));
                    dispatch(dfActions.updateDraftClarification({ draftId: currentDraftId, pendingClarification: {
                        trajectory: result.trajectory || result.content?.trajectory || [],
                        completedStepCount: result.completed_step_count || result.content?.completed_step_count || 0,
                        lastCreatedTableId,
                    }}));
                    // Keep the node; clear the handle so handleCompletion's draft
                    // cleanup doesn't remove the pause we just persisted.
                    currentDraftId = null;
                }
            }
        };

        const handleCompletion = () => {
            if (isCompleted) return;
            isCompleted = true;
            setIsChatFormulating(false);
            agentAbortRef.current = null;
            clearTimeout(timeoutId);
            if (reportFlushTimer) { clearTimeout(reportFlushTimer); reportFlushTimer = null; }

            // Clean up any remaining draft (the last step created a new draft that was never filled)
            if (currentDraftId) {
                dispatch(dfActions.removeDraftNode(currentDraftId));
                currentDraftId = null;
            }

            const completionResult = allResults.find((r: any) => r.type === "completion");
            if (completionResult) {
                setChatPrompt("");
                setAttachedImages([]);
                setAttachedFiles([]);
            }
        };

        (async () => {
            try {
                for await (const data of streamRequest(streamUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: messageBody,
                }, controller.signal)) {
                    if (data.type === "error") {
                        const errMsg = data.error
                            ? getErrorMessage(data.error)
                            : data.message
                                ? translateBackend(data.message, data.message_code, data.message_params)
                                : t('chartRec.errorDuringExploration');
                        setIsChatFormulating(false);
                        clearTimeout(timeoutId);
                        dispatch(dfActions.addMessages({
                            timestamp: Date.now(), type: 'error',
                            component: 'data-agent', value: errMsg,
                        }));
                        // Finalize and anchor any report streamed so far so a
                        // partial report isn't left unanchored (invisible in the
                        // thread) and stuck in the 'generating' state.
                        if (reportId) {
                            reportFlushNow();
                            const titleMatch = accumulatedReportMarkdown.match(/^#\s+(.+)$/m);
                            dispatch(dfActions.updateGeneratedReportContent({
                                id: reportId,
                                content: accumulatedReportMarkdown,
                                status: 'completed',
                                title: titleMatch ? titleMatch[1].trim() : undefined,
                                triggerTableId: lastCreatedTableId || focusedTableId || undefined,
                            }));
                        }
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
                            value: (data as any).warning?.message ?? 'Warning from server',
                        }));
                        continue;
                    }

                    allResults.push(data);
                    await processStreamingResult(data);
                    if (data.type === "completion" || data.type === "clarify" || data.type === "explain" || data.type === "interact" || data.type === "delegate") {
                        handleCompletion();
                        return;
                    }
                }
                handleCompletion();
            } catch (error: any) {
                setIsChatFormulating(false);
                agentAbortRef.current = null;
                clearTimeout(timeoutId);
                const isAbort = error.name === 'AbortError';
                const isCancelled = isAbort && !isCompleted && !timedOut;
                const isTimeout = isAbort && timedOut;
                const errorMessage = isCancelled
                    ? t('chartRec.explorationCancelled')
                    : isTimeout
                        ? t('messages.agent.requestTimedOut', { seconds: config.formulateTimeoutSeconds * 6 })
                        : t('chartRec.explorationFailed', { message: error.message });
                if (isTimeout) {
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(), type: 'warning',
                        component: 'data-agent',
                        value: t('messages.agent.requestTimedOut', { seconds: config.formulateTimeoutSeconds * 6 }),
                    }));
                }
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
            }
        })();
    }, [focusedTableId, tables, draftNodes, activeModel, config, conceptShelfItems, charts, dispatch, t, attachedImages, attachedFiles]);

    // Honor cross-component handoff requests targeting the Report Gen
    // agent (e.g. Data Agent's `delegate` card with target='report_gen').
    // Hand-offs targeting other agents (e.g. `data_loading`) are consumed
    // elsewhere — we only react to ours.
    const agentHandoffRequest = useSelector((state: DataFormulatorState) => state.agentHandoffRequest);
    useEffect(() => {
        if (agentHandoffRequest && agentHandoffRequest.target === 'report_gen') {
            const promptText = agentHandoffRequest.prompt;
            dispatch(dfActions.clearAgentHandoffRequest());
            // The unified analyst writes reports in-run via its `report`
            // skill, so a report hand-off is just an explore run seeded with
            // a report instruction.
            exploreFromChat(promptText.trim() || REPORT_SEED_PROMPT);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agentHandoffRequest]);

    // ── Unified submit handler ───────────────────────────────────────
    const submitChat = useCallback((prompt: string, clarificationCtx?: any, displayPrompt?: string) => {
        if (clarificationCtx) {
            // Build the structured response payload. The backend assembles
            // the final LLM-facing text ("Selected answers: 1. xxx; 2. yyy\n
            // User instructions: <typed>") from this array — we no longer
            // build that string here. Selections live only in the panel UI.
            const questions = clarificationQuestions?.questions || [];
            const responses: ClarificationResponse[] = [];
            questions.forEach((_q, idx) => {
                const ans = clarifyAnswers[idx];
                if (ans) responses.push(ans);
            });
            const typed = prompt.trim();
            if (typed) {
                responses.push({ question_index: -1, answer: typed, source: 'freeform' });
            }
            // Build the user-bubble display string from the structured
            // selections + any typed instructions. We send this same string
            // as `prompt` — it powers both the timeline bubble and the
            // user message appended to the trajectory on the backend.
            const displayPrompt = formatClarificationResponses(responses);
            exploreFromChat(displayPrompt, clarificationCtx);
            return;
        }
        exploreFromChat(prompt, undefined, displayPrompt);
    }, [exploreFromChat, clarificationQuestions, clarifyAnswers]);

    // Replay a workflow: the KnowledgePanel fires `df-replay-workflow`
    // with a prompt describing the captured workflow; we hand it straight to
    // the data agent on the currently focused dataset. v1 is deliberately
    // simple — one request, let the agent reproduce the analysis on its own.
    // See discussion/replayable-experience-workflow.md.
    useEffect(() => {
        const handler = (e: Event) => {
            const prompt = (e as CustomEvent).detail?.prompt as string | undefined;
            if (!prompt) return;
            if (isChatFormulating) {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(), type: 'error',
                    component: 'data-agent', value: t('knowledge.replayBusy'),
                }));
                return;
            }
            if (!focusedTableId) {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(), type: 'error',
                    component: 'data-agent', value: t('knowledge.replayNoData'),
                }));
                return;
            }
            dispatch(dfActions.addMessages({
                timestamp: Date.now(), type: 'info',
                component: 'data-agent', value: t('knowledge.replayStarted'),
            }));
            exploreFromChat(prompt);
        };
        window.addEventListener('df-replay-workflow', handler);
        return () => window.removeEventListener('df-replay-workflow', handler);
    }, [exploreFromChat, isChatFormulating, focusedTableId, dispatch, t]);

    const resumeFromClarification = useCallback((responses: ClarificationResponse[]) => {
        if (!pendingClarification) return;
        // Pass the formatted display string as `prompt` — it powers both the
        // timeline bubble and the user message appended to the trajectory.
        const displayPrompt = formatClarificationResponses(responses);
        exploreFromChat(displayPrompt, pendingClarification);
    }, [exploreFromChat, pendingClarification]);

    // Reset accumulated clarification answers whenever the active
    // clarification draft changes (a new clarify/explain pause appeared,
    // the previous one was resumed, or the user dismissed it).
    useEffect(() => {
        setClarifyAnswers({});
        clarifySubmittedRef.current = null;
    }, [pendingClarification?.draftId]);

    // Send is allowed only when the user has typed actual instructions.
    // Selections live in the ClarificationPanel UI only — they never
    // appear in the chat box. So having only selections (no typed text)
    // means there's nothing to send beyond clicks; the user must either
    // click the remaining options (which auto-submits) or type something.
    const canSend = React.useMemo(() => {
        if (!focusedTableId) return false;
        return chatPrompt.trim().length > 0;
    }, [chatPrompt, focusedTableId]);

    // Handle a single clicked option (or confirmed free-text) inside the
    // ClarificationPanel. We record the selection by question index — the
    // chat box is NOT mutated. `autoSubmit` (default true) lets an explicit
    // confirm (option click / check button / Enter) fire the whole panel once
    // every question is answered; an implicit confirm (blur auto-record)
    // passes false so it records but never submits.
    const handleSelectAnswer = useCallback((questionIndex: number, response: ClarificationResponse, autoSubmit: boolean = true) => {
        const questions = clarificationQuestions?.questions;
        if (!questions || !pendingClarification) return;
        if (clarifySubmittedRef.current === pendingClarification.draftId) return;

        const newAnswers = { ...clarifyAnswers, [questionIndex]: response };
        setClarifyAnswers(newAnswers);

        // Auto-submit only when EVERY question is answered by a clicked option
        // AND this was an explicit confirm. If any answer is typed text, we
        // never auto-fire — the user submits via the shared panel button — so a
        // stray option click can't sweep up an unfinished typed answer.
        const allAnswered = questions.every((_q, idx) => !!newAnswers[idx]);
        const allOptions = questions.every((_q, idx) => newAnswers[idx]?.source === 'option');
        if (allAnswered && allOptions && autoSubmit) {
            clarifySubmittedRef.current = pendingClarification.draftId;
            const responses: ClarificationResponse[] = questions.map((_q, idx) => newAnswers[idx]);
            resumeFromClarification(responses);
        }
    }, [clarificationQuestions, pendingClarification, clarifyAnswers, resumeFromClarification]);

    // Clear a question's recorded answer (the user started editing its field,
    // which invalidates a prior option pick or confirmed free-text reply).
    const handleClearAnswer = useCallback((questionIndex: number) => {
        setClarifyAnswers(prev => {
            if (!(questionIndex in prev)) return prev;
            const next = { ...prev };
            delete next[questionIndex];
            return next;
        });
    }, []);


    const cancelAgent = useCallback(() => {
        if (agentAbortRef.current) {
            agentAbortRef.current.abort();
            agentAbortRef.current = null;
        }
        // Always clear busy state — the async finally blocks also clear this,
        // but a direct cancel should guarantee the UI unblocks immediately.
        setIsChatFormulating(false);
        // Also dismiss any pending pause draft (clarify or explain)
        if (pendingClarification?.draftId) {
            dispatch(dfActions.removeDraftNode(pendingClarification.draftId));
        }
    }, [pendingClarification, dispatch, t]);

    // Landing / "no thread yet" highlight: when the user has loaded data
    // but hasn't started an exploration on the focused table (no real
    // charts AND the table isn't part of a derivation chain), gently pulse
    // a colored ring around the input card to anchor the eye here.
    // Suppressed once they start typing, while an agent is running, or
    // while a clarification is pending — anything that already draws focus.
    const focusedTableHasCharts = !!focusedTableId && charts.some(c =>
        c.tableRef === focusedTableId
        && c.chartType !== '?'
        && c.chartType !== 'Auto'
        && c.source !== 'trigger'
    );
    const focusedTableObj = focusedTableId ? tables.find(t => t.id === focusedTableId) : undefined;
    const focusedTableHasDerivation = !!focusedTableObj && (
        focusedTableObj.derive !== undefined
        || tables.some(t => t.derive?.trigger?.tableId === focusedTableId)
    );
    const isLandingHighlight = (
        !!focusedTableId
        && !focusedTableHasCharts
        && !focusedTableHasDerivation
        && !isChatFormulating
        && !pendingClarification
        && chatPrompt.trim() === ''
    );

    const inputBox = (
        <Card ref={inputCardRef} variant="outlined" sx={{
            display: 'flex', flexDirection: 'column',
            mx: 1, mb: 1, mt: 0.5,
            px: 1.25, pt: 1, pb: 0.5,
            borderRadius: '12px',
            // Standard single-tone input style (matches AgentChatInput): a
            // solid divider border that turns the accent color on focus.
            border: `1px solid ${borderColor.divider}`,
            outline: 'none',
            position: 'relative',
            overflow: isChatFormulating ? 'hidden' : 'visible',
            flexShrink: 0,
            transition: transition.fast,
            backgroundColor: isChatFormulating
                ? alpha(theme.palette.action.disabledBackground, 0.06)
                : theme.palette.background.paper,
            // Neutral elevation shadow recipe shared with AgentChatInput;
            // hover lifts the card a touch without shifting any colors.
            boxShadow: '0 1px 6px rgba(32, 33, 36, 0.10), 0 1px 2px rgba(32, 33, 36, 0.06)',
            '&:hover': {
                boxShadow: '0 2px 10px rgba(32, 33, 36, 0.14), 0 1px 3px rgba(32, 33, 36, 0.08)',
            },
            ...(isLandingHighlight ? {
                animation: 'df-chatinput-landing-pulse 2.4s ease-in-out infinite',
                '@keyframes df-chatinput-landing-pulse': {
                    '0%, 100%': {
                        boxShadow: `0 0 0 0 ${alpha(theme.palette.primary.main, 0.0)}, 0 4px 14px ${alpha(theme.palette.common.black, 0.06)}`,
                    },
                    '50%': {
                        boxShadow: `0 0 0 6px ${alpha(theme.palette.primary.main, 0.14)}, 0 4px 18px ${alpha(theme.palette.common.black, 0.08)}`,
                    },
                },
            } : {}),
            '&:focus-within': {
                animation: 'none',
                borderColor: theme.palette.primary.main,
                boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.15)}, 0 2px 10px rgba(32, 33, 36, 0.14)`,
            },
        }}
        >
            {clarificationQuestions?.kind === 'clarification' && clarificationQuestions.questions && pendingClarification && !isChatFormulating && (
                <ClarificationPanel
                    questions={clarificationQuestions.questions}
                    variant={clarificationQuestions.variant}
                    selectedAnswers={clarifyAnswers}
                    onSelectAnswer={handleSelectAnswer}
                    onClearAnswer={handleClearAnswer}
                    onSubmit={resumeFromClarification}
                    onCancel={cancelAgent}
                />
            )}
            {clarificationQuestions?.kind === 'clarification' && !clarificationQuestions.questions && clarificationQuestions.variant === 'explain' && clarificationQuestions.content && pendingClarification && !isChatFormulating && (
                // Plain-text closing answer surfaced as an explanation pause:
                // read-only, no questions. The user can still type a followup
                // in the chat box below (which resumes the conversation).
                <ExplanationPanel
                    content={clarificationQuestions.content}
                    onCancel={cancelAgent}
                />
            )}
            {clarificationQuestions?.kind === 'delegate' && pendingClarification && !isChatFormulating && (
                <DelegatePanel
                    target={clarificationQuestions.target}
                    message={clarificationQuestions.message}
                    options={clarificationQuestions.options}
                    onCancel={cancelAgent}
                />
            )}
            {/* Input area wrapper */}
            <Box sx={{ position: 'relative' }}>
            {/* @-mention table chips and image attachments.
                Skip the table-chip row entirely when there's only one root table —
                there's nothing else the user could @-mention, so the chip is noise. */}
            {((primaryTableIds.length > 0 && rootTables.length > 1) || attachedImages.length > 0 || attachedFiles.length > 0) && !isChatFormulating && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px', px: 0.5, pb: '2px' }}>
                    {rootTables.length > 1 && primaryTableIds.map(id => {
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
                    {attachedFiles.map((file, idx) => (
                        <Chip
                            key={`file-${idx}`}
                            size="small"
                            icon={<InsertDriveFileOutlinedIcon sx={{ fontSize: 14 }} />}
                            label={file.name}
                            onDelete={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
                            sx={{
                                height: 20,
                                fontSize: 10,
                                maxWidth: 160,
                                color: theme.palette.text.secondary,
                                backgroundColor: 'rgba(0,0,0,0.04)',
                                border: 'none',
                                borderRadius: '4px',
                                '& .MuiChip-label': { px: '4px', overflow: 'hidden', textOverflow: 'ellipsis' },
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
                        setChatPrompt(t('chartRec.threadExplorePrompt'));
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (canSend && !isChatFormulating) {
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
                    // Notify the parent (DataThread) that the chat input was
                    // focused.  The parent's scroll-to-target effect handles
                    // the actual scroll based on focusedId / clarify state.
                    onInputFocus?.();
                }}
                slotProps={{ 
                    inputLabel: { shrink: true },
                    input: { readOnly: isChatFormulating },
                }}
                value={chatPrompt}
                placeholder={
                    pendingClarification
                        ? t('chartRec.replyPlaceholder')
                        : t(rootTables.length <= 1 ? 'chartRec.explorePlaceholderSingleTable' : 'chartRec.explorePlaceholder')
                }
                fullWidth
                multiline
                minRows={3}
                maxRows={6}
            />
            <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
                {/* Action buttons */}
                <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0.5, overflow: 'hidden', flex: 1 }}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => { handleAttachFiles(e.target.files); if (e.target) e.target.value = ''; }}
                    />
                    <Tooltip title={t('chartRec.attachContext', { defaultValue: 'Attach context (image or file)' })}>
                        <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                            sx={{
                                p: 0.5,
                                color: theme.palette.text.secondary,
                                borderRadius: '4px',
                                '&:hover': { color: theme.palette.primary.main, backgroundColor: alpha(theme.palette.primary.main, 0.06) },
                            }}
                        >
                            <AddIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                    </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                {isChatFormulating ? (
                    <CircularProgress size={18} sx={{ m: 0.5 }} />
                ) : (
                    <>
                        <Tooltip title={t('chartRec.generateReport')}>
                            <span>
                                <IconButton
                                    size="small"
                                    sx={{ p: 0.5, color: theme.palette.text.secondary }}
                                    disabled={!focusedTableId || isChatFormulating || !!pendingClarification}
                                    onClick={() => submitChat(t('chartRec.reportPrompt'), undefined, t('chartRec.askedForReport'))}
                                >
                                    <EditOutlinedIcon sx={{ fontSize: 18 }} />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('chartRec.getIdeaSuggestions')}>
                            <span>
                                <IconButton
                                    size="small"
                                    sx={{ p: 0.5, color: theme.palette.primary.main }}
                                    disabled={!focusedTableId || isChatFormulating || !!pendingClarification}
                                    onClick={() => submitChat(t('chartRec.exploreIdeasPrompt'), undefined, t('chartRec.askedForRecommendations'))}
                                >
                                    <TipsAndUpdatesIcon sx={{ fontSize: 18 }} />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('chartRec.explore')}>
                            <span>
                                <IconButton
                                    size="small"
                                    disabled={!canSend}
                                    onClick={() => {
                                        if (pendingClarification) {
                                            submitChat(chatPrompt, pendingClarification);
                                        } else {
                                            submitChat(chatPrompt);
                                        }
                                    }}
                                    // When the user has typed text, promote
                                    // the arrow to a contained primary
                                    // affordance so it reads as the active
                                    // submit action. Otherwise stay as a
                                    // quiet outlined icon button.
                                    sx={{
                                        p: 0,
                                        width: 28, height: 28,
                                        bgcolor: canSend ? 'primary.main' : 'transparent',
                                        color: canSend ? 'common.white' : 'primary.main',
                                        '&:hover': {
                                            bgcolor: canSend ? 'primary.dark' : 'transparent',
                                        },
                                        '&.Mui-disabled': {
                                            bgcolor: 'transparent',
                                            color: 'text.disabled',
                                        },
                                    }}
                                >
                                    <ArrowUpwardRoundedIcon sx={{ fontSize: 18 }} />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </>
                )}
                </Box>
            </Box>
            </Box>
            {/* Agent working overlay — covers entire card during chat formulation */}
            {isChatFormulating && (
                <AgentWorkingOverlay 
                    message={draftNodes.find(d => d.derive?.status === 'running' && threadTableIds.has(d.derive.trigger.tableId))
                            ?.derive?.runningPlan}
                    theme={theme}
                    color={'primary'}
                    onCancel={cancelAgent}
                />
            )}
        </Card>
    );

    return (
        <Box>
            {/* The input box */}
            {inputBox}
        </Box>
    );
};
