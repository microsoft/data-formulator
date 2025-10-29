// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC } from 'react'
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
        ButtonGroup,
} from '@mui/material';

import React from 'react';

import { assembleVegaChart } from '../app/utils';
import { Chart } from '../components/ComponentType';
import { useSelector } from 'react-redux';
import { DataFormulatorState } from '../app/dfSlice';

import { createDictTable, DictTable } from '../components/ComponentType';
import { CodeBox } from './VisualizationView';
import embed from 'vega-embed';
import { CustomReactTable } from './ReactTable';

import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';

export interface DerivedDataDialogProps {
    chart: Chart,
    candidateTables: DictTable[],
    open: boolean,
    handleCloseDialog: () => void,
    handleSelection: (selectIndex: number) => void,
    handleDeleteChart: () => void,
    bodyOnly?: boolean,
}

export const DerivedDataDialog: FC<DerivedDataDialogProps> = function DerivedDataDialog({ 
        chart, candidateTables, open, handleCloseDialog, handleSelection, handleDeleteChart, bodyOnly }) {

    let direction = candidateTables.length > 1 ? "horizontal" : "horizontal" ;

    let [selectionIdx, setSelectionIdx] = React.useState(0);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    let body = 
        <Box sx={{display: "flex", overflowX: "auto", flexDirection: direction == "horizontal" ? "column" : "row", 
                  justifyContent: "space-between", position: "relative", marginTop: "10px", minHeight: "50px"}}>
            
            {candidateTables.map((table, idx) => {
                let code = table.derive?.code || "";
                let extTable = structuredClone(table.rows);
            
                let assembledChart: any = assembleVegaChart(chart.chartType, chart.encodingMap, conceptShelfItems, extTable, table.metadata);
                assembledChart["background"] = "transparent";
                // chart["autosize"] = {
                //     "type": "fit",
                //     "contains": "padding"
                // };
                const id = `chart-dialog-element-${idx}`;
                
                const element =
                        <Box className="vega-thumbnail-no-hover"
                            id={id} key={`chart-thumbnail-${idx}`} 
                            sx={{ minWidth: '220px', margin: "auto", backgroundColor: "white", display: 'flex', justifyContent: 'center' }}
                            onClick={() => setSelectionIdx(idx)}>
                        </Box>;

                embed('#' + id, assembledChart, { actions: false, renderer: "canvas" }).then(function (result) {
                    // Access the Vega view instance (https://vega.github.io/vega/docs/api/view/) as result.view
                    if (result.view.container()?.getElementsByTagName("canvas")) {
                        let comp = result.view.container()?.getElementsByTagName("canvas")[0];

                        // Doesn't seem like width & height are actual numbers here on Edge bug
                        // let width = parseInt(comp?.style.width as string);
                        // let height = parseInt(comp?.style.height as string);
                        if (comp) {
                            const { width, height } = comp.getBoundingClientRect();
                            //console.log(`THUMB: width = ${width} height = ${height}`);
                            if (width > 240 || height > 180) {
                                let ratio = width / height;
                                let fixedWidth = width;
                                if (ratio * 180 < width) {
                                    fixedWidth = ratio * 180;
                                }
                                if (fixedWidth > 240) {
                                    fixedWidth = 240;
                                }
                                comp?.setAttribute("style", `max-width: 240px; max-height: 180px; width: ${Math.round(fixedWidth)}px; height: ${Math.round(fixedWidth / ratio)}px; `);
                            }

                        } else {
                            console.log("THUMB: Could not get Canvas HTML5 element")
                        }
                    }
                }).catch((reason) => {
                    // console.log(reason)
                    // console.error(reason)
                });

                let simpleTableView = (t: DictTable) => {
                    let colDefs = t.names.map(name => {
                        return {
                            id: name, label: name, minWidth: 30, align: undefined, 
                            format: (value: any) => `${value}`, source: conceptShelfItems.find(f => f.name == name)?.source
                        }
                    })
                    return <Box sx={{ position: "relative", display: "flex", flexDirection: "column" }}>
                        <CustomReactTable rows={t.rows} columnDefs={colDefs} rowsPerPageNum={10} compact />
                    </Box>
                }

                return <Card variant="outlined" key={`candidate-dialog-${idx}`} onClick={()=>{setSelectionIdx(idx)}} 
                    sx={{minWidth: "280px", maxWidth: "1920px", display: "flex", flexGrow: 1, margin: "6px", 
                        border: selectionIdx == idx ? "2px solid rgb(2 136 209 / 0.7)": "1px solid rgba(33, 33, 33, 0.1)"}}>
                    <CardContent sx={{display: "flex", flexDirection: "column", flexGrow: 1, maxHeight: 800, padding: '2px 8px', paddingBottom: '2px !important'}}>
                        <FormControlLabel 
                            sx={{marginLeft: 0, fontSize: 12, position: direction == "horizontal" ? 'absolute' : 'relative',
                                "& svg": { width: "0.5em",  height: "0.5em" },
                                '& .MuiTypography-root': { fontSize: "inherit"}, 
                                '& .MuiFormLabel-root': { fontSize: "inherit" } }}
                            value={idx} control={<Radio checked={selectionIdx == idx} />} 
                            label={<Typography color={idx == selectionIdx ? 'primary' : 'inherit'} >{`candidate-${idx+1} (${candidateTables[idx].id})`}</Typography>} />
                        <Box sx={{display: 'flex', flexDirection: direction == "horizontal" ? "row" : "column", alignItems: "center", flex: 'auto'}}>
                            <Box sx={{}}>
                                {element}
                            </Box>
                            <Box sx={{margin: '12px', width: '100%'}}>
                                <Box sx={{maxHeight: 300, minWidth: '200px', width: "100%", overflow: "auto", flexGrow: 1,fontSize: 10 }}>
                                    {simpleTableView(createDictTable(table.id, extTable))}
                                </Box>
                            </Box>
                            <Box sx={{maxWidth: 400, width: 'fit-content',  display: 'flex', maxHeight: 300, overflow: 'initial'}}>
                                <CodeBox code={code} language="python" />
                            </Box>
                        </Box>
                    </CardContent>
                </Card>
            })}
            
        </Box>

    if (bodyOnly) {
        return <Box sx={{marginTop: 2}}>
            <Box sx={{width: '100%', display: 'flex', alignItems: 'center'}}>
                <Typography fontSize="small" sx={{color: 'gray'}}>Transformation from <Typography component="span" fontSize="inherit" sx={{textDecoration: 'underline'}}>{candidateTables[0].derive?.source}</Typography></Typography>
            </Box>
            {body}
            <Box sx={{width: '100%', display: 'flex', alignItems: 'center'}}>
                <Box sx={{ display: 'flex', margin: 'auto'}}>
                    <ButtonGroup size="small" sx={{margin: 'auto'}}>
                        {/* <Button sx={{textTransform: 'none'}} onClick={()=>{ handleCloseDialog() }}>Cancel</Button> */}
                        <Button sx={{textTransform: 'none', margin: 'auto',}} variant="text" startIcon={<DeleteIcon/>} color="error"
                                onClick={() => { handleDeleteChart()} }>
                            {`Delete all`}
                        </Button>
                        <Button sx={{textTransform: 'none', width: '300px', margin: 'auto',}} variant="text" startIcon={<SaveIcon />}
                                onClick={() => { handleSelection(selectionIdx)} }>
                            Save <Typography component="span" fontSize="inherit" sx={{margin: '0px 2px', padding: '0px 2px'}}>{`candidate ${selectionIdx + 1} (${candidateTables[selectionIdx].id})`}</Typography> as the result
                        </Button>
                    </ButtonGroup>
                </Box>
            </Box>
        </Box>;
    }

    return (
        <Dialog
            sx={{ '& .MuiDialog-paper': { maxWidth: '95%', maxHeight: 860, minWidth: 300 } }}
            maxWidth={false}
            open={open}
        >
            <DialogTitle><Typography>Derived Data Candidates</Typography></DialogTitle>
            <DialogContent sx={{overflowX: "hidden"}} dividers>
                {body}
            </DialogContent>
            <DialogActions>
                <Button onClick={()=>{ handleCloseDialog() }}>Cancel</Button>
                <Button onClick={() => { handleSelection(selectionIdx)} }>Ok</Button>
            </DialogActions>
        </Dialog>
    );
}