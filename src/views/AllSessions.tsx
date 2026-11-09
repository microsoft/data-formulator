// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Every session in a searchable dialog, behind a trigger each place draws its own way (`AllSessions`): the sidebar's
 * "View all sessions" and the session name in the top bar. Also the pieces the sidebar's session list shares with
 * it: day grouping, compact times, sorting, and the actions on a session (`useSessionActions`).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, InputAdornment, TextField, Tooltip,
    Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import SearchIcon from '@mui/icons-material/Search';
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import i18n from '../i18n';
import { AppDispatch } from '../app/store';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { iconVar, textVar } from '../app/layout';
import { openSession, renameSession } from '../app/sessionThunks';
import { openSessionInNewTab } from '../app/sessionTabs';
import { requestWormholeDialog } from '../app/wormholeService';
import { deleteWorkspace, exportWorkspace, listWorkspaces, onWorkspaceListChanged, setWorkspaceStarred,
    type WorkspaceSummary } from '../app/workspaceService';
import { ItemCard, ItemCardAction, itemCardGridSx, StarAction, starredColor } from '../components/ItemCard';
import { useProgressiveCount } from '../components/useProgressiveCount';
import { WormholeReceiveIcon, WormholeSendIcon } from '../icons';

// Compact relative time for sidebar rows: "2m", "3h", "yesterday",
// "May 5", "May 5, 24". Designed to stay <= ~10 chars so it fits in
// the narrow sidebar without truncating session names.
export function formatCompactTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const then = new Date(iso);
    const ts = then.getTime();
    if (Number.isNaN(ts)) return '';
    const now = Date.now();
    const diffSec = Math.max(0, Math.round((now - ts) / 1000));
    if (diffSec < 60) return i18n.t('sidebar.timeJustNow');
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return i18n.t('sidebar.timeMinutes', { count: diffMin });
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return i18n.t('sidebar.timeHours', { count: diffHr });
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((startOfToday.getTime() - then.getTime()) / 86400000) + 1;
    if (diffDays === 1) return i18n.t('sidebar.timeYesterday');
    if (diffDays < 7) return i18n.t('sidebar.timeDays', { count: diffDays });
    const sameYear = then.getFullYear() === new Date().getFullYear();
    return then.toLocaleDateString(undefined, sameYear
        ? { month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', year: '2-digit' });
}

export type SessionDateGroup = 'today' | 'yesterday' | 'week' | 'month' | 'older';

export function sessionDateGroup(iso: string | null | undefined): SessionDateGroup {
    const ts = iso ? new Date(iso).getTime() : NaN;
    if (Number.isNaN(ts)) return 'older';
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const days = Math.floor((startOfToday.getTime() - ts) / 86400000) + 1;
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? 'week' : days < 30 ? 'month' : 'older';
}

export const sessionGroupLabelsFor = (t: TFunction): Record<SessionDateGroup, string> => ({
    today: t('sidebar.groupToday', { defaultValue: 'Today' }),
    yesterday: t('sidebar.groupYesterday', { defaultValue: 'Yesterday' }),
    week: t('sidebar.groupWeek', { defaultValue: 'Previous 7 days' }),
    month: t('sidebar.groupMonth', { defaultValue: 'Previous 30 days' }),
    older: t('sidebar.groupOlder', { defaultValue: 'Older' }),
});

export const sessionGroupHeaderSx = { m: 0, pb: 0.5, fontSize: textVar.xxs, fontWeight: 600, letterSpacing: '0.04em',
    textTransform: 'uppercase', color: 'text.disabled' } as const;

/**
 * All sessions in a searchable dialog. With `groupTime`, sessions (already sorted by that time)
 * fall under day ranges; without it (name order) they render as one grid. A star button filters to starred
 * sessions once any session is starred; `starredOnly` opens with it on.
 */
export const SessionsDialog: React.FC<{ open: boolean; onClose: () => void; title: string; sessions: WorkspaceSummary[];
    groupTime?: (session: WorkspaceSummary) => string | null | undefined; renderCard: (session: WorkspaceSummary) => React.ReactNode;
    starredOnly?: boolean; loading?: boolean }>
    = ({ open, onClose, title, sessions, groupTime, renderCard, starredOnly: initialStarredOnly = false, loading = false }) => {
    const { t } = useTranslation();
    const wormholeAvailable = useSelector((state: DataFormulatorState) => state.serverConfig?.SESSION_WORMHOLE_AVAILABLE === true);
    const [query, setQuery] = useState('');
    const [starredOnly, setStarredOnly] = useState(initialStarredOnly);
    useEffect(() => { if (open) setStarredOnly(initialStarredOnly); }, [open, initialStarredOnly]);
    const anyStarred = sessions.some(s => s.starred);
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = sessions.filter(s => (!starredOnly || !anyStarred || s.starred)
        && terms.every(term => `${s.display_name} ${s.scheduled_run?.scheduleName ?? ''}`.toLowerCase().includes(term)));
    const labels = sessionGroupLabelsFor(t);
    // Cards are built only while the dialog shows (including its closing transition), not on every sidebar render.
    const [shown, setShown] = useState(open);
    if (open && !shown) setShown(true);
    // Hundreds of cards would make opening and closing the dialog crawl; render them as the user scrolls.
    const { count, sentinel } = useProgressiveCount(matches.length, { initial: 36, step: 36, resetKey: `${shown}|${starredOnly}|${query}` });
    const groups = (shown ? matches.slice(0, count) : []).reduce<{ group: SessionDateGroup | null; sessions: WorkspaceSummary[] }[]>((all, s) => {
        const group = groupTime ? sessionDateGroup(groupTime(s)) : null;
        const last = all[all.length - 1];
        if (last && last.group === group) last.sessions.push(s);
        else all.push({ group, sessions: [s] });
        return all;
    }, []);
    return <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth aria-labelledby="all-sessions-title"
        slotProps={{ paper: { sx: { height: 'min(720px, 85vh)' } }, transition: { onExited: () => { setQuery(''); setShown(false); } } }}>
        <DialogTitle id="all-sessions-heading" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, fontSize: textVar.lg, fontWeight: 600 }}>
            <Box component="span" id="all-sessions-title">{title}</Box>
            {/* A received session lands in this list, so the dialog stays open behind the wormhole one. */}
            {wormholeAvailable && <Tooltip title={t('wormhole.receiveTooltip')}>
                <IconButton size="small" aria-label={t('wormhole.receiveTooltip')} onClick={() => requestWormholeDialog({ kind: 'receive' })}
                    sx={{ color: 'text.secondary', ml: -1 }}>
                    <WormholeReceiveIcon sx={{ fontSize: iconVar.lg }} />
                </IconButton>
            </Tooltip>}
            <Box sx={{ flex: 1 }} />
            {anyStarred && <Tooltip title={t('workspace.starredOnly', { defaultValue: 'Starred only' })}>
                <IconButton size="small" aria-pressed={starredOnly} aria-label={t('workspace.starredOnly', { defaultValue: 'Starred only' })}
                    onClick={() => setStarredOnly(value => !value)} sx={{ color: starredOnly ? starredColor : 'text.disabled' }}>
                    {starredOnly ? <StarRoundedIcon sx={{ fontSize: iconVar.lg }} /> : <StarBorderRoundedIcon sx={{ fontSize: iconVar.lg }} />}
                </IconButton>
            </Tooltip>}
            <TextField size="small" value={query} onChange={event => setQuery(event.target.value)}
                placeholder={t('sidebar.searchSessions', { defaultValue: 'Search sessions' })}
                slotProps={{ htmlInput: { 'aria-label': t('sidebar.searchSessions', { defaultValue: 'Search sessions' }) },
                    input: { startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: iconVar.md, color: 'text.disabled' }} /></InputAdornment> } }}
                sx={{ width: 260, '& .MuiInputBase-root': { fontSize: textVar.sm } }} />
            <IconButton size="small" aria-label={t('common.close', { defaultValue: 'Close' })} onClick={onClose}>
                <CloseIcon sx={{ fontSize: iconVar.md }} />
            </IconButton>
        </DialogTitle>
        <DialogContent dividers>
            {loading && sessions.length === 0
                ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                    <CircularProgress size={16} thickness={4} aria-label={t('app.loading', { defaultValue: 'Loading...' })} sx={{ color: 'text.disabled' }} />
                </Box>
                : matches.length === 0
                ? <Typography sx={{ py: 4, textAlign: 'center', fontSize: textVar.sm, color: 'text.disabled' }}>
                    {t('sidebar.noMatchingSessions', { defaultValue: 'No matching sessions' })}</Typography>
                : groups.map(({ group, sessions: groupSessions }, groupIndex) => <Box component="section" key={group ?? 'all'}
                    aria-label={group ? labels[group] : undefined} sx={{ mt: groupIndex === 0 ? 0 : 2.5 }}>
                    {group && <Typography component="h3" sx={sessionGroupHeaderSx}>{labels[group]}</Typography>}
                    <Box sx={itemCardGridSx}>{groupSessions.map(renderCard)}</Box>
                </Box>)}
            {sentinel}
        </DialogContent>
    </Dialog>;
};

// ── Sorting ──────────────────────────────────────────────────────────────────

/** Creation order by default, so auto-saves do not move older sessions; modified time is an explicit choice. */
export type SessionSortKey = 'created_desc' | 'created_asc' | 'updated_desc' | 'name_asc';

export function sortSessions(sessions: WorkspaceSummary[], sort: SessionSortKey): WorkspaceSummary[] {
    const cmpDate = (a: string | null | undefined, b: string | null | undefined): number => {
        if (!a && !b) return 0;
        if (!a) return 1;
        if (!b) return -1;
        return a.localeCompare(b);
    };
    const copy = [...sessions];
    switch (sort) {
        case 'created_desc': return copy.sort((a, b) => cmpDate(b.created_at, a.created_at));
        case 'created_asc': return copy.sort((a, b) => cmpDate(a.created_at, b.created_at));
        case 'updated_desc': return copy.sort((a, b) =>
            cmpDate(b.saved_at || b.created_at, a.saved_at || a.created_at) || cmpDate(b.created_at, a.created_at));
        case 'name_asc': return copy.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
        default: return copy;
    }
}

/** The time a sort orders by; time sorts group under day ranges, name order keeps a stamp per session. */
export const sessionTimeFor = (sort: SessionSortKey) => (s: WorkspaceSummary) =>
    sort === 'created_desc' || sort === 'created_asc' ? s.created_at : (s.saved_at || s.created_at);

export const sessionCountsText = (t: TFunction, s: WorkspaceSummary) => [
    s.table_count != null ? t('sidebar.tableCount', { count: s.table_count }) : '',
    s.chart_count ? t('sidebar.chartCount', { count: s.chart_count }) : '',
].filter(Boolean).join(' · ');

export const SessionBadges: React.FC<{ session: WorkspaceSummary }> = ({ session }) => <>
    {session.scheduled_run && !session.scheduled_run.forked && <Box component="span" role="img" aria-label="Scheduled"
        sx={{ display: 'inline-flex', verticalAlign: 'middle', color: 'text.disabled', flexShrink: 0, ml: 0.5 }}>
        <ScheduleOutlinedIcon sx={{ fontSize: 13 }} />
    </Box>}
</>;

// ── Actions ──────────────────────────────────────────────────────────────────

/** Open, star, rename, export and delete a session, for a list kept in `setSessions` (changed at once; `refresh`
 *  restores it when the server refuses). Deleting the open session opens the next one, or leaves for the landing
 *  page when none is left. */
export function useSessionActions(setSessions: React.Dispatch<React.SetStateAction<WorkspaceSummary[]>>, refresh: () => void) {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const error = useCallback((value: string) => dispatch(dfActions.addMessages({
        timestamp: Date.now(), type: 'error', component: 'data-source-sidebar', value })), [dispatch]);

    const open = useCallback(async (sessionId: string, metaDisplayName?: string) => {
        await dispatch(openSession(sessionId, metaDisplayName));
    }, [dispatch]);

    const rename = useCallback(async (id: string, next: string) => {
        setSessions(prev => prev.map(s => (s.id === id ? { ...s, display_name: next } : s)));
        try {
            await dispatch(renameSession(id, next));
        } catch {
            error(t('sidebar.failedRenameSession'));
            refresh();
        }
    }, [dispatch, error, refresh, setSessions, t]);

    const toggleStar = useCallback(async (session: WorkspaceSummary) => {
        const starred = !session.starred;
        setSessions(prev => prev.map(s => (s.id === session.id ? { ...s, starred } : s)));
        try {
            await setWorkspaceStarred(session.id, starred);
        } catch {
            error(t('workspace.starFailed'));
            refresh();
        }
    }, [error, refresh, setSessions, t]);

    const exportSession = useCallback(async (id: string, displayName: string) => {
        try {
            const blob = await exportWorkspace(id);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${displayName || id}.zip`;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch {
            error(t('sidebar.exportFailed'));
        }
    }, [error, t]);

    const remove = useCallback(async (sessionId: string) => {
        try {
            await deleteWorkspace(sessionId);
            setSessions(prev => {
                const updated = prev.filter(s => s.id !== sessionId);
                // Deleting the open session switches to the next one up the list.
                if (activeWorkspace?.id === sessionId) {
                    const deletedIndex = prev.findIndex(s => s.id === sessionId);
                    const nextSession = updated[Math.min(deletedIndex, updated.length - 1)];
                    if (nextSession) void open(nextSession.id, nextSession.display_name);
                    else dispatch(dfActions.resetState());
                }
                return updated;
            });
            dispatch(dfActions.addMessages({ timestamp: Date.now(), type: 'success', component: 'data source sidebar',
                value: t('sidebar.sessionDeleted') }));
        } catch {
            error(t('sidebar.failedDeleteSession'));
        }
    }, [activeWorkspace, dispatch, error, open, setSessions, t]);

    return { open, rename, toggleStar, exportSession, remove };
}

// ── All sessions ─────────────────────────────────────────────────────────────

/** Every session in a dialog, opened by the caller's own `trigger`; it fetches the list when it opens, in `sort`'s
 *  order. */
export const AllSessions: React.FC<{ trigger: (open: () => void) => React.ReactNode; sort?: SessionSortKey }>
    = ({ trigger, sort = 'created_desc' }) => {
    const { t } = useTranslation();
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const wormholeAvailable = useSelector((state: DataFormulatorState) => state.serverConfig?.SESSION_WORMHOLE_AVAILABLE === true);
    const [open, setOpen] = useState(false);
    const [sessions, setSessions] = useState<WorkspaceSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const refresh = useCallback(() => {
        setLoading(true);
        listWorkspaces().then(setSessions).catch(() => { /* the list is best-effort */ }).finally(() => setLoading(false));
    }, []);
    useEffect(() => {
        if (!open) return;
        refresh();
        return onWorkspaceListChanged(refresh);
    }, [open, refresh]);
    const actions = useSessionActions(setSessions, refresh);
    const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
    const commitRename = () => {
        const current = renaming && sessions.find(s => s.id === renaming.id);
        const next = renaming?.draft.trim();
        setRenaming(null);
        if (current && next && next !== current.display_name) void actions.rename(current.id, next);
    };
    const sorted = useMemo(() => sortSessions(sessions, sort), [sessions, sort]);
    const grouped = sort !== 'name_asc';
    const sessionTime = sessionTimeFor(sort);
    const close = () => { setRenaming(null); setOpen(false); };

    return <>
        {trigger(() => setOpen(true))}
        <SessionsDialog open={open} onClose={close} loading={loading}
            title={t('sidebar.sessions', { defaultValue: 'Sessions' })} sessions={sorted}
            groupTime={grouped ? sessionTime : undefined}
            renderCard={s => {
                const isCurrent = activeWorkspace?.id === s.id;
                return <ItemCard key={s.id}
                    titleLines={2}
                    title={s.display_name}
                    starred={s.starred}
                    current={isCurrent}
                    onOpen={() => { close(); void actions.open(s.id, s.display_name); }}
                    onOpenInNewTab={() => openSessionInNewTab(s.id)}
                    rename={renaming?.id === s.id ? { value: renaming.draft, label: t('sidebar.rename', { defaultValue: 'Rename' }),
                        onChange: draft => setRenaming({ id: s.id, draft }), onCommit: commitRename,
                        onCancel: () => setRenaming(null) } : undefined}
                    badges={<SessionBadges session={s} />}
                    captions={[isCurrent ? t('sidebar.currentSession') : '', sessionCountsText(t, s),
                        grouped ? '' : formatCompactTime(sessionTime(s))]}
                    actions={(!s.read_only || !isCurrent) ? <>
                        {!isCurrent && <ItemCardAction label={t('sidebar.openInNewTab', { defaultValue: 'Open in new tab' })}
                            icon={<OpenInNewIcon />} onClick={() => openSessionInNewTab(s.id)} />}
                        {!s.read_only && <>
                            <StarAction starred={!!s.starred} onToggle={() => void actions.toggleStar(s)} />
                            <ItemCardAction label={t('sidebar.rename', { defaultValue: 'Rename' })} icon={<EditIcon />}
                                onClick={() => setRenaming({ id: s.id, draft: s.display_name })} />
                            <ItemCardAction label={t('sidebar.exportSession', { defaultValue: 'Export' })} icon={<DownloadIcon />}
                                onClick={() => void actions.exportSession(s.id, s.display_name)} />
                            {wormholeAvailable && <ItemCardAction label={t('wormhole.send')} icon={<WormholeSendIcon />}
                                onClick={() => requestWormholeDialog({ kind: 'send', workspaceId: s.id, displayName: s.display_name })} />}
                            <ItemCardAction danger label={t('workspace.deleteSession')} icon={<DeleteIcon />}
                                onClick={() => void actions.remove(s.id)} />
                        </>}
                    </> : undefined} />;
            }} />
    </>;
};
