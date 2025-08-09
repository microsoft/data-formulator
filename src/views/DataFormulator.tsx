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
} from '@mui/material';

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
import { getUrls } from '../app/utils';
import { CloudQueue } from '@mui/icons-material';
import { DataLoadingChatDialog } from './DataLoadingChat';
import { RotatingTextBlock } from '../components/RotatingTextBlock';

export const DataFormulatorFC = ({ }) => {

    const tables = useSelector((state: DataFormulatorState) => state.tables);
    
    const models = useSelector((state: DataFormulatorState) => state.models);
    const modelSlots = useSelector((state: DataFormulatorState) => state.modelSlots);

    let [dbPanelOpen, setDbPanelOpen] = useState<boolean>(false);
    
    const noBrokenModelSlots= useSelector((state: DataFormulatorState) => {
        const slotTypes = dfSelectors.getAllSlotTypes();
        return slotTypes.every(
            slotType => state.modelSlots[slotType] !== undefined && state.testedModels.find(t => t.id == state.modelSlots[slotType])?.status != 'error');
    });


    const dispatch = useDispatch();

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

    const fixedSplitPane = ( 
        <Box sx={{display: 'flex', flexDirection: 'row', height: '100%'}}>
            <Box sx={{border: '1px solid lightgray', borderRadius: '4px', margin: '4px 4px 4px 8px', backgroundColor: 'white',
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
                border: '1px solid lightgray', borderRadius: '4px', margin: '4px 8px 4px 4px', backgroundColor: 'white',
                display: 'flex', height: '100%', flex: 1, overflow: 'hidden', flexDirection: 'row'
            }}>
                {visPane}
                <ConceptShelf />
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

    const rotatingTexts = [
        "data from an image",
        "data from a text block", 
        "a synthetic dataset",
    ];


    let dataUploadRequestBox = <Box sx={{width: '100vw', overflow: 'auto', display: 'flex', flexDirection: 'column', height: '100%'}}>
        <Box sx={{margin:'auto', pb: '5%', display: "flex", flexDirection: "column", textAlign: "center"}}>
            <Box component="img" sx={{  width: 196, margin: "auto" }} alt="" src={dfLogo} />
            <Typography variant="h3" sx={{marginTop: "20px", fontWeight: 200, letterSpacing: '0.05em'}}>
                {toolName}
            </Typography>
            <Typography  variant="h4" sx={{mt: 3, fontSize: 28, letterSpacing: '0.02em'}}>
                <DataLoadingChatDialog buttonElement={"Vibe"}/> with <RotatingTextBlock 
                    texts={rotatingTexts}
                    typingSpeed={50}
                    rotationInterval={5000}
                    transitionDuration={300}
                />
                <Divider sx={{width: '80px', margin: '10px auto', fontSize: '1.2rem', color: 'text.disabled'}}> or </Divider>
                Load data from
                <TableSelectionDialog  buttonElement={"Examples"} />, <TableUploadDialog buttonElement={"file"} disabled={false} />, <TableCopyDialogV2 buttonElement={"clipboard"} disabled={false} />, or <DBTableSelectionDialog buttonElement={"Database"} component="dialog" />
            </Typography>
            
            <Typography sx={{  width: 960, margin: "auto" }} variant="body1">
                Besides formatted data (csv, tsv, xlsx, json or database tables), you can ask AI to extract data from&nbsp;
                <Tooltip title={<Box>Example of a messy text block: <Typography sx={{fontSize: 10, marginTop: '6px'}} component={"pre"}>{exampleMessyText}</Typography></Box>}><Box component="span" sx={{color: 'secondary.main', cursor: 'help', "&:hover": {textDecoration: 'underline'}}}>a text block</Box></Tooltip> or&nbsp;
                <Tooltip title={<Box>Example of a table in image format: <Box component="img" sx={{ width: '100%',  marginTop: '6px' }} alt="" src={exampleImageTable} /></Box>}><Box component="span" sx={{color: 'secondary.main', cursor: 'help', "&:hover": {textDecoration: 'underline'}}}>an image</Box></Tooltip>.
            </Typography>
        </Box>
        <Button size="small" color="inherit" 
                sx={{position: "absolute", color:'darkgray', bottom: 0, right: 0, textTransform: 'none'}} 
                target="_blank" rel="noopener noreferrer" 
                href="https://privacy.microsoft.com/en-US/data-privacy-notice">view data privacy notice</Button>
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
                href="https://privacy.microsoft.com/en-US/data-privacy-notice">view data privacy notice</Button>
    </Box>;

    return (
        <Box sx={{ display: 'block', width: "100%", height: 'calc(100% - 54px)' }}>
            <DndProvider backend={HTML5Backend}>
                {!noBrokenModelSlots ? modelSelectionDialogBox : (tables.length > 0 ? fixedSplitPane : dataUploadRequestBox)}
            </DndProvider>
        </Box>);
}