import React, { useEffect, useRef, useState } from 'react';
import { alpha, Box, Button, ButtonBase, IconButton, Tooltip, Typography, useTheme } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import InsertChartOutlinedIcon from '@mui/icons-material/InsertChartOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { DataFormulatorState, dfActions, dfSelectors, explanationContent } from '../app/dfSlice';
import { iconVar, textVar } from '../app/layout';
import { readingTypography } from '../app/tokens';
import { getCachedChart } from '../app/chartCache';
import { TerminalMessageContent } from '../components/TerminalApprovalDialog';
import { CompactMarkdown, RunPlanChecklist } from './InteractionEntryCard';
import { ConversationWorkLog, workEntriesOf } from './ConversationWorkLog';
import { DataFrameTable } from './DataFrameTable';
import { WorkflowFormArtifactView } from './SetupFormArtifacts';
import { CanvasHeader, CanvasHeaderAction } from './CanvasHeader';
import { computeInsightKey } from '../components/ComponentType';

/**
 * A thread read as one conversation (design-docs/58): its messages in order with
 * the items they produced inline. Without `nodeIds`, shows the one message and
 * the replies that branch from it.
 */
export const ConversationCanvas = ({ textTurnId, nodeIds }: { textTurnId: string; nodeIds?: string[] }) => {
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
    const selectedRef = useRef<HTMLDivElement>(null);
    // Refresh redraws the conversation from the current session state (and re-reads chart images).
    const [revision, setRevision] = useState(0);
    const path = nodeIds ?? [textTurnId];
    const pathIds = new Set(path);
    const firstPromptId = path.find(id => turns.find(turn => turn.id === id)?.prompt);
    const requestCount = path.filter(id => turns.find(turn => turn.id === id)?.prompt).length;
    const branchOptions = nodeIds ? [] : turns.filter(turn => turn.parentNodeId === path[path.length - 1] && !pathIds.has(turn.id));

    useEffect(() => {
        selectedRef.current?.scrollIntoView?.({ block: 'start' });
    }, [textTurnId]);

    const artifactButtonSx = { textTransform: 'none', fontSize: '0.8125rem', justifyContent: 'flex-start' } as const;
    const cardSx = { border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper' } as const;
    // Working numbers read at four significant figures, as people quote them.
    const roundRow = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
        [key, typeof value === 'number' && !Number.isInteger(value) ? Number(value.toPrecision(4)) : value]));
    const reportArtifact = (report: typeof reports[number]) => <Button key={report.id} startIcon={<OpenInNewIcon />} sx={artifactButtonSx}
        onClick={() => { dispatch(dfActions.setFocused({ type: 'report', reportId: report.id })); dispatch(dfActions.setViewMode('report')); }}>{report.title || t('conversation.report', { defaultValue: 'Report' })}</Button>;
    const fileArtifact = (file: typeof fileNodes[number]) => <Box key={file.id} sx={{ mb: 1 }}>
        <Tooltip describeChild title={file.path}>
            <Button startIcon={<AttachFileIcon />} sx={{ ...artifactButtonSx, maxWidth: '100%', overflowWrap: 'anywhere' }}
                onClick={() => dispatch(dfActions.setFocused({ type: 'file', fileName: file.path }))}>
                {file.displayName}
            </Button>
        </Tooltip>
        {file.notes && <Typography sx={{ fontSize: textVar.sm, overflowWrap: 'anywhere' }}>{file.notes}</Typography>}
    </Box>;
    // Each exchange opens with the user's message, set apart from the one before it.
    const userMessage = (content: string, key: string, first: boolean) => <Box key={key} data-conversation-role="user"
        sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', gap: 1, mt: first ? 0 : 4, mb: 2 }}>
        <Typography sx={{ maxWidth: '80%', minWidth: 0, px: 2, py: 1.25, borderRadius: '18px 18px 4px 18px',
            bgcolor: alpha(theme.palette.primary.main, 0.08),
            color: 'inherit', fontSize: 'inherit', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6 }}>{content}</Typography>
    </Box>;
    const agentMessage = (children: React.ReactNode) => <Box data-conversation-role="agent"
        sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.25 }}>
        <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</Box>
    </Box>;
    // A result reads as a compact card: its title and size, its charts as images, and its rows only on request.
    const tableArtifacts = (tableId: string) => {
        const table = tables.find(item => item.id === tableId);
        if (!table) return null;
        const name = table.displayId || table.id;
        const rowCount = table.virtual?.rowCount ?? table.rows.length;
        const tableCharts = charts.filter(chart => chart.tableRef === table.id && !['Auto', '?', 'Table'].includes(chart.chartType));
        return <Box key={table.id} ref={table.id === textTurnId ? selectedRef : undefined}
            data-conversation-entry={table.id} sx={{ my: 1.5, scrollMarginTop: 12 }}>
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
                        sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', gap: 1, px: 1.5, py: 0.75, borderTop: '1px solid',
                            borderColor: 'divider', fontSize: '0.8125rem', color: 'text.secondary', '&:hover': { bgcolor: 'action.hover', color: 'text.primary' } }}>
                        <InsertChartOutlinedIcon sx={{ fontSize: 16 }} />{label}
                    </ButtonBase>;
                    // The image carries the chart's title; it also names the chart for screen readers.
                    const titled = !!chart.title && chart.titleKey === computeInsightKey(chart);
                    return <Box key={chart.id} component="button" type="button"
                        aria-label={t('conversation.openChartNamed', { defaultValue: 'Open chart: {{name}}', name: titled ? chart.title! : label })}
                        onClick={() => dispatch(dfActions.setFocused({ type: 'chart', chartId: chart.id }))}
                        sx={{ display: 'block', width: '100%', boxSizing: 'border-box', p: 2, border: 0, borderTop: '1px solid',
                            borderColor: 'divider', bgcolor: 'transparent', cursor: 'pointer',
                            '&:hover': { bgcolor: 'rgba(0,0,0,0.015)' },
                            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>
                        <Box component="img" src={image} alt={label} sx={{ display: 'block', width: '100%', height: 'auto',
                            maxWidth: Math.min(cached?.naturalWidth || 480, 560), mx: 'auto', objectFit: 'contain',
                            ...(cached?.naturalWidth && cached?.naturalHeight ? { aspectRatio: `${cached.naturalWidth} / ${cached.naturalHeight}` } : {}) }} />
                    </Box>;
                })}
                <Box component="details" sx={{ borderTop: '1px solid', borderColor: 'divider',
                    '& > summary': { cursor: 'pointer', px: 1.5, py: 0.75, fontSize: '0.8125rem', color: 'text.secondary', listStyle: 'none',
                        '&::-webkit-details-marker': { display: 'none' }, '&:hover': { color: 'text.primary' } } }}>
                    <Box component="summary">{t('conversation.showRows', { defaultValue: 'Show rows' })}</Box>
                    <Box sx={{ px: 1.5, pb: 1.25, overflowX: 'auto' }}>
                        <DataFrameTable columns={table.names} rows={table.rows.map(roundRow)} totalRows={rowCount}
                            maxRows={5} maxColumns={6} autoWidth simple truncationIndicator="caption" />
                    </Box>
                </Box>
            </Box>
        </Box>;
    };

    return <Box id="vis-view-canvas" sx={{ height: '100%', width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
        <CanvasHeader icon={<ForumOutlinedIcon />} title={t('conversation.title', { defaultValue: 'Conversation' })}
            meta={requestCount ? t('conversation.requestCount', { defaultValue: '{{count}} requests', count: requestCount }) : undefined}
            actions={<CanvasHeaderAction label={t('conversation.refresh', { defaultValue: 'Refresh' })} onClick={() => setRevision(value => value + 1)}>
                <RefreshIcon />
            </CanvasHeaderAction>} />
        <Box key={revision} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 3, pt: 3, pb: 6 }}>
            {/* A reading column: 15px type, generous leading, about 75 characters a line. */}
            <Box sx={{ maxWidth: 720, mx: 'auto', fontFamily: readingTypography.fontFamily, fontSize: '0.9375rem', lineHeight: 1.65,
                color: readingTypography.color, '& strong': { fontWeight: 600 },
                '--df-text-xs': '0.8125rem', '--df-text-sm': '0.875rem', '--df-text-md': '0.9375rem',
            }}>
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
                    const callPurposes = new Set([...(turn.executions || []), ...(turn.codeExecutions || [])]
                        .map(call => (call.purpose || '').trim()).filter(Boolean));
                    const content = callPurposes.has(explanationContent(turn.content).trim()) ? '' : explanationContent(turn.content);
                    const hasWork = workEntriesOf(turn).length > 0;
                    const hasAgentPart = !!content || hasWork || !!turn.plan?.length || !!turn.form || !!turn.dataOperation
                        || (turn.textKind === 'clarify' && !turn.answered);
                    return <React.Fragment key={turn.id}>
                        {turn.prompt && userMessage(turn.prompt, `${turn.id}-prompt`, turn.id === firstPromptId)}
                        <Box ref={turn.id === textTurnId ? selectedRef : undefined} data-conversation-entry={turn.id} sx={{
                            scrollMarginTop: 12,
                        }}>
                            {hasAgentPart && agentMessage(<>
                            {/* The work behind the message first, as in a chat transcript; each line opens its details. */}
                            <ConversationWorkLog turn={turn} />
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