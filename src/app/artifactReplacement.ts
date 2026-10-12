// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Artifacts the agent may replace when the user wants one fixed (see
 * py-src/data_formulator/analyst/replacement.py). Only agent-created artifacts
 * qualify: derived tables (with their charts), apps and files, and reports.
 * One with something built on it is listed with a `blocked` reason, so the
 * agent learns why and makes a new artifact instead. Apps that read a table are
 * checked by the server, which can read their manifests.
 */

import { computeInsightKey, type Chart, type DictTable, type FileNode } from '../components/ComponentType';
import type { GeneratedReport } from './dfSlice';
import type { ThreadGraph } from './threadGraph';

export interface ReplaceableArtifact {
    /** The id the agent knows: a table name, a files/ path, or a report id. */
    id: string;
    /** The thread node it is. */
    node_id: string;
    kind: 'table' | 'file' | 'report';
    name: string;
    /** Other ids that name it, such as its chart's id. */
    aliases?: string[];
    blocked?: string;
}

const MAX_ARTIFACTS = 60;

export function listReplaceableArtifacts({ tables, charts, fileNodes, reports, graph, focusNodeId }: {
    tables: DictTable[];
    charts: Chart[];
    fileNodes: FileNode[];
    reports: GeneratedReport[];
    graph: ThreadGraph;
    focusNodeId?: string;
}): ReplaceableArtifact[] {
    const artifacts: (ReplaceableArtifact & { createdAt: number })[] = [];
    const reportUsing = (chartIds: string[], tableId?: string) => reports.find(report =>
        (tableId && report.triggerTableId === tableId) || chartIds.some(chartId => report.content.includes(`chart://${chartId}`)));
    for (const table of tables) {
        if (!table.derive) continue;
        const tableCharts = charts.filter(chart => chart.tableRef === table.id);
        const chartIds = tableCharts.map(chart => chart.id);
        const derivedFrom = tables.find(other => other.id !== table.id && other.derive?.source.includes(table.id));
        // The table's first chart is the one the agent made with it; any other was made from it later.
        const [agentChart, ...laterCharts] = tableCharts.filter(chart => chart.source !== 'trigger');
        const edited = !!agentChart && (!!agentChart.styleVariants?.length
            || (!!agentChart.titleKey && agentChart.titleKey !== computeInsightKey(agentChart)));
        const report = reportUsing(chartIds, table.id);
        const id = table.virtual?.tableId || table.id;
        artifacts.push({
            id, node_id: table.id, kind: 'table', name: table.displayId || id,
            aliases: [...(table.id !== id ? [table.id] : []), ...chartIds],
            blocked: derivedFrom ? `the table ${derivedFrom.displayId || derivedFrom.id} was computed from it`
                : laterCharts.length ? 'another chart was made from it'
                : edited ? 'the user edited its chart'
                : report ? `the report ${report.title || report.id} uses it` : undefined,
            createdAt: table.createdAt ?? 0,
        });
    }
    for (const file of fileNodes) {
        const usedBy = tables.find(table => table.derive?.inputSources?.some(source =>
            source.kind === 'file' && (source.displayName === file.path || source.id.endsWith(`:${encodeURIComponent(file.path)}`))));
        artifacts.push({
            id: `files/${file.path}`, node_id: file.id, kind: 'file', name: file.displayName || file.path,
            blocked: usedBy ? `the table ${usedBy.displayId || usedBy.id} was computed from it` : undefined,
            createdAt: file.createdAt,
        });
    }
    for (const report of reports) {
        if (report.status === 'generating') continue;
        artifacts.push({ id: report.id, node_id: report.id, kind: 'report', name: report.title || report.id, createdAt: report.createdAt });
    }
    // The focused chain first (nearest first), then the newest.
    const chain = graph.ancestors(focusNodeId, { includeSelf: true });
    const rank = (artifact: { node_id: string }) => {
        const index = chain.indexOf(artifact.node_id);
        return index < 0 ? chain.length : index;
    };
    return artifacts
        .sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt)
        .slice(0, MAX_ARTIFACTS)
        .map(({ createdAt: _createdAt, aliases, blocked, ...artifact }) => ({
            ...artifact,
            ...(aliases?.length ? { aliases } : {}),
            ...(blocked ? { blocked } : {}),
        }));
}
