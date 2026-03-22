import { describe, it, expect } from 'vitest';
import { dfSelectors, DataFormulatorState, ModelConfig } from '../../../../src/app/dfSlice';

const makeModel = (overrides: Partial<ModelConfig> = {}): ModelConfig => ({
  id: 'model-1',
  endpoint: 'https://api.example.com',
  model: 'gpt-4',
  ...overrides,
});

const makeMinimalState = (
  overrides: Partial<Pick<DataFormulatorState, 'models' | 'globalModels' | 'selectedModelId'>> = {},
): DataFormulatorState => {
  return {
    models: [],
    globalModels: [],
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

  it('should find a model in globalModels by selectedModelId', () => {
    const globalModel = makeModel({ id: 'global-1' });
    const state = makeMinimalState({
      globalModels: [globalModel],
      models: [],
      selectedModelId: 'global-1',
    });
    expect(dfSelectors.getActiveModel(state)).toEqual(globalModel);
  });

  it('should prefer exact match in globalModels over first user model', () => {
    const globalModel = makeModel({ id: 'global-1', model: 'gpt-4' });
    const userModel = makeModel({ id: 'user-1', model: 'local-llm' });
    const state = makeMinimalState({
      globalModels: [globalModel],
      models: [userModel],
      selectedModelId: 'global-1',
    });
    expect(dfSelectors.getActiveModel(state)).toEqual(globalModel);
  });

  it('should fall back to first globalModel when no id matches and models is empty', () => {
    const globalModel = makeModel({ id: 'global-1' });
    const state = makeMinimalState({
      globalModels: [globalModel],
      models: [],
      selectedModelId: 'non-existent',
    });
    expect(dfSelectors.getActiveModel(state)).toEqual(globalModel);
  });

  it('should fall back to globalModel (first in combined array) over user model', () => {
    const globalModel = makeModel({ id: 'global-1' });
    const userModel = makeModel({ id: 'user-1' });
    const state = makeMinimalState({
      globalModels: [globalModel],
      models: [userModel],
      selectedModelId: 'non-existent',
    });
    expect(dfSelectors.getActiveModel(state)).toEqual(globalModel);
  });

  it('should handle undefined globalModels gracefully', () => {
    const userModel = makeModel({ id: 'user-1' });
    const state = {
      models: [userModel],
      globalModels: undefined,
      selectedModelId: 'user-1',
    } as unknown as DataFormulatorState;
    expect(dfSelectors.getActiveModel(state)).toEqual(userModel);
  });
});
