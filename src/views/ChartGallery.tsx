// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ChartGallery — Visual gallery for Vega-Lite chart assembly.
 *
 * All synthetic test-data generators and types live in
 * `src/lib/agents-chart/test-data/`. This file contains only the
 * React components that render the gallery UI.
 */

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
    Box, Tabs, Tab, Typography, Paper, Chip, Button,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import embed from 'vega-embed';
import * as echarts from 'echarts';
import { Chart, registerables } from 'chart.js';
import { assembleVegaChart } from '../app/utils';
import { Channel, EncodingItem } from '../components/ComponentType';
import { channels } from '../components/ChartTemplates';
import { ChartWarning, ChartEncoding, ChartAssemblyInput, assembleVegaLite, assembleECharts, assembleChartjs, assembleGoFish, GoFishSpec } from '../lib/agents-chart';
import { TestCase, TEST_GENERATORS, GALLERY_SECTIONS } from '../lib/agents-chart/test-data';
import { useTranslation } from 'react-i18next';

const GALLERY_SECTION_LABEL_KEYS: Record<string, string> = {
    'Semantic Context': 'chart.gallery.sectionLabels.semanticContext',
    'Debug Cases': 'chart.gallery.sectionLabels.debugCases',
    VegaLite: 'chart.gallery.sectionLabels.vegaLite',
    Facets: 'chart.gallery.sectionLabels.facets',
    'Stress Tests': 'chart.gallery.sectionLabels.stressTests',
    'ECharts Backend': 'chart.gallery.sectionLabels.echartsBackend',
    'Chart.js Backend': 'chart.gallery.sectionLabels.chartJsBackend',
    'GoFish Basic': 'chart.gallery.sectionLabels.goFishBasic',
};

const GALLERY_SECTION_DESCRIPTION_KEYS: Record<string, string> = {
    'Demonstrates how semantic type annotations improve chart output: formatting, domain constraints, axis reversal, scale type, and interpolation': 'chart.gallery.sectionDescriptions.semanticContext',
    'Regression tests from evaluation failures: log+bin+zeros, temporal+bin, single-point line': 'chart.gallery.sectionDescriptions.debugCases',
    'Demos for every supported chart type': 'chart.gallery.sectionDescriptions.vegaLite',
    'Faceting modes and feature combinations': 'chart.gallery.sectionDescriptions.facets',
    'Overflow, elasticity, and temporal format stress tests': 'chart.gallery.sectionDescriptions.stressTests',
    'Same inputs through ECharts backend — compare series-based output vs VL encoding-based output': 'chart.gallery.sectionDescriptions.echartsBackend',
    'Same inputs through Chart.js backend — compare dataset-based output vs VL/EC output': 'chart.gallery.sectionDescriptions.chartJsBackend',
    'All GoFish chart examples on one page': 'chart.gallery.sectionDescriptions.goFishBasic',
};

const GALLERY_ENTRY_LABEL_KEYS: Record<string, string> = {
    'Semantic Context': 'chart.gallery.entryLabels.semanticContext',
    'Snap-to-Bound': 'chart.gallery.entryLabels.snapToBound',
    'Debug Cases': 'chart.gallery.entryLabels.debugCases',
    'Scatter Plot': 'chart.gallery.entryLabels.scatterPlot',
    Regression: 'chart.gallery.entryLabels.regression',
    'Bar Chart': 'chart.gallery.entryLabels.barChart',
    'Stacked Bar Chart': 'chart.gallery.entryLabels.stackedBarChart',
    'Grouped Bar Chart': 'chart.gallery.entryLabels.groupedBarChart',
    Histogram: 'chart.gallery.entryLabels.histogram',
    Heatmap: 'chart.gallery.entryLabels.heatmap',
    'Line Chart': 'chart.gallery.entryLabels.lineChart',
    'Dotted Line Chart': 'chart.gallery.entryLabels.dottedLineChart',
    Boxplot: 'chart.gallery.entryLabels.boxplot',
    'Pie Chart': 'chart.gallery.entryLabels.pieChart',
    'Ranged Dot Plot': 'chart.gallery.entryLabels.rangedDotPlot',
    'Area Chart': 'chart.gallery.entryLabels.areaChart',
    Streamgraph: 'chart.gallery.entryLabels.streamgraph',
    'Lollipop Chart': 'chart.gallery.entryLabels.lollipopChart',
    'Density Plot': 'chart.gallery.entryLabels.densityPlot',
    'Bump Chart': 'chart.gallery.entryLabels.bumpChart',
    'Candlestick Chart': 'chart.gallery.entryLabels.candlestickChart',
    'Waterfall Chart': 'chart.gallery.entryLabels.waterfallChart',
    'Strip Plot': 'chart.gallery.entryLabels.stripPlot',
    'Radar Chart': 'chart.gallery.entryLabels.radarChart',
    'Pyramid Chart': 'chart.gallery.entryLabels.pyramidChart',
    'Rose Chart': 'chart.gallery.entryLabels.roseChart',
    'Custom Charts': 'chart.gallery.entryLabels.customCharts',
    'Facet: Columns': 'chart.gallery.entryLabels.facetColumns',
    'Facet: Rows': 'chart.gallery.entryLabels.facetRows',
    'Facet: Cols+Rows': 'chart.gallery.entryLabels.facetColsRows',
    'Facet: Small': 'chart.gallery.entryLabels.facetSmall',
    'Facet: Wrap': 'chart.gallery.entryLabels.facetWrap',
    'Facet: Clip': 'chart.gallery.entryLabels.facetClip',
    'Facet: Overflowed Col': 'chart.gallery.entryLabels.facetOverflowedCol',
    'Facet: Overflowed Col+Row': 'chart.gallery.entryLabels.facetOverflowedColRow',
    'Facet: Overflowed Row': 'chart.gallery.entryLabels.facetOverflowedRow',
    'Facet: Dense Line': 'chart.gallery.entryLabels.facetDenseLine',
    Overflow: 'chart.gallery.entryLabels.overflow',
    'Elasticity & Stretch': 'chart.gallery.entryLabels.elasticityStretch',
    'Discrete Axis Sizing': 'chart.gallery.entryLabels.discreteAxisSizing',
    'Gas Pressure (§2)': 'chart.gallery.entryLabels.gasPressure',
    'Line/Area Stretch': 'chart.gallery.entryLabels.lineAreaStretch',
    'Dates: Year': 'chart.gallery.entryLabels.datesYear',
    'Dates: Month': 'chart.gallery.entryLabels.datesMonth',
    'Dates: Year-Month': 'chart.gallery.entryLabels.datesYearMonth',
    'Dates: Decade': 'chart.gallery.entryLabels.datesDecade',
    'Dates: Date/DateTime': 'chart.gallery.entryLabels.datesDateTime',
    'Dates: Hours': 'chart.gallery.entryLabels.datesHours',
    'ECharts: Facet Small': 'chart.gallery.entryLabels.echartsFacetSmall',
    'ECharts: Facet Wrap': 'chart.gallery.entryLabels.echartsFacetWrap',
    'ECharts: Facet Clip': 'chart.gallery.entryLabels.echartsFacetClip',
    'ECharts: Gauge': 'chart.gallery.entryLabels.echartsGauge',
    'ECharts: Funnel': 'chart.gallery.entryLabels.echartsFunnel',
    'ECharts: Treemap': 'chart.gallery.entryLabels.echartsTreemap',
    'ECharts: Sunburst': 'chart.gallery.entryLabels.echartsSunburst',
    'ECharts: Sankey': 'chart.gallery.entryLabels.echartsSankey',
    'ECharts: Unique Stress': 'chart.gallery.entryLabels.echartsUniqueStress',
    'ECharts: Stress Tests': 'chart.gallery.entryLabels.echartsStressTests',
    'Chart.js: Scatter': 'chart.gallery.entryLabels.chartJsScatter',
    'Chart.js: Line': 'chart.gallery.entryLabels.chartJsLine',
    'Chart.js: Bar': 'chart.gallery.entryLabels.chartJsBar',
    'Chart.js: Stacked Bar': 'chart.gallery.entryLabels.chartJsStackedBar',
    'Chart.js: Grouped Bar': 'chart.gallery.entryLabels.chartJsGroupedBar',
    'Chart.js: Area': 'chart.gallery.entryLabels.chartJsArea',
    'Chart.js: Pie': 'chart.gallery.entryLabels.chartJsPie',
    'Chart.js: Histogram': 'chart.gallery.entryLabels.chartJsHistogram',
    'Chart.js: Radar': 'chart.gallery.entryLabels.chartJsRadar',
    'Chart.js: Rose': 'chart.gallery.entryLabels.chartJsRose',
    'Chart.js: Stress Tests': 'chart.gallery.entryLabels.chartJsStressTests',
    'GoFish Basic': 'chart.gallery.entryLabels.goFishBasic',
};

const translateGalleryLabel = (t: (key: string) => string, label: string) =>
    GALLERY_ENTRY_LABEL_KEYS[label] ? t(GALLERY_ENTRY_LABEL_KEYS[label]) : label;

const translateGallerySectionLabel = (t: (key: string) => string, label: string) =>
    GALLERY_SECTION_LABEL_KEYS[label] ? t(GALLERY_SECTION_LABEL_KEYS[label]) : label;

const translateGallerySectionDescription = (t: (key: string) => string, description: string) =>
    GALLERY_SECTION_DESCRIPTION_KEYS[description] ? t(GALLERY_SECTION_DESCRIPTION_KEYS[description]) : description;

// Register all Chart.js components
Chart.register(...registerables);

// ============================================================================
// Chart Rendering Component
// ============================================================================

const VegaChart: React.FC<{ testCase: TestCase }> = React.memo(({ testCase }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [specJson, setSpecJson] = useState<string>('');
    const [warnings, setWarnings] = useState<ChartWarning[]>([]);
    const [specOptions, setSpecOptions] = useState<string>('');
    const [inferredSize, setInferredSize] = useState<string>('');
    const { t } = useTranslation();

    useEffect(() => {
        if (!containerRef.current) return;

        try {
            // Build encoding map with all channels defaulting to empty
            const fullEncodingMap: Record<string, EncodingItem> = {};
            for (const ch of channels) {
                fullEncodingMap[ch as string] = testCase.encodingMap[ch as Channel] || {};
            }

            const vlSpec = assembleVegaChart(
                testCase.chartType,
                fullEncodingMap as any,
                testCase.fields,
                testCase.data,
                testCase.metadata,
                400,   // baseChartWidth
                300,   // baseChartHeight
                true,  // addTooltips
                testCase.chartProperties,
                1,     // scaleFactor
                testCase.assembleOptions?.maxStretch,
                testCase.assembleOptions,
                testCase.semanticAnnotations,
            );

            if (!vlSpec) {
                setError(t('chart.gallery.noSpec', { assembler: 'assembleVegaChart' }));
                return;
            }

            // Extract warnings
            const specAny = vlSpec as any;
            setWarnings(specAny._warnings || []);
            setInferredSize(`${specAny._width ?? '?'} × ${specAny._height ?? '?'}`);

            // Build the exact input sent to assembleVegaLite()
            const encodings: Record<string, any> = {};
            for (const [ch, ei] of Object.entries(testCase.encodingMap)) {
                if (ei && ei.fieldID) {
                    const entry: Record<string, any> = { field: ei.fieldID };
                    if (ei.dtype) entry.type = ei.dtype;
                    if (ei.aggregate) entry.aggregate = ei.aggregate;
                    if (ei.sortOrder) entry.sortOrder = ei.sortOrder;
                    if (ei.sortBy) entry.sortBy = ei.sortBy;
                    if (ei.scheme) entry.scheme = ei.scheme;
                    encodings[ch] = entry;
                }
            }

            const semanticTypes: Record<string, string | any> = {};
            for (const [fieldName, meta] of Object.entries(testCase.metadata)) {
                if (meta.semanticType) {
                    semanticTypes[fieldName] = meta.semanticType;
                }
            }
            // Override with enriched annotations when present (e.g., intrinsicDomain, unit)
            if (testCase.semanticAnnotations) {
                for (const [fieldName, annotation] of Object.entries(testCase.semanticAnnotations)) {
                    semanticTypes[fieldName] = annotation;
                }
            }

            const assembleInput: Record<string, any> = {
                data: `[${testCase.data.length} rows]`,
                semantic_types: semanticTypes,
                chart_spec: {
                    chartType: testCase.chartType,
                    encodings,
                    ...(testCase.chartProperties && Object.keys(testCase.chartProperties).length > 0
                        ? { chartProperties: testCase.chartProperties } : {}),
                },
                ...(testCase.assembleOptions && Object.keys(testCase.assembleOptions).length > 0
                    ? { options: testCase.assembleOptions } : {}),
            };

            // Custom serializer: compact each encoding entry to one line
            const compactJson = (obj: any): string => {
                const raw = JSON.stringify(obj, null, 2);
                // Replace multi-line encoding entries with single-line versions
                // Match patterns like:  "x": {\n    "field": ...\n  }
                return raw.replace(
                    /"(\w+)":\s*\{([^{}]+)\}/g,
                    (match, key, body) => {
                        // Only compact if inside encodings (body has "field")
                        if (!body.includes('"field"')) return match;
                        const compact = body.replace(/\s*\n\s*/g, ' ').trim();
                        return `"${key}": { ${compact} }`;
                    }
                );
            };

            setSpecOptions(compactJson(assembleInput));

            setSpecJson(JSON.stringify(vlSpec, null, 2));

            const spec = {
                ...vlSpec as any,
            } as any;
            delete spec._warnings;

            // Don't set explicit width/height — let config.view.step handle
            // discrete axes (step × count) and config.view.continuousWidth/Height
            // handle continuous axes.  Forcing width/height here overrides step sizing.

            embed(containerRef.current, spec, {
                actions: { export: true, source: true, compiled: true, editor: true },
                renderer: 'svg',
            }).catch(err => {
                setError(t('chart.gallery.embedError', { backend: 'Vega', message: err.message }));
            });
        } catch (err: any) {
            setError(t('chart.gallery.assemblyError', { message: err.message }));
        }
    }, [testCase, t]);

    return (
        <Paper
            elevation={1}
            sx={{
                p: 2, mb: 2, width: 'fit-content',
                border: error ? '2px solid #f44336' : '1px solid #e0e0e0',
            }}
        >
            {/* Text block: width:0 + minWidth:100% prevents text from expanding the card beyond the chart width */}
            <Box sx={{ width: 0, minWidth: '100%', overflow: 'hidden' }}>
                <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                    {testCase.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" mb={1} sx={{ wordBreak: 'break-word' }}>
                    {testCase.description}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                    {testCase.tags.map(tag => (
                        <Chip key={tag} label={tag} size="small" variant="outlined"
                            sx={{ fontSize: 10, height: 20 }} />
                    ))}
                </Box>
                {inferredSize && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontSize: 10 }}>
                        {t('chart.gallery.inferredSize', { size: inferredSize })}
                    </Typography>
                )}
            </Box>
            {error ? (
                <Typography color="error" variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>
                    {error}
                </Typography>
            ) : (
                <Box ref={containerRef} sx={{ minHeight: 200 }} />
            )}
            {warnings.length > 0 && (
                <Box sx={{ mt: 1, p: 1, bgcolor: '#fff3e0', borderLeft: '3px solid #ff9800', width: 0, minWidth: '100%' }}>
                    <Typography variant="body2" color="warning.dark" sx={{ fontSize: 11, fontWeight: 600, mb: 0.5 }}>
                        {t('chart.gallery.warningLabel')}
                    </Typography>
                    {warnings.map((w, i) => (
                        <Typography key={i} variant="body2" color="warning.dark" sx={{ fontSize: 11 }}>
                            {w.message}
                        </Typography>
                    ))}
                </Box>
            )}
            {/* Debug copy button — only for debug-tagged tests */}
            {testCase.tags.includes('debug') && (
                <Box sx={{ mt: 1 }}>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ContentCopyIcon sx={{ fontSize: 12 }} />}
                        sx={{ fontSize: 10, textTransform: 'none', py: 0.25, px: 1 }}
                        onClick={() => {
                            const parts: string[] = [];
                            if (specOptions) {
                                parts.push(`${t('chart.gallery.copyMarkdownAgentsInputHeading')}\n${specOptions}`);
                            }
                            if (specJson) {
                                const vlLines = specJson.split('\n').slice(0, 50).join('\n');
                                parts.push(`${t('chart.gallery.copyMarkdownVegaLiteOutputHeading')}\n${vlLines}`);
                            }
                            navigator.clipboard.writeText(parts.join('\n\n'));
                        }}
                    >
                        {t('chart.gallery.copySpecVL')}
                    </Button>
                </Box>
            )}
            {specOptions && (
                <details style={{ marginTop: 8, width: 0, minWidth: '100%', overflow: 'hidden' }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#888' }}>
                        {t('chart.gallery.spec')}
                    </summary>
                    <pre style={{ fontSize: 10, maxHeight: 200, overflow: 'auto', background: '#f0f4ff', padding: 8, borderRadius: 4 }}>
                        {specOptions}
                    </pre>
                </details>
            )}
            {/* {specJson && (
                <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#888' }}>
                        Vega-Lite Spec
                    </summary>
                    <pre style={{ fontSize: 10, maxHeight: 300, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                        {specJson}
                    </pre>
                </details>
            )} */}
        </Paper>
    );
});

// ============================================================================
// ECharts Rendering Component
// ============================================================================

/**
 * Build the shared input spec (same for VL and EC) for display.
 * Returns a JSON-serializable object and a compact string.
 */
function buildSharedInputSpec(testCase: TestCase): { obj: Record<string, unknown>; compact: string } {
    const encodings: Record<string, unknown> = {};
    for (const [ch, ei] of Object.entries(testCase.encodingMap)) {
        if (ei && (ei as any).fieldID) {
            const entry: Record<string, unknown> = { field: (ei as any).fieldID };
            if ((ei as any).dtype) entry.type = (ei as any).dtype;
            if ((ei as any).aggregate) entry.aggregate = (ei as any).aggregate;
            if ((ei as any).sortOrder) entry.sortOrder = (ei as any).sortOrder;
            if ((ei as any).sortBy) entry.sortBy = (ei as any).sortBy;
            if ((ei as any).scheme) entry.scheme = (ei as any).scheme;
            encodings[ch] = entry;
        }
    }
    const semanticTypes: Record<string, string> = {};
    for (const [fieldName, meta] of Object.entries(testCase.metadata)) {
        if (meta.semanticType) semanticTypes[fieldName] = meta.semanticType;
    }
    const obj: Record<string, unknown> = {
        data: `[${testCase.data.length} rows]`,
        semantic_types: semanticTypes,
        chart_spec: {
            chartType: testCase.chartType,
            encodings,
            ...(testCase.chartProperties && Object.keys(testCase.chartProperties).length > 0
                ? { chartProperties: testCase.chartProperties } : {}),
        },
        ...(testCase.assembleOptions && Object.keys(testCase.assembleOptions || {}).length > 0
            ? { options: testCase.assembleOptions } : {}),
    };
    const raw = JSON.stringify(obj, null, 2);
    const compact = raw.replace(
        /"(\w+)":\s*\{([^{}]+)\}/g,
        (match, key, body) => {
            if (!body.includes('"field"')) return match;
            const single = body.replace(/\s*\n\s*/g, ' ').trim();
            return `"${key}": { ${single} }`;
        },
    );
    return { obj, compact };
}

/**
 * Convert a TestCase into a ChartAssemblyInput for assembleECharts.
 */
function testCaseToEChartsInput(testCase: TestCase, canvasSize: { width: number; height: number }): ChartAssemblyInput {
    const encodings: Record<string, ChartEncoding> = {};
    for (const [channel, encoding] of Object.entries(testCase.encodingMap)) {
        if (encoding && encoding.fieldID) {
            encodings[channel] = {
                field: encoding.fieldID,
                type: encoding.dtype,
                aggregate: encoding.aggregate,
                sortOrder: encoding.sortOrder,
                sortBy: encoding.sortBy,
                scheme: encoding.scheme,
            };
        }
    }

    const semanticTypes: Record<string, string> = {};
    for (const [fieldName, meta] of Object.entries(testCase.metadata)) {
        if (meta.semanticType) {
            semanticTypes[fieldName] = meta.semanticType;
        }
    }

    return {
        data: { values: testCase.data },
        semantic_types: semanticTypes,
        chart_spec: {
            chartType: testCase.chartType,
            encodings,
            canvasSize,
            chartProperties: testCase.chartProperties,
        },
        options: testCase.assembleOptions,
    };
}

/** Stable default so useEffect dependencies don't change on every render. */
const DEFAULT_CANVAS_SIZE = { width: 300, height: 300 } as const;

const EChartsChart: React.FC<{ testCase: TestCase; canvasSize?: { width: number; height: number } }> = React.memo(({ testCase, canvasSize = DEFAULT_CANVAS_SIZE }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<ChartWarning[]>([]);
    const [specJson, setSpecJson] = useState<string>('');
    const [inputSpec, setInputSpec] = useState<string>('');
    const [inferredSize, setInferredSize] = useState<string>('');
    const { t } = useTranslation();

    useEffect(() => {
        if (!containerRef.current) return;

        try {
            const ecInput = testCaseToEChartsInput(testCase, canvasSize);
            setInputSpec(buildSharedInputSpec(testCase).compact);
            const ecOption = assembleECharts(ecInput);

            if (!ecOption) {
                setError(t('chart.gallery.noOption', { assembler: 'assembleECharts' }));
                return;
            }

            // Extract warnings
            setWarnings(ecOption._warnings || []);
            setInferredSize(`${ecOption._width ?? '?'} × ${ecOption._height ?? '?'}`);

            // Build displayable JSON (strip internal props and data for readability)
            const displayOption = { ...ecOption };
            delete displayOption._warnings;
            delete displayOption._dataLength;
            delete displayOption._width;
            delete displayOption._height;
            delete displayOption._legendWidth;
            setSpecJson(JSON.stringify(displayOption, null, 2));

            // Initialize or reuse ECharts instance
            if (chartRef.current) {
                chartRef.current.dispose();
            }
            const chart = echarts.init(containerRef.current, undefined, {
                width: ecOption._width || 400,
                height: ecOption._height || 300,
            });
            chartRef.current = chart;

            // Clean the option for ECharts (remove internal props)
            const cleanOption = { ...ecOption };
            delete cleanOption._warnings;
            delete cleanOption._dataLength;
            delete cleanOption._width;
            delete cleanOption._height;
            delete cleanOption._legendWidth;

            chart.setOption(cleanOption);
            setError(null);
        } catch (err: any) {
            setError(t('chart.gallery.backendError', { backend: 'ECharts', message: err.message }));
        }

        return () => {
            if (chartRef.current) {
                chartRef.current.dispose();
                chartRef.current = null;
            }
        };
    }, [testCase, canvasSize, t]);

    return (
        <Box sx={{ width: 'fit-content' }}>
            <Typography variant="caption" fontWeight={600} color="#e65100"
                sx={{ display: 'block', mb: 0.5, fontSize: 11, letterSpacing: 0.5 }}>
                {t('chart.gallery.echartsLabel')}
            </Typography>
            {inferredSize && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontSize: 10 }}>
                    {t('chart.gallery.inferredSize', { size: inferredSize })}
                </Typography>
            )}
            {error ? (
                <Typography color="error" variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>
                    {error}
                </Typography>
            ) : (
                <Box ref={containerRef} sx={{ minHeight: 200 }} />
            )}
            {warnings.length > 0 && (
                <Box sx={{ mt: 1, p: 1, bgcolor: '#fff3e0', borderLeft: '3px solid #ff9800' }}>
                    {warnings.map((w, i) => (
                        <Typography key={i} variant="body2" color="warning.dark" sx={{ fontSize: 11 }}>
                            {w.message}
                        </Typography>
                    ))}
                </Box>
            )}
            {inputSpec && (
                <details style={{ marginTop: 8, width: 0, minWidth: '100%', overflow: 'hidden' }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#888' }}>
                        {t('chart.gallery.spec')}
                    </summary>
                    <pre style={{ fontSize: 10, maxHeight: 200, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                        {inputSpec}
                    </pre>
                </details>
            )}
            {specJson && (
                <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#888' }}>
                        {t('chart.gallery.echartsOption')}
                    </summary>
                    <pre style={{ fontSize: 10, maxHeight: 200, overflow: 'auto', background: '#fff3e0', padding: 8, borderRadius: 4 }}>
                        {specJson}
                    </pre>
                </details>
            )}
        </Box>
    );
});

// ============================================================================
// Dual Render: VL + ECharts side-by-side
// ============================================================================

const DualChart: React.FC<{ testCase: TestCase }> = React.memo(({ testCase }) => {
    const sharedSpec = useMemo(() => buildSharedInputSpec(testCase), [testCase]);
    const { t } = useTranslation();
    return (
        <Paper
            elevation={1}
            sx={{
                p: 2, mb: 2, maxWidth: 800,
                border: '1px solid #e0e0e0',
            }}
        >
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                {testCase.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mb={1} sx={{ wordBreak: 'break-word' }}>
                {testCase.description}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                {testCase.tags.map(tag => (
                    <Chip key={tag} label={tag} size="small" variant="outlined"
                        sx={{ fontSize: 10, height: 20 }} />
                ))}
            </Box>
            <details style={{ marginBottom: 12 }}>
                <summary style={{ cursor: 'pointer', fontSize: 11, color: '#666', fontWeight: 600 }}>
                    {t('chart.gallery.spec')}
                </summary>
                <pre style={{ fontSize: 10, maxHeight: 220, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4, marginTop: 4 }}>
                    {sharedSpec.compact}
                </pre>
            </details>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {/* Vega-Lite side */}
                <VegaChartInline testCase={testCase} />
                {/* ECharts side */}
                <EChartsChart testCase={testCase} />
            </Box>
        </Paper>
    );
});

/**
 * Inline VL chart (no Paper wrapper — used inside DualChart).
 */
const VegaChartInline: React.FC<{ testCase: TestCase; canvasSize?: { width: number; height: number } }> = React.memo(({ testCase, canvasSize = DEFAULT_CANVAS_SIZE }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [specJson, setSpecJson] = useState<string>('');
    const [inferredSize, setInferredSize] = useState<string>('');
    const { t } = useTranslation();

    useEffect(() => {
        if (!containerRef.current) return;
        try {
            const fullEncodingMap: Record<string, EncodingItem> = {};
            for (const ch of channels) {
                fullEncodingMap[ch as string] = testCase.encodingMap[ch as Channel] || {};
            }
            const vlSpec = assembleVegaChart(
                testCase.chartType,
                fullEncodingMap as any,
                testCase.fields,
                testCase.data,
                testCase.metadata,
                canvasSize.width, canvasSize.height, true,
                testCase.chartProperties,
                1,
                testCase.assembleOptions?.maxStretch,
                testCase.assembleOptions,
            );
            if (!vlSpec) { setError(t('chart.gallery.noVLSpec')); return; }

            const specAny = vlSpec as any;
            setInferredSize(`${specAny._width ?? '?'} × ${specAny._height ?? '?'}`);

            const displaySpec = { ...specAny };
            delete displaySpec._warnings;
            delete displaySpec._width;
            delete displaySpec._height;
            setSpecJson(JSON.stringify(displaySpec, null, 2));

            const spec = { ...specAny };
            delete spec._warnings;
            delete spec._width;
            delete spec._height;

            embed(containerRef.current, spec, {
                actions: { export: true, source: true, compiled: true, editor: true },
                renderer: 'svg',
            }).catch(err => setError(t('chart.gallery.embedError', { backend: 'VL', message: err.message })));
        } catch (err: any) {
            setError(t('chart.gallery.backendError', { backend: 'VL', message: err.message }));
        }
    }, [testCase, canvasSize, t]);

    return (
        <Box sx={{ width: 'fit-content' }}>
            <Typography variant="caption" fontWeight={600} color="#1565c0"
                sx={{ display: 'block', mb: 0.5, fontSize: 11, letterSpacing: 0.5 }}>
                {t('chart.gallery.vegaLiteLabel')}
            </Typography>
            {inferredSize && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontSize: 10 }}>
                    {t('chart.gallery.inferredSize', { size: inferredSize })}
                </Typography>
            )}
            {error ? (
                <Typography color="error" variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>
                    {error}
                </Typography>
            ) : (
                <Box ref={containerRef} sx={{ minHeight: 200 }} />
            )}
            {specJson && (
                <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#888' }}>
                        {t('chart.gallery.vegaLiteSpec')}
                    </summary>
                    <pre style={{ fontSize: 10, maxHeight: 200, overflow: 'auto', background: '#f0f4ff', padding: 8, borderRadius: 4 }}>
                        {specJson}
                    </pre>
                </details>
            )}
        </Box>
    );
});

// ============================================================================
// Chart.js Rendering Component
// ============================================================================

/**
 * Convert a TestCase into a ChartAssemblyInput for assembleChartjs.
 * (Same conversion as testCaseToEChartsInput — shared data model.)
 */
function testCaseToChartJsInput(testCase: TestCase, canvasSize: { width: number; height: number }): ChartAssemblyInput {
    const encodings: Record<string, ChartEncoding> = {};
    for (const [channel, encoding] of Object.entries(testCase.encodingMap)) {
        if (encoding && encoding.fieldID) {
            encodings[channel] = {
                field: encoding.fieldID,
                type: encoding.dtype,
                aggregate: encoding.aggregate,
                sortOrder: encoding.sortOrder,
                sortBy: encoding.sortBy,
                scheme: encoding.scheme,
            };
        }
    }

    const semanticTypes: Record<string, string> = {};
    for (const [fieldName, meta] of Object.entries(testCase.metadata)) {
        if (meta.semanticType) {
            semanticTypes[fieldName] = meta.semanticType;
        }
    }

    return {
        data: { values: testCase.data },
        semantic_types: semanticTypes,
        chart_spec: {
            chartType: testCase.chartType,
            encodings,
            canvasSize,
            chartProperties: testCase.chartProperties,
        },
        options: testCase.assembleOptions,
    };
}

const ChartJsChart: React.FC<{ testCase: TestCase; canvasSize?: { width: number; height: number } }> = React.memo(({ testCase, canvasSize = DEFAULT_CANVAS_SIZE }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const chartRef = useRef<Chart | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<ChartWarning[]>([]);
    const [specJson, setSpecJson] = useState<string>('');
    const [inferredSize, setInferredSize] = useState<string>('');
    const { t } = useTranslation();

    useEffect(() => {
        if (!canvasRef.current) return;

        try {
            const cjsConfig = assembleChartjs(testCaseToChartJsInput(testCase, canvasSize));

            if (!cjsConfig) {
                setError(t('chart.gallery.noConfig', { assembler: 'assembleChartjs' }));
                return;
            }

            // Extract warnings
            setWarnings(cjsConfig._warnings || []);
            setInferredSize(`${cjsConfig._width ?? '?'} × ${cjsConfig._height ?? '?'}`);

            // Build displayable JSON
            const displayConfig = { ...cjsConfig };
            delete displayConfig._warnings;
            delete displayConfig._dataLength;
            delete displayConfig._width;
            delete displayConfig._height;
            setSpecJson(JSON.stringify(displayConfig, null, 2));

            // Set canvas size directly — responsive mode causes Chart.js to
            // shrink when the flex container can't fit all three backends.
            const w = cjsConfig._width || 400;
            const h = cjsConfig._height || 300;
            canvasRef.current.width = w;
            canvasRef.current.height = h;

            // Destroy previous chart
            if (chartRef.current) {
                chartRef.current.destroy();
                chartRef.current = null;
            }

            // Clean config for Chart.js
            const cleanConfig = { ...cjsConfig };
            delete cleanConfig._warnings;
            delete cleanConfig._dataLength;
            delete cleanConfig._width;
            delete cleanConfig._height;

            // Ensure animation is disabled for gallery rendering
            if (!cleanConfig.options) cleanConfig.options = {};
            cleanConfig.options.animation = false;
            cleanConfig.options.responsive = false;

            chartRef.current = new Chart(canvasRef.current, cleanConfig);
            setError(null);
        } catch (err: any) {
            setError(t('chart.gallery.backendError', { backend: 'Chart.js', message: err.message }));
        }

        return () => {
            if (chartRef.current) {
                chartRef.current.destroy();
                chartRef.current = null;
            }
        };
    }, [testCase, canvasSize, t]);

    return (
        <Box sx={{ width: 'fit-content' }}>
            <Typography variant="caption" fontWeight={600} color="#2e7d32"
                sx={{ display: 'block', mb: 0.5, fontSize: 11, letterSpacing: 0.5 }}>
                {t('chart.gallery.chartJsLabel')}
            </Typography>
            {inferredSize && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontSize: 10 }}>
                    {t('chart.gallery.inferredSize', { size: inferredSize })}
                </Typography>
            )}
            {error ? (
                <Typography color="error" variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>
                    {error}
                </Typography>
            ) : (
                <div style={{ position: 'relative' }}>
                    <canvas ref={canvasRef} />
                </div>
            )}
            {warnings.length > 0 && (
                <Box sx={{ mt: 1, p: 1, bgcolor: '#fff3e0', borderLeft: '3px solid #ff9800' }}>
                    {warnings.map((w, i) => (
                        <Typography key={i} variant="body2" color="warning.dark" sx={{ fontSize: 11 }}>
                            {w.message}
                        </Typography>
                    ))}
                </Box>
            )}
            {specJson && (
                <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#888' }}>
                        {t('chart.gallery.chartJsConfig')}
                    </summary>
                    <pre style={{ fontSize: 10, maxHeight: 200, overflow: 'auto', background: '#e8f5e9', padding: 8, borderRadius: 4 }}>
                        {specJson}
                    </pre>
                </details>
            )}
        </Box>
    );
});

// ============================================================================
// Triple Render: VL + ECharts + Chart.js side-by-side
// ============================================================================

const TripleChart: React.FC<{ testCase: TestCase }> = React.memo(({ testCase }) => {
    return (
        <Paper
            elevation={1}
            sx={{
                p: 2, mb: 2,
                border: '1px solid #e0e0e0',
            }}
        >
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                {testCase.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mb={1} sx={{ wordBreak: 'break-word' }}>
                {testCase.description}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                {testCase.tags.map(tag => (
                    <Chip key={tag} label={tag} size="small" variant="outlined"
                        sx={{ fontSize: 10, height: 20 }} />
                ))}
            </Box>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                <VegaChartInline testCase={testCase} />
                <EChartsChart testCase={testCase} />
                <ChartJsChart testCase={testCase} />
            </Box>
        </Paper>
    );
});

// ============================================================================
// GoFish Rendering Component
// ============================================================================

/**
 * Convert a TestCase into a ChartAssemblyInput for assembleGoFish.
 * (Same conversion as other backends — shared data model.)
 */
function testCaseToGoFishInput(testCase: TestCase, canvasSize: { width: number; height: number }): ChartAssemblyInput {
    const encodings: Record<string, ChartEncoding> = {};
    for (const [channel, encoding] of Object.entries(testCase.encodingMap)) {
        if (encoding && encoding.fieldID) {
            encodings[channel] = {
                field: encoding.fieldID,
                type: encoding.dtype,
                aggregate: encoding.aggregate,
                sortOrder: encoding.sortOrder,
                sortBy: encoding.sortBy,
                scheme: encoding.scheme,
            };
        }
    }

    const semanticTypes: Record<string, string> = {};
    for (const [fieldName, meta] of Object.entries(testCase.metadata)) {
        if (meta.semanticType) {
            semanticTypes[fieldName] = meta.semanticType;
        }
    }

    return {
        data: { values: testCase.data },
        semantic_types: semanticTypes,
        chart_spec: {
            chartType: testCase.chartType,
            encodings,
            canvasSize,
            chartProperties: testCase.chartProperties,
        },
        options: testCase.assembleOptions,
    };
}

const GoFishChart: React.FC<{ testCase: TestCase; canvasSize?: { width: number; height: number } }> = React.memo(({ testCase, canvasSize = DEFAULT_CANVAS_SIZE }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<ChartWarning[]>([]);
    const [specDescription, setSpecDescription] = useState<string>('');
    const [inferredSize, setInferredSize] = useState<string>('');
    const { t } = useTranslation();

    useEffect(() => {
        if (!containerRef.current) return;

        try {
            const gfSpec = assembleGoFish(testCaseToGoFishInput(testCase, canvasSize));

            if (!gfSpec) {
                setError(t('chart.gallery.noSpec', { assembler: 'assembleGoFish' }));
                return;
            }

            // Extract warnings
            setWarnings(gfSpec._warnings || []);
            setInferredSize(`${gfSpec._width ?? '?'} × ${gfSpec._height ?? '?'}`);
            setSpecDescription(gfSpec._specDescription || '');

            // Set container size
            if (containerRef.current) {
                containerRef.current.style.width = `${gfSpec._width || 400}px`;
                containerRef.current.style.height = `${gfSpec._height || 300}px`;
                containerRef.current.innerHTML = '';
            }

            // Render GoFish chart into the container
            gfSpec.render(containerRef.current);
            setError(null);
        } catch (err: any) {
            setError(t('chart.gallery.backendError', { backend: 'GoFish', message: err.message }));
        }
    }, [testCase, canvasSize, t]);

    return (
        <Box sx={{ width: 'fit-content' }}>
            <Typography variant="caption" fontWeight={600} color="#6a1b9a"
                sx={{ display: 'block', mb: 0.5, fontSize: 11, letterSpacing: 0.5 }}>
                {t('chart.gallery.goFishLabel')}
            </Typography>
            {inferredSize && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontSize: 10 }}>
                    {t('chart.gallery.inferredSize', { size: inferredSize })}
                </Typography>
            )}
            {error ? (
                <Typography color="error" variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>
                    {error}
                </Typography>
            ) : (
                <Box ref={containerRef} sx={{ minHeight: 200 }} />
            )}
            {warnings.length > 0 && (
                <Box sx={{ mt: 1, p: 1, bgcolor: '#f3e5f5', borderLeft: '3px solid #9c27b0' }}>
                    {warnings.map((w, i) => (
                        <Typography key={i} variant="body2" color="secondary.dark" sx={{ fontSize: 11 }}>
                            {w.message}
                        </Typography>
                    ))}
                </Box>
            )}
            {specDescription && (
                <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#888' }}>
                        {t('chart.gallery.goFishSpec')}
                    </summary>
                    <pre style={{ fontSize: 10, maxHeight: 200, overflow: 'auto', background: '#f3e5f5', padding: 8, borderRadius: 4 }}>
                        {specDescription}
                    </pre>
                </details>
            )}
        </Box>
    );
});

// ============================================================================
// Quad Render: VL + GoFish side-by-side (for GoFish backend tests)
// ============================================================================

const QuadChart: React.FC<{ testCase: TestCase }> = React.memo(({ testCase }) => {
    return (
        <Paper
            elevation={1}
            sx={{
                p: 2, mb: 2, maxWidth: 800,
                border: '1px solid #e0e0e0',
            }}
        >
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                {testCase.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mb={1} sx={{ wordBreak: 'break-word' }}>
                {testCase.description}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                {testCase.tags.map(tag => (
                    <Chip key={tag} label={tag} size="small" variant="outlined"
                        sx={{ fontSize: 10, height: 20 }} />
                ))}
            </Box>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                <VegaChartInline testCase={testCase} canvasSize={{ width: 300, height: 250 }} />
                <GoFishChart testCase={testCase} canvasSize={{ width: 300, height: 250 }} />
            </Box>
        </Paper>
    );
});

// ============================================================================
// Sub-page for a single chart type
// ============================================================================

const ChartTypeTestPanel: React.FC<{ chartGroup: string; sectionLabel?: string }> = ({ chartGroup, sectionLabel }) => {
    const { t } = useTranslation();
    const displayChartGroup = translateGalleryLabel(t, chartGroup);
    const tests = useMemo(() => {
        const gen = TEST_GENERATORS[chartGroup];
        return gen ? gen() : [];
    }, [chartGroup]);

    const isChartJsGroup = chartGroup.startsWith('Chart.js:');
    const isGoFishGroup = chartGroup.startsWith('GoFish');
    const isEChartsSection = sectionLabel === 'ECharts Backend';

    if (tests.length === 0) {
        return (
            <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">{t('chart.gallery.noTestCases', { chartGroup: displayChartGroup })}</Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 2, display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'flex-start' }}>
            {tests.map((tc, i) =>
                isGoFishGroup
                    ? <QuadChart key={`${chartGroup}-${i}`} testCase={tc} />
                    : isChartJsGroup
                        ? <TripleChart key={`${chartGroup}-${i}`} testCase={tc} />
                        : isEChartsSection
                            ? <DualChart key={`${chartGroup}-${i}`} testCase={tc} />
                            : <VegaChart key={`${chartGroup}-${i}`} testCase={tc} />
            )}
        </Box>
    );
};



// ============================================================================
// Main Page
// ============================================================================

const ChartGallery: React.FC = () => {
    const [activeSection, setActiveSection] = useState(0);
    const [activeCategory, setActiveCategory] = useState(0);
    const { t } = useTranslation();

    const section = GALLERY_SECTIONS[activeSection];
    const activeCategoryName = section?.entries[activeCategory] ?? '';

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            {/* Section tabs (top level) */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
                <Tabs
                    value={activeSection}
                    onChange={(_, v) => { setActiveSection(v); setActiveCategory(0); }}
                    sx={{
                        minHeight: 36,
                        '& .MuiTab-root': { minHeight: 36, py: 0.5, textTransform: 'none', fontWeight: 600, fontSize: 14 },
                    }}
                >
                    {GALLERY_SECTIONS.map((s, i) => (
                        <Tab key={s.label} label={translateGallerySectionLabel(t, s.label)} value={i} />
                    ))}
                </Tabs>
            </Box>

            {/* Category chips within the active section */}
            <Box sx={{ px: 2, py: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap', bgcolor: '#f5f5f5', borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary" sx={{ mr: 1, lineHeight: '28px' }}>
                    {translateGallerySectionDescription(t, section.description)}:
                </Typography>
                {section.entries.map((entry, ei) => (
                    <Chip
                        key={entry}
                        label={translateGalleryLabel(t, entry)}
                        size="small"
                        onClick={() => setActiveCategory(ei)}
                        variant={ei === activeCategory ? 'filled' : 'outlined'}
                        color={ei === activeCategory ? 'primary' : 'default'}
                        sx={{ fontSize: 12, height: 26, cursor: 'pointer' }}
                    />
                ))}
            </Box>

            {/* Chart content */}
            <Box sx={{ flex: 1, overflow: 'auto', bgcolor: '#fafafa' }}>
                <ChartTypeTestPanel chartGroup={activeCategoryName} sectionLabel={section?.label} />
            </Box>
        </Box>
    );
};

export default ChartGallery;
