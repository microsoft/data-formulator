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

export interface ChartifactDialogProps {
    open: boolean;
    handleCloseDialog: () => void;
    chartElements: { tableId: string; chartId: string; element: any }[];
}

export const ChartifactDialog: FC<ChartifactDialogProps> = function ChartifactDialog({
    open,
    handleCloseDialog,
    chartElements
}) {
    const [title, setTitle] = useState<string>('');

    const handleDownload = () => {
        // Create the chartifact content
        const chartifactContent = `# ${title}\n\nThis is a chartifact document.\n\nGenerated charts: ${chartElements.length}`;
        
        // Create a blob and download the file
        const blob = new Blob([chartifactContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'chartifact.icoc.md';
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
