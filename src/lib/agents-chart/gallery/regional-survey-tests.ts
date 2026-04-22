// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Gallery test cases: regional survey dataset × each Chart.js–aligned chart family.
 * Rendered with Vega-Lite + ECharts + Chart.js (TripleChart).
 */

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from '../test-data/types';
import {
    REGIONAL_SURVEY_ROWS,
    regionalSurveyTable,
    REGIONAL_SURVEY_AXIS_LEVELS,
} from './regional-survey-data';

const META_BASE: Record<string, { type: Type; semanticType: string; levels: any[] }> = {
    seasonLabel: {
        type: Type.String,
        semanticType: 'Date',
        levels: [...REGIONAL_SURVEY_AXIS_LEVELS.seasonLabels],
    },
    region: {
        type: Type.String,
        semanticType: 'Category',
        levels: [...REGIONAL_SURVEY_AXIS_LEVELS.regions],
    },
    city: {
        type: Type.String,
        semanticType: 'Category',
        levels: [...REGIONAL_SURVEY_AXIS_LEVELS.cities],
    },
    percentage: { type: Type.Number, semanticType: 'Percentage', levels: [] },
    count: { type: Type.Number, semanticType: 'Quantity', levels: [] },
    attitude: {
        type: Type.String,
        semanticType: 'Category',
        levels: [...REGIONAL_SURVEY_AXIS_LEVELS.attitudes],
    },
    rank: { type: Type.Number, semanticType: 'Quantity', levels: [] },
};

function radarByRegionWave(): Record<string, unknown>[] {
    return REGIONAL_SURVEY_ROWS.map(r => ({
        Wave: r.seasonLabel,
        Score: r.percentage,
        Region: r.region,
    }));
}

function pieByRegionTotals(): Record<string, unknown>[] {
    const sums = new Map<string, number>();
    for (const r of REGIONAL_SURVEY_ROWS) {
        sums.set(r.region, (sums.get(r.region) ?? 0) + r.count);
    }
    return REGIONAL_SURVEY_AXIS_LEVELS.regions.map(region => ({
        Region: region,
        Total: sums.get(region) ?? 0,
    }));
}

function roseByRegionAvgPct(): Record<string, unknown>[] {
    const acc = new Map<string, { sum: number; n: number }>();
    for (const r of REGIONAL_SURVEY_ROWS) {
        const cur = acc.get(r.region) ?? { sum: 0, n: 0 };
        cur.sum += r.percentage;
        cur.n += 1;
        acc.set(r.region, cur);
    }
    return REGIONAL_SURVEY_AXIS_LEVELS.regions.map(region => {
        const cur = acc.get(region)!;
        return { Direction: region, AvgPct: Math.round((cur.sum / cur.n) * 10) / 10 };
    });
}

export function genGalleryRegionalSurveyScatterTests(): TestCase[] {
    const data = regionalSurveyTable();
    return [{
        title: 'Gallery: Scatter — count × % (by region)',
        description: 'Regional survey: sample size vs approval %, colored by compass region.',
        tags: ['gallery', 'survey', 'scatter'],
        chartType: 'Scatter Plot',
        data,
        fields: [makeField('count'), makeField('percentage'), makeField('region')],
        metadata: {
            count: META_BASE.count,
            percentage: META_BASE.percentage,
            region: META_BASE.region,
        },
        encodingMap: {
            x: makeEncodingItem('count'),
            y: makeEncodingItem('percentage'),
            color: makeEncodingItem('region'),
        },
    }];
}

export function genGalleryRegionalSurveyLineTests(): TestCase[] {
    const data = regionalSurveyTable();
    return [{
        title: 'Gallery: Line — % over survey waves (by region)',
        description: 'Multi-series line: x = wave date, y = %, color = region.',
        tags: ['gallery', 'survey', 'line', 'multi-series'],
        chartType: 'Line Chart',
        data,
        fields: [makeField('seasonLabel'), makeField('percentage'), makeField('region')],
        metadata: {
            seasonLabel: META_BASE.seasonLabel,
            percentage: META_BASE.percentage,
            region: META_BASE.region,
        },
        encodingMap: {
            x: makeEncodingItem('seasonLabel'),
            y: makeEncodingItem('percentage'),
            color: makeEncodingItem('region'),
        },
    }];
}

export function genGalleryRegionalSurveyBarTests(): TestCase[] {
    const data = regionalSurveyTable();
    return [{
        title: 'Gallery: Bar — city × count',
        description: 'One bar per city in the panel.',
        tags: ['gallery', 'survey', 'bar'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('city'), makeField('count')],
        metadata: { city: META_BASE.city, count: META_BASE.count },
        encodingMap: { x: makeEncodingItem('city'), y: makeEncodingItem('count') },
    }];
}

export function genGalleryRegionalSurveyStackedBarTests(): TestCase[] {
    const data = regionalSurveyTable();
    return [{
        title: 'Gallery: Stacked bar — wave × count (by region)',
        description: 'Stacked counts per survey wave, colored by region.',
        tags: ['gallery', 'survey', 'stacked-bar'],
        chartType: 'Stacked Bar Chart',
        data,
        fields: [makeField('seasonLabel'), makeField('count'), makeField('region')],
        metadata: {
            seasonLabel: META_BASE.seasonLabel,
            count: META_BASE.count,
            region: META_BASE.region,
        },
        encodingMap: {
            x: makeEncodingItem('seasonLabel'),
            y: makeEncodingItem('count'),
            color: makeEncodingItem('region'),
        },
    }];
}

export function genGalleryRegionalSurveyGroupedBarTests(): TestCase[] {
    const data = regionalSurveyTable();
    return [{
        title: 'Gallery: Grouped bar — region × % (by wave)',
        description: 'Side-by-side bars: region on x, % on y, grouped by wave.',
        tags: ['gallery', 'survey', 'grouped-bar'],
        chartType: 'Grouped Bar Chart',
        data,
        fields: [makeField('region'), makeField('percentage'), makeField('seasonLabel')],
        metadata: {
            region: META_BASE.region,
            percentage: META_BASE.percentage,
            seasonLabel: META_BASE.seasonLabel,
        },
        encodingMap: {
            x: makeEncodingItem('region'),
            y: makeEncodingItem('percentage'),
            group: makeEncodingItem('seasonLabel'),
        },
    }];
}

export function genGalleryRegionalSurveyAreaTests(): TestCase[] {
    const data = regionalSurveyTable();
    return [{
        title: 'Gallery: Area — count over waves (by region)',
        description: 'Stacked area: survey wave vs count, colored by region.',
        tags: ['gallery', 'survey', 'area', 'stacked'],
        chartType: 'Area Chart',
        data,
        fields: [makeField('seasonLabel'), makeField('count'), makeField('region')],
        metadata: {
            seasonLabel: META_BASE.seasonLabel,
            count: META_BASE.count,
            region: META_BASE.region,
        },
        encodingMap: {
            x: makeEncodingItem('seasonLabel'),
            y: makeEncodingItem('count'),
            color: makeEncodingItem('region'),
        },
    }];
}

export function genGalleryRegionalSurveyPieTests(): TestCase[] {
    const data = pieByRegionTotals();
    return [{
        title: 'Gallery: Pie — total count by region',
        description: 'Aggregated respondent counts summed across all waves.',
        tags: ['gallery', 'survey', 'pie'],
        chartType: 'Pie Chart',
        data,
        fields: [makeField('Region'), makeField('Total')],
        metadata: {
            Region: META_BASE.region,
            Total: { type: Type.Number, semanticType: 'Quantity', levels: [] },
        },
        encodingMap: { color: makeEncodingItem('Region'), size: makeEncodingItem('Total') },
    }];
}

export function genGalleryRegionalSurveyHistogramTests(): TestCase[] {
    const data = regionalSurveyTable();
    return [{
        title: 'Gallery: Histogram — distribution of %',
        description: 'Approval percentage across all city-wave rows.',
        tags: ['gallery', 'survey', 'histogram'],
        chartType: 'Histogram',
        data,
        fields: [makeField('percentage')],
        metadata: { percentage: META_BASE.percentage },
        encodingMap: { x: makeEncodingItem('percentage') },
    }];
}

export function genGalleryRegionalSurveyRadarTests(): TestCase[] {
    const data = radarByRegionWave();
    const waves = REGIONAL_SURVEY_AXIS_LEVELS.seasonLabels;
    return [{
        title: 'Gallery: Radar — regions × waves (% )',
        description: 'Each region is a series; each spoke is a survey wave.',
        tags: ['gallery', 'survey', 'radar'],
        chartType: 'Radar Chart',
        data,
        fields: [makeField('Wave'), makeField('Score'), makeField('Region')],
        metadata: {
            Wave: { type: Type.String, semanticType: 'Date', levels: [...waves] },
            Score: { type: Type.Number, semanticType: 'Percentage', levels: [] },
            Region: META_BASE.region,
        },
        encodingMap: {
            x: makeEncodingItem('Wave'),
            y: makeEncodingItem('Score'),
            color: makeEncodingItem('Region'),
        },
    }];
}

export function genGalleryRegionalSurveyRoseTests(): TestCase[] {
    const data = roseByRegionAvgPct();
    return [{
        title: 'Gallery: Rose — mean % by region',
        description: 'Polar bars: N/E/S/W with average approval % across waves.',
        tags: ['gallery', 'survey', 'rose'],
        chartType: 'Rose Chart',
        data,
        fields: [makeField('Direction'), makeField('AvgPct')],
        metadata: {
            Direction: { type: Type.String, semanticType: 'Category', levels: [...REGIONAL_SURVEY_AXIS_LEVELS.regions] },
            AvgPct: { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        encodingMap: { x: makeEncodingItem('Direction'), y: makeEncodingItem('AvgPct') },
        chartProperties: { alignment: 'center' },
    }];
}
