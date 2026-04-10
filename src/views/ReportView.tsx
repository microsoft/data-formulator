// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useRef, useEffect, useMemo } from 'react';
import { borderColor, shadow, transition } from '../app/tokens';
import {
    Box,
    Button,
    Typography,
    Checkbox,
    IconButton,
    Card,
    CardContent,
    CircularProgress,
    Link,
    Paper,
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
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import html2canvas from 'html2canvas';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors, GeneratedReport } from '../app/dfSlice';
import { Message } from './MessageSnackbar';
import { getUrls, assembleVegaChart, getTriggers, prepVisTable, fetchWithIdentity } from '../app/utils';
import embed from 'vega-embed';
import { getDataTable } from './ChartUtils';
import { DictTable } from '../components/ComponentType';
import { AppDispatch } from '../app/store';
import { TiptapReportEditor } from './TiptapReportEditor';
import { getCachedChart } from '../app/chartCache';

import { StreamIcon } from '../icons';
import { useTranslation } from 'react-i18next';

export const ReportView: FC = () => {
    // Get all generated reports from Redux state
    const dispatch = useDispatch<AppDispatch>();

    const charts = useSelector((state: DataFormulatorState) => state.charts);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const activeModel = useSelector(dfSelectors.getActiveModel);
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

    const [style, setStyle] = useState<string>('social post');
    const [mode, setMode] = useState<'compose' | 'post'>(allGeneratedReports.length > 0 ? 'post' : 'compose');

    // Local state for current report
    const [currentReportId, setCurrentReportId] = useState<string | undefined>(undefined);
    const [generatedReport, setGeneratedReport] = useState<string>('');
    const [generatedStyle, setGeneratedStyle] = useState<string>('social post');
    const [cachedReportImages, setCachedReportImages] = useState<Record<string, { url: string; width: number; height: number }>>({});
    const [shareButtonSuccess, setShareButtonSuccess] = useState(false);
    const [copyButtonSuccess, setCopyButtonSuccess] = useState(false);

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



    const processReport = (rawReport: string): string => {
        const markdownMatch = rawReport.match(/```markdown\n([\s\S]*?)(?:\n```)?$/);
        let processed = markdownMatch ? markdownMatch[1] : rawReport;

        const makeImg = (chartId: string, url: string, width: number, height: number) => {
            return `<img src="${url}" alt="${t('report.chartAlt')}" data-chart-id="${chartId}" width="${width}" height="${height}" style="max-width:100%;" />`;
        };

        const usedKeys = new Set<string>();
        Object.entries(cachedReportImages).forEach(([chartId, { url, width, height }]) => {
            const escaped = chartId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\[IMAGE\\(${escaped}\\)\\]`, 'g');
            if (regex.test(processed)) {
                usedKeys.add(chartId);
                processed = processed.replace(regex, makeImg(chartId, url, width, height));
            }
        });

        const unusedEntries = Object.entries(cachedReportImages)
            .filter(([key]) => !usedKeys.has(key));
        let unusedIdx = 0;
        processed = processed.replace(/\[IMAGE\([^\)]+\)\]/g, () => {
            if (unusedIdx < unusedEntries.length) {
                const [chartId, { url, width, height }] = unusedEntries[unusedIdx++];
                return makeImg(chartId, url, width, height);
            }
            return '';
        });

        // Refresh stale <img> tags that have data-chart-id with updated blob URLs
        Object.entries(cachedReportImages).forEach(([chartId, { url, width, height }]) => {
            const escaped = chartId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const imgRegex = new RegExp(`<img([^>]*?)data-chart-id="${escaped}"([^>]*?)>`, 'g');
            processed = processed.replace(imgRegex, makeImg(chartId, url, width, height));
        });

        return processed;
    };

    const loadReport = (reportId: string) => {
        const report = allGeneratedReports.find(r => r.id === reportId);
        if (report) {
            setCurrentReportId(reportId);
            setGeneratedReport(report.content);
            setGeneratedStyle(report.style);

            report.selectedChartIds.forEach((chartId) => {
                const chart = charts.find(c => c.id === chartId);
                if (!chart) return;
                if (chart.chartType === 'Table' || chart.chartType === '?') return;

                // Try SVG cache first (instant, high quality)
                const cached = getCachedChart(chartId);
                if (cached?.svg) {
                    const blob = new Blob([cached.svg], { type: 'image/svg+xml;charset=utf-8' });
                    const blobUrl = URL.createObjectURL(blob);
                    updateCachedReportImages(chartId, blobUrl, config.defaultChartWidth, config.defaultChartHeight);
                    return;
                }

                // Fall back to full Vega render
                const chartTable = tables.find(t => t.id === chart.tableRef);
                if (!chartTable) return;
                getChartImageFromVega(chart, chartTable).then(({ blobUrl, width, height }) => {
                    if (blobUrl) {
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

    // Derive focused report ID from Redux state
    const focusedReportId = focusedId?.type === 'report' ? focusedId.reportId : undefined;

    // When focused report is cleared (e.g. user clicked compose button), switch to compose mode
    useEffect(() => {
        if (!focusedReportId && !isGenerating) {
            setMode('compose');
        }
    }, [focusedReportId]);

    // When a report is focused via the thread, load it automatically
    // Re-runs when charts/tables load so images render on initial page load
    useEffect(() => {
        if (focusedReportId) {
            loadReport(focusedReportId);
            if (mode !== 'post') setMode('post');
        }
    }, [focusedReportId, charts, tables]);

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

    // Use cached SVG (high-res) for chart previews, falling back to thumbnail PNG
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
            const cached = getCachedChart(chart.id);
            if (cached?.svg) {
                // Use SVG blob URL for crisp rendering at any size
                const blob = new Blob([cached.svg], { type: 'image/svg+xml;charset=utf-8' });
                newPreviewImages.set(chart.id, {
                    url: URL.createObjectURL(blob),
                    width: config.defaultChartWidth,
                    height: config.defaultChartHeight,
                });
            } else if (chart.thumbnail) {
                // Fallback to low-res thumbnail
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
                // Use canvas renderer for reliable PNG generation
                // (SVG → Image → Canvas pipeline can fail to render text and complex features)
                const scale = 2;
                const result = await embed(`#${tempId}`, assembledChart, { 
                    actions: false,
                    renderer: 'canvas',
                    scaleFactor: scale,
                });

                // Get high-resolution canvas directly from Vega
                const canvas = await result.view.toCanvas(scale);
                const displayWidth = Math.round(canvas.width / scale);
                const displayHeight = Math.round(canvas.height / scale);

                const dataUrl = canvas.toDataURL('image/png');

                // Create blob URL for display in the report
                const blob = await new Promise<Blob | null>((resolve) => {
                    canvas.toBlob(resolve, 'image/png');
                });
                const blobUrl = blob ? URL.createObjectURL(blob) : '';

                result.view.finalize();
                document.body.removeChild(tempDiv);

                return { dataUrl, blobUrl, width: displayWidth, height: displayHeight };
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
            showMessage(t('report.pleaseSelectChart'), 'error');
            return;
        }

        setIsGenerating(true);
        setGeneratedReport('');
        setGeneratedStyle(style);

        // Create a new report ID
        const reportId = `report-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

        // Save an in-progress report to Redux immediately so it appears in the thread
        const orderedChartIds = sortedCharts
            .filter(c => selectedChartIds.has(c.id))
            .map(c => c.id);
        const inProgressReport: GeneratedReport = {
            id: reportId,
            content: '',
            style: style,
            selectedChartIds: orderedChartIds,
            createdAt: Date.now(),
            status: 'generating',
        };
        dispatch(dfActions.saveGeneratedReport(inProgressReport));
        dispatch(dfActions.setFocused({ type: 'report', reportId }));
        setCurrentReportId(reportId);
        if (mode === 'compose') {
            setMode('post');
        }

        try {
            let model = activeModel;

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
                    totalRows: (tbl.virtual?.rowCount || tbl.rows.length).toLocaleString(),
                })
            ).join(', ');
            const truncationNote = truncatedTables.length > 0
                ? `\n\n${t('report.truncationNote', { maxRows: maxRows.toLocaleString(), list: truncationList })}`
                : '';


            let chartSeqIndex = 0;
            const seqToActualId: Record<string, string> = {};
            const capturedImages: Record<string, { blobUrl: string; width: number; height: number }> = {};
            const selectedCharts = await Promise.all(
                sortedCharts
                .filter(chart => selectedChartIds.has(chart.id))
                .map(async (chart) => {

                    const chartTable = tables.find(t => t.id === chart.tableRef);
                    if (!chartTable) return null;

                    if (chart.chartType === 'Table' || chart.chartType === '?') {
                        return null;
                    }

                    const seqKey = `chart${++chartSeqIndex}`;
                    seqToActualId[seqKey] = chart.id;
                    const { dataUrl, blobUrl, width, height } = await getChartImageFromVega(chart, chartTable);

                    if (blobUrl) {
                        capturedImages[chart.id] = { blobUrl, width, height };
                        updateCachedReportImages(chart.id, blobUrl, width, height);
                    }

                    return {
                        chart_id: seqKey,
                        code: chartTable.derive?.code || '',
                        chart_data: {
                            name: chartTable.id,
                            rows: chartTable.rows.length > maxRows ? chartTable.rows.slice(0, maxRows) : chartTable.rows
                        },
                        chart_url: dataUrl
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
                    let finalContent = accumulatedReport;
                    for (const [seqKey, actualId] of Object.entries(seqToActualId)) {
                        finalContent = finalContent.replace(
                            new RegExp(`\\[IMAGE\\(${seqKey}\\)\\]`, 'g'),
                            `[IMAGE(${actualId})]`
                        );
                    }
                    // Extract title from first markdown # heading
                    const finalTitleMatch = finalContent.match(/^#\s+(.+)$/m);
                    const finalTitle = finalTitleMatch ? finalTitleMatch[1].trim() : undefined;

                    const report: GeneratedReport = {
                        id: reportId,
                        content: finalContent,
                        style: style,
                        selectedChartIds: orderedChartIds,
                        createdAt: inProgressReport.createdAt,
                        status: 'completed',
                        title: finalTitle,
                    };
                    // Re-apply captured images so React 18 batches them
                    // with the final content update in a single render
                    for (const [chartId, { blobUrl, width, height }] of Object.entries(capturedImages)) {
                        updateCachedReportImages(chartId, blobUrl, width, height);
                    }
                    dispatch(dfActions.saveGeneratedReport(report));
                    setGeneratedReport(finalContent);
                    break;
                };

                const chunk = decoder.decode(value, { stream: true });
                
                if (chunk.startsWith('error:')) {
                    const errorData = JSON.parse(chunk.substring(6));
                    throw new Error(errorData.content || t('report.errorGeneratingReport'));
                }

                accumulatedReport += chunk;

                // Extract title from first markdown # heading
                const titleMatch = accumulatedReport.match(/^#\s+(.+)$/m);
                const extractedTitle = titleMatch ? titleMatch[1].trim() : undefined;

                // Update both local state and Redux for thread card preview
                setGeneratedReport(accumulatedReport);
                dispatch(dfActions.updateGeneratedReportContent({ id: reportId, content: accumulatedReport, title: extractedTitle }));
            }

        } catch (err) {
            showMessage((err as Error).message || t('report.failedToGenerateReport'), 'error');
            // Mark the in-progress report as errored (if it was created)
            dispatch(dfActions.updateGeneratedReportContent({ id: reportId, content: '', status: 'error' }));
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

    let displayedReport = generatedReport;
    displayedReport = processReport(displayedReport);

    return (
        <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {mode === 'compose' ? (
                <Box sx={{ overflowY: 'auto', position: 'relative', height: '100%' }}>
                    <Box sx={{ p: 2, pb: 0, display: 'flex' }}>
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
                                gap: 1.25,
                                px: 2,
                                py: 1,
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
                                    fontSize: '0.8125rem',
                                }
                            }}
                        >
                            {/* Natural Flow */}
                            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400 }}>
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
                                            px: 1.5,
                                            py: 0.5,
                                            textTransform: 'none',
                                            fontSize: '0.8125rem',
                                            fontWeight: 400,
                                            lineHeight: 1.5,
                                            minWidth: 'auto'
                                        }}
                                    >
                                        {option.value === 'live report' ? <StreamIcon sx={{ fontSize: 14, mr: 0.75 }} /> : <></>} {t(option.labelKey)}
                                    </ToggleButton>
                                ))}
                            </ToggleButtonGroup>

                            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400 }}>
                                {t('report.from')}
                            </Typography>
                            
                            <Typography variant="body2" 
                                color={selectedChartIds.size === 0 ? "warning.main" : 'primary.main'} sx={{ fontWeight: 'bold' }}>
                                {selectedChartIds.size}
                            </Typography>
                            
                            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400 }}>
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
                                    ml: 1.5,
                                    pl: 1.75,
                                    pr: 2.5,
                                    py: 0.625,
                                    borderRadius: '4px',
                                    fontWeight: 500,
                                    fontSize: '0.875rem',
                                    lineHeight: 1.5,
                                    minWidth: 'auto'
                                }}
                                startIcon={isGenerating ? <CircularProgress size={12} /> : <EditIcon sx={{ fontSize: 14 }} />}
                            >
                                {isGenerating ? t('report.composing') : t('report.compose')}
                            </Button>
                        </Paper>
                    </Box>
                    
                    <Box sx={{ py: 2, px: 6 }}>
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
                <Box sx={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
                    {/* Floating action buttons — left side */}
                    <Box sx={{
                        position: 'absolute',
                        top: 12,
                        left: 12,
                        zIndex: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                    }}>
                        <Tooltip title={t('report.createNewReport')} placement="right">
                            <IconButton
                                size="small"
                                disabled={isGenerating}
                                onClick={() => setMode('compose')}
                                sx={{
                                    backgroundColor: 'background.paper',
                                    boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                                    '&:hover': { backgroundColor: 'action.hover' },
                                }}
                            >
                                <ArrowBackIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                        </Tooltip>
                        {currentReportId && (
                            <>
                                <Tooltip title={copyButtonSuccess ? t('report.copied') : t('report.copyContent')} placement="right">
                                    <IconButton
                                        size="small"
                                        color={copyButtonSuccess ? 'success' : 'default'}
                                        onClick={async () => {
                                            const reportEl = document.querySelector('[data-report-content]') as HTMLElement;
                                            if (!reportEl) return;
                                            try {
                                                // Clone the report and sanitize for external paste targets
                                                const clone = reportEl.cloneNode(true) as HTMLElement;

                                                // Inline all images as base64 data URLs so they survive
                                                // clipboard paste into Word, Google Docs, etc.
                                                const imgs = clone.querySelectorAll('img');
                                                await Promise.all(Array.from(imgs).map(async (img) => {
                                                    try {
                                                        const src = (reportEl.querySelector(`img[src="${CSS.escape(img.getAttribute('src') || '')}"]`) as HTMLImageElement)
                                                            || (reportEl.querySelector(`img[data-chart-id="${CSS.escape(img.getAttribute('data-chart-id') || '')}"]`) as HTMLImageElement);
                                                        if (!src || !src.complete || src.naturalWidth === 0) return;
                                                        const canvas = document.createElement('canvas');
                                                        canvas.width = src.naturalWidth;
                                                        canvas.height = src.naturalHeight;
                                                        const ctx = canvas.getContext('2d');
                                                        if (!ctx) return;
                                                        ctx.drawImage(src, 0, 0);
                                                        img.setAttribute('src', canvas.toDataURL('image/png'));
                                                    } catch {
                                                        // Cross-origin or tainted canvas — keep original src
                                                    }
                                                }));

                                                // Strip Tiptap/ProseMirror attributes that external apps
                                                // (Google Docs, Word) may misinterpret as links or styles
                                                clone.querySelectorAll('*').forEach(el => {
                                                    el.removeAttribute('contenteditable');
                                                    el.removeAttribute('draggable');
                                                    el.removeAttribute('data-node-type');
                                                    el.removeAttribute('data-type');
                                                    el.removeAttribute('data-chart-id');
                                                    // Remove all data- attributes
                                                    Array.from(el.attributes).forEach(attr => {
                                                        if (attr.name.startsWith('data-')) {
                                                            el.removeAttribute(attr.name);
                                                        }
                                                    });
                                                    // Remove Tiptap/ProseMirror classes
                                                    if (el.getAttribute('class')?.match(/ProseMirror|tiptap|node-/)) {
                                                        el.removeAttribute('class');
                                                    }
                                                });

                                                const html = clone.innerHTML;
                                                const text = reportEl.innerText;
                                                await navigator.clipboard.write([
                                                    new ClipboardItem({
                                                        'text/html': new Blob([html], { type: 'text/html' }),
                                                        'text/plain': new Blob([text], { type: 'text/plain' }),
                                                    }),
                                                ]);
                                                setCopyButtonSuccess(true);
                                                setTimeout(() => setCopyButtonSuccess(false), 2000);
                                            } catch (e) {
                                                console.warn('Failed to copy report content:', e);
                                            }
                                        }}
                                        sx={{
                                            backgroundColor: 'background.paper',
                                            boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                                            '&:hover': { backgroundColor: 'action.hover' },
                                        }}
                                    >
                                        {copyButtonSuccess ? <CheckCircleIcon sx={{ fontSize: 18 }} /> : <ContentCopyIcon sx={{ fontSize: 18 }} />}
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title={t('report.deleteReport')} placement="right">
                                    <IconButton
                                        size="small"
                                        onClick={(e) => deleteReport(currentReportId, e)}
                                        sx={{
                                            backgroundColor: 'background.paper',
                                            boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                                            color: 'error.main',
                                            '&:hover': { backgroundColor: 'error.50' },
                                        }}
                                    >
                                        <DeleteIcon sx={{ fontSize: 18 }} />
                                    </IconButton>
                                </Tooltip>
                            </>
                        )}
                    </Box>
                    {/* Continuous canvas — content flows cleanly */}
                    <Box sx={{ 
                        height: '100%', overflow: 'auto', 
                        display: 'flex', justifyContent: 'center',
                    }}>
                        <Box
                            data-report-content
                            sx={{
                                width: '100%',
                                maxWidth: '816px',
                                display: 'flex',
                                flexDirection: 'column',
                                minHeight: 'fit-content',
                                alignSelf: 'flex-start',
                            }}
                        >
                            <TiptapReportEditor
                                content={displayedReport}
                                editable={!isGenerating}
                                reportId={currentReportId}
                                onUpdate={(html) => {
                                    if (currentReportId) {
                                        setGeneratedReport(html);
                                        dispatch(dfActions.updateGeneratedReportContent({ id: currentReportId, content: html }));
                                    }
                                }}
                            />
                            
                            {/* Attribution */}
                            <Typography sx={{ 
                                px: 3, pb: 2,
                                textAlign: 'center',
                                fontSize: '0.7rem',
                                color: 'text.disabled',
                            }}>
                                {t('report.createdWithAI')}{' '}
                                <Link 
                                    href="https://github.com/microsoft/data-formulator" 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    sx={{ 
                                        color: 'text.disabled',
                                        textDecoration: 'none',
                                        '&:hover': {
                                            textDecoration: 'underline'
                                        }
                                    }}
                                >
                                    https://github.com/microsoft/data-formulator
                                </Link>
                            </Typography>
                        </Box>
                    </Box>
                </Box>
            ) : null}
        </Box>
    );
};

