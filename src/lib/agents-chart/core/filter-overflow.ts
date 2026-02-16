// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * =============================================================================
 * OVERFLOW FILTERING
 * =============================================================================
 *
 * Determines which discrete values to keep when there are too many for
 * the available canvas space, then filters the data accordingly.
 *
 * Runs AFTER declareLayoutMode (so type overrides and additional encodings
 * are known) and BEFORE computeLayout and buildVLEncodings.
 *
 * VL dependency: **None** — works on abstract channel semantics and
 * LayoutDeclaration, not on VL encoding objects.
 * =============================================================================
 */

import type {
    ChannelSemantics,
    ChartEncoding,
    LayoutDeclaration,
    AssembleOptions,
    TruncationWarning,
    OverflowResult,
    OverflowStrategy,
    OverflowStrategyContext,
} from './types';
import type { ChartWarning } from './types';
import { inferVisCategory } from './semantic-types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Filter data to keep only the values that fit within the canvas.
 *
 * @param channelSemantics  Phase 0 output (field, type per channel)
 * @param declaration       Template layout declaration (resolvedTypes, grouping, overflowStrategy)
 * @param encodings         Original user-level encodings (for sort info)
 * @param data              Full data table
 * @param canvasSize        Target canvas dimensions
 * @param options           Assembly options (merged with declaration.paramOverrides)
 * @param allMarkTypes      Set of all mark types in the template (for connected-mark detection)
 * @returns                 OverflowResult with filtered data, nominal counts, truncations, and warnings
 */
export function filterOverflow(
    channelSemantics: Record<string, ChannelSemantics>,
    declaration: LayoutDeclaration,
    encodings: Record<string, ChartEncoding>,
    data: any[],
    canvasSize: { width: number; height: number },
    options: AssembleOptions,
    allMarkTypes: Set<string>,
): OverflowResult {
    const {
        maxStretch: maxStretchVal = 2,
        facetMaxStretch: facetMaxStretchVal = 1.5,
        minStep: minStepVal = 6,
        minSubplotSize: minSubplotVal = 60,
    } = options;

    const chartWidth = canvasSize.width;
    const chartHeight = canvasSize.height;

    const maxFacetColumns = Math.max(2, Math.floor(chartWidth * facetMaxStretchVal / minSubplotVal));
    const maxFacetRows = Math.max(2, Math.floor(chartHeight * facetMaxStretchVal / minSubplotVal));
    const maxFacetNominalValues = maxFacetColumns * maxFacetRows;

    // --- Build effective channel info from semantics + declaration ---

    const effectiveType = (ch: string): string | undefined =>
        declaration.resolvedTypes?.[ch] ?? channelSemantics[ch]?.type;

    const effectiveField = (ch: string): string | undefined => {
        if (channelSemantics[ch]?.field) return channelSemantics[ch].field;
        return undefined;
    };

    const isDiscreteType = (t: string | undefined) => t === 'nominal' || t === 'ordinal';

    // --- Grouping detection: if 'group' channel exists, find discrete axis ---
    const groupField = channelSemantics.group?.field;
    let groupCount = 0;
    let groupAxis: 'x' | 'y' | undefined;
    if (groupField) {
        groupCount = new Set(data.map(r => r[groupField])).size;
        // Grouping subdivides whichever positional axis is discrete
        if (isDiscreteType(effectiveType('x'))) groupAxis = 'x';
        else if (isDiscreteType(effectiveType('y'))) groupAxis = 'y';
    }

    const xGroupMultiplier = (groupAxis === 'x' && groupCount > 1) ? groupCount : 1;
    const yGroupMultiplier = (groupAxis === 'y' && groupCount > 1) ? groupCount : 1;

    const xMinGroupStep = xGroupMultiplier > 1 ? 2 * xGroupMultiplier : minStepVal;
    const yMinGroupStep = yGroupMultiplier > 1 ? 2 * yGroupMultiplier : minStepVal;
    const maxXToKeep = Math.floor(chartWidth * maxStretchVal / xMinGroupStep);
    const maxYToKeep = Math.floor(chartHeight * maxStretchVal / yMinGroupStep);

    // --- Filter data ---

    const nominalCounts: Record<string, number> = {
        x: 0, y: 0, column: 0, row: 0, group: 0,
    };
    const truncations: TruncationWarning[] = [];
    const warnings: ChartWarning[] = [];
    let filteredData = data;

    // Compute group nominal count
    if (groupCount > 0) {
        nominalCounts.group = groupCount;
    }

    // Strategy context for custom or default overflow
    const strategyContext: OverflowStrategyContext = {
        data,
        channelSemantics,
        encodings,
        allMarkTypes,
    };

    const strategy = declaration.overflowStrategy ?? defaultOverflowStrategy;

    for (const channel of ['x', 'y', 'column', 'row', 'color'] as const) {
        const fieldName = effectiveField(channel);
        const type = effectiveType(channel);
        if (!fieldName || !isDiscreteType(type)) continue;

        const hasRow = !!effectiveField('row');
        const columnCap = hasRow ? maxFacetColumns : maxFacetNominalValues;
        const maxToKeep = channel === 'x' ? maxXToKeep
            : channel === 'y' ? maxYToKeep
            : channel === 'row' ? maxFacetRows
            : channel === 'column' ? columnCap
            : maxFacetNominalValues;

        const uniqueValues = [...new Set(filteredData.map(r => r[fieldName]))];
        nominalCounts[channel] = Math.min(uniqueValues.length, maxToKeep);

        if (uniqueValues.length > maxToKeep) {
            const valuesToKeep = strategy(channel, fieldName, uniqueValues, maxToKeep, strategyContext);

            const omittedCount = uniqueValues.length - valuesToKeep.length;
            const placeholder = `...${omittedCount} items omitted`;

            warnings.push({
                severity: 'warning',
                code: 'overflow',
                message: `${omittedCount} of ${uniqueValues.length} values in '${fieldName}' were omitted (showing top ${valuesToKeep.length}).`,
                channel,
                field: fieldName,
            });

            truncations.push({
                severity: 'warning',
                code: 'overflow',
                message: `${omittedCount} of ${uniqueValues.length} values in '${fieldName}' were omitted (showing top ${valuesToKeep.length}).`,
                channel,
                field: fieldName,
                keptValues: valuesToKeep,
                omittedCount,
                placeholder,
            });

            // Filter data rows (except for color — we keep all rows but style the legend)
            if (channel !== 'color') {
                filteredData = filteredData.filter(row => valuesToKeep.includes(row[fieldName]));
            }
        }
    }

    return { filteredData, nominalCounts, truncations, warnings };
}

// ---------------------------------------------------------------------------
// Default overflow strategy
// ---------------------------------------------------------------------------

/**
 * Default overflow strategy: decides which discrete values to keep.
 *
 * - Connected marks (line/area/trail): preserve natural order (first N)
 * - User-specified sort: respect it
 * - Auto-sort: sort by quantitative opposite axis or color, keep top N
 * - Bar charts: sum-aggregate for sort (total bar height matters)
 */
const defaultOverflowStrategy: OverflowStrategy = (
    channel, fieldName, uniqueValues, maxToKeep, context,
) => {
    const { data, channelSemantics, encodings, allMarkTypes } = context;

    // Connected marks need chronological/natural order preserved
    const hasConnectedMark = allMarkTypes.has('line') || allMarkTypes.has('area') || allMarkTypes.has('trail');

    // Determine sort intent from user encodings
    const encoding = encodings[channel];
    const sortBy = encoding?.sortBy;
    const sortOrder = encoding?.sortOrder;

    // Infer sort field and direction
    let sortField: string | undefined;
    let sortFieldType: string | undefined;
    let isDescending = true;

    if (sortBy) {
        // User explicitly specified sort
        if (sortBy === 'x' || sortBy === 'y' || sortBy === 'color') {
            const sortCS = channelSemantics[sortBy];
            sortField = sortCS?.field;
            sortFieldType = sortCS?.type;
            isDescending = sortOrder === 'descending' || (sortOrder !== 'ascending' && sortBy !== channel);
        } else {
            // Custom sort list — respect insertion order
            try {
                const sortedList = JSON.parse(sortBy);
                if (Array.isArray(sortedList)) {
                    const orderedValues = (sortOrder === 'descending') ? sortedList.reverse() : sortedList;
                    return orderedValues.filter((v: any) => uniqueValues.includes(v)).slice(0, maxToKeep);
                }
            } catch {
                // not a JSON list, fall through
            }
            isDescending = sortOrder === 'descending';
        }
    } else {
        // Auto-detect sort: quantitative opposite axis or quantitative color
        const oppositeChannel = channel === 'x' ? 'y' : channel === 'y' ? 'x' : undefined;

        const colorCS = channelSemantics.color;
        const oppositeCS = oppositeChannel ? channelSemantics[oppositeChannel] : undefined;

        // For rect marks (heatmaps), color is the primary value — don't auto-sort by it
        const markType = allMarkTypes.has('rect') ? 'rect' : undefined;
        if (markType !== 'rect' && colorCS?.type === 'quantitative') {
            sortField = colorCS.field;
            sortFieldType = colorCS.type;
        } else if (oppositeCS?.type === 'quantitative') {
            sortField = oppositeCS.field;
            sortFieldType = oppositeCS.type;
        } else {
            isDescending = false;
        }
    }

    // For quantitative field values treated as nominal, sort numerically
    const fieldOriginalType = inferVisCategory(data.map(r => r[fieldName]));
    if (fieldOriginalType === 'quantitative' || channel === 'color') {
        return uniqueValues.sort((a, b) => a - b)
            .slice(0, channel === 'color' ? 24 : maxToKeep);
    }

    // Facet channels: first N
    if (channel === 'column' || channel === 'row') {
        return uniqueValues.slice(0, maxToKeep);
    }

    // Connected marks: preserve natural order
    if (hasConnectedMark) {
        return uniqueValues.slice(0, maxToKeep);
    }

    // Sort by aggregate of the quantitative sort field
    if (sortField && sortFieldType === 'quantitative') {
        // Bar charts: sum aggregate (total bar height). Others: max.
        let aggregateOp = Math.max;
        let initialValue = -Infinity;
        if (allMarkTypes.has('bar') && sortField !== channelSemantics.color?.field) {
            aggregateOp = (x: number, y: number) => x + y;
            initialValue = 0;
        }

        const valueAggregates = new Map<string, number>();
        for (const row of data) {
            const fieldValue = row[fieldName];
            const sortValue = row[sortField] || 0;
            if (valueAggregates.has(fieldValue)) {
                valueAggregates.set(fieldValue, aggregateOp(valueAggregates.get(fieldValue)!, sortValue));
            } else {
                valueAggregates.set(fieldValue, aggregateOp(initialValue, sortValue));
            }
        }

        return Array.from(valueAggregates.entries())
            .map(([value, agg]) => ({ value, agg }))
            .sort((a, b) => isDescending ? b.agg - a.agg : a.agg - b.agg)
            .slice(0, maxToKeep)
            .map(v => v.value);
    }

    // Descending explicit sort: reverse then take first N
    if (sortOrder === 'descending') {
        return uniqueValues.reverse().slice(0, maxToKeep);
    }

    // Default: first N values
    return uniqueValues.slice(0, maxToKeep);
};
