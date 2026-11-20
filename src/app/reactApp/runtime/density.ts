// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * How dense an app is: one setting for its spacing unit, type scale, and the size of its controls.
 * Apps start compact (the DF canvas is a panel beside the thread); `normal` is MUI's own scale.
 * Agents write the same `spacing={3}`, `p: 2`, `variant="h5"` either way; the density decides the pixels.
 */
import { createTheme, useTheme, type Theme } from '@mui/material/styles';

export type Density = 'compact' | 'normal';

export const DEFAULT_DENSITY: Density = 'compact';

/** The sizes the `@df/chart` controls take at each density. */
export interface DensityMetrics {
    /** Height of every control (select, toggle, input, slider row), so a FilterBar's row lines up. */
    control: number;
    /** Font size inside controls and of their labels. */
    controlFont: string;
    labelFont: string;
    /** A FilterBar's padding and the gaps between its controls. */
    barPadding: string;
    barGap: string;
    chipHeight: number;
}

const METRICS: Record<Density, DensityMetrics> = {
    compact: { control: 30, controlFont: '0.8125rem', labelFont: '0.8125rem', barPadding: '8px 12px', barGap: '8px 16px', chipHeight: 24 },
    normal: { control: 36, controlFont: '0.875rem', labelFont: '0.875rem', barPadding: '12px 16px', barGap: '12px 20px', chipHeight: 28 },
};

export const densityMetrics = (density: Density | undefined) => METRICS[density ?? DEFAULT_DENSITY] ?? METRICS[DEFAULT_DENSITY];

/** The density the nearest theme was made for. */
export function useDensity(): DensityMetrics & { density: Density } {
    const density = ((useTheme() as Theme & { dfDensity?: Density }).dfDensity) ?? 'normal';
    return { density, ...densityMetrics(density) };
}

const rem = (px: number) => `${px / 16}rem`;

/** The type scale at a density: the variants the skill's recipes use, from page title to caption. */
const TYPE: Record<Density, Record<string, { fontSize: string; lineHeight?: number; fontWeight?: number; letterSpacing?: string }>> = {
    compact: {
        h1: { fontSize: rem(40), lineHeight: 1.15 }, h2: { fontSize: rem(32), lineHeight: 1.2 }, h3: { fontSize: rem(26), lineHeight: 1.25 },
        h4: { fontSize: rem(24), lineHeight: 1.25 }, h5: { fontSize: rem(19), lineHeight: 1.3 }, h6: { fontSize: rem(15.5), lineHeight: 1.35 },
        subtitle1: { fontSize: rem(14.5), lineHeight: 1.4 }, subtitle2: { fontSize: rem(13.5), lineHeight: 1.4 },
        body1: { fontSize: rem(14.5), lineHeight: 1.55 }, body2: { fontSize: rem(13), lineHeight: 1.5 },
        // Nothing smaller than 12 px: captions, notes, and kickers are read, not decoration.
        button: { fontSize: rem(13) }, caption: { fontSize: rem(12), lineHeight: 1.45 }, overline: { fontSize: rem(12), lineHeight: 1.5, letterSpacing: '0.06em' },
    },
    // MUI's own scale, stated: a normal page inside a compact one must not inherit the compact sizes.
    normal: {
        h1: { fontSize: rem(96), lineHeight: 1.167 }, h2: { fontSize: rem(60), lineHeight: 1.2 }, h3: { fontSize: rem(48), lineHeight: 1.167 },
        h4: { fontSize: rem(34), lineHeight: 1.235 }, h5: { fontSize: rem(24), lineHeight: 1.334 }, h6: { fontSize: rem(20), lineHeight: 1.6 },
        subtitle1: { fontSize: rem(16), lineHeight: 1.75 }, subtitle2: { fontSize: rem(14), lineHeight: 1.57 },
        body1: { fontSize: rem(16), lineHeight: 1.5 }, body2: { fontSize: rem(14), lineHeight: 1.43 },
        button: { fontSize: rem(14) }, caption: { fontSize: rem(12), lineHeight: 1.66 }, overline: { fontSize: rem(12), lineHeight: 2.66, letterSpacing: '0.08333em' },
    },
};

/** A theme at a density, over the theme it sits in (DF's, or an AppTheme's). */
export function densityTheme(outer: Theme, density: Density): Theme {
    const compact = density === 'compact';
    const small = { size: compact ? 'small' as const : 'medium' as const };
    // The spacing unit goes in the base options, where MUI makes the spacing function from it; the rest merges over.
    return createTheme({ ...outer, spacing: compact ? 6 : 8 } as object, {
        dfDensity: density,
        typography: TYPE[density],
        components: {
            MuiTextField: { defaultProps: small },
            MuiSelect: { defaultProps: small },
            MuiAutocomplete: { defaultProps: small },
            MuiToggleButtonGroup: { defaultProps: small },
            MuiButton: { defaultProps: small },
            MuiIconButton: { defaultProps: small },
            MuiChip: { defaultProps: small },
            MuiSlider: { defaultProps: small },
            MuiTableCell: { styleOverrides: { root: { padding: compact ? '5px 10px' : '6px 16px' } } },
        },
    } as object);
}
