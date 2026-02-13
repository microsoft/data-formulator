// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Core chart assembly logic.
 *
 * Given data, encoding definitions, and semantic types,
 * produces a complete Vega-Lite specification.
 *
 * This module has NO React, Redux, or UI framework dependencies.
 * It is designed to be reusable outside of the Data Formulator app.
 */

import {
    ChartEncoding,
    ChartTemplateDef,
    AssembleOptions,
} from './types';
import { getTemplateDef } from './templates';
import {
    getVisCategory,
    inferVisCategory,
    getRecommendedColorSchemeWithMidpoint,
    type VisCategory,
} from './semantic-types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check if a numeric value is likely a Unix timestamp (seconds or milliseconds).
 */
function isLikelyTimestamp(val: number): boolean {
    const maxTimestampMs = 4102444800000;
    const maxTimestampSec = 4102444800;
    if (val >= 1e12 && val <= maxTimestampMs) return true;
    if (val >= 1e9 && val <= maxTimestampSec) return true;
    return false;
}

/**
 * Resolve the Vega-Lite encoding type for a field.
 *
 * Unified pipeline:
 *   1. Determine a VisCategory — from semantic type if available, otherwise
 *      inferred from raw data values.
 *   2. Map VisCategory → VL encoding type, applying channel-specific and
 *      chart-specific rules (e.g. temporal → ordinal for facets, bar-chart
 *      date binning, etc.)
 *   3. Caller can still override with an explicit encoding.type afterward.
 */
function resolveEncodingType(
    semanticType: string,
    fieldValues: any[],
    channel: string,
    chartType: string,
    data: any[],
    fieldName: string,
): string {
    // Step 1: Determine vis category
    // If the semantic type is recognised in the map, use it; otherwise
    // fall back to data-driven inference so unknown types like "Value"
    // get properly inferred from the actual data values.
    const mappedCategory = semanticType ? getVisCategory(semanticType) : null;
    const visCategory: VisCategory = mappedCategory ?? inferVisCategory(fieldValues);

    // Step 2: Map to VL type with channel/chart-specific overrides
    const isBarChart = ['Bar Chart', 'Stacked Bar Chart', 'Grouped Bar Chart', 'Heatmap', 'Pyramid Chart'].includes(chartType);

    switch (visCategory) {
        case 'temporal':
            if (['size', 'column', 'row'].includes(channel)) {
                return 'ordinal';
            }
            if (channel === 'color') {
                const uniqueColorValues = new Set(data.map(r => r[fieldName])).size;
                return uniqueColorValues > 12 ? 'temporal' : 'ordinal';
            }
            // Validate temporal parsing
            {
                const sampleValues = data.map(r => r[fieldName]).slice(0, 15).filter(v => v != null);
                const isValidTemporal = sampleValues.length > 0 && sampleValues.some(val => {
                    if (val instanceof Date) return true;
                    if (typeof val === 'number') {
                        if (val >= 1000 && val <= 3000) return true;
                        if (val > 86400000 && val < 4200000000000) return true;
                        return false;
                    }
                    if (typeof val === 'string') {
                        const trimmed = val.trim();
                        if (!trimmed) return false;
                        if (/^\d{4}$/.test(trimmed)) return true;
                        return !Number.isNaN(Date.parse(trimmed));
                    }
                    return false;
                });

                if (!isValidTemporal) return 'ordinal';
                if (isBarChart) {
                    const uniqueCount = new Set(data.map(r => r[fieldName])).size;
                    return uniqueCount <= 32 ? 'ordinal' : 'temporal';
                }
                return 'temporal';
            }
        case 'ordinal':
            return 'ordinal';
        case 'quantitative':
            return 'quantitative';
        case 'geographic':
            return 'quantitative';
        case 'nominal':
        default:
            return 'nominal';
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble a Vega-Lite specification from chart type, encodings, data, and semantic types.
 *
 * @param chartType       Name of the chart template (e.g. "Scatter Plot", "Bar Chart")
 * @param encodings       Record mapping channel names to ChartEncoding (field names, not IDs)
 * @param data            Array of data rows
 * @param semanticTypes   Record mapping field names to semantic type strings (e.g. "Quantity", "Country")
 * @param canvasSize      Target canvas dimensions { width, height }
 * @param options         Assembly options (scale factor, etc.)
 * @returns               A Vega-Lite spec object, or ["Table", undefined] for table type
 */
export function assembleChart(
    chartType: string,
    encodings: Record<string, ChartEncoding>,
    data: any[],
    semanticTypes: Record<string, string> = {},
    canvasSize: { width: number; height: number } = { width: 400, height: 320 },
    chartProperties?: Record<string, any>,
    options: AssembleOptions = {},
): any {
    const {
        addTooltips = false,
        elasticity: elasticityVal = 0.5,
        maxStretch: maxStretchVal = 2,
        facetElasticity: facetElasticityVal = 0.3,
        facetMaxStretch: facetMaxStretchVal = 1.5,
        minStep: minStepVal = 6,
        minSubplotSize: minSubplotVal = 60,
    } = options;

    const chartTemplate = getTemplateDef(chartType) as ChartTemplateDef;
    if (!chartTemplate) {
        throw new Error(`Unknown chart type: ${chartType}`);
    }

    const vgObj = structuredClone(chartTemplate.template);

    // --- Warnings collector ---
    const warnings: import('./types').ChartWarning[] = [];

    // --- Resolve encodings ---
    const resolvedEncodings: Record<string, any> = {};
    for (const [channel, encoding] of Object.entries(encodings)) {
        const encodingObj: any = {};

        if (channel === "radius") {
            encodingObj.scale = { type: "sqrt", zero: true };
        }

        const fieldName = encoding.field;

        // Handle count aggregate without a field
        if (!fieldName && encoding.aggregate === "count") {
            encodingObj.field = "_count";
            encodingObj.title = "Count";
            encodingObj.type = "quantitative";
        }

        if (fieldName) {
            encodingObj.field = fieldName;
            const semanticType = semanticTypes[fieldName] || '';
            const fieldValues = data.map(r => r[fieldName]);

            // Unified type resolution: semantic type + data inference + channel/chart rules
            encodingObj.type = resolveEncodingType(semanticType, fieldValues, channel, chartType, data, fieldName);

            // Explicit type override
            if (encoding.type) {
                encodingObj.type = encoding.type;
            } else if (channel === 'column' || channel === 'row') {
                if (encodingObj.type !== 'nominal' && encodingObj.type !== 'ordinal') {
                    encodingObj.type = 'nominal';
                }
            }

            // ISO date hack: if quantitative but values are ISO strings, switch to temporal
            if (encodingObj.type === "quantitative") {
                const sampleValues = data.slice(0, 15).filter(r => r[fieldName] != undefined).map(r => r[fieldName]);
                const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
                if (sampleValues.length > 0 && sampleValues.every((val: any) => isoDateRegex.test(`${val}`.trim()))) {
                    encodingObj.type = "temporal";
                }
            }

            // Aggregation handling — data is always pre-aggregated
            if (encoding.aggregate) {
                if (encoding.aggregate === "count") {
                    encodingObj.field = "_count";
                    encodingObj.title = "Count";
                    encodingObj.type = "quantitative";
                } else {
                    encodingObj.field = `${fieldName}_${encoding.aggregate}`;
                    encodingObj.type = "quantitative";
                }
            }

            // Scale tweaks
            if (encodingObj.type === "quantitative" && chartType.includes("Line") && channel === "x") {
                encodingObj.scale = { nice: false };
            }

            // Legend sizing for high-cardinality nominal color
            if (encodingObj.type === "nominal" && channel === 'color') {
                const actualDomain = [...new Set(data.map(r => r[fieldName]))];
                if (actualDomain.length >= 16) {
                    if (!encodingObj.legend) encodingObj.legend = {};
                    encodingObj.legend.symbolSize = 12;
                    encodingObj.legend.labelFontSize = 8;
                }
            }
        }

        // Size channel: set scale based on resolved encoding type.
        // For quantitative: sqrt scale with zero=true, density-aware max (≤ VL default 361).
        // For categorical (nominal/ordinal): no zero, balanced min:max ratio (~1:4)
        //   so all levels are visually distinguishable.
        if (channel === "size") {
            const vlDefaultMax = 361;                   // VL's default size scale max (19²)
            const plotArea = canvasSize.width * canvasSize.height;
            const n = Math.max(data.length, 1);
            const fairShare = plotArea / n;
            const targetPct = 0.6;
            const absoluteMin = 16;

            const isQuantitative = encodingObj.type === 'quantitative' || encodingObj.type === 'temporal';
            if (isQuantitative) {
                // Sqrt scale, zero-based — small values get small dots proportionally
                const maxSize = Math.round(Math.max(absoluteMin, Math.min(vlDefaultMax, fairShare * targetPct)));
                const minSize = 9;
                encodingObj.scale = { type: "sqrt", zero: true, range: [minSize, maxSize] };
            } else {
                // Categorical size: balanced ratio so smallest level is still readable
                const maxSize = Math.round(Math.max(absoluteMin, Math.min(vlDefaultMax, fairShare * targetPct)));
                const minSize = Math.round(maxSize / 4);  // 1:4 ratio
                encodingObj.scale = { range: [minSize, maxSize] };
            }
        }

        // --- Sorting ---
        if (encoding.sortBy || encoding.sortOrder) {
            if (!encoding.sortBy) {
                if (encoding.sortOrder) {
                    encodingObj.sort = encoding.sortOrder;
                }
            } else if (encoding.sortBy === 'x' || encoding.sortBy === 'y') {
                if (encoding.sortBy === channel) {
                    encodingObj.sort = `${encoding.sortOrder === "descending" ? "-" : ""}${encoding.sortBy}`;
                } else {
                    encodingObj.sort = `${encoding.sortOrder === "ascending" ? "" : "-"}${encoding.sortBy}`;
                }
            } else if (encoding.sortBy === 'color') {
                if (encodings.color?.field) {
                    encodingObj.sort = `${encoding.sortOrder === "ascending" ? "" : "-"}${encoding.sortBy}`;
                }
            } else {
                try {
                    if (fieldName) {
                        const fieldSemType = semanticTypes[fieldName] || '';
                        const fieldVisCat = inferVisCategory(data.map(r => r[fieldName]));
                        let sortedValues = JSON.parse(encoding.sortBy);

                        if (fieldVisCat === 'temporal' || fieldSemType === "Year" || fieldSemType === "Decade") {
                            sortedValues = sortedValues.map((v: any) => v.toString());
                        }

                        encodingObj.sort = (encoding.sortOrder === "ascending" || !encoding.sortOrder)
                            ? sortedValues : sortedValues.reverse();

                        if (channel === 'color' && (vgObj.mark === 'bar' || vgObj.mark === 'area')) {
                            vgObj.encoding = vgObj.encoding || {};
                            vgObj.encoding.order = {
                                field: `color_${fieldName}_sort_index`,
                            };
                        }
                    }
                } catch (err) {
                    console.warn(`sort error > ${encoding.sortBy}`);
                }
            }
        } else {
            // Auto-sort: nominal axis with quantitative opposite
            if ((channel === 'x' && encodingObj.type === 'nominal' && encodings.y?.field) ||
                (channel === 'y' && encodingObj.type === 'nominal' && encodings.x?.field)) {

                if (chartType.includes("Line") || chartType.includes("Area") || chartType === "Heatmap") {
                    // do nothing — lines/areas need temporal order, heatmaps need natural order
                } else {
                    const colorField = encodings.color?.field;
                    let colorFieldType: string | undefined;
                    if (colorField) {
                        colorFieldType = inferVisCategory(data.map(r => r[colorField]));
                    }

                    if (colorField && colorFieldType === 'quantitative') {
                        encodingObj.sort = "-color";
                    } else {
                        const oppositeChannel = channel === 'x' ? 'y' : 'x';
                        const oppositeField = encodings[oppositeChannel]?.field;
                        if (oppositeField) {
                            if (inferVisCategory(data.map(r => r[oppositeField])) === 'quantitative') {
                                encodingObj.sort = `-${oppositeChannel}`;
                            }
                        }
                    }
                }
            }
        }

        // Stack
        if (encoding.stack) {
            encodingObj.stack = encoding.stack === "layered" ? null : encoding.stack;
        }

        // Color scheme
        if (channel === "color") {
            if (encoding.scheme && encoding.scheme !== "default") {
                if ('scale' in encodingObj) {
                    encodingObj.scale.scheme = encoding.scheme;
                } else {
                    encodingObj.scale = { scheme: encoding.scheme };
                }
            } else if (fieldName) {
                const colorSemanticType = semanticTypes[fieldName];
                const fieldValues = data.map(r => r[fieldName]);
                const encodingVLType = encodingObj.type as 'nominal' | 'ordinal' | 'quantitative' | 'temporal';

                const recommendation = getRecommendedColorSchemeWithMidpoint(
                    colorSemanticType, encodingVLType, fieldValues, fieldName
                );

                if (!('scale' in encodingObj)) {
                    encodingObj.scale = {};
                }
                encodingObj.scale.scheme = recommendation.scheme;

                if (recommendation.type === 'diverging' && recommendation.domainMid !== undefined) {
                    encodingObj.scale.domainMid = recommendation.domainMid;
                }
            }
        }

        // --- Collect resolved encoding ---
        if (Object.keys(encodingObj).length !== 0) {
            resolvedEncodings[channel] = encodingObj;
        }
    }

    // --- Build encodings into spec ---
    chartTemplate.buildEncodings(vgObj, resolvedEncodings);

    // --- Post-processor ---
    if (chartTemplate.postProcessor) {
        const processed = chartTemplate.postProcessor(vgObj, data, chartProperties, canvasSize);
        if (processed) Object.assign(vgObj, processed === vgObj ? {} : {}, processed !== vgObj ? processed : {});
    }

    // Merge any warnings emitted by the postProcessor
    if (vgObj._warnings && Array.isArray(vgObj._warnings)) {
        warnings.push(...vgObj._warnings);
        delete vgObj._warnings;
    }

    // --- Temporal data conversion ---
    let values = structuredClone(data);
    if (values.length > 0) {
        const keys = Object.keys(values[0]);
        const temporalKeys = keys.filter((k: string) => {
            const st = semanticTypes[k] || '';
            const vc = inferVisCategory(data.map(r => r[k]));
            return vc === 'temporal' || st === "Year" || st === "Decade";
        });
        if (temporalKeys.length > 0) {
            values = values.map((r: any) => {
                for (const temporalKey of temporalKeys) {
                    const val = r[temporalKey];
                    const st = semanticTypes[temporalKey] || '';

                    if (typeof val === 'number') {
                        if (st === 'Year' || st === 'Decade') {
                            r[temporalKey] = `${Math.floor(val)}`;
                        } else if (isLikelyTimestamp(val)) {
                            const timestamp = val < 1e12 ? val * 1000 : val;
                            r[temporalKey] = new Date(timestamp).toISOString();
                        } else {
                            r[temporalKey] = String(val);
                        }
                    } else if (val instanceof Date) {
                        r[temporalKey] = val.toISOString();
                    } else {
                        r[temporalKey] = String(val);
                    }
                }
                return r;
            });
        }
    }

    // --- Canvas sizing & discrete axis handling ---
    const defaultChartWidth = canvasSize.width;
    const defaultChartHeight = canvasSize.height;

    // Dynamically compute max facet values based on canvas size.
    // Each subplot needs at least minSubplotVal px, allow up to facetMaxStretch elastic stretch.
    const maxFacetColumns = Math.max(2, Math.floor(defaultChartWidth * facetMaxStretchVal / minSubplotVal));
    const maxFacetRows = Math.max(2, Math.floor(defaultChartHeight * facetMaxStretchVal / minSubplotVal));
    const maxFacetNominalValues = maxFacetColumns * maxFacetRows;

    const baseRefSize = 300;
    const sizeRatio = Math.max(defaultChartWidth, defaultChartHeight) / baseRefSize;
    const defaultStepSize = Math.round(20 * Math.max(1, sizeRatio));

    const isDiscreteType = (t: string | undefined) => t === 'nominal' || t === 'ordinal';
    const xOffsetEnc = vgObj.encoding?.xOffset;
    const yOffsetEnc = vgObj.encoding?.yOffset;
    const xOffsetMultiplier = (xOffsetEnc?.field && isDiscreteType(xOffsetEnc.type))
        ? new Set(values.map((r: any) => r[xOffsetEnc.field])).size : 1;
    const yOffsetMultiplier = (yOffsetEnc?.field && isDiscreteType(yOffsetEnc.type))
        ? new Set(values.map((r: any) => r[yOffsetEnc.field])).size : 1;

    let maxXToKeep = Math.floor(defaultChartWidth * maxStretchVal / (minStepVal * xOffsetMultiplier));
    let maxYToKeep = Math.floor(defaultChartHeight * maxStretchVal / (minStepVal * yOffsetMultiplier));

    const nominalCount: Record<string, number> = {
        x: 0, y: 0, column: 0, row: 0, xOffset: 0, yOffset: 0,
    };

    // Count discrete values and filter data for overflowing axes
    for (const channel of ['x', 'y', 'column', 'row', 'xOffset', 'yOffset', 'color']) {
        const enc = vgObj.encoding?.[channel];
        if (enc?.field && isDiscreteType(enc.type)) {
            const maxNominalValuesToKeep = channel === 'x' ? maxXToKeep : channel === 'y' ? maxYToKeep : maxFacetNominalValues;
            const fieldName = enc.field;
            const uniqueValues = [...new Set(values.map((r: any) => r[fieldName]))];

            nominalCount[channel] = uniqueValues.length > maxNominalValuesToKeep ? maxNominalValuesToKeep : uniqueValues.length;

            const fieldOriginalType = inferVisCategory(data.map(r => r[fieldName]));

            let valuesToKeep: any[];
            if (uniqueValues.length > maxNominalValuesToKeep) {
                if (fieldOriginalType === 'quantitative' || channel === 'color') {
                    valuesToKeep = uniqueValues.sort((a, b) => a - b).slice(0, channel === 'color' ? 24 : maxNominalValuesToKeep);
                } else if (channel === 'facet' || channel === 'column' || channel === 'row') {
                    valuesToKeep = uniqueValues.slice(0, maxNominalValuesToKeep);
                } else if (channel === 'x' || channel === 'y') {
                    const oppositeChannel = channel === 'x' ? 'y' : 'x';
                    const oppositeEncoding = vgObj.encoding?.[oppositeChannel];
                    const colorEncoding = vgObj.encoding?.color;

                    let isDescending = true;
                    let sortChannel: string | undefined;
                    let sortField: string | undefined;
                    let sortFieldType: string | undefined;

                    if (enc.sort) {
                        if (typeof enc.sort === 'string' && (enc.sort === 'descending' || enc.sort === 'ascending')) {
                            isDescending = enc.sort === 'descending';
                            sortChannel = oppositeChannel;
                            sortField = oppositeEncoding?.field;
                            sortFieldType = oppositeEncoding?.type;
                        } else if (typeof enc.sort === 'string' &&
                            (enc.sort === '-y' || enc.sort === '-x' || enc.sort === '-color' ||
                             enc.sort === 'y' || enc.sort === 'x' || enc.sort === 'color')) {
                            isDescending = enc.sort.startsWith('-');
                            sortChannel = isDescending ? enc.sort.substring(1) : enc.sort;
                            if (sortChannel) {
                                sortField = vgObj.encoding?.[sortChannel]?.field;
                                sortFieldType = vgObj.encoding?.[sortChannel]?.type;
                            }
                        }
                    } else {
                        if (chartType !== 'Heatmap' && colorEncoding?.field && colorEncoding.type === 'quantitative') {
                            sortChannel = 'color';
                            sortField = colorEncoding.field;
                            sortFieldType = colorEncoding.type;
                        } else if (oppositeEncoding?.type === 'quantitative') {
                            sortChannel = oppositeChannel;
                            sortField = oppositeEncoding.field;
                            sortFieldType = oppositeEncoding.type;
                        } else {
                            isDescending = false;
                        }
                    }

                    if (!["Line Chart", "Custom Area Chart"].includes(chartType) &&
                        sortField != undefined && sortChannel != undefined && sortFieldType === 'quantitative') {

                        let aggregateOp = Math.max;
                        let initialValue = -Infinity;
                        if (chartType === "Bar" && sortChannel !== 'color') {
                            aggregateOp = (x: number, y: number) => x + y;
                            initialValue = 0;
                        }

                        const valueAggregates = new Map<string, number>();
                        for (const row of data) {
                            const fieldValue = row[fieldName];
                            const sortValue = row[sortField as keyof typeof row] || 0;
                            if (valueAggregates.has(fieldValue)) {
                                valueAggregates.set(fieldValue, aggregateOp(valueAggregates.get(fieldValue)!, sortValue));
                            } else {
                                valueAggregates.set(fieldValue, aggregateOp(initialValue, sortValue));
                            }
                        }

                        const valueSortPairs = Array.from(valueAggregates.entries()).map(([value, sortValue]) => ({
                            value, sortValue,
                        }));

                        const compareFn = (a: { value: string; sortValue: number }, b: { value: string; sortValue: number }) =>
                            isDescending ? b.sortValue - a.sortValue : a.sortValue - b.sortValue;

                        valuesToKeep = valueSortPairs
                            .sort(compareFn)
                            .slice(0, maxNominalValuesToKeep)
                            .map(v => v.value);
                    } else {
                        if (typeof enc.sort === 'string' &&
                            (enc.sort === 'descending' || enc.sort === `-${channel}`)) {
                            valuesToKeep = uniqueValues.reverse().slice(0, maxNominalValuesToKeep);
                        } else {
                            valuesToKeep = uniqueValues.slice(0, maxNominalValuesToKeep);
                        }
                    }
                } else {
                    valuesToKeep = uniqueValues.slice(0, maxNominalValuesToKeep);
                }

                const omittedCount = uniqueValues.length - valuesToKeep.length;
                warnings.push({
                    severity: 'warning',
                    code: 'overflow',
                    message: `${omittedCount} of ${uniqueValues.length} values in '${fieldName}' were omitted (showing top ${valuesToKeep.length}).`,
                    channel,
                    field: fieldName,
                });
                const placeholder = `...${omittedCount} items omitted`;
                if (channel !== 'color') {
                    values = values.filter((row: any) => valuesToKeep.includes(row[fieldName]));
                }

                if (!enc.axis) enc.axis = {};
                enc.axis.labelColor = {
                    condition: {
                        test: `datum.label == '${placeholder}'`,
                        value: "#999999",
                    },
                    value: "#000000",
                };

                if (channel === 'x' || channel === 'y') {
                    if (!enc.scale) enc.scale = {};
                    enc.scale.domain = [...valuesToKeep, placeholder];
                } else if (channel === 'color') {
                    if (!enc.legend) enc.legend = {};
                    enc.legend.values = [...valuesToKeep, placeholder];
                }
            }
        }
    }

    // --- Facet layout ---
    // --- Detect x/y discrete counts inside layer encodings for layered specs ---
    // The nominalCount loop above only checks vgObj.encoding, but layered specs
    // put x/y in layer[*].encoding. Scan layers so facet subplot sizing is correct.
    if (vgObj.layer && Array.isArray(vgObj.layer)) {
        for (const axis of ['x', 'y'] as const) {
            if (nominalCount[axis] === 0) {
                // Check first layer that has this axis
                for (const layer of vgObj.layer) {
                    const enc = layer.encoding?.[axis];
                    if (enc?.field && isDiscreteType(enc.type)) {
                        const uniqueValues = [...new Set(values.map((r: any) => r[enc.field]))];
                        nominalCount[axis] = uniqueValues.length;
                        break;
                    }
                }
            }
        }
    }

    if (vgObj.encoding?.column != undefined && vgObj.encoding?.row == undefined) {
        vgObj.encoding.facet = vgObj.encoding.column;

        let xDiscreteCount = nominalCount.x;
        if (nominalCount.xOffset > 0) {
            xDiscreteCount = nominalCount.x * nominalCount.xOffset;
        }

        const minSubplotWidth = xDiscreteCount > 0
            ? Math.max(minSubplotVal, xDiscreteCount * minStepVal)
            : minSubplotVal;

        const maxTotalWidth = facetMaxStretchVal * defaultChartWidth;
        const maxColsByWidth = Math.max(1, Math.floor(maxTotalWidth / minSubplotWidth));
        const facetCount = nominalCount.column || 1;
        const numCols = Math.min(maxColsByWidth, facetCount);

        vgObj.encoding.facet.columns = numCols;

        const numRows = Math.ceil(facetCount / numCols);
        if (numCols > 1 && numRows >= 3) {
            vgObj.resolve = { axis: { x: "independent" } };
        }

        delete vgObj.encoding.column;

        // For layered specs, VL doesn't support encoding.facet inline —
        // restructure to top-level facet + spec pattern.
        if (vgObj.layer && Array.isArray(vgObj.layer)) {
            const facetDef = { ...vgObj.encoding.facet };
            delete vgObj.encoding.facet;

            // Move layer + encoding into a nested spec
            vgObj.facet = facetDef;
            vgObj.spec = {
                layer: vgObj.layer,
                encoding: vgObj.encoding,
            };
            delete vgObj.layer;
            delete vgObj.encoding;
        }
    }

    // For layered specs with row-only or column+row facets, VL needs the
    // outer facet + spec structure. encoding.column/row don't work inline
    // on specs with a layer property.
    if (vgObj.layer && Array.isArray(vgObj.layer) &&
        (vgObj.encoding?.column || vgObj.encoding?.row)) {
        const facetDef: any = {};
        if (vgObj.encoding.column) {
            facetDef.column = vgObj.encoding.column;
            delete vgObj.encoding.column;
        }
        if (vgObj.encoding.row) {
            facetDef.row = vgObj.encoding.row;
            delete vgObj.encoding.row;
        }
        vgObj.facet = facetDef;
        vgObj.spec = {
            layer: vgObj.layer,
            encoding: vgObj.encoding,
        };
        delete vgObj.layer;
        delete vgObj.encoding;
    }

    // --- Compute facet grid dimensions ---
    let facetCols = 1;
    let facetRows = 1;

    // Check both inline encoding.facet (non-layered) and top-level facet (layered wrapped)
    const wrappedFacet = vgObj.encoding?.facet || (vgObj.facet && !vgObj.facet.column && !vgObj.facet.row ? vgObj.facet : null);
    if (wrappedFacet) {
        const layoutCols = wrappedFacet.columns || 1;
        const totalFacetValues = nominalCount.column || 1;
        facetCols = Math.min(layoutCols, totalFacetValues);
        facetRows = Math.ceil(totalFacetValues / layoutCols);
    }
    // Non-layered inline column/row or layered column+row via vgObj.facet.column/row
    if (vgObj.encoding?.column || vgObj.facet?.column) {
        facetCols = nominalCount.column || 1;
    }
    if (vgObj.encoding?.row || vgObj.facet?.row) {
        facetRows = nominalCount.row || 1;
    }

    const totalFacets = facetCols * facetRows;

    // --- Dynamic per-subplot sizing with elastic stretch ---
    const minContinuousSize = Math.max(10, minStepVal);

    let subplotWidth: number;
    if (facetCols > 1) {
        const stretch = Math.min(facetMaxStretchVal, Math.pow(facetCols, facetElasticityVal));
        subplotWidth = Math.round(Math.max(minContinuousSize, defaultChartWidth * stretch / facetCols));
    } else {
        subplotWidth = defaultChartWidth;
    }

    let subplotHeight: number;
    if (facetRows > 1) {
        const stretch = Math.min(facetMaxStretchVal, Math.pow(facetRows, facetElasticityVal));
        subplotHeight = Math.round(Math.max(minContinuousSize, defaultChartHeight * stretch / facetRows));
    } else {
        subplotHeight = defaultChartHeight;
    }

    // Bin quantitative facets
    for (const channel of ['facet', 'column', 'row']) {
        const enc = vgObj.encoding?.[channel];
        if (enc?.type === 'quantitative') {
            const fieldName = enc.field;
            const uniqueValues = [...new Set(values.map((r: any) => r[fieldName]))];
            if (uniqueValues.length > maxFacetNominalValues) {
                enc.bin = true;
            }
        }
    }

    // Total discrete items per axis
    let xTotalNominalCount = nominalCount.x;
    if (nominalCount.xOffset > 0) {
        xTotalNominalCount = nominalCount.x * nominalCount.xOffset;
    }
    let yTotalNominalCount = nominalCount.y;
    if (nominalCount.yOffset > 0) {
        yTotalNominalCount = nominalCount.y * nominalCount.yOffset;
    }

    // --- Count continuous axes used as discrete positions (bar/rect) ---
    // Temporal or quantitative positional axes without aggregate act like
    // discrete positions.  Track their cardinality separately — they use
    // continuousWidth/Height + mark dimensions, NOT the step-based layout
    // that nominal axes use.  Don't fold into xTotalNominalCount/yTotalNominalCount.
    //
    // Binned axes are a special case: the number of discrete positions is
    // the number of bins (maxbins or default 10), not the raw data cardinality.
    // VL sizes binned bars automatically, so we just need the count for stretch.
    const markType = typeof vgObj.mark === 'string' ? vgObj.mark : vgObj.mark?.type;

    // Collect all mark types — for layered specs, check each layer's mark too.
    const allMarkTypes = new Set<string>();
    if (markType) allMarkTypes.add(markType);
    if (Array.isArray(vgObj.layer)) {
        for (const layer of vgObj.layer) {
            const lm = typeof layer.mark === 'string' ? layer.mark : layer.mark?.type;
            if (lm) allMarkTypes.add(lm);
        }
    }
    const hasBarLikeMark = allMarkTypes.has('bar') || allMarkTypes.has('rect');

    let xContinuousAsDiscrete = 0;
    let yContinuousAsDiscrete = 0;
    if (hasBarLikeMark) {
        for (const axis of ['x', 'y'] as const) {
            const enc = vgObj.encoding?.[axis];
            if (!enc?.field) continue;
            if (isDiscreteType(enc.type)) continue;
            if (enc.aggregate) continue;

            // Binned axis — discrete count is the number of bins.
            // Default to 6 (VL's typical nice-rounded result) unless maxbins is specified.
            if (enc.bin) {
                const binCount = typeof enc.bin === 'object' && enc.bin.maxbins
                    ? enc.bin.maxbins : 6;
                if (axis === 'x') {
                    xContinuousAsDiscrete = binCount;
                } else {
                    yContinuousAsDiscrete = binCount;
                }
                continue;
            }

            // Only treat as discrete: temporal axes, or quantitative axes
            // where the opposite side is clearly a measure (has aggregate).
            if (enc.type !== 'temporal') {
                const otherEnc = vgObj.encoding?.[axis === 'x' ? 'y' : 'x'];
                if (!otherEnc?.aggregate) continue;
            }

            const cardinality = new Set(values.map((r: any) => r[enc.field])).size;
            if (cardinality <= 1) continue;

            if (axis === 'x') {
                xContinuousAsDiscrete = cardinality;
            } else {
                yContinuousAsDiscrete = cardinality;
            }
        }
    }

    // Independent y-axis scaling for faceted charts with vastly different ranges
    // For layered specs, encodings may be on vgObj.spec.encoding or vgObj.encoding
    const effectiveEncoding = vgObj.spec?.encoding || vgObj.encoding;
    const effectiveFacet = vgObj.facet || vgObj.encoding?.facet;
    if (effectiveFacet != undefined && effectiveEncoding?.y?.type === 'quantitative') {
        const yField = effectiveEncoding.y.field;
        const columnField = effectiveFacet.field;

        if (yField && columnField) {
            const columnGroups = new Map<any, number>();
            for (const row of data) {
                const columnValue = row[columnField];
                const yValue = row[yField];
                if (yValue != null && !isNaN(yValue)) {
                    const currentMax = columnGroups.get(columnValue) || 0;
                    columnGroups.set(columnValue, Math.max(currentMax, Math.abs(yValue)));
                }
            }

            const maxValues = Array.from(columnGroups.values()).filter(v => v > 0);
            if (maxValues.length >= 2) {
                const maxValue = Math.max(...maxValues);
                const minValue = Math.min(...maxValues);
                const ratio = maxValue / minValue;
                if (ratio >= 100 && totalFacets < 6) {
                    if (!vgObj.resolve) vgObj.resolve = {};
                    if (!vgObj.resolve.scale) vgObj.resolve.scale = {};
                    vgObj.resolve.scale.y = "independent";
                }
            }
        }
    }

    // --- Elastic stretch for discrete axes ---
    function computeElasticBudget(totalCount: number, defaultBudget: number): number {
        if (totalCount <= 0) return defaultBudget;
        const pressure = (totalCount * defaultStepSize) / defaultBudget;
        if (pressure <= 1) return defaultBudget;
        const stretch = Math.min(maxStretchVal, Math.pow(pressure, elasticityVal));
        return defaultBudget * stretch;
    }

    // Compute effective step size per axis, covering both discrete and
    // continuous-as-discrete cases.  Continuous axes get their own budget
    // so they don't interfere with discrete step sizing on the other axis.
    function computeAxisStep(nominalCount: number, continuousCount: number, baseDim: number): { step: number; budget: number; count: number } {
        if (nominalCount > 0) {
            const budget = computeElasticBudget(nominalCount, baseDim);
            return { step: Math.floor(budget / nominalCount), budget, count: nominalCount };
        }
        if (continuousCount > 0) {
            const budget = computeElasticBudget(continuousCount, baseDim);
            return { step: Math.floor(budget / continuousCount), budget, count: continuousCount };
        }
        return { step: defaultStepSize, budget: baseDim, count: 0 };
    }

    const xAxis = computeAxisStep(xTotalNominalCount, xContinuousAsDiscrete, subplotWidth);
    const yAxis = computeAxisStep(yTotalNominalCount, yContinuousAsDiscrete, subplotHeight);

    // Step size for VL step-based layout (discrete axes only)
    let stepSize: number;
    if (xTotalNominalCount > 0 && yTotalNominalCount > 0) {
        stepSize = Math.min(xAxis.step, yAxis.step);
    } else if (xTotalNominalCount > 0) {
        stepSize = xAxis.step;
    } else if (yTotalNominalCount > 0) {
        stepSize = yAxis.step;
    } else {
        stepSize = defaultStepSize;
    }
    stepSize = Math.max(minStepVal, Math.min(defaultStepSize, stepSize));

    // For continuous-as-discrete, stretch continuousWidth/Height and set mark dimensions.
    // Use the per-axis effective step (not the shared discrete stepSize).
    // For continuous-as-discrete, stretch continuousWidth/Height and set mark
    // dimensions.  Skip binned axes — VL computes bar width from bin boundaries.
    for (const axis of ['x', 'y'] as const) {
        const count = axis === 'x' ? xContinuousAsDiscrete : yContinuousAsDiscrete;
        if (count <= 0) continue;
        const { budget, step: effStep } = axis === 'x' ? xAxis : yAxis;
        const clampedStep = Math.max(minStepVal, Math.min(defaultStepSize, effStep));
        if (axis === 'x') {
            subplotWidth = Math.round(budget);
        } else {
            subplotHeight = Math.round(budget);
        }
        // Binned axes: VL auto-sizes bars from bin boundaries — skip mark sizing.
        const enc = vgObj.encoding?.[axis];
        if (enc?.bin) continue;

        const sizeKey = allMarkTypes.has('rect')
            ? (axis === 'x' ? 'width' : 'height')
            : 'size';
        const cellSize = Math.max(2, Math.round(clampedStep * 0.8));

        // Apply mark sizing — for layered specs, update each layer's mark
        if (Array.isArray(vgObj.layer)) {
            for (const layer of vgObj.layer) {
                const lm = typeof layer.mark === 'string' ? layer.mark : layer.mark?.type;
                if (lm === 'bar' || lm === 'rect') {
                    if (typeof layer.mark === 'string') {
                        layer.mark = { type: layer.mark, [sizeKey]: cellSize };
                    } else {
                        layer.mark = { ...layer.mark, [sizeKey]: cellSize };
                    }
                }
            }
        } else if (vgObj.mark) {
            if (typeof vgObj.mark === 'string') {
                vgObj.mark = { type: vgObj.mark, [sizeKey]: cellSize };
            } else {
                vgObj.mark = { ...vgObj.mark, [sizeKey]: cellSize };
            }
        }
    }

    // Effective step per axis for label sizing (covers both discrete and continuous-as-discrete)
    const xEffStep = xTotalNominalCount > 0 ? stepSize
        : xContinuousAsDiscrete > 0 ? Math.max(minStepVal, Math.min(defaultStepSize, xAxis.step))
        : defaultStepSize;
    const yEffStep = yTotalNominalCount > 0 ? stepSize
        : yContinuousAsDiscrete > 0 ? Math.max(minStepVal, Math.min(defaultStepSize, yAxis.step))
        : defaultStepSize;

    // Dynamic label sizing
    const defaultLabelFontSize = 10;
    const defaultLabelLimit = 100;

    const xHasDiscreteItems = xTotalNominalCount > 0 || xContinuousAsDiscrete > 0;
    const yHasDiscreteItems = yTotalNominalCount > 0 || yContinuousAsDiscrete > 0;

    let xLabelFontSize = xHasDiscreteItems ? Math.max(6, Math.min(10, xEffStep - 1)) : defaultLabelFontSize;
    let yLabelFontSize = yHasDiscreteItems ? Math.max(6, Math.min(10, yEffStep - 1)) : defaultLabelFontSize;
    let xLabelLimit = xHasDiscreteItems ? Math.max(30, Math.min(100, xEffStep * 8)) : defaultLabelLimit;
    let xLabelAngle: number | undefined = undefined;
    if (xHasDiscreteItems) {
        if (xEffStep < 10) {
            xLabelAngle = -90;
            xLabelFontSize = Math.max(6, Math.min(8, xEffStep));
            xLabelLimit = 40;
        } else if (xEffStep < 16) {
            xLabelAngle = -45;
            xLabelFontSize = Math.max(7, Math.min(9, xEffStep));
            xLabelLimit = 60;
        }
    }

    const axisXConfig: Record<string, any> = { labelLimit: xLabelLimit, labelFontSize: xLabelFontSize };
    if (xLabelAngle !== undefined) {
        axisXConfig.labelAngle = xLabelAngle;
        axisXConfig.labelAlign = "right";
        axisXConfig.labelBaseline = xLabelAngle === -90 ? "middle" : "top";
    }
    const axisYConfig: Record<string, any> = { labelFontSize: yLabelFontSize };

    vgObj.config = {
        view: {
            continuousWidth: subplotWidth,
            continuousHeight: subplotHeight,
            step: stepSize,
            // Hide view border for postProcessor-owned specs (e.g. radar)
            ...(!vgObj.encoding && { stroke: null }),
        },
        axisX: axisXConfig,
        axisY: axisYConfig,
    };

    // Sync hardcoded template width/height to config.view
    if (typeof vgObj.width === 'number') {
        vgObj.config.view.continuousWidth = vgObj.width;
    }
    if (typeof vgObj.height === 'number') {
        vgObj.config.view.continuousHeight = vgObj.height;
    }

    if (totalFacets > 6) {
        vgObj.config.header = { labelLimit: 120, labelFontSize: 9 };
    }

    // Reduce clutter in faceted charts
    // For layered specs, encoding may be nested under vgObj.spec.encoding
    const encTarget = vgObj.spec?.encoding || vgObj.encoding;
    if (facetRows > 1 && encTarget) {
        if (!encTarget.y?.axis) {
            if (encTarget.y) encTarget.y.axis = {};
        }
        if (encTarget.y?.axis !== undefined) {
            encTarget.y.axis.title = null;
        }
    }
    if (facetCols > 1 && encTarget) {
        if (!encTarget.x?.axis) {
            if (encTarget.x) encTarget.x.axis = {};
        }
        if (encTarget.x?.axis !== undefined) {
            encTarget.x.axis.title = null;
        }
    }

    if (addTooltips) {
        if (!vgObj.config) vgObj.config = {};
        vgObj.config.mark = { ...vgObj.config.mark, tooltip: true };
    }

    // --- Rect mark edge-to-edge tiling ---
    // (markType already declared above for bar/rect stretch)
    if (markType === 'rect') {
        const contWidth = vgObj.config?.view?.continuousWidth || defaultChartWidth;
        const contHeight = vgObj.config?.view?.continuousHeight || defaultChartHeight;

        for (const axis of ['x', 'y'] as const) {
            const enc = vgObj.encoding?.[axis];
            if (!enc?.field) continue;
            const t = enc.type;
            if (t === 'nominal' || t === 'ordinal') continue;
            if (enc.aggregate) continue;

            const uniqueVals = [...new Set(values.map((r: any) => r[enc.field]))];
            const cardinality = uniqueVals.length;
            if (cardinality <= 1) continue;

            const dim = axis === 'x' ? contWidth : contHeight;
            const cellSize = Math.max(1, Math.round(dim / cardinality));
            const sizeKey = axis === 'x' ? 'width' : 'height';
            if (typeof vgObj.mark === 'string') {
                vgObj.mark = { type: vgObj.mark, [sizeKey]: cellSize };
            } else {
                vgObj.mark = { ...vgObj.mark, [sizeKey]: cellSize };
            }

            // Prevent VL from expanding the domain beyond the data range.
            // For temporal axes this avoids gaps; for quantitative it keeps
            // cells aligned with tick marks. A small pixel padding (2px)
            // prevents edge marks from colliding with the axis line.
            if (!enc.scale) enc.scale = {};
            enc.scale.nice = false;
            enc.scale.padding = 2;
        }
    }

    // --- Boxplot mark sizing ---
    if (markType === 'boxplot' && (xTotalNominalCount > 0 || yTotalNominalCount > 0)) {
        const boxSize = Math.max(4, Math.round(stepSize * 0.7));
        if (typeof vgObj.mark === 'string') {
            vgObj.mark = { type: vgObj.mark, size: boxSize };
        } else {
            vgObj.mark = { ...vgObj.mark, size: boxSize };
        }
    }

    // --- Attach warnings ---
    const result: any = { ...vgObj, data: { values } };
    if (warnings.length > 0) {
        result._warnings = warnings;
    }
    return result;
}
