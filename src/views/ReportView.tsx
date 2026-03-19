// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useRef, useEffect, useMemo } from 'react';
import { borderColor, shadow, transition, radius } from '../app/tokens';
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
import CreateChartifact from '@mui/icons-material/Description';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ShareIcon from '@mui/icons-material/Share';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import html2canvas from 'html2canvas';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors, GeneratedReport } from '../app/dfSlice';
import { Message } from './MessageSnackbar';
import { getUrls, assembleVegaChart, getTriggers, prepVisTable, fetchWithIdentity } from '../app/utils';
import { MuiMarkdown, getOverrides } from 'mui-markdown';
import embed from 'vega-embed';
import { getDataTable } from './VisualizationView';
import { DictTable } from '../components/ComponentType';
import { AppDispatch } from '../app/store';
import { Collapse } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { convertToChartifact, openChartifactViewer } from './ChartifactDialog';
import { StreamIcon } from '../icons';
import { useTranslation } from 'react-i18next';

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

// Executive summary style constants (professional/business look)
const COLOR_EXEC_TEXT = 'rgb(33, 37, 41)';
const COLOR_EXEC_HEADING = 'rgb(20, 24, 28)';
const COLOR_EXEC_BORDER = 'rgb(108, 117, 125)';
const COLOR_EXEC_ACCENT = 'rgb(0, 123, 255)';
const COLOR_EXEC_BG = 'rgb(248, 249, 250)';


const HEADING_BASE = {
    fontFamily: FONT_FAMILY_SYSTEM,
    color: COLOR_HEADING,
    fontWeight: 700,
    letterSpacing: '-0.01em',
};

const BODY_TEXT_BASE = {
    fontFamily: FONT_FAMILY_SYSTEM,
    fontSize: '0.9375rem',
    lineHeight: 1.75,
    fontWeight: 400,
    letterSpacing: '0.003em',
    color: COLOR_BODY,
};

const TABLE_CELL_BASE = {
    fontFamily: FONT_FAMILY_SYSTEM,
    fontSize: '0.875rem',
    py: 1.5,
    px: 2,
};

// Notion-style markdown overrides with MUI components
const notionStyleMarkdownOverrides = {
    ...getOverrides(),
    h1: { component: Typography, props: { variant: 'h4', gutterBottom: true, 
        sx: { ...HEADING_BASE, fontSize: '1.75rem', lineHeight: 1.25, letterSpacing: '-0.02em', pb: 0.5, mb: 3, mt: 4 } } },
    h2: { component: Typography, props: { variant: 'h5', gutterBottom: true,
        sx: { ...HEADING_BASE, fontSize: '1.5rem', lineHeight: 1.3, pb: 0.5, mb: 2.5, mt: 3.5 } } },
    h3: { component: Typography, props: { variant: 'h6', gutterBottom: true,
        sx: { ...HEADING_BASE, fontWeight: 600, fontSize: '1.25rem', lineHeight: 1.4, letterSpacing: '-0.005em', mb: 2, mt: 3 } } },
    h4: { component: Typography, props: { variant: 'h6', gutterBottom: true,
        sx: { ...HEADING_BASE, fontWeight: 600, fontSize: '1.125rem', lineHeight: 1.4, mb: 1.5, mt: 2.5 } } },
    h5: { component: Typography, props: { variant: 'subtitle1', gutterBottom: true,
        sx: { ...HEADING_BASE, fontWeight: 600, fontSize: '1rem', lineHeight: 1.5, mb: 1.5, mt: 2 } } },
    h6: { component: Typography, props: { variant: 'subtitle2', gutterBottom: true,
        sx: { ...HEADING_BASE, fontWeight: 600, fontSize: '0.9375rem', lineHeight: 1.5, mb: 1.5, mt: 2 } } },
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
        borderLeft: '3px solid', borderColor: borderColor.component, pl: 2.5, py: 1, my: 2.5,
        fontFamily: FONT_FAMILY_SERIF, fontStyle: 'italic', color: COLOR_MUTED, fontSize: '1rem', lineHeight: 1.7 
    } } },
    pre: { component: Paper, props: { elevation: 0, sx: { 
        backgroundColor: COLOR_BG_LIGHT, p: 2, borderRadius: '4px', overflow: 'auto', my: 2, 
        border: `1px solid ${borderColor.divider}`,
        '& code': { 
            backgroundColor: 'transparent !important', padding: '0 !important', fontSize: '0.8125rem',
            fontFamily: FONT_FAMILY_MONO, lineHeight: 1.7, color: COLOR_BODY
        } 
    } } },
    table: { component: TableContainer, props: { component: Paper, elevation: 0,
        sx: { my: 2, border: `1px solid ${borderColor.divider}` } } },
    thead: { component: TableHead, props: { sx: { backgroundColor: COLOR_BG_LIGHT } } },
    tbody: { component: TableBody },
    tr: { component: TableRow },
    th: { component: TableCell, props: { sx: { 
        ...TABLE_CELL_BASE, fontWeight: 600, borderBottom: `2px solid ${borderColor.divider}`
    } } },
    td: { component: TableCell, props: { sx: { 
        ...TABLE_CELL_BASE, borderBottom: `1px solid ${borderColor.divider}`, lineHeight: 1.6 
    } } },
    hr: { component: Divider, props: { sx: { my: 3 } } }
} as any;

// Social post style markdown overrides (X/Twitter style)
const socialStyleMarkdownOverrides = {
    ...notionStyleMarkdownOverrides,
    h1: { component: Typography, props: { variant: 'h6', gutterBottom: true, 
        sx: { fontFamily: FONT_FAMILY_SYSTEM, fontWeight: 700, fontSize: '1.125rem', 
            lineHeight: 1.25, color: COLOR_SOCIAL_TEXT, mb: 1.5, mt: 1.5 } } },
    h2: { component: Typography, props: { variant: 'h6', gutterBottom: true,
        sx: { fontFamily: FONT_FAMILY_SYSTEM, fontWeight: 700, fontSize: '1rem', 
            lineHeight: 1.25, color: COLOR_SOCIAL_TEXT, mb: 1.25, mt: 1.5 } } },
    h3: { component: Typography, props: { variant: 'subtitle1', gutterBottom: true,
        sx: { fontFamily: FONT_FAMILY_SYSTEM, fontWeight: 600, fontSize: '0.9375rem', 
            lineHeight: 1.3, color: COLOR_SOCIAL_TEXT, mb: 1, mt: 1.25 } } },
    p: { component: Typography, props: { variant: 'body2', paragraph: true,
        sx: { fontFamily: FONT_FAMILY_SYSTEM, fontSize: '0.875rem', lineHeight: 1.4, 
            fontWeight: 400, mb: 0.75, color: COLOR_SOCIAL_TEXT } } },
    li: { component: Typography, props: { component: 'li', variant: 'body2',
        sx: { fontFamily: FONT_FAMILY_SYSTEM, fontSize: '0.875rem', lineHeight: 1.4, 
            fontWeight: 400, mb: 0.25, color: COLOR_SOCIAL_TEXT } } }
} as any;

// Executive summary style markdown overrides (compact serif styling)
const executiveSummaryMarkdownOverrides = {
    ...getOverrides(),
    h1: { component: Typography, props: { variant: 'h5', gutterBottom: true, 
        sx: { fontFamily: FONT_FAMILY_SERIF, fontWeight: 700, fontSize: '1.25rem', lineHeight: 1.3, color: COLOR_EXEC_HEADING, mb: 2, mt: 2.5 } } },
    h2: { component: Typography, props: { variant: 'h6', gutterBottom: true,
        sx: { fontFamily: FONT_FAMILY_SERIF, fontWeight: 600, fontSize: '1.125rem', lineHeight: 1.3, color: COLOR_EXEC_HEADING, mb: 1.5, mt: 2 } } },
    h3: { component: Typography, props: { variant: 'h6', gutterBottom: true,
        sx: { fontFamily: FONT_FAMILY_SERIF, fontWeight: 600, fontSize: '1rem', lineHeight: 1.4, color: COLOR_EXEC_HEADING, mb: 1.25, mt: 1.5 } } },
    h4: { component: Typography, props: { variant: 'subtitle1', gutterBottom: true,
        sx: { fontFamily: FONT_FAMILY_SERIF, fontWeight: 600, fontSize: '0.9375rem', lineHeight: 1.4, color: COLOR_EXEC_HEADING, mb: 1, mt: 1.5 } } },
    p: { component: Typography, props: { variant: 'body2', paragraph: true,
        sx: { fontFamily: FONT_FAMILY_SERIF, fontSize: '0.875rem', lineHeight: 1.5, fontWeight: 400, color: COLOR_EXEC_TEXT, mb: 1.25, textAlign: 'justify' } } },
    a: { component: Link, props: { underline: 'hover' as const, color: 'primary' as const, 
        sx: { fontSize: 'inherit', fontWeight: 500, color: COLOR_EXEC_ACCENT, '&:hover': { color: 'rgb(0, 86, 179)' } } } },
    ul: { component: 'ul', props: { style: { paddingLeft: '1.5em', marginTop: '0.5em', marginBottom: '1em', fontFamily: FONT_FAMILY_SERIF } } },
    ol: { component: 'ol', props: { style: { paddingLeft: '1.5em', marginTop: '0.5em', marginBottom: '1em', fontFamily: FONT_FAMILY_SERIF } } },
    li: { component: Typography, props: { component: 'li', variant: 'body2',
        sx: { fontFamily: FONT_FAMILY_SERIF, fontSize: '0.875rem', lineHeight: 1.5, fontWeight: 400, color: COLOR_EXEC_TEXT, mb: 0.25 } } },
    blockquote: { component: Box, props: { sx: { 
        borderLeft: '2px solid', borderLeftColor: COLOR_EXEC_ACCENT, pl: 2, py: 1, my: 1.5,
        backgroundColor: COLOR_EXEC_BG, fontFamily: FONT_FAMILY_SERIF, fontStyle: 'italic', color: COLOR_EXEC_TEXT, fontSize: '0.875rem', lineHeight: 1.6
    } } },
    pre: { component: Paper, props: { elevation: 0, sx: { 
        backgroundColor: COLOR_EXEC_BG, p: 1.5, borderRadius: '4px', overflow: 'auto', my: 1.5,
        '& code': { backgroundColor: 'transparent !important', padding: '0 !important', fontSize: '0.75rem', fontFamily: FONT_FAMILY_MONO, lineHeight: 1.5, color: COLOR_EXEC_TEXT }
    } } },
    table: { component: TableContainer, props: { component: Paper, elevation: 0, sx: { my: 1.5, borderRadius: '4px' } } },
    thead: { component: TableHead, props: { sx: { backgroundColor: COLOR_EXEC_BG } } },
    tbody: { component: TableBody },
    tr: { component: TableRow },
    th: { component: TableCell, props: { sx: { 
        fontFamily: FONT_FAMILY_SERIF, fontSize: '0.8125rem', py: 1, px: 1.5, fontWeight: 600, borderBottom: '1px solid', borderColor: COLOR_EXEC_BORDER, color: COLOR_EXEC_HEADING
    } } },
    td: { component: TableCell, props: { sx: { 
        fontFamily: FONT_FAMILY_SERIF, fontSize: '0.8125rem', py: 1, px: 1.5, borderBottom: '1px solid', borderColor: COLOR_EXEC_BORDER, lineHeight: 1.5, color: COLOR_EXEC_TEXT
    } } },
    hr: { component: Divider, props: { sx: { my: 2, borderColor: COLOR_EXEC_BORDER } } }
} as any;

export const ReportView: FC = () => {
    // Get all generated reports from Redux state
    const dispatch = useDispatch<AppDispatch>();

    const charts = useSelector((state: DataFormulatorState) => state.charts);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const models = useSelector((state: DataFormulatorState) => state.models);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const config = useSelector((state: DataFormulatorState) => state.config);
    const allGeneratedReports = useSelector(dfSelectors.getAllGeneratedReports);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const focusedChartId = focusedId?.type === 'chart' ? focusedId.chartId : undefined;
    const theme = useTheme();
    const { t } = useTranslation();

    const reportStyleDisplayLabel = (styleKey: string) => {
        const map: Record<string, string> = {
            'live report': 'report.styleLiveReport',
            'blog post': 'report.styleBlogPost',
            'social post': 'report.styleSocialPost',
            'executive summary': 'report.styleExecutiveSummary',
            'short note': 'report.styleShortNote',
        };
        const labelKey = map[styleKey];
        return labelKey ? t(labelKey) : styleKey;
    };

    const [selectedChartIds, setSelectedChartIds] = useState<Set<string>>(new Set(focusedChartId ? [focusedChartId] : []));
    const [previewImages, setPreviewImages] = useState<Map<string, { url: string; width: number; height: number }>>(new Map());
    const [isLoadingPreviews, setIsLoadingPreviews] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string>('');
    const [style, setStyle] = useState<string>('social post');
    const [mode, setMode] = useState<'compose' | 'post'>(allGeneratedReports.length > 0 ? 'post' : 'compose');

    // Local state for current report
    const [currentReportId, setCurrentReportId] = useState<string | undefined>(undefined);
    const [generatedReport, setGeneratedReport] = useState<string>('');
    const [generatedStyle, setGeneratedStyle] = useState<string>('social post');
    const [cachedReportImages, setCachedReportImages] = useState<Record<string, { url: string; width: number; height: number }>>({});
    const [shareButtonSuccess, setShareButtonSuccess] = useState(false);
    const [hideTableOfContents, setHideTableOfContents] = useState(false);

    const updateCachedReportImages = (chartId: string, blobUrl: string, width: number, height: number) => {
        setCachedReportImages(prev => ({
            ...prev,
            [chartId]: { url: blobUrl, width, height }
        }));
    };

    // Helper function to show messages using dfSlice
    const showMessage = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'success') => {
        const msg: Message = {
            type,
            component: t('messages.report.component'),
            timestamp: Date.now(),
            value: message
        };
        dispatch(dfActions.addMessages(msg));
    };

    // Function to capture and share report as image
    const shareReportAsImage = async () => {
        if (!currentReportId) return;

        try {
            // Find the report content element
            const reportElement = document.querySelector('[data-report-content]') as HTMLElement;
            if (!reportElement) {
                showMessage(t('report.couldNotFindContent'), 'error');
                return;
            }

            // Capture the report as canvas with extra padding for borders
            const canvas = await html2canvas(reportElement, {
                backgroundColor: '#ffffff',
                scale: 2, // Higher quality
                useCORS: true,
                allowTaint: true,
                scrollX: 0,
                scrollY: 0,
                // Add extra padding to ensure borders are captured
                width: reportElement.scrollWidth + 4,
                height: reportElement.scrollHeight + 4,
                logging: false // Disable console logs
            });

            // Convert canvas to blob
            canvas.toBlob((blob: Blob | null) => {
                if (!blob) {
                    showMessage(t('report.failedToGenerateImage'), 'error');
                    return;
                }

                // Copy to clipboard
                if (navigator.clipboard && navigator.clipboard.write) {
                    navigator.clipboard.write([
                        new ClipboardItem({
                            'image/png': blob
                        })
                    ]).then(() => {
                        showMessage(t('report.imageCopied'));
                        setShareButtonSuccess(true);
                        setTimeout(() => setShareButtonSuccess(false), 2000);
                    }).catch(() => {
                        showMessage(t('report.failedToCopyClipboard'), 'error');
                    });
                } else {
                    showMessage(t('report.clipboardNotSupported'), 'error');
                }
            }, 'image/png', 0.95);

        } catch (error) {
            console.error('Error generating report image:', error);
            showMessage(t('report.failedToGenerateReportImage'), 'error');
        }
    };



    // Update like this:
    const processReport = (rawReport: string): string => {
        const markdownMatch = rawReport.match(/```markdown\n([\s\S]*?)(?:\n```)?$/);
        let processed = markdownMatch ? markdownMatch[1] : rawReport;
        
        Object.entries(cachedReportImages).forEach(([chartId, { url, width, height }]) => {
            processed = processed.replace(
                new RegExp(`\\[IMAGE\\(${chartId}\\)\\]`, 'g'),
                `<img src="${url}" alt="${t('report.chartAlt')}" width="${width}" height="${height}" />`
            );
        });
        
        return processed;
    };

    const loadReport = (reportId: string) => {
        const report = allGeneratedReports.find(r => r.id === reportId);
        if (report) {
            setCurrentReportId(reportId);
            setGeneratedReport(report.content);
            setGeneratedStyle(report.style);

            // load / assemble chart images for the report
            report.selectedChartIds.forEach((chartId) => {
                const chart = charts.find(c => c.id === chartId);
                if (!chart) return null;

                const chartTable = tables.find(t => t.id === chart.tableRef);
                if (!chartTable) return null;

                if (chart.chartType === 'Table' || chart.chartType === '?') {
                    return null;
                }
                getChartImageFromVega(chart, chartTable).then(({ blobUrl, width, height }) => {
                    if (blobUrl) {
                        // Use blob URL for local display and caching
                        updateCachedReportImages(chart.id, blobUrl, width, height);
                    }
                });
            });
        }
    };

    useEffect(() => {
        if (currentReportId === undefined && allGeneratedReports.length > 0) {
            loadReport(allGeneratedReports[0].id);
        }
    }, [currentReportId]);

    // Auto-refresh chart images when underlying table data changes
    // This enables real-time chart updates in reports when data is streaming
    const tableRowSignaturesRef = useRef<Map<string, string>>(new Map());
    
    useEffect(() => {
        if (!currentReportId || mode !== 'post') return;
        
        const currentReport = allGeneratedReports.find(r => r.id === currentReportId);
        if (!currentReport) return;
        
        // Get all tables referenced by the report's charts
        const reportChartIds = currentReport.selectedChartIds;
        const affectedTableIds = new Set<string>();
        
        reportChartIds.forEach(chartId => {
            const chart = charts.find(c => c.id === chartId);
            if (chart) {
                affectedTableIds.add(chart.tableRef);
            }
        });
        
        // Check if any affected tables have changed
        let hasChanges = false;
        affectedTableIds.forEach(tableId => {
            const table = tables.find(t => t.id === tableId);
            if (table) {
                // Use contentHash if available (set by state management), otherwise fallback to lightweight rowCount
                // This avoids expensive JSON.stringify operations on every table change during streaming updates
                const signature = table.contentHash || `${table.rows.length}`;
                
                const prevSignature = tableRowSignaturesRef.current.get(tableId);
                if (prevSignature && prevSignature !== signature) {
                    hasChanges = true;
                }
                tableRowSignaturesRef.current.set(tableId, signature);
            }
        });
        
        // If data changed, regenerate chart images for the report
        if (hasChanges) {
            
            reportChartIds.forEach(chartId => {
                const chart = charts.find(c => c.id === chartId);
                if (!chart) return;
                
                const chartTable = tables.find(t => t.id === chart.tableRef);
                if (!chartTable) return;
                
                if (chart.chartType === 'Table' || chart.chartType === '?') {
                    return;
                }
                
                getChartImageFromVega(chart, chartTable).then(({ blobUrl, width, height }) => {
                    if (blobUrl) {
                        updateCachedReportImages(chart.id, blobUrl, width, height);
                    }
                });
            });
        }
    }, [tables, currentReportId, mode, allGeneratedReports, charts]);


    
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
            // Clean up preview images (these are always blob URLs)
            previewImages.forEach(({ url }) => {
                if (url.startsWith('blob:')) {
                    URL.revokeObjectURL(url);
                }
            });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only cleanup on unmount, not when images change

    // Use existing thumbnails from ChartRenderService instead of re-rendering
    useEffect(() => {
        const newPreviewImages = new Map<string, { url: string; width: number; height: number }>();

        // Clean up old blob URLs
        previewImages.forEach(({ url }) => {
            if (url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
        });

        for (const chart of sortedCharts) {
            if (chart.chartType === 'Table' || chart.chartType === '?' || chart.chartType === 'Auto') continue;
            if (chart.thumbnail) {
                // Use the pre-rendered thumbnail from ChartRenderService
                newPreviewImages.set(chart.id, {
                    url: chart.thumbnail,
                    width: config.defaultChartWidth,
                    height: config.defaultChartHeight,
                });
            }
        }

        setPreviewImages(newPreviewImages);
        setIsLoadingPreviews(false);
    }, [sortedCharts, config]);

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
                config.defaultChartWidth,
                config.defaultChartHeight,
                true,
                chart.config,
                1,
                config.maxStretchFactor,
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
                    throw new Error(t('report.couldNotParseSvg'));
                }
                
                // Get original dimensions
                const originalWidth = parseFloat(svgElement.getAttribute('width') || '0');
                const originalHeight = parseFloat(svgElement.getAttribute('height') || '0');
                
                // Convert SVG to PNG using canvas
                const { dataUrl, blobUrl } = await new Promise<{ dataUrl: string; blobUrl: string }>((resolve, reject) => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error(t('report.couldNotGetCanvasContext')));
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
            setError(t('report.pleaseSelectChart'));
            return;
        }

        setIsGenerating(true);
        setError('');
        setGeneratedReport('');
        setGeneratedStyle(style);

        // Create a new report ID
        const reportId = `report-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

        try {
            let model = models.find(m => m.id == selectedModelId);

            if (!model) {
                throw new Error(t('report.noModelSelected'));
            }

            const maxRows = serverConfig.MAX_DISPLAY_ROWS;

            const inputTables = tables.filter(t => t.anchored).map(table => {
                const rows = table.rows.length > maxRows ? table.rows.slice(0, maxRows) : table.rows;
                return {
                    name: table.id,
                    rows,
                    attached_metadata: table.attachedMetadata
                };
            });

            // Check if any table data was truncated
            const truncatedTables = tables.filter(t => t.anchored).filter(t => {
                const totalRows = t.virtual?.rowCount || t.rows.length;
                return totalRows > maxRows;
            });
            const truncationList = truncatedTables.map((tbl) =>
                t('report.truncationTableEntry', {
                    name: tbl.displayId || tbl.id,
                    count: (tbl.virtual?.rowCount || tbl.rows.length).toLocaleString(),
                })
            ).join(', ');
            const truncationNote = truncatedTables.length > 0
                ? `\n\n${t('report.truncationNote', { maxRows: maxRows.toLocaleString(), list: truncationList })}`
                : '';


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
                        // Use blob URL for local display and caching
                        updateCachedReportImages(chart.id, blobUrl, width, height);
                    }

                    return {
                        chart_id: chart.id,
                        code: chartTable.derive?.code || '',
                        chart_data: {
                            name: chartTable.id,
                            rows: chartTable.rows.length > maxRows ? chartTable.rows.slice(0, maxRows) : chartTable.rows
                        },
                        chart_url: dataUrl // use data_url to send to the agent
                    };
                })
            );

            const validCharts = selectedCharts.filter(c => c !== null);

            const requestBody = {
                model: model,
                input_tables: inputTables,
                charts: validCharts,
                style: style + truncationNote
            };

            const response = await fetchWithIdentity(getUrls().GENERATE_REPORT_STREAM, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(t('report.failedToGenerateReport'));
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error(t('report.noResponseBody'));
            }

            const decoder = new TextDecoder();
            let accumulatedReport = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    // Create the report object for saving to Redux
                    const report: GeneratedReport = {
                        id: reportId,
                        content: accumulatedReport,
                        style: style,
                        selectedChartIds: Array.from(selectedChartIds),
                        createdAt: Date.now(),
                    };
                    // Save to Redux state
                    dispatch(dfActions.saveGeneratedReport(report));
                    break;
                };

                const chunk = decoder.decode(value, { stream: true });
                
                if (chunk.startsWith('error:')) {
                    const errorData = JSON.parse(chunk.substring(6));
                    throw new Error(errorData.content || t('report.errorGeneratingReport'));
                }

                accumulatedReport += chunk;

                // Update local state
                setGeneratedReport(accumulatedReport);
                setCurrentReportId(reportId);
                
                if (mode === 'compose') {
                    setMode('post');
                }
            }

        } catch (err) {
            setError((err as Error).message || t('report.failedToGenerateReport'));
        } finally {
            setIsGenerating(false);
        }
    };


    const deleteReport = (reportId: string, event: React.MouseEvent) => {
        event.stopPropagation(); // Prevent triggering the card click
        dispatch(dfActions.deleteGeneratedReport(reportId));
        
        // If we're deleting the currently viewed report, switch to another report or clear the view
        if (currentReportId === reportId) {
            const remainingReports = allGeneratedReports.filter(r => r.id !== reportId);
            if (remainingReports.length > 0) {
                // Switch to the first remaining report
                loadReport(remainingReports[0].id);
            } else {
                // No reports left, clear the view and go back to compose mode
                setCurrentReportId(undefined);
                setGeneratedReport('');
                setGeneratedStyle('social post');
                setMode('compose');
            }
        }
    };

    let displayedReport = isGenerating ? 
        `${generatedReport} <span class="pencil" style="opacity: 0.4; margin-left: 2px;">✏️</span>` : generatedReport;
    displayedReport = processReport(displayedReport);

    return (
        <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {mode === 'compose' ? (
                <Box sx={{ overflowY: 'auto', position: 'relative', height: '100%' }}>
                    <Box sx={{ p: 2, pb: 0, display: 'flex' }}>
                        <Button
                            variant="text"
                            size="small"
                            color='secondary'
                            onClick={() => dispatch(dfActions.setViewMode('editor'))}
                            sx={{ textTransform: 'none' }}
                            startIcon={<ArrowBackIcon />}
                        >
                            {t('report.backToExplore')}
                        </Button>
                        <Divider orientation="vertical" sx={{ mx: 1 }} flexItem />
                        <Button
                            variant="text"
                            disabled={allGeneratedReports.length === 0}
                            size="small"
                            onClick={() => setMode('post')}
                            sx={{ textTransform: 'none' }}
                            endIcon={<ArrowForwardIcon />}
                        >
                            {t('report.viewReports')}
                        </Button>
                    </Box>
                    {/* Centered Top Bar */}
                    <Box sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        p: 2,
                    }}>
                        <Paper
                            elevation={0}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                p: 1,
                                borderRadius: 2,
                                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                                backdropFilter: 'blur(12px)',
                                border: '1px solid',
                                borderColor: borderColor.view,
                                boxShadow: shadow.lg,
                                '&:hover': {
                                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                    borderColor: borderColor.view,
                                    boxShadow: shadow.xl,
                                    transition: transition.normal
                                },
                                '.MuiTypography-root': {
                                    fontSize: '1rem',
                                }

                            }}
                        >
                            {/* Natural Flow */}
                            <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                                {t('report.createA')}
                            </Typography>
                            
                            <ToggleButtonGroup
                                value={style}
                                exclusive
                                onChange={(e, newStyle) => newStyle && setStyle(newStyle)}
                                size="small"
                                sx={{ 
                                    '& .MuiToggleButtonGroup-grouped': {
                                        border: 'none',
                                        backgroundColor: 'action.hover',
                                        margin: '0 2px',
                                        borderRadius: '4px',
                                        '&:hover': {
                                            backgroundColor: 'action.selected',
                                        },
                                        '&.Mui-selected': {
                                            backgroundColor: 'primary.main',
                                            color: 'white',
                                            '&:hover': {
                                                backgroundColor: 'primary.dark',
                                            }
                                        },
                                    }
                                }}
                            >
                                {[
                                    { value: 'live report', labelKey: 'report.styleLiveReport' },
                                    { value: 'blog post', labelKey: 'report.styleBlogPost' },
                                    { value: 'social post', labelKey: 'report.styleSocialPost' },
                                    { value: 'executive summary', labelKey: 'report.styleExecutiveSummary' },
                                ].map((option) => (
                                    <ToggleButton 
                                        key={option.value}
                                        value={option.value}
                                        sx={{ 
                                            px: 1,
                                            py: 0.25,
                                            textTransform: 'none',
                                            fontSize: '1rem',
                                            minWidth: 'auto'
                                        }}
                                    >
                                        {option.value === 'live report' ? <StreamIcon sx={{ fontSize: 16, mr: 1 }} /> : <></>} {t(option.labelKey)}
                                    </ToggleButton>
                                ))}
                            </ToggleButtonGroup>

                            <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                                {t('report.from')}
                            </Typography>
                            
                            <Typography variant="body2" 
                                color={selectedChartIds.size === 0 ? "warning.main" : 'primary.main'} sx={{ fontWeight: 'bold' }}>
                                {selectedChartIds.size}
                            </Typography>
                            
                            <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                                {selectedChartIds.size <= 1 ? t('report.chart') : t('report.charts')}
                            </Typography>

                            {/* Generate Button */}
                            <Button
                                variant="contained"
                                disabled={isGenerating || selectedChartIds.size === 0}
                                onClick={generateReport}
                                size="small"
                                sx={{
                                    textTransform: 'none',
                                    ml: 2,
                                    px: 2,
                                    py: 0.75,
                                    borderRadius: 1.5,
                                    fontWeight: 500,
                                    fontSize: '1rem',
                                    minWidth: 'auto'
                                }}
                                startIcon={isGenerating ? <CircularProgress size={14} /> : <EditIcon sx={{ fontSize: 16 }} />}
                            >
                                {isGenerating ? t('report.composing') : t('report.compose')}
                            </Button>
                        </Paper>
                    </Box>
                    
                    <Box sx={{ py: 2, px: 6 }}>
                        {error && (
                            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
                                {error}
                            </Alert>
                        )}

                        {sortedCharts.length === 0 ? (
                            <Typography color="text.secondary">
                                {t('report.noChartsAvailable')}
                            </Typography>
                        ) : isLoadingPreviews ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
                                <CircularProgress size={18} sx={{ color: 'text.secondary' }} />
                                <Typography sx={{ ml: 2 }} color="text.secondary">
                                    {t('report.loadingChartPreviews')}
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
                                        {t('report.noAvailableCharts')}
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
                                                borderColor: selectedChartIds.has(chart.id) ? 'primary.main' : borderColor.divider,
                                                '&:hover': { 
                                                    backgroundColor: 'action.hover', boxShadow: 3,
                                                    transform: 'translateY(-2px)', transition: transition.normal
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
                                                        position: 'absolute', top: 4, right: 4, p: 0.5, zIndex: 3,
                                                        backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: 1,
                                                        '&:hover': { backgroundColor: 'rgba(255, 255, 255, 1)' }
                                                    }}
                                                />
                                                <Box
                                                    component="img"
                                                    src={previewImage!.url}
                                                    alt={t('dataThread.chartAlt', { type: chart.chartType })}
                                                    sx={{ p: 1, width: `calc(100% - 16px)`, height: 'auto', maxHeight: config.defaultChartHeight, display: 'block', objectFit: 'contain', backgroundColor: 'white' }}
                                                />
                                            </Box>
                                            <CardContent sx={{ p: 1, '&:last-child': { pb: 1.5 } }}>
                                                <Typography 
                                                    variant="caption" 
                                                    sx={{ display: 'block', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                >
                                                    {chart.chartType}
                                                </Typography>
                                                {table?.displayId && (
                                                    <Typography 
                                                        variant="caption" 
                                                        color="text.secondary"
                                                        sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
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
            ) : mode === 'post' ? (
                <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',  }}>
                        <Button
                            size="small"
                            disabled={isGenerating}
                            startIcon={<ArrowBackIcon />}
                            sx={{ textTransform: 'none' }}
                            onClick={() => setMode('compose')}
                        >
                            {t('report.createNewReport')}
                        </Button>
                        <Typography variant="body2" color="text.secondary">
                            {t('report.aiDisclaimer')}
                        </Typography>
                    </Box>
                    <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
                        {/* Table of Contents Sidebar */}
                        {allGeneratedReports.length > 0 && (
                            <Box sx={{ 
                                position: 'absolute',
                                top: 0,
                                left: 8,
                                zIndex: 1,
                                width: 200,
                                display: 'flex',
                                overflowY: 'auto',
                                flexDirection: 'column',
                                borderRight: `1px solid ${borderColor.view}`,
                                height: 'fit-content',
                                background: alpha(theme.palette.background.paper, 0.9),
                            }}>
                                <Button size='small' color='primary' onClick={() => setHideTableOfContents(!hideTableOfContents)}
                                sx={{
                                    width: '100%',
                                    justifyContent: 'flex-start',
                                    textAlign: 'left',
                                    borderRadius: 0,
                                    textTransform: 'none',
                                    fontSize: 12,
                                    py: 1,
                                    px: 2,
                                }}>
                                    {hideTableOfContents ? <ExpandMoreIcon sx={{ fontSize: 16, mr: 1 }} /> 
                                    : <ExpandLessIcon sx={{ fontSize: 16, mr: 1 }} /> } {hideTableOfContents ? t('report.showAllReports') : t('report.reports')}
                                </Button> 
                                <Collapse in={!hideTableOfContents}>{allGeneratedReports.map((report) => (
                                    <Box key={report.id} sx={{ position: 'relative' }}>
                                        <Button
                                            variant="text"
                                            size="small"
                                            color='primary'
                                            onClick={() => loadReport(report.id)}
                                            sx={{
                                                fontSize: 12,
                                                textTransform: "none",
                                                width: '100%',
                                                justifyContent: 'flex-start',
                                                textAlign: 'left',
                                                borderRadius: 0,
                                                py: 1,
                                                px: 2,
                                                color: currentReportId === report.id ? 'primary.main' : 'text.secondary',
                                                borderRight: currentReportId === report.id ? 2 : 0,
                                                borderColor: 'primary.main',
                                            }}
                                        >
                                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                                <Typography 
                                                    variant="body2" 
                                                    sx={{ 
                                                        fontSize: 'inherit',
                                                        fontWeight: 500, 
                                                        mb: 0.25
                                                    }}
                                                >
                                                    {report.content.split('\n')[0]}
                                                </Typography>
                                                <Typography 
                                                    variant="caption" 
                                                    color="text.secondary"
                                                    sx={{ 
                                                        fontSize: 10,
                                                        display: 'block',
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                                    }}
                                                >
                                                    {new Date(report.createdAt).toLocaleDateString()} • {reportStyleDisplayLabel(report.style)}
                                                </Typography>
                                            </Box>
                                        </Button>
                                        <Tooltip title={t('report.deleteReport')}>
                                            <IconButton
                                                size="small"
                                                disabled={isGenerating}
                                                color='warning'
                                                onClick={(e) => deleteReport(report.id, e)}
                                                sx={{ 
                                                    position: 'absolute',
                                                    right: 4,
                                                    top: '50%',
                                                    transform: 'translateY(-50%)',
                                                    width: 20,
                                                    height: 20,
                                                    '&:hover': { 
                                                        transform: 'translateY(-50%) scale(1.2)', transition: 'all 0.2s ease-in-out'
                                                    }
                                                }}
                                            >
                                                <DeleteIcon sx={{ fontSize: 14 }} />
                                            </IconButton>
                                        </Tooltip>
                                    </Box>
                                ))}
                                </Collapse>
                            </Box>
                        )}
                        
                        {/* Main Content Area */}
                        <Box sx={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
                            {/* Action Buttons */}
                            {currentReportId && (
                                <Box sx={{ position: 'absolute', top: 16, right: 16, zIndex: 10, display: 'flex', gap: 1 }}>
                                    <Tooltip title={t('report.createChartifactReport')}>
                                        <Button
                                            variant="contained"
                                            size="small"
                                            onClick={() => {
                                                // Convert report to Chartifact markdown format
                                                const chartifactMarkdown = convertToChartifact(
                                                    generatedReport,
                                                    generatedStyle,
                                                    charts,
                                                    tables,
                                                    conceptShelfItems,
                                                    config
                                                );
                                                openChartifactViewer(chartifactMarkdown);
                                            }}
                                            sx={{
                                                textTransform: 'none',
                                                backgroundColor: 'primary.main',
                                                color: 'white',
                                                '&:hover': {
                                                    backgroundColor: 'primary.dark',
                                                },
                                            }}
                                            startIcon={<CreateChartifact />}
                                        >
                                            {t('report.createChartifact')}
                                        </Button>
                                    </Tooltip>
                                    <Tooltip title={t('report.shareReportAsImage')}>
                                        <Button
                                            variant="contained"
                                            size="small"
                                            startIcon={
                                                shareButtonSuccess ? <CheckCircleIcon /> : <ShareIcon />
                                            }
                                            onClick={shareReportAsImage}
                                            sx={{
                                                textTransform: 'none',
                                                backgroundColor: shareButtonSuccess ? 'success.main' : 'primary.main',
                                                color: 'white',
                                                transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                                                opacity: shareButtonSuccess ? 0.9 : 1,
                                                transform: shareButtonSuccess ? 'scale(0.98)' : 'scale(1)',
                                                animation: shareButtonSuccess ? 'pulse 0.6s ease-in-out' : 'none',
                                                '@keyframes pulse': {
                                                    '0%': { transform: 'scale(0.98)' },
                                                    '50%': { transform: 'scale(1.05)' },
                                                    '100%': { transform: 'scale(0.98)' }
                                                },
                                                '&:hover': {
                                                    backgroundColor: shareButtonSuccess ? 'success.dark' : 'primary.dark',
                                                },
                                            }}
                                        >
                                            {shareButtonSuccess ? t('report.copied') : t('report.shareImage')}
                                        </Button>
                                    </Tooltip>
                                </Box>
                            )}
                            
                            <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%', py: 3 }}>
                                <Box
                                    data-report-content
                                    sx={{
                                        // Common styles
                                        width: '100%',
                                        WebkitFontSmoothing: 'antialiased',
                                        MozOsxFontSmoothing: 'grayscale',
                                        '& em': { fontStyle: 'italic' },
                                        
                                        // Conditional styles
                                        ...(generatedStyle === 'social post' || generatedStyle === 'short note' ? {
                                            maxWidth: '520px', borderRadius: '12px',
                                            border: '1px solid', borderColor: COLOR_SOCIAL_BORDER, p: 2.5, backgroundColor: 'white',
                                            fontFamily: FONT_FAMILY_SYSTEM, fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.4,
                                            color: COLOR_SOCIAL_TEXT,
                                            '& code': {
                                                backgroundColor: `${COLOR_SOCIAL_ACCENT}1A`, color: COLOR_SOCIAL_ACCENT,
                                                padding: '0.1em 0.25em', borderRadius: '3px',
                                                fontSize: '0.8125rem', fontWeight: 500, fontFamily: FONT_FAMILY_MONO
                                            },
                                            '& strong': { fontWeight: 600, color: COLOR_SOCIAL_TEXT },
                                            '& img': { width: '100%', maxWidth: '100%', height: 'auto', maxHeight: '280px', objectFit: 'contain', borderRadius: '8px', marginTop: '8px', marginBottom: '8px' }
                                        } : generatedStyle === 'executive summary' ? {
                                            maxWidth: '700px', p: 2.5, backgroundColor: 'white',
                                            fontFamily: FONT_FAMILY_SERIF, fontSize: '0.875rem', lineHeight: 1.5, color: COLOR_EXEC_TEXT,
                                            '& code': { backgroundColor: COLOR_EXEC_BG, color: COLOR_EXEC_ACCENT, padding: '0.1em 0.25em', borderRadius: '2px', fontSize: '0.75rem', fontFamily: FONT_FAMILY_MONO },
                                            '& strong': { fontWeight: 600, color: COLOR_EXEC_HEADING },
                                            '& img': { maxWidth: '70%', maxHeight: config.defaultChartHeight * 1.5, objectFit: 'contain', width: 'auto', height: 'auto', borderRadius: '3px', marginTop: '1em', marginBottom: '1em' }
                                        } : { 
                                            maxWidth: '800px', px: 6, py: 0, backgroundColor: 'background.paper',
                                            ...BODY_TEXT_BASE,
                                            '& code': {
                                                backgroundColor: 'rgba(135, 131, 120, 0.15)', color: '#eb5757',
                                                padding: '0.2em 0.4em', borderRadius: '3px',
                                                fontSize: '0.875rem', fontWeight: 500, fontFamily: FONT_FAMILY_MONO
                                            },
                                            '& strong': { fontWeight: 600, color: COLOR_HEADING },
                                            '& img': {
                                                maxWidth: '75%', maxHeight: config.defaultChartHeight * 1.5,
                                                width: 'auto', height: 'auto', objectFit: 'contain', borderRadius: '4px',
                                                marginTop: '1.75em', marginBottom: '1.75em',
                                            }
                                        })
                                    }}
                                >
                                    <MuiMarkdown overrides={
                                        generatedStyle === 'social post' || generatedStyle === 'short note' 
                                            ? socialStyleMarkdownOverrides 
                                            : generatedStyle === 'executive summary'
                                            ? executiveSummaryMarkdownOverrides
                                            : notionStyleMarkdownOverrides
                                    }>{displayedReport}</MuiMarkdown>
                                    
                                    {/* Attribution */}
                                    <Box sx={{ 
                                        mt: 3, 
                                        pt: 2, 
                                        borderTop: '1px solid #e0e0e0',
                                        textAlign: 'center',
                                        fontSize: '0.75rem',
                                        color: '#666'
                                    }}>
                                        {t('report.createdWithAI')}{' '}
                                        <Link 
                                            href="https://github.com/microsoft/data-formulator" 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            sx={{ 
                                                color: '#1976d2',
                                                textDecoration: 'none',
                                                '&:hover': {
                                                    textDecoration: 'underline'
                                                }
                                            }}
                                        >
                                            https://github.com/microsoft/data-formulator
                                        </Link>
                                    </Box>
                                </Box>
                            </Box>
                        </Box>
                    </Box>
                </Box>
            ) : null}
        </Box>
    );
};

