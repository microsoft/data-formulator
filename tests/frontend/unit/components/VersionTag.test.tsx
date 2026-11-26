import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import '../../../../src/i18n';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: mocks.apiRequest }));
vi.mock('../../../../src/app/utils', () => ({ getUrls: () => ({ UPDATE_CHECK: '/api/update-check' }) }));

const load = async () => {
    vi.resetModules();
    return (await import('../../../../src/components/VersionTag')).VersionTag;
};

describe('VersionTag', () => {
    beforeEach(() => mocks.apiRequest.mockReset());

    it('shows the version quietly when it is current', async () => {
        mocks.apiRequest.mockResolvedValue({ data: { current: '0.8.0b1', update_available: false } });
        const VersionTag = await load();
        render(<VersionTag version="0.8.0b1" />);
        expect(await screen.findByText('v0.8.0b1')).toBeTruthy();
        expect(document.querySelector('[data-update-available]')).toBeNull();
    });

    it('becomes an update button that says how to update', async () => {
        mocks.apiRequest.mockResolvedValue({ data: { current: '0.8.0b1', update_available: true, latest: '0.9.0', kind: 'pip',
            url: 'https://pypi.org/project/data_formulator/0.9.0/', command: 'pip install -U data_formulator' } });
        const VersionTag = await load();
        render(<VersionTag version="0.8.0b1" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Update to v0.9.0' }));
        expect(await screen.findByText('pip install -U data_formulator')).toBeTruthy();
        expect(screen.getByText('You have 0.8.0b1.')).toBeTruthy();
        expect(screen.getByRole('link', { name: "What's new" }).getAttribute('href')).toBe('https://pypi.org/project/data_formulator/0.9.0/');
    });
});
