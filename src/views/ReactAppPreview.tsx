// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useMemo } from 'react';
import { useSelector } from 'react-redux';

import vegaSource from '../../node_modules/vega/build/vega.min.js?raw';
import vegaLiteSource from '../../node_modules/vega-lite/build/vega-lite.min.js?raw';
import bridgeSource from '../app/htmlApp/dfAppRuntime.js?raw';
import reactRuntimeSource from 'virtual:df-react-runtime';
import { buildAppDocument } from '../app/htmlApp/htmlAppDocument';
import { compileReactApp, mountScript } from '../app/reactApp/compile';
import { dfSelectors, type DataFormulatorState } from '../app/dfSlice';
import type { FieldSemanticsInfo } from '../components/ComponentType';
import { AppSandbox, useAppTheme } from './AppSandbox';

const APP_DOCUMENT = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="df-app-root"></div></body></html>';

// Layout variables the DF MUI theme sizes controls with; mirrored from the host.
const HOST_CSS_VARIABLES = [
    '--df-scale', '--df-icon-xs', '--df-icon-sm', '--df-icon-md', '--df-icon-lg', '--df-icon-xl',
    '--df-button-height-sm', '--df-button-height-md', '--df-button-padding-sm', '--df-button-padding-md', '--df-button-icon-gap',
];

const hostVariablesStylesheet = () => {
    const style = getComputedStyle(document.documentElement);
    const declarations = HOST_CSS_VARIABLES
        .map(name => [name, style.getPropertyValue(name).trim().replace(/[<>{};\\]/g, '')] as const)
        .filter(([, value]) => value)
        .map(([name, value]) => `${name}:${value}`);
    return declarations.length ? `:root{${declarations.join(';')}}` : '';
};

/** A sandboxed React app artifact (`*.app.jsx`), compiled on the host and run in the app frame. */
export const ReactAppPreview: FC<{
    source: string; title: string; reloadKey?: number; reserveTopRight?: boolean; onAskFix?: (errors: string[]) => void;
}> = ({ source, title, reloadKey = 0, reserveTopRight = false, onAskFix }) => {
    const compiled = useMemo(() => compileReactApp(source), [source]);
    const { manifest } = compiled;
    const theme = useAppTheme();
    const paletteKey = useSelector((state: DataFormulatorState) => state.config.paletteKey);
    const tables = useSelector(dfSelectors.getAllTables);
    const tableSemantics = useSelector((state: DataFormulatorState) => state.tableSemantics);
    const semantics = useMemo(() => {
        const byTable: Record<string, Record<string, FieldSemanticsInfo>> = {};
        for (const name of manifest.tables) {
            const table = tables.find(item => item.virtual?.tableId === name || item.id === name);
            const fields = table && tableSemantics.find(info => info.tableId === table.id)?.fields;
            if (fields) byTable[name] = fields;
        }
        return byTable;
    }, [manifest, tables, tableSemantics]);
    const initialErrors = useMemo(() => compiled.ok ? undefined : [compiled.error], [compiled]);
    const buildDocument = useMemo(() => {
        if (!compiled.ok) return null;
        return (channel: string) => buildAppDocument(APP_DOCUMENT, {
            runtimeScripts: [vegaSource, vegaLiteSource, bridgeSource, reactRuntimeSource, mountScript(compiled.code)],
            theme,
            kitStylesheet: hostVariablesStylesheet(),
            config: { channel, hostOrigin: window.location.origin, manifest, theme, paletteKey, semantics },
        });
    }, [compiled, manifest, theme, paletteKey, semantics]);
    return <AppSandbox title={title} manifest={manifest} buildDocument={buildDocument} initialErrors={initialErrors}
        reloadKey={reloadKey} reserveTopRight={reserveTopRight} onAskFix={onAskFix} />;
};

export default ReactAppPreview;
