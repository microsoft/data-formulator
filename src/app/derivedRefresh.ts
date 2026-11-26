import { DictTable } from '../components/ComponentType';

/**
 * Derived tables to refresh after `changedIds` changed, in waves: a table waits until every table
 * it was computed from that is also being refreshed has gone before it. A derived table can be
 * computed from another derived table, so a change reaches the whole chain.
 */
export function derivedRefreshWaves(tables: DictTable[], changedIds: string[]): DictTable[][] {
    const derived = tables.filter(table => table.derive);
    const affected = new Set<string>();
    const reached = new Set(changedIds);
    let grew = true;
    while (grew) {
        grew = false;
        for (const table of derived) {
            if (!affected.has(table.id) && table.derive!.source.some(id => reached.has(id))) {
                affected.add(table.id);
                reached.add(table.id);
                grew = true;
            }
        }
    }

    const waves: DictTable[][] = [];
    const done = new Set<string>();
    let pending = derived.filter(table => affected.has(table.id));
    while (pending.length > 0) {
        const ready = pending.filter(table => table.derive!.source
            .every(id => id === table.id || !affected.has(id) || done.has(id)));
        // A cycle cannot be ordered; refresh the rest together rather than not at all.
        const wave = ready.length > 0 ? ready : pending;
        waves.push(wave);
        wave.forEach(table => done.add(table.id));
        pending = pending.filter(table => !done.has(table.id));
    }
    return waves;
}
