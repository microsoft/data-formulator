// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Strip Plot — scatter with jitter on categorical axis (mirror vegalite/templates/jitter.ts).
 */

import { ChartTemplateDef } from '../../core/types';
import { extractCategories, groupBy, DEFAULT_COLORS } from './utils';

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

/** True if all category labels parse as numbers → horizontal; else vertical (align with line/bar). */
function areCategoriesNumeric(cats: string[]): boolean {
    if (cats.length === 0) return true;
    return cats.every((c) => {
        const s = String(c).trim();
        if (s === '') return false;
        const n = Number(s);
        return !isNaN(n) && isFinite(n);
    });
}

/** Seeded jitter for reproducible strip plot. */
function jitter(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return (s / 0x7fffffff) * 2 - 1;
    };
}

export const ecStripPlotDef: ChartTemplateDef = {
    chart: 'Strip Plot',
    template: { mark: 'circle', encoding: {} },
    channels: ['x', 'y', 'color', 'size', 'column', 'row'],
    markCognitiveChannel: 'position',
    declareLayoutMode: () => ({
        paramOverrides: { defaultStepMultiplier: 2, minStep: 16 },
    }),
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const xCS = channelSemantics.x;
        const yCS = channelSemantics.y;
        const xField = xCS?.field;
        const yField = yCS?.field;
        const colorField = channelSemantics.color?.field;

        if (!xField || !yField) return;

        const xIsDiscrete = isDiscrete(xCS?.type);
        const yIsDiscrete = isDiscrete(yCS?.type);
        const catAxis = xIsDiscrete ? 'x' : yIsDiscrete ? 'y' : 'x';
        const contAxis = catAxis === 'x' ? 'y' : 'x';
        const catField = catAxis === 'x' ? xField : yField;
        const contField = contAxis === 'x' ? xField : yField;

        const categories = extractCategories(table, catField!, (catAxis === 'x' ? xCS : yCS)?.ordinalSortOrder);
        const catToIndex = new Map(categories.map((c, i) => [c, i]));
        // Jitter in band [i, i+1]. ECharts category axis only accepts integer indices so jitter is invisible;
        // use value axis with range [0, n] and formatter so fractional x/y are rendered.
        const jitterHalfWidth = 0.5;
        const rand = jitter(42);
        const nCat = categories.length;
        const catAxisLabel = () => ({
            interval: 0,
            rotate: areCategoriesNumeric(categories) ? 0 : 90,
            formatter: (value: number) => categories[Math.min(Math.floor(value), nCat - 1)] ?? '',
        });
        const valueAxisCommon = (name: string, nameGap: number) => ({
            type: 'value' as const,
            name,
            nameLocation: 'middle' as const,
            nameGap,
            axisTick: { show: true },
            axisLabel: { rotate: 0 },
        });
        const catAxisConfig = () => ({
            type: 'value' as const,
            name: catField,
            nameLocation: 'middle' as const,
            nameGap: 30,
            min: 0,
            max: nCat,
            interval: 1,
            axisTick: { show: true },
            axisLabel: catAxisLabel(),
        });

        const option: any = {
            tooltip: { trigger: 'item' },
            xAxis: catAxis === 'x' ? catAxisConfig() : valueAxisCommon(contField!, 30),
            yAxis: catAxis === 'y' ? catAxisConfig() : valueAxisCommon(contField!, 40),
            series: [],
        };

        const buildPoint = (row: any) => {
            const cat = String(row[catField!] ?? '');
            const idx = catToIndex.get(cat) ?? 0;
            const center = idx + 0.5;
            const offset = rand() * jitterHalfWidth;
            const x = catAxis === 'x' ? center + offset : row[contField];
            const y = catAxis === 'y' ? center + offset : row[contField];
            return [x, y];
        };

        if (colorField) {
            const groups = groupBy(table, colorField);
            option.legend = { data: [...groups.keys()] };
            let colorIdx = 0;
            for (const [name, rows] of groups) {
                option.series.push({
                    name,
                    type: 'scatter',
                    data: rows.map(buildPoint),
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length], opacity: 0.7 },
                    symbolSize: 8,
                });
                colorIdx++;
            }
        } else {
            option.series.push({
                type: 'scatter',
                data: table.map(buildPoint),
                itemStyle: { opacity: 0.7 },
                symbolSize: 8,
            });
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};
