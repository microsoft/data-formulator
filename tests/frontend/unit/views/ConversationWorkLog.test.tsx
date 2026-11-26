import React from 'react';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConversationWorkLog } from '../../../../src/views/ConversationWorkLog';

describe('ConversationWorkLog', () => {
    it('shows thoughts as text and each call as its own box that opens its code and output', () => {
        render(<ConversationWorkLog turn={{ kind: 'text', id: 'step', displayId: 'step', textKind: 'explain', content: 'Done.',
            parentNodeId: 'root', createdAt: 1,
            progressSteps: [
                { id: 'thought', kind: 'thought', label: 'I will show January to August 2025.', status: 'completed' },
                { id: 'tool', kind: 'tool', label: 'running code', status: 'completed', executionId: 'call' }],
            toolCalls: [{ id: 'call', tool: 'execute_python_script', args: { purpose: 'Find the latest year', code: 'print(2025)' },
                output: '2025', status: 'completed' }] } as any} />);
        // The thought shows once, as text; the call is one box with one header line.
        expect(screen.getAllByText('I will show January to August 2025.')).toHaveLength(1);
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(document.querySelector('pre')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Find the latest year/ }));
        expect(document.querySelector('pre')).toHaveTextContent('print(2025)');
        // Opened, the description is not repeated inside.
        expect(screen.getAllByText('Find the latest year')).toHaveLength(1);
    });

    it('renders nothing for a message without work', () => {
        const { container } = render(<ConversationWorkLog turn={{ kind: 'text', id: 'plain', displayId: 'plain', textKind: 'explain',
            content: 'Hi', parentNodeId: 'root', createdAt: 1 } as any} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('keeps reads, searches and failed attempts, but not chart progress lines', () => {
        render(<ConversationWorkLog turn={{ kind: 'text', id: 'step', displayId: 'step', textKind: 'explain', content: 'Done.',
            parentNodeId: 'root', createdAt: 1,
            progressSteps: [
                { id: 'read', kind: 'tool', tool: 'read_file', label: 'Reading: session/tables/countries.json', status: 'completed' },
                { id: 'search', kind: 'tool', tool: 'search', label: 'Searching the session “completion”', status: 'failed' },
                { id: 'search-error', kind: 'warning', label: 'Unknown path session/tables/x.json', status: 'completed' },
                { id: 'chart', kind: 'chart', label: 'creating chart...', status: 'failed' },
                { id: 'rejected', kind: 'warning', label: 'attempt failed: Unknown input d_result_5', status: 'failed' },
                { id: 'skill', kind: 'tool', tool: 'load_skill', label: 'loading skill: report...', status: 'completed' }],
        } as any} />);
        expect(screen.getByText('Reading: session/tables/countries.json')).toBeInTheDocument();
        expect(screen.getByText('Attempt failed: Unknown input d_result_5')).toBeInTheDocument();
        expect(screen.getByText('Loading skill: report')).toBeInTheDocument();
        expect(screen.queryByText(/creating chart/i)).toBeNull();
        // The failed search keeps its error on its own line, opened on demand.
        expect(screen.queryByText('Unknown path session/tables/x.json')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Searching the session/ }));
        expect(screen.getByText('Unknown path session/tables/x.json')).toBeInTheDocument();
    });

    it('leaves a failed code call to show its own error', () => {
        render(<ConversationWorkLog turn={{ kind: 'text', id: 'step', displayId: 'step', textKind: 'explain', content: 'Done.',
            parentNodeId: 'root', createdAt: 1,
            progressSteps: [
                { id: 'tool', kind: 'tool', label: 'running code', status: 'failed', executionId: 'call' },
                { id: 'error', kind: 'warning', label: 'KeyError: year', status: 'completed' }],
            toolCalls: [{ id: 'call', tool: 'execute_python_script', args: { purpose: 'Find the latest year', code: 'x["year"]' },
                error: 'KeyError: year', status: 'failed' }] } as any} />);
        expect(screen.queryByText('KeyError: year')).toBeNull();
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('opens a read with the paths it read, each opening its item, and the capped content that came back', () => {
        const opened: string[] = [];
        render(<ConversationWorkLog onOpenPath={path => path === 'session/tables/countries.json' ? () => opened.push(path) : undefined}
            turn={{ kind: 'text', id: 'step', displayId: 'step', textKind: 'explain', content: 'Done.', parentNodeId: 'root', createdAt: 1,
                progressSteps: [{ id: 'read', kind: 'tool', tool: 'read_file', toolCallId: 'r1', label: 'Reading: countries', status: 'completed' }],
                toolCalls: [{ id: 'r1', tool: 'read_file', status: 'completed', output: '{"name": "countries"}',
                    args: { files: [{ path: 'session/tables/countries.json' }, { path: 'session/tables/gone.json' }] },
                    truncated: { output: 25_000 } }] } as any} />);
        fireEvent.click(screen.getByRole('button', { name: /Reading: session\/tables\/countries.json, session\/tables\/gone.json/ }));
        expect(screen.getByText('{"name": "countries"}')).toBeInTheDocument();
        expect(screen.getByText(/25,000 characters/)).toBeInTheDocument();
        // A path that still exists opens its item; one that is gone stays text.
        fireEvent.click(screen.getByRole('button', { name: 'session/tables/countries.json' }));
        expect(opened).toEqual(['session/tables/countries.json']);
        expect(screen.queryByRole('button', { name: 'session/tables/gone.json' })).toBeNull();
        expect(screen.getByText('session/tables/gone.json')).toBeInTheDocument();
    });

    it('shows a search by its query and an edit by its changes', () => {
        render(<ConversationWorkLog turn={{ kind: 'text', id: 'step', displayId: 'step', textKind: 'explain', content: 'Done.',
            parentNodeId: 'root', createdAt: 1,
            progressSteps: [
                { id: 'search', kind: 'tool', tool: 'search', toolCallId: 's1', label: 'Searching', status: 'completed' },
                { id: 'edit', kind: 'tool', tool: 'edit_file', toolCallId: 'e1', label: 'Editing', status: 'completed' }],
            toolCalls: [
                { id: 's1', tool: 'search', status: 'completed', args: { query: 'completion rural', path: ['session/tables/'] }, output: '1 item match' },
                { id: 'e1', tool: 'edit_file', status: 'completed', output: 'Edited',
                    args: { path: 'session/reports/r.md', replacements: [{ old_text: 'Old line', new_text: 'New line' }] } }],
        } as any} />);
        fireEvent.click(screen.getByRole('button', { name: /Searching the session/ }));
        expect(screen.getByText('Query')).toBeInTheDocument();
        expect(screen.getByText('completion rural')).toBeInTheDocument();
        expect(screen.getByText('1 item match')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /session\/reports\/r.md/ }));
        expect(screen.getByText(/- Old line\s+\+ New line/)).toBeInTheDocument();
    });
});
