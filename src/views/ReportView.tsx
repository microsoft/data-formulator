// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useRef, useEffect } from 'react';
import {
    Box,
    Typography,
    IconButton,
    CircularProgress,
    Link,
    Tooltip,
    useTheme,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import html2canvas from 'html2canvas';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors, GeneratedReport } from '../app/dfSlice';
import { Message } from './MessageSnackbar';
import { DictTable } from '../components/ComponentType';
import { AppDispatch } from '../app/store';
import { TiptapReportEditor } from './TiptapReportEditor';
import { getCachedChart } from '../app/chartCache';
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

    const [currentReportId, setCurrentReportId] = useState<string | undefined>(undefined);
    const [generatedReport, setGeneratedReport] = useState<string>('');

    // Derive generating state from the current report's status in Redux
    const currentReport = allGeneratedReports.find(r => r.id === currentReportId);
    const isGenerating = currentReport?.status === 'generating';

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

        const makeImg = (chartId: string, url: string, width: number, height: number, caption?: string) => {
            return `<img src="${url}" alt="${caption || t('report.chartAlt')}" data-chart-id="${chartId}" width="${width}" height="${height}" style="max-width:100%;" />`;
        };

        // Process ![caption](chart://chart_id) syntax
        processed = processed.replace(/!\[([^\]]*)\]\(chart:\/\/([^)]+)\)/g, (_match, caption, chartId) => {
            const cached = cachedReportImages[chartId];
            if (cached) {
                return makeImg(chartId, cached.url, cached.width, cached.height, caption);
            }
            // Placeholder while image loads
            return `<p style="text-align:center;color:#999;padding:16px 0;">📊 ${caption || chartId}</p>`;
        });

        // Legacy: Process [IMAGE(chart_id)] syntax (backward compatibility)
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
                } else if (chart.thumbnail) {
                    // Fall back to thumbnail
                    updateCachedReportImages(chartId, chart.thumbnail, config.defaultChartWidth, config.defaultChartHeight);
                }
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

    // When focused report is cleared, go back to editor view
    useEffect(() => {
        if (!focusedReportId && !isGenerating) {
            dispatch(dfActions.setViewMode('editor'));
        }
    }, [focusedReportId]);

    // When a report is focused via the thread, load it automatically
    // Re-runs when charts/tables load so images render on initial page load.
    // Includes a delayed retry to handle the race condition where
    // ChartRenderService hasn't produced thumbnails/SVGs yet on page refresh.
    useEffect(() => {
        if (focusedReportId) {
            loadReport(focusedReportId);

            // Retry after a short delay to catch charts that were still rendering
            const timer = setTimeout(() => loadReport(focusedReportId), 800);
            return () => clearTimeout(timer);
        }
    }, [focusedReportId, charts, tables]);

    // Keep local content in sync with Redux during streaming (status === 'generating')
    useEffect(() => {
        if (currentReport && currentReport.status === 'generating') {
            setGeneratedReport(currentReport.content);
        }
    }, [currentReport?.content, currentReport?.status]);

    // Auto-refresh chart images when underlying table data changes
    // This enables real-time chart updates in reports when data is streaming
    const tableRowSignaturesRef = useRef<Map<string, string>>(new Map());
    
    useEffect(() => {
        if (!currentReportId) return;
        
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

                const cached = getCachedChart(chart.id);
                if (cached?.svg) {
                    const blob = new Blob([cached.svg], { type: 'image/svg+xml;charset=utf-8' });
                    updateCachedReportImages(chart.id, URL.createObjectURL(blob), config.defaultChartWidth, config.defaultChartHeight);
                } else if (chart.thumbnail) {
                    updateCachedReportImages(chart.id, chart.thumbnail, config.defaultChartWidth, config.defaultChartHeight);
                }
            });
        }
    }, [tables, currentReportId, allGeneratedReports, charts]);


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
                // No reports left, go back to editor
                setCurrentReportId(undefined);
                setGeneratedReport('');
                dispatch(dfActions.setViewMode('editor'));
            }
        }
    };

    let displayedReport = generatedReport;
    displayedReport = processReport(displayedReport);

    return (
        <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                        <Tooltip title={t('report.backToEditor')} placement="right">
                            <IconButton
                                size="small"
                                onClick={() => dispatch(dfActions.setViewMode('editor'))}
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
            </Box>
    );
};

