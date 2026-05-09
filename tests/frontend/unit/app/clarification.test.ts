import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/app/utils', () => ({
  translateBackend: (fallback: string, code?: string) => {
    if (code === 'agent.clarifyExhausted') return 'Translated exhausted prompt';
    if (code === 'agent.clarifyOptionContinue') return 'Translated continue';
    return fallback;
  },
}));

import {
  formatClarificationResponses,
  normalizeClarifyEvent,
} from '../../../../src/app/clarification';

describe('clarification helpers', () => {
  it('normalizes structured clarify events and translates backend codes', () => {
    const normalized = normalizeClarifyEvent({
      type: 'clarify',
      questions: [{
        text: 'Fallback prompt',
        text_code: 'agent.clarifyExhausted',
        responseType: 'single_choice',
        options: [{
          label: 'Continue exploring',
          label_code: 'agent.clarifyOptionContinue',
        }],
      }],
    });

    expect(normalized.questions[0].text).toBe('Translated exhausted prompt');
    expect(normalized.questions[0].options?.[0].label).toBe('Translated continue');
    // *_code / text_params / required are i18n inputs only — they should not
    // be carried on the normalized output.
    expect((normalized.questions[0] as any).text_code).toBeUndefined();
    expect((normalized.questions[0] as any).text_params).toBeUndefined();
    expect((normalized.questions[0] as any).required).toBeUndefined();
    expect((normalized.questions[0].options?.[0] as any).label_code).toBeUndefined();
    expect(normalized.summary).toBe('Translated exhausted prompt');
  });

  it('defaults responseType to free_text when no options are provided', () => {
    const normalized = normalizeClarifyEvent({
      type: 'clarify',
      questions: [{ text: 'Anything else?' }],
    });
    expect(normalized.questions[0].responseType).toBe('free_text');
    expect(normalized.questions[0].options).toBeUndefined();
  });

  it('defaults responseType to single_choice when options are provided', () => {
    const normalized = normalizeClarifyEvent({
      type: 'clarify',
      questions: [{ text: 'Pick', options: ['A', 'B'] }],
    });
    expect(normalized.questions[0].responseType).toBe('single_choice');
  });

  it('accepts bare-string options', () => {
    const normalized = normalizeClarifyEvent({
      type: 'clarify',
      questions: [{
        text: 'Pick one',
        options: ['A', 'B', 'C'],
      }],
    });

    expect(normalized.questions[0].options).toEqual([
      { label: 'A' }, { label: 'B' }, { label: 'C' },
    ]);
  });

  it('rejects clarify events without questions', () => {
    expect(() => normalizeClarifyEvent({ type: 'clarify' })).toThrow(/questions/);
  });

  it('formats single response as just the answer', () => {
    const text = formatClarificationResponses([
      { question_index: 0, answer: 'Revenue', source: 'option' },
    ]);
    expect(text).toBe('Revenue');
  });

  it('formats multiple selections with 1-based indices', () => {
    const text = formatClarificationResponses([
      { question_index: 0, answer: 'Revenue', source: 'option' },
      { question_index: 1, answer: 'Last 12 months', source: 'option' },
    ]);
    expect(text).toBe('1. Revenue; 2. Last 12 months');
  });

  it('appends freeform text on its own line after selections', () => {
    const text = formatClarificationResponses([
      { question_index: 0, answer: 'Revenue', source: 'option' },
      { question_index: 1, answer: 'Last 12 months', source: 'option' },
      { question_index: -1, answer: 'Focus on 2024.', source: 'freeform' },
    ]);
    expect(text).toBe('1. Revenue; 2. Last 12 months\nFocus on 2024.');
  });
});
