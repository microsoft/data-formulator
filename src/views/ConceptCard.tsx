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
    Card,
    Box,
    Typography,
    IconButton,
    TextField,
    Tooltip,
    LinearProgress,
    SxProps,
} from '@mui/material';

import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ForkRightIcon from '@mui/icons-material/ForkRight';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import HideSourceIcon from '@mui/icons-material/HideSource';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import AnimateHeight from 'react-animate-height';

import { FieldItem, ConceptTransformation, duplicateField, FieldSource } from '../components/componentType';

import {  testType, Type, TypeList } from "../data/types";
import React from 'react';
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';

import { getUrls } from '../app/utils';
import { getIconFromType } from './ViewUtils';


import _ from 'lodash';
import { DictTable } from '../components/componentType';
import { CodeBox } from './VisualizationView';
import { CustomReactTable } from './ReactTable';
import { alpha } from '@mui/material/styles';

export interface ConceptCardProps {
    field: FieldItem,
    sx?: SxProps
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

    let deleteOption = !(field.source == "original") && <IconButton size="small"
            key="delete-icon-button"
            color="primary" aria-label="Delete" component="span"
            onClick={() => { handleDeleteConcept(field.id); }}>
            <DeleteIcon fontSize="inherit" />
        </IconButton>;

    let cardHeaderOptions = [
        deleteOption,
    ]

    let typeIcon = (
        <Typography sx={{ fontSize: "inherit", display: "flex", alignItems: "center", verticalAlign: "middle" }} component={'span'}>
            {getIconFromType(focusedTable?.metadata[field.name]?.type)}
        </Typography>
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
                </Box>
            </Box>
        </Card>
    )

    return cardComponent;
}