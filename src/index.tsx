// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import './index.css';

import './i18n';

import store, { persistor } from './app/store'
import { setPageStore } from './app/utils';
import { Provider } from 'react-redux'

import { AppFC } from './app/App';

import { PersistGate } from 'redux-persist/integration/react'
import { createRoot } from 'react-dom/client';


// Requests read the session from the store the page renders with (see setPageStore).
setPageStore(store);

const domNode = document.getElementById('root') as HTMLElement;
const root = createRoot(domNode);


root.render(<React.StrictMode>
        <Provider store={store}>
            <PersistGate loading={null} persistor={persistor}>
                <AppFC />
            </PersistGate>
        </Provider>
</React.StrictMode>);
