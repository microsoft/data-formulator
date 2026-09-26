import { describe, expect, it } from 'vitest';

import { stripConnectorPrefillFromEntries } from '../../../../src/app/connectorFormPersistence';
import { dataFormulatorReducer, dfActions, dfSelectors } from '../../../../src/app/dfSlice';

describe('connector form persistence', () => {
    it('keeps one form artifact across explanations and rejects stale or sensitive edits', () => {
        let state = dataFormulatorReducer(undefined, { type: 'init' });
        state = dataFormulatorReducer(state, dfActions.addTextTurn({
            kind: 'text', id: 'form-1', displayId: 'form-1', textKind: 'explain', content: 'Connect MySQL',
            createdAt: 1, form: { kind: 'connector', title: 'MySQL', connector: { sourceType: 'mysql', status: 'pending' } },
        }));
        state = dataFormulatorReducer(state, dfActions.initializeConnectorDraft({ id: 'form-1', fields: ['host'] }));
        state = dataFormulatorReducer(state, dfActions.patchConnectorDraft({ id: 'form-1', revision: 0,
            values: { host: 'agent.example', password: 'secret', unknown: 'bad' } }));
        expect(state.dataLoaderConnectParams['connector-form:form-1']).toEqual({ host: 'agent.example' });
        state = dataFormulatorReducer(state, dfActions.updateDataLoaderConnectParam({
            dataLoaderType: 'connector-form:form-1', paramName: 'host', paramValue: 'user.example',
        }));
        state = dataFormulatorReducer(state, dfActions.patchConnectorDraft({ id: 'form-1', revision: 1, values: { host: 'late.example' } }));
        expect(state.dataLoaderConnectParams['connector-form:form-1'].host).toBe('user.example');
        expect(state.textTurns[0].form?.draft?.conflict).toBe(true);
        state = dataFormulatorReducer(state, dfActions.addTextTurn({
            kind: 'text', id: 'follow-up', displayId: 'follow-up', textKind: 'explain',
            content: 'A long explanation '.repeat(100), createdAt: 2, sourceFormId: 'form-1', parentNodeId: 'form-1',
        }));
        state = dataFormulatorReducer(state, dfActions.setFocused({ type: 'text', textId: 'follow-up' }));
        expect(dfSelectors.selectCanvasTarget(state)).toEqual({ type: 'text', textId: 'form-1' });
        expect(state.textTurns.filter(turn => turn.form)).toHaveLength(1);
    });
    it('removes transient prefills from standalone chat messages', () => {
        const entries = [{
            id: 'entry-1',
            connectorForm: {
                sourceType: 'postgresql',
                status: 'pending',
                prefilled: { host: 'db.example.com', password: 'secret' },
            },
        }];

        expect(stripConnectorPrefillFromEntries(entries)).toEqual([{
            id: 'entry-1',
            connectorForm: {
                sourceType: 'postgresql',
                status: 'pending',
            },
        }]);
        expect(entries[0].connectorForm.prefilled.password).toBe('secret');
    });

    it('removes transient prefills from generalized form artifacts', () => {
        const entries = [{
            id: 'turn-1',
            form: {
                kind: 'connector',
                title: 'Connect to PostgreSQL',
                connector: {
                    sourceType: 'postgresql',
                    status: 'pending',
                    prefilled: { host: 'db.example.com', password: 'secret' },
                },
            },
        }];

        expect(stripConnectorPrefillFromEntries(entries)).toEqual([{
            id: 'turn-1',
            form: {
                kind: 'connector',
                title: 'Connect to PostgreSQL',
                connector: {
                    sourceType: 'postgresql',
                    status: 'pending',
                },
            },
        }]);
        expect(entries[0].form.connector.prefilled.password).toBe('secret');
    });
});