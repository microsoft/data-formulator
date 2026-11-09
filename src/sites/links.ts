// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Profile links may go to web pages, email or this site; anything else (e.g. javascript:) is not linked. */
export const safeUrl = (url?: string) => {
    const value = (url || '').trim();
    return /^(https?:\/\/|mailto:|#|\/(?!\/))/i.test(value) ? value : undefined;
};
