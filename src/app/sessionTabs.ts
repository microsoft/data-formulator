// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Per-tab sessions. Each browser tab works on its own session, named in the URL
 * (`/app?session=<id>`), so sessions can be opened side by side, reloaded, and
 * bookmarked. The backend scopes every request by the signed-in (or local)
 * identity and the tab's `X-Workspace-Id`, so tabs share connectors, models,
 * workflows, and schedules while editing different sessions.
 *
 * One session is edited by one tab at a time: a tab that opens a session
 * `claim`s it over a BroadcastChannel; a tab holding it saves its latest state
 * and becomes view-only before the claimer loads it from the backend.
 */

import { generateUUID } from './identity';

export const SESSION_PARAM = 'session';
const CHANNEL_NAME = 'df-session-tabs';
const YIELD_NOTICE_MS = 250;
const RELEASE_TIMEOUT_MS = 5000;

type TabMessage = { type: 'claim' | 'yielding' | 'released'; sessionId: string; tabId: string };

export const TAB_ID = generateUUID();

const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
interface SessionHolder {
    /** Whether this tab is currently editing the session. */
    holds: (sessionId: string) => boolean;
    /** Save pending work and stop editing the session in this tab. */
    release: (sessionId: string) => Promise<void>;
}

let holder: SessionHolder | null = null;
const waiters = new Set<(message: TabMessage) => void>();

channel?.addEventListener('message', event => {
    const message = event.data as TabMessage;
    if (!message || message.tabId === TAB_ID || typeof message.sessionId !== 'string') return;
    if (message.type === 'claim') {
        void respondToClaim(message.sessionId);
        return;
    }
    for (const waiter of waiters) waiter(message);
});

const post = (type: TabMessage['type'], sessionId: string) => channel?.postMessage({ type, sessionId, tabId: TAB_ID });

async function respondToClaim(sessionId: string) {
    const current = holder;
    if (!current?.holds(sessionId)) return;
    post('yielding', sessionId);
    try {
        await current.release(sessionId);
    } finally {
        post('released', sessionId);
    }
}

/** Register how this tab gives up a session another tab claims. Returns a cleanup. */
export function registerSessionHolder(next: SessionHolder): () => void {
    holder = next;
    return () => { if (holder === next) holder = null; };
}

/**
 * Announce that this tab is about to edit `sessionId`. Resolves after any tab
 * holding it has saved and released it; true when another tab released it.
 */
export function claimSession(sessionId: string): Promise<boolean> {
    if (!channel) return Promise.resolve(false);
    return new Promise(resolve => {
        let yielding = false;
        const finish = (released: boolean) => {
            waiters.delete(waiter);
            clearTimeout(noticeTimer);
            clearTimeout(releaseTimer);
            resolve(released);
        };
        const waiter = (message: TabMessage) => {
            if (message.sessionId !== sessionId) return;
            if (message.type === 'yielding') yielding = true;
            if (message.type === 'released') finish(true);
        };
        const noticeTimer = setTimeout(() => { if (!yielding) finish(false); }, YIELD_NOTICE_MS);
        const releaseTimer = setTimeout(() => finish(yielding), RELEASE_TIMEOUT_MS);
        waiters.add(waiter);
        post('claim', sessionId);
    });
}

/** An app URL that opens `sessionId` (in this or another tab). */
export function sessionUrl(sessionId: string): string {
    const url = new URL(window.location.href);
    if (!/\/app\/?$/.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/+$/, '')}/app`;
    url.searchParams.set(SESSION_PARAM, sessionId);
    url.hash = '';
    return url.toString();
}

export function openSessionInNewTab(sessionId: string): void {
    window.open(sessionUrl(sessionId), '_blank', 'noopener');
}
