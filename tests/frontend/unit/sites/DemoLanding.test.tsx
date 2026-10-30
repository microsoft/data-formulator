import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions } from '../../../../src/app/dfSlice';
import { LandingDataEntry } from '../../../../src/views/LandingDataEntry';
import { DemoDatasetTabs } from '../../../../src/sites/DemoDatasetTabs';
import type { SiteConfig, SiteStarter } from '../../../../src/sites/types';

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: vi.fn() }));

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const starter = (id: string, available = true): SiteStarter => ({
    id, title: `Title ${id}`, kicker: `Data ${id}`, icon: 'science', questions: [], available, workspace: `/api/demos/d/starters/${id}`,
    stories: [{ id: `${id}-s`, headline: `Headline ${id}`, prompt: `Prompt ${id}`, available: true, session: '' }],
});

const store = (site?: SiteConfig) => {
    const result = configureStore({ reducer: dataFormulatorReducer });
    if (site) result.dispatch(dfActions.setServerConfig({ ...result.getState().serverConfig, SITE: site }));
    return result;
};

describe('the landing chat on a demo', () => {
    it('offers the demo’s questions and datasets instead of sources and uploads', () => {
        const onStartChat = vi.fn();
        render(<Provider store={store()}>
            <LandingDataEntry onStartChat={onStartChat} ensureActiveWorkspace={vi.fn()} onUpload={vi.fn()} onConnect={vi.fn()}
                onSelectConnector={vi.fn()} connectors={[{ id: 'kusto', display_name: 'Kusto', connected: true } as any]}
                demo={{ suggestions: ['What can I explore here?'], placeholder: 'Ask about the data', datasets: <div>The datasets</div> }} />
        </Provider>);
        expect(screen.getByPlaceholderText('Ask about the data')).toBeInTheDocument();
        expect(screen.getByText('The datasets')).toBeInTheDocument();
        for (const name of ['Kusto', 'Upload Data', 'Connect databases', 'Guide me to connect a data source']) {
            expect(screen.queryByRole('button', { name })).toBeNull();
        }
        fireEvent.click(screen.getByRole('button', { name: 'What can I explore here?' }));
        expect(onStartChat).toHaveBeenLastCalledWith('What can I explore here?', [], []);
    });
});

describe('the dataset tabs', () => {
    it('shows one dataset at a time, with its example sessions as picture cards, and loads it', () => {
        const onLoad = vi.fn();
        const onOpenStory = vi.fn();
        const onSelect = vi.fn();
        const a = { ...starter('a'), description: 'About a.', source_url: 'https://source.example/a' };
        a.stories = [{ ...a.stories![0], image: '/a1.png' }, { id: 'a2', headline: 'Lead', prompt: 'Lead question', available: true, session: '',
            featured: true, image: '/a2.png' }];
        const b = { ...starter('b', false), stories: [], questions: ['Ask b?'] };
        render(<DemoDatasetTabs starters={[a, b]} onLoad={onLoad} onOpenStory={onOpenStory} onSelect={onSelect} />);
        expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }));
        const panel = screen.getByRole('tabpanel', { name: 'Data a' });
        expect(panel).toHaveTextContent('Title a');
        expect(panel).toHaveTextContent('About a.');
        expect(screen.getByRole('link', { name: /View the source/ })).toHaveAttribute('href', 'https://source.example/a');
        // Its example sessions, the lead one first, each with its chart, open their sessions.
        expect([...panel.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual(['/a2.png', '/a1.png']);
        const examples = screen.getByRole('list', { name: 'Example sessions' });
        expect(within(examples).getAllByRole('listitem').map(item => item.textContent)).toEqual([
            expect.stringContaining('Lead'), expect.stringContaining('Headline a')]);
        fireEvent.click(within(examples).getByRole('button', { name: 'Headline a' }));
        expect(onOpenStory).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'a-s' }));
        fireEvent.click(screen.getByRole('button', { name: 'Load dataset' }));
        expect(onLoad).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }));

        fireEvent.click(screen.getByRole('tab', { name: 'Data b' }));
        expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }));
        expect(screen.getByRole('tabpanel', { name: 'Data b' })).toHaveTextContent('Not available yet');
        expect(screen.getByRole('button', { name: 'Load dataset' })).toBeDisabled();
        // Without examples, its questions to start from.
        expect(within(screen.getByRole('list', { name: 'Questions' })).getByText('Ask b?')).toBeInTheDocument();
    });
});
