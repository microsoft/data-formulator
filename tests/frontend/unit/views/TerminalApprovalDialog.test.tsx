import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { store } from '../../../../src/app/store';
import { dfActions } from '../../../../src/app/dfSlice';
import { setCachedChart, invalidateChart } from '../../../../src/app/chartCache';
import { expect, it, vi } from 'vitest';
import { TerminalApprovalDialog, TerminalExecutionView, TerminalMessageContent } from '../../../../src/components/TerminalApprovalDialog';
import { migrateState } from '../../../../src/app/stateMigrations';

it.each(['compact', 'document'] as const)('resolves delayed chart images in %s Markdown without allowing unsafe URLs', variant => {
    const chartId = `markdown-comparison-${variant}`;
    const image = 'data:image/png;base64,cG5n';
    store.dispatch(dfActions.resetState());
    const { container } = render(<Provider store={store}><TerminalMessageContent variant={variant}
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
    expect(screen.getByText("find /data -name '*.csv'", { selector: 'pre' })).toBeTruthy();
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
    expect(screen.getByText(`az monitor metrics list --resource ${'x'.repeat(120)}`, { selector: 'pre' })).toBeVisible();
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
    expect(screen.getByText(proposal.cwd)).toBeTruthy();
    expect(onDecision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run once' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run once' }));
    expect(onDecision).toHaveBeenCalledExactlyOnceWith('approve');
});

it('rejects without executing and treats escape as rejection', () => {
    const onDecision = vi.fn();
    const view = render(<TerminalApprovalDialog proposal={proposal} onDecision={onDecision} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onDecision).toHaveBeenCalledExactlyOnceWith('reject');
    view.unmount();
    onDecision.mockClear();
    render(<TerminalApprovalDialog proposal={proposal} onDecision={onDecision} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(onDecision).toHaveBeenCalledExactlyOnceWith('reject');
});