// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef } from '../types';

export const customCharts: ChartTemplateDef[] = [
    {
        chart: "Custom Point",
        template: {
            mark: "point",
            encoding: {},
        },
        channels: ["x", "y", "color", "opacity", "size", "shape", "column", "row"],
        paths: Object.fromEntries(
            ["x", "y", "color", "opacity", "size", "shape", "column", "row"].map(ch => [ch, ["encoding", ch]])
        ),
    },
    {
        chart: "Custom Line",
        template: {
            mark: "line",
            encoding: {},
        },
        channels: ["x", "y", "color", "opacity", "detail", "column", "row"],
        paths: Object.fromEntries([
            ...["x", "y", "color", "opacity", "column", "row"].map(ch => [ch, ["encoding", ch]]),
            ["detail", ["encoding", "detail"]],
        ]),
    },
    {
        chart: "Custom Bar",
        template: {
            mark: "bar",
            encoding: {},
        },
        channels: ["x", "y", "color", "opacity", "size", "shape", "column", "row"],
        paths: Object.fromEntries(
            ["x", "y", "color", "opacity", "size", "shape", "column", "row"].map(ch => [ch, ["encoding", ch]])
        ),
    },
    {
        chart: "Custom Rect",
        template: {
            mark: "rect",
            encoding: {},
        },
        channels: ["x", "y", "x2", "y2", "color", "opacity", "column", "row"],
        paths: Object.fromEntries(
            ["x", "y", "x2", "y2", "color", "opacity", "column", "row"].map(ch => [ch, ["encoding", ch]])
        ),
    },
    {
        chart: "Custom Area",
        template: {
            mark: "area",
            encoding: {},
        },
        channels: ["x", "y", "x2", "y2", "color", "column", "row"],
        paths: Object.fromEntries(
            ["x", "y", "x2", "y2", "color", "column", "row"].map(ch => [ch, ["encoding", ch]])
        ),
    },
];
