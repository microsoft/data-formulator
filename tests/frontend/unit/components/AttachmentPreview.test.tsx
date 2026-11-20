import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ fetchWithIdentity: vi.fn() }));

vi.mock('../../../../src/app/utils', () => ({
    getUrls: () => ({ SCRATCH_BASE_URL: '/api/agent/workspace/scratch' }),
    fetchWithIdentity: mocks.fetchWithIdentity,
}));

vi.mock('../../../../src/app/dfSlice', () => ({ dfSelectors: { getAllTables: () => [] } }));

import { AttachmentPreview, PreviewTooltip } from '../../../../src/components/AttachmentPreview';

const chip = (name: string, path?: string, sentAt?: number) => render(<div>
    <PreviewTooltip pinnable title={<AttachmentPreview name={name} path={path} sentAt={sentAt} />}>
        <button type="button">{name}</button>
    </PreviewTooltip>
    <span>elsewhere</span>
</div>);

describe('attachment previews', () => {
    it('shows an attached image with when it was sent', async () => {
        vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:pasted' }));
        mocks.fetchWithIdentity.mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['png']) });
        chip('image', 'scratch/image_1a2b3c4d.png', new Date(2026, 10, 17, 14, 5).getTime());
        fireEvent.mouseOver(screen.getByRole('button', { name: 'image' }));
        expect((await screen.findByRole('img', { name: 'image' })).getAttribute('src')).toBe('blob:pasted');
        expect(screen.getByText(/2:05|14:05/)).toBeTruthy();
    });

    it('shows the first lines of an attached text file, read from scratch/, on hover', async () => {
        mocks.fetchWithIdentity.mockResolvedValueOnce({ ok: true, text: async () => 'city,papers\nSydney,6050\nParis,1275' });
        chip('cities.csv', 'scratch/cities.csv');
        fireEvent.mouseOver(screen.getByRole('button', { name: 'cities.csv' }));
        expect(await screen.findByText(/Sydney,6050/)).toBeTruthy();
        expect(mocks.fetchWithIdentity).toHaveBeenCalledWith('/api/agent/workspace/scratch/cities.csv');
    });

    it('says there is no preview for an attachment saved without its file', async () => {
        chip('image');
        fireEvent.mouseOver(screen.getByRole('button', { name: 'image' }));
        expect(await screen.findByText('image · no preview')).toBeTruthy();
    });

    it('stays open when clicked, until a click elsewhere', async () => {
        chip('notes.txt');
        const button = screen.getByRole('button', { name: 'notes.txt' });
        fireEvent.click(button);
        expect(await screen.findByText('notes.txt · no preview')).toBeTruthy();
        fireEvent.mouseLeave(button);
        expect(screen.queryByText('notes.txt · no preview')).toBeTruthy();
        fireEvent.click(screen.getByText('elsewhere'));
        await vi.waitFor(() => expect(screen.queryByText('notes.txt · no preview')).toBeNull());
    });
});
