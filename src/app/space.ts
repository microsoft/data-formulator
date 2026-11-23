// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Spaces are served under `/space/<id>` (see data_formulator/spaces/README.md and design-docs/77). The id is read
 * once, when the page loads: it is sent with every API request (selecting the space's profile and its own server
 * storage) and keeps the space's browser state apart from the standard app's. Moving between a space and the
 * standard app therefore loads the page again.
 */

const SPACE_PATH = /^\/space\/([a-z0-9][a-z0-9-]{0,40})(?:\/|$)/;

export const SPACE_HEADER = 'X-DF-Space';

export const spaceIdFromPath = (pathname: string): string | null => SPACE_PATH.exec(pathname)?.[1] ?? null;

/** A space's address. */
export const spacePath = (id: string): string => `/space/${id}`;

/** The space this page belongs to, or null for the standard app. */
export const SPACE_ID: string | null = typeof window === 'undefined' ? null : spaceIdFromPath(window.location.pathname);

/** The page's front page and workspace: `/space/<id>` in a space, `/app` otherwise. */
export const APP_PATH = SPACE_ID ? spacePath(SPACE_ID) : '/app';

/** A browser storage name for this page: the standard app's as is, a space's with its id. The `:demo:` in it is
 *  from before spaces were named so; it stays so that saved browser state is found. */
export const spaceScoped = (name: string): string => SPACE_ID ? `${name}:demo:${SPACE_ID}` : name;
