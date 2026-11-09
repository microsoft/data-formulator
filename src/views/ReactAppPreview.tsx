// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import vegaSource from '../../node_modules/vega/build/vega.min.js?raw';
import vegaLiteSource from '../../node_modules/vega-lite/build/vega-lite.min.js?raw';
import bridgeSource from '../app/htmlApp/dfAppRuntime.js?raw';
import reactRuntimeSource from 'virtual:df-react-runtime';
import { buildAppDocument } from '../app/htmlApp/htmlAppDocument';
import { compileReactApp, mountScript, type OptionalModule } from '../app/reactApp/compile';
import { dfSelectors, type DataFormulatorState } from '../app/dfSlice';
import type { Chart, DictTable, FieldItem, FieldSemanticsInfo } from '../components/ComponentType';
import { appChartSpecs } from '../app/sessionFiles';
import { appThemes, useSavedThemes } from '../app/savedThemes';
import { AppSandbox, useAppSourceResolver, useAppTheme } from './AppSandbox';
import type { Density } from '../app/reactApp/runtime/density';

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

/** Optional runtime bundles, code-split so only apps that use them load them. */
const OPTIONAL_BUNDLES: Record<OptionalModule, () => Promise<{ default: string }>> = {
    'd3': () => import('virtual:df-react-runtime/d3'),
    'lodash': () => import('virtual:df-react-runtime/lodash'),
    '@df/geo': () => import('virtual:df-react-runtime/geo'),
    '@mui/icons-material': () => import('virtual:df-react-runtime/icons'),
    'flint-links': () => import('virtual:df-react-runtime/flint-links'),
};

/** A sandboxed React app artifact (`*.app.jsx`), compiled on the host and run in the app frame. */
export const ReactAppPreview: FC<{
    source: string; title: string; reloadKey?: number; reserveTopRight?: boolean; onAskFix?: (errors: string[]) => void;
    autoFix?: boolean; onHealthy?: () => void; fixPending?: boolean;
    /** The app's density when it does not set one: 'compact' (the default) or 'normal'. */
    density?: Density;
    /** The session the app's queries read, when it is not the open one (a sample shown elsewhere). */
    workspaceId?: string;
    /** That session's tables, fields, semantics, and charts, in place of the open session's. */
    session?: { tables: DictTable[]; fields: FieldItem[]; tableSemantics: DataFormulatorState['tableSemantics']; charts: Chart[] };
}> = ({ source, title, reloadKey = 0, reserveTopRight = false, onAskFix, autoFix, onHealthy, fixPending, density, workspaceId, session }) => {
    const compiled = useMemo(() => compileReactApp(source), [source]);
    const { manifest } = compiled;
    const theme = useAppTheme();
    const resolveSource = useAppSourceResolver();
    const paletteKey = useSelector((state: DataFormulatorState) => state.config.paletteKey);
    const openTables = useSelector(dfSelectors.getAllTables);
    const openSemantics = useSelector((state: DataFormulatorState) => state.tableSemantics);
    const tables = session?.tables ?? openTables;
    const tableSemantics = session?.tableSemantics ?? openSemantics;
    const semantics = useMemo(() => {
        const byTable: Record<string, Record<string, FieldSemanticsInfo>> = {};
        for (const name of manifest.tables) {
            const table = tables.find(item => item.virtual?.tableId === name || item.id === name);
            const fields = table && tableSemantics.find(info => info.tableId === table.id)?.fields;
            if (fields) byTable[name] = fields;
        }
        return byTable;
    }, [manifest, tables, tableSemantics]);
    // The session's charts on the declared tables, which the app can draw by id.
    const openCharts = useSelector((state: DataFormulatorState) => state.charts);
    const openFields = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const sessionCharts = session?.charts ?? openCharts;
    const fields = session?.fields ?? openFields;
    const charts = useMemo(() => appChartSpecs(sessionCharts, tables, fields, manifest.tables),
        [sessionCharts, tables, fields, manifest]);
    const chartsKey = JSON.stringify(charts);
    // The user's saved themes, which the app uses by id like presets.
    const savedThemeList = useSavedThemes();
    const themes = useMemo(() => appThemes(savedThemeList), [savedThemeList]);
    // The optional modules the app uses (d3, lodash, map boundaries), loaded before it runs.
    const [optional, setOptional] = useState<{ sources: string[] } | { error: string } | null>(null);
    useEffect(() => {
        if (!compiled.ok) return;
        let cancelled = false;
        setOptional(null);
        Promise.all(compiled.optionalModules.map(name => OPTIONAL_BUNDLES[name]().then(module => module.default)))
            .then(sources => { if (!cancelled) setOptional({ sources }); })
            .catch(error => { if (!cancelled) setOptional({ error: `Could not load the app's modules: ${error instanceof Error ? error.message : String(error)}` }); });
        return () => { cancelled = true; };
    }, [compiled]);
    const initialErrors = useMemo(() => !compiled.ok ? [compiled.error] : optional && 'error' in optional ? [optional.error] : undefined,
        [compiled, optional]);
    const buildDocument = useMemo(() => {
        if (!compiled.ok || !optional || !('sources' in optional)) return null;
        return (channel: string) => buildAppDocument(APP_DOCUMENT, {
            runtimeScripts: [vegaSource, vegaLiteSource, bridgeSource, reactRuntimeSource, ...optional.sources, mountScript(compiled.code)],
            theme,
            kitStylesheet: hostVariablesStylesheet(),
            config: { channel, hostOrigin: window.location.origin, manifest, theme, paletteKey, semantics, charts, themes, density },
        });
    // `chartsKey` stands for `charts`: the app reloads only when a chart it can draw really changes.
    }, [compiled, optional, manifest, theme, paletteKey, semantics, chartsKey, themes, density]);
    return <AppSandbox title={title} manifest={manifest} buildDocument={buildDocument} initialErrors={initialErrors}
        reloadKey={reloadKey} reserveTopRight={reserveTopRight} onAskFix={onAskFix} autoFix={autoFix} onHealthy={onHealthy} fixPending={fixPending}
        resolveSource={resolveSource} workspaceId={workspaceId} />;
};

export default ReactAppPreview;
