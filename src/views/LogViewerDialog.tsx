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
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { foldEffect, syntaxTree } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import {
    Box,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Tab,
    Tabs,
    Tooltip,
    Typography,
} from '@mui/material';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { getUrls } from '../app/utils';
import { apiRequest } from '../app/apiClient';
import { DataFormulatorState } from '../app/dfSlice';
import { textVar } from '../app/layout';

const DEFAULT_TAIL_LINES = 500;
const DEFAULT_FOLD_CHARACTER_THRESHOLD = 2000;

interface LogTailResponse {
    path: string | null;
    exists: boolean;
    lines?: number;
    content: string;
}

interface SessionLoadResponse {
    id: string;
    state: Record<string, unknown>;
}

function foldLargeJsonValues(view: EditorView): void {
    const effects: ReturnType<typeof foldEffect.of>[] = [];
    syntaxTree(view.state).iterate({
        enter(node) {
            const isContainer = node.name === 'Array' || node.name === 'Object';
            const isRoot = node.node.parent === null;
            const property = node.node.parent;
            const propertyPrefix = property?.name === 'Property'
                ? view.state.doc.sliceString(property.from, node.from)
                : '';
            const propertyName = propertyPrefix.match(/"([^"\\]+)"\s*:\s*$/)?.[1]?.toLowerCase() || '';
            const isAgentConversation = /agent|chat|message|dialog/.test(propertyName);
            if (isContainer && !isRoot && (
                isAgentConversation || node.to - node.from >= DEFAULT_FOLD_CHARACTER_THRESHOLD
            )) {
                effects.push(foldEffect.of({ from: node.from + 1, to: node.to - 1 }));
                return false;
            }
            return undefined;
        },
    });
    if (effects.length > 0) view.dispatch({ effects });
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
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
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
    const [activeTab, setActiveTab] = useState(0);
    const [savedState, setSavedState] = useState('');
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

    const fetchSavedState = useCallback(async () => {
        if (!activeWorkspace?.id) {
            setSavedState('');
            setError(t('logs.noActiveWorkspace', { defaultValue: 'No active workspace to inspect.' }));
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const { data } = await apiRequest<SessionLoadResponse>(getUrls().SESSION_LOAD, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: activeWorkspace.id }),
            });
            setSavedState(JSON.stringify(data.state ?? {}, null, 2));
        } catch (e: any) {
            setError(e?.message || 'Failed to load saved state');
        } finally {
            setLoading(false);
        }
    }, [activeWorkspace?.id, t]);

    useEffect(() => {
        if (open) {
            if (activeTab === 0) fetchLogs();
            else fetchSavedState();
        }
    }, [activeTab, open, fetchLogs, fetchSavedState]);

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

    const handleRefresh = activeTab === 0 ? fetchLogs : fetchSavedState;

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
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 2, py: 1.25 }}>
                    <Typography component="span" sx={{ fontSize: textVar.xl, fontWeight: 500, flexGrow: 1 }}>
                        {title || t('logs.title', { defaultValue: 'Backend Log' })}
                    </Typography>
                    <Tooltip title={t('logs.refresh', { defaultValue: 'Refresh' })}>
                        <span>
                            <IconButton size="small" onClick={handleRefresh} disabled={loading} sx={{ color: 'text.secondary' }}>
                                <RefreshIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                    {activeTab === 0 && <Tooltip title={t('logs.download', { defaultValue: 'Download full log' })}>
                        <span>
                            <IconButton size="small" onClick={handleDownload} sx={{ color: 'text.secondary' }}>
                                <DownloadIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>}
                    <Tooltip title={t('common.close', { defaultValue: 'Close' })}>
                        <IconButton
                            size="small"
                            onClick={() => setOpen(false)}
                            aria-label={t('common.close', { defaultValue: 'Close' })}
                            sx={{ color: 'text.secondary' }}
                        >
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </DialogTitle>
                <Tabs
                    value={activeTab}
                    onChange={(_, value: number) => setActiveTab(value)}
                    aria-label={t('logs.inspectorTabs', { defaultValue: 'Backend diagnostics' })}
                    sx={{
                        px: 2,
                        minHeight: 34,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        '& .MuiTabs-indicator': { height: 2, bgcolor: 'text.secondary' },
                        '& .MuiTab-root': {
                            minWidth: 0,
                            minHeight: 34,
                            px: 1.25,
                            py: 0,
                            mr: 1,
                            color: 'text.disabled',
                            fontSize: textVar.sm,
                            fontWeight: 400,
                            textTransform: 'none',
                        },
                        '& .MuiTab-root.Mui-selected': {
                            color: 'text.primary',
                            fontWeight: 500,
                        },
                    }}
                >
                    <Tab label={t('logs.logTab', { defaultValue: 'Backend log' })} />
                    <Tab label={t('logs.savedStateTab', { defaultValue: 'Saved state' })} />
                </Tabs>
                <DialogContent dividers sx={{ p: 0 }}>
                    {activeTab === 0 && path && (
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
                        activeTab === 0 ? (
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
                        ) : (
                            <Box sx={{ height: '60vh', overflow: 'hidden' }}>
                                <CodeMirror
                                    value={savedState}
                                    height="60vh"
                                    extensions={[json(), EditorView.lineWrapping]}
                                    readOnly
                                    editable={false}
                                    basicSetup={{
                                        lineNumbers: true,
                                        foldGutter: true,
                                        highlightActiveLine: true,
                                        highlightActiveLineGutter: true,
                                        highlightSelectionMatches: true,
                                        searchKeymap: true,
                                    }}
                                    onCreateEditor={foldLargeJsonValues}
                                    aria-label={t('logs.savedStateTab', { defaultValue: 'Saved State' })}
                                />
                            </Box>
                        )
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
};
