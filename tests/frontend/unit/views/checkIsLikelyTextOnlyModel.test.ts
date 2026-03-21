import { describe, it, expect } from 'vitest';
import { checkIsLikelyTextOnlyModel } from '../../../../src/views/DataLoadingThread';

describe('checkIsLikelyTextOnlyModel', () => {
  it('returns true for deepseek-chat', () => {
    expect(checkIsLikelyTextOnlyModel('deepseek-chat')).toBe(true);
  });

  it('returns true for DeepSeek-Chat (case-insensitive)', () => {
    expect(checkIsLikelyTextOnlyModel('DeepSeek-Chat')).toBe(true);
  });

  it('returns true when deepseek-chat is a substring', () => {
    expect(checkIsLikelyTextOnlyModel('provider/deepseek-chat-v2')).toBe(true);
  });

  it('returns false for gpt-4o (multimodal)', () => {
    expect(checkIsLikelyTextOnlyModel('gpt-4o')).toBe(false);
  });

  it('returns false for claude-sonnet-4-20250514', () => {
    expect(checkIsLikelyTextOnlyModel('claude-sonnet-4-20250514')).toBe(false);
  });

  it('returns false for gemini-2.5-pro', () => {
    expect(checkIsLikelyTextOnlyModel('gemini-2.5-pro')).toBe(false);
  });

  it('returns false for deepseek-reasoner (vision-capable)', () => {
    expect(checkIsLikelyTextOnlyModel('deepseek-reasoner')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(checkIsLikelyTextOnlyModel(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(checkIsLikelyTextOnlyModel('')).toBe(false);
  });
});
