// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ChartGallery — Visual gallery for Vega-Lite chart assembly.
 *
 * All synthetic test-data generators and types live in
 * `src/lib/agents-chart/test-data/`. This file contains only the
 * React components that render the gallery UI.
 */

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
    Box, Tabs, Tab, Typography, Paper, Chip, Link,
} from '@mui/material';
import embed from 'vega-embed';
import * as echarts from 'echarts';
import { Chart, registerables } from 'chart.js';
import { assembleVegaChart } from '../app/utils';
import { Channel, EncodingItem } from '../components/ComponentType';
import { channels } from '../components/ChartTemplates';
import { ChartWarning, ChartEncoding, ChartAssemblyInput, assembleVegaLite, assembleECharts, assembleChartjs, assembleGoFish, GoFishSpec } from '../lib/agents-chart';
import { TestCase, TEST_GENERATORS, GALLERY_SECTIONS } from '../lib/agents-chart/test-data';

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
            );

            if (!vlSpec) {
                setError('assembleVegaChart returned no spec');
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

            const semanticTypes: Record<string, string> = {};
            for (const [fieldName, meta] of Object.entries(testCase.metadata)) {
                if (meta.semanticType) {
                    semanticTypes[fieldName] = meta.semanticType;
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
                setError(`Vega embed error: ${err.message}`);
            });
        } catch (err: any) {
            setError(`Assembly error: ${err.message}`);
        }
    }, [testCase]);

    return (
        <Paper
            elevation={1}
            sx={{
                p: 2, mb: 2, width: 'fit-content', maxWidth: '100%',
                border: error ? '2px solid #f44336' : '1px solid #e0e0e0',
            }}
        >
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                {testCase.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mb={1}>
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
                    Inferred size: {inferredSize}
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
                    <Typography variant="body2" color="warning.dark" sx={{ fontSize: 11, fontWeight: 600, mb: 0.5 }}>
                        Warning:
                    </Typography>
                    {warnings.map((w, i) => (
                        <Typography key={i} variant="body2" color="warning.dark" sx={{ fontSize: 11 }}>
                            {w.message}
                        </Typography>
                    ))}
                </Box>
            )}
            {specOptions && (
                <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#888' }}>
                        Spec
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
const DEFAULT_CANVAS_SIZE = { width: 400, height: 300 } as const;

const EChartsChart: React.FC<{ testCase: TestCase; canvasSize?: { width: number; height: number } }> = React.memo(({ testCase, canvasSize = DEFAULT_CANVAS_SIZE }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<ChartWarning[]>([]);
    const [specJson, setSpecJson] = useState<string>('');
    const [inferredSize, setInferredSize] = useState<string>('');

    useEffect(() => {
        if (!containerRef.current) return;

        try {
            const ecOption = assembleECharts(testCaseToEChartsInput(testCase, canvasSize));

            if (!ecOption) {
                setError('assembleECharts returned no option');
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
            setError(`ECharts error: ${err.message}`);
        }

        return () => {
            if (chartRef.current) {
                chartRef.current.dispose();
                chartRef.current = null;
            }
        };
    }, [testCase, canvasSize]);

    return (
        <Box sx={{ width: 'fit-content' }}>
            <Typography variant="caption" fontWeight={600} color="#e65100"
                sx={{ display: 'block', mb: 0.5, fontSize: 11, letterSpacing: 0.5 }}>
                ECharts
            </Typography>
            {inferredSize && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontSize: 10 }}>
                    Inferred size: {inferredSize}
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
            {specJson && (
                <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#888' }}>
                        ECharts Option
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
    return (
        <Paper
            elevation={1}
            sx={{
                p: 2, mb: 2, width: 'fit-content', maxWidth: '100%',
                border: '1px solid #e0e0e0',
            }}
        >
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                {testCase.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                {testCase.description}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                {testCase.tags.map(tag => (
                    <Chip key={tag} label={tag} size="small" variant="outlined"
                        sx={{ fontSize: 10, height: 20 }} />
                ))}
            </Box>
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
            if (!vlSpec) { setError('No VL spec'); return; }

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
            }).catch(err => setError(`VL embed error: ${err.message}`));
        } catch (err: any) {
            setError(`VL error: ${err.message}`);
        }
    }, [testCase, canvasSize]);

    return (
        <Box sx={{ width: 'fit-content' }}>
            <Typography variant="caption" fontWeight={600} color="#1565c0"
                sx={{ display: 'block', mb: 0.5, fontSize: 11, letterSpacing: 0.5 }}>
                Vega-Lite
            </Typography>
            {inferredSize && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontSize: 10 }}>
                    Inferred size: {inferredSize}
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
                        Vega-Lite Spec
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

    useEffect(() => {
        if (!canvasRef.current) return;

        try {
            const cjsConfig = assembleChartjs(testCaseToChartJsInput(testCase, canvasSize));

            if (!cjsConfig) {
                setError('assembleChartjs returned no config');
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

            // Set container size — Chart.js responsive mode will fill it
            const w = cjsConfig._width || 400;
            const h = cjsConfig._height || 300;
            const container = canvasRef.current.parentElement;
            if (container) {
                container.style.width = `${w}px`;
                container.style.height = `${h}px`;
                container.style.position = 'relative';
            }

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
            cleanConfig.options.responsive = true;
            cleanConfig.options.maintainAspectRatio = false;

            chartRef.current = new Chart(canvasRef.current, cleanConfig);
            setError(null);
        } catch (err: any) {
            setError(`Chart.js error: ${err.message}`);
        }

        return () => {
            if (chartRef.current) {
                chartRef.current.destroy();
                chartRef.current = null;
            }
        };
    }, [testCase, canvasSize]);

    return (
        <Box sx={{ width: 'fit-content' }}>
            <Typography variant="caption" fontWeight={600} color="#2e7d32"
                sx={{ display: 'block', mb: 0.5, fontSize: 11, letterSpacing: 0.5 }}>
                Chart.js
            </Typography>
            {inferredSize && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontSize: 10 }}>
                    Inferred size: {inferredSize}
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
                        Chart.js Config
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
                p: 2, mb: 2, width: 'fit-content', maxWidth: '100%',
                border: '1px solid #e0e0e0',
            }}
        >
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                {testCase.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                {testCase.description}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                {testCase.tags.map(tag => (
                    <Chip key={tag} label={tag} size="small" variant="outlined"
                        sx={{ fontSize: 10, height: 20 }} />
                ))}
            </Box>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                <VegaChartInline testCase={testCase} canvasSize={{ width: 240, height: 200 }} />
                <EChartsChart testCase={testCase} canvasSize={{ width: 240, height: 200 }} />
                <ChartJsChart testCase={testCase} canvasSize={{ width: 240, height: 200 }} />
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

    useEffect(() => {
        if (!containerRef.current) return;

        try {
            const gfSpec = assembleGoFish(testCaseToGoFishInput(testCase, canvasSize));

            if (!gfSpec) {
                setError('assembleGoFish returned no spec');
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
            setError(`GoFish error: ${err.message}`);
        }
    }, [testCase, canvasSize]);

    return (
        <Box sx={{ width: 'fit-content' }}>
            <Typography variant="caption" fontWeight={600} color="#6a1b9a"
                sx={{ display: 'block', mb: 0.5, fontSize: 11, letterSpacing: 0.5 }}>
                GoFish
            </Typography>
            {inferredSize && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontSize: 10 }}>
                    Inferred size: {inferredSize}
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
                        GoFish Spec
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
                p: 2, mb: 2, width: 'fit-content', maxWidth: '100%',
                border: '1px solid #e0e0e0',
            }}
        >
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                {testCase.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mb={1}>
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

const ChartTypeTestPanel: React.FC<{ chartGroup: string }> = ({ chartGroup }) => {
    const tests = useMemo(() => {
        const gen = TEST_GENERATORS[chartGroup];
        return gen ? gen() : [];
    }, [chartGroup]);

    const isEChartsGroup = chartGroup.startsWith('ECharts:');
    const isChartJsGroup = chartGroup.startsWith('Chart.js:');
    const isGoFishGroup = chartGroup.startsWith('GoFish');

    if (tests.length === 0) {
        return (
            <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">No test cases defined for "{chartGroup}"</Typography>
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
                    : isEChartsGroup
                    ? <DualChart key={`${chartGroup}-${i}`} testCase={tc} />
                    : <VegaChart key={`${chartGroup}-${i}`} testCase={tc} />
            )}
        </Box>
    );
};

// ============================================================================
// Interactive Demo for About Page
// ============================================================================

/** Sample dataset: country economic indicators (20 countries for cardinality demos) */
const DEMO_DATA = [
    { Country: 'United States', GDP: 25460, Population: 331, LifeExpectancy: 77.2, Region: 'Americas', HDI: 0.921 },
    { Country: 'China', GDP: 17960, Population: 1412, LifeExpectancy: 77.1, Region: 'Asia', HDI: 0.768 },
    { Country: 'Japan', GDP: 4230, Population: 125, LifeExpectancy: 84.8, Region: 'Asia', HDI: 0.925 },
    { Country: 'Germany', GDP: 4070, Population: 83, LifeExpectancy: 80.6, Region: 'Europe', HDI: 0.942 },
    { Country: 'India', GDP: 3390, Population: 1408, LifeExpectancy: 67.2, Region: 'Asia', HDI: 0.633 },
    { Country: 'United Kingdom', GDP: 3070, Population: 67, LifeExpectancy: 80.7, Region: 'Europe', HDI: 0.929 },
    { Country: 'France', GDP: 2780, Population: 67, LifeExpectancy: 82.3, Region: 'Europe', HDI: 0.903 },
    { Country: 'Brazil', GDP: 1920, Population: 214, LifeExpectancy: 72.8, Region: 'Americas', HDI: 0.754 },
    { Country: 'Canada', GDP: 2140, Population: 38, LifeExpectancy: 81.7, Region: 'Americas', HDI: 0.936 },
    { Country: 'South Korea', GDP: 1670, Population: 52, LifeExpectancy: 83.7, Region: 'Asia', HDI: 0.925 },
    { Country: 'Australia', GDP: 1680, Population: 26, LifeExpectancy: 83.3, Region: 'Oceania', HDI: 0.951 },
    { Country: 'Nigeria', GDP: 470, Population: 213, LifeExpectancy: 52.7, Region: 'Africa', HDI: 0.535 },
    { Country: 'Mexico', GDP: 1290, Population: 128, LifeExpectancy: 75.0, Region: 'Americas', HDI: 0.758 },
    { Country: 'Indonesia', GDP: 1190, Population: 274, LifeExpectancy: 67.6, Region: 'Asia', HDI: 0.705 },
    { Country: 'Turkey', GDP: 820, Population: 84, LifeExpectancy: 76.0, Region: 'Europe', HDI: 0.838 },
    { Country: 'Saudi Arabia', GDP: 1110, Population: 35, LifeExpectancy: 76.9, Region: 'Asia', HDI: 0.875 },
    { Country: 'Switzerland', GDP: 800, Population: 9, LifeExpectancy: 83.4, Region: 'Europe', HDI: 0.962 },
    { Country: 'Norway', GDP: 580, Population: 5, LifeExpectancy: 83.2, Region: 'Europe', HDI: 0.961 },
    { Country: 'South Africa', GDP: 400, Population: 60, LifeExpectancy: 62.3, Region: 'Africa', HDI: 0.713 },
    { Country: 'Egypt', GDP: 470, Population: 104, LifeExpectancy: 70.2, Region: 'Africa', HDI: 0.731 },
];

const DEMO_SEMANTIC_TYPES: Record<string, string> = {
    Country: 'Country',
    GDP: 'Currency',
    Population: 'Quantity',
    LifeExpectancy: 'Duration',
    Region: 'Location',
    HDI: 'Proportion',
};

interface DemoVariant {
    label: string;
    description: string;
    chartType: string;
    encodings: Record<string, ChartEncoding>;
}

const DEMO_VARIANTS: DemoVariant[] = [
    {
        label: 'GDP by Region (5 bars)',
        description: 'Low cardinality: 5 regions on x-axis. The chart is comfortably sized — each bar gets plenty of space.',
        chartType: 'Bar Chart',
        encodings: {
            x: { field: 'Region' },
            y: { field: 'GDP' },
        },
    },
    {
        label: 'GDP by Country (20 bars)',
        description: 'High cardinality: 20 countries on x-axis. The compiler auto-stretches the chart width so labels remain readable — without this, bars would be crushed together.',
        chartType: 'Bar Chart',
        encodings: {
            x: { field: 'Country' },
            y: { field: 'GDP' },
            color: { field: 'Region' },
        },
    },
    {
        label: 'Swap Y to HDI',
        description: 'Same 20-bar layout — just swap y to HDI. Semantic type "Proportion" → compiler sets 0–1 domain and % formatting. No LLM call needed.',
        chartType: 'Bar Chart',
        encodings: {
            x: { field: 'Country' },
            y: { field: 'HDI' },
            color: { field: 'Region' },
        },
    },
    {
        label: 'Change to Scatter',
        description: 'Switch to Scatter Plot — continuous axes, no cardinality pressure. Semantic type "Currency" on GDP → dollar formatting, zero-baseline.',
        chartType: 'Scatter Plot',
        encodings: {
            x: { field: 'GDP' },
            y: { field: 'LifeExpectancy' },
            color: { field: 'Region' },
            size: { field: 'Population' },
        },
    },
];

/** Renders a single assembleVegaLite chart from a ChartAssemblyInput */
const DemoChart: React.FC<{ input: ChartAssemblyInput; label: string }> = React.memo(({ input, label }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!ref.current) return;
        setError(null);
        try {
            const spec = assembleVegaLite(input);
            if (!spec) { setError('No spec returned'); return; }
            const clean = { ...spec };
            delete clean._warnings;
            embed(ref.current, clean, { actions: false, renderer: 'svg' })
                .catch(e => setError(e.message));
        } catch (e: any) {
            setError(e.message);
        }
    }, [input]);

    return (
        <Box>
            <Typography variant="caption" fontWeight={600} sx={{ mb: 0.5, display: 'block' }}>
                {label}
            </Typography>
            {error
                ? <Typography color="error" variant="caption">{error}</Typography>
                : <Box ref={ref} sx={{ minHeight: 120 }} />
            }
        </Box>
    );
});

/** Interactive demo showing the same spec across variants and backends */
const InteractiveDemo: React.FC = () => {
    const [variantIdx, setVariantIdx] = useState(0);
    const variant = DEMO_VARIANTS[variantIdx];

    const input: ChartAssemblyInput = useMemo(() => ({
        data: { values: DEMO_DATA },
        semantic_types: DEMO_SEMANTIC_TYPES,
        chart_spec: {
            chartType: variant.chartType,
            encodings: variant.encodings,
            canvasSize: { width: 400, height: 280 },
        },
    }), [variant]);

    // Build compact display spec (what LLM would output)
    const displaySpec = useMemo(() => {
        const enc: Record<string, any> = {};
        for (const [ch, e] of Object.entries(variant.encodings)) {
            enc[ch] = { field: e.field };
        }
        return JSON.stringify({
            chartType: variant.chartType,
            encodings: enc,
        }, null, 2).replace(
            /"(\w+)":\s*\{([^{}]+)\}/g,
            (match, key, body) => {
                if (!body.includes('"field"')) return match;
                return `"${key}": { ${body.replace(/\s*\n\s*/g, ' ').trim()} }`;
            }
        );
    }, [variant]);

    const semanticDisplay = JSON.stringify(DEMO_SEMANTIC_TYPES, null, 2);

    return (
        <Paper variant="outlined" sx={{ p: 2.5, mt: 2 }}>
            {/* Variant selector */}
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                {DEMO_VARIANTS.map((v, i) => (
                    <Chip
                        key={v.label}
                        label={v.label}
                        size="small"
                        onClick={() => setVariantIdx(i)}
                        variant={i === variantIdx ? 'filled' : 'outlined'}
                        color={i === variantIdx ? 'primary' : 'default'}
                        sx={{ fontSize: 12, cursor: 'pointer' }}
                    />
                ))}
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {variant.description}
            </Typography>

            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {/* Left: spec + semantic types */}
                <Box sx={{ minWidth: 280, flex: '0 0 auto' }}>
                    <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
                        Agent output (chart spec):
                    </Typography>
                    <pre style={{
                        fontSize: 11, background: '#f0f4ff', padding: 10, borderRadius: 4,
                        margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5,
                    }}>
                        {displaySpec}
                    </pre>

                    <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mt: 1.5, mb: 0.5 }}>
                        Semantic types (also LLM-generated, once per table):
                    </Typography>
                    <pre style={{
                        fontSize: 11, background: '#f5f0ff', padding: 10, borderRadius: 4,
                        margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5,
                    }}>
                        {semanticDisplay}
                    </pre>
                </Box>

                {/* Right: rendered chart */}
                <Box sx={{ flex: 1, minWidth: 300 }}>
                    <DemoChart input={input} label="Compiled output (Vega-Lite):" />
                </Box>
            </Box>

            {/* Benefits callout */}
            <Box sx={{ mt: 2, p: 1.5, bgcolor: '#f8faf8', borderRadius: 1, border: '1px solid #e0e8e0' }}>
                <Typography variant="caption" sx={{ lineHeight: 1.7, display: 'block' }}>
                    <strong>Why this matters:</strong> The chart spec is ~5 lines of JSON — minimal LLM tokens.{' '}
                    <strong>Resizing:</strong> Compare "5 bars" vs "20 bars" — the compiler auto-stretches the chart
                    to fit high-cardinality axes so labels stay readable, with no hard-coded width.{' '}
                    <strong>Semantic types (LLM-generated):</strong> The LLM also infers semantic types once per table — <code>Currency</code> → zero-baseline + dollar formatting;{' '}
                    <code>Proportion</code> → 0–1 domain + % axis; <code>Location</code> → categorical color scheme.{' '}
                    These persist across interactions, so subsequent field swaps and chart type changes don't need the LLM again.{' '}
                    <strong>Editability:</strong> Click the variants above — each recompiles
                    instantly <em>without any LLM call</em>. The same spec compiles to Vega-Lite,
                    ECharts, or Chart.js — see the backend tabs.
                </Typography>
            </Box>
        </Paper>
    );
};

// ============================================================================
// About Tab
// ============================================================================

const AboutTab: React.FC<{ onNavigate: (section: number, category: number) => void }> = ({ onNavigate }) => (
    <Box sx={{ maxWidth: 800, mx: 'auto', py: 4, px: 3 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
            agents-chart
        </Typography>
        <Typography variant="subtitle1" color="text.secondary" gutterBottom>
            A data visualization library for agent developers. The LLM generates a simple chart spec and semantic type annotations; the compiler turns these into polished chart specifications for different rendering backends.
        </Typography>
        <Typography variant="body2" sx={{ mt: 2, lineHeight: 1.8 }}>
            The key idea: we separate the concerns of <strong>what</strong> to visualize (chart type, field assignments, and LLM-generated semantic types) from <strong>how</strong> to visualize it (sizing, formatting, mark templates). The former comes from the LLM and remains stable across interactions, while the latter is derived by a deterministic compiler that ensures charts look good and stay editable without needing to call the LLM again.
        </Typography>

        <Typography variant="h6" fontWeight={600} sx={{ mt: 3 }}>
            Motivation
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, lineHeight: 1.8 }}>
            LLM-generated chart specs face a fundamental dilemma: <strong>simple specs</strong> are
            editable but look bad (wrong sizing, misleading encodings), while <strong>polished specs</strong> look
            great but are brittle (hard-coded values break on every field swap).
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, lineHeight: 1.8 }}>
            <strong>agents-chart</strong> resolves this. The LLM outputs two things: a <strong>chart spec</strong> (chart type + field assignments) and <strong>semantic types</strong> for each field (e.g. <code>Revenue</code>, <code>Rank</code>,{' '}
            <code>CategoryCode</code>). Both are generated by the LLM, but the semantic types only need to be inferred once per table — after that, the deterministic compiler derives all low-level parameters —
            sizing, zero-baseline, formatting, color schemes, and mark templates — so charts look good
            <em> and</em> stay editable without calling the LLM again.
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, lineHeight: 1.8 }}>
            When a user swaps fields, changes chart type, or adds facets for exploration, the compiler
            re-derives all parameters automatically — <strong>no LLM call needed</strong>. Because the
            output is native library code, users retain full control over fine-tuning using each
            library's own API.
        </Typography>

        <Typography variant="h6" fontWeight={600} sx={{ mt: 4 }}>
            Try It
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Click the variants below to swap fields or chart types — every change recompiles instantly with no LLM call:
        </Typography>
        <InteractiveDemo />

        <Typography variant="h6" fontWeight={600} sx={{ mt: 4 }}>
            Gallery
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
            Browse the tabs above to see the library in action across different backends and test scenarios:
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {GALLERY_SECTIONS.map((section, i) => (
                <Paper key={section.label} variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2" fontWeight={600}>
                        {section.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                        {section.description}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {section.entries.map((entry, ei) => (
                            <Chip key={entry} label={entry} size="small" variant="outlined"
                                sx={{ fontSize: 11, height: 22, cursor: 'pointer' }}
                                onClick={() => onNavigate(i + 1, ei)}
                            />
                        ))}
                    </Box>
                </Paper>
            ))}
        </Box>

        <Typography variant="h6" fontWeight={600} sx={{ mt: 4 }}>
            Supported Backends
        </Typography>
        <Box component="ul" sx={{ mt: 1, pl: 2 }}>
            <li>
                <Typography variant="body2">
                    <Link href="https://vega.github.io/vega-lite/" target="_blank" rel="noopener">Vega-Lite</Link>
                    {' — '}Declarative grammar of interactive graphics
                </Typography>
            </li>
            <li>
                <Typography variant="body2">
                    <Link href="https://echarts.apache.org/" target="_blank" rel="noopener">Apache ECharts</Link>
                    {' — '}Series-based charting library
                </Typography>
            </li>
            <li>
                <Typography variant="body2">
                    <Link href="https://www.chartjs.org/" target="_blank" rel="noopener">Chart.js</Link>
                    {' — '}Dataset-based canvas charting
                </Typography>
            </li>
        </Box>
    </Box>
);

// ============================================================================
// Main Page
// ============================================================================

const ChartGallery: React.FC = () => {
    const [activeSection, setActiveSection] = useState(0);
    const [activeCategory, setActiveCategory] = useState(0);

    // Section index 0 = About; gallery sections start at index 1
    const isAbout = activeSection === 0;
    const galleryIdx = activeSection - 1;
    const section = GALLERY_SECTIONS[galleryIdx];
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
                    <Tab key="about" label="About" value={0} />
                    {GALLERY_SECTIONS.map((s, i) => (
                        <Tab key={s.label} label={s.label} value={i + 1} />
                    ))}
                </Tabs>
            </Box>

            {isAbout ? (
                <Box sx={{ flex: 1, overflow: 'auto', bgcolor: '#fafafa' }}>
                    <AboutTab onNavigate={(s, c) => { setActiveSection(s); setActiveCategory(c); }} />
                </Box>
            ) : (
                <>
                    {/* Category chips within the active section */}
                    <Box sx={{ px: 2, py: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap', bgcolor: '#f5f5f5', borderBottom: 1, borderColor: 'divider' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ mr: 1, lineHeight: '28px' }}>
                            {section.description}:
                        </Typography>
                        {section.entries.map((entry, ei) => (
                            <Chip
                                key={entry}
                                label={entry}
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
                        <ChartTypeTestPanel chartGroup={activeCategoryName} />
                    </Box>
                </>
            )}
        </Box>
    );
};

export default ChartGallery;
