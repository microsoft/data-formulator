// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import validator from 'validator';

import { Box, Button, Card, CardContent, Divider, IconButton, Paper, Stack, TextField, Typography, alpha, useTheme, Dialog, DialogTitle, DialogContent, Tooltip, LinearProgress, CircularProgress } from '@mui/material';
import UploadIcon from '@mui/icons-material/Upload';
import SendIcon from '@mui/icons-material/Send';
import ImageIcon from '@mui/icons-material/Image';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CancelIcon from '@mui/icons-material/Cancel';
import PanoramaFishEyeIcon from '@mui/icons-material/PanoramaFishEye';
import CloseIcon from '@mui/icons-material/Close';
import CircleIcon from '@mui/icons-material/Circle';
import TableIcon from '@mui/icons-material/TableChart'; 

import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch } from '../app/store';
import { DataFormulatorState, dfActions, dfSelectors, fetchFieldSemanticType, DataCleanMessage } from '../app/dfSlice';
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
    info?: { mode?: string; reason?: string };
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

export const DataLoadingChat: React.FC = () => {
    const theme = useTheme();
    const dispatch = useDispatch<AppDispatch>();
    const activeModel = useSelector(dfSelectors.getActiveModel);
    const existingTables = useSelector((state: DataFormulatorState) => state.tables);
    const dataCleanMessages = useSelector((state: DataFormulatorState) => state.dataCleanMessages);
    const existingNames = new Set(existingTables.map(t => t.id));

    const [imageData, setImageData] = useState<string[]>([]);
    const [prompt, setPrompt] = useState('');

    const [loading, setLoading] = useState(false);
    const [selectedOutputIndex, setSelectedOutputIndex] = useState<number>(-1);

    const [datasetName, setDatasetName] = useState('');

    // Add rotating placeholder state
    const [placeholderIndex, setPlaceholderIndex] = useState(0);
    const placeholders = [
        "help me find data from a website",
        "help me extract data from this image",
        "help me parse data from this text\n\n\"Our quarterly sales report shows that John Smith achieved $45,000 in Q1, while Sarah Johnson reached $52,000. The top performer was Mike Chen with $67,000 in sales. Regional breakdown: NYC office contributed $180,000, LA office $165,000, and Chicago office $142,000. Customer satisfaction scores averaged 4.2/5 across all regions.\" only extract the part about people.",
        "help me generate a dataset about uk dynasty with their years of reign and their monarchs"
    ];

    const textAreaRef = useRef<HTMLDivElement | null>(null);

    // Rotate placeholders every 3 seconds
    useEffect(() => {
        const interval = setInterval(() => {
            setPlaceholderIndex((prevIndex) => (prevIndex + 1) % placeholders.length);
        }, 4000);

        return () => clearInterval(interval);
    }, []);

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
                    // Handle both single image (string) and multiple images (array)
                    const images = Array.isArray(msg.imageData) ? msg.imageData : [msg.imageData];
                    images.forEach(imageUrl => {
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
    const selectedCsvData = (() => {
        const outputMessages = dataCleanMessages.filter(msg => msg.type === 'output');
        if (selectedOutputIndex >= 0 && selectedOutputIndex < outputMessages.length) {
            return outputMessages[selectedOutputIndex].outputCsvData;
        }
        // Fallback to latest if no selection or invalid selection
        return outputMessages.length > 0 ? outputMessages[outputMessages.length - 1].outputCsvData : '';
    })();

    const viewTable = (() => {
        if (!selectedCsvData) return undefined;
        try {
            // Get the suggested name from the selected output message if available
            const outputMessages = dataCleanMessages.filter(msg => msg.type === 'output');
            const selectedMessage = selectedOutputIndex >= 0 && selectedOutputIndex < outputMessages.length 
                ? outputMessages[selectedOutputIndex] 
                : null;
            const suggestedName = selectedMessage?.suggestedName || datasetName || generateDefaultName(selectedCsvData.slice(0, 96));
            
            return createTableFromText(suggestedName, selectedCsvData);
        } catch {
            return undefined;
        }
    })();

    const canSend = (() => {
        // Allow sending if there's prompt text or image data
        const hasPrompt = prompt.trim().length > 0;
        const hasImageData = imageData.length > 0;
        return (hasPrompt || hasImageData) && !loading;
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
                            setImageData(prev => [...prev, ...newImages]);
                        }
                    };
                    reader.readAsDataURL(file);
                });
            }
        }
    };

    const removeImage = (index: number) => {
        setImageData(prev => prev.filter((_, i) => i !== index));
    };

    const resetAll = () => {
        setImageData([]);
        setPrompt('');
        setDatasetName('');
        setSelectedOutputIndex(-1);
        dispatch(dfActions.resetDataCleanMessages());
    };

    const sendRequest = () => {
        if (!canSend) return;
        setLoading(true);
        const token = String(Date.now());

        // Determine if this is a followup request
        const isFollowup = dialog.length > 0;

        // Construct payload - simplified to match backend API
        const payload: any = {
            token,
            model: activeModel,
        };

        if (isFollowup) {
            // This is a followup request
            payload.dialog = dialog;
            payload.prompt = prompt.trim();
        } else {
            // This is an initial request
            payload.prompt = prompt.trim();
            payload.artifacts = imageData;
        }

        // Store the input message data but don't add to Redux yet
        const userMsgText = prompt.trim() || (imageData.length > 0 ? '[extract data from image]' : '[clean/generate data]');
        const inputMessage: DataCleanMessage = {
            type: 'input',
            timestamp: Date.now(),
            prompt: userMsgText,
            imageData: imageData.length > 0 ? imageData : undefined
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
                    const csv: string = (cand.content || '').trim();
                    const info = cand.info || {};
                    const updatedDialog = cand.dialog || [];
                    
                    // Use suggested name from agent if available, otherwise generate default
                    const suggestedName = info.suggested_name || generateDefaultName(csv.slice(0, 96));
                    if (!datasetName) setDatasetName(suggestedName);

                    // Add output message to Redux state
                    const outputMessage: DataCleanMessage = {
                        type: 'output',
                        timestamp: Date.now(),
                        modelResponse: csv,
                        cleaningReason: info.reason,
                        suggestedName: info.suggested_name,
                        outputCsvData: csv,
                        dialogItem: updatedDialog.length > 0 ? updatedDialog[updatedDialog.length - 1] : undefined
                    };
                    dispatch(dfActions.addDataCleanMessage(outputMessage));
                    
                    // Clear input fields only after successful completion
                    setPrompt('');
                    setImageData([]);
                } else {
                    // Generation failed - don't add input message to history
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(),
                        type: 'error',
                        component: 'data loader',
                        value: 'Unable to process data. Please try again.',
                    }));
                    
                    // Clear input fields only after failed completion
                    setPrompt('');
                    setImageData([]);
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
                setImageData([]);
            });
    };

    const handleUpload = () => {
        if (!selectedCsvData) return;
        
        // Get the suggested name from the selected output message if available
        const outputMessages = dataCleanMessages.filter(msg => msg.type === 'output');
        const selectedMessage = selectedOutputIndex >= 0 && selectedOutputIndex < outputMessages.length 
            ? outputMessages[selectedOutputIndex] 
            : null;
        const suggestedName = selectedMessage?.suggestedName || datasetName || generateDefaultName(selectedCsvData.slice(0, 96));
        
        const base = suggestedName.trim();
        const unique = getUniqueTableName(base, existingNames);
        const table = createTableFromText(unique, selectedCsvData);
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
            setSelectedOutputIndex(outputMessages.length - 1);
        } else {
            // Reset selection when all messages are cleared
            setSelectedOutputIndex(-1);
        }
    }, [dataCleanMessages]);

    const getPlaceholderText = () => {
        return existOutputMessages 
            ? "follow-up instruction (e.g., fix headers, remove totals, generate 15 rows, etc.)"
            : placeholders[placeholderIndex];
    };

    let threadDisplay = <Box sx={{ 
        flex: 1,  display: 'flex', flexDirection: 'column', maxHeight: '400px', 
        overflowY: 'auto', overflowX: 'hidden'
    }} ref={textAreaRef}>
        {/* Conversation Thread */}
        {dataCleanMessages.map((msg, i) => {
            const outputMessages = dataCleanMessages.filter(m => m.type === 'output');
            const outputIndex = outputMessages.findIndex(m => m === msg);
            const isSelected = msg.type === 'output' && outputIndex === selectedOutputIndex;
            
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
                                    ml: 1, borderLeft: '1px solid', borderColor: 'divider',
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
                                        {/* Handle both single image (string) and multiple images (array) */}
                                        {(Array.isArray(msg.imageData) ? msg.imageData : [msg.imageData]).map((imageUrl, imgIndex) => (
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
                        <Box
                            onClick={() => setSelectedOutputIndex(outputIndex)}
                            sx={{
                                py: 0, pl: 0.5, pr: 1, gap: 1,
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
                            <TableIcon color="primary" sx={{ fontSize: 10 }} />
                            <Typography variant="body2" sx={{ 
                                fontSize: '10px', fontWeight: isSelected ? 600 : 400,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                maxWidth: '200px'
                            }}>
                                {msg.suggestedName} (v{outputIndex + 1})
                            </Typography>
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

    let inputBox = 
        <Stack sx={{ py: 1, position: 'relative' }} direction="row" spacing={1} alignItems="flex-end">
            {loading && <LinearProgress sx={{ width: '100%', height: '100%', position: 'absolute', opacity: 0.1, top: 0, left: 0, right: 0, zIndex: 1 }} />}    
            <Box sx={{ flex: 1, position: 'relative' }}>
            {imageData.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 0.5, mt: 0.5, position: 'relative' }}>
                    {imageData.map((imageUrl, index) => (
                        <Box key={index} sx={{ display: 'block' }}>
                            <Box 
                                component="img"
                                src={imageUrl}
                                alt={`Pasted image ${index + 1}`}
                                sx={{
                                    maxHeight: existOutputMessages ? 60 : 600,
                                    maxWidth: imageData.length > 1 ? '30%' : '100%',
                                    objectFit: 'cover',
                                    borderRadius: 1,
                                    border: '1px solid',
                                    borderColor: 'divider'
                                }}
                            />
                            <IconButton 
                                sx={{position: 'absolute'}}
                                size="small" 
                                onClick={() => removeImage(index)}
                            >
                                <CancelIcon fontSize="small" />
                            </IconButton>
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
                placeholder={getPlaceholderText()}
                variant="standard"
                multiline
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                fullWidth
                disabled={loading}
                autoComplete="off"
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendRequest();
                    }
                    if (e.key === 'Tab') {
                        e.preventDefault();
                        setPrompt(placeholders[placeholderIndex] + '\t');
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
                        '&:hover': { backgroundColor: 'background.paper', transform: 'rotate(180deg)', transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)' } }} onClick={resetAll} title="Reset dialog">
                        <RestartAltIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                {threadDisplay}
                {inputBox}
            </Box>

            {/* Right: Data preview panel */}
            {(existOutputMessages || imageData.length > 0) && (
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
                        {selectedOutputIndex >= 0 && (
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                {viewTable?.id} (v{selectedOutputIndex + 1})
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
                        {!selectedCsvData ? (
                            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4, fontSize: '11px' }}>
                                No data available
                            </Typography>
                        ) : (
                            <>
                                {viewTable ? (
                                    <Paper 
                                        variant="outlined" 
                                        sx={{ 
                                            flex: 1,
                                            overflow: 'hidden',
                                            borderRadius: 1,
                                            border: '1px solid',
                                            borderColor: 'divider',
                                            backgroundColor: 'background.paper'
                                        }}
                                    >
                                        <CustomReactTable
                                            rows={viewTable.rows}
                                            rowsPerPageNum={-1}
                                            compact={false}
                                            columnDefs={viewTable.names.map((name) => ({
                                                id: name,
                                                label: name,
                                                minWidth: 60,
                                                align: undefined,
                                                format: (v: any) => v,
                                            }))}
                                        />
                                    </Paper>
                                ) : (
                                    <Typography variant="body2" color="error" sx={{ fontSize: '11px' }}>
                                        Failed to parse the assistant output. Ensure it is a valid CSV/TSV.
                                    </Typography>
                                )}
                            </>
                        )}

                        {/* Bottom submit bar */}
                        <Box sx={{ mt: 'auto', pt: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}>
                            <Typography variant="caption" sx={{ fontSize: '10px', color: 'text.secondary' }}>
                                {viewTable?.rows.length} rows, {viewTable?.names.length} columns
                            </Typography> 
                            <Button
                                variant="contained"
                                sx={{ ml: 'auto' }}
                                onClick={handleUpload}
                                disabled={!viewTable}
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


