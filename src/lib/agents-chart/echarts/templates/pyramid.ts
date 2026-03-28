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

        const option: any = {
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: {
                type: 'value',
                name: valField,
                axisTick: { show: true },
                axisLabel: { formatter: (v: number) => Math.abs(v).toString() },
                ...(maxAbs > 0 ? { min: -maxAbs, max: maxAbs } : {}),
            },
            yAxis: { type: 'category', data: categories, name: catField, axisTick: { show: true, alignWithLabel: true } },
            series: [
                {
                    type: 'bar',
                    name: leftName,
                    data: leftData,
                    itemStyle: { color: '#4e79a7' },
                    barGap: '-100%',
                },
                {
                    type: 'bar',
                    name: rightName,
                    data: rightData,
                    itemStyle: { color: '#e15759' },
                    barGap: '-100%',
                },
            ],
        };

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};
