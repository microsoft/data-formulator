// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { memo } from 'react';

import {
    Box,
    Typography,
    Card,
    ButtonBase,
    IconButton,
    Tooltip,
    useTheme,
    alpha,
} from '@mui/material';

import { dfActions } from '../app/dfSlice';
import { DictTable } from "../components/ComponentType";

import DeleteIcon from '@mui/icons-material/Delete';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AddchartIcon from '@mui/icons-material/Addchart';

import { ComponentBorderStyle, shadow, sidebarRowActionSx, sidebarRowDangerActionSx } from '../app/tokens';
import { iconVar, textVar } from '../app/layout';


// ─── Chart Card ──────────────────────────────────────────────────────────────

export let buildChartCard = (
    chartElement: { tableId: string, chartId: string, element: any, onDelete?: () => void, deleteTooltip?: string, unread?: boolean },
    focusedChartId?: string,
) => {
    let selectedClassName = focusedChartId == chartElement.chartId ? 'selected-card' : '';
    const isUnread = !!chartElement.unread;
    return <Box
        className="data-thread-chart-card-wrapper"
        sx={{
            position: 'relative',
            display: 'flex',
            alignItems: 'flex-start',
            width: 'fit-content',
            mx: 1,
            '& .data-thread-chart-delete-btn-external': { opacity: 0, transition: 'opacity 0.15s' },
            '&:hover .data-thread-chart-delete-btn-external': { opacity: 1 },
            '@keyframes unreadPulse': {
                '0%, 100%': { transform: 'scale(1)', opacity: 0.75 },
                '50%': { transform: 'scale(1.2)', opacity: 1 },
            },
        }}>
        <Card className={`data-thread-card ${selectedClassName}`} elevation={0}
            sx={{
                width: 'fit-content',
                display: 'flex',
                position: 'relative',
                border: 'none',
                borderRadius: '6px',
                backgroundColor: 'transparent',
                zIndex: 1,
                overflow: 'hidden',
            }}>
            {chartElement.element}
            {isUnread && (
                <Box sx={{
                    position: 'absolute',
                    top: 5,
                    right: 5,
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: '#FFC107',
                    boxShadow: '0 0 4px rgba(255, 193, 7, 0.85), 0 0 1px rgba(0,0,0,0.25)',
                    pointerEvents: 'none',
                    zIndex: 2,
                    animation: 'unreadPulse 1.6s ease-in-out infinite',
                }} />
            )}
        </Card>
        {chartElement.onDelete && (
            <Tooltip title={chartElement.deleteTooltip ?? ''}>
                <IconButton
                    className="data-thread-chart-delete-btn-external"
                    size="small"
                    color="error"
                    aria-label={chartElement.deleteTooltip ?? 'delete chart'}
                    sx={{
                        alignSelf: 'flex-start',
                        ml: 0.25,
                        padding: 0.5,
                        flexShrink: 0,
                        '&:hover': { transform: 'scale(1.15)' },
                    }}
                    onClick={(event) => { event.stopPropagation(); chartElement.onDelete?.(); }}
                >
                    <DeleteIcon sx={{ fontSize: iconVar.md }} />
                </IconButton>
            </Tooltip>
        )}
    </Box>
}

/** Wrap chart elements as thumbnail rows under their table. */
export let buildChartCards = (
    relevantCharts: { tableId: string, chartId: string, element: any }[],
    focusedChartId: string | undefined,
    collapsed: boolean = false,
) => {
    let collapsedProps = collapsed ? { width: '50%', "& canvas": { width: 60, maxHeight: 50 } } : { width: '100%' };
    return relevantCharts.map((ce) =>
        <Box key={`relevant-chart-${ce.chartId}`}
            data-chart-id={ce.chartId}
            sx={{
                display: 'flex', padding: 0, ...collapsedProps }}>
            {buildChartCard(ce, focusedChartId)}
        </Box>);
}

/**
 * A card title that wraps to two lines. The full title shows above the card only when it is cut
 * off, so the tooltip never covers the card's actions or repeats a title that is fully visible.
 */
const ClampedTitle: React.FC<{ title: string }> = ({ title }) => {
    const [clamped, setClamped] = React.useState(false);
    return <Tooltip title={clamped ? title : ''} placement="top-start" enterDelay={500} disableInteractive>
        <Typography component="span" onMouseEnter={event => setClamped(event.currentTarget.scrollHeight > event.currentTarget.clientHeight + 1)}
            sx={{ fontSize: textVar.sm, color: 'text.primary', fontWeight: 500,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                overflowWrap: 'anywhere', lineHeight: 1.35 }}>{title}</Typography>
    </Tooltip>;
};

export const ThreadArtifactCard = ({ title, selected, onClick, notes, actions, artifactType, warning = false, preview, children }: {
    title: string;
    selected: boolean;
    onClick: () => void;
    notes?: string;
    actions?: React.ReactNode;
    artifactType: 'table' | 'file' | 'report' | 'app' | 'workflow';
    warning?: boolean;
    /** A small picture beside the title (a report's page, an app's window). */
    preview?: React.ReactNode;
    children?: React.ReactNode;
}) => {
    // Reports and apps are the agent's authored outputs: both purple, told apart by their icons.
    const tone = artifactType === 'report' || artifactType === 'app' ? 'secondary' : 'primary';
    return <Card
    className={`data-thread-card ${selected ? 'selected-artifact-card' : ''}`} elevation={0}
    sx={{ width: '100%', minWidth: 0, display: 'flex', alignItems: 'center', position: 'relative',
        ...ComponentBorderStyle, borderRadius: '6px',
        // The card's tint and the paper under it, so the actions can fade into the card's exact colour.
        '--artifact-paper': theme => theme.palette.background.paper,
        '--artifact-tint': theme => artifactType === 'file' || artifactType === 'workflow' ? 'transparent'
            : theme.palette[tone].bgcolor || alpha(theme.palette[tone].main, 0.08),
        backgroundColor: theme => artifactType === 'file' || artifactType === 'workflow' ? theme.palette.background.paper
            : theme.palette[tone].bgcolor || alpha(theme.palette[tone].main, 0.08),
        '--artifact-selection-color': theme => warning ? theme.palette.warning.main : theme.palette[tone].light,
        ...(warning ? { borderColor: 'warning.main', boxShadow: '0 0 0 1px var(--artifact-selection-color)' } : {}),
        '& .artifact-actions': { opacity: 0, transition: 'opacity 0.15s' },
        '&:hover .artifact-actions, &:focus-within .artifact-actions': { opacity: 1 },
        '@media (hover: none)': { '& .artifact-actions': { opacity: 1 } },
    }}>
    <ButtonBase disableRipple onClick={onClick} aria-label={children ? title : undefined} sx={{ flex: 1, minWidth: 0, alignSelf: 'stretch',
        display: 'block', textAlign: 'left', padding: '4px 8px 4px 6px',
        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: `${tone}.main`, outlineOffset: -2 },
    }}>
        <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, ...(preview ? { py: 0.25 } : {}) }}>
        {preview}
        <Box component="span" sx={{ display: 'block', flex: 1, minWidth: 0 }}>
        {children || <ClampedTitle title={title} />}
        {notes && <Typography component="span" sx={{ display: 'block', fontSize: textVar.xs,
            color: 'text.secondary', overflowWrap: 'anywhere' }}>{notes}</Typography>}
        </Box>
        </Box>
    </ButtonBase>
    {/* Actions float over the card's right edge, so the title keeps the full width; the title fades out under them. */}
    {actions && <Box className="artifact-actions" sx={{ display: 'flex', alignItems: 'center', position: 'absolute', zIndex: 1,
        top: 0, bottom: 0, right: 0, pl: 2.5, pr: 0.25, borderRadius: '0 6px 6px 0', pointerEvents: 'none',
        background: 'linear-gradient(to right, transparent, var(--artifact-tint) 20px), linear-gradient(to right, transparent, var(--artifact-paper) 20px)',
        '& > *': { pointerEvents: 'auto' },
        // A workflow card holds a tall summary; its actions stay in the top corner.
        ...(artifactType === 'workflow' ? { bottom: 'auto', pt: 0.25 } : {}),
    }}>{actions}</Box>}
</Card>;
};

export const ArtifactMenuButton = ({ label, tooltip = label, onClick }: {
    label: string;
    tooltip?: string;
    onClick: (anchorEl: HTMLElement) => void;
}) => <Tooltip title={tooltip}>
    <IconButton aria-label={label} size="small" sx={sidebarRowActionSx}
        onClick={event => { event.stopPropagation(); onClick(event.currentTarget); }}>
        <MoreVertIcon />
    </IconButton>
</Tooltip>;

export const ArtifactDeleteButton = ({ label, onClick, disabled = false }: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
}) => <Tooltip title={label}><span>
    <IconButton aria-label={label} size="small" disabled={disabled}
        sx={sidebarRowDangerActionSx} onClick={event => { event.stopPropagation(); onClick(); }}>
        <DeleteIcon />
    </IconButton>
</span></Tooltip>;

export let buildTableRefChip = (props: {
    tableId: string;
    loadedTableNodeId?: string;
    table: DictTable | undefined;
    focused: boolean;
    dispatch: any;
    onDelete?: () => void;
    deleteLabel?: string;
}) => {
    const { tableId, table, focused, dispatch } = props;
    return <Box key={`regular-table-box-${tableId}`}
        data-table-id={tableId}
        className="data-thread-card-wrapper"
        sx={{ padding: '0px', display: 'flex', alignItems: 'center', gap: '2px' }}>
        <ThreadArtifactCard artifactType="table" title={table?.displayId || tableId} selected={focused}
            onClick={() => dispatch(dfActions.setFocused(props.loadedTableNodeId
                ? { type: 'reference', referenceId: props.loadedTableNodeId }
                : { type: 'table', tableId }))}
            actions={props.onDelete && <ArtifactDeleteButton label={props.deleteLabel || 'Delete table'} onClick={props.onDelete} />} />
    </Box>
}

export interface ThreadChip {
    /** The thread item this chip stands for (a loaded-table or file node id), so focus can find and reveal it. */
    key: string;
    kind: 'table' | 'file';
    title: string;
    note?: string;
    /** Shown before the title; files carry their type's icon, tables none (the row's gutter says "tables"). */
    icon?: React.ReactNode;
    tableId?: string;
    selected: boolean;
    onClick: () => void;
    onDelete?: () => void;
    deleteLabel?: string;
    deleteDisabled?: boolean;
}

/** Rows of chips shown before a group folds; the rest open with "Show all". */
const CHIP_ROWS = 3;
const CHIP_GAP = 4;

/** Tables and documents brought in together, shown as one wrapping row of small chips instead of a card each;
 *  past three rows they fold, and open on click (or when one of the hidden chips is selected). */
export const ThreadChipGroup = ({ label, chips }: {
    label?: string;
    chips: ThreadChip[];
}) => {
    const rows = React.useRef<HTMLDivElement | null>(null);
    const [expanded, setExpanded] = React.useState(false);
    // The height of three rows, from a chip's own height; undefined until measured or when it all fits.
    const [foldHeight, setFoldHeight] = React.useState<number>();
    const [hiddenCount, setHiddenCount] = React.useState(0);
    React.useLayoutEffect(() => {
        const element = rows.current;
        if (!element) return;
        const measure = () => {
            const items = Array.from(element.children) as HTMLElement[];
            const rowHeight = items[0]?.offsetHeight ?? 0;
            const limit = rowHeight * CHIP_ROWS + CHIP_GAP * (CHIP_ROWS - 1);
            const hidden = items.filter(item => item.offsetTop - element.offsetTop >= limit).length;
            setFoldHeight(hidden ? limit : undefined);
            setHiddenCount(hidden);
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [chips.length]);
    const selectedHidden = !!foldHeight && chips.some((chip, index) => chip.selected
        && ((rows.current?.children[index] as HTMLElement | undefined)?.offsetTop ?? 0) - (rows.current?.offsetTop ?? 0) >= foldHeight);
    React.useEffect(() => { if (selectedHidden) setExpanded(true); }, [selectedHidden]);
    const folded = !!foldHeight && !expanded;
    return <Box data-thread-chips sx={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
    {label && <Typography sx={{ px: 0.5, fontSize: textVar.xs, color: 'text.secondary', lineHeight: 1.4 }}>{label}</Typography>}
    <Box ref={rows} sx={{ display: 'flex', flexWrap: 'wrap', gap: `${CHIP_GAP}px`, minWidth: 0,
        ...(folded && { maxHeight: foldHeight, overflow: 'hidden' }) }}>
        {chips.map(chip => <Box key={chip.key} data-thread-item={chip.key} data-table-id={chip.tableId} data-chip-kind={chip.kind}
            className={`data-thread-card ${chip.selected ? 'selected-artifact-card' : ''}`}
            sx={{
                position: 'relative', display: 'inline-flex', alignItems: 'center', minWidth: 0, maxWidth: '100%',
                ...ComponentBorderStyle, borderRadius: '4px',
                '--artifact-paper': theme => theme.palette.background.paper,
                // Tables are tinted, documents plain, as their full cards are.
                '--artifact-tint': theme => chip.kind === 'file' ? 'transparent'
                    : theme.palette.primary.bgcolor || alpha(theme.palette.primary.main, 0.08),
                '--artifact-selection-color': theme => theme.palette.primary.light,
                background: 'linear-gradient(var(--artifact-tint), var(--artifact-tint)), var(--artifact-paper)',
                '& .chip-delete': { opacity: 0, transition: 'opacity 0.15s' },
                '&:hover .chip-delete, &:focus-within .chip-delete': { opacity: 1 },
                '@media (hover: none)': { '& .chip-delete': { opacity: 1 } },
            }}>
            <ButtonBase disableRipple onClick={chip.onClick} title={chip.note ? `${chip.title} ${chip.note}` : chip.title}
                sx={{ minWidth: 0, maxWidth: '100%', px: '6px', py: '1px', gap: '3px', borderRadius: 'inherit', justifyContent: 'flex-start',
                    '& > svg': { flexShrink: 0 },
                    '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>
                {chip.icon}
                <Typography component="span" sx={{ minWidth: 0, fontSize: textVar.xs, fontWeight: 500, color: 'text.primary',
                    lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chip.title}</Typography>
                {chip.note && <Typography component="span" sx={{ ml: '2px', flexShrink: 0, fontSize: textVar.xxs,
                    color: 'text.secondary', lineHeight: 1.5 }}>{chip.note}</Typography>}
            </ButtonBase>
            {/* Floats over the chip's right edge on hover, so chips keep their size. */}
            {chip.onDelete && <Tooltip title={chip.deleteLabel || ''}>
                <span style={{ position: 'absolute', right: 1, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
                    <IconButton className="chip-delete" size="small" color="error" aria-label={chip.deleteLabel}
                        disabled={chip.deleteDisabled}
                        onClick={event => { event.stopPropagation(); chip.onDelete?.(); }}
                        sx={{ p: '1px',
                            background: 'linear-gradient(var(--artifact-tint), var(--artifact-tint)), var(--artifact-paper)', '&:hover': { background: theme => {
                                const hover = alpha(theme.palette.error.main, 0.14);
                                return `linear-gradient(${hover}, ${hover}), var(--artifact-paper)`;
                            } } }}>
                        <DeleteIcon sx={{ fontSize: iconVar.sm }} />
                    </IconButton>
                </span>
            </Tooltip>}
        </Box>)}
    </Box>
    {foldHeight !== undefined && <ButtonBase disableRipple onClick={() => setExpanded(open => !open)} aria-expanded={expanded}
        sx={{ alignSelf: 'flex-start', px: 0.5, fontSize: textVar.xs, color: 'primary.main', borderRadius: '4px',
            '&:hover': { textDecoration: 'underline' } }}>
        {expanded ? 'Show less' : `Show all (${hiddenCount} more)`}
    </ButtonBase>}
</Box>;
};

// ─── Table Card ──────────────────────────────────────────────────────────────

export interface BuildTableCardProps {
    tableId: string;
    tables: DictTable[];
    chartElements: { tableId: string, chartId: string, element: any }[];
    usedIntermediateTableIds: string[];
    highlightedTableIds: string[];
    focusedTableId: string | undefined;
    focusedChartId: string | undefined;
    parentTable: DictTable | undefined;
    tableIdList: string[];
    collapsed: boolean;
    dispatch: any;
    /** Only the source-table shelf offers a table menu; thread cards omit it. */
    handleOpenTableMenu?: (table: DictTable, anchorEl: HTMLElement) => void;
    /** i18n `t` from `useTranslation()` */
    t: (key: string, options?: Record<string, unknown>) => string;
    /** Whether source cards show their original name alongside the workspace identifier. */
    showOriginalName?: boolean;
}

export let buildTableCard = (props: BuildTableCardProps) => {
    const {
        tableId, tables, chartElements, usedIntermediateTableIds,
        highlightedTableIds, focusedTableId, focusedChartId,
        parentTable, tableIdList, collapsed, dispatch,
        handleOpenTableMenu, t, showOriginalName = true,
    } = props;

    const getOriginalName = (tbl: DictTable | undefined): string | null => {
        if (!tbl || tbl.derive) return null;
        return tbl.source?.originalTableName || tbl.virtual?.tableId || tbl.id;
    };

    // filter charts relevant to this
    let relevantCharts = chartElements.filter(ce => ce.tableId == tableId && !usedIntermediateTableIds.includes(tableId));

    let table = tables.find(t => t.id == tableId);
    const originalName = getOriginalName(table);
    const friendlyName = table?.displayId || tableId;
    const normalizeTableName = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, '');
    const rawName = showOriginalName
        && originalName
        && normalizeTableName(originalName) !== normalizeTableName(friendlyName)
        ? originalName
        : null;

    let collapsedProps = collapsed ? { width: '50%', "& canvas": { width: 60, maxHeight: 50 } } : { width: '100%' }

    let releventChartElements = relevantCharts.map((ce, j) =>
        <Box key={`relevant-chart-${ce.chartId}`}
            data-chart-id={ce.chartId}
            sx={{ 
                display: 'flex', padding: 0, ...collapsedProps }}>
            {buildChartCard(ce, focusedChartId)}
        </Box>)

    let regularTableBox = <Box key={`regular-table-box-${tableId}`}
        data-table-id={tableId}
        className="data-thread-card-wrapper"
        sx={{ padding: '0px', display: 'flex', alignItems: 'center', gap: '2px' }}>
            <Box sx={{ display: 'flex', width: '100%', minWidth: 0 }}>
            <ThreadArtifactCard artifactType="table" title={friendlyName} notes={rawName || undefined}
                selected={tableId === focusedTableId}
                onClick={() => dispatch(dfActions.setFocused({ type: 'table', tableId }))}
                actions={<>
                {!table?.derive && handleOpenTableMenu && (
                    <ArtifactMenuButton label={t('dataThread.moreOptions')}
                        onClick={anchorEl => handleOpenTableMenu(table!, anchorEl)} />
                )}
                {table?.derive && <ArtifactDeleteButton label={t('dataThread.deleteTable')}
                    onClick={() => dispatch(dfActions.deleteTable(tableId))} />}
                </>} />
            </Box>
    </Box>

    return [
        regularTableBox,
        ...releventChartElements,
    ]
}
