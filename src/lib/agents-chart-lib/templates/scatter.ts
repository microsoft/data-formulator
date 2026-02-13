// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../types';
import { ensureNominalAxis, applyPointSizeScaling } from '../helpers';

export const scatterPlots: ChartTemplateDef[] = [
    {
        chart: "Scatter Plot",
        template: {
            mark: "circle",
            encoding: {},
        },
        channels: ["x", "y", "color", "size", "opacity", "column", "row"],
        paths: {
            x: ["encoding", "x"],
            y: ["encoding", "y"],
            color: ["encoding", "color"],
            size: ["encoding", "size"],
            opacity: ["encoding", "opacity"],
            column: ["encoding", "column"],
            row: ["encoding", "row"],
        },
        properties: [
            { key: "opacity", label: "Opacity", type: "continuous", min: 0.1, max: 1, step: 0.05, defaultValue: 1 },
        ] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, table: any[], config?: Record<string, any>, canvasSize?: { width: number; height: number }) => {
            applyPointSizeScaling(vgSpec, table, canvasSize?.width, canvasSize?.height);
            if (!config) return vgSpec;
            const opacity = config.opacity;
            if (opacity !== undefined && opacity < 1) {
                if (typeof vgSpec.mark === 'string') {
                    vgSpec.mark = { type: vgSpec.mark, opacity };
                } else {
                    vgSpec.mark = { ...vgSpec.mark, opacity };
                }
            }
            return vgSpec;
        },
    },
    {
        chart: "Linear Regression",
        template: {
            layer: [
                {
                    mark: "circle",
                    encoding: { x: {}, y: {}, color: {}, size: {} },
                },
                {
                    mark: { type: "line", color: "red" },
                    transform: [{ regression: "field1", on: "field2", group: "field3" }],
                    encoding: { x: {}, y: {} },
                },
            ],
        },
        channels: ["x", "y", "size", "color", "column"],
        paths: {
            x: [["layer", 0, "encoding", "x"], ["layer", 1, "encoding", "x"], ["layer", 1, "transform", 0, "on"]],
            y: [["layer", 0, "encoding", "y"], ["layer", 1, "encoding", "y"], ["layer", 1, "transform", 0, "regression"]],
            color: ["layer", 0, "encoding", "color"],
            size: ["layer", 0, "encoding", "size"],
        },
    },
    {
        chart: "Ranged Dot Plot",
        template: {
            encoding: {},
            layer: [
                { mark: "line", encoding: { detail: {} } },
                { mark: { type: "point", filled: true }, encoding: { color: {} } },
            ],
        },
        channels: ["x", "y", "color"],
        paths: {
            x: ["encoding", "x"],
            y: ["encoding", "y"],
            color: ["layer", 1, "encoding", "color"],
        },
        postProcessor: (vgSpec: any, _table: any[]) => {
            if (vgSpec.encoding.y?.type === "nominal") {
                vgSpec.layer[0].encoding.detail = JSON.parse(JSON.stringify(vgSpec.encoding.y));
            } else if (vgSpec.encoding.x?.type === "nominal") {
                vgSpec.layer[0].encoding.detail = JSON.parse(JSON.stringify(vgSpec.encoding.x));
            }
            return vgSpec;
        },
    },
    {
        chart: "Boxplot",
        template: {
            mark: "boxplot",
            encoding: {},
        },
        channels: ["x", "y", "color", "opacity", "column", "row"],
        paths: Object.fromEntries(
            ["x", "y", "color", "opacity", "column", "row"].map(ch => [ch, ["encoding", ch]])
        ),
        postProcessor: (vgSpec: any, table: any[]) => {
            const hasX = vgSpec.encoding.x?.field;
            const hasY = vgSpec.encoding.y?.field;
            if (hasX && hasY) {
                ensureNominalAxis(vgSpec, table, true);
            }
            return vgSpec;
        },
    },
];
