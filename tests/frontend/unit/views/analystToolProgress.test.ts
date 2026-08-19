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

const translate = (key: string, options?: Record<string, unknown>): string =>
    labels[key] || `Using ${options?.tool}`;

describe('formatAnalystToolProgress', () => {
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
            scope: 'mysql:mysql',
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
            .toBe('Using future tool');
    });
});
