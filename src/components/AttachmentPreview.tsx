// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A preview of what a message carries, shown beside its chip on hover (or pinned open by a click): an attached image
 * or the first lines of an attached text file (both read from the workspace's scratch/ folder), or a table the
 * message refers to.
 */

import React, { useEffect, useState } from 'react';
import { Box, ClickAwayListener, Tooltip, Typography, alpha } from '@mui/material';
import type { TooltipProps } from '@mui/material';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { DataFormulatorState, dfSelectors } from '../app/dfSlice';
import { fetchWithIdentity, getUrls } from '../app/utils';
import { textVar } from '../app/layout';
import { weight } from '../app/tokens';

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const TEXT = /\.(csv|tsv|txt|md|markdown|json|log|py|sql|xml|ya?ml)$/i;
const TEXT_LINES = 12;

type Loaded = { kind: 'image'; url: string } | { kind: 'text'; text: string } | { kind: 'none' };

// One fetch per file for the page's life: hovering a chip again shows it at once.
const loads = new Map<string, Promise<Loaded>>();

const loadScratch = (path: string): Promise<Loaded> => {
    let load = loads.get(path);
    if (!load) {
        const name = path.replace(/^scratch\//, '');
        const url = `${getUrls().SCRATCH_BASE_URL}/${name.split('/').map(encodeURIComponent).join('/')}`;
        load = (async (): Promise<Loaded> => {
            const response = await fetchWithIdentity(url);
            if (!response.ok) return { kind: 'none' };
            if (IMAGE.test(name)) return { kind: 'image', url: URL.createObjectURL(await response.blob()) };
            if (TEXT.test(name)) return { kind: 'text', text: (await response.text()).split('\n').slice(0, TEXT_LINES).join('\n') };
            return { kind: 'none' };
        })().catch(() => ({ kind: 'none' as const }));
        loads.set(path, load);
    }
    return load;
};

/** A floating card, as the follow-up callout: paper, a faint hairline and a soft shadow, in either contrast. */
const cardSlotProps: TooltipProps['slotProps'] = {
    tooltip: { sx: theme => ({
        bgcolor: 'background.paper', color: 'text.primary', maxWidth: 340, p: 1, borderRadius: 2,
        border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
        boxShadow: '0 8px 24px rgba(32, 33, 36, 0.14), 0 2px 6px rgba(32, 33, 36, 0.08)',
    }) },
};

/** An attachment: an image (with when it was sent, at the bottom right), the first lines of a text file, or just its
 *  name when it has no preview. */
export const AttachmentPreview: React.FC<{ name: string; path?: string; sentAt?: number }> = ({ name, path, sentAt }) => {
    const { t, i18n } = useTranslation();
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    useEffect(() => {
        let live = true;
        if (path) loadScratch(path).then(result => { if (live) setLoaded(result); });
        return () => { live = false; };
    }, [path]);
    const unavailable = !path || loaded?.kind === 'none';
    const time = loaded?.kind === 'image' && sentAt ? new Date(sentAt).toLocaleString(i18n.language,
        { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : undefined;
    return <Box sx={{ minWidth: 120 }}>
        {loaded?.kind === 'image' && <Box component="img" src={loaded.url} alt={name}
            sx={{ display: 'block', maxWidth: 320, maxHeight: 240, borderRadius: 1, mb: 0.5 }} />}
        {loaded?.kind === 'text' && <Box component="pre" sx={{ m: 0, mb: 0.5, p: 0.75, maxWidth: 320, maxHeight: 200, overflow: 'hidden',
            fontSize: textVar.xxs, lineHeight: 1.45, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            whiteSpace: 'pre', bgcolor: theme => alpha(theme.palette.text.primary, 0.04), borderRadius: 1 }}>{loaded.text}</Box>}
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
            <Typography sx={{ flex: 1, minWidth: 0, fontSize: textVar.xs, color: 'text.secondary', overflowWrap: 'anywhere' }}>
                {name}{unavailable ? ` · ${t('chartRec.attachmentNoPreview', { defaultValue: 'no preview' })}` : ''}
            </Typography>
            {time && <Typography sx={{ flexShrink: 0, fontSize: textVar.xxs, color: 'text.disabled', whiteSpace: 'nowrap' }}>{time}</Typography>}
        </Box>
    </Box>;
};

/** Hover shows the preview; a click pins it open (for touch, or to keep it while reading) until a click elsewhere. */
export const PreviewTooltip: React.FC<{ title: React.ReactNode; pinnable?: boolean; children: React.ReactElement }> =
    ({ title, pinnable = false, children }) => {
        const [hover, setHover] = useState(false);
        const [pinned, setPinned] = useState(false);
        const anchor = <Tooltip title={title} placement="top-start" enterDelay={250} enterNextDelay={150} slotProps={cardSlotProps}
            open={hover || pinned} onOpen={() => setHover(true)} onClose={() => setHover(false)}>
            {pinnable ? React.cloneElement(children as React.ReactElement<any>, {
                onClick: (event: React.MouseEvent) => { event.stopPropagation(); setPinned(open => !open); },
            }) : children}
        </Tooltip>;
        return pinnable ? <ClickAwayListener onClickAway={() => setPinned(false)}><span style={{ display: 'contents' }}>{anchor}</span></ClickAwayListener> : anchor;
    };

const PREVIEW_ROWS = 4;
const PREVIEW_COLUMNS = 4;

/** A table a message refers to: its size and its first rows and columns. */
export const TablePreview: React.FC<{ tableId: string; rows?: number; columns?: number }> = ({
    tableId, rows: shownRows = PREVIEW_ROWS, columns: shownColumns = PREVIEW_COLUMNS,
}) => {
    const { t } = useTranslation();
    const table = useSelector((state: DataFormulatorState) => dfSelectors.getAllTables(state).find(item => item.id === tableId));
    if (!table) return null;
    const rowCount = table.virtual?.rowCount ?? table.rows.length;
    const columns = table.names.slice(0, shownColumns);
    const cell = { px: 0.75, py: 0.25, fontSize: textVar.xxs, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110,
        borderBottom: (theme: any) => `1px solid ${alpha(theme.palette.text.primary, 0.08)}`, textAlign: 'left' } as const;
    return <Box sx={{ minWidth: 160 }}>
        <Typography sx={{ fontSize: textVar.xs, fontWeight: weight(600), mb: 0.25 }}>{table.displayId || table.id}</Typography>
        <Typography sx={{ fontSize: textVar.xxs, color: 'text.secondary', mb: 0.75 }}>
            {t('chartRec.tablePreviewSize', { defaultValue: '{{rows}} rows · {{columns}} columns',
                rows: rowCount.toLocaleString(), columns: table.names.length })}
        </Typography>
        <Box component="table" sx={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead><tr>{columns.map(name => <Box component="th" key={name} sx={{ ...cell, fontWeight: weight(600) }}>{name}</Box>)}
                {table.names.length > shownColumns && <Box component="th" sx={{ ...cell, color: 'text.secondary' }}>…</Box>}</tr></thead>
            <tbody>{table.rows.slice(0, shownRows).map((row, index) => <tr key={index}>
                {columns.map(name => <Box component="td" key={name} sx={cell}>{String(row?.[name] ?? '')}</Box>)}
                {table.names.length > shownColumns && <Box component="td" sx={cell} />}
            </tr>)}</tbody>
        </Box>
    </Box>;
};
