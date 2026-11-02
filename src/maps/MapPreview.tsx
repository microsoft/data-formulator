// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A `.map.json` workspace file on the canvas: parse the spec, load its tables (read-only
 * SQL over the workspace, as apps do) and boundary files, and draw it with MapView. The
 * style panel edits the file's JSON; the host saves it like any other file edit.
 */

import React, { FC, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { apiRequest } from '../app/apiClient';
import { resolveDefaultChartTheme, type DataFormulatorState } from '../app/dfSlice';
import { getUrls } from '../app/utils';
import { readWorkspaceTextFile } from '../app/workspaceService';
import { customGeoSet, loadGeoSet, type GeoSet } from './geography';
import { MapStylePanel } from './MapStylePanel';
import { MapView } from './MapView';
import { requiredGeoSets } from './model';
import type { FieldAnnotation } from './semantics';
import { mapTables, parseMapSpec, type DataSource, type MapSpec, type Row } from './spec';

export const MAP_ROW_LIMIT = 50_000;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function loadSource(source: DataSource): Promise<{ rows: Row[]; truncated: boolean }> {
    if ('values' in source) return { rows: source.values, truncated: false };
    const tables = 'tables' in source ? source.tables : [source.table];
    const sql = source.sql ?? `select * from ${quote((source as { table: string }).table)}`;
    const { data } = await apiRequest<{ rows: Row[]; truncated?: boolean }>(getUrls().APP_SQL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables, sql, params: [], limit: Math.min(source.limit ?? MAP_ROW_LIMIT, MAP_ROW_LIMIT) }),
    });
    return { rows: Array.isArray(data.rows) ? data.rows : [], truncated: !!data.truncated };
}

async function loadGeo(name: string): Promise<GeoSet> {
    if (!name.startsWith('files/')) return loadGeoSet(name as never);
    const [path, featureKey] = name.split('#');
    const file = await readWorkspaceTextFile(path.slice('files/'.length));
    return customGeoSet(name, JSON.parse(file.content), featureKey);
}

/** Load a spec's data and boundaries; `reloadKey` refetches. */
export function useMapInputs(spec: MapSpec | null, reloadKey = 0) {
    const [state, setState] = useState<{ data: Record<string, Row[]>; geoSets: Record<string, GeoSet>; errors: string[]; truncated: string[]; loading: boolean }>(
        { data: {}, geoSets: {}, errors: [], truncated: [], loading: true });
    const dataKey = JSON.stringify(spec?.data ?? null);
    const geoKey = JSON.stringify(spec ? requiredGeoSets(spec) : []);
    useEffect(() => {
        if (!spec) return;
        let cancelled = false;
        setState(current => ({ ...current, loading: true }));
        const sources = Object.entries(spec.data);
        const geoNames: string[] = JSON.parse(geoKey);
        Promise.all([
            Promise.all(sources.map(([name, source]) => loadSource(source).then(
                result => ({ name, ...result, error: null as string | null }),
                error => ({ name, rows: [] as Row[], truncated: false, error: `Data "${name}": ${error instanceof Error ? error.message : String(error)}` })))),
            Promise.all(geoNames.map(name => loadGeo(name).then(
                set => ({ name, set, error: null as string | null }),
                error => ({ name, set: null, error: `Boundaries "${name}": ${error instanceof Error ? error.message : String(error)}` })))),
        ]).then(([loaded, geo]) => {
            if (cancelled) return;
            setState({
                data: Object.fromEntries(loaded.map(item => [item.name, item.rows])),
                geoSets: Object.fromEntries(geo.filter(item => item.set).map(item => [item.name, item.set!])),
                errors: [...loaded, ...geo].map(item => item.error).filter((error): error is string => !!error),
                truncated: loaded.filter(item => item.truncated).map(item => item.name),
                loading: false,
            });
        });
        return () => { cancelled = true; };
    // The keys capture the spec's sources by value.
    }, [dataKey, geoKey, reloadKey]);
    return state;
}

export const MapPreview: FC<{
    source: string;
    reloadKey?: number;
    styleOpen?: boolean;
    onStyleClose?: () => void;
    /** Save-able edits from the style panel; absent when read-only. */
    onSourceChange?: (source: string) => void;
    onAskFix?: (errors: string[]) => void;
}> = ({ source, reloadKey = 0, styleOpen = false, onStyleClose, onSourceChange, onAskFix }) => {
    const { t } = useTranslation();
    const parsed = useMemo(() => parseMapSpec(source), [source]);
    const inputs = useMapInputs(parsed.spec, reloadKey);
    // Maps share charts' look and field semantics: the default chart theme and the tables' annotations.
    const defaultTheme = useSelector((state: DataFormulatorState) => resolveDefaultChartTheme(state.config));
    const tableSemantics = useSelector((state: DataFormulatorState) => state.tableSemantics);
    const tablesKey = parsed.spec ? mapTables(parsed.spec).join('\u0000') : '';
    const annotations = useMemo(() => {
        const tables = new Set(tablesKey.split('\u0000').filter(Boolean));
        const fields: Record<string, FieldAnnotation> = {};
        for (const info of tableSemantics ?? []) {
            if (!tables.has(info.tableId)) continue;
            for (const [name, field] of Object.entries(info.fields ?? {})) {
                const merged = { ...field, ...field.authored };
                if (merged.semanticType) fields[name] = { semanticType: merged.semanticType, unit: merged.unit, intrinsicDomain: merged.intrinsicDomain,
                    divergingMidpoint: merged.divergingMidpoint, displayName: merged.displayName };
            }
        }
        return fields;
    }, [tableSemantics, tablesKey]);
    const [askedFix, setAskedFix] = useState(false);
    useEffect(() => setAskedFix(false), [source]);

    if (!parsed.spec) {
        return <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 3 }}>
            <Box sx={{ maxWidth: 560 }}>
                <Typography sx={{ fontSize: '0.95rem', fontWeight: 600, mb: 1 }}>{t('map.cannotDraw')}</Typography>
                <Box component="ul" sx={{ m: 0, pl: 2.5, mb: 1.5 }}>
                    {parsed.errors.map(error => <Typography component="li" key={error} sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>{error}</Typography>)}
                </Box>
                {onAskFix && <Button size="small" variant="outlined" disabled={askedFix} onClick={() => { setAskedFix(true); onAskFix(parsed.errors); }}
                    sx={{ textTransform: 'none' }}>{askedFix ? t('map.askedFix') : t('map.askFix')}</Button>}
            </Box>
        </Box>;
    }
    const spec = parsed.spec;
    const footer = inputs.errors.length || inputs.truncated.length ? <Box>
        {inputs.errors.map(error => <Typography key={error} sx={{ fontSize: '0.68rem', color: 'error.main' }}>{error}</Typography>)}
        {inputs.truncated.map(name => <Typography key={name} sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>
            {t('map.firstRows', { count: MAP_ROW_LIMIT, formatted: MAP_ROW_LIMIT.toLocaleString(), name })}</Typography>)}
        {inputs.errors.length > 0 && onAskFix && <Button size="small" disabled={askedFix} onClick={() => { setAskedFix(true); onAskFix(inputs.errors); }}
            sx={{ textTransform: 'none', fontSize: '0.7rem', p: 0, minWidth: 0, mt: 0.25 }}>{askedFix ? t('map.askedFix') : t('map.askFix')}</Button>}
    </Box> : null;
    return <Box sx={{ position: 'relative', width: '100%', height: '100%', display: 'flex' }}>
        <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
            {inputs.loading && !Object.keys(inputs.geoSets).length
                ? <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}><Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>{t('map.loading')}</Typography></Box>
                : <MapView spec={spec} data={inputs.data} geoSets={inputs.geoSets} reserveTopRight={styleOpen ? 0 : 260} reserveBottomRight={styleOpen ? 0 : 28} footer={footer}
                    annotations={annotations} defaultTheme={defaultTheme} />}
            {parsed.warnings.length > 0 && !inputs.loading && <Alert severity="info" sx={{ position: 'absolute', top: 56, right: 16, maxWidth: 320, py: 0, fontSize: '0.75rem' }}>
                {parsed.warnings[0]}</Alert>}
        </Box>
        {styleOpen && <MapStylePanel source={source} spec={spec} data={inputs.data} readOnly={!onSourceChange}
            onChange={next => onSourceChange?.(next)} onClose={() => onStyleClose?.()} />}
    </Box>;
};

export default MapPreview;
