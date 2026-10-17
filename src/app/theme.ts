// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { alpha, createTheme, type Theme } from '@mui/material/styles';

import { menuPaperSlotProps } from './LayoutProvider';
import { buttonVar, iconVar, textVar } from './layout';
import { bgAlpha, defaultPaletteKey, palettes } from './tokens';

/**
 * Data Formulator's MUI theme for a palette. Shared by the app shell and by
 * sandboxed React apps so both render with identical components and tokens.
 * Sizes resolve through the `--df-*` CSS variables that LayoutProvider sets.
 */
export function createDfTheme(paletteKey: string): Theme {
    return createTheme({
    typography: {
        fontFamily: [
            "Arial",
            "Roboto",
            "Helvetica Neue",
            "sans-serif"
        ].join(",")
    },
    // Default Material UI palette
    // Active palette from user config — selectable via Settings dialog
    // Available: material, fluent, vivid, jewel, electric, tealCoral, copilot
    palette: (() => {
        const p = palettes[paletteKey] ?? palettes[defaultPaletteKey];
        const bg = (entry: { main: string; bgcolor?: string }) => entry.bgcolor ?? alpha(entry.main, bgAlpha);
        const tc = (entry: { main: string; textColor?: string }) => entry.textColor ?? entry.main;
        return {
            primary:   { main: p.primary.main,   bgcolor: bg(p.primary),   textColor: tc(p.primary)   },
            secondary: { main: p.secondary.main, bgcolor: bg(p.secondary), textColor: tc(p.secondary) },
            derived:   { main: p.derived.main,   bgcolor: bg(p.derived),   textColor: tc(p.derived)   },
            custom:    { main: p.custom.main,    bgcolor: bg(p.custom),    textColor: tc(p.custom)    },
            warning:   { main: p.warning.main },
        };
    })(),
    components: {
        MuiMenu: {
            defaultProps: { slotProps: { paper: menuPaperSlotProps } },
            styleOverrides: {
                paper: { maxWidth: 'calc(100vw - 32px)', borderRadius: 4, fontSize: 'var(--df-menu-font-size, max(0.875rem, var(--df-text-md, 13px)))' },
                list: { paddingTop: 4, paddingBottom: 4 },
            },
        },
        MuiMenuItem: {
            defaultProps: { dense: true },
            styleOverrides: {
                root: {
                    fontSize: 'var(--df-menu-font-size, max(0.875rem, var(--df-text-md, 13px)))',
                    lineHeight: 1.4,
                    minHeight: `max(${buttonVar.heightMedium}, 2em)`,
                    padding: '0.4em 0.85em',
                    whiteSpace: 'normal',
                    overflowWrap: 'anywhere',
                    '& .MuiListItemIcon-root': { minWidth: '1.85em', fontSize: 'inherit', flexShrink: 0 },
                    '& .MuiSvgIcon-root': { fontSize: '1.2em' },
                    '& .MuiListItemText-primary': { fontSize: 'inherit', lineHeight: 'inherit' },
                    '& .MuiListItemText-secondary': { fontSize: '0.9em' },
                },
            },
        },
        MuiDialog: {
            styleOverrides: {
                paper: {
                    '--df-control-font-size': 'max(0.875rem, var(--df-text-md, 13px))',
                    fontSize: 'var(--df-control-font-size)',
                },
            },
        },
        // Autocomplete popups are portaled outside the dialog, so they need the menu sizing explicitly.
        MuiAutocomplete: {
            styleOverrides: {
                paper: { fontSize: 'var(--df-menu-font-size, max(0.875rem, var(--df-text-md, 13px)))' },
                listbox: { paddingTop: 4, paddingBottom: 4,
                    '& .MuiAutocomplete-option': { fontSize: 'inherit', lineHeight: 1.4, minHeight: `max(${buttonVar.heightMedium}, 2em)`, padding: '0.4em 0.85em' } },
                noOptions: { fontSize: 'inherit', padding: '0.4em 0.85em' },
                loading: { fontSize: 'inherit', padding: '0.4em 0.85em' },
            },
        },
        MuiDialogTitle: {
            styleOverrides: { root: { fontSize: '1.2em', lineHeight: 1.4, padding: '16px 20px 12px' } },
        },
        MuiDialogContent: {
            styleOverrides: { root: { fontSize: 'inherit', padding: '12px 20px 16px' } },
        },
        MuiDialogContentText: {
            styleOverrides: { root: { fontSize: 'inherit', lineHeight: 1.5 } },
        },
        MuiDialogActions: {
            styleOverrides: { root: { padding: '8px 20px 16px', gap: 4 } },
        },
        MuiInputBase: {
            styleOverrides: { root: { fontSize: 'var(--df-control-font-size, max(0.875rem, var(--df-text-md, 13px)))', lineHeight: 1.5 } },
        },
        MuiInputLabel: {
            styleOverrides: { root: { fontSize: 'var(--df-control-font-size, max(0.875rem, var(--df-text-md, 13px)))' } },
        },
        MuiFormHelperText: {
            styleOverrides: { root: { fontSize: 'max(0.75rem, var(--df-text-xs, 11px))' } },
        },
        MuiAlert: {
            styleOverrides: {
                root: { fontSize: 'var(--df-control-font-size, max(0.875rem, var(--df-text-md, 13px)))', lineHeight: 1.5 },
                icon: { fontSize: '1.4em' },
            },
        },
        MuiButton: {
            defaultProps: {
                disableElevation: true,
            },
            styleOverrides: {
                root: {
                    textTransform: 'none',
                    borderRadius: 4,
                    fontWeight: 500,
                    lineHeight: 1.4,
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                    '& .MuiButton-startIcon': {
                        marginLeft: 0,
                        marginRight: buttonVar.iconGap,
                    },
                    '& .MuiButton-endIcon': {
                        marginLeft: buttonVar.iconGap,
                        marginRight: 0,
                    },
                },
                sizeSmall: {
                    minHeight: buttonVar.heightSmall,
                    padding: `0 ${buttonVar.paddingSmall}`,
                    fontSize: `var(--df-control-font-size, ${textVar.sm})`,
                    '& .MuiButton-icon > :nth-of-type(1)': {
                        fontSize: iconVar.sm,
                    },
                },
                sizeMedium: {
                    minHeight: buttonVar.heightMedium,
                    padding: `0 ${buttonVar.paddingMedium}`,
                    fontSize: `var(--df-control-font-size, ${textVar.md})`,
                    '& .MuiButton-icon > :nth-of-type(1)': {
                        fontSize: iconVar.md,
                    },
                },
                text: ({ ownerState, theme: t }) => {
                    const c = ownerState.color;
                    if (c && c !== 'inherit' && c !== 'error' && c !== 'info' && c !== 'success' && c in t.palette) {
                        const p = (t.palette as any)[c];
                        if (p?.textColor) return { color: p.textColor };
                    }
                    return {};
                },
                outlined: ({ ownerState, theme: t }) => {
                    const c = ownerState.color;
                    if (c && c !== 'inherit' && c !== 'error' && c !== 'info' && c !== 'success' && c in t.palette) {
                        const p = (t.palette as any)[c];
                        if (p?.textColor) return { color: p.textColor, borderColor: alpha(p.textColor, 0.5) };
                    }
                    return {};
                },
            },
            variants: [
                {
                    props: { variant: 'soft' },
                    style: ({ theme: t }) => ({
                        color: (t.palette.primary as any).textColor ?? t.palette.primary.main,
                        backgroundColor: (t.palette.primary as any).bgcolor ?? alpha(t.palette.primary.main, 0.1),
                        '&:hover': {
                            backgroundColor: alpha(t.palette.primary.main, 0.16),
                        },
                    }),
                },
                {
                    props: { variant: 'toolbar' },
                    style: ({ theme: t }) => ({
                        color: t.palette.text.secondary,
                        backgroundColor: 'transparent',
                        '&:hover': {
                            color: t.palette.text.primary,
                            backgroundColor: t.palette.action.hover,
                        },
                    }),
                },
            ],
        },
        MuiIconButton: {
            styleOverrides: {
                root: ({ ownerState, theme: t }) => {
                    const c = ownerState.color;
                    if (c && c !== 'inherit' && c !== 'default' && c !== 'error' && c !== 'info' && c !== 'success' && c in t.palette) {
                        const p = (t.palette as any)[c];
                        if (p?.textColor) return { color: p.textColor };
                    }
                    return {};
                },
            },
        },
        MuiLink: {
            styleOverrides: {
                root: ({ ownerState, theme: t }) => {
                    const c = ownerState.color as string | undefined;
                    if (c && c !== 'inherit' && c in t.palette) {
                        const p = (t.palette as any)[c];
                        if (p?.textColor) return { color: p.textColor };
                    }
                    return {};
                },
            },
        },
    },
    transitions: {
        duration: {
            shortest: 100,
            shorter: 100,
            short: 100,
            standard: 100,
            complex: 150,
            enteringScreen: 100,
            leavingScreen: 100,
        },
    },
});
}
