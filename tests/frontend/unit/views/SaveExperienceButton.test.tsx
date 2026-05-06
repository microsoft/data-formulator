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
                'knowledge.distillHint': 'Distill experience hint',
                'knowledge.distillFromHeading': 'Distill from',
                'knowledge.distillingOverlay': 'Distilling experience…',
                'knowledge.distillStarted': 'Distilling experience...',
                'knowledge.distilling': 'Distilling experience...',
                'knowledge.distilled': 'Experience saved',
                'knowledge.distillFailedRetry': 'Save failed, retry',
                'knowledge.distillExperience': 'Distill',
                'knowledge.userInstruction': 'User instruction (optional)',
                'knowledge.userInstructionPlaceholder': 'what to focus on, what to skip…',
                'app.cancel': 'Cancel',
                'report.noModelSelected': 'No model selected',
            };
            return labels[key] ?? key;
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

    it('keeps the dialog open with an overlay during distill, then closes on success and asks to open the knowledge panel', async () => {
        const root = makeTable('root');
        const leaf = makeDerivedTable('leaf', 'root');
        let resolveDistill!: () => void;
        vi.mocked(distillExperience).mockReturnValue(new Promise(resolve => {
            resolveDistill = () => resolve({ path: 'sales-by-region.md', category: 'experiences' });
        }));
        const onKnowledgeChanged = vi.fn();
        const onOpenKnowledgePanel = vi.fn();
        window.addEventListener('knowledge-changed', onKnowledgeChanged);
        window.addEventListener('open-knowledge-panel', onOpenKnowledgePanel);

        render(<SaveExperienceButton table={leaf} tables={[root, leaf]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Save as Experience' }));
        fireEvent.click(screen.getByRole('button', { name: 'Distill' }));

        // Dialog stays open while distilling — the overlay communicates progress.
        await waitFor(() => {
            expect(screen.getByText('Distilling experience…')).toBeInTheDocument();
        });
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        // Both action buttons are disabled during distillation.
        expect(screen.getByRole('button', { name: 'Distilling experience...' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

        resolveDistill();

        // Once the distillation resolves, the dialog closes and the
        // knowledge panel is asked to open with the new experience path.
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            payload: expect.objectContaining({
                type: 'success',
                component: 'knowledge',
                value: 'Experience saved',
            }),
        }));
        expect(onKnowledgeChanged).toHaveBeenCalled();
        expect(onOpenKnowledgePanel).toHaveBeenCalled();
        const openEvent = onOpenKnowledgePanel.mock.calls[0][0] as CustomEvent;
        expect(openEvent.detail).toMatchObject({
            category: 'experiences',
            path: 'sales-by-region.md',
        });

        window.removeEventListener('knowledge-changed', onKnowledgeChanged);
        window.removeEventListener('open-knowledge-panel', onOpenKnowledgePanel);
    });

    it('keeps the dialog open with re-enabled buttons after a distillation failure', async () => {
        const root = makeTable('root');
        const leaf = makeDerivedTable('leaf', 'root');
        const error = new Error('Request timed out');
        vi.mocked(distillExperience).mockRejectedValue(error);

        render(<SaveExperienceButton table={leaf} tables={[root, leaf]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Save as Experience' }));
        fireEvent.click(screen.getByRole('button', { name: 'Distill' }));

        await waitFor(() => {
            expect(handleApiError).toHaveBeenCalledWith(error, 'knowledge');
        });

        // The dialog stays open so the user can retry without losing context.
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        // Both action buttons are re-enabled so the user can retry or cancel.
        const distillBtn = screen.getByRole('button', { name: 'Distill' });
        const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
        expect(distillBtn).toBeEnabled();
        expect(cancelBtn).toBeEnabled();

        // Cancel closes the dialog cleanly.
        fireEvent.click(cancelBtn);
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
    });

    it('renders hint, Distill from panel, and User instruction in the dialog', () => {
        const root = makeTable('root');
        const leaf = makeDerivedTable('leaf', 'root');
        render(<SaveExperienceButton table={leaf} tables={[root, leaf]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Save as Experience' }));

        // Hint line
        expect(screen.getByText('Distill experience hint')).toBeInTheDocument();
        // Distill from heading
        expect(screen.getByText('Distill from')).toBeInTheDocument();
        // The user prompt is rendered as a flat event line.
        expect(screen.getByText(/\[user→data-agent\/prompt\] Show sales trend/)).toBeInTheDocument();
        // The create_table side-effect for the leaf step is rendered.
        expect(screen.getByText(/\[create_table via=visualize\] leaf/)).toBeInTheDocument();
        // User instruction field is rendered with optional label
        expect(screen.getByLabelText(/User instruction \(optional\)/)).toBeInTheDocument();
    });

    it('renders one create_table line per derived table across a multi-step chain', () => {
        const root = makeTable('root');
        const t1 = makeDerivedTable('t1', 'root');
        t1.derive!.trigger.interaction = [{
            from: 'user', to: 'data-agent', role: 'instruction', content: 'load gasoline prices',
        }];
        const t2 = makeDerivedTable('t2', 't1');
        t2.derive!.trigger.interaction = [{
            from: 'user', to: 'data-agent', role: 'instruction', content: 'filter to 2024',
        }];
        const leaf = makeDerivedTable('leaf', 't2');
        leaf.derive!.trigger.interaction = [{
            from: 'user', to: 'data-agent', role: 'instruction', content: 'which fuel grade is highest',
        }];

        render(<SaveExperienceButton table={leaf} tables={[root, t1, t2, leaf]} />);
        fireEvent.click(screen.getByRole('button', { name: 'Save as Experience' }));

        // One create_table line per derived table on the visible chain.
        expect(screen.getByText(/\[create_table via=visualize\] t1/)).toBeInTheDocument();
        expect(screen.getByText(/\[create_table via=visualize\] t2/)).toBeInTheDocument();
        expect(screen.getByText(/\[create_table via=visualize\] leaf/)).toBeInTheDocument();
        // Each user instruction renders as its own message event line.
        expect(screen.getByText(/\[user→data-agent\/instruction\] load gasoline prices/)).toBeInTheDocument();
        expect(screen.getByText(/\[user→data-agent\/instruction\] filter to 2024/)).toBeInTheDocument();
        expect(screen.getByText(/\[user→data-agent\/instruction\] which fuel grade is highest/)).toBeInTheDocument();
    });
});
