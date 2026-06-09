// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Compact, horizontal chart-config bar surfaced directly below the chart for
// quick edits (toggles, sliders, discrete option selects). It mirrors the
// template-driven config properties from the encoding shelf but in a single
// wrapping row so users can tweak the chart without opening the full encoding
// popover. See VisualizationView for placement.

import { FC } from 'react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import { Box, Typography, Select, MenuItem, useTheme, Tooltip, IconButton, Divider } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { Chart, FieldItem, VariantConfigControl } from '../components/ComponentType';
import { getChartTemplate } from '../components/ChartTemplates';
import { ChartEncoding, ChartOption, EncodingActionDef } from '../lib/agents-chart';
import { ConfigSlider } from './EncodingShelfCard';

export interface ChartQuickConfigProps {
    chartId: string;
    /**
     * Working-table metadata (`{ [fieldName]: { type, semanticType, ... } }`).
     * Used to resolve a field's concrete encoding type when the encoding's own
     * `dtype` is left on "auto" — so type-aware action applicability (e.g. Sort
     * needing a discrete category axis) matches what the compiler renders.
     */
    tableMetadata?: Record<string, { type?: string; semanticType?: string }>;
    /**
     * Flint's annotated option catalog for the current render (the spec's
     * `_options`). Each entry carries `applicable` (whether the option passed its
     * precondition for this spec + data) and `value` (the value the compiler will
     * use — host choice if set, else the engine's recommended default). The bar
     * renders a control for every applicable option, seeded from `value`. When
     * absent (spec not yet rendered) no chart-property controls are shown.
     */
    options?: ChartOption[];
    /**
     * When true, the built-in delete-chart action is rendered disabled (e.g.
     * while a synthesis/transform is in flight for this chart).
     */
    deleteDisabled?: boolean;
}

/**
 * Map a working-table column `Type` to the 4-way ChartEncoding type the
 * encoding-action applicability checks reason about. The table metadata `type`
 * is already concretely inferred (not "auto") for loaded tables, so this is a
 * reliable fallback when an encoding leaves its own `dtype` unset.
 */
function tableTypeToEncodingType(t?: string): ChartEncoding['type'] | undefined {
    switch (t) {
        case 'number':
        case 'integer':
        case 'duration':
            return 'quantitative';
        case 'date':
        case 'datetime':
        case 'time':
            return 'temporal';
        case 'string':
        case 'boolean':
            return 'nominal';
        default:
            return undefined;
    }
}

/**
 * Build a ChartEncoding-shaped view of a chart's encoding map so encoding
 * actions can derive their state and produce a new map against the same model
 * the encoding shelf uses (single source of truth). Field identity is exposed
 * as the field *name* (per ChartEncoding's contract); the reducer translates
 * names back to fieldIDs when applying the result.
 *
 * When an encoding's own `dtype` is unset ("auto"), the type is resolved from
 * the working-table metadata so downstream type-aware checks (e.g. Sort) see
 * the same concrete type the compiler will use.
 */
function buildEncodings(
    chart: Chart,
    conceptShelfItems: FieldItem[],
    tableMetadata?: Record<string, { type?: string; semanticType?: string }>,
): Record<string, ChartEncoding> {
    const out: Record<string, ChartEncoding> = {};
    for (const [channel, item] of Object.entries(chart.encodingMap)) {
        const field = item.fieldID ? conceptShelfItems.find(f => f.id === item.fieldID) : undefined;
        const resolvedType = item.dtype
            ?? (field?.name ? tableTypeToEncodingType(tableMetadata?.[field.name]?.type) : undefined);
        out[channel] = {
            field: field?.name,
            type: resolvedType,
            aggregate: item.aggregate,
            sortOrder: item.sortOrder,
            sortBy: item.sortBy,
            scheme: item.scheme,
        };
    }
    return out;
}

/**
 * Normalized control shape that both chart-template properties (ChartPropertyDef)
 * and variant generative-UI controls (VariantConfigControl) map onto, so the
 * same renderers handle either source.
 */
type QuickControl = {
    key: string;
    label: string;
    type: 'continuous' | 'binary' | 'discrete';
    min?: number;
    max?: number;
    step?: number;
    options?: { value: any; label: string }[];
    defaultValue?: any;
    /** Resolved value from Flint (host choice if set, else recommended default). */
    value?: any;
    /** Present when this control is a Category-B encoding action (commits to encodings). */
    encodingAction?: EncodingActionDef;
};

export const ChartQuickConfig: FC<ChartQuickConfigProps> = function ({ chartId, tableMetadata, options, deleteDisabled }) {
    const { t } = useTranslation('chart');
    const theme = useTheme();
    const dispatch = useDispatch<AppDispatch>();
    const allCharts = useSelector(dfSelectors.getAllCharts);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const chart = allCharts.find((c: Chart) => c.id == chartId) as Chart | undefined;

    if (!chart) return null;

    // When a style variant is active, the chart-template config no longer maps
    // to what's rendered (variants are agent-authored specs that bypass the
    // compiler). Show the variant's own generative-UI controls instead — or
    // nothing if the variant didn't ship any.
    const activeVariant = chart.activeVariantId
        ? chart.styleVariants?.find(v => v.id === chart.activeVariantId)
        : undefined;

    let controls: QuickControl[];
    let getValue: (control: QuickControl) => any;
    let commit: (control: QuickControl, value: any) => void;

    if (activeVariant) {
        const configUI = activeVariant.configUI;
        controls = (configUI ?? []).map((c: VariantConfigControl) => ({
            key: c.key,
            label: c.label,
            type: c.type,
            min: c.type === 'continuous' ? c.min : undefined,
            max: c.type === 'continuous' ? c.max : undefined,
            step: c.type === 'continuous' ? c.step : undefined,
            options: c.type === 'discrete' ? c.options : undefined,
            defaultValue: c.defaultValue,
        }));
        getValue = (control) => {
            const cv = activeVariant.configValues;
            return cv && control.key in cv ? cv[control.key] : control.defaultValue;
        };
        commit = (control, value) => dispatch(dfActions.updateVariantConfigValue({
            chartId, variantId: activeVariant.id, key: control.key, value,
        }));
    } else {
        const template = getChartTemplate(chart.chartType);
        const encodingActions = template?.encodingActions ?? [];

        // Encoding view used both for type-aware applicability checks and for
        // deriving an action's displayed value from the base encoding.
        const encodingsView = buildEncodings(chart, conceptShelfItems, tableMetadata);

        // Category-A controls: chart-native config (chart.config). Flint already
        // evaluated each property's applicability (structural channel-assignment
        // and data-aware preconditions like log-scale eligibility) and resolved
        // its value, so the host just renders the applicable ones seeded from
        // `value`. See ChartOption / getChartOptions.
        const propControls: QuickControl[] = (options ?? [])
            .filter(opt => opt.applicable)
            .map(opt => ({
                key: opt.key,
                label: opt.label,
                type: opt.type,
                min: opt.type === 'continuous' ? opt.min : undefined,
                max: opt.type === 'continuous' ? opt.max : undefined,
                step: opt.type === 'continuous' ? opt.step : undefined,
                options: opt.type === 'discrete' ? opt.options : undefined,
                defaultValue: opt.defaultValue,
                value: opt.value,
            }));

        // Category-B controls: encoding actions. The chosen value is stored as
        // a config override (chart.config[key]) and composed onto the encoding
        // by the compiler at assemble time — not written into the encoding map.
        // A single `isApplicable` predicate gates visibility: it inspects the
        // base encodings, so it covers both channel assignment (is a channel
        // bound?) and type fit (e.g. Sort needs a discrete category axis).
        const actionControls: QuickControl[] = encodingActions
            .filter(action => !action.isApplicable || action.isApplicable({ encodings: encodingsView }))
            .map(action => ({
                key: action.key,
                label: action.label,
                type: action.control.type,
                min: action.control.type === 'continuous' ? action.control.min : undefined,
                max: action.control.type === 'continuous' ? action.control.max : undefined,
                step: action.control.type === 'continuous' ? action.control.step : undefined,
                options: action.control.type === 'discrete' ? action.control.options : undefined,
                encodingAction: action,
            }));

        controls = [...propControls, ...actionControls];
        // Encoding-action value is a configuration *override* stored in
        // chart.config (keyed by the action key), exactly like a chart property.
        // It is NOT written into the encoding map — Flint composes the override
        // onto the encodings at assemble time (applyEncodingOverrides). When no
        // override is set, fall back to the value derived from the base encoding.
        // For chart properties, `control.value` is Flint's resolved value (host
        // choice if set, else the engine's recommended default) so an "auto"
        // recommendation is reflected without re-deriving it here.
        getValue = (control) => control.encodingAction
            ? (chart.config?.[control.key] ?? control.encodingAction.get(encodingsView))
            : chart.config?.[control.key] ?? control.value ?? control.defaultValue;
        commit = (control, value) => {
            // Both categories commit the same way: a value in chart.config.
            // Category A tweaks the assembled spec; Category B is composed onto
            // the encodings by the compiler. The host stays out of the transform.
            dispatch(dfActions.updateChartConfig({ chartId, key: control.key, value }));
        };
    }

    return (
        <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%', pt: 2, pb: 1 }}>
        <Box sx={{
            display: 'inline-flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px 18px',
            px: 1.5,
            py: 0.5,
            maxWidth: 900,
            borderRadius: '8px',
            backgroundColor: 'rgba(0,0,0,0.025)',
        }}>
            {controls.map((propDef) => {
                if (propDef.type === 'continuous') {
                    const currentValue = getValue(propDef) ?? propDef.min ?? 0;
                    return (
                        <Box key={`qc-${propDef.key}`} sx={{ display: 'flex', alignItems: 'center', minWidth: 150 }}>
                            <Typography variant="caption" sx={{ pr: 0.75, color: 'text.secondary', fontSize: 10, whiteSpace: 'nowrap', fontWeight: 500, userSelect: 'none' }}>
                                {propDef.label}
                            </Typography>
                            <ConfigSlider
                                value={currentValue}
                                propDef={propDef}
                                onCommit={(newValue) => commit(propDef, newValue)}
                            />
                        </Box>
                    );
                }
                if (propDef.type === 'binary') {
                    const currentValue = getValue(propDef) ?? false;
                    return (
                        <Box key={`qc-${propDef.key}`} sx={{
                            display: 'flex', alignItems: 'center', minHeight: '22px',
                            cursor: 'pointer',
                        }}
                            onClick={() => commit(propDef, !currentValue)}>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, whiteSpace: 'nowrap', fontWeight: 500, userSelect: 'none', mr: 0.75 }}>
                                {propDef.label}
                            </Typography>
                            <Box sx={{
                                width: 28, height: 14, borderRadius: '7px',
                                backgroundColor: currentValue ? theme.palette.primary.main : 'rgba(0,0,0,0.2)',
                                position: 'relative', transition: 'background-color 0.2s', flexShrink: 0,
                            }}>
                                <Box sx={{
                                    width: 10, height: 10, borderRadius: '50%', backgroundColor: 'white',
                                    position: 'absolute', top: 2, left: currentValue ? 16 : 2, transition: 'left 0.2s',
                                }} />
                            </Box>
                        </Box>
                    );
                }
                if (propDef.type !== 'discrete' || !propDef.options) return null;
                const currentValue = getValue(propDef);
                const options = propDef.options;
                const currentSerialized = JSON.stringify(currentValue);
                let selectedIndex = options.findIndex(o => JSON.stringify(o.value) === currentSerialized);
                if (selectedIndex < 0) selectedIndex = 0;
                return (
                    <Box key={`qc-${propDef.key}`} sx={{ display: 'flex', alignItems: 'center', minHeight: '22px' }}>
                        <Typography variant="caption" sx={{ pr: 0.75, color: 'text.secondary', fontSize: 10, whiteSpace: 'nowrap', fontWeight: 500, userSelect: 'none' }}>
                            {propDef.label}
                        </Typography>
                        <Select
                            variant="standard"
                            id={`qc-${propDef.key}-select`}
                            value={selectedIndex}
                            onChange={(event) => {
                                const idx = event.target.value as number;
                                commit(propDef, options[idx].value);
                            }}
                            sx={{
                                fontSize: 11, height: '22px', minWidth: 60,
                                color: 'text.secondary',
                                '&:before': { borderBottomColor: 'rgba(0,0,0,0.2)' },
                                '&:hover:not(.Mui-disabled):before': { borderBottomColor: 'rgba(0,0,0,0.42)' },
                                '&:after': { borderBottomColor: 'rgba(0,0,0,0.42)' },
                                '& .MuiSelect-select': { padding: '1px 18px 1px 2px !important', fontSize: 11 },
                                '& .MuiSvgIcon-root': { fontSize: 14, right: 0, color: 'rgba(0,0,0,0.4)' },
                            }}
                            renderValue={(idx: number) => <span style={{ fontSize: 11 }}>{options[idx]?.label || 'Default'}</span>}
                        >
                            {options.map((opt, i) => (
                                <MenuItem value={i} key={`qc-${propDef.key}-${i}`} sx={{ fontSize: 11, minHeight: '28px' }}>
                                    {opt.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </Box>
                );
            })}
            {/* Built-in chart-level action: delete this chart. Lives in the
                property-config bar so the chart's controls and its delete sit
                together; a hairline divider sets it apart from the property
                controls. Only shown when there are controls to set it apart
                from — otherwise it stands alone in the bar. */}
            <Tooltip title={t('deleteChart')}>
                <span>
                    <IconButton
                        size="small"
                        disabled={deleteDisabled}
                        onClick={() => dispatch(dfActions.deleteChartById(chartId))}
                        sx={{ color: 'text.disabled','&:hover': { color: 'error.main', backgroundColor: 'rgba(211, 47, 47, 0.08)' } }}
                    >
                        <DeleteIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                </span>
            </Tooltip>
        </Box>
        </Box>
    );
};
