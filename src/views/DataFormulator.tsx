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
    Alert,
    Tabs,
    Tab,
} from '@mui/material';
import { borderColor, radius, transition } from '../app/tokens';


import { VisualizationViewFC } from './VisualizationView';
import { AnvilLoader } from '../components/AnvilLoader';

import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { getToolName } from '../app/App';
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
import { UnifiedDataUploadDialog, UploadTabType, ConnectorInstance } from './UnifiedDataUploadDialog';
import { LandingDataEntry } from './LandingDataEntry';
import { ReportView } from './ReportView';
import { DataSourceSidebar, SessionsDialog } from './DataSourceSidebar';
import GitHubIcon from '@mui/icons-material/GitHub';
import { ExampleSession, exampleSessions, ExampleSessionCard, fetchExampleSessions, publishExampleSession, usePublishedExamples } from './ExampleSessions';
import { WorkflowPanel, WorkflowRunObserver } from './WorkflowPanel';
import { listWorkflowLibrary, SchedulesPanel, useScheduleLibrary } from './WorkflowSchedules';
import { useDataRefresh, useDerivedTableRefresh } from '../app/useDataRefresh';
import { useTranslation } from 'react-i18next';
import { fetchWithIdentity, getUrls, CONNECTOR_URLS } from '../app/utils';
import { apiRequest } from '../app/apiClient';
import { handleApiError } from '../app/errorHandler';
import { listWorkspaceFiles, listWorkspaces, deleteWorkspace, exportWorkspace, importWorkspace, onWorkspaceListChanged, updateWorkspaceMeta } from '../app/workspaceService';
import type { WorkspaceSummary } from '../app/workspaceService';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import { AppDispatch, store } from '../app/store';
import { generateWorkspaceId, ensureActiveWorkspace, openSession } from '../app/sessionThunks';
import { ItemCard, ItemCardAction, itemCardGridSx } from '../components/ItemCard';
import IconButton from '@mui/material/IconButton';
import { ArtifactDeleteButton } from './DataThreadCards';
import DownloadIcon from '@mui/icons-material/Download';
import PublishOutlinedIcon from '@mui/icons-material/PublishOutlined';
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
const INITIAL_SESSION_COUNT = 12;

type LibraryTab = 'sessions' | 'workflows' | 'schedules';

/** The landing page's saved-item tabs. Tab state lives here so switching re-renders only this section. */
const LandingLibrary: React.FC<{ sessionsToolbar: React.ReactNode; sessions: React.ReactNode;
    workflowsToolbar: React.ReactNode; workflows: React.ReactNode; onOpenSession: (id: string) => void }>
    = ({ sessionsToolbar, sessions, workflowsToolbar, workflows, onOpenSession }) => {
    const { t } = useTranslation();
    const [tab, setTab] = useState<LibraryTab>('sessions');
    const [scheduleToolbar, setScheduleToolbar] = useState<HTMLElement | null>(null);
    return <>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 2, rowGap: 1, mt: 3, mb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={tab} onChange={(_, value) => setTab(value)} aria-label="Saved items"
                slotProps={{ indicator: { sx: { transition: 'left 120ms ease, width 120ms ease' } } }}
                sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, px: 1, fontSize: textVar.sm, fontWeight: 400, textTransform: 'none' },
                    '& .MuiTouchRipple-root': { display: 'none' } }}>
                <Tab id="home-sessions-tab" value="sessions" label={t('workspace.yourSessions')} aria-controls="home-sessions-panel" />
                <Tab id="home-workflows-tab" value="workflows" label={t('workspace.yourWorkflows', { defaultValue: 'Your workflows' })} aria-controls="home-workflows-panel" />
                <Tab id="home-schedules-tab" value="schedules" label={t('workspace.yourSchedules', { defaultValue: 'Your schedules' })} aria-controls="home-schedules-panel" />
            </Tabs>
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                {tab === 'schedules' ? <Box ref={setScheduleToolbar} sx={{ display: 'flex', alignItems: 'center', gap: 1 }} />
                    : tab === 'workflows' ? workflowsToolbar : sessionsToolbar}
            </Box>
        </Box>
        <Box role="tabpanel" id="home-sessions-panel" aria-labelledby="home-sessions-tab" hidden={tab !== 'sessions'}>{sessions}</Box>
        <Box role="tabpanel" id="home-workflows-panel" aria-labelledby="home-workflows-tab" hidden={tab !== 'workflows'}>{workflows}</Box>
        <Box role="tabpanel" id="home-schedules-panel" aria-labelledby="home-schedules-tab" hidden={tab !== 'schedules'}>
            <SchedulesPanel presentation="landing" toolbarContainer={scheduleToolbar} onOpenSession={onOpenSession} />
        </Box>
    </>;
};

export const DataFormulatorFC = ({ }) => {

    const derivedTables = useSelector(dfSelectors.getDerivedTables);
    const hasInputTables = useSelector((state: DataFormulatorState) => state.inputTables.length > 0);
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const inSession = useSelector(dfSelectors.selectInSession);
    const canvasTarget = useSelector(dfSelectors.selectCanvasTarget);
    const [canvasClosing, setCanvasClosing] = useState(false);
    const models = useSelector(dfSelectors.getAllModels);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const viewMode = useSelector((state: DataFormulatorState) => state.viewMode);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const canSchedule = !!serverConfig?.IS_LOCAL_MODE;
    const appName = getToolName(serverConfig.APP_NAME);
    const headingSize = Math.max(32, Math.min(76, 76 * Math.sqrt(15 / appName.length)));
    const identityKey = useSelector((state: DataFormulatorState) => `${state.identity.type}:${state.identity.id}`);
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

    // What the user already has, so landing quick actions can suggest the next step.
    const landingSchedules = useScheduleLibrary(canSchedule && !inSession);
    const [hasUserWorkflows, setHasUserWorkflows] = useState(false);
    useEffect(() => {
        if (inSession) return;
        listWorkflowLibrary().then(items => setHasUserWorkflows(items.some(item => (item.origin || 'user') === 'user')))
            .catch(() => setHasUserWorkflows(false));
    }, [inSession, identityKey]);

    // ── Demo sessions (loaded from manifest, fallback to hardcoded) ─────
    const [demoSessions, setDemoSessions] = useState<ExampleSession[]>(exampleSessions);
    useEffect(() => {
        fetchExampleSessions().then(sessions => {
            if (sessions.length > 0) setDemoSessions(sessions);
        });
    }, []);

    // ── Workspace list (shown on landing page) ────────────────────
    const [savedWorkspaces, setSavedWorkspaces] = useState<WorkspaceSummary[]>([]);
    const [allSessionsOpen, setAllSessionsOpen] = useState(false);
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
        if (!inSession) {
            fetchWorkspaces();
            const refresh = () => { if (document.visibilityState === 'visible') void fetchWorkspaces(); };
            document.addEventListener('visibilitychange', refresh);
            return () => document.removeEventListener('visibilitychange', refresh);
        }
    }, [inSession, fetchWorkspaces]);

    useEffect(() => {
        return onWorkspaceListChanged(fetchWorkspaces);
    }, [fetchWorkspaces]);

    const handleOpenWorkspace = useCallback(async (name: string, metaDisplayName?: string) => {
        await dispatch(openSession(name, metaDisplayName));
    }, [dispatch]);

    /** Administrators add a session to everyone's Example sessions; opening it imports a copy. */
    const handlePublishExample = useCallback(async (id: string, title: string) => {
        try {
            await publishExampleSession(id, title);
            dispatch(dfActions.addMessages({ timestamp: Date.now(), type: 'success', component: 'workspace',
                value: t('workspace.publishedExample', { defaultValue: 'Published "{{title}}" as an example session.', title }) }));
        } catch (error) {
            handleApiError(error, 'Publish example session');
        }
    }, [dispatch, t]);

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
            const wsId = generateWorkspaceId();
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
    const publishedExamples = usePublishedExamples(!inSession);

    const workspaceCard = (w: WorkspaceSummary, onOpened?: () => void) =>
        <ItemCard key={w.id} title={w.display_name} onOpen={() => { onOpened?.(); void handleOpenWorkspace(w.id, w.display_name); }}
            rename={renamingWs === w.id ? { value: renameDraft, label: t('workspace.rename'), onChange: setRenameDraft,
                onCommit: commitRenameWorkspace, onCancel: cancelRenameWorkspace } : undefined}
            captions={[
                w.scheduled_run && !w.scheduled_run.forked && <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', mt: 0.5 }}
                    title={`${w.scheduled_run.scheduleName}: ${new Date(w.scheduled_run.scheduledFor).toLocaleString()}`}>
                    <ScheduleOutlinedIcon sx={{ fontSize: iconVar.sm }} />Scheduled run
                </Box>,
                w.saved_at && new Date(w.saved_at).toLocaleString(),
            ]}
            actions={w.read_only ? undefined : <>
                <ItemCardAction label={t('workspace.rename')} icon={<EditOutlinedIcon />}
                    onClick={() => startRenameWorkspace(w.id, w.display_name)} />
                <ItemCardAction label={t('workspace.export')} icon={<DownloadIcon />} onClick={() => handleExportWorkspace(w.id)} />
                {serverConfig?.CAN_CONFIGURE && <ItemCardAction label={t('workspace.publishExample', { defaultValue: 'Publish as example' })}
                    icon={<PublishOutlinedIcon />} onClick={() => void handlePublishExample(w.id, w.display_name)} />}
                <ArtifactDeleteButton label={t('workspace.delete')} onClick={() => setConfirmDeleteWs(w.id)} />
            </>} />;
    
    // Set up automatic refresh of derived tables when source data changes
    useDerivedTableRefresh();

    // State for unified data upload dialog
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const [uploadDialogInitialTab, setUploadDialogInitialTab] = useState<UploadTabType>('menu');
    const [uploadDialogTablePath, setUploadDialogTablePath] = useState<string[] | undefined>();

    // Loading state for sessions (from Redux, shared with App.tsx)
    const sessionLoading = useSelector((state: DataFormulatorState) => state.sessionLoading);
    const sessionLoadingLabel = useSelector((state: DataFormulatorState) => state.sessionLoadingLabel);

    const openUploadDialog = (tab: UploadTabType, tablePath?: string[]) => {
        if (activeWorkspace?.readOnly) return;
        // The dialog talks to the backend, so it needs a workspace ID — but
        // opening it is not entering a session. It stays provisional (landing
        // page) until data lands.
        dispatch(ensureActiveWorkspace());
        setUploadDialogInitialTab(tab);
        setUploadDialogTablePath(tablePath);
        setUploadDialogOpen(true);
    };

    const closeUploadDialog = async () => {
        setUploadDialogOpen(false);
        const state = store.getState();
        const workspaceId = state.activeWorkspace?.id;
        // Non-table files saved from the dialog only show up in the file
        // count; refresh it so a file-only upload still enters the session.
        if (workspaceId && dfSelectors.selectSessionEmpty(state)) {
            try {
                const files = await listWorkspaceFiles();
                if (store.getState().activeWorkspace?.id === workspaceId) {
                    dispatch(dfActions.setWorkspaceFileCount(files.length));
                }
            } catch {
                // The count is refreshed again when the thread mounts.
            }
        }
        refreshPageConnectors();
    };

    // The landing box starts the unified analyst conversation — loading data is
    // its first skill, so there's no separate loading chat to hand off to.
    const startAnalystChat = (text: string, images: string[] = [], attachments: string[] = []) => {
        if (activeWorkspace?.readOnly) return;
        if (text.trim().length === 0 && images.length === 0 && attachments.length === 0) return;
        // Every agent call carries X-Workspace-Id; queuing the task below is
        // what turns the provisional workspace into a session.
        dispatch(ensureActiveWorkspace());
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
            const res = await fetchWithIdentity(session.workspace);
            if (!res.ok) throw new Error(`Failed to fetch ${session.workspace}`);
            const blob = await res.blob();
            const file = new File([blob], `${session.id}.zip`, { type: 'application/zip' });

            // Import via the standard workspace import flow (parquet + state)
            const wsId = generateWorkspaceId();
            // Set workspace ID first so fetchWithIdentity sends X-Workspace-Id
            // header; provisional so a failed import stays on the landing page.
            dispatch(dfActions.setActiveWorkspace({ id: wsId, displayName: session.title, provisional: true }));
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
                onOpenUploadDialog={(tab, tablePath) => openUploadDialog((tab ?? 'menu') as UploadTabType, tablePath)}
                connectorRefreshKey={connectorRefreshKey}
                onConnectorsChanged={handleConnectorsChanged}
                onAskAgent={(text) => startAnalystChat(text)}
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
                onOpenUploadDialog={(tab, tablePath) => openUploadDialog((tab ?? 'menu') as UploadTabType, tablePath)}
                connectorRefreshKey={connectorRefreshKey}
                onConnectorsChanged={handleConnectorsChanged}
                onAskAgent={(text) => startAnalystChat(text)}
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
                    <Allotment.Pane key="thread" minSize={paneWidth(1)} 
                            preferredSize={paneWidth(preferredColumns)} 
                            // Uncapped with the canvas away, so the thread can take
                            // the whole surface. Must be an explicit Infinity:
                            // Allotment skips `undefined` and keeps the old cap.
                            maxSize={canvasOpen ? paneWidth(columnCap) : Number.POSITIVE_INFINITY} snap={false}>
                        {threadPanel}
                    </Allotment.Pane>
                    {canvasTarget && (
                        <Allotment.Pane key="canvas" minSize={tokens.canvas.min} visible={canvasOpen}>
                            {canvasPanel}
                        </Allotment.Pane>
                    )}
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
            <Box sx={{ mx: 'auto', width: '100%', minWidth: 0 }}>
                <Typography component="h1" sx={{
                    fontSize: { xs: 28, sm: headingSize },
                    lineHeight: 1.05,
                    letterSpacing: 0,
                    overflowWrap: 'anywhere',
                    textWrap: 'balance',
                }}>
                    {appName}
                </Typography>
            </Box>
            <Box sx={{
                display: 'flex',
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
                    fontSize: { xs: 16, sm: 21 },
                    color: alpha(theme.palette.text.primary, 0.7),
                    lineHeight: 1.4,
                    textAlign: 'center',
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                    whiteSpace: 'pre-line',
                }}>
                    {serverConfig.APP_TAGLINE || t('landing.tagline')}
                </Typography>
            </Box>

            {/* Hosted-demo notice — borderless strip (it's prose, not a
                button) placed before the Import Data section. The rocket
                gets a quiet lift to add a touch of life. */}
            {serverConfig.WORKSPACE_BACKEND === 'ephemeral' && (
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
                <LandingDataEntry
                    onStartChat={startAnalystChat}
                    ensureActiveWorkspace={() => dispatch(ensureActiveWorkspace())}
                    onUpload={() => openUploadDialog('upload')}
                    onConnect={serverConfig.DISABLE_DATA_CONNECTORS ? undefined : () => openUploadDialog('add-connection')}
                    onLinkFolder={serverConfig?.IS_LOCAL_MODE && !serverConfig.DISABLE_DATA_CONNECTORS ? () => openUploadDialog('local-folder') : undefined}
                    readOnly={activeWorkspace?.readOnly}
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
                    connectors={pageConnectors}
                    quickActionContext={{
                        hasUserSources: pageConnectors.some(conn => (conn.connected || conn.sso_auto_connect) && conn.id !== 'sample_datasets'),
                        hasSessions: savedWorkspaces.some(w => !w.scheduled_run),
                        hasWorkflows: hasUserWorkflows,
                        canSchedule,
                        hasSchedules: landingSchedules.schedules.length > 0,
                    }}
                />
            </Box>
            </Box>

            <WorkflowPanel presentation="landing" onCreateSession={displayName => {
                dispatch(dfActions.resetForNewWorkspace({ id: generateWorkspaceId(), displayName }));
            }} renderLanding={({ examples, saved, toolbar }) => <Box data-home-library sx={{ mt: 3 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 4, alignItems: 'start' }}>
            <Box component="section" aria-label={t('landing.exampleSessions', { defaultValue: 'Example sessions' })} sx={{ minWidth: 0 }}>
                <Typography component="h2" sx={{ fontSize: textVar.xl, fontWeight: 400, textAlign: 'left', minHeight: 40, display: 'flex', alignItems: 'center', mb: 1.5 }}>
                    {t('landing.exampleSessions', { defaultValue: 'Example sessions' })}
                </Typography>
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
                    gap: 1.5,
                }}>
                    {publishedExamples.map(session => <ExampleSessionCard key={session.id} session={session}
                        onClick={() => void handleLoadExampleSession(session)} />)}
                    {demoSessions.map((session) => (
                        <ExampleSessionCard
                            key={session.id}
                            session={session}
                            onClick={() => handleLoadExampleSession(session)}
                        />
                    ))}
                </Box>
            </Box>
            <Box sx={{ minWidth: 0 }}>
                <Typography component="h2" sx={{ fontSize: textVar.xl, fontWeight: 400, textAlign: 'left', minHeight: 40, display: 'flex', alignItems: 'center', mb: 1.5 }}>
                    {t('landing.exampleWorkflows', { defaultValue: 'Example workflows' })}
                </Typography>
                {examples}
            </Box>
            </Box>

            {/* ── Saved workspaces section ──────────────────────────── */}
            <LandingLibrary workflowsToolbar={toolbar} workflows={saved}
                onOpenSession={id => void handleOpenWorkspace(id)}
                sessionsToolbar={<>
                    <input type="file" hidden accept=".zip" ref={importRef} onChange={handleImportWorkspace} />
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
                    <Button variant="outlined" size="small" startIcon={<UploadFileIcon sx={{ fontSize: iconVar.md }} />}
                        onClick={() => importRef.current?.click()}
                        sx={{ fontSize: textVar.xs, textTransform: 'none', whiteSpace: 'nowrap' }}>
                        {t('workspace.importSession', { defaultValue: 'Import session' })}
                    </Button>
                </>}
                sessions={<>
                <Box id="saved-session-grid" sx={itemCardGridSx}>
                    {sortedSavedWorkspaces.slice(0, INITIAL_SESSION_COUNT).map(w => workspaceCard(w))}
                </Box>
                {sortedSavedWorkspaces.length > INITIAL_SESSION_COUNT && (
                    <Button size="small" aria-haspopup="dialog" onClick={() => setAllSessionsOpen(true)}
                        sx={{ mt: 1, textTransform: 'none', fontSize: textVar.sm, fontWeight: 400 }}>
                        {t('workspace.showAllSessions', { defaultValue: 'Show all ({{count}})', count: sortedSavedWorkspaces.length })}
                    </Button>
                )}
                </>} />
            </Box>} />
            {/* ── All sessions ────────────────────── */}
            <SessionsDialog open={allSessionsOpen} onClose={() => { cancelRenameWorkspace(); setAllSessionsOpen(false); }}
                title={t('workspace.yourSessions')} sessions={sortedSavedWorkspaces}
                groupTime={wsSort === 'name_asc' ? undefined
                    : wsSort === 'updated_desc' ? (w => w.saved_at || w.created_at) : (w => w.created_at)}
                renderCard={w => workspaceCard(w, () => setAllSessionsOpen(false))} />
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
            <WorkflowRunObserver />
            {activeWorkspace?.readOnly && (
                <Alert severity="warning" sx={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 1200, maxWidth: 720 }}>
                    {activeWorkspace.openElsewhere ? <>
                        {t('workspace.openElsewhere', 'This session is being edited in another tab. Changes here are not saved.')}
                        <Button size="small" sx={{ ml: 1 }} onClick={() => void dispatch(openSession(activeWorkspace.id, activeWorkspace.displayName, { saveCurrent: false }))}>
                            {t('workspace.editHere', 'Edit here')}
                        </Button></>
                    : activeWorkspace.scheduledRun ? 'Scheduled run snapshot (read-only)'
                        : t('workspace.expiredReadOnly', 'This temporary session has expired on the server. You are viewing a read-only browser snapshot.')}
                </Alert>
            )}
            <DndProvider backend={HTML5Backend}>
                {inSession ? (isPhone ? phoneWorkspace : fixedSplitPane) : (
                    <Box sx={{ display: 'flex', flexDirection: 'row', height: '100%' }}>
                        <DataSourceSidebar
                            onOpenUploadDialog={(tab, tablePath) => openUploadDialog((tab ?? 'menu') as UploadTabType, tablePath)}
                            connectorRefreshKey={connectorRefreshKey}
                            onConnectorsChanged={handleConnectorsChanged}
                            onAskAgent={(text) => startAnalystChat(text)}
                        />
                        {dataUploadRequestBox}
                    </Box>
                )}
                <UnifiedDataUploadDialog 
                    open={uploadDialogOpen}
                    onClose={closeUploadDialog}
                    onStartChat={startAnalystChat}
                    initialTab={uploadDialogInitialTab}
                    initialTablePath={uploadDialogTablePath}
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
                        <Box sx={{margin:'auto', pb: '5%', px: 2, maxWidth: '100%', boxSizing: 'border-box', display: "flex", flexDirection: "column", textAlign: "center"}}>
                            <Box component="img" sx={{  width: 196, margin: "auto" }} alt="Data Formulator logo" src={dfLogo} fetchPriority="high" />
                            <Typography variant="h3" sx={{marginTop: "20px", fontWeight: 200, letterSpacing: 0, fontSize: { xs: 28, sm: Math.min(48, headingSize) }, overflowWrap: 'anywhere'}}>
                                {appName}
                            </Typography>
                            <Typography variant="h4" sx={{mt: 3, fontSize: 28, letterSpacing: '0.02em'}}>
                                {t('landing.firstSelectModelPrefix')} <ModelSelectionButton appearance="inline" />
                            </Typography>
                            <Typography color="text.secondary" variant="body1" sx={{mt: 2, width: 600, maxWidth: '100%'}}>{t('landing.modelTip')}</Typography>
                        </Box>
                        {footer}
                    </Box>
                )}
            </DndProvider>
        </Box>);
}