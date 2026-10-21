// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import {
    Typography,
    Box,
    Card,
} from '@mui/material';
import { StreamIcon } from '../icons';
import { textVar } from '../app/layout';
import { apiRequest } from '../app/apiClient';
import { ItemCard, itemCardGridSx } from '../components/ItemCard';
import { ArtifactDeleteButton } from './DataThreadCards';

// Example session data for pre-built sessions
export interface ExampleSession {
    id: string;
    title: string;
    description: string;
    previewImage: string;
    workspace: string;       // path to workspace zip (e.g. /demos/demo_movies.zip)
    live: boolean;
    /** Questions offered for continuing the session once it is open. */
    followUps?: string[];
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
            followUps: Array.isArray(e.follow_ups) ? e.follow_ups.map(String) : [],
        }));
        return _cachedSessions;
    } catch {
        return [];
    }
}

/** Parse a simple YAML list of objects whose values are scalars or, under a bare `key:`, a list of scalars. */
export function parseSimpleYamlList(text: string): Record<string, any>[] {
    const items: Record<string, any>[] = [];
    let current: Record<string, any> | null = null;
    let listKey: string | null = null;
    const setPair = (kv: string) => {
        const colonIdx = kv.indexOf(': ');
        if (colonIdx > 0) {
            current![kv.slice(0, colonIdx).trim()] = parseYamlValue(kv.slice(colonIdx + 2).trim());
            listKey = null;
        } else if (kv.endsWith(':')) {
            listKey = kv.slice(0, -1).trim();
            current![listKey] = [];
        }
    };
    for (const line of text.split('\n')) {
        const trimmed = line.trimEnd();
        if (trimmed.startsWith('- ')) {
            if (current) items.push(current);
            current = {};
            listKey = null;
            setPair(trimmed.slice(2));
        } else if (current && listKey && /^\s+- /.test(trimmed)) {
            current[listKey].push(parseYamlValue(unquote(trimmed.trim().slice(2).trim())));
        } else if (trimmed.startsWith('  ') && current) {
            setPair(trimmed.trim());
        }
    }
    if (current) items.push(current);
    return items;
}

function unquote(v: string): string {
    return v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0] ? v.slice(1, -1) : v;
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
        followUps: [
            'Which stock had the biggest one-day drop?',
            'Compare trading volume for NVDA and MSFT over time.',
            'Show weekly returns for each stock.',
        ],
    },
    {
        id: 'gas-prices',
        title: 'Gas Prices',
        description: 'Weekly gas prices across different grades and formulations',
        previewImage: '/demos/gas_prices-thumbnail.webp',
        workspace: '/demos/demo_gas-prices.zip',
        live: false,
        followUps: [
            'How do diesel prices compare with regular gasoline?',
            'When did gas prices peak?',
            'Show the average price each year by grade.',
        ],
    },
    {
        id: 'global-energy',
        title: 'Global Energy',
        description: 'Explore global energy consumption and CO2 emissions data',
        previewImage: '/demos/global_energy-thumbnail.webp',
        workspace: '/demos/demo_global-energy.zip',
        live: false,
        followUps: [
            'Which countries grew renewable electricity the most?',
            'How has nuclear power changed in France and Germany?',
            'Which countries emitted the most CO2 in 2020?',
        ],
    },
    {
        id: 'movies',
        title: 'Movies',
        description: 'Analyze movie performance, budgets, and ratings data',
        previewImage: '/demos/movies-thumbnail.webp',
        workspace: '/demos/demo_movies.zip',
        live: false,
        followUps: [
            'Which genres earn the most worldwide?',
            'Do higher IMDB ratings mean more box office?',
            'Which directors have the most hits?',
        ],
    },
    {
        id: 'unemployment',
        title: 'Unemployment',
        description: 'Unemployment rates across different industries over time',
        previewImage: '/demos/unemployment-thumbnail.webp',
        workspace: '/demos/demo_unemployment.zip',
        live: false,
        followUps: [
            'Which industries recovered first by 2010?',
            'Is unemployment in construction seasonal?',
            'Show the average yearly rate by industry.',
        ],
    }
];

// ── Published example sessions ─────────────────────────────────────────────
// Administrators publish one of their sessions; opening it imports a copy, like the built-in demos.

type PublishedExample = { id: string; title: string; description?: string; published_at: string };
const publishedChanged = new EventTarget();

const publishedDate = (value: string) => new Date(value).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', year: 'numeric' });

export async function fetchPublishedExamples(): Promise<ExampleSession[]> {
    const { data } = await apiRequest<{ examples: PublishedExample[] }>('/api/sessions/examples');
    return (data.examples || []).map(example => ({
        id: example.id, title: example.title, previewImage: '', live: false,
        description: example.description || i18n.t('administration.publishedOn', { date: publishedDate(example.published_at) }),
        workspace: `/api/sessions/examples/${example.id}`,
    }));
}

export async function publishExampleSession(workspaceId: string, title: string): Promise<void> {
    await apiRequest('/api/sessions/examples', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, title }) });
    publishedChanged.dispatchEvent(new Event('change'));
}

export function usePublishedExamples(enabled = true): ExampleSession[] {
    const [examples, setExamples] = useState<ExampleSession[]>([]);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const refresh = () => setTick(value => value + 1);
        publishedChanged.addEventListener('change', refresh);
        return () => publishedChanged.removeEventListener('change', refresh);
    }, []);
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        fetchPublishedExamples().then(list => { if (!cancelled) setExamples(list); }).catch(() => { if (!cancelled) setExamples([]); });
        return () => { cancelled = true; };
    }, [enabled, tick]);
    return examples;
}

/** Administration list of published example sessions, each removable. */
export const PublishedExamplesPanel: React.FC = () => {
    const { t } = useTranslation();
    const examples = usePublishedExamples();
    const [error, setError] = useState('');
    const remove = async (id: string) => {
        setError('');
        try {
            await apiRequest(`/api/sessions/examples/${id}`, { method: 'DELETE' });
            publishedChanged.dispatchEvent(new Event('change'));
        } catch (reason) { setError(reason instanceof Error ? reason.message : t('administration.removeExampleFailed')); }
    };
    return <Box sx={itemCardGridSx}>
        {error && <Typography role="alert" sx={{ fontSize: textVar.xs, color: 'error.main' }}>{error}</Typography>}
        {!examples.length && <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>{t('administration.noExampleSessions')}</Typography>}
        {examples.map(example => <ItemCard key={example.id} title={example.title} captions={[example.description]}
            actions={<ArtifactDeleteButton label={t('administration.removeItem', { name: example.title })} onClick={() => void remove(example.id)} />} />)}
    </Box>;
};

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
                borderColor: 'rgba(0, 0, 0, 0.18)',
                boxShadow: '0 1px 3px rgba(32, 33, 36, 0.06)',
                '&:hover': disabled ? {} : {
                    transform: 'translateY(-2px)',
                    borderColor: 'primary.light',
                    boxShadow: '0 4px 12px rgba(32, 33, 36, 0.12)',
                },
            }}
            onClick={disabled ? undefined : onClick}
        >
            {session.previewImage && <Box
                sx={{
                    height: 56,
                    alignSelf: 'center',
                    ml: 0.75,
                    flexShrink: 0,
                    overflow: 'hidden',
                }}
            >
                <Box
                    component="img"
                    src={session.previewImage}
                    alt={session.title}
                    sx={{
                        width: 'auto',
                        height: '100%',
                        objectFit: 'contain',
                        display: 'block',
                    }}
                />
            </Box>}

            <Box sx={{ flex: 1, minWidth: 0, p: 1.5 }}>
                <Typography variant="body2" fontWeight={400} noWrap sx={{ color: 'text.primary' }}>
                    {session.live && <StreamIcon sx={{ fontSize: textVar.xxs, color: 'success.main', mr: 0.5 }} />}
                    {session.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{
                    fontSize: textVar.xs,
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
