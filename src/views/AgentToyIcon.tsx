// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import { SvgIcon, SvgIconProps, useTheme } from '@mui/material';

export type AgentToyVariant = 'thinking' | 'summary' | 'clarify' | 'explain' | 'default';

interface AgentToyIconProps extends SvgIconProps {
    variant?: AgentToyVariant;
}

/**
 * A custom robot-head icon with a swappable mouth and optional corner badge,
 * used to convey agent role/state in the data-thread gutter.
 *
 *   thinking  → squiggle mouth
 *   summary   → smile mouth
 *   clarify   → flat mouth + `?` badge in warning color
 *   explain   → open-`o` mouth + `i` badge in info color
 *   default   → flat mouth
 *
 * The face inherits `color` via `currentColor`, so it follows the surrounding
 * highlight/dim state. The corner badge uses fixed semantic colors so role
 * information survives dimming.
 */
export const AgentToyIcon: React.FC<AgentToyIconProps> = ({ variant = 'default', ...rest }) => {
    const theme = useTheme();

    const renderMouth = () => {
        const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const };
        switch (variant) {
            case 'thinking':
            case 'summary':
                // standard smile — neutral/positive resting state
                return <path d="M9.5 16.5 Q12 18.5 14.5 16.5" strokeWidth={1.4} {...common} />;
            case 'explain':
                // open `o` — reads as "talking, narrating"
                return <circle cx="12" cy="17" r="1.3" strokeWidth={1.2} {...common} />;
            case 'clarify':
            case 'default':
            default:
                // flat neutral
                return <line x1="9.5" y1="17" x2="14.5" y2="17" strokeWidth={1.4} {...common} />;
        }
    };

    const renderBadge = () => {
        const cx = 19.5, cy = 4.5;
        if (variant === 'clarify') {
            // larger `?` badge — clarify needs strong attention
            const r = 5;
            return (
                <g>
                    <circle cx={cx} cy={cy} r={r + 0.8} fill={theme.palette.background.paper} />
                    <circle cx={cx} cy={cy} r={r} fill="currentColor" />
                    <text x={cx} y={cy + 2.3} textAnchor="middle" fontSize={7.5} fontWeight={700}
                        fill={theme.palette.background.paper}
                        fontFamily="system-ui, -apple-system, sans-serif">?</text>
                </g>
            );
        }
        if (variant === 'explain') {
            const r = 5;
            return (
                <g>
                    <circle cx={cx} cy={cy} r={r + 0.8} fill={theme.palette.background.paper} />
                    <circle cx={cx} cy={cy} r={r} fill="currentColor" />
                    <text x={cx} y={cy + 2.3} textAnchor="middle" fontSize={7.5} fontWeight={700}
                        fill={theme.palette.background.paper}
                        fontFamily="system-ui, -apple-system, sans-serif">i</text>
                </g>
            );
        }
        if (variant === 'summary') {
            // checkmark badge — "presented, done"
            const r = 5;
            return (
                <g>
                    <circle cx={cx} cy={cy} r={r + 0.8} fill={theme.palette.background.paper} />
                    <circle cx={cx} cy={cy} r={r} fill="currentColor" />
                    <path d={`M${cx - 2.3} ${cy + 0.1} L${cx - 0.6} ${cy + 1.9} L${cx + 2.4} ${cy - 1.6}`}
                        fill="none" stroke={theme.palette.background.paper}
                        strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
                </g>
            );
        }
        return null;
    };

    return (
        <SvgIcon viewBox="0 0 24 24" {...rest}>
            {/* antenna */}
            <circle cx="12" cy="2.5" r="1" fill="currentColor" />
            <line x1="12" y1="3.5" x2="12" y2="5" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
            {/* head */}
            <rect x="4" y="5" width="16" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth={1.5} />
            {/* ears */}
            <rect x="2.5" y="10" width="1.5" height="5" rx="0.5" fill="currentColor" />
            <rect x="20" y="10" width="1.5" height="5" rx="0.5" fill="currentColor" />
            {/* eyes */}
            <circle cx="9" cy="12" r="1.1" fill="currentColor" />
            <circle cx="15" cy="12" r="1.1" fill="currentColor" />
            {/* mouth (variant-specific) */}
            {renderMouth()}
            {/* corner badge (clarify / explain) */}
            {renderBadge()}
        </SvgIcon>
    );
};
