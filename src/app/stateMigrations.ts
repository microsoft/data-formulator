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

import { buildThreadGraph } from './threadGraph';

/** Current persisted-state schema version. Bump when adding a migration. */
export const DF_STATE_VERSION = 14;

type SavedState = Record<string, any>;

function migrateTerminalRecord(turn: any): any {
    if (typeof turn?.content !== 'string') return turn;
    const executions = Array.isArray(turn.executions) ? turn.executions : [];
    const migratedExecutions: any[] = [];
    const matched = new Set<string>();
    const ids = new Set(executions.map((execution: any) => execution.id));
    const quoteArgument = (argument: string) => /^[A-Za-z0-9_@%+=:,./-]+$/.test(argument) ? argument
        : argument.includes("'") ? `"${argument.replace(/[\\"$`]/g, '\\$&')}"` : `'${argument}'`;
    const pattern = /```json[^\S\n]*\n([\s\S]*?)\n```|\*\*Command\*\*\s*\n\s*```(?:bash|sh|shell)\n([\s\S]*?)\n```\s*\n\s*\*\*Working directory:\*\* `((?:\\`|[^`])*)`(?:\s*\n\s*\*\*Result\*\*\s*\n\s*```text\n([\s\S]*?)\n```)?/g;
    const content = turn.content.replace(pattern, (block: string, json: string | undefined, command: string, cwd: string, output: string | undefined, offset: number) => {
        let record: any;
        let result: unknown;
        if (json !== undefined) {
            try {
                const parsed = JSON.parse(json);
                if (!parsed || !Array.isArray(parsed.argv) || !parsed.argv.every((argument: unknown) => typeof argument === 'string')
                    || typeof parsed.cwd !== 'string') return block;
                result = parsed.result;
                record = { argv: parsed.argv, cwd: parsed.cwd, purpose: '', status: 'unknown' };
            } catch { return block; }
        } else {
            record = { argv: [], commandText: command, cwd: cwd.replace(/\\`/g, '`'), purpose: '', status: 'unknown' };
            if (output !== undefined) {
                try { result = JSON.parse(output); } catch { result = output; }
            }
        }
        if (result !== undefined) {
            record.result = result && typeof result === 'object' && !Array.isArray(result)
                ? result : { output: typeof result === 'string' ? result : JSON.stringify(result) };
            const outcome = record.result;
            record.status = outcome.rejected ? 'rejected'
                : outcome.error || outcome.timed_out || (outcome.exit_code != null && outcome.exit_code !== 0) ? 'failed'
                : outcome.exit_code === 0 ? 'completed' : 'unknown';
        }
        const existing = executions.find((execution: any) => !matched.has(execution.id) && execution.cwd === record.cwd
            && (record.commandText === undefined ? JSON.stringify(execution.argv) === JSON.stringify(record.argv)
                : record.commandText === execution.commandText || record.commandText === execution.argv?.map(quoteArgument).join(' ')
                    || (['bash', 'sh', 'zsh'].includes(execution.argv?.[0]) && execution.argv?.[1] === '-lc'
                        && record.commandText === execution.argv.slice(2).join(' ')))
            && (record.result === undefined || JSON.stringify(record.result) === JSON.stringify(execution.result)));
        if (existing) {
            matched.add(existing.id);
            migratedExecutions.push(existing);
        } else {
            let id = `${turn.id || 'record'}-terminal-${offset}`;
            while (ids.has(id)) id += '-legacy';
            ids.add(id);
            migratedExecutions.push({ ...record, id });
        }
        return '';
    });
    return migratedExecutions.length === 0 ? turn : {
        ...turn, content: content.trim(),
        ...(turn.displayContent === turn.content ? { displayContent: content.trim() } : {}),
        executions: [...migratedExecutions, ...executions.filter((execution: any) => !matched.has(execution.id))],
    };
}

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

/**
 * design-docs/58: conversation lives in message nodes, items follow the
 * messages that produced them, and items brought in together form one set.
 * Rewrites the legacy shapes that placed conversation elsewhere:
 *  - a table's / draft's `derive.trigger.interaction` → messages before it;
 *  - a turn carrying both the user's `prompt` and the agent's reply → a prompt
 *    message followed by the reply;
 *  - `answer` on a question → a reply message that the continuation follows;
 *  - loaded tables, files, and reports a run handed to its closing message →
 *    placed before that message, as produced;
 *  - batches of loaded tables / files under one message → artifact sets;
 *  - a workflow run → its request, then its outputs and messages in order,
 *    then the run's record (no separate status card or completion message);
 *  - drops `answer`, `sourceFormId`, `revisedFile`, and `workflowCardFor`.
 */
function migrateToItemsAndEdges(state: SavedState): SavedState {
    const list = (key: string): any[] => Array.isArray(state[key]) ? state[key].filter(Boolean).map((node: any) => ({ ...node })) : [];
    const turns = list('textTurns');
    const tables = list('derivedTables');
    const drafts = list('draftNodes');
    const loaded = list('loadedTableNodes');
    const files = list('fileNodes');
    const reports = list('generatedReports');
    const sets = list('artifactSets');
    const ids = new Set<string>([turns, tables, drafts, loaded, files, reports, sets].flat().map(node => node.id));
    const freshId = (base: string) => {
        let id = base;
        while (ids.has(id)) id += '-migrated';
        ids.add(id);
        return id;
    };
    const message = (id: string, parentNodeId: string | undefined, createdAt: number, fields: Record<string, any>) => ({
        kind: 'text', id, displayId: id, textKind: 'explain', content: '', parentNodeId, createdAt, ...fields,
    });
    const isPromptNode = (turn: any) => !!turn.prompt && !turn.content && !turn.executions?.length
        && !turn.codeExecutions?.length && !turn.form && !turn.dataOperation && !turn.workflow;
    const nodesNow = () => [turns, tables, drafts, loaded, files, reports, sets].flat();

    // A workflow run: request → outputs and messages in order → the run's record.
    for (const run of turns.filter(turn => turn.workflow?.runId && !turn.workflowCardFor)) {
        // Only the legacy layout: the record carried the request and a status card followed the outputs.
        const cards = turns.filter(turn => turn.workflowCardFor === run.id);
        if (!run.prompt && !cards.length) continue;
        const runId = run.workflow.runId;
        const requestId = `textTurn-workflow-${runId}-request`;
        if (!ids.has(requestId)) {
            ids.add(requestId);
            turns.push(message(requestId, run.parentNodeId, run.createdAt ?? 0, { actionId: runId,
                prompt: run.prompt || `Run workflow: ${run.displayId || runId}` }));
        }
        delete run.prompt;
        const cardIds = new Set(cards.map(card => card.id));
        const removed = new Set([...cardIds, `textTurn-workflow-completed-${runId}`]);
        const runMessages = turns.filter(turn => turn.workflowMessage?.runId === runId && turn.parentNodeId === run.id);
        const chainIds = new Set<string>([...(run.outputIds || []), ...runMessages.map(turn => turn.id)]);
        // Outputs that followed the record now follow the request.
        for (const node of nodesNow()) {
            if (node.parentNodeId === run.id && chainIds.has(node.id) && !node.workflowMessage) node.parentNodeId = requestId;
        }
        // Messages go after the last output they had seen.
        const byAnchor = new Map<string, any[]>();
        for (const turn of runMessages.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))) {
            const anchor = [...(turn.workflowMessage.afterOutputIds || [])].reverse().find((id: string) => ids.has(id)) ?? requestId;
            byAnchor.set(anchor, [...(byAnchor.get(anchor) || []), turn]);
        }
        for (const [anchor, group] of byAnchor) {
            const followers = nodesNow().filter(node => node.parentNodeId === anchor && chainIds.has(node.id) && !group.includes(node));
            let head = anchor;
            for (const turn of group) {
                turn.parentNodeId = head;
                turn.content = '';
                delete turn.workflowMessage.afterOutputIds;
                head = turn.id;
            }
            followers.forEach(node => { node.parentNodeId = head; });
        }
        // The record closes the chain; what followed its card or completion follows it.
        let tail = requestId;
        for (const seen = new Set<string>(); !seen.has(tail);) {
            seen.add(tail);
            const next = nodesNow().find(node => node.parentNodeId === tail && chainIds.has(node.id));
            if (!next) break;
            tail = next.id;
        }
        run.parentNodeId = tail;
        for (const node of nodesNow()) {
            if (removed.has(node.parentNodeId)) node.parentNodeId = run.id;
        }
        for (let index = turns.length - 1; index >= 0; index--) {
            if (removed.has(turns[index].id)) turns.splice(index, 1);
        }
    }

    // A turn holding both the request and the reply becomes request → reply.
    for (const turn of [...turns]) {
        if (!turn.prompt || isPromptNode(turn)) continue;
        const promptId = freshId(`${turn.id}-prompt`);
        turns.push(message(promptId, turn.parentNodeId, turn.startedAt ?? turn.createdAt ?? 0,
            { prompt: turn.prompt, ...(turn.actionId ? { actionId: turn.actionId } : {}) }));
        turn.parentNodeId = promptId;
        delete turn.prompt;
    }

    // Conversation stored on a table or draft becomes the messages before it.
    const hoistInteraction = (node: any, keep: (entry: any) => boolean) => {
        const interaction = node.derive?.trigger?.interaction;
        if (!Array.isArray(interaction) || !interaction.length) return;
        let parentNodeId = node.parentNodeId;
        // The first message takes the node's place among its siblings.
        const firstCreatedAt = node.createdAt ?? 0;
        interaction.filter(entry => entry && !keep(entry)).forEach((entry: any, index: number) => {
            const content = entry.displayContent || entry.content || '';
            if (!content && !entry.executions?.length && !entry.codeExecutions?.length) return;
            const id = freshId(`textTurn-migrated-${node.id}-${index}`);
            const createdAt = parentNodeId === node.parentNodeId ? firstCreatedAt : entry.timestamp ?? firstCreatedAt;
            // A legacy plan is its step labels joined by the record separator.
            const progressSteps = entry.progressSteps?.length ? entry.progressSteps
                : typeof entry.plan === 'string' && entry.plan ? entry.plan.split('\x1E').filter(Boolean).map((label: string, step: number) =>
                    ({ id: `${id}-step-${step}`, kind: 'thought', label, status: 'completed' })) : undefined;
            turns.push(message(id, parentNodeId, createdAt, entry.from === 'user'
                ? { prompt: content, ...(entry.attachments?.length ? { attachments: entry.attachments } : {}) }
                : { content, ...(entry.executions?.length ? { executions: entry.executions } : {}),
                    ...(entry.codeExecutions?.length ? { codeExecutions: entry.codeExecutions } : {}),
                    ...(progressSteps ? { progressSteps } : {}) }));
            parentNodeId = id;
        });
        node.parentNodeId = parentNodeId;
        node.derive = { ...node.derive, trigger: { ...node.derive.trigger, interaction: interaction.filter(keep) } };
    };
    tables.forEach(table => hoistInteraction(table, () => false));
    drafts.forEach(draft => {
        hoistInteraction(draft, entry => entry.role === 'error');
        if (draft.derive && 'pendingClarification' in draft.derive) {
            const { pendingClarification: _pendingClarification, ...derive } = draft.derive;
            draft.derive = derive;
        }
    });

    const all = () => [turns, tables, drafts, loaded, files, reports, sets].flat();
    const childrenOf = (id: string) => all().filter(node => node.parentNodeId === id);

    // Items brought in within a short window under one parent form a set.
    const placeBatch = (items: any[], parentNodeId: string | undefined): string | undefined => {
        const batches: any[][] = [];
        for (const item of [...items].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))) {
            const batch = batches[batches.length - 1];
            if (batch && (item.createdAt ?? 0) - (batch[batch.length - 1].createdAt ?? 0) <= 2000) batch.push(item);
            else batches.push([item]);
        }
        let head = parentNodeId;
        for (const batch of batches) {
            if (batch.length === 1) {
                batch[0].parentNodeId = head;
                head = batch[0].id;
                continue;
            }
            const setId = freshId(`artifactSet-migrated-${batch[0].id}`);
            sets.push({ kind: 'artifact-set', id: setId, parentNodeId: head, memberIds: batch.map(item => item.id),
                createdAt: batch[0].createdAt ?? 0 });
            batch.forEach(item => { item.parentNodeId = setId; });
            head = setId;
        }
        return head;
    };
    const isSideItem = (node: any) => node.kind === 'loaded-table' || node.kind === 'file' || reports.includes(node);
    const isLeaf = (node: any) => childrenOf(node.id).length === 0;

    // Items a run handed to its closing message were produced before it.
    for (const turn of turns) {
        if (isPromptNode(turn)) continue;
        const produced = childrenOf(turn.id).filter(node => isSideItem(node) && isLeaf(node)
            && (node.createdAt ?? 0) < (turn.createdAt ?? 0));
        if (produced.length) turn.parentNodeId = placeBatch(produced, turn.parentNodeId);
    }
    // The answer to a question becomes a reply message the continuation follows.
    for (const turn of [...turns]) {
        const answer = typeof turn.answer === 'string' ? turn.answer.trim() : '';
        if (!answer) continue;
        const children = childrenOf(turn.id);
        if (children.some(child => child.kind === 'text' && child.prompt?.trim() === answer)) continue;
        const replyId = freshId(`${turn.id}-reply`);
        const createdAt = Math.min(...children.map(child => child.createdAt ?? Infinity), (turn.createdAt ?? 0) + 1);
        turns.push(message(replyId, turn.id, createdAt, { prompt: answer }));
        for (const child of children) {
            if (!(child.kind === 'text' && isPromptNode(child))) child.parentNodeId = replyId;
        }
    }

    // Remaining batches of loaded tables and files under one message.
    for (const turn of turns) {
        const batch = childrenOf(turn.id).filter(node => (node.kind === 'loaded-table' || node.kind === 'file') && isLeaf(node));
        if (batch.length > 1) placeBatch(batch, turn.id);
    }

    const legacyTurnFields = ['answer', 'sourceFormId', 'revisedFile', 'workflowCardFor'];
    const focusedId = state.focusedId?.type === 'conversation' && 'entryIndex' in state.focusedId
        ? (({ entryIndex: _entryIndex, ...rest }) => rest)(state.focusedId) : state.focusedId;
    return {
        ...state,
        textTurns: turns.map(turn => Object.fromEntries(Object.entries(turn).filter(([key]) => !legacyTurnFields.includes(key)))),
        derivedTables: tables,
        draftNodes: drafts,
        loadedTableNodes: loaded,
        fileNodes: files,
        generatedReports: reports,
        artifactSets: sets,
        ...(focusedId !== state.focusedId ? { focusedId } : {}),
        __stateVersion: 10,
    };
}

/**
 * A pre-release build named a resumed run's nodes after the conversation, so
 * replying to a question overwrote the request that led to it: the request
 * node took the reply's text and followed the question, leaving the two in a
 * loop. The question's resume trajectory still holds what was sent with the
 * original request, so rebuild it: its text from [USER QUESTION], and its place
 * after the message the [FOCUSED THREAD] ended with.
 */
function repairOverwrittenRequests(state: SavedState): SavedState {
    if (!Array.isArray(state.textTurns)) return { ...state, __stateVersion: 11 };
    const turns: any[] = state.textTurns.map((turn: any) => ({ ...turn }));
    const byId = new Map(turns.map(turn => [turn.id, turn]));
    const normalize = (text: string) => text.replace(/[*_`#>|\s]+/g, ' ').trim().slice(0, 80);
    const added: any[] = [];
    for (const question of turns) {
        const reply = byId.get(question.parentNodeId);
        if (!reply?.prompt || reply.parentNodeId !== question.id || !Array.isArray(question.resume?.trajectory)) continue;
        const sent = question.resume.trajectory.find((message: any) =>
            message?.role === 'user' && typeof message.content === 'string' && message.content.includes('[USER QUESTION]'));
        const context: string = sent?.content || '';
        const asked = context.slice(context.lastIndexOf('[USER QUESTION]') + '[USER QUESTION]'.length).trim();
        let parentNodeId: string | undefined;
        const focused = context.indexOf('[FOCUSED THREAD]');
        if (focused >= 0) {
            const block = context.slice(focused + '[FOCUSED THREAD]'.length).split(/\n\[[A-Z][A-Z /]*\]/)[0];
            const lastAnswer = block.slice(block.lastIndexOf('\n  Analyst: ') + '\n  Analyst: '.length);
            const key = block.includes('\n  Analyst: ') ? normalize(lastAnswer) : '';
            parentNodeId = key ? turns.find(turn => turn !== question && turn.content && normalize(turn.content) === key)?.id : undefined;
        }
        if (!asked) {
            question.parentNodeId = parentNodeId ?? `conversation-root:${question.id}`;
            continue;
        }
        let id = `${reply.id}-original`;
        while (byId.has(id)) id += '-1';
        const request = { kind: 'text', id, displayId: id, textKind: 'explain', content: '', prompt: asked,
            parentNodeId: parentNodeId ?? `conversation-root:${id}`, createdAt: question.startedAt ?? (question.createdAt ?? 1) - 1,
            ...(question.actionId ? { actionId: question.actionId } : {}) };
        byId.set(id, request);
        added.push(request);
        question.parentNodeId = id;
    }
    return { ...state, textTurns: [...turns, ...added], __stateVersion: 11 };
}

/**
 * A data-loading set used to list both a connected source and the table queried
 * from it. The source is that table's input, not an item of its own (it stays on
 * the shelf), so drop it from the set; a set left with one member becomes that item.
 */
function dropQueriedSourcesFromSets(state: SavedState): SavedState {
    const sets: any[] = Array.isArray(state.artifactSets) ? state.artifactSets : [];
    const loaded: any[] = Array.isArray(state.loadedTableNodes) ? state.loadedTableNodes : [];
    if (!sets.length) return { ...state, __stateVersion: 12 };
    const originOf = new Map<string, string>();
    for (const table of [...(state.inputTables || []), ...(state.derivedTables || [])]) {
        const origin = table?.sourceConfig?.importedFrom ?? table?.source?.importedFrom;
        if (origin?.connectorId && origin?.tableKey) originOf.set(table.id, `${origin.connectorId}\n${origin.tableKey}`);
    }
    const referenceKey = new Map<string, string>((state.externalTableReferences || [])
        .map((reference: any) => [reference.id, `${reference.connectorId}\n${reference.tableKey}`]));
    const nodeById = new Map(loaded.map(node => [node.id, node]));
    const dropped = new Set<string>();
    // A removed set's followers follow what replaces it: its only member, or its parent.
    const replacedBy = new Map<string, string>();
    const keptSets = sets.flatMap(set => {
        const members = (set.memberIds || []).map((id: string) => nodeById.get(id)).filter(Boolean);
        const queried = new Set(members.filter((node: any) => !node.external).map((node: any) => originOf.get(node.tableId)).filter(Boolean));
        const remaining = (set.memberIds || []).filter((id: string) => {
            const node = nodeById.get(id);
            const drop = !!node?.external && queried.has(referenceKey.get(node.tableId));
            if (drop) dropped.add(id);
            return !drop;
        });
        if (remaining.length > 1) return [{ ...set, memberIds: remaining }];
        replacedBy.set(set.id, remaining[0] ?? set.parentNodeId);
        if (remaining[0]) replacedBy.set(`member:${remaining[0]}`, set.parentNodeId);
        return [];
    });
    if (!dropped.size) return { ...state, __stateVersion: 12 };
    const repoint = (node: any) => {
        const parent = replacedBy.get(`member:${node.id}`) ?? replacedBy.get(node.parentNodeId);
        return parent ? { ...node, parentNodeId: parent } : node;
    };
    const result: SavedState = { ...state, artifactSets: keptSets.map(repoint), __stateVersion: 12 };
    for (const key of ['textTurns', 'derivedTables', 'draftNodes', 'loadedTableNodes', 'fileNodes', 'generatedReports']) {
        if (Array.isArray(state[key])) result[key] = state[key].filter((node: any) => !dropped.has(node?.id)).map(repoint);
    }
    return result;
}

/**
 * A pre-release build listed the code of the table a step made as a `visualize`
 * call on that step, beside its real tool calls. The code belongs to the table,
 * which keeps it, and the step's instruction is the message itself, so drop the call.
 */
function dropTableCodeCalls(state: SavedState): SavedState {
    if (!Array.isArray(state.textTurns)) return { ...state, __stateVersion: 13 };
    return {
        ...state,
        textTurns: state.textTurns.map((turn: any) => {
            const calls = Array.isArray(turn?.codeExecutions) ? turn.codeExecutions : [];
            const tableCode = calls.filter((call: any) => call?.tool === 'visualize' && String(call.id).startsWith('code-'));
            if (!tableCode.length) return turn;
            const { codeExecutions: _calls, ...rest } = turn;
            const remaining = calls.filter((call: any) => !tableCode.includes(call));
            return { ...rest, ...(remaining.length ? { codeExecutions: remaining } : {}) };
        }),
        __stateVersion: 13,
    };
}

/**
 * A follow-up on an app, file, report or reference used to start from the item
 * itself even while a conversation after it was still open, so it read as a
 * separate thread. Derived tables already continued their open conversation
 * (design-docs/58, rule 3): the newest message after the item that nothing had
 * been produced from yet. Move such follow-ups after that message.
 */
function continueOpenConversationsAfterItems(state: SavedState): SavedState {
    if (!Array.isArray(state.textTurns)) return { ...state, __stateVersion: 14 };
    const list = (key: string): any[] => Array.isArray(state[key]) ? state[key] : [];
    const graph = buildThreadGraph({ tables: [...list('inputTables'), ...list('derivedTables')], turns: list('textTurns'),
        drafts: list('draftNodes'), loadedNodes: list('loadedTableNodes'), fileNodes: list('fileNodes'),
        reports: list('generatedReports'), artifactSets: list('artifactSets') });
    const turnById = new Map<string, any>(state.textTurns.map((turn: any) => [turn?.id, turn]));
    const producedBefore = (id: string, time: number, seen = new Set<string>()): boolean => graph.childrenOf(id).some(child =>
        !seen.has(child.id) && (seen.add(child.id), (graph.isItem(child.id) && child.createdAt < time) || producedBefore(child.id, time, seen)));
    const moved = new Map<string, string>();
    for (const turn of state.textTurns) {
        if (!turn?.prompt || !['file', 'report', 'loaded-table', 'artifact-set'].includes(graph.kindOf(turn.parentNodeId) ?? '')) continue;
        const time = turn.createdAt ?? 0;
        let open: { id: string; createdAt: number } | undefined;
        for (const node of graph.nodes.values()) {
            const candidate = turnById.get(node.id);
            if ((node.kind !== 'turn' && node.kind !== 'workflow-definition') || node.id === turn.id || node.createdAt >= time
                || candidate?.workflow || candidate?.workflowMessage || graph.nearestItem(node.id, { includeSelf: false }) !== turn.parentNodeId
                || (open && node.createdAt <= open.createdAt)) continue;
            if (!producedBefore(node.id, time)) open = node;
        }
        if (open) moved.set(turn.id, open.id);
    }
    if (!moved.size) return { ...state, __stateVersion: 14 };
    return { ...state, __stateVersion: 14, textTurns: state.textTurns.map((turn: any) =>
        moved.has(turn?.id) ? { ...turn, parentNodeId: moved.get(turn.id) } : turn) };
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
    {
        to: 7,
        migrate: (state) => ({
            ...state,
            textTurns: Array.isArray(state.textTurns) ? state.textTurns.map(migrateTerminalRecord) : state.textTurns,
            derivedTables: Array.isArray(state.derivedTables) ? state.derivedTables.map((table: any) => {
                const interaction = table?.derive?.trigger?.interaction;
                if (!Array.isArray(interaction)) return table;
                return { ...table, derive: { ...table.derive, trigger: { ...table.derive.trigger,
                    interaction: interaction.map((entry: any, index: number) => {
                        if (entry.from === 'user') return entry;
                        const migrated = migrateTerminalRecord({ ...entry, id: `${table.id}-interaction-${index}` });
                        const { id, ...result } = migrated;
                        return { ...result, ...(entry.id !== undefined ? { id: entry.id } : {}) };
                    }),
                } } };
            }) : state.derivedTables,
            __stateVersion: 7,
        }),
    },
    {
        to: 8,
        migrate: (state) => {
            const legacyRoot = '__rootless_thread__';
            const collections = ['textTurns', 'derivedTables', 'draftNodes', 'loadedTableNodes', 'fileNodes', 'generatedReports'];
            const nodes = collections.flatMap(key => Array.isArray(state[key]) ? state[key] : []);
            const roots = new Map<string, string>();
            for (const node of nodes) {
                if (node.id && (!node.parentNodeId || node.parentNodeId === legacyRoot)) {
                    roots.set(node.id, `conversation-root:${node.actionId ? `action:${node.actionId}` : node.id}`);
                }
            }
            const parents = new Map<string, string>(nodes.filter(node => node.id).map(node =>
                [node.id, roots.get(node.id) || node.parentNodeId]));
            const rootOf = (id: string): string => {
                const seen = new Set<string>();
                let current = id;
                while (parents.has(current) && !seen.has(current)) {
                    seen.add(current);
                    current = parents.get(current)!;
                }
                return current?.startsWith('conversation-root:') ? current : `conversation-root:${id}`;
            };
            const migrated: Record<string, any> = { ...state, __stateVersion: 8 };
            for (const key of collections) {
                if (!Array.isArray(state[key])) continue;
                migrated[key] = state[key].map((node: any) => ({
                    ...node,
                    ...(roots.has(node.id) ? { parentNodeId: roots.get(node.id) } : {}),
                    ...(node.derive?.trigger?.tableId === legacyRoot ? {
                        derive: { ...node.derive, trigger: { ...node.derive.trigger, tableId: rootOf(node.id) } },
                    } : {}),
                    ...(node.triggerTableId === legacyRoot ? { triggerTableId: rootOf(node.id) } : {}),
                }));
            }
            if (state.focusedId?.type === 'conversation' && state.focusedId.tableId === legacyRoot) {
                const focusedRoots = new Set<string>((state.focusedId.nodeIds || []).map(rootOf));
                migrated.focusedId = focusedRoots.size === 1
                    ? { ...state.focusedId, tableId: [...focusedRoots][0] }
                    : undefined;
            }
            return migrated;
        },
    },
    {
        // Workflow proposals became a setup form kind (`form.kind === 'workflow'`).
        to: 9,
        migrate: (state) => ({
            ...state,
            textTurns: Array.isArray(state.textTurns) ? state.textTurns.map((turn: any) => {
                if (!turn?.workflowDefinition) return turn;
                const { workflowDefinition, ...rest } = turn;
                return rest.form || !workflowDefinition.definition ? rest : { ...rest, form: {
                    kind: 'workflow', title: workflowDefinition.definition.name, workflow: workflowDefinition } };
            }) : state.textTurns,
            __stateVersion: 9,
        }),
    },
    { to: 10, migrate: migrateToItemsAndEdges },
    { to: 11, migrate: repairOverwrittenRequests },
    { to: 12, migrate: dropQueriedSourcesFromSets },
    { to: 13, migrate: dropTableCodeCalls },
    { to: 14, migrate: continueOpenConversationsAfterItems },
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
