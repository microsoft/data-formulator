// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import { Typography, SxProps } from "@mui/material";

export let ThinkingBufferEffect :React.FC<{text: string, sx?: SxProps}> = ({text, sx}) => {
    return <Typography sx={{ 
        margin: 'auto 0', padding: 0.5, fontSize: 10, color: "darkgray", 
        maxLines: 3, display: 'flex', alignItems: 'center', gap: 0.3, ...sx }}>
        {text.replace(/[^\s]/g, '·')}
        <Typography sx={{ 
            fontSize: 10, opacity: 0.5, 
            transform: 'rotate(90deg)',
            color: "darkgray", animation: 'writing 1.5s ease-in-out infinite',
        '@keyframes writing': {
            '0%, 100%': {
                transform: 'translate(0, 0) rotate(80deg)',
            },
            '50%': {
                transform: 'translate(2px, 2px) rotate(95deg)',
            }
        } }}>✏️</Typography>
    </Typography>
}