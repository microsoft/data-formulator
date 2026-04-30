import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveExperienceButton } from '../../../../src/views/SaveExperienceButton';
import { distillExperience } from '../../../../src/api/knowledgeApi';
import { handleApiError } from '../../../../src/app/errorHandler';
import type { DictTable } from '../../../../src/components/ComponentType';

const { dispatch, mockState } = vi.hoisted(() => ({
    dispatch: vi.fn(),
    mockState: {
        selectedModelId: 'model-1',
        globalModels: [],
        models: [{
            id: 'model-1',
            endpoint: 'openai',
            model: 'gpt-4o',
            api_key: 'test-key',
        }],
    },
}));

vi.mock('react-redux', () => ({
    useDispatch: () => dispatch,
    useSelector: (selector: (state: any) => unknown) => selector(mockState),
}));

vi.mock('react-i18next', () => ({
    initReactI18next: {
        type: '3rdParty',
        init: vi.fn(),
    },
    useTranslation: () => ({
        t: (key: string) => {
            const labels: Record<string, string> = {
                'knowledge.saveAsExperience': 'Save as Experience',
                'knowledge.saveAsExperienceTitle': 'Save as Experience',
                'knowledge.saveAsExperienceHint': 'AI will distill the analysis into a reusable experience',
                'knowledge.categoryHint': 'Sub-directory (optional)',
                'knowledge.categoryHintPlaceholder': 'e.g. sales-analysis',
                'knowledge.distillStarted': 'Distilling experience...',
                'knowledge.distilling': 'Distilling experience...',
                'knowledge.distilled': 'Experience saved',
                'knowledge.distillFailedRetry': 'Save failed, retry',
                'knowledge.save': 'Save',
                'app.cancel': 'Cancel',
                'report.noModelSelected': 'No model selected',
            };
            return labels[key] || key;
        },
    }),
}));

vi.mock('../../../../src/api/knowledgeApi', () => ({
    distillExperience: vi.fn(),
}));

vi.mock('../../../../src/app/errorHandler', () => ({
    handleApiError: vi.fn(),
}));

function makeTable(id: string, overrides?: Partial<DictTable>): DictTable {
    return {
        kind: 'table',
        id,
        displayId: id,
        names: ['sales'],
        metadata: { sales: { type: 'number' } },
        rows: [{ sales: 10 }],
        virtual: { tableId: id, rowCount: 1 },
        anchored: false,
        attachedMetadata: '',
        ...overrides,
    } as DictTable;
}

function makeDerivedTable(id: string, parentId: string): DictTable {
    return makeTable(id, {
        derive: {
            source: [parentId],
            code: 'df = ...',
            outputVariable: 'result_df',
            dialog: [{ role: 'system', content: 'system prompt' }],
            trigger: {
                tableId: parentId,
                resultTableId: id,
                interaction: [{
                    from: 'user',
                    to: 'data-agent',
                    role: 'prompt',
                    content: 'Show sales trend',
                }],
            },
        },
    });
}

describe('SaveExperienceButton', () => {
    beforeEach(() => {
        dispatch.mockClear();
        vi.mocked(distillExperience).mockReset();
        vi.mocked(handleApiError).mockReset();
    });

    afterEach(() => {
        cleanup();
    });

    it('closes the dialog immediately and reports background distillation progress', async () => {
        const root = makeTable('root');
        const leaf = makeDerivedTable('leaf', 'root');
        let resolveDistill!: () => void;
        vi.mocked(distillExperience).mockReturnValue(new Promise(resolve => {
            resolveDistill = () => resolve({ path: 'leaf.md', category: 'experiences' });
        }));
        const onKnowledgeChanged = vi.fn();
        window.addEventListener('knowledge-changed', onKnowledgeChanged);

        render(<SaveExperienceButton table={leaf} tables={[root, leaf]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Save as Experience' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            payload: expect.objectContaining({
                type: 'info',
                component: 'knowledge',
                value: 'Distilling experience...',
            }),
        }));
        expect(screen.getByRole('button', { name: 'Distilling experience...' })).toBeDisabled();

        resolveDistill();

        await waitFor(() => {
            expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
                payload: expect.objectContaining({
                    type: 'success',
                    component: 'knowledge',
                    value: 'Experience saved',
                }),
            }));
        });
        expect(screen.getByRole('button', { name: 'Save as Experience' })).toBeEnabled();
        expect(onKnowledgeChanged).toHaveBeenCalled();
        window.removeEventListener('knowledge-changed', onKnowledgeChanged);
    });

    it('uses the unified API error handler for distillation failures', async () => {
        const root = makeTable('root');
        const leaf = makeDerivedTable('leaf', 'root');
        const error = new Error('Request timed out');
        vi.mocked(distillExperience).mockRejectedValue(error);

        render(<SaveExperienceButton table={leaf} tables={[root, leaf]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Save as Experience' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(handleApiError).toHaveBeenCalledWith(error, 'knowledge');
        });
        const retryButton = await screen.findByRole('button', { name: 'Save failed, retry' });
        expect(retryButton).toBeEnabled();

        fireEvent.click(retryButton);

        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
});
