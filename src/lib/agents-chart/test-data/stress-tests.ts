// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../../../data/types';
import { Channel, EncodingItem } from '../../../components/ComponentType';
import { AssembleOptions } from '../core/types';
import { TestCase, makeField, makeEncodingItem, buildMetadata } from './types';
import { seededRandom, genCategories } from './generators';

// ------ Overflow / Discrete Value Capping ------
export function genOverflowTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(777);

    // Helper: generate N category names
    const cats = (prefix: string, n: number) => {
        const pad = String(n).length;
        return Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(pad, '0')}`);
    };

    // ---- 1. Bar chart: increasing x cardinality ----
    for (const n of [50, 100, 150, 200]) {
        const categories = cats('Cat', n);
        const data = categories.map(c => ({ Category: c, Sales: Math.round(10 + rand() * 500) }));
        tests.push({
            title: `Bar — ${n} x-categories`,
            description: `Bar chart with ${n} discrete x values to test capping`,
            tags: ['overflow', 'bar', `n-${n}`],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Category'), makeField('Sales')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Category'), y: makeEncodingItem('Sales') },
        });
    }

    // ---- 2. Horizontal bar: increasing y cardinality ----
    for (const n of [50, 100, 200]) {
        const categories = cats('Item', n);
        const data = categories.map(c => ({ Item: c, Revenue: Math.round(10 + rand() * 800) }));
        tests.push({
            title: `Horiz Bar — ${n} y-categories`,
            description: `Horizontal bar chart with ${n} discrete y values`,
            tags: ['overflow', 'bar', 'horizontal', `n-${n}`],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Item'), makeField('Revenue')],
            metadata: buildMetadata(data),
            encodingMap: { y: makeEncodingItem('Item'), x: makeEncodingItem('Revenue') },
        });
    }

    // ---- 3. Grouped bar: x × color overflow ----
    for (const [xN, colorN] of [[30, 5], [50, 5], [80, 3], [50, 10]] as const) {
        const xCats = cats('Product', xN);
        const colors = cats('Region', colorN);
        const data: any[] = [];
        for (const x of xCats) {
            for (const c of colors) {
                data.push({ Product: x, Region: c, Sales: Math.round(10 + rand() * 400) });
            }
        }
        tests.push({
            title: `Grouped — ${xN}x × ${colorN}color`,
            description: `Grouped bar: ${xN} x-values × ${colorN} color groups = ${xN * colorN} sub-bars`,
            tags: ['overflow', 'grouped', `x-${xN}`, `color-${colorN}`],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Product'), makeField('Region'), makeField('Sales')],
            metadata: buildMetadata(data),
            encodingMap: {
                x: makeEncodingItem('Product'),
                y: makeEncodingItem('Sales'),
                group: makeEncodingItem('Region'),
            },
        });
    }

    // ---- 4. Stacked bar: many x values ----
    for (const n of [50, 150]) {
        const xCats = cats('City', n);
        const segments = cats('Seg', 3);
        const data: any[] = [];
        for (const x of xCats) {
            for (const s of segments) {
                data.push({ City: x, Segment: s, Amount: Math.round(10 + rand() * 300) });
            }
        }
        tests.push({
            title: `Stacked — ${n} x-categories`,
            description: `Stacked bar with ${n} x values and 3 segments`,
            tags: ['overflow', 'stacked', `n-${n}`],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('City'), makeField('Segment'), makeField('Amount')],
            metadata: buildMetadata(data),
            encodingMap: {
                x: makeEncodingItem('City'),
                y: makeEncodingItem('Amount'),
                color: makeEncodingItem('Segment'),
            },
        });
    }

    // ---- 5. Heatmap: large x × large y ----
    for (const [xN, yN] of [[30, 30], [80, 20], [50, 50]] as const) {
        const xCats = cats('Col', xN);
        const yCats = cats('Row', yN);
        const data: any[] = [];
        for (const x of xCats) {
            for (const y of yCats) {
                data.push({ Col: x, Row: y, Value: Math.round(rand() * 100) });
            }
        }
        tests.push({
            title: `Heatmap — ${xN}x × ${yN}y`,
            description: `Heatmap with ${xN}×${yN} = ${xN * yN} cells`,
            tags: ['overflow', 'heatmap', `x-${xN}`, `y-${yN}`],
            chartType: 'Heatmap',
            data,
            fields: [makeField('Col'), makeField('Row'), makeField('Value')],
            metadata: buildMetadata(data),
            encodingMap: {
                x: makeEncodingItem('Col'),
                y: makeEncodingItem('Row'),
                color: makeEncodingItem('Value'),
            },
        });
    }

    // ---- 6. Large color cardinality (numeric on color) ----
    {
        const countries = cats('Country', 5);
        const data: any[] = [];
        for (const c of countries) {
            for (let age = 15; age <= 85; age++) {
                data.push({ Country: c, Age: age, Count: Math.round(50 + rand() * 200) });
            }
        }
        tests.push({
            title: `Color overflow — 71 numeric values`,
            description: `Age 15-85 on color channel (71 unique values)`,
            tags: ['overflow', 'color', 'numeric-color'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Country'), makeField('Age'), makeField('Count')],
            metadata: buildMetadata(data),
            encodingMap: {
                x: makeEncodingItem('Country'),
                y: makeEncodingItem('Count'),
                color: makeEncodingItem('Age'),
            },
        });
    }

    // ---- 7. Boxplot with many categories ----
    for (const n of [50, 120]) {
        const categories = cats('Group', n);
        const data: any[] = [];
        for (const c of categories) {
            for (let i = 0; i < 10; i++) {
                data.push({ Group: c, Score: Math.round(rand() * 100) });
            }
        }
        tests.push({
            title: `Boxplot — ${n} groups`,
            description: `Boxplot with ${n} discrete groups on x-axis`,
            tags: ['overflow', 'boxplot', `n-${n}`],
            chartType: 'Boxplot',
            data,
            fields: [makeField('Group'), makeField('Score')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Group'), y: makeEncodingItem('Score') },
        });
    }

    // ---- 8. Faceted + overflow within subplots ----
    {
        const regions = cats('Region', 4);
        const products = cats('Prod', 80);
        const data: any[] = [];
        for (const r of regions) {
            for (const p of products) {
                data.push({ Region: r, Product: p, Sales: Math.round(10 + rand() * 500) });
            }
        }
        tests.push({
            title: `Facet + 80 x-categories`,
            description: `4 column facets each with 80 x-categories`,
            tags: ['overflow', 'facet', 'n-80'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Region'), makeField('Product'), makeField('Sales')],
            metadata: buildMetadata(data),
            encodingMap: {
                column: makeEncodingItem('Region'),
                x: makeEncodingItem('Product'),
                y: makeEncodingItem('Sales'),
            },
        });
    }

    // ---- 9. Many facet columns with small discrete x ----
    for (const [facetN, xN] of [[8, 3], [12, 4], [15, 2], [20, 3]] as const) {
        const facets = cats('Panel', facetN);
        const xCats = cats('Type', xN);
        const data: any[] = [];
        for (const f of facets) {
            for (const x of xCats) {
                data.push({ Panel: f, Type: x, Value: Math.round(10 + rand() * 300) });
            }
        }
        tests.push({
            title: `${facetN} facets × ${xN} x-bars`,
            description: `${facetN} column facets, each with only ${xN} x-categories — thin subplots`,
            tags: ['overflow', 'facet', 'thin', `facet-${facetN}`, `x-${xN}`],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Panel'), makeField('Type'), makeField('Value')],
            metadata: buildMetadata(data),
            encodingMap: {
                column: makeEncodingItem('Panel'),
                x: makeEncodingItem('Type'),
                y: makeEncodingItem('Value'),
            },
        });
    }

    return tests;
}

// ------ Elasticity & Stretch Comparison ------
export function genElasticityTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(999);

    // ========== Helper to build a bar-chart test case with given layout ==========
    function makeBarTest(
        title: string,
        description: string,
        tags: string[],
        xCategories: string[],
        assembleOptions: AssembleOptions,
        facetCategories?: string[],
    ): TestCase {
        const data: Record<string, any>[] = [];
        if (facetCategories) {
            for (const f of facetCategories) {
                for (const x of xCategories) {
                    data.push({ Panel: f, Category: x, Value: Math.round(10 + rand() * 500) });
                }
            }
        } else {
            for (const x of xCategories) {
                data.push({ Category: x, Value: Math.round(10 + rand() * 500) });
            }
        }

        const fields = facetCategories
            ? [makeField('Panel'), makeField('Category'), makeField('Value')]
            : [makeField('Category'), makeField('Value')];

        const encodingMap: Partial<Record<Channel, EncodingItem>> = {
            x: makeEncodingItem('Category'),
            y: makeEncodingItem('Value'),
        };
        if (facetCategories) {
            encodingMap.column = makeEncodingItem('Panel');
        }

        return {
            title,
            description,
            tags,
            chartType: 'Bar Chart',
            data,
            fields,
            metadata: buildMetadata(data),
            encodingMap,
            assembleOptions,
        };
    }

    // =========================================================================
    // Group A: Axis-only (no facets) — compare elasticity / maxStretch
    // =========================================================================
    const mediumCategories = genCategories('Country', 15);
    const largeCategories = genCategories('Name', 30);

    // A1: 15 x-categories — default
    tests.push(makeBarTest(
        '15 bars — default (e=0.5, s=2)',
        '15 x-categories, default axis elasticity & stretch',
        ['axis-only', 'medium', 'default'],
        mediumCategories,
        { elasticity: 0.5, maxStretch: 2 },
    ));

    // A2: 15 x-categories — low elasticity
    tests.push(makeBarTest(
        '15 bars — low axis (e=0.2, s=1.2)',
        '15 x-categories, conservative axis stretch',
        ['axis-only', 'medium', 'low'],
        mediumCategories,
        { elasticity: 0.2, maxStretch: 1.2 },
    ));

    // A3: 15 x-categories — high elasticity
    tests.push(makeBarTest(
        '15 bars — high axis (e=0.8, s=3)',
        '15 x-categories, aggressive axis stretch',
        ['axis-only', 'medium', 'high'],
        mediumCategories,
        { elasticity: 0.8, maxStretch: 3 },
    ));

    // A4: 30 x-categories — default
    tests.push(makeBarTest(
        '30 bars — default (e=0.5, s=2)',
        '30 x-categories, default axis elasticity & stretch',
        ['axis-only', 'large', 'default'],
        largeCategories,
        { elasticity: 0.5, maxStretch: 2 },
    ));

    // A5: 30 x-categories — low
    tests.push(makeBarTest(
        '30 bars — low axis (e=0.2, s=1.2)',
        '30 x-categories, conservative axis stretch',
        ['axis-only', 'large', 'low'],
        largeCategories,
        { elasticity: 0.2, maxStretch: 1.2 },
    ));

    // A6: 30 x-categories — high
    tests.push(makeBarTest(
        '30 bars — high axis (e=0.8, s=3)',
        '30 x-categories, aggressive axis stretch',
        ['axis-only', 'large', 'high'],
        largeCategories,
        { elasticity: 0.8, maxStretch: 3 },
    ));

    // =========================================================================
    // Group B: Facet + axis — compare facet vs axis params independently
    // =========================================================================
    const facets8 = genCategories('Department', 8);
    const bars5 = genCategories('Category', 5);
    const facets12 = genCategories('Company', 12);
    const bars8 = genCategories('Category', 8);

    // B1: 8 facets × 5 bars — all defaults
    tests.push(makeBarTest(
        '8F × 5B — all default',
        '8 column facets, 5 bars each, default axis & facet settings',
        ['facet+axis', 'default'],
        bars5,
        { elasticity: 0.5, maxStretch: 2, facetElasticity: 0.3, facetMaxStretch: 1.5 },
        facets8,
    ));

    // B2: 8 facets × 5 bars — conservative facet, default axis
    tests.push(makeBarTest(
        '8F × 5B — conservative facet (fe=0.15, fs=1.2)',
        '8 column facets, 5 bars, conservative facet stretch, default axis',
        ['facet+axis', 'conservative-facet'],
        bars5,
        { elasticity: 0.5, maxStretch: 2, facetElasticity: 0.15, facetMaxStretch: 1.2 },
        facets8,
    ));

    // B3: 8 facets × 5 bars — aggressive facet, default axis
    tests.push(makeBarTest(
        '8F × 5B — aggressive facet (fe=0.6, fs=2.5)',
        '8 column facets, 5 bars, aggressive facet stretch, default axis',
        ['facet+axis', 'aggressive-facet'],
        bars5,
        { elasticity: 0.5, maxStretch: 2, facetElasticity: 0.6, facetMaxStretch: 2.5 },
        facets8,
    ));

    // B4: 12 facets × 8 bars — all defaults
    tests.push(makeBarTest(
        '12F × 8B — all default',
        '12 column facets, 8 bars each, default settings',
        ['facet+axis', 'large', 'default'],
        bars8,
        { elasticity: 0.5, maxStretch: 2, facetElasticity: 0.3, facetMaxStretch: 1.5 },
        facets12,
    ));

    // B5: 12 facets × 8 bars — conservative facet, aggressive axis
    tests.push(makeBarTest(
        '12F × 8B — tight facet (fe=0.15, fs=1.2), wide axis (e=0.8, s=3)',
        '12 facets, 8 bars, conservative facet + aggressive axis',
        ['facet+axis', 'large', 'mixed-tight-facet'],
        bars8,
        { elasticity: 0.8, maxStretch: 3, facetElasticity: 0.15, facetMaxStretch: 1.2 },
        facets12,
    ));

    // B6: 12 facets × 8 bars — aggressive facet, conservative axis
    tests.push(makeBarTest(
        '12F × 8B — wide facet (fe=0.6, fs=2.5), tight axis (e=0.2, s=1.2)',
        '12 facets, 8 bars, aggressive facet + conservative axis',
        ['facet+axis', 'large', 'mixed-wide-facet'],
        bars8,
        { elasticity: 0.2, maxStretch: 1.2, facetElasticity: 0.6, facetMaxStretch: 2.5 },
        facets12,
    ));

    // B7: 8 facets × 5 bars — no stretch at all
    tests.push(makeBarTest(
        '8F × 5B — no stretch (all 1.0)',
        '8 column facets, 5 bars, stretch disabled',
        ['facet+axis', 'no-stretch'],
        bars5,
        { elasticity: 0, maxStretch: 1, facetElasticity: 0, facetMaxStretch: 1 },
        facets8,
    ));

    return tests;
}
