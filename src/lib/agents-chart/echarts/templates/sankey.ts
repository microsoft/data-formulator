// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Sankey Diagram template.
 *
 * Unique to ECharts — no Vega-Lite equivalent.
 * Displays flow/transfer data as a node-link diagram where link width
 * encodes flow magnitude.
 *
 * Data model (each row = one flow link):
 *   x    (nominal): source node name
 *   y    (nominal): target node name
 *   size (quantitative): flow value / weight
 *
 * Nodes are auto-derived from unique source/target values.
 * Multiple rows with the same source→target pair are aggregated (sum).
 *
 * Scaling: uses the spring model separately for x and y, treating each
 * node block as a spring.  The x-axis counts source nodes (proxy for
 * layer width), y-axis counts target nodes (proxy for vertical stacking).
 * Large step multipliers ensure adequate space for edge routing between
 * node columns.
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { DEFAULT_COLORS } from './utils';
import { getPaletteForScheme } from '../../core/color-decisions';

export const ecSankeyDef: ChartTemplateDef = {
    chart: 'Sankey Diagram',
    template: { mark: 'rect', encoding: {} },
    channels: ['x', 'y', 'size'],
    markCognitiveChannel: 'area',
    declareLayoutMode: () => ({
        axisFlags: {
            x: { banded: true },
            y: { banded: true },
        },
        paramOverrides: {
            // Each node block needs generous space:
            // x-step covers node width (~20px) + edge routing gap (~60px)
            // y-step covers node height + nodeGap
            defaultStepMultiplier: 3,
        },
    }),
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties, layout, colorDecisions } = ctx;
        const sourceField = channelSemantics.x?.field;   // source node
        const targetField = channelSemantics.y?.field;    // target node
        const valueField = channelSemantics.size?.field;  // flow value

        if (!sourceField || !targetField) return;

        // Aggregate links: source→target → sum(value)
        const linkAgg = new Map<string, number>();
        for (const row of table) {
            const src = String(row[sourceField] ?? '');
            const tgt = String(row[targetField] ?? '');
            if (!src || !tgt || src === tgt) continue; // skip self-links
            const key = `${src}\x00${tgt}`;
            const val = valueField ? (Number(row[valueField]) || 0) : 1;
            linkAgg.set(key, (linkAgg.get(key) ?? 0) + val);
        }

        // Build links & collect unique nodes
        const nodeSet = new Set<string>();
        const links: { source: string; target: string; value: number }[] = [];
        for (const [key, value] of linkAgg) {
            const [source, target] = key.split('\x00');
            nodeSet.add(source);
            nodeSet.add(target);
            links.push({ source, target, value });
        }

        if (links.length === 0) return;

        // Build nodes with colors
        const nodeArr = [...nodeSet];

        // ── Resolve palette from backend-agnostic color decisions ────────
        const decision = colorDecisions?.color ?? colorDecisions?.group;
        let palette: string[] | undefined;
        if (decision?.schemeId) {
            const fromRegistry = getPaletteForScheme(decision.schemeId);
            if (fromRegistry && fromRegistry.length > 0) {
                palette = fromRegistry;
            }
        }
        if (!palette || palette.length === 0) {
            const catCount = nodeArr.length;
            const fallbackId = catCount > 10 ? 'cat20' : 'cat10';
            palette = getPaletteForScheme(fallbackId) ?? DEFAULT_COLORS;
        }

        const nodes = nodeArr.map((name, i) => ({
            name,
            itemStyle: { color: palette![i % palette!.length] },
        }));

        // ── Layout-driven sizing ─────────────────────────────────────────
        // x-step × sourceCount → width (proxy for layer structure)
        // y-step × targetCount → height (proxy for vertical stacking)
        const sourceCount = layout.xNominalCount || new Set(table.map(r => String(r[sourceField]))).size;
        const targetCount = layout.yNominalCount || new Set(table.map(r => String(r[targetField]))).size;

        const nodeGap = chartProperties?.nodeGap ?? 10;
        const nodeWidth = chartProperties?.nodeWidth ?? 20;

        // Width: need room for source column + target column + edge routing
        // Use xStep as "per source node spacing" — scale by max(2, layerEstimate)
        const layerEstimate = 2; // typical sankey has at least 2 layers
        const canvasW = Math.max(300,
            layout.xStep * Math.max(sourceCount, layerEstimate) + 60);
        // Height: need room for max stacking of nodes vertically
        const maxNodesPerColumn = Math.max(sourceCount, targetCount);
        const canvasH = Math.max(250,
            layout.yStep * maxNodesPerColumn);

        const orient = chartProperties?.orient ?? 'horizontal';

        const margin = 30;
        const option: any = {
            tooltip: {
                trigger: 'item',
                triggerOn: 'mousemove',
                formatter: (params: any) => {
                    if (params.dataType === 'edge') {
                        return `${params.data.source} → ${params.data.target}<br/>Value: ${params.data.value}`;
                    }
                    return params.name;
                },
            },
            series: [{
                type: 'sankey',
                data: nodes,
                links,
                orient,
                emphasis: {
                    focus: 'adjacency',
                },
                lineStyle: {
                    color: 'gradient',
                    curveness: 0.5,
                },
                nodeWidth,
                nodeGap,
                label: {
                    show: true,
                    fontSize: 11,
                },
                left: margin,
                right: margin,
                top: 20,
                bottom: 20,
            }],
            color: palette ?? DEFAULT_COLORS,
            _width: canvasW,
            _height: canvasH,
        };

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        {
            key: 'orient', label: 'Orient', type: 'discrete', options: [
                { value: 'horizontal', label: 'Horizontal (default)' },
                { value: 'vertical', label: 'Vertical' },
            ],
        } as ChartPropertyDef,
        { key: 'nodeWidth', label: 'Node Width', type: 'continuous', min: 5, max: 40, step: 5, defaultValue: 20 } as ChartPropertyDef,
        { key: 'nodeGap', label: 'Node Gap', type: 'continuous', min: 2, max: 30, step: 2, defaultValue: 10 } as ChartPropertyDef,
    ],
};
