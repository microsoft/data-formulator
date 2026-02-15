// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Discrete-axis sizing tests.
 *
 * For each major chart type, creates test cases at three cardinality levels
 * (20, 60, 120) designed for a 400×300 canvas.  This systematically exercises
 * the assembler's elastic stretch, overflow filtering, label rotation, and
 * step-based sizing across discrete X and discrete Y orientations.
 *
 * Cardinality rationale (400×300 canvas, ~20px default step):
 *   - 20 items:  fits comfortably, no compression needed
 *   - 60 items:  triggers elastic stretch, label rotation
 *   - 120 items: triggers overflow filtering (too many to show)
 */

import { TestCase, makeField, makeEncodingItem, buildMetadata } from './types';
import { seededRandom } from './generators';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cats(prefix: string, n: number): string[] {
    const pad = String(n).length;
    return Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(pad, '0')}`);
}

function randVal(rand: () => number, min = 10, max = 500): number {
    return Math.round(min + rand() * (max - min));
}

const SIZES = [
    { n: 20,  label: '20' },
    { n: 60,  label: '60' },
    { n: 120, label: '120' },
] as const;

// ---------------------------------------------------------------------------
// Bar Chart
// ---------------------------------------------------------------------------
function genBarSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(100);

    for (const { n, label } of SIZES) {
        // Discrete X
        const xCats = cats('Cat', n);
        const xData = xCats.map(c => ({ Category: c, Value: randVal(rand) }));
        tests.push({
            title: `Bar ▸ X ×${label}`,
            description: `Bar chart with ${n} categories on X axis`,
            tags: ['bar', 'discrete-x', `n${label}`],
            chartType: 'Bar Chart',
            data: xData,
            fields: [makeField('Category'), makeField('Value')],
            metadata: buildMetadata(xData),
            encodingMap: { x: makeEncodingItem('Category'), y: makeEncodingItem('Value') },
        });

        // Discrete Y
        const yCats = cats('Item', n);
        const yData = yCats.map(c => ({ Item: c, Revenue: randVal(rand) }));
        tests.push({
            title: `Bar ▸ Y ×${label}`,
            description: `Horizontal bar with ${n} categories on Y axis`,
            tags: ['bar', 'discrete-y', `n${label}`],
            chartType: 'Bar Chart',
            data: yData,
            fields: [makeField('Item'), makeField('Revenue')],
            metadata: buildMetadata(yData),
            encodingMap: { y: makeEncodingItem('Item'), x: makeEncodingItem('Revenue') },
        });
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Stacked Bar Chart
// ---------------------------------------------------------------------------
function genStackedBarSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(200);
    const segments = cats('Seg', 3);

    for (const { n, label } of SIZES) {
        // Discrete X
        {
            const categories = cats('City', n);
            const data: Record<string, any>[] = [];
            for (const c of categories) for (const s of segments) data.push({ City: c, Segment: s, Amount: randVal(rand) });
            tests.push({
                title: `Stacked Bar ▸ X ×${label}`,
                description: `Stacked bar with ${n} x-categories × 3 segments`,
                tags: ['stacked-bar', 'discrete-x', `n${label}`],
                chartType: 'Stacked Bar Chart',
                data,
                fields: [makeField('City'), makeField('Segment'), makeField('Amount')],
                metadata: buildMetadata(data),
                encodingMap: { x: makeEncodingItem('City'), y: makeEncodingItem('Amount'), color: makeEncodingItem('Segment') },
            });
        }

        // Discrete Y
        {
            const categories = cats('Dept', n);
            const data: Record<string, any>[] = [];
            for (const c of categories) for (const s of segments) data.push({ Dept: c, Segment: s, Budget: randVal(rand) });
            tests.push({
                title: `Stacked Bar ▸ Y ×${label}`,
                description: `Horizontal stacked bar with ${n} y-categories × 3 segments`,
                tags: ['stacked-bar', 'discrete-y', `n${label}`],
                chartType: 'Stacked Bar Chart',
                data,
                fields: [makeField('Dept'), makeField('Segment'), makeField('Budget')],
                metadata: buildMetadata(data),
                encodingMap: { y: makeEncodingItem('Dept'), x: makeEncodingItem('Budget'), color: makeEncodingItem('Segment') },
            });
        }
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Grouped Bar Chart
// ---------------------------------------------------------------------------
function genGroupedBarSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(300);
    const groups = cats('Grp', 3);

    for (const { n, label } of SIZES) {
        // Discrete X
        {
            const categories = cats('Cat', n);
            const data: Record<string, any>[] = [];
            for (const c of categories) for (const g of groups) data.push({ Category: c, Group: g, Value: randVal(rand) });
            tests.push({
                title: `Grouped Bar ▸ X ×${label}`,
                description: `Grouped bar with ${n} x-categories × 3 groups`,
                tags: ['grouped-bar', 'discrete-x', `n${label}`],
                chartType: 'Grouped Bar Chart',
                data,
                fields: [makeField('Category'), makeField('Group'), makeField('Value')],
                metadata: buildMetadata(data),
                encodingMap: { x: makeEncodingItem('Category'), y: makeEncodingItem('Value'), color: makeEncodingItem('Group') },
            });
        }

        // Discrete Y
        {
            const categories = cats('Region', n);
            const data: Record<string, any>[] = [];
            for (const c of categories) for (const g of groups) data.push({ Region: c, Group: g, Sales: randVal(rand) });
            tests.push({
                title: `Grouped Bar ▸ Y ×${label}`,
                description: `Horizontal grouped bar with ${n} y-categories × 3 groups`,
                tags: ['grouped-bar', 'discrete-y', `n${label}`],
                chartType: 'Grouped Bar Chart',
                data,
                fields: [makeField('Region'), makeField('Group'), makeField('Sales')],
                metadata: buildMetadata(data),
                encodingMap: { y: makeEncodingItem('Region'), x: makeEncodingItem('Sales'), color: makeEncodingItem('Group') },
            });
        }
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Scatter Plot
// ---------------------------------------------------------------------------
function genScatterSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(400);

    for (const { n, label } of SIZES) {
        // Discrete X
        {
            const categories = cats('Species', n);
            const pointsPer = 5;
            const data: Record<string, any>[] = [];
            for (const c of categories) for (let i = 0; i < pointsPer; i++) data.push({ Species: c, Weight: randVal(rand, 10, 200) });
            tests.push({
                title: `Scatter ▸ X ×${label}`,
                description: `Scatter with ${n} discrete categories on X`,
                tags: ['scatter', 'discrete-x', `n${label}`],
                chartType: 'Scatter Plot',
                data,
                fields: [makeField('Species'), makeField('Weight')],
                metadata: buildMetadata(data),
                encodingMap: { x: makeEncodingItem('Species'), y: makeEncodingItem('Weight') },
            });
        }

        // Discrete Y
        {
            const categories = cats('Lab', n);
            const pointsPer = 5;
            const data: Record<string, any>[] = [];
            for (const c of categories) for (let i = 0; i < pointsPer; i++) data.push({ Lab: c, Score: randVal(rand, 0, 100) });
            tests.push({
                title: `Scatter ▸ Y ×${label}`,
                description: `Scatter with ${n} discrete categories on Y`,
                tags: ['scatter', 'discrete-y', `n${label}`],
                chartType: 'Scatter Plot',
                data,
                fields: [makeField('Lab'), makeField('Score')],
                metadata: buildMetadata(data),
                encodingMap: { y: makeEncodingItem('Lab'), x: makeEncodingItem('Score') },
            });
        }
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Line Chart
// ---------------------------------------------------------------------------
function genLineSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(500);

    for (const { n, label } of SIZES) {
        // Discrete X (nominal categories)
        {
            const categories = cats('Step', n);
            const data = categories.map(c => ({ Step: c, Value: randVal(rand) }));
            tests.push({
                title: `Line ▸ X ×${label}`,
                description: `Line chart with ${n} discrete categories on X`,
                tags: ['line', 'discrete-x', `n${label}`],
                chartType: 'Line Chart',
                data,
                fields: [makeField('Step'), makeField('Value')],
                metadata: buildMetadata(data),
                encodingMap: { x: makeEncodingItem('Step'), y: makeEncodingItem('Value') },
            });
        }
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Area Chart
// ---------------------------------------------------------------------------
function genAreaSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(600);
    const series = cats('S', 3);

    for (const { n, label } of SIZES) {
        // Discrete X (nominal categories, stacked color)
        {
            const categories = cats('Period', n);
            const data: Record<string, any>[] = [];
            for (const c of categories) for (const s of series) data.push({ Period: c, Series: s, Value: randVal(rand, 5, 200) });
            tests.push({
                title: `Area ▸ X ×${label}`,
                description: `Stacked area with ${n} x-categories × 3 series`,
                tags: ['area', 'discrete-x', `n${label}`],
                chartType: 'Area Chart',
                data,
                fields: [makeField('Period'), makeField('Series'), makeField('Value')],
                metadata: buildMetadata(data),
                encodingMap: { x: makeEncodingItem('Period'), y: makeEncodingItem('Value'), color: makeEncodingItem('Series') },
            });
        }
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Lollipop Chart
// ---------------------------------------------------------------------------
function genLollipopSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(700);

    for (const { n, label } of SIZES) {
        // Discrete X
        {
            const categories = cats('Item', n);
            const data = categories.map(c => ({ Item: c, Value: randVal(rand) }));
            tests.push({
                title: `Lollipop ▸ X ×${label}`,
                description: `Lollipop with ${n} categories on X`,
                tags: ['lollipop', 'discrete-x', `n${label}`],
                chartType: 'Lollipop Chart',
                data,
                fields: [makeField('Item'), makeField('Value')],
                metadata: buildMetadata(data),
                encodingMap: { x: makeEncodingItem('Item'), y: makeEncodingItem('Value') },
            });
        }

        // Discrete Y
        {
            const categories = cats('Country', n);
            const data = categories.map(c => ({ Country: c, GDP: randVal(rand, 100, 5000) }));
            tests.push({
                title: `Lollipop ▸ Y ×${label}`,
                description: `Horizontal lollipop with ${n} categories on Y`,
                tags: ['lollipop', 'discrete-y', `n${label}`],
                chartType: 'Lollipop Chart',
                data,
                fields: [makeField('Country'), makeField('GDP')],
                metadata: buildMetadata(data),
                encodingMap: { y: makeEncodingItem('Country'), x: makeEncodingItem('GDP') },
            });
        }
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Heatmap (always discrete X + Y)
// ---------------------------------------------------------------------------
function genHeatmapSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(800);

    for (const { n, label } of SIZES) {
        const yN = Math.max(5, Math.round(n * 0.6));
        const xCats = cats('Col', n);
        const yCats = cats('Row', yN);
        const data: Record<string, any>[] = [];
        for (const x of xCats) for (const y of yCats) data.push({ Col: x, Row: y, Value: randVal(rand, 0, 100) });
        tests.push({
            title: `Heatmap ▸ XY ×${label}×${yN}`,
            description: `Heatmap with ${n} columns × ${yN} rows`,
            tags: ['heatmap', 'discrete-xy', `n${label}`],
            chartType: 'Heatmap',
            data,
            fields: [makeField('Col'), makeField('Row'), makeField('Value')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Col'), y: makeEncodingItem('Row'), color: makeEncodingItem('Value') },
        });
    }

    return tests;
}

// ---------------------------------------------------------------------------
// Boxplot
// ---------------------------------------------------------------------------
function genBoxplotSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(900);
    const pointsPer = 15;

    for (const { n, label } of SIZES) {
        // Discrete X
        {
            const categories = cats('Group', n);
            const data: Record<string, any>[] = [];
            for (const c of categories) for (let i = 0; i < pointsPer; i++) data.push({ Group: c, Value: randVal(rand, 0, 200) });
            tests.push({
                title: `Boxplot ▸ X ×${label}`,
                description: `Boxplot with ${n} groups on X`,
                tags: ['boxplot', 'discrete-x', `n${label}`],
                chartType: 'Boxplot',
                data,
                fields: [makeField('Group'), makeField('Value')],
                metadata: buildMetadata(data),
                encodingMap: { x: makeEncodingItem('Group'), y: makeEncodingItem('Value') },
            });
        }

        // Discrete Y
        {
            const categories = cats('Cat', n);
            const data: Record<string, any>[] = [];
            for (const c of categories) for (let i = 0; i < pointsPer; i++) data.push({ Category: c, Score: randVal(rand, 0, 100) });
            tests.push({
                title: `Boxplot ▸ Y ×${label}`,
                description: `Horizontal boxplot with ${n} groups on Y`,
                tags: ['boxplot', 'discrete-y', `n${label}`],
                chartType: 'Boxplot',
                data,
                fields: [makeField('Category'), makeField('Score')],
                metadata: buildMetadata(data),
                encodingMap: { y: makeEncodingItem('Category'), x: makeEncodingItem('Score') },
            });
        }
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Strip Plot
// ---------------------------------------------------------------------------
function genStripSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1000);
    const pointsPer = 10;

    for (const { n, label } of SIZES) {
        // Discrete X
        {
            const categories = cats('Species', n);
            const data: Record<string, any>[] = [];
            for (const c of categories) for (let i = 0; i < pointsPer; i++) data.push({ Species: c, Length: randVal(rand, 10, 80) });
            tests.push({
                title: `Strip ▸ X ×${label}`,
                description: `Strip plot with ${n} categories on X`,
                tags: ['strip', 'discrete-x', `n${label}`],
                chartType: 'Strip Plot',
                data,
                fields: [makeField('Species'), makeField('Length')],
                metadata: buildMetadata(data),
                encodingMap: { x: makeEncodingItem('Species'), y: makeEncodingItem('Length') },
            });
        }

        // Discrete Y
        {
            const categories = cats('Lab', n);
            const data: Record<string, any>[] = [];
            for (const c of categories) for (let i = 0; i < pointsPer; i++) data.push({ Lab: c, Result: randVal(rand, 0, 100) });
            tests.push({
                title: `Strip ▸ Y ×${label}`,
                description: `Horizontal strip with ${n} categories on Y`,
                tags: ['strip', 'discrete-y', `n${label}`],
                chartType: 'Strip Plot',
                data,
                fields: [makeField('Lab'), makeField('Result')],
                metadata: buildMetadata(data),
                encodingMap: { y: makeEncodingItem('Lab'), x: makeEncodingItem('Result') },
            });
        }
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Bump Chart
// ---------------------------------------------------------------------------
function genBumpSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1100);
    const teams = cats('Team', 5);

    for (const { n, label } of SIZES) {
        const steps = cats('Week', n);
        const data: Record<string, any>[] = [];
        for (const s of steps) for (const t of teams) data.push({ Week: s, Team: t, Rank: Math.floor(rand() * 5) + 1 });
        tests.push({
            title: `Bump ▸ X ×${label}`,
            description: `Bump chart with ${n} time steps × 5 teams`,
            tags: ['bump', 'discrete-x', `n${label}`],
            chartType: 'Bump Chart',
            data,
            fields: [makeField('Week'), makeField('Team'), makeField('Rank')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Week'), y: makeEncodingItem('Rank'), color: makeEncodingItem('Team') },
        });
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Pyramid Chart
// ---------------------------------------------------------------------------
function genPyramidSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1200);
    const genders = ['Male', 'Female'];

    for (const { n, label } of SIZES) {
        const ageBands = cats('Age', n);
        const data: Record<string, any>[] = [];
        for (const a of ageBands) for (const g of genders) data.push({ AgeGroup: a, Gender: g, Population: randVal(rand, 1000, 50000) });
        tests.push({
            title: `Pyramid ▸ Y ×${label}`,
            description: `Pyramid chart with ${n} age groups on Y`,
            tags: ['pyramid', 'discrete-y', `n${label}`],
            chartType: 'Pyramid Chart',
            data,
            fields: [makeField('AgeGroup'), makeField('Gender'), makeField('Population')],
            metadata: buildMetadata(data),
            encodingMap: { y: makeEncodingItem('AgeGroup'), x: makeEncodingItem('Population'), color: makeEncodingItem('Gender') },
        });
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Waterfall Chart
// ---------------------------------------------------------------------------
function genWaterfallSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1300);

    for (const { n, label } of SIZES) {
        const steps = cats('Step', n);
        const data = steps.map((s, i) => ({
            Step: s,
            Amount: i === 0 ? randVal(rand, 500, 1000) :
                i === n - 1 ? randVal(rand, 200, 800) :
                    (rand() > 0.5 ? 1 : -1) * randVal(rand, 10, 150),
            Type: i === 0 ? 'start' : i === n - 1 ? 'end' : 'delta',
        }));
        tests.push({
            title: `Waterfall ▸ X ×${label}`,
            description: `Waterfall with ${n} steps on X`,
            tags: ['waterfall', 'discrete-x', `n${label}`],
            chartType: 'Waterfall Chart',
            data,
            fields: [makeField('Step'), makeField('Amount'), makeField('Type')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Step'), y: makeEncodingItem('Amount'), color: makeEncodingItem('Type') },
        });
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Ranged Dot Plot
// ---------------------------------------------------------------------------
function genRangedDotSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1400);
    const phases = ['Before', 'After'];

    for (const { n, label } of SIZES) {
        const categories = cats('Metric', n);
        const data: Record<string, any>[] = [];
        for (const c of categories) for (const p of phases) data.push({ Metric: c, Phase: p, Score: randVal(rand, 20, 90) });
        tests.push({
            title: `Ranged Dot ▸ Y ×${label}`,
            description: `Ranged dot plot with ${n} categories on Y`,
            tags: ['ranged-dot', 'discrete-y', `n${label}`],
            chartType: 'Ranged Dot Plot',
            data,
            fields: [makeField('Metric'), makeField('Phase'), makeField('Score')],
            metadata: buildMetadata(data),
            encodingMap: { y: makeEncodingItem('Metric'), x: makeEncodingItem('Score'), color: makeEncodingItem('Phase') },
        });
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Pie Chart (discrete color)
// ---------------------------------------------------------------------------
function genPieSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1500);

    for (const { n, label } of SIZES) {
        const categories = cats('Slice', n);
        const data = categories.map(c => ({ Slice: c, Share: randVal(rand, 1, 100) }));
        tests.push({
            title: `Pie ▸ color ×${label}`,
            description: `Pie chart with ${n} slices`,
            tags: ['pie', 'discrete-color', `n${label}`],
            chartType: 'Pie Chart',
            data,
            fields: [makeField('Slice'), makeField('Share')],
            metadata: buildMetadata(data),
            encodingMap: { color: makeEncodingItem('Slice'), size: makeEncodingItem('Share') },
        });
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Radar Chart
// ---------------------------------------------------------------------------
function genRadarSizing(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1600);
    const entities = cats('E', 3);

    for (const { n, label } of SIZES) {
        const axes = cats('Axis', n);
        const data: Record<string, any>[] = [];
        for (const e of entities) for (const a of axes) data.push({ Metric: a, Entity: e, Score: randVal(rand, 10, 100) });
        tests.push({
            title: `Radar ▸ ×${label} axes`,
            description: `Radar chart with ${n} metric axes × 3 entities`,
            tags: ['radar', 'discrete-x', `n${label}`],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('Metric'), makeField('Entity'), makeField('Score')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Metric'), y: makeEncodingItem('Score'), color: makeEncodingItem('Entity') },
        });
    }
    return tests;
}

// ---------------------------------------------------------------------------
// Combined export
// ---------------------------------------------------------------------------
export function genDiscreteAxisTests(): TestCase[] {
    return [
        ...genBarSizing(),
        ...genStackedBarSizing(),
        ...genGroupedBarSizing(),
        ...genScatterSizing(),
        ...genLineSizing(),
        ...genAreaSizing(),
        ...genLollipopSizing(),
        ...genHeatmapSizing(),
        ...genBoxplotSizing(),
        ...genStripSizing(),
        ...genBumpSizing(),
        ...genPyramidSizing(),
        ...genWaterfallSizing(),
        ...genRangedDotSizing(),
        ...genPieSizing(),
        ...genRadarSizing(),
    ];
}
