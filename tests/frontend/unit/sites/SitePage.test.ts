import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequest = vi.fn();
vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));

import SitePage, { safeUrl } from '../../../../src/sites/SitePage';
import type { SiteConfig, SiteStory } from '../../../../src/sites/types';

const story = (id: string, featured = false): SiteStory => ({
    id, headline: `Headline ${id}`, dek: `Dek ${id}`, featured, prompt: `Prompt ${id}`, image: null,
    available: true, session: `/api/demos/unesco/stories/${id}`,
});

const site = (stories?: SiteStory[]): SiteConfig => ({
    id: 'unesco', name: 'UIS Data Explorer', release: '2026-02', intro: 'The bulk release of {release} from [UIS](https://uis.example/).', starters: [{
        id: 'science', title: 'Science', questions: ['Starter question?'], available: true, source_url: 'https://data.example/science',
        workspace: '/api/demos/unesco/starters/science', stories,
    }],
});

describe('SitePage', () => {
    it('labels the title with the site badge when there is one', () => {
        const { unmount } = render(React.createElement(SitePage, { site: { ...site(), badge: 'Beta' }, onOpenStarter: vi.fn(), onOpenStory: vi.fn() }));
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('UIS Data ExplorerBeta');
        unmount();
        render(React.createElement(SitePage, { site: site(), onOpenStarter: vi.fn(), onOpenStory: vi.fn() }));
        expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    });

    it('names the release in the intro, with its links', () => {
        render(React.createElement(SitePage, { site: site(), onOpenStarter: vi.fn(), onOpenStory: vi.fn() }));
        expect(screen.getByText(/The bulk release of February 2026 from/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'UIS' })).toHaveAttribute('href', 'https://uis.example/');
    });

    it('shows each dataset with its example sessions, the lead one first', () => {
        const onOpenStory = vi.fn();
        render(React.createElement(SitePage, {
            site: site([story('alt-1'), story('lead', true), story('alt-2')]), onOpenStarter: vi.fn(), onOpenStory,
        }));
        const section = screen.getByRole('region', { name: 'Science' });
        const sessions = within(section).getByRole('list', { name: 'Example analyses' });
        expect(within(sessions).getAllByRole('listitem').map(item => item.textContent)).toEqual([
            expect.stringContaining('Headline leadDek lead'), expect.stringContaining('Headline alt-1'),
            expect.stringContaining('Headline alt-2'), expect.stringContaining('Create your own analysis of science')]);

        fireEvent.click(within(section).getByRole('button', { name: 'Headline lead' }));
        expect(onOpenStory).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'science' }), expect.objectContaining({ id: 'lead' }));
        fireEvent.click(within(section).getByRole('button', { name: 'Headline alt-2' }));
        expect(onOpenStory).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'science' }), expect.objectContaining({ id: 'alt-2' }));
        expect(within(section).queryByText('Starter question?')).toBeNull();
    });

    it('links each dataset section from the title row', () => {
        render(React.createElement(SitePage, { site: site([story('lead', true)]), onOpenStarter: vi.fn(), onOpenStory: vi.fn() }));
        const section = screen.getByRole('region', { name: 'Science' });
        expect(section).toHaveAttribute('id', 'science');
        expect(within(section).getByRole('link', { name: 'Link to this section' })).toHaveAttribute('href', '#science');
    });

    it('links each dataset to its source', () => {
        render(React.createElement(SitePage, { site: site([story('lead', true)]), onOpenStarter: vi.fn(), onOpenStory: vi.fn() }));
        const section = screen.getByRole('region', { name: 'Science' });
        expect(within(section).getByRole('link', { name: /View the source/ })).toHaveAttribute('href', 'https://data.example/science');
    });

    it('starts a new session from the dataset', () => {
        const onOpenStarter = vi.fn();
        render(React.createElement(SitePage, { site: site([story('lead', true)]), onOpenStarter, onOpenStory: vi.fn() }));
        fireEvent.click(screen.getByRole('button', { name: /Create your own analysis of science/ }));
        expect(onOpenStarter).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'science' }));
    });

    it('offers the starter questions until the dataset has sessions', () => {
        const onOpenStarter = vi.fn();
        render(React.createElement(SitePage, { site: site(), onOpenStarter, onOpenStory: vi.fn() }));
        fireEvent.click(screen.getByRole('button', { name: /Starter question\?/ }));
        expect(onOpenStarter).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'science' }), 'Starter question?');
        fireEvent.click(screen.getByRole('button', { name: /Create your own analysis of science/ }));
        expect(onOpenStarter).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'science' }));
    });

    it("shows the lead session's findings as a stack of chart cards", () => {
        const lead = { ...story('lead', true), stack: [{ label: 'Rising since 2000', image: '/a.png' }, { label: 'Where it is lowest', image: '/b.png' }] };
        render(React.createElement(SitePage, { site: site([lead]), onOpenStarter: vi.fn(), onOpenStory: vi.fn() }));
        const section = screen.getByRole('region', { name: 'Science' });
        expect(section.querySelectorAll('img[src="/a.png"], img[src="/b.png"]')).toHaveLength(2);
    });

    it('takes its icons, new-session note and footer note from the profile', () => {
        const config = { ...site(), disclaimer: 'Check the [source](https://data.example/).' };
        config.starters = [{ ...config.starters[0], icon: 'science', start_note: 'All the tables' },
            { ...config.starters[0], id: 'other', title: 'Other' }];
        render(React.createElement(SitePage, { site: config, onOpenStarter: vi.fn(), onOpenStory: vi.fn() }));
        expect(screen.getByRole('button', { name: /Create your own analysis of science/ })).toHaveTextContent('All the tables');
        expect(screen.getByRole('button', { name: /Create your own analysis of other/ })).toHaveTextContent('Start from the full dataset');
        const datasets = screen.getByRole('navigation', { name: 'Datasets' });
        expect(datasets.querySelector('[data-testid="ScienceOutlinedIcon"]')).not.toBeNull();
        expect(datasets.querySelector('[data-testid="TableChartOutlinedIcon"]')).not.toBeNull();
        expect(screen.getByRole('link', { name: 'source' })).toHaveAttribute('href', 'https://data.example/');
    });

    it('does not link unsafe profile URLs', () => {
        expect(['https://a.example/', 'http://a.example/', 'mailto:x@a.example', '#top', '/about'].map(safeUrl))
            .toEqual(['https://a.example/', 'http://a.example/', 'mailto:x@a.example', '#top', '/about']);
        expect(['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', '//evil.example', ''].map(safeUrl))
            .toEqual([undefined, undefined, undefined, undefined, undefined]);

        const config = { ...site(), intro: 'See [this](javascript:alert).', links: [{ label: 'Bad', url: 'javascript:alert(1)' }] };
        config.starters = [{ ...config.starters[0], source_url: 'javascript:alert(1)' }];
        render(React.createElement(SitePage, { site: config, onOpenStarter: vi.fn(), onOpenStory: vi.fn() }));
        expect(screen.getByText(/See this\./)).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'this' })).toBeNull();
        expect(screen.queryByRole('link', { name: 'Bad' })).toBeNull();
        expect(screen.queryByRole('link', { name: /View the source/ })).toBeNull();
    });

    it('shows the question each story starts from', () => {
        render(React.createElement(SitePage, {
            site: site([story('lead', true), story('other')]), onOpenStarter: vi.fn(), onOpenStory: vi.fn(),
        }));
        const lead = screen.getByRole('button', { name: 'Headline lead' });
        expect(lead).toHaveTextContent('Question: Prompt lead');
        expect(screen.getByRole('button', { name: 'Headline other' })).toHaveAttribute('title', 'Question: Prompt other');
    });
});

describe('SitePage before the demo is installed', () => {
    const notInstalled = (canInstall: boolean): SiteConfig => ({
        ...site([story('lead', true)]), status: 'not_installed', can_install: canInstall, install_note: 'Downloads 120 MB.',
    });
    beforeEach(() => apiRequest.mockReset());

    it('offers to install it locally and shows the progress', async () => {
        apiRequest.mockResolvedValueOnce({ data: { status: 'not_installed', can_install: true, job: null } });
        render(React.createElement(SitePage, { site: notInstalled(true), onOpenStarter: vi.fn(), onOpenStory: vi.fn() }));
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('UIS Data Explorer');
        expect(screen.queryByRole('region', { name: 'Science' })).toBeNull();
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
        render(React.createElement(SitePage, { site: notInstalled(true), onOpenStarter: vi.fn(), onOpenStory: vi.fn() }));
        expect(await screen.findByRole('alert')).toHaveTextContent('The install stopped: could not download the UIS data');
        expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    });

    it('says the demo is not available where it cannot be installed', async () => {
        apiRequest.mockResolvedValueOnce({ data: { status: 'not_installed', can_install: false, job: null } });
        render(React.createElement(SitePage, { site: notInstalled(false), onOpenStarter: vi.fn(), onOpenStory: vi.fn() }));
        expect(screen.getByRole('heading', { name: 'This demo is not available yet' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Install/ })).toBeNull();
        expect(screen.queryByRole('nav')).toBeNull();
    });
});
