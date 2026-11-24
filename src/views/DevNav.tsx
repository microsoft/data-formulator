// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import { Box } from '@mui/material';
import { Link, useLocation } from 'react-router-dom';
import { weight } from '../app/tokens';

const PAGES: [string, string][] = [['/dev', 'components'], ['/dev/samples', 'sample apps'], ['/dev/maps', 'maps'], ['/dev/design', 'design']];

export const DEV_NAV_HEIGHT = 36;

const linkSx = { fontSize: 12, color: 'text.secondary', textDecoration: 'none', '&:hover': { color: 'primary.main' } } as const;

/** The bar across the dev pages. */
export const DevNav: React.FC = () => {
    const { pathname } = useLocation();
    return <Box component="nav" sx={{
        display: 'flex', alignItems: 'center', gap: 2, px: 2, height: DEV_NAV_HEIGHT, flexShrink: 0, boxSizing: 'border-box',
        borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', position: 'sticky', top: 0, zIndex: 10,
    }}>
        <Box component={Link} to="/" sx={{ ...linkSx, fontWeight: weight(600), color: 'text.primary' }}>Data Formulator</Box>
        {PAGES.map(([path, label]) => <Box key={path} component={Link} to={path}
            sx={{ ...linkSx, ...(pathname === path ? { color: 'primary.main', fontWeight: weight(600) } : {}) }}>{label}</Box>)}
    </Box>;
};
