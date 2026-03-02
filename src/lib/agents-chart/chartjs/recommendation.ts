// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart.js recommendation & adaptation wrappers.
 */

import { adaptChannels, recommendChannels } from '../core/recommendation';
import { cjsGetTemplateChannels } from './templates';

export function cjsAdaptChart(
    sourceType: string,
    targetType: string,
    encodings: Record<string, string>,
    data?: any[],
    semanticTypes?: Record<string, string>,
): Record<string, string> {
    const targetChannels = cjsGetTemplateChannels(targetType);
    return adaptChannels(sourceType, targetType, targetChannels, encodings, data, semanticTypes);
}

export function cjsRecommendEncodings(
    chartType: string,
    data: any[],
    semanticTypes: Record<string, string>,
): Record<string, string> {
    const rec = recommendChannels(chartType, data, semanticTypes);
    const validChannels = cjsGetTemplateChannels(chartType);
    const result: Record<string, string> = {};
    for (const [ch, field] of Object.entries(rec)) {
        if (validChannels.includes(ch)) result[ch] = field;
    }
    return result;
}
