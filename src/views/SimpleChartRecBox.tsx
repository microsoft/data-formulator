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
    Collapse,
    Popper,
    Paper,
    Menu,
    MenuList,
    MenuItem,
    ClickAwayListener,
} from '@mui/material';

import { useDispatch, useSelector, useStore } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors, explanationContent, fetchCodeExpl, fetchColumnStats, fetchFieldSemanticType, generateFreshChart, generateStarterQuestions, GeneratedReport } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { resolveRecommendedChart, getUrls, translateBackend } from '../app/utils';
import { buildThreads } from '../app/threadGraph';
import { authoredFieldSemantics } from '../app/fieldSemantics';
import { streamRequest, apiRequest } from '../app/apiClient';
import { getErrorMessage } from '../app/errorCodes';
import { Chart, ClarificationResponse, ComputationInputSource, DictTable, DraftNode, FieldItem, createDictTable, computeInsightKey, TextTurn, TerminalExecution, CodeExecution, createConversationRootId, ProgressStep } from "../components/ComponentType";
import { normalizeClarifyEvent, formatClarificationResponses } from '../app/clarification';
import { parseDataOperation } from '../dataOperations/models';
import { buildDictTableFromWorkspace } from '../app/tableThunks';
import { toAnalystTableRef, workspaceTableIdOf } from '../app/tableResolution';

import { alpha } from '@mui/material/styles';
import { WritingPencil } from '../components/FunComponents';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { notifyWorkspaceFilesChanged } from '../app/workspaceService';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import BoltIcon from '@mui/icons-material/Bolt';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import StopIcon from '@mui/icons-material/Stop';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import QueryStatsIcon from '@mui/icons-material/QueryStats';

import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { borderColor, transition, conversationWidth } from '../app/tokens';
import { Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { listReplaceableArtifacts } from '../app/artifactReplacement';
import { resolveConversationParentNodeId, resolveDerivedTriggerTableId, resolveRunParentNodeId, shouldAutoFocusGeneratedChart } from '../app/agentInteractionPolicy';
import { ClarificationPanel, ExplanationPanel, ToolActivityPanel, FailedDraftPanel } from './AgentPausePanel';
import { CARD_WIDTH } from './threadLayout';
import { iconVar, textVar } from '../app/layout';
import { formatAnalystToolProgress } from './analystToolProgress';
import { TerminalAccessButton, TerminalApprovalDialog, TerminalProposal } from '../components/TerminalApprovalDialog';
import { selectChatWorkflow, WorkflowProgress, WORKFLOW_AUTHORING_PROMPT } from './WorkflowPanel';
import { formArtifactFromEvent, requestAutoSubmit } from '../app/setupForms';
import { handleApiError } from '../app/errorHandler';

// Approx footprint of the leading lightning-bolt IconButton (size small,
// p:0.5 + 16px icon). Used to cap a starter chip so a single chip fits
// within one thread-column width alongside the toggle icon.
const STARTER_ICON_WIDTH = 28;

// Seed prompt used when the user invokes "report" mode (or a report hand-off)
// without typing an explicit instruction. The unified analyst loads its
// `report` skill and emits `write_report` within a normal explore run.
const REPORT_SEED_PROMPT = 'Write a report summarizing the exploration.';

// A starter-question chip that only shows a tooltip when its label is
// truncated (i.e. the text is too long to fit within the capped width).
const StarterChip: FC<{ label: string; onClick: () => void; sx: any }> = ({ label, onClick, sx }) => {
    const labelRef = useRef<HTMLSpanElement | null>(null);
    const [isClipped, setIsClipped] = useState(false);
    const checkClipped = () => {
        // The MUI `.MuiChip-label` element (parent of our span) is the one that
        // applies overflow:hidden + ellipsis, so measure that container.
        const el = labelRef.current?.parentElement;
        if (el) setIsClipped(el.scrollWidth > el.clientWidth);
    };
    return (
        <Tooltip title={isClipped ? label : ''} placement="top" enterDelay={400}>
            <Chip
                size="small"
                clickable
                label={<span ref={labelRef}>{label}</span>}
                onClick={onClick}
                onMouseEnter={checkClipped}
                sx={sx}
            />
        </Tooltip>
    );
};

const AgentWorkingOverlay: FC<{ message?: string; theme: Theme; onCancel?: () => void; color?: 'primary' | 'warning'; sx?: Record<string, any> }> = ({ message, theme, onCancel, color = 'primary', sx }) => {
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
    const progressColor = color === 'warning' ? theme.palette.warning.main : theme.palette.primary.main;
    return (
        <Box sx={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            // Opaque paper, not a tint: "paused" is carried by the muted text
            // and progress bar, so darkening the fill only makes it look dirty.
            backgroundColor: theme.palette.background.paper,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.5,
            zIndex: 2,
            borderRadius: 'inherit',
            px: 2,
            overflow: 'hidden',
            ...sx,
        }}>
            <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0.75 }}>
                <WritingPencil size={12} />
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, fontSize: textVar.xs, lineHeight: 1.4 }}>
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
                            bgcolor: alpha(theme.palette.error.main, 0.08),
                            color: 'error.main',
                            border: `1px solid ${alpha(theme.palette.error.main, 0.2)}`,
                            '&:hover': {
                                bgcolor: alpha(theme.palette.error.main, 0.16),
                                color: 'error.dark',
                                borderColor: alpha(theme.palette.error.main, 0.35),
                            },
                        }}
                    >
                        <StopIcon sx={{ fontSize: iconVar.sm }} />
                    </IconButton>
                </Tooltip>
            )}
            <Typography variant="body2" sx={{
                color: 'text.disabled',
                fontSize: textVar.xs,
                textAlign: 'center',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                lineHeight: 1.45,
                wordBreak: 'break-word',
            }}>
                {latestMessage}
            </Typography>
            <LinearProgress sx={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, borderRadius: '0 0 8px 8px',
                backgroundColor: alpha(progressColor, 0.08),
                '& .MuiLinearProgress-bar': { backgroundColor: alpha(progressColor, 0.4) },
            }} />
        </Box>
    );
};

export const SimpleChartRecBox: FC<{ onInputFocus?: () => void }> = function ({ onInputFocus }) {

    const tables = useSelector(dfSelectors.getAllTables);
    const threadGraph = useSelector(dfSelectors.getThreadGraph);
    const inputTables = useSelector((state: DataFormulatorState) => state.inputTables);
    const externalReferences = useSelector((state: DataFormulatorState) => state.externalTableReferences);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    // The connected-source reference in focus: picked on the shelf, or a thread node that points at one.
    const focusedExternalReferenceId = useSelector((state: DataFormulatorState) => {
        const focus = state.focusedId;
        const referenceId = focus?.type === 'external-table' ? focus.referenceId
            : focus?.type === 'reference' ? state.loadedTableNodes.find(node => node.id === focus.referenceId && node.external)?.tableId
            : undefined;
        return referenceId && state.externalTableReferences.some(reference => reference.id === referenceId) ? referenceId : undefined;
    });
    const hasFocusedExternalReference = !!focusedExternalReferenceId;
    const charts = useSelector(dfSelectors.getAllCharts);
    const starterQuestions = useSelector((state: DataFormulatorState) => state.starterQuestions);
    const starterQuestionsStatus = useSelector((state: DataFormulatorState) => state.starterQuestionsStatus);    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const config = useSelector((state: DataFormulatorState) => state.config);
    const activeModel = useSelector(dfSelectors.getActiveModel);
    const workspaceReadOnly = useSelector((state: DataFormulatorState) => state.activeWorkspace?.readOnly === true);
    const draftNodes = useSelector((state: DataFormulatorState) => state.draftNodes);
    // Text turns (clarify / explain / delegate) — design-docs/41. The focused
    // one (if any) drives the overlay panel above the chat.
    const textTurns = useSelector((state: DataFormulatorState) => state.textTurns);
    // A focused running or paused workflow shows its pending interaction above the input.
    const chatWorkflow = useSelector(selectChatWorkflow);
    const currentStore = useStore();
    const connectorParams = useSelector((state: DataFormulatorState) => state.dataLoaderConnectParams);

    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const [chatPrompt, setChatPrompt] = useState("");
    const [quickActionAnchor, setQuickActionAnchor] = useState<HTMLElement | null>(null);
    const [chatInputFocused, setChatInputFocused] = useState(false);
    // ── Clarification accumulated answers ────────────────────────────
    // When the agent asks one or more clarification questions, clicking an
    // option does NOT submit immediately and does NOT mutate the chat box.
    // We just track the selections here. The agent is invoked when the LAST
    // question is answered via clicks, OR when the user explicitly hits
    // Send / Enter (at which point the selections are formatted into a
    // "Selected answers: ..." prefix and prepended to the typed message).
    const [clarifyAnswers, setClarifyAnswers] = useState<Record<number, ClarificationResponse>>({});
    const [isChatFormulating, setIsChatFormulating] = useState(false);
    const [pendingTerminal, setPendingTerminal] = useState<{
        proposal: TerminalProposal;
        trajectory: any[];
        completedStepCount: number;
        actionId: string;
        parentNodeId: string;
        lastCreatedTableId: string | null;
        sourceTableIds: string[];
    } | null>(null);
    // Whether the getting-started starter questions are collapsed (click the
    // lightning bolt to expand/collapse).
    const [starterCollapsed, setStarterCollapsed] = useState(false);
    const [mentionedTableIds, setMentionedTableIds] = useState<string[]>([]);
    const [mentionDropdownOpen, setMentionDropdownOpen] = useState(false);    const [mentionHighlightIdx, setMentionHighlightIdx] = useState(0);
    const [attachedImages, setAttachedImages] = useState<{ url: string; scratchPath: string }[]>([]);
    const [attachmentUploads, setAttachmentUploads] = useState(0);
    // Non-image attachments are uploaded to the workspace scratch/ folder (raw
    // bytes preserved) so the agent can read them with execute_python_script
    // (pandas) or hand off to data loading — instead of inlining text (which
    // breaks on binary/Excel and large files). `scratchPath` is the returned
    // `scratch/<name>_<hash>.<ext>`.
    const [attachedFiles, setAttachedFiles] = useState<{ name: string; scratchPath: string }[]>([]);
    // Short explanations reopen above the composer. Long explanations own the
    // visualization canvas so they do not crowd the conversation input.
    const [viewingToolActivity, setViewingToolActivity] = useState<{ nodeId: string;
        execution: NonNullable<TextTurn['executions']>[number] | NonNullable<TextTurn['codeExecutions']>[number] } | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const agentAbortRef = useRef<AbortController | null>(null);
    // The chart the user was on when the current run started — provenance for a
    // clarify/explain TextTurn emitted mid/end of the run (design-docs/41).
    const runSourceChartIdRef = useRef<string | null>(null);
    // Authored thread edge, chained (design-docs/42): the LAST thread node this
    // run created — starts as the node the user asked from (a table, or the turn
    // being answered), then advances to each turn/table as it's emitted. Every
    // new node's parentNodeId = this ref, so one run reads as a
    // linear chain (table → clarify → table → explain). Set once at run start,
    // advanced at each emit — never re-derived at render.
    const runLastNodeRef = useRef<string | null>(null);
    // Guards a focused clarify turn from double-submitting once auto-answered.
    const textTurnSubmittedRef = useRef<string | null>(null);
    const userChartFocusLockedRef = useRef(false);
    const lastAutoFocusedChartIdRef = useRef<string | null>(null);
    // Most recently focused CHART, so a pause's "Close (switch focus)" can hand
    // focus back to whatever chart the user was last looking at.
    const lastChartFocusRef = useRef<string | null>(null);
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

    // Stale draft detection is handled by loadState in dfSlice (marks running/clarifying drafts as interrupted)

    const inputCardRef = useRef<HTMLDivElement>(null);
    // Ref to the chat textarea so getting-started starter prompts can seed
    // the input and immediately focus it for editing.
    const chatInputRef = useRef<HTMLTextAreaElement | null>(null);

    const seedChatPrompt = useCallback((text: string) => {
        setChatPrompt(text);
        requestAnimationFrame(() => chatInputRef.current?.focus());
    }, []);

    const generatedReports = useSelector((state: DataFormulatorState) => state.generatedReports);
    const loadedTableNodes = useSelector((state: DataFormulatorState) => state.loadedTableNodes);
    const fileNodes = useSelector((state: DataFormulatorState) => state.fileNodes);
    const focusedReference = focusedId?.type === 'reference'
        ? [...loadedTableNodes, ...fileNodes].find(node => node.id === focusedId.referenceId)
        : undefined;
    const analystChatPending = useSelector((state: DataFormulatorState) => state.analystChatPending);

    const focusedTableId = useCallback(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'conversation') return focusedId.tableId;
        if (focusedId.type === 'table') return focusedId.tableId;
        // A reference to a connected source points at no stored table.
        if (focusedId.type === 'reference') return focusedReference?.kind === 'loaded-table' && !focusedReference.external ? focusedReference.tableId : undefined;
        if (focusedId.type === 'chart') {
            const chart = charts.find(c => c.id === focusedId.chartId);
            return chart?.tableRef;
        }
        if (focusedId.type === 'report') {
            const report = generatedReports.find(r => r.id === focusedId.reportId);
            return report?.triggerTableId;
        }
        if (focusedId.type === 'draft') {
            const draft = draftNodes.find(item => item.id === focusedId.draftId);
            return threadGraph.tableOf(draft?.parentNodeId);
        }
        // A focused text turn is non-canvas-owning (design-docs/41): resolve to
        // its source chart's table, else its thread-parent table — so the input
        // box, send, and exploreFromChat all work while it's focused.
        if (focusedId.type === 'text') {
            const turn = textTurns.find(tt => tt.id === focusedId.textId);
            if (!turn) return undefined;
            if (turn.sourceChartId) {
                const c = charts.find(ch => ch.id === turn.sourceChartId);
                if (c) return c.tableRef;
            }
            return threadGraph.tableOf(turn.id);
        }
        return undefined;
    }, [focusedId, charts, generatedReports, textTurns, tables, draftNodes, focusedReference, threadGraph])();

    // Remember the last chart the user focused so a pause "Close" can restore it.
    useEffect(() => {
        if (focusedId?.type === 'chart') lastChartFocusRef.current = focusedId.chartId;
    }, [focusedId]);

    // What the canvas resolves a focused text turn to — the nearest artifact
    // above it. Reused by "Close" so the panel and the canvas never disagree.
    const canvasTarget = useSelector(dfSelectors.selectCanvasTarget);
    const [submittedPanelFocus, setSubmittedPanelFocus] = useState<typeof canvasTarget>(undefined);
    const focusCanvasAfterReply = useCallback(() => {
        dispatch(dfActions.setFocused(canvasTarget));
        setSubmittedPanelFocus(canvasTarget);
    }, [canvasTarget, dispatch]);

    const currentTable = tables.find(t => t.id === focusedTableId);

    // Default primary tables: source tables the focused table uses (or the focused source table itself)
    const defaultPrimaryTableIds = React.useMemo(() => {
        if (!currentTable) return [];
        if (currentTable.derive) {
            // Derived table: all its source inputs that are root tables
            return (currentTable.derive.source as string[]).filter(id => inputTables.some(t => t.id === id));
        }
        // Source table: just this table
        return inputTables.some(t => t.id === currentTable.id) ? [currentTable.id] : [];
    }, [currentTable, inputTables]);

    // Combined primary table IDs: defaults + user @-mentioned (deduplicated, source tables only)
    const primaryTableIds = React.useMemo(() => {
        const ids = new Set(defaultPrimaryTableIds);
        for (const id of mentionedTableIds) {
            if (inputTables.some(t => t.id === id)) ids.add(id);
        }
        return [...ids];
    }, [defaultPrimaryTableIds, mentionedTableIds, inputTables]);

    // Extract the filter text from after the last @ in the prompt
    const mentionFilter = React.useMemo(() => {
        if (!mentionDropdownOpen) return "";
        const lastAt = chatPrompt.lastIndexOf('@');
        if (lastAt < 0) return "";
        return chatPrompt.slice(lastAt + 1).toLowerCase();
    }, [chatPrompt, mentionDropdownOpen]);

    // Filtered available options for the @ dropdown (tables only)
    const mentionAvailableTables = React.useMemo(() => {
        return inputTables
            .filter(t => !primaryTableIds.includes(t.id))
            .filter(t => {
                if (!mentionFilter) return true;
                const name = (t.displayId || t.id).toLowerCase();
                return name.includes(mentionFilter);
            });
    }, [inputTables, primaryTableIds, mentionFilter]);

    // Reset highlight index when filter changes
    React.useEffect(() => {
        setMentionHighlightIdx(0);
    }, [mentionFilter]);

    // ── Starter-questions generation trigger ─────────────────────────
    // Questions are stored per root table (each table has its own, plus an
    // optional cross-table question). When a root table is focused and it has
    // no fresh questions for the current table set, generate them lazily. The
    // signature (all root table ids) refreshes questions when tables change;
    // the 500ms debounce collapses batch loads into a single call.
    const rootTableSignature = React.useMemo(
        () => JSON.stringify({
            tables: inputTables.map(table => [table.id, table.snapshot.capturedAt]),
            references: externalReferences.map(reference => [reference.id, reference.capturedAt, reference.summary, reference.queryIntent]),
        }),
        [inputTables, externalReferences]
    );
    const focusedRootTableId = (focusedTableId && inputTables.some(t => t.id === focusedTableId))
        ? focusedTableId
        : focusedExternalReferenceId;
    React.useEffect(() => {
        if (!focusedRootTableId || workspaceReadOnly) return;
        const entry = starterQuestions[focusedRootTableId];
        if (entry && entry.signature === rootTableSignature) return;        // already fresh
        if (starterQuestionsStatus[focusedRootTableId] === 'loading') return; // in flight
        const timer = setTimeout(() => {
            dispatch(generateStarterQuestions({
                tableId: focusedRootTableId,
                signature: rootTableSignature,
                tableIds: inputTables.map(table => table.id),
            }));
        }, 500);
        return () => clearTimeout(timer);
    }, [focusedRootTableId, rootTableSignature, inputTables, starterQuestions, starterQuestionsStatus, workspaceReadOnly, dispatch]);


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

    const handleAttachFiles = React.useCallback((fileList: FileList | File[] | null) => {
        if (!fileList) return;
        const files = Array.from(fileList);
        setAttachmentUploads(count => count + files.length);
        files.forEach(async file => {
            try {
                const imageUrl = file.type.startsWith('image/')
                    ? await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result as string);
                        reader.onerror = () => reject(reader.error);
                        reader.readAsDataURL(file);
                    })
                    : undefined;
                const formData = new FormData();
                formData.append('file', file);
                const { data } = await apiRequest(getUrls().SCRATCH_UPLOAD_URL, { method: 'POST', body: formData });
                const scratchPath = data?.path;
                if (!scratchPath) throw new Error('Upload returned no scratch path');
                if (imageUrl) {
                    setAttachedImages(prev => [...prev, { url: imageUrl, scratchPath }]);
                } else {
                    setAttachedFiles(prev => [...prev, { name: file.name, scratchPath }]);
                }
            } catch (err) {
                console.error('Scratch upload failed:', err);
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(), type: 'error',
                    component: 'data-agent',
                    value: t('chartRec.attachUploadFailed', { name: file.name, defaultValue: `Failed to attach ${file.name}` }),
                }));
            } finally {
                setAttachmentUploads(count => count - 1);
            }
        });
    }, [dispatch, t]);

    // Paste handler: capture pasted files — images AND other files (CSV, Excel,
    // etc.) — so the chat box accepts the same attachments as the "+" button,
    // not just images. When the clipboard holds no files (plain text), we let
    // the paste fall through to the textarea as normal.
    const handlePaste = React.useCallback((e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                const f = items[i].getAsFile();
                if (f) files.push(f);
            }
        }
        if (files.length === 0) return;
        e.preventDefault();
        handleAttachFiles(files);
    }, [handleAttachFiles]);

    // A run belongs to the focused thread when it continues an item on the focused node's
    // chain (a table, an app, a report…), or, with no item there, when it shares its start.
    const focusNodeId = useSelector(dfSelectors.getFocusNodeId);
    const draftBelongsToFocusedThread = (draft: typeof draftNodes[number]) => {
        const focusedChain = threadGraph.ancestors(focusNodeId, { includeSelf: true });
        const item = threadGraph.nearestItem(draft.parentNodeId);
        if (item) return focusedChain.some(id => id === item || threadGraph.membersOf(id).includes(item));
        return !focusedChain.some(id => threadGraph.isItem(id))
            && (!focusNodeId || threadGraph.rootOf(draft.id) === threadGraph.rootOf(focusNodeId));
    };

    // ── Shared structured thread context builder (Tier 2 + Tier 3) ──
    // Produces the focused/peripheral thread context used by the analyst
    // (exploreFromChat), so the report has the actual exploration narrative —
    // user questions, agent thinking, findings — instead of just a flat list
    // of charts.
    const buildThreadContext = useCallback((targetNodeId: string | undefined): {
        focusedThread: any[] | undefined;
        otherThreads: any[] | undefined;
    } => {
        // Nothing loaded yet — there's no thread to summarize.
        if (!targetNodeId) return { focusedThread: undefined, otherThreads: undefined };
        const turnById = new Map(textTurns.map(turn => [turn.id, turn]));
        const tableById = new Map(tables.map(table => [table.id, table]));
        const chartSummary = (tableId: string) => {
            // The resolved chart, not the trigger's "Auto" stub.
            const chart = charts.find(c => c.tableRef === tableId && c.source === 'trigger')
                || charts.find(c => c.tableRef === tableId);
            const encodings = chart?.encodingMap
                ? Object.fromEntries(Object.entries(chart.encodingMap)
                    .filter(([, v]: [string, any]) => v?.fieldID)
                    .map(([k, v]: [string, any]) => [k, conceptShelfItems.find(f => f.id === v.fieldID)?.name || v.fieldID]))
                : {};
            return { chartType: chart?.chartType || '', encodings: encodings as Record<string, string>,
                chartId: charts.find(c => c.tableRef === tableId && c.source !== 'trigger')?.id };
        };
        const workflowContext = (turn: TextTurn) => {
            const workflow = turn.workflow;
            return workflow ? {
                run_id: workflow.runId, status: workflow.status, step_id: workflow.stepId,
                calls: workflow.calls, steps: workflow.steps, checks: workflow.checks || [],
                output_ids: turn.outputIds || [],
                reports: generatedReports.filter(report => turn.outputIds?.includes(report.id)).map(report => ({
                    id: report.id, title: report.title, content: report.content.slice(0, 12000),
                    truncated: report.content.length > 12000,
                })),
            } : undefined;
        };

        // Tier 2: the focused thread is the chain above the focused node, oldest
        // first. User messages are folded into the next step; the agent message
        // right before a derived table is that table's instruction.
        const path = threadGraph.ancestors(targetNodeId, { includeSelf: true }).reverse();
        const focusedSteps: any[] = [];
        let pendingQuestion = '';
        path.forEach((nodeId, index) => {
            const turn = turnById.get(nodeId);
            const table = tableById.get(nodeId);
            if (turn) {
                if (turn.prompt) pendingQuestion = [pendingQuestion, turn.prompt].filter(Boolean).join('\n');
                const nextIsTable = !!tableById.get(path[index + 1])?.derive;
                if (!turn.content && !turn.form && !turn.dataOperation && !turn.workflow) return;
                if (nextIsTable) return;
                focusedSteps.push({
                    user_question: pendingQuestion,
                    agent_response: turn.content || '',
                    workflow_definition: turn.form?.kind === 'workflow' ? turn.form.workflow.content : undefined,
                    workflow: workflowContext(turn),
                    data_operation: turn.dataOperation ? {
                        reason: turn.dataOperation.reason,
                        status: turn.dataOperation.status,
                        options: turn.dataOperation.plans.map(plan => plan.label),
                        selected_plan: turn.dataOperation.plans.find(plan => plan.id === turn.dataOperation?.selectedPlanId)?.label || '',
                        result_tables: turn.dataOperation.resultTableIds,
                        result_references: turn.dataOperation.resultReferences,
                    } : undefined,
                });
                pendingQuestion = '';
            } else if (table?.derive) {
                const instruction = turnById.get(path[index - 1] || '');
                const { chartType, encodings, chartId } = chartSummary(table.id);
                focusedSteps.push({
                    table_name: table.virtual?.tableId || table.id,
                    chart_id: chartId,
                    columns: table.names,
                    row_count: table.virtual?.rowCount ?? table.rows.length,
                    user_question: pendingQuestion,
                    agent_thinking: (instruction?.progressSteps || []).filter(step => step.kind === 'thought').map(step => step.label).join('\n'),
                    display_instruction: instruction?.content || '',
                    chart_type: chartType,
                    encodings,
                });
                pendingQuestion = '';
            } else {
                // Apps, files, and reports on the chain, by the id the agent can revise or replace them with.
                const file = fileNodes.find(item => item.id === nodeId);
                const report = generatedReports.find(item => item.id === nodeId);
                if (!file && !report) return;
                focusedSteps.push({
                    user_question: pendingQuestion,
                    created_artifact: file ? { kind: file.path.match(/\.(app\.jsx|html?)$/i) ? 'app' : 'file', id: `files/${file.path}`, name: file.displayName }
                        : { kind: 'report', id: report!.id, name: report!.title || report!.id },
                });
                pendingQuestion = '';
            }
        });
        if (pendingQuestion) focusedSteps.push({ user_question: pendingQuestion });
        const focusedThread = focusedSteps.length > 0 ? focusedSteps : undefined;

        // Tier 3: other threads — one line per derived table.
        const STEP_FINDING_CHAR_LIMIT = 200;
        const focusedPath = new Set(path);
        const peripheralThreads: any[] = [];
        for (const thread of buildThreads(threadGraph)) {
            if (thread.nodeIds.some(id => focusedPath.has(id))) continue;
            const derived = thread.nodeIds.map(id => tableById.get(id)).filter((table): table is DictTable => !!table?.derive);
            if (!derived.length) continue;
            const steps = derived.map(table => {
                const label = turnById.get(threadGraph.parentOf(table.id) || '')?.content || '';
                const { chartType, encodings } = chartSummary(table.id);
                const encStr = Object.entries(encodings).map(([k, v]) => `${k}: ${v}`).join(', ');
                let finding = threadGraph.followersOf(table.id).map(node => turnById.get(node.id)?.content?.trim()).find(Boolean) || '';
                if (finding.length > STEP_FINDING_CHAR_LIMIT) finding = finding.slice(0, STEP_FINDING_CHAR_LIMIT - 1).trimEnd() + '…';
                const head = `${label}${chartType ? ` → ${chartType}` : ''}${encStr ? ` (${encStr})` : ''}`;
                return finding ? `${head} — finding: ${finding}` : head;
            });
            const sourceTable = tableById.get(thread.rootId);
            const leaf = derived[derived.length - 1];
            peripheralThreads.push({
                source_table: sourceTable?.virtual?.tableId || thread.rootId,
                leaf_table: leaf.virtual?.tableId || leaf.id,
                step_count: steps.length,
                steps,
            });
        }
        const otherThreads = peripheralThreads.length > 0 ? peripheralThreads : undefined;

        return { focusedThread, otherThreads };
    }, [tables, charts, conceptShelfItems, textTurns, generatedReports, fileNodes, threadGraph]);

    const exploreFromChat = useCallback((prompt: string, clarificationContext?: {
        authorWorkflow?: boolean;
        trajectory?: any[];
        completedStepCount?: number;
        actionId?: string;
        lastCreatedTableId?: string | null;
        parentNodeId?: string;
        sourceTableIds?: string[];
        terminalResponse?: { request_id: string; decision: 'approve' | 'reject' };
        interactionResponse?: {
            operation_id: string;
            plan_id?: string;
            action?: 'elaborate';
        };
    }, displayPrompt?: string, explicitAttachments?: {
        images: string[];
        files: { name: string; scratchPath: string }[];
    }) => {
        if (attachmentUploads > 0) return;
        const images = explicitAttachments?.images ?? attachedImages.map(image => image.url);
        const files = explicitAttachments?.files ?? attachedFiles;
        const scratchPaths = [
            ...files.map(file => file.scratchPath),
            ...(!explicitAttachments ? attachedImages.map(image => image.scratchPath) : []),
        ];
        if (!clarificationContext && prompt.trim() === "" && images.length === 0 && files.length === 0) return;

        // Non-image attachments live in the workspace scratch/ folder; we pass
        // their paths to the agent (see requestBody.scratch_files) rather than
        // inlining their bytes. The prompt/bubble stay clean.
        const agentPrompt = prompt;
        const cleanDisplay = displayPrompt;
        // Names shown as chips on the user's message bubble so the sent message
        // reflects what was attached (files live in scratch/, images inline).
        const attachmentNames = [
            ...files.map(file => file.name),
            ...images.map((_, index) => images.length > 1 ? `image ${index + 1}` : 'image'),
        ];

        // Every input table is in play, with the focused table's own inputs first.
        const priorityIds = currentTable?.derive
            ? (currentTable.derive.source as string[])
            : focusedTableId ? [focusedTableId] : [];
        const inputTableIds = inputTables.map(t => t.id);
        const selectedTableIds = clarificationContext?.sourceTableIds
            ? clarificationContext.sourceTableIds.filter(id => inputTableIds.includes(id))
            : [
                ...priorityIds.filter(id => inputTableIds.includes(id)),
                ...inputTableIds.filter(id => !priorityIds.includes(id)),
            ];

        // A real resume replays a trajectory; answering a clarify WITHOUT a
        // trajectory token is a fresh turn that still threads the conversation.
        const isResume = !!(clarificationContext?.trajectory && clarificationContext.trajectory.length > 0);
        const actionId = clarificationContext?.actionId || `exploreDataFromNL_${String(Date.now())}`;
        // Node ids come from this run segment, not the conversation: a resumed run
        // shares the conversation's `actionId`, and reusing it would overwrite the
        // earlier segment's request, steps and sets (design-docs/58).
        const runKey = clarificationContext?.actionId ? `${actionId}_${String(Date.now())}` : actionId;
        const inputTableById = new Map(inputTables.map(input => [input.id, input]));
        const actionTables = selectedTableIds
            .map(id => inputTableById.get(id))
            .filter((input): input is NonNullable<typeof input> => !!input);
        const runSourceTables = new Map(tables.filter(table => selectedTableIds.includes(table.id))
            .map(table => [table.id, table]));
        const resolveInputSourceTableIds = (sources: ComputationInputSource[]) => {
            const sourceNames = sources
                .filter(source => source.kind === 'data')
                .map(source => source.displayName.replace(/\.[^/.]+$/, ""));
            return [...runSourceTables.values()].filter(table => {
                const name = table.virtual?.tableId || table.id.replace(/\.[^/.]+$/, "");
                return !!name && sourceNames.includes(name);
            }).map(table => table.id);
        };

        // Seed the auto-focus baseline with whatever chart the user is
        // currently looking at. Otherwise the lock effect would compare the
        // current focused chart to `null` on run-start and trip immediately,
        // blocking the first-artifact auto-focus.
        lastAutoFocusedChartIdRef.current = focusedId?.type === 'chart' ? focusedId.chartId : null;
        firstFocusedThisRunRef.current = false;
        userChartFocusLockedRef.current = false;
        // Capture the source chart for any TextTurn this run emits — its CANVAS
        // anchor (focusing the turn keeps this chart on the canvas, design-docs/41).
        // Fall back to the last-focused chart ONLY when it belongs to the asked-
        // from table; otherwise an unrelated chart from a prior run would hijack
        // the turn's canvas anchor and yank focus onto that chart's (result)
        // table instead of leaving the user on the table they asked from.
        runSourceChartIdRef.current = (() => {
            if (focusedId?.type === 'chart') return focusedId.chartId;
            const lc = lastChartFocusRef.current;
            if (lc) {
                const lastChart = charts.find(c => c.id === lc);
                if (lastChart && lastChart.tableRef === focusedTableId) return lc;
            }
            return null;
        })();
        // Conversation follows an existing thread artifact by default. A
        // merely-focused source table is workspace context, not a thread yet.
        const focusedConversationNodeId = (() => {
            if (focusedId?.type === 'conversation') return focusedId.nodeIds?.[focusedId.nodeIds.length - 1] || focusedId.tableId;
            if (focusedId?.type === 'text') return focusedId.textId;
            if (focusedId?.type === 'chart') {
                return charts.find(chart => chart.id === focusedId.chartId)?.tableRef ?? null;
            }
            // An artifact (a table reference, or an app or file open on the
            // canvas) continues the conversation it hangs off.
            if (focusedId?.type === 'reference') {
                return focusedReference ? threadGraph.continuationOf(focusedReference.id) : undefined;
            }
            if (focusedId?.type === 'file') {
                const file = fileNodes.find(node => node.path === focusedId.fileName);
                return file ? threadGraph.continuationOf(file.id) ?? null : null;
            }
            if (focusedId?.type === 'table') {
                return tables.find(table => table.id === focusedId.tableId)?.derive
                    ? focusedId.tableId
                    : null;
            }
            if (focusedId?.type === 'report') {
                const report = generatedReports.find(item => item.id === focusedId.reportId);
                return (report?.parentNodeId ? threadGraph.continuationOf(report.id) : report?.triggerTableId) || null;
            }
            if (focusedId?.type === 'draft') {
                return draftNodes.find(item => item.id === focusedId.draftId)?.parentNodeId || null;
            }
            return null;
        })();
        const requestedParentNode = resolveRunParentNodeId(
            clarificationContext?.parentNodeId,
            focusedConversationNodeId,
            createConversationRootId(),
        );
        const askedFromNode = requestedParentNode;
        runLastNodeRef.current = askedFromNode;
        // The TABLE the pending draft anchors to (drafts are table-keyed): the
        // asked-from node resolved to its thread table, so the "working…" banner
        // shows where the finalized turn/table will land.
        const askedFromTable = threadGraph.tableOf(askedFromNode) ?? null;

        setIsChatFormulating(true);

        // ── Build structured thread context (Tier 2 + Tier 3) ──
        // Skip on resume — the trajectory already carries the prior context.
        const { focusedThread, otherThreads } = isResume
            ? { focusedThread: undefined, otherThreads: undefined }
            : buildThreadContext(askedFromNode ?? focusedTableId);

        // Analyst references resolve against the persisted input tables (durable
        // workspace id + snapshot schema), not the preview rows held for display.
        const primaryTableNames = primaryTableIds.map(id => {
            const input = inputTableById.get(id);
            return input ? workspaceTableIdOf(input) : id.replace(/\.[^/.]+$/, "");
        });
        const externalReferences = (currentStore.getState() as DataFormulatorState).externalTableReferences || [];
        const externalReferenceId = (() => {
            const exists = (id: string | undefined) => externalReferences.some(reference => reference.id === id);
            if (focusedId?.type === 'external-table' || focusedExternalReferenceId) return focusedExternalReferenceId;
            const startId = clarificationContext?.parentNodeId
                || (focusedId?.type === 'draft' ? focusedId.draftId : askedFromNode);
            for (const nodeId of threadGraph.ancestors(startId, { includeSelf: true })) {
                const turn = textTurns.find(item => item.id === nodeId);
                const table = tables.find(item => item.id === nodeId);
                const draft = draftNodes.find(item => item.id === nodeId);
                const referenceId = turn?.externalReferenceId || table?.derive?.trigger.externalReferenceId
                    || draft?.derive.trigger.externalReferenceId
                    || loadedTableNodes.find(node => node.id === nodeId && node.external)?.tableId;
                if (exists(referenceId)) return referenceId;
            }
            return undefined;
        })();
        const requestBody: any = {
            conversation_id: actionId,
            input_tables: actionTables.map(toAnalystTableRef),
            external_references: externalReferences,
            focused_external_reference: externalReferenceId,
            // What the agent may replace to fix an artifact the user wants fixed.
            replaceable_artifacts: listReplaceableArtifacts({ tables, charts, fileNodes, reports: generatedReports,
                graph: threadGraph, focusNodeId: askedFromNode }),
            primary_tables: primaryTableNames,
            ...(images.length > 0 ? { attached_images: images } : {}),
            ...(scratchPaths.length > 0 ? { scratch_files: scratchPaths } : {}),
            ...(focusedId?.type === 'file' ? { focused_file: focusedId.fileName }
                : focusedReference?.kind === 'file' ? { focused_file: focusedReference.path } : {}),
            model: activeModel,
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
        const formOwner = canvasTarget?.type === 'text'
            ? textTurns.find(turn => turn.id === canvasTarget.textId && turn.form)
            : undefined;
        if (formOwner?.form?.kind === 'connector' && formOwner.form.draft) {
            const form = formOwner.form;
            const values = connectorParams[`connector-form:${formOwner.id}`] || {};
            requestBody.connector_form = {
                form_id: formOwner.id,
                source_type: form.connector.sourceType,
                status: form.connector.status || 'pending',
                revision: form.draft!.revision,
                values: Object.fromEntries(form.draft!.fields
                    .filter(name => typeof values[name] === 'string').map(name => [name, values[name]])),
            };
        }

        if (isResume) {
            // Resume: just send the assembled prompt as user_question. The
            // backend appends it to the trajectory as a normal user message.
            // No special clarification payload needed.
            requestBody.trajectory = clarificationContext!.trajectory;
            requestBody.user_question = agentPrompt;
            requestBody.completed_step_count = clarificationContext!.completedStepCount || 0;
            if (clarificationContext!.interactionResponse) {
                requestBody.interaction_response = clarificationContext!.interactionResponse;
            }
            if (clarificationContext!.terminalResponse) {
                requestBody.terminal_response = clarificationContext!.terminalResponse;
            }
        } else {
            requestBody.user_question = agentPrompt;
            if (focusedThread) requestBody.focused_thread = focusedThread;
            if (otherThreads) requestBody.other_threads = otherThreads;
        }

        const messageBody = JSON.stringify(requestBody);

        const controller = new AbortController();
        agentAbortRef.current = controller;
        const pendingLoadId = `agent-load-${runKey}`;
        const clearPendingLoad = () => dispatch(dfActions.finishTableLoad(pendingLoadId));
        controller.signal.addEventListener('abort', clearPendingLoad, { once: true });
        let timedOut = false;
        const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, config.formulateTimeoutSeconds * 6 * 1000);

        let allResults: any[] = [];
        let createdTables: DictTable[] = [];
        let createdCharts: Chart[] = [];
        let allNewConcepts: FieldItem[] = [];
        let isCompleted = false;
        let lastCreatedTableId: string | null = clarificationContext?.lastCreatedTableId ?? null;

        // ── DraftNode tracking ──
        let currentDraftId: string | null = null;
        const createNextDraft = (parentNodeId: string, parentTableId: string) => {
            const draftId = `draft-${runKey}-${Date.now()}`;
            dispatch(dfActions.createDraftNode({
                id: draftId,
                displayId: draftId,
                parentNodeId,
                parentTableId,
                source: selectedTableIds,
                interaction: [],
                actionId,
                externalReferenceId,
            }));
            currentDraftId = draftId;
            return draftId;
        };

        // The user's message is its own node, following the node they asked
        // from (design-docs/58). Approving a pending command is not a message.
        let draftParentId = askedFromNode;
        if (!clarificationContext?.terminalResponse) {
            const promptId = `textTurn_${runKey}_prompt`;
            dispatch(dfActions.addTextTurn({
                kind: 'text', id: promptId, displayId: promptId, textKind: 'explain', content: '',
                prompt: cleanDisplay || agentPrompt,
                ...(attachmentNames.length ? { attachments: attachmentNames } : {}),
                externalReferenceId, parentNodeId: askedFromNode, actionId, createdAt: Date.now(),
            }));
            runLastNodeRef.current = promptId;
            draftParentId = promptId;
        }
        createNextDraft(draftParentId, askedFromTable || askedFromNode);

        // Track the last agent display_instruction (from "action" events)
        let lastAgentDisplayInstruction: string | null = null;
        let lastAgentInputTables: string[] = [];
        let lastAgentInputSources: ComputationInputSource[] = [];

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
        let thinkingSteps: ProgressStep[] = [];
        let pendingThought: string = '';
        let progressCount = 0;
        const pendingToolSteps = new Map<string, ProgressStep>();
        const executionTurnIds = new Map<string, string>();
        const seenToolCalls = new Set<string>();
        const addProgressStep = (label: string, kind: ProgressStep['kind'], status: ProgressStep['status'] = 'completed',
            metadata: Pick<ProgressStep, 'tool' | 'toolCallId' | 'executionId'> = {}) => {
            const step: ProgressStep = { id: `progress-${runKey}-${++progressCount}`, kind, label, status, ...metadata };
            thinkingSteps.push(step);
            return step;
        };
        const snapshotProgress = (settled = false): ProgressStep[] => thinkingSteps.map(step => ({ ...step,
            status: settled && step.status === 'running' ? step.kind === 'tool' ? 'interrupted' : 'completed' : step.status,
        }));
        const publishProgress = (steps = snapshotProgress()) => {
            if (currentDraftId) dispatch(dfActions.updateDraftRunningPlan({ draftId: currentDraftId,
                plan: steps.map(step => step.label).join(STEP_SEP), progressSteps: steps }));
        };
        const persistExecutionProgress = (step: ProgressStep) => {
            const turnId = step.executionId && executionTurnIds.get(step.executionId);
            if (!turnId) return;
            const existing = (currentStore.getState() as DataFormulatorState).textTurns.find(turn => turn.id === turnId);
            const steps = existing?.progressSteps || [];
            dispatch(dfActions.updateTextTurn({ id: turnId, progressSteps: steps.some(item => item.id === step.id)
                ? steps.map(item => item.id === step.id ? { ...step } : item) : [...steps, { ...step }] }));
        };
        const interruptProgress = () => {
            for (const step of pendingToolSteps.values()) {
                step.status = 'interrupted';
                persistExecutionProgress(step);
            }
            pendingToolSteps.clear();
            thinkingSteps.forEach(step => { if (step.status === 'running') step.status = 'interrupted'; });
            publishProgress();
        };

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
        const ensureReport = (replaces?: { id?: string; node_id?: string }) => {
            if (reportId) return reportId;
            const newId = `report-${Date.now()}`;
            // The report this one fixes (`replaces`), deleted once this one is in place.
            const replacedReport = replaces ? (currentStore.getState() as DataFormulatorState).generatedReports
                .find(report => report.id === (replaces.node_id || replaces.id)) : undefined;
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
                parentNodeId: chainHead(),
                triggerTableId: lastCreatedTableId || focusedTableId,
            };
            if (replacedReport) inProgressReport.replaced = { id: replacedReport.id, name: replacedReport.title || replacedReport.id };
            settleStep();
            inProgressReport.parentNodeId = chainHead();
            dispatch(dfActions.saveGeneratedReport(inProgressReport));
            itemProduced(newId);
            if (replacedReport) dispatch(dfActions.deleteGeneratedReport(replacedReport.id));
            dispatch(dfActions.setFocused({ type: 'report', reportId: newId }));
            dispatch(dfActions.setViewMode('report'));
            reportId = newId;
            return newId;
        };

        let terminalResultReceived = false;
        const runningTerminalExecutions = new Map<string, { turnId: string; proposal: TerminalProposal }>();
        const runningCodeExecutions = new Map<string, { turnId: string; execution: NonNullable<TextTurn['codeExecutions']>[number] }>();
        let codeExecutionCount = 0;

        // ── The run's chain (design-docs/58) ──
        // `runLastNodeRef` is the head of this run's chain. The current step's
        // thinking and tool calls collect on one agent message; an item the run
        // produces follows it and becomes the head; the items one result brings
        // in together form one artifact set. The live draft always follows the head.
        let stepMessageId: string | null = null;
        let stepCount = 0;
        let setCount = 0;
        function chainHead(): string {
            return runLastNodeRef.current || askedFromNode;
        }
        const advanceTo = (nodeId: string) => {
            runLastNodeRef.current = nodeId;
            if (currentDraftId) dispatch(dfActions.moveDraftNode({ draftId: currentDraftId, parentNodeId: nodeId }));
        };
        const ensureStepMessage = (content: string) => {
            if (stepMessageId) return stepMessageId;
            const turnId = `textTurn_${runKey}_step_${++stepCount}`;
            dispatch(dfActions.addTextTurn({
                kind: 'text', id: turnId, displayId: turnId, textKind: 'explain', externalReferenceId, content,
                parentNodeId: chainHead(),
                ...(runSourceChartIdRef.current ? { sourceChartId: runSourceChartIdRef.current } : {}),
                actionId, createdAt: Date.now(),
            }));
            stepMessageId = turnId;
            advanceTo(turnId);
            return turnId;
        };
        /** Move the step's finished thinking and tool steps onto its agent message; running steps stay live. */
        function settleStep(content?: string) {
            const thought: ProgressStep[] = pendingThought
                ? [{ id: `thought-${runKey}-${++progressCount}`, kind: 'thought', label: pendingThought, status: 'completed' }] : [];
            const finished = [...thought, ...thinkingSteps.filter(step => step.status !== 'running')];
            if (!finished.length && content === undefined && !stepMessageId) return;
            const turnId = ensureStepMessage(content ?? '');
            const existing = (currentStore.getState() as DataFormulatorState).textTurns.find(turn => turn.id === turnId);
            dispatch(dfActions.updateTextTurn({ id: turnId,
                ...(content !== undefined ? { content } : {}),
                progressSteps: [...(existing?.progressSteps || []).filter(step => !finished.some(item => item.id === step.id)), ...finished] }));
            thinkingSteps = thinkingSteps.filter(step => step.status === 'running');
            pendingThought = '';
            publishProgress();
        }
        /** Record an item the run just added with `chainHead()` as its parent: it becomes the head. */
        /**
         * Delete a table the agent replaced (with its charts and workspace data). What
         * followed it continues from where it came from; a canvas showing it shows the fix.
         */
        const retireReplacedTable = (tableId: string, replacementChartId: string) => {
            const state = currentStore.getState() as DataFormulatorState;
            const focus = state.focusedId;
            const showing = (focus?.type === 'table' && focus.tableId === tableId)
                || (focus?.type === 'chart' && dfSelectors.getAllCharts(state).some(chart => chart.id === focus.chartId && chart.tableRef === tableId));
            const retiredChartIds = new Set(dfSelectors.getAllCharts(state).filter(chart => chart.tableRef === tableId).map(chart => chart.id));
            dispatch(dfActions.deleteTable(tableId));
            runCreatedChartIds.splice(0, runCreatedChartIds.length, ...runCreatedChartIds.filter(id => !retiredChartIds.has(id)));
            createdTables = createdTables.filter(table => table.id !== tableId);
            createdCharts = createdCharts.filter(chart => chart.tableRef !== tableId);
            runSourceTables.delete(tableId);
            if (showing) dispatch(dfActions.setFocused({ type: 'chart', chartId: replacementChartId }));
        };
        function itemProduced(itemId: string) {
            stepMessageId = null;
            advanceTo(itemId);
        }
        /** Items one result brought in together, each added with `chainHead()` as its parent: one set when there are several. */
        const itemsProducedTogether = (itemIds: string[]) => {
            if (itemIds.length < 2) {
                if (itemIds[0]) itemProduced(itemIds[0]);
                return;
            }
            const setId = `artifactSet_${runKey}_${++setCount}`;
            dispatch(dfActions.addArtifactSet({ kind: 'artifact-set', id: setId, parentNodeId: chainHead(),
                memberIds: itemIds, createdAt: Date.now() }));
            itemProduced(setId);
        };
        /**
         * A loaded or virtual table the run produced; with `together`, the caller
         * chains it with the others from the same result. Refreshing one the run
         * already added keeps that item where it is (returns undefined).
         */
        const addLoadedItem = (id: string, tableId: string, external = false, together = false) => {
            if ((currentStore.getState() as DataFormulatorState).loadedTableNodes.some(node => node.id === id)) return undefined;
            settleStep();
            dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id, tableId, ...(external ? { external: true } : {}),
                parentNodeId: chainHead(), createdAt: Date.now() }));
            if (!together) itemProduced(id);
            return id;
        };
        /** A file or app the run wrote. A file it updated in place keeps its existing place in the thread. */
        const addFileItem = (fileName: string, displayName: string, contentHash: string, replaces?: { name?: string }) => {
            const existing = (currentStore.getState() as DataFormulatorState).fileNodes.find(node => node.path === fileName);
            if (existing && replaces) {
                // Fixed in place (`replaces`): it keeps its name and moves to after the request that fixed it.
                settleStep();
                dispatch(dfActions.replaceFileNode({ kind: 'file', id: existing.id, path: fileName, displayName, contentHash,
                    parentNodeId: chainHead(), createdAt: Date.now(),
                    replaced: { id: existing.id, name: replaces.name || existing.displayName || fileName } }));
                itemProduced(existing.id);
                return;
            }
            const exists = !!existing;
            if (!exists) settleStep();
            dispatch(dfActions.upsertFileNode({ kind: 'file', id: `file-${fileName}`, path: fileName, displayName, contentHash,
                parentNodeId: chainHead(), createdAt: Date.now() }));
            if (!exists) itemProduced(`file-${fileName}`);
        };
        /** Put a tool call on the step's agent message; a call awaiting approval pauses the run. */
        const addToolCall = (purpose: string, call: { execution?: TerminalExecution; codeExecution?: CodeExecution }, running: boolean) => {
            const turnId = ensureStepMessage(purpose);
            dispatch(dfActions.upsertTurnExecution({ turnId, ...call }));
            if (!running && currentDraftId) {
                dispatch(dfActions.removeDraftNode(currentDraftId));
                currentDraftId = null;
            }
            return turnId;
        };
        /** A message that ends the run's current step (an answer, a question, a form). */
        const addClosingMessage = (turn: Omit<TextTurn, 'parentNodeId' | 'createdAt' | 'actionId'>) => {
            // Tool calls already live on their step message; the closing message keeps only the rest.
            const progressSteps = turn.progressSteps?.filter(step => !(step.executionId && executionTurnIds.has(step.executionId)));
            dispatch(dfActions.addTextTurn({ ...turn, progressSteps: progressSteps?.length ? progressSteps : undefined,
                parentNodeId: chainHead(), actionId, createdAt: Date.now() }));
            runLastNodeRef.current = turn.id;
            stepMessageId = null;
            if (currentDraftId) {
                thinkingSteps = [];
                pendingThought = '';
                dispatch(dfActions.removeDraftNode(currentDraftId));
                currentDraftId = null;
            }
            return turn.id;
        };
        const emitClosingTurn = (summary: string, result: any = {}): string | null => {
            if (!summary && !reportId) return null;
            const resumeTraj = result.trajectory || result.content?.trajectory;
            return addClosingMessage({
                kind: 'text',
                id: `textTurn_${runKey}_${String(Date.now())}`,
                externalReferenceId,
                displayId: `textTurn_${runKey}_closing`,
                textKind: 'explain',
                content: summary,
                ...(result.content?.form ? { form: formArtifactFromEvent(result.content.form) } : {}),
                ...(result.content?.presentation === 'long_response' ? { presentation: 'long_response' as const } : {}),
                ...(runSourceChartIdRef.current ? { sourceChartId: runSourceChartIdRef.current } : {}),
                progressSteps: snapshotProgress(true),
                ...(resumeTraj ? { resume: {
                    trajectory: resumeTraj,
                    completedStepCount: result.completed_step_count || result.content?.completed_step_count || 0,
                } } : {}),
            });
        };
        let reportFinalized = false;
        // A pause (clarify / explain / interact) is a later committed action, so
        // the report written earlier in this run is complete. Settle it here: the
        // resumed run is a new request and would otherwise leave it "composing".
        const settleReportOnPause = () => {
            if (!reportId || reportFinalized) return;
            reportFlushNow();
            dispatch(dfActions.updateGeneratedReportContent({
                id: reportId,
                content: accumulatedReportMarkdown,
                status: accumulatedReportMarkdown.trim() ? 'completed' : 'error',
                title: accumulatedReportMarkdown.match(/^#\s+(.+)$/m)?.[1].trim(),
                triggerTableId: lastCreatedTableId || focusedTableId || undefined,
            }));
            reportFinalized = true;
        };
        const finalizeReport = (status: 'completed' | 'error', summary = '', result: any = {}) => {
            if (!reportId || reportFinalized) return;
            reportFlushNow();
            emitClosingTurn(summary, result);
            dispatch(dfActions.updateGeneratedReportContent({
                id: reportId,
                content: accumulatedReportMarkdown,
                status,
                title: accumulatedReportMarkdown.match(/^#\s+(.+)$/m)?.[1].trim(),
                triggerTableId: lastCreatedTableId || focusedTableId || undefined,
            }));
            reportFinalized = true;
        };
        const processStreamingResult = async (result: any) => {
            if (result.type === 'terminal_running' && clarificationContext?.terminalResponse?.decision === 'approve') {
                const execution = textTurns.find(turn => turn.id === clarificationContext.parentNodeId)?.executions
                    ?.find(execution => execution.id === clarificationContext.terminalResponse!.request_id);
                await processStreamingResult({ type: 'tool_start', tool: 'run_terminal', purpose: execution?.purpose,
                    tool_call_id: clarificationContext.terminalResponse.request_id,
                    execution_id: clarificationContext.terminalResponse.request_id });
                return;
            }
            if (result.type === 'terminal_started' || result.type === 'terminal_result' || (result.type === 'interact' && result.terminal_request)) {
                const proposal = (result.terminal_request || result.request) as TerminalProposal;
                const terminalExecution = (status: TerminalExecution['status'], outcome?: Record<string, any>): TerminalExecution => ({
                    id: proposal.id, argv: proposal.argv, cwd: proposal.cwd, purpose: proposal.purpose,
                    dangerouslyDisableSandbox: proposal.dangerouslyDisableSandbox, sandboxDisablingReason: proposal.sandboxDisablingReason,
                    sandboxFilesystem: outcome?.sandboxFilesystem ?? proposal.sandboxFilesystem,
                    status, ...(outcome ? { result: outcome } : {}),
                });
                // An approved command resumes on the message that proposed it.
                const knownTurnId = executionTurnIds.get(proposal.id)
                    || (clarificationContext?.terminalResponse?.request_id === proposal.id ? clarificationContext.parentNodeId : undefined);
                if (result.type === 'terminal_result') {
                    runningTerminalExecutions.delete(proposal.id);
                    terminalResultReceived = true;
                    const outcome = result.result || {};
                    const failed = !!(outcome.error || outcome.timed_out || (outcome.exit_code != null && outcome.exit_code !== 0));
                    const execution = terminalExecution(outcome.rejected ? 'rejected' : failed ? 'failed' : 'completed', outcome);
                    const turnId = knownTurnId || addToolCall(proposal.purpose, {}, true);
                    executionTurnIds.set(proposal.id, turnId);
                    dispatch(dfActions.upsertTurnExecution({ turnId, execution }));
                    await processStreamingResult({ type: 'tool_result', tool: 'run_terminal',
                        tool_call_id: proposal.id,
                        status: outcome.rejected || failed ? 'error' : 'success',
                        error: outcome.error,
                    });
                    return;
                }
                const running = result.type === 'terminal_started';
                const execution = terminalExecution(running ? 'running' : 'awaiting_approval');
                let turnId: string;
                if (knownTurnId) {
                    turnId = knownTurnId;
                    dispatch(dfActions.upsertTurnExecution({ turnId, execution }));
                } else {
                    turnId = addToolCall(proposal.purpose, { execution }, running);
                }
                executionTurnIds.set(proposal.id, turnId);
                if (running) {
                    runningTerminalExecutions.set(proposal.id, { turnId, proposal });
                    await processStreamingResult({ type: 'tool_start', tool: 'run_terminal', purpose: proposal.purpose,
                        tool_call_id: proposal.id, execution_id: proposal.id });
                }
                if (result.type === 'interact') {
                    setPendingTerminal({ proposal, trajectory: result.trajectory,
                        completedStepCount: result.completed_step_count || 0, actionId,
                        parentNodeId: turnId, lastCreatedTableId, sourceTableIds: selectedTableIds });
                    setChatPrompt('');
                    setAttachedImages([]);
                    setAttachedFiles([]);
                    dispatch(dfActions.setFocused({ type: 'text', textId: turnId }));
                }
                return;
            }
            if (result.type === "interact" && result.form) {
                const existingFormId = result.form.kind === 'connector' ? result.form.form_id : undefined;
                if (existingFormId && existingFormId !== requestBody.connector_form?.form_id) {
                    throw new Error('Connector update targets a form outside this request');
                }
                const sourceType = String(result.form.connector?.source_type ?? (existingFormId ? requestBody.connector_form.source_type : '')).trim();
                if (existingFormId) {
                    if (result.form.connector) {
                        dispatch(dfActions.selectConnectorFormSource({
                            id: existingFormId, sourceType,
                            title: String(result.form.title || 'Connect a data source'),
                            fields: [], revision: result.form.revision,
                            prefilled: result.form.connector.prefilled || {},
                        }));
                    } else dispatch(dfActions.patchConnectorDraft({
                        id: existingFormId,
                        revision: result.form.revision,
                        values: result.form.patch || {},
                    }));
                }
                const turnId = addClosingMessage({
                    kind: 'text',
                    id: `textTurn_${runKey}_${String(Date.now())}`,
                    externalReferenceId,
                    displayId: `textTurn_${runKey}_form`,
                    textKind: 'explain',
                    content: String(result.form.response || result.form.title || `Connect to ${sourceType}`),
                    ...(existingFormId ? {} : { form: formArtifactFromEvent(result.form) }),
                    ...(runSourceChartIdRef.current ? { sourceChartId: runSourceChartIdRef.current } : {}),
                    progressSteps: snapshotProgress(true),
                });
                if (!existingFormId && result.form.auto_submit === true) requestAutoSubmit(turnId);
                // An open form stays in view until it is resolved, including when the agent updates it.
                dispatch(dfActions.setFocused({ type: 'text', textId: existingFormId || turnId }));
                setIsChatFormulating(false);
                agentAbortRef.current = null;
                clearTimeout(timeoutId);
                setChatPrompt("");
                setAttachedImages([]);
                setAttachedFiles([]);
                isCompleted = true;
                return;
            }
            // ── interact: the unified agent's clarify/explain pause ──
            // Alias to the legacy clarify path (same questions[] shape + the
            // backend now stamps trajectory/completed_step_count for resume).
            if (result.type === "interact") {
                result = { ...result, type: "clarify" };
            }

            if (result.type === "data_operation_result") {
                const operation = parseDataOperation(result.operation);
                // Only the turn that proposed this operation owns it; loads the agent runs
                // mid-run continue from the run's latest output instead.
                const proposalTurn = (currentStore.getState() as DataFormulatorState).textTurns.find(turn =>
                    turn.id === askedFromNode
                    && (turn.dataOperation?.id === operation.id || turn.resume?.operationId === operation.id));
                if (proposalTurn) {
                    dispatch(dfActions.updateTextTurn({
                        id: proposalTurn.id,
                        dataOperation: operation,
                    }));
                }
                if (operation.status === 'loaded' || operation.status === 'partially_loaded') {
                    // The items one operation brings in are produced together: one artifact set when there
                    // are several. A reference that a loaded table was queried from is that table's source,
                    // not an item of its own; it stays on the shelf and the table names it.
                    const storedReferences = (operation.resultReferences || []).map(reference => {
                        dispatch(dfActions.upsertExternalTableReference(reference));
                        return (currentStore.getState() as DataFormulatorState).externalTableReferences.find(item =>
                            item.connectorId === reference.connectorId && item.tableKey === reference.tableKey);
                    }).filter((reference): reference is NonNullable<typeof reference> => !!reference);
                    if (!operation.resultTableIds.length && operation.resultReferences?.length) {
                        dispatch(dfActions.setFocused({ type: 'external-table', referenceId: operation.resultReferences[0].id }));
                    }
                    const { data } = operation.resultTableIds.length
                        ? await apiRequest(getUrls().LIST_TABLES, { method: 'GET' }) : { data: { tables: [] } };
                    const publishedIds = new Set(operation.resultTableIds);
                    const publishedTables = (data.tables || [])
                        .filter((table: any) => publishedIds.has(table.name));
                    const loadedTables: DictTable[] = [];
                    for (const workspaceTable of publishedTables) {
                        const existing = tables.find(table => table.id === workspaceTable.name);
                        const table = existing || buildDictTableFromWorkspace(workspaceTable, undefined);
                        runSourceTables.set(table.id, table);
                        if (!existing) dispatch(dfActions.addTableToStore(table));
                        loadedTables.push(table);
                        if (!existing) {
                            dispatch(fetchFieldSemanticType(table));
                            dispatch(fetchColumnStats(table));
                        }
                    }
                    const queriedSources = new Set(loadedTables.map(table => table.source?.importedFrom)
                        .filter(Boolean).map(origin => `${origin!.connectorId}\n${origin!.tableKey}`));
                    const loadedIds: string[] = [];
                    for (const reference of storedReferences) {
                        if (queriedSources.has(`${reference.connectorId}\n${reference.tableKey}`)) continue;
                        const added = addLoadedItem(`loaded-reference-${runKey}-${reference.id}`, reference.id, true, true);
                        if (added) loadedIds.push(added);
                    }
                    for (const table of loadedTables) {
                        const added = addLoadedItem(`loaded-table-${runKey}-${table.id}`, table.id, false, true);
                        if (added) loadedIds.push(added);
                    }
                    itemsProducedTogether(loadedIds);
                    const firstLoadedTable = loadedIds.find(id => id.startsWith(`loaded-table-${runKey}-`));
                    if (firstLoadedTable) dispatch(dfActions.setFocused({ type: 'reference', referenceId: firstLoadedTable }));
                    if (operation.status === 'partially_loaded') {
                        dispatch(dfActions.addMessages({
                            timestamp: Date.now(),
                            type: 'error',
                            component: 'data-agent',
                            value: t('dataLoading.operation.partialFailure', {
                                count: operation.failedSteps.length,
                            }),
                        }));
                    }
                } else if (operation.status === 'failed') {
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(),
                        type: 'error',
                        component: 'data-agent',
                        value: operation.error?.message || t('chartRec.explorationFailed', { message: '' }),
                    }));
                }
                clearPendingLoad();
                return;
            }

            // ── report streaming (AnalystAgent only) ──
            // write_report commitment → create the report + switch view.
            if (result.type === "action" && result.action === "write_report") {
                ensureReport(result.replaces);
                // Flush any buffered agent reasoning as its own step. We do NOT
                // add an "outputting write_report" step — the live generating
                // report card already indicates that the report is being
                // written, so the explicit step would be redundant.
                if (pendingThought) {
                    addProgressStep(pendingThought, 'thought');
                    pendingThought = '';
                    if (currentDraftId) {
                        publishProgress();
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

            // write_app / write_html_app (new or rewritten in place) → add the app to the thread and open it.
            if (result.type === "action" && (result.action === "write_app" || result.action === "write_html_app")) {
                const file = result.file;
                if (file && typeof file.path === 'string' && file.path.startsWith('files/')
                    && typeof file.content_hash === 'string') {
                    const fileName = file.path.slice('files/'.length);
                    notifyWorkspaceFilesChanged();
                    addFileItem(fileName, file.display_name || fileName, file.content_hash, result.replaces);
                    dispatch(dfActions.setFocused({ type: 'file', fileName }));
                    if (pendingThought) {
                        addProgressStep(pendingThought, 'thought');
                        pendingThought = '';
                    }
                    addProgressStep(t(result.updated ? 'htmlApp.updated' : 'htmlApp.created', { title: file.display_name || fileName }), 'info');
                    if (currentDraftId) {
                        publishProgress();
                    }
                }
                return;
            }

            // ── context_info: show injected rules/knowledge at the top ──
            if (result.type === "context_info") {
                const rules: string[] = result.rules_injected || [];
                const knowledge: Array<{category: string; title: string}> = result.knowledge_injected || [];
                let added = false;
                if (rules.length > 0) {
                    addProgressStep(t('dataThread.rulesLoaded', { rules: rules.join(', ') }), 'info');
                    added = true;
                }
                if (knowledge.length > 0) {
                    const titles = knowledge.map(k => k.title).join(', ');
                    addProgressStep(t('dataThread.knowledgeLoaded', { knowledge: titles }), 'info');
                    added = true;
                }
                if (added && currentDraftId) {
                    publishProgress();
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
                        publishProgress([{ id: `thinking-${runKey}`, kind: 'thought', label: t('dataThread.thinking'), status: 'running' }]);
                    }
                }
            }

            // ── tool_start: agent is calling a tool (explore/inspect) ──
            if (result.type === "tool_start") {
                const toolCallId = result.tool_call_id || (result.tool === 'run_terminal'
                    ? clarificationContext?.terminalResponse?.request_id : undefined);
                if (toolCallId && seenToolCalls.has(toolCallId)) return;
                if (toolCallId) seenToolCalls.add(toolCallId);
                if (pendingThought) {
                    addProgressStep(pendingThought, 'thought');
                    pendingThought = '';
                }
                const step = addProgressStep('', 'tool', 'running', { tool: result.tool, toolCallId,
                    executionId: result.execution_id || (result.tool === 'run_terminal' ? toolCallId : undefined) });
                pendingToolSteps.set(step.id, step);
                // An approved command resumes on the message that proposed it; any other command
                // stays on the step message that ran it.
                if (result.tool === 'run_terminal' && step.executionId && !executionTurnIds.has(step.executionId)
                    && clarificationContext?.parentNodeId && clarificationContext.terminalResponse?.request_id === step.executionId) {
                    executionTurnIds.set(step.executionId, clarificationContext.parentNodeId);
                }
                if (result.tool === 'execute_python_script' || result.tool === 'explore') {
                    const execution: CodeExecution = {
                        id: `code_${runKey}_${++codeExecutionCount}`, tool: result.tool, purpose: result.purpose || t('dataThread.runningCode'),
                        code: result.code || result.args?.code || '', status: 'running', createdAt: Date.now(),
                    };
                    const turnId = addToolCall(execution.purpose, { codeExecution: execution }, true);
                    runningCodeExecutions.set(step.id, { turnId, execution });
                    step.executionId = execution.id;
                    executionTurnIds.set(execution.id, turnId);
                }
                if (result.tool === 'load_data' && !controller.signal.aborted) {
                    const names = (Array.isArray(result.args?.tables) ? result.args.tables : [])
                        .filter((name: unknown): name is string => typeof name === 'string' && !!name.trim());
                    dispatch(dfActions.startTableLoad({ id: pendingLoadId,
                        names: names.length ? names : [t('dataLoading.toolLabels.loadingData', { defaultValue: 'Loading data' })] }));
                }
                if (result.tool === "explore" || result.tool === "execute_python_script" || result.tool === 'run_terminal') {
                    const purpose = result.purpose || result.args?.purpose || '';
                    const label = result.tool === 'run_terminal'
                        ? t('dataThread.runningCommand', { defaultValue: 'Running command' }) : t('dataThread.runningCode');
                    if (purpose) {
                        step.label = label + ' ' + purpose;
                    } else {
                        const codePreview = result.code || '';
                        const meaningfulLine = codePreview.split('\n').find((l: string) => l.trim() && !l.trim().startsWith('import ') && !l.trim().startsWith('from ')) || codePreview.split('\n')[0] || '';
                        step.label = label + (meaningfulLine ? `: ${meaningfulLine.trim()}` : '');
                    }
                } else if (result.tool === "inspect_source_data") {
                    const tableNames = result.table_names?.join(', ') || '';
                    step.label = t('dataThread.inspectingData') + (tableNames ? ` ${tableNames}` : '');
                } else if (result.tool === "inspect_chart") {
                    step.label = t('dataThread.inspectingChart');
                } else if (result.tool === "load_skill") {
                    step.label = t('dataThread.loadingSkill', { skill: result.skill || '' });
                } else if (result.tool === "search_data_tables" || result.tool === "search_knowledge") {
                    const query = result.query || '';
                    step.label = t('dataThread.searching') + (query ? ` "${query}"` : '');
                } else if (["visualize", "clarify", "present", "action"].includes(result.tool)) {
                    step.label = t('dataThread.producingAction', { action: result.tool });
                } else {
                    step.label = formatAnalystToolProgress(
                        result.tool || 'tool',
                        result.args,
                        t,
                    );
                }
                persistExecutionProgress(step);
                if (currentDraftId) {
                    publishProgress();
                }
            }

            if (result.type === "tool_result") {
                const isError = result.status === "error" || !!result.error;
                const matchingSteps = [...pendingToolSteps.values()].filter(step => step.tool === result.tool
                    && (!result.tool_call_id || step.toolCallId === result.tool_call_id));
                const step = matchingSteps.length === 1 ? matchingSteps[0] : undefined;
                const runningCode = step && runningCodeExecutions.get(step.id);
                if (runningCode) {
                    dispatch(dfActions.upsertTurnExecution({ turnId: runningCode.turnId, codeExecution: {
                        ...runningCode.execution, status: isError ? 'failed' : 'completed',
                        output: String(result.stdout || ''), error: result.error ? String(result.error) : undefined,
                    } }));
                    runningCodeExecutions.delete(step!.id);
                }
                if (step) {
                    step.status = isError ? 'failed' : 'completed';
                    pendingToolSteps.delete(step.id);
                    persistExecutionProgress(step);
                }
                if (result.tool === 'load_data' && isError) clearPendingLoad();
                if (['create_data', 'update_data'].includes(result.tool) && !isError) {
                    const output = JSON.parse(result.stdout || '{}');
                    if (typeof output.table_name === 'string') {
                        const { data } = await apiRequest(getUrls().LIST_TABLES, { method: 'GET' });
                        const workspaceTable = (data.tables || []).find((item: any) => item.name === output.table_name);
                        if (workspaceTable) {
                            const table = buildDictTableFromWorkspace(workspaceTable, undefined);
                            const existing = runSourceTables.get(table.id) || tables.find(item => item.id === table.id);
                            table.displayId = existing?.displayId || output.display_name || table.displayId;
                            runSourceTables.set(table.id, table);
                            dispatch(dfActions.addTableToStore(table));
                            addLoadedItem(`data-reference-${runKey}-${table.id}`, table.id);
                            dispatch(fetchFieldSemanticType(table));
                            dispatch(fetchColumnStats(table));
                        }
                    }
                }
                if (['create_file', 'edit_file'].includes(result.tool) && !isError) {
                    notifyWorkspaceFilesChanged();
                    let file;
                    try {
                        file = JSON.parse(result.stdout || '{}');
                    } catch {
                        file = null;
                    }
                    if (file && typeof file.path === 'string' && file.path.startsWith('files/')
                        && typeof file.content_hash === 'string' && file.available_in_workspace === true) {
                        const fileName = file.path.slice('files/'.length);
                        addFileItem(fileName, file.display_name || file.name || fileName, file.content_hash, file.replaces);
                        // An app the agent edited comes into view, like a newly written one.
                        if (result.tool === 'edit_file' && file.app === true) {
                            dispatch(dfActions.setFocused({ type: 'file', fileName }));
                            addProgressStep(t('htmlApp.updated', { title: file.display_name || fileName }), 'info');
                        }
                    }
                }
                if (isError && result.error) {
                    const errPreview = String(result.error).split('\n').pop()?.trim() || String(result.error).slice(0, 120);
                    addProgressStep(errPreview, 'warning');
                }
                if (currentDraftId) {
                    publishProgress();
                }
            }

            // ── action: agent chose what to do ──
            if (result.type === "action") {
                lastAgentInputTables = result.input_tables || [];
                lastAgentInputSources = Array.isArray(result.input_sources)
                    ? result.input_sources.map((source: any) => ({
                        id: String(source.id),
                        kind: source.kind === 'file' ? 'file' : 'data',
                        displayName: String(source.display_name || source.id),
                    }))
                    : lastAgentInputTables.map(name => ({
                        id: name,
                        kind: 'data' as const,
                        displayName: name,
                    }));
                if (currentDraftId) {
                    dispatch(dfActions.updateDraftSources({
                        draftId: currentDraftId,
                        source: resolveInputSourceTableIds(lastAgentInputSources),
                        inputSources: lastAgentInputSources,
                    }));
                }
                if (result.action === "visualize") {
                    lastAgentDisplayInstruction = result.display_instruction || null;
                    addProgressStep(t('dataThread.creatingChart') + (lastAgentDisplayInstruction ? ` ${lastAgentDisplayInstruction}` : ''), 'chart', 'running');
                    if (currentDraftId) {
                        publishProgress();
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
                // Only an instruction the agent gave is stored; the table carries its own title.
                const displayInstruction: string = lastAgentDisplayInstruction || refinedGoal?.display_instruction || question || '';

                const candidateTable = createDictTable(candidateTableId, rows, undefined);
                // Resolve source tables from agent's input_tables (names it chose to use)
                const resolvedSourceIds = resolveInputSourceTableIds(lastAgentInputSources);
                const triggerTableId = resolveDerivedTriggerTableId(lastCreatedTableId, resolvedSourceIds[0], askedFromNode);
                candidateTable.derive = {
                    code: code || t('chartRec.explorationStepCodeComment', { step: createdTables.length + 1 }),
                    codeSignature: result.content?.result?.code_signature,
                    outputVariable: refinedGoal?.output_variable || 'result_df',
                    source: resolvedSourceIds,
                    inputSources: lastAgentInputSources,
                    dialog: dialog || [],
                    trigger: {
                        tableId: triggerTableId,
                        externalReferenceId,
                        resultTableId: candidateTableId,
                        chart: undefined,
                    }
                };
                // The step that made the table is the agent message before it (design-docs/58):
                // its instruction, thinking, and tool calls. The table's own code stays on the table.
                for (const step of thinkingSteps) if (step.kind === 'chart' && step.status === 'running') step.status = 'completed';
                settleStep(displayInstruction || undefined);
                const instructionTurnId = chainHead();
                lastAgentDisplayInstruction = null;
                lastAgentInputTables = [];
                lastAgentInputSources = [];
                if (transformedData.virtual) {
                    candidateTable.virtual = { tableId: transformedData.virtual.table_name, rowCount: transformedData.virtual.row_count };
                    candidateTable.displayId = transformedData.virtual.table_name;
                }
                candidateTable.displayId = refinedGoal?.display_name || candidateTable.displayId;

                const semanticFields = authoredFieldSemantics(candidateTable.names,
                    refinedGoal?.['field_metadata'], refinedGoal?.['field_display_names']);
                if (Object.keys(semanticFields).length > 0) {
                    dispatch(dfActions.applyAuthoredFieldSemantics({ tableId: candidateTableId, fields: semanticFields }));
                }

                // The table this one fixes (`replaces`), deleted with its chart once this one is in place.
                const replaces = result.content.replaces;
                const replacedTable = replaces ? (currentStore.getState() as DataFormulatorState).derivedTables.find(table =>
                    table.id !== candidateTableId
                    && (table.id === replaces.node_id || table.id === replaces.id || table.virtual?.tableId === replaces.id)) : undefined;
                if (replacedTable) candidateTable.replaced = { id: replacedTable.id, name: replacedTable.displayId || replacedTable.id };

                createdTables.push(candidateTable);
                runSourceTables.set(candidateTable.id, candidateTable);
                lastCreatedTableId = candidateTableId;

                // The authored edge controls appearance; derive.trigger remains
                // the data/agent anchor even when both happen to name one table.
                candidateTable.parentNodeId = instructionTurnId;
                candidateTable.createdAt = Date.now();

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

                let triggerChart = generateFreshChart(triggerTableId, 'Auto') as Chart;
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
                    const insightSubtitle = refinedGoal?.subtitle;
                    if (typeof insightSubtitle === 'string' && insightSubtitle.trim()) {
                        newChart.subtitle = insightSubtitle.trim();
                    }
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

                itemProduced(candidateTableId);
                if (replacedTable) retireReplacedTable(replacedTable.id, newChart.id);
            }

            // ── clarify / explain: pause and let user respond ──
            // Both events share the same shape (questions[]); the event type
            // picks the message's kind, which the panel uses for palette/labels.
            if (result.type === "clarify" || result.type === "explain") {
                const isExplainEvent = result.type === "explain";
                let normalizedClarification;
                let dataOperation;
                try {
                    normalizedClarification = normalizeClarifyEvent(result);
                    dataOperation = result.data_operation
                        ? parseDataOperation(result.data_operation)
                        : undefined;
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
                    // The pause is an agent message that ends this step (design-docs/41, 58).
                    const turnId = addClosingMessage({
                        kind: 'text',
                        id: `textTurn_${runKey}_${String(Date.now())}`,
                        externalReferenceId,
                        displayId: `textTurn_${runKey}_pause`,
                        textKind: isExplainEvent ? 'explain' : 'clarify',
                        progressSteps: snapshotProgress(true),
                        content: dataOperation?.description || normalizedClarification.summary,
                        ...(isExplainEvent ? {} : { options: normalizedClarification.questions }),
                        ...(dataOperation ? { dataOperation } : {}),
                        ...(runSourceChartIdRef.current ? { sourceChartId: runSourceChartIdRef.current } : {}),
                        // Resume token (§12): present iff the backend stamped a
                        // trajectory on the event (clarify/interact does today).
                        ...(result.trajectory ? { resume: {
                            trajectory: result.trajectory,
                            completedStepCount: result.completed_step_count || 0,
                            ...(result.data_operation?.id ? { operationId: result.data_operation.id } : {}),
                        } } : {}),
                    });
                    dispatch(dfActions.setFocused({ type: 'text', textId: turnId }));
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
                if (reportId) {
                    finalizeReport('completed', summary, result);
                } else {
                    const closingTurnId = emitClosingTurn(summary, result);
                    if (closingTurnId) {
                        // Expand the answer once the run lands — the canvas still
                        // resolves to the nearest chart, so this doesn't hide the
                        // artifact the answer is about.
                        dispatch(dfActions.setFocused({ type: 'text', textId: closingTurnId }));
                    }
                }
            }
        };

        const handleCompletion = () => {
            if (isCompleted) return;
            finalizeReport('error');
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
                        interruptProgress();
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
                        agentAbortRef.current = null;
                        finalizeReport('error');
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
                    if (data.type === "completion" || data.type === "clarify" || data.type === "explain" || data.type === "interact") {
                        if (data.type !== "completion") settleReportOnPause();
                        handleCompletion();
                        return;
                    }
                }
                handleCompletion();
            } catch (error: any) {
                interruptProgress();
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
                if (reportId) {
                    finalizeReport('error');
                    if (!isCancelled && !isTimeout) {
                        dispatch(dfActions.addMessages({
                            timestamp: Date.now(), type: 'error', component: 'data-agent', value: errorMessage,
                        }));
                    }
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
            } finally {
                interruptProgress();
                for (const { turnId, execution } of runningCodeExecutions.values()) {
                    dispatch(dfActions.upsertTurnExecution({ turnId, codeExecution: { ...execution, status: 'interrupted' } }));
                }
                for (const { turnId, proposal } of runningTerminalExecutions.values()) {
                    dispatch(dfActions.upsertTurnExecution({ turnId, execution: {
                        id: proposal.id, argv: proposal.argv, cwd: proposal.cwd, purpose: proposal.purpose, status: 'interrupted',
                        dangerouslyDisableSandbox: proposal.dangerouslyDisableSandbox, sandboxDisablingReason: proposal.sandboxDisablingReason,
                        sandboxFilesystem: proposal.sandboxFilesystem,
                    } }));
                }
                if (clarificationContext?.terminalResponse?.decision === 'approve' && !terminalResultReceived) {
                    const owner = textTurns.find(turn => turn.id === clarificationContext.parentNodeId);
                    if (owner?.executions) {
                        dispatch(dfActions.updateTextTurn({
                            id: owner.id,
                            executions: owner.executions.map(execution => execution.id === clarificationContext.terminalResponse!.request_id
                                ? { ...execution, status: 'interrupted' } : execution),
                        }));
                    }
                }
                clearPendingLoad();
                controller.signal.removeEventListener('abort', clearPendingLoad);
                notifyWorkspaceFilesChanged();
            }
        })();
    }, [focusedId, focusedTableId, focusedExternalReferenceId, tables, inputTables, currentTable, primaryTableIds, draftNodes, activeModel, config, conceptShelfItems, charts, generatedReports, focusedReference, loadedTableNodes, fileNodes, dispatch, t, attachedImages, attachedFiles, attachmentUploads, canvasTarget, textTurns, connectorParams, threadGraph]);

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
    }, [agentHandoffRequest]);

    // ── Unified submit handler ───────────────────────────────────────
    const submitChat = useCallback((prompt: string, displayPrompt?: string, explicitAttachments?: Parameters<typeof exploreFromChat>[3]) => {
        // A prompt submitted while a text turn is focused always continues
        // from that turn. An open turn consumes it as its answer; a completed
        // turn keeps its existing answer and shows the follow-up as a new
        // prompt beneath that response.
        const focusedTurn = focusedId?.type === 'text'
            ? textTurns.find(tt => tt.id === focusedId.textId)
            : undefined;
        if (focusedId?.type === 'reference' && !focusedReference) return;
        // The item a follow-up continues from (design-docs/58, rule 3). Every item, a
        // derived table or an app, file, report or reference on the canvas, continues
        // its open conversation the same way; with none, exploreFromChat starts from the item.
        const focusedItemId = (() => {
            if (focusedId?.type === 'reference') return threadGraph.continuationOf(focusedReference!.id);
            if (focusedId?.type === 'file') {
                const file = fileNodes.find(node => node.path === focusedId.fileName);
                return file ? threadGraph.continuationOf(file.id) : undefined;
            }
            if (focusedId?.type === 'report') {
                const report = generatedReports.find(item => item.id === focusedId.reportId);
                if (report?.parentNodeId) return threadGraph.continuationOf(report.id);
            }
            return focusedTableId;
        })();
        const conversationParentId = resolveConversationParentNodeId(
            focusedTurn?.id,
            focusedItemId,
            threadGraph,
            turnId => !textTurns.some(turn => turn.id === turnId && (turn.workflow || turn.workflowMessage)),
        );
        if (focusedTurn) {
            // A workflow run's record is the open end of its chain; a follow-up continues from it.
            if (focusedTurn.workflow) {
                exploreFromChat(prompt, { parentNodeId: focusedTurn.id }, displayPrompt, explicitAttachments);
                focusCanvasAfterReply();
                return;
            }
            // The reply follows the focused message; replying again branches (design-docs/58, rule 10).
            if (!focusedTurn.answered) dispatch(dfActions.updateTextTurn({ id: focusedTurn.id, answered: true }));
            exploreFromChat(prompt, { parentNodeId: focusedTurn.id }, displayPrompt, explicitAttachments);
            focusCanvasAfterReply();
            return;
        }
        if (conversationParentId) {
            const conversationParent = textTurns.find(turn => turn.id === conversationParentId);
            if (conversationParent && !conversationParent.answered) {
                dispatch(dfActions.updateTextTurn({ id: conversationParent.id, answered: true }));
            }
            exploreFromChat(prompt, { parentNodeId: conversationParentId }, displayPrompt, explicitAttachments);
            return;
        }
        exploreFromChat(prompt, undefined, displayPrompt, explicitAttachments);
    }, [exploreFromChat, focusedId, focusedTableId, tables, textTurns, focusedReference, fileNodes, generatedReports, dispatch, focusCanvasAfterReply, threadGraph]);

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

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent).detail as typeof viewingToolActivity;
            if (detail?.nodeId && detail.execution?.id) {
                setViewingToolActivity(detail);
            }
        };
        window.addEventListener('df-view-tool-activity', handler);
        return () => window.removeEventListener('df-view-tool-activity', handler);
    }, []);

    useEffect(() => {
        setViewingToolActivity(null);
    }, [focusedId]);

    useEffect(() => {
        if (!viewingToolActivity) window.dispatchEvent(new Event('df-tool-activity-closed'));
    }, [viewingToolActivity]);

    useEffect(() => {
        if (viewingToolActivity && !textTurns.some(turn => turn.id === viewingToolActivity.nodeId)
            && !tables.some(table => table.id === viewingToolActivity.nodeId)) setViewingToolActivity(null);
    }, [viewingToolActivity, textTurns, tables]);

    // Send is allowed only when the user has typed actual instructions.
    // Selections live in the ClarificationPanel UI only — they never
    // appear in the chat box. So having only selections (no typed text)
    // means there's nothing to send beyond clicks; the user must either
    // click the remaining options (which auto-submits) or type something.
    const canSend = React.useMemo(() => {
        if (workspaceReadOnly || attachmentUploads > 0) return false;
        return chatPrompt.trim().length > 0 || attachedImages.length > 0 || attachedFiles.length > 0;
    }, [chatPrompt, workspaceReadOnly, attachmentUploads, attachedImages.length, attachedFiles.length]);

    // A prompt seeded from the landing box: send it once the chat is idle.
    // The ref makes this one-shot even if the effect is double-invoked before
    // the store update lands (StrictMode).
    const seededPromptRef = useRef<typeof analystChatPending>(null);
    React.useLayoutEffect(() => {
        if (!analystChatPending) {
            seededPromptRef.current = null;
            return;
        }
        if (!analystChatPending || isChatFormulating || attachmentUploads > 0) return;
        const { text, images, attachments } = analystChatPending;
        if (seededPromptRef.current === analystChatPending) return;
        seededPromptRef.current = analystChatPending;
        dispatch(dfActions.clearAnalystChatPending());
        if (text.trim().length > 0 || images.length > 0 || attachments.length > 0) {
            if (analystChatPending.intent === 'workflow-authoring') {
                exploreFromChat(text, { authorWorkflow: true }, undefined, { images,
                    files: attachments.map(name => ({ name, scratchPath: `scratch/${name}` })) });
                return;
            }
            submitChat(text, undefined, {
                images,
                files: attachments.map(name => ({ name, scratchPath: `scratch/${name}` })),
            });
        }
    }, [analystChatPending, isChatFormulating, attachmentUploads, submitChat, exploreFromChat, dispatch]);

    const cancelAgent = useCallback(() => {
        if (agentAbortRef.current) {
            agentAbortRef.current.abort();
            agentAbortRef.current = null;
        }
        // Always clear busy state — the async finally blocks also clear this,
        // but a direct cancel should guarantee the UI unblocks immediately.
        setIsChatFormulating(false);
    }, []);

    // A text panel can open over a file the canvas is already showing (an app or
    // document the turn follows); closing the panel should leave that file in focus.
    const keepCanvasFile = useCallback(() => {
        if (canvasTarget?.type !== 'file') return false;
        dispatch(dfActions.setFocused({ type: 'file', fileName: canvasTarget.fileName }));
        return true;
    }, [canvasTarget, dispatch]);

    // ── Focused text turn (design-docs/41) ──────────────────────────────────
    // A clarify / explain / delegate node the user has focused (by clicking its
    // thread card). It drives the overlay panel above the chat.
    const focusedTextTurn = focusedId?.type === 'text'
        ? textTurns.find(tt => tt.id === focusedId.textId)
        : undefined;
    const selectedExecution = viewingToolActivity ? ('code' in viewingToolActivity.execution
        ? textTurns.find(turn => turn.id === viewingToolActivity.nodeId)?.codeExecutions || []
        : textTurns.find(turn => turn.id === viewingToolActivity.nodeId)?.executions || [])
        .find(execution => execution.id === viewingToolActivity.execution.id) || viewingToolActivity.execution : undefined;
    const focusedTextTurnContent = focusedTextTurn
        ? explanationContent(focusedTextTurn.content)
        : '';
    const focusedTextTurnUsesCanvas = !!focusedTextTurn && (focusedTextTurn.textKind === 'explain' || focusedTextTurn.answered)
        && !focusedTextTurn.form && !focusedTextTurn.dataOperation
        && canvasTarget?.type === 'text' && canvasTarget.textId === focusedTextTurn.id;
    const focusedDraft = focusedId?.type === 'draft'
        ? draftNodes.find(draft => draft.id === focusedId.draftId
            && (draft.derive?.status === 'error' || draft.derive?.status === 'interrupted'))
        : undefined;
    // A run's later steps follow its own outputs, so the request that started it
    // is the nearest user message before the draft.
    const runPromptOf = (draft: DraftNode): string => {
        for (const nodeId of threadGraph.ancestors(draft.id)) {
            const prompt = textTurns.find(item => item.id === nodeId)?.prompt;
            if (prompt) return prompt;
        }
        return '';
    };
    const focusedDraftPrompt = focusedDraft ? runPromptOf(focusedDraft) : '';
    const focusedDraftError = focusedDraft
        ? [...(focusedDraft.derive.trigger.interaction || [])].reverse().find(entry => entry.role === 'error')?.content
            || (focusedDraft.derive.status === 'interrupted'
                ? 'Interrupted by page refresh. You can retry or delete this step.'
                : 'This analysis run failed.')
        : '';

    // Reset accumulated answers when the focused clarify turn changes.
    useEffect(() => {
        if (focusedTextTurn) { setClarifyAnswers({}); textTurnSubmittedRef.current = null; }
    }, [focusedTextTurn?.id]);

    // Close a focused turn without deleting it: return to its source chart or
    // nearest parent artifact. Root-level turns explicitly clear focus so the
    // canvas returns to its empty state.
    const closeTextTurn = useCallback(() => {
        if (!focusedTextTurn) return;
        if (keepCanvasFile()) return;
        if (focusedTextTurn.sourceChartId && charts.some(chart => chart.id === focusedTextTurn.sourceChartId)) {
            dispatch(dfActions.setFocused({ type: 'chart', chartId: focusedTextTurn.sourceChartId }));
            return;
        }
        const parentTableId = threadGraph.tableOf(focusedTextTurn.parentNodeId);
        if (parentTableId) {
            const tableCharts = charts.filter(chart => chart.tableRef === parentTableId);
            const nearestChart = tableCharts[tableCharts.length - 1];
            dispatch(dfActions.setFocused(nearestChart
                ? { type: 'chart', chartId: nearestChart.id }
                : { type: 'table', tableId: parentTableId }));
            return;
        }
        dispatch(dfActions.setFocused(undefined));
    }, [charts, dispatch, focusedTextTurn, keepCanvasFile, tables, textTurns, threadGraph]);

    const closeFocusedDraft = useCallback(() => {
        if (!focusedDraft) return;
        const parentTurn = textTurns.find(turn => turn.id === focusedDraft.parentNodeId);
        if (parentTurn) {
            dispatch(dfActions.setFocused({ type: 'text', textId: parentTurn.id }));
            return;
        }
        const parentTableId = threadGraph.tableOf(focusedDraft.parentNodeId);
        if (parentTableId) {
            const tableCharts = charts.filter(chart => chart.tableRef === parentTableId);
            const nearestChart = tableCharts[tableCharts.length - 1];
            dispatch(dfActions.setFocused(nearestChart
                ? { type: 'chart', chartId: nearestChart.id }
                : { type: 'table', tableId: parentTableId }));
            return;
        }
        dispatch(dfActions.setFocused(undefined));
    }, [charts, dispatch, focusedDraft, tables, textTurns, threadGraph]);

    // Answer a focused clarify turn. Resumes the run iff the turn carries the
    // backend's opaque resume token (§12); otherwise a fresh turn. The turn stays
    // in the thread as the record and the run starts (overlay hides).
    const submitTextTurnAnswer = useCallback((responses: ClarificationResponse[]) => {
        const turn = focusedTextTurn;
        if (!turn) return;
        const displayPrompt = formatClarificationResponses(responses);
        // Lock this clarify: it's answered once, then read-only. A later response
        // is a NEW conversation, not a re-answer (design-docs/41).
        dispatch(dfActions.updateTextTurn({ id: turn.id, answered: true }));
        // Continue the conversation from THIS turn (design-docs/42): the run's
        // chain starts here, so the produced table threads under it. Include the
        // resume trajectory iff the backend stamped one.
        const ctx = {
            parentNodeId: turn.id,
            ...(turn.resume
                ? {
                    trajectory: turn.resume.trajectory,
                    completedStepCount: turn.resume.completedStepCount,
                    actionId: turn.actionId || '',
                    lastCreatedTableId: null,
                    ...(turn.resume.operationId && responses[0]?.value
                        ? { interactionResponse: responses[0].value === 'elaborate'
                            ? { operation_id: turn.resume.operationId, action: 'elaborate' as const }
                            : { operation_id: turn.resume.operationId, plan_id: responses[0].value } }
                        : {}),
                }
                : {}),
        };
        exploreFromChat(displayPrompt, ctx);
        focusCanvasAfterReply();
    }, [exploreFromChat, focusedTextTurn, dispatch, focusCanvasAfterReply]);

    // Record a clicked option / typed answer inside a FOCUSED clarify turn's
    // panel (design-docs/41). Auto-submits when every question is answered by
    // a clicked option.
    const handleSelectTextTurnAnswer = useCallback((questionIndex: number, response: ClarificationResponse, autoSubmit: boolean = true) => {
        const turn = focusedTextTurn;
        const questions = turn?.options;
        if (!turn || !questions) return;
        if (textTurnSubmittedRef.current === turn.id) return;
        const newAnswers = { ...clarifyAnswers, [questionIndex]: response };
        setClarifyAnswers(newAnswers);
        if (questionIndex === 0 && turn.dataOperation?.plans.some(plan => plan.id === response.value)) {
            dispatch(dfActions.updateTextTurn({
                id: turn.id,
                dataOperation: { ...turn.dataOperation, selectedPlanId: response.value },
            }));
        }
        const allAnswered = questions.every((_q, idx) => !!newAnswers[idx]);
        const allOptions = questions.every((_q, idx) => newAnswers[idx]?.source === 'option');
        if (allAnswered && allOptions && autoSubmit) {
            textTurnSubmittedRef.current = turn.id;
            const responses: ClarificationResponse[] = questions.map((_q, idx) => newAnswers[idx]);
            submitTextTurnAnswer(responses);
        }
    }, [focusedTextTurn, clarifyAnswers, submitTextTurnAnswer, dispatch]);

    // Clear a question's recorded answer (the user started editing its field).
    const handleClearTextTurnAnswer = useCallback((questionIndex: number) => {
        setClarifyAnswers(prev => {
            if (!(questionIndex in prev)) return prev;
            const next = { ...prev };
            delete next[questionIndex];
            return next;
        });
        if (questionIndex === 0 && focusedTextTurn?.dataOperation) {
            dispatch(dfActions.updateTextTurn({
                id: focusedTextTurn.id,
                dataOperation: { ...focusedTextTurn.dataOperation, selectedPlanId: undefined },
            }));
        }
    }, [focusedTextTurn, dispatch]);

    const inputBox = (
        <>
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
            borderColor: chatInputFocused ? theme.palette.primary.main : borderColor.divider,
            backgroundColor: theme.palette.background.paper,
            // Neutral elevation shadow recipe shared with AgentChatInput;
            // hover lifts the card a touch without shifting any colors.
            boxShadow: chatInputFocused
                ? `0 0 0 2px ${alpha(theme.palette.primary.main, 0.15)}, 0 2px 10px rgba(32, 33, 36, 0.14)`
                : '0 1px 6px rgba(32, 33, 36, 0.10), 0 1px 2px rgba(32, 33, 36, 0.06)',
            '&:hover': {
                boxShadow: chatInputFocused
                    ? `0 0 0 2px ${alpha(theme.palette.primary.main, 0.15)}, 0 2px 10px rgba(32, 33, 36, 0.14)`
                    : '0 2px 10px rgba(32, 33, 36, 0.14), 0 1px 3px rgba(32, 33, 36, 0.08)',
            },
        }}
        >
            {viewingToolActivity && selectedExecution && <ToolActivityPanel key={`${viewingToolActivity.nodeId}-${selectedExecution.id}`}
                execution={selectedExecution}
                onClose={() => setViewingToolActivity(null)} />}
            {!viewingToolActivity && chatWorkflow && (chatWorkflow.workflow?.status === 'running' || focusedId !== submittedPanelFocus) && <WorkflowProgress key={chatWorkflow.id} turn={chatWorkflow} interactionOnly
                onCloseInteraction={() => setSubmittedPanelFocus(focusedId)} />}
            {/* Focused text turn (design-docs/41): a clarify / explain node the
                user focused by clicking its thread card. An OPEN clarify gets
                the interactive panel; an ANSWERED clarify or any explanation is
                read-only (question → answer). Gated to not overlap the legacy
                live pause. Stays visible while a run is in flight so the user
                can keep reading what they focused. */}
            {!viewingToolActivity && !chatWorkflow && focusedTextTurn && focusedId !== submittedPanelFocus && !focusedTextTurnUsesCanvas && (
                (focusedTextTurn.textKind === 'clarify' && !focusedTextTurn.answered && focusedTextTurn.options && focusedTextTurn.options.length > 0) ? (
                    // Desaturated rather than dimmed — opacity would blend it
                    // toward the background and just read as dark.
                    <Box sx={isChatFormulating ? { pointerEvents: 'none', filter: 'grayscale(1)' } : undefined}>
                        <ClarificationPanel
                            questions={focusedTextTurn.options}
                            dataOperation={focusedTextTurn.dataOperation}
                            variant="clarify"
                            selectedAnswers={clarifyAnswers}
                            onSelectAnswer={handleSelectTextTurnAnswer}
                            onClearAnswer={handleClearTextTurnAnswer}
                            onSubmit={submitTextTurnAnswer}
                            onClose={() => closeTextTurn()}
                            onDelete={() => dispatch(dfActions.removeTextTurn(focusedTextTurn.id))}
                        />
                    </Box>
                ) : (
                    <ExplanationPanel
                        key={focusedTextTurn.id}
                        content={focusedTextTurnContent}
                        onClose={() => closeTextTurn()}
                        onDelete={() => dispatch(dfActions.removeTextTurn(focusedTextTurn.id))}
                    />
                )
            )}
            {!viewingToolActivity && focusedDraft && (
                <FailedDraftPanel
                    prompt={focusedDraftPrompt}
                    error={focusedDraftError}
                    retryDisabled={isChatFormulating || !focusedDraftPrompt}
                    onClose={closeFocusedDraft}
                    onRetry={() => exploreFromChat(focusedDraftPrompt, {
                        parentNodeId: focusedDraft.parentNodeId,
                        sourceTableIds: focusedDraft.derive.source,
                    })}
                />
            )}
            {/* Input area wrapper */}
            <Box sx={{ position: 'relative' }}>
            {/* @-mention table chips and image attachments.
                Skip the table-chip row entirely when there's only one root table —
                there's nothing else the user could @-mention, so the chip is noise. */}
            {((primaryTableIds.length > 0 && inputTables.length > 1) || attachedImages.length > 0 || attachedFiles.length > 0) && !isChatFormulating && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px', px: 0.5, pb: '2px' }}>
                    {inputTables.length > 1 && primaryTableIds.map(id => {
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
                                    fontSize: textVar.xxs,
                                    color: theme.palette.text.secondary,
                                    backgroundColor: 'rgba(0,0,0,0.04)',
                                    border: 'none',
                                    borderRadius: '4px',
                                    '& .MuiChip-label': { px: '6px' },
                                    '& .MuiChip-deleteIcon': { fontSize: iconVar.xs, color: theme.palette.text.disabled, mr: '2px' },
                                }}
                            />
                        );
                    })}
                    {attachedImages.map((_, idx) => (
                        <Chip
                            key={`img-${idx}`}
                            size="small"
                            icon={<Box component="img" src={attachedImages[idx].url} sx={{ width: 14, height: 14, objectFit: 'cover', borderRadius: '2px' }} />}
                            label={`image${attachedImages.length > 1 ? idx + 1 : ''}`}
                            onDelete={() => setAttachedImages(prev => prev.filter((_, i) => i !== idx))}
                            sx={{
                                height: 20,
                                fontSize: textVar.xxs,
                                color: theme.palette.text.secondary,
                                backgroundColor: 'rgba(0,0,0,0.04)',
                                border: 'none',
                                borderRadius: '4px',
                                '& .MuiChip-label': { px: '4px' },
                                '& .MuiChip-icon': { ml: '4px', mr: '-2px' },
                                '& .MuiChip-deleteIcon': { fontSize: iconVar.xs, color: theme.palette.text.disabled, mr: '2px' },
                            }}
                        />
                    ))}
                    {attachedFiles.map((file, idx) => (
                        <Chip
                            key={`file-${idx}`}
                            size="small"
                            icon={<InsertDriveFileOutlinedIcon sx={{ fontSize: iconVar.sm }} />}
                            label={file.name}
                            onDelete={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
                            sx={{
                                height: 20,
                                fontSize: textVar.xxs,
                                maxWidth: 160,
                                color: theme.palette.text.secondary,
                                backgroundColor: 'rgba(0,0,0,0.04)',
                                border: 'none',
                                borderRadius: '4px',
                                '& .MuiChip-label': { px: '4px', overflow: 'hidden', textOverflow: 'ellipsis' },
                                '& .MuiChip-icon': { ml: '4px', mr: '-2px' },
                                '& .MuiChip-deleteIcon': { fontSize: iconVar.xs, color: theme.palette.text.disabled, mr: '2px' },
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
                                sx={{ fontSize: textVar.xs, py: 0.5 }}
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
                    "& .MuiInput-input": { fontSize: textVar.sm, lineHeight: 1.5 },
                    "& .MuiInput-underline:before": { borderBottom: 'none !important' },
                    "& .MuiInput-underline:hover:not(.Mui-disabled):before": { borderBottom: 'none !important' },
                    "& .MuiInput-underline:after": { borderBottom: 'none !important' },
                    "& .MuiInputBase-root": { borderBottom: 'none !important' },
                    ...(isChatFormulating ? {
                        "& .MuiInput-input": { fontSize: textVar.sm, lineHeight: 1.5, color: 'text.disabled' },
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
                        setChatPrompt(t(inputTables.length === 0 && !hasFocusedExternalReference
                            ? 'chartRec.emptyAnalysisInputsPrompt'
                            : 'chartRec.threadExplorePrompt'));
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (canSend && !isChatFormulating) {
                            submitChat(chatPrompt);
                        }
                    }
                }}
                onPaste={handlePaste}
                onFocus={() => {
                    setChatInputFocused(true);
                    // Notify the parent (DataThread) that the chat input was
                    // focused.  The parent's scroll-to-target effect handles
                    // the actual scroll based on focusedId / clarify state.
                    onInputFocus?.();
                }}
                onBlur={() => setChatInputFocused(false)}
                slotProps={{ 
                    inputLabel: { shrink: true },
                    input: { readOnly: isChatFormulating },
                }}
                inputRef={chatInputRef}
                value={chatPrompt}
                disabled={workspaceReadOnly}
                placeholder={
                    inputTables.length === 0 && !hasFocusedExternalReference
                            ? t('chartRec.emptyAnalysisInputsPlaceholder')
                            : t(hasFocusedExternalReference || inputTables.length === 1 ? 'chartRec.explorePlaceholderSingleTable' : 'chartRec.explorePlaceholder')
                }
                fullWidth
                multiline
                minRows={2}
                maxRows={6}
            />
            <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
                {/* Action buttons */}
                <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', minWidth: 0, flex: 1 }}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => { handleAttachFiles(e.target.files); if (e.target) e.target.value = ''; }}
                    />
                    <Tooltip title="Attach file">
                        <span>
                            <IconButton size="small" aria-label="Attach file"
                                disabled={workspaceReadOnly || isChatFormulating || attachmentUploads > 0}
                                onClick={() => fileInputRef.current?.click()}>
                                {attachmentUploads > 0 ? <CircularProgress size={16} /> : <AttachFileIcon sx={{ fontSize: iconVar.lg }} />}
                            </IconButton>
                        </span>
                    </Tooltip>
                    <TerminalAccessButton />
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                {isChatFormulating ? (
                    <CircularProgress size={18} sx={{ m: 0.5 }} />
                ) : (
                    <>
                        <Tooltip title={t('chartRec.quickActions')}>
                            <span>
                                <IconButton
                                    size="small"
                                    sx={{ p: 0.5, color: theme.palette.text.secondary }}
                                    aria-label={t('chartRec.quickActions')}
                                    aria-haspopup="menu"
                                    aria-expanded={!!quickActionAnchor}
                                    disabled={workspaceReadOnly || isChatFormulating || attachmentUploads > 0}
                                    onClick={event => setQuickActionAnchor(event.currentTarget)}
                                >
                                    <EditOutlinedIcon sx={{ fontSize: iconVar.lg }} />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Menu anchorEl={quickActionAnchor} open={!!quickActionAnchor} onClose={() => setQuickActionAnchor(null)}
                            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                            transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                            sx={{ '& .MuiMenu-paper': { mt: -0.5 }, '& .MuiMenuItem-root': { fontSize: textVar.sm } }}>
                            <MenuItem onClick={() => {
                                setQuickActionAnchor(null);
                                submitChat(t('chartRec.reportConversationPrompt'));
                            }}>
                                <EditOutlinedIcon fontSize="small" sx={{ mr: 1 }} />{t('chartRec.writeReport')}
                            </MenuItem>
                            <MenuItem onClick={() => {
                                setQuickActionAnchor(null);
                                submitChat(t('chartRec.appConversationPrompt'));
                            }}>
                                <DashboardOutlinedIcon fontSize="small" sx={{ mr: 1 }} />{t('chartRec.createApp')}
                            </MenuItem>
                            <MenuItem onClick={() => {
                                setQuickActionAnchor(null);
                                exploreFromChat(WORKFLOW_AUTHORING_PROMPT, { authorWorkflow: true });
                            }}>
                                <AccountTreeOutlinedIcon fontSize="small" sx={{ mr: 1 }} />{t('chartRec.createWorkflow')}
                            </MenuItem>
                        </Menu>
                        <Tooltip title={t('chartRec.getIdeaSuggestions')}>
                            <span>
                                <IconButton
                                    size="small"
                                    sx={{ p: 0.5, color: theme.palette.primary.main }}
                                    aria-label={t('chartRec.getIdeaSuggestions')}
                                    disabled={workspaceReadOnly || (!focusedTableId && !hasFocusedExternalReference) || isChatFormulating}
                                    onClick={() => submitChat(t('chartRec.exploreIdeasPrompt'), t('chartRec.askedForRecommendations'))}
                                >
                                    <TipsAndUpdatesIcon sx={{ fontSize: iconVar.lg }} />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('chartRec.explore')}>
                            <span>
                                <IconButton
                                    size="small"
                                    aria-label={t('chartRec.explore')}
                                    disabled={!canSend}
                                    onClick={() => {
                                        submitChat(chatPrompt);
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
                                    <ArrowUpwardRoundedIcon sx={{ fontSize: iconVar.lg }} />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </>
                )}
                </Box>
            </Box>
            {/* Scoped to the input area, not the whole card, so a focused
                explanation / clarification panel above stays readable. Bleeds
                past the card's padding so the veil and its progress bar still
                meet the card edge — the card clips it to the rounded corner. */}
            {isChatFormulating && (
                <AgentWorkingOverlay 
                    message={draftNodes.find(d => d.derive?.status === 'running' && draftBelongsToFocusedThread(d))
                            ?.derive?.runningPlan}
                    theme={theme}
                    color={'primary'}
                    onCancel={cancelAgent}
                    sx={{
                        left: -10, right: -10, bottom: -4, borderRadius: 0,
                        // With nothing above it, cover the card's top padding too
                        // so the veil fills the card exactly as it used to.
                        ...((focusedTextTurn || focusedDraft || viewingToolActivity)
                            ? {}
                            : { top: -8 }),
                    }}
                />
            )}
            </Box>
        </Card>
        </>
    );

    // ── Getting-started guidance ─────────────────────────────────────
    // When a root table is focused, show a muted row of AI-generated starter
    // questions tailored to that table (see the trigger effect above — each
    // table has its own set, plus an optional cross-table question). Clicking
    // a chip runs it; clicking the lightning bolt collapses/expands the row.
    const focusedStarterEntry = focusedRootTableId ? starterQuestions[focusedRootTableId] : undefined;
    const focusedStarterStatus = focusedRootTableId ? starterQuestionsStatus[focusedRootTableId] : undefined;
    const focusedStarterFresh = !!focusedStarterEntry && focusedStarterEntry.signature === rootTableSignature;
    const starterLoading = !!focusedRootTableId && (!focusedStarterFresh || focusedStarterStatus === 'loading');

    const showGettingStarted = !!focusedRootTableId
        && !workspaceReadOnly
        && !chatWorkflow
        && !isChatFormulating
        && !focusedTextTurn
        && !focusedDraft
        && (starterLoading || (focusedStarterEntry?.questions?.length ?? 0) > 0);

    const starterChipSx = {
        height: 24, borderRadius: '6px', fontSize: textVar.xs,
        color: 'text.secondary',
        backgroundColor: 'transparent',
        border: `1px solid ${borderColor.divider}`,
        // Cap a single chip to one column width minus the toggle icon, and
        // allow it to shrink (flex) when the row would otherwise overflow.
        maxWidth: CARD_WIDTH - STARTER_ICON_WIDTH,
        minWidth: 0,
        flexShrink: 1,
        '& .MuiChip-label': {
            px: '8px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
        },
        '&:hover': {
            backgroundColor: alpha(theme.palette.text.primary, 0.04),
            color: 'text.primary',
            borderColor: alpha(theme.palette.text.primary, 0.24),
        },
    } as const;

    const gettingStartedBlock = showGettingStarted ? (
        <Box sx={{ mx: 1, mb: 0.75, px: 0.5, display: 'flex', alignItems: 'center', gap: 0.25, overflow: 'hidden' }}>
            <Tooltip title={t(starterCollapsed ? 'chartRec.expandStarters' : 'chartRec.collapseStarters', { defaultValue: starterCollapsed ? 'Show suggestions' : 'Hide suggestions' })}>
                <IconButton
                    size="small"
                    onClick={() => setStarterCollapsed(c => !c)}
                    sx={{
                        flexShrink: 0,
                        p: 0.5, borderRadius: '6px', color: 'text.disabled',
                        transition: 'background-color 0.15s, color 0.15s',
                        '&:hover': { color: 'text.secondary', backgroundColor: alpha(theme.palette.text.primary, 0.06) },
                    }}
                >
                    <BoltIcon sx={{ fontSize: iconVar.md }} />
                </IconButton>
            </Tooltip>
            {starterCollapsed && (
                <Typography
                    onClick={() => setStarterCollapsed(false)}
                    sx={{ fontSize: textVar.xs, color: 'text.disabled', cursor: 'pointer', '&:hover': { color: 'text.secondary' } }}
                >
                    {t('chartRec.expandStarters', { defaultValue: 'Show suggestions' })}
                </Typography>
            )}
            <Collapse
                orientation="horizontal"
                in={!starterCollapsed}
                timeout={200}
                sx={{
                    minWidth: 0,
                    flexShrink: 1,
                    '& .MuiCollapse-wrapperInner': { display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'nowrap', minWidth: 0 },
                }}
            >
                {starterLoading
                    ? <CircularProgress size={13} thickness={5} sx={{ color: 'text.disabled', mx: 0.5 }} />
                    : (focusedStarterEntry?.questions ?? []).map((q, i) => (
                        <StarterChip
                            key={i}
                            label={q}
                            onClick={() => submitChat(q)}
                            sx={starterChipSx}
                        />
                    ))
                }
            </Collapse>
        </Box>
    ) : null;

    return (
        <ClickAwayListener
            mouseEvent="onMouseDown"
            onClickAway={(e) => {
                // Click-elsewhere-to-close for a focused text turn's panel —
                // EXCEPT an active (unanswered) clarify, which must stay open
                // so the pending question isn't lost. Clicks on a thread card
                // switch focus normally, so ignore those here.
                if (!focusedTextTurn && !focusedDraft) return;
                // A form turn owns the canvas. Interacting with any field or
                // control there must keep both the form and its feedback open;
                // only either surface's explicit close button dismisses it.
                if (canvasTarget?.type === 'text'
                    && textTurns.some(turn => turn.id === canvasTarget.textId && turn.form)) return;
                // Long explanations also own the canvas. Clicking or selecting
                // their document content must not be interpreted as dismissing
                // the focused turn; the canvas close button owns that action.
                if (focusedTextTurnUsesCanvas) return;
                const isActiveClarify = focusedTextTurn?.textKind === 'clarify'
                    && !focusedTextTurn.answered
                    && (focusedTextTurn.options?.length ?? 0) > 0;
                if (isActiveClarify) return;
                const el = e.target as HTMLElement | null;
                if (el?.closest?.('[data-thread-item], .data-thread-card')) return;
                if (focusedDraft) closeFocusedDraft();
                else closeTextTurn();
            }}
        >
            {/* Shares its width with the thread block above (see tokens). */}
            <Box sx={{ width: '100%', maxWidth: conversationWidth, mx: 'auto' }}>
                {pendingTerminal && <TerminalApprovalDialog key={pendingTerminal.proposal.id}
                    proposal={pendingTerminal.proposal}
                    onDecision={decision => {
                        const pending = pendingTerminal;
                        setPendingTerminal(null);
                        dispatch(dfActions.updateTextTurn({
                            id: pending.parentNodeId,
                            executions: [{
                                id: pending.proposal.id, argv: pending.proposal.argv,
                                cwd: pending.proposal.cwd, purpose: pending.proposal.purpose,
                                dangerouslyDisableSandbox: pending.proposal.dangerouslyDisableSandbox,
                                sandboxDisablingReason: pending.proposal.sandboxDisablingReason, sandboxFilesystem: pending.proposal.sandboxFilesystem,
                                status: decision === 'approve' ? 'running' : 'rejected',
                            }],
                        }));
                        exploreFromChat(decision === 'approve' ? 'Run the approved terminal command.' : 'Do not run this terminal command.', {
                            ...pending,
                            terminalResponse: { request_id: pending.proposal.id, decision },
                        }, undefined, { images: [], files: [] });
                    }} />}
                {gettingStartedBlock}
                {/* The input box */}
                {inputBox}
            </Box>
        </ClickAwayListener>
    );
};
