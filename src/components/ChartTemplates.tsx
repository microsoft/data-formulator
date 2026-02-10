// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplate, ConfigPropertyDef } from "./ComponentType";
import InsightsIcon from '@mui/icons-material/Insights';
import PublicIcon from '@mui/icons-material/Public';
import PieChartOutlineIcon from '@mui/icons-material/PieChartOutline';
import React from "react";

// Import all chart icons statically so they are included in the build
import chartIconTable from '../assets/chart-icon-table-min.png';
import chartIconScatter from '../assets/chart-icon-scatter-min.png';
import chartIconLinearRegression from '../assets/chart-icon-linear-regression-min.png';
import chartIconDotPlotHorizontal from '../assets/chart-icon-dot-plot-horizontal-min.png';
import chartIconBoxPlot from '../assets/chart-icon-box-plot-min.png';
import chartIconColumn from '../assets/chart-icon-column-min.png';
import chartIconColumnGrouped from '../assets/chart-icon-column-grouped-min.png';
import chartIconColumnStacked from '../assets/chart-icon-column-stacked-min.png';
import chartIconHistogram from '../assets/chart-icon-histogram-min.png';
import chartIconHeatMap from '../assets/chart-icon-heat-map-min.png';
import chartIconLine from '../assets/chart-icon-line-min.png';
import chartIconDottedLine from '../assets/chart-icon-dotted-line-min.png';
import chartIconCustomPoint from '../assets/chart-icon-custom-point-min.png';
import chartIconCustomLine from '../assets/chart-icon-custom-line-min.png';
import chartIconCustomBar from '../assets/chart-icon-custom-bar-min.png';
import chartIconCustomRect from '../assets/chart-icon-custom-rect-min.png';
import chartIconCustomArea from '../assets/chart-icon-custom-area-min.png';
import chartIconPie from '../assets/chart-icon-pie-min.png';
import chartIconUSMap from '../assets/chart-icon-us-map-min.png';
import chartIconPyramid from '../assets/chart-icon-pyramid-min.png';
import chartIconWorldMap from '../assets/chart-icon-world-map-min.png';

// Chart Icon Component using static imports
const ChartIcon: React.FC<{ src: string; alt?: string }> = ({ src, alt = "" }) => {
  return <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
};

export function getChartTemplate(chartType: string): ChartTemplate | undefined {
    return Object.values(CHART_TEMPLATES).flat().find(t => t.chart === chartType);
}

export const getChartChannels = (chartType: string) => {
    return getChartTemplate(chartType)?.channels || []
}

export const CHANNEL_LIST =  ["x", "y", "x2", "y2", "id", "color", "opacity", "size", "shape", "column", 
                              "row", "latitude", "longitude", "theta", "radius", "detail", "group",
                              "field 1", "field 2", "field 3", "field 4", "field 5", 'field 6'] as const;

// Supported map projections for Vega-Lite
export const MAP_PROJECTIONS = [
    { value: "mercator", label: "Mercator" },
    { value: "equalEarth", label: "Equal Earth" },
    { value: "orthographic", label: "Orthographic (Globe)" },
    { value: "stereographic", label: "Stereographic" },
    { value: "conicEqualArea", label: "Conic Equal Area" },
    { value: "conicEquidistant", label: "Conic Equidistant" },
    { value: "azimuthalEquidistant", label: "Azimuthal Equidistant" },
    { value: "mollweide", label: "Mollweide" },
    { value: "albersUsa", label: "Albers USA" },
] as const;

// Preset projection centers for different countries/regions
export const PROJECTION_CENTER_PRESETS: { label: string; center: [number, number] }[] = [
    { label: "World (Atlantic)", center: [0, 0] },
    { label: "World (Pacific)", center: [150, 0] },
    { label: "China", center: [105, 35] },
    { label: "USA", center: [-98, 39] },
    { label: "Europe", center: [10, 50] },
    { label: "Japan", center: [138, 36] },
    { label: "India", center: [78, 22] },
    { label: "Brazil", center: [-52, -14] },
    { label: "Australia", center: [134, -25] },
    { label: "Russia", center: [100, 60] },
    { label: "Africa", center: [20, 0] },
    { label: "Middle East", center: [45, 28] },
    { label: "Southeast Asia", center: [115, 5] },
    { label: "South America", center: [-60, -15] },
    { label: "North America", center: [-100, 45] },
    { label: "UK", center: [-2, 54] },
    { label: "Germany", center: [10, 51] },
    { label: "France", center: [2, 47] },
    { label: "Korea", center: [128, 36] },
];

// Explicit list of chart types that should be treated as map charts.
// Use lowercase values here and perform case-insensitive matching in isMapChart.
const MAP_CHART_TYPES = new Set<string>([
    "map",
    "world map",
    "us map",
]);

export const isMapChart = (chartType: string) => {
    if (!chartType) {
        return false;
    }
    const normalized = chartType.trim().toLowerCase();
    return MAP_CHART_TYPES.has(normalized);
}

/**
 * Ensures one axis (x or y) is nominal based on the spec and data cardinality.
 * If neither axis is nominal, converts the one with lower cardinality to nominal.
 * Returns "x" or "y" indicating which channel is nominal, or null if undetermined.
 */
const ensureNominalAxis = (vgSpec: any, table: any[], defaultToX: boolean = true): "x" | "y" | null => {
    if (vgSpec.encoding.x?.type === "nominal") {
        return "x";
    } else if (vgSpec.encoding.y?.type === "nominal") {
        return "y";
    } else if (vgSpec.encoding.x && vgSpec.encoding.y) {
        // Neither are nominal, determine based on cardinality
        if (table && table.length > 0) {
            const xField = vgSpec.encoding.x?.field;
            const yField = vgSpec.encoding.y?.field;
            
            let xCardinality = Infinity;
            let yCardinality = Infinity;
            
            if (xField) {
                const xValues = [...new Set(table.map(r => r[xField]))];
                xCardinality = xValues.length;
            }
            
            if (yField) {
                const yValues = [...new Set(table.map(r => r[yField]))];
                yCardinality = yValues.length;
            }
            
            // The axis with lower cardinality should be nominal (categories)
            if (xCardinality <= yCardinality) {
                vgSpec.encoding.x.type = "nominal";
                return "x";
            } else {
                vgSpec.encoding.y.type = "nominal";
                return "y";
            }
        } else {
            // Default based on parameter
            if (defaultToX) {
                vgSpec.encoding.x.type = "nominal";
                return "x";
            } else {
                vgSpec.encoding.y.type = "nominal";
                return "y";
            }
        }
    } else if (vgSpec.encoding.x) {
        // Only x is defined
        if (vgSpec.encoding.x.type !== "nominal") {
            vgSpec.encoding.x.type = "nominal";
        }
        return "x";
    } else if (vgSpec.encoding.y) {
        // Only y is defined
        if (vgSpec.encoding.y.type !== "nominal") {
            vgSpec.encoding.y.type = "nominal";
        }
        return "y";
    }
    return null;
};

export const ChannelGroups = {
        "": ["x", "y", "x2", "y2", "latitude", "longitude", "id", "radius", "theta", "detail"],
        "legends": ["color", "group", "size", "shape", "text", "opacity" ],
        "facets": ["column", "row"],
        "data fields": ["field 1", "field 2", "field 3", "field 4", "field 5", 'field 6']
}

const tablePlots: ChartTemplate[] = [
    {
        "chart": "Auto",
        "icon": <InsightsIcon color="primary" />,
        "template": { },
        "channels": [],
        "paths": { }
    },
    {
        "chart": "Table",
        "icon": <ChartIcon src={chartIconTable} />,
        "template": { },
        "channels": [], //"field 1", "field 2", "field 3", "field 4", "field 5", 'field 6'
        "paths": { }
    },
]

const scatterPlots: ChartTemplate[] = [
    {
        "chart": "Scatter Plot",
        "icon": <ChartIcon src={chartIconScatter} />,
        "template": {
            "mark": "circle",
            "encoding": { }
        },
        "channels": ["x", "y", "color", "size", "opacity", "column", "row"],
        "paths": {
            "x": ["encoding", "x"],
            "y": ["encoding", "y"],
            "color": ["encoding", "color"],
            "size": ["encoding", "size"],
            "opacity": ["encoding", "opacity"],
            "column": ["encoding", "column"],
            "row": ["encoding", "row"]
        },
        "configProperties": [
            { key: "opacity", label: "Opacity", type: "slider", min: 0.1, max: 1, step: 0.05, defaultValue: 1 },
        ] as ConfigPropertyDef[],
        "postProcessor": (vgSpec: any, _table: any[], config?: Record<string, any>) => {
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
        }
    },
    {
        "chart": "Linear Regression",
        "icon": <ChartIcon src={chartIconLinearRegression} />,
        "template": {
            "layer": [
                {
                  "mark": "circle",
                  "encoding": { "x": {}, "y": {}, "color": {}, "size": {} }
                },
                {
                  "mark": {
                    "type": "line", "color": "red"
                  },
                  "transform": [
                    {
                      "regression": "field1",
                      "on": "field2",
                      "group": "field3"
                    }
                  ],
                  "encoding": {
                    "x": {},
                    "y": {}
                  }
                }
              ]
        },
        "channels": ["x", "y", "size", "color", "column"],
        "paths": {
            "x": [["layer", 0, "encoding", "x"], ["layer", 1, "encoding", "x"], ["layer", 1, "transform", 0, "on"]],
            "y": [["layer", 0, "encoding", "y"], ["layer", 1, "encoding", "y"], ["layer", 1, "transform", 0, "regression"]],
            "color": ["layer", 0, "encoding", "color"],
            "size": ["layer", 0, "encoding", "size"]
        }
    },
    {
        "chart": "Ranged Dot Plot",
        "icon": <ChartIcon src={chartIconDotPlotHorizontal} />,
        "template": {
            "encoding": { },
            "layer": [
                {
                    "mark": "line",
                    "encoding": {
                        "detail": { },
                    }
                },
                {
                    "mark": {
                        "type": "point",
                        "filled": true
                    },
                    "encoding": {
                        "color": {}
                    }
                }
            ]
        },
        "channels": ["x", "y", "color"],
        "paths": {
            "x": ["encoding", "x"],
            "y": ["encoding", "y"],
            "color": ["layer", 1, "encoding", "color"]
        },
        "postProcessor": (vgSpec: any,  table: any[]) => {
            if (vgSpec.encoding.y?.type == "nominal") {
                vgSpec['layer'][0]['encoding']['detail'] = JSON.parse(JSON.stringify(vgSpec['encoding']['y']))
            } else if (vgSpec.encoding.x?.type == "nominal") {
                vgSpec['layer'][0]['encoding']['detail'] = JSON.parse(JSON.stringify(vgSpec['encoding']['x']))
            } else {
                
            }
            return vgSpec;
        }
    }, 
    {
        "chart": "Boxplot",
        "icon": <ChartIcon src={chartIconBoxPlot} />,
        "template": {
            "mark": "boxplot",
            "encoding": { }
        },
        "channels": ["x", "y", "color", "opacity", "column", "row"],
        "paths": Object.fromEntries(["x", "y", "color", "opacity", "column", "row"].map(channel => [channel, ["encoding", channel]])),
        "postProcessor": (vgSpec: any,  table: any[]) => {
            const hasX = vgSpec.encoding.x?.field;
            const hasY = vgSpec.encoding.y?.field;
            
            // If only one axis is defined, show a helpful message
            if (hasX && hasY) {
                // Both axes defined - determine which should be nominal
                // Vertical boxplot: x is nominal, y is quantitative
                // Horizontal boxplot: y is nominal, x is quantitative
                ensureNominalAxis(vgSpec, table, true);
            }
            return vgSpec;
        }
    }
]

const barCharts: ChartTemplate[] = [
    {
        "chart": "Bar Chart",
        "icon": <ChartIcon src={chartIconColumn} />,
        "template": {
            "mark": "bar",
            "encoding": { }
        },
        "channels": ["x", "y", "color", "opacity", "column", "row"],
        "paths": {
            "x": ["encoding", "x"],
            "y": ["encoding", "y"],
            "color": ["encoding", "color"],
            "opacity": ["encoding", "opacity"],
            "column": ["encoding", "column"],
            "row": ["encoding", "row"]
        },
        "configProperties": [
            { key: "cornerRadius", label: "Corners", type: "slider", min: 0, max: 15, step: 1, defaultValue: 0 },
        ] as ConfigPropertyDef[],
        "postProcessor": (vgSpec: any, _table: any[], config?: Record<string, any>) => {
            if (!config) return vgSpec;
            const cr = config.cornerRadius;
            if (cr !== undefined && cr > 0) {
                if (typeof vgSpec.mark === 'string') {
                    vgSpec.mark = { type: vgSpec.mark, cornerRadiusEnd: cr };
                } else {
                    vgSpec.mark = { ...vgSpec.mark, cornerRadiusEnd: cr };
                }
            }
            return vgSpec;
        }
    },
    {
        "chart": "Pyramid Chart",
        "icon": <ChartIcon src={chartIconPyramid} />,
        "template": {
            "spacing": 0,
            "resolve": {"scale": {"y": "shared"}},
            "hconcat": [{
                "mark": "bar",
                "encoding": {
                    "y": { },
                    "x": { "scale": {"reverse": true}, "stack": null},
                    "color": {  "legend": null },
                    "opacity": {"value": 0.9}
                }
            }, {
                "mark": "bar",
                "encoding": {
                    "y": {"axis": null},
                    "x": {"stack": null},
                    "color": { "legend": null},
                    "opacity": {"value": 0.9},
                }
            }],
            "config": {
                "view": {"stroke": null},
                "axis": {"grid": false}
            },
        },
        "channels": ["x", "y", "color"],
        "paths": {
            "x": [["hconcat", 0, "encoding", "x"], ["hconcat", 1, "encoding", "x"]],
            "y": [["hconcat", 0, "encoding", "y"], ["hconcat", 1, "encoding", "y"]],
            "color": [["hconcat", 0, "encoding", "color"], ["hconcat", 1, "encoding", "color"]],
        },
        "postProcessor": (vgSpec: any, table: any[]) => {
            try {
                if (table) {
                    let colorField = vgSpec['hconcat'][0]['encoding']['color']['field'];
                    let colorValues = [...new Set(table.map(r => r[colorField]))] ;
                    vgSpec.hconcat[0].transform = [{"filter": `datum[\"${colorField}\"] == \"${colorValues[0]}\"`}]
                    vgSpec.hconcat[0].title = colorValues[0]
                    vgSpec.hconcat[1].transform = [{"filter": `datum[\"${colorField}\"] == \"${colorValues[1]}\"`}]
                    vgSpec.hconcat[1].title = colorValues[1]
                    let xField = vgSpec['hconcat'][0]['encoding']['x']['field'];
                    let xValues = [...new Set(table.filter(r => r[colorField] == colorValues[0] || r[colorField] == colorValues[1]).map(r => r[xField]))];
                    let domain = [Math.min(...xValues, 0), Math.max(...xValues)]
                    vgSpec.hconcat[0]['encoding']['x']['scale']['domain'] = domain;
                    vgSpec.hconcat[1]['encoding']['x']['scale'] = {domain: domain};
                }
            } catch {

            }
            return vgSpec;
        }
    },
    {
        "chart": "Grouped Bar Chart",
        "icon": <ChartIcon src={chartIconColumnGrouped} />,
        "template": {
            "mark": "bar",
            "encoding": {
            }
        },
        "channels": ["x", "y", "color", "column", "row"],
        "paths": {
            "x": ["encoding", "x"],
            "y": ["encoding", "y"],
            "color": [["encoding", "color"]],
            "column": ["encoding", "column"],
            "row": ["encoding", "row"]
        },
        "postProcessor": (vgSpec: any, table: any[]) => {
            if (!vgSpec.encoding.color?.field) return vgSpec;
            
            const nominalChannel = ensureNominalAxis(vgSpec, table, true);
            const offsetChannel = nominalChannel === "x" ? "xOffset" : nominalChannel === "y" ? "yOffset" : null;
            
            if (nominalChannel && offsetChannel) {
                if (!vgSpec.encoding[offsetChannel]) {
                    vgSpec.encoding[offsetChannel] = {};
                }
                vgSpec.encoding[offsetChannel].field = vgSpec.encoding.color.field;
                vgSpec.encoding[offsetChannel].type = "nominal";
            }
            return vgSpec;
        }
    },
    {
        "chart": "Stacked Bar Chart",
        "icon": <ChartIcon src={chartIconColumnStacked} />,
        "template": {
            "mark": "bar",
            "encoding": { }
        },
        "channels": ["x", "y", "color", "column", "row"],
        "paths": {
            "x": ["encoding", "x"],
            "y": ["encoding", "y"],
            "color": ["encoding", "color"],
            "column": ["encoding", "column"],
            "row": ["encoding", "row"]
        }
    },
    {
        "chart": "Histogram",
        "icon": <ChartIcon src={chartIconHistogram} />,
        "template": {
            "mark": "bar",
            "encoding": {
                "x": {"bin": true},
                "y": {"aggregate": "count"}
            }
        },
        "channels": ["x", "color", "column", "row"],
        "paths": {
            "x": ["encoding", "x"],
            "color": ["encoding", "color"],
            "column": ["encoding", "column"],
            "row": ["encoding", "row"]
        },
        "configProperties": [
            { key: "binCount", label: "Bins", type: "slider", min: 5, max: 50, step: 1, defaultValue: 10 },
        ] as ConfigPropertyDef[],
        "postProcessor": (vgSpec: any, _table: any[], config?: Record<string, any>) => {
            if (!config) return vgSpec;
            const binCount = config.binCount;
            if (binCount !== undefined && vgSpec.encoding?.x) {
                vgSpec.encoding.x.bin = { maxbins: binCount };
            }
            return vgSpec;
        }
    },
    {
        "chart": "Heatmap",
        "icon": <ChartIcon src={chartIconHeatMap} />,
        "template": {
            "mark": "rect",
            "encoding": {  }
        },
        "channels": ["x", "y", "color", "column", "row"],
        "paths": Object.fromEntries(["x", "y", "color", "column", "row"].map(channel => [channel, ["encoding", channel]])),
        "configProperties": [
            { key: "colorScheme", label: "Scheme", type: "select", options: [
                {value: undefined, label: "Default"},
                {value: "viridis", label: "Viridis"},
                {value: "inferno", label: "Inferno"},
                {value: "magma", label: "Magma"},
                {value: "plasma", label: "Plasma"},
                {value: "turbo", label: "Turbo"},
                {value: "blues", label: "Blues"},
                {value: "reds", label: "Reds"},
                {value: "greens", label: "Greens"},
                {value: "oranges", label: "Oranges"},
                {value: "purples", label: "Purples"},
                {value: "greys", label: "Greys"},
                {value: "blueorange", label: "Blue-Orange (diverging)"},
                {value: "redblue", label: "Red-Blue (diverging)"},
            ]},
        ] as ConfigPropertyDef[],
        "postProcessor": (vgSpec: any, table: any[], config?: Record<string, any>) => {
            if (vgSpec.encoding.y && vgSpec.encoding.y.type != "nominal") {
                vgSpec.encoding.y.type = "nominal";
            } 
            if (vgSpec.encoding.x && vgSpec.encoding.x.type != "nominal") {
                vgSpec.encoding.x.type = "nominal";
            }
            if (config?.colorScheme && vgSpec.encoding.color) {
                if (!vgSpec.encoding.color.scale) vgSpec.encoding.color.scale = {};
                vgSpec.encoding.color.scale.scheme = config.colorScheme;
            }
            return vgSpec;
        }
    }
]

const mapCharts: ChartTemplate[] = [
    {
        "chart": "US Map",
        "icon": <ChartIcon src={chartIconUSMap} />,
        "template": {
            "width": 500,
            "height": 300,
            "layer": [
                {
                    "data": {
                        "url": "https://vega.github.io/vega-lite/data/us-10m.json",
                        "format": {
                            "type": "topojson",
                            "feature": "states"
                        }
                    },
                    "projection": {
                        "type": "albersUsa"
                    },
                    "mark": {
                        "type": "geoshape",
                        "fill": "lightgray",
                        "stroke": "white"
                    }
                },
                {
                    "projection": {
                        "type": "albersUsa"
                    },
                    "mark": "circle",
                    "encoding": {
                        "longitude": { },
                        "latitude": { },
                        "size": {},
                        "color": {}
                    }
                }
            ]
        },
        "channels": ["longitude", "latitude", "color", "size"],
        "paths": {
            "longitude": ["layer", 1, "encoding", "longitude"],
            "latitude": ["layer", 1, "encoding", "latitude"],
            "color": ["layer", 1, "encoding", "color"],
            "size": ["layer", 1, "encoding", "size"]
        },
        "configProperties": [] as ConfigPropertyDef[],
        "postProcessor": (vgSpec: any, _table: any[], _config?: Record<string, any>) => {
            return vgSpec;
        }
    },
    {
        "chart": "World Map",
        "icon": <ChartIcon src={chartIconWorldMap} />,
        "template": {
            "width": 600,
            "height": 350,
            "layer": [
                {
                    "data": {
                        "url": "https://vega.github.io/vega-lite/data/world-110m.json",
                        "format": {
                            "type": "topojson",
                            "feature": "countries"
                        }
                    },
                    "projection": {
                        "type": "equalEarth"
                    },
                    "mark": {
                        "type": "geoshape",
                        "fill": "lightgray",
                        "stroke": "white"
                    }
                },
                {
                    "projection": {
                        "type": "equalEarth"
                    },
                    "mark": "circle",
                    "encoding": {
                        "longitude": { },
                        "latitude": { },
                        "size": {},
                        "color": {},
                        "opacity": {}
                    }
                }
            ]
        },
        "channels": ["longitude", "latitude", "color", "size", "opacity"],
        "paths": {
            "longitude": ["layer", 1, "encoding", "longitude"],
            "latitude": ["layer", 1, "encoding", "latitude"],
            "color": ["layer", 1, "encoding", "color"],
            "size": ["layer", 1, "encoding", "size"],
            "opacity": ["layer", 1, "encoding", "opacity"]
        },
        "configProperties": [
            {
                key: "projection",
                label: "Projection",
                type: "select",
                options: [{value: "default", label: "Default"}, ...MAP_PROJECTIONS.map(p => ({value: p.value, label: p.label}))],
                defaultValue: "default",
            },
            {
                key: "projectionCenter",
                label: "Center",
                type: "select",
                options: [{value: undefined, label: "Default"}, ...PROJECTION_CENTER_PRESETS.map(p => ({value: p.center, label: `${p.label} [${p.center[0]}, ${p.center[1]}]`}))],
                defaultValue: undefined,
            },
        ] as ConfigPropertyDef[],
        "postProcessor": (vgSpec: any, _table: any[], config?: Record<string, any>) => {
            if (!config) return vgSpec;
            const projection = config.projection;
            const projectionCenter = config.projectionCenter;
            const applyProjection = (obj: any) => {
                if (obj?.projection) {
                    if (projection && projection !== 'default') {
                        obj.projection.type = projection;
                    }
                    // albersUsa is a composite projection that doesn't support rotate/center
                    if (projectionCenter && obj.projection.type !== 'albersUsa') {
                        // In Vega-Lite, use rotate to re-center the map (negate lon/lat)
                        obj.projection.rotate = [-projectionCenter[0], -projectionCenter[1], 0];
                    }
                }
            };
            if (vgSpec.layer && Array.isArray(vgSpec.layer)) {
                for (const layer of vgSpec.layer) applyProjection(layer);
            }
            applyProjection(vgSpec);
            return vgSpec;
        }
    }
]

const pieCharts: ChartTemplate[] = [
    {
        "chart": "Pie Chart",
        "icon": <ChartIcon src={chartIconPie} />,
        "template": {
            "mark": "arc",
            "encoding": { }
        },
        "channels": ["theta", "color", "column", "row"],
        "paths": {
            "theta": ["encoding", "theta"],
            "color": ["encoding", "color"],
            "column": ["encoding", "column"],
            "row": ["encoding", "row"]
        },
        "configProperties": [
            { key: "innerRadius", label: "Donut", type: "slider", min: 0, max: 100, step: 5, defaultValue: 0 },
        ] as ConfigPropertyDef[],
        "postProcessor": (vgSpec: any, _table: any[], config?: Record<string, any>) => {
            if (!config) return vgSpec;
            const innerRadius = config.innerRadius;
            if (innerRadius !== undefined && innerRadius > 0) {
                if (typeof vgSpec.mark === 'string') {
                    vgSpec.mark = { type: vgSpec.mark, innerRadius };
                } else {
                    vgSpec.mark = { ...vgSpec.mark, innerRadius };
                }
            }
            return vgSpec;
        }
    }
]

let lineCharts = [
    {
        "chart": "Line Chart",
        "icon": <ChartIcon src={chartIconLine} />,
        "template": {
            "mark": "line",
            "encoding": { }
        },
        "channels": ["x", "y", "color", "opacity", "column", "row"],
        "paths": {
            "x": ["encoding", "x"],
            "y": ["encoding", "y"],
            "color": ["encoding", "color"],
            "opacity": ["encoding", "opacity"],
            "column": ["encoding", "column"],
            "row": ["encoding", "row"]
        },
        "configProperties": [
            { key: "interpolate", label: "Curve", type: "select", options: [
                {value: undefined, label: "Default (linear)"},
                {value: "linear", label: "Linear"},
                {value: "monotone", label: "Monotone (smooth)"},
                {value: "step", label: "Step"},
                {value: "step-before", label: "Step Before"},
                {value: "step-after", label: "Step After"},
                {value: "basis", label: "Basis (smooth)"},
                {value: "cardinal", label: "Cardinal"},
                {value: "catmull-rom", label: "Catmull-Rom"},
            ]},
        ] as ConfigPropertyDef[],
        "postProcessor": (vgSpec: any, _table: any[], config?: Record<string, any>) => {
            if (!config?.interpolate) return vgSpec;
            if (typeof vgSpec.mark === 'string') {
                vgSpec.mark = { type: vgSpec.mark, interpolate: config.interpolate };
            } else {
                vgSpec.mark = { ...vgSpec.mark, interpolate: config.interpolate };
            }
            return vgSpec;
        }
    },
    {
        "chart": "Dotted Line Chart",
        "icon": <ChartIcon src={chartIconDottedLine} />,
        "template": {
            "mark": {"type": "line", "point": true},
            "encoding": { }
        },
        "channels": ["x", "y", "color", "column", "row"],
        "paths": {
            "x": ["encoding", "x"],
            "y": ["encoding", "y"],
            "color": ["encoding", "color"],
            "opacity": ["encoding", "opacity"],
            "column": ["encoding", "column"],
            "row": ["encoding", "row"]
        },
        "configProperties": [
            { key: "interpolate", label: "Curve", type: "select", options: [
                {value: undefined, label: "Default (linear)"},
                {value: "linear", label: "Linear"},
                {value: "monotone", label: "Monotone (smooth)"},
                {value: "step", label: "Step"},
                {value: "step-before", label: "Step Before"},
                {value: "step-after", label: "Step After"},
                {value: "basis", label: "Basis (smooth)"},
                {value: "cardinal", label: "Cardinal"},
                {value: "catmull-rom", label: "Catmull-Rom"},
            ]},
        ] as ConfigPropertyDef[],
        "postProcessor": (vgSpec: any, _table: any[], config?: Record<string, any>) => {
            if (!config?.interpolate) return vgSpec;
            if (typeof vgSpec.mark === 'string') {
                vgSpec.mark = { type: vgSpec.mark, interpolate: config.interpolate };
            } else {
                vgSpec.mark = { ...vgSpec.mark, interpolate: config.interpolate };
            }
            return vgSpec;
        }
    },
]

let customCharts = [
    {
        "chart": "Custom Point",
        "icon": <ChartIcon src={chartIconCustomPoint} />,
        "template": {
            "mark": "point",
            "encoding": { }
        },
        "channels": ["x", "y", "color", "opacity", "size", "shape", "column", "row"],
        "paths": Object.fromEntries(["x", "y", "color", "opacity", "size", "shape", "column", "row"].map(channel => [channel, ["encoding", channel]]))
    },
    {
        "chart": "Custom Line",
        "icon": <ChartIcon src={chartIconCustomLine} />,
        "template": {
            "mark": "line",
            "encoding": {  }
        },
        "channels": ["x", "y", "color", "opacity", "detail", "column", "row"],
        "paths": Object.fromEntries(
            [
                ...["x", "y", "color", "opacity", "column", "row"].map(channel => [channel, ["encoding", channel]]),
                ["detail", ["encoding", "detail"]]
            ]
        )
    },
    {
        "chart": "Custom Bar",
        "icon": <ChartIcon src={chartIconCustomBar} />,
        "template": {
            "mark": "bar",
            "encoding": { }
        },
        "channels": ["x", "y", "color", "opacity", "size", "shape", "column", "row"],
        "paths": Object.fromEntries(["x", "y", "color", "opacity", "size", "shape", "column", "row"].map(channel => [channel, ["encoding", channel]]))
    }, 
    {
        "chart": "Custom Rect",
        "icon": <ChartIcon src={chartIconCustomRect} />,
        "template": {
            "mark": "rect",
            "encoding": { }
        },
        "channels": ["x", "y", "x2", "y2", "color", "opacity", "column", "row"],
        "paths": Object.fromEntries(["x", "y", "x2", "y2", "color", "opacity", "column", "row"].map(channel => [channel, ["encoding", channel]]))
    },
    {
        "chart": "Custom Area",
        "icon": <ChartIcon src={chartIconCustomArea} />,
        "template": {
            "mark": "area",
            "encoding": { }
        },
        "channels": ["x", "y", "x2", "y2", "color", "column", "row"],
        "paths": Object.fromEntries(["x", "y", "x2", "y2", "color", "column", "row"].map(channel => [channel, ["encoding", channel]]))
    }
]


export const CHART_TEMPLATES : {[key: string] : ChartTemplate[]} = {
    "table": tablePlots,
    "scatter": scatterPlots,
    "bar": barCharts,
    "map": mapCharts,
    "pie": pieCharts,
    "line": lineCharts,
    "custom": customCharts,
}