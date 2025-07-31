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

import SplitPane from "react-split-pane";
import {

    Typography,
    Box,
    Tooltip,
    Button,
    Collapse,
    IconButton,  // Add this
} from '@mui/material';

// Add these icon imports
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';


import { alpha, styled, useTheme } from '@mui/material/styles';

import { FreeDataViewFC } from './DataView';
import { VisualizationViewFC } from './VisualizationView';

import { ConceptShelf } from './ConceptShelf';
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'

import { SelectableGroup } from 'react-selectable-fast';
import { TableCopyDialogV2, TableSelectionDialog } from './TableSelectionView';
import { TableUploadDialog } from './TableSelectionView';
import { toolName } from '../app/App';
import { DataThread } from './DataThread';

import dfLogo from '../assets/df-logo.png';
import exampleImageTable from "../assets/example-image-table.png";
import { ModelSelectionButton } from './ModelSelectionDialog';
import { DBTableSelectionDialog } from './DBTableManager';
import { connectToSSE } from './SSEClient';
import { getUrls } from '../app/utils';

//type AppProps = ConnectedProps<typeof connector>;

export const DataFormulatorFC = ({ }) => {

    const displayPanelSize = useSelector((state: DataFormulatorState) => state.displayPanelSize);
    const visPaneSize = useSelector((state: DataFormulatorState) => state.visPaneSize);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    
    const models = useSelector((state: DataFormulatorState) => state.models);
    const modelSlots = useSelector((state: DataFormulatorState) => state.modelSlots);
    const testedModels = useSelector((state: DataFormulatorState) => state.testedModels);
    
    const noBrokenModelSlots= useSelector((state: DataFormulatorState) => {
        const slotTypes = dfSelectors.getAllSlotTypes();
        return slotTypes.every(
            slotType => state.modelSlots[slotType] !== undefined && state.testedModels.find(t => t.id == state.modelSlots[slotType])?.status != 'error');
    });

    const [conceptPanelOpen, setConceptPanelOpen] = useState(true); 

    const dispatch = useDispatch();
    const theme = useTheme();

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

    const visPane = (// @ts-ignore
        <SplitPane split="horizontal"
            minSize={100} size={visPaneSize}
            className={'vis-split-pane'}
            style={{}}
            pane2Style={{overflowY: "hidden"}}
            onDragFinished={size => { dispatch(dfActions.setVisPaneSize(size)) }}>
            {visPaneMain}
            <Box className="table-box">
                <FreeDataViewFC $tableRef={$tableRef}/>
            </Box>
        </SplitPane>);

    let conceptPanel = <Box sx={{
        display: 'flex',
        flexDirection: 'row',
        flexShrink: 0, // Prevent panel from shrinking
        width: conceptPanelOpen ? 304 : 64,
        transition: 'width 0.3s ease', // Smooth transition
        overflow: 'hidden',
        position: 'relative'
    }}>
        <Tooltip placement="left" title={conceptPanelOpen ? "hide concept panel" : "open concept panel"}>
            <IconButton 
                color="primary"
                sx={{
                    width: 16, 
                    minWidth: 16,
                    alignSelf: 'stretch', // Add this to match the height of the ConceptShelf box
                    borderRadius: 0,
                    flexShrink: 0,
                    position: 'relative',
                    backgroundColor: 'rgba(0,0,0,0.01)'
                }}
                onClick={() => setConceptPanelOpen(!conceptPanelOpen)}
            >
                <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1,
                }}>
                    {conceptPanelOpen ?  <ChevronRightIcon sx={{fontSize: 18}} /> : <ChevronLeftIcon sx={{fontSize: 18}} />}
                </Box>
            </IconButton>
        </Tooltip>
        <Box 
            onClick={() => !conceptPanelOpen && setConceptPanelOpen(!conceptPanelOpen)}
            sx={{
                width: 280, 
                overflow: 'hidden'
        }}>
            <ConceptShelf />
        </Box>
    </Box>;

    const fixedSplitPane = ( 
        <Box sx={{display: 'flex', flexDirection: 'row', height: '100%'}}>
            <Box sx={{border: '1px solid lightgray', borderRadius: '4px', margin: '4px', backgroundColor: 'white',
                 display: 'flex', height: '100%', width: 'fit-content', flexDirection: 'column'}}>
                {tables.length > 0 ?  <DataThread sx={{
                    minWidth: 201,
                    display: 'flex', 
                    flexDirection: 'column',
                    overflow: 'hidden',
                    //borderRight: '1px solid lightgray',
                    alignContent: 'flex-start',
                    height: '100%',
                }}/>  : ""} 
            </Box>
            <Box sx={{
                border: '1px solid lightgray', borderRadius: '4px', margin: '4px', backgroundColor: 'white',
                display: 'flex', height: '100%', flex: 1, overflow: 'hidden', flexDirection: 'row'}}>
                {visPane}
                {conceptPanel}
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

    let dataUploadRequestBox = <Box sx={{width: '100vw'}}>
        <Box sx={{paddingTop: "8%", display: "flex", flexDirection: "column", textAlign: "center"}}>
            <Box component="img" sx={{  width: 256, margin: "auto" }} alt="" src={dfLogo} />
            <Typography variant="h3" sx={{marginTop: "20px"}}>
                {toolName}
            </Typography>
            
            <Typography variant="h4">
                Load data from
                <TableSelectionDialog  buttonElement={"Examples"} />, <TableUploadDialog buttonElement={"file"} disabled={false} />, <TableCopyDialogV2 buttonElement={"clipboard"} disabled={false} /> or <DBTableSelectionDialog buttonElement={"Database"} />
            </Typography>
            <Typography sx={{  width: 960, margin: "auto" }} variant="body1">
                Besides formatted data (csv, tsv or json), you can copy-paste&nbsp;
                <Tooltip title={<Box>Example of a messy text block: <Typography sx={{fontSize: 10, marginTop: '6px'}} component={"pre"}>{exampleMessyText}</Typography></Box>}><Typography color="secondary" display="inline" sx={{cursor: 'help', "&:hover": {textDecoration: 'underline'}}}>a text block</Typography></Tooltip> or&nbsp;
                <Tooltip title={<Box>Example of a table in image format: <Box component="img" sx={{ width: '100%',  marginTop: '6px' }} alt="" src={exampleImageTable} /></Box>}><Typography color="secondary"  display="inline" sx={{cursor: 'help', "&:hover": {textDecoration: 'underline'}}}>an image</Typography></Tooltip> that contain data into clipboard to get started.
            </Typography>
        </Box>
        <Button size="small" color="inherit" 
                sx={{position: "absolute", color:'darkgray', bottom: 0, right: 0, textTransform: 'none'}} 
                target="_blank" rel="noopener noreferrer" 
                href="https://privacy.microsoft.com/en-US/data-privacy-notice">view data privacy notice</Button>
    </Box>;

    let modelSelectionDialogBox = <Box sx={{width: '100vw'}}>
        <Box sx={{paddingTop: "8%", display: "flex", flexDirection: "column", textAlign: "center"}}>
            <Box component="img" sx={{  width: 256, margin: "auto" }} alt="" src={dfLogo} />
            <Typography variant="h3" sx={{marginTop: "20px"}}>
                {toolName}
            </Typography>
            <Typography variant="h4">
                Let's <ModelSelectionButton />
            </Typography>
            <Typography variant="body1">Specify an OpenAI or Azure OpenAI endpoint to run {toolName}.</Typography>
        </Box>
        <Button size="small" color="inherit" 
                sx={{position: "absolute", color:'darkgray', bottom: 0, right: 0, textTransform: 'none'}} 
                target="_blank" rel="noopener noreferrer" 
                href="https://privacy.microsoft.com/en-US/data-privacy-notice">view data privacy notice</Button>
    </Box>;

    return (
        <Box sx={{ display: 'block', width: "100%", height: 'calc(100% - 54px)' }}>
            <DndProvider backend={HTML5Backend}>
                {!noBrokenModelSlots ? modelSelectionDialogBox : (tables.length > 0 ? fixedSplitPane : dataUploadRequestBox)} 
            </DndProvider>
        </Box>);
}