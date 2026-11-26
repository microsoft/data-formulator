// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { Suspense } from 'react';
import { Box, CircularProgress } from '@mui/material';
import type { SpaceLandingProps } from './types';

// The space front page is its own chunk, loaded only when the server selects a space.
const SpacePage = React.lazy(() => import('./SpacePage'));

export const SpaceLanding: React.FC<SpaceLandingProps> = (props) =>
    <Suspense fallback={<Box sx={{ m: 'auto' }}><CircularProgress size={24} /></Box>}>
        <SpacePage {...props} />
    </Suspense>;
