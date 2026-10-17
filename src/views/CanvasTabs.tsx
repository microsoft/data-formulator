// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tabs across the top of the canvas, like a browser's: whatever the canvas shows gets a tab, so
 * going back is one click. Results an agent run adds get tabs too, with a yellow dot until visited.
 * The latest tabs that fit show (they shrink to fit more); older ones go in "…".
 * Tabs live in the session (dfSlice `canvasTabs`), so they come back on reload.
 */

import React, { FC, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, ButtonBase, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import ArticleIcon from '@mui/icons-material/Article';
import HtmlIcon from '@mui/icons-material/Html';
import { chartFamilyIcon, InsightIcon, TableIcon } from '../icons';
import { WorkflowGears } from '../components/FunComponents';
import { AgentToyIcon } from './AgentToyIcon';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { CanvasTab, canvasTabKey, DataFormulatorState, dfActions, dfSelectors, FocusedId } from '../app/dfSlice';
import { computeInsightKey } from '../components/ComponentType';
import { externalReferenceTitle } from '../app/workspaceService';
import { borderColor } from '../app/tokens';

export const CANVAS_TABS_HEIGHT = 32;
const TAB_MIN_WIDTH = 112;
const TAB_MAX_WIDTH = 200;
const MORE_WIDTH = 30;
const UNSEEN_COLOR = '#f2b01e';

type Target = CanvasTab['target'];
const glyphSx = { width: 14, height: 14 };

const UnseenDot: FC<{ title?: string }> = ({ title }) =>
    <Box component="span" title={title} sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: UNSEEN_COLOR, flexShrink: 0 }} />;

/** One title rule for every kind, shared by the tab strip. */
const useTabLabel = () => {
    const { t } = useTranslation();
    const charts = useSelector(dfSelectors.getAllCharts);
    const tables = useSelector(dfSelectors.getAllTables);
    const fileNodes = useSelector((state: DataFormulatorState) => state.fileNodes);
    const reports = useSelector((state: DataFormulatorState) => state.generatedReports);
    const references = useSelector((state: DataFormulatorState) => state.externalTableReferences);
    const turns = useSelector((state: DataFormulatorState) => state.textTurns);
    /** Whether a tab still points at something; tabs of deleted items are dropped. */
    const exists = (target: Target): boolean => {
        switch (target.type) {
            case 'chart': return charts.some(item => item.id === target.chartId);
            case 'table': return tables.some(item => item.id === target.tableId);
            case 'report': return reports.some(item => item.id === target.reportId);
            case 'external-table': return !!references?.some(item => item.id === target.referenceId);
            case 'text': return turns.some(item => item.id === target.textId);
            default: return true;
        }
    };
    // The same glyphs the thread and the workspace use for each kind.
    const label = (target: Target): { title: string; icon: React.ReactNode } => {
        const tableName = (id: string) => tables.find(table => table.id === id)?.displayId || id;
        switch (target.type) {
            case 'chart': {
                const chart = charts.find(item => item.id === target.chartId);
                const titled = chart?.title && chart.titleKey === computeInsightKey(chart);
                const FamilyIcon = chart ? chartFamilyIcon(chart.chartType) : InsightIcon;
                return { title: titled ? chart!.title! : chart ? `${chart.chartType} · ${tableName(chart.tableRef)}` : t('canvas.chart', { defaultValue: 'Chart' }),
                    icon: <FamilyIcon sx={glyphSx} /> };
            }
            case 'table': return { title: tableName(target.tableId), icon: <TableIcon sx={glyphSx} /> };
            case 'file': {
                const node = fileNodes.find(item => item.path === target.fileName);
                const Glyph = /\.html?$/i.test(target.fileName) ? HtmlIcon : /\.app\.jsx$/i.test(target.fileName) ? DashboardOutlinedIcon : InsertDriveFileOutlinedIcon;
                return { title: node?.displayName || target.fileName.split('/').pop() || target.fileName, icon: <Glyph sx={glyphSx} /> };
            }
            case 'report': return { title: reports.find(item => item.id === target.reportId)?.title || t('report.untitled'), icon: <ArticleIcon sx={glyphSx} /> };
            case 'external-table': {
                const reference = references?.find(item => item.id === target.referenceId);
                return { title: reference ? externalReferenceTitle(reference) : target.referenceId, icon: <TableIcon sx={glyphSx} /> };
            }
            case 'conversation': return { title: t('conversation.title', { defaultValue: 'Conversation' }), icon: <ForumOutlinedIcon sx={glyphSx} /> };
            case 'text': {
                const turn = turns.find(item => item.id === target.textId);
                const title = turn?.workflow ? turn.displayId : turn?.form?.title || turn?.prompt
                    || (turn?.content || '').replace(/[#*`>|]/g, ' ').replace(/\s+/g, ' ').trim();
                const icon = turn?.workflow || turn?.form?.kind === 'workflow'
                    ? <WorkflowGears running={turn.workflow?.status === 'running'} size={14} color="currentColor" showTooltip={false} />
                    : turn?.form ? <InsertDriveFileOutlinedIcon sx={glyphSx} /> : <AgentToyIcon sx={glyphSx} />;
                return { title: title || t('canvas.response', { defaultValue: 'Response' }), icon };
            }
            default: return { title: '', icon: <AgentToyIcon sx={glyphSx} /> };
        }
    };
    return { label, exists };
};

export const CanvasTabs: FC<{ target: FocusedId; viewMode: 'editor' | 'report'; onCloseCanvas: () => void }> = ({ target, viewMode, onCloseCanvas }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const { label, exists } = useTabLabel();
    const tabs = useSelector((state: DataFormulatorState) => state.canvasTabs);
    const activeKey = useSelector((state: DataFormulatorState) => state.canvasTabActive);
    // In report mode the report is what's open.
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const current: FocusedId = viewMode === 'report' && focusedId?.type === 'report' ? focusedId : target;
    const currentKey = current ? canvasTabKey(current) : undefined;

    // Whatever the canvas shows becomes the active tab.
    useEffect(() => { dispatch(dfActions.syncCanvasTab(current)); }, [currentKey]);

    const stale = tabs.filter(tab => !exists(tab.target)).map(tab => tab.key);
    useEffect(() => { if (stale.length) dispatch(dfActions.closeCanvasTabs(stale)); }, [stale.join('|')]);

    const rowRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const row = rowRef.current;
        if (!row) return;
        const measure = () => setWidth(row.clientWidth);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(row);
        return () => observer.disconnect();
    }, []);

    // The latest tabs, as many as fit; tabs shrink to fit more, down to TAB_MIN_WIDTH. Older ones wait in "…".
    const ordered = tabs.filter(tab => exists(tab.target));
    const fit = !width || ordered.length * TAB_MIN_WIDTH <= width ? ordered.length : Math.max(1, Math.floor((width - MORE_WIDTH) / TAB_MIN_WIDTH));
    const visible = ordered.slice(Math.max(0, ordered.length - fit));
    const hidden = ordered.filter(tab => !visible.includes(tab)).reverse();

    // A tab opened from "…" (or from the thread while in "…") is recent again: it moves to the end.
    const activeHidden = !!activeKey && hidden.some(tab => tab.key === activeKey);
    useEffect(() => { if (activeHidden && activeKey) dispatch(dfActions.touchCanvasTab(activeKey)); }, [activeHidden, activeKey]);

    const open = (tab: CanvasTab) => {
        dispatch(dfActions.setFocused(tab.target));
        dispatch(dfActions.setViewMode(tab.target.type === 'report' ? 'report' : 'editor'));
    };
    const close = (keys: string[]) => {
        dispatch(dfActions.closeCanvasTabs(keys));
        if (!activeKey || !keys.includes(activeKey)) return;
        const index = ordered.findIndex(tab => tab.key === activeKey);
        const kept = (tab: CanvasTab) => !keys.includes(tab.key);
        const neighbour = ordered.slice(index + 1).find(kept) || ordered.slice(0, Math.max(0, index)).reverse().find(kept);
        if (neighbour) open(neighbour);
        else onCloseCanvas();
    };

    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const others = ordered.filter(tab => tab.key !== activeKey).map(tab => tab.key);
    const newLabel = t('canvas.newResult', { defaultValue: 'New, not yet viewed' });

    // Above the canvas box, flush with its left edge. The active tab shares the box's border and
    // laps 1px over its top edge, so it opens into the canvas with no line between.
    // Tabs that fill the row run flush to its end (the canvas squares its corner under an active last tab).
    const flushEnd = hidden.length === 0 && !!width && visible.length * TAB_MAX_WIDTH >= width;
    return <Box role="tablist" aria-label={t('canvas.tabs', { defaultValue: 'Open items' })} data-canvas-tabs
        data-flush-end={flushEnd ? 'true' : undefined} sx={{
        display: 'flex', alignItems: 'flex-end', height: CANVAS_TABS_HEIGHT, flexShrink: 0, minWidth: 0,
        position: 'relative', zIndex: 1, mb: '-1px',
    }}>
        <Box ref={rowRef} sx={{ display: 'flex', alignItems: 'flex-end', flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
            {visible.map(tab => {
                const { title, icon } = label(tab.target);
                const active = tab.key === activeKey;
                return <ButtonBase key={tab.key} component="div" role="tab" aria-selected={active} title={title}
                    onClick={() => open(tab)}
                    onAuxClick={event => { if (event.button === 1) close([tab.key]); }}
                    sx={{
                        position: 'relative', display: 'flex', alignItems: 'center', gap: 0.6, minWidth: TAB_MIN_WIDTH, flex: `0 1 ${TAB_MAX_WIDTH}px`,
                        height: 'calc(100% - 4px)', boxSizing: 'border-box', px: 1,
                        borderRadius: '8px 8px 0 0', fontSize: '0.75rem',
                        color: active ? 'text.primary' : 'text.secondary', bgcolor: active ? 'background.paper' : 'transparent',
                        border: '1px solid', borderBottom: 0, borderColor: active ? borderColor.view : 'transparent',
                        '& .tab-close': { display: active ? 'inline-flex' : 'none' },
                        '&:hover .tab-close': { display: 'inline-flex' }, '&:hover .tab-dot': { display: 'none' },
                        '&:hover': { color: 'text.primary' },
                        // A short muted separator between tabs, as in Chrome; not beside the active tab.
                        '&::before': { content: '""', position: 'absolute', left: -1, top: '50%', transform: 'translateY(-50%)',
                            width: '1px', height: 14, bgcolor: 'rgba(0,0,0,0.12)' },
                        '&:first-of-type::before, &[aria-selected="true"]::before, [aria-selected="true"] + &::before': { display: 'none' },
                    }}>
                    <Box sx={{ width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.8, color: 'text.secondary', '& svg': { width: 14, height: 14 } }}>{icon}</Box>
                    {/* Like Chrome: a long title fades out at the edge rather than ending in "…". */}
                    <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap',
                        maskImage: 'linear-gradient(to right, #000 calc(100% - 18px), transparent)',
                        WebkitMaskImage: 'linear-gradient(to right, #000 calc(100% - 18px), transparent)' }}>{title}</Box>
                    {tab.unseen && !active && <Box className="tab-dot" sx={{ display: 'flex', px: '4px' }}><UnseenDot title={newLabel} /></Box>}
                    <IconButton className="tab-close" size="small" aria-label={t('canvas.closeTab', { defaultValue: 'Close tab' })}
                        onClick={event => { event.stopPropagation(); close([tab.key]); }}
                        sx={{ p: '2px', mr: '-4px', color: 'text.secondary', opacity: 0.7, '&:hover': { opacity: 1 } }}>
                        <CloseIcon sx={{ fontSize: 12 }} />
                    </IconButton>
                </ButtonBase>;
            })}
        </Box>
        {hidden.length > 0 && <>
            <IconButton size="small" aria-label={t('canvas.moreTabs', { defaultValue: 'More tabs' })} title={t('canvas.moreTabs', { defaultValue: 'More tabs' })}
                onClick={event => setMenuAnchor(event.currentTarget)}
                sx={{ mb: '5px', mx: 0.25, p: '3px', position: 'relative', color: 'text.secondary', '& svg': { fontSize: 16 } }}>
                <MoreHorizIcon />
                {hidden.some(tab => tab.unseen) && <Box sx={{ position: 'absolute', top: 1, right: 1, display: 'flex' }}><UnseenDot /></Box>}
            </IconButton>
        </>}
        <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { maxHeight: 360, minWidth: 220, maxWidth: 320 } } }}>
            {hidden.map(tab => {
                const { title, icon } = label(tab.target);
                return <MenuItem key={tab.key} dense title={title} onClick={() => { setMenuAnchor(null); open(tab); }}>
                    <ListItemIcon sx={{ minWidth: '26px !important' }}>
                        <Box sx={{ width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary', '& svg': { width: 14, height: 14 } }}>{icon}</Box>
                    </ListItemIcon>
                    <ListItemText primary={title} slotProps={{ primary: { noWrap: true, fontSize: '0.8rem' } }} />
                    {tab.unseen && <Box sx={{ ml: 1, display: 'flex' }}><UnseenDot title={newLabel} /></Box>}
                </MenuItem>;
            })}
            {others.length > 0 && <Divider />}
            {others.length > 0 && <MenuItem dense onClick={() => { setMenuAnchor(null); close(others); }}>
                <ListItemText primary={t('canvas.closeOthers', { defaultValue: 'Close other tabs' })} slotProps={{ primary: { fontSize: '0.8rem' } }} />
            </MenuItem>}
        </Menu>
    </Box>;
};
