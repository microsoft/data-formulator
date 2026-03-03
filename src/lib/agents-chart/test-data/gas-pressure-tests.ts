// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Gas pressure model test cases (docs/design-stretch-model.md §2).
 *
 * 3 × 3 matrix of scatter plots varying:
 *   Density:       sparse (50 pts)  ×  dense (500 pts)  ×  very dense (3000 pts)
 *   Distribution:  uniform          ×  single cluster   ×  two clusters
 *
 * All use Scatter Plot with quantitative X/Y so the gas pressure model
 * (not the spring model) drives canvas sizing.
 */

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom } from './generators';

// ---------------------------------------------------------------------------
// Data distribution generators
// ---------------------------------------------------------------------------

/** Uniform random in [0, 100] × [0, 100] */
function genUniform(n: number, seed: number): { x: number; y: number }[] {
    const rand = seededRandom(seed);
    return Array.from({ length: n }, () => ({
        x: Math.round(rand() * 1000) / 10,
        y: Math.round(rand() * 1000) / 10,
    }));
}

/** 70% of points in a tight cluster at (70, 70), rest spread uniformly */
function genSingleCluster(n: number, seed: number): { x: number; y: number }[] {
    const rand = seededRandom(seed);
    const clusterN = Math.round(n * 0.7);
    const points: { x: number; y: number }[] = [];

    // Dense cluster centered at (70, 70), σ ≈ 5
    for (let i = 0; i < clusterN; i++) {
        // Box-Muller approximation using seeded rand
        const u1 = rand() || 0.001;
        const u2 = rand();
        const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
        points.push({
            x: Math.round((70 + z0 * 5) * 10) / 10,
            y: Math.round((70 + z1 * 5) * 10) / 10,
        });
    }

    // Sparse background
    for (let i = clusterN; i < n; i++) {
        points.push({
            x: Math.round(rand() * 1000) / 10,
            y: Math.round(rand() * 1000) / 10,
        });
    }
    return points;
}

/** Two clusters: 40% at (25, 25) σ≈5, 40% at (75, 75) σ≈5, 20% uniform */
function genTwoClusters(n: number, seed: number): { x: number; y: number }[] {
    const rand = seededRandom(seed);
    const c1N = Math.round(n * 0.4);
    const c2N = Math.round(n * 0.4);
    const points: { x: number; y: number }[] = [];

    const addCluster = (cx: number, cy: number, count: number) => {
        for (let i = 0; i < count; i++) {
            const u1 = rand() || 0.001;
            const u2 = rand();
            const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
            points.push({
                x: Math.round((cx + z0 * 5) * 10) / 10,
                y: Math.round((cy + z1 * 5) * 10) / 10,
            });
        }
    };

    addCluster(25, 25, c1N);
    addCluster(75, 75, c2N);

    // Sparse background
    for (let i = c1N + c2N; i < n; i++) {
        points.push({
            x: Math.round(rand() * 1000) / 10,
            y: Math.round(rand() * 1000) / 10,
        });
    }
    return points;
}

// ---------------------------------------------------------------------------
// Test case builder
// ---------------------------------------------------------------------------

const DENSITIES = [
    { label: 'Sparse', n: 50, tag: 'sparse' },
    { label: 'Dense', n: 500, tag: 'dense' },
    { label: 'Very Dense', n: 3000, tag: 'very-dense' },
] as const;

const DISTRIBUTIONS = [
    { label: 'Uniform', gen: genUniform, tag: 'uniform' },
    { label: 'Single Cluster', gen: genSingleCluster, tag: 'cluster-1' },
    { label: 'Two Clusters', gen: genTwoClusters, tag: 'cluster-2' },
] as const;

function buildTestCase(
    densityLabel: string,
    distLabel: string,
    n: number,
    data: { x: number; y: number }[],
    tags: string[],
): TestCase {
    const rows = data.map(p => ({ X: p.x, Y: p.y }));
    return {
        title: `${densityLabel} × ${distLabel} (N=${n})`,
        description: `${n} scatter points, ${distLabel.toLowerCase()} distribution. Tests gas pressure model §2.`,
        tags: ['gas-pressure', 'scatter', ...tags],
        chartType: 'Scatter Plot',
        data: rows,
        fields: [makeField('X'), makeField('Y')],
        metadata: {
            X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('X'),
            y: makeEncodingItem('Y'),
        },
    };
}

// ---------------------------------------------------------------------------
// Asymmetric density generators (X and Y have different spreads)
// ---------------------------------------------------------------------------

/** Wide X range [0,100], narrow Y range [45,55] — horizontal band */
function genWideXNarrowY(n: number, seed: number): { x: number; y: number }[] {
    const rand = seededRandom(seed);
    return Array.from({ length: n }, () => ({
        x: Math.round(rand() * 1000) / 10,
        y: Math.round((45 + rand() * 10) * 10) / 10,
    }));
}

/** Narrow X range [45,55], wide Y range [0,100] — vertical band */
function genNarrowXWideY(n: number, seed: number): { x: number; y: number }[] {
    const rand = seededRandom(seed);
    return Array.from({ length: n }, () => ({
        x: Math.round((45 + rand() * 10) * 10) / 10,
        y: Math.round(rand() * 1000) / 10,
    }));
}

/** Wide X [0,100], Y concentrated in two narrow bands [10-15] and [85-90] */
function genWideXBandedY(n: number, seed: number): { x: number; y: number }[] {
    const rand = seededRandom(seed);
    return Array.from({ length: n }, () => {
        const band = rand() < 0.5 ? 10 : 85;
        return {
            x: Math.round(rand() * 1000) / 10,
            y: Math.round((band + rand() * 5) * 10) / 10,
        };
    });
}

/** Diagonal stripe: Y ≈ X ± 3 — points cluster along the diagonal */
function genDiagonalStripe(n: number, seed: number): { x: number; y: number }[] {
    const rand = seededRandom(seed);
    return Array.from({ length: n }, () => {
        const base = rand() * 100;
        const u1 = rand() || 0.001;
        const u2 = rand();
        const noise = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * 3;
        return {
            x: Math.round(base * 10) / 10,
            y: Math.round((base + noise) * 10) / 10,
        };
    });
}

/** X uniform [0,100], Y exponential (most points near 0, tail to ~50) */
function genUniformXExponentialY(n: number, seed: number): { x: number; y: number }[] {
    const rand = seededRandom(seed);
    return Array.from({ length: n }, () => ({
        x: Math.round(rand() * 1000) / 10,
        y: Math.round(-Math.log(rand() || 0.001) * 10 * 10) / 10,
    }));
}

const ASYMMETRIC_CASES = [
    { label: 'Wide X, Narrow Y', gen: genWideXNarrowY, tag: 'wide-x-narrow-y',
      desc: 'X spans full range, Y compressed to 10% — horizontal band' },
    { label: 'Narrow X, Wide Y', gen: genNarrowXWideY, tag: 'narrow-x-wide-y',
      desc: 'X compressed to 10%, Y spans full range — vertical band' },
    { label: 'Wide X, Banded Y', gen: genWideXBandedY, tag: 'wide-x-banded-y',
      desc: 'X uniform, Y in two narrow bands — two horizontal stripes' },
    { label: 'Diagonal Stripe', gen: genDiagonalStripe, tag: 'diagonal',
      desc: 'Points along Y≈X diagonal with σ≈3 noise — linear cluster' },
    { label: 'Uniform X, Exp Y', gen: genUniformXExponentialY, tag: 'uniform-x-exp-y',
      desc: 'X uniform, Y exponential — bottom-heavy skew' },
] as const;

// ---------------------------------------------------------------------------
// Public generator
// ---------------------------------------------------------------------------

/**
 * Generate the 3×3 gas-pressure test matrix.
 * Row = density (sparse / dense / very dense)
 * Column = distribution (uniform / single cluster / two clusters)
 */
export function genGasPressureTests(): TestCase[] {
    const tests: TestCase[] = [];
    let seed = 1000;

    // --- Symmetric density tests (3×3 matrix) ---
    for (const density of DENSITIES) {
        for (const dist of DISTRIBUTIONS) {
            const points = dist.gen(density.n, seed++);
            tests.push(buildTestCase(
                density.label,
                dist.label,
                density.n,
                points,
                [density.tag, dist.tag],
            ));
        }
    }

    // --- Asymmetric X/Y density tests ---
    // Uses dense (500) and very dense (3000) to show the effect clearly
    for (const asym of ASYMMETRIC_CASES) {
        for (const density of [DENSITIES[1], DENSITIES[2]]) {
            const points = asym.gen(density.n, seed++);
            tests.push({
                ...buildTestCase(
                    density.label,
                    asym.label,
                    density.n,
                    points,
                    [density.tag, asym.tag, 'asymmetric'],
                ),
                description: `${density.n} points, ${asym.desc}.`,
            });
        }
    }

    // --- Per-axis stretch tests: stretch X but not Y ---
    // Case 1: Many evenly-spaced X values, few distinct Y values.
    // 1000 points on 200 unique X positions × 5 Y rows → X is dense, Y is sparse.
    {
        const r = seededRandom(seed++);
        const yLevels = [10, 30, 50, 70, 90];
        const n = 1000;
        const points = Array.from({ length: n }, () => ({
            x: Math.round(r() * 1000) / 10,        // 0–100, ~200 unique
            y: yLevels[Math.floor(r() * yLevels.length)],  // only 5 values
        }));
        tests.push({
            ...buildTestCase('Dense', 'Stretch X Only (rows)', n, points,
                ['dense', 'stretch-x', 'per-axis']),
            description: '1000 points on ~200 unique X positions but only 5 Y rows. X should stretch, Y should not.',
        });
    }

    // Case 2: Dense horizontal cluster at center, full Y range.
    // 800 points with X clustered in [40,60] (σ≈3) but Y uniform [0,100].
    // X is over-packed in a narrow horizontal band → stretch X.
    // Y is well-spread → no Y stretch needed.
    {
        const r = seededRandom(seed++);
        const n = 800;
        const points = Array.from({ length: n }, () => {
            const u1 = r() || 0.001;
            const u2 = r();
            const zx = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            return {
                x: Math.round((50 + zx * 3) * 10) / 10,   // tight around 50, σ≈3
                y: Math.round(r() * 1000) / 10,             // uniform 0–100
            };
        });
        tests.push({
            ...buildTestCase('Dense', 'Stretch X Only (cluster)', n, points,
                ['dense', 'stretch-x', 'per-axis', 'cluster-x']),
            description: '800 points with X clustered at 50±3 but Y uniform [0,100]. X is over-packed, Y is fine.',
        });
    }

    // --- maintainContinuousAxisRatio tests ---
    // Same data as "Stretch X Only (rows)" but with the ratio lock on:
    // both axes should stretch together using the larger factor.
    {
        const r = seededRandom(seed++);
        const yLevels = [10, 30, 50, 70, 90];
        const n = 1000;
        const points = Array.from({ length: n }, () => ({
            x: Math.round(r() * 1000) / 10,
            y: yLevels[Math.floor(r() * yLevels.length)],
        }));
        tests.push({
            ...buildTestCase('Dense', 'Ratio Lock ON (rows)', n, points,
                ['dense', 'ratio-lock', 'per-axis']),
            description: '1000 points, 200 X positions × 5 Y rows, maintainContinuousAxisRatio=true. Both axes stretch equally.',
            assembleOptions: { maintainContinuousAxisRatio: true },
        });
    }
    // Same data without ratio lock for comparison
    {
        const r = seededRandom(seed++);
        const yLevels = [10, 30, 50, 70, 90];
        const n = 1000;
        const points = Array.from({ length: n }, () => ({
            x: Math.round(r() * 1000) / 10,
            y: yLevels[Math.floor(r() * yLevels.length)],
        }));
        tests.push({
            ...buildTestCase('Dense', 'Ratio Lock OFF (rows)', n, points,
                ['dense', 'no-ratio-lock', 'per-axis']),
            description: '1000 points, 200 X positions × 5 Y rows, default independent stretch. X stretches, Y does not.',
        });
    }

    return tests;
}
