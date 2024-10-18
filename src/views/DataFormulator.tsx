// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect } from 'react';
import '../scss/App.scss';

import { useDispatch, useSelector } from "react-redux"; /* code change */
import { 
    DataFormulatorState,
    dfActions,
} from '../app/dfSlice'

import _ from 'lodash';

import SplitPane from "react-split-pane";
import {

    Typography,
    Box,
    Tooltip,
    Button,
} from '@mui/material';



import { styled } from '@mui/material/styles';

import { FreeDataViewFC } from './DataView';
import { VisualizationViewFC } from './VisualizationView';

import { ConceptShelf } from './ConceptShelf';
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'

import { SelectableGroup } from 'react-selectable-fast';
import { TableCopyDialogV2, TableSelectionDialog, TableURLDialog } from './TableSelectionView';
import { TableCopyDialog, TableUploadDialog } from './TableSelectionView';
import { toolName } from '../app/App';
import { DataThread } from './DataThread';

import dfLogo from '../assets/df-logo.png';
import exampleImageTable from "../assets/example-image-table.png";
import { ModelSelectionButton } from './ModelSelectionDialog';

const MainSplitPane = styled(SplitPane)(({ theme }) => ({
    //height: 'calc(100% - 49px) !important',
    //left: '121px !important'
}));

//type AppProps = ConnectedProps<typeof connector>;

export const DataFormulatorFC = ({ }) => {

    const displayPanelSize = useSelector((state: DataFormulatorState) => state.displayPanelSize);
    const visPaneSize = useSelector((state: DataFormulatorState) => state.visPaneSize);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const selectedModel = useSelector((state: DataFormulatorState) => state.selectedModel);

    const dispatch = useDispatch();

    useEffect(() => {
        document.title = toolName;
    }, []);

    let conceptEncodingPanel = (
        <Box sx={{display: "flex", flexDirection: "row", width: '100%', flexGrow: 1, overflow: "hidden"}}>
            <ConceptShelf />
        </Box>
    )

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

    const splitPane = ( // @ts-ignore
        <MainSplitPane split="vertical"
            maxSize={440}
            minSize={320}
            primary="second"
            size={displayPanelSize}
            style={{width: "100%", height: '100%', position: 'relative'}}
            onDragFinished={size => { dispatch(dfActions.setDisplayPanelSize(size)) }}>
            <Box sx={{display: 'flex', width: `100%`, height: '100%'}}>
                {tables.length > 0 ? 
                        <DataThread />   //<Carousel />
                        : ""} 
                    {visPane}
            </Box>
            <Box className="data-editor">
                {conceptEncodingPanel}
                {/* <InfoPanelFC $tableRef={$tableRef}/> */}
            </Box>
        </MainSplitPane>);

    const fixedSplitPane = ( 
        <Box sx={{display: 'flex', flexDirection: 'row', height: '100%'}}>
            <Box sx={{display: 'flex', width: `calc(100% - ${280}px)`}}>
            {tables.length > 0 ? 
                    <DataThread />   //<Carousel />
                    : ""} 
                {visPane}
            </Box>
            <Box className="data-editor" sx={{width: 280, borderLeft: '1px solid lightgray'}}>
                {conceptEncodingPanel}
                {/* <InfoPanelFC $tableRef={$tableRef}/> */}
            </Box>
        </Box>);

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
                <TableSelectionDialog  buttonElement={"Examples"} />, <TableUploadDialog buttonElement={"file"} disabled={false} />, or <TableCopyDialogV2 buttonElement={"clipboard"} disabled={false} /> 
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

    console.log("selected model?")
    console.log(selectedModel)

    return (
        <Box sx={{ display: 'block', width: "100%", height: 'calc(100vh - 49px)' }}>
            <DndProvider backend={HTML5Backend}>
                {selectedModel == undefined ? modelSelectionDialogBox : (tables.length > 0 ? fixedSplitPane : dataUploadRequestBox)} 
            </DndProvider>
            

        </Box>);
}