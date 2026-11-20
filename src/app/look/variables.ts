// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LOOKS, type Look } from './looks';

/** The CSS variables behind the shared tokens (tokens.ts `borderColor`, `cardRadius`, ...) for a look. */
export const lookVariables = (look: Look): Record<string, string | null> => LOOKS[look].vars;

/** Sets a look's variables on an element (the document root), clearing those the look leaves to the call sites. */
export const applyLookVariables = (style: CSSStyleDeclaration, look: Look) => {
    for (const [name, value] of Object.entries(lookVariables(look))) {
        if (value) style.setProperty(name, value); else style.removeProperty(name);
    }
};
