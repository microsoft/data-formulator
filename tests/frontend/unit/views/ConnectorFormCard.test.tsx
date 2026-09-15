import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider, useSelector } from 'react-redux';
import { expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions } from '../../../../src/app/dfSlice';
import { ConnectorFormCard } from '../../../../src/components/ConnectorFormCard';
import { apiRequest } from '../../../../src/app/apiClient';
import { CONNECTOR_URLS, CONNECTOR_ACTION_URLS } from '../../../../src/app/utils';

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: vi.fn() }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Connector' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'MySQL' }));
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
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async (url) => {
        if (url === CONNECTOR_URLS.DATA_LOADERS) return { data: { loaders: [{ type: 'mysql', name: 'MySQL',
            params: [{ name: 'host', type: 'string', tier: 'connection', required: true }] }] } } as any;
        if (url === CONNECTOR_URLS.CREATE) return { data: { id: 'connector-1' } } as any;
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
    expect(getComputedStyle(busyForm).position).toBe('relative');
    expect(busyForm.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByDisplayValue('db.example')).toBeTruthy();
    expect(onResolved).not.toHaveBeenCalled();
    await act(async () => finishConnect({ data: { status: 'error', message: 'Connection refused' } }));
    expect(busyForm.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByDisplayValue('db.example')).toBeTruthy();
    expect(onResolved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create Connector' }));
    await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([url]) => url === CONNECTOR_ACTION_URLS.CONNECT)).toHaveLength(2));
    await act(async () => finishConnect({ data: { status: 'connected' } }));
    expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ status: 'connected', connectorId: 'connector-1' }));
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