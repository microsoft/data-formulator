import { describe, expect, it } from 'vitest';

import { DF_STATE_VERSION, migrateState } from '../../../../src/app/stateMigrations';

describe('state migrations', () => {
    it('removes legacy anchored flags from tables and drafts', () => {
        const migrated = migrateState({
            __stateVersion: 1,
            tables: [{ id: 'source', anchored: true }, { id: 'derived', anchored: false }],
            draftNodes: [{ id: 'draft', anchored: true }],
        });

        expect(DF_STATE_VERSION).toBe(2);
        expect(migrated.tables).toEqual([{ id: 'source' }, { id: 'derived' }]);
        expect(migrated.draftNodes).toEqual([{ id: 'draft' }]);
    });
});