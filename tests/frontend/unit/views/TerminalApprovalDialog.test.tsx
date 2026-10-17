import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { store } from '../../../../src/app/store';
import { dfActions } from '../../../../src/app/dfSlice';
import { setCachedChart, invalidateChart } from '../../../../src/app/chartCache';
import { beforeEach, expect, it, vi } from 'vitest';
import { ExecutionCodeBlock, TerminalAccessButton, TerminalApprovalDialog, TerminalExecutionView, TerminalMessageContent } from '../../../../src/components/TerminalApprovalDialog';
import { apiRequest } from '../../../../src/app/apiClient';
import { migrateState } from '../../../../src/app/stateMigrations';

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: vi.fn() }));
beforeEach(() => vi.mocked(apiRequest).mockReset());

it.each(['off', 'ask', 'auto'] as const)('saves terminal mode %s in place without Administration access', async mode => {
    store.dispatch(dfActions.resetState());
    const initial = mode === 'off' ? 'ask' : 'off';
    store.dispatch(dfActions.setServerConfig({ ...store.getState().serverConfig, TERMINAL_MODE: initial,
        TERMINAL_AVAILABLE: true, IS_LOCAL_MODE: true, DISABLE_DATA_CONNECTORS: false, CAN_CONFIGURE: false }));
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { mode: initial, available: true, locked: false, revision: 2 } })
        .mockResolvedValueOnce({ data: { mode, available: true, locked: false, revision: 3 } });
    const { unmount } = render(<Provider store={store}><TerminalAccessButton /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: `Terminal: ${initial === 'off' ? 'Off' : 'Ask'}` }));
    const choice = screen.getByRole('radio', { name: { off: 'Off', ask: 'Ask every time', auto: 'Auto approve' }[mode] });
    await waitFor(() => expect(choice).toBeEnabled());
    expect(screen.getByRole('list').tagName).toBe('OL');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Terminal access lets the agent read local files');
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('expanding its ability to find, acquire, and analyze data');
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('By default, commands run in a sandbox that limits local writes but does not restrict file reads, network access, or remote changes.');
    fireEvent.click(choice);
    expect(store.getState().serverConfig.TERMINAL_MODE).toBe(initial);
    if (mode === 'auto') {
        const warning = screen.getByRole('alert');
        expect(warning).toHaveClass('MuiAlert-colorError');
        expect(warning).toHaveTextContent('With Auto approve, the agent can run sandboxed commands without asking');
        expect(warning).toHaveTextContent('use existing CLI credentials to change remote resources');
        expect(warning).toHaveTextContent('Running commands outside the sandbox still requires your approval and a reason.');
    } else if (mode === 'ask') {
        const notice = screen.getByRole('alert');
        expect(notice).toHaveClass('MuiAlert-colorInfo');
        expect(notice).toHaveTextContent('the agent must get your approval before running any terminal command, including commands inside the sandbox');
        expect(notice).not.toHaveTextContent('outside the sandbox');
    } else {
        expect(screen.queryByRole('alert')).toBeNull();
    }
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.getState().serverConfig.TERMINAL_MODE).toBe(mode));
    expect(apiRequest).toHaveBeenLastCalledWith('/api/configurations/terminal', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-DF-Configuration': '1' },
        body: JSON.stringify({ revision: 2, mode }),
    });
    unmount();
    store.dispatch(dfActions.resetState());
});

it.each(['deployment', 'environment'])('keeps controls disabled for a %s restriction', async restriction => {
    store.dispatch(dfActions.resetState());
    store.dispatch(dfActions.setServerConfig({ ...store.getState().serverConfig, TERMINAL_MODE: 'off',
        TERMINAL_AVAILABLE: false, IS_LOCAL_MODE: true, DISABLE_DATA_CONNECTORS: true, CAN_CONFIGURE: true }));
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { mode: 'off', available: restriction !== 'deployment',
        locked: restriction === 'environment', revision: 0 } });
    const { unmount } = render(<Provider store={store}><TerminalAccessButton /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Terminal: Off' }));
    await screen.findByText(restriction === 'deployment' ? /deployment policy disables/ : /DF_TERMINAL_MODE/);
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(store.getState().serverConfig.TERMINAL_MODE).toBe('off');
    unmount();
    store.dispatch(dfActions.resetState());
});

it('discards an unsaved terminal choice on Close', async () => {
    store.dispatch(dfActions.resetState());
    store.dispatch(dfActions.setServerConfig({ ...store.getState().serverConfig, TERMINAL_MODE: 'off' }));
    vi.mocked(apiRequest).mockResolvedValue({ data: { mode: 'off', available: true, locked: false, revision: 1 } });
    const { unmount } = render(<Provider store={store}><TerminalAccessButton /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Terminal: Off' }));
    const choice = screen.getByRole('radio', { name: 'Auto approve' });
    await waitFor(() => expect(choice).toBeEnabled());
    fireEvent.click(choice);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(store.getState().serverConfig.TERMINAL_MODE).toBe('off');
    unmount();
    store.dispatch(dfActions.resetState());
});

it.each(['load', 'save'])('keeps the actual policy unchanged after a failed %s', async failure => {
    store.dispatch(dfActions.resetState());
    store.dispatch(dfActions.setServerConfig({ ...store.getState().serverConfig, TERMINAL_MODE: 'off' }));
    if (failure === 'save') vi.mocked(apiRequest).mockResolvedValueOnce({ data: { mode: 'off', available: true, locked: false, revision: 1 } });
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Configuration changed. Reload before saving.'));
    const { unmount } = render(<Provider store={store}><TerminalAccessButton /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Terminal: Off' }));
    if (failure === 'save') {
        const choice = screen.getByRole('radio', { name: 'Auto approve' });
        await waitFor(() => expect(choice).toBeEnabled());
        fireEvent.click(choice);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    }
    await screen.findByText('Configuration changed. Reload before saving.');
    expect(store.getState().serverConfig.TERMINAL_MODE).toBe('off');
    expect(screen.getByRole('dialog', { name: 'Terminal access' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled();
    unmount();
    store.dispatch(dfActions.resetState());
});

it.each(['paths', 'empty', 'defaults', 'close'] as const)('edits sandbox write policy: %s', async action => {
    store.dispatch(dfActions.resetState());
    store.dispatch(dfActions.setServerConfig({ ...store.getState().serverConfig, TERMINAL_MODE: 'ask' }));
    const policy = { mode: 'ask', available: true, locked: false, revision: 2,
        sandboxFilesystem: { configured: action === 'defaults', requested: ['~/.azure', '/missing/cli-state'],
            allowWrite: ['/home/example/.azure'], skipped: ['/missing/cli-state'] } };
    vi.mocked(apiRequest).mockResolvedValue({ data: policy });
    const { unmount } = render(<Provider store={store}><TerminalAccessButton /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Terminal: Ask' }));
    const policyButton = screen.getByRole('button', { name: 'Sandbox policy' });
    await waitFor(() => expect(policyButton).toBeEnabled());
    expect(policyButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('dialog')).toHaveClass('MuiDialog-paperWidthXs');
    fireEvent.click(policyButton);
    expect(screen.getByRole('region', { name: 'Sandbox policy' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveClass('MuiDialog-paperWidthMd'));
    expect(screen.getByRole('heading', { name: 'Read' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Write' })).toBeVisible();
    expect(screen.getByText(/Allowed: create, modify, or delete files/)).toBeVisible();
    expect(screen.getByText(/Blocked: writes to other local paths/)).toBeVisible();
    expect(screen.getByText(/Not blocked by the sandbox: changes to cloud services/)).toBeVisible();
    expect(screen.getByText(/Command output is shared with your AI model provider/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    const defaults = screen.getByRole('checkbox', { name: 'Use default CLI state paths' });
    if (action === 'defaults') {
        fireEvent.click(defaults);
        expect(screen.queryByRole('textbox')).toBeNull();
    } else {
        fireEvent.click(defaults);
        const input = screen.getByRole('textbox', { name: 'Writable paths (one per line)' });
        expect(input).toHaveValue('~/.azure\n/missing/cli-state');
        fireEvent.change(input, { target: { value: action === 'empty' ? '' : '~/.azure\n/missing/cli-state\n/tmp/custom-cli\n' } });
    }
    fireEvent.click(policyButton);
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveClass('MuiDialog-paperWidthXs'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: action === 'close' ? 'Close' : 'Save' }));
    if (action === 'close') {
        expect(apiRequest).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Terminal: Ask' }));
        const reopened = screen.getByRole('button', { name: 'Sandbox policy' });
        await waitFor(() => expect(reopened).toBeEnabled());
        expect(reopened).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(reopened);
        expect(screen.getByRole('checkbox', { name: 'Use default CLI state paths' })).toBeChecked();
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    } else {
        await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
        expect(JSON.parse(vi.mocked(apiRequest).mock.calls[1][1]!.body as string)).toEqual({ revision: 2, mode: 'ask',
            sandbox: action === 'defaults' ? null : { filesystem: { allowWrite: action === 'empty' ? []
                : ['~/.azure', '/missing/cli-state', '/tmp/custom-cli'] } } });
    }
    unmount();
    store.dispatch(dfActions.resetState());
});

it('disables the header policy button when Off is selected and closes the open panel', async () => {
    store.dispatch(dfActions.resetState());
    store.dispatch(dfActions.setServerConfig({ ...store.getState().serverConfig, TERMINAL_MODE: 'off' }));
    vi.mocked(apiRequest).mockResolvedValue({ data: { mode: 'off', available: true, locked: false, revision: 1,
        sandboxFilesystem: { configured: false, requested: ['~/.azure'], allowWrite: [], skipped: [] } } });
    const { unmount } = render(<Provider store={store}><TerminalAccessButton /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Terminal: Off' }));
    const ask = screen.getByRole('radio', { name: 'Ask every time' });
    await waitFor(() => expect(ask).toBeEnabled());
    const policyButton = screen.getByRole('button', { name: 'Sandbox policy' });
    expect(policyButton.closest('.MuiDialogTitle-root')).not.toBeNull();
    expect(policyButton).toBeDisabled();
    fireEvent.click(policyButton);
    expect(screen.queryByRole('region', { name: 'Sandbox policy' })).toBeNull();
    fireEvent.click(ask);
    fireEvent.click(policyButton);
    expect(screen.getByRole('region', { name: 'Sandbox policy' })).toBeVisible();
    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
    expect(policyButton).toBeDisabled();
    expect(policyButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Sandbox policy' })).toBeNull();
    expect(screen.getByRole('dialog')).toHaveClass('MuiDialog-paperWidthXs');
    fireEvent.click(screen.getByRole('radio', { name: 'Auto approve' }));
    expect(policyButton).toBeEnabled();
    expect(policyButton).toHaveAttribute('aria-expanded', 'false');
    expect(apiRequest).toHaveBeenCalledTimes(1);
    unmount();
    store.dispatch(dfActions.resetState());
});

it.each(['compact', 'document'] as const)('resolves delayed chart images in %s Markdown without allowing unsafe URLs', variant => {
    const chartId = `markdown-comparison-${variant}`;
    const image = 'data:image/png;base64,cG5n';
    store.dispatch(dfActions.resetState());
    const { container } = render(<Provider store={store}><TerminalMessageContent variant={variant === 'document' ? variant : undefined}
        content={`## Two-period comparison\n\n![Price changes by item and period](chart://${chartId})\n\n![Unsafe](javascript:alert%281%29)\n\n[Unsafe link](javascript:alert%281%29)`} /></Provider>);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Price changes by item and period' })).toBeTruthy();
    try {
        setCachedChart(chartId, { svg: '', fullPngDataUrl: image, thumbnailDataUrl: image,
            naturalWidth: 400, naturalHeight: 300, specKey: 'comparison' });
        act(() => { store.dispatch(dfActions.updateChartThumbnail({ chartId, thumbnail: image })); });
        expect(container.querySelector(`img[data-chart-id="${chartId}"]`)).toHaveAttribute('src', image);
        expect(container.querySelectorAll('img')).toHaveLength(1);
        expect(screen.getByText('Unsafe link').getAttribute('href')).not.toContain('javascript:');
    } finally {
        invalidateChart(chartId);
    }
});

it('displays migrated commands without inventing exact arguments or success', () => {
    const content = 'Inspect usage.\n\n**Command**\n\n```bash\naz account show\n```\n\n**Working directory:** `/workspace`\n\n**Result**\n\n```text\n{"subscription":"example"}\n```';
    const migrated = migrateState({ __stateVersion: 6, textTurns: [{ id: 'legacy', content }] }).textTurns[0];
    const { container } = render(<TerminalMessageContent content={migrated.content} executions={migrated.executions} />);
    expect(screen.getByText('Inspect usage.')).toBeTruthy();
    expect(container.querySelector('pre')).toBeNull();
    expect(screen.queryByRole('img', { name: 'Completed' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /az account show Status unavailable/ }));
    expect(container.querySelector('pre')?.textContent).toBe('az account show');
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).toContain('"subscription": "example"');
});

it('keeps execution details collapsed and updates status without adding a second row', () => {
    const execution = { id: 'execution', argv: ['find', '/data', '-name', '*.csv'], cwd: '/data', purpose: 'Find data', status: 'running' as const };
    const { rerender } = render(<TerminalExecutionView execution={execution} />);
    expect(screen.getByRole('button', { name: /find.*Running/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Working directory: /data')).toBeNull();
    rerender(<TerminalExecutionView execution={{ ...execution, status: 'completed', result: { exit_code: 0, stdout: 'sales.csv' } }} />);
    fireEvent.click(screen.getByRole('button', { name: /find.*Completed/ }));
    expect(screen.getByText('sales.csv')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Command' }).querySelector('code')?.textContent).toBe("find /data -name '*.csv'");
    expect(screen.getByText('Exit code: 0')).toBeTruthy();
});

const proposal = { id: 'request-1', argv: ['find', '/data files', '-name', '*.csv'], cwd: '/data files',
    purpose: 'Find local CSV files', timeout_seconds: 60 };

it('lets the parent handle selection of a passive execution preview', () => {
        const onSelect = vi.fn();
        const { container } = render(<div onClick={onSelect}><TerminalExecutionView passive execution={{ ...proposal, status: 'completed' }} /></div>);
        expect(screen.queryByRole('button')).toBeNull();
        expect(container.querySelector('pre')).toBeNull();
        const indicator = container.querySelector('[data-terminal-indicator]')!;
        fireEvent.click(indicator);
        expect(onSelect).toHaveBeenCalledOnce();
});

it.each([
    ['completed', 'Completed'],
    ['failed', 'Failed'],
    ['rejected', 'Rejected'],
    ['interrupted', 'Interrupted'],
    ['awaiting_approval', 'Awaiting approval'],
    ['running', 'Running'],
] as const)('exposes the execution status and full command when expanded: %s', (status, label) => {
    render(<TerminalExecutionView execution={{ ...proposal, argv: ['az', 'monitor', 'metrics', 'list', '--resource', 'x'.repeat(120)], status }} />);
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('az monitor metrics list --resource');
    expect(button.getAttribute('aria-label')).toContain(label);
    fireEvent.click(button);
    const code = screen.getByRole('group', { name: 'Command' }).querySelector('code');
    expect(code).toBeVisible();
    expect(code?.textContent).toBe(`az monitor metrics list --resource ${'x'.repeat(120)}`);
});

it.each(['python', 'bash'] as const)('highlights %s without changing copied code or interpreting markup', async language => {
    const code = language === 'python' ? 'import os\nprint("<img src=x onerror=alert(1)>")'
        : 'printf "%s\\n" "<img src=x onerror=alert(1)>"';
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
        const { container } = render(<ExecutionCodeBlock code={code} language={language} label="Code"
            copyLabel="Copy code" result={{ output: '<img src=x onerror=alert(1)>' }} />);
        const highlighted = container.querySelector(`code.language-${language}`)!;
        expect(highlighted.textContent).toBe(code);
        expect(highlighted.querySelector('.token')).not.toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelectorAll('pre')[1].querySelector('.token')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
    } finally {
        if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
        else Reflect.deleteProperty(navigator, 'clipboard');
    }
});

it('opens the external execution view instead of expanding details inline', () => {
    const onOpen = vi.fn();
    const { container } = render(<TerminalExecutionView onOpen={onOpen} defaultExpanded execution={{
        ...proposal, status: 'completed', result: { output: 'sales.csv', exit_code: 0 },
    }} />);
    const row = screen.getByRole('button', { name: /find.*Completed/ });
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(row.hasAttribute('aria-expanded')).toBe(false);
    expect(container.querySelector('pre')).toBeNull();
    expect(container.textContent).toContain("find '/data files' -name '*.csv'");
    expect(screen.queryByText('sales.csv')).toBeNull();
});

it('preserves full output, exact arguments, and shell-safe command copying', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
        const query = `[?kind=='OpenAI'].{name:name,resourceGroup:resourceGroup}`;
        const argv = ['az', 'cognitiveservices', 'account', 'list', '--query', query];
        const output = JSON.stringify([{ id: '/subscriptions/' + 'resource/'.repeat(40) }], null, 2);
        const { container } = render(<TerminalExecutionView execution={{ ...proposal, argv, status: 'completed', result: { output } }} />);
        expect(container.querySelector('pre')).toBeNull();
        fireEvent.click(screen.getByRole('button'));
        const command = container.querySelector('pre')!;
        expect(command.textContent).toBe(`az cognitiveservices account list --query "${query}"`);
        const outputBlock = Array.from(container.querySelectorAll('pre')).find(block => block.textContent === output);
        expect(outputBlock).toBeTruthy();
        expect(JSON.parse(container.querySelector('details pre')!.textContent!)).toEqual(argv);
        fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
        expect(writeText).toHaveBeenCalledWith(command.textContent);
    } finally {
        vi.unstubAllGlobals();
    }
});

it('updates an external command preview from running to completed without opening it', () => {
    const execution = { ...proposal, argv: ['bash', '-lc', `printf '%s' '${'x'.repeat(120)}'\nprintf done`], status: 'running' as const };
    const { container, rerender } = render(<TerminalExecutionView execution={execution} onOpen={vi.fn()} />);
    const row = screen.getByRole('button');
    expect(row.textContent).toContain('bash -lc');
    expect(row.getAttribute('aria-label')).toContain('Running');
    rerender(<TerminalExecutionView execution={{ ...execution, status: 'completed' }} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: /bash.*Completed/ })).toBeEnabled();
    expect(container.querySelector('pre')).toBeNull();
});

it('shows exact arguments and host access warning without granting permission on render', () => {
    const onDecision = vi.fn();
    render(<TerminalApprovalDialog proposal={proposal} onDecision={onDecision} />);
    expect(screen.getByRole('dialog').textContent).toContain(JSON.stringify(proposal.argv, null, 2));
    expect(screen.getByText(/Filesystem writes are restricted/)).toBeTruthy();
    expect(screen.getByText(/Reads and network access are not/)).toBeVisible();
    expect(screen.getByText(/send data to remote services, and use existing CLI credentials/)).toBeVisible();
    expect(screen.getByText(/Command output is sent to your model provider/)).toBeVisible();
    expect(screen.getByText(proposal.cwd)).toBeTruthy();
    expect(onDecision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run once' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run once' }));
    expect(onDecision).toHaveBeenCalledExactlyOnceWith('approve');
});

it('shows the bypass reason and full host risk without implicitly approving', () => {
    const onDecision = vi.fn();
    render(<TerminalApprovalDialog proposal={{ ...proposal, dangerouslyDisableSandbox: true,
        sandboxDisablingReason: 'Client needs writes outside the configured policy.' }} onDecision={onDecision} />);
    expect(screen.getByRole('dialog', { name: 'Run outside the sandbox?' })).toBeVisible();
    expect(screen.getByText('Client needs writes outside the configured policy.')).toBeVisible();
    expect(screen.getByText(/normal OS-user access/)).toBeVisible();
    expect(screen.getByText(/Auto mode never approves this request/)).toBeVisible();
    expect(screen.getByText(/previous attempt may have partially completed/)).toBeVisible();
    expect(onDecision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run outside sandbox' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run outside sandbox' }));
    expect(onDecision).toHaveBeenCalledExactlyOnceWith('approve');
});

it('retains the write grant scope in execution history', () => {
    render(<TerminalExecutionView defaultExpanded execution={{ ...proposal, status: 'completed',
        writePaths: ['/Users/example/client-state'], result: { exit_code: 0 } }} />);
    expect(screen.getByText('Additional write paths (this command only)')).toBeVisible();
    expect(screen.getByText('/Users/example/client-state')).toBeVisible();
});

it('retains the bypass reason in execution history', () => {
    render(<TerminalExecutionView defaultExpanded execution={{ ...proposal, status: 'completed',
        dangerouslyDisableSandbox: true, sandboxDisablingReason: 'Client needs host state', result: { exit_code: 0 } }} />);
    expect(screen.getByText('Outside sandbox: Client needs host state')).toBeVisible();
});

it('shows the resolved sandbox paths without requesting new grants', () => {
    render(<TerminalApprovalDialog proposal={{ ...proposal, sandboxFilesystem: { allowWrite: ['/home/example/.azure'],
        configured: false, requested: ['~/.azure'], skipped: [] } }} onDecision={vi.fn()} />);
    fireEvent.click(screen.getByText('Sandbox policy'));
    expect(screen.getByText('/home/example/.azure')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run once' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Run outside sandbox' })).toBeNull();
});

it('uses consistent label typography throughout expanded execution details', () => {
    render(<TerminalExecutionView detailsOnly execution={{ ...proposal, status: 'completed',
        sandboxFilesystem: { allowWrite: [], configured: false, requested: [], skipped: [] },
        result: { exit_code: 0, output: 'Done' } }} />);
    const commandStyle = getComputedStyle(screen.getByText('Command'));
    for (const element of [screen.getByText(/Working directory:/), screen.getByText('Output'), screen.getByText('Exit code: 0'),
        screen.getByText('Sandbox policy').closest('details')!,
        screen.getByText('Executable and exact arguments').closest('details')!]) {
        expect(getComputedStyle(element).fontSize).toBe(commandStyle.fontSize);
        expect(getComputedStyle(element).fontFamily).toBe(commandStyle.fontFamily);
        expect(getComputedStyle(element).lineHeight).toBe(commandStyle.lineHeight);
    }
    expect(screen.getByText('Sandbox policy')).toHaveStyle({ fontWeight: 400 });
});

it.each([false, true])('rejects without executing and treats escape as rejection (bypass: %s)', dangerouslyDisableSandbox => {
    const onDecision = vi.fn();
    const view = render(<TerminalApprovalDialog proposal={{ ...proposal, dangerouslyDisableSandbox }} onDecision={onDecision} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onDecision).toHaveBeenCalledExactlyOnceWith('reject');
    view.unmount();
    onDecision.mockClear();
    render(<TerminalApprovalDialog proposal={{ ...proposal, dangerouslyDisableSandbox }} onDecision={onDecision} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(onDecision).toHaveBeenCalledExactlyOnceWith('reject');
});