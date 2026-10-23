// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

type SortableEncoding = { field?: string; sortBy?: string; sortOrder?: string };

const CHANNELS = ['x', 'y', 'color'];

const compareValues = (a: unknown, b: unknown): number => {
    if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
};

/**
 * Flint orders a category axis by a channel (`x`, `y`, `color`) or by an explicit list of values.
 * Charts may also name a column of their data (the agent's chart tool allows it), which Flint
 * ignores — leaving the axis alphabetical. Resolve such a sort before assembling: a column mapped to
 * a channel becomes that channel; any other column becomes the category order it implies.
 */
export function resolveColumnSorts<E extends SortableEncoding>(encodings: Record<string, E>, rows: Record<string, unknown>[]): Record<string, E> {
    const columns = new Set(Object.keys(rows[0] ?? {}));
    const resolved: Record<string, E> = { ...encodings };
    for (const [channel, encoding] of Object.entries(encodings)) {
        const sortBy = encoding?.sortBy;
        if (!sortBy || CHANNELS.includes(sortBy) || !columns.has(sortBy)) continue;
        const mapped = CHANNELS.find(name => encodings[name]?.field === sortBy);
        if (mapped) {
            resolved[channel] = { ...encoding, sortBy: mapped };
            continue;
        }
        const field = encoding.field;
        if (!field) {
            resolved[channel] = { ...encoding, sortBy: undefined };
            continue;
        }
        const keys = new Map<unknown, unknown>();
        for (const row of rows) {
            if (!keys.has(row[field])) keys.set(row[field], row[sortBy]);
        }
        const order = [...keys.entries()].sort((a, b) => compareValues(a[1], b[1])).map(([value]) => value);
        resolved[channel] = { ...encoding, sortBy: JSON.stringify(order) };
    }
    return resolved;
}

const CHANNEL_SORT = /^(-?)(x|y)$/;

/**
 * A theme can draw a chart as layers (bars plus value labels). Each layer then carries a channel sort
 * such as "-x", and Vega-Lite gives up on merging those across layers and orders the axis
 * alphabetically. Rewrite each to a field sort Vega-Lite can merge: the largest value per category.
 * Layers may sit inside concatenated or faceted views (some themes add a header row), so every
 * layered view in the spec is rewritten. Mutates and returns the (Vega-Lite) spec.
 */
export function mergeableLayerSorts<T extends Record<string, any>>(spec: T): T {
    const visit = (node: Record<string, any> | undefined) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node.layer)) {
            if (node.layer.length >= 2) rewriteLayerSorts(node);
            node.layer.forEach(visit);
        }
        for (const key of ['vconcat', 'hconcat', 'concat']) {
            if (Array.isArray(node[key])) node[key].forEach(visit);
        }
        visit(node.spec);
    };
    visit(spec);
    return spec;
}

function rewriteLayerSorts(view: Record<string, any>): void {
    for (const layer of view.layer) {
        const encoding = layer.encoding;
        if (!encoding) continue;
        for (const channel of ['x', 'y']) {
            const sort = encoding[channel]?.sort;
            const match = typeof sort === 'string' ? CHANNEL_SORT.exec(sort) : null;
            const field = match ? (encoding[match[2]] ?? view.encoding?.[match[2]])?.field : undefined;
            if (!match || !field || match[2] === channel) continue;
            encoding[channel] = { ...encoding[channel], sort: { op: 'max', field, order: match[1] ? 'descending' : 'ascending' } };
        }
    }
}
