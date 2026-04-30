import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    apiRequest: vi.fn(),
}));

vi.mock('../../../../src/app/apiClient', () => ({
    apiRequest: mocks.apiRequest,
}));

vi.mock('../../../../src/app/utils', () => ({
    getTriggers: vi.fn(() => []),
    getUrls: vi.fn(() => ({
        SERVER_PROCESS_DATA_ON_LOAD: '/api/agent/process-data-on-load',
        CODE_EXPL_URL: '/api/agent/code-expl',
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
        t: (key: string) => key,
    },
}));

import {
    dataFormulatorSlice,
    fetchAvailableModels,
    fetchCodeExpl,
    fetchFieldSemanticType,
    fetchGlobalModelList,
} from '../../../../src/app/dfSlice';

describe('agent metadata thunks', () => {
    const model = { id: 'model-1', endpoint: 'http://example.test', model: 'gpt-test' };
    const sourceTable = {
        kind: 'table',
        id: 'source',
        displayId: 'source',
        names: ['value'],
        metadata: {},
        rows: [{ value: 1 }],
    } as any;

    const makeState = () => ({
        ...dataFormulatorSlice.getInitialState(),
        selectedModelId: model.id,
        globalModels: [model],
        tables: [sourceTable],
    });

    let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mocks.apiRequest.mockResolvedValue({ data: { result: [] } });
        setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    });

    afterEach(() => {
        mocks.apiRequest.mockReset();
        setTimeoutSpy.mockRestore();
    });

    it('does not add a frontend timeout to semantic type requests', async () => {
        await fetchFieldSemanticType(sourceTable)(vi.fn(), makeState, undefined);

        const [, options] = mocks.apiRequest.mock.calls[0];
        expect(options.signal).toBeUndefined();
        expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it('does not add a frontend timeout to code explanation requests', async () => {
        const derivedTable = {
            ...sourceTable,
            id: 'derived',
            derive: {
                source: ['source'],
                code: 'df = source.copy()',
                outputVariable: 'df',
                dialog: [],
                trigger: {},
            },
        } as any;

        await fetchCodeExpl(derivedTable)(vi.fn(), makeState, undefined);

        const [, options] = mocks.apiRequest.mock.calls[0];
        expect(options.signal).toBeUndefined();
        expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it('shows a warning when global model list loading fails', () => {
        const state = dataFormulatorSlice.reducer(
            dataFormulatorSlice.getInitialState(),
            { type: fetchGlobalModelList.rejected.type, error: { name: 'Error', message: 'boom' } },
        );

        expect(state.messages.at(-1)?.value).toBe('messages.globalModelListFailed');
    });

    it('ignores aborted global model list requests', () => {
        const state = dataFormulatorSlice.reducer(
            dataFormulatorSlice.getInitialState(),
            { type: fetchGlobalModelList.rejected.type, error: { name: 'AbortError' } },
        );

        expect(state.messages).toHaveLength(0);
    });

    it('clears testing model status when connectivity check fails', () => {
        const initial = {
            ...dataFormulatorSlice.getInitialState(),
            testedModels: [{ id: 'global-1', status: 'testing' as const, message: 'checking' }],
        };

        const state = dataFormulatorSlice.reducer(
            initial,
            { type: fetchAvailableModels.rejected.type, error: { name: 'Error', message: 'boom' } },
        );

        expect(state.testedModels[0]).toEqual({ id: 'global-1', status: 'configured', message: '' });
        expect(state.messages.at(-1)?.value).toBe('messages.availableModelsFailed');
    });

    it('ignores aborted connectivity checks', () => {
        const initial = {
            ...dataFormulatorSlice.getInitialState(),
            testedModels: [{ id: 'global-1', status: 'testing' as const, message: 'checking' }],
        };

        const state = dataFormulatorSlice.reducer(
            initial,
            { type: fetchAvailableModels.rejected.type, error: { name: 'AbortError' } },
        );

        expect(state.testedModels[0].status).toBe('testing');
        expect(state.messages).toHaveLength(0);
    });
});
