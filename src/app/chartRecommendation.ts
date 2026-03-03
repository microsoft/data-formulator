// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Agent response resolution — maps AI agent chart recommendations to
 * concrete Chart objects.
 *
 * The encoding recommendation engine has moved to the agents-chart library.
 * Use `vlRecommendEncodings` / `ecRecommendEncodings` / etc. directly.
 */

import { Channel, Chart, DictTable, FieldItem } from '../components/ComponentType';
import { generateFreshChart } from './dfSlice';
import { vlGetTemplateDef } from '../lib/agents-chart';

/** Map from agent short names to display chart type names. */
const AGENT_CHART_TYPE_MAP: Record<string, string> = {
    scatter: 'Scatter Plot',
    regression: 'Regression',
    bar: 'Bar Chart',
    grouped_bar: 'Grouped Bar Chart',
    histogram: 'Histogram',
    line: 'Line Chart',
    area: 'Area Chart',
    heatmap: 'Heatmap',
    boxplot: 'Boxplot',
    pie: 'Pie Chart',
    lollipop: 'Lollipop Chart',
    waterfall: 'Waterfall Chart',
    candlestick: 'Candlestick Chart',
    world_map: 'World Map',
    us_map: 'US Map',
    // Legacy aliases (backward compat with older agent responses)
    point: 'Scatter Plot',
    group_bar: 'Grouped Bar Chart',
    worldmap: 'World Map',
    usmap: 'US Map',
};

/**
 * Resolve an AI agent's chart recommendation into a concrete Chart object.
 * The agent returns a `refinedGoal` with `chart.chart_type` which may be
 * a short name (e.g. "scatter"), a full template name (e.g. "Radar Chart"),
 * or a user-chosen chart type passed through from the UI.
 */
export const resolveRecommendedChart = (refinedGoal: any, allFields: FieldItem[], table: DictTable): Chart => {
    const chartObj = refinedGoal['chart'] || {};
    const rawChartType = chartObj['chart_type'];
    const chartEncodings = chartObj['encodings'];

    if (chartEncodings == undefined || rawChartType == undefined) {
        let newChart = generateFreshChart(table.id, 'Scatter Plot') as Chart;
        const basicEncodings: { [key: string]: string } = table.names.length > 1
            ? { x: table.names[0], y: table.names[1] }
            : {};
        newChart = resolveChartFields(newChart, allFields, basicEncodings, table);
        return newChart;
    }

    // Resolve chart type: try short-name map first, then check if it's already a valid template name
    const chartType = AGENT_CHART_TYPE_MAP[rawChartType]
        || (vlGetTemplateDef(rawChartType) ? rawChartType : undefined)
        || 'Scatter Plot';
    let newChart = generateFreshChart(table.id, chartType) as Chart;
    newChart = resolveChartFields(newChart, allFields, chartEncodings, table);

    // Apply chart config properties from agent recommendation
    if (chartObj['config'] && typeof chartObj['config'] === 'object') {
        newChart.config = { ...chartObj['config'] };
    }
    return newChart;
};

/**
 * Populate a chart's encodingMap from a plain { channel: fieldName } object.
 */
export const resolveChartFields = (
    chart: Chart,
    allFields: FieldItem[],
    chartEncodings: { [key: string]: string },
    table: DictTable,
): Chart => {
    // Get the keys that should be present after this update
    const newEncodingKeys = new Set(Object.keys(chartEncodings).map(key => key === 'facet' ? 'column' : key));

    // Remove encodings that are no longer in chartEncodings
    for (const key of Object.keys(chart.encodingMap)) {
        if (!newEncodingKeys.has(key) && chart.encodingMap[key as Channel]?.fieldID != undefined) {
            chart.encodingMap[key as Channel] = {};
        }
    }

    // Add/update encodings from chartEncodings
    for (let [key, value] of Object.entries(chartEncodings)) {
        if (key === 'facet') {
            key = 'column';
        }

        const field = allFields.find(c => c.name === value);
        if (field) {
            chart.encodingMap[key as Channel] = { fieldID: field.id };
        }
    }

    return chart;
};
