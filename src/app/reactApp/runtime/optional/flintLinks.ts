// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Flint's validators, a bundle of their own: FlintChart checks the focus and updates an app gives it
 * with the chart validator. Injected only into apps that set a chart's focus or updates. The link
 * validator stays registered for Flint React's `useLinkedCharts`, which DF does not use.
 */

import { validateChart, validateLinks } from 'flint-chart/validate';

import { registerOptionalModule } from './register';

registerOptionalModule('flint-links', { validateLinks, validateChart });
