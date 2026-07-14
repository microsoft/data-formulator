import { describe, expect, it } from 'vitest';

import {
    shouldResetPersistedWorkspace,
    type WorkspaceSummary,
} from '../../../../src/app/workspaceService';

const savedWorkspace: WorkspaceSummary = {
    id: 'session-saved',
    display_name: 'Saved workspace',
    created_at: null,
    saved_at: null,
};

describe('shouldResetPersistedWorkspace', () => {
    it('should reset local state when the active server workspace is missing', () => {
        expect(shouldResetPersistedWorkspace('session-missing', 'local', [savedWorkspace])).toBe(true);
    });

    it('should preserve local state when the active server workspace exists', () => {
        expect(shouldResetPersistedWorkspace('session-saved', 'local', [savedWorkspace])).toBe(false);
    });

    it('should preserve frontend-owned ephemeral workspaces', () => {
        expect(shouldResetPersistedWorkspace('session-missing', 'ephemeral', [])).toBe(false);
    });

    it('should preserve state when no workspace is active', () => {
        expect(shouldResetPersistedWorkspace(null, 'local', [])).toBe(false);
    });
});
