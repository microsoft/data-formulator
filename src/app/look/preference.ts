// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useSyncExternalStore } from 'react';

import { LOOKS, type Look } from './looks';

// The look is a preference of this browser, like the display size: kept apart from sessions. The key predates the
// look module (it was the "contrast" setting), so existing choices carry over.
const LOOK_KEY = 'df-contrast';
const listeners = new Set<() => void>();

export const readLook = (): Look => {
    try {
        const stored = localStorage.getItem(LOOK_KEY);
        return stored && stored in LOOKS ? stored as Look : 'soft';
    } catch { return 'soft'; }
};

export const saveLook = (look: Look) => {
    try {
        if (look === 'soft') localStorage.removeItem(LOOK_KEY); else localStorage.setItem(LOOK_KEY, look);
    } catch { /* localStorage unavailable */ }
    listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    // Another tab changing it.
    const onStorage = (event: StorageEvent) => { if (event.key === LOOK_KEY) listener(); };
    window.addEventListener('storage', onStorage);
    return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
};

/** The browser's look preference, following changes from the Settings dialog and other tabs. */
export const useLook = (): Look => useSyncExternalStore(subscribe, readLook, () => 'soft');
