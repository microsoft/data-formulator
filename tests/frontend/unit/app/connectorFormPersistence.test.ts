import { describe, expect, it } from 'vitest';

import { stripConnectorPrefillFromEntries } from '../../../../src/app/connectorFormPersistence';

describe('connector form persistence', () => {
    it('removes transient prefills from standalone chat messages', () => {
        const entries = [{
            id: 'entry-1',
            connectorForm: {
                sourceType: 'postgresql',
                status: 'pending',
                prefilled: { host: 'db.example.com', password: 'secret' },
            },
        }];

        expect(stripConnectorPrefillFromEntries(entries)).toEqual([{
            id: 'entry-1',
            connectorForm: {
                sourceType: 'postgresql',
                status: 'pending',
            },
        }]);
        expect(entries[0].connectorForm.prefilled.password).toBe('secret');
    });

    it('removes transient prefills from generalized form artifacts', () => {
        const entries = [{
            id: 'turn-1',
            form: {
                kind: 'connector',
                title: 'Connect to PostgreSQL',
                connector: {
                    sourceType: 'postgresql',
                    status: 'pending',
                    prefilled: { host: 'db.example.com', password: 'secret' },
                },
            },
        }];

        expect(stripConnectorPrefillFromEntries(entries)).toEqual([{
            id: 'turn-1',
            form: {
                kind: 'connector',
                title: 'Connect to PostgreSQL',
                connector: {
                    sourceType: 'postgresql',
                    status: 'pending',
                },
            },
        }]);
        expect(entries[0].form.connector.prefilled.password).toBe('secret');
    });
});