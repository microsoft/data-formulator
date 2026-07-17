import React from 'react';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClarificationPanel } from '../../../../src/views/AgentPausePanel';

vi.mock('react-i18next', () => ({
  // The panel now lives in `AgentPausePanel.tsx` which transitively pulls
  // in `dfSlice` → `i18n/index` → `.use(initReactI18next)`. Provide a no-op
  // plugin shim so the i18n init code path succeeds under the mock.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      const labels: Record<string, string> = {
        'chartRec.clarificationTitle': 'Agent needs clarification',
        'chartRec.clarificationQuestionLabel': `${params?.index}.`,
        'chartRec.optionalClarification': '(optional)',
        'chartRec.freeTextClarificationPlaceholder': 'Type your answer...',
        'chartRec.customAnswerPlaceholder': 'Or type your own answer...',
        'chartRec.confirmAnswer': 'Confirm answer',
        'chartRec.freeTextClarificationHint': 'Type your answer in the chat box below.',
      };
      return labels[key] || key;
    },
  }),
}));

describe('ClarificationPanel', () => {
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
