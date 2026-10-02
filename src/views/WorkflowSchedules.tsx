// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow schedules: the sidebar Schedules tab, the Schedules dialog, and the
 * fields shared with agent-proposed schedule forms; plus the workflow library
 * API, setup fields, and run chips they share with the workflow panel.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';
import { Alert, Autocomplete, Box, Button, ButtonBase, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
    FormControlLabel, IconButton, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import PauseIcon from '@mui/icons-material/Pause';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { ItemCard, itemCardGridSx, ViewAllButton } from '../components/ItemCard';
import { sidebarPrimaryActionSx, sidebarToolbarSx } from '../app/tokens';
import { apiRequest } from '../app/apiClient';
import { DataFormulatorState } from '../app/dfSlice';
import { iconVar, textVar } from '../app/layout';
import { ListDetailDialog } from '../components/ListDetailDialog';
import type { ScheduleConfig } from '../components/ComponentType';

export interface WorkflowParameter {
    name: string; label: string; type?: 'text' | 'number' | 'boolean' | 'select'; description?: string;
    required?: boolean; default?: string | number | boolean; options?: string[]; allow_custom?: boolean;
}
export interface WorkflowSetup { parameters: Record<string, string | number | boolean>; instructions: string }
export interface WorkflowLibraryItem { path: string; name: string; overview?: string; error?: string; origin?: 'user' | 'demo' | 'server'; parameters?: WorkflowParameter[]; content?: string }

/** POST to a `/api/workflows/<route>` endpoint and return its data. */
export async function workflowApi<T>(route: string, body: object = {}, signal?: AbortSignal): Promise<T> {
    const { data } = await apiRequest<T>(`/api/workflows/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
    });
    return data;
}

export const listWorkflowLibrary = async () => (await workflowApi<{ items: WorkflowLibraryItem[] }>('list')).items;

export const workflowSetupContentSx = {
    display: 'flex', flexDirection: 'column', gap: 2.5, pb: 2.5,
    '& .MuiInputBase-root': { fontSize: textVar.md, lineHeight: 1.5 },
    '& .MuiInputLabel-root': { fontSize: textVar.md },
    '& .MuiFormHelperText-root': { fontSize: textVar.xs, lineHeight: 1.6, mt: 0.75 },
    '& .MuiFormControlLabel-label': { fontSize: textVar.md },
    '& .MuiTypography-caption': { display: 'block', fontSize: textVar.xs, lineHeight: 1.6, mt: 0.5 },
};

export const WorkflowSetupFields: React.FC<{ parameters: WorkflowParameter[]; values: WorkflowSetup['parameters'];
    onChange: (values: WorkflowSetup['parameters']) => void; disabled: boolean }> = ({ parameters, values, onChange, disabled }) => <>
    {parameters.map(parameter => {
        const value = values[parameter.name] ?? '';
        const update = (value: string | boolean) => onChange({ ...values, [parameter.name]: value });
        if (parameter.type === 'boolean') return <Box key={parameter.name}>
            <FormControlLabel label={parameter.label} control={<Checkbox size="small" checked={value === true}
                disabled={disabled} onChange={(_, checked) => update(checked)} />} />
            {parameter.description && <Typography variant="caption" color="text.secondary">{parameter.description}</Typography>}
        </Box>;
        if (parameter.type === 'select' && parameter.allow_custom) return <Autocomplete key={parameter.name}
            freeSolo forcePopupIcon openOnFocus options={parameter.options || []} value={String(value) || null} inputValue={String(value)} disabled={disabled}
            onInputChange={(_, value) => update(value)} renderInput={params => <TextField {...params} size="small" label={parameter.label}
                required={parameter.required} helperText={parameter.description} slotProps={{ htmlInput: { ...params.inputProps, maxLength: 4000 } }} />} />;
        return <TextField key={parameter.name} size="small" fullWidth label={parameter.label} required={parameter.required}
            disabled={disabled} helperText={parameter.description} value={value} onChange={event => update(event.target.value)}
            select={parameter.type === 'select'} type={parameter.type === 'number' ? 'number' : 'text'} slotProps={{ htmlInput: { maxLength: 4000, step: 'any' } }}>
            {parameter.type === 'select' && !parameter.required && <MenuItem value="">Not specified</MenuItem>}
            {parameter.type === 'select' && parameter.options?.map(option => <MenuItem key={option} value={option}>{option}</MenuItem>)}
        </TextField>;
    })}
</>;

export interface WorkflowSchedule {
    id: string; config: ScheduleConfig; next_at: string;
    history?: { id: string; scheduled_for: string; status: string; message: string; attempts: number }[];
}

export const scheduleCadence = (config: ScheduleConfig) => {
    const days = [...config.weekdays].sort();
    const cadence = days.length === 7 ? 'Daily' : days.join() === '0,1,2,3,4' ? 'Weekdays'
        : days.map(day => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day]).join(', ');
    return `${cadence} at ${config.time}`;
};

export const defaultScheduleConfig = (models: { id: string }[], selectedModelId?: string): ScheduleConfig => ({
    name: '', workflow: '', model_id: models.find(model => model.id === selectedModelId)?.id || models[0]?.id || '', time: '09:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, weekdays: [0, 1, 2, 3, 4, 5, 6], enabled: true,
    auto_approve: false, max_retries: 2, catch_up: false, publish: false,
});

const schedulesChanged = new EventTarget();
export const onSchedulesChanged = (listener: () => void) => {
    schedulesChanged.addEventListener('change', listener);
    return () => schedulesChanged.removeEventListener('change', listener);
};

/** Save a schedule through the same route as the Schedules dialog and notify schedule views. */
export async function saveSchedule(config: ScheduleConfig, identifier?: string): Promise<WorkflowSchedule> {
    const { data } = await apiRequest<{ schedule: WorkflowSchedule }>('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(identifier ? { id: identifier } : {}), config }) });
    schedulesChanged.dispatchEvent(new Event('change'));
    return data.schedule;
}

/** Schedule fields shared by the Schedules dialog and agent-proposed schedule forms. */
export const ScheduleConfigFields: React.FC<{ items: WorkflowLibraryItem[]; config: ScheduleConfig; onChange: (config: ScheduleConfig) => void;
    hosted: boolean; disabled: boolean }> = ({ items, config, onChange, hosted, disabled }) => {
    const models = useSelector((state: DataFormulatorState) => state.globalModels);
    const [customDays, setCustomDays] = useState(false);
    const workflow = items.find(item => item.path === config.workflow);
    const repeat = customDays ? 'custom' : config.weekdays.length === 7 ? 'daily'
        : config.weekdays.length === 5 && [0, 1, 2, 3, 4].every(day => config.weekdays.includes(day)) ? 'weekdays' : 'custom';
    return <>
        <TextField size="small" select required label="Workflow" value={config.workflow} disabled={disabled}
            onChange={event => {
                const selected = items.find(item => item.path === event.target.value);
                onChange({ ...config, workflow: event.target.value, name: !config.name || config.name === workflow?.name ? selected?.name || '' : config.name,
                    setup: { parameters: Object.fromEntries((selected?.parameters || []).flatMap(parameter => parameter.default === undefined ? [] : [[parameter.name, parameter.default]])), instructions: '' } });
            }}>
            {items.filter(item => !hosted || item.origin === 'demo' || item.origin === 'server').map(item => <MenuItem key={item.path} value={item.path}>{item.name}</MenuItem>)}
        </TextField>
        <TextField size="small" required label="Schedule name" value={config.name} disabled={disabled}
            onChange={event => onChange({ ...config, name: event.target.value })} />
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 2 }}>
            <TextField size="small" select label="Repeat" value={repeat} disabled={disabled} onChange={event => {
                setCustomDays(event.target.value === 'custom');
                if (event.target.value !== 'custom') onChange({ ...config,
                    weekdays: event.target.value === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4] });
            }}>
                <MenuItem value="daily">Every day</MenuItem>
                <MenuItem value="weekdays">Weekdays</MenuItem>
                <MenuItem value="custom">Custom days</MenuItem>
            </TextField>
            <TextField size="small" required type="time" label="Time" value={config.time} disabled={disabled} helperText={config.timezone}
                slotProps={{ inputLabel: { shrink: true } }} onChange={event => onChange({ ...config, time: event.target.value })} />
        </Box>
        {repeat === 'custom' && <Box role="group" aria-label="Weekdays" sx={{ display: 'flex', flexWrap: 'wrap', mt: -1 }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, index) => <FormControlLabel key={label} sx={{ mr: 1 }} label={label}
                control={<Checkbox size="small" checked={config.weekdays.includes(index)} disabled={disabled} onChange={event => onChange({ ...config,
                    weekdays: event.target.checked ? [...config.weekdays, index].sort() : config.weekdays.filter(day => day !== index) })} />} />)}
        </Box>}
        {workflow && <>
            <Divider><Typography variant="caption">Workflow inputs</Typography></Divider>
            {!!workflow.parameters?.length && <WorkflowSetupFields parameters={workflow.parameters} values={config.setup?.parameters || {}} disabled={disabled}
                onChange={parameters => onChange({ ...config, setup: { parameters, instructions: config.setup?.instructions || '' } })} />}
            <TextField size="small" multiline minRows={2} label="Additional instructions" value={config.setup?.instructions || ''} disabled={disabled}
                onChange={event => onChange({ ...config, setup: { parameters: config.setup?.parameters || {}, instructions: event.target.value } })} />
        </>}
        <Divider><Typography variant="caption">Run settings</Typography></Divider>
        <TextField size="small" select required label="Server model connection" value={config.model_id} disabled={disabled}
            error={!config.model_id} helperText={!config.model_id ? 'Server model connection required.' : undefined}
            onChange={event => onChange({ ...config, model_id: event.target.value })}>
            {models.map(model => <MenuItem key={model.id} value={model.id}>{model.model}</MenuItem>)}
        </TextField>
        <Box sx={{ display: 'flex', flexDirection: 'column', mt: -0.5,
            '& .MuiFormControlLabel-root': { m: 0, gap: 0.5 }, '& .MuiCheckbox-root': { p: 0.5 } }}>
            <FormControlLabel label="Run once after missed occurrences" control={<Checkbox size="small" checked={config.catch_up} disabled={disabled} onChange={event => onChange({ ...config, catch_up: event.target.checked })} />} />
            <Tooltip describeChild title="Local terminal commands and single-option data loads only. Application policy still applies; questions and credentials pause the run.">
                <FormControlLabel label="Auto-approve commands and data loads" control={<Checkbox size="small" checked={config.auto_approve} disabled={disabled} onChange={event => onChange({ ...config, auto_approve: event.target.checked })} />} />
            </Tooltip>
            {hosted && <FormControlLabel label="Publish final reports and all chart data for everyone to view" control={<Checkbox size="small" checked={config.publish} disabled={disabled} onChange={event => onChange({ ...config, publish: event.target.checked })} />} />}
        </Box>
    </>;
};

export const WorkflowSchedules: React.FC<{ items: WorkflowLibraryItem[]; onClose: () => void; initialSchedule?: WorkflowSchedule; startNew?: boolean;
    onOpenSession?: (id: string) => void | Promise<void> }> = ({ items, onClose, initialSchedule, startNew, onOpenSession }) => {
    const models = useSelector((state: DataFormulatorState) => state.globalModels);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const [schedules, setSchedules] = useState<WorkflowSchedule[]>([]);
    const [available, setAvailable] = useState(false);
    const [hosted, setHosted] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [identifier, setIdentifier] = useState(initialSchedule?.id || '');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const emptyConfig = (): ScheduleConfig => defaultScheduleConfig(models, selectedModelId);
    const [config, setConfig] = useState<ScheduleConfig>(() => initialSchedule ? { ...emptyConfig(), ...initialSchedule.config } : emptyConfig());
    const current = schedules.find(schedule => schedule.id === identifier);
    const currentRuns = current?.history?.filter(run => run.status !== 'skipped') ?? [];
    const select = (schedule?: WorkflowSchedule) => {
        setIdentifier(schedule?.id || ''); setConfig(schedule ? { ...emptyConfig(), ...schedule.config } : emptyConfig());
        setError('');
    };
    const refresh = async () => {
        const { data } = await apiRequest<{ available: boolean; hosted?: boolean; schedules: WorkflowSchedule[] }>('/api/schedules');
        setAvailable(data.available); setHosted(!!data.hosted); setSchedules(data.schedules);
        return data.schedules;
    };
    useEffect(() => {
        void refresh().then(list => { if (!initialSchedule && !startNew && list[0]) select(list[0]); })
            .catch(reason => setError(String(reason))).finally(() => setLoading(false));
    }, []);
    const persist = async (next: ScheduleConfig) => {
        const saved = await saveSchedule(next, identifier || undefined);
        const list = await refresh();
        return list.find(schedule => schedule.id === saved.id);
    };
    const act = async (action: () => Promise<void>, failure: string) => {
        setSaving(true); setError('');
        try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : failure); }
        finally { setSaving(false); }
    };
    return <><ListDetailDialog title="Schedules" listLabel="Schedule list" createLabel="New schedule" busy={saving} onClose={onClose} width={780} contentMaxWidth={460}
        selectedKey={identifier || null} onSelect={key => select(schedules.find(schedule => schedule.id === key))}
        items={schedules.map(schedule => ({ key: schedule.id, primary: schedule.config.name, secondary: scheduleCadence(schedule.config),
            muted: !schedule.config.enabled }))}
        onSubmit={event => {
            event.preventDefault();
            void act(async () => select(await persist(config)), 'Unable to save schedule.');
        }}
        footer={available && <>
            {current && <Button color="error" disabled={saving} sx={{ mr: 'auto' }} onClick={() => setConfirmDelete(true)}>Delete</Button>}
            {current && hosted && current.config.publish && <Button color="error" disabled={saving} onClick={() => void act(async () => {
                await apiRequest(`/api/schedules/${identifier}/publication`, { method: 'DELETE' });
                await refresh(); setConfig(previous => ({ ...previous, enabled: false, publish: false }));
            }, 'Unable to withdraw publication.')}>Unpublish</Button>}
            {current && <Button variant="outlined" disabled={saving} onClick={() => void act(async () => {
                const enabled = !current.config.enabled;
                await persist({ ...current.config, enabled });
                setConfig(previous => ({ ...previous, enabled }));
            }, 'Unable to update schedule.')}>{current.config.enabled ? 'Pause' : 'Resume'}</Button>}
            <Button type="submit" variant="contained" disableElevation
                disabled={saving || !config.weekdays.length || !config.model_id || !config.workflow || hosted && !config.publish}>Save schedule</Button>
        </>}>
                        {current && <Box>
                            <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
                                {current.config.enabled ? `Next run ${shortRunTime(current.next_at)}` : 'Paused'}</Typography>
                            {currentRuns.length > 0 && <RunList caption="Previous runs:" label={`Runs of ${current.config.name}`} limit={6} runs={currentRuns.map(run => ({
                                key: run.id, status: run.status, time: run.scheduled_for, disabled: !onOpenSession,
                                open: () => { void onOpenSession?.(`${hosted ? 'scheduled-private-' : 'scheduled-'}${run.id}`); onClose(); },
                            }))} />}
                        </Box>}
                        {error && <Alert severity="error">{error}</Alert>}
                        {loading ? <CircularProgress size={18} /> : !available ? <Alert severity="info">Scheduling is unavailable for this deployment or account.</Alert> : <>
                    <ScheduleConfigFields key={identifier || 'new'} items={items} config={config} onChange={setConfig} hosted={hosted} disabled={saving} />
                </>}
    </ListDetailDialog>
    <Dialog open={confirmDelete} onClose={() => !saving && setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete schedule?</DialogTitle>
        <DialogContent>
            <Typography sx={{ overflowWrap: 'anywhere', mb: 1 }}>{current?.config.name}</Typography>
            <Typography variant="body2" color="text.secondary">Future runs stop. Sessions from past runs are kept.</Typography>
        </DialogContent>
        <DialogActions>
            <Button disabled={saving} onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button color="error" variant="contained" disableElevation disabled={saving} onClick={() => void act(async () => {
                await apiRequest(`/api/schedules/${identifier}`, { method: 'DELETE' });
                const list = await refresh();
                setConfirmDelete(false);
                select(list[0]);
            }, 'Unable to delete schedule.')}>Delete</Button>
        </DialogActions>
    </Dialog>
    </>;
};

const shortRunTime = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const runStatusDisplay = (value: string) => ({
    completed: { label: 'Completed', color: 'success.main', icon: <CheckCircleOutlineIcon /> },
    needs_attention: { label: 'Needs attention', color: 'warning.main', icon: <WarningAmberOutlinedIcon /> },
    paused: { label: 'Paused', color: 'warning.main', icon: <PauseIcon /> },
    failed: { label: 'Failed', color: 'error.main', icon: <ErrorOutlineIcon /> },
    retry: { label: 'Retrying', color: 'text.secondary', icon: <HistoryOutlinedIcon /> },
    running: { label: 'Running', color: 'primary.main', icon: <CircularProgress size={11} color="inherit" /> },
} as Record<string, { label: string; color: string; icon: React.ReactNode }>)[value]
    ?? { label: value.replaceAll('_', ' '), color: 'text.secondary', icon: <HistoryOutlinedIcon /> };


/** The latest two runs, shown inside a card under its metadata; the panel lists the rest. */
export const CardRuns: React.FC<{ label: string; runs: RunEntry[]; next?: NextRun }> = ({ label, runs, next }) =>
    <RunList caption="Runs:" label={label} runs={runs.slice(0, 2)} next={next} />;

/** A status icon plus run time as plain inline text that opens the run. */
const RunLink: React.FC<{ status: string; time: string; label?: string; disabled?: boolean; onOpen: () => void }> = ({ status, time, label, disabled, onOpen }) => {
    const display = runStatusDisplay(status);
    return <Tooltip title={display.label}>
        <ButtonBase disabled={disabled} aria-label={label ?? `${display.label}, ${shortRunTime(time)}`}
            onClick={event => { event.stopPropagation(); onOpen(); }}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0, borderRadius: 0.5,
                fontSize: textVar.xs, lineHeight: 1.7, color: 'text.secondary',
                '&:hover': { color: 'text.primary', textDecoration: 'underline' },
                '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
            <Box component="span" role="img" aria-label={display.label}
                sx={{ display: 'inline-flex', color: display.color, '& .MuiSvgIcon-root': { fontSize: 13 } }}>{display.icon}</Box>
            <span>{shortRunTime(time)}</span>
        </ButtonBase>
    </Tooltip>;
};

/** The upcoming run (or paused state): same shape as a run, muted and inert; the cadence lives in its tooltip. */
const NextRunChip: React.FC<NextRun> = ({ time, cadence }) => {
    const state = time ? 'Next run' : 'Paused';
    return <Tooltip title={<>{state}<br />{cadence}</>}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0,
            fontFamily: theme => theme.typography.fontFamily, fontSize: textVar.xs, lineHeight: 1.7, color: 'text.disabled' }}>
            <Box component="span" role="img" aria-label={`${state}, ${cadence}`} sx={{ display: 'inline-flex', '& .MuiSvgIcon-root': { fontSize: 13 } }}>
                {time ? <ScheduleOutlinedIcon /> : <PauseIcon />}</Box>
            <span>{time ? shortRunTime(time) : 'Paused'}</span>
        </Box>
    </Tooltip>;
};

type NextRun = { time?: string; cadence: string };

export type RunEntry = { key: string; status: string; time: string; label?: string; disabled?: boolean; open: () => void };

/** Newest-first run chips; `(more)` reveals the rest in a scrollable area. */
export const RunList: React.FC<{ label: string; runs: RunEntry[]; limit?: number; caption?: string; next?: NextRun }> = ({ label, runs, limit = 3, caption, next }) => {
    const [showAll, setShowAll] = useState(false);
    return <Box role="group" aria-label={label} sx={{ mt: 0.5,
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.25, rowGap: 0.25, ...(showAll ? { maxHeight: 160, overflowY: 'auto' } : {}) }}>
        {caption && <Typography component="span" sx={{ fontSize: textVar.xs, color: 'text.secondary', mr: 0.25 }}>{caption}</Typography>}
        {next && <NextRunChip {...next} />}
        {(showAll ? runs : runs.slice(0, limit)).map(run => <RunLink key={run.key} status={run.status} time={run.time}
            label={run.label} disabled={run.disabled} onOpen={run.open} />)}
        {runs.length > limit && <ButtonBase onClick={event => { event.stopPropagation(); setShowAll(previous => !previous); }}
            sx={{ fontSize: textVar.xs, lineHeight: 1.7, color: 'text.secondary', borderRadius: 0.5, '&:hover': { color: 'text.primary', textDecoration: 'underline' } }}>
            {showAll ? '(less)' : '(more)'}
        </ButtonBase>}
    </Box>;
};

export interface ScheduleLibrary { schedules: WorkflowSchedule[]; hosted: boolean; available: boolean; loading: boolean; error: string }

/** Load schedules; refreshes on saves, tab return, `refreshKey` changes, and every 10s while a run is active. */
export function useScheduleLibrary(enabled: boolean, refreshKey?: unknown): ScheduleLibrary & { refresh: () => void } {
    const [library, setLibrary] = useState<ScheduleLibrary>({ schedules: [], hosted: false, available: false, loading: enabled, error: '' });
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        setLibrary(previous => ({ ...previous, loading: true, error: '' }));
        void apiRequest<{ available: boolean; hosted?: boolean; schedules: WorkflowSchedule[] }>('/api/schedules').then(({ data }) => {
            if (!cancelled) setLibrary({ schedules: data.schedules || [], hosted: !!data.hosted, available: data.available, loading: false, error: '' });
        }).catch(reason => {
            if (!cancelled) setLibrary({ schedules: [], hosted: false, available: false, loading: false,
                error: reason instanceof Error ? reason.message : 'Unable to load schedules.' });
        });
        return () => { cancelled = true; };
    }, [enabled, refreshKey, tick]);
    const anyOccurrenceActive = library.schedules.some(schedule => schedule.history?.some(run => run.status === 'running' || run.status === 'retry'));
    useEffect(() => onSchedulesChanged(() => setTick(value => value + 1)), []);
    useEffect(() => {
        if (!enabled) return;
        const onVisible = () => { if (document.visibilityState === 'visible') setTick(value => value + 1); };
        document.addEventListener('visibilitychange', onVisible);
        const timer = anyOccurrenceActive ? window.setInterval(() => setTick(value => value + 1), 10000) : undefined;
        return () => { document.removeEventListener('visibilitychange', onVisible); window.clearInterval(timer); };
    }, [enabled, anyOccurrenceActive]);
    return { ...library, refresh: () => setTick(value => value + 1) };
}

/** Workflow schedules: create, edit, and open runs. The sidebar tab, or a card grid on the landing page. */
export const SchedulesPanel: React.FC<{ onOpenSession?: (id: string) => void | Promise<void>; headerActions?: React.ReactNode;
    presentation?: 'sidebar' | 'landing'; toolbarContainer?: HTMLElement | null }> = ({ onOpenSession, headerActions, presentation = 'sidebar', toolbarContainer }) => {
    const landing = presentation === 'landing';
    const [items, setItems] = useState<WorkflowLibraryItem[]>([]);
    const [editing, setEditing] = useState<{ schedule?: WorkflowSchedule; browse?: boolean } | null>(null);
    const library = useScheduleLibrary(true);
    const { schedules, hosted, available, loading, error } = library;
    useEffect(() => { void listWorkflowLibrary().then(setItems).catch(() => setItems([])); }, []);
    const openRun = (id: string) => void onOpenSession?.(`${hosted ? 'scheduled-private-' : 'scheduled-'}${id}`);
    const newButton = <Button variant="outlined" size="small" startIcon={<AddIcon />} disabled={!available} sx={sidebarPrimaryActionSx}
        onClick={() => setEditing({})}>
        New schedule
    </Button>;
    return <Box component="section" aria-label="Schedules" sx={landing ? { minWidth: 0 }
        : { display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}>
        {!landing && <>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', px: 1.5, height: 40, minHeight: 40, boxSizing: 'border-box',
            flexShrink: 0, borderBottom: '1px solid rgba(0, 0, 0, 0.16)', bgcolor: 'rgba(255, 255, 255, 0.76)' }}>
            <Typography sx={{ fontSize: textVar.md, fontWeight: 600, textAlign: 'left' }}>Schedules</Typography>
            <ViewAllButton label="View all schedules" disabled={!available} onClick={() => setEditing({ browse: true })} />
            <Box sx={{ flex: 1 }} />
            {headerActions}
        </Box>
        <Box sx={sidebarToolbarSx}>
            {newButton}
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Refresh schedules"><span><IconButton aria-label="Refresh schedules" size="small" disabled={loading} onClick={library.refresh}
                sx={{ width: 24, height: 24, p: 0, color: 'text.secondary', '&:hover': { color: 'text.primary', bgcolor: 'action.hover' } }}>
                {loading ? <CircularProgress size={16} /> : <RefreshIcon sx={{ fontSize: iconVar.md }} />}
            </IconButton></span></Tooltip>
        </Box>
        </>}
        {landing && toolbarContainer && createPortal(newButton, toolbarContainer)}
        <Box sx={landing ? itemCardGridSx : { overflowY: 'auto', minHeight: 0, py: 1, px: 0.75, display: 'grid', gap: 0.75, alignContent: 'start' }}>
            {error ? <Alert severity="error" sx={{ fontSize: textVar.xs }}>{error}</Alert> : !loading && !schedules.length &&
                <Typography sx={{ px: landing ? 0 : 1, py: 0.75, fontSize: textVar.xs, color: 'text.secondary' }}>{available ? 'No schedules yet' : 'Scheduling unavailable'}</Typography>}
            {schedules.map(schedule => {
                const runs = schedule.history?.filter(run => run.status !== 'skipped') ?? [];
                const name = schedule.config.name;
                return <ItemCard key={schedule.id} compact={!landing} title={name} openLabel={`Edit schedule ${name}`}
                    onOpen={() => setEditing({ schedule })}
                    captions={[`${scheduleCadence(schedule.config)}${schedule.config.enabled ? '' : ' · Paused'}`]}
                    meta={<CardRuns label={`Runs of schedule ${name}`}
                        next={{ time: schedule.config.enabled ? schedule.next_at : undefined, cadence: scheduleCadence(schedule.config) }} runs={runs.map((run, index) => ({
                        key: run.id, status: run.status, time: run.scheduled_for, disabled: !onOpenSession, open: () => openRun(run.id),
                        label: index === 0 ? `Open latest run for schedule ${name}` : `Open run ${shortRunTime(run.scheduled_for)} for schedule ${name}`,
                    }))} />} />;
            })}
        </Box>
        {editing && <WorkflowSchedules items={items} initialSchedule={editing.schedule} startNew={!editing.schedule && !editing.browse} onOpenSession={onOpenSession}
            onClose={() => { setEditing(null); library.refresh(); }} />}
    </Box>;
};
