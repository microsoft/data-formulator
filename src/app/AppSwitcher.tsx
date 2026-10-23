// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Box, Button, Link, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import type { DataFormulatorState } from './dfSlice';
import { DEMO_ID } from './demo';
import { iconVar, textVar } from './layout';

const menuItemSx = { fontSize: textVar.md, minHeight: 34, py: 0.5 };

/** Data Formulator and the demos on this server, as places the app-name menu can switch to. */
export interface AppDestination { key: string; name: string; path: string; current: boolean }

export const useAppDestinations = (): AppDestination[] => {
    const demos = useSelector((state: DataFormulatorState) => state.serverConfig.DEMOS);
    const standardName = useSelector((state: DataFormulatorState) => state.serverConfig.STANDARD_APP_NAME);
    return useMemo(() => demos?.length ? [
        { key: 'app', name: standardName?.trim() || 'Data Formulator', path: '/app', current: !DEMO_ID },
        ...demos.map(demo => ({ key: demo.id, name: demo.name, path: `/demo/${demo.id}`, current: demo.id === DEMO_ID })),
    ] : [], [demos, standardName]);
};

// Each is its own page (a demo keeps its sessions apart), so items are plain links: a click loads
// the page, and a modified click opens it in a new tab. The current one goes to its front page.
export const destinationItems = (destinations: AppDestination[], onGoHome: (event: React.MouseEvent) => void, close: () => void) =>
    destinations.map(destination => (
        <MenuItem key={destination.key} component="a" href={destination.path} draggable={false} selected={destination.current} sx={menuItemSx}
            aria-label={destination.key === 'app' ? destination.name : `Demo: ${destination.name}`}
            onClick={(event: React.MouseEvent) => {
                close();
                if (destination.current) onGoHome(event);
            }}>
            <ListItemIcon>{destination.current ? <CheckIcon fontSize="small" /> : null}</ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: textVar.md }}>
                {destination.key !== 'app' && <Box component="span" sx={{ color: 'text.secondary' }}>Demo: </Box>}
                {destination.name}
            </ListItemText>
        </MenuItem>
    ));

/**
 * The app name; on a server with demos, a menu to switch between Data Formulator and each demo.
 * In a demo it reads as a breadcrumb, "Data Formulator / <demo>", the first part linking to the app.
 */
export const AppSwitcher: React.FC<{ appName: string; destinations: AppDestination[]; onGoHome: (event: React.MouseEvent) => void; compact?: boolean }> = ({
    appName, destinations, onGoHome, compact,
}) => {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const standard = destinations.find(destination => destination.key === 'app');
    const inDemo = !!standard && !standard.current;
    const nameSx = { fontWeight: 400, lineHeight: 1.2, letterSpacing: 0, ...(compact && { fontSize: textVar.xl }) };
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {inDemo && !compact && <>
                <Link href={standard.path} color="inherit" underline="none" draggable={false}
                    sx={{ ...nameSx, whiteSpace: 'nowrap', px: 0.75, py: 0.5, borderRadius: 1, flexShrink: 0, '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.04)' } }}>
                    {standard.name}
                </Link>
                <Box component="span" aria-hidden="true" sx={{ ...nameSx, color: 'text.disabled', px: 0.25 }}>/</Box>
            </>}
            <Button color="inherit" onClick={(event) => setAnchorEl(event.currentTarget)} aria-haspopup="menu"
                endIcon={<KeyboardArrowDownIcon sx={{ fontSize: iconVar.md, color: 'text.secondary' }} />}
                sx={{ textTransform: 'none', minWidth: 0, height: compact ? undefined : 36, px: 0.75, gap: 0.25,
                    '& .MuiButton-endIcon': { ml: 0.25 }, '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.04)' } }}>
                <Typography noWrap component="h1" title={appName} sx={{ maxWidth: compact ? { xs: 160, sm: 320 } : 360, ...nameSx }}>
                    {appName}
                </Typography>
            </Button>
            <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}>
                {destinationItems(destinations, onGoHome, () => setAnchorEl(null))}
            </Menu>
        </Box>
    );
};
