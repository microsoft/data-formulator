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

import { Chart, ChartStyleVariant, VariantConfigControl, FieldItem, DictTable, computeEncodingFingerprint } from '../components/ComponentType';
import { assembleVegaChart, getUrls } from './utils';
import { apiRequest } from './apiClient';
import { checkChartAvailability } from '../views/ChartUtils';

/**
 * Compute the data values that the assemble pipeline embeds into a chart's
 * Vega-Lite spec for this (chart, table) pair.
 *
 * Why this exists: `assembleVegaChart` runs `convertTemporalData` and other
 * format normalizations (e.g. Year 1980 → "1980") on the rows before
 * embedding them. Style variants are stored with their `data` block stripped,
 * so naively re-attaching `table.rows` at render time skips those
 * conversions — the variant's baked-in axis formats and date encodings then
 * mismatch the data and the chart looks wrong (e.g. years rendered as
 * sub-year ticks). Use this helper as the single source of truth for the
 * data that should be plugged into a variant spec, and for the data sample
 * shown to the restyle agent (so the sample matches what is actually
 * rendered).
 *
 * Returns the unmodified rows if assembly fails, so callers always get
 * something back.
 */
export function buildEmbeddedDataForChart(
    chart: Chart,
    rows: any[],
    tableMetadata: any,
    conceptShelfItems: FieldItem[],
): any[] {
    const fullSpec = assembleVegaChart(
        chart.chartType,
        chart.encodingMap,
        conceptShelfItems,
        rows,
        tableMetadata,
        300, 300, false, chart.config,
    );
    if (!fullSpec || fullSpec === 'Table') return rows;
    const values = (fullSpec as any)?.data?.values;
    return Array.isArray(values) ? values : rows;
}

/**
 * Build the Vega-Lite spec to send to the restyle agent.
 *
 * - If `basedOnVariant` is provided (stacking edits or refreshing a stale
 *   variant), we start from that variant's stored spec.
 * - Otherwise we assemble the chart's default spec from its encoding map.
 *
 * In both cases the `data` block is stripped before sending — the agent
 * never sees row content; the renderer re-attaches live data on output.
 *
 * `embeddedData` is the post-conversion data values the assemble pipeline
 * would embed for this chart (see `buildEmbeddedDataForChart`). Callers use
 * it both as the source for the agent's data sample and as the values to
 * re-attach when rendering the returned variant spec, so the sample seen by
 * the agent and the rows actually rendered stay aligned.
 */
export function buildSpecForRestyle(
    chart: Chart,
    table: DictTable,
    conceptShelfItems: FieldItem[],
    basedOnVariant?: ChartStyleVariant,
): { spec: any; basedOnVariantId?: string; embeddedData: any[] } | null {
    if (!table) return null;
    if (!checkChartAvailability(chart, conceptShelfItems, table.rows)) return null;

    const fullSpec = assembleVegaChart(
        chart.chartType,
        chart.encodingMap,
        conceptShelfItems,
        table.rows,
        table.metadata,
        300, 300, true, chart.config,
    );
    if (!fullSpec || fullSpec === 'Table') return null;
    const embeddedValues = (fullSpec as any)?.data?.values;
    const embeddedData: any[] = Array.isArray(embeddedValues) ? embeddedValues : table.rows;

    let spec: any;
    if (basedOnVariant) {
        spec = JSON.parse(JSON.stringify(basedOnVariant.vlSpec));
    } else {
        spec = JSON.parse(JSON.stringify(fullSpec));
        delete spec._options;
    }
    delete spec.data;
    return { spec, basedOnVariantId: basedOnVariant?.id, embeddedData };
}

/**
 * Build the small data sample the agent uses to reason about value ranges,
 * label sizes, and formatting without seeing the whole table.
 *
 * `embeddedData` (when provided) should be the post-conversion values that
 * `assembleVegaChart` would embed in the spec — see
 * `buildEmbeddedDataForChart`. Sampling from it (instead of `table.rows`)
 * lets the agent see the same string forms it will see in the spec (e.g.
 * Year as `"1980"` not `1980`), which keeps any axis formats it suggests
 * consistent with the data the renderer actually plugs in.
 */
export function buildDataContext(
    table: DictTable,
    embeddedData?: any[],
): { dataSample: any[] } {
    const source = embeddedData && embeddedData.length > 0 ? embeddedData : table.rows;
    const dataSample = source.slice(0, 10);
    return { dataSample };
}

export type RestyleResult =
    | { kind: 'spec'; vlSpec: any; rationale?: string; label?: string; configUI?: VariantConfigControl[] }
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
        configUI: sanitizeConfigUI(data.configUI),
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
    configUI?: VariantConfigControl[];
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
        configUI: args.configUI && args.configUI.length > 0 ? args.configUI : undefined,
        configValues: undefined,
    };
}

// ---------------------------------------------------------------------------
// Variant generative-UI controls (path-based, no code execution)
// ---------------------------------------------------------------------------

// Object keys that must never be used as a path segment — writing to these can
// pollute Object.prototype and is a classic prototype-pollution sink.
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Validate and normalize the `configUI` array returned by the restyle agent.
 * Drops anything malformed (bad path, missing params, prototype-polluting
 * segments) so a bad LLM payload can't produce broken or unsafe controls.
 * Returns undefined when there are no usable controls.
 */
export function sanitizeConfigUI(raw: any): VariantConfigControl[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const out: VariantConfigControl[] = [];
    const seenKeys = new Set<string>();
    for (const c of raw) {
        if (!c || typeof c !== 'object') continue;
        const key = typeof c.key === 'string' ? c.key.trim() : '';
        const label = typeof c.label === 'string' ? c.label.trim() : '';
        if (!key || !label || seenKeys.has(key)) continue;

        // Path must be a non-empty array of strings/numbers with no
        // prototype-polluting segments.
        if (!Array.isArray(c.path) || c.path.length === 0) continue;
        const path: (string | number)[] = [];
        let pathOk = true;
        for (const seg of c.path) {
            if (typeof seg === 'number' && Number.isInteger(seg) && seg >= 0) {
                path.push(seg);
            } else if (typeof seg === 'string' && seg.length > 0 && !FORBIDDEN_PATH_SEGMENTS.has(seg)) {
                path.push(seg);
            } else {
                pathOk = false;
                break;
            }
        }
        if (!pathOk) continue;

        if (c.type === 'binary') {
            out.push({ key, label, path, type: 'binary', defaultValue: !!c.defaultValue });
        } else if (c.type === 'continuous') {
            const min = Number(c.min), max = Number(c.max);
            if (!isFinite(min) || !isFinite(max) || max <= min) continue;
            const step = isFinite(Number(c.step)) && Number(c.step) > 0 ? Number(c.step) : undefined;
            const dv = isFinite(Number(c.defaultValue)) ? Number(c.defaultValue) : min;
            out.push({ key, label, path, type: 'continuous', min, max, step, defaultValue: dv });
        } else if (c.type === 'discrete') {
            if (!Array.isArray(c.options) || c.options.length === 0) continue;
            const options = c.options
                .filter((o: any) => o && typeof o === 'object' && typeof o.label === 'string')
                .map((o: any) => ({ value: o.value, label: o.label }));
            if (options.length === 0) continue;
            const dv = c.defaultValue !== undefined ? c.defaultValue : options[0].value;
            out.push({ key, label, path, type: 'discrete', options, defaultValue: dv });
        } else {
            continue;
        }
        seenKeys.add(key);
    }
    return out.length > 0 ? out : undefined;
}

/**
 * Write `value` into `obj` at `path`, creating intermediate objects/arrays as
 * needed. Pure data operation — no code execution. Returns true on success.
 *
 * Safety: refuses prototype-polluting segments and won't descend through a
 * non-object intermediate it can't safely replace.
 */
function setAtPath(obj: any, path: (string | number)[], value: any): boolean {
    if (!obj || typeof obj !== 'object' || path.length === 0) return false;
    let node = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const seg = path[i];
        if (typeof seg === 'string' && FORBIDDEN_PATH_SEGMENTS.has(seg)) return false;
        let next = node[seg as any];
        if (next === null || typeof next !== 'object') {
            // Create the right container based on the next segment's type.
            next = typeof path[i + 1] === 'number' ? [] : {};
            node[seg as any] = next;
        }
        node = next;
    }
    const last = path[path.length - 1];
    if (typeof last === 'string' && FORBIDDEN_PATH_SEGMENTS.has(last)) return false;
    node[last as any] = value;
    return true;
}

/**
 * Apply a variant's generative-UI controls to its Vega-Lite spec.
 *
 * For each control we write the current value (from `configValues`, falling
 * back to `defaultValue`) into the spec at the control's `path`. The value may
 * be a scalar or a whole object. This is a pure, declarative transform — no
 * model-authored code runs. Returns a NEW spec; never mutates the input.
 */
export function applyVariantConfigUI(
    spec: any,
    configUI: VariantConfigControl[] | undefined,
    configValues: Record<string, any> | undefined,
): any {
    if (!configUI || configUI.length === 0) return spec;
    let working: any;
    try { working = structuredClone(spec); } catch { working = JSON.parse(JSON.stringify(spec)); }
    for (const control of configUI) {
        const value = configValues && control.key in configValues
            ? configValues[control.key]
            : control.defaultValue;
        try {
            setAtPath(working, control.path, value);
        } catch (err) {
            console.warn(`[variant-config] control "${control.key}" failed to apply`, err);
        }
    }
    return working;
}
