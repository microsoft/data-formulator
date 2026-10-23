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
            codeExecutions: [{ id: 'call', tool: 'execute_python_script', purpose: 'Find the latest year', code: 'print(2025)',
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
});
