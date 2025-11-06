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
    Divider,
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

export const AgentRulesDialog: React.FC = () => {
    const theme = useTheme();
    const [open, setOpen] = useState(false);
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
- When performing forecasting, by default use linear models.

## Coding
- When a string column contains placeholder '-' for missing values, convert them to ''.
- Date should all be formated as 'YYYY-MM-DD'.
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
                sx={{ '& .MuiDialog-paper': { maxWidth: 800, maxHeight: '90vh', width: '90%' } }}
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
                <DialogContent>
                    {/* Coding Agent Rules Section */}
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, color: 'primary.main' }}>
                            Coding Rules
                            <Typography variant="body2" component="span" color="text.secondary" sx={{ ml: 1, fontSize: 12 }}>
                                (Rules that guide AI agents when generating code to transform data and recommend visualizations.)
                            </Typography>
                        </Typography>
                        
                        <Box
                            sx={{
                                border: `1px solid ${theme.palette.primary.main}`,
                                borderRadius: 1,
                                overflow: 'auto',
                                height: 180,
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
                                    fontSize: 10,
                                    lineHeight: 1.2,
                                    minHeight: 180,
                                    whiteSpace: 'pre-wrap',
                                    outline: 'none',
                                    resize: 'none',
                                }}
                            />
                        </Box>
                    </Box>

                    <Divider sx={{ my: 3 }} />

                    {/* Exploration Agent Rules Section */}
                    <Box>
                        <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, color: 'secondary.main' }}>
                            Exploration Rules
                            <Typography variant="body2" component="span" color="text.secondary" sx={{ ml: 1, fontSize: 12 }}>
                                (Rules that guide AI agents when exploring datasets, generating questions, and discovering insights)
                            </Typography>
                        </Typography>
                        <Box
                            sx={{
                                border: `1px solid ${theme.palette.secondary.main}`,
                                borderRadius: 1,
                                overflow: 'auto',
                                height: 180,
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
                                    fontSize: 10,
                                    lineHeight: 1.2,
                                    minHeight: 180,
                                    whiteSpace: 'pre-wrap',
                                    outline: 'none',
                                    resize: 'none',
                                }}
                            />
                        </Box>
                        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                            <Button
                                variant="text"
                                disabled={!hasCodingChanges}
                                onClick={handleSaveCoding}
                                sx={{ textTransform: 'none' }}
                            >
                                Save Coding Rules
                            </Button>
                            <Button
                                variant="text"
                                disabled={!hasExplorationChanges}
                                onClick={handleSaveExploration}
                                color="secondary"
                                sx={{ textTransform: 'none' }}
                            >
                                Save Exploration Rules
                            </Button>
                        </Box>
                    </Box>
                </DialogContent>
            </Dialog>
        </>
    );
};
