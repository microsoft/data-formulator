// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * OIDC / OAuth2 configuration module.
 *
 * All settings are fetched at runtime from `/api/auth/info` — the frontend
 * has zero compile-time OIDC configuration.  The module exposes lazy
 * singletons (`getUserManager`, `getAccessToken`) consumed by
 * `fetchWithIdentity` and `App.tsx`.
 *
 * Supports two modes:
 *   1. **Auto-discovery** — backend returns `authority` only; `oidc-client-ts`
 *      fetches `/.well-known/openid-configuration` automatically.
 *   2. **Manual endpoints** — backend returns `metadata` with explicit endpoint
 *      URLs; `oidc-client-ts` skips discovery entirely.
 */

import { UserManager, WebStorageStateStore, User } from "oidc-client-ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OidcEndpointMetadata {
    authorization_endpoint?: string;
    token_endpoint?: string;
    userinfo_endpoint?: string;
    jwks_uri?: string;
}

export interface OidcConfig {
    authority: string;
    clientId: string;
    clientSecret?: string;
    scopes: string;
    redirectUri: string;
    metadata?: OidcEndpointMetadata;
}

export interface AuthInfo {
    action: "frontend" | "redirect" | "transparent" | "none";
    label?: string;
    oidc?: {
        authority: string;
        clientId: string;
        clientSecret?: string;
        scopes?: string;
        metadata?: OidcEndpointMetadata;
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
        clientSecret: info.oidc.clientSecret,
        scopes: info.oidc.scopes ?? "openid profile email",
        redirectUri: `${window.location.origin}/callback`,
        metadata: info.oidc.metadata,
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

    const hasManualEndpoints = config.metadata &&
        config.metadata.authorization_endpoint &&
        config.metadata.token_endpoint;

    if (hasManualEndpoints) {
        // Manual mode: provide metadata directly, skip discovery.
        // loadUserInfo fetches profile from the userinfo endpoint
        // (since the SSO may not return a JWT id_token).
        _userManager = new UserManager({
            authority: config.authority,
            client_id: config.clientId,
            client_secret: config.clientSecret || undefined,
            redirect_uri: config.redirectUri,
            response_type: "code",
            scope: config.scopes,
            loadUserInfo: !!config.metadata!.userinfo_endpoint,
            automaticSilentRenew: false,
            userStore: new WebStorageStateStore({ store: window.localStorage }),
            metadata: {
                issuer: config.authority,
                authorization_endpoint: config.metadata!.authorization_endpoint!,
                token_endpoint: config.metadata!.token_endpoint!,
                userinfo_endpoint: config.metadata!.userinfo_endpoint,
                jwks_uri: config.metadata!.jwks_uri,
            },
        });
    } else {
        // Discovery mode: oidc-client-ts fetches /.well-known/openid-configuration
        _userManager = new UserManager({
            authority: config.authority,
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            response_type: "code",
            scope: config.scopes,
            automaticSilentRenew: true,
            userStore: new WebStorageStateStore({ store: window.localStorage }),
        });
    }

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
