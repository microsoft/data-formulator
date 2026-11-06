// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * /dev/samples: apps an agent generated from the sample datasets, shown live from their own sessions, with
 * how each was made (prompt, model, time, tokens) and what the layout checks found, to review issues.
 * The list is `devSamples.json`; each sample is a session (`sample_…`) in the local DF home.
 */

import React, { useEffect, useState } from 'react';
import { Box, Button, Chip, ToggleButton, ToggleButtonGroup } from '@mui/material';

import { ReactAppPreview } from './ReactAppPreview';
import { DevNav } from './DevNav';
import type { Density } from '../app/reactApp/runtime/density';
import { apiRequest } from '../app/apiClient';
import { getUrls } from '../app/utils';
import SAMPLES from './devSamples.json';

interface Sample {
    id: string;
    workspace: string;
    file: string;
    style: string;
    dataset: string;
    prompt: string;
    model: string;
    seconds?: number;
    tokens?: number;
    failed?: string[];
    notes?: string;
}

type SampleSession = NonNullable<React.ComponentProps<typeof ReactAppPreview>['session']>;

const FRAME = { width: 1000, height: 760 };

function SampleSection({ sample, density }: { sample: Sample; density: Density }) {
    const [source, setSource] = useState<string | null>(null);
    const [session, setSession] = useState<SampleSession | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [shown, setShown] = useState(false);
    const [reload, setReload] = useState(0);
    const [code, setCode] = useState(false);
    useEffect(() => {
        if (!shown) return;
        let cancelled = false;
        apiRequest<{ content: string }>(`/api/workspace/files/${encodeURIComponent(sample.file)}/text`, {
            method: 'GET', headers: { 'X-Workspace-Id': sample.workspace },
        }).then(({ data }) => { if (!cancelled) setSource(data.content); })
            .catch(failure => { if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure)); });
        // The sample's own session: its tables and charts, which the app may draw by id.
        apiRequest<{ state: Record<string, any> }>(getUrls().SESSION_LOAD, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sample.workspace }),
        }).then(({ data }) => {
            const state = data.state ?? {};
            if (!cancelled) setSession({ tables: [...(state.inputTables ?? []), ...(state.derivedTables ?? [])], fields: state.conceptShelfItems ?? [],
                tableSemantics: state.tableSemantics ?? [], charts: state.charts ?? [] });
        }).catch(() => { if (!cancelled) setSession({ tables: [], fields: [], tableSemantics: [], charts: [] }); });
        return () => { cancelled = true; };
    }, [shown, sample.file, sample.workspace]);
    // Load each app when it scrolls near, so the page does not start ten apps at once.
    const ref = React.useRef<HTMLDivElement>(null);
    useEffect(() => {
        const element = ref.current;
        if (!element || shown) return;
        const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setShown(true); }, { rootMargin: '600px' });
        observer.observe(element);
        return () => observer.disconnect();
    }, [shown]);
    return (
        <Box component="section" id={sample.id} ref={ref} sx={{ scrollMarginTop: 52 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 0.5, flexWrap: 'wrap' }}>
                <Box component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 600 }}>{sample.style} · {sample.dataset}</Box>
                <Box sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {sample.model}{sample.seconds ? ` · ${Math.round(sample.seconds)} s` : ''}{sample.tokens ? ` · ${Math.round(sample.tokens / 1000)}k tokens` : ''}
                </Box>
                {(sample.failed ?? []).map(check => <Chip key={check} size="small" color="warning" variant="outlined" label={check} />)}
                <Box sx={{ flex: 1 }} />
                <Button size="small" sx={{ textTransform: 'none' }} onClick={() => setCode(value => !value)}>{code ? 'Hide code' : 'Code'}</Button>
                <Button size="small" sx={{ textTransform: 'none' }} href={`/?session=${encodeURIComponent(sample.workspace)}`} target="_blank">Open session</Button>
                <Button size="small" sx={{ textTransform: 'none' }} onClick={() => setReload(value => value + 1)}>Reload</Button>
            </Box>
            <Box sx={{ fontSize: 13, mb: 1 }}>“{sample.prompt}”</Box>
            {sample.notes && <Box sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>{sample.notes}</Box>}
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                <Box data-app-frame sx={{
                    flexShrink: 0, width: FRAME.width, height: FRAME.height, position: 'relative',
                    border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', bgcolor: 'background.paper', boxShadow: 1,
                }}>
                    {error ? <Box sx={{ p: 2, color: 'error.main', fontSize: 13 }}>Could not load the app: {error}</Box>
                        : source && session ? <ReactAppPreview source={source} title={sample.id} reloadKey={reload} density={density}
                            workspaceId={sample.workspace} session={session} />
                            : <Box sx={{ p: 2, color: 'text.secondary', fontSize: 13 }}>Loading…</Box>}
                </Box>
                {code && source && (
                    <Box component="pre" sx={{
                        m: 0, flex: '1 1 0', minWidth: 320, height: FRAME.height, overflow: 'auto', p: 1.5, boxSizing: 'border-box',
                        fontSize: 11, lineHeight: 1.5, bgcolor: '#fafafa', border: 1, borderColor: 'divider', borderRadius: 1,
                    }}>{source}</Box>
                )}
            </Box>
        </Box>
    );
}

export default function DevSamplesPage() {
    const [density, setDensity] = useState<Density>('compact');
    const samples = SAMPLES as Sample[];
    return (
        <Box sx={{ height: '100vh', overflow: 'auto', bgcolor: 'background.default' }}>
            <DevNav />
            <Box sx={{ maxWidth: 1800, mx: 'auto', px: 3, py: 2.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box component="h1" sx={{ m: 0, fontSize: 20, fontWeight: 600 }}>Sample reports</Box>
                        <ToggleButtonGroup size="small" exclusive value={density} aria-label="Density"
                            onChange={(_event, next) => next && setDensity(next)}>
                            <ToggleButton value="compact" sx={{ textTransform: 'none', py: 0.25 }}>Compact</ToggleButton>
                            <ToggleButton value="normal" sx={{ textTransform: 'none', py: 0.25 }}>Normal</ToggleButton>
                        </ToggleButtonGroup>
                    </Box>
                    <Box sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>
                        Apps the agent wrote from the sample datasets, each from one prompt, shown live from its own session at the
                        size of the DF canvas. Warnings are the layout checks that failed when it was generated.
                        {' '}{samples.map(sample => <a key={sample.id} href={`#${sample.id}`} style={{ marginRight: 12 }}>{sample.style}</a>)}
                    </Box>
                </Box>
                {samples.map(sample => <SampleSection key={sample.id} sample={sample} density={density} />)}
            </Box>
        </Box>
    );
}
