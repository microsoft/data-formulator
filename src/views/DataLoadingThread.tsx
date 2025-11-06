// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import { Box, Button, Card, CardContent, Divider, IconButton, Paper, Stack, TextField, Typography, alpha, useTheme, Dialog, DialogTitle, DialogContent, Tooltip, LinearProgress, CircularProgress, Chip, SxProps, Theme } from '@mui/material';
import UploadIcon from '@mui/icons-material/Upload';
import SendIcon from '@mui/icons-material/Send';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CancelIcon from '@mui/icons-material/Cancel';
import PanoramaFishEyeIcon from '@mui/icons-material/PanoramaFishEye';
import CloseIcon from '@mui/icons-material/Close';
import CircleIcon from '@mui/icons-material/Circle';
import TableIcon from '@mui/icons-material/TableChart';
import LinkIcon from '@mui/icons-material/Link';
import DeleteIcon from '@mui/icons-material/Delete';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import SouthIcon from '@mui/icons-material/South';
import LanguageIcon from '@mui/icons-material/Language';
import ImageIcon from '@mui/icons-material/Image';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import DatasetIcon from '@mui/icons-material/Dataset';
import StopIcon from '@mui/icons-material/Stop';

import exampleImageTable from "../assets/example-image-table.png";

import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch } from '../app/store';
import { DataFormulatorState, dfActions, dfSelectors, fetchFieldSemanticType } from '../app/dfSlice';
import { DataCleanBlock, DataCleanTableOutput } from '../components/ComponentType';
import { getUrls } from '../app/utils';
import { CustomReactTable } from './ReactTable';
import { createTableFromText } from '../data/utils';

type DialogContentItem = {
    type: 'text';
    text: string;
} | {
    type: 'image_url';
    image_url: {
        url: string;
        detail?: string;
    };
};

type DialogMessage = {
    role: 'user' | 'assistant' | 'system';
    content: string | DialogContentItem[];
};

const generateDefaultName = (seed: string) => {
    const hash = seed.split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0) | 0, 0);
    return `data-${Math.abs(hash).toString(36).slice(0, 5)}`;
};

// Sample task card component
const SampleTaskChip: React.FC<{
    task: { text: string; icon?: React.ReactElement; image?: string };
    theme: Theme;
    onClick: () => void;
    disabled?: boolean;
}> = ({ task, theme, onClick, disabled }) => {
    return (
        <Box
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '6px 8px',
                fontSize: '12px',
                minHeight: '32px',
                height: 'auto',
                borderRadius: 2,
                border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                transition: 'all 0.2s ease-in-out',
                backgroundColor: alpha(theme.palette.background.paper, 0.9),
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                '&:hover': disabled ? {} : {
                    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                    borderColor: alpha(theme.palette.primary.main, 0.5),
                    transform: 'translateY(-1px)',
                },
            }}
            onClick={disabled ? undefined : onClick}
        >
            {/* {task.icon && (
                <Box sx={{ mr: 1, display: 'flex', alignItems: 'center', color: theme.palette.primary.main }}>
                    {task.icon}
                </Box>
            )} */}
            {task.image && (
                <Box
                    component="img"
                    src={task.image}
                    sx={{
                        width: 24,
                        height: 24,
                        objectFit: 'cover',
                        borderRadius: 0.5,
                        mr: 1,
                        border: '1px solid',
                        borderColor: 'divider'
                    }}
                />
            )}
            <Typography
                component="div"
                sx={{
                    fontSize: '12px',
                    color: theme.palette.text.primary,
                    lineHeight: 1.4,
                }}
            >
                {task.text}
            </Typography>
        </Box>
    );
};

export const DataPreviewBox: React.FC<{sx?: SxProps}> = ({sx}) => {

    const dispatch = useDispatch<AppDispatch>();
    const dataCleanBlocks = useSelector((state: DataFormulatorState) => state.dataCleanBlocks);
    const focusedDataCleanBlockId = useSelector((state: DataFormulatorState) => state.focusedDataCleanBlockId);
    const existingTables = useSelector((state: DataFormulatorState) => state.tables);
    
    let selectedBlock = dataCleanBlocks.find(block => block.id === focusedDataCleanBlockId?.blockId) || dataCleanBlocks[dataCleanBlocks.length - 1];
    let selectedTable = focusedDataCleanBlockId ? selectedBlock?.items?.[focusedDataCleanBlockId.itemId] : undefined;

    if (!selectedTable) {
        return <Paper variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, ...sx }}>
            <Typography variant="body2" sx={{ fontSize: '10px', color: 'text.secondary' }}>
                No data selected
            </Typography>
        </Paper>
    }

    if (selectedTable.content.type === 'csv' && selectedTable.content.value) {
        const suggestedName = selectedTable.name || generateDefaultName(selectedTable.content.value.slice(0, 96));
        const tableComponent = createTableFromText(suggestedName, selectedTable.content.value);
        if (tableComponent) {
            return <CustomReactTable
                rows={tableComponent.rows}
                rowsPerPageNum={-1}
                compact={false}
                columnDefs={tableComponent.names.map((name) => ({
                    id: name,
                    label: name,
                    minWidth: 60,
                    align: undefined,
                    format: (v: any) => v,
                }))}
                maxHeight={600}
            />
        }
        return <Paper variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, ...sx }}>
            <Typography variant="body2" sx={{ fontSize: '10px', color: 'text.secondary' }}>
                {selectedTable.content.value}
            </Typography>
        </Paper>
    }
    
    // Handle image_url content type
    if (selectedTable.content.type === 'image_url') {
        return <Paper variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, ...sx }}>
            <Typography variant="body2" sx={{ fontSize: '10px', color: 'text.secondary' }}>
                Image URL: {selectedTable.content.value}
            </Typography>
            <Box
                component="img"
                src={selectedTable.content.value}
                alt={`Image from ${selectedTable.name || 'data source'}`}
                sx={{
                    maxWidth: '100%',
                    maxHeight: '400px',
                    objectFit: 'contain',
                    borderRadius: 1

                }}
            />
        </Paper>
    }
    
    // Handle data_url content type
    if (selectedTable.content.type === 'web_url') {
        return <Paper variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, ...sx }}>
            <Typography variant="body2" sx={{ fontSize: '12px', color: 'text.primary', fontWeight: 500 }}>
                Data URL
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '10px', color: 'text.secondary', wordBreak: 'break-all' }}>
                {selectedTable.content.value}
            </Typography>
        </Paper>
    }
    
    // Fallback for other content types
    return <Paper variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, ...sx }}>
        <Typography variant="body2" sx={{ fontSize: '10px', color: 'text.secondary' }}>
            {selectedTable.content.value}
        </Typography>
    </Paper>
}

export const DataLoadingInputBox = React.forwardRef<(() => void) | null, {maxLines?: number, onStreamingContentUpdate?: (content: string) => void, abortControllerRef?: React.MutableRefObject<AbortController | null>}>(({maxLines = 4, onStreamingContentUpdate, abortControllerRef}, ref) => {
    const dispatch = useDispatch<AppDispatch>();
    const theme = useTheme();
    const activeModel = useSelector(dfSelectors.getActiveModel);
    const dataCleanBlocks = useSelector((state: DataFormulatorState) => state.dataCleanBlocks);
    const cleanInProgress = useSelector((state: DataFormulatorState) => state.cleanInProgress);

    const focusedDataCleanBlockId = useSelector((state: DataFormulatorState) => state.focusedDataCleanBlockId);
    let selectedBlock = focusedDataCleanBlockId ? dataCleanBlocks.find(block => block.id === focusedDataCleanBlockId.blockId) : undefined;
    let selectedTable = focusedDataCleanBlockId ? selectedBlock?.items?.[focusedDataCleanBlockId.itemId] : undefined;

    const [userImages, setUserImages] = useState<string[]>([]);
    const [prompt, setPrompt] = useState('');

    const existOutputBlocks = dataCleanBlocks.length > 0;

    // Reconstruct dialog from Redux state for API compatibility
    const dialog: DialogMessage[] = (() => {
        const reconstructedDialog: DialogMessage[] = [];
        
        // Build dialog backwards from selected block until there's no parent
        let currentBlockId = focusedDataCleanBlockId?.blockId;
        const processedBlocks = new Set<string>();
        
        while (currentBlockId && !processedBlocks.has(currentBlockId)) {
            const block = dataCleanBlocks.find(b => b.id === currentBlockId);
            if (!block) break;
            
            processedBlocks.add(currentBlockId);
            
            // Add user message from block's derive field
            const content: any[] = [];
            if (block.derive.prompt) {
                content.push({ type: 'text', text: block.derive.prompt });
            }
            if (block.derive.artifacts) {
                block.derive.artifacts.forEach(artifact => {
                    if (artifact.type === 'image_url') {
                        content.push({ 
                            type: 'image_url', 
                            image_url: { url: artifact.value } 
                        });
                    }
                });
            }
            reconstructedDialog.unshift({
                role: 'user',
                content: content.length === 1 && content[0].type === 'text' ? content[0].text : content
            });
            
            // Add assistant message if dialogItem exists
            if (block.dialogItem) {
                reconstructedDialog.unshift(block.dialogItem);
            }
            
            // Move to parent block
            currentBlockId = block.derive.sourceId;
        }
        
        return reconstructedDialog;
    })();

    // Define sample tasks
    const sampleTasks = [
        {
            text: "Extract top repos from https://github.com/microsoft",
            fullText: "extract the top repos information from https://github.com/microsoft?q=&type=all&language=&sort=stargazers",
            icon: <LanguageIcon sx={{ fontSize: 18 }} />
        },
        {
            text: "Extract data from this image",
            fullText: "help me extract data from this image",
            icon: <ImageIcon sx={{ fontSize: 18 }} />,
            image: exampleImageTable
        },
        {
            text: "Extract growth data from text",
            fullText: `help me extract sub-segment growth data from this text\n\n\"Revenue in Productivity and Business Processes was $33.1 billion and increased 16% (up 14% in constant currency), with the following business highlights:
·        Microsoft 365 Commercial products and cloud services revenue increased 16% (up 15% in constant currency) driven by Microsoft 365 Commercial cloud revenue growth of 18% (up 16% in constant currency)
·        Microsoft 365 Consumer products and cloud services revenue increased 21% driven by Microsoft 365 Consumer cloud revenue growth of 20%
·        LinkedIn revenue increased 9% (up 8% in constant currency)
·        Dynamics products and cloud services revenue increased 18% (up 17% in constant currency) driven by Dynamics 365 revenue growth of 23% (up 21% in constant currency)

Revenue in Intelligent Cloud was $29.9 billion and increased 26% (up 25% in constant currency), with the following business highlights:
·        Server products and cloud services revenue increased 27% driven by Azure and other cloud services revenue growth of 39%

Revenue in More Personal Computing was $13.5 billion and increased 9%, with the following business highlights:
·        Windows OEM and Devices revenue increased 3%
·        Xbox content and services revenue increased 13% (up 12% in constant currency)
·        Search and news advertising revenue excluding traffic acquisition costs increased 21% (up 20% in constant currency)\"`,
            icon: <TextFieldsIcon sx={{ fontSize: 18 }} />
        },
        {
            text: "Generate UK dynasty dataset",
            fullText: "help me generate a dataset about uk dynasty with their years of reign and their monarchs",
            icon: <DatasetIcon sx={{ fontSize: 18 }} />
        }
    ];

    const placeholder = (existOutputBlocks) 
        ? (selectedTable && selectedTable.content.type === 'image_url' 
            ? "extract data from this image" 
            : "follow-up instruction (e.g., fix headers, remove totals, generate 15 rows, etc.)")
        : "paste the content (website, image, text block, etc.) and ask AI to extract / clean data from it";

    let additionalImages = (() => {
        if (selectedTable && selectedTable.content.type === 'image_url') {
            return [selectedTable.content.value];
        }
        return [];
    })();

    const canSend = (() => {
        // Allow sending if there's prompt text or image data
        const hasPrompt = prompt.trim().length > 0;
        const hasImageData = userImages.length > 0 || additionalImages.length > 0;
        return (hasPrompt || hasImageData) && !cleanInProgress;
    })();

    // Function to extract URLs from the current prompt
    const extractedUrls = (() => {
        const urlRegex = /(https?:\/\/[^\s]+)/gi;
        const matches = prompt.match(urlRegex);
        if (!matches) return [];
        
        // Remove trailing commas and periods from URLs
        const cleanedUrls = matches.map(url => {
            return url.replace(/[,.]$/, '');
        });
        
        return [...new Set(cleanedUrls)]; // Remove duplicates
    })();

    const handlePasteImage = (e: React.ClipboardEvent<HTMLDivElement>) => {
        if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
            const files = Array.from(e.clipboardData.files);
            const imageFiles = files.filter(file => file.type.startsWith('image/'));
            
            if (imageFiles.length > 0) {
                const newImages: string[] = [];
                let processedCount = 0;
                
                imageFiles.forEach(file => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const res = reader.result as string;
                        if (res) {
                            newImages.push(res);
                        }
                        processedCount++;
                        
                        if (processedCount === imageFiles.length) {
                            setUserImages(prev => [...prev, ...newImages]);
                        }
                    };
                    reader.readAsDataURL(file);
                });
            }
        }
    };

    const removeImage = (index: number) => {
        setUserImages(prev => prev.filter((_, i) => i !== index));
    };

    const stopGeneration = () => {
        if (abortControllerRef?.current) {
            abortControllerRef.current.abort();
        }
    };

    const sendRequest = (promptToUse: string, imagesToUse: string[]) => {        
        // Check if we can send with the provided or state values
        const hasPrompt = promptToUse.trim().length > 0;
        const hasImageData = imagesToUse.length > 0 || additionalImages.length > 0;
        if (!hasPrompt && !hasImageData) return;
        if (cleanInProgress) return;
        
        dispatch(dfActions.setCleanInProgress(true));
        const token = String(Date.now());

        let prompt_to_send = promptToUse.trim() || (hasImageData ? 'extract data from the image' : 'let\'s generate some interesting data');
        let images_to_send = [...additionalImages, ...imagesToUse];

        // Extract URLs from the prompt
        const urlRegex = /(https?:\/\/[^\s]+)/gi;
        const matches = prompt_to_send.match(urlRegex);
        const extractedUrlsFromPrompt = matches ? [...new Set(matches)] : [];

        // Construct payload - simplified to match backend API
        const payload: any = {
            token,
            model: activeModel,
            prompt: prompt_to_send,
            artifacts: [
                ...images_to_send.map(image => ({ type: 'image_url', content: image })),
                ...extractedUrlsFromPrompt.map(url => ({ type: 'web_url', content: url })),
            ],
            dialog: dialog
        };

        // Create abort controller
        const controller = new AbortController();
        if (abortControllerRef) {
            abortControllerRef.current = controller;
        }

        fetch(getUrls().CLEAN_DATA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        })
        .then(async (response) => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body reader available');
            }

            const decoder = new TextDecoder();
            let buffer = '';
            let finalResult: any = null;

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    
                    if (done) {
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });
                    onStreamingContentUpdate?.(buffer);

                    // Split by newlines to get individual JSON objects
                    const lastLine = buffer.split('\n').filter(line => line.trim() !== "").pop();

                    // Process each line
                    if (lastLine) {
                        try {
                            const data = JSON.parse(lastLine);
                            if (data.status === "ok" && data.content) {
                                finalResult = data;
                                break;
                            } 
                        } catch (parseError) {
                            continue
                        }
                    }
                }

                if (finalResult && finalResult.status === 'ok' && finalResult.content) {
                    const tables = finalResult.content;
                    const updatedDialog = finalResult.dialog || [];
                    
                    // Create new DataCleanBlock
                    const newBlock: DataCleanBlock = {
                        id: `block-${Date.now()}`,
                        items: tables,
                        derive: {
                            sourceId: focusedDataCleanBlockId?.blockId,
                            prompt: prompt_to_send,
                            artifacts: [
                                ...images_to_send.map(image => ({ type: 'image_url' as const, value: image })),
                                ...extractedUrls.map(url => ({ type: 'web_url' as const, value: url })),
                            ]
                        },
                        dialogItem: updatedDialog.length > 0 ? updatedDialog[updatedDialog.length - 1] : undefined
                    };
                    
                    onStreamingContentUpdate?.('');
                    dispatch(dfActions.addDataCleanBlock(newBlock));
                    dispatch(dfActions.setFocusedDataCleanBlockId({blockId: newBlock.id, itemId: 0}));
                    
                    // Clear input fields only after successful completion
                    setPrompt('');
                    setUserImages([]);
                } else {
                    // Generation failed
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(),
                        type: 'error',
                        component: 'data loader',
                        value: finalResult?.content || 'Unable to extract tables from response',
                    }));
                    // Clear input fields only after failed completion
                    setPrompt('');
                    onStreamingContentUpdate?.('');
                    setUserImages([]);
                }
            } finally {
                reader.releaseLock();
                dispatch(dfActions.setCleanInProgress(false));
                if (abortControllerRef) {
                    abortControllerRef.current = null;
                }
            }
        })
        .catch((error) => {
            dispatch(dfActions.setCleanInProgress(false));
            if (abortControllerRef) {
                abortControllerRef.current = null;
            }
            
            // Check if this was an abort (user stopped the generation)
            if (error.name === 'AbortError') {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'info',
                    component: 'data loader',
                    value: 'Generation stopped by user',
                }));
            } else {
                // Generation failed
                const errorMessage = `Server error while processing data: ${error.message}`;
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'error',
                    component: 'data loader',
                    value: errorMessage,
                }));
            }
            
            // Clear input fields only after failed completion
            setPrompt('');
            setUserImages([]);
            onStreamingContentUpdate?.('');
        });
    };

    // Expose sendRequest function to parent via ref
    React.useEffect(() => {
        if (ref && typeof ref === 'object' && 'current' in ref) {
            ref.current = () => sendRequest(prompt, userImages);
        }
    }, [canSend, prompt, additionalImages, userImages, extractedUrls, dialog, activeModel, focusedDataCleanBlockId, dispatch]);

    let inputImages = [...userImages, ...additionalImages];

    return (
        <Stack sx={{ py: 1, position: 'relative' }} direction="row" spacing={1} alignItems="flex-end">
            {cleanInProgress && <LinearProgress sx={{ width: '100%', height: '100%', position: 'absolute', opacity: 0.1, top: 0, left: 0, right: 0, zIndex: 1, pointerEvents: 'none' }} />}    
            <Box sx={{ flex: 1, position: 'relative' }}>
            
            {/* HTML Address Chips */}
            {extractedUrls.length > 0 && (
                <Box sx={{ 
                    display: 'flex', 
                    flexDirection: 'row', 
                    flexWrap: 'wrap', 
                    gap: 0.5, 
                    mb: 1,
                    position: 'relative' 
                }}>
                    {extractedUrls.map((url, index) => (
                        <Chip
                            key={index}
                            icon={<LinkIcon sx={{ fontSize: 16 }} />}
                            label={url.length > 50 ? `${url.substring(0, 47)}...` : url}
                            variant="outlined"
                            color="primary"
                            size="small"
                            sx={{
                                maxWidth: existOutputBlocks ? 280 : 400,
                                backgroundColor: 'primary.50',
                                borderColor: 'primary.200',
                                color: 'primary.700',
                                borderRadius: 2,
                                '& .MuiChip-label': {
                                    fontSize: existOutputBlocks ? '11px' : '12px',
                                    maxWidth: '100%',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                }
                            }}
                        />
                    ))}
                </Box>
            )}

            {inputImages.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 0.5, mt: 0.5, position: 'relative' }}>
                    {inputImages.map((imageUrl, index) => (
                        <Box key={index} sx={{ display: 'block', position: 'relative' }}>
                            <Box 
                                component="img"
                                src={imageUrl}
                                alt={`Pasted image ${index + 1}`}
                                sx={{
                                    maxHeight: existOutputBlocks ? 60 : 600,
                                    maxWidth: inputImages.length > 1 ? '30%' : 600,
                                    objectFit: 'cover',
                                    borderRadius: 1,
                                    border: '1px solid',
                                    borderColor: 'divider'
                                }}
                            />
                            {userImages.includes(imageUrl) ? <IconButton  
                                sx={{position: 'absolute', top: 0, right: 0}}
                                size="small" 
                                onClick={() => removeImage(index)}
                            >
                                <CancelIcon fontSize="small" />
                            </IconButton> : <Typography sx={{fontSize: '10px', color: 'text.secondary', position: 'absolute', top: 0, right: 0, width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                                ➤
                            </Typography>}
                        </Box>
                    ))}
                </Box>
            )}
            
            <TextField
                sx={{
                    '& .MuiInputBase-root': {
                        p: 1,
                        fontSize: existOutputBlocks ? '12px' : '14px',
                        position: 'relative',
                        zIndex: 2
                    }
                }}
                placeholder={cleanInProgress ? 'extracting data...' : placeholder}
                variant="standard"
                multiline
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                fullWidth
                disabled={cleanInProgress}
                autoComplete="off"
                maxRows={maxLines}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendRequest(prompt, userImages);
                    }
                }}
                slotProps={{
                    input: {
                        endAdornment: cleanInProgress ? (
                            <Tooltip title="Stop generation">
                                <IconButton color='error' size="small" onClick={stopGeneration}>
                                    <StopIcon />
                                </IconButton>
                            </Tooltip>
                        ) : (
                            <IconButton color='primary' size="small" disabled={!canSend} 
                                onClick={() => sendRequest(prompt, userImages)}>
                                <PrecisionManufacturingIcon />
                            </IconButton>
                        )
                    }
                }}
                onPaste={handlePasteImage}
            />
            
            {/* Sample Task Cards - Show only when no output blocks exist and not processing */}
            {!existOutputBlocks && !cleanInProgress && (
                <Box sx={{ mt: 2, mb: 1 }}>
                    <Typography sx={{ fontSize: '11px', color: 'text.secondary', mb: 1 }}>
                        examples
                    </Typography>
                    <Box sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 1,
                    }}>
                        {sampleTasks.map((task, index) => (
                            <SampleTaskChip
                                key={index}
                                task={task}
                                theme={theme}
                                onClick={async () => {
                                    let imagesToSend: string[] = [];
                                    
                                    if (task.image) {
                                        // Convert example image to data URL
                                        try {
                                            const response = await fetch(task.image);
                                            const blob = await response.blob();
                                            const reader = new FileReader();
                                            
                                            await new Promise<void>((resolve) => {
                                                reader.onload = () => {
                                                    const dataUrl = reader.result as string;
                                                    imagesToSend = [dataUrl];
                                                    setUserImages([dataUrl]);
                                                    resolve();
                                                };
                                                reader.readAsDataURL(blob);
                                            });
                                        } catch (error) {
                                            console.error('Failed to load image:', error);
                                        }
                                    }
                                    
                                    // Set prompt for display
                                    setPrompt(task.fullText);
                                    
                                    // Call sendRequest with explicit parameters
                                    sendRequest(task.fullText, imagesToSend);
                                }}
                                disabled={cleanInProgress}
                            />
                        ))}
                    </Box>
                </Box>
            )}
            </Box>
        </Stack>
    );
});

// Utility function to convert dataCleanBlocks into ordered threadBlocks
export interface ThreadBlock {
    threadIndex: number;
    blocks: DataCleanBlock[];
    leafBlock: DataCleanBlock;
}

export const createOrderedThreadBlocks = (dataCleanBlocks: DataCleanBlock[]): ThreadBlock[] => {
    // Helper function to get the path from root to a block
    const getBlockPath = (blockId: string): DataCleanBlock[] => {
        const path: DataCleanBlock[] = [];
        let currentBlock = dataCleanBlocks.find(b => b.id === blockId);
        
        while (currentBlock) {
            path.unshift(currentBlock);
            currentBlock = dataCleanBlocks.find(b => b.id === currentBlock?.derive.sourceId);
        }
        
        return path;
    };

    // Identify leaf blocks (blocks that have no children)
    const getLeafBlocks = (): DataCleanBlock[] => {
        return dataCleanBlocks.filter(block => {
            // A block is a leaf if no other block has it as a parent
            return !dataCleanBlocks.some(otherBlock => otherBlock.derive.sourceId === block.id);
        });
    };

    // Get blocks that should be displayed in a thread (avoiding repetition)
    const getThreadBlocks = (leafBlock: DataCleanBlock, usedBlockIds: Set<string>): DataCleanBlock[] => {
        const path = getBlockPath(leafBlock.id);
        
        // Find the first block in the path that hasn't been used in previous threads
        let startIndex = 0;
        for (let i = 0; i < path.length; i++) {
            if (!usedBlockIds.has(path[i].id)) {
                startIndex = i;
                break;
            }
        }
        
        return path.slice(startIndex);
    };

    // Sort leaf blocks by their creation order (using block IDs which contain timestamps)
    const leafBlocks = getLeafBlocks().sort((a, b) => {
        const aTime = parseInt(a.id.split('-')[1] || '0');
        const bTime = parseInt(b.id.split('-')[1] || '0');
        return aTime - bTime;
    });

    // Build threads
    const threads: ThreadBlock[] = leafBlocks.map((leafBlock, threadIndex) => {
        const usedBlockIds = new Set<string>();
        
        // Collect all block IDs used in previous threads
        for (let i = 0; i < threadIndex; i++) {
            const previousThreadBlocks = getThreadBlocks(leafBlocks[i], new Set());
            previousThreadBlocks.forEach(block => usedBlockIds.add(block.id));
        }
        
        const threadBlocks = getThreadBlocks(leafBlock, usedBlockIds);
        
        return {
            threadIndex,
            blocks: threadBlocks,
            leafBlock
        };
    });

    return threads;
};


export const SingleDataCleanThreadView: React.FC<{thread: ThreadBlock, sx?: SxProps}> = ({thread, sx}) => {
    const {threadIndex, blocks, leafBlock} = thread;
    const theme = useTheme();

    const dispatch = useDispatch<AppDispatch>();
    const focusedDataCleanBlockId = useSelector((state: DataFormulatorState) => state.focusedDataCleanBlockId);

    let isThreadFocused = blocks.some(block => block.id === focusedDataCleanBlockId?.blockId);

    return (
        <Box sx={{
            display: 'flex', 
            flexDirection: 'column', 
            gap: 0,
            mb: 2,
            borderRadius: 2,
            //boxShadow: isThreadFocused ? "0 2px 8px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.12)" : "none",
            transition: 'all 0.2s ease-in-out',
            // '&:hover': {
            //     boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            // },
            ...sx
        }}>
            {/* Thread header */}
            <Box sx={{ display: 'flex', direction: 'ltr', margin: '2px 2px 8px 2px' }}>
                <Divider flexItem sx={{
                    margin: 'auto',
                    "& .MuiDivider-wrapper": { display: 'flex', flexDirection: 'row' },
                    "&::before, &::after": { borderColor: alpha(theme.palette.divider, 0.2), borderWidth: '2px', width: 60 },
                }}>
                    <Typography sx={{ fontSize: "10px",   textTransform: 'none' }}>
                        {`loading - ${threadIndex + 1}`}
                    </Typography>
                </Divider>
            </Box>
            
            {/* Thread content */}
            {blocks.map((block, blockIndex) => {
                const isLastBlock = blockIndex === blocks.length - 1;
                
                return (
                    <Box key={block.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0}}>
                        {/* Start circle for the first block */}
                        {blockIndex === 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', ml: '5px' }}>
                                <PanoramaFishEyeIcon sx={{ fontSize: 7, color: 'darkgray' }} />
                            </Box>
                        )}
                        
                        <Box sx={{borderLeft: isThreadFocused ? '3px solid' : '1px dashed', 
                                borderColor: isThreadFocused ? 'primary.light' : ' rgba(0, 0, 0, 0.3)',
                                py: blockIndex === 0 ? 0.5 : 1.5, px: 1, 
                                  display: 'flex', alignItems: 'center', ml: isThreadFocused ? '7px' : '8px'}}>
                        </Box>

                        {/* User Instruction Card (styled like TriggerCard) */}
                        <Card 
                            variant="outlined" 
                            sx={{
                                backgroundColor: alpha(theme.palette.custom.main, 0.05), 
                                fontSize: '10px', 
                                display: 'flex', 
                                flexDirection: 'row', 
                                alignItems: 'center', 
                                gap: '2px',
                            }}
                        >
                            <PrecisionManufacturingIcon sx={{ml: 1, color: 'darkgray', width: '14px', height: '14px'}} />
                            <Box sx={{margin: "4px 8px 4px 2px"}}>
                                {/* Text prompt */}
                                {block.derive.prompt && (
                                    <Typography fontSize="inherit" sx={{
                                        textAlign: 'center', 
                                        textWrap: 'balance',
                                        minWidth: '40px',
                                        color: 'rgba(0,0,0,0.7)',
                                        display: '-webkit-box',
                                        overflow: 'auto',
                                        textOverflow: 'ellipsis',
                                        wordBreak: 'break-word',
                                        maxHeight: 100
                                    }}>
                                        "{block.derive.prompt}"
                                    </Typography>
                                )}
                                
                                {/* Images if present */}
                                {block.derive.artifacts && block.derive.artifacts.filter(a => a.type === 'image_url').length > 0 && (
                                    <Box sx={{ 
                                        display: 'flex', 
                                        flexWrap: 'wrap',
                                        gap: 0.5,
                                        py: 0.5,
                                    }}>
                                        {block.derive.artifacts
                                            .filter(artifact => artifact.type === 'image_url')
                                            .map((artifact, imgIndex) => (
                                            <Box
                                                key={imgIndex}
                                                component="img"
                                                src={artifact.value}
                                                alt={`User uploaded image ${imgIndex + 1}`}
                                                sx={{
                                                    width: 'auto',
                                                    height: 40,
                                                    maxWidth: 100,
                                                    objectFit: 'cover',
                                                    borderRadius: 0.5,
                                                    border: '1px solid',
                                                    borderColor: 'divider'
                                                }}
                                            />
                                        ))}
                                    </Box>
                                )}
                            </Box>
                        </Card>
                        
                        {/* Down arrow connecting instruction to output */}
                        <Box sx={{ display: 'flex', alignItems: 'center',}}>
                            <SouthIcon color={isThreadFocused ? 'primary' : 'secondary'} sx={{ fontSize: 16, ml: 0.5 }} />
                        </Box>
                        
                        {/* Output Cards (styled like primary colored cards) */}
                        {block.items?.map((table, itemId) => {
                            const isItemSelected = block.id === focusedDataCleanBlockId?.blockId && itemId === focusedDataCleanBlockId.itemId;
                            return (
                                <Card
                                    variant="outlined"
                                    sx={{
                                        py: 0,
                                        mt: itemId === 0 ? 0 : 0.5,
                                        border: isItemSelected ? `2px solid ${theme.palette.primary.light}` : '1px solid lightgray',
                                        cursor: 'pointer',
                                        backgroundColor: alpha(theme.palette.primary.light, 0.1), 
                                        '&:hover': {
                                            boxShadow: '0 0 3px rgba(33,33,33,.2)',
                                            transform: "translate(0px, 1px)",  
                                        }
                                    }}
                                    onClick={() => dispatch(dfActions.setFocusedDataCleanBlockId({blockId: block.id, itemId: itemId}))}
                                >
                                    <Box sx={{ margin: '0px', display: 'flex', py: 0.5 }}>
                                        <Stack direction="row" sx={{ 
                                            marginLeft: 0.5, marginRight: 'auto', fontSize: 12, width: 'calc(100% - 8px)',
                                            alignItems: 'center' }} gap={"2px"}>
                                            {table.content.type === 'csv' && <TableIcon  sx={{color: 'darkgray', fontSize: 14}} />}
                                            {table.content.type === 'image_url' && <LinkIcon  sx={{color: 'darkgray', fontSize: 14}} />}
                                            {table.content.type === 'web_url' && <LinkIcon sx={{color: 'darkgray', fontSize: 14}} />}
                                            <Typography fontSize="inherit" sx={{
                                                ml: 0.5,
                                                color: 'rgba(0,0,0,0.7)', 
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                display: '-webkit-box',
                                                WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical',
                                            }}>
                                                {table.name}
                                            </Typography>
                                            {isLastBlock && <Tooltip title="delete table">
                                                <IconButton aria-label="share" size="small" sx={{ ml: 'auto', padding: 0.25, '&:hover': {
                                                    transform: 'scale(1.2)',
                                                    transition: 'all 0.2s ease'
                                                } }} onClick={(event) => {
                                                    event.stopPropagation();
                                                    dispatch(dfActions.removeDataCleanBlocks({ blockIds: [block.id] })) 
                                                }}>
                                                    <DeleteIcon fontSize="small" sx={{ fontSize: 18 }} color='warning'/>
                                                </IconButton>
                                            </Tooltip>
                                            }
                                        </Stack>
                                    </Box>
                                </Card>
                            );
                        })}
                    </Box>
                );
            })}
        </Box>
    );
};


export const DataLoadingThread: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const dataCleanBlocks = useSelector((state: DataFormulatorState) => state.dataCleanBlocks);

    // Use the utility function to create ordered thread blocks
    const threads = createOrderedThreadBlocks(dataCleanBlocks);

    let threadDisplay = <Box sx={{ 
        flex: 1,  
        width: 'calc(100% - 8px)',
        p: 0.5, 
        display: 'flex', 
        flexDirection: 'column', 
        maxHeight: '400px', 
        overflowY: 'auto', 
        overflowX: 'hidden'
    }}>
        {/* Render each thread */}
        {threads.map((thread) => (
            <SingleDataCleanThreadView key={`thread-${thread.threadIndex}`} thread={thread} />
        ))}
    </Box>

    return threadDisplay;
};