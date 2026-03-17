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

export type ColorChannel = 'color' | 'group' | 'fill' | 'stroke';

export interface ColorDecision {
    channel: ColorChannel;
    schemeType: ColorMapType;
    /**
     * 具体 colormap 标识：
     *   - 当用户在 encoding.scheme 中显式指定时，这里会带上该 id（如 'viridis'）。
     *   - 自动决策路径下，core 不再选择具体 id，schemeId 留空，由各后端的 colormap
     *     模块根据 schemeType / categoryCount / backend 主题自行挑选合适的 palette。
     */
    schemeId?: string;
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
// 通道级颜色决策
// -----------------------------------------------------------------------------

interface DecideColorMapsContext {
    chartType: string;
    encodings: Record<string, ChartEncoding>;
    channelSemantics: Record<string, ChannelSemantics>;
    table: any[];
    // backend: 'vegalite' | 'echarts' | 'chartjs';
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
            // 若语义为 Rank，则更适合作为连续数轴上的等级映射，
            // 使用 continuous colormap（sequential），否则按普通类别处理。
            const semType = cs?.semanticAnnotation?.semanticType;
            const isRankLike = semType === 'Rank';
            if (isRankLike) {
                return { schemeType: 'sequential' };
            }

            if (cs?.type === 'temporal' && channel === 'color') {
                return { schemeType: 'sequential' };
            }
            return { schemeType: 'categorical' };
        }
    }

    // 没 hint 时，用语义 + encoding type 兜底
    const encType = cs?.type;
    const semType = cs?.semanticAnnotation?.semanticType;

    // 相关系数 [-1,1] 等「双向度量」优先使用发散色带，以 0 为中点。
    if (semType === 'Correlation') {
        return { schemeType: 'diverging', divergingMidpoint: 0 };
    }

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
        const distinct = countDistinctValues(ctx.table, cs.field);
        // 用户显式指定 scheme 时，core 只透传 id，并根据 ChannelSemantics 推断类型；
        // 真正选择调色板由各后端的 colormap 模块完成。
        const { schemeType } = decideSchemeTypeFromChannel(channel, cs);
        return {
            channel,
            schemeType,
            schemeId: encoding.scheme,
            categoryCount: distinct,
            primary,
            dataDriven,
        };
    }

    // 2. 基于 ChannelSemantics.colorScheme 的 family 决策
    const { schemeType, divergingMidpoint } = decideSchemeTypeFromChannel(channel, cs);
    const distinct = countDistinctValues(ctx.table, cs.field);

    return {
        channel,
        schemeType,
        divergingMidpoint,
        categoryCount: distinct,
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