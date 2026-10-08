import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { dataFormulatorReducer } from '../../../../src/app/dfSlice';
import { createDfTheme } from '../../../../src/app/theme';
import ReactAppPreview from '../../../../src/views/ReactAppPreview';

const renderPreview = (source: string, onAskFix = vi.fn()) => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    render(<Provider store={store}><ThemeProvider theme={createDfTheme('fluent')}>
        <ReactAppPreview source={source} title="sales.app.jsx" onAskFix={onAskFix} />
    </ThemeProvider></Provider>);
    return onAskFix;
};

describe('ReactAppPreview', () => {
    it('shows compile errors without running the app and offers a fix', () => {
        const onAskFix = renderPreview('// @df-app {"version": 2, "title": "Sales", "tables": []}\nexport default function App() {\n  return <div>;\n}');
        expect(screen.getByRole('alert')).toHaveTextContent(/Syntax error at line 3/);
        fireEvent.click(screen.getByRole('button', { name: /ask agent to fix/i }));
        expect(onAskFix).toHaveBeenCalledWith([expect.stringMatching(/^Syntax error at line 3/)]);
    });

    it('explains disallowed imports', () => {
        renderPreview("import _ from 'lodash';\nexport default () => null;");
        expect(screen.getByRole('alert')).toHaveTextContent('Cannot import "lodash"');
    });

    it('renders a valid app without errors', () => {
        renderPreview("import { Page } from '@df/ui';\nexport default function App() { return <Page title=\"Hi\" />; }");
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByTitle(/sandboxed app/i)).toBeInTheDocument();
    });
});
