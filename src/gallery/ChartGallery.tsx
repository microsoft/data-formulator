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
    Box, Typography, Paper, Chip, Button, IconButton, Collapse, Tooltip,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TablePagination,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import QuestionMarkIcon from '@mui/icons-material/QuestionMark';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import embed from 'vega-embed';
import * as echarts from 'echarts';
import { Chart, registerables } from 'chart.js';
import { assembleVegaChart } from '../app/utils';
import { Channel, EncodingItem } from '../components/ComponentType';
import { channels, CHART_ICONS } from '../components/ChartTemplates';
import { ChartWarning, ChartEncoding, ChartAssemblyInput, assembleVegaLite, assembleECharts, assembleChartjs, assembleGoFish, GoFishSpec } from '../lib/agents-chart';
import {
    TestCase, TEST_GENERATORS,
    OMNI_VIZ_ROWS, OMNI_VIZ_LEVELS,
    GALLERY_TREE, DEFAULT_PATH, findPage,
    type GalleryPage,
} from '../lib/agents-chart/test-data';
import { GallerySidebar, ancestorsOf, type GalleryPath } from './GallerySidebar';

// Register all Chart.js components
Chart.register(...registerables);

// ============================================================================
// Spec Disclosure — reusable collapsible code viewer
// ============================================================================

type SpecVariant = 'input' | 'vegalite' | 'echarts' | 'chartjs' | 'gofish' | 'neutral';

const SPEC_VARIANT_STYLES: Record<SpecVariant, { accent: string; bg: string }> = {
    input:    { accent: '#6b7a99', bg: '#fafbfd' },
    vegalite: { accent: '#6b7a99', bg: '#fafbfd' },
    echarts:  { accent: '#a68a6b', bg: '#fcfaf7' },
    chartjs:  { accent: '#7a9a7a', bg: '#fafcfa' },
    gofish:   { accent: '#9a7aa6', bg: '#fbfafc' },
    neutral:  { accent: '#9e9e9e', bg: '#fafafa' },
};

const SpecDisclosure: React.FC<{
    label: string;
    content: string;
    variant?: SpecVariant;
    defaultExpanded?: boolean;
    maxHeight?: number;
    dense?: boolean;
}> = ({ label, content, variant = 'neutral', defaultExpanded = false, maxHeight = 220, dense = false }) => {
    const [open, setOpen] = useState(defaultExpanded);
    const [copied, setCopied] = useState(false);
    const { accent, bg } = SPEC_VARIANT_STYLES[variant];

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(content).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        });
    };

    return (
        <Box sx={{ mt: dense ? 0.25 : 0.5 }}>
            <Box
                onClick={() => setOpen(o => !o)}
                sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.25,
                    py: 0.25,
                    cursor: 'pointer', userSelect: 'none',
                    color: 'text.secondary',
                    opacity: 0.75,
                    transition: 'opacity 120ms',
                    '&:hover': { opacity: 1 },
                }}
            >
                <ChevronRightIcon
                    sx={{
                        fontSize: 13,
                        transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                        transition: 'transform 150ms',
                    }}
                />
                <Typography variant="caption" sx={{ fontSize: 10.5, fontWeight: 500, letterSpacing: 0.2 }}>
                    {label}
                </Typography>
                {open && (
                    <Tooltip title={copied ? 'Copied' : 'Copy'} placement="top">
                        <IconButton
                            size="small"
                            onClick={handleCopy}
                            sx={{ p: 0.125, ml: 0.25, color: 'inherit', opacity: 0.6, '&:hover': { opacity: 1 } }}
                        >
                            <ContentCopyIcon sx={{ fontSize: 11 }} />
                        </IconButton>
                    </Tooltip>
                )}
            </Box>
            <Collapse in={open} timeout={150} unmountOnExit>
                <Box
                    component="pre"
                    sx={{
                        m: 0, mt: 0.25, px: 1, py: 0.75,
                        fontSize: 10, lineHeight: 1.5,
                        fontFamily: '"SF Mono", Monaco, Consolas, "Courier New", monospace',
                        color: 'text.secondary',
                        maxHeight,
                        overflow: 'auto',
                        bgcolor: bg,
                        borderLeft: '2px solid',
                        borderLeftColor: accent,
                        borderRadius: '0 2px 2px 0',
                        whiteSpace: 'pre',
                    }}
                >
                    {content}
                </Box>
            </Collapse>
        </Box>
    );
};

// ============================================================================
// Chart Rendering Component
// ============================================================================

/**
 * Replace inline `data` / `values` arrays inside a spec object with a placeholder
 * string so the JSON stays readable in disclosures.
 */
function stripSpecData<T>(spec: T): T {
    const walk = (node: any): any => {
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === 'object') {
            const out: any = {};
            for (const [k, v] of Object.entries(node)) {
                if ((k === 'data' || k === 'values' || k === 'datasets') && Array.isArray(v)) {
                    out[k] = `[${v.length} items]`;
                } else if (k === 'data' && v && typeof v === 'object' && Array.isArray((v as any).values)) {
                    out[k] = { ...(v as any), values: `[${(v as any).values.length} rows]` };
                } else {
                    out[k] = walk(v);
                }
            }
            return out;
        }
        return node;
    };
    return walk(spec);
}

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
                testCase.semanticAnnotations,
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

            setSpecJson(JSON.stringify(stripSpecData(vlSpec), null, 2));

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
        <StandaloneChartCard testCase={testCase} error={error}>
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
                <Box sx={{ mt: 1, p: 1, bgcolor: '#fff3e0', borderLeft: '3px solid #ff9800', width: 0, minWidth: '100%' }}>
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
                                parts.push('## Flint spec\n' + specOptions);
                            }
                            if (specJson) {
                                const vlLines = specJson.split('\n').slice(0, 50).join('\n');
                                parts.push('## vega-lite output spec (first 50 lines)\n' + vlLines);
                            }
                            navigator.clipboard.writeText(parts.join('\n\n'));
                        }}
                    >
                        Copy Spec + VL
                    </Button>
                </Box>
            )}
            {specOptions && (
                <SpecDisclosure label="Flint Spec" content={specOptions} variant="input" />
            )}
            {specJson && (
                <SpecDisclosure label="Vega-Lite Spec" content={specJson} variant="vegalite" dense />
            )}
        </StandaloneChartCard>
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
const DEFAULT_CANVAS_SIZE = { width: 400, height: 300 } as const;

/**
 * Shared card wrapper used by standalone backend chart renderers.
 * Shows the test case title / description / tags and a subtle card background,
 * so the per-backend label can be omitted (the gallery section already implies it).
 */
const StandaloneChartCard: React.FC<{ testCase: TestCase; error?: string | null; children: React.ReactNode }> = ({ testCase, error, children }) => (
    <Paper
        elevation={0}
        sx={{
            p: 2, mb: 2, width: 'fit-content',
            bgcolor: '#ffffff',
            border: error ? '1px solid #f44336' : '1px solid #eeeeee',
            borderRadius: 1,
        }}
    >
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
        </Box>
        {children}
    </Paper>
);

const EChartsChart: React.FC<{ testCase: TestCase; canvasSize?: { width: number; height: number }; standalone?: boolean }> = React.memo(({ testCase, canvasSize = DEFAULT_CANVAS_SIZE, standalone = false }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<ChartWarning[]>([]);
    const [specJson, setSpecJson] = useState<string>('');
    const [inferredSize, setInferredSize] = useState<string>('');
    const sharedSpec = useMemo(() => buildSharedInputSpec(testCase), [testCase]);

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
            setSpecJson(JSON.stringify(stripSpecData(displayOption), null, 2));

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

    const body = (
        <>
            {!standalone && (
                <Typography variant="caption" fontWeight={600} color="#e65100"
                    sx={{ display: 'block', mb: 0.5, fontSize: 11, letterSpacing: 0.5 }}>
                    ECharts
                </Typography>
            )}
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
                <>
                    {standalone && (
                        <SpecDisclosure label="Flint Spec" content={sharedSpec.compact} variant="input" />
                    )}
                    <SpecDisclosure label="ECharts Option" content={specJson} variant="echarts" dense={standalone} />
                </>
            )}
        </>
    );
    if (standalone) {
        return <StandaloneChartCard testCase={testCase} error={error}>{body}</StandaloneChartCard>;
    }
    return <Box sx={{ width: 'fit-content' }}>{body}</Box>;
});

// ============================================================================
// Dual Render: VL + ECharts side-by-side
// ============================================================================

const DualChart: React.FC<{ testCase: TestCase }> = React.memo(({ testCase }) => {
    const sharedSpec = useMemo(() => buildSharedInputSpec(testCase), [testCase]);
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2, mb: 2, maxWidth: 800,
                bgcolor: '#ffffff',
                border: '1px solid #eeeeee',
                borderRadius: 1,
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
            <Box sx={{ mb: 1.5 }}>
                <SpecDisclosure label="Flint Spec" content={sharedSpec.compact} variant="input" maxHeight={260} />
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
            setSpecJson(JSON.stringify(stripSpecData(displaySpec), null, 2));

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
                <SpecDisclosure label="Vega-Lite Spec" content={specJson} variant="vegalite" />
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

const ChartJsChart: React.FC<{ testCase: TestCase; canvasSize?: { width: number; height: number }; standalone?: boolean }> = React.memo(({ testCase, canvasSize = DEFAULT_CANVAS_SIZE, standalone = false }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRefs = useRef<Chart[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<ChartWarning[]>([]);
    const [specJson, setSpecJson] = useState<string>('');
    const [inferredSize, setInferredSize] = useState<string>('');
    const sharedSpec = useMemo(() => buildSharedInputSpec(testCase), [testCase]);

    useEffect(() => {
        if (!containerRef.current) return;

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
            setSpecJson(JSON.stringify(stripSpecData(displayConfig), null, 2));

            // Destroy previous charts
            for (const c of chartRefs.current) c.destroy();
            chartRefs.current = [];

            const host = containerRef.current;
            host.innerHTML = '';

            const panels = Array.isArray(cjsConfig._facetPanels) ? cjsConfig._facetPanels as any[][] : null;
            if (panels && panels.length > 0) {
                const PANEL_GAP_PX = 4;
                const LEGEND_GAP_PX = 4;
                const LEGEND_COL_W = 90;
                host.style.display = 'flex';
                host.style.flexDirection = 'row';
                host.style.gap = `${LEGEND_GAP_PX}px`;
                host.style.alignItems = 'flex-start';
                host.style.width = `${Number(cjsConfig._width || 400)}px`;
                host.style.maxWidth = '100%';
                host.style.overflow = 'hidden';
                const totalRows = Number(cjsConfig._facetRows || panels.length);
                const totalCols = Number(cjsConfig._facetCols || Math.max(...panels.map(r => r.length)));
                const sharedYDomain = cjsConfig._facetSharedYDomain as { min: number; max: number } | undefined;
                const totalBudgetW = Number(cjsConfig._width || 400);
                const totalBudgetH = Number(cjsConfig._height || 300);
                const legendItems = Array.isArray(cjsConfig._facetLegend)
                    ? cjsConfig._facetLegend as Array<{ label: string; color: string }>
                    : [];
                const useLegendCol = legendItems.length > 0;
                const panelAreaW = useLegendCol
                    ? Math.max(100, totalBudgetW - LEGEND_COL_W - LEGEND_GAP_PX)
                    : totalBudgetW;
                const panelBudgetW = Math.max(
                    80,
                    Math.floor((panelAreaW - Math.max(0, totalCols - 1) * PANEL_GAP_PX) / Math.max(1, totalCols)),
                );
                const panelBudgetH = Math.max(
                    80,
                    Math.floor((totalBudgetH - Math.max(0, totalRows - 1) * PANEL_GAP_PX) / Math.max(1, totalRows)),
                );
                const gridEl = document.createElement('div');
                gridEl.style.display = 'flex';
                gridEl.style.flexDirection = 'column';
                gridEl.style.gap = `${PANEL_GAP_PX}px`;
                gridEl.style.width = `${panelAreaW}px`;
                gridEl.style.overflow = 'hidden';

                for (const rowPanels of panels) {
                    const rowEl = document.createElement('div');
                    rowEl.style.display = 'flex';
                    rowEl.style.gap = `${PANEL_GAP_PX}px`;
                    rowEl.style.alignItems = 'flex-start';
                    rowEl.style.width = `${panelAreaW}px`;
                    rowEl.style.overflow = 'hidden';

                    for (const panel of rowPanels) {
                        const panelBox = document.createElement('div');
                        panelBox.style.display = 'flex';
                        panelBox.style.flexDirection = 'column';
                        panelBox.style.gap = '4px';

                        if (panel.colHeader || panel.rowHeader) {
                            const header = document.createElement('div');
                            header.style.fontSize = '11px';
                            header.style.fontWeight = '600';
                            header.style.color = '#666';
                            header.style.textAlign = 'center';
                            header.style.width = '100%';
                            header.textContent = [panel.colHeader, panel.rowHeader].filter(Boolean).join(' | ');
                            panelBox.appendChild(header);
                        }

                        const canvasWrap = document.createElement('div');
                        canvasWrap.style.position = 'relative';
                        canvasWrap.style.width = `${panelBudgetW}px`;
                        canvasWrap.style.height = `${panelBudgetH}px`;
                        const canvas = document.createElement('canvas');
                        canvasWrap.appendChild(canvas);
                        panelBox.appendChild(canvasWrap);
                        rowEl.appendChild(panelBox);

                        const panelConfig = { ...panel.config };
                        delete panelConfig._warnings;
                        delete panelConfig._dataLength;
                        delete panelConfig._width;
                        delete panelConfig._height;
                        delete panelConfig._facet;
                        delete panelConfig._facetPanels;
                        delete panelConfig._facetSharedYDomain;
                        if (!panelConfig.options) panelConfig.options = {};
                        if (!panelConfig.options.plugins) panelConfig.options.plugins = {};
                        if (!panelConfig.options.scales) panelConfig.options.scales = {};
                        if (!panelConfig.options.scales.x) panelConfig.options.scales.x = {};
                        if (!panelConfig.options.scales.y) panelConfig.options.scales.y = {};

                        const ri = Number(panel.rowIndex ?? 0);
                        const ci = Number(panel.colIndex ?? 0);
                        const isLeftCol = ci === 0;
                        const isBottomRow = ri === totalRows - 1;

                        if (sharedYDomain) {
                            panelConfig.options.scales.y.min = sharedYDomain.min;
                            panelConfig.options.scales.y.max = sharedYDomain.max;
                        }

                        // Shared y-axis display: only left-most column keeps y axis labels/title.
                        panelConfig.options.scales.y.ticks = {
                            ...(panelConfig.options.scales.y.ticks || {}),
                            // Keep y-axis width consistent across facet panels.
                            // Non-left panels reserve the same axis slot by drawing transparent labels.
                            display: true,
                            color: isLeftCol ? undefined : 'rgba(0,0,0,0)',
                        };
                        panelConfig.options.scales.y.title = {
                            ...(panelConfig.options.scales.y.title || {}),
                            // Hide per-panel y-title in facets to keep all panels identical size.
                            display: false,
                        };

                        // Shared x-axis display: only bottom row keeps x axis labels/title.
                        panelConfig.options.scales.x.ticks = {
                            ...(panelConfig.options.scales.x.ticks || {}),
                            display: isBottomRow,
                        };
                        panelConfig.options.scales.x.title = {
                            ...(panelConfig.options.scales.x.title || {}),
                            display: isBottomRow && !!panelConfig.options.scales.x.title?.text,
                        };

                        // Shared legend: keep a single legend at top-left panel.
                        const legendCfg = panelConfig.options.plugins.legend || {};
                        panelConfig.options.plugins.legend = {
                            ...legendCfg,
                            display: false,
                            fullSize: false,
                        };

                        panelConfig.options.animation = false;
                        panelConfig.options.responsive = true;
                        panelConfig.options.maintainAspectRatio = false;
                        panelConfig.options.layout = {
                            ...(panelConfig.options.layout || {}),
                            padding: {
                                ...(panelConfig.options.layout?.padding || {}),
                                right: 4,
                            },
                        };
                        chartRefs.current.push(new Chart(canvas, panelConfig));
                    }

                    gridEl.appendChild(rowEl);
                }
                host.appendChild(gridEl);

                if (useLegendCol) {
                    const legendEl = document.createElement('div');
                    legendEl.style.width = `${LEGEND_COL_W}px`;
                    legendEl.style.minWidth = `${LEGEND_COL_W}px`;
                    legendEl.style.fontSize = '10px';
                    legendEl.style.lineHeight = '1.3';
                    legendEl.style.color = '#555';
                    legendEl.style.paddingTop = '4px';
                    for (const item of legendItems) {
                        const itemEl = document.createElement('div');
                        itemEl.style.display = 'flex';
                        itemEl.style.alignItems = 'center';
                        itemEl.style.gap = '4px';
                        itemEl.style.marginBottom = '4px';
                        const swatch = document.createElement('span');
                        swatch.style.display = 'inline-block';
                        swatch.style.width = '8px';
                        swatch.style.height = '8px';
                        swatch.style.border = '1px solid #999';
                        swatch.style.background = item.color || '#666';
                        const text = document.createElement('span');
                        text.textContent = item.label;
                        text.style.whiteSpace = 'nowrap';
                        text.style.overflow = 'hidden';
                        text.style.textOverflow = 'ellipsis';
                        itemEl.appendChild(swatch);
                        itemEl.appendChild(text);
                        legendEl.appendChild(itemEl);
                    }
                    host.appendChild(legendEl);
                }
            } else {
                const w = cjsConfig._width || 400;
                const h = cjsConfig._height || 300;
                const canvasWrap = document.createElement('div');
                canvasWrap.style.position = 'relative';
                canvasWrap.style.width = `${w}px`;
                canvasWrap.style.height = `${h}px`;
                const canvas = document.createElement('canvas');
                canvasWrap.appendChild(canvas);
                host.appendChild(canvasWrap);

                const cleanConfig = { ...cjsConfig };
                delete cleanConfig._warnings;
                delete cleanConfig._dataLength;
                delete cleanConfig._width;
                delete cleanConfig._height;
                delete cleanConfig._facet;
                delete cleanConfig._facetPanels;
                delete cleanConfig._facetSharedYDomain;
                if (!cleanConfig.options) cleanConfig.options = {};
                cleanConfig.options.animation = false;
                cleanConfig.options.responsive = true;
                cleanConfig.options.maintainAspectRatio = false;
                chartRefs.current.push(new Chart(canvas, cleanConfig));
            }

            setError(null);
        } catch (err: any) {
            setError(`Chart.js error: ${err.message}`);
        }

        return () => {
            for (const c of chartRefs.current) c.destroy();
            chartRefs.current = [];
        };
    }, [testCase, canvasSize]);

    const body = (
        <>
            {!standalone && (
                <Typography variant="caption" fontWeight={600} color="#2e7d32"
                    sx={{ display: 'block', mb: 0.5, fontSize: 11, letterSpacing: 0.5 }}>
                    Chart.js
                </Typography>
            )}
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
                <>
                    {standalone && (
                        <SpecDisclosure label="Flint Spec" content={sharedSpec.compact} variant="input" />
                    )}
                    <SpecDisclosure label="Chart.js Config" content={specJson} variant="chartjs" dense={standalone} />
                </>
            )}
        </>
    );
    if (standalone) {
        return <StandaloneChartCard testCase={testCase} error={error}>{body}</StandaloneChartCard>;
    }
    return <Box sx={{ width: 'fit-content' }}>{body}</Box>;
});

// ============================================================================
// Triple Render: VL + ECharts + Chart.js side-by-side
// ============================================================================

const TripleChart: React.FC<{ testCase: TestCase }> = React.memo(({ testCase }) => {
    const sharedSpec = useMemo(() => buildSharedInputSpec(testCase), [testCase]);
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2, mb: 2, maxWidth: 900,
                bgcolor: '#ffffff',
                border: '1px solid #eeeeee',
                borderRadius: 1,
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
            <Box sx={{ mb: 1.5 }}>
                <SpecDisclosure label="Flint Spec" content={sharedSpec.compact} variant="input" maxHeight={260} />
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

const GoFishChart: React.FC<{ testCase: TestCase; canvasSize?: { width: number; height: number }; standalone?: boolean }> = React.memo(({ testCase, canvasSize = DEFAULT_CANVAS_SIZE, standalone = false }) => {
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

    const body = (
        <>
            {!standalone && (
                <Typography variant="caption" fontWeight={600} color="#6a1b9a"
                    sx={{ display: 'block', mb: 0.5, fontSize: 11, letterSpacing: 0.5 }}>
                    GoFish
                </Typography>
            )}
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
                <SpecDisclosure label="GoFish Spec" content={specDescription} variant="gofish" />
            )}
        </>
    );
    if (standalone) {
        return <StandaloneChartCard testCase={testCase} error={error}>{body}</StandaloneChartCard>;
    }
    return <Box sx={{ width: 'fit-content' }}>{body}</Box>;
});

// ============================================================================
// Quad Render: VL + GoFish side-by-side (for GoFish backend tests)
// ============================================================================

const QuadChart: React.FC<{ testCase: TestCase }> = React.memo(({ testCase }) => {
    const sharedSpec = useMemo(() => buildSharedInputSpec(testCase), [testCase]);
    return (
        <Paper
            elevation={0}
            sx={{
                p: 2, mb: 2, maxWidth: 800,
                bgcolor: '#ffffff',
                border: '1px solid #eeeeee',
                borderRadius: 1,
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
            <Box sx={{ mb: 1.5 }}>
                <SpecDisclosure label="Flint Spec" content={sharedSpec.compact} variant="input" maxHeight={260} />
            </Box>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                <VegaChartInline testCase={testCase} canvasSize={{ width: 300, height: 250 }} />
                <GoFishChart testCase={testCase} canvasSize={{ width: 300, height: 250 }} />
            </Box>
        </Paper>
    );
});

// ============================================================================
// Omni game-ops dataset: tabular preview (raw rows)
// ============================================================================

const OmniGameDatasetTablePreview: React.FC = () => {
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    const rows = OMNI_VIZ_ROWS;
    const stats = useMemo(() => {
        let minNu = Infinity;
        let maxNu = -Infinity;
        for (const r of rows) {
            if (r.newUsers < minNu) minNu = r.newUsers;
            if (r.newUsers > maxNu) maxNu = r.newUsers;
        }
        return {
            n: rows.length,
            minNu,
            maxNu,
            games: OMNI_VIZ_LEVELS.games.length,
            types: OMNI_VIZ_LEVELS.gameTypes.length,
        };
    }, [rows]);

    const handleChangePage = (_: unknown, newPage: number) => {
        setPage(newPage);
    };
    const handleChangeRowsPerPage = (e: React.ChangeEvent<HTMLInputElement>) => {
        setRowsPerPage(parseInt(e.target.value, 10));
        setPage(0);
    };

    const slice = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

    return (
        <Paper elevation={1} sx={{ p: 2, m: 2, maxWidth: 1100 }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Omni Game Metrics - Detailed Data
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
                Fields: <strong>period</strong> (YearMonth, 2025-01...12), <strong>game</strong> (24 titles),
                <strong>gameType</strong> (6 categories), <strong>newUsers</strong> (monthly net adds, may be negative),
                <strong>totalUsers</strong> (end-of-month MAU stock), <strong>region</strong> (N / E / S / W).
                Granularity: one row per game x region x month ({stats.n} rows total).
                The charts below follow three phases: overview (Line + regional Grouped Bar), change (Waterfall + Heatmap),
                and composition (Sunburst, primarily ECharts).
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                <Chip size="small" label={`Games ${stats.games}`} variant="outlined" />
                <Chip size="small" label={`GameType ${stats.types}`} variant="outlined" />
                <Chip size="small" label={`newUsers range ${stats.minNu} ... ${stats.maxNu}`} variant="outlined" />
            </Box>
            <TableContainer sx={{ maxHeight: 520, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            <TableCell>period</TableCell>
                            <TableCell>game</TableCell>
                            <TableCell>gameType</TableCell>
                            <TableCell align="right">newUsers</TableCell>
                            <TableCell align="right">totalUsers</TableCell>
                            <TableCell>region</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {slice.map((r, i) => (
                            <TableRow key={`${r.period}-${r.game}-${r.region}-${i}`} hover>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.period}</TableCell>
                                <TableCell>{r.game}</TableCell>
                                <TableCell sx={{ maxWidth: 160 }}>{r.gameType}</TableCell>
                                <TableCell align="right" sx={{ color: r.newUsers < 0 ? 'error.main' : 'inherit' }}>
                                    {r.newUsers.toLocaleString()}
                                </TableCell>
                                <TableCell align="right">{r.totalUsers.toLocaleString()}</TableCell>
                                <TableCell>{r.region}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
            <TablePagination
                component="div"
                count={rows.length}
                page={page}
                onPageChange={handleChangePage}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={handleChangeRowsPerPage}
                rowsPerPageOptions={[10, 25, 50, 100]}
                labelRowsPerPage="Rows per page"
            />
        </Paper>
    );
};

// ============================================================================
// Page body — renders a GalleryPage according to its `render` kind
// ============================================================================

const GalleryPageBody: React.FC<{ page: GalleryPage }> = ({ page }) => {
    const tests = useMemo(() => {
        const out: TestCase[] = [];
        for (const key of page.generatorKeys) {
            const gen = TEST_GENERATORS[key];
            if (gen) out.push(...gen());
        }
        return out;
    }, [page.generatorKeys]);

    if (page.render === 'static') {
        return <StaticPage pageId={page.staticPageId ?? page.id} />;
    }

    if (page.render === 'table') {
        return (
            <Box sx={{ p: 2 }}>
                <OmniGameDatasetTablePreview />
            </Box>
        );
    }

    if (tests.length === 0) {
        return (
            <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">
                    No test cases defined for "{page.label}"
                </Typography>
            </Box>
        );
    }

    const renderOne = (tc: TestCase, i: number) => {
        const key = `${page.id}-${i}`;
        switch (page.render) {
            case 'dual':   return <DualChart key={key} testCase={tc} />;
            case 'triple': return <TripleChart key={key} testCase={tc} />;
            case 'quad':   return <QuadChart key={key} testCase={tc} />;
            case 'single':
            default:
                switch (page.library) {
                    case 'echarts':  return <EChartsChart key={key} testCase={tc} standalone />;
                    case 'chartjs':  return <ChartJsChart key={key} testCase={tc} standalone />;
                    case 'gofish':   return <GoFishChart key={key} testCase={tc} standalone />;
                    case 'vegalite':
                    default:         return <VegaChart key={key} testCase={tc} />;
                }
        }
    };

    return (
        <Box sx={{ p: 2, pb: 8, display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'flex-start' }}>
            {tests.map(renderOne)}
        </Box>
    );
};

// ============================================================================
// Static overview pages (home + one per language)
// ============================================================================

const StaticPage: React.FC<{ pageId: string }> = ({ pageId }) => {
    if (pageId === 'home') {
        return <HomeOverview />;
    }
    return (
        <Box sx={{ p: 4 }}>
            <Typography color="text.secondary">Unknown overview: {pageId}</Typography>
        </Box>
    );
};

/** Short labels (used in EC/CJS chart-type pages) to canonical CHART_ICONS keys. */
const CHART_ICON_ALIAS: Record<string, string> = {
    'Scatter':     'Scatter Plot',
    'Bar':         'Bar Chart',
    'Stacked Bar': 'Stacked Bar Chart',
    'Grouped Bar': 'Grouped Bar Chart',
    'Line':        'Line Chart',
    'Area':        'Area Chart',
    'Pie':         'Pie Chart',
    'Rose':        'Rose Chart',
    'Radar':       'Radar Chart',
    'Bump':        'Bump Chart',
    'Pyramid':     'Pyramid Chart',
    'Candlestick': 'Candlestick Chart',
    'Waterfall':   'Waterfall Chart',
    'Dotted Line': 'Dotted Line Chart',
    'Ranged Dot':  'Ranged Dot Plot',
    'Density':     'Density Plot',
    'Strip':       'Strip Plot',
};
function chartIconFor(label: string): React.ReactElement {
    const hit = CHART_ICONS[label] ?? CHART_ICONS[CHART_ICON_ALIAS[label] ?? ''];
    if (hit) return hit;
    return <QuestionMarkIcon sx={{ fontSize: 12, color: 'text.disabled' }} />;
}

const HomeOverview: React.FC = () => {
    const sections = GALLERY_TREE.filter(s => s.id !== 'overview');
    return (
        <Box sx={{ p: 4, maxWidth: 1000 }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>Flint Gallery</Typography>
            <Typography variant="body1" color="text.secondary" paragraph>
                <strong>Flint</strong> is the intermediate visualization language used across
                Data Formulator. A single Flint spec compiles to multiple rendering backends —
                Vega-Lite, ECharts, Chart.js, and GoFish — so agents can pick the one that
                best fits each chart. This page demonstrates the expressiveness of those
                backends: each backend section shows its native chart types, and the
                cross-cutting Features, Backend Comparison, and Demo Scenarios sections
                illustrate how shared Flint concepts render across libraries.
            </Typography>
            {sections.map(section => (
                <Box key={section.id} sx={{ mt: 4 }}>
                    <Typography variant="subtitle1" fontWeight={700}>{section.label}</Typography>
                    {section.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {section.description}
                        </Typography>
                    )}
                    {section.categories.map(cat => {
                        const singleCat = section.categories.length === 1;
                        const isChartTypes = cat.id === 'chart-types';
                        return (
                            <Box key={cat.id} sx={{ mt: singleCat ? 1 : 2 }}>
                                {!singleCat && (
                                    <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                                        {cat.label}
                                    </Typography>
                                )}
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.75 }}>
                                    {cat.pages.map(page => {
                                        const icon = isChartTypes ? chartIconFor(page.label) : null;
                                        return (
                                            <Chip
                                                key={page.id}
                                                size="small"
                                                component="a"
                                                href={`#/${section.id}/${cat.id}/${page.id}`}
                                                clickable
                                                variant="outlined"
                                                label={page.label}
                                                icon={icon ? (
                                                    <Box sx={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', ml: '4px', opacity: 0.85 }}>
                                                        {icon}
                                                    </Box>
                                                ) : undefined}
                                            />
                                        );
                                    })}
                                </Box>
                            </Box>
                        );
                    })}
                </Box>
            ))}
        </Box>
    );
};

// ============================================================================
// Hash-based routing
// ============================================================================

function parseHash(hash: string): GalleryPath | null {
    // Accept "#/a/b/c", "#a/b/c", "/a/b/c", "a/b/c"
    const clean = hash.replace(/^#\/?/, '').replace(/^\//, '');
    if (!clean) return null;
    const parts = clean.split('/');
    if (parts.length !== 3) return null;
    const found = findPage(parts as unknown as GalleryPath);
    if (!found) return null;
    return [parts[0], parts[1], parts[2]] as const;
}

function pathToHash(path: GalleryPath): string {
    return `#/${path.join('/')}`;
}

function useHashRoute(): [GalleryPath, (p: GalleryPath) => void] {
    const [path, setPath] = useState<GalleryPath>(() => {
        return parseHash(window.location.hash) ?? DEFAULT_PATH;
    });
    useEffect(() => {
        const onHash = () => {
            const p = parseHash(window.location.hash);
            if (p) setPath(p);
        };
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);
    const navigate = (p: GalleryPath) => {
        const hash = pathToHash(p);
        if (window.location.hash !== hash) {
            window.location.hash = hash;
        }
        setPath(p);
    };
    return [path, navigate];
}

// ============================================================================
// Main Page
// ============================================================================

const ChartGallery: React.FC = () => {
    const [path, navigate] = useHashRoute();
    const [expanded, setExpanded] = useState<string[]>(() => ancestorsOf(path));

    // When the path changes (e.g. via deep link), make sure ancestors are expanded.
    useEffect(() => {
        setExpanded(prev => {
            const needed = ancestorsOf(path);
            const missing = needed.filter(id => !prev.includes(id));
            return missing.length ? [...prev, ...missing] : prev;
        });
    }, [path]);

    const resolved = useMemo(() => findPage(path), [path]);

    return (
        <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
            <GallerySidebar
                selected={path}
                expanded={expanded}
                onSelect={(p) => {
                    // If user clicked a section/category node, its itemId resolves
                    // to a 3-part path only for leaf pages; parents are handled by
                    // the tree widget's own expand/collapse.
                    navigate(p);
                }}
                onExpandedChange={setExpanded}
            />
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {resolved && <Breadcrumb path={path} />}
                <Box sx={{ flex: 1, overflow: 'auto', bgcolor: '#fafafa' }}>
                    {resolved ? (
                        <GalleryPageBody page={resolved.page} />
                    ) : (
                        <Box sx={{ p: 4 }}>
                            <Typography color="text.secondary">
                                Page not found. <a href={pathToHash(DEFAULT_PATH)}>Go home →</a>
                            </Typography>
                        </Box>
                    )}
                </Box>
            </Box>
        </Box>
    );
};

const Breadcrumb: React.FC<{ path: GalleryPath }> = ({ path }) => {
    const resolved = findPage(path);
    if (!resolved) return null;
    const { section, category, page } = resolved;
    const crumbSx = { fontSize: 12, color: 'text.secondary', textDecoration: 'none', cursor: 'pointer' };
    const sep = <Typography component="span" sx={{ mx: 0.75, color: 'text.disabled', fontSize: 12 }}>›</Typography>;
    return (
        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
            <Typography component="a" href={pathToHash(DEFAULT_PATH)} sx={crumbSx}>Gallery</Typography>
            {sep}
            <Typography component="span" sx={crumbSx}>{section.label}</Typography>
            {section.categories.length > 1 && <>
                {sep}
                <Typography component="span" sx={crumbSx}>{category.label}</Typography>
            </>}
            {sep}
            <Typography component="span" sx={{ fontSize: 12, color: 'text.primary', fontWeight: 500 }}>
                {page.label}
            </Typography>
        </Box>
    );
};

export default ChartGallery;
