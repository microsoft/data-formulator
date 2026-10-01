// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Saved-session card shared by the landing page grid and the agent's session
 * panel: a one-line name, small caption lines, and hover-revealed icon actions.
 */

import React from 'react';
import { Box, Card, CardContent, IconButton, TextField, Tooltip, Typography } from '@mui/material';
import { iconVar, textVar } from '../app/layout';

/** Grid for session cards: as many ~220px columns as fit. */
export const sessionCardGridSx = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
    gap: 1.5,
} as const;

/** Muted icon action used in a card's hover toolbar. */
export const SessionCardAction: React.FC<{ label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }> = ({ label, icon, onClick, disabled }) =>
    <Tooltip title={label}><span>
        <IconButton size="small" aria-label={label} disabled={disabled} sx={{ p: 0.5, color: 'text.secondary', '& .MuiSvgIcon-root': { fontSize: iconVar.md } }}
            onClick={event => { event.stopPropagation(); onClick(); }}>{icon}</IconButton>
    </span></Tooltip>;

export interface SessionCardProps {
    name: React.ReactNode;
    /** Small caption lines under the name (dates, counts, notes). */
    captions?: React.ReactNode[];
    /** Inline rename editor; replaces the name while present. */
    rename?: { value: string; label: string; onChange: (value: string) => void; onCommit: () => void; onCancel: () => void };
    actions?: React.ReactNode;
    onOpen?: () => void;
    /** Dimmed and inert, e.g. after deletion. */
    inactive?: boolean;
}

export const SessionCard: React.FC<SessionCardProps> = ({ name, captions = [], rename, actions, onOpen, inactive = false }) => {
    const clickable = !!onOpen && !rename && !inactive;
    return <Card variant="outlined" onClick={clickable ? onOpen : undefined} sx={{
        position: 'relative', textAlign: 'left', cursor: clickable ? 'pointer' : 'default', opacity: inactive ? 0.55 : 1,
        '&:hover': clickable ? { transform: 'translateY(-2px)', backgroundColor: 'action.hover' } : {},
        '&:hover .session-card-actions, &:focus-within .session-card-actions': { opacity: 1 },
        '@media (hover: none)': { '& .session-card-actions': { opacity: 1 } },
    }}>
        <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
            {rename ? <TextField autoFocus fullWidth variant="standard" value={rename.value}
                onChange={event => rename.onChange(event.target.value)} onClick={event => event.stopPropagation()}
                onBlur={rename.onCommit}
                onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); rename.onCommit(); }
                    else if (event.key === 'Escape') { event.preventDefault(); rename.onCancel(); }
                }}
                slotProps={{ htmlInput: { 'aria-label': rename.label, maxLength: 120 }, input: { sx: { fontSize: textVar.sm } } }} />
                : <Typography variant="body2" fontWeight={400} noWrap sx={{ color: 'text.primary', pr: actions ? 8 : 0,
                    textDecoration: inactive ? 'line-through' : 'none' }}>{name}</Typography>}
            {captions.filter(Boolean).map((caption, index) => <Typography key={index} variant="caption" component="div"
                color="text.disabled" sx={{ fontSize: textVar.xs, overflowWrap: 'anywhere' }}>{caption}</Typography>)}
        </CardContent>
        {actions && !rename && !inactive && <Box className="session-card-actions" sx={{ position: 'absolute', top: 2, right: 2,
            display: 'flex', alignItems: 'center', opacity: 0, transition: 'opacity 0.15s' }}>{actions}</Box>}
    </Card>;
};
