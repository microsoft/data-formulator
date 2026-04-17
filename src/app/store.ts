// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { configureStore } from '@reduxjs/toolkit'
import { dataFormulatorReducer } from './dfSlice';

import { persistReducer, persistStore } from 'redux-persist'
import localforage from 'localforage';

export type AppDispatch = typeof store.dispatch

const persistConfig = {
    key: 'root',
    //storage,
    storage: localforage,
    // globalModels are always fetched fresh from the server on each app start,
    // so there is no need (and it would cause stale-data issues) to persist them.
    // In-progress flags are transient and should not survive page refreshes.
    blacklist: ['serverConfig', 'globalModels', 'chartSynthesisInProgress', 'chartInsightInProgress'],
}

const persistedReducer = persistReducer(persistConfig, dataFormulatorReducer)

let store = configureStore({
    reducer: persistedReducer,
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: false,
    }),
})

export const persistor = persistStore(store);

export default store;

// Export store instance for use in utilities
export { store };
