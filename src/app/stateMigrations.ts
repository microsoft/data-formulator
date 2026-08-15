// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Versioned migrations for the persisted Data Formulator state
 * (`session_state.json` on the server, IndexedDB for ephemeral, and exported
 * workspace zips — all the same JSON payload).
 *
 * `getSerializableState` stamps the current `DF_STATE_VERSION` as
 * `__stateVersion` on every save. `migrateState`, run at the top of the
 * `loadState` reducer, upgrades an older saved payload through an ordered chain
 * of pure transforms before it reaches the store. Sessions written before this
 * scheme carry no `__stateVersion` and are treated as version 0.
 *
 * Conventions:
 *  - Forward-only. Each migration bumps the version by 1 and is a pure
 *    `(state) => state` (no side effects, returns a new-enough object).
 *  - Idempotent field backfills that only ADD optional fields (e.g. `virtual`,
 *    `config` defaults, stripping a legacy field) stay inline in `loadState` —
 *    they tolerate any input and need no version. Use a numbered migration here
 *    only for STRUCTURAL rewrites that field presence can't express (e.g.
 *    moving data between collections, renaming a shape).
 *  - Bump `DF_STATE_VERSION` to match the highest `to` you add below.
 *  - No downgrade path: a state newer than this client is returned untouched
 *    (a "session is newer" guard can be added later if needed).
 */

/** Current persisted-state schema version. Bump when adding a migration. */
export const DF_STATE_VERSION = 4;

type SavedState = Record<string, any>;

/**
 * Closing answers used to live inline on a table's trigger as a `summary`
 * interaction entry; they are `explain` text turns now (design-docs/41), so the
 * thread renders one card instead of unbounded prose. Hoists any legacy entries
 * off `table` and returns the table with them stripped.
 */
function hoistSummaryToTextTurn(
    table: any,
    textTurns: any[],
    knownTurnIds: Set<string>,
): any {
    const interaction = table?.derive?.trigger?.interaction;
    if (!Array.isArray(interaction)) return table;
    const summaries = interaction.filter(
        (e: any) => e?.role === 'summary' && typeof e?.content === 'string' && e.content.trim(),
    );
    if (summaries.length === 0) return table;

    const turnId = `textTurn-summary-${table.id}`;
    if (!knownTurnIds.has(turnId)) {
        textTurns.push({
            kind: 'text',
            id: turnId,
            displayId: turnId,
            textKind: 'explain',
            content: summaries.map((e: any) => e.content.trim()).join('\n\n'),
            parentNodeId: table.id,
            createdAt: summaries[summaries.length - 1]?.timestamp ?? 0,
        });
        knownTurnIds.add(turnId);
    }
    return {
        ...table,
        derive: {
            ...table.derive,
            trigger: {
                ...table.derive.trigger,
                interaction: interaction.filter((e: any) => e?.role !== 'summary'),
            },
        },
    };
}

interface Migration {
    /** The version this migration produces; applied when `saved < to`. */
    to: number;
    migrate: (state: SavedState) => SavedState;
}

/**
 * Ordered chain of structural migrations. Append new entries with the next
 * integer `to` and bump `DF_STATE_VERSION` to match. Example (design-docs/41):
 *   { to: 1, migrate: s => convertInteractionExchangesToMessages(s) }
 */
const MIGRATIONS: Migration[] = [
    {
        // design-docs/42: text turns gain an authored thread edge
        // (`parentNodeId`). Backfill it from the legacy anchors so pre-42
        // sessions place turns correctly: a resolved turn follows the table it
        // produced, else the table it derives from.
        to: 1,
        migrate: (s) => {
            const turns = Array.isArray(s.textTurns) ? s.textTurns : undefined;
            if (!turns) return s;
            return {
                ...s,
                textTurns: turns.map((tt: any) =>
                    tt && tt.parentNodeId == null
                        ? { ...tt, parentNodeId: tt.resultTableId ?? tt.sourceTableId }
                        : tt,
                ),
            };
        },
    },
    {
        // Derived tables are reproducible workspace outputs. The legacy
        // `anchored` flag promoted some outputs into persistent roots and
        // truncated their lineage, so remove it from saved tables and drafts.
        to: 2,
        migrate: (s) => ({
            ...s,
            tables: Array.isArray(s.tables)
                ? s.tables.map(({ anchored: _anchored, ...table }: any) => table)
                : s.tables,
            draftNodes: Array.isArray(s.draftNodes)
                ? s.draftNodes.map(({ anchored: _anchored, ...draft }: any) => draft)
                : s.draftNodes,
        }),
    },
    {
        // design-docs/47: consolidate the input/derived split and semantic
        // extraction into the one v3 migration shipped during 0.8 development.
        // Prefer partially split fields when present and merge any remaining
        // legacy `tables` entries by id.
        to: 3,
        migrate: (s) => {
            const legacyTables = Array.isArray(s.tables) ? s.tables : [];
            const partialInputs = Array.isArray(s.inputTables) ? s.inputTables : [];
            const partialDerived = Array.isArray(s.derivedTables) ? s.derivedTables : [];
            const semanticsByTable = new Map<string, any>();

            for (const info of Array.isArray(s.tableSemantics) ? s.tableSemantics : []) {
                if (info?.tableId) semanticsByTable.set(info.tableId, info);
            }

            const cleanMetadata = (tableId: string, metadata: Record<string, any> | undefined) => {
                const existing = semanticsByTable.get(tableId);
                const fields = { ...(existing?.fields || {}) };
                const physicalMetadata: Record<string, any> = {};
                for (const [name, value] of Object.entries(metadata || {})) {
                    const {
                        semanticType,
                        intrinsicDomain,
                        unit,
                        displayName,
                        ...physical
                    } = value || {};
                    const hasCuratedSortOrder = Array.isArray(physical.levels)
                        && physical.levels.length > 0
                        && !Array.isArray(physical.levelCounts);
                    if (hasCuratedSortOrder) physical.levels = [];
                    physicalMetadata[name] = physical;
                    const field = {
                        ...(fields[name] || {}),
                        ...(semanticType ? { semanticType } : {}),
                        ...(intrinsicDomain ? { intrinsicDomain } : {}),
                        ...(unit ? { unit } : {}),
                        ...(displayName ? { displayName } : {}),
                        ...(hasCuratedSortOrder ? { sortOrder: value.levels } : {}),
                    };
                    if (Object.keys(field).length > 0) fields[name] = field;
                }
                if (Object.keys(fields).length > 0) {
                    semanticsByTable.set(tableId, { ...existing, tableId, fields });
                }
                return physicalMetadata;
            };

            const inputById = new Map<string, any>();
            for (const table of partialInputs) {
                if (!table?.id) continue;
                const columns = (table.snapshot?.columns || []).map((column: any) => {
                    const { name, ...metadata } = column;
                    return { name, ...cleanMetadata(table.id, { [name]: metadata })[name] };
                });
                inputById.set(table.id, { ...table, snapshot: { ...table.snapshot, columns } });
            }
            const cleanDerived = (table: any) => table && ({
                ...table,
                ...(table.metadata ? { metadata: cleanMetadata(table.id, table.metadata) } : {}),
            });
            const derivedById = new Map<string, any>(partialDerived.map((table: any) => [table.id, cleanDerived(table)]));

            for (const table of legacyTables) {
                if (!table?.id) continue;
                if (table.derive) {
                    if (!derivedById.has(table.id)) derivedById.set(table.id, cleanDerived(table));
                    continue;
                }

                if (!inputById.has(table.id)) {
                    const names = table.names?.length ? table.names : Object.keys(table.metadata || {});
                    const physicalMetadata = cleanMetadata(table.id, table.metadata);
                    const columns = names.map((name: string) => ({ name, ...(physicalMetadata[name] || {}) }));
                    inputById.set(table.id, {
                        kind: 'input-table',
                        id: table.id,
                        displayId: table.displayId || table.id,
                        source: { kind: 'workspace', tableId: table.virtual?.tableId || table.id },
                        snapshot: {
                            columns,
                            rowCount: table.virtual?.rowCount ?? table.rows?.length ?? null,
                            capturedAt: Date.now(),
                            ...(table.contentHash ? { contentHash: table.contentHash } : {}),
                        },
                        description: typeof table.description === 'string' ? table.description : '',
                        ...(table.source ? { sourceConfig: table.source } : {}),
                        addedAt: Date.now(),
                    });
                }

                cleanMetadata(table.id, table.metadata);
            }

            const { tables: _tables, ...rest } = s;
            return {
                ...rest,
                inputTables: [...inputById.values()],
                derivedTables: [...derivedById.values()],
                tableSemantics: [...semanticsByTable.values()],
                __stateVersion: 3,
            };
        },
    },
    {
        // Thread placement is represented by explicit lightweight nodes and
        // one `parentNodeId` field. Input tables remain shelf-owned data;
        // derive.trigger / derive.source remain data provenance.
        to: 4,
        migrate: (s) => {
            const loadedTableNodes = Array.isArray(s.loadedTableNodes)
                ? [...s.loadedTableNodes]
                : [];
            const knownNodeIds = new Set(loadedTableNodes.map((node: any) => node?.id));
            const textTurns = Array.isArray(s.textTurns) ? [...s.textTurns] : [];
            const knownTurnIds = new Set(textTurns.map((turn: any) => turn?.id));
            const inputTables = Array.isArray(s.inputTables)
                ? s.inputTables.map((table: any) => {
                    if (!table?.threadParentId) return table;
                    const nodeId = `loaded-table-${table.id}`;
                    if (!knownNodeIds.has(nodeId)) {
                        loadedTableNodes.push({
                            kind: 'loaded-table',
                            id: nodeId,
                            tableId: table.id,
                            parentNodeId: table.threadParentId,
                            createdAt: table.addedAt || 0,
                        });
                        knownNodeIds.add(nodeId);
                    }
                    const { threadParentId: _threadParentId, ...rest } = table;
                    return rest;
                })
                : s.inputTables;
            const generatedReports = Array.isArray(s.generatedReports)
                ? s.generatedReports.map((report: any) => {
                    if (!report) return report;
                    const {
                        summary,
                        summaryThought: _summaryThought,
                        ...rest
                    } = report;
                    const parentNodeId = rest.parentNodeId
                        ?? rest.triggerTableId
                        ?? '__rootless_thread__';
                    if (typeof summary !== 'string' || !summary.trim()) {
                        return { ...rest, parentNodeId };
                    }
                    const turnId = `textTurn-report-summary-${rest.id}`;
                    if (!knownTurnIds.has(turnId)) {
                        textTurns.push({
                            kind: 'text',
                            id: turnId,
                            displayId: turnId,
                            textKind: 'explain',
                            content: summary,
                            parentNodeId,
                            createdAt: rest.updatedAt ?? rest.createdAt ?? 0,
                        });
                        knownTurnIds.add(turnId);
                    }
                    return { ...rest, parentNodeId: turnId };
                })
                : s.generatedReports;
            return {
                ...s,
                inputTables,
                loadedTableNodes,
                derivedTables: Array.isArray(s.derivedTables)
                    ? s.derivedTables.map((table: any) => {
                        const parentNodeId = table.parentNodeId
                            ?? table.threadParentId
                            ?? table.derive?.trigger?.tableId;
                        const { threadParentId: _threadParentId, ...rest } = table;
                        const next = parentNodeId ? { ...rest, parentNodeId } : rest;
                        return hoistSummaryToTextTurn(next, textTurns, knownTurnIds);
                    })
                    : s.derivedTables,
                draftNodes: Array.isArray(s.draftNodes)
                    ? s.draftNodes.map((draft: any) => ({
                        ...draft,
                        parentNodeId: draft.parentNodeId
                            ?? draft.derive?.trigger?.tableId
                            ?? '__rootless_thread__',
                    }))
                    : s.draftNodes,
                generatedReports,
                textTurns,
                __stateVersion: 4,
            };
        },
    },
];

/**
 * Upgrade a saved state payload to `DF_STATE_VERSION`. Unversioned payloads are
 * treated as version 0. Returns the (possibly transformed) payload; the
 * `loadState` reducer then applies its idempotent field backfills on top.
 */
export function migrateState(saved: SavedState | null | undefined): SavedState {
    if (!saved || typeof saved !== 'object') return saved ?? {};
    const savedVersion = typeof saved.__stateVersion === 'number' ? saved.__stateVersion : 0;
    // Pre-release builds briefly stamped intermediate versions 3-5. They are
    // all inputs to the single released v3 schema, not distinct migrations.
    // Re-run the idempotent v4 transform when an intermediate payload still
    // carries legacy edges or lacks the loaded-reference collection.
    let from = savedVersion;
    if (savedVersion >= 3 && savedVersion <= 5) {
        if (Array.isArray(saved.tables)) from = 2;
        else {
            const needsV4 = !Array.isArray(saved.loadedTableNodes)
                || (saved.inputTables || []).some((table: any) => table?.threadParentId)
                || (saved.derivedTables || []).some((table: any) =>
                    table?.threadParentId || (table?.derive && !table?.parentNodeId))
                || (saved.draftNodes || []).some((draft: any) => !draft?.parentNodeId)
                || (saved.generatedReports || []).some((report: any) =>
                    (report?.triggerTableId && !report?.parentNodeId)
                    || report?.summary !== undefined
                    || report?.summaryThought !== undefined)
                || (saved.derivedTables || []).some((table: any) =>
                    (table?.derive?.trigger?.interaction || []).some((e: any) => e?.role === 'summary'));
            if (needsV4 || savedVersion > DF_STATE_VERSION) from = 3;
        }
    }
    if (from >= DF_STATE_VERSION) return saved;
    let migrated = saved;
    for (const m of MIGRATIONS) {
        if (m.to > from && m.to <= DF_STATE_VERSION) {
            migrated = m.migrate(migrated);
            from = m.to;
        }
    }
    return migrated;
}
