// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import Snackbar from '@mui/material/Snackbar';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { useDispatch, useSelector } from 'react-redux';
import { Alert, Box, Paper, Tooltip, Typography } from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningIcon from '@mui/icons-material/Warning';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';

export interface Message {
    type: "success" | "info" | "error" | "warning",
    component: string, // the component that generated the message
    timestamp: number,
    value: string,
    detail?: string, // error details
    code?: string, // if this message is related to a code error, include code as well
    diagnostics?: any, // full diagnostic payload from the backend agent pipeline
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

const DiagnosticsViewer: React.FC<{ diagnostics: any }> = React.memo(({ diagnostics }) => {
    const [expanded, setExpanded] = React.useState(false);
    const [copied, setCopied] = React.useState(false);
    const jsonStr = React.useMemo(() => JSON.stringify(diagnostics, null, 2), [diagnostics]);

    const handleCopy = React.useCallback(() => {
        navigator.clipboard.writeText(jsonStr).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }, [jsonStr]);

    return (
        <div style={{ marginTop: 4 }}>
            <Typography fontSize={10} sx={{ color: '#888', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <span
                    style={{ color: '#6a1b9a', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setExpanded(prev => !prev)}
                >
                    {expanded ? '▾' : '▸'} diagnostics
                </span>
                {expanded && (
                    <Tooltip title={copied ? 'Copied!' : 'Copy JSON'} placement="top">
                        <IconButton size="small" onClick={handleCopy} sx={{ p: 0, ml: 0.5 }}>
                            <ContentCopyIcon sx={{ fontSize: 12, color: copied ? '#2e7d32' : '#888' }} />
                        </IconButton>
                    </Tooltip>
                )}
            </Typography>
            {expanded && (
                <pre style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: 9,
                    margin: '2px 0',
                    padding: '6px 8px',
                    backgroundColor: '#f5f0ff',
                    border: '1px solid #e0d4f5',
                    borderRadius: 3,
                    maxHeight: 400,
                    overflow: 'auto',
                    lineHeight: 1.4,
                }}>
                    {jsonStr}
                </pre>
            )}
        </div>
    );
});

export const MessageSnackbar = React.memo(function MessageSnackbar() {
  
    const messages = useSelector((state: DataFormulatorState) => state.messages);
    const displayedMessageIdx = useSelector((state: DataFormulatorState) => state.displayedMessageIdx);
    
    const dispatch = useDispatch();
    const { t } = useTranslation();

    const [openLastMessage, setOpenLastMessage] = React.useState(false);
    const [latestMessage, setLatestMessage] = React.useState<Message | undefined>();

    const [openMessages, setOpenMessages] = React.useState(false);
    const [expandedMessages, setExpandedMessages] = React.useState<Set<number>>(new Set());

    const messagesScrollRef = React.useRef<HTMLDivElement>(null);

    const buttonSeverity: "error" | "warning" | "info" | "success" | "default" = React.useMemo(() => {
        if (messages.length === 0) return "default";
        if (messages.some(m => m.type === "error")) return "error";
        if (messages.some(m => m.type === "warning")) return "warning";
        if (messages.some(m => m.type === "info")) return "info";
        return "success";
    }, [messages]);

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
        <Box>
            <Tooltip placement="left" title={t('messages.viewSystemMessages')}>
                <IconButton 
                    color={buttonSeverity === "default" ? "default" : buttonSeverity}
                    sx={{
                        position: "absolute", bottom: 16, right: 16,
                        width: 30,
                        height: 30,
                        zIndex: 10,
                        backgroundColor: 'white',
                        border: '1px solid',
                        borderColor: buttonSeverity === "default" ? 'grey.400' : `${buttonSeverity}.main`,
                        boxShadow: '0 0 6px rgba(0,0,0,0.1)',
                        opacity: buttonSeverity === "default" ? 0.6 : 1,
                        transition: 'all 0.3s ease',
                        '&:hover': {
                            transform: 'scale(1.1)',
                            backgroundColor: 'white',
                        },
                    }}
                    onClick={() => setOpenMessages(true)}
                >
                    {buttonSeverity === "error" ? <ErrorOutlineIcon sx={{fontSize: 20}}/> :
                     buttonSeverity === "warning" ? <WarningIcon sx={{fontSize: 20}}/> :
                     buttonSeverity === "success" ? <CheckCircleIcon sx={{fontSize: 20}}/> :
                     <InfoIcon sx={{fontSize: 20}}/>}
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
                            {t('messages.systemMessagesWithCount', { count: messages.length })}{messages.length > MAX_DISPLAY_MESSAGES ? ` — showing latest ${MAX_DISPLAY_MESSAGES}` : ''}
                        </Typography>
                        <Tooltip title={t('messages.clearAllMessages')}>
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
                            <Typography fontSize={10} sx={{ opacity: 0.5, fontStyle: 'italic' }}>{t('messages.noMessages')}</Typography>
                        )}
                        {groupedMessages.map((msg, index) => {
                            const color = TYPE_COLORS[msg.type] || '#333';
                            const symbol = TYPE_SYMBOLS[msg.type] || '•';
                            const hasDetails = !!(msg.detail || msg.code || msg.diagnostics);
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
                                                {isExpanded ? `▾ ${t('messages.details')}` : `▸ ${t('messages.details')}`}
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
                                            {msg.diagnostics && (
                                                <DiagnosticsViewer diagnostics={msg.diagnostics} />
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