import React from 'react';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClarificationPanel } from '../../../../src/views/ClarificationPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      const labels: Record<string, string> = {
        'chartRec.clarificationTitle': 'Agent needs clarification',
        'chartRec.clarificationQuestionLabel': `${params?.index}.`,
        'chartRec.optionalClarification': '(optional)',
        'chartRec.freeTextClarificationPlaceholder': 'Type your answer...',
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
        onCancel={vi.fn()}
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
        onCancel={vi.fn()}
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

  it('shows a chat-box hint for free-text questions and renders no input', () => {
    const onSubmit = vi.fn();

    render(
      <ClarificationPanel
        questions={[{
          text: 'Anything else to share?',
          responseType: 'free_text',
        }]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Type your answer in the chat box below.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Type your answer...')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
