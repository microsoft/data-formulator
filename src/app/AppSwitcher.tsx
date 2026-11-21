// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Box, Button, Divider, Link, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import type { DataFormulatorState } from './dfSlice';
import { SPACE_ID, spacePath } from './space';
import { iconVar, textVar } from './layout';
import { ink, weight } from './tokens';

const menuItemSx = { fontSize: textVar.md, minHeight: 34, py: 0.5 };

const shortSpaceName = (name: string, standardName = 'Data Formulator') => {
    const suffix = [` in ${standardName}`, ` with ${standardName}`].find(suffix => name.endsWith(suffix));
    return suffix ? name.slice(0, -suffix.length) : name;
};

/** Data Formulator and the spaces on this server, as places the app-name menu can switch to. */
export interface AppDestination { key: string; name: string; path: string; current: boolean }

export const useAppDestinations = (): AppDestination[] => {
    const spaces = useSelector((state: DataFormulatorState) => state.serverConfig.SPACES);
    const standardName = useSelector((state: DataFormulatorState) => state.serverConfig.STANDARD_APP_NAME);
    return useMemo(() => spaces?.length ? [
        { key: 'app', name: standardName?.trim() || 'Data Formulator', path: '/app', current: !SPACE_ID },
        ...spaces.map(space => ({ key: space.id, name: space.name, path: spacePath(space.id), current: space.id === SPACE_ID })),
    ] : [], [spaces, standardName]);
};

// Each is its own page (a space keeps its sessions apart), so items are plain links: a click loads
// the page, and a modified click opens it in a new tab. The current one goes to its front page.
// Spaces follow the standard app, each named "Space: <name>" with the prefix in a lighter colour.
export const destinationItems = (destinations: AppDestination[], onGoHome: (event: React.MouseEvent) => void, close: () => void) => {
    const item = (destination: AppDestination) => (
        <MenuItem key={destination.key} component="a" href={destination.path} draggable={false} selected={destination.current} sx={menuItemSx}
            aria-label={destination.key === 'app' ? destination.name : `Space: ${shortSpaceName(destination.name)}`}
            onClick={(event: React.MouseEvent) => {
                close();
                if (destination.current) onGoHome(event);
            }}>
            <ListItemIcon>{destination.current ? <CheckIcon fontSize="small" /> : null}</ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: textVar.md }}>
                {destination.key !== 'app' && <Box component="span" sx={{ color: 'text.secondary' }}>Space: </Box>}
                {destination.key === 'app' ? destination.name : shortSpaceName(destination.name)}
            </ListItemText>
        </MenuItem>
    );
    const app = destinations.filter(destination => destination.key === 'app');
    const spaces = destinations.filter(destination => destination.key !== 'app');
    return [
        ...app.map(item),
        ...(app.length && spaces.length ? [<Divider key="spaces-divider" />] : []),
        ...spaces.map(item),
    ];
};

/**
 * The app name; on a server with spaces, a menu to switch between Data Formulator and each space.
 * In a space it reads as a breadcrumb, "Data Formulator / <space>", the first part linking to the app.
 * A space's logo is on its front page only.
 */
export const AppSwitcher: React.FC<{ appName: string; destinations: AppDestination[]; onGoHome: (event: React.MouseEvent) => void; compact?: boolean }> = ({
    appName, destinations, onGoHome, compact,
}) => {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const standard = destinations.find(destination => destination.key === 'app');
    const inSpace = !!standard && !standard.current;
    const nameSx = { fontWeight: weight(400), lineHeight: 1.2, letterSpacing: 0, ...(compact && { fontSize: textVar.xl }) };
    const shown = inSpace ? shortSpaceName(appName, standard.name) : appName;
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {inSpace && !compact && <>
                <Link href={standard.path} color="inherit" underline="none" draggable={false}
                    sx={{ ...nameSx, whiteSpace: 'nowrap', px: 0.75, py: 0.5, borderRadius: 1, flexShrink: 0, '&:hover': { backgroundColor: ink(0.04) } }}>
                    {standard.name}
                </Link>
                <Box component="span" aria-hidden="true" sx={{ ...nameSx, color: 'text.disabled', px: 0.25 }}>/</Box>
            </>}
            <Button color="inherit" onClick={(event) => setAnchorEl(event.currentTarget)} aria-haspopup="menu"
                endIcon={<KeyboardArrowDownIcon sx={{ fontSize: iconVar.md, color: 'text.secondary' }} />}
                sx={{ textTransform: 'none', minWidth: 0, height: compact ? undefined : 36, px: 0.75, gap: 0.25,
                    '& .MuiButton-endIcon': { ml: 0.25 }, '&:hover': { backgroundColor: ink(0.04) } }}>
                <Typography noWrap component="h1" title={appName} sx={{ maxWidth: compact ? { xs: 160, sm: 320 } : 360, ...nameSx }}>
                    {shown}
                </Typography>
            </Button>
            <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}>
                {destinationItems(destinations, onGoHome, () => setAnchorEl(null))}
            </Menu>
        </Box>
    );
};
