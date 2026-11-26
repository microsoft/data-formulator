// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useState } from 'react';
import { Box, ButtonBase, CircularProgress, Collapse, Tooltip, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { textVar } from '../app/layout';
import { quietText } from '../app/tokens';

/**
 * A quiet thread row for something that happened rather than something said: a run stopped, background tasks ended,
 * the app repairing an app. An icon (a spinner while `live`), a label, an optional note after it; details that open
 * on click, or else an action on click.
 */
export const ThreadEventRow: React.FC<{
    icon: React.ReactNode;
    label: string;
    live?: boolean;
    note?: React.ReactNode;
    hint?: string;
    onClick?: () => void;
    children?: React.ReactNode;
    defaultExpanded?: boolean;
    'data-event'?: string;
}> = ({ icon, label, live = false, note, hint, onClick, children, defaultExpanded = false, 'data-event': event }) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const expandable = children != null && children !== false;
    const interactive = expandable || !!onClick;
    const textSx = { fontSize: textVar.xxs, ...quietText } as const;
    const content = <>
        {expandable && <ChevronRightIcon sx={{ width: 10, height: 10, flexShrink: 0, transform: expanded ? 'rotate(90deg)' : undefined }} />}
        <Box component="span" sx={{ display: 'flex', flexShrink: 0, '& svg': { width: 11, height: 11 } }}>
            {live ? <CircularProgress size={8} color="inherit" /> : icon}
        </Box>
        <Typography component="span" sx={{ minWidth: 0, ...textSx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
        </Typography>
        {note != null && <Typography component="span" sx={{ flexShrink: 0, fontSize: textVar.xxs, color: 'text.disabled', whiteSpace: 'nowrap' }}>
            {note}
        </Typography>}
    </>;
    const rowSx = { display: 'flex', alignItems: 'center', width: '100%', minWidth: 0, justifyContent: 'flex-start', gap: 0.5, py: '2px',
        color: 'text.secondary', textAlign: 'left' } as const;
    const row = interactive
        ? <ButtonBase onClick={expandable ? () => setExpanded(previous => !previous) : onClick} aria-expanded={expandable ? expanded : undefined}
            aria-label={label} sx={{ ...rowSx, '&:hover': { bgcolor: 'action.hover' },
                '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>{content}</ButtonBase>
        : <Box sx={rowSx}>{content}</Box>;
    return <Box data-thread-event={event} sx={{ width: '100%', minWidth: 0 }}>
        {hint ? <Tooltip title={hint} placement="right"><Box>{row}</Box></Tooltip> : row}
        {expandable && <Collapse in={expanded} unmountOnExit>
            <Box sx={{ pl: 1.75, minWidth: 0 }}>{children}</Box>
        </Collapse>}
    </Box>;
};
