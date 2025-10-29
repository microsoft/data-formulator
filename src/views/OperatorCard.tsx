
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC } from 'react'
import { useDrag } from 'react-dnd'

import '../scss/ConceptShelf.scss';

import { useTheme } from '@mui/material/styles';

import {
    Card,
    Box,
    Typography,
} from '@mui/material';

import React from 'react';

export interface OperatorCardProp {
    operator: string
}

export const OperatorCard: FC<OperatorCardProp> = function OperatorCard({ operator }) {
    // concept cards are draggable cards that can be dropped into encoding shelf
    
    let theme = useTheme();

    const [{ isDragging }, drag] = useDrag(() => ({
        type: "operator-card",
        item: { type: 'operator-card', operator, source: "conceptShelf" },
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
            handlerId: monitor.getHandlerId(),
        }),
    }));

    let opacity = isDragging ? 0.4 : 1;
    let fontStyle = "inherit";
    let border = "hidden";

    const cursorStyle = isDragging ? "grabbing" : "grab";
   
    let backgroundColor = theme.palette.secondary.light;

    let cardComponent = (
        <Card sx={{ minWidth: 80, backgroundColor, width: 'calc(50% - 6px)' }}
            variant="outlined"
            style={{ opacity, border, fontStyle, marginLeft: '3px', }}
            color="secondary"
            className={`data-field-list-item draggable-card `}>
            <Box ref={drag} sx={{ cursor: cursorStyle, background: 'rgba(255, 255, 255, 0.93)'}}
                 className={`draggable-card-header draggable-card-inner`}>
                <Typography className="draggable-card-title" 
                    sx={{ marginLeft: '6px !important', fontSize: 12, height: 24, width: "100%", fontStyle: 'italic' }} component={'span'} gutterBottom>
                    {operator}
                </Typography>
            </Box>
        </Card>
    )

    return cardComponent;
}
