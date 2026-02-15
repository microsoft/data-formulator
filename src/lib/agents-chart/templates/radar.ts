// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../types';

/**
 * Radar / Spider Chart
 *
 * Data model (long format):
 *   - x (nominal): the metric / axis name  (e.g. "Speed", "Defense", "Passing")
 *   - y (quantitative): the value for that metric
 *   - color (nominal): the entity / group   (e.g. "Team A", "Team B")
 *
 * Each row represents one (group, metric, value) triple.
 * Supports column/row faceting — one radar per facet group.
 *
 * buildEncodings normalises values per axis to 0-1, computes polar
 * coordinates, and builds a layered VL spec with grid + polygon + points.
 */

// ---------------------------------------------------------------------------
// Helper: round up to a "nice" ceiling for axis max
// ---------------------------------------------------------------------------
function niceMax(v: number): number {
    if (v <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const mantissa = v / pow;
    const nice = mantissa <= 1 ? 1
        : mantissa <= 2 ? 2
        : mantissa <= 2.5 ? 2.5
        : mantissa <= 5 ? 5
        : 10;
    return nice * pow;
}

// ---------------------------------------------------------------------------
// Helper: build VL layers for a single radar from long-format rows
// ---------------------------------------------------------------------------
function buildRadarLayers(
    rows: any[],
    axisField: string,
    valueField: string,
    groupField: string | undefined,
    opts: { filled: boolean; fillOpacity: number; strokeWidth: number; domainPad: number },
): any[] {
    // --- Extract distinct axes and groups ---
    const axes: string[] = [];
    const axisSet = new Set<string>();
    for (const row of rows) {
        const a = String(row[axisField]);
        if (!axisSet.has(a)) { axisSet.add(a); axes.push(a); }
    }
    if (axes.length < 2) return [];

    const groups: string[] = [];
    if (groupField) {
        const groupSet = new Set<string>();
        for (const row of rows) {
            const g = String(row[groupField]);
            if (!groupSet.has(g)) { groupSet.add(g); groups.push(g); }
        }
    } else {
        groups.push("_all");
    }

    // --- Normalise each axis to 0-1 ---
    const axisMax: Record<string, number> = {};
    for (const axis of axes) {
        const vals = rows
            .filter(r => String(r[axisField]) === axis)
            .map(r => Number(r[valueField]))
            .filter(v => isFinite(v));
        const mx = vals.length > 0 ? Math.max(...vals) : 1;
        axisMax[axis] = niceMax(mx);
    }

    // --- Aggregate: average per (group, axis) ---
    const keyMap = new Map<string, { sum: number; rawSum: number; count: number }>();
    for (const row of rows) {
        const grp = groupField ? String(row[groupField]) : "_all";
        const axis = String(row[axisField]);
        const raw = Number(row[valueField]) || 0;
        const mx = axisMax[axis];
        const norm = mx > 0 ? raw / mx : 0;
        const k = `${grp}|||${axis}`;
        if (!keyMap.has(k)) keyMap.set(k, { sum: 0, rawSum: 0, count: 0 });
        const entry = keyMap.get(k)!;
        entry.sum += norm;
        entry.rawSum += raw;
        entry.count += 1;
    }

    // --- Compute polar coordinates ---
    const angleStep = 360 / axes.length;
    const finalData: any[] = [];
    for (const [k, v] of keyMap.entries()) {
        const [grp, axis] = k.split('|||');
        const axisIndex = axes.indexOf(axis);
        const angle = axisIndex * angleStep;
        const normVal = v.sum / v.count;
        const rawVal = Math.round((v.rawSum / v.count) * 100) / 100;
        const rad = (angle * Math.PI) / 180;
        finalData.push({
            __group: grp,
            __axis: axis,
            __value: normVal,
            __raw: rawVal,
            __angle: angle,
            __x: normVal * Math.sin(rad),
            __y: -normVal * Math.cos(rad),
        });
    }

    // --- Grid data (spokes + concentric rings) ---
    const gridData: any[] = [];
    for (let idx = 0; idx < axes.length; idx++) {
        const ang = (idx * angleStep * Math.PI) / 180;
        gridData.push({
            __type: "spoke",
            __x: 0, __y: 0,
            __x2: Math.sin(ang),
            __y2: -Math.cos(ang),
        });
    }
    for (const level of [0.25, 0.5, 0.75, 1.0]) {
        const points: any[] = [];
        for (let i = 0; i <= axes.length; i++) {
            const ang = ((i % axes.length) * angleStep * Math.PI) / 180;
            points.push({ __x: level * Math.sin(ang), __y: -level * Math.cos(ang) });
        }
        for (let i = 0; i < points.length - 1; i++) {
            gridData.push({
                __type: "ring", __level: level,
                __x: points[i].__x, __y: points[i].__y,
                __x2: points[i + 1].__x, __y2: points[i + 1].__y,
            });
        }
    }

    // --- Axis labels with angle-aware positioning ---
    const labelData = axes.map((axis, i) => {
        const angDeg = i * angleStep;
        const ang = (angDeg * Math.PI) / 180;
        const r = 1.15;
        const mx = axisMax[axis];
        const maxStr = mx % 1 === 0 ? String(mx) : mx.toFixed(1);

        // Determine text alignment based on angular position
        // Right half → left-align, left half → right-align, top/bottom → center
        const sinA = Math.sin(ang);
        const cosA = -Math.cos(ang);
        let align: string;
        let baseline: string;
        let dx = 0;
        let dy = 0;

        if (Math.abs(sinA) < 0.15) {
            // Near top or bottom
            align = 'center';
            baseline = cosA < 0 ? 'bottom' : 'top';
            dy = cosA < 0 ? -4 : 4;
        } else if (sinA > 0) {
            // Right half
            align = 'left';
            baseline = Math.abs(cosA) < 0.3 ? 'middle' : (cosA < 0 ? 'bottom' : 'top');
            dx = 4;
        } else {
            // Left half
            align = 'right';
            baseline = Math.abs(cosA) < 0.3 ? 'middle' : (cosA < 0 ? 'bottom' : 'top');
            dx = -4;
        }

        return {
            __label: [axis, `(${maxStr})`],
            __x: r * Math.sin(ang), __y: -r * Math.cos(ang),
            __align: align, __baseline: baseline, __dx: dx, __dy: dy,
        };
    });

    const { filled, fillOpacity, strokeWidth, domainPad } = opts;
    const layers: any[] = [];

    // Spokes
    layers.push({
        data: { values: gridData.filter(d => d.__type === "spoke") },
        mark: { type: "rule", stroke: "#ddd", strokeWidth: 0.8 },
        encoding: {
            x: { field: "__x", type: "quantitative", scale: { domain: [-domainPad, domainPad] }, axis: null },
            y: { field: "__y", type: "quantitative", scale: { domain: [-domainPad, domainPad] }, axis: null },
            x2: { field: "__x2" }, y2: { field: "__y2" },
        },
    });

    // Rings
    layers.push({
        data: { values: gridData.filter(d => d.__type === "ring") },
        mark: { type: "rule", stroke: "#e0e0e0", strokeWidth: 0.6 },
        encoding: {
            x: { field: "__x", type: "quantitative", axis: null },
            y: { field: "__y", type: "quantitative", axis: null },
            x2: { field: "__x2" }, y2: { field: "__y2" },
        },
    });

    // Labels — name on first line, max value on second line
    for (const lbl of labelData) {
        const lines: string[] = lbl.__label;
        layers.push({
            data: { values: [lbl] },
            mark: {
                type: "text", fontSize: 10, fill: "#555",
                align: lbl.__align, baseline: lbl.__baseline,
                dx: lbl.__dx, dy: lbl.__dy,
                limit: 120, lineHeight: 13,
            },
            encoding: {
                x: { field: "__x", type: "quantitative", axis: null },
                y: { field: "__y", type: "quantitative", axis: null },
                text: { value: lines },
            },
        });
    }

    // Data polygon
    const lineLayer: any = {
        data: { values: finalData },
        mark: {
            type: "line", interpolate: "linear-closed", strokeWidth, point: false,
            ...(filled ? { fillOpacity } : {}),
        },
        encoding: {
            x: { field: "__x", type: "quantitative", axis: null },
            y: { field: "__y", type: "quantitative", axis: null },
            order: { field: "__angle", type: "quantitative" },
            tooltip: [
                { field: "__axis", type: "nominal", title: axisField },
                { field: "__raw", type: "quantitative", title: valueField },
            ],
        },
    };
    if (groups.length > 1 && groupField) {
        lineLayer.encoding.stroke = { field: "__group", type: "nominal", title: groupField };
        if (filled) {
            lineLayer.encoding.fill = { field: "__group", type: "nominal", title: groupField, legend: null };
        }
    } else if (filled) {
        lineLayer.mark.fill = "#4c78a8";
    }
    layers.push(lineLayer);

    // Data points
    const pointLayer: any = {
        data: { values: finalData },
        mark: { type: "point", filled: true, size: 25 },
        encoding: {
            x: { field: "__x", type: "quantitative", axis: null },
            y: { field: "__y", type: "quantitative", axis: null },
            tooltip: [
                ...(groupField ? [{ field: "__group", type: "nominal", title: groupField }] : []),
                { field: "__axis", type: "nominal", title: axisField },
                { field: "__raw", type: "quantitative", title: valueField },
            ],
        },
    };
    if (groups.length > 1 && groupField) {
        pointLayer.encoding.color = { field: "__group", type: "nominal", title: groupField, legend: null };
    }
    layers.push(pointLayer);

    return layers;
}

// ---------------------------------------------------------------------------
// Template definition
// ---------------------------------------------------------------------------
export const radarChartDef: ChartTemplateDef = {
        chart: "Radar Chart",
        template: {
            description: "Radar / Spider chart",
            mark: "point",
            encoding: {},
        },
        channels: ["x", "y", "color", "column", "row"],
        buildEncodings: (spec, encodings, context) => {
            const axisField: string | undefined = encodings.x?.field;
            const valueField: string | undefined = encodings.y?.field;
            const groupField: string | undefined = encodings.color?.field;
            const columnField: string | undefined = encodings.column?.field;
            const rowField: string | undefined = encodings.row?.field;

            const table = context.table;
            const canvasSize = context.canvasSize;
            const config = context.chartProperties;

            const filled = config?.filled ?? true;
            const fillOpacity = config?.fillOpacity ?? 0.15;
            const strokeWidth = config?.strokeWidth ?? 1.5;

            if (!table || table.length === 0 || !axisField || !valueField) {
                spec.mark = "point";
                return;
            }

            const size = Math.min(canvasSize?.width || 400, canvasSize?.height || 400);
            const layerOpts = { filled, fillOpacity, strokeWidth, domainPad: 1.18 };

            // ---- No faceting: single radar ----
            if (!columnField && !rowField) {
                const layers = buildRadarLayers(table, axisField, valueField, groupField, layerOpts);
                if (layers.length === 0) { spec.mark = "point"; return; }

                const finalSpec: any = {
                    width: size, height: size, layer: layers,
                    config: { view: { stroke: null } },
                };
                for (const key of Object.keys(spec)) delete spec[key];
                Object.assign(spec, finalSpec);
                return;
            }

            // ---- Faceting: one radar per facet group ----
            const colGroups: string[] = columnField
                ? [...new Set(table.map(r => String(r[columnField])))] as string[]
                : ["_all"];
            const rowGroups: string[] = rowField
                ? [...new Set(table.map(r => String(r[rowField])))] as string[]
                : ["_all"];

            const minSubplot = 200;
            const subplotSize = Math.max(minSubplot, size);

            const buildSubplot = (rows: any[], title?: string) => {
                const layers = buildRadarLayers(rows, axisField, valueField, groupField, layerOpts);
                if (layers.length === 0) return null;
                return {
                    width: subplotSize, height: subplotSize,
                    layer: layers,
                    title: title || undefined,
                };
            };

            let finalSpec: any;
            const concatSpacing = 5;

            if (rowField && columnField) {
                const vconcat: any[] = [];
                for (const rg of rowGroups) {
                    const hconcat: any[] = [];
                    for (const cg of colGroups) {
                        const subset = table.filter(r => String(r[rowField]) === rg && String(r[columnField]) === cg);
                        const s = buildSubplot(subset, `${cg}`);
                        if (s) hconcat.push(s);
                    }
                    if (hconcat.length > 0) {
                        vconcat.push({ hconcat, spacing: concatSpacing, title: rg });
                    }
                }
                finalSpec = { vconcat, spacing: concatSpacing, config: { view: { stroke: null } } };
            } else if (columnField) {
                const hconcat: any[] = [];
                for (const cg of colGroups) {
                    const subset = table.filter(r => String(r[columnField]) === cg);
                    const s = buildSubplot(subset, cg);
                    if (s) hconcat.push(s);
                }
                finalSpec = { hconcat, spacing: concatSpacing, config: { view: { stroke: null } } };
            } else {
                const vconcat: any[] = [];
                for (const rg of rowGroups) {
                    const subset = table.filter(r => String(r[rowField!]) === rg);
                    const s = buildSubplot(subset, rg);
                    if (s) vconcat.push(s);
                }
                finalSpec = { vconcat, spacing: concatSpacing, config: { view: { stroke: null } } };
            }

            for (const key of Object.keys(spec)) delete spec[key];
            Object.assign(spec, finalSpec);
        },
        properties: [
            { key: "filled", label: "Filled", type: "binary", defaultValue: true },
            { key: "fillOpacity", label: "Fill Opacity", type: "continuous", min: 0, max: 0.5, step: 0.05, defaultValue: 0.15 },
            { key: "strokeWidth", label: "Line Width", type: "continuous", min: 0.5, max: 4, step: 0.5, defaultValue: 1.5 },
        ] as ChartPropertyDef[],
};
