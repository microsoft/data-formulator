import React, { useEffect, useRef } from 'react';
import { alpha, Box, Button, IconButton, Tooltip, Typography, useTheme } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { DataFormulatorState, dfActions, dfSelectors, explanationContent } from '../app/dfSlice';
import { iconVar, textVar } from '../app/layout';
import { getCachedChart } from '../app/chartCache';
import { TerminalMessageContent } from '../components/TerminalApprovalDialog';
import { CompactMarkdown } from './InteractionEntryCard';
import { DataFrameTable } from './DataFrameTable';
import { WorkflowFormArtifactView } from './SetupFormArtifacts';

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
    const path = nodeIds ?? [textTurnId];
    const pathIds = new Set(path);
    const branchOptions = nodeIds ? [] : turns.filter(turn => turn.parentNodeId === path[path.length - 1] && !pathIds.has(turn.id));

    useEffect(() => {
        selectedRef.current?.scrollIntoView?.({ block: 'start' });
    }, [textTurnId]);

    const artifactButtonSx = { textTransform: 'none', fontSize: textVar.xs, justifyContent: 'flex-start' } as const;
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
    const userMessage = (content: string, key: string) => <Box key={key} data-conversation-role="user"
        sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', gap: 1, mb: 1.5 }}>
        <Typography sx={{ maxWidth: '80%', minWidth: 0, px: 1.75, py: 1, borderRadius: '16px 16px 4px 16px',
            bgcolor: alpha(theme.palette.primary.main, 0.10),
            color: 'text.primary', fontSize: textVar.md, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6 }}>{content}</Typography>
    </Box>;
    const agentMessage = (children: React.ReactNode) => <Box data-conversation-role="agent"
        sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</Box>
    </Box>;
    const tableArtifacts = (tableId: string) => {
        const table = tables.find(item => item.id === tableId);
        if (!table) return null;
        return <Box key={table.id} ref={table.id === textTurnId ? selectedRef : undefined}
            data-conversation-entry={table.id} sx={{ py: 1, scrollMarginTop: 12 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography sx={{ flex: 1, minWidth: 0, fontSize: textVar.md, fontWeight: 600, overflowWrap: 'anywhere' }}>{table.displayId || table.id}</Typography>
                <Tooltip title={t('conversation.openTable', { defaultValue: 'Open table' })}>
                    <IconButton size="small" aria-label={t('conversation.openTableNamed', { defaultValue: 'Open table: {{name}}', name: table.displayId || table.id })}
                        onClick={() => dispatch(dfActions.setFocused({ type: 'table', tableId: table.id }))}>
                        <OpenInNewIcon sx={{ fontSize: iconVar.sm }} />
                    </IconButton>
                </Tooltip>
            </Box>
            <Box sx={{ maxWidth: '100%', overflowX: 'auto', mb: 1.5 }}>
                <DataFrameTable columns={table.names} rows={table.rows} totalRows={table.virtual?.rowCount ?? table.rows.length}
                    maxRows={5} maxColumns={6} autoWidth simple truncationIndicator="caption" />
            </Box>
            {charts.filter(chart => chart.tableRef === table.id && !['Auto', '?', 'Table'].includes(chart.chartType)).map(chart => {
                const cached = getCachedChart(chart.id);
                const image = cached?.fullPngDataUrl || thumbnails?.[chart.id];
                const label = `${chart.chartType} - ${table.displayId || table.id}`;
                return <Box key={chart.id} sx={{ my: 1.5, width: Math.max(360, Math.min(640, (cached?.naturalWidth || 480) + 26)), maxWidth: '100%', minWidth: 0,
                    boxSizing: 'border-box', border: '1px solid', borderColor: 'divider', borderRadius: 1,
                    overflow: 'hidden', bgcolor: 'background.paper' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, pt: 0.75, pb: 0.25 }}>
                        <Typography sx={{ flex: 1, minWidth: 0, fontSize: textVar.sm, fontWeight: 500, overflowWrap: 'anywhere' }}>{label}</Typography>
                        <Tooltip title={t('conversation.openChart', { defaultValue: 'Open chart' })}>
                            <IconButton size="small" aria-label={t('conversation.openChartNamed', { defaultValue: 'Open chart: {{name}}', name: label })}
                                sx={{ flexShrink: 0 }}
                                onClick={() => dispatch(dfActions.setFocused({ type: 'chart', chartId: chart.id }))}>
                                <OpenInNewIcon sx={{ fontSize: iconVar.sm }} />
                            </IconButton>
                        </Tooltip>
                    </Box>
                    {image && <Tooltip title={t('conversation.openChart', { defaultValue: 'Open chart' })}>
                        <Box component="button" type="button" aria-label={label}
                            onClick={() => dispatch(dfActions.setFocused({ type: 'chart', chartId: chart.id }))}
                            sx={{ display: 'block', width: '100%', boxSizing: 'border-box',
                                p: 1.5, border: 0, bgcolor: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'text.secondary',
                                fontFamily: theme.typography.fontFamily, fontSize: textVar.xs,
                                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
                            }}>
                            <Box component="img" src={image} alt={label} sx={{ display: 'block', width: '100%', height: 'auto',
                                maxWidth: cached?.naturalWidth || 480, mx: 'auto',
                                objectFit: 'contain', ...(cached?.naturalWidth && cached?.naturalHeight
                                    ? { aspectRatio: `${cached.naturalWidth} / ${cached.naturalHeight}` } : {}),
                            }} />
                        </Box>
                    </Tooltip>}
                </Box>;
            })}
        </Box>;
    };

    return <Box id="vis-view-canvas" sx={{ height: '100%', width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1.5, pr: 6, py: 0.5, minHeight: 40, borderBottom: '1px solid', borderColor: 'divider' }}>
            <ForumOutlinedIcon sx={{ fontSize: iconVar.md, color: 'text.primary' }} />
            <Typography component="h2" sx={{ fontSize: textVar.lg, fontWeight: 600, flex: 1 }}>{t('conversation.title', { defaultValue: 'Conversation' })}</Typography>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, pt: 2, pb: 3 }}>
            <Box sx={{ maxWidth: 800, mx: 'auto', fontSize: textVar.md, color: 'text.primary',
                '& strong': { fontWeight: 600 },
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
                    const content = explanationContent(turn.content);
                    const hasAgentPart = !!content || !!turn.executions?.length || !!turn.form || !!turn.dataOperation
                        || (turn.textKind === 'clarify' && !turn.answered);
                    return <React.Fragment key={turn.id}>
                        {turn.prompt && userMessage(turn.prompt, `${turn.id}-prompt`)}
                        <Box ref={turn.id === textTurnId ? selectedRef : undefined} data-conversation-entry={turn.id} sx={{
                            scrollMarginTop: 12,
                        }}>
                            {hasAgentPart && agentMessage(<>
                            <TerminalMessageContent content={content} executions={turn.executions} variant="document" />
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