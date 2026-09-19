import React from 'react';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClarificationPanel, ExplanationPanel } from '../../../../src/views/AgentPausePanel';
import { parseDataOperation } from '../../../../src/dataOperations/models';
import type { ClarificationResponse } from '../../../../src/components/ComponentType';
import { migrateState } from '../../../../src/app/stateMigrations';

vi.mock('react-i18next', () => ({
  // The panel now lives in `AgentPausePanel.tsx` which transitively pulls
  // in `dfSlice` → `i18n/index` → `.use(initReactI18next)`. Provide a no-op
  // plugin shim so the i18n init code path succeeds under the mock.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      const labels: Record<string, string> = {
        'chartRec.skipAnswer': 'Skip',
        'chartRec.clarificationTitle': 'Agent needs clarification',
        'chartRec.clarificationQuestionLabel': `${params?.index}.`,
        'chartRec.optionalClarification': '(optional)',
        'chartRec.freeTextClarificationPlaceholder': 'Type your answer...',
        'chartRec.customAnswerPlaceholder': 'Or type your own answer...',
        'chartRec.confirmAnswer': 'Confirm answer',
        'chartRec.freeTextClarificationHint': 'Type your answer in the chat box below.',
        'dataLoading.operation.title': 'Data loading options',
        'dataLoading.operation.status.awaitingSelection': 'Awaiting selection',
        'dataLoading.operation.load': 'Load',
        'dataLoading.operation.discuss': 'Discuss options',
      };
      return labels[key] || key;
    },
  }),
}));

describe('ClarificationPanel', () => {
  it('opens commands collapsed and allows expansion inside the panel', () => {
    const executions = [{
      id: 'check', argv: ['az', 'account', 'show'], cwd: '/workspace', purpose: 'Check account access.',
      status: 'completed' as const, result: { exit_code: 0, output: 'Reader access confirmed' },
    }, {
      id: 'list', argv: ['az', 'account', 'list'], cwd: '/workspace', purpose: 'List accounts.',
      status: 'completed' as const, result: { exit_code: 0, output: 'Other account output' },
    }];
    const panel = <ExplanationPanel content="Check account access."
      executions={executions} onClose={vi.fn()} onDelete={vi.fn()} />;
    const view = render(panel);
    expect(screen.getByText('Check account access.')).toBeInTheDocument();
    expect(screen.queryByText('Reader access confirmed')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { expanded: false })[0]);
    expect(screen.getByText('Reader access confirmed')).toBeInTheDocument();
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
    expect(screen.queryByText('Other account output')).not.toBeInTheDocument();
    view.unmount();
    render(panel);
    expect(screen.queryByText('Reader access confirmed')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(2);
  });

  it('shows legacy terminal JSON through the collapsed execution display', () => {
    const legacy = [
      'Check Azure access.',
      '',
      '```json',
      JSON.stringify({ argv: ['bash', '-lc', 'set -euo pipefail\nprintf "done\\n"'], cwd: '/workspace' }, null, 2),
      '```',
    ].join('\n');

    const migrated = migrateState({ __stateVersion: 6, textTurns: [{ id: 'legacy', content: legacy }] }).textTurns[0];
    const { container } = render(
      <ExplanationPanel content={migrated.content} executions={migrated.executions} onClose={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container.querySelector('pre')).toBeNull();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const commandBlock = container.querySelector('pre');
    expect(commandBlock).not.toBeNull();
    expect(commandBlock?.textContent).toContain('set -euo pipefail');
    expect(container.textContent).toContain('terminal.directory: /workspace');
    expect(container.textContent).not.toContain('"argv"');
  });

  it('allows skipping, editing, and submitting a free-text answer alongside a choice', () => {
    const onSubmit = vi.fn();
    const questions = [
      { text: 'Anything else?', responseType: 'free_text' as const },
      { text: 'Which metric?', responseType: 'single_choice' as const, options: [{ label: 'Revenue' }] },
    ];
    const Harness = () => {
      const [answers, setAnswers] = React.useState<Record<number, ClarificationResponse>>({});
      return <ClarificationPanel questions={questions} onSubmit={onSubmit} onClose={() => {}}
        {...{
          selectedAnswers: answers,
          onSelectAnswer: (index: number, response: ClarificationResponse, autoSubmit = true) => {
            expect(autoSubmit).toBe(false);
            setAnswers(previous => ({ ...previous, [index]: response }));
          },
          onClearAnswer: (index: number) => setAnswers(previous => {
            const next = { ...previous }; delete next[index]; return next;
          }),
        }} />;
    };
    render(<Harness />);
    const skip = screen.getByRole('button', { name: 'Skip' });
    const submit = screen.getByRole('button', { name: 'chartRec.submitClarification' });
    fireEvent.click(skip);
    expect(skip).toHaveAttribute('aria-pressed', 'true');
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Revenue' }));
    expect(submit).toBeEnabled();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(skip);
    expect(submit).toBeDisabled();
    const input = screen.getByPlaceholderText('Type your answer...');
    fireEvent.change(input, { target: { value: 'Draft answer' } });
    fireEvent.click(skip);
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'Revised answer' } });
    expect(skip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(skip);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith([
      { question_index: 0, source: 'skip', answer: 'Skip' },
      { question_index: 1, source: 'option', answer: 'Revenue' },
    ]);
  });

  const operation = parseDataOperation({
    schema_version: 1,
    id: 'operation-1',
    status: 'awaiting_selection',
    reason: 'Choose data to load',
    plans: [{
      id: 'plan-1',
      hash: 'a'.repeat(64),
      label: 'Recent orders',
      summary: 'Last 90 days',
      steps: [{ kind: 'connector_query', display_name: 'Orders' }],
    }],
  });

  const operationQuestion = [{
    text: 'Choose data to load',
    responseType: 'single_choice' as const,
    options: [
      { label: 'Recent orders', value: 'plan-1' },
      { label: 'Elaborate', value: 'elaborate' },
    ],
  }];

  it('selects an operation plan without submitting until Continue is clicked', () => {
    const onSubmit = vi.fn();
    const onSelectAnswer = vi.fn();
    const props = {
      questions: operationQuestion,
      dataOperation: operation,
      onSelectAnswer,
      onSubmit,
      onClose: vi.fn(),
      onDelete: vi.fn(),
    };
    const { rerender } = render(<ClarificationPanel {...props} />);

    // The finding reads with the options, and only once.
    expect(screen.getAllByText('Choose data to load')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Elaborate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discuss options' })).toBeNull();
    expect(screen.getByRole('button', { name: 'chartRec.submitClarification' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Recent orders/ }));

    expect(onSelectAnswer).toHaveBeenCalledWith(0, {
      question_index: 0,
      answer: 'Recent orders',
      value: 'plan-1',
      source: 'option',
    }, false);
    expect(onSubmit).not.toHaveBeenCalled();

    const selected = { question_index: 0, answer: 'Recent orders', value: 'plan-1', source: 'option' as const };
    rerender(<ClarificationPanel {...props} selectedAnswers={{ 0: selected }} />);
    fireEvent.click(screen.getByRole('button', { name: 'chartRec.submitClarification' }));

    expect(onSubmit).toHaveBeenCalledWith([selected]);
  });

  it('offers only the loading options, leaving other requests to the chat input', () => {
    render(
      <ClarificationPanel
        questions={operationQuestion}
        dataOperation={operation}
        onSelectAnswer={vi.fn()}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Recent orders/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('submits a single-choice question immediately when an option is clicked', () => {
    const onSubmit = vi.fn();

    render(
      <ClarificationPanel
        questions={[{
          text: 'Which metric?',
          responseType: 'single_choice',
          options: [{ label: 'Revenue' }],
        }]}
        onSubmit={onSubmit}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Revenue' }));

    expect(onSubmit).toHaveBeenCalledWith([{
      question_index: 0,
      answer: 'Revenue',
      source: 'option',
    }]);
  });

  it('records partial selections via onSelectAnswer without submitting', () => {
    const onSubmit = vi.fn();
    const onSelectAnswer = vi.fn();

    render(
      <ClarificationPanel
        questions={[
          {
            text: 'Which metric?',
            responseType: 'single_choice',
            options: [{ label: 'Revenue' }],
          },
          {
            text: 'Which period?',
            responseType: 'single_choice',
            options: [{ label: 'Last 12 months' }],
          },
        ]}
        onSelectAnswer={onSelectAnswer}
        onSubmit={onSubmit}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Revenue' }));

    expect(onSelectAnswer).toHaveBeenCalledWith(0, {
      question_index: 0,
      answer: 'Revenue',
      source: 'option',
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders an inline input under a free-text question and submits it tagged to that question', () => {
    const onSubmit = vi.fn();

    render(
      <ClarificationPanel
        questions={[{
          text: 'Anything else to share?',
          responseType: 'free_text',
        }]}
        onSubmit={onSubmit}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    // No "use the chat box" hint anymore — the panel is self-contained.
    expect(screen.queryByText('Type your answer in the chat box below.')).toBeNull();

    // The input sits inline under the question (its own answer field), not the
    // choice-only override.
    const input = screen.getByPlaceholderText('Type your answer...');
    expect(input).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Or type your own answer...')).toBeNull();

    // Empty input → nothing to submit yet.
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Focus on 2024.' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Tagged to the question it answers (index 0), not a generic freeform blob.
    expect(onSubmit).toHaveBeenCalledWith([{
      question_index: 0,
      answer: 'Focus on 2024.',
      source: 'free_text',
    }]);
  });

  it('lets a single-choice question take a typed answer instead of a chip', () => {
    const onSubmit = vi.fn();

    render(
      <ClarificationPanel
        questions={[{
          text: 'Which metric?',
          responseType: 'single_choice',
          options: [{ label: 'Revenue' }],
        }]}
        onSubmit={onSubmit}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    // single_choice now offers BOTH the chip and its own freeform field.
    expect(screen.getByRole('button', { name: 'Revenue' })).toBeInTheDocument();
    const input = screen.getByPlaceholderText('Or type your own answer...');

    fireEvent.change(input, { target: { value: 'Actually, profit margin.' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Tagged to question 0 as a free_text answer (not a generic -1 override).
    expect(onSubmit).toHaveBeenCalledWith([{
      question_index: 0,
      answer: 'Actually, profit margin.',
      source: 'free_text',
    }]);
  });

  it('supersedes a selected option when the user types a custom answer', () => {
    const onSelectAnswer = vi.fn();
    const onClearAnswer = vi.fn();

    render(
      <ClarificationPanel
        questions={[{
          text: 'Which metric?',
          responseType: 'single_choice',
          options: [{ label: 'Revenue' }],
        }]}
        selectedAnswers={{ 0: { question_index: 0, answer: 'Revenue', source: 'option' } }}
        onSelectAnswer={onSelectAnswer}
        onClearAnswer={onClearAnswer}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('Or type your own answer...');
    fireEvent.change(input, { target: { value: 'profit margin' } });

    // Typing records a free_text answer (autoSubmit=false) that overrides the
    // prior option pick.
    expect(onSelectAnswer).toHaveBeenCalledWith(
      0,
      { question_index: 0, answer: 'profit margin', source: 'free_text' },
      false,
    );

    // Clearing the field removes the answer entirely.
    fireEvent.change(input, { target: { value: '' } });
    expect(onClearAnswer).toHaveBeenCalledWith(0);
  });

  it('records a typed answer live and submits it on Enter', () => {
    const onSubmit = vi.fn();

    render(
      <ClarificationPanel
        questions={[{
          text: 'Anything else?',
          responseType: 'free_text',
        }]}
        onSubmit={onSubmit}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('Type your answer...');
    fireEvent.change(input, { target: { value: 'Focus on 2024.' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledWith([{
      question_index: 0,
      answer: 'Focus on 2024.',
      source: 'free_text',
    }]);
  });
});
