// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The map's style panel: the user edits the view (projection, basemap, tiles) and each
 * layer's marks and encodings (show as, colour field, scheme, classes, size, opacity),
 * like Tableau's Marks card. Edits patch the file's JSON, keeping keys the panel does not know.
 */

import React, { FC, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Checkbox, Collapse, IconButton, MenuItem, Select, Slider, Switch, TextField, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import { layerGeoSet } from './geography';
import { BIVARIATE_SCHEMES, CATEGORICAL_SCHEMES, DIVERGING_SCHEMES, SEQUENTIAL_SCHEMES } from './scales';
import { bindChannel, boundField, channelBinding, CHOICE_CHANNELS, compatibleTemplates, switchTemplate, TEMPLATE_DEFS, TEMPLATES, type Encoding, type TemplateName } from './templates';
import { BASEMAPS, CLASS_METHODS, FLOW_DIRECTIONS, MAP_STYLES, PROJECTIONS, TILES, type LayerType, type MapSpec, type MapStyleName, type Row } from './spec';
import { mapStyle } from './styles';
import { THEME_CHOICES, themeIconUrl } from '../views/ChartThemePicker';

type Raw = Record<string, any>;

const builtInSet = (name: string) => name.startsWith('countries') ? 'countries' : name;

/** Pin each keyed layer's boundaries when the basemap that implied them changes. */
export function pinJoins(draft: Raw, from: string, to: string) {
    for (const layer of Array.isArray(draft.layers) ? draft.layers : []) {
        for (const location of [layer, layer.from, layer.to]) {
            if (!location || typeof location !== 'object' || !location.key || location.geo || location.keyType) continue;
            const before = builtInSet(layerGeoSet(undefined, undefined, from as never));
            if (before !== builtInSet(layerGeoSet(undefined, undefined, to as never))) location.geo = before;
        }
    }
}

/** Mark types a layer can switch between with its current fields. */
export function compatibleTypes(layer: Raw): LayerType[] {
    if (['flows', 'paths', 'shapes', 'vectors'].includes(layer.type)) return [layer.type];
    if (layer.lon && layer.lat) return ['points', 'bubbles', 'spikes', 'heatmap', 'hexbin', 'labels'];
    if (layer.key) return ['regions', 'bubbles', 'spikes', 'labels'];
    return [layer.type];
}

const sectionSx = { fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary', mb: 0.75 } as const;
const rowLabelSx = { fontSize: '0.74rem', color: 'text.secondary', width: 84, flexShrink: 0 } as const;
const selectSx = { flex: 1, minWidth: 0, fontSize: '0.78rem', '& .MuiSelect-select': { py: 0.4 } } as const;
const itemSx = { fontSize: '0.78rem' } as const;

const Row: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) =>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 32 }}>
        <Typography sx={rowLabelSx}>{label}</Typography>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>{children}</Box>
    </Box>;

/** A style's water, land, and border in one chip. */
const StyleSwatch: FC<{ name: MapStyleName }> = ({ name }) => {
    const style = mapStyle(name);
    return <Box sx={{ width: 22, height: 14, flexShrink: 0, borderRadius: '3px', border: '1px solid', borderColor: 'divider', overflow: 'hidden',
        // Water shows only where the style paints it (filling the frame, or as a sphere).
        background: style.ocean !== 'none' && (style.sphere || style.background === style.ocean) ? style.ocean : style.background, position: 'relative' }}>
        <Box sx={{ position: 'absolute', left: 3, top: 3, width: 11, height: 8, borderRadius: '2px 4px 3px 5px', bgcolor: style.land,
            border: `1px solid ${style.coast}` }} />
    </Box>;
};

const Swatch: FC<{ scheme: string }> = ({ scheme }) => {
    const ramp = (SEQUENTIAL_SCHEMES as Record<string, ((t: number) => string) | undefined>)[scheme]
        ?? (DIVERGING_SCHEMES as Record<string, ((t: number) => string) | undefined>)[scheme];
    const colors = ramp ? [0, 0.25, 0.5, 0.75, 1].map(t => ramp(t)) : (CATEGORICAL_SCHEMES[scheme] ?? []).slice(0, 6);
    return <Box sx={{ width: 56, height: 10, borderRadius: '2px', flexShrink: 0,
        background: ramp ? `linear-gradient(to right, ${colors.join(', ')})` : `linear-gradient(to right, ${colors.map((color, index) =>
            `${color} ${index * 100 / colors.length}%, ${color} ${(index + 1) * 100 / colors.length}%`).join(', ')})` }} />;
};

export const MapStylePanel: FC<{
    source: string;
    spec: MapSpec;
    data: Record<string, Row[]>;
    readOnly?: boolean;
    onChange: (source: string) => void;
    onClose: () => void;
}> = ({ source, spec, data, readOnly, onChange, onClose }) => {
    const { t } = useTranslation();
    const raw = useMemo<Raw>(() => { try { return JSON.parse(source); } catch { return {}; } }, [source]);
    const [open, setOpen] = useState<string | null>(spec.layers[0]?.id ?? null);
    const patch = (mutate: (draft: Raw) => void) => {
        if (readOnly) return;
        const draft = JSON.parse(JSON.stringify(raw));
        mutate(draft);
        onChange(`${JSON.stringify(draft, null, 2)}\n`);
    };
    const view = raw.view ?? {};
    const setView = (key: string, value: unknown) => patch(draft => {
        draft.view = { ...(draft.view ?? {}) };
        if (value === undefined || value === '') delete draft.view[key]; else draft.view[key] = value;
        // A new projection or basemap reframes the map.
        if (key === 'projection' || key === 'basemap') { delete draft.view.center; delete draft.view.zoom; delete draft.view.rotate; }
        // Layers keep joining the boundaries they joined before: US states stay states on a world basemap.
        if (key === 'basemap') pinJoins(draft, view.basemap ?? 'world', (value as string | undefined) ?? 'world');
    });
    const rawLayers: Raw[] = Array.isArray(raw.layers) ? raw.layers : [];
    const setLayer = (index: number, mutate: (layer: Raw) => void) => patch(draft => mutate(draft.layers[index]));
    const columns = (layer: Raw): string[] => {
        const rows = layer.data ? data[layer.data] ?? [] : [];
        return Array.from(new Set(rows.slice(0, 200).flatMap(row => Object.keys(row))));
    };
    const textColumn = (layer: Raw) => columns(layer).find(column =>
        (data[layer.data] ?? []).slice(0, 50).some(row => typeof row[column] === 'string' && row[column] !== ''));
    const numericColumns = (layer: Raw) => columns(layer).filter(column => {
        const rows = data[layer.data] ?? [];
        const sample = rows.slice(0, 200).map(row => row[column]).filter(value => value !== null && value !== undefined && value !== '');
        return sample.length > 0 && sample.every(value => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))));
    });

    return <Box data-map-style-panel sx={{ width: 300, flexShrink: 0, height: '100%', borderLeft: '1px solid', borderColor: 'divider', bgcolor: 'background.paper',
        display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, pt: 6.5, pb: 1 }}>
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, flex: 1 }}>{t('map.styleTitle')}</Typography>
            <IconButton size="small" aria-label={t('map.closeStyle')} onClick={onClose}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
        </Box>
        {/* Vertical scrolling only: a slider thumb's invisible hit area pokes past the edge at its maximum. */}
        <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', px: 1.5, pb: 2 }}>
            <Typography sx={sectionSx}>{t('map.map')}</Typography>
            <Row label={t('map.titleLabel')}>
                <TextField size="small" fullWidth value={raw.title ?? ''} disabled={readOnly} onChange={event => patch(draft => { draft.title = event.target.value; })}
                    slotProps={{ htmlInput: { 'aria-label': t('map.titleLabel'), style: { fontSize: '0.78rem', padding: '4px 8px' } } }} />
            </Row>
            <Row label={t('map.projection')}>
                <Select size="small" value={view.projection ?? ''} displayEmpty disabled={readOnly || (view.tiles && view.tiles !== 'none')} sx={selectSx}
                    inputProps={{ 'aria-label': t('map.projection') }} onChange={event => setView('projection', event.target.value || undefined)}>
                    <MenuItem value="" sx={itemSx}>{t('map.automatic')}</MenuItem>
                    {PROJECTIONS.map(name => <MenuItem key={name} value={name} sx={itemSx}>{t(`map.projections.${name}`)}</MenuItem>)}
                </Select>
            </Row>
            <Row label={t('map.basemap')}>
                <Select size="small" value={view.basemap ?? 'world'} disabled={readOnly} sx={selectSx} inputProps={{ 'aria-label': t('map.basemap') }}
                    onChange={event => setView('basemap', event.target.value === 'world' ? undefined : event.target.value)}>
                    {BASEMAPS.map(name => <MenuItem key={name} value={name} sx={itemSx}>{t(`map.basemaps.${name}`)}</MenuItem>)}
                </Select>
            </Row>
            <Row label={t('map.frame')}>
                <Select size="small" value={view.fit ?? 'data'} disabled={readOnly || !!view.center} sx={selectSx} inputProps={{ 'aria-label': t('map.frame') }}
                    onChange={event => setView('fit', event.target.value === 'data' ? undefined : event.target.value)}>
                    {(['data', 'basemap'] as const).map(name => <MenuItem key={name} value={name} sx={itemSx}>{t(`map.frames.${name}`)}</MenuItem>)}
                </Select>
            </Row>
            <Row label={t('map.streetMap')}>
                <Select size="small" value={view.tiles ?? 'none'} disabled={readOnly} sx={selectSx} inputProps={{ 'aria-label': t('map.streetMap') }}
                    onChange={event => setView('tiles', event.target.value === 'none' ? undefined : event.target.value)}>
                    {TILES.map(name => <MenuItem key={name} value={name} sx={itemSx}>{t(`map.tiles.${name}`)}</MenuItem>)}
                </Select>
            </Row>
            <Row label={t('map.graticule')}>
                <Switch size="small" checked={!!view.graticule} disabled={readOnly} onChange={event => setView('graticule', event.target.checked || undefined)}
                    slotProps={{ input: { 'aria-label': t('map.graticule') } }} />
            </Row>
            <Row label={t('map.placeNames')}>
                <Switch size="small" checked={view.labels !== false} disabled={readOnly} onChange={event => setView('labels', event.target.checked ? undefined : false)}
                    slotProps={{ input: { 'aria-label': t('map.placeNames') } }} />
            </Row>

            <Typography sx={{ ...sectionSx, mt: 2 }}>{t('map.look')}</Typography>
            <Row label={t('map.mapStyle')}>
                <Select size="small" value={view.style ?? 'light'} disabled={readOnly} sx={selectSx} inputProps={{ 'aria-label': t('map.mapStyle') }}
                    renderValue={value => <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><StyleSwatch name={value as MapStyleName} />{t(`map.styles.${value}`)}</Box>}
                    onChange={event => patch(draft => {
                        draft.view = { ...(draft.view ?? {}) };
                        if (event.target.value === 'light') delete draft.view.style; else draft.view.style = event.target.value;
                        // Street tiles follow the style's light or dark look.
                        if (draft.view.tiles === 'light' || draft.view.tiles === 'dark') draft.view.tiles = mapStyle(event.target.value as MapStyleName).tiles;
                    })}>
                    {MAP_STYLES.map(name => <MenuItem key={name} value={name} sx={{ ...itemSx, gap: 1 }}><StyleSwatch name={name} />{t(`map.styles.${name}`)}</MenuItem>)}
                </Select>
            </Row>
            <Row label={t('map.theme')}>
                <Select size="small" value={view.theme ?? ''} displayEmpty disabled={readOnly} sx={selectSx} inputProps={{ 'aria-label': t('map.theme') }}
                    renderValue={value => value ? (THEME_CHOICES.find(choice => (choice.id ?? 'none') === value)?.label ?? value) : t('map.appTheme')}
                    onChange={event => setView('theme', event.target.value || undefined)}>
                    <MenuItem value="" sx={itemSx}>{t('map.appTheme')}</MenuItem>
                    {THEME_CHOICES.map(choice => <MenuItem key={choice.id ?? 'none'} value={choice.id ?? 'none'} sx={{ ...itemSx, gap: 1 }}>
                        <Box component="img" src={themeIconUrl(choice.icon)} alt="" sx={{ width: 18, height: 18 }} />{choice.label}
                    </MenuItem>)}
                </Select>
            </Row>

            {raw.template ? <TemplateEditor raw={raw} readOnly={readOnly} patch={patch} numeric={numericColumns({ data: 'main' })} /> : <>
            <Typography sx={{ ...sectionSx, mt: 2 }}>{t('map.layers')}</Typography>
            {rawLayers.map((layer, index) => {
                const id = spec.layers[index]?.id ?? `layer${index + 1}`;
                const expanded = open === id;
                // Labels need something to say.
                const types = compatibleTypes(layer).filter(type => type !== 'labels' || layer.type === 'labels' || !!(layer.text || layer.key || textColumn(layer)));
                const color = typeof layer.color === 'object' && layer.color ? layer.color : {};
                const size = typeof layer.size === 'object' && layer.size ? layer.size : {};
                const colorField = typeof color.field === 'string' ? color.field : '';
                const sizeField = typeof size.field === 'string' ? size.field : '';
                const schemeGroup = color.type === 'categorical' || (colorField && !numericColumns(layer).includes(colorField)) ? 'categorical'
                    : color.type === 'diverging' || (color.scheme && color.scheme in DIVERGING_SCHEMES) ? 'diverging' : 'sequential';
                const schemes = Object.keys(schemeGroup === 'categorical' ? CATEGORICAL_SCHEMES : schemeGroup === 'diverging' ? DIVERGING_SCHEMES : SEQUENTIAL_SCHEMES);
                const sized = ['bubbles', 'points', 'spikes', 'flows', 'paths'].includes(layer.type);
                return <Box key={id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '6px', mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, pl: 0.25, pr: 0.5, py: 0.25 }}>
                        <Checkbox size="small" checked={layer.visible !== false} disabled={readOnly} sx={{ p: 0.5 }}
                            slotProps={{ input: { 'aria-label': t('map.showLayer', { name: layer.name ?? id }) } }}
                            onChange={event => setLayer(index, draft => { if (event.target.checked) delete draft.visible; else draft.visible = false; })} />
                        <Box component="button" type="button" onClick={() => setOpen(expanded ? null : id)} aria-expanded={expanded}
                            sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.5, border: 0, bgcolor: 'transparent', p: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                                <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{layer.name ?? id}</Typography>
                                <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>{t(`map.types.${layer.type}`, { defaultValue: layer.type })}{layer.data ? ` · ${layer.data}` : ''}</Typography>
                            </Box>
                            <ExpandMoreIcon sx={{ fontSize: 18, color: 'text.secondary', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
                        </Box>
                    </Box>
                    <Collapse in={expanded} unmountOnExit>
                        <Box sx={{ px: 1.25, pb: 1 }}>
                            {types.length > 1 && <Row label={t('map.showAs')}>
                                <Select size="small" value={layer.type} disabled={readOnly} sx={selectSx} inputProps={{ 'aria-label': t('map.showAs') }}
                                    onChange={event => setLayer(index, draft => {
                                        draft.type = event.target.value;
                                        if (draft.type === 'labels' && !draft.text) draft.text = draft.key || colorField || textColumn(layer);
                                    })}>
                                    {types.map(type => <MenuItem key={type} value={type} sx={itemSx}>{t(`map.types.${type}`)}</MenuItem>)}
                                </Select>
                            </Row>}
                            {layer.type !== 'labels' && <Row label={t('map.colorBy')}>
                                <Select size="small" value={colorField} displayEmpty disabled={readOnly || typeof color.field === 'object'} sx={selectSx} inputProps={{ 'aria-label': t('map.colorBy') }}
                                    onChange={event => setLayer(index, draft => {
                                        const next = { ...(typeof draft.color === 'object' && draft.color ? draft.color : {}) };
                                        if (event.target.value) { next.field = event.target.value; delete next.value; delete next.domain; delete next.thresholds; }
                                        else {
                                            for (const key of ['field', 'field2', 'method', 'classes', 'thresholds', 'domain']) delete next[key];
                                            if (next.type === 'bivariate') delete next.type;
                                        }
                                        draft.color = next;
                                    })}>
                                    <MenuItem value="" sx={itemSx}>{typeof color.field === 'object' ? t('map.param', { name: color.field.param }) : t('map.singleColor')}</MenuItem>
                                    {(layer.type === 'shapes' ? [] : columns(layer)).map(column => <MenuItem key={column} value={column} sx={itemSx}>{column}</MenuItem>)}
                                </Select>
                            </Row>}
                            {layer.type !== 'labels' && (color.field || ['heatmap', 'hexbin'].includes(layer.type)) && <Row label={t('map.colors')}>
                                <Select size="small" value={color.scheme ?? ''} displayEmpty disabled={readOnly} sx={selectSx} inputProps={{ 'aria-label': t('map.colors') }}
                                    renderValue={value => <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>{value ? <Swatch scheme={value} /> : null}<span>{value || t('map.default')}</span></Box>}
                                    onChange={event => setLayer(index, draft => { draft.color = { ...(draft.color ?? {}), scheme: event.target.value || undefined }; })}>
                                    <MenuItem value="" sx={itemSx}>{t('map.default')}</MenuItem>
                                    {schemes.map(name => <MenuItem key={name} value={name} sx={{ ...itemSx, gap: 1 }}><Swatch scheme={name} />{name}</MenuItem>)}
                                </Select>
                            </Row>}
                            {color.field && schemeGroup !== 'categorical' && layer.type !== 'hexbin' && layer.type !== 'heatmap' && <>
                                <Row label={t('map.classes')}>
                                    <Select size="small" value={color.method ?? ''} displayEmpty disabled={readOnly} sx={selectSx} inputProps={{ 'aria-label': t('map.classes') }}
                                        onChange={event => setLayer(index, draft => { draft.color = { ...(draft.color ?? {}), method: event.target.value || undefined }; })}>
                                        <MenuItem value="" sx={itemSx}>{t('map.automatic')}</MenuItem>
                                        {CLASS_METHODS.filter(method => method !== 'threshold' || color.thresholds).map(method =>
                                            <MenuItem key={method} value={method} sx={itemSx}>{t(`map.methods.${method}`)}</MenuItem>)}
                                    </Select>
                                </Row>
                                {['quantile', 'equal', 'jenks', undefined].includes(color.method) && schemeGroup === 'sequential' && <Row label={t('map.steps')}>
                                    <Slider size="small" min={2} max={9} step={1} marks value={color.classes ?? 5} disabled={readOnly} aria-label={t('map.steps')} valueLabelDisplay="auto"
                                        onChange={(_, value) => setLayer(index, draft => { draft.color = { ...(draft.color ?? {}), classes: value }; })} sx={{ mx: 1 }} />
                                </Row>}
                            </>}
                            {(color.field || ['heatmap', 'hexbin'].includes(layer.type)) && <Row label={t('map.reverse')}>
                                <Switch size="small" checked={!!color.reverse} disabled={readOnly} slotProps={{ input: { 'aria-label': t('map.reverse') } }}
                                    onChange={event => setLayer(index, draft => { draft.color = { ...(draft.color ?? {}), reverse: event.target.checked || undefined }; })} />
                            </Row>}
                            {!color.field && !['heatmap', 'hexbin', 'labels'].includes(layer.type) && <Row label={t('map.color')}>
                                <Box component="input" type="color" aria-label={t('map.color')} disabled={readOnly} value={typeof color.value === 'string' && /^#[0-9a-f]{6}$/i.test(color.value) ? color.value : '#4e79a7'}
                                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLayer(index, draft => { draft.color = { value: event.target.value }; })}
                                    sx={{ width: 36, height: 24, p: 0, border: '1px solid', borderColor: 'divider', borderRadius: '4px', bgcolor: 'transparent' }} />
                            </Row>}
                            {sized && <Row label={t('map.sizeBy')}>
                                <Select size="small" value={sizeField} displayEmpty disabled={readOnly || typeof size.field === 'object'} sx={selectSx} inputProps={{ 'aria-label': t('map.sizeBy') }}
                                    onChange={event => setLayer(index, draft => {
                                        const next = { ...(typeof draft.size === 'object' && draft.size ? draft.size : {}) };
                                        if (event.target.value) { next.field = event.target.value; delete next.value; } else delete next.field;
                                        draft.size = next;
                                    })}>
                                    <MenuItem value="" sx={itemSx}>{typeof size.field === 'object' ? t('map.param', { name: size.field.param }) : t('map.fixedSize')}</MenuItem>
                                    {numericColumns(layer).map(column => <MenuItem key={column} value={column} sx={itemSx}>{column}</MenuItem>)}
                                </Select>
                            </Row>}
                            {sized && <Row label={size.field ? t('map.maxSize') : t('map.size')}>
                                <Slider size="small" min={1} max={layer.type === 'spikes' ? 240 : layer.type === 'flows' || layer.type === 'paths' ? 24 : 60} step={1} disabled={readOnly}
                                    value={size.field ? size.max ?? (layer.type === 'spikes' ? 120 : layer.type === 'flows' || layer.type === 'paths' ? 10 : layer.type === 'points' ? 12 : 32)
                                        : size.value ?? (layer.type === 'spikes' ? 20 : layer.type === 'points' ? 3 : layer.type === 'flows' || layer.type === 'paths' ? 1.5 : 6)}
                                    aria-label={t('map.size')} valueLabelDisplay="auto" sx={{ mx: 1 }}
                                    onChange={(_, value) => setLayer(index, draft => {
                                        const next = { ...(typeof draft.size === 'object' && draft.size ? draft.size : {}) };
                                        if (next.field) next.max = value; else next.value = value;
                                        draft.size = next;
                                    })} />
                            </Row>}
                            {['hexbin', 'heatmap'].includes(layer.type) && <Row label={layer.type === 'hexbin' ? t('map.hexSize') : t('map.smoothing')}>
                                <Slider size="small" min={4} max={60} step={1} value={layer.radius ?? (layer.type === 'hexbin' ? 12 : 18)} disabled={readOnly}
                                    aria-label={layer.type === 'hexbin' ? t('map.hexSize') : t('map.smoothing')} valueLabelDisplay="auto" sx={{ mx: 1 }} onChange={(_, value) => setLayer(index, draft => { draft.radius = value; })} />
                            </Row>}
                            <Row label={t('map.opacity')}>
                                <Slider size="small" min={0.1} max={1} step={0.05} value={layer.opacity ?? 1} disabled={readOnly} aria-label={t('map.opacity')} valueLabelDisplay="auto"
                                    valueLabelFormat={value => `${Math.round(value * 100)}%`} sx={{ mx: 1 }}
                                    onChange={(_, value) => setLayer(index, draft => { if (value === 1) delete draft.opacity; else draft.opacity = value; })} />
                            </Row>
                            {!readOnly && <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.25, mt: 0.5 }}>
                                <Tooltip title={t('map.moveUp')}><span><IconButton size="small" aria-label={t('map.moveUp')} disabled={index === 0}
                                    onClick={() => patch(draft => { const [item] = draft.layers.splice(index, 1); draft.layers.splice(index - 1, 0, item); })}><ArrowUpwardIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
                                <Tooltip title={t('map.moveDown')}><span><IconButton size="small" aria-label={t('map.moveDown')} disabled={index === rawLayers.length - 1}
                                    onClick={() => patch(draft => { const [item] = draft.layers.splice(index, 1); draft.layers.splice(index + 1, 0, item); })}><ArrowDownwardIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
                                <Tooltip title={t('map.removeLayer')}><IconButton size="small" aria-label={t('map.removeLayer')}
                                    onClick={() => patch(draft => { draft.layers.splice(index, 1); })}><DeleteOutlineIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                            </Box>}
                        </Box>
                    </Collapse>
                </Box>;
            })}
            <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', mt: 1 }}>
                {t('map.layersHint')}
            </Typography>
            </>}
        </Box>
    </Box>;
};

/** Which properties a template offers in the panel. */
const TEMPLATE_PROPERTIES: Record<TemplateName, ('classes' | 'scheme' | 'size' | 'density' | 'curve' | 'direction')[]> = {
    choropleth: ['classes', 'scheme'], bubbles: ['scheme', 'size'], points: ['scheme', 'size'], density: ['scheme', 'density'],
    spikes: ['scheme', 'size'], flows: ['scheme', 'size', 'curve', 'direction'], tracks: ['scheme', 'size', 'direction'], bivariate: ['scheme'],
    cartogram: ['scheme', 'size'], vectors: ['scheme', 'size'],
};

/**
 * A template map's editor: its type (among those its columns allow), a column per channel, and the
 * type's properties — the same knobs the agent sets, like a chart's encoding shelf.
 */
/** Colours offered for marks without a colour column: Tableau 10, plus a near-black for quiet maps. */
const MARK_COLORS = [...CATEGORICAL_SCHEMES.tableau10.slice(0, 10), '#333333'];

/** Channels that carry the map's measure. */
const MEASURE_CHANNELS = ['color', 'size', 'weight', 'color2'];

const TemplateEditor: FC<{ raw: Raw; readOnly?: boolean; patch: (mutate: (draft: Raw) => void) => void; numeric: string[] }> = ({
    raw, readOnly, patch, numeric }) => {
    const { t } = useTranslation();
    const name = raw.template as TemplateName;
    const def = TEMPLATE_DEFS[name];
    const encoding: Encoding = raw.encoding ?? {};
    const properties: Raw = raw.properties ?? {};
    if (!def) return null;
    // Channels with no alternative are required; region-or-lat/lon style choices each allow None.
    const required = new Set(def.requires.filter(options => options.length === 1).flat());
    // A fixed order, so the list does not shuffle as the type changes.
    const allowed = new Set([name, ...compatibleTemplates(encoding)]);
    const types = TEMPLATES.filter(type => allowed.has(type));
    const setProperty = (key: string, value: unknown) => patch(draft => {
        draft.properties = { ...(draft.properties ?? {}) };
        if (value === undefined || value === '') delete draft.properties[key]; else draft.properties[key] = value;
        if (!Object.keys(draft.properties).length) delete draft.properties;
    });
    const offered = TEMPLATE_PROPERTIES[name];
    const bivariate = name === 'bivariate';
    const colorField = boundField(encoding, 'color');
    const colorNumeric = !!colorField && numeric.includes(colorField);
    // People choose among the columns the agent offered; where marks go stays as the agent set it.
    // A measure the agent offered no alternatives for falls back to the data's other measures, so the
    // main field can always change; the choice is saved as a plain column, not as new options.
    const placed = new Set((['region', 'lat', 'lon', 'time', 'group', 'order', 'origin', 'destination'] as const)
        .map(channel => boundField(encoding, channel)).filter(Boolean));
    const measures = numeric.filter(column => !placed.has(column) && !/(^|_)(year|date|month|day|lat|lon|latitude|longitude|id|code|fips)($|_)/i.test(column));
    const choices = def.channels.filter(channel => CHOICE_CHANNELS.includes(channel)).map(channel => {
        const binding = channelBinding(encoding[channel]);
        const fallback = MEASURE_CHANNELS.includes(channel) && binding.options.length <= 1 && !!binding.field;
        const options = fallback ? Array.from(new Set([binding.field!, ...measures])) : binding.options;
        return { channel, field: binding.field, options, fallback };
    }).filter(choice => choice.options.length > 1 || (choice.options.length === 1 && !required.has(choice.channel)));
    const schemes = Object.keys(bivariate ? BIVARIATE_SCHEMES : !colorField ? SEQUENTIAL_SCHEMES
        : colorNumeric ? { ...SEQUENTIAL_SCHEMES, ...DIVERGING_SCHEMES } : CATEGORICAL_SCHEMES);
    const switchRow = (key: 'search' | 'details' | 'stats', fallback: boolean) => <Row label={t(`map.${key}`)}>
        <Switch size="small" checked={properties[key] ?? fallback} disabled={readOnly} slotProps={{ input: { 'aria-label': t(`map.${key}`) } }}
            onChange={event => setProperty(key, event.target.checked === fallback ? undefined : event.target.checked)} />
    </Row>;
    return <>
        <Typography sx={{ ...sectionSx, mt: 2 }}>{t('map.mapType')}</Typography>
        <Row label={t('map.mapType')}>
            <Select size="small" value={name} disabled={readOnly || types.length < 2} sx={selectSx} inputProps={{ 'aria-label': t('map.mapType') }}
                onChange={event => patch(draft => {
                    const next = event.target.value as TemplateName;
                    draft.template = next;
                    draft.encoding = switchTemplate(draft.encoding ?? {}, next);
                })}>
                {types.map(type => <MenuItem key={type} value={type} sx={itemSx}>{t(`map.templates.${type}`)}</MenuItem>)}
            </Select>
        </Row>
        {choices.map(({ channel, field, options, fallback }) => <Row key={channel} label={t(`map.channels.${channel}`)}>
            <Select size="small" value={field ?? ''} displayEmpty disabled={readOnly} sx={selectSx} inputProps={{ 'aria-label': t(`map.channels.${channel}`) }}
                onChange={event => patch(draft => {
                    draft.encoding = { ...(draft.encoding ?? {}), [channel]: fallback ? event.target.value : bindChannel(options, event.target.value || undefined) };
                })}>
                {!required.has(channel) && <MenuItem value="" sx={itemSx}>{t('map.none')}</MenuItem>}
                {options.map(column => <MenuItem key={column} value={column} sx={itemSx}>{column}</MenuItem>)}
            </Select>
        </Row>)}
        {/* Without a colour column, every mark takes one colour: the theme's, or one chosen here. */}
        {!colorField && !bivariate && name !== 'density' && name !== 'choropleth' && <Row label={t('map.markColor')}>
            <Select size="small" value={properties.color ?? ''} displayEmpty disabled={readOnly} sx={selectSx} inputProps={{ 'aria-label': t('map.markColor') }}
                renderValue={value => <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {value && <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: value, flexShrink: 0 }} />}
                    <span>{value || t('map.themeColor')}</span></Box>}
                onChange={event => setProperty('color', event.target.value || undefined)}>
                <MenuItem value="" sx={itemSx}>{t('map.themeColor')}</MenuItem>
                {Array.from(new Set([...MARK_COLORS, ...(properties.color ? [properties.color] : [])])).map(color =>
                    <MenuItem key={color} value={color} sx={{ ...itemSx, gap: 1 }}>
                        <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: color, flexShrink: 0 }} />{color}</MenuItem>)}
            </Select>
        </Row>}
        {offered.includes('scheme') && (colorField || bivariate || name === 'density') && <Row label={t('map.colors')}>
            <Select size="small" value={properties.scheme ?? ''} displayEmpty disabled={readOnly} sx={selectSx} inputProps={{ 'aria-label': t('map.colors') }}
                renderValue={value => <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>{value && !bivariate ? <Swatch scheme={value} /> : null}<span>{value || t('map.themeColors')}</span></Box>}
                onChange={event => setProperty('scheme', event.target.value || undefined)}>
                <MenuItem value="" sx={itemSx}>{t('map.themeColors')}</MenuItem>
                {schemes.map(scheme => <MenuItem key={scheme} value={scheme} sx={{ ...itemSx, gap: 1 }}>{!bivariate && <Swatch scheme={scheme} />}{scheme}</MenuItem>)}
            </Select>
        </Row>}
        {offered.includes('classes') && colorNumeric && <>
            <Row label={t('map.classes')}>
                <Select size="small" value={properties.method ?? ''} displayEmpty disabled={readOnly} sx={selectSx} inputProps={{ 'aria-label': t('map.classes') }}
                    onChange={event => setProperty('method', event.target.value || undefined)}>
                    <MenuItem value="" sx={itemSx}>{t('map.automatic')}</MenuItem>
                    {CLASS_METHODS.filter(method => method !== 'threshold').map(method => <MenuItem key={method} value={method} sx={itemSx}>{t(`map.methods.${method}`)}</MenuItem>)}
                </Select>
            </Row>
            {properties.method !== 'continuous' && properties.method !== 'log' && <Row label={t('map.steps')}>
                <Slider size="small" min={2} max={9} step={1} marks value={properties.classes ?? 5} disabled={readOnly} aria-label={t('map.steps')}
                    valueLabelDisplay="auto" sx={{ mx: 1 }} onChange={(_, value) => setProperty('classes', value)} />
            </Row>}
        </>}
        {offered.includes('size') && <Row label={boundField(encoding, 'size') ? t('map.maxSize') : t('map.size')}>
            <Slider size="small" min={1} max={name === 'spikes' ? 240 : name === 'flows' || name === 'tracks' ? 24 : 60} step={1} disabled={readOnly}
                value={properties.sizeMax ?? (name === 'spikes' ? 120 : name === 'flows' || name === 'tracks' ? 10 : name === 'points' ? 12 : name === 'vectors' ? 28 : 32)}
                aria-label={t('map.size')} valueLabelDisplay="auto" sx={{ mx: 1 }} onChange={(_, value) => setProperty('sizeMax', value)} />
        </Row>}
        {offered.includes('density') && <Row label={t('map.showAs')}>
            <Select size="small" value={properties.density ?? 'hexbin'} disabled={readOnly} sx={selectSx} inputProps={{ 'aria-label': t('map.showAs') }}
                onChange={event => setProperty('density', event.target.value === 'hexbin' ? undefined : event.target.value)}>
                {(['hexbin', 'heatmap'] as const).map(type => <MenuItem key={type} value={type} sx={itemSx}>{t(`map.types.${type}`)}</MenuItem>)}
            </Select>
        </Row>}
        {offered.includes('direction') && <Row label={t('map.direction')}>
            <Select size="small" value={properties.direction ?? 'arrow'} disabled={readOnly} sx={selectSx} inputProps={{ 'aria-label': t('map.direction') }}
                onChange={event => setProperty('direction', event.target.value === 'arrow' ? undefined : event.target.value)}>
                {FLOW_DIRECTIONS.map(direction => <MenuItem key={direction} value={direction} sx={itemSx}>{t(`map.directions.${direction}`)}</MenuItem>)}
            </Select>
        </Row>}
        {offered.includes('curve') && <Row label={t('map.curve')}>
            <Select size="small" value={properties.curve ?? ''} displayEmpty disabled={readOnly} sx={selectSx} inputProps={{ 'aria-label': t('map.curve') }}
                onChange={event => setProperty('curve', event.target.value || undefined)}>
                <MenuItem value="" sx={itemSx}>{t('map.automatic')}</MenuItem>
                {(['arc', 'great-circle', 'straight'] as const).map(curve => <MenuItem key={curve} value={curve} sx={itemSx}>{t(`map.curves.${curve}`)}</MenuItem>)}
            </Select>
        </Row>}
        <Row label={t('map.opacity')}>
            <Slider size="small" min={0.1} max={1} step={0.05} value={properties.opacity ?? 1} disabled={readOnly} aria-label={t('map.opacity')}
                valueLabelDisplay="auto" valueLabelFormat={value => `${Math.round(value * 100)}%`} sx={{ mx: 1 }}
                onChange={(_, value) => setProperty('opacity', value === 1 ? undefined : value)} />
        </Row>
        <Typography sx={{ ...sectionSx, mt: 2 }}>{t('map.interaction')}</Typography>
        {switchRow('search', !!(boundField(encoding, 'region') || boundField(encoding, 'label')) && name !== 'flows' && name !== 'density')}
        {switchRow('details', name !== 'density')}
        {switchRow('stats', false)}
    </>;
};
