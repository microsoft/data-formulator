// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * OIDC (OpenID Connect) configuration module.
 *
 * All settings are fetched at runtime from `/api/auth/info` — the frontend
 * has zero compile-time OIDC configuration.  The module exposes lazy
 * singletons (`getUserManager`, `getAccessToken`) consumed by
 * `fetchWithIdentity` and `App.tsx`.
 */

import { UserManager, WebStorageStateStore, User } from "oidc-client-ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OidcConfig {
    authority: string;
    clientId: string;
    scopes: string;
    redirectUri: string;
}

export interface AuthInfo {
    action: "frontend" | "redirect" | "transparent" | "none";
    label?: string;
    oidc?: {
        authority: string;
        clientId: string;
        scopes?: string;
    };
    url?: string;
}

// ---------------------------------------------------------------------------
// Lazy singletons
// ---------------------------------------------------------------------------

let _authInfoPromise: Promise<AuthInfo | null> | null = null;
let _userManager: UserManager | null = null;

/**
 * Fetch and cache the auth info from the backend.
 * Safe to call multiple times — only one HTTP request is made.
 */
export async function getAuthInfo(): Promise<AuthInfo | null> {
    if (!_authInfoPromise) {
        _authInfoPromise = fetch("/api/auth/info")
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null);
    }
    return _authInfoPromise;
}

/**
 * Derive an OIDC configuration object from the backend's auth info,
 * or `null` when OIDC is not the active provider.
 */
export async function getOidcConfig(): Promise<OidcConfig | null> {
    const info = await getAuthInfo();
    if (!info || info.action !== "frontend" || !info.oidc) return null;
    return {
        authority: info.oidc.authority,
        clientId: info.oidc.clientId,
        scopes: info.oidc.scopes ?? "openid profile email",
        redirectUri: `${window.location.origin}/callback`,
    };
}

/**
 * Return the OIDC `UserManager` singleton, creating it lazily on first call.
 * Returns `null` when OIDC is not configured.
 */
export async function getUserManager(): Promise<UserManager | null> {
    if (_userManager) return _userManager;

    const config = await getOidcConfig();
    if (!config) return null;

    _userManager = new UserManager({
        authority: config.authority,
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: config.scopes,
        automaticSilentRenew: true,
        userStore: new WebStorageStateStore({ store: window.localStorage }),
    });

    _userManager.events.addSilentRenewError(() => {
        console.warn("[oidcConfig] Silent renew failed, redirecting to login…");
        _userManager?.signinRedirect();
    });

    return _userManager;
}

/**
 * Get the current OIDC access token, or `null` if the user is not
 * authenticated via OIDC or the token has expired.
 */
export async function getAccessToken(): Promise<string | null> {
    const mgr = await getUserManager();
    if (!mgr) return null;
    const user = await mgr.getUser();
    if (!user || user.expired) return null;
    return user.access_token;
}

/**
 * Get the full OIDC `User` object (for identity extraction).
 */
export async function getOidcUser(): Promise<User | null> {
    const mgr = await getUserManager();
    if (!mgr) return null;
    return mgr.getUser();
}

// ---------------------------------------------------------------------------
// Test helpers — allow tests to replace the singleton
// ---------------------------------------------------------------------------

/** @internal — used only by tests */
export function _resetForTesting(): void {
    _authInfoPromise = null;
    _userManager = null;
}
