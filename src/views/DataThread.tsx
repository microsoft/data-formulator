// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
    CircularProgress,
    Badge,
    Collapse,
    Card,
} from '@mui/material';


import '../scss/VisualizationView.scss';
import { useTranslation } from 'react-i18next';
import { batch, useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors, SSEMessage, GeneratedReport } from '../app/dfSlice';
import { getTriggers, getUrls, fetchWithIdentity } from '../app/utils';
import { extractErrorMessage } from '../app/errorHandler';
import { Chart, DictTable, Trigger, InteractionEntry, TextTurn } from "../components/ComponentType";
import { CATALOG_TABLE_ITEM } from '../components/DndTypes';
import type { CatalogTableDragItem } from '../components/DndTypes';
import { ScrollFadeEdge, useScrollFade } from '../components/ScrollFade';
import { loadTable } from '../app/tableThunks';
import { AppDispatch } from '../app/store';

import DeleteIcon from '@mui/icons-material/Delete';
import PersonIcon from '@mui/icons-material/Person';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { TableIcon, InsightIcon, StreamIcon, AgentIcon } from '../icons';


import _ from 'lodash';
import { getChartTemplate } from '../components/ChartTemplates';

import 'prismjs/components/prism-python' // Language
import 'prismjs/components/prism-typescript' // Language
import 'prismjs/themes/prism.css'; //Example style, you can use another

import { checkChartAvailability, generateChartSkeleton, getDataTable } from './ChartUtils';

import AttachFileIcon from '@mui/icons-material/AttachFile';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import { alpha } from '@mui/material/styles';

import BarChartIcon from '@mui/icons-material/BarChart';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot';
import PieChartOutlineIcon from '@mui/icons-material/PieChartOutline';
import GridOnIcon from '@mui/icons-material/GridOn';
import { buildTriggerCard, buildTableCard, buildTableRefChip, buildChartCards, BuildTableCardProps } from './DataThreadCards';
import { SourceTableShelf, SHELF_VISIBLE_LIMIT } from './SourceTableShelf';
import { UnifiedDataUploadDialog } from './UnifiedDataUploadDialog';
import { AgentRulesDialog } from './AgentRulesDialog';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';

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

import { ComponentBorderStyle, transition, radius, borderColor } from '../app/tokens';

import { SimpleChartRecBox } from './SimpleChartRecBox';
import { InteractionEntryCard, ResolvedConversationCard, getEntryGutterIcon, getDefaultGutterIcon, PlanStepsView } from './InteractionEntryCard';
import { fittableThreadColumnsFor, iconVar, textVar } from '../app/layout';
import { useLayout } from '../app/LayoutProvider';

/** Pick the icon component for a step line based on known prefixes. */
// Re-exported from InteractionEntryCard — kept here for backward compat with gutter icon logic

/** Live elapsed-time hint in whole seconds (`5s`, `12s`).
 *  Ticks once per second — fast enough to read as live, slow enough that the
 *  digit stays readable and doesn't pull peripheral attention. Liveness is
 *  also conveyed by the banner's shimmer animation.
 *  When `startTime` is omitted, anchors to the component's mount time —
 *  useful for places where we don't have a meaningful upstream anchor.
 *  When `resetKey` changes (e.g. the active step transitions from "thinking"
 *  to "running code"), the anchor is reset to *now* so the timer reflects
 *  the duration of the **current** action rather than the cumulative wait. */
const LiveStatus: React.FC<{ startTime?: number; resetKey?: string }> = ({ startTime, resetKey }) => {
    const anchorRef = useRef(startTime ?? Date.now());
    const lastResetKeyRef = useRef(resetKey);
    if (startTime != null && anchorRef.current !== startTime && resetKey === lastResetKeyRef.current) {
        anchorRef.current = startTime;
    }
    if (resetKey !== lastResetKeyRef.current) {
        anchorRef.current = Date.now();
        lastResetKeyRef.current = resetKey;
    }
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);
    const secs = Math.max(0, Math.floor((now - anchorRef.current) / 1000));
    const label = secs < 60
        ? `${secs}s`
        : `${Math.floor(secs / 60)}m${secs % 60}s`;
    return (
        <Typography component="span" sx={{
            fontSize: textVar.xxs,
            color: 'text.disabled',
            fontVariantNumeric: 'tabular-nums',
            ml: '6px',
            flexShrink: 0,
            whiteSpace: 'nowrap',
        }}>
            {label}
        </Typography>
    );
};

/** Render a multi-step thinking banner as a single block with sectioned steps.
 *  When `startTime` is provided, the live timer is appended *inline* next to
 *  the active (last) step's text — same alignment grammar as the single-line
 *  ThinkingBanner — rather than right-flushed in a separate column.
 *  The timer resets whenever the active step changes so it shows the time
 *  spent on the **current** action, not the cumulative wait. */
export const ThinkingStepsBanner = (steps: string[], sx?: SxProps, startTime?: number, active: boolean = true) => {
    const activeStep = steps.length > 0 ? steps[steps.length - 1] : '';
    return (
        <Box sx={{ ...sx }}>
            <PlanStepsView
                steps={steps}
                activeLastStep={active}
                trailing={startTime != null ? <LiveStatus startTime={startTime} resetKey={activeStep} /> : undefined}
            />
        </Box>
    );
};

/** Simple single-message thinking banner (used when no step breakdown is available). */
export const ThinkingBanner = (message: string, sx?: SxProps, active: boolean = true, showTimer: boolean = false, startTime?: number) => {
    return (
        <Box sx={{
            display: 'flex', alignItems: 'center', gap: '4px',
            position: 'relative', overflow: 'hidden',
            ...(active ? {
                '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: 0, left: 0, width: '100%', height: '100%',
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.8) 50%, transparent 100%)',
                    animation: 'windowWipe 2s ease-in-out infinite',
                    zIndex: 1, pointerEvents: 'none',
                },
                '@keyframes windowWipe': {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(100%)' },
                },
            } : {}),
            ...sx,
        }}>
            <Typography variant="body2" sx={{ fontSize: textVar.xxs, color: 'text.secondary' }}>
                {message}
            </Typography>
            {showTimer && <LiveStatus startTime={startTime} resetKey={message} />}
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
                                            <AttachFileIcon sx={{ fontSize: textVar.xxs, color: 'text.disabled', flexShrink: 0 }} />
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

let SingleThreadGroupView: FC<{
    threadLabel?: string, // Header label; absent on continuation segments
    // A continuation of the thread above: renders the "↑ continued" header +
    // a chip for the carried-over parent, and no label of its own.
    isSplitThread?: boolean,
    hasContinuationBelow?: boolean, // When true, render "↓ continues below" footer
    // The source table this thread grows out of. Source tables are NOT part of
    // the thread system (they live in the shelf); a thread only echoes its
    // origin as a compact reference chip so the reader can see where it started.
    originTableId?: string,
    // The thread's terminal table, if any. A thread with no leaf table is a
    // source table's artifact thread (charts / reports / conversation only).
    leafTable?: DictTable;
    chartElements: { tableId: string, chartId: string, element: any }[];
    usedIntermediateTableIds: string[],
    globalHighlightedTableIds: string[],
    focusedThreadLeafId?: string, // The leaf table ID of the thread containing the focused table
    sx?: SxProps
}> = function ({
    threadLabel,
    isSplitThread = false,
    hasContinuationBelow = false,
    originTableId,
    leafTable,
    chartElements,
    usedIntermediateTableIds,
    globalHighlightedTableIds,
    focusedThreadLeafId,
    sx
}) {

    let tables = useSelector((state: DataFormulatorState) => state.tables);
    const { t } = useTranslation();
    const tableById = useMemo(() => new Map(tables.map(t => [t.id, t])), [tables]);

    // Thread is highlighted only if it ends at the focused thread's leaf,
    // or (for a source-artifact thread) it hosts the focused source table's artifacts.
    const ownsOriginArtifacts = !!originTableId && !usedIntermediateTableIds.includes(originTableId);
    const threadHighlighted = !!focusedThreadLeafId
        && (leafTable?.id === focusedThreadLeafId
            || (ownsOriginArtifacts && originTableId === focusedThreadLeafId));
    // Ancestor thread: not the focused thread, but *owns* some highlighted tables
    // (tables that only appear as used/shared references don't count)
    const isAncestorThread = !threadHighlighted && globalHighlightedTableIds.length > 0
        && !!leafTable && (() => {
            const trigs = getTriggers(leafTable, tables);
            const chainIds = [...trigs.map(tp => tp.tableId), leafTable.id];
            const ownedIds = chainIds.filter(id => !usedIntermediateTableIds.includes(id));
            return ownedIds.some(id => globalHighlightedTableIds.includes(id));
        })();
    const shouldHighlightThread = threadHighlighted || isAncestorThread;
    let parentTableId = leafTable?.derive?.trigger.tableId || undefined;
    let parentTable = (parentTableId ? tableById.get(parentTableId) : undefined) as DictTable;

    let charts = useSelector(dfSelectors.getAllCharts);
    let focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    let focusedChartId = focusedId?.type === 'chart' ? focusedId.chartId : undefined;
    let textTurns = useSelector((state: DataFormulatorState) => state.textTurns);
    let focusedTableId = useMemo(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        if (focusedId.type === 'chart') {
            const chart = charts.find(c => c.id === focusedId.chartId);
            return chart?.tableRef;
        }
        if (focusedId.type === 'text') {
            // Highlight the text turn's thread-parent table (or its source
            // chart's table), mirroring chart focus (design-docs/41/42).
            const turn = textTurns.find(tt => tt.id === focusedId.textId);
            if (!turn) return undefined;
            if (turn.sourceChartId) {
                const chart = charts.find(c => c.id === turn.sourceChartId);
                if (chart?.tableRef) return chart.tableRef;
            }
            let cur: TextTurn | undefined = turn;
            const seen = new Set<string>();
            while (cur && !seen.has(cur.id)) {
                seen.add(cur.id);
                const p: string | undefined = cur.parentNodeId;
                if (!p) return undefined;
                if (tableById.has(p)) return p;
                cur = textTurns.find(tt => tt.id === p);
            }
            return undefined;
        }
        return undefined;
    }, [focusedId, charts, textTurns]);
    let draftNodes = useSelector((state: DataFormulatorState) => state.draftNodes);
    let generatedReports = useSelector(dfSelectors.getAllGeneratedReports);

    // Build a map from tableId → reports triggered from that table
    const reportsByTriggerTable = useMemo(() => {
        const map = new Map<string, GeneratedReport[]>();
        for (const report of generatedReports) {
            const triggerId = report.triggerTableId;
            if (!triggerId) continue;
            const list = map.get(triggerId) || [];
            list.push(report);
            map.set(triggerId, list);
        }
        return map;
    }, [generatedReports]);

    // Text turns render by their authored parent edge (design-docs/42): each
    // turn is a child of its `parentNodeId` — a table (a fresh turn on it) or
    // another turn (a chained follow-up).
    const textTurnChildrenOf = useMemo(() => {
        const map = new Map<string, TextTurn[]>();
        for (const turn of textTurns) {
            const key = turn.parentNodeId;
            if (!key) continue;
            const list = map.get(key) || [];
            list.push(turn);
            map.set(key, list);
        }
        for (const list of map.values()) list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        return map;
    }, [textTurns]);

    const turnById = useMemo(() => new Map(textTurns.map(tt => [tt.id, tt])), [textTurns]);

    // A turn is a "lead-up" if it PRODUCED a table — i.e. it sits on some table's
    // `threadParentId` chain (the clarify/answer that resolved into that table).
    // Such turns render WITH their result table (as its lead-in, in the table's
    // thread) so the conversation and its result stay connected — NOT at the root
    // table. Terminal / still-pending turns (no result yet) render at the root's
    // real card instead (design-docs/42).
    const leadUpTurnIds = useMemo(() => {
        const s = new Set<string>();
        for (const t of tables) {
            let cur: string | undefined = t.threadParentId;
            const seen = new Set<string>();
            while (cur && !seen.has(cur)) {
                seen.add(cur);
                const turn = turnById.get(cur);
                if (!turn) break;              // reached a table / unknown
                s.add(turn.id);
                cur = turn.parentNodeId;
                if (cur && tableById.has(cur)) break; // reached the root table
            }
        }
        return s;
    }, [tables, turnById, tableById]);

    // The lead-up conversation for a table: the turn chain from its
    // `threadParentId` up to (not including) the root table, oldest first.
    const leadUpTurnsOf = (tableId: string): TextTurn[] => {
        const t = tableById.get(tableId);
        if (!t?.threadParentId) return [];
        const out: TextTurn[] = [];
        let cur: string | undefined = t.threadParentId;
        const seen = new Set<string>();
        while (cur && !seen.has(cur)) {
            seen.add(cur);
            const turn = turnById.get(cur);
            if (!turn) break;
            out.push(turn);
            cur = turn.parentNodeId;
            if (cur && tableById.has(cur)) break;
        }
        return out.reverse();
    };

    const runningAgentTableIds = useMemo(() => {
        const ids = new Map<string, { description: string }>();
        for (const d of draftNodes) {
            if (d.derive?.status === 'running') {
                ids.set(d.derive.trigger.tableId, { description: d.derive.runningPlan || '' });
            }
        }
        return ids;
    }, [draftNodes]);

    const clarifyAgentTableIds = useMemo(() => {
        const ids = new Map<string, { question: string }>();
        for (const d of draftNodes) {
            if (d.derive?.status === 'clarifying') {
                // The pause entry is one of clarify / explain /
                // delegate; all three shape the timeline the
                // same way (an attention row above the input box).
                const pauseEntry = d.derive.trigger.interaction
                    ?.filter(e => e.role === 'clarify' || e.role === 'explain' || e.role === 'delegate').pop();
                ids.set(d.derive.trigger.tableId, { question: pauseEntry?.content || '' });
            }
        }
        return ids;
    }, [draftNodes]);

    const theme = useTheme();

    const dispatch = useDispatch();

    let [collapsed, setCollapsed] = useState<boolean>(false);

    const w: any = (a: any[], b: any[], spaceElement?: any) => a.length ? [a[0], b.length == 0 ? "" : (spaceElement || ""), ...w(b, a.slice(1), spaceElement)] : b;
    
    let triggerPairs = parentTable ? getTriggers(parentTable, tables) : [];
    // Source tables never render as cards inside a thread — they live in the
    // shelf, and the thread echoes its origin as a chip instead.
    let tableIdList = (parentTable ? [...triggerPairs.map((tp) => tp.tableId), parentTable.id] : [])
        .filter(id => !!tableById.get(id)?.derive);

    let usedTableIdsInThread = tableIdList.filter(id => usedIntermediateTableIds.includes(id));
    let newTableIds = tableIdList.filter(id => !usedTableIdsInThread.includes(id));
    let newTriggerPairs = triggerPairs.filter(tp => newTableIds.includes(tp.resultTableId));

    // Use the global highlighted table IDs (computed at DataThread level from the focused table's full ancestor chain)
    let highlightedTableIds = globalHighlightedTableIds;

    let _buildTriggerCard = (trigger: Trigger, highlighted: boolean = false) => {
        return buildTriggerCard(trigger, focusedChartId, highlighted);
    }

    // Shared props for buildTableCard calls
    let tableCardProps: Omit<BuildTableCardProps, 'tableId'> = {
        tables, chartElements, usedIntermediateTableIds,
        highlightedTableIds, focusedTableId, focusedChartId,
        parentTable, tableIdList, collapsed, dispatch,
        primaryBgColor: theme.palette.primary.bgcolor,
        t,
    };

    let _buildTableCard = (tableId: string) => {
        return buildTableCard({ tableId, ...tableCardProps });
    }

    /** Pointer to a table whose real card lives in the shelf or a prior column. */
    let _buildRefChip = (tableId: string) => {
        return buildTableRefChip({
            tableId, table: tableById.get(tableId),
            focused: tableId === focusedTableId, dispatch,
        });
    }

    let tableElementList = newTableIds.map((tableId, i) => _buildTableCard(tableId));
    let triggerCards = newTriggerPairs.map((tp) => {
        const isHL = highlightedTableIds.includes(tp.resultTableId);
        return _buildTriggerCard(tp, isHL);
    });

    // Build a flat sequence of timeline items: [trigger, table, charts, trigger, table, charts, ...]
    type TimelineItem = { key: string; element: React.ReactNode; type: 'used-table' | 'trigger' | 'table' | 'chart' | 'leaf-trigger' | 'leaf-table' | 'artifact' | 'merge'; highlighted: boolean; tableId?: string; chartType?: string; isRunning?: boolean; isClarifying?: boolean; isCompleted?: boolean; interactionEntry?: InteractionEntry; reportId?: string; stepLabel?: string; gutterIcon?: React.ReactNode };
    let timelineItems: TimelineItem[] = [];

    // Each running/clarifying draft should produce at most ONE banner per
    // render pass. The same draft can be reachable from multiple
    // pushAgentDraftItems call sites (the trigger-table loop *and* the
    // leaf-table loop both call it for whichever tableId they're rendering),
    // and after a `visualize` event the draft's `trigger.tableId` flips to
    // the freshly-created child — which is then visited again as a leaf,
    // so without deduping we get a duplicate "working..." banner.
    const renderedDraftIds = new Set<string>();

    // Provenance tracker: the set of source-table IDs currently in scope for
    // this thread. A merge node is emitted whenever an instruction's input
    // table set differs from this — covering joins (set grows), narrowings
    // (set shrinks), and substitutions (set changes). Initialised to the
    // **root computation parents** of the thread's anchor so the first
    // derivation against the same roots stays silent.
    //
    // We compare on table IDs rather than display names: names are derived
    // from `displayId || stripExt(sid)` and can drift between sides.
    //
    // Why "root parents" instead of `parentTable.id`: `derive.source`
    // contains *root/anchored* table IDs (computation parents), while
    // `parentTable` may itself be a derived intermediate. Comparing the
    // intermediate's own id against an instruction's root-id source set
    // would always mismatch and emit a redundant merge node on the very
    // first derivation in the thread.
    const sourceSetKey = (ids: string[]): string => [...ids].sort().join('\x1F');
    const initialSourceIds: string[] = (() => {
        if (!parentTable) return [];
        // If parentTable is a root (no derive) or anchored, it IS the source.
        const src = parentTable.derive?.source as string[] | undefined;
        if (!src || src.length === 0) return [parentTable.id];
        return src;
    })();
    let prevSourceKey: string | null = initialSourceIds.length > 0 ? sourceSetKey(initialSourceIds) : null;

    // ── Shared helpers for building timeline items from interaction entries ──

    /** Push visible interaction entries as timeline items.
     *  Adaptively collapses: when a data-agent summary is immediately followed
     *  by an instruction, the summary text is folded into the instruction's
     *  `plan` (expandable) rather than shown as a separate entry. */
    const pushInteractionEntries = (
        entries: InteractionEntry[],
        tableId: string,
        triggerType: 'trigger' | 'leaf-trigger',
        highlighted: boolean,
        keyPrefix: string,
        extraProps?: Partial<TimelineItem>,
    ) => {
        // Enrich instruction entries with inputTableNames from derive.source if not already set
        const derivedTable = tableById.get(tableId);
        const deriveSourceNames = derivedTable?.derive?.source
            ? (derivedTable.derive.source as string[]).map(sid => {
                const st = tableById.get(sid);
                return st?.displayId || sid.replace(/\.[^/.]+$/, "");
            })
            : undefined;

        for (let ei = 0; ei < entries.length; ei++) {
            const entry = entries[ei];
            const nextEntry = ei + 1 < entries.length ? entries[ei + 1] : null;

            // Collapse: summary from data-agent followed by instruction → fold into instruction's plan
            if (entry.role === 'summary' && entry.from === 'data-agent'
                && nextEntry?.role === 'instruction') {
                // Merge: use the summary content as the plan on the next instruction
                // (only if the instruction doesn't already have a plan)
                if (!nextEntry.plan) {
                    nextEntry.plan = entry.content;
                }
                continue; // skip rendering this summary entry
            }

            // Enrich instruction entries with source table names
            const enrichedEntry = (entry.role === 'instruction' && !entry.inputTableNames && deriveSourceNames)
                ? { ...entry, inputTableNames: deriveSourceNames }
                : entry;

            // ── Resolved Q&A folding ──
            // When a clarify/explain/delegate has been resolved
            // by a following user reply, fold the pair into a single
            // compact "conversation" timeline item. Consecutive resolved
            // pairs are accumulated into ONE item so a back-and-forth of
            // multiple rounds collapses to one trace.
            const isPauseRole = entry.role === 'clarify'
                || entry.role === 'explain'
                || entry.role === 'delegate';
            if (isPauseRole && entry.from !== 'user') {
                const pairs: { agentEntry: InteractionEntry; userEntry: InteractionEntry }[] = [];
                let cursor = ei;
                while (cursor < entries.length) {
                    const ag = entries[cursor];
                    const agIsPause = ag.role === 'clarify' || ag.role === 'explain' || ag.role === 'delegate';
                    if (!agIsPause || ag.from === 'user') break;
                    // Find the next user entry to pair with this agent question.
                    let userIdx = -1;
                    for (let j = cursor + 1; j < entries.length; j++) {
                        if (entries[j].from === 'user') { userIdx = j; break; }
                        // Stop searching if we hit another agent pause without
                        // an intervening user reply — that pause is still
                        // unresolved and shouldn't fold.
                        const r = entries[j].role;
                        if (r === 'clarify' || r === 'explain' || r === 'delegate') break;
                    }
                    if (userIdx < 0) break;
                    pairs.push({ agentEntry: ag, userEntry: entries[userIdx] });
                    cursor = userIdx + 1;
                }
                if (pairs.length > 0) {
                    timelineItems.push({
                        key: `${keyPrefix}-conv-${tableId}-${ei}`,
                        type: triggerType,
                        highlighted,
                        element: <ResolvedConversationCard pairs={pairs} highlighted={highlighted} sourceTableId={tableId} />,
                        interactionEntry: pairs[pairs.length - 1].userEntry,
                        gutterIcon: (
                            <ForumOutlinedIcon sx={{
                                fontSize: textVar.xl,
                                color: highlighted ? theme.palette.text.secondary : 'rgba(0,0,0,0.25)',
                            }} />
                        ),
                        ...extraProps,
                    });
                    ei = cursor - 1; // for-loop's ++ will advance past the last consumed user entry
                    continue;
                }
            }

            const isResolved = (entry.role === 'clarify' || entry.role === 'explain' || entry.role === 'delegate')
                && entries.slice(ei + 1).some(e => e.from === 'user');
            timelineItems.push({
                key: `${keyPrefix}-${entry.role}-${tableId}-${ei}`,
                type: triggerType,
                highlighted,
                element: <InteractionEntryCard entry={enrichedEntry} highlighted={highlighted} resolved={isResolved} />,
                interactionEntry: entry,
                ...extraProps,
            });

            // Emit a structural "merge node" between the instruction and its
            // result table whenever the set of source tables CHANGES from the
            // previously-active set in this thread — covers joining-in new
            // sources, narrowing the set, or substituting one source for
            // another. Repeated derivations against the same source set stay
            // silent (no chrome).
            //
            // Compare on table IDs (from `derive.source`) for stability;
            // names are only used for display.
            const mergeNames = enrichedEntry.inputTableNames;
            const mergeIds = derivedTable?.derive?.source as string[] | undefined;
            if (entry.role === 'instruction' && mergeNames && mergeNames.length > 0 && mergeIds && mergeIds.length > 0) {
                const nextKey = sourceSetKey(mergeIds);
                if (nextKey !== prevSourceKey) {
                    const mergeColor = highlighted ? theme.palette.primary.main : theme.palette.text.secondary;
                    timelineItems.push({
                        key: `${keyPrefix}-merge-${tableId}-${ei}`,
                        type: 'merge',
                        highlighted,
                        element: (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: '6px', rowGap: 0, color: mergeColor, fontSize: textVar.xs }}>
                                <Typography component="span" sx={{ fontSize: 'inherit', color: 'inherit' }}>
                                    {t('dataThread.usingSources')}
                                </Typography>
                                {mergeNames.map((name, idx) => (
                                    <Box key={`${name}-${idx}`} component="span" sx={{ display: 'inline-flex', alignItems: 'center', columnGap: '3px' }}>
                                        <TableIcon sx={{ fontSize: textVar.xs, color: 'inherit' }} />
                                        <Typography component="span" sx={{ fontSize: 'inherit', color: 'inherit' }}>
                                            {name}
                                        </Typography>
                                    </Box>
                                ))}
                            </Box>
                        ),
                        ...extraProps,
                    });
                    prevSourceKey = nextKey;
                }
            }
        }
    };

    /** Split interaction at the last instruction boundary: entries before → rendered before table, after → rendered after. */
    const splitAtLastInstruction = (interaction: InteractionEntry[]): [InteractionEntry[], InteractionEntry[]] => {
        const lastInstrIdx = (() => { for (let i = interaction.length - 1; i >= 0; i--) { if (interaction[i].role === 'instruction') return i; } return -1; })();
        return [
            interaction.slice(0, lastInstrIdx + 1),
            lastInstrIdx >= 0 ? interaction.slice(lastInstrIdx + 1) : [],
        ];
    };

    /** Append timeline items for a running, clarifying, or explaining agent draft.
     *
     *  When the interaction contains a clarify/explain entry (with a `plan`
     *  snapshot of the first-round thinking steps), the rendering is split:
     *    1. Entries before the pause (user prompt)
     *    2. ThinkingStepsBanner for first-round steps (from pause entry's plan)
     *    3. Pause entry + user response entries
     *    4. ThinkingStepsBanner for second-round steps (from runningPlan)
     */
    const pushAgentDraftItems = (
        tableId: string,
        triggerType: 'trigger' | 'leaf-trigger',
        highlighted: boolean,
    ) => {
        const renderSplitByClarity = (
            interaction: InteractionEntry[],
            runningPlan: string | undefined,
            isRunning: boolean,
            keyPrefix: string,
        ) => {
            // For the live banner, anchor elapsed-time to the most recent
            // user-side entry so resuming after a clarify resets the counter
            // (the agent's *current* cycle started then, not the original
            // prompt). Falls back to the first interaction timestamp.
            const lastUserTs = (() => {
                for (let i = interaction.length - 1; i >= 0; i--) {
                    if (interaction[i].from === 'user' && interaction[i].timestamp) {
                        return interaction[i].timestamp as number;
                    }
                }
                return interaction[0]?.timestamp;
            })();
            const pauseIdx = interaction.findIndex(e => e.role === 'clarify' || e.role === 'explain' || e.role === 'delegate');
            if (pauseIdx < 0) {
                // No pause — render all entries then ThinkingStepsBanner
                pushInteractionEntries(interaction, tableId, triggerType, highlighted, keyPrefix);
                const planLines = (runningPlan || t('dataThread.thinking')).split('\x1E').filter((l: string) => l.trim());
                timelineItems.push({
                    key: `agent-thinking-${tableId}`,
                    type: triggerType,
                    highlighted,
                    isRunning,
                    element: ThinkingStepsBanner(planLines, { px: 1, py: 0.5 }, isRunning ? lastUserTs : undefined, isRunning),
                });
                return;
            }

            // Split at the pause entry
            const beforePause = interaction.slice(0, pauseIdx);
            const pauseAndAfter = interaction.slice(pauseIdx);
            const pauseEntry = interaction[pauseIdx];

            // 1. Entries before the pause (user prompt etc.)
            if (beforePause.length > 0) {
                pushInteractionEntries(beforePause, tableId, triggerType, highlighted, `${keyPrefix}-pre`);
            }

            // 2. First-round thinking steps (snapshotted in pause entry's plan)
            if (pauseEntry.plan) {
                const priorLines = (pauseEntry.plan.includes('\x1E') ? pauseEntry.plan.split('\x1E') : pauseEntry.plan.split('\n')).filter((l: string) => l.trim());
                if (priorLines.length > 0) {
                    timelineItems.push({
                        key: `agent-thinking-prior-${tableId}`,
                        type: triggerType,
                        highlighted,
                        isRunning: false,
                        element: ThinkingStepsBanner(priorLines, { px: 1, py: 0.5 }, undefined, false),
                    });
                }
            }

            // 3. Pause + response entries
            pushInteractionEntries(pauseAndAfter, tableId, triggerType, highlighted, `${keyPrefix}-post`, { isClarifying: false, tableId });

            // 4. Second-round thinking steps (current runningPlan)
            if (isRunning) {
                const planLines = (runningPlan || t('dataThread.thinking')).split('\x1E').filter((l: string) => l.trim());
                timelineItems.push({
                    key: `agent-thinking-${tableId}`,
                    type: triggerType,
                    highlighted,
                    isRunning: true,
                    element: ThinkingStepsBanner(planLines, { px: 1, py: 0.5 }, lastUserTs),
                });
            }
        };

        if (runningAgentTableIds.has(tableId)) {
            const runningDraft = draftNodes.find(d => d.derive?.status === 'running' && d.derive.trigger.tableId === tableId);
            if (runningDraft && renderedDraftIds.has(runningDraft.id)) {
                return;
            }
            if (runningDraft) renderedDraftIds.add(runningDraft.id);
            const draftInteraction = runningDraft?.derive?.trigger?.interaction;
            // Once a report is streaming for this table, the generating report
            // card (with its own spinner + "composing…" text) is the live
            // indicator — so we drop the thinking banner entirely to avoid a
            // second running state. We still render the prompt entries.
            const generatingReports = (reportsByTriggerTable.get(tableId) || [])
                .filter(r => r.status === 'generating');
            const hasGeneratingReport = generatingReports.length > 0;
            if (draftInteraction && draftInteraction.length > 0) {
                if (hasGeneratingReport) {
                    // Just the prompt/clarity entries — no thinking banner.
                    pushInteractionEntries(draftInteraction, tableId, triggerType, highlighted, 'agent-running-entry');
                } else {
                    renderSplitByClarity(
                        draftInteraction,
                        runningDraft?.derive?.runningPlan,
                        true,
                        'agent-running-entry',
                    );
                }
            } else if (!hasGeneratingReport) {
                const runningAction = runningAgentTableIds.get(tableId);
                // `description` is the running plan: steps joined by STEP_SEP
                // ('\x1E'), which renders invisibly. Split it back into discrete
                // steps and render through the per-step banner (icons + ✓), the
                // same way the interaction-present path does — otherwise the
                // steps collapse into one run-on blob.
                const planLines = (runningAction?.description || '')
                    .split('\x1E').map(s => s.trim()).filter(Boolean);
                timelineItems.push({
                    key: `agent-running-${tableId}`,
                    type: 'chart',
                    highlighted,
                    isRunning: true,
                    element: planLines.length > 0
                        ? ThinkingStepsBanner(planLines, { px: 1, py: 0.5 })
                        : ThinkingBanner(t('dataThread.working'), { px: 1, py: 0.5 }, true, true),
                });
            }
            // Live generating report card: rendered here (after the prompt,
            // inside the running draft block) so it appears below the prompt
            // while the report streams in — never above it. Completed reports
            // render in the artifact slot via pushReportItems.
            for (const report of generatingReports) {
                timelineItems.push(buildReportTimelineItem(report, highlighted));
            }
        } else if (clarifyAgentTableIds.has(tableId)) {
            const clarifyDraft = draftNodes.find(d => d.derive?.status === 'clarifying' && d.derive.trigger.tableId === tableId);
            if (clarifyDraft && renderedDraftIds.has(clarifyDraft.id)) {
                return;
            }
            if (clarifyDraft) renderedDraftIds.add(clarifyDraft.id);
            const clarifyInteraction = clarifyDraft?.derive?.trigger?.interaction;
            if (clarifyInteraction && clarifyInteraction.length > 0) {
                renderSplitByClarity(
                    clarifyInteraction,
                    undefined,
                    false,
                    'agent-clarify-entry',
                );
                const lastItem = timelineItems[timelineItems.length - 1];
                if (lastItem?.interactionEntry?.role === 'clarify' || lastItem?.interactionEntry?.role === 'explain' || lastItem?.interactionEntry?.role === 'delegate') {
                    lastItem.isClarifying = true;
                }
            } else {
                timelineItems.push({
                    key: `agent-clarify-${tableId}`,
                    type: 'chart',
                    highlighted,
                    isClarifying: true,
                    tableId,
                    element: <Typography variant="body2" sx={{ fontSize: textVar.xxs, color: theme.palette.warning.main, px: 1, py: 0.5 }}>{t('dataThread.waitingForClarification')}</Typography>,
                });
            }
        }
    };

    /** Push table card and its chart elements as timeline items. */
    const pushTableAndChartItems = (
        tableId: string,
        tableCard: any,
        tableType: 'table' | 'leaf-table',
        highlighted: boolean,
    ) => {
        if (Array.isArray(tableCard)) {
            tableCard.forEach((subItem: any, j: number) => {
                if (!subItem) return;
                const subKey = subItem?.key || `card-${tableId}-${j}`;
                const isChart = subKey.includes('chart');
                let itemChartType: string | undefined;
                if (isChart) {
                    const cIdMatch = subKey.match(/(?:chart)-(.+)$/);
                    if (cIdMatch) {
                        const cObj = charts.find(c => c.id === cIdMatch[1]);
                        itemChartType = cObj?.chartType;
                    }
                }
                timelineItems.push({
                    key: subKey,
                    type: isChart ? 'chart' : tableType,
                    tableId: isChart ? undefined : tableId,
                    chartType: itemChartType,
                    highlighted,
                    element: subItem,
                });
            });
        }
    };
    // Build a single report's timeline item. Shared by pushReportItems
    // (completed reports, in the artifact slot) and pushAgentDraftItems (the
    // live generating card, rendered inside the running draft block so it sits
    // below the prompt + thinking steps rather than above them).
    const buildReportTimelineItem = (report: GeneratedReport, highlighted: boolean) => {
        const isFocused = focusedId?.type === 'report' && focusedId.reportId === report.id;
        const rowHL = highlighted || isFocused;
        const isGenerating = report.status === 'generating';
        const gutterIcon = isGenerating
            ? <CircularProgress size={12} thickness={5} sx={{ color: theme.palette.secondary.main }} />
            : <ArticleIcon sx={{ width: 14, height: 14, color: rowHL ? theme.palette.secondary.main : 'rgba(0,0,0,0.3)' }} />;
        const card = (
            <Card className={`data-thread-card ${isFocused ? 'selected-report-card' : ''}`} elevation={0}
                sx={{
                    width: '100%', backgroundColor: theme.palette.secondary.bgcolor,
                    ...ComponentBorderStyle,
                    ...(rowHL ? { borderLeft: '2px solid', borderLeftColor: 'secondary.main' } : {}),
                    borderRadius: '6px', cursor: 'pointer',
                }}
                onClick={() => dispatch(dfActions.setFocused({ type: 'report', reportId: report.id }))}
            >
                <Box sx={{ margin: '0px', display: 'flex', minWidth: 0, alignItems: 'center',
                    '& .report-delete-btn': { opacity: 0, transition: 'opacity 0.15s' },
                    '&:hover .report-delete-btn': { opacity: 1 },
                }}>
                    <Box sx={{ margin: '4px 8px 4px 6px', minWidth: 0, flex: 1 }}>
                        <Typography sx={{
                            fontSize: textVar.xs, fontWeight: 500, color: 'text.primary',
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                            overflow: 'hidden', wordBreak: 'break-all',
                        }}>
                            {report.title || t('report.untitled')}
                        </Typography>
                        {isGenerating && (
                            <Typography sx={{ fontSize: textVar.xxs, color: 'text.disabled', lineHeight: 1.3, mt: 0.25 }}>
                                {t('report.composing')}
                            </Typography>
                        )}
                    </Box>
                    <Tooltip title={t('dataThread.deleteReport')}>
                        <IconButton className="report-delete-btn" size="small" color="error"
                            sx={{ p: 0.5, mr: 0.5, '&:hover': { transform: 'scale(1.15)' } }}
                            onClick={(e) => { e.stopPropagation(); dispatch(dfActions.deleteGeneratedReport(report.id)); }}
                        >
                            <DeleteIcon sx={{ fontSize: iconVar.md }} />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Card>
        );
        return {
            key: `report-${report.id}`, type: 'artifact' as const, highlighted: rowHL,
            reportId: report.id, gutterIcon, element: card,
        };
    };
    // Push report artifacts triggered from the given table. A report is an
    // *output card* of the run (like a chart) that OWNS its closing summary:
    // the card renders, then the report's own summary renders right below it
    // (from `report.summary`, not a table-anchored interaction entry), so the
    // report and its summary live and die together.
    //
    // Only COMPLETED (non-generating) reports render here. A still-generating
    // report is rendered live inside the running draft block (see
    // pushAgentDraftItems) so it appears below the prompt, not above it.
    const pushReportItems = (
        tableId: string,
        highlighted: boolean,
        triggerType: 'trigger' | 'leaf-trigger',
    ) => {
        const reports = reportsByTriggerTable.get(tableId);
        if (!reports) return;
        for (const report of reports) {
            if (report.status === 'generating') continue;
            timelineItems.push(buildReportTimelineItem(report, highlighted));
            if (report.summary) {
                const summaryEntry: InteractionEntry = {
                    from: 'data-agent', to: 'user', role: 'summary',
                    plan: report.summaryThought,
                    content: report.summary,
                    timestamp: report.updatedAt,
                };
                pushInteractionEntries(
                    [summaryEntry], tableId, triggerType, highlighted,
                    `report-summary-${report.id}`,
                );
            }
        }
    };

    // Build a single text-turn timeline item (clarify / explain), mirroring
    // buildReportTimelineItem (design-docs/41). Clicking focuses it — its panel
    // overlays above the chat while the canvas keeps the source chart; the delete
    // button removes it (generic artifact delete). `showPrompt` folds the
    // triggering prompt into the card (leaf / terminal case) so it renders as a
    // single self-contained artifact (like a report); the compositional-trigger
    // case passes false and renders the prompt as a separate trigger entry.
    const buildTextTurnTimelineItem = (turn: TextTurn, highlighted: boolean, showPrompt: boolean) => {
        const isFocused = focusedId?.type === 'text' && focusedId.textId === turn.id;
        const rowHL = highlighted || isFocused;
        const preview = (turn.content || '')
            .replace(/[#*`>|]/g, ' ').replace(/\s+/g, ' ').trim();
        // No timeline dot for text turns — instead an exchange (⇄) glyph sits
        // OUTSIDE the box, to its left, flowing with the card (design-docs/41).
        const gutterIcon = <Box sx={{ width: 0, height: 0 }} />;
        const conversationIcon = (
            <SwapHorizIcon sx={{
                fontSize: textVar.xxl, flexShrink: 0, mt: '6px',
                color: rowHL ? theme.palette.text.secondary : theme.palette.text.disabled,
            }} />
        );
        const card = (
            <Card className={`data-thread-card ${isFocused ? 'selected-card' : ''}`} elevation={0}
                sx={{
                    width: '100%',
                    // Same gray fill as the agent thinking bubbles
                    // (InteractionEntryCard neutral bubbleBg) for consistency;
                    // border matches other cards. Focus → selected-card ring.
                    backgroundColor: alpha(theme.palette.text.primary, 0.03),
                    ...ComponentBorderStyle,
                    borderRadius: '6px', cursor: 'pointer',
                    position: 'relative',
                    '& .textturn-delete-btn': { opacity: 0, transition: 'opacity 0.15s' },
                    '&:hover .textturn-delete-btn': { opacity: 1 },
                }}
                onClick={() => dispatch(dfActions.setFocused({ type: 'text', textId: turn.id }))}
            >
                <Box sx={{ margin: '4px 8px 4px 6px', minWidth: 0 }}>
                    {showPrompt && turn.prompt && (
                        <Typography sx={{
                            fontSize: textVar.xs, color: 'text.secondary', fontStyle: 'italic', mb: '1px',
                            display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
                            overflow: 'hidden', wordBreak: 'break-word',
                        }}>
                            {turn.prompt}
                        </Typography>
                    )}
                    <Typography sx={{
                        fontSize: textVar.xs,
                        // Agent clarify/explain is conversational scaffolding: soften
                        // to text.secondary so it recedes below the data + the user's
                        // decisions, yet stays more legible than the disposable
                        // thinking steps (text.disabled). A still-unanswered clarify
                        // stays prominent (text.primary) — it's a live ask.
                        color: (turn.textKind === 'clarify' && !turn.answered) ? 'text.primary' : 'text.secondary',
                        lineHeight: 1.4, fontWeight: 500,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        overflow: 'hidden', wordBreak: 'break-word',
                    }}>
                        {preview}
                    </Typography>
                </Box>
                {/* Delete floats over the top-right corner so it doesn't take
                    horizontal space from the text; a translucent bg + blur keeps
                    the trash icon readable over the content on hover. */}
                <Tooltip title={t('chartRec.pauseDelete')}>
                    <IconButton className="textturn-delete-btn" size="small" color="error"
                        sx={{
                            position: 'absolute', top: 2, right: 2, p: 0.25,
                            bgcolor: alpha(theme.palette.background.paper, 0.75),
                            backdropFilter: 'blur(2px)',
                            '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.14), transform: 'scale(1.1)' },
                        }}
                        onClick={(e) => { e.stopPropagation(); dispatch(dfActions.removeTextTurn(turn.id)); }}
                    >
                        <DeleteIcon sx={{ fontSize: iconVar.md }} />
                    </IconButton>
                </Tooltip>
            </Card>
        );
        // The follow-up reply renders as its OWN box below the card, using the
        // user-response bubble style (InteractionEntryCard user prompt) so it
        // reads as the user's turn (design-docs/41).
        const answerBox = turn.answered && turn.answer ? (
            <Box sx={{ mt: '4px' }}
                onClick={() => dispatch(dfActions.setFocused({ type: 'text', textId: turn.id }))}
            >
                <InteractionEntryCard
                    entry={{ from: 'user', to: 'data-agent', role: 'prompt', content: turn.answer }}
                    highlighted={false}
                />
            </Box>
        ) : null;
        const element = (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '6px', width: '100%', minWidth: 0 }}>
                {conversationIcon}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    {card}
                    {answerBox}
                </Box>
            </Box>
        );
        return {
            key: `textturn-${turn.id}`, type: 'artifact' as const, highlighted: rowHL,
            gutterIcon, element,
        };
    };

    // Render a single text turn: its triggering prompt bubble (if any) then the
    // turn card. `keyNode` seeds prompt-entry keys.
    const pushSingleTurn = (turn: TextTurn, keyNode: string, highlighted: boolean, triggerType: 'trigger' | 'leaf-trigger') => {
        if (turn.prompt) {
            pushInteractionEntries(
                [{ from: 'user', to: 'data-agent', role: 'prompt', content: turn.prompt, timestamp: turn.createdAt }],
                keyNode, triggerType, highlighted, `textturn-prompt-${turn.id}`,
            );
        }
        timelineItems.push(buildTextTurnTimelineItem(turn, highlighted, false));
    };

    // Render the text-turn subtree rooted at a node (design-docs/42): the node's
    // direct child turns in order, each followed by its own chained follow-ups
    // (recursion). SKIPS lead-up turns — those produced a table and render WITH
    // that result table (see leadUpTurnsOf / pushTableBlock), so here we render
    // only the terminal / still-pending conversation on `nodeId`.
    const pushTextTurnSubtree = (nodeId: string, highlighted: boolean, triggerType: 'trigger' | 'leaf-trigger') => {
        const turns = textTurnChildrenOf.get(nodeId);
        if (!turns) return;
        for (const turn of turns) {
            if (leadUpTurnIds.has(turn.id)) continue; // renders with its result table
            pushSingleTurn(turn, nodeId, highlighted, triggerType);
            // Chained follow-ups hang off this turn.
            pushTextTurnSubtree(turn.id, highlighted, triggerType);
        }
    };

    // Table-level entry point: render the turn subtree rooted at a table. Only
    // ever called at the table's real card (design-docs/42), so a table shown
    // as a used-parent chip elsewhere renders no conversation there.
    const pushTableTextTurns = (tableId: string, highlighted: boolean, triggerType: 'trigger' | 'leaf-trigger') => {
        pushTextTurnSubtree(tableId, highlighted, triggerType);
    };

    // Render one table's full block in the thread body: its trigger interaction
    // (split so the run's closing summary follows the outputs), the table card +
    // charts, reports, the after-run summary, then any new conversation and the
    // live agent draft. Shared by the new-table and leaf-table passes — they were
    // identical apart from the trigger source and the card/type labels. (The old
    // `afterTableMap`/`leafAfterTableMap` Maps were set and read in the same
    // iteration, so they collapse to a local here.)
    const pushTableBlock = (
        tableId: string,
        trigger: Trigger | undefined,
        tableCard: any,
        triggerCardFallback: any,
        tableType: 'table' | 'leaf-table',
        triggerType: 'trigger' | 'leaf-trigger',
        highlighted: boolean,
        keyPrefix: string,
    ) => {
        // Lead-up conversation that PRODUCED this table (design-docs/42): the
        // clarify/answer turns on its threadParentId chain, rendered BEFORE the
        // trigger + card so the conversation and its result read as one thread.
        for (const turn of leadUpTurnsOf(tableId)) {
            pushSingleTurn(turn, tableId, highlighted, triggerType);
        }
        let afterEntries: InteractionEntry[] = [];
        if (trigger) {
            const interaction = trigger.interaction;
            if (interaction && interaction.length > 0) {
                const [before, after] = splitAtLastInstruction(interaction);
                pushInteractionEntries(before, tableId, triggerType, highlighted, keyPrefix);
                afterEntries = after;
            } else if (triggerCardFallback) {
                // No interaction log — render the trigger card directly.
                timelineItems.push({
                    key: triggerCardFallback?.key || `${triggerType}-${tableId}`,
                    type: triggerType,
                    highlighted,
                    element: triggerCardFallback,
                });
            }
        }
        // Table card + charts, then reports (output cards, before the summary).
        pushTableAndChartItems(tableId, tableCard, tableType, highlighted);
        pushReportItems(tableId, highlighted, triggerType);
        // The run's closing summary follows the LAST artifact, before any new turn.
        if (afterEntries.length > 0) {
            pushInteractionEntries(afterEntries, tableId, triggerType, highlighted, `${keyPrefix}-after`);
        }
        // A new question/explanation on the table follows the summary.
        pushTableTextTurns(tableId, highlighted, triggerType);
        // Running / clarifying agent state.
        pushAgentDraftItems(tableId, triggerType, highlighted);
    };

    // The thread's origin: a source table lives in the shelf, never in a
    // thread, so we echo it here as a compact chip that says "this thread
    // starts from X". The FIRST thread growing out of a source also hosts that
    // source's terminal artifacts (charts, reports, conversation, live run).
    if (originTableId) {
        const isHL = highlightedTableIds.includes(originTableId);
        timelineItems.push({
            key: `origin-ref-${originTableId}`,
            type: 'table',
            tableId: originTableId,
            highlighted: isHL,
            element: _buildRefChip(originTableId),
        });
        if (ownsOriginArtifacts) {
            buildChartCards(
                chartElements.filter(ce => ce.tableId === originTableId),
                focusedChartId, collapsed,
            ).forEach((el, i) => timelineItems.push({
                key: `origin-chart-${originTableId}-${i}`,
                type: 'chart',
                highlighted: isHL,
                element: el,
            }));
            pushReportItems(originTableId, isHL, 'trigger');
            pushTableTextTurns(originTableId, isHL, 'trigger');
            pushAgentDraftItems(originTableId, 'trigger', isHL);
        }
    }

    // Add used (shared) tables at the top
    // Show the immediate parent as a reference chip, with "..." for further ancestors.
    // On a continuation segment (isSplitThread), suppress the "..." — the
    // continuation header already signals carry-over and the chip
    // names the parent explicitly.
    let displayedUsedTableIds = usedTableIdsInThread;
    if (usedTableIdsInThread.length > 1) {
        displayedUsedTableIds = usedTableIdsInThread.slice(-1);
        if (!isSplitThread) {
            timelineItems.push({
                key: 'used-table-ellipsis',
                type: 'used-table',
                highlighted: false,
                element: (
                    <Typography sx={{ fontSize: textVar.xxs, color: 'text.disabled' }}>
                        …
                    </Typography>
                ),
            });
        }
    }
    displayedUsedTableIds.forEach((tableId) => {
        const isHighlighted = highlightedTableIds.includes(tableId);
        // A used parent is a pure POINTER (design-docs/42): the table is shown
        // fully — with ALL its attached content (conversation turns, live run
        // state) — at its ONE real card (the shelf for a source table, else the
        // thread that owns it as a fresh table). Here we render only the chip —
        // no charts, no turns, no draft. This is what stops a fork from
        // repeating the parent's cards / messages / state per column.
        timelineItems.push({
            key: `used-table-ref-${tableId}`,
            type: 'table',
            tableId,
            highlighted: isHighlighted,
            element: _buildRefChip(tableId),
        });
    });

    // Interleave triggers and tables for the main thread body
    newTableIds.forEach((tableId, i) => {
        const triggerPair = newTriggerPairs.find(tp => tp.resultTableId === tableId);
        pushTableBlock(
            tableId,
            triggerPair,
            tableElementList[i],
            triggerPair ? triggerCards[newTriggerPairs.indexOf(triggerPair)] : undefined,
            'table',
            'trigger',
            highlightedTableIds.includes(tableId),
            'interaction',
        );
    });

    // The thread's own terminal table
    if (leafTable) {
        const lt = leafTable;
        const leafTrigger = lt.derive?.trigger;
        const isHL = highlightedTableIds.includes(lt.id);
        pushTableBlock(
            lt.id,
            leafTrigger,
            _buildTableCard(lt.id),
            leafTrigger ? _buildTriggerCard(leafTrigger, isHL) : undefined,
            'leaf-table',
            'leaf-trigger',
            isHL,
            'leaf-interaction',
        );
    }

    // Timeline rendering helper
    const TIMELINE_WIDTH = 14;
    const TIMELINE_GAP = '4px'; // gap between timeline and card content
    const DOT_SIZE = 6;
    const CARD_PY = '6px'; // vertical padding for each timeline row
    // Mirror the left timeline gutter on the right so cards sit visually
    // centred in their column instead of hugging the right edge.
    const CARD_CONTENT_PR = `${TIMELINE_WIDTH}px`;

    // CSS `border-style: dashed` stretches dashes to fit each element's
    // height, so stacked segments end up with mismatched dash lengths.  A
    // fixed-size background pattern keeps every dash the same regardless of
    // the segment's height — the line reads as one continuous stroke even
    // when split across multiple boxes.
    const DASH_COLOR = 'rgba(0,0,0,0.22)';
    const dashedLineSx = {
        width: '2px',
        backgroundImage: `linear-gradient(to bottom, ${DASH_COLOR} 50%, transparent 50%)`,
        backgroundSize: '2px 6px',
        backgroundRepeat: 'repeat-y',
        backgroundPosition: 'top center',
    } as const;

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
            if (tableForDot?.virtual) {
                return <TableIcon sx={{ ...iconSx, width: 14, height: 14 }} />;
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

    const hasHighlighting = highlightedTableIds.length > 0;
    // Whether the thread header is highlighted (any non-used-table item in this thread is highlighted)
    const headerHL = timelineItems.some(item => item.highlighted && item.type !== 'used-table');

    const renderTimelineItem = (item: typeof timelineItems[0], index: number, isLast: boolean, nextHighlighted: boolean) => {
        const isTrigger = item.type === 'trigger' || item.type === 'leaf-trigger';
        const isTable = item.type === 'table' || item.type === 'leaf-table' || item.type === 'used-table';
        const isChart = item.type === 'chart';
        const isMerge = item.type === 'merge';
        const dashedColor = item.highlighted ? alpha(theme.palette.primary.main, 0.6) : 'rgba(0,0,0,0.1)';
        const dashedWidth = '2px';
        const dashedStyle = 'solid';
        // Bottom connector uses unhighlighted style if next item isn't highlighted
        const bottomHighlighted = item.highlighted && nextHighlighted;
        const bottomDashedColor = bottomHighlighted ? alpha(theme.palette.primary.main, 0.6) : 'rgba(0,0,0,0.1)';
        const bottomDashedWidth = '2px';
        const bottomDashedStyle = 'solid';
        // No dimming or background — rely on timeline color + card border for highlighting
        const rowHighlightSx = {};

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
                        <Box sx={{ flexShrink: 0, zIndex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white' }}>
                            <CallMergeIcon sx={{ fontSize: iconVar.xs, color: item.highlighted ? theme.palette.primary.main : 'rgba(0,0,0,0.15)', transform: 'rotate(180deg)' }} />
                        </Box>
                        {!isLast && <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `${bottomDashedWidth} ${bottomDashedStyle} ${bottomDashedColor}` }} />}
                        {isLast && hasContinuationBelow && <Box sx={{ flex: '1 1 0', minHeight: 2, ...dashedLineSx }} />}
                        {isLast && !hasContinuationBelow && <Box sx={{ flex: '1 1 0', minHeight: 2 }} />}
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
            // User → custom (orange), Agent → secondary when highlighted, muted when not
            const iconColor = item.highlighted
                ? (isFromUser ? theme.palette.custom.main : theme.palette.text.secondary)
                : 'rgba(0,0,0,0.15)';
            // Pick step-specific icon for completed thinking steps
            const getStepIcon = (label: string, color: string) => {
                const iconSx = { width: 12, height: 12, color };
                if (label.startsWith('✗')) return <ErrorOutlineIcon sx={{ ...iconSx, color: theme.palette.error.main }} />;
                if (label.startsWith('⚠')) return <WarningAmberIcon sx={{ ...iconSx, color: theme.palette.warning.main }} />;
                if (label.startsWith('📋')) return <InfoOutlinedIcon sx={{ ...iconSx, color: theme.palette.info.main }} />;
                const stripped = label.startsWith('✓') ? label.slice(2) : label;
                const lbl = stripped.toLowerCase();
                if (lbl.startsWith('running code') || lbl.startsWith('运行')) return <TerminalIcon sx={iconSx} />;
                if (lbl.startsWith('inspecting') || lbl.startsWith('检查')) return <SearchIcon sx={iconSx} />;
                if (lbl.startsWith('searching') || lbl.startsWith('搜索')) return <SearchIcon sx={iconSx} />;
                if (lbl.startsWith('creating chart') || lbl.startsWith('图表') || lbl.startsWith('生成图表')) return <AutoGraphIcon sx={iconSx} />;
                return <AutoAwesomeIcon sx={iconSx} />;
            };
            const gutterIcon = item.isRunning
                ? <CircularProgress size={12} thickness={5} sx={{ color: theme.palette.primary.main }} />
                : item.isClarifying
                    ? getClarifyIcon(item)
                    : item.isCompleted && item.stepLabel
                        ? getStepIcon(item.stepLabel, iconColor)
                        : item.gutterIcon
                            ? item.gutterIcon
                            : entry
                                ? getEntryGutterIcon(entry, iconColor)
                                : getDefaultGutterIcon(iconColor);

            // Clarification rows are clickable to bring the agent's pause
            // back into focus. Prefer the latest chart on the associated
            // table (so users keep seeing the chart they were working on);
            // fall back to focusing the table itself if no chart exists.
            // Also re-opens the pause panel if it was "closed" (dismissed) —
            // the thread block is the handle back into the conversation.
            const clarifyClickHandler = (item.isClarifying && item.tableId)
                ? () => {
                    const tableId = item.tableId!;
                    const clarifyDraft = draftNodes.find(d => d.derive?.status === 'clarifying' && d.derive.trigger.tableId === tableId);
                    if (clarifyDraft) {
                        window.dispatchEvent(new CustomEvent('df-reopen-pause', { detail: { draftId: clarifyDraft.id } }));
                    }
                    const chartsForTable = charts.filter(c => c.tableRef === tableId);
                    const lastChart = chartsForTable[chartsForTable.length - 1];
                    if (lastChart) {
                        dispatch(dfActions.setFocused({ type: 'chart', chartId: lastChart.id }));
                    } else {
                        dispatch(dfActions.setFocused({ type: 'table', tableId }));
                    }
                }
                : undefined;

            return (
                <Box key={`timeline-row-${item.key}`}
                    {...(item.isClarifying ? { 'data-clarifying': 'true' } : {})}
                    sx={{ display: 'flex', flexDirection: 'row', position: 'relative', ...rowHighlightSx,
                    ...(clarifyClickHandler ? { cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(0,0,0,0.02)' } } : {}),
                }} onClick={clarifyClickHandler}>
                    <Box sx={{ 
                        width: TIMELINE_WIDTH, flexShrink: 0, 
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                        <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />
                        <Box sx={{ flexShrink: 0, zIndex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {gutterIcon}
                        </Box>
                        {!isLast && <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `${bottomDashedWidth} ${bottomDashedStyle} ${bottomDashedColor}` }} />}
                        {isLast && hasContinuationBelow && <Box sx={{ flex: '1 1 0', minHeight: 2, ...dashedLineSx }} />}
                        {isLast && !hasContinuationBelow && <Box sx={{ flex: '1 1 0', minHeight: 2 }} />}
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
                <Box key={`timeline-row-${item.key}`} sx={{ display: 'flex', flexDirection: 'row', position: 'relative', ...rowHighlightSx }}>
                    <Box sx={{
                        width: TIMELINE_WIDTH, flexShrink: 0,
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                        <Box sx={{ width: 0, flex: '1 1 0', borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />
                        <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {getTimelineDot(item)}
                        </Box>
                        {!isLast && <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `${bottomDashedWidth} ${bottomDashedStyle} ${bottomDashedColor}` }} />}
                        {isLast && hasContinuationBelow && <Box sx={{ flex: '1 1 0', minHeight: 2, ...dashedLineSx }} />}
                        {isLast && !hasContinuationBelow && <Box sx={{ flex: '1 1 0', minHeight: 2 }} />}
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
            <Box key={`timeline-row-${item.key}`} sx={{ display: 'flex', flexDirection: 'row', position: 'relative', ...rowHighlightSx }}>
                <Box sx={{ 
                    width: TIMELINE_WIDTH, flexShrink: 0, 
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    position: 'relative',
                }}>
                    {(index > 0 || !isSplitThread) && (() => {
                        // When connecting to the header (index 0, label visible), match the header's highlight state
                        const useHeader = index === 0 && !isSplitThread;
                        const topColor = useHeader ? (headerHL ? alpha(theme.palette.primary.main, 0.6) : 'rgba(0,0,0,0.1)') : dashedColor;
                        const topWidth = '2px';
                        const topStyle = 'solid';
                        return <Box sx={{ width: 0, flex: '1 1 0', minHeight: 6, borderLeft: `${topWidth} ${topStyle} ${topColor}` }} />;
                    })()}
                    {index === 0 && isSplitThread && (
                        // Continuation segment: extend the dashed gutter from the
                        // "↑ continued" header above down through the chip row
                        // so the timeline reads as a single unbroken path.
                        <Box sx={{ flex: '1 1 0', minHeight: 6, ...dashedLineSx }} />
                    )}
                    <Box sx={{ flexShrink: 0, zIndex: 1, backgroundColor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {getTimelineDot(item)}
                    </Box>
                    {!isLast && (
                        <Box sx={{ width: 0, flex: '1 1 0', minHeight: 6, borderLeft: `${bottomDashedWidth} ${bottomDashedStyle} ${bottomDashedColor}` }} />
                    )}
                    {isLast && hasContinuationBelow && (
                        // Continuation segment tail: extend the dashed gutter
                        // down into the "↓ continues below" footer so the
                        // timeline reads as a single unbroken path.
                        <Box sx={{ flex: '1 1 0', minHeight: 6, ...dashedLineSx }} />
                    )}
                    {isLast && !hasContinuationBelow && <Box sx={{ flex: '1 1 0', minHeight: 6 }} />}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, py: item.type === 'used-table' ? '1px' : CARD_PY, pl: TIMELINE_GAP, pr: CARD_CONTENT_PR,
                    ...(item.type === 'used-table' && { display: 'flex', alignItems: 'center' }),
                }}>
                    {item.element}
                </Box>
            </Box>
        );
    };


    return <Box sx={{ ...sx, 
            '& .selected-card': { 
                boxShadow: `0 0 0 2px ${theme.palette.primary.light}`,
                borderColor: 'transparent',
                margin: '1px 0',
            },
            // A reference to the focused table: acknowledge the click without
            // competing with the ring on the card that owns the table.
            '& .selected-ref-card': {
                borderColor: theme.palette.primary.light,
            },
            '& .selected-report-card': { 
                boxShadow: `0 0 0 2px ${theme.palette.secondary.light}`,
                borderColor: 'transparent',
                margin: '1px 0',
            },
            padding: '6px',
        }}
        >
        <div style={{ padding: '2px 4px 2px 4px', marginTop: 0, direction: 'ltr' }}>
            {!isSplitThread && (() => {
                const hlColor = theme.palette.primary.main;
                const nhColor = 'rgba(0,0,0,0.35)';
                const connColor = headerHL ? alpha(theme.palette.primary.main, 0.6) : 'rgba(0,0,0,0.1)';
                const connWidth = '2px';
                const connStyle = 'solid';
                return (
                <Box sx={{ display: 'flex', flexDirection: 'row' }}>
                    <Box sx={{ 
                        width: TIMELINE_WIDTH, flexShrink: 0, 
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                        <Box sx={{ flex: '1 1 0', minHeight: 6 }} />
                        <Box sx={{ 
                            width: 8, height: 8, borderRadius: '50%', 
                            border: `1.5px solid ${headerHL ? alpha(hlColor, 0.6) : 'rgba(0,0,0,0.15)'}`,
                            backgroundColor: 'transparent',
                            flexShrink: 0,
                        }} />
                        <Box sx={{ width: 0, flex: '1 1 0', minHeight: 10, borderLeft: `${connWidth} ${connStyle} ${connColor}` }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', pl: 0.5, gap: 0.5 }}>
                        <Typography sx={{ 
                            fontSize: textVar.xs, fontWeight: 700, 
                            textTransform: 'uppercase', letterSpacing: '0.02em',
                            color: headerHL ? hlColor : 'rgba(0,0,0,0.55)', 
                        }}>
                            {threadLabel}
                        </Typography>
                    </Box>
                </Box>
                );
            })()}
            {isSplitThread && (() => {
                // Continuation header: a small "↑ continued" chip on a dashed
                // gutter.  The parent chip immediately below identifies the
                // carry-over table, and the segment's first real content is
                // the next instruction — so we don't echo the previous
                // instruction here (it would duplicate either the chip's name
                // or the upcoming instruction card).
                return (
                    <Box sx={{ display: 'flex', flexDirection: 'row' }}>
                        <Box sx={{
                            width: TIMELINE_WIDTH, flexShrink: 0,
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                        }}>
                            <Box sx={{ flex: '1 1 0', minHeight: 4 }} />
                            <KeyboardArrowUpIcon sx={{ fontSize: iconVar.xs, color: 'text.disabled' }} />
                            <Box sx={{ flex: '1 1 0', minHeight: 6, ...dashedLineSx }} />
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0, pl: 0.5, py: 0.25, display: 'flex', alignItems: 'center' }}>
                            <Typography sx={{
                                fontSize: textVar.xxs, color: 'text.disabled',
                                textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}>
                                {t('dataThread.continuedFromAbove')}
                            </Typography>
                        </Box>
                    </Box>
                );
            })()}
            {timelineItems.map((item, index) => renderTimelineItem(item, index, index === timelineItems.length - 1, timelineItems[index + 1]?.highlighted ?? false))}
            {hasContinuationBelow && (() => {
                return (
                    <Box sx={{ display: 'flex', flexDirection: 'row' }}>
                        <Box sx={{
                            width: TIMELINE_WIDTH, flexShrink: 0,
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                        }}>
                            <Box sx={{ flex: '1 1 0', minHeight: 6, ...dashedLineSx }} />
                            <KeyboardArrowDownIcon sx={{ fontSize: iconVar.xs, color: 'text.disabled' }} />
                            <Box sx={{ flex: '1 1 0', minHeight: 4 }} />
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0, pl: 0.5, py: 0.25, display: 'flex', alignItems: 'center' }}>
                            <Typography sx={{
                                fontSize: textVar.xxs, color: 'text.disabled',
                                textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}>
                                {t('dataThread.continuesBelow')}
                            </Typography>
                        </Box>
                    </Box>
                );
            })()}
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
                            backgroundColor: "white",
                            justifyContent: 'center',
                            alignItems: 'center',
                            minHeight: 48,
                            minWidth: 60,
                        }}
                    >
                        <img 
                            src={thumbnail} 
                            alt={t('dataThread.chartAlt', { type: chart.chartType })}
                            style={{ maxWidth: 120, maxHeight: 100, objectFit: 'contain' }} 
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

/** Effective rendered row count for an interaction list: data-agent
 *  `summary` entries that are immediately followed by an `instruction` get
 *  folded into that instruction (see `pushInteractionEntries`), so they
 *  shouldn't be double-counted in height estimation. */
function effectiveEntryCount(interaction: InteractionEntry[] | undefined): number {
    if (!interaction || interaction.length === 0) return 1;
    let n = 0;
    for (let i = 0; i < interaction.length; i++) {
        const e = interaction[i];
        const next = interaction[i + 1];
        if (e.role === 'summary' && e.from === 'data-agent' && next?.role === 'instruction') continue;
        n++;
    }
    return Math.max(1, n);
}

/**
 * For each long thread, identify intermediate tables to "promote" as extra
 * leaves so the thread renders as multiple stacked segments.
 *
 * Item-count strategy (no pixel estimates):
 *
 *   1. Count "items" per thread: each trigger contributes 1 + #effective
 *      interaction entries + #charts on its result table.  This is a much
 *      more stable proxy for visual content than height estimates, which
 *      vary wildly with text wrapping and chart sizes.
 *
 *   2. Sum across threads → totalItems.  Per-column budget = totalItems / N.
 *
 *   3. For each thread: K = max(1, round(threadItems / budget)) segments.
 *      Round (not ceil) → "prefer not to break" — threads only marginally
 *      larger than budget stay whole.
 *
 *   4. Split into K segments by accumulating items as evenly as possible
 *      across triggers, honouring the ≥2-triggers-per-segment constraint.
 *
 * Each cut at trigger index `j` (j ≥ 2, segment starts at trigger j-1)
 * promotes `triggers[j-2].resultTableId` as a leaf, so the previous segment
 * ends on that table and the new segment opens on `triggers[j-1]`'s
 * instruction with the promoted table shown as a reference chip.
 */
function computeSplitExtraLeaves(
    leafTables: DictTable[],
    allTables: DictTable[],
    chartElements: { tableId: string }[],
    fittableColumns: number,
    textTurnItemsByTable: Map<string, number>,
): DictTable[] {
    if (fittableColumns <= 1) return [];
    const tableById = new Map(allTables.map(t => [t.id, t]));

    // Per-trigger item count = 1 (table) + interaction entries + charts +
    // text-turn cards (clarify/explain) anchored to the result table.
    const itemsForTrigger = (resultTableId: string, interaction: InteractionEntry[] | undefined): number => {
        const charts = chartElements.filter(ce => ce.tableId === resultTableId).length;
        const textTurns = textTurnItemsByTable.get(resultTableId) || 0;
        return 1 + effectiveEntryCount(interaction) + charts + textTurns;
    };

    // Compute per-thread totals up front so we can pick the budget.
    const triggersByLeaf: Trigger[][] = [];
    const threadItems: number[] = [];
    for (const lt of leafTables) {
        const triggers = getTriggers(lt, allTables);
        triggersByLeaf.push(triggers);
        let items = 0;
        for (const tp of triggers) items += itemsForTrigger(tp.resultTableId, tp.interaction);
        // Leaf trigger contributes its own row count + leaf table + leaf charts.
        items += itemsForTrigger(lt.id, lt.derive?.trigger?.interaction);
        threadItems.push(items);
    }
    const totalItems = threadItems.reduce((s, v) => s + v, 0);
    if (totalItems === 0) return [];

    const budget = totalItems / fittableColumns;

    const extras: DictTable[] = [];
    for (let li = 0; li < leafTables.length; li++) {
        const lt = leafTables[li];
        if (!lt.derive) continue;
        const triggers = triggersByLeaf[li];
        if (triggers.length < 3) continue;

        const K = Math.max(1, Math.round(threadItems[li] / budget));
        if (K <= 1) continue;

        // Per-trigger items, with the leaf weight folded into the LAST entry
        // (the leaf step renders inside the trailing segment but isn't part
        // of the `triggers` array).
        const triggerItems = triggers.map(tp => itemsForTrigger(tp.resultTableId, tp.interaction));
        triggerItems[triggerItems.length - 1] += itemsForTrigger(lt.id, lt.derive.trigger?.interaction);

        // Stability strategy: prefer greedy cuts (which only shift when
        // earlier content changes) over balanced ones (which redistribute
        // on every new trigger).  Only re-balance when the trailing segment
        // grows past 1.5× the previous segment — i.e. greedy has produced
        // a noticeably lopsided layout that warrants a reshuffle.
        let cuts = greedyPartitionCuts(triggerItems, K, budget);
        if (cuts.length === 0) {
            // Greedy couldn't find K segments at this budget — fall back to
            // balanced (which uses binary search and always finds a valid
            // partition when one exists).
            cuts = balancedPartitionCuts(triggerItems, K);
        } else {
            const segItems = segmentSums(triggerItems, cuts);
            const tail = segItems[segItems.length - 1];
            const prior = segItems[segItems.length - 2];
            if (tail > 1.5 * prior) {
                const rebalanced = balancedPartitionCuts(triggerItems, K);
                if (rebalanced.length > 0) cuts = rebalanced;
            }
        }
        if (cuts.length === 0) continue;

        for (const j of cuts) {
            if (j < 2) continue;
            const promoted = tableById.get(triggers[j - 2].resultTableId);
            if (promoted) extras.push(promoted);
        }
    }
    return extras;
}

/**
 * Greedy K-segment partition: walk left-to-right, cut whenever the running
 * sum would exceed `budget`.  Stable under incremental growth — existing
 * cuts only move if content before them changes.  Each segment must contain
 * ≥ 2 triggers.  Returns [] if fewer than K segments could be produced.
 */
function greedyPartitionCuts(
    triggerItems: number[],
    K: number,
    budget: number,
): number[] {
    const N = triggerItems.length;
    if (K <= 1 || N < 2 * K) return [];
    const cuts: number[] = [];
    let acc = 0;
    let segStart = 0;
    for (let i = 0; i < N; i++) {
        const inSeg = i - segStart;
        const remainingSegs = (K - 1) - cuts.length;
        const remainingTriggers = N - i;
        const mustCut = remainingSegs > 0 && remainingTriggers <= 2 * remainingSegs && inSeg >= 2;
        const wantCut = inSeg >= 2 && acc + triggerItems[i] > budget && cuts.length < K - 1;
        if (mustCut || wantCut) {
            cuts.push(i + 1);
            segStart = i;
            acc = triggerItems[i];
        } else {
            acc += triggerItems[i];
        }
    }
    return cuts.length === K - 1 ? cuts : [];
}

/** Sum items per segment given cut indices (cut at i ⇒ segment starts at i-1). */
function segmentSums(triggerItems: number[], cuts: number[]): number[] {
    const breakpoints = [0, ...cuts.map(c => c - 1), triggerItems.length];
    const sums: number[] = [];
    for (let s = 0; s < breakpoints.length - 1; s++) {
        let h = 0;
        for (let k = breakpoints[s]; k < breakpoints[s + 1]; k++) h += triggerItems[k];
        sums.push(h);
    }
    return sums;
}

/**
 * Partition `triggerH` into K contiguous segments minimising the maximum
 * segment height, with each segment containing ≥ 2 triggers.  Returns K-1
 * cut indices using the same convention as greedy cuts (cut at i ⇒ new
 * segment starts at trigger i-1).  Returns [] if no valid partition exists
 * (e.g. fewer than 2K triggers).
 */
function balancedPartitionCuts(triggerH: number[], K: number): number[] {
    const N = triggerH.length;
    if (K <= 1 || N < 2 * K) return [];

    const maxH = Math.max(...triggerH);
    const totalH = triggerH.reduce((s, h) => s + h, 0);

    // Greedy partition with a maximum-segment-height target, honouring the
    // ≥2-triggers-per-segment constraint.  Returns cut indices if K segments
    // can fit within `limit`, else null.  All K segments — including the
    // trailing one — must fit; otherwise the binary search would converge
    // to an absurdly low limit and produce wildly unbalanced cuts.
    const tryPartition = (limit: number): number[] | null => {
        const cuts: number[] = [];
        let acc = 0;
        let segStart = 0;
        let segCount = 1;
        for (let i = 0; i < N; i++) {
            const inSeg = i - segStart;
            const remainingTriggers = N - i;
            const remainingSegs = K - segCount;
            // Force a cut if we'd otherwise run out of room for remaining segments.
            const mustCut = remainingSegs > 0 && remainingTriggers <= 2 * remainingSegs && inSeg >= 2;
            const wantCut = inSeg >= 2 && acc + triggerH[i] > limit && segCount < K;
            if (mustCut || wantCut) {
                // Cut here: new segment starts at trigger i.  Encode as i+1 so
                // the promotion picks triggers[(i+1)-2] = triggers[i-1].
                cuts.push(i + 1);
                segCount++;
                segStart = i;
                acc = triggerH[i];
                // The single trigger that opens this segment must itself fit.
                if (acc > limit) return null;
            } else {
                acc += triggerH[i];
                // No cut available (we're in the last segment, or the
                // ≥2-trigger guard blocks).  If we exceed limit, infeasible.
                if (acc > limit) return null;
            }
        }
        // Final segment must contain ≥ 2 triggers.
        if (segCount !== K) return null;
        if (N - segStart < 2) return null;
        return cuts;
    };

    let lo = maxH;
    let hi = totalH;
    let best: number[] | null = null;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const r = tryPartition(mid);
        if (r !== null) { best = r; hi = mid; } else { lo = mid + 1; }
    }
    return best ?? [];
}

/**
 * Distribute threads (in display order) over `numColumns` columns, balancing
 * estimated height.  This is what places the segments of a split thread into
 * successive columns, so a long thread wraps instead of scrolling forever.
 *
 * @param heights  – Estimated pixel height for each thread (in display order).
 * @param numColumns – Number of columns to distribute into.
 * @returns An array of columns, where each column is an array of original
 *          thread indices.  Empty columns are omitted.
 */
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

export const DataThread: FC<{sx?: SxProps}> = function ({ sx }) {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    let tables = useSelector((state: DataFormulatorState) => state.tables);
    let focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    let charts = useSelector(dfSelectors.getAllCharts);

    let generatedReports = useSelector(dfSelectors.getAllGeneratedReports);

    // Text turns (clarify/explain) — needed at this level to assign each a
    // single "home" thread entry (see the home-assignment block below).
    let textTurnsForHome = useSelector((state: DataFormulatorState) => state.textTurns);
    // Root TABLE of each turn's conversation (design-docs/42): walk parentNodeId
    // until a table (chained follow-ups resolve to their chain's root table).
    const textTurnRootByTurn = useMemo(() => {
        const tableIds = new Set(tables.map(t => t.id));
        const turnById = new Map(textTurnsForHome.map(tt => [tt.id, tt]));
        const rootOf = (tt: TextTurn): string | undefined => {
            let cur: TextTurn | undefined = tt;
            const seen = new Set<string>();
            while (cur && !seen.has(cur.id)) {
                seen.add(cur.id);
                const p = cur.parentNodeId;
                if (!p) return undefined;
                if (tableIds.has(p)) return p;
                cur = turnById.get(p);
            }
            return undefined;
        };
        const map = new Map<string, string>();
        for (const tt of textTurnsForHome) {
            const r = rootOf(tt);
            if (r) map.set(tt.id, r);
        }
        return map;
    }, [textTurnsForHome, tables]);
    // Tables that root a text-turn conversation: branch-split exclusion + home.
    const textTurnRootTableIds = useMemo(
        () => new Set([...textTurnRootByTurn.values()]),
        [textTurnRootByTurn],
    );
    // Rendered timeline-item count each table's conversation adds (card +
    // optional prompt bubble), keyed by the root table — feeds thread height +
    // split budgeting so text-turn cards count as taking vertical space.
    const textTurnItemsByTable = useMemo(() => {
        const map = new Map<string, number>();
        for (const tt of textTurnsForHome) {
            const key = textTurnRootByTurn.get(tt.id);
            if (!key) continue;
            const items = 1 + (tt.prompt ? 1 : 0);
            map.set(key, (map.get(key) || 0) + items);
        }
        return map;
    }, [textTurnsForHome, textTurnRootByTurn]);

    // Derive focusedTableId from focusedId for scroll/highlight logic
    let focusedTableId = useMemo(() => {
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
        if (focusedId.type === 'text') {
            // A focused text turn (clarify/explain) highlights its thread-parent
            // table (or the table of its source chart) and that table's thread,
            // just like focusing a chart (design-docs/41/42).
            const turn = textTurnsForHome.find(tt => tt.id === focusedId.textId);
            if (!turn) return undefined;
            if (turn.sourceChartId) {
                const chart = charts.find(c => c.id === turn.sourceChartId);
                if (chart?.tableRef) return chart.tableRef;
            }
            return textTurnRootByTurn.get(turn.id);
        }
        return undefined;
    }, [focusedId, charts, generatedReports, textTurnsForHome, textTurnRootByTurn]);

    let chartSynthesisInProgress = useSelector((state: DataFormulatorState) => state.chartSynthesisInProgress);

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    // Subscribe to draftNodes so the scroll-to-target effect re-runs when an
    // active clarify/explain entry appears or resolves.
    const draftNodes = useSelector((state: DataFormulatorState) => state.draftNodes);

    const containerRef = useRef<null | HTMLDivElement>(null)
    const threadScrollRef = useRef<null | HTMLDivElement>(null)
    // Outer wrapper containing both the thread area and the chatbox.
    const outerRef = useRef<null | HTMLDivElement>(null)
    // Column geometry follows density: bigger text needs a wider card, or table
    // names truncate. DataFormulator snaps the pane from the same tokens.
    const { tokens: threadTokens } = useLayout();
    const [expandedColumns, setExpandedColumns] = useState(false);
    const [containerWidth, setContainerWidth] = useState(0);
    // Track container height so we can detect when the chatbox grows/shrinks
    // (which compresses/expands containerRef as a flex sibling).  Used to
    // trigger the scroll-to-target effect below.
    const [containerHeight, setContainerHeight] = useState(0);
    // Increments every time the chat input is focused.  Used to retrigger the
    // scroll-to-target effect even when neither focusedId nor containerHeight
    // changes (e.g. user just clicks into the input without typing).
    const [chatboxFocusTick, setChatboxFocusTick] = useState(0);
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

            const tableObj: DictTable = {
                kind: 'table' as const,
                id: item.tableName,
                displayId: item.tableName,
                names: [],
                metadata: {},
                rows: [],
                virtual: { tableId: item.tableName, rowCount: 0 },
                anchored: true,
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
    }, [dispatch]);
    // Re-attach ResizeObserver when containerRef changes
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
                setContainerHeight(entry.contentRect.height);
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const theme = useTheme();

    // Keep the relevant element fully visible above the chatbox.
    //
    // Triggered whenever:
    //   - focusedId changes (user clicked a different chart/table)
    //   - containerHeight changes (chatbox grew/shrank, e.g. when an
    //     explain/clarify panel appears or the input expands)
    //
    // Three target priorities:
    //   1. Active clarify/explain inline block (data-clarifying="true")
    //   2. Focused chart card (data-chart-id)
    //   3. Focused table card (data-table-id)
    //
    // "Fully visible" means the target's top..bottom fits within
    // containerRef's rect (which already shrinks as the chatbox grows below
    // it).  If already in view, don't scroll.  If too tall, align top.
    useEffect(() => {
        if (!containerRef.current) return;
        const t = setTimeout(() => {
            const container = containerRef.current;
            if (!container) return;
            const scroller = container.firstElementChild as HTMLElement | null;
            if (!scroller) return;

            // Find the target element in priority order.
            let target: HTMLElement | null = null;

            // 1. Active clarify/explain inline block (most recent)
            const clarifyEls = container.querySelectorAll<HTMLElement>('[data-clarifying="true"]');
            if (clarifyEls.length > 0) {
                target = clarifyEls[clarifyEls.length - 1];
            }

            // 2. Focused chart
            if (!target && focusedId?.type === 'chart') {
                target = container.querySelector<HTMLElement>(`[data-chart-id="${focusedId.chartId}"]`);
            }

            // 3. Focused table
            if (!target && focusedId?.type === 'table') {
                target = container.querySelector<HTMLElement>(`[data-table-id="${focusedId.tableId}"]`);
            }

            if (!target) return;

            const containerRect = container.getBoundingClientRect();
            const scrollerRect = scroller.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const TOP_MARGIN = 16;
            const BOTTOM_MARGIN = 16;
            const visibleTop = containerRect.top + TOP_MARGIN;
            const visibleBottom = containerRect.bottom - BOTTOM_MARGIN;
            const visibleHeight = visibleBottom - visibleTop;

            // Already fully visible? Don't scroll — don't bother the user.
            if (targetRect.top >= visibleTop && targetRect.bottom <= visibleBottom) return;

            // When we do need to scroll, leave generous breathing room above
            // the target so the user has context (the prior thread items
            // remain visible).  We aim to place the target's top about 60%
            // of the way down the visible area — this feels natural since
            // the user is usually interacting at the bottom and the target
            // is most often a leaf chart/table near the end.  Clamped so
            // the target's bottom never gets pushed below the visible area.
            //
            // If the target is taller than the visible area, just align its
            // top with TOP_MARGIN so the start is in view (bottom may be
            // cut off — preferable to hiding the start).
            const targetTopInScroller = targetRect.top - scrollerRect.top + scroller.scrollTop;
            const targetHeight = targetRect.height;
            const tooTall = targetHeight + TOP_MARGIN + BOTTOM_MARGIN > visibleHeight + TOP_MARGIN + BOTTOM_MARGIN;
            const desiredOffsetFromTop = tooTall
                ? TOP_MARGIN
                : Math.max(TOP_MARGIN, Math.min(visibleHeight * 0.6, visibleHeight - targetHeight - BOTTOM_MARGIN));
            const newScrollTop = targetTopInScroller - desiredOffsetFromTop;

            // Only scroll if it would meaningfully change position.
            if (Math.abs(newScrollTop - scroller.scrollTop) > 4) {
                scroller.scrollTo({ top: Math.max(0, newScrollTop), behavior: 'smooth' });
            }
        }, 100);
        return () => clearTimeout(t);
    }, [containerHeight, focusedId, draftNodes, chatboxFocusTick]);

    // O(1) table lookup by ID
    const tableById = useMemo(() => new Map(tables.map(t => [t.id, t])), [tables]);

    // Cached getTriggers — avoids repeated chain walks within a single render
    const _tCache = new Map<string, Trigger[]>();
    const getCachedTriggers = (lt: DictTable): Trigger[] => {
        if (_tCache.has(lt.id)) return _tCache.get(lt.id)!;
        const triggers = getTriggers(lt, tables);
        _tCache.set(lt.id, triggers);
        return triggers;
    };

    // Now use useMemo to memoize the chartElements array
    let chartElements = useMemo(() => {
        return charts.filter(c => c.source == "user").map((chart) => {
            const table = getDataTable(chart, tables, charts, conceptShelfItems);
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
            return {
                chartId: chart.id,
                tableId: table.id,
                element,
                onDelete: () => { dispatch(dfActions.deleteChartById(chart.id)); },
                deleteTooltip: t('dataThread.deleteChart'),
                unread: !!chart.unread,
            };
        });
    }, [charts, tables, conceptShelfItems, chartSynthesisInProgress]);

    // anchors are considered leaf tables to simplify the view

    let isLeafTable = (table: DictTable) => {
        // A table with no (non-anchored) derivations is a leaf. Conversation-
        // produced tables are NORMAL tables now (design-docs/42): they fork into
        // their own column via the standard leaf partition, so no special case.
        let children = tables.filter(t => t.derive?.trigger.tableId == table.id);
        if (children.length == 0 || children.every(t => t.anchored)) {
            return true;
        }
        return false;
    }
    let leafTables = [ ...tables.filter(t => isLeafTable(t)) ];

    // Determine how many columns can fit in the current container width.  When
    // only one column fits, splitting a long thread into segments adds visual
    // overhead (continuation headers + parent chips) without any layout
    // benefit, since the segments would just stack in the same single column.
    // Column geometry (CARD_WIDTH / CARD_GAP / PANEL_PADDING) is defined once
    // in ./threadLayout and shared with DataFormulator's pane snapping.
    const fittableColumns = fittableThreadColumnsFor(containerWidth, threadTokens);

    // Adaptively split long derivation chains so the resulting segments fill
    // the available columns evenly.  See `computeSplitExtraLeaves` for the
    // target/K logic.  Skip in single-column mode — the continuation chrome
    // adds no layout benefit when segments would just stack vertically.
    const computedExtras = fittableColumns <= 1
        ? []
        : computeSplitExtraLeaves(
            leafTables, tables, chartElements, fittableColumns, textTurnItemsByTable,
        );
    // Avoid duplicating tables that are already leaves (e.g. anchored mids).
    // Also never split at a table that carries a terminal text turn
    // (clarify/explain with no result table): promoting it as a segment
    // endpoint would strand its explanation in a separate thread column,
    // divorced from the derivations that continue from the same table
    // (design-docs/41). Keeping it un-promoted glues the explanation to the
    // table's outgoing derivation flow in one continuous thread.
    const existingLeafIds = new Set(leafTables.map(t => t.id));
    const extraLeaves: DictTable[] = computedExtras.filter(
        t => !existingLeafIds.has(t.id) && !textTurnRootTableIds.has(t.id),
    );
    if (extraLeaves.length > 0) {
        leafTables = [...leafTables, ...extraLeaves];
    }

    // we want to sort the leaf tables by the order of their ancestors
    // for example if ancestor of list a is [0, 3] and the ancestor of list b is [0, 2] then b should come before a
    // when tables are anchored, we want to give them a higher order (so that they are displayed after their peers)
    let tableOrder = Object.fromEntries(tables.map((table, index) => [table.id, index + (table.anchored ? 1 : 0) * tables.length]));
    let getAncestorOrders = (leafTable: DictTable) => {
        let triggers = getCachedTriggers(leafTable);
        return [...triggers.map(t => tableOrder[t.resultTableId]), tableOrder[leafTable.id]];
    }

    leafTables.sort((a, b) => {
        let aOrders = getAncestorOrders(a);
        let bOrders = getAncestorOrders(b);
        
        // If lengths are equal, compare orders in order
        for (let i = 0; i < Math.min(aOrders.length, bOrders.length); i++) {
            if (aOrders[i] !== bOrders[i]) {
                return aOrders[i] - bOrders[i];
            }
        }
        
        // If all orders are equal, compare the leaf tables themselves
        return aOrders.length - bOrders.length;
    });

    // Compute global highlighted table IDs from the focused table's full ancestor chain
    // Also includes derive.source tables (all input tables used in computation)
    let globalHighlightedTableIds: string[] = useMemo(() => {
        if (!focusedTableId) return [];
        let focusedTable = tableById.get(focusedTableId);
        if (!focusedTable) return [];
        // Walk up the trigger chain from the focused table to collect all ancestor IDs
        let ids = new Set<string>([focusedTableId]);
        let current = focusedTable;
        // Add derive.source tables for the focused table itself
        if (current.derive?.source) {
            for (const sid of current.derive.source as string[]) {
                ids.add(sid);
            }
        }
        while (current.derive && !current.anchored) {
            let parentId = current.derive.trigger.tableId;
            ids.add(parentId);
            // Add derive.source tables for each ancestor
            if (current.derive.source) {
                for (const sid of current.derive.source as string[]) {
                    ids.add(sid);
                }
            }
            let parent = tableById.get(parentId);
            if (!parent) break;
            current = parent;
        }
        return [...ids];
    }, [focusedTableId, tableById]);

    // Determine which leaf table's thread the focused table belongs to
    let focusedThreadLeafId: string | undefined = useMemo(() => {
        if (!focusedTableId) return undefined;
        // Check if focused table IS a leaf table
        let directLeaf = leafTables.find(lt => lt.id === focusedTableId);
        if (directLeaf) return directLeaf.id;
        // Otherwise, find the leaf table whose ancestor chain includes the focused table
        for (const lt of leafTables) {
            const triggers = getCachedTriggers(lt);
            const chainIds = [...triggers.map(t => t.resultTableId), lt.id];
            if (chainIds.includes(focusedTableId)) {
                return lt.id;
            }
        }
        return undefined;
    }, [focusedTableId, leafTables, tables]);

    let hasContent = leafTables.length > 0 || tables.length > 0;

    // Collect all tables (including derived ones) for the workspace panel.
    let baseTables = tables;
    // Threaded tables: leaf tables that have a derivation chain. A conversation-
    // produced table is a normal derived leaf, so it threads (forks) here without
    // any special case (design-docs/42).
    let threadedTables = leafTables.filter(lt => {
        const triggers = getTriggers(lt, tables);
        return triggers.length + 1 > 1;
    });

    // Build thread entries for layout.
    // Source tables are NOT threads: they live in the shelf. A thread is one
    // derived-table chain (plus, optionally, the artifacts of the source table
    // it grew out of). Columns therefore come purely from the derived-table
    // tree — charts, reports, conversation turns and live drafts are terminal
    // artifacts that stack inline under their parent table.
    type ThreadEntry = {
        key: string;
        isShelf?: boolean;                // true → the source-table shelf, not a thread
        leafTable?: DictTable;            // absent → source-artifact-only thread
        originTableId?: string;           // source table this thread grew out of (reference chip)
        threadLabel?: string;
        isSplitThread?: boolean;          // true → continuation: "↑ continued" header + parent chip, no label
        hasContinuationBelow?: boolean;   // true → render "↓ continues below" footer
        usedTableIds?: string[];
    };
    let allThreadEntries: ThreadEntry[] = [];

    // Track which leaf tables are promoted (split) vs real leaves
    const extraLeafIds = new Set(extraLeaves.map(t => t.id));

    // Numbering counter shared by source-artifact threads and derived threads:
    // every numbered thread, whatever roots it, takes the next index.
    let realThreadIdx = 0;

    let sourceTables = tables.filter(t => !t.derive);

    // The shelf is not a thread, but it occupies the top of the first column,
    // so it packs alongside the threads as slot 0.
    if (sourceTables.length > 0) {
        allThreadEntries.push({ key: 'source-shelf', isShelf: true });
    }

    // Pre-scan: group every threaded leaf (extras + real leaves) by the *real
    // leaf* whose chain it belongs to.  Extras inherit their real leaf's id.
    let extraLeafToRealLeaf = new Map<string, string>();
    for (const lt of threadedTables) {
        if (extraLeafIds.has(lt.id)) continue;
        const triggers = getCachedTriggers(lt);
        const chainIds = new Set(triggers.map(t => t.resultTableId));
        for (const extraId of extraLeafIds) {
            if (chainIds.has(extraId) && !extraLeafToRealLeaf.has(extraId)) {
                extraLeafToRealLeaf.set(extraId, lt.id);
            }
        }
    }
    const groupIdOf = (lt: DictTable) =>
        extraLeafIds.has(lt.id) ? (extraLeafToRealLeaf.get(lt.id) || lt.id) : lt.id;

    // For each group, capture the ordered list of segments (using current
    // threadedTables iteration order, which has already been ancestor-sorted).
    const segmentsByGroup = new Map<string, string[]>();
    for (const lt of threadedTables) {
        const gid = groupIdOf(lt);
        const arr = segmentsByGroup.get(gid) || [];
        arr.push(lt.id);
        segmentsByGroup.set(gid, arr);
    }

    // Where each head segment grows from: the chain root, when it is a source
    // table. This is the ONE place origins are decided — it drives both the
    // reference chip in the thread and which sources still need a column below.
    const originOfHead = new Map<string, string>();
    for (const lt of threadedTables) {
        if (segmentsByGroup.get(groupIdOf(lt))![0] !== lt.id) continue; // continuation
        const trigs = getCachedTriggers(lt);
        const rootId = trigs.length > 0 ? trigs[0].tableId : lt.derive?.trigger.tableId;
        if (rootId && !tableById.get(rootId)?.derive) originOfHead.set(lt.id, rootId);
    }
    const sourcesWithColumn = new Set(originOfHead.values());

    // A source table that owns artifacts (charts, reports, conversation, a live
    // run) but roots NO derivation gets a column of its own — the shelf holds
    // names only, so the artifacts would otherwise have nowhere to hang.
    for (const st of sourceTables) {
        if (sourcesWithColumn.has(st.id)) continue;
        const hasArtifacts = chartElements.some(ce => ce.tableId === st.id)
            || (textTurnItemsByTable.get(st.id) || 0) > 0
            || generatedReports.some(r => r.triggerTableId === st.id)
            || draftNodes.some(d => d.derive?.trigger.tableId === st.id);
        if (!hasArtifacts) continue;
        realThreadIdx++;
        allThreadEntries.push({
            key: `source-thread-${st.id}`,
            originTableId: st.id,
            threadLabel: t('dataThread.threadIndex', { index: String(realThreadIdx) }),
        });
    }

    // Numbering: only the *first* segment of each group bumps the counter and
    // gets a visible label.  Continuation segments are unlabelled — they rely
    // on the "↑ continued" header chip + parent chip for visual continuity.
    // (`realThreadIdx` continues from the source-artifact threads above.)
    threadedTables.forEach((lt, i) => {
        const groupSegs = segmentsByGroup.get(groupIdOf(lt))!;
        const posInGroup = groupSegs.indexOf(lt.id);
        const isFirst = posInGroup === 0;
        const isLast = posInGroup === groupSegs.length - 1;
        if (isFirst) realThreadIdx++;

        allThreadEntries.push({
            key: `thread-${lt.id}-${i}`,
            leafTable: lt,
            originTableId: originOfHead.get(lt.id),
            threadLabel: isFirst ? t('dataThread.threadIndex', { index: String(realThreadIdx) }) : undefined,
            isSplitThread: !isFirst,             // continuation → parent chip + header, no label
            hasContinuationBelow: !isLast,       // not the tail → "↓ continues below" footer
        });
    });

    // Ownership + height, in one pass over the entries in layout order.
    // `accumulated` is the single source of truth: the FIRST entry to mention a
    // table renders it in full (card + charts + reports + turns + live run);
    // every later entry only points at it. Heights are estimated from exactly the rows
    // that entry will therefore render, so layout can't drift from the view.
    let allThreadHeights: number[] = [];
    {
        let accumulated: string[] = [];
        const artifactRowsOf = (id: string) =>
            chartElements.filter(ce => ce.tableId === id).length
            + generatedReports.filter(r => r.triggerTableId === id).length;

        for (const entry of allThreadEntries) {
            entry.usedTableIds = [...accumulated];

            if (entry.isShelf) {
                // Collapsed by default past the limit, so estimate the collapsed height.
                // +1 row for the "Add more data" button, which sits below the
                // bracketed set (the section label is covered by the thread overhead).
                allThreadHeights.push(estimateThreadHeight(Math.min(sourceTables.length, SHELF_VISIBLE_LIMIT) + 1, 0, 0));
                continue;
            }

            let tableRows = 0, entryRows = 0, artifactRows = 0;

            if (entry.originTableId) {
                tableRows += 1; // origin reference chip
                if (!accumulated.includes(entry.originTableId)) {
                    artifactRows += artifactRowsOf(entry.originTableId);
                    entryRows += textTurnItemsByTable.get(entry.originTableId) || 0;
                }
                accumulated.push(entry.originTableId);
            }

            const lt = entry.leafTable;
            if (lt) {
                const triggers = getCachedTriggers(lt);
                const chainIds = [...triggers.map(tp => tp.resultTableId), lt.id];
                const freshIds = chainIds.filter(id => !accumulated.includes(id));
                tableRows += freshIds.length + 1; // + the carried-over parent chip
                artifactRows += freshIds.reduce((sum, id) => sum + artifactRowsOf(id), 0);
                entryRows += triggers
                    .filter(tp => freshIds.includes(tp.resultTableId))
                    .reduce((sum, tp) => sum + (tp.interaction?.length || 1), 0);
                entryRows += lt.derive?.trigger?.interaction?.length || 1;
                // Text-turn cards (clarify/explain) anchored to any table in this
                // thread also occupy vertical space — count them so tall
                // conversations widen/split correctly.
                entryRows += chainIds.reduce((sum, id) => sum + (textTurnItemsByTable.get(id) || 0), 0);
                // Include both source (tableId) and result (resultTableId) IDs from the chain
                for (const tp of triggers) accumulated.push(tp.tableId, tp.resultTableId);
                accumulated.push(lt.id);
            }

            allThreadHeights.push(estimateThreadHeight(tableRows, entryRows, artifactRows));
        }
    }

    // (design-docs/42) No per-turn home assignment: a table's attached content
    // (conversation turns + live run state) renders at its single real card
    // card — the first entry that mentions it. Columns come purely from the
    // derived-table tree via the standard split rules.

    // The column count is the width that fits; entries (including the segments
    // of a split thread) are spread across them balancing estimated height.
    const columnLayout: number[][] = computeThreadColumnLayout(allThreadHeights, fittableColumns);
    const {
        moreAbove: moreThreadContentAbove,
        moreBelow: moreThreadContentBelow,
        update: updateThreadScrollFade,
    } = useScrollFade(threadScrollRef, allThreadEntries.length);

    let renderThreadEntry = (entry: ThreadEntry) => {
        let usedTableIds = entry.usedTableIds || [];

        const entrySx = {
            backgroundColor: 'white',
            borderRadius: radius.md,
            padding: 1,
            my: 0.5,
            flex: 'none',
            display: 'flex',
            flexDirection: 'column',
            height: 'fit-content',
            width: threadTokens.thread.cardWidth,
            transition: transition.fast,
        } as const;

        // The shelf packs like a thread but isn't one: it just lists the
        // workspace's source tables, which every thread grows out of.
        if (entry.isShelf) {
            return <SourceTableShelf
                key={entry.key}
                sourceTables={sourceTables}
                highlightedTableIds={globalHighlightedTableIds}
                focusedTableId={focusedTableId}
                sx={entrySx} />;
        }

        return <SingleThreadGroupView
            key={entry.key}
            threadLabel={entry.threadLabel}
            isSplitThread={entry.isSplitThread}
            hasContinuationBelow={entry.hasContinuationBelow}
            originTableId={entry.originTableId}
            leafTable={entry.leafTable}
            chartElements={chartElements}
            usedIntermediateTableIds={usedTableIds}
            globalHighlightedTableIds={globalHighlightedTableIds}
            focusedThreadLeafId={focusedThreadLeafId}
            sx={entrySx} />;
    };

    // Let content fill available width; column count driven by container size
    const panelWidth = '100%';

    let view = hasContent ? (
        <Box ref={threadScrollRef} onScroll={updateThreadScrollFade} sx={{ 
            overflowY: 'auto',
            overflowX: 'hidden',
            position: 'relative',
            direction: 'ltr',
            height: 'calc(100% - 16px)',
            width: panelWidth,
        }}>
            <Box sx={{
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'nowrap',
                justifyContent: 'flex-start',
                gap: `${threadTokens.thread.cardGap}px`,
                py: 1,
                // Bottom padding leaves room so the scroll handler can position
                // the focused element above the chatbox even when it expands.
                pb: '180px',
                pl: `${threadTokens.thread.panelPadding / 2}px`,
                pr: 0,
            }}>
                {/* First column: workspace panel + first batch of threads */}
                <Box key="thread-column-0" sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 0,
                    width: threadTokens.thread.cardWidth,
                    flexShrink: 0,
                }}>
                    {(columnLayout[0] || []).map((idx: number) => {
                        const entry = allThreadEntries[idx];
                        return entry ? renderThreadEntry(entry) : null;
                    })}
                </Box>
                {/* Remaining columns */}
                {columnLayout.slice(1).map((columnIndices: number[], colIdx: number) => (
                    <Box key={`thread-column-${colIdx + 1}`} sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0,
                        width: threadTokens.thread.cardWidth,
                        flexShrink: 0,
                    }}>
                        {columnIndices.map((idx: number) => {
                            const entry = allThreadEntries[idx];
                            return entry ? renderThreadEntry(entry) : null;
                        })}
                    </Box>
                ))}
            </Box>
        </Box>
    ) : null;

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
            <Box ref={containerRef} sx={{
                    overflow: 'hidden', 
                    position: 'relative',
                    direction: 'rtl', 
                    display: 'block', 
                    flex: 1,
                    minHeight: 0,
                }}>
                {view}
                <ScrollFadeEdge visible={moreThreadContentAbove} edge="top" />
                <ScrollFadeEdge visible={moreThreadContentBelow} />
            </Box>
            <SimpleChartRecBox onInputFocus={() => setChatboxFocusTick(t => t + 1)} />
        </Box>
    );
}

