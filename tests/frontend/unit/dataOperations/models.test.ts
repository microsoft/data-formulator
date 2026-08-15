import { describe, expect, it } from 'vitest';

import { parseDataOperation } from '../../../../src/dataOperations/models';

const operationPayload = () => ({
    schema_version: 1,
    id: 'operation-1',
    status: 'awaiting_selection',
    reason: 'Analyze recent demand',
    description: 'I found recent orders that match the analysis request.',
    plans: [{
        id: 'plan-1',
        hash: 'a'.repeat(64),
        label: 'Recent orders',
        summary: 'Orders since January',
        steps: [{
            kind: 'connector_query',
            display_name: 'Recent orders',
        }],
    }],
});

describe('parseDataOperation', () => {
    it('maps the versioned wire contract to a detached view model', () => {
        const payload = operationPayload();
        const operation = parseDataOperation(payload);
        payload.plans[0].steps[0].display_name = 'Changed after parsing';

        expect(operation.schemaVersion).toBe(1);
        expect(operation.description).toBe('I found recent orders that match the analysis request.');
        expect(operation.plans[0].steps[0]).toMatchObject({
            kind: 'connector_query',
            displayName: 'Recent orders',
        });
    });

    it('parses optional discovery canvas presentation', () => {
        const payload = operationPayload();
        Object.assign(payload, {
            canvas_title: 'Engagement datasets',
            canvas_summary: 'Compare movie and show engagement.',
        });
        payload.plans[0].summary = 'Best for title-level analysis.';

        const operation = parseDataOperation(payload);

        expect(operation.canvasTitle).toBe('Engagement datasets');
        expect(operation.canvasSummary).toBe('Compare movie and show engagement.');
        expect(operation.plans[0].summary).toBe('Best for title-level analysis.');
    });

    it('rejects an unsupported schema version', () => {
        expect(() => parseDataOperation({
            ...operationPayload(),
            schema_version: 2,
        })).toThrow('Unsupported data operation schema version');
    });

    it('rejects a selected plan outside the operation', () => {
        expect(() => parseDataOperation({
            ...operationPayload(),
            selected_plan_id: 'missing-plan',
        })).toThrow('selected_plan_id');
    });

    it('rejects malformed plan hashes', () => {
        const payload = operationPayload();
        payload.plans[0].hash = 'not-a-hash';

        expect(() => parseDataOperation(payload)).toThrow('SHA-256');
    });

    it('parses partial results and structured step failures', () => {
        const operation = parseDataOperation({
            ...operationPayload(),
            status: 'partially_loaded',
            result_table_ids: ['recent_orders'],
            failed_steps: [{
                step_index: 1,
                display_name: 'Customers',
                error: { code: 'connector_error', message: 'Customers could not be loaded.' },
            }],
        });

        expect(operation.resultTableIds).toEqual(['recent_orders']);
        expect(operation.failedSteps).toEqual([{
            stepIndex: 1,
            displayName: 'Customers',
            error: { code: 'connector_error', message: 'Customers could not be loaded.' },
        }]);
    });
});