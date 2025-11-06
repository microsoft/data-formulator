// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { useDispatch, useSelector } from 'react-redux';
import { Alert, alpha, Box, Chip, Collapse, Divider, Paper, Tooltip, Typography } from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import AssignmentIcon from '@mui/icons-material/Assignment';
import DeleteIcon from '@mui/icons-material/Delete';

import SignalCellular1BarIcon from '@mui/icons-material/SignalCellular1Bar';
import SignalCellular2BarIcon from '@mui/icons-material/SignalCellular2Bar';
import SignalCellular3BarIcon from '@mui/icons-material/SignalCellular3Bar';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningIcon from '@mui/icons-material/Warning';
import InfoOutlineIcon from '@mui/icons-material/InfoOutline';
import { useTheme } from '@mui/material/styles';

export interface Message {
    type: "success" | "info" | "error" | "warning",
    component: string, // the component that generated the message
    timestamp: number,
    value: string,
    detail?: string, // error details
    code?: string // if this message is related to a code error, include code as well
}

export function MessageSnackbar() {
    const theme = useTheme();
  
    const messages = useSelector((state: DataFormulatorState) => state.messages);
    const displayedMessageIdx = useSelector((state: DataFormulatorState) => state.displayedMessageIdx);
    
    const dispatch = useDispatch();
    const tables = useSelector((state: DataFormulatorState) => state.tables);

    const [openLastMessage, setOpenLastMessage] = React.useState(false);
    const [latestMessage, setLatestMessage] = React.useState<Message | undefined>();

    const [openChallenge, setOpenChallenge] = React.useState(true);
    const [openMessages, setOpenMessages] = React.useState(false);
    const [expandedMessages, setExpandedMessages] = React.useState<string[]>([]);

    // Add ref for messages scroll, so that we always scroll to the bottom of the messages list
    const messagesScrollRef = React.useRef<HTMLDivElement>(null);

    // Original effect for auto-showing new messages
    React.useEffect(()=>{
        if (displayedMessageIdx < messages.length) {
            setOpenLastMessage(true);
            setLatestMessage(messages[displayedMessageIdx]);
            dispatch(dfActions.setDisplayedMessageIndex(displayedMessageIdx + 1));
        }
    }, [messages])

    // Simplified useEffect
    React.useEffect(() => {
        messagesScrollRef.current?.scrollTo({ 
            top: messagesScrollRef.current.scrollHeight,
            behavior: 'smooth' 
        });
    }, [messages, openMessages]);

    // Original handler for closing auto-popup messages
    const handleClose = (event: React.SyntheticEvent | Event, reason?: string) => {
        if (reason === 'clickaway') { return; }
        setOpenLastMessage(false);
        setLatestMessage(undefined);
    };

    // Helper function to format timestamp
    const formatTimestamp = (timestamp: number) => {
        const timestampMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
        return new Date(timestampMs).toLocaleString('en-US', { 
            hour: "2-digit", 
            minute: "2-digit", 
            hour12: false
            //second: "2-digit" 
        });
    };

    const action = (
        <React.Fragment>
            <IconButton
                size="small"
                aria-label="close"
                color="inherit"
                onClick={handleClose}
            >
                <CloseIcon fontSize="small" />
            </IconButton>
        </React.Fragment>
    );


    const groupedMessages = [];
                            
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const key = `${msg.value}|${msg.detail || ''}|${msg.code || ''}|${msg.type}`;
        
        // Check if this message is the same as the last group
        const lastGroup = groupedMessages[groupedMessages.length - 1];
        const lastKey = lastGroup ? `${lastGroup.value}|${lastGroup.detail || ''}|${lastGroup.code || ''}|${lastGroup.type}` : null;
        
        if (lastKey === key) {
            // Same as previous message, increment count and update timestamp if newer
            lastGroup.count++;
            if (msg.timestamp > lastGroup.timestamp) {
                lastGroup.timestamp = msg.timestamp;
            }
        } else {
            // Different message, create new group
            groupedMessages.push({
                ...msg,
                count: 1,
                originalIndex: i
            });
        }
    }

    return (
        <Box sx={{ '& .snackbar-button': {
            width: 36,
            height: 36,
            zIndex: 10,
            backgroundColor: 'white',
            '&:hover': {
                transform: 'scale(1.1)',
                backgroundColor: 'white',
            },
            border: '1px solid',
            
            boxShadow: '0 0 10px rgba(0,0,0,0.1)',
            transition: 'all 0.3s ease'
        }}}>
            <Tooltip placement="left" title="view system messages">
                <IconButton 
                    className='snackbar-button'
                    color="warning"
                    sx={{position: "absolute", bottom: 16, right: 16 }}
                    onClick={() => setOpenMessages(true)}
                >
                    <InfoIcon sx={{fontSize: 32}}/>
                </IconButton>
            </Tooltip>
            <Snackbar
                open={openMessages}
                anchorOrigin={{vertical: 'bottom', horizontal: 'right'}}
                sx={{maxWidth: '500px', maxHeight: '70vh'}}
            >
                <Paper elevation={3} sx={{
                    width: '100%',
                    color: 'text.primary',
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: '300px',
                    py: 1,
                }}>
                    {/* Header */}
                    <Box sx={{display: 'flex', alignItems: 'center', px: 1.5}}>
                        <Typography variant="subtitle1" sx={{fontSize: 12, flexGrow: 1, color: 'text.secondary'}}>
                            system messages ({messages.length})
                        </Typography>
                        <Tooltip title="clear all messages">
                            <IconButton
                                size="small"
                                color="warning"
                                aria-label="delete"
                                onClick={() => {
                                    dispatch(dfActions.clearMessages());
                                    dispatch(dfActions.setDisplayedMessageIndex(0));
                                    setOpenMessages(false);
                                }}
                            >
                                <DeleteIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <IconButton
                            size="small"
                            aria-label="close"
                            onClick={() => setOpenMessages(false)}
                        >
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    </Box>
                    <Box 
                        ref={messagesScrollRef}
                        sx={{
                            overflow: 'auto',
                            flexGrow: 1,
                            maxHeight: '50vh',
                            minHeight: '100px',
                        }}
                    >
                        {messages.length == 0 && 
                        <Typography fontSize={12} component="span" sx={{margin: "auto", m: 1, opacity: 0.7, fontStyle: 'italic'}}>There are no messages yet</Typography>}
                        {groupedMessages.map((msg, index) => (
                            <Alert icon={false} key={index} severity={msg.type} sx={{ 
                                mb: 0.5, py: 0, px: 1,
                                '& .MuiSvgIcon-root ': {
                                    height: '16px',
                                    width: '16px'
                                },
                                '& .MuiAlert-message': {
                                    py: 0.25
                                },
                                backgroundColor: 'rgba(255, 255, 255, 0.5)',
                            } }>
                                <Box key={`${msg.originalIndex}-${msg.count}`} sx={{ display: 'flex', alignItems: 'center'}}>
                                    {msg.type == "error" && <ErrorOutlineIcon sx={{fontSize: 16, mr: 0.5, color: 'error.main'}} />}
                                    {msg.type == "warning" && <WarningIcon sx={{fontSize: 16, mr: 0.5, color: 'warning.main'}} />}
                                    {msg.type == "info" && <InfoOutlineIcon sx={{fontSize: 16, mr: 0.5, color: 'info.main'}} />}
                                    {msg.type == "success" && <CheckCircleIcon sx={{fontSize: 16, mr: 0.5, color: 'success.main'}} />}
                                    <Typography fontSize={11} component="span" >
                                        [{formatTimestamp(msg.timestamp)}] ({msg.component}) - {msg.value}
                                    </Typography>
                                    {msg.count > 1 && (
                                        <Chip 
                                            variant="outlined"
                                            label={`x${msg.count}`}
                                            color={msg.type === "error" ? "error" : msg.type === "warning" ? "warning" : msg.type === "info" ? "info" : "success"}
                                            sx={{
                                                height: '16px',
                                                fontSize: 10,
                                                ml: 0.5,
                                                '& .MuiChip-label': {
                                                    px: 0.5,
                                                    py: 0.25
                                                }
                                            }}
                                        />
                                    )}
                                    {(msg.detail || msg.code) && (!expandedMessages.includes(msg.timestamp.toString()) ? (
                                        <IconButton sx={{p: 0}} onClick={() => setExpandedMessages([...expandedMessages, msg.timestamp.toString()])}>
                                            <ExpandMoreIcon sx={{fontSize: 16}} />
                                        </IconButton>
                                    ) : (
                                        <IconButton sx={{p: 0}} onClick={() => setExpandedMessages(expandedMessages.filter(t => t !== msg.timestamp.toString()))}>
                                            <ExpandLessIcon sx={{fontSize: 16}} />
                                        </IconButton>
                                    ))}
                                </Box>
                                {(msg.detail || msg.code) && <Collapse sx={{ml: 2}} in={expandedMessages.includes(msg.timestamp.toString())} >
                                    {msg.detail && (
                                        <>
                                            <Divider textAlign="left" sx={{fontSize: 12, opacity: 0.7}}>
                                                [details]
                                            </Divider>
                                            <Box sx={{ borderRadius: 1, position: 'relative' }}>
                                                <Typography fontSize={12}>{msg.detail}</Typography>
                                            </Box>
                                        </>
                                    )}
                                    {msg.code && (
                                        <>
                                            <Divider textAlign="left" sx={{my: 1, fontSize: 12, opacity: 0.7}}>
                                                [generated code]
                                            </Divider>
                                            <Typography fontSize={10} component="span" sx={{opacity: 0.7}}>
                                                <pre style={{ 
                                                    whiteSpace: 'pre-wrap', 
                                                    wordBreak: 'break-word', 
                                                    marginTop: 1,
                                                    fontSize: '10px'
                                                }}>
                                                    {msg.code.split('\n').filter(line => line.trim() !== '').join('\n')}
                                                </pre>
                                            </Typography>
                                        </>
                                    )}
                                </Collapse>}
                            </Alert>
                        ))}
                    </Box>
                </Paper>
            </Snackbar>
            
            {/* Last message snackbar */}
            {latestMessage != undefined ? <Snackbar
                open={openLastMessage}
                autoHideDuration={latestMessage?.type == "error" ? 20000 : 10000}
                anchorOrigin={{vertical: 'bottom', horizontal: 'right'}}
                onClose={handleClose}
                action={action}
            >
                <Alert onClose={handleClose} severity={latestMessage?.type} sx={{ maxWidth: '400px', maxHeight: '600px', overflow: 'auto' }}>
                    <Typography fontSize={12} component="span" sx={{margin: "auto"}}>
                        <b>[{formatTimestamp(latestMessage.timestamp)}] ({latestMessage.component})</b> {latestMessage?.value}
                    </Typography> 
                    {latestMessage?.detail ? 
                        <Divider textAlign="left" sx={{my: 1, fontSize: 12, opacity: 0.7}} > [details] </Divider>
                    : ""}
                    {latestMessage?.detail ? 
                        <Box sx={{ borderRadius: 1, position: 'relative' }} >
                            <Typography fontSize={12} > {latestMessage?.detail} </Typography>
                        </Box>
                    : ""}
                    {latestMessage?.code ? 
                        <Divider textAlign="left" sx={{my: 1, fontSize: 12, opacity: 0.7}} > [generated code] </Divider>
                    : ""}
                    {latestMessage?.code ? 
                        <Typography fontSize={10} component="span" sx={{margin: "auto", opacity: 0.7}}>
                            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 1 }}>
                                {latestMessage?.code?.split('\n').filter(line => line.trim() !== '').join('\n')}
                            </pre>
                        </Typography>
                    : ""}
                </Alert>    
            </Snackbar> : ""}
        </Box>
    );
}