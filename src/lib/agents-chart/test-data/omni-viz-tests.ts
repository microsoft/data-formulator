// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart Gallery cases: one synthetic “division × product × quarter × channel” dataset
 * rendered as Grouped Bar, Scatter, Line (unix periodStart), Pyramid, Rose, Sunburst, Waterfall.
 * In Chart Gallery, `Omni:*` keys use TripleChart — same Vega-Lite + ECharts + Chart.js row as Regional Survey.
 */

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import {
    OMNI_VIZ_LEVELS,
    omniVizDetailTable,
    omniVizLineTable,
    omniVizPyramidLongTable,
    omniVizRoseTable,
    omniVizSunburstTable,
    omniVizWaterfallTable,
} from './omni-viz-dataset';

const META_DETAIL: Record<string, { type: Type; semanticType: string; levels: any[] }> = {
    division: { type: Type.String, semanticType: 'Category', levels: [...OMNI_VIZ_LEVELS.divisions] },
    product: { type: Type.String, semanticType: 'Category', levels: [...OMNI_VIZ_LEVELS.products] },
    quarter: { type: Type.String, semanticType: 'Category', levels: [...OMNI_VIZ_LEVELS.quarters] },
    periodStart: { type: Type.Number, semanticType: 'Date', levels: [...OMNI_VIZ_LEVELS.periodStarts] },
    channel: { type: Type.String, semanticType: 'Category', levels: [...OMNI_VIZ_LEVELS.channels] },
    revenue: { type: Type.Number, semanticType: 'Quantity', levels: [] },
    units: { type: Type.Number, semanticType: 'Quantity', levels: [] },
    marginPct: { type: Type.Number, semanticType: 'Percentage', levels: [] },
};

export function genOmniVizGroupedBarTests(): TestCase[] {
    const data = omniVizPyramidLongTable();
    return [{
        title: 'Omni: Grouped bar — product × revenue (by channel)',
        description: 'Totals across quarters: 8 products × 2 channels; x = product, y = revenue, group = channel.',
        tags: ['omni-viz', 'grouped-bar', 'gallery'],
        chartType: 'Grouped Bar Chart',
        data,
        fields: [makeField('product'), makeField('revenue'), makeField('channel')],
        metadata: {
            product: META_DETAIL.product,
            revenue: META_DETAIL.revenue,
            channel: META_DETAIL.channel,
        },
        encodingMap: {
            x: makeEncodingItem('product'),
            y: makeEncodingItem('revenue'),
            group: makeEncodingItem('channel'),
        },
    }];
}

export function genOmniVizScatterTests(): TestCase[] {
    const data = omniVizDetailTable();
    return [{
        title: 'Omni: Scatter — units × margin % (by product)',
        description: 'Detail rows (64): unit volume vs margin %, colored by one of 8 product lines.',
        tags: ['omni-viz', 'scatter', 'gallery'],
        chartType: 'Scatter Plot',
        data,
        fields: [makeField('units'), makeField('marginPct'), makeField('product'), makeField('periodStart')],
        metadata: {
            units: META_DETAIL.units,
            marginPct: META_DETAIL.marginPct,
            product: META_DETAIL.product,
            periodStart: META_DETAIL.periodStart,
        },
        encodingMap: {
            x: makeEncodingItem('units'),
            y: makeEncodingItem('marginPct'),
            color: makeEncodingItem('product'),
        },
    }];
}

export function genOmniVizLineTests(): TestCase[] {
    const data = omniVizLineTable();
    return [{
        title: 'Omni: Line — revenue by quarter start (unix, by product)',
        description: 'x = periodStart (Unix sec, UTC quarter starts); y = revenue; 32 points, 8 series.',
        tags: ['omni-viz', 'line', 'multi-series', 'temporal', 'gallery'],
        chartType: 'Line Chart',
        data,
        fields: [makeField('periodStart'), makeField('revenue'), makeField('product')],
        metadata: {
            periodStart: META_DETAIL.periodStart,
            revenue: META_DETAIL.revenue,
            product: META_DETAIL.product,
        },
        encodingMap: {
            x: makeEncodingItem('periodStart', { dtype: 'temporal' }),
            y: makeEncodingItem('revenue'),
            color: makeEncodingItem('product'),
        },
    }];
}

export function genOmniVizPyramidTests(): TestCase[] {
    const data = omniVizPyramidLongTable();
    return [{
        title: 'Omni: Pyramid — product × revenue (by channel)',
        description: 'Mirror bars: y = product, x = revenue (totals), color = Direct vs Partner.',
        tags: ['omni-viz', 'pyramid', 'gallery'],
        chartType: 'Pyramid Chart',
        data,
        fields: [makeField('product'), makeField('revenue'), makeField('channel')],
        metadata: {
            product: META_DETAIL.product,
            revenue: META_DETAIL.revenue,
            channel: META_DETAIL.channel,
        },
        encodingMap: {
            y: makeEncodingItem('product'),
            x: makeEncodingItem('revenue'),
            color: makeEncodingItem('channel'),
        },
    }];
}

export function genOmniVizRoseTests(): TestCase[] {
    const data = omniVizRoseTable();
    return [{
        title: 'Omni: Rose — total revenue by product',
        description: 'Eight petals with large spread (Lake vs Sensor Hub etc.): totals over quarters + channels.',
        tags: ['omni-viz', 'rose', 'gallery'],
        chartType: 'Rose Chart',
        data,
        fields: [makeField('product'), makeField('revenue')],
        metadata: {
            product: META_DETAIL.product,
            revenue: META_DETAIL.revenue,
        },
        encodingMap: {
            x: makeEncodingItem('product'),
            y: makeEncodingItem('revenue'),
        },
        chartProperties: { alignment: 'center' },
    }];
}

export function genOmniVizSunburstTests(): TestCase[] {
    const data = omniVizSunburstTable();
    return [{
        title: 'Omni: Sunburst — division × product × quarter (revenue)',
        description: 'Three rings: division → product → quarter; size = revenue (channels aggregated).',
        tags: ['omni-viz', 'sunburst', 'echarts', 'gallery'],
        chartType: 'Sunburst Chart',
        data,
        fields: [makeField('division'), makeField('product'), makeField('quarter'), makeField('revenue')],
        metadata: {
            division: META_DETAIL.division,
            product: META_DETAIL.product,
            quarter: META_DETAIL.quarter,
            revenue: META_DETAIL.revenue,
        },
        encodingMap: {
            color: makeEncodingItem('division'),
            detail: makeEncodingItem('product'),
            group: makeEncodingItem('quarter'),
            size: makeEncodingItem('revenue'),
        },
    }];
}

const WF_STEPS = ['Opening ARR', 'Cloud', 'Data', 'Edge', 'Closing ARR'] as const;

export function genOmniVizWaterfallTests(): TestCase[] {
    const data = omniVizWaterfallTable();
    return [{
        title: 'Omni: Waterfall — ARR bridge by division',
        description: 'Opening → stacked Cloud/Data/Edge revenue → Closing; amounts from the same Omni panel totals.',
        tags: ['omni-viz', 'waterfall', 'gallery'],
        chartType: 'Waterfall Chart',
        data,
        fields: [makeField('Step'), makeField('Amount'), makeField('Type')],
        metadata: {
            Step: { type: Type.String, semanticType: 'Category', levels: [...WF_STEPS] },
            Amount: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            Type: { type: Type.String, semanticType: 'Category', levels: ['start', 'delta', 'end'] },
        },
        encodingMap: {
            x: makeEncodingItem('Step'),
            y: makeEncodingItem('Amount'),
            color: makeEncodingItem('Type'),
        },
    }];
}

/** Keys registered in `TEST_GENERATORS` for the Omni Viz gallery strip. */
export const GALLERY_OMNI_VIZ_GENERATOR_KEYS = [
    'Omni: Grouped Bar',
    'Omni: Scatter',
    'Omni: Line',
    'Omni: Pyramid',
    'Omni: Rose',
    'Omni: Sunburst',
    'Omni: Waterfall',
] as const;
