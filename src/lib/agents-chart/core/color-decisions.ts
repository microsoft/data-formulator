// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
+ * =============================================================================
+ * COLOR DECISIONS (backend-agnostic)
+ * =============================================================================
+ *
+ * Pure decision layer for choosing colormaps based on:
+ *   - Field semantics (FieldSemantics / ColorSchemeHint)
+ *   - Channel semantics (ChannelSemantics)
+ *   - Chart type & encodings
+ *   - Data statistics (distinct count, numeric range)
+ *
+ * This module does NOT know about Vega-Lite / ECharts syntax.
+ * It only returns abstract colormap identifiers and palette needs.
+ * Backends translate these decisions into concrete scale/option config.
+ * =============================================================================
+ */

import type { ChartEncoding, ChannelSemantics } from './types';

// -----------------------------------------------------------------------------
// 公共类型
// -----------------------------------------------------------------------------

export type ColorMapType = 'categorical' | 'sequential' | 'diverging';

export interface ColorMapDef {
    /** 全局唯一 id，例如 'cat10', 'viridis', 'RdBu' */
    id: string;
    type: ColorMapType;
    /** 是否适合做离散 palette（分类 legend） */
    supportsDiscrete: boolean;
    /** 是否适合做连续色带（gradient） */
    supportsContinuous: boolean;
    /** 仅 diverging 相关元数据 */
    diverging?: boolean;
    preferredMidpoint?: number;
    /** 建议背景色 */
    background: 'light' | 'dark' | 'any';
    /** 其它元数据 */
    maxCategories?: number;
    colorblindSafe?: boolean;
    /** 实际颜色数组（统一注册表） */
    colors: string[];
}

export interface ColorMapQuery {
    type: ColorMapType;
    categoryCount?: number;
    preferColorblindSafe?: boolean;
    background?: 'light' | 'dark';
    divergingMidpoint?: number;
    chartType?: string;
}

export interface ColorMapSelection {
    map: ColorMapDef;
    /** 对离散场景：实际打算用多少个颜色 */
    discreteCount?: number;
}

export type ColorChannel = 'color' | 'group' | 'fill' | 'stroke';

export interface ColorDecision {
    channel: ColorChannel;
    schemeType: ColorMapType;
    schemeId: string;
    divergingMidpoint?: number;
    categoryCount?: number;
    /** 是否是主编码（影响后续主题/对比度策略） */
    primary: boolean;
    /** 是否是数据驱动的颜色（而非常量色） */
    dataDriven: boolean;
}

/**
 * 一个后端无关的颜色决策结果：按 channel 存一份。
 */
export interface ColorDecisionResult {
    color?: ColorDecision;
    group?: ColorDecision;
    fill?: ColorDecision;
    stroke?: ColorDecision;
}

// -----------------------------------------------------------------------------
// 最小内置 colormap 注册表
// -----------------------------------------------------------------------------

const COLOR_MAPS: ColorMapDef[] = [
    // Categorical palettes
    {
        id: 'cat10',
        type: 'categorical',
        supportsDiscrete: true,
        supportsContinuous: false,
        background: 'any',
        maxCategories: 10,
        colorblindSafe: true,
        colors: [
            '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
            '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
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
            '#4e79a7', '#a0cbe8', '#f28e2b', '#ffbe7d', '#59a14f', '#8cd17d',
            '#b6992d', '#f1ce63', '#499894', '#86bcb6', '#e15759', '#ff9d9a',
            '#79706e', '#bab0ac', '#d37295', '#fabfd2', '#b07aa1', '#d4a6c8',
            '#9d7660', '#cee0b4',
        ],
    },

    // Sequential
    {
        id: 'viridis',
        type: 'sequential',
        supportsDiscrete: true,
        supportsContinuous: true,
        background: 'any',
        colorblindSafe: true,
        // 取标准 viridis 色带中的若干 representative 取样点
        colors: [
            '#440154', '#482878', '#3e4989', '#31688e',
            '#26828e', '#1f9e89', '#35b779', '#6ece58',
            '#b5de2b', '#fde725',
        ],
    },

    // Diverging
    {
        id: 'RdBu',
        type: 'diverging',
        supportsDiscrete: true,
        supportsContinuous: true,
        diverging: true,
        background: 'any',
        colorblindSafe: true,
        // RdBu 11 色（ColorBrewer 经典配置）
        colors: [
            '#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#f7f7f7',
            '#d1e5f0', '#92c5de', '#4393c3', '#2166ac',
        ],
    },
];

function findColorMap(id: string | undefined): ColorMapDef | undefined {
    if (!id) return undefined;
    return COLOR_MAPS.find(m => m.id.toLowerCase() === id.toLowerCase());
}

/**
 * 根据查询条件从注册表中挑出一个 colormap。
 */
export function pickColorMap(query: ColorMapQuery): ColorMapSelection {
    const background = query.background ?? 'light';
    const preferSafe = query.preferColorblindSafe ?? true;

    const candidates = COLOR_MAPS.filter(m => {
        if (m.type !== query.type) return false;
        if (background === 'light' && m.background === 'dark') return false;
        if (background === 'dark' && m.background === 'light') return false;
        if (preferSafe && m.colorblindSafe === false) return false;
        return true;
    });

    if (candidates.length === 0) {
        const anyType = COLOR_MAPS.find(m => m.type === query.type);
        if (anyType) return { map: anyType, discreteCount: query.categoryCount };
        return { map: COLOR_MAPS[0], discreteCount: query.categoryCount };
    }

    // categorical 时尽量选“容量刚好够”的 palette
    if (query.type === 'categorical' && query.categoryCount != null) {
        const byCapacity = candidates
            .filter(m => m.maxCategories == null || m.maxCategories >= query.categoryCount!)
            .sort((a, b) => (a.maxCategories ?? Infinity) - (b.maxCategories ?? Infinity));
        if (byCapacity.length > 0) {
            return { map: byCapacity[0], discreteCount: query.categoryCount };
        }
    }

    // diverging 时优先选标记了 diverging 的方案
    if (query.type === 'diverging') {
        const divergingFirst = candidates.find(m => m.diverging);
        if (divergingFirst) {
            return { map: divergingFirst, discreteCount: query.categoryCount };
        }
    }

    return { map: candidates[0], discreteCount: query.categoryCount };
}

/**
 * 根据 schemeId 获取统一注册表中的颜色数组。
 */
export function getPaletteForScheme(id: string): string[] | undefined {
    const entry = findColorMap(id);
    return entry?.colors;
}

// -----------------------------------------------------------------------------
// 通道级颜色决策
// -----------------------------------------------------------------------------

interface DecideColorMapsContext {
    chartType: string;
    encodings: Record<string, ChartEncoding>;
    channelSemantics: Record<string, ChannelSemantics>;
    table: any[];
    backend: 'vegalite' | 'echarts' | 'chartjs';
    background?: 'light' | 'dark';
}

function inferColorChannelPrimary(channel: ColorChannel, chartType: string): boolean {
    // 目前简单：color / group 视为主色通道
    if (channel === 'color' || channel === 'group') return true;
    return false;
}

/**
 * 从 ChannelSemantics 推断需要的 scheme 类型（categorical / sequential / diverging）。
 */
function decideSchemeTypeFromChannel(
    channel: ColorChannel,
    cs: ChannelSemantics | undefined,
): { schemeType: ColorMapType; divergingMidpoint?: number } {
    const hint = cs?.colorScheme;
    if (hint) {
        // 若语义推荐是 diverging，则直接按发散处理。
        if (hint.type === 'diverging') {
            return {
                schemeType: 'diverging',
                // resolve-semantics 里用 domainMid 表示 diverging 中点
                divergingMidpoint: (hint as any).domainMid,
            };
        }
        // 若推荐为 sequential，则直接按顺序色带处理。
        if (hint.type === 'sequential') {
            return { schemeType: 'sequential' };
        }
        // 语义推荐为 categorical，但编码类型实际是 temporal 时，
        // 对 color 通道优先按连续时间轴处理，使用 sequential colormap，
        // 而不是一条一条离散颜色（防止 Date/Time 被当成类别色盘）。
        if (hint.type === 'categorical') {
            if (cs?.type === 'temporal' && channel === 'color') {
                return { schemeType: 'sequential' };
            }
            return { schemeType: 'categorical' };
        }
    }

    // 没 hint 时，用 encoding type 兜底
    const encType = cs?.type;
    if (encType === 'quantitative' || encType === 'temporal') {
        return { schemeType: 'sequential' };
    }

    return { schemeType: 'categorical' };
}

function countDistinctValues(table: any[], field: string | undefined): number | undefined {
    if (!field) return undefined;
    const set = new Set<any>();
    for (const row of table) {
        if (row == null) continue;
        set.add(row[field]);
    }
    return set.size;
}

function decideColorForChannel(
    channel: ColorChannel,
    ctx: DecideColorMapsContext,
): ColorDecision | undefined {
    const encoding = ctx.encodings[channel as string];
    const cs = ctx.channelSemantics[channel as string];

    // 没字段就不是数据驱动色，不做决策
    if (!encoding || !cs?.field) return undefined;

    const dataDriven = true;
    const primary = inferColorChannelPrimary(channel, ctx.chartType);

    // 1. 显式 scheme 优先
    if (encoding.scheme && encoding.scheme !== 'default') {
        const explicit = findColorMap(encoding.scheme);
        const distinct = countDistinctValues(ctx.table, cs.field);
        if (explicit) {
            return {
                channel,
                schemeType: explicit.type,
                schemeId: explicit.id,
                categoryCount: distinct,
                primary,
                dataDriven,
            };
        }
        // 注册表里没这个 id，就按“用户自定义 scheme 字符串”透传给后端
        return {
            channel,
            schemeType: 'categorical',
            schemeId: encoding.scheme,
            categoryCount: distinct,
            primary,
            dataDriven,
        };
    }

    // 2. 基于 ChannelSemantics.colorScheme 的 family 决策
    const { schemeType, divergingMidpoint } = decideSchemeTypeFromChannel(channel, cs);
    const distinct = countDistinctValues(ctx.table, cs.field);

    const query: ColorMapQuery = {
        type: schemeType,
        categoryCount: schemeType === 'categorical' ? distinct : undefined,
        background: ctx.background ?? 'light',
        divergingMidpoint,
        chartType: ctx.chartType,
    };

    const selection = pickColorMap(query);

    return {
        channel,
        schemeType,
        schemeId: selection.map.id,
        divergingMidpoint,
        categoryCount: selection.discreteCount ?? distinct,
        primary,
        dataDriven,
    };
}

/**
 * 主入口：根据 chart / encodings / channelSemantics / data 计算颜色决策。
 */
export function decideColorMaps(ctx: DecideColorMapsContext): ColorDecisionResult {
    const result: ColorDecisionResult = {
        color: undefined,
        group: undefined,
        fill: undefined,
        stroke: undefined,
    };

    // 目前只对 color / group 做决策，fill / stroke 预留
    const channels: ColorChannel[] = ['color', 'group'];
    for (const ch of channels) {
        const decision = decideColorForChannel(ch, ctx);
        if (decision) {
            result[ch] = decision;
        }
    }

    return result;
}