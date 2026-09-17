import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TerminalApprovalDialog, TerminalExecutionView, TerminalMessageContent } from '../../../../src/components/TerminalApprovalDialog';
import { migrateState } from '../../../../src/app/stateMigrations';

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
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('TerminalIcon')).toBeTruthy();
    expect(screen.queryByText('Working directory: /data')).toBeNull();
    rerender(<TerminalExecutionView execution={{ ...execution, status: 'completed', result: { exit_code: 0, stdout: 'sales.csv' } }} />);
    fireEvent.click(screen.getByRole('button', { name: /find.*Completed/ }));
    expect(screen.getByText('sales.csv')).toBeTruthy();
    expect(screen.getByText("find /data -name '*.csv'", { selector: 'pre' })).toBeTruthy();
    expect(screen.getByText('Exit code: 0')).toBeTruthy();
});

const proposal = { id: 'request-1', argv: ['find', '/data files', '-name', '*.csv'], cwd: '/data files',
    purpose: 'Find local CSV files', timeout_seconds: 60 };

it.each(['completed', 'failed', 'running', 'awaiting_approval', 'rejected', 'interrupted', 'unknown'] as const)(
    'shows only a terminal icon without a status badge in passive %s previews', status => {
        const onSelect = vi.fn();
        const { container } = render(<div onClick={onSelect}><TerminalExecutionView passive execution={{ ...proposal, status }} /></div>);
        expect(container.textContent).toBe('');
        expect(screen.queryByRole('button')).toBeNull();
        expect(container.querySelector('pre')).toBeNull();
        expect(screen.queryAllByRole('img')).toHaveLength(0);
        const indicator = container.querySelector('[data-terminal-indicator]')!;
        expect(indicator.contains(screen.getByTestId('TerminalIcon'))).toBe(true);
        expect(getComputedStyle(indicator).width).toBe('12px');
        expect(getComputedStyle(indicator).height).toBe('12px');
        expect(container.querySelectorAll('svg')).toHaveLength(1);
        fireEvent.click(screen.getByTestId('TerminalIcon'));
        expect(onSelect).toHaveBeenCalledOnce();
    },
);

it.each([
    ['completed', 'Completed', 'CheckIcon'],
    ['failed', 'Failed', 'ErrorOutlineIcon'],
    ['rejected', 'Rejected', 'BlockIcon'],
    ['interrupted', 'Interrupted', 'ErrorOutlineIcon'],
    ['awaiting_approval', 'Awaiting approval', 'ScheduleIcon'],
    ['running', 'Running', 'ScheduleIcon'],
] as const)('shows a longer command preview and an icon for %s', (status, label, icon) => {
    render(<TerminalExecutionView execution={{ ...proposal, argv: ['az', 'monitor', 'metrics', 'list', '--resource', 'x'.repeat(120)], status }} />);
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('az monitor metrics list --resource');
    expect(button.textContent?.trim()).toHaveLength(80);
    expect(button.textContent?.trim().endsWith('...')).toBe(true);
    expect(button.textContent).not.toContain(label);
    expect(screen.getByRole('img', { name: label }).querySelector(`[data-testid="${icon}"]`)).toBeTruthy();
    expect(button.getAttribute('aria-label')).toContain(label);
});

it('shows a command preview and completion icon without expanding details inline', () => {
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
    expect(screen.getByRole('img', { name: 'Completed' }).querySelector('[data-testid="CheckIcon"]')).toBeTruthy();
    expect(screen.queryByText('sales.csv')).toBeNull();
});

it('wraps expanded commands and output while preserving shell-safe copying and exact arguments', () => {
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
        expect(getComputedStyle(command).whiteSpace).toBe('pre-wrap');
        expect(getComputedStyle(command).overflowWrap).toBe('anywhere');
        expect(getComputedStyle(command).maxHeight).toBe('none');
        const outputBlock = Array.from(container.querySelectorAll('pre')).find(block => block.textContent === output);
        expect(outputBlock).toBeTruthy();
        expect(getComputedStyle(outputBlock!).whiteSpace).toBe('pre-wrap');
        expect(container.querySelector('details pre')?.textContent).toBe(JSON.stringify(argv, null, 2));
        fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
        expect(writeText).toHaveBeenCalledWith(command.textContent);
    } finally {
        vi.unstubAllGlobals();
    }
});

it('shows running command text and a terminal icon without a spinner, then a completion check', () => {
    const execution = { ...proposal, argv: ['bash', '-lc', `printf '%s' '${'x'.repeat(120)}'\nprintf done`], status: 'running' as const };
    const { container, rerender } = render(<TerminalExecutionView execution={execution} onOpen={vi.fn()} />);
    const row = screen.getByRole('button');
    expect(row.textContent).toContain('bash -lc');
    expect(row.textContent).toContain('...');
    expect(row.textContent).not.toContain('printf done');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('TerminalIcon')).toBeTruthy();
    expect(row.getAttribute('aria-label')).toContain('Running');
    rerender(<TerminalExecutionView execution={{ ...execution, status: 'completed' }} onOpen={vi.fn()} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('img', { name: 'Completed' })).toBeTruthy();
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