// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { Suspense } from 'react';
import { Box, CircularProgress } from '@mui/material';
import type { SiteLandingProps } from './types';

// Each site's page is a separate chunk, loaded only on that site's hostname.
const landings: Record<string, React.LazyExoticComponent<React.FC<SiteLandingProps>>> = {
    unesco: React.lazy(() => import('./unesco/UnescoLanding')),
};

export const hasSiteLanding = (siteId?: string) => !!siteId && siteId in landings;

export const SiteLanding: React.FC<SiteLandingProps> = (props) => {
    const Landing = landings[props.site.id];
    if (!Landing) return null;
    return <Suspense fallback={<Box sx={{ m: 'auto' }}><CircularProgress size={24} /></Box>}>
        <Landing {...props} />
    </Suspense>;
};
