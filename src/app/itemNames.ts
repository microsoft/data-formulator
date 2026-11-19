// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * One name per thing (design-docs/74): what a reference in an agent message or a report names.
 *
 * New names: `session://charts/<id>`, `session://tables/<name>`, `session://reports/<id>`,
 * `session://threads/<n>`, `session://references/<id>`, and files by their workspace paths
 * (`files/<path>`, `scratch/<path>`). Old names stay readable forever, since saved reports and
 * messages hold them: `session/charts/<id>.json` (and the other `session/…` forms, with or without
 * their suffix), `chart://<id>`, `map://files/<name>.map.json`, and the file links messages used
 * (`/api/workspace/files/…`, `scratch/…`).
 */

import type { FocusedId } from './dfSlice';
import type { Chart, DictTable } from '../components/ComponentType';
import { buildThreads, threadChatNodeIds, type ThreadGraph, type ThreadSpec } from './threadGraph';

export type ItemTarget =
    | { kind: 'chart'; id: string }
    | { kind: 'table'; name: string }
    | { kind: 'report'; id: string }
    | { kind: 'thread'; number: number }
    | { kind: 'reference'; id: string }
    /** A workspace file: `files/<path>` or `scratch/<path>`. */
    | { kind: 'file'; path: string }
    | { kind: 'web'; url: string };

const SESSION_FOLDERS: Record<string, { kind: 'chart' | 'table' | 'report' | 'thread' | 'reference'; suffix: string }> = {
    charts: { kind: 'chart', suffix: '.json' },
    tables: { kind: 'table', suffix: '.json' },
    reports: { kind: 'report', suffix: '.md' },
    threads: { kind: 'thread', suffix: '.md' },
    references: { kind: 'reference', suffix: '.json' },
};

/** Links to workspace files messages wrote before `files/…` names, and what each stands for. */
const FILE_LINK_PREFIXES: [string, string][] = [
    ['/api/workspace/files/', ''],
    ['/api/agent/workspace/scratch/', 'scratch/'],
    ['/api/workspace/scratch/', 'scratch/'],
    ['./scratch/', 'scratch/'],
    ['scratch/', 'scratch/'],
    ['./files/', 'files/'],
    ['files/', 'files/'],
];

const decode = (text: string): string | null => {
    try {
        return decodeURIComponent(text);
    } catch {
        return null;
    }
};

const hasControl = (text: string) => Array.from(text).some(character => character.charCodeAt(0) < 32);

/** A relative path of plain segments: no empty, `.` or `..` parts, no backslashes or control characters. */
const safePath = (path: string | null): path is string => !!path && !path.includes('\\') && !hasControl(path)
    && path.split('/').every(part => !!part && part !== '.' && part !== '..');

const sessionTarget = (folder: string, rest: string, legacy: boolean): ItemTarget | null => {
    const spec = SESSION_FOLDERS[folder];
    if (!spec) return null;
    let name = decode(rest);
    if (legacy && name?.endsWith(spec.suffix)) name = name.slice(0, -spec.suffix.length);
    if (!safePath(name) || name.includes('/')) return null;
    if (spec.kind === 'thread') return /^\d+$/.test(name) && Number(name) > 0 ? { kind: 'thread', number: Number(name) } : null;
    if (spec.kind === 'table') return { kind: 'table', name };
    return { kind: spec.kind, id: name };
};

const fileTarget = (path: string): ItemTarget | null => {
    const decoded = decode(path.split(/[?#]/)[0]);
    if (!safePath(decoded)) return null;
    if (!/^(files|scratch)\//.test(decoded)) return null;
    return { kind: 'file', path: decoded };
};

/** What a reference names, in any of its forms; null for anything else (or anything unsafe). */
export function parseItemName(reference: string | undefined | null): ItemTarget | null {
    const text = (reference || '').trim();
    if (!text || hasControl(text)) return null;
    if (/^https?:\/\/\S+$/i.test(text)) return { kind: 'web', url: text };
    const scheme = text.match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i);
    if (scheme) {
        const [, name, rest] = scheme;
        const body = rest.split(/[?#]/)[0];
        switch (name.toLowerCase()) {
            case 'session': {
                const slash = body.indexOf('/');
                return slash > 0 ? sessionTarget(body.slice(0, slash), body.slice(slash + 1), false) : null;
            }
            case 'chart': return sessionTarget('charts', body, false);
            case 'map': return fileTarget(body);
            default: return null;
        }
    }
    const legacy = text.match(/^session\/([a-z]+)\/(.+)$/);
    if (legacy) return sessionTarget(legacy[1], legacy[2].split(/[?#]/)[0], true);
    for (const [prefix, root] of FILE_LINK_PREFIXES) {
        if (!text.startsWith(prefix)) continue;
        const rest = text.slice(prefix.length);
        if (root) return fileTarget(`${root}${rest}`);
        // `/api/workspace/files/<name>` is a workspace file, or a scratch file when `<name>` starts with scratch/.
        return fileTarget(rest.startsWith('scratch/') ? rest : `files/${rest}`);
    }
    return null;
}

/** A file target's name in the app (`setFocused({type: 'file'})`): `files/x` is `x`, `scratch/x` itself. */
export const workspaceFileName = (path: string): string => path.startsWith('files/') ? path.slice('files/'.length) : path;

export const isImagePath = (path: string): boolean => /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(path);
export const isMapPath = (path: string): boolean => /\.map\.json$/i.test(path);

/** What `![caption](name)` draws in place; anything else shows as a link with its caption. */
export const isDrawableTarget = (target: ItemTarget | null): boolean => !!target && (target.kind === 'chart'
    || target.kind === 'table' || target.kind === 'web' || (target.kind === 'file' && (isMapPath(target.path) || isImagePath(target.path))));

/** A table by the name the agent uses for it (its workspace table id) or by its id. */
export const findTableByName = <T extends Pick<DictTable, 'id' | 'virtual'>>(tables: T[], name: string): T | undefined =>
    tables.find(table => (table.virtual?.tableId || table.id) === name) ?? tables.find(table => table.id === name);

/**
 * The session's threads as the agent numbers them (`session://threads/<n>`, from 1): every thread of
 * the graph except a source table with nothing after it, which stays on the shelf
 * (`analyst/session_layer/layer.py`).
 */
export const numberedThreads = (graph: ThreadGraph, tables: Pick<DictTable, 'id' | 'derive'>[]): ThreadSpec[] => {
    const byId = new Map(tables.map(table => [table.id, table]));
    return buildThreads(graph).filter(thread => !(thread.nodeIds.length === 1 && graph.kindOf(thread.nodeIds[0]) === 'table'
        && !byId.get(thread.nodeIds[0])?.derive));
};

export interface ItemContext {
    tables: DictTable[];
    charts: Pick<Chart, 'id'>[];
    reports: { id: string }[];
    references: { id: string }[];
    graph: ThreadGraph;
}

/** Where opening an item takes the canvas, while the item exists. Files always open (the canvas says if one is gone). */
export function itemFocus(target: ItemTarget | null, context: ItemContext): NonNullable<FocusedId> | undefined {
    if (!target) return undefined;
    switch (target.kind) {
        case 'chart': return context.charts.some(chart => chart.id === target.id) ? { type: 'chart', chartId: target.id } : undefined;
        case 'table': {
            const table = findTableByName(context.tables, target.name);
            return table ? { type: 'table', tableId: table.id } : undefined;
        }
        case 'report': return context.reports.some(report => report.id === target.id) ? { type: 'report', reportId: target.id } : undefined;
        case 'reference': return context.references.some(reference => reference.id === target.id)
            ? { type: 'external-table', referenceId: target.id } : undefined;
        case 'thread': {
            const thread = numberedThreads(context.graph, context.tables)[target.number - 1];
            return thread ? { type: 'conversation', tableId: thread.key, nodeIds: threadChatNodeIds(context.graph, thread) } : undefined;
        }
        case 'file': return { type: 'file', fileName: workspaceFileName(target.path) };
        case 'web': return undefined;
    }
}
