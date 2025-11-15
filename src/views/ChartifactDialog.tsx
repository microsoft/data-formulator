// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    TextField,
    Box,
} from '@mui/material';
import { Chart, DictTable, FieldItem } from '../components/ComponentType';
import { assembleVegaChart, prepVisTable, exportTableToDsv } from '../app/utils';

// Chartifact library type declarations
interface SpecReview<T> {
    pluginName: string;
    containerId: string;
    approvedSpec: T;
    blockedSpec?: T;
    reason?: string;
}

interface SandboxedPreHydrateMessage {
    type: 'sandboxedPreHydrate';
    transactionId: number;
    specs: SpecReview<{}>[];
}

interface SandboxOptions {
    onReady?: () => void;
    onError?: (error: Error) => void;
    onApprove: (message: SandboxedPreHydrateMessage) => SpecReview<{}>[];
}

interface ChartifactSandbox {
    options: SandboxOptions;
    element: HTMLElement;
    iframe: HTMLIFrameElement;
    destroy(): void;
    send(markdown: string): void;
}

interface ChartifactHtmlWrapper {
    htmlMarkdownWrapper: (title: string, markdown: string) => string;
    htmlJsonWrapper: (title: string, json: string) => string;
}

const chartifactScripts = [
    'https://microsoft.github.io/chartifact/dist/v1/chartifact.sandbox.umd.js',
    'https://microsoft.github.io/chartifact/dist/v1/chartifact.html-wrapper.umd.js'
];

// Type declarations for Chartifact global
declare global {
    interface Window {
        Chartifact?: {
            sandbox: {
                Sandbox: new (
                    elementOrSelector: string | HTMLElement,
                    markdown: string,
                    options: SandboxOptions
                ) => ChartifactSandbox;
            };
            htmlWrapper: ChartifactHtmlWrapper;
        };
    }
}

interface ChartifactDialogProps {
    open: boolean;
    onClose: () => void;
    reportContent: string;
    reportStyle: string;
    charts: Chart[];
    tables: DictTable[];
    conceptShelfItems: FieldItem[];
    config: { defaultChartWidth: number; defaultChartHeight: number };
}

export const ChartifactDialog: FC<ChartifactDialogProps> = ({
    open,
    onClose,
    reportContent,
    reportStyle,
    charts,
    tables,
    conceptShelfItems,
    config
}) => {
    const [source, setSource] = useState('');
    const [isConverting, setIsConverting] = useState(false);
    const [chartifactLoaded, setChartifactLoaded] = useState(false);
    const [sandboxReady, setSandboxReady] = useState(false);
    const [parentElement, setParentElement] = useState<HTMLDivElement | null>(null);
    const sandboxRef = useRef<ChartifactSandbox | null>(null);

    // Load Chartifact scripts
    const loadChartifactScripts = async (): Promise<void> => {
        // Check if Chartifact is already loaded
        if (window.Chartifact?.sandbox && window.Chartifact?.htmlWrapper) {
            setChartifactLoaded(true);
            return;
        }

        try {
            for (const src of chartifactScripts) {
                await new Promise<void>((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = src;
                    script.onload = () => resolve();
                    script.onerror = () => reject(new Error(`Failed to load ${src}`));
                    document.head.appendChild(script);
                });
            }

            // Verify that Chartifact was loaded correctly
            if (window.Chartifact?.sandbox && window.Chartifact?.htmlWrapper) {
                setChartifactLoaded(true);
            } else {
                throw new Error('Chartifact namespace not found after loading scripts');
            }
        } catch (error) {
            console.error('Error loading Chartifact scripts:', error);
            throw error;
        }
    };

    // Initialize Chartifact sandbox
    const initializeSandbox = () => {
        if (!chartifactLoaded || !parentElement || !source) {
            return;
        }

        try {
            sandboxRef.current = new window.Chartifact!.sandbox.Sandbox(parentElement, source, {
                onReady: () => {
                    setSandboxReady(true);
                },
                onError: (error: any) => {
                    console.error('Sandbox error:', error);
                },
                onApprove: (message: any) => {
                    //TODO policy to approve unapproved on localhost
                    const { specs } = message;
                    return specs;
                },
            });
        } catch (error) {
            console.error('Error initializing Chartifact sandbox:', error);
        }
    };

    // Check if sandbox is functional
    const isSandboxFunctional = (): boolean => {
        if (!sandboxRef.current || !sandboxRef.current.iframe) {
            return false;
        }

        const iframe = sandboxRef.current.iframe;
        const contentWindow = iframe.contentWindow;

        // Only recreate if we have clear evidence of a broken iframe
        // Missing contentWindow is a clear sign of tombstoning
        if (!contentWindow) {
            return false;
        }

        // Missing or invalid src indicates a problem
        if (!iframe.src || iframe.src === 'about:blank') {
            return false;
        }

        // For normal cases (including blob URLs), assume functional to preserve user state
        // Only the clear failures above will trigger recreation
        return true;
    };    // Load scripts when dialog opens
    useEffect(() => {
        if (open && !chartifactLoaded) {
            loadChartifactScripts();
        }
    }, [open, chartifactLoaded]);

    // Initialize sandbox when dialog opens with all requirements ready
    useEffect(() => {
        if (open && chartifactLoaded && source && parentElement) {
            if (!isSandboxFunctional() || !sandboxReady) {
                // Destroy existing sandbox before creating new one
                if (sandboxRef.current) {
                    if (sandboxRef.current.destroy) {
                        sandboxRef.current.destroy();
                    }
                    sandboxRef.current = null;
                    setSandboxReady(false);
                }
                initializeSandbox();
            } else if (sandboxRef.current) {
                sandboxRef.current.send(source);
            }
        }

        // Cleanup function runs when dialog closes or component unmounts
        return () => {
            if (!open && sandboxRef.current) {
                if (sandboxRef.current.destroy) {
                    sandboxRef.current.destroy();
                }
                sandboxRef.current = null;
                setSandboxReady(false);
            }
        };
    }, [open, chartifactLoaded, source, parentElement]);

    // Function to convert report markdown to Chartifact format
    const convertToChartifact = async (reportMarkdown: string): Promise<string> => {
        try {
            // Extract chart IDs from the report markdown images
            // Images are in format: [IMAGE(chart-id)]
            const imageRegex = /\[IMAGE\(([^)]+)\)\]/g;
            let result = reportMarkdown;
            let match;
            const chartReplacements: Array<{ original: string; specReplacement: string; dataName: string; csvContent: string }> = [];

            while ((match = imageRegex.exec(reportMarkdown)) !== null) {
                const [fullMatch, chartId] = match;

                // Find the chart in the store using the chart ID
                const chart = charts.find(c => c.id === chartId);
                if (!chart) {
                    console.warn(`Chart with id ${chartId} not found in store`);
                    continue;
                }

                // Get the chart's data table from the store using chart.tableRef
                const chartTable = tables.find(t => t.id === chart.tableRef);
                if (!chartTable) {
                    console.warn(`Table for chart ${chartId} not found`);
                    continue;
                }

                // Skip non-visual chart types
                if (chart.chartType === 'Table' || chart.chartType === '?') {
                    continue;
                }

                try {
                    // Preprocess the data for aggregations
                    const processedRows = prepVisTable(chartTable.rows, conceptShelfItems, chart.encodingMap);

                    // Assemble the Vega-Lite spec
                    const vegaSpec = assembleVegaChart(
                        chart.chartType,
                        chart.encodingMap,
                        conceptShelfItems,
                        processedRows,
                        chartTable.metadata,
                        30,
                        true,
                        config.defaultChartWidth,
                        config.defaultChartHeight,
                        true
                    );

                    // Convert the spec to use named data source
                    const dataName = `chartData_${chartId.replace(/[^a-zA-Z0-9]/g, '_')}`;
                    const modifiedSpec = {
                        ...vegaSpec,
                        data: { name: dataName }
                    };

                    // Convert table rows to CSV format using the utility function
                    const csvContent = exportTableToDsv(chartTable, ',');

                    // Create the Chartifact spec replacement (without CSV)
                    const specReplacement = `

\`\`\`json vega-lite
${JSON.stringify(modifiedSpec, null, 2)}
\`\`\`
`;

                    chartReplacements.push({
                        original: fullMatch,
                        specReplacement,
                        dataName,
                        csvContent
                    });
                } catch (error) {
                    console.error(`Error processing chart ${chartId}:`, error);
                }
            }

            // Apply spec replacements to the markdown
            for (const { original, specReplacement } of chartReplacements) {
                result = result.replace(original, specReplacement);
            }

            result += '\n\n---\ncreated with AI using [Data Formulator](https://github.com/microsoft/data-formulator)\n\n';

            // Prepend CSS styling based on report type
            const cssStyles = generateStyleCSS(reportStyle);
            result += cssStyles;

            // Append all CSV data blocks at the bottom
            if (chartReplacements.length > 0) {
                result += '\n\n';
                for (const { dataName, csvContent } of chartReplacements) {
                    result += `\n\`\`\`csv ${dataName}\n${csvContent}\n\`\`\`\n`;
                }
            }

            return result;
        } catch (error) {
            console.error('Error converting to Chartifact:', error);
            throw error;
        }
    };

    // Convert report content when dialog opens
    useEffect(() => {
        if (open && reportContent) {
            setIsConverting(true);
            convertToChartifact(reportContent)
                .then(chartifactMarkdown => {
                    setSource(chartifactMarkdown);
                    setIsConverting(false);
                })
                .catch(error => {
                    console.error('Error converting to Chartifact:', error);
                    setSource('Error converting report to Chartifact format');
                    setIsConverting(false);
                });
        }
    }, [open, reportContent]);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="xl"
            fullWidth
            PaperProps={{
                sx: {
                    minHeight: '90vh',
                    maxHeight: '90vh',
                }
            }}
        >
            <DialogTitle>
                <Typography variant="h5" component="div">
                    Chartifact Report
                </Typography>
            </DialogTitle>
            <DialogContent dividers sx={{ display: 'flex', flexDirection: 'row', gap: 2, p: 2, overflow: 'hidden' }}>
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
                    <Typography variant="body2" color="text.secondary">
                        Source
                    </Typography>
                    <TextField
                        multiline
                        fullWidth
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                        placeholder={isConverting ? "Converting report to Chartifact format..." : "Enter the report source here..."}
                        variant="outlined"
                        disabled={isConverting}
                        sx={{
                            flex: 1,
                            minHeight: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            '& .MuiInputBase-root': {
                                height: '100%',
                                alignItems: 'flex-start',
                                overflow: 'hidden',
                            },
                            '& .MuiInputBase-input': {
                                fontFamily: 'monospace',
                                fontSize: '0.875rem',
                                overflow: 'auto !important',
                                height: '100% !important',
                            }
                        }}
                    />
                </Box>
                <Box
                    sx={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        minHeight: 0
                    }}
                >
                    <Typography variant="body2" color="text.secondary">
                        Preview
                    </Typography>
                    <Box
                        ref={setParentElement}
                        sx={{
                            flex: 1,
                            minHeight: 0,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            overflow: 'auto',
                            position: 'relative',
                            '& > iframe': {
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                border: 'none',
                            }
                        }}
                    />
                </Box>
            </DialogContent>
            <DialogActions sx={{ justifyContent: 'space-between', px: 3, py: 2 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                    <a href="https://microsoft.github.io/chartifact/" target="_blank" rel="noopener noreferrer">
                        Learn more about Chartifact
                    </a>
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                        onClick={() => {
                            const blob = new Blob([source], { type: 'text/markdown' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'chartifact-report.idoc.md';
                            a.click();
                            URL.revokeObjectURL(url);
                        }}
                        disabled={!source}
                    >
                        Download Markdown
                    </Button>
                    <Button
                        onClick={() => {
                            if (window.Chartifact?.htmlWrapper) {
                                const html = window.Chartifact.htmlWrapper.htmlMarkdownWrapper('Chartifact Report', source);
                                const blob = new Blob([html], { type: 'text/html' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = 'chartifact-report.html';
                                a.click();
                                URL.revokeObjectURL(url);
                            }
                        }}
                        disabled={!source || !chartifactLoaded}
                    >
                        Download HTML
                    </Button>
                    <Button onClick={onClose} color="primary">
                        Close
                    </Button>
                </Box>
            </DialogActions>
        </Dialog>
    );
};

// Function to generate CSS styling based on report type
const generateStyleCSS = (style: string): string => {
    // Font families
    const FONT_FAMILY_SYSTEM = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif';
    const FONT_FAMILY_SERIF = 'Georgia, Cambria, "Times New Roman", Times, serif';
    const FONT_FAMILY_MONO = '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

    if (style === 'social post' || style === 'short note') {
        // Twitter/X style - compact, modern
        return `\`\`\`css
body {
    margin: 20px;
    padding: 20px;
    background-color: white;
    border: 1px solid rgb(207, 217, 222);
    border-radius: 12px;
    font-family: ${FONT_FAMILY_SYSTEM};
    font-size: 0.875rem;
    font-weight: 400;
    line-height: 1.4;
    color: rgb(15, 20, 25);
}

h1, h2, h3, h4, h5, h6 {
    color: rgb(15, 20, 25);
    font-weight: 700;
}

code {
    background-color: rgba(29, 155, 240, 0.1);
    color: rgb(29, 155, 240);
    padding: 0.1em 0.25em;
    border-radius: 3px;
    font-size: 0.8125rem;
    font-weight: 500;
    font-family: ${FONT_FAMILY_MONO};
}

strong {
    font-weight: 600;
    color: rgb(15, 20, 25);
}
\`\`\`

`;
    } else if (style === 'executive summary') {
        // Professional/business look
        return `\`\`\`css
body {
    max-width: 700px;
    margin: 20px auto;
    padding: 20px;
    background-color: white;
    font-family: ${FONT_FAMILY_SERIF};
    font-size: 0.875rem;
    line-height: 1.5;
    color: rgb(33, 37, 41);
}

h1, h2, h3, h4, h5, h6 {
    color: rgb(20, 24, 28);
    font-weight: 600;
}

code {
    background-color: rgb(248, 249, 250);
    color: rgb(0, 123, 255);
    padding: 0.1em 0.25em;
    border-radius: 2px;
    font-size: 0.75rem;
    font-family: ${FONT_FAMILY_MONO};
}

strong {
    font-weight: 600;
    color: rgb(20, 24, 28);
}
\`\`\`

`;
    } else {
        // Default "blog post" style - Notion-like
        return `\`\`\`css
body {
    max-width: 800px;
    margin: 20px auto;
    padding: 0 48px;
    background-color: #ffffff;
    font-family: ${FONT_FAMILY_SYSTEM};
    font-size: 0.9375rem;
    line-height: 1.75;
    font-weight: 400;
    letter-spacing: 0.003em;
    color: rgb(55, 53, 47);
}

h1, h2, h3, h4, h5, h6 {
    color: rgb(37, 37, 37);
    font-weight: 700;
    letter-spacing: -0.01em;
}

code {
    background-color: rgba(135, 131, 120, 0.15);
    color: #eb5757;
    padding: 0.2em 0.4em;
    border-radius: 3px;
    font-size: 0.875rem;
    font-weight: 500;
    font-family: ${FONT_FAMILY_MONO};
}

strong {
    font-weight: 600;
    color: rgb(37, 37, 37);
}
\`\`\`

`;
    }
};