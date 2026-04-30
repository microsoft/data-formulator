import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ClarificationPanel } from '../../../../src/views/ClarificationPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      const labels: Record<string, string> = {
        'chartRec.clarificationTitle': 'Agent needs clarification',
        'chartRec.clarificationQuestionLabel': `${params?.index}.`,
        'chartRec.optionalClarification': '(optional)',
        'chartRec.freeTextClarificationPlaceholder': 'Type your answer...',
        'chartRec.directClarificationLabel': 'Or explain directly:',
        'chartRec.directClarificationPlaceholder': 'Describe what you want...',
        'chartRec.submitClarification': 'Continue',
        'chartRec.cancelClarification': 'Cancel',
        'chartRec.autoContinueCountdown': `${params?.seconds}s`,
      };
      return labels[key] || key;
    },
  }),
}));

afterEach(() => {
  vi.useRealTimers();
});

describe('ClarificationPanel', () => {
  it('submits a single-choice question immediately when an option is clicked', () => {
    const onSubmit = vi.fn();

    render(
      <ClarificationPanel
        questions={[{
          id: 'metric',
          text: 'Which metric?',
          responseType: 'single_choice',
          options: [{ id: 'revenue', label: 'Revenue' }],
        }]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Revenue' }));

    expect(onSubmit).toHaveBeenCalledWith([{
      question_id: 'metric',
      answer: 'Revenue',
      option_id: 'revenue',
      source: 'option',
    }]);
  });

  it('collects multiple answers before submitting', () => {
    const onSubmit = vi.fn();

    render(
      <ClarificationPanel
        questions={[
          {
            id: 'metric',
            text: 'Which metric?',
            responseType: 'single_choice',
            options: [{ id: 'revenue', label: 'Revenue' }],
          },
          {
            id: 'period',
            text: 'Which period?',
            responseType: 'single_choice',
            options: [{ id: 'last_12_months', label: 'Last 12 months' }],
          },
        ]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const continueButton = screen.getByRole('button', { name: 'Continue' });
    expect(continueButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Revenue' }));
    expect(continueButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Last 12 months' }));
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    expect(onSubmit).toHaveBeenCalledWith([
      { question_id: 'metric', answer: 'Revenue', option_id: 'revenue', source: 'option' },
      { question_id: 'period', answer: 'Last 12 months', option_id: 'last_12_months', source: 'option' },
    ]);
  });

  it('allows a direct freeform clarification', () => {
    const onSubmit = vi.fn();

    render(
      <ClarificationPanel
        questions={[{
          id: 'metric',
          text: 'Which metric?',
          responseType: 'single_choice',
          options: [{ id: 'revenue', label: 'Revenue' }],
        }]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Describe what you want...'), {
      target: { value: 'Use revenue for the last year.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledWith([{
      question_id: '__freeform__',
      answer: 'Use revenue for the last year.',
      source: 'freeform',
    }]);
  });

  it('auto-submits the configured option after the timeout', () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();

    render(
      <ClarificationPanel
        questions={[{
          id: 'continue_after_tool_rounds',
          text: 'Continue?',
          responseType: 'single_choice',
          options: [{ id: 'continue', label: 'Continue exploring' }],
        }]}
        autoSelectQuestionId="continue_after_tool_rounds"
        autoSelectOptionId="continue"
        autoSelectTimeoutMs={500}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onSubmit).toHaveBeenCalledWith([{
      question_id: 'continue_after_tool_rounds',
      answer: 'Continue exploring',
      option_id: 'continue',
      source: 'option',
    }]);
  });
});
