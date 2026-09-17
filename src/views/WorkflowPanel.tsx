import { ShimmerText, WorkflowGears } from '../components/FunComponents';
import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
    IconButton, TextField, Tooltip, Typography, useTheme } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import QuestionAnswerOutlinedIcon from '@mui/icons-material/QuestionAnswerOutlined';
import { ArtifactDeleteButton, ThreadArtifactCard } from './DataThreadCards';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TerminalIcon from '@mui/icons-material/Terminal';
import { ApiRequestError, apiRequest, streamRequest } from '../app/apiClient';
import { handleApiError } from '../app/errorHandler';
import { getUrls, resolveRecommendedChart } from '../app/utils';
import { DataFormulatorState, dfActions, dfSelectors, generateFreshChart } from '../app/dfSlice';
import { store } from '../app/store';
import { buildDictTableFromWorkspace } from '../app/tableThunks';
import { notifyWorkspaceFilesChanged } from '../app/workspaceService';
import { createConversationRootId, createDictTable, computeInsightKey, FieldItem, TextTurn, ClarificationResponse } from '../components/ComponentType';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { textVar, iconVar } from '../app/layout';
import { TerminalApprovalDialog, TerminalProposal } from '../components/TerminalApprovalDialog';
import { ConnectorFormCard } from '../components/ConnectorFormCard';
import { parseDataOperation } from '../dataOperations/models';
import { ClarificationPanel, FailedDraftPanel } from './AgentPausePanel';
import { formatClarificationResponses, normalizeClarifyEvent } from '../app/clarification';

interface Instance { path: string; name: string; overview?: string; error?: string; origin?: 'user' | 'demo' }
export interface Run {
    activity?: string;
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
    name?: string; instance?: { name: string; steps?: { id: string; description?: string; instructions: string; next?: string;
        checkers?: { id: string; condition?: string; when?: 'before' | 'during' | 'after'; on_fail?: string }[] }[] }; report?: string; calls?: number; tool_calls?: number;
    checks?: Record<string, { status: string; explanation: string; evidence_ids: string[] }>;
    evidence?: Record<string, { tool: string; text: string; call?: number; step_id?: string; plan_revision?: number }>;
    transitions?: { from: string; to: string; reason: string; plan_revision?: number }[];
    artifacts?: string[];
    terminal_request?: TerminalProposal;
    interaction?: { call_id: string; questions?: unknown[]; data_operation?: unknown; form?: {
        kind: string; title: string; connector?: { source_type: string; prefilled?: Record<string, string> };
    } };
    visited?: string[];
    outputs?: { id: string; version?: string; type: string; tool?: string; stdout?: string; content?: any; input_sources?: { id: string; kind: 'data' | 'file'; display_name?: string }[] }[];
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

export async function publishWorkflowRun(run: Run, workspaceId: string) {
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
    store.dispatch(dfActions.addTextTurn({
        kind: 'text', id: turnId, displayId: turnId, textKind: 'explain',
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
            planRevision: run.plan_revision || 0, planReviewPending: run.plan_review_pending || false,
            activity: run.activity,
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
    }));
    if (!existing) {
        store.dispatch(dfActions.setFocused({ type: 'text', textId: turnId }));
        store.dispatch(dfActions.setViewMode('editor'));
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
            if (!dfSelectors.getAllCharts(store.getState()).some(item => item.id === chart.id)) store.dispatch(dfActions.addChart(chart));
            store.dispatch(dfActions.setFocused({ type: 'chart', chartId: chart.id }));
            store.dispatch(dfActions.setViewMode('editor'));
        } else if (output.type === 'report') {
            const reportId = `workflow-report-${run.id}`;
            store.dispatch(dfActions.saveGeneratedReport({ id: reportId, content: output.content,
                title: run.instance?.name, parentNodeId: store.getState().generatedReports.find(report => report.id === reportId)?.parentNodeId
                    || outputParent(reportId), createdAt, status: 'completed',
                selectedChartIds: (run.outputs || []).filter(item => item.type === 'result').map(item => item.content.result.chart_id) }));
            store.dispatch(dfActions.setFocused({ type: 'report', reportId }));
            store.dispatch(dfActions.setViewMode('report'));
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
    if (run.status === 'paused' && (existing?.workflow?.status !== 'paused' || existing.workflow.calls !== run.calls)) {
        store.dispatch(dfActions.setFocused({ type: 'text', textId: turnId }));
        store.dispatch(dfActions.setViewMode('editor'));
    }
}

const executions = new Map<string, AbortController>();

export function selectChatWorkflow(state: DataFormulatorState): TextTurn | undefined {
    const active = state.textTurns.filter(turn => turn.workflow && ['running', 'paused'].includes(turn.workflow.status));
    const running = active.filter(turn => turn.workflow!.status === 'running');
    if (running.length) return running[running.length - 1];
    const focus = state.focusedId;
    const nodeId = focus?.type === 'text' ? focus.textId : focus?.type === 'chart'
        ? dfSelectors.getAllCharts(state).find(chart => chart.id === focus.chartId)?.tableRef
        : focus?.type === 'table' ? focus.tableId : focus?.type === 'report' ? focus.reportId
        : focus?.type === 'file' ? state.fileNodes.find(file => file.path === focus.fileName)?.id
        : focus?.type === 'reference' ? focus.referenceId : undefined;
    let currentId = nodeId;
    const seen = new Set<string>();
    while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        const owner = active.find(turn => turn.id === currentId || turn.outputIds?.includes(currentId!));
        if (owner) return owner;
        currentId = state.textTurns.find(turn => turn.id === currentId)?.parentNodeId
            || state.loadedTableNodes.find(node => node.id === currentId)?.parentNodeId;
    }
    return undefined;
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
    path?: string; run_id?: string; reply?: string;
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
                latest = { ...latest, status: 'paused', message: 'Connection interrupted. Execution status could not be confirmed. Review and retry to reconnect.' };
                controller.abort();
                await publishWorkflowRun(latest, workspaceId);
                return;
            }
        }
        if (monitoring) healthTimer = setTimeout(checkExecution, 5000);
    };
    healthTimer = setTimeout(checkExecution, 5000);
    try {
        for await (const event of streamRequest('/api/workflows/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, model }) }, controller.signal)) {
            if (controller.signal.aborted || store.getState().activeWorkspace?.id !== workspaceId) { controller.abort(); break; }
            const result = event as typeof event & { run?: Run; tool?: string; action?: string; channel?: string; content?: string };
            if (result.type === 'action' && result.action === 'write_report' && latest) {
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
                store.dispatch(dfActions.setFocused({ type: 'report', reportId: streamingReportId }));
                store.dispatch(dfActions.setViewMode('report'));
            } else if (result.type === 'text_delta' && result.channel === 'report' && streamingReportId) {
                reportContent += result.content || '';
                store.dispatch(dfActions.updateGeneratedReportContent({ id: streamingReportId, content: reportContent }));
            } else if (result.type === 'workflow_state' && result.run) {
                latest = result.run;
                await publishWorkflowRun(latest, workspaceId);
                onAccepted?.();
                onAccepted = undefined;
            } else if (result.type === 'activity' && latest) {
                const turn = store.getState().textTurns.find(item => item.workflow?.runId === latest?.id);
                if (turn?.workflow) store.dispatch(dfActions.updateTextTurn({ id: turn.id,
                    workflow: { ...turn.workflow, activity: result.message || result.tool?.replaceAll('_', ' ') } }));
            } else if (result.type === 'error') {
                if (event.error) throw new ApiRequestError(event.error, 200);
                throw new Error(event.message || 'Workflow execution failed');
            }
        }
    } finally {
        if (streamingReportId && store.getState().activeWorkspace?.id === workspaceId
            && store.getState().generatedReports.find(report => report.id === streamingReportId)?.status === 'generating') {
            store.dispatch(dfActions.updateGeneratedReportContent({ id: streamingReportId, content: reportContent, status: 'error' }));
        }
        monitoring = false;
        if (healthTimer) clearTimeout(healthTimer);
        unsubscribe();
        executions.delete(workspaceId);
        if (latest && store.getState().activeWorkspace?.id === workspaceId) {
            if (latest.status === 'running') latest = { ...latest, status: 'paused', message: 'Connection interrupted. Resume this workflow to continue.' };
            await publishWorkflowRun(latest, workspaceId);
        }
    }
}

export async function pauseWorkflowRun(runId: string) {
    try {
        await post('pause', { run_id: runId });
    } catch (reason) { handleApiError(reason, 'Workflow execution'); }
}

export const WorkflowProgress: React.FC<{ turn: TextTurn; canvas?: boolean; selected?: boolean; interactionOnly?: boolean; onCloseInteraction?: () => void }> = ({ turn, canvas = false, selected = false, interactionOnly = false, onCloseInteraction = () => {} }) => {
    const theme = useTheme();
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
    const questionKey = workflow ? `${workflow.runId}:${workflow.interactionId || workflow.calls}` : '';
    const questions = workflow?.interactionId ? workflow.questions || [] : [];
    useEffect(() => { setQuestionAnswers({}); }, [questionKey]);
    const resume = async (response: Omit<WorkflowRequest, 'run_id' | 'path'>) => {
        if (!workflow || submittingRef.current) return;
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
        const needsPlan = workflow?.steps.some(step => step.checkers === undefined)
            || workflow?.planHistory?.some(plan => plan.steps.some(step => step.checkers === undefined));
        if (!canvas || !workflow || historyUnavailable || (!needsOutputOrder && (workflow.log !== undefined || savedLog !== undefined)
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
    useEffect(() => {
        const workspaceId = store.getState().activeWorkspace?.id;
        if (canvas || interactionOnly || !workflow || workflow.status !== 'running' || !workspaceId || executions.has(workspaceId)) return;
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const recover = async () => {
            try {
                const { run } = await post<{ run: Run }>('run-state', { run_id: workflow.runId }, AbortSignal.timeout(10000));
                if (!active || store.getState().activeWorkspace?.id !== workspaceId) return;
                await publishWorkflowRun(run, workspaceId);
                if (active && run.status === 'running') timer = setTimeout(recover, 2000);
            } catch {
                if (!active || store.getState().activeWorkspace?.id !== workspaceId || executions.has(workspaceId)) return;
                const current = store.getState().textTurns.find(item => item.id === turn.id);
                if (current?.workflow?.status === 'running') store.dispatch(dfActions.updateTextTurn({ id: current.id,
                    content: 'Connection interrupted. Execution status could not be confirmed. Review and retry to reconnect.',
                    workflow: { ...current.workflow, status: 'paused', activity: undefined } }));
            }
        };
        void recover();
        return () => { active = false; if (timer) clearTimeout(timer); };
    }, [canvas, interactionOnly, workflow?.runId, workflow?.status]);
    if (!workflow) return null;
    const statusColor = workflow.status === 'completed' ? 'success.main'
        : workflow.status === 'running' ? 'text.primary' : workflow.status === 'paused' ? 'warning.main' : 'error.main';
    const allLog = workflow.log || savedLog || [];
    const log = allLog.filter(entry => (entry.plan_revision || 0) === (workflow.planRevision || 0));
    const unassignedLog = log.filter(entry => !workflow.steps.some(step => step.id === entry.step_id));
    const unassignedChecks = (workflow.checks || []).filter(check => !workflow.steps.some(step => step.checkIds?.includes(check.id)));
    const isActiveStep = (id: string) => workflow.status === 'running' && !workflow.planReviewPending && workflow.stepId === id;
    const stepDuration = (elapsed?: number) => {
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
    const renderCall = (entry: typeof log[number]) => {
        let parsed: unknown;
        try { parsed = JSON.parse(entry.text); } catch {}
        const fields = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? Object.entries(parsed).filter(([, value]) => value !== null && ['string', 'number', 'boolean'].includes(typeof value)) : [];
        return <Box component="details" key={entry.id} data-workflow-call={entry.id} sx={{ borderTop: 1, borderColor: 'divider' }}>
            <Box component="summary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ChevronRightIcon className="workflow-chevron" sx={{ fontSize: 16, flexShrink: 0 }} />
                <TerminalIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
                <Box component="span">{entry.call !== undefined ? `Call ${entry.call}: ` : ''}{entry.tool.replaceAll('_', ' ')}</Box>
            </Box>
            <Box sx={{ pl: { xs: 1, sm: 4 }, pb: 1.5 }}>
                {fields.length > 0 ? <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'minmax(80px, 140px) minmax(0, 1fr)', gap: 1 }}>
                    {fields.map(([name, value]) => <React.Fragment key={name}>
                        <Box component="dt" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>{name.replaceAll('_', ' ')}</Box>
                        <Box component="dd" sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(value)}</Box>
                    </React.Fragment>)}
                </Box> : parsed === undefined ? <Typography sx={{ fontSize: textVar.sm, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{entry.text}</Typography> : null}
                {parsed !== undefined && <Box component="details" sx={{ mt: fields.length ? 1 : 0 }}>
                    <Box component="summary" sx={{ color: 'text.secondary' }}>Raw JSON</Box>
                    <Box component="pre" sx={{ fontFamily: 'var(--df-font-mono, monospace)', fontSize: textVar.sm, lineHeight: 1.6,
                        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', m: 0, p: 1.5, bgcolor: 'action.hover', maxHeight: 360, overflow: 'auto' }}>
                        {JSON.stringify(parsed, null, 2)}
                    </Box>
                </Box>}
            </Box>
        </Box>;
    };
    const renderTimeline = (steps: NonNullable<TextTurn['workflow']>['steps'], checks: NonNullable<NonNullable<TextTurn['workflow']>['checks']>, revision: number, archived = false) => (
        <Box component="ol" aria-label={archived ? `Plan ${revision + 1} timeline` : 'Workflow plan timeline'}
            sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {steps.map((step, index) => {
                const entries = allLog.filter(entry => (entry.plan_revision || 0) === revision && entry.step_id === step.id);
                const results = checks.filter(check => step.checkIds?.includes(check.id));
                const transitions = (workflow.transitions || []).filter(transition => (transition.plan_revision || 0) === revision && transition.from === step.id);
                const savedSteps = revision === (savedPlan?.plan_revision || 0) ? savedPlan?.instance?.steps
                    : savedPlan?.plan_revisions?.find((plan, planIndex) => (plan.plan_revision ?? planIndex) === revision)?.previous_steps;
                const definition = savedSteps?.find(item => item.id === step.id);
                const checkers = step.checkers || definition?.checkers || (step.checkIds || []).map(id => ({ id, condition: undefined, when: undefined, on_fail: undefined }));
                const active = !archived && isActiveStep(step.id);
                const activeIndex = workflow.status === 'completed' ? steps.length - 1 : steps.findIndex(item => item.id === workflow.stepId);
                const reached = !archived && !workflow.planReviewPending && index <= activeIndex;
                const finished = step.status === 'passed' || step.status === 'completed';
                const progressColor = step.status === 'failed' ? 'error.main' : finished ? 'success.main'
                    : workflow.status === 'paused' && index === activeIndex ? 'warning.main' : 'primary.main';
                const connectorReached = reached && index < activeIndex;
                const connectorStyle = connectorReached && !finished ? 'dashed' : 'solid';
                return <Box component="li" key={step.id} data-workflow-step={archived ? undefined : step.id} aria-busy={active}
                    sx={{ position: 'relative', display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', columnGap: 1.5,
                        pb: index === steps.length - 1 ? 0 : 2.5 }}>
                    {index < steps.length - 1 && <Box component="span" aria-hidden="true"
                        data-workflow-connector={connectorReached ? connectorStyle : 'pending'}
                        sx={{ position: 'absolute', left: connectorReached ? 8.5 : 9.5, top: 24, bottom: 0,
                            borderLeftWidth: connectorReached ? 3 : 1, borderLeftStyle: connectorStyle,
                            borderColor: connectorReached ? progressColor : 'divider' }} />}
                    <Box sx={{ width: 20, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        ...(reached ? { '& > .MuiSvgIcon-root': { color: progressColor } } : {}) }}>
                        {stepIcon(step.status, active)}
                    </Box>
                    <Box sx={{ minWidth: 0, containerType: 'inline-size' }}>
                        <Box sx={{ minHeight: 24, display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                            <Typography component="h3" sx={{ m: 0, fontSize: textVar.sm, fontWeight: reached ? 700 : 500,
                                color: reached ? progressColor : 'text.secondary', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{step.id}</Typography>
                            <Typography component="span" sx={{ fontSize: textVar.xs, fontWeight: reached ? 600 : 400,
                                color: reached ? progressColor : 'text.secondary' }}>{step.status}{stepDuration(step.elapsedSeconds)}</Typography>
                        </Box>
                        {(step.description || definition?.description) && <Typography sx={{ mt: 0.5, fontSize: textVar.sm, lineHeight: 1.6 }}>
                            {step.description || definition?.description}
                        </Typography>}
                        <Box sx={{ mt: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 1.5 }}>
                            <Box component="section" aria-label={`${step.id} action`} sx={{ minWidth: 0 }}>
                                <Typography component="h4" sx={{ m: 0, mb: 0.5, fontSize: textVar.xs, fontWeight: 600, color: 'text.secondary' }}>Action</Typography>
                                <Box component="details" data-workflow-action={step.id}
                                    sx={{ '&[open] .workflow-step-preview': { WebkitLineClamp: 'unset', display: 'block' } }}>
                                    <Box component="summary" sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, '&&': { py: 0.25 } }}>
                                        <ChevronRightIcon className="workflow-chevron" sx={{ fontSize: 16, mt: 0.25, flexShrink: 0 }} />
                                        <Typography className="workflow-step-preview" sx={{ fontSize: textVar.sm, lineHeight: 1.65,
                                            display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3,
                                            overflow: 'hidden', overflowWrap: 'anywhere', minWidth: 0 }}>{step.instructions}</Typography>
                                    </Box>
                                </Box>
                                {step.next && step.next !== steps[index + 1]?.id && <Typography sx={{ mt: 0.5, fontSize: textVar.xs, color: 'text.secondary' }}>Next: {step.next}</Typography>}
                            </Box>
                            <Box component="section" aria-label={`${step.id} checks`} sx={{ minWidth: 0 }}>
                                <Typography component="h4" sx={{ m: 0, mb: 0.5, fontSize: textVar.xs, fontWeight: 600, color: 'text.secondary' }}>Checks</Typography>
                                {!checkers.length && <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary' }}>No checks specified.</Typography>}
                                <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                                {checkers.map(check => {
                                    const result = results.find(item => item.id === check.id);
                                    return <Box component="li" key={check.id} data-workflow-check={check.id} sx={{ pb: 0.5 }}>
                                        <Box component="details" sx={{ '&[open] .workflow-step-preview': { WebkitLineClamp: 'unset', display: 'block' } }}>
                                            <Box component="summary" sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, '&&': { py: 0.25 } }}>
                                                <ChevronRightIcon className="workflow-chevron" sx={{ fontSize: 16, mt: 0.25, flexShrink: 0 }} />
                                                <Box component="span" aria-label={`${check.id}: ${result?.status || 'pending'}`}
                                                    sx={{ display: 'inline-flex', pt: 0.25, flexShrink: 0 }}>{stepIcon(result?.status || 'pending')}</Box>
                                                <Typography component="span" className="workflow-step-preview" sx={{ fontSize: textVar.sm,
                                                    color: 'text.secondary', lineHeight: 1.6, minWidth: 0, display: '-webkit-box',
                                                    WebkitBoxOrient: 'vertical', WebkitLineClamp: 3, overflow: 'hidden',
                                                    overflowWrap: 'anywhere' }}>{check.condition || check.id}</Typography>
                                            </Box>
                                            <Box sx={{ pl: 5.5, py: 0.5 }}>
                                                <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary', mb: 0.5 }}>{check.id} · {result?.status || 'pending'} (agent-reported)</Typography>
                                                <Typography sx={{ fontSize: textVar.sm, lineHeight: 1.6 }}>{result?.explanation || 'Not checked yet.'}</Typography>
                                                <Typography sx={{ mt: 0.5, fontSize: textVar.xs, color: 'text.secondary' }}>
                                                    {check.when === 'before' ? 'Before' : check.when === 'during' ? 'During' : 'After'} this step{check.on_fail ? ` · On failure: ${check.on_fail}` : ''}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    </Box>;
                                })}
                                </Box>
                            </Box>
                        </Box>
                        {(entries.length > 0 || transitions.length > 0 || step.assessment) && <Box component="details"
                            key={`${revision}-${step.id}-activity`} data-workflow-activity={step.id} sx={{ mt: 0.75 }}>
                            <Box component="summary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', '&&': { py: 0.5 } }}>
                                <ChevronRightIcon className="workflow-chevron" sx={{ fontSize: 16 }} />
                                <Box component="span" sx={{ fontSize: textVar.xs }}>Activity{entries.length ? ` · ${entries.length} calls` : ''}</Box>
                            </Box>
                            {step.assessment && <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary', my: 1 }}>
                                Progress assessment: {step.assessment.status} · {step.assessment.explanation}
                                {step.assessment.evidence_ids.length ? ` · Evidence: ${step.assessment.evidence_ids.join(', ')}` : ''}
                            </Typography>}
                            {entries.map(renderCall)}
                            {transitions.map((transition, transitionIndex) => <Typography key={transitionIndex} sx={{ mt: 1, fontSize: textVar.sm, color: 'text.secondary' }}>{transition.from} → {transition.to}: {transition.reason}</Typography>)}
                        </Box>}
                    </Box>
                </Box>;
            })}
        </Box>
    );
    const statusAction = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => canvas || interactionOnly
        ? <Tooltip title={label}><span><IconButton size="small" aria-label={label} disabled={disabled} onClick={onClick}>{icon}</IconButton></span></Tooltip>
        : <Button size="small" startIcon={icon} disabled={disabled} onClick={onClick}>{label}</Button>;
    const pauseWorkflow = () => { void pauseWorkflowRun(workflow.runId); };
    const summary = (
        <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
            <Typography component="span" sx={{ display: 'block', fontSize: textVar.xs, color: 'text.secondary', overflowWrap: 'anywhere', mb: 0.75 }}>
                <Box component="span"
                    sx={{ fontWeight: 600, color: statusColor, textTransform: 'capitalize' }}>
                    {workflow.status === 'running' ? <ShimmerText tone="neutral" fontSize="inherit" fontWeight={600}>{workflow.planReviewPending ? 'Reviewing plan' : workflow.status}</ShimmerText> : workflow.status}
                </Box> · {workflow.toolCalls ?? workflow.log?.length ?? 0} tool calls{workflow.status === 'running' && workflow.activity ? ` · ${workflow.activity}` : ''}
            </Typography>
            {!canvas && <Box component="span" sx={{ display: 'block' }}>
            {workflow.steps.map(step => <Box key={step.id} component="span" aria-busy={isActiveStep(step.id)}
                data-workflow-step={step.id} sx={{ display: 'flex', gap: 0.75, alignItems: 'center', py: 0.25 }}>
            {stepIcon(step.status, isActiveStep(step.id))}
            <Typography component="span" sx={{ fontSize: textVar.xs, color: 'text.secondary', overflowWrap: 'anywhere' }}>{step.id} · {step.status}{stepDuration(step.elapsedSeconds)}</Typography>
        </Box>)}
        </Box>}
        </Box>
    );
    return <Box data-workflow-progress={canvas || interactionOnly ? undefined : workflow.runId} onClick={event => event.stopPropagation()}
        sx={{ fontFamily: theme => theme.typography.fontFamily, fontSize: textVar.sm, lineHeight: 1.5, letterSpacing: 0,
            ...(canvas ? { position: 'relative', width: '100%', height: '100%', boxSizing: 'border-box', minWidth: 0, overflow: 'hidden' } : { minWidth: 0, width: '100%' }) }}>
        <Box data-workflow-scroll={canvas ? workflow.runId : undefined} sx={canvas ? { height: '100%', overflow: 'auto', boxSizing: 'border-box',
            p: { xs: 2, sm: 3 } } : { display: 'contents' }}>
        {!interactionOnly && <>
        {canvas && <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, overflowWrap: 'anywhere' }}>{turn.prompt?.replace(/^Run workflow: /, '') || 'Workflow'}</Typography>}
        {canvas ? summary : <ThreadArtifactCard artifactType="workflow" title="Open workflow response and analysis log" selected={selected} onClick={() => {
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
        {canvas && <Box role="region" aria-label="Workflow response and analysis log" sx={{ mt: 2, overflowWrap: 'anywhere',
            '& details, & summary': { fontFamily: theme => theme.typography.fontFamily, fontSize: textVar.sm, letterSpacing: 0 },
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
            <Typography sx={{ fontSize: textVar.sm, fontWeight: 600, mb: 1 }}>Steps{workflow.planRevision ? ` · Plan ${workflow.planRevision + 1}` : ''}</Typography>
            {renderTimeline(workflow.steps, workflow.checks || [], workflow.planRevision || 0)}
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
            {workflow.status === 'completed' && <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                <Typography sx={{ fontSize: textVar.sm, fontWeight: 600 }}>Agent response</Typography>
                <Typography sx={{ fontSize: textVar.sm, whiteSpace: 'pre-wrap', mt: 1 }}>{turn.content}</Typography>
            </Box>}
        </Box>}
        </>}
        </Box>
        <Box sx={{ display: 'contents' }}>
        {workflow.status === 'paused' && workflow.terminalRequest && <>
            {statusAction('Review command', <TerminalIcon sx={{ fontSize: 18 }} />, () => {
                if (!interactionOnly) store.dispatch(dfActions.setFocused({ type: 'text', textId: turn.id }));
                else setApprovalOpen(true);
            }, submitting)}
            {interactionOnly && !submitting && (approvalOpen || dismissedApproval !== workflow.terminalRequest.id) && <TerminalApprovalDialog key={workflow.terminalRequest.id} proposal={workflow.terminalRequest} onDecision={decision => {
                setApprovalOpen(false); setDismissedApproval(workflow.terminalRequest!.id);
                void resume({ terminal_response: { request_id: workflow.terminalRequest!.id, decision } })
                    .then(success => { if (success === false) setApprovalOpen(true); });
            }} />}
        </>}
        {workflow.status === 'paused' && workflow.dataOperation && (interactionOnly ? <Box sx={submitting ? { pointerEvents: 'none', filter: 'grayscale(1)' } : undefined}>
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
        {workflow.status === 'paused' && !workflow.terminalRequest && !workflow.dataOperation && !turn.form && (
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
        {!canvas && !interactionOnly && workflow.status === 'running' && statusAction('Pause', <PauseIcon sx={{ fontSize: 18 }} />, pauseWorkflow)}
        </Box>
    </Box>;
};

export const WorkflowPanel: React.FC<{ onCreateSession: (name: string) => void }> = ({ onCreateSession }) => {
    const model = useSelector((state: DataFormulatorState) => [...state.globalModels, ...state.models]
        .find(item => item.id === state.selectedModelId));
    const workspaceId = useSelector((state: DataFormulatorState) => state.activeWorkspace?.id);
    const [items, setItems] = useState<Instance[]>([]);
    const [runs, setRuns] = useState<Run[]>([]);
    const busy = useSelector((state: DataFormulatorState) => state.textTurns.some(turn => turn.workflow?.status === 'running'));
    const [loading, setLoading] = useState(false);
    const [editor, setEditor] = useState<{ path: string; content: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<Instance | null>(null);
    const [deletingInstance, setDeletingInstance] = useState(false);
    const [runTarget, setRunTarget] = useState<Instance | null>(null);
    const [starting, setStarting] = useState(false);
    const [pendingRun, setPendingRun] = useState<{ path: string; previousWorkspaceId?: string } | null>(null);
    const generation = useRef(0);

    const refresh = async () => {
        const current = generation.current;
        setLoading(true);
        try {
            const result = await post<{ items: Instance[]; runs: Run[] }>('list');
            if (current === generation.current) { setItems(result.items); setRuns(result.runs); }
        } catch (reason) { if (current === generation.current) handleApiError(reason, 'Load workflows'); }
        finally { if (current === generation.current) setLoading(false); }
    };

    useEffect(() => {
        generation.current += 1;
        setItems([]); setRuns([]);
        setDeleteTarget(null); setDeletingInstance(false);
        setRunTarget(null);
        void refresh();
        return () => { generation.current += 1; };
    }, [workspaceId]);

    const edit = async (item: Instance) => {
        const current = generation.current;
        try {
            const result = await post<{ content: string }>('read', { path: item.path });
            if (current !== generation.current) return;
            let path = item.path;
            if (item.origin === 'demo') {
                const stem = item.path.replace(/^demo\//, '').replace(/\.yaml$/, '');
                path = `${stem}-copy.yaml`;
                let suffix = 2;
                while (items.some(existing => existing.path === path)) path = `${stem}-copy-${suffix++}.yaml`;
            }
            setEditor({ path, content: result.content });
        }
        catch (reason) { handleApiError(reason, 'Read workflow'); }
    };

    const execute = async (path?: string, runId?: string) => {
        if (!model || busy) return;
        const current = generation.current;
        setStarting(true);
        try {
            await executeWorkflow({ path, run_id: runId }, () => store.dispatch(dfActions.setDataSourceSidebarOpen(false)));
        } catch (reason) { if (current === generation.current) handleApiError(reason, 'Workflow execution'); }
        finally {
            setStarting(false);
            if (current === generation.current) void refresh();
        }
    };

    const startNewSession = (item: Instance) => {
        setRunTarget(null);
        setStarting(true);
        setPendingRun({ path: item.path, previousWorkspaceId: workspaceId });
        try { onCreateSession(item.name); }
        catch (reason) {
            setPendingRun(null); setStarting(false);
            handleApiError(reason, 'Create workflow session');
        }
    };

    useEffect(() => {
        if (workspaceId && pendingRun && workspaceId !== pendingRun.previousWorkspaceId) {
            setPendingRun(null);
            void execute(pendingRun.path);
        }
    }, [workspaceId, pendingRun]);

    return <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, overflow: 'auto' }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', px: 1.5, py: 1 }}>
            <Tooltip title="Refresh workflows"><span><IconButton aria-label="Refresh workflows" size="small" disabled={loading} onClick={refresh}><RefreshIcon sx={{ fontSize: iconVar.md }} /></IconButton></span></Tooltip>
            {loading && <CircularProgress size={16} />}
        </Box>
        {!model && <Alert severity="info" sx={{ mx: 1, mb: 1 }}>Select a model to run a workflow.</Alert>}
        {(['user', 'demo'] as const).map(origin => {
            const group = items.filter(item => (item.origin || 'user') === origin);
            return group.length > 0 && <Box component="section" aria-label={origin === 'demo' ? 'Demo workflows' : 'Your workflows'} key={origin}>
            <Typography sx={{ fontSize: textVar.xs, fontWeight: 600, px: 1.5, pt: 1, pb: 0.5 }}>{origin === 'demo' ? 'Demos' : 'Your workflows'}</Typography>
        {group.map(item => <Box key={item.path} sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 0.5, alignItems: 'flex-start' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: textVar.sm, fontWeight: 600, overflowWrap: 'anywhere' }}>{item.name}</Typography>
                <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary', overflowWrap: 'anywhere' }}>{item.path}</Typography>
                <Typography sx={{ fontSize: textVar.xs, color: item.error ? 'error.main' : 'text.secondary', overflowWrap: 'anywhere' }}>{item.error || item.overview}</Typography>
            </Box>
            <Tooltip title={origin === 'demo' ? 'Customize a copy' : 'Edit instance'}><span><IconButton aria-label={`${origin === 'demo' ? 'Customize' : 'Edit'} ${item.name}`} size="small" disabled={busy} onClick={() => edit(item)}>
                {origin === 'demo' ? <ContentCopyIcon sx={{ fontSize: iconVar.md }} /> : <EditOutlinedIcon sx={{ fontSize: iconVar.md }} />}</IconButton></span></Tooltip>
            {origin !== 'demo' && <Tooltip title="Delete workflow"><span><IconButton aria-label={`Delete ${item.path}`} size="small" disabled={busy || deletingInstance}
                onClick={() => setDeleteTarget(item)}><DeleteOutlineIcon sx={{ fontSize: iconVar.md }} /></IconButton></span></Tooltip>}
            <Tooltip title="Run workflow"><span><IconButton aria-label={`Run ${item.name}`} size="small" color="primary" disabled={busy || starting || !model || !!item.error}
                onClick={() => workspaceId ? setRunTarget(item) : startNewSession(item)}><PlayArrowIcon sx={{ fontSize: iconVar.md }} /></IconButton></span></Tooltip>
        </Box>)}</Box>;
        })}
        <Typography sx={{ fontSize: textVar.xs, fontWeight: 600, px: 1.5, pt: 2, pb: 0.5 }}>Recent runs</Typography>
        {runs.map(item => <Button key={item.id} disabled={busy} onClick={async () => {
            try {
                const { run } = await post<{ run: Run }>('run-state', { run_id: item.id });
                if (workspaceId) {
                    deletedWorkflowRuns.delete(`${workspaceId}/${run.id}`);
                    await publishWorkflowRun(run, workspaceId);
                }
                store.dispatch(dfActions.setFocused({ type: 'text', textId: `textTurn-workflow-${run.id}` }));
                store.dispatch(dfActions.setDataSourceSidebarOpen(false));
            } catch (reason) { handleApiError(reason, 'Open workflow run'); }
        }} sx={{ justifyContent: 'flex-start', display: 'block', textAlign: 'left', px: 1.5, textTransform: 'none', borderRadius: 0 }}>
            <Typography sx={{ fontSize: textVar.sm, overflowWrap: 'anywhere' }}>{item.name}</Typography>
            <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>{item.status} · {new Date(item.started_at).toLocaleString()}</Typography>
        </Button>)}

        <Dialog open={!!runTarget} onClose={() => setRunTarget(null)} maxWidth="xs" fullWidth>
            <DialogTitle>Run workflow</DialogTitle>
            <DialogContent>
                <Typography sx={{ overflowWrap: 'anywhere', mb: 1 }}>{runTarget?.name}</Typography>
                <Typography variant="body2">Start a new session or use the current session?</Typography>
            </DialogContent>
            <DialogActions sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                <Button onClick={() => setRunTarget(null)}>Cancel</Button>
                <Button disabled={busy || starting} onClick={() => {
                    if (!runTarget) return;
                    const path = runTarget.path;
                    setRunTarget(null);
                    void execute(path);
                }}>Current session</Button>
                <Button variant="contained" autoFocus disabled={busy || starting} onClick={() => runTarget && startNewSession(runTarget)}>New session</Button>
            </DialogActions>
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
                        setDeleteTarget(null);
                    } catch (reason) { if (current === generation.current) handleApiError(reason, 'Delete workflow'); }
                    finally { if (current === generation.current) setDeletingInstance(false); }
                }}>Delete</Button>
            </DialogActions>
        </Dialog>

        <Dialog open={!!editor} onClose={() => !saving && setEditor(null)} maxWidth="md" fullWidth>
            <DialogTitle>Workflow instance</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField size="small" label="Instance filename" value={editor?.path || ''} onChange={event => setEditor(previous => previous && ({ ...previous, path: event.target.value }))} sx={{ mt: 1 }} />
                <Box sx={{ height: '55vh', minHeight: 240, border: 1, borderColor: 'divider' }}>
                    <MarkdownEditor fileName="instance.yaml" value={editor?.content || ''}
                        onChange={content => setEditor(previous => previous && ({ ...previous, content }))} />
                </Box>
            </DialogContent>
            <DialogActions><Button disabled={saving} onClick={() => setEditor(null)}>Cancel</Button><Button startIcon={<SaveIcon />} disabled={saving || !editor?.content} onClick={async () => {
                setSaving(true);
                try { await post('save', editor!); setEditor(null); await refresh(); } catch (reason) { handleApiError(reason, 'Save workflow'); }
                finally { setSaving(false); }
            }}>Save instance</Button></DialogActions>
        </Dialog>

    </Box>;
};