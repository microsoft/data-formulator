// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Flint's link validator, which `useLinkedCharts` needs to connect charts: a bundle of its own,
 * injected only into apps that link charts (`ChartLink`), as the core runtime's Flint asks for it.
 */

import { validateLinks } from 'flint-chart/validate';

import { registerOptionalModule } from './register';

registerOptionalModule('flint-links', { validateLinks });
