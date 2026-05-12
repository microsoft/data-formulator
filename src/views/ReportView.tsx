// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useRef, useEffect } from 'react';
import {
    Box,
    Typography,
    IconButton,
    Link,
    Tooltip,
    useTheme,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
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
    const [copyButtonSuccess, setCopyButtonSuccess] = useState(false);
    const [imageCopyButtonSuccess, setImageCopyButtonSuccess] = useState(false);

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

    const getReportElement = (): HTMLElement | null => {
        return document.querySelector('[data-report-content]') as HTMLElement | null;
    };

    const createReportExportClone = (): { reportElement: HTMLElement; clone: HTMLElement } | null => {
        const reportElement = getReportElement();
        if (!reportElement) {
            showMessage(t('report.couldNotFindContent'), 'error');
            return null;
        }

        const clone = reportElement.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('[data-report-toolbar]').forEach(el => el.remove());
        clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
        return { reportElement, clone };
    };

    const getReportTitle = (root?: ParentNode | null): string => {
        const source = root || getReportElement();
        const titleText = source?.querySelector('h1, h2, h3')?.textContent
            || source?.querySelector('p')?.textContent
            || currentReport?.content?.split('\n').find(line => line.trim().length > 0)
            || t('report.untitled');

        return titleText
            .replace(/```markdown|```/g, '')
            .replace(/^#+\s*/, '')
            .trim()
            || t('report.untitled');
    };

    const sanitizeFileName = (name: string): string => {
        const sanitized = name
            .replace(/[\\/:*?"<>|]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/[. ]+$/g, '')
            .slice(0, 80);

        return sanitized || t('report.untitled');
    };

    const getReportFileName = (extension: string): string => {
        const date = new Date().toISOString().slice(0, 10);
        return `${sanitizeFileName(getReportTitle())}-${date}.${extension}`;
    };

    const renderReportToCanvas = async (): Promise<HTMLCanvasElement | null> => {
        const exportClone = createReportExportClone();
        if (!exportClone) return null;

        const { reportElement, clone } = exportClone;
        clone.style.position = 'fixed';
        clone.style.left = '-10000px';
        clone.style.top = '0';
        clone.style.width = `${reportElement.scrollWidth}px`;
        clone.style.maxWidth = `${reportElement.scrollWidth}px`;
        clone.style.backgroundColor = '#ffffff';
        clone.style.pointerEvents = 'none';
        document.body.appendChild(clone);

        try {
            return await html2canvas(clone, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                allowTaint: true,
                scrollX: 0,
                scrollY: 0,
                width: clone.scrollWidth + 4,
                height: clone.scrollHeight + 4,
                logging: false
            });
        } finally {
            clone.remove();
        }
    };

    const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> => {
        return new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.95));
    };

    const getClipboardUnavailableMessage = (): string => {
        if (!window.isSecureContext) {
            return t('report.clipboardRequiresSecureContext');
        }
        return t('report.clipboardNotSupported');
    };

    const canWriteToClipboard = (): boolean => {
        return window.isSecureContext
            && !!navigator.clipboard?.write
            && typeof ClipboardItem !== 'undefined';
    };

    const copyReportContent = async () => {
        if (!canWriteToClipboard()) {
            showMessage(getClipboardUnavailableMessage(), 'error');
            return;
        }

        const exportClone = createReportExportClone();
        if (!exportClone) return;

        const { reportElement, clone } = exportClone;
        try {
            // Inline chart images so they survive paste into Word, Google Docs, etc.
            const imgs = clone.querySelectorAll('img');
            await Promise.all(Array.from(imgs).map(async (img) => {
                try {
                    const src = (reportElement.querySelector(`img[src="${CSS.escape(img.getAttribute('src') || '')}"]`) as HTMLImageElement)
                        || (reportElement.querySelector(`img[data-chart-id="${CSS.escape(img.getAttribute('data-chart-id') || '')}"]`) as HTMLImageElement);
                    if (!src || !src.complete || src.naturalWidth === 0) return;
                    const canvas = document.createElement('canvas');
                    canvas.width = src.naturalWidth;
                    canvas.height = src.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return;
                    ctx.drawImage(src, 0, 0);
                    img.setAttribute('src', canvas.toDataURL('image/png'));
                } catch {
                    // Cross-origin or tainted canvas: keep original src.
                }
            }));

            // Strip editor-only attributes/classes that external apps may misinterpret.
            clone.querySelectorAll('*').forEach(el => {
                el.removeAttribute('contenteditable');
                el.removeAttribute('draggable');
                el.removeAttribute('data-node-type');
                el.removeAttribute('data-type');
                el.removeAttribute('data-chart-id');
                Array.from(el.attributes).forEach(attr => {
                    if (attr.name.startsWith('data-')) {
                        el.removeAttribute(attr.name);
                    }
                });
                if (el.getAttribute('class')?.match(/ProseMirror|tiptap|node-/)) {
                    el.removeAttribute('class');
                }
            });

            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([clone.innerHTML], { type: 'text/html' }),
                    'text/plain': new Blob([clone.innerText], { type: 'text/plain' }),
                }),
            ]);
            setCopyButtonSuccess(true);
            setTimeout(() => setCopyButtonSuccess(false), 2000);
        } catch (e) {
            console.warn('Failed to copy report content:', e);
            showMessage(t('report.failedToCopyClipboard'), 'error');
        }
    };

    const copyReportAsImage = async () => {
        if (!canWriteToClipboard()) {
            showMessage(getClipboardUnavailableMessage(), 'error');
            return;
        }

        try {
            const canvas = await renderReportToCanvas();
            if (!canvas) return;
            const blob = await canvasToBlob(canvas);
            if (!blob) {
                showMessage(t('report.failedToGenerateImage'), 'error');
                return;
            }

            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
            showMessage(t('report.imageCopied'));
            setImageCopyButtonSuccess(true);
            setTimeout(() => setImageCopyButtonSuccess(false), 2000);
        } catch (error) {
            console.error('Error generating report image:', error);
            showMessage(t('report.failedToGenerateReportImage'), 'error');
        }
    };

    const downloadReportAsPng = async () => {
        try {
            const canvas = await renderReportToCanvas();
            if (!canvas) return;
            const blob = await canvasToBlob(canvas);
            if (!blob) {
                showMessage(t('report.failedToGenerateImage'), 'error');
                return;
            }

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = getReportFileName('png');
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 0);
            showMessage(t('report.pngDownloaded'));
        } catch (error) {
            console.error('Error downloading report image:', error);
            showMessage(t('report.failedToDownloadPng'), 'error');
        }
    };

    const waitForImages = async (root: ParentNode) => {
        const imgs = Array.from(root.querySelectorAll('img')) as HTMLImageElement[];
        await Promise.all(imgs.map(img => {
            if (img.complete && img.naturalWidth !== 0) return Promise.resolve();
            return new Promise<void>(resolve => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
            });
        }));
    };

    const exportReportAsPdf = async () => {
        const exportClone = createReportExportClone();
        if (!exportClone) return;

        const printFrame = document.createElement('iframe');
        printFrame.style.position = 'fixed';
        printFrame.style.right = '0';
        printFrame.style.bottom = '0';
        printFrame.style.width = '0';
        printFrame.style.height = '0';
        printFrame.style.border = '0';
        document.body.appendChild(printFrame);

        try {
            const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
                .map(node => node.outerHTML)
                .join('\n');
            const printTitle = sanitizeFileName(getReportTitle(exportClone.clone));
            const originalDocumentTitle = document.title;
            const doc = printFrame.contentDocument;
            const win = printFrame.contentWindow;
            if (!doc || !win) {
                showMessage(t('report.failedToExportPdf'), 'error');
                printFrame.remove();
                return;
            }

            doc.open();
            doc.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${printTitle}</title>
${styles}
<style>
    @page { margin: 18mm; }
    html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: rgb(55, 53, 47);
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .print-root {
        width: 100%;
        max-width: 816px;
        margin: 0 auto;
        background: #ffffff;
    }
    [data-report-toolbar] {
        display: none !important;
    }
    [data-report-content], [data-report-content] * {
        overflow: visible !important;
        max-height: none !important;
    }
    .tiptap {
        outline: none !important;
    }
    img {
        max-width: 100%;
        break-inside: avoid;
        page-break-inside: avoid;
    }
    h1, h2, h3 {
        break-after: avoid;
        page-break-after: avoid;
    }
    p, li, blockquote {
        orphans: 3;
        widows: 3;
    }
</style>
</head>
<body>
    <div class="print-root">
        ${exportClone.clone.outerHTML}
    </div>
</body>
</html>`);
            doc.close();

            await waitForImages(doc);
            document.title = printTitle;
            win.focus();
            let cleanupTimer: number | undefined;
            const cleanupPrintFrame = () => {
                if (cleanupTimer) {
                    window.clearTimeout(cleanupTimer);
                }
                document.title = originalDocumentTitle;
                if (document.body.contains(printFrame)) {
                    printFrame.remove();
                }
            };
            win.addEventListener('afterprint', cleanupPrintFrame, { once: true });
            cleanupTimer = window.setTimeout(cleanupPrintFrame, 5 * 60 * 1000);
            win.print();
            showMessage(t('report.pdfPrintOpened'), 'info');
        } catch (error) {
            console.error('Error exporting report PDF:', error);
            printFrame.remove();
            showMessage(t('report.failedToExportPdf'), 'error');
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
                                onCopyContent={currentReportId ? copyReportContent : undefined}
                                onCopyImage={currentReportId ? copyReportAsImage : undefined}
                                onDownloadPng={currentReportId ? downloadReportAsPng : undefined}
                                onExportPdf={currentReportId ? exportReportAsPdf : undefined}
                                copyContentSuccess={copyButtonSuccess}
                                copyImageSuccess={imageCopyButtonSuccess}
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

