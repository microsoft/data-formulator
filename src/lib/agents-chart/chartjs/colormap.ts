// Chart.js 专用调色板定义。
// 承接 core/color-decisions.ts 中的抽象 colormap 信息（schemeType / schemeId / categoryCount），
// 但真正的颜色数组与选盘策略完全在 Chart.js backend 本地实现，并尽量贴近 Chart.js 默认配色。

import type { ColorDecision, ColorMapType } from '../core/color-decisions';

export type ChartJsPaletteId = 'cat10' | 'cat20' | 'viridis' | 'RdBu' | string;

export interface ChartJsColorMapDef {
    id: ChartJsPaletteId;
    type: ColorMapType;
    supportsDiscrete: boolean;
    supportsContinuous: boolean;
    background: 'light' | 'dark' | 'any';
    colorblindSafe?: boolean;
    maxCategories?: number;
    diverging?: boolean;
    preferredMidpoint?: number;
    colors: string[]; // 使用 Chart.js 推荐的基础色（不含 alpha）
}

/**
 * Chart.js 常用的基础配色，基于官方文档中推荐的默认颜色集合：
 * https://www.chartjs.org/docs/latest/general/colors.html
 */
const CHARTJS_COLOR_MAPS: ChartJsColorMapDef[] = [
    {
        id: 'cat10',
        type: 'categorical',
        supportsDiscrete: true,
        supportsContinuous: false,
        background: 'any',
        maxCategories: 10,
        colorblindSafe: false,
        colors: [
            '#36a2eb', // blue
            '#ff6384', // red
            '#ffcd56', // yellow
            '#4bc0c0', // teal
            '#9966ff', // purple
            '#ff9f40', // orange
            '#2ecc71', // green
            '#34495e', // dark blue-grey
            '#e74c3c', // red-orange
            '#95a5a6', // grey
        ],
    },
    {
        id: 'cat20',
        type: 'categorical',
        supportsDiscrete: true,
        supportsContinuous: false,
        background: 'any',
        maxCategories: 20,
        colorblindSafe: false,
        colors: [
            '#36a2eb', '#9ad0f5',
            '#ff6384', '#ff99aa',
            '#ffcd56', '#ffe39f',
            '#4bc0c0', '#8fdede',
            '#9966ff', '#c3a3ff',
            '#ff9f40', '#ffc078',
            '#2ecc71', '#7ee2a8',
            '#34495e', '#5d6d7e',
            '#e74c3c', '#f1948a',
            '#95a5a6', '#cfd4d6',
        ],
    },
    {
        id: 'viridis',
        type: 'sequential',
        supportsDiscrete: true,
        supportsContinuous: true,
        background: 'any',
        colorblindSafe: true,
        colors: [
            '#440154', '#46327e', '#365c8d', '#277f8e',
            '#1fa187', '#4ac16d', '#a0da39', '#fde725',
        ],
    },
    {
        id: 'RdBu',
        type: 'diverging',
        supportsDiscrete: true,
        supportsContinuous: true,
        background: 'any',
        diverging: true,
        preferredMidpoint: 0,
        colors: [
            '#b2182b', '#d6604d', '#f4a582', '#fddbc7',
            '#f7f7f7',
            '#d1e5f0', '#92c5de', '#4393c3', '#2166ac',
        ],
    },
];

function getMapById(id: ChartJsPaletteId | undefined): ChartJsColorMapDef | undefined {
    if (!id) return undefined;
    const key = String(id).toLowerCase();
    return CHARTJS_COLOR_MAPS.find(m => m.id.toLowerCase() === key);
}

export function getPaletteForScheme(id: ChartJsPaletteId): string[] | undefined {
    const entry = getMapById(id);
    return entry?.colors;
}

/**
 * Chart.js 侧的「选盘」函数：等价于 backend 版 pickColorMap。
 *
 * 输入：
 *   - ColorDecision：来自 core/color-decisions（已算好 schemeType / categoryCount / schemeId）。
 *
 * 策略：
 *   1）若用户显式指定了 schemeId，则优先按该 id 取 palette。
 *   2）否则根据 schemeType + categoryCount 自动挑选合适的盘：
 *        - categorical：按类别数量在 cat10 / cat20 之间选；
 *        - sequential：优先 viridis；
 *        - diverging ：优先 RdBu。
 *   3）若都无法命中，回退到符合 Chart.js 习惯的默认 categorical palette（cat10）。
 */
export function pickChartJsPalette(decision: ColorDecision | undefined): string[] {
    if (!decision) {
        const fallback = getPaletteForScheme('cat10');
        return fallback && fallback.length ? fallback : [];
    }

    const { schemeType, schemeId, categoryCount } = decision;

    // 1. 显式 schemeId 优先。
    if (schemeId) {
        const fromId = getPaletteForScheme(schemeId);
        if (fromId && fromId.length > 0) {
            return fromId;
        }
    }

    // 2. 自动路径：根据类型 / 类别数挑选本 backend 推荐盘。
    const mapsOfType = CHARTJS_COLOR_MAPS.filter(m => m.type === schemeType);

    if (schemeType === 'categorical') {
        const k = categoryCount ?? 0;
        if (mapsOfType.length) {
            const candidates = mapsOfType.filter(m => m.supportsDiscrete);
            if (candidates.length) {
                const byCapacity = candidates
                    .filter(m => m.maxCategories == null || m.maxCategories >= k)
                    .sort((a, b) => (a.maxCategories ?? Infinity) - (b.maxCategories ?? Infinity));
                const picked = byCapacity[0] ?? candidates[0];
                if (picked.colors.length) {
                    return picked.colors;
                }
            }
        }
        const fallback = getPaletteForScheme('cat10');
        if (fallback && fallback.length) {
            return fallback;
        }
    } else if (schemeType === 'sequential') {
        const seq = mapsOfType.find(m => m.supportsContinuous) ?? getMapById('viridis');
        if (seq && seq.colors.length) {
            return seq.colors;
        }
    } else if (schemeType === 'diverging') {
        const divergingFirst = mapsOfType.find(m => m.diverging) ?? getMapById('RdBu');
        if (divergingFirst && divergingFirst.colors.length) {
            return divergingFirst.colors;
        }
    }

    // 3. 兜底：Chart.js 默认 categorical palette（cat10）。
    const fallback = getPaletteForScheme('cat10');
    return fallback && fallback.length ? fallback : [];
}

