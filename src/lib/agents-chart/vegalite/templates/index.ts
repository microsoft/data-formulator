// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Template registry — collects all chart template definitions.
 * No UI/icon dependencies. This is the pure-data template catalog.
 *
 * Each template file exports individual ChartTemplateDef objects.
 * Categories are defined here to group related charts in the UI.
 */

import { ChartTemplateDef } from '../../core/types';
import type { ChartPropertyDef, OptionEvalContext } from '../../core/types';

// --- Individual chart imports ---
import { scatterPlotDef, regressionDef, rangedDotPlotDef, boxplotDef } from './scatter';
import { barChartDef, pyramidChartDef, groupedBarChartDef, stackedBarChartDef, histogramDef, heatmapDef } from './bar';
import { lineChartDef } from './line';
import { bumpChartDef } from './bump';
import { areaChartDef, streamgraphDef } from './area';
import { pieChartDef } from './pie';
import { lollipopChartDef } from './lollipop';
import { densityPlotDef } from './density';
import { stripPlotDef } from './jitter';
import { candlestickChartDef } from './candlestick';
import { waterfallChartDef } from './waterfall';
import { barTableDef } from './bar-table';
import { radarChartDef } from './radar';
import { roseChartDef } from './rose';
import { usMapDef, worldMapDef } from './map';
import { customPointDef, customLineDef, customBarDef, customRectDef, customAreaDef } from './custom';
import { kpiCardDef } from './kpi-card';

/**
 * Cross-cutting properties injected into every template that supports
 * column/row faceting. `independentYAxis` lets the user give each facet its own
 * y-scale. Its `check` reports *applicability* purely (the chart is faceted
 * *and* its y is quantitative); the recommended default — whether to turn it on
 * by default — is layout-coupled (it depends on the resolved facet grid and the
 * per-facet range spread) and is supplied by the compiler at assembly time.
 */
const FACET_AXIS_PROPERTIES: ChartPropertyDef[] = [
    {
        key: 'independentYAxis', label: 'Independent Y', type: 'binary',
        check: (ctx) => ({
            applicable:
                (!!ctx.encodings.column?.field || !!ctx.encodings.row?.field) &&
                ctx.channelSemantics?.y?.type === 'quantitative',
        }),
    },
];

/**
 * Cross-cutting per-axis log-scale controls, injected into every
 * position-cognitive template (scatter/line/strip — never length/area marks,
 * where a zero baseline matters). Their `check` decides per render which axes
 * are eligible (continuous quantitative, wide-range data) and reports the
 * recommended default. Each is a simple on/off toggle: ON forces a log/symlog
 * scale, OFF forces linear.
 */
function makeLogScaleCheck(axis: 'x' | 'y') {
    return (ctx: OptionEvalContext): { applicable: boolean; recommendedValue?: any } => {
        const cs = ctx.channelSemantics?.[axis];
        if (!cs?.field || cs.type !== 'quantitative') return { applicable: false };
        let posMin = Infinity, posMax = -Infinity, posCount = 0, hasNegative = false;
        for (const row of ctx.data ?? []) {
            const v = row[cs.field];
            if (typeof v !== 'number' || !isFinite(v)) continue;
            if (v < 0) hasNegative = true;
            else if (v > 0) { posCount++; if (v < posMin) posMin = v; if (v > posMax) posMax = v; }
        }
        // Offer only on non-negative data with enough positive spread (≥ 3
        // orders of magnitude); log is undefined for negatives.
        const offerEligible = !hasNegative && posCount >= 5 && posMax / posMin >= 1000;
        const choice = ctx.chartProperties?.[`logScale_${axis}`];
        // The engine's recommendation survives in cs.scaleType whenever it
        // matters: an unset choice never overrides it, and a set choice wins via
        // chartProperties anyway (so recommendedValue is moot in that case).
        const recommendsLog = cs.scaleType === 'log' || cs.scaleType === 'symlog';
        return {
            applicable: offerEligible || choice === true || choice === false,
            recommendedValue: recommendsLog,
        };
    };
}

const LOG_SCALE_PROPERTIES: ChartPropertyDef[] = [
    {
        key: 'logScale_x', label: 'Log X', type: 'binary', defaultValue: false,
        check: makeLogScaleCheck('x'),
    },
    {
        key: 'logScale_y', label: 'Log Y', type: 'binary', defaultValue: false,
        check: makeLogScaleCheck('y'),
    },
];

/**
 * Cross-cutting per-axis zero-baseline controls, injected into every
 * position-cognitive template (scatter/line/strip — never length/area marks,
 * where the baseline is structurally required). Each is an on/off toggle: ON
 * anchors the axis at zero, OFF lets it fit the data range.
 *
 * The control is *passive*: it never re-derives a zero recommendation of its
 * own. The engine already decided (computeZeroDecision → cs.zero); the `check`
 * just reads that decision. To keep the UI uncluttered it offers the toggle
 * ONLY when the engine flags the choice as a genuine toss-up worth surfacing
 * (`cs.zero.uncertain === true`) — i.e. a zero-meaningful field on a position
 * mark whose data sits far enough from zero that anchoring at zero would
 * noticeably compress the view. Every other case (arbitrary types where zero is
 * meaningless, contextual data-range calls, meaningful data that already spans
 * to zero, and forced/unknown cases) is hidden, since there is nothing to
 * debate. The recommended default is the engine's own `cs.zero.zero`. Once the
 * host has set an explicit value the toggle stays visible so the choice can be
 * reverted.
 */
function makeZeroBaselineCheck(axis: 'x' | 'y') {
    return (ctx: OptionEvalContext): { applicable: boolean; recommendedValue?: any } => {
        const cs = ctx.channelSemantics?.[axis];
        if (!cs?.field || cs.type !== 'quantitative') return { applicable: false };
        const decision = cs.zero;
        if (!decision) return { applicable: false };
        const choice = ctx.chartProperties?.[`includeZero_${axis}`];
        return {
            applicable: decision.uncertain || choice === true || choice === false,
            recommendedValue: decision.zero,
        };
    };
}

const ZERO_BASELINE_PROPERTIES: ChartPropertyDef[] = [
    {
        key: 'includeZero_x', label: 'Zero X', type: 'binary',
        check: makeZeroBaselineCheck('x'),
    },
    {
        key: 'includeZero_y', label: 'Zero Y', type: 'binary',
        check: makeZeroBaselineCheck('y'),
    },
];

/**
 * Cross-cutting X-axis dtype toggle, injected into banded/categorical-x
 * templates (bar, line, area, lollipop) whose category axis carries a genuine
 * *dual* interpretation: a date-like field the resolver classified as
 * `temporal` but whose distinct values also form a modest, readable set of
 * discrete labels (e.g. year-month buckets like "2010-01"). The control lets
 * the user force that axis between a continuous time scale (`temporal`) and
 * discrete bands (`nominal`). It applies to *either* position axis — x on a
 * vertical bar/line, y on a horizontal (transposed) bar/lollipop. The chosen
 * value is applied at the *encoding* level (encoding.<axis>.type) by the
 * assembler, so the whole pipeline — sorting, layout, formatting — honors the
 * override (resolveChannelSemantics treats an explicit encoding.type as
 * authoritative). See assembleVegaLite.
 *
 * Charts that qualify (a position axis is a discrete-capable band that also
 * accepts a continuous time scale).
 */
const AXIS_DTYPE_CHARTS = new Set([
    'Bar Chart', 'Line Chart', 'Area Chart', 'Lollipop Chart',
]);

/** Above this distinct-value count, discrete bands are unreadable — only the
 *  continuous time scale makes sense, so the toggle is not offered. */
const AXIS_DTYPE_MAX_CATEGORIES = 50;

function makeAxisDtypeCheck(axis: 'x' | 'y') {
    return (ctx: OptionEvalContext): { applicable: boolean; recommendedValue?: any } => {
        const cs = ctx.channelSemantics?.[axis];
        if (!cs?.field) return { applicable: false };
        // Once the user picks a value the override flips cs.type, so keep
        // the control visible on any explicit choice.
        const choice = ctx.chartProperties?.[`${axis}AxisType`];
        if (choice != null) return { applicable: true, recommendedValue: 'temporal' };
        // Otherwise offer only the genuine dual-interpretation case: a
        // date-like axis the resolver made temporal, with a modest number of
        // distinct values so discrete bands stay readable.
        if (cs.type !== 'temporal') return { applicable: false };
        const distinct = new Set(
            (ctx.data ?? []).map(r => r[cs.field]).filter(v => v != null && v !== ''),
        );
        const dual = distinct.size >= 2 && distinct.size <= AXIS_DTYPE_MAX_CATEGORIES;
        return { applicable: dual, recommendedValue: 'temporal' };
    };
}

const AXIS_DTYPE_PROPERTIES: ChartPropertyDef[] = [
    {
        key: 'xAxisType', label: 'X as', type: 'discrete',
        options: [
            { value: 'temporal', label: 'Temporal' },
            { value: 'nominal', label: 'Discrete' },
        ],
        check: makeAxisDtypeCheck('x'),
    },
    {
        key: 'yAxisType', label: 'Y as', type: 'discrete',
        options: [
            { value: 'temporal', label: 'Temporal' },
            { value: 'nominal', label: 'Discrete' },
        ],
        check: makeAxisDtypeCheck('y'),
    },
];

/**
 * Attach the cross-cutting properties (faceting, log scale, axis dtype) a
 * template qualifies for, based on its channels and mark-cognitive role. Keeps
 * these options co-located with the engine that evaluates them, so a downstream
 * consumer of Flint sees a self-describing template catalog. Idempotent:
 * any property the template already declares with the same key wins.
 */
function withInjectedProperties(def: ChartTemplateDef): ChartTemplateDef {
    const hasFacetChannels = def.channels?.some(ch => ch === 'column' || ch === 'row');
    const isPosition = def.markCognitiveChannel === 'position';
    const wantsAxisDtype = AXIS_DTYPE_CHARTS.has(def.chart);
    const extra: ChartPropertyDef[] = [
        ...(hasFacetChannels ? FACET_AXIS_PROPERTIES : []),
        ...(isPosition ? LOG_SCALE_PROPERTIES : []),
        ...(isPosition ? ZERO_BASELINE_PROPERTIES : []),
        ...(wantsAxisDtype ? AXIS_DTYPE_PROPERTIES : []),
    ];
    if (extra.length === 0) return def;
    const ownKeys = new Set((def.properties ?? []).map(p => p.key));
    return {
        ...def,
        properties: [...(def.properties ?? []), ...extra.filter(p => !ownKeys.has(p.key))],
    };
}

/**
 * All chart template definitions, grouped by category.
 * Keys are category names shown in the UI, values are arrays of template definitions.
 *
 * Categories are organized by *mark family* — charts in the same group share
 * their dominant visual primitive (point, bar, line/area, etc.). This keeps
 * placement objective and the picker readable.
 */
export const vlTemplateDefs: { [key: string]: ChartTemplateDef[] } = Object.fromEntries(
    Object.entries({
        "Points":          [scatterPlotDef, regressionDef, rangedDotPlotDef, stripPlotDef],
        "Bars":            [barChartDef, groupedBarChartDef, stackedBarChartDef, lollipopChartDef, waterfallChartDef],
        "Distributions":   [histogramDef, densityPlotDef, boxplotDef, pyramidChartDef, candlestickChartDef],
        "Lines & Areas":   [lineChartDef, bumpChartDef, areaChartDef, streamgraphDef],
        "Circular":        [pieChartDef, roseChartDef, radarChartDef],
        "Tables & Maps":   [heatmapDef, barTableDef, kpiCardDef, usMapDef, worldMapDef],
        "Custom":          [customPointDef, customLineDef, customBarDef, customRectDef, customAreaDef],
    }).map(([category, defs]) => [category, defs.map(withInjectedProperties)]),
);

/**
 * Flat list of all Vega-Lite chart template definitions.
 */
export const vlAllTemplateDefs: ChartTemplateDef[] = Object.values(vlTemplateDefs).flat();

/**
 * Look up a Vega-Lite chart template definition by chart type name.
 */
export function vlGetTemplateDef(chartType: string): ChartTemplateDef | undefined {
    return vlAllTemplateDefs.find(t => t.chart === chartType);
}

/**
 * Get the available channels for a Vega-Lite chart type.
 */
export function vlGetTemplateChannels(chartType: string): string[] {
    return vlGetTemplateDef(chartType)?.channels || [];
}
