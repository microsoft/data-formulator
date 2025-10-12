// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useRef, useEffect, memo, useMemo } from 'react';
import {
    Box,
    Button,
    Typography,
    Checkbox,
    IconButton,
    Card,
    CardContent,
    CircularProgress,
    Alert,
    Link,
    Divider,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    useTheme,
    alpha,
} from '@mui/material';
import Masonry from '@mui/lab/Masonry';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { useSelector } from 'react-redux';
import { DataFormulatorState } from '../app/dfSlice';
import { getUrls, assembleVegaChart, getTriggers, prepVisTable } from '../app/utils';
import { MuiMarkdown, getOverrides } from 'mui-markdown';
import embed from 'vega-embed';
import { getDataTable } from './VisualizationView';
import { DictTable } from '../components/ComponentType';

// Typography constants
const FONT_FAMILY_SYSTEM = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"';
const FONT_FAMILY_SERIF = 'Georgia, Cambria, "Times New Roman", Times, serif';
const FONT_FAMILY_MONO = '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

// Color constants
const COLOR_HEADING = 'rgb(37, 37, 37)';
const COLOR_BODY = 'rgb(55, 53, 47)';
const COLOR_MUTED = 'rgb(73, 73, 73)';
const COLOR_BG_LIGHT = 'rgba(247, 246, 243, 1)';

// Social post style constants (Twitter/X style)
const COLOR_SOCIAL_TEXT = 'rgb(15, 20, 25)';
const COLOR_SOCIAL_BORDER = 'rgb(207, 217, 222)';
const COLOR_SOCIAL_ACCENT = 'rgb(29, 155, 240)';

// Common style patterns
const COMMON_STYLES = {
    flexColumn: { display: 'flex', flexDirection: 'column' },
    positionAbsolute: { position: 'absolute' },
    border: { border: '1px solid', borderColor: 'divider' },
    borderRadius: { borderRadius: '4px' },
    borderRadiusLarge: { borderRadius: '16px' },
    padding: { p: 2 },
    textEllipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    textNoTransform: { textTransform: 'none' },
    fontSystem: { fontFamily: FONT_FAMILY_SYSTEM },
    fontWeight600: { fontWeight: 600 },
    fontWeight700: { fontWeight: 700 },
} as const;

const HEADING_BASE = {
    ...COMMON_STYLES.fontSystem,
    color: COLOR_HEADING,
    fontWeight: 700,
    letterSpacing: '-0.01em',
};

const BODY_TEXT_BASE = {
    ...COMMON_STYLES.fontSystem,
    fontSize: '1rem',
    lineHeight: 1.75,
    fontWeight: 400,
    letterSpacing: '0.003em',
    color: COLOR_BODY,
};

const TABLE_CELL_BASE = {
    ...COMMON_STYLES.fontSystem,
    fontSize: '0.95rem',
    py: 1.5,
    px: 2,
};

// Notion-style markdown overrides with MUI components
const notionStyleMarkdownOverrides = {
    ...getOverrides(),
    h1: { component: Typography, props: { variant: 'h4', gutterBottom: true, 
        sx: { ...HEADING_BASE, fontSize: '2rem', lineHeight: 1.25, letterSpacing: '-0.02em', pb: 0.5, mb: 3, mt: 4 } } },
    h2: { component: Typography, props: { variant: 'h5', gutterBottom: true,
        sx: { ...HEADING_BASE, fontSize: '1.625rem', lineHeight: 1.3, pb: 0.5, mb: 2.5, mt: 3.5 } } },
    h3: { component: Typography, props: { variant: 'h6', gutterBottom: true,
        sx: { ...HEADING_BASE, fontWeight: 600, fontSize: '1.375rem', lineHeight: 1.4, letterSpacing: '-0.005em', mb: 2, mt: 3 } } },
    h4: { component: Typography, props: { variant: 'h6', gutterBottom: true,
        sx: { ...HEADING_BASE, fontWeight: 600, fontSize: '1.25rem', lineHeight: 1.4, mb: 1.5, mt: 2.5 } } },
    h5: { component: Typography, props: { variant: 'subtitle1', gutterBottom: true,
        sx: { ...HEADING_BASE, fontWeight: 600, fontSize: '1.125rem', lineHeight: 1.5, mb: 1.5, mt: 2 } } },
    h6: { component: Typography, props: { variant: 'subtitle2', gutterBottom: true,
        sx: { ...HEADING_BASE, fontWeight: 600, fontSize: '1rem', lineHeight: 1.5, mb: 1.5, mt: 2 } } },
    p: { component: Typography, props: { variant: 'body2', paragraph: true,
        sx: { ...BODY_TEXT_BASE, mb: 1.75 } } },
    a: { component: Link, props: { underline: 'hover' as const, color: 'primary' as const, 
        sx: { fontSize: 'inherit', fontWeight: 500 } } },
    ul: { component: 'ul', props: { style: { 
        paddingLeft: '1.8em', marginTop: '0.75em', marginBottom: '1.5em', fontFamily: FONT_FAMILY_SYSTEM
    } } },
    ol: { component: 'ol', props: { style: { 
        paddingLeft: '1.8em', marginTop: '0.75em', marginBottom: '1.5em', fontFamily: FONT_FAMILY_SYSTEM
    } } },
    li: { component: Typography, props: { component: 'li', variant: 'body1',
        sx: { ...BODY_TEXT_BASE, mb: 0.5 } } },
    blockquote: { component: Box, props: { sx: { 
        borderLeft: '3px solid', borderColor: 'rgba(0, 0, 0, 0.15)', pl: 2.5, py: 1, my: 2.5,
        fontFamily: FONT_FAMILY_SERIF, fontStyle: 'italic', color: COLOR_MUTED, fontSize: '1.125rem', lineHeight: 1.7 
    } } },
    pre: { component: Paper, props: { elevation: 0, sx: { 
        backgroundColor: COLOR_BG_LIGHT, p: 2, ...COMMON_STYLES.borderRadius, overflow: 'auto', my: 2, 
        ...COMMON_STYLES.border, borderColor: 'rgba(0, 0, 0, 0.08)',
        '& code': { 
            backgroundColor: 'transparent !important', padding: '0 !important', fontSize: '0.875rem',
            fontFamily: FONT_FAMILY_MONO, lineHeight: 1.7, color: COLOR_BODY
        } 
    } } },
    table: { component: TableContainer, props: { component: Paper, elevation: 0,
        sx: { my: 2, ...COMMON_STYLES.border } } },
    thead: { component: TableHead, props: { sx: { backgroundColor: COLOR_BG_LIGHT } } },
    tbody: { component: TableBody },
    tr: { component: TableRow },
    th: { component: TableCell, props: { sx: { 
        ...TABLE_CELL_BASE, fontWeight: 600, borderBottom: '2px solid', borderColor: 'divider'
    } } },
    td: { component: TableCell, props: { sx: { 
        ...TABLE_CELL_BASE, borderBottom: '1px solid', borderColor: 'divider', lineHeight: 1.6 
    } } },
    hr: { component: Divider, props: { sx: { my: 3 } } }
} as any;

// Social post style markdown overrides (more compact styling)
const socialStyleMarkdownOverrides = {
    ...notionStyleMarkdownOverrides,
    h1: { component: Typography, props: { variant: 'h5', gutterBottom: true, 
        sx: { ...COMMON_STYLES.fontSystem, ...COMMON_STYLES.fontWeight700, fontSize: '1.375rem', 
            lineHeight: 1.3, color: COLOR_SOCIAL_TEXT, mb: 2, mt: 2 } } },
    h2: { component: Typography, props: { variant: 'h6', gutterBottom: true,
        sx: { ...COMMON_STYLES.fontSystem, ...COMMON_STYLES.fontWeight700, fontSize: '1.25rem', 
            lineHeight: 1.3, color: COLOR_SOCIAL_TEXT, mb: 1.5, mt: 2 } } },
    h3: { component: Typography, props: { variant: 'h6', gutterBottom: true,
        sx: { ...COMMON_STYLES.fontSystem, ...COMMON_STYLES.fontWeight600, fontSize: '1.125rem', 
            lineHeight: 1.4, color: COLOR_SOCIAL_TEXT, mb: 1.5, mt: 1.5 } } },
    p: { component: Typography, props: { variant: 'body1', paragraph: true,
        sx: { ...COMMON_STYLES.fontSystem, fontSize: '0.9375rem', lineHeight: 1.5, 
            fontWeight: 400, mb: 1, color: COLOR_SOCIAL_TEXT } } },
    li: { component: Typography, props: { component: 'li', variant: 'body1',
        sx: { ...COMMON_STYLES.fontSystem, fontSize: '0.9375rem', lineHeight: 1.5, 
            fontWeight: 400, mb: 0.5, color: COLOR_SOCIAL_TEXT } } }
} as any;

export const ReportView: FC = () => {
    const [selectedChartIds, setSelectedChartIds] = useState<Set<string>>(new Set());
    const [generatedReport, setGeneratedReport] = useState<string>('');
    const [generatedStyle, setGeneratedStyle] = useState<string>('blog');
    const [chartImages, setChartImages] = useState<Map<string, { url: string; width: number; height: number }>>(new Map());
    const [previewImages, setPreviewImages] = useState<Map<string, { url: string; width: number; height: number }>>(new Map());
    const [isLoadingPreviews, setIsLoadingPreviews] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string>('');
    const [style, setStyle] = useState<string>('blog');
    const [mode, setMode] = useState<'compose' | 'post'>('compose');

    const charts = useSelector((state: DataFormulatorState) => state.charts);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const modelSlot = useSelector((state: DataFormulatorState) => state.modelSlots);
    const models = useSelector((state: DataFormulatorState) => state.models);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const config = useSelector((state: DataFormulatorState) => state.config);
    const theme = useTheme();
    // Sort charts based on data thread ordering
    const sortedCharts = useMemo(() => {
        // Create table order mapping (anchored tables get higher order)
        const tableOrder = Object.fromEntries(
            tables.map((table, index) => [
                table.id, 
                index + (table.anchored ? 1 : 0) * tables.length
            ])
        );
        
        // Get ancestor orders for a table
        const getAncestorOrders = (table: DictTable): number[] => {
            const triggers = getTriggers(table, tables);
            return [...triggers.map(t => tableOrder[t.tableId]), tableOrder[table.id]];
        };
        
        // Sort charts by their associated table's ancestor orders
        return [...charts].sort((chartA, chartB) => {
            const tableA = getDataTable(chartA, tables, charts, conceptShelfItems);
            const tableB = getDataTable(chartB, tables, charts, conceptShelfItems);
            
            const ordersA = getAncestorOrders(tableA);
            const ordersB = getAncestorOrders(tableB);
            
            // Compare orders element by element
            for (let i = 0; i < Math.min(ordersA.length, ordersB.length); i++) {
                if (ordersA[i] !== ordersB[i]) {
                    return ordersA[i] - ordersB[i];
                }
            }
            
            // If all orders are equal, compare by length
            return ordersA.length - ordersB.length;
        });
    }, [charts, tables, conceptShelfItems]);

    // Clean up Blob URLs on unmount
    useEffect(() => {
        return () => {
            chartImages.forEach(({ url }) => {
                if (url.startsWith('blob:')) {
                    URL.revokeObjectURL(url);
                }
            });
            previewImages.forEach(({ url }) => {
                if (url.startsWith('blob:')) {
                    URL.revokeObjectURL(url);
                }
            });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only cleanup on unmount, not when images change

    // Generate preview images for all charts
    useEffect(() => {
        const generatePreviews = async () => {
            setIsLoadingPreviews(true);
            const newPreviewImages = new Map<string, { url: string; width: number; height: number }>();

            // Clean up old preview images
            previewImages.forEach(({ url }) => {
                if (url.startsWith('blob:')) {
                    URL.revokeObjectURL(url);
                }
            });

            await Promise.all(
                sortedCharts.map(async (chart) => {
                    try {
                        const chartTable = tables.find(t => t.id === chart.tableRef);
                        if (!chartTable || chart.chartType === 'Table' || chart.chartType === '?' || chart.chartType === 'Auto') {
                            return;
                        }

                        const { blobUrl, width, height } = await getChartImageFromVega(chart, chartTable);
                        if (blobUrl) {
                            newPreviewImages.set(chart.id, { url: blobUrl, width, height });
                        }
                    } catch (error) {
                        console.warn(`Failed to generate preview for chart ${chart.id}:`, error);
                    }
                })
            );

            setPreviewImages(newPreviewImages);
            setIsLoadingPreviews(false);
        };

        if (sortedCharts.length > 0) {
            generatePreviews();
        }
    }, [sortedCharts, tables, conceptShelfItems, config]);

    const toggleChartSelection = (chartId: string) => {
        const newSelection = new Set(selectedChartIds);
        if (newSelection.has(chartId)) {
            newSelection.delete(chartId);
        } else {
            newSelection.add(chartId);
        }
        setSelectedChartIds(newSelection);
    };

    const selectAll = () => {
        // Only select available charts (excluding Table, ?, Auto, and charts without preview images)
        const availableChartIds = sortedCharts
            .filter(chart => {
                const isUnavailable = chart.chartType === 'Table' || 
                                      chart.chartType === '?' || 
                                      chart.chartType === 'Auto';
                const hasPreview = previewImages.has(chart.id);
                return !isUnavailable && hasPreview;
            })
            .map(c => c.id);
        setSelectedChartIds(new Set(availableChartIds));
    };

    const deselectAll = () => {
        setSelectedChartIds(new Set());
    };

    const getChartImageFromVega = async (chart: any, chartTable: any): Promise<{ dataUrl: string; blobUrl: string; width: number; height: number }> => {
        try {
            // Preprocess the data for aggregations
            const processedRows = prepVisTable(chartTable.rows, conceptShelfItems, chart.encodingMap);
            
            // Assemble the Vega spec
            const assembledChart = assembleVegaChart(
                chart.chartType,
                chart.encodingMap,
                conceptShelfItems,
                processedRows,
                chartTable.metadata,
                30,
                true,
                config.defaultChartWidth,
                config.defaultChartHeight
            );

            // Create a temporary container for embedding
            const tempId = `temp-chart-${chart.id}-${Date.now()}`;
            const tempDiv = document.createElement('div');
            tempDiv.id = tempId;
            tempDiv.style.position = 'absolute';
            tempDiv.style.left = '-9999px';
            document.body.appendChild(tempDiv);

            try {
                // Embed the chart
                const result = await embed(`#${tempId}`, assembledChart, { 
                    actions: false,
                    renderer: 'svg'
                });

                // Export to SVG with high resolution
                const svgString = await result.view.toSVG(4);
                
                // Parse SVG to get original dimensions
                const parser = new DOMParser();
                const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
                const svgElement = svgDoc.querySelector('svg');
                
                if (!svgElement) {
                    throw new Error('Could not parse SVG');
                }
                
                // Get original dimensions
                const originalWidth = parseFloat(svgElement.getAttribute('width') || '0');
                const originalHeight = parseFloat(svgElement.getAttribute('height') || '0');
                
                // Convert SVG to PNG using canvas
                const { dataUrl, blobUrl } = await new Promise<{ dataUrl: string; blobUrl: string }>((resolve, reject) => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('Could not get canvas context'));
                        return;
                    }

                    const img = new Image();
                    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
                    const svgUrl = URL.createObjectURL(svgBlob);

                    img.onload = () => {
                        canvas.width = img.width;
                        canvas.height = img.height;
                        ctx.drawImage(img, 0, 0);
                        URL.revokeObjectURL(svgUrl);
                        
                        const dataUrl = canvas.toDataURL('image/png');
                        
                        canvas.toBlob((blob) => {
                            if (blob) {
                                const blobUrl = URL.createObjectURL(blob);
                                resolve({ dataUrl, blobUrl });
                            } else {
                                resolve({ dataUrl, blobUrl: '' });
                            }
                        }, 'image/png');
                    };

                    img.onerror = (err) => {
                        URL.revokeObjectURL(svgUrl);
                        reject(err);
                    };

                    img.src = svgUrl;
                });

                document.body.removeChild(tempDiv);

                return { dataUrl, blobUrl, width: originalWidth, height: originalHeight };
            } catch (error) {
                if (document.body.contains(tempDiv)) {
                    document.body.removeChild(tempDiv);
                }
                throw error;
            }
        } catch (e) {
            console.warn('Could not capture chart image:', e);
            return { dataUrl: '', blobUrl: '', width: 0, height: 0 };
        }
    };

    const generateReport = async () => {
        if (selectedChartIds.size === 0) {
            setError('Please select at least one chart');
            return;
        }

        setIsGenerating(true);
        setError('');
        setGeneratedReport('');
        setGeneratedStyle(style);


        try {
            const model = models.find(m => m.id === modelSlot.generation);
            if (!model) {
                throw new Error('No model selected');
            }

            const inputTables = tables.filter(t => t.anchored).map(table => ({
                name: table.id,
                rows: table.rows
            }));

            const newChartImages = new Map<string, { url: string; width: number; height: number }>();

            const selectedCharts = await Promise.all(
                sortedCharts
                    .filter(chart => selectedChartIds.has(chart.id))
                    .map(async (chart) => {

                    const chartTable = tables.find(t => t.id === chart.tableRef);
                    if (!chartTable) return null;

                    if (chart.chartType === 'Table' || chart.chartType === '?') {
                        return null;
                    }

                    const { dataUrl, blobUrl, width, height } = await getChartImageFromVega(chart, chartTable);

                    if (blobUrl) {
                        newChartImages.set(chart.id, { url: blobUrl, width, height });
                    }

                    return {
                        chart_id: chart.id,
                        code: chartTable.derive?.code || '',
                        chart_data: {
                            name: chartTable.id,
                            rows: chartTable.rows
                        },
                        chart_url: dataUrl
                    };
                })
            );

            const validCharts = selectedCharts.filter(c => c !== null);

            setChartImages(newChartImages);

            const requestBody = {
                model: model,
                input_tables: inputTables,
                charts: validCharts,
                style: style,
                language: tables.some(t => t.virtual) ? "sql" : "python"
            };

            const response = await fetch(getUrls().GENERATE_REPORT_STREAM, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error('Failed to generate report');
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body');
            }

            const decoder = new TextDecoder();
            let accumulatedReport = '';

            const processReport = (rawReport: string): string => {
                const markdownMatch = rawReport.match(/```markdown\n([\s\S]*?)(?:\n```)?$/);
                let processed = markdownMatch ? markdownMatch[1] : rawReport;
                
                newChartImages.forEach(({ url, width, height }, chartId) => {
                    processed = processed.replace(
                        new RegExp(`\\[IMAGE\\(${chartId}\\)\\]`, 'g'),
                        `<img src="${url}" alt="Chart" width="${width}" height="${height}" />`
                    );
                });
                
                return processed;
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                
                if (chunk.startsWith('error:')) {
                    const errorData = JSON.parse(chunk.substring(6));
                    throw new Error(errorData.content || 'Error generating report');
                }

                accumulatedReport += chunk;

                const processedReport = processReport(accumulatedReport);
                setGeneratedReport(processedReport);
                if (mode === 'compose') {
                    setMode('post');
                }
            }

        } catch (err) {
            setError((err as Error).message || 'Failed to generate report');
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <Box sx={{ height: '100%', width: '100%', ...COMMON_STYLES.flexColumn, overflow: 'hidden' }}>
            {mode === 'compose' ? (
                <Box sx={{  overflowY: 'auto'}}>
                    <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Typography variant="body2">
                                Compose a
                            </Typography>
                            <ToggleButtonGroup
                                value={style}
                                exclusive
                                onChange={(e, newStyle) => newStyle && setStyle(newStyle)}
                                size="small"
                                sx={{ 
                                    '& .MuiToggleButtonGroup-grouped': {
                                        border: '1px solid',
                                        borderColor: 'divider',
                                        '&:not(:first-of-type)': {
                                            marginLeft: '-1px',
                                            borderLeft: '1px solid',
                                            borderLeftColor: 'divider',
                                        },
                                        '&.Mui-selected': {
                                            backgroundColor: 'primary.main',
                                            color: 'white',
                                            borderColor: 'primary.main',
                                            zIndex: 1,
                                            '&:hover': {
                                                backgroundColor: 'primary.dark',
                                                borderColor: 'primary.dark',
                                            }
                                        },
                                    }
                                }}
                            >
                                {[
                                    { value: 'blog', label: 'blog' },
                                    { value: 'social', label: 'social post' },
                                    { value: 'executive', label: 'executive summary' }
                                ].map((option) => (
                                    <ToggleButton 
                                        key={option.value}
                                        value={option.value}
                                        sx={{ 
                                            px: 1.5,
                                            py: 0.5,
                                            ...COMMON_STYLES.textNoTransform,
                                            fontSize: '0.875rem',
                                        }}
                                    >
                                        {option.label}
                                    </ToggleButton>
                                ))}
                            </ToggleButtonGroup>
                            <Typography variant="body2" color={selectedChartIds.size === 0 ? theme.palette.warning.main : "text.secondary"}>
                                {selectedChartIds.size} chart{selectedChartIds.size !== 1 ? 's' : ''} selected
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                            <Button
                                variant="contained"
                                disabled={isGenerating || selectedChartIds.size === 0}
                                onClick={generateReport}
                                size="small"
                                sx={COMMON_STYLES.textNoTransform}
                                startIcon={isGenerating ? <CircularProgress size={16} /> : <EditIcon />}
                            >
                                {isGenerating ? 'composing...' : 'compose'}
                            </Button>
                            <Divider orientation="vertical" flexItem />
                            <Button
                                variant="text"
                                disabled={generatedReport === ''}
                                size="small"
                                onClick={() => setMode('post')}
                                sx={COMMON_STYLES.textNoTransform}
                                startIcon={<ArrowForwardIcon />}
                            >
                                view post
                            </Button>
                        </Box>
                    </Box>
                    
                    <Box sx={{ p: 2 }}>

                        {error && (
                            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
                                {error}
                            </Alert>
                        )}

                        {sortedCharts.length === 0 ? (
                            <Typography color="text.secondary">
                                No charts available. Create some visualizations first.
                            </Typography>
                        ) : isLoadingPreviews ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
                                <CircularProgress size={18} sx={{ color: 'text.secondary' }} />
                                <Typography sx={{ ml: 2 }} color="text.secondary">
                                    loading chart previews...
                                </Typography>
                            </Box>
                        ) : (() => {
                            // Filter out unavailable charts (Table, ?, Auto, and charts without preview images)
                            const availableCharts = sortedCharts.filter(chart => {
                                const isUnavailable = chart.chartType === 'Table' || 
                                                    chart.chartType === '?' || 
                                                    chart.chartType === 'Auto';
                                const hasPreview = previewImages.has(chart.id);
                                return !isUnavailable && hasPreview;
                            });

                            if (availableCharts.length === 0) {
                                return (
                                    <Typography color="text.secondary">
                                        No available charts to display. Charts may still be loading or unavailable.
                                    </Typography>
                                );
                            }

                            return (
                                <Masonry columns={{ xs: 2, sm: 3, md: 4, lg: 5 }} spacing={2}>
                                    {availableCharts.map((chart) => {
                                        const table = tables.find(t => t.id === chart.tableRef);
                                        const previewImage = previewImages.get(chart.id);
                                        
                                        return (
                                        <Card
                                            key={chart.id}
                                            variant="outlined"
                                            sx={{
                                                cursor: 'pointer', position: 'relative', overflow: 'hidden',
                                                backgroundColor: selectedChartIds.has(chart.id) ? alpha(theme.palette.primary.main, 0.08) : 'background.paper',
                                                border:  selectedChartIds.has(chart.id) ? '2px solid' : '1px solid', 
                                                borderColor: selectedChartIds.has(chart.id) ? 'primary.main' : 'divider',
                                                '&:hover': { 
                                                    backgroundColor: 'action.hover', boxShadow: 3,
                                                    transform: 'translateY(-2px)', transition: 'all 0.2s ease-in-out'
                                                },
                                            }}
                                            onClick={() => toggleChartSelection(chart.id)}
                                        >
                                            <Box sx={{ position: 'relative' }}>
                                                <Checkbox
                                                    checked={selectedChartIds.has(chart.id)}
                                                    onChange={() => toggleChartSelection(chart.id)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    sx={{ 
                                                        ...COMMON_STYLES.positionAbsolute, top: 4, right: 4, p: 0.5, zIndex: 3,
                                                        backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: 1,
                                                        '&:hover': { backgroundColor: 'rgba(255, 255, 255, 1)' }
                                                    }}
                                                />
                                                <Box
                                                    component="img"
                                                    src={previewImage!.url}
                                                    alt={chart.chartType}
                                                    sx={{ p: 1, width: `calc(100% - 16px)`, height: 'auto', display: 'block', objectFit: 'contain', backgroundColor: 'white' }}
                                                />
                                            </Box>
                                            <CardContent sx={{ p: 1, '&:last-child': { pb: 1.5 } }}>
                                                <Typography 
                                                    variant="caption" 
                                                    sx={{ display: 'block', fontWeight: 500, ...COMMON_STYLES.textEllipsis }}
                                                >
                                                    {chart.chartType}
                                                </Typography>
                                                {table?.displayId && (
                                                    <Typography 
                                                        variant="caption" 
                                                        color="text.secondary"
                                                        sx={{ display: 'block', ...COMMON_STYLES.textEllipsis }}
                                                    >
                                                        {table.displayId}
                                                    </Typography>
                                                )}
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </Masonry>
                            );
                        })()}
                    </Box>
                </Box>
            ) : (
                <Box sx={{ height: '100%', ...COMMON_STYLES.flexColumn, overflow: 'hidden' }}>
                    <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',  }}>
                        <Button
                            size="small"
                            disabled={isGenerating}
                            startIcon={<ArrowBackIcon />}
                            sx={COMMON_STYLES.textNoTransform}
                            onClick={() => setMode('compose')}
                        >
                            back to compose
                        </Button>
                        <Typography variant="body2" color="text.secondary">
                            AI generated the post from the selected charts, and it could be inaccurate!
                        </Typography>
                    </Box>
                    <Box sx={{ flex: 1, overflowY: 'auto' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%', py: 3 }}>
                            {generatedStyle === 'social' ? (
                                <Paper
                                    elevation={0}
                                    sx={{
                                        maxWidth: '600px', width: '100%', ...COMMON_STYLES.borderRadiusLarge,
                                        border: '1px solid', borderColor: COLOR_SOCIAL_BORDER, p: 3, backgroundColor: 'white',
                                        ...COMMON_STYLES.fontSystem, fontSize: '0.9375rem', fontWeight: 400, lineHeight: 1.5,
                                        color: COLOR_SOCIAL_TEXT, WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale',
                                        '& code': {
                                            backgroundColor: `${COLOR_SOCIAL_ACCENT}1A`, color: COLOR_SOCIAL_ACCENT,
                                            padding: '0.15em 0.3em', ...COMMON_STYLES.borderRadius,
                                            fontSize: '0.875rem', fontWeight: 500, fontFamily: FONT_FAMILY_MONO
                                        },
                                        '& strong': { ...COMMON_STYLES.fontWeight600, color: COLOR_SOCIAL_TEXT },
                                        '& em': { fontStyle: 'italic' },
                                        '& img': { width: '90%', maxWidth: '90%', height: 'auto', marginTop: '12px', marginBottom: '12px' }
                                    }}
                                >
                                    <MuiMarkdown overrides={socialStyleMarkdownOverrides}>{isGenerating ? `${generatedReport} <span style="opacity: 0.4; margin-left: 2px;">✏️</span>` : generatedReport}</MuiMarkdown>
                                </Paper>
                            ) : (
                                <Box sx={{ 
                                    maxWidth: '800px', width: '100%', px: 6, py: 2, backgroundColor: 'background.paper',
                                    ...BODY_TEXT_BASE, WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale',
                                    '& code': {
                                        backgroundColor: 'rgba(135, 131, 120, 0.15)', color: '#eb5757',
                                        padding: '0.2em 0.4em', borderRadius: '3px',
                                        fontSize: '0.875rem', fontWeight: 500, fontFamily: FONT_FAMILY_MONO
                                    },
                                    '& strong': { ...COMMON_STYLES.fontWeight600, color: COLOR_HEADING },
                                    '& em': { fontStyle: 'italic' },
                                    '& img': {
                                        maxWidth: '75%', maxHeight: config.defaultChartHeight * 2,
                                        width: 'auto', height: 'auto', objectFit: 'contain', ...COMMON_STYLES.borderRadius,
                                        marginTop: '1.75em', marginBottom: '1.75em',
                                    }
                                }}>
                                    <MuiMarkdown overrides={notionStyleMarkdownOverrides}>{isGenerating ? `${generatedReport} <span style="opacity: 0.4; margin-left: 2px;">✏️</span>` : generatedReport}</MuiMarkdown>
                                </Box>
                            )}
                        </Box>
                    </Box>
                </Box>
            )}
        </Box>
    );
};

