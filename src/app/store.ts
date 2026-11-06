// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { configureStore } from '@reduxjs/toolkit'
import { dataFormulatorReducer } from './dfSlice';

import { persistReducer, persistStore, createTransform } from 'redux-persist'
import localforage from 'localforage';
import { migrateState } from './stateMigrations';
import { stripConnectorPrefillFromEntries } from './connectorFormPersistence';
import { demoScoped } from './demo';

export type AppDispatch = typeof store.dispatch

// Never persist connector-form prefill values to storage. The agent may seed a
// live connection form with values the user provided in chat (a host, database,
// and, if they chose to share them, credentials) purely as a re-typing
// convenience. Those must NEVER be written to disk. In-memory Redux keeps
// `prefilled` so the form can seed once on render; this transform drops it on the
// way to localForage, so nothing is stored until the user clicks Connect.
const stripConnectorPrefill = createTransform(
    stripConnectorPrefillFromEntries,
    (outboundState: any) => outboundState,
    { whitelist: ['textTurns'] },
);

const persistConfig = {
    // A demo (/demo/<id>) keeps its open session and settings apart from the standard app's.
    key: demoScoped('root'),
    //storage,
    storage: localforage,
    // globalModels are always fetched fresh from the server on each app start,
    // so there is no need (and it would cause stale-data issues) to persist them.
    // In-progress flags are transient and should not survive page refreshes.
    blacklist: ['serverConfig', 'globalModels', 'chartSynthesisInProgress', 'starterQuestionsStatus', 'pendingTableLoads', 'tablesMissingData', 'exampleFollowUps', 'workflowStarting', 'appAutoFixes'],
    transforms: [stripConnectorPrefill],
    migrate: async (state: any): Promise<any> => migrateState(state),
}

const persistedReducer = persistReducer(persistConfig, dataFormulatorReducer)

// One store across dev hot reloads. An edit that reaches this module (through dfSlice, the locales, ...) re-runs
// it; a fresh store here would be the one request code reads its X-Workspace-Id from (it imports this module
// dynamically) while the page keeps the first, so requests could go to another session. Keep the store and swap
// in the new reducer instead.
// Vite's hot context keeps `data` across re-runs; test runners may provide a context without it.
const hot = (import.meta as ImportMeta & { hot?: { data?: Record<string, any> } }).hot?.data;
const createStore = () => configureStore({
    reducer: persistedReducer,
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: false,
    }),
});
const existing: ReturnType<typeof createStore> | undefined = hot?.store;
let store = existing ?? createStore();
if (existing) store.replaceReducer(persistedReducer as any);

export const persistor: ReturnType<typeof persistStore> = hot?.persistor ?? persistStore(store);
if (hot) {
    hot.store = store;
    hot.persistor = persistor;
}

export default store;

// Export store instance for use in utilities
export { store };
