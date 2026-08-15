// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Horizontal strip of Flint themes and chart style variants created by the
// restyle agent. Themes apply to the encoded base chart; custom variants are
// saved chart-specific specs that override that base while active.
//
// This is a self-contained extraction of the variant logic that used to live
// inside EncodingShelfCard, so it can be rendered independently of the
// encoding popover. See dfActions.setActiveVariant / updateStyleVariant /
// deleteStyleVariant and src/app/restyle.ts.

import { FC, useEffect, useRef, useState } from 'react';
import React from 'react';
import { useSelector, useDispatch } from 'react-redux';

import { Box, Typography, CircularProgress, alpha, useTheme, IconButton, Tooltip, Popover, TextField, Card, Divider, Button, Menu, MenuItem } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import SendIcon from '@mui/icons-material/Send';
import { DEFAULT_THEME_ICON, THEME_PRESETS } from 'flint-chart';

import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { transition } from '../app/tokens';
import {
    Chart,
    ChartStyleVariant,
    computeEncodingFingerprint,
    isVariantStale,
} from '../components/ComponentType';
import { buildSpecForRestyle, buildDataContext, callRestyleAgent, makeVariant } from '../app/restyle';
import { getDataTable } from './ChartUtils';
import { iconVar, textVar } from '../app/layout';

export interface ChartVariantStripProps {
    chartId: string;
    onThemePreview?: (themeId: string | undefined) => void;
    onThemePreviewEnd?: () => void;
}

interface QuickAction { key: string; label: string; description: string; instruction: string }

const THEME_CHOICES = [
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

const themeIconUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

const ANNOTATE_ACTIONS: QuickAction[] = [
    {
        key: 'annotate-peak',
        label: 'highest point',
        description: 'Mark the highest value',
        instruction: 'Annotate the highest value in the chart with a label.',
    },
    {
        key: 'avg-line',
        label: 'average line',
        description: 'Add a reference line at the mean',
        instruction: 'Add a reference line at the average value.',
    },
    {
        key: 'data-labels',
        label: 'data labels',
        description: 'Label each data point with its value',
        instruction: 'Add data labels showing the value of each mark.',
    },
];

export const ChartVariantStrip: FC<ChartVariantStripProps> = function ({ chartId, onThemePreview, onThemePreviewEnd }) {
    const theme = useTheme();
    const dispatch = useDispatch<AppDispatch>();

    const tables = useSelector(dfSelectors.getAllTables);
    const allCharts = useSelector(dfSelectors.getAllCharts);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const activeModel = useSelector(dfSelectors.getActiveModel);

    const [refreshingVariantId, setRefreshingVariantId] = useState<string | null>(null);
    const [themeAnchor, setThemeAnchor] = useState<HTMLElement | null>(null);
    const [restyleAnchor, setRestyleAnchor] = useState<HTMLElement | null>(null);
    const [restylePrompt, setRestylePrompt] = useState('');
    const [isRestyling, setIsRestyling] = useState(false);
    const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
    const themePreviewTimerRef = useRef<number | null>(null);

    const endThemePreview = () => {
        if (themePreviewTimerRef.current != null) {
            window.clearTimeout(themePreviewTimerRef.current);
            themePreviewTimerRef.current = null;
        }
        onThemePreviewEnd?.();
    };

    const scheduleThemePreview = (themeId: string | undefined) => {
        if (themePreviewTimerRef.current != null) {
            window.clearTimeout(themePreviewTimerRef.current);
        }
        themePreviewTimerRef.current = window.setTimeout(() => {
            themePreviewTimerRef.current = null;
            onThemePreview?.(themeId);
        }, 120);
    };

    useEffect(() => () => {
        if (themePreviewTimerRef.current != null) {
            window.clearTimeout(themePreviewTimerRef.current);
        }
        onThemePreviewEnd?.();
    }, [onThemePreviewEnd]);

    const chart = allCharts.find((c: Chart) => c.id == chartId) as Chart | undefined;

    if (!chart) return null;
    // Restyling only applies to rendered Vega charts, not the raw table or
    // the not-yet-chosen "Auto" placeholder.
    if (chart.chartType === 'Table' || chart.chartType === 'Auto') return null;

    const variants: ChartStyleVariant[] = chart.styleVariants ?? [];
    const activeVariantId = chart.activeVariantId;
    const selectedTheme = THEME_CHOICES.find(choice => choice.id === chart.themeId) ?? THEME_CHOICES[0];

    const currentTable = getDataTable(chart, tables, allCharts, conceptShelfItems);

    const pickVariantLabel = (suggested: string | undefined): string => {
        const taken = new Set(variants.map(v => (v.label || v.id).toLowerCase()));
        const cleaned = (suggested || '').trim().replace(/^["']+|["']+$/g, '').slice(0, 24);
        const base = cleaned || `v${variants.length + 1}`;
        if (!taken.has(base.toLowerCase())) return base;
        for (let i = 2; i < 100; i++) {
            const candidate = `${base} ${i}`;
            if (!taken.has(candidate.toLowerCase())) return candidate;
        }
        return base;
    };

    const handleRestyleSubmit = async (instruction: string) => {
        const text = instruction.trim();
        if (!text || isRestyling) return;
        if (!activeModel) {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'chart restyle',
                type: 'error',
                value: 'No model is configured. Please select a model before restyling.',
            }));
            return;
        }
        const activeVariant = activeVariantId
            ? variants.find(v => v.id === activeVariantId)
            : undefined;
        const prepared = buildSpecForRestyle(chart, currentTable, conceptShelfItems, activeVariant);
        if (!prepared) {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'chart restyle',
                type: 'error',
                value: 'Cannot restyle this chart yet — make sure all required fields are encoded first.',
            }));
            return;
        }
        const { dataSample } = buildDataContext(currentTable, prepared.embeddedData);

        setIsRestyling(true);
        setPendingPrompt(text);
        setRestylePrompt('');
        setRestyleAnchor(null);
        dispatch(dfActions.changeChartRunningStatus({ chartId, status: true }));
        try {
            const result = await callRestyleAgent({
                instruction: text,
                vlSpec: prepared.spec,
                chartType: chart.chartType,
                dataSample,
                model: activeModel,
            });
            if (result.kind === 'out_of_scope') {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    component: 'chart restyle',
                    type: 'info',
                    value: result.rationale
                        ? `Style agent: "${result.rationale}" — this looks like a data change, not a style change.`
                        : 'This looks like a data change, not a style change.',
                }));
                return;
            }
            const variant = makeVariant({
                chart,
                prompt: text,
                vlSpec: result.vlSpec,
                rationale: result.rationale,
                label: pickVariantLabel(result.label),
                basedOnVariantId: prepared.basedOnVariantId,
                configUI: result.configUI,
            });
            dispatch(dfActions.addStyleVariant({ chartId, variant, activate: true }));
        } catch (err: any) {
            console.warn('[chart-restyle] failed', err);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'chart restyle',
                type: 'error',
                value: `Restyle failed: ${err?.message || String(err)}`,
            }));
        } finally {
            setIsRestyling(false);
            setPendingPrompt(null);
            dispatch(dfActions.changeChartRunningStatus({ chartId, status: false }));
        }
    };

    const handleRefreshVariant = async (variant: ChartStyleVariant) => {
        if (refreshingVariantId) return;
        if (!activeModel) {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'chart restyle',
                type: 'error',
                value: 'No model is configured. Please select a model before refreshing.',
            }));
            return;
        }
        const prepared = buildSpecForRestyle(chart, currentTable, conceptShelfItems);
        if (!prepared) {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'chart restyle',
                type: 'error',
                value: 'Cannot refresh — chart is not currently renderable.',
            }));
            return;
        }
        const { dataSample } = buildDataContext(currentTable, prepared.embeddedData);

        setRefreshingVariantId(variant.id);
        dispatch(dfActions.changeChartRunningStatus({ chartId, status: true }));
        try {
            const result = await callRestyleAgent({
                instruction: variant.prompt,
                vlSpec: prepared.spec,
                chartType: chart.chartType,
                dataSample,
                model: activeModel,
                styleReferenceSpec: variant.vlSpec,
            });
            if (result.kind === 'out_of_scope') {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    component: 'chart restyle',
                    type: 'info',
                    value: result.rationale
                        ? `Style agent: "${result.rationale}"`
                        : 'Could not refresh this variant against the current encoding.',
                }));
                return;
            }
            dispatch(dfActions.updateStyleVariant({
                chartId,
                variantId: variant.id,
                vlSpec: result.vlSpec,
                rationale: result.rationale,
                encodingFingerprint: computeEncodingFingerprint(chart),
                configUI: result.configUI,
            }));
        } catch (err: any) {
            console.warn('[chart-restyle] refresh failed', err);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'chart restyle',
                type: 'error',
                value: `Refresh failed: ${err?.message || String(err)}`,
            }));
        } finally {
            setRefreshingVariantId(null);
            dispatch(dfActions.changeChartRunningStatus({ chartId, status: false }));
        }
    };

    const renderVariantChip = (label: string, opts: {
        active: boolean,
        stale?: boolean,
        refreshing?: boolean,
        tooltip?: string,
        onClick: () => void,
        onDelete?: () => void,
    }) => {
        const accent = opts.active ? theme.palette.primary.main : theme.palette.text.primary;
        return (
            <Box
                key={label}
                component="span"
                onClick={opts.onClick}
                title={opts.tooltip}
                sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    height: 22,
                    px: '7px',
                    fontSize: textVar.xs,
                    fontWeight: opts.active ? 500 : 400,
                    lineHeight: 1.4,
                    color: accent,
                    fontFamily: theme.typography.fontFamily,
                    borderRadius: '6px',
                    border: `1px solid ${alpha(accent, opts.active ? 0.5 : 0.2)}`,
                    borderStyle: opts.stale ? 'dashed' : 'solid',
                    backgroundColor: opts.active ? alpha(accent, 0.08) : theme.palette.background.paper,
                    cursor: 'pointer',
                    opacity: opts.stale ? 0.65 : 1,
                    transition: transition.fast,
                    '&:hover': {
                        backgroundColor: alpha(accent, opts.active ? 0.12 : 0.04),
                    },
                }}
            >
                {opts.refreshing && (
                    <CircularProgress size={10} sx={{ color: alpha(accent, 0.5), mr: '-1px' }} />
                )}
                <span>{label}</span>
                {opts.onDelete && (
                    <Box
                        component="span"
                        role="button"
                        aria-label="delete variant"
                        onClick={(e) => { e.stopPropagation(); opts.onDelete?.(); }}
                        sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            color: alpha(accent, 0.4),
                            cursor: 'pointer',
                            '&:hover': {
                                color: accent,
                                backgroundColor: alpha(accent, 0.08),
                            },
                        }}
                    >
                        <CloseIcon sx={{ fontSize: textVar.xs }} />
                    </Box>
                )}
            </Box>
        );
    };

    return (
        <Box key='variant-chip-strip' sx={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-start', gap: 0.5,
            px: 1,
            // Rendered inside the floating top toolbar (see VisualizationView
            // vis-view-canvas), directly after the zoom resizer. A leading
            // divider separates the two groups; a min height keeps the row
            // vertically centered with the resizer controls.
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
                onClose={() => {
                    endThemePreview();
                    setThemeAnchor(null);
                }}
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
                {THEME_CHOICES.map(choice => (
                    <MenuItem
                        key={choice.id ?? 'default'}
                        selected={chart.themeId === choice.id}
                        title={choice.description}
                        onMouseEnter={() => scheduleThemePreview(choice.id)}
                        onClick={() => {
                            endThemePreview();
                            dispatch(dfActions.setChartTheme({ chartId, themeId: choice.id }));
                            setThemeAnchor(null);
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
                        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {choice.label}
                        </Box>
                    </MenuItem>
                ))}
            </Menu>
            {variants.length > 0 && (
                <Typography sx={{ fontSize: textVar.xs, color: 'text.disabled', ml: 0.5 }}>
                    custom:
                </Typography>
            )}
            {variants.map(v => {
                const stale = isVariantStale(chart, v);
                const refreshing = refreshingVariantId === v.id;
                return renderVariantChip(v.label || v.id, {
                    active: v.id === activeVariantId,
                    stale,
                    refreshing,
                    tooltip: stale
                        ? `Encoding has changed since this variant was created. Clicking will re-run the style agent against the current encoding.\n\nPrompt: ${v.prompt}`
                        : (v.rationale ? `${v.rationale}\n\nPrompt: ${v.prompt}` : `Prompt: ${v.prompt}`),
                    onClick: () => {
                        if (v.id !== activeVariantId) {
                            dispatch(dfActions.setActiveVariant({ chartId, variantId: v.id }));
                        }
                        if (stale && !refreshing) {
                            handleRefreshVariant(v);
                        }
                    },
                    onDelete: () => dispatch(dfActions.deleteStyleVariant({ chartId, variantId: v.id })),
                });
            })}
            {isRestyling && (
                <Box
                    component="span"
                    title={pendingPrompt ? `Restyling: ${pendingPrompt}` : 'Restyling…'}
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        height: 20,
                        px: '6px',
                        maxWidth: 160,
                        fontSize: textVar.xs,
                        fontFamily: theme.typography.fontFamily,
                        color: 'text.secondary',
                        borderRadius: '6px',
                        border: `1px dashed ${alpha(theme.palette.text.primary, 0.2)}`,
                        backgroundColor: alpha(theme.palette.text.primary, 0.03),
                    }}
                >
                    <CircularProgress size={10} sx={{ color: alpha(theme.palette.text.primary, 0.4) }} />
                    <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Restyling
                    </Box>
                </Box>
            )}
            <Tooltip title="Restyle chart…">
                <IconButton
                    color="primary"
                    size="small"
                    onClick={(e: React.MouseEvent<HTMLElement>) => setRestyleAnchor(e.currentTarget)}
                    sx={{
                        ml: 0.25,
                        backgroundColor: restyleAnchor ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                    }}
                >
                    <PaletteOutlinedIcon fontSize="small" />
                </IconButton>
            </Tooltip>
            <Popover
                open={Boolean(restyleAnchor)}
                anchorEl={restyleAnchor}
                onClose={() => setRestyleAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                slotProps={{ paper: { sx: { width: 340, p: 2, borderRadius: 2 } } }}
            >
                <Typography sx={{ fontSize: textVar.xs, fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5, mb: 1.25 }}>
                    Annotate
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', rowGap: 0.5, columnGap: 0.5, mb: 1.5 }}>
                        {ANNOTATE_ACTIONS.map(action => (
                            <Tooltip key={action.key} title={action.description}>
                                <Box
                                    component="span"
                                    onClick={() => { if (!isRestyling) handleRestyleSubmit(action.instruction); }}
                                    sx={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        height: 20,
                                        px: '8px',
                                        fontSize: textVar.xs,
                                        fontFamily: theme.typography.fontFamily,
                                        color: 'text.primary',
                                        borderRadius: '6px',
                                        border: `1px solid ${alpha(theme.palette.text.primary, 0.15)}`,
                                        cursor: isRestyling ? 'default' : 'pointer',
                                        opacity: isRestyling ? 0.5 : 1,
                                        transition: transition.fast,
                                        '&:hover': {
                                            backgroundColor: alpha(theme.palette.primary.main, 0.06),
                                            borderColor: alpha(theme.palette.primary.main, 0.4),
                                        },
                                    }}
                                >
                                    {action.label}
                                </Box>
                            </Tooltip>
                        ))}
                </Box>
                <Divider sx={{ my: 1.5 }} />
                <Typography sx={{ fontSize: textVar.xs, fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5, mb: 1 }}>
                    Design yourself
                </Typography>
                <Card
                    variant='outlined'
                    sx={{
                        position: 'relative',
                        display: 'flex', flexDirection: 'column',
                        px: 1, pt: 0.5, pb: 0.25,
                        borderWidth: 1,
                        borderColor: alpha(theme.palette.text.primary, 0.2),
                        borderRadius: '8px',
                        overflow: 'visible',
                        transition: transition.fast,
                        '&:hover': {
                            borderColor: alpha(theme.palette.primary.main, 0.6),
                        },
                        '&:focus-within': {
                            borderColor: alpha(theme.palette.primary.main, 0.8),
                        },
                    }}
                >
                    <TextField
                        variant="standard"
                        autoFocus
                        sx={{
                            flex: 1,
                            "& .MuiInput-input": { fontSize: textVar.sm, lineHeight: 1.5 },
                            "& .MuiInput-underline:before": { borderBottom: 'none' },
                            "& .MuiInput-underline:hover:not(.Mui-disabled):before": { borderBottom: 'none' },
                            "& .MuiInput-underline:after": { borderBottom: 'none' },
                        }}
                        placeholder="Describe a style, e.g. “use a muted pastel palette”"
                        value={restylePrompt}
                        disabled={isRestyling}
                        onChange={(e) => setRestylePrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleRestyleSubmit(restylePrompt);
                            }
                        }}
                        slotProps={{ inputLabel: { shrink: true } }}
                        fullWidth
                        multiline
                        minRows={2}
                        maxRows={5}
                    />
                    <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
                        <Tooltip title="Restyle">
                            <span>
                                <IconButton
                                    size="small"
                                    color="primary"
                                    sx={{ p: 0.5 }}
                                    aria-label="Restyle"
                                    disabled={isRestyling || !restylePrompt.trim()}
                                    onClick={() => handleRestyleSubmit(restylePrompt)}
                                >
                                    {isRestyling
                                        ? <CircularProgress size={18} sx={{ color: theme.palette.primary.main }} />
                                        : <SendIcon sx={{ fontSize: iconVar.lg }} />}
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                </Card>
            </Popover>
        </Box>
    );
};
