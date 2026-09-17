import { createConversationRootId, isConversationRootId, type DictTable, type TextTurn, type Trigger, type LoadedTableNode, type FileNode, type ComputationInputSource } from '../components/ComponentType';

export function resolveArtifactParentNodeId(parentNodeId: string | undefined, artifacts: { id: string; parentNodeId?: string }[]): string | undefined {
    const seen = new Set<string>();
    let current = parentNodeId;
    while (current && !seen.has(current)) {
        seen.add(current);
        const artifact = artifacts.find(node => node.id === current);
        if (!artifact) return current;
        current = artifact.parentNodeId;
    }
    return undefined;
}

export function orderThreadOutputs<Item extends { outputNodeId?: string }>(items: Item[], turns: TextTurn[]): Item[] {
    const result = [...items];
    for (const turn of turns) {
        if (!turn.outputIds?.length) continue;
        const positions = new Map(turn.outputIds.map((id, index) => [id, index]));
        const slots = result.flatMap((item, index) => item.outputNodeId && positions.has(item.outputNodeId) ? [index] : []);
        const ordered = slots.map(index => result[index]).sort((first, second) => positions.get(first.outputNodeId!)! - positions.get(second.outputNodeId!)!);
        slots.forEach((slot, index) => { result[slot] = ordered[index]; });
    }
    return result;
}

export function getConversationInputContext(
    parentNodeId: string | undefined,
    tables: DictTable[],
    turns: TextTurn[],
    loadedNodes: LoadedTableNode[] = [],
    fileNodes: FileNode[] = [],
): ComputationInputSource[] {
    const sources = new Map<string, ComputationInputSource>();
    const tablesById = new Map(tables.map(table => [table.id, table]));
    const turnsById = new Map(turns.map(turn => [turn.id, turn]));
    const addTable = (table: DictTable) => {
        sources.set(`data:${table.id}`, { id: table.id, kind: 'data', displayName: table.displayId || table.id });
        for (const source of table.dataProvenance?.inputSources || table.derive?.inputSources || (table.derive?.source || []).map(id => ({ id, kind: 'data' as const, displayName: id }))) {
            sources.set(`${source.kind}:${source.id}`, source);
        }
    };
    const seen = new Set<string>();
    let current = parentNodeId;
    while (current && !seen.has(current)) {
        seen.add(current);
        for (const node of loadedNodes.filter(node => node.parentNodeId === current)) {
            const table = tablesById.get(node.tableId);
            if (table) addTable(table);
        }
        for (const node of fileNodes.filter(node => node.parentNodeId === current || node.id === current)) {
            sources.set(`file:${node.path}`, { id: node.path, kind: 'file', displayName: node.path });
        }
        const turn = turnsById.get(current);
        const table = tablesById.get(current);
        if (table) addTable(table);
        current = turn?.parentNodeId
            || table?.parentNodeId
            || loadedNodes.find(node => node.tableId === current || node.id === current)?.parentNodeId
            || fileNodes.find(node => node.id === current)?.parentNodeId
            || table?.derive?.trigger.tableId;
    }
    return [...sources.values()];
}

export function getConversationSourceKey(source: ComputationInputSource, tables: DictTable[]): string {
    if (source.kind === 'file') return `file:${source.displayName.replace(/^\/?scratch\//, '')}`;
    const table = tables.find(table => table.id === source.id || table.virtual?.tableId === source.id
        || table.id === source.displayName || table.virtual?.tableId === source.displayName);
    return `data:${table?.id || source.id}`;
}

function getThreadParentNodeId(
    table: DictTable,
): string | undefined {
    if (!table.derive) return table.parentNodeId;
    return table.parentNodeId || createConversationRootId(table.id);
}

export function getThreadLeadUpTurns(
    table: DictTable,
    tables: DictTable[],
    turns: TextTurn[],
    loadedNodes: LoadedTableNode[] = [],
    fileNodes: FileNode[] = [],
    reports: { id: string; parentNodeId?: string }[] = [],
): TextTurn[] {
    const result: TextTurn[] = [];
    const seen = new Set<string>();
    let current = getThreadParentNodeId(table);
    while (current && !seen.has(current)) {
        seen.add(current);
        const turn = turns.find(turn => turn.id === current);
        if (turn) {
            result.unshift(turn);
            current = turn.parentNodeId;
            continue;
        }
        const parentTable = tables.find(table => table.id === current);
        if (parentTable?.derive) break;
        const parent = parentTable?.parentNodeId
            || loadedNodes.find(node => node.tableId === current || node.id === current)?.parentNodeId
            || fileNodes.find(node => node.id === current)?.parentNodeId
            || reports.find(node => node.id === current)?.parentNodeId;
        if (!parent) break;
        current = parent;
    }
    return result;
}

export function getThreadConversationIds(targetId: string, tables: DictTable[], turns: TextTurn[], loadedNodes: LoadedTableNode[] = [], fileNodes: FileNode[] = [], reports: { id: string; parentNodeId?: string }[] = []): string[] {
    const parents = new Map<string, string | undefined>([
        ...turns.map(turn => [turn.id, turn.parentNodeId || createConversationRootId(turn.id)] as const),
        ...loadedNodes.map(node => [node.id, node.parentNodeId] as const),
        ...fileNodes.map(node => [node.id, node.parentNodeId] as const),
        ...reports.map(node => [node.id, node.parentNodeId] as const),
        ...tables.map(table => [table.id, getThreadParentNodeId(table)
            || loadedNodes.find(node => node.tableId === table.id)?.parentNodeId
            || table.derive?.trigger.tableId] as const),
    ]);
    const spine = new Set<string>();
    let current: string | undefined = targetId;
    let rootId = targetId;
    while (current && !spine.has(current)) {
        spine.add(current);
        rootId = current;
        current = parents.get(current);
    }
    const turnIds = new Set(turns.map(turn => turn.id));
    const artifactIds = new Set([...fileNodes, ...reports].map(node => node.id));
    const excludedTurns = new Set<string>();
    for (const table of tables.filter(item => !spine.has(item.id))) {
        current = parents.get(table.id);
        const seen = new Set<string>();
        while (current && turnIds.has(current) && !spine.has(current) && !seen.has(current)) {
            seen.add(current);
            excludedTurns.add(current);
            current = parents.get(current);
        }
    }
    const children = new Map<string, string[]>();
    for (const [id, parent] of parents) {
        if (!parent || excludedTurns.has(id) || (!turnIds.has(id) && !artifactIds.has(id) && !spine.has(id))) continue;
        children.set(parent, [...(children.get(parent) || []), id]);
    }
    for (const turn of turns) {
        const order = turn.outputIds?.map(id => loadedNodes.find(node => node.id === id)?.tableId || id);
        if (!order) continue;
        children.get(turn.id)?.sort((first, second) => {
            const firstIndex = order.indexOf(first);
            const secondIndex = order.indexOf(second);
            return (firstIndex < 0 ? order.length : firstIndex) - (secondIndex < 0 ? order.length : secondIndex);
        });
    }
    const result: string[] = [];
    const visited = new Set<string>();
    const visit = (id: string) => {
        if (visited.has(id)) return;
        visited.add(id);
        if (parents.has(id)) result.push(id);
        for (const child of children.get(id) || []) visit(child);
    };
    visit(rootId);
    return result;
}

export function resolveThreadParentTableId(
    table: DictTable,
    tables: DictTable[],
    textTurns: TextTurn[],
    loadedNodes: LoadedTableNode[] = [],
    fileNodes: FileNode[] = [],
    reports: { id: string; parentNodeId?: string }[] = [],
): string | undefined {
    const tableIds = new Set(tables.map(candidate => candidate.id));
    const turnsById = new Map(textTurns.map(turn => [turn.id, turn]));
    let parentId = getThreadParentNodeId(table);
    if (isConversationRootId(parentId)) return parentId;
    const seen = new Set<string>();

    while (parentId && !seen.has(parentId)) {
        if (isConversationRootId(parentId)) return parentId;
        seen.add(parentId);
        if (tableIds.has(parentId)) {
            const parentTable = tables.find(candidate => candidate.id === parentId)!;
            const introduction = loadedNodes.find(node => node.tableId === parentId);
            if (parentTable.derive || !introduction) return parentId;
            parentId = introduction.parentNodeId;
        } else {
            parentId = turnsById.get(parentId)?.parentNodeId
                || loadedNodes.find(node => node.id === parentId)?.parentNodeId
                || fileNodes.find(node => node.id === parentId)?.parentNodeId
                || reports.find(node => node.id === parentId)?.parentNodeId;
        }
    }

    return table.derive?.trigger.tableId;
}

export function getThreadTriggers(
    leafTable: DictTable,
    tables: DictTable[],
    textTurns: TextTurn[],
    loadedNodes: LoadedTableNode[] = [],
    fileNodes: FileNode[] = [],
    reports: { id: string; parentNodeId?: string }[] = [],
): Trigger[] {
    const tablesById = new Map(tables.map(table => [table.id, table]));
    const triggers: Trigger[] = [];
    const seen = new Set<string>();
    let table: DictTable | undefined = leafTable;

    while (table?.derive && !seen.has(table.id)) {
        seen.add(table.id);
        const parentTableId = resolveThreadParentTableId(table, tables, textTurns, loadedNodes, fileNodes, reports);
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
    loadedNodes: LoadedTableNode[] = [],
    fileNodes: FileNode[] = [],
    reports: { id: string; parentNodeId?: string }[] = [],
): boolean {
    return !tables.some(candidate => candidate.derive
        && resolveThreadParentTableId(candidate, tables, textTurns, loadedNodes, fileNodes, reports) === table.id);
}