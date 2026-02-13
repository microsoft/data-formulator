// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../types';

/**
 * Radar / Spider Chart
 *
 * Data model:
 *   - x (category): the entity / group being compared (e.g. "Team A", "Team B")
 *   - y (multiple numeric fields via "detail"): the axes of the radar
 *
 * The postProcessor folds the numeric columns into {__axis, __value} rows,
 * normalises each axis to 0-1 so the radar is balanced, then builds a
 * layered VL spec with line + point marks on a radial projection.
 *
 * Usage: assign a category field to `x` (or `color`) and at least 2 numeric
 * fields via `y`. If only one entity is provided, a single polygon is drawn.
 */

export const radarCharts: ChartTemplateDef[] = [
    {
        chart: "Radar Chart",
        template: {
            // Skeleton — completely replaced by postProcessor
            description: "Radar / Spider chart",
            mark: "point",
            encoding: {},
        },
        // x = entity/group, y = ONE numeric axis (we auto-detect others), color = group
        channels: ["x", "y", "color", "detail"],
        buildEncodings: (spec, encodings) => {
            // Stash field names for postProcessor; don't write real encodings
            spec._radar = {
                groupField: encodings.x?.field || encodings.color?.field,
                valueField: encodings.y?.field,
                detailField: encodings.detail?.field,
            };
        },
        properties: [
            { key: "filled", label: "Filled", type: "binary", defaultValue: true },
            { key: "fillOpacity", label: "Fill Opacity", type: "continuous", min: 0, max: 0.5, step: 0.05, defaultValue: 0.15 },
            { key: "strokeWidth", label: "Line Width", type: "continuous", min: 0.5, max: 4, step: 0.5, defaultValue: 1.5 },
        ] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, table: any[], config?: Record<string, any>, canvasSize?: { width: number; height: number }) => {
            const radar = vgSpec._radar || {};
            delete vgSpec._radar;

            const groupField: string | undefined = radar.groupField;
            const valueField: string | undefined = radar.valueField;

            const filled = config?.filled ?? true;
            const fillOpacity = config?.fillOpacity ?? 0.15;
            const strokeWidth = config?.strokeWidth ?? 1.5;

            if (!table || table.length === 0) return vgSpec;

            // --- Discover numeric axes ---
            // All numeric columns except the group field are radar axes
            const sampleRow = table[0];
            const allKeys = Object.keys(sampleRow);
            const numericAxes: string[] = [];

            for (const key of allKeys) {
                if (key === groupField) continue;
                // Check if this column is numeric
                const vals = table.map(r => r[key]).filter(v => v != null);
                if (vals.length > 0 && vals.every(v => typeof v === 'number')) {
                    numericAxes.push(key);
                }
            }

            // If a specific y field was given, make sure it's included and put first
            if (valueField && !numericAxes.includes(valueField)) {
                numericAxes.unshift(valueField);
            }

            if (numericAxes.length < 2) {
                // Not enough axes for a radar — fallback to a basic mark
                vgSpec.mark = "point";
                return vgSpec;
            }

            // --- Normalise each axis to 0-1 ---
            // Use a "nice" rounded max so single-entity charts still show
            // meaningful shape (raw max wouldn't — every axis would be 1.0).
            const niceMax = (v: number): number => {
                if (v <= 0) return 1;
                const pow = Math.pow(10, Math.floor(Math.log10(v)));
                const mantissa = v / pow;
                // Choose ceiling from 1, 2, 2.5, 5, 10
                const nice = mantissa <= 1 ? 1
                    : mantissa <= 2 ? 2
                    : mantissa <= 2.5 ? 2.5
                    : mantissa <= 5 ? 5
                    : 10;
                return nice * pow;
            };
            const axisMax: Record<string, number> = {};
            for (const axis of numericAxes) {
                const vals = table.map(r => r[axis]).filter(v => typeof v === 'number');
                const mx = Math.max(...vals);
                axisMax[axis] = niceMax(mx);
            }

            // --- Fold data: one row per (group, axis) ---
            const foldedData: any[] = [];
            const groups = groupField
                ? [...new Set(table.map(r => r[groupField]))]
                : ["_all"];

            for (const row of table) {
                const grp = groupField ? row[groupField] : "_all";
                for (const axis of numericAxes) {
                    const raw = row[axis] ?? 0;
                    const mx = axisMax[axis];
                    const norm = raw / mx;
                    foldedData.push({
                        __group: grp,
                        __axis: axis,
                        __value: norm,
                        __raw: raw,
                    });
                }
            }

            // If there are multiple rows per group per axis (shouldn't be typical), average them
            const keyMap = new Map<string, { sum: number; rawSum: number; count: number }>();
            for (const row of foldedData) {
                const k = `${row.__group}|||${row.__axis}`;
                if (!keyMap.has(k)) keyMap.set(k, { sum: 0, rawSum: 0, count: 0 });
                const entry = keyMap.get(k)!;
                entry.sum += row.__value;
                entry.rawSum += row.__raw;
                entry.count += 1;
            }
            const aggregatedData: Array<{
                __group: string; __axis: string; __value: number; __raw: number;
                __angle: number; __x: number; __y: number;
            }> = Array.from(keyMap.entries()).map(([k, v]) => {
                const [grp, axis] = k.split('|||');
                return {
                    __group: grp,
                    __axis: axis,
                    __value: v.sum / v.count,
                    __raw: Math.round((v.rawSum / v.count) * 100) / 100,
                    __angle: 0,
                    __x: 0,
                    __y: 0,
                };
            });

            // --- Compute angle for each axis ---
            const angleStep = 360 / numericAxes.length;
            for (const row of aggregatedData) {
                const axisIndex = numericAxes.indexOf(row.__axis);
                row.__angle = axisIndex * angleStep;
            }

            // No closing row needed — linear-closed interpolation handles it
            const finalData = [...aggregatedData];

            // --- Build radial spec ---
            const size = Math.min(canvasSize?.width || 400, canvasSize?.height || 400);

            // Convert polar to Cartesian in the data
            for (const row of finalData) {
                const rad = (row.__angle * Math.PI) / 180;
                row.__x = row.__value * Math.sin(rad);
                row.__y = -row.__value * Math.cos(rad); // negative so 0° is top
            }

            // Build grid lines (axis spokes + concentric rings)
            const gridData: any[] = [];
            // Spokes
            for (const axis of numericAxes) {
                const idx = numericAxes.indexOf(axis);
                const ang = (idx * angleStep * Math.PI) / 180;
                gridData.push({
                    __type: "spoke",
                    __x: 0, __y: 0,
                    __x2: Math.sin(ang),
                    __y2: -Math.cos(ang),
                    __label: axis,
                });
            }
            // Concentric rings (at 0.25, 0.5, 0.75, 1.0)
            const ringLevels = [0.25, 0.5, 0.75, 1.0];
            for (const level of ringLevels) {
                const points: any[] = [];
                for (let i = 0; i <= numericAxes.length; i++) {
                    const ang = ((i % numericAxes.length) * angleStep * Math.PI) / 180;
                    points.push({
                        __x: level * Math.sin(ang),
                        __y: -level * Math.cos(ang),
                    });
                }
                for (let i = 0; i < points.length - 1; i++) {
                    gridData.push({
                        __type: "ring",
                        __level: level,
                        __x: points[i].__x,
                        __y: points[i].__y,
                        __x2: points[i + 1].__x,
                        __y2: points[i + 1].__y,
                    });
                }
            }

            // Axis label data — show axis name + max value for scale reference
            const labelData = numericAxes.map((axis, i) => {
                const ang = (i * angleStep * Math.PI) / 180;
                const labelRadius = 1.12;
                const mx = axisMax[axis];
                // Format max: drop trailing zeros (e.g. 100, 2.5, 50)
                const maxStr = mx % 1 === 0 ? String(mx) : mx.toFixed(1);
                return {
                    __label: `${axis} (${maxStr})`,
                    __x: labelRadius * Math.sin(ang),
                    __y: -labelRadius * Math.cos(ang),
                };
            });

            const domainPad = 1.18;

            // Build the layered spec
            const layers: any[] = [];

            // Grid spokes
            layers.push({
                data: { values: gridData.filter(d => d.__type === "spoke") },
                mark: { type: "rule", stroke: "#ddd", strokeWidth: 0.8 },
                encoding: {
                    x: { field: "__x", type: "quantitative", scale: { domain: [-domainPad, domainPad] }, axis: null },
                    y: { field: "__y", type: "quantitative", scale: { domain: [-domainPad, domainPad] }, axis: null },
                    x2: { field: "__x2" },
                    y2: { field: "__y2" },
                },
            });

            // Grid rings
            layers.push({
                data: { values: gridData.filter(d => d.__type === "ring") },
                mark: { type: "rule", stroke: "#e0e0e0", strokeWidth: 0.6 },
                encoding: {
                    x: { field: "__x", type: "quantitative", axis: null },
                    y: { field: "__y", type: "quantitative", axis: null },
                    x2: { field: "__x2" },
                    y2: { field: "__y2" },
                },
            });

            // Axis labels
            layers.push({
                data: { values: labelData },
                mark: { type: "text", fontSize: 10, fill: "#555" },
                encoding: {
                    x: { field: "__x", type: "quantitative", axis: null },
                    y: { field: "__y", type: "quantitative", axis: null },
                    text: { field: "__label", type: "nominal" },
                },
            });

            // Data polygon — line with fill for polygon interior
            const lineLayer: any = {
                data: { values: finalData },
                mark: {
                    type: "line",
                    interpolate: "linear-closed",
                    strokeWidth,
                    point: false,
                    ...(filled ? { fillOpacity } : {}),
                },
                encoding: {
                    x: { field: "__x", type: "quantitative", axis: null },
                    y: { field: "__y", type: "quantitative", axis: null },
                    order: { field: "__angle", type: "quantitative" },
                    tooltip: [
                        { field: "__axis", type: "nominal", title: "Metric" },
                        { field: "__raw", type: "quantitative", title: "Value" },
                    ],
                },
            };

            if (groups.length > 1 && groupField) {
                lineLayer.encoding.stroke = {
                    field: "__group",
                    type: "nominal",
                    title: groupField,
                };
                if (filled) {
                    lineLayer.encoding.fill = {
                        field: "__group",
                        type: "nominal",
                        title: groupField,
                        legend: null,  // stroke already shows the legend
                    };
                }
            } else if (filled) {
                // Single group — use a static fill matching the default stroke color
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
                        { field: "__group", type: "nominal", title: groupField || "Group" },
                        { field: "__axis", type: "nominal", title: "Metric" },
                        { field: "__raw", type: "quantitative", title: "Value" },
                    ],
                },
            };
            if (groups.length > 1 && groupField) {
                pointLayer.encoding.color = {
                    field: "__group",
                    type: "nominal",
                    title: groupField,
                };
            }
            layers.push(pointLayer);

            // Overwrite the entire spec
            const finalSpec: any = {
                width: size,
                height: size,
                layer: layers,
                config: {
                    view: { stroke: null },
                },
            };

            // Clear the old spec and assign new properties
            for (const key of Object.keys(vgSpec)) {
                delete vgSpec[key];
            }
            Object.assign(vgSpec, finalSpec);

            return vgSpec;
        },
    },
];
