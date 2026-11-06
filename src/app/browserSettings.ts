// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The agent's browser: its switch and which browser it drives (stored server-side), the availability check, and
 * bringing one of its tabs to the user. It shares the tools' approval mode.
 */

import { apiRequest } from './apiClient';
import type { ServerConfig } from './dfSlice';

export type BrowserChoice = 'auto' | 'edge' | 'chrome' | 'safari' | 'profile';
export type BrowserStepName = 'installed' | 'automation' | 'javascript' | 'launch';

export interface BrowserStep {
    step: BrowserStepName;
    /** null: not checked yet (an earlier step failed). */
    ok: boolean | null;
    detail?: string;
}

export interface BrowserStatus {
    revision: number;
    available: boolean;
    enabled: boolean;
    choice: BrowserChoice;
    mode: 'off' | 'ask' | 'auto';
    platform: string;
    /** The browser driven: edge, chrome or safari (null when none is installed). */
    browser?: 'edge' | 'chrome' | 'safari' | null;
    label?: string;
    /** The browser's version, e.g. "18.1", when it could be read (the user's own browser on macOS). */
    version?: string | null;
    /** Pages see the user's own sign-ins (their browser through Apple Events), not a profile of Data Formulator's. */
    user_profile?: boolean;
    driver?: 'applescript' | 'playwright';
    /** Present after a check. */
    steps?: BrowserStep[];
    ready?: boolean;
}

const URL = '/api/browser';
const CONFIG_HEADERS = { 'Content-Type': 'application/json', 'X-DF-Configuration': '1' };

export const loadBrowserStatus = async (): Promise<BrowserStatus> => (await apiRequest<BrowserStatus>(URL)).data;

export const saveBrowserSettings = async (change: { enabled?: boolean; browser?: BrowserChoice }): Promise<BrowserStatus> => {
    const { revision } = await loadBrowserStatus();
    return (await apiRequest<BrowserStatus>(URL, { method: 'PUT', headers: CONFIG_HEADERS,
        body: JSON.stringify({ ...change, revision }) })).data;
};

/** Try each step the agent needs; on macOS this may show the system's permission prompt. */
export const checkBrowser = async (): Promise<BrowserStatus> =>
    (await apiRequest<BrowserStatus>(`${URL}/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).data;

/** Bring one of the agent's tabs to the front (a sign-in page it asked the user about). */
export const focusBrowserTab = async (tab: string) =>
    apiRequest(`${URL}/focus`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tab }) });

/** Open a page in the agent's browser for the user, e.g. to sign in to a site once. */
export const openInAgentBrowser = async (url: string) =>
    (await apiRequest<{ tab: string; url: string; title: string }>(`${URL}/open`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })).data;

export const browserConfig = (status: BrowserStatus): Partial<ServerConfig> => ({
    BROWSER_AVAILABLE: status.available,
    // A failed check keeps the browser from the agent, so it does not count as on.
    BROWSER_ENABLED: browserOn(status),
    BROWSER_MODE: status.mode,
});

/** The browser's switch is on and its last check, if any, passed. */
export const browserOn = (status: BrowserStatus) => status.enabled && status.ready !== false;

/** The tab a `df-browser://tab/<id>` link in the agent's message points to. */
export const browserTabFromHref = (href: string): string | undefined => {
    const match = /^df-browser:\/\/tab\/([A-Za-z0-9_-]{1,40})$/.exec(href);
    return match ? match[1] : undefined;
};
