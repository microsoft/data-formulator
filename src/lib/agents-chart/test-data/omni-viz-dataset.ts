// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Synthetic “product line” dataset for multiple chart types:
 * Grouped Bar, Scatter, Line (unix time), Pyramid, Rose, Sunburst, Waterfall.
 *
 * Canonical **detail** rows: Division × Product × Quarter × Channel (64 rows).
 * **periodStart**: Unix timestamp (seconds) at quarter start (UTC).
 * Revenue tiers keep strong spread but **floor raised** so low-volume products are not tiny.
 */

export interface OmniVizRow {
    division: string;
    product: string;
    /** Quarter label (e.g. Q1-2024) — used where a nominal time bucket is needed */
    quarter: string;
    /** Unix seconds, start of quarter (UTC) */
    periodStart: number;
    channel: string;
    revenue: number;
    units: number;
    /** Gross margin % (0–100), for scatter */
    marginPct: number;
}

const STRUCTURE = [
    { division: 'Cloud', products: ['API Platform', 'Compute', 'SaaS Bundle'] as const },
    { division: 'Data', products: ['Lake', 'Warehouse', 'Stream'] as const },
    { division: 'Edge', products: ['Gateway', 'Sensor Hub'] as const },
] as const;

const QUARTERS = ['Q1-2024', 'Q2-2024', 'Q3-2024', 'Q4-2024'] as const;
const CHANNELS = ['Direct', 'Partner'] as const;

/** Quarter start as Unix seconds (UTC), aligned to calendar quarters. */
export const OMNI_VIZ_QUARTER_PERIOD_START: Record<(typeof QUARTERS)[number], number> = {
    'Q1-2024': 1704067200, // 2024-01-01T00:00:00Z
    'Q2-2024': 1711929600, // 2024-04-01T00:00:00Z
    'Q3-2024': 1719792000, // 2024-07-01T00:00:00Z
    'Q4-2024': 1727740800, // 2024-10-01T00:00:00Z
};

/**
 * Revenue tier per product — still spans low→high, but **minimum ~0.58** (was ~0.34)
 * so the smallest lines are visibly larger while Lake/API stay dominant.
 */
const REV_WEIGHT: Record<string, number> = {
    'API Platform': 3.45,
    'Compute': 0.62,
    'SaaS Bundle': 2.0,
    'Lake': 4.45,
    'Warehouse': 0.68,
    'Stream': 1.1,
    'Gateway': 2.55,
    'Sensor Hub': 0.58,
};

/** Stable product order (matches STRUCTURE). */
export const OMNI_VIZ_PRODUCT_ORDER = [
    'API Platform',
    'Compute',
    'SaaS Bundle',
    'Lake',
    'Warehouse',
    'Stream',
    'Gateway',
    'Sensor Hub',
] as const;

export const OMNI_VIZ_DIVISION_ORDER = ['Cloud', 'Data', 'Edge'] as const;

/** Deterministic pseudo-random in [0,1) from string key (stable across runs). */
function stable01(key: string): number {
    let h = 2166136261;
    for (let i = 0; i < key.length; i += 1) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 2 ** 32;
}

function buildRows(): OmniVizRow[] {
    const out: OmniVizRow[] = [];
    for (const { division, products } of STRUCTURE) {
        for (const product of products) {
            const w = REV_WEIGHT[product] ?? 1;
            for (const quarter of QUARTERS) {
                const periodStart = OMNI_VIZ_QUARTER_PERIOD_START[quarter];
                for (const channel of CHANNELS) {
                    const key = `${division}|${product}|${quarter}|${channel}`;
                    const u = stable01(key);
                    const qBoost = quarter === 'Q4-2024' ? 1.12 : quarter === 'Q1-2024' ? 0.92 : 1;
                    const chBoost = channel === 'Direct' ? 1.18 : 1;
                    const revenue = Math.round((4200 + u * 9800) * w * qBoost * chBoost);
                    const units = Math.round(28 + u * 95 + w * 22 + (division === 'Edge' ? 18 : 0));
                    const marginPct = Math.round(
                        11 + u * 26 + (division === 'Cloud' ? 5 : 0) - (w > 3 ? 3 : w < 0.75 ? -2 : 0),
                    );
                    out.push({
                        division,
                        product,
                        quarter,
                        periodStart,
                        channel,
                        revenue,
                        units,
                        marginPct: Math.min(46, Math.max(10, marginPct)),
                    });
                }
            }
        }
    }
    return out;
}

/** Full detail: 8 products × 4 quarters × 2 channels = 64 rows. */
export const OMNI_VIZ_ROWS: OmniVizRow[] = buildRows();

/** Axis / level metadata for gallery encodings. */
export const OMNI_VIZ_LEVELS = {
    divisions: [...OMNI_VIZ_DIVISION_ORDER],
    products: [...OMNI_VIZ_PRODUCT_ORDER],
    quarters: [...QUARTERS],
    channels: [...CHANNELS],
    periodStarts: [...QUARTERS.map(q => OMNI_VIZ_QUARTER_PERIOD_START[q])],
} as const;

/** Plain record array for assemblers. */
export function omniVizDetailTable(): Record<string, unknown>[] {
    return OMNI_VIZ_ROWS.map(r => ({ ...r }));
}

/**
 * Three-level hierarchy for Sunburst: division → product → quarter; value = revenue (summed over channels).
 * ECharts encoding: color=division, detail=product, group=quarter, size=revenue.
 */
export function omniVizSunburstTable(): Record<string, unknown>[] {
    const sums = new Map<string, number>();
    for (const r of OMNI_VIZ_ROWS) {
        const k = `${r.division}\0${r.product}\0${r.quarter}`;
        sums.set(k, (sums.get(k) ?? 0) + r.revenue);
    }
    const out: Record<string, unknown>[] = [];
    for (const [k, revenue] of sums) {
        const [division, product, quarter] = k.split('\0');
        out.push({ division, product, quarter, revenue });
    }
    return out.sort((a, b) =>
        String(a.division).localeCompare(String(b.division))
        || OMNI_VIZ_PRODUCT_ORDER.indexOf(String(a.product) as (typeof OMNI_VIZ_PRODUCT_ORDER)[number])
        - OMNI_VIZ_PRODUCT_ORDER.indexOf(String(b.product) as (typeof OMNI_VIZ_PRODUCT_ORDER)[number])
        || QUARTERS.indexOf(String(a.quarter) as (typeof QUARTERS)[number])
        - QUARTERS.indexOf(String(b.quarter) as (typeof QUARTERS)[number]),
    );
}

/** Long format for Pyramid / grouped bar: totals per product × channel. */
export function omniVizPyramidLongTable(): Record<string, unknown>[] {
    const sums = new Map<string, number>();
    for (const r of OMNI_VIZ_ROWS) {
        const k = `${r.product}\0${r.channel}`;
        sums.set(k, (sums.get(k) ?? 0) + r.revenue);
    }
    const out: Record<string, unknown>[] = [];
    for (const [k, revenue] of sums) {
        const [product, channel] = k.split('\0');
        out.push({ product, channel, revenue });
    }
    return out.sort((a, b) =>
        OMNI_VIZ_PRODUCT_ORDER.indexOf(String(a.product) as (typeof OMNI_VIZ_PRODUCT_ORDER)[number])
        - OMNI_VIZ_PRODUCT_ORDER.indexOf(String(b.product) as (typeof OMNI_VIZ_PRODUCT_ORDER)[number])
        || String(a.channel).localeCompare(String(b.channel)),
    );
}

/** Rose: one sector per product — strongly unequal totals (8 categories). */
export function omniVizRoseTable(): Record<string, unknown>[] {
    const sums = new Map<string, number>();
    for (const r of OMNI_VIZ_ROWS) {
        sums.set(r.product, (sums.get(r.product) ?? 0) + r.revenue);
    }
    return OMNI_VIZ_PRODUCT_ORDER.map(product => ({
        product,
        revenue: sums.get(product) ?? 0,
    }));
}

/** Line: periodStart × product, revenue summed over channels (temporal x). */
export function omniVizLineTable(): Record<string, unknown>[] {
    const sums = new Map<string, number>();
    for (const r of OMNI_VIZ_ROWS) {
        const k = `${r.periodStart}\0${r.product}`;
        sums.set(k, (sums.get(k) ?? 0) + r.revenue);
    }
    const out: Record<string, unknown>[] = [];
    for (const [k, revenue] of sums) {
        const [ps, product] = k.split('\0');
        out.push({ periodStart: Number(ps), product, revenue });
    }
    return out.sort((a, b) =>
        Number(a.periodStart) - Number(b.periodStart)
        || OMNI_VIZ_PRODUCT_ORDER.indexOf(String(a.product) as (typeof OMNI_VIZ_PRODUCT_ORDER)[number])
        - OMNI_VIZ_PRODUCT_ORDER.indexOf(String(b.product) as (typeof OMNI_VIZ_PRODUCT_ORDER)[number]),
    );
}

/**
 * Waterfall: ARR bridge by division (Opening → +Cloud/+Data/+Edge → Closing).
 * Uses actual summed revenue from OMNI_VIZ_ROWS; explicit Type for VL/EC templates.
 */
export function omniVizWaterfallTable(): Record<string, unknown>[] {
    const byDiv = new Map<string, number>();
    for (const r of OMNI_VIZ_ROWS) {
        byDiv.set(r.division, (byDiv.get(r.division) ?? 0) + r.revenue);
    }
    const cloud = byDiv.get('Cloud') ?? 0;
    const data = byDiv.get('Data') ?? 0;
    const edge = byDiv.get('Edge') ?? 0;
    const increment = cloud + data + edge;
    const opening = Math.round(increment * 0.48);
    const closing = opening + increment;
    return [
        { Step: 'Opening ARR', Amount: opening, Type: 'start' },
        { Step: 'Cloud', Amount: cloud, Type: 'delta' },
        { Step: 'Data', Amount: data, Type: 'delta' },
        { Step: 'Edge', Amount: edge, Type: 'delta' },
        { Step: 'Closing ARR', Amount: closing, Type: 'end' },
    ];
}
