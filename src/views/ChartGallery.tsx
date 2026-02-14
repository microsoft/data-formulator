// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ChartGallery — Visual gallery for Vega-Lite chart assembly.
 *
 * All synthetic test-data generators and types live in
 * `src/lib/agents-chart/test-data/`. This file contains only the
 * React components that render the gallery UI.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
    Box, Tabs, Tab, Typography, Paper, Chip,
} from '@mui/material';
import embed from 'vega-embed';
import { assembleVegaChart } from '../app/utils';
import { Channel, EncodingItem } from '../components/ComponentType';
import { channels } from '../components/ChartTemplates';
import { ChartWarning } from '../lib/agents-chart';
import { TestCase, TEST_GENERATORS, GALLERY_SECTIONS } from '../lib/agents-chart/test-data';

// ============================================================================
// Chart Rendering Component
// ============================================================================

const VegaChart: React.FC<{ testCase: TestCase }> = React.memo(({ testCase }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [specJson, setSpecJson] = useState<string>('');
    const [warnings, setWarnings] = useState<ChartWarning[]>([]);
    const [specOptions, setSpecOptions] = useState<string>('');

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
                p: 2, mb: 2, width: 'fit-content', minWidth: 400, maxWidth: '100%',
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
// Sub-page for a single chart type
// ============================================================================

const ChartTypeTestPanel: React.FC<{ chartGroup: string }> = ({ chartGroup }) => {
    const tests = useMemo(() => {
        const gen = TEST_GENERATORS[chartGroup];
        return gen ? gen() : [];
    }, [chartGroup]);

    if (tests.length === 0) {
        return (
            <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">No test cases defined for "{chartGroup}"</Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 2, display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'flex-start' }}>
            {tests.map((tc, i) => (
                <VegaChart key={`${chartGroup}-${i}`} testCase={tc} />
            ))}
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
