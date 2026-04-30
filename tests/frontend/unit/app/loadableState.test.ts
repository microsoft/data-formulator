import { describe, expect, it } from 'vitest';
import {
    errorLoadable,
    idleLoadable,
    loadingLoadable,
    successLoadable,
} from '../../../../src/app/loadableState';

describe('loadableState', () => {
    it('preserves previous data while entering loading', () => {
        const previous = successLoadable({ rows: [1] });

        expect(loadingLoadable(previous)).toMatchObject({
            status: 'loading',
            data: { rows: [1] },
        });
    });

    it('marks successful empty data with the empty status', () => {
        const state = successLoadable([] as number[], rows => rows.length === 0);

        expect(state.status).toBe('empty');
        expect(state.data).toEqual([]);
    });

    it('extracts API error messages for error state', () => {
        const state = errorLoadable(
            { apiError: { message: 'Data connector error' } },
            { tree: [] },
        );

        expect(state).toMatchObject({
            status: 'error',
            error: 'Data connector error',
            data: { tree: [] },
        });
    });

    it('starts as idle without data', () => {
        expect(idleLoadable()).toEqual({ status: 'idle' });
    });
});
