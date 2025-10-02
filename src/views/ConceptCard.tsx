// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState } from 'react'
import { useDrag } from 'react-dnd'
import { useSelector, useDispatch } from 'react-redux'

import '../scss/ConceptShelf.scss';

import 'prismjs/components/prism-python' // Language
import 'prismjs/themes/prism.css'; //Example style, you can use another
import { useTheme } from '@mui/material/styles';

import {
    Chip,
    Card,
    Box,
    CardContent,
    Typography,
    IconButton,
    Button,
    TextField,
    FormControl,
    InputLabel,
    SelectChangeEvent,
    MenuItem,
    Checkbox,
    Menu,
    ButtonGroup,
    Tooltip,
    styled,
    LinearProgress,
    Dialog,
    FormControlLabel,
    DialogActions,
    DialogTitle,
    DialogContent,
    Divider,
    Select,
    SxProps,
} from '@mui/material';

import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import ForkRightIcon from '@mui/icons-material/ForkRight';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import HideSourceIcon from '@mui/icons-material/HideSource';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import AnimateHeight from 'react-animate-height';

import { FieldItem, ConceptTransformation, duplicateField, FieldSource } from '../components/ComponentType';

import {  testType, Type, TypeList } from "../data/types";
import React from 'react';
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';

import { getUrls } from '../app/utils';
import { getIconFromType } from './ViewUtils';


import _ from 'lodash';
import { DictTable } from '../components/ComponentType';
import { CodeBox } from './VisualizationView';
import { CustomReactTable } from './ReactTable';
import { alpha } from '@mui/material/styles';

export interface ConceptCardProps {
    field: FieldItem,
    sx?: SxProps
}

const checkConceptIsEmpty = (field: FieldItem) => {
    return field.name == "" &&
        ((field.source == "derived" && !field.transform?.description && (field.transform as ConceptTransformation).code == "")
            || (field.source == "custom"))
}

export const genFreshDerivedConcept = (parentIDs: string[], tableRef: string) => {
    return {
        id: `concept-${Date.now()}`, name: "", type: "string" as Type,
        source: "derived", tableRef: tableRef,
        transform: { parentIDs: parentIDs, code: "", description: ""}
    } as FieldItem
}

let ConceptReApplyButton: FC<{field: FieldItem, 
    focusedTable: DictTable, handleLoading: (loading: boolean) => void}> = function ConceptReApplyButton({ field, focusedTable, handleLoading }) {
    
    let dispatch = useDispatch();

    let [codePreview, setCodePreview] = useState<string>(field.transform?.code || "");
    let [tableRowsPreview, setTableRowsPreview] = useState<any[]>([]);
    let [applicationDialogOpen, setApplicationDialogOpen] = useState<boolean>(false);

    let conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    let activeModel = useSelector(dfSelectors.getActiveModel);

    let inputFields = field.transform?.parentIDs.map(pid => {
        let parentConcept = conceptShelfItems.find(f => f.id == pid) as FieldItem;
        return {
            name: parentConcept.name,
        }
    })

    let handleGeneratePreview = () => {
        handleLoading(true);

        let requestTimeStamp = Date.now();

        let message = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: JSON.stringify({  
                token: requestTimeStamp,
                description: field.transform?.description || "",
                input_fields: inputFields,
                input_data: {name: focusedTable.id, rows: focusedTable.rows},
                output_name: field.name,
                model: activeModel
            }),
        };

        // timeout the request after 20 seconds
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 20000)

        fetch(getUrls().DERIVE_PY_CONCEPT, {...message, signal: controller.signal })
            .then((response) => response.json())
            .then((data) => {
                let candidates = data["results"].filter((r: any) => r["status"] == "ok");

                if (candidates.length > 0) {
                    setTableRowsPreview(candidates[0]["content"]['rows']);
                    setCodePreview(candidates[0]["code"]);
                    setApplicationDialogOpen(true);
                }
                handleLoading(false);    
            }).catch((error) => {
                handleLoading(false);
            });
    }

    let handleApply = () => {
        dispatch(dfActions.extendTableWithNewFields({
            tableId: focusedTable.id,
            values: tableRowsPreview.map(r => r[field.name]),
            columnName: field.name,
            previousName: undefined,
            parentIDs: field.transform?.parentIDs || []
        }));
    }

    let colNames: string[] = tableRowsPreview.length > 0 ? Object.keys(tableRowsPreview[0]) : [];
    let colDefs = colNames.map(n => ({
        id: n,
        label: n,
        dataType: "string" as Type,
        source: field.name == n ? "derived" as FieldSource : "original" as FieldSource 
    }));

    return (
        <>
            <Tooltip key="reapply-icon-button" title={`apply to ${focusedTable.displayId}`}>
                <IconButton size="small" key="reapply-icon-button" color="primary" aria-label="reapply" component="span" onClick={() => { handleGeneratePreview() }}>
                    <PrecisionManufacturingIcon fontSize="inherit" />
                </IconButton>
            </Tooltip>
            <Dialog open={applicationDialogOpen} onClose={() => { setApplicationDialogOpen(false) }}>
                <DialogTitle>Preview: apply concept <Typography color="primary" component="span" sx={{ fontSize: "inherit" }}>{field.name}</Typography> to <Typography color="primary" component="span" sx={{ fontSize: "inherit"}}>{focusedTable.displayId}</Typography>
                </DialogTitle>
                <DialogContent>
                    <Typography sx={{ fontSize: 12, marginBottom: 1 }}>transformation code</Typography>
                    <CodeBox code={codePreview.trim()} language="python" />
                    <Typography sx={{ fontSize: 12, marginBottom: 1 }}>preview of the applied concept</Typography>
                    <CustomReactTable rows={tableRowsPreview} columnDefs={colDefs} rowsPerPageNum={15} compact={true} maxCellWidth={100} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => { setApplicationDialogOpen(false), setTableRowsPreview([]), setCodePreview("") }}>Cancel</Button>
                    <Button onClick={() => { 
                        setApplicationDialogOpen(false), 
                        setTableRowsPreview([]),
                        setCodePreview(""),
                        handleApply()
                    }}>Apply</Button>
                </DialogActions>
            </Dialog>
        </>
    )
}
export const ConceptCard: FC<ConceptCardProps> = function ConceptCard({ field, sx }) {
    // concept cards are draggable cards that can be dropped into encoding shelf
    let theme = useTheme();

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    let focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);
    
    let focusedTable = tables.find(t => t.id == focusedTableId);

    const [editMode, setEditMode] = useState(field.name == "" ? true : false);

    const dispatch = useDispatch();
    let handleDeleteConcept = (conceptID: string) => dispatch(dfActions.deleteConceptItemByID(conceptID));
    let handleUpdateConcept = (concept: FieldItem) => dispatch(dfActions.updateConceptItems(concept));

    const [{ isDragging }, drag] = useDrag(() => ({
        type: "concept-card",
        item: { type: 'concept-card', fieldID: field.id, source: "conceptShelf" },
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
            handlerId: monitor.getHandlerId(),
        }),
    }));

    let [isLoading, setIsLoading] = useState(false);
    let handleLoading = (loading: boolean) => {
        setIsLoading(loading);
    }
    
    let opacity = isDragging ? 0.3 : 1;
    let fontStyle = "inherit";
    let border = "hidden";

    const cursorStyle = isDragging ? "grabbing" : "grab";
    let editOption = field.source == "derived" && (
        <Tooltip key="edit-icon-button" title="edit">
            <IconButton size="small" key="edit-icon-button"
                color="primary" aria-label="Edit" component="span"
                onClick={() => { 
                    setEditMode(!editMode) 
                    dispatch(dfActions.setFocusedTable(field.tableRef));
                }}>
                <EditIcon fontSize="inherit" />
            </IconButton>
        </Tooltip>);

    let deriveOption = (field.source == "derived" || field.source == "original") && (
        <Tooltip key="derive-icon-button" title="derive new concept">
            <IconButton size="small"
                key="derive-icon-button"
                disabled={tables.find(t => t.id == field.tableRef)?.virtual != undefined}
                color="primary" aria-label="derive new concept" component="span" onClick={() => {
                    if (conceptShelfItems.filter(f => f.source == "derived" && f.name == ""
                        && f.transform?.parentIDs.includes(field.id)).length > 0) {
                        return
                    }
                    handleUpdateConcept(genFreshDerivedConcept([field.id], field.tableRef));
                }} >
                <ForkRightIcon fontSize="inherit" sx={{ transform: "rotate(90deg)" }} />
            </IconButton>
        </Tooltip>
    );

    let deleteOption = !(field.source == "original") && <IconButton size="small"
            key="delete-icon-button"
            color="primary" aria-label="Delete" component="span"
            disabled={
                conceptShelfItems.filter(f => f.source == "derived" && f.transform?.parentIDs.includes(field.id)).length > 0
 
            }
            onClick={() => { handleDeleteConcept(field.id); }}>
            <DeleteIcon fontSize="inherit" />
        </IconButton>;

    let reApplyOption = focusedTable && field.source == "derived" 
        && focusedTable.id != field.tableRef 
        && !focusedTable.names.includes(field.name)
        && field.transform?.parentIDs.every(pid => focusedTable.names.includes((conceptShelfItems.find(f => f.id == pid) as FieldItem).name)) 
        && (
            <Tooltip key="reapply-icon-button" title={`apply to ${focusedTable.displayId}`}>
                <ConceptReApplyButton field={field} focusedTable={focusedTable} handleLoading={handleLoading} />
            </Tooltip>
        );

    let cleanupOption = focusedTable && field.source == "derived" && focusedTableId != field.tableRef 
        && field.transform?.parentIDs.every(pid => focusedTable.names.includes((conceptShelfItems.find(f => f.id == pid) as FieldItem).name)) && focusedTable.names.includes(field.name) && (
        <Tooltip key="cleanup-icon-button" title={
                <Typography component="span" sx={{ fontSize: "inherit" }}>remove <b>{field.name}</b> from <b>{focusedTable.displayId}</b></Typography>}>
            <IconButton size="small" key="cleanup-icon-button" color="primary" aria-label="cleanup" component="span" onClick={() => {
                dispatch(dfActions.removeDerivedField({
                    tableId: focusedTableId as string,
                    fieldId: field.id
                }));
            }}>
                <HideSourceIcon fontSize="inherit" />
            </IconButton>
        </Tooltip>
    );

    let specialOptions = [
        reApplyOption,
        cleanupOption,
    ]

    let cardHeaderOptions = [
        deleteOption,
        deriveOption,
        editOption,
    ]

    const editModeCard = field.source == "derived" && (
        <CardContent className="draggable-card-body-edit-mode">
            <DerivedConceptFormV2 concept={field} handleUpdateConcept={handleUpdateConcept}
                handleDeleteConcept={handleDeleteConcept}
                turnOffEditMode={() => { setEditMode(false); }} />
        </CardContent>
    );

    const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);
    const handleDTypeClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
    };
    const handleDTypeClose = () => {
        setAnchorEl(null);
    };

    let typeIcon = (
        <IconButton size="small" sx={{ fontSize: "inherit", padding: "2px" }}
            color="primary" component="span"
            aria-controls={open ? 'basic-menu' : undefined}
            aria-haspopup="true"
            aria-expanded={open ? 'true' : undefined}
        >
            {getIconFromType(focusedTable?.metadata[field.name]?.type || Type.Auto)}
        </IconButton>
    )

    let fieldNameEntry = field.name != "" ? <Typography sx={{
        fontSize: "inherit", marginLeft: "3px", whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis", flexShrink: 1
    }}>{field.name}</Typography>
        : <Typography sx={{ fontSize: 12, marginLeft: "3px", color: "gray", fontStyle: "italic" }}>new concept</Typography>;

    let backgroundColor = theme.palette.primary.main;
    if (field.source == "original") {
        backgroundColor = theme.palette.primary.light;
    } else if (field.source == "custom") {
        backgroundColor = theme.palette.custom.main;
    } else if (field.source == "derived") {
        backgroundColor = theme.palette.derived.main;
    }

    let draggleCardHeaderBgOverlay = 'rgba(255, 255, 255, 0.9)';

    // Add subtle tint for non-focused fields
    if (focusedTable && !focusedTable.names.includes(field.name)) {
        draggleCardHeaderBgOverlay = 'rgba(255, 255, 255, 1)';
    }

    let boxShadow = editMode ? "0 2px 4px 0 rgb(0 0 0 / 20%), 0 2px 4px 0 rgb(0 0 0 / 19%)" : "";

    let cardComponent = (
        <Card sx={{ minWidth: 60, backgroundColor, position: "relative", ...sx }}
            variant="outlined"
            style={{ opacity, border, boxShadow, fontStyle, marginLeft: '3px' }}
            color="secondary"
            className={`data-field-list-item draggable-card`}>
            {isLoading ? <Box sx={{ position: "absolute", zIndex: 20, height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.2 }} />
            </Box> : ""}
            <Box ref={field.name ? drag : undefined} sx={{ cursor: cursorStyle, background: draggleCardHeaderBgOverlay }}
                 className={`draggable-card-header draggable-card-inner ${field.source}`}>
                <Typography className="draggable-card-title" color="text.primary"
                    sx={{ fontSize: 12, height: 24, width: "100%"}} component={'span'} gutterBottom>
                    {typeIcon}
                    {fieldNameEntry}
                    {focusedTable?.metadata[field.name]?.semanticType ? 
                        <Typography sx={{fontSize: "xx-small", color: "text.secondary", marginLeft: "6px", fontStyle: 'italic', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>
                            <ArrowRightIcon sx={{fontSize: "12px"}} /> {focusedTable?.metadata[field.name].semanticType}</Typography> : ""}
                </Typography>
                
                <Box sx={{ position: "absolute", right: 0, display: "flex", flexDirection: "row", alignItems: "center" }}>
                    <Box className='draggable-card-action-button' sx={{ background: 'rgba(255, 255, 255, 0.95)'}}>{cardHeaderOptions}</Box>
                    {reApplyOption || cleanupOption ? <Divider flexItem orientation="vertical" sx={{ my: 1, padding: 0 }} /> : ""}
                    <Box>{specialOptions}</Box>
                </Box>
            </Box>
            <AnimateHeight
                id="example-panel"
                duration={200}
                height={editMode ? "auto" : 0} // see props documentation below
            >
                {editModeCard}
            </AnimateHeight>
        </Card>
    )

    return cardComponent;
}

export interface ConceptFormProps {
    concept: FieldItem,
    handleUpdateConcept: (conept: FieldItem) => void,
    handleDeleteConcept: (conceptID: string) => void,
    turnOffEditMode?: () => void,
}

export const DerivedConceptFormV2: FC<ConceptFormProps> = function DerivedConceptFormV2({ concept, handleUpdateConcept, handleDeleteConcept, turnOffEditMode }) {

    let theme = useTheme();
    // use tables for infer domains
    let tables = useSelector((state: DataFormulatorState) => state.tables);

    let conceptTransform = concept.transform as ConceptTransformation;

    let formattedCode = conceptTransform.code;

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    const [name, setName] = useState(concept.name);
    const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => { setName(event.target.value); };

    // states related to transformation functions, they are only valid when the type is "derived"
    const [transformCode, setTransformCode] = useState<string>(formattedCode);
    const [transformDesc, setTransformDesc] = useState<string>(conceptTransform.description || "");
    const [transformParentIDs, setTransformParentIDs] = useState<string[]>(conceptTransform.parentIDs || []);

    const [derivedFieldRef, setDerivedFieldRef] = useState<string | undefined>(undefined);
    const [tempExtTable, setTempExtTable] = useState<{tableRef: string, rows: any[]} | undefined>(undefined);

    const [codeDialogOpen, setCodeDialogOpen] = useState<boolean>(false);


    let dispatch = useDispatch();

    const [codeGenInProgress, setCodeGenInProgress] = useState<boolean>(false);

    let nameField = (
        <TextField key="name-field" id="name" fullWidth label="concept name" value={name} sx={{ minWidth: 120, flex: 1, paddingBottom: 1 }}
            slotProps={{
                formHelperText: {
                    style: { fontSize: 8, marginTop: 0, marginLeft: "auto" }
                }
            }}
            multiline
            helperText={conceptShelfItems.some(f => f.name == name && f.id != concept.id) ? "this name already exists" : ""}
            size="small" onChange={handleNameChange} required error={name == "" || conceptShelfItems.some(f => f.name == name && f.id != concept.id)}
        />)

    let cardTopComponents = undefined;
    let cardBottomComponents = undefined;

    let childrenConceptIDs = [concept.id];
    while (true) {
        let newChildrens = conceptShelfItems.filter(f => f.source == "derived"
            && !childrenConceptIDs.includes(f.id)
            && f.transform?.parentIDs.some(pid => childrenConceptIDs.includes(pid)))
            .map(f => f.id);
        if (newChildrens.length == 0) {
            break
        }
        childrenConceptIDs = [...childrenConceptIDs, ...newChildrens];
    }

    // this might be a hack, but it works
    // the first parent is the concept that the user initially clicks to create the derived concept, thus its tableRef is the affiliated table
    // since this locks out other tables to be used as parents, the affiliated table is an invariant for tables created here
    let affiliatedTableId = conceptShelfItems.find(f => f.id == conceptTransform.parentIDs[0])?.tableRef;

    cardTopComponents = [
        nameField,
        <FormControl fullWidth key="derived-card-control" sx={{ minWidth: 120 }} size="small">
            <InputLabel shrink>derive from fields:</InputLabel>
            <Select
                labelId="parent-id-select-label"
                id="parent-id-select"
                multiple
                value={transformParentIDs}
                label="derive from fields:"
                inputProps={{}}
                sx={{"& .MuiSelect-select": {paddingLeft: 1}}}
                renderValue={(selected) =>
                    <Typography key={selected[0]} sx={{ whiteSpace: "normal", fontSize: "inherit" }}>
                        {selected.map(conceptID => {
                            let chipColor = conceptShelfItems.find(f => f.id == conceptID)?.source == "original" ? theme.palette.primary.light : theme.palette.custom.main;
                            return <Chip 
                                key={conceptID}
                                variant="outlined" size="small" 
                                // color={}
                                sx={{ 
                                    color: chipColor,
                                    borderColor: chipColor, 
                                    padding: '0px',  margin: '1px 2px', borderRadius: '4px', height: '100%', 
                                        '& .MuiChip-label': { overflowWrap: 'break-word', whiteSpace: 'normal', textOverflow: 'clip',
                                        fontSize: 11}}} label={conceptShelfItems.find(f => f.id == conceptID)?.name} />
                        })}
                    </Typography>
                }
                onChange={(event) => {
                    const { target: { value }, } = event;
                    if (value.length == 0) { return }
                    typeof value === "string" ? setTransformParentIDs([value]) : setTransformParentIDs(value);
                }}
            >
                {conceptShelfItems.filter((t) => t.name != "" && t.tableRef == affiliatedTableId).map((t, i) => (
                    <MenuItem value={t.id} key={`${concept.id}-${t.id}`} sx={{ fontSize: 12, marginLeft: "0px" }} disabled={childrenConceptIDs.includes(t.id)}>
                        {<Checkbox sx={{padding: 0.5}} size="small" checked={transformParentIDs.indexOf(t.id) > -1} />}
                        {t.name}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>,
    ]

    let parentConcepts = transformParentIDs.map((parentID) => conceptShelfItems.filter(c => c.id == parentID)[0]);
    let viewExamples: any = "";

    if (transformCode && tempExtTable) {

        let colNames: [string[], string] = [parentConcepts.map(f => f.name), name];
        let colDefs = [...colNames[0], colNames[1]].map(n => ({
            id: n,
            label: n,
            dataType: "string" as Type,
            source: "original" as FieldSource
        }));

        viewExamples = (<Box key="viewexample--box" width="100%" sx={{ position: "relative", }}>
            <Box className="GroupItems" sx={{ padding: "0px 0px 6px 0px", margin: 0 }}>
                <CustomReactTable rows={tempExtTable.rows.map(r => {
                    let newRow = structuredClone(r);
                    if (derivedFieldRef && derivedFieldRef != name) {
                        newRow[name] = r[derivedFieldRef];
                        delete newRow[derivedFieldRef];
                    }
                    return newRow;
                }).slice(0, 5)} columnDefs={colDefs} rowsPerPageNum={5} compact={true} maxCellWidth={100} />
            </Box>
        </Box>)
    }

    let codeArea = (
        <Box key="code-area-box" sx={{
            display: "flex", flexDirection: "column", justifyContent: "space-between",
            position: "relative", marginTop: "5px", minHeight: codeGenInProgress ? "10px" : "0px"
        }}>
            {codeGenInProgress ? <Box sx={{
                position: "absolute", height: "100%", width: "100%", zIndex: 20,
                backgroundColor: "rgba(243, 243, 243, 0.8)", display: "flex", alignItems: "center"
            }}>
                <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.05 }} />
            </Box> : ''}
            <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                {viewExamples ? <Typography style={{ fontSize: "9px", color: "gray" }}>result on sample data </Typography> : ""}
                {viewExamples}
                {transformCode ? <Typography style={{ fontSize: "9px", color: "gray" }}>transformation code</Typography> : ""}
                {transformCode ? <CodeBox code={transformCode.trim()} language="python" fontSize={9}/> : ""}
            </Box>
        </Box>
    )

    let handleProcessResults = (status: string, results: {code: string, content: any}[]) : void => {
        setCodeGenInProgress(false);
        if (status == "ok") {

            console.log(`[fyi] just received results`);
            console.log(results);

            if (results.length > 0) {
                let candidate = results[0];
                setTransformCode(candidate.code);
                setTempExtTable({
                    tableRef: parentConcepts[0].tableRef,
                    rows: candidate.content.rows, 
                });

                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "type": "success",
                    "component": "Field Card",
                    "value": `Find ${results.length} candidate transformations for concept "${name}".`
                }));
            } else {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "type": "info",
                    "component": "Field Card",
                    "value": `Find ${results.length} candidate transformations for concept "${name}", please try again.`
                }));
            }
        } else {
            // TODO: add warnings to show the user
            setTransformCode("");
            dispatch(dfActions.addMessages({
                "timestamp": Date.now(),
                "type": "error",
                "component": "Field Card",
                "value": "unable to generate the desired transformation, please try again."
            }));
        }
    }

    let inputFields = parentConcepts.map(c => {
        return {
            name: c.name,
        }
    })

    // pick the dataset with the right parents  
    let inputTable = tables.find(t => parentConcepts[0].tableRef == t.id) || tables[0];

    let inputExtTable = {
        name: inputTable.id,
        rows: inputTable.rows
    };

    let codeDialogBox = <PyCodexDialogBox 
        key="code-dialog-box"
        inputData={inputExtTable}
        inputFields={inputFields}
        initialDescription={transformDesc}
        outputName={name}
        handleProcessResults={handleProcessResults}
        callWhenSubmit={(desc: string) => {
            setTransformDesc(desc);
            setDerivedFieldRef(name);
            setCodeGenInProgress(true);
        }}
        size={'small'}
    />

    cardBottomComponents = [
        codeDialogBox,
        <Box key="codearea-container" width="100%">
            {codeArea}
        </Box>
    ]

    const checkDerivedConceptDiff = () => {
        let nameTypeNeq = (concept.name != name);
        return (nameTypeNeq
            || formattedCode != transformCode
            || conceptTransform.description != transformDesc
            || conceptTransform.parentIDs.toString() != transformParentIDs.toString());
    }

    let saveDisabledMsg = [];
    if (name == "" || conceptShelfItems.some(f => f.name == name && f.id != concept.id)) {
        saveDisabledMsg.push("concept name is empty")
    }
    if (concept.source == "derived") {
        if (transformCode == "") {
            saveDisabledMsg.push("transformation is not specified")
        }
    }

    return (
        <Box sx={{ display: "flex", flexDirection: "column" }} >
            <Box component="form" className="concept-form"
                sx={{ display: "flex", flexWrap: "wrap", '& > :not(style)': { margin: "4px", /*width: '25ch'*/ }, }}
                noValidate
                autoComplete="off">
                {cardTopComponents}
                {cardBottomComponents}
                <ButtonGroup size="small" sx={{ "& button": { textTransform: "none", padding: "2px 4px", marginLeft: "4px" }, flexGrow: 1, justifyContent: "right" }}>
                    <IconButton onClick={() => { setCodeDialogOpen(true); }}>
                        <ZoomInIcon fontSize="inherit" />
                    </IconButton>
                    <Dialog open={codeDialogOpen} onClose={() => { setCodeDialogOpen(false); }}>
                        <DialogTitle sx={{maxWidth: 800}}>
                            Transformations from <Typography component="span" variant="h6" color="secondary">{parentConcepts.map(c => c.name).join(", ")}
                            </Typography> to <Typography component="span" variant="h6" color="primary">{name}</Typography></DialogTitle>
                        <DialogContent>
                            {codeDialogBox}
                            <Card sx={{position: "relative", minWidth: "280px", maxWidth: "600px", display: "flex",  flexGrow: 1, margin: "10px",
                                border: "2px solid rgb(2 136 209 / 0.7)"}}>
                                {codeGenInProgress ? <Box sx={{
                                    position: "absolute", height: "100%", width: "100%", zIndex: 20,
                                    backgroundColor: "rgba(243, 243, 243, 0.8)", display: "flex", alignItems: "center"
                                }}>
                                    <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.05 }} />
                                </Box> : ''}
                                <CardContent sx={{display: "flex", flexDirection: "column", flexGrow: 1, overflow: "clip", maxHeight: 800}}>
                                    <Box width="100%" sx={{}}>
                                        <Box className="GroupHeader">
                                            <Typography style={{ fontSize: "12px" }}>transformation result on sample data </Typography>
                                        </Box>
                                        <Box className="GroupItems" sx={{padding: "0px 10px", margin: 0}}>
                                            <Box sx={{maxHeight: 300, minWidth: '200px', width: "100%", overflow: "auto", flexGrow: 1,fontSize: 10 }}>
                                                {viewExamples}
                                            </Box>
                                        </Box>
                                    </Box>
                                    <Box className="GroupHeader" sx={{marginTop: 1}}>
                                        <Typography style={{ fontSize: "12px" }}>transformation code</Typography>
                                    </Box>
                                    <Box sx={{maxHeight: 280, width: "100%", overflow: "auto", flexGrow: 1 }}>
                                        <CodeBox code={transformCode.trim()} language="python" fontSize={9}/>
                                    </Box>
                                </CardContent>
                            </Card>
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => { setCodeDialogOpen(false); }}>Ok</Button>
                        </DialogActions>
                    </Dialog>
                    <IconButton size="small"
                        color="primary" aria-label="Delete" component="span"
                        disabled={conceptShelfItems.filter(f => f.source == "derived" && f.transform?.parentIDs.includes(concept.id)).length > 0}
                        onClick={() => { handleDeleteConcept(concept.id); }}>
                        <Tooltip title="delete">
                            <DeleteIcon fontSize="inherit" />
                        </Tooltip>
                    </IconButton>
                    <Button size="small" variant="outlined" onClick={() => {
                        setName(concept.name);

                        if (checkConceptIsEmpty(concept)) {
                            handleDeleteConcept(concept.id);
                        }
                        if (turnOffEditMode) {
                            turnOffEditMode();
                        }
                    }}>
                        Cancel
                    </Button>
                    <Button size="small" variant={checkDerivedConceptDiff() ? "contained" : "outlined"} 
                            disabled={saveDisabledMsg.length > 0 || checkDerivedConceptDiff() == false} onClick={() => {
                        
                        let tmpConcept = duplicateField(concept);
                        tmpConcept.name = name;
                        tmpConcept.transform = concept.transform ? 
                            { parentIDs: transformParentIDs, 
                              code: transformCode, 
                              description: transformDesc } as ConceptTransformation : undefined;

                        if (tempExtTable) {
                            dispatch(dfActions.extendTableWithNewFields({
                                tableId: tempExtTable.tableRef,
                                values: tempExtTable.rows.map(r => r[derivedFieldRef || name]),
                                columnName: name,
                                previousName: concept.name,
                                parentIDs: transformParentIDs
                            }));
                        }

                        if (turnOffEditMode) {
                            turnOffEditMode();
                        }
                        handleUpdateConcept(tmpConcept);

                        //setName(""); setDtype("string" as Type); setExamples([]);
                    }}>
                        Save
                    </Button>
                </ButtonGroup>
            </Box>
        </Box>
    );
}


export interface CodexDialogBoxProps {
    inputData: {name: string, rows: any[]},
    outputName: string,
    inputFields: {name: string}[],
    initialDescription: string,
    callWhenSubmit: (desc: string) => void,
    handleProcessResults: (status: string, results: {code: string, content: any[]}[]) => void, // return processed cnadidates for the ease of logging
    size: "large" | "small",
}


export const PyCodexDialogBox: FC<CodexDialogBoxProps> = function ({ 
    initialDescription, inputFields, inputData, outputName, callWhenSubmit, handleProcessResults, size="small" }) {

    let activeModel = useSelector(dfSelectors.getActiveModel);

    let [description, setDescription] = useState(initialDescription);
    let [requestTimeStamp, setRequestTimeStamp] = useState<number>(0);

    let defaultInstruction = `Derive ${outputName} from ${inputFields.map(f => f.name).join(", ")}`;

    let formulateButton = <Tooltip title="Derived the new concept">
        <IconButton size={size}
            disabled={description == ""}
            sx={{ borderRadius: "10%", alignItems: "flex-end", position: 'relative' }}
            color="primary" aria-label="Edit" component="span" onClick={() => {

                setRequestTimeStamp(Date.now());
                //setTransformCode("");

                console.log(`[fyi] just sent request "${description}" at ${requestTimeStamp}`);

                let message = {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', },
                    body: JSON.stringify({
                        token: requestTimeStamp,
                        description: description,
                        input_fields: inputFields,
                        input_data: inputData,
                        output_name: outputName,
                        model: activeModel
                    }),
                };

                callWhenSubmit(description);

                // timeout the request after 20 seconds
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), 20000)

                fetch(getUrls().DERIVE_PY_CONCEPT, {...message, signal: controller.signal })
                    .then((response) => response.json())
                    .then((data) => {
                        let candidates = data["results"].filter((r: any) => r["status"] == "ok");
                        handleProcessResults(data["status"], candidates);
                    }).catch((error) => {
                        handleProcessResults("error", []);
                    });
            }}>
            <PrecisionManufacturingIcon />
        </IconButton>
    </Tooltip>

    let textBox = <Box key="interaction-comp" width='100%' sx={{ display: 'flex', flexDirection: "column" }}>
        <Typography style={{ fontSize: "9px", color: "gray" }}>transformation prompt</Typography>
        <TextField 
            size="small"
            sx={{fontSize: 12}}
            color="primary"
            fullWidth
            disabled={outputName == ""}
            slotProps={{
                input: { endAdornment: formulateButton, },
                inputLabel: { shrink: true }
            }}
            multiline
            onKeyDown={(event: any) => {
                if (event.key === "Enter" || event.key === "Tab") {
                    // write your functionality here
                    let target = event.target as HTMLInputElement;
                    if (target.value == "" && target.placeholder != "") {
                        target.value = target.placeholder;
                        setDescription(defaultInstruction);
                        event.preventDefault();
                    }
                }
            }}
            value={description}
            placeholder={defaultInstruction} onChange={(event: any) => { setDescription(event.target.value) }}
            variant="standard"  
        />
    </Box>

    return textBox;
}
