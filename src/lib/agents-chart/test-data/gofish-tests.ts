// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * GoFish backend comparison tests.
 *
 * Runs the same test inputs through ALL FOUR backends:
 *   assembleVegaLite, assembleECharts, assembleChartjs, assembleGoFish
 *
 * Covers: Scatter Plot, Line Chart, Bar Chart, Stacked Bar Chart,
 *         Grouped Bar Chart, Area Chart, Pie Chart
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
                Budget: Math.round(500 + rand() * 2000),
                Department: d,
            });
        }
    }
    return data;
}

function genAreaData(seed: number) {
    const rand = seededRandom(seed);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    return months.map(m => ({
        Month: m,
        Value: Math.round(100 + rand() * 500),
    }));
}

function genStackedAreaData(seed: number) {
    const rand = seededRandom(seed);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
    const categories = ['Desktop', 'Mobile', 'Tablet'];
    const data: any[] = [];
    for (const m of months) {
        for (const c of categories) {
            data.push({
                Month: m,
                Users: Math.round(200 + rand() * 800),
                Platform: c,
            });
        }
    }
    return data;
}

function genPieData(seed: number) {
    const rand = seededRandom(seed);
    const categories = ['Electronics', 'Clothing', 'Food', 'Books', 'Toys'];
    return categories.map(c => ({
        Category: c,
        Revenue: Math.round(100 + rand() * 900),
    }));
}

function genScatterPieData(seed: number) {
    const rand = seededRandom(seed);
    const locations = [
        { City: 'NYC',     Lon: -74.0, Lat: 40.7  },
        { City: 'LA',      Lon: -118.2, Lat: 34.1 },
        { City: 'Chicago', Lon: -87.6, Lat: 41.9  },
        { City: 'Houston', Lon: -95.4, Lat: 29.8  },
        { City: 'Phoenix', Lon: -112.1, Lat: 33.4 },
    ];
    const species = ['Dogs', 'Cats', 'Birds'];
    const data: any[] = [];
    for (const loc of locations) {
        for (const sp of species) {
            data.push({
                Longitude: loc.Lon,
                Latitude: loc.Lat,
                Species: sp,
                Count: Math.round(50 + rand() * 500),
            });
        }
    }
    return data;
}

// ---------------------------------------------------------------------------
// Test case builders
// ---------------------------------------------------------------------------

export function genGoFishScatterTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Basic scatter
    {
        const data = genScatterData(50, 42);
        tests.push({
            title: 'GF: Scatter — Basic Q×Q',
            description: '50 points, two quantitative axes.',
            tags: ['gofish', 'scatter', 'quantitative'],
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
        const data = genScatterColorData(60, 77);
        tests.push({
            title: 'GF: Scatter — Color Groups',
            description: '60 points, 3 groups with color encoding.',
            tags: ['gofish', 'scatter', 'color', 'multi-series'],
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

    return tests;
}

export function genGoFishLineTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Single series line
    {
        const data = genLineData(200);
        tests.push({
            title: 'GF: Line — Single Series',
            description: 'Ordinal x-axis, single line.',
            tags: ['gofish', 'line', 'single-series'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Month'), makeField('Revenue')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'] },
                Revenue: { type: Type.Number, semanticType: 'Amount', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Revenue') },
        });
    }

    // 2. Multi-series line
    {
        const data = genMultiSeriesLineData(300);
        tests.push({
            title: 'GF: Line — Multi-Series (3 products)',
            description: 'Color channel → multiple lines via layer + select.',
            tags: ['gofish', 'line', 'multi-series', 'color'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Month'), makeField('Sales'), makeField('Product')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'] },
                Sales: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Product: { type: Type.String, semanticType: 'Category', levels: ['ProductA', 'ProductB', 'ProductC'] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Sales'), color: makeEncodingItem('Product') },
        });
    }

    return tests;
}

export function genGoFishBarTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Simple bar
    {
        const data = genBarData(100);
        tests.push({
            title: 'GF: Bar — Basic',
            description: '5 products, single color.',
            tags: ['gofish', 'bar', 'simple'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Product'), makeField('Sales')],
            metadata: {
                Product: { type: Type.String, semanticType: 'Category', levels: ['Apples', 'Bananas', 'Cherries', 'Dates', 'Elderberries'] },
                Sales: { type: Type.Number, semanticType: 'Amount', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Product'), y: makeEncodingItem('Sales') },
        });
    }

    // 2. Many categories
    {
        const rand = seededRandom(150);
        const cities = genCategories('City', 12);
        const data = cities.map(c => ({
            City: c,
            Population: Math.round(10000 + rand() * 900000),
        }));
        tests.push({
            title: 'GF: Bar — 12 categories',
            description: 'Many categories — tests GoFish layout.',
            tags: ['gofish', 'bar', 'many-categories'],
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

export function genGoFishStackedBarTests(): TestCase[] {
    const tests: TestCase[] = [];

    {
        const data = genStackedBarData(500);
        tests.push({
            title: 'GF: Stacked Bar — Regions × Quarters',
            description: 'Stacked bar chart with 4 quarters and 4 regions.',
            tags: ['gofish', 'stacked-bar', 'color'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Quarter'), makeField('Revenue'), makeField('Region')],
            metadata: {
                Quarter: { type: Type.String, semanticType: 'Category', levels: ['Q1', 'Q2', 'Q3', 'Q4'] },
                Revenue: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Region: { type: Type.String, semanticType: 'Category', levels: ['North', 'South', 'East', 'West'] },
            },
            encodingMap: { x: makeEncodingItem('Quarter'), y: makeEncodingItem('Revenue'), color: makeEncodingItem('Region') },
        });
    }

    return tests;
}

export function genGoFishGroupedBarTests(): TestCase[] {
    const tests: TestCase[] = [];

    {
        const data = genGroupedBarData(600);
        tests.push({
            title: 'GF: Grouped Bar — 3 Years × 3 Departments',
            description: 'Grouped (side-by-side) bar chart.',
            tags: ['gofish', 'grouped-bar', 'group'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Year'), makeField('Budget'), makeField('Department')],
            metadata: {
                Year: { type: Type.String, semanticType: 'Year', levels: ['2022', '2023', '2024'] },
                Budget: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Department: { type: Type.String, semanticType: 'Category', levels: ['Sales', 'Engineering', 'Marketing'] },
            },
            encodingMap: { x: makeEncodingItem('Year'), y: makeEncodingItem('Budget'), group: makeEncodingItem('Department') },
        });
    }

    return tests;
}

export function genGoFishAreaTests(): TestCase[] {
    const tests: TestCase[] = [];

    {
        const data = genAreaData(700);
        tests.push({
            title: 'GF: Area — Monthly Values',
            description: 'Single area chart over months.',
            tags: ['gofish', 'area', 'single-series'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('Month'), makeField('Value')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Value') },
        });
    }

    return tests;
}

export function genGoFishStackedAreaTests(): TestCase[] {
    const tests: TestCase[] = [];

    {
        const data = genStackedAreaData(750);
        tests.push({
            title: 'GF: Stacked Area — Platforms × Months',
            description: 'Stacked area chart with 3 platforms over 8 months (TODO: multi-series).',
            tags: ['gofish', 'stacked-area', 'color', 'multi-series'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('Month'), makeField('Users'), makeField('Platform')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'] },
                Users: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Platform: { type: Type.String, semanticType: 'Category', levels: ['Desktop', 'Mobile', 'Tablet'] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Users'), color: makeEncodingItem('Platform') },
        });
    }

    return tests;
}

export function genGoFishPieTests(): TestCase[] {
    const tests: TestCase[] = [];

    {
        const data = genPieData(800);
        tests.push({
            title: 'GF: Pie — Revenue by Category',
            description: 'Pie chart with 5 categories.',
            tags: ['gofish', 'pie', 'part-to-whole'],
            chartType: 'Pie Chart',
            data,
            fields: [makeField('Category'), makeField('Revenue')],
            metadata: {
                Category: { type: Type.String, semanticType: 'Category', levels: ['Electronics', 'Clothing', 'Food', 'Books', 'Toys'] },
                Revenue: { type: Type.Number, semanticType: 'Amount', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Category'), size: makeEncodingItem('Revenue') },
        });
    }

    return tests;
}

export function genGoFishScatterPieTests(): TestCase[] {
    const tests: TestCase[] = [];

    {
        const data = genScatterPieData(850);
        tests.push({
            title: 'GF: Scatter Pie — Species by City',
            description: '5 cities × 3 species, pie at each (x, y) location.',
            tags: ['gofish', 'scatterpie', 'color', 'angle'],
            chartType: 'Scatter Pie Chart',
            data,
            fields: [makeField('Longitude'), makeField('Latitude'), makeField('Species'), makeField('Count')],
            metadata: {
                Longitude: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Latitude: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Species: { type: Type.String, semanticType: 'Category', levels: ['Dogs', 'Cats', 'Birds'] },
                Count: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                x: makeEncodingItem('Longitude'),
                y: makeEncodingItem('Latitude'),
                color: makeEncodingItem('Species'),
                angle: makeEncodingItem('Count'),
            },
        });
    }

    return tests;
}

export function genGoFishStressTests(): TestCase[] {
    const tests: TestCase[] = [];

    // Dense scatter
    {
        const data = genScatterData(200, 999);
        tests.push({
            title: 'GF: Stress — Dense Scatter (200 pts)',
            description: 'Dense scatter plot to test GoFish rendering.',
            tags: ['gofish', 'scatter', 'dense', 'stress'],
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

    // Large bar chart
    {
        const rand = seededRandom(1000);
        const items = genCategories('Item', 25);
        const data = items.map(item => ({
            Item: item,
            Sales: Math.round(50 + rand() * 500),
        }));
        tests.push({
            title: 'GF: Stress — 25-category Bar',
            description: 'Tests GoFish auto-spacing with many categories.',
            tags: ['gofish', 'bar', 'many-categories', 'stress'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Item'), makeField('Sales')],
            metadata: {
                Item: { type: Type.String, semanticType: 'Category', levels: items },
                Sales: { type: Type.Number, semanticType: 'Amount', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Item'), y: makeEncodingItem('Sales') },
        });
    }

    return tests;
}
