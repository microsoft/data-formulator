// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import { Box } from '@mui/material';
import { Link, useLocation } from 'react-router-dom';

const PAGES: [string, string][] = [['/dev', 'components'], ['/dev/samples', 'sample apps'], ['/dev/maps', 'maps'], ['/dev/design', 'design']];

const linkSx = { fontSize: 12, color: 'text.secondary', textDecoration: 'none', '&:hover': { color: 'primary.main' } } as const;

/** The bar across the dev pages: the pages, then the current page's sections. */
export const DevNav: React.FC<{ sections?: [string, string][] }> = ({ sections = [] }) => {
    const { pathname } = useLocation();
    return <Box component="nav" sx={{
        display: 'flex', alignItems: 'center', gap: 2, px: 2, height: 36, flexShrink: 0, boxSizing: 'border-box',
        borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', position: 'sticky', top: 0, zIndex: 10,
    }}>
        <Box component={Link} to="/" sx={{ ...linkSx, fontWeight: 600, color: 'text.primary' }}>Data Formulator</Box>
        {PAGES.map(([path, label]) => <Box key={path} component={Link} to={path}
            sx={{ ...linkSx, ...(pathname === path ? { color: 'primary.main', fontWeight: 600 } : {}) }}>{label}</Box>)}
        {sections.length > 0 && <Box sx={{ width: '1px', height: 16, bgcolor: 'divider' }} />}
        {sections.map(([id, label]) => <Box key={id} component="a" href={`#${id}`} sx={linkSx}>{label}</Box>)}
    </Box>;
};
