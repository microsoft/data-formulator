import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    apiRequest: vi.fn(),
    updateWorkspaceMeta: vi.fn(),
    state: {
        activeWorkspace: { id: 'ws-1', displayName: 'Untitled Session' },
        tables: [{ id: 'orders', displayId: '订单' }],
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
        setActiveWorkspace: (payload: any) => ({ type: 'setActiveWorkspace', payload }),
    },
    dfSelectors: {
        getAllModels: (state: any) => [...(state.globalModels ?? []), ...(state.models ?? [])],
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

import { isUntitledWorkspaceName, useWorkspaceAutoName } from '../../../../src/app/useWorkspaceAutoName';

function AutoNameHarness() {
    useWorkspaceAutoName();
    return null;
}

describe('useWorkspaceAutoName', () => {
    beforeEach(() => {
        mocks.dispatch.mockReset();
        mocks.apiRequest.mockReset();
        mocks.updateWorkspaceMeta.mockReset();
        mocks.state.activeWorkspace = { id: 'ws-1', displayName: 'Untitled Session' };
        mocks.state.selectedModelId = 'global-1';
        mocks.apiRequest.mockResolvedValue({ data: { display_name: '销售分析' } });
        mocks.updateWorkspaceMeta.mockResolvedValue(undefined);
    });

    afterEach(() => {
        cleanup();
    });

    it('recognizes the workspace placeholder name', () => {
        expect(isUntitledWorkspaceName('Untitled Session')).toBe(true);
        expect(isUntitledWorkspaceName('Sales Analysis')).toBe(false);
    });

    it('calls the workspace name API with the selected server-managed model payload', async () => {
        render(<AutoNameHarness />);

        await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledOnce());

        const [url, options] = mocks.apiRequest.mock.calls[0];
        expect(url).toBe('/api/agent/workspace-name');
        expect(JSON.parse(options.body)).toEqual({
            model: mocks.state.globalModels[0],
            context: {
                tables: ['订单'],
                userQuery: '分析销售趋势',
            },
        });

        await waitFor(() => {
            expect(mocks.dispatch).toHaveBeenCalledWith({
                type: 'setActiveWorkspace',
                payload: { id: 'ws-1', displayName: '销售分析' },
            });
        });
        expect(mocks.updateWorkspaceMeta).toHaveBeenCalledWith('ws-1', '销售分析');
    });

    it('does not auto-name a custom workspace name', async () => {
        mocks.state.activeWorkspace = { id: 'ws-1', displayName: 'My Analysis' };

        render(<AutoNameHarness />);

        await waitFor(() => expect(mocks.apiRequest).not.toHaveBeenCalled());
    });
});
