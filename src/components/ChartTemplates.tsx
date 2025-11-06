// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplate } from "./ComponentType";
import InsightsIcon from '@mui/icons-material/Insights';
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
            if (vgSpec.encoding.x && vgSpec.encoding.x.type != "nominal") {
                vgSpec.encoding.x.type = "nominal";
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
        }
    },
    {
        "chart": "Pyramid Chart",
        "icon": <ChartIcon src={chartIconColumn} />,
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
            "color": [["encoding", "xOffset"], ["encoding", "color"]],
            "column": ["encoding", "column"],
            "row": ["encoding", "row"]
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
            }
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
        "chart": "Heatmap",
        "icon": <ChartIcon src={chartIconHeatMap} />,
        "template": {
            "mark": "rect",
            "encoding": {  }
        },
        "channels": ["x", "y", "color", "column", "row"],
        "paths": Object.fromEntries(["x", "y", "color", "column", "row"].map(channel => [channel, ["encoding", channel]])),
        "postProcessor": (vgSpec: any, table: any[]) => {
            if (vgSpec.encoding.y && vgSpec.encoding.y.type != "nominal") {
                vgSpec.encoding.y.type = "nominal";
            } 
            if (vgSpec.encoding.x && vgSpec.encoding.x.type != "nominal") {
                vgSpec.encoding.x.type = "nominal";
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
    "line": lineCharts,
    "custom": customCharts,
}