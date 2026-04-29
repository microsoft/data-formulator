import { describe, expect, it } from 'vitest';
import {
  shouldAutoFocusGeneratedChart,
} from '../../../../src/app/agentInteractionPolicy';

describe('agent interaction policy', () => {
  it('keeps generated chart auto-focus disabled while the user is viewing a chart', () => {
    expect(shouldAutoFocusGeneratedChart(false)).toBe(true);
    expect(shouldAutoFocusGeneratedChart(true)).toBe(false);
  });
});
