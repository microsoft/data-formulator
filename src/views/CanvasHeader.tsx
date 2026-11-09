// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The one header every canvas shares: what is open (type icon, title, a little
 * metadata), the item's own actions and an overflow menu, always in the same
 * places. Under the canvas tab strip the tab carries the title and close, so
 * the header keeps only the view's tools.
 */

import React, { createContext, FC, useContext, useState } from 'react';
import { Box, IconButton, InputBase, Menu, MenuItem, ListItemIcon, ListItemText, Tooltip, Typography } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useTranslation } from 'react-i18next';
import { iconVar } from '../app/layout';

const CANVAS_HEADER_HEIGHT = 40;

/** Supplied by the canvas pane. */
export const CanvasChromeContext = createContext<{
    /** Under the canvas tab strip: the tab shows the title and owns close, so the header is just the view's tools. */
    tabbed?: boolean }>({});

export interface CanvasMenuItem {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
}

export const CanvasHeaderAction: FC<{ label: string; onClick?: (event: React.MouseEvent<HTMLElement>) => void; disabled?: boolean; active?: boolean; children: React.ReactNode }> =
    ({ label, onClick, disabled, active, children }) => <Tooltip title={label}>
        <span>
            <IconButton size="small" aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}
                sx={{ p: '5px', color: active ? 'primary.main' : 'text.secondary', '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
                    '& svg': { fontSize: iconVar.md } }}>
                {children}
            </IconButton>
        </span>
    </Tooltip>;

export const CanvasHeader: FC<{
    /** The item's type icon. */
    icon: React.ReactNode;
    title: string;
    /** Short muted context after the title: a size, a status, a mode. */
    meta?: React.ReactNode;
    /** Rename in place; the pencil appears on hover beside the title. */
    onRename?: (title: string) => void;
    /** Rename through the canvas's own flow (e.g. a dialog that checks file names) instead of in place. */
    onRequestRename?: () => void;
    renameDisabled?: boolean;
    /** The item's own actions (at most a few), before the overflow menu. */
    actions?: React.ReactNode;
    /** Less frequent actions, behind ⋯. */
    menu?: CanvasMenuItem[];
}> = ({ icon, title, meta, onRename, onRequestRename, renameDisabled, actions, menu }) => {
    const { t } = useTranslation();
    const { tabbed } = useContext(CanvasChromeContext);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(title);
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const commit = () => {
        setEditing(false);
        const next = draft.trim();
        if (next && next !== title) onRename?.(next);
    };
    return <Box component="header" data-canvas-header aria-label={tabbed ? title : undefined} sx={{
        display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0, height: tabbed ? 34 : CANVAS_HEADER_HEIGHT, boxSizing: 'border-box',
        // No rule under it: the header is the top of the canvas, not a separate bar.
        pl: 1.5, pr: 0.75, bgcolor: 'background.paper', minWidth: 0,
        '& [data-canvas-rename]': { opacity: 0 }, '&:hover [data-canvas-rename], &:focus-within [data-canvas-rename]': { opacity: 1 },
    }}>
        {!tabbed && <Box component="span" sx={{ display: 'flex', flexShrink: 0, color: 'text.secondary', '& svg': { fontSize: 18 } }}>{icon}</Box>}
        {tabbed && !editing ? null : editing
            ? <InputBase autoFocus value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit}
                inputProps={{ 'aria-label': t('canvas.rename', { defaultValue: 'Rename' }) }}
                onKeyDown={event => {
                    if (event.key === 'Enter') commit();
                    if (event.key === 'Escape') { setDraft(title); setEditing(false); }
                }}
                sx={{ flex: 1, minWidth: 0, fontSize: '0.875rem', fontWeight: 600 }} />
            : <Typography component="h2" title={title} sx={{ minWidth: 0, fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.4,
                color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</Typography>}
        {(onRename || onRequestRename) && !editing && <Box component="span" data-canvas-rename sx={{ display: 'flex', flexShrink: 0, transition: 'opacity 0.15s' }}>
            <CanvasHeaderAction label={t('canvas.rename', { defaultValue: 'Rename' })} disabled={renameDisabled}
                onClick={() => { if (onRequestRename) onRequestRename(); else { setDraft(title); setEditing(true); } }}>
                <EditOutlinedIcon />
            </CanvasHeaderAction>
        </Box>}
        {meta && !editing && <Typography component="span" sx={{ flexShrink: 100, minWidth: 0, fontSize: '0.8125rem', color: 'text.secondary',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</Typography>}
        <Box sx={{ flex: 1, minWidth: 8 }} />
        {actions && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>{actions}</Box>}
        {!!menu?.length && <>
            <CanvasHeaderAction label={t('canvas.more', { defaultValue: 'More' })} onClick={event => setMenuAnchor(event.currentTarget)}>
                <MoreHorizIcon />
            </CanvasHeaderAction>
            <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
                {menu.map(item => <MenuItem key={item.label} disabled={item.disabled} dense
                    onClick={() => { setMenuAnchor(null); item.onClick(); }}>
                    {item.icon && <ListItemIcon sx={{ '& svg': { fontSize: iconVar.md } }}>{item.icon}</ListItemIcon>}
                    <ListItemText slotProps={{ primary: { sx: { fontSize: '0.8125rem' } } }}>{item.label}</ListItemText>
                </MenuItem>)}
            </Menu>
        </>}
    </Box>;
};
