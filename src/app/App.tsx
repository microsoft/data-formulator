// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ScrollFadeEdge, useScrollFade } from '../components/ScrollFade';
import '../scss/App.scss';

import { useDispatch, useSelector } from "react-redux";
import {
    DataFormulatorState,
    dfActions,
    dfSelectors,
    fetchGlobalModelList,
    DEFAULT_ROW_LIMIT,
    DEFAULT_CHART_THEME_ID,
    resolveDefaultChartTheme,
    spaceChartThemeId,
} from './dfSlice'
import { setSpaceTheme, type SavedTheme } from './savedThemes';
import { getBrowserId, generateUUID } from './identity';
import type { AuthInfo } from './oidcConfig';
import { OidcCallback } from './OidcCallback';
import { AuthButton } from './AuthButton';
import { IdentityMigrationDialog } from './IdentityMigrationDialog';

import { red, purple, blue, brown, yellow, orange, } from '@mui/material/colors';
import { palettes, defaultPaletteKey, paletteKeys, ink, paper, weight } from './tokens';

import _ from 'lodash';

import {
    Button,
    Tooltip,
    Typography,
    Box,
    ButtonBase,
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
    IconButton,
    Select,
    FormControl,
    InputLabel,
    ListItemIcon,
    ListItemText,
    LinearProgress,
    GlobalStyles,
} from '@mui/material';


import MuiAppBar from '@mui/material/AppBar';
import { styled, ThemeProvider, useTheme } from '@mui/material/styles';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ClearIcon from '@mui/icons-material/Clear';

import { DataFormulatorFC } from '../views/DataFormulator';
import { themeIconUrl, useThemeChoices } from '../views/ChartThemePicker';
import { LayoutProvider, useLayout, type DensityPreference } from './LayoutProvider';
import { createDfTheme } from './theme';
import { applyLookVariables, DEFAULT_LOOK, LOOK_NAMES, LOOKS, saveLook, useLook, type Look } from './look';
import { setChartInk } from './savedThemes';
import { MIN_SUPPORTED } from './layout';
import { useAutoSave } from './useAutoSave';
import { SESSION_PARAM } from './sessionTabs';
import { useWorkspaceConsistency } from './workspaceConsistency';
import { useWorkspaceAutoName } from './useWorkspaceAutoName';

import GridViewIcon from '@mui/icons-material/GridView';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import {
    createBrowserRouter,
    Link as RouterLink,
    Navigate,
    Outlet,
    RouterProvider,
    useLocation,
    useNavigate,
    useRouteError,
    useSearchParams,
} from "react-router-dom";
import { ConfigurationView } from '../views/ConfigurationView';
import { MessageSnackbar } from '../views/MessageSnackbar';
import { SessionWormhole } from '../views/SessionWormhole';
import { ChartRenderService } from '../views/ChartRenderService';
import { DictTable } from '../components/ComponentType';
import { AppDispatch } from './store';
import dfLogo from '../assets/df-logo.svg';
import { AnvilLoader } from '../components/AnvilLoader';
import { ModelSelectionButton } from '../views/ModelSelectionDialog';
import { LogViewerDialog } from '../views/LogViewerDialog';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { SessionMenu, SessionShareButton, useSessionShareItems } from '../views/SessionMenu';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import SaveIcon from '@mui/icons-material/Save';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { getUrls } from './utils';
import { APP_PATH, SPACE_ID, spacePath } from './space';
import { AppSwitcher, PathSlash, destinationItems, useAppDestinations, type AppDestination } from './AppSwitcher';
import { apiRequest } from './apiClient';
import { leaveSession } from './sessionThunks';
import store, { persistor } from './store';
import { useSessionTabs } from './useSessionTabs';
import { UnifiedDataUploadDialog } from '../views/UnifiedDataUploadDialog';
import ChatIcon from '@mui/icons-material/Chat';
import ArticleIcon from '@mui/icons-material/Article';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import GitHubIcon from '@mui/icons-material/GitHub';
import UploadIcon from '@mui/icons-material/Upload';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PublicIcon from '@mui/icons-material/Public';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_UI_LANGUAGES } from '../i18n';
import { syncVegaLocale } from '../i18n/vega-locale';
import { iconVar, textVar } from './layout';

const AppBar = styled(MuiAppBar)(({ theme }) => ({
    color: ink(1),
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
            fontSize: textVar.md,
            fontWeight: weight(400),
            border: 'none',
            borderRadius: 0,
            px: 1.5,
            py: 0.5,
            minWidth: 'auto',
            cursor: selected ? 'default' : 'pointer',
            color: selected ? 'text.primary' : 'text.secondary',
            backgroundColor: selected ? ink(0.08) : 'transparent',
            '&:hover': {
                color: 'text.primary',
                backgroundColor: selected ? ink(0.08) : ink(0.04),
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
export const getToolName = (customName?: string) => customName?.trim() || toolName;

const LANGUAGE_LABELS: Record<string, string> = {
    en: 'EN',
    zh: '中文',
    hi: 'हिन्दी',
    id: 'Bahasa Indonesia',
    ja: '日本語',
    ko: '한국어',
    fr: 'FR',
    de: 'DE',
    es: 'ES',
    pt: 'PT',
    ru: 'RU',
};

const LanguageSwitcher: React.FC = () => {
    const { i18n } = useTranslation();
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

    if (SUPPORTED_UI_LANGUAGES.length <= 1) return null;
    const current = i18n.language.split('-')[0];

    return (
        <>
            <Button
                size="small"
                color="inherit"
                aria-haspopup="menu"
                aria-expanded={Boolean(anchorEl)}
                onClick={(event) => setAnchorEl(event.currentTarget)}
                endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 16 }} />}
                sx={{
                    minWidth: 0,
                    height: 28,
                    px: 0.75,
                    color: 'text.secondary',
                    fontSize: textVar.sm,
                    fontWeight: weight(400),
                    textTransform: 'none',
                    '& .MuiButton-endIcon': { ml: 0.25 },
                }}
            >
                {LANGUAGE_LABELS[current] || current.toUpperCase()}
            </Button>
            <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={() => setAnchorEl(null)}
            >
                {SUPPORTED_UI_LANGUAGES.map(lang => (
                    <MenuItem
                        key={lang}
                        selected={lang === current}
                        onClick={() => {
                            i18n.changeLanguage(lang);
                            setAnchorEl(null);
                        }}
                        sx={menuItemSx}
                    >
                        <ListItemText primaryTypographyProps={{ fontSize: textVar.sm }}>
                            {LANGUAGE_LABELS[lang] || lang.toUpperCase()}
                        </ListItemText>
                        {lang === current && <CheckIcon sx={{ ml: 1, fontSize: 14, color: 'text.secondary' }} />}
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
};

/**
 * Below this toolbar width the app bar collapses to a phone-style layout:
 * the page switcher becomes a dropdown and the trailing controls fold into
 * a single overflow menu. Measured on the toolbar itself (not the viewport)
 * because the app shell floors its content width and scrolls horizontally.
 */
const COMPACT_TOOLBAR_WIDTH = 900;

const useIsNarrow = (ref: React.RefObject<HTMLElement | null>, threshold: number) => {
    const [narrow, setNarrow] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (!element || typeof ResizeObserver === 'undefined') return;
        const update = () => setNarrow(element.getBoundingClientRect().width < threshold);
        update();
        const ro = new ResizeObserver(update);
        ro.observe(element);
        return () => ro.disconnect();
    }, [ref, threshold]);
    return narrow;
};

/**
 * Whether the header's path fits with "Data Formulator" spelled out (in a space). It adds back what the path leaves
 * out or cuts short (the words while they are hidden, and each name's hidden ellipsis up to its maximum width), so
 * hiding the words to make room does not bring them straight back.
 */
const usePathSpelledOut = (toolbar: React.RefObject<HTMLElement | null>, path: React.RefObject<HTMLElement | null>,
    actions: React.RefObject<HTMLElement | null>, active: boolean) => {
    const [spellOut, setSpellOut] = useState(true);
    const productWidth = useRef(0);
    useEffect(() => {
        if (!active || typeof ResizeObserver === 'undefined') { setSpellOut(true); return; }
        const GAP = 16;
        const update = () => {
            const bar = toolbar.current?.getBoundingClientRect();
            const element = path.current;
            if (!bar || !element) return;
            const product = element.querySelector<HTMLElement>('[data-path-product]');
            if (product) productWidth.current = product.offsetWidth;
            const cut = [...element.querySelectorAll<HTMLElement>('h1, p')].reduce((sum, text) => {
                const max = parseFloat(getComputedStyle(text).maxWidth);
                return sum + Math.max(0, Math.min(text.scrollWidth, Number.isFinite(max) ? max : text.scrollWidth) - text.clientWidth);
            }, 0);
            const needed = element.getBoundingClientRect().width + cut + (product ? 0 : productWidth.current);
            const right = actions.current?.getBoundingClientRect().left ?? bar.right;
            setSpellOut(element.getBoundingClientRect().left + needed + GAP <= right);
        };
        update();
        const observer = new ResizeObserver(update);
        for (const element of [toolbar.current, path.current, actions.current]) if (element) observer.observe(element);
        return () => observer.disconnect();
    }, [toolbar, path, actions, active]);
    return spellOut;
};

const menuItemSx = { fontSize: textVar.md, minHeight: 34, py: 0.5 };

/** Language options rendered as menu rows for the compact overflow menu. */
const LanguageMenuItems: React.FC<{ onSelect: () => void }> = ({ onSelect }) => {
    const { i18n } = useTranslation();

    if (SUPPORTED_UI_LANGUAGES.length <= 1) return null;
    const current = i18n.language.split('-')[0];

    return (
        <>
            {SUPPORTED_UI_LANGUAGES.map(lang => (
                <MenuItem
                    key={lang}
                    selected={lang === current}
                    onClick={() => { i18n.changeLanguage(lang); onSelect(); }}
                    sx={menuItemSx}
                >
                    <ListItemText primaryTypographyProps={{ fontSize: textVar.sm }}>
                        {LANGUAGE_LABELS[lang] || lang.toUpperCase()}
                    </ListItemText>
                    {lang === current && <CheckIcon sx={{ ml: 1, fontSize: 14, color: 'text.secondary' }} />}
                </MenuItem>
            ))}
        </>
    );
};

/** Compact replacement for the App / Admin top-nav buttons (shown only when Admin is available). */
const PageNavMenu: React.FC<{ isAdministrationPage: boolean; appName: string; destinations: AppDestination[]; onGoHome: (event: React.MouseEvent) => void }> = ({
    isAdministrationPage, appName, destinations, onGoHome,
}) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const pages = [
        { to: APP_PATH, label: t('appBar.app'), selected: !isAdministrationPage },
        { to: '/configurations', label: t('appBar.admin', { defaultValue: 'Admin' }), selected: isAdministrationPage },
    ];
    const currentLabel = pages.find(page => page.selected)?.label ?? '';

    return (
        <>
            <Button
                color="inherit"
                onClick={(event) => setAnchorEl(event.currentTarget)}
                endIcon={<KeyboardArrowDownIcon sx={{ fontSize: iconVar.md, color: 'text.secondary' }} />}
                aria-haspopup="menu"
                sx={{
                    textTransform: 'none',
                    minWidth: 0,
                    px: 0.75,
                    gap: 0.25,
                    '&:hover': { backgroundColor: ink(0.04) },
                }}
            >
                <Box sx={{ minWidth: 0, textAlign: 'left', maxWidth: { xs: 160, sm: 320 } }}>
                    <Typography noWrap component="h1" title={appName} sx={{ fontSize: textVar.xl, fontWeight: weight(400), lineHeight: 1.2, letterSpacing: 0 }}>
                        {appName}
                    </Typography>
                </Box>
                <Typography noWrap sx={{ fontSize: textVar.md, color: 'text.secondary' }}>
                    {`: ${currentLabel}`}
                </Typography>
            </Button>
            <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={() => setAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            >
                {pages.map(page => (
                    <MenuItem
                        key={page.to}
                        selected={page.selected}
                        sx={menuItemSx}
                        onClick={() => {
                            setAnchorEl(null);
                            if (!page.selected) navigate(page.to);
                        }}
                    >
                        <ListItemIcon>
                            {page.selected ? <CheckIcon fontSize="small" /> : null}
                        </ListItemIcon>
                        <ListItemText primaryTypographyProps={{ fontSize: textVar.md }}>
                            {`${appName}: ${page.label}`}
                        </ListItemText>
                    </MenuItem>
                ))}
                {destinations.length > 0 && <Divider />}
                {destinationItems(destinations.filter(destination => !destination.current), onGoHome, () => setAnchorEl(null))}
            </Menu>
        </>
    );
};

const EXTERNAL_LINKS = {
    github: 'https://github.com/microsoft/data-formulator',
};

/**
 * Phone-style overflow menu holding everything that does not fit in a narrow
 * app bar (language, settings, logs, links, exit).
 */
const ToolbarOverflowMenu: React.FC<{
    items: {
        key: string;
        label: string;
        icon: React.ReactNode;
        href?: string;
        onClick?: () => void;
    }[];
    showLanguages?: boolean;
}> = ({ items, showLanguages = true }) => {
    const { t } = useTranslation();
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const close = () => setAnchorEl(null);

    return (
        <>
            <Tooltip title={t('appBar.moreOptions', { defaultValue: 'More options' })}>
                <IconButton
                    size="small"
                    onClick={(event) => setAnchorEl(event.currentTarget)}
                    aria-haspopup="menu"
                    aria-label={t('appBar.moreOptions', { defaultValue: 'More options' })}
                    sx={{
                        p: 0.5,
                        color: 'text.secondary',
                        '&:hover': { color: 'text.primary', backgroundColor: ink(0.04) },
                    }}
                >
                    <MoreVertIcon fontSize="small" />
                </IconButton>
            </Tooltip>
            <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={close}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: { sx: { minWidth: 200 } } }}
            >
                {showLanguages && <LanguageMenuItems onSelect={close} />}
                {showLanguages && items.length > 0 && <Divider />}
                {items.map(item => (
                    <MenuItem
                        key={item.key}
                        sx={menuItemSx}
                        {...(item.href
                            ? { component: 'a' as const, href: item.href, target: '_blank', rel: 'noopener noreferrer' }
                            : {})}
                        onClick={() => { close(); item.onClick?.(); }}
                    >
                        <ListItemIcon>{item.icon}</ListItemIcon>
                        <ListItemText primaryTypographyProps={{ fontSize: textVar.md }}>{item.label}</ListItemText>
                    </MenuItem>
                ))}
            </Menu>
        </>
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


/** `/`: the standard app, or the server's default space (`DF_SPACE`), which loads as its own page. */
const HomePage: React.FC = () => {
    const defaultSpace = useSelector((state: DataFormulatorState) => state.serverConfig.DEFAULT_SPACE);
    const redirect = !SPACE_ID && !!defaultSpace;
    useEffect(() => {
        if (redirect) window.location.replace(`${spacePath(defaultSpace!)}${window.location.search}${window.location.hash}`);
    }, [redirect, defaultSpace]);
    return redirect ? null : <DataFormulatorFC />;
};

/**
 * The logo and app name go to the landing page: the open session is saved
 * and closed, and Admin switches back to the app. Modified clicks keep
 * the link's default (e.g. open in a new tab).
 */
const useGoHome = (onAppPage: boolean) => {
    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    return useCallback(async (event: React.MouseEvent) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        if (dfSelectors.selectInSession(store.getState())) await dispatch(leaveSession());
        if (!onAppPage) navigate(APP_PATH);
    }, [dispatch, navigate, onAppPage]);
};


/**
 * Settings dialog. Renders its own icon-button trigger by default; the
 * compact toolbar hides the trigger and drives `open` from its overflow menu.
 */
const FLINT_DEFAULT_THEME_VALUE = '__flint_default__';

const ConfigDialog: React.FC<{
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    hideTrigger?: boolean;
}> = ({ open: openProp, onOpenChange, hideTrigger = false }) => {
    const [openState, setOpenState] = useState(false);
    const open = openProp ?? openState;
    const setOpen = useCallback((value: boolean) => {
        setOpenState(value);
        onOpenChange?.(value);
    }, [onOpenChange]);
    const dispatch = useDispatch();
    const { t } = useTranslation();
    const config = useSelector((state: DataFormulatorState) => state.config);
    const rowLimitDefault = DEFAULT_ROW_LIMIT;
    const rowLimitMax = DEFAULT_ROW_LIMIT;


    const [formulateTimeoutSeconds, setFormulateTimeoutSeconds] = useState(config.formulateTimeoutSeconds ?? 180);
    const [defaultChartWidth, setDefaultChartWidth] = useState(config.defaultChartWidth ?? 300);
    const [defaultChartHeight, setDefaultChartHeight] = useState(config.defaultChartHeight ?? 300);
    const [maxStretchFactor, setMaxStretchFactor] = useState(config.maxStretchFactor ?? 1.5);
    const [frontendRowLimit, setFrontendRowLimit] = useState(config.frontendRowLimit ?? rowLimitDefault);
    const [paletteKey, setPaletteKey] = useState(
        (config.paletteKey && palettes[config.paletteKey]) ? config.paletteKey : defaultPaletteKey
    );
    // The look, like the display size, is this browser's preference, not the session's.
    const savedLook = useLook();
    const [look, setLook] = useState<Look>(savedLook);
    const spaceThemeId = useSelector(spaceChartThemeId);
    const configChartThemeId = resolveDefaultChartTheme(config, spaceThemeId) ?? '';
    const [defaultChartThemeId, setDefaultChartThemeId] = useState(configChartThemeId);
    const themeChoices = useThemeChoices();
    // UI size is a per-browser preference: Auto follows the window width, the others pin it.
    const { densityPreference, setDensityPreference } = useLayout();
    const [displaySize, setDisplaySize] = useState<DensityPreference>(densityPreference);

    const hasChanges = formulateTimeoutSeconds !== config.formulateTimeoutSeconds || 
                      defaultChartWidth !== config.defaultChartWidth ||
                      defaultChartHeight !== config.defaultChartHeight ||
                      maxStretchFactor !== config.maxStretchFactor ||
                      frontendRowLimit !== config.frontendRowLimit ||
                      paletteKey !== ((config.paletteKey && palettes[config.paletteKey]) ? config.paletteKey : defaultPaletteKey) ||
                      defaultChartThemeId !== configChartThemeId ||
                      look !== savedLook ||
                      displaySize !== densityPreference;

    return (
        <>
            {!hideTrigger && (
            <Tooltip title={t('app.settings')}>
                <IconButton
                    size="small"
                    onClick={() => setOpen(true)}
                    aria-label={t('app.settings')}
                    sx={{
                        p: 0.5,
                        color: 'text.secondary',
                        '&:hover': { color: 'text.primary', backgroundColor: ink(0.04) },
                    }}
                >
                    <SettingsOutlinedIcon fontSize="small" />
                </IconButton>
            </Tooltip>
            )}
            <Dialog onClose={() => setOpen(false)} open={open}>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, px: 3, py: 2 }}>
                    <Typography component="span" sx={{ fontSize: textVar.xl, fontWeight: weight(600), flex: 1 }}>
                        {t('app.settings')}
                    </Typography>
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: 2,
                        maxWidth: 400
                    }}>
                        <Divider><Typography variant="caption">{t('config.frontend')}</Typography></Divider>
                        <FormControl fullWidth size="small">
                            <InputLabel id="palette-select-label" sx={{ fontSize: textVar.md }}>{t('config.colorTheme')}</InputLabel>
                            <Select
                                labelId="palette-select-label"
                                value={paletteKey}
                                label={t('config.colorTheme')}
                                onChange={(e) => setPaletteKey(e.target.value)}
                                sx={{ fontSize: textVar.md }}
                                renderValue={(key) => {
                                    const p = palettes[key];
                                    return (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: p.primary.main, flexShrink: 0 }} />
                                            <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: p.custom.main, flexShrink: 0 }} />
                                            <Typography sx={{ fontSize: textVar.md }}>{p.name}</Typography>
                                        </Box>
                                    );
                                }}
                            >
                                {paletteKeys.map(key => {
                                    const p = palettes[key];
                                    return (
                                        <MenuItem key={key} value={key} sx={{ py: 0.5 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 1.5 }}>
                                                <Box sx={{ width: 14, height: 14, borderRadius: '50%', backgroundColor: p.primary.main, border: `1px solid ${ink(0.1)}` }} />
                                                <Box sx={{ width: 14, height: 14, borderRadius: '50%', backgroundColor: p.custom.main, border: `1px solid ${ink(0.1)}` }} />
                                            </Box>
                                            <ListItemText primary={p.name} slotProps={{ primary: { sx: { fontSize: textVar.md } } }} />
                                        </MenuItem>
                                    );
                                })}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth size="small">
                            <InputLabel id="chart-theme-select-label" sx={{ fontSize: textVar.md }}>{t('config.defaultChartTheme')}</InputLabel>
                            <Select
                                labelId="chart-theme-select-label"
                                value={defaultChartThemeId || FLINT_DEFAULT_THEME_VALUE}
                                label={t('config.defaultChartTheme')}
                                onChange={(e) => setDefaultChartThemeId(e.target.value === FLINT_DEFAULT_THEME_VALUE ? '' : e.target.value)}
                                sx={{ fontSize: textVar.md }}
                                MenuProps={{ slotProps: { paper: { sx: { maxHeight: 320 } } } }}
                            >
                                {themeChoices.map(choice => (
                                    <MenuItem key={choice.id ?? FLINT_DEFAULT_THEME_VALUE} value={choice.id ?? FLINT_DEFAULT_THEME_VALUE}
                                        title={choice.description} sx={{ py: 0.5 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Box component="img" src={themeIconUrl(choice.icon)} alt="" sx={{ width: 14, height: 14, display: 'block' }} />
                                            <Typography sx={{ fontSize: textVar.md }}>{choice.label}</Typography>
                                        </Box>
                                    </MenuItem>
                                ))}
                            </Select>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                                {t('config.defaultChartThemeHint')}
                            </Typography>
                        </FormControl>
                        <Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography id="contrast-label" sx={{ flex: 1, fontSize: textVar.md }}>{t('config.contrast')}</Typography>
                                <ToggleButtonGroup size="small" exclusive value={look} aria-labelledby="contrast-label"
                                    onChange={(_, value: Look | null) => value && setLook(value)}
                                    sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 1.25, fontSize: textVar.sm, textTransform: 'none' } }}>
                                    {LOOK_NAMES.map(name => <ToggleButton key={name} value={name}>
                                        {t(`config.contrast${name[0].toUpperCase()}${name.slice(1)}`)}</ToggleButton>)}
                                </ToggleButtonGroup>
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                {t('config.contrastHint')}
                            </Typography>
                        </Box>
                        <FormControl fullWidth size="small">
                            <InputLabel id="display-size-label" sx={{ fontSize: textVar.md }}>{t('config.displaySize')}</InputLabel>
                            <Select
                                labelId="display-size-label"
                                value={displaySize}
                                label={t('config.displaySize')}
                                onChange={(e) => setDisplaySize(e.target.value as DensityPreference)}
                                sx={{ fontSize: textVar.md }}
                            >
                                {([['auto', 'displaySizeAuto'], ['compact', 'displaySizeSmall'], ['reference', 'displaySizeMedium'],
                                    ['comfortable', 'displaySizeLarge']] as const).map(([value, key]) => (
                                    <MenuItem key={value} value={value} sx={{ fontSize: textVar.md }}>{t(`config.${key}`)}</MenuItem>
                                ))}
                            </Select>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                                {t('config.displaySizeHint')}
                            </Typography>
                        </FormControl>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Box sx={{ flex: 1 }}>
                                <TextField
                                    label={t('config.defaultChartWidth')}
                                    size="small"
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
                                    size="small"
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
                                    size="small"
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
                                    size="small"
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
                                    size="small"
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
                <DialogActions sx={{ px: 3, py: 1.5, gap: 0.5, '.MuiButton-root': { textTransform: 'none' } }}>
                    <Button sx={{marginRight: 'auto'}} onClick={() => {
                        setFormulateTimeoutSeconds(180);
                        setDefaultChartWidth(300);
                        setDefaultChartHeight(300);
                        setMaxStretchFactor(2.0);
                        setFrontendRowLimit(rowLimitDefault);
                        setPaletteKey(defaultPaletteKey);
                        setLook(DEFAULT_LOOK);
                        setDefaultChartThemeId(spaceThemeId ?? DEFAULT_CHART_THEME_ID);
                        setDisplaySize('auto');
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
                            dispatch(dfActions.setConfig({formulateTimeoutSeconds, defaultChartWidth, defaultChartHeight, maxStretchFactor, frontendRowLimit, paletteKey, defaultChartThemeId}));
                            saveLook(look);
                            setDensityPreference(displaySize);
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
    const routeError = useRouteError() as any;
    const [logsOpen, setLogsOpen] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    // Read the desktop flag off the URL rather than the store — the store may be
    // exactly what failed, and this screen has to render regardless.
    const isDesktopApp = new URLSearchParams(window.location.search).get('desktop') === '1';
    const detail = routeError?.message || (typeof routeError === 'string' ? routeError : '');
    const stack = typeof routeError?.stack === 'string' ? routeError.stack : '';
    const mutedActionSx = {
        minWidth: 0, px: 0.5,
        color: 'text.disabled', fontSize: '0.7rem', fontWeight: weight(400),
        textTransform: 'none',
        '&:hover': { color: 'text.secondary', backgroundColor: 'transparent' },
    } as const;
    return (
        <Box sx={{ width: "100%", height: "100%", display: "flex" }}>
            <Box sx={{
                margin: "150px auto",
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                maxWidth: 640, px: 2,
            }}>
                <Typography color="gray">
                    {t('workspace.errorOccurred')} <Link href={APP_PATH}>{t('workspace.refreshSession')}</Link>{'. '}{t('workspace.errorPersistHint')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {(detail || stack) && (
                        <Button
                            variant="text"
                            size="small"
                            startIcon={<KeyboardArrowDownIcon sx={{
                                fontSize: 15,
                                transform: detailsOpen ? 'rotate(180deg)' : 'none',
                                transition: 'transform 0.15s',
                            }} />}
                            onClick={() => setDetailsOpen(open => !open)}
                            sx={mutedActionSx}
                        >
                            View error details
                        </Button>
                    )}
                    {isDesktopApp && (
                        <Button
                            variant="text"
                            size="small"
                            startIcon={<TerminalOutlinedIcon sx={{ fontSize: 15 }} />}
                            onClick={() => setLogsOpen(true)}
                            sx={mutedActionSx}
                        >
                            Open console
                        </Button>
                    )}
                </Box>
                {detailsOpen && (detail || stack) && (
                    <Typography
                        component="pre"
                        sx={{
                            fontFamily: 'var(--df-font-mono)', fontSize: '0.65rem', color: 'text.disabled',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                            m: 0, maxHeight: 260, overflowY: 'auto', textAlign: 'left',
                            width: '100%',
                        }}
                    >
                        {[detail, stack].filter(Boolean).join('\n\n')}
                    </Typography>
                )}
                {isDesktopApp && <LogViewerDialog open={logsOpen} onOpenChange={setLogsOpen} hideTrigger />}
            </Box>
        </Box>
    );
};

const AUTH_ERROR_MESSAGES: Record<string, string> = {
    access_denied: 'auth.ssoErrorAccessDenied',
    invalid_state: 'auth.ssoErrorInvalidState',
    invalid_client: 'auth.ssoErrorInvalidClient',
    token_exchange_failed: 'auth.ssoErrorTokenExchange',
    missing_token_endpoint: 'auth.ssoErrorMissingEndpoint',
};


const AppShell: FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const { t } = useTranslation();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const viewMode = useSelector((state: DataFormulatorState) => state.viewMode);
    const tables = useSelector(dfSelectors.getAllTables);
    const inWorkspaceSession = useSelector(dfSelectors.selectInSession);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);

    useEffect(() => {        const authError = searchParams.get('auth_error');
        if (!authError) return;
        const i18nKey = AUTH_ERROR_MESSAGES[authError] || 'auth.ssoErrorGeneric';
        dispatch(dfActions.addMessages({
            type: 'error',
            component: 'auth',
            timestamp: Date.now(),
            value: t(i18nKey, { defaultValue: 'SSO login failed. Please contact your administrator.' }),
        }));
        searchParams.delete('auth_error');
        setSearchParams(searchParams, { replace: true });
    }, []);

    // Each tab owns the session named in its URL; tabs hand sessions off safely.
    useSessionTabs();
    // Auto-persist session state to the active workspace (debounced)
    useAutoSave();
    // Flag session tables whose data the workspace does not hold
    useWorkspaceConsistency();
    // Auto-name workspace after first table + model are available
    useWorkspaceAutoName();
    const generatedReports = useSelector((state: DataFormulatorState) => state.generatedReports);

    const isAdministrationPage = location.pathname === '/configurations';
    const canAdminister = !!serverConfig.MANAGED_MODE && !!serverConfig.CAN_CONFIGURE;
    const appName = getToolName(serverConfig.APP_NAME);
    const isAppPage = !isAdministrationPage;

    // The desktop canvas (threads, encoding shelf, viz cards) genuinely needs
    // room, so the app shell floors content at MIN_SUPPORTED. Landing and phone
    // workspace views reflow instead; the media override below removes the
    // desktop floor when Thread and Canvas become alternate full-width views.
    const isLandingView = isAppPage && !inWorkspaceSession;
    const shellMinWidth = isLandingView || location.pathname === '/configurations' ? 0 : `${MIN_SUPPORTED.width}px`;

    // Narrow toolbars fold their controls into menus instead of letting the
    // nav buttons, session name and trailing actions overlap.
    const toolbarRef = useRef<HTMLDivElement | null>(null);
    const isCompactToolbar = useIsNarrow(toolbarRef, COMPACT_TOOLBAR_WIDTH);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const goHome = useGoHome(isAppPage);
    const destinations = useAppDestinations();
    const shareItems = useSessionShareItems();
    const pathRef = useRef<HTMLDivElement | null>(null);
    const actionsRef = useRef<HTMLDivElement | null>(null);
    const spellOut = usePathSpelledOut(toolbarRef, pathRef, actionsRef, !!SPACE_ID && !isCompactToolbar);
    const inSession = isAppPage && inWorkspaceSession;
    const shellScrollRef = useRef<HTMLDivElement | null>(null);
    const { moreAbove, moreBelow, moreLeft, moreRight, update: updateShellFade } = useScrollFade(shellScrollRef, location.pathname);
    const shellFade = { top: moreAbove, bottom: moreBelow, left: moreLeft, right: moreRight };

    return (
        // The shell scrolls when the window is below the supported size; the
        // fades mark the hidden side like other scrolling surfaces.
        <Box sx={{ position: 'absolute', inset: 0 }}>
        <Box ref={shellScrollRef} onScroll={updateShellFade} sx={{
            position: 'absolute',
            backgroundColor: paper(0.3),
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            overflow: 'auto',
            '& > *': {
                minWidth: shellMinWidth,
                minHeight: `${MIN_SUPPORTED.height}px`,
                '@media (max-width: 700px)': {
                    minWidth: 0,
                },
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
                    <Toolbar ref={toolbarRef} variant="dense" sx={{ height: 40, minHeight: 36, position: 'relative', pl: '0px !important',
                        // Controls are shorter than the bar and centred in it; stretch each one's hit area to the
                        // bar's full height, so a pointer thrown to the top edge (maximized window) still lands on it.
                        '& :is(a, button)': { position: 'relative' },
                        '& :is(a, button)::after': { content: '""', position: 'absolute', left: 0, right: 0, top: '50%', height: 40, transform: 'translateY(-50%)' },
                        // A click that moves a pixel would otherwise drag the link or logo, or select the name, and not click.
                        userSelect: 'none',
                    }} onDragStart={(event) => event.preventDefault()}>
                        {/* The path's first part. In a space it is Data Formulator, the standard app (its own page); in the
                            standard app, its front page. */}
                        <Box
                            {...(SPACE_ID ? { component: 'a', href: '/app' } : { component: RouterLink, to: APP_PATH, onClick: goHome })}
                            aria-label={SPACE_ID ? 'Data Formulator' : t('appBar.home', { defaultValue: 'Home' })}
                            title={SPACE_ID ? 'Data Formulator' : t('appBar.home', { defaultValue: 'Home' })}
                            sx={{ width: 40, minWidth: 40, height: 36, display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                        >
                            <Box component="img" sx={{ height: 20, display: 'block', transform: 'translateY(-2px)' }} alt="" src={dfLogo} />
                        </Box>
                        {isCompactToolbar ? (
                            canAdminister ? (
                                <PageNavMenu isAdministrationPage={isAdministrationPage} appName={appName}
                                    destinations={destinations} onGoHome={goHome} />
                            ) : destinations.length > 0 ? (
                                <AppSwitcher appName={appName} destinations={destinations} onGoHome={goHome} compact last={!inSession} logo={serverConfig.SPACE?.logo} />
                            ) : (
                                <Button component={RouterLink} to={APP_PATH} onClick={goHome} color="inherit"
                                    sx={{ textTransform: 'none', minWidth: 0, px: 0.75, '&:hover': { backgroundColor: ink(0.04) } }}>
                                    <Typography noWrap component="h1" title={appName}
                                        sx={{ maxWidth: { xs: 160, sm: 320 }, fontSize: textVar.xl, fontWeight: weight(400), lineHeight: 1.2, letterSpacing: 0 }}>
                                        {appName}
                                    </Typography>
                                </Button>
                            )
                        ) : (
                        // Brand and page links share a text baseline, whatever the font's metrics.
                        <Box ref={pathRef} sx={{ display: 'flex', alignItems: 'baseline', minWidth: 0 }}>
                        {destinations.length > 0 ? (
                            <Box sx={{ display: { xs: 'none', sm: 'block' }, minWidth: 0 }}>
                                <AppSwitcher appName={appName} destinations={destinations} onGoHome={goHome} last={!inSession} logo={serverConfig.SPACE?.logo} spellOut={spellOut} />
                            </Box>
                        ) : (
                        <Button component={RouterLink} to={APP_PATH} onClick={goHome} sx={{
                            display: "flex", flexDirection: "row", textTransform: "none",
                            alignItems: 'center',
                            backgroundColor: 'transparent',
                            minWidth: 0,
                            height: 36,
                            px: 0.5,
                            "&:hover": {
                                backgroundColor: "transparent"
                            }
                        }} color="inherit">
                            <Box sx={{ minWidth: 0, maxWidth: 360, textAlign: 'left', display: { xs: 'none', sm: 'block' } }}>
                                <Typography noWrap component="h1" title={appName} sx={{ fontWeight: weight(400), lineHeight: 1.2, letterSpacing: 0 }}>
                                    {appName}
                                </Typography>
                            </Box>
                        </Button>
                        )}
                        {/* The open session ends the path: "Data Formulator / <space> / <session>"; its ⌄ switches
                            sessions (the only ⌄ in the path is its last part's). */}
                        {inSession && <Box sx={{ display: 'flex', alignItems: 'center', alignSelf: 'center', minWidth: 0 }}>
                            <PathSlash />
                            <SessionMenu />
                        </Box>}
                        {canAdminister && (
                            <Box
                                sx={{
                                    ml: 2,
                                    height: '28px',
                                    display: 'flex',
                                    alignItems: 'baseline',
                                }}
                            >
                                <TopNavButton to={APP_PATH} label={t('appBar.app')} selected={isAppPage} />
                                <TopNavButton to="/configurations" label={t('appBar.admin', { defaultValue: 'Admin' })} selected={isAdministrationPage} />
                            </Box>
                        )}
                        </Box>
                        )}
                        {/* A narrow toolbar keeps only the current level's name before it; the session follows. */}
                        {inSession && isCompactToolbar && (
                            <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center' }}>
                                <PathSlash compact />
                                <SessionMenu />
                            </Box>
                        )}
                        {isAppPage && isCompactToolbar && (
                            <Box sx={{ display: 'flex', ml: 'auto', alignItems: 'center', gap: 0.5 }}>
                                <ModelSelectionButton />
                                <ConfigDialog open={settingsOpen} onOpenChange={setSettingsOpen} hideTrigger />
                                {serverConfig.IS_LOCAL_MODE && (
                                    <LogViewerDialog open={logsOpen} onOpenChange={setLogsOpen} hideTrigger />
                                )}
                                <ToolbarOverflowMenu
                                    items={[
                                        {
                                            key: 'settings',
                                            label: t('app.settings'),
                                            icon: <SettingsOutlinedIcon fontSize="small" />,
                                            onClick: () => setSettingsOpen(true),
                                        },
                                        ...(serverConfig.IS_LOCAL_MODE ? [{
                                            key: 'logs',
                                            label: t('logs.viewLogs', { defaultValue: 'Open console' }),
                                            icon: <TerminalOutlinedIcon fontSize="small" />,
                                            onClick: () => setLogsOpen(true),
                                        }] : []),
                                        {
                                            key: 'github',
                                            label: t('appBar.viewOnGitHub'),
                                            icon: <GitHubIcon fontSize="small" />,
                                            href: EXTERNAL_LINKS.github,
                                        },
                                        ...(inSession ? shareItems : []),
                                    ]}
                                />
                            </Box>
                        )}
                        {isAppPage && !isCompactToolbar && (
                            <Box ref={actionsRef} sx={{ display: 'flex', ml: 'auto', alignItems: 'center', gap: 0.75 }}>
                                <ModelSelectionButton />
                                <Divider orientation="vertical" variant="middle" flexItem sx={{ my: 1 }} />
                                <LanguageSwitcher />
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                                    <ConfigDialog />
                                    {serverConfig.IS_LOCAL_MODE && <LogViewerDialog />}
                                    <Tooltip title={t('appBar.viewOnGitHub')}>
                                        <IconButton
                                            component="a"
                                            href="https://github.com/microsoft/data-formulator"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            size="small"
                                            aria-label={t('appBar.viewOnGitHub')}
                                            sx={{
                                                p: 0.5,
                                                color: 'text.secondary',
                                                '&:hover': { color: 'text.primary', backgroundColor: ink(0.04) },
                                            }}
                                        >
                                            <GitHubIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    {inSession && <SessionShareButton />}
                                </Box>
                            </Box>
                        )}
                        <AuthButton />
                    </Toolbar>
                </AppBar>
                <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', '& > div': { height: '100%' } }}>
                    <Outlet />
                </Box>
                <MessageSnackbar />
                <SessionWormhole />
                <ChartRenderService />
            </Box>
        </Box>
        {(['top', 'bottom', 'left', 'right'] as const).map(edge => <ScrollFadeEdge key={edge} edge={edge} visible={shellFade[edge]} />)}
        </Box>
    );
}

export const AppFC: FC<AppFCProps> = function AppFC(appProps) {

    const dispatch = useDispatch<AppDispatch>();
    const { t, i18n } = useTranslation();
    const rawPaletteKey = useSelector((state: DataFormulatorState) => state.config.paletteKey);
    const activePaletteKey = (rawPaletteKey && palettes[rawPaletteKey]) ? rawPaletteKey : defaultPaletteKey;
    const look = useLook();

    const [configLoaded, setConfigLoaded] = useState(false);
    const [startupLogsOpen, setStartupLogsOpen] = useState(false);
    const isDesktopApp = useMemo(
        () => new URLSearchParams(window.location.search).get('desktop') === '1',
        [],
    );

    useEffect(() => {
        syncVegaLocale();
        const onLangChanged = () => syncVegaLocale();
        i18n.on('languageChanged', onLangChanged);
        return () => { i18n.off('languageChanged', onLangChanged); };
    }, [i18n]);

    useEffect(() => {
        apiRequest(getUrls().APP_CONFIG)
            .then(({ data }) => {
                dispatch(dfActions.setServerConfig(data));
                setConfigLoaded(true);
            });
    }, []);

    // A space's own chart theme is used by id like a saved theme.
    const spaceTheme = useSelector((state: DataFormulatorState) => state.serverConfig.SPACE?.chart_theme);
    useEffect(() => { setSpaceTheme(spaceTheme as SavedTheme | undefined); }, [spaceTheme]);

    // Validate persisted workspace still exists on the backend
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const tables = useSelector(dfSelectors.getAllTables);
    
    // Debug: log persisted state on startup
    useEffect(() => {
        if (configLoaded) {
            console.log('[DEBUG] activeWorkspace:', activeWorkspace);
            console.log('[DEBUG] tables:', tables.length, tables.map(t => ({ id: t.id, virtual: t.virtual, rowLen: t.rows?.length })));
            
            // Recover orphaned state: content exists but activeWorkspace was lost
            if (!activeWorkspace && !dfSelectors.selectSessionEmpty(store.getState())) {
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
                    const { getAuthInfo, getOidcUser } = await import('./oidcConfig');
                    const info: AuthInfo | null = await getAuthInfo();

                    if (info?.action === 'backend') {
                        // Backend OIDC — identity from server session
                        try {
                            const { data: status } = await apiRequest(info.status_url || '/api/auth/oidc/status');
                            if (status.authenticated && status.user) {
                                resolvedIdentity = {
                                    type: 'user',
                                    id: String(status.user.sub || status.user.id || 'session_user'),
                                    displayName: typeof status.user.name === 'string' ? status.user.name : undefined,
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
                                id: String(user.profile.sub),
                                displayName: typeof user.profile.name === 'string' ? user.profile.name : undefined,
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

            try {
                const { data: refreshedConfig } = await apiRequest(getUrls().APP_CONFIG);
                dispatch(dfActions.setServerConfig(refreshedConfig));
            } catch {
                // App config was already loaded; connector status refresh is best-effort.
            }

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
        document.title = getToolName(serverConfig.APP_NAME);
    }, [serverConfig.APP_NAME]);

    useEffect(() => {
        // Load all server-configured models instantly (no connectivity check).
        // Users can verify connectivity via the "Test" button in the model dialog,
        // or errors will surface naturally when a model is first used.
        dispatch(fetchGlobalModelList());
    }, []);

    useLayoutEffect(() => {
        applyLookVariables(document.documentElement.style, look);
        setChartInk(LOOKS[look].chartInk);
    }, [look]);

    let theme = createDfTheme(activePaletteKey, look);

    const router = useMemo(() => createBrowserRouter([
        {
            path: "/auth/callback",
            element: <OidcCallback />,
        },
        {
            path: "/dev",
            lazy: () => import('../views/DevPage').then(module => ({ Component: module.default })),
        },
        {
            path: "/dev/maps",
            lazy: () => import('../maps/MapGallery').then(module => ({ Component: module.default })),
        },
        {
            path: "/dev/samples",
            lazy: () => import('../views/DevSamplesPage').then(module => ({ Component: module.default })),
        },
        {
            path: "/dev/design",
            lazy: () => import('../views/DevDesignPage').then(module => ({ Component: module.default })),
        },
        {
            path: "/dev/about/:page?",
            lazy: () => import('../views/about/AboutPage').then(module => ({ Component: module.default })),
        },
        {
            path: "/dev/look",
            lazy: () => import('../components/look/LookGallery').then(module => ({ Component: module.default })),
        },
        {
            path: "/",
            element: <AppShell />,
            errorElement: <ErrorBoundaryFallback />,
            children: [
                {
                    index: true,
                    element: <HomePage />,
                },
                {
                    path: "app",
                    element: <DataFormulatorFC />,
                },
                {
                    // The About page was removed; keep old links working.
                    path: "about",
                    element: <Navigate to={APP_PATH} replace />,
                },
                {
                    path: "configurations",
                    element: <ConfigurationView />,
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
            {/* Plain elements (buttons, links, spans outside Typography) take the theme font, not the browser serif. */}
            <GlobalStyles styles={theme => ({ 'html, body': { fontFamily: theme.typography.fontFamily, fontWeight: weight(400),
                // A dark palette paints the page and asks the browser for dark controls and scrollbars.
                ...(theme.palette.mode === 'dark' ? { backgroundColor: theme.palette.background.default, color: theme.palette.text.primary, colorScheme: 'dark' } : {}) } })} />
            <LayoutProvider>
                {configLoaded && authChecked ? (
                    <RouterProvider router={router} />
                ) : (
                    <>
                        <AnvilLoader
                            label="loading data formulator..."
                            action={isDesktopApp ? (
                                <Link
                                    component="button"
                                    type="button"
                                    underline="always"
                                    onClick={() => setStartupLogsOpen(true)}
                                    sx={{
                                        color: 'text.disabled',
                                        fontSize: '0.7rem',
                                        fontWeight: weight(400),
                                        fontFamily: 'inherit',
                                        '&:hover': { color: 'text.secondary' },
                                    }}
                                >
                                    Open console
                                </Link>
                            ) : undefined}
                        />
                        {isDesktopApp && (
                            <LogViewerDialog
                                open={startupLogsOpen}
                                onOpenChange={setStartupLogsOpen}
                                hideTrigger
                            />
                        )}
                    </>
                )}
                {migrationBrowserId && (
                    <IdentityMigrationDialog
                        oldBrowserId={migrationBrowserId}
                        onDone={() => setMigrationBrowserId(null)}
                    />
                )}
            </LayoutProvider>
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
