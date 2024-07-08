// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useMemo, useState } from 'react'

import {
		Card,
		Box,
		Typography,
		Dialog,
        DialogTitle,
        DialogContent,
        DialogActions,
        Button,
        Radio,
        styled,
        FormControlLabel,
        CardContent,
        LinearProgress,
} from '@mui/material';


import React from 'react';

import { ConceptTransformation, createDictTable, FieldItem } from '../components/ComponentType';
import { deriveTransformExamplesV2, getDomains, processCodeCandidates } from './ViewUtils';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions } from '../app/dfSlice';

import prettier from "prettier";
import parserBabel from 'prettier/parser-babel';
import { CodexDialogBox } from './ConceptCard';
import { CodeBox } from './VisualizationView';
import { CustomReactTable } from './ReactTable';

export const GroupHeader = styled('div')(({ theme }) => ({
    position: 'sticky',
    top: '-8px',
    padding: '4px 4px',
    color: "darkgray",
    fontSize: "12px",
}));
  
export const GroupItems = styled('ul')({
    padding: 0,
});

export interface DisambiguationDialogProps {
    conceptName: string;
    parentIDs: string[];
    conceptShelfItems: FieldItem[];
    open: boolean;
    transformDesc: string; // text description of the transformation function
    codeCandidates: string[];
    handleUpdate: (code: string, description: string, closeDialog: boolean) => void;
    onClose: ()=>void;
}

export const DisambiguationDialog: FC<DisambiguationDialogProps> = function DisambiguationDialog({
    conceptName, parentIDs, conceptShelfItems, open, transformDesc, codeCandidates, handleUpdate, onClose
}) {

    // use tables for infer domains
    const tables = useSelector((state: DataFormulatorState) => state.tables);

    let [description, setDescription] = React.useState(transformDesc);
    let [codeList, setCodeList] = React.useState(codeCandidates);
    let [selectionIdx, setSelectionIdx] = React.useState(0);
    let [showCode, setShowCode] = React.useState(false);

    useEffect(()=>{ setCodeList(codeCandidates) }, [codeCandidates]);
    useEffect(()=>{ setDescription(transformDesc) }, [transformDesc]);

    // time stamps used to track functions from server
    const [codeGenInProgress, setCodeGenInProgress] = useState<boolean>(false);
    
    useEffect(() => { setSelectionIdx(0) }, [codeCandidates]);

    let dispatch = useDispatch();

    let parentConcepts = parentIDs.map(id => (conceptShelfItems.find(f => f.id == id) as FieldItem)); 

    // get outputs from each code candidate, running on each test data point, eval is much faster...
    //let codeOutpus = codeList.map(codeStr => testInputs.map(s => [s, runCodeInVM(codeStr, s)]));
    let codeOutputs = useMemo(
        () => codeList.map(codeStr => deriveTransformExamplesV2(codeStr, parentIDs, 150, conceptShelfItems, tables)),
        [codeList]
    );
      
    let [displayPage, setDisplayPage] = React.useState(0);
    let displayPageSize = 8;

    let inputFieldsInfo = parentConcepts.map(c => {
        let values = [];
        if (c.source == "derived") {
            // run the transformation function to obtain the results
            let transform = c.transform as ConceptTransformation;
            values = deriveTransformExamplesV2(transform.code, transform.parentIDs, 5, conceptShelfItems, tables).map(t => t[1]);
        } else {
            values = getDomains(c, tables).map(d => d.slice(0, 5)).flat() //c.domain.values.slice(0, 5);
        }
        return {
            name: c.name,
            type: values.length > 0 ? (typeof values[0]) : "string",
            values
        }
    })

    let handleProcessResults = (status: string, rawCodeList: string[]) => {
        setCodeGenInProgress(false);
        if (status == "ok") {

            let candidates = processCodeCandidates(rawCodeList, parentIDs, conceptShelfItems, tables)
            let candidate = candidates[0];

            setCodeList(candidates); // setCodeCandidates(codeList)
            handleUpdate(candidate, description, false);

            if (candidates.length > 0) {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "type": "success",
                    "value": `Find ${candidates.length} candidate transformations for concept "${conceptName}".`
                }));
            } else {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "type": "info",
                    "value": `Find ${candidates.length} candidate transformations for concept "${conceptName}", please try again.`
                }));
            }

            return candidates;
        } else {
            // TODO: add warnings to show the user
            dispatch(dfActions.addMessages({
                "timestamp": Date.now(),
                "type": "error",
                "value": "unable to generate the desired transformation, please try again."
            }));
            return [];
        }
    }
    
    let inputDataCandidates = tables.filter(t => parentConcepts.every(c => t.names.includes(c.name)));
    let inputData = inputDataCandidates.length > 0 ? inputDataCandidates[0] : tables[0];

    return (
        <Dialog
            sx={{ '& .MuiDialog-paper': { maxWidth: '80%', maxHeight: 860, minWidth: 600 } }}
            maxWidth={false}
            open={open}
        >
            <DialogTitle sx={{maxWidth: 800}}>Transformations from <Typography component="span" variant="h6" color="secondary">{parentConcepts.map(c => c.name).join(", ")}</Typography> to <Typography component="span" variant="h6" color="primary">{conceptName}</Typography></DialogTitle>
            <DialogContent sx={{overflowX: "hidden"}} dividers>
                <CodexDialogBox 
                    inputData={inputData}
                    inputFieldsInfo={inputFieldsInfo}
                    initialDescription={transformDesc}
                    outputName={conceptName}
                    handleProcessResults={handleProcessResults}
                    callWhenSubmit={(desc: string) => {
                        setDescription(desc);
                        setCodeGenInProgress(true);
                    }}
                    size={"large"}
                />
                <Box sx={{display: "flex", overflowX: "auto", flexDirection: "row", justifyContent: "space-between", position: "relative", marginTop: "10px", minHeight: "50px"}}>
                    {codeGenInProgress ? 
                        <Box sx={{position: "absolute", height: "100%", width: "100%", zIndex: 10,
                                  backgroundColor: "rgba(243, 243, 243, 0.8)", display: "flex", alignItems: "center"}}>
                            <LinearProgress sx={{width: "100%", height: "100%", opacity: 0.05}}/>
                        </Box> : ""}
                    {codeList.map((code, idx) => {

                        let startIdx = displayPage * displayPageSize;
                        let endIdx = displayPage * displayPageSize + displayPageSize;
                        if (endIdx > codeOutputs[idx].length) {
                            endIdx = codeOutputs[idx].length;
                            startIdx = Math.max(codeOutputs[idx].length - displayPageSize, 0);
                        }

                        let handlePageInc = codeOutputs[idx].length < displayPageSize || endIdx == codeOutputs[idx].length ? undefined : 
                                                (() => {setDisplayPage((displayPage + 1) * displayPageSize >= codeOutputs[idx].length ? 0 : displayPage + 1)});
                        let handlePageDesc = codeOutputs[idx].length < displayPageSize || startIdx == 0 ? undefined : 
                                                (() => {setDisplayPage(displayPage == 0 ? 0 : displayPage - 1)});

                        let codeOutputSamples = codeOutputs[idx].slice(startIdx, endIdx);
                        let highlightedRows = codeOutputSamples.map((pair, k) => pair[1] != codeOutputs[selectionIdx].slice(startIdx, endIdx)[k][1])

                        let colNames : [string[], string] = [parentConcepts.map(f => f.name), conceptName];

                        let formattedCode = code;
                        try {
                            formattedCode = prettier.format(code, {
                                parser: "babel",
                                plugins: [parserBabel],
                                printWidth: 60
                            })
                        } catch {

                        }

                        

                        
                        

                        return <Card key={`candidate-dialog-${idx}`} onClick={()=>{setSelectionIdx(idx)}} 
                              sx={{minWidth: "280px", maxWidth: "600px", display: "flex",  flexGrow: 1, margin: "10px", 
                                   border: selectionIdx == idx ? "2px solid rgb(2 136 209 / 0.7)": "2px solid rgba(255, 255, 255, 0)"}}>
                            <CardContent sx={{display: "flex", flexDirection: "column", flexGrow: 1, overflow: "clip", maxHeight: 800}}>
                                <FormControlLabel 
                                    sx={{marginLeft: 0, fontSize: 12, 
                                        "& svg": { width: "0.5em",  height: "0.5em" },
                                        '& .MuiTypography-root': { fontSize: "inherit"}, 
                                        '& .MuiFormLabel-root': { fontSize: "inherit" } }}
                                    value={idx} control={<Radio checked={selectionIdx == idx} />} label={`candidate-${idx+1}`} />
                                <Box width="100%" sx={{}}>
                                    <GroupHeader>
                                        <Typography style={{ fontSize: "12px" }}>transformation result on sample data</Typography>
                                    </GroupHeader>
                                    <GroupItems sx={{padding: "0px 10px", margin: 0}}>
                                        {/* <ExampleMappingTable ioPairList={codeOutputSamples} colNames={colNames} handlePageInc={handlePageInc} handlePageDesc={handlePageDesc}
                                            highlight={highlightedRows} numDisplayed={displayPageSize} /> */}
                                        <Box sx={{maxHeight: 300, minWidth: '200px', width: "100%", overflow: "auto", flexGrow: 1,fontSize: 10 }}>
                                            {simpleTableView(codeOutputs[idx], colNames, conceptShelfItems)}
                                        </Box>
                                    </GroupItems>
                                </Box>
                                <GroupHeader sx={{marginTop: 1}}>
                                    <Typography style={{ fontSize: "12px" }}>transformation code</Typography>
                                </GroupHeader>
                                <Box sx={{maxHeight: 280, width: "100%", overflow: "auto", flexGrow: 1 }}>
                                    <CodeBox code={formattedCode} language="typescript"/>
                                    {/* <Editor
                                        value={formattedCode}
                                        onValueChange={(code: string) => {
                                            //setCodeList(codeList.map((c, i) => i == idx ? code : c));
                                        }}
                                        highlight={code => {
                                            try {
                                                return Prism.highlight(code, Prism.languages.javascript, 'javascript')
                                            } catch {
                                                return code;
                                            }
                                        }}
                                        padding={10}
                                        disabled={true}
                                        style={{
                                            fontFamily: '"Fira code", "Fira Mono", monospace',
                                            fontSize: 10,
                                            overflow: "auto",
                                            height: "100%"
                                        }}
                                    /> */}
                                </Box>
                            </CardContent>
                        </Card>
                    })}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={() => { handleUpdate(codeList[selectionIdx], description, true)} }>Ok</Button>
            </DialogActions>
        </Dialog>
    );
}

export let simpleTableView = (exampleOutputs: [any[], any][], 
    exampleColNames: [any[], any], 
    conceptShelfItems: FieldItem[],
    rowsPergPage: number = 10) => {
    
    let exampleTableRows = exampleOutputs.map(sample => {
    let row : any = {};
    let i = 0;

    for (let srcFieldName of exampleColNames[0]) {
        row[srcFieldName] = sample[0][i];
        i += 1
    }
    row[exampleColNames[1]] = sample[1];
        return row;
    })

    let exampleTable = createDictTable("temp-1", exampleTableRows)

    let colDefs = exampleTable.names.map(name => {
        return {
            id: name, label: name, minWidth: 30, align: undefined, 
            format: (value: any) => `${value}`, source: exampleColNames[1] == name ? 'derived' : conceptShelfItems.find(f => f.name == name)?.source
        }
    })

    return <Box sx={{ position: "relative", display: "flex", flexDirection: "column" }}>
        <CustomReactTable rows={exampleTableRows} columnDefs={colDefs} rowsPerPageNum={rowsPergPage} compact />
    </Box>
}