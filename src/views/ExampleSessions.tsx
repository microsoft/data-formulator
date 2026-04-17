// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import {
    Typography,
    Box,
    Card,
} from '@mui/material';
import { StreamIcon } from '../icons';

// Example session data for pre-built sessions
export interface ExampleSession {
    id: string;
    title: string;
    description: string;
    previewImage: string;
    workspace: string;       // path to workspace zip (e.g. /demos/demo_movies.zip)
    live: boolean;
}

// Loaded from /demos/demos.yaml at runtime; empty until fetched.
let _cachedSessions: ExampleSession[] | null = null;

/** Fetch the demo manifest (cached after first call). */
export async function fetchExampleSessions(): Promise<ExampleSession[]> {
    if (_cachedSessions) return _cachedSessions;
    try {
        const res = await fetch('/demos/demos.yaml');
        if (!res.ok) return [];
        const text = await res.text();
        // Minimal YAML list-of-objects parser (no dependency needed for this simple format)
        const entries = parseSimpleYamlList(text);
        _cachedSessions = entries.map((e: any) => ({
            id: e.id || '',
            title: e.title || '',
            description: e.description || '',
            previewImage: e.preview || '',
            workspace: e.workspace || '',
            live: e.live === true || e.live === 'true',
        }));
        return _cachedSessions;
    } catch {
        return [];
    }
}

/** Parse a simple YAML list of flat objects (no nested structures). */
function parseSimpleYamlList(text: string): Record<string, any>[] {
    const items: Record<string, any>[] = [];
    let current: Record<string, any> | null = null;
    for (const line of text.split('\n')) {
        const trimmed = line.trimEnd();
        if (trimmed.startsWith('- ')) {
            if (current) items.push(current);
            current = {};
            const kv = trimmed.slice(2);
            const colonIdx = kv.indexOf(': ');
            if (colonIdx > 0) {
                current[kv.slice(0, colonIdx).trim()] = parseYamlValue(kv.slice(colonIdx + 2).trim());
            }
        } else if (trimmed.startsWith('  ') && current) {
            const kv = trimmed.trim();
            const colonIdx = kv.indexOf(': ');
            if (colonIdx > 0) {
                current[kv.slice(0, colonIdx).trim()] = parseYamlValue(kv.slice(colonIdx + 2).trim());
            }
        }
    }
    if (current) items.push(current);
    return items;
}

function parseYamlValue(v: string): any {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null' || v === '~') return null;
    if (/^-?\d+$/.test(v)) return parseInt(v, 10);
    if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
    return v;
}

// Legacy hardcoded list — kept as fallback if manifest fails to load.
export const exampleSessions: ExampleSession[] = [
    {
        id: 'stock-prices',
        title: 'Stock Prices',
        description: 'Stock prices for different companies',
        previewImage: '/demos/screenshot-stock-price-live-thumbnail.webp',
        workspace: '/demos/demo_stock-prices.zip',
        live: false,
    },
    {
        id: 'gas-prices',
        title: 'Gas Prices',
        description: 'Weekly gas prices across different grades and formulations',
        previewImage: '/demos/gas_prices-thumbnail.webp',
        workspace: '/demos/demo_gas-prices.zip',
        live: false,
    },
    {
        id: 'global-energy',
        title: 'Global Energy',
        description: 'Explore global energy consumption and CO2 emissions data',
        previewImage: '/demos/global_energy-thumbnail.webp',
        workspace: '/demos/demo_global-energy.zip',
        live: false,
    },
    {
        id: 'movies',
        title: 'Movies',
        description: 'Analyze movie performance, budgets, and ratings data',
        previewImage: '/demos/movies-thumbnail.webp',
        workspace: '/demos/demo_movies.zip',
        live: false,
    },
    {
        id: 'unemployment',
        title: 'Unemployment',
        description: 'Unemployment rates across different industries over time',
        previewImage: '/demos/unemployment-thumbnail.webp',
        workspace: '/demos/demo_unemployment.zip',
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
                display: 'flex',
                alignItems: 'stretch',
                gap: 0,
                p: 0,
                overflow: 'hidden',
                '&:hover': disabled ? {} : {
                    transform: 'translateY(-2px)',
                    backgroundColor: 'action.hover',
                },
            }}
            onClick={disabled ? undefined : onClick}
        >
            <Box
                sx={{
                    width: 72,
                    flexShrink: 0,
                    overflow: 'hidden',
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
                        display: 'block',
                    }}
                />
            </Box>

            <Box sx={{ flex: 1, minWidth: 0, p: 1.5 }}>
                <Typography variant="body2" fontWeight={500} noWrap sx={{ color: 'text.primary' }}>
                    {session.live && <StreamIcon sx={{ fontSize: 10, color: 'success.main', mr: 0.5 }} />}
                    {session.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{
                    fontSize: 11,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    lineHeight: 1.3,
                    mt: 0.25,
                }}>
                    {session.description}
                </Typography>
            </Box>
        </Card>
    );
};
