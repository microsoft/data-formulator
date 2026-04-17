// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { keyframes } from '@mui/system';

const ROWS = 3;
const COLS = 12;
const CYCLE_MS = 120;

const fadeIn = keyframes`
  0%   { opacity: 0; transform: translateY(4px); }
  100% { opacity: 1; transform: translateY(0); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 0.4; }
  50%      { opacity: 1; }
`;

function BinaryGrid() {
    const [grid, setGrid] = useState<number[][]>(() =>
        Array.from({ length: ROWS }, () =>
            Array.from({ length: COLS }, () => Math.round(Math.random()))
        )
    );

    useEffect(() => {
        const id = setInterval(() => {
            setGrid(prev =>
                prev.map(row =>
                    row.map(cell =>
                        Math.random() < 0.3 ? (cell === 0 ? 1 : 0) : cell
                    )
                )
            );
        }, CYCLE_MS);
        return () => clearInterval(id);
    }, []);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', fontFamily: '"Courier New", monospace' }}>
            {grid.map((row, r) => (
                <Box key={r} sx={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
                    {row.map((cell, c) => (
                        <Box
                            key={`${r}-${c}`}
                            sx={{
                                width: 14,
                                height: 20,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.75rem',
                                fontWeight: 500,
                                color: cell === 1 ? 'primary.main' : 'text.disabled',
                                opacity: cell === 1 ? 0.9 : 0.25,
                                transition: 'opacity 0.2s ease, color 0.2s ease',
                                animation: `${fadeIn} 0.3s ease-out`,
                            }}
                        >
                            {cell}
                        </Box>
                    ))}
                </Box>
            ))}
        </Box>
    );
}

export function AnvilLoader() {
    return (
        <Box sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100vh', gap: 3,
            userSelect: 'none',
        }}>
            <BinaryGrid />
            <Typography
                variant="body2"
                sx={{
                    color: 'text.secondary',
                    fontFamily: '"Courier New", monospace',
                    letterSpacing: 3,
                    fontSize: '0.75rem',
                    fontWeight: 400,
                    animation: `${pulse} 2.5s ease-in-out infinite`,
                    textTransform: 'uppercase',
                }}
            >
                loading data formulator...
            </Typography>
        </Box>
    );
}
