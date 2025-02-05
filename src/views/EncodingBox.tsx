// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import { LinearProgress, styled, TextField, Tooltip } from '@mui/material';

import { useTheme } from '@mui/material/styles';
import { alpha } from "@mui/material";

import {
    Chip,
    Box,
    Typography,
    Button,
    FormControl,
    Select,
    MenuItem,
    Card,
    IconButton,
    FormLabel,
    RadioGroup,
    Radio,
    FormControlLabel,
    CardContent,
    ClickAwayListener,
} from '@mui/material';

import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';

import { useDrag, useDrop } from 'react-dnd'

import React from 'react';

import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import RefreshIcon from '@mui/icons-material/Refresh';


import { FieldItem, Channel, EncodingItem, AggrOp, AGGR_OP_LIST, 
        ConceptTransformation, Chart, duplicateField } from "../components/ComponentType";
import { EncodingDropResult } from "../views/ConceptShelf";

import _ from 'lodash';

import '../scss/EncodingShelf.scss';
import AnimateHeight from 'react-animate-height';
import { deriveTransformExamplesV2, getDomains, getIconFromType, groupConceptItems } from './ViewUtils';
import { getUrls } from '../app/utils';
import { Type } from '../data/types';

const GroupHeader = styled('div')(({ theme }) => ({
    position: 'sticky',
    top: '-8px',
    padding: '4px 10px',
    fontSize: '10px',
    color: 'darkgray',
    //backgroundColor: 'rbga(0,0,0,0.6)'
  }));
  
  const GroupItems = styled('ul')({
    padding: 0,
  });

let getChannelDisplay = (channel: Channel) => {
    if (channel == "x") {
        return "x-axis";
    } else if (channel == "y") {
        return "y-axis";
    }
    return channel;
}

export interface LittleConceptCardProps {
    channel: Channel,
    field: FieldItem,
    encoding: EncodingItem,
    handleUnbind: () => void
}

export const LittleConceptCard: FC<LittleConceptCardProps> = function LittleConceptCard({ channel, field, encoding, handleUnbind }) {
    // concept cards are draggable cards that can be dropped into encoding shelf

    let theme = useTheme();

    const [{ isDragging }, drag] = useDrag(() => ({
        type: "concept-card",
        item: { type: "concept-card", channel: channel, fieldID: field.id, source: "encodingShelf", encoding: encoding },
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
            handlerId: monitor.getHandlerId(),
        })
    }));

    const opacity = isDragging ? 0.4 : 1;
    const cursorStyle = isDragging ? "grabbing" : "grab";

    let fieldClass = "encoding-active-item ";

    let backgroundColor = alpha(theme.palette.primary.main, 0.05);

    if (field.source == "original") {
        //fieldClass += "encoding-active-item-original"
        backgroundColor = alpha(theme.palette.primary.main, 0.05);
    } else if (field.source == "custom") {
        //fieldClass += "encoding-active-item-custom"
        backgroundColor = alpha(theme.palette.custom.main, 0.05);
    } else if (field.source == "derived") {
        //fieldClass += "encoding-active-item-derived";
        backgroundColor = alpha(theme.palette.derived.main, 0.05);
    }

    return (
        <Chip
            ref={drag}
            className={`${fieldClass}`}
            color={'default'}
            label={field.name}
            size="small"
            sx={{
                backgroundColor,
                opacity: opacity,
                cursor: cursorStyle,
                ".MuiChip-label":
                    { /*width: "calc(100% - 36px)", maxWidth: "94px"*/ flexGrow: 1, flexShrink: 1, width: 0 }, ".MuiSvgIcon-root": { fontSize: "inherit" }
            }}
            variant="filled"
            onDelete={handleUnbind}
            icon={getIconFromType(field.type)}
        />
    )
}

// The property of an encoding box
export interface EncodingBoxProps {
    channel: Channel;
    chartId: string;
}

// the encoding boxes, allows 
export const EncodingBox: FC<EncodingBoxProps> = function EncodingBox({ channel, chartId }) {
    let theme = useTheme();

    // use tables for infer domains
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const charts = useSelector((state: DataFormulatorState) => state.charts);
    let activeModel = useSelector(dfSelectors.getActiveModel);
    
    let chart = charts.find(c => c.id == chartId) as Chart;
    
    let encoding = chart.encodingMap[channel]; 
        
    let handleSwapEncodingField = (channel1: Channel, channel2: Channel) => {
        dispatch(dfActions.swapChartEncoding({chartId, channel1, channel2}))
    }
    
    let handleResetEncoding = () => {
        dispatch(dfActions.updateChartEncoding({chartId, channel, encoding: {bin: false}}));
    }

    // updating a property of the encoding
    let updateEncProp = (prop: keyof EncodingItem, value: any) => {
        dispatch(dfActions.updateChartEncodingProp({chartId, channel, prop: prop as string, value}));
    }

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    let field = conceptShelfItems.find((x: FieldItem) => x.id == encoding.fieldID);

    let [autoSortResult, setAutoSortResult] = useState<{values: any[], reason: string} | undefined>(field?.levels);
    let [autoSortInferRunning, setAutoSortInferRunning] = useState<boolean>(false);

    const dispatch = useDispatch();

    useEffect(() => { 
        setAutoSortResult(field?.levels);
        if (field?.levels) {
            updateEncProp('sortBy', JSON.stringify(field?.levels));
        }
    }, [encoding.fieldID, field])

    // make this a drop element for concepts
    const [{ canDrop, isOver }, drop] = useDrop(() => ({
        accept: ["concept-card", "operator-card"], // accepts only concept card items
        drop: (item: any): EncodingDropResult => {
            if (item.type === "concept-card") {
                if (item.source === "conceptShelf") {
                    handleResetEncoding();
                    updateEncProp('fieldID', item.fieldID);
                    updateEncProp('bin', false);
                    //handleUpdateEncoding(channel, { 'fieldID': item.fieldID, bin: false });
                } else if (item.source === "encodingShelf") {
                    handleSwapEncodingField(channel, item.channel);
                } else {
                    console.log("field error")
                }
            }

            if (item.type === 'operator-card') {
                if (item.operator == 'bin') {
                    dispatch(dfActions.updateChartEncodingProp({chartId, channel, prop: 'bin', value: true}));
                } else {
                    dispatch(dfActions.updateChartEncodingProp({chartId, channel, prop: 'aggregate', value: item.operator as AggrOp}));
                }
            }

            return { channel: channel }
        },
        collect: (monitor) => ({
            isOver: monitor.isOver(),
            canDrop: monitor.canDrop(),
        }),
    }), [chartId, encoding]); // add dependency

    //useEffect(() => {resetConfigOptions()}, [encoding]);

    // items that control the editor panel popover
    const [editMode, setEditMode] = React.useState<boolean>(false);


    const isActive = canDrop && isOver;
    let backgroundColor = '';
    if (isActive) {
        backgroundColor = 'rgba(204, 239, 255, 0.5)';
    } else if (canDrop) {
        backgroundColor = 'rgba(255, 251, 204, 0.5)';
    }

    let fieldComponent = field === undefined ? "" : (
        <LittleConceptCard channel={channel} key={`${channel}-${field.name}`} field={field} encoding={encoding} handleUnbind={() => {
            handleResetEncoding();
        }} />
    )

    // define anchor open
    let channelDisplay = getChannelDisplay(channel);

    let radioLabel = (label: string, value: any, key: string, width: number = 80) => {
        return <FormControlLabel sx={{ width: width, margin: 0 }} key={key}
                    value={value} control={<Radio size="small" sx={{ padding: "4px" }} />} label={label} />
    }

    let stackOpt = (chart.chartType == "bar" || chart.chartType == "area") && (channel == "x" || channel == "y") ? [
        <FormLabel key={`enc-box-${channel}-stack-label`} sx={{ fontSize: "inherit" }} id="normalized-option-radio-buttons-group" >Stack</FormLabel>,
        <FormControl
            key={`enc-box-${channel}-stack-form-control`}
            sx={{
                paddingBottom: "2px", '& .MuiTypography-root': { fontSize: "inherit" }, flexDirection: "row",
                '& .MuiFormLabel-root': { fontSize: "inherit" }
            }}>
            <RadioGroup
                row
                aria-labelledby="normalized-option-radio-buttons-group"
                name="normalized-option-radio-buttons-group"
                value={encoding.stack || "default"}
                sx={{ width: 160 }}
                onChange={(event) => { updateEncProp("stack", event.target.value == "default" ? undefined : event.target.value); }}
            >
                {radioLabel("default", "default", `stack-default`)}
                {radioLabel("layered", "layered", `stack-layered`)}
                {radioLabel("center", "center", `stack-center`)}
                {radioLabel("normalize", "normalize", `stack-normalize`)}
            </RadioGroup>
        </FormControl>
    ] : [];

    let domainItems = (field?.source == "custom" || field?.source == "original") ? getDomains(field as FieldItem, tables)[0] : [];
    if (field?.source == "derived") {
        domainItems = deriveTransformExamplesV2(
            (field.transform as ConceptTransformation).code,
            (field.transform as ConceptTransformation).parentIDs,
            -1, conceptShelfItems, tables).map(p => p[1]);
    }
    // deduplicate domain items
    domainItems = [...new Set(domainItems)];

    let autoSortEnabled = field && field?.type == "string" && domainItems.length < 200;

    let autoSortFunction = () => {
        let token = domainItems.map(x => String(x)).join("--");
        setAutoSortInferRunning(true);
        let message = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: JSON.stringify({
                token: token,
                items: domainItems,
                field: field?.name,
                model: activeModel
            }),
        };

        fetch(getUrls().SORT_DATA_URL, message)
            .then((response) => response.json())
            .then((data) => {
                setAutoSortInferRunning(false);
                console.log(data);
                console.log(token);

                if (data["status"] == "ok") {
                    if (data["token"] == token) {
                        let candidate = data["result"][0];
                        console.log(candidate)
                        console.log(candidate['status'])
                        
                        if (candidate['status'] == 'ok') {
                            let sortRes = {values: candidate['content']['sorted_values'], reason: candidate['content']['reason']}
                            console.log(sortRes)
                            setAutoSortResult(sortRes);

                            let tmpConcept = duplicateField(field as FieldItem);
                            tmpConcept.levels = sortRes;

                            dispatch(dfActions.updateConceptItems(tmpConcept));
                        }
                    }
                } else {
                    // TODO: add warnings to show the user
                    dispatch(dfActions.addMessages({
                        "timestamp": Date.now(),
                        "type": "error",
                        "value": "unable to perform auto-sort."
                    }));
                    setAutoSortResult(undefined);
                }
            }).catch((error) => {
                setAutoSortInferRunning(false);
                setAutoSortResult(undefined);
               
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "type": "error",
                    "value": "unable to perform auto-sort due to server issue."
                }));
            });
    }

    let sortByOptions = [
        radioLabel("default", "default", `sort-by-default`)
    ]
    // TODO: check sort options
    if (channel == "x" && (field?.type == "string" || field?.type == "auto")) {
        sortByOptions.push(radioLabel("y values", "y", `sort-x-by-y-ascending`, 90));
    }
    if (channel == "y" && (field?.type == "string" || field?.type == "auto")) {
        sortByOptions.push(radioLabel("x values", "x", `sort-y-by-x-ascending`, 90));
    }
 
    if (autoSortEnabled) {
        if (autoSortInferRunning) {
            sortByOptions = [
                ...sortByOptions,
                <FormControlLabel sx={{ width: 180, margin: 0 }} key={"auto-btn"}
                    disabled={autoSortInferRunning || !autoSortResult}
                    value={JSON.stringify(autoSortResult)} control={<Radio size="small" sx={{ padding: "4px" }} />}
                    label={<LinearProgress color="primary" sx={{ width: "120px", opacity: 0.4 }} />} />
            ]
        } else {
            if (autoSortResult != undefined) {

                let autoSortOptTitle = <Box>
                        <Box>
                            <Typography sx={{fontWeight: 'bold'}} component='span' fontSize='inherit'>Sort Order: </Typography> 
                             {autoSortResult.values.map(x => x ? x.toString() : 'null').join(", ")}
                        </Box>
                        <Box>
                            <Typography sx={{fontWeight: 'bold'}} component='span' fontSize='inherit'>Reason: </Typography>
                            {autoSortResult.reason}
                        </Box>
                    </Box>

                let autoSortOpt = 
                    <Tooltip title={autoSortOptTitle} arrow componentsProps={{
                        tooltip: {
                          sx: {
                            bgcolor: 'rgba(255, 255, 255, 0.95)',
                            color: 'rgba(0,0,0,0.95)',
                            border: '1px solid darkgray'
                          },
                        },
                      }}>
                        <Typography className="auto-sort-option-label">
                            {autoSortResult.values.map(x => x ? x.toString() : 'null').join(", ")}
                        </Typography>
                    </Tooltip>;

                sortByOptions = [
                    ...sortByOptions,
                    <FormControlLabel sx={{ width: 180, margin: 0 }} key={"auto"}
                        disabled={autoSortInferRunning || !autoSortResult}
                        value={JSON.stringify(autoSortResult)} control={<Radio size="small" sx={{ padding: "4px" }} />}
                        label={<Box sx={{width: '100%', display:'flex'}}>
                                    {autoSortOpt}
                                    <Tooltip title='rerun smart sort'>
                                        <IconButton onClick={autoSortFunction} size='small' color='primary'>
                                            <RefreshIcon />
                                        </IconButton>
                                    </Tooltip>
                                </Box>} />
                ]
            } else {
                sortByOptions = [
                    ...sortByOptions,
                    <FormControlLabel sx={{ width: 180, margin: 0 }} key={"auto-btn"}
                        disabled={autoSortInferRunning || !autoSortResult}
                        value={JSON.stringify(autoSortResult)} control={<Radio size="small" sx={{ padding: "4px" }} />}
                        label={<Button size="small" variant="text"
                                    sx={{ textTransform: "none", padding: "2px 4px", marginLeft: "0px", minWidth: 0 }}
                                    onClick={autoSortFunction}>infer smart sort order</Button>} />
                ]
            }
        }
    }

    let sortByOpt = [
        <FormLabel sx={{ fontSize: "inherit" }} key={`enc-box-${channel}-sort-label`} id="sort-option-radio-buttons-group" >Sort By</FormLabel>,
        <FormControl
            key={`enc-box-${channel}-sort-form-control`}
            sx={{
                paddingBottom: "4px", '& .MuiTypography-root': { fontSize: "inherit" }, flexDirection: "row",
                '& .MuiFormLabel-root': { fontSize: "inherit" }
            }}>
            <RadioGroup
                row
                aria-labelledby="sort-option-radio-buttons-group"
                name="sort-option-radio-buttons-group"
                value={encoding.sortBy ||  'default'}
                sx={{ width: 180 }}
                onChange={(event) => { updateEncProp("sortBy", event.target.value) }}
            >
                {sortByOptions}
            </RadioGroup>
        </FormControl>
    ]

    let sortOrderOpt = [
        <FormLabel sx={{ fontSize: "inherit" }} key={`enc-box-${channel}-sort-order-label`} 
                   id="sort-option-radio-buttons-group" >Sort Order</FormLabel>,
        <FormControl
            key={`enc-box-${channel}-sort-order-form-control`}
            sx={{
                paddingBottom: "2px", '& .MuiTypography-root': { fontSize: "inherit" }, flexDirection: "row",
                '& .MuiFormLabel-root': { fontSize: "inherit" }
            }}>
            <RadioGroup
                row
                aria-labelledby="sort-option-radio-buttons-group"
                name="sort-option-radio-buttons-group"
                value={encoding.sortOrder || "ascending"}
                sx={{ width: 180 }}
                onChange={(event) => { updateEncProp("sortOrder", event.target.value) }}
            >
                {radioLabel("↑ asc", "ascending", `sort-ascending`, 90)}
                {radioLabel("↓ desc", "descending", `sort-descending`, 90)}
            </RadioGroup>
        </FormControl>
    ]
    
    let colorSchemeList = [
        "category10",
        "category20",
        "tableau10",
        "blues",
        "oranges",
        "reds",
        "greys",
        "goldgreen",
        "bluepurple",
        "blueorange",
        "redyellowblue",
        "spectral"
    ]
    let colorSchemeOpt = channel == "color" ? [
            <FormLabel sx={{ fontSize: "inherit" }} key={`enc-box-${channel}-color-scheme-label`} id="scheme-option-radio-buttons-group">Color scheme</FormLabel>,
            <FormControl key="color-sel-form" fullWidth size="small" sx={{textAlign: "initial", fontSize: "12px"}}>
                <Select
                    labelId="color-scheme-select-label"
                    variant="standard"
                    id="color-scheme-select"
                    label=""
                    sx={{'& .MuiSelect-select': {fontSize: "12px", paddingLeft: '6px'}}}
                    value={encoding.scheme || "default"}
                    onChange={(event)=>{ updateEncProp("scheme", event.target.value) }}
                >
                    <MenuItem value={"default"} key={"color-scheme--1"}><em>default</em></MenuItem>
                    {colorSchemeList.map((t, i) => (
                        <MenuItem value={t} key={`color-scheme-${i}`}>{t}</MenuItem>
                    ))}
                </Select>
            </FormControl>
    ] : []

    let encodingConfigCard = (
        <CardContent sx={{
            display: "flex", '& svg': { fontSize: "inherit" }, '&:last-child': { pb: "12px", pt: "12px" },
            margin: '0px 12px', padding: "6px", fontSize: "12px"
        }} >
            <Box sx={{margin: 'auto', display: "flex",  width: "fit-content", textAlign: "center", flexDirection: "column", alignItems: "flex-start" }}>
                {stackOpt}
                {sortByOpt}
                {sortOrderOpt}
                {colorSchemeOpt}
            </Box>
        </CardContent>
    )

    let optBackgroundColor = alpha(theme.palette.secondary.main, 0.07);

    let aggregateDisplay = encoding.aggregate ? (<Chip key="aggr-display" className="encoding-prop-chip"  
        sx={{  backgroundColor: optBackgroundColor, width: field == undefined ? "100%" : "auto" }}
        onDelete={() => updateEncProp("aggregate", undefined)} color="default" //deleteIcon={<RemoveIcon />}
        label={encoding.aggregate == "average" ? "avg" : encoding.aggregate} size="small" />) : "";
    let binDisplay = encoding.bin ? (<Chip key="bin-display" className="encoding-prop-chip"  color="default" label={"bin"} //deleteIcon={<RemoveIcon />}
        sx={{  backgroundColor: optBackgroundColor }}
        size="small" onDelete={() => updateEncProp("bin", false)} />) : "";
    let normalizedDisplay = encoding.stack ? (<Chip key="normalized-display" className="encoding-prop-chip" //deleteIcon={<RemoveIcon />} 
        color="default" sx={{  backgroundColor: optBackgroundColor }}
        label={"⌸"} size="small" onDelete={() => updateEncProp("stack", undefined)} />) : "";
    
    let handleSelectOption = (option: string) => {
        if (conceptShelfItems.map(f => f.name).includes(option)) {
            //console.log(`yah-haha: ${option}`);
            updateEncProp("fieldID", (conceptShelfItems.find(f => f.name == option) as FieldItem).id);
        } else {
            if (option == "...") {
                console.log("nothing happens")
            } else {
                console.log(`about to add ${option}`)
                let newConept = {
                    id: `concept-${Date.now()}`, name: option, type: "auto" as Type, 
                    description: "", source: "custom", domain: [],
                } as FieldItem;
                dispatch(dfActions.updateConceptItems(newConept));
                updateEncProp("fieldID", newConept.id);
            }
            
        }
    }

    let conceptGroups = groupConceptItems(conceptShelfItems);
    let createConceptInputBox = <Autocomplete
        key="concept-create-input-box"
        onChange={(event, value) => {
            console.log(`change: ${value}`)
            if (value != null) {
                handleSelectOption(value)
            }
        }}
        // value={tempValue}
        filterOptions={(options, params) => {
            const filtered = filter(options, params);
            const { inputValue } = params;
            // Suggest the creation of a new value
            const isExisting = options.some((option) => inputValue === option);
            if (inputValue !== '' && !isExisting) {
                return [`${inputValue}`, ...filtered,  ]
            } else {
                return [...filtered];
            }
        }}
        sx={{ flexGrow: 1, flexShrink: 1, "& .MuiInput-input": { padding: "0px 8px !important"}}}
        fullWidth
        selectOnFocus
        clearOnBlur
        handleHomeEndKeys
        autoHighlight
        id="free-solo-with-text-demo"
        options={conceptShelfItems.map(f => f.name).filter(name => name != "")}
        getOptionLabel={(option) => {
            // Value selected with enter, right from the input
            return option;
        }}
        groupBy={(option) => {
            let groupItem = conceptGroups.find(item => item.field.name == option);
            if (groupItem && groupItem.field.name != "") {
                return `from ${groupItem.group}`;
            } else {
                return "create a new field"
            }         
        }}
        renderGroup={(params) => (
            <li>
              <GroupHeader>{params.group}</GroupHeader>
              <GroupItems>{params.children}</GroupItems>
            </li>
          )}
        renderOption={(props, option) => {
            let renderOption = (conceptShelfItems.map(f => f.name).includes(option) || option == "...") ? option : `"${option}"`;
            let otherStyle = option == `...` ? {color: "darkgray"} : {}

            return <Typography {...props} onClick={()=>{
                handleSelectOption(option);
            }} sx={{fontSize: "small", ...otherStyle}}>{renderOption}</Typography>
        }}
        freeSolo
        renderInput={(params) => (
            <TextField {...params} variant="standard" autoComplete='off' placeholder='field or concept'
                sx={{height: "24px", "& .MuiInput-root": {height: "24px", fontSize: "small"}}} />
        )}
    />

    const filter = createFilterOptions<string>();
    // when there is no field added, allow users to directly type concepts here, and it will be created on the fly.
    const encContent = field == undefined ? 
        (encoding.aggregate == 'count' ? [ aggregateDisplay ] : [
            normalizedDisplay,
            aggregateDisplay,
            binDisplay,
            createConceptInputBox
        ]) 
        : 
        [
            normalizedDisplay,
            aggregateDisplay,
            binDisplay,
            fieldComponent
        ]

    let encodingComp = (
        <ClickAwayListener
            mouseEvent="onMouseUp"
            touchEvent="onTouchStart"
            onClickAway={() => { setEditMode(false) }}
        >
            <Box sx={{ display: 'flex', flexDirection: "column", alignItems: 'flex-start', width: "100%", marginBottom: "4px" }}
                component="form" className="channel-shelf-box encoding-item">
                <Card sx={{ width: "100%", boxShadow: editMode ? "0 2px 2px 0 rgb(0 0 0 / 20%), 0 2px 2px 0 rgb(0 0 0 / 19%)" : "" }} variant="outlined">
                    <Box ref={drop} className="channel-encoded-field">
                        <IconButton //className="encoding-shelf-action-button"
                            onClick={() => { setEditMode(!editMode) }} color="default"
                            aria-label="axis settings" component="span"
                            size="small" sx={{
                                padding: "0px", borderRadius: 0, textAlign: "left", fontSize: "inherit", height: "auto",
                                position: "relative", borderRight: "1px solid lightgray", width: '64px', backgroundColor: "rgba(0,0,0,0.01)",
                                display: "flex", justifyContent: "space-between"
                            }}>
                            <Typography variant="caption" component="span" sx={{ padding: "0px 0px 0px 6px" }}>{channelDisplay}</Typography>
                            <ArrowDropDownIcon sx={{ position: "absolute", right: "0", 
                                paddingLeft: "2px", transform: editMode ? "rotate(180deg)" : "" }} fontSize="inherit" />
                        </IconButton>
                        <Box sx={{
                            backgroundColor: backgroundColor, width: "calc(100% - 64px)",
                            display: "flex", borderBottom: (editMode ? "1px solid rgba(0, 0, 0, 0.12)" : undefined)
                        }}>
                            {encContent}
                        </Box>
                    </Box>
                    <AnimateHeight
                        duration={200}
                        height={editMode ? "auto" : 0} // see props documentation below
                    >
                        {encodingConfigCard}
                    </AnimateHeight>
                </Card>
            </Box>
        </ClickAwayListener>
    )

    return encodingComp;
}