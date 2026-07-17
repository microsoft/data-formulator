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
export const DF_STATE_VERSION = 1;

type SavedState = Record<string, any>;

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
];

/**
 * Upgrade a saved state payload to `DF_STATE_VERSION`. Unversioned payloads are
 * treated as version 0. Returns the (possibly transformed) payload; the
 * `loadState` reducer then applies its idempotent field backfills on top.
 */
export function migrateState(saved: SavedState | null | undefined): SavedState {
    if (!saved || typeof saved !== 'object') return saved ?? {};
    let from = typeof saved.__stateVersion === 'number' ? saved.__stateVersion : 0;
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
