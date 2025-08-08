// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import validator from 'validator';

import { Box, Button, Card, CardContent, Divider, IconButton, Paper, Stack, TextField, Typography, alpha, useTheme } from '@mui/material';
import UploadIcon from '@mui/icons-material/Upload';
import SendIcon from '@mui/icons-material/Send';
import ImageIcon from '@mui/icons-material/Image';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CancelIcon from '@mui/icons-material/Cancel';
import PanoramaFishEyeIcon from '@mui/icons-material/PanoramaFishEye';

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
  const existingNames = useMemo(() => new Set(existingTables.map(t => t.id)), [existingTables]);

  const [rawText, setRawText] = useState('');
  const [imageData, setImageData] = useState<string>('');
  const [imageInstr, setImageInstr] = useState('');
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedOutputIndex, setSelectedOutputIndex] = useState<number>(-1);

  const [datasetName, setDatasetName] = useState('');

  const textAreaRef = useRef<HTMLDivElement | null>(null);

  const contentType: 'text' | 'image' = imageData ? 'image' : 'text';

  // Reconstruct dialog from Redux state for API compatibility
  const dialog = useMemo((): DialogMessage[] => {
    const reconstructedDialog: DialogMessage[] = [];
    
    for (const msg of dataCleanMessages) {
      if (msg.type === 'input') {
        const content: DialogContentItem[] = [];
        if (msg.prompt) {
          content.push({ type: 'text', text: msg.prompt });
        }
        if (msg.imageData) {
          content.push({ 
            type: 'image_url', 
            image_url: { url: msg.imageData } 
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
  }, [dataCleanMessages]);

  const aggregatedUserInstructions = useMemo(() => {
    const previousUserTexts = dialog
      .filter(m => m.role === 'user')
      .map(m => {
        if (typeof m.content === 'string') {
          return m.content;
        } else if (Array.isArray(m.content)) {
          return m.content.filter((c): c is Extract<DialogContentItem, { type: 'text' }> => c.type === 'text').map(c => c.text).join('\n');
        }
        return '';
      })
      .join('\n');
    
    const currentParts: string[] = [];
    if (instruction && instruction.trim().length > 0) currentParts.push(instruction.trim());
    if (contentType === 'image' && imageInstr && imageInstr.trim().length > 0) currentParts.push(imageInstr.trim());
    return [previousUserTexts, ...currentParts].filter(Boolean).join('\n').trim();
  }, [dialog, instruction, imageInstr, contentType]);

  // Get the selected CSV data from Redux state
  const selectedCsvData = useMemo(() => {
    const outputMessages = dataCleanMessages.filter(msg => msg.type === 'output');
    if (selectedOutputIndex >= 0 && selectedOutputIndex < outputMessages.length) {
      return outputMessages[selectedOutputIndex].outputCsvData;
    }
    // Fallback to latest if no selection or invalid selection
    return outputMessages.length > 0 ? outputMessages[outputMessages.length - 1].outputCsvData : '';
  }, [dataCleanMessages, selectedOutputIndex]);

  const viewTable = useMemo(() => {
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
  }, [selectedCsvData, datasetName, dataCleanMessages, selectedOutputIndex]);

  const canSend = useMemo(() => {
    // Allow sending if there's instruction text, even without raw data or image
    const hasInstruction = instruction.trim().length > 0;
    const hasData = rawText.trim().length > 0 || validator.isURL(imageData) || validator.isDataURI(imageData);
    return (hasInstruction || hasData) && !loading;
  }, [rawText, imageData, loading, instruction]);

  const handlePasteImage = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
      const file = e.clipboardData.files[0];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result as string;
          if (res) setImageData(res);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const resetAll = () => {
    setRawText('');
    setImageData('');
    setImageInstr('');
    setInstruction('');
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

    // Construct payload
    const payload: any = {
      token,
      model: activeModel,
    };

    if (isFollowup) {
      // This is a followup request
      payload.dialog = dialog;
      payload.new_instruction = instruction.trim();
    } else {
      // This is an initial request
      payload.content_type = contentType;
      payload.raw_data = contentType === 'image' ? imageData : rawText + (aggregatedUserInstructions ? `\n\n[INSTRUCTION]\n${aggregatedUserInstructions}` : '');
      payload.image_cleaning_instruction = contentType === 'image' ? aggregatedUserInstructions : '';
    }

    // Add input message to Redux state
    const userMsgText = instruction.trim() || (contentType === 'image' && imageInstr.trim()) || (contentType === 'image' ? '[extract data from image]' : '[clean/generate data]');
    const inputMessage: DataCleanMessage = {
      type: 'input',
      timestamp: Date.now(),
      prompt: userMsgText,
      imageData: contentType === 'image' ? imageData : undefined
    };
    dispatch(dfActions.addDataCleanMessage(inputMessage));
    setInstruction('');

    fetch(getUrls().CLEAN_DATA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.json())
      .then(data => {
        setLoading(false);
        if (data && data.status === 'ok' && data.result && data.result.length > 0) {
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
        } else {
          dispatch(dfActions.addMessages({
            timestamp: Date.now(),
            type: 'error',
            component: 'data loader',
            value: 'Unable to process data. Please try again.',
          }));
        }
      })
      .catch(() => {
        setLoading(false);
        dispatch(dfActions.addMessages({
          timestamp: Date.now(),
          type: 'error',
          component: 'data loader',
          value: 'Server error while processing data.',
        }));
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


  return (
    <Card
      variant="outlined"
      sx={{
        width: dataCleanMessages.length > 0 ? '960px' : '640px',
        display: 'flex',
        flexDirection: 'row',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          borderColor: 'primary.main',
        }
      }}
    >
      <CardContent
        sx={{
          display: 'flex',
          flexDirection: 'row',
          flexGrow: 1,
          padding: 0,
          gap: 2,
          '&:last-child': { paddingBottom: 0 }
        }}
      >
        {/* Left: Chat panel */}
        <Box
          sx={{
            flex: 1,
            minWidth: 320,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid',
            borderColor: 'divider',
            padding: 1.5
          }}
        >
        {dataCleanMessages.length > 0 && 
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
                ASK AI
                <IconButton size="small" sx={{ ml: 'auto' }} onClick={resetAll} title="Reset dialog">
                <RestartAltIcon fontSize="small" />
                </IconButton>
            </Typography>
          }
          {/* Thread Display */}
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              maxHeight: '400px',
              overflowY: 'auto',
            }}
            ref={textAreaRef}
          >
            {/* Conversation Thread */}
            {dataCleanMessages.map((msg, i) => {
              const outputMessages = dataCleanMessages.filter(m => m.type === 'output');
              const outputIndex = outputMessages.findIndex(m => m === msg);
              const isSelected = msg.type === 'output' && outputIndex === selectedOutputIndex;
              
              return (
                <Box key={i} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
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
                          ml: 1,
                          borderLeft: '1px solid',
                          borderColor: 'divider',
                          backgroundColor: 'background.paper',
                          flex: 1,
                          p: 1.5,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 1
                        }}
                      >
                        {/* Text prompt */}
                        {msg.prompt && (
                          <Typography variant="body2" sx={{ 
                            fontSize: '12px', 
                            fontWeight: 500,
                            color: 'text.secondary',
                            fontStyle: 'italic',
                            textAlign: 'left'
                          }}>
                            {msg.prompt}
                          </Typography>
                        )}
                        
                        {/* Image if present */}
                        {msg.imageData && (
                          <Box sx={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            py: 0.5,
                          }}>
                            <Box
                              component="img"
                              src={msg.imageData}
                              alt="User uploaded image"
                              sx={{
                                width: 'auto',
                                height: 70,
                                objectFit: 'cover',
                                borderRadius: 0.5,
                                border: '1px solid',
                                borderColor: 'divider'
                              }}
                            />
                          </Box>
                        )}
                      </Box>
                    </Box>
                  )}
                  
                  {/* Output Card (only for output messages) */}
                  {msg.type === 'output' && (
                    <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 1 }}>
                      {/* Output Card */}
                      <Card
                        variant="outlined"
                        onClick={() => setSelectedOutputIndex(outputIndex)}
                        sx={{
                          p: 1,
                          borderRadius: 1,
                          border: '1px solid',
                          borderColor: isSelected ? 'primary.main' : 'divider',
                          backgroundColor: isSelected ? alpha(theme.palette.primary.main, 0.05) : 'background.paper',
                          flex: 1,
                          cursor: 'pointer',
                          transition: 'all 0.2s ease-in-out',
                          position: 'relative',
                          '&:hover': {
                            borderColor: isSelected ? 'primary.main' : 'primary.light',
                            backgroundColor: isSelected ? alpha(theme.palette.primary.main, 0.08) : alpha(theme.palette.primary.main, 0.03),
                          }
                        }}
                      >
                        <Typography variant="body2" sx={{ fontSize: '11px', whiteSpace: 'pre-wrap' }}>
                            {msg.suggestedName && (
                            <Typography component="span" variant="caption" sx={{ 
                                fontSize: '10px', 
                                color: 'text.secondary',
                                mr: 1
                            }}>
                                {msg.suggestedName} (v{outputIndex + 1})
                            </Typography>
                            )}{msg.cleaningReason || 'Data prepared.'}
                        </Typography>
                        
                      </Card>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>

        {/* Show input field always, not just when there are messages */}
        <Stack sx={{ py: 1 }} direction="row" spacing={1} alignItems="flex-end">
          <Box sx={{ flex: 1 }}>
          {imageData && (
              <Box sx={{ display: 'flex', width: 'fit-content', alignItems: 'center', mt: 0.5, gap: 1, position: 'relative' }}>
                <Box 
                  component="img"
                  src={imageData}
                  alt="Pasted image"
                  sx={{
                    width: 'auto',
                    height: 60,
                    objectFit: 'cover',
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider'
                  }}
                />
                <IconButton 
                    sx={{position: 'absolute', right: 0, top: 0}}
                  size="small" 
                  onClick={() => setImageData('')}
                >
                  <CancelIcon fontSize="small" />
                </IconButton>
              </Box>
            )}
            <TextField
              sx={{
                '& .MuiInputBase-root': {
                  p: 1
                }
              }}
              placeholder={dataCleanMessages.length > 0 
                ? "Write a follow-up instruction (e.g., fix headers, remove totals, generate 15 rows, etc.)"
                : "Describe the data you want to generate or paste data/image to clean (e.g., generate 20 rows of sales data, create a table of weather data, etc.)"
              }
              variant="standard"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              fullWidth
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendRequest();
                }
              }}
              onPaste={handlePasteImage}
            />
            
          </Box>
          <IconButton size="small" disabled={!canSend} onClick={sendRequest}>
            <SendIcon />
          </IconButton>
        </Stack>
        </Box>

        {/* Right: Data preview panel */}
        {(dataCleanMessages.length > 0 || imageData || rawText) && (
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
              <UploadIcon fontSize="small" />
              Data Preview
              {selectedOutputIndex >= 0 && (
                <Typography variant="caption" sx={{ ml: 'auto', color: 'text.secondary' }}>
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
                <>
                  {/* Show source content for reference - but not user input images */}
                  {rawText && (
                    <Paper 
                      variant="outlined" 
                      sx={{ 
                        p: 2, 
                        maxHeight: 300, 
                        overflow: 'auto',
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        backgroundColor: 'background.paper'
                      }}
                    >
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '11px' }}>
                        {rawText}
                      </Typography>
                    </Paper>
                  )}

                  {!rawText && !imageData && (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4, fontSize: '11px' }}>
                      No data source provided yet
                    </Typography>
                  )}
                </>
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
                 <Typography variant="caption" sx={{ }}>
                    {viewTable?.id}
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
      </CardContent>
    </Card>
  );
};

export default DataLoadingChat;


