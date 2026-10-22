// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Demos are served under `/demo/<id>` (see data_formulator/demos/README.md). The id is read
 * once, when the page loads: it is sent with every API request (selecting the demo's profile and
 * its own server storage) and keeps the demo's browser state apart from the standard app's.
 * Moving between a demo and the standard app therefore loads the page again.
 */

const DEMO_PATH = /^\/demo\/([a-z0-9][a-z0-9-]{0,40})(?:\/|$)/;

export const DEMO_HEADER = 'X-DF-Demo';

export const demoIdFromPath = (pathname: string): string | null => DEMO_PATH.exec(pathname)?.[1] ?? null;

/** The demo this page belongs to, or null for the standard app. */
export const DEMO_ID: string | null = typeof window === 'undefined' ? null : demoIdFromPath(window.location.pathname);

/** The page's front page and workspace: `/demo/<id>` in a demo, `/app` otherwise. */
export const APP_PATH = DEMO_ID ? `/demo/${DEMO_ID}` : '/app';

/** A browser storage name for this page: the standard app's as is, a demo's with its id. */
export const demoScoped = (name: string): string => DEMO_ID ? `${name}:demo:${DEMO_ID}` : name;
