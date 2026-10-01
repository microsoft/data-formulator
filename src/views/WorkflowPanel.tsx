import { ShimmerText, WorkflowGears } from '../components/FunComponents';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSelector } from 'react-redux';
import { Alert, Autocomplete, Box, Button, ButtonBase, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, MenuItem,
    IconButton, Tab, Tabs, TextField, Tooltip, Typography, useTheme } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import QuestionAnswerOutlinedIcon from '@mui/icons-material/QuestionAnswerOutlined';
import { ArtifactDeleteButton, ThreadArtifactCard } from './DataThreadCards';
import { readingTypography, sidebarPrimaryActionSx, sidebarRowActionSx, sidebarRowTitleSx, sidebarToolbarSx } from '../app/tokens';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TerminalIcon from '@mui/icons-material/Terminal';
import CodeIcon from '@mui/icons-material/Code';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';
import { getCachedChart } from '../app/chartCache';
import { ApiRequestError, apiRequest, streamRequest } from '../app/apiClient';
import { handleApiError } from '../app/errorHandler';
import { getUrls, resolveRecommendedChart } from '../app/utils';
import { DataFormulatorState, dfActions, dfSelectors, fetchFieldSemanticType, generateFreshChart } from '../app/dfSlice';
import { store } from '../app/store';
import { buildDictTableFromWorkspace } from '../app/tableThunks';
import { loadWorkspace, notifyWorkspaceFilesChanged, WorkspaceLoadSupersededError } from '../app/workspaceService';
import { createConversationRootId, createDictTable, computeInsightKey, FieldItem, TextTurn, ClarificationResponse } from '../components/ComponentType';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { textVar, iconVar } from '../app/layout';
import { ListDetailDialog } from '../components/ListDetailDialog';
import { ExecutionCodeBlock, formatTerminalCommand, TerminalApprovalDialog, TerminalProposal } from '../components/TerminalApprovalDialog';
import { ConnectorFormCard } from '../components/ConnectorFormCard';
import { parseDataOperation } from '../dataOperations/models';
import { ClarificationPanel, FailedDraftPanel } from './AgentPausePanel';
import { formatClarificationResponses, normalizeClarifyEvent } from '../app/clarification';
import ReactMarkdown from 'react-markdown';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';

interface WorkflowParameter {
    name: string; label: string; type?: 'text' | 'number' | 'boolean' | 'select'; description?: string;
    required?: boolean; default?: string | number | boolean; options?: string[]; allow_custom?: boolean;
}
interface WorkflowSetup { parameters: Record<string, string | number | boolean>; instructions: string }
interface Instance { path: string; name: string; overview?: string; error?: string; origin?: 'user' | 'demo' | 'server'; parameters?: WorkflowParameter[]; content?: string }
export interface Run {
    workflow_path?: string;
    external_references?: import('../components/ComponentType').ExternalTableReference[];
    setup?: WorkflowSetup;
    activity?: string;
    interrupted_response?: string;
    active_tool?: NonNullable<TextTurn['workflow']>['activeTool'];
    step_elapsed_seconds?: Record<string, number>;
    revision?: number;
    plan_revision?: number;
    plan_review_pending?: boolean;
    step_progress?: Record<string, { status: string; explanation: string; evidence_ids: string[]; revision?: number }>;
    plan_revisions?: { plan_revision?: number; previous_revision?: number; reason: string; previous_step_id: string; previous_step_elapsed_seconds?: Record<string, number>;
        previous_steps: NonNullable<Run['instance']>['steps']; previous_checks?: Run['checks'];
        previous_visited?: string[]; previous_progress?: Run['step_progress'] }[];
    applied_message_ids?: string[];
    id: string; status: string; step_id: string; message: string; started_at: string;
    name?: string; instance?: { name: string; overview?: string; prompt?: string; deliverables?: string[]; steps?: { id: string; description?: string; instructions: string; next?: string;
        checkers?: { id: string; condition?: string; when?: 'before' | 'during' | 'after'; on_fail?: string }[] }[] }; report?: string; calls?: number; tool_calls?: number;
    checks?: Record<string, { status: string; explanation: string; evidence_ids: string[] }>;
    evidence?: Record<string, { tool: string; text: string; call?: number; step_id?: string; plan_revision?: number; details?: Record<string, string>; input?: Record<string, unknown> }>;
    transitions?: { from: string; to: string; reason: string; plan_revision?: number }[];
    artifacts?: string[];
    terminal_request?: TerminalProposal;
    interaction?: { call_id: string; questions?: unknown[]; data_operation?: unknown; form?: {
        kind: string; title: string; connector?: { source_type: string; prefilled?: Record<string, string> };
    } };
    visited?: string[];
    outputs?: { id: string; version?: string; type: string; step_id?: string; plan_revision?: number; tool?: string; stdout?: string; content?: any; input_sources?: { id: string; kind: 'data' | 'file'; display_name?: string }[] }[];
}

async function post<T>(route: string, body: object = {}, signal?: AbortSignal): Promise<T> {
    const { data } = await apiRequest<T>(`/api/workflows/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
    });
    return data;
}

function workflowOutputIds(run: Run): string[] {
    return [...new Set((run.outputs || []).flatMap(output => {
        if (output.type === 'report') return [`workflow-report-${run.id}`];
        if (output.type === 'result') return [output.content.result.content.virtual.table_name as string];
        if (output.type !== 'tool_result') return [];
        const metadata = JSON.parse(output.stdout || '{}');
        if (['create_data', 'update_data'].includes(output.tool || '') && metadata.table_name) return [`workflow-data-${run.id}-${metadata.table_name}`];
        if (['create_file', 'edit_file'].includes(output.tool || '') && metadata.available_in_workspace && metadata.path?.startsWith('files/')) {
            return [`file-${metadata.path.slice('files/'.length)}`];
        }
        return [];
    }))];
}

const deletedWorkflowRuns = new Set<string>();

function workflowArtifacts(run: Run): NonNullable<NonNullable<TextTurn['workflow']>['artifacts']> {
    return (run.outputs || []).flatMap(output => {
        const evidence = run.evidence?.[output.id] || (output.type === 'report'
            ? Object.values(run.evidence || {}).filter(entry => entry.tool === 'write_report').at(-1) : undefined);
        return workflowOutputIds({ ...run, outputs: [output] }).map(nodeId => ({ nodeId,
            chartId: output.type === 'result' ? output.content.result.chart_id as string : undefined,
            stepId: output.step_id || evidence?.step_id,
            planRevision: output.plan_revision ?? evidence?.plan_revision ?? 0,
        }));
    }).filter((artifact, index, all) => all.findLastIndex(item => item.nodeId === artifact.nodeId) === index);
}

const WorkflowArtifacts: React.FC<{ artifacts: NonNullable<NonNullable<TextTurn['workflow']>['artifacts']> }> = ({ artifacts }) => {
    const state = useSyncExternalStore(store.subscribe, store.getState);
    const items = artifacts.flatMap(artifact => {
        const chart = artifact.chartId ? dfSelectors.getAllCharts(state).find(item => item.id === artifact.chartId) : undefined;
        const loaded = state.loadedTableNodes.find(item => item.id === artifact.nodeId);
        const table = dfSelectors.getAllTables(state).find(item => item.id === (loaded?.tableId || artifact.nodeId));
        const file = state.fileNodes.find(item => item.id === artifact.nodeId);
        const report = state.generatedReports.find(item => item.id === artifact.nodeId);
        if (!chart && !table && !file && !report) return [];
        const title = chart?.title || table?.displayId || table?.id || file?.displayName || report?.title || artifact.nodeId;
        const cached = chart ? getCachedChart(chart.id) : undefined;
        const image = chart ? cached?.fullPngDataUrl || dfSelectors.getChartThumbnail(chart.id)(state) || cached?.thumbnailDataUrl : undefined;
        const Icon = chart ? BarChartOutlinedIcon : table ? TableChartOutlinedIcon : file ? InsertDriveFileOutlinedIcon : ArticleOutlinedIcon;
        const open = () => {
            if (chart) store.dispatch(dfActions.setFocused({ type: 'chart', chartId: chart.id }));
            else if (loaded || file) store.dispatch(dfActions.setFocused({ type: 'reference', referenceId: artifact.nodeId }));
            else if (table) store.dispatch(dfActions.setFocused({ type: 'table', tableId: table.id }));
            else if (report) store.dispatch(dfActions.setFocused({ type: 'report', reportId: report.id }));
        };
        const detail = table && !chart ? `${(table.virtual?.rowCount ?? table.rows.length).toLocaleString()} rows · ${table.names.length} columns`
            : report?.status === 'generating' ? 'Composing...' : undefined;
        return [{ artifact, chart, title, image, Icon, open, detail }];
    });
    const cardSx = { textAlign: 'left', minWidth: 0, boxSizing: 'border-box', border: 1, borderColor: 'divider', borderRadius: 1,
        bgcolor: 'background.paper', '&:hover': { bgcolor: 'action.hover' },
        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } } as const;
    const others = items.filter(item => !item.chart);
    const charts = items.filter(item => item.chart);
    const gridSx = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 1 } as const;
    // Tables, files and reports read as compact rows; charts share one card size below them, in the same columns.
    return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, my: 0.25 }}>
        {others.length > 0 && <Box sx={gridSx}>
            {others.map(({ artifact, title, Icon, open, detail }) => <ButtonBase key={artifact.nodeId} aria-label={`Open ${title}`}
                data-workflow-artifact={artifact.nodeId} onClick={open}
                sx={{ ...cardSx, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 0.75, px: 1, py: 0.75 }}>
                <Icon sx={{ fontSize: 16, flexShrink: 0, mt: '2px', color: 'text.secondary' }} />
                <Box component="span" sx={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <Box component="span" title={title} sx={{ fontSize: textVar.sm,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</Box>
                    {detail && <Typography component="span" sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>{detail}</Typography>}
                </Box>
            </ButtonBase>)}
        </Box>}
        {charts.length > 0 && <Box sx={gridSx}>
            {charts.map(({ artifact, title, image, Icon, open }) => <ButtonBase key={artifact.nodeId} aria-label={`Open ${title}`}
                data-workflow-artifact={artifact.nodeId} onClick={open}
                sx={{ ...cardSx, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.75, p: 1 }}>
                <Box sx={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {image ? <Box component="img" src={image} alt={title} sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                        : <Icon sx={{ fontSize: 32, color: 'text.disabled' }} />}
                </Box>
                <Box component="span" sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, minWidth: 0, fontSize: textVar.sm }}>
                    <Icon sx={{ fontSize: 16, flexShrink: 0, mt: '2px', color: 'text.secondary' }} />
                    <Box component="span" title={title} sx={{ minWidth: 0, overflowWrap: 'anywhere', display: '-webkit-box',
                        WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}>{title}</Box>
                </Box>
            </ButtonBase>)}
        </Box>}
    </Box>;
};

function workflowSteps(run: Pick<Run, 'instance' | 'checks' | 'step_progress' | 'step_id' | 'status' | 'visited' | 'plan_review_pending' | 'revision' | 'step_elapsed_seconds'>): NonNullable<TextTurn['workflow']>['steps'] {
    return (run.instance?.steps || []).map(step => {
        const checks = (step.checkers || []).map(check => run.checks?.[check.id]?.status);
        const assessment = run.step_progress?.[step.id];
        const status = run.plan_review_pending ? 'pending'
            : checks.some(check => check === 'failed' || check === 'inconclusive') ? 'failed'
            : checks.length && checks.every(check => check === 'passed')
                ? step.id === run.step_id && run.status === 'running' ? 'reviewing' : 'passed'
            : step.id === run.step_id && run.status !== 'completed' ? 'current'
            : assessment?.status === 'completed' && (run.revision === undefined || assessment.revision === run.revision) ? 'completed'
            : run.visited?.includes(step.id) ? 'visited' : 'pending';
        return { id: step.id, description: step.description, instructions: step.instructions, status, next: step.next, checkers: step.checkers || [],
            elapsedSeconds: run.step_elapsed_seconds?.[step.id],
            checkIds: (step.checkers || []).map(check => check.id), assessment };
    });
}

export function workflowTextTurn(run: Run, existing?: TextTurn): TextTurn {
    const turnId = `textTurn-workflow-${run.id}`;
    const outputVersions = { ...existing?.workflow?.outputVersions };
    const outputIds = [...new Set([...(existing?.outputIds || []), ...workflowOutputIds(run)])];
    const createdAt = Date.parse(run.started_at);
    return {
        kind: 'text', id: turnId, displayId: run.instance?.name || run.name || 'Workflow', textKind: 'explain',
        parentNodeId: createConversationRootId(run.id), createdAt, actionId: run.id,
        prompt: existing?.prompt || `Run workflow: ${run.instance?.name || run.name || run.id}`,
        outputIds: [...outputIds],
        content: run.message || `${run.instance?.name || 'Workflow'}: ${run.status}`,
        form: run.interaction?.form?.connector ? existing?.workflow?.interactionId === run.interaction.call_id && existing.form
            ? existing.form : { kind: 'connector', title: run.interaction.form.title,
                draft: { revision: 0, fields: [], changedByAgent: [], conflict: false },
                connector: { sourceType: run.interaction.form.connector.source_type,
                    prefilled: run.interaction.form.connector.prefilled, status: 'pending' } } : undefined,
        workflow: { runId: run.id, status: run.status, stepId: run.step_id, calls: run.calls || 0, outputVersions: { ...outputVersions },
            toolCalls: run.tool_calls,
            overview: run.instance?.overview ?? existing?.workflow?.overview ?? '',
            prompt: run.instance?.prompt ?? existing?.workflow?.prompt,
            deliverables: run.instance?.deliverables ?? existing?.workflow?.deliverables,
            setup: run.setup ?? existing?.workflow?.setup,
            artifacts: [...workflowArtifacts(run), ...(existing?.workflow?.artifacts || []).filter(artifact =>
                !outputIds.includes(artifact.nodeId) && store.getState().generatedReports.some(report =>
                    report.id === artifact.nodeId))],
            planRevision: run.plan_revision || 0, planReviewPending: run.plan_review_pending || false,
            activity: run.activity,
            pauseRequested: run.status === 'running' && existing?.workflow?.pauseRequested,
            interruptedResponse: run.interrupted_response,
            activeTool: run.active_tool,
            planHistory: (run.plan_revisions || []).map((previous, index) => ({ revision: previous.plan_revision ?? index,
                reason: previous.reason, steps: workflowSteps({ instance: { name: '', steps: previous.previous_steps },
                    checks: previous.previous_checks, visited: previous.previous_visited, step_progress: previous.previous_progress,
                    step_elapsed_seconds: previous.previous_step_elapsed_seconds,
                    step_id: previous.previous_step_id, status: 'archived', revision: previous.previous_revision }),
                checks: Object.entries(previous.previous_checks || {}).map(([id, check]) => ({ id, status: check.status, explanation: check.explanation })) })),
            appliedMessageIds: run.applied_message_ids || existing?.workflow?.appliedMessageIds || [],
            terminalRequest: run.terminal_request,
            dataOperation: run.interaction?.data_operation ? parseDataOperation(run.interaction.data_operation) : undefined,
            interactionId: run.interaction?.call_id,
            questions: run.status === 'paused' && run.interaction?.questions
                ? normalizeClarifyEvent({ questions: run.interaction.questions }).questions : undefined,
            checks: Object.entries(run.checks || {}).map(([id, check]) => ({ id, status: check.status, explanation: check.explanation })),
            transitions: run.transitions,
            log: Object.entries(run.evidence || {}).map(([id, evidence]) => ({ id, ...evidence })),
            steps: workflowSteps(run),
        },
    };
}

export async function publishWorkflowRun(run: Run, workspaceId: string, focus = true) {
    if (store.getState().activeWorkspace?.id !== workspaceId || deletedWorkflowRuns.has(`${workspaceId}/${run.id}`)) return;
    const turnId = `textTurn-workflow-${run.id}`;
    const existing = store.getState().textTurns.find(turn => turn.id === turnId);
    for (const message of store.getState().textTurns) {
        if (message.workflowMessage?.runId === run.id && message.workflowMessage.status === 'queued'
            && run.applied_message_ids?.includes(message.workflowMessage.messageId)) {
            store.dispatch(dfActions.updateTextTurn({ id: message.id, content: 'Received by workflow.',
                workflowMessage: { ...message.workflowMessage, status: 'received' } }));
        }
    }
    const outputVersions = { ...existing?.workflow?.outputVersions };
    const outputIds = [...new Set([...(existing?.outputIds || []), ...workflowOutputIds(run)])];
    const outputParent = (id: string) => outputIds[outputIds.indexOf(id) - 1] || turnId;
    const createdAt = Date.parse(run.started_at);
    store.dispatch(dfActions.addTextTurn(workflowTextTurn(run, existing)));
    if (!existing && focus) {
        store.dispatch(dfActions.setFocused({ type: 'text', textId: turnId }));
        store.dispatch(dfActions.setViewMode('editor'));
    }
    for (const reference of run.external_references || []) {
        store.dispatch(dfActions.upsertExternalTableReference(reference));
    }
    for (const output of run.outputs || []) {
        const version = output.version || JSON.stringify(output);
        if (outputVersions[output.id] === version) continue;
        if (output.type === 'tool_result' && ['create_data', 'update_data'].includes(output.tool || '')) {
            const metadata = JSON.parse(output.stdout || '{}');
            const { data } = await apiRequest<{ tables: any[] }>(getUrls().LIST_TABLES, { method: 'GET' });
            if (store.getState().activeWorkspace?.id !== workspaceId || deletedWorkflowRuns.has(`${workspaceId}/${run.id}`)) return;
            const workspaceTable = data.tables.find(table => table.name === metadata.table_name);
            if (!workspaceTable) throw new Error(`Published workflow data is unavailable: ${metadata.table_name}`);
            const table = buildDictTableFromWorkspace(workspaceTable, undefined);
            const existingTable = dfSelectors.getAllTables(store.getState()).find(item => item.id === table.id);
            table.displayId = existingTable?.displayId || metadata.display_name || table.displayId;
            store.dispatch(dfActions.addTableToStore(table));
            store.dispatch(fetchFieldSemanticType(table));
            store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: `workflow-data-${run.id}-${table.id}`,
                tableId: table.id, parentNodeId: store.getState().loadedTableNodes.find(node => node.id === `workflow-data-${run.id}-${table.id}`)?.parentNodeId
                    || outputParent(`workflow-data-${run.id}-${table.id}`), createdAt }));
        } else if (output.type === 'tool_result' && ['create_file', 'edit_file'].includes(output.tool || '')) {
            const metadata = JSON.parse(output.stdout || '{}');
            if (!metadata.available_in_workspace || !metadata.path?.startsWith('files/')) continue;
            const path = metadata.path.slice('files/'.length);
            store.dispatch(dfActions.upsertFileNode({ kind: 'file', id: `file-${path}`, path,
                displayName: metadata.display_name || metadata.name, contentHash: metadata.content_hash,
                parentNodeId: store.getState().fileNodes.find(node => node.id === `file-${path}`)?.parentNodeId
                    || outputParent(`file-${path}`), createdAt }));
            notifyWorkspaceFilesChanged();
        } else if (output.type === 'result') {
            const result = output.content.result;
            const goal = result.refined_goal;
            const tableId = result.content.virtual.table_name;
            const table = createDictTable(tableId, result.content.rows, undefined);
            table.displayId = goal.display_name || tableId;
            const inputSources = (output.input_sources || []).map(source => ({ id: source.id, kind: source.kind, displayName: source.display_name || source.id }));
            const sourceNames = inputSources.filter(source => source.kind === 'data').map(source => source.displayName.replace(/\.[^/.]+$/, ''));
            const sourceIds = dfSelectors.getAllTables(store.getState()).filter(item =>
                sourceNames.includes(item.virtual?.tableId || item.id.replace(/\.[^/.]+$/, ''))).map(item => item.id);
            table.parentNodeId = dfSelectors.getAllTables(store.getState()).find(item => item.id === tableId)?.parentNodeId
                || outputParent(tableId);
            table.virtual = { tableId, rowCount: result.content.virtual.row_count };
            const triggerChart = generateFreshChart(sourceIds[0] || turnId, 'Auto');
            triggerChart.source = 'trigger';
            table.derive = { code: result.code, codeSignature: result.code_signature,
                outputVariable: goal.output_variable, source: sourceIds,
                inputSources, dialog: result.dialog || [], trigger: { tableId: sourceIds[0] || turnId, resultTableId: tableId,
                    chart: triggerChart, interaction: [{ from: 'data-agent', to: 'datarec-agent',
                        role: 'instruction', content: output.content.question || goal.title, timestamp: createdAt }] } };
            const concepts: FieldItem[] = table.names.map(name => ({ id: `workflow-field-${run.id}-${output.id}-${name}`,
                name, source: 'custom', tableRef: 'custom' }));
            const chart = resolveRecommendedChart(goal, concepts, table);
            chart.id = result.chart_id;
            chart.title = goal.title;
            chart.subtitle = goal.subtitle;
            chart.titleKey = computeInsightKey(chart);
            store.dispatch(dfActions.addConceptItems(concepts));
            store.dispatch(dfActions.insertDerivedTables(table));
            store.dispatch(fetchFieldSemanticType(table));
            if (!dfSelectors.getAllCharts(store.getState()).some(item => item.id === chart.id)) store.dispatch(dfActions.addChart(chart));
            if (focus) {
                store.dispatch(dfActions.setFocused({ type: 'chart', chartId: chart.id }));
                store.dispatch(dfActions.setViewMode('editor'));
            }
        } else if (output.type === 'report') {
            const reportId = `workflow-report-${run.id}`;
            store.dispatch(dfActions.saveGeneratedReport({ id: reportId, content: output.content,
                title: run.instance?.name, parentNodeId: store.getState().generatedReports.find(report => report.id === reportId)?.parentNodeId
                    || outputParent(reportId), createdAt, status: 'completed',
                selectedChartIds: (run.outputs || []).filter(item => item.type === 'result').map(item => item.content.result.chart_id) }));
            if (focus) {
                store.dispatch(dfActions.setFocused({ type: 'report', reportId }));
                store.dispatch(dfActions.setViewMode('report'));
            }
        }
        outputVersions[output.id] = version;
        const workflow = store.getState().textTurns.find(turn => turn.id === turnId)?.workflow;
        if (workflow) store.dispatch(dfActions.updateTextTurn({ id: turnId, outputIds: [...outputIds], workflow: { ...workflow, outputVersions: { ...outputVersions } } }));
    }
    const cardId = `textTurn-workflow-card-${run.id}`;
    const card = store.getState().textTurns.find(turn => turn.id === cardId);
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: cardId, displayId: 'Workflow status', textKind: 'explain',
        workflowCardFor: turnId, content: '', createdAt: card?.createdAt || createdAt,
        parentNodeId: existing?.workflow?.status === 'completed' && card ? card.parentNodeId : outputIds.at(-1) || turnId }));
    if (run.status === 'completed') {
        const completionId = `textTurn-workflow-completed-${run.id}`;
        const completion = store.getState().textTurns.find(turn => turn.id === completionId);
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: completionId, displayId: 'Workflow completed',
            textKind: 'explain', parentNodeId: cardId, createdAt: completion?.createdAt || Date.now(),
            content: run.message || 'Workflow completed.' }));
    }
    if (focus && run.status === 'paused' && (existing?.workflow?.status !== 'paused' || existing.workflow.calls !== run.calls)) {
        store.dispatch(dfActions.setFocused({ type: 'text', textId: turnId }));
        store.dispatch(dfActions.setViewMode('editor'));
    }
}

const executions = new Map<string, AbortController>();

export function selectChatWorkflow(state: DataFormulatorState): TextTurn | undefined {
    const focus = state.focusedId;
    if (focus?.type !== 'text') return undefined;
    const focusedTurn = state.textTurns.find(turn => turn.id === focus.textId);
    const workflowTurn = focusedTurn?.workflowCardFor
        ? state.textTurns.find(turn => turn.id === focusedTurn.workflowCardFor) : focusedTurn;
    return workflowTurn?.workflow && ['running', 'paused'].includes(workflowTurn.workflow.status)
        ? workflowTurn : undefined;
}

function canAnswerWorkflowQuestion(turn: TextTurn) {
    const workflow = turn.workflow;
    return workflow?.status === 'paused' && !!workflow.interactionId && !!workflow.questions?.length
        && !workflow.terminalRequest && !workflow.dataOperation && !turn.form;
}

async function replyWorkflowQuestion(turn: TextTurn, text: string, onAccepted?: () => void) {
    if (!canAnswerWorkflowQuestion(turn) || !text.trim()) throw new Error('This workflow is not waiting for a question reply.');
    const workflow = turn.workflow!;
    const afterOutputIds = [...(turn.outputIds || [])];
    await executeWorkflow({ run_id: workflow.runId, reply: text.trim() }, () => {
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: `textTurn-workflow-reply-${workflow.runId}-${workflow.interactionId}`,
            displayId: 'Workflow reply', textKind: 'explain', prompt: text.trim(), content: 'Answered workflow question.',
            parentNodeId: turn.id, createdAt: Date.now(), workflowMessage: { runId: workflow.runId,
                messageId: workflow.interactionId!, kind: 'reply', status: 'received', afterOutputIds } }));
        onAccepted?.();
    });
}

export async function sendWorkflowMessage(turn: TextTurn, text: string, messageId: string, onAccepted?: () => void) {
    const workspaceId = store.getState().activeWorkspace?.id;
    if (!workspaceId || !turn.workflow || !text.trim()) throw new Error('Select an active workflow and enter a message.');
    const current = store.getState().textTurns.find(item => item.id === turn.id) || turn;
    if (canAnswerWorkflowQuestion(current)) return replyWorkflowQuestion(current, text, onAccepted);
    const afterOutputIds = [...(current.outputIds || [])];
    await post('message', { run_id: turn.workflow.runId, message_id: messageId, message: text.trim() });
    if (store.getState().activeWorkspace?.id !== workspaceId) return;
    const received = store.getState().textTurns.find(item => item.id === turn.id)?.workflow?.appliedMessageIds?.includes(messageId);
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: `textTurn-workflow-message-${messageId}`,
        displayId: 'Workflow message', textKind: 'explain', parentNodeId: turn.id, createdAt: Date.now(),
        prompt: text.trim(), content: received ? 'Received by workflow.' : 'Queued for workflow.',
        workflowMessage: { runId: turn.workflow.runId, messageId, kind: 'steering', afterOutputIds, status: received ? 'received' : 'queued' } }));
    store.dispatch(dfActions.setFocused({ type: 'text', textId: turn.id }));
    onAccepted?.();
}

interface WorkflowRequest {
    path?: string; content?: string; run_id?: string; reply?: string;
    setup?: WorkflowSetup;
    terminal_response?: { request_id: string; decision: 'approve' | 'reject' };
    interaction_response?: { operation_id: string; plan_id: string };
}

async function executeWorkflow(body: WorkflowRequest, onAccepted?: () => void) {
    const state = store.getState();
    const workspaceId = state.activeWorkspace?.id;
    const model = [...state.globalModels, ...state.models].find(item => item.id === state.selectedModelId);
    if (!workspaceId || !model) throw new Error('Select a session and model first.');
    if (executions.has(workspaceId)) throw new Error('A workflow is already running in this session.');
    const controller = new AbortController();
    executions.set(workspaceId, controller);
    const unsubscribe = store.subscribe(() => {
        if (store.getState().activeWorkspace?.id !== workspaceId) controller.abort();
    });
    let latest: Run | undefined;
    let streamingReportId: string | undefined;
    let reportContent = '';
    let reportTimer: ReturnType<typeof setTimeout> | undefined;
    const flushReport = () => {
        if (reportTimer) clearTimeout(reportTimer);
        reportTimer = undefined;
        const state = store.getState();
        const report = state.generatedReports.find(item => item.id === streamingReportId);
        if (state.activeWorkspace?.id === workspaceId && report?.status === 'generating' && report.content !== reportContent) {
            store.dispatch(dfActions.updateGeneratedReportContent({ id: report.id, content: reportContent }));
        }
    };
    let monitoring = true;
    let healthTimer: ReturnType<typeof setTimeout> | undefined;
    const checkExecution = async () => {
        try {
            if (latest?.status === 'running') {
                const { run } = await post<{ run: Run }>('run-state', { run_id: latest.id }, AbortSignal.timeout(10000));
                if (!monitoring || latest.status !== 'running' || store.getState().activeWorkspace?.id !== workspaceId) return;
                if (run.status !== 'running') {
                    latest = run;
                    controller.abort();
                    await publishWorkflowRun(run, workspaceId);
                    return;
                }
            }
        } catch {
            if (monitoring && latest?.status === 'running' && store.getState().activeWorkspace?.id === workspaceId) {
                latest = { ...latest, activity: 'Reconnecting to workflow...' };
                await publishWorkflowRun(latest, workspaceId);
            }
        }
        if (monitoring) healthTimer = setTimeout(checkExecution, 5000);
    };
    healthTimer = setTimeout(checkExecution, 5000);
    try {
        for await (const event of streamRequest('/api/workflows/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, model, external_references: store.getState().externalTableReferences }) }, controller.signal)) {
            if (controller.signal.aborted || store.getState().activeWorkspace?.id !== workspaceId) { controller.abort(); break; }
            const result = event as typeof event & { run?: Run; tool?: string; action?: string; channel?: string; content?: string; active_tool?: Run['active_tool'] };
            if (result.type === 'action' && result.action === 'write_report' && latest) {
                flushReport();
                streamingReportId = `workflow-report-${latest.id}`;
                reportContent = '';
                const state = store.getState();
                const previous = state.generatedReports.find(report => report.id === streamingReportId);
                const turn = state.textTurns.find(turn => turn.workflow?.runId === latest!.id);
                store.dispatch(dfActions.saveGeneratedReport({ id: streamingReportId, content: '',
                    title: latest.instance?.name, status: 'generating', generatingPhase: 'writing',
                    createdAt: previous?.createdAt || Date.now(),
                    parentNodeId: previous?.parentNodeId || turn?.outputIds?.filter(id => id !== streamingReportId).at(-1) || turn?.id,
                    selectedChartIds: (latest.outputs || []).filter(output => output.type === 'result').map(output => output.content.result.chart_id) }));
                if (turn?.workflow) store.dispatch(dfActions.updateTextTurn({ id: turn.id, workflow: { ...turn.workflow,
                    artifacts: [...(turn.workflow.artifacts || []).filter(artifact => artifact.nodeId !== streamingReportId),
                        { nodeId: streamingReportId, stepId: latest.step_id, planRevision: latest.plan_revision || 0 }] } }));
                store.dispatch(dfActions.setFocused({ type: 'report', reportId: streamingReportId }));
                store.dispatch(dfActions.setViewMode('report'));
            } else if (result.type === 'text_delta' && result.channel === 'report' && streamingReportId) {
                reportContent += result.content || '';
                if (!reportTimer) reportTimer = setTimeout(flushReport, 100);
            } else if (result.type === 'workflow_state' && result.run) {
                flushReport();
                latest = result.run;
                await publishWorkflowRun(latest, workspaceId);
                onAccepted?.();
                onAccepted = undefined;
            } else if (result.type === 'activity' && latest) {
                const turn = store.getState().textTurns.find(item => item.workflow?.runId === latest?.id);
                if (turn?.workflow) store.dispatch(dfActions.updateTextTurn({ id: turn.id,
                    workflow: { ...turn.workflow, activity: result.message || result.tool?.replaceAll('_', ' '), activeTool: result.active_tool } }));
            } else if (result.type === 'error') {
                if (event.error) throw new ApiRequestError(event.error, 200);
                throw new Error(event.message || 'Workflow execution failed');
            }
        }
    } catch (reason) {
        if (latest?.status !== 'running') throw reason;
    } finally {
        flushReport();
        if (streamingReportId && store.getState().activeWorkspace?.id === workspaceId
            && latest?.status !== 'running'
            && store.getState().generatedReports.find(report => report.id === streamingReportId)?.status === 'generating') {
            store.dispatch(dfActions.updateGeneratedReportContent({ id: streamingReportId, content: reportContent, status: 'error' }));
        }
        monitoring = false;
        if (healthTimer) clearTimeout(healthTimer);
        unsubscribe();
        try {
            if (latest && store.getState().activeWorkspace?.id === workspaceId) {
                if (latest.status === 'running') {
                    try {
                        const { run } = await post<{ run: Run }>('run-state', { run_id: latest.id }, AbortSignal.timeout(10000));
                        latest = run;
                    } catch {
                        latest = { ...latest, activity: 'Reconnecting to workflow...' };
                    }
                }
                await publishWorkflowRun(latest, workspaceId);
            }
        } finally {
            executions.delete(workspaceId);
        }
    }
}

export async function pauseWorkflowRun(runId: string) {
    const workspaceId = store.getState().activeWorkspace?.id;
    const turn = store.getState().textTurns.find(item => item.workflow?.runId === runId);
    if (!turn?.workflow || turn.workflow.status !== 'running' || turn.workflow.pauseRequested) return;
    store.dispatch(dfActions.updateTextTurn({ id: turn.id, workflow: { ...turn.workflow, pauseRequested: true } }));
    try {
        await post('pause', { run_id: runId });
    } catch (reason) {
        const current = store.getState().textTurns.find(item => item.id === turn.id);
        if (store.getState().activeWorkspace?.id === workspaceId && current?.workflow) {
            store.dispatch(dfActions.updateTextTurn({ id: current.id, workflow: { ...current.workflow, pauseRequested: false } }));
        }
        handleApiError(reason, 'Workflow execution');
    }
}

export const WorkflowRunObserver: React.FC = () => {
    const workspaceId = useSelector((state: DataFormulatorState) => state.activeWorkspace?.id);
    const readOnly = useSelector((state: DataFormulatorState) => state.activeWorkspace?.readOnly);
    const scheduledView = useSelector((state: DataFormulatorState) => !!state.activeWorkspace?.readOnly && !!state.activeWorkspace?.scheduledRun);
    const runningIds = useSelector((state: DataFormulatorState) => state.textTurns
        .flatMap(turn => turn.workflow?.status === 'running' ? [turn.workflow.runId] : []).join(','));
    useEffect(() => {
        // Hosted private runs execute in a service workspace this browser cannot address.
        if (!workspaceId || !runningIds || (readOnly && !scheduledView) || workspaceId.startsWith('scheduled-private-')) return;
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let snapshotReloads = 0;
        const observe = async () => {
            let delay = 2000;
            try {
                if (executions.has(workspaceId)) return;
                for (const runId of runningIds.split(',')) {
                    const { run } = await post<{ run: Run }>('run-state', { run_id: runId }, AbortSignal.timeout(10000));
                    if (!active || store.getState().activeWorkspace?.id !== workspaceId || executions.has(workspaceId)) return;
                    if (!scheduledView) {
                        await publishWorkflowRun(run, workspaceId, false);
                    } else if (run.status === 'running') {
                        const existing = store.getState().textTurns.find(turn => turn.workflow?.runId === run.id);
                        const turn = workflowTextTurn(run, existing);
                        store.dispatch(dfActions.addTextTurn({ ...turn, outputIds: existing?.outputIds,
                            workflow: { ...turn.workflow!, artifacts: existing?.workflow?.artifacts } }));
                    } else {
                        if (store.getState().sessionLoading) return;
                        const result = await loadWorkspace(workspaceId);
                        if (!active || store.getState().activeWorkspace?.id !== workspaceId) return;
                        // The scheduler saves the final snapshot just after the run releases its lock.
                        if (!result || (result.readOnly && ++snapshotReloads < 5)) return;
                        store.dispatch(dfActions.loadState({ ...result.state, activeWorkspace: { ...result.state.activeWorkspace,
                            id: workspaceId, displayName: result.displayName, readOnly: result.readOnly } }));
                        return;
                    }
                }
            } catch (reason) {
                if (reason instanceof WorkspaceLoadSupersededError) return;
                if (reason instanceof ApiRequestError && ['ACCESS_DENIED', 'AUTH_REQUIRED', 'WORKSPACE_EXPIRED'].includes(reason.apiError.code)) {
                    active = false;
                    return;
                }
                delay = 3000;
                if (active && store.getState().activeWorkspace?.id === workspaceId) {
                    for (const turn of store.getState().textTurns) {
                        if (turn.workflow?.status === 'running') store.dispatch(dfActions.updateTextTurn({ id: turn.id,
                            workflow: { ...turn.workflow, activity: 'Reconnecting to workflow...' } }));
                    }
                }
            } finally {
                if (active) timer = setTimeout(observe, delay);
            }
        };
        void observe();
        return () => { active = false; if (timer) clearTimeout(timer); };
    }, [workspaceId, readOnly, scheduledView, runningIds]);
    return null;
};

export const WorkflowProgress: React.FC<{ turn: TextTurn; canvas?: boolean; selected?: boolean; interactionOnly?: boolean; onCloseInteraction?: () => void }> = ({ turn, canvas = false, selected = false, interactionOnly = false, onCloseInteraction = () => {} }) => {
    const theme = useTheme();
    const readOnly = useSyncExternalStore(store.subscribe, () => !!store.getState().activeWorkspace?.readOnly);
    const [deleting, setDeleting] = useState(false);
    const [questionAnswers, setQuestionAnswers] = useState<Record<number, ClarificationResponse>>({});
    const [savedLog, setSavedLog] = useState<NonNullable<TextTurn['workflow']>['log']>();
    const [savedPlan, setSavedPlan] = useState<Run>();
    const [loadingLog, setLoadingLog] = useState(false);
    const [historyUnavailable, setHistoryUnavailable] = useState(false);
    const [approvalOpen, setApprovalOpen] = useState(false);
    const [dismissedApproval, setDismissedApproval] = useState<string>();
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const workflow = turn.workflow;
    const [liveElapsed, setLiveElapsed] = useState(0);
    useEffect(() => {
        setLiveElapsed(0);
        if (workflow?.status !== 'running' || workflow.planReviewPending || interactionOnly) return;
        const started = Date.now();
        const timer = setInterval(() => setLiveElapsed((Date.now() - started) / 1000), 1000);
        return () => clearInterval(timer);
    }, [workflow?.runId, workflow?.status, workflow?.stepId, workflow?.steps, workflow?.planReviewPending, interactionOnly]);
    const questionKey = workflow ? `${workflow.runId}:${workflow.interactionId || workflow.calls}` : '';
    const questions = workflow?.interactionId ? workflow.questions || [] : [];
    useEffect(() => { setQuestionAnswers({}); }, [questionKey]);
    const resume = async (response: Omit<WorkflowRequest, 'run_id' | 'path'>) => {
        if (!workflow || readOnly || submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        try {
            if (response.reply && canAnswerWorkflowQuestion(turn)) await replyWorkflowQuestion(turn, response.reply);
            else await executeWorkflow({ run_id: workflow.runId, ...response });
            return true;
        }
        catch (reason) { handleApiError(reason, 'Workflow execution'); return false; }
        finally { submittingRef.current = false; setSubmitting(false); }
    };
    const submitQuestion = (responses: ClarificationResponse[]) => {
        const answer = formatClarificationResponses(responses).trim();
        if (!answer || submittingRef.current) return;
        void resume({ reply: answer });
    };
    useEffect(() => {
        const needsOutputOrder = turn.outputIds === undefined && savedLog === undefined;
        const needsArtifacts = workflow?.artifacts === undefined && savedPlan === undefined;
        const needsInputs = savedLog === undefined && workflow?.log?.some(entry => entry.input === undefined);
        const needsPlan = workflow?.steps.some(step => step.checkers === undefined)
            || workflow?.planHistory?.some(plan => plan.steps.some(step => step.checkers === undefined))
            || workflow?.overview === undefined;
        if (!canvas || !workflow || historyUnavailable || (!needsInputs && !needsArtifacts && !needsOutputOrder && (workflow.log !== undefined || savedLog !== undefined)
            && (!needsPlan || savedPlan !== undefined))) return;
        const workspaceId = store.getState().activeWorkspace?.id;
        if (!workspaceId) return;
        let active = true;
        setLoadingLog(true);
        void post<{ run: Run }>('run-state', { run_id: workflow.runId }).then(({ run }) => {
            if (active && store.getState().activeWorkspace?.id === workspaceId) {
                setLoadingLog(false);
                setSavedPlan(run);
                setSavedLog(Object.entries(run.evidence || {}).map(([id, evidence]) => ({ id, ...evidence })));
                if (turn.outputIds === undefined) store.dispatch(dfActions.updateTextTurn({ id: turn.id, outputIds: workflowOutputIds(run) }));
            }
        }).catch(() => {
            if (active && store.getState().activeWorkspace?.id === workspaceId) {
                setLoadingLog(false);
                setHistoryUnavailable(true);
            }
        });
        return () => { active = false; };
    }, [canvas, workflow?.runId, workflow?.log, workflow?.steps, workflow?.planHistory, savedLog, savedPlan, turn.id, turn.outputIds, historyUnavailable]);
    if (!workflow) return null;
    const overview = workflow.overview || savedPlan?.instance?.overview;
    const scope = workflow.prompt ?? savedPlan?.instance?.prompt;
    const deliverables = workflow.deliverables ?? savedPlan?.instance?.deliverables ?? [];
    const setup = workflow.setup ?? savedPlan?.setup;
    const proseSx = { fontSize: textVar.md, lineHeight: 1.6, overflowWrap: 'anywhere', '& p': { my: 0.5 }, '& ul, & ol': { pl: 2.5, my: 0.5 } };
    const statusColor = workflow.status === 'completed' ? 'success.main'
        : workflow.status === 'running' ? 'text.primary' : workflow.status === 'paused' ? 'warning.main' : 'error.main';
    const sectionContentSx = { py: 0.75, minWidth: 0 };
    const activeTool = workflow.status === 'running' ? workflow.activeTool : undefined;
    const toolTitle = (details?: Record<string, string>) => details?.title || details?.purpose || details?.display_name || details?.table_name || details?.filename;
    const renderToolDetails = (details?: Record<string, string>, summary?: string) => {
        const entries = Object.entries(details || {}).filter(([, value]) => value && value !== summary);
        return entries.length > 0 ? <Box component="dl" sx={{ m: 0, display: 'grid',
        gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 1, fontSize: textVar.xs, color: 'text.secondary' }}>
        {entries.map(([name, value]) => <React.Fragment key={name}>
            <Box component="dt" sx={{ textTransform: 'capitalize' }}>{name.replaceAll('_', ' ')}</Box>
            <Box component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>{value}</Box>
        </React.Fragment>)}
        </Box> : null;
    };
    const savedInputs = new Map(savedLog?.map(entry => [entry.id, entry.input]));
    const allLog = (workflow.log || savedLog || []).map(entry => entry.input !== undefined
        ? entry : { ...entry, input: savedInputs.get(entry.id) });
    const artifacts = workflow.artifacts || (savedPlan ? workflowArtifacts(savedPlan) : []);
    const unassignedArtifacts = artifacts.filter(artifact => !artifact.stepId);
    const log = allLog.filter(entry => (entry.plan_revision || 0) === (workflow.planRevision || 0));
    const unassignedLog = log.filter(entry => !workflow.steps.some(step => step.id === entry.step_id));
    const unassignedChecks = (workflow.checks || []).filter(check => !workflow.steps.some(step => step.checkIds?.includes(check.id)));
    const isActiveStep = (id: string) => workflow.status === 'running' && !workflow.planReviewPending && workflow.stepId === id;
    const displayedStepStatus = (status: string, archived = false) =>
        !archived && workflow.status === 'completed' && status === 'visited' ? 'completed' : status;
    const stepDuration = (elapsed?: number, active = false) => {
        if (active) elapsed = (elapsed || 0) + liveElapsed;
        if (elapsed === undefined || !Number.isFinite(elapsed)) return null;
        const seconds = Math.max(0, Math.ceil(elapsed));
        return <Tooltip title="Active time including actions and checks"><Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {' · '}{seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}
        </Box></Tooltip>;
    };
    const stepIcon = (status: string, active = false) => active ? <CircularProgress size={16} aria-label="Current step running" sx={{ flexShrink: 0 }} />
        : status === 'passed' || status === 'completed' ? <CheckCircleOutlineIcon color="success" sx={{ fontSize: 16 }} />
        : status === 'failed' ? <ErrorOutlineIcon color="error" sx={{ fontSize: 16 }} />
        : status === 'visited' ? <RadioButtonUncheckedIcon color="success" sx={{ fontSize: 16 }} />
        : (status === 'current' || status === 'reviewing') && workflow.status === 'running'
            ? <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: 'primary.main' }} />
        : <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />;
    const renderChecks = (checks: NonNullable<NonNullable<TextTurn['workflow']>['checks']>) => checks.map(check => <Box key={check.id}
        sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1 }}>
        <Box sx={{ pt: 0.25 }}>{stepIcon(check.status)}</Box>
        <Box sx={{ minWidth: 0 }}><Typography sx={{ fontSize: textVar.sm, fontWeight: 600 }}>{check.id} · {check.status}</Typography>
            <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary', lineHeight: 1.6 }}>{check.explanation}</Typography></Box>
    </Box>);
    const callPresentation = (tool: string) => tool === 'execute_python_script'
        ? { type: 'python', label: 'Python', Icon: CodeIcon }
        : tool === 'run_terminal' ? { type: 'terminal', label: 'Terminal', Icon: TerminalIcon }
        : { type: 'tool', label: 'Tool', Icon: BuildOutlinedIcon };
    const renderCallBody = (tool: string, input?: Record<string, unknown>, text?: string) => {
        const presentation = callPresentation(tool);
        let language: 'python' | 'bash' | 'json' = 'json';
        let code = input === undefined ? undefined : JSON.stringify(input, null, 2);
        if (presentation.type === 'python' && typeof input?.code === 'string') {
            code = input.code;
            language = 'python';
        } else if (presentation.type === 'terminal' && Array.isArray(input?.argv)
                && input.argv.every((argument): argument is string => typeof argument === 'string')) {
            code = formatTerminalCommand(input.argv);
            language = 'bash';
        }
        let parsed: unknown;
        if (text !== undefined) {
            try { parsed = JSON.parse(text); } catch {}
        }
        const payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
        const result = text === undefined ? undefined : presentation.type === 'terminal' && payload
            ? payload.result && typeof payload.result === 'object' && !Array.isArray(payload.result)
                ? payload.result as Record<string, unknown> : payload
            : { output: parsed === undefined ? text : JSON.stringify(parsed, null, 2) };
        return <ExecutionCodeBlock code={code} language={language} label={`${presentation.label} input`}
            copyLabel="Copy input" result={result} />;
    };
    const renderCall = (entry: typeof log[number] & { running?: boolean }) => {
        const presentation = callPresentation(entry.tool);
        return <Box component="details" key={entry.id} data-workflow-call={entry.running ? undefined : entry.id}
            data-workflow-running-tool={entry.running ? entry.id : undefined} data-workflow-call-type={presentation.type}>
            <Box component="summary" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, '&&': { py: 0.25 } }}>
                <ChevronRightIcon className="workflow-chevron" sx={{ fontSize: 16, flexShrink: 0 }} />
                {entry.running && <CircularProgress size={12} sx={{ flexShrink: 0 }} />}
                <presentation.Icon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
                <Box component="span" sx={{ fontSize: textVar.xs, color: 'text.secondary', flexShrink: 0 }}>{presentation.label}</Box>
                <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{entry.running ? 'Running ' : entry.call !== undefined ? `Call ${entry.call}: ` : ''}{entry.tool.replaceAll('_', ' ')}
                    {toolTitle(entry.details) && <Box component="span" sx={{ color: 'text.secondary' }}> · {toolTitle(entry.details)}</Box>}
                </Box>
            </Box>
            <Box sx={{ pl: { xs: 1, sm: 4 }, pb: 1.5 }}>
                {renderToolDetails(entry.details, toolTitle(entry.details))}
                {renderCallBody(entry.tool, entry.input, entry.running ? undefined : entry.text)}
            </Box>
        </Box>;
    };
    const renderTimeline = (steps: NonNullable<TextTurn['workflow']>['steps'], checks: NonNullable<NonNullable<TextTurn['workflow']>['checks']>, revision: number, archived = false) => (
        <Box component="ol" aria-label={archived ? `Plan ${revision + 1} timeline` : 'Workflow plan timeline'} sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {steps.map((step, index) => {
        const entries = allLog.filter(entry => (entry.plan_revision || 0) === revision && entry.step_id === step.id);
        const stepArtifacts = artifacts.filter(artifact => artifact.planRevision === revision && artifact.stepId === step.id);
        const results = checks.filter(check => step.checkIds?.includes(check.id));
        const transitions = (workflow.transitions || []).filter(transition => (transition.plan_revision || 0) === revision && transition.from === step.id);
        const savedSteps = revision === (savedPlan?.plan_revision || 0) ? savedPlan?.instance?.steps
            : savedPlan?.plan_revisions?.find((plan, planIndex) => (plan.plan_revision ?? planIndex) === revision)?.previous_steps;
        const definition = savedSteps?.find(item => item.id === step.id);
        const checkers = step.checkers || definition?.checkers || (step.checkIds || []).map(id => ({ id, condition: undefined, when: undefined, on_fail: undefined }));
        const active = !archived && isActiveStep(step.id);
        const runningTool = active && activeTool?.step_id === step.id ? activeTool : undefined;
        const calls = runningTool && !entries.some(entry => entry.id === runningTool.id)
            ? [{ ...runningTool, text: '', running: true }, ...entries] : entries;
        const status = displayedStepStatus(step.status, archived);
        const finished = status === 'passed' || status === 'completed';
        return <Box component="li" key={step.id} data-workflow-step={archived ? undefined : step.id} aria-busy={active}
            sx={{ position: 'relative', display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', columnGap: 1.25, pb: 1.5 }}>
            {index < steps.length - 1 && <Box aria-hidden="true" data-workflow-connector={finished ? 'solid' : 'pending'} sx={{ position: 'absolute', left: 11, top: 26, bottom: 2,
                borderLeft: 2, borderColor: finished ? 'success.main' : 'divider' }} />}
            <Box data-workflow-marker sx={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{stepIcon(status, active)}</Box>
            <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 1, minHeight: 24 }}>
                    <Typography component="h3" sx={{ fontSize: textVar.md, fontWeight: active ? 600 : 500, flex: 1, minWidth: 0,
                        color: status === 'pending' ? 'text.secondary' : 'text.primary', overflowWrap: 'anywhere' }}>{step.description || definition?.description || step.id.replaceAll('_', ' ')}</Typography>
                    <Typography component="span" sx={{ fontSize: textVar.xs, color: finished ? 'success.main' : 'text.secondary' }}>{status}</Typography>
                </Box>
                {stepArtifacts.length > 0 && <Box data-workflow-artifacts={step.id} sx={{ mt: 1, mb: 0.5 }}><WorkflowArtifacts artifacts={stepArtifacts} /></Box>}
                <Box component="details" data-workflow-execution={step.id}>
                    <Box component="summary" sx={{ color: 'text.secondary', '&&': { py: 0.5 }, fontSize: textVar.xs }}>Execution details</Box>
                    <Box data-workflow-action={step.id} sx={proseSx}><ReactMarkdown>{step.instructions || definition?.instructions || ''}</ReactMarkdown></Box>
                    <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary', my: 1 }}>{calls.length} calls · {results.filter(result => result.status === 'passed').length}/{checkers.length} checks{stepDuration(step.elapsedSeconds, active)}</Typography>
                    {step.next && step.next !== steps[index + 1]?.id && <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>Next: {step.next}</Typography>}
                    <Box data-workflow-activity={step.id} sx={sectionContentSx}>
                        <Typography component="h3" sx={{ fontWeight: 600, mb: 0.75 }}>Activities</Typography>
                        {!calls.length && !transitions.length && !step.assessment && <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary' }}>No activity yet.</Typography>}
                        {step.assessment && <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary', my: 1 }}>
                            Progress assessment: {step.assessment.status} · {step.assessment.explanation}
                            {step.assessment.evidence_ids.length ? ` · Evidence: ${step.assessment.evidence_ids.join(', ')}` : ''}
                        </Typography>}
                        {calls.map(renderCall)}
                        {transitions.map((transition, transitionIndex) => <Typography key={transitionIndex} sx={{ mt: 1, fontSize: textVar.sm, color: 'text.secondary' }}>{transition.reason}</Typography>)}
                    </Box>
                    <Box data-workflow-checks={step.id} sx={sectionContentSx}>
                        <Typography component="h3" sx={{ fontWeight: 600, mb: 0.75 }}>Checks</Typography>
                        {!checkers.length && <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary' }}>No checks specified.</Typography>}
                        {checkers.map(check => {
                            const result = results.find(item => item.id === check.id);
                            return <Box component="details" key={check.id} data-workflow-check={check.id}>
                                <Box component="summary" sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
                                    <ChevronRightIcon className="workflow-chevron" sx={{ fontSize: 16, mt: 0.25, flexShrink: 0 }} />
                                    <Box component="span" aria-label={`${check.id}: ${result?.status || 'pending'}`} sx={{ display: 'inline-flex', pt: 0.25 }}>{stepIcon(result?.status || 'pending')}</Box>
                                    <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{check.condition || check.id}</Box>
                                </Box>
                                <Box sx={{ pl: 5.5, py: 0.5 }}>
                                    <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>{check.id} · {result?.status || 'pending'} (agent-reported)</Typography>
                                    <Typography sx={{ fontSize: textVar.md, lineHeight: 1.6 }}>{result?.explanation || 'Not checked yet.'}</Typography>
                                    <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>{check.when === 'before' ? 'Before' : check.when === 'during' ? 'During' : 'After'} this step{check.on_fail ? ` · On failure: ${check.on_fail}` : ''}</Typography>
                                </Box>
                            </Box>;
                        })}
                    </Box>
                </Box>
            </Box>
        </Box>;
        })}
        </Box>
    );
    const statusAction = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => canvas || interactionOnly
        ? <Tooltip title={label}><span><IconButton size="small" color={workflow.status === 'paused' ? 'warning' : 'primary'} aria-label={label} disabled={disabled} onClick={onClick}>{icon}</IconButton></span></Tooltip>
        : <Button size="small" color={workflow.status === 'paused' ? 'warning' : 'primary'} startIcon={icon} disabled={disabled} onClick={onClick}>{label}</Button>;
    const pauseWorkflow = () => { void pauseWorkflowRun(workflow.runId); };
    const currentStepIndex = workflow.steps.findIndex(step => step.id === workflow.stepId);
    const currentStep = workflow.steps[currentStepIndex];
    const needsReview = !!(workflow.terminalRequest || workflow.dataOperation || turn.form || questions.length);
    const summary = (
        <Box component="span" sx={{ flex: 1, minWidth: 0, ...(canvas ? { display: 'block' } : {}) }}>
            <Typography component="span" sx={{ display: 'block', fontSize: textVar.xs, color: 'text.secondary', overflowWrap: 'anywhere', mb: 0.75, pr: canvas ? 0 : 3.5 }}>
                <Box component="span"
                    sx={{ fontWeight: 600, color: statusColor, textTransform: 'capitalize' }}>
                    {workflow.status === 'running' ? <ShimmerText tone="neutral" fontSize="inherit" fontWeight={600}>{workflow.pauseRequested ? 'Stopping...' : workflow.planReviewPending ? 'Reviewing plan' : workflow.status}</ShimmerText> : workflow.status}
                </Box> · {workflow.toolCalls ?? workflow.log?.length ?? 0} tool calls
            </Typography>
            {workflow.status === 'running' && workflow.activity && <Box component="span" data-workflow-current-action
                sx={{ display: 'block', px: 1, py: 0.75, mb: 0.75, bgcolor: 'action.hover', borderRadius: 0.5,
                    fontSize: textVar.xs, color: 'text.secondary', overflowWrap: 'anywhere' }}>
                {workflow.activity}
                {!canvas && toolTitle(activeTool?.details) && toolTitle(activeTool?.details) !== workflow.activity && <Box component="span" sx={{ display: 'block', mt: 0.25 }}>
                    {toolTitle(activeTool?.details)}
                </Box>}
            </Box>}
            {!canvas && <Box component="span" sx={{ display: 'block' }}>
            {workflow.steps.map(step => <Box key={step.id} component="span" aria-busy={isActiveStep(step.id)}
                data-workflow-step={step.id} sx={{ display: 'flex', gap: 0.75, alignItems: 'center', py: 0.25 }}>
            {stepIcon(displayedStepStatus(step.status), isActiveStep(step.id))}
            <Typography component="span" sx={{ fontSize: textVar.xs, color: 'text.secondary', overflowWrap: 'anywhere' }}>{step.id} · {displayedStepStatus(step.status)}{stepDuration(step.elapsedSeconds, isActiveStep(step.id))}</Typography>
        </Box>)}
        </Box>}
        </Box>
    );
    return <Box data-workflow-progress={canvas || interactionOnly ? undefined : workflow.runId} onClick={event => event.stopPropagation()}
        sx={{ fontFamily: theme => canvas ? readingTypography.fontFamily : theme.typography.fontFamily, fontSize: canvas ? textVar.md : textVar.sm, lineHeight: 1.5, letterSpacing: 0,
            ...(canvas ? { position: 'relative', width: '100%', height: '100%', boxSizing: 'border-box', minWidth: 0, overflow: 'hidden',
                color: readingTypography.color, '--df-text-xs': '0.75rem', '--df-text-sm': '0.8125rem', '--df-text-md': '0.875rem',
                '& h2': { fontSize: '0.95rem', lineHeight: 1.4, letterSpacing: 0 },
                '& h3': { fontSize: '0.875rem', lineHeight: 1.4, letterSpacing: 0 } } : { minWidth: 0, width: '100%' }) }}>
        <Box data-workflow-scroll={canvas ? workflow.runId : undefined} sx={canvas ? { height: '100%', overflow: 'auto', boxSizing: 'border-box',
            p: { xs: 2, sm: 3 }, '& > *': { maxWidth: 960, mx: 'auto' } } : { display: 'contents' }}>
        {!interactionOnly && <>
        {canvas && <Box component="header" aria-label="Workflow status" sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
                <Typography component="h1" sx={{ minWidth: 0, fontFamily: 'inherit', fontSize: '1.375rem', lineHeight: 1.25, fontWeight: 700, letterSpacing: 0 }}>{turn.prompt?.replace(/^Run workflow: /, '') || 'Workflow'}</Typography>
                <Typography sx={{ fontSize: textVar.sm, color: statusColor, textTransform: 'capitalize' }}>
                    {workflow.status === 'running' ? <ShimmerText tone="neutral" fontSize="inherit">{workflow.pauseRequested ? 'Stopping...' : workflow.planReviewPending ? 'Reviewing plan' : 'Running'}</ShimmerText> : workflow.status}
                </Typography>
                <Box sx={{ ml: 'auto' }}>
                    {!readOnly && workflow.status === 'running' && <Button size="small" disabled={workflow.pauseRequested} startIcon={<PauseIcon />} onClick={pauseWorkflow}>Pause</Button>}
                    {!readOnly && workflow.status === 'paused' && <Button size="small" disabled={submitting} startIcon={needsReview ? <QuestionAnswerOutlinedIcon /> : <PlayArrowIcon />}
                        onClick={() => {
                            if (workflow.terminalRequest) setApprovalOpen(true);
                            else if (needsReview) store.dispatch(dfActions.setFocused({ type: 'text', textId: turn.id }));
                            else void resume({});
                        }}>{needsReview ? 'Review request' : 'Resume'}</Button>}
                </Box>
            </Box>
            {currentStep && workflow.status !== 'completed' && !workflow.planReviewPending && <Typography sx={{ mt: 1, fontSize: textVar.md }}>
                <Box component="span" sx={{ color: 'text.secondary' }}>Step {currentStepIndex + 1} of {workflow.steps.length}: </Box>
                {currentStep.description || currentStep.id.replaceAll('_', ' ')}
            </Typography>}
            {workflow.status === 'running' && workflow.activity && <Typography data-workflow-current-action sx={{ mt: 0.5, fontSize: textVar.sm, color: 'text.secondary' }}>{workflow.activity}</Typography>}
            {workflow.status !== 'running' && workflow.status !== 'completed' && <Box sx={{ ...proseSx, mt: 0.5, color: 'text.secondary' }}><ReactMarkdown>{turn.content}</ReactMarkdown></Box>}
            {workflow.interruptedResponse && <Box component="details" sx={{ mt: 1, fontSize: textVar.sm }}>
                <Box component="summary" sx={{ cursor: 'pointer', color: 'text.secondary' }}>Interrupted response</Box>
                <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: textVar.xs }}>{workflow.interruptedResponse}</Typography>
            </Box>}
        </Box>}
        {!canvas && <ThreadArtifactCard artifactType="workflow" warning={workflow.status === 'paused'} title="Open workflow response and analysis log" selected={selected} onClick={() => {
            store.dispatch(dfActions.setFocused({ type: 'text', textId: turn.id }));
            store.dispatch(dfActions.setViewMode('editor'));
        }} actions={<ArtifactDeleteButton label="Delete workflow node" disabled={deleting} onClick={async () => {
            const workspaceId = store.getState().activeWorkspace?.id;
            if (!workspaceId || deleting) return;
            setDeleting(true);
            try {
                if (workflow.status === 'running') await post('pause', { run_id: workflow.runId });
                if (store.getState().activeWorkspace?.id !== workspaceId) return;
                deletedWorkflowRuns.add(`${workspaceId}/${workflow.runId}`);
                if (workflow.status === 'running') executions.get(workspaceId)?.abort();
                for (const card of store.getState().textTurns.filter(item => item.workflowCardFor === turn.id)) {
                    store.dispatch(dfActions.removeTextTurn(card.id));
                }
                store.dispatch(dfActions.removeTextTurn(turn.id));
            } catch (reason) { handleApiError(reason, 'Delete workflow node'); }
            finally { setDeleting(false); }
        }} />}>{summary}</ThreadArtifactCard>}
        {canvas && <Box component="section" aria-label="Workflow summary" sx={{ ...proseSx, mt: 2, pb: 1.5, borderBottom: 1, borderColor: 'divider',
            '& > h2': { mb: 0.75 } }}>
            {workflow.status === 'completed' ? <>
                <Typography component="h2" sx={{ fontSize: textVar.sm, fontWeight: 600 }}>Results</Typography>
                <ReactMarkdown>{turn.content}</ReactMarkdown>
            </> : null}
            {(overview || scope || deliverables.length > 0 || setup?.instructions || Object.keys(setup?.parameters || {}).length > 0) && <Box component="details" sx={{ mt: 1,
                '& summary': { cursor: 'pointer', color: 'text.secondary' } }}>
                <Box component="summary">Workflow details</Box>
                {overview && <Box data-workflow-overview sx={{ my: 1 }}><ReactMarkdown>{overview}</ReactMarkdown></Box>}
                {scope && <ReactMarkdown>{scope}</ReactMarkdown>}
                {deliverables.length > 0 && <Box sx={{ mt: 0.75 }}>
                    <Typography component="h2" sx={{ fontSize: textVar.sm, fontWeight: 600 }}>Expected outputs</Typography>
                    <Box component="ul" sx={{ m: 0, mt: 0.25, pl: 2.5, '& p': { my: 0 } }}>
                        {deliverables.map((item, index) => <Box component="li" key={index}><ReactMarkdown>{item}</ReactMarkdown></Box>)}
                    </Box>
                </Box>}
                {!!Object.keys(setup?.parameters || {}).length && <Box component="dl" sx={{ display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 0.75, my: 1 }}>
                    {Object.entries(setup!.parameters).map(([name, value]) => <React.Fragment key={name}>
                        <Box component="dt" sx={{ color: 'text.secondary' }}>{name.replaceAll('_', ' ')}</Box>
                        <Box component="dd" sx={{ m: 0 }}>{String(value)}</Box>
                    </React.Fragment>)}
                </Box>}
                {setup?.instructions && <ReactMarkdown>{setup.instructions}</ReactMarkdown>}
            </Box>}
        </Box>}
        {canvas && <Box role="region" aria-label="Workflow response and analysis log" sx={{ mt: 1, overflowWrap: 'anywhere',
            '& details, & summary': { fontFamily: 'inherit', fontSize: textVar.sm, letterSpacing: 0 },
            '& summary': { cursor: 'pointer', py: 1.25, '&:hover': { bgcolor: 'action.hover' },
                '&:focus-visible': { outline: '2px solid', outlineColor: 'text.secondary', outlineOffset: -2 } },
            '& summary:has(.workflow-chevron)': { listStyle: 'none', '&::-webkit-details-marker': { display: 'none' } },
            '& details[open] > summary > .workflow-chevron': { transform: 'rotate(90deg)' } }}>
            {!!workflow.planHistory?.length && <Box component="details" sx={{ mb: 2, borderTop: 1, borderColor: 'divider' }}>
                <Box component="summary" sx={{ fontWeight: 600 }}>Earlier plans ({workflow.planHistory.length})</Box>
                {workflow.planHistory.map(plan => <Box component="details" key={plan.revision} data-workflow-plan={plan.revision}
                    sx={{ pl: { xs: 1, sm: 3 }, borderTop: 1, borderColor: 'divider' }}>
                    <Box component="summary">Plan {plan.revision + 1} · {plan.reason}</Box>
                    {renderTimeline(plan.steps, plan.checks, plan.revision, true)}
                    {allLog.filter(entry => (entry.plan_revision || 0) === plan.revision && !plan.steps.some(step => step.id === entry.step_id)).map(renderCall)}
                </Box>)}
            </Box>}
            <Typography component="h2" sx={{ fontSize: textVar.sm, fontWeight: 600, mb: 1 }}>Steps{workflow.planRevision ? ` · Plan ${workflow.planRevision + 1}` : ''}</Typography>
            {renderTimeline(workflow.steps, workflow.checks || [], workflow.planRevision || 0)}
            {!!unassignedArtifacts.length && <Box component="section" aria-label="Unassigned artifacts" sx={{ mt: 2 }}>
                <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>Unassigned artifacts</Typography>
                <WorkflowArtifacts artifacts={unassignedArtifacts} />
            </Box>}
            {loadingLog && <CircularProgress size={16} aria-label="Loading analysis log" />}
            {historyUnavailable && <Typography sx={{ mt: 1, fontSize: textVar.sm, color: 'text.secondary' }}>
                Additional run history is unavailable in this session. Saved outputs are still available.
            </Typography>}
            {!!unassignedLog.length && <Box component="details" sx={{ mt: 2, borderTop: 1, borderColor: 'divider' }}>
                <Box component="summary" sx={{ fontWeight: 600 }}>Unassigned calls ({unassignedLog.length})</Box>
                {unassignedLog.map(renderCall)}
            </Box>}
            {!!unassignedChecks.length && <Box component="details" sx={{ borderTop: 1, borderColor: 'divider' }}>
                <summary>Checks (agent-reported)</summary>{renderChecks(unassignedChecks)}
            </Box>}
        </Box>}
        </>}
        </Box>
        {!readOnly && <Box sx={{ display: 'contents' }}>
        {workflow.status === 'paused' && workflow.terminalRequest && <>
            {!canvas && statusAction('Review command', <TerminalIcon sx={{ fontSize: 18 }} />, () => {
                if (!interactionOnly) store.dispatch(dfActions.setFocused({ type: 'text', textId: turn.id }));
                else setApprovalOpen(true);
            }, submitting)}
            {(interactionOnly || canvas) && !submitting && (approvalOpen || (interactionOnly && dismissedApproval !== workflow.terminalRequest.id)) && <TerminalApprovalDialog key={workflow.terminalRequest.id} proposal={workflow.terminalRequest} onDecision={decision => {
                setApprovalOpen(false); setDismissedApproval(workflow.terminalRequest!.id);
                void resume({ terminal_response: { request_id: workflow.terminalRequest!.id, decision } })
                    .then(success => { if (success === false) setApprovalOpen(true); });
            }} />}
        </>}
        {!canvas && workflow.status === 'paused' && workflow.dataOperation && (interactionOnly ? <Box sx={submitting ? { pointerEvents: 'none', filter: 'grayscale(1)' } : undefined}>
            <ClarificationPanel key={questionKey} questions={questions} dataOperation={workflow.dataOperation}
                selectedAnswers={questionAnswers}
                onSelectAnswer={(index, response) => {
                    setQuestionAnswers(previous => ({ ...previous, [index]: response }));
                    store.dispatch(dfActions.updateTextTurn({ id: turn.id, workflow: { ...workflow,
                        dataOperation: { ...workflow.dataOperation!, selectedPlanId: response.value } } }));
                }}
                onClose={onCloseInteraction}
                onSubmit={responses => {
                    const planId = responses[0]?.value;
                    if (workflow.dataOperation!.plans.some(plan => plan.id === planId)) {
                        void resume({ interaction_response: { operation_id: workflow.dataOperation!.id, plan_id: planId! } });
                    }
                }} />
        </Box> : statusAction('Review import', <PlayArrowIcon sx={{ fontSize: 18 }} />, () => store.dispatch(dfActions.setFocused({ type: 'text', textId: turn.id }))))}
        {workflow.status === 'paused' && workflow.interactionId && turn.form && interactionOnly && <ConnectorFormCard
            key={workflow.interactionId} messageId={turn.id} prompt={turn.form.connector} variant="bare" onResolved={resolution => {
                void resume({ reply: `Connection created: ${resolution.connectionName} (connector ID: ${resolution.connectorId || ''}). Inspect this connector and continue the workflow.` });
            }} />}
        {!canvas && workflow.status === 'paused' && !workflow.terminalRequest && !workflow.dataOperation && !turn.form && (
            interactionOnly ? questions.length > 0 ? <Box sx={submitting ? { pointerEvents: 'none', filter: 'grayscale(1)' } : undefined}>
                    <ClarificationPanel key={questionKey} questions={questions}
                        selectedAnswers={questionAnswers}
                        onSelectAnswer={(index, response, autoSubmit = true) => {
                            const answers = { ...questionAnswers, [index]: response };
                            setQuestionAnswers(answers);
                            if (autoSubmit && questions.every((question, questionIndex) => answers[questionIndex])) {
                                submitQuestion(questions.map((question, questionIndex) => answers[questionIndex]));
                            }
                        }}
                        onClearAnswer={index => setQuestionAnswers(previous => {
                            const answers = { ...previous }; delete answers[index]; return answers;
                        })}
                        onClose={onCloseInteraction}
                        onSubmit={submitQuestion} />
            </Box> : <FailedDraftPanel error={turn.content} onClose={onCloseInteraction}
                onRetry={() => { void resume({}); }} retryDisabled={submitting} retryLabel="Continue workflow" />
            : statusAction(questions.length ? 'View question' : 'Review interruption',
                questions.length ? <QuestionAnswerOutlinedIcon sx={{ fontSize: 18 }} /> : <ErrorOutlineIcon sx={{ fontSize: 18 }} />,
                () => store.dispatch(dfActions.setFocused({ type: 'text', textId: turn.id })))
        )}
        {!canvas && !interactionOnly && workflow.status === 'running' && statusAction('Pause', <PauseIcon sx={{ fontSize: 18 }} />, pauseWorkflow, workflow.pauseRequested)}
        </Box>}
    </Box>;
};

const workflowSetupContentSx = {
    display: 'flex', flexDirection: 'column', gap: 2.5, pb: 2.5,
    '& .MuiInputBase-root': { fontSize: textVar.md, lineHeight: 1.5 },
    '& .MuiInputLabel-root': { fontSize: textVar.md },
    '& .MuiFormHelperText-root': { fontSize: textVar.xs, lineHeight: 1.6, mt: 0.75 },
    '& .MuiFormControlLabel-label': { fontSize: textVar.md },
    '& .MuiTypography-caption': { display: 'block', fontSize: textVar.xs, lineHeight: 1.6, mt: 0.5 },
};

const WorkflowSetupFields: React.FC<{ parameters: WorkflowParameter[]; values: WorkflowSetup['parameters'];
    onChange: (values: WorkflowSetup['parameters']) => void; disabled: boolean }> = ({ parameters, values, onChange, disabled }) => <>
    {parameters.map(parameter => {
        const value = values[parameter.name] ?? '';
        const update = (value: string | boolean) => onChange({ ...values, [parameter.name]: value });
        if (parameter.type === 'boolean') return <Box key={parameter.name}>
            <FormControlLabel label={parameter.label} control={<Checkbox size="small" checked={value === true}
                disabled={disabled} onChange={(_, checked) => update(checked)} />} />
            {parameter.description && <Typography variant="caption" color="text.secondary">{parameter.description}</Typography>}
        </Box>;
        if (parameter.type === 'select' && parameter.allow_custom) return <Autocomplete key={parameter.name}
            freeSolo forcePopupIcon openOnFocus options={parameter.options || []} value={String(value) || null} inputValue={String(value)} disabled={disabled}
            onInputChange={(_, value) => update(value)} renderInput={params => <TextField {...params} size="small" label={parameter.label}
                required={parameter.required} helperText={parameter.description} slotProps={{ htmlInput: { ...params.inputProps, maxLength: 4000 } }} />} />;
        return <TextField key={parameter.name} size="small" fullWidth label={parameter.label} required={parameter.required}
            disabled={disabled} helperText={parameter.description} value={value} onChange={event => update(event.target.value)}
            select={parameter.type === 'select'} type={parameter.type === 'number' ? 'number' : 'text'} slotProps={{ htmlInput: { maxLength: 4000, step: 'any' } }}>
            {parameter.type === 'select' && !parameter.required && <MenuItem value="">Not specified</MenuItem>}
            {parameter.type === 'select' && parameter.options?.map(option => <MenuItem key={option} value={option}>{option}</MenuItem>)}
        </TextField>;
    })}
</>;

export const WorkflowProposal: React.FC<{ turn: TextTurn; canvas?: boolean }> = ({ turn, canvas = false }) => {
    const proposal = turn.workflowDefinition!;
    const { definition } = proposal;
    const workspaceId = useSelector((state: DataFormulatorState) => state.activeWorkspace?.id);
    const readOnly = useSelector((state: DataFormulatorState) => state.activeWorkspace?.readOnly);
    const hasModel = useSelector((state: DataFormulatorState) => [...state.globalModels, ...state.models].some(model => model.id === state.selectedModelId));
    const busy = useSelector((state: DataFormulatorState) => state.textTurns.some(item => item.workflow?.status === 'running'));
    const [filename, setFilename] = useState(() => proposal.saved?.path
        || `${definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow'}.workflow.yaml`);
    const [saving, setSaving] = useState(false);
    const [starting, setStarting] = useState(false);
    const [saveOpen, setSaveOpen] = useState(false);
    const [workflowName, setWorkflowName] = useState(definition.name);
    const [saveError, setSaveError] = useState('');
    const [setupOpen, setSetupOpen] = useState(false);
    const [definitionView, setDefinitionView] = useState<'illustration' | 'yaml'>('illustration');
    const [values, setValues] = useState<WorkflowSetup['parameters']>(() => Object.fromEntries((definition.parameters || [])
        .map(parameter => [parameter.name, parameter.default ?? (parameter.type === 'boolean' ? false : '')])));
    const [instructions, setInstructions] = useState('');
    const [error, setError] = useState('');
    const generation = useRef(0);
    useEffect(() => { generation.current += 1; return () => { generation.current += 1; }; }, [workspaceId, turn.id]);
    const proseStyle = { fontSize: 'inherit', lineHeight: 1.5, '& p': { my: 0 }, '& ul, & ol': { pl: 2.5, my: 0.5 },
        '& h1, & h2, & h3, & h4': { fontSize: 'inherit', fontWeight: 600, mt: 1, mb: 0.5 },
        '& pre': { overflowX: 'auto', whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1.5, borderRadius: 1 },
        '& code': { fontFamily: 'var(--df-font-mono)', fontSize: '0.95em' }, '& a': { color: 'primary.main' } };
    const renderInput = (value: unknown): React.ReactNode => {
        if (Array.isArray(value) && value.every(item => item === null || typeof item !== 'object')) {
            return <Typography sx={{ fontSize: 'inherit', lineHeight: 1.5 }}>{value.map(item => String(item ?? 'Not specified')).join(', ')}</Typography>;
        }
        if (Array.isArray(value)) return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>{value.map((item, index) =>
            <Box key={index} sx={{ ...(index > 0 && typeof item === 'object' ? { borderTop: 1, borderColor: 'divider', pt: 1 } : {}) }}>{renderInput(item)}</Box>)}</Box>;
        if (value !== null && typeof value === 'object') return <Box component="dl" sx={{ m: 0 }}>
            {Object.entries(value).map(([key, item]) => <Box key={key} sx={{ py: 0.25, display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)', columnGap: 1.5 }}>
                <Typography component="dt" sx={{ fontSize: textVar.sm, color: 'text.secondary', textTransform: 'capitalize', lineHeight: 1.5 }}>{key.replace(/[_-]/g, ' ')}</Typography>
                <Box component="dd" sx={{ m: 0, minWidth: 0 }}>{renderInput(item)}</Box>
            </Box>)}
        </Box>;
        return <Box sx={proseStyle}><ReactMarkdown>{value == null ? 'Not specified' : String(value)}</ReactMarkdown></Box>;
    };
    const definitionSection = (label: string, children: React.ReactNode) => <Box component="section" sx={{ mt: 2 }}>
        <Typography component="h2" sx={{ fontSize: 'inherit', fontWeight: 600, mb: 0.5 }}>{label}</Typography>
        {children}
    </Box>;
    return <Box component="section" id={canvas ? 'vis-view-canvas' : undefined} aria-label="Workflow definition" sx={{
        py: canvas ? 0 : 1, minWidth: 0, overflowWrap: 'anywhere', width: '100%', boxSizing: 'border-box',
        fontFamily: theme => theme.typography.fontFamily, fontSize: 14, lineHeight: 1.5, letterSpacing: 0,
        ...(canvas ? { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.paper' } : {}),
    }}>
        <Box sx={{ px: canvas ? { xs: 2, sm: 3 } : 0, pt: canvas ? 2 : 0, flexShrink: 0 }}>
            <Box sx={{ width: '100%', maxWidth: 900, mx: 'auto' }}>
                <Typography component="h1" variant="h6" sx={{ fontWeight: 600, m: 0 }}>{definition.name}</Typography>
                <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary', mt: 0.25, mb: 0.5 }}>Workflow definition</Typography>
                <Tabs value={definitionView} onChange={(_, value) => setDefinitionView(value)} aria-label="Workflow definition view"
                    sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 36, px: 1.5, fontSize: textVar.sm, textTransform: 'none' } }}>
                    <Tab id={`workflow-illustration-${turn.id}`} aria-controls={`workflow-definition-view-${turn.id}`} value="illustration" label="Illustration" />
                    <Tab id={`workflow-yaml-${turn.id}`} aria-controls={`workflow-definition-view-${turn.id}`} value="yaml" label="YAML" />
                </Tabs>
            </Box>
        </Box>
        <Box data-workflow-definition-content role="tabpanel" id={`workflow-definition-view-${turn.id}`} aria-labelledby={`workflow-${definitionView}-${turn.id}`}
            sx={canvas ? { flex: 1, minHeight: 0, overflowY: 'auto', px: { xs: 2, sm: 3 }, pt: 2, pb: 2 } : { pt: 2 }}>
            <Box sx={{ width: '100%', maxWidth: 900, mx: 'auto', ...(definitionView === 'yaml' ? { height: canvas ? '100%' : 480, minHeight: 160 } : {}) }}>
                {definitionView === 'yaml' ? <MarkdownEditor fileName="definition.workflow.yaml" value={proposal.content} onChange={() => {}} readOnly showToolbar={false} lineWrap /> : <>
                <Box sx={{ ...proseStyle, color: 'text.secondary' }}><ReactMarkdown>{definition.overview}</ReactMarkdown></Box>
                {definition.prompt && definitionSection(definition.steps?.length ? 'Guidelines and rules' : 'Goal and method', <Box sx={proseStyle}><ReactMarkdown>{definition.prompt}</ReactMarkdown></Box>)}
                {definition.source != null && definitionSection('Inputs', renderInput(definition.source))}
                {!!definition.parameters?.length && definitionSection('Parameters',
                    <Box component="dl" sx={{ m: 0 }}>{definition.parameters.map(parameter => <Box key={parameter.name} sx={{ py: 0.75,
                        display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(130px, 1fr) minmax(0, 2fr)' }, columnGap: 2, rowGap: 0.25 }}>
                        <Typography component="dt" sx={{ fontSize: 'inherit', fontWeight: 500 }}>{parameter.label}
                            {parameter.required && <Box component="span" sx={{ ml: 0.75, fontSize: textVar.sm, color: 'text.secondary' }}>(required)</Box>}
                        </Typography>
                        <Box component="dd" sx={{ m: 0 }}>
                            {parameter.description && <Box sx={proseStyle}><ReactMarkdown>{parameter.description}</ReactMarkdown></Box>}
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, color: 'text.secondary' }}>
                                {parameter.default !== undefined && <Typography sx={{ fontSize: textVar.sm }}>Default: {String(parameter.default)}</Typography>}
                                {!!parameter.options?.length && <Typography sx={{ fontSize: textVar.sm }}>Options: {parameter.options.join(', ')}</Typography>}
                            </Box>
                        </Box>
                    </Box>)}</Box>
                )}
                {!!definition.steps?.length && definitionSection('Execution steps', <Box component="ol" sx={{ my: 0, pl: 2.5 }}>
                    {definition.steps.map(step => <Box component="li" key={step.id} sx={{ mb: 1 }}>
                        <Typography sx={{ fontSize: 'inherit', fontWeight: 500 }}>{step.description || step.id}</Typography>
                        <Box sx={proseStyle}><ReactMarkdown>{step.instructions}</ReactMarkdown></Box>
                        {!!step.checkers?.length && <Box component="ul" sx={{ my: 0.5, pl: 2.5, color: 'text.secondary' }}>
                            {step.checkers.map(check => <Box component="li" key={check.id} sx={proseStyle}>
                                <ReactMarkdown>{`${check.when === 'before' ? 'Before' : check.when === 'during' ? 'During' : 'After'}: ${check.condition}${check.on_fail ? ` (on failure: ${check.on_fail})` : ''}`}</ReactMarkdown>
                            </Box>)}
                        </Box>}
                        {step.next && <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary' }}>Next: {step.next}</Typography>}
                    </Box>)}
                </Box>)}
                {definitionSection('Deliverables', <Box component="ul" sx={{ my: 0, pl: 2.5 }}>{definition.deliverables.map((item, index) =>
                    <Box component="li" key={index} sx={proseStyle}><ReactMarkdown>{item}</ReactMarkdown></Box>)}</Box>)}
                </>}
                {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
            </Box>
        </Box>
        <Box role="group" aria-label="Workflow actions" sx={{ display: 'flex', justifyContent: 'center', flexShrink: 0, px: 2, pt: 1.5, pb: canvas ? 3 : 1, bgcolor: 'background.paper' }}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 0.5,
                px: 1, py: 0.5, borderRadius: '8px', border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
                <Button size="small" variant="text" startIcon={<SaveIcon />} disabled={saving}
                    sx={{ textTransform: 'none', flexShrink: 0, color: 'primary.main' }}
                    onClick={() => { setWorkflowName(definition.name); setSaveError(''); setSaveOpen(true); }}>Save workflow</Button>
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.75 }} />
                <Button size="small" variant="text" startIcon={<PlayArrowIcon />} disabled={busy || starting || readOnly || !workspaceId || !hasModel}
                    sx={{ textTransform: 'none', flexShrink: 0, color: 'text.secondary' }} onClick={() => setSetupOpen(true)}>Run workflow</Button>
            </Box>
        </Box>
        <Dialog open={saveOpen} onClose={() => !saving && setSaveOpen(false)} fullWidth maxWidth="sm" aria-labelledby={`workflow-save-${turn.id}`}>
            <Box component="form" onSubmit={async event => {
                    event.preventDefault();
                    if (saving || !filename.trim() || !workflowName.trim()) return;
                    const current = generation.current;
                    setSaving(true); setSaveError('');
                    try {
                        const name = workflowName.trim();
                        const content = name === definition.name ? proposal.content
                            : dumpYaml({ ...(loadYaml(proposal.content) as Record<string, unknown>), name }, { lineWidth: -1 });
                        const path = filename.trim();
                        const saved = await post<{ path: string; content_hash: string }>('save', { path, content,
                            ...(proposal.saved?.path === path ? { content_hash: proposal.saved.content_hash } : {}) });
                        if (current !== generation.current) return;
                        store.dispatch(dfActions.updateTextTurn({ id: turn.id, workflowDefinition: { ...proposal, content, definition: { ...definition, name }, saved } }));
                        setSaveOpen(false);
                        notifyWorkspaceFilesChanged();
                    } catch (reason) { if (current === generation.current) setSaveError(reason instanceof Error ? reason.message : 'Unable to save workflow.'); }
                    finally { if (current === generation.current) setSaving(false); }
            }}>
                <DialogTitle id={`workflow-save-${turn.id}`}>Save workflow</DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
                    {saveError && <Alert severity="error">{saveError}</Alert>}
                    <TextField autoFocus required label="Workflow name" size="small" value={workflowName} disabled={saving}
                        onChange={event => setWorkflowName(event.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
                    <TextField required label="Workflow filename" size="small" value={filename} disabled={saving}
                        onChange={event => setFilename(event.target.value)} slotProps={{ htmlInput: { pattern: '[^/\\\\]+\\.workflow\\.ya?ml' } }} />
                </DialogContent>
                <DialogActions><Button disabled={saving} onClick={() => setSaveOpen(false)}>Cancel</Button>
                    <Button type="submit" startIcon={<SaveIcon />} disabled={saving || !filename.trim() || !workflowName.trim()}>Save</Button></DialogActions>
            </Box>
        </Dialog>
        <Dialog open={setupOpen} onClose={() => !starting && setSetupOpen(false)} fullWidth maxWidth="sm" aria-labelledby={`workflow-setup-${turn.id}`}>
            <Box component="form" onSubmit={async event => {
                event.preventDefault();
                if (starting || busy || readOnly || !hasModel) return;
                const current = generation.current;
                const parameters = Object.fromEntries((definition.parameters || []).map(parameter => [parameter.name,
                    parameter.type === 'number' && values[parameter.name] !== '' ? Number(values[parameter.name]) : values[parameter.name]]));
                setStarting(true); setError('');
                try { await executeWorkflow({ content: proposal.content, setup: { parameters, instructions: instructions.trim() } }, () => setSetupOpen(false)); }
                catch (reason) { if (current === generation.current) { setError(reason instanceof Error ? reason.message : 'Unable to run workflow.'); setSetupOpen(false); } }
                finally { if (current === generation.current) setStarting(false); }
            }}>
                <DialogTitle id={`workflow-setup-${turn.id}`} sx={{ fontSize: textVar.xl, lineHeight: 1.5, fontWeight: 400, overflowWrap: 'anywhere', pb: 2 }}>
                    <Box component="span" sx={{ color: 'text.primary' }}>Run workflow:</Box>{' '}
                    <Box component="span" sx={{ color: 'primary.main' }}>{definition.name}</Box>
                </DialogTitle>
                <DialogContent sx={workflowSetupContentSx}>
                    <WorkflowSetupFields parameters={definition.parameters || []} values={values} onChange={setValues} disabled={starting} />
                    <TextField label="Additional instructions" size="small" multiline minRows={3} value={instructions} disabled={starting}
                        onChange={event => setInstructions(event.target.value)} slotProps={{ htmlInput: { maxLength: 8000 } }} />
                </DialogContent>
                <DialogActions sx={{ px: 3, py: 1.5, borderTop: 1, borderColor: 'divider' }}><Button disabled={starting} onClick={() => setSetupOpen(false)}>Cancel</Button>
                    <Button type="submit" startIcon={<PlayArrowIcon />} disabled={starting || busy || readOnly || !hasModel}>Run workflow</Button></DialogActions>
            </Box>
        </Dialog>
    </Box>;
};

export const WORKFLOW_AUTHORING_PROMPT = 'Help me create a workflow from our current conversation and data. Suggest a few useful directions for me to choose from before drafting it. Do not save or execute it yet.';

interface ScheduleConfig {
    name: string; workflow: string; model_id: string; time: string; timezone: string; weekdays: number[];
    enabled: boolean; auto_approve: boolean; max_retries: number; catch_up: boolean; publish: boolean; setup?: WorkflowSetup;
}
interface WorkflowSchedule {
    id: string; config: ScheduleConfig; next_at: string;
    history?: { id: string; scheduled_for: string; status: string; message: string; attempts: number }[];
}

const scheduleCadence = (config: ScheduleConfig) => {
    const days = [...config.weekdays].sort();
    const cadence = days.length === 7 ? 'Daily' : days.join() === '0,1,2,3,4' ? 'Weekdays'
        : days.map(day => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day]).join(', ');
    return `${cadence} at ${config.time}`;
};

const WorkflowSchedules: React.FC<{ items: Instance[]; onClose: () => void; initialSchedule?: WorkflowSchedule; startNew?: boolean;
    onOpenSession?: (id: string) => void | Promise<void> }> = ({ items, onClose, initialSchedule, startNew, onOpenSession }) => {
    const models = useSelector((state: DataFormulatorState) => state.globalModels);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const [schedules, setSchedules] = useState<WorkflowSchedule[]>([]);
    const [available, setAvailable] = useState(false);
    const [hosted, setHosted] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [identifier, setIdentifier] = useState(initialSchedule?.id || '');
    const [customDays, setCustomDays] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const emptyConfig = (): ScheduleConfig => ({ name: '', workflow: '', model_id: models.find(model => model.id === selectedModelId)?.id || models[0]?.id || '', time: '09:00',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, weekdays: [0, 1, 2, 3, 4, 5, 6], enabled: true,
        auto_approve: false, max_retries: 2, catch_up: false, publish: false });
    const [config, setConfig] = useState<ScheduleConfig>(() => initialSchedule ? { ...emptyConfig(), ...initialSchedule.config } : emptyConfig());
    const workflow = items.find(item => item.path === config.workflow);
    const repeat = customDays ? 'custom' : config.weekdays.length === 7 ? 'daily'
        : config.weekdays.length === 5 && [0, 1, 2, 3, 4].every(day => config.weekdays.includes(day)) ? 'weekdays' : 'custom';
    const current = schedules.find(schedule => schedule.id === identifier);
    const currentRuns = current?.history?.filter(run => run.status !== 'skipped') ?? [];
    const select = (schedule?: WorkflowSchedule) => {
        setIdentifier(schedule?.id || ''); setConfig(schedule ? { ...emptyConfig(), ...schedule.config } : emptyConfig());
        setCustomDays(false); setError('');
    };
    const refresh = async () => {
        const { data } = await apiRequest<{ available: boolean; hosted?: boolean; schedules: WorkflowSchedule[] }>('/api/schedules');
        setAvailable(data.available); setHosted(!!data.hosted); setSchedules(data.schedules);
        return data.schedules;
    };
    useEffect(() => {
        void refresh().then(list => { if (!initialSchedule && !startNew && list[0]) select(list[0]); })
            .catch(reason => setError(String(reason))).finally(() => setLoading(false));
    }, []);
    const persist = async (next: ScheduleConfig) => {
        const { data } = await apiRequest<{ schedule: WorkflowSchedule }>('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...(identifier ? { id: identifier } : {}), config: next }) });
        const list = await refresh();
        return list.find(schedule => schedule.id === data?.schedule?.id);
    };
    const act = async (action: () => Promise<void>, failure: string) => {
        setSaving(true); setError('');
        try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : failure); }
        finally { setSaving(false); }
    };
    return <><ListDetailDialog title="Schedules" listLabel="Schedule list" createLabel="New schedule" busy={saving} onClose={onClose} width={780} contentMaxWidth={460}
        selectedKey={identifier || null} onSelect={key => select(schedules.find(schedule => schedule.id === key))}
        items={schedules.map(schedule => ({ key: schedule.id, primary: schedule.config.name, secondary: scheduleCadence(schedule.config),
            muted: !schedule.config.enabled }))}
        onSubmit={event => {
            event.preventDefault();
            void act(async () => select(await persist(config)), 'Unable to save schedule.');
        }}
        footer={available && <>
            {current && <Button color="error" disabled={saving} sx={{ mr: 'auto' }} onClick={() => setConfirmDelete(true)}>Delete</Button>}
            {current && hosted && current.config.publish && <Button color="error" disabled={saving} onClick={() => void act(async () => {
                await apiRequest(`/api/schedules/${identifier}/publication`, { method: 'DELETE' });
                await refresh(); setConfig(previous => ({ ...previous, enabled: false, publish: false }));
            }, 'Unable to withdraw publication.')}>Unpublish</Button>}
            {current && <Button variant="outlined" disabled={saving} onClick={() => void act(async () => {
                const enabled = !current.config.enabled;
                await persist({ ...current.config, enabled });
                setConfig(previous => ({ ...previous, enabled }));
            }, 'Unable to update schedule.')}>{current.config.enabled ? 'Pause' : 'Resume'}</Button>}
            <Button type="submit" variant="contained" disableElevation
                disabled={saving || !config.weekdays.length || !config.model_id || !config.workflow || hosted && !config.publish}>Save schedule</Button>
        </>}>
                        {current && <Box>
                            <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
                                {current.config.enabled ? `Next run ${shortRunTime(current.next_at)}` : 'Paused'}</Typography>
                            {currentRuns.length > 0 && <RunList caption="Previous runs:" label={`Runs of ${current.config.name}`} limit={6} runs={currentRuns.map(run => ({
                                key: run.id, status: run.status, time: run.scheduled_for, disabled: !onOpenSession,
                                open: () => { void onOpenSession?.(`${hosted ? 'scheduled-private-' : 'scheduled-'}${run.id}`); onClose(); },
                            }))} />}
                        </Box>}
                        {error && <Alert severity="error">{error}</Alert>}
                        {loading ? <CircularProgress size={18} /> : !available ? <Alert severity="info">Scheduling is unavailable for this deployment or account.</Alert> : <>
                    <TextField size="small" select required label="Workflow" value={config.workflow} disabled={saving}
                        onChange={event => {
                            const selected = items.find(item => item.path === event.target.value);
                            setConfig({ ...config, workflow: event.target.value, name: !config.name || config.name === workflow?.name ? selected?.name || '' : config.name,
                                setup: { parameters: Object.fromEntries((selected?.parameters || []).flatMap(parameter => parameter.default === undefined ? [] : [[parameter.name, parameter.default]])), instructions: '' } });
                        }}>
                        {items.filter(item => !hosted || item.origin === 'demo' || item.origin === 'server').map(item => <MenuItem key={item.path} value={item.path}>{item.name}</MenuItem>)}
                    </TextField>
                    <TextField size="small" required label="Schedule name" value={config.name} disabled={saving}
                        onChange={event => setConfig({ ...config, name: event.target.value })} />
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 2 }}>
                        <TextField size="small" select label="Repeat" value={repeat} disabled={saving} onChange={event => {
                            setCustomDays(event.target.value === 'custom');
                            if (event.target.value !== 'custom') setConfig({ ...config,
                                weekdays: event.target.value === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4] });
                        }}>
                            <MenuItem value="daily">Every day</MenuItem>
                            <MenuItem value="weekdays">Weekdays</MenuItem>
                            <MenuItem value="custom">Custom days</MenuItem>
                        </TextField>
                        <TextField size="small" required type="time" label="Time" value={config.time} disabled={saving} helperText={config.timezone}
                            slotProps={{ inputLabel: { shrink: true } }} onChange={event => setConfig({ ...config, time: event.target.value })} />
                    </Box>
                    {repeat === 'custom' && <Box role="group" aria-label="Weekdays" sx={{ display: 'flex', flexWrap: 'wrap', mt: -1 }}>
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, index) => <FormControlLabel key={label} sx={{ mr: 1 }} label={label}
                            control={<Checkbox size="small" checked={config.weekdays.includes(index)} disabled={saving} onChange={event => setConfig({ ...config,
                                weekdays: event.target.checked ? [...config.weekdays, index].sort() : config.weekdays.filter(day => day !== index) })} />} />)}
                    </Box>}
                    {workflow && <>
                        <Divider><Typography variant="caption">Workflow inputs</Typography></Divider>
                        {!!workflow.parameters?.length && <WorkflowSetupFields parameters={workflow.parameters} values={config.setup?.parameters || {}} disabled={saving}
                            onChange={parameters => setConfig({ ...config, setup: { parameters, instructions: config.setup?.instructions || '' } })} />}
                        <TextField size="small" multiline minRows={2} label="Additional instructions" value={config.setup?.instructions || ''} disabled={saving}
                            onChange={event => setConfig({ ...config, setup: { parameters: config.setup?.parameters || {}, instructions: event.target.value } })} />
                    </>}
                    <Divider><Typography variant="caption">Run settings</Typography></Divider>
                    <TextField size="small" select required label="Server model connection" value={config.model_id} disabled={saving}
                        error={!config.model_id} helperText={!config.model_id ? 'Server model connection required.' : undefined}
                        onChange={event => setConfig({ ...config, model_id: event.target.value })}>
                        {models.map(model => <MenuItem key={model.id} value={model.id}>{model.model}</MenuItem>)}
                    </TextField>
                    <Box sx={{ display: 'flex', flexDirection: 'column', mt: -0.5,
                        '& .MuiFormControlLabel-root': { m: 0, gap: 0.5 }, '& .MuiCheckbox-root': { p: 0.5 } }}>
                        <FormControlLabel label="Run once after missed occurrences" control={<Checkbox size="small" checked={config.catch_up} disabled={saving} onChange={event => setConfig({ ...config, catch_up: event.target.checked })} />} />
                        <Tooltip describeChild title="Local terminal commands and single-option data loads only. Application policy still applies; questions and credentials pause the run.">
                            <FormControlLabel label="Auto-approve commands and data loads" control={<Checkbox size="small" checked={config.auto_approve} disabled={saving} onChange={event => setConfig({ ...config, auto_approve: event.target.checked })} />} />
                        </Tooltip>
                        {hosted && <FormControlLabel label="Publish final reports and all chart data for everyone to view" control={<Checkbox size="small" checked={config.publish} disabled={saving} onChange={event => setConfig({ ...config, publish: event.target.checked })} />} />}
                    </Box>
                </>}
    </ListDetailDialog>
    <Dialog open={confirmDelete} onClose={() => !saving && setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete schedule?</DialogTitle>
        <DialogContent>
            <Typography sx={{ overflowWrap: 'anywhere', mb: 1 }}>{current?.config.name}</Typography>
            <Typography variant="body2" color="text.secondary">Future runs stop. Sessions from past runs are kept.</Typography>
        </DialogContent>
        <DialogActions>
            <Button disabled={saving} onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button color="error" variant="contained" disableElevation disabled={saving} onClick={() => void act(async () => {
                await apiRequest(`/api/schedules/${identifier}`, { method: 'DELETE' });
                const list = await refresh();
                setConfirmDelete(false);
                select(list[0]);
            }, 'Unable to delete schedule.')}>Delete</Button>
        </DialogActions>
    </Dialog>
    </>;
};

const shortRunTime = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const runStatusDisplay = (value: string) => ({
    completed: { label: 'Completed', color: 'success.main', icon: <CheckCircleOutlineIcon /> },
    needs_attention: { label: 'Needs attention', color: 'warning.main', icon: <WarningAmberOutlinedIcon /> },
    paused: { label: 'Paused', color: 'warning.main', icon: <PauseIcon /> },
    failed: { label: 'Failed', color: 'error.main', icon: <ErrorOutlineIcon /> },
    retry: { label: 'Retrying', color: 'text.secondary', icon: <HistoryOutlinedIcon /> },
    running: { label: 'Running', color: 'primary.main', icon: <CircularProgress size={11} color="inherit" /> },
} as Record<string, { label: string; color: string; icon: React.ReactNode }>)[value]
    ?? { label: value.replaceAll('_', ' '), color: 'text.secondary', icon: <HistoryOutlinedIcon /> };


// Transform and shadow only, so hovering never reflows neighbouring cards.
const cardHoverSx = {
    transition: 'box-shadow 150ms ease, transform 150ms ease, border-color 150ms ease',
    '&:hover': { borderColor: 'rgba(0, 0, 0, 0.18)', boxShadow: '0 2px 8px rgba(32, 33, 36, 0.08)', transform: 'translateY(-1px)' },
    '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
} as const;

/** Filled background shared by run chips and the demo tag. */
const mutedChipBg = 'rgba(0, 0, 0, 0.045)';

/** The latest two runs, shown inside a card under its metadata; the panel lists the rest. */
const CardRuns: React.FC<{ label: string; runs: RunEntry[]; next?: NextRun }> = ({ label, runs, next }) =>
    <RunList label={label} runs={runs.slice(0, 2)} next={next} />;

/** Small filled chip that prefixes a card title (e.g. the schedule clock or the demo tag). */
const titleChipSx = { display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', mr: 0.75, px: 0.5, borderRadius: 0.5,
    bgcolor: mutedChipBg, color: 'text.secondary', fontSize: textVar.xxs, fontWeight: 400, lineHeight: 1.6 } as const;

/** A status icon plus run time, shown as a small filled chip that opens the run. */
const RunLink: React.FC<{ status: string; time: string; label?: string; disabled?: boolean; onOpen: () => void }> = ({ status, time, label, disabled, onOpen }) => {
    const display = runStatusDisplay(status);
    return <Tooltip title={display.label}>
        <ButtonBase disabled={disabled} aria-label={label ?? `${display.label}, ${shortRunTime(time)}`}
            onClick={event => { event.stopPropagation(); onOpen(); }}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0, px: 0.625,
                borderRadius: 0.5, bgcolor: mutedChipBg,
                fontSize: textVar.xs, lineHeight: 1.7, color: 'text.secondary',
                '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.09)', color: 'text.primary' },
                '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
            <Box component="span" role="img" aria-label={display.label}
                sx={{ display: 'inline-flex', color: display.color, '& .MuiSvgIcon-root': { fontSize: 13 } }}>{display.icon}</Box>
            <span>{shortRunTime(time)}</span>
        </ButtonBase>
    </Tooltip>;
};

/** The upcoming run (or paused state): same chip shape as a run, but dashed and inert; the cadence lives in its tooltip. */
const NextRunChip: React.FC<NextRun> = ({ time, cadence }) => {
    const state = time ? 'Next run' : 'Paused';
    return <Tooltip title={<>{state}<br />{cadence}</>}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0, px: 0.5,
            boxSizing: 'border-box', height: '1.7em', fontFamily: theme => theme.typography.fontFamily,
            borderRadius: 0.5, border: '1px dashed', borderColor: 'divider', fontSize: textVar.xs, lineHeight: 1, color: 'text.secondary' }}>
            <Box component="span" role="img" aria-label={`${state}, ${cadence}`} sx={{ display: 'inline-flex', '& .MuiSvgIcon-root': { fontSize: 13 } }}>
                {time ? <ScheduleOutlinedIcon /> : <PauseIcon />}</Box>
            <span>{time ? shortRunTime(time) : 'Paused'}</span>
        </Box>
    </Tooltip>;
};

type NextRun = { time?: string; cadence: string };

type RunEntry = { key: string; status: string; time: string; label?: string; disabled?: boolean; open: () => void };

/** Newest-first run chips; `(more)` reveals the rest in a scrollable area. */
const RunList: React.FC<{ label: string; runs: RunEntry[]; limit?: number; caption?: string; next?: NextRun }> = ({ label, runs, limit = 3, caption, next }) => {
    const [showAll, setShowAll] = useState(false);
    return <Box role="group" aria-label={label} sx={{ mt: 0.5,
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, ...(showAll ? { maxHeight: 160, overflowY: 'auto' } : {}) }}>
        {caption && <Typography component="span" sx={{ fontSize: textVar.xs, color: 'text.secondary', mr: 0.25 }}>{caption}</Typography>}
        {next && <NextRunChip {...next} />}
        {(showAll ? runs : runs.slice(0, limit)).map(run => <RunLink key={run.key} status={run.status} time={run.time}
            label={run.label} disabled={run.disabled} onOpen={run.open} />)}
        {runs.length > limit && <ButtonBase onClick={event => { event.stopPropagation(); setShowAll(previous => !previous); }}
            sx={{ fontSize: textVar.xs, lineHeight: 1.7, color: 'text.secondary', borderRadius: 0.5, '&:hover': { color: 'text.primary', textDecoration: 'underline' } }}>
            {showAll ? '(less)' : '(more)'}
        </ButtonBase>}
    </Box>;
};

const WorkflowScheduleSection: React.FC<{ items: Instance[]; busy: boolean; newScheduleOpen: boolean; onOpenSession?: (id: string) => void | Promise<void>;
    onChange: (value: { schedules: WorkflowSchedule[]; hosted: boolean; available: boolean }) => void }> = ({ items, busy, newScheduleOpen, onOpenSession, onChange }) => {
    const [schedules, setSchedules] = useState<WorkflowSchedule[]>([]);
    const [available, setAvailable] = useState(false);
    const [hosted, setHosted] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [open, setOpen] = useState(false);
    const [tick, setTick] = useState(0);
    const [selected, setSelected] = useState<WorkflowSchedule>();
    const openRun = (id: string) => void onOpenSession?.(`${hosted ? 'scheduled-private-' : 'scheduled-'}${id}`);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        void apiRequest<{ available: boolean; hosted?: boolean; schedules: WorkflowSchedule[] }>('/api/schedules').then(({ data }) => {
            if (!cancelled) {
                setAvailable(data.available); setSchedules(data.schedules || []); setHosted(!!data.hosted);
                onChange({ schedules: data.schedules || [], hosted: !!data.hosted, available: data.available });
            }
        }).catch(reason => {
            if (!cancelled) {
                setError(reason instanceof Error ? reason.message : 'Unable to load schedules.');
                onChange({ schedules: [], hosted: false, available: false });
            }
        }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [items, busy, open, newScheduleOpen, onChange, tick]);
    const anyOccurrenceActive = schedules.some(schedule => schedule.history?.some(run => run.status === 'running' || run.status === 'retry'));
    useEffect(() => {
        const onVisible = () => { if (document.visibilityState === 'visible') setTick(value => value + 1); };
        document.addEventListener('visibilitychange', onVisible);
        const timer = anyOccurrenceActive ? window.setInterval(() => setTick(value => value + 1), 10000) : undefined;
        return () => { document.removeEventListener('visibilitychange', onVisible); window.clearInterval(timer); };
    }, [anyOccurrenceActive]);
    return <Box component="section" aria-label="Schedules" sx={{ pb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, pt: 1, pb: 0.5, gap: 0.5 }}>
            <Typography sx={{ fontSize: textVar.xs, fontWeight: 600, color: 'text.secondary', flex: 1 }}>Schedules</Typography>
            {loading && !schedules.length && <CircularProgress size={12} />}
        </Box>
        <Box sx={{ mx: 0.75, display: 'grid', gap: 0.75 }}>
            {error ? <Alert severity="error" sx={{ fontSize: textVar.xs }}>{error}</Alert> : !loading && !schedules.length &&
                <Typography sx={{ px: 1, py: 0.75, fontSize: textVar.xs, color: 'text.secondary' }}>{available ? 'No schedules yet' : 'Scheduling unavailable'}</Typography>}
            {schedules.map(schedule => {
                const runs = schedule.history?.filter(run => run.status !== 'skipped') ?? [];
                const name = schedule.config.name;
                // The whole card opens the editor; the Edit button remains the keyboard-accessible target.
                return <React.Fragment key={schedule.id}><Box component="article" onClick={() => { setSelected(schedule); setOpen(true); }}
                    sx={{ px: 1, py: 0.75, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', cursor: 'pointer',
                        minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25, ...cardHoverSx }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ ...sidebarRowTitleSx, overflowWrap: 'anywhere',
                                color: schedule.config.enabled ? 'text.primary' : 'text.disabled' }}>
                                <Box component="span" sx={{ ...titleChipSx, py: 0.25 }}><ScheduleOutlinedIcon sx={{ fontSize: 12 }} /></Box>{name}</Typography>
                        </Box>
                        <Tooltip title="Edit schedule"><IconButton size="small" aria-label={`Edit schedule ${name}`} sx={sidebarRowActionSx}
                            onClick={event => { event.stopPropagation(); setSelected(schedule); setOpen(true); }}>
                            <EditIcon />
                        </IconButton></Tooltip>
                    </Box>
                    <CardRuns label={`Runs of schedule ${name}`}
                        next={{ time: schedule.config.enabled ? schedule.next_at : undefined, cadence: scheduleCadence(schedule.config) }} runs={runs.map((run, index) => ({
                        key: run.id, status: run.status, time: run.scheduled_for, disabled: !onOpenSession, open: () => openRun(run.id),
                        label: index === 0 ? `Open latest run for schedule ${name}` : `Open run ${shortRunTime(run.scheduled_for)} for schedule ${name}`,
                    }))} />
                </Box>
                </React.Fragment>;
            })}
        </Box>
        {open && <WorkflowSchedules items={items} initialSchedule={selected} onOpenSession={onOpenSession} onClose={() => setOpen(false)} />}
    </Box>;
};

export const WorkflowPanel: React.FC<{ onCreateSession: (name: string) => void; onOpenSession?: (id: string) => void | Promise<void>; headerActions?: React.ReactNode;
    presentation?: 'sidebar' | 'landing';
    renderLanding?: (content: { examples: React.ReactNode; saved: React.ReactNode; toolbar: React.ReactNode }) => React.ReactNode;
}> = ({ onCreateSession, onOpenSession, headerActions, presentation = 'sidebar', renderLanding }) => {
    const landing = presentation === 'landing';
    const canSchedule = useSelector((state: DataFormulatorState) => state.serverConfig?.IS_LOCAL_MODE || state.serverConfig?.CAN_CONFIGURE);
    const [schedulesOpen, setSchedulesOpen] = useState<false | 'new' | 'browse'>(false);
    const [scheduleLibrary, setScheduleLibrary] = useState<{ schedules: WorkflowSchedule[]; hosted: boolean; available: boolean }>({ schedules: [], hosted: false, available: false });
    const model = useSelector((state: DataFormulatorState) => [...state.globalModels, ...state.models]
        .find(item => item.id === state.selectedModelId));
    const workspaceId = useSelector((state: DataFormulatorState) => state.activeWorkspace?.id);
    const inSession = useSelector(dfSelectors.selectInSession);
    const readOnly = useSelector((state: DataFormulatorState) => state.activeWorkspace?.readOnly);
    const [items, setItems] = useState<Instance[]>([]);
    const [runs, setRuns] = useState<Run[]>([]);
    const busy = useSelector((state: DataFormulatorState) => state.textTurns.some(turn => turn.workflow?.status === 'running'));
    const [loading, setLoading] = useState(false);
    const [editor, setEditor] = useState<{ path: string; content: string; content_hash?: string; creating?: boolean; source?: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<Instance | null>(null);
    const [deletingInstance, setDeletingInstance] = useState(false);
    const [runTarget, setRunTarget] = useState<Instance | null>(null);
    const [setupValues, setSetupValues] = useState<Record<string, string | number | boolean>>({});
    const [setupInstructions, setSetupInstructions] = useState('');
    const [starting, setStarting] = useState(false);
    const [pendingRun, setPendingRun] = useState<{ path: string; content?: string; setup: WorkflowSetup; previousWorkspaceId?: string } | null>(null);
    const generation = useRef(0);

    const refresh = async (quiet = false) => {
        const current = generation.current;
        if (!quiet) setLoading(true);
        try {
            const result = await post<{ items: Instance[]; runs: Run[] }>('list');
            if (current === generation.current) { setItems(result.items); setRuns(result.runs); }
        } catch (reason) { if (current === generation.current && !quiet) handleApiError(reason, 'Load workflows'); }
        finally { if (current === generation.current && !quiet) setLoading(false); }
    };

    useEffect(() => {
        generation.current += 1;
        setItems([]); setRuns([]);
        setDeleteTarget(null); setDeletingInstance(false);
        setRunTarget(null);
        setSaving(false);
        void refresh();
        return () => { generation.current += 1; };
    }, [workspaceId]);

    // Run status changes server-side, so refresh when a run ends, the tab returns, or while any run is active.
    const wasBusy = useRef(busy);
    const anyRunActive = runs.some(run => run.status === 'running');
    useEffect(() => {
        if (wasBusy.current && !busy) void refresh(true);
        wasBusy.current = busy;
    }, [busy]);
    useEffect(() => {
        const onVisible = () => { if (document.visibilityState === 'visible') void refresh(true); };
        document.addEventListener('visibilitychange', onVisible);
        const timer = anyRunActive ? window.setInterval(() => void refresh(true), 10000) : undefined;
        return () => { document.removeEventListener('visibilitychange', onVisible); window.clearInterval(timer); };
    }, [workspaceId, anyRunActive]);

    const edit = async (item: Instance) => {
        const current = generation.current;
        try {
            const result = await post<{ content: string; content_hash?: string }>('read', { path: item.path });
            if (current !== generation.current) return;
            let path = item.path;
            if (item.origin === 'demo' || item.origin === 'server') {
                const stem = item.path.replace(/^(demo|server)\//, '').replace(/\.yaml$/, '');
                path = `${stem}-copy.yaml`;
                let suffix = 2;
                while (items.some(existing => existing.path === path)) path = `${stem}-copy-${suffix++}.yaml`;
            }
            setEditor({ path, content: result.content ?? '', content_hash: path === item.path ? result.content_hash : undefined, source: item.path });
        }
        catch (reason) { handleApiError(reason, 'Read workflow'); }
    };

    const execute = async (path: string, setup: WorkflowSetup, content?: string) => {
        if (!model || busy || readOnly) return;
        const current = generation.current;
        setStarting(true);
        try {
            await executeWorkflow({ path, setup, ...(content ? { content } : {}) }, () => {
                setRunTarget(null);
                store.dispatch(dfActions.setDataSourceSidebarOpen(false));
            });
        } catch (reason) { if (current === generation.current) handleApiError(reason, 'Workflow execution'); }
        finally {
            setStarting(false);
            if (current === generation.current) void refresh();
        }
    };

    const startNewSession = async (item: Instance, setup: WorkflowSetup) => {
        setStarting(true);
        try {
            setPendingRun({ path: item.path, content: item.content, setup, previousWorkspaceId: workspaceId });
            onCreateSession(item.name);
            const nextWorkspaceId = store.getState().activeWorkspace?.id;
            if (nextWorkspaceId && nextWorkspaceId !== workspaceId) {
                setPendingRun(null);
                await execute(item.path, setup, item.content);
            }
        }
        catch (reason) {
            setPendingRun(null); setStarting(false);
            handleApiError(reason, 'Create workflow session');
        }
    };

    useEffect(() => {
        if (workspaceId && pendingRun && workspaceId !== pendingRun.previousWorkspaceId) {
            setPendingRun(null);
            void execute(pendingRun.path, pendingRun.setup, pendingRun.content);
        }
    }, [workspaceId, pendingRun]);

    const openRun = async (item: Run) => {
        try {
            const { run } = await post<{ run: Run }>('run-state', { run_id: item.id });
            if (workspaceId) {
                deletedWorkflowRuns.delete(`${workspaceId}/${run.id}`);
                await publishWorkflowRun(run, workspaceId);
            }
            store.dispatch(dfActions.setFocused({ type: 'text', textId: `textTurn-workflow-${run.id}` }));
            store.dispatch(dfActions.setDataSourceSidebarOpen(false));
        } catch (reason) { handleApiError(reason, 'Open workflow run'); }
    };
    const openRunSession = onOpenSession ? async (id: string) => {
        await onOpenSession(id);
        store.dispatch(dfActions.setDataSourceSidebarOpen(false));
    } : undefined;

    const createWorkflow = () => {
        let path = 'workflow.workflow.yaml';
        let suffix = 2;
        while (items.some(item => item.path === path)) path = `workflow-${suffix++}.workflow.yaml`;
        setEditor({ path, content: '', creating: true });
    };
    const editorItem = editor && !editor.creating ? items.find(item => item.path === editor.source) : undefined;
    const workflowRunsFor = (item: Instance, beforeOpen?: () => void): RunEntry[] => [
        ...runs.filter(run => run.workflow_path === item.path || !run.workflow_path && run.name === item.name
            && items.filter(candidate => candidate.name === item.name).length === 1)
            .map(run => ({ key: run.id, status: run.status, time: run.started_at, disabled: busy, open: () => { beforeOpen?.(); void openRun(run); } })),
        ...(openRunSession ? scheduleLibrary.schedules.filter(schedule => schedule.config.workflow === item.path)
            .flatMap(schedule => (schedule.history || []).filter(run => run.status !== 'skipped'))
            .map(run => ({ key: `scheduled-${run.id}`, status: run.status, time: run.scheduled_for,
                open: () => { beforeOpen?.(); void openRunSession(`${scheduleLibrary.hosted ? 'scheduled-private-' : 'scheduled-'}${run.id}`); } })) : []),
    ].sort((left, right) => Date.parse(right.time) - Date.parse(left.time));
    const editorRuns = editorItem ? workflowRunsFor(editorItem, () => setEditor(null)) : [];

    const toolbar = <Box sx={{ ...sidebarToolbarSx, flexWrap: 'wrap', ...(landing ? { p: 0, borderBottom: 0, bgcolor: 'transparent' } : {}) }}>
            <Button variant="outlined" size="small" startIcon={<AddIcon />} disabled={readOnly} sx={sidebarPrimaryActionSx}
                onClick={createWorkflow}>
                New workflow
            </Button>
            {!landing && canSchedule && <Button variant="outlined" size="small" startIcon={<AddIcon />}
                disabled={!scheduleLibrary.available} sx={sidebarPrimaryActionSx} onClick={() => setSchedulesOpen('new')}>
                New schedule
            </Button>}
            {!landing && <Box sx={{ flex: 1 }} />}
            {landing && canSchedule && <Tooltip title="Workflow schedules"><IconButton aria-label="Workflow schedules" size="small" onClick={() => setSchedulesOpen('browse')}>
                <ScheduleOutlinedIcon sx={{ fontSize: iconVar.md }} />
            </IconButton></Tooltip>}
            <Tooltip title="Refresh workflows"><span><IconButton aria-label="Refresh workflows" size="small" disabled={loading} onClick={() => void refresh()}
                sx={{ width: 24, height: 24, p: 0, color: 'text.secondary', '&:hover': { color: 'text.primary', bgcolor: 'action.hover' } }}>
                {loading ? <CircularProgress size={16} /> : <RefreshIcon sx={{ fontSize: iconVar.md }} />}
            </IconButton></span></Tooltip>
        </Box>;
    const renderGroups = (groupIds: readonly ('demo' | 'user' | 'server' | 'all')[]) => groupIds.map(groupId => {
            const group = items.filter(item => landing ? (item.origin || 'user') === groupId
                : true).sort((left, right) => Number((right.origin || 'user') === 'user') - Number((left.origin || 'user') === 'user'));
            if (groupId === 'server' && !group.length) return null;
            const label = landing ? groupId === 'demo' ? 'Example workflows' : groupId === 'user' ? 'Your workflows' : 'Shared workflows'
                : 'Workflows';
            return <Box component="section" aria-label={label} key={groupId} sx={landing ? {
                minWidth: 0, pt: groupId === 'server' || (!renderLanding && groupId === 'user') ? 1.5 : 0,
            } : {}}>
            {(!landing || groupId === 'server' || (!renderLanding && groupId === 'user')) && (
            <Box sx={landing ? { display: 'flex', alignItems: 'center', gap: 1, minHeight: 32, mb: 1 } : {}}>
            <Typography sx={landing ? { flex: 1, fontSize: textVar.sm, color: 'text.secondary', textAlign: 'left' }
                : { px: 1.5, pt: groupId === 'user' ? 1 : 1.5, pb: 0.5, fontSize: textVar.xs, fontWeight: 600, color: 'text.secondary' }}>{label}</Typography>
            {landing && groupId === 'user' && toolbar}
            </Box>
            )}
            {landing && groupId === 'demo' && !model && <Alert severity="info" sx={{ mb: 1 }}>Select a model to run a workflow.</Alert>}
            <Box id={`workflow-${presentation}-group-${groupId}`} sx={{ mx: landing ? 0 : 0.75, display: 'grid', gap: landing ? 1 : 0.75,
                ...(landing ? { gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))' } : {}) }}>
        {!group.length && <Typography sx={{ px: 1, py: 0.75, fontSize: textVar.xs, color: 'text.secondary' }}>
            {loading ? 'Loading workflows...' : 'No saved workflows'}
        </Typography>}
        {group.map(item => {
            const origin = item.origin || 'user';
            const runDisabled = busy || starting || readOnly || !!item.error;
            const cardRuns = landing ? [] : workflowRunsFor(item);
            const openSetup = () => {
                setSetupValues(Object.fromEntries((item.parameters || []).map(parameter => [parameter.name,
                    parameter.default ?? (parameter.type === 'boolean' ? false : '')])));
                setSetupInstructions('');
                setRunTarget(item);
            };
            return <React.Fragment key={item.path}><Box component="article" sx={{ px: 1, py: 0.75, border: 1, borderColor: 'divider', bgcolor: 'background.paper', borderRadius: 1, minWidth: 0, ...cardHoverSx,
                ...(landing ? { p: 0, display: 'flex', position: 'relative', border: '1px solid rgba(0, 0, 0, 0.18)', borderRadius: 1, bgcolor: 'background.paper',
                    boxShadow: '0 1px 3px rgba(32, 33, 36, 0.06)' } : {}),
                '& .workflow-secondary-action': { opacity: 0 },
                '&:hover .workflow-secondary-action, &:focus-within .workflow-secondary-action': { opacity: 1 },
                '@media (hover: none)': { '& .workflow-secondary-action': { opacity: 1 } } }}>
            <Box sx={{ display: landing ? 'contents' : 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'start', columnGap: 0.5 }}>
            <Tooltip title={!landing && !item.error ? item.overview || '' : ''} placement="right" enterDelay={600}>
            <ButtonBase aria-label={`${landing ? 'Run' : 'Open'} ${item.name}`}
                    disabled={landing && runDisabled}
                    onClick={landing ? openSetup : () => void edit(item)}
                    sx={{ display: 'block', width: '100%', minWidth: 0, textAlign: 'left', py: 0.25,
                        ...(landing ? { p: 1.25, flex: 1, borderRadius: 'inherit', '&.Mui-disabled': { opacity: 0.6 } } : { gridColumn: '1 / -1', gridRow: 1 }),
                        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pr: landing ? (origin === 'user' ? 2.5 : 0) : 3 }}>
                    {landing && <WorkflowGears running={false} size={16} color="text.secondary" showTooltip={false} />}
                    <Typography sx={{ fontSize: landing ? textVar.md : textVar.sm, fontWeight: landing ? 400 : 500, lineHeight: 1.4, minWidth: 0, overflowWrap: 'anywhere' }}>
                        {!landing && origin === 'demo' && <Box component="span" sx={titleChipSx}>demo</Box>}
                        {item.name}
                    </Typography>
                    {landing && <PlayArrowIcon sx={{ ml: 'auto', flexShrink: 0, fontSize: iconVar.md, color: runDisabled ? 'action.disabled' : 'primary.main' }} />}
                </Box>
                {(item.error || (landing && item.overview)) && <Typography sx={{ mt: 0.25, fontSize: textVar.xs, lineHeight: 1.5,
                    color: item.error ? 'error.main' : 'text.secondary', overflowWrap: 'anywhere',
                    ...(!item.error ? {
                        ...(landing ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } : { whiteSpace: 'nowrap', textOverflow: 'ellipsis' }),
                        overflow: 'hidden',
                    } : {}) }}>{item.error || item.overview}</Typography>}
            </ButtonBase>
            </Tooltip>
            {!landing && <>
            <Box component="span" sx={{ gridColumn: 2, gridRow: 1, position: 'relative', zIndex: 1, display: 'flex' }}>
                <Tooltip title="Run workflow"><span><IconButton aria-label={`Run ${item.name}`} size="small" disabled={runDisabled}
                    sx={sidebarRowActionSx}
                    onClick={openSetup}><PlayArrowIcon /></IconButton></span></Tooltip>
            </Box>
            {cardRuns.length > 0 && <Box sx={{ gridColumn: '1 / -1' }}><CardRuns label={`Previous runs of ${item.name}`} runs={cardRuns} /></Box>}
            </>}
            </Box>
            {landing && origin === 'user' && <Box className="workflow-secondary-action" sx={{ position: 'absolute', top: 4, right: 4 }}>
                <ArtifactDeleteButton label={`Delete ${item.path}`} disabled={busy || deletingInstance}
                    onClick={() => setDeleteTarget(item)} />
            </Box>}
        </Box>
        </React.Fragment>;
        })}</Box></Box>;
        });
    return <Box sx={{ display: landing ? 'contents' : 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, flex: '0 1 auto', overflow: landing ? 'visible' : 'hidden' }}>
        {landing && renderLanding ? renderLanding({ examples: renderGroups(['demo']), saved: renderGroups(['user', 'server']), toolbar }) : <>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', px: 1.5, height: 40, minHeight: 40, boxSizing: 'border-box',
            flexShrink: 0, borderBottom: '1px solid rgba(0, 0, 0, 0.16)', bgcolor: 'rgba(255, 255, 255, 0.76)',
            ...(landing ? { px: 0, borderBottom: 0, bgcolor: 'transparent' } : {}) }}>
            <Typography component={landing ? 'h2' : 'div'} sx={{ fontSize: landing ? textVar.xl : textVar.md, fontWeight: landing ? 400 : 600, flex: 1, textAlign: 'left' }}>{landing ? 'Example workflows' : 'Workflows'}</Typography>
            {headerActions}
        </Box>
        {!landing && toolbar}
        <Box sx={{ overflowY: landing ? 'visible' : 'auto', minHeight: 0, pb: 1 }}>
        {!landing && canSchedule && <WorkflowScheduleSection items={items} busy={busy} newScheduleOpen={!!schedulesOpen} onChange={setScheduleLibrary} onOpenSession={openRunSession} />}
        {!landing && !model && <Alert severity="info" sx={{ mx: 1, mb: 1 }}>Select a model to run a workflow.</Alert>}
        {renderGroups(landing ? ['demo', 'user', 'server'] : ['all'])}
        </Box>
        </>}

        {schedulesOpen && <WorkflowSchedules items={items} startNew={schedulesOpen === 'new'} onOpenSession={openRunSession} onClose={() => setSchedulesOpen(false)} />}
        <Dialog open={!!runTarget} onClose={() => !starting && setRunTarget(null)} maxWidth="sm" fullWidth aria-labelledby="workflow-setup-title">
            <Box component="form" onSubmit={event => {
                event.preventDefault();
                if (!runTarget || busy || starting || !model) return;
                const parameters = Object.fromEntries((runTarget.parameters || []).flatMap(parameter => {
                    const value = setupValues[parameter.name];
                    if (value === undefined) return [];
                    return [[parameter.name, parameter.type === 'number' && value !== '' ? Number(value) : value]];
                }));
                const setup = { parameters, instructions: setupInstructions.trim() };
                const target = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
                if (target?.value === 'current' && inSession) void execute(runTarget.path, setup, runTarget.content);
                else startNewSession(runTarget, setup);
            }}>
                <DialogTitle id="workflow-setup-title" sx={{ fontSize: textVar.xl, lineHeight: 1.5, fontWeight: 400, overflowWrap: 'anywhere', pb: 2 }}>
                    <Box component="span" sx={{ color: 'text.primary' }}>Run workflow:</Box>{' '}
                    <Box component="span" sx={{ color: 'primary.main' }}>{runTarget?.name}</Box>
                </DialogTitle>
                <DialogContent sx={workflowSetupContentSx}>
                    {!model && <Alert severity="info">Select a model to run a workflow.</Alert>}
                    {runTarget?.overview && <Typography variant="body2" color="text.secondary" sx={{ fontSize: textVar.sm, lineHeight: 1.65, overflowWrap: 'anywhere', mb: 0.5 }}>{runTarget.overview}</Typography>}
                    <WorkflowSetupFields parameters={runTarget?.parameters || []} values={setupValues} onChange={setSetupValues} disabled={starting} />
                    <TextField label="Additional instructions" size="small" multiline minRows={3} fullWidth disabled={starting}
                        value={setupInstructions} onChange={event => setSetupInstructions(event.target.value)} slotProps={{ htmlInput: { maxLength: 8000 } }} />
                </DialogContent>
                <DialogActions sx={{ flexWrap: 'wrap', gap: 0.5, px: 3, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
                    <Button disabled={starting} onClick={() => setRunTarget(null)}>Cancel</Button>
                    {inSession && <Button type="submit" value="current" disabled={busy || starting || !model}>Current session</Button>}
                    <Button type="submit" value="new" variant="contained" startIcon={starting ? <CircularProgress size={16} /> : <PlayArrowIcon />}
                        disabled={busy || starting || !model}>New session</Button>
                </DialogActions>
            </Box>
        </Dialog>

        <Dialog open={!!deleteTarget} onClose={() => !deletingInstance && setDeleteTarget(null)} maxWidth="xs" fullWidth>
            <DialogTitle>Delete workflow?</DialogTitle>
            <DialogContent>
                <Typography sx={{ overflowWrap: 'anywhere', mb: 1 }}>{deleteTarget?.path}</Typography>
                <Typography variant="body2">Past runs and generated artifacts will be kept.</Typography>
            </DialogContent>
            <DialogActions>
                <Button disabled={deletingInstance} onClick={() => setDeleteTarget(null)}>Cancel</Button>
                <Button color="error" startIcon={<DeleteOutlineIcon />} disabled={deletingInstance || busy} onClick={async () => {
                    if (!deleteTarget || deletingInstance) return;
                    const current = generation.current;
                    const path = deleteTarget.path;
                    setDeletingInstance(true);
                    try {
                        await post('delete', { path });
                        if (current !== generation.current) return;
                        setItems(previous => previous.filter(item => item.path !== path));
                        setEditor(previous => previous?.source === path ? null : previous);
                        setDeleteTarget(null);
                    } catch (reason) { if (current === generation.current) handleApiError(reason, 'Delete workflow'); }
                    finally { if (current === generation.current) setDeletingInstance(false); }
                }}>Delete</Button>
            </DialogActions>
        </Dialog>

        {editor && <ListDetailDialog title="Workflows" listLabel="Workflow list" createLabel="New workflow" busy={saving} onClose={() => setEditor(null)} fillHeight
            selectedKey={editor.creating ? null : editor.source ?? null}
            onSelect={key => { const item = items.find(candidate => candidate.path === key); if (item) void edit(item); else createWorkflow(); }}
            items={[...items].sort((left, right) => Number((right.origin || 'user') === 'user') - Number((left.origin || 'user') === 'user'))
                .map(item => ({ key: item.path, primary: item.name,
                    secondary: item.origin === 'demo' ? 'demo' : item.origin === 'server' ? 'shared' : item.path }))}
            footer={<>
                {!editor.creating && (editorItem?.origin || 'user') === 'user' && editorItem && <Button color="error"
                    aria-label={`Delete ${editorItem.path}`} disabled={saving || busy || deletingInstance} sx={{ mr: 'auto' }}
                    onClick={() => setDeleteTarget(editorItem)}>Delete</Button>}
                {editor.creating && <Tooltip title={!model ? 'Select a model to create a workflow with the agent.'
                    : !workspaceId ? 'Start a new session and create a workflow with the agent.'
                    : busy ? 'Wait for the running workflow to pause or finish.'
                    : 'Discuss your goal in chat and review a suggested workflow.'}>
                    <Box component="span">
                    <Button variant="outlined" disabled={saving || !model || readOnly || busy}
                        sx={{ textTransform: 'none' }} onClick={() => {
                            if (!workspaceId) onCreateSession('Create a workflow');
                            setEditor(null);
                            store.dispatch(dfActions.queueAnalystTask({ text: WORKFLOW_AUTHORING_PROMPT,
                                images: [], attachments: [], intent: 'workflow-authoring' }));
                            store.dispatch(dfActions.setDataSourceSidebarOpen(false));
                        }}>Create with agent</Button>
                    </Box>
                </Tooltip>}
                <Button variant="contained" disableElevation disabled={saving || !editor.content.trim() || !editor.path.trim()} onClick={async () => {
                    const path = editor.path.trim();
                    setSaving(true);
                    try {
                        const saved = await post<{ path: string; content_hash?: string }>('save', { path, content: editor.content, content_hash: editor.content_hash });
                        setEditor(previous => previous && ({ ...previous, path, creating: false, source: path, content_hash: saved?.content_hash }));
                        await refresh();
                    } catch (reason) { handleApiError(reason, 'Save workflow'); }
                    finally { setSaving(false); }
                }}>Save</Button>
            </>}>
            <Box>
                <Typography sx={{ fontSize: textVar.lg, fontWeight: 500, overflowWrap: 'anywhere' }}>
                    {editor.creating ? 'New workflow' : editorItem?.name ?? editor.path}</Typography>
                {editorRuns.length > 0 && <RunList caption="Previous runs:" label={`Runs of ${editorItem?.name}`} limit={6} runs={editorRuns} />}
            </Box>
            <TextField size="small" label="Workflow filename" disabled={saving} value={editor.path}
                onChange={event => setEditor(previous => previous && ({ ...previous, path: event.target.value, content_hash: undefined }))} />
            <Box sx={{ flex: 1, minHeight: 240, overflow: 'hidden', border: 1, borderColor: 'divider' }}>
                <MarkdownEditor fileName="workflow.yaml" value={editor.content} readOnly={saving}
                    placeholder="Paste workflow YAML here..."
                    onChange={content => setEditor(previous => previous && ({ ...previous, content }))} />
            </Box>
        </ListDetailDialog>}

    </Box>;
};