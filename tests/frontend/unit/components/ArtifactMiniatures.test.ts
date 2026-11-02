import { describe, expect, it } from 'vitest';
import { parseAppLayout } from '../../../../src/components/ArtifactMiniatures';

describe('parseAppLayout', () => {
    it('outlines a dashboard: filters, KPIs, then a chart beside a table', () => {
        const code = `<FilterBar><Select label="Region" /><Segmented label="Metric" /></FilterBar>
          <KpiGrid><Kpi label="Total" /><Kpi label="Orders" /></KpiGrid>
          <Grid main><ChartCard>{d => <FlintChart data={d} />}</ChartCard><ChartCard>{d => <DataTable data={d} />}</ChartCard></Grid>`;
        expect(parseAppLayout(code)).toEqual([
            { kind: 'filters', count: 2 },
            { kind: 'kpis', count: 2 },
            { kind: 'cells', cells: ['chart', 'table'], main: true },
        ]);
    });

    it('reads plain HTML apps the same way', () => {
        expect(parseAppLayout('<select></select><canvas></canvas><svg></svg><svg></svg>')).toEqual([
            { kind: 'filters', count: 1 },
            { kind: 'cells', cells: ['chart', 'chart'], main: false },
            { kind: 'cells', cells: ['chart', 'chart'] },
        ]);
    });

    it('returns nothing it does not recognise, so the card falls back to a generic window', () => {
        expect(parseAppLayout('<div>hello</div>')).toEqual([]);
    });
});
