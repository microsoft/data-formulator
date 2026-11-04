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
    tools: [{ name: 'search', enabled: true }, { name: 'fetch', enabled: true, always_allow: true }], status: 'connected',
    secrets: { header: false, env: [], client_secret: false, signed_in: false } };

type Call = [string, any];
const serve = (state: ReturnType<typeof policy>, calls: Call[]) => vi.mocked(apiRequest).mockImplementation(async (url: string, init?: any) => {
    calls.push([url, init]);
    if (url === POLICY && init?.method === 'PUT') {
        const { revision, ...change } = JSON.parse(init.body);
        Object.assign(state, change, { revision: revision + 1 });
    }
    if (url === POLICY) return { data: { ...state } } as any;
    if (url === '/api/mcp') return { data: { available: true, mode: state.mode, servers: [server] } } as any;
    if (url === '/api/mcp/servers/docs' && init?.method === 'PUT') return { data: { ...server, ...JSON.parse(init.body) } } as any;
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
    // Home: a card for each of the user's tools, with its state, then what can be added; a card opens its page.
    expect(within(dialog).getByRole('heading', { name: 'Your tools' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Terminal' })).toBeTruthy();
    expect(within(dialog).getByText('Sandboxed')).toBeTruthy();
    expect(within(dialog).getByText('https://docs.example/mcp')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Add more' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Custom MCP server' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Remove Docs' })).toBeNull();

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

    // Docs' card opens its page in the dialog; back (or Done) returns home.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Docs' }));
    expect(screen.getByRole('dialog', { name: /Tools › Docs/ })).toBe(dialog);
    expect(within(dialog).getByRole('region', { name: 'Tools' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Remove Docs' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(within(dialog).getByLabelText('Use search')).toBeChecked();
    expect(within(dialog).queryByRole('radio', { name: 'Off' })).toBeNull();
    // No per-tool "Always allow" box: a tool the user always allowed (when the agent asked) is tagged, and removing
    // the tag makes it ask again.
    expect(within(dialog).queryByRole('checkbox', { name: /Always allow/ })).toBeNull();
    const tag = within(dialog).getByRole('button', { name: 'Runs without asking' });
    fireEvent.keyUp(tag, { key: 'Delete' });
    await waitFor(() => expect(calls.some(([url, init]) => url === '/api/mcp/servers/docs' && init?.method === 'PUT'
        && init.body.includes('always_allow'))).toBe(true));
    expect(JSON.parse(calls.find(([url, init]) => url === '/api/mcp/servers/docs' && init?.body?.includes('always_allow'))![1].body))
        .toEqual({ tools: [{ name: 'fetch', always_allow: false }] });
    // The details keep the on/off switch, so the user can decide there.
    fireEvent.click(within(dialog).getByLabelText('Use Docs'));
    await waitFor(() => expect(within(dialog).getByLabelText('Use Docs')).not.toBeChecked());
    expect(JSON.parse(calls.filter(([url, init]) => url === '/api/mcp/servers/docs' && init?.method === 'PUT').at(-1)![1].body)).toEqual({ enabled: false });
    fireEvent.click(within(dialog).getByRole('button', { name: 'All tools' }));
    expect(within(dialog).getByRole('radio', { name: 'Off' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Remove Docs' })).toBeNull();
    unmount();
});

it('saves the terminal sandbox write paths from its row', async () => {
    const calls: Call[] = [];
    serve(policy(), calls);
    const { unmount } = open();
    const dialog = screen.getByRole('dialog', { name: 'Tools' });
    await within(dialog).findByText('Docs');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Terminal' }));
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

    // The suggestion opens on its own page.
    const dialog = await screen.findByRole('dialog', { name: /Tools › Add Files/ });
    expect(within(dialog).getByText('Suggested by the agent')).toBeTruthy();
    expect(within(dialog).getByText('Read project files')).toBeTruthy();
    const editor = within(dialog).getByLabelText('MCP server configuration (JSON)') as HTMLTextAreaElement;
    expect(JSON.parse(editor.value)).toEqual({ mcpServers: { Files: { command: 'npx', args: ['-y', '@scope/files', '/tmp/my dir'], env: { ROOT: '' } } } });
    const add = within(dialog).getByRole('button', { name: 'Add and connect' });
    await waitFor(() => expect(calls.some(([url]) => url === '/api/mcp')).toBe(true));
    expect(add).toBeDisabled();
    fireEvent.change(editor, { target: { value: editor.value.replace('"ROOT": ""', '"ROOT": "/data"') } });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Tools/ })).toBeNull());
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
    const dialog = await screen.findByRole('dialog', { name: /Tools › MCP server changes/ });
    expect(within(dialog).getByText('Files: turn off read')).toBeTruthy();
    expect(within(dialog).getByText('Tools approval: Ask every time → Auto when safe')).toBeTruthy();
    const apply = within(dialog).getByRole('button', { name: 'Apply changes' });
    await waitFor(() => expect(apply).toBeEnabled());
    expect(calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    fireEvent.click(apply);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Tools/ })).toBeNull());
    expect(JSON.parse(calls.find(([url]) => url === '/api/mcp/servers/files')![1].body)).toEqual({ tools: [{ name: 'read', enabled: false }] });
    expect(JSON.parse(calls.find(([url, init]) => url === POLICY && init?.method === 'PUT')![1].body)).toMatchObject({ mode: 'auto' });
    expect(store.getState().serverConfig.TOOLS_MODE).toBe('auto');
    expect(store.getState().textTurns.find(item => item.id === 'turn-mcp')!.answered).toBe(true);
    unmount();
});

it('sets a toolkit up on its page, adds it there, and changes its keys later', async () => {
    const calls: Call[] = [];
    const state = policy();
    const research = { id: 'research-arxiv', name: 'Research (arXiv)', transport: 'stdio', command: '/py', args: [], enabled: true, pack: 'research',
        auth: { type: 'none' }, tools: [], status: null, secrets: { header: false, env: [], client_secret: false, signed_in: false } };
    let added = false;
    let keySet = false;
    const pack = () => ({ id: 'research', name: 'Research', examples: [],
        description: 'Search arXiv papers with citation counts, follow new papers in a field, chart publication trends and read full texts.',
        settings: [{ key: 'email', label: 'Contact email (optional)' }, { key: 'openalex_key', label: 'OpenAlex API key (optional)', secret: true }],
        server_id: added ? 'research-arxiv' : null,
        ...(added ? { values: { email: { value: 'me@example.com' }, openalex_key: { set: keySet } } } : {}) });
    vi.mocked(apiRequest).mockImplementation(async (url: string, init?: any) => {
        calls.push([url, init]);
        if (url === POLICY) return { data: { ...state } } as any;
        if (url === '/api/mcp') return { data: { available: true, mode: 'ask', servers: added ? [research] : [] } } as any;
        if (url === '/api/mcp/packs') return { data: { packs: [pack()] } } as any;
        if (url === '/api/mcp/packs/research') { added = true; return { data: research } as any; }
        if (url === '/api/mcp/packs/research/tools') return { data: { tools: [{ name: 'search_papers', description: 'Search papers.', read_only: true }] } } as any;
        if (url === '/api/mcp/servers/research-arxiv' && init?.method === 'DELETE') { added = false;
            return { data: { available: true, mode: 'ask', servers: [] } } as any; }
        if (url === '/api/mcp/packs/research/settings') { keySet = !!JSON.parse(init.body).settings.openalex_key; return { data: pack() } as any; }
        if (url === '/api/mcp/servers/research-arxiv/connect') return { data: { status: 'connected', server: { ...research, status: 'connected',
            tools: [{ name: 'search_papers', enabled: true }] } } } as any;
        return { data: {} } as any;
    });
    const { unmount } = open();
    const dialog = screen.getByRole('dialog', { name: 'Tools' });
    // On the home page, under Add more: the card opens the toolkit's page.
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Research' }));
    expect(screen.getByRole('dialog', { name: /Tools › Research/ })).toBe(dialog);
    expect(within(dialog).getByText('Data Formulator toolkit · not added yet')).toBeTruthy();
    expect(within(dialog).getByText(/Search arXiv papers with citation counts/)).toBeTruthy();
    // Before adding, the tools it offers are listed, read from the toolkit.
    expect(await within(within(dialog).getByRole('region', { name: 'Tools' })).findByText('search_papers')).toBeTruthy();
    // Its setup: settings, then Add at the end.
    const account = within(dialog).getByRole('region', { name: 'Setup' });
    fireEvent.change(within(account).getByLabelText('Contact email (optional)'), { target: { value: 'me@example.com' } });
    // A key is typed hidden.
    expect(within(account).getByLabelText('OpenAlex API key (optional)')).toHaveAttribute('type', 'password');
    fireEvent.click(within(account).getByRole('button', { name: 'Add toolkit' }));

    // Added, the same page turns into the tool's: connected, with its tools, its switch, and Done.
    await within(dialog).findByLabelText('Use search_papers');
    expect(JSON.parse(calls.find(([url]) => url === '/api/mcp/packs/research')![1].body)).toEqual({ settings: { email: 'me@example.com' } });
    expect(within(dialog).getByText('Data Formulator toolkit')).toBeTruthy();
    expect(within(dialog).getByLabelText('Use Research (arXiv)')).toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Add toolkit' })).toBeNull();

    // Keys can be added, replaced or removed any time; only whether one is set is shown.
    await within(dialog).findByText('Not set');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add key' }));
    fireEvent.change(within(dialog).getByLabelText('OpenAlex API key (optional)'), { target: { value: 'k1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await within(dialog).findByText('Set');
    const saved = calls.find(([url]) => url === '/api/mcp/packs/research/settings')!;
    expect(saved[1].method).toBe('PUT');
    expect(JSON.parse(saved[1].body)).toEqual({ settings: { openalex_key: 'k1' } });

    // Removing it goes back home, where it is offered again under Add more.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Research (arXiv)' }));
    expect(await screen.findByRole('dialog', { name: 'Tools' })).toBe(dialog);
    expect(await within(dialog).findByRole('button', { name: 'Research' })).toBeTruthy();
    unmount();
});

it('signs in to a toolkit before it is added, adding it first', async () => {
    const calls: Call[] = [];
    const github = { id: 'github-public', name: 'GitHub (public)', transport: 'stdio', command: '/py', args: [], enabled: true, pack: 'github',
        auth: { type: 'none' }, tools: [], status: null, secrets: { header: false, env: [], client_secret: false, signed_in: false } };
    vi.mocked(apiRequest).mockImplementation(async (url: string, init?: any) => {
        calls.push([url, init]);
        if (url === POLICY) return { data: policy() } as any;
        if (url === '/api/mcp') return { data: { available: true, mode: 'ask', servers: [] } } as any;
        if (url === '/api/mcp/packs') return { data: { packs: [{ id: 'github', name: 'GitHub', description: 'Search public GitHub.', examples: [],
            settings: [], server_id: null, signin: { provider: 'github', signed_in: false, login: null, reusable_login: 'ada' } }] } } as any;
        if (url === '/api/mcp/packs/github') return { data: github } as any;
        if (url === '/api/mcp/packs/github/signin/reuse') return { data: { signed_in: true, login: 'ada', reusable_login: null } } as any;
        return { data: {} } as any;
    });
    const { unmount } = open();
    const dialog = screen.getByRole('dialog', { name: 'Tools' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'GitHub' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use @ada' }));
    await within(dialog).findByText(/Signed in to GitHub as @ada/);
    const order = calls.map(([url]) => url).filter(url => url.startsWith('/api/mcp/packs/github') && !url.endsWith('/tools'));
    expect(order).toEqual(['/api/mcp/packs/github', '/api/mcp/packs/github/signin/reuse']);
    unmount();
});

it('needs a toolkit\'s required settings to add it', async () => {
    vi.mocked(apiRequest).mockImplementation(async (url: string) => {
        if (url === POLICY) return { data: policy() } as any;
        if (url === '/api/mcp') return { data: { available: true, mode: 'ask', servers: [] } } as any;
        if (url === '/api/mcp/packs') return { data: { packs: [{ id: 'finance', name: 'Finance', description: 'Company financials.', examples: [],
            server_id: null, settings: [{ key: 'email', label: 'Contact email', required: true }] }] } } as any;
        return { data: {} } as any;
    });
    const { unmount } = open();
    const dialog = screen.getByRole('dialog', { name: 'Tools' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Finance' }));
    const add = within(dialog).getByRole('button', { name: 'Add toolkit' });
    expect(add).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Contact email/), { target: { value: 'me@example.com' } });
    expect(add).toBeEnabled();
    unmount();
});

it('signs a toolkit in to GitHub with a code, or with the GitHub account already signed in for models', async () => {
    const { PackSignIn } = await import('../../../../src/components/McpServers');
    const calls: Call[] = [];
    let polls = 0;
    vi.mocked(apiRequest).mockImplementation(async (target: string, init?: any) => {
        const url = String(target);
        calls.push([url, init]);
        if (url.endsWith('/signin/start')) return { data: { flow_id: 'flow', user_code: 'ABCD-1234', authorization_url: 'https://github.com/login/device', interval: 5 } } as any;
        if (url.endsWith('/signin/poll')) return { data: polls++ ? { flow: { status: 'connected' }, signed_in: true, login: 'ada', reusable_login: null }
            : { flow: { status: 'pending' }, signed_in: false, login: null } } as any;
        if (url.endsWith('/signin/reuse')) return { data: { signed_in: true, login: 'ada', reusable_login: null } } as any;
        return { data: {} } as any;
    });
    const pack = { id: 'github', name: 'GitHub', description: '', examples: [], settings: [], server_id: 'github-public',
        signin: { provider: 'github', signed_in: false, login: null, reusable_login: 'ada' } };
    const changed = vi.fn();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
        const view = render(<PackSignIn pack={pack} onChanged={changed} />);
        // Already signed in to GitHub for models: one click.
        fireEvent.click(screen.getByRole('button', { name: 'Use @ada' }));
        await waitFor(() => expect(changed).toHaveBeenCalledWith(expect.objectContaining({ signed_in: true, login: 'ada' })));
        expect(calls.at(-1)![0]).toBe('/api/mcp/packs/github/signin/reuse');
        // Or a code to enter on GitHub, polled until approved.
        fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
        expect(await screen.findByLabelText('Sign-in code')).toHaveTextContent('ABCD-1234');
        expect(screen.getByRole('link', { name: 'Copy code and open GitHub' })).toHaveAttribute('href', 'https://github.com/login/device');
        await act(async () => { vi.advanceTimersByTime(5000); });
        await act(async () => { vi.advanceTimersByTime(5000); });
        await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
        expect(screen.queryByLabelText('Sign-in code')).toBeNull();
        view.rerender(<PackSignIn pack={{ ...pack, signin: { provider: 'github', signed_in: true, login: 'ada', reusable_login: null } }} onChanged={changed} />);
        expect(screen.getByText(/Signed in to GitHub as @ada/)).toBeTruthy();
    } finally {
        vi.useRealTimers();
    }
});

it('signs in to Hugging Face with its own words, or takes a pasted token', async () => {
    const { PackSignIn } = await import('../../../../src/components/McpServers');
    const pack = { id: 'huggingface', name: 'Hugging Face datasets', description: '', examples: [], server_id: 'hf',
        settings: [{ key: 'hf_token', label: 'Hugging Face token', secret: true }],
        signin: { provider: 'huggingface', token_setting: 'hf_token', signed_in: false, login: null, reusable_login: 'grace' } };
    const view = render(<PackSignIn pack={pack} onChanged={vi.fn()} paste={<input aria-label="Hugging Face token" />} />);
    expect(screen.getByRole('button', { name: 'Sign in with Hugging Face' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use @grace' })).toBeTruthy();
    expect(screen.getByText(/open gated datasets you have accepted/)).toBeTruthy();
    expect(screen.queryByLabelText('Hugging Face token')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Or paste a token' }));
    expect(screen.getByLabelText('Hugging Face token')).toBeTruthy();
    view.rerender(<PackSignIn pack={{ ...pack, signin: { ...pack.signin, signed_in: true, login: 'grace', reusable_login: null } }}
        onChanged={vi.fn()} paste={<input aria-label="Hugging Face token" />} />);
    expect(screen.getByText(/Signed in to Hugging Face as @grace/)).toBeTruthy();
    expect(screen.queryByLabelText('Hugging Face token')).toBeNull();
});
