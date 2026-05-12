// ECharts 专用调色板定义 + 选盘逻辑（backend 版 pickColorMap）。
// 这里承接 core/color-decisions.ts 中的抽象信息（schemeType / categoryCount / schemeId），
// 真正的「选哪个 palette」完全在 ECharts 层完成，并使用 ECharts 常用配色。

import type { ColorDecision, ColorMapType } from '../core/color-decisions';
import { DEFAULT_COLORS } from './templates/utils';

export type EChartsPaletteId = 'cat10' | 'cat20' | 'viridis' | 'RdBu' | string;

export interface EChartsColorMapDef {
    /** 全局 id，例如 'cat10'、'viridis'、'RdBu' */
    id: EChartsPaletteId;
    type: ColorMapType;
    /** 是否适合做离散 palette（分类 legend） */
    supportsDiscrete: boolean;
    /** 是否适合做连续色带（gradient） */
    supportsContinuous: boolean;
    /** 建议背景色 */
    background: 'light' | 'dark' | 'any';
    /** 是否推荐给色盲用户 */
    colorblindSafe?: boolean;
    /** 对 categorical：大致最大类别数 */
    maxCategories?: number;
    /** diverging 色带相关元数据 */
    diverging?: boolean;
    preferredMidpoint?: number;
    /** 实际颜色数组（按 ECharts 推荐配色定义） */
    colors: string[];
}

/**
 * ECharts 常用配色：
 * - cat10 / cat20：基于官方默认调色板 (`echarts~5` 默认 category palette) 扩展。
 * - viridis：在 ECharts 中没有内置同名 scheme，这里保留常见 viridis 色带，方便连续映射统一。
 * - RdBu：经典发散盘，适合正负对称的度量。
 */
const ECHARTS_COLOR_MAPS: EChartsColorMapDef[] = [
    {
        id: 'cat10',
        type: 'categorical',
        supportsDiscrete: true,
        supportsContinuous: false,
        background: 'any',
        maxCategories: 10,
        colorblindSafe: false,
        colors: [
            '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
            '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#d48265',
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
            '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
            '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#d48265',
            '#749f83', '#ca8622', '#bda29a', '#6e7074', '#546570',
            '#c4ccd3', '#4b565b', '#2f4554', '#61a0a8', '#c23531',
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
        colorblindSafe: false,
        diverging: true,
        preferredMidpoint: 0,
        colors: [
            '#b2182b', '#d6604d', '#f4a582', '#fddbc7',
            '#f7f7f7',
            '#d1e5f0', '#92c5de', '#4393c3', '#2166ac',
        ],
    },
];

function getMapById(id: EChartsPaletteId | undefined): EChartsColorMapDef | undefined {
    if (!id) return undefined;
    const key = String(id).toLowerCase();
    return ECHARTS_COLOR_MAPS.find(m => m.id.toLowerCase() === key);
}

export function getPaletteForScheme(id: EChartsPaletteId): string[] | undefined {
    const entry = getMapById(id);
    return entry?.colors;
}

/**
 * ECharts 侧的「选盘」函数：等价于 backend 版 pickColorMap。
 *
 * 输入：
 *   - ColorDecision：来自 core/color-decisions（已算好 schemeType / categoryCount / schemeId）。
 *
 * 策略（与原先 core 中的 pickColorMap 思路一致，但完全 ECharts 本地化）：
 *   1）若用户显式指定了 schemeId，则优先按该 id 取 palette（若存在）。
 *   2）否则根据 schemeType + categoryCount + colormap 元数据自动挑选合适的盘：
 *        - categorical：根据 maxCategories 与 categoryCount 匹配 cat10 / cat20；
 *        - sequential：优先选支持连续的顺序色带（viridis）；
 *        - diverging ：优先选标记了 diverging 的色带（RdBu）。
 *   3）若都无法命中，回退到 ECharts 的 DEFAULT_COLORS。
 */
export function pickEChartsPalette(decision: ColorDecision | undefined): string[] {
    if (!decision) {
        return DEFAULT_COLORS;
    }

    const { schemeType, schemeId, categoryCount } = decision;

    // 1. 用户 / 上层显式指定了 schemeId：直接尝试按 id 查表。
    if (schemeId) {
        const fromId = getPaletteForScheme(schemeId);
        if (fromId && fromId.length > 0) {
            return fromId;
        }
    }

    // 2. 自动路径：根据类型 / 类别数挑选本 backend 推荐盘。
    const mapsOfType = ECHARTS_COLOR_MAPS.filter(m => m.type === schemeType);

    if (schemeType === 'categorical') {
        const k = categoryCount ?? 0;
        if (mapsOfType.length) {
            // 先选「容量刚好够」的盘；若 maxCategories 缺失则认为无限容量。
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

    // 3. 最终兜底：ECharts 默认色盘。
    return DEFAULT_COLORS;
}


