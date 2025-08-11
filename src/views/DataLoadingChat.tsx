// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import { Box, Button, Card, CardContent, Divider, IconButton, Paper, Stack, TextField, Typography, alpha, useTheme, Dialog, DialogTitle, DialogContent, Tooltip, LinearProgress, CircularProgress, Chip, SxProps } from '@mui/material';
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

import exampleImageTable from "../assets/example-image-table.png";

import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch } from '../app/store';
import { DataFormulatorState, dfActions, dfSelectors, fetchFieldSemanticType, DataCleanMessage, DataCleanTableOutput } from '../app/dfSlice';
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

const getUniqueTableName = (baseName: string, existingNames: Set<string>): string => {
    let uniqueName = baseName;
    let counter = 1;
    while (existingNames.has(uniqueName)) {
        uniqueName = `${baseName}_${counter}`;
        counter += 1;
    }
    return uniqueName;
};

const DataPreviewBox: React.FC<{rawTable: DataCleanTableOutput, sx?: SxProps}> = ({rawTable, sx}) => {
    if (rawTable.content.type === 'csv') {
        const suggestedName = rawTable.name || generateDefaultName(rawTable.content.value.slice(0, 96));
        const tableComponent = createTableFromText(suggestedName, rawTable.content.value);
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
            />
        }
        return <Paper variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, ...sx }}>
            <Typography variant="body2" sx={{ fontSize: '10px', color: 'text.secondary' }}>
                {rawTable.content.value}
            </Typography>
        </Paper>
    }
    
    console.log(rawTable);

    // Handle image_url content type
    if (rawTable.content.type === 'image_url') {
        return <Paper variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, ...sx }}>
            <Typography variant="body2" sx={{ fontSize: '10px', color: 'text.secondary' }}>
                Image URL: {rawTable.content.value}
            </Typography>
            <Box
                component="img"
                src={rawTable.content.value}
                alt={`Image from ${rawTable.name || 'data source'}`}
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
    if (rawTable.content.type === 'web_url') {
        return <Paper variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, ...sx }}>
            <Typography variant="body2" sx={{ fontSize: '12px', color: 'text.primary', fontWeight: 500 }}>
                Data URL
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '10px', color: 'text.secondary', wordBreak: 'break-all' }}>
                {rawTable.content.value}
            </Typography>
        </Paper>
    }
    
    // Fallback for other content types
    return <Paper variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, ...sx }}>
        <Typography variant="body2" sx={{ fontSize: '10px', color: 'text.secondary' }}>
            {rawTable.content.value}
        </Typography>
    </Paper>
}

export const DataLoadingChat: React.FC = () => {
    const theme = useTheme();
    const dispatch = useDispatch<AppDispatch>();
    const activeModel = useSelector(dfSelectors.getActiveModel);
    const existingTables = useSelector((state: DataFormulatorState) => state.tables);
    const dataCleanMessages = useSelector((state: DataFormulatorState) => state.dataCleanMessages);
    const existingNames = new Set(existingTables.map(t => t.id));

    const [userImages, setUserImages] = useState<string[]>([]);
    const [prompt, setPrompt] = useState('');

    const [loading, setLoading] = useState(false);
    const [selectedTableIndex, setSelectedTableIndex] = useState<{outputIndex: number, tableIndex: number}>({outputIndex: -1, tableIndex: -1});

    const [datasetName, setDatasetName] = useState('');

    const textAreaRef = useRef<HTMLDivElement | null>(null);

    let existOutputMessages = dataCleanMessages.filter(m => m.type === 'output').length > 0;

    // Reconstruct dialog from Redux state for API compatibility
    const dialog: DialogMessage[] = (() => {
        const reconstructedDialog: DialogMessage[] = [];
        
        for (const msg of dataCleanMessages) {
            if (msg.type === 'input') {
                const content: DialogContentItem[] = [];
                if (msg.prompt) {
                    content.push({ type: 'text', text: msg.prompt });
                }
                if (msg.imageData) {
                    msg.imageData.forEach(imageUrl => {
                        content.push({ 
                            type: 'image_url', 
                            image_url: { url: imageUrl } 
                        });
                    });
                }
                reconstructedDialog.push({
                    role: 'user',
                    content: content.length === 1 && content[0].type === 'text' ? content[0].text : content
                });
            } else if (msg.type === 'output' && msg.dialogItem) {
                reconstructedDialog.push(msg.dialogItem);
            }
        }
        
        return reconstructedDialog;
    })();

    // Get the selected CSV data from Redux state
    const selectedTable = (() => {
        const outputMessages = dataCleanMessages.filter(msg => msg.type === 'output');
        if (selectedTableIndex.outputIndex >= 0 && selectedTableIndex.outputIndex < outputMessages.length) {
            return outputMessages[selectedTableIndex.outputIndex]?.outputTables?.[selectedTableIndex.tableIndex];
        }
        // Fallback to latest if no selection or invalid selection
        return outputMessages.length > 0 ? outputMessages[outputMessages.length - 1].outputTables?.[0] : undefined;
    })();
    // Add rotating placeholder state
    const [placeholderIndex, setPlaceholderIndex] = useState(0);
    const placeholders = existOutputMessages ? [
            selectedTable && selectedTable.content.type === 'image_url' ? "extract data from this image" : "follow-up instruction (e.g., fix headers, remove totals, generate 15 rows, etc.)"
    ] : [
        "get Claude performance data from https://www.anthropic.com/news/claude-opus-4-1",
        "help me extract data from this image",
        "help me parse data from this text\n\n\"Our quarterly sales report shows that John Smith achieved $45,000 in Q1, while Sarah Johnson reached $52,000. The top performer was Mike Chen with $67,000 in sales. Regional breakdown: NYC office contributed $180,000, LA office $165,000, and Chicago office $142,000. Customer satisfaction scores averaged 4.2/5 across all regions.\" only extract the part about people.",
        "help me generate a dataset about uk dynasty with their years of reign and their monarchs"
    ];
    // Rotate placeholders every 3 seconds
    useEffect(() => {
        const interval = setInterval(() => {
            if (userImages.length > 0 || additionalImages.length > 0) {
                setPlaceholderIndex(0);
            } else {
                setPlaceholderIndex((prevIndex) => (prevIndex + 1) % placeholders.length);
            }
        }, 3600);

        return () => clearInterval(interval);
    }, []);

    // Add this utility function to convert the image to base64
    const convertImageToBase64 = async (imageUrl: string): Promise<string> => {
        try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const result = reader.result as string;
                    resolve(result);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            console.error('Error converting image to base64:', error);
            return imageUrl; // fallback to original URL
        }
    };

    // Create a memoized base64 version of the example image
    const [exampleImageTableBase64, setExampleImageTableBase64] = useState<string>('');

    useEffect(() => {
        // Convert the image to base64 only once when component mounts
        convertImageToBase64(exampleImageTable).then(setExampleImageTableBase64);
    }, []);

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
        return (hasPrompt || hasImageData) && !loading;
    })();

    // Function to extract URLs from the current prompt
    const extractedUrls = (() => {
        const urlRegex = /(https?:\/\/[^\s]+)/gi;
        const matches = prompt.match(urlRegex);
        return matches ? [...new Set(matches)] : []; // Remove duplicates
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

    const resetAll = () => {
        setUserImages([]);
        setPrompt('');
        setDatasetName('');
        setSelectedTableIndex({outputIndex: -1, tableIndex: -1});
        dispatch(dfActions.resetDataCleanMessages());
    };

    const sendRequest = () => {
        if (!canSend) return;
        setLoading(true);
        const token = String(Date.now());

        let prompt_to_send = prompt.trim() || (additionalImages.length > 0 ? 'extract data from the image' : '');
        let images_to_send = [...additionalImages, ...userImages];

        // Construct payload - simplified to match backend API
        const payload: any = {
            token,
            model: activeModel,
            prompt: prompt_to_send,
            artifacts: [
                ...images_to_send.map(image => ({ type: 'image_url', content: image })),
                ...extractedUrls.map(url => ({ type: 'web_url', content: url })),
            ],
            dialog: dialog
        };

        const inputMessage: DataCleanMessage = {
            type: 'input',
            timestamp: Date.now(),
            prompt: prompt_to_send,
            imageData: images_to_send.length > 0 ? images_to_send : undefined,
        };



        fetch(getUrls().CLEAN_DATA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
            .then(r => r.json())
            .then(data => {
                setLoading(false);
                if (data && data.status === 'ok' && data.result && data.result.length > 0) {

                    // Only add input message to history if generation succeeds
                    dispatch(dfActions.addDataCleanMessage(inputMessage));
                    
                    const cand = data.result[0];
                    const tables = cand.content.tables;
                    const csv = tables[0].content.value;
                    const info = tables[0].reason || "";
                    const updatedDialog = cand.dialog || [];
                    
                    // Use suggested name from agent if available, otherwise generate default
                    const suggestedName = tables[0].name || generateDefaultName(csv.slice(0, 96));
                    if (!datasetName) setDatasetName(suggestedName);

                    // Add output message to Redux state
                    const outputMessage: DataCleanMessage = {
                        type: 'output',
                        timestamp: Date.now(),
                        outputTables: tables,
                        dialogItem: updatedDialog.length > 0 ? updatedDialog[updatedDialog.length - 1] : undefined
                    };
                    dispatch(dfActions.addDataCleanMessage(outputMessage));
                    
                    // Clear input fields only after successful completion
                    setPrompt('');
                    setUserImages([]);
                } else {
                    // Generation failed - don't add input message to history
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(),
                        type: 'error',
                        component: 'data loader',
                        value: data.result,
                    }));
                    // Clear input fields only after failed completion
                    setPrompt('');
                    setUserImages([]);
                }
            })
            .catch(() => {
                setLoading(false);
                // Generation failed - don't add input message to history
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'error',
                    component: 'data loader',
                    value: 'Server error while processing data.',
                }));
                
                // Clear input fields only after failed completion
                setPrompt('');
                setUserImages([]);
            });
    };

    const handleUpload = () => {
        if (!selectedTable) return;
        
        const suggestedName = selectedTable.name || datasetName || generateDefaultName(selectedTable.content.value.slice(0, 96));
        
        const base = suggestedName.trim();
        const unique = getUniqueTableName(base, existingNames);
        const table = createTableFromText(unique, selectedTable.content.value);
        if (table) {
            dispatch(dfActions.loadTable(table));
            dispatch(fetchFieldSemanticType(table));
        }
    };

    // Update selected output when new output is added
    useEffect(() => {
        const outputMessages = dataCleanMessages.filter(msg => msg.type === 'output');
        if (outputMessages.length > 0) {
            // Always auto-select the latest output when a new output is added
            setSelectedTableIndex({outputIndex: outputMessages.length - 1, tableIndex: 0});
        } else {
            // Reset selection when all messages are cleared
            setSelectedTableIndex({outputIndex: -1, tableIndex: -1});
        }
    }, [dataCleanMessages]);

    // Function to remove the last output message and its corresponding input
    const removeLastOutput = () => {
        const outputMessages = dataCleanMessages.filter(msg => msg.type === 'output');
        if (outputMessages.length === 0) return;
        
        const lastOutputIndex = dataCleanMessages.findIndex(msg => msg === outputMessages[outputMessages.length - 1]);
        const lastInputIndex = lastOutputIndex - 1;
        
        // Remove both the output and input messages
        const messageIdsToRemove = [];
        if (lastInputIndex >= 0 && dataCleanMessages[lastInputIndex].type === 'input') {
            messageIdsToRemove.push(dataCleanMessages[lastInputIndex].timestamp);
        }
        messageIdsToRemove.push(dataCleanMessages[lastOutputIndex].timestamp);
        
        dispatch(dfActions.removeDataCleanMessage({ messageIds: messageIdsToRemove }));
    };

    let threadDisplay = <Box sx={{ 
        flex: 1,  display: 'flex', flexDirection: 'column', maxHeight: '400px', 
        overflowY: 'auto', overflowX: 'hidden'
    }} ref={textAreaRef}>
        {/* Conversation Thread */}
        {dataCleanMessages.map((msg, i) => {
            const outputMessages = dataCleanMessages.filter(m => m.type === 'output');
            const outputIndex = outputMessages.findIndex(m => m === msg);
            const isLastOutput = msg.type === 'output' && outputIndex === outputMessages.length - 1;
            
            return (
                <Box key={i} sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {/* Start circle for the first message */}
                    {i === 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', ml: '6px' }}>
                            <PanoramaFishEyeIcon sx={{ fontSize: 6, color: 'darkgray' }} />
                        </Box>
                    )}
                    
                    {/* User Instruction (for input messages) */}
                    {msg.type === 'input' && (
                        <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 1 }}>
                            
                            {/* User Message Card */}
                            <Box
                                sx={{
                                    ml: 1, borderLeft: '1px dashed', borderColor: 'divider',
                                    backgroundColor: 'background.paper',  flex: 1, p: 1.5,
                                    display: 'flex', flexDirection: 'column', gap: 1
                                }}
                            >
                                {/* Text prompt */}
                                {msg.prompt && (
                                    <Typography variant="body2" sx={{ 
                                        fontSize: '10px', color: 'text.secondary',
                                        overflow: 'hidden',
                                        display: '-webkit-box',
                                        WebkitLineClamp: 4, // This will show 3 lines and add ellipsis
                                        WebkitBoxOrient: 'vertical',
                                        lineHeight: '1.2em',
                                    }}>
                                        "{msg.prompt}"
                                    </Typography>
                                )}
                                
                                {/* Images if present */}
                                {msg.imageData && (
                                    <Box sx={{ 
                                        display: 'flex', 
                                        flexWrap: 'wrap',
                                        gap: 0.5,
                                        py: 0.5,
                                    }}>
                                        {msg.imageData.map((imageUrl, imgIndex) => (
                                            <Box
                                                key={imgIndex}
                                                component="img"
                                                src={imageUrl}
                                                alt={`User uploaded image ${imgIndex + 1}`}
                                                sx={{
                                                    width: 'auto',
                                                    height: 70,
                                                    maxWidth: 180,
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
                        </Box>
                    )}
                    
                    {/* Output Card (only for output messages) */}
                    {msg.type === 'output' && (
                        <Box sx={{ display: 'flex', flexDirection: 'row', gap: 0, alignItems: 'center', pl: 0.5, position: 'relative' }}>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0, alignItems: 'flex-start' }}>
                                {msg.outputTables?.map((table, tableIndex) => {
                                    const isSelected = msg.type === 'output' && outputIndex === selectedTableIndex.outputIndex && tableIndex === selectedTableIndex.tableIndex;
                                    return <Box
                                        key={tableIndex}
                                        onClick={() => setSelectedTableIndex({outputIndex: outputIndex, tableIndex: tableIndex})}
                                        sx={{
                                            py: 0,  pr: 1, gap: 1,
                                            borderRadius: 1,
                                            display: 'flex',
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            width: 'fit-content',
                                            color: 'primary.main',
                                            cursor: 'pointer',
                                            position: 'relative',
                                            textDecoration: isSelected ? 'underline' : 'none',
                                            '&:hover': {
                                                borderColor: isSelected ? 'primary.main' : 'primary.light',
                                                backgroundColor: isSelected ? alpha(theme.palette.primary.main, 0.08) : alpha(theme.palette.primary.main, 0.03),
                                            }
                                        }}
                                    >
                                        {table.content.type === 'csv' && <TableIcon color="primary" sx={{ fontSize: 12 }} />}
                                        {table.content.type === 'image_url' && <LinkIcon color="primary" sx={{ fontSize: 12 }} />}
                                        {table.content.type === 'web_url' && <LinkIcon color="primary" sx={{ fontSize: 12 }} />}
                                        <Typography variant="body2" sx={{ 
                                            fontSize: '10px', fontWeight: isSelected ? 600 : 400,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            maxWidth: '200px'
                                        }}>
                                            {table.name}
                                        </Typography>
                                        
                                    </Box>
                                })}
                                {/* Delete button for the last output message */}
                                {isLastOutput &&  (
                                    <Tooltip title="Remove this message">
                                        <IconButton
                                            size="small"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removeLastOutput();
                                            }}
                                            sx={{
                                                position: 'absolute',
                                                right: 0,
                                                top: 0,
                                                ml: 0, 
                                                width: 16,
                                                height: 16,
                                                color: 'warning.main',
                                                '&:hover': {
                                                    backgroundColor: alpha(theme.palette.error.main, 0.1),
                                                }
                                            }}
                                        >
                                            <DeleteIcon sx={{ fontSize: 12 }} />
                                        </IconButton>
                                    </Tooltip>
                                )}
                            </Box>
                        </Box>
                    )}
                </Box>
            );
        })}
        {/* Loading indicator at bottom of thread */}
        {loading && (
            <Box sx={{ 
                display: 'flex', 
                alignItems: 'left', flexDirection: 'column',
            }}>
                <Box sx={{ ml: 1, display: 'flex', alignItems: 'center', gap: 1, height: 10, borderLeft: '1px solid', borderColor: 'divider' }}></Box>
                <CircularProgress sx={{mr: 'auto', py: 0.5, ml: '3px'}} size={12} />
            </Box>
        )}
    </Box>

    let inputImages = [...userImages, ...additionalImages];

    let inputBox = 
        <Stack sx={{ py: 1, position: 'relative' }} direction="row" spacing={1} alignItems="flex-end">
            {loading && <LinearProgress sx={{ width: '100%', height: '100%', position: 'absolute', opacity: 0.1, top: 0, left: 0, right: 0, zIndex: 1 }} />}    
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
                                maxWidth: existOutputMessages ? 280 : 400,
                                backgroundColor: 'primary.50',
                                borderColor: 'primary.200',
                                color: 'primary.700',
                                borderRadius: 2,
                                '& .MuiChip-label': {
                                    fontSize: existOutputMessages ? '11px' : '12px',
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
                                    maxHeight: existOutputMessages ? 60 : 600,
                                    maxWidth: inputImages.length > 1 ? '30%' : 400,
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
                        fontSize: existOutputMessages ? '12px' : '14px'
                    },
                    '& .MuiInputBase-input::placeholder': {
                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        transform: 'translateY(0)',
                        '&.placeholder-changing': {
                            opacity: 0,
                            transform: 'translateY(-10px)',
                        }
                    },
                }}
                placeholder={placeholders[placeholderIndex]}
                variant="standard"
                multiline
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                fullWidth
                disabled={loading}
                autoComplete="off"
                maxRows={4}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendRequest();
                    }
                    if (e.key === 'Tab') {
                        e.preventDefault();
                        setPrompt(placeholders[placeholderIndex]);
                    }
                }}
                slotProps={{
                    input: {
                        endAdornment: <IconButton color='primary' size="small" disabled={!canSend || loading} onClick={sendRequest}>
                           <SendIcon />
                        </IconButton>
                    }
                }}
                onPaste={handlePasteImage}
            />
            </Box>
        </Stack>

    if (!existOutputMessages) {
        return <Box sx={{ width: 'calc(100% - 32px)', borderRadius: 2, px: 2 }}>
            {inputBox}
        </Box>
    }
    
    let chatCard = (
        <Box sx={{ width: dataCleanMessages.length > 0 ? '960px' : '640px', minHeight: 400,
                display: 'flex', flexDirection: 'row', borderRadius: 2 }}>
            
            {/* Left: Chat panel */}
            <Box
                sx={{
                    width: 240,
                    display: 'flex',
                    flexDirection: 'column',
                    borderRight: '1px solid',
                    borderColor: 'divider',
                    padding: 1.5,
                    position: 'relative'
                }}
            >
                <Tooltip title="Reset dialog">  
                    <IconButton size="small" color='warning' 
                        sx={{ width: 24, height: 24, position: 'absolute', top: 8, right: 8, backgroundColor: 'background.paper',
                        '&:hover': { backgroundColor: 'background.paper', transform: 'rotate(180deg)', 
                                     transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)' } }} onClick={resetAll}>
                        <RestartAltIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                {threadDisplay}
                {inputBox}
            </Box>

            {/* Right: Data preview panel */}
            {existOutputMessages && (
                <Box
                    sx={{
                        flex: 1.4,
                        minWidth: 480,
                        display: 'flex',
                        flexDirection: 'column',
                        padding: 1.5
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
                        {selectedTableIndex.outputIndex >= 0 && (
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
                            <DataPreviewBox rawTable={selectedTable} />
                        ) : (
                            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4, fontSize: '11px' }}>
                                No data available
                            </Typography>
                        )}

                        {/* Bottom submit bar */}
                        <Box sx={{ mt: 'auto', pt: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}>
                            {additionalImages.length > 0 && (
                                <Button
                                    variant="contained"
                                    sx={{  textTransform: 'none' }}
                                    onClick={() => {
                                        sendRequest();
                                    }}
                                    disabled={loading}
                                    size="small"
                                >
                                    Extract data from image
                                </Button>
                            )}
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

export default DataLoadingChat;

export interface DataLoadingChatDialogProps {
    buttonElement: any;
    disabled?: boolean;
}

export const DataLoadingChatDialog: React.FC<DataLoadingChatDialogProps> = ({ buttonElement, disabled = false }) => {
    const [dialogOpen, setDialogOpen] = useState<boolean>(false);
    
    return (
        <>
            <Button 
                sx={{fontSize: "inherit"}} 
                variant="text" 
                color="primary" 
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


