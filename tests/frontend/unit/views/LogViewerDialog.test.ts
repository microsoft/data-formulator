import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { openSearchPanel, search } from '@codemirror/search';
import { describe, expect, it } from 'vitest';

import { createSavedStateSearchPanel, getSavedStateAutoFoldRanges } from '../../../../src/views/LogViewerDialog';

describe('saved-state auto folding', () => {
    it('folds only the configured array-aware state paths', () => {
        const doc = JSON.stringify({
            inputTables: [{ snapshot: { columns: [{ name: 'title' }] }, rows: [1] }],
            derivedTables: [{
                snapshot: { keep: 'open' },
                rows: [{ title: 'Movie' }],
                metadata: { title: { levels: ['Movie'] } },
                derive: {
                    dialog: [{ role: 'user' }],
                    explanation: { code: 'Groups movies', concepts: [{ field: 'title' }] },
                    trigger: { interaction: [{ role: 'instruction' }] },
                    source: ['movies'],
                },
            }],
            draftNodes: [{
                derive: {
                    dialog: [{ role: 'assistant' }],
                    trigger: { interaction: [{ role: 'clarify' }] },
                    pendingClarification: { trajectory: [{ step: 1 }], completedStepCount: 1 },
                },
            }],
            charts: [{ styleVariants: [{ vlSpec: { mark: 'bar' } }] }],
            generatedReports: [{ inspectionSteps: [{ label: 'Inspect chart' }] }],
            textTurns: [{
                options: [{ label: 'Use Movies' }],
                form: { kind: 'connector' },
                dataOperation: { candidates: ['movies'] },
                resume: { trajectory: [{ step: 2 }], completedStepCount: 2 },
            }],
            dataLoadingChatMessages: [{
                role: 'assistant',
                content: 'Found data',
                codeBlocks: [{ code: 'load()' }],
                tables: [{ name: 'Movies' }],
                loadPlan: { steps: [{ action: 'load' }] },
                dataOperation: { candidates: ['movies'] },
                connectorForm: { sourceType: 'postgresql' },
            }],
            snapshot: { keep: 'open' },
        }, null, 2);
        const state = EditorState.create({ doc, extensions: [json()] });

        const foldedContents = getSavedStateAutoFoldRanges(state)
            .map(range => state.doc.sliceString(range.from, range.to));

        expect(foldedContents).toHaveLength(20);
        expect(foldedContents.some(content => content.includes('"columns"'))).toBe(true);
        expect(foldedContents.some(content => content.includes('"title": "Movie"'))).toBe(true);
        expect(foldedContents.some(content => content.includes('"role": "user"'))).toBe(true);
        expect(foldedContents.some(content => content.includes('"concepts"'))).toBe(true);
        expect(foldedContents.some(content => content.includes('"vlSpec"'))).toBe(true);
        expect(foldedContents.some(content => content.includes('"Inspect chart"'))).toBe(true);
        expect(foldedContents.some(content => content.includes('"sourceType": "postgresql"'))).toBe(true);
        expect(foldedContents.some(content => content.includes('"keep": "open"'))).toBe(false);
        expect(foldedContents.some(content => content.includes('"content": "Found data"'))).toBe(false);
    });

    it('uses a minimal search panel without browser suggestions', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc: '{"tableSemantics": []}',
                extensions: [search({ createPanel: createSavedStateSearchPanel })],
            }),
        });

        openSearchPanel(view);
        const panel = view.dom.querySelector('.cm-search')!;
        const input = panel.querySelector('input')!;

        expect(input.name).toBe('df-saved-state-find');
        expect(input.autocomplete).toBe('off');
        expect(input.getAttribute('autocorrect')).toBe('off');
        expect(input.getAttribute('spellcheck')).toBe('false');
        expect([...panel.querySelectorAll('button')].map(button => button.name)).toEqual([
            'next', 'prev', 'select', 'close',
        ]);
        expect(panel.querySelectorAll('label')).toHaveLength(0);

        view.destroy();
        parent.remove();
    });
});