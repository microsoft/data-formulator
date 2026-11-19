// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Components, Theme } from '@mui/material/styles';

import { LOOKS, type Look } from './looks';

/** MUI component overrides that only some looks need, merged into the theme by `createDfTheme`. Corners shared by
 *  every look (buttons, menus) read `corner.control` in theme.ts directly. */
export const lookComponents = (look: Look): Components<Omit<Theme, 'components'>> => {
    const { corner } = LOOKS[look];
    if (corner.control === LOOKS.soft.corner.control) return {};
    return {
        // Chips and tooltips lose their pill and soft corners for the look's control corner.
        MuiChip: { styleOverrides: { root: { borderRadius: corner.control } } },
        MuiTooltip: { styleOverrides: { tooltip: { borderRadius: corner.control } } },
    };
};
