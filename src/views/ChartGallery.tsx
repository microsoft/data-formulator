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
    Box, Tabs, Tab, Typography, Paper, Chip,
} from '@mui/material';
import embed from 'vega-embed';
import * as echarts from 'echarts';
import { Chart, registerables } from 'chart.js';
import { assembleVegaChart } from '../app/utils';
import { Channel, EncodingItem } from '../components/ComponentType';
import { channels } from '../components/ChartTemplates';
import { ChartWarning, ChartEncoding, ChartAssemblyInput, ecAssembleChart, cjsAssembleChart } from '../lib/agents-chart';
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

            // Build compact spec-options JSON (no data, only non-default settings)
            const opts: Record<string, any> = {};
            // Encodings used
            const enc: Record<string, any> = {};
            for (const [ch, ei] of Object.entries(testCase.encodingMap)) {
                if (ei && ei.fieldID) {
                    const entry: Record<string, any> = { field: ei.fieldID };
                    const meta = testCase.metadata[ei.fieldID];
                    if (meta?.semanticType) entry.semanticType = meta.semanticType;
                    if (ei.dtype) entry.type = ei.dtype;
                    if (ei.aggregate) entry.aggregate = ei.aggregate;
                    if (ei.sortOrder) entry.sortOrder = ei.sortOrder;
                    if (ei.sortBy) entry.sortBy = ei.sortBy;
                    if (ei.scheme) entry.scheme = ei.scheme;
                    enc[ch] = entry;
                }
            }
            opts.chartType = testCase.chartType;
            opts.encodings = enc;
            if (testCase.chartProperties && Object.keys(testCase.chartProperties).length > 0) {
                opts.chartProperties = testCase.chartProperties;
            }
            if (testCase.assembleOptions && Object.keys(testCase.assembleOptions).length > 0) {
                opts.assembleOptions = testCase.assembleOptions;
            }
            setSpecOptions(JSON.stringify(opts, null, 2));

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
 * Convert a TestCase into a ChartAssemblyInput for ecAssembleChart.
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
            const ecOption = ecAssembleChart(testCaseToEChartsInput(testCase, canvasSize));

            if (!ecOption) {
                setError('ecAssembleChart returned no option');
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
 * Convert a TestCase into a ChartAssemblyInput for cjsAssembleChart.
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
            const cjsConfig = cjsAssembleChart(testCaseToChartJsInput(testCase, canvasSize));

            if (!cjsConfig) {
                setError('cjsAssembleChart returned no config');
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
// Sub-page for a single chart type
// ============================================================================

const ChartTypeTestPanel: React.FC<{ chartGroup: string }> = ({ chartGroup }) => {
    const tests = useMemo(() => {
        const gen = TEST_GENERATORS[chartGroup];
        return gen ? gen() : [];
    }, [chartGroup]);

    const isEChartsGroup = chartGroup.startsWith('ECharts:');
    const isChartJsGroup = chartGroup.startsWith('Chart.js:');

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
                isChartJsGroup
                    ? <TripleChart key={`${chartGroup}-${i}`} testCase={tc} />
                    : isEChartsGroup
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

    const section = GALLERY_SECTIONS[activeSection];
    const activeCategoryName = section.entries[activeCategory] ?? section.entries[0];

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
                        <Tab key={s.label} label={s.label} value={i} />
                    ))}
                </Tabs>
            </Box>

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
        </Box>
    );
};

export default ChartGallery;
