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

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "NeurIPS in Data Formulator", "Dataverse with Data Formulator", "Lattice ❤️ Data Formulator": the logo already says
// Data Formulator, so the path shows only the space's own part.
const shortSpaceName = (name: string, standardName = 'Data Formulator') => {
    const short = name.replace(new RegExp(`\\s+(?:in|with|for|on|\\S{1,3})\\s+${escapeRegExp(standardName)}$`, 'iu'), '');
    return short.trim() ? short : name;
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

/** The "/" between the parts of the header's path. */
export const PathSlash: React.FC<{ compact?: boolean }> = ({ compact }) => (
    <Box component="span" aria-hidden="true" sx={{ fontWeight: weight(400), lineHeight: 1.2, color: 'text.disabled', px: 0.25, flexShrink: 0,
        ...(compact && { fontSize: textVar.xl }) }}>/</Box>
);

/**
 * The app's and space's parts of the header's path, after Data Formulator's logo: "Data Formulator / <space logo>
 * <space>" in a space; when the whole path does not fit (``spellOut`` false) or the toolbar is narrow, the logo stands
 * for Data Formulator: "/ <space logo> <space>". An earlier part goes back to its
 * level; the last part (with ⌄) opens a menu of the alternatives at its level, here Data Formulator and each space.
 * With a session open, the session is the last part (App.tsx), so this is a link back to the front page.
 */
export const AppSwitcher: React.FC<{ appName: string; destinations: AppDestination[]; onGoHome: (event: React.MouseEvent) => void; compact?: boolean;
    last?: boolean; logo?: string | null; spellOut?: boolean }> = ({
    appName, destinations, onGoHome, compact, last = true, logo, spellOut = true,
}) => {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const standard = destinations.find(destination => destination.key === 'app');
    const current = destinations.find(destination => destination.current);
    const inSpace = !!standard && !standard.current;
    const nameSx = { fontWeight: weight(400), lineHeight: 1.2, letterSpacing: 0, ...(compact && { fontSize: textVar.xl }) };
    const shown = inSpace ? shortSpaceName(appName, standard.name) : appName;
    const name = <>
        {inSpace && logo && <Box component="img" src={logo} alt="" draggable={false}
            sx={{ height: compact ? 18 : 20, width: 'auto', mr: 0.75, display: 'block', flexShrink: 0 }} />}
        <Typography noWrap component="h1" title={appName} sx={{ maxWidth: compact ? { xs: 160, sm: 320 } : 360, ...nameSx }}>
            {shown}
        </Typography>
    </>;
    const partSx = { textTransform: 'none', minWidth: 0, height: compact ? undefined : 36, px: 0.75, gap: 0.25,
        '& .MuiButton-endIcon': { ml: 0.25 }, '&:hover': { backgroundColor: ink(0.04) } };
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {/* "Data Formulator /" (data-path-product: App.tsx measures it), or just "/" when the path is too long. */}
            {inSpace && !compact && spellOut && <Box data-path-product sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <Link href={standard.path} color="inherit" underline="none" draggable={false}
                    sx={{ ...nameSx, whiteSpace: 'nowrap', px: 0.75, py: 0.5, borderRadius: 1, flexShrink: 0, '&:hover': { backgroundColor: ink(0.04) } }}>
                    {standard.name}
                </Link>
                <PathSlash />
            </Box>}
            {inSpace && (compact || !spellOut) && <PathSlash compact={compact} />}
            {last
                ? <Button color="inherit" onClick={(event) => setAnchorEl(event.currentTarget)} aria-haspopup="menu" sx={partSx}
                    endIcon={<KeyboardArrowDownIcon sx={{ fontSize: iconVar.md, color: 'text.secondary' }} />}>
                    {name}
                </Button>
                : <Button color="inherit" component="a" href={current?.path ?? '/app'} draggable={false} onClick={onGoHome} sx={partSx}>
                    {name}
                </Button>}
            <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}>
                {destinationItems(destinations, onGoHome, () => setAnchorEl(null))}
            </Menu>
        </Box>
    );
};
