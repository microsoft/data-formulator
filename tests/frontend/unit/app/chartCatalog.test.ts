import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildChartCatalog } from '../../../../src/app/chartCatalog';

describe('chart catalog', () => {
    it('matches the installed Flint (regenerate with scripts/generate-chart-catalog.mjs)', () => {
        const committed = JSON.parse(readFileSync('py-src/data_formulator/analyst/chart_catalog.json', 'utf-8'));
        expect(committed).toEqual(buildChartCatalog());
        expect(committed.chart_types['Bar Chart'].channels).toContain('x');
        expect(committed.themes.length).toBeGreaterThan(0);
    });
});
