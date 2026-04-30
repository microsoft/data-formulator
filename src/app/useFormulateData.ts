// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useSelector, useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { DataFormulatorState, dfActions, dfSelectors, fetchCodeExpl, fetchChartInsight, fetchFieldSemanticType } from './dfSlice';
import { AppDispatch } from './store';
import { Chart, FieldItem, Trigger, createDictTable, DictTable } from '../components/ComponentType';
import { getUrls, getTriggers, translateBackend } from './utils';
import { apiRequest, streamRequest } from './apiClient';
import { getErrorMessage } from './errorCodes';

export type IdeaItem = {
    text: string;
    goal: string;
    tag: 'deep-dive' | 'pivot' | 'broaden' | 'cross-data' | 'statistical' | string;
};

export interface StreamIdeasOptions {
    actionTableIds: string[];
    currentTable: DictTable;
    onIdeas: (ideas: IdeaItem[]) => void;
    onThinkingBuffer: (buffer: string) => void;
    onLoadingChange: (loading: boolean) => void;
    /** Backend progress phase updates (e.g. "building_context", "generating") */
    onProgress?: (phase: string) => void;
    /** Chart image (PNG data URL) for current visualization context */
    currentChartImage?: string | null;
    /** Sample rows from the current table */
    currentDataSample?: any[];
    /** Optional start question for idea generation */
    startQuestion?: string;
}

export interface FormulateDataOptions {
    instruction: string;
    mode: 'formulate' | 'ideate';
    actionTableIds: string[];
    currentTable: DictTable;
    overrideTableId?: string;
    currentVisualization?: any;
    expectedVisualization?: any;
    /** The chart spec to embed in the trigger for the derived table */
    triggerChart: Chart;
    /**
     * Component-specific chart creation callback.
     * Called with the candidate table, refined goal, and resolved concepts.
     * Should dispatch chart creation actions and return the focused chart ID (or undefined).
     */
    createChart: (params: {
        candidateTable: DictTable;
        refinedGoal: any;
        currentConcepts: FieldItem[];
    }) => string | undefined;
    /** Called before the request is made */
    onStarted?: () => void;
    /** Called on successful formulation */
    onSuccess?: (params: { displayInstruction: string; candidateTable: DictTable; focusedChartId?: string }) => void;
    /** Called on error */
    onError?: (error: any) => void;
    /** Called after the request completes (success or error) */
    onFinally?: () => void;
}

function generateTableId(tables: DictTable[]): string {
    let tableSuffix = Number.parseInt((Date.now() - Math.floor(Math.random() * 10000)).toString().slice(-6));
    let tableId = `table-${tableSuffix}`;
    while (tables.find(t => t.id === tableId) !== undefined) {
        tableSuffix += 1;
        tableId = `table-${tableSuffix}`;
    }
    return tableId;
}

/**
 * Shared hook for data formulation and idea streaming.
 * Used by both EncodingShelfCard (chart-aware formulation) and ChartRecBox (NL-driven formulation).
 */
export function useFormulateData() {
    const dispatch = useDispatch<AppDispatch>();
    const { t } = useTranslation();
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const config = useSelector((state: DataFormulatorState) => state.config);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const activeModel = useSelector(dfSelectors.getActiveModel);

    /**
     * Build a rich focused thread from the current table's derivation chain.
     * Each step includes: user question, display instruction, chart type + encodings,
     * created table metadata, and agent summary.
     */
    function buildFocusedThread(currentTable: DictTable): any[] {
        if (!currentTable.derive || currentTable.anchored) return [];
        const triggers = getTriggers(currentTable, tables);
        return triggers.map(trigger => {
            const resultTable = tables.find(t2 => t2.id === trigger.resultTableId);
            const instruction = trigger.interaction?.find(e => e.role === 'instruction');
            const summary = trigger.interaction?.find(e => e.role === 'summary');
            const chart = trigger.chart;
            return {
                user_question: instruction?.content,
                display_instruction: instruction?.displayContent || instruction?.content,
                agent_thinking: instruction?.plan,
                agent_summary: summary?.content,
                table_name: trigger.resultTableId,
                columns: resultTable?.names || [],
                row_count: resultTable?.rows?.length || 0,
                chart_type: chart?.chartType,
                encodings: chart?.encodingMap ? Object.fromEntries(
                    Object.entries(chart.encodingMap).filter(([, v]) => v != null && v.fieldID)
                        .map(([k, v]) => [k, v.fieldID])
                ) : {},
            };
        });
    }

    /**
     * Build a legacy exploration thread (flat table list) for backward compatibility.
     */
    function buildExplorationThread(currentTable: DictTable): any[] {
        if (!currentTable.derive || currentTable.anchored) return [];
        const triggers = getTriggers(currentTable, tables);
        return triggers.map(trigger => ({
            name: trigger.resultTableId,
            rows: tables.find(t2 => t2.id === trigger.resultTableId)?.rows,
            description: `Derive from ${tables.find(t2 => t2.id === trigger.resultTableId)?.derive?.source}`,
        }));
    }

    /**
     * Build peripheral thread summaries — sibling threads from the same source tables.
     * Each thread is summarized as: source → leaf, step count, and one-line per step.
     */
    function buildOtherThreads(currentTable: DictTable): any[] {
        // Find the root source table(s) for the current thread
        const rootIds = new Set<string>();
        if (currentTable.derive && !currentTable.anchored) {
            const triggers = getTriggers(currentTable, tables);
            if (triggers.length > 0) {
                rootIds.add(triggers[0].tableId);
            }
        } else {
            rootIds.add(currentTable.id);
        }

        // Collect all table IDs in the focused thread
        const focusedIds = new Set<string>();
        if (currentTable.derive && !currentTable.anchored) {
            const triggers = getTriggers(currentTable, tables);
            for (const t of triggers) {
                focusedIds.add(t.resultTableId);
            }
        }
        focusedIds.add(currentTable.id);

        // Find leaf tables that share the same root but are not in the focused thread
        const otherThreads: any[] = [];
        for (const table of tables) {
            if (focusedIds.has(table.id)) continue;
            if (!table.derive || table.anchored) continue;
            // Check if this table's chain leads back to the same root
            const triggers = getTriggers(table, tables);
            if (triggers.length === 0) continue;
            const thisRoot = triggers[0].tableId;
            if (!rootIds.has(thisRoot)) continue;

            // Check this is a leaf (no other table derives from it)
            const isLeaf = !tables.some(t2 => t2.derive?.trigger?.tableId === table.id && !t2.anchored);
            if (!isLeaf) continue;

            const steps = triggers.map(trigger => {
                const instr = trigger.interaction?.find(e => e.role === 'instruction');
                const chart = trigger.chart;
                let line = instr?.displayContent || instr?.content || trigger.resultTableId;
                if (chart?.chartType && chart.chartType !== 'Auto') {
                    line += ` (${chart.chartType})`;
                }
                return line;
            });

            otherThreads.push({
                source_table: thisRoot,
                leaf_table: table.id,
                step_count: triggers.length,
                steps,
            });
        }
        return otherThreads;
    }

    /**
     * Stream ideas/recommendations from the exploration agent via SSE.
     */
    async function streamIdeas(options: StreamIdeasOptions): Promise<void> {
        const {
            actionTableIds, currentTable,
            onIdeas, onThinkingBuffer, onLoadingChange, onProgress,
            currentChartImage, currentDataSample,
            startQuestion,
        } = options;

        onLoadingChange(true);
        onThinkingBuffer("");
        onIdeas([]);

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
            const focusedThread = buildFocusedThread(currentTable);
            const otherThreads = buildOtherThreads(currentTable);
            const actionTables = actionTableIds.map(id => tables.find(t => t.id === id) as DictTable);

            const messageBody = JSON.stringify({
                model: activeModel,
                input_tables: actionTables.map(t => ({
                    name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
                })),
                primary_tables: (() => {
                    if (currentTable.derive && !currentTable.anchored) {
                        return (currentTable.derive.source as string[]).map(id => {
                            const t = tables.find(tbl => tbl.id === id);
                            return t?.virtual?.tableId || id.replace(/\.[^/.]+$/, "");
                        });
                    }
                    return [currentTable.virtual?.tableId || currentTable.id.replace(/\.[^/.]+$/, "")];
                })(),
                ...(focusedThread.length > 0 ? { focused_thread: focusedThread } : {}),
                ...(otherThreads.length > 0 ? { other_threads: otherThreads } : {}),
                ...(currentChartImage ? { current_chart: currentChartImage } : {}),
                ...(startQuestion ? { start_question: startQuestion } : {}),
            });

            const engine = getUrls().GET_RECOMMENDATION_QUESTIONS;
            const controller = new AbortController();
            let timedOut = false;
            timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, config.formulateTimeoutSeconds * 1000);

            const questions: IdeaItem[] = [];
            for await (const event of streamRequest(engine, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: messageBody,
            }, controller.signal)) {
                if (event.type === 'error') {
                    throw new Error(event.error ? getErrorMessage(event.error) : t('messages.error'));
                }
                if (event.type === 'warning') {
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(), type: 'warning',
                        component: 'exploration',
                        value: (event as any).warning?.message ?? 'Warning from server',
                    }));
                    continue;
                }
                if (event.type === 'progress') {
                    onProgress?.((event as any).phase);
                    continue;
                }
                if (event.type === 'question' && (event as any).text) {
                    questions.push({
                        text: (event as any).text,
                        goal: (event as any).goal,
                        tag: (event as any).tag || 'deep-dive',
                    });
                    onIdeas([...questions]);
                    continue;
                }
                if ((event as any).text) {
                    onThinkingBuffer((event as any).text);
                }
            }
            clearTimeout(timeoutId);
            timeoutId = undefined;

            if (questions.length === 0) {
                throw new Error('No valid results returned from agent');
            }
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                if (timedOut) {
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(), type: 'warning',
                        component: 'exploration',
                        value: t('messages.agent.suggestionsTimedOut', { seconds: config.formulateTimeoutSeconds }),
                    }));
                }
            } else {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: "error",
                    component: "chart builder",
                    value: error instanceof Error ? error.message : t('messages.agent.unexpectedError'),
                    detail: error instanceof Error ? error.message : 'Unknown error',
                }));
            }
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            onLoadingChange(false);
        }
    }

    /**
     * Formulate data: send instruction to derive/refine endpoint and process the result.
     * Handles request building, dialog continuation, table/concept creation, and error handling.
     * Chart creation is delegated to the caller via the createChart callback.
     */
    async function formulateData(options: FormulateDataOptions): Promise<void> {
        const {
            instruction, mode, actionTableIds, currentTable,
            overrideTableId, currentVisualization, expectedVisualization,
            triggerChart, createChart,
            onStarted, onSuccess, onError, onFinally,
        } = options;

        if (actionTableIds.length === 0) return;

        onStarted?.();

        const actionTables = actionTableIds.map(id => tables.find(t => t.id === id) as DictTable);

        // Build input_tables payload (shared across all request variants)
        const inputTablesPayload = actionTables.map(t => ({
            name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
            rows: t.rows,
            attached_metadata: t.attachedMetadata,
        }));

        // Determine primary table names for agent context prioritization
        // For derived tables, all source tables are primary; for source tables, just the current one
        const primaryTableNames = (() => {
            if (currentTable.derive && !currentTable.anchored) {
                return (currentTable.derive.source as string[]).map(id => {
                    const t = tables.find(tbl => tbl.id === id);
                    return t?.virtual?.tableId || id.replace(/\.[^/.]+$/, "");
                });
            }
            return [currentTable.virtual?.tableId || currentTable.id.replace(/\.[^/.]+$/, "")];
        })();

        // Build base request body
        let messageBody: any = {
            mode,
            input_tables: inputTablesPayload,
            primary_tables: primaryTableNames,
            extra_prompt: instruction,
            model: activeModel,
            ...(currentVisualization ? { current_visualization: currentVisualization } : {}),
            ...(expectedVisualization ? { expected_visualization: expectedVisualization } : {}),
        };
        let engine = getUrls().DERIVE_DATA;

        // Handle dialog continuation / refinement
        if (currentTable.derive?.dialog && !currentTable.anchored) {
            const sourceTableIds = currentTable.derive.source;
            const tableIdsChanged = !sourceTableIds.every((id: string) => actionTableIds.includes(id)) ||
                !actionTableIds.every(id => sourceTableIds.includes(id));

            if (mode === 'ideate' || tableIdsChanged) {
                // Start fresh with prior dialog as additional context
                messageBody.additional_messages = currentTable.derive.dialog;
                engine = getUrls().DERIVE_DATA;
            } else {
                // Refine: continue existing dialog
                messageBody = {
                    mode,
                    input_tables: inputTablesPayload,
                    dialog: currentTable.derive.dialog,
                    latest_data_sample: currentTable.rows.slice(0, 10),
                    new_instruction: instruction,
                    model: activeModel,
                    ...(currentVisualization ? { current_visualization: currentVisualization } : {}),
                    ...(expectedVisualization ? { expected_visualization: expectedVisualization } : {}),
                };
                engine = getUrls().REFINE_DATA;
            }
        }

        const controller = new AbortController();
        let timedOut = false;
        const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, config.formulateTimeoutSeconds * 1000);

        apiRequest(engine, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(messageBody),
            signal: controller.signal,
        })
        .then(({ data }) => {
            if (!data.results || data.results.length === 0) {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "error",
                    "value": "No result is returned from the data formulation agent. Please try again.",
                }));
                onError?.(new Error("No results returned"));
                return;
            }

            const candidates = data["results"].filter((item: any) => item["status"] === "ok");

            if (candidates.length === 0) {
                const firstResult = data.results[0];
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "type": "error",
                    "component": "chart builder",
                    "value": "Data formulation failed, please try again.",
                    "code": firstResult.code,
                    "detail": translateBackend(firstResult.content, firstResult.content_code),
                    "diagnostics": firstResult.diagnostics,
                }));
                onError?.(new Error("All candidates failed"));
                return;
            }

            // Process the best candidate
            const candidate = candidates[0];
            const code = candidate["code"];
            const codeSignature = candidate["code_signature"]; // HMAC signature from server
            const rows = candidate["content"]["rows"];
            const dialog = candidate["dialog"];
            const refinedGoal = candidate['refined_goal'];
            const displayInstruction = refinedGoal["display_instruction"];

            // Determine table ID
            let candidateTableId: string;
            if (overrideTableId) {
                candidateTableId = overrideTableId;
            } else if (candidate["content"]["virtual"]) {
                candidateTableId = candidate["content"]["virtual"]["table_name"];
            } else {
                candidateTableId = generateTableId(tables);
            }

            // Create trigger
            // Resolve input table names from agent's response
            const agentInputTables: string[] = refinedGoal['input_tables'] || [];
            const resolvedSourceIds = agentInputTables.length > 0
                ? actionTableIds.filter(id => {
                    const t = tables.find(tbl => tbl.id === id);
                    if (!t) return false;
                    const name = t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, "");
                    return agentInputTables.some((n: string) => n.replace(/\.[^/.]+$/, "") === name);
                })
                : actionTableIds;
            const resolvedSourceNames = (resolvedSourceIds.length > 0 ? resolvedSourceIds : actionTableIds).map(id => {
                const t = tables.find(tbl => tbl.id === id);
                return t?.displayId || t?.virtual?.tableId || id.replace(/\.[^/.]+$/, "");
            });
            const trigger: Trigger = {
                tableId: currentTable.id,
                resultTableId: candidateTableId,
                chart: triggerChart,
                interaction: [{
                    from: 'user' as const,
                    to: 'datarec-agent' as const,
                    role: 'instruction' as const,
                    content: instruction,
                    displayContent: displayInstruction,
                    inputTableNames: resolvedSourceNames,
                    timestamp: Date.now(),
                }],
            };

            // Create candidate table with derive info
            const candidateTable = createDictTable(candidateTableId, rows, {
                code,
                codeSignature,
                outputVariable: refinedGoal['output_variable'] || 'result_df',
                source: resolvedSourceIds.length > 0 ? resolvedSourceIds : actionTableIds,
                dialog,
                trigger,
            });

            if (candidate["content"]["virtual"]) {
                candidateTable.virtual = {
                    tableId: candidate["content"]["virtual"]["table_name"],
                    rowCount: candidate["content"]["virtual"]["row_count"],
                };
            }

            // Bootstrap metadata from agent field_metadata (temporary until fetchFieldSemanticType completes)
            const fieldMetadata = refinedGoal['field_metadata'];
            if (fieldMetadata && typeof fieldMetadata === 'object') {
                for (const [fieldName, meta] of Object.entries(fieldMetadata)) {
                    if (!candidateTable.metadata[fieldName]) continue;
                    if (typeof meta === 'string') {
                        // Plain string format: { "field": "SemanticType" }
                        candidateTable.metadata[fieldName].semanticType = meta;
                    } else if (typeof meta === 'object' && meta !== null) {
                        // Dict format: { "field": { "semantic_type": "...", "unit": "...", ... } }
                        const m = meta as Record<string, any>;
                        if (m['semantic_type']) {
                            candidateTable.metadata[fieldName].semanticType = m['semantic_type'];
                        }
                        if (m['unit']) {
                            candidateTable.metadata[fieldName].unit = m['unit'];
                        }
                        if (m['intrinsic_domain']) {
                            candidateTable.metadata[fieldName].intrinsicDomain = m['intrinsic_domain'];
                        }
                    }
                }
            }

            const fieldDisplayNames = refinedGoal['field_display_names'];
            if (fieldDisplayNames && typeof fieldDisplayNames === 'object') {
                for (const [fieldName, displayName] of Object.entries(fieldDisplayNames)) {
                    if (candidateTable.metadata[fieldName] && typeof displayName === 'string') {
                        candidateTable.metadata[fieldName].displayName = displayName;
                    }
                }
            }

            // Insert or override table
            if (overrideTableId) {
                dispatch(dfActions.overrideDerivedTables(candidateTable));
            } else {
                dispatch(dfActions.insertDerivedTables(candidateTable));
            }

            // Add missing concepts
            const names = candidateTable.names;
            const missingNames = names.filter((name: string) => !conceptShelfItems.some(field => field.name === name));
            const conceptsToAdd = missingNames.map((name: string) => ({
                id: `concept-${name}-${Date.now()}`,
                name,
                source: "custom",
                tableRef: "custom",
            } as FieldItem));

            dispatch(dfActions.addConceptItems(conceptsToAdd));
            dispatch(fetchFieldSemanticType(candidateTable));
            dispatch(fetchCodeExpl(candidateTable));

            // Compute current concepts for chart creation
            const currentConcepts = [...conceptShelfItems.filter(c => names.includes(c.name)), ...conceptsToAdd];

            // Delegate chart creation to the caller
            const focusedChartId = createChart({ candidateTable, refinedGoal, currentConcepts });

            if (focusedChartId) {
                dispatch(fetchChartInsight({ chartId: focusedChartId, tableId: candidateTable.id }) as any);
            }

            onSuccess?.({ displayInstruction, candidateTable, focusedChartId });
        })
        .catch((error) => {
            if (error.name === 'AbortError') {
                if (timedOut) {
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(),
                        component: "chart builder",
                        type: "warning",
                        value: t('messages.agent.formulationTimedOut', { seconds: config.formulateTimeoutSeconds }),
                    }));
                }
            } else {
                console.error(error);
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    component: "chart builder",
                    type: "error",
                    value: t('messages.agent.unexpectedError'),
                    detail: error.message,
                }));
            }
            onError?.(error);
        })
        .finally(() => {
            clearTimeout(timeoutId);
            onFinally?.();
        });
    }

    return { streamIdeas, formulateData };
}
