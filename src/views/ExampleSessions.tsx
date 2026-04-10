// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import {
    Typography,
    Box,
    Card,
    CardContent,
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
    onClick: () => void;
    disabled?: boolean;
}> = ({ session, onClick, disabled }) => {
    return (
        <Card
            variant="outlined"
            sx={{
                textAlign: 'left',
                cursor: disabled ? 'default' : 'pointer',
                '&:hover': disabled ? {} : {
                    transform: 'translateY(-2px)',
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
            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="body2" fontWeight={500} noWrap sx={{ color: 'text.primary' }}>
                    {session.live && <StreamIcon sx={{ fontSize: 10, color: 'success.main', mr: 0.5 }} />}
                    {session.title}
                </Typography>
                <Typography variant="caption" color="text.disabled" sx={{
                    fontSize: 11,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                }}>
                    {session.description}
                </Typography>
            </CardContent>
        </Card>
    );
};
