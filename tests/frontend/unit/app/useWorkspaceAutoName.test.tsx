import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    apiRequest: vi.fn(),
    updateWorkspaceMeta: vi.fn(),
    state: {
        activeWorkspace: null as any,
        inputTables: [] as any[],
        externalTableReferences: [] as any[],
        workspaceItemOrder: [] as string[],
        derivedTables: [],
        textTurns: [] as any[],
        draftNodes: [
            {
                derive: {
                    trigger: {
                        interaction: [
                            {
                                from: 'user',
                                role: 'instruction',
                                content: '分析销售趋势',
                            },
                        ],
                    },
                },
            },
        ],
        globalModels: [
            {
                id: 'global-1',
                endpoint: 'openai',
                model: 'gpt-4o',
                is_global: true,
            },
        ],
        models: [
            {
                id: 'user-1',
                endpoint: 'openai',
                model: 'gpt-4o-mini',
                api_key: 'sk-user',
                api_base: 'https://api.openai.com/v1',
            },
        ],
        selectedModelId: 'global-1',
    },
}));

vi.mock('react-redux', () => ({
    useDispatch: () => mocks.dispatch,
    useSelector: (selector: any) => selector(mocks.state),
}));

vi.mock('../../../../src/app/dfSlice', () => ({
    dfActions: {
        renameActiveWorkspace: (payload: any) => ({ type: 'renameActiveWorkspace', payload }),
        setAutoWorkspaceName: (payload: any) => ({ type: 'setAutoWorkspaceName', payload }),
    },
    dfSelectors: {
        getAllModels: (state: any) => [...(state.globalModels ?? []), ...(state.models ?? [])],
        getAllTables: (state: any) => [...(state.inputTables ?? []), ...(state.derivedTables ?? [])],
    },
}));

vi.mock('../../../../src/app/utils', () => ({
    getUrls: () => ({
        WORKSPACE_NAME: '/api/agent/workspace-name',
    }),
}));

vi.mock('../../../../src/app/apiClient', () => ({
    apiRequest: (...args: any[]) => mocks.apiRequest(...args),
}));

vi.mock('../../../../src/app/workspaceService', () => ({
    updateWorkspaceMeta: (...args: any[]) => mocks.updateWorkspaceMeta(...args),
}));

import { isAutoNamed, useWorkspaceAutoName } from '../../../../src/app/useWorkspaceAutoName';

function AutoNameHarness() {
    useWorkspaceAutoName();
    return null;
}

const placeholder = 'Analysis Session · Oct 1, 3:42 PM';
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(2000); });

describe('useWorkspaceAutoName', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.dispatch.mockReset();
        mocks.apiRequest.mockReset();
        mocks.updateWorkspaceMeta.mockReset();
        mocks.state.activeWorkspace = { id: 'ws-1', displayName: placeholder, autoName: { name: placeholder, sources: [] } };
        mocks.state.inputTables = [{ id: 'orders', displayId: '订单' }];
        mocks.state.externalTableReferences = [{ displayName: 'Sales (warehouse)' }];
        mocks.state.workspaceItemOrder = ['workspace-file-notes.pdf', 'workspace-file-scratch/tmp.csv', 'shelf-card-orders'];
        mocks.state.selectedModelId = 'global-1';
        mocks.apiRequest.mockResolvedValue({ data: { display_name: '销售分析' } });
        mocks.updateWorkspaceMeta.mockResolvedValue(undefined);
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('treats placeholder and auto-set names as auto-managed, and user names as final', () => {
        expect(isAutoNamed({ id: 'a', displayName: 'Untitled Session' })).toBe(true);
        expect(isAutoNamed({ id: 'a', displayName: 'Sales', autoName: { name: 'Sales', sources: [] } })).toBe(true);
        expect(isAutoNamed({ id: 'a', displayName: 'Mine', autoName: { name: 'Sales', sources: [] } })).toBe(false);
    });

    it('names the session from its sources once they settle', async () => {
        render(<AutoNameHarness />);
        expect(mocks.apiRequest).not.toHaveBeenCalled();
        await settle();

        const [url, options] = mocks.apiRequest.mock.calls[0];
        expect(url).toBe('/api/agent/workspace-name');
        expect(JSON.parse(options.body)).toEqual({
            model: mocks.state.globalModels[0],
            context: { tables: ['订单', 'Sales (warehouse)', 'notes.pdf'], userQuery: '分析销售趋势' },
        });
        expect(mocks.dispatch).toHaveBeenCalledWith({
            type: 'setAutoWorkspaceName',
            payload: { id: 'ws-1', displayName: '销售分析', sources: ['订单', 'Sales (warehouse)', 'notes.pdf'] },
        });
        expect(mocks.updateWorkspaceMeta).toHaveBeenCalledWith('ws-1', '销售分析');
    });

    it('keeps the dated name while there are no sources', async () => {
        mocks.state.inputTables = [];
        mocks.state.externalTableReferences = [];
        mocks.state.workspaceItemOrder = [];
        render(<AutoNameHarness />);
        await settle();
        expect(mocks.apiRequest).not.toHaveBeenCalled();
    });

    it('renames only when a new source arrives', async () => {
        mocks.state.activeWorkspace = { id: 'ws-1', displayName: 'Orders', autoName: { name: 'Orders', sources: ['订单', 'Sales (warehouse)', 'notes.pdf'] } };
        const { rerender } = render(<AutoNameHarness />);
        await settle();
        expect(mocks.apiRequest).not.toHaveBeenCalled();

        mocks.state.inputTables = [{ id: 'orders', displayId: '订单' }, { id: 'returns', displayId: 'returns' }];
        rerender(<AutoNameHarness />);
        await settle();
        expect(JSON.parse(mocks.apiRequest.mock.calls[0][1].body).context.tables).toEqual(['订单', 'returns', 'Sales (warehouse)', 'notes.pdf']);
    });

    it('stops auto-naming once the user renames the session', async () => {
        mocks.state.activeWorkspace = { id: 'ws-1', displayName: 'My Analysis', autoName: { name: placeholder, sources: [] } };
        render(<AutoNameHarness />);
        await settle();
        expect(mocks.apiRequest).not.toHaveBeenCalled();
    });
});
