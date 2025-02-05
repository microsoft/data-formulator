
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState } from 'react'
import { useDrag } from 'react-dnd'
import { useSelector, useDispatch } from 'react-redux'

import '../scss/ConceptShelf.scss';

import Prism from 'prismjs'
import 'prismjs/components/prism-javascript' // Language
import 'prismjs/themes/prism.css'; //Example style, you can use another
import prettier from "prettier";
import parserBabel from 'prettier/parser-babel';
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
    Select,
    SelectChangeEvent,
    MenuItem,
    Checkbox,
    Menu,
    ButtonGroup,
    Tooltip,
    styled,
    LinearProgress} from '@mui/material';

import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import ForkRightIcon from '@mui/icons-material/ForkRight';
import ZoomInIcon from '@mui/icons-material/ZoomIn';

import AnimateHeight from 'react-animate-height';

import { FieldItem, ConceptTransformation, duplicateField } from '../components/ComponentType';

import {  testType, Type, TypeList } from "../data/types";
import React from 'react';
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import Editor from 'react-simple-code-editor';

import { DisambiguationDialog, simpleTableView } from './DisambiguationDialog';
import { getUrls } from '../app/utils';
import { deriveTransformExamplesV2, getDomains, getIconFromType, processCodeCandidates } from './ViewUtils';


import _ from 'lodash';
import { DictTable } from '../components/ComponentType';

export interface ConceptCardProps {
    field: FieldItem,
}

export const GroupHeader = styled('div')(({ theme }) => ({
    position: 'sticky',
    marginTop: '-8px',
    padding: '4px 4px',
    color: "rgba(0, 0, 0, 0.6)",
    fontSize: "12px",
}));

export const GroupItems = styled('ul')({
    padding: 0,
});

const checkConceptIsEmpty = (field: FieldItem) => {
    return field.name == "" &&
        ((field.source == "derived" && !field.transform?.description && (field.transform as ConceptTransformation).code == "")
            || (field.source == "custom"))
}

export const genFreshDerivedConcept = (parentIDs: string[]) => {
    return {
        id: `concept-${Date.now()}`, name: "", type: "string" as Type,
        source: "derived", domain:[],
        transform: { parentIDs: parentIDs, code: "", description: ""}
    } as FieldItem
}

export const ConceptCard: FC<ConceptCardProps> = function ConceptCard({ field }) {
    // concept cards are draggable cards that can be dropped into encoding shelf
    
    let theme = useTheme();

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    let tables = useSelector((state: DataFormulatorState) => state.tables);
    let charts = useSelector((state: DataFormulatorState) => state.charts);
    let focusedChartId = useSelector((state: DataFormulatorState) => state.focusedChartId);
    let focusedChart = charts.find(c => c.id == focusedChartId);
    let focusedChartRefTable = tables.find(t => t.id == focusedChart?.tableRef);

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

    let notInAnyTable = tables.some(t => t.names.includes(field.name));

    let notInFocusedTable : boolean;
    if (field.source == "derived") {
        let parentConceptNames = (field.transform as ConceptTransformation)
                .parentIDs.map((parentID) => conceptShelfItems.find(c => c.id == parentID) as FieldItem).map(f => f.name);
        console.log(parentConceptNames)
        notInFocusedTable = parentConceptNames.some(name => !focusedChartRefTable?.names.includes(name));
    } else {
        notInFocusedTable = !focusedChartRefTable?.names.includes(field.name);
    }
    


    let opacity = isDragging ? 0.3 :(notInFocusedTable ? 0.65 : 1);
    let fontStyle = "inherit";
    let border = "hidden";

    const cursorStyle = isDragging ? "grabbing" : "grab";
    let editOption = field.source === "original" ? undefined : (
        <Tooltip key="edit-icon-button" title="edit">
            <IconButton size="small" key="edit-icon-button"
                color="primary" aria-label="Edit" component="span"
                onClick={() => { setEditMode(!editMode) }}>
                <EditIcon fontSize="inherit" />
            </IconButton>
        </Tooltip>
    );

    let deriveOption = (
        <Tooltip key="derive-icon-button" title="derive new concept">
            <IconButton size="small"
                key="derive-icon-button"
                color="primary" aria-label="derive new concept" component="span" onClick={() => {
                    if (conceptShelfItems.filter(f => f.source == "derived" && f.name == ""
                        && f.transform?.parentIDs.includes(field.id)).length > 0) {
                        return
                    }
                    handleUpdateConcept(genFreshDerivedConcept([field.id]));
                }} >
                <ForkRightIcon fontSize="inherit" sx={{ transform: "rotate(90deg)" }} />
            </IconButton>
        </Tooltip>
    );

    let deleteOption = field.source == "original" ? "" :
        <IconButton size="small"
            key="delete-icon-button"
            color="primary" aria-label="Delete" component="span"
            disabled={conceptShelfItems.filter(f => f.source == "derived" && f.transform?.parentIDs.includes(field.id)).length > 0}
            onClick={() => { handleDeleteConcept(field.id); }}>
            <DeleteIcon fontSize="inherit" />
        </IconButton>;

    let cardHeaderOptions = [
        deleteOption,
        deriveOption,
        editOption,
        //deleteOption
    ]

    let exampleToComponent = (values: any[], exampleSize: number, label?: string) => {
        let examples = values.slice(0, values.length > exampleSize ? exampleSize : values.length);
        let incomplete = examples.length < values.length;

        return (
            values.length == 0 ? "" : (<Typography className="draggable-card-example-values" key={examples.toString()}
                sx={{ fontSize: "inherit", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                {label ? <Typography variant="body2" sx={{ fontSize: 14 }}>
                    {label}:
                </Typography> : ""}
                {examples.map((v: any) => String(v)).join(", ")} {incomplete ? "..." : ""}
            </Typography>)
        );
    }

    const editModeCard = (
        <CardContent className="draggable-card-body-edit-mode">
            {field.source == "derived" ? <DerivedConceptForm concept={field} handleUpdateConcept={handleUpdateConcept}
                handleDeleteConcept={handleDeleteConcept}
                turnOffEditMode={() => { setEditMode(false); }} /> : field.source == "custom" ? <CustomConceptForm concept={field} handleUpdateConcept={handleUpdateConcept}
                handleDeleteConcept={handleDeleteConcept}
                turnOffEditMode={() => { setEditMode(false); }} /> : ""}
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
    const handleUpdateDtype = (dtype: string) => {
        let newConcept = duplicateField(field);
        newConcept.type = dtype as Type;
        handleUpdateConcept(newConcept);
        handleDTypeClose();
    }

    let typeIconMenu = (
        <div>
            <Tooltip title={`${field.type} type`} >
                <IconButton size="small" sx={{ fontSize: "inherit", padding: "2px" }}
                    color="primary" aria-label={field.type} component="span"
                    onClick={handleDTypeClick}
                    aria-controls={open ? 'basic-menu' : undefined}
                    aria-haspopup="true"
                    aria-expanded={open ? 'true' : undefined}
                >
                    {getIconFromType(field.type)}
                </IconButton>
            </Tooltip>
            <Menu
                id="basic-menu"
                anchorEl={anchorEl}
                open={open}
                onClose={handleDTypeClose}
                MenuListProps={{
                    'aria-labelledby': 'basic-button'
                }}
            >
                {TypeList.map((t, i) => (
                    <MenuItem dense onClick={() => { handleUpdateDtype(t) }} value={t} key={i}
                        selected={t === field.type}
                    >
                        {getIconFromType(t)}<Typography component="span" sx={{ fontSize: "inherit", marginLeft: "8px" }}>{t}</Typography>
                    </MenuItem>
                ))} 
            </Menu>
        </div>
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

    let boxShadow = editMode ? "0 2px 4px 0 rgb(0 0 0 / 20%), 0 2px 4px 0 rgb(0 0 0 / 19%)" : "";

    let cardComponent = (
        <Card sx={{ minWidth: 60, backgroundColor }}
            variant="outlined"
            style={{ opacity, border, boxShadow, fontStyle, marginLeft: field.source == "derived" ? '10px' : '3px' }}
            color="secondary"
            className={`data-field-list-item draggable-card `}>
            <Box ref={field.name ? drag : undefined} sx={{ cursor: cursorStyle }}
                 className={`draggable-card-header draggable-card-inner ${field.source}`}>
                <Typography className="draggable-card-title" sx={{ fontSize: 13, height: 28, width: "100%" }} component={'span'} gutterBottom>
                    {typeIconMenu}
                    {fieldNameEntry}
                    {field.semanticType ? <Typography sx={{fontSize: "xx-small", marginLeft: "6px", fontStyle: 'italic'}}>-- {field.semanticType}</Typography> : ""}
                    {/* {field.source == "custom" ? exampleToComponent(field.domain.values, 3) : ""} */}
                </Typography>
                <Box className='draggable-card-action-button' sx={{ position: "absolute", right: 1, background: 'rgba(255, 255, 255, 0.95)' }}>{cardHeaderOptions}</Box>
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

let formatFunc = (jsCode: string) => prettier.format(jsCode, {
    parser: "babel",
    plugins: [parserBabel],
    printWidth: 40
}).trim();

export interface ConceptFormProps {
    concept: FieldItem,
    handleUpdateConcept: (conept: FieldItem) => void,
    handleDeleteConcept: (conceptID: string) => void,
    turnOffEditMode?: () => void,
}

export const CodeEditor: FC<{ code: string; handleSaveCode: (code: string) => void }> = ({ code, handleSaveCode }) => {

    const [localCode, setLocalCode] = useState(code);

    useEffect(() => {
        setLocalCode(code)
    }, [code])

    return <Box>
        <Editor
            value={localCode}
            onValueChange={(tempCode: string) => {
                setLocalCode(tempCode);
            }}
            highlight={code => Prism.highlight(code, Prism.languages.javascript, 'javascript')}
            padding={10}
            style={{
                fontFamily: '"Fira code", "Fira Mono", monospace',
                fontSize: 10,
                paddingBottom: '24px'
            }}
        />
        <ButtonGroup size="small" disabled={code == localCode} sx={{
            fontSize: 12, position: "absolute", right: "4px", bottom: "8px", backgroundColor: "rgb(242,249,253)",
            "& button": { textTransform: "none", padding: "2px 4px" }, flexGrow: 1, justifyContent: "right"
        }}>
            <Button
                variant="text"
                color="primary" sx={{
                    "&:hover": { backgroundColor: "rgba(2, 136, 209, 0.3)" }
                }}
                size="small" onClick={() => { setLocalCode(code); }}>
                undo
            </Button>
            <Button
                variant={localCode != code ? "contained" : "text"}
                color="primary" sx={{
                    "&:hover": { backgroundColor: "rgba(2, 136, 209, 0.3)" }
                }}
                size="small" onClick={() => { handleSaveCode(localCode); }}>
                save code edits
            </Button>
        </ButtonGroup>
    </Box>
}

export const CustomConceptForm: FC<ConceptFormProps> = function CustomConceptForm({ concept, handleUpdateConcept, handleDeleteConcept, turnOffEditMode }) {

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    const [name, setName] = useState(concept.name);
    const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => { setName(event.target.value); };

    const [dtype, setDtype] = useState(concept.name == "" ? "auto" : concept.type as string);
    const handleDtypeChange = (event: SelectChangeEvent) => { setDtype(event.target.value); };

    // if these two fields are changed from other places, update their values
    useEffect(() => { setDtype(concept.type) }, [concept.type]);

    let typeList = TypeList
    let nameField = (
        <TextField key="name-field" id="name" label="concept name" value={name} sx={{ minWidth: 120, maxWidth: 160, flex: 1 }}
            FormHelperTextProps={{
                style: { fontSize: 8, marginTop: 0, marginLeft: "auto" }
            }}
            multiline
            helperText={conceptShelfItems.some(f => f.name == name && f.id != concept.id) ? "this name already exists" : ""}
            size="small" onChange={handleNameChange} required error={name == "" || conceptShelfItems.some(f => f.name == name && f.id != concept.id)}
        />)

    let typeField = (
        <FormControl key="type-select" sx={{ width: 100, marginLeft: "4px" }} size="small">
            <InputLabel id="dtype-select-label">data type</InputLabel>
            <Select
                labelId="dtype-select-label"
                id="dtype-select"
                value={dtype}
                label="data type"
                onChange={handleDtypeChange}>
                {typeList.map((t, i) => (
                    <MenuItem value={t} key={`${concept.id}-${i}`}>
                        <Typography component="span" sx={{ fontSize: "inherit", marginLeft: "0px" }}>{t}</Typography>
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    )

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

    cardTopComponents = [
        nameField,
        typeField,
        // <Tooltip key="prompt-expand" title="Provide additional prompt to explain the concept">
        //     <IconButton
        //         key="prompt-expand"
        //         color="primary" sx={{
        //             margin: "auto"
        //         }}
        //         size="small" onClick={() => { setDescOptOpen(!descOptOpen); }}>
        //         <ExpandCircleDownIcon sx={{
        //             transform: descOptOpen ? "rotate(180deg)" : "rotate(0)",
        //             transitionProperty: "transform",
        //             fontSize: 16,
        //             transitionTimingFunction: "ease-in-out",
        //             transitionDuration: "0.1s"   
        //         }} />
        //     </IconButton>
        // </Tooltip>
    ]

    cardBottomComponents = [
        <Box key="codearea-container" width="100%">
            {/*descOptOpen ? <TextField fullWidth value={description} key={`input-description`} onChange={(event: any) => { setDescription(event.target.value) }}
                        multiline variant="standard" label={"Additional prompt to explain the concept (optional)"} /> : ""*/}
            {/* <Autocomplete
                id="free-solo-demo"
                freeSolo
                size="small"
                color="primary"
                value={description}
                onChange={(event: any, newValue: any | null) => { setDescription(newValue || ""); }}
                sx={{ flex: 1, "& .MuiAutocomplete-option": { fontSize: '12px' } }}
                options={[]}
                renderOption={(params, option) => <Typography {...params} style={{ fontSize: "12px" }}>{option}</Typography>}
                renderInput={(params) => {
                    return 
                }}
            /> */}
        </Box>
    ]

    const checkCustomConceptDiff = () => {
        let nameTypeNeq = (concept.name != name || concept.type != dtype);
        return (nameTypeNeq );
    }

    let saveDisabledMsg = [];
    if (name == "" || conceptShelfItems.some(f => f.name == name && f.id != concept.id)) {
        saveDisabledMsg.push("concept name is empty")
    }

    return (
        <Box sx={{ display: "flex", flexDirection: "column" }} >
            <Box component="form" className="concept-form"
                sx={{ display: "flex", flexWrap: "wrap", '& > :not(style)': { margin: "4px", /*width: '25ch'*/ }, }}
                noValidate
                autoComplete="off">
                <Box sx={{ overflowX: "clip", display: "flex", flexDirection: "row", justifyContent: "flex-start", alignItems: "baseline" }}>
                    {cardTopComponents}
                </Box>
                {cardBottomComponents}
                <ButtonGroup size="small" sx={{ "& button": { textTransform: "none", padding: "2px 4px", marginLeft: "4px" }, flexGrow: 1, justifyContent: "right" }}>
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
                        setDtype(concept.type);
                
                        if (checkConceptIsEmpty(concept)) {
                            handleDeleteConcept(concept.id);
                        }
                        if (turnOffEditMode) {
                            turnOffEditMode();
                        }
                    }}>
                        Cancel
                    </Button>
                    <Button size="small" variant={checkCustomConceptDiff() ? "contained" : "outlined"} disabled={saveDisabledMsg.length > 0 || checkCustomConceptDiff() == false} onClick={() => {
                        
                        let tmpConcept = duplicateField(concept);
                        tmpConcept.name = name;
                        tmpConcept.type = dtype as Type;
                        
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

export const DerivedConceptForm: FC<ConceptFormProps> = function DerivedConceptForm({ concept, handleUpdateConcept, handleDeleteConcept, turnOffEditMode }) {

    let theme = useTheme();

    let conceptTransform = concept.transform as ConceptTransformation;

    useEffect(() => {
        setTransformCode(formatFunc(conceptTransform.code || ""))
        setCodeCandidates([formatFunc(conceptTransform.code || "")])
    }, [conceptTransform.code])

    let formattedCode = formatFunc(conceptTransform.code || "");

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    const [name, setName] = useState(concept.name);
    const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => { setName(event.target.value); };

    const [dtype, setDtype] = useState(concept.name == "" ? "auto" : concept.type as string);
    const handleDtypeChange = (event: SelectChangeEvent) => { setDtype(event.target.value); };


    // states related to transformation functions, they are only valid when the type is "derived"
    const [transformCode, setTransformCode] = useState<string>(formattedCode);
    const [transformDesc, setTransformDesc] = useState<string>(conceptTransform.description || "");
    const [transformParentIDs, setTransformParentIDs] = useState<string[]>(conceptTransform.parentIDs || []);
    const [transformResult, setTransformResult] = useState<[any[], any][]>([]);

    // use tables for infer domains
    let tables = useSelector((state: DataFormulatorState) => state.tables);

    //const tables = [(baseTable as DictTable).rows, ...synthOutputs.map(t => t.data), ...savedCharts.map(t => t.data)]


    // if these two fields are changed from other places, update their values
    useEffect(() => { setDtype(concept.type) }, [concept.type]);

    let dispatch = useDispatch();

    const [collapseCode, setCollapseCode] = useState<boolean>(true);
    const [collapseVisInspector, setCollapseVisInspector] = useState<boolean>(true);

    let [dialogOpen, setDialogOpen] = useState<boolean>(false);
    let [codeCandidates, setCodeCandidates] = useState<string[]>([]);

    let NUM_SAVED_TRANSFORM_RESULTS = 150;

    useEffect(() => {
        if (concept.source == "derived") {
            let result = deriveTransformExamplesV2(transformCode, transformParentIDs, NUM_SAVED_TRANSFORM_RESULTS, conceptShelfItems, tables);
            setTransformResult(result);
            // automatically set the data type (the user can still change it)
            setDtype(testType([...result.map(t => t[1])]));
        }
    }, [transformCode]);

    // time stamps used to track functions from server
    const [requestTimeStamp, setRequestTimeStamp] = useState<number>(0);
    const [codeGenInProgress, setCodeGenInProgress] = useState<boolean>(false);

    let typeList = TypeList
    let nameField = (
        <TextField key="name-field" id="name" fullWidth label="concept name" value={name} sx={{ minWidth: 120, flex: 1, paddingBottom: 1 }}
            FormHelperTextProps={{
                style: { fontSize: 8, marginTop: 0, marginLeft: "auto" }
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
                            console.log(conceptID)
                            console.log(conceptShelfItems.find(f => f.id == conceptID)?.source)
                            let chipColor = conceptShelfItems.find(f => f.id == conceptID)?.source == "original" ? theme.palette.primary.light : theme.palette.custom.main;
                            return <Chip 
                                key={conceptID}
                                variant="outlined" size="small" 
                                // color={}
                                sx={{ 
                                    color: chipColor,
                                    borderColor: chipColor, 
                                    padding: '2px 4px',  margin: '1px 2px', borderRadius: '10px', height: '100%', 
                                        '& .MuiChip-label': { overflowWrap: 'break-word', whiteSpace: 'normal', textOverflow: 'clip',
                                        fontSize: 11}}} label={conceptShelfItems.find(f => f.id == conceptID)?.name} />
                        })}
                    </Typography>
                }
                onChange={(event: SelectChangeEvent<typeof transformParentIDs>) => {
                    const { target: { value }, } = event;
                    if (value.length == 0) { return }
                    typeof value === "string" ? setTransformParentIDs([value]) : setTransformParentIDs(value);
                }}
            >
                {conceptShelfItems.filter((t) => t.name != "").map((t, i) => (
                    <MenuItem value={t.id} key={`${concept.id}-${t.id}`} sx={{ fontSize: 12, marginLeft: "0px" }} disabled={childrenConceptIDs.includes(t.id)}>
                        {/* <Checkbox size="small" checked={transformParentIDs.indexOf(t.id) > -1} />
                        <ListItemText sx={{fontSize: 12}} primary={t.name} /> */}
                        {<Checkbox sx={{padding: 0.5}} size="small" checked={transformParentIDs.indexOf(t.id) > -1} />}
                        {t.name}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>,
    ]


    let parentConcepts = transformParentIDs.map((parentID) => conceptShelfItems.filter(c => c.id == parentID)[0]);
    let viewExamples: any = "";

    //let transformResult = deriveTransformResult(transformCode, parentConcept.domain.values.slice(0, 5));
    if (transformCode && transformResult.length > 0) {

        let colNames: [string[], string] = [parentConcepts.map(f => f.name), name];

        viewExamples = (<Box key="viewexample--box" width="100%" sx={{ position: "relative", }}>
            {/* <Tooltip title={collapseCode ? "view / edit transformation code" : "hide transformation code"}>
                <IconButton color="primary" sx={{
                    position: "absolute", right: "4px", top: "4px", zIndex: 3,
                    backgroundColor: collapseCode ? "" : "rgba(2, 136, 209, 0.3)",
                    "&:hover": { backgroundColor: collapseCode ? "default" : "rgba(2, 136, 209, 0.3)" }
                }}
                    size="small" onClick={() => { setCollapseCode(!collapseCode); setCollapseVisInspector(true); }}>
                    <TerminalIcon fontSize="small" />
                </IconButton>
            </Tooltip> */}
            <InputLabel shrink>illustration of the generated function</InputLabel>
            <GroupItems sx={{ padding: "0px 0px 6px 0px", margin: 0 }}>
                {simpleTableView(transformResult, colNames, conceptShelfItems, 5)}
            </GroupItems>
        </Box>)
    }

    //let codeArea = codeGenInProgress ? <LinearProgress sx={{ color: 'grey.500' }} color="inherit"/> : [codeEditor, viewExamples];

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
            {viewExamples}
        </Box>
    )

    let handleProcessResults = (status: string, rawCodeList: string[]) : string[] => {
        setCodeGenInProgress(false);
        if (status == "ok") {

            let candidates = processCodeCandidates(rawCodeList, transformParentIDs, conceptShelfItems, tables)
            let candidate = candidates[0];

            setCodeCandidates(candidates); // setCodeCandidates(codeList)
            setTransformCode(candidate);


            if (candidates.length > 0) {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "type": "success",
                    "value": `Find ${candidates.length} candidate transformations for concept "${name}".`
                }));
            } else {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "type": "info",
                    "value": `Find ${candidates.length} candidate transformations for concept "${name}", please try again.`
                }));
            }
            return candidates;
        } else {
            // TODO: add warnings to show the user
            setTransformCode("");
            dispatch(dfActions.addMessages({
                "timestamp": Date.now(),
                "type": "error",
                "value": "unable to generate the desired transformation, please try again."
            }));
            return [];
        }
    }

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
            type: values.length > 0 ? (typeof values[Math.floor((values.length  - 1) / 2)]) : "string",
            values
        }
    })

    // pick the dataset with the right parents  
    let inputDataCandidates = tables.filter(t => parentConcepts.every(c => t.names.includes(c.name)));
    let inputData = inputDataCandidates.length > 0 ? inputDataCandidates[0] : tables[0];

    cardBottomComponents = [
        <CodexDialogBox 
            key="code-dialog-box"
            inputData={inputData}
            inputFieldsInfo={inputFieldsInfo}
            initialDescription={transformDesc}
            outputName={name}
            handleProcessResults={handleProcessResults}
            callWhenSubmit={(desc: string) => {
                setTransformDesc(desc);
                setCodeCandidates([]);
                setCodeGenInProgress(true);
            }}
            size={'small'}
        />,
        <Box key="codearea-container" width="100%">
            {codeArea}
        </Box>,
        <IconButton key="tune-icon" size="small" color="primary"
            disabled={codeCandidates.length == 0 || codeGenInProgress}
            onClick={() => { setDialogOpen(true) }}>
            <Tooltip title={`inspect transformation code`}>
                <ZoomInIcon />
            </Tooltip>
        </IconButton>,
        <DisambiguationDialog
            key="disambiguation-dialog"
            conceptName={name} parentIDs={transformParentIDs} conceptShelfItems={conceptShelfItems}
            open={dialogOpen} transformDesc={transformDesc}
            codeCandidates={codeCandidates}
            handleUpdate={(code, desc, closeDialog) => { setTransformCode(code); setTransformDesc(desc); setDialogOpen(!closeDialog); }}
            onClose={() => { setDialogOpen(false) }}
        />
    ]

    const checkDerivedConceptDiff = () => {
        let nameTypeNeq = (concept.name != name || concept.type != dtype);
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
        if (transformResult.filter(entry => entry[1] == undefined).length > 0) {
            //saveDisabledMsg.push("transformation unsuccessful on some inputs");
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
                        setDtype(concept.type);

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
                        tmpConcept.type = dtype as Type;
                        tmpConcept.transform = concept.transform ? 
                            { parentIDs: transformParentIDs, 
                              code: transformCode, 
                              description: transformDesc } as ConceptTransformation : undefined;

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
    inputData: DictTable,
    outputName: string,
    inputFieldsInfo: {name: string, type: string, values: any[]}[],
    initialDescription: string,
    callWhenSubmit: (desc: string) => void,
    handleProcessResults: (status: string, codeList: string[]) => string[], // return processed cnadidates for the ease of logging
    size: "large" | "small",
}

export const CodexDialogBox: FC<CodexDialogBoxProps> = function ({ 
    initialDescription, inputFieldsInfo, inputData, outputName, callWhenSubmit, handleProcessResults, size="small" }) {

    let activeModel = useSelector(dfSelectors.getActiveModel);

    let [description, setDescription] = useState(initialDescription);
    let [requestTimeStamp, setRequestTimeStamp] = useState<number>(0);

    let defaultInstruction = `Derive ${outputName} from ${inputFieldsInfo.map(f => f.name).join(", ")}`;

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
                        input_fields: inputFieldsInfo,
                        input_data: {name: inputData['id'], rows: inputData['rows']},
                        output_name: outputName,
                        model: activeModel
                    }),
                };

                callWhenSubmit(description);

                // timeout the request after 20 seconds
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), 20000)

                fetch(getUrls().DERIVE_CONCEPT_URL, {...message, signal: controller.signal })
                    .then((response) => response.json())
                    .then((data) => {
                        console.log("---model output")
                        console.log(data);

                        let status = data["status"];
                        let codeList: string[] = [];

                        if (data["status"] == "ok" && data["token"] == requestTimeStamp) {
                            codeList = data["result"] as string[];
                        }
                        handleProcessResults(status, codeList);
                    }).catch((error) => {
                        handleProcessResults("error", []);
                    });
            }}>
            <PrecisionManufacturingIcon />
        </IconButton>
    </Tooltip>

    let textBox = <Box key="interaction-comp" width='100%' sx={{ display: 'flex' }}>
        <TextField 
            size="small"
            color="primary"
            fullWidth
            disabled={outputName == ""}
            InputProps={{
                endAdornment: formulateButton
            }}
            InputLabelProps={{ shrink: true }}
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
            variant="standard"  label={"transformation prompt"} 
        />
    </Box>

    return textBox;
}