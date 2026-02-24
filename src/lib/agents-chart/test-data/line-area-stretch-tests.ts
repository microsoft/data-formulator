// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Line & Area chart stretch stress tests.
 *
 * Covers 5 scenarios × 2 chart types + boundary cases + vertical (flipped) variants.
 *
 * Scenarios:
 *   A. Many X positions, few series     (200 dates × 3 series = 600 pts)
 *   B. Few X positions, many series     (12 dates × 20 series = 240 pts)
 *   C. Many X positions, many series    (200 dates × 20 series = 4000 pts)
 *   D. Moderate X, 40 series            (100 dates × 40 series = 4000 pts)
 *   E. Moderate X, 60 series            (100 dates × 60 series = 6000 pts)
 *
 * Current line/area params:  { x: 100, y: 20, seriesCountAxis: 'auto' }
 * Default elasticity: 0.3, maxStretch: 1.5
 *
 * Expected stretch (base canvas 400×300):
 *
 *  Scenario A (200×3):
 *    X: uniqueX=200, σ1d=√100=10 → pressure=200×10/400=5.0 → 5.0^0.3=1.62 → capped 1.5
 *    Y: nSeries=3, σ_y=20        → pressure=3×20/300=0.20  → <1, no stretch
 *    → width=600, height=300     ✓ X-only stretch
 *
 *  Scenario B (12×20):
 *    X: uniqueX=12, σ1d=10       → pressure=12×10/400=0.30 → <1, no stretch
 *    Y: nSeries=20, σ_y=20       → pressure=20×20/300=1.33 → 1.33^0.3=1.09
 *    → width=400, height=328     ✓ Mild Y stretch
 *
 *  Scenario C (200×20):
 *    X: pressure=5.0 → capped 1.5
 *    Y: nSeries=20   → pressure=1.33 → 1.09
 *    → width=600, height=328     ✓ X dominant
 *
 *  Scenario D (100×40):
 *    X: uniqueX=100, σ1d=10      → pressure=2.5 → 2.5^0.3=1.32
 *    Y: nSeries=40, σ_y=20       → pressure=2.67 → 2.67^0.3=1.35
 *    → width=528, height=406     ✓ Both axes stretch similarly
 *
 *  Scenario E (100×60):
 *    X: pressure=2.5 → 1.32
 *    Y: nSeries=60, σ_y=20       → pressure=4.0 → 4.0^0.3=1.52 → capped 1.5
 *    → width=528, height=450     ✓ Y hits cap
 */

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genDates } from './generators';

// ---------------------------------------------------------------------------
// Smooth random walk generator (shared across tests)
// ---------------------------------------------------------------------------
function makeRandWalk(rand: () => number) {
    return (n: number, base: number, volatility: number): number[] => {
        const values: number[] = [base];
        let momentum = 0;
        for (let i = 1; i < n; i++) {
            momentum = 0.65 * momentum + (rand() - 0.5) * volatility;
            values.push(Math.round(Math.max(0, values[i - 1] + momentum)));
        }
        return values;
    };
}

// ---------------------------------------------------------------------------
// Series name pools (realistic)
// ---------------------------------------------------------------------------
const SERIES_3 = ['Revenue', 'Costs', 'Profit'];
const SERIES_20 = [
    'Automotive', 'Banking', 'Construction', 'Defense', 'Energy',
    'Fashion', 'Gaming', 'Healthcare', 'Insurance', 'Jewelry',
    'Logistics', 'Manufacturing', 'Networking', 'Oil & Gas', 'Pharma',
    'Real Estate', 'Retail', 'Software', 'Telecom', 'Utilities',
];

const SERIES_40 = [
    ...SERIES_20,
    'Agriculture', 'Aerospace', 'Biotech', 'Chemicals', 'Consulting',
    'Education', 'Entertainment', 'Fintech', 'Forestry', 'Hospitality',
    'Legal', 'Media', 'Mining', 'Packaging', 'Publishing',
    'Semiconductors', 'Shipping', 'Sports', 'Textiles', 'Waste Mgmt',
];

const SERIES_60 = [
    ...SERIES_40,
    'Advertising', 'Architecture', 'Brewing', 'Ceramics', 'Dairy',
    'E-commerce', 'Fisheries', 'Furniture', 'Genomics', 'HVAC',
    'Irrigation', 'Journalism', 'Knitwear', 'Lighting', 'Marine',
    'Nutrition', 'Optics', 'Plumbing', 'Quarrying', 'Robotics',
];

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export function genLineAreaStretchTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(8800);
    const walk = makeRandWalk(rand);

    // Helper to build a multi-series dataset
    const buildData = (nDates: number, seriesNames: string[], startYear: number) => {
        const dates = genDates(nDates, startYear);
        const data: any[] = [];
        for (const s of seriesNames) {
            const base = 50 + Math.round(rand() * 300);
            const vals = walk(nDates, base, 15);
            for (let i = 0; i < dates.length; i++) {
                data.push({ Date: dates[i], Series: s, Value: vals[i] });
            }
        }
        return { dates, data };
    };

    // -----------------------------------------------------------------------
    // Scenario A: Many X (200 dates) × Few series (3)
    // -----------------------------------------------------------------------
    {
        const { data } = buildData(200, SERIES_3, 2015);
        const makeCase = (chartType: string, tag: string): TestCase => ({
            title: `${tag}: 200 dates × 3 series (600 pts)`,
            description: 'Many time points, few series — X should stretch to max, Y mild',
            tags: ['temporal', 'quantitative', 'color', 'stretch-test'],
            chartType,
            data,
            fields: [makeField('Date'), makeField('Value'), makeField('Series')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Series: { type: Type.String, semanticType: 'Category', levels: SERIES_3 },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Value'), color: makeEncodingItem('Series') },
        });
        tests.push(makeCase('Line Chart', 'Line A'));
        tests.push(makeCase('Area Chart', 'Area A'));
    }

    // -----------------------------------------------------------------------
    // Scenario B: Few X (12 dates) × Many series (20)
    // -----------------------------------------------------------------------
    {
        const { data } = buildData(12, SERIES_20, 2020);
        const makeCase = (chartType: string, tag: string): TestCase => ({
            title: `${tag}: 12 dates × 20 series (240 pts)`,
            description: 'Few time points, many series — should barely stretch',
            tags: ['temporal', 'quantitative', 'color', 'stretch-test'],
            chartType,
            data,
            fields: [makeField('Date'), makeField('Value'), makeField('Series')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Series: { type: Type.String, semanticType: 'Category', levels: SERIES_20 },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Value'), color: makeEncodingItem('Series') },
        });
        tests.push(makeCase('Line Chart', 'Line B'));
        tests.push(makeCase('Area Chart', 'Area B'));
    }

    // -----------------------------------------------------------------------
    // Scenario C: Many X (200 dates) × Many series (20)
    // -----------------------------------------------------------------------
    {
        const { data } = buildData(200, SERIES_20, 2010);
        const makeCase = (chartType: string, tag: string): TestCase => ({
            title: `${tag}: 200 dates × 20 series (4000 pts)`,
            description: 'Dense spaghetti — X should max out, Y moderate',
            tags: ['temporal', 'quantitative', 'color', 'stretch-test'],
            chartType,
            data,
            fields: [makeField('Date'), makeField('Value'), makeField('Series')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Series: { type: Type.String, semanticType: 'Category', levels: SERIES_20 },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Value'), color: makeEncodingItem('Series') },
        });
        tests.push(makeCase('Line Chart', 'Line C'));
        tests.push(makeCase('Area Chart', 'Area C'));
    }

    // -----------------------------------------------------------------------
    // Scenario D: Many X (100 dates) × 40 series
    //   X: uniqueX=100, σ1d=√100=10 → pressure=100×10/400=2.5 → 2.5^0.3=1.32
    //   Y: nSeries=40, σ_y=20       → pressure=40×20/300=2.67  → 2.67^0.3=1.35
    // -----------------------------------------------------------------------
    {
        const { data } = buildData(100, SERIES_40, 2018);
        const makeCase = (chartType: string, tag: string): TestCase => ({
            title: `${tag}: 100 dates × 40 series (4000 pts)`,
            description: '40 overlapping series — Y should stretch noticeably',
            tags: ['temporal', 'quantitative', 'color', 'stretch-test'],
            chartType,
            data,
            fields: [makeField('Date'), makeField('Value'), makeField('Series')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Series: { type: Type.String, semanticType: 'Category', levels: SERIES_40 },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Value'), color: makeEncodingItem('Series') },
        });
        tests.push(makeCase('Line Chart', 'Line D'));
        tests.push(makeCase('Area Chart', 'Area D'));
    }

    // -----------------------------------------------------------------------
    // Scenario E: Many X (100 dates) × 60 series
    //   X: uniqueX=100, σ1d=10 → pressure=2.5 → 2.5^0.3=1.32
    //   Y: nSeries=60, σ_y=20  → pressure=60×20/300=4.0 → 4.0^0.3=1.52 → capped 1.5
    // -----------------------------------------------------------------------
    {
        const { data } = buildData(100, SERIES_60, 2016);
        const makeCase = (chartType: string, tag: string): TestCase => ({
            title: `${tag}: 100 dates × 60 series (6000 pts)`,
            description: '60 series — Y should hit maxStretch cap',
            tags: ['temporal', 'quantitative', 'color', 'stretch-test'],
            chartType,
            data,
            fields: [makeField('Date'), makeField('Value'), makeField('Series')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Series: { type: Type.String, semanticType: 'Category', levels: SERIES_60 },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Value'), color: makeEncodingItem('Series') },
        });
        tests.push(makeCase('Line Chart', 'Line E'));
        tests.push(makeCase('Area Chart', 'Area E'));
    }

    // -----------------------------------------------------------------------
    // Boundary: Very few X (5 dates) × 2 series — should not stretch at all
    // -----------------------------------------------------------------------
    {
        const { data } = buildData(5, ['Actual', 'Forecast'], 2024);
        tests.push({
            title: 'Line boundary: 5 dates × 2 series (no stretch)',
            description: 'Minimal data — no stretch expected',
            tags: ['temporal', 'quantitative', 'color', 'stretch-test'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Date'), makeField('Value'), makeField('Series')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Series: { type: Type.String, semanticType: 'Category', levels: ['Actual', 'Forecast'] },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Value'), color: makeEncodingItem('Series') },
        });
    }

    // -----------------------------------------------------------------------
    // Boundary: 50 dates × 1 series — single line, moderate X stretch
    // -----------------------------------------------------------------------
    {
        const dates = genDates(50, 2022);
        const vals = walk(50, 200, 20);
        const data = dates.map((d, i) => ({ Date: d, Value: vals[i] }));
        tests.push({
            title: 'Line boundary: 50 dates × 1 series (single line)',
            description: 'Single series — X stretch only, no Y stretch',
            tags: ['temporal', 'quantitative', 'stretch-test'],
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

    // -----------------------------------------------------------------------
    // Boundary: 100 dates × 8 series — the screenshot case
    // -----------------------------------------------------------------------
    {
        const { data } = buildData(100, ['Auto', 'Books', 'Clothing', 'Electronics', 'Food', 'Garden', 'Home', 'Sports'], 2015);
        tests.push({
            title: 'Line reference: 100 dates × 8 series (800 pts)',
            description: 'The original screenshot case — should stretch X clearly more than Y',
            tags: ['temporal', 'quantitative', 'color', 'stretch-test'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Date'), makeField('Value'), makeField('Series')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Series: { type: Type.String, semanticType: 'Category', levels: ['Auto', 'Books', 'Clothing', 'Electronics', 'Food', 'Garden', 'Home', 'Sports'] },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Value'), color: makeEncodingItem('Series') },
        });
    }

    // -----------------------------------------------------------------------
    // Vertical (axes-flipped): Y=temporal, X=quantitative
    // Tests that seriesCountAxis:'auto' correctly resolves when flipped.
    // In 2D path, auto → Y for standard; when flipped the positional axis
    // is Y (dates) and the series overlap is on X (values).
    // -----------------------------------------------------------------------

    // Vertical Line: 100 dates × 8 series
    {
        const { data } = buildData(100, ['Auto', 'Books', 'Clothing', 'Electronics', 'Food', 'Garden', 'Home', 'Sports'], 2017);
        tests.push({
            title: 'Vertical Line: 100 dates × 8 series',
            description: 'Axes flipped — Y=dates, X=values. Series overlap on X axis.',
            tags: ['temporal', 'quantitative', 'color', 'stretch-test', 'vertical'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Date'), makeField('Value'), makeField('Series')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Series: { type: Type.String, semanticType: 'Category', levels: ['Auto', 'Books', 'Clothing', 'Electronics', 'Food', 'Garden', 'Home', 'Sports'] },
            },
            encodingMap: { y: makeEncodingItem('Date'), x: makeEncodingItem('Value'), color: makeEncodingItem('Series') },
        });
    }

    // Vertical Line: 200 dates × 20 series (dense spaghetti, flipped)
    {
        const { data } = buildData(200, SERIES_20, 2012);
        tests.push({
            title: 'Vertical Line: 200 dates × 20 series',
            description: 'Dense vertical spaghetti — Y should stretch (positional dates), X mild (series)',
            tags: ['temporal', 'quantitative', 'color', 'stretch-test', 'vertical'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Date'), makeField('Value'), makeField('Series')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Series: { type: Type.String, semanticType: 'Category', levels: SERIES_20 },
            },
            encodingMap: { y: makeEncodingItem('Date'), x: makeEncodingItem('Value'), color: makeEncodingItem('Series') },
        });
    }

    // Vertical Area: 100 dates × 40 series (stacked, flipped)
    {
        const { data } = buildData(100, SERIES_40, 2019);
        tests.push({
            title: 'Vertical Area: 100 dates × 40 series',
            description: 'Vertical stacked area with 40 series — both axes should stretch',
            tags: ['temporal', 'quantitative', 'color', 'stretch-test', 'vertical'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('Date'), makeField('Value'), makeField('Series')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Series: { type: Type.String, semanticType: 'Category', levels: SERIES_40 },
            },
            encodingMap: { y: makeEncodingItem('Date'), x: makeEncodingItem('Value'), color: makeEncodingItem('Series') },
        });
    }

    // Vertical Line: 12 dates × 60 series (extreme, flipped)
    {
        const { data } = buildData(12, SERIES_60, 2024);
        tests.push({
            title: 'Vertical Line: 12 dates × 60 series',
            description: 'Extreme series count vertical — X (series axis) should hit cap',
            tags: ['temporal', 'quantitative', 'color', 'stretch-test', 'vertical'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Date'), makeField('Value'), makeField('Series')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Series: { type: Type.String, semanticType: 'Category', levels: SERIES_60 },
            },
            encodingMap: { y: makeEncodingItem('Date'), x: makeEncodingItem('Value'), color: makeEncodingItem('Series') },
        });
    }

    return tests;
}
