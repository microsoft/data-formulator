// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * SessionDistill — session-scoped experience distillation.
 *
 * Replaces the old per-result distillation flow with a single
 * session-bound entry. See design-docs/24-session-scoped-distillation.md.
 *
 * Exports:
 *   - buildSessionExperienceContext(workspace, threads): state-independent
 *     payload builder (with size budgeting, see §3.5 of the design doc).
 *   - collectSessionThreads(tables, charts, fields): leaf discovery + per-leaf
 *     event walk against live DataFormulator state.
 *   - SessionDistillDialog: the dialog used by KnowledgePanel for both
 *     create and update modes.
 *   - findSessionExperience: lookup an existing session experience by
 *     workspace id.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Box,
    Button,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    LinearProgress,
    TextField,
    Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PersonIcon from '@mui/icons-material/Person';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';

import { TableIcon } from '../icons';
import type { Chart, DictTable, FieldItem } from '../components/ComponentType';
import {
    DataFormulatorState, dfActions, type ModelConfig,
} from '../app/dfSlice';
import { store, type AppDispatch } from '../app/store';
import { handleApiError } from '../app/errorHandler';
import {
    distillSessionExperience,
    type KnowledgeItem,
    type SessionExperienceContext,
} from '../api/knowledgeApi';
import {
    buildLeafEvents,
    buildDistillModelConfig,
    isLeafDerivedTable,
    TOOL_USES_CODE_FONT,
} from './experienceContext';

// ---------------------------------------------------------------------------
// Payload size budget (design-docs/24 §3.5)
// ---------------------------------------------------------------------------
//
// We keep the prompt bounded with a session-level event budget. When the
// full payload would exceed the budget, we trim in the order specified
// in the design doc:
//   1. Drop tool_call events (densest, least transferable).
//   2. Shrink each create_table.sample_rows down to 1 row.
//   3. Drop oldest threads (first in render order) entirely.
// Every trim step records what was dropped in `payload_notes` so the LLM
// (and the user, in the dialog) can see what the prompt knew about.
const SESSION_EVENT_BUDGET = 60_000;  // bytes of JSON-serialized events

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One pre-built thread, ready for `buildSessionExperienceContext`.
 *
 * Callers produce these by walking their own tables (see
 * `collectSessionThreads` for the in-app implementation) or with hand-built
 * fixtures in tests. Once built, the payload assembly is purely a function
 * of (workspace, threads) — no Redux state required.
 */
export interface SessionThread {
    thread_id: string;
    /** Display label (table displayId or id) — used in the dialog only. */
    label: string;
    events: Array<Record<string, any>>;
}

export interface BuildSessionResult {
    /** Payload as it will be sent (after trimming). */
    payload: SessionExperienceContext;
    /** Display threads with labels for the preview UI (post-trim). */
    threads: SessionThread[];
    /** Aggregate stats for the preview (post-trim). */
    stats: { threadCount: number; stepCount: number };
    /** Notes about trimming (also forwarded in the payload). */
    notes: string[];
}

// ---------------------------------------------------------------------------
// findSessionExperience
// ---------------------------------------------------------------------------

/**
 * Find the experience entry distilled from the given workspace, if any.
 * Returns the first match; the backend ensures at most one per workspace.
 */
export function findSessionExperience(
    items: KnowledgeItem[] | undefined,
    workspaceId: string | undefined,
): KnowledgeItem | undefined {
    if (!items || !workspaceId) return undefined;
    return items.find(it => it.sourceWorkspaceId === workspaceId);
}

// ---------------------------------------------------------------------------
// collectSessionThreads — live state → SessionThread[]
// ---------------------------------------------------------------------------

/**
 * Walk the live DataFormulator state to find every distillable thread
 * in the active session, ordered the same way `DataThread` renders them.
 *
 * Threads with no user message are filtered out. Returns `[]` when the
 * session has no distillable thread. Not used in tests — tests construct
 * `SessionThread[]` directly and call `buildSessionExperienceContext`.
 */
export function collectSessionThreads(
    tables: DictTable[],
    charts: Chart[],
    conceptShelfItems: FieldItem[],
): SessionThread[] {
    // Match DataThread's render ordering: tables in slice order with
    // anchored ones promoted later.
    const tableOrder: Record<string, number> = Object.fromEntries(
        tables.map((t, i) => [t.id, i + (t.anchored ? 1 : 0) * tables.length]),
    );
    const leaves = tables
        .filter(t => isLeafDerivedTable(t, tables))
        .sort((a, b) => tableOrder[a.id] - tableOrder[b.id]);

    const threads: SessionThread[] = [];
    for (const leaf of leaves) {
        const events = buildLeafEvents(leaf, tables, charts, conceptShelfItems);
        if (!events || events.length === 0) continue;
        threads.push({
            thread_id: leaf.id,
            label: leaf.displayId || leaf.id,
            events,
        });
    }
    return threads;
}

// ---------------------------------------------------------------------------
// buildSessionExperienceContext — pure (workspace, threads) → payload
// ---------------------------------------------------------------------------

/**
 * Assemble the multi-thread payload sent to `/api/knowledge/distill-experience`.
 *
 * State-independent: takes pre-built threads and a workspace identity.
 * Returns `null` when `threads` is empty.
 */
export function buildSessionExperienceContext(
    workspace: { id: string; displayName: string },
    threads: SessionThread[],
): BuildSessionResult | null {
    if (!threads.length) return null;

    const { trimmedThreads, notes } = trimToBudget(threads, SESSION_EVENT_BUDGET);

    const payload: SessionExperienceContext = {
        context_id: workspace.id,
        workspace_id: workspace.id,
        workspace_name: workspace.displayName,
        threads: trimmedThreads.map(t => ({
            thread_id: t.thread_id,
            events: t.events,
        })),
        ...(notes.length ? { payload_notes: notes } : {}),
    };

    const trimmedStepCount = trimmedThreads.reduce(
        (acc, t) => acc + t.events.filter(e => e.type === 'create_table').length,
        0,
    );

    return {
        payload,
        threads: trimmedThreads,
        stats: { threadCount: trimmedThreads.length, stepCount: trimmedStepCount },
        notes,
    };
}

/** JSON-byte size of an events array (used for budgeting). */
function eventsByteSize(events: Array<Record<string, any>>): number {
    try { return new TextEncoder().encode(JSON.stringify(events)).length; }
    catch { return JSON.stringify(events).length; }
}

function totalSize(threads: SessionThread[]): number {
    return threads.reduce((acc, t) => acc + eventsByteSize(t.events), 0);
}

/**
 * Apply the trim ladder (tool calls → sample rows → oldest threads) until
 * total event bytes fit in `budget`. Threads are never partially trimmed
 * to "some events" — only entire categories of events are dropped per
 * step, to keep the resulting log coherent.
 */
function trimToBudget(
    threads: SessionThread[],
    budget: number,
): { trimmedThreads: SessionThread[]; notes: string[] } {
    let working = threads.map(t => ({ ...t, events: [...t.events] }));
    const notes: string[] = [];
    if (totalSize(working) <= budget) return { trimmedThreads: working, notes };

    // Step 1: drop tool_call events.
    let droppedToolCalls = 0;
    working = working.map(t => {
        const before = t.events.length;
        const after = t.events.filter(e => !(e.type === 'message' && e.role === 'tool_call'));
        droppedToolCalls += before - after.length;
        return { ...t, events: after };
    });
    if (droppedToolCalls > 0) {
        notes.push(`omitted ${droppedToolCalls} tool-call event${droppedToolCalls === 1 ? '' : 's'} to fit length budget`);
    }
    if (totalSize(working) <= budget) return { trimmedThreads: working, notes };

    // Step 2: shrink each create_table.sample_rows to 1 row.
    let shrunkSamples = 0;
    working = working.map(t => ({
        ...t,
        events: t.events.map(e => {
            if (e.type !== 'create_table') return e;
            const sample = Array.isArray(e.sample_rows) ? e.sample_rows : [];
            if (sample.length <= 1) return e;
            shrunkSamples += 1;
            return { ...e, sample_rows: sample.slice(0, 1) };
        }),
    }));
    if (shrunkSamples > 0) {
        notes.push(`shrunk sample rows on ${shrunkSamples} table${shrunkSamples === 1 ? '' : 's'} to 1 row`);
    }
    if (totalSize(working) <= budget) return { trimmedThreads: working, notes };

    // Step 3: drop oldest threads (first in render order).
    let dropped = 0;
    while (working.length > 1 && totalSize(working) > budget) {
        working = working.slice(1);
        dropped += 1;
    }
    if (dropped > 0) {
        notes.push(`omitted ${dropped} earliest thread${dropped === 1 ? '' : 's'} to fit length budget`);
    }

    return { trimmedThreads: working, notes };
}

// ---------------------------------------------------------------------------
// SessionDistillDialog
// ---------------------------------------------------------------------------

export interface SessionDistillDialogProps {
    open: boolean;
    /** True when re-distilling an existing session experience. */
    updateMode?: boolean;
    onClose: () => void;
    /**
     * Notified whenever distillation starts/finishes so the parent (e.g.
     * the KnowledgePanel action row) can show a busy indicator while the
     * dialog is closed in the background.
     */
    onRunningChange?: (running: boolean) => void;
}

type DistillStatus = 'idle' | 'running' | 'failed';

export const SessionDistillDialog: React.FC<SessionDistillDialogProps> = ({
    open, updateMode = false, onClose, onRunningChange,
}) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const tables = useSelector((s: DataFormulatorState) => s.tables);
    const charts = useSelector((s: DataFormulatorState) => s.charts);
    const conceptShelfItems = useSelector((s: DataFormulatorState) => s.conceptShelfItems);
    const activeWorkspace = useSelector((s: DataFormulatorState) => s.activeWorkspace);
    const selectedModelId = useSelector((s: DataFormulatorState) => s.selectedModelId);
    const allModels = useSelector(
        (s: DataFormulatorState) => [...s.globalModels, ...s.models],
    );
    const selectedModel = allModels.find(m => m.id === selectedModelId);

    const built = useMemo(() => {
        if (!open || !activeWorkspace) return null;
        const threads = collectSessionThreads(tables, charts, conceptShelfItems);
        return buildSessionExperienceContext(activeWorkspace, threads);
    }, [open, activeWorkspace, tables, charts, conceptShelfItems]);

    const [userInstruction, setUserInstruction] = useState('');
    const [status, setStatus] = useState<DistillStatus>('idle');
    const runningRef = useRef(false);

    const handleClose = useCallback(() => {
        onClose();
        if (!runningRef.current) {
            setUserInstruction('');
            setStatus('idle');
        }
    }, [onClose]);

    const handleDistill = useCallback(async () => {
        if (runningRef.current) return;
        if (!built || !selectedModel) return;
        runningRef.current = true;
        setStatus('running');
        onRunningChange?.(true);
        const instruction = userInstruction.trim() || undefined;

        try {
            const modelConfig = buildDistillModelConfig(selectedModel as ModelConfig);
            const timeoutSeconds = (store.getState() as DataFormulatorState).config.formulateTimeoutSeconds;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
            let result;
            try {
                result = await distillSessionExperience(
                    built.payload, modelConfig, instruction, timeoutSeconds, controller.signal,
                );
            } finally {
                clearTimeout(timeoutId);
            }
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'success',
                component: 'knowledge',
                value: t('knowledge.distilled'),
            }));
            window.dispatchEvent(new CustomEvent('knowledge-changed', {
                detail: { category: 'experiences' },
            }));
            window.dispatchEvent(new CustomEvent('open-knowledge-panel', {
                detail: { category: 'experiences', path: result.path },
            }));
            setStatus('idle');
            setUserInstruction('');
            onClose();
        } catch (e: unknown) {
            setStatus('failed');
            handleApiError(e, 'knowledge');
        } finally {
            runningRef.current = false;
            onRunningChange?.(false);
        }
    }, [built, selectedModel, userInstruction, dispatch, t, onClose, onRunningChange]);

    const distilling = status === 'running';
    const hasContent = !!built && built.threads.length > 0;

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontSize: 15, pb: 0.5 }}>
                {updateMode
                    ? t('knowledge.updateSessionTitle', { defaultValue: 'Update Session Experience' })
                    : t('knowledge.distillSessionTitle', { defaultValue: 'Distill Session Experience' })}
            </DialogTitle>
            <DialogContent sx={{
                display: 'flex', flexDirection: 'column', gap: 1.5,
                pt: '8px !important', position: 'relative',
            }}>
                {/* Hint — also acts as the heading for the framed thread list. */}
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.4 }}>
                        {updateMode
                            ? t('knowledge.distillSessionUpdateHint', {
                                defaultValue: 'Re-distill lessons from this analysis into the existing knowledge document.',
                            })
                            : t('knowledge.distillSessionHint', {
                                defaultValue: 'Distill lessons from this analysis into a reusable knowledge document.',
                            })}
                    </Typography>
                </Box>

                {!hasContent ? (
                    <Typography sx={{ fontSize: 12, color: 'text.disabled', fontStyle: 'italic', py: 1 }}>
                        {t('knowledge.distillSessionNothing', {
                            defaultValue: 'No completed analysis threads in this session yet.',
                        })}
                    </Typography>
                ) : (
                    <SessionDistillFromPanel
                        threads={built!.threads}
                    />
                )}

                <TextField
                    size="small"
                    fullWidth
                    multiline
                    minRows={2}
                    label={t('knowledge.distillationInstructions')}
                    placeholder={t('knowledge.distillationInstructionsPlaceholder')}
                    value={userInstruction}
                    onChange={(e) => setUserInstruction(e.target.value)}
                    disabled={distilling}
                    sx={{ mt: 1.5, '& .MuiInputBase-input': { fontSize: 12 } }}
                    slotProps={{ inputLabel: { sx: { fontSize: 12 } } }}
                />
                {!selectedModel && (
                    <Typography sx={{ fontSize: 11, color: 'error.main' }}>
                        {t('report.noModelSelected')}
                    </Typography>
                )}

                {distilling && (
                    <Box sx={{
                        position: 'absolute', inset: 0,
                        zIndex: theme => theme.zIndex.modal + 1,
                        bgcolor: theme => alpha(theme.palette.background.paper, 0.88),
                        backdropFilter: 'blur(3px)',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        gap: 0.5, px: 2, overflow: 'hidden',
                    }}>
                        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, fontSize: 11 }}>
                            {t('knowledge.distilling')}
                        </Typography>
                        <Typography variant="caption" sx={{
                            color: 'text.disabled', fontSize: 10,
                            textAlign: 'center', lineHeight: 1.3,
                        }}>
                            {t('knowledge.distillingOverlay')}
                        </Typography>
                        <LinearProgress sx={{
                            position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
                        }} />
                    </Box>
                )}
            </DialogContent>
            <DialogActions sx={{ alignItems: 'center', gap: 1 }}>
                {/* Trim warnings sit on the left so the user sees what was
                    omitted before pressing Distill. */}
                {hasContent && built!.notes.length > 0 && (
                    <Box sx={{ flex: 1, minWidth: 0, mr: 'auto', pl: 1 }}>
                        {built!.notes.map((n, i) => (
                            <Typography
                                key={i}
                                sx={{ fontSize: 10, color: 'warning.main', fontStyle: 'italic', lineHeight: 1.3 }}
                            >
                                ⚠ {n}
                            </Typography>
                        ))}
                    </Box>
                )}
                <Button onClick={handleClose} sx={{ textTransform: 'none', fontSize: 12 }}>
                    {distilling ? t('app.close') : t('app.cancel')}
                </Button>
                <Button
                    onClick={handleDistill}
                    disabled={distilling || !selectedModel || !hasContent}
                    variant="contained"
                    sx={{ textTransform: 'none', fontSize: 12 }}
                >
                    {distilling
                        ? t('knowledge.distilling')
                        : updateMode
                            ? t('knowledge.updateSession', { defaultValue: 'Update' })
                            : t('knowledge.distillExperience')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

// ---------------------------------------------------------------------------
// SessionDistillFromPanel
// ---------------------------------------------------------------------------

const SessionDistillFromPanel: React.FC<{
    threads: SessionThread[];
}> = ({ threads }) => {
    const { t } = useTranslation();
    // Default expansion: all expanded when ≤3 threads, otherwise first only.
    const [expanded, setExpanded] = useState<Set<number>>(() => {
        if (threads.length <= 3) return new Set(threads.map((_, i) => i));
        return new Set([0]);
    });
    const toggle = useCallback((idx: number) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx); else next.add(idx);
            return next;
        });
    }, []);

    return (
        <Box>
            <Box
                aria-label={t('knowledge.distillFromCaption', {
                    defaultValue: 'Threads that will be sent to the LLM',
                })}
                sx={{
                    display: 'flex', flexDirection: 'column', gap: '4px',
                    maxHeight: 360, overflowY: 'auto',
                    px: 1, py: 0.75,
                    border: theme => `1px solid ${theme.palette.divider}`,
                    borderRadius: '6px',
                }}
            >
                {threads.map((thread, idx) => {
                    const isOpen = expanded.has(idx);
                    const stepCount = thread.events.filter(e => e.type === 'create_table').length;
                    return (
                        <Box key={thread.thread_id} sx={{ mt: 0.5 }}>
                            <Box
                                onClick={() => toggle(idx)}
                                sx={{
                                    display: 'flex', alignItems: 'center', gap: 0.5,
                                    cursor: 'pointer', borderRadius: '4px', px: 0.5, py: 0.25,
                                    '&:hover': { bgcolor: 'action.hover' },
                                }}
                            >
                                <IconButton size="small" sx={{ p: 0.125 }} tabIndex={-1}>
                                    {isOpen
                                        ? <ExpandLessIcon sx={{ fontSize: 14 }} />
                                        : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
                                </IconButton>
                                <Typography sx={{
                                    fontSize: 11, fontWeight: 500, color: 'text.primary',
                                    flex: 1, minWidth: 0, overflow: 'hidden',
                                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                    {t('knowledge.threadHeader', {
                                        idx: idx + 1,
                                        label: thread.label,
                                        defaultValue: `Thread ${idx + 1} · ${thread.label}`,
                                    })}
                                </Typography>
                                <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>
                                    {t('knowledge.threadStepBadge', {
                                        steps: stepCount,
                                        defaultValue: `${stepCount} step${stepCount === 1 ? '' : 's'}`,
                                    })}
                                </Typography>
                            </Box>
                            <Collapse in={isOpen} unmountOnExit>
                                <Box sx={{ pl: 1.5, display: 'flex', flexDirection: 'column', gap: '2px', mt: 0.25 }}>
                                    {thread.events.map((ev, i) => (
                                        <EventRow key={i} ev={ev} />
                                    ))}
                                </Box>
                            </Collapse>
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
};

// ---------------------------------------------------------------------------
// EventRow — one row of the timeline preview.
//
// Self-contained event rendering for the SessionDistillFromPanel above.
// Decides icon and content layout based on the event type:
//   - user message       → warm `custom` tint (primary signal)
//   - agent message      → primary tint (primary signal)
//   - create_table/chart → primary tint (primary signal)
//   - tool_call          → neutral grey tint (secondary / supporting)
// ---------------------------------------------------------------------------

const EventRow: React.FC<{ ev: Record<string, any> }> = ({ ev }) => {
    const theme = useTheme();
    const kind = ev.type;
    const isUser = kind === 'message' && ev.from === 'user';
    const isToolCall = kind === 'message' && ev.role === 'tool_call';

    let Icon: React.ElementType;
    let iconColor: string;
    let roleBadge: string | null = null;
    let body: React.ReactNode;

    if (kind === 'message') {
        if (isUser) {
            Icon = PersonIcon;
            iconColor = theme.palette.custom?.main || theme.palette.primary.main;
        } else if (isToolCall) {
            Icon = BuildOutlinedIcon;
            iconColor = theme.palette.text.disabled;
        } else {
            Icon = SmartToyOutlinedIcon;
            iconColor = theme.palette.primary.main;
        }
        // For tool calls the badge becomes the tool name (think / explore /
        // inspect_source_data, …) and the body is just the args/code preview.
        if (isToolCall) {
            roleBadge = ev.content ? String(ev.content) : 'tool_call';
        } else {
            roleBadge = ev.role && ev.role !== 'prompt' ? String(ev.role) : null;
        }
        body = (
            <Box>
                {!isToolCall && (
                    <Typography sx={{
                        fontSize: 11,
                        color: 'text.primary',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                    }}>
                        {ev.content || ''}
                    </Typography>
                )}
                {isToolCall && ev.args && (() => {
                    const useMono = TOOL_USES_CODE_FONT.has(String(ev.content));
                    return (
                        <Typography sx={{
                            fontSize: useMono ? 9 : 11,
                            color: 'text.secondary',
                            fontFamily: useMono ? 'monospace' : undefined,
                            lineHeight: useMono ? 1.4 : 1.5,
                            whiteSpace: 'pre-wrap',
                            overflowWrap: 'anywhere',
                            display: '-webkit-box',
                            WebkitLineClamp: 6,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                        }}>
                            {ev.args}
                        </Typography>
                    );
                })()}
            </Box>
        );
    } else if (kind === 'create_table') {
        Icon = TableIcon;
        iconColor = theme.palette.primary.main;
        const cols = Array.isArray(ev.columns) ? ev.columns : [];
        body = (
            <Box>
                <Typography sx={{ fontSize: 11, color: 'text.primary' }}>
                    <Box component="span" sx={{ fontFamily: 'monospace' }}>{ev.table_id ?? '?'}</Box>
                    <Box component="span" sx={{ color: 'text.disabled', ml: 0.75 }}>
                        {ev.row_count != null ? `${ev.row_count} rows` : ''}
                        {cols.length ? ` · ${cols.length} cols` : ''}
                    </Box>
                </Typography>
                {cols.length > 0 && (
                    <Typography sx={{
                        fontSize: 10, color: 'text.disabled', fontFamily: 'monospace',
                        display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
                        overflow: 'hidden', overflowWrap: 'anywhere',
                    }}>
                        [{cols.join(', ')}]
                    </Typography>
                )}
            </Box>
        );
    } else if (kind === 'create_chart') {
        Icon = BarChartOutlinedIcon;
        iconColor = theme.palette.primary.main;
        body = (
            <Typography sx={{ fontSize: 11, color: 'text.primary' }}>
                <Box component="span">{ev.mark_or_type ?? '?'}</Box>
                <Box component="span" sx={{ color: 'text.disabled', ml: 0.75, fontFamily: 'monospace' }}>
                    on {ev.related_table_id ?? '?'}
                </Box>
                {ev.encoding_summary && (
                    <Box component="span" sx={{ color: 'text.disabled', ml: 0.5 }}>
                        — {ev.encoding_summary}
                    </Box>
                )}
            </Typography>
        );
    } else {
        Icon = InfoOutlinedIcon;
        iconColor = theme.palette.text.disabled;
        body = (
            <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>
                {String(kind ?? 'unknown')}
            </Typography>
        );
    }

    const accent = isUser
        ? (theme.palette.custom?.main || theme.palette.primary.main)
        : isToolCall
            ? theme.palette.text.disabled
            : theme.palette.primary.main;
    const bg = isToolCall ? 'transparent' : alpha(accent, 0.06);

    return (
        <Box sx={{
            display: 'flex', alignItems: 'flex-start', gap: 0.75,
            px: 1, py: 0.6,
            bgcolor: bg, borderRadius: '6px',
        }}>
            <Box sx={{ flexShrink: 0, mt: '2px' }}>
                <Icon sx={{ width: 14, height: 14, color: iconColor }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                {roleBadge && (
                    <Typography component="span" sx={{
                        fontSize: 9, fontWeight: 500, textTransform: 'uppercase',
                        color: 'text.disabled', letterSpacing: 0.3, mr: 0.5,
                    }}>
                        {roleBadge}
                    </Typography>
                )}
                {body}
            </Box>
        </Box>
    );
};
