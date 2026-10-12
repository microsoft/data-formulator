// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
    Box,
    Typography,
    LinearProgress,
    ListItemIcon,
    IconButton,
    Tooltip,

    useTheme,
    SxProps,
    Button,
    ButtonBase,
    CircularProgress,
    Badge,
    Collapse,
    Card,
} from '@mui/material';


import '../scss/VisualizationView.scss';
import { useTranslation } from 'react-i18next';
import { batch, useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors, SSEMessage, GeneratedReport } from '../app/dfSlice';
import { getUrls, fetchWithIdentity } from '../app/utils';
import { extractErrorMessage } from '../app/errorHandler';
import { Chart, ComputationInputSource, DictTable, DraftNode, InteractionEntry, TextTurn, LoadedTableNode, FileNode, isConversationRootId, ProgressStep } from "../components/ComponentType";
import { buildThreads, type ThreadSpec } from '../app/threadGraph';
import { classifyInputSourceTransition, shouldShowInputSourceTransition } from '../app/agentInteractionPolicy';
import { CATALOG_TABLE_ITEM } from '../components/DndTypes';
import type { CatalogTableDragItem } from '../components/DndTypes';
import { ScrollFadeEdge, useScrollFade } from '../components/ScrollFade';
import { loadTable } from '../app/tableThunks';
import { AppDispatch } from '../app/store';
import { WorkflowProgress } from './WorkflowPanel';
import { formArtifactStatus } from '../app/setupForms';
import { WorkflowGears } from '../components/FunComponents';
import { createExternalTableReference, externalReferenceTitle, loadsAsConnectorReference, isSemanticConnectorTable, deleteWorkspaceFile, importConnectorFile, listWorkspaceFiles, onWorkspaceFilesChanged, type WorkspaceFile } from '../app/workspaceService';
import dfLogo from '../assets/df-logo.svg';

import DeleteIcon from '@mui/icons-material/Delete';
import PersonIcon from '@mui/icons-material/Person';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { TableIcon, InsightIcon, StreamIcon, AgentIcon } from '../icons';


import _ from 'lodash';
import { getChartTemplate } from '../components/ChartTemplates';

import 'prismjs/components/prism-python' // Language
import 'prismjs/components/prism-typescript' // Language
import 'prismjs/themes/prism.css'; //Example style, you can use another

import { checkChartAvailability, generateChartSkeleton, getDataTable } from './ChartUtils';
import { getConversationSourceKey } from './threadProvenance';
import { findLeadIn, findRevealTarget, revealDelta } from './threadReveal';

import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import HtmlIcon from '@mui/icons-material/Html';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CodeIcon from '@mui/icons-material/Code';

import { alpha } from '@mui/material/styles';

import BarChartIcon from '@mui/icons-material/BarChart';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot';
import PieChartOutlineIcon from '@mui/icons-material/PieChartOutline';
import GridOnIcon from '@mui/icons-material/GridOn';
import { buildTableCard, buildTableRefChip, buildChartCards, BuildTableCardProps, ThreadArtifactCard, ArtifactDeleteButton } from './DataThreadCards';
import { SourceTableShelf, SHELF_VISIBLE_LIMIT } from './SourceTableShelf';
import { UnifiedDataUploadDialog } from './UnifiedDataUploadDialog';
import { AgentRulesDialog } from './AgentRulesDialog';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';

import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { AgentToyIcon } from './AgentToyIcon';
import ArticleIcon from '@mui/icons-material/Article';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import TerminalIcon from '@mui/icons-material/Terminal';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SearchIcon from '@mui/icons-material/Search';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
import CallMergeIcon from '@mui/icons-material/CallMerge';

import { transition, radius, borderColor, conversationWidth } from '../app/tokens';

import { SimpleChartRecBox } from './SimpleChartRecBox';
import { InteractionEntryCard, getEntryGutterIcon, getDefaultGutterIcon, PlanStepsView } from './InteractionEntryCard';
import { fittableThreadColumnsFor, iconVar, textVar } from '../app/layout';
import { useLayout } from '../app/LayoutProvider';

/** Pick the icon component for a step line based on known prefixes. */
// Re-exported from InteractionEntryCard — kept here for backward compat with gutter icon logic

const openToolActivity = (nodeId: string, execution: NonNullable<TextTurn['executions']>[number] | NonNullable<TextTurn['codeExecutions']>[number]) => {
    window.dispatchEvent(new CustomEvent('df-view-tool-activity', { detail: { nodeId, execution } }));
};

const ToolActivitySelectionContext = React.createContext<{ nodeId: string; executionId: string } | null>(null);

const ToolActivityRow: React.FC<{ nodeId: string; label: string; executions: NonNullable<TextTurn['executions']>;
    codeExecutions: NonNullable<TextTurn['codeExecutions']>; active?: boolean;
    onSelect: (execution: NonNullable<TextTurn['executions']>[number] | NonNullable<TextTurn['codeExecutions']>[number]) => void;
    // Removes the step; offered when nothing follows it.
    onDelete?: () => void;
}> = ({ nodeId, label, executions, codeExecutions, active = false, onSelect, onDelete }) => {
    const { t } = useTranslation();
    const selection = React.useContext(ToolActivitySelectionContext);
    const [expanded, setExpanded] = useState(selection?.nodeId === nodeId);
    const calls = [...executions, ...codeExecutions].sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
    return <Box data-tool-activity-row sx={{ width: '100%', minWidth: 0,
        '& [data-tool-activity-delete]': { opacity: 0 }, '&:hover [data-tool-activity-delete], &:focus-within [data-tool-activity-delete]': { opacity: 1 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <ButtonBase onClick={() => setExpanded(previous => !previous)} aria-expanded={expanded}
        aria-label={t('dataThread.viewStepActivity', { defaultValue: 'View step tool calls' })}
        title={label} sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', gap: 0.5,
            py: '2px', color: 'text.secondary', textAlign: 'left', '&:hover': { bgcolor: 'action.hover' },
            '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
        <ChevronRightIcon sx={{ width: 10, height: 10, flexShrink: 0, transform: expanded ? 'rotate(90deg)' : undefined }} />
        {active && <CircularProgress size={8} color="inherit" sx={{ flexShrink: 0 }} />}
        <Typography component="span" sx={{ minWidth: 0, fontSize: textVar.xxs, fontStyle: 'italic',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Typography>
        <Typography component="span" sx={{ flexShrink: 0, fontSize: textVar.xxs, color: 'text.disabled', whiteSpace: 'nowrap' }}>
            {t('dataThread.toolCallCount', { count: calls.length, defaultValue: '{{count}} calls' })}
        </Typography>
        </ButtonBase>
        {onDelete && <Box data-tool-activity-delete sx={{ flexShrink: 0, transition: transition.fast,
            '& .MuiIconButton-root': { p: '2px' }, '& svg': { fontSize: 14 } }}>
            <ArtifactDeleteButton label={t('dataThread.deleteStep', { defaultValue: 'Delete step' })} onClick={onDelete} />
        </Box>}
        </Box>
        <Collapse in={expanded} unmountOnExit>
            <Box sx={{ pl: 0, minWidth: 0 }}>
                {calls.map(execution => {
                    const selected = selection?.nodeId === nodeId && selection.executionId === execution.id;
                    const statusLabel = t(`terminal.status.${execution.status}`, { defaultValue: execution.status });
                    const StatusIcon = execution.status === 'completed' ? CheckCircleOutlineIcon
                        : execution.status === 'failed' || execution.status === 'rejected' ? ErrorOutlineIcon
                        : execution.status === 'interrupted' ? PauseCircleOutlineIcon : HelpOutlineIcon;
                    return <ButtonBase key={execution.id} aria-label={execution.purpose} aria-pressed={selected}
                    title={execution.purpose} onClick={() => onSelect(execution)}
                    sx={{ display: 'flex', width: '100%', minWidth: 0, justifyContent: 'flex-start', gap: 0.5, py: '2px',
                        pl: 0, pr: 0.5, borderRadius: 0.5, bgcolor: selected ? 'action.selected' : 'transparent',
                        color: selected ? 'text.primary' : 'text.secondary', textAlign: 'left',
                        '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
                        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
                    {'code' in execution ? <CodeIcon sx={{ width: 10, height: 10, flexShrink: 0 }} />
                        : <TerminalIcon sx={{ width: 10, height: 10, flexShrink: 0 }} />}
                    <Typography component="span" sx={{ flex: 1, minWidth: 0, fontSize: textVar.xxs, fontStyle: 'italic',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{execution.purpose}</Typography>
                    <Tooltip title={statusLabel}>
                        <Box component="span" role={execution.status === 'running' ? undefined : 'img'}
                            aria-label={execution.status === 'running' ? undefined : statusLabel}
                            sx={{ width: 12, height: 12, flexShrink: 0, display: 'flex', alignItems: 'center',
                                justifyContent: 'center', color: 'text.secondary' }}>
                            {execution.status === 'running'
                                ? <CircularProgress size={8} color="inherit" aria-label={statusLabel} />
                                : <StatusIcon sx={{ width: 10, height: 10 }} />}
                        </Box>
                    </Tooltip>
                </ButtonBase>;
                })}
            </Box>
        </Collapse>
    </Box>;
};

/** The active step of a run's progress; shimmers while the run works on it. */
export const ThinkingStepsBanner = (steps: (ProgressStep | string)[], sx?: SxProps, active: boolean = true) => {
    const lastStep = steps.length > 0 ? steps[steps.length - 1] : '';
    return (
        <Box sx={{ ...sx }}>
            <PlanStepsView steps={lastStep ? [lastStep] : []} activeLastStep={active} />
        </Box>
    );
};

const WorkspacePanel: FC<{
    tables: DictTable[],
    chartElements: { tableId: string, chartId: string, element: any }[],
    sx?: SxProps,
}> = function ({ tables, chartElements, sx }) {
    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const charts = useSelector(dfSelectors.getAllCharts);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const focusedTableId = React.useMemo(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        if (focusedId.type === 'chart') {
            const chart = charts.find(c => c.id === focusedId.chartId);
            return chart?.tableRef;
        }
        return undefined;
    }, [focusedId, charts]);
    const focusedChartId = focusedId?.type === 'chart' ? focusedId.chartId : undefined;
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const [agentRulesOpen, setAgentRulesOpen] = useState(false);
    const [workspaceExpanded, setWorkspaceExpanded] = useState(false);

    const fileItemSx = (isActive: boolean, isNested: boolean = false) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.75,
        py: '3px',
        borderRadius: '3px',
        cursor: 'pointer',
        fontSize: textVar.xs,
        transition: transition.fast,
        backgroundColor: isActive ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
        '&:hover': {
            backgroundColor: isActive ? alpha(theme.palette.primary.main, 0.12) : 'rgba(0,0,0,0.04)',
        },
    });

    const getTableIcon = (table: DictTable) => {
        const isStreaming = (table.source?.type === 'stream' || table.source?.type === 'database') && table.source?.autoRefresh;
        const iconSx = { width: 14, height: 14, color: 'text.secondary', flexShrink: 0 };
        if (isStreaming) return <StreamIcon sx={{ ...iconSx, color: theme.palette.success.main, animation: 'pulse 2s infinite', '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.4 }, '100%': { opacity: 1 } } }} />;
        if (table.virtual) return <TableIcon sx={{ ...iconSx, width: 14, height: 14 }} />;
        return <TableIcon sx={iconSx} />;
    };

    const getChartIcon = (chartType: string) => {
        const template = getChartTemplate(chartType);
        if (template && template.icon) {
            // Use chart template icon (it's an image path)
            if (typeof template.icon === 'string') {
                return <Box component="img" src={template.icon} sx={{ width: 14, height: 14, objectFit: 'contain' }} />;
            }
            // Or it could be a React component
            return <Box sx={{ width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>{template.icon}</Box>;
        }
        // Fallback to generic chart icon
        return <InsightIcon sx={{ fontSize: iconVar.sm, color: 'text.secondary' }} />;
    };

    const getChartFields = (chart: Chart) => {
        const encodings = Object.entries(chart.encodingMap)
            .filter(([_, encoding]) => encoding.fieldID)
            .map(([channel, encoding]) => {
                const field = conceptShelfItems.find(f => f.id === encoding.fieldID);
                return field?.name || encoding.fieldID;
            })
            .filter(Boolean);
        return encodings.slice(0, 3).join(', ') + (encodings.length > 3 ? '...' : '');
    };

    const getOriginalTableName = (table: DictTable): string | null => {
        if (table.derive) return null;
        const name = table.source?.originalTableName;
        if (!name || name === (table.displayId || table.id)) return null;
        return name;
    };

    const getSourceTooltip = (table: DictTable): string | null => {
        if (table.derive) return null;
        const src = table.source;
        if (!src) return null;
        switch (src.type) {
            case 'file': return src.fileName || t('dataThread.sourceFile');
            case 'paste': return t('dataThread.sourcePaste');
            case 'url': return src.url || t('dataThread.sourceUrl');
            case 'stream': {
                if (src.url) {
                    try { return new URL(src.url).hostname; } catch { /* fall through */ }
                }
                return t('dataThread.sourceStream');
            }
            case 'database': return src.databaseTable || t('dataThread.sourceDatabase');
            case 'example': return t('dataThread.sourceExample');
            case 'extract': return t('dataThread.sourceExtract');
            default: return null;
        }
    };

    return (
        <Box sx={{ ...sx,
            py: 0,
            mb: 0.5,
            backgroundColor: 'rgba(0,0,0,0.02)',
            borderBottom: `1px solid ${borderColor.divider}`,
            userSelect: 'none',
        }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    px: 0.75,
                    py: '4px',
                    borderRadius: '3px',
                }}
            >
                <Box
                    sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', borderRadius: '3px',
                        '&:hover': { backgroundColor: 'rgba(0,0,0,0.04)' },
                        pr: 0.5, py: 0.5,
                    }}
                    onClick={() => setWorkspaceExpanded(!workspaceExpanded)}
                >
                    {workspaceExpanded ?
                        <ExpandMoreIcon sx={{ fontSize: iconVar.sm, color: 'rgba(0,0,0,0.5)' }} /> :
                        <ChevronRightIcon sx={{ fontSize: iconVar.sm, color: 'rgba(0,0,0,0.5)' }} />
                    }
                    <Typography sx={{ fontSize: textVar.xs, fontWeight: 600, color: 'rgba(0,0,0,0.55)', textTransform: 'uppercase', letterSpacing: '0.5px', ml: 0.5 }}>
                        {t('dataThread.workspace')}
                    </Typography>
                </Box>
                <Box
                    onClick={(e) => { e.stopPropagation(); setUploadDialogOpen(true); }}
                    sx={{
                        display: 'flex', alignItems: 'center', gap: '2px',
                        ml: 'auto', px: '5px', py: '2px', borderRadius: '3px',
                        cursor: 'pointer', 
                        color: theme.palette.primary.textColor || theme.palette.primary.main,
                        '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.08) },
                    }}
                >
                    <AddIcon sx={{ fontSize: iconVar.sm }} />
                    <Typography sx={{ fontSize: textVar.xs, fontWeight: 600 }}>{t('dataThread.addData')}</Typography>
                </Box>
            </Box>

            <Collapse in={workspaceExpanded} timeout={150}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', mt: '2px', ml: '14px', py: 0.5 }}>
                    {tables.map((table, tableIndex) => {
                        const isTableActive = focusedTableId === table.id;
                        const tableCharts = chartElements.filter(ce => ce.tableId === table.id);
                        const originalName = getOriginalTableName(table);
                        const sourceTooltipText = getSourceTooltip(table);
                        const isLastTable = tableIndex === tables.length - 1;

                        const handleTableClick = () => {
                            dispatch(dfActions.setFocused({ type: 'table', tableId: table.id }));
                        };

                        return (
                            <Box
                                key={table.id}
                                sx={{
                                    position: 'relative',
                                    pl: 1.5,
                                    '&::before': {
                                        content: '""',
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        bottom: isLastTable ? 'calc(100% - 10px)' : 0,
                                        width: '1px',
                                        backgroundColor: 'rgba(0,0,0,0.1)',
                                    },
                                    '&::after': {
                                        content: '""',
                                        position: 'absolute',
                                        left: 0,
                                        top: '10px',
                                        width: '8px',
                                        height: '1px',
                                        backgroundColor: 'rgba(0,0,0,0.1)',
                                    }
                                }}
                            >
                                <Tooltip title={sourceTooltipText || ''} placement="right" arrow disableHoverListener={!sourceTooltipText}>
                                    <Box
                                        sx={fileItemSx(isTableActive)}
                                        onClick={handleTableClick}
                                    >
                                        {getTableIcon(table)}
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                            <Typography sx={{
                                                fontSize: textVar.xs,
                                                fontWeight: isTableActive ? 600 : 400,
                                                color: isTableActive ? 'primary.main' : 'text.primary',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {table.displayId || table.id}
                                            </Typography>
                                            {originalName && (
                                                <Typography sx={{
                                                    fontSize: textVar.xxs,
                                                    color: 'text.disabled',
                                                    lineHeight: 1.2,
                                                    mt: '2px',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}>
                                                    {originalName}
                                                </Typography>
                                            )}
                                        </Box>
                                        {table.description && (
                                            <InsertDriveFileOutlinedIcon sx={{ fontSize: textVar.xxs, color: 'text.disabled', flexShrink: 0 }} />
                                        )}
                                    </Box>
                                </Tooltip>

                                {/* Show all charts for this table with vertical guide line */}
                                {tableCharts.length > 0 && (
                                    <Box sx={{
                                        position: 'relative',
                                        ml: '14px',
                                        mt: '2px',
                                    }}>
                                        {tableCharts.map((chartElement, idx) => {
                                            const chart = charts.find(c => c.id === chartElement.chartId);
                                            if (!chart) return null;

                                            const isChartActive = focusedChartId === chart.id;
                                            const isLast = idx === tableCharts.length - 1;

                                            const handleChartClick = () => {
                                                dispatch(dfActions.setFocused({ type: 'chart', chartId: chart.id }));
                                            };

                                            return (
                                                <Box
                                                    key={chart.id}
                                                    sx={{
                                                        position: 'relative',
                                                        pl: 1.5, // Connector area
                                                        '&::before': {
                                                            content: '""',
                                                            position: 'absolute',
                                                            left: 0,
                                                            top: 0,
                                                            bottom: isLast ? '50%' : 0,
                                                            width: '1px',
                                                            backgroundColor: 'rgba(0,0,0,0.1)',
                                                        },
                                                        '&::after': {
                                                            content: '""',
                                                            position: 'absolute',
                                                            left: 0,
                                                            top: '50%',
                                                            width: '8px',
                                                            height: '1px',
                                                            backgroundColor: 'rgba(0,0,0,0.1)',
                                                        }
                                                    }}
                                                >
                                                <Box
                                                    sx={fileItemSx(isChartActive, true)}
                                                    onClick={handleChartClick}
                                                >
                                                    {getChartIcon(chart.chartType)}
                                                    <Typography sx={{
                                                        fontSize: textVar.xs,
                                                        fontWeight: isChartActive ? 600 : 400,
                                                        color: isChartActive ? 'primary.main' : 'text.primary',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                        flex: 1,
                                                        minWidth: 0,
                                                    }}>
                                                        {chart.chartType}
                                                    </Typography>
                                                </Box>
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                )}
                            </Box>
                        );
                    })}
                </Box>
            </Collapse>

            <UnifiedDataUploadDialog
                open={uploadDialogOpen}
                onClose={() => setUploadDialogOpen(false)}
                initialTab="menu"
            />
            <AgentRulesDialog
                externalOpen={agentRulesOpen}
                onExternalClose={() => setAgentRulesOpen(false)}
            />
        </Box>
    );
};

interface ThreadResponseCardProps {
    responseKind: 'agent' | 'error' | 'form';
    selected: boolean;
    highlighted?: boolean;
    prompt?: string;
    content: string;
    prominent?: boolean;
    workUpdate?: boolean;
    children?: React.ReactNode;
    onSelect: () => void;
    onDelete?: () => void;
}

const ThreadResponseCard: FC<ThreadResponseCardProps> = ({
    responseKind,
    selected,
    highlighted = false,
    prompt,
    content,
    prominent = false,
    workUpdate = false,
    children,
    onSelect,
    onDelete,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const indicatorCount = React.Children.count(children);
    return (
        <Box
            onClick={onSelect}
            sx={{
                width: '100%',
                minWidth: 0,
                cursor: 'pointer',
                position: 'relative',
                boxSizing: 'border-box',
                padding: '4px 8px 4px 6px',
                borderRadius: '6px',
                boxShadow: selected ? `0 0 0 2px ${theme.palette.primary.light}` : 'none',
                backgroundColor: 'transparent',
                '&:hover': {
                    backgroundColor: selected ? 'transparent' : 'action.hover',
                },
                '& .response-delete-btn': { opacity: 0, transition: 'opacity 0.15s' },
                '&:hover .response-delete-btn': { opacity: 1 },
            }}
        >
            <Box sx={{ minWidth: 0 }}>
                {prompt && (
                    <Typography sx={{
                        fontSize: textVar.xs, color: 'text.secondary', fontStyle: 'italic', mb: '1px',
                        display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
                        overflow: 'hidden', wordBreak: 'break-word',
                    }}>
                        {prompt}
                    </Typography>
                )}
                <Typography component="div" sx={{
                    fontSize: textVar.xs,
                    color: selected || prominent ? 'text.primary' : 'text.secondary',
                    lineHeight: 1.4, fontWeight: 400,
                    display: '-webkit-box', WebkitLineClamp: workUpdate ? 4 : 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden', wordBreak: 'break-word',
                }}>
                    {indicatorCount > 0 && <Box component="span" data-execution-commands sx={{ display: 'inline-flex',
                        alignItems: 'center', verticalAlign: '-0.125em', mr: 0.5, gap: 0.5,
                        '& > svg': { width: 12, height: 12, display: 'block' } }}>
                        {children}
                    </Box>}
                    {content}
                </Typography>
            </Box>
            {onDelete && (
                <Tooltip title={t('chartRec.pauseDelete')}>
                    <IconButton
                        className="response-delete-btn"
                        size="small"
                        color="error"
                        aria-label={t('chartRec.pauseDelete')}
                        sx={{
                            position: 'absolute', top: 2, right: 2, p: 0.25,
                            bgcolor: alpha(theme.palette.background.paper, 0.75),
                            backdropFilter: 'blur(2px)',
                            '&:hover': {
                                bgcolor: alpha(theme.palette.error.main, 0.14),
                                transform: 'scale(1.1)',
                            },
                        }}
                        onClick={(event) => {
                            event.stopPropagation();
                            onDelete();
                        }}
                    >
                        <DeleteIcon sx={{ fontSize: iconVar.md }} />
                    </IconButton>
                </Tooltip>
            )}
        </Box>
    );
};

/** One line of a collapsed thread's preview. */
type ThreadPreviewLine = { role: 'user' | 'agent' | 'item'; text: string };

let SingleThreadGroupView: FC<{
    // The thread to render: its nodes in order (design-docs/58).
    thread: ThreadSpec,
    threadLabel?: string, // Header label; absent on continuation segments
    threadSummary?: string,
    // A collapsed thread's requests, responses, and results, one per line.
    threadLines?: ThreadPreviewLine[],
    // Whether the focused item is in this thread.
    containsFocus?: boolean,
    historyCollapsed?: boolean,
    onToggleHistory?: () => void,
    layoutKey?: string,
    chartElements: { tableId: string, chartId: string, element: any }[];
    // The focused node and everything above it.
    highlightedNodeIds: Set<string>;
    sx?: SxProps
}> = function ({
    thread,
    threadLabel,
    threadSummary,
    threadLines = [],
    containsFocus = false,
    historyCollapsed = false,
    onToggleHistory,
    layoutKey,
    chartElements,
    highlightedNodeIds,
    sx
}) {

    let tables = useSelector(dfSelectors.getAllTables);
    const { t } = useTranslation();
    const tableById = useMemo(() => new Map(tables.map(t => [t.id, t])), [tables]);
    let textTurns = useSelector((state: DataFormulatorState) => state.textTurns);
    const turnById = useMemo(() => new Map(textTurns.map(tt => [tt.id, tt])), [textTurns]);
    const loadedTableNodes = useSelector((state: DataFormulatorState) => state.loadedTableNodes);
    const externalReferences = useSelector((state: DataFormulatorState) => state.externalTableReferences);
    const fileNodes = useSelector((state: DataFormulatorState) => state.fileNodes);
    const generatedReports = useSelector(dfSelectors.getThreadReports);
    const threadGraph = useSelector(dfSelectors.getThreadGraph);
    const draftNodes = useSelector((state: DataFormulatorState) => state.draftNodes);
    let charts = useSelector(dfSelectors.getAllCharts);
    let focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const canvasTarget = useSelector(dfSelectors.selectCanvasTarget);
    let focusedChartId = focusedId?.type === 'chart' ? focusedId.chartId : undefined;
    const theme = useTheme();
    const dispatch = useDispatch();
    // Conversation chains keyed by their first message; folded until opened.
    const [expandedTurnChains, setExpandedTurnChains] = useState<Set<string>>(new Set());
    const [deletingFiles, setDeletingFiles] = useState<Set<string>>(new Set());
    const deleteFile = async (path: string) => {
        if (deletingFiles.has(path)) return;
        setDeletingFiles(current => new Set(current).add(path));
        try {
            await deleteWorkspaceFile(path);
            dispatch(dfActions.removeFileNodes(path));
        } catch {
            dispatch(dfActions.addMessages({ timestamp: Date.now(), type: 'error',
                component: t('dataThread.workspace', { defaultValue: 'Workspace' }),
                value: t('dataThread.failedDeleteFile', { name: path, defaultValue: `Failed to delete ${path}` }),
            }));
        } finally {
            setDeletingFiles(current => {
                const next = new Set(current);
                next.delete(path);
                return next;
            });
        }
    };

    const isHL = (id: string) => highlightedNodeIds.has(id);
    const shouldHighlightThread = thread.nodeIds.some(id => isHL(id) || threadGraph.membersOf(id).some(isHL));
    // Tables on the focused chain light their cards and chart thumbnails.
    const highlightedTableIds = [...highlightedNodeIds]
        .map(id => tableById.has(id) ? id : threadGraph.nodes.get(id)?.tableId)
        .filter((id): id is string => !!id);
    const focusedTableId = canvasTarget?.type === 'table' ? canvasTarget.tableId
        : canvasTarget?.type === 'chart' ? charts.find(chart => chart.id === canvasTarget.chartId)?.tableRef : undefined;

    let tableCardProps: Omit<BuildTableCardProps, 'tableId'> = {
        tables, chartElements, usedIntermediateTableIds: [],
        highlightedTableIds, focusedTableId, focusedChartId,
        parentTable: undefined, tableIdList: [], collapsed: false, dispatch,
        t,
    };
    let _buildTableCard = (tableId: string) => buildTableCard({ tableId, ...tableCardProps });
    /** Pointer to a table whose card lives in the shelf. */
    let _buildRefChip = (tableId: string, loadedTableNodeId?: string) => buildTableRefChip({
        tableId, loadedTableNodeId, table: tableById.get(tableId),
        focused: loadedTableNodeId
            ? focusedId?.type === 'reference' && focusedId.referenceId === loadedTableNodeId
            : tableId === focusedTableId, dispatch,
        onDelete: () => dispatch(dfActions.deleteTable(tableId)),
        deleteLabel: t('dataThread.deleteTable'),
    });

    type TimelineItem = { outputNodeId?: string; key: string; element: React.ReactNode; type: 'used-table' | 'trigger' | 'table' | 'chart' | 'leaf-trigger' | 'leaf-table' | 'artifact' | 'merge'; highlighted: boolean; tableId?: string; chartType?: string; isRunning?: boolean; isClarifying?: boolean; isCompleted?: boolean; interactionEntry?: InteractionEntry; reportId?: string; gutterIcon?: React.ReactNode; artifactTone?: 'agent' | 'error'; secondaryActivity?: boolean };
    let timelineItems: (TimelineItem & { exchangeId?: string; expandedHistory?: boolean })[] = [];

    // ── Data lineage: the "Using sources" note before a derived table ──
    const computationSourcesOf = (table: DictTable | undefined): ComputationInputSource[] => {
        if (!table?.derive) return [];
        if (table.derive.inputSources) return table.derive.inputSources;
        return table.derive.source.map(id => ({
            id, kind: 'data' as const,
            displayName: tableById.get(id)?.displayId || id.replace(/\.[^/.]+$/, ''),
        }));
    };
    const sourceTableOf = (source: ComputationInputSource) => source.kind === 'data'
        ? tables.find(table => table.id === source.id
            || table.id === source.displayName
            || table.displayId === source.displayName
            || table.virtual?.tableId === source.displayName)
        : undefined;
    const focusComputationSource = (source: ComputationInputSource) => {
        if (source.kind === 'file') {
            dispatch(dfActions.setFocused({ type: 'file', fileName: source.displayName }));
            return;
        }
        const sourceTable = sourceTableOf(source);
        if (sourceTable) dispatch(dfActions.setFocused({ type: 'table', tableId: sourceTable.id }));
    };
    /** The data already in use above a node: earlier tables and the data they were computed from. */
    const inputContextOf = (nodeId: string): ComputationInputSource[] => {
        const sources = new Map<string, ComputationInputSource>();
        const addTable = (table: DictTable | undefined) => {
            if (!table) return;
            sources.set(`data:${table.id}`, { id: table.id, kind: 'data', displayName: table.displayId || table.id });
            for (const source of computationSourcesOf(table)) sources.set(`${source.kind}:${source.id}`, source);
        };
        for (const id of threadGraph.ancestors(nodeId)) {
            const node = threadGraph.nodes.get(id);
            const members = node?.kind === 'artifact-set' ? threadGraph.membersOf(id).map(member => threadGraph.nodes.get(member)) : [node];
            for (const item of members) {
                if (item?.kind === 'table') addTable(tableById.get(item.id));
                if (item?.kind === 'loaded-table' && item.tableId) addTable(tableById.get(item.tableId));
            }
        }
        return [...sources.values()];
    };
    const pushSourcesNote = (table: DictTable, highlighted: boolean) => {
        const inputSources = computationSourcesOf(table);
        if (!inputSources.length) return;
        const previousInputSources = inputContextOf(table.id);
        const contextIds = new Set(previousInputSources.map(source => getConversationSourceKey(source, tables)));
        const transition = inputSources.every(source => contextIds.has(getConversationSourceKey(source, tables)))
            ? 'continue'
            : classifyInputSourceTransition(
                previousInputSources.map(source => ({ ...source, id: getConversationSourceKey(source, tables) })),
                inputSources.map(source => ({ ...source, id: getConversationSourceKey(source, tables) })),
            );
        if (!shouldShowInputSourceTransition(transition, table.derive?.trigger.tableId, inputSources.map(source => sourceTableOf(source)?.id))) return;
        const provenanceColor = highlighted ? (theme.palette.primary.textColor ?? theme.palette.primary.main) : theme.palette.text.secondary;
        timelineItems.push({
            key: `sources-${table.id}`,
            outputNodeId: table.id,
            type: 'merge',
            highlighted,
            element: (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', minWidth: 0, maxWidth: '100%', columnGap: '6px', rowGap: 0, pl: 0.5, color: theme.palette.text.secondary, fontSize: textVar.xs, lineHeight: 1.4 }}>
                    <Typography component="span" sx={{ fontSize: 'inherit', lineHeight: 'inherit', color: 'inherit' }}>
                        {t(transition === 'switch' ? 'dataThread.switchingSources' : 'dataThread.usingSources')}
                    </Typography>
                    {inputSources.map((source, idx) => (
                        <Box key={`${source.id}-${idx}`} component="button" type="button" title={source.displayName}
                            disabled={source.kind === 'data' && !sourceTableOf(source)}
                            onClick={() => focusComputationSource(source)}
                            sx={{
                                display: 'inline-flex', alignItems: 'center', columnGap: '3px', minWidth: 0, maxWidth: '100%',
                                '& .MuiSvgIcon-root': { flexShrink: 0 },
                                m: 0, p: 0, border: 0, bgcolor: 'transparent',
                                color: provenanceColor, font: 'inherit', lineHeight: 'inherit', textAlign: 'left',
                                cursor: 'pointer',
                                '&:hover': { color: highlighted ? theme.palette.primary.dark : theme.palette.text.primary, textDecoration: 'underline' },
                                '&:disabled': { color: 'inherit', cursor: 'default', textDecoration: 'none' },
                            }}>
                            {source.kind === 'file'
                                ? <InsertDriveFileOutlinedIcon sx={{ fontSize: textVar.xs, color: 'inherit' }} />
                                : <TableIcon sx={{ fontSize: textVar.xs, color: 'inherit' }} />}
                            <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {source.kind === 'file' ? source.displayName.replace(/^\/?scratch\//, '') : sourceTableOf(source)?.displayId || source.displayName}
                            </Box>
                        </Box>
                    ))}
                </Box>
            ),
        });
    };

    // ── Items ──
    const pushTableAndChartItems = (tableId: string, tableCard: any, highlighted: boolean) => {
        if (!Array.isArray(tableCard)) return;
        tableCard.forEach((subItem: any, j: number) => {
            if (!subItem) return;
            const subKey = subItem?.key || `card-${tableId}-${j}`;
            const isChart = subKey.startsWith('relevant-chart-');
            const chartId = isChart ? subKey.match(/(?:chart)-(.+)$/)?.[1] : undefined;
            timelineItems.push({
                key: subKey,
                outputNodeId: tableId,
                type: isChart ? 'chart' : 'table',
                tableId: isChart ? undefined : tableId,
                chartType: chartId ? charts.find(c => c.id === chartId)?.chartType : undefined,
                highlighted,
                element: subItem,
            });
        });
    };
    const pushChartsOf = (tableId: string, outputNodeId: string, keyPrefix: string, highlighted: boolean) => {
        buildChartCards(chartElements.filter(ce => ce.tableId === tableId), focusedChartId, false)
            .forEach((el, i) => timelineItems.push({ key: `${keyPrefix}-${tableId}-${i}`, outputNodeId, type: 'chart', highlighted, element: el }));
    };
    const pushSourceRoot = (tableId: string, highlighted: boolean) => {
        timelineItems.push({ key: `origin-ref-${tableId}`, outputNodeId: tableId, type: 'table', tableId, highlighted, element: _buildRefChip(tableId) });
        pushChartsOf(tableId, tableId, 'origin-chart', highlighted);
    };
    const pushLoadedTable = (node: LoadedTableNode, highlighted: boolean) => {
        if (node.external) {
            const reference = externalReferences.find(item => item.id === node.tableId);
            if (!reference) return;
            const title = externalReferenceTitle(reference);
            timelineItems.push({
                key: node.id, outputNodeId: node.id, type: 'table', highlighted,
                element: <Box data-external-reference-id={reference.id} className="data-thread-card-wrapper">
                    <ThreadArtifactCard artifactType="table" title={title}
                        selected={(focusedId?.type === 'reference' && focusedId.referenceId === node.id)
                            || (focusedId?.type === 'external-table' && focusedId.referenceId === reference.id)}
                        onClick={() => dispatch(dfActions.setFocused({ type: 'reference', referenceId: node.id }))}>
                        <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                            <Typography component="span" sx={{ minWidth: 0, fontSize: textVar.sm, fontWeight: 500,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</Typography>
                            <Typography component="span" sx={{ fontSize: textVar.xs, color: 'text.secondary', opacity: 0.75, flexShrink: 0 }}>
                                {t('externalReference.virtualNote', { defaultValue: '(virtual)' })}</Typography>
                        </Box>
                    </ThreadArtifactCard>
                </Box>,
            });
            return;
        }
        if (!tableById.has(node.tableId)) return;
        timelineItems.push({ key: node.id, outputNodeId: node.id, type: 'table', tableId: node.tableId, highlighted,
            element: _buildRefChip(node.tableId, node.id) });
        pushChartsOf(node.tableId, node.id, 'loaded-chart', highlighted);
    };
    const buildReportTimelineItem = (report: GeneratedReport, highlighted: boolean) => {
        const isFocused = focusedId?.type === 'report' && focusedId.reportId === report.id;
        const rowHL = highlighted || isFocused;
        const isGenerating = report.status === 'generating';
        const gutterIcon = isGenerating
            ? <CircularProgress size={12} thickness={5} sx={{ color: theme.palette.secondary.main }} />
            : <ArticleIcon sx={{ width: 14, height: 14, color: rowHL ? theme.palette.secondary.main : 'rgba(0,0,0,0.3)' }} />;
        return {
            key: `report-${report.id}`, outputNodeId: report.id, type: 'artifact' as const, highlighted: rowHL,
            reportId: report.id, gutterIcon,
            element: <ThreadArtifactCard artifactType="report" title={report.title || t('report.untitled')}
                selected={isFocused}
                notes={isGenerating ? t('report.composing') : undefined}
                onClick={() => dispatch(dfActions.setFocused({ type: 'report', reportId: report.id }))}
                actions={<ArtifactDeleteButton label={t('dataThread.deleteReport')}
                    onClick={() => dispatch(dfActions.deleteGeneratedReport(report.id))} />} />,
        };
    };
    const pushFile = (file: FileNode, highlighted: boolean) => {
        const selected = focusedId?.type === 'reference' ? focusedId.referenceId === file.id
            : canvasTarget?.type === 'file' && canvasTarget.fileName === file.path;
        const isHtmlApp = /\.html?$/i.test(file.path);
        const FileGlyph = isHtmlApp ? HtmlIcon : /\.app\.jsx$/i.test(file.path) ? DashboardOutlinedIcon : InsertDriveFileOutlinedIcon;
        timelineItems.push({
            key: file.id, outputNodeId: file.id, type: 'artifact', highlighted: highlighted || selected,
            // The HTML wordmark is short and wide; enlarge it without moving the gutter.
            gutterIcon: <FileGlyph sx={{ width: isHtmlApp ? 22 : 14, height: isHtmlApp ? 22 : 14, m: isHtmlApp ? '-4px' : 0,
                color: selected ? 'primary.main' : 'text.secondary' }} />,
            element: <Box className="data-thread-card-wrapper" sx={{ display: 'flex', width: '100%', minWidth: 0 }}>
                    <ThreadArtifactCard artifactType="file" title={file.displayName} selected={selected} notes={file.notes}
                        onClick={() => dispatch(dfActions.setFocused({ type: 'file', fileName: file.path }))}
                        actions={<ArtifactDeleteButton label={t('dataThread.deleteFile', { defaultValue: 'Delete file' })}
                            disabled={deletingFiles.has(file.path)} onClick={() => void deleteFile(file.path)} />} />
                </Box>,
        });
    };

    // ── Messages ──
    const isTurnActive = (turn: TextTurn) => (!!turn.form && turn.form.kind !== 'workflow' && !turn.answered)
        || (!!turn.dataOperation && !turn.answered && turn.dataOperation.status !== 'loaded')
        || (turn.textKind === 'clarify' && !turn.answered)
        || !!turn.executions?.some(execution => execution.status === 'awaiting_approval' || execution.status === 'running')
        || !!turn.codeExecutions?.some(execution => execution.status === 'running')
        || threadGraph.followersOf(turn.id).some(node => node.kind === 'draft'
            && ['running', 'clarifying'].includes(draftNodes.find(draft => draft.id === node.id)?.derive.status || ''));
    const keepTurnVisible = (turn: TextTurn) => isTurnActive(turn)
        || !!turn.workflow
        || turn.form?.kind === 'workflow'
        || !!turn.workflowMessage;

    const pushUserMessage = (turn: TextTurn, highlighted: boolean) => {
        const content = turn.workflowMessage?.kind === 'steering' ? `(steering) ${turn.prompt}` : turn.prompt!;
        const entry: InteractionEntry = { from: 'user', to: 'data-agent', role: 'prompt', content,
            ...(turn.attachments?.length ? { attachments: turn.attachments } : {}), timestamp: turn.createdAt };
        const card = <InteractionEntryCard entry={entry} highlighted={focusedId?.type !== 'conversation' && highlighted} />;
        // A prompt nothing answers (its replies were deleted) can be removed too.
        timelineItems.push({
            key: `textturn-prompt-${turn.id}-0`, type: 'trigger', highlighted, interactionEntry: entry,
            element: threadGraph.childrenOf(turn.id).length ? card : <Box data-user-message sx={{ position: 'relative', minWidth: 0,
                '& [data-message-delete]': { opacity: 0, transition: transition.fast },
                '&:hover [data-message-delete], &:focus-within [data-message-delete]': { opacity: 1 } }}>
                {card}
                <Box data-message-delete sx={{ position: 'absolute', top: 2, right: 2, borderRadius: '50%',
                    bgcolor: alpha(theme.palette.background.paper, 0.75), '& .MuiIconButton-root': { p: '2px' }, '& svg': { fontSize: 14 } }}>
                    <ArtifactDeleteButton label={t('dataThread.deleteMessage', { defaultValue: 'Delete message' })}
                        onClick={() => dispatch(dfActions.removeTextTurn(turn.id))} />
                </Box>
            </Box>,
        });
    };

    const buildTextTurnTimelineItem = (turn: TextTurn, highlighted: boolean) => {
        const workflow = turn.workflow;
        const isFocused = focusedId?.type === 'text' && focusedId.textId === turn.id;
        const openTurn = () => {
            dispatch(dfActions.setFocused({ type: 'text', textId: turn.id }));
        };
        const rowHL = highlighted || isFocused;
        const formStatus = turn.form ? formArtifactStatus(turn.form) : undefined;
        const preview = (formStatus || turn.content || '')
            .replace(/[#*`>|]/g, ' ').replace(/\s+/g, ' ').trim();
        // Keep the UI from deleting a message that something follows. The
        // reducer still repairs these edges for programmatic removals.
        const hasDependents = threadGraph.childrenOf(turn.id).length > 0;
        const awaitingAnswer = !turn.answered && ((turn.options?.length ?? 0) > 0 || !!turn.form);
        const iconColor = focusedId?.type !== 'conversation' && rowHL
            ? theme.palette.primary.main : 'rgba(0,0,0,0.15)';
        const gutterIcon = workflow
            ? <WorkflowGears running={workflow.status === 'running'} color={workflow.status === 'paused'
                ? theme.palette.warning.main : rowHL ? theme.palette.primary.main : theme.palette.text.secondary} />
            : turn.form?.kind === 'workflow'
            ? <WorkflowGears running={false} color={iconColor} />
            : turn.form
            ? <InsertDriveFileOutlinedIcon sx={{ width: 14, height: 14, color: iconColor }} />
            : getEntryGutterIcon(
                { from: 'data-agent', to: 'user', role: turn.textKind, content: '' },
                iconColor,
            );
        // A completed run's record is its closing message: the run's status, then its answer.
        const card = workflow ? <>
            <WorkflowProgress turn={turn} selected={isFocused} />
            {workflow.status === 'completed' && preview && <Box sx={{ mt: 0.5 }}>
                <ThreadResponseCard responseKind="agent" selected={isFocused}
                    highlighted={focusedId?.type !== 'conversation' && rowHL} content={preview} onSelect={openTurn} />
            </Box>}
        </> : turn.form?.kind === 'workflow' ? (
            <ThreadArtifactCard artifactType="workflow" title={turn.form.workflow.definition.name}
                notes={turn.form.workflow.saved ? formStatus : 'Workflow definition'} selected={isFocused} onClick={openTurn}
                actions={hasDependents ? undefined : <ArtifactDeleteButton label="Delete workflow definition"
                    onClick={() => dispatch(dfActions.removeTextTurn(turn.id))} />} />
        ) : (
            <ThreadResponseCard
                responseKind={turn.form ? 'form' : 'agent'}
                selected={isFocused}
                highlighted={focusedId?.type !== 'conversation' && rowHL}
                content={preview}
                prominent={awaitingAnswer}
                onSelect={openTurn}
                onDelete={hasDependents ? undefined : () => dispatch(dfActions.removeTextTurn(turn.id))}
            />
        );
        return {
            key: `textturn-${turn.id}`, type: 'artifact' as const, highlighted: rowHL,
            artifactTone: 'agent' as const, gutterIcon,
            element: <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '6px', width: '100%', minWidth: 0 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>{card}</Box>
            </Box>,
        };
    };

    /** An agent message: the step before a table, a run of tool calls, settled thinking, or a response. */
    const pushAgentMessage = (turn: TextTurn, highlighted: boolean, nextNodeId: string | undefined) => {
        const executions = turn.executions || [];
        const codeExecutions = turn.codeExecutions || [];
        const hasToolCalls = executions.length > 0 || codeExecutions.length > 0;
        const isWidget = !!(turn.form || turn.dataOperation || turn.workflow || turn.options?.length);
        // Before a derived table, the message's text shows as the table's instruction card.
        const instructionFollows = !!tableById.get(nextNodeId || '')?.derive && !isWidget;
        const activityRow = (key: string) => timelineItems.push({
            key, type: 'trigger', highlighted, secondaryActivity: true,
            isRunning: [...executions, ...codeExecutions].some(call => call.status === 'running'),
            element: <ToolActivityRow nodeId={turn.id}
                active={[...executions, ...codeExecutions].some(call => call.status === 'running')}
                label={(!instructionFollows && turn.content)
                    || turn.progressSteps?.filter(step => step.kind === 'tool').at(-1)?.label
                    || t('dataThread.toolActivity', { defaultValue: 'Tool activity' })}
                executions={executions} codeExecutions={codeExecutions}
                onSelect={execution => openToolActivity(turn.id, execution)}
                onDelete={threadGraph.childrenOf(turn.id).length ? undefined : () => dispatch(dfActions.removeTextTurn(turn.id))} />,
        });
        if (instructionFollows) {
            // The step that made the next table: its instruction, thinking and code.
            if (hasToolCalls) activityRow(`textturn-${turn.id}-activity`);
            // The instruction is only what the agent wrote; the table's own title is on its card.
            const instruction = turn.content;
            if (!instruction) {
                const thinking = (turn.progressSteps || []).filter(step => step.kind !== 'tool' && step.kind !== 'chart');
                if (thinking.length) timelineItems.push({ key: `textturn-${turn.id}`, type: 'trigger', highlighted,
                    element: ThinkingStepsBanner(thinking, { px: 1, py: 0.5 }, false) });
                return;
            }
            // Tool calls have their own row above; the card keeps the step's thinking.
            const entry: InteractionEntry = { from: 'data-agent', to: 'datarec-agent', role: 'instruction', content: instruction,
                progressSteps: turn.progressSteps?.filter(step => step.kind !== 'tool'), timestamp: turn.createdAt };
            timelineItems.push({
                key: `textturn-${turn.id}`, type: 'trigger', highlighted, interactionEntry: entry,
                element: <InteractionEntryCard entry={entry} highlighted={focusedId?.type !== 'conversation' && highlighted} />,
            });
            return;
        }
        if (hasToolCalls && !isWidget) {
            activityRow(`textturn-${turn.id}`);
            return;
        }
        if (!turn.content && !isWidget) {
            if (turn.progressSteps?.length) timelineItems.push({
                key: `textturn-${turn.id}`, type: 'trigger', highlighted,
                element: ThinkingStepsBanner(turn.progressSteps, { px: 1, py: 0.5 }, false),
            });
            return;
        }
        timelineItems.push(buildTextTurnTimelineItem(turn, highlighted));
    };

    /** The open end of a run: live thinking while it runs, or why it stopped. */
    const pushDraft = (draft: DraftNode, highlighted: boolean) => {
        const status = draft.derive.status;
        if (status === 'running' || status === 'clarifying') {
            // A report being written shows its own live card.
            const parent = threadGraph.parentOf(draft.id);
            if (generatedReports.some(report => report.id === parent && report.status === 'generating')) return;
            const planLines = draft.derive.progressSteps?.length ? draft.derive.progressSteps
                : (draft.derive.runningPlan || t('dataThread.thinking')).split('\x1E').filter((line: string) => line.trim());
            // A call already spinning on the message before the draft is not animated twice.
            const lastStep = planLines.at(-1);
            const parentTurn = turnById.get(parent || '');
            const shownOnParent = typeof lastStep !== 'string' && !!lastStep?.executionId
                && [...(parentTurn?.executions || []), ...(parentTurn?.codeExecutions || [])]
                    .some(call => call.id === lastStep.executionId && call.status === 'running');
            const animated = status === 'running' && !shownOnParent;
            timelineItems.push({
                key: `agent-thinking-${draft.id}`, type: 'trigger', highlighted, isRunning: animated,
                element: ThinkingStepsBanner(planLines, { px: 1, py: 0.5 }, animated),
            });
            return;
        }
        if (status !== 'error' && status !== 'interrupted') return;
        const isFocusedDraft = focusedId?.type === 'draft' && focusedId.draftId === draft.id;
        const errorEntry = [...(draft.derive.trigger.interaction || [])].reverse().find(entry => entry.role === 'error');
        const errorText = errorEntry?.content
            || (status === 'interrupted'
                ? 'Interrupted by page refresh. You can retry or delete this step.'
                : 'This analysis run failed.');
        timelineItems.push({
            key: `agent-failed-${draft.id}`, type: 'trigger', highlighted, artifactTone: 'error',
            gutterIcon: <ErrorOutlineIcon sx={{ width: 13, height: 13,
                color: isFocusedDraft ? theme.palette.error.main : theme.palette.text.disabled }} />,
            element: <ThreadResponseCard responseKind="error" selected={isFocusedDraft} content={errorText}
                onSelect={() => dispatch(dfActions.setFocused({ type: 'draft', draftId: draft.id }))}
                onDelete={() => dispatch(dfActions.removeDraftNode(draft.id))} />,
        });
    };

    const conversationTargetId = thread.key;
    const openThreadConversation = () => {
        dispatch(dfActions.setFocused({ type: 'conversation', tableId: conversationTargetId,
            nodeIds: thread.nodeIds.flatMap(id => [id, ...threadGraph.membersOf(id)]) }));
    };

    const pushTurnChainToggle = (chainId: string, count: number, expanded: boolean) => {
        const toggleLabel = expanded
            ? t('dataThread.hideEarlierTurns', { defaultValue: 'Hide earlier turns' })
            : t('dataThread.showEarlierTurns', { defaultValue: 'Show earlier turns' });
        const toggle = () => setExpandedTurnChains(prev => {
            const next = new Set(prev);
            if (next.has(chainId)) next.delete(chainId); else next.add(chainId);
            return next;
        });
        timelineItems.push({
            key: `turn-chain-toggle-${chainId}`,
            type: 'artifact' as const,
            highlighted: false,
            gutterIcon: (
                <Tooltip title={toggleLabel}>
                    <IconButton size="small" aria-label={toggleLabel}
                        aria-expanded={expanded} onClick={toggle} sx={{ width: 24, height: 24, p: 0,
                            color: expanded ? 'primary.main' : 'text.secondary',
                            bgcolor: 'transparent',
                            '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
                        }}>
                        {expanded
                            ? <KeyboardArrowDownIcon sx={{ fontSize: iconVar.sm }} />
                            : <ChevronRightIcon sx={{ fontSize: iconVar.sm }} />}
                    </IconButton>
                </Tooltip>
            ),
            element: (
                <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 0.25 }}>
                    <Button size="small" color="inherit"
                        aria-expanded={expanded}
                        sx={{ textTransform: 'none', fontSize: textVar.xs, minWidth: 0, textAlign: 'left',
                            color: expanded ? 'primary.main' : 'text.secondary',
                            bgcolor: expanded ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
                            '&:hover': { bgcolor: alpha(theme.palette.primary.main, expanded ? 0.12 : 0.04) },
                        }}
                        onClick={toggle}>
                        {t('dataThread.conversationSegment', { defaultValue: '{{count}} earlier turns', count })}
                    </Button>
                    <Tooltip title={t('dataThread.openConversation', { defaultValue: 'Open full conversation' })}>
                        <IconButton size="small" aria-label={t('dataThread.openConversation', { defaultValue: 'Open full conversation' })}
                            sx={{ flexShrink: 0 }} onClick={openThreadConversation}>
                            <OpenInNewIcon sx={{ fontSize: iconVar.sm }} />
                        </IconButton>
                    </Tooltip>
                </Box>
            ),
        });
    };

    /**
     * Render one edge: a run of messages between items. Each user message
     * starts a round; settled middle rounds fold away behind a toggle once
     * there are more than three of them.
     */
    const pushEdge = (messageIds: string[], nextNodeId: string | undefined) => {
        type Part = { startsRound: boolean; keepVisible: boolean; render: () => void };
        const parts: Part[] = messageIds.map((id, index) => {
            const next = messageIds[index + 1] ?? nextNodeId;
            const draft = draftNodes.find(item => item.id === id);
            if (draft) return { startsRound: false, keepVisible: true, render: () => pushDraft(draft, isHL(id)) };
            const turn = turnById.get(id)!;
            return { startsRound: !!turn.prompt, keepVisible: keepTurnVisible(turn), render: () => {
                if (turn.prompt) pushUserMessage(turn, isHL(id));
                pushAgentMessage(turn, isHL(id), next);
            } };
        });
        const rounds: Part[][] = [];
        for (const part of parts) {
            if (part.startsRound || rounds.length === 0) rounds.push([]);
            rounds[rounds.length - 1].push(part);
        }
        const chainId = messageIds[0];
        const hiddenRounds = rounds.slice(1, -1).filter(round => !round.some(part => part.keepVisible));
        const foldable = hiddenRounds.length > 3;
        const expanded = expandedTurnChains.has(chainId);
        rounds.forEach((round, index) => {
            if (foldable && round === hiddenRounds[0]) pushTurnChainToggle(chainId, hiddenRounds.length, expanded);
            if (foldable && !expanded && hiddenRounds.includes(round)) return;
            const startIndex = timelineItems.length;
            for (const part of round) part.render();
            for (const item of timelineItems.slice(startIndex)) {
                item.exchangeId ??= `${chainId}-${index}`;
                if (foldable && expanded && hiddenRounds.includes(round)) item.expandedHistory = true;
            }
        });
    };

    /** A muted line before an artifact the agent made to fix (replace) an earlier one, which is gone. */
    const pushReplacedNote = (id: string, replaced: { name: string } | undefined, inPlace: boolean, highlighted: boolean) => {
        if (!replaced) return;
        timelineItems.push({
            key: `replaced-${id}`, type: 'trigger', highlighted, secondaryActivity: true,
            element: <Typography data-replaced-note sx={{ fontSize: textVar.xxs, fontStyle: 'italic', color: 'text.disabled', py: '1px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {inPlace ? t('dataThread.replacedVersion', { defaultValue: 'Replaced the earlier version' })
                    : t('dataThread.replaced', { defaultValue: 'Replaced {{name}}', name: replaced.name })}
            </Typography>,
        });
    };

    const pushItem = (id: string, index: number) => {
        const node = threadGraph.nodes.get(id);
        const highlighted = isHL(id);
        switch (node?.kind) {
            case 'table': {
                const table = tableById.get(id);
                if (!table) return;
                if (!table.derive) {
                    if (index === 0) pushSourceRoot(id, highlighted);
                    return;
                }
                pushSourcesNote(table, highlighted);
                pushReplacedNote(id, table.replaced, false, highlighted);
                pushTableAndChartItems(id, _buildTableCard(id), highlighted);
                return;
            }
            case 'loaded-table': {
                const loaded = loadedTableNodes.find(item => item.id === id);
                if (loaded) pushLoadedTable(loaded, highlighted);
                return;
            }
            case 'file': {
                const file = fileNodes.find(item => item.id === id);
                if (file) {
                    pushReplacedNote(id, file.replaced, true, highlighted);
                    pushFile(file, highlighted);
                }
                return;
            }
            case 'report': {
                const report = generatedReports.find(item => item.id === id);
                if (report) {
                    pushReplacedNote(id, report.replaced, false, highlighted);
                    timelineItems.push(buildReportTimelineItem(report, highlighted));
                }
                return;
            }
            case 'workflow-definition': {
                const turn = turnById.get(id);
                if (!turn) return;
                if (turn.prompt) pushUserMessage(turn, highlighted);
                timelineItems.push(buildTextTurnTimelineItem(turn, highlighted));
                return;
            }
            case 'artifact-set': {
                const members = threadGraph.membersOf(id);
                timelineItems.push({
                    key: `artifact-set-${id}`, outputNodeId: id, type: 'artifact', highlighted,
                    element: <Typography sx={{ px: 0.5, fontSize: textVar.xs, color: 'text.secondary' }}>
                        {t('dataThread.artifactSet', { defaultValue: '{{count}} items', count: members.length })}
                    </Typography>,
                });
                for (const member of members) {
                    const start = timelineItems.length;
                    pushItem(member, -1);
                    for (const item of timelineItems.slice(start)) item.outputNodeId = id;
                }
                return;
            }
        }
    };

    // A branch starts with a pointer to where it split off.
    if (thread.branchFromId && !isConversationRootId(thread.branchFromId)) {
        const from = thread.branchFromId;
        const fromItem = threadGraph.nearestItem(from);
        const fromTurn = turnById.get(from);
        const label = fromTurn
            ? (fromTurn.prompt || fromTurn.content || '').replace(/\s+/g, ' ').trim()
            : tableById.get(threadGraph.tableOf(from) || '')?.displayId || fileNodes.find(file => file.id === from)?.displayName
                || generatedReports.find(report => report.id === from)?.title || from;
        timelineItems.push({
            key: `branch-from-${thread.key}`, type: 'used-table', highlighted: isHL(from),
            element: fromTurn || !fromItem || !tableById.has(threadGraph.tableOf(from) || '')
                ? <Button size="small" color="inherit" onClick={() => dispatch(dfActions.setFocused(fromTurn
                        ? { type: 'text', textId: from } : { type: 'reference', referenceId: from }))}
                    sx={{ textTransform: 'none', fontSize: textVar.xs, color: 'text.secondary', minWidth: 0, maxWidth: '100%',
                        justifyContent: 'flex-start', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {t('dataThread.branchedFrom', { defaultValue: 'Continues from: {{label}}', label })}
                </Button>
                : _buildRefChip(threadGraph.tableOf(from)!),
        });
    }

    for (let index = 0; index < thread.nodeIds.length; index++) {
        const id = thread.nodeIds[index];
        if (threadGraph.isMessage(id)) {
            let end = index;
            while (end + 1 < thread.nodeIds.length && threadGraph.isMessage(thread.nodeIds[end + 1])) end++;
            pushEdge(thread.nodeIds.slice(index, end + 1), thread.nodeIds[end + 1]);
            index = end;
            continue;
        }
        pushItem(id, index);
    }

    const collapsedActivityIndicator = historyCollapsed && timelineItems.some(item => item.isRunning)
        ? <CircularProgress size={12} aria-label={t('terminal.running', { defaultValue: 'Running' })} /> : null;

    // Timeline rendering helper
    const TIMELINE_WIDTH = 14;
    const TIMELINE_GAP = '4px'; // gap between timeline and card content
    const DOT_SIZE = 6;
    const CARD_PY = '6px'; // vertical padding for each timeline row
    // Mirror the left timeline gutter on the right so cards sit visually
    // centred in their column instead of hugging the right edge.
    const CARD_CONTENT_PR = `${TIMELINE_WIDTH}px`;


    // Gutter icon for clarify/explain pause entries.
    // Both share the SmartToy bouncing pulse to call attention; only the
    // color differs (clarify = warning, explain = info) so they match the
    // entry card's palette.
    const getClarifyIcon = (item: typeof timelineItems[0]) => {
        const role = item.interactionEntry?.role;
        const color = role === 'explain' || role === 'delegate' ? theme.palette.info.main : theme.palette.warning.main;
        const variant = role === 'explain' || role === 'delegate' ? 'explain' : 'clarify';
        return <AgentToyIcon variant={variant} sx={{
            width: 16, height: 16, color,
            animation: 'df-clarify-bounce 1.4s ease-in-out infinite',
            '@keyframes df-clarify-bounce': {
                '0%, 100%': { transform: 'scale(1) translateY(0)' },
                '30%':      { transform: 'scale(1.15) translateY(-1.5px)' },
                '60%':      { transform: 'scale(0.97) translateY(1px)' },
            },
        }} />;
    };

    const getTimelineDot = (item: typeof timelineItems[0]) => {
        const isTable = item.type === 'table' || item.type === 'leaf-table' || item.type === 'used-table';
        const color = item.highlighted 
            ? theme.palette.primary.main
            : 'rgba(0,0,0,0.15)';

        // Artifact output rows (reports today, future skill outputs) carry
        // their own precomputed gutter dot from the artifact factory.
        if (item.type === 'artifact') {
            if (item.highlighted && item.artifactTone && React.isValidElement(item.gutterIcon)) {
                const semanticColor = item.artifactTone === 'error'
                    ? theme.palette.error.main
                    : theme.palette.primary.main;
                return React.cloneElement(item.gutterIcon as React.ReactElement<any>, {
                    sx: [item.gutterIcon.props.sx || {}, { color: semanticColor }],
                });
            }
            return item.gutterIcon ?? <Box sx={{ width: DOT_SIZE, height: DOT_SIZE, borderRadius: '50%', backgroundColor: color }} />;
        }

        // For running agent items, show a spinner instead of a dot
        if (item.isRunning) {
            return <CircularProgress size={12} thickness={5} sx={{ color: theme.palette.primary.main }} />;
        }

        // For clarification / explanation items, show an attention icon
        if (item.isClarifying) {
            return getClarifyIcon(item);
        }

        // For completed items, show a checkmark icon
        if (item.isCompleted) {
            return <CheckCircleOutlineIcon sx={{ width: 12, height: 12, color: theme.palette.success.main }} />;
        }

        // For table items, show a type-specific icon instead of a dot
        if (isTable && item.tableId) {
            const tableForDot = tableById.get(item.tableId);
            const iconSx = { width: 14, height: 14, color };
            const isStreaming = tableForDot && (tableForDot.source?.type === 'stream' || tableForDot.source?.type === 'database') && tableForDot.source?.autoRefresh;

            if (isStreaming) {
                return <StreamIcon sx={{ 
                    ...iconSx, 
                    color: item.highlighted ? theme.palette.success.main : 'rgba(0,0,0,0.15)',
                    animation: 'pulse 2s infinite',
                    '@keyframes pulse': {
                        '0%': { opacity: 1 },
                        '50%': { opacity: 0.4 },
                        '100%': { opacity: 1 },
                    },
                }} />;
            }
            if (tableForDot?.derive) {
                return <Box data-thread-table-dot sx={{ width: DOT_SIZE, height: DOT_SIZE, borderRadius: '50%', backgroundColor: color }} />;
            }
            return <TableIcon sx={iconSx} />;
        }

        // For chart items, show a chart-type-specific icon
        if (item.type === 'chart' && item.chartType) {
            const iconSx = { width: 14, height: 14, color };
            const ct = item.chartType.toLowerCase();
            if (ct.includes('scatter') || ct.includes('point') || ct.includes('dot') || ct.includes('boxplot')) {
                return <ScatterPlotIcon sx={iconSx} />;
            }
            if (ct.includes('line') || ct.includes('regression')) {
                return <ShowChartIcon sx={iconSx} />;
            }
            if (ct.includes('pie')) {
                return <PieChartOutlineIcon sx={iconSx} />;
            }
            if (ct.includes('heatmap')) {
                return <GridOnIcon sx={iconSx} />;
            }
            if (ct.includes('table')) {
                return <TableIcon sx={iconSx} />;
            }
            // Bar, histogram, stacked, grouped, pyramid, and default
            return <BarChartIcon sx={iconSx} />;
        }

        return <Box sx={{ 
            width: DOT_SIZE, height: DOT_SIZE, borderRadius: '50%', 
            backgroundColor: color,
        }} />;
    };

    const focusedTimelineKey = focusedId?.type === 'text'
        ? `textturn-${focusedId.textId}`
        : focusedId?.type === 'draft'
            ? `agent-failed-${focusedId.draftId}`
            : focusedId?.type === 'reference'
                ? focusedId.referenceId
                : undefined;
    const focusedTimelineIndex = focusedTimelineKey
        ? timelineItems.findIndex(item => item.key === focusedTimelineKey)
        : -1;
    if (focusedTimelineIndex >= 0) {
        timelineItems = timelineItems.map((item, index) => index <= focusedTimelineIndex
            ? { ...item, highlighted: true }
            : item);
    }

    const hasHighlighting = highlightedTableIds.length > 0;
    // Whether the thread header is highlighted (any non-used-table item in this thread is highlighted)
    const headerHL = timelineItems.some(item => item.highlighted && item.type !== 'used-table');
    // A collapsed thread's timeline takes the highlight only when it holds the focused item.
    const timelineHL = historyCollapsed ? containsFocus : headerHL;

    const renderTimelineItem = (item: typeof timelineItems[0], index: number, isLast: boolean, nextHighlighted: boolean) => {
        const isTrigger = item.type === 'trigger' || item.type === 'leaf-trigger';
        const isTable = item.type === 'table' || item.type === 'leaf-table' || item.type === 'used-table';
        const isChart = item.type === 'chart';
        const isMerge = item.type === 'merge';
        const dashedColor = item.highlighted ? alpha(theme.palette.primary.main, 0.6) : 'rgba(0,0,0,0.1)';
        const dashedWidth = '2px';
        const dashedStyle = item.expandedHistory ? 'dotted' : 'solid';
        // Bottom connector uses unhighlighted style if next item isn't highlighted
        const bottomHighlighted = item.highlighted && nextHighlighted;
        const bottomDashedColor = bottomHighlighted ? alpha(theme.palette.primary.main, 0.6) : 'rgba(0,0,0,0.1)';
        const bottomDashedWidth = '2px';
        const bottomDashedStyle = item.expandedHistory
            || (item.key.startsWith('turn-chain-toggle-') && timelineItems[index + 1]?.expandedHistory)
            ? 'dotted' : 'solid';
        // No dimming or background — rely on timeline color + card border for highlighting
        const rowHighlightSx = {};

        if (item.secondaryActivity) {
            return <Box key={`timeline-row-${item.key}`} data-thread-item={item.key} data-thread-on-chain={item.highlighted || undefined} data-secondary-activity
                sx={{ display: 'flex', minWidth: 0 }}>
                <Box data-activity-gutter sx={{ width: TIMELINE_WIDTH, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                    <Box sx={{ borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, py: 0.25, pl: TIMELINE_GAP, pr: CARD_CONTENT_PR }}>{item.element}</Box>
            </Box>;
        }

        // Merge nodes: a confluence glyph in the gutter + inline list of
        // joined source tables. Communicates provenance changes (join, narrow,
        // or substitute) — rendered with stronger weight than ambient chrome
        // since it conveys meaningful lineage information.
        if (isMerge) {
            return (
                <Box key={`timeline-row-${item.key}`} sx={{ display: 'flex', flexDirection: 'row', position: 'relative', ...rowHighlightSx }}>
                    <Box sx={{
                        width: TIMELINE_WIDTH, flexShrink: 0,
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                        <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />
                        <Box sx={{ flexShrink: 0, zIndex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <CallMergeIcon sx={{ fontSize: iconVar.xs, color: item.highlighted ? theme.palette.primary.main : 'rgba(0,0,0,0.15)', transform: 'rotate(180deg)' }} />
                        </Box>
                        {!isLast && <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `${bottomDashedWidth} ${bottomDashedStyle} ${bottomDashedColor}` }} />}
                        {isLast && <Box sx={{ flex: '1 1 0', minHeight: 2 }} />}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, py: '4px', pl: TIMELINE_GAP, pr: CARD_CONTENT_PR, display: 'flex', alignItems: 'center' }}>
                        {item.element}
                    </Box>
                </Box>
            );
        }

        // Triggers: icon based on interaction entry's `from` actor
        if (isTrigger) {
            const entry = item.interactionEntry;
            const isFromUser = entry ? entry.from === 'user' : false;
            const iconColor = item.highlighted
                ? (isFromUser ? theme.palette.custom.main : theme.palette.primary.main)
                : 'rgba(0,0,0,0.15)';
            const gutterIcon = item.isRunning
                ? <CircularProgress size={12} thickness={5} sx={{ color: theme.palette.primary.main }} />
                : item.isClarifying
                    ? getClarifyIcon(item)
                    : item.gutterIcon
                            ? React.isValidElement(item.gutterIcon)
                                ? React.cloneElement(item.gutterIcon as React.ReactElement<any>, {
                                    sx: [item.gutterIcon.props.sx || {}, { color: item.highlighted ? theme.palette.primary.main : iconColor }],
                                })
                                : item.gutterIcon
                            : entry
                                ? getEntryGutterIcon(entry, iconColor)
                                : getDefaultGutterIcon(iconColor);

            return (
                <Box key={`timeline-row-${item.key}`}
                    data-thread-item={item.key} data-thread-on-chain={item.highlighted || undefined}
                    {...(item.isClarifying ? { 'data-clarifying': 'true' } : {})}
                    sx={{ display: 'flex', flexDirection: 'row', position: 'relative', ...rowHighlightSx }}>
                    <Box sx={{ 
                        width: TIMELINE_WIDTH, flexShrink: 0, 
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                        <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />
                        <Box sx={{ flexShrink: 0, zIndex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {gutterIcon}
                        </Box>
                        {!isLast && <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `${bottomDashedWidth} ${bottomDashedStyle} ${bottomDashedColor}` }} />}
                        {isLast && <Box sx={{ flex: '1 1 0', minHeight: 2 }} />}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, py: CARD_PY, pl: TIMELINE_GAP, pr: CARD_CONTENT_PR }}>
                        {item.element}
                    </Box>
                </Box>
            );
        }

        // Charts: chart-type icon on the timeline
        if (isChart) {
            return (
                <Box key={`timeline-row-${item.key}`} data-thread-item={item.key} data-thread-on-chain={item.highlighted || undefined} sx={{ display: 'flex', flexDirection: 'row', position: 'relative', ...rowHighlightSx }}>
                    <Box sx={{
                        width: TIMELINE_WIDTH, flexShrink: 0,
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                        <Box sx={{ width: 0, flex: '1 1 0', borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />
                        <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {getTimelineDot(item)}
                        </Box>
                        {!isLast && <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `${bottomDashedWidth} ${bottomDashedStyle} ${bottomDashedColor}` }} />}
                        {isLast && <Box sx={{ flex: '1 1 0', minHeight: 2 }} />}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, py: CARD_PY, pl: TIMELINE_GAP, pr: CARD_CONTENT_PR }}>
                        {item.element}
                    </Box>
                </Box>
            );
        }

        // Tables (primary nodes): settings icon on the timeline, more vertical spacing
        const tableForItem = item.tableId ? tableById.get(item.tableId) : undefined;
        return (
            <Box key={`timeline-row-${item.key}`} data-thread-item={item.key} data-thread-on-chain={item.highlighted || undefined} sx={{ display: 'flex', flexDirection: 'row', position: 'relative', ...rowHighlightSx }}>
                <Box sx={{ 
                    width: TIMELINE_WIDTH, flexShrink: 0, 
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    position: 'relative',
                }}>
                    {(() => {
                        // When connecting to the header (index 0), match the header's highlight state
                        const useHeader = index === 0;
                        const topColor = useHeader ? (headerHL ? alpha(theme.palette.primary.main, 0.6) : 'rgba(0,0,0,0.1)') : dashedColor;
                        const topWidth = '2px';
                        const topStyle = dashedStyle;
                        return <Box sx={{ width: 0, flex: '1 1 0', minHeight: 6, borderLeft: `${topWidth} ${topStyle} ${topColor}` }} />;
                    })()}
                    <Box sx={{ flexShrink: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {getTimelineDot(item)}
                    </Box>
                    {!isLast && (
                        <Box sx={{ width: 0, flex: '1 1 0', minHeight: 6, borderLeft: `${bottomDashedWidth} ${bottomDashedStyle} ${bottomDashedColor}` }} />
                    )}
                    {isLast && <Box sx={{ flex: '1 1 0', minHeight: 6 }} />}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, py: item.type === 'used-table' ? '1px' : CARD_PY, pl: TIMELINE_GAP, pr: CARD_CONTENT_PR,
                    // Fill the column and shrink with it, so a long name truncates instead of overflowing.
                    ...(item.type === 'used-table' && { display: 'flex', alignItems: 'center', '& > *': { flex: '1 1 auto', minWidth: 0 } }),
                }}>
                    {item.element}
                </Box>
            </Box>
        );
    };


    const threadActive = focusedId?.type === 'conversation' && focusedId.tableId === conversationTargetId;
    const showItemFocus = focusedId?.type !== 'conversation';
    const conversationButtonSx = {
        flexShrink: 0, minWidth: 0, minHeight: 24, px: 0.75, py: 0.25, ml: 'auto',
        fontSize: textVar.xs, textTransform: 'none', letterSpacing: 0,
        '& .MuiButton-endIcon': { ml: 0.5, mr: 0, '& > *:nth-of-type(1)': { fontSize: iconVar.sm } },
        color: 'text.primary',
        bgcolor: threadActive ? 'action.selected' : 'transparent',
        '&:hover': {
            bgcolor: alpha(theme.palette.text.primary, 0.1),
        },
        '&.Mui-focusVisible': {
            outline: `2px solid ${theme.palette.text.secondary}`,
            outlineOffset: 2,
        },
    };
    const flowBlocks: { key: string; indices: number[]; exchangeId?: string; outputNodeId?: string }[] = [];
    timelineItems.forEach((item, index) => {
        const key = item.outputNodeId ? `output-${item.outputNodeId}` : item.exchangeId || item.key;
        const previous = flowBlocks[flowBlocks.length - 1];
        const sameExchange = item.exchangeId && previous?.exchangeId === item.exchangeId
            && (!item.outputNodeId || !previous.outputNodeId || previous.outputNodeId === item.outputNodeId);
        if (previous && (previous.key === key || sameExchange)) {
            previous.indices.push(index);
            if (item.outputNodeId) {
                previous.outputNodeId = item.outputNodeId;
                previous.key = `output-${item.outputNodeId}`;
            }
        } else flowBlocks.push({ key, indices: [index], exchangeId: item.exchangeId, outputNodeId: item.outputNodeId });
    });

    return <Box data-thread-active={threadActive ? 'true' : 'false'} data-thread-highlighted={shouldHighlightThread ? 'true' : 'false'}
        data-thread-entry={layoutKey} sx={{ ...sx,
            backgroundColor: threadActive ? alpha(theme.palette.primary.main, 0.045) : 'background.paper',
            ...(showItemFocus ? {
                '& .selected-card': {
                    boxShadow: `0 0 0 2px ${theme.palette.primary.light}`,
                    borderColor: 'transparent',
                    margin: '1px 0',
                },
                '& .selected-artifact-card': {
                    boxShadow: '0 0 0 2px var(--artifact-selection-color)',
                    borderColor: 'transparent',
                },
            } : {}),
            padding: '6px',
        }}
        >
        <div style={{ padding: '2px 4px', marginTop: 0, direction: 'ltr' }}>
            {(() => {
                const hlColor = theme.palette.primary.main;
                const nhColor = 'rgba(0,0,0,0.35)';
                const connColor = showItemFocus && timelineHL ? alpha(hlColor, 0.6) : 'rgba(0,0,0,0.1)';
                const connWidth = '2px';
                const connStyle = 'solid';
                return (
                <Box data-thread-flow-header sx={{ display: 'flex', flexDirection: 'row', breakAfter: 'avoid' }}>
                    <Box sx={{ 
                        width: TIMELINE_WIDTH, flexShrink: 0, 
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                        <Box sx={{ flex: '1 1 0', minHeight: 6 }} />
                        <Box aria-hidden="true" sx={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: showItemFocus && timelineHL ? hlColor : 'rgba(0,0,0,0.15)' }}>
                            <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%',
                                border: '1.5px solid currentColor', boxSizing: 'content-box' }} />
                        </Box>
                        <Box sx={{ width: 0, flex: '1 1 0', minHeight: 10, borderLeft: `${connWidth} ${connStyle} ${connColor}` }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', pl: 0.5, gap: 0.5 }}>
                        <ButtonBase disabled={!onToggleHistory} onClick={onToggleHistory} aria-expanded={!historyCollapsed}
                            aria-label={historyCollapsed ? t('dataThread.expandThread', { defaultValue: 'Expand thread' }) : t('dataThread.collapseThread', { defaultValue: 'Collapse thread' })}
                            sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.25, borderRadius: 0.5, px: 0.25, ml: -0.25,
                                color: showItemFocus && timelineHL ? hlColor : 'text.secondary',
                                '& .thread-chevron': { color: 'text.disabled' },
                                '&:hover, &:hover .thread-chevron': { color: 'text.primary' },
                                '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
                            <Typography component="span" sx={{ minWidth: 0, color: 'inherit',
                                fontSize: textVar.xs, fontWeight: 700,
                                textTransform: 'uppercase', letterSpacing: 0,
                            }}>
                                {threadLabel}
                            </Typography>
                            {onToggleHistory && (historyCollapsed
                                ? <ChevronRightIcon className="thread-chevron" sx={{ fontSize: 16 }} />
                                : <KeyboardArrowDownIcon className="thread-chevron" sx={{ fontSize: 16 }} />)}
                        </ButtonBase>
                        <Tooltip describeChild title={t('dataThread.openConversation', { defaultValue: 'Open full conversation' })}>
                            <Button size="small" variant="text" endIcon={<ArrowForwardIcon />}
                                aria-pressed={threadActive} sx={conversationButtonSx} onClick={openThreadConversation}>
                                {t('dataThread.viewChat', { defaultValue: 'view chat' })}
                            </Button>
                        </Tooltip>
                        {collapsedActivityIndicator}
                    </Box>
                </Box>
                );
            })()}
            {/* A collapsed thread is one button on a dotted timeline: its first turn, how many more, and
                its latest response, one muted line each. One hover lifts all of it; a click expands it. */}
            {historyCollapsed && (threadLines.length > 0 || threadSummary) && (() => {
                const lines = threadLines.length ? threadLines : [{ role: 'user' as const, text: threadSummary! }];
                const hidden = lines.length > 2 ? lines.length - 2 : 0;
                const shown: (ThreadPreviewLine | { more: number })[] = hidden
                    ? [lines[0], { more: hidden }, lines[lines.length - 1]] : lines;
                const lineSx = { display: 'block', minWidth: 0, fontSize: textVar.xs, lineHeight: 1.5, color: 'text.secondary',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', transition: transition.fast } as const;
                return <Box component="button" type="button" data-thread-summary aria-expanded={false}
                    onClick={onToggleHistory} disabled={!onToggleHistory} title={lines.map(line => line.text).join('\n')}
                    sx={{ display: 'flex', alignItems: 'stretch', width: '100%', minWidth: 0,
                        p: 0, m: 0, border: 0, background: 'transparent', textAlign: 'left', fontFamily: theme.typography.fontFamily,
                        cursor: onToggleHistory ? 'pointer' : undefined,
                        '& [data-thread-collapsed-gutter]': { color: showItemFocus && timelineHL ? alpha(theme.palette.primary.main, 0.6) : 'rgba(0,0,0,0.2)' },
                        '&:hover': {
                            '& [data-thread-collapsed-gutter]': { color: showItemFocus && timelineHL ? theme.palette.primary.main : 'text.secondary' },
                            '& [data-thread-preview-line]': { color: 'text.primary' },
                            '& [data-thread-preview-more], & [data-thread-collapsed-more]': { color: 'text.secondary' },
                        },
                        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}>
                    <Box component="span" aria-hidden="true" data-thread-collapsed-gutter sx={{ width: TIMELINE_WIDTH, flexShrink: 0,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', transition: transition.fast }}>
                        <Box component="span" sx={{ width: 0, flex: 1, minHeight: 8, borderLeft: '2px dotted currentColor' }} />
                        <KeyboardArrowDownIcon sx={{ fontSize: 14, color: 'inherit', mb: '1px' }} />
                    </Box>
                    <Box component="span" sx={{ flex: 1, minWidth: 0, ml: '4px', mr: `${TIMELINE_WIDTH}px`, mt: 0.5,
                        display: 'flex', flexDirection: 'column' }}>
                        {shown.map((line, index) => 'more' in line
                            ? <Typography key={index} component="span" data-thread-preview-more sx={{ ...lineSx, color: 'text.disabled', fontStyle: 'italic' }}>
                                {t('dataThread.moreTurns', { count: line.more, defaultValue: '… {{count}} more turns' })}
                            </Typography>
                            : <Typography key={index} component="span" data-thread-preview-line data-role={line.role}
                                sx={{ ...lineSx, fontWeight: line.role === 'user' ? 500 : 400 }}>
                                {line.text}
                            </Typography>)}
                        <Typography component="span" data-thread-collapsed-more sx={{ ...lineSx, mt: 0.25, color: 'text.disabled',
                            fontSize: textVar.xxs, fontStyle: 'italic' }}>
                            {t('dataThread.clickToExpand', { defaultValue: 'Click to expand' })}
                        </Typography>
                    </Box>
                </Box>;
            })()}
            {!historyCollapsed && flowBlocks.map((block, blockIndex) => <Box key={block.key} data-thread-flow-block={block.key}
                sx={{ breakInside: 'avoid', breakBefore: blockIndex === 0 ? 'avoid' : 'auto', minWidth: 0 }}>
                {block.indices.map(index => {
                    const item = timelineItems[index];
                    return renderTimelineItem(showItemFocus ? item : { ...item, highlighted: false },
                        index, index === timelineItems.length - 1, showItemFocus && (timelineItems[index + 1]?.highlighted ?? false));
                })}
            </Box>)}
        </div>
    </Box>
    }

/** Lightweight chart thumbnail — shows cached PNG, skeleton, or status icon. */
const ChartThumbnail: FC<{
    chart: Chart;
    table: DictTable;
    status: 'available' | 'pending' | 'unavailable';
    onChartClick: (chartId: string, tableId: string) => void;
}> = ({ chart, table, status, onChartClick }) => {
    const { t } = useTranslation();
    // Thumbnails live in a dedicated slice so updating one chart's preview
    // doesn't invalidate the `charts` array reference for every consumer.
    const thumbnail = useSelector(dfSelectors.getChartThumbnail(chart.id));

    const pendingOverlay = status == 'pending' ? <Box sx={{
        position: "absolute", top: 0, left: -8, right: -8, bottom: 0, zIndex: 20,
        backgroundColor: "rgba(243, 243, 243, 0.8)", cursor: "pointer",
        borderRadius: '6px', display: 'flex', flexDirection: 'column',
    }}>
        <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.05 }} />
    </Box> : null;

    if (['Auto', '?'].includes(chart.chartType)) {
        return <Box 
            className="vega-thumbnail-box"
            onClick={() => onChartClick(chart.id, table.id)}
            sx={{ width: "100%", color: 'text.secondary', height: 48, display: "flex", backgroundColor: "white", position: 'relative', flexDirection: "column" }}>
            {pendingOverlay}
            <InsightIcon sx={{ margin: 'auto', color: 'darkgray' }}  fontSize="medium" />
        </Box>;
    }

    if (status == 'unavailable' || chart.chartType == "Table") {
        let chartTemplate = getChartTemplate(chart.chartType);
        return <Box key={`unavailable-${chart.id}`} width={"100%"}
            className={"vega-thumbnail vega-thumbnail-box"}
            onClick={() => onChartClick(chart.id, table.id)}
            sx={{ display: "flex", backgroundColor: "white", position: 'relative', flexDirection: "column" }}>
            {pendingOverlay}
            <Box sx={{ display: "flex", flexDirection: "column", margin: "auto", height: 48}}>
                <Box sx={{ margin: "auto", transform: chart.chartType == 'Table' ? "rotate(15deg)" : undefined }} >
                    {generateChartSkeleton(chartTemplate?.icon, 32, 32, chart.chartType == 'Table' ? 1 : 0.5)} 
                </Box>
            </Box>
        </Box>;
    }

    // ---- Thumbnail path: use cached PNG from ChartRenderService ----
    if (thumbnail) {
        return (
            <Box
                onClick={() => onChartClick(chart.id, table.id)}
                className="vega-thumbnail-box"
                style={{ width: "100%", position: "relative", cursor: "pointer" }}
            >
                <Box sx={{ margin: "auto" }}>
                    {pendingOverlay}
                    <Box className={"vega-thumbnail"}
                        sx={{
                            display: "flex",
                            backgroundColor: "transparent",
                            justifyContent: 'center',
                            alignItems: 'center',
                            minHeight: 48,
                            minWidth: 60,
                        }}
                    >
                        <img 
                            src={thumbnail} 
                            alt={t('dataThread.chartAlt', { type: chart.chartType })}
                            style={{ display: 'block', maxWidth: 120, maxHeight: 100, objectFit: 'contain' }}
                        />
                    </Box>
                </Box>
            </Box>
        );
    }

    // ---- Fallback: skeleton while ChartRenderService is still processing ----
    let chartTemplate = getChartTemplate(chart.chartType);
    return (
        <Box
            onClick={() => onChartClick(chart.id, table.id)}
            className="vega-thumbnail-box"
            style={{ width: "100%", position: "relative", cursor: "pointer" }}
        >
            <Box sx={{ margin: "auto" }}>
                {pendingOverlay}
                <Box className={"vega-thumbnail"}
                    sx={{
                        display: "flex",
                        backgroundColor: "white",
                        justifyContent: 'center',
                        alignItems: 'center',
                        minHeight: 60,
                    }}
                >
                    {generateChartSkeleton(chartTemplate?.icon, 48, 48, 0.3)}
                </Box>
            </Box>
        </Box>
    );
};

// Height estimation constants (px) – per-type heights + py:4px (8px) gap per row
const LAYOUT_TABLE_HEIGHT = 28 + 8;     // table card + row padding
const LAYOUT_ENTRY_HEIGHT = 38;         // interaction entry — empirical ~1.5-line average incl. row padding
const LAYOUT_CHART_HEIGHT = 90 + 8;     // chart card (~70-110) + row padding
const LAYOUT_THREAD_OVERHEAD = 52;      // header divider + thread padding

function estimateThreadHeight(
    tableCount: number, entryCount: number, chartCount: number
): number {
    return LAYOUT_THREAD_OVERHEAD
        + tableCount * LAYOUT_TABLE_HEIGHT
        + entryCount * LAYOUT_ENTRY_HEIGHT
        + chartCount * LAYOUT_CHART_HEIGHT;
}

function computeThreadColumnLayout(
    heights: number[],
    numColumns: number,
): number[][] {
    if (heights.length === 0) return [];
    if (heights.length === 1) return [[0]];

    const cols = Math.min(numColumns, heights.length);
    if (cols <= 1) return [heights.map((_, i) => i)];

    return layoutPreserveOrder(heights, cols);
}

/**
 * Balanced layout *preserving* thread order.
 *
 * Uses binary-search on the maximum column height to find the tightest
 * contiguous partitioning of threads into ≤ numColumns groups.
 */
function layoutPreserveOrder(heights: number[], numColumns: number): number[][] {
    const maxH = Math.max(...heights);
    const totalH = heights.reduce((s, h) => s + h, 0);

    // Can we fit all threads into `numColumns` columns with no column > target?
    const canPartition = (target: number): boolean => {
        let cols = 1, cur = 0;
        for (const h of heights) {
            if (cur + h > target && cur > 0) {
                cols++;
                cur = h;
                if (cols > numColumns) return false;
            } else {
                cur += h;
            }
        }
        return true;
    };

    // Binary-search for the minimum feasible max-column height
    let lo = maxH, hi = totalH;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (canPartition(mid)) hi = mid; else lo = mid + 1;
    }

    // Build the actual partition with the optimal target
    const target = lo;
    const columns: number[][] = [[]];
    let cur = 0;
    for (let i = 0; i < heights.length; i++) {
        if (cur + heights[i] > target && columns[columns.length - 1].length > 0) {
            columns.push([]);
            cur = 0;
        }
        columns[columns.length - 1].push(i);
        cur += heights[i];
    }

    return columns;
}

export const DataThread: FC<{sx?: SxProps, centered?: boolean, denseColumns?: boolean}> = function ({ sx, centered = false, denseColumns = false }) {
    const { t } = useTranslation();
    const [activitySelection, setActivitySelection] = useState<{ nodeId: string; executionId: string } | null>(null);
    useEffect(() => {
        const select = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (detail?.nodeId && detail.execution?.id) setActivitySelection({ nodeId: detail.nodeId, executionId: detail.execution.id });
        };
        const clear = () => setActivitySelection(null);
        window.addEventListener('df-view-tool-activity', select);
        window.addEventListener('df-tool-activity-closed', clear);
        return () => {
            window.removeEventListener('df-view-tool-activity', select);
            window.removeEventListener('df-tool-activity-closed', clear);
        };
    }, []);
    const dispatch = useDispatch<AppDispatch>();
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
    const externalReferenceCount = useSelector((state: DataFormulatorState) => state.externalTableReferences?.length ?? 0);
    const pendingTableCount = useSelector((state: DataFormulatorState) => state.pendingTableLoads.reduce((count, load) => count + load.names.length, 0));

    useEffect(() => {
        let cancelled = false;
        const refresh = () => {
            if (!activeWorkspace) {
                setWorkspaceFiles([]);
                dispatch(dfActions.setWorkspaceFileCount(0));
                return;
            }
            listWorkspaceFiles()
                .then(files => {
                    if (!cancelled) {
                        setWorkspaceFiles(files);
                        dispatch(dfActions.setWorkspaceFileCount(files.length));
                    }
                })
                .catch(error => {
                    if (!cancelled) console.warn('Failed to list workspace files:', error);
                });
        };
        refresh();
        const unsubscribe = onWorkspaceFilesChanged(refresh);
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [activeWorkspace?.id, dispatch]);

    let tables = useSelector(dfSelectors.getAllTables);
    let inputTables = useSelector(dfSelectors.getInputTables);
    let focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    useEffect(() => { setActivitySelection(null); }, [focusedId]);
    let charts = useSelector(dfSelectors.getAllCharts);

    const fileNodes = useSelector((state: DataFormulatorState) => state.fileNodes);
    const loadedTableNodes = useSelector((state: DataFormulatorState) => state.loadedTableNodes);
    const threadReports = useSelector(dfSelectors.getThreadReports);
    const externalReferencesTop = useSelector((state: DataFormulatorState) => state.externalTableReferences);

    let textTurnsForHome = useSelector((state: DataFormulatorState) => state.textTurns);
    const threadGraph = useSelector(dfSelectors.getThreadGraph);
    // The thread node the user is on (design-docs/58): the thread highlights it
    // and the chain above it, and opens the thread that holds it.
    const focusNodeId = useSelector(dfSelectors.getFocusNodeId);
    // The focused node's chain; a set on it counts as a whole, since what follows continues from all its members.
    const highlightedNodeIds = useMemo(
        () => new Set(threadGraph.ancestors(focusNodeId, { includeSelf: true })
            .flatMap(id => [id, ...threadGraph.membersOf(id)])),
        [threadGraph, focusNodeId],
    );
    const focusedTableId = useMemo(() => {
        if (focusedId?.type === 'table') return focusedId.tableId;
        if (focusedId?.type === 'chart') return charts.find(chart => chart.id === focusedId.chartId)?.tableRef;
        return threadGraph.tableOf(focusNodeId);
    }, [focusedId, charts, threadGraph, focusNodeId]);
    // The shelf lights the tables on the focused chain and the data they were computed from.
    const globalHighlightedTableIds = useMemo(() => {
        const byId = new Map(tables.map(table => [table.id, table]));
        const ids = new Set<string>();
        const pending = [...highlightedNodeIds]
            .map(id => byId.has(id) ? id : threadGraph.nodes.get(id)?.tableId)
            .filter((id): id is string => !!id);
        if (focusedTableId) pending.push(focusedTableId);
        while (pending.length) {
            const id = pending.pop()!;
            if (ids.has(id)) continue;
            ids.add(id);
            for (const source of byId.get(id)?.derive?.source || []) pending.push(source);
        }
        return [...ids];
    }, [tables, highlightedNodeIds, threadGraph, focusedTableId]);
    const focusedThreadAnchor = focusNodeId;

    // A data-operation turn replaces the canvas, so no table is "on screen" —
    // the table above stays a context highlight rather than a selection.
    const canvasOwnedByTurn = useMemo(() => (
        focusedId?.type === 'text'
        && !!textTurnsForHome.find(tt => tt.id === focusedId.textId)?.dataOperation
    ), [focusedId, textTurnsForHome]);

    let chartSynthesisInProgress = useSelector((state: DataFormulatorState) => state.chartSynthesisInProgress);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    // Work committed from the entry surface (a queued run, or a table still
    // importing) lands here before it produces content, so the panel can say
    // "working" instead of telling the user there is nothing here.
    const analystChatPending = useSelector((state: DataFormulatorState) => state.analystChatPending);
    const tableLoadsInFlight = useSelector((state: DataFormulatorState) => state.tableLoadsInFlight);
    const workPending = tableLoadsInFlight > 0 || analystChatPending != null;
    // A run is streaming into the thread while its live draft is open.
    const runActive = useSelector((state: DataFormulatorState) =>
        state.draftNodes.some(draft => draft.derive?.status === 'running' || draft.derive?.status === 'clarifying'));

    const containerRef = useRef<null | HTMLDivElement>(null)
    const threadScrollRef = useRef<null | HTMLDivElement>(null)
    // Outer wrapper containing both the thread area and the chatbox.
    const outerRef = useRef<null | HTMLDivElement>(null)
    // Bring the focused item into view when focus arrives from outside the
    // thread (agent output, canvas, sidebar). Clicks inside the thread never
    // move it, and a user who is scrolling is not fought.
    const threadPointerAtRef = useRef(0);
    const userScrollAtRef = useRef(0);
    const fileNodesRef = useRef(fileNodes);
    fileNodesRef.current = fileNodes;
    useEffect(() => {
        if (!focusedId || performance.now() - threadPointerAtRef.current < 400) return;
        const startedAt = performance.now();
        let frame = 0;
        let timer = 0;
        let lastTop: number | undefined;
        let stableFrames = 0;
        const measure = (viewport: HTMLElement, target: HTMLElement, settle: boolean) => {
            const visible = viewport.getBoundingClientRect();
            return { visible, delta: revealDelta(visible, target.getBoundingClientRect(),
                findLeadIn(target)?.getBoundingClientRect(), settle) };
        };
        // Late layout shifts (thumbnails, measured heights) can push the item
        // back toward an edge; correct once unless the user took over.
        const settle = (scrolledAt: number) => {
            const viewport = threadScrollRef.current;
            const target = viewport && findRevealTarget(viewport, focusedId, fileNodesRef.current);
            if (!viewport || !target || userScrollAtRef.current > scrolledAt) return;
            const { delta } = measure(viewport, target, true);
            if (Math.abs(delta) > 8) viewport.scrollBy({ top: delta, behavior: 'smooth' });
        };
        const attempt = () => {
            const viewport = threadScrollRef.current;
            const now = performance.now();
            if (!viewport || now - startedAt > 3000) return;
            const target = now - userScrollAtRef.current < 800 ? null
                : findRevealTarget(viewport, focusedId, fileNodesRef.current);
            // Wait until the item exists (a thread may be expanding) and stops moving.
            const top = target?.getBoundingClientRect().top;
            stableFrames = target && top === lastTop ? stableFrames + 1 : 0;
            lastTop = top;
            if (!target || stableFrames < 6) {
                frame = requestAnimationFrame(attempt);
                return;
            }
            const { visible, delta } = measure(viewport, target, false);
            if (delta === 0) return;
            const instant = Math.abs(delta) > 2 * visible.height
                || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            viewport.scrollBy({ top: delta, behavior: instant ? 'auto' : 'smooth' });
            const scrolledAt = performance.now();
            timer = window.setTimeout(() => settle(scrolledAt), 900);
        };
        frame = requestAnimationFrame(attempt);
        return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
    }, [focusedId]);
    // Column geometry follows density: bigger text needs a wider card, or table
    // names truncate. DataFormulator snaps the pane from the same tokens.
    const { tokens: threadTokens } = useLayout();
    const [expandedColumns, setExpandedColumns] = useState(false);
    const [threadExpansion, setThreadExpansion] = useState<Record<string, boolean>>({});
    // Keys found during render; the effects below persist them as explicit expansion.
    const latestThreadKeyRef = useRef<string>();
    const focusedThreadKeyRef = useRef<string>();
    useEffect(() => {
        const key = latestThreadKeyRef.current;
        if (key) setThreadExpansion(previous => key in previous ? previous : { ...previous, [key]: true });
    });
    useEffect(() => {
        const key = focusedThreadKeyRef.current;
        if (key) setThreadExpansion(previous => previous[key] ? previous : { ...previous, [key]: true });
    }, [focusedThreadAnchor]);
    // Must run before the save effect so a workspace switch reads storage before it is overwritten.
    const workspaceId = activeWorkspace?.id;
    useEffect(() => {
        if (!workspaceId) return;
        try {
            const saved = JSON.parse(localStorage.getItem(`df_thread_expansion:${workspaceId}`) || '{}');
            const valid = Object.entries(saved ?? {}).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean');
            if (valid.length) setThreadExpansion(previous => ({ ...previous, ...Object.fromEntries(valid) }));
        } catch { /* ignore unreadable entries */ }
    }, [workspaceId]);
    useEffect(() => {
        if (!workspaceId) return;
        const entries = Object.entries(threadExpansion).filter(([key]) => key.startsWith(`${workspaceId}:`));
        if (entries.length) localStorage.setItem(`df_thread_expansion:${workspaceId}`, JSON.stringify(Object.fromEntries(entries)));
    }, [threadExpansion, workspaceId]);
    const [containerWidth, setContainerWidth] = useState(0);
    const [threadPanelHeight, setThreadPanelHeight] = useState(600);
    const [measuredShelfHeight, setMeasuredShelfHeight] = useState<number>();
    const [measuredEntryHeights, setMeasuredEntryHeights] = useState<Record<string, number>>({});
    const layoutSignatureRef = useRef<string>();
    const [isDragOver, setIsDragOver] = useState(false);

    // ── Drop handler for catalog table items from DataSourceSidebar ──────
    const handleDragOver = useCallback((e: React.DragEvent) => {
        if (e.dataTransfer.types.includes('application/json')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setIsDragOver(true);
        }
    }, []);
    const handleDragLeave = useCallback(() => setIsDragOver(false), []);
    const handleDrop = useCallback((e: React.DragEvent) => {
        setIsDragOver(false);
        try {
            const raw = e.dataTransfer.getData('application/json');
            if (!raw) return;
            const item: CatalogTableDragItem = JSON.parse(raw);
            if (item.type !== CATALOG_TABLE_ITEM) return;
            e.preventDefault();

            if (item.artifactKind === 'file') {
                importConnectorFile(item.connectorId, item.tablePath.join('/'))
                    .then(file => dispatch(dfActions.setFocused({ type: 'file', fileName: file.name })))
                    .catch(error => dispatch(dfActions.addMessages({
                        timestamp: Date.now(), type: 'error', component: 'data thread',
                        value: `Failed to load "${item.tableName}": ${extractErrorMessage(error)}`,
                    })));
                return;
            }

            if (loadsAsConnectorReference(item.metadata, serverConfig)) {
                const metadata = item.metadata || {};
                const rows = Number(metadata.row_count);
                const bytes = Number(metadata.original_size_bytes ?? metadata.size_bytes ?? metadata.file_size);
                const reference = createExternalTableReference({
                    kind: 'external-table-reference', connectorId: item.connectorId,
                    tableKey: metadata.table_key || item.tablePath.join('/'),
                    sourceTable: { id: item.tableId || item.tableName, name: item.tableName },
                    displayName: item.tableName, capturedAt: new Date().toISOString(),
                    ...(isSemanticConnectorTable(metadata) ? { queryModel: 'semantic' as const } : {}),
                    summary: {
                        description: metadata.source_description || metadata.description,
                        columns: metadata.columns || [],
                        ...(metadata.relationships ? { relationships: metadata.relationships } : {}),
                        rowCount: Number.isFinite(rows) ? rows : undefined,
                        sizeBytes: Number.isFinite(bytes) ? bytes : undefined,
                    },
                });
                dispatch(dfActions.upsertExternalTableReference(reference));
                dispatch(dfActions.setFocused({ type: 'external-table', referenceId: reference.id }));
                return;
            }

            const tableObj: DictTable = {
                kind: 'table' as const,
                id: item.tableName,
                displayId: item.tableName,
                names: [],
                metadata: {},
                rows: [],
                virtual: { tableId: item.tableName, rowCount: 0 },
                description: '',
                source: {
                    type: 'database' as const,
                    databaseTable: item.tablePath.join('/'),
                    canRefresh: true,
                    lastRefreshed: Date.now(),
                    connectorId: item.connectorId,
                },
            };

            dispatch(loadTable({
                table: tableObj,
                connectorId: item.connectorId,
                sourceTableRef: { id: item.tableId || item.tableName, name: item.tableName },
                importOptions: {},
            })).unwrap()
                .then(() => {
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(), type: 'success',
                        component: 'data thread', value: `Loaded table "${item.tableName}"`,
                    }));
                })
                .catch((err) => {
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(), type: 'error',
                        component: 'data thread', value: `Failed to load "${item.tableName}": ${extractErrorMessage(err)}`,
                    }));
                });
        } catch { /* ignore bad data */ }
    }, [dispatch, serverConfig]);
    // Re-attach ResizeObserver when containerRef changes
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const theme = useTheme();

    const tableById = useMemo(() => new Map(tables.map(t => [t.id, t])), [tables]);
    const turnByIdTop = useMemo(() => new Map(textTurnsForHome.map(turn => [turn.id, turn])), [textTurnsForHome]);

    let chartElements = useMemo(() => {
        return charts.filter(c => c.source == "user").flatMap((chart) => {
            const table = getDataTable(chart, tables, charts, conceptShelfItems);
            if (!table) return [];
            let status: 'available' | 'pending' | 'unavailable' = chartSynthesisInProgress.includes(chart.id) ? 'pending' : 
                checkChartAvailability(chart, conceptShelfItems, table.rows) ? 'available' : 'unavailable';
            let element = <ChartThumbnail
                chart={chart}
                table={table}
                status={status}
                onChartClick={() => {
                    dispatch(dfActions.setFocused({ type: 'chart', chartId: chart.id }));
                }}
            />;
            return [{
                chartId: chart.id,
                tableId: table.id,
                element,
                onDelete: () => { dispatch(dfActions.deleteChartById(chart.id)); },
                deleteTooltip: t('dataThread.deleteChart'),
                unread: !!chart.unread,
            }];
        });
    }, [charts, tables, conceptShelfItems, chartSynthesisInProgress]);

    // Column geometry (CARD_WIDTH / CARD_GAP / PANEL_PADDING) is defined once
    // in ./threadLayout and shared with DataFormulator's pane snapping.
    const denseColumnGap = 4;
    const densePanelInset = 4;
    const useDenseColumns = denseColumns;
    const columnGap = useDenseColumns ? denseColumnGap : threadTokens.thread.cardGap;
    const panelInset = useDenseColumns ? densePanelInset : threadTokens.thread.panelPadding / 2;
    const fittableColumns = useDenseColumns
        ? 2
        : fittableThreadColumnsFor(containerWidth, threadTokens);

    const segmentHeight = threadPanelHeight * 1.5;
    const shelfHeight = inputTables.length || workspaceFiles.length || externalReferenceCount || pendingTableCount
        ? measuredShelfHeight ?? estimateThreadHeight(inputTables.length + workspaceFiles.length + externalReferenceCount + pendingTableCount, 1, 0)
        : 0;

    // Threads come from the branches of the item-and-message graph (design-docs/58,
    // rule 10). A source table starts a thread only once something follows it or
    // it has charts; otherwise it lives on the shelf alone.
    const threadSpecs = useMemo(() => buildThreads(threadGraph, id => {
        const table = tableById.get(id);
        if (!table || table.derive || threadGraph.kindOf(id) !== 'table') return true;
        return threadGraph.followersOf(id).length > 0 || chartElements.some(chart => chart.tableId === id);
    }), [threadGraph, tableById, chartElements]);

    const hasWorkspaceContent = tables.length > 0 || workspaceFiles.length > 0 || externalReferenceCount > 0 || pendingTableCount > 0;
    let hasContent = threadSpecs.length > 0 || hasWorkspaceContent;

    type ThreadEntry = {
        key: string;
        isShelf?: boolean;               // the source-table shelf, not a thread
        thread?: ThreadSpec;
        expansionKey?: string;
        historyCollapsed?: boolean;
        threadSummary?: string;
        threadLines?: ThreadPreviewLine[];
        threadLabel?: string;
        containsFocus?: boolean;
    };
    const threadSummaryOf = (thread: ThreadSpec) => {
        for (const id of thread.nodeIds) {
            const turn = turnByIdTop.get(id);
            if (turn?.prompt) return turn.prompt;
            if (turn?.form?.kind === 'workflow') return turn.form.workflow.definition.name;
        }
        for (const id of thread.nodeIds) {
            if (turnByIdTop.get(id)?.content) return turnByIdTop.get(id)!.content;
            if (tableById.get(id)?.derive) return tableById.get(id)!.displayId;
        }
        return tableById.get(thread.rootId)?.displayId || '';
    };
    /** A collapsed thread read as lines: each user request, agent response, and result in order. */
    const threadLinesOf = (thread: ThreadSpec): ThreadPreviewLine[] => {
        const nameOf = (id: string): string => {
            switch (threadGraph.kindOf(id)) {
                case 'table': return tableById.get(id)?.displayId || '';
                case 'loaded-table': {
                    const node = loadedTableNodes.find(item => item.id === id);
                    const reference = node?.external ? externalReferencesTop.find(item => item.id === node.tableId) : undefined;
                    return reference ? externalReferenceTitle(reference) : tableById.get(node?.tableId || '')?.displayId || '';
                }
                case 'file': return fileNodes.find(item => item.id === id)?.displayName || '';
                case 'report': return threadReports.find(item => item.id === id)?.title || t('report.untitled');
                case 'workflow-definition': {
                    const form = turnByIdTop.get(id)?.form;
                    return form?.kind === 'workflow' ? form.workflow.definition.name : '';
                }
                case 'artifact-set': return threadGraph.membersOf(id).map(nameOf).filter(Boolean).join(', ');
                default: return '';
            }
        };
        const plain = (text: string) => text.replace(/[#*`>|_]/g, ' ').replace(/\s+/g, ' ').trim();
        const lines: ThreadPreviewLine[] = [];
        for (const id of thread.nodeIds) {
            const turn = turnByIdTop.get(id);
            if (turn && threadGraph.kindOf(id) === 'turn') {
                if (turn.prompt) lines.push({ role: 'user', text: plain(turn.prompt) });
                if (turn.content) lines.push({ role: 'agent', text: plain(turn.content) });
            } else if (threadGraph.isItem(id) && !(id === thread.rootId && !tableById.get(id)?.derive)) {
                const name = nameOf(id);
                if (name) lines.push({ role: 'item', text: `→ ${name}` });
            }
        }
        return lines.filter(line => line.text);
    };
    const startedAt = (thread: ThreadSpec) => threadGraph.nodes.get(thread.nodeIds[0])?.createdAt ?? 0;
    const latestThread = threadSpecs.reduce<ThreadSpec | undefined>((latest, thread) =>
        !latest || startedAt(thread) >= startedAt(latest) ? thread : latest, undefined);
    latestThreadKeyRef.current = undefined;
    focusedThreadKeyRef.current = undefined;
    let allThreadEntries: ThreadEntry[] = [];
    // The shelf is not a thread, but it occupies the top of the first column,
    // so it packs alongside the threads as slot 0.
    if (inputTables.length > 0 || workspaceFiles.length > 0 || externalReferenceCount > 0 || pendingTableCount > 0) {
        allThreadEntries.push({ key: 'source-shelf', isShelf: true });
    }
    threadSpecs.forEach((thread, index) => {
        const expansionKey = `${activeWorkspace?.id || ''}:${thread.key}`;
        const isLatest = thread === latestThread;
        if (isLatest) latestThreadKeyRef.current = expansionKey;
        const containsFocus = !!focusNodeId && thread.nodeIds.some(id => id === focusNodeId || threadGraph.membersOf(id).includes(focusNodeId));
        if (containsFocus) focusedThreadKeyRef.current = expansionKey;
        const expanded = threadExpansion[expansionKey] ?? isLatest;
        allThreadEntries.push({
            key: thread.key, thread, expansionKey,
            historyCollapsed: !expanded,
            threadSummary: threadSummaryOf(thread).replace(/\s+/g, ' ').trim(),
            threadLines: threadLinesOf(thread),
            containsFocus,
            threadLabel: t('dataThread.threadIndex', { index: String(index + 1) }),
        });
    });
    const entryLayoutKey = (entry: ThreadEntry) => `${entry.key}:${entry.historyCollapsed ? 'collapsed' : 'expanded'}`;

    // Balance consecutive thread pieces into columns, read top-to-bottom then left-to-right.
    const {
        moreAbove: moreThreadContentAbove,
        moreBelow: moreThreadContentBelow,
        update: updateThreadScrollFade,
    } = useScrollFade(threadScrollRef, allThreadEntries.length);

    let renderThreadEntry = (entry: ThreadEntry) => {
        const entrySx = {
            backgroundColor: 'white',
            borderRadius: radius.md,
            padding: useDenseColumns ? 0.5 : 1,
            my: useDenseColumns ? 0.25 : 0.5,
            flex: 'none',
            display: 'block',
            width: '100%',
            breakInside: 'avoid',
            boxDecorationBreak: 'clone',
            '& > div > :first-child': { breakAfter: 'avoid' },
            minWidth: useDenseColumns ? 0 : undefined,
            maxWidth: useDenseColumns ? '100%' : undefined,
            boxSizing: 'border-box',
            transition: transition.fast,
        } as const;

        // The shelf packs like a thread but isn't one: it just lists the
        // workspace's source tables, which every thread grows out of.
        if (entry.isShelf) {
            return <SourceTableShelf
                key={entry.key}
                inputTables={inputTables}
                workspaceFiles={workspaceFiles}
                highlightedTableIds={globalHighlightedTableIds}
                focusedTableId={canvasOwnedByTurn ? undefined : focusedTableId}
                sx={{ ...entrySx, breakInside: 'avoid' }} />;
        }

        return <SingleThreadGroupView
            key={entry.key}
            thread={entry.thread!}
            threadLabel={entry.threadLabel}
            threadSummary={entry.threadSummary}
            threadLines={entry.threadLines}
            containsFocus={entry.containsFocus}
            historyCollapsed={entry.historyCollapsed}
            onToggleHistory={() => setThreadExpansion(previous => ({ ...previous, [entry.expansionKey!]: !!entry.historyCollapsed }))}
            layoutKey={entryLayoutKey(entry)}
            chartElements={chartElements}
            highlightedNodeIds={highlightedNodeIds}
            sx={entrySx} />;
    };

    // Let content fill available width; column count driven by container size
    const panelWidth = '100%';

    useLayoutEffect(() => {
        const shelf = threadScrollRef.current?.querySelector<HTMLElement>('[data-thread-shelf]');
        if (!shelf && measuredShelfHeight !== undefined) setMeasuredShelfHeight(undefined);
        if (shelf && shelf.offsetHeight > 0) {
            const height = Math.ceil(shelf.offsetHeight / 24) * 24;
            if (height !== measuredShelfHeight) setMeasuredShelfHeight(height);
        }
        // While a run streams, entry heights stay frozen between discrete layout events, so growing
        // content extends its thread in place instead of moving threads between columns. Otherwise
        // the threads are re-measured and re-packed, so a thread that grew during the run takes its
        // real height once the run ends.
        const layoutSignature = [containerWidth, fittableColumns, workPending, runActive, ...allThreadEntries.map(entryLayoutKey)].join('|');
        const relayout = layoutSignature !== layoutSignatureRef.current || !runActive;
        layoutSignatureRef.current = layoutSignature;
        const entryHeightUpdates: Record<string, number> = {};
        for (const element of threadScrollRef.current?.querySelectorAll<HTMLElement>('[data-thread-entry]') || []) {
            const key = element.dataset.threadEntry!;
            if (element.offsetHeight <= 0 || (!relayout && key in measuredEntryHeights)) continue;
            const style = getComputedStyle(element);
            const height = Math.ceil((element.offsetHeight + parseFloat(style.marginTop || '0') + parseFloat(style.marginBottom || '0')) / 24) * 24;
            if (measuredEntryHeights[key] !== height) entryHeightUpdates[key] = height;
        }
        if (Object.keys(entryHeightUpdates).length) setMeasuredEntryHeights(previous => ({ ...previous, ...entryHeightUpdates }));
    });

    useEffect(() => {
        const viewport = threadScrollRef.current;
        if (!viewport) return;
        const measure = () => {
            if (viewport.clientHeight > 0) setThreadPanelHeight(viewport.clientHeight);
        };
        const resize = new ResizeObserver(measure);
        resize.observe(viewport);
        measure();
        return () => resize.disconnect();
    }, [hasContent]);

    const entryHeights = allThreadEntries.map(entry => {
        if (entry.isShelf) return Math.ceil(shelfHeight);
        const measured = measuredEntryHeights[entryLayoutKey(entry)];
        if (measured !== undefined) return measured;
        if (entry.historyCollapsed) return 42 + Math.min(3, entry.threadLines?.length ?? 0) * 20 + 22;
        const ids = entry.thread!.nodeIds.flatMap(id => [id, ...threadGraph.membersOf(id)]);
        const chartCount = ids.reduce((sum, id) => {
            const tableId = tableById.has(id) ? id : threadGraph.nodes.get(id)?.tableId;
            return sum + chartElements.filter(chart => chart.tableId === tableId).length;
        }, 0);
        return Math.ceil(estimateThreadHeight(ids.filter(id => threadGraph.isItem(id)).length,
            ids.filter(id => threadGraph.isMessage(id)).length, chartCount));
    });
    const entrySegments = computeThreadColumnLayout(entryHeights, fittableColumns)
        .map(indices => indices.map(index => allThreadEntries[index]));

    let view = hasContent ? (
        <Box ref={threadScrollRef} onScroll={updateThreadScrollFade}
            onPointerDown={() => { threadPointerAtRef.current = performance.now(); }}
            onWheel={() => { userScrollAtRef.current = performance.now(); }}
            onTouchMove={() => { userScrollAtRef.current = performance.now(); }}
            sx={{ 
            overflowY: 'auto',
            overflowX: 'hidden',
            position: 'relative',
            direction: 'ltr',
            height: 'calc(100% - 16px)',
            width: panelWidth,
        }}>
            <Box data-thread-column-flow data-thread-segment-height={segmentHeight} sx={{
                display: 'grid',
                gridTemplateColumns: `repeat(${fittableColumns}, minmax(0, 1fr))`,
                alignItems: 'start',
                width: useDenseColumns ? '100%' : fittableColumns * threadTokens.thread.cardWidth
                    + (fittableColumns - 1) * columnGap + panelInset,
                maxWidth: '100%',
                boxSizing: 'border-box',
                // Centered mode centers the BLOCK, not the columns inside it, and
                // floors it at the composer's width so a single thread lines up
                // with the chat box below instead of drifting to the middle.
                ...(centered && !useDenseColumns ? {
                    maxWidth: '100%',
                    mx: 'auto',
                } : {}),
                gap: `${columnGap}px`,
                py: useDenseColumns ? 0.5 : 1,
                // Bottom padding leaves room so the scroll handler can position
                // the focused element above the chatbox even when it expands.
                mb: '180px',
                pl: centered && !useDenseColumns ? 0 : `${panelInset}px`,
                pr: 0,
            }}>
                {entrySegments.map((entries, index) => <Box key={index}
                    data-thread-segment={index} data-thread-column={index} sx={{ minWidth: 0 }}>
                    {entries.map(entry => renderThreadEntry(entry))}
                </Box>)}
            </Box>
        </Box>
    ) : (
        // A session can open before any data exists (the agent loads it), so
        // say so rather than leaving the panel blank.
        <Box sx={{
            direction: 'ltr',
            boxSizing: 'border-box',
            px: 2,
            width: panelWidth,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
        }}>
            {workPending ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={12} thickness={5} sx={{ color: theme.palette.primary.main }} />
                    <Typography variant="body2" sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
                        {t('dataThread.startingRun')}
                    </Typography>
                </Box>
            ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, maxWidth: 560, textAlign: 'left' }}>
                    <Box
                        component="img"
                        src={dfLogo}
                        alt=""
                        aria-hidden="true"
                        sx={{ width: 32, height: 30, opacity: 0.82, flexShrink: 0 }}
                    />
                    <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: textVar.sm, lineHeight: 1.4, fontWeight: 600, color: 'text.primary' }}>
                            {t('dataThread.emptySessionTitle')}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 0.25, fontSize: textVar.xs, lineHeight: 1.5, color: 'text.secondary' }}>
                            {t('dataThread.emptySession')}
                        </Typography>
                    </Box>
                </Box>
            )}
        </Box>
    );

    return (
        <Box
            ref={outerRef}
            className="data-thread"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            sx={{
                ...sx,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                ...(isDragOver && {
                    outline: '2px dashed',
                    outlineColor: 'primary.main',
                    outlineOffset: -2,
                    backgroundColor: 'action.hover',
                }),
            }}
        >
            <Box ref={containerRef}
                sx={{
                    overflow: 'hidden', 
                    position: 'relative',
                    direction: 'rtl', 
                    display: 'block', 
                    flex: 1,
                    minHeight: 0,
                }}>
                <ToolActivitySelectionContext.Provider value={activitySelection}>{view}</ToolActivitySelectionContext.Provider>
                <ScrollFadeEdge visible={moreThreadContentAbove} edge="top" />
                <ScrollFadeEdge visible={moreThreadContentBelow} />
            </Box>
            <SimpleChartRecBox />
        </Box>
    );
}

