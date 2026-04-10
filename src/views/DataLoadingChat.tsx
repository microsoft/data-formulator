// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import { Box, Button, Divider, IconButton, Typography, Tooltip, CircularProgress, alpha, useTheme } from '@mui/material';
import { borderColor, transition, radius } from '../app/tokens';


import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch } from '../app/store';
import { DataFormulatorState, dfActions, fetchFieldSemanticType } from '../app/dfSlice';
import { createTableFromText } from '../data/utils';
import { loadTable } from '../app/tableThunks';
import { createOrderedThreadBlocks, DataLoadingInputBox, DataPreviewBox, SingleDataCleanThreadView } from './DataLoadingThread';


const generateDefaultName = (seed: string) => {
    const hash = seed.split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0) | 0, 0);
    return `data-${Math.abs(hash).toString(36).slice(0, 5)}`;
};

const getUniqueTableName = (baseName: string, existingNames: Set<string>): string => {
    let uniqueName = baseName;
    let counter = 1;
    while (existingNames.has(uniqueName)) {
        uniqueName = `${baseName}_${counter}`;
        counter += 1;
    }
    return uniqueName;
};

export const DataLoadingChat: React.FC = () => {
    const theme = useTheme();
    const dispatch = useDispatch<AppDispatch>();
    const inputBoxRef = useRef<(() => void) | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const cleanInProgress = useSelector((state: DataFormulatorState) => state.cleanInProgress);
    const existingTables = useSelector((state: DataFormulatorState) => state.tables);
    const dataCleanBlocks = useSelector((state: DataFormulatorState) => state.dataCleanBlocks);
    const focusedDataCleanBlockId = useSelector((state: DataFormulatorState) => state.focusedDataCleanBlockId);

    const [streamingContent, setStreamingContent] = useState('');

    const existingNames = new Set(existingTables.map(t => t.id));

    let existOutputBlocks = dataCleanBlocks.length > 0;

    let dataCleanBlocksThread = createOrderedThreadBlocks(dataCleanBlocks);
    let threadsComponent = dataCleanBlocksThread.map((thread, i) => {
        return <SingleDataCleanThreadView key={`data-clean-thread-${i}`} thread={thread} sx={{
            backgroundColor: 'white', 
            borderRadius: radius.md,
            padding: 1,
            flex:  'none',
            display: 'flex',
            flexDirection: 'column',
            height: 'fit-content',
            transition: transition.fast,
        }} />
    })

    // Get the selected CSV data from Redux state
    const selectedTable = (() => {
        if (focusedDataCleanBlockId) {
            let block = dataCleanBlocks.find(block => block.id === focusedDataCleanBlockId.blockId);
            if (block) {
                return block.items?.[focusedDataCleanBlockId.itemId];
            }
        }
        return undefined;
    })();

    const handleUpload = () => {
        if (!selectedTable) return;

        const suggestedName = selectedTable.name || generateDefaultName(selectedTable.content.value.slice(0, 96));
        
        console.log(selectedTable);

        const base = suggestedName.trim();
        const unique = getUniqueTableName(base, existingNames);
        const table = createTableFromText(unique, selectedTable.content.value, selectedTable.context);
        if (table) {
            const tableWithSource = { ...table, source: { type: 'extract' as const } };
            dispatch(loadTable({ table: tableWithSource }));
        }
    };

    const thinkingBanner = (
        <Box sx={{ 
            py: 0.5, 
            display: 'flex', 
            position: 'relative',
            overflow: 'hidden',
            '&::before': {
                content: '""',
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                background: 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.8) 50%, transparent 100%)',
                animation: 'shimmer 2s ease-in-out infinite',
                zIndex: 1,
                pointerEvents: 'none',
            },
            '@keyframes shimmer': {
                '0%': {
                    transform: 'translateX(-100%)',
                },
                '100%': {
                    transform: 'translateX(100%)',
                },
            }
        }}>
            <Box sx={{ 
                py: 1, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'left',
            }}>
                <CircularProgress size={10} sx={{ color: 'text.secondary' }} />
                <Typography variant="body2" sx={{ 
                    ml: 1, 
                    fontSize: 10, 
                    color: 'rgba(0, 0, 0, 0.7) !important'
                }}>
                    extracting data...
                </Typography>
            </Box>
        </Box>
    );

    // Empty state - centered layout similar to upload dialog
    if (!existOutputBlocks && !streamingContent) {
        return (
            <Box sx={{ 
                width: '100%', 
                height: '100%', 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center',
                p: 2,
                boxSizing: 'border-box'
            }}>
                <Box sx={{ 
                    width: '100%',
                    maxWidth: 720,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                }}>
                    <DataLoadingInputBox 
                        maxLines={24} 
                        onStreamingContentUpdate={setStreamingContent} 
                        abortControllerRef={abortControllerRef} 
                    />
                </Box>
            </Box>
        );
    }

    // Main layout with sidebar (similar to DBTablePane)
    return (
        <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            bgcolor: 'white', 
            flex: 1, 
            overflow: 'hidden', 
            height: '100%',
            width: '100%'
        }}>
            <Box sx={{ 
                display: 'flex', 
                flexDirection: 'row', 
                flex: 1, 
                overflow: 'hidden', 
                minHeight: 0, 
                height: '100%' 
            }}>
                {/* Left sidebar - Thread list (similar to DBTablePane) */}
                <Box sx={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    width: 240, 
                    minWidth: 240, 
                    maxWidth: 240, 
                    overflow: 'hidden', 
                    height: '100%',
                    borderRight: `1px solid ${borderColor.view}`
                }}>
                    <Box sx={{ 
                        display: 'flex',
                        flexDirection: 'column',
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        flex: 1,
                        minHeight: 0,
                        height: '100%',
                        position: 'relative',
                        overscrollBehavior: 'contain',
                        px: 0.5,
                        pt: 1
                    }}>
                        {threadsComponent.length > 0 ? (
                            threadsComponent
                        ) : (
                            <Typography variant="caption" sx={{ 
                                color: "text.disabled", 
                                px: 2, 
                                py: 0.5, 
                                fontStyle: "italic",
                                textAlign: 'center'
                            }}>
                                No extraction threads yet
                            </Typography>
                        )}
                    </Box>
                    <Box sx={{ 
                        borderTop: `1px solid ${borderColor.divider}`,
                        p: 1
                    }}>
                        <DataLoadingInputBox 
                            ref={inputBoxRef} 
                            maxLines={4} 
                            onStreamingContentUpdate={setStreamingContent} 
                            abortControllerRef={abortControllerRef} 
                        />
                    </Box>
                </Box>

                {/* Right content area */}
                <Box sx={{ 
                    flex: 1, 
                    overflow: 'hidden', 
                    minWidth: 0, 
                    minHeight: 0, 
                    height: '100%', 
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    {streamingContent ? (
                        <Box
                            sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                padding: 2,
                                height: '100%',
                                overflow: 'auto'
                            }}
                        >
                            {thinkingBanner}
                            <Typography 
                                variant="body2" 
                                color="text.secondary" 
                                sx={{ 
                                    mt: 2, 
                                    fontSize: '11px', 
                                    whiteSpace: 'pre-wrap', 
                                    overflow: 'clip', 
                                    maxHeight: '100%', 
                                    overflowY: 'auto' 
                                }}
                            >
                                {streamingContent.trim()}
                            </Typography>
                        </Box>
                    ) : existOutputBlocks ? (
                        <Box
                            sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                padding: 2,
                                height: '100%',
                                overflow: 'hidden'
                            }}
                        >
                            {selectedTable && (
                                <Typography 
                                    sx={{ 
                                        fontSize: 14, 
                                        marginBottom: 1,
                                        fontWeight: 500,
                                        color: 'text.primary',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 0.5
                                    }}
                                    gutterBottom
                                >
                                    {selectedTable?.name}
                                </Typography>
                            )}
                            
                            <Box 
                                sx={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    flex: 1,
                                    gap: 1,
                                    overflow: 'hidden',
                                    minHeight: 0
                                }}
                            >
                                {selectedTable ? (
                                    <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                                        <DataPreviewBox />
                                    </Box>
                                ) : (
                                    <Box sx={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'center',
                                        flex: 1,
                                        minHeight: 0
                                    }}>
                                        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', fontSize: '11px' }}>
                                            Select a table from the left to preview
                                        </Typography>
                                    </Box>
                                )}

                                {/* Bottom submit bar */}
                                {selectedTable && (
                                    <Box sx={{ 
                                        mt: 'auto', 
                                        pt: 1, 
                                        display: 'flex', 
                                        flexDirection: 'row', 
                                        alignItems: 'center', 
                                        gap: 1, 
                                        borderTop: `1px solid ${borderColor.divider}`,
                                        '& .MuiButton-root': { textTransform: 'none' } 
                                    }}>
                                        <Button
                                            variant="contained"
                                            onClick={() => {
                                                if (inputBoxRef.current) {
                                                    inputBoxRef.current();
                                                }
                                            }}
                                            disabled={!selectedTable || selectedTable.content.type !== 'image_url' || cleanInProgress}
                                            size="small"
                                        >
                                            Extract data from image
                                        </Button>
                                        <Button
                                            variant="contained"
                                            sx={{ ml: 'auto' }}
                                            onClick={handleUpload}
                                            disabled={!selectedTable || selectedTable.content.type !== 'csv'}
                                            size="small"
                                        >
                                            Load table
                                        </Button>
                                    </Box>
                                )}
                            </Box>
                        </Box>
                    ) : null}
                </Box>
            </Box>
        </Box>
    );
};

