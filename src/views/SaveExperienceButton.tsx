// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * SaveExperienceButton — a button that distills the current result's
 * user-visible analysis context into a reusable experience document.
 *
 * Placed on result cards after successful DataAgent analyses.
 */

import React, { useState, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Box,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    CircularProgress,
    LinearProgress,
    Typography,
    IconButton,
    Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

import { DataFormulatorState, dfActions, type ModelConfig } from '../app/dfSlice';
import { store, type AppDispatch } from '../app/store';
import { handleApiError } from '../app/errorHandler';
import { distillExperience } from '../api/knowledgeApi';
import type { DictTable } from '../components/ComponentType';

export interface SaveExperienceButtonProps {
    table: DictTable;
    tables: DictTable[];
    /** If true, render as a full button. Otherwise a small icon button. */
    variant?: 'button' | 'icon';
}

/**
 * True leaf: derived table with no un-anchored children deriving from it.
 * Layout-promoted "extra leaves" in DataThread still have children, so they
 * won't pass this check.
 */
export function isLeafDerivedTable(table: DictTable, tables: DictTable[]): boolean {
    if (!table.derive) return false;
    return !tables.some(
        t => t.derive?.trigger.tableId === table.id && !t.anchored,
    );
}

/**
 * Walk the visible chain from `leaf` back to the root source table,
 * collecting only tables that still exist in `tables`.
 * Returns the chain ordered root-first.
 */
function walkVisibleChain(leaf: DictTable, tables: DictTable[]): DictTable[] {
    const chain: DictTable[] = [leaf];
    const visited = new Set<string>([leaf.id]);
    let current = leaf;
    while (current.derive) {
        const parentId = current.derive.trigger.tableId;
        if (visited.has(parentId)) break;
        visited.add(parentId);
        const parent = tables.find(t => t.id === parentId);
        if (!parent) break;
        chain.push(parent);
        if (!parent.derive) break;
        current = parent;
    }
    chain.reverse();
    return chain;
}

/**
 * Extract a tool name from a single dialog `content` blob.
 *
 * Mirrors the backend `_extract_tool_name_from_dialog_content`: the data agent
 * emits dialog content like `[tool: build_loader]\n\`\`\`python\n...`. We only
 * forward the bracketed name; the body (which can contain raw code or data)
 * is dropped.
 */
function extractToolNameFromDialogContent(content: unknown): string | null {
    const text = content == null ? '' : String(content).trim();
    if (!text.startsWith('[tool:')) return null;
    const firstLine = text.split('\n')[0].trim();
    if (!firstLine.endsWith(']')) return null;
    const name = firstLine.slice('[tool:'.length, -1).trim();
    return name || null;
}

/**
 * Truncate plain text to `limit` chars (with ellipsis). Mirrors backend
 * `_truncate`. Used for `Message.content`.
 */
function truncateText(value: unknown, limit = 500): string {
    const text = value == null ? '' : String(value);
    return text.length <= limit ? text : text.slice(0, limit) + '...';
}

const MESSAGE_CONTENT_LIMIT = 500;
const SAMPLE_ROW_COUNT = 5;

/** Vega/encoding-channel summary for a chart, e.g. "x=region(nominal), y=sales [sum]". */
function chartEncodingSummary(chart: any): string | undefined {
    const map = chart?.encodingMap;
    if (!map || typeof map !== 'object') return undefined;
    const parts: string[] = [];
    for (const [channel, enc] of Object.entries(map as Record<string, any>)) {
        if (!enc || !enc.fieldID) continue;
        let s = `${channel}=${enc.fieldID}`;
        if (enc.dtype) s += `(${enc.dtype})`;
        if (enc.aggregate) s += ` [${enc.aggregate}]`;
        parts.push(s);
    }
    return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * Build the timeline payload for `/api/knowledge/distill-experience`.
 * One chronological list of events. Three event types: `message`,
 * `create_table`, `create_chart`. Returns `null` when the chain has no
 * user-originated message (no useful signal to distill).
 *
 * See design-docs/21.3-distill-payload-vs-preview-alignment.md.
 */
export function buildExperienceContext(
    table: DictTable,
    tables: DictTable[],
): { context_id?: string; events: Array<Record<string, any>> } | null {
    const derive = table.derive;
    if (!derive) return null;

    const chain = walkVisibleChain(table, tables);
    const events: Array<Record<string, any>> = [];
    let sawUserMessage = false;

    for (const step of chain) {
        const stepDerive = step.derive;
        if (!stepDerive) continue; // root, no events to emit

        // 1. Pass-through interaction entries (verbatim from InteractionEntry).
        for (const entry of stepDerive.trigger.interaction || []) {
            if (entry.role === 'error') continue;
            const raw = entry.content ?? '';
            if (!raw || !String(raw).trim()) continue;
            if (entry.from === 'user') sawUserMessage = true;
            events.push({
                type: 'message',
                from: entry.from,
                to: entry.to,
                role: entry.role,
                content: truncateText(raw, MESSAGE_CONTENT_LIMIT),
            });
        }

        // 2. Synthesize tool calls from dialog (drop raw assistant snippets).
        for (const msg of stepDerive.dialog || []) {
            const name = extractToolNameFromDialogContent((msg as any)?.content);
            if (!name) continue;
            events.push({
                type: 'message',
                from: 'data-agent',
                to: 'data-agent',
                role: 'tool_call',
                content: name,
            });
        }

        // 3. CreateTable side-effect of running code at this step.
        const attempts = Array.isArray(stepDerive.executionAttempts) ? stepDerive.executionAttempts : [];
        let via: 'visualize' | 'repair' = 'visualize';
        for (let i = attempts.length - 1; i >= 0; i--) {
            const a = attempts[i];
            if (a && a.status === 'ok') {
                via = a.kind === 'repair' ? 'repair' : 'visualize';
                break;
            }
        }
        const rows = Array.isArray(step.rows) ? step.rows : [];
        events.push({
            type: 'create_table',
            table_id: step.displayId || step.id,
            source_tables: [...(stepDerive.source || [])],
            via,
            columns: [...(step.names || [])],
            row_count: step.virtual?.rowCount ?? rows.length,
            sample_rows: rows.slice(0, SAMPLE_ROW_COUNT).map(r =>
                r && typeof r === 'object' ? { ...r } : { value: r },
            ),
            ...(stepDerive.code ? { code: stepDerive.code } : {}),
        });

        // 4. CreateChart side-effect (when the step emitted a chart).
        const chart = stepDerive.trigger.chart as any;
        const mark = chart?.chartType || chart?.mark || chart?.chart_type;
        if (mark) {
            const encodingSummary = chartEncodingSummary(chart);
            events.push({
                type: 'create_chart',
                related_table_id: step.displayId || step.id,
                mark_or_type: String(mark),
                ...(encodingSummary ? { encoding_summary: encodingSummary } : {}),
            });
        }
    }

    if (!sawUserMessage) return null;

    return {
        context_id: table.id,
        events,
    };
}

export function buildDistillModelConfig(selectedModel: ModelConfig): Record<string, any> {
    return {
        id: selectedModel.id,
        endpoint: selectedModel.endpoint,
        api_key: selectedModel.api_key,
        api_base: selectedModel.api_base,
        api_version: selectedModel.api_version,
        model: selectedModel.model,
        is_global: selectedModel.is_global,
    };
}

type DistillStatus = 'idle' | 'running' | 'failed';

/**
 * Flat one-line summary of a single event for the dialog preview.
 * This is what the user sees in the "Distill from" panel — kept in
 * lockstep with the payload so there's no preview/payload drift.
 */
function renderEventLine(ev: Record<string, any>): string {
    const kind = ev.type;
    if (kind === 'message') {
        const head = `[${ev.from}→${ev.to}/${ev.role}]`;
        return ev.content ? `${head} ${ev.content}` : head;
    }
    if (kind === 'create_table') {
        const tail: string[] = [];
        if (ev.row_count != null) tail.push(`${ev.row_count} rows`);
        if (Array.isArray(ev.columns) && ev.columns.length) {
            tail.push(`[${ev.columns.join(', ')}]`);
        }
        const tailStr = tail.length ? ` — ${tail.join(' · ')}` : '';
        return `[create_table via=${ev.via ?? '?'}] ${ev.table_id ?? '?'}${tailStr}`;
    }
    if (kind === 'create_chart') {
        return `[create_chart] ${ev.mark_or_type ?? '?'} on ${ev.related_table_id ?? '?'}`;
    }
    return `[${kind ?? '?'}]`;
}

interface DistillFromPanelProps {
    table: DictTable;
    tables: DictTable[];
}

/** Read-only flat list of the event timeline that will feed the LLM. */
const DistillFromPanel: React.FC<DistillFromPanelProps> = ({ table, tables }) => {
    const { t } = useTranslation();
    const ctx = React.useMemo(() => buildExperienceContext(table, tables), [table, tables]);
    if (!ctx || ctx.events.length === 0) return null;

    return (
        <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                {t('knowledge.distillFromHeading')}
            </Typography>
            <Box
                aria-label={t('knowledge.distillFromHeading')}
                sx={{
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    px: 1.5,
                    py: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.25,
                    maxHeight: 240,
                    overflowY: 'auto',
                }}
            >
                {ctx.events.map((ev, i) => (
                    <Typography
                        key={i}
                        sx={{
                            fontSize: 11,
                            fontFamily: 'monospace',
                            color: 'text.primary',
                            whiteSpace: 'pre-wrap',
                            overflowWrap: 'anywhere',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                        }}
                    >
                        {`• ${renderEventLine(ev)}`}
                    </Typography>
                ))}
            </Box>
        </Box>
    );
};

export const SaveExperienceButton: React.FC<SaveExperienceButtonProps> = ({
    table,
    tables,
    variant = 'button',
}) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const selectedModelId = useSelector((s: DataFormulatorState) => s.selectedModelId);
    const allModels = useSelector((s: DataFormulatorState) => [...s.globalModels, ...s.models]);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [userInstruction, setUserInstruction] = useState('');
    const [distillStatus, setDistillStatus] = useState<DistillStatus>('idle');
    const distillingRef = useRef(false);

    const selectedModel = allModels.find(m => m.id === selectedModelId);

    const handleCancel = useCallback(() => {
        if (distillingRef.current) return;
        setDialogOpen(false);
        setUserInstruction('');
    }, []);

    const handleDistill = useCallback(async () => {
        if (distillingRef.current) return;
        const experienceContext = buildExperienceContext(table, tables);
        if (!experienceContext || !selectedModel) return;

        distillingRef.current = true;
        setDistillStatus('running');
        // Dialog stays open during distillation; overlay communicates progress.
        const instruction = userInstruction.trim() || undefined;

        try {
            const modelConfig = buildDistillModelConfig(selectedModel);
            const timeoutSeconds = (store.getState() as DataFormulatorState).config.formulateTimeoutSeconds;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
            let result;
            try {
                result = await distillExperience(experienceContext, modelConfig, instruction, timeoutSeconds, controller.signal);
            } finally {
                clearTimeout(timeoutId);
            }
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'success',
                component: 'knowledge',
                value: t('knowledge.distilled'),
            }));
            // Refresh the panel and reveal the newly distilled experience.
            window.dispatchEvent(new CustomEvent('knowledge-changed', { detail: { category: 'experiences' } }));
            window.dispatchEvent(new CustomEvent('open-knowledge-panel', {
                detail: { category: 'experiences', path: result.path },
            }));
            setDistillStatus('idle');
            setDialogOpen(false);
            setUserInstruction('');
        } catch (e: unknown) {
            setDistillStatus('failed');
            handleApiError(e, 'knowledge');
        } finally {
            distillingRef.current = false;
        }
    }, [table, tables, selectedModel, userInstruction, dispatch, t]);

    if (!buildExperienceContext(table, tables)) return null;

    const distilling = distillStatus === 'running';
    const failed = distillStatus === 'failed';
    const tooltipLabel = distilling
        ? t('knowledge.distilling')
        : failed
            ? t('knowledge.distillFailedRetry')
            : t('knowledge.saveAsExperience');

    const iconContent = distilling
        ? <CircularProgress size={13} color="inherit" />
        : failed
            ? <ErrorOutlineIcon sx={{ fontSize: 14 }} />
            : <MenuBookIcon sx={{ fontSize: 14 }} />;

    return (
        <>
            {variant === 'icon' ? (
                <Tooltip title={tooltipLabel}>
                    <span>
                        <IconButton
                            size="small"
                            onClick={() => setDialogOpen(true)}
                            disabled={distilling}
                            sx={{
                                p: 0.5,
                                color: failed ? 'error.main' : 'text.secondary',
                                '&:hover': { color: failed ? 'error.dark' : 'primary.main', transform: 'scale(1.15)' },
                            }}
                        >
                            {iconContent}
                        </IconButton>
                    </span>
                </Tooltip>
            ) : (
                <Button
                    size="small"
                    startIcon={iconContent}
                    onClick={() => setDialogOpen(true)}
                    disabled={distilling}
                    sx={{
                        textTransform: 'none',
                        fontSize: 10,
                        py: 0.25,
                        px: 0.75,
                        color: failed ? 'error.main' : 'text.secondary',
                        '&:hover': { color: failed ? 'error.dark' : 'primary.main' },
                    }}
                >
                    {tooltipLabel}
                </Button>
            )}

            <Dialog
                open={dialogOpen}
                onClose={handleCancel}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle sx={{ fontSize: 15, pb: 0.5 }}>
                    {t('knowledge.saveAsExperienceTitle')}
                </DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '8px !important', position: 'relative' }}>
                    {/* Hint line */}
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
                        <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled', mt: '1px' }} />
                        <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.4 }}>
                            {t('knowledge.distillHint')}
                        </Typography>
                    </Box>
                    {/* Distill from panel */}
                    <DistillFromPanel table={table} tables={tables} />
                    <TextField
                        size="small"
                        fullWidth
                        multiline
                        minRows={2}
                        label={t('knowledge.userInstruction')}
                        placeholder={t('knowledge.userInstructionPlaceholder')}
                        value={userInstruction}
                        onChange={(e) => setUserInstruction(e.target.value)}
                        disabled={distilling}
                        sx={{ '& .MuiInputBase-input': { fontSize: 12 } }}
                        slotProps={{ inputLabel: { sx: { fontSize: 12 } } }}
                    />
                    {!selectedModel && (
                        <Typography sx={{ fontSize: 11, color: 'error.main' }}>
                            {t('report.noModelSelected')}
                        </Typography>
                    )}
                    {/* Overlay shown while distilling — covers the panel content. */}
                    {distilling && (
                        <Box
                            sx={{
                                position: 'absolute',
                                inset: 0,
                                zIndex: theme => theme.zIndex.modal + 1,
                                bgcolor: theme => alpha(theme.palette.background.paper, 0.88),
                                backdropFilter: 'blur(3px)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 0.5,
                                px: 2,
                                overflow: 'hidden',
                            }}
                        >
                            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, fontSize: 11 }}>
                                {t('knowledge.distilling')}
                            </Typography>
                            <Typography variant="caption" sx={{
                                color: 'text.disabled',
                                fontSize: 10,
                                textAlign: 'center',
                                lineHeight: 1.3,
                            }}>
                                {t('knowledge.distillingOverlay')}
                            </Typography>
                            <LinearProgress sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2 }} />
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={handleCancel}
                        disabled={distilling}
                        sx={{ textTransform: 'none', fontSize: 12 }}
                    >
                        {t('app.cancel')}
                    </Button>
                    <Button
                        onClick={handleDistill}
                        disabled={distilling || !selectedModel}
                        variant="contained"
                        sx={{ textTransform: 'none', fontSize: 12 }}
                    >
                        {distilling ? t('knowledge.distilling') : t('knowledge.distillExperience')}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
