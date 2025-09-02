// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Typography,
    Box
} from '@mui/material';
import { DictTable } from '../components/ComponentType';
import { exportTableToDsv } from '../data/utils';
import { assembleVegaChart } from '../app/utils';

export interface ChartElements {
    tableId: string;
    chartId: string;
    element: any;
}

export interface ChartifactDialogProps {
    open: boolean;
    handleCloseDialog: () => void;
    tables: DictTable[];
    chartElements: ChartElements[];
}

export const ChartifactDialog: FC<ChartifactDialogProps> = function ChartifactDialog({
    open,
    handleCloseDialog,
    tables,
    chartElements
}) {
    // Generate initial title from table names
    const getTablesFromChartElements = () => {
        return chartElements
            .map(ce => tables.find(t => t.id === ce.tableId))
            .filter(table => table) as DictTable[];
    };

    const [title, setTitle] = useState<string>(() =>
        generateTitleFromTables(getTablesFromChartElements())
    );

    // Update title when chart elements change
    useEffect(() => {
        if (open) {
            const newTitle = generateTitleFromTables(getTablesFromChartElements());
            setTitle(newTitle);
        }
    }, [open, chartElements, tables]);

    const handleDownload = () => {

        const content = createChartifact(chartElements, tables, title);

        // Create a blob and download the file
        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        // Use title as filename, replace bad chars and spaces with underscores
        const sanitizedTitle = title.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
        link.download = `${sanitizedTitle}.idoc.md`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        // Close the dialog after download
        handleCloseDialog();
        setTitle(''); // Reset the title
    };

    const handleClose = () => {
        handleCloseDialog();
        setTitle(''); // Reset the title when closing
    };

    return (
        <Dialog
            sx={{ '& .MuiDialog-paper': { maxWidth: '400px', minWidth: '300px' } }}
            open={open}
            onClose={handleClose}
        >
            <DialogTitle>
                <Typography>Create Chartifact Document</Typography>
            </DialogTitle>
            <DialogContent dividers>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 1 }}>
                    <TextField
                        fullWidth
                        label="Title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Enter document title..."
                        variant="outlined"
                        size="small"
                    />
                    <Typography variant="body2" color="text.secondary">
                        This will create a chartifact document with {chartElements.length} chart{chartElements.length !== 1 ? 's' : ''}.
                        {chartElements.length > 0 && (
                            <>
                                <br />
                                The document will include:
                                <br />
                                • Table data and transformations
                                <br />
                                • Sample data for each table
                                <br />
                                • Chart references
                            </>
                        )}
                    </Typography>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose}>Close</Button>
                <Button
                    onClick={handleDownload}
                    variant="contained"
                    disabled={!title.trim()}
                >
                    Download
                </Button>
            </DialogActions>
        </Dialog>
    );
};

function createChartifact(chartElements: ChartElements[], tables: DictTable[], title: string) {
    // Get actual table data from tables array using the IDs
    const chartData = chartElements.map(ce => {
        const table = tables.find(t => t.id === ce.tableId);

        const { chart, conceptShelfItems } = ce.element.props;
        const vg = assembleVegaChart(chart.chartType, chart.encodingMap, conceptShelfItems, table?.rows!);

        delete vg.data.values;
        vg.data.name = table?.id;

        vg.padding = 50;

        return { table, element: ce.element, chartId: ce.chartId, vg };
    }).filter(item => item.table); // Filter out any missing data


    // Create more detailed chartifact content
    let out = [`${tickWrap('#', 'View this document in the online Chartifact viewer: https://microsoft.github.io/chartifact/view/ \nor with the Chartifact VS Code extension: https://marketplace.visualstudio.com/items?itemName=msrvida.chartifact')}
# Data Formulator session: ${title}
`];

    out.push(`This chartifact document contains ${chartData.length} visualization${chartData.length !== 1 ? 's' : ''}.\n`);

    chartData.forEach((item, index) => {
        out.push(`## Chart ${index + 1}`);
        out.push(`**Table:** ${item.table!.displayId || item.table!.id}`);
        out.push(`**Chart ID:** ${item.chartId}`);

        // Add table info
        if (item.table!.derive?.code) {
            out.push(`\n**Transformation Code:**`);
            out.push(tickWrap('python', item.table!.derive.code));
        }

        // Add Vega-Lite specification
        out.push(`\n**Visualization:**`);
        out.push(tickWrap('json vega-lite', JSON.stringify(item.vg, null, 2)));

        out.push('\n---\n');
    });

    // Output unique CSV tables at the end
    const uniqueTableIds = [...new Set(chartData.map(item => item.table!.id))];
    if (uniqueTableIds.length > 0) {
        out.push(`## Data Tables\n\n`);
        uniqueTableIds.forEach(tableId => {
            const table = tables.find(t => t.id === tableId);
            if (table && table.rows && table.rows.length > 0) {
                out.push(`### ${table.displayId || table.id}`);
                out.push(tickWrap(`csv ${table.id}`, exportTableToDsv(table, ',')));
                out.push(tickWrap('json tabulator', JSON.stringify({ dataSourceName: table.id }, null, 2)));
            }
        });
    }

    return out.join('\n');
}

function tickWrap(plugin: string, content: string) {
    return `\n\n\n\`\`\`${plugin}\n${content}\n\`\`\`\n\n\n`;
}

function generateTitleFromTables(tables: DictTable[]): string {
    if (tables.length === 0) return '';

    const uniqueTableNames = [...new Set(
        tables.map(t => {
            const name = t.displayId || t.id || '';
            return name ? (name.charAt(0).toUpperCase() + name.slice(1)) : name;
        })
    )];

    if (uniqueTableNames.length <= 3) {
        return uniqueTableNames.join(', ');
    } else {
        return uniqueTableNames.slice(0, 3).join(', ') + '...';
    }
}
