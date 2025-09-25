// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useEffect } from 'react';
import {
    Button,
    Typography,
    Box,
    DialogTitle,
    Dialog,
    DialogContent,
    DialogActions,
    Tabs,
    Tab,
    IconButton,
} from '@mui/material';
import RuleIcon from '@mui/icons-material/Rule';
import CloseIcon from '@mui/icons-material/Close';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import Editor from 'react-simple-code-editor';

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;

    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`agent-rules-tabpanel-${index}`}
            aria-labelledby={`agent-rules-tab-${index}`}
            {...other}
        >
            {value === index && (
                <Box sx={{ pt: 2 }}>
                    {children}
                </Box>
            )}
        </div>
    );
}

function a11yProps(index: number) {
    return {
        id: `agent-rules-tab-${index}`,
        'aria-controls': `agent-rules-tabpanel-${index}`,
    };
}

export const AgentRulesDialog: React.FC = () => {
    const [open, setOpen] = useState(false);
    const [tabValue, setTabValue] = useState(0);
    const dispatch = useDispatch();
    const agentRules = useSelector((state: DataFormulatorState) => state.agentRules);

    // Local state for editing
    const [codingRules, setCodingRules] = useState(agentRules.coding);
    const [explorationRules, setExplorationRules] = useState(agentRules.exploration);

    // Placeholder content
    const codingPlaceholder = `# Coding Agent Rules

## Computation Rules
- ROI (return on investment) should be computed as (revenue - cost) / cost.
- When compute moving average for date field, the window size should be 7.
- When compute moving average for other numeric fields, the window size should be 3.
- When performing forecasting, by default use non-linear models.

## Visualization Data Transformation Rules
- When visualizing distribution of a single numeric field, include a 'count' column besides the field.

## Coding Rules
- If a column is all capital letters, convert to lowercase.
- When a string column contains placeholder '-' for missing values, convert them to ''.
- Date should all be formated as 'YYYY-MM-DD'.

...(your rules here)
`;

    const explorationPlaceholder = `# Exploration Agent Rules

## Question Generation Rules
- When planning on explorations, first generate a question that visualize the quality of the data.
- When you see outliers in the data, generate a question to investigate the outliers.

## Domain Knowledge Rules
- When exploring large customer / product dataset, include some questions about top 20 based on different criteria.

...(your rules here)
`;

    // Update local state when dialog opens
    useEffect(() => {
        if (open) {
            setCodingRules(agentRules.coding);
            setExplorationRules(agentRules.exploration);
        }
    }, [open, agentRules]);

    const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
    };

    const handleSaveCoding = () => {
        dispatch(dfActions.setAgentRules({
            coding: codingRules,
            exploration: agentRules.exploration
        }));
    };

    const handleSaveExploration = () => {
        dispatch(dfActions.setAgentRules({
            coding: agentRules.coding,
            exploration: explorationRules
        }));
    };

    const handleRevertCoding = () => {
        setCodingRules(agentRules.coding);
    };

    const handleRevertExploration = () => {
        setExplorationRules(agentRules.exploration);
    };

    const handleClose = () => {
        // Reset to original values
        setCodingRules(agentRules.coding);
        setExplorationRules(agentRules.exploration);
        setOpen(false);
    };

    // Check if there are changes for each tab
    const hasCodingChanges = codingRules !== agentRules.coding;
    const hasExplorationChanges = explorationRules !== agentRules.exploration;

    return (
        <>
            <Button
                variant="text"
                sx={{ textTransform: 'none' }}
                onClick={() => setOpen(true)}
                startIcon={<RuleIcon />}
            >
                Agent Rules
            </Button>
            <Dialog
                onClose={handleClose}
                open={open}
                sx={{ '& .MuiDialog-paper': { maxWidth: 800, maxHeight: 600, width: '90%' } }}
                maxWidth={false}
            >
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6">Agent Rules</Typography>
                    <IconButton
                        aria-label="close"
                        onClick={handleClose}
                        sx={{ color: (theme) => theme.palette.grey[500] }}
                    >
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent sx={{ padding: 1, pb: 2 }}>
                    <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                        <Tabs value={tabValue} sx={{ '& .MuiTab-root': { textTransform: 'none' } }} onChange={handleTabChange} aria-label="agent rules tabs">
                            <Tab label="Coding Agent Rules" {...a11yProps(0)} />
                            <Tab label="Exploration Agent Rules" {...a11yProps(1)} />
                        </Tabs>
                    </Box>
                    
                    <TabPanel value={tabValue} index={0}>
                        <Box sx={{ px: 2 }}>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
                                Rules that guide AI agents when generating code to transform data and recommend visualizations.
                            </Typography>
                            <Box
                                sx={{
                                    border: '1px solid #e0e0e0',
                                    borderRadius: 1,
                                    overflow: 'hidden',
                                    height: 350,
                                }}
                            >
                                <Editor
                                    value={codingRules}
                                    onValueChange={(code) => setCodingRules(code)}
                                    highlight={(code) => code}
                                    padding={16}
                                    placeholder={codingPlaceholder}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Tab' && !codingRules) {
                                            e.preventDefault();
                                            setCodingRules(codingPlaceholder);
                                        }
                                    }}
                                    style={{
                                        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                                        fontSize: 11,
                                        lineHeight: 1.5,
                                        minHeight: 350,
                                        backgroundColor: '#fafafa',
                                        whiteSpace: 'pre-wrap',
                                        outline: 'none',
                                        resize: 'none',
                                    }}
                                />
                            </Box>
                            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Button
                                    variant={"text"}
                                    disabled={!hasCodingChanges}
                                    onClick={handleSaveCoding}
                                    sx={{ ml: 'auto' }}
                                >
                                    Save Coding Rules
                                </Button>
                            </Box>
                        </Box>
                    </TabPanel>
                    
                    <TabPanel value={tabValue} index={1}>
                        <Box sx={{ px: 2 }}>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
                                Rules that guide AI agents when exploring datasets, generating questions, and discovering insights
                            </Typography>
                            <Box
                                sx={{
                                    border: '1px solid #e0e0e0',
                                    borderRadius: 1,
                                    overflow: 'hidden',
                                    height: 350,
                                }}
                            >
                                <Editor
                                    value={explorationRules}
                                    onValueChange={(code) => setExplorationRules(code)}
                                    highlight={(code) => code}
                                    padding={16}
                                    placeholder={explorationPlaceholder}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Tab' && !explorationRules) {
                                            e.preventDefault();
                                            setExplorationRules(explorationPlaceholder);
                                        }
                                    }}
                                    style={{
                                        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                                        fontSize: 11,
                                        lineHeight: 1.5,
                                        minHeight: 350,
                                        backgroundColor: '#fafafa',
                                        whiteSpace: 'pre-wrap',
                                        outline: 'none',
                                        resize: 'none',
                                    }}
                                />
                            </Box>
                            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Button
                                    variant={"text"}
                                    disabled={!hasExplorationChanges}
                                    onClick={handleSaveExploration}
                                    sx={{ ml: 'auto' }}
                                >
                                    Save Exploration Rules
                                </Button>
                            </Box>
                        </Box>
                    </TabPanel>
                </DialogContent>
            </Dialog>
        </>
    );
};
