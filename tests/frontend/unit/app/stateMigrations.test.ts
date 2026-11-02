import { describe, expect, it } from 'vitest';

import { DF_STATE_VERSION, migrateState } from '../../../../src/app/stateMigrations';

describe('state migrations', () => {
    it('migrates legacy terminal records once without mutating the saved payload', () => {
        const content = 'Inspect.\n\n**Command**\n\n```bash\naz account show\n```\n\n**Working directory:** `/workspace`';
        const saved = { __stateVersion: 6, textTurns: [{ id: 'legacy', content }] };
        const migrated = migrateState(saved);
        expect(saved.textTurns[0].content).toBe(content);
        expect(migrated.textTurns[0]).toMatchObject({ content: 'Inspect.', executions: [{
            argv: [], commandText: 'az account show', cwd: '/workspace', status: 'unknown',
        }] });
        expect(migrateState(migrated)).toBe(migrated);
        expect(migrateState({ ...migrated, __stateVersion: 6 }).textTurns).toEqual(migrated.textTurns);
        expect(migrateState({ ...saved, __stateVersion: 99 }).textTurns[0].content).toBe(content);
    });

    it('matches mixed records one-to-one while retaining distinct executions and outcomes', () => {
        const execution = { id: 'first', argv: ['pwd'], cwd: '/', purpose: '', status: 'completed', result: { exit_code: 0, output: '/' } };
        const content = '```json\n' + JSON.stringify({ argv: execution.argv, cwd: execution.cwd, result: execution.result }) + '\n```';
        const migrated = migrateState({ __stateVersion: 6, textTurns: [
            { id: 'mixed', content, executions: [execution, { ...execution, id: 'second' }] },
            { id: 'repeated', content: content + '\n' + content },
            { id: 'different', content, executions: [{ ...execution, result: { output: 'Different run' } }] },
        ] });
        expect(migrated.textTurns[0].executions).toEqual([execution, { ...execution, id: 'second' }]);
        expect(migrated.textTurns[0].content).toBe('');
        expect(migrated.textTurns[1].executions).toHaveLength(2);
        expect(new Set(migrated.textTurns[1].executions.map((item: any) => item.id)).size).toBe(2);
        expect(migrated.textTurns[2].executions).toHaveLength(2);
    });

    it('preserves ordinary JSON and migrates agent-owned table history without changing user messages', () => {
        const content = '```json\n{"argv":["pwd"],"cwd":"/","result":{"exit_code":1,"stderr":"Denied"}}\n```';
        const ordinary = ['```json\n{"status":"ok"}\n```', '```json\n{bad}\n```', '```json\n{"argv":[1],"cwd":"/"}\n```'];
        const migrated = migrateState({ __stateVersion: 6,
            textTurns: ordinary.map((text, index) => ({ id: String(index), content: text })),
            derivedTables: [{ id: 'table', derive: { trigger: { interaction: [
                { from: 'data-agent', content }, { from: 'user', content },
            ] } } }],
        });
        expect(migrated.textTurns.slice(0, 3).map((turn: any) => turn.content)).toEqual(ordinary);
        // The table's history became the messages before it.
        expect(migrated.derivedTables[0].derive.trigger.interaction).toEqual([]);
        const [agent, user] = migrated.textTurns.slice(3);
        expect(agent).toMatchObject({ content: '', executions: [{ argv: ['pwd'], status: 'failed', result: { stderr: 'Denied' } }] });
        expect(user).toMatchObject({ prompt: content, content: '', parentNodeId: agent.id });
        expect(migrated.derivedTables[0].parentNodeId).toBe(user.id);
    });
    it('applies the single v3 split, semantic extraction, and legacy cleanup', () => {
        const migrated = migrateState({
            __stateVersion: 1,
            tables: [
                {
                    id: 'source', displayId: 'Source', anchored: true,
                    names: ['amount'], rows: [{ amount: 2 }],
                    metadata: { amount: { type: 'number', semanticType: 'Currency', unit: 'USD', levels: [] } },
                    virtual: { tableId: 'source_workspace', rowCount: 1 },
                },
                {
                    id: 'derived', displayId: 'Derived', anchored: false,
                    names: ['amount'], rows: [{ amount: 2 }],
                    metadata: { amount: { type: 'number', semanticType: 'Currency', levels: ['low', 'high'] } },
                    virtual: { tableId: 'derived_workspace', rowCount: 1 },
                    derive: { source: ['source'], trigger: { tableId: 'source' } },
                },
            ],
            draftNodes: [{ id: 'draft', anchored: true }],
        });

        expect(DF_STATE_VERSION).toBe(15);
        expect(migrated.__stateVersion).toBe(15);
        expect(migrated).not.toHaveProperty('tables');
        expect(migrated.inputTables).toEqual([
            expect.objectContaining({ id: 'source', source: { kind: 'workspace', tableId: 'source_workspace' } }),
        ]);
        expect(migrated.inputTables[0]).not.toHaveProperty('rows');
        expect(migrated.inputTables[0].snapshot.columns[0]).toEqual({ name: 'amount', type: 'number', levels: [] });
        expect(migrated.derivedTables).toEqual([
            expect.objectContaining({
                id: 'derived',
                derive: expect.any(Object),
                metadata: { amount: { type: 'number', levels: [] } },
            }),
        ]);
        expect(migrated.tableSemantics).toEqual([
            { tableId: 'source', fields: { amount: { semanticType: 'Currency', unit: 'USD' } } },
            { tableId: 'derived', fields: { amount: { semanticType: 'Currency', sortOrder: ['low', 'high'] } } },
        ]);
        expect(migrated.draftNodes).toEqual([{
            id: 'draft',
            parentNodeId: 'conversation-root:draft',
        }]);
    });

    it('normalizes partial pre-release states into v3 without duplicates', () => {
        const input = { kind: 'input-table', id: 'source', snapshot: { columns: [] } };
        const derived = { id: 'derived', derive: { source: ['source'] } };
        const semantics = { tableId: 'source', fields: { amount: { semanticType: 'Currency' } } };
        const migrated = migrateState({
            __stateVersion: 4,
            inputTables: [input],
            derivedTables: [derived],
            tableSemantics: [semantics],
            tables: [{ id: 'source' }, { id: 'derived', derive: {} }],
        });

        expect(migrated.inputTables).toEqual([input]);
        expect(migrated.derivedTables).toEqual([{ ...derived, parentNodeId: 'conversation-root:derived' }]);
        expect(migrated.tableSemantics).toEqual([semantics]);
        expect(migrated).not.toHaveProperty('tables');
        expect(migrated.__stateVersion).toBe(15);
    });

    it('upgrades an already split pre-release state to the current version', () => {
        const migrated = migrateState({
            __stateVersion: 5,
            inputTables: [{ kind: 'input-table', id: 'source' }],
            derivedTables: [],
            tableSemantics: [],
        });

        expect(migrated.__stateVersion).toBe(15);
        expect(migrated.inputTables).toEqual([{ kind: 'input-table', id: 'source' }]);
        expect(migrated.loadedTableNodes).toEqual([]);
    });

    it('moves loaded-table thread edges into reference nodes', () => {
        const migrated = migrateState({
            __stateVersion: 3,
            inputTables: [{
                kind: 'input-table',
                id: 'loaded-orders',
                displayId: 'Loaded orders',
                snapshot: { columns: [] },
                threadParentId: 'textTurn-load',
                addedAt: 42,
            }],
            derivedTables: [],
        });

        expect(migrated.inputTables[0]).not.toHaveProperty('threadParentId');
        expect(migrated.loadedTableNodes).toEqual([{
            kind: 'loaded-table',
            id: 'loaded-table-loaded-orders',
            tableId: 'loaded-orders',
            parentNodeId: 'textTurn-load',
            createdAt: 42,
        }]);
    });

    it('unifies authored table, draft, and report edges on parentNodeId', () => {
        const migrated = migrateState({
            __stateVersion: 4,
            inputTables: [],
            loadedTableNodes: [],
            derivedTables: [{
                id: 'result',
                threadParentId: 'textTurn-answer',
                derive: { trigger: { tableId: 'source' } },
            }],
            draftNodes: [{
                id: 'draft',
                derive: { trigger: { tableId: 'source' } },
            }],
            generatedReports: [{ id: 'report', triggerTableId: 'result' }],
        });

        expect(migrated.derivedTables[0]).toMatchObject({
            id: 'result',
            parentNodeId: 'textTurn-answer',
        });
        expect(migrated.derivedTables[0]).not.toHaveProperty('threadParentId');
        expect(migrated.draftNodes[0].parentNodeId).toBe('source');
        expect(migrated.generatedReports[0].parentNodeId).toBe('result');
        expect(migrated.__stateVersion).toBe(15);
    });

    it('preserves table labels when upgrading past the removed display-name migration', () => {
        const migrated = migrateState({
            __stateVersion: 4,
            inputTables: [
                { kind: 'input-table', id: 'movies', displayId: 'movies' },
                { kind: 'input-table', id: 'renamed', displayId: 'My movies' },
            ],
            derivedTables: [],
            tableSemantics: [
                { tableId: 'movies', displayName: 'Movies', fields: { year: { semanticType: 'Year' } } },
                { tableId: 'renamed', displayName: 'Suggested movies', fields: {} },
            ],
        });

        expect(migrated.inputTables[0].displayId).toBe('movies');
        expect(migrated.inputTables[1].displayId).toBe('My movies');
        expect(migrated.tableSemantics).toEqual([
            { tableId: 'movies', displayName: 'Movies', fields: { year: { semanticType: 'Year' } } },
            { tableId: 'renamed', displayName: 'Suggested movies', fields: {} },
        ]);
        expect(migrated.__stateVersion).toBe(15);
    });

    it('turns legacy workflow proposals into workflow form artifacts', () => {
        const workflowDefinition = { content: 'name: Fuel', definition: { name: 'Fuel', overview: '', deliverables: [] },
            saved: { path: 'fuel.workflow.yaml', content_hash: 'h' } };
        const migrated = migrateState({ __stateVersion: 8, textTurns: [{ id: 'proposal', workflowDefinition }, { id: 'plain' }] });

        expect(migrated.textTurns).toEqual([
            { id: 'proposal', form: { kind: 'workflow', title: 'Fuel', workflow: workflowDefinition } },
            { id: 'plain' },
        ]);
        expect(migrated.__stateVersion).toBe(15);
    });

    describe('v10: thread items and edges (design-docs/58)', () => {
        const parentOf = (state: any, id: string) => [state.textTurns, state.derivedTables, state.draftNodes,
            state.loadedTableNodes, state.fileNodes, state.generatedReports, state.artifactSets]
            .flat().find((node: any) => node?.id === id)?.parentNodeId;

        it('moves table and draft conversation into the messages before them', () => {
            const migrated = migrateState({ __stateVersion: 9, derivedTables: [{ id: 'sales', parentNodeId: 'orders', createdAt: 5,
                derive: { trigger: { interaction: [
                    { from: 'user', to: 'data-agent', role: 'prompt', content: 'Plot sales', attachments: ['a.csv'], timestamp: 1 },
                    { from: 'data-agent', to: 'user', role: 'instruction', content: 'Sales by month', timestamp: 2 },
                ] } } }],
            draftNodes: [{ kind: 'draft', id: 'draft', parentNodeId: 'sales', createdAt: 9, derive: { status: 'error', trigger: { interaction: [
                { from: 'user', to: 'data-agent', role: 'prompt', content: 'Now by region', timestamp: 8 },
                { from: 'data-agent', to: 'user', role: 'error', content: 'Failed', timestamp: 9 },
            ] } } }] });
            const [request, instruction, retry] = migrated.textTurns;
            expect(request).toMatchObject({ prompt: 'Plot sales', content: '', attachments: ['a.csv'], parentNodeId: 'orders', createdAt: 5 });
            expect(instruction).toMatchObject({ content: 'Sales by month', parentNodeId: request.id, createdAt: 2 });
            expect(migrated.derivedTables[0]).toMatchObject({ parentNodeId: instruction.id, derive: { trigger: { interaction: [] } } });
            expect(retry).toMatchObject({ prompt: 'Now by region', parentNodeId: 'sales' });
            expect(migrated.draftNodes[0].parentNodeId).toBe(retry.id);
            expect(migrated.draftNodes[0].derive.trigger.interaction).toEqual([expect.objectContaining({ role: 'error' })]);
        });

        it('splits a folded request and places what the run produced before its closing message', () => {
            const migrated = migrateState({ __stateVersion: 9,
                textTurns: [{ kind: 'text', id: 'closing', textKind: 'explain', prompt: 'Load and report',
                    content: 'Done.', parentNodeId: 'conversation-root:a', createdAt: 9_000, startedAt: 10 }],
                loadedTableNodes: [
                    { kind: 'loaded-table', id: 'l1', tableId: 't1', parentNodeId: 'closing', createdAt: 20 },
                    { kind: 'loaded-table', id: 'l2', tableId: 't2', parentNodeId: 'closing', createdAt: 21 },
                ],
                generatedReports: [{ id: 'report', parentNodeId: 'closing', createdAt: 5_000, status: 'completed' }],
            });
            const request = migrated.textTurns.find((turn: any) => turn.prompt === 'Load and report');
            expect(request).toMatchObject({ content: '', parentNodeId: 'conversation-root:a', createdAt: 10 });
            expect(migrated.textTurns.find((turn: any) => turn.id === 'closing')).not.toHaveProperty('prompt');
            // request → {l1, l2} → report → closing
            const [set] = migrated.artifactSets;
            expect(set).toMatchObject({ kind: 'artifact-set', parentNodeId: request.id, memberIds: ['l1', 'l2'] });
            expect([parentOf(migrated, 'l1'), parentOf(migrated, 'l2')]).toEqual([set.id, set.id]);
            expect(parentOf(migrated, 'report')).toBe(set.id);
            expect(parentOf(migrated, 'closing')).toBe('report');
        });

        it('turns an answer into the reply its continuation follows, keeping separate requests as branches', () => {
            const migrated = migrateState({ __stateVersion: 9, textTurns: [
                { kind: 'text', id: 'question', textKind: 'clarify', content: 'Which metric?', parentNodeId: 'orders',
                    createdAt: 1, answered: true, answer: 'Revenue', sourceFormId: 'form', revisedFile: 'app.jsx' },
                { kind: 'text', id: 'continued', textKind: 'explain', content: 'Revenue grew.', parentNodeId: 'question', createdAt: 3 },
                { kind: 'text', id: 'other', textKind: 'explain', prompt: 'Try margin', content: '', parentNodeId: 'question', createdAt: 4 },
            ], focusedId: { type: 'conversation', tableId: 'thread-orders', entryIndex: 0 } });
            const question = migrated.textTurns.find((turn: any) => turn.id === 'question');
            expect(question).toMatchObject({ answered: true });
            for (const field of ['answer', 'sourceFormId', 'revisedFile']) expect(question).not.toHaveProperty(field);
            const reply = migrated.textTurns.find((turn: any) => turn.prompt === 'Revenue');
            expect(reply).toMatchObject({ parentNodeId: 'question', content: '', createdAt: 2 });
            expect(parentOf(migrated, 'continued')).toBe(reply.id);
            expect(parentOf(migrated, 'other')).toBe('question');
            expect(migrated.focusedId).toEqual({ type: 'conversation', tableId: 'thread-orders' });
        });

        it('lays a workflow run out as request → outputs and messages → its record', () => {
            const run = { kind: 'text', id: 'textTurn-workflow-r1', textKind: 'explain', prompt: 'Run workflow: Sales',
                content: 'Finished.', parentNodeId: 'conversation-root:r1', createdAt: 1, outputIds: ['workflow-data-r1-a', 'workflow-report-r1'],
                workflow: { runId: 'r1', status: 'completed' } };
            const migrated = migrateState({ __stateVersion: 9, textTurns: [run,
                { kind: 'text', id: 'textTurn-workflow-message-m1', textKind: 'explain', prompt: 'Focus on Q4', content: 'Message received',
                    parentNodeId: run.id, createdAt: 3, workflowMessage: { runId: 'r1', messageId: 'm1', kind: 'steering', status: 'received',
                        afterOutputIds: ['workflow-data-r1-a'] } },
                { kind: 'text', id: 'textTurn-workflow-card-r1', textKind: 'explain', content: '', workflowCardFor: run.id,
                    parentNodeId: 'workflow-report-r1', createdAt: 1 },
                { kind: 'text', id: 'textTurn-workflow-completed-r1', textKind: 'explain', content: 'Done',
                    parentNodeId: 'textTurn-workflow-card-r1', createdAt: 5 },
                { kind: 'text', id: 'followup', textKind: 'explain', prompt: 'Explain it', content: '',
                    parentNodeId: 'textTurn-workflow-completed-r1', createdAt: 6 },
            ], loadedTableNodes: [{ kind: 'loaded-table', id: 'workflow-data-r1-a', tableId: 'a', parentNodeId: run.id, createdAt: 1 }],
            generatedReports: [{ id: 'workflow-report-r1', parentNodeId: 'workflow-data-r1-a', createdAt: 1, status: 'completed' }] });
            const request = migrated.textTurns.find((turn: any) => turn.id === 'textTurn-workflow-r1-request');
            expect(request).toMatchObject({ prompt: 'Run workflow: Sales', content: '', parentNodeId: 'conversation-root:r1' });
            expect(parentOf(migrated, 'workflow-data-r1-a')).toBe(request.id);
            expect(migrated.textTurns.find((turn: any) => turn.id === 'textTurn-workflow-message-m1'))
                .toMatchObject({ parentNodeId: 'workflow-data-r1-a', content: '', workflowMessage: { status: 'received' } });
            expect(parentOf(migrated, 'workflow-report-r1')).toBe('textTurn-workflow-message-m1');
            const record = migrated.textTurns.find((turn: any) => turn.id === run.id);
            expect(record).toMatchObject({ parentNodeId: 'workflow-report-r1', content: 'Finished.' });
            expect(record).not.toHaveProperty('prompt');
            expect(parentOf(migrated, 'followup')).toBe(run.id);
            expect(migrated.textTurns.map((turn: any) => turn.id)).not.toContain('textTurn-workflow-card-r1');
            expect(migrated.textTurns.map((turn: any) => turn.id)).not.toContain('textTurn-workflow-completed-r1');
        });

        it('leaves an unversioned state already in the new shape as it is', () => {
            // Browser-persisted payloads from before the slice carried a version re-run the chain.
            const state = { textTurns: [
                { kind: 'text', id: 'textTurn-workflow-r1-request', textKind: 'explain', prompt: 'Run workflow: Sales', content: '',
                    parentNodeId: 'conversation-root:r1', createdAt: 1 },
                { kind: 'text', id: 'textTurn-workflow-step-r1-o1', textKind: 'explain', content: 'Which region leads?',
                    parentNodeId: 'textTurn-workflow-r1-request', createdAt: 1 },
                { kind: 'text', id: 'textTurn-workflow-r1', textKind: 'explain', content: 'Done.', parentNodeId: 'regions',
                    createdAt: 1, outputIds: ['regions'], workflow: { runId: 'r1', status: 'completed' } },
            ], derivedTables: [{ id: 'regions', parentNodeId: 'textTurn-workflow-step-r1-o1', createdAt: 1,
                derive: { trigger: { tableId: 'sales', resultTableId: 'regions' } } }],
            loadedTableNodes: [{ kind: 'loaded-table', id: 'later', tableId: 't', parentNodeId: 'textTurn-workflow-r1', createdAt: 9 }] };
            const migrated = migrateState(JSON.parse(JSON.stringify(state)));
            for (const key of ['textTurns', 'derivedTables', 'loadedTableNodes'] as const) {
                expect(migrated[key].map((node: any) => [node.id, node.parentNodeId]))
                    .toEqual(state[key].map((node: any) => [node.id, node.parentNodeId]));
            }
            expect(migrated.artifactSets).toEqual([]);
        });

        it('does not add a reply when the continuation already carries it, and groups loaded batches', () => {
            const migrated = migrateState({ __stateVersion: 9, textTurns: [
                { kind: 'text', id: 'op', textKind: 'explain', content: 'Load these?', parentNodeId: 'root', createdAt: 1,
                    answered: true, answer: 'Load all' },
                { kind: 'text', id: 'reply', textKind: 'explain', prompt: 'Load all', content: '', parentNodeId: 'op', createdAt: 2 },
            ], loadedTableNodes: [
                { kind: 'loaded-table', id: 'a', tableId: 'a', parentNodeId: 'reply', createdAt: 10 },
                { kind: 'loaded-table', id: 'b', tableId: 'b', parentNodeId: 'reply', createdAt: 11 },
                { kind: 'loaded-table', id: 'later', tableId: 'c', parentNodeId: 'reply', createdAt: 60_000 },
            ] });
            expect(migrated.textTurns).toHaveLength(2);
            expect(migrated.artifactSets).toEqual([expect.objectContaining({ parentNodeId: 'reply', memberIds: ['a', 'b'] })]);
            expect(parentOf(migrated, 'later')).toBe(migrated.artifactSets[0].id);
            expect(migrateState(migrated)).toBe(migrated);
        });
    });

    it('v11: rebuilds a request a resumed run overwrote, from the question\'s trajectory', () => {
        const answer = 'There are no locally loaded tables.\n\n- **Security event data** in Kusto';
        const context = `[WORKSPACE INPUTS]\n...\n[/WORKSPACE INPUTS]\n\n[FOCUSED THREAD]\n\nStep 1:\n  User: let's check what we have\n  Analyst: ${answer}\n\n[USER QUESTION]\n\nSecurity event data in Kusto`;
        const migrated = migrateState({ __stateVersion: 10, textTurns: [
            { kind: 'text', id: 'earlier', textKind: 'explain', content: answer, parentNodeId: 'conversation-root:a', createdAt: 1 },
            { kind: 'text', id: 'run_prompt', textKind: 'explain', content: '', prompt: 'Compare all three',
                parentNodeId: 'question', actionId: 'run', createdAt: 30 },
            { kind: 'text', id: 'question', textKind: 'clarify', content: 'Which scenario?', parentNodeId: 'run_prompt',
                actionId: 'run', createdAt: 20, startedAt: 10, answered: true,
                resume: { trajectory: [{ role: 'system', content: 'You are…' }, { role: 'user', content: context }], completedStepCount: 1 } },
        ] });
        const request = migrated.textTurns.find((turn: any) => turn.prompt === 'Security event data in Kusto');
        expect(request).toMatchObject({ parentNodeId: 'earlier', content: '', createdAt: 10, actionId: 'run' });
        expect(migrated.textTurns.find((turn: any) => turn.id === 'question').parentNodeId).toBe(request.id);
        expect(migrated.textTurns.find((turn: any) => turn.id === 'run_prompt')).toMatchObject({ prompt: 'Compare all three', parentNodeId: 'question' });
        expect(migrateState(migrated)).toBe(migrated);
    });

    it('v12: drops from a set the sources its tables were queried from', () => {
        const ref = (key: string) => ({ id: `external:kusto:${key}`, connectorId: 'kusto', tableKey: key });
        const node = (id: string, tableId: string, external = false) =>
            ({ kind: 'loaded-table', id, tableId, parentNodeId: 'set', createdAt: 1, ...(external ? { external: true } : {}) });
        const migrated = migrateState({ __stateVersion: 11,
            externalTableReferences: [ref('Beats'), ref('Titan')],
            inputTables: [{ id: 'beats', sourceConfig: { importedFrom: { connectorId: 'kusto', tableKey: 'Beats' } } }],
            loadedTableNodes: [node('ref-beats', 'external:kusto:Beats', true), node('ref-titan', 'external:kusto:Titan', true), node('table-beats', 'beats'),
                { kind: 'loaded-table', id: 'single-ref', tableId: 'external:kusto:Beats', external: true, parentNodeId: 'pair', createdAt: 2 },
                { kind: 'loaded-table', id: 'single-table', tableId: 'beats', parentNodeId: 'pair', createdAt: 2 }],
            artifactSets: [{ kind: 'artifact-set', id: 'set', parentNodeId: 'ask', memberIds: ['ref-beats', 'ref-titan', 'table-beats'], createdAt: 1 },
                { kind: 'artifact-set', id: 'pair', parentNodeId: 'set', memberIds: ['single-ref', 'single-table'], createdAt: 2 }],
            textTurns: [{ kind: 'text', id: 'after', textKind: 'explain', content: 'Next', parentNodeId: 'pair', createdAt: 3 }],
        });
        // The queried source goes; a reference-only source stays a member.
        expect(migrated.artifactSets).toEqual([expect.objectContaining({ id: 'set', memberIds: ['ref-titan', 'table-beats'] })]);
        expect(migrated.externalTableReferences).toHaveLength(2);
        // A set left with one member becomes that item, and what followed the set follows it.
        const parentOf = (id: string) => migrated.loadedTableNodes.concat(migrated.textTurns).find((item: any) => item.id === id)?.parentNodeId;
        expect(migrated.loadedTableNodes.map((item: any) => item.id)).not.toContain('single-ref');
        expect(parentOf('single-table')).toBe('set');
        expect(parentOf('after')).toBe('single-table');
    });

    it('v13: drops the table code a step listed as a call, keeping the step message', () => {
        const python = { id: 'code_run_1', tool: 'execute_python_script', purpose: 'Check coverage', code: 'print(1)', status: 'completed' };
        const migrated = migrateState({ __stateVersion: 12, textTurns: [
            { kind: 'text', id: 'step', textKind: 'explain', content: 'Exploration step 1: ', parentNodeId: 'set', createdAt: 1,
                codeExecutions: [python, { id: 'code-d_result', tool: 'visualize', purpose: 'Exploration step 1: ', code: 'df', status: 'completed' }] },
            { kind: 'text', id: 'named', textKind: 'explain', content: 'Compare severity', parentNodeId: 'd_result', createdAt: 2,
                codeExecutions: [{ id: 'code-d_two', tool: 'visualize', purpose: 'Compare severity', code: 'df', status: 'completed' }] },
        ] });
        expect(migrated.textTurns[0]).toMatchObject({ content: 'Exploration step 1: ', toolCalls: [{ id: 'code_run_1',
            tool: 'execute_python_script', args: { code: 'print(1)', purpose: 'Check coverage' }, status: 'completed' }] });
        expect(migrated.textTurns[1].content).toBe('Compare severity');
        expect(migrated.textTurns[1]).not.toHaveProperty('codeExecutions');
        expect(migrated.textTurns[1]).not.toHaveProperty('toolCalls');
    });

    it('v15: keeps code calls as tool-call records with their code, output and error', () => {
        const migrated = migrateState({ __stateVersion: 14, textTurns: [
            { kind: 'text', id: 'step', textKind: 'explain', content: '', parentNodeId: 'root', createdAt: 1,
                codeExecutions: [{ id: 'python', tool: 'execute_python_script', purpose: 'Find the latest year', code: 'print(2025)',
                    output: '2025', status: 'completed', createdAt: 5 },
                    { id: 'broken', tool: 'execute_python_script', purpose: '', code: 'x', error: 'NameError', status: 'failed' }] },
            { kind: 'text', id: 'plain', textKind: 'explain', content: 'Hi', parentNodeId: 'step', createdAt: 2 },
        ] });
        expect(migrated.textTurns[0]).not.toHaveProperty('codeExecutions');
        expect(migrated.textTurns[0].toolCalls).toEqual([
            { id: 'python', tool: 'execute_python_script', status: 'completed', args: { code: 'print(2025)', purpose: 'Find the latest year' },
                output: '2025', createdAt: 5 },
            { id: 'broken', tool: 'execute_python_script', status: 'failed', args: { code: 'x' }, error: 'NameError' },
        ]);
        expect(migrated.textTurns[1]).not.toHaveProperty('toolCalls');
    });

    it('v14: moves a follow-up on an app after the conversation still open there', () => {
        const turn = (id: string, parentNodeId: string, createdAt: number, extra = {}) =>
            ({ kind: 'text', id, textKind: 'explain', content: '', parentNodeId, createdAt, ...extra });
        const migrated = migrateState({ __stateVersion: 13,
            fileNodes: [{ kind: 'file', id: 'file-app', path: 'app.app.jsx', parentNodeId: 'build', createdAt: 2 },
                { kind: 'file', id: 'file-app_2', path: 'app_2.app.jsx', parentNodeId: 'fix', createdAt: 6 }],
            textTurns: [turn('build', 'conversation-root:a', 1, { prompt: 'Build an app' }),
                turn('built', 'file-app', 3, { content: 'Built it.' }),
                turn('fix', 'file-app', 5, { prompt: 'Fix the errors' }),
                // Nothing followed the second app yet when this was asked, so it stays on the app.
                turn('tweak', 'file-app_2', 6.5, { prompt: 'Tweak the colors' }),
                turn('fixed', 'file-app_2', 7, { content: 'Fixed.' })],
        });
        const parentOf = (id: string) => migrated.textTurns.find((item: any) => item.id === id)?.parentNodeId;
        expect(parentOf('fix')).toBe('built');
        expect(parentOf('tweak')).toBe('file-app_2');
        expect(migrated.__stateVersion).toBe(15);
    });
});
