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
import { useTranslation } from 'react-i18next';
import i18n, { SUPPORTED_UI_LANGUAGES } from '../i18n';
import { Alert, Autocomplete, Box, Button, ButtonBase, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
    FormControlLabel, IconButton, MenuItem, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import { MarkdownEditor } from '../components/MarkdownEditor';
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
import { getAgentLanguage } from '../app/utils';
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

export const listWorkflowLibrary = async () => (await workflowApi<{ items: WorkflowLibraryItem[] }>('list', { language: getAgentLanguage() })).items;

export const workflowSetupContentSx = {
    display: 'flex', flexDirection: 'column', gap: 2.5, pb: 2.5,
    '& .MuiInputBase-root': { fontSize: textVar.md, lineHeight: 1.5 },
    '& .MuiInputLabel-root': { fontSize: textVar.md },
    '& .MuiFormHelperText-root': { fontSize: textVar.xs, lineHeight: 1.6, mt: 0.75 },
    '& .MuiFormControlLabel-label': { fontSize: textVar.md },
    '& .MuiTypography-caption': { display: 'block', fontSize: textVar.xs, lineHeight: 1.6, mt: 0.5 },
};

export const WorkflowSetupFields: React.FC<{ parameters: WorkflowParameter[]; values: WorkflowSetup['parameters'];
    onChange: (values: WorkflowSetup['parameters']) => void; disabled: boolean }> = ({ parameters, values, onChange, disabled }) => {
    const { t } = useTranslation();
    return <>
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
            {parameter.type === 'select' && !parameter.required && <MenuItem value="">{t('workflow.notSpecified')}</MenuItem>}
            {parameter.type === 'select' && parameter.options?.map(option => <MenuItem key={option} value={option}>{option}</MenuItem>)}
        </TextField>;
    })}
    </>;
};

export interface WorkflowSchedule {
    id: string; config: ScheduleConfig; next_at: string;
    history?: { id: string; scheduled_for: string; status: string; message: string; attempts: number }[];
}

// 0 = Monday; 2024-01-01 was a Monday.
const weekdayName = (day: number) => new Date(2024, 0, 1 + day).toLocaleDateString(i18n.language, { weekday: 'short' });

export const scheduleCadence = (config: ScheduleConfig) => {
    const days = [...config.weekdays].sort();
    const cadence = days.length === 7 ? i18n.t('schedule.daily') : days.join() === '0,1,2,3,4' ? i18n.t('schedule.weekdays')
        : days.map(weekdayName).join(', ');
    return i18n.t('schedule.cadenceAt', { cadence, time: config.time });
};

export const defaultScheduleConfig = (models: { id: string }[], selectedModelId?: string): ScheduleConfig => ({
    name: '', workflow: '', model_id: models.find(model => model.id === selectedModelId)?.id || models[0]?.id || '', time: '09:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, weekdays: [0, 1, 2, 3, 4, 5, 6], enabled: true,
    auto_approve: false, max_retries: 2, catch_up: false, language: getAgentLanguage(),
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

const scheduleTimes = Array.from({ length: 48 }, (_, index) => `${String(index >> 1).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);
const parseScheduleTime = (text: string) => {
    const match = text.trim().match(/^(\d{1,2}):?(\d{2})$/);
    return match && +match[1] < 24 && +match[2] < 60 ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
};

/** Schedule fields shared by the Schedules dialog and agent-proposed schedule forms. */
export const ScheduleConfigFields: React.FC<{ items: WorkflowLibraryItem[]; config: ScheduleConfig; onChange: (config: ScheduleConfig) => void;
    disabled: boolean; hideName?: boolean }> = ({ items, config, onChange, disabled, hideName = false }) => {
    const { t } = useTranslation();
    const models = useSelector((state: DataFormulatorState) => state.globalModels);
    const [customDays, setCustomDays] = useState(false);
    const [timeText, setTimeText] = useState<string | null>(null);
    const commitTime = (text: string) => {
        const time = parseScheduleTime(text);
        if (time) onChange({ ...config, time });
        setTimeText(null);
    };
    const workflow = items.find(item => item.path === config.workflow);
    const repeat = customDays ? 'custom' : config.weekdays.length === 7 ? 'daily'
        : config.weekdays.length === 5 && [0, 1, 2, 3, 4].every(day => config.weekdays.includes(day)) ? 'weekdays' : 'custom';
    return <>
        <TextField size="small" select required label={t('schedule.workflow')} value={config.workflow} disabled={disabled}
            onChange={event => {
                const selected = items.find(item => item.path === event.target.value);
                onChange({ ...config, workflow: event.target.value, name: !config.name || config.name === workflow?.name ? selected?.name || '' : config.name,
                    setup: { parameters: Object.fromEntries((selected?.parameters || []).flatMap(parameter => parameter.default === undefined ? [] : [[parameter.name, parameter.default]])), instructions: '' } });
            }}>
            {items.map(item => <MenuItem key={item.path} value={item.path}>{item.name}</MenuItem>)}
        </TextField>
        {!hideName && <TextField size="small" required label={t('schedule.name')} value={config.name} disabled={disabled}
            onChange={event => onChange({ ...config, name: event.target.value })} />}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 2 }}>
            <TextField size="small" select label={t('schedule.repeat')} value={repeat} disabled={disabled} onChange={event => {
                setCustomDays(event.target.value === 'custom');
                if (event.target.value !== 'custom') onChange({ ...config,
                    weekdays: event.target.value === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4] });
            }}>
                <MenuItem value="daily">{t('schedule.everyDay')}</MenuItem>
                <MenuItem value="weekdays">{t('schedule.weekdays')}</MenuItem>
                <MenuItem value="custom">{t('schedule.customDays')}</MenuItem>
            </TextField>
            <Autocomplete freeSolo disableClearable forcePopupIcon openOnFocus size="small" options={scheduleTimes} disabled={disabled}
                value={config.time} inputValue={timeText ?? config.time}
                onInputChange={(_, text, reason) => { if (reason === 'input') setTimeText(text); }}
                onChange={(_, text) => commitTime(text)} onBlur={() => timeText !== null && commitTime(timeText)}
                slotProps={{ listbox: { sx: { maxHeight: 220 } } }}
                renderInput={params => <TextField {...params} required label={t('schedule.time')} helperText={config.timezone}
                    slotProps={{ htmlInput: { ...params.inputProps, inputMode: 'numeric' } }} />} />
        </Box>
        {repeat === 'custom' && <Box role="group" aria-label={t('schedule.weekdays')} sx={{ display: 'flex', flexWrap: 'wrap', mt: -1 }}>
            {[0, 1, 2, 3, 4, 5, 6].map(index => <FormControlLabel key={index} sx={{ mr: 1 }} label={weekdayName(index)}
                control={<Checkbox size="small" checked={config.weekdays.includes(index)} disabled={disabled} onChange={event => onChange({ ...config,
                    weekdays: event.target.checked ? [...config.weekdays, index].sort() : config.weekdays.filter(day => day !== index) })} />} />)}
        </Box>}
        {workflow && <>
            <Divider><Typography variant="caption">{t('schedule.workflowInputs')}</Typography></Divider>
            {!!workflow.parameters?.length && <WorkflowSetupFields parameters={workflow.parameters} values={config.setup?.parameters || {}} disabled={disabled}
                onChange={parameters => onChange({ ...config, setup: { parameters, instructions: config.setup?.instructions || '' } })} />}
            <TextField size="small" multiline minRows={2} label={t('workflow.additionalInstructions')} value={config.setup?.instructions || ''} disabled={disabled}
                onChange={event => onChange({ ...config, setup: { parameters: config.setup?.parameters || {}, instructions: event.target.value } })} />
        </>}
        <Divider><Typography variant="caption">{t('schedule.runSettings')}</Typography></Divider>
        <TextField size="small" select required label={t('schedule.modelConnection')} value={config.model_id} disabled={disabled}
            error={!config.model_id} helperText={!config.model_id ? t('schedule.modelRequired') : undefined}
            onChange={event => onChange({ ...config, model_id: event.target.value })}>
            {models.map(model => <MenuItem key={model.id} value={model.id}>{model.model}</MenuItem>)}
        </TextField>
        <TextField size="small" select label={t('schedule.language')} value={config.language || 'en'} disabled={disabled}
            onChange={event => onChange({ ...config, language: event.target.value })}>
            {SUPPORTED_UI_LANGUAGES.map(language => <MenuItem key={language} value={language}>
                {new Intl.DisplayNames([language], { type: 'language' }).of(language) ?? language}</MenuItem>)}
        </TextField>
        <Box sx={{ display: 'flex', flexDirection: 'column', mt: -0.5,
            '& .MuiFormControlLabel-root': { m: 0, gap: 0.5 }, '& .MuiCheckbox-root': { p: 0.5 } }}>
            <FormControlLabel label={t('schedule.catchUp')} control={<Checkbox size="small" checked={config.catch_up} disabled={disabled} onChange={event => onChange({ ...config, catch_up: event.target.checked })} />} />
            <Tooltip describeChild title={t('schedule.autoApproveHint')}>
                <FormControlLabel label={t('schedule.autoApprove')} control={<Checkbox size="small" checked={config.auto_approve} disabled={disabled} onChange={event => onChange({ ...config, auto_approve: event.target.checked })} />} />
            </Tooltip>
        </Box>
    </>;
};

export const WorkflowSchedules: React.FC<{ items: WorkflowLibraryItem[]; onClose: () => void; initialSchedule?: WorkflowSchedule; startNew?: boolean;
    onOpenSession?: (id: string) => void | Promise<void> }> = ({ items, onClose, initialSchedule, startNew, onOpenSession }) => {
    const { t } = useTranslation();
    const models = useSelector((state: DataFormulatorState) => state.globalModels);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const [schedules, setSchedules] = useState<WorkflowSchedule[]>([]);
    const [available, setAvailable] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [identifier, setIdentifier] = useState(initialSchedule?.id || '');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const emptyConfig = (): ScheduleConfig => defaultScheduleConfig(models, selectedModelId);
    const [config, setConfig] = useState<ScheduleConfig>(() => initialSchedule ? { ...emptyConfig(), ...initialSchedule.config } : emptyConfig());
    const current = schedules.find(schedule => schedule.id === identifier);
    const currentRuns = current?.history?.filter(run => run.status !== 'skipped') ?? [];
    const [view, setView] = useState<'form' | 'yaml'>('form');
    const [yamlDraft, setYamlDraft] = useState('');
    const [yamlError, setYamlError] = useState('');
    const toYaml = (value: ScheduleConfig) => {
        const { name, workflow, time, timezone, weekdays, model_id, setup, ...flags } = value;
        const block = (fields: object) => dumpYaml(fields, { lineWidth: 100, noRefs: true });
        // Weekdays read best as one flow list; js-yaml can only set flow style by depth.
        return block({ name, workflow, time, timezone }) + `weekdays: [${weekdays.join(', ')}]  # 0 = Monday\n`
            + block({ model_id, ...(setup ? { setup } : {}), ...flags });
    };
    const editYaml = (text: string) => {
        setYamlDraft(text);
        try {
            const parsed = loadYaml(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('schedule.yamlExpected'));
            setConfig({ ...emptyConfig(), ...(parsed as Partial<ScheduleConfig>) });
            setYamlError('');
        } catch (reason) { setYamlError(reason instanceof Error ? reason.message : t('schedule.invalidYaml')); }
    };
    const select = (schedule?: WorkflowSchedule) => {
        const next = schedule ? { ...emptyConfig(), ...schedule.config } : emptyConfig();
        setIdentifier(schedule?.id || ''); setConfig(next);
        setYamlDraft(toYaml(next)); setYamlError('');
        setError('');
    };
    const refresh = async () => {
        const { data } = await apiRequest<{ available: boolean; schedules: WorkflowSchedule[] }>('/api/schedules');
        setAvailable(data.available); setSchedules(data.schedules);
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
    return <><ListDetailDialog title={t('schedule.title')} listLabel={t('schedule.list')} createLabel={t('schedule.new')} busy={saving} onClose={onClose} width={780} contentMaxWidth={460}
        fillHeight={view === 'yaml'}
        selectedKey={identifier || null} onSelect={key => select(schedules.find(schedule => schedule.id === key))}
        items={schedules.map(schedule => ({ key: schedule.id, primary: schedule.config.name, secondary: scheduleCadence(schedule.config),
            muted: !schedule.config.enabled }))}
        onSubmit={event => {
            event.preventDefault();
            void act(async () => select(await persist(config)), t('schedule.saveFailed'));
        }}
        footer={available && <>
            {current && <Button color="error" disabled={saving} sx={{ mr: 'auto' }} onClick={() => setConfirmDelete(true)}>{t('app.delete')}</Button>}
            {current && <Button variant="outlined" disabled={saving} onClick={() => void act(async () => {
                const enabled = !current.config.enabled;
                await persist({ ...current.config, enabled });
                setConfig(previous => ({ ...previous, enabled }));
            }, t('schedule.updateFailed'))}>{current.config.enabled ? t('schedule.pause') : t('schedule.resume')}</Button>}
            <Button type="submit" variant="contained" disableElevation
                disabled={saving || !!yamlError || !config.weekdays.length || !config.model_id || !config.workflow}>{t('schedule.save')}</Button>
        </>}>
                        {available && !loading && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <TextField size="small" required label={t('schedule.name')} value={config.name} disabled={saving} sx={{ flex: 1, minWidth: 0 }}
                                onChange={event => {
                                    const next = { ...config, name: event.target.value };
                                    setConfig(next);
                                    if (view === 'yaml') setYamlDraft(toYaml(next));
                                }} />
                            <ToggleButtonGroup size="small" exclusive value={view} aria-label={t('schedule.view')}
                                onChange={(_, next: 'form' | 'yaml' | null) => {
                                    if (!next) return;
                                    if (next === 'yaml') { setYamlDraft(toYaml(config)); setYamlError(''); }
                                    setView(next);
                                }}
                                sx={{ flexShrink: 0, '& .MuiToggleButton-root': { py: 0.125, px: 0.875, fontSize: textVar.xs, lineHeight: 1.5,
                                    textTransform: 'none', color: 'text.secondary', '&.Mui-selected': { color: 'text.primary' } } }}>
                                <ToggleButton value="form">{t('schedule.form')}</ToggleButton>
                                <ToggleButton value="yaml">YAML</ToggleButton>
                            </ToggleButtonGroup>
                        </Box>}
                        {current && <Box sx={{ mt: -0.75 }}>
                            <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
                                {current.config.enabled ? t('schedule.nextRunAt', { time: shortRunTime(current.next_at) }) : t('schedule.paused')}</Typography>
                            {currentRuns.length > 0 && <RunList caption={t('schedule.previousRuns')} label={t('schedule.runsOf', { name: current.config.name })} limit={6} runs={currentRuns.map(run => ({
                                key: run.id, status: run.status, time: run.scheduled_for, disabled: !onOpenSession,
                                open: () => { void onOpenSession?.(`scheduled-${run.id}`); onClose(); },
                            }))} />}
                        </Box>}
                        {error && <Alert severity="error">{error}</Alert>}
                        {loading ? <CircularProgress size={18} /> : !available ? <Alert severity="info">{t('schedule.localOnly')}</Alert> : <>
                    {view === 'yaml' ? <>
                        <Box sx={{ flex: 1, minHeight: 240, border: 1, borderColor: yamlError ? 'error.main' : 'divider', borderRadius: 1, overflow: 'hidden',
                            '& .cm-editor': { fontSize: textVar.sm } }}>
                            <MarkdownEditor fileName="schedule.yaml" value={yamlDraft} onChange={editYaml} readOnly={saving} showToolbar={false} lineWrap />
                        </Box>
                        {yamlError && <Typography role="alert" sx={{ mt: -1, fontSize: textVar.xs, color: 'error.main' }}>{yamlError}</Typography>}
                    </> : <ScheduleConfigFields key={identifier || 'new'} items={items} config={config} onChange={setConfig} disabled={saving} hideName />}
                </>}
    </ListDetailDialog>
    <Dialog open={confirmDelete} onClose={() => !saving && setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('schedule.deleteTitle')}</DialogTitle>
        <DialogContent>
            <Typography sx={{ overflowWrap: 'anywhere', mb: 1 }}>{current?.config.name}</Typography>
            <Typography variant="body2" color="text.secondary">{t('schedule.deleteBody')}</Typography>
        </DialogContent>
        <DialogActions>
            <Button disabled={saving} onClick={() => setConfirmDelete(false)}>{t('app.cancel')}</Button>
            <Button color="error" variant="contained" disableElevation disabled={saving} onClick={() => void act(async () => {
                await apiRequest(`/api/schedules/${identifier}`, { method: 'DELETE' });
                const list = await refresh();
                setConfirmDelete(false);
                select(list[0]);
            }, t('schedule.deleteFailed'))}>{t('app.delete')}</Button>
        </DialogActions>
    </Dialog>
    </>;
};

const shortRunTime = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const runStatusDisplay = (value: string) => {
    const display = ({
        completed: { color: 'success.main', icon: <CheckCircleOutlineIcon /> },
        needs_attention: { color: 'warning.main', icon: <WarningAmberOutlinedIcon /> },
        paused: { color: 'warning.main', icon: <PauseIcon /> },
        failed: { color: 'error.main', icon: <ErrorOutlineIcon /> },
        retry: { color: 'text.secondary', icon: <HistoryOutlinedIcon /> },
        running: { color: 'primary.main', icon: <CircularProgress size={11} color="inherit" /> },
    } as Record<string, { color: string; icon: React.ReactNode }>)[value] ?? { color: 'text.secondary', icon: <HistoryOutlinedIcon /> };
    return { ...display, label: i18n.t(`schedule.runStatus.${value}`, { defaultValue: value.replaceAll('_', ' ') }) };
};


/** The latest two runs, shown inside a card under its metadata; the panel lists the rest. */
export const CardRuns: React.FC<{ label: string; runs: RunEntry[]; next?: NextRun }> = ({ label, runs, next }) => {
    const { t } = useTranslation();
    return <RunList caption={t('schedule.runs')} label={label} runs={runs.slice(0, 2)} next={next} />;
};

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
    const { t } = useTranslation();
    const state = time ? t('schedule.nextRun') : t('schedule.paused');
    return <Tooltip title={<>{state}<br />{cadence}</>}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0,
            fontFamily: theme => theme.typography.fontFamily, fontSize: textVar.xs, lineHeight: 1.7, color: 'text.disabled' }}>
            <Box component="span" role="img" aria-label={`${state}, ${cadence}`} sx={{ display: 'inline-flex', '& .MuiSvgIcon-root': { fontSize: 13 } }}>
                {time ? <ScheduleOutlinedIcon /> : <PauseIcon />}</Box>
            <span>{time ? shortRunTime(time) : state}</span>
        </Box>
    </Tooltip>;
};

type NextRun = { time?: string; cadence: string };

export type RunEntry = { key: string; status: string; time: string; label?: string; disabled?: boolean; open: () => void };

/** Newest-first run chips; `(more)` reveals the rest in a scrollable area. */
export const RunList: React.FC<{ label: string; runs: RunEntry[]; limit?: number; caption?: string; next?: NextRun }> = ({ label, runs, limit = 3, caption, next }) => {
    const { t } = useTranslation();
    const [showAll, setShowAll] = useState(false);
    return <Box role="group" aria-label={label} sx={{ mt: 0.5,
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.25, rowGap: 0.25, ...(showAll ? { maxHeight: 160, overflowY: 'auto' } : {}) }}>
        {caption && <Typography component="span" sx={{ fontSize: textVar.xs, color: 'text.secondary', mr: 0.25 }}>{caption}</Typography>}
        {next && <NextRunChip {...next} />}
        {(showAll ? runs : runs.slice(0, limit)).map(run => <RunLink key={run.key} status={run.status} time={run.time}
            label={run.label} disabled={run.disabled} onOpen={run.open} />)}
        {runs.length > limit && <ButtonBase onClick={event => { event.stopPropagation(); setShowAll(previous => !previous); }}
            sx={{ fontSize: textVar.xs, lineHeight: 1.7, color: 'text.secondary', borderRadius: 0.5, '&:hover': { color: 'text.primary', textDecoration: 'underline' } }}>
            {showAll ? t('schedule.less') : t('schedule.more')}
        </ButtonBase>}
    </Box>;
};

export interface ScheduleLibrary { schedules: WorkflowSchedule[]; available: boolean; loading: boolean; error: string }

/** Load schedules; refreshes on saves, tab return, `refreshKey` changes, and every 10s while a run is active. */
export function useScheduleLibrary(enabled: boolean, refreshKey?: unknown): ScheduleLibrary & { refresh: () => void } {
    const [library, setLibrary] = useState<ScheduleLibrary>({ schedules: [], available: false, loading: enabled, error: '' });
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        setLibrary(previous => ({ ...previous, loading: true, error: '' }));
        void apiRequest<{ available: boolean; schedules: WorkflowSchedule[] }>('/api/schedules').then(({ data }) => {
            if (!cancelled) setLibrary({ schedules: data.schedules || [], available: data.available, loading: false, error: '' });
        }).catch(reason => {
            if (!cancelled) setLibrary({ schedules: [], available: false, loading: false,
                error: reason instanceof Error ? reason.message : i18n.t('schedule.loadFailed') });
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
    const { t } = useTranslation();
    const landing = presentation === 'landing';
    const [items, setItems] = useState<WorkflowLibraryItem[]>([]);
    const [editing, setEditing] = useState<{ schedule?: WorkflowSchedule; browse?: boolean } | null>(null);
    const library = useScheduleLibrary(true);
    const { schedules, available, loading, error } = library;
    useEffect(() => { void listWorkflowLibrary().then(setItems).catch(() => setItems([])); }, []);
    const openRun = (id: string) => void onOpenSession?.(`scheduled-${id}`);
    const newButton = <Button variant="outlined" size="small" startIcon={<AddIcon />} disabled={!available} sx={sidebarPrimaryActionSx}
        onClick={() => setEditing({})}>
        {t('schedule.new')}
    </Button>;
    return <Box component="section" aria-label={t('schedule.title')} sx={landing ? { minWidth: 0 }
        : { display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}>
        {!landing && <>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', px: 1.5, height: 40, minHeight: 40, boxSizing: 'border-box',
            flexShrink: 0, borderBottom: '1px solid rgba(0, 0, 0, 0.16)', bgcolor: 'rgba(255, 255, 255, 0.76)' }}>
            <Typography sx={{ fontSize: textVar.md, fontWeight: 600, textAlign: 'left' }}>{t('schedule.title')}</Typography>
            <ViewAllButton label={t('schedule.viewAll')} disabled={!available} onClick={() => setEditing({ browse: true })} />
            <Box sx={{ flex: 1 }} />
            {headerActions}
        </Box>
        <Box sx={sidebarToolbarSx}>
            {newButton}
            <Box sx={{ flex: 1 }} />
            <Tooltip title={t('schedule.refresh')}><span><IconButton aria-label={t('schedule.refresh')} size="small" disabled={loading} onClick={library.refresh}
                sx={{ width: 24, height: 24, p: 0, color: 'text.secondary', '&:hover': { color: 'text.primary', bgcolor: 'action.hover' } }}>
                {loading ? <CircularProgress size={16} /> : <RefreshIcon sx={{ fontSize: iconVar.md }} />}
            </IconButton></span></Tooltip>
        </Box>
        </>}
        {landing && toolbarContainer && createPortal(newButton, toolbarContainer)}
        <Box sx={landing ? itemCardGridSx : { overflowY: 'auto', minHeight: 0, py: 1, px: 0.75, display: 'grid', gap: 0.75, alignContent: 'start' }}>
            {error ? <Alert severity="error" sx={{ fontSize: textVar.xs }}>{error}</Alert> : !loading && !available
                ? <Alert severity="info" sx={{ fontSize: textVar.xs }}>{t('schedule.localOnly')}</Alert> : !loading && !schedules.length &&
                <Typography sx={{ px: landing ? 0 : 1, py: 0.75, fontSize: textVar.xs, color: 'text.secondary' }}>{t('schedule.empty')}</Typography>}
            {schedules.map(schedule => {
                const runs = schedule.history?.filter(run => run.status !== 'skipped') ?? [];
                const name = schedule.config.name;
                return <ItemCard key={schedule.id} compact={!landing} title={name} openLabel={t('schedule.edit', { name })}
                    onOpen={() => setEditing({ schedule })}
                    captions={[`${scheduleCadence(schedule.config)}${schedule.config.enabled ? '' : ` · ${t('schedule.paused')}`}`]}
                    meta={<CardRuns label={t('schedule.runsOfSchedule', { name })}
                        next={{ time: schedule.config.enabled ? schedule.next_at : undefined, cadence: scheduleCadence(schedule.config) }} runs={runs.map((run, index) => ({
                        key: run.id, status: run.status, time: run.scheduled_for, disabled: !onOpenSession, open: () => openRun(run.id),
                        label: index === 0 ? t('schedule.openLatestRun', { name }) : t('schedule.openRun', { time: shortRunTime(run.scheduled_for), name }),
                    }))} />} />;
            })}
        </Box>
        {editing && <WorkflowSchedules items={items} initialSchedule={editing.schedule} startNew={!editing.schedule && !editing.browse} onOpenSession={onOpenSession}
            onClose={() => { setEditing(null); library.refresh(); }} />}
    </Box>;
};
