// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import { Box, CircularProgress, LinearProgress, Typography, SxProps, Tooltip, type Theme } from "@mui/material";
import { textVar } from '../app/layout';

export const InlineLoadingStatus: React.FC<{ label: string; size?: 'compact' | 'standard'; sx?: SxProps<Theme> }> = ({ label, size = 'compact', sx }) => (
    <Box role="status" aria-label={label} sx={[
        { display: 'flex', alignItems: 'center', gap: size === 'compact' ? 0.75 : 1, minWidth: 0,
            fontSize: size === 'compact' ? 12 : 14, color: 'text.secondary' },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
    ]}>
        <CircularProgress aria-hidden="true" size="1em" thickness={4} color="inherit" sx={{ flexShrink: 0,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none', '& circle': { animation: 'none' } },
        }} />
        <Typography component="span" sx={{ fontSize: 'inherit', lineHeight: 1.5, minWidth: 0, overflowWrap: 'anywhere' }}>{label}</Typography>
    </Box>
);

export const LoadingStatus: React.FC<{ label: string; sx?: SxProps<Theme> }> = ({ label, sx }) => (
    <Box role="status" sx={[
        { minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 1.5, color: 'text.secondary' },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
    ]}>
        <Typography sx={{ fontSize: 14, textAlign: 'center', overflowWrap: 'anywhere', maxWidth: '100%' }}>
            {label}
        </Typography>
        <LinearProgress aria-label={label}
            sx={{ width: 160, maxWidth: '100%', height: 3, flexShrink: 0, borderRadius: 1, bgcolor: 'action.selected',
                '& .MuiLinearProgress-bar': { bgcolor: 'text.disabled' },
                '@media (prefers-reduced-motion: reduce)': {
                    '& .MuiLinearProgress-bar': { animation: 'none', transform: 'none', left: 0, width: '40%' },
                    '& .MuiLinearProgress-bar2Indeterminate': { display: 'none' },
                },
            }} />
    </Box>
);

// A workflow's path, in outline like the other rail icons: three open steps on one winding line, which stops at each step's edge.
const WORKFLOW_PATH = 'M7.2 5H15A4 4 0 0 1 15 13H14.2M9.8 13H9A4 4 0 0 0 9 21H16.8';

/** A workflow: three steps on one winding path. Running, the path flows from the first step to the last. */
export const WorkflowIcon: React.FC<{ running: boolean; color?: string; label?: string; size?: number | string; showTooltip?: boolean }> = ({ running, color = 'currentColor', label = running ? 'Workflow running' : 'Workflow', size = 22, showTooltip = true }) => {
    const icon = <Box component="svg" viewBox="0 0 24 24" role={showTooltip ? 'img' : undefined} aria-label={showTooltip ? label : undefined} aria-hidden={!showTooltip || undefined}
        data-workflow-icon={running ? 'running' : 'idle'} sx={{ width: size, height: size, flexShrink: 0, display: 'block', color,
            '& .workflow-path': running ? { strokeDasharray: '2.4 2', animation: 'workflow-flow 0.9s linear infinite' } : {},
            '@keyframes workflow-flow': { to: { strokeDashoffset: -4.4 } },
            '@media (prefers-reduced-motion: reduce)': { '& .workflow-path': { animation: 'none' } } }}>
        <path className="workflow-path" d={WORKFLOW_PATH} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        {[[5, 5], [12, 13], [19, 21]].map(([cx, cy]) => <circle key={cx} cx={cx} cy={cy} r={2.2} fill="none" stroke="currentColor" strokeWidth={1.6} />)}
    </Box>;
    return showTooltip ? <Tooltip title={label}>{icon}</Tooltip> : icon;
};

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
export const ShimmerText: React.FC<{ children: React.ReactNode; fontSize?: string | number; fontWeight?: number; tone?: 'accent' | 'neutral' }> = ({
    children, fontSize = '0.8rem', fontWeight = 500, tone = 'accent',
}) => (
    <Typography component="span" sx={{
        fontSize,
        fontWeight,
        backgroundImage: (theme) => tone === 'neutral'
            ? `linear-gradient(90deg, currentColor 45%, color-mix(in srgb, currentColor 65%, ${theme.palette.background.paper}) 50%, currentColor 55%)`
            : `linear-gradient(90deg, ${theme.palette.text.secondary} 0%, ${theme.palette.primary.main} 50%, ${theme.palette.text.secondary} 100%)`,
        backgroundSize: tone === 'neutral' ? '300% 100%' : '200% 100%',
        ...(tone === 'neutral' ? { display: 'inline-block', maxWidth: '100%', verticalAlign: 'bottom',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            backgroundRepeat: 'no-repeat', backgroundColor: 'currentColor' } : {}),
        animation: tone === 'neutral' ? 'neutral-shimmer-text-anim 2s linear infinite' : 'shimmer-text-anim 2s ease-in-out infinite',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        '@keyframes shimmer-text-anim': {
            '0%': { backgroundPosition: '100% 0' },
            '100%': { backgroundPosition: '-100% 0' },
        },
        '@keyframes neutral-shimmer-text-anim': {
            '0%': { backgroundPosition: '100% 0' },
            '100%': { backgroundPosition: '0% 0' },
        },
        '@media (prefers-reduced-motion: reduce)': {
            animation: 'none', backgroundImage: 'none', WebkitTextFillColor: 'currentColor',
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
        margin: 'auto 0', padding: 0.5, fontSize: textVar.xxs, color: 'darkgray',
        display: 'flex', alignItems: 'center', gap: 0.5, ...sx as any,
    }}>
        <Typography sx={{ fontSize: textVar.xxs, color: 'darkgray' }}>{text.replace(/[^\s]/g, '·')}</Typography>
        <WritingPencil size={10} />
    </Box>
);