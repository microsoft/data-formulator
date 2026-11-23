// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The open session as the last part of the header's path: its name, and a ⌄ menu to switch to another session (the
 * most recent few, then all of them). What can be done with a session (rename, export, send) is on its row in the
 * session lists.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Button, ButtonBase, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import IosShareOutlinedIcon from '@mui/icons-material/IosShareOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import type { DataFormulatorState } from '../app/dfSlice';
import { listedAsSession, listWorkspaces, onWorkspaceListChanged, type WorkspaceSummary } from '../app/workspaceService';
import { requestWormholeDialog } from '../app/wormholeService';
import { iconVar, textVar } from '../app/layout';
import { WORMHOLE_RECEIVE_COLOR, WORMHOLE_SEND_COLOR, WormholeReceiveIcon, WormholeSendIcon } from '../icons';
import { ink, weight } from '../app/tokens';
import { AllSessions, useSessionActions } from './AllSessions';

const RECENT = 3;
const itemSx = { fontSize: textVar.md, minHeight: 34, py: 0.5 };

const lastUsed = (session: WorkspaceSummary) => session.saved_at || session.created_at || '';
const recentFirst = (a: WorkspaceSummary, b: WorkspaceSummary) => lastUsed(b).localeCompare(lastUsed(a));
const when = (session: WorkspaceSummary) => {
    const date = new Date(lastUsed(session));
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export const SessionMenu: React.FC = () => {
    const { t } = useTranslation();
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [sessions, setSessions] = useState<WorkspaceSummary[]>([]);
    const openAll = useRef<() => void>(() => undefined);
    const nameRef = useRef<HTMLElement | null>(null);
    const [overflowing, setOverflowing] = useState(false);
    useLayoutEffect(() => {
        const element = nameRef.current;
        if (!element) return;
        const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1);
        measure();
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
        observer?.observe(element);
        return () => observer?.disconnect();
    });
    const refresh = useCallback(() => {
        listWorkspaces().then(setSessions).catch(() => { /* the list is best-effort */ });
    }, []);
    useEffect(() => {
        if (!anchor) return;
        refresh();
        return onWorkspaceListChanged(refresh);
    }, [anchor, refresh]);
    const actions = useSessionActions(setSessions, refresh);
    if (!activeWorkspace) return null;

    const name = activeWorkspace.displayName || activeWorkspace.id;
    const others = sessions.filter(s => s.id !== activeWorkspace.id && listedAsSession(s)).sort(recentFirst).slice(0, RECENT);
    const choose = (run: () => void) => () => { setAnchor(null); run(); };

    return <>
        <Tooltip describeChild title={t('workspace.sessionTooltip', { name: activeWorkspace.id })} placement="bottom">
            <ButtonBase disableRipple aria-haspopup="menu" aria-expanded={!!anchor} onClick={event => setAnchor(event.currentTarget)}
                sx={{
                    display: 'flex', alignItems: 'center', gap: 0.5, textAlign: 'left', minWidth: 0, maxWidth: '100%', borderRadius: 1,
                    px: 0.75, height: 36,
                    // Quieter than the places before it (smaller, grey), darkening on hover: where you are reads first.
                    color: 'text.secondary', '&:hover': { backgroundColor: ink(0.04), color: 'text.primary' },
                    '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' },
                }}>
                {/* A long name fades out rather than ending in "…". */}
                <Typography ref={nameRef} noWrap sx={{ fontSize: textVar.md, fontWeight: weight(400), lineHeight: 1.2, letterSpacing: 0, minWidth: 0,
                    color: 'inherit', maxWidth: 280, textOverflow: 'clip',
                    ...(overflowing && { maskImage: 'linear-gradient(to right, #000 calc(100% - 28px), transparent)' }) }}>
                    {name}
                </Typography>
                <KeyboardArrowDownIcon sx={{ fontSize: iconVar.md, color: 'inherit', flexShrink: 0 }} />
            </ButtonBase>
        </Tooltip>
        <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{ paper: { sx: { minWidth: 260, maxWidth: 360 } } }}>
            {others.map(session => <MenuItem key={session.id} sx={itemSx} onClick={choose(() => void actions.open(session.id, session.display_name))}>
                <ListItemText primary={session.display_name || session.id} secondary={when(session)}
                    primaryTypographyProps={{ fontSize: textVar.md, noWrap: true, title: session.display_name || session.id }}
                    secondaryTypographyProps={{ fontSize: textVar.xs }} />
            </MenuItem>)}
            {others.length > 0 && <Divider />}
            <MenuItem sx={itemSx} onClick={choose(() => openAll.current())}>
                <ListItemText primaryTypographyProps={{ fontSize: textVar.md }}>{t('workspace.allSessions', { defaultValue: 'All sessions…' })}</ListItemText>
            </MenuItem>
        </Menu>
        <AllSessions trigger={open => { openAll.current = open; return null; }} />
    </>;
};

/** What can be shared from the open session: send it to another computer (wormhole), export it, or receive one. */
export const useSessionShareItems = () => {
    const { t } = useTranslation();
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const wormhole = useSelector((state: DataFormulatorState) => state.serverConfig?.SESSION_WORMHOLE_AVAILABLE === true);
    const noop = useCallback(() => undefined, []);
    const { exportSession } = useSessionActions(noop as React.Dispatch<React.SetStateAction<WorkspaceSummary[]>>, noop);
    if (!activeWorkspace) return [];
    const name = activeWorkspace.displayName || activeWorkspace.id;
    const saved = !activeWorkspace.provisional;
    const editable = saved && !activeWorkspace.readOnly;
    // The wormhole's own icons, in their colours; downloading a file comes last.
    return [
        ...(wormhole && editable ? [{ key: 'send', label: t('workspace.shareViaWormhole', { defaultValue: 'Share via wormhole' }),
            icon: <WormholeSendIcon fontSize="small" sx={{ color: WORMHOLE_SEND_COLOR }} />,
            onClick: () => requestWormholeDialog({ kind: 'send', workspaceId: activeWorkspace.id, displayName: name }) }] : []),
        ...(wormhole ? [{ key: 'receive', label: t('workspace.receiveViaWormhole', { defaultValue: 'Receive via wormhole' }),
            icon: <WormholeReceiveIcon fontSize="small" sx={{ color: WORMHOLE_RECEIVE_COLOR }} />,
            onClick: () => requestWormholeDialog({ kind: 'receive' }) }] : []),
        ...(saved ? [{ key: 'export', label: t('workspace.downloadSession', { defaultValue: 'Download session file' }), divided: wormhole,
            icon: <DownloadOutlinedIcon fontSize="small" />, onClick: () => void exportSession(activeWorkspace.id, name) }] : []),
    ];
};

/** The header's Share button, last of its icons in a session and as quiet as they are: about this session, as the
 *  canvas's share is about an item. */
export const SessionShareButton: React.FC = () => {
    const { t } = useTranslation();
    const items = useSessionShareItems();
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    if (!items.length) return null;
    return <>
        <Button size="small" variant="text" aria-haspopup="menu" aria-expanded={!!anchor} onClick={event => setAnchor(event.currentTarget)}
            startIcon={<IosShareOutlinedIcon fontSize="small" />}
            sx={{ textTransform: 'none', fontSize: textVar.sm, fontWeight: weight(400), px: 0.75, py: 0.5, minWidth: 'auto', lineHeight: 1.5,
                color: 'text.secondary', '& .MuiButton-startIcon': { mr: 0.5, ml: 0 },
                '&:hover': { color: 'text.primary', backgroundColor: ink(0.04) } }}>
            {t('workspace.share', { defaultValue: 'Share' })}
        </Button>
        <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
            {items.flatMap(item => [
                ...('divided' in item && item.divided ? [<Divider key={`${item.key}-divider`} />] : []),
                <MenuItem key={item.key} sx={itemSx} onClick={() => { setAnchor(null); item.onClick(); }}>
                    <ListItemIcon>{item.icon}</ListItemIcon>
                    <ListItemText primaryTypographyProps={{ fontSize: textVar.md }}>{item.label}</ListItemText>
                </MenuItem>,
            ])}
        </Menu>
    </>;
};
