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
import { EditorState } from '@codemirror/state';
import { keymap, Panel } from '@codemirror/view';
import { ensureSyntaxTree, foldEffect, forceParsing } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import {
    closeSearchPanel,
    findNext,
    findPrevious,
    getSearchQuery,
    openSearchPanel,
    search,
    SearchQuery,
    searchKeymap,
    selectMatches,
    setSearchQuery,
} from '@codemirror/search';
import { SyntaxNode } from '@lezer/common';
import {
    Box,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    List,
    ListItemButton,
    ListItemText,
    Tab,
    Tabs,
    Tooltip,
    Typography,
} from '@mui/material';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import SearchIcon from '@mui/icons-material/Search';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { getUrls } from '../app/utils';
import { apiRequest } from '../app/apiClient';
import { DataFormulatorState } from '../app/dfSlice';
import { textVar } from '../app/layout';
import { WorkspaceFile, previewWorkspaceFile, downloadWorkspaceFile } from '../app/workspaceService';

const DEFAULT_TAIL_LINES = 500;

export function createSavedStateSearchPanel(view: EditorView): Panel {
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'cm-textfield';
    searchInput.name = 'df-saved-state-find';
    searchInput.placeholder = 'Find';
    searchInput.setAttribute('aria-label', 'Find');
    searchInput.setAttribute('main-field', 'true');
    searchInput.setAttribute('autocomplete', 'off');
    searchInput.setAttribute('autocorrect', 'off');
    searchInput.setAttribute('autocapitalize', 'off');
    searchInput.setAttribute('spellcheck', 'false');
    searchInput.setAttribute('aria-autocomplete', 'none');
    searchInput.setAttribute('data-1p-ignore', 'true');
    searchInput.setAttribute('data-lpignore', 'true');
    searchInput.value = getSearchQuery(view.state).search;

    const updateQuery = () => {
        const current = getSearchQuery(view.state);
        view.dispatch({
            effects: setSearchQuery.of(new SearchQuery({
                search: searchInput.value,
                caseSensitive: current.caseSensitive,
                literal: current.literal,
                regexp: current.regexp,
                wholeWord: current.wholeWord,
            })),
        });
    };
    searchInput.addEventListener('input', updateQuery);
    searchInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            (event.shiftKey ? findPrevious : findNext)(view);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closeSearchPanel(view);
        }
    });

    const makeButton = (name: string, label: string, action: () => void) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = name === 'close' ? '' : 'cm-button';
        button.name = name;
        button.textContent = label;
        button.setAttribute('aria-label', label);
        button.addEventListener('click', action);
        return button;
    };

    const panel = document.createElement('div');
    panel.className = 'cm-search';
    panel.append(
        searchInput,
        makeButton('next', 'Next', () => { findNext(view); }),
        makeButton('prev', 'Previous', () => { findPrevious(view); }),
        makeButton('select', 'All', () => { selectMatches(view); }),
        makeButton('close', '×', () => { closeSearchPanel(view); }),
    );

    return {
        dom: panel,
        update(update) {
            const query = getSearchQuery(update.state);
            if (searchInput.value !== query.search) searchInput.value = query.search;
        },
        destroy() {
            searchInput.removeEventListener('input', updateQuery);
        },
    };
}

const savedStateEditorTheme = EditorView.theme({
    '&': {
        height: '100%',
        fontSize: textVar.sm,
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--df-font-mono)' },
    '.cm-panels': {
        backgroundColor: '#f7f8fa',
        color: '#30343b',
        fontFamily: 'Roboto, sans-serif',
    },
    '.cm-panels.cm-panels-bottom': {
        borderTop: '1px solid rgba(0, 0, 0, 0.12)',
    },
    '.cm-search': {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '7px 10px',
    },
    '.cm-search label, .cm-search br': { display: 'none' },
    '.cm-search .cm-textfield': {
        width: 'min(320px, 45vw)',
        height: '30px',
        boxSizing: 'border-box',
        padding: '4px 9px',
        border: '1px solid rgba(0, 0, 0, 0.18)',
        borderRadius: '6px',
        backgroundColor: '#fff',
        color: '#202124',
        fontFamily: 'var(--df-font-mono)',
        fontSize: `${textVar.sm}px`,
        outline: 'none',
    },
    '.cm-search .cm-textfield:focus': {
        borderColor: '#1976d2',
        boxShadow: '0 0 0 2px rgba(25, 118, 210, 0.14)',
    },
    '.cm-search .cm-button': {
        height: '30px',
        boxSizing: 'border-box',
        margin: '0',
        padding: '4px 10px',
        border: '1px solid rgba(0, 0, 0, 0.14)',
        borderRadius: '6px',
        backgroundImage: 'none',
        backgroundColor: '#fff',
        color: '#3c4043',
        fontFamily: 'Roboto, sans-serif',
        fontSize: `${textVar.xs}px`,
        cursor: 'pointer',
    },
    '.cm-search .cm-button:hover': {
        borderColor: 'rgba(25, 118, 210, 0.45)',
        backgroundColor: 'rgba(25, 118, 210, 0.06)',
        color: '#1565c0',
    },
    '.cm-search button[name="close"]': {
        position: 'static',
        width: '30px',
        height: '30px',
        marginLeft: 'auto',
        border: '0',
        borderRadius: '6px',
        backgroundColor: 'transparent',
        color: '#5f6368',
        fontSize: '18px',
        cursor: 'pointer',
    },
    '.cm-search button[name="close"]:hover': {
        backgroundColor: 'rgba(0, 0, 0, 0.06)',
        color: '#202124',
    },
});

const savedStateEditorExtensions = [
    json(),
    search({ createPanel: createSavedStateSearchPanel }),
    keymap.of(searchKeymap),
    EditorView.lineWrapping,
    savedStateEditorTheme,
];

const SAVED_STATE_AUTO_FOLD_PATHS = [
    // Table payloads: keep IDs, names, lineage, and virtual references visible.
    ['inputTables', '*', 'snapshot'],
    ['derivedTables', '*', 'rows'],
    ['derivedTables', '*', 'metadata'],
    // Generated derivation evidence and conversation traces.
    ['derivedTables', '*', 'derive', 'dialog'],
    ['derivedTables', '*', 'derive', 'explanation'],
    ['derivedTables', '*', 'derive', 'trigger', 'interaction'],
    ['draftNodes', '*', 'derive', 'dialog'],
    ['draftNodes', '*', 'derive', 'trigger', 'interaction'],
    ['draftNodes', '*', 'derive', 'pendingClarification', 'trajectory'],
    // Generated visual/report payloads.
    ['charts', '*', 'styleVariants'],
    ['generatedReports', '*', 'inspectionSteps'],
    // Structured artifacts: keep turn identity, kind, status, and parent visible.
    ['textTurns', '*', 'options'],
    ['textTurns', '*', 'form'],
    ['textTurns', '*', 'dataOperation'],
    ['textTurns', '*', 'resume', 'trajectory'],
    // Embedded loading results: keep message role, content, and timestamp visible.
    ['dataLoadingChatMessages', '*', 'codeBlocks'],
    ['dataLoadingChatMessages', '*', 'tables'],
    ['dataLoadingChatMessages', '*', 'loadPlan'],
    ['dataLoadingChatMessages', '*', 'dataOperation'],
    ['dataLoadingChatMessages', '*', 'connectorForm'],
];

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

function jsonContainerPath(state: EditorState, node: SyntaxNode): string[] {
    const path: string[] = [];
    let current: SyntaxNode | null = node;
    while (current?.parent) {
        const parent: SyntaxNode = current.parent;
        if (parent.name === 'Property') {
            const propertyName = parent.getChild('PropertyName');
            if (propertyName) {
                try {
                    path.unshift(JSON.parse(state.doc.sliceString(propertyName.from, propertyName.to)));
                } catch {
                    return [];
                }
            }
        } else if (parent.name === 'Array') {
            path.unshift('*');
        }
        current = parent;
    }
    return path;
}

export function getSavedStateAutoFoldRanges(state: EditorState): { from: number; to: number }[] {
    const ranges: { from: number; to: number }[] = [];
    const tree = ensureSyntaxTree(state, state.doc.length, 100);
    if (!tree) return ranges;
    tree.iterate({
        enter(node) {
            const isContainer = node.name === 'Array' || node.name === 'Object';
            const isRoot = node.node.parent === null;
            if (!isContainer || isRoot) return undefined;
            const path = jsonContainerPath(state, node.node);
            const matches = SAVED_STATE_AUTO_FOLD_PATHS.some(pattern =>
                pattern.length === path.length && pattern.every((segment, index) => segment === path[index])
            );
            if (matches) {
                if (node.to - node.from > 2) {
                    ranges.push({ from: node.from + 1, to: node.to - 1 });
                }
                return false;
            }
            return undefined;
        },
    });
    return ranges;
}

function foldSavedStatePaths(view: EditorView): void {
    forceParsing(view, view.state.doc.length, 200);
    const effects = getSavedStateAutoFoldRanges(view.state).map(range => foldEffect.of(range));
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
    const [scratchFiles, setScratchFiles] = useState<WorkspaceFile[]>([]);
    const [selectedScratch, setSelectedScratch] = useState<string | null>(null);
    const [scratchPreview, setScratchPreview] = useState('');
    const [scratchPreviewError, setScratchPreviewError] = useState<string | null>(null);
    const [scratchPreviewLoading, setScratchPreviewLoading] = useState(false);
    const preRef = useRef<HTMLPreElement>(null);
    const savedStateEditorRef = useRef<EditorView | null>(null);

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

    const fetchScratchFiles = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            if (!activeWorkspace?.id) throw new Error('No active workspace to inspect.');
            const { data } = await apiRequest<{ files: WorkspaceFile[] }>('/api/workspace/files?include_temp=true');
            const files = data.files.filter(file => file.temporary && file.name.startsWith('scratch/'));
            setScratchFiles(files);
            setSelectedScratch(selected => files.some(file => file.name === selected) ? selected : null);
        } catch (error: any) {
            setError(error?.message || 'Failed to load scratch files');
        } finally {
            setLoading(false);
        }
    }, [activeWorkspace?.id]);

    useEffect(() => {
        setSavedState('');
        setScratchFiles([]);
        setSelectedScratch(null);
    }, [activeWorkspace?.id]);

    useEffect(() => {
        if (open) {
            if (activeTab === 0) fetchLogs();
            else if (activeTab === 1) fetchSavedState();
            else fetchScratchFiles();
        }
    }, [activeTab, open, fetchLogs, fetchSavedState, fetchScratchFiles]);

    useEffect(() => {
        let cancelled = false;
        setScratchPreview('');
        setScratchPreviewError(null);
        setScratchPreviewLoading(false);
        if (!open || !selectedScratch) return;
        setScratchPreviewLoading(true);
        previewWorkspaceFile(selectedScratch).then(preview => {
            if (!cancelled) setScratchPreview((preview.kind === 'table'
                ? JSON.stringify(preview.rows, null, 2) : preview.content) + (preview.truncated ? '\n[Truncated]' : ''));
        }).catch(error => {
            if (!cancelled) setScratchPreviewError(error?.message || 'Preview unavailable');
        }).finally(() => {
            if (!cancelled) setScratchPreviewLoading(false);
        });
        return () => { cancelled = true; };
    }, [open, selectedScratch, activeWorkspace?.id]);

    const handleDownloadScratch = async () => {
        if (!selectedScratch) return;
        try {
            const blob = await downloadWorkspaceFile(selectedScratch);
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = selectedScratch.split('/').pop()!;
            anchor.click();
            URL.revokeObjectURL(url);
        } catch (error: any) {
            setScratchPreviewError(error?.message || 'Download failed');
        }
    };

    // Auto-scroll to the newest line once content renders.
    useEffect(() => {
        if (open && preRef.current) {
            preRef.current.scrollTop = preRef.current.scrollHeight;
        }
    }, [content, open]);

    useEffect(() => {
        if (activeTab === 1 && savedState && savedStateEditorRef.current) {
            foldSavedStatePaths(savedStateEditorRef.current);
        }
    }, [activeTab, savedState]);

    useEffect(() => {
        if (!open || activeTab !== 1) return;
        const handleSavedStateSearchShortcut = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
                event.preventDefault();
                event.stopPropagation();
                if (savedStateEditorRef.current) {
                    openSearchPanel(savedStateEditorRef.current);
                }
            }
        };
        window.addEventListener('keydown', handleSavedStateSearchShortcut, true);
        return () => window.removeEventListener('keydown', handleSavedStateSearchShortcut, true);
    }, [activeTab, open]);

    const handleDownload = () => {
        // Direct navigation triggers the browser download (attachment header).
        window.open(getUrls().LOGS_DOWNLOAD, '_blank');
    };

    const handleSearchSavedState = () => {
        if (savedStateEditorRef.current) {
            openSearchPanel(savedStateEditorRef.current);
        }
    };

    const handleCopySavedState = async () => {
        try {
            await navigator.clipboard.writeText(savedState);
        } catch {
            setError(t('logs.copySavedStateFailed', { defaultValue: 'Failed to copy saved state.' }));
        }
    };

    const handleRefresh = activeTab === 0 ? fetchLogs : activeTab === 1 ? fetchSavedState : fetchScratchFiles;

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
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 2, py: 1.25, flexShrink: 0 }}>
                    <Typography component="span" sx={{ fontSize: textVar.xl, fontWeight: 500 }}>
                        {title || t('logs.title', { defaultValue: 'Backend Log' })}
                    </Typography>
                    <Tooltip title={t('logs.refresh', { defaultValue: 'Refresh' })}>
                        <span>
                            <IconButton size="small" onClick={handleRefresh} disabled={loading} sx={{ color: 'text.secondary' }}>
                                <RefreshIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Box sx={{ ml: 'auto', width: 64, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                    {activeTab === 1 && <Tooltip title={t('logs.searchSavedState', { defaultValue: 'Search saved state (Ctrl/⌘F)' })}>
                        <span>
                            <IconButton
                                size="small"
                                onClick={handleSearchSavedState}
                                disabled={loading || !savedState}
                                aria-label={t('logs.searchSavedState', { defaultValue: 'Search saved state (Ctrl/⌘F)' })}
                                sx={{ color: 'text.secondary' }}
                            >
                                <SearchIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>}
                    {activeTab === 1 && <Tooltip title={t('logs.copySavedState', { defaultValue: 'Copy saved state' })}>
                        <span>
                            <IconButton
                                size="small"
                                onClick={handleCopySavedState}
                                disabled={loading || !savedState}
                                aria-label={t('logs.copySavedState', { defaultValue: 'Copy saved state' })}
                                sx={{ color: 'text.secondary' }}
                            >
                                <ContentCopyIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>}
                    {activeTab === 0 && <Tooltip title={t('logs.download', { defaultValue: 'Download full log' })}>
                        <span>
                            <IconButton size="small" onClick={handleDownload} sx={{ color: 'text.secondary' }}>
                                <DownloadIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>}
                    </Box>
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
                        flexShrink: 0,
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
                            fontWeight: 400,
                        },
                    }}
                >
                    <Tab label={t('logs.logTab', { defaultValue: 'Backend log' })} />
                    <Tab label={t('logs.savedStateTab', { defaultValue: 'Saved state' })} />
                    <Tab label={t('logs.scratchFilesTab', { defaultValue: 'Scratch files' })} />
                </Tabs>
                <DialogContent dividers data-testid="diagnostics-content" sx={{ p: 0, height: '60vh', flex: '0 1 60vh', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
                    {activeTab === 0 && path && (
                        <Typography
                            variant="caption"
                            sx={{
                                display: 'block',
                                flexShrink: 0,
                                px: 2,
                                py: 0.5,
                                color: 'text.secondary',
                                fontFamily: 'var(--df-font-mono)',
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                wordBreak: 'break-all',
                            }}
                        >
                            {path}
                        </Typography>
                    )}
                    {loading && (
                        <Box sx={{ position: 'absolute', top: 8, right: 16, zIndex: 1, pointerEvents: 'none' }}>
                            <CircularProgress size={16} />
                        </Box>
                    )}
                    {!loading && error && (
                        <Typography color="error" sx={{ p: 2, fontSize: textVar.md }}>
                            {error}
                        </Typography>
                    )}
                            <Box
                                component="pre"
                                ref={preRef}
                                sx={{
                                    display: activeTab === 0 ? 'block' : 'none',
                                    m: 0,
                                    p: 2,
                                    flex: 1,
                                    minHeight: 0,
                                    overflow: 'auto',
                                    fontSize: textVar.xs,
                                    lineHeight: 1.5,
                                    fontFamily: 'var(--df-font-mono)',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    bgcolor: '#1e1e1e',
                                    color: '#d4d4d4',
                                }}
                            >
                                {content || (!loading && !error ? t('logs.empty', { defaultValue: 'Log file is empty.' }) : '')}
                            </Box>
                            <Box sx={{ flex: 1, minHeight: 0, display: activeTab === 2 ? 'flex' : 'none', flexDirection: { xs: 'column', sm: 'row' }, overflow: 'hidden' }}>
                                <List dense aria-label="Scratch files" sx={{ width: { xs: '100%', sm: 260 }, maxHeight: { xs: '20vh', sm: '100%' }, flexShrink: 0, overflow: 'auto', borderRight: '1px solid', borderColor: 'divider' }}>
                                    {!loading && !error && scratchFiles.length === 0 && <Typography sx={{ p: 2, fontSize: textVar.sm, color: 'text.secondary' }}>No scratch files.</Typography>}
                                    {scratchFiles.map(file => <ListItemButton key={file.name} selected={selectedScratch === file.name} onClick={() => setSelectedScratch(file.name)}>
                                        <ListItemText primary={file.name.slice('scratch/'.length)} secondary={`${file.file_size.toLocaleString()} bytes`}
                                            primaryTypographyProps={{ sx: { fontSize: textVar.sm, overflowWrap: 'anywhere' } }} />
                                    </ListItemButton>)}
                                </List>
                                <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                                    {selectedScratch && <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                                        <Typography sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: textVar.sm }}>{selectedScratch}</Typography>
                                        <Tooltip title="Download file"><IconButton aria-label="Download scratch file" size="small" onClick={handleDownloadScratch}><DownloadIcon fontSize="small" /></IconButton></Tooltip>
                                    </Box>}
                                    {scratchPreviewLoading ? <Box sx={{ p: 2 }}><CircularProgress size={20} /></Box>
                                        : scratchPreviewError ? <Typography color="error" sx={{ p: 2 }}>{scratchPreviewError}</Typography>
                                        : <Box component="pre" sx={{ m: 0, p: 2, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--df-font-mono)', fontSize: textVar.xs }}>{scratchPreview}</Box>}
                                </Box>
                            </Box>
                            <Box sx={{ display: activeTab === 1 ? 'block' : 'none', flex: 1, minHeight: 0, overflow: 'hidden', '& > .cm-theme': { height: '100%' } }}>
                                <CodeMirror
                                    value={savedState}
                                    height="100%"
                                    extensions={savedStateEditorExtensions}
                                    readOnly
                                    editable={false}
                                    basicSetup={{
                                        lineNumbers: true,
                                        foldGutter: true,
                                        highlightActiveLine: true,
                                        highlightActiveLineGutter: true,
                                        highlightSelectionMatches: true,
                                    }}
                                    onCreateEditor={(view) => {
                                        savedStateEditorRef.current = view;
                                    }}
                                    aria-label={t('logs.savedStateTab', { defaultValue: 'Saved State' })}
                                />
                            </Box>
                </DialogContent>
            </Dialog>
        </>
    );
};
