// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Identity management for Data Formulator
 * 
 * This module provides a layered identity system:
 * 1. User identity (if logged in via auth provider) - highest priority
 * 2. Browser identity (localStorage-based UUID) - fallback for anonymous users
 * 
 * Browser identity is shared across all tabs of the same origin via localStorage,
 * ensuring consistent state across tabs without requiring login.
 */

const BROWSER_ID_KEY = 'df_browser_id';

export type IdentityType = 'user' | 'browser' | 'local';

export interface Identity {
    type: IdentityType;
    id: string;
    displayName?: string;
}

export interface UserInfo {
    name: string;
    userId: string;
}

/**
 * Generates a UUID v4.
 * Uses crypto.randomUUID if available (secure contexts only), falls back to
 * crypto.getRandomValues (CSPRNG, available in non-secure contexts too).
 */
export function generateUUID(): string {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Gets or creates a persistent browser identity stored in localStorage.
 * This ID is shared across all tabs of the same origin.
 * 
 * @returns The browser identity UUID
 */
export function getBrowserId(): string {
    try {
        let browserId = localStorage.getItem(BROWSER_ID_KEY);
        if (!browserId) {
            browserId = generateUUID();
            localStorage.setItem(BROWSER_ID_KEY, browserId);
        }
        return browserId;
    } catch (e) {
        // localStorage might be unavailable (e.g., private browsing in some browsers)
        // Generate a session-only ID as fallback
        console.warn('localStorage unavailable, using session-only browser ID');
        return generateUUID();
    }
}

/**
 * Clears the browser identity from localStorage.
 * Useful for testing or when user wants to reset their identity.
 */
export function clearBrowserId(): void {
    try {
        localStorage.removeItem(BROWSER_ID_KEY);
    } catch (e) {
        console.warn('Failed to clear browser ID from localStorage');
    }
}

/**
 * Resolves the current identity based on available authentication.
 * Priority: User identity (if logged in) > Browser identity
 * 
 * @param userInfo - Optional user info if user is authenticated
 * @returns The resolved identity
 */
export function resolveIdentity(userInfo?: UserInfo | null): Identity {
    if (userInfo?.userId) {
        return {
            type: 'user',
            id: userInfo.userId
        };
    }
    return {
        type: 'browser',
        id: getBrowserId()
    };
}

/**
 * Creates the identity key used for state storage on the backend.
 * Format: "{type}:{id}" (e.g., "user:alice@example.com" or "browser:550e8400-...")
 * 
 * @param identity - The identity object
 * @returns A string key suitable for state storage
 */
export function getIdentityKey(identity: Identity): string {
    return `${identity.type}:${identity.id}`;
}
