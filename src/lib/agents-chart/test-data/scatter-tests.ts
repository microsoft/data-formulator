// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genDates, genCategories, genRandomNames } from './generators';

// ============================================================================
// Scatter Plot Tests — Matrix-driven
//
// Each test is defined as a compact row in SCATTER_MATRIX.  A generator
// function converts matrix entries into full TestCase objects.
//
// Matrix dimensions:
//   Axis types:  Q (quantitative), T (temporal), N (nominal)
//   xy combos:   9 = [Q,T,N] × [Q,T,N]
//   3rd channel: none | color(Q/T/N) | size(Q/N) | both
//   Density:     small (≤25 pts), medium (26–100), large (>100)
//
// Note: Scatter plots don't distinguish nominal from ordinal visually —
// all categorical channels use N (nominal).  The one exception is size='N'
// which generates ranked labels (Low/Medium/High) for ordinal size levels.
//
// Default test canvas: 300 × 300 px.
// ============================================================================

type DimType = 'Q' | 'T' | 'N';

/** A single row in the scatter test matrix. */
interface MatrixEntry {
    x: DimType;
    y: DimType;
    n: number;           // data points (0 → derive from xCard × yCard for C×C grid)
    color?: DimType;
    size?: DimType;
    xCard?: number;      // C cardinality for x
    yCard?: number;      // C cardinality for y
    colorCard?: number;  // C cardinality for color
    sizeCard?: number;   // C/ordinal cardinality for size
    hugeRange?: boolean; // size field 1K–1B
    desc?: string;       // override auto-generated description
    extraTags?: string[];
}

// ============================================================================
// THE MATRIX — one row per test case (25 tests)
// ============================================================================

const SCATTER_MATRIX: MatrixEntry[] = [
    // ── Q × Q (15 tests) ─────────────────────────────────────────────
    //  xy only
    { x: 'Q', y: 'Q', n: 20,  desc: 'Baseline — two quantitative axes, no extra encodings' },
    //  + color
    { x: 'Q', y: 'Q', n: 20,  color: 'N', colorCard: 3 },
    { x: 'Q', y: 'Q', n: 20,  color: 'Q', desc: 'Continuous color — expect gradient legend' },
    { x: 'Q', y: 'Q', n: 30,  color: 'T', desc: 'Temporal color gradient — shows progression over time' },
    //  + size
    { x: 'Q', y: 'Q', n: 50,  size: 'Q' },
    { x: 'Q', y: 'Q', n: 20,  size: 'N', sizeCard: 4, desc: 'Ordinal size — 4 discrete priority levels' },
    //  + size + color
    { x: 'Q', y: 'Q', n: 15,  size: 'Q', color: 'N', colorCard: 3, desc: 'Gapminder-style: bubbles + 3 color groups' },
    { x: 'Q', y: 'Q', n: 30,  size: 'Q', color: 'Q', desc: 'Both size and color are continuous — 4D encoding' },
    { x: 'Q', y: 'Q', n: 20,  size: 'Q', color: 'N', colorCard: 20, hugeRange: true, desc: 'Size 1K–1B — tests sqrt scale discrimination' },
    //  density / scaling
    { x: 'Q', y: 'Q', n: 100, desc: 'Moderate density — point-size reduction' },
    { x: 'Q', y: 'Q', n: 500, desc: 'High density — aggressive point-size reduction' },
    { x: 'Q', y: 'Q', n: 200, color: 'N', colorCard: 20, desc: 'Dense scatter with 20 nominal color groups' },
    { x: 'Q', y: 'Q', n: 100, color: 'N', colorCard: 50, desc: '50 colors — tests legend overflow', extraTags: ['overflow'] },
    //  bubble scaling
    { x: 'Q', y: 'Q', n: 10,  size: 'Q', desc: 'Sparse — large bubbles expected', extraTags: ['scaling'] },
    { x: 'Q', y: 'Q', n: 200, size: 'Q', desc: 'Dense — bubbles should shrink significantly', extraTags: ['scaling'] },

    // ── N × Q (4 tests) ──────────────────────────────────────────────
    { x: 'N', y: 'Q', n: 25,  xCard: 5,  color: 'Q', desc: 'Strip + continuous color gradient' },
    { x: 'N', y: 'Q', n: 25,  xCard: 5,  size: 'Q', desc: 'Bubble strip — size encodes a measure' },
    { x: 'N', y: 'Q', n: 30,  xCard: 2,  desc: 'Binary category strip (e.g., Yes/No)', extraTags: ['edge-case'] },
    { x: 'N', y: 'Q', n: 60,  xCard: 60, desc: '60 categories — heavy discrete-axis overflow', extraTags: ['overflow'] },

    // ── Q × N (3 tests) — mirrors N×Q with flipped orientation ──────
    { x: 'Q', y: 'N', n: 25,  yCard: 5,  color: 'Q', desc: 'Horizontal strip + continuous color' },
    { x: 'Q', y: 'N', n: 25,  yCard: 5,  size: 'Q', desc: 'Horizontal bubble strip' },
    { x: 'Q', y: 'N', n: 60,  yCard: 60, desc: 'Horizontal 60-cat overflow on y', extraTags: ['overflow'] },

    // ── N × N (3 tests) ──────────────────────────────────────────────
    { x: 'N', y: 'N', n: 0,   xCard: 5,  yCard: 6,  size: 'Q', desc: 'Bubble grid — partial grid occupancy' },
    { x: 'N', y: 'N', n: 0,   xCard: 5,  yCard: 4,  color: 'Q', desc: 'Heatmap-like scatter — continuous color on grid' },
    { x: 'N', y: 'N', n: 0,   xCard: 15, yCard: 12, size: 'Q', desc: 'Large grid — high-cardinality overflow on both axes', extraTags: ['overflow', 'scaling'] },
];

// ============================================================================
// Generator internals
// ============================================================================

interface ChannelInfo {
    role: 'x' | 'y' | 'color' | 'size';
    dimType: DimType;
    fieldName: string;
    card?: number;
    levels?: string[];
    dates?: string[];
}

/** Preferred field names per (role, dimType). */
const PREFERRED_NAMES: Record<string, Record<DimType, string>> = {
    x:     { Q: 'X',        T: 'Date',      N: 'Category' },
    y:     { Q: 'Y',        T: 'EndDate',   N: 'Group' },
    color: { Q: 'ColorVal', T: 'Timestamp', N: 'Segment' },
    size:  { Q: 'Size',     T: 'Period',    N: 'Level' },
};

/** Fallback pools when the preferred name is already taken. */
const FALLBACK_NAMES: Record<DimType, string[]> = {
    Q: ['X', 'Y', 'Measure', 'Value', 'Score'],
    T: ['Date', 'EndDate', 'StartDate', 'Timestamp'],
    N: ['Category', 'Group', 'Segment', 'Level', 'Type'],
};

/** Semantic-type pool so multiple C channels get distinct category sets. */
const CAT_SEMANTICS = ['Category', 'Country', 'Department', 'Product', 'Company'];

/** Start years for temporal channels (staggered to avoid overlap in T×T). */
const T_START_YEARS = [2020, 2023, 2019, 2022];

// ---------------------------------------------------------------------------
// Channel & data generation
// ---------------------------------------------------------------------------

function buildChannels(entry: MatrixEntry): ChannelInfo[] {
    const used = new Set<string>();
    const channels: ChannelInfo[] = [];
    let tIdx = 0;   // temporal channel counter
    let cIdx = 0;   // categorical channel counter
    let cSeed = 500;

    function pickName(dim: DimType, role: string): string {
        const primary = PREFERRED_NAMES[role]?.[dim];
        if (primary && !used.has(primary)) { used.add(primary); return primary; }
        for (const n of FALLBACK_NAMES[dim]) {
            if (!used.has(n)) { used.add(n); return n; }
        }
        return `${role}_field`;
    }

    const specs: { role: 'x' | 'y' | 'color' | 'size'; dim: DimType; card?: number }[] = [
        { role: 'x', dim: entry.x, card: entry.xCard },
        { role: 'y', dim: entry.y, card: entry.yCard },
    ];
    if (entry.color) specs.push({ role: 'color', dim: entry.color, card: entry.colorCard });
    if (entry.size)  specs.push({ role: 'size',  dim: entry.size,  card: entry.sizeCard });

    const effectiveN = entry.n || (entry.xCard || 5) * (entry.yCard || 5);

    for (const { role, dim, card } of specs) {
        const ch: ChannelInfo = { role, dimType: dim, fieldName: pickName(dim, role) };

        if (dim === 'N') {
            const c = card || (role === 'size' ? 4 : role === 'color' ? 3 : 5);
            ch.card = c;
            if (role === 'size') {
                ch.levels = ['Low', 'Medium', 'High', 'Critical', 'Extreme'].slice(0, c);
            } else if (c > 30) {
                ch.levels = genRandomNames(c, cSeed);
                cSeed += 100;
            } else {
                ch.levels = genCategories(CAT_SEMANTICS[cIdx % CAT_SEMANTICS.length], c);
            }
            cIdx++;
        }

        if (dim === 'T') {
            ch.dates = genDates(effectiveN, T_START_YEARS[tIdx % T_START_YEARS.length]);
            tIdx++;
        }

        channels.push(ch);
    }

    return channels;
}

/** Generate a single field value for row `i`. */
function genValue(
    ch: ChannelInfo, i: number, entry: MatrixEntry, rand: () => number,
): any {
    switch (ch.dimType) {
        case 'Q': {
            if (entry.hugeRange && ch.role === 'size')
                return Math.round(1e3 + rand() * 1e9);
            return Math.round(rand() * 1000) / 10;
        }
        case 'T':
            return ch.dates![i % ch.dates!.length];
        case 'N':
            return ch.levels![i % ch.levels!.length];
    }
}

/** Generate data for C×C grid mode (cross-product, ~70 % occupancy). */
function genGridData(
    channels: ChannelInfo[], rand: () => number,
): Record<string, any>[] {
    const xCh = channels.find(c => c.role === 'x')!;
    const yCh = channels.find(c => c.role === 'y')!;
    const extras = channels.filter(c => c.role !== 'x' && c.role !== 'y');
    const data: Record<string, any>[] = [];

    for (const xVal of xCh.levels!) {
        for (const yVal of yCh.levels!) {
            if (rand() > 0.3) {
                const row: Record<string, any> = {
                    [xCh.fieldName]: xVal,
                    [yCh.fieldName]: yVal,
                };
                for (const ch of extras) {
                    if (ch.dimType === 'Q') row[ch.fieldName] = Math.round(100 + rand() * 900);
                    else if (ch.dimType === 'N') row[ch.fieldName] = ch.levels![Math.floor(rand() * ch.levels!.length)];
                }
                data.push(row);
            }
        }
    }
    return data;
}

// ---------------------------------------------------------------------------
// Title & tags
// ---------------------------------------------------------------------------

function buildTitle(entry: MatrixEntry): string {
    const xLabel = entry.x === 'N' && entry.xCard ? `N(${entry.xCard})` : entry.x;
    const yLabel = entry.y === 'N' && entry.yCard ? `N(${entry.yCard})` : entry.y;
    const parts = [`${xLabel}×${yLabel}`];

    const extras: string[] = [];
    if (entry.color) {
        extras.push(`color(${entry.color === 'N' ? `N,${entry.colorCard || 3}` : entry.color})`);
    }
    if (entry.size) {
        extras.push(`size(${entry.size === 'N' ? `N,${entry.sizeCard || 4}` : entry.size})`);
    }
    if (extras.length) parts.push('+' + extras.join('+'));

    if (entry.hugeRange) parts.push('hugeRange');

    if (entry.n === 0)   parts.push('grid');
    else                 parts.push(`(${entry.n} ${entry.n === 1 ? 'pt' : 'pts'})`);

    return parts.join(' ');
}

function buildTags(entry: MatrixEntry, dataLen: number): string[] {
    const tags: string[] = [];

    // Dimension types present
    const dims = new Set<DimType>([entry.x, entry.y]);
    if (entry.color) dims.add(entry.color);
    if (entry.size)  dims.add(entry.size);
    if (dims.has('Q')) tags.push('quantitative');
    if (dims.has('T')) tags.push('temporal');
    if (dims.has('N')) tags.push('nominal');

    // Channel presence
    if (entry.color) tags.push('color');
    if (entry.size)  tags.push('size');
    if (entry.color === 'Q' || entry.color === 'T') tags.push('continuous-color');

    // Scale
    const n = dataLen;
    if (n <= 25) tags.push('small');
    else if (n <= 100) tags.push('medium');
    else { tags.push('large'); tags.push('scaling'); }

    if (entry.extraTags) tags.push(...entry.extraTags);

    return [...new Set(tags)];
}

// ---------------------------------------------------------------------------
// Matrix entry → TestCase
// ---------------------------------------------------------------------------

function matrixToTestCase(entry: MatrixEntry, rand: () => number): TestCase {
    const channels = buildChannels(entry);

    const isGrid = entry.x === 'N' && entry.y === 'N' && entry.n === 0;

    // Generate data
    let data: Record<string, any>[];
    if (isGrid) {
        data = genGridData(channels, rand);
    } else {
        data = Array.from({ length: entry.n }, (_, i) => {
            const row: Record<string, any> = {};
            for (const ch of channels) row[ch.fieldName] = genValue(ch, i, entry, rand);
            return row;
        });
    }

    // Build fields, metadata, encodingMap
    const fields = channels.map(ch => makeField(ch.fieldName));

    const typeMap: Record<DimType, Type> = { Q: Type.Number, T: Type.Date, N: Type.String };
    const semMap: Record<DimType, string> = { Q: 'Quantity', T: 'Date', N: 'Category' };

    const metadata: Record<string, { type: Type; semanticType: string; levels: any[] }> = {};
    const encodingMap: Partial<Record<string, any>> = {};

    for (const ch of channels) {
        let semanticType = semMap[ch.dimType];
        if (ch.role === 'size' && ch.dimType === 'N') semanticType = 'Rank';
        metadata[ch.fieldName] = {
            type: typeMap[ch.dimType],
            semanticType,
            levels: ch.levels || [],
        };
        encodingMap[ch.role] = makeEncodingItem(ch.fieldName);
    }

    return {
        title: buildTitle(entry),
        description: entry.desc || buildTitle(entry),
        tags: buildTags(entry, data.length),
        chartType: 'Scatter Plot',
        data,
        fields,
        metadata,
        encodingMap,
    };
}

// ============================================================================
// Public exports
// ============================================================================

export function genScatterTests(): TestCase[] {
    const rand = seededRandom(42);
    return SCATTER_MATRIX.map(entry => matrixToTestCase(entry, rand));
}

// ============================================================================
// Regression Tests  (not matrix-driven)
// ============================================================================

export function genRegressionTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(55);

    // 1. Basic regression (quant × quant)
    {
        const n = 40;
        const data = Array.from({ length: n }, () => {
            const x = 10 + rand() * 80;
            return { Hours: Math.round(x * 10) / 10, Score: Math.round(20 + x * 0.8 + (rand() - 0.5) * 30) };
        });
        tests.push({
            title: 'Basic regression (40 pts)',
            description: 'Hours vs Score — simple linear trend',
            tags: ['quantitative', 'small'],
            chartType: 'Regression',
            data,
            fields: [makeField('Hours'), makeField('Score')],
            metadata: {
                Hours: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Score: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Hours'), y: makeEncodingItem('Score') },
        });
    }

    // 2. Regression with color (grouped lines)
    {
        const groups = ['Male', 'Female'];
        const data: any[] = [];
        for (const g of groups) {
            const offset = g === 'Male' ? 5 : -5;
            for (let i = 0; i < 30; i++) {
                const x = 10 + rand() * 80;
                data.push({
                    Experience: Math.round(x * 10) / 10,
                    Salary: Math.round(30 + x * 0.6 + offset + (rand() - 0.5) * 20),
                    Gender: g,
                });
            }
        }
        tests.push({
            title: 'Regression + Color (2 groups)',
            description: '60 points — separate regression per gender',
            tags: ['quantitative', 'color', 'medium'],
            chartType: 'Regression',
            data,
            fields: [makeField('Experience'), makeField('Salary'), makeField('Gender')],
            metadata: {
                Experience: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Salary: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Gender: { type: Type.String, semanticType: 'Category', levels: groups },
            },
            encodingMap: { x: makeEncodingItem('Experience'), y: makeEncodingItem('Salary'), color: makeEncodingItem('Gender') },
        });
    }

    // 3. Regression with 4 color groups
    {
        const regions = ['North', 'South', 'East', 'West'];
        const data: any[] = [];
        const offsets: Record<string, number> = { North: 10, South: -5, East: 3, West: -8 };
        const slopes: Record<string, number> = { North: 0.7, South: 0.5, East: 0.9, West: 0.4 };
        for (const r of regions) {
            for (let i = 0; i < 25; i++) {
                const x = 5 + rand() * 90;
                data.push({
                    Advertising: Math.round(x * 10) / 10,
                    Revenue: Math.round(offsets[r] + x * slopes[r] + (rand() - 0.5) * 15),
                    Region: r,
                });
            }
        }
        tests.push({
            title: 'Regression + Color (4 groups)',
            description: '100 points — separate regression per region with distinct slopes',
            tags: ['quantitative', 'color', 'medium'],
            chartType: 'Regression',
            data,
            fields: [makeField('Advertising'), makeField('Revenue'), makeField('Region')],
            metadata: {
                Advertising: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Revenue: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Region: { type: Type.String, semanticType: 'Category', levels: regions },
            },
            encodingMap: { x: makeEncodingItem('Advertising'), y: makeEncodingItem('Revenue'), color: makeEncodingItem('Region') },
        });
    }

    // 4. Regression with 6 color groups (many categories)
    {
        const subjects = ['Math', 'Science', 'English', 'History', 'Art', 'Music'];
        const data: any[] = [];
        const baseIntercepts = [15, 25, 20, 10, 30, 5];
        const baseSlopes = [0.8, 0.6, 0.5, 0.7, 0.3, 0.9];
        for (let si = 0; si < subjects.length; si++) {
            for (let i = 0; i < 20; i++) {
                const x = 10 + rand() * 80;
                data.push({
                    StudyHours: Math.round(x * 10) / 10,
                    ExamScore: Math.round(baseIntercepts[si] + x * baseSlopes[si] + (rand() - 0.5) * 18),
                    Subject: subjects[si],
                });
            }
        }
        tests.push({
            title: 'Regression + Color (6 groups)',
            description: '120 points — separate regression per subject',
            tags: ['quantitative', 'color', 'large'],
            chartType: 'Regression',
            data,
            fields: [makeField('StudyHours'), makeField('ExamScore'), makeField('Subject')],
            metadata: {
                StudyHours: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                ExamScore: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Subject: { type: Type.String, semanticType: 'Category', levels: subjects },
            },
            encodingMap: { x: makeEncodingItem('StudyHours'), y: makeEncodingItem('ExamScore'), color: makeEncodingItem('Subject') },
        });
    }

    // 5. Regression with 3 color groups + size encoding
    {
        const tiers = ['Budget', 'Mid-Range', 'Premium'];
        const data: any[] = [];
        const tierOffsets = [5, 20, 40];
        const tierSlopes = [0.3, 0.5, 0.8];
        for (let ti = 0; ti < tiers.length; ti++) {
            for (let i = 0; i < 30; i++) {
                const x = 10 + rand() * 85;
                const weight = Math.round(50 + rand() * 150);
                data.push({
                    EngineSize: Math.round(x * 10) / 10,
                    Horsepower: Math.round(tierOffsets[ti] + x * tierSlopes[ti] + (rand() - 0.5) * 12),
                    Tier: tiers[ti],
                    Weight: weight,
                });
            }
        }
        tests.push({
            title: 'Regression + Color (3 groups) + Size',
            description: '90 points — regression per tier with weight as size',
            tags: ['quantitative', 'color', 'size', 'medium'],
            chartType: 'Regression',
            data,
            fields: [makeField('EngineSize'), makeField('Horsepower'), makeField('Tier'), makeField('Weight')],
            metadata: {
                EngineSize: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Horsepower: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Tier: { type: Type.String, semanticType: 'Category', levels: tiers },
                Weight: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                x: makeEncodingItem('EngineSize'),
                y: makeEncodingItem('Horsepower'),
                color: makeEncodingItem('Tier'),
                size: makeEncodingItem('Weight'),
            },
        });
    }

    // 6. Logarithmic regression
    {
        const n = 50;
        const data = Array.from({ length: n }, () => {
            const x = 1 + rand() * 99;  // avoid log(0)
            return { Investment: Math.round(x * 10) / 10, Returns: Math.round(10 * Math.log(x) + 5 + (rand() - 0.5) * 8) };
        });
        tests.push({
            title: 'Logarithmic regression (50 pts)',
            description: 'Investment vs Returns — log trend',
            tags: ['quantitative', 'small', 'log'],
            chartType: 'Regression',
            data,
            fields: [makeField('Investment'), makeField('Returns')],
            metadata: {
                Investment: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Returns: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Investment'), y: makeEncodingItem('Returns') },
            chartProperties: { regressionMethod: 'log' },
        });
    }

    // 7. Quadratic regression
    {
        const n = 60;
        const data = Array.from({ length: n }, () => {
            const x = -10 + rand() * 20;
            const y = 0.5 * x * x - 2 * x + 3 + (rand() - 0.5) * 6;
            return { Position: Math.round(x * 10) / 10, Height: Math.round(y * 10) / 10 };
        });
        tests.push({
            title: 'Quadratic regression (60 pts)',
            description: 'Parabolic data — quad fit',
            tags: ['quantitative', 'medium', 'quad'],
            chartType: 'Regression',
            data,
            fields: [makeField('Position'), makeField('Height')],
            metadata: {
                Position: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Height: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Position'), y: makeEncodingItem('Height') },
            chartProperties: { regressionMethod: 'quad' },
        });
    }

    // 8. Polynomial regression (order 4) with color
    {
        const groups = ['Group A', 'Group B', 'Group C'];
        const data: any[] = [];
        for (const g of groups) {
            const shift = groups.indexOf(g) * 3;
            for (let i = 0; i < 30; i++) {
                const x = -5 + rand() * 10;
                const y = shift + 0.05 * Math.pow(x, 3) - 0.3 * x * x + x + 5 + (rand() - 0.5) * 4;
                data.push({
                    Input: Math.round(x * 10) / 10,
                    Output: Math.round(y * 10) / 10,
                    Category: g,
                });
            }
        }
        tests.push({
            title: 'Poly regression (3 groups, order 4)',
            description: '90 points — cubic-ish data with poly(4) fit per group',
            tags: ['quantitative', 'color', 'medium', 'poly'],
            chartType: 'Regression',
            data,
            fields: [makeField('Input'), makeField('Output'), makeField('Category')],
            metadata: {
                Input: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Output: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Category: { type: Type.String, semanticType: 'Category', levels: groups },
            },
            encodingMap: { x: makeEncodingItem('Input'), y: makeEncodingItem('Output'), color: makeEncodingItem('Category') },
            chartProperties: { regressionMethod: 'poly', polyOrder: 4 },
        });
    }

    // 9. Exponential regression
    {
        const n = 45;
        const data = Array.from({ length: n }, () => {
            const x = rand() * 5;
            const y = 2 * Math.exp(0.4 * x) + (rand() - 0.5) * 3;
            return { Time: Math.round(x * 10) / 10, Growth: Math.round(Math.max(0.1, y) * 10) / 10 };
        });
        tests.push({
            title: 'Exponential regression (45 pts)',
            description: 'Time vs Growth — exponential trend',
            tags: ['quantitative', 'small', 'exp'],
            chartType: 'Regression',
            data,
            fields: [makeField('Time'), makeField('Growth')],
            metadata: {
                Time: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Growth: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Time'), y: makeEncodingItem('Growth') },
            chartProperties: { regressionMethod: 'exp' },
        });
    }

    // 10. Power regression with 2 color groups
    {
        const classes = ['Species A', 'Species B'];
        const data: any[] = [];
        for (const cls of classes) {
            const scale = cls === 'Species A' ? 1.5 : 0.8;
            const exp = cls === 'Species A' ? 0.6 : 0.8;
            for (let i = 0; i < 30; i++) {
                const x = 1 + rand() * 50;
                const y = scale * Math.pow(x, exp) + (rand() - 0.5) * 3;
                data.push({
                    BodyMass: Math.round(x * 10) / 10,
                    MetabolicRate: Math.round(Math.max(0.1, y) * 10) / 10,
                    Species: cls,
                });
            }
        }
        tests.push({
            title: 'Power regression + Color (2 groups)',
            description: '60 points — allometric scaling per species',
            tags: ['quantitative', 'color', 'medium', 'pow'],
            chartType: 'Regression',
            data,
            fields: [makeField('BodyMass'), makeField('MetabolicRate'), makeField('Species')],
            metadata: {
                BodyMass: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                MetabolicRate: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Species: { type: Type.String, semanticType: 'Category', levels: classes },
            },
            encodingMap: { x: makeEncodingItem('BodyMass'), y: makeEncodingItem('MetabolicRate'), color: makeEncodingItem('Species') },
            chartProperties: { regressionMethod: 'pow' },
        });
    }

    return tests;
}
