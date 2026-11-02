// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tabs across the top of the canvas, like VS Code's: reports, apps and maps get a tab that stays
 * (ones an agent run adds show a yellow dot until visited). Anything else the canvas shows (a chart,
 * a table, …) gets an italic preview tab that goes when the user moves on; double-click keeps it.
 * The latest tabs that fit show (they shrink to fit more); older ones go in "…".
 * Tabs live in the session (dfSlice `canvasTabs`), so they come back on reload.
 */

import React, { FC, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, ButtonBase, IconButton, ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import ArticleIcon from '@mui/icons-material/Article';
import { chartFamilyIcon, FileTypeIcon, FormIcon, InsightIcon, isAppFile, TableIcon } from '../icons';
import { WorkflowGears } from '../components/FunComponents';
import { AgentToyIcon } from './AgentToyIcon';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { arrangeCanvasTabs, CanvasTab, canvasTabKey, DataFormulatorState, dfActions, dfSelectors, FocusedId, isCanvasTabPinned, RECENT_CANVAS_TABS } from '../app/dfSlice';
import { chartTitleFits } from '../components/ComponentType';
import { externalReferenceTitle } from '../app/workspaceService';
import { borderColor } from '../app/tokens';

export const CANVAS_TABS_HEIGHT = 32;
const TAB_MIN_WIDTH = 96;
// Tabs fill the strip: as many as fit at this width, but at least a few.
const TAB_FILL_WIDTH = 130;
const MIN_RECENT_TABS = 3;
const TAB_MAX_WIDTH = 180;
const MORE_WIDTH = 84; // room for "+N more" and its right margin
const UNSEEN_COLOR = '#f2b01e';

type Target = CanvasTab['target'];

/**
 * A tab's icon colour, by category, matching the thread: data (tables, charts) in the primary blue,
 * authored outputs (reports, apps) in the secondary purple, everything else neutral.
 */
const tabTone = (target: Target): string => {
    if (target.type === 'chart' || target.type === 'table' || target.type === 'external-table') return 'primary.main';
    if (target.type === 'report' || (target.type === 'file' && isAppFile(target.fileName))) return 'secondary.main';
    return 'text.secondary';
};

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
                const titled = !!chart && chartTitleFits(chart);
                const FamilyIcon = chart ? chartFamilyIcon(chart.chartType) : InsightIcon;
                return { title: titled ? chart!.title! : chart ? `${chart.chartType} · ${tableName(chart.tableRef)}` : t('canvas.chart', { defaultValue: 'Chart' }),
                    icon: <FamilyIcon sx={glyphSx} /> };
            }
            case 'table': return { title: tableName(target.tableId), icon: <TableIcon sx={glyphSx} /> };
            case 'file': {
                const node = fileNodes.find(item => item.path === target.fileName);
                return { title: node?.displayName || target.fileName.split('/').pop() || target.fileName,
                    icon: <FileTypeIcon path={target.fileName} size={glyphSx.width} /> };
            }
            case 'report': return { title: reports.find(item => item.id === target.reportId)?.title || t('report.untitled'), icon: <ArticleIcon sx={glyphSx} /> };
            case 'external-table': {
                const reference = references?.find(item => item.id === target.referenceId);
                return { title: reference ? externalReferenceTitle(reference) : target.referenceId, icon: <TableIcon sx={glyphSx} /> };
            }
            // A thread's conversation is named by its thread ("Thread - 1 chat").
            case 'conversation': return { title: target.label
                    ? t('conversation.threadTitle', { defaultValue: '{{thread}} chat', thread: target.label.replace(/^\w/, c => c.toUpperCase()) })
                    : t('conversation.title', { defaultValue: 'Conversation' }),
                icon: <ForumOutlinedIcon sx={glyphSx} /> };
            case 'text': {
                const turn = turns.find(item => item.id === target.textId);
                const title = turn?.workflow ? turn.displayId : turn?.form?.title || turn?.prompt
                    || (turn?.content || '').replace(/[#*`>|]/g, ' ').replace(/\s+/g, ' ').trim();
                const icon = turn?.workflow || turn?.form?.kind === 'workflow'
                    ? <WorkflowGears running={turn.workflow?.status === 'running'} size={14} color="currentColor" showTooltip={false} />
                    : turn?.form ? <FormIcon sx={glyphSx} /> : <AgentToyIcon sx={glyphSx} />;
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

    // As many tabs as fill the strip at a comfortable width (at least a few, shrinking toward
    // TAB_MIN_WIDTH when space is tight), then "+N more". New tabs join on the right; the oldest
    // leave the strip for "+N more", so it never needs tending.
    const live = tabs.filter(tab => exists(tab.target));
    const fillSlots = width ? Math.floor((width - MORE_WIDTH) / TAB_FILL_WIDTH) : RECENT_CANVAS_TABS;
    const fitSlots = width ? Math.floor((width - MORE_WIDTH) / TAB_MIN_WIDTH) : RECENT_CANVAS_TABS;
    const slots = Math.max(1, Math.min(fitSlots, Math.max(MIN_RECENT_TABS, fillSlots)));
    const { visible, history, activeOutside } = arrangeCanvasTabs(live, activeKey, slots);
    const hidden = history;
    const ordered = [...visible, ...history];

    // Opening a tab that is in view leaves the strip as it is; one further left (brought back from the
    // "…" history, by the menu or the thread) moves to the end of the strip.
    useEffect(() => { if (activeOutside && activeKey) dispatch(dfActions.touchCanvasTab(activeKey)); }, [activeOutside, activeKey]);

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
    // Drag to reorder, as in Chrome: the grabbed tab follows the pointer and the others slide out of its way.
    const [drag, setDrag] = useState<{ key: string; dx: number; from: number; to: number; slot: number }>();
    const dragStart = useRef<{ key: string; x: number; from: number; to: number; lefts: number[]; widths: number[]; slot: number; moved: boolean;
        order: string[]; first: number; last: number }>();
    const suppressClick = useRef(false);
    const startDrag = (event: React.PointerEvent<HTMLElement>, key: string) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('.tab-close')) return;
        const tabsEls = Array.from(rowRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') || []);
        const from = visible.findIndex(tab => tab.key === key);
        if (from < 0 || !tabsEls[from]) return;
        const rects = tabsEls.map(el => el.getBoundingClientRect());
        dragStart.current = { key, x: event.clientX, from, to: from, lefts: rects.map(r => r.left), widths: rects.map(r => r.width), slot: rects[from].width,
            moved: false, order: visible.map(tab => tab.key), first: 0, last: visible.length - 1 };
        const move = (e: PointerEvent) => {
            const start = dragStart.current;
            if (!start) return;
            // Held inside its group: the tab's left edge stops at the group's first slot, its right edge at the last.
            const minDx = start.lefts[start.first] - start.lefts[start.from];
            const maxDx = start.lefts[start.last] + start.widths[start.last] - (start.lefts[start.from] + start.widths[start.from]);
            const dx = Math.min(maxDx, Math.max(minDx, e.clientX - start.x));
            if (!start.moved && Math.abs(e.clientX - start.x) < 4) return;
            // As in Chrome, picking up a tab brings it to the front.
            if (!start.moved && start.key !== activeKey) {
                const tab = visible.find(item => item.key === start.key);
                if (tab) open(tab);
            }
            start.moved = true;
            // Intent follows the direction of travel: moving right, the tab on the right gives way once the
            // dragged tab has slid a fifth of that tab's width past where it started; the same to the left.
            // Each further neighbour adds its width to the distance needed.
            const SWAP = 0.2;
            let to = start.from;
            if (dx > 0) {
                let need = 0;
                for (let i = start.from + 1; i <= start.last; i++) {
                    if (dx < need + start.widths[i] * SWAP) break;
                    to = i;
                    need += start.widths[i];
                }
            } else if (dx < 0) {
                let need = 0;
                for (let i = start.from - 1; i >= start.first; i--) {
                    if (-dx < need + start.widths[i] * SWAP) break;
                    to = i;
                    need += start.widths[i];
                }
            }
            start.to = to;
            setDrag({ key: start.key, dx, from: start.from, to, slot: start.slot });
        };
        const end = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            const start = dragStart.current;
            dragStart.current = undefined;
            setDrag(undefined);
            if (!start?.moved) return;
            suppressClick.current = true;
            // A click event may not follow a drag; don't let a stale flag swallow the next real click.
            window.setTimeout(() => { suppressClick.current = false; }, 0);
            if (start.to !== start.from) dispatch(dfActions.moveCanvasTab({ key: start.key, toKey: start.order[start.to] }));
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    };
    // Where each tab sits while another is dragged past it.
    const dragShift = (index: number): number => {
        if (!drag) return 0;
        if (index === drag.from) return drag.dx;
        if (drag.from < drag.to && index > drag.from && index <= drag.to) return -drag.slot;
        if (drag.to < drag.from && index >= drag.to && index < drag.from) return drag.slot;
        return 0;
    };
    const keepLabel = t('canvas.keepTab', { defaultValue: 'Double-click to keep open' });
    const newLabel = t('canvas.newResult', { defaultValue: 'New, not yet viewed' });
    // "+N more" at the strip's right end, as quiet as an inactive tab: the earlier tabs it holds, newest first.
    const moreLabel = t('canvas.moreTabs', { defaultValue: 'More tabs' });
    const moreTabs = <ButtonBase data-more-tabs aria-label={moreLabel} title={moreLabel} onClick={event => setMenuAnchor(event.currentTarget)}
        // Quieter than the tabs, and kept clear of the canvas box's rounded corner.
        sx={{ alignSelf: 'center', flexShrink: 0, position: 'relative', ml: 0.5, mr: 1.5, mt: '2px', height: 22, px: 0.75,
            borderRadius: '6px', color: 'text.disabled', fontSize: '0.6875rem', whiteSpace: 'nowrap',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.04)', color: 'text.secondary' } }}>
        {t('canvas.moreCount', { defaultValue: '+{{count}} more', count: hidden.length })}
        {hidden.some(tab => tab.unseen) && <Box sx={{ position: 'absolute', top: 0, right: 0, display: 'flex' }}><UnseenDot /></Box>}
    </ButtonBase>;

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
            {visible.map((tab, index) => {
                const isPinned = isCanvasTabPinned(tab);
                const { title, icon } = label(tab.target);
                const active = tab.key === activeKey;
                const dragging = drag?.key === tab.key;
                return <React.Fragment key={tab.key}><ButtonBase component="div" role="tab" aria-selected={active}
                    title={isPinned ? title : `${title}\n${keepLabel}`}
                    data-pinned={isPinned ? 'true' : undefined} data-preview={isPinned ? undefined : 'true'}
                    onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } open(tab); }}
                    onDoubleClick={event => { if (!isPinned && !(event.target as HTMLElement).closest('.tab-close')) dispatch(dfActions.pinCanvasTab(tab.key)); }}
                    onAuxClick={event => { if (event.button === 1) close([tab.key]); }}
                    onPointerDown={event => startDrag(event, tab.key)}
                    disableRipple={!!drag}
                    sx={{
                        position: 'relative', display: 'flex', alignItems: 'center', gap: 0.5, minWidth: TAB_MIN_WIDTH, flex: `0 1 ${TAB_MAX_WIDTH}px`,
                        height: 'calc(100% - 4px)', boxSizing: 'border-box', pl: 0.75, pr: 0.5,
                        borderRadius: '8px 8px 0 0', fontSize: '0.75rem',
                        color: active && isPinned ? 'text.primary' : 'text.secondary', bgcolor: active ? 'background.paper' : 'transparent',
                        border: '1px solid', borderBottom: 0, borderColor: active ? borderColor.view : 'transparent',
                        // As in VS Code, every tab keeps the close slot, so nothing shifts on hover: the active
                        // tab shows its ×, the others show it on hover (an unseen dot holds the slot meanwhile).
                        '& .tab-close': { visibility: active ? 'visible' : 'hidden' },
                        '&:hover .tab-close': { visibility: 'visible' }, '&:hover .tab-dot': { display: 'none' },
                        '&:hover': { color: isPinned ? 'text.primary' : 'text.secondary' },
                        transform: `translateX(${dragShift(index)}px)`,
                        // The grabbed tab tracks the pointer exactly; the ones it passes glide aside.
                        transition: dragging || !drag ? 'none' : 'transform 0.15s ease',
                        ...(dragging ? { zIndex: 2, cursor: 'grabbing', bgcolor: 'background.paper', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' } : {}),
                        ...(drag ? { '&::before': { display: 'none' } } : {}),
                        touchAction: 'none', userSelect: 'none',
                        // A short muted separator between tabs, as in Chrome; not beside the active tab.
                        '&::before': { content: '""', position: 'absolute', left: -1, top: '50%', transform: 'translateY(-50%)',
                            width: '1px', height: 14, bgcolor: 'rgba(0,0,0,0.12)' },
                        '&:first-of-type::before, &[aria-selected="true"]::before, [aria-selected="true"] + &::before': { display: 'none' },
                    }}>
                    <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Box sx={{ display: 'flex', opacity: isPinned ? 0.8 : 0.6, color: tabTone(tab.target), '& svg': { width: 14, height: 14 } }}>{icon}</Box>
                    </Box>
                    {/* A preview tab comes and goes, so it reads as provisional (italic); kept ones are upright. */}
                    <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        fontStyle: isPinned ? 'normal' : 'italic' }}>{title}</Box>
                    <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {tab.unseen && !active && <Box className="tab-dot" sx={{ position: 'absolute', display: 'flex' }}><UnseenDot title={newLabel} /></Box>}
                        <IconButton className="tab-close" size="small" aria-label={t('canvas.closeTab', { defaultValue: 'Close tab' })}
                            onClick={event => { event.stopPropagation(); close([tab.key]); }}
                            sx={{ p: '2px', color: 'text.secondary', opacity: 0.7, '&:hover': { opacity: 1 } }}>
                            <CloseIcon sx={{ fontSize: 12 }} />
                        </IconButton>
                    </Box>
                </ButtonBase></React.Fragment>;
            })}
            {hidden.length > 0 && moreTabs}
        </Box>
        <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            // Same type as the tabs; long titles wrap within a set width.
            slotProps={{ paper: { sx: { maxHeight: 360, width: 280, '& .MuiMenuItem-root': { fontSize: '0.75rem', alignItems: 'flex-start', py: 0.75 } } } }}>
            {hidden.map(tab => {
                const { title, icon } = label(tab.target);
                // As on a tab: × on hover drops it from the list (the menu stays open; it closes with the last one).
                return <MenuItem key={tab.key} dense title={title} onClick={() => { setMenuAnchor(null); open(tab); }}
                    sx={{ '& .menu-tab-close': { visibility: 'hidden' }, '&:hover .menu-tab-close, &.Mui-focusVisible .menu-tab-close': { visibility: 'visible' },
                        '&:hover .menu-tab-dot': { display: 'none' } }}>
                    <ListItemIcon sx={{ minWidth: '24px !important', mt: '2px' }}>
                        <Box sx={{ width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tabTone(tab.target), '& svg': { width: 14, height: 14 } }}>{icon}</Box>
                    </ListItemIcon>
                    <ListItemText primary={title} sx={{ m: 0 }} slotProps={{ primary: { sx: { fontSize: '0.75rem', lineHeight: 1.45,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' } } }} />
                    <Box sx={{ position: 'relative', width: 18, height: 18, ml: 0.5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {tab.unseen && <Box className="menu-tab-dot" sx={{ position: 'absolute', display: 'flex' }}><UnseenDot title={newLabel} /></Box>}
                        <IconButton className="menu-tab-close" size="small" aria-label={t('canvas.closeTab', { defaultValue: 'Close tab' })}
                            onClick={event => {
                                event.stopPropagation();
                                dispatch(dfActions.closeCanvasTabs([tab.key]));
                                if (hidden.length <= 1) setMenuAnchor(null);
                            }}
                            sx={{ p: '2px', color: 'text.secondary', opacity: 0.7, '&:hover': { opacity: 1 } }}>
                            <CloseIcon sx={{ fontSize: 12 }} />
                        </IconButton>
                    </Box>
                </MenuItem>;
            })}
        </Menu>
    </Box>;
};
