// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The user's sign-ins (design-docs/72): the `/api/accounts` client, the check that keeps a sign-in card's links and
 * key on one service, and the request a sign-in card makes to resume the agent's paused run. Secrets never reach the
 * browser after they are saved; the server answers with account names or the last characters of a key.
 */

import { apiRequest } from './apiClient';

export type SignInMethod = 'reuse' | 'device' | 'token';

/** One of: a command (run without a shell) whose output is the secret, a file, or an environment variable; with
 *  `fields` when what is read is JSON holding the secret's parts. */
export interface LocalLogin { command?: string[]; file?: string; env?: string; fields?: Record<string, string> }

/** A local login's read, as the card shows it. */
export const describeLocal = (local: LocalLogin): string =>
    local.command?.length ? local.command.map(arg => /^[\w@%+=:,./~-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'"'"'`)}'`).join(' ')
        : local.file || `$${local.env || ''}`;
export type AuthType = 'bearer' | 'header' | 'query' | 'basic';

/** What a sign-in is: where its secret goes and how. Built-in ones are verified; others were proposed by the agent. */
export interface SignInSpec {
    id: string;
    name: string;
    /** The exact hosts the secret is sent to. */
    send_to: string[];
    auth: { type: AuthType; name?: string; username_label?: string; secret_label?: string };
    /** Where the user gets the secret. */
    get_token: string;
    instructions?: string;
    check?: string;
    /** How to read a login this computer may have, for the user to reuse; shown on the card as written. */
    local?: LocalLogin;
    verified: boolean;
    /** The ways to sign in that work here, in the app's order. */
    methods: SignInMethod[];
    /** The service's own sites: the only places a sign-in card links to. */
    domains: string[];
}

export interface AccountState extends SignInSpec {
    signed_in: boolean;
    login: string | null;
    /** The last characters of a saved key, when the service names no account. */
    secret_hint: string | null;
    source: 'local' | 'device' | 'token' | null;
    /** Kept for this session only (the default), or for every session. */
    scope: 'user' | 'session' | null;
    /** A built-in's login on this computer (e.g. `hf auth login`), usable in one click. */
    reusable_login: string | null;
}

export interface DeviceSignIn { flow_id: string; user_code: string; authorization_url: string; interval: number }
/** Where a sign-in is kept: left out, the open session (or every session when none is open). */
export type SignInScope = 'user' | 'session';

/** Whether `url` is an https page on one of `domains` (or a subdomain), with no credentials or odd port. */
export const onProviderSite = (url: string | undefined, domains: string[] | undefined): boolean => {
    if (!url || !domains?.length) return false;
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        return parsed.protocol === 'https:' && !parsed.username && !parsed.password && (!parsed.port || parsed.port === '443')
            && domains.some(domain => host === domain || host.endsWith(`.${domain}`));
    } catch {
        return false;
    }
};

/**
 * Whether a spec keeps to one service: its key page on its own site and every host it sends the key to under it.
 * The server checks proposed specs and checks again on save; this guards a card read from a saved or imported
 * session, which never passed the server's check.
 */
export const specIsCoherent = (spec: Pick<SignInSpec, 'send_to' | 'get_token' | 'domains' | 'verified'> | undefined): boolean =>
    !!spec && spec.send_to.length > 0 && spec.domains.length > 0 && onProviderSite(spec.get_token, spec.domains)
    && (spec.verified || spec.send_to.every(host => spec.domains.some(domain => host === domain || host.endsWith(`.${domain}`))));

/** A spec not yet saved, shown as a sign-in the user has not made. */
export const unsavedAccount = (spec: SignInSpec): AccountState => ({
    ...spec, methods: spec.methods.filter(method => method !== 'reuse' || spec.local),
    signed_in: false, login: null, secret_hint: null, source: null, scope: null, reusable_login: null,
});

const CONFIG_HEADERS = { 'Content-Type': 'application/json', 'X-DF-Configuration': '1' };

const post = async <T,>(path: string, body: Record<string, unknown> = {}) =>
    (await apiRequest<T>(`/api/accounts/${path}`, { method: 'POST', headers: CONFIG_HEADERS, body: JSON.stringify(body) })).data;
const id = (value: string) => encodeURIComponent(value);
/** A spec as the user confirmed it: the server checks it again. */
const specBody = (spec: SignInSpec) => ({ id: spec.id, name: spec.name, send_to: spec.send_to, auth: spec.auth,
    get_token: spec.get_token, instructions: spec.instructions, ...(spec.check ? { check: spec.check } : {}),
    ...(spec.local ? { local: spec.local } : {}) });

export const accountsApi = {
    list: async () => (await apiRequest<{ available: boolean; accounts: AccountState[] }>('/api/accounts')).data,
    get: async (spec: string) => (await apiRequest<AccountState>(`/api/accounts/${id(spec)}`)).data,
    start: (spec: string) => post<DeviceSignIn>(`${id(spec)}/signin/start`),
    poll: (spec: string, flowId: string, scope?: SignInScope) =>
        post<AccountState & { flow: { status: string } }>(`${id(spec)}/signin/poll`, { flow_id: flowId, scope }),
    cancel: (spec: string, flowId: string) => post<object>(`${id(spec)}/signin/cancel`, { flow_id: flowId }),
    reuse: (spec: string, scope?: SignInScope) => post<AccountState>(`${id(spec)}/signin/reuse`, { scope }),
    token: (spec: string, token: string, scope?: SignInScope) => post<AccountState>(`${id(spec)}/token`, { token, scope }),
    /** Keep a key for a service that is not built in, with the spec the user confirmed (checked again on the server). */
    saveCustom: (spec: SignInSpec, secret: Record<string, string>, scope?: SignInScope) =>
        post<AccountState>('custom', { spec: specBody(spec), secret, scope }),
    /** Sign in to a spec not yet saved with this computer's login, read the way the spec says. */
    reuseCustom: (spec: SignInSpec, scope?: SignInScope) => post<AccountState>('custom/reuse', { spec: specBody(spec), scope }),
    signOut: (spec: string) => post<AccountState | { id: string; removed: true }>(`${id(spec)}/signout`),
};

/** Ask the chat to continue the run a sign-in card paused, with the user's answer as the message. A listener
 *  returns whether it took the request (it does not while another request runs); so does `requestTurnResume`. */
type ResumeListener = (turnId: string, message: string) => boolean;
const resumeListeners = new Set<ResumeListener>();

export const requestTurnResume = (turnId: string, message: string): boolean =>
    [...resumeListeners].some(listener => listener(turnId, message));

/** Subscribe the chat to resume requests; returns the unsubscribe function. */
export const onTurnResumeRequest = (listener: ResumeListener) => {
    resumeListeners.add(listener);
    return () => { resumeListeners.delete(listener); };
};
