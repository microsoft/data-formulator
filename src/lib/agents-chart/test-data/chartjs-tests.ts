// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart.js backend comparison tests.
 *
 * Runs the same test inputs through ALL THREE backends:
 *   assembleChart (Vega-Lite), ecAssembleChart (ECharts), cjsAssembleChart (Chart.js)
 *
 * Covers: Scatter Plot, Line Chart, Bar Chart, Stacked Bar Chart,
 *         Grouped Bar Chart, Area Chart, Pie Chart, Histogram, Radar Chart
 */

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genCategories } from './generators';

// ---------------------------------------------------------------------------
// Test data generators
// ---------------------------------------------------------------------------

function genScatterData(n: number, seed: number) {
    const rand = seededRandom(seed);
    return Array.from({ length: n }, () => ({
        Weight: Math.round((40 + rand() * 60) * 10) / 10,
        Height: Math.round((150 + rand() * 50) * 10) / 10,
    }));
}

function genScatterColorData(n: number, seed: number) {
    const rand = seededRandom(seed);
    const categories = ['Alpha', 'Beta', 'Gamma'];
    return Array.from({ length: n }, (_, i) => ({
        X: Math.round(rand() * 100 * 10) / 10,
        Y: Math.round(rand() * 100 * 10) / 10,
        Group: categories[i % categories.length],
    }));
}

function genBarData(seed: number) {
    const rand = seededRandom(seed);
    const products = ['Apples', 'Bananas', 'Cherries', 'Dates', 'Elderberries'];
    return products.map(p => ({
        Product: p,
        Sales: Math.round(100 + rand() * 900),
    }));
}

function genLineData(seed: number) {
    const rand = seededRandom(seed);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    return months.map(m => ({
        Month: m,
        Revenue: Math.round(1000 + rand() * 5000),
    }));
}

function genMultiSeriesLineData(seed: number) {
    const rand = seededRandom(seed);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
    const series = ['ProductA', 'ProductB', 'ProductC'];
    const data: any[] = [];
    for (const m of months) {
        for (const s of series) {
            data.push({
                Month: m,
                Sales: Math.round(500 + rand() * 2000),
                Product: s,
            });
        }
    }
    return data;
}

function genStackedBarData(seed: number) {
    const rand = seededRandom(seed);
    const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
    const regions = ['North', 'South', 'East', 'West'];
    const data: any[] = [];
    for (const q of quarters) {
        for (const r of regions) {
            data.push({
                Quarter: q,
                Revenue: Math.round(200 + rand() * 800),
                Region: r,
            });
        }
    }
    return data;
}

function genGroupedBarData(seed: number) {
    const rand = seededRandom(seed);
    const years = ['2022', '2023', '2024'];
    const departments = ['Sales', 'Engineering', 'Marketing'];
    const data: any[] = [];
    for (const y of years) {
        for (const d of departments) {
            data.push({
                Year: y,
                Budget: Math.round(10000 + rand() * 50000),
                Department: d,
            });
        }
    }
    return data;
}

function genAreaData(seed: number) {
    const rand = seededRandom(seed);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
    const series = ['Web', 'Mobile', 'Desktop'];
    const data: any[] = [];
    for (const m of months) {
        for (const s of series) {
            data.push({
                Month: m,
                Users: Math.round(500 + rand() * 3000),
                Platform: s,
            });
        }
    }
    return data;
}

function genPieData(seed: number) {
    const rand = seededRandom(seed);
    const segments = ['Mobile', 'Desktop', 'Tablet', 'Other'];
    return segments.map(s => ({
        Device: s,
        Visits: Math.round(100 + rand() * 1000),
    }));
}

function genHistogramData(n: number, seed: number) {
    const rand = seededRandom(seed);
    return Array.from({ length: n }, () => ({
        Score: Math.round(rand() * 100),
    }));
}

function genRadarData(seed: number) {
    const rand = seededRandom(seed);
    const metrics = ['Speed', 'Power', 'Defense', 'Stamina', 'Accuracy', 'Agility'];
    const entities = ['Player A', 'Player B', 'Player C'];
    const data: any[] = [];
    for (const e of entities) {
        for (const m of metrics) {
            data.push({
                Metric: m,
                Score: Math.round(30 + rand() * 70),
                Player: e,
            });
        }
    }
    return data;
}

// ---------------------------------------------------------------------------
// Test case builders
// ---------------------------------------------------------------------------

export function genChartJsScatterTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Basic scatter
    {
        const data = genScatterData(50, 42);
        tests.push({
            title: 'CJS: Scatter — Basic Q×Q',
            description: '50 points, two quantitative axes.',
            tags: ['chartjs', 'scatter', 'quantitative'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('Weight'), makeField('Height')],
            metadata: {
                Weight: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Height: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Weight'), y: makeEncodingItem('Height') },
        });
    }

    // 2. Scatter with color grouping
    {
        const data = genScatterColorData(90, 77);
        tests.push({
            title: 'CJS: Scatter — Color Groups',
            description: '90 points, 3 groups. CJS: 3 datasets with different colors.',
            tags: ['chartjs', 'scatter', 'color', 'multi-series'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('Group')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Group: { type: Type.String, semanticType: 'Category', levels: ['Alpha', 'Beta', 'Gamma'] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), color: makeEncodingItem('Group') },
        });
    }

    // 3. Dense scatter
    {
        const data = genScatterData(500, 99);
        tests.push({
            title: 'CJS: Scatter — Dense (500 pts)',
            description: 'Dense scatter plot. CJS adjusts pointRadius automatically.',
            tags: ['chartjs', 'scatter', 'dense'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('Weight'), makeField('Height')],
            metadata: {
                Weight: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Height: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Weight'), y: makeEncodingItem('Height') },
        });
    }

    return tests;
}

export function genChartJsLineTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Single series line
    {
        const data = genLineData(200);
        tests.push({
            title: 'CJS: Line — Single Series',
            description: 'Ordinal x-axis, single line.',
            tags: ['chartjs', 'line', 'single-series'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Month'), makeField('Revenue')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: ['Jan','Feb','Mar','Apr','May','Jun'] },
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Revenue') },
        });
    }

    // 2. Multi-series line
    {
        const data = genMultiSeriesLineData(300);
        tests.push({
            title: 'CJS: Line — Multi-Series (3 products)',
            description: 'Color channel → multiple datasets.',
            tags: ['chartjs', 'line', 'multi-series', 'color'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Month'), makeField('Sales'), makeField('Product')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug'] },
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Product: { type: Type.String, semanticType: 'Category', levels: ['ProductA','ProductB','ProductC'] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Sales'), color: makeEncodingItem('Product') },
        });
    }

    return tests;
}

export function genChartJsBarTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Simple bar
    {
        const data = genBarData(100);
        tests.push({
            title: 'CJS: Bar — Basic',
            description: '5 products, single dataset.',
            tags: ['chartjs', 'bar', 'simple'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Product'), makeField('Sales')],
            metadata: {
                Product: { type: Type.String, semanticType: 'Category', levels: ['Apples','Bananas','Cherries','Dates','Elderberries'] },
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Product'), y: makeEncodingItem('Sales') },
        });
    }

    // 2. Many categories
    {
        const rand = seededRandom(150);
        const cities = genCategories('City', 20);
        const data = cities.map(c => ({
            City: c,
            Population: Math.round(10000 + rand() * 900000),
        }));
        tests.push({
            title: 'CJS: Bar — 20 categories',
            description: 'Many categories — tests layout and label rotation.',
            tags: ['chartjs', 'bar', 'many-categories'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('City'), makeField('Population')],
            metadata: {
                City: { type: Type.String, semanticType: 'Category', levels: cities },
                Population: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('City'), y: makeEncodingItem('Population') },
        });
    }

    return tests;
}

export function genChartJsStackedBarTests(): TestCase[] {
    const tests: TestCase[] = [];

    {
        const data = genStackedBarData(500);
        tests.push({
            title: 'CJS: Stacked Bar — Regions × Quarters',
            description: 'Stacked bar chart with 4 quarters and 4 regions.',
            tags: ['chartjs', 'stacked-bar', 'color'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Quarter'), makeField('Revenue'), makeField('Region')],
            metadata: {
                Quarter: { type: Type.String, semanticType: 'Category', levels: ['Q1','Q2','Q3','Q4'] },
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Region: { type: Type.String, semanticType: 'Category', levels: ['North','South','East','West'] },
            },
            encodingMap: { x: makeEncodingItem('Quarter'), y: makeEncodingItem('Revenue'), color: makeEncodingItem('Region') },
        });
    }

    return tests;
}

export function genChartJsGroupedBarTests(): TestCase[] {
    const tests: TestCase[] = [];

    {
        const data = genGroupedBarData(600);
        tests.push({
            title: 'CJS: Grouped Bar — 3 Years × 3 Departments',
            description: 'Grouped (side-by-side) bar chart.',
            tags: ['chartjs', 'grouped-bar', 'color'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Year'), makeField('Budget'), makeField('Department')],
            metadata: {
                Year: { type: Type.String, semanticType: 'Category', levels: ['2022','2023','2024'] },
                Budget: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Department: { type: Type.String, semanticType: 'Category', levels: ['Sales','Engineering','Marketing'] },
            },
            encodingMap: { x: makeEncodingItem('Year'), y: makeEncodingItem('Budget'), group: makeEncodingItem('Department') },
        });
    }

    return tests;
}

export function genChartJsAreaTests(): TestCase[] {
    const tests: TestCase[] = [];

    {
        const data = genAreaData(700);
        tests.push({
            title: 'CJS: Area — Stacked (3 Platforms)',
            description: 'Stacked area chart with fill.',
            tags: ['chartjs', 'area', 'stacked', 'color'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('Month'), makeField('Users'), makeField('Platform')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug'] },
                Users: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Platform: { type: Type.String, semanticType: 'Category', levels: ['Web','Mobile','Desktop'] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Users'), color: makeEncodingItem('Platform') },
        });
    }

    // Single series area
    {
        const data = genLineData(701);
        tests.push({
            title: 'CJS: Area — Single Series',
            description: 'Single series area chart.',
            tags: ['chartjs', 'area', 'single-series'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('Month'), makeField('Revenue')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: ['Jan','Feb','Mar','Apr','May','Jun'] },
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Revenue') },
        });
    }

    return tests;
}

export function genChartJsPieTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Basic pie
    {
        const data = genPieData(800);
        tests.push({
            title: 'CJS: Pie — Device Breakdown',
            description: 'Pie chart: color=Device, size=Visits.',
            tags: ['chartjs', 'pie'],
            chartType: 'Pie Chart',
            data,
            fields: [makeField('Device'), makeField('Visits')],
            metadata: {
                Device: { type: Type.String, semanticType: 'Category', levels: ['Mobile','Desktop','Tablet','Other'] },
                Visits: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Device'), size: makeEncodingItem('Visits') },
        });
    }

    // 2. Doughnut
    {
        const data = genPieData(801);
        tests.push({
            title: 'CJS: Doughnut — Device Breakdown',
            description: 'Doughnut chart with innerRadius.',
            tags: ['chartjs', 'doughnut', 'pie'],
            chartType: 'Pie Chart',
            data,
            fields: [makeField('Device'), makeField('Visits')],
            metadata: {
                Device: { type: Type.String, semanticType: 'Category', levels: ['Mobile','Desktop','Tablet','Other'] },
                Visits: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Device'), size: makeEncodingItem('Visits') },
            chartProperties: { innerRadius: 40 },
        });
    }

    return tests;
}

export function genChartJsHistogramTests(): TestCase[] {
    const tests: TestCase[] = [];

    {
        const data = genHistogramData(200, 900);
        tests.push({
            title: 'CJS: Histogram — Scores (200 pts)',
            description: 'Histogram with 10 bins.',
            tags: ['chartjs', 'histogram'],
            chartType: 'Histogram',
            data,
            fields: [makeField('Score')],
            metadata: {
                Score: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Score') },
        });
    }

    return tests;
}

export function genChartJsRadarTests(): TestCase[] {
    const tests: TestCase[] = [];

    {
        const data = genRadarData(1000);
        tests.push({
            title: 'CJS: Radar — 3 Players × 6 Metrics',
            description: 'Radar chart with multiple groups.',
            tags: ['chartjs', 'radar', 'multi-group'],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('Metric'), makeField('Score'), makeField('Player')],
            metadata: {
                Metric: { type: Type.String, semanticType: 'Category', levels: ['Speed','Power','Defense','Stamina','Accuracy','Agility'] },
                Score: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Player: { type: Type.String, semanticType: 'Category', levels: ['Player A','Player B','Player C'] },
            },
            encodingMap: { x: makeEncodingItem('Metric'), y: makeEncodingItem('Score'), color: makeEncodingItem('Player') },
        });
    }

    return tests;
}

export function genChartJsStressTests(): TestCase[] {
    const tests: TestCase[] = [];

    // Large scatter
    {
        const data = genScatterData(1000, 1100);
        tests.push({
            title: 'CJS: Stress — 1000pt Scatter',
            description: '1000-point scatter plot performance test.',
            tags: ['chartjs', 'stress', 'scatter'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('Weight'), makeField('Height')],
            metadata: {
                Weight: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Height: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Weight'), y: makeEncodingItem('Height') },
        });
    }

    // Many categories bar
    {
        const rand = seededRandom(1200);
        const items = genCategories('Item', 50);
        const data = items.map(i => ({
            Item: i,
            Value: Math.round(rand() * 1000),
        }));
        tests.push({
            title: 'CJS: Stress — 50 Cat Bar',
            description: '50-category bar chart — tests overflow and label rotation.',
            tags: ['chartjs', 'stress', 'bar', 'overflow'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Item'), makeField('Value')],
            metadata: {
                Item: { type: Type.String, semanticType: 'Category', levels: items },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Item'), y: makeEncodingItem('Value') },
        });
    }

    return tests;
}
