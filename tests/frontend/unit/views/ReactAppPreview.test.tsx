import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dataFormulatorReducer } from '../../../../src/app/dfSlice';
import { createDfTheme } from '../../../../src/app/theme';
import { apiRequest } from '../../../../src/app/apiClient';
import ReactAppPreview from '../../../../src/views/ReactAppPreview';
import { AppSandbox } from '../../../../src/views/AppSandbox';

vi.mock('../../../../src/app/apiClient', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/app/apiClient')>(),
    apiRequest: vi.fn(),
}));

const renderPreview = (source: string, onAskFix = vi.fn(), extra: { autoFix?: boolean; fixPending?: boolean } = {}) => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const view = render(<Provider store={store}><ThemeProvider theme={createDfTheme('fluent')}>
        <ReactAppPreview source={source} title="sales.app.jsx" onAskFix={onAskFix} {...extra} />
    </ThemeProvider></Provider>);
    const rerender = (next: { autoFix?: boolean; fixPending?: boolean }) => view.rerender(<Provider store={store}><ThemeProvider theme={createDfTheme('fluent')}>
        <ReactAppPreview source={source} title="sales.app.jsx" onAskFix={onAskFix} {...next} />
    </ThemeProvider></Provider>);
    return Object.assign(onAskFix, { rerender });
};

const BROKEN = '// @df-app {"version": 2, "title": "Sales", "tables": []}\nexport default function App() {\n  return <div>;\n}';

describe('ReactAppPreview', () => {
    it('shows a crash page for an app that cannot compile, with a button to ask the agent once', () => {
        const onAskFix = renderPreview(BROKEN);
        const crash = screen.getByRole('alert');
        expect(crash).toHaveAttribute('data-app-crash');
        expect(crash).toHaveTextContent("This app couldn't be displayed");
        expect(crash).toHaveTextContent(/Syntax error at line 3/);
        fireEvent.click(screen.getByRole('button', { name: /ask agent to fix/i }));
        expect(onAskFix).toHaveBeenCalledWith([expect.stringMatching(/^Syntax error at line 3/)]);
        expect(screen.getByRole('button', { name: /sent to the agent/i })).toBeDisabled();
        expect(onAskFix).toHaveBeenCalledTimes(1);
    });

    it('explains disallowed imports', () => {
        renderPreview("import moment from 'moment';\nexport default () => null;");
        expect(screen.getByRole('alert')).toHaveTextContent('Cannot import "moment"');
    });

    it('renders a valid app without errors', () => {
        renderPreview("import { Typography } from '@mui/material';\nexport default function App() { return <Typography>Hi</Typography>; }");
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByTitle(/sandboxed app/i)).toBeInTheDocument();
    });

    it('sends an app the agent just wrote back to the agent when it fails, showing that it is being fixed instead', () => {
        const onAskFix = renderPreview(BROKEN, vi.fn(), { autoFix: true, fixPending: true });
        expect(onAskFix).toHaveBeenCalledTimes(1);
        expect(onAskFix).toHaveBeenCalledWith([expect.stringMatching(/^Syntax error at line 3/)]);
        expect(screen.getByRole('status')).toHaveAttribute('data-app-fixing');
        expect(screen.getByRole('status')).toHaveTextContent('Fixing an error in this app');
        expect(screen.queryByText("This app couldn't be displayed")).toBeNull();
    });

    it('shows the error again if the agent finishes without fixing the app', () => {
        vi.useFakeTimers();
        try {
            const onAskFix = renderPreview(BROKEN, vi.fn(), { autoFix: true, fixPending: true });
            onAskFix.rerender({ autoFix: true, fixPending: false });
            act(() => { vi.advanceTimersByTime(2500); });
            expect(screen.queryByRole('status')).toBeNull();
            expect(screen.getByRole('alert')).toHaveTextContent("This app couldn't be displayed");
            expect(screen.getByRole('button', { name: /sent to the agent/i })).toBeDisabled();
            expect(onAskFix).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('AppSandbox external links', () => {
    const originalActivation = Object.getOwnPropertyDescriptor(navigator, 'userActivation');
    afterEach(() => {
        if (originalActivation) Object.defineProperty(navigator, 'userActivation', originalActivation);
        else Reflect.deleteProperty(navigator, 'userActivation');
        vi.restoreAllMocks();
    });

    const setup = ({ active = true as boolean | null, linkSource = '' } = {}) => {
        Object.defineProperty(navigator, 'userActivation', { configurable: true, value: active === null ? undefined : { isActive: active } });
        const open = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const buildDocument = vi.fn((channel: string) => `<html><body>${channel}</body></html>`);
        render(<ThemeProvider theme={createDfTheme('fluent')}>
            <AppSandbox title="Links" manifest={{ version: 1, title: 'Links', tables: ['papers'] }} buildDocument={buildDocument} linkSource={linkSource} />
        </ThemeProvider>);
        const container = screen.getByTitle(/sandboxed app/i) as HTMLIFrameElement;
        fireEvent.load(container);
        const frame = container.contentDocument!.querySelector('iframe')!;
        const channel = buildDocument.mock.calls[0][0];
        const message = (data: Record<string, unknown>, source: unknown = frame.contentWindow, dfApp = channel) => act(() => {
            container.contentWindow!.dispatchEvent(new MessageEvent('message', { source: source as Window, data: { dfApp, ...data } }));
        });
        const send = (url: unknown, source?: unknown, dfApp?: string) => message({ type: 'openExternal', url }, source ?? frame.contentWindow, dfApp ?? channel);
        const opened = () => open.mock.instances.map(link => (link as HTMLAnchorElement).getAttribute('href'));
        return { open, opened, send, message };
    };

    it('opens an address written in the app separately, without an opener or referrer, and keeps the app running', () => {
        const { open, send } = setup({ linkSource: '<a href="https://neurips.cc/virtual/2026">Site</a>' });
        send('https://neurips.cc/virtual/2026');
        expect(open).toHaveBeenCalledOnce();
        const link = open.mock.instances[0];
        expect(link).toHaveAttribute('href', 'https://neurips.cc/virtual/2026');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByTitle(/sandboxed app/i)).toBeInTheDocument();
    });

    it('asks before opening an address the app may have built, and can trust the site for the rest of the run', () => {
        const { opened, send } = setup();
        send('https://collector.example/c?rows=secret');
        const dialog = screen.getByRole('dialog', { name: 'Open this link?' });
        expect(dialog).toHaveTextContent('collector.example');
        expect(dialog).toHaveTextContent('https://collector.example/c?rows=secret');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(opened()).toEqual([]);

        send('https://arxiv.org/abs/1');
        const next = screen.getByRole('dialog', { name: 'Open this link?' });
        fireEvent.click(within(next).getByRole('checkbox', { name: /arxiv\.org/ }));
        fireEvent.click(within(next).getByRole('button', { name: 'Open link' }));
        expect(opened()).toEqual(['https://arxiv.org/abs/1']);

        send('https://arxiv.org/abs/2');
        expect(opened()).toEqual(['https://arxiv.org/abs/1', 'https://arxiv.org/abs/2']);
        send('https://collector.example/c?rows=more');
        expect(screen.getByRole('dialog', { name: 'Open this link?' })).toHaveTextContent('collector.example');
    });

    it('opens addresses from stored table values directly, but asks for ones SQL could have composed', async () => {
        const url = 'https://openreview.net/forum?id=abc';
        vi.mocked(apiRequest).mockResolvedValue({ data: { rows: [{ title: 'A', url }] } } as never);
        const { opened, send, message } = setup();
        message({ type: 'sql', id: 1, sql: "SELECT 'https://openreview.net/forum?id=abc' AS url", params: [], options: {} });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
        send(url);
        expect(screen.getByRole('dialog', { name: 'Open this link?' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        message({ type: 'query', id: 2, table: 'papers', options: {} });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
        send(url);
        expect(opened()).toEqual([url]);
    });

    it('ignores requests from other windows or channels', () => {
        const { open, send } = setup({ linkSource: 'https://neurips.cc/' });
        send('https://neurips.cc/', window);
        send('https://neurips.cc/', undefined, 'wrong-channel');
        expect(open).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('reports requests without a user click', () => {
        const { open, send } = setup({ active: false, linkSource: 'https://neurips.cc/' });
        send('https://neurips.cc/');
        expect(open).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('External links must be opened by a user click.');
    });

    it('asks for known addresses when the browser cannot report user activation', () => {
        const { open, send } = setup({ active: null, linkSource: 'https://neurips.cc/' });
        send('https://neurips.cc/');
        expect(open).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: 'Open this link?' })).toBeInTheDocument();
    });

    it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test.html', 'https://user:password@example.com', './papers.html', null])('rejects invalid external URLs: %s', url => {
        const { open, send } = setup();
        send(url);
        expect(open).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('alert')).toHaveTextContent(/HTTP\(S\)/);
    });
});
