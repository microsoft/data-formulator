// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts backend comparison tests.
 *
 * Runs the same test inputs through BOTH assembleVegaLite (Vega-Lite) and
 * assembleECharts (ECharts) to verify:
 *   1. Both produce valid output from the same inputs
 *   2. The structural differences are as expected (encoding-based vs series-based)
 *   3. Core analysis phases (semantics, layout, overflow) produce identical results
 *
 * Covers: Scatter Plot, Line Chart, Bar Chart, Stacked Bar Chart, Grouped Bar Chart
 */

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genCategories, genDates, genMonths } from './generators';

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
                Revenue: { type: Type.Number, semanticType: 'Amount', levels: [] },
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
                Sales: { type: Type.Number, semanticType: 'Amount', levels: [] },
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
                Sales: { type: Type.Number, semanticType: 'Amount', levels: [] },
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
                Revenue: { type: Type.Number, semanticType: 'Amount', levels: [] },
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
                Sales: { type: Type.Number, semanticType: 'Amount', levels: [] },
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
                Revenue: { type: Type.Number, semanticType: 'Amount', levels: [] },
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
                Date: { type: Type.String, semanticType: 'Temporal', levels: days },
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
                Sales: { type: Type.Number, semanticType: 'Amount', levels: [] },
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
                Revenue: { type: Type.Number, semanticType: 'Amount', levels: [] },
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
                Sales: { type: Type.Number, semanticType: 'Amount', levels: [] },
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
                Revenue: { type: Type.Number, semanticType: 'Amount', levels: [] },
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
                Sales: { type: Type.Number, semanticType: 'Amount', levels: [] },
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
        metadata['Value'] = { type: Type.Number, semanticType: 'Amount', levels: [] };
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

// ===========================================================================
// Rose Chart tests
// ===========================================================================

export function genEChartsRoseTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1400);

    // 1. Basic rose — wind directions × speed
    {
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const data = directions.map(d => ({ Direction: d, Speed: Math.round(5 + rand() * 25) }));
        tests.push({
            title: 'EC: Rose — 8 Directions',
            description: 'Wind speed by compass direction. VL: arc+theta+radius; EC: series type=bar (polar).',
            tags: ['echarts', 'rose', 'basic'],
            chartType: 'Rose Chart',
            data,
            fields: [makeField('Direction'), makeField('Speed')],
            metadata: {
                Direction: { type: Type.String, semanticType: 'Category', levels: directions },
                Speed: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Direction'), y: makeEncodingItem('Speed') },
            chartProperties: { alignment: 'center' },
        });
    }

    // 2. Stacked rose — directions × season
    {
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const seasons = ['Spring', 'Summer', 'Autumn', 'Winter'];
        const data: any[] = [];
        for (const d of directions) {
            for (const s of seasons) {
                data.push({ Direction: d, Speed: Math.round(3 + rand() * 20), Season: s });
            }
        }
        tests.push({
            title: 'EC: Stacked Rose — 8 dirs × 4 seasons',
            description: 'Stacked wind rose by season. Tests polar stacked bar rendering.',
            tags: ['echarts', 'rose', 'stacked'],
            chartType: 'Rose Chart',
            data,
            fields: [makeField('Direction'), makeField('Speed'), makeField('Season')],
            metadata: {
                Direction: { type: Type.String, semanticType: 'Category', levels: directions },
                Speed: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Season: { type: Type.String, semanticType: 'Category', levels: seasons },
            },
            encodingMap: { x: makeEncodingItem('Direction'), y: makeEncodingItem('Speed'), color: makeEncodingItem('Season') },
            chartProperties: { alignment: 'center' },
        });
    }

    // 3. Rose — 12 months
    {
        const months = genMonths(12);
        const data = months.map(m => ({ Month: m, Rainfall: Math.round(20 + rand() * 150) }));
        tests.push({
            title: 'EC: Rose — 12 Months Rainfall',
            description: 'Monthly rainfall as a rose chart. Tests many-category angular layout.',
            tags: ['echarts', 'rose', 'medium'],
            chartType: 'Rose Chart',
            data,
            fields: [makeField('Month'), makeField('Rainfall')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: months },
                Rainfall: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Rainfall') },
        });
    }

    return tests;
}

// ===========================================================================
// Gauge Chart tests (ECharts-only)
// ===========================================================================

export function genEChartsGaugeTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1500);

    // 1. Basic gauge — single KPI value
    {
        const data = [{ Score: 72.5 }];
        tests.push({
            title: 'EC: Gauge — Single KPI',
            description: 'Single-value gauge chart. ECharts-only — no VL equivalent.',
            tags: ['echarts', 'gauge', 'basic'],
            chartType: 'Gauge Chart',
            data,
            fields: [makeField('Score')],
            metadata: {
                Score: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { size: makeEncodingItem('Score') },
            chartProperties: { max: 100 },
        });
    }

    // 2. Multiple pointers — multi-KPI gauge
    {
        const data = [
            { Metric: 'CPU', Usage: 65 },
            { Metric: 'Memory', Usage: 82 },
            { Metric: 'Disk', Usage: 43 },
        ];
        tests.push({
            title: 'EC: Gauge — Multi-Pointer (3 KPIs)',
            description: 'Three pointers on a single gauge for CPU/Memory/Disk.',
            tags: ['echarts', 'gauge', 'multi'],
            chartType: 'Gauge Chart',
            data,
            fields: [makeField('Metric'), makeField('Usage')],
            metadata: {
                Metric: { type: Type.String, semanticType: 'Category', levels: ['CPU', 'Memory', 'Disk'] },
                Usage: { type: Type.Number, semanticType: 'Percentage', levels: [] },
            },
            encodingMap: { size: makeEncodingItem('Usage'), column: makeEncodingItem('Metric') },
            chartProperties: { max: 100 },
        });
    }

    // 3. Aggregate gauge — average of many values
    {
        const data = Array.from({ length: 50 }, () => ({
            Temperature: Math.round((18 + rand() * 15) * 10) / 10,
        }));
        tests.push({
            title: 'EC: Gauge — Aggregated (50 rows avg)',
            description: 'Gauge showing average of 50 temperature readings.',
            tags: ['echarts', 'gauge', 'aggregate'],
            chartType: 'Gauge Chart',
            data,
            fields: [makeField('Temperature')],
            metadata: {
                Temperature: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { size: makeEncodingItem('Temperature') },
            chartProperties: { min: 0, max: 50 },
        });
    }

    return tests;
}

// ===========================================================================
// Funnel Chart tests (ECharts-only)
// ===========================================================================

export function genEChartsFunnelTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1600);

    // 1. Basic sales funnel
    {
        const stages = ['Visits', 'Signups', 'Trials', 'Purchases', 'Renewals'];
        const data = stages.map((s, i) => ({
            Stage: s,
            Count: Math.round(10000 / Math.pow(2, i) + rand() * 500),
        }));
        tests.push({
            title: 'EC: Funnel — Sales Pipeline',
            description: 'Classic conversion funnel. ECharts-only — no VL equivalent.',
            tags: ['echarts', 'funnel', 'basic'],
            chartType: 'Funnel Chart',
            data,
            fields: [makeField('Stage'), makeField('Count')],
            metadata: {
                Stage: { type: Type.String, semanticType: 'Category', levels: stages },
                Count: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { y: makeEncodingItem('Stage'), size: makeEncodingItem('Count') },
        });
    }

    // 2. Recruitment funnel — ascending
    {
        const steps = ['Applied', 'Screened', 'Interviewed', 'Offered', 'Hired'];
        const data = steps.map((s, i) => ({
            Step: s,
            Candidates: Math.round(500 / Math.pow(1.8, i) + rand() * 30),
        }));
        tests.push({
            title: 'EC: Funnel — Recruitment (ascending)',
            description: 'Hiring funnel sorted ascending (narrowest at top).',
            tags: ['echarts', 'funnel', 'ascending'],
            chartType: 'Funnel Chart',
            data,
            fields: [makeField('Step'), makeField('Candidates')],
            metadata: {
                Step: { type: Type.String, semanticType: 'Category', levels: steps },
                Candidates: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { y: makeEncodingItem('Step'), size: makeEncodingItem('Candidates') },
            chartProperties: { sort: 'ascending' },
        });
    }

    // 3. Many stages
    {
        const steps = ['Awareness', 'Interest', 'Consideration', 'Intent',
                        'Evaluation', 'Trial', 'Purchase', 'Loyalty'];
        const data = steps.map((s, i) => ({
            Phase: s,
            Users: Math.round(50000 / Math.pow(1.5, i) + rand() * 1000),
        }));
        tests.push({
            title: 'EC: Funnel — 8-Stage Marketing',
            description: 'Marketing funnel with 8 stages. Tests label fitting.',
            tags: ['echarts', 'funnel', 'many-stages'],
            chartType: 'Funnel Chart',
            data,
            fields: [makeField('Phase'), makeField('Users')],
            metadata: {
                Phase: { type: Type.String, semanticType: 'Category', levels: steps },
                Users: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { y: makeEncodingItem('Phase'), size: makeEncodingItem('Users') },
        });
    }

    return tests;
}

// ===========================================================================
// Treemap tests (ECharts-only)
// ===========================================================================

export function genEChartsTreemapTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1700);

    // 1. Flat treemap — market sectors
    {
        const sectors = ['Technology', 'Healthcare', 'Finance', 'Energy', 'Consumer', 'Industrials'];
        const data = sectors.map(s => ({
            Sector: s,
            MarketCap: Math.round(500 + rand() * 4500),
        }));
        tests.push({
            title: 'EC: Treemap — Market Sectors',
            description: 'Flat treemap of market cap by sector. ECharts-only — no VL equivalent.',
            tags: ['echarts', 'treemap', 'flat'],
            chartType: 'Treemap',
            data,
            fields: [makeField('Sector'), makeField('MarketCap')],
            metadata: {
                Sector: { type: Type.String, semanticType: 'Category', levels: sectors },
                MarketCap: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Sector'), size: makeEncodingItem('MarketCap') },
        });
    }

    // 2. Hierarchical treemap — regions → countries
    {
        const hierarchy: Record<string, string[]> = {
            'Americas': ['USA', 'Canada', 'Brazil', 'Mexico'],
            'Europe': ['UK', 'Germany', 'France', 'Italy'],
            'Asia': ['China', 'Japan', 'India', 'Korea'],
        };
        const data: any[] = [];
        for (const [region, countries] of Object.entries(hierarchy)) {
            for (const country of countries) {
                data.push({
                    Region: region,
                    Country: country,
                    Revenue: Math.round(100 + rand() * 2000),
                });
            }
        }
        tests.push({
            title: 'EC: Treemap — Regions × Countries',
            description: 'Two-level treemap: 3 regions → 4 countries each.',
            tags: ['echarts', 'treemap', 'hierarchical'],
            chartType: 'Treemap',
            data,
            fields: [makeField('Region'), makeField('Country'), makeField('Revenue')],
            metadata: {
                Region: { type: Type.String, semanticType: 'Category', levels: Object.keys(hierarchy) },
                Country: { type: Type.String, semanticType: 'Country', levels: [] },
                Revenue: { type: Type.Number, semanticType: 'Amount', levels: [] },
            },
            encodingMap: {
                color: makeEncodingItem('Region'),
                detail: makeEncodingItem('Country'),
                size: makeEncodingItem('Revenue'),
            },
        });
    }

    // 3. Large flat treemap — 15 categories
    {
        const categories = genCategories('Item', 15);
        const data = categories.map(c => ({
            Item: c,
            Size: Math.round(50 + rand() * 500),
        }));
        tests.push({
            title: 'EC: Treemap — 15 Categories',
            description: 'Large flat treemap with 15 items. Tests label fitting and color cycling.',
            tags: ['echarts', 'treemap', 'large'],
            chartType: 'Treemap',
            data,
            fields: [makeField('Item'), makeField('Size')],
            metadata: {
                Item: { type: Type.String, semanticType: 'Category', levels: categories },
                Size: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Item'), size: makeEncodingItem('Size') },
        });
    }

    return tests;
}

// ===========================================================================
// Sunburst Chart tests (ECharts-only)
// ===========================================================================

export function genEChartsSunburstTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1800);

    // 1. Flat sunburst — budget categories
    {
        const categories = ['Housing', 'Food', 'Transport', 'Entertainment', 'Savings', 'Healthcare'];
        const data = categories.map(c => ({
            Category: c,
            Amount: Math.round(200 + rand() * 2000),
        }));
        tests.push({
            title: 'EC: Sunburst — Budget Categories',
            description: 'Single-ring sunburst of budget allocation. ECharts-only — no VL equivalent.',
            tags: ['echarts', 'sunburst', 'flat'],
            chartType: 'Sunburst Chart',
            data,
            fields: [makeField('Category'), makeField('Amount')],
            metadata: {
                Category: { type: Type.String, semanticType: 'Category', levels: categories },
                Amount: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Category'), size: makeEncodingItem('Amount') },
        });
    }

    // 2. Two-ring sunburst — departments → teams
    {
        const hierarchy: Record<string, string[]> = {
            'Engineering': ['Frontend', 'Backend', 'Infra', 'QA'],
            'Product': ['Design', 'PM', 'Research'],
            'Operations': ['HR', 'Finance', 'Legal'],
        };
        const data: any[] = [];
        for (const [dept, teams] of Object.entries(hierarchy)) {
            for (const team of teams) {
                data.push({
                    Department: dept,
                    Team: team,
                    Headcount: Math.round(5 + rand() * 50),
                });
            }
        }
        tests.push({
            title: 'EC: Sunburst — Departments × Teams',
            description: 'Two-ring sunburst: 3 departments → 3–4 teams each.',
            tags: ['echarts', 'sunburst', 'hierarchical'],
            chartType: 'Sunburst Chart',
            data,
            fields: [makeField('Department'), makeField('Team'), makeField('Headcount')],
            metadata: {
                Department: { type: Type.String, semanticType: 'Category', levels: Object.keys(hierarchy) },
                Team: { type: Type.String, semanticType: 'Category', levels: [] },
                Headcount: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                color: makeEncodingItem('Department'),
                group: makeEncodingItem('Team'),
                size: makeEncodingItem('Headcount'),
            },
        });
    }

    // 3. Sunburst with many items
    {
        const continents: Record<string, string[]> = {
            'North America': ['USA', 'Canada', 'Mexico'],
            'Europe': ['UK', 'France', 'Germany', 'Spain', 'Italy'],
            'Asia': ['China', 'Japan', 'India', 'Korea', 'Thailand'],
            'South America': ['Brazil', 'Argentina', 'Chile'],
        };
        const data: any[] = [];
        for (const [cont, countries] of Object.entries(continents)) {
            for (const country of countries) {
                data.push({
                    Continent: cont,
                    Country: country,
                    Population: Math.round(10 + rand() * 1400),
                });
            }
        }
        tests.push({
            title: 'EC: Sunburst — 4 Continents × Countries',
            description: 'Two-ring sunburst with 16 countries across 4 continents.',
            tags: ['echarts', 'sunburst', 'large'],
            chartType: 'Sunburst Chart',
            data,
            fields: [makeField('Continent'), makeField('Country'), makeField('Population')],
            metadata: {
                Continent: { type: Type.String, semanticType: 'Category', levels: Object.keys(continents) },
                Country: { type: Type.String, semanticType: 'Country', levels: [] },
                Population: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                color: makeEncodingItem('Continent'),
                group: makeEncodingItem('Country'),
                size: makeEncodingItem('Population'),
            },
        });
    }

    return tests;
}

// ===========================================================================
// Sankey Diagram tests (ECharts-only)
// ===========================================================================

export function genEChartsSankeyTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1900);

    // 1. Simple energy flow
    {
        const data = [
            { Source: 'Coal', Target: 'Electricity', Value: 250 },
            { Source: 'Gas', Target: 'Electricity', Value: 180 },
            { Source: 'Gas', Target: 'Heating', Value: 120 },
            { Source: 'Oil', Target: 'Transport', Value: 300 },
            { Source: 'Oil', Target: 'Industry', Value: 80 },
            { Source: 'Electricity', Target: 'Residential', Value: 200 },
            { Source: 'Electricity', Target: 'Industry', Value: 230 },
            { Source: 'Heating', Target: 'Residential', Value: 120 },
        ];
        tests.push({
            title: 'EC: Sankey — Energy Flow',
            description: 'Energy source → use Sankey diagram. ECharts-only — no VL equivalent.',
            tags: ['echarts', 'sankey', 'basic'],
            chartType: 'Sankey Diagram',
            data,
            fields: [makeField('Source'), makeField('Target'), makeField('Value')],
            metadata: {
                Source: { type: Type.String, semanticType: 'Category', levels: [] },
                Target: { type: Type.String, semanticType: 'Category', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                x: makeEncodingItem('Source'),
                y: makeEncodingItem('Target'),
                size: makeEncodingItem('Value'),
            },
        });
    }

    // 2. Website user flow
    {
        const data = [
            { From: 'Home', To: 'Products', Users: 450 },
            { From: 'Home', To: 'About', Users: 120 },
            { From: 'Home', To: 'Blog', Users: 200 },
            { From: 'Products', To: 'Cart', Users: 180 },
            { From: 'Products', To: 'Details', Users: 270 },
            { From: 'Details', To: 'Cart', Users: 150 },
            { From: 'Cart', To: 'Checkout', Users: 200 },
            { From: 'Cart', To: 'Home', Users: 50 },
            { From: 'Blog', To: 'Products', Users: 80 },
        ];
        tests.push({
            title: 'EC: Sankey — Website User Flow',
            description: 'Page-to-page navigation flow with link width proportional to user count.',
            tags: ['echarts', 'sankey', 'user-flow'],
            chartType: 'Sankey Diagram',
            data,
            fields: [makeField('From'), makeField('To'), makeField('Users')],
            metadata: {
                From: { type: Type.String, semanticType: 'Category', levels: [] },
                To: { type: Type.String, semanticType: 'Category', levels: [] },
                Users: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                x: makeEncodingItem('From'),
                y: makeEncodingItem('To'),
                size: makeEncodingItem('Users'),
            },
        });
    }

    // 3. Dense Sankey — budget allocation
    {
        const sources = ['Federal', 'State', 'Municipal'];
        const intermediates = ['Education', 'Healthcare', 'Defense', 'Infrastructure'];
        const destinations = ['Salaries', 'Equipment', 'Contracts', 'Research'];
        const data: any[] = [];
        for (const src of sources) {
            for (const mid of intermediates) {
                data.push({ Source: src, Target: mid, Amount: Math.round(50 + rand() * 500) });
            }
        }
        for (const mid of intermediates) {
            for (const dst of destinations) {
                data.push({ Source: mid, Target: dst, Amount: Math.round(30 + rand() * 300) });
            }
        }
        tests.push({
            title: 'EC: Sankey — Budget Flow (3-layer)',
            description: '3 sources → 4 intermediates → 4 destinations. Tests dense multi-layer layout.',
            tags: ['echarts', 'sankey', 'dense'],
            chartType: 'Sankey Diagram',
            data,
            fields: [makeField('Source'), makeField('Target'), makeField('Amount')],
            metadata: {
                Source: { type: Type.String, semanticType: 'Category', levels: [] },
                Target: { type: Type.String, semanticType: 'Category', levels: [] },
                Amount: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                x: makeEncodingItem('Source'),
                y: makeEncodingItem('Target'),
                size: makeEncodingItem('Amount'),
            },
        });
    }

    return tests;
}

// ===========================================================================
// Stress tests for ECharts-only chart types
// ===========================================================================

export function genEChartsUniqueStressTests(): TestCase[] {
    const tests: TestCase[] = [];

    // ── Gauge stress ─────────────────────────────────────────────────────

    // 1. Gauge — many KPIs (6 pointers side-by-side)
    {
        const rand = seededRandom(2000);
        const metrics = ['CPU', 'Memory', 'Disk', 'Network', 'GPU', 'IO'];
        const data = metrics.map(m => ({
            Metric: m,
            Usage: Math.round(10 + rand() * 90),
        }));
        tests.push({
            title: 'EC Stress: Gauge — 6 KPIs',
            description: '6 separate gauge dials side-by-side. Tests layout spacing with many gauges.',
            tags: ['echarts', 'gauge', 'stress'],
            chartType: 'Gauge Chart',
            data,
            fields: [makeField('Metric'), makeField('Usage')],
            metadata: {
                Metric: { type: Type.String, semanticType: 'Category', levels: metrics },
                Usage: { type: Type.Number, semanticType: 'Percentage', levels: [] },
            },
            encodingMap: { size: makeEncodingItem('Usage'), column: makeEncodingItem('Metric') },
            chartProperties: { max: 100 },
        });
    }

    // 2. Gauge — aggregated from many rows
    {
        const rand = seededRandom(2001);
        const data = Array.from({ length: 200 }, () => ({
            Latency: Math.round((5 + rand() * 500) * 10) / 10,
        }));
        tests.push({
            title: 'EC Stress: Gauge — Aggregated (200 rows)',
            description: 'Single gauge averaging 200 latency readings.',
            tags: ['echarts', 'gauge', 'stress', 'aggregate'],
            chartType: 'Gauge Chart',
            data,
            fields: [makeField('Latency')],
            metadata: {
                Latency: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { size: makeEncodingItem('Latency') },
            chartProperties: { min: 0, max: 500 },
        });
    }

    // ── Funnel stress ────────────────────────────────────────────────────

    // 3. Funnel — 12 stages
    {
        const rand = seededRandom(2010);
        const stages = [
            'Impression', 'View', 'Click', 'Visit', 'Browse',
            'Add to Cart', 'Checkout Start', 'Address', 'Payment',
            'Review', 'Confirm', 'Purchase',
        ];
        const data = stages.map((s, i) => ({
            Stage: s,
            Users: Math.round(100000 / Math.pow(1.4, i) + rand() * 2000),
        }));
        tests.push({
            title: 'EC Stress: Funnel — 12 Stages',
            description: '12-stage e-commerce funnel. Tests label fitting in narrow trapezoids.',
            tags: ['echarts', 'funnel', 'stress', 'many-stages'],
            chartType: 'Funnel Chart',
            data,
            fields: [makeField('Stage'), makeField('Users')],
            metadata: {
                Stage: { type: Type.String, semanticType: 'Category', levels: stages },
                Users: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { y: makeEncodingItem('Stage'), size: makeEncodingItem('Users') },
        });
    }

    // 4. Funnel — extreme value ratio (top 100× bottom)
    {
        const stages = ['Awareness', 'Interest', 'Desire', 'Action', 'Retention'];
        const values = [100000, 25000, 5000, 800, 120];
        const data = stages.map((s, i) => ({ Phase: s, Count: values[i] }));
        tests.push({
            title: 'EC Stress: Funnel — Extreme Ratio (833:1)',
            description: 'Top stage is ~833× larger than bottom. Tests rendering of very thin tail stages.',
            tags: ['echarts', 'funnel', 'stress', 'extreme-ratio'],
            chartType: 'Funnel Chart',
            data,
            fields: [makeField('Phase'), makeField('Count')],
            metadata: {
                Phase: { type: Type.String, semanticType: 'Category', levels: stages },
                Count: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { y: makeEncodingItem('Phase'), size: makeEncodingItem('Count') },
        });
    }

    // ── Treemap stress ───────────────────────────────────────────────────

    // 5. Treemap — 30 flat categories
    {
        const rand = seededRandom(2020);
        const categories = genCategories('Stock', 30);
        const data = categories.map(c => ({
            Stock: c,
            MarketCap: Math.round(100 + rand() * 5000),
        }));
        tests.push({
            title: 'EC Stress: Treemap — 30 Items (Flat)',
            description: '30-item flat treemap. Tests label density and color cycling.',
            tags: ['echarts', 'treemap', 'stress', 'flat-large'],
            chartType: 'Treemap',
            data,
            fields: [makeField('Stock'), makeField('MarketCap')],
            metadata: {
                Stock: { type: Type.String, semanticType: 'Category', levels: categories },
                MarketCap: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Stock'), size: makeEncodingItem('MarketCap') },
        });
    }

    // 6. Treemap — deep hierarchy (6 regions × 8 products)
    {
        const rand = seededRandom(2021);
        const regions = ['North America', 'Europe', 'Asia Pacific', 'Latin America', 'Middle East', 'Africa'];
        const products = ['Software', 'Hardware', 'Services', 'Cloud', 'Security', 'Analytics', 'Mobile', 'AI'];
        const data: any[] = [];
        for (const r of regions) {
            for (const p of products) {
                data.push({
                    Region: r,
                    Product: p,
                    Revenue: Math.round(50 + rand() * 3000),
                });
            }
        }
        tests.push({
            title: 'EC Stress: Treemap — 6 Regions × 8 Products (48 leaves)',
            description: '48-leaf hierarchical treemap. Tests nested labels and color saturation.',
            tags: ['echarts', 'treemap', 'stress', 'hierarchical-large'],
            chartType: 'Treemap',
            data,
            fields: [makeField('Region'), makeField('Product'), makeField('Revenue')],
            metadata: {
                Region: { type: Type.String, semanticType: 'Category', levels: regions },
                Product: { type: Type.String, semanticType: 'Category', levels: products },
                Revenue: { type: Type.Number, semanticType: 'Amount', levels: [] },
            },
            encodingMap: {
                color: makeEncodingItem('Region'),
                detail: makeEncodingItem('Product'),
                size: makeEncodingItem('Revenue'),
            },
        });
    }

    // 7. Treemap — extreme value skew (one item dominates)
    {
        const rand = seededRandom(2022);
        const items = ['Dominant', 'Small A', 'Small B', 'Small C', 'Tiny D', 'Tiny E', 'Tiny F', 'Tiny G'];
        const values = [50000, 800, 600, 400, 100, 80, 50, 30];
        const data = items.map((item, i) => ({ Category: item, Value: values[i] + Math.round(rand() * 50) }));
        tests.push({
            title: 'EC Stress: Treemap — Extreme Skew',
            description: 'One category dominates (~96% of total). Tests visibility of tiny rectangles.',
            tags: ['echarts', 'treemap', 'stress', 'skew'],
            chartType: 'Treemap',
            data,
            fields: [makeField('Category'), makeField('Value')],
            metadata: {
                Category: { type: Type.String, semanticType: 'Category', levels: items },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Category'), size: makeEncodingItem('Value') },
        });
    }

    // ── Sunburst stress ──────────────────────────────────────────────────

    // 8. Sunburst — 5 continents × 6 countries (30 outer slices)
    {
        const rand = seededRandom(2030);
        const hierarchy: Record<string, string[]> = {
            'North America': ['USA', 'Canada', 'Mexico', 'Cuba', 'Jamaica', 'Panama'],
            'Europe': ['UK', 'France', 'Germany', 'Spain', 'Italy', 'Netherlands'],
            'Asia': ['China', 'Japan', 'India', 'Korea', 'Thailand', 'Vietnam'],
            'Africa': ['Nigeria', 'Egypt', 'South Africa', 'Kenya', 'Ghana', 'Morocco'],
            'Oceania': ['Australia', 'New Zealand', 'Fiji', 'Samoa', 'Tonga', 'Vanuatu'],
        };
        const data: any[] = [];
        for (const [continent, countries] of Object.entries(hierarchy)) {
            for (const country of countries) {
                data.push({
                    Continent: continent,
                    Country: country,
                    GDP: Math.round(10 + rand() * 20000),
                });
            }
        }
        tests.push({
            title: 'EC Stress: Sunburst — 5 × 6 (30 outer slices)',
            description: '30 countries across 5 continents. Tests outer-ring label crowding.',
            tags: ['echarts', 'sunburst', 'stress', 'large'],
            chartType: 'Sunburst Chart',
            data,
            fields: [makeField('Continent'), makeField('Country'), makeField('GDP')],
            metadata: {
                Continent: { type: Type.String, semanticType: 'Category', levels: Object.keys(hierarchy) },
                Country: { type: Type.String, semanticType: 'Country', levels: [] },
                GDP: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                color: makeEncodingItem('Continent'),
                group: makeEncodingItem('Country'),
                size: makeEncodingItem('GDP'),
            },
        });
    }

    // 9. Sunburst — flat with 20 slices
    {
        const rand = seededRandom(2031);
        const categories = genCategories('Expense', 20);
        const data = categories.map(c => ({
            Expense: c,
            Amount: Math.round(100 + rand() * 5000),
        }));
        tests.push({
            title: 'EC Stress: Sunburst — 20 Flat Slices',
            description: 'Single-ring sunburst with 20 categories. Tests label overlap on thin slices.',
            tags: ['echarts', 'sunburst', 'stress', 'flat-large'],
            chartType: 'Sunburst Chart',
            data,
            fields: [makeField('Expense'), makeField('Amount')],
            metadata: {
                Expense: { type: Type.String, semanticType: 'Category', levels: categories },
                Amount: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Expense'), size: makeEncodingItem('Amount') },
        });
    }

    // ── Sankey stress ────────────────────────────────────────────────────

    // 10. Sankey — 4-layer deep (5 → 6 → 6 → 4 = 21 nodes, ~70 links)
    {
        const rand = seededRandom(2040);
        const layer1 = ['Source A', 'Source B', 'Source C', 'Source D', 'Source E'];
        const layer2 = genCategories('Process', 6);
        const layer3 = genCategories('Output', 6);
        const layer4 = ['Final X', 'Final Y', 'Final Z', 'Final W'];
        const data: any[] = [];
        for (const s of layer1) {
            for (const p of layer2) {
                if (rand() > 0.4) {
                    data.push({ Source: s, Target: p, Flow: Math.round(20 + rand() * 300) });
                }
            }
        }
        for (const p of layer2) {
            for (const o of layer3) {
                if (rand() > 0.35) {
                    data.push({ Source: p, Target: o, Flow: Math.round(10 + rand() * 200) });
                }
            }
        }
        for (const o of layer3) {
            for (const f of layer4) {
                if (rand() > 0.3) {
                    data.push({ Source: o, Target: f, Flow: Math.round(5 + rand() * 150) });
                }
            }
        }
        tests.push({
            title: 'EC Stress: Sankey — 4-Layer Deep (~70 links)',
            description: '5 sources → 6 processes → 6 outputs → 4 finals. Tests multi-layer routing.',
            tags: ['echarts', 'sankey', 'stress', 'deep'],
            chartType: 'Sankey Diagram',
            data,
            fields: [makeField('Source'), makeField('Target'), makeField('Flow')],
            metadata: {
                Source: { type: Type.String, semanticType: 'Category', levels: [] },
                Target: { type: Type.String, semanticType: 'Category', levels: [] },
                Flow: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                x: makeEncodingItem('Source'),
                y: makeEncodingItem('Target'),
                size: makeEncodingItem('Flow'),
            },
        });
    }

    // 11. Sankey — wide fan-out (2 sources → 15 targets)
    {
        const rand = seededRandom(2041);
        const sources = ['Revenue', 'Funding'];
        const targets = genCategories('Dept', 15);
        const data: any[] = [];
        for (const s of sources) {
            for (const t of targets) {
                data.push({ From: s, To: t, Budget: Math.round(100 + rand() * 5000) });
            }
        }
        tests.push({
            title: 'EC Stress: Sankey — Wide Fan-Out (2 → 15)',
            description: '2 sources distributing to 15 departments. Tests node stacking with many targets.',
            tags: ['echarts', 'sankey', 'stress', 'fan-out'],
            chartType: 'Sankey Diagram',
            data,
            fields: [makeField('From'), makeField('To'), makeField('Budget')],
            metadata: {
                From: { type: Type.String, semanticType: 'Category', levels: sources },
                To: { type: Type.String, semanticType: 'Category', levels: targets },
                Budget: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                x: makeEncodingItem('From'),
                y: makeEncodingItem('To'),
                size: makeEncodingItem('Budget'),
            },
        });
    }

    // 12. Sankey — dense mesh (8 × 8 = 64 links)
    {
        const rand = seededRandom(2042);
        const left = genCategories('Origin', 8);
        const right = genCategories('Dest', 8);
        const data: any[] = [];
        for (const l of left) {
            for (const r of right) {
                data.push({ Origin: l, Dest: r, Volume: Math.round(10 + rand() * 500) });
            }
        }
        tests.push({
            title: 'EC Stress: Sankey — Dense Mesh (8 × 8 = 64 links)',
            description: 'Fully connected 8→8 network. Tests link crossing and visual clarity.',
            tags: ['echarts', 'sankey', 'stress', 'mesh'],
            chartType: 'Sankey Diagram',
            data,
            fields: [makeField('Origin'), makeField('Dest'), makeField('Volume')],
            metadata: {
                Origin: { type: Type.String, semanticType: 'Category', levels: left },
                Dest: { type: Type.String, semanticType: 'Category', levels: right },
                Volume: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                x: makeEncodingItem('Origin'),
                y: makeEncodingItem('Dest'),
                size: makeEncodingItem('Volume'),
            },
        });
    }

    return tests;
}