// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Synthetic **game operations** panel for a three-phase gallery story:
 * (1) overview — line + regional grouped bar on MAU; (2) change — monthly waterfall + game×month heatmap;
 * (3) composition — ECharts sunburst region → gameType → game (Dec totalUsers).
 *
 * **Detail rows**: Period × Game × Region; `period` is `2025-01` … `2025-12`; ≤24 games, 6 `gameType` values; regions N|E|S|W.
 * MAU stocks use {@link OMNI_VIZ_STOCK_SCALE} so waterfall opening/closing are comparable to monthly net-add on one axis.
 * Net-add seasonality follows {@link narrativeMonthFlowMultiplier} (calendar month): 1–2 increase step-up; 3–5 decrease
 * easing; 6–8 increase fading; 9–10 decrease easing; 11–12 increase.
 */

export interface OmniVizRow {
    /** Year-month `YYYY-MM` (2025-01 … 2025-12) */
    period: string;
    game: string;
    gameType: string;
    /** Net new (may be negative) */
    newUsers: number;
    /** End-of-month MAU stock */
    totalUsers: number;
    region: (typeof OMNI_VIZ_REGIONS)[number];
}

export const OMNI_VIZ_MONTHS = [
    '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
    '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
] as const;

export const OMNI_VIZ_REGIONS = ['N', 'E', 'S', 'W'] as const;

export const OMNI_VIZ_GAME_TYPES = [
    'Mobile Casual',
    'Mobile Midcore',
    'PC / Client',
    'Console',
    'Cross-platform',
    'Web / Mini-game',
] as const;

export const OMNI_VIZ_GAME_ORDER = [
    'Starforge Tactics',
    'Neon Drift 2049',
    'Pocket Kingdoms',
    'Azure Legends',
    'Dustwind Arena',
    'Circuit Breakers',
    'Moonlit Odyssey',
    'Granite & Glyphs',
    'Velvet Racing Club',
    'Echoes of Athera',
    'Snack Stack Saga',
    'Ironbound Front',
    'Sakura Stage Live',
    'Deepline Submarine',
    'Pixel Farmers Co-op',
    'Void Choir Online',
    'Metro Hustle',
    'Coral Reef Builder',
    'Blade Symphony X',
    'Quiet Hours VR',
    'Turbo Kart Universe',
    'Guildfall Chronicles',
    'Match-3 Museum',
    'Northwind Survival',
] as const;

/**
 * Pull down initial MAU so portfolio **opening / closing** in the waterfall sit closer to **monthly net-add**
 * magnitudes; otherwise the start/end totals dwarf increase/decrease bars on a shared linear axis.
 */
const OMNI_VIZ_STOCK_SCALE = 0.1;
/** Floor for MAU after net flow (keep small when stock scale is low). */
const OMNI_VIZ_MAU_FLOOR = 150;

/**
 * Additive shift per row: `(narrative - 1) * this`. Raw `rawFlow` stays **too positive on average** even when
 * narrative below 1, so monthly sum(newUsers) rarely went negative and the ECharts waterfall showed no red decrease.
 * This anchors the portfolio to the intended month direction while keeping per-cell noise.
 */
/** Larger ⇒ waterfall **decrease** (and **increase**) steps are taller on the shared Y axis. */
const OMNI_VIZ_NARRATIVE_ANCHOR_PER_UNIT = 15200;

/** Fraction of detail cells that take an extra random net-loss bump (stable hash — reproducible). */
const OMNI_VIZ_RANDOM_CELL_NEG_P = 0.17;
/** Fraction of months where every row gets an extra portfolio slump (stable hash per YYYY-MM). */
const OMNI_VIZ_RANDOM_MONTH_SLUMP_P = 0.26;

/**
 * Month-of-year shape for **portfolio net adds** (multiplies per-cell raw flow; 1 = neutral).
 * 1–2：increase 逐渐变大；3–5：decrease 逐渐减小（跌幅逐月缓和）；6–8：increase 逐渐减小（增幅逐月减弱）；
 * 9–10：decrease 逐渐减小；11–12：increase。
 */
function narrativeMonthFlowMultiplier(monthNum: number): number {
    switch (monthNum) {
        case 1: return 1.06;
        case 2: return 1.16; // 二月高于一月，increase 逐月变大
        case 3: return 0.56; // 3–5 下跌，跌幅逐月减小（乘子逐月抬高、靠近 1）
        case 4: return 0.68;
        case 5: return 0.80;
        case 6: return 1.22; // 6–8 上涨，增幅逐月减小（乘子逐月降低，仍大于 1）
        case 7: return 1.12;
        case 8: return 1.04;
        case 9: return 0.58; // 9–10 下跌，跌幅逐月减小
        case 10: return 0.74;
        case 11: return 1.08; // 11–12 increase
        case 12: return 1.14;
        default: return 1;
    }
}

const GAME_TYPE_BY_GAME: Record<(typeof OMNI_VIZ_GAME_ORDER)[number], (typeof OMNI_VIZ_GAME_TYPES)[number]> = {
    'Starforge Tactics': 'PC / Client',
    'Neon Drift 2049': 'Console',
    'Pocket Kingdoms': 'Mobile Casual',
    'Azure Legends': 'Cross-platform',
    'Dustwind Arena': 'PC / Client',
    'Circuit Breakers': 'Console',
    'Moonlit Odyssey': 'Cross-platform',
    'Granite & Glyphs': 'PC / Client',
    'Velvet Racing Club': 'Console',
    'Echoes of Athera': 'Mobile Midcore',
    'Snack Stack Saga': 'Mobile Casual',
    'Ironbound Front': 'Mobile Midcore',
    'Sakura Stage Live': 'Mobile Casual',
    'Deepline Submarine': 'Web / Mini-game',
    'Pixel Farmers Co-op': 'Web / Mini-game',
    'Void Choir Online': 'PC / Client',
    'Metro Hustle': 'Mobile Midcore',
    'Coral Reef Builder': 'Mobile Casual',
    'Blade Symphony X': 'Console',
    'Quiet Hours VR': 'PC / Client',
    'Turbo Kart Universe': 'Cross-platform',
    'Guildfall Chronicles': 'Mobile Midcore',
    'Match-3 Museum': 'Mobile Casual',
    'Northwind Survival': 'Cross-platform',
};

function stable01(key: string): number {
    let h = 2166136261;
    for (let i = 0; i < key.length; i += 1) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 2 ** 32;
}

function regionScale(region: (typeof OMNI_VIZ_REGIONS)[number]): number {
    switch (region) {
        case 'N': return 1.22;
        case 'E': return 1.15;
        case 'S': return 0.95;
        case 'W': return 0.78;
        default: return 1;
    }
}

function gamePopularity(game: (typeof OMNI_VIZ_GAME_ORDER)[number]): number {
    const u = stable01(`pop|${game}`);
    return 0.55 + u * 0.95;
}

function buildRows(): OmniVizRow[] {
    const out: OmniVizRow[] = [];
    const stock = new Map<string, number>();

    for (const game of OMNI_VIZ_GAME_ORDER) {
        const gameType = GAME_TYPE_BY_GAME[game];
        const pop = gamePopularity(game);
        for (const region of OMNI_VIZ_REGIONS) {
            const k = `${game}\0${region}`;
            const u0 = stable01(`base|${k}`);
            const baseMau = Math.round(
                (9000 + u0 * 52000) * pop * regionScale(region) * OMNI_VIZ_STOCK_SCALE,
            );
            stock.set(k, baseMau);
        }
    }

    for (const period of OMNI_VIZ_MONTHS) {
        const monthNum = Number(period.slice(5, 7));
        const narrative = narrativeMonthFlowMultiplier(monthNum);

        for (const game of OMNI_VIZ_GAME_ORDER) {
            const gameType = GAME_TYPE_BY_GAME[game];
            const pop = gamePopularity(game);
            for (const region of OMNI_VIZ_REGIONS) {
                const k = `${game}\0${region}`;
                const keyNu = `${period}|${k}`;
                const u = stable01(keyNu);
                const u2 = stable01(`nu2|${keyNu}`);
                const uVol = stable01(`vol|${keyNu}`);

                // Wider baseline swing; seasonality amplified.
                const rawFlow =
                    (-350 + u * 5200)
                    * pop
                    * regionScale(region)
                    * narrative
                    * (gameType.includes('Mobile') ? 1.1 : gameType.includes('Web') ? 0.82 : 1);

                // Per-cell volatility burst: dull months vs hot months (deterministic).
                const vol = uVol < 0.1 ? 0.38 + u * 0.22 : uVol > 0.9 ? 1.55 + u * 0.95 : 0.62 + u2 * 1.05;

                let newUsers = Math.round(rawFlow * vol - 250);

                // Severe churn / outage-style months
                if (u2 < 0.065) {
                    newUsers -= Math.round(2200 + u * 11000);
                }
                // Launch-hype / campaign spike months
                if (u2 > 0.935) {
                    newUsers += Math.round(3200 + u * 14000);
                }

                newUsers += Math.round((narrative - 1) * OMNI_VIZ_NARRATIVE_ANCHOR_PER_UNIT);

                // Random-style negatives on any month (not only narrative below 1): churn / campaign end / noise.
                if (stable01(`cellNeg|${keyNu}`) < OMNI_VIZ_RANDOM_CELL_NEG_P) {
                    newUsers -= Math.round(420 + stable01(`cellNegAmt|${keyNu}`) * 5200);
                }
                if (stable01(`monthSlump|${period}`) < OMNI_VIZ_RANDOM_MONTH_SLUMP_P) {
                    newUsers -= Math.round(580 + stable01(`monthSlumpAmt|${period}`) * 3600);
                }

                const prev = stock.get(k) ?? 0;
                const next = Math.max(OMNI_VIZ_MAU_FLOOR, prev + newUsers);
                const actualDelta = next - prev;
                stock.set(k, next);

                out.push({
                    period,
                    game,
                    gameType,
                    newUsers: actualDelta,
                    totalUsers: next,
                    region,
                });
            }
        }
    }
    return out;
}

export const OMNI_VIZ_ROWS: OmniVizRow[] = buildRows();

export const OMNI_VIZ_LEVELS = {
    games: [...OMNI_VIZ_GAME_ORDER],
    gameTypes: [...OMNI_VIZ_GAME_TYPES],
    regions: [...OMNI_VIZ_REGIONS],
    months: [...OMNI_VIZ_MONTHS],
    periodStarts: [...OMNI_VIZ_MONTHS],
} as const;

const DEC_PERIOD = OMNI_VIZ_MONTHS[OMNI_VIZ_MONTHS.length - 1];

export function omniVizDetailTable(): Record<string, unknown>[] {
    return OMNI_VIZ_ROWS.map(r => ({ ...r }));
}

function sortByGame(a: Record<string, unknown>, b: Record<string, unknown>): number {
    const ia = OMNI_VIZ_GAME_ORDER.indexOf(String(a.game) as (typeof OMNI_VIZ_GAME_ORDER)[number]);
    const ib = OMNI_VIZ_GAME_ORDER.indexOf(String(b.game) as (typeof OMNI_VIZ_GAME_ORDER)[number]);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
}

/**
 * Phase 1 — Line: facet region; x = month; y = totalUsers (sum of MAU across games in each gameType bucket); color = gameType.
 * Different apps spike on different months → visible as diverging multi-series lines per panel.
 */
export function omniVizLineTable(): Record<string, unknown>[] {
    const sums = new Map<string, number>();
    for (const r of OMNI_VIZ_ROWS) {
        const key = `${r.region}\0${r.period}\0${r.gameType}`;
        sums.set(key, (sums.get(key) ?? 0) + r.totalUsers);
    }
    const out: Record<string, unknown>[] = [];
    for (const [key, totalUsers] of sums) {
        const [region, period, gameType] = key.split('\0');
        out.push({ region, period, gameType, totalUsers });
    }
    return out.sort((a, b) =>
        String(a.region).localeCompare(String(b.region))
        || String(a.period).localeCompare(String(b.period))
        || String(a.gameType).localeCompare(String(b.gameType)),
    );
}

/**
 * Phase 1 — Grouped bar: x = month; y = sum(totalUsers) across all regions/games; color & group = gameType.
 */
export function omniVizGroupedBarRegionGameTypeTable(): Record<string, unknown>[] {
    const sums = new Map<string, number>();
    for (const r of OMNI_VIZ_ROWS) {
        const k = `${r.period}\0${r.gameType}`;
        sums.set(k, (sums.get(k) ?? 0) + r.totalUsers);
    }
    const out: Record<string, unknown>[] = [];
    for (const [k, totalUsers] of sums) {
        const [period, gameType] = k.split('\0');
        out.push({ period, gameType, totalUsers });
    }
    return out.sort((a, b) =>
        String(a.period).localeCompare(String(b.period))
        || String(a.gameType).localeCompare(String(b.gameType)),
    );
}

/**
 * Phase 2 — Waterfall: opening MAU → each month’s portfolio net newUsers → closing MAU (year end).
 */
export function omniVizWaterfallTable(): Record<string, unknown>[] {
    const jan = OMNI_VIZ_MONTHS[0];
    let opening = 0;
    let closing = 0;
    for (const r of OMNI_VIZ_ROWS) {
        if (r.period === jan) opening += r.totalUsers - r.newUsers;
        if (r.period === DEC_PERIOD) closing += r.totalUsers;
    }
    const monthly = new Map<string, number>();
    for (const r of OMNI_VIZ_ROWS) {
        monthly.set(r.period, (monthly.get(r.period) ?? 0) + r.newUsers);
    }
    const rows: Record<string, unknown>[] = [
        { Step: 'Opening MAU (year start)', Amount: Math.round(opening), Type: 'start' },
    ];
    for (const period of OMNI_VIZ_MONTHS) {
        rows.push({ Step: period, Amount: monthly.get(period) ?? 0, Type: 'delta' });
    }
    rows.push({ Step: 'Closing MAU (year end)', Amount: Math.round(closing), Type: 'end' });
    return rows;
}

/**
 * Phase 2 — Heatmap: x = game, y = month, color = newUsers (summed over regions).
 */
export function omniVizHeatmapGameMonthTable(): Record<string, unknown>[] {
    const sums = new Map<string, number>();
    for (const r of OMNI_VIZ_ROWS) {
        const k = `${r.game}\0${r.period}`;
        sums.set(k, (sums.get(k) ?? 0) + r.newUsers);
    }
    const out: Record<string, unknown>[] = [];
    for (const [k, newUsers] of sums) {
        const [game, period] = k.split('\0');
        out.push({ game, period, newUsers });
    }
    return out.sort((a, b) =>
        sortByGame({ game: a.game }, { game: b.game })
        || String(a.period).localeCompare(String(b.period)),
    );
}

/**
 * Phase 3 — Sunburst (ECharts): region → gameType → game; leaf size = Dec totalUsers (composition).
 */
export function omniVizSunburstTable(): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const r of OMNI_VIZ_ROWS) {
        if (r.period !== DEC_PERIOD) continue;
        out.push({
            region: r.region,
            gameType: r.gameType,
            game: r.game,
            totalUsers: r.totalUsers,
        });
    }
    return out.sort((a, b) =>
        String(a.region).localeCompare(String(b.region))
        || String(a.gameType).localeCompare(String(b.gameType))
        || sortByGame({ game: a.game }, { game: b.game }),
    );
}
