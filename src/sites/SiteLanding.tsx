// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { Suspense } from 'react';
import { Box, CircularProgress } from '@mui/material';
import type { SiteLandingProps } from './types';

// The site front page is its own chunk, loaded only when the server selects a site.
const SitePage = React.lazy(() => import('./SitePage'));

export const SiteLanding: React.FC<SiteLandingProps> = (props) =>
    <Suspense fallback={<Box sx={{ m: 'auto' }}><CircularProgress size={24} /></Box>}>
        <SitePage {...props} />
    </Suspense>;
