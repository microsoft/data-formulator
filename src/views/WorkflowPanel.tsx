import { ShimmerText, WorkflowGears } from '../components/FunComponents';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSelector } from 'react-redux';
import { Alert, Box, Button, ButtonBase, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
    IconButton, Popover, TextField, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import QuestionAnswerOutlinedIcon from '@mui/icons-material/QuestionAnswerOutlined';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import { ArtifactDeleteButton, ThreadArtifactCard } from './DataThreadCards';
import { cardHoverSx, ItemCard, MetadataCard, MetadataChips, ViewAllButton } from '../components/ItemCard';
import { readingTypography, sidebarPrimaryActionSx, sidebarRowActionSx, sidebarToolbarSx } from '../app/tokens';
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
import { createConversationRootId, createDictTable, computeInsightKey, DictTable, FieldItem, TextTurn, ClarificationResponse } from '../components/ComponentType';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { textVar, iconVar } from '../app/layout';
import { ListDetailDialog } from '../components/ListDetailDialog';
import { ExecutionCodeBlock, formatTerminalCommand, TerminalApprovalDialog, TerminalProposal } from '../components/TerminalApprovalDialog';
import { ConnectorFormCard } from '../components/ConnectorFormCard';
import { parseDataOperation } from '../dataOperations/models';
import { ClarificationPanel, FailedDraftPanel } from './AgentPausePanel';
import { formatClarificationResponses, normalizeClarifyEvent } from '../app/clarification';
import ReactMarkdown from 'react-markdown';
import { CardRuns, RunEntry, RunList, useScheduleLibrary, workflowApi as post, WorkflowLibraryItem,
    WorkflowSetup, WorkflowSetupFields, workflowSetupContentSx } from './WorkflowSchedules';

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

type RunOutput = NonNullable<Run['outputs']>[number];

/** The derived table, chart, and fields a visualization result adds to the thread, with the step's question as its trigger. */
function workflowResultNodes(output: Pick<RunOutput, 'content' | 'input_sources'>, rows: any[], tables: DictTable[], fieldPrefix: string,
    parentNodeId: string, fallbackSource: string, createdAt: number) {
    const result = output.content.result;
    const goal = result.refined_goal;
    const tableId = result.content.virtual.table_name;
    const table = createDictTable(tableId, rows, undefined);
    table.displayId = goal.display_name || tableId;
    table.parentNodeId = parentNodeId;
    const inputSources = (output.input_sources || []).map(source => ({ id: source.id, kind: source.kind, displayName: source.display_name || source.id }));
    const sourceNames = inputSources.filter(source => source.kind === 'data').map(source => source.displayName.replace(/\.[^/.]+$/, ''));
    const sourceIds = tables.filter(item =>
        sourceNames.includes(item.virtual?.tableId || item.id.replace(/\.[^/.]+$/, ''))).map(item => item.id);
    const triggerChart = generateFreshChart(sourceIds[0] || fallbackSource, 'Auto');
    triggerChart.source = 'trigger';
    table.derive = { code: result.code, codeSignature: result.code_signature,
        outputVariable: goal.output_variable, source: sourceIds,
        inputSources, dialog: result.dialog || [], trigger: { tableId: sourceIds[0] || fallbackSource, resultTableId: tableId,
            chart: triggerChart, interaction: [{ from: 'data-agent', to: 'datarec-agent',
                role: 'instruction', content: output.content.question || goal.title, timestamp: createdAt }] } };
    const concepts: FieldItem[] = table.names.map(name => ({ id: `${fieldPrefix}-${name}`, name, source: 'custom', tableRef: 'custom' }));
    const chart = resolveRecommendedChart(goal, concepts, table);
    chart.id = result.chart_id;
    chart.title = goal.title;
    chart.subtitle = goal.subtitle;
    chart.titleKey = computeInsightKey(chart);
    return { table, chart, concepts };
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
        // The server omits chart rows this client already published.
        if (output.type === 'result' && output.content?.result?.content?.rows_omitted && outputVersions[output.id]) continue;
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
            const tableId = output.content.result.content.virtual.table_name;
            const parentNodeId = dfSelectors.getAllTables(store.getState()).find(item => item.id === tableId)?.parentNodeId
                || outputParent(tableId);
            const { table, chart, concepts } = workflowResultNodes(output, output.content.result.content.rows,
                dfSelectors.getAllTables(store.getState()), `workflow-field-${run.id}-${output.id}`, parentNodeId, turnId, createdAt);
            table.virtual = { tableId, rowCount: output.content.result.content.virtual.row_count };
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

/** A run-state request naming the outputs already published, so their chart rows are not resent. */
const runStateRequest = (runId: string) => ({ run_id: runId, known_outputs: Object.keys(store.getState().textTurns
    .find(turn => turn.workflow?.runId === runId)?.workflow?.outputVersions || {}) });

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

async function replyWorkflowQuestion(turn: TextTurn, text: string, onAccepted?: () => void, messageId?: string) {
    const workflow = turn.workflow;
    if (workflow?.status !== 'paused' || workflow.terminalRequest || !text.trim()) throw new Error('This workflow is not waiting for a reply.');
    const afterOutputIds = [...(turn.outputIds || [])];
    const replyId = workflow.interactionId || messageId || crypto.randomUUID();
    await executeWorkflow({ run_id: workflow.runId, reply: text.trim() }, () => {
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: `textTurn-workflow-reply-${workflow.runId}-${replyId}`,
            displayId: 'Workflow reply', textKind: 'explain', prompt: text.trim(),
            content: workflow.interactionId ? 'Answered workflow question.' : 'Resumed with your message.',
            parentNodeId: turn.id, createdAt: Date.now(), workflowMessage: { runId: workflow.runId,
                messageId: replyId, kind: 'reply', status: 'received', afterOutputIds } }));
        onAccepted?.();
    });
}

/** Steer a running workflow with a queued message, or resume a paused one with it. */
export async function sendWorkflowMessage(turn: TextTurn, text: string, messageId: string, onAccepted?: () => void) {
    const workspaceId = store.getState().activeWorkspace?.id;
    if (!workspaceId || !turn.workflow || !text.trim()) throw new Error('Select an active workflow and enter a message.');
    const current = store.getState().textTurns.find(item => item.id === turn.id) || turn;
    if (current.workflow?.status === 'paused') return replyWorkflowQuestion(current, text, onAccepted, messageId);
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

export async function executeWorkflow(body: WorkflowRequest, onAccepted?: () => void) {
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
                const { run } = await post<{ run: Run }>('run-state', runStateRequest(latest.id), AbortSignal.timeout(10000));
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
                        const { run } = await post<{ run: Run }>('run-state', runStateRequest(latest.id), AbortSignal.timeout(10000));
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
        if (!workspaceId || !runningIds || (readOnly && !scheduledView)) return;
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let snapshotReloads = 0;
        const observe = async () => {
            let delay = 2000;
            try {
                if (executions.has(workspaceId)) return;
                for (const runId of runningIds.split(',')) {
                    const { run } = await post<{ run: Run }>('run-state', runStateRequest(runId), AbortSignal.timeout(10000));
                    if (!active || store.getState().activeWorkspace?.id !== workspaceId || executions.has(workspaceId)) return;
                    if (!scheduledView || run.status === 'running') {
                        await publishWorkflowRun(run, workspaceId, false);
                    } else {
                        if (store.getState().sessionLoading) return;
                        const result = await loadWorkspace(workspaceId);
                        if (!active || store.getState().activeWorkspace?.id !== workspaceId) return;
                        // The scheduler marks the session editable just after the run releases its lock.
                        if (!result || (result.readOnly && ++snapshotReloads < 5)) return;
                        store.dispatch(dfActions.loadState({ ...result.state, activeWorkspace: { ...result.state.activeWorkspace,
                            id: workspaceId, displayName: result.displayName, readOnly: result.readOnly } }));
                        if (result.workflowRun) await publishWorkflowRun(result.workflowRun, workspaceId);
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
    // A fixed position: thread updates can remount the button, which would strand an element anchor.
    const [messageAnchor, setMessageAnchor] = useState<{ top: number; left: number } | null>(null);
    const [messageDraft, setMessageDraft] = useState('');
    const [sendingMessage, setSendingMessage] = useState(false);
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
        void post<{ run: Run }>('run-state', { run_id: workflow.runId, omit_rows: true }).then(({ run }) => {
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
    const statusAction = (label: string, icon: React.ReactNode, onClick: (event: React.MouseEvent<HTMLElement>) => void, disabled = false) => canvas || interactionOnly
        ? <Tooltip title={label}><span><IconButton size="small" color={workflow.status === 'paused' ? 'warning' : 'primary'} aria-label={label} disabled={disabled} onClick={onClick}>{icon}</IconButton></span></Tooltip>
        : <Button size="small" color={workflow.status === 'paused' ? 'warning' : 'primary'} startIcon={icon} disabled={disabled} onClick={onClick}>{label}</Button>;
    const pauseWorkflow = () => { void pauseWorkflowRun(workflow.runId); };
    const canMessage = (workflow.status === 'running' || workflow.status === 'paused') && !workflow.terminalRequest;
    const sendMessage = async () => {
        const text = messageDraft.trim();
        if (!text || sendingMessage) return;
        setSendingMessage(true);
        try { await sendWorkflowMessage(turn, text, crypto.randomUUID(), () => { setMessageAnchor(null); setMessageDraft(''); }); }
        catch (reason) { handleApiError(reason, 'Workflow message'); }
        finally { setSendingMessage(false); }
    };
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
        {workflow.status === 'paused' && workflow.interactionId && turn.form?.kind === 'connector' && interactionOnly && <ConnectorFormCard
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
        {!canvas && !interactionOnly && canMessage && statusAction('Steer', <AltRouteIcon sx={{ fontSize: 16 }} />, event => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMessageAnchor({ top: rect.bottom, left: rect.left });
        })}
        <Popover open={!!messageAnchor && canMessage} anchorReference="anchorPosition" anchorPosition={messageAnchor ?? undefined}
            onClose={() => !sendingMessage && setMessageAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            transitionDuration={{ enter: 180, exit: 120 }} onClick={event => event.stopPropagation()}
            slotProps={{ paper: { sx: { mt: 0.75, width: 380, maxWidth: 'calc(100vw - 32px)', px: 1.25, pt: 1, pb: 0.5,
                borderRadius: '12px', border: 1, borderColor: 'divider', overflow: 'visible',
                boxShadow: '0 4px 18px rgba(32, 33, 36, 0.16), 0 1px 3px rgba(32, 33, 36, 0.08)',
                transition: 'border-color 120ms ease, box-shadow 120ms ease',
                '&:focus-within': { borderColor: 'primary.main',
                    boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.14)}, 0 4px 18px rgba(32, 33, 36, 0.16)` } } } }}>
            <Box component="form" aria-label="Steer workflow agent" onSubmit={event => { event.preventDefault(); void sendMessage(); }}>
                <TextField variant="standard" autoFocus fullWidth multiline minRows={2} maxRows={8} value={messageDraft} disabled={sendingMessage}
                    placeholder={workflow.status === 'paused' ? 'Tell the agent how to continue...' : 'Steer the agent, e.g. focus on diesel only'}
                    onChange={event => setMessageDraft(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(); } }}
                    slotProps={{ input: { disableUnderline: true, sx: { fontSize: textVar.md, lineHeight: 1.5 } },
                        htmlInput: { 'aria-label': 'Message to workflow agent', maxLength: 4000 } }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                    <Typography sx={{ flex: 1, fontSize: textVar.xs, color: 'text.secondary' }}>
                        {workflow.status === 'paused' ? 'Sending resumes the workflow.' : 'Read before its next action.'}
                    </Typography>
                    <Tooltip title={workflow.status === 'paused' ? 'Send and resume' : 'Send'}><span>
                        <IconButton type="submit" size="small" aria-label={workflow.status === 'paused' ? 'Send and resume' : 'Send'}
                            disabled={sendingMessage || !messageDraft.trim()}
                            sx={{ p: 0, width: 28, height: 28, transition: 'background-color 120ms ease, transform 120ms ease',
                                bgcolor: 'primary.main', color: 'common.white', '&:hover': { bgcolor: 'primary.dark', transform: 'translateY(-1px)' },
                                '&.Mui-disabled': { bgcolor: 'transparent', color: 'text.disabled' } }}>
                            {sendingMessage ? <CircularProgress size={14} /> : <ArrowUpwardRoundedIcon sx={{ fontSize: iconVar.lg }} />}
                        </IconButton>
                    </span></Tooltip>
                </Box>
            </Box>
        </Popover>
        </Box>}
    </Box>;
};

export const WORKFLOW_AUTHORING_PROMPT = 'Help me create a workflow from our current conversation and data. Suggest a few useful directions for me to choose from before drafting it. Do not save or execute it yet.';

export const WorkflowPanel: React.FC<{ onCreateSession: (name: string) => void; onOpenSession?: (id: string) => void | Promise<void>; headerActions?: React.ReactNode;
    presentation?: 'sidebar' | 'landing';
    renderLanding?: (content: { examples: React.ReactNode; saved: React.ReactNode; toolbar: React.ReactNode }) => React.ReactNode;
}> = ({ onCreateSession, onOpenSession, headerActions, presentation = 'sidebar', renderLanding }) => {
    const landing = presentation === 'landing';
    const canSchedule = useSelector((state: DataFormulatorState) => state.serverConfig?.IS_LOCAL_MODE);
    const model = useSelector((state: DataFormulatorState) => [...state.globalModels, ...state.models]
        .find(item => item.id === state.selectedModelId));
    const workspaceId = useSelector((state: DataFormulatorState) => state.activeWorkspace?.id);
    const inSession = useSelector(dfSelectors.selectInSession);
    const readOnly = useSelector((state: DataFormulatorState) => state.activeWorkspace?.readOnly);
    const [items, setItems] = useState<WorkflowLibraryItem[]>([]);
    const [runs, setRuns] = useState<Run[]>([]);
    const busy = useSelector((state: DataFormulatorState) => state.textTurns.some(turn => turn.workflow?.status === 'running'));
    const [loading, setLoading] = useState(false);
    const [editor, setEditor] = useState<{ path: string; content: string; content_hash?: string; creating?: boolean; source?: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<WorkflowLibraryItem | null>(null);
    const [deletingInstance, setDeletingInstance] = useState(false);
    const [runTarget, setRunTarget] = useState<WorkflowLibraryItem | null>(null);
    const [setupValues, setSetupValues] = useState<Record<string, string | number | boolean>>({});
    const [setupInstructions, setSetupInstructions] = useState('');
    const [starting, setStarting] = useState(false);
    const [pendingRun, setPendingRun] = useState<{ path: string; content?: string; setup: WorkflowSetup; previousWorkspaceId?: string } | null>(null);
    // Scheduled runs also appear among each workflow's previous runs.
    const scheduleLibrary = useScheduleLibrary(!landing && !!canSchedule, busy);
    const generation = useRef(0);

    const refresh = async (quiet = false) => {
        const current = generation.current;
        if (!quiet) setLoading(true);
        try {
            const result = await post<{ items: WorkflowLibraryItem[]; runs: Run[] }>('list');
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

    const edit = async (item: WorkflowLibraryItem) => {
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

    const startNewSession = async (item: WorkflowLibraryItem, setup: WorkflowSetup) => {
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
            const { run } = await post<{ run: Run }>('run-state', runStateRequest(item.id));
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
    const workflowRunsFor = (item: WorkflowLibraryItem, beforeOpen?: () => void): RunEntry[] => [
        ...runs.filter(run => run.workflow_path === item.path || !run.workflow_path && run.name === item.name
            && items.filter(candidate => candidate.name === item.name).length === 1)
            .map(run => ({ key: run.id, status: run.status, time: run.started_at, disabled: busy, open: () => { beforeOpen?.(); void openRun(run); } })),
        ...(openRunSession ? scheduleLibrary.schedules.filter(schedule => schedule.config.workflow === item.path)
            .flatMap(schedule => (schedule.history || []).filter(run => run.status !== 'skipped'))
            .map(run => ({ key: `scheduled-${run.id}`, status: run.status, time: run.scheduled_for,
                open: () => { beforeOpen?.(); void openRunSession(`scheduled-${run.id}`); } })) : []),
    ].sort((left, right) => Date.parse(right.time) - Date.parse(left.time));
    const editorRuns = editorItem ? workflowRunsFor(editorItem, () => setEditor(null)) : [];

    const toolbar = <Box sx={{ ...sidebarToolbarSx, flexWrap: 'wrap', ...(landing ? { p: 0, borderBottom: 0, bgcolor: 'transparent' } : {}) }}>
            <Button variant="outlined" size="small" startIcon={<AddIcon />} disabled={readOnly} sx={sidebarPrimaryActionSx}
                onClick={createWorkflow}>
                New workflow
            </Button>
            {!landing && <Box sx={{ flex: 1 }} />}
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
            {landing && (groupId === 'server' || (!renderLanding && groupId === 'user')) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 32, mb: 1 }}>
            <Typography sx={{ flex: 1, fontSize: textVar.sm, color: 'text.secondary', textAlign: 'left' }}>{label}</Typography>
            {groupId === 'user' && toolbar}
            </Box>
            )}
            {landing && groupId === 'demo' && !model && <Alert severity="info" sx={{ mb: 1 }}>Select a model to run a workflow.</Alert>}
            <Box id={`workflow-${presentation}-group-${groupId}`} sx={{ mx: landing ? 0 : 0.75, mt: landing ? 0 : 1, display: 'grid', gap: landing ? 1 : 0.75,
                ...(landing ? { gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))' } : {}) }}>
        {!group.length && <Typography sx={{ px: 1, py: 0.75, fontSize: textVar.xs, color: 'text.secondary' }}>
            {loading ? 'Loading workflows...' : 'No saved workflows'}
        </Typography>}
        {group.map(item => {
            const origin = item.origin || 'user';
            const runDisabled = busy || starting || readOnly || !!item.error;
            const openSetup = () => {
                setSetupValues(Object.fromEntries((item.parameters || []).map(parameter => [parameter.name,
                    parameter.default ?? (parameter.type === 'boolean' ? false : '')])));
                setSetupInstructions('');
                setRunTarget(item);
            };
            if (!landing) {
                const cardRuns = workflowRunsFor(item);
                return <ItemCard key={item.path} compact title={item.name} openLabel={`Open ${item.name}`} onOpen={() => void edit(item)}
                    badges={origin === 'demo' && <Box component="span" sx={{ flexShrink: 0, fontSize: textVar.xxs, color: 'text.disabled' }}>demo</Box>}
                    tooltip={item.error ? undefined : <MetadataCard title={item.name} description={item.overview}>
                        {!!item.parameters?.length && <MetadataChips items={item.parameters.map(parameter => ({ name: parameter.label || parameter.name }))} />}
                    </MetadataCard>}
                    captions={item.error ? [<Box key="error" component="span" sx={{ color: 'error.main' }}>{item.error}</Box>] : []}
                    persistentActions
                    actions={<Tooltip title="Run workflow"><span><IconButton aria-label={`Run ${item.name}`} size="small" disabled={runDisabled}
                        sx={sidebarRowActionSx} onClick={openSetup}><PlayArrowIcon /></IconButton></span></Tooltip>}
                    meta={cardRuns.length > 0 && <CardRuns label={`Previous runs of ${item.name}`} runs={cardRuns} />} />;
            }
            return <Box component="article" key={item.path} sx={{ minWidth: 0, ...cardHoverSx, display: 'flex', position: 'relative',
                border: '1px solid rgba(0, 0, 0, 0.18)', borderRadius: 1, bgcolor: 'background.paper', boxShadow: '0 1px 3px rgba(32, 33, 36, 0.06)',
                '& .workflow-secondary-action': { opacity: 0 },
                '&:hover .workflow-secondary-action, &:focus-within .workflow-secondary-action': { opacity: 1 },
                '@media (hover: none)': { '& .workflow-secondary-action': { opacity: 1 } } }}>
            <ButtonBase aria-label={`Run ${item.name}`} disabled={runDisabled} onClick={openSetup}
                sx={{ display: 'block', width: '100%', minWidth: 0, textAlign: 'left', p: 1.25, flex: 1, borderRadius: 'inherit',
                    '&.Mui-disabled': { opacity: 0.6 }, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pr: origin === 'user' ? 2.5 : 0 }}>
                    <WorkflowGears running={false} size={16} color="text.secondary" showTooltip={false} />
                    <Typography sx={{ fontSize: textVar.md, fontWeight: 400, lineHeight: 1.4, minWidth: 0, overflowWrap: 'anywhere' }}>{item.name}</Typography>
                    <PlayArrowIcon sx={{ ml: 'auto', flexShrink: 0, fontSize: iconVar.md, color: runDisabled ? 'action.disabled' : 'primary.main' }} />
                </Box>
                {(item.error || item.overview) && <Typography sx={{ mt: 0.25, fontSize: textVar.xs, lineHeight: 1.5,
                    color: item.error ? 'error.main' : 'text.secondary', overflowWrap: 'anywhere',
                    ...(!item.error ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}) }}>
                    {item.error || item.overview}</Typography>}
            </ButtonBase>
            {origin === 'user' && <Box className="workflow-secondary-action" sx={{ position: 'absolute', top: 4, right: 4 }}>
                <ArtifactDeleteButton label={`Delete ${item.path}`} disabled={busy || deletingInstance}
                    onClick={() => setDeleteTarget(item)} />
            </Box>}
        </Box>;
        })}</Box></Box>;
        });
    return <Box sx={{ display: landing ? 'contents' : 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, flex: '0 1 auto', overflow: landing ? 'visible' : 'hidden' }}>
        {landing && renderLanding ? renderLanding({ examples: renderGroups(['demo']), saved: renderGroups(['user', 'server']), toolbar }) : <>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', px: 1.5, height: 40, minHeight: 40, boxSizing: 'border-box',
            flexShrink: 0, borderBottom: '1px solid rgba(0, 0, 0, 0.16)', bgcolor: 'rgba(255, 255, 255, 0.76)',
            ...(landing ? { px: 0, borderBottom: 0, bgcolor: 'transparent' } : {}) }}>
            <Typography component={landing ? 'h2' : 'div'} sx={{ fontSize: landing ? textVar.xl : textVar.md, fontWeight: landing ? 400 : 600, textAlign: 'left' }}>{landing ? 'Example workflows' : 'Workflows'}</Typography>
            {!landing && <ViewAllButton label="View all workflows" onClick={() => {
                const first = items.find(item => (item.origin || 'user') === 'user') ?? items[0];
                if (first) void edit(first); else createWorkflow();
            }} />}
            <Box sx={{ flex: 1 }} />
            {headerActions}
        </Box>
        {!landing && toolbar}
        <Box sx={{ overflowY: landing ? 'visible' : 'auto', minHeight: 0, pb: 1 }}>
        {!landing && !model && <Alert severity="info" sx={{ mx: 1, mb: 1 }}>Select a model to run a workflow.</Alert>}
        {renderGroups(landing ? ['demo', 'user', 'server'] : ['all'])}
        </Box>
        </>}

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