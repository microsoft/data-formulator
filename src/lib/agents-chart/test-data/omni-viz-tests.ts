// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Omni game-ops gallery — three-phase narrative (overview → change → composition).
 * TripleChart: Vega-Lite + ECharts + Chart.js. Sunburst is ECharts-first (no native VL sunburst).
 */

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import type { SemanticAnnotation } from '../core/field-semantics';
import {
    OMNI_VIZ_LEVELS,
    omniVizGroupedBarRegionGameTypeTable,
    omniVizHeatmapGameMonthTable,
    omniVizLineTable,
    omniVizSunburstTable,
    omniVizWaterfallTable,
} from './omni-viz-dataset';

const META: Record<string, { type: Type; semanticType: string; levels: any[] }> = {
    period: { type: Type.String, semanticType: 'YearMonth', levels: [...OMNI_VIZ_LEVELS.periodStarts] },
    game: { type: Type.String, semanticType: 'Category', levels: [...OMNI_VIZ_LEVELS.games] },
    gameType: { type: Type.String, semanticType: 'Category', levels: [...OMNI_VIZ_LEVELS.gameTypes] },
    newUsers: { type: Type.Number, semanticType: 'Quantity', levels: [] },
    totalUsers: { type: Type.Number, semanticType: 'Quantity', levels: [] },
    region: { type: Type.String, semanticType: 'Category', levels: [...OMNI_VIZ_LEVELS.regions] },
};

const WF_STEPS = [
    'Opening MAU (year start)',
    ...OMNI_VIZ_LEVELS.months,
    'Closing MAU (year end)',
] as const;

const HEATMAP_NEW_USERS_ANNOTATION: SemanticAnnotation = {
    /** Signed net flow → diverging color with meaningful zero (see color-decisions). */
    semanticType: 'Profit',
};

export function genOmniVizLineTests(): TestCase[] {
    const data = omniVizLineTable();
    return [{
        title: 'Phase 1 — Line: MAU trend by month × gameType (facet region)',
        description:
            'Overview: column = region (N/E/S/W); x = month; y = totalUsers (summed across games in each gameType); color = gameType. '
            + 'Spikes differ by type (e.g. mobile summer lift vs PC patch months) — compare panels.',
        tags: ['omni-viz', 'phase-1', 'line', 'facet', 'gallery', 'game-ops'],
        chartType: 'Line Chart',
        data,
        fields: [
            makeField('period'),
            makeField('totalUsers'),
            makeField('gameType'),
            makeField('region'),
        ],
        metadata: {
            period: META.period,
            totalUsers: META.totalUsers,
            gameType: META.gameType,
            region: META.region,
        },
        encodingMap: {
            column: makeEncodingItem('region'),
            x: makeEncodingItem('period', { dtype: 'temporal' }),
            y: makeEncodingItem('totalUsers'),
            color: makeEncodingItem('gameType'),
        },
    }];
}

export function genOmniVizGroupedBarTests(): TestCase[] {
    const data = omniVizGroupedBarRegionGameTypeTable();
    return [{
        title: 'Phase 1 — Grouped bar: MAU by month × gameType',
        description:
            'Same story, monthly lens: x = month; y = sum(totalUsers) across all regions/games; color = gameType; group = gameType.',
        tags: ['omni-viz', 'phase-1', 'grouped-bar', 'gallery', 'game-ops'],
        chartType: 'Grouped Bar Chart',
        data,
        fields: [makeField('period'), makeField('totalUsers'), makeField('gameType')],
        metadata: {
            period: META.period,
            totalUsers: META.totalUsers,
            gameType: META.gameType,
        },
        encodingMap: {
            x: makeEncodingItem('period', { dtype: 'temporal' }),
            y: makeEncodingItem('totalUsers'),
            color: makeEncodingItem('gameType'),
            group: makeEncodingItem('gameType'),
        },
    }];
}

export function genOmniVizWaterfallTests(): TestCase[] {
    const data = omniVizWaterfallTable();
    return [{
        title: 'Phase 2 — Waterfall: portfolio net newUsers month over month',
        description:
            'Change: x = step (opening → each YYYY-MM → closing); y = Amount. Middle steps are monthly sum(newUsers) across all games/regions; '
            + 'start/end are opening and December total MAU (portfolio sum). Good for exec-friendly “how we got here”.',
        tags: ['omni-viz', 'phase-2', 'waterfall', 'gallery', 'game-ops'],
        chartType: 'Waterfall Chart',
        data,
        fields: [makeField('Step'), makeField('Amount'), makeField('Type')],
        metadata: {
            Step: { type: Type.String, semanticType: 'Category', levels: [...WF_STEPS] },
            Amount: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            Type: { type: Type.String, semanticType: 'Category', levels: ['start', 'delta', 'end'] },
        },
        encodingMap: {
            x: makeEncodingItem('Step'),
            y: makeEncodingItem('Amount'),
            color: makeEncodingItem('Type'),
        },
    }];
}

export function genOmniVizHeatmapTests(): TestCase[] {
    const data = omniVizHeatmapGameMonthTable();
    return [{
        title: 'Phase 2 — Heatmap: net newUsers by game × month',
        description:
            'Change: x = game; y = month; color = newUsers (net adds summed over regions). '
            + 'Diverging scale centered at 0 (red/blue). Vega-Lite rect + ECharts heatmap + Chart.js row.',
        tags: ['omni-viz', 'phase-2', 'heatmap', 'gallery', 'game-ops'],
        chartType: 'Heatmap',
        data,
        fields: [makeField('game'), makeField('period'), makeField('newUsers')],
        metadata: {
            game: META.game,
            period: META.period,
            newUsers: META.newUsers,
        },
        encodingMap: {
            x: makeEncodingItem('period', { dtype: 'temporal' }),
            y: makeEncodingItem('game'),
            color: makeEncodingItem('newUsers'),
        },
        chartProperties: { colorScheme: 'redblue' },
        semanticAnnotations: { newUsers: HEATMAP_NEW_USERS_ANNOTATION },
    }];
}

export function genOmniVizSunburstTests(): TestCase[] {
    const data = omniVizSunburstTable();
    return [{
        title: 'Phase 3 — Sunburst: MAU composition (region → gameType → game)',
        description:
            'Composition: hierarchy region → gameType → game; size = totalUsers on the latest month (Dec). '
            + 'Vega-Lite has no first-class sunburst; ECharts (middle panel) carries this view. '
            + 'Left: VL assembly fallback; right: Chart.js where supported.',
        tags: ['omni-viz', 'phase-3', 'sunburst', 'echarts', 'gallery', 'game-ops'],
        chartType: 'Sunburst Chart',
        data,
        fields: [makeField('region'), makeField('gameType'), makeField('game'), makeField('totalUsers')],
        metadata: {
            region: META.region,
            gameType: META.gameType,
            game: META.game,
            totalUsers: META.totalUsers,
        },
        encodingMap: {
            color: makeEncodingItem('region'),
            group: makeEncodingItem('gameType'),
            detail: makeEncodingItem('game'),
            size: makeEncodingItem('totalUsers'),
        },
    }];
}

/** Keys in `TEST_GENERATORS` for the Omni gallery (charts only; data table chip is separate). */
export const GALLERY_OMNI_VIZ_GENERATOR_KEYS = [
    'Omni: Line',
    'Omni: Grouped Bar',
    'Omni: Waterfall',
    'Omni: Heatmap',
    'Omni: Sunburst',
] as const;

export const OMNI_VIZ_GALLERY_DATA_TABLE_ENTRY = 'Omni: Data Table Preview' as const;
