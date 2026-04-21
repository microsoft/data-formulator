// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Pyramid Chart — horizontal bar symmetric (mirror vegalite/templates/bar.ts pyramidChartDef).
 */

import { ChartTemplateDef } from '../../core/types';
import { extractCategories, getCategoryOrder } from './utils';

function rowMatchesColorGroup(row: any, colorField: string, groupVal: unknown): boolean {
    const raw = row[colorField];
    if (raw === groupVal) return true;
    if (raw == null || groupVal == null) return false;
    return String(raw) === String(groupVal);
}

export const ecPyramidChartDef: ChartTemplateDef = {
    chart: 'Pyramid Chart',
    template: { mark: 'bar', encoding: {} },
    channels: ['x', 'y', 'color'],
    markCognitiveChannel: 'length',
    declareLayoutMode: () => ({ axisFlags: { y: { banded: true } } }),
    instantiate: (spec, ctx) => {
        const { channelSemantics, table } = ctx;
        const xCS = channelSemantics.x;
        const yCS = channelSemantics.y;
        const xField = xCS?.field;
        const yField = yCS?.field;
        if (!xField || !yField) return;

        const yDiscrete = yCS?.type === 'nominal' || yCS?.type === 'ordinal';
        const catField = yDiscrete ? yField : xField;
        const valField = yDiscrete ? xField : yField;
        const colorField = channelSemantics.color?.field ?? channelSemantics.group?.field;

        const catChannel = yDiscrete ? 'y' : 'x';
        const ordinalSort =
            getCategoryOrder(ctx, catChannel)
            ?? (yDiscrete ? yCS?.ordinalSortOrder : xCS?.ordinalSortOrder);
        const categories = extractCategories(table, catField, ordinalSort);

        const sumPerCategory = (predicate?: (row: any) => boolean): number[] => {
            const valueMap = new Map<string, number>();
            for (const row of table) {
                if (predicate && !predicate(row)) continue;
                const cat = String(row[catField] ?? '');
                const v = row[valField];
                if (v != null && !isNaN(Number(v))) {
                    valueMap.set(cat, (valueMap.get(cat) ?? 0) + Number(v));
                }
            }
            return categories.map(cat => valueMap.get(cat) ?? 0);
        };

        let leftPos: number[];
        let rightPos: number[];
        let leftName: string | undefined;
        let rightName: string | undefined;

        if (colorField && table.length > 0) {
            const groups = [...new Set(table.map(r => r[colorField]))];
            const leftGroup = groups[0];
            const rightGroup = groups.length > 1 ? groups[1] : groups[0];
            leftPos = sumPerCategory(row => rowMatchesColorGroup(row, colorField, leftGroup));
            rightPos = sumPerCategory(row => rowMatchesColorGroup(row, colorField, rightGroup));
            leftName = String(leftGroup);
            rightName = String(rightGroup);

            if (groups.length > 2) {
                if (!spec._warnings) spec._warnings = [];
                spec._warnings.push({
                    severity: 'warning',
                    code: 'too-many-groups-pyramid',
                    message: `Pyramid chart works best with exactly 2 groups, but found ${groups.length} (${groups.map((g: string) => `'${g}'`).join(', ')}). Only the first two are shown.`,
                    channel: 'color',
                    field: colorField,
                });
            }
        } else {
            const values = sumPerCategory();
            leftPos = values;
            rightPos = values;
        }

        const leftData = leftPos.map(v => -v);
        const rightData = rightPos;

        const maxAbs = Math.max(0, ...leftData.map(Math.abs), ...rightData.map(Math.abs));

        // Shared axis look — x (value) and y (category) match.
        const axisLineStyle = { color: '#333', width: 1 };
        const tickLineStyle = { color: '#333', width: 1 };
        const labelFont = { fontSize: 11, color: '#333' };

        const yAxisStyle = {
            type: 'category' as const,
            data: categories,
            name: catField,
            nameLocation: 'middle' as const,
            nameGap: 40,
            nameTextStyle: { fontSize: 12, color: '#333' },
            boundaryGap: true,
            axisLine: { show: true, onZero: false, lineStyle: axisLineStyle },
            axisTick: {
                show: true,
                alignWithLabel: true,
                interval: 0,
                length: 6,
                lineStyle: tickLineStyle,
            },
            axisLabel: { ...labelFont },
            splitLine: { show: false },
        };

        const option: any = {
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: {
                type: 'value',
                name: valField,
                nameLocation: 'middle',
                nameGap: 28,
                nameTextStyle: { fontSize: 12, color: '#333' },
                axisLine: { show: true, lineStyle: axisLineStyle },
                axisTick: { show: true, length: 6, lineStyle: tickLineStyle },
                axisLabel: {
                    ...labelFont,
                    formatter: (v: number) => Math.abs(v).toString(),
                },
                splitLine: { show: false },
                ...(maxAbs > 0 ? { min: -maxAbs, max: maxAbs } : {}),
            },
            yAxis: yAxisStyle,
            series: [
                {
                    type: 'bar',
                    name: leftName,
                    data: leftData,
                    barGap: '-100%',
                },
                {
                    type: 'bar',
                    name: rightName,
                    data: rightData,
                    barGap: '-100%',
                },
            ],
        };

        // Channel titles: positioned in ecApplyLayoutToSpec from grid geometry (equal offset from x=0).
        if (leftName != null && rightName != null) {
            option._pyramidChannelHeader = leftName === rightName
                ? { mode: 'single' as const, text: leftName }
                : { mode: 'pair' as const, left: leftName, right: rightName };
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};
