import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider, useSelector } from 'react-redux';
import { expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions } from '../../../../src/app/dfSlice';
import { ConnectorFormCard } from '../../../../src/components/ConnectorFormCard';
import { DataLoaderForm } from '../../../../src/views/DBTableManager';
import { apiRequest } from '../../../../src/app/apiClient';
import { CONNECTOR_URLS, CONNECTOR_ACTION_URLS, fetchConnectorCatalog } from '../../../../src/app/utils';

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: vi.fn() }));

it('polls discovery after a gateway timeout without restarting the scan', async () => {
    vi.useFakeTimers();
    try {
        vi.mocked(apiRequest).mockReset();
        vi.mocked(apiRequest)
            .mockResolvedValueOnce({ data: { discovery: { status: 'running', message: 'Listing files' } } } as any)
            .mockRejectedValueOnce(Object.assign(new Error('HTTP 504'), { httpStatus: 504 }))
            .mockResolvedValueOnce({ data: { discovery: { status: 'complete' }, tree: [] } } as any);
        const onProgress = vi.fn();
        const result = fetchConnectorCatalog('slow-source', { onProgress });
        await vi.runAllTimersAsync();
        expect((await result).data.tree).toEqual([]);
        const bodies = vi.mocked(apiRequest).mock.calls.map(([, options]) => JSON.parse(options!.body as string));
        expect(bodies.map(body => body.poll)).toEqual([false, true, true]);
        expect(bodies.map(body => body.retry)).toEqual([true, false, false]);
        expect(onProgress).toHaveBeenCalledWith('Listing files');
    } finally {
        vi.useRealTimers();
    }
});

it.each([true, false])('keeps a timed-out connector and checks its status (connected=%s)', async (connected) => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async (url) => {
        if (url === CONNECTOR_ACTION_URLS.CONNECT) throw Object.assign(new Error('HTTP 504'), { httpStatus: 504 });
        return { data: { connected } } as any;
    });
    const store = configureStore({ reducer: dataFormulatorReducer });
    const onConnected = vi.fn();
    const onConnectionFailed = vi.fn();
    render(<Provider store={store}><DataLoaderForm dataLoaderType="timeout" loaderType="mysql"
        connectorId="timeout" paramDefs={[]} authInstructions="" authMode="connection"
        onImport={() => {}} onFinish={() => {}} onConnected={onConnected}
        onConnectionFailed={onConnectionFailed} /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /^Connect/ }));
    if (connected) await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    else await screen.findByText(/Your connector has been kept/);
    expect(onConnectionFailed).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith(CONNECTOR_ACTION_URLS.GET_STATUS, expect.anything());
});

it('reuses the retained connector when a timed-out connection later succeeds', async () => {
    vi.mocked(apiRequest).mockReset();
    let connected = false;
    vi.mocked(apiRequest).mockImplementation(async url => {
        if (url === CONNECTOR_ACTION_URLS.CONNECT) throw Object.assign(new Error('HTTP 504'), { httpStatus: 504 });
        return { data: { connected } } as any;
    });
    const store = configureStore({ reducer: dataFormulatorReducer });
    const onBeforeConnect = vi.fn().mockResolvedValue('retained-connector');
    const onConnected = vi.fn();
    const onConnectionFailed = vi.fn();
    render(<Provider store={store}><DataLoaderForm dataLoaderType="retained" loaderType="mysql"
        paramDefs={[]} authInstructions="" authMode="connection" onBeforeConnect={onBeforeConnect}
        onImport={() => {}} onFinish={() => {}} onConnected={onConnected}
        onConnectionFailed={onConnectionFailed} /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
    await screen.findByText(/Your connector has been kept/);
    connected = true;
    fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    expect(onBeforeConnect).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiRequest).mock.calls.filter(([url]) => url === CONNECTOR_ACTION_URLS.CONNECT)).toHaveLength(1);
    expect(onConnectionFailed).not.toHaveBeenCalled();
});

it('stops catalog polling when the view is closed', async () => {
    vi.useFakeTimers();
    try {
        vi.mocked(apiRequest).mockReset();
        vi.mocked(apiRequest).mockResolvedValue({ data: { discovery: { status: 'running' } } } as any);
        const controller = new AbortController();
        const result = fetchConnectorCatalog('source', { signal: controller.signal }).catch(error => error);
        await vi.advanceTimersByTimeAsync(0);
        controller.abort();
        expect((await result).name).toBe('AbortError');
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    } finally {
        vi.useRealTimers();
    }
});

it('connects a server-configured source without requesting credentials', async () => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { status: 'connected' } } as any);
    const store = configureStore({ reducer: dataFormulatorReducer });
    const onConnected = vi.fn();
    render(<Provider store={store}><DataLoaderForm dataLoaderType="installation-test" loaderType="mysql"
        connectorId="installation-test" paramDefs={[]} authInstructions="" authMode="connection"
        onImport={() => {}} onFinish={() => {}} onConnected={onConnected} /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /^Connect/ }));
    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    expect(apiRequest).toHaveBeenCalledWith(CONNECTOR_ACTION_URLS.CONNECT, expect.objectContaining({
        method: 'POST', body: expect.stringContaining('"connector_id":"installation-test"'),
    }));
});

it('shows configured parameters and retries without submitting display values', async () => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { status: 'error', message: 'Database unavailable' } } as any)
        .mockResolvedValueOnce({ data: { status: 'connected' } } as any);
    const store = configureStore({ reducer: dataFormulatorReducer });
    const onConnected = vi.fn();
    render(<Provider store={store}><DataLoaderForm dataLoaderType="installation-summary" loaderType="mysql"
        connectorId="installation-summary" paramDefs={[]} authInstructions="" authMode="connection"
        configuredParams={{ host: 'db.example', port: 3306, password: '********' }}
        onImport={() => {}} onFinish={() => {}} onConnected={onConnected} /></Provider>);
    expect(screen.getByText('db.example')).toBeTruthy();
    expect(screen.getByText('********')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(apiRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Connect/ }));
    await screen.findByRole('alert');
    expect(onConnected).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    for (const [, options] of vi.mocked(apiRequest).mock.calls) {
        expect(JSON.parse(options!.body as string)).toEqual({ connector_id: 'installation-summary', params: {}, persist: false });
    }
});

it('opens an unselected form and switches connectors without retaining credentials or stale edits', async () => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { loaders: [
        { type: 'mysql', name: 'MySQL', params: [
            { name: 'host', type: 'string', required: true },
            { name: 'password', type: 'password', sensitive: true, required: true },
        ] },
        { type: 'postgresql', name: 'PostgreSQL', params: [
            { name: 'host', type: 'string', required: true },
            { name: 'password', type: 'password', sensitive: true, required: true },
        ] },
    ] } } as any);
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'selector', displayId: 'selector', textKind: 'explain',
        content: 'Connect', createdAt: 1, form: { kind: 'connector', title: 'Connect a data source',
            connector: { sourceType: '' }, draft: { revision: 0, fields: [], changedByAgent: [], conflict: false } } }));
    const Form = () => {
        const prompt = useSelector((state: ReturnType<typeof store.getState>) => state.textTurns[0].form!.connector);
        return <ConnectorFormCard messageId="selector" prompt={prompt} variant="bare" onResolved={() => {}} />;
    };
    const view = render(<Provider store={store}><Form /></Provider>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connector' }).hasAttribute('disabled')).toBe(false));
    expect(screen.getByText('Choose a connector')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'PostgreSQL' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'MySQL' }));
    const host = await screen.findByRole('textbox');
    fireEvent.change(host, { target: { value: 'old.example' } });
    fireEvent.change(view.container.querySelector('input[type="password"]')!, { target: { value: 'private-secret' } });
    const revision = store.getState().textTurns[0].form!.draft!.revision;
    fireEvent.click(screen.getByRole('button', { name: 'Connector' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'PostgreSQL' }));
    await waitFor(() => expect(store.getState().textTurns[0].form!.connector.sourceType).toBe('postgresql'));
    expect(screen.queryByDisplayValue('old.example')).toBeNull();
    expect((view.container.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('');
    act(() => store.dispatch(dfActions.selectConnectorFormSource({
        id: 'selector', sourceType: 'mysql', title: 'MySQL', fields: ['host'], revision,
    })));
    expect(store.getState().textTurns[0].form!.connector.sourceType).toBe('postgresql');
    expect(store.getState().textTurns[0].form!.draft!.conflict).toBe(true);
    expect(store.getState().textTurns).toHaveLength(1);
    expect(vi.mocked(apiRequest).mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
});

it('keeps the form pending through creation and failed connection, resolving only after success', async () => {
    let finishConnect!: (result: any) => void;
    let createCount = 0;
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async (url) => {
        if (url === CONNECTOR_URLS.DATA_LOADERS) return { data: { loaders: [{ type: 'mysql', name: 'MySQL',
            params: [{ name: 'host', type: 'string', tier: 'connection', required: true }] }] } } as any;
        if (url === CONNECTOR_URLS.CREATE) return { data: { id: `connector-${++createCount}` } } as any;
        if (url === CONNECTOR_ACTION_URLS.CONNECT) return new Promise(resolve => { finishConnect = resolve; });
        return { data: { connectors: [] } } as any;
    });
    const store = configureStore({ reducer: dataFormulatorReducer });
    const prompt = { sourceType: 'mysql', prefilled: { host: 'db.example' } };
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'pending-form', displayId: 'pending-form', textKind: 'explain',
        content: 'Connect', createdAt: 1, form: { kind: 'connector', title: 'MySQL', connector: prompt } }));
    const onResolved = vi.fn();
    render(<Provider store={store}><ConnectorFormCard messageId="pending-form" prompt={prompt} onResolved={onResolved} /></Provider>);
    await screen.findByDisplayValue('db.example');
    fireEvent.click(screen.getByRole('button', { name: 'Create Connector' }));
    await waitFor(() => expect(finishConnect).toBeDefined());
    const busyForm = screen.getByRole('status').parentElement!;
    expect(busyForm.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByDisplayValue('db.example')).toBeTruthy();
    expect(onResolved).not.toHaveBeenCalled();
    await act(async () => finishConnect({ data: { status: 'error', message: 'Connection refused' } }));
    expect(busyForm.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByDisplayValue('db.example')).toBeTruthy();
    expect(onResolved).not.toHaveBeenCalled();
    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(CONNECTOR_URLS.DELETE('connector-1'), { method: 'DELETE' });
    fireEvent.click(screen.getByRole('button', { name: 'Create Connector' }));
    await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([url]) => url === CONNECTOR_ACTION_URLS.CONNECT)).toHaveLength(2));
    await act(async () => finishConnect({ data: { status: 'connected' } }));
    expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ status: 'connected', connectorId: 'connector-2' }));
    expect(vi.mocked(apiRequest).mock.calls.filter(([url, options]) =>
        url === CONNECTOR_URLS.CREATE && options?.method === 'POST')).toHaveLength(2);
});

it('keeps reopened drafts, tracks typing before blur, and applies agent updates to visible fields', async () => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { loaders: [{ type: 'mysql', name: 'MySQL', params: [
        { name: 'host', type: 'string', required: true },
        { name: 'password', type: 'password', sensitive: true, required: true },
    ] }] } } as any);
    const store = configureStore({ reducer: dataFormulatorReducer });
    const prompt = { sourceType: 'mysql', prefilled: { host: 'initial.example' } };
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'form', displayId: 'form', textKind: 'explain',
        content: 'Connect', createdAt: 1, form: { kind: 'connector', title: 'MySQL', connector: prompt } }));
    const mount = () => render(<Provider store={store}><ConnectorFormCard messageId="form" prompt={prompt} onResolved={() => {}} /></Provider>);
    const first = mount();
    await screen.findByDisplayValue('initial.example');
    const host = screen.getByDisplayValue('initial.example');
    fireEvent.change(host, { target: { value: 'user.example' } });
    expect(store.getState().dataLoaderConnectParams['connector-form:form'].host).toBe('user.example');
    const password = first.container.querySelector('input[type="password"]')!;
    fireEvent.change(password, { target: { value: 'private-secret' } });
    fireEvent.blur(password);
    expect(JSON.stringify(store.getState().dataLoaderConnectParams)).not.toContain('private-secret');
    fireEvent.blur(host);
    first.unmount();
    mount();
    await screen.findByDisplayValue('user.example');
    const revision = store.getState().textTurns[0].form!.draft!.revision;
    act(() => store.dispatch(dfActions.patchConnectorDraft({ id: 'form', revision, values: { host: 'agent.example' } })));
    await screen.findByDisplayValue('agent.example');
    expect(screen.getByRole('status').textContent).toContain('host');
    act(() => store.dispatch(dfActions.patchConnectorDraft({ id: 'form', revision, values: { host: 'stale.example' } })));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByDisplayValue('agent.example')).toBeTruthy();
    expect(vi.mocked(apiRequest).mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
});