import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { dataFormulatorReducer } from '../../../../src/app/dfSlice';
import { createDfTheme } from '../../../../src/app/theme';
import ReactAppPreview from '../../../../src/views/ReactAppPreview';

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
        renderPreview("import { Page } from '@df/ui';\nexport default function App() { return <Page title=\"Hi\" />; }");
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
