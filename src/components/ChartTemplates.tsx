// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart Templates with UI icons.
 *
 * This module wraps the reusable agents-chart template definitions
 * with React icon components for display in the Data Formulator UI.
 * The pure template logic (mark, encoding paths, post-processors) lives
 * in src/lib/agents-chart/templates/.
 */

import { ChartTemplate } from "./ComponentType";
import {
    chartTemplateDefs,
    getTemplateChannels,
} from "../lib/agents-chart";
import InsightsIcon from '@mui/icons-material/Insights';
import React from "react";

// Import all chart icons statically so they are included in the build
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
import chartIconArea from '../assets/chart-icon-area.svg';
import chartIconStreamgraph from '../assets/chart-icon-streamgraph.svg';
import chartIconDensity from '../assets/chart-icon-density.svg';
import chartIconLollipop from '../assets/chart-icon-lollipop.svg';
import chartIconPie from '../assets/chart-icon-pie-min.png';
import chartIconUSMap from '../assets/chart-icon-us-map-min.png';
import chartIconPyramid from '../assets/chart-icon-pyramid.svg';
import chartIconWorldMap from '../assets/chart-icon-world-map-min.png';
import chartIconDotPlotVertical from '../assets/chart-icon-dot-plot-vertical-min.png';
import chartIconCandlestick from '../assets/chart-icon-candlestick.svg';
import chartIconWaterfall from '../assets/chart-icon-waterfall.svg';
import chartIconStripPlot from '../assets/chart-icon-strip-plot.svg';
import chartIconRadar from '../assets/chart-icon-radar.svg';
import chartIconBump from '../assets/chart-icon-bump.svg';
import chartIconRose from '../assets/chart-icon-rose.svg';

// Chart Icon Component using static imports
const ChartIcon: React.FC<{ src: string; alt?: string }> = ({ src, alt = "" }) => {
    return <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
};

// ---------------------------------------------------------------------------
// Icon mapping: chart name → React icon element
// ---------------------------------------------------------------------------

const CHART_ICONS: Record<string, any> = {
    "Auto": <InsightsIcon color="primary" />,
    "Scatter Plot": <ChartIcon src={chartIconScatter} />,
    "Linear Regression": <ChartIcon src={chartIconLinearRegression} />,
    "Ranged Dot Plot": <ChartIcon src={chartIconDotPlotHorizontal} />,
    "Boxplot": <ChartIcon src={chartIconBoxPlot} />,
    "Bar Chart": <ChartIcon src={chartIconColumn} />,
    "Pyramid Chart": <ChartIcon src={chartIconPyramid} />,
    "Grouped Bar Chart": <ChartIcon src={chartIconColumnGrouped} />,
    "Stacked Bar Chart": <ChartIcon src={chartIconColumnStacked} />,
    "Histogram": <ChartIcon src={chartIconHistogram} />,
    "Heatmap": <ChartIcon src={chartIconHeatMap} />,
    "US Map": <ChartIcon src={chartIconUSMap} />,
    "World Map": <ChartIcon src={chartIconWorldMap} />,
    "Pie Chart": <ChartIcon src={chartIconPie} />,
    "Rose Chart": <ChartIcon src={chartIconRose} />,
    "Line Chart": <ChartIcon src={chartIconLine} />,
    "Dotted Line Chart": <ChartIcon src={chartIconDottedLine} />,
    "Bump Chart": <ChartIcon src={chartIconBump} />,
    "Area Chart": <ChartIcon src={chartIconArea} />,
    "Streamgraph": <ChartIcon src={chartIconStreamgraph} />,
    "Lollipop Chart": <ChartIcon src={chartIconLollipop} />,
    "Density Plot": <ChartIcon src={chartIconDensity} />,
    "Candlestick Chart": <ChartIcon src={chartIconCandlestick} />,
    "Waterfall Chart": <ChartIcon src={chartIconWaterfall} />,
    "Strip Plot": <ChartIcon src={chartIconStripPlot} />,
    "Radar Chart": <ChartIcon src={chartIconRadar} />,
    "Custom Point": <ChartIcon src={chartIconCustomPoint} />,
    "Custom Line": <ChartIcon src={chartIconCustomLine} />,
    "Custom Bar": <ChartIcon src={chartIconCustomBar} />,
    "Custom Rect": <ChartIcon src={chartIconCustomRect} />,
    "Custom Area": <ChartIcon src={chartIconCustomArea} />,
};

// ---------------------------------------------------------------------------
// Build CHART_TEMPLATES by adding icons to library template defs
// ---------------------------------------------------------------------------

function addIcons(defs: { chart: string }[]): ChartTemplate[] {
    return defs.map(def => ({
        ...def,
        icon: CHART_ICONS[def.chart] || <InsightsIcon />,
    })) as ChartTemplate[];
}

export const CHART_TEMPLATES: { [key: string]: ChartTemplate[] } = Object.fromEntries(
    Object.entries(chartTemplateDefs).map(([category, defs]) => [
        category,
        addIcons(defs),
    ])
);

// ---------------------------------------------------------------------------
// Re-exports for backward compatibility
// ---------------------------------------------------------------------------

// Re-export constants and utilities from the chart engine library
export {
    channels,
    channelGroups,
} from '../lib/agents-chart';

export function getChartTemplate(chartType: string): ChartTemplate | undefined {
    return Object.values(CHART_TEMPLATES).flat().find(t => t.chart === chartType);
}

export const getChartChannels = (chartType: string): string[] => {
    return getTemplateChannels(chartType);
}
