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
    getSessionId,
} from './dfSlice'

import { red, purple, blue, brown, yellow, orange, } from '@mui/material/colors';

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
import { DictTable } from '../components/ComponentType';
import { AppDispatch } from './store';
import dfLogo from '../assets/df-logo.png';
import { ModelSelectionButton } from '../views/ModelSelectionDialog';
import { TableCopyDialogV2 } from '../views/TableSelectionView';
import { TableUploadDialog } from '../views/TableSelectionView';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import { DBTableSelectionDialog, handleDBDownload } from '../views/DBTableManager';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import { getUrls } from './utils';
import { DataLoadingChatDialog } from '../views/DataLoadingChat';
import ChatIcon from '@mui/icons-material/Chat';
import { AgentRulesDialog } from '../views/AgentRulesDialog';
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
    const sessionId = useSelector((state: DataFormulatorState) => state.sessionId);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const fullStateJson = useSelector((state: DataFormulatorState) => {
        // Fields to exclude from serialization
        const excludedFields = new Set([
            'models',
            'modelSlots', 
            'testedModels',
            'dataLoaderConnectParams',
            'sessionId',
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
                download(fullStateJson, `df_state_${firstTableName}_${sessionId?.slice(0, 4)}.json`, 'text/plain');
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
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);
    
    return (
        <>
            <Button
                variant="text"
                onClick={(e) => setAnchorEl(e.currentTarget)}
                endIcon={<KeyboardArrowDownIcon />}
                aria-controls={open ? 'add-table-menu' : undefined}
                aria-haspopup="true"
                aria-expanded={open ? 'true' : undefined}
                sx={{ textTransform: 'none' }}
            >
                Data
            </Button>
            <Menu
                id="add-table-menu"
                anchorEl={anchorEl}
                open={open}
                onClose={() => setAnchorEl(null)}
                slotProps={{
                    paper: { sx: { py: '4px', px: '8px' } }
                }}
                aria-labelledby="add-table-button"
                sx={{ 
                    '& .MuiMenuItem-root': { padding: 0, margin: 0 } ,
                    '& .MuiTypography-root': { fontSize: 14, display: 'flex', alignItems: 'center', textTransform: 'none',gap: 1 }
                }}
            >
                <MenuItem onClick={(e) => {}}>
                    <DBTableSelectionDialog buttonElement={
                        <Typography fontSize="inherit" sx={{  }}>
                            <CloudQueueIcon fontSize="inherit" /> Database
                        </Typography>
                    } component="dialog" />
                </MenuItem>
                <MenuItem onClick={(e) => {}}>     
                    <DataLoadingChatDialog buttonElement={<Typography fontSize="inherit" sx={{  }}>
                        clean data <span style={{fontSize: '11px'}}>(image/messy text)</span>
                    </Typography>}/>
                </MenuItem>
                <MenuItem onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }}>
                    <TableCopyDialogV2 buttonElement={
                        <Typography sx={{  }}>
                            paste data <span style={{fontSize: '11px'}}>(csv/tsv)</span>
                        </Typography>
                    } disabled={false} />
                </MenuItem>
                <MenuItem onClick={(e) => {}} >
                    <TableUploadDialog buttonElement={
                        <Typography sx={{ }}>
                            upload data file <span style={{fontSize: '11px'}}>(csv/tsv/json)</span>
                        </Typography>
                    } disabled={false} />
                </MenuItem>
            </Menu>
        </>
    );
};

const SessionMenu: React.FC = () => {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);
    const sessionId = useSelector((state: DataFormulatorState) => state.sessionId);
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
                {sessionId && tables.some(t => t.virtual) && 
                    <Typography fontSize="inherit" sx={{ color: theme.palette.warning.main, width: '160px', display: 'flex', alignItems: 'center', gap: 1, fontSize: 9 }}>
                        This session contains data stored in the database, export and reload the database to resume the session later.
                    </Typography>}
                <MenuItem disabled={!sessionId || !tables.some(t => t.virtual)}  onClick={() => {
                    handleDBDownload(sessionId ?? '');
                }}>
                    <Button startIcon={<DownloadIcon />}
                        sx={{ fontSize: 14, textTransform: 'none', display: 'flex', alignItems: 'center'}}>
                        download database
                    </Button>
                </MenuItem>
                <MenuItem onClick={() => {}}>
                    <Button disabled={!sessionId} startIcon={<UploadIcon />} 
                        sx={{ fontSize: 14, textTransform: 'none', display: 'flex', alignItems: 'center'}}
                        component="label">
                        import database
                        <input type="file" hidden accept=".db" onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const formData = new FormData();
                            formData.append('file', file);
                            try {
                                const response = await fetch(getUrls().UPLOAD_DB_FILE, { method: 'POST', body: formData });
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
                        onClick={() => { 
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


    const [formulateTimeoutSeconds, setFormulateTimeoutSeconds] = useState(config.formulateTimeoutSeconds);
    const [maxRepairAttempts, setMaxRepairAttempts] = useState(config.maxRepairAttempts);

    const [defaultChartWidth, setDefaultChartWidth] = useState(config.defaultChartWidth);
    const [defaultChartHeight, setDefaultChartHeight] = useState(config.defaultChartHeight);

    // Add check for changes
    const hasChanges = formulateTimeoutSeconds !== config.formulateTimeoutSeconds || 
                      maxRepairAttempts !== config.maxRepairAttempts ||
                      defaultChartWidth !== config.defaultChartWidth ||
                      defaultChartHeight !== config.defaultChartHeight;

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
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Box sx={{ flex: 1 }}>
                                <TextField
                                    label="max repair attempts"
                                    type="number"
                                    variant="outlined"
                                    value={maxRepairAttempts}
                                    onChange={(e) => {
                                        const value = parseInt(e.target.value);
                                        setMaxRepairAttempts(value);
                                    }}
                                    fullWidth
                                    slotProps={{
                                        input: {
                                            inputProps: {
                                                min: 1,
                                                max: 5,
                                            }
                                        }
                                    }}
                                    error={maxRepairAttempts <= 0 || maxRepairAttempts > 5}
                                    helperText={maxRepairAttempts <= 0 || maxRepairAttempts > 5 ? 
                                        "Value must be between 1 and 5" : ""}
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                    How many attempts LLM will make to repair code if code fails to execute (recommended = 1, higher values might increase the chance of success but it's slow).
                                </Typography>
                            </Box>
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions sx={{'.MuiButton-root': {textTransform: 'none'}}}>
                    <Button sx={{marginRight: 'auto'}} onClick={() => {
                        setFormulateTimeoutSeconds(30);
                        setMaxRepairAttempts(1);
                        setDefaultChartWidth(300);
                        setDefaultChartHeight(300);
                    }}>Reset to default</Button>
                    <Button onClick={() => setOpen(false)}>Cancel</Button>
                    <Button 
                        variant={hasChanges ? "contained" : "text"}
                        disabled={!hasChanges || isNaN(maxRepairAttempts) || maxRepairAttempts <= 0 || maxRepairAttempts > 5 
                            || isNaN(formulateTimeoutSeconds) || formulateTimeoutSeconds <= 0 || formulateTimeoutSeconds > 3600
                            || isNaN(defaultChartWidth) || defaultChartWidth <= 0 || defaultChartWidth > 1000
                            || isNaN(defaultChartHeight) || defaultChartHeight <= 0 || defaultChartHeight > 1000}
                        onClick={() => {
                            dispatch(dfActions.setConfig({formulateTimeoutSeconds, maxRepairAttempts, defaultChartWidth, defaultChartHeight}));
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

    useEffect(() => {
        fetch(getUrls().APP_CONFIG)
            .then(response => response.json())
            .then(data => {
                dispatch(dfActions.setServerConfig(data));
            });
    }, []);

    // if the user has logged in
    const [userInfo, setUserInfo] = useState<{ name: string, userId: string } | undefined>(undefined);

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
                //user is not logged in, do not show logout button
                //console.error(err)
            });
    }, []);

    useEffect(() => {
        document.title = toolName;
        dispatch(fetchAvailableModels());
        dispatch(getSessionId());
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
        palette: {
            primary: {
                main: blue[700]
            },
            secondary: {
                main: purple[700]
            },
            derived: {
                main: yellow[700], 
            },
            custom: {
                main: orange[700], //lightsalmon
            },
            warning: {
                main: '#bf5600', // New accessible color, original (#ed6c02) has insufficient color contrast of 3.11
            },
        },
    });

    // Check if we're on the about page
    const isAboutPage = window.location.pathname === '/about';

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
                <ToggleButtonGroup
                    value={isAboutPage ? 'about' : 'app'}
                    exclusive
                    sx={{ 
                        ml: 2,
                        height: '28px', 
                        my: 'auto',
                        '& .MuiToggleButton-root': {
                            textTransform: 'none',
                            fontSize: '13px',
                            fontWeight: 400,
                            border: 'none',
                            borderRadius: 0,
                            px: 1.5,
                            py: 0.5,
                            color: 'text.secondary',
                            bgColor: 'rgba(0, 0, 0, 0.02)',
                            '&:hover': {
                                color: 'text.primary',
                            },
                            '&.Mui-selected': {
                                color: 'text.primary',
                            },
                            '&:first-of-type': {
                                borderTopRightRadius: 0,
                                borderBottomRightRadius: 0,
                            },
                            '&:last-of-type': {
                                borderTopLeftRadius: 0,
                                borderBottomLeftRadius: 0,
                            }
                        },
                    }}
                >
                    <ToggleButton 
                        value="about" 
                        component="a" 
                        href="/about"
                        sx={{ textDecoration: 'none' }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box component="span">About</Box>
                        </Box>
                    </ToggleButton>
                    <ToggleButton 
                        value="app" 
                        component="a" 
                        href="/"
                        sx={{ textDecoration: 'none' }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box component="span">App</Box>
                        </Box>
                    </ToggleButton>
                </ToggleButtonGroup>
                {!isAboutPage && (
                    <Box sx={{ display: 'flex', ml: 'auto', fontSize: 14, mr: 1, px: 0.5,
                                backgroundColor: alpha(theme.palette.primary.main, 0.02),
                                borderRadius: 4}}>
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
                                borderRadius: 2,
                                border: '1px solid rgba(0, 0, 0, 0.1)',
                                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                                '& .MuiToggleButton-root': {
                                    textTransform: 'none',
                                    fontSize: '14px',
                                    fontWeight: 500,
                                    border: 'none',
                                    borderRadius: 1,
                                    px: 1,
                                    py: 0.5,
                                    '&:hover': {
                                        backgroundColor: 'rgba(0, 0, 0, 0.04)',
                                        color: 'text.primary',
                                    },
                                    '&.Mui-selected': {
                                        backgroundColor: alpha(theme.palette.primary.main, 0.1),
                                        color: theme.palette.primary.main,
                                    },
                                    '&:first-of-type': {
                                        borderTopRightRadius: 0,
                                        borderBottomRightRadius: 0,
                                    },
                                    '&:last-of-type': {
                                        borderTopLeftRadius: 0,
                                        borderBottomLeftRadius: 0,
                                    }
                                },
                                '.mode-icon': {
                                    animation: 'pulse 3s ease-out infinite',
                                    '@keyframes pulse': {
                                        '0%, 80%': { transform: 'scale(1)' },
                                        '90%': { transform: 'scale(1.3)' },
                                        '100%': { transform: 'scale(1)' },
                                    },
                                },
                            }}
                        >
                            <ToggleButton value="editor">
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Box className={viewMode === 'report' ? 'mode-icon' : ''} component="span" sx={{ fontSize: '12px' }}>🔍</Box>
                                    <Box component="span">Explore</Box>
                                </Box>
                            </ToggleButton>
                            <ToggleButton value="report">
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Box className={viewMode === 'editor' ? 'mode-icon' : ''} component="span" sx={{ fontSize: '12px' }}>✏️</Box>
                                    <Box component="span">
                                        {generatedReports.length > 0 ? `Reports (${generatedReports.length})` : 'Reports'}
                                    </Box>
                                </Box>
                            </ToggleButton>
                        </ToggleButtonGroup>
                        <ConfigDialog />
                        <AgentRulesDialog />
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
                                sx={{ 
                                    color: 'inherit',
                                    '&:hover': {
                                        backgroundColor: 'rgba(0, 0, 0, 0.04)'
                                    }
                                }}
                            >
                                <Box component="img" src="/pip-logo.svg" sx={{ width: 20, height: 20 }} />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="Join Discord">
                            <IconButton
                                component="a"
                                href="https://discord.gg/mYCZMQKYZb"
                                target="_blank"
                                rel="noopener noreferrer"
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
