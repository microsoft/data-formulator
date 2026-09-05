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
    useMediaQuery,
    alpha,
    Backdrop,
    Link,
    Select,
    MenuItem,
    TextField,
    Alert,
    Tabs,
    Tab,
} from '@mui/material';
import { borderColor, radius, transition } from '../app/tokens';


import { VisualizationViewFC } from './VisualizationView';
import { AnvilLoader } from '../components/AnvilLoader';

import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { toolName } from '../app/App';
import { DataThread } from './DataThread';
import { MAX_THREAD_COLUMNS } from './threadLayout';
import {
    defaultThreadColumns,
    maxThreadColumnsForWidth,
    maxThreadColumnsForWidthClass,
    threadPaneWidthFor,
} from '../app/layout';
import { iconVar, textVar } from '../app/layout';
import { useContainerSize, useLayout } from '../app/LayoutProvider';

import dfLogo from '../assets/df-logo.svg';
import exampleImageTable from "../assets/example-image-table.png";
import { ModelSelectionButton } from './ModelSelectionDialog';
import { UnifiedDataUploadDialog, UploadTabType, DataLoadMenu, ConnectorInstance } from './UnifiedDataUploadDialog';
import { ReportView } from './ReportView';
import { DataSourceSidebar } from './DataSourceSidebar';
import GitHubIcon from '@mui/icons-material/GitHub';
import { ExampleSession, exampleSessions, ExampleSessionCard, fetchExampleSessions } from './ExampleSessions';
import { useDataRefresh, useDerivedTableRefresh } from '../app/useDataRefresh';
import { useTranslation } from 'react-i18next';
import { fetchWithIdentity, getUrls, CONNECTOR_URLS } from '../app/utils';
import { apiRequest } from '../app/apiClient';
import { listWorkspaceFiles, listWorkspaces, loadWorkspace, deleteWorkspace, exportWorkspace, importWorkspace, onWorkspaceListChanged, updateWorkspaceMeta, WorkspaceLoadSupersededError } from '../app/workspaceService';
import type { WorkspaceSummary } from '../app/workspaceService';
import { AppDispatch, store } from '../app/store';
import { generateUUID } from '../app/identity';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadIcon from '@mui/icons-material/Download';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CloseIcon from '@mui/icons-material/Close';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';

/** Quick enough not to feel like waiting, slow enough to read as a movement. */
const CANVAS_TRANSITION_MS = 140;

/** Generate a session ID like session_20260408_193052_a1b2 */
function generateSessionId(): string {
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const short = generateUUID().slice(0, 4);
    return `session_${date}_${time}_${short}`;
}

export const DataFormulatorFC = ({ }) => {

    const derivedTables = useSelector(dfSelectors.getDerivedTables);
    const hasInputTables = useSelector((state: DataFormulatorState) => state.inputTables.length > 0);
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const canvasTarget = useSelector(dfSelectors.selectCanvasTarget);
    const [canvasClosing, setCanvasClosing] = useState(false);
    const models = useSelector(dfSelectors.getAllModels);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const viewMode = useSelector((state: DataFormulatorState) => state.viewMode);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const identityKey = useSelector((state: DataFormulatorState) => `${state.identity.type}:${state.identity.id}`);
    const dataLoadingChatMessages = useSelector((state: DataFormulatorState) => state.dataLoadingChatMessages);
    const sessionEmpty = useSelector(dfSelectors.selectSessionEmpty);
    const theme = useTheme();

    const dispatch = useDispatch<AppDispatch>();
    const { t } = useTranslation();

    // Auto-focus removed: focus is the only thing that opens the canvas, so
    // re-focusing whenever it clears would make closing impossible. Table
    // creation focuses its own table (see `addTable`).

    // ── Connector instances (for landing page menu) ─────────────
    const [pageConnectors, setPageConnectors] = useState<ConnectorInstance[]>([]);
    const refreshPageConnectors = useCallback(() => {
        apiRequest<any>(CONNECTOR_URLS.LIST, { method: 'GET' })
            .then(({ data }) => setPageConnectors(data.connectors || []))
            .catch(() => { /* connector list is optional on landing page */ });
    }, []);
    const [connectorRefreshKey, setConnectorRefreshKey] = useState(0);
    const handleConnectorsChanged = useCallback(() => {
        setConnectorRefreshKey(k => k + 1);
        refreshPageConnectors();
    }, [refreshPageConnectors]);
    // A connector created from a non-sidebar surface (e.g. the inline
    // connection form in the data-loading chat, design 38) bumps this redux
    // counter; refresh the connector list so the new source appears.
    const connectorRefreshRequest = useSelector((state: DataFormulatorState) => state.connectorRefreshRequest);
    useEffect(() => {
        if (connectorRefreshRequest > 0) {
            handleConnectorsChanged();
        }
    }, [connectorRefreshRequest, handleConnectorsChanged]);
    useEffect(() => {
        setPageConnectors([]);
        refreshPageConnectors();
    }, [refreshPageConnectors, identityKey]);

    // ── Demo sessions (loaded from manifest, fallback to hardcoded) ─────
    const [demoSessions, setDemoSessions] = useState<ExampleSession[]>(exampleSessions);
    useEffect(() => {
        fetchExampleSessions().then(sessions => {
            if (sessions.length > 0) setDemoSessions(sessions);
        });
    }, []);

    // ── Workspace list (shown on landing page) ────────────────────
    const [savedWorkspaces, setSavedWorkspaces] = useState<WorkspaceSummary[]>([]);
    const [confirmDeleteWs, setConfirmDeleteWs] = useState<string | null>(null);

    // Inline rename: which card's title is currently being edited, and
    // its draft text. Persisted via updateWorkspaceMeta on Enter / blur;
    // reverted on Escape.
    const [renamingWs, setRenamingWs] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState<string>('');

    // Sort key for the saved-workspaces grid. Default is creation time
    // so the user's chronological list of work doesn't shuffle every
    // time a workspace is touched.
    type WsSortKey = 'created_desc' | 'created_asc' | 'updated_desc' | 'name_asc';
    const [wsSort, setWsSort] = useState<WsSortKey>('created_desc');

    const fetchWorkspaces = useCallback(async () => {
        try {
            const sessions = await listWorkspaces();
            setSavedWorkspaces(sessions);
        } catch { /* workspace list is best-effort on landing page */ }
    }, []);

    useEffect(() => {
        if (!activeWorkspace) {
            fetchWorkspaces();
        }
    }, [activeWorkspace, fetchWorkspaces]);

    useEffect(() => {
        return onWorkspaceListChanged(fetchWorkspaces);
    }, [fetchWorkspaces]);

    const handleOpenWorkspace = useCallback(async (name: string, metaDisplayName?: string) => {
        dispatch(dfActions.setSessionLoading({ loading: true, label: t('workspace.openingWorkspace') }));
        try {
            const result = await loadWorkspace(name);
            if (result) {
                const displayName = metaDisplayName || result.displayName;
                dispatch(dfActions.loadState({ ...result.state, activeWorkspace: { id: name, displayName, readOnly: result.readOnly } }));
            } else {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(), type: 'error', component: 'workspace',
                    value: t('workspace.failedToOpenWorkspace'),
                }));
            }
        } catch (error) {
            if (error instanceof WorkspaceLoadSupersededError) return;
            dispatch(dfActions.addMessages({
                timestamp: Date.now(), type: 'error', component: 'workspace',
                value: t('workspace.failedToOpenWorkspace'),
            }));
        }
        dispatch(dfActions.setSessionLoading({ loading: false }));
    }, [dispatch]);

    const handleDeleteWorkspace = useCallback(async (name: string) => {
        try {
            await deleteWorkspace(name);
            setSavedWorkspaces(prev => prev.filter(w => w.id !== name));
        } catch {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(), type: 'error',
                component: 'workspace', value: t('workspace.deleteFailed'),
            }));
        }
        setConfirmDeleteWs(null);
    }, [dispatch]);

    const startRenameWorkspace = useCallback((id: string, currentName: string) => {
        setRenamingWs(id);
        setRenameDraft(currentName);
    }, []);

    const cancelRenameWorkspace = useCallback(() => {
        setRenamingWs(null);
        setRenameDraft('');
    }, []);

    const commitRenameWorkspace = useCallback(async () => {
        const id = renamingWs;
        if (!id) return;
        const next = renameDraft.trim();
        const current = savedWorkspaces.find(w => w.id === id);
        // Bail without writing if nothing changed or the new name is empty.
        if (!current || !next || next === current.display_name) {
            cancelRenameWorkspace();
            return;
        }
        // Optimistic update first so the UI reflects the change instantly;
        // the next list refresh (via onWorkspaceListChanged) will reconcile.
        setSavedWorkspaces(prev =>
            prev.map(w => (w.id === id ? { ...w, display_name: next } : w)),
        );
        cancelRenameWorkspace();
        try {
            await updateWorkspaceMeta(id, next);
        } catch {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(), type: 'error',
                component: 'workspace', value: t('workspace.renameFailed'),
            }));
            // On failure, refetch so the UI returns to the server's truth.
            fetchWorkspaces();
        }
    }, [renamingWs, renameDraft, savedWorkspaces, cancelRenameWorkspace, dispatch, fetchWorkspaces]);

    const handleExportWorkspace = useCallback(async (id: string) => {
        try {
            const blob = await exportWorkspace(id);
            const ws = savedWorkspaces.find(w => w.id === id);
            const fileName = ws?.display_name || id;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${fileName}.zip`;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (e) {
            console.warn('Failed to export workspace:', e);
        }
    }, [savedWorkspaces]);

    const importRef = useRef<HTMLInputElement>(null);
    const handleImportWorkspace = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        dispatch(dfActions.setSessionLoading({ loading: true, label: t('workspace.importingFile', { name: file.name }) }));
        try {
            const wsName = file.name.replace(/\.zip$/, '') || 'imported';
            const wsId = generateSessionId();
            const state = await importWorkspace(file, wsId, wsName);
            const restoredName = (state as any).activeWorkspace?.displayName || wsName;
            dispatch(dfActions.loadState({ ...state, activeWorkspace: { id: wsId, displayName: restoredName } }));
        } catch (e) {
            console.warn('Failed to import workspace:', e);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(), type: 'error',
                component: 'workspace',
                value: t('workspace.importFailed'),
            }));
        }
        dispatch(dfActions.setSessionLoading({ loading: false }));
        if (importRef.current) importRef.current.value = '';
    }, [dispatch, t]);

    // Sorted view of saved workspaces. We don't mutate the underlying
    // list (the backend's response is the source of truth); we just
    // produce a re-ordered copy for rendering.
    const sortedSavedWorkspaces = useMemo(() => {
        const cmpDate = (a: string | null | undefined, b: string | null | undefined): number => {
            // Missing timestamps sort last regardless of direction so
            // legacy entries don't dominate either end of the list.
            if (!a && !b) return 0;
            if (!a) return 1;
            if (!b) return -1;
            return a.localeCompare(b);
        };
        const copy = [...savedWorkspaces];
        switch (wsSort) {
            case 'created_desc':
                return copy.sort((a, b) => cmpDate(b.created_at, a.created_at));
            case 'created_asc':
                return copy.sort((a, b) => cmpDate(a.created_at, b.created_at));
            case 'updated_desc':
                return copy.sort((a, b) => cmpDate(b.saved_at, a.saved_at));
            case 'name_asc':
                return copy.sort((a, b) =>
                    (a.display_name || '').localeCompare(b.display_name || ''),
                );
            default:
                return copy;
        }
    }, [savedWorkspaces, wsSort]);
    
    // Set up automatic refresh of derived tables when source data changes
    useDerivedTableRefresh();

    // State for unified data upload dialog
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const [uploadDialogInitialTab, setUploadDialogInitialTab] = useState<UploadTabType>('menu');

    // Loading state for sessions (from Redux, shared with App.tsx)
    const sessionLoading = useSelector((state: DataFormulatorState) => state.sessionLoading);
    const sessionLoadingLabel = useSelector((state: DataFormulatorState) => state.sessionLoadingLabel);

    const openUploadDialog = (tab: UploadTabType) => {
        if (activeWorkspace?.readOnly) return;
        // If no workspace is active, generate an ID (backend creates folder lazily on first data op)
        if (!activeWorkspace) {
            dispatch(dfActions.setActiveWorkspace({ id: generateSessionId(), displayName: 'Untitled Session' }));
        }
        // Compact mode: when opening the generic menu but a data-loading
        // conversation is already in progress, land directly on the chat so
        // the prior history (and any in-progress extractions / load plan) is
        // visible instead of the empty menu hero. Explicit tab requests
        // (connector, upload, paste, …) are respected as-is; the menu's
        // connectors / direct-load options stay one back-arrow click away.
        const resolvedTab = (tab === 'menu' && dataLoadingChatMessages.length > 0)
            ? 'extract'
            : tab;
        setUploadDialogInitialTab(resolvedTab);
        setUploadDialogOpen(true);
    };

    // The dialog needs a workspace id to talk to the backend, but opening it is
    // not entering a session: stay on the landing page until data lands.
    const provisionalSession = uploadDialogOpen && sessionEmpty;

    const closeUploadDialog = async () => {
        setUploadDialogOpen(false);
        const state = store.getState();
        const workspaceId = state.activeWorkspace?.id;
        if (workspaceId && dfSelectors.selectSessionEmpty(state)) {
            try {
                const files = await listWorkspaceFiles();
                dispatch(dfActions.setWorkspaceFileCount(files.length));
                const currentWorkspaceId = store.getState().activeWorkspace?.id;
                if (files.length === 0 && currentWorkspaceId === workspaceId) {
                    dispatch(dfActions.setActiveWorkspace(null));
                }
            } catch {
                // Preserve the workspace when its backend contents cannot be checked.
            }
        }
        refreshPageConnectors();
    };

    // Seed the Data Loading chat through the single redux `pending` slot,
    // then navigate to the extract tab. This is the one channel that
    // carries text, images, AND file attachments as first-class fields —
    // replacing the older `initialChatPrompt/Images` props that silently
    // dropped file attachments (they had no dedicated field and only
    // survived if their name was baked into the prompt text).
    const startDataLoadingChat = (text: string, images: string[] = [], attachments: string[] = []) => {
        if (text.trim().length > 0 || images.length > 0 || attachments.length > 0) {
            // Preserve any prior conversation (Option A). `queueDataLoadingTask`
            // drops a "new request" divider when a thread already exists, then
            // enqueues the submission; the user resets explicitly via the
            // header reset button when they want a blank slate.
            dispatch(dfActions.queueDataLoadingTask({ text, images, attachments }));
        }
        openUploadDialog('extract');
    };

    // The landing box starts the unified analyst conversation — loading data is
    // its first skill, so there's no separate loading chat to hand off to.
    const startAnalystChat = (text: string, images: string[] = [], attachments: string[] = []) => {
        if (activeWorkspace?.readOnly) return;
        if (text.trim().length === 0 && images.length === 0 && attachments.length === 0) return;
        // Every agent call carries X-Workspace-Id; the landing page can be used
        // before a workspace exists, so mint one the way openUploadDialog does.
        if (!activeWorkspace) {
            dispatch(dfActions.setActiveWorkspace({ id: generateSessionId(), displayName: 'Untitled Session' }));
        }
        dispatch(dfActions.queueAnalystTask({ text, images, attachments }));
    };

    const handleLoadExampleSession = async (session: ExampleSession) => {
        dispatch(dfActions.setSessionLoading({ loading: true, label: t('messages.loadingExample', { title: session.title }) }));

        dispatch(dfActions.addMessages({
            timestamp: Date.now(),
            type: 'info',
            component: 'data formulator',
            value: t('messages.loadingExample', { title: session.title }),
        }));

        try {
            // Fetch the workspace zip
            const res = await fetch(session.workspace);
            if (!res.ok) throw new Error(`Failed to fetch ${session.workspace}`);
            const blob = await res.blob();
            const file = new File([blob], `${session.id}.zip`, { type: 'application/zip' });

            // Import via the standard workspace import flow (parquet + state)
            const wsId = generateSessionId();
            // Set workspace ID first so fetchWithIdentity sends X-Workspace-Id header
            dispatch(dfActions.setActiveWorkspace({ id: wsId, displayName: session.title }));
            const state = await importWorkspace(file, wsId, session.title);
            dispatch(dfActions.loadState({ ...state, activeWorkspace: { id: wsId, displayName: session.title } }));

            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'success',
                component: 'data formulator',
                value: t('messages.loadSuccess', { title: session.title }),
            }));
        } catch (error: any) {
            console.error('Error loading session:', error);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'data formulator',
                value: t('messages.loadFailed', { title: session.title, error: error.message }),
            }));
        } finally {
            dispatch(dfActions.setSessionLoading({ loading: false }));
        }
    };

    useEffect(() => {
        document.title = toolName;
        
        // Preload imported images (public images are preloaded in index.html)
        const imagesToPreload = [
            { src: dfLogo, type: 'image/svg+xml' },
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

    // Discrete column snapping for DataThread.
    // Column geometry is defined once in ./threadLayout and shared with
    // DataThread so the pane snap points line up with the rendered columns.
    const allotmentRef = useRef<AllotmentHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const paneSizesRef = useRef<number[]>([]);

    const { widthClass, tokens } = useLayout();
    const isPhone = useMediaQuery('(max-width:699px)');
    const [phonePane, setPhonePane] = useState<'thread' | 'canvas'>('thread');
    const { width: splitWidth } = useContainerSize(containerRef);

    // The user's chosen column *count*, not a pixel width — so a window resize
    // preserves their intent instead of carrying a stale pixel value around.
    // Cleared when the width class changes, handing control back to the default.
    const [userColumns, setUserColumns] = useState<number | null>(null);
    // Read by the drag handler, which runs before `columnCap` is in scope.
    const columnCapRef = useRef(MAX_THREAD_COLUMNS);
    // Pane widths must come from the same tokens DataThread renders columns
    // with, or the snap points stop lining up with the rendered columns.
    const paneWidth = useCallback(
        (n: number) => threadPaneWidthFor(n, tokens),
        [tokens],
    );

    const nearestColumnCount = useCallback((width: number) => {
        let best = 1;
        let bestDist = Infinity;
        for (let n = 1; n <= columnCapRef.current; n++) {
            const dist = Math.abs(width - paneWidth(n));
            if (dist < bestDist) {
                bestDist = dist;
                best = n;
            }
        }
        return best;
    }, [paneWidth]);

    const snapToColumns = useCallback((sizes: number[]) => {
        if (sizes.length < 2) return;
        const columns = nearestColumnCount(sizes[0]);
        const target = paneWidth(columns);
        setUserColumns(columns);

        // A same-column drag does not change React state, so the pinning effect
        // below will not rerun. Snap the panes explicitly after Allotment has
        // finished its own drag bookkeeping.
        requestAnimationFrame(() => {
            try {
                allotmentRef.current?.resize([target, splitWidth - target]);
            } catch {
                // The pane structure may have changed while the drag ended.
            }
        });
    }, [nearestColumnCount, paneWidth, splitWidth]);

    // The thread pane only ever rests on a whole-column width. Dragging the
    // window edge changes how many columns *fit*; it never leaves the pane at
    // an arbitrary size, so the canvas absorbs the whole delta.

    // How many columns the thread could actually fill: one per leaf chain, plus
    // a slot for the source shelf. Chain-splitting can add more, so treat this
    // as a floor — it exists only to stop a wide screen reserving empty columns.
    const threadColumnDemand = useMemo(() => {
        const hasChild = new Set<string>();
        derivedTables.forEach(t => { if (t.derive) hasChild.add(t.derive.trigger.tableId); });
        const leaves = derivedTables.filter(t => !hasChild.has(t.id)).length;
        return Math.max(1, leaves + (hasInputTables ? 1 : 0));
    }, [derivedTables, hasInputTables]);

    const columnCap = maxThreadColumnsForWidth(
        splitWidth,
        tokens,
        maxThreadColumnsForWidthClass(widthClass),
    );
    columnCapRef.current = columnCap;
    const preferredColumns = Math.min(
        userColumns ?? defaultThreadColumns(widthClass, threadColumnDemand, splitWidth, tokens),
        columnCap,
    );

    // A new width class re-asserts the default; within a class the drag sticks.
    const prevWidthClassRef = useRef(widthClass);
    useEffect(() => {
        if (prevWidthClassRef.current === widthClass) return;
        prevWidthClassRef.current = widthClass;
        setUserColumns(null);
    }, [widthClass]);

    // Hold the thread pane at exactly `threadPaneWidth(preferredColumns)`.
    //
    // Runs on every split-container resize, not just on discrete events:
    //   - `preferredSize` only applies when a pane first mounts, and this pane
    //     unmounts whenever the session is empty;
    //   - Allotment otherwise redistributes a container resize across both
    //     panes, leaving the thread at an arbitrary width where the column
    //     count flips at unpredictable points.
    // Pinning it here means the canvas absorbs the entire delta and the thread
    // only ever changes in whole columns.
    // The canvas shows the focused item, and nothing else opens or closes it.
    // Resolved, not raw: a text turn with no chart or table behind it (an
    // explanation on a rootless thread) has nothing to draw, so stay closed.
    const canvasOpen = !!canvasTarget && !canvasClosing;

    useEffect(() => {
        if (!isPhone) return;
        setPhonePane(canvasTarget ? 'canvas' : 'thread');
    }, [isPhone, canvasTarget]);

    // Closing collapses the pane first and drops the focus only once it has
    // gone; clearing focus up front would swap the chart for the empty-canvas
    // gallery and slide *that* away.
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeCanvas = useCallback(() => {
        setPhonePane('thread');
        setCanvasClosing(true);
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(() => {
            closeTimerRef.current = null;
            setCanvasClosing(false);
            dispatch(dfActions.setFocused(undefined));
        }, CANVAS_TRANSITION_MS);
    }, [dispatch]);
    useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);
    useEffect(() => {
        // Something grabbed focus mid-close (a new table, say) — keep the canvas.
        if (!canvasTarget || !closeTimerRef.current) return;
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
        setCanvasClosing(false);
    }, [canvasTarget]);

    // Always armed except while dragging: arming it from an effect would land
    // after Allotment has already written the new widths, so nothing would ease.
    const [sashDragging, setSashDragging] = useState(false);

    useEffect(() => {
        // With the canvas hidden the thread owns the whole split, so there is
        // nothing to pin and resize([a, b]) would fight the visibility change.
        if (!canvasOpen) return;
        if (!allotmentRef.current || splitWidth <= 0) return;

        const target = paneWidth(preferredColumns);
        // Defer both the measurement and correction until Allotment has
        // processed the new container size. Checking before this frame can
        // see the old snapped width and skip just before Allotment moves it.
        const rafId = requestAnimationFrame(() => {
            try {
                if (splitWidth - target < tokens.canvas.min) return;
                if (Math.abs((paneSizesRef.current[0] ?? -1) - target) <= 1) return;
                allotmentRef.current?.resize([target, splitWidth - target]);
            } catch {
                // Allotment pane structure may not yet match; ignore.
            }
        });
        return () => cancelAnimationFrame(rafId);
    }, [canvasOpen, preferredColumns, splitWidth, tokens.canvas.min]);

    const threadPanel = (
        <DataThread centered={!canvasOpen} denseColumns={isPhone} sx={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            alignContent: 'flex-start',
            height: '100%',
        }}/>
    );

    const canvasPanel = (
        <Box sx={{
            ...(isPhone ? {} : borderBoxStyle),
            height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxSizing: 'border-box', position: 'relative',
        }}>
            <Tooltip title={t('canvas.close', { defaultValue: 'Close canvas' })}>
                <IconButton
                    size="small"
                    onClick={closeCanvas}
                    sx={{
                        position: 'absolute', top: 8, right: 8, zIndex: 20,
                        color: 'text.secondary',
                        '&:hover': { color: 'text.primary', backgroundColor: 'action.hover' },
                    }}
                >
                    <CloseIcon sx={{ fontSize: iconVar.md }} />
                </IconButton>
            </Tooltip>
            {viewMode === 'editor' ? visPane : <ReportView />}
        </Box>
    );

    const phoneWorkspace = (
        <Box sx={{ display: 'flex', height: '100%', minWidth: 0 }}>
            <DataSourceSidebar
                onOpenUploadDialog={(tab) => openUploadDialog((tab ?? 'menu') as UploadTabType)}
                connectorRefreshKey={connectorRefreshKey}
                onConnectorsChanged={handleConnectorsChanged}
                onStartDataLoadingChat={(text) => startDataLoadingChat(text)}
            />
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <Tabs
                    value={phonePane}
                    onChange={(_, value: 'thread' | 'canvas') => setPhonePane(value)}
                    variant="fullWidth"
                    sx={{
                        minHeight: 36,
                        bgcolor: 'background.paper',
                        borderTop: `1px solid ${borderColor.view}`,
                        borderBottom: `1px solid ${borderColor.view}`,
                        '& .MuiTab-root': { minHeight: 36, py: 0.5, fontSize: textVar.sm, textTransform: 'none' },
                    }}
                >
                    <Tab value="thread" label={t('mobile.thread', { defaultValue: 'Thread' })} />
                    <Tab value="canvas" label={t('mobile.canvas', { defaultValue: 'Canvas' })} disabled={!canvasTarget} />
                </Tabs>
                <Box sx={{
                    flex: 1, minHeight: 0, overflow: 'hidden',
                    p: phonePane === 'thread' ? 0.5 : 0,
                }}>
                    {phonePane === 'canvas' && canvasTarget ? canvasPanel : threadPanel}
                </Box>
            </Box>
        </Box>
    );

    const fixedSplitPane = ( 
        <Box sx={{display: 'flex', flexDirection: 'row', height: '100%'}}>
            <DataSourceSidebar
                onOpenUploadDialog={(tab) => openUploadDialog((tab ?? 'menu') as UploadTabType)}
                connectorRefreshKey={connectorRefreshKey}
                onConnectorsChanged={handleConnectorsChanged}
                onStartDataLoadingChat={(text) => startDataLoadingChat(text)}
            />
            <Box ref={containerRef} className="outer-allotment" sx={{
                    margin: '4px 8px 8px 8px', backgroundColor: 'white',
                    display: 'flex', height: 'calc(100% - 12px)', flex: 1, minWidth: 0, flexDirection: 'column',
                    overflow: 'hidden',
                    position: 'relative',
                    // Allotment waits 300ms before adding its hover class.
                    // Native hover responds immediately with the app's fast token.
                    '& [class*="sash_"][class*="vertical"]::before': {
                        transition: `${transition.fast} !important`,
                    },
                    '& [class*="sash_"][class*="vertical"]:hover::before': {
                        background: 'var(--focus-border)',
                    },
                    // Allotment lays out with `left` + `width`, so both must ease
                    // or the panes resize while their positions jump. Suspended
                    // mid-drag, where easing would lag the cursor.
                    ...(sashDragging ? {} : {
                        '& .split-view-view, & [class*="sash_"]': {
                            transition: `left ${CANVAS_TRANSITION_MS}ms ease, width ${CANVAS_TRANSITION_MS}ms ease`,
                        },
                    }),
                }}>
                <Allotment
                    ref={allotmentRef}
                    onChange={(sizes) => { paneSizesRef.current = sizes; }}
                    onDragStart={() => setSashDragging(true)}
                    onDragEnd={(sizes) => { setSashDragging(false); snapToColumns(sizes); }}
                    proportionalLayout={false}
                >
                    <Allotment.Pane minSize={paneWidth(1)} 
                            preferredSize={paneWidth(preferredColumns)} 
                            // Uncapped with the canvas away, so the thread can take
                            // the whole surface. Must be an explicit Infinity:
                            // Allotment skips `undefined` and keeps the old cap.
                            maxSize={canvasOpen ? paneWidth(columnCap) : Number.POSITIVE_INFINITY} snap={false}>
                        {threadPanel}
                    </Allotment.Pane>
                    <Allotment.Pane minSize={tokens.canvas.min} visible={canvasOpen}>
                        {canvasPanel}
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
        <Typography sx={{ display: 'inline', fontSize: textVar.sm, ml: 1 }}> @ {new Date().getFullYear()}</Typography>
    </Box>

    let dataUploadRequestBox = <Box sx={{
            margin: '4px 4px 4px 8px', 
            background: `
                linear-gradient(90deg, ${alpha(theme.palette.text.primary, 0.025)} 1px, transparent 1px),
                linear-gradient(0deg, ${alpha(theme.palette.text.primary, 0.025)} 1px, transparent 1px)
            `,
            backgroundSize: '16px 16px',
            flex: 1, minWidth: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', height: '100%',
        }}>
        <Box sx={{mx:'auto', pb: 8, display: "flex", flexDirection: "column", textAlign: "center", maxWidth: 1024, width: '100%', px: 2, boxSizing: 'border-box' }}>
            {/* Hero — fills the viewport so title + input own the first screen;
                Demos/Sessions live below the fold and just peek up. */}
            <Box sx={{ minHeight: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Box sx={{ mx: 'auto' }}>
                <Typography sx={{
                    fontSize: { xs: 28, sm: 76 },
                    lineHeight: 1.05,
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                }}>
                    {toolName}
                </Typography>
            </Box>
            <Box sx={{
                display: { xs: 'none', sm: 'flex' },
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                mt: 1.25,
            }}>
                <Box
                    component="img"
                    src={dfLogo}
                    alt=""
                    sx={{ width: 25, height: 23, flexShrink: 0, display: 'block', transform: 'translateY(-2px)' }}
                />
                <Typography sx={{
                    fontSize: 21,
                    color: alpha(theme.palette.text.primary, 0.7),
                    lineHeight: 1.4,
                    textAlign: 'center',
                }}>
                    {t('landing.tagline')}
                </Typography>
            </Box>

            {/* Hosted-demo notice — borderless strip (it's prose, not a
                button) placed before the Import Data section. The rocket
                gets a quiet lift to add a touch of life. */}
            {serverConfig.DISABLE_DATA_CONNECTORS && (
                <Box
                    sx={{
                        mt: 2,
                        mx: 'auto',
                        maxWidth: 760,
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.25,
                        px: 0.5,
                        py: 0.5,
                        // Sparkle emoji twinkle. Modern browsers' filter:
                        // drop-shadow honours the emoji's alpha channel,
                        // so a small-radius shadow hugs the actual glyph
                        // outline rather than a square box. We keep the
                        // radius tight (1–2px) and the alpha modest so
                        // the halo reads as a glow on the sparkle, not
                        // a rectangle behind it.
                        '& .df-sparkle': {
                            display: 'inline-block',
                            fontSize: textVar.xxl,
                            lineHeight: 1,
                            animation: 'df-sparkle-twinkle 3.6s ease-in-out infinite',
                            transformOrigin: 'center',
                        },
                        '@keyframes df-sparkle-twinkle': {
                            '0%, 100%': {
                                transform: 'scale(1) rotate(0deg)',
                                filter: 'drop-shadow(0 0 0 rgba(255,200,80,0))',
                            },
                            '40%': {
                                transform: 'scale(1.2) rotate(20deg)',
                                filter: 'drop-shadow(0 0 2px rgba(255,200,80,0.85)) drop-shadow(0 0 1px rgba(255,180,40,0.6))',
                            },
                            '60%': {
                                transform: 'scale(1.05) rotate(-10deg)',
                                filter: 'drop-shadow(0 0 1px rgba(255,200,80,0.5))',
                            },
                        },
                    }}
                >
                    <Box
                        component="span"
                        className="df-sparkle"
                        role="img"
                        aria-label="sparkles"
                        sx={{ flexShrink: 0 }}
                    >
                        ✨
                    </Box>
                    <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary', fontSize: textVar.sm, lineHeight: 1.5, flex: 1 }}
                    >
                        {t('landing.demoBannerBody', {
                            defaultValue:
                                'This is a demo site! Try the examples below or upload files. To work with large datasets, connect to databases, link local folders, create persisted analysis sessions, use custom models, and manage users, check the ',
                        })}
                        <Link
                            href="https://github.com/microsoft/data-formulator"
                            target="_blank"
                            rel="noopener noreferrer"
                            underline="hover"
                            sx={{
                                color: 'primary.main',
                                '&:hover': { color: 'primary.dark' },
                            }}
                        >
                            <GitHubIcon
                                sx={{
                                    fontSize: '1em',
                                    verticalAlign: '-0.15em',
                                    mr: 0.4,
                                }}
                            />
                            {t('landing.demoBannerCta', { defaultValue: 'installation guide' })}
                        </Link>
                        {t('landing.demoBannerSuffix', { defaultValue: '.' })}
                    </Typography>
                </Box>
            )}

            <Box sx={{ mt: 5 }}>
                <DataLoadMenu 
                    onSelectTab={(tab) => openUploadDialog(tab)}
                    onSelectConnector={(conn) => {
                        // Already-authed connector → open the data-source
                        // sidebar focused on it. Otherwise open the upload
                        // dialog at the connector's auth/connect tab.
                        if (conn.connected || conn.sso_auto_connect) {
                            dispatch(dfActions.focusConnector(conn.id));
                        } else {
                            openUploadDialog(`connector:${conn.id}` as UploadTabType);
                        }
                    }}
                    onStartChat={(prompt, images, attachments) => startAnalystChat(prompt, images, attachments)}
                    hasPriorConversation={dataLoadingChatMessages.length > 0}
                    onResumeChat={() => openUploadDialog('extract')}
                    serverConfig={serverConfig}
                    connectors={pageConnectors}
                />
            </Box>
            </Box>

            {/* Demos — promoted ahead of "Your Sessions" on the hosted
                demo, since first-time visitors won't have any sessions
                yet and demos are the most engaging entry point. */}
            <Box sx={{mt: 3}}>
                <Typography sx={{ color: alpha(theme.palette.text.primary, 0.56), fontSize: textVar.sm, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', textAlign: 'left', mb: 2 }}>
                    {t('landing.demos')}
                </Typography>
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: 1.5,
                }}>
                    {demoSessions.map((session) => (
                        <ExampleSessionCard
                            key={session.id}
                            session={session}
                            onClick={() => handleLoadExampleSession(session)}
                        />
                    ))}
                </Box>
            </Box>

            {/* ── Saved workspaces section ──────────────────────────── */}
            <Box sx={{mt: 8}}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 2 }}>
                    <Typography sx={{ color: alpha(theme.palette.text.primary, 0.56), fontSize: textVar.sm, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                        {t('workspace.yourSessions')}
                    </Typography>
                    <Select
                        size="small"
                        variant="standard"
                        value={wsSort}
                        onChange={(e) => setWsSort(e.target.value as typeof wsSort)}
                        disableUnderline
                        inputProps={{ 'aria-label': t('workspace.sortSessions') }}
                        IconComponent={(props) => (
                            <ExpandMoreIcon {...props} sx={{ fontSize: iconVar.md, color: 'text.disabled', right: 0 }} />
                        )}
                        sx={{
                            fontSize: textVar.sm,
                            color: 'text.disabled',
                            cursor: 'pointer',
                            '& .MuiSelect-select': { py: 0.25, pl: 0, pr: '16px !important', minHeight: 0 },
                            '&:hover': { color: 'text.secondary' },
                            '&:hover .MuiSelect-icon': { color: 'text.secondary' },
                        }}
                        renderValue={(v) => {
                            const labels: Record<typeof wsSort, string> = {
                                created_desc: t('workspace.sortNewest'),
                                created_asc: t('workspace.sortOldest'),
                                updated_desc: t('workspace.sortRecentlyModified'),
                                name_asc: t('workspace.sortName'),
                            };
                            return labels[v as typeof wsSort];
                        }}
                    >
                        <MenuItem value="created_desc" sx={{ fontSize: textVar.sm }}>{t('workspace.sortNewestFirst')}</MenuItem>
                        <MenuItem value="created_asc" sx={{ fontSize: textVar.sm }}>{t('workspace.sortOldestFirst')}</MenuItem>
                        <MenuItem value="updated_desc" sx={{ fontSize: textVar.sm }}>{t('workspace.sortRecentlyModifiedFirst')}</MenuItem>
                        <MenuItem value="name_asc" sx={{ fontSize: textVar.sm }}>{t('workspace.sortNameAsc')}</MenuItem>
                    </Select>
                </Box>
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: 1.5,
                }}>
                    {sortedSavedWorkspaces.map(w => {
                        const isRenaming = renamingWs === w.id;
                        return (
                        <Card key={w.id} variant="outlined" onClick={isRenaming ? undefined : () => handleOpenWorkspace(w.id, w.display_name)} sx={{
                            position: 'relative', textAlign: 'left',
                            cursor: isRenaming ? 'default' : 'pointer',
                            '&:hover': isRenaming ? {} : { transform: 'translateY(-2px)', backgroundColor: 'action.hover' },
                            '&:hover .ws-actions': { opacity: 1 },
                        }}>
                            <CardContent sx={{ py: 1.5, px: 2 }}>
                                {isRenaming ? (
                                    <TextField
                                        autoFocus
                                        fullWidth
                                        variant="standard"
                                        value={renameDraft}
                                        onChange={(e) => setRenameDraft(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        onBlur={commitRenameWorkspace}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                commitRenameWorkspace();
                                            } else if (e.key === 'Escape') {
                                                e.preventDefault();
                                                cancelRenameWorkspace();
                                            }
                                        }}
                                        slotProps={{ input: { sx: { fontSize: textVar.lg, fontWeight: 500 } } }}
                                    />
                                ) : (
                                    <Typography variant="body2" fontWeight={500} noWrap sx={{ color: 'text.primary' }}>
                                        {w.display_name}
                                    </Typography>
                                )}
                                {w.saved_at && (
                                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: textVar.xs }}>
                                        {new Date(w.saved_at).toLocaleString()}
                                    </Typography>
                                )}
                            </CardContent>
                            <Box className="ws-actions" sx={{
                                position: 'absolute', top: 4, right: 4,
                                display: isRenaming ? 'none' : 'flex',
                                gap: 0.25,
                                opacity: 0,
                                transition: 'opacity 0.15s',
                            }}>
                                <Tooltip title={t('workspace.rename')}>
                                    <IconButton size="small" sx={{ color: 'text.secondary', backgroundColor: 'rgba(255,255,255,0.85)', '&:hover': { backgroundColor: 'rgba(240,240,240,0.95)' } }}
                                        onClick={(e) => { e.stopPropagation(); startRenameWorkspace(w.id, w.display_name); }}>
                                        <EditOutlinedIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title={t('workspace.export')}>
                                    <IconButton size="small" sx={{ color: 'text.secondary', backgroundColor: 'rgba(255,255,255,0.85)', '&:hover': { backgroundColor: 'rgba(240,240,240,0.95)' } }}
                                        onClick={(e) => { e.stopPropagation(); handleExportWorkspace(w.id); }}>
                                        <DownloadIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title={t('workspace.delete')}>
                                    <IconButton size="small" sx={{ color: 'text.secondary', backgroundColor: 'rgba(255,255,255,0.85)', '&:hover': { backgroundColor: 'rgba(240,240,240,0.95)' } }}
                                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteWs(w.id); }}>
                                        <DeleteOutlineIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </Box>
                        </Card>
                        );
                    })}
                    {/* Import workspace card */}
                    <Card variant="outlined" onClick={() => importRef.current?.click()} sx={{
                        textAlign: 'center', borderStyle: 'dashed',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: 1, px: 2, py: 1.5,
                        '&:hover': { transform: 'translateY(-2px)', backgroundColor: 'action.hover' },
                    }}>
                        <UploadFileIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
                        <Typography variant="caption" color="text.secondary">{t('workspace.importZip')}</Typography>
                        <input type="file" hidden accept=".zip" ref={importRef} onChange={handleImportWorkspace} />
                    </Card>
                </Box>
            </Box>
            {/* ── Delete workspace confirmation ────────────────────── */}
            <Dialog open={confirmDeleteWs !== null} onClose={() => setConfirmDeleteWs(null)}>
                <DialogTitle>{t('workspace.deleteTitle')}</DialogTitle>
                <DialogContent>
                    <Typography dangerouslySetInnerHTML={{
                        __html: t('workspace.deleteConfirm', {
                            name: savedWorkspaces.find(w => w.id === confirmDeleteWs)?.display_name || confirmDeleteWs,
                            id: confirmDeleteWs,
                            interpolation: { escapeValue: false },
                        }),
                    }} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDeleteWs(null)}>{t('workspace.cancel')}</Button>
                    <Button color="error" onClick={() => confirmDeleteWs && handleDeleteWorkspace(confirmDeleteWs)}>
                        {t('workspace.delete')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
        {footer}
    </Box>;
    
    return (
        <Box sx={{ display: 'block', width: "100%", height: '100%', position: 'relative' }}>
            {activeWorkspace?.readOnly && (
                <Alert severity="warning" sx={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 1200, maxWidth: 720 }}>
                    {t('workspace.expiredReadOnly', 'This temporary session has expired on the server. You are viewing a read-only browser snapshot.')}
                </Alert>
            )}
            <DndProvider backend={HTML5Backend}>
                {activeWorkspace && !provisionalSession ? (isPhone ? phoneWorkspace : fixedSplitPane) : (
                    <Box sx={{ display: 'flex', flexDirection: 'row', height: '100%' }}>
                        <DataSourceSidebar
                            onOpenUploadDialog={(tab) => openUploadDialog((tab ?? 'menu') as UploadTabType)}
                            connectorRefreshKey={connectorRefreshKey}
                            onConnectorsChanged={handleConnectorsChanged}
                            onStartDataLoadingChat={(text) => startDataLoadingChat(text)}
                        />
                        {dataUploadRequestBox}
                    </Box>
                )}
                <UnifiedDataUploadDialog 
                    open={uploadDialogOpen}
                    onClose={closeUploadDialog}
                    initialTab={uploadDialogInitialTab}
                    onConnectorsChanged={handleConnectorsChanged}
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
                    <AnvilLoader
                        height="100%"
                        label={sessionLoadingLabel || t('session.loadingSessions')}
                        action={(
                            <Button
                                variant="text"
                                size="small"
                                onClick={() => dispatch(dfActions.setSessionLoading({ loading: false }))}
                                sx={{ minWidth: 0, px: 0.5, textTransform: 'none', color: 'text.secondary' }}
                            >
                                {t('app.cancel')}
                            </Button>
                        )}
                        sx={{ width: '100%' }}
                    />
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
                            <Typography variant="h4" sx={{mt: 3, fontSize: 28, letterSpacing: '0.02em'}}>
                                {t('landing.firstSelectModelPrefix')} <ModelSelectionButton appearance="inline" />
                            </Typography>
                            <Typography color="text.secondary" variant="body1" sx={{mt: 2, width: 600}}>{t('landing.modelTip')}</Typography>
                        </Box>
                        {footer}
                    </Box>
                )}
            </DndProvider>
        </Box>);
}