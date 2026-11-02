// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** /dev/maps: the sample maps, each editable as JSON or through the style panel, for checking the renderer. */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, List, ListItemButton, ListItemText, TextField, Typography } from '@mui/material';

import MapPreview from './MapPreview';
import { loadGeoSet } from './geography';
import { sampleMaps } from './samples';
import { stringifyMapSpec } from './spec';

export default function MapGallery() {
    const [countyIds, setCountyIds] = useState<string[] | null>(null);
    useEffect(() => { loadGeoSet('us-counties').then(set => setCountyIds(set.features.map(item => item.properties.id))); }, []);
    const samples = useMemo(() => sampleMaps(countyIds ?? []), [countyIds]);
    const [active, setActive] = useState(() => new URLSearchParams(window.location.search).get('map') ?? samples[0].id);
    const [sources, setSources] = useState<Record<string, string>>({});
    useEffect(() => {
        if (countyIds) setSources(current => ({ ...Object.fromEntries(samples.map(sample => [sample.id, stringifyMapSpec(sample.spec)])), ...current }));
    }, [samples, countyIds]);
    const [styleOpen, setStyleOpen] = useState(false);
    const [showSource, setShowSource] = useState(false);
    const source = sources[active] ?? '';
    const setSource = (text: string) => setSources(current => ({ ...current, [active]: text }));
    return <Box sx={{ display: 'flex', height: '100vh', fontFamily: 'var(--df-font)' }}>
        <Box sx={{ width: 250, flexShrink: 0, borderRight: '1px solid', borderColor: 'divider', overflowY: 'auto' }}>
            <Typography sx={{ px: 2, pt: 2, pb: 1, fontWeight: 600 }}>Map samples</Typography>
            <List dense>
                {samples.map(sample => <ListItemButton key={sample.id} selected={sample.id === active} onClick={() => {
                    setActive(sample.id);
                    window.history.replaceState(null, '', `?map=${sample.id}`);
                }}>
                    <ListItemText primary={sample.label} slotProps={{ primary: { sx: { fontSize: '0.8rem' } } }} />
                </ListItemButton>)}
            </List>
            <Box sx={{ px: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button size="small" variant={styleOpen ? 'contained' : 'outlined'} onClick={() => setStyleOpen(value => !value)}>Style</Button>
                <Button size="small" variant={showSource ? 'contained' : 'outlined'} onClick={() => setShowSource(value => !value)}>JSON</Button>
            </Box>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
            {source && <MapPreview key={active} source={source} styleOpen={styleOpen} onStyleClose={() => setStyleOpen(false)} onSourceChange={setSource} />}
        </Box>
        {showSource && <Box sx={{ width: 380, flexShrink: 0, borderLeft: '1px solid', borderColor: 'divider', overflow: 'auto', p: 1 }}>
            <TextField multiline fullWidth value={source.length > 40000 ? `${source.slice(0, 40000)}\n…` : source}
                onChange={event => setSource(event.target.value)} slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 11 } } }} />
        </Box>}
    </Box>;
}
