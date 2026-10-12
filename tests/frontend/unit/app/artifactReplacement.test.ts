import { describe, expect, it } from 'vitest';
import { listReplaceableArtifacts } from '../../../../src/app/artifactReplacement';
import { buildThreadGraph } from '../../../../src/app/threadGraph';
import { computeInsightKey } from '../../../../src/components/ComponentType';

const derived = (id: string, parentNodeId: string, source: string[] = [], extra: any = {}) => ({
    kind: 'table', id, displayId: id.toUpperCase(), names: [], metadata: {}, rows: [], parentNodeId, createdAt: 1,
    derive: { source, code: '', dialog: [], trigger: { tableId: 'root', resultTableId: id } }, ...extra,
}) as any;
const chart = (id: string, tableRef: string, extra: any = {}) =>
    ({ id, chartType: 'Bar Chart', encodingMap: {}, tableRef, source: 'user', ...extra }) as any;

describe('listReplaceableArtifacts', () => {
    it('lists agent artifacts with the ids the agent knows, and why some cannot be replaced', () => {
        const tables = [
            { kind: 'table', id: 'orders', displayId: 'Orders', names: [], metadata: {}, rows: [] } as any,
            derived('d_base', 'ask', ['orders']),
            derived('d_trend', 'd_base', ['d_base'], { virtual: { tableId: 'trend_tbl', rowCount: 1 } }),
            derived('d_edited', 'ask'),
            derived('d_more', 'ask'),
        ];
        const edited = chart('chart-edited', 'd_edited', { styleVariants: [{ id: 'v' }] });
        const charts = [chart('chart-trend', 'd_trend'), chart('chart-base', 'd_base'), edited,
            chart('chart-more', 'd_more'), chart('chart-more-2', 'd_more')];
        const reports = [{ id: 'report-1', title: 'Findings', content: '![x](chart://chart-base)', selectedChartIds: [], createdAt: 2, parentNodeId: 'd_trend' }] as any;
        const fileNodes = [{ kind: 'file', id: 'file-app.app.jsx', path: 'app.app.jsx', displayName: 'App', contentHash: 'h', parentNodeId: 'ask', createdAt: 3 }] as any;
        const graph = buildThreadGraph({ tables, turns: [{ id: 'ask', parentNodeId: 'conversation-root:a', createdAt: 0 } as any], fileNodes, reports });
        const artifacts = listReplaceableArtifacts({ tables, charts, fileNodes, reports, graph, focusNodeId: 'd_trend' });
        const byId = Object.fromEntries(artifacts.map(artifact => [artifact.id, artifact]));
        // Source tables are never listed; the focused chain comes first.
        expect(byId.orders).toBeUndefined();
        expect(artifacts.slice(0, 2).map(artifact => artifact.id)).toEqual(['trend_tbl', 'd_base']);
        expect(byId.trend_tbl).toEqual({ id: 'trend_tbl', node_id: 'd_trend', kind: 'table', name: 'D_TREND', aliases: ['d_trend', 'chart-trend'] });
        expect(byId.d_base.blocked).toBe('the table D_TREND was computed from it');
        expect(byId.d_edited.blocked).toBe('the user edited its chart');
        expect(byId.d_more.blocked).toBe('another chart was made from it');
        expect(byId['files/app.app.jsx']).toEqual({ id: 'files/app.app.jsx', node_id: 'file-app.app.jsx', kind: 'file', name: 'App' });
        expect(byId['report-1']).toEqual({ id: 'report-1', node_id: 'report-1', kind: 'report', name: 'Findings' });
    });

    it('treats a chart whose title still matches its encoding as unedited', () => {
        const table = derived('d_x', 'ask');
        const agentChart = chart('chart-x', 'd_x');
        agentChart.titleKey = computeInsightKey(agentChart);
        const graph = buildThreadGraph({ tables: [table] });
        const [artifact] = listReplaceableArtifacts({ tables: [table], charts: [agentChart], fileNodes: [], reports: [], graph });
        expect(artifact.blocked).toBeUndefined();
    });
});
