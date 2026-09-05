// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import Snackbar from '@mui/material/Snackbar';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { useDispatch, useSelector } from 'react-redux';
import { Alert, Box, Button, Paper, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTranslation } from 'react-i18next';
import { iconVar, textVar } from '../app/layout';
import { borderColor, radius, shadow } from '../app/tokens';

export interface Message {
    type: "success" | "info" | "error" | "warning",
    component: string, // the component that generated the message
    timestamp: number,
    value: string,
    detail?: string, // error details
    code?: string, // if this message is related to a code error, include code as well
    diagnostics?: any, // full diagnostic payload from the backend agent pipeline
}

const SeverityIcon: React.FC<{ type: Message['type'] }> = ({ type }) => {
    if (type === 'error') return <ErrorOutlineIcon fontSize="inherit" />;
    if (type === 'warning') return <WarningAmberOutlinedIcon fontSize="inherit" />;
    if (type === 'success') return <CheckCircleOutlineIcon fontSize="inherit" />;
    return <InfoOutlinedIcon fontSize="inherit" />;
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
    const theme = useTheme();
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
        <Box sx={{ mt: 0.75 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                <Button
                    size="small"
                    color="inherit"
                    startIcon={expanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
                    onClick={() => setExpanded(prev => !prev)}
                    sx={{
                        minWidth: 0, p: 0, textTransform: 'none',
                        fontSize: textVar.xs, color: 'text.secondary',
                        '& .MuiButton-startIcon': { mr: 0.25 },
                    }}
                >
                    Diagnostics
                </Button>
                {expanded && (
                    <Tooltip title={copied ? 'Copied!' : 'Copy JSON'} placement="top">
                        <IconButton size="small" onClick={handleCopy} sx={{ p: 0.375 }}>
                            <ContentCopyIcon sx={{ fontSize: iconVar.xs, color: copied ? 'success.main' : 'text.secondary' }} />
                        </IconButton>
                    </Tooltip>
                )}
            </Box>
            {expanded && (
                <Box component="pre" sx={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: textVar.xxs,
                    m: '4px 0 0',
                    p: 1,
                    color: 'text.primary',
                    backgroundColor: alpha(theme.palette.text.primary, 0.04),
                    border: `1px solid ${borderColor.component}`,
                    borderRadius: radius.sm,
                    maxHeight: 400,
                    overflow: 'auto',
                    lineHeight: 1.4,
                }}>
                    {jsonStr}
                </Box>
            )}
        </Box>
    );
});

export const MessageSnackbar = React.memo(function MessageSnackbar() {
  
    const messages = useSelector((state: DataFormulatorState) => state.messages);
    const displayedMessageIdx = useSelector((state: DataFormulatorState) => state.displayedMessageIdx);
    
    const dispatch = useDispatch();
    const { t } = useTranslation();
    const theme = useTheme();

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
                    color={buttonSeverity === 'default' ? 'default' : buttonSeverity}
                    sx={{
                        position: 'fixed', bottom: 16, right: 16,
                        width: 30,
                        height: 30,
                        zIndex: 10,
                        backgroundColor: 'white',
                        border: '1px solid',
                        borderColor: buttonSeverity === 'default' ? 'grey.400' : `${buttonSeverity}.main`,
                        boxShadow: '0 0 6px rgba(0,0,0,0.1)',
                        opacity: buttonSeverity === 'default' ? 0.6 : 1,
                        transition: 'all 0.3s ease',
                        '&:hover': {
                            transform: 'scale(1.1)',
                            backgroundColor: 'white',
                        },
                    }}
                    aria-label={t('messages.viewSystemMessages')}
                    onClick={() => {
                        setOpenLastMessage(false);
                        setOpenMessages(open => !open);
                    }}
                >
                    {buttonSeverity === 'error' ? <ErrorOutlineIcon sx={{ fontSize: 20 }} /> :
                     buttonSeverity === 'warning' ? <ErrorOutlineIcon sx={{ fontSize: 20 }} /> :
                     buttonSeverity === 'success' ? <CheckCircleIcon sx={{ fontSize: 20 }} /> :
                     <InfoIcon sx={{ fontSize: 20 }} />}
                </IconButton>
            </Tooltip>
            <Snackbar
                open={openMessages}
                anchorOrigin={{vertical: 'bottom', horizontal: 'right'}}
                sx={{
                    width: { xs: 'calc(100% - 32px)', sm: 420 },
                    maxWidth: 420,
                    maxHeight: 'min(70vh, 620px)',
                    left: { xs: 16, sm: 'auto' },
                    right: { xs: 16, sm: 16 },
                    bottom: '54px !important',
                }}
            >
                <Paper elevation={0} sx={{
                    width: '100%',
                    color: 'text.primary',
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                    maxHeight: 'min(70vh, 620px)',
                    overflow: 'hidden',
                    border: `1px solid ${borderColor.view}`,
                    borderRadius: radius.md,
                    boxShadow: shadow.xl,
                }}>
                    {/* Header */}
                    <Box sx={{
                        display: 'flex', alignItems: 'center', gap: 0.5,
                        minHeight: 42, px: 1.25,
                        borderBottom: `1px solid ${borderColor.divider}`,
                    }}>
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                            <Typography sx={{ fontSize: textVar.sm, fontWeight: 500, color: 'text.secondary', lineHeight: 1.3 }}>
                                {t('messages.systemMessagesWithCount', { count: messages.length })}
                            </Typography>
                            {messages.length > MAX_DISPLAY_MESSAGES && (
                                <Typography sx={{ fontSize: textVar.xxs, color: 'text.disabled', lineHeight: 1.3 }}>
                                    {t('messages.showingLatest', {
                                        count: MAX_DISPLAY_MESSAGES,
                                        defaultValue: 'Showing the latest {{count}}',
                                    })}
                                </Typography>
                            )}
                        </Box>
                        <Tooltip title={t('messages.clearAllMessages')}>
                            <IconButton
                                size="small"
                                aria-label={t('messages.clearAllMessages')}
                                disabled={messages.length === 0}
                                onClick={() => {
                                    dispatch(dfActions.clearMessages());
                                    dispatch(dfActions.setDisplayedMessageIndex(0));
                                    setOpenMessages(false);
                                }}
                                sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                            >
                                <DeleteOutlineIcon sx={{ fontSize: iconVar.md }} />
                            </IconButton>
                        </Tooltip>
                        <IconButton
                            size="small"
                            aria-label={t('common.close', { defaultValue: 'Close' })}
                            onClick={() => setOpenMessages(false)}
                            sx={{ color: 'text.secondary' }}
                        >
                            <CloseIcon sx={{ fontSize: iconVar.md }} />
                        </IconButton>
                    </Box>
                    <Box
                        ref={messagesScrollRef}
                        sx={{
                            overflow: 'auto',
                            flexGrow: 1,
                            minHeight: 120,
                        }}
                    >
                        {messages.length === 0 && (
                            <Box sx={{
                                minHeight: 160, px: 3, py: 4,
                                display: 'flex', flexDirection: 'column',
                                alignItems: 'center', justifyContent: 'center', gap: 1,
                                color: 'text.disabled', textAlign: 'center',
                            }}>
                                <InfoOutlinedIcon sx={{ fontSize: iconVar.lg }} />
                                <Typography sx={{ fontSize: textVar.xs }}>
                                    {t('messages.noMessages')}
                                </Typography>
                            </Box>
                        )}
                        {groupedMessages.map((msg, index) => {
                            const color = theme.palette[msg.type].main;
                            const hasDetails = !!(msg.detail || msg.code || msg.diagnostics);
                            const isExpanded = expandedMessages.has(index);
                            return (
                                <Box
                                    key={index}
                                    sx={{
                                        display: 'flex', alignItems: 'flex-start', gap: 0.75,
                                        px: 1.25, py: 0.875,
                                        borderBottom: index < groupedMessages.length - 1
                                            ? `1px solid ${borderColor.divider}`
                                            : 'none',
                                    }}
                                >
                                    <Box sx={{
                                        mt: 0.25, flexShrink: 0, display: 'flex',
                                        fontSize: iconVar.xs, color,
                                    }}>
                                        <SeverityIcon type={msg.type} />
                                    </Box>
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography sx={{
                                            fontSize: textVar.xs, lineHeight: 1.4,
                                            color: 'text.primary', overflowWrap: 'anywhere',
                                        }}>
                                            {msg.value}
                                        </Typography>
                                        <Box sx={{
                                            display: 'flex', alignItems: 'center',
                                            flexWrap: 'wrap', columnGap: 0.75, rowGap: 0.25,
                                            mt: 0.25,
                                        }}>
                                            <Typography sx={{ fontSize: textVar.xxs, color: 'text.secondary' }}>
                                                {msg.component}
                                            </Typography>
                                            <Typography sx={{ fontSize: textVar.xxs, color: 'text.disabled' }}>
                                                {formatTimestamp(msg.timestamp)}
                                            </Typography>
                                            {msg.count > 1 && (
                                                <Box component="span" sx={{
                                                    color, fontSize: textVar.xxs,
                                                    fontWeight: 600, lineHeight: 1.4,
                                                }}>
                                                    ×{msg.count}
                                                </Box>
                                            )}
                                            {hasDetails && (
                                                <Button
                                                    size="small"
                                                    color="inherit"
                                                    startIcon={isExpanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
                                                    onClick={() => toggleExpand(index)}
                                                    sx={{
                                                        minWidth: 0, p: 0,
                                                        textTransform: 'none', fontSize: textVar.xxs,
                                                        color: 'text.secondary',
                                                        '& .MuiButton-startIcon': { mr: 0.125 },
                                                        '&:hover': { color: 'primary.main', backgroundColor: 'transparent' },
                                                    }}
                                                >
                                                    {t('messages.details')}
                                                </Button>
                                            )}
                                        </Box>
                                        {hasDetails && isExpanded && (
                                            <Box sx={{
                                                mt: 0.75, p: 1,
                                                color: 'text.secondary',
                                                backgroundColor: alpha(theme.palette.text.primary, 0.035),
                                                border: `1px solid ${borderColor.component}`,
                                                borderRadius: radius.sm,
                                            }}>
                                                {msg.detail && (
                                                    <Typography sx={{
                                                        fontSize: textVar.xs, lineHeight: 1.5,
                                                        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                                                    }}>
                                                        {msg.detail}
                                                    </Typography>
                                                )}
                                                {msg.code && (
                                                    <Box component="pre" sx={{
                                                        whiteSpace: 'pre-wrap',
                                                        wordBreak: 'break-word',
                                                        fontSize: textVar.xxs,
                                                        m: msg.detail ? '8px 0 0' : 0,
                                                        p: 1,
                                                        color: 'text.primary',
                                                        backgroundColor: 'background.paper',
                                                        border: `1px solid ${borderColor.component}`,
                                                        borderRadius: radius.sm,
                                                        overflow: 'auto',
                                                    }}>
                                                        {msg.code.split('\n').filter(line => line.trim() !== '').join('\n')}
                                                    </Box>
                                                )}
                                                {msg.diagnostics && <DiagnosticsViewer diagnostics={msg.diagnostics} />}
                                            </Box>
                                        )}
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                </Paper>
            </Snackbar>
            
            {latestMessage != undefined ? (
                <Snackbar
                open={openLastMessage}
                autoHideDuration={latestMessage?.type == "error" ? 20000 : 10000}
                anchorOrigin={{vertical: 'bottom', horizontal: 'right'}}
                onClose={handleClose}
                sx={{
                    bottom: '54px !important',
                    maxWidth: { xs: 'calc(100% - 32px)', sm: 420 },
                }}
            >
                <Alert
                    onClose={handleClose}
                    severity={latestMessage.type}
                    variant="standard"
                    sx={{
                        width: '100%', maxHeight: 'min(60vh, 560px)', overflow: 'auto',
                        alignItems: 'flex-start',
                        border: `1px solid ${alpha(theme.palette[latestMessage.type].main, 0.24)}`,
                        borderRadius: radius.md,
                        boxShadow: shadow.xl,
                        '& .MuiAlert-message': { width: '100%', minWidth: 0 },
                    }}
                >
                    <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary', mb: 0.25 }}>
                        {latestMessage.component} · {formatTimestamp(latestMessage.timestamp)}
                    </Typography>
                    <Typography sx={{ fontSize: textVar.xs, color: 'text.primary', overflowWrap: 'anywhere' }}>
                        {latestMessage.value}
                    </Typography>
                    {latestMessage.detail && (
                        <Typography sx={{
                            mt: 0.75, pt: 0.75,
                            borderTop: `1px solid ${borderColor.divider}`,
                            fontSize: textVar.xs, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                        }}>
                            {latestMessage.detail}
                        </Typography>
                    )}
                    {latestMessage.code && (
                        <Box component="pre" sx={{
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            fontSize: textVar.xxs, m: '8px 0 0', p: 1,
                            backgroundColor: alpha(theme.palette.text.primary, 0.05),
                            borderRadius: radius.sm,
                        }}>
                            {latestMessage.code.split('\n').filter(line => line.trim() !== '').join('\n')}
                        </Box>
                    )}
                </Alert>    
                </Snackbar>
            ) : null}
        </Box>
    );
});