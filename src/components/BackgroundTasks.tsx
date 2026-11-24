// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The user's handle on background tasks: a pill by the input box listing them (with stop and log), the question
 * asked when the agent is stopped while its tasks run, and how the thread shows tasks (their own group apart from
 * tool calls, and the events about them).
 */

import React, { useEffect, useState } from 'react';
import {
    Box, Button, ButtonBase, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
    FormControlLabel, Popover, SxProps, Tooltip, Typography,
} from '@mui/material';
import { alpha, Theme } from '@mui/material/styles';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import TerminalIcon from '@mui/icons-material/Terminal';
import { useTranslation } from 'react-i18next';
import { textVar } from '../app/layout';
import { useSelector } from 'react-redux';
import { DataFormulatorState } from '../app/dfSlice';
import { BackgroundTask, readBackgroundTaskLog, resetBackgroundTasks, stopBackgroundTasks, useBackgroundTaskList,
    taskViewOf, useBackgroundTasks, type TaskStartCall, type TaskStatus, type TaskView } from '../app/backgroundTasks';
import { ink, quietText, weight } from '../app/tokens';
import { ThreadEventRow } from './ThreadEventRow';

export const formatElapsed = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

/** The time from `started` to `ended` (epoch seconds) as text. */
export const durationText = (started: number, ended: number): string => formatElapsed(Math.max(0, Math.floor(ended - started)));

/** A task's time from its start: counting every second until it has an end. Tasks run locally, so the clocks agree. */
export const Elapsed: React.FC<{ started: number; ended?: number | null }> = ({ started, ended }) => {
    const [now, setNow] = useState(() => Date.now() / 1000);
    useEffect(() => {
        if (ended != null) return;
        setNow(Date.now() / 1000);
        const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
        return () => clearInterval(timer);
    }, [ended]);
    return <>{durationText(started, ended ?? now)}</>;
};

/** A task's log, refreshed while it runs. */
export const TaskLogDialog: React.FC<{ task: BackgroundTask | undefined; onClose: () => void }> = ({ task, onClose }) => {
    const { t } = useTranslation();
    const [log, setLog] = useState<{ text: string; truncated: boolean }>({ text: '', truncated: false });
    const taskId = task?.id;
    const running = task?.status === 'running';
    useEffect(() => {
        if (!taskId) return;
        let live = true;
        const load = () => readBackgroundTaskLog(taskId)
            .then(({ log: text, truncated }) => { if (live) setLog({ text, truncated }); })
            .catch(() => undefined);
        void load();
        const timer = running ? setInterval(load, 3000) : undefined;
        return () => { live = false; clearInterval(timer); };
    }, [taskId, running]);
    return <Dialog open={!!task} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: textVar.md, pb: 0.5 }}>{task?.purpose}</DialogTitle>
        <DialogContent>
            <Typography sx={{ fontSize: textVar.xxs, color: 'text.secondary', fontFamily: 'var(--df-font-mono, monospace)', mb: 1,
                overflowWrap: 'anywhere' }}>{task?.command}</Typography>
            {log.truncated && <Typography sx={{ fontSize: textVar.xxs, color: 'text.disabled', mb: 0.5 }}>{t('backgroundTasks.logTruncated')}</Typography>}
            <Box component="pre" data-task-log sx={{ m: 0, p: 1.5, maxHeight: '60vh', overflow: 'auto', fontSize: textVar.xxs,
                fontFamily: 'var(--df-font-mono, monospace)', bgcolor: ink(0.04), borderRadius: 1, whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere' }}>{log.text || t('backgroundTasks.noOutput')}</Box>
        </DialogContent>
        <DialogActions><Button onClick={onClose} sx={{ textTransform: 'none' }}>{t('app.close', { defaultValue: 'Close' })}</Button></DialogActions>
    </Dialog>;
};

// -- A task in the thread -------------------------------------------------------------------------------------------

const STATUS_ICONS: Record<Exclude<TaskStatus, 'running'>, typeof HelpOutlineIcon> = {
    completed: CheckCircleOutlineIcon, failed: ErrorOutlineIcon, timed_out: ErrorOutlineIcon,
    stopped: PauseCircleOutlineIcon, unknown: HelpOutlineIcon, not_started: ErrorOutlineIcon,
};

/** A task status as a word: running, finished, failed, stopped… */
export const useTaskStatusWord = () => {
    const { t } = useTranslation();
    return (status: TaskStatus) => t(`backgroundTasks.status.${status}`, { defaultValue: status });
};

/** How a task's status reads after its name: the time while it runs or once finished; how it ended and when otherwise. */
const TaskTime: React.FC<{ view: TaskView }> = ({ view }) => {
    const word = useTaskStatusWord();
    if (view.status === 'not_started') return <>{word(view.status)}</>;
    if (view.started == null || view.status === 'unknown') return null;
    if (view.status === 'running' || view.status === 'completed') return <Elapsed started={view.started} ended={view.ended} />;
    return <>{word(view.status)}{view.ended != null ? ` · ${durationText(view.started, view.ended)}` : ''}</>;
};

/** One background task in the thread: what it does, its time, its status. */
export const TaskRow: React.FC<{ view: TaskView; purpose: string; onClick: () => void }> = ({ view, purpose, onClick }) => {
    const word = useTaskStatusWord();
    const label = [word(view.status), view.started != null && view.ended != null ? durationText(view.started, view.ended) : '']
        .filter(Boolean).join(' · ');
    const Icon = view.status === 'running' ? null : STATUS_ICONS[view.status];
    return <ButtonBase data-thread-background-task={view.id} aria-label={purpose} title={purpose} onClick={onClick}
        sx={{ display: 'flex', width: '100%', minWidth: 0, justifyContent: 'flex-start', gap: 0.5, py: '2px', pr: 0.5,
            borderRadius: 0.5, color: 'text.secondary', textAlign: 'left', '&:hover': { bgcolor: 'action.hover' },
            '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
        <TerminalIcon sx={{ width: 10, height: 10, flexShrink: 0 }} />
        <Typography component="span" sx={{ flex: 1, minWidth: 0, fontSize: textVar.xxs, ...quietText,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{purpose}</Typography>
        <Typography component="span" sx={{ flexShrink: 0, fontSize: textVar.xxs, color: 'text.disabled', whiteSpace: 'nowrap' }}>
            <TaskTime view={view} />
        </Typography>
        <Tooltip title={label}>
            <Box component="span" role={Icon ? 'img' : undefined} aria-label={Icon ? label : undefined}
                sx={{ width: 12, height: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {Icon ? <Icon sx={{ width: 10, height: 10 }} /> : <CircularProgress size={8} color="inherit" aria-label={label} />}
            </Box>
        </Tooltip>
    </ButtonBase>;
};

/** A task the thread knows: the command meant to start it (its result, once it has one), and what it does. */
export interface ThreadTask { call: TaskStartCall; purpose: string; onOpen?: () => void }

/** Counts of tasks by status: "2 running · 1 finished". */
const useTaskSummary = () => {
    const word = useTaskStatusWord();
    return (views: TaskView[]) => (['running', 'completed', 'failed', 'timed_out', 'stopped', 'not_started', 'unknown'] as TaskStatus[])
        .map(status => [status, views.filter(view => view.status === status).length] as const)
        .filter(([, count]) => count > 0).map(([status, count]) => `${count} ${word(status)}`).join(' · ');
};

/** Rows for tasks; a row opens its task's log while the server knows it, else what the command returned (why a task
 *  did not start, say). */
const TaskRows: React.FC<{ tasks: ThreadTask[]; views: TaskView[] }> = ({ tasks, views }) => {
    const list = useBackgroundTaskList();
    const [logTaskId, setLogTaskId] = useState<string>();
    return <>
        {tasks.map((item, index) => <TaskRow key={views[index].id} view={views[index]} purpose={item.purpose}
            onClick={() => views[index].task ? setLogTaskId(views[index].id) : item.onOpen?.()} />)}
        {logTaskId && <TaskLogDialog task={list.tasks.find(task => task.id === logTaskId)} onClose={() => setLogTaskId(undefined)} />}
    </>;
};

/**
 * Background tasks a step started, as the thread shows them apart from its tool calls: one task is its row; several
 * fold into a row that says how they are doing ("3 background tasks · 2 running · 1 finished").
 */
export const BackgroundTaskGroup: React.FC<{ tasks: ThreadTask[] }> = ({ tasks }) => {
    const { t } = useTranslation();
    const list = useBackgroundTaskList();
    const summary = useTaskSummary();
    const views = tasks.map(item => taskViewOf(item.call, list));
    if (tasks.length === 1) return <TaskRows tasks={tasks} views={views} />;
    return <ThreadEventRow data-event="background-tasks" icon={<TerminalIcon />} live={views.some(view => view.status === 'running')}
        label={t('backgroundTasks.group', { count: tasks.length })} note={summary(views)}>
        <TaskRows tasks={tasks} views={views} />
    </ThreadEventRow>;
};

/**
 * An event about tasks (they ended, a check-in, the user asked for an update): its label, and the tasks it is about,
 * as they are now, behind it.
 */
export const TaskEventRow: React.FC<{ label: string; taskIds: string[]; live?: boolean }> = ({ label, taskIds, live }) => {
    const list = useBackgroundTaskList();
    const summary = useTaskSummary();
    const turns = useSelector((state: DataFormulatorState) => state.textTurns);
    const tasks: ThreadTask[] = taskIds.flatMap((id): ThreadTask[] => {
        const execution = turns.flatMap(turn => turn.executions || []).find(item => item.result?.background_task === id);
        if (execution) return [{ call: execution, purpose: execution.purpose }];
        const task = list.tasks.find(item => item.id === id);
        return task ? [{ call: { id, status: 'completed', result: { background_task: id } }, purpose: task.purpose }] : [];
    });
    const views = tasks.map(item => taskViewOf(item.call, list));
    return <ThreadEventRow data-event="task-wake" icon={<NotificationsNoneIcon />} live={live} label={label}
        note={views.length ? summary(views) : undefined}>
        {tasks.length > 0 && <TaskRows tasks={tasks} views={views} />}
    </ThreadEventRow>;
};

/**
 * The background tasks of the session, as a pill that opens their list: what each does, the request that
 * started it, how long it has run, its latest output, and stop / log. Shown only while tasks run: the agent reports
 * the ones that ended.
 */
export const BackgroundTasksPill: React.FC<{
    /** The request that started a task (from its run's id), to name it and jump to it. */
    requestOf?: (conversationId: string) => { text: string; open: () => void } | undefined;
    /** Ask the agent how the tasks are going (a working run is checked in on; else the app sends it a follow-up). */
    onAskUpdate?: () => void;
    sx?: SxProps<Theme>;
}> = ({ requestOf, onAskUpdate, sx }) => {
    const { t } = useTranslation();
    const all = useBackgroundTasks();
    const tasks = all.filter(task => task.status === 'running');
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [logTaskId, setLogTaskId] = useState<string>();
    // Each session has its own tasks.
    const workspaceId = useSelector((state: DataFormulatorState) => state.activeWorkspace?.id);
    useEffect(() => { resetBackgroundTasks(); }, [workspaceId]);
    if (!tasks.length) return null;
    return <Box sx={sx}>
        <ButtonBase data-background-tasks-pill onClick={event => setAnchor(event.currentTarget)}
            aria-label={t('backgroundTasks.title')}
            sx={theme => ({ display: 'inline-flex', alignItems: 'center', gap: '4px', px: '6px', py: '1px', borderRadius: 1,
                fontSize: textVar.xxs, color: 'text.secondary', border: `1px solid ${theme.palette.divider}`,
                bgcolor: 'background.paper', '&:hover': { color: 'text.primary', bgcolor: alpha(theme.palette.text.primary, 0.04) },
                '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 } })}>
            <CircularProgress size={10} thickness={6} />
            {t('backgroundTasks.running', { count: tasks.length })}
            <KeyboardArrowDownIcon sx={{ fontSize: 13 }} />
        </ButtonBase>
        <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            slotProps={{ paper: { sx: { width: 380, maxHeight: 420, mb: 0.5 } } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, pt: 1, pb: 0.5 }}>
                <Typography sx={{ flex: 1, fontSize: textVar.xs, fontWeight: weight(600) }}>{t('backgroundTasks.title')}</Typography>
                {onAskUpdate && <Button size="small" onClick={() => { onAskUpdate(); setAnchor(null); }}
                    sx={{ minWidth: 0, px: 0.75, py: 0, fontSize: textVar.xxs, textTransform: 'none' }}>{t('backgroundTasks.askUpdate')}</Button>}
            </Box>
            {[...tasks].reverse().map(task => {
                const request = requestOf?.(task.conversation_id);
                const lastLine = task.last_lines[task.last_lines.length - 1];
                return <Box key={task.id} data-background-task={task.id} data-status={task.status}
                    sx={{ display: 'flex', gap: 1, px: 1.5, py: 1, borderTop: 1, borderColor: 'divider' }}>
                    <CircularProgress size={12} thickness={5} sx={{ flexShrink: 0, mt: '3px' }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: textVar.xs, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{task.purpose}</Typography>
                        <Typography sx={{ fontSize: textVar.xxs, color: 'text.secondary', mt: '2px' }}>
                            {task.stopped_by ? t('backgroundTasks.status.stopping') : t('backgroundTasks.status.running')} · <Elapsed started={task.started} />
                            {request && <> · <Box component="span" role="button" tabIndex={0}
                                onClick={() => { request.open(); setAnchor(null); }}
                                onKeyDown={event => { if (event.key === 'Enter') { request.open(); setAnchor(null); } }}
                                sx={{ cursor: 'pointer', textDecoration: 'underline', textDecorationColor: ink(0.2),
                                    '&:hover': { color: 'text.primary' } }}>{request.text.length > 40 ? `${request.text.slice(0, 40)}…` : request.text}</Box></>}
                        </Typography>
                        {lastLine && <Typography sx={{ fontSize: textVar.xxs, color: 'text.disabled', mt: '2px', fontFamily: 'var(--df-font-mono, monospace)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lastLine}</Typography>}
                        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                            <Button size="small" onClick={() => setLogTaskId(task.id)}
                                sx={{ minWidth: 0, px: 0.75, py: 0, fontSize: textVar.xxs, textTransform: 'none' }}>{t('backgroundTasks.log')}</Button>
                            {!task.stopped_by && <Button size="small" color="error" onClick={() => void stopBackgroundTasks([task.id])}
                                sx={{ minWidth: 0, px: 0.75, py: 0, fontSize: textVar.xxs, textTransform: 'none' }}>{t('backgroundTasks.stop')}</Button>}
                        </Box>
                    </Box>
                </Box>;
            })}
        </Popover>
        <TaskLogDialog task={all.find(task => task.id === logTaskId)} onClose={() => setLogTaskId(undefined)} />
    </Box>;
};

/**
 * Stopping the agent while tasks it started still run: they keep running unless the user ticks them too.
 */
export const StopAgentDialog: React.FC<{
    tasks: BackgroundTask[];
    open: boolean;
    onClose: () => void;
    onStop: (alsoStopTaskIds: string[]) => void;
}> = ({ tasks, open, onClose, onStop }) => {
    const { t } = useTranslation();
    const [picked, setPicked] = useState<Set<string>>(new Set());
    useEffect(() => { if (open) setPicked(new Set()); }, [open]);
    const toggle = (id: string) => setPicked(previous => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    return <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth data-stop-agent-dialog>
        <DialogTitle sx={{ fontSize: textVar.md }}>{t('backgroundTasks.stopDialogTitle')}</DialogTitle>
        <DialogContent sx={{ pb: 1 }}>
            <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary', mb: 1 }}>
                {t('backgroundTasks.stopDialogBody', { count: tasks.length })}
            </Typography>
            {tasks.map(task => <FormControlLabel key={task.id} sx={{ display: 'flex', alignItems: 'flex-start', mx: 0, mb: 0.5 }}
                control={<Checkbox size="small" checked={picked.has(task.id)} onChange={() => toggle(task.id)} sx={{ p: 0.5, mt: '-2px' }} />}
                label={<Box>
                    <Typography sx={{ fontSize: textVar.sm, lineHeight: 1.4 }}>{task.purpose}</Typography>
                    <Typography sx={{ fontSize: textVar.xxs, color: 'text.secondary' }}>
                        {t('backgroundTasks.alsoStop')} · <Elapsed started={task.started} />
                    </Typography>
                </Box>} />)}
        </DialogContent>
        <DialogActions>
            <Button onClick={onClose} sx={{ textTransform: 'none' }}>{t('app.cancel', { defaultValue: 'Cancel' })}</Button>
            <Button color="error" variant="contained" disableElevation onClick={() => onStop([...picked])} sx={{ textTransform: 'none' }}>
                {picked.size ? t('backgroundTasks.stopAgentAndTasks', { count: picked.size }) : t('backgroundTasks.stopAgent')}
            </Button>
        </DialogActions>
    </Dialog>;
};
