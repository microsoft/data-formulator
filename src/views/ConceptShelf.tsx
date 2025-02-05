// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { useTheme } from '@mui/material/styles';
import { alpha } from "@mui/material";

import '../scss/ConceptShelf.scss';

import {
    Box,
    Typography,
    Tooltip,
    Button,
    Divider,
} from '@mui/material';

import AddCircleIcon from '@mui/icons-material/AddCircle';

import { FieldItem, Channel } from '../components/ComponentType';

import React from 'react';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { ConceptCard } from './ConceptCard';
import { Type } from '../data/types';
import { groupConceptItems } from './ViewUtils';
import { OperatorCard } from './OperatorCard';


export const genFreshCustomConcept : () => FieldItem = () => {
    return {
        id: `concept-${Date.now()}`, name: "", type: "auto" as Type, domain: [],
        description: "", source: "custom",
    }
}

export interface EncodingDropResult {
    channel: Channel
}

export interface ConceptShelfProps {
    
}

export const ConceptShelf: FC<ConceptShelfProps> = function ConceptShelf() {

    let theme = useTheme();
    // reference to states
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const charts = useSelector((state: DataFormulatorState) => state.charts);

    const dispatch = useDispatch();
    let handleDeleteConcept = (conceptID: string) => dispatch(dfActions.deleteConceptItemByID(conceptID));
    let handleUpdateConcept = (field: FieldItem) => dispatch(dfActions.updateConceptItems(field));

    useEffect(() => { 
        let focusedTable = tables.find(t => t.id == focusedTableId);
        if (focusedTable) {
            let names = focusedTable.names;
            let missingNames = names.filter(name => !conceptShelfItems.some(field => field.name == name));
 
            let conceptsToAdd = missingNames.map((name) => {
                return {
                    id: `concept-${name}-${Date.now()}`, name: name, type: "auto" as Type, 
                    description: "", source: "custom", temporary: true, domain: [],
                } as FieldItem
            })
            dispatch(dfActions.addConceptItems(conceptsToAdd));

            let conceptIdsToDelete = conceptShelfItems.filter(field => field.temporary == true 
                                    && !charts.some(c => Object.values(c.encodingMap).some(enc => enc.fieldID == field.id)) 
                                    && !names.includes(field.name)).map(field => field.id);
    
            // add and delete temporary fields
            dispatch(dfActions.batchDeleteConceptItemByID(conceptIdsToDelete));
        } else {
            if (tables.length > 0) {
                dispatch(dfActions.setFocusedTable(tables[0].id))
            }
        }
    }, [focusedTableId])


    let conceptCreatorBtn = (
        <Tooltip title="Create a new concept">
            <Button
                sx={{ fontSize: "14px", color: theme.palette.custom.main, '&:hover': { backgroundColor: alpha(theme.palette.custom.main, 0.1) },
                      float: "right", textTransform: "none", minWidth: "20px", lineHeight: 1, padding: "0px 4px"}}
                size="small"
                aria-label="Create new concept"
                endIcon={<AddCircleIcon fontSize="inherit" />}
                onClick={() => {
                    if (conceptShelfItems.filter(f => f.name === "").length > 0) {
                        return
                    }
                    handleUpdateConcept(genFreshCustomConcept());
                }}>
                new
            </Button>
        </Tooltip>);

    // // items for controlling icon creation
    // const [fieldSelectorAnchorEl, setFieldSelectorAnchorEl] = React.useState<HTMLButtonElement | null>(null);
    // const handleOpenFieldSelector = (event: React.MouseEvent<HTMLButtonElement>) => {
    //     setFieldSelectorAnchorEl(event.currentTarget);
    // };
    // const handleCloseFieldSelector = () => { setFieldSelectorAnchorEl(null); };
 
    // define anchor open
    // const fieldSelectorOpen = Boolean(fieldSelectorAnchorEl);
    // const fieldSelectorId = fieldSelectorOpen ? `conceptCreator` : undefined;

    // group concepts based on types
    let conceptItemGroups = groupConceptItems(conceptShelfItems);
    let groupNames = [...new Set(conceptItemGroups.map(g => g.group))]

    return (
        <Box className="concept-shelf">
            <Box className="view-title-box" sx={{display: "flex", justifyContent: "space-between"}}>
                <Typography className="view-title" component="h2" sx={{marginTop: "6px"}}>
                    Data Fields
                </Typography>
                {conceptCreatorBtn}
            </Box>
            <Box className="data-fields-group">
                <Box className="data-fields-list">
                    <Box sx={{display: "block", width: "100%"}}>
                        <Divider orientation="horizontal" textAlign="left">
                            <Typography component="h2" sx={{fontSize: "10px"}} color="text.secondary">
                                field operators
                            </Typography>
                        </Divider>
                    </Box>
                    <Box sx={{display: "flex", width: "100%", flexWrap: 'wrap'}}>
                        <OperatorCard operator="count" />
                        <OperatorCard operator="sum" />
                        <OperatorCard operator="average" />
                        <OperatorCard operator="median" />
                        <OperatorCard operator="bin" />
                    </Box>
                    {groupNames.map(gp => [
                        <Box 
                            key={`concept-group-${gp}`}
                            sx={{display: "block", width: "100%"}}>
                            <Divider orientation="horizontal" textAlign="left"><Typography component="h2" sx={{fontSize: "10px"}} color="text.secondary">
                                {gp}
                            </Typography></Divider>
                        </Box>,
                        ...conceptItemGroups.filter(g => g.group == gp)
                                            .map(item => item.field)
                                            .map((field) => (
                                                <ConceptCard key={`concept-card-${field.id}`} field={field} />))
                    ])}
                </Box>
            </Box>
        </Box>
    );
}