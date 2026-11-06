import { describe, expect, it } from 'vitest';
import { deriveConnectorDisplayName } from '../../../src/app/connectorNames';

describe('deriveConnectorDisplayName', () => {
    it.each([
        'https://liquidkustoloadprod.westus2.kusto.windows.net/',
        'liquidkustoloadprod.westus2.kusto.windows.net',
        '  https://liquidkustoloadprod.kusto.windows.net  ',
    ])('names a Kusto connector after its cluster: %s', cluster => {
        expect(deriveConnectorDisplayName('Kusto', { kusto_cluster: cluster, database: 'Analytics' }))
            .toBe('Kusto \u00b7 liquidkustoloadprod');
    });

    it('preserves custom cluster hostnames', () => {
        expect(deriveConnectorDisplayName('Kusto', { kusto_cluster: 'https://analytics.example.com' }))
            .toBe('Kusto \u00b7 analytics.example.com');
    });

    it('preserves other connector naming and missing-identity fallbacks', () => {
        expect(deriveConnectorDisplayName('PostgreSQL', { host: 'db.example.com' }))
            .toBe('PostgreSQL \u00b7 db.example.com');
        expect(deriveConnectorDisplayName('Kusto', { kusto_cluster: ' ' })).toBe('Kusto');
    });
});