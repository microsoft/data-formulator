import { describe, it, expect } from 'vitest';
import { dfSelectors, DataFormulatorState, ModelConfig } from '../../../../src/app/dfSlice';

const makeModel = (overrides: Partial<ModelConfig> = {}): ModelConfig => ({
  id: 'model-1',
  endpoint: 'https://api.example.com',
  model: 'gpt-4',
  ...overrides,
});

const makeMinimalState = (
  overrides: Partial<Pick<DataFormulatorState, 'models' | 'selectedModelId'>> = {},
): DataFormulatorState => {
  return {
    models: [],
    selectedModelId: undefined,
    ...overrides,
  } as unknown as DataFormulatorState;
};

describe('dfSelectors.getActiveModel', () => {
  it('should return the selected model when it exists', () => {
    const model = makeModel({ id: 'a' });
    const state = makeMinimalState({
      models: [makeModel({ id: 'b' }), model],
      selectedModelId: 'a',
    });
    expect(dfSelectors.getActiveModel(state)).toEqual(model);
  });

  it('should fall back to the first model when selectedModelId does not match', () => {
    const first = makeModel({ id: 'first' });
    const state = makeMinimalState({
      models: [first, makeModel({ id: 'second' })],
      selectedModelId: 'non-existent',
    });
    expect(dfSelectors.getActiveModel(state)).toEqual(first);
  });

  it('should return undefined when the models array is empty', () => {
    const state = makeMinimalState({
      models: [],
      selectedModelId: undefined,
    });
    expect(dfSelectors.getActiveModel(state)).toBeUndefined();
  });

  it('should return undefined when models is empty even with a selectedModelId', () => {
    const state = makeMinimalState({
      models: [],
      selectedModelId: 'some-id',
    });
    expect(dfSelectors.getActiveModel(state)).toBeUndefined();
  });

  it('should return the first model when selectedModelId is undefined', () => {
    const first = makeModel({ id: 'only' });
    const state = makeMinimalState({
      models: [first],
      selectedModelId: undefined,
    });
    expect(dfSelectors.getActiveModel(state)).toEqual(first);
  });
});
