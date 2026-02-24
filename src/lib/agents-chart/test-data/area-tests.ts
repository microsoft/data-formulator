// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genDates, genCategories, genOrdinalLabels, ORDINAL_PREFIXES } from './generators';

// ============================================================================
// Area Chart & Streamgraph Tests — Matrix-driven
//
// Each test is defined as a compact row in AREA_MATRIX / STREAMGRAPH_MATRIX.
// A shared generator converts matrix entries into full TestCase objects.
//
// Matrix dimensions:
//   x axis type:  Q (quantitative), T (temporal), O (ordinal)
//   y axis type:  same
//   color channel: — | N (nominal, multi-series) | Q (gradient)
//   n:             total data points
//   sparse:        ~20% random dropout
//
// Ordinal (O) is used for axes — area charts require a meaningful
// sequential order.  Nominal (N) is used for unordered color groups.
// Purely nominal axes are excluded (area fills imply continuity).
//
// Default test canvas: 300 × 300 px.
// ============================================================================

type DimType = 'Q' | 'T' | 'N' | 'O';

interface AreaMatrixEntry {
    x: DimType;
    y: DimType;
    n: number;           // total data points (0 → grid)
    color?: DimType;
    xCard?: number;
    yCard?: number;
    colorCard?: number;
    sparse?: boolean;
    desc?: string;
    extraTags?: string[];
}

// ============================================================================
// AREA CHART MATRIX — one row per test case (23 tests)
//
// Note: O (ordinal) is used for categorical axes — area charts require
// a meaningful sequential order.  N (nominal) is used for color groups.
// Purely nominal axis combinations are excluded because connecting
// unordered categories with area fills is visually misleading.
// ============================================================================

const AREA_MATRIX: AreaMatrixEntry[] = [
    // ── T × Q (7 tests) — core stacked / layered area ───────────────
    { x: 'T', y: 'Q', n: 30,   desc: 'Simple time-series area — 30 dates' },
    { x: 'T', y: 'Q', n: 96,   color: 'N', colorCard: 4,  desc: '4 stacked series × 24 dates' },
    { x: 'T', y: 'Q', n: 480,  color: 'N', colorCard: 8,  desc: '8 series × 60 dates — large stacked' },
    { x: 'T', y: 'Q', n: 1800, color: 'N', colorCard: 15, desc: '15 series × 120 dates — stress', extraTags: ['stress'] },
    { x: 'T', y: 'Q', n: 120,  color: 'N', colorCard: 3,  desc: '3 layered/overlapping series' },
    { x: 'T', y: 'Q', n: 180,  color: 'N', colorCard: 3,  sparse: true, desc: '3 series, ~20% missing values' },
    { x: 'T', y: 'Q', n: 30,   color: 'Q', desc: 'Continuous color gradient on area' },

    // ── O × Q (4 tests) — ordered categories on x ───────────────────
    //    Area charts with ordinal x make sense when categories have an
    //    inherent sequence (e.g. stages, ranked items, ordered groups).
    { x: 'O', y: 'Q', n: 5,  xCard: 5,  desc: 'Ordinal area — 5 ordered categories' },
    { x: 'O', y: 'Q', n: 48, xCard: 12, color: 'N', colorCard: 4, desc: '12 ordinal × 4 stacked series' },
    { x: 'O', y: 'Q', n: 30, xCard: 30, desc: '30 ordinal categories — label overflow', extraTags: ['overflow'] },
    { x: 'O', y: 'Q', n: 5,  xCard: 5,  color: 'Q', desc: 'Ordinal + continuous color gradient' },

    // ── Q × O (3 tests) — mirror ────────────────────────────────────
    { x: 'Q', y: 'O', n: 5,  yCard: 5,  desc: 'Horizontal ordinal — 5 ordered cats on y' },
    { x: 'Q', y: 'O', n: 48, yCard: 12, color: 'N', colorCard: 4, desc: 'Horizontal 12 ordinal × 4 series' },
    { x: 'Q', y: 'O', n: 30, yCard: 30, desc: 'Horizontal 30 ordinal overflow', extraTags: ['overflow'] },

    // ── Q × Q (3 tests) — quantitative both axes ────────────────────
    { x: 'Q', y: 'Q', n: 30,  desc: 'Quantitative x area — 30 pts' },
    { x: 'Q', y: 'Q', n: 150, color: 'N', colorCard: 3, desc: '3 stacked curves × 50 pts' },
    { x: 'Q', y: 'Q', n: 200, desc: 'Dense single-series area — 200 pts' },

    // Excluded: T×T, Q×T — date-pair data doesn't suit area charts.
    // Area fills imply sequential progression; T×T/Q×T lack monotonic relationships.
    // Excluded: N×N, T×N, N×T — purely nominal axes don't suit area charts.
    // Area fills imply continuity/progression; nominal axes lack this.
];

// ============================================================================
// STREAMGRAPH MATRIX — one row per test case (6 tests)
//
// Streamgraphs are centre-stacked areas — always multi-series (color
// required).  Primarily T×Q but we exercise a few other combos.
// ============================================================================

const STREAMGRAPH_MATRIX: AreaMatrixEntry[] = [
    { x: 'T', y: 'Q', n: 200,  color: 'N', colorCard: 5,  desc: '5 genres × 40 dates — basic streamgraph' },
    { x: 'T', y: 'Q', n: 800,  color: 'N', colorCard: 10, desc: '10 industries × 80 dates — large' },
    { x: 'T', y: 'Q', n: 3000, color: 'N', colorCard: 20, desc: '20 series × 150 dates — stress', extraTags: ['stress'] },
    { x: 'T', y: 'Q', n: 200,  color: 'N', colorCard: 5,  sparse: true, desc: '5 series ~20% missing' },
    { x: 'O', y: 'Q', n: 60,   xCard: 12, color: 'N', colorCard: 5, desc: 'Ordinal streamgraph — 12 cats × 5 series' },
    { x: 'Q', y: 'Q', n: 150,  color: 'N', colorCard: 3, desc: 'Quant-x streamgraph — 3 series × 50 pts' },
];

// ============================================================================
// Generator internals
// ============================================================================

interface AreaCh {
    role: 'x' | 'y' | 'color';
    dimType: DimType;
    fieldName: string;
    card?: number;
    levels?: string[];
    dates?: string[];
}

const AREA_NAMES: Record<string, Record<DimType, string>> = {
    x:     { Q: 'X',        T: 'Date',      N: 'Series',    O: 'Stage' },
    y:     { Q: 'Value',    T: 'EndDate',   N: 'Group',     O: 'Step' },
    color: { Q: 'ColorVal', T: 'Timestamp', N: 'Series',    O: 'Level' },
};

const AREA_FALLBACKS: Record<DimType, string[]> = {
    Q: ['X', 'Value', 'Measure', 'Score'],
    T: ['Date', 'EndDate', 'StartDate', 'Timestamp'],
    N: ['Series', 'Group', 'Category', 'Type'],
    O: ['Stage', 'Step', 'Phase', 'Level', 'Round'],
};

const AREA_CAT_POOLS = ['Category', 'Country', 'Department', 'Product', 'Company'];
const AREA_T_STARTS  = [2020, 2023, 2019, 2022];

function buildAreaChannels(entry: AreaMatrixEntry, nPerSeries: number): AreaCh[] {
    const used = new Set<string>();
    const channels: AreaCh[] = [];
    let tIdx = 0;
    let cIdx = 0;
    let oIdx = 0;

    function pickName(dim: DimType, role: string): string {
        const primary = AREA_NAMES[role]?.[dim];
        if (primary && !used.has(primary)) { used.add(primary); return primary; }
        for (const n of AREA_FALLBACKS[dim]) {
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
        const ch: AreaCh = { role, dimType: dim, fieldName: pickName(dim, role) };

        if (dim === 'N') {
            const c = card || 3;
            ch.card = c;
            ch.levels = genCategories(AREA_CAT_POOLS[cIdx % AREA_CAT_POOLS.length], c);
            cIdx++;
        }

        if (dim === 'O') {
            const c = card || 5;
            ch.card = c;
            ch.levels = genOrdinalLabels(ORDINAL_PREFIXES[oIdx % ORDINAL_PREFIXES.length], c);
            oIdx++;
        }

        if (dim === 'T') {
            ch.dates = genDates(nPerSeries, AREA_T_STARTS[tIdx % AREA_T_STARTS.length]);
            tIdx++;
        }

        channels.push(ch);
    }

    return channels;
}

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

/** Smooth random walk with upward drift — natural for cumulative / area metrics. */
function genAreaTrend(n: number, base: number, drift: number, volatility: number, rand: () => number): number[] {
    const values: number[] = [base];
    let momentum = 0;
    for (let i = 1; i < n; i++) {
        momentum = 0.6 * momentum + (rand() - 0.45) * volatility + drift;
        values.push(Math.round(Math.max(0, values[i - 1] + momentum)));
    }
    return values;
}

function genAreaSeriesData(
    entry: AreaMatrixEntry, channels: AreaCh[], rand: () => number,
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
        const drift = 0.5 + rand() * 2;
        const vol = 10 + rand() * 30;

        // Generate y-values
        let yValues: any[];
        if (yCh.dimType === 'Q') {
            yValues = genAreaTrend(xPositions.length, base, drift, vol, rand);
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

function genAreaGridData(channels: AreaCh[], rand: () => number): Record<string, any>[] {
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

function genAreaDatePairData(n: number, channels: AreaCh[], rand: () => number): Record<string, any>[] {
    const data: Record<string, any>[] = [];
    for (let i = 0; i < n; i++) {
        const row: Record<string, any> = {};
        const startDay = Math.floor(rand() * 365);
        const duration = Math.floor(10 + rand() * 180);
        const start = new Date(2023, 0, 1);
        start.setDate(start.getDate() + startDay);
        const end = new Date(start);
        end.setDate(end.getDate() + duration);

        for (const ch of channels) {
            if (ch.dimType === 'T' && ch.role === 'x')
                row[ch.fieldName] = start.toISOString().slice(0, 10);
            else if (ch.dimType === 'T' && ch.role === 'y')
                row[ch.fieldName] = end.toISOString().slice(0, 10);
            else if (ch.dimType === 'N')
                row[ch.fieldName] = ch.levels![i % ch.levels!.length];
            else if (ch.dimType === 'Q')
                row[ch.fieldName] = Math.round(rand() * 1000) / 10;
        }
        data.push(row);
    }
    return data;
}

// ---------------------------------------------------------------------------
// Title & tags
// ---------------------------------------------------------------------------

function buildAreaTitle(entry: AreaMatrixEntry): string {
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

function buildAreaTags(entry: AreaMatrixEntry, dataLen: number): string[] {
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

function areaMatrixToTestCase(
    entry: AreaMatrixEntry, chartType: string, rand: () => number,
): TestCase {
    const nSeries = entry.colorCard || 1;
    const effectiveN = entry.n || (entry.xCard || 5) * (entry.yCard || 5);
    const nPerSeries = Math.max(1, Math.floor(effectiveN / nSeries));
    const channels = buildAreaChannels(entry, nPerSeries);

    const isGrid = entry.x === 'O' && entry.y === 'O' && entry.n === 0;
    const isTT   = entry.x === 'T' && entry.y === 'T';

    let data: Record<string, any>[];
    if (isGrid) {
        data = genAreaGridData(channels, rand);
    } else if (isTT) {
        data = genAreaDatePairData(entry.n, channels, rand);
    } else {
        data = genAreaSeriesData(entry, channels, rand);
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
        title: buildAreaTitle(entry),
        description: entry.desc || buildAreaTitle(entry),
        tags: buildAreaTags(entry, data.length),
        chartType,
        data,
        fields,
        metadata,
        encodingMap,
    };
}

// ============================================================================
// Public exports
// ============================================================================

export function genAreaTests(): TestCase[] {
    const rand = seededRandom(910);
    return AREA_MATRIX.map(entry => areaMatrixToTestCase(entry, 'Area Chart', rand));
}

export function genStreamgraphTests(): TestCase[] {
    const rand = seededRandom(920);
    return STREAMGRAPH_MATRIX.map(entry => areaMatrixToTestCase(entry, 'Streamgraph', rand));
}
