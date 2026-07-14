// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { configureStore } from '@reduxjs/toolkit'
import { dataFormulatorReducer } from './dfSlice';

import { persistReducer, persistStore, createTransform } from 'redux-persist'
import localforage from 'localforage';

export type AppDispatch = typeof store.dispatch

// Never persist connector-form prefill values to storage. The agent may seed a
// live connection form with values the user provided in chat (a host, database,
// and, if they chose to share them, credentials) purely as a re-typing
// convenience. Those must NEVER be written to disk. In-memory Redux keeps
// `prefilled` so the form can seed once on render; this transform drops it on the
// way to localForage, so nothing is stored until the user clicks Connect.
const stripConnectorPrefill = createTransform(
    (inboundState: any) => {
        if (!Array.isArray(inboundState)) return inboundState;
        return inboundState.map((message: any) => {
            if (message?.connectorForm?.prefilled) {
                const { prefilled, ...connectorForm } = message.connectorForm;
                return { ...message, connectorForm };
            }
            return message;
        });
    },
    (outboundState: any) => outboundState,
    { whitelist: ['dataLoadingChatMessages'] },
);

const persistConfig = {
    key: 'root',
    //storage,
    storage: localforage,
    // globalModels are always fetched fresh from the server on each app start,
    // so there is no need (and it would cause stale-data issues) to persist them.
    // In-progress flags are transient and should not survive page refreshes.
    blacklist: ['serverConfig', 'globalModels', 'chartSynthesisInProgress', 'starterQuestionsStatus'],
    transforms: [stripConnectorPrefill],
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
