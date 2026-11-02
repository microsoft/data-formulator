import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { beforeEach, expect, it, vi } from 'vitest';
import { store } from '../../../../src/app/store';
import { dfActions } from '../../../../src/app/dfSlice';
import { apiRequest } from '../../../../src/app/apiClient';
import { ToolsAccessButton } from '../../../../src/components/ToolsAccess';
import { requestToolsDialog } from '../../../../src/app/toolsSettings';
import type { FormArtifact } from '../../../../src/components/ComponentType';

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: vi.fn() }));

const POLICY = '/api/configurations/terminal';
const policy = (overrides: Record<string, unknown> = {}) => ({ mode: 'ask', enabled: true, available: true, locked: false, revision: 2,
    sandboxed: true, sandboxInstallHint: null,
    sandboxFilesystem: { configured: false, requested: ['~/.azure'], allowWrite: ['/home/me/.azure'], skipped: [] }, ...overrides });
const server = { id: 'docs', name: 'Docs', transport: 'http', url: 'https://docs.example/mcp', enabled: true, auth: { type: 'none' },
    tools: [{ name: 'search', enabled: true }], status: 'connected', secrets: { header: false, env: [], client_secret: false, signed_in: false } };

type Call = [string, any];
const serve = (state: ReturnType<typeof policy>, calls: Call[]) => vi.mocked(apiRequest).mockImplementation(async (url: string, init?: any) => {
    calls.push([url, init]);
    if (url === POLICY && init?.method === 'PUT') {
        const { revision, ...change } = JSON.parse(init.body);
        Object.assign(state, change, { revision: revision + 1 });
    }
    if (url === POLICY) return { data: { ...state } } as any;
    if (url === '/api/mcp') return { data: { available: true, mode: state.mode, servers: [server] } } as any;
    return { data: {} } as any;
});

const open = (config: Record<string, unknown> = {}) => {
    store.dispatch(dfActions.resetState());
    store.dispatch(dfActions.setServerConfig({ ...store.getState().serverConfig, TOOLS_MODE: 'ask', TERMINAL_MODE: 'ask',
        TERMINAL_AVAILABLE: true, MCP_AVAILABLE: true, IS_LOCAL_MODE: true, DISABLE_DATA_CONNECTORS: false, ...config }));
    const view = render(<Provider store={store}><ToolsAccessButton /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /^Tools:/ }));
    return view;
};

beforeEach(() => vi.mocked(apiRequest).mockReset());

it('lists the terminal and MCP servers under one shared approval mode', async () => {
    const calls: Call[] = [];
    const state = policy();
    serve(state, calls);
    const { unmount } = open();
    const dialog = screen.getByRole('dialog', { name: 'Tools' });
    await within(dialog).findByText('Docs');
    // The chip counts the terminal and the server that is on, and shows the shared mode.
    expect(screen.getByRole('button', { name: 'Tools: 2 on, Ask every time', hidden: true })).toBeTruthy();
    expect(within(dialog).getByText('Terminal')).toBeTruthy();
    expect(within(dialog).getByText('Sandboxed')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '+ Add tool' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Remove Docs' })).toBeTruthy();

    const auto = within(dialog).getByRole('radio', { name: 'Auto when safe' });
    await waitFor(() => expect(auto).toBeEnabled());
    fireEvent.click(auto);
    await waitFor(() => expect(store.getState().serverConfig.TOOLS_MODE).toBe('auto'));
    expect(store.getState().serverConfig.TERMINAL_MODE).toBe('auto');
    expect(screen.getByRole('button', { name: 'Tools: 2 on, Auto when safe', hidden: true })).toBeTruthy();
    expect(within(dialog).getByText(/read-only MCP tools run without asking/)).toBeTruthy();
    const save = calls.filter(([url, init]) => url === POLICY && init?.method === 'PUT');
    expect(save).toHaveLength(1);
    expect(save[0][1].headers['X-DF-Configuration']).toBe('1');
    expect(JSON.parse(save[0][1].body)).toEqual({ mode: 'auto', revision: 2 });

    // The terminal's switch turns it off; the mode the MCP servers share stays.
    fireEvent.click(within(dialog).getByLabelText('Use the terminal'));
    await waitFor(() => expect(store.getState().serverConfig.TERMINAL_MODE).toBe('off'));
    expect(store.getState().serverConfig.TOOLS_MODE).toBe('auto');
    expect(JSON.parse(calls.filter(([url, init]) => url === POLICY && init?.method === 'PUT')[1][1].body)).toEqual({ enabled: false, revision: 3 });
    expect(screen.getByRole('button', { name: 'Tools: 1 on, Auto when safe', hidden: true })).toBeTruthy();
    unmount();
});

it('saves the terminal sandbox write paths from its row', async () => {
    const calls: Call[] = [];
    serve(policy(), calls);
    const { unmount } = open();
    const dialog = screen.getByRole('dialog', { name: 'Tools' });
    await within(dialog).findByText('Docs');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Terminal details' }));
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Use default CLI state paths' }));
    fireEvent.change(within(dialog).getByLabelText('Writable paths (one per line)'), { target: { value: '~/.azure\n~/.config/gcloud' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some(([url, init]) => url === POLICY && init?.method === 'PUT')).toBe(true));
    expect(JSON.parse(calls.find(([url, init]) => url === POLICY && init?.method === 'PUT')![1].body))
        .toEqual({ sandbox: { filesystem: { allowWrite: ['~/.azure', '~/.config/gcloud'] } }, revision: 2 });
    unmount();
});

it.each(['environment', 'deployment'] as const)('keeps the mode fixed under a %s restriction', async restriction => {
    serve(policy(restriction === 'environment' ? { locked: true } : { available: false, mode: 'off' }), []);
    const { unmount } = open(restriction === 'deployment'
        ? { TOOLS_MODE: 'off', TERMINAL_MODE: 'off', MCP_AVAILABLE: false, DISABLE_DATA_CONNECTORS: true } : {});
    const dialog = screen.getByRole('dialog', { name: 'Tools' });
    if (restriction === 'environment') {
        await within(dialog).findByText(/DF_TERMINAL_MODE/);
        for (const radio of within(dialog).getAllByRole('radio')) expect(radio).toBeDisabled();
    } else {
        await within(dialog).findByText(/turns off user connections and tools/);
        expect(within(dialog).queryByRole('radio')).toBeNull();
    }
    unmount();
});

it('shows a failed save and keeps the previous mode', async () => {
    const calls: Call[] = [];
    serve(policy(), calls);
    const { unmount } = open();
    const dialog = screen.getByRole('dialog', { name: 'Tools' });
    const off = within(dialog).getByRole('radio', { name: 'Off' });
    await waitFor(() => expect(off).toBeEnabled());
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Configuration changed. Reload before saving.'));
    fireEvent.click(off);
    await within(dialog).findByText('Configuration changed. Reload before saving.');
    expect(store.getState().serverConfig.TOOLS_MODE).toBe('ask');
    unmount();
});

it('is hidden on a demo site', () => {
    store.dispatch(dfActions.resetState());
    store.dispatch(dfActions.setServerConfig({ ...store.getState().serverConfig, TOOLS_MODE: 'ask', SITE: 'unesco' } as any));
    const { container, unmount } = render(<Provider store={store}><ToolsAccessButton /></Provider>);
    expect(container).toBeEmptyDOMElement();
    unmount();
});

const proposalStore = (form: FormArtifact) => {
    store.dispatch(dfActions.resetState());
    store.dispatch(dfActions.setServerConfig({ ...store.getState().serverConfig, TOOLS_MODE: 'ask', TERMINAL_MODE: 'ask',
        TERMINAL_AVAILABLE: true, MCP_AVAILABLE: true, IS_LOCAL_MODE: true, DISABLE_DATA_CONNECTORS: false, SITE: undefined } as any));
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'turn-mcp', displayId: 'turn-mcp', textKind: 'explain', content: 'Review',
        parentNodeId: 'root', createdAt: 1, form } as any));
};
const files = { id: 'files', name: 'Files', transport: 'stdio', command: 'npx', args: ['-y', '@scope/files', '/tmp/my dir'], enabled: true,
    auth: { type: 'none' }, tools: [{ name: 'read', enabled: true }], secrets: { header: false, env: ['ROOT'], client_secret: false, signed_in: false } };

it('reviews an agent proposal in the Tools dialog and closes once the server connects', async () => {
    const calls: Call[] = [];
    let servers: any[] = [];
    vi.mocked(apiRequest).mockImplementation(async (url: string, init?: any) => {
        calls.push([url, init]);
        if (url === POLICY) return { data: policy() } as any;
        if (url === '/api/mcp') return { data: { available: true, mode: 'ask', servers } } as any;
        if (url === '/api/mcp/import') { servers = [{ ...files, status: null }];
            return { data: { available: true, mode: 'ask', servers, added: [{ id: 'files', name: 'Files', notes: [] }], skipped: [] } } as any; }
        if (url === '/api/mcp/servers/files/connect') { servers = [{ ...files, status: 'connected' }];
            return { data: { status: 'connected', server: servers[0] } } as any; }
        return { data: {} } as any;
    });
    proposalStore({ kind: 'mcp', title: 'Add Files', mcp: { changes: [], add: [{ name: 'Files', transport: 'stdio', command: 'npx',
        args: ['-y', '@scope/files', '/tmp/my dir'], envNames: ['ROOT'], reason: 'Read project files' }] } });
    const { unmount } = render(<Provider store={store}><ToolsAccessButton /></Provider>);
    act(() => requestToolsDialog('turn-mcp'));

    const dialog = await screen.findByRole('dialog', { name: 'Tools' });
    expect(within(dialog).getByText('Suggested by the agent')).toBeTruthy();
    expect(within(dialog).getByText('Read project files')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: '+ Add tool' })).toBeNull();
    const editor = within(dialog).getByLabelText('MCP server configuration (JSON)') as HTMLTextAreaElement;
    expect(JSON.parse(editor.value)).toEqual({ mcpServers: { Files: { command: 'npx', args: ['-y', '@scope/files', '/tmp/my dir'], env: { ROOT: '' } } } });
    const add = within(dialog).getByRole('button', { name: 'Add and connect' });
    await waitFor(() => expect(calls.some(([url]) => url === '/api/mcp')).toBe(true));
    expect(add).toBeDisabled();
    fireEvent.change(editor, { target: { value: editor.value.replace('"ROOT": ""', '"ROOT": "/data"') } });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tools' })).toBeNull());
    expect(JSON.parse(JSON.parse(calls.find(([url]) => url === '/api/mcp/import')![1].body).config).mcpServers.Files.env).toEqual({ ROOT: '/data' });
    const turn = store.getState().textTurns.find(item => item.id === 'turn-mcp')!;
    expect(turn.answered).toBe(true);
    expect(turn.form?.kind === 'mcp' && turn.form.mcp.add[0].addedId).toBe('files');
    unmount();
});

it('applies proposed switches and the shared mode only on the user\'s click', async () => {
    const calls: Call[] = [];
    const state = policy();
    vi.mocked(apiRequest).mockImplementation(async (url: string, init?: any) => {
        calls.push([url, init]);
        if (url === POLICY && init?.method === 'PUT') Object.assign(state, JSON.parse(init.body));
        if (url === POLICY) return { data: { ...state } } as any;
        if (url === '/api/mcp') return { data: { available: true, mode: state.mode, servers: [{ ...files, status: 'connected' }] } } as any;
        if (url === '/api/mcp/servers/files') return { data: { ...files, status: 'connected', tools: [{ name: 'read', enabled: false }] } } as any;
        return { data: {} } as any;
    });
    proposalStore({ kind: 'mcp', title: 'MCP server changes', mcp: { add: [],
        changes: [{ serverId: 'files', serverName: 'Files', tools: [{ name: 'read', enabled: false }], reason: 'Not needed' }],
        mode: 'auto', currentMode: 'ask' } });
    const { unmount } = render(<Provider store={store}><ToolsAccessButton /></Provider>);
    act(() => requestToolsDialog('turn-mcp'));
    const dialog = await screen.findByRole('dialog', { name: 'Tools' });
    expect(within(dialog).getByText('Files: turn off read')).toBeTruthy();
    expect(within(dialog).getByText('Tools approval: Ask every time → Auto when safe')).toBeTruthy();
    const apply = within(dialog).getByRole('button', { name: 'Apply changes' });
    await waitFor(() => expect(apply).toBeEnabled());
    expect(calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    fireEvent.click(apply);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tools' })).toBeNull());
    expect(JSON.parse(calls.find(([url]) => url === '/api/mcp/servers/files')![1].body)).toEqual({ tools: [{ name: 'read', enabled: false }] });
    expect(JSON.parse(calls.find(([url, init]) => url === POLICY && init?.method === 'PUT')![1].body)).toMatchObject({ mode: 'auto' });
    expect(store.getState().serverConfig.TOOLS_MODE).toBe('auto');
    expect(store.getState().textTurns.find(item => item.id === 'turn-mcp')!.answered).toBe(true);
    unmount();
});

it('adds a ready-made toolkit in one step and connects it', async () => {
    const calls: Call[] = [];
    const state = policy();
    const research = { id: 'research-arxiv', name: 'Research (arXiv)', transport: 'stdio', command: '/py', args: [], enabled: true, pack: 'research',
        auth: { type: 'none' }, tools: [], status: null, secrets: { header: false, env: [], client_secret: false, signed_in: false } };
    vi.mocked(apiRequest).mockImplementation(async (url: string, init?: any) => {
        calls.push([url, init]);
        if (url === POLICY) return { data: { ...state } } as any;
        if (url === '/api/mcp') return { data: { available: true, mode: 'ask', servers: [] } } as any;
        if (url === '/api/mcp/packs') return { data: { packs: [{ id: 'research', name: 'Research', examples: [],
            description: 'Search arXiv, follow new papers in a field, chart publication trends and read full texts.',
            settings: [{ key: 'email', label: 'Contact email (optional)' }], server_id: null }] } } as any;
        if (url === '/api/mcp/packs/research') return { data: research } as any;
        if (url === '/api/mcp/servers/research-arxiv/connect') return { data: { status: 'connected', server: { ...research, status: 'connected',
            tools: [{ name: 'search_papers', enabled: true }] } } } as any;
        return { data: {} } as any;
    });
    const { unmount } = open();
    const dialog = screen.getByRole('dialog', { name: 'Tools' });
    const addTool = await within(dialog).findByRole('button', { name: '+ Add tool' });
    await waitFor(() => expect(calls.some(([url]) => url === '/api/mcp/packs')).toBe(true));
    fireEvent.click(addTool);
    expect(within(dialog).getByRole('tab', { name: 'Data Formulator toolkits' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByText(/Search arXiv, follow new papers/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Contact email (optional)'), { target: { value: 'me@example.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    await within(dialog).findByText('Research (arXiv)');
    expect(JSON.parse(calls.find(([url]) => url === '/api/mcp/packs/research')![1].body)).toEqual({ settings: { email: 'me@example.com' } });
    await waitFor(() => expect(calls.some(([url]) => url === '/api/mcp/servers/research-arxiv/connect')).toBe(true));
    // A toolkit's row says what it is rather than its command line.
    expect(within(dialog).getByText('Data Formulator toolkit')).toBeTruthy();
    expect(within(dialog).queryByRole('tab', { name: 'Data Formulator toolkits' })).toBeNull();
    unmount();
});
