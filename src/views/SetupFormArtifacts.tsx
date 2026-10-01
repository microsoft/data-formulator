// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Canvas views for the configure skill's schedule and session forms. Like the
 * connector form, each is a prefilled artifact the user reviews and submits;
 * submission uses the same APIs as the Schedules dialog and Sessions panel.
 * A form the agent applied directly submits itself once on arrival.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import { ItemCard, MetaChip } from '../components/ItemCard';
import { SessionCard, SessionCardAction, sessionCardGridSx } from '../components/SessionCard';
import { ArtifactDeleteButton } from './DataThreadCards';
import CheckIcon from '@mui/icons-material/Check';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import { apiRequest } from '../app/apiClient';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { textVar } from '../app/layout';
import { deleteSession, openSession, renameSession } from '../app/sessionThunks';
import { takeAutoSubmit } from '../app/setupForms';
import { openSessionInNewTab } from '../app/sessionTabs';
import type { ScheduleConfig, ScheduleFormArtifact, SessionsFormArtifact, TextTurn } from '../components/ComponentType';
import { defaultScheduleConfig, listWorkflowLibrary, saveSchedule, ScheduleConfigFields, scheduleCadence, WorkflowLibraryItem } from './WorkflowPanel';

const errorMessage = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback;

const SetupFormFrame: React.FC<{ icon: React.ReactNode; title: string; done?: boolean; children: React.ReactNode;
    actions?: React.ReactNode }> = ({ icon, title, done, children, actions }) =>
    <Box component="section" aria-label={title} sx={{ width: '100%', minWidth: 0, fontFamily: theme => theme.typography.fontFamily }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1.5, mb: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', color: 'text.secondary', '& svg': { fontSize: 18 } }}>{icon}</Box>
            <Typography component="h1" sx={{ m: 0, minWidth: 0, fontSize: textVar.lg, fontWeight: 600, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
                {title}
            </Typography>
            {done && <CheckIcon aria-hidden sx={{ fontSize: 16, color: 'success.main', ml: 'auto', flexShrink: 0 }} />}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</Box>
        {actions && <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 3 }}>{actions}</Box>}
    </Box>;

export const ScheduleFormArtifactView: React.FC<{ turn: TextTurn; form: ScheduleFormArtifact }> = ({ turn, form }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const models = useSelector((state: DataFormulatorState) => state.globalModels);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const [items, setItems] = useState<WorkflowLibraryItem[] | null>(null);
    const [available, setAvailable] = useState<boolean | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const { schedule } = form;
    const saved = schedule.status === 'saved';
    const hosted = !!schedule.hosted;
    const config: ScheduleConfig = useMemo(() => ({
        ...defaultScheduleConfig(models, selectedModelId), ...(hosted ? { publish: true } : {}), ...schedule.config,
    }), [models, selectedModelId, hosted, schedule.config]);
    const update = (patch: Partial<ScheduleFormArtifact['schedule']>, extra: Partial<TextTurn> = {}) =>
        dispatch(dfActions.updateTextTurn({ id: turn.id, ...extra, form: { ...form, schedule: { ...schedule, ...patch } } }));

    useEffect(() => {
        let cancelled = false;
        Promise.all([listWorkflowLibrary(), apiRequest<{ available: boolean }>('/api/schedules')])
            .then(([library, { data }]) => { if (!cancelled) { setItems(library); setAvailable(data.available); } })
            .catch(reason => { if (!cancelled) { setItems([]); setAvailable(false); setError(errorMessage(reason, 'Unable to load workflows.')); } });
        return () => { cancelled = true; };
    }, []);

    const problems = [
        !config.workflow || (items && !items.some(item => item.path === config.workflow)) ? t('setupForm.chooseWorkflow', { defaultValue: 'Choose a saved workflow.' }) : '',
        !config.name.trim() ? t('setupForm.nameSchedule', { defaultValue: 'Name the schedule.' }) : '',
        !config.weekdays.length ? t('setupForm.chooseDays', { defaultValue: 'Choose at least one day.' }) : '',
        !config.model_id ? t('setupForm.chooseModel', { defaultValue: 'Choose a server model connection.' }) : '',
        hosted && !config.publish ? t('setupForm.hostedPublish', { defaultValue: 'Hosted schedules must publish their results.' }) : '',
    ].filter(Boolean);

    const submit = async () => {
        if (saving || problems.length || !available) return;
        setSaving(true); setError('');
        try {
            const result = await saveSchedule(config, schedule.scheduleId);
            update({ config, status: 'saved', savedId: result.id, nextAt: result.next_at, issues: [] },
                { answered: true, answer: `Saved schedule ${config.name}` });
        } catch (reason) {
            setError(errorMessage(reason, 'Unable to save schedule.'));
        } finally {
            setSaving(false);
        }
    };

    // A directly applied schedule submits once, after the library loads, when it has no open issues.
    useEffect(() => {
        if (items === null || available === null || saved || !takeAutoSubmit(turn.id)) return;
        // Elevated options always need the user's own Save, even if the agent asked to apply directly.
        if (!problems.length && !schedule.issues?.length && available && !config.auto_approve && !config.publish) void submit();
    }, [items, available]);

    if (saved) {
        return <SetupFormFrame icon={<ScheduleOutlinedIcon />} title={form.title} done>
            <ItemCard titleChip={<ScheduleOutlinedIcon sx={{ fontSize: 12 }} />} title={config.name}
                meta={<>
                    <MetaChip icon={<HistoryOutlinedIcon />}>{scheduleCadence(config)} · {config.timezone}</MetaChip>
                    {config.enabled !== false && schedule.nextAt && <MetaChip icon={<ScheduleOutlinedIcon />}
                        label={t('setupForm.nextRun', { defaultValue: 'Next run' })}>{new Date(schedule.nextAt).toLocaleString()}</MetaChip>}
                </>}
                note={config.enabled === false
                    ? t('setupForm.schedulePaused', { defaultValue: 'Saved paused. Resume it from Workflows → Schedules.' })
                    : t('setupForm.scheduleSaved', { defaultValue: 'Saved. Manage it from Workflows → Schedules.' })} />
        </SetupFormFrame>;
    }
    return <SetupFormFrame icon={<ScheduleOutlinedIcon />} title={form.title} actions={<Button variant="contained" disableElevation
        disabled={saving || !available || problems.length > 0} onClick={() => void submit()}
        startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}>
        {schedule.scheduleId ? t('setupForm.updateSchedule', { defaultValue: 'Update schedule' }) : t('setupForm.saveSchedule', { defaultValue: 'Save schedule' })}
    </Button>}>
        {!!schedule.issues?.length && <Alert severity="warning">{schedule.issues.map(issue => <Box key={issue}>{issue}</Box>)}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        {items === null ? <CircularProgress size={18} /> : available === false
            ? <Alert severity="info">{t('setupForm.schedulingUnavailable', { defaultValue: 'Scheduling is unavailable for this deployment or account.' })}</Alert>
            : <ScheduleConfigFields items={items} config={config} hosted={hosted} disabled={saving}
                onChange={next => update({ config: next, issues: [] })} />}
    </SetupFormFrame>;
};

type SessionItem = SessionsFormArtifact['sessions']['items'][number];

const sessionSubtitle = (item: SessionItem) => [
    item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '',
    item.tableCount != null ? `${item.tableCount} table${item.tableCount === 1 ? '' : 's'}` : '',
    item.chartCount != null ? `${item.chartCount} chart${item.chartCount === 1 ? '' : 's'}` : '',
].filter(Boolean).join(' · ');

/** A session panel: each card is renamed, opened in a new tab, or deleted on its own. */
export const SessionsFormArtifactView: React.FC<{ turn: TextTurn; form: SessionsFormArtifact }> = ({ turn, form }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const activeId = useSelector((state: DataFormulatorState) => state.activeWorkspace?.id);
    const activeName = useSelector((state: DataFormulatorState) => state.activeWorkspace?.displayName);
    const readOnly = useSelector((state: DataFormulatorState) => !!state.activeWorkspace?.readOnly);
    const [editing, setEditing] = useState<{ sessionId: string; value: string } | null>(null);
    const [pendingDelete, setPendingDelete] = useState<SessionItem | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');
    const { sessions } = form;
    const setItem = (sessionId: string, patch: Partial<SessionItem>) => dispatch(dfActions.updateTextTurn({ id: turn.id,
        form: { ...form, sessions: { ...sessions, items: sessions.items.map(item => item.sessionId === sessionId ? { ...item, ...patch } : item) } } }));
    const isCurrent = (item: SessionItem) => item.current || item.sessionId === activeId;
    const nameOf = (item: SessionItem) => isCurrent(item) && activeName ? activeName : item.currentName;

    const rename = async (item: SessionItem, value: string) => {
        const next = value.trim();
        setEditing(null);
        if (!next || next === nameOf(item)) return;
        setBusy(item.sessionId); setError('');
        try {
            await dispatch(renameSession(item.sessionId, next));
            setItem(item.sessionId, { currentName: next, suggestedName: undefined });
        } catch {
            setError(t('setupForm.renameFailed', { defaultValue: 'Could not rename {{name}}.', name: nameOf(item) }));
        } finally { setBusy(null); }
    };
    const remove = async (item: SessionItem) => {
        setPendingDelete(null);
        setBusy(item.sessionId); setError('');
        try {
            await dispatch(deleteSession(item.sessionId));
            setItem(item.sessionId, { deleted: true });
        } catch {
            setError(t('setupForm.deleteFailed', { defaultValue: 'Could not delete {{name}}.', name: nameOf(item) }));
        } finally { setBusy(null); }
    };

    // Direct application: the user asked to rename or open these sessions.
    useEffect(() => {
        if (!takeAutoSubmit(turn.id) || readOnly) return;
        void (async () => {
            for (const item of sessions.items) if (item.suggestedName) await rename(item, item.suggestedName);
            if (sessions.open && sessions.open.sessionId !== activeId) await dispatch(openSession(sessions.open.sessionId, sessions.open.displayName));
        })();
    }, []);

    return <SetupFormFrame icon={<FolderOpenOutlinedIcon />} title={form.title}
        actions={sessions.open && sessions.open.sessionId !== activeId ? <Button variant="contained" disableElevation
            onClick={() => void dispatch(openSession(sessions.open!.sessionId, sessions.open!.displayName))}>
            {t('setupForm.openNamed', { defaultValue: 'Open {{name}}', name: sessions.open.displayName })}
        </Button> : undefined}>
        {error && <Alert severity="error">{error}</Alert>}
        {readOnly && <Alert severity="info">{t('setupForm.readOnlySession', { defaultValue: 'This session is read-only. Fork it to make changes.' })}</Alert>}
        <Box component="ul" aria-label={form.title} sx={{ listStyle: 'none', m: 0, p: 0, ...sessionCardGridSx }}>
            {sessions.items.map(item => {
                const current = isCurrent(item);
                const name = nameOf(item);
                const disabled = readOnly || busy === item.sessionId;
                return <Box component="li" key={item.sessionId} sx={{ minWidth: 0 }}>
                    <SessionCard
                        name={name}
                        inactive={item.deleted}
                        rename={editing?.sessionId === item.sessionId ? {
                            value: editing.value, label: t('setupForm.sessionName', { defaultValue: 'Name of {{name}}', name }),
                            onChange: value => setEditing({ sessionId: item.sessionId, value }),
                            onCommit: () => void rename(item, editing.value), onCancel: () => setEditing(null),
                        } : undefined}
                        captions={item.deleted ? [t('setupForm.deleted', { defaultValue: 'Deleted' })] : [
                            [current ? t('setupForm.currentSession', { defaultValue: 'Current' }) : '', sessionSubtitle(item)].filter(Boolean).join(' · '),
                            item.reason,
                            item.suggestedName ? t('setupForm.suggestedName', { defaultValue: 'Suggested name: {{name}}', name: item.suggestedName }) : '',
                        ]}
                        actions={<>
                            <SessionCardAction label={t('setupForm.renameNamed', { defaultValue: 'Rename {{name}}', name })} icon={<EditOutlinedIcon />}
                                disabled={disabled} onClick={() => setEditing({ sessionId: item.sessionId, value: item.suggestedName || name })} />
                            {!current && <SessionCardAction label={t('setupForm.openNamedNewTab', { defaultValue: 'Open {{name}} in new tab', name })}
                                icon={<OpenInNewIcon />} onClick={() => openSessionInNewTab(item.sessionId)} />}
                            {!current && <ArtifactDeleteButton label={t('setupForm.deleteNamed', { defaultValue: 'Delete {{name}}', name })}
                                disabled={disabled} onClick={() => setPendingDelete(item)} />}
                        </>}
                    />
                </Box>;
            })}
        </Box>
        <Dialog open={!!pendingDelete} onClose={() => setPendingDelete(null)} maxWidth="xs" fullWidth>
            <DialogTitle>{t('setupForm.confirmDeleteOne', { defaultValue: 'Delete session?' })}</DialogTitle>
            <DialogContent>
                <Typography sx={{ overflowWrap: 'anywhere' }}>{pendingDelete && nameOf(pendingDelete)}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {t('setupForm.confirmDeleteBody', { defaultValue: 'Its data, charts, and files are removed. This cannot be undone.' })}
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setPendingDelete(null)}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
                <Button color="error" variant="contained" disableElevation onClick={() => pendingDelete && void remove(pendingDelete)}>
                    {t('setupForm.delete', { defaultValue: 'Delete' })}
                </Button>
            </DialogActions>
        </Dialog>
    </SetupFormFrame>;
};
