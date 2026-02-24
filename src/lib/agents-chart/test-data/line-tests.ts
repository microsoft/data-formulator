// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genDates, genCategories, genOrdinalLabels, ORDINAL_PREFIXES } from './generators';

// ============================================================================
// Line Chart Tests — Matrix-driven
//
// Each test is defined as a compact row in LINE_MATRIX.  A generator
// function converts matrix entries into full TestCase objects.
//
// Matrix dimensions:
//   x axis type:  Q (quantitative), T (temporal), O (ordinal)
//   y axis type:  same
//   color channel: — | N (nominal, multi-series) | Q (gradient)
//   n:             total data points
//   sparse:        ~20% random dropout
//
// Ordinal (O) is used for axes — line charts require a meaningful
// sequential order.  Nominal (N) is used for unordered color groups.
// Purely nominal axes are excluded (lines imply sequence).
//
// Default test canvas: 300 × 300 px.
// ============================================================================

type DimType = 'Q' | 'T' | 'N' | 'O';

interface LineMatrixEntry {
    x: DimType;
    y: DimType;
    n: number;           // total data points
    color?: DimType;
    xCard?: number;
    yCard?: number;
    colorCard?: number;
    sparse?: boolean;
    desc?: string;
    extraTags?: string[];
}

// ============================================================================
// THE MATRIX — one row per test case (23 tests)
//
// Note: O (ordinal) is used for categorical axes — line charts require
// a meaningful sequential order.  N (nominal) is used for color groups.
// Purely nominal axis combinations are excluded because connecting
// unordered categories with lines is visually misleading.
// ============================================================================

const LINE_MATRIX: LineMatrixEntry[] = [
    // ── T × Q (6 tests) — core time series ──────────────────────────
    { x: 'T', y: 'Q', n: 30,   desc: 'Simple time series — 30 dates' },
    { x: 'T', y: 'Q', n: 200,  color: 'N', colorCard: 4,  desc: '4 series × 50 dates — smooth random walks' },
    { x: 'T', y: 'Q', n: 800,  color: 'N', colorCard: 8,  desc: '8 series × 100 dates — crowded' },
    { x: 'T', y: 'Q', n: 4000, color: 'N', colorCard: 20, desc: '20 series spaghetti — stress', extraTags: ['stress'] },
    { x: 'T', y: 'Q', n: 180,  color: 'N', colorCard: 3,  sparse: true, desc: '3 series × 60 dates, ~20% missing' },
    { x: 'T', y: 'Q', n: 30,   color: 'Q', desc: 'Continuous color gradient on time series' },

    // ── O × Q (4 tests) — ordered categories on x ───────────────────
    //    Line charts with ordinal x make sense when categories have an
    //    inherent sequence (e.g. stages, ranked items, ordered groups).
    { x: 'O', y: 'Q', n: 5,  xCard: 5,  desc: 'Ordinal line — 5 ordered categories' },
    { x: 'O', y: 'Q', n: 48, xCard: 12, color: 'N', colorCard: 4, desc: '12 ordinal × 4 series' },
    { x: 'O', y: 'Q', n: 30, xCard: 30, desc: '30 ordinal categories — label overflow', extraTags: ['overflow'] },
    { x: 'O', y: 'Q', n: 5,  xCard: 5,  color: 'Q', desc: 'Ordinal + continuous color gradient' },

    // ── Q × O (3 tests) — mirror ────────────────────────────────────
    { x: 'Q', y: 'O', n: 5,  yCard: 5,  desc: 'Horizontal ordinal — 5 ordered cats on y' },
    { x: 'Q', y: 'O', n: 48, yCard: 12, color: 'N', colorCard: 4, desc: 'Horizontal 12 ordinal × 4 series' },
    { x: 'Q', y: 'O', n: 30, yCard: 30, desc: 'Horizontal 30 ordinal overflow', extraTags: ['overflow'] },

    // ── Q × Q (3 tests) — quantitative x ────────────────────────────
    { x: 'Q', y: 'Q', n: 30,  desc: 'Quantitative x line — 30 pts' },
    { x: 'Q', y: 'Q', n: 150, color: 'N', colorCard: 3, desc: '3 parametric curves × 50 pts' },
    { x: 'Q', y: 'Q', n: 200, desc: 'Dense single curve — 200 pts' },

    // ── T × T ────────────────────────────────────────────────────────
    // Excluded: T×T date-pair data (start vs end date) doesn't suit line
    // charts — each row is an independent event, not a sequential series.
    // Lines connect points in data order producing random zig-zags.
    // T×T pairs are better served by scatter plots or dumbbell charts.

    // Excluded: N×N, T×N, N×T — purely nominal axes don't suit line charts.
    // Lines imply sequence/progression; connecting unordered categories is misleading.
];

// ============================================================================
// Generator internals
// ============================================================================

interface LineCh {
    role: 'x' | 'y' | 'color';
    dimType: DimType;
    fieldName: string;
    card?: number;
    levels?: string[];
    dates?: string[];
}

const LINE_NAMES: Record<string, Record<DimType, string>> = {
    x:     { Q: 'X',        T: 'Date',      N: 'Series',    O: 'Stage' },
    y:     { Q: 'Value',    T: 'EndDate',   N: 'Group',     O: 'Step' },
    color: { Q: 'ColorVal', T: 'Timestamp', N: 'Series',    O: 'Level' },
};

const LINE_FALLBACKS: Record<DimType, string[]> = {
    Q: ['X', 'Value', 'Measure', 'Score'],
    T: ['Date', 'EndDate', 'StartDate', 'Timestamp'],
    N: ['Series', 'Group', 'Category', 'Type'],
    O: ['Stage', 'Step', 'Phase', 'Level', 'Round'],
};

const LINE_CAT_POOLS = ['Category', 'Country', 'Department', 'Product', 'Company'];
const LINE_T_STARTS = [2020, 2023, 2019, 2022];

function buildLineChannels(entry: LineMatrixEntry, nPerSeries: number): LineCh[] {
    const used = new Set<string>();
    const channels: LineCh[] = [];
    let tIdx = 0;
    let cIdx = 0;
    let oIdx = 0;

    function pickName(dim: DimType, role: string): string {
        const primary = LINE_NAMES[role]?.[dim];
        if (primary && !used.has(primary)) { used.add(primary); return primary; }
        for (const n of LINE_FALLBACKS[dim]) {
            if (!used.has(n)) { used.add(n); return n; }
        }
        return `${role}_field`;
    }

    const specs: { role: 'x' | 'y' | 'color'; dim: DimType; card?: number }[] = [
        { role: 'x', dim: entry.x, card: entry.xCard },
        { role: 'y', dim: entry.y, card: entry.yCard },
    ];
    if (entry.color) specs.push({ role: 'color', dim: entry.color, card: entry.colorCard });

    for (const { role, dim, card } of specs) {
        const ch: LineCh = { role, dimType: dim, fieldName: pickName(dim, role) };

        if (dim === 'N') {
            const c = card || 3;
            ch.card = c;
            ch.levels = genCategories(LINE_CAT_POOLS[cIdx % LINE_CAT_POOLS.length], c);
            cIdx++;
        }

        if (dim === 'O') {
            const c = card || 5;
            ch.card = c;
            ch.levels = genOrdinalLabels(ORDINAL_PREFIXES[oIdx % ORDINAL_PREFIXES.length], c);
            oIdx++;
        }

        if (dim === 'T') {
            ch.dates = genDates(nPerSeries, LINE_T_STARTS[tIdx % LINE_T_STARTS.length]);
            tIdx++;
        }

        channels.push(ch);
    }

    return channels;
}

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

/** Smooth random-walk series (momentum + noise). */
function genLineWalk(n: number, base: number, volatility: number, rand: () => number): number[] {
    const v: number[] = [base];
    let m = 0;
    for (let i = 1; i < n; i++) {
        m = 0.7 * m + (rand() - 0.5) * volatility;
        v.push(Math.round(Math.max(0, v[i - 1] + m)));
    }
    return v;
}

function genLineSeriesData(
    entry: LineMatrixEntry, channels: LineCh[], rand: () => number,
): Record<string, any>[] {
    const xCh = channels.find(c => c.role === 'x')!;
    const yCh = channels.find(c => c.role === 'y')!;
    const colorCh = channels.find(c => c.role === 'color');

    const nSeries = (colorCh?.dimType === 'N' ? (entry.colorCard || 3) : 1);
    const nPerSeries = Math.max(1, Math.floor(entry.n / nSeries));

    // Shared x-positions
    let xPositions: any[];
    if (xCh.dimType === 'T') {
        xPositions = genDates(nPerSeries, 2020);
    } else if (xCh.dimType === 'O') {
        xPositions = xCh.levels!;
    } else { // Q
        xPositions = Array.from({ length: nPerSeries }, (_, i) =>
            Math.round(i * 100 / Math.max(1, nPerSeries - 1) * 10) / 10);
    }

    const data: Record<string, any>[] = [];

    for (let s = 0; s < nSeries; s++) {
        const base = 50 + Math.round(rand() * 200);
        const vol = 10 + rand() * 30;

        // Generate y-values
        let yValues: any[];
        if (yCh.dimType === 'Q') {
            yValues = genLineWalk(xPositions.length, base, vol, rand);
        } else if (yCh.dimType === 'T') {
            yValues = genDates(xPositions.length, 2023 + s);
        } else { // O
            yValues = xPositions.map((_, i) => yCh.levels![i % yCh.levels!.length]);
        }

        for (let i = 0; i < xPositions.length; i++) {
            if (entry.sparse && rand() < 0.2) continue;

            const row: Record<string, any> = {
                [xCh.fieldName]: xPositions[i],
                [yCh.fieldName]: yValues[i],
            };

            if (colorCh) {
                if (colorCh.dimType === 'N') {
                    row[colorCh.fieldName] = colorCh.levels![s];
                } else if (colorCh.dimType === 'Q') {
                    row[colorCh.fieldName] = Math.round(rand() * 100) / 10;
                }
            }

            data.push(row);
        }
    }

    return data;
}

function genLineGridData(channels: LineCh[], rand: () => number): Record<string, any>[] {
    const xCh = channels.find(c => c.role === 'x')!;
    const yCh = channels.find(c => c.role === 'y')!;
    const colorCh = channels.find(c => c.role === 'color');
    const data: Record<string, any>[] = [];

    for (const xVal of xCh.levels!) {
        for (const yVal of yCh.levels!) {
            if (rand() > 0.3) {
                const row: Record<string, any> = { [xCh.fieldName]: xVal, [yCh.fieldName]: yVal };
                if (colorCh?.dimType === 'N')
                    row[colorCh.fieldName] = colorCh.levels![Math.floor(rand() * colorCh.levels!.length)];
                data.push(row);
            }
        }
    }

    return data;
}

// ---------------------------------------------------------------------------
// Title & tags
// ---------------------------------------------------------------------------

function buildLineTitle(entry: LineMatrixEntry): string {
    const xLabel = entry.x === 'O' && entry.xCard ? `O(${entry.xCard})` : entry.x;
    const yLabel = entry.y === 'O' && entry.yCard ? `O(${entry.yCard})` : entry.y;
    const parts = [`${xLabel}×${yLabel}`];
    if (entry.color) {
        parts.push(`+color(${entry.color === 'N' ? `N,${entry.colorCard || 3}` : entry.color})`);
    }
    if (entry.sparse) parts.push('sparse');
    if (entry.n === 0) parts.push('grid');
    else parts.push(`(${entry.n} pts)`);
    return parts.join(' ');
}

function buildLineTags(entry: LineMatrixEntry, dataLen: number): string[] {
    const tags: string[] = [];
    const dims = new Set<DimType>([entry.x, entry.y]);
    if (entry.color) dims.add(entry.color);
    if (dims.has('Q')) tags.push('quantitative');
    if (dims.has('T')) tags.push('temporal');
    if (dims.has('N')) tags.push('nominal');
    if (dims.has('O')) tags.push('ordinal');
    if (entry.color) tags.push('color');
    if (entry.color === 'Q') tags.push('continuous-color');
    if (entry.sparse) tags.push('sparse');
    const n = dataLen;
    if (n <= 25) tags.push('small');
    else if (n <= 100) tags.push('medium');
    else { tags.push('large'); if (n > 500) tags.push('scaling'); }
    if (entry.extraTags) tags.push(...entry.extraTags);
    return [...new Set(tags)];
}

// ---------------------------------------------------------------------------
// Matrix entry → TestCase
// ---------------------------------------------------------------------------

function lineMatrixToTestCase(entry: LineMatrixEntry, rand: () => number): TestCase {
    const nSeries = entry.colorCard || 1;
    const effectiveN = entry.n || (entry.xCard || 5) * (entry.yCard || 5);
    const nPerSeries = Math.max(1, Math.floor(effectiveN / nSeries));
    const channels = buildLineChannels(entry, nPerSeries);

    const isGrid = entry.x === 'O' && entry.y === 'O' && entry.n === 0;

    let data: Record<string, any>[];
    if (isGrid) {
        data = genLineGridData(channels, rand);
    } else {
        data = genLineSeriesData(entry, channels, rand);
    }

    const typeMap: Record<DimType, Type> = { Q: Type.Number, T: Type.Date, N: Type.String, O: Type.String };
    const semMap: Record<DimType, string> = { Q: 'Quantity', T: 'Date', N: 'Category', O: 'Category' };

    const fields = channels.map(ch => makeField(ch.fieldName));
    const metadata: Record<string, { type: Type; semanticType: string; levels: any[] }> = {};
    const encodingMap: Partial<Record<string, any>> = {};

    for (const ch of channels) {
        metadata[ch.fieldName] = {
            type: typeMap[ch.dimType],
            semanticType: semMap[ch.dimType],
            levels: ch.levels || [],
        };
        encodingMap[ch.role] = makeEncodingItem(ch.fieldName);
    }

    return {
        title: buildLineTitle(entry),
        description: entry.desc || buildLineTitle(entry),
        tags: buildLineTags(entry, data.length),
        chartType: 'Line Chart',
        data,
        fields,
        metadata,
        encodingMap,
    };
}

// ============================================================================
// Public export
// ============================================================================

export function genLineTests(): TestCase[] {
    const rand = seededRandom(600);
    return LINE_MATRIX.map(entry => lineMatrixToTestCase(entry, rand));
}
