import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequest = vi.fn();
vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));

import SitePage, { safeUrl } from '../../../../src/sites/SitePage';
import type { SiteConfig, SiteStory } from '../../../../src/sites/types';

const story = (id: string, available = true): SiteStory => ({
    id, headline: `Headline ${id}`, dek: `Dek ${id}`, prompt: `Prompt ${id}`, image: null,
    available, session: `/api/demos/unesco/stories/${id}`,
});

const site = (stories?: SiteStory[]): SiteConfig => ({
    id: 'unesco', name: 'UIS Data Explorer', release: '2026-02', intro: 'The bulk release of {release} from [UIS](https://uis.example/).', starters: [{
        id: 'science', title: 'Science', description: 'Research and development.', questions: ['Starter question?'], available: true,
        source_url: 'https://data.example/science', workspace: '/api/demos/unesco/starters/science', stories,
    }],
});

const page = (config: SiteConfig, props: Partial<React.ComponentProps<typeof SitePage>> = {}) =>
    render(React.createElement(SitePage, { site: config, ...props }));

describe('SitePage', () => {
    it('leaves the title, chat and datasets to the landing page above it', () => {
        page({ ...site([story('one')]), badge: 'Beta' });
        expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Headline one' })).toBeNull();
    });

    it('names the release in the descriptions at the foot, with their links', () => {
        page(site());
        const about = screen.getByRole('region', { name: 'About this demo' });
        expect(within(about).getByText(/The bulk release of February 2026 from/)).toBeInTheDocument();
        expect(within(about).getByRole('link', { name: 'UIS' })).toHaveAttribute('href', 'https://uis.example/');
    });

    it("shows the visitor's sessions and the footer note from the profile", () => {
        page({ ...site(), disclaimer: 'Check the [source](https://data.example/).' }, { sessions: 'My session' });
        expect(screen.getByRole('region', { name: 'Your sessions' })).toHaveTextContent('My session');
        expect(screen.getByRole('link', { name: 'source' })).toHaveAttribute('href', 'https://data.example/');
    });

    it('does not link unsafe profile URLs', () => {
        expect(['https://a.example/', 'http://a.example/', 'mailto:x@a.example', '#top', '/about'].map(safeUrl))
            .toEqual(['https://a.example/', 'http://a.example/', 'mailto:x@a.example', '#top', '/about']);
        expect(['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', '//evil.example', ''].map(safeUrl))
            .toEqual([undefined, undefined, undefined, undefined, undefined]);

        page({ ...site(), intro: 'See [this](javascript:alert).', links: [{ label: 'Bad', url: 'javascript:alert(1)' }] });
        expect(screen.getByText(/See this\./)).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'this' })).toBeNull();
        expect(screen.queryByRole('link', { name: 'Bad' })).toBeNull();
    });
});

describe('SitePage before the demo is installed', () => {
    const notInstalled = (canInstall: boolean): SiteConfig => ({
        ...site([story('one')]), status: 'not_installed', can_install: canInstall, install_note: 'Downloads 120 MB.',
    });
    beforeEach(() => apiRequest.mockReset());

    it('offers to install it locally and shows the progress', async () => {
        apiRequest.mockResolvedValueOnce({ data: { status: 'not_installed', can_install: true, job: null } });
        page(notInstalled(true));
        expect(screen.getByText('Downloads 120 MB.')).toBeInTheDocument();
        await screen.findByRole('button', { name: 'Install demo' });
        expect(apiRequest).toHaveBeenLastCalledWith('/api/demos/unesco/install', undefined);

        apiRequest.mockResolvedValueOnce({ data: { status: 'not_installed', can_install: true,
            job: { state: 'running', error: null, log: ['downloading SDG11.zip'] } } });
        fireEvent.click(screen.getByRole('button', { name: 'Install demo' }));
        expect(await screen.findByRole('button', { name: 'Installing…' })).toBeDisabled();
        expect(apiRequest).toHaveBeenLastCalledWith('/api/demos/unesco/install', { method: 'POST' });
        expect(screen.getByLabelText('Install progress')).toHaveTextContent('downloading SDG11.zip');
    });

    it('reports a failed install and lets the user try again', async () => {
        apiRequest.mockResolvedValueOnce({ data: { status: 'not_installed', can_install: true,
            job: { state: 'failed', error: 'could not download the UIS data', log: ['error: x'] } } });
        page(notInstalled(true));
        expect(await screen.findByRole('alert')).toHaveTextContent('The install stopped: could not download the UIS data');
        expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    });

    it('says the demo is not available where it cannot be installed', async () => {
        apiRequest.mockResolvedValueOnce({ data: { status: 'not_installed', can_install: false, job: null } });
        page(notInstalled(false));
        expect(screen.getByRole('heading', { name: 'This demo is not available yet' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Install/ })).toBeNull();
    });
});
