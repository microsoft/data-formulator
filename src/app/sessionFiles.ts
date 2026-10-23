// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The browser side of the agent's session layer (design-docs/61): the state sent
 * with a request, and applying the chart and report edits the server accepted
 * (`session_update` in an edit_file result). The views themselves are built on the
 * server (py-src/data_formulator/analyst/session_layer).
 */

import type { Chart, DictTable, FieldItem } from '../components/ComponentType';
import { computeInsightKey } from '../components/ComponentType';
import { resolveChartFields } from './chartRecommendation';
import { dfActions, dfSelectors, generateFreshChart, type DataFormulatorState } from './dfSlice';

export interface ChartFileSpec {
    chart_type: string;
    table: string;
    title?: string;
    subtitle?: string;
    encodings: Record<string, { field: string; type?: string; aggregate?: string; sortOrder?: string; sortBy?: string; scheme?: string }>;
    config?: Record<string, unknown>;
    theme?: string;
}

/** An edit the server accepted, with the version it was made against (`base`). */
export type SessionUpdate =
    | { kind: 'chart'; id: string; spec: ChartFileSpec; base?: ChartFileSpec }
    | { kind: 'report'; id: string; content: string; base?: string };

export type SessionUpdateResult = { applied: true; name: string } | { applied: false; name?: string; reason: 'missing' | 'changed' };

/** JSON with sorted keys, so specs compare by content. */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

const workspaceName = (table: DictTable) => table.virtual?.tableId || table.id;

/** A chart as the agent edits it; must match `chart_spec` in session_layer/layer.py (shared fixture). */
export function chartFileSpec(chart: Chart, table: DictTable, fields: FieldItem[]): ChartFileSpec {
    const encodings: ChartFileSpec['encodings'] = {};
    for (const [channel, encoding] of Object.entries(chart.encodingMap || {})) {
        const field = encoding?.fieldID ? fields.find(item => item.id === encoding.fieldID) : undefined;
        if (!field) continue;
        encodings[channel] = {
            field: field.name,
            ...(encoding.dtype ? { type: encoding.dtype } : {}),
            ...(encoding.aggregate ? { aggregate: encoding.aggregate } : {}),
            ...(encoding.sortOrder ? { sortOrder: encoding.sortOrder } : {}),
            ...(encoding.sortBy ? { sortBy: encoding.sortBy } : {}),
            ...(encoding.scheme ? { scheme: encoding.scheme } : {}),
        };
    }
    return {
        chart_type: chart.chartType,
        table: workspaceName(table),
        ...(chart.title ? { title: chart.title } : {}),
        ...(chart.subtitle ? { subtitle: chart.subtitle } : {}),
        encodings,
        ...(chart.config && Object.keys(chart.config).length ? { config: chart.config } : {}),
        ...(chart.themeId ? { theme: chart.themeId } : {}),
    };
}

/** State the agent's session layer is built from (py-src/.../analyst/session_layer/state.py keeps the same keys). */
const AGENT_STATE_KEYS = [
    'inputTables', 'derivedTables', 'loadedTableNodes', 'fileNodes', 'artifactSets', 'externalTableReferences',
    'tableSemantics', 'draftNodes', 'charts', 'conceptShelfItems', 'focusedId', 'generatedReports', 'textTurns',
] as const;

/**
 * The session state sent with an agent request (design-docs/61): the allow-listed fields, without
 * preview rows (the server reads table data from the workspace), and `focus`, what the user had in
 * view when they asked. Saving is unaffected.
 */
export function agentSessionState(state: DataFormulatorState, focus: DataFormulatorState['focusedId'] = state.focusedId): Record<string, unknown> {
    const result: Record<string, unknown> = Object.fromEntries(AGENT_STATE_KEYS.map(key => [key, state[key]]));
    // Starting a run moves focus to its draft; the agent needs what the user had in view when they asked.
    result.focusedId = focus ?? null;
    result.derivedTables = state.derivedTables.map(({ rows: _rows, ...table }) => table);
    result.activeWorkspace = state.activeWorkspace ? { id: state.activeWorkspace.id, displayName: state.activeWorkspace.displayName } : null;
    return result;
}

/**
 * Apply an edit the server accepted. The agent edited the version it was sent; if the
 * chart or report has changed since (the user edited it during the run), the edit is
 * not applied, so it never overwrites the newer change.
 */
export function applySessionUpdate(update: SessionUpdate, dispatch: (action: any) => unknown, getState: () => DataFormulatorState): SessionUpdateResult {
    const state = getState();
    if (update.kind === 'report') {
        const report = state.generatedReports.find(item => item.id === update.id);
        if (!report) return { applied: false, reason: 'missing' };
        const title = update.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
        if (update.base !== undefined && update.base !== report.content) {
            return { applied: false, name: report.title || report.id, reason: 'changed' };
        }
        dispatch(dfActions.updateGeneratedReportContent({ id: update.id, content: update.content, ...(title ? { title } : {}) }));
        return { applied: true, name: title || report.title || report.id };
    }
    const chart = dfSelectors.getAllCharts(state).find(item => item.id === update.id);
    const table = chart && dfSelectors.getAllTables(state).find(item => item.id === chart.tableRef);
    if (!chart || !table) return { applied: false, reason: 'missing' };
    if (update.base && canonical(chartFileSpec(chart, table, state.conceptShelfItems)) !== canonical(update.base)) {
        return { applied: false, name: chart.title || chart.id, reason: 'changed' };
    }
    const spec = update.spec;
    const concepts = table.names
        .filter(name => !state.conceptShelfItems.some(field => field.name === name))
        .map(name => ({ id: `concept-${name}-${Date.now()}-${Math.random()}`, name, source: 'custom', tableRef: 'custom' }) as FieldItem);
    const fields = [...state.conceptShelfItems.filter(field => table.names.includes(field.name)), ...concepts];
    const next: Chart = { ...generateFreshChart(chart.tableRef, spec.chart_type), id: chart.id, source: chart.source };
    resolveChartFields(next, fields, spec.encodings, table);
    next.config = spec.config ? { ...spec.config } : undefined;
    next.title = spec.title;
    next.subtitle = spec.subtitle;
    next.themeId = spec.theme;
    next.titleKey = spec.title || spec.subtitle ? computeInsightKey(next) : undefined;
    dispatch(dfActions.replaceChartSpec({ chart: next, concepts }));
    return { applied: true, name: spec.title || `${spec.chart_type} of ${table.displayId || spec.table}` };
}
