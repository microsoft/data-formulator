// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import Snackbar from '@mui/material/Snackbar';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { useDispatch, useSelector } from 'react-redux';
import { Alert, Box, Paper, Tooltip, Typography } from '@mui/material';
import { shadow, transition } from '../app/tokens';
import InfoIcon from '@mui/icons-material/Info';
import DeleteIcon from '@mui/icons-material/Delete';

export interface Message {
    type: "success" | "info" | "error" | "warning",
    component: string, // the component that generated the message
    timestamp: number,
    value: string,
    detail?: string, // error details
    code?: string // if this message is related to a code error, include code as well
}

const TYPE_SYMBOLS: Record<string, string> = {
    error: '✗',
    warning: '⚠',
    info: 'ℹ',
    success: '✓',
};

const TYPE_COLORS: Record<string, string> = {
    error: '#d32f2f',
    warning: '#ed6c02',
    info: '#0288d1',
    success: '#2e7d32',
};

// Helper function to format timestamp
const formatTimestamp = (timestamp: number) => {
    const timestampMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    return new Date(timestampMs).toLocaleString('en-US', { 
        hour: "2-digit", 
        minute: "2-digit", 
        hour12: false
    });
};

export const MessageSnackbar = React.memo(function MessageSnackbar() {
  
    const messages = useSelector((state: DataFormulatorState) => state.messages);
    const displayedMessageIdx = useSelector((state: DataFormulatorState) => state.displayedMessageIdx);
    
    const dispatch = useDispatch();

    const [openLastMessage, setOpenLastMessage] = React.useState(false);
    const [latestMessage, setLatestMessage] = React.useState<Message | undefined>();

    const [openMessages, setOpenMessages] = React.useState(false);
    const [expandedMessages, setExpandedMessages] = React.useState<Set<number>>(new Set());

    const messagesScrollRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(()=>{
        if (displayedMessageIdx < messages.length) {
            setOpenLastMessage(true);
            setLatestMessage(messages[displayedMessageIdx]);
            dispatch(dfActions.setDisplayedMessageIndex(displayedMessageIdx + 1));
        }
    }, [messages])

    React.useEffect(() => {
        messagesScrollRef.current?.scrollTo({ 
            top: messagesScrollRef.current.scrollHeight,
            behavior: 'smooth' 
        });
    }, [messages, openMessages]);

    const handleClose = (event: React.SyntheticEvent | Event, reason?: string) => {
        if (reason === 'clickaway') { return; }
        setOpenLastMessage(false);
        setLatestMessage(undefined);
    };

    // Only compute grouped messages when panel is open — show latest 30 messages only
    const MAX_DISPLAY_MESSAGES = 30;
    const groupedMessages = React.useMemo(() => {
        if (!openMessages) return [];
        const groups: Array<Message & { count: number; originalIndex: number }> = [];
        
        // Only process the latest 30 messages
        const startIdx = Math.max(0, messages.length - MAX_DISPLAY_MESSAGES);
        for (let i = startIdx; i < messages.length; i++) {
            const msg = messages[i];
            const key = `${msg.value}|${msg.detail || ''}|${msg.code || ''}|${msg.type}`;
            
            const lastGroup = groups[groups.length - 1];
            const lastKey = lastGroup ? `${lastGroup.value}|${lastGroup.detail || ''}|${lastGroup.code || ''}|${lastGroup.type}` : null;
            
            if (lastKey === key) {
                lastGroup.count++;
                if (msg.timestamp > lastGroup.timestamp) {
                    lastGroup.timestamp = msg.timestamp;
                }
            } else {
                groups.push({ ...msg, count: 1, originalIndex: i });
            }
        }
        return groups;
    }, [messages, openMessages]);

    const toggleExpand = React.useCallback((index: number) => {
        setExpandedMessages(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    }, []);

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
            boxShadow: shadow.xl,
            transition: transition.slow
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
                            system messages ({messages.length}){messages.length > MAX_DISPLAY_MESSAGES ? ` — showing latest ${MAX_DISPLAY_MESSAGES}` : ''}
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
                    {/* Message list — plain text, no MUI Alert per row */}
                    <div 
                        ref={messagesScrollRef}
                        style={{
                            overflow: 'auto',
                            flexGrow: 1,
                            maxHeight: '50vh',
                            minHeight: 100,
                            padding: '4px 12px',
                        }}
                    >
                        {messages.length === 0 && (
                            <Typography fontSize={10} sx={{ opacity: 0.5, fontStyle: 'italic' }}>No messages yet</Typography>
                        )}
                        {groupedMessages.map((msg, index) => {
                            const color = TYPE_COLORS[msg.type] || '#333';
                            const symbol = TYPE_SYMBOLS[msg.type] || '•';
                            const hasDetails = !!(msg.detail || msg.code);
                            const isExpanded = expandedMessages.has(index);
                            return (
                                <div key={index} style={{ borderBottom: '1px solid #f0f0f0', padding: '2px 0' }}>
                                    <Typography fontSize={10} component="div" sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                                        <span style={{ color, fontWeight: 600 }}>{symbol}</span>
                                        <span style={{ color: '#888' }}>[{formatTimestamp(msg.timestamp)}]</span>
                                        <span>(<span style={{ color: '#888' }}>{msg.component}</span>) {msg.value}</span>
                                        {msg.count > 1 && (
                                            <span style={{ 
                                                color, fontWeight: 600,
                                                border: `1px solid ${color}`, borderRadius: 3,
                                                padding: '0 3px', marginLeft: 2
                                            }}>×{msg.count}</span>
                                        )}
                                        {hasDetails && (
                                            <span 
                                                style={{ color: '#0288d1', cursor: 'pointer', userSelect: 'none' }}
                                                onClick={() => toggleExpand(index)}
                                            >
                                                {isExpanded ? '▾ collapse' : '▸ details'}
                                            </span>
                                        )}
                                    </Typography>
                                    {hasDetails && isExpanded && (
                                        <div style={{ marginLeft: 20, padding: '4px 0', color: '#555' }}>
                                            {msg.detail && (
                                                <div style={{ marginBottom: 4 }}>
                                                    <Typography fontSize={10} sx={{ color: '#888' }}>— details —</Typography>
                                                    <Typography fontSize={10}>{msg.detail}</Typography>
                                                </div>
                                            )}
                                            {msg.code && (
                                                <div>
                                                    <Typography fontSize={10} sx={{ color: '#888' }}>— code —</Typography>
                                                    <pre style={{ 
                                                        whiteSpace: 'pre-wrap', 
                                                        wordBreak: 'break-word',
                                                        fontSize: 10,
                                                        margin: '2px 0',
                                                        padding: '4px 8px',
                                                        backgroundColor: '#f8f8f8',
                                                        borderRadius: 3,
                                                    }}>
                                                        {msg.code.split('\n').filter(line => line.trim() !== '').join('\n')}
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </Paper>
            </Snackbar>
            
            {/* Last message toast — keep the single Alert for latest message popup */}
            {latestMessage != undefined ? <Snackbar
                open={openLastMessage}
                autoHideDuration={latestMessage?.type == "error" ? 20000 : 10000}
                anchorOrigin={{vertical: 'bottom', horizontal: 'right'}}
                onClose={handleClose}
            >
                <Alert onClose={handleClose} severity={latestMessage?.type} sx={{ maxWidth: '400px', maxHeight: '600px', overflow: 'auto' }}>
                    <Typography fontSize={12} component="span" sx={{margin: "auto"}}>
                        <b>[{formatTimestamp(latestMessage.timestamp)}] ({latestMessage.component})</b> {latestMessage?.value}
                    </Typography> 
                    {latestMessage?.detail && <>
                        <div style={{ borderTop: '1px solid #ddd', margin: '4px 0', fontSize: 12 }}>{latestMessage.detail}</div>
                    </>}
                    {latestMessage?.code && 
                        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 10, opacity: 0.7, margin: '4px 0' }}>
                            {latestMessage.code.split('\n').filter(line => line.trim() !== '').join('\n')}
                        </pre>
                    }
                </Alert>    
            </Snackbar> : ""}
        </Box>
    );
});