// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Compact, horizontal chart-config bar surfaced directly below the chart for
// quick edits (toggles, sliders, discrete option selects). It mirrors the
// template-driven config properties from the encoding shelf but in a single
// wrapping row so users can tweak the chart without opening the full encoding
// popover. See VisualizationView for placement.

import { FC } from 'react';
import React from 'react';
import { useSelector, useDispatch } from 'react-redux';

import { Box, Typography, Select, MenuItem, useTheme } from '@mui/material';

import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { Channel, Chart, VariantConfigControl } from '../components/ComponentType';
import { getChartTemplate } from '../components/ChartTemplates';
import { ConfigSlider } from './EncodingShelfCard';

export interface ChartQuickConfigProps {
    chartId: string;
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
};

export const ChartQuickConfig: FC<ChartQuickConfigProps> = function ({ chartId }) {
    const theme = useTheme();
    const dispatch = useDispatch<AppDispatch>();
    const allCharts = useSelector(dfSelectors.getAllCharts);
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
        if (!configUI || configUI.length === 0) return null;
        controls = configUI.map((c: VariantConfigControl) => ({
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
        const configProps = template?.properties;
        if (!configProps || configProps.length === 0) return null;

        // Filter to visible properties (respecting visibleWhen channel predicates).
        const visibleProps = configProps.filter((propDef) => {
            if (propDef.visibleWhen?.channels) {
                return propDef.visibleWhen.channels.some(
                    ch => chart.encodingMap[ch as Channel]?.fieldID != null
                );
            }
            return true;
        });
        if (visibleProps.length === 0) return null;
        controls = visibleProps as QuickControl[];
        getValue = (control) => chart.config?.[control.key] ?? control.defaultValue;
        commit = (control, value) => dispatch(dfActions.updateChartConfig({ chartId, key: control.key, value }));
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
                            disableUnderline
                            sx={{
                                fontSize: 11, height: '22px', minWidth: 60,
                                backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: '6px',
                                '&:hover': { backgroundColor: 'rgba(0,0,0,0.08)' },
                                '& .MuiSelect-select': { padding: '1px 20px 1px 6px !important', fontSize: 11 },
                                '& .MuiSvgIcon-root': { fontSize: 14, right: 2 },
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
        </Box>
        </Box>
    );
};
