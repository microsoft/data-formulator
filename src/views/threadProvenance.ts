import type { DictTable, TextTurn, Trigger } from '../components/ComponentType';

export function resolveThreadParentTableId(
    table: DictTable,
    tables: DictTable[],
    textTurns: TextTurn[],
): string | undefined {
    const tableIds = new Set(tables.map(candidate => candidate.id));
    const turnsById = new Map(textTurns.map(turn => [turn.id, turn]));
    let parentId = table.parentNodeId;
    const seen = new Set<string>();

    while (parentId && !seen.has(parentId)) {
        if (tableIds.has(parentId)) return parentId;
        seen.add(parentId);
        parentId = turnsById.get(parentId)?.parentNodeId;
    }

    return table.derive?.trigger.tableId;
}

export function getThreadTriggers(
    leafTable: DictTable,
    tables: DictTable[],
    textTurns: TextTurn[],
): Trigger[] {
    const tablesById = new Map(tables.map(table => [table.id, table]));
    const triggers: Trigger[] = [];
    const seen = new Set<string>();
    let table: DictTable | undefined = leafTable;

    while (table?.derive && !seen.has(table.id)) {
        seen.add(table.id);
        const parentTableId = resolveThreadParentTableId(table, tables, textTurns);
        triggers.unshift({
            ...table.derive.trigger,
            tableId: parentTableId || table.derive.trigger.tableId,
        });
        table = parentTableId ? tablesById.get(parentTableId) : undefined;
    }

    return triggers;
}

export function isThreadLeafTable(
    table: DictTable,
    tables: DictTable[],
    textTurns: TextTurn[],
): boolean {
    return !tables.some(candidate => candidate.derive
        && resolveThreadParentTableId(candidate, tables, textTurns) === table.id);
}