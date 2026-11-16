// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The board: the look every app starts from before any `AppTheme`. Tiles are soft cards on a quiet page,
 * headings are set tight, tables are light, and charts draw without frames or axis rules, in the app's accent.
 * An `AppTheme` changes inks, fonts and papers over it (`extends: 'board'` adjusts this look itself); a
 * chart's own `theme` replaces the chart look.
 *
 * Every app also gets the `--df-*` tokens: the active look's colours, palette, type, and shape as CSS
 * variables on `:root`, for the app's own CSS and SVG. They are read-only outputs of the theme.
 */

import React, { useMemo, useRef } from 'react';
import GlobalStyles from '@mui/material/GlobalStyles';
import { alpha, createTheme, useTheme, type Theme } from '@mui/material/styles';

import { fontSans } from '../../tokens';

/** Categorical colours: distinct, even in weight, and readable on white (Observable's 10). */
export const BOARD_PALETTE = ['#4269d0', '#efb118', '#ff725c', '#6cc5b0', '#3ca951', '#ff8ab7', '#a463f2', '#97bbf5', '#9c6b4e', '#9498a0'];

/** The page behind the tiles, and the tiles. */
export const BOARD_PAGE = '#f6f7f9';
const BOARD_TILE = '#ffffff';
const BOARD_GRID = '#eaedf0';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** A theme that knows its categorical colours and grid ink (set by the board and by an AppTheme). */
export type PaletteTheme = Theme & { dfPalette?: string[]; dfGrid?: string };

/**
 * The chart look of a board: the plot without a frame, axis lines or ticks, a quiet sparse grid, muted
 * labels, keys above the plot, and one series in the app's accent.
 */
export function boardChartTheme(accent: string): Record<string, unknown> {
    return {
        id: 'df-board',
        label: 'Board',
        ink: {
            surface: { source: 'house', canvas: BOARD_TILE, plot: BOARD_TILE, panel: BOARD_PAGE },
            text: { primary: '#1f2328', secondary: '#59636e', muted: '#8b949e' },
            structure: { grid: BOARD_GRID, axis: '#d1d9e0', rule: '#d1d9e0' },
            series: { single: accent, categorical: BOARD_PALETTE, accent },
            accent,
        },
        type: {
            headline: { family: fontSans },
            deck: { family: fontSans },
            axisLabel: { family: fontSans, color: '#59636e' },
            axisTitle: { family: fontSans, color: '#59636e' },
            keyLabel: { family: fontSans, color: '#59636e' },
            keyTitle: { family: fontSans, color: '#59636e' },
            valueLabel: { family: fontSans },
            annotation: { family: fontSans },
        },
        structure: {
            axis: { categorical: { line: 'omit', ticks: 'omit', tickLabels: 'sparse' }, measure: { line: 'omit', ticks: 'omit', tickDensity: 'sparse' } },
            grid: { measure: 'quiet', category: 'omit', style: 'solid' },
            frame: 'omit',
            baseline: 'quiet',
        },
        marks: { strokeWeight: 2 },
        legend: { placement: ['top', 'right'], title: 'whenAmbiguous' },
    };
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Flint's merge for `extends`: nested objects merge; arrays and scalars replace. */
function mergeSpec(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(over)) {
        out[key] = isObject(value) && isObject(base[key]) ? mergeSpec(base[key] as Record<string, unknown>, value) : value;
    }
    return out;
}

/** Whether an app's theme is the board: `"board"`, or an object that `extends: "board"`. */
export const isBoardTheme = (theme: unknown): theme is 'board' | Record<string, unknown> =>
    theme === 'board' || (isObject(theme) && theme.extends === 'board');

/**
 * The board as a theme an app names: `"board"`, or `{ extends: "board", … }` with its overrides. The accent
 * follows the overrides' (`ink.accent` or `ink.series.accent`), else `accent`.
 */
export function boardSpec(theme: 'board' | Record<string, unknown>, accent: string): Record<string, unknown> {
    if (theme === 'board') return boardChartTheme(accent);
    const { extends: _extends, ...over } = theme;
    const ink = isObject(over.ink) ? over.ink : {};
    const series = isObject(ink.series) ? ink.series : {};
    const own = (typeof ink.accent === 'string' && ink.accent) || (typeof series.accent === 'string' && series.accent) || accent;
    return mergeSpec(boardChartTheme(own), over);
}

/** The board's MUI: rounded cards with a hairline and a faint lift, tight headings, and light tables. */
export function boardTheme(outer: Theme): Theme {
    return createTheme(outer as object, {
        dfPalette: BOARD_PALETTE,
        dfGrid: BOARD_GRID,
        palette: { background: { default: BOARD_PAGE, paper: BOARD_TILE } },
        shape: { borderRadius: 8 },
        typography: {
            h4: { letterSpacing: '-0.02em' },
            h5: { letterSpacing: '-0.015em' },
            h6: { letterSpacing: '-0.01em' },
            subtitle1: { letterSpacing: '-0.005em' },
        },
        components: {
            MuiPaper: {
                styleOverrides: {
                    // Read at render, so a dark AppTheme's divider and paper apply.
                    outlined: ({ theme }: { theme: Theme }) => ({
                        borderRadius: 10,
                        borderColor: theme.palette.mode === 'dark' ? theme.palette.divider : 'rgba(15, 23, 42, 0.08)',
                        boxShadow: theme.palette.mode === 'dark' ? 'none' : '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.03)',
                    }),
                },
            },
            MuiTableCell: {
                styleOverrides: {
                    body: ({ theme }: { theme: Theme }) => ({ borderBottomColor: alpha(theme.palette.text.primary, 0.07) }),
                    head: ({ theme }: { theme: Theme }) => ({ borderBottomColor: alpha(theme.palette.text.primary, 0.12) }),
                },
            },
            MuiAlert: { styleOverrides: { root: { borderRadius: 8 } } },
        },
    } as object);
}

/** The active look's resolved colours, for the app's own visuals (d3 scales, SVG, canvas). */
export interface Inks {
    /** Categorical colours, in order: the same the charts use for series. */
    palette: string[];
    accent: string;
    /** Text, secondary text, and faint text (ticks, hints). */
    text: string;
    muted: string;
    faint: string;
    /** The page, a tile, gridlines, and rules (dividers, borders). */
    page: string;
    surface: string;
    grid: string;
    rule: string;
    positive: string;
    negative: string;
    warning: string;
    font: string;
    /** Whether the page is dark. */
    dark: boolean;
}

export function inksOf(theme: Theme): Inks {
    const { palette } = theme;
    const own = theme as PaletteTheme;
    return {
        palette: own.dfPalette?.length ? own.dfPalette : BOARD_PALETTE,
        accent: palette.primary.main,
        text: palette.text.primary,
        muted: palette.text.secondary,
        faint: alpha(palette.text.primary, palette.mode === 'dark' ? 0.45 : 0.4),
        page: palette.background.default,
        surface: palette.background.paper,
        grid: own.dfGrid ?? alpha(palette.text.primary, 0.08),
        rule: palette.divider,
        positive: palette.success.main,
        negative: palette.error.main,
        warning: palette.warning.main,
        font: String(theme.typography.fontFamily ?? fontSans),
        dark: palette.mode === 'dark',
    };
}

/** The active look's colours (see `Inks`), following the app's AppTheme. */
export function useInks(): Inks {
    const theme = useTheme();
    return useMemo(() => inksOf(theme), [theme]);
}

const px = (value: unknown) => (typeof value === 'number' ? `${value}px` : String(value));

/** The `--df-*` tokens of a theme: what the app's own CSS reads. */
export function tokenVars(theme: Theme): Record<string, string> {
    const inks = inksOf(theme);
    const type = theme.typography as unknown as Record<string, { fontSize?: string | number; fontFamily?: string }>;
    return {
        '--df-text': inks.text,
        '--df-muted': inks.muted,
        '--df-faint': inks.faint,
        '--df-primary': inks.accent,
        '--df-primary-soft': alpha(inks.accent, 0.12),
        '--df-on-primary': theme.palette.primary.contrastText,
        '--df-positive': inks.positive,
        '--df-negative': inks.negative,
        '--df-warning': inks.warning,
        '--df-canvas': inks.page,
        '--df-surface': inks.surface,
        '--df-grid': inks.grid,
        '--df-rule': inks.rule,
        '--df-hover': theme.palette.action.hover,
        '--df-font': inks.font,
        '--df-font-display': String(type.h4?.fontFamily ?? inks.font),
        '--df-font-mono': MONO,
        '--df-text-xs': px(type.caption?.fontSize ?? '0.75rem'),
        '--df-text-sm': px(type.body2?.fontSize ?? '0.8125rem'),
        '--df-text-md': px(type.body1?.fontSize ?? '0.875rem'),
        '--df-text-lg': px(type.h6?.fontSize ?? '1rem'),
        '--df-text-xl': px(type.h5?.fontSize ?? '1.25rem'),
        '--df-space': theme.spacing(1),
        '--df-radius': `${theme.shape.borderRadius}px`,
        '--df-radius-tile': '10px',
        ...Object.fromEntries(inks.palette.slice(0, 10).map((color, index) => [`--df-palette-${index + 1}`, color])),
    };
}

/** Sets the `--df-*` tokens of the theme around it on `:root`. */
export function TokenStyles() {
    return <GlobalStyles styles={(theme: Theme) => ({ ':root': tokenVars(theme) })} />;
}

/** Size of an element, tracked across resizes: `const ref = useRef(null); const { width, height } = useSize(ref);`. */
export function useSize(ref: React.RefObject<HTMLElement | SVGElement | null>) {
    const [size, setSize] = React.useState({ width: 0, height: 0 });
    React.useEffect(() => {
        const element = ref.current;
        if (!element) return;
        const update = () => {
            const box = element.getBoundingClientRect();
            setSize(previous => (previous.width === Math.floor(box.width) && previous.height === Math.floor(box.height)
                ? previous : { width: Math.floor(box.width), height: Math.floor(box.height) }));
        };
        update();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    return size;
}

/** A ref and its element's size, in one: `const [ref, { width }] = useMeasure();`. */
export function useMeasure<T extends HTMLElement = HTMLDivElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
    const ref = useRef<T>(null);
    return [ref, useSize(ref)];
}
