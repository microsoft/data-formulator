// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Strip Plot — scatter with jitter on categorical axis (mirror vegalite/templates/jitter.ts).
 */

import { ChartTemplateDef } from '../../core/types';
import { extractCategories, groupBy } from './utils';

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
        paramOverrides: { defaultBandSize: 50, minStep: 16 },
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
        const jitterHalfWidth = 0.3;
        const rand = jitter(42);
        const nCat = categories.length;

        const isHorizontal = catAxis === 'y';
        const catAxisLabel = {
            rotate: isHorizontal ? 0 : (areCategoriesNumeric(categories) ? 0 : 45),
        };
        const valueAxisCommon = (name: string) => ({
            type: 'value' as const,
            name,
            axisTick: { show: true },
            axisLabel: { rotate: 0 },
            axisLine: { onZero: false },
        });

        // Use a visible category axis for labels + a hidden value axis for scatter positioning.
        // This lets fractional indices produce real jitter while keeping clean category labels.
        const catAxisIdx = isHorizontal ? 'yAxis' : 'xAxis';
        const valAxisIdx = isHorizontal ? 'xAxis' : 'yAxis';

        const option: any = {
            tooltip: { trigger: 'item' },
            [catAxisIdx]: [
                {
                    type: 'category',
                    data: categories,
                    name: catField,
                    boundaryGap: true,
                    axisTick: { show: true, alignWithLabel: true },
                    axisLabel: catAxisLabel,
                },
                {
                    // Hidden value axis aligned with the category axis for scatter jitter.
                    type: 'value',
                    min: -0.5,
                    max: nCat - 0.5,
                    show: false,
                },
            ],
            [valAxisIdx]: valueAxisCommon(contField!),
            series: [],
        };

        const catScatterAxisIndex = 1; // use the hidden value axis

        const buildPoint = (row: any) => {
            const cat = String(row[catField!] ?? '');
            const idx = catToIndex.get(cat) ?? 0;
            const offset = rand() * jitterHalfWidth;
            const catVal = idx + offset;
            const contVal = row[contField];
            return catAxis === 'x' ? [catVal, contVal] : [contVal, catVal];
        };

        const scatterAxisRef = isHorizontal
            ? { yAxisIndex: catScatterAxisIndex }
            : { xAxisIndex: catScatterAxisIndex };

        if (colorField) {
            const groups = groupBy(table, colorField);
            option.legend = { data: [...groups.keys()] };
            for (const [name, rows] of groups) {
                option.series.push({
                    name,
                    type: 'scatter',
                    ...scatterAxisRef,
                    data: rows.map(buildPoint),
                    itemStyle: { opacity: 0.7 },
                    symbolSize: 8,
                });
            }
        } else {
            option.series.push({
                type: 'scatter',
                ...scatterAxisRef,
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
