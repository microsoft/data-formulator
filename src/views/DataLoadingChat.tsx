// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import { Box, Button, Divider, IconButton, Typography, Dialog, DialogTitle, DialogContent, Tooltip, CircularProgress } from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CloseIcon from '@mui/icons-material/Close';


import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch } from '../app/store';
import { DataFormulatorState, dfActions, fetchFieldSemanticType } from '../app/dfSlice';
import { createTableFromText } from '../data/utils';
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
            borderRadius: 2,
            padding: 1,
            flex:  'none',
            display: 'flex',
            flexDirection: 'column',
            height: 'fit-content',
            transition: 'all 0.3s ease',
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
        
        const base = suggestedName.trim();
        const unique = getUniqueTableName(base, existingNames);
        const table = createTableFromText(unique, selectedTable.content.value);
        if (table) {
            dispatch(dfActions.loadTable(table));
            dispatch(fetchFieldSemanticType(table));
        }
    };

    if (!existOutputBlocks && !streamingContent) {
        return <Box sx={{ width: 'calc(100% - 32px)', borderRadius: 2, px: 2 }}>
            <DataLoadingInputBox maxLines={24} onStreamingContentUpdate={setStreamingContent} abortControllerRef={abortControllerRef} />
        </Box>
    }

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

    
    let chatCard = (
        <Box sx={{ width: (existOutputBlocks || streamingContent) ? '960px' : '640px', minHeight: 400,
                display: 'flex', flexDirection: 'row', borderRadius: 2 }}>
            
            {/* Left: Chat panel */}
            <Box
                sx={{
                    width: 240,
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 1,
                    position: 'relative'
                }}
            >
                <Box sx={{ flex: 1,  display: 'flex', flexDirection: 'column', minHeight: '480px', 
                    overflowY: 'auto', overflowX: 'hidden' }}>
                    {threadsComponent}
                </Box>
                <DataLoadingInputBox ref={inputBoxRef} maxLines={4} onStreamingContentUpdate={setStreamingContent} abortControllerRef={abortControllerRef} />
            </Box>

            <Divider orientation="vertical" flexItem sx={{m: 2, color: 'divider'}} />

            {streamingContent && (
                <Box
                    sx={{
                        flex: 1.4,
                        minWidth: 480,
                        maxWidth: 640,
                        display: 'flex',
                        flexDirection: 'column',
                        padding: 1
                    }}
                >
                    {thinkingBanner}
                    <Typography variant="body2" color="text.secondary" 
                        sx={{ mt: 4, fontSize: '11px', whiteSpace: 'pre-wrap', overflow: 'clip', maxHeight: '600px', overflowY: 'auto' }}>
                        {streamingContent.trim()}
                    </Typography>
                </Box>
            )}

            {/* Right: Data preview panel */}
            {(existOutputBlocks && !streamingContent) && (
                <Box
                    sx={{
                        flex: 1.4,
                        minWidth: 480,
                        display: 'flex',
                        flexDirection: 'column',
                        padding: 1
                    }}
                >
                    
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
                        {selectedTable && (
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                {selectedTable?.name}
                            </Typography>
                        )}
                    </Typography>
                    
                    <Box 
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            flex: 1,
                            gap: 1,
                            overflow: 'hidden'
                        }}
                    >
                        {selectedTable ? (
                            <DataPreviewBox />
                        ) : (
                            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4, fontSize: '11px' }}>
                                No data available
                            </Typography>
                        )}

                        {/* Bottom submit bar */}
                        <Box sx={{ mt: 'auto', pt: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1, 
                            '& .MuiButton-root': { textTransform: 'none' } }}>
                            <Button
                                variant="contained"
                                sx={{  }}
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
                    </Box>
                </Box>
            )}
        </Box>
    );

    return chatCard;
};

export interface DataLoadingChatDialogProps {
    buttonElement: any;
    disabled?: boolean;
}

export const DataLoadingChatDialog: React.FC<DataLoadingChatDialogProps> = ({ buttonElement, disabled = false }) => {
    const [dialogOpen, setDialogOpen] = useState<boolean>(false);
    const dispatch = useDispatch<AppDispatch>();
    const dataCleanBlocks = useSelector((state: DataFormulatorState) => state.dataCleanBlocks);

    return (
        <>
            <Button 
                sx={{fontSize: "inherit"}} 
                variant="text" 
                color="secondary" 
                disabled={disabled}
                onClick={() => setDialogOpen(true)}
            >
                {buttonElement}
            </Button>
            <Dialog 
                key="data-loading-chat-dialog" 
                onClose={() => setDialogOpen(false)} 
                open={dialogOpen}
                sx={{ '& .MuiDialog-paper': { maxWidth: '100%', maxHeight: 840, minWidth: 800 } }}
            >
                <DialogTitle sx={{display: "flex"}}>
                    Vibe Data Loader
                    {dataCleanBlocks.length > 0 && <Tooltip title="Reset dialog">  
                        <IconButton size="small" color='warning' 
                            sx={{
                            '&:hover': {  transform: 'rotate(180deg)', 
                                        transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)' } }} onClick={() => {
                                            dispatch(dfActions.resetDataCleanBlocks());
                                        }}>
                            <RestartAltIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>}
                    <IconButton
                        sx={{marginLeft: "auto"}}
                        edge="start"
                        size="small"
                        color="inherit"
                        onClick={() => setDialogOpen(false)}
                        aria-label="close"
                    >
                        <CloseIcon fontSize="inherit"/>
                    </IconButton>
                </DialogTitle>
                <DialogContent sx={{overflowX: "hidden", padding: 1}}>
                    <DataLoadingChat />
                </DialogContent>
            </Dialog>
        </>
    );
};


