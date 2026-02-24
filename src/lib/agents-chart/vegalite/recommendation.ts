// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Vega-Lite recommendation & adaptation wrappers.
 *
 * Extends core/recommendation.ts with VL-only chart types (Linear Regression,
 * Ranged Dot Plot, Pyramid, Lollipop, Dotted Line, Bump, Density, Waterfall,
 * Strip, US/World Map) and filters results to VL-valid channels.
 */

import {
    adaptChannels,
    recommendChannels,
    getRecommendation,
    type InternalTableView,
    type RecommendFn,
    // Pick utilities for VL-specific chart types
    pick,
    pickQuantitative,
    pickTemporal,
    pickNominal,
    pickDiscrete,
    pickLowCardNominal,
    pickLowCardDiscrete,
    pickGeo,
    pickSeriesAxis,
    hasMultipleValuesPerField,
    pickBestGroupingField,
    pickLineChartColorField,
    isValidLineSeriesData,
    nameMatches,
} from '../core/recommendation';
import { vlGetTemplateChannels } from './templates';

// ── VL-extended recommendation ──────────────────────────────────────────

/**
 * VL-specific recommendation function.  Handles VL-only chart types first,
 * then falls back to the core recommendation engine for shared types.
 */
function vlGetRecommendation(chartType: string, tv: InternalTableView): Record<string, string> {
    const used = new Set<string>();
    const rec: Record<string, string> = {};
    const assign = (channel: string, fieldName: string | undefined) => {
        if (fieldName) rec[channel] = fieldName;
    };

    switch (chartType) {
        case 'Linear Regression': {
            // Same as Scatter Plot
            const yField = pickQuantitative(tv, used) ?? pickTemporal(tv, used) ?? pickNominal(tv, used);
            const xField = pickQuantitative(tv, used) ?? pickTemporal(tv, used) ?? pickNominal(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', pickLowCardNominal(tv, used));
            return rec;
        }

        case 'Ranged Dot Plot': {
            const yField = pickGeo(tv, used) ?? pickDiscrete(tv, used);
            const xField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('y', yField);
            assign('x', xField);
            return rec;
        }

        case 'Pyramid Chart': {
            const yField = pickDiscrete(tv, used);
            const xField = pickQuantitative(tv, used);
            const colorField = pickDiscrete(tv, used);
            if (!xField || !yField || !colorField) return {};
            assign('y', yField);
            assign('x', xField);
            assign('color', colorField);
            return rec;
        }

        case 'Dotted Line Chart':
        case 'Bump Chart': {
            // Same logic as Line Chart
            const xField = pickSeriesAxis(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            if (!isValidLineSeriesData(tv, xField, undefined)) {
                const colorField = pickLineChartColorField(tv, used, xField, 20)
                    ?? pickLineChartColorField(tv, used, xField, 200);
                if (!colorField) return {};
                assign('color', colorField);
            }
            return rec;
        }

        case 'Lollipop Chart': {
            const xField = pickDiscrete(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            if (hasMultipleValuesPerField(tv, xField)) {
                assign('color', pickBestGroupingField(tv, used, xField));
            }
            return rec;
        }

        case 'Density Plot': {
            const xField = pickQuantitative(tv, used);
            if (!xField) return {};
            assign('x', xField);
            assign('color', pickLowCardNominal(tv, used, 15));
            return rec;
        }

        case 'Waterfall Chart': {
            const xField = pickDiscrete(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            return rec;
        }

        case 'Strip Plot': {
            const xField = pickDiscrete(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', pickLowCardDiscrete(tv, used, 20));
            return rec;
        }

        case 'US Map':
        case 'World Map': {
            const latField = pick(tv, used, (_n, _ty, st) => st === 'Latitude')
                ?? pick(tv, used, (n) => nameMatches(n, ['latitude', 'lat']));
            const lonField = pick(tv, used, (_n, _ty, st) => st === 'Longitude')
                ?? pick(tv, used, (n) => nameMatches(n, ['longitude', 'lon', 'lng', 'long']));
            if (!latField || !lonField) return {};
            assign('latitude', latField);
            assign('longitude', lonField);
            assign('color', pickQuantitative(tv, used) ?? pickLowCardNominal(tv, used));
            return rec;
        }

        default:
            // Fall through to core recommendation engine
            return getRecommendation(chartType, tv);
    }
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Adapt encodings when switching between Vega-Lite chart types.
 *
 * @param sourceType     Current chart type name
 * @param targetType     Target chart type name
 * @param encodings      Current channel->fieldName map (filled channels only)
 * @param data           (optional) Data rows for recommendation-based adaptation
 * @param semanticTypes  (optional) Field->semantic-type map
 * @returns              Remapped channel->fieldName for the target
 */
export function vlAdaptChart(
    sourceType: string,
    targetType: string,
    encodings: Record<string, string>,
    data?: any[],
    semanticTypes?: Record<string, string>,
): Record<string, string> {
    const targetChannels = vlGetTemplateChannels(targetType);
    return adaptChannels(sourceType, targetType, targetChannels, encodings, data, semanticTypes, vlGetRecommendation);
}

/**
 * Recommend field->channel assignments for a Vega-Lite chart type.
 *
 * @param chartType      Chart template name (e.g. "Bar Chart")
 * @param data           Array of row objects
 * @param semanticTypes  Field->semantic-type map (e.g. { weight: "Quantity" })
 * @returns              channel->fieldName map (only VL-valid channels)
 */
export function vlRecommendEncodings(
    chartType: string,
    data: any[],
    semanticTypes: Record<string, string>,
): Record<string, string> {
    const rec = recommendChannels(chartType, data, semanticTypes, vlGetRecommendation);
    const validChannels = vlGetTemplateChannels(chartType);
    const result: Record<string, string> = {};
    for (const [ch, field] of Object.entries(rec)) {
        if (validChannels.includes(ch)) {
            result[ch] = field;
        }
    }
    return result;
}
