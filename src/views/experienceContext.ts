// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * experienceContext — pure helpers that turn DataFormulator state into
 * the timeline payload sent to `/api/knowledge/distill-experience`.
 *
 * No React, no Redux. Used by:
 *   - SessionDistill.collectSessionThreads (live distillation)
 *   - SessionDistill EventRow rendering (constants + tool-arg formatter)
 *
 * See design-docs/21.3-distill-payload-vs-preview-alignment.md and
 * design-docs/24-session-scoped-distillation.md.
 */

import type { Chart, DictTable, FieldItem } from '../components/ComponentType';
import type { ModelConfig } from '../app/dfSlice';

// ---------------------------------------------------------------------------
// Public limits — keep in sync with backend `_truncate` defaults.
// ---------------------------------------------------------------------------

export const MESSAGE_CONTENT_LIMIT = 500;
export const TOOL_ARGS_LIMIT = 600;
export const SAMPLE_ROW_COUNT = 5;

/** Tools whose `args` body is actual code and reads better in monospace. */
export const TOOL_USES_CODE_FONT = new Set(['explore', 'build_loader', 'visualize', 'transform']);

// ---------------------------------------------------------------------------
// Leaf detection
// ---------------------------------------------------------------------------

/**
 * True leaf: derived table with no un-anchored children deriving from it.
 * Layout-promoted "extra leaves" in DataThread still have children, so they
 * won't pass this check.
 */
export function isLeafDerivedTable(table: DictTable, tables: DictTable[]): boolean {
    if (!table.derive) return false;
    return !tables.some(
        t => t.derive?.trigger.tableId === table.id && !t.anchored,
    );
}

/**
 * Walk the visible chain from `leaf` back to the root source table,
 * collecting only tables that still exist in `tables`.
 * Returns the chain ordered root-first.
 */
function walkVisibleChain(leaf: DictTable, tables: DictTable[]): DictTable[] {
    const chain: DictTable[] = [leaf];
    const visited = new Set<string>([leaf.id]);
    let current = leaf;
    while (current.derive) {
        const parentId = current.derive.trigger.tableId;
        if (visited.has(parentId)) break;
        visited.add(parentId);
        const parent = tables.find(t => t.id === parentId);
        if (!parent) break;
        chain.push(parent);
        if (!parent.derive) break;
        current = parent;
    }
    chain.reverse();
    return chain;
}

// ---------------------------------------------------------------------------
// Tool-call formatting
// ---------------------------------------------------------------------------

/**
 * Render a parsed JSON value as readable text (no JSON syntax noise).
 *   "hello"            → "hello"
 *   ["a", "b"]         → "a, b"
 *   { x: 1 }           → "x: 1"
 *   { a: 1, b: [2,3] } → "a: 1\nb: 2, 3"
 * Nested objects fall back to compact JSON to keep the preview bounded.
 */
function renderJsonValue(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
        const allScalar = v.every(x =>
            x != null && (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean'),
        );
        if (allScalar) return v.map(String).join(', ');
        try { return JSON.stringify(v); } catch { return String(v); }
    }
    if (typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        const keys = Object.keys(obj);
        // Single-key object: drop the key — the tool name already implies it.
        if (keys.length === 1) return renderJsonValue(obj[keys[0]]);
        return keys.map(k => `${k}: ${renderJsonValue(obj[k])}`).join('\n');
    }
    return String(v);
}

/**
 * Format the body of a single tool block for display.
 * - Strips an optional ```lang … ``` fence.
 * - JSON bodies are parsed and rendered via `renderJsonValue` so the user
 *   sees readable values, not raw JSON syntax.
 * - Code bodies (python, sql, …) are returned verbatim for the monospace lane.
 */
function formatToolBody(rawBody: string): string {
    let body = rawBody.trim();
    if (!body) return '';

    // Strip a wrapping fence if present. Tolerates trailing whitespace.
    const fence = body.match(/^```([a-zA-Z]*)\s*\n([\s\S]*?)\n```\s*$/);
    let lang = '';
    if (fence) {
        lang = fence[1].toLowerCase();
        body = fence[2].trim();
    }

    // JSON body → render parsed value as plain text.
    if (lang === 'json' || (body.startsWith('{') && body.endsWith('}'))) {
        try {
            const parsed = JSON.parse(body);
            return renderJsonValue(parsed).trim();
        } catch { /* fall through and return body as-is */ }
    }
    return body;
}

/**
 * Split a dialog `content` blob into one entry per tool call, preserving
 * order. Backend serializes assistant tool calls as
 *
 *     [tool: name1]\n```json\n{...}\n```\n\n[tool: name2]\n```python\n...```
 *
 * (see data_agent._snapshot_dialog). The naive regex approach broke on the
 * 2nd+ block because end-of-string anchors only matched the last fence.
 *
 * Returns `[]` when the content has no tool blocks.
 */
function extractToolCallsFromDialogContent(
    content: unknown,
): Array<{ name: string; args?: string }> {
    const text = content == null ? '' : String(content);
    if (!text.includes('[tool:')) return [];

    const headerRe = /(^|\n)\[tool:\s*([^\]\n]+)\]\s*\n?/g;
    const matches: Array<{ name: string; headerStart: number; bodyStart: number }> = [];
    for (let m = headerRe.exec(text); m !== null; m = headerRe.exec(text)) {
        const headerStart = m.index + (m[1] ? m[1].length : 0);
        matches.push({ name: m[2].trim(), headerStart, bodyStart: m.index + m[0].length });
    }
    if (matches.length === 0) return [];

    const out: Array<{ name: string; args?: string }> = [];
    for (let i = 0; i < matches.length; i++) {
        const { name, bodyStart } = matches[i];
        const bodyEnd = i + 1 < matches.length ? matches[i + 1].headerStart : text.length;
        if (!name) continue;
        const args = formatToolBody(text.slice(bodyStart, bodyEnd));
        out.push(args ? { name, args } : { name });
    }
    return out;
}

/**
 * Truncate plain text to `limit` chars (with ellipsis). Mirrors backend
 * `_truncate`. Used for `Message.content`.
 */
function truncateText(value: unknown, limit = 500): string {
    const text = value == null ? '' : String(value);
    return text.length <= limit ? text : text.slice(0, limit) + '...';
}

/**
 * Vega/encoding-channel summary for a chart, e.g.
 * "x=region(nominal), y=sales [sum]".
 */
function chartEncodingSummary(
    chart: any,
    fieldNameById: Record<string, string> = {},
): string | undefined {
    const map = chart?.encodingMap;
    if (!map || typeof map !== 'object') return undefined;
    const parts: string[] = [];
    for (const [channel, enc] of Object.entries(map as Record<string, any>)) {
        if (!enc || !enc.fieldID) continue;
        const name = fieldNameById[enc.fieldID] || enc.fieldID;
        let s = `${channel}=${name}`;
        if (enc.dtype) s += `(${enc.dtype})`;
        if (enc.aggregate) s += ` [${enc.aggregate}]`;
        parts.push(s);
    }
    return parts.length > 0 ? parts.join(', ') : undefined;
}

// ---------------------------------------------------------------------------
// Per-thread event builder
// ---------------------------------------------------------------------------

/**
 * Build the chronological event list for a single visible chain ending at
 * `leaf`. Returns `null` when the chain has no user-originated message
 * (no useful signal to distill).
 *
 * `charts` is the live `state.charts` array. When a step has a real
 * materialized chart, we prefer its actual `chartType` + `encodingMap`
 * over the trigger's *intent* (which is often `chartType: 'auto'`).
 */
export function buildLeafEvents(
    leaf: DictTable,
    tables: DictTable[],
    charts: Chart[] = [],
    conceptShelfItems: FieldItem[] = [],
): Array<Record<string, any>> | null {
    if (!leaf.derive) return null;

    const fieldNameById: Record<string, string> = {};
    for (const f of conceptShelfItems) {
        if (f?.id && f.name) fieldNameById[f.id] = f.name;
    }

    const chain = walkVisibleChain(leaf, tables);
    const events: Array<Record<string, any>> = [];
    let sawUserMessage = false;

    for (const step of chain) {
        const stepDerive = step.derive;
        if (!stepDerive) continue; // root, no events to emit

        const interaction = stepDerive.trigger.interaction || [];
        const userEntries = interaction.filter(e => e.from === 'user' && e.role !== 'error');
        const agentEntries = interaction.filter(e => e.from !== 'user' && e.role !== 'error');

        const pushInteractionEntry = (entry: typeof interaction[number]) => {
            const raw = entry.content ?? '';
            if (!raw || !String(raw).trim()) return;
            if (entry.from === 'user') sawUserMessage = true;
            events.push({
                type: 'message',
                from: entry.from,
                to: entry.to,
                role: entry.role,
                content: truncateText(raw, MESSAGE_CONTENT_LIMIT),
            });
        };

        // 1. User-originated entries.
        for (const entry of userEntries) pushInteractionEntry(entry);

        // 2. Tool calls (dialog).
        for (const msg of stepDerive.dialog || []) {
            const calls = extractToolCallsFromDialogContent((msg as any)?.content);
            for (const tc of calls) {
                events.push({
                    type: 'message',
                    from: 'data-agent',
                    to: 'data-agent',
                    role: 'tool_call',
                    content: tc.name,
                    ...(tc.args ? { args: truncateText(tc.args, TOOL_ARGS_LIMIT) } : {}),
                });
            }
        }

        // 3. Agent-originated entries.
        for (const entry of agentEntries) pushInteractionEntry(entry);

        // 4. CreateTable side-effect.
        const rows = Array.isArray(step.rows) ? step.rows : [];
        events.push({
            type: 'create_table',
            table_id: step.displayId || step.id,
            source_tables: [...(stepDerive.source || [])],
            columns: [...(step.names || [])],
            row_count: step.virtual?.rowCount ?? rows.length,
            sample_rows: rows.slice(0, SAMPLE_ROW_COUNT).map(r =>
                r && typeof r === 'object' ? { ...r } : { value: r },
            ),
            ...(stepDerive.code ? { code: stepDerive.code } : {}),
        });

        // 5. CreateChart side-effect.
        const materialized = charts.find(c => c.tableRef === step.id);
        const intent = stepDerive.trigger.chart as any;
        const chart: any = materialized ?? intent;
        const mark = chart?.chartType || chart?.mark || chart?.chart_type;
        if (mark && mark !== 'auto') {
            const encodingSummary = chartEncodingSummary(chart, fieldNameById);
            events.push({
                type: 'create_chart',
                related_table_id: step.displayId || step.id,
                mark_or_type: String(mark),
                ...(encodingSummary ? { encoding_summary: encodingSummary } : {}),
            });
        }
    }

    if (!sawUserMessage) return null;
    return events;
}

// ---------------------------------------------------------------------------
// Model config
// ---------------------------------------------------------------------------

export function buildDistillModelConfig(selectedModel: ModelConfig): Record<string, any> {
    return {
        id: selectedModel.id,
        endpoint: selectedModel.endpoint,
        api_key: selectedModel.api_key,
        api_base: selectedModel.api_base,
        api_version: selectedModel.api_version,
        model: selectedModel.model,
        is_global: selectedModel.is_global,
    };
}
