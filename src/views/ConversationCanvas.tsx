import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, ButtonBase, Typography, useTheme } from '@mui/material';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import InsertChartOutlinedIcon from '@mui/icons-material/InsertChartOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { DataFormulatorState, dfActions, dfSelectors, explanationContent } from '../app/dfSlice';
import { textVar } from '../app/layout';
import { readingTypography } from '../app/tokens';
import { getCachedChart } from '../app/chartCache';
import { TerminalMessageContent } from '../components/TerminalApprovalDialog';
import { CompactMarkdown, RunPlanChecklist } from './InteractionEntryCard';
import { ConversationWorkLog, workEntriesOf } from './ConversationWorkLog';
import { codeCallsOf } from '../app/toolCalls';
import { DataFrameTable } from './DataFrameTable';
import { HorizontalScrollFade } from '../components/ScrollFade';
import { apiRequest } from '../app/apiClient';
import { getUrls } from '../app/utils';
import { DictTable } from '../components/ComponentType';
import { isAppFile } from '../icons';
import { ThreadArtifactCard } from './DataThreadCards';
import { AppMiniature, ReportMiniature } from '../components/ArtifactMiniatures';
import { ThreadReferenceChips } from '../components/ThreadReferenceIcon';
import type { ThreadReference } from '../components/ComponentType';

/**
 * A result's first rows, shown when opened. A workspace table may keep none of its rows in the
 * session, so then they come from the server.
 */
const TableRowsPreview: React.FC<{ table: DictTable; rowCount: number; format: (row: Record<string, unknown>) => Record<string, unknown> }> = ({ table, rowCount, format }) => {
    const [fetched, setFetched] = useState<{ key: string; rows: any[] }>();
    const serverTable = table.rows.length === 0 && table.virtual ? table.virtual.tableId : undefined;
    useEffect(() => {
        if (!serverTable) return;
        let cancelled = false;
        apiRequest<{ rows: any[] }>(getUrls().SAMPLE_TABLE, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table: serverTable, size: 5 }),
        }).then(({ data }) => { if (!cancelled) setFetched({ key: serverTable, rows: data.rows || [] }); })
            .catch(() => { if (!cancelled) setFetched({ key: serverTable, rows: [] }); });
        return () => { cancelled = true; };
    }, [serverTable]);
    const rows = serverTable ? (fetched?.key === serverTable ? fetched.rows : []) : table.rows;
    return <HorizontalScrollFade>
        <DataFrameTable columns={table.names} rows={rows.map(format)} totalRows={rowCount}
            maxRows={5} maxColumns={6} autoWidth simple truncationIndicator="caption" />
    </HorizontalScrollFade>;
};
import { WorkflowFormArtifactView } from './SetupFormArtifacts';
import { chartTitleFits } from '../components/ComponentType';

/**
 * A thread read as one conversation (design-docs/58): its messages in order with
 * the items they produced inline. Without `nodeIds`, shows the one message and
 * the replies that branch from it.
 */
export const ConversationCanvas = ({ textTurnId, nodeIds, label }: { textTurnId: string; nodeIds?: string[]; label?: string }) => {
    const dispatch = useDispatch();
    const theme = useTheme();
    const { t } = useTranslation();
    const turns = useSelector((state: DataFormulatorState) => state.textTurns);
    const tables = useSelector(dfSelectors.getAllTables);
    const charts = useSelector(dfSelectors.getAllCharts);
    const thumbnails = useSelector((state: DataFormulatorState) => state.chartThumbnails);
    const loadedNodes = useSelector((state: DataFormulatorState) => state.loadedTableNodes);
    const graph = useSelector(dfSelectors.getThreadGraph);
    const fileNodes = useSelector((state: DataFormulatorState) => state.fileNodes);
    const reports = useSelector((state: DataFormulatorState) => state.generatedReports);
    const drafts = useSelector((state: DataFormulatorState) => state.draftNodes);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    // A path a tool call named opens what it names on the canvas, while that still exists.
    const openSessionPath = (path: string): (() => void) | undefined => {
        const match = (prefix: string, suffix: string) => path.startsWith(prefix) && path.endsWith(suffix)
            ? path.slice(prefix.length, path.length - suffix.length) : undefined;
        const tableName = match('session/tables/', '.json');
        const table = tableName ? tables.find(item => (item.virtual?.tableId || item.id) === tableName || item.id === tableName) : undefined;
        if (table) return () => dispatch(dfActions.setFocused({ type: 'table', tableId: table.id }));
        const chartId = match('session/charts/', '.json');
        if (chartId && charts.some(chart => chart.id === chartId)) return () => dispatch(dfActions.setFocused({ type: 'chart', chartId }));
        const reportId = match('session/reports/', '.md');
        if (reportId && reports.some(report => report.id === reportId)) return () => dispatch(dfActions.setFocused({ type: 'report', reportId }));
        const fileName = path.startsWith('files/') ? path.slice('files/'.length) : undefined;
        if (fileName && fileNodes.some(file => file.path === fileName)) return () => dispatch(dfActions.setFocused({ type: 'file', fileName }));
        return undefined;
    };
    const selectedRef = useRef<HTMLDivElement>(null);
    // Rows load only once a result's rows are opened.
    const [rowsOpened, setRowsOpened] = useState<Set<string>>(new Set());
    const path = nodeIds ?? [textTurnId];
    const pathIds = new Set(path);
    const firstPromptId = path.find(id => turns.find(turn => turn.id === id)?.prompt);
    const branchOptions = nodeIds ? [] : turns.filter(turn => turn.parentNodeId === path[path.length - 1] && !pathIds.has(turn.id));

    useEffect(() => {
        selectedRef.current?.scrollIntoView?.({ block: 'start' });
    }, [textTurnId]);

    const artifactButtonSx = { textTransform: 'none', fontSize: '0.8125rem', justifyContent: 'flex-start' } as const;
    // A soft raised surface rather than an outlined box.
    const cardSx = { borderRadius: 2, bgcolor: 'background.paper',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.03), 0 1px 2px rgba(16,24,40,0.04), 0 2px 8px rgba(16,24,40,0.025)' } as const;
    // Working numbers read at four significant figures, as people quote them.
    const roundRow = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
        [key, typeof value === 'number' && !Number.isInteger(value) ? Number(value.toPrecision(4)) : value]));
    // Reports, apps and files show as the same cards as in the thread, at a card's width.
    const reportArtifact = (report: typeof reports[number]) => <Box key={report.id} data-conversation-artifact sx={{ maxWidth: 320, my: 1.5 }}>
        <ThreadArtifactCard artifactType="report" title={report.title || t('conversation.report', { defaultValue: 'Report' })}
            selected={focusedId?.type === 'report' && focusedId.reportId === report.id}
            preview={<ReportMiniature chartIds={report.selectedChartIds || []} />}
            onClick={() => { dispatch(dfActions.setFocused({ type: 'report', reportId: report.id })); dispatch(dfActions.setViewMode('report')); }} />
    </Box>;
    const fileArtifact = (file: typeof fileNodes[number]) => {
        const isApp = isAppFile(file.path);
        return <Box key={file.id} data-conversation-artifact sx={{ maxWidth: 320, my: 1.5 }}>
            <ThreadArtifactCard artifactType={isApp ? 'app' : 'file'} title={file.displayName} notes={file.notes}
                selected={focusedId?.type === 'file' && focusedId.fileName === file.path}
                preview={isApp ? <AppMiniature path={file.path} version={file.contentHash} /> : undefined}
                onClick={() => dispatch(dfActions.setFocused({ type: 'file', fileName: file.path }))} />
        </Box>;
    };
    // Each exchange opens with the user's message, set apart from the one before it.
    const userMessage = (content: string, key: string, first: boolean, references?: ThreadReference[]) => <Box key={key} data-conversation-role="user"
        sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, mt: first ? 0 : 4, mb: 2 }}>
        <Typography sx={{ maxWidth: '80%', minWidth: 0, px: 2, py: 1.25, borderRadius: '18px 18px 4px 18px',
            // The same tint as the user's cards in the thread.
            bgcolor: theme.palette.custom?.bgcolor ?? 'action.hover',
            color: 'inherit', fontSize: 'inherit', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6 }}>{content}</Typography>
        {references?.length ? <ThreadReferenceChips references={references} sx={{ maxWidth: '80%', justifyContent: 'flex-end' }} /> : null}
    </Box>;
    const agentMessage = (children: React.ReactNode) => <Box data-conversation-role="agent"
        sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere',
            // Sections within a message: a heading opens with room above it (not at the message's start).
            '& :is(h1, h2, h3, h4):not(:first-child)': { mt: 3 } }}>{children}</Box>
    </Box>;
    // A result reads as a compact card: its title and size, its charts as images, and its rows only on request.
    const tableArtifacts = (tableId: string) => {
        const table = tables.find(item => item.id === tableId);
        if (!table) return null;
        const name = table.displayId || table.id;
        const rowCount = table.virtual?.rowCount ?? table.rows.length;
        const tableCharts = charts.filter(chart => chart.tableRef === table.id && !['Auto', '?', 'Table'].includes(chart.chartType));
        return <Box key={table.id} ref={table.id === textTurnId ? selectedRef : undefined}
            data-conversation-entry={table.id} sx={{ my: 3, scrollMarginTop: 12 }}>
            <Box sx={{ ...cardSx, overflow: 'hidden' }}>
                <ButtonBase onClick={() => dispatch(dfActions.setFocused({ type: 'table', tableId: table.id }))}
                    aria-label={t('conversation.openTableNamed', { defaultValue: 'Open table: {{name}}', name })}
                    sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', gap: 1, px: 1.5, py: 1, textAlign: 'left',
                        '&:hover': { bgcolor: 'action.hover' }, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>
                    <TableChartOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
                    <Typography component="span" sx={{ flex: 1, minWidth: 0, fontSize: '0.875rem', fontWeight: 500,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Typography>
                    <Typography component="span" sx={{ flexShrink: 0, fontSize: '0.8125rem', color: 'text.secondary' }}>
                        {t('conversation.tableSize', { defaultValue: '{{rows}} rows × {{columns}} columns',
                            rows: rowCount.toLocaleString(), columns: table.names.length })}
                    </Typography>
                </ButtonBase>
                {tableCharts.map(chart => {
                    const cached = getCachedChart(chart.id);
                    const image = cached?.fullPngDataUrl || thumbnails?.[chart.id];
                    const label = `${chart.chartType} - ${name}`;
                    // A chart not yet drawn here is a line that opens it.
                    if (!image) return <ButtonBase key={chart.id} onClick={() => dispatch(dfActions.setFocused({ type: 'chart', chartId: chart.id }))}
                        aria-label={t('conversation.openChartNamed', { defaultValue: 'Open chart: {{name}}', name: label })}
                        sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', gap: 1, px: 1.5, py: 0.75,
                            fontSize: '0.8125rem', color: 'text.secondary', '&:hover': { bgcolor: 'action.hover', color: 'text.primary' } }}>
                        <InsertChartOutlinedIcon sx={{ fontSize: 16 }} />{label}
                    </ButtonBase>;
                    // The image carries the chart's title; it also names the chart for screen readers.
                    const titled = chartTitleFits(chart);
                    return <Box key={chart.id} component="button" type="button"
                        aria-label={t('conversation.openChartNamed', { defaultValue: 'Open chart: {{name}}', name: titled ? chart.title! : label })}
                        onClick={() => dispatch(dfActions.setFocused({ type: 'chart', chartId: chart.id }))}
                        sx={{ display: 'block', width: '100%', boxSizing: 'border-box', px: 2, pt: 1, pb: 2, border: 0,
                            bgcolor: 'transparent', cursor: 'pointer',
                            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>
                        <Box component="img" src={image} alt={label} sx={{ display: 'block', width: '100%', height: 'auto',
                            maxWidth: Math.min(cached?.displayWidth || 480, 560), mx: 'auto', objectFit: 'contain',
                            ...(cached?.displayWidth && cached?.displayHeight ? { aspectRatio: `${cached.displayWidth} / ${cached.displayHeight}` } : {}) }} />
                    </Box>;
                })}
                <Box component="details" sx={{
                    '& > summary': { cursor: 'pointer', px: 1.5, py: 0.75, fontSize: '0.8125rem', color: 'text.secondary', listStyle: 'none',
                        '&::-webkit-details-marker': { display: 'none' }, '&:hover': { color: 'text.primary' } } }}>
                    <Box component="summary" onClick={() => setRowsOpened(previous => new Set(previous).add(table.id))}>
                        {t('conversation.showRows', { defaultValue: 'Show rows' })}</Box>
                    <Box sx={{ px: 1.5, pb: 1.25 }}>
                        {rowsOpened.has(table.id) && <TableRowsPreview table={table} rowCount={rowCount} format={roundRow} />}
                    </Box>
                </Box>
            </Box>
        </Box>;
    };

    return <Box id="vis-view-canvas" sx={{ height: '100%', width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
        {/* No header: the canvas tab names the conversation. */}
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 3, pt: 3, pb: 6 }}>
            {/* A reading column: 14px type, generous leading, about 80 characters a line. */}
            <Box sx={{ maxWidth: 720, mx: 'auto', fontFamily: readingTypography.fontFamily, fontSize: '0.875rem', lineHeight: 1.65,
                color: readingTypography.color, '& strong': { fontWeight: 600 },
                '--df-text-xs': '0.75rem', '--df-text-sm': '0.8125rem', '--df-text-md': '0.875rem',
            }}>
                {/* Where the thread starts, marked as in the thread list. */}
                {label && <Box data-conversation-start sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 2, color: 'text.secondary' }}>
                    <Box component="span" aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid', borderColor: 'text.disabled' }} />
                    <Typography component="span" sx={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0 }}>
                        {label}
                    </Typography>
                    <Box component="span" aria-hidden="true" sx={{ flex: 1, height: '1px', ml: 0.5, bgcolor: 'divider' }} />
                </Box>}
                {path.map(nodeId => {
                    switch (graph.kindOf(nodeId)) {
                        case 'report': {
                            const report = reports.find(item => item.id === nodeId);
                            return report ? reportArtifact(report) : null;
                        }
                        case 'file': {
                            const file = fileNodes.find(item => item.id === nodeId);
                            return file ? fileArtifact(file) : null;
                        }
                        case 'table':
                            return tableArtifacts(nodeId);
                        case 'loaded-table': {
                            const node = loadedNodes.find(item => item.id === nodeId);
                            return node && !node.external ? tableArtifacts(node.tableId) : null;
                        }
                        case 'draft': {
                            const draft = drafts.find(item => item.id === nodeId);
                            return draft ? <Box key={draft.id} sx={{ py: 1.5, color: 'text.secondary' }}>
                                {agentMessage(<>
                                <Typography sx={{ fontSize: textVar.xs }}>{t(`conversation.run.${draft.derive.status}`, { defaultValue: draft.derive.status })}</Typography>
                                {draft.derive.runningPlan && <CompactMarkdown content={draft.derive.runningPlan} color={theme.palette.text.secondary} />}
                                </>)}
                            </Box> : null;
                        }
                        case 'turn':
                        case 'workflow-definition':
                            break;
                        default:
                            return null;
                    }
                    const turn = turns.find(item => item.id === nodeId);
                    if (!turn) return null;
                    // A step's text that only repeats what its tool call did is already on the call.
                    const callPurposes = new Set([...(turn.executions || []), ...codeCallsOf(turn)]
                        .map(call => (call.purpose || '').trim()).filter(Boolean));
                    const content = callPurposes.has(explanationContent(turn.content).trim()) ? '' : explanationContent(turn.content);
                    const hasWork = workEntriesOf(turn).length > 0;
                    const hasAgentPart = !!content || hasWork || !!turn.plan?.length || !!turn.form || !!turn.dataOperation
                        || (turn.textKind === 'clarify' && !turn.answered);
                    return <React.Fragment key={turn.id}>
                        {turn.prompt && userMessage(turn.prompt, `${turn.id}-prompt`, turn.id === firstPromptId, turn.references)}
                        <Box ref={turn.id === textTurnId ? selectedRef : undefined} data-conversation-entry={turn.id} sx={{
                            scrollMarginTop: 12,
                        }}>
                            {hasAgentPart && agentMessage(<>
                            {/* The work behind the message first, as in a chat transcript; each line opens its details. */}
                            <ConversationWorkLog turn={turn} onOpenPath={openSessionPath} />
                            <TerminalMessageContent content={content} variant="document" />
                            {!!turn.plan?.length && <Box sx={{ my: 1, maxWidth: 480 }}>
                                <RunPlanChecklist items={turn.plan} title={turn.planTitle} defaultExpanded />
                            </Box>}
                            {turn.form?.kind === 'workflow' && <WorkflowFormArtifactView turn={turn} form={turn.form} />}
                            {((turn.form && turn.form.kind !== 'workflow') || turn.dataOperation || (turn.textKind === 'clarify' && !turn.answered)) && <Button startIcon={<OpenInNewIcon />} sx={artifactButtonSx}
                                onClick={() => dispatch(dfActions.setFocused({ type: 'text', textId: turn.id }))}>
                                {turn.form?.title || t('conversation.openInteraction', { defaultValue: 'Open interaction' })}
                            </Button>}
                            </>)}
                        </Box>
                    </React.Fragment>;
                })}
                {branchOptions.map(turn => <Button key={turn.id} startIcon={<OpenInNewIcon />} sx={{ ...artifactButtonSx, display: 'flex', my: 1, maxWidth: '100%' }}
                    onClick={() => dispatch(dfActions.setFocused({ type: 'text', textId: turn.id }))}>
                    <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{turn.prompt || turn.content}</Box>
                </Button>)}
            </Box>
        </Box>
    </Box>;
};