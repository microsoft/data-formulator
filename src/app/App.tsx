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
} from '@mui/material';


import MuiAppBar from '@mui/material/AppBar';
import { createTheme, styled, ThemeProvider } from '@mui/material/styles';

import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import { DataFormulatorFC } from '../views/DataFormulator';

import GridViewIcon from '@mui/icons-material/GridView';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';

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

    let $uploadStateFile = React.createRef<HTMLInputElement>();

    let handleFileUpload = (event: React.FormEvent<HTMLElement>): void => {
        const target: any = event.target;
        if (target && target.files) {
            for (let file of target.files) {
                //const file: File = target.files[0];
                (file as File).text().then((text) => {
                    try {
                        let savedState = JSON.parse(text);
                        dispatch(dfActions.loadState(savedState));
                    } catch {
                        
                    }
                });
            }
        }
    };

    
    return <Tooltip title="load a saved session">
                <Button variant="text" color="primary" 
                    //endIcon={<InputIcon />}
                >
                    <Input inputProps={{ accept: '.dfstate', multiple: false  }} id="upload-data-file"
                        type="file"  sx={{ display: 'none' }} aria-hidden={true} 
                        ref={$uploadStateFile} onChange={handleFileUpload}
                    />
                    Import
                </Button>
            </Tooltip>;
}

export const ExportStateButton: React.FC<{}> = ({}) => {
    const fullStateJson = useSelector((state: DataFormulatorState) => JSON.stringify(state));
    
    return <Tooltip title="save session locally">
        <Button variant="text" onClick={()=>{
            function download(content: string, fileName: string, contentType: string) {
                    let a = document.createElement("a");
                    let file = new Blob([content], {type: contentType});
                    a.href = URL.createObjectURL(file);
                    a.download = fileName;
                    a.click();
                }
                download(fullStateJson, `data-formulator.${new Date().toISOString()}.dfstate`, 'text/plain');
            }} 
            //endIcon={<OutputIcon />}
        >
            Export 
        </Button>
    </Tooltip>
}


//type AppProps = ConnectedProps<typeof connector>;

export const toolName = "Data Formulator" 

export interface AppFCProps {
}

export const AppFC: FC<AppFCProps> = function AppFC(appProps) {

    const visViewMode = useSelector((state: DataFormulatorState) => state.visViewMode);
    const betaMode = useSelector((state: DataFormulatorState) => state.betaMode);
    const tables = useSelector((state: DataFormulatorState) => state.tables);

    // if the user has logged in
    const [userInfo, setUserInfo] = useState<{name: string, userId: string} | undefined>(undefined);

    const [popupConfig, setPopupConfig] = useState<PopupConfig>({ });

    const dispatch = useDispatch<AppDispatch>();
    
    useEffect(() => {
        const subscription: ActionSubscription = {
            loadData: (table: DictTable) => {
                dispatch(dfActions.addTable(table));
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
        .then(function(response) { return response.json(); })
        .then(function(result) {
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

    const [resetDialogOpen, setResetDialogOpen] = useState<boolean>(false);

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
            <Toolbar variant="dense" sx={{backgroundColor: betaMode ? 'lavender' : ''}}>
                <Button href={"/"} sx={{display: "flex", flexDirection: "row", textTransform: "none", 
                                        backgroundColor: 'transparent',
                                        "&:hover": {
                                            backgroundColor: "transparent"
                                        }}} color="inherit">
                    <Box component="img" sx={{ height: 32, marginRight: "12px"}} alt="" src={dfLogo} />
                    <Typography variant="h6" noWrap component="h1" sx={{ fontWeight: 300, display: { xs: 'none', sm: 'block' } }}>
                        {toolName} {betaMode ? "β" : ""} {process.env.NODE_ENV == "development" ? "" : ""} 
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
                    <ModelSelectionButton />
                    <Divider orientation="vertical" variant="middle" flexItem />
                    <ExportStateButton />
                    <ImportStateButton />
                    <Divider orientation="vertical" variant="middle" flexItem />
                    <Button variant="text" onClick={()=>{setResetDialogOpen(true)}} endIcon={<PowerSettingsNewIcon />}>
                        Reset session
                    </Button>
                    <Popup popupConfig={popupConfig} appConfig={appConfig} table={tables[0]}  />
                    <Dialog onClose={()=>{setResetDialogOpen(false)}} open={resetDialogOpen}>
                        <DialogTitle sx={{display: "flex", alignItems: "center"}}>Reset Session?</DialogTitle>
                        <DialogContent>
                            <DialogContentText>
                                <Typography>All unexported content (charts, derived data, concepts) will be lost upon reset.</Typography>
                            </DialogContentText>
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={()=>{dispatch(dfActions.resetState()); setResetDialogOpen(false);}} endIcon={<PowerSettingsNewIcon />}>reset session </Button>
                            <Button onClick={()=>{setResetDialogOpen(false);}}>cancel</Button>
                        </DialogActions>
                    </Dialog>
                    {userInfo && <>
                        <Divider orientation="vertical" variant="middle" flexItem />
                        <Divider orientation="vertical" variant="middle" flexItem sx={{marginRight: "6px"}} />
                        <Avatar key="user-avatar" {...stringAvatar(userInfo?.name || 'U')} />
                        <Button variant="text" className="ml-auto" href="/.auth/logout">Sign out</Button>
                    </>}
                </Box>
            </Toolbar>
        </AppBar>,
        // <Dialog key="table-selection-dialog" onClose={()=>{setTableDialogOpen(false)}} open={tableDialogOpen}
        //     sx={{ '& .MuiDialog-paper': { maxWidth: '80%', maxHeight: 800, minWidth: 800 } }}
        // >
        //     <DialogTitle sx={{display: "flex"}}>Recently used tables 
        //         <IconButton
        //             sx={{marginLeft: "auto"}}
        //             edge="start"
        //             size="small"
        //             color="inherit"
        //             onClick={()=>{ setTableDialogOpen(false) }}
        //             aria-label="close"
        //         >
        //             <CloseIcon fontSize="inherit"/>
        //         </IconButton>
        //     </DialogTitle>
        //     <DialogContent sx={{overflowX: "hidden", padding: 0}} dividers>
        //         {/* <TableSelectionView tables={tables} 
        //             handleDeleteTable={(index) => { 
        //                 // dispatch(dfActions.removeFromRecentTables(index)); 
        //                 // if (recentTables.length <= 1) { 
        //                 //     setTableDialogOpen(false); 
        //                 // } 
        //             }}
        //             handleSelectTable={(table) => { 
        //                 // dispatch(dfActions.setTable(table)); 
        //                 // setTableDialogOpen(false); 
        //             }}/> */}
        //     </ DialogContent>
        // </Dialog>
    ];

    let router = createBrowserRouter([
        {
            path: "/about",
            element: <About />,
        }, {
            path: "*",
            element:  <DataFormulatorFC />,
            errorElement: <Box sx={{width: "100%", height: "100%", display: "flex"}}>
                            <Typography color="gray" sx={{margin: "150px auto"}}>An error has occurred, please <Link href="/">refresh the session</Link>. If the problem still exists, click close session.</Typography>
                          </Box>
        }
    ]);

    let app = 
        <Box sx={{ flexGrow: 1, height: '100%', overflow: "hidden", display: "flex", flexDirection: "column"}}>
            {appBar}
            <RouterProvider router={router} />
            <MessageSnackbar />
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
        displayName = `${nameSplit[0][0]}${nameSplit.length > 1 ? nameSplit[nameSplit.length-1][0] : ''}`
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
