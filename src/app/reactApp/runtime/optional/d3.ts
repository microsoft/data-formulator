// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** The `d3` app module: the full d3 v7 API. */

import * as d3 from 'd3';

import { registerOptionalModule } from './register';

registerOptionalModule('d3', { ...d3 });
