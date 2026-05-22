// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next';
import { transition } from '../app/tokens';
import { useSelector, useDispatch } from 'react-redux'
import { DataFormulatorState, dfActions, dfSelectors, generateFreshChart } from '../app/dfSlice';

import { AppDispatch } from '../app/store';

import {
    Box,
    Tooltip,
    Typography,
    SxProps,
    LinearProgress,
    alpha,
    useTheme,
    Theme,
} from '@mui/material';

import React from 'react';

import { Chart } from "../components/ComponentType";

import '../scss/EncodingShelf.scss';

import { resolveRecommendedChart } from '../app/utils';
import { useFormulateData } from '../app/useFormulateData';

import { TableIcon } from '../icons';
import { renderTextWithEmphasis } from './EncodingShelfCard';
import { getChartTemplate } from '../components/ChartTemplates';
import { generateChartSkeleton } from './ChartUtils';

// when this is set to true, the new chart will be focused automatically
const AUTO_FOCUS_NEW_CHART = false;

export interface ChartRecBoxProps {
    tableId: string;
    placeHolderChartId?: string;
    sx?: SxProps;
}

export const IdeaChip: FC<{
    mini?: boolean,
    idea: {text?: string, goal: string, tag?: string, type?: 'branch' | 'deep_dive'} 
    theme: Theme, 
    onClick: () => void, 
    sx?: SxProps,
    disabled?: boolean,
}> = function ({mini, idea, theme, onClick, sx, disabled}) {

    const accentColor = theme.palette.text.primary;
    const tagLabel = idea.tag ? `(${idea.tag})` : '';
    const ideaText = idea.goal;

    const ideaTextComponent = renderTextWithEmphasis(ideaText, {
        borderRadius: '0px',
        fontSize: '11px',
        lineHeight: 1.4,
        backgroundColor: alpha(accentColor, 0.04),
    });

    return (
        <Box
            component="button"
            type="button"
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            sx={{
                position: 'relative',
                display: 'inline-block',
                textAlign: 'left',
                px: '8px',
                py: '4px',
                fontSize: 11,
                lineHeight: 1.4,
                color: accentColor,
                fontFamily: theme.typography.fontFamily,
                borderRadius: '6px',
                border: `1px solid ${alpha(accentColor, 0.12)}`,
                backgroundColor: theme.palette.background.paper,
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                whiteSpace: 'normal',
                wordBreak: 'break-word',
                transition: transition.fast,
                '&:hover': disabled ? undefined : {
                    backgroundColor: alpha(accentColor, 0.06),
                },
                ...sx
            }}
        >
            {tagLabel && (
                <Typography
                    component="span"
                    sx={{
                        fontSize: 11,
                        color: theme.palette.text.secondary,
                        mr: '4px',
                    }}
                >
                    {tagLabel}
                </Typography>
            )}
            <Typography component="span" sx={{ fontSize: 11, color: accentColor }}>
                {ideaTextComponent}
            </Typography>
        </Box>
    );
};

export const ChartRecBox: FC<ChartRecBoxProps> = function ({ tableId, placeHolderChartId, sx }) {
    const dispatch = useDispatch<AppDispatch>();
    const { t } = useTranslation();
    const theme = useTheme();

    // reference to states
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const allCharts = useSelector(dfSelectors.getAllCharts);
    const { formulateData } = useFormulateData();

    const focusNextChartRef = useRef<boolean>(true);

    const modeColor = theme.palette.secondary.main;

    const [isFormulating, setIsFormulating] = useState<boolean>(false);

    // Use the provided tableId and find additional available tables for multi-table operations
    const currentTable = tables.find(t => t.id === tableId);

    // All root/anchored tables, with current source tables ordered first for context priority
    const rootTables = tables.filter(t => t.derive === undefined || t.anchored);
    const priorityIds = (currentTable?.derive && !currentTable.anchored)
        ? currentTable.derive.source
        : [tableId];
    let selectedTableIds = [
        ...priorityIds.filter(id => rootTables.some(t => t.id === id)),
        ...rootTables.map(t => t.id).filter(id => !priorityIds.includes(id))
    ];

    const deriveDataFromNL = (instruction: string) => {

        if (selectedTableIds.length === 0 || instruction.trim() === "") {
            return;
        }

        if (placeHolderChartId) {
            dispatch(dfActions.changeChartRunningStatus({chartId: placeHolderChartId, status: true}));
        }

        const actionId = `deriveDataFromNL_${String(Date.now())}`;

        // Validate table selection
        const firstTableId = selectedTableIds[0];
        if (!firstTableId) {
            dispatch(dfActions.addMessages({
                "timestamp": Date.now(),
                "type": "error",
                "component": "chart builder",
                "value": "No table selected for data formulation.",
            }));
            return;
        }

        let refChart = generateFreshChart(tableId, 'Auto') as Chart;
        refChart.source = 'trigger';

        formulateData({
            instruction,
            mode: 'formulate',
            actionTableIds: selectedTableIds,
            currentTable: currentTable!,
            triggerChart: refChart,
            createChart: ({ candidateTable, refinedGoal, currentConcepts }) => {
                let newChart = resolveRecommendedChart(refinedGoal, currentConcepts, candidateTable);
                dispatch(dfActions.addChart(newChart));
                if (focusNextChartRef.current || AUTO_FOCUS_NEW_CHART) {
                    focusNextChartRef.current = false;
                    dispatch(dfActions.setFocused({ type: 'chart', chartId: newChart.id }));
                }
                return newChart.id;
            },
            onStarted: () => {
                setIsFormulating(true);
            },
            onSuccess: ({ displayInstruction, candidateTable }) => {
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "component": "chart builder",
                    "type": "success",
                    "value": `Data formulation: "${displayInstruction}"`
                }));
            },
            onError: () => {
            },
            onFinally: () => {
                setIsFormulating(false);
                if (placeHolderChartId) {
                    dispatch(dfActions.changeChartRunningStatus({chartId: placeHolderChartId, status: false}));
                }
            },
        });
    };

    return (
        <Box sx={{ maxWidth: "720px", width: '100%', display: 'flex', flexDirection: 'column', position: 'relative', ...sx }}>
            {isFormulating && (
                <LinearProgress
                    sx={{
                        position: 'absolute', top: -2, left: 0, right: 0,
                        height: '2px', borderRadius: '2px',
                        backgroundColor: alpha(modeColor, 0.15),
                        '& .MuiLinearProgress-bar': { backgroundColor: modeColor },
                    }}
                />
            )}
            {currentTable && (() => {
                // Unified provenance ribbon + chart strip:
                //   row 1 = the trigger chain (… ▸ grandparent ▸ parent ▸ THIS ▸ child1, child2 ▸ …)
                //   row 2 = a chart-thumbnail cluster directly under each
                //           table label that owns charts.
                //
                // We use a single CSS grid with one column per ribbon item so
                // the cluster for table X is always horizontally aligned with
                // X's label. The entire grid is then centered inside the
                // container, so the ribbon as a whole reads as balanced
                // regardless of whether the current table sits near one end
                // of the chain (e.g. a root like "gas-prices").
                const parent = currentTable.derive?.trigger?.tableId
                    ? tables.find(t => t.id === currentTable.derive!.trigger.tableId)
                    : undefined;
                const grandparent = parent?.derive?.trigger?.tableId
                    ? tables.find(t => t.id === parent.derive!.trigger.tableId)
                    : undefined;
                const hasGreatGrandparent = !!grandparent?.derive?.trigger?.tableId;
                const children = tables.filter(t => t.derive?.trigger?.tableId === currentTable.id);

                const ancestors = [grandparent, parent].filter(Boolean) as typeof tables;

                // Symmetric reach: when the current node sits at an end of
                // the lineage, extend further into the available direction
                // so we always show up to 3 neighbours total.
                //
                //  • At the root (no ancestors) with a single child: also
                //    surface the grandchild(ren) as additional right-chain
                //    entries.  This turns "Movie Performance → Movie
                //    Budgets Gross → …" into "Movie Performance → Movie
                //    Budgets Gross → Genre ROI Summary".
                //  • At a leaf (no children) we already display two
                //    ancestors; if there's only a parent, also surface
                //    the great-grandparent so we still show 3 nodes.
                let extraDescendants: typeof tables = [];
                if (ancestors.length === 0 && children.length === 1) {
                    extraDescendants = tables.filter(t => t.derive?.trigger?.tableId === children[0].id);
                }
                const greatGrandparent = hasGreatGrandparent
                    ? tables.find(t => t.id === grandparent!.derive!.trigger.tableId)
                    : undefined;
                if (children.length === 0 && ancestors.length === 1 && greatGrandparent) {
                    ancestors.unshift(greatGrandparent);
                }
                // Is there still an unseen node above our topmost ancestor?
                const topAncestor = ancestors[0];
                const hasHiddenAncestor = !!topAncestor?.derive?.trigger?.tableId;

                if (ancestors.length === 0 && children.length === 0) return null;

                // ── chart filtering ────────────────────────────────────────
                // Drop:
                //  • the empty-canvas placeholder chart that's rendering us,
                //  • trigger-source stubs (virtual metadata merged in by
                //    `selectTriggerCharts` — they have no real thumbnail),
                //  • placeholder chart types that never render to PNG.
                const chartsForTable = (tid: string) => allCharts.filter(c =>
                    c.tableRef === tid
                    && c.id !== placeHolderChartId
                    && c.source !== 'trigger'
                    && !['Auto', '?'].includes(c.chartType)
                );

                // ── ribbon atoms ───────────────────────────────────────────
                const TableRef: FC<{ table: typeof currentTable, current?: boolean }> = ({ table, current }) => (
                    <Box
                        component={current ? 'span' : 'button'}
                        type={current ? undefined : 'button'}
                        onClick={current ? undefined : () => dispatch(dfActions.setFocused({ type: 'table', tableId: table.id }))}
                        sx={{
                            display: 'inline-flex', alignItems: 'center', gap: current ? '6px' : '3px',
                            border: 'none', background: 'transparent', p: 0,
                            fontFamily: theme.typography.fontFamily,
                            fontSize: current ? 16 : 11, lineHeight: 1.4,
                            color: current ? 'primary.main' : 'text.secondary',
                            fontWeight: current ? 600 : 400,
                            cursor: current ? 'default' : 'pointer',
                            whiteSpace: 'nowrap',
                            transition: transition.fast,
                            '&:hover': current ? undefined : { color: 'primary.main' },
                        }}
                    >
                        <TableIcon sx={{ fontSize: current ? 16 : 12, color: 'inherit' }} />
                        {table.displayId}
                    </Box>
                );
                const Sep = () => (
                    // Solid 1px connector line — mirrors the timeline guide
                    // lines used in DataThread to express "this flows into
                    // that" rather than a generic "next item" arrow.
                    <Box sx={{
                        width: 24, height: '1px',
                        backgroundColor: 'rgba(0,0,0,0.2)',
                    }} />
                );
                const Ellipsis = () => (
                    <Typography component="span" sx={{ fontSize: 11, color: 'text.disabled' }}>…</Typography>
                );
                const Comma = () => (
                    <Typography component="span" sx={{ fontSize: 11, color: 'text.disabled', mx: '3px' }}>,</Typography>
                );

                // ── progressive truncation (same heuristic as before) ──────
                // Estimates per-item width and sheds entries from the longer
                // chain until the whole ribbon fits in BUDGET.
                const charW = 7;
                const currentCharW = 10;
                const ITEM_OVERHEAD = 22;
                const CURRENT_OVERHEAD = 28;
                const SEP_W = 16;
                const ELLIPSIS_W = 12;
                const BUDGET = 680;

                const estW = (table: typeof currentTable) =>
                    ITEM_OVERHEAD + (table?.displayId.length ?? 0) * charW;
                const currentW = CURRENT_OVERHEAD + currentTable.displayId.length * currentCharW;

                // When there are 2+ children we abandon the inline
                // comma-chain and render them as a vertical fan to the
                // right of the current node — each branch sits on its own
                // short rail with its label + inline stack chip.
                const useChildrenFan = children.length >= 2;
                // The fan is a vertical stack of branches, so its width is
                // governed by the LONGEST single branch — not the sum of
                // children.  Estimate: elbow stub + label padding + label
                // glyphs + optional grandchild ellipsis affordance.  This
                // replaces the old fixed FAN_W = 280 which overestimated
                // and caused ancestors to be shed unnecessarily.
                const fanBranchW = (t: typeof currentTable) => {
                    const labelW = (t?.displayId.length ?? 0) * charW;
                    const grandchildAffordance =
                        tables.some(tt => tt.derive?.trigger?.tableId === t.id) ? 24 : 0;
                    // 22 elbow + 14 pl + label + ~10 right padding
                    return 22 + 14 + labelW + grandchildAffordance + 10;
                };
                const FAN_W = useChildrenFan
                    ? Math.max(...children.map(fanBranchW))
                    : 0;

                let leftChain = [...ancestors];
                let rightChain = useChildrenFan ? [] as typeof tables : [...children, ...extraDescendants];
                let leftEllipsis = hasHiddenAncestor;
                let rightTruncated = false;

                const totalW = () => {
                    let w = currentW;
                    if (leftEllipsis) w += ELLIPSIS_W + SEP_W;
                    for (const a of leftChain) w += estW(a) + SEP_W;
                    if (useChildrenFan) {
                        w += SEP_W + FAN_W;
                    } else {
                        if (rightChain.length > 0) w += SEP_W;
                        rightChain.forEach((c, i) => { w += estW(c) + (i > 0 ? 8 : 0); });
                        if (rightTruncated) w += 8 + ELLIPSIS_W;
                    }
                    return w;
                };

                while (totalW() > BUDGET) {
                    // In fan mode we never shed children — the fan owns its
                    // own vertical real estate.  Just shed ancestors.
                    if (useChildrenFan) {
                        if (leftChain.length > 0) {
                            leftChain.shift();
                            leftEllipsis = true;
                        } else { break; }
                    } else if (rightChain.length > leftChain.length && rightChain.length > 0) {
                        rightChain.pop();
                        rightTruncated = true;
                    } else if (leftChain.length > 0) {
                        leftChain.shift();
                        leftEllipsis = true;
                    } else if (rightChain.length > 0) {
                        rightChain.pop();
                        rightTruncated = true;
                    } else {
                        break;
                    }
                }

                // ── build a flat sequence of grid items ────────────────────
                // Each item is one of:
                //  • connector     — occupies row 1 of its own column
                //  • table         — label in row 1, cluster in row 2
                //  • children-fan  — a single cell spanning both rows that
                //                    renders the children as a vertical
                //                    stack of branch rows.
                type Connector = { kind: 'connector', key: string, node: React.ReactNode };
                type TableItem = {
                    kind: 'table',
                    key: string,
                    label: React.ReactNode,
                    charts: Chart[],
                    current?: boolean,
                };
                type FanItem = {
                    kind: 'children-fan',
                    key: string,
                    branches: typeof tables,
                };
                const items: (Connector | TableItem | FanItem)[] = [];

                if (leftEllipsis) {
                    items.push({ kind: 'connector', key: 'lell', node: <Ellipsis /> });
                    items.push({ kind: 'connector', key: 'lell-sep', node: <Sep /> });
                }
                leftChain.forEach((a, i) => {
                    items.push({
                        kind: 'table', key: `a-${a.id}`,
                        label: <TableRef table={a} />,
                        charts: chartsForTable(a.id),
                    });
                    items.push({ kind: 'connector', key: `a-${a.id}-sep`, node: <Sep /> });
                });
                items.push({
                    kind: 'table', key: `c-${currentTable.id}`,
                    label: <TableRef table={currentTable} current />,
                    charts: chartsForTable(currentTable.id),
                    current: true,
                });
                if (useChildrenFan) {
                    // The fan draws its own entry stub at its vertical
                    // midpoint, so no separate row-1 connector is needed
                    // (a Sep here would dangle from the label baseline
                    // and never meet the trunk).
                    items.push({ kind: 'children-fan', key: 'fan', branches: children });
                } else {
                    rightChain.forEach((c, i) => {
                        const prev = i === 0 ? currentTable : rightChain[i - 1];
                        const isDescendant = c.derive?.trigger?.tableId === prev.id;
                        // Sep = chain continuation (parent→child).  Comma =
                        // sibling enumeration under the same parent.
                        items.push({
                            kind: 'connector',
                            key: `c-${c.id}-sep`,
                            node: isDescendant ? <Sep /> : <Comma />,
                        });
                        items.push({
                            kind: 'table', key: `r-${c.id}`,
                            label: <TableRef table={c} />,
                            charts: chartsForTable(c.id),
                        });
                        // "…" affordance: only when c has children AND the
                        // next ribbon entry isn't one of them (otherwise the
                        // chain already exposes the descendant).
                        const cChildren = tables.filter(t => t.derive?.trigger?.tableId === c.id);
                        const nextInChain = rightChain[i + 1];
                        const nextIsChild = !!nextInChain && cChildren.some(cc => cc.id === nextInChain.id);
                        if (cChildren.length > 0 && !nextIsChild) {
                            items.push({ kind: 'connector', key: `r-${c.id}-sep2`, node: <Sep /> });
                            items.push({ kind: 'connector', key: `r-${c.id}-ell`, node: <Ellipsis /> });
                        }
                    });
                    if (rightTruncated) {
                        items.push({ kind: 'connector', key: 'rell-comma', node: <Comma /> });
                        items.push({ kind: 'connector', key: 'rell', node: <Ellipsis /> });
                    }
                }

                // Renders a chart-thumbnail cluster for a single ribbon
                // column.  Two presentations:
                //  • strip   (focused / current table) — N thumbnails laid
                //    out side-by-side, auto-scaled to chart count.
                //  • stacked (neighbour tables) — a constant-width "paper
                //    stack" card: the first chart on top, up to 2 faint
                //    layers peeking out behind, and a ×N badge when there's
                //    more than one.  Keeps non-focused slots a uniform
                //    width so the ribbon stays compact.
                const renderCluster = (
                    charts: Chart[],
                    opts: { scale: number, maxVisible: number, dim?: boolean, stacked?: boolean },
                ) => {
                    if (charts.length === 0) return null;
                    const { scale, maxVisible, dim, stacked } = opts;
                    const imgMaxW = Math.round(140 * scale);
                    const imgMaxH = Math.round(96 * scale);
                    const boxMinW = Math.round(88 * scale);
                    const boxMinH = Math.round(68 * scale);
                    const skeletonPx = Math.round(44 * scale);

                    const renderThumb = (chart: Chart) => {
                        const tpl = getChartTemplate(chart.chartType);
                        const label = chart.chartType;
                        const content = chart.thumbnail ? (
                            <img
                                src={chart.thumbnail}
                                alt={label}
                                style={{ maxWidth: imgMaxW, maxHeight: imgMaxH, objectFit: 'contain' }}
                            />
                        ) : (
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: boxMinW, height: boxMinH }}>
                                {generateChartSkeleton(tpl?.icon, skeletonPx, skeletonPx, 0.4)}
                            </Box>
                        );
                        return (
                            <Box
                                component="button"
                                type="button"
                                onClick={() => dispatch(dfActions.setFocused({ type: 'chart', chartId: chart.id }))}
                                sx={{
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    minWidth: boxMinW, minHeight: boxMinH,
                                    p: 0.5,
                                    border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
                                    borderRadius: '6px', background: theme.palette.background.paper,
                                    cursor: 'pointer', transition: transition.fast,
                                    '&:hover': {
                                        borderColor: 'primary.main',
                                        boxShadow: '0 0 6px rgba(25, 118, 210, 0.25)',
                                    },
                                }}
                            >
                                {content}
                            </Box>
                        );
                    };

                    if (stacked) {
                        const front = charts[0];
                        const behindCount = Math.min(charts.length - 1, 2);
                        const offset = 4; // px per buried layer peeks out
                        // Fixed card dimensions so the front fully covers the
                        // behind layers — otherwise a wide thumbnail can
                        // outgrow the paper and the stack falls apart.
                        const cardW = Math.max(boxMinW, imgMaxW) + 8;
                        const cardH = Math.max(boxMinH, imgMaxH) + 8;
                        const totalW = cardW + behindCount * offset;
                        const totalH = cardH + behindCount * offset;
                        const cardSx = {
                            width: cardW, height: cardH,
                            border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
                            borderRadius: '6px',
                            background: theme.palette.background.paper,
                            boxSizing: 'border-box' as const,
                        };
                        return (
                            <Box sx={{
                                position: 'relative', width: totalW, height: totalH,
                                opacity: dim ? 0.55 : 1,
                                    transition: transition.fast,
                                    '&:hover': dim ? { opacity: 1 } : undefined,
                                }}>
                                    {Array.from({ length: behindCount }).map((_, i) => {
                                        // Farthest layer drawn first so the
                                        // front lands on top.  Slight rotation
                                        // pivoting from the buried corner
                                        // sells the "pile of paper" feel.
                                        const reverseIdx = behindCount - i;
                                        const off = reverseIdx * offset;
                                        const angle = (reverseIdx % 2 === 0 ? 1 : -1) * (reverseIdx * 1.2);
                                        return (
                                            <Box key={`paper-${i}`} sx={{
                                                ...cardSx,
                                                position: 'absolute',
                                                left: off, top: off,
                                                transform: `rotate(${angle}deg)`,
                                                transformOrigin: 'top left',
                                                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                                            }} />
                                        );
                                    })}
                                    {/* Front card: a fixed-size, fully opaque
                                        slot that buries the layers below.
                                        The thumbnail/skeleton is clipped to
                                        fit so nothing overflows. */}
                                    <Box
                                        component="button"
                                        type="button"
                                        onClick={() => dispatch(dfActions.setFocused({ type: 'chart', chartId: front.id }))}
                                        sx={{
                                            ...cardSx,
                                            position: 'absolute', left: 0, top: 0,
                                            p: 0.5, m: 0,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            overflow: 'hidden',
                                            cursor: 'pointer',
                                            transition: transition.fast,
                                            '&:hover': {
                                                borderColor: 'primary.main',
                                                boxShadow: '0 0 6px rgba(25, 118, 210, 0.25)',
                                            },
                                        }}
                                    >
                                        {front.thumbnail ? (
                                            <img
                                                src={front.thumbnail}
                                                alt={front.chartType}
                                                style={{
                                                    maxWidth: '100%', maxHeight: '100%',
                                                    objectFit: 'contain',
                                                }}
                                            />
                                        ) : (
                                            generateChartSkeleton(
                                                getChartTemplate(front.chartType)?.icon,
                                                skeletonPx, skeletonPx, 0.4,
                                            )
                                        )}
                                    </Box>
                                    {charts.length > 1 && (
                                        <Typography sx={{
                                            position: 'absolute',
                                            right: -6, bottom: -6,
                                            fontSize: Math.max(9, Math.round(11 * scale)),
                                            color: 'text.secondary',
                                            px: '5px', py: '1px',
                                            border: `1px solid ${alpha(theme.palette.text.primary, 0.15)}`,
                                            borderRadius: '10px',
                                            background: theme.palette.background.paper,
                                            lineHeight: 1.2,
                                            pointerEvents: 'none',
                                        }}>
                                            {`×${charts.length}`}
                                        </Typography>
                                    )}
                                </Box>
                        );
                    }

                    // Strip mode (focused / current table).
                    const visible = charts.slice(0, maxVisible);
                    const overflow = charts.length - visible.length;

                    return (
                        <Box sx={{
                            display: 'flex', flexWrap: 'wrap',
                            justifyContent: 'center', alignItems: 'center',
                            gap: 0.5,
                            opacity: dim ? 0.45 : 1,
                            transition: transition.fast,
                            '&:hover': dim ? { opacity: 1 } : undefined,
                        }}>
                            {visible.map(chart => (
                                <Tooltip key={chart.id} title={chart.chartType} arrow>
                                    {renderThumb(chart)}
                                </Tooltip>
                            ))}
                            {overflow > 0 && (
                                <Tooltip title={t('chartRec.moreCharts', `${overflow} more`)} arrow>
                                    <Typography sx={{
                                        fontSize: Math.max(10, Math.round(12 * scale)),
                                        color: 'text.secondary',
                                        px: 1, py: 0.5,
                                        border: `1px dashed ${alpha(theme.palette.text.primary, 0.15)}`,
                                        borderRadius: '6px',
                                        minHeight: boxMinH,
                                        display: 'inline-flex', alignItems: 'center',
                                    }}>
                                        {`+${overflow}`}
                                    </Typography>
                                </Tooltip>
                            )}
                        </Box>
                    );
                };

                // Center cluster auto-scales with chart count; neighbour
                // clusters are halved and dimmed to read as context.
                const centerN = Math.min(chartsForTable(currentTable.id).length, 8);
                const centerScale = centerN <= 3 ? 1 : centerN <= 5 ? 0.82 : 0.66;
                const sideScale = 0.5;

                return (
                    <Box sx={{
                        display: 'grid',
                        // One auto column per item, so each table's cluster
                        // lines up directly below its label.  The whole grid
                        // is centered inside the container — that's what
                        // makes the ribbon read as balanced rather than
                        // pivoting around the current table.
                        gridAutoFlow: 'column',
                        gridAutoColumns: 'auto',
                        gridTemplateRows: 'auto auto',
                        justifyContent: 'center',
                        alignItems: 'center',
                        columnGap: '14px',
                        rowGap: '6px',
                        mb: 1, maxWidth: '100%',
                    }}>
                        {items.map(item => {
                            if (item.kind === 'children-fan') {
                                // Vertical fan-out: branches read top-down,
                                // with the FIRST branch aligned with the
                                // current node's label row.  Trunk is drawn
                                // as a single absolutely-positioned line so
                                // the inter-row flex gap doesn't break it.
                                const MAX_BRANCHES = 4;
                                const shown = item.branches.slice(0, MAX_BRANCHES);
                                const hidden = item.branches.length - shown.length;
                                const totalRows = shown.length + (hidden > 0 ? 1 : 0);
                                const ELBOW_W = 22;
                                const LINE_COLOR = 'rgba(0,0,0,0.22)';
                                const ROW_MIN_H = 22;
                                const ROW_GAP = 6;
                                const HALF = ROW_MIN_H / 2; // y-offset of any row's centerline
                                return (
                                    <Box key={item.key} sx={{
                                        gridRow: '1 / span 2',
                                        alignSelf: 'start',
                                        justifySelf: 'start',
                                        display: 'flex', flexDirection: 'column',
                                        gap: `${ROW_GAP}px`,
                                        position: 'relative',
                                    }}>
                                        {/* Entry stub from the current node:
                                            sized to the column gap so it
                                            sits cleanly in the whitespace
                                            between the focused label and
                                            the fan trunk, without bleeding
                                            into the label glyphs. */}
                                        <Box sx={{
                                            position: 'absolute',
                                            right: '100%',
                                            top: `${HALF}px`,
                                            width: 14,
                                            height: '1px',
                                            backgroundColor: LINE_COLOR,
                                            transform: 'translateY(-0.5px)',
                                        }} />
                                        {/* Continuous trunk from first row's
                                            centerline down to last row's
                                            centerline, spanning the row
                                            gaps so the connector reads as
                                            one line. */}
                                        {totalRows >= 2 && (
                                            <Box sx={{
                                                position: 'absolute',
                                                left: 0,
                                                top: `${HALF}px`,
                                                bottom: `${HALF}px`,
                                                width: '1px',
                                                backgroundColor: LINE_COLOR,
                                            }} />
                                        )}
                                        {shown.map((c) => {
                                            const hasGrandchildren = tables.some(t => t.derive?.trigger?.tableId === c.id);
                                            return (
                                                <Box key={c.id} sx={{
                                                    display: 'flex', alignItems: 'center',
                                                    minHeight: ROW_MIN_H,
                                                    position: 'relative',
                                                }}>
                                                    {/* Horizontal elbow stub from
                                                        trunk to this branch label. */}
                                                    <Box sx={{
                                                        width: ELBOW_W, height: '1px',
                                                        backgroundColor: LINE_COLOR,
                                                        flexShrink: 0,
                                                    }} />
                                                    <Box sx={{
                                                        display: 'flex', alignItems: 'center', gap: '6px',
                                                        // 14px breathing room before the
                                                        // label, mirroring the gap on the
                                                        // other side of an inline Sep.
                                                        pl: '14px',
                                                    }}>
                                                        <TableRef table={c} />
                                                        {hasGrandchildren && (
                                                            <>
                                                                <Box sx={{ width: 12, height: '1px', backgroundColor: LINE_COLOR }} />
                                                                <Ellipsis />
                                                            </>
                                                        )}
                                                    </Box>
                                                </Box>
                                            );
                                        })}
                                        {hidden > 0 && (
                                            <Box sx={{ display: 'flex', alignItems: 'center', minHeight: ROW_MIN_H }}>
                                                <Box sx={{
                                                    width: ELBOW_W, height: '1px',
                                                    backgroundColor: LINE_COLOR,
                                                    flexShrink: 0,
                                                }} />
                                                <Typography sx={{ fontSize: 11, color: 'text.disabled', pl: '14px' }}>
                                                    +{hidden} more
                                                </Typography>
                                            </Box>
                                        )}
                                    </Box>
                                );
                            }
                            return (
                                <React.Fragment key={item.key}>
                                    <Box sx={{
                                        gridRow: 1,
                                        // When the current node has a fan
                                        // hanging off it, push its label
                                        // (and chart cluster below) flush
                                        // against the right edge of the
                                        // column so the entry stub doesn't
                                        // appear stranded in empty space
                                        // between the centered label and
                                        // the fan's trunk.
                                        justifySelf: (item.kind === 'table' && item.current && useChildrenFan) ? 'end' : 'center',
                                        alignSelf: 'center',
                                        display: 'inline-flex', alignItems: 'center',
                                        // Reserve the same 14px breathing
                                        // room next to the focused label as
                                        // the inline Sep connectors get on
                                        // either side, so the connector
                                        // cadence is consistent.
                                        ...(item.kind === 'table' && item.current && useChildrenFan
                                            ? { mr: '14px' } : {}),
                                    }}>
                                        {item.kind === 'connector' ? item.node : item.label}
                                    </Box>
                                    {item.kind === 'table' && (
                                        <Box sx={{
                                            gridRow: 2, alignSelf: 'start',
                                            justifySelf: (item.current && useChildrenFan) ? 'end' : 'center',
                                            // Non-current cluster cells take the
                                            // stack-card's natural (constant)
                                            // width; the current cell takes the
                                            // strip's natural width which drives
                                            // its column wide enough to align
                                            // with the cluster.
                                            display: 'flex', justifyContent: 'center',
                                            px: '4px',
                                            ...(item.current && useChildrenFan ? { mr: '14px' } : {}),
                                        }}>
                                            {renderCluster(item.charts, item.current
                                                ? { scale: centerScale, maxVisible: 8, stacked: true }
                                                : { scale: sideScale, maxVisible: 3, dim: true, stacked: true })}
                                        </Box>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </Box>
                );
            })()}
        </Box>
    );
};