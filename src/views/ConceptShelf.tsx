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
    IconButton,
    Collapse,
} from '@mui/material';

import AddCircleIcon from '@mui/icons-material/AddCircle';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';

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
    const dispatch = useDispatch();

    const handleCleanUnusedConcepts = () => {
        dispatch(dfActions.clearUnReferencedCustomConcepts());
    };

    useEffect(() => {
        let focusedTable = tables.find(t => t.id == focusedTableId);
        if (focusedTableId == groupName || focusedTable?.derive?.source.includes(groupName)) {
            setExpanded(true);
        } else if (focusedTableId != groupName && groupName != "new fields") {
            setExpanded(false);
        }
    }, [focusedTableId])

    // Separate fields for display logic
    const displayFields = expanded ? fields : fields.slice(0, 6);
    const hasMoreFields = fields.length > 6;

    return <Box>
        <Box sx={{display: "block", width: "100%"}}>
            <Divider orientation="horizontal" textAlign="left">
                <Box sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    cursor: 'pointer',
                    gap: 1
                }}
                    onClick={() => setExpanded(!expanded)}>
                    <Typography component="h2" sx={{fontSize: "10px"}} color="text.secondary">
                        {groupName}
                    </Typography>
                    {fields.length > 6 && <Typography sx={{fontSize: "10px", ml: 1}} color="text.secondary">
                        {expanded ? '▾' : '▸'}
                    </Typography>}
                    {groupName === "new fields" && (
                        <Tooltip title="clean fields not referenced by any table">
                            <IconButton
                                size="small"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleCleanUnusedConcepts();
                                }}
                                sx={{
                                    fontSize: "8px",
                                    minWidth: "auto",
                                    px: 0.5,
                                    py: 0.25,
                                    height: "16px",
                                    ml: '0',
                                    '&:hover .cleaning-icon': {
                                        animation: 'spin 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                                        transform: 'rotate(360deg)'
                                    },
                                    '@keyframes spin': {
                                        '0%': {
                                            transform: 'rotate(0deg)'
                                        },
                                        '100%': {
                                            transform: 'rotate(360deg)'
                                        }
                                    }
                                }}
                            >
                                <CleaningServicesIcon className="cleaning-icon" sx={{ fontSize: "10px !important" }} />
                            </IconButton>
                        </Tooltip>
                    )}
                </Box>
            </Divider>
        </Box>
        
        {/* Always show first 6 fields */}
        <Box sx={{ width: '100%' }}>
            {displayFields.map((field) => (
                <ConceptCard key={`concept-card-${field.id}`} field={field} />
            ))}
        </Box>

        {/* Collapsible section for additional fields */}
        {hasMoreFields && (
            <>
                <Collapse in={expanded} timeout={300}>
                    <Box sx={{ width: '100%' }}>
                        {fields.slice(6).map((field) => (
                            <ConceptCard key={`concept-card-${field.id}`} field={field} />
                        ))}
                    </Box>
                </Collapse>
                
                {!expanded && (
                    <Button
                        onClick={() => setExpanded(true)}
                        sx={{
                            fontSize: "10px",
                            color: "text.secondary",
                            pl: 2,
                            py: 0.5,
                            fontStyle: "italic",
                            textTransform: 'none',
                            position: 'relative',
                            width: '100%',
                            justifyContent: 'flex-start',
                            '&:hover': {
                                background: 'transparent',
                                textDecoration: 'underline'
                            },
                            '&::before': {
                                content: '""',
                                position: 'absolute',
                                top: '-20px',
                                left: 0,
                                right: 0,
                                height: '20px',
                                background: 'linear-gradient(to bottom, transparent, white)',
                                pointerEvents: 'none'
                            }
                        }}
                    >
                        {`... show all ${fields.length} ${groupName} fields ▾`}
                    </Button>
                )}
            </>
        )}
    </Box>;
}


export const ConceptShelf: FC<ConceptShelfProps> = function ConceptShelf() {

    // reference to states
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const tables = useSelector((state: DataFormulatorState) => state.tables);

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
                        <OperatorCard operator="max" />
                        <OperatorCard operator="min" />
                    </Box>
                    {groupNames.map(groupName => {
                        let fields = conceptItemGroups.filter(g => g.group == groupName).map(g => g.field);
                        return <ConceptGroup key={`concept-group-${groupName}`} groupName={groupName} fields={fields} />
                    })}
                    <Divider orientation="horizontal" textAlign="left" sx={{mt: 1}}></Divider>
                </Box>
            </Box>
        </Box>
    );
}