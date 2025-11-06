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
    Popper,
} from '@mui/material';

import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';

import { useDrag, useDrop } from 'react-dnd'

import React from 'react';

import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import RefreshIcon from '@mui/icons-material/Refresh';
import BarChartIcon from '@mui/icons-material/BarChart';
import CategoryIcon from '@mui/icons-material/Category';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import QuestionMarkIcon from '@mui/icons-material/QuestionMark';

import { FieldItem, Channel, EncodingItem, AggrOp, AGGR_OP_LIST, 
        ConceptTransformation, Chart, duplicateField } from "../components/ComponentType";
import { EncodingDropResult } from "../views/ConceptShelf";

import _ from 'lodash';

import '../scss/EncodingShelf.scss';
import AnimateHeight from 'react-animate-height';
import { getIconFromDtype, getIconFromType, groupConceptItems } from './ViewUtils';
import { getUrls } from '../app/utils';
import { Type } from '../data/types';



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
    handleUnbind: () => void,
    tableMetadata: {[key: string]: {type: Type, semanticType: string, levels?: any[]}}
}

export const LittleConceptCard: FC<LittleConceptCardProps> = function LittleConceptCard({ channel, field, encoding, handleUnbind, tableMetadata }) {
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
            onClick={(event) => {}}
            onDelete={handleUnbind}
            icon={getIconFromType(tableMetadata[field.name]?.type || Type.Auto)}
        />
    )
}

// The property of an encoding box
export interface EncodingBoxProps {
    channel: Channel;
    chartId: string;
    tableId: string;
}

// the encoding boxes, allows 
export const EncodingBox: FC<EncodingBoxProps> = function EncodingBox({ channel, chartId, tableId }) {
    let theme = useTheme();

    // use tables for infer domains
    const tables = useSelector((state: DataFormulatorState) => state.tables);

    let allCharts = useSelector(dfSelectors.getAllCharts);
    let activeModel = useSelector(dfSelectors.getActiveModel);
    
    let chart = allCharts.find(c => c.id == chartId) as Chart;
    let activeTable = tables.find(t => t.id == tableId);
    
    let encoding = chart.encodingMap[channel]; 

    let handleSwapEncodingField = (channel1: Channel, channel2: Channel) => {
        dispatch(dfActions.swapChartEncoding({chartId, channel1, channel2}))
    }
    
    let handleResetEncoding = () => {
        dispatch(dfActions.updateChartEncoding({chartId, channel, encoding: { }}));
    }

    // updating a property of the encoding
    let updateEncProp = (prop: keyof EncodingItem, value: any) => {
        dispatch(dfActions.updateChartEncodingProp({chartId, channel, prop: prop as string, value}));
    }

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    let field = conceptShelfItems.find((x: FieldItem) => x.id == encoding.fieldID);
    let fieldMetadata = field?.name && activeTable?.metadata[field?.name] ? activeTable?.metadata[field?.name] : undefined;

    let [autoSortResult, setAutoSortResult] = useState<any[] | undefined>(fieldMetadata?.levels);
    let [autoSortInferRunning, setAutoSortInferRunning] = useState<boolean>(false);

    const dispatch = useDispatch();

    useEffect(() => { 
        if (field?.name && activeTable?.metadata[field?.name]) {
            let levels = activeTable?.metadata[field?.name].levels;
            setAutoSortResult(levels);

            if (!chart.chartType.includes("Area") && levels && levels.length > 0) {
                updateEncProp('sortBy', JSON.stringify(levels));
            }
        }
    }, [encoding.fieldID, activeTable])

    // make this a drop element for concepts
    const [{ canDrop, isOver }, drop] = useDrop(() => ({
        accept: ["concept-card", "operator-card"], // accepts only concept card items
        drop: (item: any): EncodingDropResult => {
            if (item.type === "concept-card") {
                if (item.source === "conceptShelf") {
                    handleResetEncoding();
                    updateEncProp('fieldID', item.fieldID);
                } else if (item.source === "encodingShelf") {
                    handleSwapEncodingField(channel, item.channel);
                } else {
                    console.log("field error")
                }
            }

            if (item.type === 'operator-card') {
                dispatch(dfActions.updateChartEncodingProp({chartId, channel, prop: 'aggregate', value: item.operator as AggrOp}));
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
        <LittleConceptCard channel={channel} key={`${channel}-${field.name}`} 
            tableMetadata={activeTable?.metadata || {}}
            field={field} encoding={encoding} 
            handleUnbind={() => {
            handleResetEncoding();
        }} />
    )

    // define anchor open
    let channelDisplay = getChannelDisplay(channel);

    let radioLabel = (label: string | React.ReactNode, value: any, key: string, width: number = 80, disabled: boolean = false, tooltip: string = "") => {
        let comp = <FormControlLabel sx={{ width: width, margin: 0 }} key={key}
                    disabled={disabled}
                    value={value} control={<Radio size="small" sx={{ padding: "4px" }} />} label={<Box sx={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                        {label}
                </Box>} />
        if (tooltip != "") {
            comp = <Tooltip key={`${key}-tooltip`} title={tooltip} arrow slotProps={{
                tooltip: {
                    sx: { bgcolor: 'rgba(255, 255, 255, 0.95)', color: 'rgba(0,0,0,0.95)', border: '1px solid darkgray' },
                },
            }}>{comp}</Tooltip>
        }
        return comp;
    }

    


    let dataTypeOpt = [
        <FormLabel key={`enc-box-${channel}-data-type-label`} sx={{ fontSize: "inherit" }} id="data-type-option-radio-buttons-group" >Data Type</FormLabel>,
        <FormControl
            key={`enc-box-${channel}-data-type-form-control`}
            sx={{
                paddingBottom: "2px", '& .MuiTypography-root': { fontSize: "inherit" }, flexDirection: "row",
                '& .MuiFormLabel-root': { fontSize: "inherit" }
            }}>
            <RadioGroup
                row
                aria-labelledby="data-type-option-radio-buttons-group"
                name="data-type-option-radio-buttons-group"
                value={encoding.dtype || "auto"}
                sx={{ width: 160 }}
                onChange={(event) => { 
                    if (event.target.value == "auto") {
                        updateEncProp("dtype", undefined);
                    } else {
                        updateEncProp("dtype", event.target.value as "quantitative" | "qualitative" | "temporal");
                    }
                }}
            >
                {radioLabel(getIconFromDtype("auto"), "auto", `dtype-auto`, 40, false, "auto")}
                {radioLabel(getIconFromDtype("quantitative"), "quantitative", `dtype-quantitative`, 40, false, "quantitative")}
                {radioLabel(getIconFromDtype("nominal"), "nominal", `dtype-nominal`, 40, false, "nominal")}
                {radioLabel(getIconFromDtype("temporal"), "temporal", `dtype-temporal`, 40, false, "temporal")}
            </RadioGroup>
        </FormControl>
    ];

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

    let domainItems = field ? activeTable?.rows.map(row => row[field?.name]) : [];
    domainItems = [...new Set(domainItems)];

    let autoSortEnabled = field && fieldMetadata?.type == Type.String && domainItems.length < 200;

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

                if (data["status"] == "ok") {
                    if (data["token"] == token) {
                        let candidate = data["result"][0];
                        
                        if (candidate['status'] == 'ok') {
                            let sortRes = {values: candidate['content']['sorted_values'], reason: candidate['content']['reason']}
                            setAutoSortResult(sortRes.values);
                        }
                    }
                } else {
                    // TODO: add warnings to show the user
                    dispatch(dfActions.addMessages({
                        "timestamp": Date.now(),
                        "component": "EncodingBox",
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
                    "component": "EncodingBox",
                    "type": "error",
                    "value": "unable to perform auto-sort due to server issue."
                }));
            });
    }

    let sortByOptions = [
        radioLabel("auto", "auto", `sort-by-auto`)
    ]
    // TODO: check sort options
    if (channel == "x" && (fieldMetadata?.type == Type.String || fieldMetadata?.type == Type.Auto)) {
        sortByOptions.push(radioLabel("x", "x", `sort-x-by-x-ascending`, 80));
        sortByOptions.push(radioLabel("y", "y", `sort-x-by-y-ascending`, 80));
        sortByOptions.push(radioLabel("color", "color", `sort-x-by-color-ascending`, 80));
    }
    if (channel == "y" && (fieldMetadata?.type == Type.String || fieldMetadata?.type == Type.Auto)) {
        sortByOptions.push(radioLabel("x", "x", `sort-y-by-x-ascending`, 80));
        sortByOptions.push(radioLabel("y", "y", `sort-y-by-y-ascending`, 80));
        sortByOptions.push(radioLabel("color", "color", `sort-y-by-color-ascending`, 80));
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
            if (autoSortResult != undefined && autoSortResult.length > 0) {

                let autoSortOptTitle = <Box>
                        <Box>
                            <Typography sx={{fontWeight: 'bold'}} component='span' fontSize='inherit'>Sort Order: </Typography> 
                             {autoSortResult.map(x => x ? x.toString() : 'null').join(", ")}
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
                            {autoSortResult.map(x => x ? x.toString() : 'null').join(", ")}
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
                value={encoding.sortBy ||  'auto'}
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
                value={encoding.sortOrder || "auto"}
                sx={{ width: 180 }}
                onChange={(event) => { updateEncProp("sortOrder", event.target.value) }}
            >
                {radioLabel("auto", "auto", `sort-auto`, 60)}
                {radioLabel("↑ asc", "ascending", `sort-ascending`, 60)}
                {radioLabel("↓ desc", "descending", `sort-descending`, 60)}
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
                {dataTypeOpt}
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
    let normalizedDisplay = encoding.stack ? (<Chip key="normalized-display" className="encoding-prop-chip" //deleteIcon={<RemoveIcon />} 
        color="default" sx={{  backgroundColor: optBackgroundColor }}
        label={"⌸"} size="small" onDelete={() => updateEncProp("stack", undefined)} />) : "";
    
    let handleSelectOption = (option: string) => {
        if (conceptShelfItems.map(f => f.name).includes(option)) {
            //console.log(`yah-haha: ${option}`);
            updateEncProp("fieldID", (conceptShelfItems.find(f => f.name == option) as FieldItem).id);
        } else {
            if (option == "") {
                console.log("nothing happens")
            } else {
                let newConept = {
                    id: `concept-${Date.now()}`, name: option, type: "auto" as Type, 
                    description: "", source: "custom", tableRef: "custom",
                } as FieldItem;
                dispatch(dfActions.updateConceptItems(newConept));
                updateEncProp("fieldID", newConept.id);
            }
            
        }
    }


    let conceptGroups = groupConceptItems(conceptShelfItems, tables);

    let groupNames = [...new Set(conceptGroups.map(g => g.group))];
    conceptGroups.sort((a, b) => {
        if (groupNames.indexOf(a.group) < groupNames.indexOf(b.group)) {
            return -1;
        } else if (groupNames.indexOf(a.group) > groupNames.indexOf(b.group)) {
            return 1;
        } else {
            return activeTable && activeTable.names.includes(a.field.name) && !activeTable.names.includes(b.field.name) ? -1 : 1;
        }
    })

    // Smart Popper component that switches between bottom-end and top-end
    const CustomPopper = (props: any) => {
        return (
            <Popper 
                {...props} 
                placement="bottom-end"
                modifiers={[
                    {
                        name: 'flip',
                        enabled: true,
                        options: {
                            fallbackPlacements: ['top-end'], // Only flip to top-end
                        },
                    },
                    {
                        name: 'preventOverflow',
                        enabled: true,
                        options: {
                            boundary: 'viewport',
                            padding: 8,
                        },
                    },
                    {
                        name: 'offset',
                        options: {
                            offset: [0, 8], // [horizontal, vertical] offset
                        },
                    },
                ]}
                style={{
                    zIndex: 1300, // Ensure it's above other elements
                }}
            />
        );
    };

    let createConceptInputBox = <Autocomplete
        key="concept-create-input-box"
        slots={{
            popper: CustomPopper // Try changing to: CustomPopperCSS
        }}
        onChange={(event, value) => {
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
            if (!isExisting) {
                return [`${inputValue}`, ...filtered,  ]
            } else {
                return [...filtered];
            }
        }}
        sx={{ 
            flexGrow: 1, 
            flexShrink: 1, 
            "& .MuiInput-input": { padding: "0px 8px !important"},
            "& .MuiAutocomplete-listbox": {
                maxHeight: '600px !important'
            }
        }}
        fullWidth
        selectOnFocus
        clearOnBlur
        handleHomeEndKeys
        autoHighlight
        id={`autocomplete-${chartId}-${channel}`}
        options={conceptGroups.map(g => g.field.name).filter(name => name != "")}
        getOptionLabel={(option) => {
            // Value selected with enter, right from the input
            return option;
        }}
        groupBy={(option) => {
            let groupItem = conceptGroups.find(item => item.field.name == option);
            if (groupItem && groupItem.field.name != "") {
                return `${groupItem.group}`;
            } else {
                return "create a new field"
            }         
        }}
        renderGroup={(params) => (
            <Box key={params.key}>
              <Box className="GroupHeader">{params.group}</Box>
              <Box className="GroupItems" sx={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                padding: '4px'
              }}>
                {params.children}
              </Box>
            </Box>
        )}
        renderOption={(props, option) => {
            let renderOption = (conceptShelfItems.map(f => f.name).includes(option)) ? option : `${option}`;
            let otherStyle = option == `` ? {color: "darkgray", fontStyle: "italic"} : {}

            // Find the field item for this option
            const fieldItem = conceptShelfItems.find(f => f.name === option);
            
            if (fieldItem) {
                // Create a mini concept card
                let backgroundColor = theme.palette.primary.main;
                if (fieldItem.source == "original") {
                    backgroundColor = theme.palette.primary.light;
                } else if (fieldItem.source == "custom") {
                    backgroundColor = theme.palette.custom.main;
                } else if (fieldItem.source == "derived") {
                    backgroundColor = theme.palette.derived.main;
                }

                // Add overlay logic similar to ConceptCard - make fields not in focused table more transparent
                let draggleCardHeaderBgOverlay = 'rgba(255, 255, 255, 0.9)';
                
                // Add subtle tint for non-focused fields
                if (activeTable && !activeTable.names.includes(fieldItem.name)) {
                    draggleCardHeaderBgOverlay = 'rgba(255, 255, 255, 1)';
                }

                // Extract only the compatible props for Card
                const { key, ...cardProps } = props;

                return (
                    <Card 
                        key={key}
                        onClick={() => handleSelectOption(option)}
                        sx={{ 
                            minWidth: 80, 
                            backgroundColor, 
                            position: "relative",
                            border: "none",
                            cursor: "pointer",
                            margin: '2px 4px',
                            "&:hover": {
                                boxShadow: "0 2px 4px 0 rgb(0 0 0 / 20%)"
                            }
                        }}
                        variant="outlined"
                        className={`data-field-list-item draggable-card`}
                    >
                        <Box sx={{ 
                                cursor: "pointer", 
                                background: draggleCardHeaderBgOverlay,
                                display: 'flex',
                                alignItems: 'center',
                                minHeight: '20px',
                                ml: 0.5
                            }}
                            className={`draggable-card-inner ${fieldItem.source}`}
                        >
                            <Typography sx={{
                                margin: '0px 4px',
                                fontSize: 10, 
                                width: "100%",
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                            }} component={'span'}>
                                {getIconFromType(activeTable?.metadata[fieldItem.name]?.type || Type.Auto)}
                                <span style={{
                                    whiteSpace: "nowrap",
                                    overflow: "hidden", 
                                    textOverflow: "ellipsis",
                                    flexShrink: 1
                                }}>
                                    {fieldItem.name}
                                </span>
                            </Typography>
                        </Box>
                    </Card>
                );
            } else {
                // For non-existing options (like new field creation)
                return (
                    <Typography 
                        {...props} 
                        onClick={() => handleSelectOption(option)}
                        sx={{
                            fontSize: "10px", 
                            padding: '4px 6px',
                            margin: '2px 4px',
                            cursor: 'pointer',
                            border: '1px dashed #ccc',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(0,0,0,0.02)',
                            height: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            "&:hover": {
                                backgroundColor: 'rgba(0,0,0,0.05)'
                            },
                            ...otherStyle
                        }}
                    >
                        {renderOption || "type a new field name"}
                    </Typography>
                );
            }
        }}
        freeSolo
        renderInput={(params) => (
            <TextField {...params} variant="standard" autoComplete='off' placeholder='field'
                sx={{height: "24px", "& .MuiInput-root": {height: "24px", fontSize: "small"}}} />
        )}
        slotProps={{
            paper: { // Use paper instead of popper for styling
                sx: {
                    width: '300px',
                    maxWidth: '300px',
                    '& .MuiAutocomplete-listbox': {
                        maxHeight: '600px !important'
                    },
                }
            }
        }}
    />

    const filter = createFilterOptions<string>();
    // when there is no field added, allow users to directly type concepts here, and it will be created on the fly.
    const encContent = field == undefined ? 
        (encoding.aggregate == 'count' ? [ aggregateDisplay ] : [
            normalizedDisplay,
            aggregateDisplay,
            createConceptInputBox
        ]) 
        : 
        [
            normalizedDisplay,
            aggregateDisplay,
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