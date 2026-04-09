// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import { Box, Typography, SxProps } from "@mui/material";

/**
 * Pencil emoji with a writing animation — horizontal back-and-forth motion.
 * Use `size` to control the emoji font size.
 */
export const WritingPencil: React.FC<{ size?: string | number }> = ({ size = '1rem' }) => (
    <Box component="span" sx={{
        fontSize: size,
        display: 'inline-block',
        animation: 'writing-pencil-anim 1s ease-in-out infinite',
        transformOrigin: 'bottom left',
        '@keyframes writing-pencil-anim': {
            '0%': { transform: 'translate(0, 0) rotate(0deg)' },
            '25%': { transform: 'translate(3px, -1px) rotate(-5deg)' },
            '50%': { transform: 'translate(6px, 0) rotate(0deg)' },
            '75%': { transform: 'translate(3px, 1px) rotate(5deg)' },
            '100%': { transform: 'translate(0, 0) rotate(0deg)' },
        },
    }}>✏️</Box>
);

/**
 * Shimmer gradient text — text that cycles through a highlight sweep.
 * Pass `children` for the label text.
 */
export const ShimmerText: React.FC<{ children: React.ReactNode; fontSize?: string | number; fontWeight?: number }> = ({
    children, fontSize = '0.8rem', fontWeight = 500,
}) => (
    <Typography component="span" sx={{
        fontSize,
        fontWeight,
        background: (theme) => `linear-gradient(90deg, ${theme.palette.text.secondary} 0%, ${theme.palette.primary.main} 50%, ${theme.palette.text.secondary} 100%)`,
        backgroundSize: '200% 100%',
        animation: 'shimmer-text-anim 2s ease-in-out infinite',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        '@keyframes shimmer-text-anim': {
            '0%': { backgroundPosition: '100% 0' },
            '100%': { backgroundPosition: '-100% 0' },
        },
    }}>
        {children}
    </Typography>
);

/**
 * Combined pencil + shimmer text indicator for "work in progress" states.
 * Drop-in replacement for the various inline pencil/shimmer combos.
 */
export const WritingIndicator: React.FC<{
    label: string;
    pencilSize?: string | number;
    fontSize?: string | number;
    sx?: SxProps;
}> = ({ label, pencilSize = '1rem', fontSize = '0.8rem', sx }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ...sx as any }}>
        <WritingPencil size={pencilSize} />
        <ShimmerText fontSize={fontSize}>{label}</ShimmerText>
    </Box>
);

/** @deprecated Use WritingIndicator instead */
export const ThinkingBufferEffect: React.FC<{ text: string; sx?: SxProps }> = ({ text, sx }) => (
    <Box sx={{
        margin: 'auto 0', padding: 0.5, fontSize: 10, color: 'darkgray',
        display: 'flex', alignItems: 'center', gap: 0.5, ...sx as any,
    }}>
        <Typography sx={{ fontSize: 10, color: 'darkgray' }}>{text.replace(/[^\s]/g, '·')}</Typography>
        <WritingPencil size={10} />
    </Box>
);