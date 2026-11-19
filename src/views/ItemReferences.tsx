// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Items referred to by name in agent messages and reports (design-docs/74): `![caption](name)` draws the item
 * in place (a chart, a table's first rows, a map, an image) or, when it has no picture, links to it;
 * `[text](name)` opens it on the canvas. A name the session does not have shows as its caption or text.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import { getCachedChart } from '../app/chartCache';
import { findTableByName, isImagePath, isMapPath, itemFocus, workspaceFileName, type ItemTarget } from '../app/itemNames';
import { fetchWithIdentity, getUrls } from '../app/utils';
import { downloadWorkspaceFile } from '../app/workspaceService';
import { borderColor } from '../app/tokens';
import { textVar } from '../app/layout';
import { TablePreview } from '../components/AttachmentPreview';

export const markdownImageSx = {
    display: 'block', width: 'auto', height: 'auto',
    maxWidth: 'min(100%, 320px)', maxHeight: 200, objectFit: 'contain',
} as const;

/** Opening an item from a link: the action for what a name refers to, or undefined when the session has no such item. */
export function useItemOpener(): (target: ItemTarget | null) => (() => void) | undefined {
    const dispatch = useDispatch();
    const tables = useSelector(dfSelectors.getAllTables);
    const charts = useSelector(dfSelectors.getAllCharts);
    const reports = useSelector((state: DataFormulatorState) => state.generatedReports);
    const references = useSelector((state: DataFormulatorState) => state.externalTableReferences);
    const graph = useSelector(dfSelectors.getThreadGraph);
    return useCallback((target: ItemTarget | null) => {
        const focus = itemFocus(target, { tables, charts, reports, references, graph });
        if (!focus) return undefined;
        return () => {
            dispatch(dfActions.setFocused(focus));
            if (focus.type === 'report') dispatch(dfActions.setViewMode('report'));
        };
    }, [dispatch, tables, charts, reports, references, graph]);
}

/** `[text](name)`: opens the item it names; plain text when the session has no such item. `canOpen` holds a click
 *  (an editor in edit mode). */
export const ItemLink: React.FC<{ href: string; target: ItemTarget; canOpen?: () => boolean; children?: React.ReactNode }> = ({
    href, target, canOpen, children,
}) => {
    const open = useItemOpener()(target);
    if (!open) return <Box component="span" data-item-missing>{children}</Box>;
    return <Box component="a" href={href} onClick={(event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (!canOpen || canOpen()) open();
    }} sx={{ color: 'primary.main', textDecoration: 'underline', overflowWrap: 'anywhere' }}>{children}</Box>;
};

export const MarkdownChartImage: React.FC<{ chartId: string; alt?: string }> = ({ chartId, alt }) => {
    const thumbnail = useSelector(dfSelectors.getChartThumbnail(chartId));
    const cached = getCachedChart(chartId);
    const src = cached?.fullPngDataUrl || thumbnail || cached?.thumbnailDataUrl;
    return src
        ? <Box component="img" src={src} alt={alt || chartId} data-chart-id={chartId}
            sx={markdownImageSx} />
        : <Box component="span" role="img" aria-label={alt || chartId} data-chart-id={chartId}
            sx={{ color: 'text.secondary' }}>{alt || chartId}</Box>;
};

// Map embeds draw offscreen with the map renderer, loaded only when a message embeds one.
const MapSnapshot = React.lazy(() => import('../maps/MapSnapshot'));
/** Map pictures already drawn for messages, by path, so a message drawn again does not redraw its maps. */
const messageMapImages = new Map<string, string>();

export const MarkdownMapImage: React.FC<{ path: string; alt?: string }> = ({ path, alt }) => {
    const [src, setSrc] = useState(() => messageMapImages.get(path));
    const [failed, setFailed] = useState(false);
    if (src) return <Box component="img" src={src} alt={alt || path} sx={markdownImageSx} />;
    return <Box component="span" role="img" aria-label={alt || path} sx={{ color: 'text.secondary' }}>
        {alt || path}
        {!failed && <React.Suspense fallback={null}>
            <MapSnapshot path={path} onImage={image => { messageMapImages.set(path, image.url); setSrc(image.url); }} onError={() => setFailed(true)} />
        </React.Suspense>}
    </Box>;
};

// One fetch per image file for the page's life.
const workspaceImages = new Map<string, Promise<string | null>>();
const loadWorkspaceImage = (path: string): Promise<string | null> => {
    let load = workspaceImages.get(path);
    if (!load) {
        load = (async () => {
            const blob = path.startsWith('scratch/')
                ? await fetchWithIdentity(`${getUrls().SCRATCH_BASE_URL}/${path.slice('scratch/'.length).split('/').map(encodeURIComponent).join('/')}`)
                    .then(response => response.ok ? response.blob() : null)
                : await downloadWorkspaceFile(workspaceFileName(path));
            return blob ? URL.createObjectURL(blob) : null;
        })().catch(() => null);
        workspaceImages.set(path, load);
    }
    return load;
};

/** An image file of the workspace, read with the user's identity; its link while it loads or if it cannot. */
const WorkspaceImage: React.FC<{ href: string; target: Extract<ItemTarget, { kind: 'file' }>; alt?: string; canOpen?: () => boolean }> = ({
    href, target, alt, canOpen,
}) => {
    const [src, setSrc] = useState<string | null>();
    useEffect(() => {
        let live = true;
        loadWorkspaceImage(target.path).then(url => { if (live) setSrc(url); });
        return () => { live = false; };
    }, [target.path]);
    return src
        ? <Box component="img" src={src} alt={alt || target.path} sx={markdownImageSx} />
        : <ItemLink href={href} target={target} canOpen={canOpen}>{alt || target.path}</ItemLink>;
};

/** A table's header and first rows (as many as the session holds), with the caption under them. */
const TableEmbed: React.FC<{ name: string; alt?: string }> = ({ name, alt }) => {
    const table = useSelector((state: DataFormulatorState) => findTableByName(dfSelectors.getAllTables(state), name));
    if (!table) return <Box component="span" role="img" aria-label={alt || name} sx={{ color: 'text.secondary' }}>{alt || name}</Box>;
    return <Box role="figure" aria-label={alt || table.displayId || table.id} data-table-id={table.id} sx={{
        display: 'inline-block', maxWidth: '100%', overflowX: 'auto', my: 0.5, px: 1, py: 0.75,
        border: `1px solid ${borderColor.component}`, borderRadius: 1.5,
    }}>
        <TablePreview tableId={table.id} rows={5} columns={6} />
        {alt && <Typography sx={{ mt: 0.5, fontSize: textVar.xxs, color: 'text.secondary' }}>{alt}</Typography>}
    </Box>;
};

/** Whether an embed of this target draws as a block (a paragraph holding it cannot be a `<p>`). */
export const isBlockEmbed = (target: ItemTarget | null): boolean => target?.kind === 'table';

/** `![caption](name)`: the item drawn in place, or a link to it when it has no picture. */
export const ItemEmbed: React.FC<{ src: string; target: ItemTarget; alt?: string; canOpen?: () => boolean }> = ({
    src, target, alt, canOpen,
}) => {
    switch (target.kind) {
        case 'chart': return <MarkdownChartImage chartId={target.id} alt={alt} />;
        case 'table': return <TableEmbed name={target.name} alt={alt} />;
        case 'web': return <Box component="img" src={target.url} alt={alt} sx={markdownImageSx} />;
        case 'file':
            if (isMapPath(target.path)) return <MarkdownMapImage path={target.path} alt={alt} />;
            if (isImagePath(target.path)) return <WorkspaceImage href={src} target={target} alt={alt} canOpen={canOpen} />;
            break;
    }
    return <ItemLink href={src} target={target} canOpen={canOpen}>{alt || src}</ItemLink>;
};
