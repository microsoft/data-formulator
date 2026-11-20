// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// A demo's landing page is read by visitors, not worked in: a wider column and larger type than the
// app's dense workspace tokens (design-docs/69).

/** The column holding the chat, dataset tabs and descriptions: a share of the window (about 800px on a
 *  laptop), growing a little on large screens; the chat is the page's centre and should not get long. */
export const DEMO_COLUMN = 'clamp(680px, 58vw, 860px)';

/** Height of the block from the page's top to the chat's bottom that puts the chat at the screen's middle:
 *  half the screen, less the app bar above the page, plus half the chat box. */
export const DEMO_CHAT_CENTRE = 'calc(50vh + 18px)';

/** The page's outer width, a little wider than its column. */
export const DEMO_PAGE = 'clamp(760px, 64vw, 940px)';

/** The chat's text is the largest; chips, tabs and the dataset panel are quieter, so the chat stays the focus. */
export const demoText = {
    small: '13px',
    body: '14px',
    lead: '15px',
    heading: '17px',
    input: '16px',
} as const;
