// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useRef, useEffect, useMemo, useState, useCallback } from 'react';

import {
    Box,
    Typography,
    Card,
    CircularProgress,
    Divider,
    useTheme,
} from '@mui/material';

import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';

import { alpha } from '@mui/material/styles';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import { renderTextWithEmphasis } from './EncodingShelfCard';
import { ThinkingBufferEffect } from '../components/FunComponents';

type ThreadItem = {
    content: string;
    role: 'user' | 'thinking' | 'action' | 'completion' | 'error' | 'clarify';
    tableId?: string;
    chartId?: string;
    observeTableId?: string;
    resultTableId?: string;
    timestamp: number;
    actionId: string;
    isRunning: boolean;
};

/** A conversation thread groups an origin table with its agentAction messages. */
type ConversationThread = {
    kind: 'action';
    actionId: string;
    originTableId: string;
    messages: ThreadItem[];
    status: 'running' | 'completed' | 'warning' | 'failed';
} | {
    kind: 'orphan-table';
    tableId: string;
};

/** A thread group chains threads whose end tables feed into the next thread's origin. */
type ThreadGroup = ConversationThread[];

/**
 * ChatThreadView renders the full conversation timeline from agentActions,
 * grouped into separate conversation threads separated by dividers.
 */
export const ChatThreadView: FC = function () {
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const charts = useSelector(dfSelectors.getAllCharts);
    const agentActions = useSelector((state: DataFormulatorState) => state.agentActions);

    const theme = useTheme();
    const dispatch = useDispatch();
    const scrollRef = useRef<HTMLDivElement>(null);

    const focusedTableId = useMemo(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        const chart = charts.find(c => c.id === focusedId.chartId);
        return chart?.tableRef;
    }, [focusedId, charts]);

    const focusedChartId = focusedId?.type === 'chart' ? focusedId.chartId : undefined;

    // Track which threads are collapsed (keyed by actionId)
    const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set());
    const toggleThread = useCallback((threadId: string) => {
        setCollapsedThreads(prev => {
            const next = new Set(prev);
            if (next.has(threadId)) next.delete(threadId);
            else next.add(threadId);
            return next;
        });
    }, []);

    // Build conversation threads and chain them into groups
    const threadGroups = useMemo((): ThreadGroup[] => {
        const threads: ConversationThread[] = [];

        // Collect all table IDs referenced by agentActions (origin + result)
        const tablesInActions = new Set<string>();
        for (const action of agentActions) {
            if (action.hidden) continue;
            if (action.originTableId) tablesInActions.add(action.originTableId);
            for (const m of (action.messages || [])) {
                if (m.resultTableId) tablesInActions.add(m.resultTableId);
                if (m.observeTableId) tablesInActions.add(m.observeTableId);
            }
        }

        // Find root tables (no derive, or anchored) not referenced by any action
        const orphanRootTables = tables.filter(t =>
            (t.derive === undefined || t.anchored) && !tablesInActions.has(t.id)
        );

        // Each orphan root table gets its own thread entry
        for (const t of orphanRootTables) {
            threads.push({ kind: 'orphan-table', tableId: t.id });
        }

        // Each non-hidden agentAction becomes a conversation thread
        const sortedActions = [...agentActions]
            .filter(a => !a.hidden)
            .sort((a, b) => (a.messages?.[0]?.timestamp || a.lastUpdate) - (b.messages?.[0]?.timestamp || b.lastUpdate));

        for (const action of sortedActions) {
            const messages: ThreadItem[] = [];
            for (const m of (action.messages || [])) {
                const effectiveObserveId = m.observeTableId || (m.role === 'user' ? action.originTableId : undefined);
                messages.push({
                    content: m.content,
                    role: m.role,
                    observeTableId: effectiveObserveId,
                    resultTableId: m.resultTableId,
                    timestamp: m.timestamp,
                    actionId: action.actionId,
                    isRunning: false,
                });
            }
            // Live running status
            if (action.status === 'running') {
                const lastMsg = action.messages?.[action.messages.length - 1];
                if (!lastMsg || lastMsg.content !== action.description) {
                    messages.push({
                        content: action.description || 'thinking...',
                        role: 'thinking',
                        timestamp: action.lastUpdate,
                        actionId: action.actionId,
                        isRunning: true,
                    });
                }
            }
            threads.push({
                kind: 'action',
                actionId: action.actionId,
                originTableId: action.originTableId,
                messages,
                status: action.status,
            });
        }

        // Chain threads into groups: if thread B's originTableId matches any
        // resultTableId from thread A, display them together without a divider.
        // Build a map from resultTableId → thread index for action threads
        const resultTableToThread = new Map<string, number>();
        for (let i = 0; i < threads.length; i++) {
            const t = threads[i];
            if (t.kind === 'action') {
                for (const m of t.messages) {
                    if (m.resultTableId) {
                        resultTableToThread.set(m.resultTableId, i);
                    }
                }
            }
        }

        // For each action thread, find its parent (the thread whose result is this thread's origin)
        const parentOf = new Map<number, number>(); // child index → parent index
        for (let i = 0; i < threads.length; i++) {
            const t = threads[i];
            if (t.kind === 'action' && t.originTableId) {
                const parentIdx = resultTableToThread.get(t.originTableId);
                if (parentIdx !== undefined && parentIdx !== i) {
                    parentOf.set(i, parentIdx);
                }
            }
        }

        // Find chain roots (threads that aren't children of another thread)
        const childIndices = new Set(parentOf.keys());
        const visited = new Set<number>();
        const groups: ThreadGroup[] = [];

        // Build chain starting from each root
        for (let i = 0; i < threads.length; i++) {
            if (childIndices.has(i) || visited.has(i)) continue;
            // This is a root — walk forward to build the chain
            const group: ConversationThread[] = [threads[i]];
            visited.add(i);

            // Find children: threads whose originTableId is a result of the current tail
            let current = i;
            while (true) {
                // Find the next thread in the chain
                let nextIdx: number | undefined;
                for (const [child, parent] of parentOf.entries()) {
                    if (parent === current && !visited.has(child)) {
                        nextIdx = child;
                        break;
                    }
                }
                if (nextIdx === undefined) break;
                group.push(threads[nextIdx]);
                visited.add(nextIdx);
                current = nextIdx;
            }
            groups.push(group);
        }

        // Add any remaining unvisited threads (shouldn't happen, but safety)
        for (let i = 0; i < threads.length; i++) {
            if (!visited.has(i)) {
                groups.push([threads[i]]);
            }
        }

        return groups;
    }, [agentActions, tables]);

    // Auto-scroll to bottom when threads change
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [threadGroups]);

    const primaryColor = theme.palette.primary.main;
    const customColor = theme.palette.secondary.main;
    const TIMELINE_W = 14;
    const TIMELINE_GAP = '6px';

    const getTimelineIcon = (msg: ThreadItem) => {
        if (msg.isRunning) {
            return <CircularProgress size={14} thickness={5} sx={{ color: customColor }} />;
        }
        switch (msg.role) {
            case 'user':
                return <PersonOutlineIcon sx={{ fontSize: 16, color: primaryColor }} />;
            case 'thinking':
                return <SmartToyOutlinedIcon sx={{ fontSize: 15, color: customColor }} />;
            case 'action':
                return <SmartToyOutlinedIcon sx={{ fontSize: 15, color: customColor }} />;
            case 'completion':
                return <SmartToyOutlinedIcon sx={{ fontSize: 15, color: theme.palette.success.main }} />;
            case 'error':
                return <SmartToyOutlinedIcon sx={{ fontSize: 15, color: theme.palette.error.main }} />;
            case 'clarify':
                return <SmartToyOutlinedIcon sx={{ fontSize: 15, color: customColor }} />;
            default:
                return <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.2)' }} />;
        }
    };

    const tableNode = (tableId: string) => {
        const table = tables.find(t => t.id === tableId);
        if (!table) return null;
        const rowCount = table.virtual?.rowCount ?? table.rows?.length ?? 0;
        const isFocused = tableId === focusedTableId;
        return (
            <Card elevation={0}
                sx={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    px: '6px', py: '3px',
                    borderRadius: '6px',
                    width: 'fit-content',
                    border: isFocused ? `1.5px solid ${alpha(theme.palette.primary.main, 0.9)}` : '1px solid rgba(0,0,0,0.12)',
                    backgroundColor: isFocused ? alpha(theme.palette.primary.main, 0.06) : alpha(theme.palette.grey[500], 0.06),
                    cursor: 'pointer',
                    '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.08) },
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    dispatch(dfActions.setFocused({ type: 'table', tableId }));
                }}
            >
                <Typography sx={{ fontSize: 11, fontWeight: 500, color: theme.palette.text.primary,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {table.displayId || tableId}
                    <Typography component="span" sx={{ fontSize: 10, color: theme.palette.text.disabled, ml: 0.5 }}>
                        {rowCount}r &times; {table.names.length}c
                    </Typography>
                </Typography>
            </Card>
        );
    };

    const chartThumbnails = (tableId: string) => {
        const tableCharts = charts.filter(c => c.tableRef === tableId && c.thumbnail);
        if (tableCharts.length === 0) return null;
        return (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'flex-start' }}>
                {tableCharts.map(chart => {
                    const isChartFocused = chart.id === focusedChartId;
                    return (
                        <Box key={chart.id}
                            onClick={(e) => {
                                e.stopPropagation();
                                dispatch(dfActions.setFocused({ type: 'chart', chartId: chart.id }));
                            }}
                            sx={{
                                display: 'inline-flex',
                                borderRadius: '6px',
                                overflow: 'hidden',
                                border: isChartFocused ? `1.5px solid ${alpha(theme.palette.primary.main, 0.9)}` : '1.5px solid transparent',
                                backgroundColor: 'white',
                                cursor: 'pointer',
                            }}
                        >
                            <img
                                src={chart.thumbnail}
                                alt={`${chart.chartType} chart`}
                                style={{ minWidth: 80, maxWidth: 120, maxHeight: 80, objectFit: 'contain' }}
                            />
                        </Box>
                    );
                })}
            </Box>
        );
    };

    /** Generate a one-line plain-text summary for a message. */
    const summarize = (msg: ThreadItem): string => {
        const raw = typeof msg.content === 'string' ? msg.content.replace(/\*\*/g, '') : String(msg.content || msg.role);
        const oneLine = raw.replace(/\n+/g, ' ').trim();
        return oneLine.length > 80 ? oneLine.slice(0, 80) + '…' : oneLine;
    };

    const renderContent = (msg: ThreadItem, collapsed = false) => {
        const fs = 12;
        const fsStr = '12px';
        if (msg.isRunning) {
            return <ThinkingBufferEffect text={msg.content || 'thinking...'} sx={{ width: '100%' }} />;
        }

        // Collapsed: single-line truncated summary with role-appropriate color
        if (collapsed) {
            const color = msg.role === 'completion' ? theme.palette.success.main
                : msg.role === 'error' ? theme.palette.error.main
                : msg.role === 'thinking' ? 'rgba(0,0,0,0.5)'
                : 'rgba(0,0,0,0.6)';
            return (
                <Box>
                    <Typography sx={{ fontSize: 11, color, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        ...(msg.role === 'user' ? { fontStyle: 'italic' } : {}) }}>
                        {summarize(msg)}
                    </Typography>
                    {msg.resultTableId && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', mt: '4px' }}>
                            {tableNode(msg.resultTableId)}
                            {chartThumbnails(msg.resultTableId)}
                        </Box>
                    )}
                </Box>
            );
        }

        const textColor = 'rgba(0,0,0,0.87)';
        const textSecondary = 'rgba(0,0,0,0.7)';
        switch (msg.role) {
            case 'user':
                return (
                    <Typography component="div" sx={{ fontSize: fs, color: textColor,
                        fontStyle: 'italic',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {msg.content}
                    </Typography>
                );
            case 'thinking':
                return (
                    <Typography component="div" sx={{ fontSize: fs, color: textSecondary,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {renderTextWithEmphasis(msg.content, {
                            borderRadius: '2px',
                            fontSize: fsStr,
                            backgroundColor: alpha(customColor, 0.08),
                        })}
                    </Typography>
                );
            case 'action':
                return (
                    <Box>
                        <Typography component="div" sx={{ fontSize: fs, color: textColor,
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {renderTextWithEmphasis(msg.content, {
                                borderRadius: '2px',
                                fontSize: fsStr,
                                backgroundColor: alpha(customColor, 0.08),
                            })}
                        </Typography>
                        {msg.resultTableId && (
                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', mt: '4px' }}>
                                {tableNode(msg.resultTableId)}
                                {chartThumbnails(msg.resultTableId)}
                            </Box>
                        )}
                    </Box>
                );
            case 'completion':
                return (
                    <Box>
                        <Typography sx={{ fontSize: fs, color: theme.palette.success.main,
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {renderTextWithEmphasis(msg.content, {
                                borderRadius: '2px',
                                fontSize: fsStr,
                            })}
                        </Typography>
                        {msg.resultTableId && (
                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', mt: '4px' }}>
                                {tableNode(msg.resultTableId)}
                                {chartThumbnails(msg.resultTableId)}
                            </Box>
                        )}
                    </Box>
                );
            case 'error':
                return (
                    <Typography sx={{ fontSize: fs, color: textColor,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {msg.content}
                    </Typography>
                );
            case 'clarify':
                return (
                    <Typography component="div" sx={{ fontSize: fs, color: textColor,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {renderTextWithEmphasis(msg.content, {
                            borderRadius: '2px',
                            fontSize: fsStr,
                            backgroundColor: alpha(customColor, 0.08),
                        })}
                    </Typography>
                );
            default:
                return null;
        }
    };

    /** Render a single timeline row (icon + connecting lines + content). */
    const renderTimelineRow = (
        content: React.ReactNode,
        icon: React.ReactNode,
        opts: {
            isFirst: boolean; isLast: boolean;
            bgColor?: string; lineColor?: string; bottomLineColor?: string;
            onClick?: (e: React.MouseEvent) => void;  // optional click handler for the row
        }
    ) => {
        const lc = opts.lineColor || 'rgba(0,0,0,0.12)';
        const blc = opts.bottomLineColor || lc;
        const clickable = !!opts.onClick;

        return (
            <Box
                onClick={opts.onClick}
                sx={{
                    display: 'flex', flexDirection: 'row', position: 'relative',
                    ...(clickable ? { cursor: 'pointer' } : {}),
                    ...(opts.bgColor && opts.bgColor !== 'transparent' ? {
                        backgroundColor: opts.bgColor,
                        borderRadius: '6px',
                        mx: '-4px',
                        px: '4px',
                    } : {}),
                }}>
                <Box sx={{
                    width: TIMELINE_W, flexShrink: 0,
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    pt: '5px',
                }}>
                    {!opts.isFirst && (
                        <Box sx={{ width: 0, flexShrink: 0, height: 4, borderLeft: `1px solid ${lc}`, mt: '-5px' }} />
                    )}
                    <Box sx={{ flexShrink: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {icon}
                    </Box>
                    {!opts.isLast
                        ? <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `1px solid ${blc}` }} />
                        : <Box sx={{ flex: '1 1 0', minHeight: 2 }} />
                    }
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, py: '6px', pl: TIMELINE_GAP }}>
                    {content}
                </Box>
            </Box>
        );
    };

    /** Render a full action-based conversation thread. skipOriginTable omits the
     *  origin table row when it was already shown as a result of the previous thread in the chain. */
    const renderActionThread = (thread: ConversationThread & { kind: 'action' }, skipOriginTable = false) => {
        const originTable = skipOriginTable ? undefined : tables.find(t => t.id === thread.originTableId);
        const isRunningThread = thread.status === 'running';
        const lastMsgIsRunning = thread.messages.length > 0 && thread.messages[thread.messages.length - 1].isRunning;
        // If the thread is running but the last message doesn't already have isRunning,
        // we'll append an extra "working..." row, so account for it in totalRows.
        const needsRunningRow = isRunningThread && !lastMsgIsRunning;
        const totalRows = (originTable ? 1 : 0) + thread.messages.length + (needsRunningRow ? 1 : 0);
        // When origin is skipped (chained), the first message continues the timeline from the previous thread
        const chainContinuation = skipOriginTable;

        const isCollapsed = collapsedThreads.has(thread.actionId);

        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {/* Origin table — click to collapse/expand the entire thread */}
                {originTable && renderTimelineRow(
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {tableNode(originTable.id)}
                        {chartThumbnails(originTable.id)}
                    </Box>,
                    isCollapsed
                        ? <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 18, height: 18, borderRadius: '50%', border: `1px solid ${alpha(theme.palette.text.secondary, 0.4)}`,
                            cursor: 'pointer', '&:hover': { backgroundColor: alpha(theme.palette.action.hover, 0.12) } }}>
                            <ChevronRightIcon sx={{ fontSize: 13, color: theme.palette.text.secondary }} />
                          </Box>
                        : <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 18, height: 18, borderRadius: '50%', border: `1px solid ${alpha(theme.palette.text.secondary, 0.4)}`,
                            cursor: 'pointer', '&:hover': { backgroundColor: alpha(theme.palette.action.hover, 0.12) } }}>
                            <ExpandMoreIcon sx={{ fontSize: 13, color: theme.palette.text.secondary }} />
                          </Box>,
                    { isFirst: true, isLast: totalRows <= 1,
                      onClick: (e) => { e.stopPropagation(); toggleThread(thread.actionId); } },
                )}
                {/* Messages — condensed to single-line summaries when collapsed */}
                {thread.messages.map((msg, idx) => {
                    const rowIdx = (originTable ? 1 : 0) + idx;
                    const isFirst = rowIdx === 0 && !chainContinuation;
                    const isLast = rowIdx === totalRows - 1;

                    const bgColor = isCollapsed ? 'transparent'
                        : msg.role === 'user' ? alpha(theme.palette.primary.main, 0.10)
                        : msg.role === 'error' ? alpha(theme.palette.error.main, 0.10)
                        : 'transparent';

                    return (
                        <React.Fragment key={`msg-${idx}`}>
                            {renderTimelineRow(
                                renderContent(msg, isCollapsed),
                                getTimelineIcon(msg),
                                { isFirst, isLast, bgColor },
                            )}
                        </React.Fragment>
                    );
                })}
                {/* Extra running indicator when thread is running but last message isn't already a running row */}
                {needsRunningRow && renderTimelineRow(
                    <Typography variant="body2" sx={{ fontSize: 11, color: customColor, fontStyle: 'italic' }}>
                        working...
                    </Typography>,
                    <CircularProgress size={14} thickness={5} sx={{ color: customColor }} />,
                    { isFirst: totalRows <= 1, isLast: true },
                )}
            </Box>
        );
    };

    /** Render an orphan table thread (table + its charts, no agent messages). */
    const renderOrphanThread = (tableId: string) => {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {renderTimelineRow(
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {tableNode(tableId)}
                        {chartThumbnails(tableId)}
                    </Box>,
                    <StorageOutlinedIcon sx={{ fontSize: 12, color: theme.palette.text.secondary }} />,
                    { isFirst: true, isLast: true },
                )}
            </Box>
        );
    };

    if (threadGroups.length === 0) {
        return (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
                <Typography variant="caption" sx={{ color: theme.palette.text.disabled, fontSize: 11 }}>
                    Start a conversation to explore your data.
                </Typography>
            </Box>
        );
    }

    /** Collect all result table IDs from an action thread's messages. */
    const getResultTableIds = (thread: ConversationThread): Set<string> => {
        const ids = new Set<string>();
        if (thread.kind === 'action') {
            for (const m of thread.messages) {
                if (m.resultTableId) ids.add(m.resultTableId);
            }
        }
        return ids;
    };

    return (
        <Box ref={scrollRef} sx={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            px: 1, py: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            minHeight: 0,
        }}>
            {threadGroups.map((group, gIdx) => (
                <React.Fragment key={`group-${gIdx}`}>
                    {gIdx > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', my: '12px', px: 1 }}>
                            <Box sx={{ flex: 1, borderBottom: `1.5px dashed ${alpha(theme.palette.text.disabled, 0.3)}` }} />
                        </Box>
                    )}
                    {group.map((thread, tIdx) => {
                        // Skip origin table if it was a result of the previous thread in the chain
                        const prevThread = tIdx > 0 ? group[tIdx - 1] : undefined;
                        const prevResultIds = prevThread ? getResultTableIds(prevThread) : new Set<string>();
                        const skipOrigin = thread.kind === 'action' && prevResultIds.has(thread.originTableId);

                        return (
                            <React.Fragment key={`thread-${tIdx}`}>
                                {thread.kind === 'action'
                                    ? renderActionThread(thread, skipOrigin)
                                    : renderOrphanThread(thread.tableId)
                                }
                            </React.Fragment>
                        );
                    })}
                </React.Fragment>
            ))}
        </Box>
    );
};
