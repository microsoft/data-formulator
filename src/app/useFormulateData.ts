// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useSelector, useDispatch } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors, fetchCodeExpl, fetchChartInsight, fetchFieldSemanticType } from './dfSlice';
import { AppDispatch } from './store';
import { Chart, FieldItem, Trigger, createDictTable, DictTable } from '../components/ComponentType';
import { getUrls, getTriggers, fetchWithIdentity } from './utils';

export type IdeaItem = {
    text: string;
    goal: string;
    difficulty: 'easy' | 'medium' | 'hard';
    tag?: string;
};

export interface StreamIdeasOptions {
    actionTableIds: string[];
    currentTable: DictTable;
    onIdeas: (ideas: IdeaItem[]) => void;
    onThinkingBuffer: (buffer: string) => void;
    onLoadingChange: (loading: boolean) => void;
    /** Chart image (PNG data URL) for current visualization context */
    currentChartImage?: string | null;
    /** Sample rows from the current table */
    currentDataSample?: any[];
    /** Optional start question for idea generation */
    startQuestion?: string;
    /** If true, only blocks with type==="question" are included (default: false) */
    filterByType?: boolean;
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
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const config = useSelector((state: DataFormulatorState) => state.config);
    const agentRules = useSelector((state: DataFormulatorState) => state.agentRules);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const activeModel = useSelector(dfSelectors.getActiveModel);

    /**
     * Build an exploration thread from the current table's derivation chain.
     */
    function buildExplorationThread(currentTable: DictTable): any[] {
        if (!currentTable.derive || currentTable.anchored) return [];
        const triggers = getTriggers(currentTable, tables);
        return triggers.map(trigger => ({
            name: trigger.resultTableId,
            rows: tables.find(t2 => t2.id === trigger.resultTableId)?.rows,
            description: `Derive from ${tables.find(t2 => t2.id === trigger.resultTableId)?.derive?.source} with instruction: ${trigger.instruction}`,
        }));
    }

    /**
     * Stream ideas/recommendations from the exploration agent via SSE.
     */
    async function streamIdeas(options: StreamIdeasOptions): Promise<void> {
        const {
            actionTableIds, currentTable,
            onIdeas, onThinkingBuffer, onLoadingChange,
            currentChartImage, currentDataSample,
            startQuestion, filterByType = false,
        } = options;

        onLoadingChange(true);
        onThinkingBuffer("");
        onIdeas([]);

        try {
            const explorationThread = buildExplorationThread(currentTable);
            const actionTables = actionTableIds.map(id => tables.find(t => t.id === id) as DictTable);

            const messageBody = JSON.stringify({
                token: String(Date.now()),
                model: activeModel,
                mode: 'interactive',
                input_tables: actionTables.map(t => ({
                    name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
                    rows: t.rows,
                    attached_metadata: t.attachedMetadata,
                })),
                exploration_thread: explorationThread,
                agent_exploration_rules: agentRules.exploration,
                ...(currentDataSample ? { current_data_sample: currentDataSample } : {}),
                ...(currentChartImage ? { current_chart: currentChartImage } : {}),
                ...(startQuestion ? { start_question: startQuestion } : {}),
            });

            const engine = getUrls().GET_RECOMMENDATION_QUESTIONS;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.formulateTimeoutSeconds * 1000);

            const response = await fetchWithIdentity(engine, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: messageBody,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body reader available');
            }

            const decoder = new TextDecoder();
            let lines: string[] = [];
            let buffer = '';

            const updateState = (currentLines: string[]) => {
                const dataBlocks = currentLines
                    .map(line => { try { return JSON.parse(line.trim()); } catch (e) { return null; } })
                    .filter(block => block != null);

                const questions = (filterByType ? dataBlocks.filter((block: any) => block.type === "question") : dataBlocks)
                    .map((block: any) => ({
                        text: block.text,
                        goal: block.goal,
                        difficulty: block.difficulty,
                        tag: block.tag,
                    }));

                onIdeas(questions);
            };

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const newLines = buffer.split('data: ').filter(line => line.trim() !== "");
                    buffer = newLines.pop() || '';
                    if (newLines.length > 0) {
                        lines.push(...newLines);
                        updateState(lines);
                    }
                    onThinkingBuffer(buffer.replace(/^data: /, ""));
                }
            } finally {
                reader.releaseLock();
            }

            lines.push(buffer);
            updateState(lines);

            if (lines.length === 0) {
                throw new Error('No valid results returned from agent');
            }
        } catch (error) {
            dispatch(dfActions.addMessages({
                "timestamp": Date.now(),
                "type": "error",
                "component": "chart builder",
                "value": "Failed to get ideas from the exploration agent. Please try again.",
                "detail": error instanceof Error ? error.message : 'Unknown error',
            }));
        } finally {
            onLoadingChange(false);
        }
    }

    /**
     * Formulate data: send instruction to derive/refine endpoint and process the result.
     * Handles request building, dialog continuation, table/concept creation, and error handling.
     * Chart creation is delegated to the caller via the createChart callback.
     */
    function formulateData(options: FormulateDataOptions): void {
        const {
            instruction, mode, actionTableIds, currentTable,
            overrideTableId, currentVisualization, expectedVisualization,
            triggerChart, createChart,
            onStarted, onSuccess, onError, onFinally,
        } = options;

        if (actionTableIds.length === 0) return;

        onStarted?.();

        const actionTables = actionTableIds.map(id => tables.find(t => t.id === id) as DictTable);
        const token = String(Date.now());

        // Build input_tables payload (shared across all request variants)
        const inputTablesPayload = actionTables.map(t => ({
            name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
            rows: t.rows,
            attached_metadata: t.attachedMetadata,
        }));

        // Build base request body
        let messageBody: any = {
            token,
            mode,
            input_tables: inputTablesPayload,
            extra_prompt: instruction,
            model: activeModel,
            agent_coding_rules: agentRules.coding,
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
                    token,
                    mode,
                    input_tables: inputTablesPayload,
                    dialog: currentTable.derive.dialog,
                    latest_data_sample: currentTable.rows.slice(0, 10),
                    new_instruction: instruction,
                    model: activeModel,
                    agent_coding_rules: agentRules.coding,
                    ...(currentVisualization ? { current_visualization: currentVisualization } : {}),
                    ...(expectedVisualization ? { expected_visualization: expectedVisualization } : {}),
                };
                engine = getUrls().REFINE_DATA;
            }
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.formulateTimeoutSeconds * 1000);

        fetchWithIdentity(engine, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(messageBody),
            signal: controller.signal,
        })
        .then((response: Response) => {
            if (!response.ok) {
                return response.text().then(text => {
                    try {
                        const errorData = JSON.parse(text);
                        throw new Error(errorData.error_message || errorData.error || `Server error (${response.status})`);
                    } catch (parseError) {
                        if (parseError instanceof SyntaxError) {
                            throw new Error(`Server error (${response.status}): The server returned an unexpected response.`);
                        }
                        throw parseError;
                    }
                });
            }
            return response.json();
        })
        .then((data) => {
            if (data.status === "error" && data.error_message) {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "error",
                    "value": `Data formulation failed: ${data.error_message}`,
                }));
                onError?.(new Error(data.error_message));
                return;
            }

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

            if (data["token"] !== token) {
                onError?.(new Error("Token mismatch"));
                return;
            }

            const candidates = data["results"].filter((item: any) => item["status"] === "ok");

            if (candidates.length === 0) {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "type": "error",
                    "component": "chart builder",
                    "value": "Data formulation failed, please try again.",
                    "code": data.results[0].code,
                    "detail": data.results[0].content,
                    "diagnostics": data.results[0].diagnostics,
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
            const trigger: Trigger = {
                tableId: currentTable.id,
                instruction,
                displayInstruction,
                chart: triggerChart,
                resultTableId: candidateTableId,
            };

            // Create candidate table with derive info
            const candidateTable = createDictTable(candidateTableId, rows, {
                code,
                codeSignature,
                outputVariable: refinedGoal['output_variable'] || 'result_df',
                source: actionTableIds,
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

            // Auto-generate chart insight after rendering
            if (focusedChartId) {
                const chartIdForInsight = focusedChartId;
                setTimeout(() => {
                    dispatch(fetchChartInsight({ chartId: chartIdForInsight, tableId: candidateTable.id }) as any);
                }, 1500);
            }

            onSuccess?.({ displayInstruction, candidateTable, focusedChartId });
        })
        .catch((error) => {
            if (error.name === 'AbortError') {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "error",
                    "value": `Data formulation timed out after ${config.formulateTimeoutSeconds} seconds. Consider breaking down the task, using a different model or prompt, or increasing the timeout limit.`,
                    "detail": "Request exceeded timeout limit",
                }));
            } else {
                console.error(error);
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "error",
                    "value": "Data formulation failed, please try again.",
                    "detail": error.message,
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
