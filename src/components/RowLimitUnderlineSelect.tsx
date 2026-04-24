// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useState } from 'react';
import { Box, Menu, MenuItem, Typography } from '@mui/material';
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';

export interface RowLimitUnderlineSelectProps {
    value: number;
    presets: number[];
    onChange: (n: number) => void;
    disabled?: boolean;
    /** Typography font size for the numeric value (px). */
    fontSize?: number;
}

/**
 * Underlined row-limit control: shows the current value with a small chevron;
 * opens a menu of presets on click (replaces a bulky Select field).
 */
export const RowLimitUnderlineSelect: React.FC<RowLimitUnderlineSelectProps> = ({
    value,
    presets,
    onChange,
    disabled = false,
    fontSize = 12,
}) => {
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const open = Boolean(anchorEl);

    return (
        <>
            <Box
                role="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-disabled={disabled}
                tabIndex={disabled ? -1 : 0}
                onClick={(e) => { if (!disabled) setAnchorEl(e.currentTarget); }}
                onKeyDown={(e) => {
                    if (disabled) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setAnchorEl(e.currentTarget as HTMLElement);
                    }
                }}
                sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.125,
                    cursor: disabled ? 'default' : 'pointer',
                    userSelect: 'none',
                    opacity: disabled ? 0.5 : 1,
                    borderBottom: '1px solid',
                    borderColor: (theme) => (theme.palette.mode === 'dark'
                        ? 'rgba(255,255,255,0.42)'
                        : 'rgba(0,0,0,0.42)'),
                    pb: '2px',
                    minWidth: 56,
                    justifyContent: 'flex-end',
                    transition: 'border-color 120ms ease',
                    ...(!disabled && {
                        '&:hover': { borderColor: 'primary.main' },
                        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                    }),
                }}
            >
                <Typography
                    component="span"
                    sx={{
                        fontSize,
                        fontWeight: 500,
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1.25,
                        color: 'text.primary',
                    }}
                >
                    {value.toLocaleString()}
                </Typography>
                <KeyboardArrowDown sx={{ fontSize: fontSize + 4, color: 'text.secondary', opacity: 0.9 }} />
            </Box>
            <Menu
                anchorEl={anchorEl}
                open={open}
                onClose={() => setAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{
                    paper: {
                        sx: { minWidth: anchorEl ? Math.max(anchorEl.offsetWidth, 100) : 100 },
                    },
                }}
            >
                {presets.map((n) => (
                    <MenuItem
                        key={n}
                        selected={n === value}
                        onClick={() => { onChange(n); setAnchorEl(null); }}
                        sx={{ fontSize: 11 }}
                    >
                        {n.toLocaleString()}
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
};
