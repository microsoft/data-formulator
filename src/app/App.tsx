// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useState } from 'react';
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
    Input,
    Divider,
    DialogTitle,
    Dialog,
    DialogContent,
    Avatar,
    Link,
    DialogContentText,
    DialogActions,
    ToggleButtonGroup,
    ToggleButton,
    Menu,
    MenuItem,
    TextField,
    useTheme,
    SvgIcon,
    IconButton,
    Select,
    FormControl,
    InputLabel,
    ListItemText,
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
import { MessageSnackbar } from '../views/MessageSnackbar';
import { ChartRenderService } from '../views/ChartRenderService';
import { DictTable } from '../components/ComponentType';
import { AppDispatch } from './store';
import dfLogo from '../assets/df-logo.png';
import { ModelSelectionButton } from '../views/ModelSelectionDialog';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import { handleDBDownload } from '../views/DBTableManager';
import { getUrls, fetchWithIdentity } from './utils';
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

export const ImportStateButton: React.FC<{}> = ({ }) => {
    const dispatch = useDispatch();
    const inputRef = React.useRef<HTMLInputElement>(null);

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>): void => {
        const files = event.target.files;
        if (files) {
            for (let file of files) {
                file.text().then((text) => {
                    try {
                        let savedState = JSON.parse(text);
                        dispatch(dfActions.loadState(savedState));
                    } catch (error) {
                        console.error('Failed to parse state file:', error);
                    }
                });
            }
        }
        // Reset the input value to allow uploading the same file again
        if (inputRef.current) {
            inputRef.current.value = '';
        }
    };

    return (
        <Button 
            variant="text" 
            color="primary"
            sx={{textTransform: 'none'}}
            onClick={() => inputRef.current?.click()}
            startIcon={<UploadFileIcon />}
        >
            <Input 
                inputProps={{ 
                    accept: '.json, .dfstate',
                    multiple: false 
                }}
                id="upload-data-file"
                type="file"
                sx={{ display: 'none' }}
                inputRef={inputRef}
                onChange={handleFileUpload}
            />
            import session
        </Button>
    );
}

export const ExportStateButton: React.FC<{}> = ({ }) => {
    const identity = useSelector((state: DataFormulatorState) => state.identity);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const fullStateJson = useSelector((state: DataFormulatorState) => {
        // Fields to exclude from serialization
        const excludedFields = new Set([
            'models',
            'selectedModelId',
            'testedModels',
            'dataLoaderConnectParams',
            'identity',
            'agentRules',
            'serverConfig',
        ]);
        
        // Build new object with only allowed fields
        const stateToSerialize: any = {};
        for (const [key, value] of Object.entries(state)) {
            if (!excludedFields.has(key)) {
                stateToSerialize[key] = value;
            }
        }
        
        return JSON.stringify(stateToSerialize);
    });

    return <Tooltip title="save session locally">
        <Button 
            variant="text" 
            sx={{textTransform: 'none'}} 
            onClick={() => {
                function download(content: string, fileName: string, contentType: string) {
                    let a = document.createElement("a");
                    let file = new Blob([content], { type: contentType });
                    a.href = URL.createObjectURL(file);
                    a.download = fileName;
                    a.click();
                }
                let firstTableName = tables.length > 0 ? tables[0].id: '';
                download(fullStateJson, `df_state_${firstTableName}_${identity.id.slice(0, 4)}.json`, 'text/plain');
            }}
            startIcon={<DownloadIcon />}
        >
            export session
        </Button>
    </Tooltip>
}


//type AppProps = ConnectedProps<typeof connector>;

export const toolName = "Data Formulator"

export interface AppFCProps {
}

// Extract menu components into separate components to prevent full app re-renders
const TableMenu: React.FC = () => {
    const [dialogOpen, setDialogOpen] = useState<boolean>(false);
    
    return (
        <>
            <Button
                variant="text"
                onClick={() => setDialogOpen(true)}
                sx={{ textTransform: 'none' }}
            >
                Data
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

const SessionMenu: React.FC = () => {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);
    const identity = useSelector((state: DataFormulatorState) => state.identity);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const theme = useTheme();
    
    const dispatch = useDispatch();
    return (
        <>
            <Button 
                variant="text" 
                onClick={(e) => setAnchorEl(e.currentTarget)} 
                endIcon={<KeyboardArrowDownIcon />} 
                sx={{ textTransform: 'none' }}
            >
                Session
            </Button>
            <Menu
                id="session-menu"
                anchorEl={anchorEl}
                open={open}
                onClose={() => setAnchorEl(null)}
                slotProps={{
                    paper: { sx: { py: '4px', px: '8px' } }
                }}
                aria-labelledby="session-menu-button"
                sx={{ '& .MuiMenuItem-root': { padding: 0, margin: 0 } }}
            >
                <MenuItem onClick={() => {}}>
                    <ExportStateButton />
                </MenuItem>
                <MenuItem onClick={(e) => {}}>
                    <ImportStateButton />
                </MenuItem>
                <Divider><Typography variant="caption" sx={{ fontSize: 12, color: 'text.secondary' }}>database file</Typography></Divider>
                {tables.some(t => t.virtual) && 
                    <Typography fontSize="inherit" sx={{ color: theme.palette.warning.main, width: '160px', display: 'flex', alignItems: 'center', gap: 1, fontSize: 9 }}>
                        This session contains data stored in the database, export and reload the database to resume the session later.
                    </Typography>}
                <MenuItem disabled={!tables.some(t => t.virtual)}  onClick={() => {
                    handleDBDownload(identity.id);
                }}>
                    <Button startIcon={<DownloadIcon />}
                        sx={{ fontSize: 14, textTransform: 'none', display: 'flex', alignItems: 'center'}}>
                        download database
                    </Button>
                </MenuItem>
                <MenuItem onClick={() => {}}>
                    <Button startIcon={<UploadIcon />} 
                        sx={{ fontSize: 14, textTransform: 'none', display: 'flex', alignItems: 'center'}}
                        component="label">
                        import database
                        <input type="file" hidden accept=".db" onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const formData = new FormData();
                            formData.append('file', file);
                            try {
                                const response = await fetchWithIdentity(getUrls().UPLOAD_DB_FILE, { method: 'POST', body: formData });
                                const data = await response.json();
                                if (data.status === 'success') {
                                    dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "DB Manager", type: "success", value: "Database imported successfully" }));
                                } else {
                                    dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "DB Manager", type: "error", value: data.message || 'Import failed' }));
                                }
                            } catch (error) {
                                dispatch(dfActions.addMessages({ timestamp: Date.now(), component: "DB Manager", type: "error", value: 'Import failed' }));
                            }
                            e.target.value = '';
                        }} />
                    </Button>
                </MenuItem>
                
            </Menu>
        </>
    );
};

const ResetDialog: React.FC = () => {
    const [open, setOpen] = useState(false);
    const dispatch = useDispatch();

    return (
        <>
            <Button 
                variant="text" 
                sx={{textTransform: 'none'}}
                onClick={() => setOpen(true)} 
                endIcon={<PowerSettingsNewIcon />}
            >
                Reset
            </Button>
            <Dialog onClose={() => setOpen(false)} open={open}>
                <DialogTitle sx={{ display: "flex", alignItems: "center" }}>Reset Session?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        All unexported content (charts, derived data, concepts) will be lost upon reset.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button 
                        onClick={async () => { 
                            // Clear workspace on server first
                            try {
                                await fetchWithIdentity(getUrls().RESET_DB_FILE, { method: 'POST' });
                            } catch (e) {
                                console.warn('Failed to reset server workspace:', e);
                            }
                            dispatch(dfActions.resetState()); 
                            setOpen(false);
                            
                            // Add a delay to ensure the state has been reset before reloading
                            setTimeout(() => {
                                window.location.reload();
                            }, 250); // 250ms should be enough for state update
                        }} 
                        endIcon={<PowerSettingsNewIcon />}
                    >
                        reset session 
                    </Button>
                    <Button onClick={() => setOpen(false)}>cancel</Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

const ConfigDialog: React.FC = () => {
    const [open, setOpen] = useState(false);
    const dispatch = useDispatch();
    const config = useSelector((state: DataFormulatorState) => state.config);


    const [formulateTimeoutSeconds, setFormulateTimeoutSeconds] = useState(config.formulateTimeoutSeconds ?? 30);

    const [defaultChartWidth, setDefaultChartWidth] = useState(config.defaultChartWidth ?? 300);
    const [defaultChartHeight, setDefaultChartHeight] = useState(config.defaultChartHeight ?? 300);
    const [frontendRowLimit, setFrontendRowLimit] = useState(config.frontendRowLimit ?? 10000);
    const [paletteKey, setPaletteKey] = useState(
        (config.paletteKey && palettes[config.paletteKey]) ? config.paletteKey : defaultPaletteKey
    );

    // Add check for changes
    const hasChanges = formulateTimeoutSeconds !== config.formulateTimeoutSeconds || 
                      defaultChartWidth !== config.defaultChartWidth ||
                      defaultChartHeight !== config.defaultChartHeight ||
                      frontendRowLimit !== config.frontendRowLimit ||
                      paletteKey !== ((config.paletteKey && palettes[config.paletteKey]) ? config.paletteKey : defaultPaletteKey);

    return (
        <>
            <Button variant="text" sx={{textTransform: 'none'}} onClick={() => setOpen(true)} startIcon={<SettingsIcon />}>
                Settings
            </Button>
            <Dialog onClose={() => setOpen(false)} open={open}>
                <DialogTitle>Settings</DialogTitle>
                <DialogContent>
                    <Box sx={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: 3,
                        maxWidth: 400
                    }}>
                        <Divider><Typography variant="caption">Frontend</Typography></Divider>
                        <FormControl fullWidth size="small">
                            <InputLabel id="palette-select-label" sx={{ fontSize: 13 }}>Color Theme</InputLabel>
                            <Select
                                labelId="palette-select-label"
                                value={paletteKey}
                                label="Color Theme"
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
                                    label="default chart width"
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
                                        "Value must be between 100 and 1000 pixels" : ""}
                                />
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                <ClearIcon fontSize="small" />
                            </Typography>
                            <Box sx={{ flex: 1 }}>
                                <TextField
                                    label="default chart height"
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
                                        "Value must be between 100 and 1000 pixels" : ""}
                                />
                            </Box>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Box sx={{ flex: 1 }}>
                                <TextField
                                    label="local-only row limit"
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
                                        "Value must be between 100 and 1,000,000 rows" : ""}
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                    Maximum number of rows kept when loading data locally (not stored on server).
                                </Typography>
                            </Box>
                        </Box>
                        <Divider><Typography variant="caption">Backend</Typography></Divider>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Box sx={{ flex: 1 }}>
                                <TextField
                                    label="formulate timeout (seconds)"
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
                                        "Value must be between 1 and 3600 seconds" : ""}
                                    fullWidth
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                    Maximum time allowed for the formulation process before timing out. 
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
                        setFrontendRowLimit(10000);
                        setPaletteKey(defaultPaletteKey);
                    }}>Reset to default</Button>
                    <Button onClick={() => setOpen(false)}>Cancel</Button>
                    <Button 
                        variant={hasChanges ? "contained" : "text"}
                        disabled={!hasChanges || isNaN(formulateTimeoutSeconds) || formulateTimeoutSeconds <= 0 || formulateTimeoutSeconds > 3600
                            || isNaN(defaultChartWidth) || defaultChartWidth <= 0 || defaultChartWidth > 1000
                            || isNaN(defaultChartHeight) || defaultChartHeight <= 0 || defaultChartHeight > 1000
                            || isNaN(frontendRowLimit) || frontendRowLimit < 100 || frontendRowLimit > 1000000}
                        onClick={() => {
                            dispatch(dfActions.setConfig({formulateTimeoutSeconds, defaultChartWidth, defaultChartHeight, frontendRowLimit, paletteKey, sendChartImage: config.sendChartImage}));
                            setOpen(false);
                        }}
                    >
                        Apply
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );  
}

export const AppFC: FC<AppFCProps> = function AppFC(appProps) {

    const dispatch = useDispatch<AppDispatch>();
    const viewMode = useSelector((state: DataFormulatorState) => state.viewMode);
    const generatedReports = useSelector((state: DataFormulatorState) => state.generatedReports);
    const focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);
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
    const isAboutPage = (window.location.pathname === '/about' 
            || (window.location.pathname === '/' && serverConfig.PROJECT_FRONT_PAGE));

    let appBar =  [
        <AppBar position="static" key="app-bar-main" >
            <Toolbar variant="dense" sx={{height: 40, minHeight: 36}}>
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
                        About
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
                            color: !isAboutPage ? 'text.primary' : 'text.secondary',
                            backgroundColor: !isAboutPage ? 'rgba(0, 0, 0, 0.08)' : 'transparent',
                            '&:hover': {
                                color: 'text.primary',
                                backgroundColor: !isAboutPage ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                            },
                        }}
                    >
                        App
                    </Button>
                </Box>
                {!isAboutPage && (
                    <Box sx={{ display: 'flex', ml: 'auto', fontSize: 14 }}>
                        {focusedTableId !== undefined && <React.Fragment><ToggleButtonGroup
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
                                    <Box component="span">Explore</Box>
                                </Box>
                            </ToggleButton>
                            <ToggleButton value="report">
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Box component="span">
                                        {generatedReports.length > 0 ? `Reports (${generatedReports.length})` : 'Reports'}
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
                        <Divider orientation="vertical" variant="middle" flexItem />
                        <Typography fontSize="inherit" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <SessionMenu />
                        </Typography>
                        <Divider orientation="vertical" variant="middle" flexItem />
                        <ResetDialog />
                    </Box>
                )}
                {isAboutPage && (
                    <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
                        <Tooltip title="Watch Video">
                            <IconButton
                                component="a"
                                href="https://youtu.be/3ndlwt0Wi3c"
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Watch Video"
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
                        <Tooltip title="View on GitHub">
                            <IconButton
                                component="a"
                                href="https://github.com/microsoft/data-formulator"
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="View on GitHub"
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
                        <Tooltip title="Pip Install">
                            <IconButton
                                component="a"
                                href="https://pypi.org/project/data-formulator/"
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Pip Install"
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
                        <Tooltip title="Join Discord">
                            <IconButton
                                component="a"
                                href="https://discord.gg/mYCZMQKYZb"
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Join Discord"
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
                {!isAboutPage && (
                    <Tooltip title="View on GitHub">
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
        }, {
            path: "/",
            element: serverConfig.PROJECT_FRONT_PAGE ? <About /> : <DataFormulatorFC />,
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
            '& > *': {
                minWidth: '1000px',
                minHeight: '800px'
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
                <RouterProvider router={router} />
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
