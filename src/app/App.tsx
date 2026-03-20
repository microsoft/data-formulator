// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useCallback, useEffect, useState } from 'react';
import '../scss/App.scss';

import { useDispatch, useSelector } from "react-redux";
import {
    DataFormulatorState,
    dfActions,
    dfSelectors,
    fetchAvailableModels,
} from './dfSlice'
import { getBrowserId } from './identity';

import { red, purple, blue, brown, yellow, orange, } from '@mui/material/colors';
import { palettes, defaultPaletteKey, paletteKeys, bgAlpha } from './tokens';

import _ from 'lodash';

import {
    Button,
    Tooltip,
    Typography,
    Box,
    Toolbar,
    Divider,
    DialogTitle,
    Dialog,
    DialogContent,
    Link,
    DialogContentText,
    DialogActions,
    ToggleButtonGroup,
    ToggleButton,
    Menu,
    MenuItem,
    TextField,
    SvgIcon,
    IconButton,
    Select,
    FormControl,
    InputLabel,
    ListItemIcon,
    ListItemText,
    CircularProgress,
    LinearProgress,
} from '@mui/material';


import MuiAppBar from '@mui/material/AppBar';
import { alpha, createTheme, styled, ThemeProvider } from '@mui/material/styles';

import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import ClearIcon from '@mui/icons-material/Clear';

import { DataFormulatorFC } from '../views/DataFormulator';

import GridViewIcon from '@mui/icons-material/GridView';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';
import SettingsIcon from '@mui/icons-material/Settings';
import {
    createBrowserRouter,
    RouterProvider,
} from "react-router-dom";
import { About } from '../views/About';
import ChartGallery from '../views/ChartGallery';
import { MessageSnackbar } from '../views/MessageSnackbar';
import { ChartRenderService } from '../views/ChartRenderService';
import { DictTable } from '../components/ComponentType';
import { AppDispatch } from './store';
import dfLogo from '../assets/df-logo.png';
import { ModelSelectionButton } from '../views/ModelSelectionDialog';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import SaveIcon from '@mui/icons-material/Save';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import RefreshIcon from '@mui/icons-material/Refresh';
import { getUrls, fetchWithIdentity } from './utils';
import { persistor } from './store';
import { UnifiedDataUploadDialog } from '../views/UnifiedDataUploadDialog';
import ChatIcon from '@mui/icons-material/Chat';
import ArticleIcon from '@mui/icons-material/Article';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import GitHubIcon from '@mui/icons-material/GitHub';
import UploadIcon from '@mui/icons-material/Upload';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import YouTubeIcon from '@mui/icons-material/YouTube';
import PublicIcon from '@mui/icons-material/Public';
import { useTranslation } from 'react-i18next';

// Discord Icon Component
const DiscordIcon: FC<{ sx?: any }> = ({ sx }) => (
    <SvgIcon sx={sx} viewBox="0 0 24 24">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" fill="currentColor"/>
    </SvgIcon>
);

const AppBar = styled(MuiAppBar)(({ theme }) => ({
    color: 'black',
    backgroundColor: "transparent",
    //borderBottom: "1px solid #C3C3C3",
    boxShadow: "none",
    transition: theme.transitions.create(['margin', 'width'], {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.leavingScreen,
    }),
}));

declare module '@mui/material/styles' {
    interface PaletteColor {
        bgcolor?: string;
        textColor?: string;
    }
    interface SimplePaletteColorOptions {
        bgcolor?: string;
        textColor?: string;
    }
    interface Palette {
        derived: Palette['primary'];
        custom: Palette['primary'];
    }
    interface PaletteOptions {
        derived: PaletteOptions['primary'];
        custom: PaletteOptions['primary'];
    }
}

export const toolName = "Data Formulator"

const LANGUAGE_LABELS: Record<string, string> = {
    en: 'EN',
    zh: '中文',
    ja: '日本語',
    ko: '한국어',
    fr: 'FR',
    de: 'DE',
};

const LanguageSwitcher: React.FC = () => {
    const { i18n } = useTranslation();
    const availableLanguages = useSelector(
        (state: DataFormulatorState) => state.serverConfig.AVAILABLE_LANGUAGES
    );

    if (!availableLanguages || availableLanguages.length <= 1) return null;

    return (
        <ToggleButtonGroup
            value={i18n.language.split('-')[0]}
            exclusive
            onChange={(_, value) => value && i18n.changeLanguage(value)}
            size="small"
            sx={{ 
                height: '28px', 
                my: 'auto',
                mr: 1,
                '& .MuiToggleButton-root': {
                    textTransform: 'none',
                    fontSize: '12px',
                    py: 0,
                    minWidth: '40px',
                },
            }}
        >
            {availableLanguages.map(lang => (
                <ToggleButton key={lang} value={lang}>
                    {LANGUAGE_LABELS[lang] || lang.toUpperCase()}
                </ToggleButton>
            ))}
        </ToggleButtonGroup>
    );
};

export interface AppFCProps {
}

// Extract menu components into separate components to prevent full app re-renders
const TableMenu: React.FC = () => {
    const [dialogOpen, setDialogOpen] = useState<boolean>(false);
    const { t } = useTranslation();
    
    return (
        <>
            <Button
                variant="text"
                onClick={() => setDialogOpen(true)}
                sx={{ textTransform: 'none' }}
            >
                {t('appBar.data')}
            </Button>
            
            {/* Unified Data Upload Dialog */}
            <UnifiedDataUploadDialog 
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                initialTab="menu"
            />
        </>
    );
};

const SaveSessionDialog: React.FC<{open: boolean, onClose: () => void}> = ({open, onClose}) => {
    const [sessionName, setSessionName] = useState('');
    const [saving, setSaving] = useState(false);
    const dispatch = useDispatch();
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const { t } = useTranslation();

    const fullState = useSelector((state: DataFormulatorState) => {
        const excludedFields = new Set([
            'models', 'selectedModelId', 'testedModels',
            'dataLoaderConnectParams', 'identity', 'agentRules', 'serverConfig',
        ]);
        const stateToSerialize: any = {};
        for (const [key, value] of Object.entries(state)) {
            if (!excludedFields.has(key)) {
                stateToSerialize[key] = value;
            }
        }
        return stateToSerialize;
    });

    const handleSave = async () => {
        if (!sessionName.trim()) return;
        setSaving(true);
        try {
            const res = await fetchWithIdentity(getUrls().SESSION_SAVE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: sessionName.trim(), state: fullState }),
            });
            const data = await res.json();
            if (data.status === 'ok') {
                dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "success", value: t('session.sessionSaved', { name: sessionName }) }));
                onClose();
            } else {
                dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "error", value: data.message || t('session.saveFailed') }));
            }
        } catch (e) {
            dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "error", value: t('session.failedToSave') }));
        }
        setSaving(false);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>{t('session.saveTitle')}</DialogTitle>
            <DialogContent>
                <TextField
                    autoFocus fullWidth margin="dense" label={t('session.sessionName')}
                    value={sessionName} onChange={(e) => setSessionName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                    helperText={t('session.tablesWillBeSaved', { count: tables.length })}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('app.cancel')}</Button>
                <Button onClick={handleSave} disabled={!sessionName.trim() || saving}>
                    {saving ? t('app.loading') : t('app.save')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

const LoadSessionDialog: React.FC<{open: boolean, onClose: () => void}> = ({open, onClose}) => {
    const [sessions, setSessions] = useState<{name: string, saved_at: string}[]>([]);
    const [loading, setLoading] = useState(false);
    const [listLoading, setListLoading] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const dispatch = useDispatch();
    const { t } = useTranslation();

    const fetchSessions = useCallback(async () => {
        setListLoading(true);
        try {
            const res = await fetchWithIdentity(getUrls().SESSION_LIST);
            const data = await res.json();
            if (data.status === 'ok') setSessions(data.sessions);
        } catch (e) { /* ignore */ }
        setListLoading(false);
    }, []);

    useEffect(() => {
        if (!open) return;
        fetchSessions();
    }, [open, fetchSessions]);

    const handleLoad = async (name: string) => {
        setLoading(true);
        dispatch(dfActions.setSessionLoading({ loading: true, label: t('session.loadingSessions') }));
        onClose();
        try {
            const res = await fetchWithIdentity(getUrls().SESSION_LOAD, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await res.json();
            if (data.status === 'ok') {
                dispatch(dfActions.loadState(data.state));
                dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "success", value: t('session.sessionLoaded', { name }) }));
            } else {
                dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "error", value: data.message || t('session.loadFailed') }));
            }
        } catch (e) {
            dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "error", value: t('session.failedToLoad') }));
        }
        setLoading(false);
        dispatch(dfActions.setSessionLoading({ loading: false }));
    };

    const handleDelete = async (name: string) => {
        try {
            const res = await fetchWithIdentity(getUrls().SESSION_DELETE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await res.json();
            if (data.status === 'ok') {
                setSessions(prev => prev.filter(s => s.name !== name));
                dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "success", value: t('session.deleteSession') + `: ${name}` }));
            }
        } catch (e) { /* ignore */ }
        setConfirmDelete(null);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {t('session.loadTitle')}
                <Tooltip title={t('session.refreshList')}>
                    <IconButton size="small" onClick={fetchSessions} disabled={listLoading}>
                        {listLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
                    </IconButton>
                </Tooltip>
            </DialogTitle>
            <DialogContent sx={{ px: 1 }}>
                {listLoading && sessions.length === 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4, gap: 1.5 }}>
                        <CircularProgress size={28} />
                        <Typography variant="body2" color="text.secondary">{t('session.loadingSessions')}</Typography>
                    </Box>
                ) : sessions.length === 0 ? (
                    <DialogContentText sx={{ px: 1 }}>{t('session.noSavedSessions')}</DialogContentText>
                ) : (
                    sessions.map(s => (
                        <Box
                            key={s.name}
                            sx={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                px: 1.5, py: 1, mx: 0, my: 0.5, borderRadius: 1, cursor: 'pointer',
                                '&:hover': { backgroundColor: 'action.hover' },
                                transition: 'background-color 0.15s',
                            }}
                            onClick={() => handleLoad(s.name)}
                        >
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="body2" fontWeight="bold" noWrap>{s.name}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {new Date(s.saved_at).toLocaleString()}
                                </Typography>
                            </Box>
                            {confirmDelete === s.name ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} onClick={e => e.stopPropagation()}>
                                    <Button size="small" color="error" sx={{ minWidth: 0, fontSize: 11, textTransform: 'none' }}
                                        onClick={() => handleDelete(s.name)}>{t('app.delete')}</Button>
                                    <Button size="small" sx={{ minWidth: 0, fontSize: 11, textTransform: 'none' }}
                                        onClick={() => setConfirmDelete(null)}>{t('app.cancel')}</Button>
                                </Box>
                            ) : (
                                <Tooltip title={t('session.deleteSession')}>
                                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); setConfirmDelete(s.name); }}>
                                        <ClearIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            )}
                        </Box>
                    ))
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('app.close')}</Button>
            </DialogActions>
        </Dialog>
    );
};

const SessionMenu: React.FC = () => {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [saveDialogOpen, setSaveDialogOpen] = useState(false);
    const [loadDialogOpen, setLoadDialogOpen] = useState(false);
    const [recentSessions, setRecentSessions] = useState<{name: string, saved_at: string}[]>([]);
    const [exporting, setExporting] = useState(false);
    const importRef = React.useRef<HTMLInputElement>(null);
    const open = Boolean(anchorEl);
    const dispatch = useDispatch();
    const { t } = useTranslation();
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const diskPersistenceDisabled = serverConfig.DISABLE_DATABASE;

    const fullState = useSelector((state: DataFormulatorState) => {
        const excludedFields = new Set([
            'models', 'selectedModelId', 'testedModels',
            'dataLoaderConnectParams', 'identity', 'agentRules', 'serverConfig',
        ]);
        const obj: any = {};
        for (const [key, value] of Object.entries(state)) {
            if (!excludedFields.has(key)) obj[key] = value;
        }
        return obj;
    });

    // Fetch recent sessions when the menu opens
    useEffect(() => {
        if (!open || diskPersistenceDisabled) return;
        (async () => {
            try {
                const res = await fetchWithIdentity(getUrls().SESSION_LIST);
                const data = await res.json();
                if (data.status === 'ok') setRecentSessions(data.sessions.slice(0, 3));
            } catch (e) { /* ignore */ }
        })();
    }, [open]);

    const closeMenu = () => setAnchorEl(null);

    const handleLoadSession = async (name: string) => {
        closeMenu();
        dispatch(dfActions.setSessionLoading({ loading: true, label: t('session.loadingSessions') }));
        try {
            const res = await fetchWithIdentity(getUrls().SESSION_LOAD, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await res.json();
            if (data.status === 'ok') {
                dispatch(dfActions.loadState(data.state));
                dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "success", value: t('session.sessionLoaded', { name }) }));
            } else {
                dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "error", value: data.message || t('session.loadFailed') }));
            }
        } catch (e) {
            dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "error", value: t('session.failedToLoad') }));
        }
        dispatch(dfActions.setSessionLoading({ loading: false }));
    };

    const handleExport = async () => {
        closeMenu();
        setExporting(true);
        try {
            const res = await fetchWithIdentity(getUrls().SESSION_EXPORT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: fullState }),
            });
            if (!res.ok) throw new Error('Export failed');
            const blob = await res.blob();
            const disposition = res.headers.get('content-disposition');
            const match = disposition?.match(/filename="?(.+?)"?$/);
            const filename = match?.[1] || 'session.dfsession';
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            URL.revokeObjectURL(a.href);
            dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "success", value: t('session.sessionExported') }));
        } catch (e) {
            dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "error", value: t('session.failedToExport') }));
        }
        setExporting(false);
    };

    const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        closeMenu();
        dispatch(dfActions.setSessionLoading({ loading: true, label: t('session.importingFrom', { file: file.name }) }));
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetchWithIdentity(getUrls().SESSION_IMPORT, {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (data.status === 'ok') {
                dispatch(dfActions.loadState(data.state));
                dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "success", value: t('session.sessionImported', { file: file.name }) }));
            } else {
                dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "error", value: data.message || t('session.importFailed') }));
            }
        } catch (e) {
            dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Session", type: "error", value: t('session.failedToImport') }));
        }
        dispatch(dfActions.setSessionLoading({ loading: false }));
        if (importRef.current) importRef.current.value = '';
    };

    return (
        <>
            <Button 
                variant="text" 
                onClick={(e) => setAnchorEl(e.currentTarget)} 
                endIcon={<KeyboardArrowDownIcon />} 
                sx={{ textTransform: 'none' }}
            >
                {t('appBar.session')}
            </Button>
            <Menu
                anchorEl={anchorEl}
                open={open}
                onClose={closeMenu}
                slotProps={{ paper: { sx: { minWidth: 200 } } }}
            >
                <Tooltip title={diskPersistenceDisabled ? t('session.installLocallyHint') : ""} placement="right">
                    <span>
                        <MenuItem disabled={diskPersistenceDisabled} onClick={() => { setSaveDialogOpen(true); closeMenu(); }}
                            sx={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 1 }}>
                            <SaveIcon sx={{ fontSize: 16, color: 'text.secondary' }} /> {t('session.saveSession')}
                        </MenuItem>
                    </span>
                </Tooltip>
                <Tooltip title={diskPersistenceDisabled ? t('session.installLocallyHint') : ""} placement="right">
                    <span>
                        <MenuItem disabled={diskPersistenceDisabled} onClick={() => { setLoadDialogOpen(true); closeMenu(); }}
                            sx={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FolderOpenIcon sx={{ fontSize: 16, color: 'text.secondary' }} /> {t('session.openSession')}
                        </MenuItem>
                    </span>
                </Tooltip>

                {!diskPersistenceDisabled && recentSessions.length > 0 && [
                    <Divider key="div-recent" />,
                    <Typography key="label-recent" variant="caption" sx={{ px: 2, py: 0.5, color: 'text.secondary', display: 'block', fontSize: 10 }}>
                        {t('session.quickResume')}
                    </Typography>,
                    ...recentSessions.map(s => (
                        <MenuItem key={s.name} onClick={() => handleLoadSession(s.name)}
                            sx={{ pl: 4, py: 0.25, minHeight: 0, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                            <Typography noWrap sx={{ fontSize: 12 }}>{s.name}</Typography>
                            <Typography noWrap sx={{ fontSize: 10, color: 'text.secondary', flexShrink: 0 }}>
                                {new Date(s.saved_at).toLocaleDateString()}
                            </Typography>
                        </MenuItem>
                    )),
                ]}

                <Divider />
                <MenuItem onClick={handleExport} disabled={exporting}
                    sx={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <DownloadIcon sx={{ fontSize: 16, color: 'text.secondary' }} /> {exporting ? t('session.exporting') : t('session.exportToFile')}
                </MenuItem>
                <MenuItem onClick={() => importRef.current?.click()}
                    sx={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <UploadFileIcon sx={{ fontSize: 16, color: 'text.secondary' }} /> {t('session.importFromFile')}
                    <input
                        type="file"
                        hidden
                        accept=".dfsession,.zip"
                        ref={importRef}
                        onChange={handleImport}
                    />
                </MenuItem>
            </Menu>
            <SaveSessionDialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)} />
            <LoadSessionDialog open={loadDialogOpen} onClose={() => setLoadDialogOpen(false)} />
        </>
    );
};

const ResetDialog: React.FC = () => {
    const [open, setOpen] = useState(false);
    const [exiting, setExiting] = useState(false);
    const dispatch = useDispatch();
    const { t } = useTranslation();

    const handleExit = async () => {
        setExiting(true);
        // Clear workspace on server first
        try {
            await fetchWithIdentity(getUrls().RESET_DB_FILE, { method: 'POST' });
        } catch (e) {
            console.warn('Failed to reset server workspace:', e);
        }
        dispatch(dfActions.resetState());

        // Flush the reset state to IndexedDB so the persisted
        // state matches (preserves models, config, agentRules).
        await persistor.flush();
        window.location.reload();
    };

    return (
        <>
            <Button 
                variant="text" 
                sx={{textTransform: 'none'}}
                onClick={() => setOpen(true)} 
                endIcon={<PowerSettingsNewIcon />}
            >
                {t('session.exitButton')}
            </Button>
            <Dialog onClose={exiting ? undefined : () => setOpen(false)} open={open} 
                sx={{ '& .MuiDialog-paper': { position: 'relative', overflow: 'hidden' } }}>
                <DialogTitle sx={{ display: "flex", alignItems: "center" }}>{t('session.exitTitle')}</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {t('session.exitWarning')}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button 
                        disabled={exiting}
                        onClick={handleExit}
                        endIcon={<PowerSettingsNewIcon />}
                    >
                        {t('session.exitAction')}
                    </Button>
                    <Button onClick={() => setOpen(false)} disabled={exiting}>{t('app.cancel')}</Button>
                </DialogActions>
                {/* Cleaning overlay on top of dialog */}
                {exiting && (
                    <Box sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(255, 255, 255, 0.92)',
                        backdropFilter: 'blur(4px)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 2,
                        zIndex: 1,
                        borderRadius: 'inherit',
                    }}>
                        <Typography sx={{
                            fontSize: 36,
                            animation: 'sweepBroom 1.2s ease-in-out infinite',
                            '@keyframes sweepBroom': {
                                '0%, 100%': {
                                    transform: 'rotate(-15deg) translateX(0px)',
                                },
                                '25%': {
                                    transform: 'rotate(-5deg) translateX(8px)',
                                },
                                '50%': {
                                    transform: 'rotate(-15deg) translateX(0px)',
                                },
                                '75%': {
                                    transform: 'rotate(-25deg) translateX(-8px)',
                                },
                            },
                            transformOrigin: 'top center',
                        }}>
                            🧹
                        </Typography>
                        <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 500 }}>
                            {t('session.cleaningWorkspace')}
                        </Typography>
                        <LinearProgress sx={{ width: 200, mt: 1, borderRadius: 1 }} />
                    </Box>
                )}
            </Dialog>
        </>
    );
};

const ConfigDialog: React.FC = () => {
    const [open, setOpen] = useState(false);
    const dispatch = useDispatch();
    const { t } = useTranslation();
    const config = useSelector((state: DataFormulatorState) => state.config);


    const [formulateTimeoutSeconds, setFormulateTimeoutSeconds] = useState(config.formulateTimeoutSeconds ?? 30);

    const [defaultChartWidth, setDefaultChartWidth] = useState(config.defaultChartWidth ?? 300);
    const [defaultChartHeight, setDefaultChartHeight] = useState(config.defaultChartHeight ?? 300);
    const [maxStretchFactor, setMaxStretchFactor] = useState(config.maxStretchFactor ?? 2.0);
    const [frontendRowLimit, setFrontendRowLimit] = useState(config.frontendRowLimit ?? 50000);
    const [paletteKey, setPaletteKey] = useState(
        (config.paletteKey && palettes[config.paletteKey]) ? config.paletteKey : defaultPaletteKey
    );

    // Add check for changes
    const hasChanges = formulateTimeoutSeconds !== config.formulateTimeoutSeconds || 
                      defaultChartWidth !== config.defaultChartWidth ||
                      defaultChartHeight !== config.defaultChartHeight ||
                      maxStretchFactor !== config.maxStretchFactor ||
                      frontendRowLimit !== config.frontendRowLimit ||
                      paletteKey !== ((config.paletteKey && palettes[config.paletteKey]) ? config.paletteKey : defaultPaletteKey);

    return (
        <>
            <Button variant="text" sx={{textTransform: 'none'}} onClick={() => setOpen(true)} startIcon={<SettingsIcon />}>
                {t('app.settings')}
            </Button>
            <Dialog onClose={() => setOpen(false)} open={open}>
                <DialogTitle>{t('app.settings')}</DialogTitle>
                <DialogContent>
                    <Box sx={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: 3,
                        maxWidth: 400
                    }}>
                        <Divider><Typography variant="caption">{t('config.frontend')}</Typography></Divider>
                        <FormControl fullWidth size="small">
                            <InputLabel id="palette-select-label" sx={{ fontSize: 13 }}>{t('config.colorTheme')}</InputLabel>
                            <Select
                                labelId="palette-select-label"
                                value={paletteKey}
                                label={t('config.colorTheme')}
                                onChange={(e) => setPaletteKey(e.target.value)}
                                sx={{ fontSize: 13 }}
                                renderValue={(key) => {
                                    const p = palettes[key];
                                    return (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: p.primary.main, flexShrink: 0 }} />
                                            <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: p.custom.main, flexShrink: 0 }} />
                                            <Typography sx={{ fontSize: 13 }}>{p.name}</Typography>
                                        </Box>
                                    );
                                }}
                            >
                                {paletteKeys.map(key => {
                                    const p = palettes[key];
                                    return (
                                        <MenuItem key={key} value={key} sx={{ py: 0.5 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 1.5 }}>
                                                <Box sx={{ width: 14, height: 14, borderRadius: '50%', backgroundColor: p.primary.main, border: '1px solid rgba(0,0,0,0.1)' }} />
                                                <Box sx={{ width: 14, height: 14, borderRadius: '50%', backgroundColor: p.custom.main, border: '1px solid rgba(0,0,0,0.1)' }} />
                                            </Box>
                                            <ListItemText primary={p.name} slotProps={{ primary: { sx: { fontSize: 13 } } }} />
                                        </MenuItem>
                                    );
                                })}
                            </Select>
                        </FormControl>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Box sx={{ flex: 1 }}>
                                <TextField
                                    label={t('config.defaultChartWidth')}
                                    type="number"
                                    variant="outlined"
                                    value={defaultChartWidth}
                                    onChange={(e) => {
                                        const value = parseInt(e.target.value);
                                        setDefaultChartWidth(value);
                                    }}
                                    fullWidth
                                    slotProps={{
                                        input: {
                                            inputProps: {
                                                min: 100,
                                                max: 1000
                                            }
                                        }
                                    }}
                                    error={defaultChartWidth < 100 || defaultChartWidth > 1000}
                                    helperText={defaultChartWidth < 100 || defaultChartWidth > 1000 ? 
                                        t('config.chartSizeRangeError') : ""}
                                />
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                <ClearIcon fontSize="small" />
                            </Typography>
                            <Box sx={{ flex: 1 }}>
                                <TextField
                                    label={t('config.defaultChartHeight')}
                                    type="number"
                                    variant="outlined"
                                    value={defaultChartHeight}
                                    onChange={(e) => {
                                        const value = parseInt(e.target.value);
                                        setDefaultChartHeight(value);
                                    }}
                                    fullWidth
                                    slotProps={{
                                        input: {
                                            inputProps: {
                                                min: 100,
                                                max: 1000
                                            }
                                        }
                                    }}
                                    error={defaultChartHeight < 100 || defaultChartHeight > 1000}
                                    helperText={defaultChartHeight < 100 || defaultChartHeight > 1000 ? 
                                        t('config.chartSizeRangeError') : ""}
                                />
                            </Box>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Box sx={{ flex: 1 }}>
                                <TextField
                                    label={t('config.localRowLimit')}
                                    type="number"
                                    variant="outlined"
                                    value={frontendRowLimit}
                                    onChange={(e) => {
                                        const value = parseInt(e.target.value);
                                        setFrontendRowLimit(value);
                                    }}
                                    fullWidth
                                    slotProps={{
                                        input: {
                                            inputProps: {
                                                min: 100,
                                                max: 1000000
                                            }
                                        }
                                    }}
                                    error={frontendRowLimit < 100 || frontendRowLimit > 1000000}
                                    helperText={frontendRowLimit < 100 || frontendRowLimit > 1000000 ? 
                                        t('config.localRowLimitRangeError') : ""}
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                    {t('config.localRowLimitHint')}
                                </Typography>
                            </Box>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Box sx={{ flex: 1 }}>
                                <TextField
                                    label={t('config.maxStretchFactor')}
                                    type="number"
                                    variant="outlined"
                                    value={maxStretchFactor}
                                    onChange={(e) => {
                                        const value = parseFloat(e.target.value);
                                        setMaxStretchFactor(value);
                                    }}
                                    fullWidth
                                    slotProps={{
                                        input: {
                                            inputProps: {
                                                min: 1,
                                                max: 5,
                                                step: 0.1
                                            }
                                        }
                                    }}
                                    error={isNaN(maxStretchFactor) || maxStretchFactor < 1 || maxStretchFactor > 5}
                                    helperText={isNaN(maxStretchFactor) || maxStretchFactor < 1 || maxStretchFactor > 5 ? 
                                        t('config.maxStretchFactorRangeError') : ""}
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                    {t('config.maxStretchFactorHint')}
                                </Typography>
                            </Box>
                        </Box>
                        <Divider><Typography variant="caption">{t('config.backend')}</Typography></Divider>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Box sx={{ flex: 1 }}>
                                <TextField
                                    label={t('config.formulateTimeout')}
                                    type="number"
                                    variant="outlined"
                                    value={formulateTimeoutSeconds}
                                    onChange={(e) => {
                                        const value = parseInt(e.target.value);
                                        setFormulateTimeoutSeconds(value);
                                    }}
                                    inputProps={{
                                        min: 0,
                                        max: 3600,
                                    }}
                                    error={formulateTimeoutSeconds <= 0 || formulateTimeoutSeconds > 3600}
                                    helperText={formulateTimeoutSeconds <= 0 || formulateTimeoutSeconds > 3600 ? 
                                        t('config.formulateTimeoutRangeError') : ""}
                                    fullWidth
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                    {t('config.formulateTimeoutHint')}
                                </Typography>
                            </Box>
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions sx={{'.MuiButton-root': {textTransform: 'none'}}}>
                    <Button sx={{marginRight: 'auto'}} onClick={() => {
                        setFormulateTimeoutSeconds(30);
                        setDefaultChartWidth(300);
                        setDefaultChartHeight(300);
                        setMaxStretchFactor(2.0);
                        setFrontendRowLimit(50000);
                        setPaletteKey(defaultPaletteKey);
                    }}>{t('session.resetToDefault')}</Button>
                    <Button onClick={() => setOpen(false)}>{t('app.cancel')}</Button>
                    <Button 
                        variant={hasChanges ? "contained" : "text"}
                        disabled={!hasChanges || isNaN(formulateTimeoutSeconds) || formulateTimeoutSeconds <= 0 || formulateTimeoutSeconds > 3600
                            || isNaN(defaultChartWidth) || defaultChartWidth <= 0 || defaultChartWidth > 1000
                            || isNaN(defaultChartHeight) || defaultChartHeight <= 0 || defaultChartHeight > 1000
                            || isNaN(maxStretchFactor) || maxStretchFactor < 1 || maxStretchFactor > 5
                            || isNaN(frontendRowLimit) || frontendRowLimit < 100 || frontendRowLimit > 1000000}
                        onClick={() => {
                            dispatch(dfActions.setConfig({formulateTimeoutSeconds, defaultChartWidth, defaultChartHeight, maxStretchFactor, frontendRowLimit, paletteKey}));
                            setOpen(false);
                        }}
                    >
                        {t('app.apply')}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );  
}

export const AppFC: FC<AppFCProps> = function AppFC(appProps) {

    const dispatch = useDispatch<AppDispatch>();
    const { t } = useTranslation();
    const viewMode = useSelector((state: DataFormulatorState) => state.viewMode);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const generatedReports = useSelector((state: DataFormulatorState) => state.generatedReports);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const rawPaletteKey = useSelector((state: DataFormulatorState) => state.config.paletteKey);
    const activePaletteKey = (rawPaletteKey && palettes[rawPaletteKey]) ? rawPaletteKey : defaultPaletteKey;

    useEffect(() => {
        fetchWithIdentity(getUrls().APP_CONFIG)
            .then(response => response.json())
            .then(data => {
                dispatch(dfActions.setServerConfig(data));
            });
    }, []);

    // User authentication state
    const [userInfo, setUserInfo] = useState<{ name: string, userId: string } | undefined>(undefined);
    const [authChecked, setAuthChecked] = useState(false);

    // Check for authenticated user first
    useEffect(() => {
        fetch('/.auth/me')
            .then(function (response) { return response.json(); })
            .then(function (result) {
                if (Array.isArray(result) && result.length > 0) {
                    let authInfo = result[0];
                    let userInfo = {
                        name: authInfo['user_claims'].find((item: any) => item.typ == 'name')?.val || '',
                        userId: authInfo['user_id']
                    }
                    setUserInfo(userInfo);
                }
            }).catch(err => {
                // User is not logged in, will use browser identity
            }).finally(() => {
                setAuthChecked(true);
            });
    }, []);

    // Initialize identity after auth check completes
    // No server round-trip needed - identity is determined client-side:
    // Priority: user identity (if logged in) > browser identity (localStorage-based, shared across tabs)
    useEffect(() => {
        if (authChecked) {
            if (userInfo?.userId) {
                // User is logged in - use their user ID
                dispatch(dfActions.setIdentity({ type: 'user', id: userInfo.userId }));
            } else {
                // Not logged in - use browser ID (from localStorage, shared across tabs)
                dispatch(dfActions.setIdentity({ type: 'browser', id: getBrowserId() }));
            }
        }
    }, [authChecked, userInfo?.userId]);

    useEffect(() => {
        document.title = toolName;
        dispatch(fetchAvailableModels());
    }, []);

    let theme = createTheme({
        typography: {
            fontFamily: [
                "Arial",
                "Roboto",
                "Helvetica Neue",
                "sans-serif"
            ].join(",")
        },
        // Default Material UI palette
        // Active palette from user config — selectable via Settings dialog
        // Available: material, fluent, vivid, jewel, electric, tealCoral, copilot
        palette: (() => {
            const p = palettes[activePaletteKey];
            const bg = (entry: { main: string; bgcolor?: string }) => entry.bgcolor ?? alpha(entry.main, bgAlpha);
            const tc = (entry: { main: string; textColor?: string }) => entry.textColor ?? entry.main;
            return {
                primary:   { main: p.primary.main,   bgcolor: bg(p.primary),   textColor: tc(p.primary)   },
                secondary: { main: p.secondary.main, bgcolor: bg(p.secondary), textColor: tc(p.secondary) },
                derived:   { main: p.derived.main,   bgcolor: bg(p.derived),   textColor: tc(p.derived)   },
                custom:    { main: p.custom.main,    bgcolor: bg(p.custom),    textColor: tc(p.custom)    },
                warning:   { main: p.warning.main },
            };
        })(),
        components: {
            MuiButton: {
                styleOverrides: {
                    text: ({ ownerState, theme: t }) => {
                        const c = ownerState.color;
                        if (c && c !== 'inherit' && c !== 'error' && c !== 'info' && c !== 'success' && c in t.palette) {
                            const p = (t.palette as any)[c];
                            if (p?.textColor) return { color: p.textColor };
                        }
                        return {};
                    },
                    outlined: ({ ownerState, theme: t }) => {
                        const c = ownerState.color;
                        if (c && c !== 'inherit' && c !== 'error' && c !== 'info' && c !== 'success' && c in t.palette) {
                            const p = (t.palette as any)[c];
                            if (p?.textColor) return { color: p.textColor, borderColor: alpha(p.textColor, 0.5) };
                        }
                        return {};
                    },
                },
            },
            MuiIconButton: {
                styleOverrides: {
                    root: ({ ownerState, theme: t }) => {
                        const c = ownerState.color;
                        if (c && c !== 'inherit' && c !== 'default' && c !== 'error' && c !== 'info' && c !== 'success' && c in t.palette) {
                            const p = (t.palette as any)[c];
                            if (p?.textColor) return { color: p.textColor };
                        }
                        return {};
                    },
                },
            },
            MuiLink: {
                styleOverrides: {
                    root: ({ ownerState, theme: t }) => {
                        const c = ownerState.color as string | undefined;
                        if (c && c !== 'inherit' && c in t.palette) {
                            const p = (t.palette as any)[c];
                            if (p?.textColor) return { color: p.textColor };
                        }
                        return {};
                    },
                },
            },
        },
    });

    // Check if we're on the about page
    const isAboutPage = window.location.pathname === '/about';
    const isGalleryPage = window.location.pathname === '/gallery';
    const isAppPage = !isAboutPage && !isGalleryPage;

    let appBar =  [
        <AppBar position="static" key="app-bar-main" >
            <Toolbar variant="dense" sx={{height: 40, minHeight: 36, position: 'relative'}}>
                <Button sx={{
                    display: "flex", flexDirection: "row", textTransform: "none",
                    alignItems: 'stretch',
                    backgroundColor: 'transparent',
                    "&:hover": {
                        backgroundColor: "transparent"
                    }
                }} color="inherit">
                    <Box component="img" sx={{ height: 20, mr: 0.5 }} alt="" src={dfLogo} />
                    <Typography noWrap component="h1" sx={{ fontWeight: 300, display: { xs: 'none', sm: 'block' }, letterSpacing: '0.03em' }}>
                        {toolName}
                    </Typography>
                </Button>
                <Box
                    sx={{ 
                        ml: 2,
                        height: '28px', 
                        my: 'auto',
                        display: 'flex',
                    }}
                >
                    <Button 
                        component="a" 
                        href="/about"
                        sx={{ 
                            textDecoration: 'none',
                            textTransform: 'none',
                            fontSize: '13px',
                            fontWeight: 400,
                            border: 'none',
                            borderRadius: 0,
                            px: 1.5,
                            py: 0.5,
                            minWidth: 'auto',
                            color: isAboutPage ? 'text.primary' : 'text.secondary',
                            backgroundColor: isAboutPage ? 'rgba(0, 0, 0, 0.08)' : 'transparent',
                            '&:hover': {
                                color: 'text.primary',
                                backgroundColor: isAboutPage ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                            },
                        }}
                    >
                        {t('appBar.about')}
                    </Button>
                    <Button 
                        component="a" 
                        href="/app"
                        sx={{ 
                            textDecoration: 'none',
                            textTransform: 'none',
                            fontSize: '13px',
                            fontWeight: 400,
                            border: 'none',
                            borderRadius: 0,
                            px: 1.5,
                            py: 0.5,
                            minWidth: 'auto',
                            color: isAppPage ? 'text.primary' : 'text.secondary',
                            backgroundColor: isAppPage ? 'rgba(0, 0, 0, 0.08)' : 'transparent',
                            '&:hover': {
                                color: 'text.primary',
                                backgroundColor: isAppPage ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                            },
                        }}
                    >
                        {t('appBar.app')}
                    </Button>
                    <Button 
                        component="a" 
                        href="/gallery"
                        sx={{ 
                            textDecoration: 'none',
                            textTransform: 'none',
                            fontSize: '13px',
                            fontWeight: 400,
                            border: 'none',
                            borderRadius: 0,
                            px: 1.5,
                            py: 0.5,
                            minWidth: 'auto',
                            color: isGalleryPage ? 'text.primary' : 'text.secondary',
                            backgroundColor: isGalleryPage ? 'rgba(0, 0, 0, 0.08)' : 'transparent',
                            '&:hover': {
                                color: 'text.primary',
                                backgroundColor: isGalleryPage ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                            },
                        }}
                    >
                        {t('appBar.gallery')}
                    </Button>
                </Box>
                {tables.length === 0 && (
                    <Typography noWrap sx={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', fontWeight: 500, fontSize: '0.65rem', color: 'text.disabled', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                        {t('appBar.microsoftResearch')}
                    </Typography>
                )}
                {isAppPage && (
                    <Box sx={{ display: 'flex', ml: 'auto', fontSize: 14 }}>
                        <LanguageSwitcher />
                        {focusedId !== undefined && <React.Fragment><ToggleButtonGroup
                            value={viewMode}
                            exclusive
                            onChange={(_, newMode) => {
                                if (newMode !== null) {
                                    dispatch(dfActions.setViewMode(newMode));
                                }
                            }}
                            sx={{ 
                                mr: 2,
                                height: '28px', 
                                my: 'auto',
                                '& .MuiToggleButton-root': {
                                    textTransform: 'none',
                                    fontWeight: 500,
                                    border: 'none',
                                    '&:hover': {
                                        backgroundColor: 'rgba(0, 0, 0, 0.04)',
                                        color: 'text.primary',
                                    },
                                },
                            }}
                        >
                            <ToggleButton value="editor">
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Box component="span">{t('appBar.explore')}</Box>
                                </Box>
                            </ToggleButton>
                            <ToggleButton value="report">
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Box component="span">
                                        {generatedReports.length > 0 ? t('appBar.reportsWithCount', { count: generatedReports.length }) : t('appBar.reports')}
                                    </Box>
                                </Box>
                            </ToggleButton>
                        </ToggleButtonGroup>
                        <ConfigDialog />
                        <Divider orientation="vertical" variant="middle" flexItem /></React.Fragment>}
                        <ModelSelectionButton />
                        <Divider orientation="vertical" variant="middle" flexItem />
                        
                        <Typography fontSize="inherit" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <TableMenu />
                        </Typography>
                        <Typography fontSize="inherit" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <SessionMenu />
                        </Typography>
                        {tables.length > 0 && <ResetDialog />}
                    </Box>
                )}
                {isAboutPage && (
                    <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
                        <LanguageSwitcher />
                        <Tooltip title={t('appBar.watchVideo')}>
                            <IconButton
                                component="a"
                                href="https://youtu.be/3ndlwt0Wi3c"
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={t('appBar.watchVideo')}
                                sx={{ 
                                    color: 'inherit',
                                    '&:hover': {
                                        backgroundColor: 'rgba(0, 0, 0, 0.04)'
                                    }
                                }}
                            >
                                <YouTubeIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title={t('appBar.viewOnGitHub')}>
                            <IconButton
                                component="a"
                                href="https://github.com/microsoft/data-formulator"
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={t('appBar.viewOnGitHub')}
                                sx={{ 
                                    color: 'inherit',
                                    '&:hover': {
                                        backgroundColor: 'rgba(0, 0, 0, 0.04)'
                                    }
                                }}
                            >
                                <GitHubIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title={t('appBar.pipInstall')}>
                            <IconButton
                                component="a"
                                href="https://pypi.org/project/data-formulator/"
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={t('appBar.pipInstall')}
                                sx={{ 
                                    color: 'inherit',
                                    '&:hover': {
                                        backgroundColor: 'rgba(0, 0, 0, 0.04)'
                                    }
                                }}
                            >
                                <Box component="img" src="/pip-logo.svg" sx={{ width: 20, height: 20 }} alt="pip logo" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title={t('appBar.joinDiscord')}>
                            <IconButton
                                component="a"
                                href="https://discord.gg/mYCZMQKYZb"
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={t('appBar.joinDiscord')}
                                sx={{ 
                                    color: 'inherit',
                                    '&:hover': {
                                        backgroundColor: 'rgba(0, 0, 0, 0.04)'
                                    }
                                }}
                            >
                                <DiscordIcon sx={{ fontSize: 20 }} />
                            </IconButton>
                        </Tooltip>
                    </Box>
                )}
                {isAppPage && (
                    <Tooltip title={t('appBar.viewOnGitHub')}>
                        <Button
                            component="a"
                            href="https://github.com/microsoft/data-formulator"
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{ 
                                minWidth: 'auto', 
                                color: 'inherit',
                                '&:hover': {
                                    backgroundColor: 'rgba(0, 0, 0, 0.04)'
                                }
                            }}
                        >
                            <GitHubIcon fontSize="medium" />
                        </Button>
                    </Tooltip>
                )}
            </Toolbar>
        </AppBar>
    ];

    let router = createBrowserRouter([
        {
            path: "/about",
            element: <About />,
        },
        {
            path: "/gallery",
            element: <ChartGallery />,
        },
        {
            path: "/",
            element: <DataFormulatorFC />,
        }, {
            path: "*",
            element: <DataFormulatorFC />,
            errorElement: <Box sx={{ width: "100%", height: "100%", display: "flex" }}>
                <Typography color="gray" sx={{ margin: "150px auto" }}>An error has occurred, please <Link href="/">refresh the session</Link>. If the problem still exists, click close session.</Typography>
            </Box>
        }
    ]);

    let app =
        <Box sx={{ 
            position: 'absolute',
            backgroundColor: 'rgba(255, 255, 255, 0.3)',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            overflow: 'auto',
            '& > *': {
                minWidth: '1000px',
                minHeight: '600px'
            },
        }}>
            <Box sx={{ 
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
                overflow: 'hidden'
            }}>
                {appBar}
                <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', '& > div': { height: '100%' } }}>
                    <RouterProvider router={router} />
                </Box>
                <MessageSnackbar />
                <ChartRenderService />
            </Box>
        </Box>;

    return (
        <ThemeProvider theme={theme}>
            {app}
        </ThemeProvider>
    );
}

function stringAvatar(name: string) {
    let displayName = ""
    try {
        let nameSplit = name.split(' ')
        displayName = `${nameSplit[0][0]}${nameSplit.length > 1 ? nameSplit[nameSplit.length - 1][0] : ''}`
    } catch {
        displayName = name ? name[0] : "?";
    }
    return {
        sx: {
            bgcolor: "cornflowerblue",
            width: 36,
            height: 36,
            margin: "auto",
            fontSize: "1rem"
        },
        children: displayName,
    };
}
