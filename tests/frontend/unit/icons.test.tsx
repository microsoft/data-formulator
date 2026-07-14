import { describe, expect, it } from 'vitest';
import {
    RelationalDBIcon,
    connectorSortOrder,
    getConnectorIcon,
} from '../../../src/icons';

describe('Azure SQL connector presentation', () => {
    it('should use the relational database icon', () => {
        expect(getConnectorIcon('azure_sql').type).toBe(RelationalDBIcon);
    });

    it('should sort with other relational databases', () => {
        expect(connectorSortOrder('azure_sql', 'mongodb')).toBeLessThan(0);
    });
});
