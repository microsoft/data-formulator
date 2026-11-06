// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The chart toolbar's Flint theme picker: hovering a theme previews it on the
// canvas, choosing one sets the chart's themeId.

import { FC, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';

import { Box, alpha, useTheme, Tooltip, Divider, Menu, MenuItem } from '@mui/material';
import { DEFAULT_THEME_ICON, THEME_PRESETS } from 'flint-chart';

import { dfActions, dfSelectors } from '../app/dfSlice';
import { deleteSavedTheme, resolvedChartTheme, useSavedThemes, type SavedTheme } from '../app/savedThemes';
import { AppDispatch } from '../app/store';
import { transition } from '../app/tokens';
import { Chart } from '../components/ComponentType';
import { textVar } from '../app/layout';

export interface ChartThemePickerProps {
    chartId: string;
    onThemePreview?: (themeId: string | undefined) => void;
    onThemePreviewEnd?: () => void;
}

export const THEME_CHOICES = [
    {
        id: undefined,
        label: 'Flint default',
        icon: DEFAULT_THEME_ICON,
        description: "Flint's own defaults - no house applied.",
    },
    ...Object.values(THEME_PRESETS).map(preset => ({
        id: preset.id,
        label: preset.label,
        icon: preset.icon,
        description: preset.description,
    })),
];

export const themeIconUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** A saved theme's icon: its first series colors as bars on its paper. */
const savedThemeIcon = (theme: SavedTheme) => {
    const resolved = resolvedChartTheme(theme.id);
    const series: string[] = resolved?.ink?.series?.categorical ?? [];
    const colors = (series.length ? series : [resolved?.ink?.series?.single ?? '#4c78a8']).slice(0, 3);
    const paper = resolved?.ink?.surface?.source === 'house' ? resolved.ink.surface.plot ?? resolved.ink.surface.canvas ?? '#ffffff' : '#ffffff';
    const safe = (color: string) => /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#888888';
    const bars = colors.map((color, index) => `<rect x="${3 + index * 4}" y="${12 - (index + 2) * 2}" width="3" height="${(index + 2) * 2}" fill="${safe(color)}"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="0.5" y="0.5" width="15" height="15" rx="3" fill="${safe(paper)}" stroke="#c8c8c8"/>${bars}</svg>`;
};

export type ThemeChoice = typeof THEME_CHOICES[number] & { saved?: boolean };

/** Flint's presets, then the user's saved themes. */
export function useThemeChoices(): ThemeChoice[] {
    const saved = useSavedThemes();
    return useMemo(() => [
        ...THEME_CHOICES,
        ...saved.map(theme => ({ id: theme.id, label: theme.label || theme.id, icon: savedThemeIcon(theme),
            description: theme.description ?? `Your saved theme${theme.extends ? `, based on ${theme.extends}` : ''}.`, saved: true })),
    ], [saved]);
}

export const ChartThemePicker: FC<ChartThemePickerProps> = function ({ chartId, onThemePreview, onThemePreviewEnd }) {
    const theme = useTheme();
    const dispatch = useDispatch<AppDispatch>();
    const allCharts = useSelector(dfSelectors.getAllCharts);
    const choices = useThemeChoices();

    const [themeAnchor, setThemeAnchor] = useState<HTMLElement | null>(null);
    const themePreviewTimerRef = useRef<number | null>(null);
    // Previews only while the menu is open: as it fades out after a pick, the pointer still crosses its
    // items, and a preview started then would stick on the canvas over the chosen theme.
    const menuOpenRef = useRef(false);
    menuOpenRef.current = !!themeAnchor;

    const endThemePreview = () => {
        if (themePreviewTimerRef.current != null) {
            window.clearTimeout(themePreviewTimerRef.current);
            themePreviewTimerRef.current = null;
        }
        onThemePreviewEnd?.();
    };

    const scheduleThemePreview = (themeId: string | undefined) => {
        if (!menuOpenRef.current) return;
        if (themePreviewTimerRef.current != null) {
            window.clearTimeout(themePreviewTimerRef.current);
        }
        themePreviewTimerRef.current = window.setTimeout(() => {
            themePreviewTimerRef.current = null;
            if (menuOpenRef.current) onThemePreview?.(themeId);
        }, 120);
    };
    const closeMenu = () => {
        menuOpenRef.current = false;
        endThemePreview();
        setThemeAnchor(null);
    };

    useEffect(() => () => {
        if (themePreviewTimerRef.current != null) {
            window.clearTimeout(themePreviewTimerRef.current);
        }
        onThemePreviewEnd?.();
    }, [onThemePreviewEnd]);

    const chart = allCharts.find((c: Chart) => c.id == chartId) as Chart | undefined;

    if (!chart) return null;
    // Themes only apply to rendered charts, not the raw table or the "Auto" placeholder.
    if (chart.chartType === 'Table' || chart.chartType === 'Auto') return null;

    const selectedTheme = choices.find(choice => choice.id === chart.themeId) ?? choices[0];

    return (
        <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.5, px: 1,
            // Rendered in the floating top toolbar (see VisualizationView), right after the
            // zoom resizer; a leading divider separates the two groups.
            minHeight: 34,
        }}>
            <Divider orientation="vertical" flexItem sx={{ my: 0.5, mr: 1, borderColor: alpha(theme.palette.text.primary, 0.12) }} />
            <Tooltip title={`Theme: ${selectedTheme?.label ?? 'Default'}`}>
                <Box
                    component="button"
                    type="button"
                    aria-label={`Chart theme: ${selectedTheme?.label ?? 'Default'}`}
                    aria-controls={themeAnchor ? 'chart-theme-menu' : undefined}
                    aria-haspopup="menu"
                    aria-expanded={themeAnchor ? 'true' : undefined}
                    onClick={(event) => setThemeAnchor(event.currentTarget)}
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        height: 26,
                        px: '8px',
                        border: 0,
                        borderRadius: '7px',
                        color: 'text.secondary',
                        backgroundColor: alpha(theme.palette.text.primary, themeAnchor ? 0.07 : 0.05),
                        cursor: 'pointer',
                        transition: transition.fast,
                        '&:hover': {
                            color: 'text.primary',
                            backgroundColor: alpha(theme.palette.text.primary, 0.07),
                        },
                        '&:focus-visible': { outline: `2px solid ${theme.palette.text.primary}`, outlineOffset: '-2px' },
                    }}
                >
                    <Box component="img" src={themeIconUrl(selectedTheme.icon)} alt="" sx={{ width: 14, height: 14, display: 'block' }} />
                    <Box component="svg" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" sx={{ width: 11, height: 11, display: 'block', flex: '0 0 auto' }}>
                        <path d="M3 4.5 L6 7.5 L9 4.5" />
                    </Box>
                </Box>
            </Tooltip>
            <Menu
                id="chart-theme-menu"
                anchorEl={themeAnchor}
                open={Boolean(themeAnchor)}
                onClose={closeMenu}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                slotProps={{
                    paper: {
                        sx: {
                            minWidth: 180,
                            maxHeight: 'min(240px, 42vh)',
                            mt: 0.5,
                            p: '4px',
                            border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
                            borderRadius: '10px',
                        },
                    },
                    list: { sx: { p: 0 }, onMouseLeave: endThemePreview },
                }}
            >
                {choices.map((choice, index) => [
                    choice.saved && !choices[index - 1]?.saved
                        ? <Divider key="saved-divider" sx={{ my: '4px !important' }} />
                        : null,
                    <MenuItem
                        key={choice.id ?? 'default'}
                        selected={chart.themeId === choice.id}
                        title={choice.description}
                        onMouseEnter={() => scheduleThemePreview(choice.id)}
                        onClick={() => {
                            closeMenu();
                            dispatch(dfActions.setChartTheme({ chartId, themeId: choice.id }));
                        }}
                        sx={{
                            gap: '8px',
                            minHeight: 0,
                            px: '8px',
                            py: '6px',
                            borderRadius: '7px',
                            fontSize: textVar.xs,
                            color: 'text.primary',
                        }}
                    >
                        <Box component="img" src={themeIconUrl(choice.icon)} alt="" sx={{ width: 15, height: 15, display: 'block', flex: '0 0 auto' }} />
                        <Box component="span" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {choice.label}
                        </Box>
                        {choice.saved && choice.id && (
                            <Box component="button" type="button" aria-label={`Remove theme ${choice.label}`} title="Remove from your themes"
                                onClick={(event: React.MouseEvent) => {
                                    event.stopPropagation();
                                    if (window.confirm(`Remove the theme "${choice.label}" from your themes? Charts that use it go back to the default look.`)) {
                                        void deleteSavedTheme(choice.id!);
                                    }
                                }}
                                sx={{ border: 0, bgcolor: 'transparent', color: 'text.disabled', cursor: 'pointer', p: '0 2px', lineHeight: 1, fontSize: 14,
                                    opacity: 0, '.MuiMenuItem-root:hover &': { opacity: 1 }, '&:hover': { color: 'text.primary' } }}>×</Box>
                        )}
                    </MenuItem>,
                ])}
            </Menu>
        </Box>
    );
};
