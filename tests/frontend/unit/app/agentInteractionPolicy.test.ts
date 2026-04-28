import { describe, expect, it } from 'vitest';
import {
  AUTO_SELECT_CLARIFICATION_MESSAGE_CODE,
  shouldAutoFocusGeneratedChart,
  shouldAutoSelectClarification,
} from '../../../../src/app/agentInteractionPolicy';

describe('agent interaction policy', () => {
  it('auto-selects only continue-exploration clarification prompts', () => {
    expect(shouldAutoSelectClarification(AUTO_SELECT_CLARIFICATION_MESSAGE_CODE)).toBe(true);
    expect(shouldAutoSelectClarification(undefined)).toBe(false);
    expect(shouldAutoSelectClarification('agent.someBusinessClarification')).toBe(false);
  });

  it('keeps generated chart auto-focus disabled while the user is viewing a chart', () => {
    expect(shouldAutoFocusGeneratedChart(false)).toBe(true);
    expect(shouldAutoFocusGeneratedChart(true)).toBe(false);
  });
});
