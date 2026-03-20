// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { configureStore } from '@reduxjs/toolkit'
import { dataFormulatorReducer } from './dfSlice';

import { persistReducer } from 'redux-persist'
import localforage from 'localforage';

export type AppDispatch = typeof store.dispatch

const persistConfig = {
    key: 'root',
    //storage,
    storage: localforage,
    // Only exclude the largest data fields to prevent localStorage quota exceeded
    // Keep tables, charts, and UI state for proper persistence on reload
    blacklist: [
        'chartSampleData',      // Large sample data arrays for charts
        'chartPreviewImages',   // Base64 encoded images can be very large
        'generatedReports',     // Can be very large with embedded data
    ]
}

const persistedReducer = persistReducer(persistConfig, dataFormulatorReducer)

let store = configureStore({
    reducer: persistedReducer,
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: false,
            immutableCheck: {
                // Increase threshold from 32ms to 1 second since state is large
                warnAfter: 1000,
                ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE'],
            },
    }),
})

export default store;
