// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { DataFormulatorState, dfSelectors, generateFreshChart } from '../app/dfSlice';
import { resolveChartFields, assembleVegaChart } from '../app/utils';
import { CHART_TEMPLATES, getChartTemplate } from '../components/ChartTemplates';
import { Chart, FieldItem, DictTable } from '../components/ComponentType';
import embed from 'vega-embed';

import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    ListSubheader,
    ListItemIcon,
    ListItemText,
    Chip,
    Autocomplete,
    TextField,
    Paper,
    Divider,
} from '@mui/material';

interface ResolveChartFieldsTestDialogProps {
    open: boolean;
    onClose: () => void;
}

export const ResolveChartFieldsTestDialog: FC<ResolveChartFieldsTestDialogProps> = ({ open, onClose }) => {
    // Get state data
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);
    
    // Local state
    const [selectedChartType, setSelectedChartType] = useState<string>('Scatter Plot');
    const [selectedFieldNames, setSelectedFieldNames] = useState<string[]>([]);
    const [renderedChart, setRenderedChart] = useState<any>(null);
    const [isRendering, setIsRendering] = useState<boolean>(false);

    // Get current table
    const currentTable = tables.find(t => t.id === focusedTableId);
    
    if (!currentTable) {
        return null;
    }

    // Get available field names from concepts
    const availableFieldNames = (currentTable.names.map(name => conceptShelfItems.find(c => c.name === name)).filter(f => f != undefined) as FieldItem[])
        .map(field => field.name);

    // Auto-populate first three fields
    useEffect(() => {
        if (availableFieldNames.length > 0 && selectedFieldNames.length === 0) {
            setSelectedFieldNames(availableFieldNames);
        }
    }, [availableFieldNames, selectedFieldNames.length]);

    // Handle chart type change
    const handleChartTypeChange = (chartType: string) => {
        setSelectedChartType(chartType);
    };

    // Handle field selection change
    const handleFieldSelectionChange = (fieldNames: string[]) => {
        setSelectedFieldNames(fieldNames);
    };

    // Test resolveChartFields function
    const testResolveChartFields = async () => {
        if (selectedFieldNames.length === 0) {
            alert('Please select at least one field');
            return;
        }

        setIsRendering(true);
        try {
            // Create a fresh chart
            const freshChart = generateFreshChart(currentTable.id, selectedChartType);
            
            // Test resolveChartFields function
            const resolvedChart = resolveChartFields(freshChart, conceptShelfItems, selectedFieldNames, currentTable);
            
            // Create Vega-Lite spec
            const vegaSpec = assembleVegaChart(
                resolvedChart.chartType,
                resolvedChart.encodingMap,
                conceptShelfItems,
                currentTable.rows
            );
            
            setRenderedChart(vegaSpec);
        } catch (error) {
            console.error('Error testing resolveChartFields:', error);
            alert('Error testing resolveChartFields: ' + (error as Error).message);
        } finally {
            setIsRendering(false);
        }
    };

    // Render the chart
    const renderChart = async () => {
        if (!renderedChart) return;

        try {
            // Create a temporary container for the chart
            const chartContainer = document.getElementById('test-chart-container');
            if (chartContainer) {
                chartContainer.innerHTML = '';
                await embed(chartContainer, renderedChart, { actions: false });
            }
        } catch (error) {
            console.error('Error rendering chart:', error);
        }
    };

    // Render chart when renderedChart changes
    useEffect(() => {
        if (renderedChart) {
            renderChart();
        }
    }, [renderedChart]);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle>
                Test resolveChartFields Function
            </DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'flex', gap: 2, height: '500px' }}>
                    {/* Controls Panel */}
                    <Box sx={{ width: '300px', flexShrink: 0 }}>
                        <Paper sx={{ p: 2, height: '100%' }}>
                            <Typography variant="h6" gutterBottom>
                                Test Parameters
                            </Typography>
                            
                            {/* Chart Type Selection */}
                            <FormControl fullWidth sx={{ mb: 2 }}>
                                <InputLabel>Chart Type</InputLabel>
                                <Select
                                    value={selectedChartType}
                                    onChange={(e) => handleChartTypeChange(e.target.value)}
                                    label="Chart Type"
                                >
                                    {Object.entries(CHART_TEMPLATES).map(([group, templates]) => [
                                        <ListSubheader key={group}>{group}</ListSubheader>,
                                        ...templates.map((template) => (
                                            <MenuItem key={template.chart} value={template.chart}>
                                                <ListItemIcon sx={{maxWidth: '12px', maxHeight: '12px'}}>
                                                    {typeof template.icon === 'string' ? 
                                                        <img height="12px" width="12px" src={template.icon} alt="" /> : 
                                                        template.icon
                                                    }
                                                </ListItemIcon>
                                                <ListItemText>{template.chart}</ListItemText>
                                            </MenuItem>
                                        ))
                                    ]).flat()}
                                </Select>
                            </FormControl>

                            {/* Field Selection */}
                            <Autocomplete
                                multiple
                                options={availableFieldNames}
                                value={selectedFieldNames}
                                onChange={(_, newValue) => handleFieldSelectionChange(newValue)}
                                renderTags={(value, getTagProps) =>
                                    value.map((option, index) => (
                                        <Chip
                                            variant="outlined"
                                            label={option}
                                            {...getTagProps({ index })}
                                            key={option}
                                        />
                                    ))
                                }
                                renderInput={(params) => (
                                    <TextField
                                        {...params}
                                        label="Select Fields (in order)"
                                        placeholder="Choose fields to test"
                                    />
                                )}
                                sx={{ mb: 2 }}
                            />

                            {/* Test Button */}
                            <Button
                                variant="contained"
                                onClick={testResolveChartFields}
                                disabled={isRendering || selectedFieldNames.length === 0}
                                fullWidth
                            >
                                {isRendering ? 'Testing...' : 'Test resolveChartFields'}
                            </Button>

                            {/* Current Table Info */}
                            <Divider sx={{ my: 2 }} />
                            <Typography variant="subtitle2" gutterBottom>
                                Current Table: {currentTable.displayId || currentTable.id}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Available Fields: {availableFieldNames.length}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Rows: {currentTable.rows.length}
                            </Typography>
                        </Paper>
                    </Box>

                    {/* Chart Display Panel */}
                    <Box sx={{ flex: 1 }}>
                        <Paper sx={{ p: 2, height: '100%', minHeight: '400px' }}>
                            <Typography variant="h6" gutterBottom>
                                Rendered Chart
                            </Typography>
                            <Box
                                id="test-chart-container"
                                sx={{
                                    width: '100%',
                                    height: '400px',
                                    border: '1px solid #e0e0e0',
                                    borderRadius: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: '#fafafa'
                                }}
                            >
                                {!renderedChart && (
                                    <Typography color="text.secondary">
                                        Select chart type and fields, then click "Test resolveChartFields"
                                    </Typography>
                                )}
                            </Box>
                        </Paper>
                    </Box>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};
