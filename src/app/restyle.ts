// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart restyle helpers — used by both the input-bubble brush button
 * (EncodingShelfCard) and the stale-variant overlay (VisualizationView).
 *
 * Centralizes the request payload shape and response handling for
 * /api/agent/chart-restyle so the two callers stay consistent.
 *
 * See design-docs/28-chart-style-refinement-agent.md.
 */

import { Chart, ChartStyleVariant, FieldItem, DictTable, computeEncodingFingerprint } from '../components/ComponentType';
import { assembleVegaChart, getUrls } from './utils';
import { apiRequest } from './apiClient';
import { checkChartAvailability } from '../views/ChartUtils';

/**
 * Build the Vega-Lite spec to send to the restyle agent.
 *
 * - If `basedOnVariant` is provided (stacking edits or refreshing a stale
 *   variant), we start from that variant's stored spec.
 * - Otherwise we assemble the chart's default spec from its encoding map.
 *
 * In both cases the `data` block is stripped before sending — the agent
 * never sees row content; the renderer re-attaches live data on output.
 */
export function buildSpecForRestyle(
    chart: Chart,
    table: DictTable,
    conceptShelfItems: FieldItem[],
    basedOnVariant?: ChartStyleVariant,
): { spec: any; basedOnVariantId?: string } | null {
    if (!table) return null;
    if (!checkChartAvailability(chart, conceptShelfItems, table.rows)) return null;

    let spec: any;
    if (basedOnVariant) {
        spec = JSON.parse(JSON.stringify(basedOnVariant.vlSpec));
    } else {
        const fullSpec = assembleVegaChart(
            chart.chartType,
            chart.encodingMap,
            conceptShelfItems,
            table.rows,
            table.metadata,
            300, 300, true, chart.config,
        );
        if (!fullSpec || fullSpec === 'Table') return null;
        spec = JSON.parse(JSON.stringify(fullSpec));
        delete spec._computedConfig;
    }
    delete spec.data;
    return { spec, basedOnVariantId: basedOnVariant?.id };
}

/**
 * Build the small data-sample + dtype-map payload the agent uses to reason
 * about ranges and label sizes without seeing the whole table.
 */
export function buildDataContext(table: DictTable): {
    dataSample: any[];
    columnDtypes: Record<string, string>;
} {
    const dataSample = table.rows.slice(0, 10);
    const columnDtypes: Record<string, string> = {};
    for (const [name, meta] of Object.entries(table.metadata || {})) {
        const dtype = (meta as any)?.type ?? (meta as any)?.dtype;
        if (dtype) columnDtypes[name] = String(dtype);
    }
    return { dataSample, columnDtypes };
}

export type RestyleResult =
    | { kind: 'spec'; vlSpec: any; rationale?: string; label?: string }
    | { kind: 'out_of_scope'; rationale?: string };

/**
 * Call the restyle agent. Returns either a new vlSpec (caller decides what
 * to do with it: append a new variant, or refresh an existing one) or an
 * out-of-scope signal (caller should surface a message and not mutate state).
 *
 * Throws on transport/HTTP errors — caller handles those.
 */
export async function callRestyleAgent(args: {
    instruction: string;
    vlSpec: any;
    chartType: string;
    dataSample: any[];
    columnDtypes: Record<string, string>;
    model: any;
    /** Optional. When refreshing a stale variant, pass the old variant's
     *  vlSpec here so the agent preserves its visual choices. */
    styleReferenceSpec?: any;
}): Promise<RestyleResult> {
    const { data } = await apiRequest(getUrls().CHART_RESTYLE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            instruction: args.instruction,
            vlSpec: args.vlSpec,
            chartType: args.chartType,
            dataSample: args.dataSample,
            columnDtypes: args.columnDtypes,
            styleReferenceSpec: args.styleReferenceSpec,
            model: args.model,
        }),
    });

    if (data?.out_of_scope) {
        return {
            kind: 'out_of_scope',
            rationale: typeof data.rationale === 'string' ? data.rationale : undefined,
        };
    }

    const newSpec = data?.vlSpec;
    if (!newSpec || typeof newSpec !== 'object') {
        throw new Error('Style agent did not return a usable spec.');
    }

    return {
        kind: 'spec',
        vlSpec: newSpec,
        rationale: typeof data.rationale === 'string' ? data.rationale : undefined,
        label: typeof data.label === 'string' ? data.label : undefined,
    };
}

/** Build a fresh ChartStyleVariant record from a successful agent response. */
export function makeVariant(args: {
    chart: Chart;
    prompt: string;
    vlSpec: any;
    rationale?: string;
    label: string;
    basedOnVariantId?: string;
}): ChartStyleVariant {
    return {
        id: `v-${Date.now()}`,
        label: args.label,
        prompt: args.prompt,
        vlSpec: args.vlSpec,
        basedOnVariantId: args.basedOnVariantId,
        encodingFingerprint: computeEncodingFingerprint(args.chart),
        createdAt: Date.now(),
        rationale: args.rationale,
    };
}
