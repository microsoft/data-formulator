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
    useTheme,
    Badge,
    alpha,
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
    const theme = useTheme();
    const [open, setOpen] = useState(false);
    const [tabValue, setTabValue] = useState(0);
    const dispatch = useDispatch();
    const agentRules = useSelector((state: DataFormulatorState) => state.agentRules);

    // Local state for editing
    const [codingRules, setCodingRules] = useState(agentRules.coding);
    const [explorationRules, setExplorationRules] = useState(agentRules.exploration);

    // Placeholder content
    const codingPlaceholder = `Example Rules:

## Computation 
- ROI (return on investment) should be computed as (revenue - cost) / cost.
- When compute moving average for date field, the window size should be 7.
- When compute moving average for other numeric fields, the window size should be 3.
- When performing forecasting, by default use linear models.

## Coding
- When a string column contains placeholder '-' for missing values, convert them to ''.
- Date should all be formated as 'YYYY-MM-DD'.
- When visualizing distribution of a single numeric field, include a 'count' column besides the field.
`;

    const explorationPlaceholder = `Example Rules:

## Simpicity
- Keep the questions simple and concise, do not overcomplicate the exploration.
    
## Question Generation
- When you see outliers in the data, generate a question to investigate the outliers.

## Domain Knowledge
- When exploring large product dataset, include questions about top 20 based on different criteria.
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

    // Check if any rules are set
    const ruleCount = Number(agentRules.coding && agentRules.coding.trim().length > 0) + 
                        Number(agentRules.exploration && agentRules.exploration.trim().length > 0);

    return (
        <>
            <Badge 
                color="primary" 
                variant="standard" 
                invisible={ruleCount === 0}
                badgeContent={ruleCount}
                sx={{
                    '& .MuiBadge-badge': {
                        minWidth: 0,
                        height: 12,
                        fontSize: 8,
                        top: 12,
                        right: 8,
                        px: 0.5,
                        color: theme.palette.primary.main,
                        background: alpha(theme.palette.primary.light, 0.2),
                    },
                }}
            >
                <Button
                    variant="text"
                    sx={{ textTransform: 'none' }}
                    onClick={() => setOpen(true)}
                    startIcon={<RuleIcon />}
                >
                    Agent Rules
                </Button>
            </Badge>
            <Dialog
                onClose={handleClose}
                open={open}
                sx={{ '& .MuiDialog-paper': { maxWidth: 800, maxHeight: 600, width: '90%' } }}
                maxWidth={false}
            >
                <DialogTitle sx={{ pb: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                        <Tabs 
                            value={tabValue} 
                            onChange={handleTabChange} 
                            aria-label="agent rules tabs"
                            slotProps={{
                                indicator: {
                                    sx: {
                                        backgroundColor: tabValue === 0 ? 'primary.main' : 'secondary.main',
                                    }
                                },
                                scrollButtons: {
                                    sx: {
                                        color: tabValue === 0 ? 'primary.main' : 'secondary.main',
                                    }
                                }
                            }}
                            sx={{ 
                                '& .MuiTab-root': { 
                                    textTransform: 'none',
                                    '&.Mui-selected': {
                                        color: tabValue === 0 ? 'primary.main' : 'secondary.main',
                                    }
                                }
                            }}
                        >
                            <Tab label="Coding Agent Rules" {...a11yProps(0)} />
                            <Tab label="Exploration Agent Rules" {...a11yProps(1)} />
                        </Tabs>
                    </Box>
                    
                    <TabPanel value={tabValue} index={0}>
                        <Box sx={{ px: 2 }}>
                            <Typography variant="body2" sx={{ mb: 2, fontSize: 12 }}>
                                Rules that guide AI agents when generating code to transform data and recommend visualizations.
                            </Typography>
                            <Box
                                sx={{
                                    border: `1px solid ${theme.palette.primary.main}`,
                                    borderRadius: 1,
                                    overflow: 'hidden',
                                    height: 320,
                                    boxShadow: `0 2px 8px ${theme.palette.primary.main}40`,
                                    transition: 'box-shadow 0.3s ease-in-out',
                                    '&:hover': {
                                        boxShadow: `0 4px 12px ${theme.palette.primary.main}60`,
                                    }
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
                                        minHeight: 320,
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
                                    sx={{ ml: 'auto', textTransform: 'none' }}
                                >
                                    Save Coding Rules
                                </Button>
                            </Box>
                        </Box>
                    </TabPanel>
                    
                    <TabPanel value={tabValue} index={1}>
                        <Box sx={{ px: 2 }}>
                            <Typography variant="body2" sx={{ mb: 2, fontSize: 12 }}>
                                Rules that guide AI agents when exploring datasets, generating questions, and discovering insights
                            </Typography>
                            <Box
                                sx={{
                                    border: `1px solid ${theme.palette.secondary.main}`,
                                    borderRadius: 1,
                                    overflow: 'hidden',
                                    height: 320,
                                    boxShadow: `0 2px 8px ${theme.palette.secondary.main}40`,
                                    transition: 'box-shadow 0.3s ease-in-out',
                                    '&:hover': {
                                        boxShadow: `0 4px 12px ${theme.palette.secondary.main}60`,
                                    }
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
                                        minHeight: 320,
                                        backgroundColor: 'transparent',
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
                                    color={'secondary'}
                                    sx={{ ml: 'auto', textTransform: 'none' }}
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
