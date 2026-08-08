// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * LogViewerDialog — view and download the persistent server log.
 *
 * Only mounted when the server reports local single-user mode
 * (`serverConfig.IS_LOCAL_MODE`). In hosted deployments the log endpoints
 * return ACCESS_DENIED and this button is never rendered.
 *
 * The log file lives at `<DATA_FORMULATOR_HOME>/logs/data_formulator.log`
 * and captures all server + Python-execution output — the artifact a user
 * can send when reporting an issue.
 */

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import {
    Box,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Tooltip,
    Typography,
} from '@mui/material';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';

import { getUrls } from '../app/utils';
import { apiRequest } from '../app/apiClient';
import { textVar } from '../app/layout';

const DEFAULT_TAIL_LINES = 500;

interface LogTailResponse {
    path: string | null;
    exists: boolean;
    lines?: number;
    content: string;
}

export const LogViewerDialog: FC<{
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    hideTrigger?: boolean;
    tailLines?: number;
    title?: string;
}> = ({
    open: openProp,
    onOpenChange,
    hideTrigger = false,
    tailLines = DEFAULT_TAIL_LINES,
    title,
}) => {
    const { t } = useTranslation();
    const [openState, setOpenState] = useState(false);
    const open = openProp ?? openState;
    const setOpen = useCallback((value: boolean) => {
        setOpenState(value);
        onOpenChange?.(value);
    }, [onOpenChange]);
    const [loading, setLoading] = useState(false);
    const [content, setContent] = useState('');
    const [path, setPath] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const preRef = useRef<HTMLPreElement>(null);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data } = await apiRequest<LogTailResponse>(
                `${getUrls().LOGS_TAIL}?lines=${tailLines}`,
            );
            setContent(data.content || '');
            setPath(data.path ?? null);
        } catch (e: any) {
            setError(e?.message || 'Failed to load logs');
        } finally {
            setLoading(false);
        }
    }, [tailLines]);

    useEffect(() => {
        if (open) {
            fetchLogs();
        }
    }, [open, fetchLogs]);

    // Auto-scroll to the newest line once content renders.
    useEffect(() => {
        if (open && preRef.current) {
            preRef.current.scrollTop = preRef.current.scrollHeight;
        }
    }, [content, open]);

    const handleDownload = () => {
        // Direct navigation triggers the browser download (attachment header).
        window.open(getUrls().LOGS_DOWNLOAD, '_blank');
    };

    return (
        <>
            {!hideTrigger && (
            <Tooltip title={t('logs.viewLogs', { defaultValue: 'View backend log' })}>
                <IconButton
                    size="small"
                    onClick={() => setOpen(true)}
                    sx={{
                        p: 0.5,
                        color: 'text.secondary',
                        '&:hover': { color: 'text.primary', backgroundColor: 'rgba(0, 0, 0, 0.04)' },
                    }}
                    aria-label={t('logs.viewLogs', { defaultValue: 'View backend log' })}
                >
                    <TerminalOutlinedIcon fontSize="small" />
                </IconButton>
            </Tooltip>
            )}
            <Dialog open={open} onClose={() => setOpen(false)} maxWidth="lg" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
                    <Typography component="span" sx={{ fontWeight: 500, flexGrow: 1 }}>
                        {title || t('logs.title', { defaultValue: 'Backend Log' })}
                    </Typography>
                    <Tooltip title={t('logs.refresh', { defaultValue: 'Refresh' })}>
                        <span>
                            <IconButton size="small" onClick={fetchLogs} disabled={loading}>
                                <RefreshIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title={t('logs.download', { defaultValue: 'Download full log' })}>
                        <span>
                            <IconButton size="small" onClick={handleDownload}>
                                <DownloadIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title={t('common.close', { defaultValue: 'Close' })}>
                        <IconButton
                            size="small"
                            onClick={() => setOpen(false)}
                            aria-label={t('common.close', { defaultValue: 'Close' })}
                        >
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </DialogTitle>
                <DialogContent dividers sx={{ p: 0 }}>
                    {path && (
                        <Typography
                            variant="caption"
                            sx={{
                                display: 'block',
                                px: 2,
                                py: 0.5,
                                color: 'text.secondary',
                                fontFamily: 'monospace',
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                wordBreak: 'break-all',
                            }}
                        >
                            {path}
                        </Typography>
                    )}
                    {loading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                            <CircularProgress size={24} />
                        </Box>
                    )}
                    {!loading && error && (
                        <Typography color="error" sx={{ p: 2, fontSize: textVar.md }}>
                            {error}
                        </Typography>
                    )}
                    {!loading && !error && (
                        <Box
                            component="pre"
                            ref={preRef}
                            sx={{
                                m: 0,
                                p: 2,
                                maxHeight: '60vh',
                                overflow: 'auto',
                                fontSize: textVar.xs,
                                lineHeight: 1.5,
                                fontFamily: 'monospace',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                bgcolor: '#1e1e1e',
                                color: '#d4d4d4',
                            }}
                        >
                            {content || t('logs.empty', { defaultValue: 'Log file is empty.' })}
                        </Box>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
};
