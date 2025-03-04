// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useState } from 'react';
import '../scss/App.scss';

import { useDispatch, useSelector } from "react-redux";
import {
    DataFormulatorState,
    dfActions,
    fetchAvailableModels,
    fetchFieldSemanticType,
} from './dfSlice'

import blue from '@mui/material/colors/blue';

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
} from '@mui/material';


import MuiAppBar from '@mui/material/AppBar';
import { createTheme, styled, ThemeProvider } from '@mui/material/styles';

import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
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
import { appConfig, assignAppConfig, getUrls, PopupConfig } from './utils';
import { DictTable } from '../components/ComponentType';
import { AppDispatch } from './store';
import { ActionSubscription, subscribe, unsubscribe } from './embed';
import dfLogo from '../assets/df-logo.png';
import { Popup } from '../components/Popup';
import { ModelSelectionButton } from '../views/ModelSelectionDialog';
import { TableCopyDialogV2 } from '../views/TableSelectionView';
import { TableUploadDialog } from '../views/TableSelectionView';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';

const AppBar = styled(MuiAppBar)(({ theme }) => ({
    color: 'black',
    backgroundColor: "white",
    borderBottom: "1px solid #C3C3C3",
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
                    accept: '.dfstate',
                    multiple: false 
                }}
                id="upload-data-file"
                type="file"
                sx={{ display: 'none' }}
                inputRef={inputRef}
                onChange={handleFileUpload}
            />
            import a saved session
        </Button>
    );
}

export const ExportStateButton: React.FC<{}> = ({ }) => {
    const fullStateJson = useSelector((state: DataFormulatorState) => JSON.stringify(state));

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
                download(fullStateJson, `data-formulator.${new Date().toISOString()}.dfstate`, 'text/plain');
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
                Add Table
            </Button>
            <Menu
                id="add-table-menu"
                anchorEl={anchorEl}
                open={open}
                onClose={() => setAnchorEl(null)}
                MenuListProps={{
                    'aria-labelledby': 'add-table-button',
                    sx: { py: '4px', px: '8px' }
                }}
                sx={{ '& .MuiMenuItem-root': { padding: 0, margin: 0 } }}
            >
                <MenuItem onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }}>
                    <TableCopyDialogV2 buttonElement={
                        <Typography sx={{ fontSize: 14, textTransform: 'none', display: 'flex', alignItems: 'center', gap: 1 }}>
                            <ContentPasteIcon fontSize="small" />
                            from clipboard
                        </Typography>
                    } disabled={false} />
                </MenuItem>
                <MenuItem onClick={(e) => {}} >
                    <TableUploadDialog buttonElement={
                        <Typography sx={{ fontSize: 14, textTransform: 'none', display: 'flex', alignItems: 'center', gap: 1 }}>
                            <UploadFileIcon fontSize="small" />
                            from file
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
                MenuListProps={{
                    'aria-labelledby': 'session-menu-button',
                    sx: { py: '4px', px: '8px' }
                }}
                sx={{ '& .MuiMenuItem-root': { padding: 0, margin: 0 } }}
            >
                <MenuItem onClick={() => {}}>
                    <ExportStateButton />
                </MenuItem>
                <MenuItem onClick={(e) => {}}>
                    <ImportStateButton />
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
                onClick={() => setOpen(true)} 
                endIcon={<PowerSettingsNewIcon />}
            >
                Reset session
            </Button>
            <Dialog onClose={() => setOpen(false)} open={open}>
                <DialogTitle sx={{ display: "flex", alignItems: "center" }}>Reset Session?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        <Typography>All unexported content (charts, derived data, concepts) will be lost upon reset.</Typography>
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button 
                        onClick={() => { 
                            dispatch(dfActions.resetState()); 
                            setOpen(false); 
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

    // Add check for changes
    const hasChanges = formulateTimeoutSeconds !== config.formulateTimeoutSeconds || 
                      maxRepairAttempts !== config.maxRepairAttempts;

    return (
        <>
            <Button variant="text" sx={{textTransform: 'none'}} onClick={() => setOpen(true)} startIcon={<SettingsIcon />}>
                 <Box component="span" sx={{lineHeight: 1.2, display: 'flex', flexDirection: 'column', alignItems: 'left'}}>
                    <Box component="span" sx={{py: 0, my: 0, fontSize: '10px', mr: 'auto'}}>timeout={config.formulateTimeoutSeconds}s</Box>
                    <Box component="span" sx={{py: 0, my: 0, fontSize: '10px', mr: 'auto'}}>max_repair={config.maxRepairAttempts}</Box>
                </Box>
            </Button>
            <Dialog onClose={() => setOpen(false)} open={open}>
                <DialogTitle>Data Formulator Configuration</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        <Box sx={{ 
                            display: 'flex', 
                            flexDirection: 'column', 
                            gap: 3,
                            my: 2,
                            maxWidth: 400
                        }}>
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
                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                        Smaller values (&lt;30s) make the model fails fast thus providing a smoother UI experience. Increase this value for slow models.
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
                                        inputProps={{
                                            min: 1,
                                            max: 5,
                                        }}
                                        error={maxRepairAttempts <= 0 || maxRepairAttempts > 5}
                                        helperText={maxRepairAttempts <= 0 || maxRepairAttempts > 5 ? 
                                            "Value must be between 1 and 5" : ""}
                                    />
                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                        Maximum number of times the LLM will attempt to repair code if generated code fails to execute (recommended = 1).
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                        Higher values might slightly increase the chance of success but can crash the backend. Repair time is as part of the formulate timeout.
                                    </Typography>
                                </Box>
                            </Box>
                        </Box>
                    </DialogContentText>
                </DialogContent>
                <DialogActions sx={{'.MuiButton-root': {textTransform: 'none'}}}>
                    <Button sx={{marginRight: 'auto'}} onClick={() => {
                        setFormulateTimeoutSeconds(30);
                        setMaxRepairAttempts(1);
                    }}>Reset to default</Button>
                    <Button onClick={() => setOpen(false)}>Cancel</Button>
                    <Button 
                        variant={hasChanges ? "contained" : "text"}
                        disabled={!hasChanges || isNaN(maxRepairAttempts) || maxRepairAttempts <= 0 || maxRepairAttempts > 5 || isNaN(formulateTimeoutSeconds) || formulateTimeoutSeconds <= 0 || formulateTimeoutSeconds > 3600}
                        onClick={() => {
                            dispatch(dfActions.setConfig({formulateTimeoutSeconds, maxRepairAttempts}));
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

    const visViewMode = useSelector((state: DataFormulatorState) => state.visViewMode);
    const config = useSelector((state: DataFormulatorState) => state.config);
    const tables = useSelector((state: DataFormulatorState) => state.tables);

    // if the user has logged in
    const [userInfo, setUserInfo] = useState<{ name: string, userId: string } | undefined>(undefined);

    const [popupConfig, setPopupConfig] = useState<PopupConfig>({});

    const dispatch = useDispatch<AppDispatch>();

    useEffect(() => {
        const subscription: ActionSubscription = {
            loadData: (table: DictTable) => {
                dispatch(dfActions.loadTable(table));
                dispatch(fetchFieldSemanticType(table));
            },
            setAppConfig: (config) => {
                assignAppConfig(config);
                config.popupConfig && setPopupConfig(config.popupConfig);
            },
        };
        subscribe(subscription);
        return () => {
            unsubscribe(subscription);
        };
    }, []);

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
                    // console.log("logging info")
                    // console.log(userInfo);
                }

            }).catch(err => {
                //user is not logged in, do not show logout button
                //console.error(err)
            });
    }, [])

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
        palette: {
            primary: {
                main: blue[700]
            },
            derived: {
                main: "rgb(255,215,0)", // gold
            },
            custom: {
                main: "rgb(255, 160, 122)", //lightsalmon
            },
            warning: {
                main: '#bf5600', // New accessible color, original (#ed6c02) has insufficient color contrast of 3.11
            },
        },
    });

    let switchers = (
        <Box sx={{ display: "flex" }} key="switchers">
            <ToggleButtonGroup
                color="primary"
                value={visViewMode}
                exclusive
                size="small"
                onChange={(
                    event: React.MouseEvent<HTMLElement>,
                    newViewMode: string | null,
                ) => {
                    if (newViewMode === "gallery" || newViewMode === "carousel") {
                        dispatch(dfActions.setVisViewMode(newViewMode));
                    }
                }}
                aria-label="View Mode"
                sx={{ marginRight: "8px", height: 32, padding: "4px 0px", marginTop: "2px", "& .MuiToggleButton-root": { padding: "0px 6px" } }}
            >
                <ToggleButton value="carousel" aria-label="view list">
                    <Tooltip title="view list">
                        <ViewSidebarIcon fontSize="small" sx={{ transform: "scaleX(-1)" }} />
                    </Tooltip>
                </ToggleButton>
                <ToggleButton value="gallery" aria-label="view grid">
                    <Tooltip title="view grid">
                        <GridViewIcon fontSize="small" />
                    </Tooltip>
                </ToggleButton>
            </ToggleButtonGroup>
        </Box>
    )

    let appBar = [
        <AppBar className="app-bar" position="static" key="app-bar-main">
            <Toolbar variant="dense">
                <Button href={"/"} sx={{
                    display: "flex", flexDirection: "row", textTransform: "none",
                    backgroundColor: 'transparent',
                    "&:hover": {
                        backgroundColor: "transparent"
                    }
                }} color="inherit">
                    <Box component="img" sx={{ height: 32, marginRight: "12px" }} alt="" src={dfLogo} />
                    <Typography variant="h6" noWrap component="h1" sx={{ fontWeight: 300, display: { xs: 'none', sm: 'block' } }}>
                        {toolName} {process.env.NODE_ENV == "development" ? "" : ""}
                    </Typography>
                </Button>
                <Box sx={{ flexGrow: 1, textAlign: 'center', display: 'flex', justifyContent: 'center' }} >
                    {switchers}
                </Box>
                <Box sx={{ display: 'flex', fontSize: 14 }}>
                    {/* <Button variant="text" href={"/about"}  sx={{display: "flex", flexDirection: "row", 
                            "&:hover": { textDecoration: "underline" }}}>
                        about
                    </Button>
                    <Divider orientation="vertical" variant="middle" flexItem /> */}
                    <ConfigDialog />
                    <Divider orientation="vertical" variant="middle" flexItem />
                    <ModelSelectionButton />
                    <Divider orientation="vertical" variant="middle" flexItem />
                    <Typography sx={{ display: 'flex', fontSize: 14, alignItems: 'center', gap: 1 }}>
                        <TableMenu />
                    </Typography>
                    <Divider orientation="vertical" variant="middle" flexItem />
                    <Typography sx={{ display: 'flex', fontSize: 14, alignItems: 'center', gap: 1 }}>
                        <SessionMenu />
                    </Typography>
                    <Divider orientation="vertical" variant="middle" flexItem />
                    <ResetDialog />
                    <Popup popupConfig={popupConfig} appConfig={appConfig} table={tables[0]} />
                </Box>
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
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            '& > *': {
                minWidth: '1000px',
                minHeight: '800px'
            }
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
