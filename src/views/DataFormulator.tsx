// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useState } from 'react';
import '../scss/App.scss';

import { useDispatch, useSelector } from "react-redux"; /* code change */
import { 
    DataFormulatorState,
    dfActions,
    dfSelectors,
    ModelConfig,
} from '../app/dfSlice'

import _ from 'lodash';

import { Allotment } from "allotment";
import "allotment/dist/style.css";

import {
    Typography,
    Box,
    Tooltip,
    Button,
    Divider,
    useTheme,
    alpha,
} from '@mui/material';

import { FreeDataViewFC } from './DataView';
import { VisualizationViewFC } from './VisualizationView';

import { ConceptShelf } from './ConceptShelf';
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { toolName } from '../app/App';
import { DataThread } from './DataThread';

import dfLogo from '../assets/df-logo.png';
import exampleImageTable from "../assets/example-image-table.png";
import { ModelSelectionButton } from './ModelSelectionDialog';
import { getUrls, fetchWithIdentity } from '../app/utils';
import { UnifiedDataUploadDialog, UploadTabType, DataLoadMenu } from './UnifiedDataUploadDialog';
import { ReportView } from './ReportView';
import { ExampleSession, exampleSessions, ExampleSessionCard } from './ExampleSessions';
import { useDataRefresh, useDerivedTableRefresh } from '../app/useDataRefresh';

export const DataFormulatorFC = ({ }) => {

    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const models = useSelector((state: DataFormulatorState) => state.models);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const viewMode = useSelector((state: DataFormulatorState) => state.viewMode);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const theme = useTheme();

    const dispatch = useDispatch();
    
    // Set up automatic refresh of derived tables when source data changes
    useDerivedTableRefresh();

    // State for unified data upload dialog
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const [uploadDialogInitialTab, setUploadDialogInitialTab] = useState<UploadTabType>('menu');

    const openUploadDialog = (tab: UploadTabType) => {
        setUploadDialogInitialTab(tab);
        setUploadDialogOpen(true);
    };

    const handleLoadExampleSession = (session: ExampleSession) => {
        dispatch(dfActions.addMessages({
            timestamp: Date.now(),
            type: 'info',
            component: 'data formulator',
            value: `Loading example session: ${session.title}`,
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
                    value: `Successfully loaded ${session.title}`,
                }));
            })
            .catch(error => {
                console.error('Error loading session:', error);
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'error',
                    component: 'data formulator',
                    value: `Failed to load ${session.title}: ${error.message}`,
                }));
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
        const findWorkingModel = async () => {
            let selectedModel = models.find(m => m.id == selectedModelId);
            let otherModels = models.filter(m => m.id != selectedModelId);

            let modelsToTest = [selectedModel, ...otherModels].filter(m => m != undefined);

            let testModel = async (model: ModelConfig) => {
                const message = {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', },
                    body: JSON.stringify({ model }),
                };
                try {
                    const response = await fetchWithIdentity(getUrls().TEST_MODEL, {...message });
                    const data = await response.json();
                    const status = data["status"] || 'error';
                    return {model, status, message: data["message"] || ""};
                } catch (error) {
                    return {model, status: 'error', message: (error as Error).message || 'Failed to test model'};
                }
            }

            // Then test unassigned models sequentially until one works
            for (let model of modelsToTest) {
                let testResult = await testModel(model);
                dispatch(dfActions.updateModelStatus({
                    id: model.id, 
                    status: testResult.status, 
                    message: testResult.message
                }));
                if (testResult.status == 'ok') {
                    dispatch(dfActions.selectModel(model.id));
                    return;
                };
            }
        };

        if (models.length > 0) {
            findWorkingModel();
        }
    }, []);

    const visPaneMain = (
        <Box sx={{ width: "100%", overflow: "hidden", display: "flex", flexDirection: "row" }}>
            <VisualizationViewFC />
        </Box>);

    const visPane = (
        <Box sx={{width: '100%', height: '100%', 
            "& .split-view-view:first-of-type": {
                display: 'flex',
                overflow: 'hidden',
        }}}>
            <Allotment vertical>
                <Allotment.Pane minSize={200} >
                {visPaneMain}
                </Allotment.Pane>
                <Allotment.Pane minSize={120} preferredSize={200}>
                    <Box className="table-box">
                        <FreeDataViewFC />
                    </Box>
                </Allotment.Pane>
            </Allotment>
        </Box>);

    let borderBoxStyle = {
        border: '1px solid rgba(0,0,0,0.1)', 
        borderRadius: '16px', 
        //boxShadow: '0 0 5px rgba(0,0,0,0.1)',
    }

    const fixedSplitPane = ( 
        <Box sx={{display: 'flex', flexDirection: 'row', height: '100%'}}>
            <Box sx={{
                ...borderBoxStyle,
                    margin: '4px 4px 4px 8px', backgroundColor: 'white',
                    display: 'flex', height: '100%', width: 'fit-content', flexDirection: 'column'}}>
                {tables.length > 0 ?  <DataThread sx={{
                    minWidth: 201,
                    display: 'flex', 
                    flexDirection: 'column',
                    overflow: 'hidden',
                    alignContent: 'flex-start',
                    height: '100%',
                }}/>  : ""} 
            </Box>
            <Box sx={{
                ...borderBoxStyle,
                margin: '4px 8px 4px 4px', backgroundColor: 'white',
                display: 'flex', height: '100%', flex: 1, overflow: 'hidden', flexDirection: 'row'
            }}>
                {viewMode === 'editor' ? (
                    <>
                        {visPane}
                        {/* <ConceptShelf /> */}
                    </>
                ) : (
                    <ReportView />
                )}
            </Box>
            
        </Box>
    );

    let footer = <Box sx={{ color: 'text.secondary', display: 'flex', 
            backgroundColor: 'rgba(255, 255, 255, 0.89)',
            alignItems: 'center', justifyContent: 'center' }}>
        <Button size="small" color="inherit" 
            sx={{ textTransform: 'none'}} 
            target="_blank" rel="noopener noreferrer" 
            href="https://www.microsoft.com/en-us/privacy/privacystatement">Privacy & Cookies</Button>
        <Divider orientation="vertical" variant="middle" flexItem sx={{ mx: 1 }} />
        <Button size="small" color="inherit" 
            sx={{ textTransform: 'none'}} 
            target="_blank" rel="noopener noreferrer" 
            href="https://www.microsoft.com/en-us/legal/intellectualproperty/copyright">Terms of Use</Button>
        <Divider orientation="vertical" variant="middle" flexItem sx={{ mx: 1 }} />
        <Button size="small" color="inherit" 
            sx={{ textTransform: 'none'}} 
            target="_blank" rel="noopener noreferrer" 
            href="https://github.com/microsoft/data-formulator/issues">Contact Us</Button>
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
                textAlign: 'center', mb: 4}}>
                Explore data with visualizations, powered by AI agents. 
            </Typography>
            <Box sx={{my: 4}}>
                <DataLoadMenu 
                    onSelectTab={(tab) => openUploadDialog(tab)}
                    serverConfig={serverConfig}
                    variant="page"
                />
                <UnifiedDataUploadDialog 
                    open={uploadDialogOpen}
                    onClose={() => setUploadDialogOpen(false)}
                    initialTab={uploadDialogInitialTab}
                />
            </Box>
            <Box sx={{mt: 4}}>
                <Divider sx={{width: '200px', mx: 'auto', mb: 3, fontSize: '1.2rem'}}>
                    <Typography sx={{ color: 'text.secondary' }}>
                        demos
                    </Typography>
                </Divider>
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 2,
                }}>
                    {exampleSessions.map((session) => (
                        <ExampleSessionCard
                            key={session.id}
                            session={session}
                            theme={theme}
                            onClick={() => handleLoadExampleSession(session)}
                        />
                    ))}
                </Box>
            </Box>
        </Box>
        {footer}
    </Box>;
    
    return (
        <Box sx={{ display: 'block', width: "100%", height: 'calc(100% - 54px)', position: 'relative' }}>
            <DndProvider backend={HTML5Backend}>
                {tables.length > 0 ? fixedSplitPane : dataUploadRequestBox}
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
                                First, let's <ModelSelectionButton />
                            </Typography>
                            <Typography  color="text.secondary" variant="body1" sx={{mt: 2, width: 600}}>💡 Models with strong code generation capabilities (e.g., gpt-5, claude-sonnet-4-5) provide best experience with Data Formulator.</Typography>
                        </Box>
                        {footer}
                    </Box>
                )}
            </DndProvider>
        </Box>);
}