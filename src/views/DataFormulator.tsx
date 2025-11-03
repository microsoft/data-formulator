// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useState } from 'react';
import '../scss/App.scss';

import { useDispatch, useSelector } from "react-redux"; /* code change */
import { 
    DataFormulatorState,
    dfActions,
    dfSelectors,
} from '../app/dfSlice'

import _ from 'lodash';

import { Allotment } from "allotment";
import "allotment/dist/style.css";

import {

    Typography,
    Box,
    Tooltip,
    Button,
    Collapse,
    IconButton,
    Paper,
    Divider,
    useTheme,
    alpha,
} from '@mui/material';
import {
    SmartToy as SmartToyIcon,
    FolderOpen as FolderOpenIcon,
    BarChart as BarChartIcon,
    ContentPaste as ContentPasteIcon,
    Storage as StorageIcon,
    Category as CategoryIcon,
    CloudQueue as CloudQueueIcon,
    AutoFixNormal as AutoFixNormalIcon,
} from '@mui/icons-material';

import { FreeDataViewFC } from './DataView';
import { VisualizationViewFC } from './VisualizationView';

import { ConceptShelf } from './ConceptShelf';
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'

import { SelectableGroup } from 'react-selectable-fast';
import { TableCopyDialogV2, DatasetSelectionDialog } from './TableSelectionView';
import { TableUploadDialog } from './TableSelectionView';
import { toolName } from '../app/App';
import { DataThread } from './DataThread';

import dfLogo from '../assets/df-logo.png';
import exampleImageTable from "../assets/example-image-table.png";
import { ModelSelectionButton } from './ModelSelectionDialog';
import { DBTableSelectionDialog } from './DBTableManager';
import { getUrls } from '../app/utils';
import { DataLoadingChatDialog } from './DataLoadingChat';
import { RotatingTextBlock } from '../components/RotatingTextBlock';
import { ReportView } from './ReportView';
import { ExampleSession, exampleSessions, ExampleSessionCard } from './ExampleSessions';

export const DataFormulatorFC = ({ }) => {

    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const models = useSelector((state: DataFormulatorState) => state.models);
    const modelSlots = useSelector((state: DataFormulatorState) => state.modelSlots);
    const viewMode = useSelector((state: DataFormulatorState) => state.viewMode);
    const theme = useTheme();

    const noBrokenModelSlots= useSelector((state: DataFormulatorState) => {
        const slotTypes = dfSelectors.getAllSlotTypes();
        return slotTypes.every(
            slotType => state.modelSlots[slotType] !== undefined && state.testedModels.find(t => t.id == state.modelSlots[slotType])?.status != 'error');
    });

    const dispatch = useDispatch();

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
    }, []);

    useEffect(() => {
        const findWorkingModel = async () => {
            let assignedModels = models.filter(m => Object.values(modelSlots).includes(m.id));
            let unassignedModels = models.filter(m => !Object.values(modelSlots).includes(m.id));
            
            // Combine both arrays: assigned models first, then unassigned models
            let allModelsToTest = [...assignedModels, ...unassignedModels];

            for (let i = 0; i < allModelsToTest.length; i++) {
                let model = allModelsToTest[i];
                let isAssignedModel = i < assignedModels.length;

                const message = {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', },
                    body: JSON.stringify({
                        model: model,
                    }),
                };
                try {
                    const response = await fetch(getUrls().TEST_MODEL, {...message });
                    const data = await response.json();
                    const status = data["status"] || 'error';
                    dispatch(dfActions.updateModelStatus({id: model.id, status, message: data["message"] || ""}));
                    // For unassigned models, break when we find a working one
                    if (!isAssignedModel && status == 'ok') {
                        break;
                    }
                } catch (error) {
                    dispatch(dfActions.updateModelStatus({id: model.id, status: 'error', message: (error as Error).message || 'Failed to test model'}));
                }
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

    let $tableRef = React.createRef<SelectableGroup>();

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
                        <FreeDataViewFC $tableRef={$tableRef}/>
                    </Box>
                </Allotment.Pane>
            </Allotment>
        </Box>);

    let borderBoxStyle = {
        border: '1px solid rgba(0,0,0,0.1)', 
        borderRadius: '16px', 
        boxShadow: '0 0 5px rgba(0,0,0,0.1)',
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
                        <ConceptShelf />
                    </>
                ) : (
                    <ReportView />
                )}
            </Box>
            
        </Box>
    );

    let exampleMessyText=`Rank	NOC	Gold	Silver	Bronze	Total
1	 South Korea	5	1	1	7
2	 France*	0	1	1	2
 United States	0	1	1	2
4	 China	0	1	0	1
 Germany	0	1	0	1
6	 Mexico	0	0	1	1
 Turkey	0	0	1	1
Totals (7 entries)	5	5	5	15
`

    let dataUploadRequestBox = <Box sx={{
            margin: '4px 4px 4px 8px', 
            width: 'calc(100vw - 16px)', overflow: 'auto', display: 'flex', flexDirection: 'column', height: '100%',
        }}
        >
        <Box sx={{margin:'auto', pb: '5%', display: "flex", flexDirection: "column", textAlign: "center" }}>
            <Box sx={{display: 'flex', mx: 'auto', mb: 2, width: 'fit-content', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                background: `
                linear-gradient(90deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px),
                linear-gradient(0deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px)
            `,
            backgroundSize: '16px 16px',
            p: 2,
            borderRadius: '8px',
            }}>
                <Box component="img" sx={{  width: 84,  }} alt="" src={dfLogo} /> 
                <Typography fontSize={64} sx={{ml: 2, letterSpacing: '0.05em', fontWeight: 200, color: 'text.primary'}}>{toolName}</Typography> 
            </Box>
            <Typography fontSize={24} sx={{color: 'text.secondary'}}>Turn data into insights with AI agents, with the exploration paths you choose.</Typography>
            <Box sx={{mt: 4, width: '100%', borderRadius: 8, 
                background: `
                    linear-gradient(90deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px),
                    linear-gradient(0deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px)
                `,
                backgroundSize: '16px 16px',
                p: 2}}>
                <Divider sx={{width: '200px', mx: 'auto', mb: 2, fontSize: '1.2rem', color: 'text.disabled'}}>
                    <Typography sx={{ fontSize: 14, color: 'text.disabled' }}>
                        load some data
                    </Typography>
                </Divider>
                <Typography  variant="h4" sx={{mx: 'auto', width: 1080,  fontSize: 24}}>
                    <DataLoadingChatDialog buttonElement={<><AutoFixNormalIcon sx={{ mr: 1, verticalAlign: 'middle' }} />Messy data</>}/>  
                    <Box component="span" sx={{ mx: 2, color: 'text.disabled', fontSize: '0.8em' }}>•</Box>
                    <DatasetSelectionDialog  buttonElement={<><CategoryIcon sx={{ mr: 1, verticalAlign: 'middle' }} />Examples</>} /> 
                    <Box component="span" sx={{ mx: 2, color: 'text.disabled', fontSize: '0.8em' }}>•</Box>
                    <TableUploadDialog buttonElement={<><FolderOpenIcon sx={{ mr: 1, verticalAlign: 'middle' }} />files</>} disabled={false} /> 
                    <Box component="span" sx={{ mx: 2, color: 'text.disabled', fontSize: '0.8em' }}>•</Box>
                    <TableCopyDialogV2 buttonElement={<><ContentPasteIcon sx={{ mr: 1, verticalAlign: 'middle' }} />clipboard</>} disabled={false} /> 
                    <Box component="span" sx={{ mx: 2, color: 'text.disabled', fontSize: '0.8em' }}>•</Box>
                    <DBTableSelectionDialog buttonElement={<><CloudQueueIcon sx={{ mr: 1, verticalAlign: 'middle' }} />Database</>} component="dialog" />
                    {/* <br /> */}
                    {/* <Typography sx={{ml: 10, fontSize: 14, color: 'darkgray', transform: 'translateY(-12px)'}}>(csv, tsv, xlsx, json or database)</Typography> */}
                    <Typography variant="body1" color="text.secondary" sx={{ mt: 2, width: '100%' }}>
                        Load structured data from CSV, Excel, JSON, database, or extract data from{' '}
                        <Tooltip title={<Box>Example of a screenshot of data: <Box component="img" sx={{ width: '100%', marginTop: '6px' }} alt="" src={exampleImageTable} /></Box>}>
                            <Box component="span" sx={{color: 'secondary.main', cursor: 'help', "&:hover": {textDecoration: 'underline'}}}>screenshots</Box>
                        </Tooltip>{' '}
                        and{' '}
                        <Tooltip title={<Box>Example of a messy text block: <Typography sx={{fontSize: 10, marginTop: '6px'}} component="pre">{exampleMessyText}</Typography></Box>}>
                            <Box component="span" sx={{color: 'secondary.main', cursor: 'help', "&:hover": {textDecoration: 'underline'}}}>text blocks</Box>
                        </Tooltip>{' '}
                        using AI.
                    </Typography> 
                </Typography>
            </Box>
            <Box sx={{mt: 4, borderRadius: 8, p: 2,
                background: `
                 linear-gradient(90deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px),
                 linear-gradient(0deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px)
                `,
                backgroundSize: '16px 16px',
            }}>
                <Divider sx={{width: '200px', mx: 'auto', mb: 3, fontSize: '1.2rem', color: 'text.disabled'}}>
                    <Typography sx={{ fontSize: 14, color: 'text.disabled' }}>
                        or, explore examples
                    </Typography>
                </Divider>
                <Box sx={{ alignItems: 'center' }}>
                    <Box sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        maxWidth: 1000,
                        margin: '0 auto',
                        px: 1
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
        </Box>
        <Button size="small" color="inherit" 
                sx={{position: "absolute", color:'darkgray', bottom: 8, left: 16, textTransform: 'none'}} 
                target="_blank" rel="noopener noreferrer" 
                href="https://www.microsoft.com/en-us/privacy/privacystatement">Privacy & Cookies</Button>
    </Box>;

    let modelSelectionDialogBox = <Box sx={{width: '100vw', display: 'flex', flexDirection: 'column', height: '100%'}}>
        <Box sx={{margin:'auto', pb: '5%', display: "flex", flexDirection: "column", textAlign: "center"}}>
            <Box component="img" sx={{  width: 196, margin: "auto" }} alt="" src={dfLogo} />
            <Typography variant="h3" sx={{marginTop: "20px", fontWeight: 200, letterSpacing: '0.05em'}}>
                {toolName}
            </Typography>
            <Typography  variant="h4" sx={{mt: 3, fontSize: 28, letterSpacing: '0.02em'}}>
                Let's <ModelSelectionButton />
            </Typography>
            <Typography variant="body1">Specify an AI endpoint to run {toolName}.</Typography>
        </Box>
        <Button size="small" color="inherit" 
                sx={{position: "absolute", color:'darkgray', bottom: 0, right: 0, textTransform: 'none'}} 
                target="_blank" rel="noopener noreferrer" 
                href="https://www.microsoft.com/en-us/privacy/privacystatement">Privacy & Cookies</Button>
    </Box>;

    return (
        <Box sx={{ display: 'block', width: "100%", height: 'calc(100% - 54px)' }}>
            <DndProvider backend={HTML5Backend}>
                {!noBrokenModelSlots ? modelSelectionDialogBox : (tables.length > 0 ? fixedSplitPane : dataUploadRequestBox)}
            </DndProvider>
        </Box>);
}