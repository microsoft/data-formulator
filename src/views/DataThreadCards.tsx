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
import { DictTable, Trigger } from "../components/ComponentType";

import DeleteIcon from '@mui/icons-material/Delete';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AddchartIcon from '@mui/icons-material/Addchart';

import { TriggerCard } from './EncodingShelfCard';
import { ComponentBorderStyle, shadow } from '../app/tokens';
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

export const ThreadArtifactCard = ({ title, selected, onClick, notes, actions, artifactType, warning = false, children }: {
    title: string;
    selected: boolean;
    onClick: () => void;
    notes?: string;
    actions?: React.ReactNode;
    artifactType: 'table' | 'file' | 'report' | 'workflow';
    warning?: boolean;
    children?: React.ReactNode;
}) => {
    const tone = artifactType === 'report' ? 'secondary' : 'primary';
    return <Card
    className={`data-thread-card ${selected ? 'selected-artifact-card' : ''}`} elevation={0}
    sx={{ width: '100%', minWidth: 0, display: 'flex', alignItems: 'center', position: 'relative',
        ...ComponentBorderStyle, borderRadius: '6px',
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
        {children || <Typography component="span" sx={{ fontSize: textVar.sm, color: 'text.primary', fontWeight: 500,
            display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</Typography>}
        {notes && <Typography component="span" sx={{ display: 'block', fontSize: textVar.xs,
            color: 'text.secondary', overflowWrap: 'anywhere' }}>{notes}</Typography>}
    </ButtonBase>
    {actions && <Box className="artifact-actions" sx={{ display: 'flex', flexShrink: 0, pr: 0.25,
        ...(artifactType === 'workflow' ? { position: 'absolute', top: 2, right: 2 } : {}),
    }}>{actions}</Box>}
</Card>;
};

export const ArtifactMenuButton = ({ label, tooltip = label, onClick }: {
    label: string;
    tooltip?: string;
    onClick: (anchorEl: HTMLElement) => void;
}) => <Tooltip title={tooltip}>
    <IconButton aria-label={label} size="small" sx={{ p: 0.25, color: 'text.secondary' }}
        onClick={event => { event.stopPropagation(); onClick(event.currentTarget); }}>
        <MoreVertIcon sx={{ fontSize: iconVar.md }} />
    </IconButton>
</Tooltip>;

export const ArtifactDeleteButton = ({ label, onClick, disabled = false }: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
}) => <Tooltip title={label}><span>
    <IconButton aria-label={label} size="small" color="error" disabled={disabled}
        sx={{ p: 0.5 }} onClick={event => { event.stopPropagation(); onClick(); }}>
        <DeleteIcon sx={{ fontSize: iconVar.md }} />
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

// ─── Trigger Card Wrapper ────────────────────────────────────────────────────

export let buildTriggerCard = (
    trigger: Trigger,
    focusedChartId: string | undefined,
    highlighted: boolean = false,
    dimmed: boolean = false,
) => {
    let selectedClassName = trigger.chart?.id == focusedChartId ? 'selected-card' : '';
    
    let triggerCard = <div key={'thread-card-trigger-box'}>
        <Box sx={{ flex: 1 }} >
            <TriggerCard className={selectedClassName} trigger={trigger} 
                hideFields={!!(trigger.interaction && trigger.interaction.length > 0)} 
                highlighted={highlighted}
                sx={{
                    '& .MuiBox-root': { mx: 0.5, my: 0.25 },
                    '& .MuiSvgIcon-root': { width: '12px', height: '12px' },
                }}
            />
        </Box>
    </div>;

    return <Box sx={{ display: 'flex', flexDirection: 'column' }} key={`trigger-card-${trigger.chart?.id}`}>
        {triggerCard}
    </Box>;
}

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
