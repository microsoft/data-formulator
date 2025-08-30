// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState } from 'react';
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
import { exportTableToCsv } from '../data/utils';
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
    const [title, setTitle] = useState<string>('');

    const handleDownload = () => {
        // Get actual table data from tables array using the IDs
        const chartData = chartElements.map(ce => {
            const table = tables.find(t => t.id === ce.tableId);

            const { chart, conceptShelfItems } = ce.element.props;
            const vg = assembleVegaChart(chart.chartType, chart.encodingMap, conceptShelfItems, table?.rows!);

            delete vg.data.values;
            vg.data.name = table?.id;

            console.log('Vega Chart:', vg);

            return { table, element: ce.element, chartId: ce.chartId, vg };
        }).filter(item => item.table); // Filter out any missing data

        // Create more detailed chartifact content
        let chartifactContent = `# ${title}\n\n`;
        chartifactContent += `This chartifact document contains ${chartData.length} visualization${chartData.length !== 1 ? 's' : ''}.\n\n`;

        chartData.forEach((item, index) => {
            chartifactContent += `## Chart ${index + 1}\n`;
            chartifactContent += `**Table:** ${item.table!.displayId || item.table!.id}\n`;
            chartifactContent += `**Chart ID:** ${item.chartId}\n`;

            // Add table info
            if (item.table!.derive?.code) {
                chartifactContent += `\n**Transformation Code:**\n\`\`\`python\n${item.table!.derive.code}\n\`\`\`\n`;
            }

            // Add table sample data
            if (item.table!.rows && item.table!.rows.length > 0) {
                chartifactContent += `\n**Data:**\n`;
                chartifactContent += `\`\`\`csv ${item.table!.id}\n`;
                chartifactContent += exportTableToCsv(item.table!);
                chartifactContent += `\n\`\`\`\n`;
            }

            chartifactContent += '\n---\n\n';
        });

        // Create a blob and download the file
        const blob = new Blob([chartifactContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        // Use title as filename, replace bad chars and spaces with underscores
        const sanitizedTitle = title.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
        link.download = `${sanitizedTitle}.icoc.md`;
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
