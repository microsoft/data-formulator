// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import '../scss/App.scss';

import { useDispatch, useSelector } from "react-redux"; /* code change */
import { 
    DataFormulatorState,
    dfActions,
    dfSelectors,
} from '../app/dfSlice'

import _ from 'lodash';

import { Allotment, AllotmentHandle } from "allotment";
import "allotment/dist/style.css";

import {
    Typography,
    Box,
    Tooltip,
    Button,
    Divider,
    useTheme,
    alpha,
    CircularProgress,
    Backdrop,
} from '@mui/material';
import { borderColor, shadow, radius, transition } from '../app/tokens';


import { VisualizationViewFC } from './VisualizationView';

import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { toolName } from '../app/App';
import { DataThread } from './DataThread';

import dfLogo from '../assets/df-logo.png';
import exampleImageTable from "../assets/example-image-table.png";
import { ModelSelectionButton } from './ModelSelectionDialog';
import { UnifiedDataUploadDialog, UploadTabType, DataLoadMenu } from './UnifiedDataUploadDialog';
import { ReportView } from './ReportView';
import GitHubIcon from '@mui/icons-material/GitHub';
import YouTubeIcon from '@mui/icons-material/YouTube';
import { ExampleSession, exampleSessions, ExampleSessionCard } from './ExampleSessions';
import { useDataRefresh, useDerivedTableRefresh } from '../app/useDataRefresh';
import type { DictTable } from '../components/ComponentType';
import { useTranslation } from 'react-i18next';
import { fetchWithIdentity, getUrls } from '../app/utils';
import { listWorkspaces, loadWorkspace, deleteWorkspace, exportWorkspace, importWorkspace } from '../app/workspaceService';
import { AppDispatch } from '../app/store';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadIcon from '@mui/icons-material/Download';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';

/** Generate a session ID like session_20260408_193052_a1b2 */
function generateSessionId(): string {
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const short = crypto.randomUUID().slice(0, 4);
    return `session_${date}_${time}_${short}`;
}

export const DataFormulatorFC = ({ }) => {

    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const models = useSelector(dfSelectors.getAllModels);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const viewMode = useSelector((state: DataFormulatorState) => state.viewMode);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const theme = useTheme();

    const dispatch = useDispatch<AppDispatch>();
    const { t } = useTranslation();

    // Auto-focus: when focusedId is undefined but tables exist, select the first table
    useEffect(() => {
        if (!focusedId && tables.length > 0) {
            dispatch(dfActions.setFocused({ type: 'table', tableId: tables[0].id }));
        }
    }, [focusedId, tables, dispatch]);

    // ── Workspace list (shown on landing page) ────────────────────
    const [savedWorkspaces, setSavedWorkspaces] = useState<{id: string, display_name: string, saved_at: string | null}[]>([]);
    const [confirmDeleteWs, setConfirmDeleteWs] = useState<string | null>(null);

    const fetchWorkspaces = useCallback(async () => {
        try {
            const sessions = await listWorkspaces();
            setSavedWorkspaces(sessions);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        if (!activeWorkspace || tables.length === 0) {
            fetchWorkspaces();
        }
    }, [activeWorkspace, tables.length, fetchWorkspaces]);

    const handleOpenWorkspace = useCallback(async (name: string) => {
        dispatch(dfActions.setSessionLoading({ loading: true, label: `Opening workspace...` }));
        try {
            const result = await loadWorkspace(name);
            if (result && Object.keys(result.state).length > 0) {
                dispatch(dfActions.loadState({ ...result.state, activeWorkspace: { id: name, displayName: result.displayName } }));
            } else {
                dispatch(dfActions.setActiveWorkspace({ id: name, displayName: 'default' }));
            }
        } catch {
            dispatch(dfActions.setActiveWorkspace({ id: name, displayName: 'default' }));
        }
        dispatch(dfActions.setSessionLoading({ loading: false }));
    }, [dispatch]);

    const handleDeleteWorkspace = useCallback(async (name: string) => {
        try {
            await deleteWorkspace(name);
            setSavedWorkspaces(prev => prev.filter(w => w.id !== name));
        } catch { /* ignore */ }
        setConfirmDeleteWs(null);
    }, []);

    const handleExportWorkspace = useCallback(async (name: string) => {
        try {
            const blob = await exportWorkspace(name);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${name}.zip`;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (e) {
            console.warn('Failed to export workspace:', e);
        }
    }, []);

    const importRef = useRef<HTMLInputElement>(null);
    const handleImportWorkspace = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        dispatch(dfActions.setSessionLoading({ loading: true, label: `Importing ${file.name}...` }));
        try {
            const wsName = file.name.replace(/\.zip$/, '') || 'imported';
            const wsId = generateSessionId();
            const state = await importWorkspace(file, wsId, wsName);
            dispatch(dfActions.loadState({ ...state, activeWorkspace: { id: wsId, displayName: wsName } }));
        } catch (e) {
            console.warn('Failed to import workspace:', e);
        }
        dispatch(dfActions.setSessionLoading({ loading: false }));
        if (importRef.current) importRef.current.value = '';
    }, [dispatch]);
    
    // Set up automatic refresh of derived tables when source data changes
    useDerivedTableRefresh();

    // State for unified data upload dialog
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const [uploadDialogInitialTab, setUploadDialogInitialTab] = useState<UploadTabType>('menu');

    // Loading state for sessions (from Redux, shared with App.tsx)
    const sessionLoading = useSelector((state: DataFormulatorState) => state.sessionLoading);
    const sessionLoadingLabel = useSelector((state: DataFormulatorState) => state.sessionLoadingLabel);

    const openUploadDialog = (tab: UploadTabType) => {
        // If no workspace is active, generate an ID (backend creates folder lazily on first data op)
        if (!activeWorkspace) {
            dispatch(dfActions.setActiveWorkspace({ id: generateSessionId(), displayName: 'default' }));
        }
        setUploadDialogInitialTab(tab);
        setUploadDialogOpen(true);
    };

    const handleLoadExampleSession = (session: ExampleSession) => {
        dispatch(dfActions.setSessionLoading({ loading: true, label: t('messages.loadingExample', { title: session.title }) }));

        dispatch(dfActions.addMessages({
            timestamp: Date.now(),
            type: 'info',
            component: 'data formulator',
            value: t('messages.loadingExample', { title: session.title }),
        }));
        
        // Load the complete state from the JSON file
        fetch(session.dataFile)
            .then(res => res.json())
            .then(savedState => {
                // Use loadState to restore the complete session state
                dispatch(dfActions.loadState(savedState));
                
                
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'success',
                    component: 'data formulator',
                    value: t('messages.loadSuccess', { title: session.title }),
                }));
            })
            .catch(error => {
                console.error('Error loading session:', error);
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'error',
                    component: 'data formulator',
                    value: t('messages.loadFailed', { title: session.title, error: error.message }),
                }));
            })
            .finally(() => {
                dispatch(dfActions.setSessionLoading({ loading: false }));
            });
    };

    useEffect(() => {
        document.title = toolName;
        
        // Preload imported images (public images are preloaded in index.html)
        const imagesToPreload = [
            { src: dfLogo, type: 'image/png' },
            { src: exampleImageTable, type: 'image/png' },
        ];
        
        const preloadLinks: HTMLLinkElement[] = [];
        imagesToPreload.forEach(({ src, type }) => {
            // Use link preload for better priority
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'image';
            link.href = src;
            link.type = type;
            document.head.appendChild(link);
            preloadLinks.push(link);
        });
        
        // Cleanup function to remove preload links when component unmounts
        return () => {
            preloadLinks.forEach(link => {
                if (link.parentNode) {
                    link.parentNode.removeChild(link);
                }
            });
        };
    }, []);

    useEffect(() => {
        // Auto-select the first available model when none is selected.
        // No connectivity check on load — errors surface on first use,
        // and the user can manually test via the model selection dialog.
        if (selectedModelId === undefined && models.length > 0) {
            dispatch(dfActions.selectModel(models[0].id));
        }
    }, [dispatch, models, selectedModelId]);

    const visPaneMain = (
        <Box sx={{ width: "100%", height: "100%", overflow: "hidden", display: "flex", flexDirection: "row" }}>
            <VisualizationViewFC />
        </Box>);

    const visPane = visPaneMain;

    let borderBoxStyle = {
        border: `1px solid ${borderColor.view}`, 
        borderRadius: radius.pill, 
        //boxShadow: '0 0 5px rgba(0,0,0,0.1)',
    }

    // Discrete column snapping for DataThread
    const CARD_WIDTH = 220;
    const CARD_GAP = 12;
    const COLUMN_WIDTH = CARD_WIDTH + CARD_GAP;
    const PANE_PADDING = 48;
    const columnSize = (n: number) => n * COLUMN_WIDTH + PANE_PADDING;
    const allotmentRef = useRef<AllotmentHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const snapToColumns = useCallback((sizes: number[]) => {
        if (!allotmentRef.current || sizes.length < 2) return;
        const raw = sizes[0];
        // Find nearest discrete column count (1-3)
        let bestCols = 1;
        let bestDist = Infinity;
        for (let n = 1; n <= 3; n++) {
            const dist = Math.abs(raw - columnSize(n));
            if (dist < bestDist) {
                bestDist = dist;
                bestCols = n;
            }
        }
        const snapped = columnSize(bestCols);
        if (Math.abs(raw - snapped) > 2) {
            const totalWidth = sizes.reduce((a, b) => a + b, 0);
            allotmentRef.current.resize([snapped, totalWidth - snapped]);
        }
    }, []);

    // Compute thread count to decide preferred pane width:
    // A "thread" is a leaf table's derivation chain displayed as a column.
    // Must match the chain-splitting logic in DataThread (MAX_CHAIN_TABLES).
    const threadCount = useMemo(() => {
        // A table is a "leaf" if no other non-anchored table derives from it
        const hasNonAnchoredChild = new Set<string>();
        tables.forEach(t => {
            if (t.derive && !t.anchored) {
                hasNonAnchoredChild.add(t.derive.trigger.tableId);
            }
        });
        const leafTables = tables.filter(t => !hasNonAnchoredChild.has(t.id));
        // Threads = leaf tables with derivation chains + 1 group for hanging (source) tables
        const threaded = leafTables.filter(t => t.derive);
        const hanging = leafTables.filter(t => !t.derive);
        let count = threaded.length + (hanging.length > 0 ? 1 : 0);

        // Account for chain-splitting: long chains are broken into sub-threads
        // (mirrors MAX_CHAIN_TABLES logic in DataThread)
        const MAX_CHAIN_TABLES = 5;
        const tableById = new Map(tables.map(t => [t.id, t]));
        const getChainLength = (t: DictTable): number => {
            let len = 1;
            let cur = t;
            while (cur.derive && !cur.anchored) {
                len++;
                const parent = tableById.get(cur.derive.trigger.tableId);
                if (!parent) break;
                cur = parent;
            }
            return len;
        };
        const claimedForCount = new Set<string>();
        for (const lt of threaded) {
            // Walk chain
            const chainIds: string[] = [lt.id];
            let cur = lt;
            while (cur.derive && !cur.anchored) {
                const pid = cur.derive.trigger.tableId;
                chainIds.push(pid);
                const parent = tableById.get(pid);
                if (!parent) break;
                cur = parent;
            }
            const ownedIds = chainIds.filter(id => !claimedForCount.has(id));
            if (ownedIds.length > MAX_CHAIN_TABLES) {
                // Each extra split adds one more thread entry
                const extraSplits = Math.floor((ownedIds.length - 1) / MAX_CHAIN_TABLES);
                count += extraSplits;
            }
            chainIds.forEach(id => claimedForCount.add(id));
        }

        return count;
    }, [tables]);
    const preferredColumns = threadCount <= 1 ? 1 : 2;

    // Track previous thread count to auto-resize intelligently
    const prevThreadCountRef = useRef(threadCount);
    useEffect(() => {
        const prev = prevThreadCountRef.current;
        prevThreadCountRef.current = threadCount;
        if (!allotmentRef.current || !containerRef.current) return;
        // When there are no tables the first Allotment.Pane is unmounted,
        // so the Allotment only has one child – calling resize with two
        // sizes would crash (accessing .minimumSize on an undefined pane).
        if (tables.length === 0) return;
        const totalWidth = containerRef.current.clientWidth;
        if (totalWidth <= 0) return;

        let newSize: number | null = null;
        if (prev <= 1 && threadCount > 1) {
            // Case 1: was 1 thread, now 2+ → expand to 2 columns
            newSize = columnSize(2);
        } else if (prev > 1 && threadCount <= 1) {
            // Case 2: was 2+ threads, now 1 → shrink to 1 column
            newSize = columnSize(1);
        }
        // Case 3: was 2+ threads and still 2+ → don't change (respect user's manual setting)

        if (newSize !== null) {
            // Defer resize to the next animation frame so the Allotment has
            // re-rendered its pane children before we call resize.
            const finalSize = newSize;
            const rafId = requestAnimationFrame(() => {
                try {
                    const w = containerRef.current?.clientWidth ?? totalWidth;
                    allotmentRef.current?.resize([finalSize, w - finalSize]);
                } catch {
                    // Allotment pane structure may not yet match; ignore.
                }
            });
            return () => cancelAnimationFrame(rafId);
        }
    }, [threadCount, tables.length]);

    const fixedSplitPane = ( 
        <Box sx={{display: 'flex', flexDirection: 'row', height: '100%'}}>
            <Box ref={containerRef} className="outer-allotment" sx={{
                    margin: '4px 8px 8px 8px', backgroundColor: 'white',
                    display: 'flex', height: 'calc(100% - 12px)', width: '100%', flexDirection: 'column',
                    overflow: 'hidden',
                    position: 'relative'}}>
                <Allotment ref={allotmentRef} onDragEnd={snapToColumns} proportionalLayout={false}>
                    {tables.length > 0 ? (
                        <Allotment.Pane minSize={columnSize(1)} preferredSize={columnSize(preferredColumns)} maxSize={columnSize(3)} snap={false}>
                            <DataThread sx={{
                                display: 'flex', 
                                flexDirection: 'column',
                                overflow: 'hidden',
                                alignContent: 'flex-start',
                                height: '100%',
                            }}/>
                        </Allotment.Pane>
                    ) : null}
                    <Allotment.Pane minSize={300}>
                        <Box sx={{ ...borderBoxStyle, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
                            {viewMode === 'editor' ? (
                                visPane
                            ) : (
                                <ReportView />
                            )}
                        </Box>
                    </Allotment.Pane>
                </Allotment>
            </Box>
        </Box>
    );

    let footer = <Box sx={{ color: 'text.secondary', display: 'flex', 
            backgroundColor: 'rgba(255, 255, 255, 0.89)',
            alignItems: 'center', justifyContent: 'center' }}>
        <Button size="small" color="inherit" 
            sx={{ textTransform: 'none'}} 
            target="_blank" rel="noopener noreferrer" 
            href="https://www.microsoft.com/en-us/privacy/privacystatement">{t('footer.privacyCookies')}</Button>
        <Divider orientation="vertical" variant="middle" flexItem sx={{ mx: 1 }} />
        <Button size="small" color="inherit" 
            sx={{ textTransform: 'none'}} 
            target="_blank" rel="noopener noreferrer" 
            href="https://www.microsoft.com/en-us/legal/intellectualproperty/copyright">{t('footer.termsOfUse')}</Button>
        <Divider orientation="vertical" variant="middle" flexItem sx={{ mx: 1 }} />
        <Button size="small" color="inherit" 
            sx={{ textTransform: 'none'}} 
            target="_blank" rel="noopener noreferrer" 
            href="https://github.com/microsoft/data-formulator/issues">{t('footer.contactUs')}</Button>
        <Typography sx={{ display: 'inline', fontSize: '12px', ml: 1 }}> @ {new Date().getFullYear()}</Typography>
    </Box>

    let dataUploadRequestBox = <Box sx={{
            margin: '4px 4px 4px 8px', 
            background: `
                linear-gradient(90deg, ${alpha(theme.palette.text.secondary, 0.01)} 1px, transparent 1px),
                linear-gradient(0deg, ${alpha(theme.palette.text.secondary, 0.01)} 1px, transparent 1px)
            `,
            backgroundSize: '16px 16px',
            width: 'calc(100vw - 16px)', overflow: 'auto', display: 'flex', flexDirection: 'column', height: '100%',
        }}>
        <Box sx={{margin:'auto', pb: '5%', display: "flex", flexDirection: "column", textAlign: "center" }}>
            <Box sx={{display: 'flex', mx: 'auto'}}>
                <Typography fontSize={84} sx={{ml: 2, letterSpacing: '0.05em'}}>{toolName}</Typography> 
            </Box>
            <Typography sx={{ 
                fontSize: 24, color: theme.palette.text.secondary, 
                textAlign: 'center', mb: 2}}>
                {t('landing.tagline')}
            </Typography>
            {serverConfig.PROJECT_FRONT_PAGE && (
            <Box component="nav" aria-label="Resources" sx={{ display: 'flex', justifyContent: 'center', gap: 1, mb: 3, flexWrap: 'wrap' }}>
                <Button size="small" variant="text" color="primary"
                    sx={{ textTransform: 'none', fontSize: 13 }}
                    startIcon={<Box component="img" sx={{ width: 15, height: 15 }} alt="" aria-hidden="true" src="/pip-logo.svg" />}
                    target="_blank" rel="noopener noreferrer"
                    href="https://pypi.org/project/data-formulator/"
                >{t('about.installLocally')}</Button>
                <Button size="small" variant="text" color="primary"
                    sx={{ textTransform: 'none', fontSize: 13 }}
                    startIcon={<YouTubeIcon sx={{ color: '#FF0000', fontSize: 17 }} aria-hidden="true" />}
                    target="_blank" rel="noopener noreferrer"
                    href="https://www.youtube.com/watch?v=GfTE2FLyMrs"
                >{t('about.video')}</Button>
                <Button size="small" variant="text" color="primary"
                    sx={{ textTransform: 'none', fontSize: 13 }}
                    startIcon={<GitHubIcon aria-hidden="true" sx={{ fontSize: 17 }} />}
                    target="_blank" rel="noopener noreferrer"
                    href="https://github.com/microsoft/data-formulator"
                >{t('about.github')}</Button>
            </Box>
            )}
            <Box sx={{my: 4}}>
                <DataLoadMenu 
                    onSelectTab={(tab) => openUploadDialog(tab)}
                    serverConfig={serverConfig}
                    variant="page"
                />
            </Box>
            {/* ── Saved workspaces section ──────────────────────────── */}
            {savedWorkspaces.length > 0 && (
                <Box sx={{mt: 4}}>
                    <Divider sx={{width: '200px', mx: 'auto', mb: 3, fontSize: '1.2rem'}}>
                        <Typography sx={{ color: 'text.secondary' }}>
                            Your Sessions
                        </Typography>
                    </Divider>
                    <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                        gap: 2,
                    }}>
                        {savedWorkspaces.map(w => (
                            <Card key={w.id} variant="outlined" onClick={() => handleOpenWorkspace(w.id)} sx={{
                                position: 'relative', textAlign: 'left',
                                cursor: 'pointer',
                                '&:hover': { transform: 'translateY(-2px)', backgroundColor: 'action.hover' },
                                '&:hover .ws-actions': { opacity: 1 },
                            }}>
                                <CardContent sx={{ py: 1.5, px: 2 }}>
                                    <Typography variant="body2" fontWeight={500} noWrap sx={{ color: 'text.primary' }}>
                                        {w.display_name}
                                    </Typography>
                                    {w.saved_at && (
                                        <Typography variant="caption" color="text.disabled" sx={{ fontSize: 11 }}>
                                            {new Date(w.saved_at).toLocaleString()}
                                        </Typography>
                                    )}
                                </CardContent>
                                <Box className="ws-actions" sx={{
                                    position: 'absolute', top: 4, right: 4,
                                    display: 'flex', gap: 0.25,
                                    opacity: 0, transition: 'opacity 0.15s',
                                }}>
                                    <Tooltip title="Export">
                                        <IconButton size="small" sx={{ color: 'text.secondary', backgroundColor: 'rgba(255,255,255,0.85)', '&:hover': { backgroundColor: 'rgba(240,240,240,0.95)' } }}
                                            onClick={(e) => { e.stopPropagation(); handleExportWorkspace(w.id); }}>
                                            <DownloadIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Delete">
                                        <IconButton size="small" sx={{ color: 'text.secondary', backgroundColor: 'rgba(255,255,255,0.85)', '&:hover': { backgroundColor: 'rgba(240,240,240,0.95)' } }}
                                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteWs(w.id); }}>
                                            <DeleteOutlineIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            </Card>
                        ))}
                        {/* Import workspace card */}
                        <Card variant="outlined" onClick={() => importRef.current?.click()} sx={{
                            textAlign: 'center', borderStyle: 'dashed',
                            cursor: 'pointer',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            gap: 0.5, py: 1.5,
                            '&:hover': { transform: 'translateY(-2px)', backgroundColor: 'action.hover' },
                        }}>
                            <UploadFileIcon sx={{ color: 'text.secondary' }} />
                            <Typography variant="caption" color="text.secondary">Import workspace (.zip)</Typography>
                            <input type="file" hidden accept=".zip" ref={importRef} onChange={handleImportWorkspace} />
                        </Card>
                    </Box>
                </Box>
            )}
            {/* ── Delete workspace confirmation ────────────────────── */}
            <Dialog open={confirmDeleteWs !== null} onClose={() => setConfirmDeleteWs(null)}>
                <DialogTitle>Delete session?</DialogTitle>
                <DialogContent>
                    <Typography>
                        This will permanently delete <strong>{savedWorkspaces.find(w => w.id === confirmDeleteWs)?.display_name || confirmDeleteWs}</strong>{' '}
                        ({confirmDeleteWs}) and all its data.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDeleteWs(null)}>Cancel</Button>
                    <Button color="error" onClick={() => confirmDeleteWs && handleDeleteWorkspace(confirmDeleteWs)}>
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>
            <Box sx={{mt: 4}}>
                <Divider sx={{width: '200px', mx: 'auto', mb: 3, fontSize: '1.2rem'}}>
                    <Typography sx={{ color: 'text.secondary' }}>
                        {t('landing.demos')}
                    </Typography>
                </Divider>
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                    gap: 2,
                }}>
                    {exampleSessions.map((session) => (
                        <ExampleSessionCard
                            key={session.id}
                            session={session}
                            onClick={() => handleLoadExampleSession(session)}
                        />
                    ))}
                </Box>
            </Box>
        </Box>
        {footer}
    </Box>;
    
    return (
        <Box sx={{ display: 'block', width: "100%", height: '100%', position: 'relative' }}>
            <DndProvider backend={HTML5Backend}>
                {tables.length > 0 ? fixedSplitPane : dataUploadRequestBox}
                <UnifiedDataUploadDialog 
                    open={uploadDialogOpen}
                    onClose={() => setUploadDialogOpen(false)}
                    initialTab={uploadDialogInitialTab}
                />
                {/* Loading overlay for session loading */}
                <Backdrop
                    open={sessionLoading}
                    sx={{
                        position: 'absolute',
                        zIndex: 999,
                        backgroundColor: alpha(theme.palette.background.default, 0.85),
                        backdropFilter: 'blur(4px)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                    }}
                >
                    <CircularProgress size={40} />
                    <Typography variant="body1" color="text.secondary">
                        {sessionLoadingLabel || t('session.loadingSessions')}
                    </Typography>
                    <Button
                        variant="text"
                        size="small"
                        onClick={() => dispatch(dfActions.setSessionLoading({ loading: false }))}
                        sx={{ mt: 1, textTransform: 'none', color: 'text.secondary' }}
                    >
                        {t('app.cancel')}
                    </Button>
                </Backdrop>
                {selectedModelId == undefined && (
                    <Box sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: alpha(theme.palette.background.default, 0.85),
                        backdropFilter: 'blur(4px)',
                        display: 'flex',
                        flexDirection: 'column',
                        zIndex: 1000,
                    }}>
                        <Box sx={{margin:'auto', pb: '5%', display: "flex", flexDirection: "column", textAlign: "center"}}>
                            <Box component="img" sx={{  width: 196, margin: "auto" }} alt="Data Formulator logo" src={dfLogo} fetchPriority="high" />
                            <Typography variant="h3" sx={{marginTop: "20px", fontWeight: 200, letterSpacing: '0.05em'}}>
                                {toolName}
                            </Typography>
                            <Typography  variant="h4" sx={{mt: 3, fontSize: 28, letterSpacing: '0.02em'}}>
                                {t('landing.firstSelectModelPrefix')} <ModelSelectionButton />
                            </Typography>
                            <Typography  color="text.secondary" variant="body1" sx={{mt: 2, width: 600}}>💡 {t('landing.modelTip')}</Typography>
                        </Box>
                        {footer}
                    </Box>
                )}
            </DndProvider>
        </Box>);
}