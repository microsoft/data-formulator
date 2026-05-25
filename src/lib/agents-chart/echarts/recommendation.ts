// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts recommendation & adaptation wrappers.
 *
 * Extends core/recommendation.ts with ECharts-only chart types
 * (Gauge, Funnel, Treemap, Sunburst, Sankey).
 */

import {
    adaptChannels,
    recommendChannels,
    getRecommendation,
    type InternalTableView,
    type RecommendFn,
    pickQuantitative,
    pickDiscrete,
    pickLowCardDiscrete,
} from '../core/recommendation';
import { ecGetTemplateChannels } from './templates';

// ── EC-extended recommendation ──────────────────────────────────────────

function ecGetRecommendation(chartType: string, tv: InternalTableView): Record<string, string> {
    const used = new Set<string>();
    const rec: Record<string, string> = {};
    const assign = (channel: string, fieldName: string | undefined) => {
        if (fieldName) rec[channel] = fieldName;
    };

    switch (chartType) {
        case 'Gauge Chart': {
            // Channels: ['size', 'column'] — size carries the value, column
            // optionally splits into multiple dials.
            const valueField = pickQuantitative(tv, used);
            if (!valueField) return {};
            assign('size', valueField);
            assign('column', pickLowCardDiscrete(tv, used, 10));
            return rec;
        }

        case 'Funnel Chart': {
            // Channels: ['y', 'size'] — y is the stage/category, size is the value.
            const valueField = pickQuantitative(tv, used);
            const stageField = pickLowCardDiscrete(tv, used, 15);
            if (!valueField || !stageField) return {};
            assign('y', stageField);
            assign('size', valueField);
            return rec;
        }

        case 'Treemap':
        case 'Sunburst Chart': {
            const sizeField = pickQuantitative(tv, used);
            const colorField = pickLowCardDiscrete(tv, used, 20);
            if (!sizeField || !colorField) return {};
            assign('size', sizeField);
            assign('color', colorField);
            return rec;
        }

        case 'Sankey Diagram': {
            // Channels: ['x', 'y', 'size'] — x is source node, y is target node,
            // size is the flow value.
            const sourceField = pickDiscrete(tv, used);
            const targetField = pickDiscrete(tv, used);
            const valueField = pickQuantitative(tv, used);
            if (!sourceField || !targetField || !valueField) return {};
            assign('x', sourceField);
            assign('y', targetField);
            assign('size', valueField);
            return rec;
        }

        default:
            return getRecommendation(chartType, tv);
    }
}

// ── Public API ──────────────────────────────────────────────────────────

export function ecAdaptChart(
    sourceType: string,
    targetType: string,
    encodings: Record<string, string>,
    data?: any[],
    semanticTypes?: Record<string, string>,
): Record<string, string> {
    const targetChannels = ecGetTemplateChannels(targetType);
    return adaptChannels(sourceType, targetType, targetChannels, encodings, data, semanticTypes, ecGetRecommendation);
}

export function ecRecommendEncodings(
    chartType: string,
    data: any[],
    semanticTypes: Record<string, string>,
): Record<string, string> {
    const rec = recommendChannels(chartType, data, semanticTypes, ecGetRecommendation);
    const validChannels = ecGetTemplateChannels(chartType);
    const result: Record<string, string> = {};
    for (const [ch, field] of Object.entries(rec)) {
        if (validChannels.includes(ch)) result[ch] = field;
    }
    return result;
}
