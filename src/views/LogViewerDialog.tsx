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
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Tooltip,
    Typography,
} from '@mui/material';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';

import { getUrls } from '../app/utils';
import { apiRequest } from '../app/apiClient';

const TAIL_LINES = 2000;

interface LogTailResponse {
    path: string | null;
    exists: boolean;
    lines?: number;
    content: string;
}

export const LogViewerDialog: FC = () => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
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
                `${getUrls().LOGS_TAIL}?lines=${TAIL_LINES}`,
            );
            setContent(data.content || '');
            setPath(data.path ?? null);
        } catch (e: any) {
            setError(e?.message || 'Failed to load logs');
        } finally {
            setLoading(false);
        }
    }, []);

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
            <Tooltip title={t('logs.viewLogs', { defaultValue: 'View server logs' })}>
                <IconButton
                    size="small"
                    onClick={() => setOpen(true)}
                    sx={{
                        p: 0.5,
                        color: 'text.secondary',
                        '&:hover': { color: 'text.primary', backgroundColor: 'rgba(0, 0, 0, 0.04)' },
                    }}
                    aria-label={t('logs.viewLogs', { defaultValue: 'View server logs' })}
                >
                    <TerminalOutlinedIcon fontSize="small" />
                </IconButton>
            </Tooltip>
            <Dialog open={open} onClose={() => setOpen(false)} maxWidth="lg" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
                    <Typography component="span" sx={{ fontWeight: 500, flexGrow: 1 }}>
                        {t('logs.title', { defaultValue: 'Server Logs' })}
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
                        <Typography color="error" sx={{ p: 2, fontSize: 13 }}>
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
                                fontSize: 11.5,
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
                <DialogActions>
                    <Button onClick={() => setOpen(false)} sx={{ textTransform: 'none' }}>
                        {t('common.close', { defaultValue: 'Close' })}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
