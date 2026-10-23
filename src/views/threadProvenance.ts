import { type ComputationInputSource, type DictTable } from '../components/ComponentType';

/** A stable key for a computation source, so the same table or file named two ways compares equal. */
export function getConversationSourceKey(source: ComputationInputSource, tables: DictTable[]): string {
    if (source.kind === 'file') return `file:${source.displayName.replace(/^\/?scratch\//, '')}`;
    const table = tables.find(table => table.id === source.id || table.virtual?.tableId === source.id
        || table.id === source.displayName || table.virtual?.tableId === source.displayName);
    return `data:${table?.id || source.id}`;
}
