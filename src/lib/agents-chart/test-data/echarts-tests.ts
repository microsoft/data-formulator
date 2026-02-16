// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts backend comparison tests.
 *
 * Runs the same test inputs through BOTH assembleChart (Vega-Lite) and
 * ecAssembleChart (ECharts) to verify:
 *   1. Both produce valid output from the same inputs
 *   2. The structural differences are as expected (encoding-based vs series-based)
 *   3. Core analysis phases (semantics, layout, overflow) produce identical results
 *
 * Covers: Scatter Plot, Line Chart, Bar Chart, Stacked Bar Chart, Grouped Bar Chart
 */

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genCategories, genDates } from './generators';

// ---------------------------------------------------------------------------
// Test data generators — shared across VL and EC
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

// ---------------------------------------------------------------------------
// Test case builders
// ---------------------------------------------------------------------------

export function genEChartsScatterTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Basic scatter — quant × quant
    {
        const data = genScatterData(50, 42);
        tests.push({
            title: 'EC: Scatter — Basic Q×Q',
            description: '50 points, two quantitative axes. Compare VL encoding-based vs EC series-based.',
            tags: ['echarts', 'scatter', 'quantitative'],
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
            title: 'EC: Scatter — Color Groups',
            description: '90 points, 3 groups. VL: one encoding.color; EC: 3 separate series.',
            tags: ['echarts', 'scatter', 'color', 'multi-series'],
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

    // 3. Dense scatter — tests point sizing
    {
        const data = genScatterData(500, 99);
        tests.push({
            title: 'EC: Scatter — Dense (500 pts)',
            description: 'Dense scatter plot. VL uses applyPointSizeScaling; EC controls itemStyle.',
            tags: ['echarts', 'scatter', 'dense'],
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

export function genEChartsLineTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Single series line
    {
        const data = genLineData(200);
        tests.push({
            title: 'EC: Line — Single Series',
            description: 'Ordinal x-axis, single line. VL: mark=line; EC: series type=line.',
            tags: ['echarts', 'line', 'single-series'],
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

    // 2. Multi-series line (the key difference test)
    {
        const data = genMultiSeriesLineData(300);
        tests.push({
            title: 'EC: Line — Multi-Series (3 products)',
            description: 'Color channel → multiple lines. VL: single spec with color encoding; EC: 3 explicit series with category-aligned data.',
            tags: ['echarts', 'line', 'multi-series', 'color'],
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

    // 3. Multi-series with many categories
    {
        const rand = seededRandom(400);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const series = genCategories('Region', 8);
        const data: any[] = [];
        for (const m of months) {
            for (const s of series) {
                data.push({ Month: m, Value: Math.round(rand() * 1000), Region: s });
            }
        }
        tests.push({
            title: 'EC: Line — 8 Series × 12 Months',
            description: 'High series count. VL: one color encoding; EC: 8 separate series objects.',
            tags: ['echarts', 'line', 'multi-series', 'medium'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Month'), makeField('Value'), makeField('Region')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: months },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Region: { type: Type.String, semanticType: 'Category', levels: series },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Value'), color: makeEncodingItem('Region') },
        });
    }

    return tests;
}

export function genEChartsBarTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Simple bar
    {
        const data = genBarData(500);
        tests.push({
            title: 'EC: Bar — Simple (5 bars)',
            description: 'Nominal x, quantitative y. VL: mark=bar + encoding; EC: series type=bar + xAxis.data.',
            tags: ['echarts', 'bar', 'simple'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Product'), makeField('Sales')],
            metadata: {
                Product: { type: Type.String, semanticType: 'Product', levels: ['Apples','Bananas','Cherries','Dates','Elderberries'] },
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Product'), y: makeEncodingItem('Sales') },
        });
    }

    // 2. Many bars (tests overflow and label rotation)
    {
        const rand = seededRandom(501);
        const cats = genCategories('Item', 25);
        const data = cats.map(c => ({ Item: c, Count: Math.round(10 + rand() * 90) }));
        tests.push({
            title: 'EC: Bar — Many Categories (25)',
            description: 'Tests label handling. VL: labelAngle in axis config; EC: axisLabel.rotate.',
            tags: ['echarts', 'bar', 'medium', 'overflow'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Item'), makeField('Count')],
            metadata: {
                Item: { type: Type.String, semanticType: 'Category', levels: cats },
                Count: { type: Type.Number, semanticType: 'Count', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Item'), y: makeEncodingItem('Count') },
        });
    }

    return tests;
}

export function genEChartsStackedBarTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Basic stacked bar
    {
        const data = genStackedBarData(600);
        tests.push({
            title: 'EC: Stacked Bar — 4Q × 4 Regions',
            description: 'VL: color channel auto-stacks; EC: series[].stack="total" explicit.',
            tags: ['echarts', 'stacked-bar', 'color'],
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

    // 2. Stacked bar with many stacks
    {
        const rand = seededRandom(601);
        const cats = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        const types = genCategories('TaskType', 6);
        const data: any[] = [];
        for (const c of cats) {
            for (const t of types) {
                data.push({ Day: c, Hours: Math.round(1 + rand() * 8), TaskType: t });
            }
        }
        tests.push({
            title: 'EC: Stacked Bar — 5 Days × 6 Types',
            description: 'More stack segments. Tests legend sizing in both backends.',
            tags: ['echarts', 'stacked-bar', 'medium'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Day'), makeField('Hours'), makeField('TaskType')],
            metadata: {
                Day: { type: Type.String, semanticType: 'Category', levels: cats },
                Hours: { type: Type.Number, semanticType: 'Duration', levels: [] },
                TaskType: { type: Type.String, semanticType: 'Category', levels: types },
            },
            encodingMap: { x: makeEncodingItem('Day'), y: makeEncodingItem('Hours'), color: makeEncodingItem('TaskType') },
        });
    }

    return tests;
}

export function genEChartsGroupedBarTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Basic grouped bar
    {
        const data = genGroupedBarData(700);
        tests.push({
            title: 'EC: Grouped Bar — 3 Years × 3 Depts',
            description: 'VL: group channel → xOffset; EC: multiple series side-by-side (barGap).',
            tags: ['echarts', 'grouped-bar', 'group'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Year'), makeField('Budget'), makeField('Department')],
            metadata: {
                Year: { type: Type.String, semanticType: 'Year', levels: ['2022','2023','2024'] },
                Budget: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Department: { type: Type.String, semanticType: 'Category', levels: ['Sales','Engineering','Marketing'] },
            },
            encodingMap: {
                x: makeEncodingItem('Year'),
                y: makeEncodingItem('Budget'),
                group: makeEncodingItem('Department'),
            },
        });
    }

    // 2. Grouped bar with more groups
    {
        const rand = seededRandom(701);
        const categories = ['A', 'B', 'C', 'D'];
        const groups = genCategories('Method', 5);
        const data: any[] = [];
        for (const c of categories) {
            for (const g of groups) {
                data.push({ Category: c, Score: Math.round(rand() * 100), Method: g });
            }
        }
        tests.push({
            title: 'EC: Grouped Bar — 4 Categories × 5 Methods',
            description: 'More groups per category. Tests bar width calculation in both backends.',
            tags: ['echarts', 'grouped-bar', 'medium'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Category'), makeField('Score'), makeField('Method')],
            metadata: {
                Category: { type: Type.String, semanticType: 'Category', levels: categories },
                Score: { type: Type.Number, semanticType: 'Score', levels: [] },
                Method: { type: Type.String, semanticType: 'Category', levels: groups },
            },
            encodingMap: {
                x: makeEncodingItem('Category'),
                y: makeEncodingItem('Score'),
                group: makeEncodingItem('Method'),
            },
        });
    }

    return tests;
}

// ---------------------------------------------------------------------------
// Stress / overflow test cases
// ---------------------------------------------------------------------------

export function genEChartsStressTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Grouped bar — many categories (20 products × 3 groups)
    {
        const rand = seededRandom(900);
        const products = genCategories('Product', 20);
        const channels = ['Online', 'Retail', 'Wholesale'];
        const data: any[] = [];
        for (const p of products) {
            for (const c of channels) {
                data.push({ Product: p, Sales: Math.round(100 + rand() * 9000), Channel: c });
            }
        }
        tests.push({
            title: 'EC Stress: Grouped Bar — 20 Categories × 3 Groups',
            description: 'Many x-axis categories with grouping. Tests horizontal overflow and label crowding.',
            tags: ['echarts', 'grouped-bar', 'stress', 'overflow'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Product'), makeField('Sales'), makeField('Channel')],
            metadata: {
                Product: { type: Type.String, semanticType: 'Category', levels: products },
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Channel: { type: Type.String, semanticType: 'Category', levels: channels },
            },
            encodingMap: {
                x: makeEncodingItem('Product'),
                y: makeEncodingItem('Sales'),
                group: makeEncodingItem('Channel'),
            },
        });
    }

    // 2. Grouped bar — many groups (4 quarters × 10 regions)
    {
        const rand = seededRandom(901);
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        const regions = genCategories('Region', 10);
        const data: any[] = [];
        for (const q of quarters) {
            for (const r of regions) {
                data.push({ Quarter: q, Revenue: Math.round(500 + rand() * 5000), Region: r });
            }
        }
        tests.push({
            title: 'EC Stress: Grouped Bar — 4 Quarters × 10 Groups',
            description: 'Few categories but many groups per category. Tests bar width when bands are subdivided heavily.',
            tags: ['echarts', 'grouped-bar', 'stress', 'many-groups'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Quarter'), makeField('Revenue'), makeField('Region')],
            metadata: {
                Quarter: { type: Type.String, semanticType: 'Category', levels: quarters },
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Region: { type: Type.String, semanticType: 'Category', levels: regions },
            },
            encodingMap: {
                x: makeEncodingItem('Quarter'),
                y: makeEncodingItem('Revenue'),
                group: makeEncodingItem('Region'),
            },
        });
    }

    // 3. Grouped bar — many categories AND many groups (12 months × 6 types)
    {
        const rand = seededRandom(902);
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const types = genCategories('Type', 6);
        const data: any[] = [];
        for (const m of months) {
            for (const t of types) {
                data.push({ Month: m, Count: Math.round(10 + rand() * 200), Type: t });
            }
        }
        tests.push({
            title: 'EC Stress: Grouped Bar — 12 Months × 6 Types',
            description: 'Both many categories and many groups. Extreme horizontal stretch scenario.',
            tags: ['echarts', 'grouped-bar', 'stress', 'extreme'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Month'), makeField('Count'), makeField('Type')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: months },
                Count: { type: Type.Number, semanticType: 'Count', levels: [] },
                Type: { type: Type.String, semanticType: 'Category', levels: types },
            },
            encodingMap: {
                x: makeEncodingItem('Month'),
                y: makeEncodingItem('Count'),
                group: makeEncodingItem('Type'),
            },
        });
    }

    // 4. Line chart — many x-values (60 days) causing horizontal stretch
    {
        const rand = seededRandom(903);
        const days: string[] = [];
        for (let i = 1; i <= 60; i++) {
            const month = Math.ceil(i / 30).toString().padStart(2, '0');
            const dayOfMonth = ((i - 1) % 30 + 1).toString().padStart(2, '0');
            days.push(`2024-${month}-${dayOfMonth}`);
        }
        const data = days.map(d => ({ Date: d, Value: Math.round(rand() * 500) }));
        tests.push({
            title: 'EC Stress: Line — 60 Daily Points',
            description: 'Many x-axis values on a single line. Tests horizontal stretch and label rotation/density.',
            tags: ['echarts', 'line', 'stress', 'stretch'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Date'), makeField('Value')],
            metadata: {
                Date: { type: Type.String, semanticType: 'Category', levels: days },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Value') },
        });
    }

    // 5. Multi-series line — many x-values with multiple series (30 weeks × 5 products)
    {
        const rand = seededRandom(904);
        const weeks: string[] = [];
        for (let i = 1; i <= 30; i++) weeks.push(`W${i}`);
        const products = genCategories('Prod', 5);
        const data: any[] = [];
        for (const w of weeks) {
            for (const p of products) {
                data.push({ Week: w, Sales: Math.round(50 + rand() * 500), Product: p });
            }
        }
        tests.push({
            title: 'EC Stress: Line — 30 Weeks × 5 Products',
            description: 'Multi-series line with many x-values. Tests legend + horizontal stretch together.',
            tags: ['echarts', 'line', 'stress', 'multi-series', 'stretch'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Week'), makeField('Sales'), makeField('Product')],
            metadata: {
                Week: { type: Type.String, semanticType: 'Category', levels: weeks },
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Product: { type: Type.String, semanticType: 'Category', levels: products },
            },
            encodingMap: { x: makeEncodingItem('Week'), y: makeEncodingItem('Sales'), color: makeEncodingItem('Product') },
        });
    }

    // 6. Stacked bar — many categories (15 cities × 4 segments)
    {
        const rand = seededRandom(905);
        const cities = genCategories('City', 15);
        const segments = ['Residential', 'Commercial', 'Industrial', 'Government'];
        const data: any[] = [];
        for (const c of cities) {
            for (const s of segments) {
                data.push({ City: c, Spending: Math.round(1000 + rand() * 20000), Segment: s });
            }
        }
        tests.push({
            title: 'EC Stress: Stacked Bar — 15 Cities × 4 Segments',
            description: 'Many categories with stacking. Tests whether stacked bars maintain adequate width with many x-values.',
            tags: ['echarts', 'stacked-bar', 'stress', 'overflow'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('City'), makeField('Spending'), makeField('Segment')],
            metadata: {
                City: { type: Type.String, semanticType: 'Category', levels: cities },
                Spending: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Segment: { type: Type.String, semanticType: 'Category', levels: segments },
            },
            encodingMap: { x: makeEncodingItem('City'), y: makeEncodingItem('Spending'), color: makeEncodingItem('Segment') },
        });
    }

    return tests;
}

// ===========================================================================
// Area Chart tests
// ===========================================================================

export function genEChartsAreaTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Single-series area
    {
        const rand = seededRandom(1000);
        const months = ['Jan','Feb','Mar','Apr','May','Jun'];
        const data = months.map(m => ({ Month: m, Revenue: Math.round(100 + rand() * 900) }));
        tests.push({
            title: 'EC: Area — Single Series',
            description: 'Single area chart. VL: mark=area; EC: line series + areaStyle.',
            tags: ['echarts', 'area', 'single-series'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('Month'), makeField('Revenue')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: months },
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Revenue') },
        });
    }

    // 2. Stacked multi-series area
    {
        const rand = seededRandom(1001);
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug'];
        const products = ['Desktop', 'Mobile', 'Tablet'];
        const data: any[] = [];
        for (const m of months) {
            for (const p of products) {
                data.push({ Month: m, Sales: Math.round(50 + rand() * 500), Product: p });
            }
        }
        tests.push({
            title: 'EC: Area — Stacked 3 Products',
            description: 'Stacked area. VL: y.stack; EC: series[].stack + areaStyle.',
            tags: ['echarts', 'area', 'stacked', 'multi-series'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('Month'), makeField('Sales'), makeField('Product')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: months },
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Product: { type: Type.String, semanticType: 'Category', levels: products },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Sales'), color: makeEncodingItem('Product') },
        });
    }

    return tests;
}

// ===========================================================================
// Pie Chart tests
// ===========================================================================

export function genEChartsPieTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Basic pie
    {
        const data = [
            { Category: 'Electronics', Revenue: 4500 },
            { Category: 'Clothing', Revenue: 3200 },
            { Category: 'Food', Revenue: 2800 },
            { Category: 'Books', Revenue: 1500 },
            { Category: 'Sports', Revenue: 900 },
        ];
        tests.push({
            title: 'EC: Pie — 5 Slices',
            description: 'Basic pie chart. VL: mark=arc + theta; EC: series type=pie.',
            tags: ['echarts', 'pie', 'basic'],
            chartType: 'Pie Chart',
            data,
            fields: [makeField('Category'), makeField('Revenue')],
            metadata: {
                Category: { type: Type.String, semanticType: 'Category', levels: ['Electronics','Clothing','Food','Books','Sports'] },
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Category'), size: makeEncodingItem('Revenue') },
        });
    }

    // 2. Pie with many slices
    {
        const rand = seededRandom(1010);
        const categories = genCategories('Item', 10);
        const data = categories.map(c => ({ Item: c, Count: Math.round(10 + rand() * 90) }));
        tests.push({
            title: 'EC: Pie — 10 Slices',
            description: 'Many-slice pie. Tests label overlap and legend sizing.',
            tags: ['echarts', 'pie', 'medium'],
            chartType: 'Pie Chart',
            data,
            fields: [makeField('Item'), makeField('Count')],
            metadata: {
                Item: { type: Type.String, semanticType: 'Category', levels: categories },
                Count: { type: Type.Number, semanticType: 'Count', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Item'), size: makeEncodingItem('Count') },
        });
    }

    return tests;
}

// ===========================================================================
// Heatmap tests
// ===========================================================================

export function genEChartsHeatmapTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Basic heatmap
    {
        const rand = seededRandom(1020);
        const days = ['Mon','Tue','Wed','Thu','Fri'];
        const hours = ['9am','10am','11am','12pm','1pm','2pm','3pm','4pm','5pm'];
        const data: any[] = [];
        for (const d of days) {
            for (const h of hours) {
                data.push({ Day: d, Hour: h, Activity: Math.round(rand() * 100) });
            }
        }
        tests.push({
            title: 'EC: Heatmap — 5 Days × 9 Hours',
            description: 'Categorical x+y with quantitative color. VL: mark=rect + color scale; EC: heatmap + visualMap.',
            tags: ['echarts', 'heatmap', 'basic'],
            chartType: 'Heatmap',
            data,
            fields: [makeField('Day'), makeField('Hour'), makeField('Activity')],
            metadata: {
                Day: { type: Type.String, semanticType: 'Category', levels: days },
                Hour: { type: Type.String, semanticType: 'Category', levels: hours },
                Activity: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Day'), y: makeEncodingItem('Hour'), color: makeEncodingItem('Activity') },
        });
    }

    // 2. Larger heatmap
    {
        const rand = seededRandom(1021);
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const regions = genCategories('Region', 8);
        const data: any[] = [];
        for (const m of months) {
            for (const r of regions) {
                data.push({ Month: m, Region: r, Sales: Math.round(rand() * 10000) });
            }
        }
        tests.push({
            title: 'EC: Heatmap — 12 Months × 8 Regions',
            description: 'Larger heatmap. Tests color gradient and label density.',
            tags: ['echarts', 'heatmap', 'medium'],
            chartType: 'Heatmap',
            data,
            fields: [makeField('Month'), makeField('Region'), makeField('Sales')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: months },
                Region: { type: Type.String, semanticType: 'Category', levels: regions },
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Region'), color: makeEncodingItem('Sales') },
        });
    }

    return tests;
}

// ===========================================================================
// Histogram tests
// ===========================================================================

export function genEChartsHistogramTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Simple histogram
    {
        const rand = seededRandom(1030);
        const data = Array.from({ length: 200 }, () => ({
            Score: Math.round(rand() * 100),
        }));
        tests.push({
            title: 'EC: Histogram — 200 Values',
            description: 'Single-variable histogram. VL: encoding.x.bin=true; EC: client-side binning.',
            tags: ['echarts', 'histogram', 'basic'],
            chartType: 'Histogram',
            data,
            fields: [makeField('Score')],
            metadata: {
                Score: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Score') },
        });
    }

    // 2. Histogram with color grouping
    {
        const rand = seededRandom(1031);
        const groups = ['Male', 'Female'];
        const data: any[] = [];
        for (const g of groups) {
            const offset = g === 'Male' ? 10 : -5;
            for (let i = 0; i < 150; i++) {
                data.push({
                    Height: Math.round(155 + offset + rand() * 40),
                    Gender: g,
                });
            }
        }
        tests.push({
            title: 'EC: Histogram — Stacked by Gender',
            description: 'Stacked histogram with color grouping.',
            tags: ['echarts', 'histogram', 'stacked', 'color'],
            chartType: 'Histogram',
            data,
            fields: [makeField('Height'), makeField('Gender')],
            metadata: {
                Height: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Gender: { type: Type.String, semanticType: 'Category', levels: groups },
            },
            encodingMap: { x: makeEncodingItem('Height'), color: makeEncodingItem('Gender') },
        });
    }

    return tests;
}

// ===========================================================================
// Boxplot tests
// ===========================================================================

export function genEChartsBoxplotTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Basic boxplot — 4 categories
    {
        const rand = seededRandom(1040);
        const categories = ['Spring', 'Summer', 'Autumn', 'Winter'];
        const data: any[] = [];
        for (const c of categories) {
            const base = c === 'Summer' ? 28 : c === 'Winter' ? 5 : 15;
            for (let i = 0; i < 40; i++) {
                data.push({
                    Season: c,
                    Temperature: Math.round((base + (rand() - 0.5) * 20) * 10) / 10,
                });
            }
        }
        tests.push({
            title: 'EC: Boxplot — 4 Seasons',
            description: 'Box-and-whisker per season. VL: mark=boxplot auto-quartiles; EC: client-side quartile computation.',
            tags: ['echarts', 'boxplot', 'basic'],
            chartType: 'Boxplot',
            data,
            fields: [makeField('Season'), makeField('Temperature')],
            metadata: {
                Season: { type: Type.String, semanticType: 'Category', levels: categories },
                Temperature: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Season'), y: makeEncodingItem('Temperature') },
        });
    }

    // 2. Boxplot with many categories
    {
        const rand = seededRandom(1041);
        const cities = genCategories('City', 8);
        const data: any[] = [];
        for (const c of cities) {
            for (let i = 0; i < 30; i++) {
                data.push({
                    City: c,
                    Salary: Math.round(30000 + rand() * 70000),
                });
            }
        }
        tests.push({
            title: 'EC: Boxplot — 8 Cities',
            description: 'More categories with salary distributions. Tests box width scaling.',
            tags: ['echarts', 'boxplot', 'medium'],
            chartType: 'Boxplot',
            data,
            fields: [makeField('City'), makeField('Salary')],
            metadata: {
                City: { type: Type.String, semanticType: 'Category', levels: cities },
                Salary: { type: Type.Number, semanticType: 'Amount', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('City'), y: makeEncodingItem('Salary') },
        });
    }

    return tests;
}

// ===========================================================================
// Radar Chart tests
// ===========================================================================

export function genEChartsRadarTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Single-group radar
    {
        const data = [
            { Metric: 'Speed', Value: 80 },
            { Metric: 'Strength', Value: 70 },
            { Metric: 'Defense', Value: 90 },
            { Metric: 'Agility', Value: 65 },
            { Metric: 'Intelligence', Value: 85 },
        ];
        tests.push({
            title: 'EC: Radar — Single Polygon',
            description: 'Single-group radar. VL: manual trig + layered marks; EC: native radar series.',
            tags: ['echarts', 'radar', 'single'],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('Metric'), makeField('Value')],
            metadata: {
                Metric: { type: Type.String, semanticType: 'Category', levels: ['Speed','Strength','Defense','Agility','Intelligence'] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Metric'), y: makeEncodingItem('Value') },
        });
    }

    // 2. Multi-group radar
    {
        const metrics = ['Attack', 'Defense', 'Speed', 'HP', 'Special', 'Accuracy'];
        const groups = ['Warrior', 'Mage', 'Rogue'];
        const rand = seededRandom(1050);
        const data: any[] = [];
        for (const g of groups) {
            for (const m of metrics) {
                data.push({ Skill: m, Score: Math.round(30 + rand() * 70), Class: g });
            }
        }
        tests.push({
            title: 'EC: Radar — 3 Groups × 6 Axes',
            description: 'Multi-group radar comparison. EC excels here — native polar layout vs VL manual trig.',
            tags: ['echarts', 'radar', 'multi-group'],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('Skill'), makeField('Score'), makeField('Class')],
            metadata: {
                Skill: { type: Type.String, semanticType: 'Category', levels: metrics },
                Score: { type: Type.Number, semanticType: 'Score', levels: [] },
                Class: { type: Type.String, semanticType: 'Category', levels: groups },
            },
            encodingMap: { x: makeEncodingItem('Skill'), y: makeEncodingItem('Score'), color: makeEncodingItem('Class') },
        });
    }

    // 3. Radar with many axes
    {
        const metrics = ['Metric1','Metric2','Metric3','Metric4','Metric5','Metric6','Metric7','Metric8','Metric9','Metric10'];
        const rand = seededRandom(1051);
        const data = metrics.map(m => ({ Metric: m, Value: Math.round(20 + rand() * 80) }));
        tests.push({
            title: 'EC: Radar — 10 Axes',
            description: 'Dense radar with many axes. Tests label crowding on spokes.',
            tags: ['echarts', 'radar', 'dense'],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('Metric'), makeField('Value')],
            metadata: {
                Metric: { type: Type.String, semanticType: 'Category', levels: metrics },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Metric'), y: makeEncodingItem('Value') },
        });
    }

    return tests;
}

// ---------------------------------------------------------------------------
// Candlestick Chart
// ---------------------------------------------------------------------------

export function genEChartsCandlestickTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1100);

    function genOHLC(days: number, startPrice: number) {
        const data: any[] = [];
        let price = startPrice;
        const baseDate = new Date('2024-01-02');
        for (let i = 0; i < days; i++) {
            const date = new Date(baseDate);
            date.setDate(baseDate.getDate() + i);
            const change = (rand() - 0.48) * 4;
            const open = Math.round(price * 100) / 100;
            const close = Math.round((price + change) * 100) / 100;
            const high = Math.round((Math.max(open, close) + rand() * 2) * 100) / 100;
            const low = Math.round((Math.min(open, close) - rand() * 2) * 100) / 100;
            data.push({
                Date: date.toISOString().slice(0, 10),
                Open: open, High: high, Low: low, Close: close,
            });
            price = close;
        }
        return data;
    }

    // 1. 30-day OHLC
    {
        const data = genOHLC(30, 150);
        tests.push({
            title: 'EC: Candlestick — 30-day OHLC',
            description: 'One month stock data. EC: native candlestick series; VL: layered rule+bar.',
            tags: ['echarts', 'candlestick', 'small'],
            chartType: 'Candlestick Chart',
            data,
            fields: [makeField('Date'), makeField('Open'), makeField('High'), makeField('Low'), makeField('Close')],
            metadata: {
                Date: { type: Type.String, semanticType: 'Date', levels: [] },
                Open: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                High: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Low: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Close: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                x: makeEncodingItem('Date'),
                open: makeEncodingItem('Open'),
                high: makeEncodingItem('High'),
                low: makeEncodingItem('Low'),
                close: makeEncodingItem('Close'),
            },
        });
    }

    // 2. 90-day dense
    {
        const data = genOHLC(90, 50);
        tests.push({
            title: 'EC: Candlestick — 90-day Dense',
            description: 'Three months — tests candle width auto-sizing and dataZoom.',
            tags: ['echarts', 'candlestick', 'medium'],
            chartType: 'Candlestick Chart',
            data,
            fields: [makeField('Date'), makeField('Open'), makeField('High'), makeField('Low'), makeField('Close')],
            metadata: {
                Date: { type: Type.String, semanticType: 'Date', levels: [] },
                Open: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                High: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Low: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Close: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                x: makeEncodingItem('Date'),
                open: makeEncodingItem('Open'),
                high: makeEncodingItem('High'),
                low: makeEncodingItem('Low'),
                close: makeEncodingItem('Close'),
            },
        });
    }

    return tests;
}

// ---------------------------------------------------------------------------
// Streamgraph
// ---------------------------------------------------------------------------

export function genEChartsStreamgraphTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1150);

    const genFlow = (n: number, base: number, volatility: number): number[] => {
        const values: number[] = [base];
        let momentum = 0;
        for (let i = 1; i < n; i++) {
            momentum = 0.6 * momentum + (rand() - 0.5) * volatility;
            values.push(Math.round(Math.max(10, values[i - 1] + momentum)));
        }
        return values;
    };

    // 1. Basic streamgraph — 5 series
    {
        const dates = genDates(40, 2020);
        const genres = ['Rock', 'Pop', 'Jazz', 'Electronic', 'Classical'];
        const data: any[] = [];
        for (const g of genres) {
            const base = 100 + Math.round(rand() * 200);
            const series = genFlow(40, base, 30);
            for (let i = 0; i < dates.length; i++) {
                data.push({ Date: dates[i], Genre: g, Listeners: series[i] });
            }
        }
        tests.push({
            title: 'EC: Streamgraph — 5 Series',
            description: '40 dates × 5 genres. EC: stacked area with baseline offset; VL: area + y.stack=center.',
            tags: ['echarts', 'streamgraph', 'medium'],
            chartType: 'Streamgraph',
            data,
            fields: [makeField('Date'), makeField('Listeners'), makeField('Genre')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Listeners: { type: Type.Number, semanticType: 'Quantity', levels: genres },
                Genre: { type: Type.String, semanticType: 'Category', levels: genres },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Listeners'), color: makeEncodingItem('Genre') },
        });
    }

    // 2. Dense streamgraph — 8 series
    {
        const dates = genDates(60, 2018);
        const categories = genCategories('Sector', 8);
        const data: any[] = [];
        for (const cat of categories) {
            const base = 150 + Math.round(rand() * 300);
            const series = genFlow(60, base, 35);
            for (let i = 0; i < dates.length; i++) {
                data.push({ Date: dates[i], Sector: cat, Revenue: series[i] });
            }
        }
        tests.push({
            title: 'EC: Streamgraph — 8 Series Dense',
            description: '60 dates × 8 sectors — dense center-stacked flow.',
            tags: ['echarts', 'streamgraph', 'large'],
            chartType: 'Streamgraph',
            data,
            fields: [makeField('Date'), makeField('Revenue'), makeField('Sector')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Revenue: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Sector: { type: Type.String, semanticType: 'Category', levels: categories },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Revenue'), color: makeEncodingItem('Sector') },
        });
    }

    return tests;
}

// ============================================================================
// ECharts Facet Tests
// ============================================================================

/**
 * Helper: build a facet test for dual VL+EC rendering.
 */
function buildEChartsFacetTest(opts: {
    title: string;
    description: string;
    tags: string[];
    chartType: string;
    colCount?: number;
    rowCount?: number;
    xCategories?: string[];
    scatter?: boolean;
    seed: number;
}): TestCase {
    const { title, description, tags, chartType, colCount, rowCount, xCategories, scatter, seed } = opts;
    const rand = seededRandom(seed);
    const colVals = colCount ? genCategories('Region', colCount) : undefined;
    const rowVals = rowCount ? genCategories('Zone', rowCount) : undefined;

    const data: any[] = [];
    const facets: { col?: string; row?: string }[] = [];
    if (colVals && rowVals) {
        for (const c of colVals) for (const r of rowVals) facets.push({ col: c, row: r });
    } else if (colVals) {
        for (const c of colVals) facets.push({ col: c });
    } else if (rowVals) {
        for (const r of rowVals) facets.push({ row: r });
    }

    for (const facet of facets) {
        if (scatter) {
            for (let i = 0; i < 15; i++) {
                data.push({
                    X: Math.round(10 + rand() * 90),
                    Y: Math.round(10 + rand() * 90),
                    ...(facet.col != null ? { Col: facet.col } : {}),
                    ...(facet.row != null ? { Row: facet.row } : {}),
                });
            }
        } else {
            for (const cat of xCategories!) {
                data.push({
                    Category: cat,
                    Value: Math.round(50 + rand() * 500),
                    ...(facet.col != null ? { Col: facet.col } : {}),
                    ...(facet.row != null ? { Row: facet.row } : {}),
                });
            }
        }
    }

    const encodingMap: Partial<Record<string, any>> = {};
    const fields: any[] = [];
    const metadata: Record<string, any> = {};

    if (scatter) {
        encodingMap.x = makeEncodingItem('X');
        encodingMap.y = makeEncodingItem('Y');
        fields.push(makeField('X'), makeField('Y'));
        metadata['X'] = { type: Type.Number, semanticType: 'Value', levels: [] };
        metadata['Y'] = { type: Type.Number, semanticType: 'Value', levels: [] };
    } else {
        encodingMap.x = makeEncodingItem('Category');
        encodingMap.y = makeEncodingItem('Value');
        fields.push(makeField('Category'), makeField('Value'));
        metadata['Category'] = { type: Type.String, semanticType: 'Category', levels: xCategories };
        metadata['Value'] = { type: Type.Number, semanticType: 'Revenue', levels: [] };
    }

    if (colVals) {
        encodingMap.column = makeEncodingItem('Col');
        fields.push(makeField('Col'));
        metadata['Col'] = { type: Type.String, semanticType: 'Category', levels: colVals };
    }
    if (rowVals) {
        encodingMap.row = makeEncodingItem('Row');
        fields.push(makeField('Row'));
        metadata['Row'] = { type: Type.String, semanticType: 'Category', levels: rowVals };
    }

    return { title, description, tags, chartType, data, fields, metadata, encodingMap } as TestCase;
}

/** Small facet counts — columns, rows, col×row */
export function genEChartsFacetSmallTests(): TestCase[] {
    const cats = ['A', 'B', 'C', 'D'];
    return [
        buildEChartsFacetTest({
            title: 'EC Facet: 2 Columns — Bar',
            description: '2 column facets, 4 bars each.',
            tags: ['echarts', 'facet', 'column', 'small'],
            chartType: 'Bar Chart', colCount: 2, xCategories: cats, seed: 1300,
        }),
        buildEChartsFacetTest({
            title: 'EC Facet: 3 Columns — Scatter',
            description: '3 column facets with scatter plots.',
            tags: ['echarts', 'facet', 'column', 'small'],
            chartType: 'Scatter Plot', colCount: 3, scatter: true, seed: 1301,
        }),
        buildEChartsFacetTest({
            title: 'EC Facet: 2 Rows — Bar',
            description: '2 row facets, 4 bars each.',
            tags: ['echarts', 'facet', 'row', 'small'],
            chartType: 'Bar Chart', rowCount: 2, xCategories: cats, seed: 1302,
        }),
        buildEChartsFacetTest({
            title: 'EC Facet: 3 Rows — Scatter',
            description: '3 row facets with scatter plots.',
            tags: ['echarts', 'facet', 'row', 'small'],
            chartType: 'Scatter Plot', rowCount: 3, scatter: true, seed: 1303,
        }),
        buildEChartsFacetTest({
            title: 'EC Facet: 2×2 Col×Row — Bar',
            description: '2 columns × 2 rows = 4 panels.',
            tags: ['echarts', 'facet', 'colrow', 'small'],
            chartType: 'Bar Chart', colCount: 2, rowCount: 2, xCategories: cats, seed: 1304,
        }),
        buildEChartsFacetTest({
            title: 'EC Facet: 2×3 Col×Row — Scatter',
            description: '2 columns × 3 rows = 6 panels.',
            tags: ['echarts', 'facet', 'colrow', 'small'],
            chartType: 'Scatter Plot', colCount: 2, rowCount: 3, scatter: true, seed: 1305,
        }),
    ];
}

/** Larger column counts that require horizontal wrapping */
export function genEChartsFacetWrapTests(): TestCase[] {
    const cats = ['A', 'B', 'C'];
    return [
        buildEChartsFacetTest({
            title: 'EC Facet: 6 Columns — Bar (wrap)',
            description: '6 column facets × 3 bars. Tests horizontal wrapping.',
            tags: ['echarts', 'facet', 'column', 'wrap'],
            chartType: 'Bar Chart', colCount: 6, xCategories: cats, seed: 1310,
        }),
        buildEChartsFacetTest({
            title: 'EC Facet: 8 Columns — Scatter (wrap)',
            description: '8 column facets with scatter plots.',
            tags: ['echarts', 'facet', 'column', 'wrap'],
            chartType: 'Scatter Plot', colCount: 8, scatter: true, seed: 1311,
        }),
        buildEChartsFacetTest({
            title: 'EC Facet: 10 Columns — Bar (heavy wrap)',
            description: '10 column facets. Extreme horizontal wrap.',
            tags: ['echarts', 'facet', 'column', 'wrap', 'heavy'],
            chartType: 'Bar Chart', colCount: 10, xCategories: cats, seed: 1312,
        }),
    ];
}

/** Large col×row grids requiring clipping */
export function genEChartsFacetClipTests(): TestCase[] {
    const cats = ['A', 'B', 'C'];
    return [
        buildEChartsFacetTest({
            title: 'EC Facet: 4×3 Col×Row — Bar (12 panels)',
            description: '4 columns × 3 rows = 12 panels.',
            tags: ['echarts', 'facet', 'colrow', 'clip'],
            chartType: 'Bar Chart', colCount: 4, rowCount: 3, xCategories: cats, seed: 1320,
        }),
        buildEChartsFacetTest({
            title: 'EC Facet: 5×4 Col×Row — Scatter (20 panels)',
            description: '5 columns × 4 rows = 20 panels.',
            tags: ['echarts', 'facet', 'colrow', 'clip'],
            chartType: 'Scatter Plot', colCount: 5, rowCount: 4, scatter: true, seed: 1321,
        }),
        buildEChartsFacetTest({
            title: 'EC Facet: 6×5 Col×Row — Bar (30 panels)',
            description: '6 columns × 5 rows = 30 panels. Extreme grid.',
            tags: ['echarts', 'facet', 'colrow', 'clip', 'heavy'],
            chartType: 'Bar Chart', colCount: 6, rowCount: 5, xCategories: cats, seed: 1322,
        }),
        buildEChartsFacetTest({
            title: 'EC Facet: 8 Rows — Scatter (vertical clip)',
            description: '8 row facets. Tests vertical overflow.',
            tags: ['echarts', 'facet', 'row', 'clip'],
            chartType: 'Scatter Plot', rowCount: 8, scatter: true, seed: 1323,
        }),
    ];
}