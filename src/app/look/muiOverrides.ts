// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Components, Theme } from '@mui/material/styles';

import { LOOKS, type Look } from './looks';

/** MUI component overrides that only some looks need, merged into the theme by `createDfTheme`. Corners shared by
 *  every look (buttons, menus) read `corner.control` in theme.ts directly. */
export const lookComponents = (look: Look): Components<Omit<Theme, 'components'>> => {
    const { corner, mode } = LOOKS[look];
    return {
        ...(corner.control === LOOKS.soft.corner.control ? {} : {
            // Chips and tooltips lose their pill and soft corners for the look's control corner.
            MuiChip: { styleOverrides: { root: { borderRadius: corner.control } } },
            MuiTooltip: { styleOverrides: { tooltip: { borderRadius: corner.control } } },
        }),
        ...(mode === 'dark' ? {
            // Menus and dialogs stay the paper colour, outlined, rather than MUI's lighter overlay per elevation.
            MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' },
                elevation: { border: '1px solid var(--df-line-component)' } } },
        } : {}),
    };
};
