import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/app/utils', () => ({
  translateBackend: (fallback: string, code?: string) => {
    if (code === 'agent.clarifyExhausted') return 'Translated exhausted prompt';
    if (code === 'agent.clarifyOptionContinue') return 'Translated continue';
    return fallback;
  },
}));

import {
  formatClarificationResponsesForDisplay,
  normalizeClarifyEvent,
} from '../../../../src/app/clarification';

describe('clarification helpers', () => {
  it('normalizes structured clarify events and translates backend codes', () => {
    const normalized = normalizeClarifyEvent({
      type: 'clarify',
      questions: [{
        id: 'continue_after_tool_rounds',
        text: 'Fallback prompt',
        text_code: 'agent.clarifyExhausted',
        responseType: 'single_choice',
        options: [{
          id: 'continue',
          label: 'Continue exploring',
          label_code: 'agent.clarifyOptionContinue',
        }],
      }],
      auto_select: {
        question_id: 'continue_after_tool_rounds',
        option_id: 'continue',
        timeout_ms: 60000,
      },
    });

    expect(normalized.questions[0].text).toBe('Translated exhausted prompt');
    expect(normalized.questions[0].options?.[0].label).toBe('Translated continue');
    expect(normalized.summary).toBe('Translated exhausted prompt');
    expect(normalized.autoSelect).toEqual({
      question_id: 'continue_after_tool_rounds',
      option_id: 'continue',
      timeout_ms: 60000,
    });
  });

  it('rejects clarify events without questions', () => {
    expect(() => normalizeClarifyEvent({ type: 'clarify' })).toThrow(/questions/);
  });

  it('formats structured answers for interaction history', () => {
    const text = formatClarificationResponsesForDisplay([
      { question_id: 'metric', answer: 'Revenue', option_id: 'revenue', source: 'option' },
      { question_id: '__freeform__', answer: 'Focus on 2024.', source: 'freeform' },
    ], [
      { id: 'metric', text: 'Which metric?', responseType: 'single_choice' },
    ]);

    expect(text).toContain('Which metric?: Revenue');
    expect(text).toContain('Focus on 2024.');
  });
});
