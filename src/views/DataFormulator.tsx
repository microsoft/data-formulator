// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useState } from 'react';
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
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField
} from '@mui/material';



import { styled } from '@mui/material/styles';

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

//type AppProps = ConnectedProps<typeof connector>;

import axios from 'axios';

export const DataFormulatorFC = ({ }) => {

    const displayPanelSize = useSelector((state: DataFormulatorState) => state.displayPanelSize);
    const visPaneSize = useSelector((state: DataFormulatorState) => state.visPaneSize);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);

    const dispatch = useDispatch();

    useEffect(() => {
        document.title = toolName;
    }, []);

    let conceptEncodingPanel = (
        <Box sx={{display: "flex", flexDirection: "row", width: '100%', flexGrow: 1, overflow: "hidden"}}>
            <ConceptShelf />
        </Box>
    )

    const [isDialogOpen, setDialogOpen] = useState(false);
    const [insights, setInsights] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchInsights = async () => {
        setLoading(true);
        try {
            const response = await axios.post('/api/agent/generate-insights', {
                input_data: [], // Replace with actual input data
                model: {} // Replace with actual model configuration
            });

            if (response.data.status === 'ok') {
                setInsights(response.data.insights);
            } else {
                setInsights([`Error: ${response.data.message}`]);
            }
        } catch (error) {
            setInsights([`Error: ${error.message}`]);
        } finally {
            setLoading(false);
        }
    };

    const handleDialogOpen = () => {
        fetchInsights();
        setDialogOpen(true);
    };

    const visPaneMain = (
        <Box sx={{ width: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <VisualizationViewFC />
            <Button variant="contained" color="primary" onClick={handleDialogOpen} sx={{ marginTop: 2 }}>
                Show Insights & Recommendations
            </Button>
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
        <SplitPane split="vertical"
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
        </SplitPane>);

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

    console.log("selected model?")
    console.log(selectedModelId)
    
    const [dialog, setDialog] = useState<string>('');
    const [prompt, setPrompt] = useState<string>('');
    const [chart, setChart] = useState<any>(null);
    const [loadingChart, setLoadingChart] = useState(false);

    const handleGenerateChart = async () => {
        setLoadingChart(true);
        try {
            const response = await axios.post('/api/agent/generate-chart', {
                dialog: dialog.split('\n'), // Split dialog into lines
                prompt: prompt
            });

            if (response.data.status === 'ok') {
                setChart(response.data.chart);
            } else {
                alert(`Error: ${response.data.message}`);
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
        } finally {
            setLoadingChart(false);
        }
    };

    return (
        <Box sx={{ display: 'block', width: "100%", height: 'calc(100% - 49px)' }}>
            <DndProvider backend={HTML5Backend}>
                {selectedModelId == undefined ? modelSelectionDialogBox : (tables.length > 0 ? fixedSplitPane : dataUploadRequestBox)}
            </DndProvider>

            {/* Input for dialog and prompt */}
            <Box sx={{ marginTop: 2 }}>
                <Typography variant="h6">Generate Chart</Typography>
                <TextField
                    label="User Dialog"
                    multiline
                    rows={4}
                    fullWidth
                    value={dialog}
                    onChange={(e) => setDialog(e.target.value)}
                    sx={{ marginBottom: 2 }}
                />
                <TextField
                    label="Prompt"
                    fullWidth
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    sx={{ marginBottom: 2 }}
                />
                <Button
                    variant="contained"
                    color="primary"
                    onClick={handleGenerateChart}
                    disabled={loadingChart}
                >
                    {loadingChart ? 'Generating...' : 'Generate Chart'}
                </Button>
            </Box>

            {/* Display the generated chart */}
            {chart && (
                <Box sx={{ marginTop: 4 }}>
                    <Typography variant="h6">Generated Chart</Typography>
                    <pre>{JSON.stringify(chart, null, 2)}</pre>
                </Box>
            )}

            {/* Dialog for Insights & Recommendations */}
            <Dialog open={isDialogOpen} onClose={handleDialogClose} maxWidth="sm" fullWidth>
                <DialogTitle>Insights & Recommendations</DialogTitle>
                <DialogContent>
                    {loading ? (
                        <Typography>Loading insights and recommendations...</Typography>
                    ) : (
                        insights.map((insight, index) => (
                            <Typography key={index}>{insight}</Typography>
                        ))
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleDialogClose} color="primary">Close</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}