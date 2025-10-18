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
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import TableIcon from '@mui/icons-material/TableChart';
import ImageIcon from '@mui/icons-material/Image';
import LanguageIcon from '@mui/icons-material/Language';
import DatasetIcon from '@mui/icons-material/Dataset';

// Example session data for pre-built sessions
export interface ExampleSession {
    id: string;
    title: string;
    description: string;
    previewImage: string;
    dataFile: string;
}

export const exampleSessions: ExampleSession[] = [
    {
        id: 'gas-prices',
        title: 'Gas Prices',
        description: 'Weekly gas prices across different grades and formulations',
        previewImage: '/gas_prices-thumbnail.png',
        dataFile: '/df_gas_prices.json',
    },
    {
        id: 'global-energy',
        title: 'Global Energy',
        description: 'Explore global energy consumption and CO2 emissions data',
        previewImage: '/global_energy-thumbnail.png',
        dataFile: '/df_global_energy.json',
    },
    {
        id: 'movies',
        title: 'Movies',
        description: 'Analyze movie performance, budgets, and ratings data',
        previewImage: '/movies-thumbnail.png',
        dataFile: '/df_movies.json',
    },
    {
        id: 'unemployment',
        title: 'Unemployment',
        description: 'Unemployment rates across different industries over time',
        previewImage: '/unemployment-thumbnail.png',
        dataFile: '/df_unemployment.json',
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
            sx={{
                width: 240,
                borderRadius: 3,
                border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                transition: 'all 0.3s ease-in-out',
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                position: 'relative',
                overflow: 'hidden',
                '&:hover': disabled ? {} : {
                    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                    transform: 'translateY(-2px)',
                    borderColor: alpha(theme.palette.primary.main, 0.4),
                },
            }}
            onClick={disabled ? undefined : onClick}
        >
            <Box
                sx={{
                    height: 100,
                    background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.custom.main, 0.1)} 100%)`,
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
                        <span style={{textDecoration: 'underline'}}>{session.title}:</span> {session.description}
                    </Typography>
                </Box>
            </CardContent>
        </Card>
    );
};
