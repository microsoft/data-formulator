// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unintended-use test cases for each chart type.
 *
 * These deliberately supply data/encodings that don't match the chart's
 * intended pattern — e.g. two quantitative fields on a bar chart, negative
 * values in a pie chart, or a single data point on a line chart.
 * The goal is to verify each chart degrades gracefully rather than crashing.
 */

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genCategories } from './generators';

// ============================================================================
// Scatter & Point
// ============================================================================

export function genUnintendedScatterTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(9000);

    // Scatter: both axes categorical
    {
        const xs = ['A', 'B', 'C'];
        const ys = ['X', 'Y', 'Z'];
        const data: any[] = [];
        for (const x of xs) for (const y of ys) data.push({ GroupX: x, GroupY: y });
        tests.push({
            title: 'Scatter: both axes categorical',
            description: 'No quantitative field — two nominal dimensions',
            tags: ['unintended', 'categorical'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('GroupX'), makeField('GroupY')],
            metadata: {
                GroupX: { type: Type.String, semanticType: 'Category', levels: xs },
                GroupY: { type: Type.String, semanticType: 'Category', levels: ys },
            },
            encodingMap: { x: makeEncodingItem('GroupX'), y: makeEncodingItem('GroupY') },
        });
    }

    // Scatter: single data point
    {
        const data = [{ X: 42, Y: 99 }];
        tests.push({
            title: 'Scatter: single data point',
            description: 'Only one row — degenerate scatter',
            tags: ['unintended', 'degenerate'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('X'), makeField('Y')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y') },
        });
    }

    // Scatter: all identical values
    {
        const data = Array.from({ length: 20 }, () => ({ X: 5, Y: 5 }));
        tests.push({
            title: 'Scatter: all identical values',
            description: '20 points at the same location — zero variance',
            tags: ['unintended', 'degenerate'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('X'), makeField('Y')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y') },
        });
    }

    // Linear Regression: categorical x
    {
        const cats = ['Low', 'Med', 'High'];
        const data = cats.map(c => ({ Level: c, Value: Math.round(rand() * 100) }));
        tests.push({
            title: 'Linear Regression: categorical x',
            description: 'Ordinal x instead of quantitative — no meaningful regression',
            tags: ['unintended', 'wrong-type'],
            chartType: 'Linear Regression',
            data,
            fields: [makeField('Level'), makeField('Value')],
            metadata: {
                Level: { type: Type.String, semanticType: 'Category', levels: cats },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Level'), y: makeEncodingItem('Value') },
        });
    }

    // Linear Regression: single point
    {
        const data = [{ X: 10, Y: 20 }];
        tests.push({
            title: 'Linear Regression: single data point',
            description: 'Cannot fit a line through one point',
            tags: ['unintended', 'degenerate'],
            chartType: 'Linear Regression',
            data,
            fields: [makeField('X'), makeField('Y')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y') },
        });
    }

    // Boxplot: single value per group
    {
        const cats = ['A', 'B', 'C'];
        const data = cats.map(c => ({ Group: c, Value: Math.round(rand() * 50) }));
        tests.push({
            title: 'Boxplot: single value per group',
            description: 'One row per group — no distribution to show',
            tags: ['unintended', 'degenerate'],
            chartType: 'Boxplot',
            data,
            fields: [makeField('Group'), makeField('Value')],
            metadata: {
                Group: { type: Type.String, semanticType: 'Category', levels: cats },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Group'), y: makeEncodingItem('Value') },
        });
    }

    // Boxplot: both quantitative
    {
        const data = Array.from({ length: 30 }, () => ({
            A: Math.round(rand() * 100), B: Math.round(rand() * 100),
        }));
        tests.push({
            title: 'Boxplot: both axes quantitative',
            description: 'No categorical grouping — quant × quant',
            tags: ['unintended', 'wrong-type'],
            chartType: 'Boxplot',
            data,
            fields: [makeField('A'), makeField('B')],
            metadata: {
                A: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                B: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('A'), y: makeEncodingItem('B') },
        });
    }

    // Strip Plot: both categorical
    {
        const xs = ['A', 'B'];
        const ys = ['X', 'Y', 'Z'];
        const data: any[] = [];
        for (const x of xs) for (const y of ys) data.push({ Cat1: x, Cat2: y });
        tests.push({
            title: 'Strip Plot: both axes categorical',
            description: 'No quantitative axis for jitter',
            tags: ['unintended', 'wrong-type'],
            chartType: 'Strip Plot',
            data,
            fields: [makeField('Cat1'), makeField('Cat2')],
            metadata: {
                Cat1: { type: Type.String, semanticType: 'Category', levels: xs },
                Cat2: { type: Type.String, semanticType: 'Category', levels: ys },
            },
            encodingMap: { x: makeEncodingItem('Cat1'), y: makeEncodingItem('Cat2') },
        });
    }

    return tests;
}

// ============================================================================
// Bar
// ============================================================================

export function genUnintendedBarTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(9100);

    // Bar: both axes quantitative
    {
        const data = Array.from({ length: 10 }, () => ({
            Width: Math.round(rand() * 100), Height: Math.round(rand() * 200),
        }));
        tests.push({
            title: 'Bar: quant × quant (no categorical)',
            description: 'Both axes numeric — no categorical grouping',
            tags: ['unintended', 'wrong-type'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Width'), makeField('Height')],
            metadata: {
                Width: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Height: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Width'), y: makeEncodingItem('Height') },
        });
    }

    // Bar: 100+ categories
    {
        const cats = genCategories('Item', 120);
        const data = cats.map(c => ({ Item: c, Value: Math.round(rand() * 500) }));
        tests.push({
            title: 'Bar: 120 categories (overloaded)',
            description: 'Too many bars — labels unreadable',
            tags: ['unintended', 'overflow'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Item'), makeField('Value')],
            metadata: {
                Item: { type: Type.String, semanticType: 'Category', levels: cats },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Item'), y: makeEncodingItem('Value') },
        });
    }

    // Bar: all zero values
    {
        const cats = ['A', 'B', 'C', 'D'];
        const data = cats.map(c => ({ Category: c, Amount: 0 }));
        tests.push({
            title: 'Bar: all zero values',
            description: 'Every bar has height zero',
            tags: ['unintended', 'degenerate'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Category'), makeField('Amount')],
            metadata: {
                Category: { type: Type.String, semanticType: 'Category', levels: cats },
                Amount: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Category'), y: makeEncodingItem('Amount') },
        });
    }

    // Grouped Bar: no color encoding
    {
        const cats = ['Q1', 'Q2', 'Q3'];
        const data = cats.map(c => ({ Quarter: c, Sales: Math.round(rand() * 1000) }));
        tests.push({
            title: 'Grouped Bar: no color (degenerates to bar)',
            description: 'Missing color channel — nothing to group',
            tags: ['unintended', 'missing-encoding'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Quarter'), makeField('Sales')],
            metadata: {
                Quarter: { type: Type.String, semanticType: 'Category', levels: cats },
                Sales: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Quarter'), y: makeEncodingItem('Sales') },
        });
    }

    // Grouped Bar: numeric x and color
    {
        const data = Array.from({ length: 12 }, () => ({
            X: Math.round(rand() * 10), Y: Math.round(rand() * 100), C: Math.round(rand() * 5),
        }));
        tests.push({
            title: 'Grouped Bar: all numeric fields',
            description: 'x, y, color all quantitative — no categorical grouping',
            tags: ['unintended', 'wrong-type'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('C')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                C: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), color: makeEncodingItem('C') },
        });
    }

    // Stacked Bar: negative values
    {
        const cats = ['A', 'B', 'C'];
        const series = ['S1', 'S2', 'S3'];
        const data: any[] = [];
        for (const c of cats) for (const s of series) {
            data.push({ Cat: c, Series: s, Val: Math.round((rand() - 0.5) * 200) });
        }
        tests.push({
            title: 'Stacked Bar: negative values',
            description: 'Negative values cause stacking artifacts',
            tags: ['unintended', 'invalid-values'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Cat'), makeField('Val'), makeField('Series')],
            metadata: {
                Cat: { type: Type.String, semanticType: 'Category', levels: cats },
                Val: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Series: { type: Type.String, semanticType: 'Category', levels: series },
            },
            encodingMap: { x: makeEncodingItem('Cat'), y: makeEncodingItem('Val'), color: makeEncodingItem('Series') },
        });
    }

    // Stacked Bar: no color
    {
        const cats = ['X', 'Y', 'Z'];
        const data = cats.map(c => ({ Label: c, Value: Math.round(rand() * 100) }));
        tests.push({
            title: 'Stacked Bar: no color (nothing to stack)',
            description: 'Missing color — degenerates to plain bar',
            tags: ['unintended', 'missing-encoding'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Label'), makeField('Value')],
            metadata: {
                Label: { type: Type.String, semanticType: 'Category', levels: cats },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Label'), y: makeEncodingItem('Value') },
        });
    }

    // Histogram: categorical x
    {
        const cats = ['Apple', 'Banana', 'Cherry', 'Date'];
        const data = cats.map(c => ({ Fruit: c, Count: Math.round(rand() * 50) }));
        tests.push({
            title: 'Histogram: categorical x (pre-aggregated)',
            description: 'String values — cannot bin; looks like a bar chart',
            tags: ['unintended', 'wrong-type'],
            chartType: 'Histogram',
            data,
            fields: [makeField('Fruit'), makeField('Count')],
            metadata: {
                Fruit: { type: Type.String, semanticType: 'Category', levels: cats },
                Count: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Fruit') },
        });
    }

    // Histogram: single unique value
    {
        const data = Array.from({ length: 30 }, () => ({ Score: 50 }));
        tests.push({
            title: 'Histogram: all identical values',
            description: '30 rows all with the same value — single bin',
            tags: ['unintended', 'degenerate'],
            chartType: 'Histogram',
            data,
            fields: [makeField('Score')],
            metadata: {
                Score: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Score') },
        });
    }

    // Lollipop: both quantitative
    {
        const data = Array.from({ length: 8 }, () => ({
            X: Math.round(rand() * 100), Y: Math.round(rand() * 200),
        }));
        tests.push({
            title: 'Lollipop: quant × quant',
            description: 'Both axes numeric — no categorical for lollipop stems',
            tags: ['unintended', 'wrong-type'],
            chartType: 'Lollipop Chart',
            data,
            fields: [makeField('X'), makeField('Y')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y') },
        });
    }

    // Pyramid: flipped x/y (discrete on x, quantitative on y)
    {
        const ageGroups = ['0-9', '10-19', '20-29', '30-39', '40-49'];
        const data: any[] = [];
        for (const ag of ageGroups) {
            data.push({ 'Age Group': ag, Gender: 'Male', Population: Math.round(500 + rand() * 5000) });
            data.push({ 'Age Group': ag, Gender: 'Female', Population: Math.round(500 + rand() * 5000) });
        }
        tests.push({
            title: 'Pyramid: flipped x/y',
            description: 'Discrete field on x, quantitative on y — pyramid should auto-swap to correct orientation',
            tags: ['unintended', 'flipped-axes'],
            chartType: 'Pyramid Chart',
            data,
            fields: [makeField('Age Group'), makeField('Population'), makeField('Gender')],
            metadata: {
                'Age Group': { type: Type.String, semanticType: 'Category', levels: ageGroups },
                Population: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Gender: { type: Type.String, semanticType: 'Category', levels: ['Male', 'Female'] },
            },
            encodingMap: { x: makeEncodingItem('Age Group'), y: makeEncodingItem('Population'), color: makeEncodingItem('Gender') },
        });
    }

    // Pyramid: 5 color groups (not binary)
    {
        const ages = ['0-9', '10-19', '20-29', '30-39'];
        const genders = ['M', 'F', 'X', 'NB', 'Other'];
        const data: any[] = [];
        for (const a of ages) for (const g of genders) {
            data.push({ Age: a, Gender: g, Pop: Math.round(rand() * 10000) });
        }
        tests.push({
            title: 'Pyramid: 5 groups (not binary)',
            description: 'Pyramid expects 2 opposing groups, given 5',
            tags: ['unintended', 'wrong-cardinality'],
            chartType: 'Pyramid Chart',
            data,
            fields: [makeField('Age'), makeField('Pop'), makeField('Gender')],
            metadata: {
                Age: { type: Type.String, semanticType: 'Category', levels: ages },
                Pop: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Gender: { type: Type.String, semanticType: 'Category', levels: genders },
            },
            encodingMap: { y: makeEncodingItem('Age'), x: makeEncodingItem('Pop'), color: makeEncodingItem('Gender') },
        });
    }

    return tests;
}

// ============================================================================
// Line & Area
// ============================================================================

export function genUnintendedLineAreaTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(9200);

    // Line: unordered categorical x
    {
        const cats = ['Dog', 'Cat', 'Fish', 'Bird', 'Snake'];
        const data = cats.map(c => ({ Animal: c, Count: Math.round(rand() * 100) }));
        tests.push({
            title: 'Line: unordered categorical x',
            description: 'Nominal x with no natural order — line misleading',
            tags: ['unintended', 'wrong-type'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Animal'), makeField('Count')],
            metadata: {
                Animal: { type: Type.String, semanticType: 'Category', levels: cats },
                Count: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Animal'), y: makeEncodingItem('Count') },
        });
    }

    // Line: single data point
    {
        const data = [{ Date: '2024-01-01', Value: 100 }];
        tests.push({
            title: 'Line: single data point',
            description: 'One row — no line to draw',
            tags: ['unintended', 'degenerate'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Date'), makeField('Value')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Value') },
        });
    }

    // Line: quant × quant (no temporal)
    {
        const data = Array.from({ length: 15 }, () => ({
            A: Math.round(rand() * 100), B: Math.round(rand() * 100),
        }));
        tests.push({
            title: 'Line: quant × quant (no time axis)',
            description: 'Both numeric — line connects in arbitrary order',
            tags: ['unintended', 'wrong-type'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('A'), makeField('B')],
            metadata: {
                A: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                B: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('A'), y: makeEncodingItem('B') },
        });
    }

    // Bump Chart: continuous y (not rank)
    {
        const months = ['Jan', 'Feb', 'Mar', 'Apr'];
        const teams = ['A', 'B', 'C'];
        const data: any[] = [];
        for (const m of months) for (const t of teams) {
            data.push({ Month: m, Team: t, Revenue: Math.round(rand() * 50000) });
        }
        tests.push({
            title: 'Bump: continuous values (not rank)',
            description: 'Large continuous values instead of rankings',
            tags: ['unintended', 'wrong-type'],
            chartType: 'Bump Chart',
            data,
            fields: [makeField('Month'), makeField('Revenue'), makeField('Team')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: months },
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Team: { type: Type.String, semanticType: 'Category', levels: teams },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Revenue'), color: makeEncodingItem('Team') },
        });
    }

    // Bump Chart: ties in rank
    {
        const rounds = ['R1', 'R2', 'R3'];
        const teams = ['X', 'Y', 'Z'];
        const data: any[] = [];
        for (const r of rounds) for (const t of teams) {
            data.push({ Round: r, Team: t, Rank: 1 }); // all tied at rank 1
        }
        tests.push({
            title: 'Bump: all tied at same rank',
            description: 'Every entity rank 1 — lines overlap completely',
            tags: ['unintended', 'degenerate'],
            chartType: 'Bump Chart',
            data,
            fields: [makeField('Round'), makeField('Rank'), makeField('Team')],
            metadata: {
                Round: { type: Type.String, semanticType: 'Category', levels: rounds },
                Rank: { type: Type.Number, semanticType: 'Rank', levels: [] },
                Team: { type: Type.String, semanticType: 'Category', levels: teams },
            },
            encodingMap: { x: makeEncodingItem('Round'), y: makeEncodingItem('Rank'), color: makeEncodingItem('Team') },
        });
    }

    // Area: negative values
    {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
        const series = ['Income', 'Loss'];
        const data: any[] = [];
        for (const m of months) for (const s of series) {
            data.push({ Month: m, Type: s, Amount: Math.round((rand() - 0.4) * 500) });
        }
        tests.push({
            title: 'Area: negative values',
            description: 'Negative y causes area to extend below baseline',
            tags: ['unintended', 'invalid-values'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('Month'), makeField('Amount'), makeField('Type')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: months },
                Amount: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Type: { type: Type.String, semanticType: 'Category', levels: series },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Amount'), color: makeEncodingItem('Type') },
        });
    }

    // Area: single data point
    {
        const data = [{ X: '2024-01-01', Y: 50 }];
        tests.push({
            title: 'Area: single data point',
            description: 'One row — no area to fill',
            tags: ['unintended', 'degenerate'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('X'), makeField('Y')],
            metadata: {
                X: { type: Type.Date, semanticType: 'Date', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y') },
        });
    }

    // Streamgraph: single series (no color)
    {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May'];
        const data = months.map(m => ({ Month: m, Value: Math.round(rand() * 300) }));
        tests.push({
            title: 'Streamgraph: single series (no color)',
            description: 'No color encoding — nothing to stream',
            tags: ['unintended', 'missing-encoding'],
            chartType: 'Streamgraph',
            data,
            fields: [makeField('Month'), makeField('Value')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: months },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Value') },
        });
    }

    // Streamgraph: 2 data points
    {
        const data = [
            { X: 'A', Series: 'S1', Y: 10 },
            { X: 'B', Series: 'S1', Y: 20 },
        ];
        tests.push({
            title: 'Streamgraph: only 2 data points',
            description: 'Minimal data — barely a stream',
            tags: ['unintended', 'degenerate'],
            chartType: 'Streamgraph',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('Series')],
            metadata: {
                X: { type: Type.String, semanticType: 'Category', levels: ['A', 'B'] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Series: { type: Type.String, semanticType: 'Category', levels: ['S1'] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), color: makeEncodingItem('Series') },
        });
    }

    // Dotted Line: hundreds of unordered categories
    {
        const cats = genCategories('Item', 80);
        const data = cats.map(c => ({ Item: c, Score: Math.round(rand() * 100) }));
        tests.push({
            title: 'Dotted Line: 80 unordered categories',
            description: 'Too many nominal items — line is meaningless',
            tags: ['unintended', 'overflow'],
            chartType: 'Dotted Line Chart',
            data,
            fields: [makeField('Item'), makeField('Score')],
            metadata: {
                Item: { type: Type.String, semanticType: 'Category', levels: cats },
                Score: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Item'), y: makeEncodingItem('Score') },
        });
    }

    return tests;
}

// ============================================================================
// Part-to-Whole
// ============================================================================

export function genUnintendedPartToWholeTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(9300);

    // Pie: negative values
    {
        const cats = ['A', 'B', 'C', 'D'];
        const data = cats.map(c => ({ Slice: c, Value: Math.round((rand() - 0.3) * 100) }));
        tests.push({
            title: 'Pie: negative values',
            description: 'Negative slice values — invalid for proportions',
            tags: ['unintended', 'invalid-values'],
            chartType: 'Pie Chart',
            data,
            fields: [makeField('Slice'), makeField('Value')],
            metadata: {
                Slice: { type: Type.String, semanticType: 'Category', levels: cats },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Slice'), theta: makeEncodingItem('Value') },
        });
    }

    // Pie: 50 slices
    {
        const cats = genCategories('Slice', 50);
        const data = cats.map(c => ({ Label: c, Amount: Math.round(1 + rand() * 20) }));
        tests.push({
            title: 'Pie: 50 slices (overloaded)',
            description: 'Too many slices — unreadable',
            tags: ['unintended', 'overflow'],
            chartType: 'Pie Chart',
            data,
            fields: [makeField('Label'), makeField('Amount')],
            metadata: {
                Label: { type: Type.String, semanticType: 'Category', levels: cats },
                Amount: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Label'), theta: makeEncodingItem('Amount') },
        });
    }

    // Pie: all zeros
    {
        const cats = ['X', 'Y', 'Z'];
        const data = cats.map(c => ({ Cat: c, Val: 0 }));
        tests.push({
            title: 'Pie: all zero values',
            description: 'Every slice is zero — no proportions',
            tags: ['unintended', 'degenerate'],
            chartType: 'Pie Chart',
            data,
            fields: [makeField('Cat'), makeField('Val')],
            metadata: {
                Cat: { type: Type.String, semanticType: 'Category', levels: cats },
                Val: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Cat'), theta: makeEncodingItem('Val') },
        });
    }

    // Pie: single slice
    {
        const data = [{ Cat: 'Only', Val: 100 }];
        tests.push({
            title: 'Pie: single slice',
            description: 'One category — full circle, no comparison',
            tags: ['unintended', 'degenerate'],
            chartType: 'Pie Chart',
            data,
            fields: [makeField('Cat'), makeField('Val')],
            metadata: {
                Cat: { type: Type.String, semanticType: 'Category', levels: ['Only'] },
                Val: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { color: makeEncodingItem('Cat'), theta: makeEncodingItem('Val') },
        });
    }

    // Heatmap: all three axes quantitative
    {
        const data = Array.from({ length: 20 }, () => ({
            X: Math.round(rand() * 10), Y: Math.round(rand() * 10), Z: Math.round(rand() * 100),
        }));
        tests.push({
            title: 'Heatmap: all quantitative',
            description: 'x, y, color all numeric — no categorical grid',
            tags: ['unintended', 'wrong-type'],
            chartType: 'Heatmap',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('Z')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Z: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), color: makeEncodingItem('Z') },
        });
    }

    // Heatmap: single row
    {
        const cols = ['A', 'B', 'C', 'D'];
        const data = cols.map(c => ({ Row: 'Only', Col: c, Val: Math.round(rand() * 100) }));
        tests.push({
            title: 'Heatmap: single row',
            description: 'One y category — 1D strip, not a grid',
            tags: ['unintended', 'degenerate'],
            chartType: 'Heatmap',
            data,
            fields: [makeField('Row'), makeField('Col'), makeField('Val')],
            metadata: {
                Row: { type: Type.String, semanticType: 'Category', levels: ['Only'] },
                Col: { type: Type.String, semanticType: 'Category', levels: cols },
                Val: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Col'), y: makeEncodingItem('Row'), color: makeEncodingItem('Val') },
        });
    }

    // Heatmap: all same color value
    {
        const rows = ['R1', 'R2', 'R3'];
        const cols = ['C1', 'C2', 'C3'];
        const data: any[] = [];
        for (const r of rows) for (const c of cols) data.push({ Row: r, Col: c, Val: 42 });
        tests.push({
            title: 'Heatmap: all identical color values',
            description: 'Uniform color — no variation visible',
            tags: ['unintended', 'degenerate'],
            chartType: 'Heatmap',
            data,
            fields: [makeField('Row'), makeField('Col'), makeField('Val')],
            metadata: {
                Row: { type: Type.String, semanticType: 'Category', levels: rows },
                Col: { type: Type.String, semanticType: 'Category', levels: cols },
                Val: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Col'), y: makeEncodingItem('Row'), color: makeEncodingItem('Val') },
        });
    }

    // Waterfall: all positive (no waterfall effect)
    {
        const steps = ['Start', 'Add1', 'Add2', 'Add3', 'Total'];
        const data = steps.map(s => ({ Step: s, Delta: Math.round(10 + rand() * 90) }));
        tests.push({
            title: 'Waterfall: all positive deltas',
            description: 'No negative values — monotonic, no waterfall pattern',
            tags: ['unintended', 'degenerate'],
            chartType: 'Waterfall Chart',
            data,
            fields: [makeField('Step'), makeField('Delta')],
            metadata: {
                Step: { type: Type.String, semanticType: 'Category', levels: steps },
                Delta: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Step'), y: makeEncodingItem('Delta') },
        });
    }

    // Waterfall: single bar
    {
        const data = [{ Item: 'Only', Value: 100 }];
        tests.push({
            title: 'Waterfall: single bar',
            description: 'One step — no cascading effect',
            tags: ['unintended', 'degenerate'],
            chartType: 'Waterfall Chart',
            data,
            fields: [makeField('Item'), makeField('Value')],
            metadata: {
                Item: { type: Type.String, semanticType: 'Category', levels: ['Only'] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Item'), y: makeEncodingItem('Value') },
        });
    }

    return tests;
}

// ============================================================================
// Statistical
// ============================================================================

export function genUnintendedStatisticalTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(9400);

    // Density: categorical x
    {
        const cats = ['Red', 'Green', 'Blue'];
        const data = cats.map(c => ({ Color: c }));
        tests.push({
            title: 'Density: categorical x',
            description: 'String values — cannot compute density estimate',
            tags: ['unintended', 'wrong-type'],
            chartType: 'Density Plot',
            data,
            fields: [makeField('Color')],
            metadata: {
                Color: { type: Type.String, semanticType: 'Category', levels: cats },
            },
            encodingMap: { x: makeEncodingItem('Color') },
        });
    }

    // Density: 3 data points
    {
        const data = [{ V: 10 }, { V: 20 }, { V: 30 }];
        tests.push({
            title: 'Density: only 3 data points',
            description: 'Too few values for meaningful kernel density',
            tags: ['unintended', 'degenerate'],
            chartType: 'Density Plot',
            data,
            fields: [makeField('V')],
            metadata: {
                V: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('V') },
        });
    }

    // Density: all identical values
    {
        const data = Array.from({ length: 50 }, () => ({ Score: 75 }));
        tests.push({
            title: 'Density: all identical values',
            description: '50 rows, same value — zero variance spike',
            tags: ['unintended', 'degenerate'],
            chartType: 'Density Plot',
            data,
            fields: [makeField('Score')],
            metadata: {
                Score: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Score') },
        });
    }

    // Ranged Dot Plot: no range (single value per row)
    {
        const cats = ['A', 'B', 'C'];
        const data = cats.map(c => ({ Item: c, Value: Math.round(rand() * 100) }));
        tests.push({
            title: 'Ranged Dot Plot: single value (no range)',
            description: 'One quant column — no min/max range to display',
            tags: ['unintended', 'missing-encoding'],
            chartType: 'Ranged Dot Plot',
            data,
            fields: [makeField('Item'), makeField('Value')],
            metadata: {
                Item: { type: Type.String, semanticType: 'Category', levels: cats },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { y: makeEncodingItem('Item'), x: makeEncodingItem('Value') },
        });
    }

    // Radar: single axis
    {
        const cats = ['A', 'B'];
        const data = cats.map(c => ({ Item: c, Metric: Math.round(rand() * 100) }));
        tests.push({
            title: 'Radar: single axis',
            description: 'Only one metric — no polygon to form',
            tags: ['unintended', 'degenerate'],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('Item'), makeField('Metric')],
            metadata: {
                Item: { type: Type.String, semanticType: 'Category', levels: cats },
                Metric: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Item'), y: makeEncodingItem('Metric') },
        });
    }

    // Radar: 20+ axes
    {
        const axes = genCategories('Axis', 20);
        const data: any[] = [];
        for (const a of axes) {
            data.push({ Dimension: a, Value: Math.round(rand() * 100), Group: 'G1' });
            data.push({ Dimension: a, Value: Math.round(rand() * 100), Group: 'G2' });
        }
        tests.push({
            title: 'Radar: 20 axes (overloaded)',
            description: 'Too many radial axes — chart becomes unreadable',
            tags: ['unintended', 'overflow'],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('Dimension'), makeField('Value'), makeField('Group')],
            metadata: {
                Dimension: { type: Type.String, semanticType: 'Category', levels: axes },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Group: { type: Type.String, semanticType: 'Category', levels: ['G1', 'G2'] },
            },
            encodingMap: { x: makeEncodingItem('Dimension'), y: makeEncodingItem('Value'), color: makeEncodingItem('Group') },
        });
    }

    // Radar: all zeros
    {
        const axes = ['Speed', 'Power', 'Defense', 'Agility'];
        const data = axes.map(a => ({ Stat: a, Value: 0, Player: 'P1' }));
        tests.push({
            title: 'Radar: all zero values',
            description: 'Collapsed polygon — everything at zero',
            tags: ['unintended', 'degenerate'],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('Stat'), makeField('Value'), makeField('Player')],
            metadata: {
                Stat: { type: Type.String, semanticType: 'Category', levels: axes },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Player: { type: Type.String, semanticType: 'Category', levels: ['P1'] },
            },
            encodingMap: { x: makeEncodingItem('Stat'), y: makeEncodingItem('Value'), color: makeEncodingItem('Player') },
        });
    }

    // Candlestick: non-temporal x
    {
        const cats = ['A', 'B', 'C'];
        const data = cats.map(c => ({
            Item: c, Open: Math.round(rand() * 100), Close: Math.round(rand() * 100),
            High: Math.round(rand() * 150), Low: Math.round(rand() * 50),
        }));
        tests.push({
            title: 'Candlestick: categorical x (not temporal)',
            description: 'String x — candlestick expects date axis',
            tags: ['unintended', 'wrong-type'],
            chartType: 'Candlestick Chart',
            data,
            fields: [makeField('Item'), makeField('Open'), makeField('Close'), makeField('High'), makeField('Low')],
            metadata: {
                Item: { type: Type.String, semanticType: 'Category', levels: cats },
                Open: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Close: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                High: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Low: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Item'), y: makeEncodingItem('Close') },
        });
    }

    // Candlestick: high < low (inverted)
    {
        const dates = ['2024-01-01', '2024-01-02', '2024-01-03'];
        const data = dates.map(d => ({
            Date: d, Open: Math.round(50 + rand() * 50),
            Close: Math.round(50 + rand() * 50),
            High: Math.round(rand() * 30),        // intentionally low
            Low: Math.round(80 + rand() * 50),     // intentionally high
        }));
        tests.push({
            title: 'Candlestick: high < low (inverted)',
            description: 'High values less than low — nonsensical OHLC',
            tags: ['unintended', 'invalid-values'],
            chartType: 'Candlestick Chart',
            data,
            fields: [makeField('Date'), makeField('Open'), makeField('Close'), makeField('High'), makeField('Low')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Open: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Close: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                High: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Low: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Close') },
        });
    }

    return tests;
}
