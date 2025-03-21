// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState } from 'react'
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
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import { ConceptCard } from './ConceptCard';
import { Type } from '../data/types';
import { groupConceptItems } from './ViewUtils';
import { OperatorCard } from './OperatorCard';


export const genFreshCustomConcept : () => FieldItem = () => {
    return {
        id: `concept-${Date.now()}`, name: "", type: "auto" as Type, domain: [],
        description: "", source: "custom", tableRef: "custom",
    }
}

export interface EncodingDropResult {
    channel: Channel
}

export interface ConceptShelfProps {
    
}

export const ConceptGroup: FC<{groupName: string, fields: FieldItem[]}> = function ConceptGroup({groupName, fields}) {

    const focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        let focusedTable = tables.find(t => t.id == focusedTableId);
        if (focusedTableId == groupName || focusedTable?.derive?.source.includes(groupName)) {
            setExpanded(true);
        } else if (focusedTableId != groupName && groupName != "new fields") {
            setExpanded(false);
        }
    }, [focusedTableId])

    return <Box>
        <Box sx={{display: "block", width: "100%"}}>
            <Divider orientation="horizontal" textAlign="left">
                <Box sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    cursor: 'pointer' 
                }}
                    onClick={() => setExpanded(!expanded)}>
                    <Typography component="h2" sx={{fontSize: "10px"}} color="text.secondary">
                        {groupName}
                    </Typography>
                    <Typography sx={{fontSize: "10px", ml: 1}} color="text.secondary">
                        {expanded ? '▾' : '▸'}
                    </Typography>
                </Box>
            </Divider>
        </Box>
        <Box
            sx={{
                maxHeight: expanded ? 'auto' : '240px',
                overflow: 'hidden',
                transition: 'max-height 0.3s ease-in-out',
                width: '100%'
            }}
        >
            {fields.map((field) => (
                <ConceptCard key={`concept-card-${field.id}`} field={field} />
            ))}
            {fields.length > 6 && !expanded && (
                <Box sx={{ 
                    position: 'relative', 
                    height: '40px',
                    '&::after': {
                        content: '""',
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: '100%',
                        background: 'linear-gradient(to bottom, transparent, white)'
                    }
                }}>
                    <ConceptCard field={fields[6]} />
                </Box>
            )}
        </Box>
        {fields.length > 6 && !expanded && (
            <Button
                onClick={() => setExpanded(!expanded)}
                sx={{
                    fontSize: "10px",
                    color: "text.secondary",
                    pl: 2,
                    py: 0.5,
                    fontStyle: "italic",
                    textTransform: 'none',
                    '&:hover': {
                        background: 'transparent',
                        textDecoration: 'underline'
                    }
                }}
            >
                {`... show all ${fields.length} ${groupName} fields ▾`}
            </Button>
        )}
    </Box>;
}


export const ConceptShelf: FC<ConceptShelfProps> = function ConceptShelf() {

    // reference to states
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const charts = useSelector((state: DataFormulatorState) => state.charts);

    const dispatch = useDispatch();

    useEffect(() => { 
        let focusedTable = tables.find(t => t.id == focusedTableId);
        if (focusedTable) {
            let names = focusedTable.names;
            let missingNames = names.filter(name => !conceptShelfItems.some(field => field.name == name));
 
            let conceptsToAdd = missingNames.map((name) => {
                return {
                    id: `concept-${name}-${Date.now()}`, name: name, type: "auto" as Type, 
                    description: "", source: "custom", tableRef: 'custom', temporary: true, domain: [],
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
    
    // group concepts based on types
    let conceptItemGroups = groupConceptItems(conceptShelfItems, tables);
    let groupNames = [...new Set(conceptItemGroups.map(g => g.group))]

    return (
        <Box className="concept-shelf">
            <Box className="view-title-box" sx={{display: "flex", justifyContent: "space-between"}}>
                <Typography className="view-title" component="h2" sx={{marginTop: "6px"}}>
                    Data Fields
                </Typography>
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
                    {groupNames.map(groupName => {
                        let fields = conceptItemGroups.filter(g => g.group == groupName).map(g => g.field);
                        let isCustomGroup = groupName == "new fields";

                        return <ConceptGroup key={`concept-group-${groupName}`} groupName={groupName} fields={fields} />
                    })}
                    <Divider orientation="horizontal" textAlign="left" sx={{mt: 1}}></Divider>
                </Box>
            </Box>
        </Box>
    );
}