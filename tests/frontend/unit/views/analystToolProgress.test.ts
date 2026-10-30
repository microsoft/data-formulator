import { describe, expect, it } from 'vitest';

import { formatAnalystToolProgress } from '../../../../src/views/analystToolProgress';

const labels: Record<string, string> = {
    'dataLoading.toolLabels.browsingCatalog': 'Browsing',
    'dataLoading.toolLabels.searchingData': 'Searching',
    'dataLoading.toolLabels.describingData': 'Reading table',
    'dataLoading.toolLabels.probingData': 'Probing',
    'dataThread.listingConnectors': 'Checking available connectors',
    'dataThread.readingConnector': 'Reading connector setup',
};

const translate = (key: string): string => labels[key] || key;

describe('formatAnalystToolProgress', () => {
    it('shows a connector lookup with a type as reading its setup', () => {
        expect(formatAnalystToolProgress('list_connectors', {}, translate)).toBe('Checking available connectors');
        expect(formatAnalystToolProgress('list_connectors', { source_type: 'postgresql' }, translate))
            .toBe('Reading connector setup: postgresql');
    });

    it('names every file a read covers', () => {
        expect(formatAnalystToolProgress('read_file', {
            paths: ['session/charts/*', 'session/tables/sales.json'],
        }, (key: string) => key === 'dataThread.readingFile' ? 'Reading' : key))
            .toBe('Reading: session/charts/*, session/tables/sales.json');
    });

    it('names each read item with the rows or pages it reads', () => {
        expect(formatAnalystToolProgress('read_file', {
            files: [{ path: 'session/tables/t.json', rows: '1-50' }, { path: 'files/r.pdf', pages: '3' }],
        }, (key: string) => key === 'dataThread.readingFile' ? 'Reading' : key))
            .toBe('Reading: session/tables/t.json (rows 1-50), files/r.pdf (pages 3)');
    });

    it('shows a session search with its query and scope', () => {
        expect(formatAnalystToolProgress('search', { query: 'out of school', path: ['session/tables/'] },
            (key: string) => key === 'dataThread.searchingSession' ? 'Searching the session' : key))
            .toBe('Searching the session: “out of school” in session/tables/');
    });

    it('keeps catalog paths compact', () => {
        expect(formatAnalystToolProgress('list_data', {
            source_id: 'mysql:mysql',
            path: ['sakila', 'test'],
        }, translate)).toBe('Browsing: mysql/sakila/test');

        expect(formatAnalystToolProgress('list_data', {
            source_id: 'local_folder:datasets',
        }, translate)).toBe('Browsing: datasets');

        expect(formatAnalystToolProgress('find_data', {
            query: 'monthly revenue',
            source_id: 'mysql:mysql',
        }, translate)).toBe('Searching: “monthly revenue” in mysql');
    });

    it('summarizes probes without exposing filter values', () => {
        const progress = formatAnalystToolProgress('probe_data', {
            table_key: 'orders',
            query: {
                aggregates: [{ op: 'sum', column: 'revenue' }],
                group_by: ['region'],
                filter_count: 1,
                limit: 20,
            },
        }, translate);

        expect(progress).toBe('Probing: orders · sum(revenue) by region 1 filter limit 20');
        expect(progress).not.toContain('Secret Corp');
    });

    it('always returns a visible fallback for unknown inspection tools', () => {
        expect(formatAnalystToolProgress('future_tool', {}, translate))
            .toBe('future tool');
    });
});
