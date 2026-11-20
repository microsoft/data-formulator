// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The chart catalog the server validates chart edits against (design-docs/60):
 * each Flint chart type with its channels and options, and the theme ids.
 * Generated into py-src/data_formulator/analyst/chart_catalog.json by
 * scripts/generate-chart-catalog.mjs.
 */

import { listThemePresets, vlAllTemplateDefs } from 'flint-chart';

type CatalogOption =
    | { type: 'continuous'; min?: number; max?: number }
    | { type: 'binary' }
    | { type: 'discrete'; options: (string | number | boolean | null)[] };

export interface ChartCatalog {
    chart_types: Record<string, { channels: string[]; options: Record<string, CatalogOption> }>;
    themes: string[];
}

export function buildChartCatalog(): ChartCatalog {
    const chartTypes: ChartCatalog['chart_types'] = {};
    for (const def of vlAllTemplateDefs as any[]) {
        const options: Record<string, CatalogOption> = {};
        for (const property of def.properties || []) {
            if (property.type === 'continuous') {
                options[property.key] = { type: 'continuous',
                    ...(typeof property.min === 'number' ? { min: property.min } : {}),
                    ...(typeof property.max === 'number' ? { max: property.max } : {}) };
            } else if (property.type === 'binary') {
                options[property.key] = { type: 'binary' };
            } else if (property.type === 'discrete') {
                options[property.key] = { type: 'discrete', options: (property.options || []).map((option: any) => option.value ?? null) };
            }
        }
        chartTypes[def.chart] = { channels: [...def.channels], options };
    }
    return { chart_types: chartTypes, themes: listThemePresets().map(preset => preset.id) };
}
