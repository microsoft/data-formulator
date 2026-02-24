// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import {
    Typography,
    Box,
    Card,
    CardContent,
    Chip,
    alpha,
    useTheme,
} from '@mui/material';
import { StreamIcon } from '../icons';

// Example session data for pre-built sessions
export interface ExampleSession {
    id: string;
    title: string;
    description: string;
    previewImage: string;
    dataFile: string;
    live: boolean;
}

export const exampleSessions: ExampleSession[] = [
    {
        id: 'stock-prices-live',
        title: 'Stock Prices (Live)',
        description: 'Live stock prices for different companies',
        previewImage: '/screenshot-stock-price-live-thumbnail.webp',
        dataFile: '/df_stock_prices_live.json',
        live: true,
    },
    {
        id: 'gas-prices',
        title: 'Gas Prices',
        description: 'Weekly gas prices across different grades and formulations',
        previewImage: '/gas_prices-thumbnail.webp',
        dataFile: '/df_gas_prices.json',
        live: false,
    },
    {
        id: 'global-energy',
        title: 'Global Energy',
        description: 'Explore global energy consumption and CO2 emissions data',
        previewImage: '/global_energy-thumbnail.webp',
        dataFile: '/df_global_energy.json', 
        live: false,
    },
    {
        id: 'movies',
        title: 'Movies',
        description: 'Analyze movie performance, budgets, and ratings data',
        previewImage: '/movies-thumbnail.webp',
        dataFile: '/df_movies.json',
        live: false,
    },
    {
        id: 'unemployment',
        title: 'Unemployment',
        description: 'Unemployment rates across different industries over time',
        previewImage: '/unemployment-thumbnail.webp',
        dataFile: '/df_unemployment.json',
        live: false,
    }
];

// Session card component for displaying example sessions
export const ExampleSessionCard: React.FC<{
    session: ExampleSession;
    theme: any;
    onClick: () => void;
    disabled?: boolean;
}> = ({ session, theme, onClick, disabled }) => {
    return (
        <Card
            variant="outlined"
            sx={{
                cursor: disabled ? 'default' : 'pointer',
                '&:hover': disabled ? {} : {
                    transform: 'translateY(-2px)',
                    borderColor: session.live ? alpha(theme.palette.secondary.main, 0.4) : alpha(theme.palette.primary.main, 0.4),
                },
            }}
            onClick={disabled ? undefined : onClick}
        >
            <Box
                sx={{
                    height: 100,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    overflow: 'hidden'
                }}
            >
                <Box
                    component="img"
                    src={session.previewImage}
                    alt={session.title}
                    sx={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        opacity: 0.8
                    }}
                />
            </Box>

            {/* Content */}
            <CardContent sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', py: 1,
                '&:last-child': { pb: 1 }
             }}>
                {/* Header */}
                <Box>
                    <Typography
                        variant="subtitle2"
                        sx={{
                            fontSize: '12px',
                            color: theme.palette.text.secondary,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden'
                        }}
                    >
                        {session.live && <StreamIcon sx={{ fontSize: 10, color: 'success.main' }} />} <span style={{textDecoration: 'underline'}}>{session.title}:</span> {session.description}
                    </Typography>
                </Box>
            </CardContent>
        </Card>
    );
};
