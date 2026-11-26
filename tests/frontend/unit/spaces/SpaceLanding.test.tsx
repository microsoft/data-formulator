import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions } from '../../../../src/app/dfSlice';
import { LandingDataEntry, LandingSources, chipsThatFit } from '../../../../src/views/LandingDataEntry';
import { SpaceDatasetTabs, inSentence } from '../../../../src/spaces/SpaceDatasetTabs';
import type { SpaceConfig, SpaceStarter } from '../../../../src/spaces/types';

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: vi.fn() }));

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const starter = (id: string, available = true): SpaceStarter => ({
    id, title: `Title ${id}`, kicker: `Data ${id}`, icon: 'science', questions: [], available, workspace: `/api/spaces/d/starters/${id}`,
    stories: [{ id: `${id}-s`, headline: `Headline ${id}`, prompt: `Prompt ${id}`, available: true, session: '' }],
});

const store = (space?: SpaceConfig) => {
    const result = configureStore({ reducer: dataFormulatorReducer });
    if (space) result.dispatch(dfActions.setServerConfig({ ...result.getState().serverConfig, SPACE: space }));
    return result;
};

describe('the landing chat in a space', () => {
    it('offers the space’s questions, and its sources in the standard rows placed after the chat', () => {
        const onStartChat = vi.fn();
        const onSelectConnector = vi.fn();
        const dataverse = { id: 'dataverse', display_name: 'Dataverse', connected: true } as any;
        render(<Provider store={store()}>
            <LandingDataEntry onStartChat={onStartChat} ensureActiveWorkspace={vi.fn()} onUpload={vi.fn()}
                onSelectConnector={onSelectConnector} connectors={[dataverse]}
                space={{ suggestions: ['What can I explore here?'], placeholder: 'Ask about the data' }} />
        </Provider>);
        expect(screen.getByPlaceholderText('Ask about the data')).toBeInTheDocument();
        // The chat keeps the screen's middle: the rows are not under it.
        expect(screen.queryByRole('button', { name: 'Dataverse' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'What can I explore here?' }));
        expect(onStartChat).toHaveBeenLastCalledWith('What can I explore here?', [], []);
    });

    it('lists only the sources and ways to add data it is given', () => {
        const onSelectConnector = vi.fn();
        const dataverse = { id: 'dataverse', display_name: 'Dataverse', connected: true } as any;
        // A space's page lists the sources and ways to add data it is given.
        const { container, rerender } = render(<LandingSources connectors={[dataverse]} onSelectConnector={onSelectConnector}
            onUpload={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Upload Data' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Connect databases' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Dataverse' }));
        expect(onSelectConnector).toHaveBeenLastCalledWith(dataverse);
        rerender(<LandingSources connectors={[]} onSelectConnector={onSelectConnector} />);
        expect(container).toBeEmptyDOMElement();
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
        render(<SpaceDatasetTabs starters={[a, b]} onLoad={onLoad} onOpenStory={onOpenStory} onSelect={onSelect} />);
        expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }));
        const panel = screen.getByRole('tabpanel', { name: 'Data a' });
        expect(panel).toHaveTextContent('Title a');
        expect(panel).toHaveTextContent('About a.');
        expect(screen.getByRole('link', { name: 'View source' })).toHaveAttribute('href', 'https://source.example/a');
        // Its example sessions, the lead one first, each with its chart, open their sessions.
        expect([...panel.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual(['/a2.png', '/a1.png']);
        const examples = screen.getByRole('list', { name: 'Example sessions' });
        expect(within(examples).getAllByRole('listitem').map(item => item.textContent)).toEqual([
            expect.stringContaining('Lead'), expect.stringContaining('Headline a')]);
        fireEvent.click(within(examples).getByRole('button', { name: 'Headline a' }));
        expect(onOpenStory).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'a-s' }));
        // Starting one's own analysis is a quiet link after them.
        fireEvent.click(screen.getByRole('button', { name: 'Or start your own analysis with this dataset' }));
        expect(onLoad).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }));

        fireEvent.click(screen.getByRole('tab', { name: 'Data b' }));
        expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }));
        expect(screen.getByRole('tabpanel', { name: 'Data b' })).toHaveTextContent('Not available yet');
        // Without examples, starting an analysis is the main action.
        expect(screen.getByRole('button', { name: 'Start an analysis with this dataset' })).toBeDisabled();
        // Without examples, its questions to start from.
        expect(within(screen.getByRole('list', { name: 'Questions' })).getByText('Ask b?')).toBeInTheDocument();
    });

    it('shows a session with chapters as one card that opens it, listing what is inside', () => {
        const onOpenStory = vi.fn();
        const a = starter('a');
        a.stories = [{ id: 'topic', headline: 'Three findings', prompt: 'What is in it?', available: true, session: '', image: '/cover.png',
            chapters: [{ label: 'Map', kind: 'map', headline: 'Where it is', stat: '67%', message: 'of it is here' },
                { label: 'Story', kind: 'story', headline: 'What it is' }] }];
        render(<SpaceDatasetTabs starters={[a]} onLoad={vi.fn()} onOpenStory={onOpenStory} />);
        expect(screen.queryByRole('list', { name: 'Example sessions' })).toBeNull();
        const chapters = screen.getByRole('list', { name: 'Inside this session' });
        // A chapter's key figure, with its message, in place of its name and headline (on hover).
        expect(within(chapters).getAllByRole('listitem').map(item => item.textContent)).toEqual(['67%of it is here', 'Story · What it is']);
        expect(within(chapters).getAllByRole('listitem')[0]).toHaveAttribute('title', 'Where it is');
        fireEvent.click(within(chapters).getByText('Story'));
        expect(onOpenStory).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'topic' }));
        expect(screen.getByRole('button', { name: 'Open: Three findings' })).toBeInTheDocument();
    });
});

it('names a dataset mid-sentence in lower case, unless it reads as a proper name', () => {
    expect(inSentence('School and learning')).toBe('school and learning');
    expect(inSentence('SDG 4 education')).toBe('SDG 4 education');
    expect(inSentence('Microsoft at NeurIPS')).toBe('Microsoft at NeurIPS');
});

describe('a space\'s questions on one row', () => {
    it('shows them all when they fit, else as many as fit beside "More", and never none', () => {
        expect(chipsThatFit([100, 100, 100], 60, 312, 6)).toBe(3);
        expect(chipsThatFit([100, 100, 100], 60, 311, 6)).toBe(2);
        expect(chipsThatFit([100, 100, 100], 60, 200, 6)).toBe(1);
        expect(chipsThatFit([400, 100], 60, 200, 6)).toBe(1);
    });
});
