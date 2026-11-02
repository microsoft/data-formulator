import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { McpApprovalDialog, mcpCallRecord, proposalConfig, type McpProposal } from '../../../../src/components/McpServers';

const proposal: McpProposal = {
    id: 'request-1', server_id: 'weather', server_name: 'Weather', tool: 'forecast', title: 'Forecast',
    description: 'Daily forecast for a city', annotations: { readOnly: true },
    arguments: { city: 'Lagos', days: 3 }, purpose: 'Get the forecast for Lagos',
};

it.each([['Reject', 'reject'], ['Always allow this tool', 'always'], ['Run once', 'approve']] as const)(
    'shows the call and answers %s once', (label, decision) => {
        const onDecision = vi.fn();
        render(<McpApprovalDialog proposal={proposal} onDecision={onDecision} />);
        const dialog = screen.getByRole('dialog', { name: 'Allow Forecast from Weather?' });
        expect(screen.getByText('Get the forecast for Lagos')).toBeInTheDocument();
        expect(dialog.textContent).toContain('"city": "Lagos"');
        expect(dialog).toHaveTextContent('Read-only');
        fireEvent.click(screen.getByRole('button', { name: label }));
        fireEvent.click(screen.getByRole('button', { name: label }));
        expect(onDecision).toHaveBeenCalledTimes(1);
        expect(onDecision).toHaveBeenCalledWith(decision);
    });

it('turns agent proposals into configuration JSON with empty secret slots', () => {
    expect(JSON.parse(proposalConfig({ name: 'Files', transport: 'stdio', command: 'npx', args: ['-y', 'files'], envNames: ['ROOT'] })))
        .toEqual({ mcpServers: { Files: { command: 'npx', args: ['-y', 'files'], env: { ROOT: '' } } } });
    expect(JSON.parse(proposalConfig({ name: 'Keyed', transport: 'sse', url: 'https://x.example/sse', auth: { type: 'header', header: 'X-Api-Key' } })))
        .toEqual({ mcpServers: { Keyed: { type: 'sse', url: 'https://x.example/sse', headers: { 'X-Api-Key': '' } } } });
    expect(JSON.parse(proposalConfig({ name: 'GitHub', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', auth: { type: 'oauth' } })))
        .toEqual({ mcpServers: { GitHub: { url: 'https://api.githubcopilot.com/mcp/' } } });
});

it('records approval-paused calls for the work log', () => {
    const record = mcpCallRecord(proposal, 'awaiting_approval');
    expect(record.tool).toBe('mcp_call');
    expect(record.status).toBe('awaiting_approval');
    expect(record.args).toMatchObject({ server: 'Weather', tool: 'forecast' });
});

it('explains how to add a server with examples', async () => {
    const { AddServerForm } = await import('../../../../src/components/McpServers');
    const onSubmit = vi.fn(async () => true);
    render(<AddServerForm busy={false} onSubmit={onSubmit} />);
    const toggle = screen.getByRole('button', { name: 'How to add a server' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByText(/Paste one server’s MCP configuration/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Remote server' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'With an API key' }));
    expect(screen.getByText(/Replace YOUR_KEY/)).toBeInTheDocument();
    expect(screen.getByText(/"Bearer YOUR_KEY"/)).toBeInTheDocument();
    // A pasted placeholder key still has to be replaced before adding.
    const editor = screen.getByLabelText('MCP server configuration (JSON)');
    fireEvent.change(editor, { target: { value: JSON.stringify({ mcpServers: { w: { url: 'https://w.example/mcp', headers: { Authorization: 'Bearer YOUR_KEY' } } } }) } });
    expect(screen.getByText('Fill in Authorization.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add and connect' })).toBeDisabled();
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'How to add a server' })).toBeNull());
});

it('adds one server at a time', async () => {
    const { AddServerForm } = await import('../../../../src/components/McpServers');
    const onCancel = vi.fn();
    render(<AddServerForm busy={false} onSubmit={vi.fn(async () => true)} onCancel={onCancel} />);
    const editor = screen.getByLabelText('MCP server configuration (JSON)');
    fireEvent.change(editor, { target: { value: JSON.stringify({ mcpServers: { a: { url: 'https://a.example/mcp' }, b: { url: 'https://b.example/mcp' } } }) } });
    expect(screen.getByText('Add one server at a time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add and connect' })).toBeDisabled();
    fireEvent.change(editor, { target: { value: JSON.stringify({ mcpServers: { a: { url: 'https://a.example/mcp' } } }) } });
    expect(screen.getByRole('button', { name: 'Add and connect' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
});
