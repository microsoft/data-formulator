// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplate } from "./ComponentType";
import InsightsIcon from "@mui/icons-material/Insights";
import React from "react";

// Import all chart icons statically so they are included in the build
import chartIconTable from "../assets/chart-icon-table-min.png";
import chartIconScatter from "../assets/chart-icon-scatter-min.png";
import chartIconLinearRegression from "../assets/chart-icon-linear-regression-min.png";
import chartIconDotPlotHorizontal from "../assets/chart-icon-dot-plot-horizontal-min.png";
import chartIconBoxPlot from "../assets/chart-icon-box-plot-min.png";
import chartIconColumn from "../assets/chart-icon-column-min.png";
import chartIconColumnGrouped from "../assets/chart-icon-column-grouped-min.png";
import chartIconColumnStacked from "../assets/chart-icon-column-stacked-min.png";
import chartIconHistogram from "../assets/chart-icon-histogram-min.png";
import chartIconHeatMap from "../assets/chart-icon-heat-map-min.png";
import chartIconLine from "../assets/chart-icon-line-min.png";
import chartIconDottedLine from "../assets/chart-icon-dotted-line-min.png";
import chartIconCustomPoint from "../assets/chart-icon-custom-point-min.png";
import chartIconCustomLine from "../assets/chart-icon-custom-line-min.png";
import chartIconCustomBar from "../assets/chart-icon-custom-bar-min.png";
import chartIconCustomRect from "../assets/chart-icon-custom-rect-min.png";
import chartIconCustomArea from "../assets/chart-icon-custom-area-min.png";

import chartIconHistogramPercent from "../assets/histogram-percent.png";
import chartIconQCTrendChart from "../assets/qc-trend-chart.png";
import chartIconQCTrendStackBar from "../assets/QCTrendStackBar.png";
import chartIconProfitandLoss from "../assets/Profit-and-loss.png";
import chartIconRadialPlot from "../assets/Radial-Plot.png";
import chartIconBubblePlot from "../assets/buble-plot.png";
import chartIconLayeringRolling from "../assets/Layering_Rolling.png";
import chartIconThreshold from "../assets/threshold.png";
import chartIconPie from "../assets/PieChart.png";
import chartIconArea from "../assets/area-chart.png";
import { interpolate, line } from "d3";
import { size } from "lodash";
import { log } from "console";

// Chart Icon Component using static imports
const ChartIcon: React.FC<{ src: string; alt?: string }> = ({
  src,
  alt = "",
}) => {
  return (
    <img
      src={src}
      alt={alt}
      style={{ width: "100%", height: "100%", objectFit: "contain" }}
    />
  );
};

/**
 * Calculate optimal Y-axis domain for bar/column charts to show small differences clearly.
 * Automatically detects min/max values and adds smart padding.
 *
 * Example:
 *   Data values: [45.1, 45.2, 45.3]
 *   Without domain: Y-axis might scale 0-100 (too large)
 *   With smart domain: Y-axis scales 45.0-45.4 (shows differences clearly)
 *
 * @param data - Array of data points
 * @param yField - Field name containing Y values
 * @param paddingPercent - Padding percentage (default 10%) to add above/below range
 * @returns [minDomain, maxDomain] for VegaLite scale
 */
function calculateOptimalYDomain(
  data: any[],
  yField: string,
  paddingPercent: number = 10,
): [number, number] | null {
  if (!data || data.length === 0 || !yField) return null;

  // Extract all numeric Y values
  const yValues = data
    .map((row) => row[yField])
    .filter((val) => typeof val === "number" && isFinite(val));

  if (yValues.length === 0) return null;

  const minValue = Math.min(...yValues);
  const maxValue = Math.max(...yValues);
  const range = maxValue - minValue;

  // If all values are the same, just add small padding
  if (range === 0) {
    const padding = Math.abs(minValue) * 0.1 || 0.1;
    return [minValue - padding, minValue + padding];
  }

  // Add percentage-based padding to each side
  const padding = range * (paddingPercent / 100);
  return [minValue - padding, maxValue + padding];
}

export function getChartTemplate(chartType: string): ChartTemplate | undefined {
  // Map legacy/alternative chart type names to current names
  const chartTypeAliases: { [key: string]: string } = {
    Heatmap: "Heat Map",
    "Custom Area": "Area Chart",
  };

  const normalizedChartType = chartTypeAliases[chartType] || chartType;

  return Object.values(CHART_TEMPLATES)
    .flat()
    .find((t) => t.chart === normalizedChartType);
}

export const getChartChannels = (chartType: string) => {
  return getChartTemplate(chartType)?.channels || [];
};

export const CHANNEL_LIST = [
  "x",
  "y",
  "x2",
  "y2",
  "id",
  "color",
  "opacity",
  "size",
  "shape",
  "column",
  "row",
  "latitude",
  "longitude",
  "theta",
  "radius",
  "detail",
  "group",
  "field 1",
  "field 2",
  "field 3",
  "field 4",
  "field 5",
  "field 6",
  "TARGET",
  "ARUL",
  "ARLL",
  "UL",
  "LL",
  "QCDATE",
  "QCSHIFT",
  "VALUE",
  "INDEX",
] as const;

export const ChannelGroups = {
  "": [
    "x",
    "y",
    "x2",
    "y2",
    "latitude",
    "longitude",
    "id",
    "radius",
    "theta",
    "detail",
  ],
  legends: ["color", "group", "size", "shape", "text", "opacity"],
  facets: ["column", "row"],
  "data fields": [
    "field 1",
    "field 2",
    "field 3",
    "field 4",
    "field 5",
    "field 6",
    "TARGET",
    "ARUL",
    "ARLL",
    "UL",
    "LL",
    "QCDATE",
    "QCSHIFT",
    "VALUE",
    "INDEX",
  ],
};

const tablePlots: ChartTemplate[] = [
  {
    chart: "Auto",
    icon: <InsightsIcon color="primary" />,
    template: {},
    channels: [],
    paths: {},
  },
  {
    chart: "Table",
    icon: <ChartIcon src={chartIconTable} />,
    template: {},
    channels: [], //"field 1", "field 2", "field 3", "field 4", "field 5", 'field 6'
    paths: {},
  },
];

const scatterPlots: ChartTemplate[] = [
  {
    chart: "Scatter Plot",
    icon: <ChartIcon src={chartIconScatter} />,
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
    postProcessor: (
      vgSpec: any,
      _table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      vgSpec.width = chartWidth || 800;
      vgSpec.height = chartHeight || 400;
      return vgSpec;
    },
  },
  {
    chart: "Linear Regression",
    icon: chartIconLinearRegression,
    template: {
      layer: [
        {
          mark: "circle",
          encoding: { x: {}, y: {}, color: {}, size: {} },
        },
        {
          mark: {
            type: "line",
            color: "red",
          },
          transform: [
            {
              regression: "field1",
              on: "field2",
              group: "field3",
            },
          ],
          encoding: {
            x: {},
            y: {},
          },
        },
      ],
    },
    channels: ["x", "y", "size", "color", "column"],
    paths: {
      x: [
        ["layer", 0, "encoding", "x"],
        ["layer", 1, "encoding", "x"],
        ["layer", 1, "transform", 0, "on"],
      ],
      y: [
        ["layer", 0, "encoding", "y"],
        ["layer", 1, "encoding", "y"],
        ["layer", 1, "transform", 0, "regression"],
      ],
      color: ["layer", 0, "encoding", "color"],
      size: ["layer", 0, "encoding", "size"],
    },

    // ✅ Thêm phần postProcessor
    postProcessor: (
      vgSpec: any,
      _table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      try {
        const layers = vgSpec.layer || [];
        for (const layer of layers) {
          if (layer.encoding?.y?.type === "quantitative") {
            layer.encoding.y.scale = { zero: false };
          }
        }
      } catch (e) {
        console.warn("Linear Regression postProcessor error", e);
      }
      vgSpec.width = chartWidth || 800;
      vgSpec.height = chartHeight || 400;
      return vgSpec;
    },
  },
  {
    chart: "Loess Regression",
    icon: chartIconLinearRegression,
    template: {
      layer: [
        {
          mark: "circle",
          encoding: { x: {}, y: {}, color: {}, size: {} },
        },
        {
          mark: {
            type: "line",
            color: "blue",
            size: 3,
          },
          transform: [
            {
              loess: "field1",
              on: "field2",
              group: "field3",
            },
          ],
          encoding: { x: {}, y: {} },
        },
      ],
    },
    channels: ["x", "y", "size", "color", "column"],
    paths: {
      x: [
        ["layer", 0, "encoding", "x"],
        ["layer", 1, "encoding", "x"],
        ["layer", 1, "transform", 0, "on"],
      ],
      y: [
        ["layer", 0, "encoding", "y"],
        ["layer", 1, "encoding", "y"],
        ["layer", 1, "transform", 0, "loess"],
      ],
      color: ["layer", 0, "encoding", "color"],
      size: ["layer", 0, "encoding", "size"],
    },
    // ✅ Thêm postProcessor
    postProcessor: (
      vgSpec: any,
      _table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      try {
        const layers = vgSpec.layer || [];
        for (const layer of layers) {
          if (layer.encoding?.y?.type === "quantitative") {
            // Nếu Y là số thì scale.zero = false
            layer.encoding.y.scale = { zero: false };
          }
        }
      } catch (e) {
        console.warn("Loess Regression postProcessor error", e);
      }
      vgSpec.width = chartWidth || 800;
      vgSpec.height = chartHeight || 400;
      return vgSpec;
    },
  },
  {
    chart: "Ranged Dot Plot",
    icon: <ChartIcon src={chartIconDotPlotHorizontal} />,
    template: {
      encoding: {},
      layer: [
        {
          mark: "line",
          encoding: {
            detail: {},
          },
        },
        {
          mark: {
            type: "point",
            filled: true,
          },
          encoding: {
            color: {},
          },
        },
      ],
    },
    channels: ["x", "y", "color"],
    paths: {
      x: ["encoding", "x"],
      y: ["encoding", "y"],
      color: ["layer", 1, "encoding", "color"],
    },
    postProcessor: (
      vgSpec: any,
      table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      if (vgSpec.encoding.y?.type == "nominal") {
        vgSpec["layer"][0]["encoding"]["detail"] = JSON.parse(
          JSON.stringify(vgSpec["encoding"]["y"]),
        );
      } else if (vgSpec.encoding.x?.type == "nominal") {
        vgSpec["layer"][0]["encoding"]["detail"] = JSON.parse(
          JSON.stringify(vgSpec["encoding"]["x"]),
        );
      } else {
      }
      vgSpec.width = chartWidth || 800;
      vgSpec.height = chartHeight || 400;
      return vgSpec;
    },
  },
  {
    chart: "Boxplot",
    icon: <ChartIcon src={chartIconBoxPlot} />,
    template: {
      mark: "boxplot",
      encoding: {},
    },
    channels: ["x", "y", "color", "opacity", "column", "row"],
    paths: Object.fromEntries(
      ["x", "y", "color", "opacity", "column", "row"].map((channel) => [
        channel,
        ["encoding", channel],
      ]),
    ),
    postProcessor: (
      vgSpec: any,
      table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      if (vgSpec.encoding.x && vgSpec.encoding.x.type != "nominal") {
        vgSpec.encoding.x.type = "nominal";
      }
      vgSpec.width = chartWidth || 800;
      vgSpec.height = chartHeight || 400;
      return vgSpec;
    },
  },
];

const barCharts: ChartTemplate[] = [
  {
    chart: "Bar Chart",
    icon: <ChartIcon src={chartIconColumn} />,
    template: {
      mark: "bar",
      encoding: {},
    },
    channels: ["x", "y", "color", "opacity", "column", "row"],
    paths: {
      x: ["encoding", "x"],
      y: ["encoding", "y"],
      color: ["encoding", "color"],
      opacity: ["encoding", "opacity"],
      column: ["encoding", "column"],
      row: ["encoding", "row"],
    },
    postProcessor: (
      vgSpec: any,
      table: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      // Smart domain calculation for Y-axis and responsive width
      try {
        const yDef = vgSpec.encoding?.y;
        if (!yDef || !yDef.field) return vgSpec;

        const yField = yDef.field;
        const domain = calculateOptimalYDomain(table, yField, 10);

        // Configure Y-axis scale
        if (domain) {
          if (!yDef.scale) yDef.scale = {};
          yDef.scale.domain = [
            Math.floor(domain[0] * 100) / 100,
            Math.ceil(domain[1] * 100) / 100,
          ];
          yDef.scale.zero = false;
          yDef.scale.nice = false;
          yDef.scale.clamp = true; // 🔧 Clamp values to domain
        }

        // Calculate responsive width based on number of bars
        const xDef = vgSpec.encoding?.x;
        const xField = xDef?.field;
        const numBars = xField
          ? new Set(table.map((row: any) => row[xField])).size
          : table.length;

        // Simple calculation: 150px per bar, minimum 950px
        const width = chartWidth || Math.max(950, numBars * 50);

        // Configure X-axis scale (minimal, let Vega-Lite handle band automatically)
        if (xDef) {
          if (!xDef.scale) xDef.scale = {};
          xDef.scale.padding = 0.05;
          xDef.scale.paddingOuter = 0.05;

          // Remove any complex scale properties
          delete xDef.scale.type;
          delete xDef.scale.range;

          // 🔧 FORCE ordinal type for bar charts - prevents Vega-Lite from interpolating missing values
          xDef.type = "ordinal";
        }

        // Set top-level width (this is the correct Vega-Lite way)
        vgSpec.width = width;
        vgSpec.height = chartHeight || 450;

        // Clean up config - only keep essentials
        if (!vgSpec.config) vgSpec.config = {};
        if (!vgSpec.config.view) vgSpec.config.view = {};
        vgSpec.config.view.continuousHeight = chartHeight || 450;

        // Remove problematic properties
        delete vgSpec.config.view.continuousWidth;
        delete vgSpec.config.view.clip;
        delete vgSpec.config.view.step;

        // Simplify mark
        if (typeof vgSpec.mark === "string") {
          vgSpec.mark = { type: vgSpec.mark, tooltip: true };
        } else if (vgSpec.mark) {
          vgSpec.mark.tooltip = true;
          delete vgSpec.mark.clip;
          delete vgSpec.mark.width;
        }
      } catch (error) {
        console.warn("⚠️ Bar Chart postProcessor failed:", error);
      }
      return vgSpec;
    },
  },
  {
    chart: "Pyramid Chart",
    icon: <ChartIcon src={chartIconColumn} />,
    template: {
      spacing: 0,

      resolve: { scale: { y: "shared" } },
      hconcat: [
        {
          mark: "bar",
          encoding: {
            y: {},
            x: { scale: { reverse: true }, stack: null },
            color: { legend: null },
            opacity: { value: 0.9 },
          },
        },
        {
          mark: "bar",
          encoding: {
            y: { axis: null },
            x: { stack: null },
            color: { legend: null },
            opacity: { value: 0.9 },
          },
        },
      ],
      config: {
        view: { stroke: null },
        axis: { grid: false },
      },
    },
    channels: ["x", "y", "color"],
    paths: {
      x: [
        ["hconcat", 0, "encoding", "x"],
        ["hconcat", 1, "encoding", "x"],
      ],
      y: [
        ["hconcat", 0, "encoding", "y"],
        ["hconcat", 1, "encoding", "y"],
      ],
      color: [
        ["hconcat", 0, "encoding", "color"],
        ["hconcat", 1, "encoding", "color"],
      ],
    },
    postProcessor: (
      vgSpec: any,
      table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      try {
        if (table) {
          let colorField = vgSpec["hconcat"][0]["encoding"]["color"]["field"];
          let colorValues = [...new Set(table.map((r) => r[colorField]))];
          vgSpec.hconcat[0].transform = [
            { filter: `datum[\"${colorField}\"] == \"${colorValues[0]}\"` },
          ];
          vgSpec.hconcat[0].title = colorValues[0];
          vgSpec.hconcat[1].transform = [
            { filter: `datum[\"${colorField}\"] == \"${colorValues[1]}\"` },
          ];
          vgSpec.hconcat[1].title = colorValues[1];
          let xField = vgSpec["hconcat"][0]["encoding"]["x"]["field"];
          let xValues = [
            ...new Set(
              table
                .filter(
                  (r) =>
                    r[colorField] == colorValues[0] ||
                    r[colorField] == colorValues[1],
                )
                .map((r) => r[xField]),
            ),
          ];
          let domain = [Math.min(...xValues, 0), Math.max(...xValues)];
          vgSpec.hconcat[0]["encoding"]["x"]["scale"]["domain"] = domain;
          vgSpec.hconcat[1]["encoding"]["x"]["scale"] = { domain: domain };
        }
      } catch {}
      vgSpec.width = chartWidth || 800;
      vgSpec.height = chartHeight || 400;
      return vgSpec;
    },
  },
  {
    chart: "Grouped Bar Chart",
    icon: <ChartIcon src={chartIconColumnGrouped} />,
    template: {
      mark: "bar",
      encoding: {},
    },
    channels: ["x", "y", "color", "column", "row"],
    paths: {
      x: ["encoding", "x"],
      y: ["encoding", "y"],
      color: [
        ["encoding", "xOffset"],
        ["encoding", "color"],
      ],
      column: ["encoding", "column"],
      row: ["encoding", "row"],
    },
    postProcessor: (
      vgSpec: any,
      table: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      // Smart domain calculation for Y-axis and responsive width
      try {
        const yDef = vgSpec.encoding?.y;
        if (!yDef || !yDef.field) return vgSpec;

        const yField = yDef.field;
        const domain = calculateOptimalYDomain(table, yField, 10);

        // Configure Y-axis scale
        if (domain) {
          if (!yDef.scale) yDef.scale = {};
          yDef.scale.domain = [
            Math.floor(domain[0] * 100) / 100,
            Math.ceil(domain[1] * 100) / 100,
          ];
          yDef.scale.zero = false;
          yDef.scale.nice = false;
          yDef.scale.clamp = true;
        }

        // Calculate responsive width based on number of groups
        const xDef = vgSpec.encoding?.x;
        const xField = xDef?.field;
        const numGroups = xField
          ? new Set(table.map((row: any) => row[xField])).size
          : table.length;

        // Simple calculation: 170px per group, minimum 950px
        const width = chartWidth || Math.max(950, numGroups * 170);

        // Configure X-axis scale (minimal)
        if (xDef) {
          if (!xDef.scale) xDef.scale = {};
          xDef.scale.padding = 0.05;
          xDef.scale.paddingOuter = 0.05;

          // 🔧 FORCE ordinal type for grouped bars
          xDef.type = "ordinal";
        }

        // Set top-level width
        vgSpec.width = width;
        vgSpec.height = chartHeight || 450;

        // Clean up config
        if (!vgSpec.config) vgSpec.config = {};
        if (!vgSpec.config.view) vgSpec.config.view = {};
        vgSpec.config.view.continuousHeight = chartHeight || 450;

        delete vgSpec.config.view.continuousWidth;
        delete vgSpec.config.view.clip;

        // Simplify mark
        if (typeof vgSpec.mark === "string") {
          vgSpec.mark = { type: vgSpec.mark, tooltip: true };
        } else if (vgSpec.mark) {
          vgSpec.mark.tooltip = true;
          delete vgSpec.mark.clip;
        }
      } catch (error) {
        console.warn("⚠️ Grouped Bar Chart postProcessor failed:", error);
      }
      return vgSpec;
    },
  },
  {
    chart: "Stacked Bar Chart",
    icon: <ChartIcon src={chartIconColumnStacked} />,
    template: {
      mark: "bar",
      encoding: {},
    },
    channels: ["x", "y", "color", "column", "row"],
    paths: {
      x: ["encoding", "x"],
      y: ["encoding", "y"],
      color: ["encoding", "color"],
      column: ["encoding", "column"],
      row: ["encoding", "row"],
    },
    postProcessor: (
      vgSpec: any,
      table: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      // Smart domain calculation for Y-axis and responsive width
      try {
        const yDef = vgSpec.encoding?.y;
        if (!yDef || !yDef.field) return vgSpec;

        const yField = yDef.field;
        const domain = calculateOptimalYDomain(table, yField, 10);

        // Configure Y-axis scale
        if (domain) {
          if (!yDef.scale) yDef.scale = {};
          yDef.scale.domain = [
            Math.floor(domain[0] * 100) / 100,
            Math.ceil(domain[1] * 100) / 100,
          ];
          yDef.scale.zero = false;
          yDef.scale.nice = false;
          yDef.scale.clamp = true;
        }

        // Calculate responsive width based on number of bars
        const xDef = vgSpec.encoding?.x;
        const xField = xDef?.field;
        const numBars = xField
          ? new Set(table.map((row: any) => row[xField])).size
          : table.length;

        // Simple calculation: 150px per bar, minimum 950px
        const width = chartWidth || Math.max(950, numBars * 150);

        // Configure X-axis scale
        if (xDef) {
          if (!xDef.scale) xDef.scale = {};
          xDef.scale.padding = 0.05;
          xDef.scale.paddingOuter = 0.05;

          // 🔧 FORCE ordinal type for stacked bars
          xDef.type = "ordinal";
        }

        // Set top-level width
        vgSpec.width = width;
        vgSpec.height = chartHeight || 450;

        // Clean up config
        if (!vgSpec.config) vgSpec.config = {};
        if (!vgSpec.config.view) vgSpec.config.view = {};
        vgSpec.config.view.continuousHeight = chartHeight || 450;

        delete vgSpec.config.view.continuousWidth;
        delete vgSpec.config.view.clip;

        // Simplify mark
        if (typeof vgSpec.mark === "string") {
          vgSpec.mark = { type: vgSpec.mark, tooltip: true };
        } else if (vgSpec.mark) {
          vgSpec.mark.tooltip = true;
          delete vgSpec.mark.clip;
        }
      } catch (error) {
        console.warn("⚠️ Stacked Bar Chart postProcessor failed:", error);
      }
      return vgSpec;
    },
  },
  {
    chart: "Histogram",
    icon: <ChartIcon src={chartIconHistogram} />,
    template: {
      mark: "bar",
      encoding: {},
    },
    channels: ["x", "y", "color", "column", "row"],
    paths: {
      x: ["encoding", "x"],
      y: ["encoding", "y"],
      color: ["encoding", "color"],
      column: ["encoding", "column"],
      row: ["encoding", "row"],
    },
    postProcessor: (
      vgSpec: any,
      table: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      // Smart domain calculation for Y-axis and responsive width
      try {
        const yDef = vgSpec.encoding?.y;
        if (!yDef || !yDef.field) return vgSpec;

        const yField = yDef.field;
        const domain = calculateOptimalYDomain(table, yField, 10);

        // Configure Y-axis scale
        if (domain) {
          if (!yDef.scale) yDef.scale = {};
          yDef.scale.domain = [
            Math.floor(domain[0] * 100) / 100,
            Math.ceil(domain[1] * 100) / 100,
          ];
          yDef.scale.zero = false;
          yDef.scale.nice = false;
          yDef.scale.clamp = true;
        }

        // Calculate responsive width based on number of bins
        const xDef = vgSpec.encoding?.x;
        const xField = xDef?.field;
        const numBins = xField
          ? new Set(table.map((row: any) => row[xField])).size
          : table.length;

        // Simple calculation: 65px per bin, minimum 950px
        const width = chartWidth || Math.max(950, numBins * 65);

        // Configure X-axis scale
        if (xDef) {
          if (!xDef.scale) xDef.scale = {};
          xDef.scale.padding = 0.05;
          xDef.scale.paddingOuter = 0.05;

          // 🔧 FORCE ordinal type for histogram
          xDef.type = "ordinal";
        }

        // Set top-level width
        vgSpec.width = width;
        vgSpec.height = chartHeight || 450;

        // Clean up config
        if (!vgSpec.config) vgSpec.config = {};
        if (!vgSpec.config.view) vgSpec.config.view = {};
        vgSpec.config.view.continuousHeight = chartHeight || 450;

        delete vgSpec.config.view.continuousWidth;
        delete vgSpec.config.view.clip;

        // Simplify mark
        if (typeof vgSpec.mark === "string") {
          vgSpec.mark = { type: vgSpec.mark, tooltip: true };
        } else if (vgSpec.mark) {
          vgSpec.mark.tooltip = true;
          delete vgSpec.mark.clip;
        }
      } catch (error) {
        console.warn("⚠️ Histogram postProcessor failed:", error);
      }
      return vgSpec;
    },
  },
  {
    chart: "Threshold Bar Chart",
    icon: chartIconThreshold,
    template: {
      mark: "bar",
      encoding: {
        x: { field: "field1", type: "quantitative" }, // <-- X là số (liên tục)
        y: { field: "field2", type: "quantitative" },
        threshold: { field: "field3" },
      },
    },
    channels: ["x", "y", "threshold"],
    paths: {
      x: [["encoding", "x"]],
      y: [["encoding", "y"]],
      threshold: [["encoding", "threshold"]],
    },
    postProcessor: (
      vgSpec: any,
      table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      const xDef = vgSpec.encoding?.x;
      const yDef = vgSpec.encoding?.y;
      const thresholdDef = vgSpec.encoding?.threshold;
      if (!xDef || !yDef) return vgSpec;

      const xField = xDef.field;
      const yField = yDef.field;

      // Lấy giá trị threshold (nếu có)
      let thresholdValue: number | null = null;
      if (thresholdDef?.field && table) {
        const vals = table
          .map((r: any) => r[thresholdDef.field])
          .filter((v: any) => typeof v === "number" && isFinite(v));
        if (vals.length > 0) thresholdValue = vals[0];
      }

      // ===============================
      // Layer 1: Base bar (xanh dương)
      // ===============================
      const mainLayer = {
        layer: [
          {
            mark: { type: "bar", width: 5 }, // bar hẹp để tách riêng
            encoding: {
              x: { field: xField, type: "quantitative", title: xField },
              y: {
                field: yField,
                type: "quantitative",
                scale: { zero: false },
                title: yField,
              },
              color: { value: "#1f77b4" },
            },
          },
          ...(thresholdValue
            ? [
                {
                  mark: { type: "bar", width: 5 },
                  transform: [
                    { filter: `datum["${yField}"] > ${thresholdValue}` },
                    { calculate: `${thresholdValue}`, as: "baseline" },
                  ],
                  encoding: {
                    x: { field: xField, type: "quantitative" },
                    y: { field: "baseline", type: "quantitative" },
                    y2: { field: yField },
                    color: { value: "#e45755" },
                  },
                },
              ]
            : []),
        ],
      };

      // ===============================
      // Layer 2: Rule + Label
      // ===============================
      const ruleLayer =
        thresholdValue !== null
          ? {
              data: { values: [{}] },
              encoding: { y: { datum: thresholdValue } },
              layer: [
                {
                  mark: { type: "rule", color: "#444", strokeDash: [5, 5] },
                },
                {
                  mark: {
                    type: "text",
                    align: "right",
                    baseline: "bottom",
                    dx: -2,
                    dy: -2,
                    x: "width",
                    text: `Threshold: ${thresholdValue}`,
                    color: "#444",
                    fontSize: 12,
                  },
                },
              ],
            }
          : null;

      // ===============================
      // Combine
      // ===============================
      vgSpec.layer = ruleLayer ? [mainLayer, ruleLayer] : [mainLayer];
      vgSpec.title = "Threshold Bar Chart";
      delete vgSpec.encoding;
      delete vgSpec.mark;
      delete vgSpec.data;

      // Set width and height
      vgSpec.width = chartWidth || 1000;
      vgSpec.height = chartHeight || 400;

      return vgSpec;
    },
  },
];

let lineCharts = [
  {
    chart: "Line Chart",
    icon: <ChartIcon src={chartIconLine} />,
    template: {
      mark: "line",
      encoding: {},
    },
    channels: ["x", "y", "color", "column", "row"],
    paths: {
      x: ["encoding", "x"],
      y: ["encoding", "y"],
      color: ["encoding", "color"],
      column: ["encoding", "column"],
      row: ["encoding", "row"],
    },
    postProcessor: (
      vgSpec: any,
      _table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      vgSpec.width = chartWidth || 800;
      vgSpec.height = chartHeight || 400;
      return vgSpec;
    },
  },
  {
    chart: "Dotted Line Chart",
    icon: <ChartIcon src={chartIconDottedLine} />,
    template: {
      mark: { type: "line", point: true },
      encoding: {},
    },
    channels: ["x", "y", "color", "column", "row"],
    paths: {
      x: ["encoding", "x"],
      y: ["encoding", "y"],
      color: ["encoding", "color"],
      column: ["encoding", "column"],
      row: ["encoding", "row"],
    },
    postProcessor: (
      vgSpec: any,
      _table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      vgSpec.width = chartWidth || 800;
      vgSpec.height = chartHeight || 400;
      return vgSpec;
    },
  },
  {
    chart: "Rolling Average",
    icon: chartIconLayeringRolling,
    template: {
      layer: [
        {
          mark: { type: "point", opacity: 0.3 },
          encoding: { y: {} },
        },
        {
          mark: { type: "line", color: "red", size: 3 },
          encoding: { y: {} },
        },
      ],
      transform: [
        {
          window: [
            {
              field: "field2", // Placeholder – được thay bằng field thực tế
              op: "mean",
              as: "rolling_mean",
            },
          ],
          frame: [-20, 20], // Rolling 30 điểm (trước 15, sau 15)
        },
      ],
      encoding: { x: {} },
    },

    channels: ["x", "y", "color", "column", "row"],
    paths: {
      x: ["encoding", "x"],
      y: [
        ["layer", 0, "encoding", "y"], // raw
        ["transform", 0, "window", 0, "field"], // rolling mean target field
      ],
      color: ["layer", 0, "encoding", "color"],
      column: ["encoding", "column"],
      row: ["encoding", "row"],
    },

    postProcessor: (
      vgSpec: any,
      table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      try {
        const yFieldDef = vgSpec.layer?.[0]?.encoding?.y;
        const xFieldDef = vgSpec.encoding?.x;

        if (!yFieldDef?.field || !xFieldDef?.field) return vgSpec;

        const fieldNameY = yFieldDef.field;
        const fieldTypeY = yFieldDef.type ?? "quantitative";
        const fieldNameX = xFieldDef.field;

        // ✅ Ép trục X là temporal (ngày / thời gian)
        xFieldDef.type = "temporal";

        // ✅ Thêm scale.zero = false nếu Y là quantitative
        const yScale =
          fieldTypeY === "quantitative" ? { scale: { zero: false } } : {};

        // Raw points
        vgSpec.layer[0].encoding.x = xFieldDef;
        vgSpec.layer[0].encoding.y = {
          field: fieldNameY,
          type: fieldTypeY,
          title: `Raw Values (${fieldNameY})`,
          ...yScale,
        };

        // Rolling average line
        vgSpec.layer[1].encoding.x = xFieldDef;
        vgSpec.layer[1].encoding.y = {
          field: "rolling_mean",
          type: fieldTypeY,
          title: `Rolling Mean of ${fieldNameY}`,
          ...yScale,
        };

        // Dọn encoding gốc
        delete vgSpec.encoding?.x;
        delete vgSpec.encoding?.y;
        delete vgSpec.encoding?.color;

        // Set width and height
        vgSpec.width = chartWidth || 1000;
        vgSpec.height = chartHeight || 400;

        return vgSpec;
      } catch (err) {
        console.warn("Rolling Average postProcessor error:", err);
        return vgSpec;
      }
    },
  },
];

let specialCharts: ChartTemplate[] = [
  {
    chart: "Heat Map",
    icon: chartIconHeatMap,
    template: {
      mark: "rect",
      encoding: {},
    },
    channels: ["x", "y", "color", "column", "row"],
    paths: Object.fromEntries(
      ["x", "y", "color", "column", "row"].map((channel) => [
        channel,
        ["encoding", channel],
      ]),
    ),
    postProcessor: (
      vgSpec: any,
      table: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      if (vgSpec.encoding.y && vgSpec.encoding.y.type != "nominal") {
        vgSpec.encoding.y.type = "nominal";
      }
      if (vgSpec.encoding.x && vgSpec.encoding.x.type != "nominal") {
        vgSpec.encoding.x.type = "nominal";
      }
      vgSpec.width = chartWidth || 800;
      vgSpec.height = chartHeight || 400;
      return vgSpec;
    },
  },
  // Trong ChartTemplates.tsx, thêm vào mảng tableCharts:
  {
    chart: "Pie Chart",
    icon: chartIconPie,
    template: {
      mark: {
        type: "arc",
        tooltip: true,
      },
      encoding: {
        theta: { field: "value", type: "quantitative" },
        color: { field: "category", type: "nominal" },
        text: { field: "value", type: "quantitative", format: ".1%" },
      },
    },
    channels: ["theta", "color", "text", "column", "row"],
    paths: {
      theta: ["encoding", "theta"],
      color: ["encoding", "color"],
      text: ["encoding", "text"],
      column: ["encoding", "column"],
      row: ["encoding", "row"],
    },
    postProcessor: (
      vgSpec: any,
      table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      // Tính tổng giá trị để hiển thị phần trăm
      const total = table ? table.reduce((sum, row) => sum + row.value, 0) : 1;
      vgSpec.encoding.text = {
        field: "value",
        type: "quantitative",
        format: ".1%",
        condition: {
          test: "datum.value / " + total + " > 0.05",
          value: "datum.value / " + total,
        },
      };
      vgSpec.width = chartWidth || 600;
      vgSpec.height = chartHeight || 600;
      return vgSpec;
    },
  },
  {
    chart: "Radial Plot",
    icon: chartIconRadialPlot,
    template: {
      // Khởi tạo đơn giản, postProcessor sẽ chuyển đổi thành Layered Spec
      mark: "arc",
      encoding: {
        theta: { field: "field1", type: "quantitative" }, // Giá trị
        color: { field: "field2", type: "nominal" }, // Danh mục
      },
    },
    channels: ["theta", "color"], // Các kênh hiển thị cho người dùng
    paths: {
      theta: [["encoding", "theta"]], // Ánh xạ giá trị (field1) vào Theta
      color: [["encoding", "color"]], // Ánh xạ danh mục (field2) vào Color
    },
    // Trong ChartTemplates.tsx, bên trong định nghĩa Radial Plot

    postProcessor: (
      vgSpec: any,
      table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      // Đặt lại tên biến cho rõ ràng
      const valueDef = vgSpec.encoding.theta; // field1: Thường là giá trị (PARAMVALUE)
      const categoryDef = vgSpec.encoding.color; // field2: Thường là danh mục (QCSTDPARAMNAME)
      const textDef = vgSpec.encoding.text;
      const orderDef = vgSpec.encoding.order;

      if (!valueDef || !categoryDef) return vgSpec;

      // 1. Cấu hình Theta (Góc): Luôn sử dụng trường Giá trị (field1)
      if (valueDef.aggregate === undefined) {
        valueDef.aggregate = "sum";
      }
      valueDef.stack = true;
      valueDef.scale = { range: [0, 2 * Math.PI] };

      // 2. Cấu hình Radius (Bán kính): Luôn sử dụng trường Danh mục (field2)
      // Đây là mấu chốt để tạo ra hình cột tròn (Radial Bar)
      const radiusEncoding = {
        field: categoryDef.field, // SỬ DỤNG TRƯỜNG DANH MỤC LÀM BÁN KÍNH
        type: categoryDef.type,
        scale: {
          range: [20, 150], // Phạm vi bán kính
        },
        legend: null,
      };

      // 3. Cấu hình Order (Thứ tự): Đảm bảo thứ tự vẽ thanh đúng
      // Nếu người dùng không chỉ định Order, sử dụng Category (field2)
      const finalOrder = orderDef && orderDef.field ? orderDef : categoryDef;
      finalOrder.type = finalOrder.type || "ordinal";

      // 4. Layer 1: Arc/Bar
      const arcLayer: any = {
        mark: { type: "arc", stroke: "#fff", innerRadius: 20 },
        encoding: {
          theta: valueDef,
          radius: radiusEncoding,
          color: categoryDef,
          order: finalOrder,
        },
      };

      // 5. Layer 2: Text/Label
      const layers: any[] = [arcLayer];

      if (textDef && textDef.field) {
        const labelField = textDef.field;
        const labelType = textDef.type;
        const labelAggr = textDef.aggregate || valueDef.aggregate;

        const textLayer: any = {
          mark: { type: "text", radiusOffset: 10, fill: "black" },
          encoding: {
            text: {
              field: labelField,
              type: labelType,
              aggregate: labelAggr,
              format: labelType === "quantitative" ? ",.1f" : undefined,
            },
            radius: radiusEncoding,
            color: categoryDef, // Color cho nhãn
            order: finalOrder,
          },
        };

        layers.push(textLayer);
        delete vgSpec.encoding.text;
      }

      // 6. Dọn dẹp
      if (vgSpec.encoding.order) delete vgSpec.encoding.order;

      vgSpec.layer = layers;
      delete vgSpec.encoding;
      delete vgSpec.mark;

      // Set width and height
      vgSpec.width = chartWidth || 600;
      vgSpec.height = chartHeight || 600;

      return vgSpec;
    },
  },
  {
    chart: "Bubble Plot",
    icon: chartIconBubblePlot,
    template: {
      mark: {
        type: "circle",
        opacity: 0.8,
        stroke: "black",
        strokeWidth: 1,
      },
      encoding: {
        x: {},
        y: {},
        size: {},
        color: {},
      },
    },
    channels: ["x", "y", "size", "color"],
    paths: {
      x: [["encoding", "x"]],
      y: [["encoding", "y"]],
      size: [["encoding", "size"]],
      color: [["encoding", "color"]],
    },
    postProcessor: (
      vgSpec: any,
      table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      // ------------------------------
      // 🧩 1. Chuẩn hóa lại các channel
      // ------------------------------
      const xDef = vgSpec.encoding.x;
      const yDef = vgSpec.encoding.y;
      const sizeDef = vgSpec.encoding.size;
      const colorDef = vgSpec.encoding.color;

      // ------------------------------
      // ⚙️ 2. Tự động xác định type của X/Y
      // ------------------------------
      if (xDef) {
        // Nếu là số → quantitative, nếu là date → temporal
        if (!xDef.type) {
          const sample = table?.[0]?.[xDef.field];
          xDef.type =
            typeof sample === "number"
              ? "quantitative"
              : /^\d{4}-\d{2}-\d{2}/.test(sample)
              ? "temporal"
              : "nominal";
        }
        xDef.axis = { grid: false, labelAngle: -30, labelOverlap: "parity" };
        if (xDef.type === "quantitative") xDef.scale = { zero: false };
      }

      if (yDef) {
        if (!yDef.type) {
          const sample = table?.[0]?.[yDef.field];
          yDef.type =
            typeof sample === "number"
              ? "quantitative"
              : /^\d{4}-\d{2}-\d{2}/.test(sample)
              ? "temporal"
              : "nominal";
        }
        yDef.axis = { title: "" };
        if (yDef.type === "quantitative") yDef.scale = { zero: false };
      }

      // ------------------------------
      // ⚪ 3. Cấu hình size (bong bóng)
      // ------------------------------
      if (sizeDef) {
        sizeDef.type = "quantitative";
        sizeDef.title = sizeDef.field || "Bubble Size";
        sizeDef.legend = { clipHeight: 30 };
        sizeDef.scale = { type: "sqrt", range: [10, 600] };
      }

      // ------------------------------
      // 🌈 4. Cấu hình màu sắc
      // ------------------------------
      const finalColorField = colorDef?.field || yDef?.field;
      if (finalColorField) {
        vgSpec.encoding.color = {
          field: finalColorField,
          type: "nominal",
          legend: { title: finalColorField },
        };
      }

      // ------------------------------
      // 🧹 5. Làm sạch dữ liệu (bỏ field _1)
      // ------------------------------
      if (Array.isArray(vgSpec.data?.values)) {
        vgSpec.data.values = vgSpec.data.values.map((row: any) => {
          const cleanRow: any = {};
          for (const key in row) {
            if (!key.endsWith("_1")) cleanRow[key] = row[key];
          }
          return cleanRow;
        });
      }

      // ------------------------------
      // 🪄 6. Layout hiển thị - Responsive sizing
      // ------------------------------
      vgSpec.autosize = { type: "fit", contains: "padding" };

      // 🔧 IMPORTANT: If postProcessor set width, don't override it
      // Bar charts set width at top level
      const chartTypeLocal = vgSpec.mark?.type || vgSpec.mark;
      const hasPostProcessorWidth = vgSpec.width && vgSpec.width > 800;

      if (!hasPostProcessorWidth) {
        // No postProcessor width - only set for non-bar charts
        if (chartTypeLocal !== "bar" && chartTypeLocal !== "column") {
          let responsiveWidth = chartWidth || 800;
          let responsiveHeight = chartHeight || 400;

          vgSpec.config = {
            view: {
              continuousWidth: responsiveWidth,
              continuousHeight: responsiveHeight,
            },
          };
        } else {
          // Bar chart without postProcessor - set defaults
          const xField = vgSpec.encoding?.x?.field;
          if (xField && table && table.length > 0) {
            const numBars = new Set(table.map((row: any) => row[xField])).size;
            vgSpec.width = chartWidth || Math.max(950, numBars * 180);
            vgSpec.height = chartHeight || 400;
          }
        }
      } else if (chartWidth || chartHeight) {
        // If we have postProcessor width and user provided custom dimensions
        vgSpec.width = chartWidth || vgSpec.width;
        vgSpec.height = chartHeight || vgSpec.height;
      }

      return vgSpec;
    },
  },
  {
    chart: "Area Chart",
    icon: <ChartIcon src={chartIconArea} />,
    template: {
      mark: "area",
      encoding: {},
    },
    channels: ["x", "y", "x2", "y2", "color", "column", "row"],
    paths: Object.fromEntries(
      ["x", "y", "x2", "y2", "color", "column", "row"].map((channel) => [
        channel,
        ["encoding", channel],
      ]),
    ),
    postProcessor: (
      vgSpec: any,
      _table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      vgSpec.width = chartWidth || 800;
      vgSpec.height = chartHeight || 400;
      return vgSpec;
    },
  },
  {
    chart: "Waterfall",
    icon: chartIconProfitandLoss,
    template: {
      layer: [
        // --- Layer 1: Bars ---
        {
          transform: [
            {
              window: [{ op: "sum", field: "fieldY", as: "cumulative" }],
              sort: [{ field: "fieldX", order: "ascending" }],
            },
            { calculate: "datum.cumulative - datum.fieldY", as: "previous" },
            {
              calculate:
                "datum.fieldY > 0 ? 'Increase' : datum.fieldY < 0 ? 'Decrease' : 'Total'",
              as: "changeType",
            },
          ],
          mark: { type: "bar", tooltip: true, cornerRadiusEnd: 3 },
          encoding: {
            x: {
              field: "fieldX",
              type: "nominal",
              axis: { labelAngle: -20 },
            },
            y: {
              field: "previous",
              type: "quantitative",
              scale: { zero: true },
            },
            y2: { field: "cumulative" },
            color: {
              field: "changeType",
              type: "nominal",
              scale: {
                domain: ["Increase", "Decrease", "Total"],
                range: ["#2ca02c", "#d62728", "#1f77b4"],
              },
              legend: { title: "Change Type" },
            },
            tooltip: [
              { field: "fieldX", title: "Category" },
              { field: "fieldY", title: "Change", format: "+,d" },
              { field: "cumulative", title: "Cumulative", format: ",d" },
            ],
          },
        },
        // --- Layer 2: Text labels ---
        {
          transform: [
            {
              window: [{ op: "sum", field: "fieldY", as: "cumulative" }],
              sort: [{ field: "fieldX", order: "ascending" }],
            },
          ],
          mark: { type: "text", dy: -5, fontSize: 12, fontWeight: "bold" },
          encoding: {
            x: { field: "fieldX", type: "nominal" },
            y: { field: "cumulative", type: "quantitative" },
            text: { field: "fieldY", type: "quantitative", format: "+,d" },
            color: { value: "black" },
          },
        },
        // --- Layer 3: Baseline (y=0) ---
        {
          mark: { type: "rule", color: "#666", strokeDash: [3, 3] },
          encoding: { y: { datum: 0 } },
        },
      ],
    },
    channels: ["x", "y"],
    paths: {
      x: [
        ["layer", 0, "transform", 0, "sort", 0, "field"],
        ["layer", 0, "encoding", "x"],
        ["layer", 1, "encoding", "x"],
      ],
      y: [
        ["layer", 0, "transform", 0, "window", 0, "field"],
        ["layer", 0, "encoding", "y2"],
        ["layer", 1, "encoding", "text"],
      ],
    },
    postProcessor: (
      vgSpec: any,
      _table?: any[],
      _qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      // 🔧 Tự động gán fieldX/fieldY theo người dùng
      const xField = vgSpec.layer[0].encoding.x.field;
      const yField = vgSpec.layer[1].encoding.text.field;

      vgSpec.layer.forEach((layer: any) => {
        if (layer.transform) {
          layer.transform.forEach((t: any) => {
            if (t.window) t.window.forEach((w: any) => (w.field = yField));
            if (t.sort) t.sort.forEach((s: any) => (s.field = xField));
            if (t.calculate)
              t.calculate = t.calculate
                .replaceAll("fieldY", yField)
                .replaceAll("fieldX", xField);
          });
        }
        if (layer.encoding) {
          Object.values(layer.encoding).forEach((enc: any) => {
            if (enc.field === "fieldX") enc.field = xField;
            if (enc.field === "fieldY") enc.field = yField;
          });
        }
      });

      // Set width and height
      vgSpec.width = chartWidth || 1000;
      vgSpec.height = chartHeight || 400;

      return vgSpec;
    },
  },
];

let customCharts: ChartTemplate[] = [
  {
    chart: "QC Trend Line",
    icon: chartIconQCTrendChart,
    template: {
      // mark: "line",
      encoding: {
        index: { field: "INDEX", type: "quantitative" },
        value: { field: "VALUE", type: "quantitative" },
        color: { field: "color", type: "nominal" },
        qcdate: { field: "QCDATE", type: "quantitative" },
        QCSHIFT: { field: "QCSHIFT", type: "nominal" },
        // *** ĐÃ XÓA CÁC KÊNH PHỤ TRỢ KHÔNG CẦN THIẾT KHỎI ENCODING GỐC ***
      },
    },
    // *** ĐÃ XÓA CÁC KÊNH PHỤ TRỢ KHỎI CHANNELS VÀ PATHS ***
    channels: ["QCDATE", "QCSHIFT", "INDEX", "VALUE", "color"],
    paths: {
      index: [["encoding", "INDEX"]],
      value: [["encoding", "VALUE"]],
      color: [["encoding", "color"]],
      qcdate: [["encoding", "QCDATE"]],
      QCSHIFT: [["encoding", "QCSHIFT"]],
    },
    postProcessor: (
      vgSpec: any,
      table: any[],
      qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      if (!table || table.length === 0) return vgSpec;
      // =========================================================================
      // 1. LẤY KÊNH CHÍNH
      // =========================================================================
      const indexDef = vgSpec.encoding.index;
      const valueDef = vgSpec.encoding.value;
      const colorDef = vgSpec.encoding.color;
      const qcDateDef = vgSpec.encoding.qcdate;
      const qcShiftDef = vgSpec.encoding.QCSHIFT;

      if (!indexDef || !valueDef) return vgSpec;

      const valueField = valueDef.field;
      const indexField = indexDef.field;
      const colorField = colorDef?.field || valueField;

      // =========================================================================
      // 2. DỮ LIỆU GỐC
      // =========================================================================
      const tableColumns = Object.keys(table[0]);

      // Get original full table if available (contains limit columns)
      const fullTable = vgSpec._originalTable || table;
      const fullTableColumns =
        fullTable && fullTable.length > 0 ? Object.keys(fullTable[0]) : [];

      // If full original table contains SLIPNO, merge it into the working `table` rows
      // Match rows by `INDEX` when available, otherwise fall back to `QCDATE|QCSHIFT` key
      try {
        if (
          fullTable &&
          fullTable.length > 0 &&
          fullTableColumns.includes("SLIPNO")
        ) {
          const fullMap = new Map<string, any>();
          for (const fr of fullTable) {
            let key: string | null = null;
            if (fr[indexField] !== undefined) {
              key = String(fr[indexField]);
            } else if (qcDateDef?.field && fr[qcDateDef.field] !== undefined) {
              const shiftVal = qcShiftDef?.field ? fr[qcShiftDef.field] : "";
              key = `${String(fr[qcDateDef.field])}|${String(shiftVal)}`;
            }
            if (key != null && fr.SLIPNO !== undefined) {
              fullMap.set(key, fr.SLIPNO);
            }
          }

          for (const r of table) {
            let key: string | null = null;
            if (r[indexField] !== undefined) {
              key = String(r[indexField]);
            } else if (qcDateDef?.field && r[qcDateDef.field] !== undefined) {
              const shiftVal = qcShiftDef?.field ? r[qcShiftDef.field] : "";
              key = `${String(r[qcDateDef.field])}|${String(shiftVal)}`;
            }
            if (key != null && fullMap.has(key)) {
              r.SLIPNO = fullMap.get(key);
            }
          }
        }
      } catch (err) {
        console.warn("Failed to merge SLIPNO from original table:", err);
      }

      // Collect per-row limit series instead of single scalar
      let detectedLimitSeries: Record<
        string,
        Array<{ index: number; limit: number; limitType: string }>
      > = {};
      const limitFieldNames = ["TARGET", "ARUL", "ARLL", "UL", "LL"];

      const sourceTable = fullTableColumns.length > 0 ? fullTable : table;
      const columnsToSearch =
        fullTableColumns.length > 0 ? fullTableColumns : tableColumns;
      limitFieldNames.forEach((name) => {
        const col = columnsToSearch.find(
          (c: string) => c.toUpperCase() === name,
        );
        if (!col) return;
        const series = sourceTable
          .map((r: any) => ({ idx: r[indexField], val: r[col] }))
          .filter(
            (d: any) =>
              typeof d.val === "number" &&
              isFinite(d.val) &&
              (typeof d.idx === "number" || !isNaN(Number(d.idx))),
          )
          .map((d: any) => ({
            index: Number(d.idx),
            limit: d.val,
            limitType: name,
          }));
        if (series.length > 0) detectedLimitSeries[name] = series;
      });

      // =========================================================================
      // 5. TÍNH DOMAIN Y
      // =========================================================================
      let finalMin: number | undefined = undefined;
      let finalMax: number | undefined = undefined;
      let foundValue = false; // Cờ để kiểm tra có tìm thấy giá trị nào không

      for (const r of table) {
        const v = r[valueField];
        if (typeof v === "number" && isFinite(v)) {
          finalMin = Math.min(finalMin ?? Infinity, v);
          finalMax = Math.max(finalMax ?? -Infinity, v);
          foundValue = true;
        }
      }

      // Nếu có ít nhất 1 cận thì tính padding domain dựa trên UL/LL hoặc min/max value
      const hasAnyLimit = Object.keys(detectedLimitSeries).length > 0;
      if (hasAnyLimit) {
        const valueMin = finalMin ?? 0;
        const valueMax = finalMax ?? 0;
        const ul = detectedLimitSeries["UL"]?.[0]?.limit;
        const ll = detectedLimitSeries["LL"]?.[0]?.limit;
        const upper = ul ?? valueMax;
        const lower = ll ?? valueMin;
        const padding = (upper - lower) * 0.07;
        finalMin = lower - padding;
        finalMax = upper + padding;
      }

      // =========================================================================
      // 6. LAYER: ĐIỂM + LOESS + GIỚI HẠN (CHỈ DỪNG TẠI detectedLimits)
      // =========================================================================
      const pointLayer = {
        mark: { type: "line", point: true, interpolate: "monotone" },
        encoding: {
          x: { ...indexDef, type: "quantitative", title: indexDef.field },
          y: {
            ...valueDef,
            type: "quantitative",
            scale: { zero: false },
          },
          color: {
            ...colorDef,
            type:
              colorDef.type === "quantitative"
                ? "nominal"
                : colorDef.type || "nominal",
            legend: { title: colorDef.field || "Parameter" },
            scale: {
              range: [
                "#486BB9",
                "#57AD57",
                "#1a23a0ff",
                "#d62728",
                "#9467bd",
                "#8c564b",
              ],
            },
          },
          tooltip: [
            { field: indexDef.field, title: indexDef.field },
            { field: colorDef.field, title: colorDef.field },
            { field: valueDef.field, title: "Value" },
            {
              field: qcDateDef?.field,
              title: qcDateDef?.field,
            },
            {
              field: qcShiftDef?.field,
              title: qcShiftDef?.field,
            },
            { field: "SLIPNO", title: "SLIPNO" },
          ],
        },
      };

      const loessLayer = {
        transform: [
          {
            loess: valueDef.field,
            on: indexDef.field,
            bandwidth: 0.03, // ✅ Giảm bandwidth (mặc định 0.3) → đường sát dữ liệu hơn, capture biến động nhỏ
          },
          // Add a constant field so Vega-Lite can show a legend entry for the LOESS line
          { calculate: "'Trend Line'", as: "series" },
        ],
        mark: {
          type: "line",
          size: 3,
          interpolate: "linear", // ✅ Đường gấp khúc mạnh mẽ, không mượt
          strokeCap: "square", // ✅ Góc cạnh hơn
          opacity: 0.9,
        },
        encoding: {
          x: { field: indexDef.field, type: "quantitative" },
          y: {
            field: valueDef.field,
            type: "quantitative",
            scale: { zero: false },
          },
          color: {
            field: "series",
            type: "nominal",
            legend: { title: "Series" },
            scale: { domain: ["Trend Line"], range: ["blue"] },
          },
        },
      };

      // 🟢 Gom tất cả rule (TARGET, UL, LL, ARUL, ARLL) vào 1 layer có legend
      let ruleLayers: any[] = [];
      const limitColors: Record<string, string> = {
        TARGET: "#00FFFF",
        UL: "#d62728",
        LL: "#d62728",
        ARUL: "#ff7f0e",
        ARLL: "#ff7f0e",
      };

      // For large datasets, downsample limit points to avoid rendering overhead
      // Keep limit lines visible but reduce data points sent to Vega-Lite
      const shouldDownsample = table.length > 10000;

      if (
        qcLimitsMode === true &&
        Object.keys(detectedLimitSeries).length > 0
      ) {
        // Merge tất cả limit series thành 1 data array
        const allLimitData: Array<{
          index: number;
          limit: number;
          limitType: string;
        }> = [];

        Object.entries(detectedLimitSeries).forEach(([name, series]) => {
          if (shouldDownsample && series.length > 500) {
            // For large series, take stratified samples: start, end, and every Nth point
            const step = Math.ceil(series.length / 500); // Max ~500 points per limit type
            allLimitData.push(series[0]); // Always include first point
            for (let i = step; i < series.length - 1; i += step) {
              allLimitData.push(series[i]);
            }
            allLimitData.push(series[series.length - 1]); // Always include last point
          } else {
            // Small series: include all points
            allLimitData.push(...series);
          }
        });

        // Tạo 1 layer duy nhất với tất cả data
        if (allLimitData.length > 0) {
          ruleLayers.push({
            data: { values: allLimitData },
            mark: {
              type: "line",
              strokeWidth: 1.5,
              opacity: 0.9,
            },
            encoding: {
              x: { field: "index", type: "quantitative" },
              y: { field: "limit", type: "quantitative" },
              color: {
                field: "limitType",
                type: "nominal",
                legend: { title: "QC Limited" },
                scale: {
                  domain: Object.keys(detectedLimitSeries),
                  range: Object.keys(detectedLimitSeries).map(
                    (name) => limitColors[name] || "#999",
                  ),
                },
              },
              strokeDash: {
                condition: {
                  test: "datum.limitType === 'TARGET'",
                  value: [4, 2],
                },
                value: [1, 0],
              },
              tooltip: [
                { field: "limitType", title: "Limit" },
                { field: "limit", title: "Value", format: ".3f" },
              ],
            },
          });
        }
      }

      vgSpec.layer = [pointLayer, loessLayer, ...ruleLayers];

      vgSpec.title = "Quality Control Chart";
      vgSpec.resolve = { scale: { color: "independent" } };

      // =========================================================================
      // 🟣 PHÁT HIỆN VÀ VẼ ĐƯỜNG DỌC THEO QCDATE + QCSHIFT
      // =========================================================================

      // Bước 1️⃣: Dò cột trong table
      const hasQCDate = table.some((r) => r["QCDATE"] !== undefined);
      const hasQCShift = table.some((r) => r["QCSHIFT"] !== undefined);
      const hasIndex = table.some((r) => r["INDEX"] !== undefined);
      const shiftRuleLayers: any[] = [];
      if (hasQCDate && hasQCShift && hasIndex) {
        // Bước 2️⃣: Gom nhóm theo (QCDATE, QCSHIFT) để tìm INDEX nhỏ nhất của mỗi nhóm
        const groupMap = new Map<
          string,
          { QCDATE: any; QCSHIFT: any; INDEX: number }
        >();
        table.forEach((row) => {
          const qcdate = row["QCDATE"];
          const qcshift = row["QCSHIFT"];
          const index = row["INDEX"];

          if (!qcdate || !qcshift || typeof index !== "number") return;

          const key = `${qcdate}_${qcshift}`;
          if (!groupMap.has(key) || index < groupMap.get(key)!.INDEX) {
            groupMap.set(key, {
              QCDATE: qcdate,
              QCSHIFT: qcshift,
              INDEX: index,
            });
          }
        });
        const detectedMetadata = Array.from(groupMap.values());
        const shiftMarkers: {
          date: string | number;
          shift: string;
          index: number;
        }[] = [];

        // ✅ Convert thành danh sách marker
        detectedMetadata.forEach((m) => {
          if (m.QCDATE && m.QCSHIFT && m.INDEX !== undefined) {
            shiftMarkers.push({
              date: m.QCDATE,
              shift: m.QCSHIFT,
              index: Number(m.INDEX),
            });
          }
        });

        // ✅ Sort theo INDEX tăng dần để hiển thị đúng thứ tự thời gian
        shiftMarkers.sort((a, b) => a.index - b.index);
        shiftMarkers.forEach((m) => {
          const isNight = m.shift?.toUpperCase() === "NIGHT";
          const color = isNight ? "#000000" : "#9467bd"; // 🔹 NIGHT = đen, DAY = tím
          const shortLabel = isNight ? m.date + "-N" : m.date + "-D"; // 🔹 Text hiển thị

          // 1️⃣ Đường dọc
          shiftRuleLayers.push({
            data: {
              values: [{ index: m.index, date: m.date, shift: m.shift }],
            },
            mark: {
              type: "rule",
              color,
              strokeDash: [6, 3],
              size: 1.5,
              opacity: 0.8,
            },
            encoding: {
              x: { field: "index", type: "quantitative" },
              tooltip: [
                { field: "date", title: "QC Date" },
                { field: "shift", title: "Shift" },
                { field: "index", title: "Position (INDEX)" },
              ],
            },
          });
          shiftRuleLayers.push({
            data: {
              values: [
                {
                  index: m.index,
                  label: shortLabel,
                  date: m.date,
                  shift: m.shift,
                },
              ],
            },
            mark: {
              type: "text",
              angle: -90, // 🔹 Nằm dọc
              dy: isNight ? -8 : 8,
              dx: finalMax
                ? isNight
                  ? -(finalMax * 2.5)
                  : finalMax * 2.5
                : isNight
                ? -8
                : 8, // 🔹 Scale động theo finalMax
              fontSize: 10,
              fontWeight: "bold",
              color,
            },
            encoding: {
              x: { field: "index", type: "quantitative" },
              text: { field: "label" },
            },
          });
        });

        // ✅ Đảm bảo layer tồn tại trước khi push
        if (!vgSpec.layer) vgSpec.layer = [];

        // ✅ Thêm vào biểu đồ
        if (shiftRuleLayers.length > 0) {
          vgSpec.layer.push(...shiftRuleLayers);
        } else {
          console.warn("⚠️ Không tìm thấy nhóm QCDATE + QCSHIFT hợp lệ để vẽ");
        }
      } else {
        console.warn(
          "⚠️ Không có cột QCDATE, QCSHIFT hoặc INDEX trong dữ liệu!",
        );
      }

      // =========================================================================
      // 8. DỌN DẸP + FALLBACK
      // =========================================================================
      delete vgSpec.encoding;
      delete vgSpec.mark;
      delete vgSpec.width;
      delete vgSpec.height;

      // Không cần kiểm tra TARGET, chỉ cần có ít nhất 1 cận thì hiển thị rule
      // Nếu không có cận nào thì chỉ hiển thị pointLayer, loessLayer, shiftRuleLayers
      if (!hasAnyLimit) {
        vgSpec.layer = [pointLayer, loessLayer, ...shiftRuleLayers];
        if (pointLayer.encoding?.y?.scale) delete pointLayer.encoding.y.scale;
      }
      // Set config
      vgSpec.config = {
        view: { stroke: "transparent" },
        axis: { grid: false },
      };

      // Set width and height
      vgSpec.width = chartWidth || 1000;
      vgSpec.height = chartHeight || 400;

      return vgSpec;
    },
  },
  {
    chart: "QC Histogram",
    icon: chartIconHistogramPercent,

    template: {
      mark: "point",
      encoding: {
        value: { field: "VALUE", type: "quantitative" },
        index: { field: "INDEX", type: "quantitative" },
        color: { field: "color", type: "nominal" },
      },
    },

    channels: ["VALUE", "INDEX", "color"],

    paths: {
      value: [["encoding", "VALUE"]],
      index: [["encoding", "INDEX"]],
      color: [["encoding", "color"]],
    },

    postProcessor: (
      vgSpec: any,
      table: any[],
      qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      if (!table || table.length === 0) return vgSpec;
      // =========================================================================
      // 1️⃣ LẤY CÁC CHANNEL CHÍNH
      // =========================================================================
      const valueDef = vgSpec.encoding?.value;
      const indexDef = vgSpec.encoding?.index;
      const colorDef = vgSpec.encoding?.color;

      if (!valueDef || !indexDef) return vgSpec;

      const valueField = valueDef.field;
      const colorField = colorDef?.field || "color";
      // =========================================================================
      // 2. DỮ LIỆU GỐC
      // =========================================================================
      const tableColumns = Object.keys(table[0]);

      // Get original full table if available (contains limit columns)
      const fullTable = vgSpec._originalTable || table;
      const fullTableColumns =
        fullTable && fullTable.length > 0 ? Object.keys(fullTable[0]) : [];
      // =========================================================================
      // 2️⃣ PHÁT HIỆN GIỚI HẠN QC
      // =========================================================================
      // Create local detectedLimits to avoid caching from previous renders
      let detectedLimits: Record<string, number | undefined> = {};
      const limitFieldNames = ["TARGET", "ARUL", "ARLL", "UL", "LL"];

      // Try to find limit columns in full table first, then fallback to working table
      const sourceTable = fullTableColumns.length > 0 ? fullTable : table;
      const columnsToSearch =
        fullTableColumns.length > 0 ? fullTableColumns : tableColumns;

      limitFieldNames.forEach((name) => {
        const col = columnsToSearch.find(
          (c: string) => c.toUpperCase() === name,
        );
        if (col) {
          const val = sourceTable.find(
            (r: any) => typeof r[col] === "number",
          )?.[col];
          if (typeof val === "number" && isFinite(val)) {
            detectedLimits[name] = val;
          }
        }
      });
      // =========================================================================
      // 3️⃣ TÍNH DOMAIN TRỤC X BAO GỒM GIỚI HẠN
      // =========================================================================
      const valueValues = table
        .map((r) => r[valueField])
        .filter((v: any) => typeof v === "number" && isFinite(v))
        .slice(0, 1); // giới hạn 1 điểm để tránh lag

      const vMin = Math.min(...valueValues);
      const vMax = Math.max(...valueValues);
      const limits = Object.values(detectedLimits).filter(
        (v): v is number => typeof v === "number" && isFinite(v),
      );
      const globalMin = Math.min(vMin, ...limits);
      const globalMax = Math.max(vMax, ...limits);
      const padding = (globalMax - globalMin) * 0.07;

      // =========================================================================
      // 4️⃣ LỚP HISTOGRAM STACK THEO PHẦN TRĂM
      // =========================================================================
      const histogramLayer = {
        transform: [
          { bin: { maxbins: 50 }, field: valueField, as: "binned_value" },
          {
            aggregate: [{ op: "count", as: "count" }],
            groupby: ["binned_value", colorField],
          },
          { joinaggregate: [{ op: "sum", field: "count", as: "total" }] },
          { calculate: "datum.count / datum.total", as: "percent" },
        ],

        // nếu qcLimitsMode=true thì điều chỉnh size
        mark: qcLimitsMode ? { type: "bar" } : { type: "bar", size: 16 },

        encoding: {
          x: {
            field: "binned_value",
            type: "quantitative",
            title: "value",
            scale: { zero: false },
          },
          y: {
            field: "percent",
            type: "quantitative",
            axis: { format: "%" },
            title: "Percent (%)",
            stack: "zero",
          },
          color: {
            field: colorField,
            type: "nominal",
            scale: {
              range: ["#2664C1", "#C73800", "#2ca02c", "#9467bd"],
            },
            legend: { title: colorField },
          },
          tooltip: [
            { field: colorField, title: "Parameter" },
            { field: "binned_value", title: "Binned Value" },
            { field: "count", title: "Count" },
            { field: "percent", title: "Percent", format: ".1%" },
          ],
        },
      };

      // ===== smooth envelope line per color, spanning LL → UL and touching baseline (y=0) =====
      const envelopeLayer = {
        transform: [
          // 1️⃣ Bin dữ liệu theo X
          { bin: { maxbins: 50 }, field: valueField, as: "binned_value" },

          // 2️⃣ Gom nhóm theo bin + color
          {
            aggregate: [{ op: "count", as: "count" }],
            groupby: ["binned_value", colorField],
          },

          // 3️⃣ Tính phần trăm theo nhóm màu
          {
            joinaggregate: [{ op: "sum", field: "count", as: "group_total" }],
            groupby: [colorField],
          },
          { calculate: "datum.count / datum.group_total * 2.5", as: "percent" },

          // 4️⃣ Làm mượt (loess) riêng cho từng nhóm
          {
            loess: "percent",
            on: "binned_value",
            groupby: [colorField],
            bandwidth: 0.5,
          },

          // 5️⃣ Chặn chân về baseline y=0 để không xuyên trục
          {
            calculate: "max(datum.percent, 0)", // ép giá trị âm về 0
            as: "percent_clamped",
          },
        ],

        mark: {
          type: "line",
          interpolate: "monotone", // mượt tự nhiên
          size: 1.5,
          opacity: 0.9,
        },

        encoding: {
          x: {
            field: "binned_value",
            type: "quantitative",
            scale: {
              zero: false,
            },
          },
          y: {
            field: "percent_clamped",
            type: "quantitative",
            axis: { format: "%", title: "Percent (%)" },
            scale: { zero: true },
          },
          color: {
            field: colorField,
            type: "nominal",
            legend: null,
            scale: { range: ["#333333"] },
          },
          tooltip: [
            { field: "binned_value", title: "Value" },
            {
              field: "percent_clamped",
              title: "Percent (smoothed)",
              format: ".1%",
            },
          ],
        },
      };

      // =========================================================================
      // 5️⃣ CÁC ĐƯỜNG DỌC QC RULE
      // =========================================================================
      const limitColors: Record<string, string> = {
        UL: "#d62728", // đỏ
        LL: "#d62728",
        ARUL: "#ff7f0e", // cam
        ARLL: "#ff7f0e",
        TARGET: "#00FFFF", // xanh lá
      };

      // Only show rule layers for limits that have a valid number value
      let ruleLayers: any[] = [];
      let labelLayers: any[] = [];

      if (
        qcLimitsMode === true &&
        Object.values(detectedLimits).some(
          (v) => typeof v === "number" && isFinite(v),
        )
      ) {
        ruleLayers = Object.entries(detectedLimits)
          .filter(([_, val]) => typeof val === "number" && isFinite(val))
          .map(([name, val]) => ({
            data: { values: [{ limit: val, label: `${name}: ${val}` }] },
            mark: {
              type: "rule",
              color: limitColors[name] || "#999",
              size: 1,
              strokeDash: name === "TARGET" ? [4, 2] : undefined,
            },
            encoding: {
              x: { field: "limit", type: "quantitative" },
              tooltip: [{ field: "label", title: "QC Limit" }],
            },
          }));

        // =========================================================================
        // 6️⃣ NHÃN TRÊN CÁC ĐƯỜNG DỌC
        // =========================================================================
        labelLayers = Object.entries(detectedLimits)
          .filter(([_, val]) => typeof val === "number" && isFinite(val))
          .map(([name, val]) => ({
            data: { values: [{ limit: val, label: `${name}: ${val}` }] },
            mark: {
              type: "text",
              angle: -90,
              dx: 10,
              dy: -10,
              fontSize: 11,
              fontWeight: "bold",
              color: limitColors[name] || "#444",
            },
            encoding: {
              x: { field: "limit", type: "quantitative" },
              text: { field: "label" },
            },
          }));
      }

      // =========================================================================
      // 7️⃣ GHÉP LỚP VÀ HOÀN THIỆN
      // =========================================================================

      vgSpec.layer = [
        histogramLayer,
        ...ruleLayers,
        ...labelLayers,
        envelopeLayer,
      ];

      vgSpec.title = "Histogram QC (%)";
      // Set config
      vgSpec.config = {
        view: { stroke: "transparent" },
        axis: { grid: false },
      };

      // Set width and height
      vgSpec.width = chartWidth || 1000;
      vgSpec.height = chartHeight || 400;

      delete vgSpec.encoding;
      delete vgSpec.mark;

      return vgSpec;
    },
  },
  {
    chart: "QC Trend Bar",
    icon: chartIconQCTrendStackBar,
    template: {
      mark: "bar",
      encoding: {},
    },
    channels: ["QCDATE", "QCSHIFT", "VALUE"],
    paths: {
      qcdate: ["encoding", "QCDATE"],
      qcshift: ["encoding", "QCSHIFT"],
      value: ["encoding", "VALUE"],
    },
    postProcessor: (
      vgSpec: any,
      table: any[],
      qcLimitsMode?: boolean,
      chartWidth?: number,
      chartHeight?: number,
    ) => {
      try {
        if (!table || table.length === 0) return vgSpec;

        // Get original full table if available (contains limit columns)
        const fullTable = vgSpec._originalTable || table;
        const tableColumns = Object.keys(table[0] || {});
        const fullTableColumns =
          fullTable && fullTable.length > 0
            ? Object.keys(fullTable[0] || {})
            : [];

        let detectedLimits: Record<string, number | undefined> = {};

        // Try to find limit columns in full table first, then fallback to working table
        const sourceTable = fullTableColumns.length > 0 ? fullTable : table;
        const columnsToSearch =
          fullTableColumns.length > 0 ? fullTableColumns : tableColumns;
        // Assume color field represents ValueType
        const qcdateField = vgSpec.encoding?.QCDATE?.field || "QCDATE";
        const qcshiftField = vgSpec.encoding?.QCSHIFT?.field || "QCSHIFT";
        const valueField = vgSpec.encoding?.VALUE?.field || "VALUE";

        // Set transform to aggregate from raw data
        vgSpec.transform = [
          {
            calculate: `datum["${qcdateField}"] + "-" + (datum["${qcshiftField}"] === "DAY" ? "D" : "N")`,
            as: "Group",
          },
          {
            aggregate: [{ op: "count", as: "Count" }],
            groupby: ["Group", valueField],
          },
          {
            joinaggregate: [{ op: "sum", field: "Count", as: "Total_Group" }],
            groupby: ["Group"],
          },
          {
            calculate: "datum.Count / datum.Total_Group",
            as: "Percent_Value",
          },
        ];

        // Rename VALUE field to ValueType
        vgSpec.transform.push({
          calculate: `datum["${valueField}"]`,
          as: "ValueType",
        });

        // Set layer
        vgSpec.layer = [
          {
            name: "BAR_CHART",
            mark: { type: "bar", tooltip: true },
            encoding: {
              x: {
                field: "Group",
                type: "nominal",
                title: "Date-Shift",
                axis: { labelAngle: -90 },
              },
              y: {
                field: "Count",
                type: "quantitative",
                stack: "zero",
                title: "Count",
              },
              color: {
                field: "ValueType",
                type: "nominal",
                title: "Value Type",
                scale: {
                  range: [
                    "#1f77b4",
                    "#ff7f0e",
                    "#2ca02c",
                    "#9467bd",
                    "#8c564b",
                    "#e377c2",
                    "#7f7f7f",
                    "#bcbd22",
                    "#17becf",
                    "#aec7e8",
                    "#ffbb78",
                    "#98df8a",
                    "#d62728",
                    "#ff9896",
                    "#c5b0d5",
                    "#c49c94",
                    "#f7b6d2",
                    "#c7c7c7",
                    "#dbdb8d",
                    "#9edae5",
                  ],
                },
              },
              order: { field: "ValueType", sort: "ascending" },
              tooltip: [
                { field: "Group", title: "Group" },
                { field: "ValueType", title: "Type" },
                { field: "Count", title: "Count", format: "," },
                {
                  field: "Percent_Value",
                  title: "Percentage (%)",
                  format: ".1%",
                },
              ],
            },
          },
          {
            name: "LINE_TOTAL",
            mark: {
              type: "line",
              color: "#e15759",
              point: { size: 80, color: "#e15759" },
              strokeDash: [4, 4],
              strokeWidth: 2,
            },
            encoding: {
              x: { field: "Group", type: "nominal" },
              y: { field: "Total_Group", type: "quantitative" },
              tooltip: [
                { field: "Group", title: "Group" },
                { field: "Total_Group", title: "Total Count", format: "," },
              ],
            },
          },
          {
            name: "LINE_TEXT_TOTAL",
            mark: {
              type: "text",
              dy: -15,
              color: "#e15759",
              fontWeight: "bold",
              fontSize: 12,
            },
            encoding: {
              x: { field: "Group", type: "nominal" },
              y: { field: "Total_Group", type: "quantitative" },
              text: { field: "Total_Group", type: "quantitative" },
            },
          },
        ];

        // Add QC limits if enabled
        if (qcLimitsMode) {
          const limitFieldNames = ["TARGET", "ARUL", "ARLL", "UL", "LL"];
          limitFieldNames.forEach((name) => {
            const col = columnsToSearch.find((c) => c.toUpperCase() === name);
            if (col) {
              const vals = sourceTable
                .map((r: any) => r[col])
                .filter((v: any) => typeof v === "number" && isFinite(v));
              if (vals.length > 0) detectedLimits[name] = vals[0];
            }
          });
          const hasAnyLimit = Object.keys(detectedLimits).length > 0;
          if (hasAnyLimit) {
            const limitColors: Record<string, string> = {
              UL: "#d62728",
              LL: "#d62728",
              ARUL: "#ff7f0e",
              ARLL: "#ff7f0e",
              TARGET: "#00FFFF",
            };

            const ruleLayers = Object.entries(detectedLimits)
              .filter(([_, val]) => typeof val === "number" && isFinite(val))
              .map(([name, val]) => ({
                mark: {
                  type: "rule",
                  color: limitColors[name] || "#999",
                  size: 1,
                  strokeDash: name === "TARGET" ? [4, 2] : undefined,
                },
                encoding: {
                  y: { datum: val, type: "quantitative" },
                  tooltip: [{ value: `${name}: ${val}` }],
                },
              }));

            vgSpec.layer.push(...ruleLayers);
          }
        }

        // Set config
        vgSpec.config = {
          view: { stroke: "transparent" },
          axis: { grid: false },
        };

        // Set width and height
        vgSpec.width = chartWidth || 1000;
        vgSpec.height = chartHeight || 400;

        // Set description
        vgSpec.description = "Stacked Bar Chart with Tooltip showing %";

        // Clean up
        delete vgSpec.encoding;
        delete vgSpec.mark;

        return vgSpec;
      } catch (error) {
        console.error("Error in QC Trend Bar postProcessor:", error);
        return vgSpec;
      }
    },
  },
];
export const CHART_TEMPLATES: { [key: string]: ChartTemplate[] } = {
  table: tablePlots,
  custom: customCharts,
  scatter: scatterPlots,
  bar: barCharts,
  line: lineCharts,
  special: specialCharts,
};
