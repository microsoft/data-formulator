import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFormulatorReducer } from '../../../../src/app/dfSlice';
import { SimpleChartRecBox } from '../../../../src/views/SimpleChartRecBox';
import { AgentChatInput } from '../../../../src/views/AgentChatInput';
import { apiRequest, streamRequest } from '../../../../src/app/apiClient';

vi.mock('../../../../src/app/apiClient', () => ({
    apiRequest: vi.fn(),
    streamRequest: vi.fn(),
}));

const fileDrag = (files: File[]) => ({ dataTransfer: { types: ['Files'], files, dropEffect: 'none' } });

describe('Dropping files on a chat box', () => {
    beforeEach(() => {
        vi.mocked(apiRequest).mockReset();
        vi.mocked(streamRequest).mockReset();
    });

    it('attaches files dropped on the session chat box like the attach button', async () => {
        vi.mocked(apiRequest).mockResolvedValue({ data: { path: 'scratch/sales.csv' } } as any);
        render(<Provider store={configureStore({ reducer: dataFormulatorReducer })}><SimpleChartRecBox /></Provider>);
        const box = screen.getByRole('button', { name: 'Attach file' }).closest('.MuiCard-root') as HTMLElement;
        const file = new File(['a,b\n1,2'], 'sales.csv', { type: 'text/csv' });

        fireEvent.dragEnter(box, fileDrag([file]));
        expect(screen.getByText('Drop file to attach')).toBeInTheDocument();
        const over = fileDrag([file]);
        fireEvent.dragOver(box, over);
        expect(over.dataTransfer.dropEffect).toBe('copy');
        fireEvent.drop(box, fileDrag([file]));

        expect(screen.queryByText('Drop file to attach')).toBeNull();
        await waitFor(() => expect(screen.getByText('sales.csv')).toBeInTheDocument());
        const [url, init] = vi.mocked(apiRequest).mock.calls[0];
        expect(url).toBe('/api/agent/workspace/scratch/upload');
        expect((init!.body as FormData).get('file')).toBe(file);
    });

    it('ignores drags that carry no files', () => {
        render(<Provider store={configureStore({ reducer: dataFormulatorReducer })}><SimpleChartRecBox /></Provider>);
        const box = screen.getByRole('button', { name: 'Attach file' }).closest('.MuiCard-root') as HTMLElement;
        fireEvent.dragEnter(box, { dataTransfer: { types: ['application/json'], files: [] } });
        expect(screen.queryByText('Drop file to attach')).toBeNull();
    });

    it('attaches dropped files on the landing chat box and refuses them while disabled', () => {
        const onNonImageFile = vi.fn();
        const props = { value: '', onChange: () => {}, images: [], onImagesChange: () => {}, onSend: () => {}, onNonImageFile };
        const { rerender } = render(<AgentChatInput {...props} placeholder="Ask" />);
        const box = screen.getByPlaceholderText('Ask').closest('.MuiInputBase-root')!.parentElement!.parentElement as HTMLElement;
        const file = new File(['x'], 'notes.txt', { type: 'text/plain' });

        fireEvent.dragEnter(box, fileDrag([file]));
        expect(screen.getByText('Drop file to attach')).toBeInTheDocument();
        fireEvent.drop(box, fileDrag([file]));
        expect(onNonImageFile).toHaveBeenCalledWith(file);

        rerender(<AgentChatInput {...props} placeholder="Ask" disabled />);
        fireEvent.dragEnter(box, fileDrag([file]));
        expect(screen.queryByText('Drop file to attach')).toBeNull();
        const over = fileDrag([file]);
        fireEvent.dragOver(box, over);
        expect(over.dataTransfer.dropEffect).toBe('none');
        fireEvent.drop(box, fileDrag([file]));
        expect(onNonImageFile).toHaveBeenCalledTimes(1);
    });

    it('keeps the browser from opening a file dropped beside the chat box, only while one is mounted', () => {
        const strayDrop = () => {
            const event = new Event('drop', { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], dropEffect: 'none' } });
            act(() => { document.body.dispatchEvent(event); });
            return event.defaultPrevented;
        };
        const props = { value: '', onChange: () => {}, images: [], onImagesChange: () => {}, onSend: () => {} };
        const { unmount } = render(<AgentChatInput {...props} />);
        expect(strayDrop()).toBe(true);
        unmount();
        expect(strayDrop()).toBe(false);
    });
});
