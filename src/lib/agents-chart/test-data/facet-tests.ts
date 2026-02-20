// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../../../data/types';
import { Channel, EncodingItem } from '../../../components/ComponentType';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genCategories } from './generators';

/** Facet cardinality sizes */
export const FACET_SIZES = { S: 2, M: 4, L: 8, XL: 12 } as const;
/** Discrete axis cardinality sizes */
export const DISCRETE_SIZES = { S: 4, M: 8, L: 20, XL: 50 } as const;

/**
 * Generate facet test cases for a given facet mode (column, row, or column+row).
 * For each combination of facetSize × axisType:
 *   - Continuous × Continuous (scatter in each facet)
 *   - Continuous × Discrete-S/M/L/XL (bar in each facet)
 */
export function genFacetTests(
    mode: 'column' | 'row' | 'column+row',
): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(mode === 'column' ? 500 : mode === 'row' ? 600 : 700);

    const facetSizeEntries = Object.entries(FACET_SIZES) as [string, number][];
    const discreteSizeEntries = Object.entries(DISCRETE_SIZES) as [string, number][];

    for (const [facetLabel, facetCount] of facetSizeEntries) {
        // For column+row mode, split facetCount across columns and rows
        let colCount: number, rowCount: number;
        if (mode === 'column+row') {
            colCount = Math.max(2, Math.ceil(Math.sqrt(facetCount)));
            rowCount = Math.max(2, Math.ceil(facetCount / colCount));
        } else {
            colCount = facetCount;
            rowCount = facetCount;
        }

        const facetDesc = mode === 'column+row'
            ? `${colCount} cols × ${rowCount} rows`
            : `${facetCount} facets`;

        // --- 1. Continuous × Continuous (scatter) ---
        {
            const facetVals = mode === 'column+row'
                ? null  // handled separately
                : genCategories('Region', mode === 'column' ? colCount : rowCount);
            const colVals = mode === 'column+row' ? genCategories('Region', colCount) : undefined;
            const rowVals = mode === 'column+row' ? genCategories('Zone', rowCount) : undefined;

            const data: any[] = [];
            const pointsPerFacet = 20;

            if (mode === 'column+row') {
                for (const c of colVals!) for (const r of rowVals!) {
                    for (let i = 0; i < pointsPerFacet; i++) {
                        data.push({
                            X: Math.round(10 + rand() * 90),
                            Y: Math.round(10 + rand() * 90),
                            Col: c,
                            Row: r,
                        });
                    }
                }
            } else {
                for (const f of facetVals!) {
                    for (let i = 0; i < pointsPerFacet; i++) {
                        data.push({
                            X: Math.round(10 + rand() * 90),
                            Y: Math.round(10 + rand() * 90),
                            Facet: f,
                        });
                    }
                }
            }

            const encodingMap: Partial<Record<Channel, EncodingItem>> = {
                x: makeEncodingItem('X'),
                y: makeEncodingItem('Y'),
            };
            const fields = [makeField('X'), makeField('Y')];
            const metadata: Record<string, any> = {
                X: { type: Type.Number, semanticType: 'Value', levels: [] },
                Y: { type: Type.Number, semanticType: 'Value', levels: [] },
            };

            if (mode === 'column+row') {
                encodingMap.column = makeEncodingItem('Col');
                encodingMap.row = makeEncodingItem('Row');
                fields.push(makeField('Col'), makeField('Row'));
                metadata['Col'] = { type: Type.String, semanticType: 'Category', levels: colVals };
                metadata['Row'] = { type: Type.String, semanticType: 'Category', levels: rowVals };
            } else if (mode === 'column') {
                encodingMap.column = makeEncodingItem('Facet');
                fields.push(makeField('Facet'));
                metadata['Facet'] = { type: Type.String, semanticType: 'Category', levels: facetVals };
            } else {
                encodingMap.row = makeEncodingItem('Facet');
                fields.push(makeField('Facet'));
                metadata['Facet'] = { type: Type.String, semanticType: 'Category', levels: facetVals };
            }

            tests.push({
                title: `Cont × Cont — facet ${facetLabel} (${facetDesc})`,
                description: `Scatter plot with ${facetDesc}`,
                tags: ['quantitative', 'facet', facetLabel.toLowerCase()],
                chartType: 'Scatter Plot',
                data,
                fields,
                metadata,
                encodingMap,
            });
        }

        // --- 2. Continuous × Discrete (bar chart) ---
        for (const [discLabel, discCount] of discreteSizeEntries) {
            const categories = genCategories('Item', discCount);
            const facetVals = mode === 'column+row'
                ? null
                : genCategories('Region', mode === 'column' ? colCount : rowCount);
            const colVals = mode === 'column+row' ? genCategories('Region', colCount) : undefined;
            const rowVals = mode === 'column+row' ? genCategories('Zone', rowCount) : undefined;

            const data: any[] = [];

            if (mode === 'column+row') {
                for (const c of colVals!) for (const r of rowVals!) {
                    for (const cat of categories) {
                        data.push({
                            Category: cat,
                            Value: Math.round(50 + rand() * 500),
                            Col: c,
                            Row: r,
                        });
                    }
                }
            } else {
                for (const f of facetVals!) {
                    for (const cat of categories) {
                        data.push({
                            Category: cat,
                            Value: Math.round(50 + rand() * 500),
                            Facet: f,
                        });
                    }
                }
            }

            const encodingMap: Partial<Record<Channel, EncodingItem>> = {
                x: makeEncodingItem('Category'),
                y: makeEncodingItem('Value'),
            };
            const fields = [makeField('Category'), makeField('Value')];
            const metadata: Record<string, any> = {
                Category: { type: Type.String, semanticType: 'Category', levels: categories },
                Value: { type: Type.Number, semanticType: 'Revenue', levels: [] },
            };

            if (mode === 'column+row') {
                encodingMap.column = makeEncodingItem('Col');
                encodingMap.row = makeEncodingItem('Row');
                fields.push(makeField('Col'), makeField('Row'));
                metadata['Col'] = { type: Type.String, semanticType: 'Category', levels: colVals };
                metadata['Row'] = { type: Type.String, semanticType: 'Category', levels: rowVals };
            } else if (mode === 'column') {
                encodingMap.column = makeEncodingItem('Facet');
                fields.push(makeField('Facet'));
                metadata['Facet'] = { type: Type.String, semanticType: 'Category', levels: facetVals };
            } else {
                encodingMap.row = makeEncodingItem('Facet');
                fields.push(makeField('Facet'));
                metadata['Facet'] = { type: Type.String, semanticType: 'Category', levels: facetVals };
            }

            tests.push({
                title: `Cont × Disc-${discLabel} — facet ${facetLabel} (${facetDesc})`,
                description: `Bar chart: ${discCount} categories × ${facetDesc}`,
                tags: ['nominal', 'quantitative', 'facet', facetLabel.toLowerCase(), `disc-${discLabel.toLowerCase()}`],
                chartType: 'Bar Chart',
                data,
                fields,
                metadata,
                encodingMap,
            });
        }
    }

    return tests;
}

export function genFacetColumnTests(): TestCase[] { return genFacetTests('column'); }
export function genFacetRowTests(): TestCase[] { return genFacetTests('row'); }
export function genFacetColRowTests(): TestCase[] { return genFacetTests('column+row'); }

// ============================================================================
// Targeted Facet Tests
// ============================================================================

/**
 * Helper: build a facet test case from parameters.
 */
function buildFacetTest(opts: {
    title: string;
    description: string;
    tags: string[];
    chartType: string;
    colCount?: number;
    rowCount?: number;
    xCategories: string[];
    yIsContinuous: boolean;
    seed: number;
}): TestCase {
    const { title, description, tags, chartType, colCount, rowCount, xCategories, yIsContinuous, seed } = opts;
    const rand = seededRandom(seed);
    const colVals = colCount ? genCategories('Region', colCount) : undefined;
    const rowVals = rowCount ? genCategories('Zone', rowCount) : undefined;

    const data: Record<string, any>[] = [];
    const facets: { col?: string; row?: string }[] = [];

    if (colVals && rowVals) {
        for (const c of colVals) for (const r of rowVals) facets.push({ col: c, row: r });
    } else if (colVals) {
        for (const c of colVals) facets.push({ col: c });
    } else if (rowVals) {
        for (const r of rowVals) facets.push({ row: r });
    }

    for (const facet of facets) {
        if (yIsContinuous) {
            // Scatter: continuous × continuous
            for (let i = 0; i < 15; i++) {
                data.push({
                    X: Math.round(10 + rand() * 90),
                    Y: Math.round(10 + rand() * 90),
                    ...(facet.col != null ? { Col: facet.col } : {}),
                    ...(facet.row != null ? { Row: facet.row } : {}),
                });
            }
        } else {
            // Bar: discrete × continuous
            for (const cat of xCategories) {
                data.push({
                    Category: cat,
                    Value: Math.round(50 + rand() * 500),
                    ...(facet.col != null ? { Col: facet.col } : {}),
                    ...(facet.row != null ? { Row: facet.row } : {}),
                });
            }
        }
    }

    const encodingMap: Partial<Record<Channel, EncodingItem>> = {};
    const fields: ReturnType<typeof makeField>[] = [];
    const metadata: Record<string, any> = {};

    if (yIsContinuous) {
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

    return { title, description, tags, chartType, data, fields, metadata, encodingMap };
}

/**
 * 1. Small facet counts — columns only, rows only, and col×row.
 *    Should render comfortably without wrapping or clipping.
 */
export function genFacetSmallTests(): TestCase[] {
    const cats = ['A', 'B', 'C', 'D'];
    return [
        // 2 columns, bar
        buildFacetTest({
            title: '2 Columns — Bar',
            description: '2 column facets, 4 bars each. Should fit side-by-side easily.',
            tags: ['facet', 'column', 'small', 'bar'],
            chartType: 'Bar Chart',
            colCount: 2,
            xCategories: cats,
            yIsContinuous: false,
            seed: 1200,
        }),
        // 3 columns, scatter
        buildFacetTest({
            title: '3 Columns — Scatter',
            description: '3 column facets with scatter plots.',
            tags: ['facet', 'column', 'small', 'scatter'],
            chartType: 'Scatter Plot',
            colCount: 3,
            xCategories: [],
            yIsContinuous: true,
            seed: 1201,
        }),
        // 2 rows, bar
        buildFacetTest({
            title: '2 Rows — Bar',
            description: '2 row facets, 4 bars each. Should stack vertically.',
            tags: ['facet', 'row', 'small', 'bar'],
            chartType: 'Bar Chart',
            rowCount: 2,
            xCategories: cats,
            yIsContinuous: false,
            seed: 1202,
        }),
        // 3 rows, scatter
        buildFacetTest({
            title: '3 Rows — Scatter',
            description: '3 row facets with scatter plots.',
            tags: ['facet', 'row', 'small', 'scatter'],
            chartType: 'Scatter Plot',
            rowCount: 3,
            xCategories: [],
            yIsContinuous: true,
            seed: 1203,
        }),
        // 2×2 col×row, bar
        buildFacetTest({
            title: '2×2 Col×Row — Bar',
            description: '2 columns × 2 rows = 4 facet panels (bar chart).',
            tags: ['facet', 'colrow', 'small', 'bar'],
            chartType: 'Bar Chart',
            colCount: 2,
            rowCount: 2,
            xCategories: cats,
            yIsContinuous: false,
            seed: 1204,
        }),
        // 2×3 col×row, scatter
        buildFacetTest({
            title: '2×3 Col×Row — Scatter',
            description: '2 columns × 3 rows = 6 facet panels (scatter).',
            tags: ['facet', 'colrow', 'small', 'scatter'],
            chartType: 'Scatter Plot',
            colCount: 2,
            rowCount: 3,
            xCategories: [],
            yIsContinuous: true,
            seed: 1205,
        }),
    ];
}

/**
 * 2. Larger column counts that require horizontal wrapping.
 *    6-8 columns should exceed the default ~400px subplot width.
 */
export function genFacetWrapTests(): TestCase[] {
    const cats = ['A', 'B', 'C'];
    return [
        // 6 columns, bar
        buildFacetTest({
            title: '6 Columns — Bar (needs wrap)',
            description: '6 column facets × 3 bars. Should require horizontal wrapping or scrolling.',
            tags: ['facet', 'column', 'wrap', 'bar'],
            chartType: 'Bar Chart',
            colCount: 6,
            xCategories: cats,
            yIsContinuous: false,
            seed: 1210,
        }),
        // 8 columns, scatter
        buildFacetTest({
            title: '8 Columns — Scatter (needs wrap)',
            description: '8 column facets with scatter plots. Tests horizontal overflow.',
            tags: ['facet', 'column', 'wrap', 'scatter'],
            chartType: 'Scatter Plot',
            colCount: 8,
            xCategories: [],
            yIsContinuous: true,
            seed: 1211,
        }),
        // 10 columns, bar with more categories
        buildFacetTest({
            title: '10 Columns — Bar (heavy wrap)',
            description: '10 column facets × 3 bars each. Extreme horizontal wrap test.',
            tags: ['facet', 'column', 'wrap', 'heavy', 'bar'],
            chartType: 'Bar Chart',
            colCount: 10,
            xCategories: cats,
            yIsContinuous: false,
            seed: 1212,
        }),
    ];
}

/**
 * 3. Large col×row grids that require clipping/scrolling.
 *    Many panels stress the layout engine.
 */
export function genFacetClipTests(): TestCase[] {
    const cats = ['A', 'B', 'C'];
    return [
        // 4×3 = 12 panels
        buildFacetTest({
            title: '4×3 Col×Row — Bar (12 panels)',
            description: '4 columns × 3 rows = 12 facet panels. Tests dense grid layout.',
            tags: ['facet', 'colrow', 'clip', 'bar'],
            chartType: 'Bar Chart',
            colCount: 4,
            rowCount: 3,
            xCategories: cats,
            yIsContinuous: false,
            seed: 1220,
        }),
        // 5×4 = 20 panels, scatter
        buildFacetTest({
            title: '5×4 Col×Row — Scatter (20 panels)',
            description: '5 columns × 4 rows = 20 facet panels. Heavy grid requiring clip.',
            tags: ['facet', 'colrow', 'clip', 'scatter'],
            chartType: 'Scatter Plot',
            colCount: 5,
            rowCount: 4,
            xCategories: [],
            yIsContinuous: true,
            seed: 1221,
        }),
        // 6×5 = 30 panels
        buildFacetTest({
            title: '6×5 Col×Row — Bar (30 panels)',
            description: '6 columns × 5 rows = 30 facet panels. Extreme grid test.',
            tags: ['facet', 'colrow', 'clip', 'heavy', 'bar'],
            chartType: 'Bar Chart',
            colCount: 6,
            rowCount: 5,
            xCategories: cats,
            yIsContinuous: false,
            seed: 1222,
        }),
        // 8 rows, scatter — vertical clip
        buildFacetTest({
            title: '8 Rows — Scatter (vertical clip)',
            description: '8 row facets with scatter plots. Tests vertical overflow.',
            tags: ['facet', 'row', 'clip', 'scatter'],
            chartType: 'Scatter Plot',
            rowCount: 8,
            xCategories: [],
            yIsContinuous: true,
            seed: 1223,
        }),
    ];
}

// ============================================================================
// Overflowed Facet Tests
// ============================================================================

/**
 * Helper: build a facet overflow test with many column facets
 * and a banded (discrete) x-axis with `xCount` values.
 */
function buildOverflowFacetTest(opts: {
    title: string;
    description: string;
    tags: string[];
    chartType: string;
    colCount?: number;
    rowCount?: number;
    /** Number of banded/discrete x values per facet panel */
    xBandedCount?: number;
    /** If true, use continuous x × y (scatter) instead of discrete x */
    continuousXY?: boolean;
    seed: number;
}): TestCase {
    const { title, description, tags, chartType, colCount, rowCount, xBandedCount, continuousXY, seed } = opts;
    const rand = seededRandom(seed);
    const colVals = colCount ? genCategories('Region', colCount) : undefined;
    const rowVals = rowCount ? genCategories('Zone', rowCount) : undefined;

    const data: Record<string, any>[] = [];
    const facets: { col?: string; row?: string }[] = [];

    if (colVals && rowVals) {
        for (const c of colVals) for (const r of rowVals) facets.push({ col: c, row: r });
    } else if (colVals) {
        for (const c of colVals) facets.push({ col: c });
    } else if (rowVals) {
        for (const r of rowVals) facets.push({ row: r });
    }

    const xCategories = xBandedCount ? genCategories('Item', xBandedCount) : [];

    for (const facet of facets) {
        if (continuousXY) {
            for (let i = 0; i < 20; i++) {
                data.push({
                    X: Math.round(10 + rand() * 90),
                    Y: Math.round(10 + rand() * 90),
                    ...(facet.col != null ? { Col: facet.col } : {}),
                    ...(facet.row != null ? { Row: facet.row } : {}),
                });
            }
        } else {
            for (const cat of xCategories) {
                data.push({
                    Category: cat,
                    Value: Math.round(50 + rand() * 500),
                    ...(facet.col != null ? { Col: facet.col } : {}),
                    ...(facet.row != null ? { Row: facet.row } : {}),
                });
            }
        }
    }

    const encodingMap: Partial<Record<Channel, EncodingItem>> = {};
    const fields: ReturnType<typeof makeField>[] = [];
    const metadata: Record<string, any> = {};

    if (continuousXY) {
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

    return { title, description, tags, chartType, data, fields, metadata, encodingMap };
}

/**
 * Overflowed Column facets — enough column facet values that the layout
 * must clip/wrap, combined with discrete (banded) or continuous axes.
 *
 * Tests that computeFacetGrid correctly caps and wraps column-only facets.
 */
export function genFacetOverflowedColTests(): TestCase[] {
    return [
        // 20 columns with 30 discrete x values each — banded axis makes
        // each subplot wide, so far fewer columns fit than with continuous.
        buildOverflowFacetTest({
            title: '20 Cols × 30 Discrete — Bar (banded overflow)',
            description: '20 column facets, 30 bars each. Banded x-axis forces wide subplots — heavy overflow + wrap.',
            tags: ['facet', 'column', 'overflow', 'banded', 'bar'],
            chartType: 'Bar Chart',
            colCount: 20,
            xBandedCount: 30,
            seed: 1300,
        }),
        // 20 columns with continuous x × y — smaller subplots fit more columns.
        buildOverflowFacetTest({
            title: '20 Cols — Scatter (continuous overflow)',
            description: '20 column facets with scatter plots. Continuous axes allow more columns before overflow.',
            tags: ['facet', 'column', 'overflow', 'continuous', 'scatter'],
            chartType: 'Scatter Plot',
            colCount: 20,
            continuousXY: true,
            seed: 1301,
        }),
    ];
}

/**
 * Overflowed Column + Row facets — both dimensions exceed comfortable
 * capacity, requiring independent capping on each axis.
 *
 * With canvas 400×300 and minSubplotSize 60:
 *   - 20 bars → minSubplotWidth = max(60, 20×6) = 120 → maxFacetCols = floor(600/120) = 5
 *   - continuous y → minSubplotHeight = 60 → maxFacetRows = floor(450/60) = 7
 *   So 8 cols clips to 5, 10 rows clips to 7.
 */
export function genFacetOverflowedColRowTests(): TestCase[] {
    return [
        // 8 cols × 10 rows, 20 bars each → clips to ~5×7.
        buildOverflowFacetTest({
            title: '8×10 Col×Row × 20 Bars (overflow both)',
            description: '8 columns × 10 rows, 20 bars each. Both dimensions overflow: cols clip to ~5, rows to ~7.',
            tags: ['facet', 'colrow', 'overflow', 'bar'],
            chartType: 'Bar Chart',
            colCount: 8,
            rowCount: 10,
            xBandedCount: 20,
            seed: 1310,
        }),
        // 15 cols × 12 rows, scatter → clips to ~10×7 (continuous needs only 60px).
        buildOverflowFacetTest({
            title: '15×12 Col×Row — Scatter (extreme overflow)',
            description: '15 columns × 12 rows = 180 panels (scatter). Both dimensions far exceed budget.',
            tags: ['facet', 'colrow', 'overflow', 'extreme', 'scatter'],
            chartType: 'Scatter Plot',
            colCount: 15,
            rowCount: 12,
            continuousXY: true,
            seed: 1311,
        }),
    ];
}

/**
 * Overflowed Row facets — enough row facet values that the layout
 * must clip vertically.
 */
export function genFacetOverflowedRowTests(): TestCase[] {
    return [
        // 15 rows with 10 bars each.
        buildOverflowFacetTest({
            title: '15 Rows — Bar (row overflow)',
            description: '15 row facets, 10 bars each. Vertical overflow requiring row clipping.',
            tags: ['facet', 'row', 'overflow', 'bar'],
            chartType: 'Bar Chart',
            rowCount: 15,
            xBandedCount: 10,
            seed: 1320,
        }),
        // 12 rows, scatter — vertical overflow.
        buildOverflowFacetTest({
            title: '12 Rows — Scatter (row overflow)',
            description: '12 row facets with scatter plots. Tests vertical clipping.',
            tags: ['facet', 'row', 'overflow', 'scatter'],
            chartType: 'Scatter Plot',
            rowCount: 12,
            continuousXY: true,
            seed: 1321,
        }),
    ];
}
