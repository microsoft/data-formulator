// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The user's handle on background tasks: a pill by the input box listing them (with stop and log),
 * and the question asked when the agent is stopped while its tasks run.
 */

import React, { useEffect, useState } from 'react';
import {
    Box, Button, ButtonBase, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
    FormControlLabel, Popover, SxProps, Typography,
} from '@mui/material';
import { alpha, Theme } from '@mui/material/styles';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { useTranslation } from 'react-i18next';
import { textVar } from '../app/layout';
import { useSelector } from 'react-redux';
import { DataFormulatorState } from '../app/dfSlice';
import { BackgroundTask, readBackgroundTaskLog, refreshBackgroundTasks, stopBackgroundTasks, useBackgroundTasks } from '../app/backgroundTasks';

export const formatElapsed = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

/** A task's log, refreshed while it runs. */
const TaskLogDialog: React.FC<{ task: BackgroundTask | undefined; onClose: () => void }> = ({ task, onClose }) => {
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
                fontFamily: 'var(--df-font-mono, monospace)', bgcolor: 'rgba(0,0,0,0.04)', borderRadius: 1, whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere' }}>{log.text || t('backgroundTasks.noOutput')}</Box>
        </DialogContent>
        <DialogActions><Button onClick={onClose} sx={{ textTransform: 'none' }}>{t('app.close', { defaultValue: 'Close' })}</Button></DialogActions>
    </Dialog>;
};

/**
 * The background tasks of the session, as a pill that opens their list: what each does, the request that
 * started it, how long it has run, its latest output, and stop / log. Shown only while tasks run: the agent reports
 * the ones that ended.
 */
export const BackgroundTasksPill: React.FC<{
    /** The request that started a task (from its run's id), to name it and jump to it. */
    requestOf?: (conversationId: string) => { text: string; open: () => void } | undefined;
    sx?: SxProps<Theme>;
}> = ({ requestOf, sx }) => {
    const { t } = useTranslation();
    const all = useBackgroundTasks();
    const tasks = all.filter(task => task.status === 'running');
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [logTaskId, setLogTaskId] = useState<string>();
    // Each session has its own tasks.
    const workspaceId = useSelector((state: DataFormulatorState) => state.activeWorkspace?.id);
    useEffect(() => { void refreshBackgroundTasks(); }, [workspaceId]);
    if (!tasks.length) return null;
    return <Box sx={sx}>
        <ButtonBase data-background-tasks-pill onClick={event => setAnchor(event.currentTarget)}
            aria-label={t('backgroundTasks.title')}
            sx={theme => ({ display: 'inline-flex', alignItems: 'center', gap: '4px', px: '6px', py: '1px', borderRadius: '4px',
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
            <Typography sx={{ px: 1.5, pt: 1, pb: 0.5, fontSize: textVar.xs, fontWeight: 600 }}>{t('backgroundTasks.title')}</Typography>
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
                            {task.stopped_by ? t('backgroundTasks.status.stopping') : t('backgroundTasks.status.running')} · {formatElapsed(task.elapsed_seconds)}
                            {request && <> · <Box component="span" role="button" tabIndex={0}
                                onClick={() => { request.open(); setAnchor(null); }}
                                onKeyDown={event => { if (event.key === 'Enter') { request.open(); setAnchor(null); } }}
                                sx={{ cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'rgba(0,0,0,0.2)',
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
                        {t('backgroundTasks.alsoStop')} · {formatElapsed(task.elapsed_seconds)}
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
