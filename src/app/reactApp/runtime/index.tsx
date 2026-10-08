// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DF React app runtime, bundled into one script and injected into the sandboxed
 * app frame after the DF bridge (dfAppRuntime.js). The host compiles the app to
 * CommonJS (Sucrase) and calls `__DF_REACT__.mount(factory)`; `require` resolves
 * only the modules listed here.
 */

import React from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import * as MUI from '@mui/material';
import GlobalStyles from '@mui/material/GlobalStyles';
import { ThemeProvider } from '@mui/material/styles';

import { createDfTheme } from '../../theme';
import { appConfig, bridge, errorMessage, reportError } from './bridge';
import * as chart from './chart';
import * as data from './data';
import * as icons from './icons';
import { ErrorState } from './states';
import * as ui from './ui';

export const MODULES: Record<string, unknown> = {
    'react': React,
    'react/jsx-runtime': ReactJsxRuntime,
    '@df/ui': ui,
    '@df/data': { useQuery: data.useQuery, useDistinct: data.useDistinct, useTable: data.useTable },
    '@df/chart': chart,
    '@df/format': {
        get format() { return bridge().format; },
        ...Object.fromEntries(['number', 'compact', 'percent', 'delta', 'date'].map(name =>
            [name, (...args: unknown[]) => (bridge().format as any)[name](...args)])),
    },
    '@df/icons': icons,
    '@mui/material': MUI,
};

export const ALLOWED_MODULES = Object.keys(MODULES);

export function requireModule(name: string): unknown {
    if (Object.prototype.hasOwnProperty.call(MODULES, name)) return MODULES[name];
    throw new Error(`Cannot import "${name}". Apps can import only: ${ALLOWED_MODULES.join(', ')}.`);
}

class ErrorBoundary extends React.Component<{ children?: React.ReactNode }, { error: string | null }> {
    state = { error: null as string | null };
    static getDerivedStateFromError(error: unknown) { return { error: errorMessage(error) }; }
    componentDidCatch(error: unknown) { reportError(`App crashed: ${errorMessage(error)}`); }
    render() {
        if (this.state.error) return <MUI.Box sx={{ p: 2 }}><ErrorState error={this.state.error} /></MUI.Box>;
        return this.props.children;
    }
}

const isComponent = (value: unknown) => typeof value === 'function'
    || (typeof value === 'object' && value !== null && '$$typeof' in value);

/** Evaluate the compiled app module and render its default export. */
export function mount(factory: (require: (name: string) => unknown, module: { exports: any }, exports: any) => void,
    container?: Element | null) {
    // Runtime scripts run in <head>, before the app root in <body> exists.
    if (container === undefined && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => mount(factory), { once: true });
        return undefined;
    }
    const target = container === undefined ? document.getElementById('df-app-root') : container;
    if (!target) throw new Error('App root element is missing.');
    const module = { exports: {} as any };
    let App: unknown;
    try {
        factory(requireModule, module, module.exports);
        App = module.exports.default ?? module.exports.App;
        if (!isComponent(App)) throw new Error('The app must `export default` a React component.');
    } catch (error) {
        reportError(errorMessage(error));
        App = () => <MUI.Box sx={{ p: 2 }}><ErrorState error={errorMessage(error)} /></MUI.Box>;
    }
    const AppComponent = App as React.ComponentType;
    const root = createRoot(target);
    root.render(
        <ThemeProvider theme={createDfTheme(appConfig().paletteKey ?? '')}>
            <GlobalStyles styles={theme => ({
                'html, body': {
                    margin: 0, background: '#f6f7f9', color: theme.palette.text.primary,
                    fontFamily: theme.typography.fontFamily, fontSize: 'var(--df-text-sm, 13px)', lineHeight: 1.5,
                    WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale',
                },
                'button, input, select, textarea': { font: 'inherit' },
                '*, *::before, *::after': { boxSizing: 'border-box' },
            })} />
            <ErrorBoundary><AppComponent /></ErrorBoundary>
        </ThemeProvider>,
    );
    return root;
}

(window as unknown as { __DF_REACT__?: unknown }).__DF_REACT__ = Object.freeze({ mount, modules: ALLOWED_MODULES });
