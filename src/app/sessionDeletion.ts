// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Applying a deletion the agent made (see py-src/data_formulator/analyst/deletion.py):
 * the server works out everything a deletion removes from the session layer and
 * refuses one that would leave a dependent broken; the returned plan is applied here.
 */

import { dfActions, type DataFormulatorState } from './dfSlice';

export interface DeletionPlan {
    tables: { id: string; node_id: string; name: string; origin?: string; because?: string }[];
    charts: { id: string; name: string; table?: string; because?: string }[];
    references: { id: string; name: string }[];
    /** Workspace files the server already deleted. */
    files?: { path: string; name: string }[];
}

/** Delete what the server planned; returns the names of what was deleted. */
export function applySessionDeletion(
    plan: DeletionPlan,
    dispatch: (action: any) => unknown,
    getState: () => DataFormulatorState,
): string[] {
    const deleted: string[] = [];
    for (const file of plan.files || []) {
        dispatch(dfActions.removeFileNodes(file.name));
        deleted.push(`files/${file.name}`);
    }
    for (const reference of plan.references) {
        if (!getState().externalTableReferences.some(item => item.id === reference.id)) continue;
        dispatch(dfActions.removeExternalTableReference(reference.id));
        deleted.push(reference.name);
    }
    // Charts named on their own; a named table's charts go with it.
    const namedTableIds = new Set(plan.tables.filter(table => !table.because).map(table => table.node_id));
    const chartIds = plan.charts.filter(chart => !chart.because && !(chart.table && namedTableIds.has(chart.table))).map(chart => chart.id);
    const existingCharts = new Set(getState().charts.map(chart => chart.id));
    for (const chart of plan.charts) {
        if (chartIds.includes(chart.id) && existingCharts.has(chart.id)) {
            dispatch(dfActions.deleteChartById(chart.id));
            deleted.push(chart.name);
        }
    }
    for (const table of plan.tables) {
        const state = getState();
        const exists = state.inputTables.some(item => item.id === table.node_id) || state.derivedTables.some(item => item.id === table.node_id);
        // A derived table that went with its last chart is already gone.
        if (exists) dispatch(dfActions.deleteTable(table.node_id));
        if (exists || table.because) deleted.push(table.name);
    }
    return deleted;
}
