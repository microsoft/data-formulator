// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * GoFish recommendation & adaptation wrappers.
 */

import { adaptChannels, recommendChannels } from '../core/recommendation';
import { gfGetTemplateChannels } from './templates';

export function gfAdaptChart(
    sourceType: string,
    targetType: string,
    encodings: Record<string, string>,
    data?: any[],
    semanticTypes?: Record<string, string>,
): Record<string, string> {
    const targetChannels = gfGetTemplateChannels(targetType);
    return adaptChannels(sourceType, targetType, targetChannels, encodings, data, semanticTypes);
}

export function gfRecommendEncodings(
    chartType: string,
    data: any[],
    semanticTypes: Record<string, string>,
): Record<string, string> {
    const rec = recommendChannels(chartType, data, semanticTypes);
    const validChannels = gfGetTemplateChannels(chartType);
    const result: Record<string, string> = {};
    for (const [ch, field] of Object.entries(rec)) {
        if (validChannels.includes(ch)) result[ch] = field;
    }
    return result;
}
