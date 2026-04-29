/**
 * Tests for Chart Insight fetchChartInsight thunk behavior.
 *
 * Covers:
 * - rejected reducer: message type varies by error name
 *   (AbortError = silent, TimeoutError = timeout msg, ChartImageNotReady = image msg, other = generic)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the reducer logic by building a minimal extraReducers matcher.
// Since the reducer is tightly coupled to createSlice, we test via the
// slice's reducer function directly.

// Mock all heavy deps before importing the slice
vi.mock('../../../../src/app/utils', () => ({
    fetchWithIdentity: vi.fn(),
    getTriggers: vi.fn(() => []),
    getUrls: vi.fn(() => ({
        CHART_INSIGHT_URL: '/api/agent/chart-insight',
    })),
    computeContentHash: vi.fn(() => 'hash'),
}));
vi.mock('../../../../src/app/chartCache', () => ({
    getChartPngDataUrl: vi.fn(),
}));
vi.mock('../../../../src/app/workspaceService', () => ({
    deleteTablesFromWorkspace: vi.fn(),
}));
vi.mock('../../../../src/app/identity', () => ({
    Identity: {},
    IdentityType: { BROWSER: 'browser' },
    getBrowserId: vi.fn(() => 'browser-id'),
}));
vi.mock('../../../../src/app/store', () => ({
    store: {
        getState: vi.fn(() => ({})),
        dispatch: vi.fn(),
    },
}));
vi.mock('../../../../src/i18n', () => ({
    default: {
        t: (key: string, params?: Record<string, any>) => {
            if (key === 'messages.chartInsightTimedOut') {
                return `Chart insight timed out after ${params?.seconds}s`;
            }
            if (key === 'messages.chartInsightImageNotReady') {
                return 'Chart image was not ready';
            }
            if (key === 'messages.chartInsightFailed') {
                return 'Failed to generate chart insight';
            }
            return key;
        },
    },
}));

// ---------------------------------------------------------------------------
// Tests — rejected reducer message discrimination
// ---------------------------------------------------------------------------

describe('fetchChartInsight rejected reducer', () => {
    // We import the reducer and simulate action.error shapes
    // The reducer reads: action.error.name, action.error.message, action.meta.arg.chartId
    let reducer: any;
    let fetchChartInsight: any;
    let initialState: any;

    beforeEach(async () => {
        const mod = await import('../../../../src/app/dfSlice');
        reducer = mod.dataFormulatorSlice.reducer;
        fetchChartInsight = mod.fetchChartInsight;

        initialState = {
            ...mod.dataFormulatorSlice.getInitialState(),
            chartInsightInProgress: ['chart-1'],
        };
    });

    function makeRejectedAction(errorName: string, errorMessage: string = 'test') {
        return {
            type: fetchChartInsight.rejected.type,
            meta: { arg: { chartId: 'chart-1' } },
            error: { name: errorName, message: errorMessage },
        };
    }

    it('AbortError produces no message', () => {
        const state = reducer(initialState, makeRejectedAction('AbortError'));
        expect(state.messages).toHaveLength(0);
        expect(state.chartInsightInProgress).not.toContain('chart-1');
    });

    it('TimeoutError produces a timeout warning with seconds', () => {
        const state = reducer(initialState, makeRejectedAction('TimeoutError'));
        expect(state.messages).toHaveLength(1);
        expect(state.messages[0].type).toBe('warning');
        expect(state.messages[0].value).toContain('timed out');
        expect(state.messages[0].value).toContain(String(initialState.config.formulateTimeoutSeconds));
    });

    it('ChartImageNotReady produces an image-not-ready warning', () => {
        const state = reducer(initialState, makeRejectedAction('ChartImageNotReady'));
        expect(state.messages).toHaveLength(1);
        expect(state.messages[0].type).toBe('warning');
        expect(state.messages[0].value).toContain('not ready');
    });

    it('generic error produces a warning with the error message', () => {
        const state = reducer(initialState, makeRejectedAction('Error', 'Model returned nonsense'));
        expect(state.messages).toHaveLength(1);
        expect(state.messages[0].type).toBe('warning');
        expect(state.messages[0].value).toBe('Model returned nonsense');
    });

    it('removes chartId from chartInsightInProgress', () => {
        const state = reducer(initialState, makeRejectedAction('Error'));
        expect(state.chartInsightInProgress).not.toContain('chart-1');
    });
});
