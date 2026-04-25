// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import '../scss/App.scss';

import { useDispatch, useSelector } from "react-redux";
import {
    DataFormulatorState,
    dfActions,
    dfSelectors,
    fetchGlobalModelList,
    DEFAULT_ROW_LIMIT,
    DEFAULT_ROW_LIMIT_EPHEMERAL,
} from './dfSlice'
import { getBrowserId, generateUUID } from './identity';
import { getAuthInfo, getOidcUser, getUserManager } from './oidcConfig';
import type { AuthInfo } from './oidcConfig';
import { OidcCallback } from './OidcCallback';
import { AuthButton } from './AuthButton';
import { IdentityMigrationDialog } from './IdentityMigrationDialog';

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
    Switch,
    FormControlLabel,
} from '@mui/material';


import MuiAppBar from '@mui/material/AppBar';
import { alpha, createTheme, styled, ThemeProvider, useTheme } from '@mui/material/styles';

import AddIcon from '@mui/icons-material/Add';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ClearIcon from '@mui/icons-material/Clear';

import { DataFormulatorFC } from '../views/DataFormulator';
import { useAutoSave } from './useAutoSave';
import { useWorkspaceAutoName } from './useWorkspaceAutoName';

import GridViewIcon from '@mui/icons-material/GridView';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';
import SettingsIcon from '@mui/icons-material/Settings';
import {
    createBrowserRouter,
    Link as RouterLink,
    Outlet,
    RouterProvider,
    useLocation,
} from "react-router-dom";
import { About } from '../views/About';
import ChartGallery from '../gallery/ChartGallery';
import { MessageSnackbar } from '../views/MessageSnackbar';
import { ChartRenderService } from '../views/ChartRenderService';
import { DictTable } from '../components/ComponentType';
import { AppDispatch } from './store';
import dfLogo from '../assets/df-logo.png';
import { AnvilLoader } from '../components/AnvilLoader';
import { ModelSelectionButton } from '../views/ModelSelectionDialog';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import SaveIcon from '@mui/icons-material/Save';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import RefreshIcon from '@mui/icons-material/Refresh';
import { getUrls, fetchWithIdentity } from './utils';
import { listWorkspaces, loadWorkspace, deleteWorkspace, saveWorkspaceState } from './workspaceService';
import { getSerializableState } from './useAutoSave';
import store, { persistor } from './store';
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

const TopNavButton: FC<{ to: string; label: string; selected: boolean }> = ({ to, label, selected }) => (
    <Button
        component={RouterLink}
        to={to}
        aria-current={selected ? 'page' : undefined}
        onClick={(event) => {
            if (selected) {
                event.preventDefault();
            }
        }}
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
            cursor: selected ? 'default' : 'pointer',
            color: selected ? 'text.primary' : 'text.secondary',
            backgroundColor: selected ? 'rgba(0, 0, 0, 0.08)' : 'transparent',
            '&:hover': {
                color: 'text.primary',
                backgroundColor: selected ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.04)',
            },
        }}
    >
        {label}
    </Button>
);

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


const WorkspacePickerDialog: React.FC<{open: boolean, onClose: () => void}> = ({open, onClose}) => {
    const [workspaces, setWorkspaces] = useState<{id: string, display_name: string, saved_at: string}[]>([]);
    const [loading, setLoading] = useState(false);
    const [listLoading, setListLoading] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const dispatch = useDispatch();
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const { t } = useTranslation();

    const fetchWsList = useCallback(async () => {
        setListLoading(true);
        try {
            const sessions = await listWorkspaces();
            setWorkspaces(sessions as any);
        } catch (e) { /* ignore */ }
        setListLoading(false);
    }, []);

    useEffect(() => {
        if (!open) return;
        fetchWsList();
    }, [open, fetchWsList]);

    const handleOpen = async (wsId: string) => {
        if (activeWorkspace?.id === wsId) { onClose(); return; }
        try { await saveWorkspaceState(getSerializableState(store.getState())); } catch { /* best effort */ }
        const wsEntry = workspaces.find(w => w.id === wsId);
        setLoading(true);
        dispatch(dfActions.setSessionLoading({ loading: true, label: t('workspace.openingWorkspace') }));
        onClose();
        try {
            const result = await loadWorkspace(wsId);
            if (result) {
                const displayName = result.displayName || wsEntry?.display_name || wsId;
                dispatch(dfActions.loadState({ ...result.state, activeWorkspace: { id: wsId, displayName } }));
                dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Workspace", type: "success", value: t('workspace.openedSession', { name: displayName }) }));
            } else {
                dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Workspace", type: "error", value: t('workspace.failedToOpenWorkspace') }));
            }
        } catch (e) {
            dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Workspace", type: "error", value: t('workspace.failedToOpenWorkspace') }));
        }
        setLoading(false);
        dispatch(dfActions.setSessionLoading({ loading: false }));
    };

    const handleCreate = () => {
        dispatch(dfActions.resetState());
        onClose();
    };

    const handleDelete = async (workspaceId: string) => {
        try {
            await deleteWorkspace(workspaceId);
            setWorkspaces(prev => prev.filter(s => s.id !== workspaceId));
            dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "Workspace", type: "success", value: t('workspace.deletedSession', { name: workspaceId }) }));
        } catch (e) { /* ignore */ }
        setConfirmDelete(null);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {t('workspace.sessions')}
                <Tooltip title={t('workspace.refreshList')}>
                    <IconButton size="small" onClick={fetchWsList} disabled={listLoading} sx={{ color: 'text.secondary' }}>
                        {listLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
                    </IconButton>
                </Tooltip>
            </DialogTitle>
            <DialogContent sx={{ px: 1 }}>
                {listLoading && workspaces.length === 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4, gap: 1.5 }}>
                        <CircularProgress size={28} />
                        <Typography variant="body2" color="text.secondary">{t('workspace.loadingSessions')}</Typography>
                    </Box>
                ) : (
                    <>
                        {/* New session — same row style as session items */}
                        <Box
                            sx={{
                                display: 'flex', alignItems: 'center',
                                px: 1.5, py: 1, mx: 0, my: 0.5, borderRadius: 1, cursor: 'pointer',
                                '&:hover': { backgroundColor: 'action.hover' },
                                transition: 'background-color 0.15s',
                            }}
                            onClick={handleCreate}
                        >
                            <Typography variant="body2" color="primary" sx={{ fontWeight: 500 }}>
                                {t('workspace.newSession')}
                            </Typography>
                        </Box>
                        {workspaces.length > 0 && <Divider sx={{ my: 0.5 }} />}
                        {workspaces.map(s => (
                        <Box
                            key={s.id}
                            sx={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                px: 1.5, py: 1, mx: 0, my: 0.5, borderRadius: 1, cursor: 'pointer',
                                backgroundColor: activeWorkspace?.id === s.id ? 'action.selected' : 'transparent',
                                '&:hover': { backgroundColor: activeWorkspace?.id === s.id ? 'action.selected' : 'action.hover' },
                                transition: 'background-color 0.15s',
                            }}
                            onClick={() => handleOpen(s.id)}
                        >
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="body2" fontWeight={activeWorkspace?.id === s.id ? 'bold' : 'normal'} noWrap>
                                    {s.display_name} {activeWorkspace?.id === s.id ? t('workspace.active') : ''}
                                </Typography>
                                {s.saved_at && (
                                    <Typography variant="caption" color="text.secondary">
                                        {new Date(s.saved_at).toLocaleString()}
                                    </Typography>
                                )}
                            </Box>
                            {activeWorkspace?.id !== s.id && (
                                confirmDelete === s.id ? (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} onClick={e => e.stopPropagation()}>
                                        <Button size="small" color="error" sx={{ minWidth: 0, fontSize: 11, textTransform: 'none' }}
                                            onClick={() => handleDelete(s.id)}>{t('workspace.delete')}</Button>
                                        <Button size="small" sx={{ minWidth: 0, fontSize: 11, textTransform: 'none' }}
                                            onClick={() => setConfirmDelete(null)}>{t('workspace.cancel')}</Button>
                                    </Box>
                                ) : (
                                    <Tooltip title={t('workspace.deleteSession')}>
                                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); setConfirmDelete(s.id); }} sx={{ color: 'text.secondary' }}>
                                            <ClearIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )
                            )}
                        </Box>
                    ))
                    }
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('workspace.close')}</Button>
            </DialogActions>
        </Dialog>
    );
};

const WorkspaceMenu: React.FC = () => {
    const [pickerOpen, setPickerOpen] = useState(false);
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const { t } = useTranslation();
    const diskPersistenceDisabled = false; // all backends support workspace switching

    console.log('Rendering WorkspaceMenu, activeWorkspace:', activeWorkspace, 'serverConfig:', serverConfig); // Debug log for rendering and state
    console.log(serverConfig); // Debug log for serverConfig
    console.log(activeWorkspace); // Debug log for activeWorkspace

    if (!activeWorkspace) return null;

    return (
        <>
            <Tooltip title={t('workspace.sessionTooltip', { name: activeWorkspace?.id || '' })} placement="bottom">
                <Box 
                    onClick={() => !diskPersistenceDisabled && setPickerOpen(true)}
                    sx={{ 
                        display: 'flex', alignItems: 'center', gap: 0.5,
                        cursor: 'pointer',
                        px: 1,
                        py: 0.25,
                        borderRadius: 1,
                        '&:hover': { backgroundColor: 'rgba(0,0,0,0.04)' },
                        '&:hover .ws-chevron': { opacity: 1 },
                    }}
                >
                    <Typography noWrap sx={{ 
                        fontSize: 14, 
                        fontWeight: 500, 
                        color: 'text.primary',
                        maxWidth: 280,
                        letterSpacing: '0.01em',
                    }}>
                        {activeWorkspace?.displayName || activeWorkspace?.id}
                    </Typography>
                    <KeyboardArrowDownIcon className="ws-chevron" sx={{ fontSize: 16, color: 'text.secondary', opacity: 0.4, transition: 'opacity 0.15s' }} />
                </Box>
            </Tooltip>
            <WorkspacePickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} />
        </>
    );
};

const NewSessionButton: React.FC = () => {
    const dispatch = useDispatch();
    const state = useSelector((s: DataFormulatorState) => s);
    const { t } = useTranslation();

    const handleNewSession = async () => {
        try { await saveWorkspaceState(getSerializableState(state)); } catch { /* best effort */ }
        const now = new Date();
        const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const short = generateUUID().slice(0, 4);
        const wsId = `session_${date}_${time}_${short}`;
        dispatch(dfActions.loadState({
            tables: [], charts: [], draftNodes: [], conceptShelfItems: [],
            activeWorkspace: { id: wsId, displayName: 'Untitled Session' },
        }));
    };

    return (
        <Tooltip title={t('workspace.newSessionTooltip')} placement="bottom">
            <IconButton size="small" onClick={handleNewSession} sx={{ color: 'text.secondary', ml: 0.5 }}>
                <AddIcon sx={{ fontSize: 18 }} />
            </IconButton>
        </Tooltip>
    );
};

const ConfigDialog: React.FC = () => {
    const [open, setOpen] = useState(false);
    const dispatch = useDispatch();
    const { t } = useTranslation();
    const config = useSelector((state: DataFormulatorState) => state.config);
    const isEphemeral = useSelector((state: DataFormulatorState) => state.serverConfig?.WORKSPACE_BACKEND === 'ephemeral');
    const rowLimitDefault = isEphemeral ? DEFAULT_ROW_LIMIT_EPHEMERAL : DEFAULT_ROW_LIMIT;
    const rowLimitMax = DEFAULT_ROW_LIMIT;


    const [formulateTimeoutSeconds, setFormulateTimeoutSeconds] = useState(config.formulateTimeoutSeconds ?? 60);
    const [defaultChartWidth, setDefaultChartWidth] = useState(config.defaultChartWidth ?? 300);
    const [defaultChartHeight, setDefaultChartHeight] = useState(config.defaultChartHeight ?? 300);
    const [maxStretchFactor, setMaxStretchFactor] = useState(config.maxStretchFactor ?? 2.0);
    const [frontendRowLimit, setFrontendRowLimit] = useState(config.frontendRowLimit ?? rowLimitDefault);
    const [paletteKey, setPaletteKey] = useState(
        (config.paletteKey && palettes[config.paletteKey]) ? config.paletteKey : defaultPaletteKey
    );

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
                                                max: rowLimitMax
                                            }
                                        }
                                    }}
                                    error={frontendRowLimit < 100 || frontendRowLimit > rowLimitMax}
                                    helperText={frontendRowLimit < 100 || frontendRowLimit > rowLimitMax ? 
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
                        setFormulateTimeoutSeconds(60);
                        setDefaultChartWidth(300);
                        setDefaultChartHeight(300);
                        setMaxStretchFactor(2.0);
                        setFrontendRowLimit(rowLimitDefault);
                        setPaletteKey(defaultPaletteKey);
                    }}>{t('session.resetToDefault')}</Button>
                    <Button onClick={() => setOpen(false)}>{t('app.cancel')}</Button>
                    <Button 
                        variant={hasChanges ? "contained" : "text"}
                        disabled={!hasChanges || isNaN(formulateTimeoutSeconds) || formulateTimeoutSeconds <= 0 || formulateTimeoutSeconds > 3600
                            || isNaN(defaultChartWidth) || defaultChartWidth <= 0 || defaultChartWidth > 1000
                            || isNaN(defaultChartHeight) || defaultChartHeight <= 0 || defaultChartHeight > 1000
                            || isNaN(maxStretchFactor) || maxStretchFactor < 1 || maxStretchFactor > 5
                            || isNaN(frontendRowLimit) || frontendRowLimit < 100 || frontendRowLimit > rowLimitMax}
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

const ErrorBoundaryFallback: React.FC = () => {
    const { t } = useTranslation();
    return (
        <Box sx={{ width: "100%", height: "100%", display: "flex" }}>
            <Typography color="gray" sx={{ margin: "150px auto" }}>
                {t('workspace.errorOccurred')} <Link href="/app">{t('workspace.refreshSession')}</Link>{'. '}{t('workspace.errorPersistHint')}
            </Typography>
        </Box>
    );
};

const AppShell: FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const { t } = useTranslation();
    const location = useLocation();
    const viewMode = useSelector((state: DataFormulatorState) => state.viewMode);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);

    // Auto-persist session state to the active workspace (debounced)
    useAutoSave();
    // Auto-name workspace after first table + model are available
    useWorkspaceAutoName();
    const generatedReports = useSelector((state: DataFormulatorState) => state.generatedReports);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);

    const isAboutPage = location.pathname === '/about';
    const isGalleryPage = location.pathname === '/gallery';
    const isAppPage = !isAboutPage && !isGalleryPage;

    return (
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
                <AppBar position="static">
                    <Toolbar variant="dense" sx={{ height: 40, minHeight: 36, position: 'relative', pl: '0px !important' }}>
                        <Box sx={{ width: 40, minWidth: 40, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            <Box component="img" sx={{ height: 20 }} alt="" src={dfLogo} />
                        </Box>
                        <Button sx={{
                            display: "flex", flexDirection: "row", textTransform: "none",
                            alignItems: 'stretch',
                            backgroundColor: 'transparent',
                            minWidth: 0,
                            px: 0.5,
                            "&:hover": {
                                backgroundColor: "transparent"
                            }
                        }} color="inherit">
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
                            <TopNavButton to="/about" label={t('appBar.about')} selected={isAboutPage} />
                            <TopNavButton to="/app" label={t('appBar.app')} selected={isAppPage} />
                            <TopNavButton to="/gallery" label={t('appBar.gallery')} selected={isGalleryPage} />
                        </Box>
                        {tables.length === 0 && !activeWorkspace && (
                            <Typography noWrap sx={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', fontWeight: 500, fontSize: '0.65rem', color: 'text.disabled', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                                {t('appBar.microsoftResearch')}
                            </Typography>
                        )}
                        {/* Centered workspace name — acts as session indicator/switcher */}
                        {activeWorkspace && isAppPage && (
                            <Box sx={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center' }}>
                                <WorkspaceMenu />
                                <NewSessionButton />
                            </Box>
                        )}
                        {isAppPage && (
                            <Box sx={{ display: 'flex', ml: 'auto', fontSize: 14 }}>
                                <LanguageSwitcher />
                                {focusedId !== undefined && <React.Fragment>
                                <ConfigDialog />
                                <Divider orientation="vertical" variant="middle" flexItem /></React.Fragment>}
                                <ModelSelectionButton />
                            </Box>
                        )}
                        {isGalleryPage && (
                            <Box sx={{ display: 'flex', ml: 'auto', fontSize: 14, alignItems: 'center' }}>
                                <LanguageSwitcher />
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
                        <AuthButton />
                    </Toolbar>
                </AppBar>
                <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', '& > div': { height: '100%' } }}>
                    <Outlet />
                </Box>
                <MessageSnackbar />
                <ChartRenderService />
            </Box>
        </Box>
    );
}

export const AppFC: FC<AppFCProps> = function AppFC(appProps) {

    const dispatch = useDispatch<AppDispatch>();
    const { t } = useTranslation();
    const rawPaletteKey = useSelector((state: DataFormulatorState) => state.config.paletteKey);
    const activePaletteKey = (rawPaletteKey && palettes[rawPaletteKey]) ? rawPaletteKey : defaultPaletteKey;

    const [configLoaded, setConfigLoaded] = useState(false);

    useEffect(() => {
        fetchWithIdentity(getUrls().APP_CONFIG)
            .then(response => response.json())
            .then(data => {
                dispatch(dfActions.setServerConfig(data));
                setConfigLoaded(true);
            });
    }, []);

    // Validate persisted workspace still exists on the backend
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    
    // Debug: log persisted state on startup
    useEffect(() => {
        if (configLoaded) {
            console.log('[DEBUG] activeWorkspace:', activeWorkspace);
            console.log('[DEBUG] tables:', tables.length, tables.map(t => ({ id: t.id, virtual: t.virtual, rowLen: t.rows?.length })));
            
            // Recover orphaned state: tables exist but activeWorkspace was lost
            if (!activeWorkspace && tables.length > 0) {
                const recoveredId = `recovered_${Date.now()}`;
                dispatch(dfActions.setActiveWorkspace({ id: recoveredId, displayName: t('workspace.recoveredSession') }));
            }
        }
    }, [configLoaded]);

    // Unified auth initialisation — driven by /api/auth/info and server IDENTITY
    const [authChecked, setAuthChecked] = useState(false);
    const [migrationBrowserId, setMigrationBrowserId] = useState<string | null>(null);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);

    useEffect(() => {
        if (!configLoaded) return;

        (async () => {
            const prevType = localStorage.getItem('df_identity_type');
            const prevBrowserId = localStorage.getItem('df_browser_id');

            let resolvedIdentity: { type: 'user' | 'browser' | 'local'; id: string; displayName?: string } | null = null;

            // Check if the server assigned a fixed identity (e.g. localhost mode)
            const serverIdentity = serverConfig?.IDENTITY;
            if (serverIdentity?.type === 'local' && serverIdentity?.id) {
                resolvedIdentity = { type: 'local', id: serverIdentity.id };
            }

            if (!resolvedIdentity) {
                try {
                    const info: AuthInfo | null = await getAuthInfo();

                    if (info?.action === 'backend') {
                        // Backend OIDC — identity from server session
                        try {
                            const resp = await fetch(info.status_url || '/api/auth/oidc/status');
                            const status = await resp.json();
                            if (status.authenticated && status.user) {
                                resolvedIdentity = {
                                    type: 'user',
                                    id: status.user.sub || status.user.id || 'session_user',
                                    displayName: status.user.name ?? undefined,
                                };
                            }
                        } catch {
                            // fall through to browser identity
                        }
                    } else if (info?.action === 'frontend') {
                        // OIDC PKCE — check for an existing session
                        const user = await getOidcUser();
                        if (user && !user.expired) {
                            resolvedIdentity = {
                                type: 'user',
                                id: user.profile.sub,
                                displayName: user.profile.name ?? undefined,
                            };
                        }
                    } else if (info?.action === 'transparent') {
                        // Azure App Service EasyAuth — headers injected by Azure
                        try {
                            const resp = await fetch('/.auth/me');
                            const result = await resp.json();
                            if (Array.isArray(result) && result.length > 0) {
                                const authData = result[0];
                                const name = authData['user_claims']?.find((item: any) => item.typ === 'name')?.val || '';
                                const userId = authData['user_id'];
                                if (userId) {
                                    resolvedIdentity = { type: 'user', id: userId, displayName: name };
                                }
                            }
                        } catch {
                            // fall through to browser identity
                        }
                    }
                    // 'redirect' and 'none' → browser identity (resolvedIdentity stays null)
                } catch {
                    // fall through to browser identity
                }
            }

            if (!resolvedIdentity) {
                resolvedIdentity = { type: 'browser', id: getBrowserId() };
            }

            dispatch(dfActions.setIdentity(resolvedIdentity));

            // Persist current identity type for next page load
            localStorage.setItem('df_identity_type', resolvedIdentity.type);
            if (resolvedIdentity.type === 'browser') {
                localStorage.setItem('df_browser_id', resolvedIdentity.id);
            }

            // Detect anonymous → authenticated transition
            if (
                prevType === 'browser' &&
                resolvedIdentity.type === 'user' &&
                prevBrowserId
            ) {
                setMigrationBrowserId(prevBrowserId);
            }

            setAuthChecked(true);
        })();
    }, [configLoaded]);

    useEffect(() => {
        document.title = toolName;
        // Load all server-configured models instantly (no connectivity check).
        // Users can verify connectivity via the "Test" button in the model dialog,
        // or errors will surface naturally when a model is first used.
        dispatch(fetchGlobalModelList());
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
        transitions: {
            duration: {
                shortest: 100,
                shorter: 100,
                short: 100,
                standard: 100,
                complex: 150,
                enteringScreen: 100,
                leavingScreen: 100,
            },
        },
    });

    const router = useMemo(() => createBrowserRouter([
        {
            path: "/auth/callback",
            element: <OidcCallback />,
        },
        {
            path: "/",
            element: <AppShell />,
            errorElement: <ErrorBoundaryFallback />,
            children: [
                {
                    index: true,
                    element: <DataFormulatorFC />,
                },
                {
                    path: "app",
                    element: <DataFormulatorFC />,
                },
                {
                    path: "about",
                    element: <About />,
                },
                {
                    path: "gallery",
                    element: <ChartGallery />,
                },
                {
                    path: "*",
                    element: <DataFormulatorFC />,
                },
            ],
        }
    ]), []);

    return (
        <ThemeProvider theme={theme}>
            {configLoaded ? (
                <RouterProvider router={router} />
            ) : (
                <AnvilLoader />
            )}
            {migrationBrowserId && (
                <IdentityMigrationDialog
                    oldBrowserId={migrationBrowserId}
                    onDone={() => setMigrationBrowserId(null)}
                />
            )}
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
