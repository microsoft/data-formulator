import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions } from '../../../../src/app/dfSlice';
import { apiRequest } from '../../../../src/app/apiClient';
import { DataLoaderForm } from '../../../../src/views/DBTableManager';

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: vi.fn() }));

it('only discovers the selected subscription and ignores stale results when switching', async () => {
    const pending = new Map<string, (result: any) => void>();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async (url, options) => {
        if (url === '/api/local/azure-status') return { data: { installed: true, signed_in: true, account: { user: 'user@example.com' } } } as any;
        if (url === '/api/model-endpoints/azure/subscriptions') return { data: {
            subscriptions: ['default', 'empty', 'failed', 'research'].map(id => ({ id, name: id })), default_subscription: 'default',
        } } as any;
        if (url === '/api/model-endpoints/azure/kusto-clusters') {
            const id = JSON.parse(String(options?.body)).subscription_id;
            if (id === 'failed') throw new Error('Permission denied');
            return new Promise(resolve => pending.set(id, resolve));
        }
        return { data: {} } as any;
    });
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.setServerConfig({ ...store.getState().serverConfig, IS_LOCAL_MODE: true }));
    render(<Provider store={store}><DataLoaderForm dataLoaderType="kusto" loaderType="kusto" compact comfortableSpacing
        paramDefs={[
            { name: 'kusto_cluster', type: 'string', required: true, tier: 'connection' },
            { name: 'kusto_database', type: 'string', required: true, tier: 'connection' },
        ]} authInstructions="" authPaths={[{ id: 'ambient', label: 'Azure CLI', kind: 'ambient', default: true,
            fields: [], required_fields: [], cli_login: { provider: 'azure', label: 'Sign in with Azure CLI',
                status_url: '/api/local/azure-status', login_url: '/api/local/azure-login' } }]}
        onImport={() => {}} onFinish={() => {}} /></Provider>);
    const subscriptionInput = await screen.findByRole('combobox', { name: 'Subscription' });
    fireEvent.mouseDown(subscriptionInput);
    await screen.findByRole('option', { name: 'research' });
    expect(screen.getByRole('option', { name: 'empty' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'failed' })).toBeTruthy();
    expect(pending.size).toBe(0);
    fireEvent.click(screen.getByRole('option', { name: 'default' }));
    await waitFor(() => expect(pending.has('default')).toBe(true));
    expect(pending.size).toBe(1);
    const firstRequest = vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/model-endpoints/azure/kusto-clusters')!;
    fireEvent.mouseDown(subscriptionInput);
    fireEvent.change(subscriptionInput, { target: { value: 'research' } });
    fireEvent.click(await screen.findByRole('option', { name: 'research' }));
    await waitFor(() => expect(pending.has('research')).toBe(true));
    expect(firstRequest[1]?.signal?.aborted).toBe(true);
    const clusters = [{ id: 'cluster', name: 'Cluster', uri: 'https://cluster.kusto.windows.net', region: 'westus', resource_group: 'group', state: 'Running' }];
    await act(async () => pending.get('research')!({ data: { clusters: [] } }));
    await act(async () => pending.get('default')!({ data: { clusters } }));
    await screen.findByDisplayValue('research');
    expect(screen.getByText(/No clusters found in this subscription/)).toBeTruthy();
    expect(vi.mocked(apiRequest).mock.calls.filter(([url]) => url === '/api/model-endpoints/azure/kusto-clusters')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Azure clusters' }));
    await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([url]) => url === '/api/model-endpoints/azure/kusto-clusters')).toHaveLength(3));
    await act(async () => pending.get('research')!({ data: { clusters: [] } }));
    fireEvent.mouseDown(subscriptionInput);
    fireEvent.change(subscriptionInput, { target: { value: 'failed' } });
    fireEvent.click(await screen.findByRole('option', { name: 'failed' }));
    await screen.findByText('Permission denied');
    expect(vi.mocked(apiRequest).mock.calls.filter(([url]) => url === '/api/model-endpoints/azure/kusto-clusters')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Enter cluster details manually' }));
    expect(screen.queryByRole('combobox', { name: 'Subscription' })).toBeNull();
    expect(screen.getByRole('combobox', { name: /Kusto database/ })).toBeTruthy();
});