// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef, ChannelSemantics } from '../../core/types';
import { getRegistryEntry } from '../../core/type-registry';
import type { FormatSpec } from '../../core/field-semantics';

/**
 * Bar Table — a ranked horizontal "data bar table".
 *
 * Visual pattern common in Chinese BI dashboards (FineBI, Quick BI) and
 * Excel/Power BI conditional formatting "Data Bars": rows of (category,
 * gradient bar, % share, value), each numeric column right-aligned.
 *
 * Layout uses `hconcat` with three panels sharing the same y scale:
 *   panel 0 — bar (y-axis labels on the left, gradient bar)
 *   panel 1 — % share text (auto-computed via joinaggregate)
 *   panel 2 — raw value text
 *
 * Required encodings:
 *   - y (nominal/ordinal): category column shown as row labels
 *   - x (quantitative): drives bar length AND the value/% columns
 *
 * Optional:
 *   - color (nominal/ordinal): groups rows by hue (overrides default
 *     gradient-by-value styling)
 */
export const barTableDef: ChartTemplateDef = {
    chart: "Bar Table",
    template: {
        spacing: 4,
        resolve: { scale: { y: 'shared' } },
        hconcat: [],
        config: { view: { stroke: null }, axis: { grid: false, domain: false, ticks: false } },
    },
    channels: ["y", "x", "color", "column", "row"],
    markCognitiveChannel: 'length',
    declareLayoutMode: (cs, table, chartProperties) => {
        // Bar tables split the plot width into 3 horizontal panels
        // (bar | % | value), so they need a wider canvas than a basic
        // bar chart at the same row count. We also want at least a
        // moderately tall canvas so 20+ rows don't squish vertically.
        //
        // Estimate displayed row count after the Top-N rollup so the
        // canvas is sized for what the user will actually see, not for
        // the (possibly huge) raw row count.
        const yField = cs.y?.field;
        const rawRowCount = yField
            ? new Set((table ?? []).map((r: any) => r[yField])).size
            : 0;
        const maxRows = Math.max(0, Number(chartProperties?.maxRows ?? 20));
        const displayedRows = maxRows > 0
            ? Math.min(rawRowCount, maxRows)
            : rawRowCount;

        return {
            axisFlags: { y: { banded: true } },
            paramOverrides: {
                // Wider per-row band than the basic 20: leaves room for
                // both the bar and the two text columns.
                defaultBandSize: 24,
                // Floor on overall subplot size — scales up when rows
                // are dense so the bar column doesn't collapse below
                // legibility.
                minSubplotSize: displayedRows >= 30 ? 360 : 280,
                // Lengthen the continuous axis (bar) relative to the
                // step height. Without this, a tall narrow canvas
                // (many rows) leaves bars only a sliver wide.
                targetBandAR: 280,
            },
        };
    },
    instantiate: (spec, ctx) => {
        const { x, y, color, column, row } = ctx.resolvedEncodings;
        const config = ctx.chartProperties;
        // ── Source of truth: full pre-overflow data ─────────────────
        //
        // We read from `ctx.fullTable` (pre-overflow) rather than
        // `ctx.table` (post-overflow). The framework's filterOverflow
        // step silently drops categories that don't fit pixel-budget
        // assumptions — for a Bar Table, those budgets are wrong
        // (we override panelHeight ourselves) AND lossy (the whole
        // design is "top-N + Others", which only works if we can see
        // the actual tail). Falling back to `ctx.table` keeps the
        // template usable in tests / standalone callers that don't
        // populate fullTable.
        const table = ctx.fullTable ?? ctx.table ?? [];
        const canvasSize = ctx.canvasSize;

        const xField: string = x?.field || 'Value';
        const yField: string = y?.field || 'Category';
        const colorField: string | undefined = color?.field;

        // ── Channel semantics (resolved by framework, may be undefined
        //    when the chart is rendered without a full pipeline) ───────
        const xCS: ChannelSemantics | undefined = ctx.channelSemantics?.x;
        const yCS: ChannelSemantics | undefined = ctx.channelSemantics?.y;
        const xEntry = getRegistryEntry(xCS?.semanticAnnotation?.semanticType ?? 'Unknown');

        // Sign profile of x values — used by the diverging-palette check.
        let hasNegative = false;
        let hasPositive = false;
        for (const r of table) {
            const v = r[xField];
            if (typeof v === 'number' && isFinite(v)) {
                if (v < 0) hasNegative = true;
                else if (v > 0) hasPositive = true;
            }
        }

        // showPercent: off by default (safer — avoids misleading shares
        // for intensive measures, already-percent values, mixed-sign
        // data, etc.). The agent or the user can flip it on when the
        // measure is genuinely additive.
        const showPercent = config?.showPercent === true;

        // ── Per-category aggregate (built once on the input table) ──
        // Used for both the Top-N trim decision and the panel-width
        // estimation. `aggValue` collapses one group's sum/count into
        // the single number the chart will display.
        const useMeanForDisplay = xCS?.aggregationDefault === 'average';
        const aggValue = (g: { sum: number; n: number }) =>
            useMeanForDisplay ? g.sum / Math.max(1, g.n) : g.sum;

        const categoryAgg = new Map<any, { sum: number; n: number }>();
        for (const r of table) {
            const v = r[xField];
            if (typeof v !== 'number' || !isFinite(v)) continue;
            const g = categoryAgg.get(r[yField]) ?? { sum: 0, n: 0 };
            g.sum += v; g.n += 1;
            categoryAgg.set(r[yField], g);
        }
        const uniqueCats = Array.from(categoryAgg.keys());

        // ── Top-N + "Others" rollup ──────────────────────────────────
        //
        // Long bar tables become unreadable past ~20 rows. We rank
        // categories by their per-category aggregate, keep the top
        // (maxRows − 1), and roll the rest into one synthetic
        // "Others (+N)" row pinned to the bottom.
        //
        // Skip when:
        //   * y has a canonical ordinal order (Month, Rank, …) — top-N
        //     would break the natural sequence.
        //   * the user disables it via `maxRows: 0`.
        //
        // When a color field is bound (stacked bars), kept categories
        // retain all their original (color-split) rows so VL can still
        // stack; the Others row carries no color value and renders gray.
        const maxRows: number = Math.max(0, Number(config?.maxRows ?? 20));
        const ySortOrderForTrim: string[] | undefined = yCS?.ordinalSortOrder;
        const canTrim = maxRows > 0
            && !(ySortOrderForTrim && ySortOrderForTrim.length > 0)
            && uniqueCats.length > maxRows;

        let displayTable: any[] = table;
        let othersCatLabel: string | undefined;
        let keptCatOrder: any[] | undefined;
        let perCatAggValues: number[] = uniqueCats.map(c => aggValue(categoryAgg.get(c)!));

        if (canTrim) {
            const sorted = uniqueCats
                .map(cat => ({ cat, value: aggValue(categoryAgg.get(cat)!) }))
                .sort((a, b) => yCS?.reversed ? a.value - b.value : b.value - a.value);
            const keepN = Math.max(1, maxRows - 1);
            const keptItems = sorted.slice(0, keepN);
            const rest      = sorted.slice(keepN);
            keptCatOrder    = keptItems.map(a => a.cat);
            const keptCats  = new Set(keptCatOrder);

            const restSum     = rest.reduce((s, a) => s + a.value, 0);
            const othersValue = useMeanForDisplay && rest.length > 0 ? restSum / rest.length : restSum;
            othersCatLabel    = `Others (+${rest.length})`;
            const othersSynth = { [yField]: othersCatLabel, [xField]: othersValue, __bt_others: true };

            displayTable = colorField
                ? [...table.filter(r => keptCats.has(r[yField])), othersSynth]
                : [...keptItems.map(a => ({ [yField]: a.cat, [xField]: a.value })), othersSynth];
            perCatAggValues = [...keptItems.map(a => a.value), othersValue];
        }

        // ── Column header labels ─────────────────────────────────────
        // Derived directly from field names; no override knobs.
        const categoryHeader = yField;
        const percentHeader  = '%';
        const valueHeader    = xField;
        // headerStyle.fontSize is set below once the responsive
        // `fontSize` constant is available.

        // ── Format derivation (from ChannelSemantics) ────────────────
        //
        // Policy: don't over-process user input. The framework's
        // `resolveFormat` already follows a "only override when the raw
        // number would be misleading" rule (e.g., 0–1 Percentage with an
        // intrinsicDomain, currency with a known unit symbol). When
        // `cs.format` is undefined, the raw value is already readable —
        // we show it as-is and let VL apply its default number rendering.
        //
        // The %-share column (panel 1) is a different story: it's a
        // *derived* 0..1 ratio computed by us, so it always needs `%`
        // formatting. That's `pctPattern` below.
        const valueFmt: FormatSpec | undefined = xCS?.format;
        const pctPattern = '.1%';

        // ── Text-panel transforms ────────────────────────────────────
        //
        // The bar panel naturally handles stacked / grouped data via VL.
        // The text panels (% and value) must show ONE row per category;
        // when the input has multiple rows per y-category (e.g. stacked
        // by `color`), we first aggregate per-category, then derive the
        // share. Without this, each input row would render its own text
        // mark (overlapping) and each share would be value/grand-total
        // (~0% per row instead of the per-category percent).
        const sortOp: 'sum' | 'mean' = (xCS?.aggregationDefault === 'average') ? 'mean' : 'sum';
        const textPanelTransform: any[] = [
            { aggregate: [{ op: sortOp, field: xField, as: '__bt_val' }], groupby: [yField] },
        ];
        if (showPercent) {
            textPanelTransform.push(
                { joinaggregate: [{ op: 'sum', field: '__bt_val', as: '__bt_total' }] },
                { calculate: `datum.__bt_val / datum.__bt_total`, as: '__bt_pct' },
            );
        }

        // ── Sizing constants (responsive to row density) ────────
        // `displayCount` is the number of rows the chart will actually
        // render (post-rollup). As it grows, we shrink fonts so labels
        // don't crowd; we also bump up the minimum bar-panel width so
        // the bar column remains a real visual signal, not a sliver
        // between text.
        const displayCount = canTrim
            ? (keptCatOrder!.length + 1)
            : uniqueCats.length;
        // 0 (sparse, ≤12 rows) … 1 (dense, ≥52 rows) — font/density curve.
        const density = Math.min(1, Math.max(0, (displayCount - 12) / 40));
        const lerp = (a: number, b: number) => Math.round(a + (b - a) * density);

        const fontSize       = lerp(12, 10);   // text panels
        const labelFontSize  = lerp(13, 10);   // y-axis tick labels

        // ── Bar geometry: capped thickness, proportional gap ─────────
        //
        // Design intent: the bar is the signal — never let it get
        // stretched into a fat rectangle (un-bar-like) and never let
        // the gap dominate it. Vega-Lite default bars sit around 18px;
        // we cap a touch tighter at 16 to match BI "data bar" feel.
        //
        // Bars stay at `barCap` until row count exceeds `compressStart`,
        // then shrink linearly to `barMin` by `compressEnd`. Below
        // `barMin` the mark becomes a hairline and stops reading as
        // a bar, so we hold the floor.
        //
        // Gap = max(`gapMin`, bar × `gapRatio`) — proportional so the
        // bar:gap ratio stays roughly constant (≈4–5×) across densities,
        // with a 2px floor so rows never visually merge.
        const barCap = 16, barMin = 8;
        const gapMin = 2, gapRatio = 0.2;
        const compressStart = 30, compressEnd = 80;
        const compressT = Math.min(1, Math.max(0,
            (displayCount - compressStart) / (compressEnd - compressStart)));
        const barPx  = Math.round(barCap - (barCap - barMin) * compressT);
        const gapPx  = Math.max(gapMin, Math.round(barPx * gapRatio));
        const rowStep = barPx + gapPx;
        const barBandRatio = +(barPx / rowStep).toFixed(3);

        const charPx = fontSize * 0.6;
        const textPad = 12;
        const minTextPanel = 36;
        const maxTextPanel = 140;
        const cjkRe = /[\u4E00-\u9FFF\u3000-\u303F]/;

        const headerStyle = {
            fontSize: fontSize,
            fontWeight: 'normal' as const,
            color: '#999',
        };

        // ── Shared y encoding ────────────────────────────────────────
        // Sort: honor canonical ordinal order if the y field has one
        // (e.g. Month, Day-of-week, Rank); otherwise rank by aggregated x.
        // When we trimmed, pin the synthetic "Others" row to the bottom
        // by using an explicit sort array (kept categories in rank order
        // followed by the Others label).
        //
        // Important: we use an explicit category array (not a
        // `{field, op}` sort) even in the un-trimmed case. The y scale
        // is `resolve: shared` across 3 panels, but the % / value
        // panels run an `aggregate` transform that renames `xField` to
        // `__bt_val`. With a field-based sort, VL can't resolve
        // `xField` post-transform and falls back to alphabetical
        // domain order — which silently breaks the ranking.
        const ySortOrder: string[] | undefined = yCS?.ordinalSortOrder;
        const rankedCatOrder = (() => {
            if (canTrim && keptCatOrder && othersCatLabel) {
                return [...keptCatOrder, othersCatLabel];
            }
            return uniqueCats
                .map(cat => ({ cat, value: aggValue(categoryAgg.get(cat)!) }))
                .sort((a, b) => yCS?.reversed ? a.value - b.value : b.value - a.value)
                .map(a => a.cat);
        })();
        const ySort: any = ySortOrder && ySortOrder.length > 0
            ? ySortOrder
            : rankedCatOrder;

        // Labels are left-aligned and pushed flush with the panel's left
        // edge so they line up under the "Category" column header.
        const categoryLabelWidth = (() => {
            const maxChars = displayTable.reduce((m, r) => {
                const s = String(r[yField] ?? '');
                const w = [...s].reduce((a, ch) => a + (cjkRe.test(ch) ? 2 : 1), 0);
                return Math.max(m, w);
            }, 0);
            return Math.min(220, Math.max(60, Math.round(maxChars * labelFontSize * 0.55 + 12)));
        })();
        const yEncWithLabels: any = {
            field: yField,
            type: 'nominal',
            sort: ySort,
            axis: {
                title: null,
                domain: false,
                ticks: false,
                labelFontSize,
                labelAlign: 'left',
                labelPadding: categoryLabelWidth,
                labelLimit: categoryLabelWidth,
            },
        };
        const yEncNoLabels: any = { ...yEncWithLabels, axis: null };

        // ── Color: gradient by value (default) or grouped by field ───
        // Diverging types (Profit/Correlation) and mixed-sign data get a
        // diverging palette anchored at 0; otherwise a sequential ramp.
        const isDiverging = !colorField && (
            xEntry.diverging === 'inherent'
            || (xEntry.diverging === 'conditional' && hasNegative && hasPositive)
        );
        const colorEnc = colorField
            ? (() => {
                // When we trimmed, the synthetic Others row has no value
                // for colorField, which would surface as an "undefined"
                // entry in the legend. Restrict the scale domain to the
                // actual values present in the kept rows.
                const base: any = { ...color };
                if (canTrim) {
                    const vals = Array.from(new Set(
                        displayTable
                            .filter(r => !r.__bt_others)
                            .map(r => r[colorField])
                            .filter(v => v !== undefined && v !== null)
                    ));
                    base.scale = { ...(base.scale || {}), domain: vals };
                }
                return base;
            })()
            : isDiverging
                ? {
                    field: xField,
                    type: 'quantitative',
                    legend: null,
                    scale: { scheme: 'redyellowgreen', domainMid: 0 },
                }
                : {
                    field: xField,
                    type: 'quantitative',
                    legend: null,
                    scale: { range: ['#cdebd3', '#41a25f'] },
                };

        // ── Dynamic panel widths from longest formatted label ────────
        //
        // Approximates the framework's d3-format output well enough for
        // panel sizing. When no format is resolved, we just show the raw
        // value via `String(v)` and measure that.
        const approxFormat = (v: number): string => {
            if (!Number.isFinite(v)) return '';
            if (!valueFmt) return String(v);
            const p = valueFmt.pattern || '';
            let body: string;
            if (p.includes('%')) {
                const dec = /\.(\d+)/.exec(p)?.[1];
                body = (v * 100).toFixed(dec ? parseInt(dec) : 1) + '%';
            } else if (p.includes('d')) {
                body = Math.round(v).toLocaleString('en-US');
            } else if (/~s|s$/.test(p)) {
                body = Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M'
                     : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'K'
                     : v.toFixed(0);
            } else if (p) {
                const dec = /\.(\d+)/.exec(p)?.[1];
                body = v.toLocaleString('en-US', {
                    minimumFractionDigits: dec ? parseInt(dec) : 0,
                    maximumFractionDigits: dec ? parseInt(dec) : 2,
                });
            } else {
                body = String(v);
            }
            return (valueFmt.prefix ?? '') + body + (valueFmt.suffix ?? '');
        };
        const approxPct = (v: number) =>
            Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '';

        const measure = (strs: string[]) => {
            const maxChars = strs.reduce((m, s) => Math.max(m, s.length), 0);
            return Math.min(maxTextPanel, Math.max(minTextPanel, Math.round(maxChars * charPx + textPad)));
        };

        // ── Header wrap / truncate strategy ──────────────────────────
        // Long field names like `video_views_for_the_last_30_days` blow
        // past panel width. We try to fit them by:
        //   1. measuring single-line width and reserving that as a
        //      minimum for the panel (capped at maxTextPanel);
        //   2. wrapping on `_` / space boundaries into up to two lines
        //      when the single line still doesn't fit;
        //   3. handing VL a `title.limit` so it ellipsizes anything
        //      that still overflows.
        const headerPad = 4;
        const headerWidthOf = (s: string) => Math.round(s.length * charPx) + headerPad;
        const wrapHeader = (label: string, maxPx: number): { text: string | string[]; widthPx: number } => {
            const single = headerWidthOf(label);
            if (single <= maxPx) return { text: label, widthPx: single };
            const tokens = label.split(/[_\s]+/).filter(Boolean);
            if (tokens.length < 2) return { text: label, widthPx: single };
            // Greedy balanced two-line split on token boundaries.
            const totalLen = tokens.reduce((a, t) => a + t.length, 0);
            let acc = 0, splitAt = 1;
            for (let i = 0; i < tokens.length - 1; i++) {
                acc += tokens[i].length;
                if (acc >= totalLen / 2) { splitAt = i + 1; break; }
            }
            const line1 = tokens.slice(0, splitAt).join('_');
            const line2 = tokens.slice(splitAt).join('_');
            return { text: [line1, line2], widthPx: Math.max(headerWidthOf(line1), headerWidthOf(line2)) };
        };

        // Per-category aggregate values used for panel-width sizing.
        // Built above as `perCatAggValues` — reuse directly.

        // Wrap headers up to the panel's max width budget; the wrap
        // result's `widthPx` then acts as a floor on the actual panel
        // width (so the title doesn't get truncated when the data is
        // narrower than the header).
        const valueHeaderWrap   = wrapHeader(valueHeader,   maxTextPanel - headerPad);
        const percentHeaderWrap = wrapHeader(percentHeader, maxTextPanel - headerPad);

        const valuePanelDataWidth = measure(perCatAggValues.map(approxFormat));
        const valuePanelWidth = Math.min(
            maxTextPanel,
            Math.max(valuePanelDataWidth, valueHeaderWrap.widthPx + headerPad, minTextPanel),
        );
        const displayTotal = perCatAggValues.reduce((a, b) => a + b, 0);
        const percentPanelWidth = showPercent && Math.abs(displayTotal) > 1e-9
            ? Math.min(
                maxTextPanel,
                Math.max(
                    measure(perCatAggValues.map(v => approxPct(v / displayTotal))),
                    percentHeaderWrap.widthPx + headerPad,
                    minTextPanel,
                ),
            )
            : 0;

        const totalWidth = canvasSize?.width ?? 480;
        const interPanelGap = 8;
        const reservedForText = valuePanelWidth + interPanelGap
            + (showPercent ? percentPanelWidth + interPanelGap : 0);
        // Bar panel needs a meaningful min width — a 3-panel layout
        // squeezes the bar column more than a basic bar chart, and the
        // bar IS the chart, so it should never collapse below ~45% of
        // the canvas (or 180px absolute, whichever is larger).
        const minBarPanelWidth = Math.max(180, Math.round(totalWidth * 0.45));
        const barPanelWidth = Math.max(minBarPanelWidth, totalWidth - reservedForText - categoryLabelWidth);

        const yCard = Math.max(1, new Set(displayTable.map(r => r[yField])).size);
        const panelHeight = Math.max(canvasSize?.height ?? 0, yCard * rowStep);

        // ── Helpers to build a text encoding honoring prefix/suffix ──
        //
        // - No fmt resolved  → show the raw field, VL default rendering.
        // - Pattern only     → VL `format` shortcut.
        // - With affixes     → calculate transform that concats prefix
        //                      + format(value, pattern) + suffix.
        const buildTextEncoding = (
            sourceField: string,
            fmt: FormatSpec | undefined,
            transformsOut: any[],
            outFieldHint: string,
        ): any => {
            if (!fmt || (!fmt.pattern && !fmt.prefix && !fmt.suffix)) {
                return { field: sourceField, type: 'quantitative' };
            }
            const hasAffix = !!(fmt.prefix || fmt.suffix);
            if (!hasAffix) {
                return { field: sourceField, type: 'quantitative', format: fmt.pattern };
            }
            const escPfx = (fmt.prefix ?? '').replace(/'/g, "\\'");
            const escSfx = (fmt.suffix ?? '').replace(/'/g, "\\'");
            const formatExpr = fmt.pattern
                ? `format(datum['${sourceField}'], '${fmt.pattern}')`
                : `datum['${sourceField}']`;
            transformsOut.push({
                calculate: `'${escPfx}' + ${formatExpr} + '${escSfx}'`,
                as: outFieldHint,
            });
            return { field: outFieldHint, type: 'nominal' };
        };

        // ── X-scale: anchor bars at 0 for diverging measures ─────────
        const barXScale: any = { nice: false };
        if (isDiverging) barXScale.domainMid = 0;

        // ── Per-panel data: always register `displayTable` as a named
        //    dataset and reference it from every panel. The Bar Table
        //    is self-contained — we read from `ctx.fullTable` and
        //    derive the exact rows we want to render, so we must NOT
        //    fall back to the framework's root data injection (which
        //    is the post-overflow filtered table and would silently
        //    drop categories behind our back).
        const datasetName = '__bt_displayTable';
        spec.datasets = { ...(spec.datasets || {}), [datasetName]: displayTable };
        const withData = (panel: any) => ({ data: { name: datasetName }, ...panel });

        // ── Others row: gray out across panels ───────────────────────
        // Bar panel rows still carry `__bt_others: true` (no transform).
        // Text panels lose it after the aggregate, so detect by label.
        const othersGray = '#bdbdbd';
        const othersTextTest = canTrim && othersCatLabel
            ? `datum['${yField.replace(/'/g, "\\'")}'] === '${othersCatLabel.replace(/'/g, "\\'")}'`
            : undefined;

        // ── Panel 0: bar (with y-axis labels) ────────────────────────
        //
        // For additive measures (sortOp = 'sum'), we let VL natively
        // stack raw rows — the bar's length equals the row sum, which
        // matches what the value text panel displays. This also keeps
        // per-segment detail (gradient stripes / colored sub-groups).
        //
        // For non-additive measures (sortOp = 'mean'), stacking raw
        // rows would silently encode bar length = SUM(values), which
        // contradicts the MEAN we display in the value column. In that
        // case we aggregate the bar data the same way the text panel
        // does so the bar's length matches the displayed number.
        const barAggregate = useMeanForDisplay;
        const barTransform: any[] | undefined = barAggregate
            ? [{
                aggregate: [{ op: sortOp, field: xField, as: '__bt_val' }],
                groupby: colorField ? [yField, colorField] : [yField],
            }]
            : undefined;
        const barXField = barAggregate ? '__bt_val' : xField;

        // Gradient-by-value color (no user color field) must reference
        // the same field the bar's x encoding uses, otherwise the scale
        // can't resolve post-aggregate.
        const barColorBase = !colorField && barAggregate
            ? (isDiverging
                ? { field: '__bt_val', type: 'quantitative', legend: null, scale: { scheme: 'redyellowgreen', domainMid: 0 } }
                : { field: '__bt_val', type: 'quantitative', legend: null, scale: { range: ['#cdebd3', '#41a25f'] } })
            : colorEnc;

        // Others-row detection: when we aggregate, the `__bt_others`
        // flag is dropped, so fall back to the y-label test used by the
        // text panels.
        const barOthersTest = barAggregate ? othersTextTest : 'datum.__bt_others';
        const barColorEnc: any = canTrim && barOthersTest
            ? { condition: { test: barOthersTest, value: othersGray }, ...barColorBase }
            : barColorBase;

        const barPanel: any = withData({
            width: barPanelWidth,
            height: panelHeight,
            // No `limit` here — the category header is allowed to
            // overflow the (narrow) y-label gutter into the bar area
            // so long field names stay legible.
            title: { text: categoryHeader, anchor: 'start', offset: 6, ...headerStyle },
            ...(barTransform ? { transform: barTransform } : {}),
            mark: {
                type: 'bar',
                height: { band: barBandRatio },
            },
            encoding: {
                y: yEncWithLabels,
                x: {
                    field: barXField,
                    type: 'quantitative',
                    axis: null,
                    scale: barXScale,
                },
                color: barColorEnc,
            },
        });

        const panels: any[] = [barPanel];

        // ── Panel 1: % share (right-aligned text column) ─────────────
        // Uses the per-category aggregate (__bt_pct) so it shows the
        // category's share of the grand total, not a per-row fraction.
        if (showPercent) {
            const pctColor: any = othersTextTest
                ? { condition: { test: othersTextTest, value: othersGray }, value: '#41a25f' }
                : { value: '#41a25f' };
            panels.push(withData({
                width: percentPanelWidth,
                height: panelHeight,
                transform: textPanelTransform,
                title: { text: percentHeaderWrap.text, anchor: 'end', offset: 6, limit: Math.max(20, percentPanelWidth - headerPad), ...headerStyle },
                mark: {
                    type: 'text',
                    align: 'right',
                    baseline: 'middle',
                    fontSize,
                },
                encoding: {
                    y: yEncNoLabels,
                    x: { datum: 1, axis: null, scale: { type: 'linear', domain: [0, 1] } },
                    text: { field: '__bt_pct', type: 'quantitative', format: pctPattern },
                    color: pctColor,
                },
            }));
        }

        // ── Panel 2: aggregated value (right-aligned text column) ────
        // Displays __bt_val (per-category total/mean) — one mark per
        // category, regardless of how many input rows existed.
        {
            const valueTransforms: any[] = [...textPanelTransform];
            const textEnc = buildTextEncoding('__bt_val', valueFmt, valueTransforms, '__bt_val_str');
            const valColor: any = othersTextTest
                ? { condition: { test: othersTextTest, value: othersGray }, value: '#666' }
                : { value: '#666' };
            panels.push(withData({
                width: valuePanelWidth,
                height: panelHeight,
                transform: valueTransforms,
                title: { text: valueHeaderWrap.text, anchor: 'end', offset: 6, limit: Math.max(20, valuePanelWidth - headerPad), ...headerStyle },
                mark: {
                    type: 'text',
                    align: 'right',
                    baseline: 'middle',
                    fontSize,
                },
                encoding: {
                    y: yEncNoLabels,
                    x: { datum: 1, axis: null, scale: { type: 'linear', domain: [0, 1] } },
                    text: textEnc,
                    color: valColor,
                },
            }));
        }

        spec.spacing = interPanelGap;
        spec.hconcat = panels;

        // Facets (column/row) live on the outer spec.
        if (column || row) {
            spec.encoding = spec.encoding || {};
            if (column) spec.encoding.column = column;
            if (row) spec.encoding.row = row;
        }
    },
    properties: [
        { key: 'maxRows', label: 'Max Rows', type: 'continuous', min: 5, max: 100, step: 1, defaultValue: 20 },
        // Off by default — safer for arbitrary measures. The agent (or
        // the user) can flip it on when a "% of total" share is
        // meaningful (additive, single-sign, non-zero total).
        { key: 'showPercent', label: 'Show % of Total', type: 'binary', defaultValue: false },
    ] as ChartPropertyDef[],
};
