// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Chart, DictTable, FieldItem } from '../components/ComponentType';
import { assembleVegaChart, prepVisTable } from '../app/utils';
import { exportTableToDsv } from '../data/utils';
import { ClientConfig } from '../app/dfSlice';

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

// Function to convert report markdown to Chartifact format
export const convertToChartifact = (reportMarkdown: string, reportStyle: string, charts: Chart[], tables: DictTable[], conceptShelfItems: FieldItem[], config: ClientConfig) => {
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


// Function to open Chartifact in a new tab and send markdown via postMessage
export const openChartifactViewer = async (chartifactMarkdown: string) => {
    try {
        // Open the Chartifact viewer in a new tab
        const chartifactWindow = window.open(
            'https://microsoft.github.io/chartifact/view/?post',
            '_blank'
        );

        if (!chartifactWindow) {
            //showMessage('Failed to open Chartifact viewer. Please allow popups.', 'error');
            return;
        }

        // Listen for hostStatus messages from the Chartifact viewer
        const handleMessage = (event: MessageEvent) => {
            // Verify the message is from the Chartifact viewer
            if (event.origin !== 'https://microsoft.github.io') {
                return;
            }

            const message = event.data;

            // Check if this is a hostStatus message
            if (message.type === 'hostStatus' && message.hostStatus === 'ready') {
                // Send the render request when the host is ready
                const renderRequest: {
                    type: 'hostRenderRequest';
                    title: string;
                    markdown?: string;
                    interactiveDocument?: any;
                } = {
                    type: 'hostRenderRequest',
                    title: 'Data Formulator Report',
                    markdown: chartifactMarkdown
                };

                chartifactWindow.postMessage(renderRequest, 'https://microsoft.github.io');

                //Call here to show source
                const toolbarControl: {
                    type: 'hostToolbarControl';
                    showSource?: boolean;
                } = {
                    type: 'hostToolbarControl',
                    showSource: true
                };

                chartifactWindow.postMessage(toolbarControl, 'https://microsoft.github.io');
                
                // Remove the event listener after sending
                window.removeEventListener('message', handleMessage);
            }
        };

        // Add event listener for messages from the Chartifact viewer
        window.addEventListener('message', handleMessage);

        //showMessage('Opened Chartifact viewer in a new tab', 'success');
    } catch (error) {
        console.error('Error opening Chartifact viewer:', error);
        //showMessage('Failed to prepare Chartifact report', 'error');
    }
};
