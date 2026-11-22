// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A workflow's schedule (design-docs/78): the `schedule:` block of its file, set in the schedule dialog its card
 * opens; plus the workflow library API, setup fields, and run chips the workflow panel shares.
 */

import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { Autocomplete, Box, ButtonBase, Checkbox, CircularProgress, Select,
    FormControlLabel, MenuItem, Switch, TextField, Tooltip, Typography } from '@mui/material';
import PauseIcon from '@mui/icons-material/Pause';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { ink, weight } from '../app/tokens';
import { mutedChipBg } from '../components/ItemCard';
import { apiRequest } from '../app/apiClient';
import { getAgentLanguage } from '../app/utils';
import { DataFormulatorState } from '../app/dfSlice';
import { textVar } from '../app/layout';
import type { ScheduleConfig } from '../components/ComponentType';

export interface WorkflowParameter {
    name: string; label: string; type?: 'text' | 'number' | 'boolean' | 'select'; description?: string;
    required?: boolean; default?: string | number | boolean; options?: string[]; allow_custom?: boolean;
}
export interface WorkflowSetup { parameters: Record<string, string | number | boolean>; instructions: string }
export interface WorkflowLibraryItem {
    path: string; name: string; overview?: string; error?: string; origin?: 'user' | 'demo' | 'server'; parameters?: WorkflowParameter[]; content?: string;
    /** The file's `schedule:` block (the user's own workflows only). */
    schedule?: ScheduleConfig;
}
export type ScheduledRun = { id: string; scheduled_for: string; status: string; message: string; attempts: number };
/** The scheduler's state for one workflow, keyed by its path in the workflow list. Kept after the schedule is removed
 *  while it has runs (`scheduled: false`), so the card still lists them. */
export interface WorkflowScheduleState { id: string; scheduled: boolean; enabled: boolean; next_at: string | null; history: ScheduledRun[] }

/** POST to a `/api/workflows/<route>` endpoint and return its data. */
export async function workflowApi<T>(route: string, body: object = {}, signal?: AbortSignal): Promise<T> {
    const { data } = await apiRequest<T>(`/api/workflows/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
    });
    return data;
}

export const listWorkflowLibrary = async () => (await workflowApi<{ items: WorkflowLibraryItem[] }>('list', { language: getAgentLanguage() })).items;

/** Whether this app runs schedules (the local app only). */
export const schedulingAvailable = async () => (await workflowApi<{ scheduling?: boolean }>('list', { language: getAgentLanguage() })).scheduling === true;

/** Demo and server workflows are read-only: scheduling one saves the user's own copy. */
export const schedulesByCopy = (item: Pick<WorkflowLibraryItem, 'origin'>) => item.origin === 'demo' || item.origin === 'server';

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

/** A workflow's run inputs, as one flat form: its parameters in a two-column grid, then free instructions. Shared by the
 *  Run and settings dialogs. */
export const RunInputs: React.FC<{ parameters: WorkflowParameter[]; values: WorkflowSetup['parameters'];
    onChange: (values: WorkflowSetup['parameters']) => void; instructions: string; onInstructionsChange: (instructions: string) => void;
    disabled: boolean }> = ({ parameters, values, onChange, instructions, onInstructionsChange, disabled }) => {
    const { t } = useTranslation();
    return <>
        {!!parameters.length && <Box role="group" aria-label={t('workflow.runInputs')} sx={{ display: 'grid', alignItems: 'start', gap: 2,
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' } }}>
            <WorkflowSetupFields parameters={parameters} values={values} onChange={onChange} disabled={disabled} />
        </Box>}
        <TextField size="small" multiline minRows={2} fullWidth label={t('workflow.additionalInstructions')} value={instructions}
            disabled={disabled} onChange={event => onInstructionsChange(event.target.value)} slotProps={{ htmlInput: { maxLength: 8000 } }} />
    </>;
};

// 0 = Monday; 2024-01-01 was a Monday.
const weekdayName = (day: number) => new Date(2024, 0, 1 + day).toLocaleDateString(i18n.language, { weekday: 'short' });

export const scheduleCadence = (config: Pick<ScheduleConfig, 'weekdays' | 'time'>) => {
    const days = [...config.weekdays].sort();
    const cadence = days.length === 7 ? i18n.t('schedule.daily') : days.join() === '0,1,2,3,4' ? i18n.t('schedule.weekdays')
        : days.map(weekdayName).join(', ');
    return i18n.t('schedule.cadenceAt', { cadence, time: clockTime(config.time) });
};

/** A schedule's `HH:MM` on the user's clock, as run times are shown: 13:55 is "1:55 PM" in English. */
export const clockTime = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return time;
    return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

/** A new schedule's values: 09:00 daily in the user's timezone, with their selected model, the workflow's default inputs, and
 *  requests approved automatically. */
export const defaultScheduleConfig = (models: { id: string }[], selectedModelId?: string, parameters: WorkflowParameter[] = []): ScheduleConfig => ({
    model_id: models.find(model => model.id === selectedModelId)?.id || models[0]?.id || '', time: '09:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, weekdays: [0, 1, 2, 3, 4, 5, 6], enabled: true,
    auto_approve: true, max_retries: 2, catch_up: false, language: getAgentLanguage(),
    setup: { parameters: Object.fromEntries(parameters.flatMap(parameter => parameter.default === undefined ? [] : [[parameter.name, parameter.default]])),
        instructions: '' },
});

export const scheduleModelKnown = (config: Pick<ScheduleConfig, 'model_id'>, models: { id: string }[]) =>
    !!config.model_id && models.some(model => model.id === config.model_id);

/** The schedule's model when the server still has it, else the default available one (the selected model, or the first). */
export const availableModel = (modelId: string | undefined, models: { id: string }[], selectedModelId?: string) =>
    models.some(model => model.id === modelId) ? modelId! : models.find(model => model.id === selectedModelId)?.id || models[0]?.id || '';

const shortRunTime = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** When a schedule runs next, briefly: the date alone when it runs at its own time on this clock, which the cadence says. */
const shortNextRun = (nextAt: string, schedule: ScheduleConfig) => {
    const next = new Date(nextAt);
    const clock = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
    return clock === schedule.time ? next.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : shortRunTime(nextAt);
};

/** The schedule line at the bottom of a workflow card: its cadence and when it runs next, or that it is paused. */
export const ScheduleLine: React.FC<{ schedule: ScheduleConfig; nextAt?: string | null; textOnly?: boolean }> = ({ schedule, nextAt, textOnly }) => {
    const { t } = useTranslation();
    const paused = schedule.enabled === false;
    const cadence = scheduleCadence(schedule);
    const text = paused ? `${t('schedule.paused')} · ${cadence}`
        : nextAt ? `${cadence} (${t('schedule.nextShort', { time: shortNextRun(nextAt, schedule) })})` : cadence;
    // Under a card's title, tucked close so the two read as one.
    if (textOnly) return <Box component="span" data-workflow-schedule sx={{ display: 'block', mt: '-4px', lineHeight: 1.4 }}>{text}</Box>;
    return <Box data-workflow-schedule sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, minWidth: 0,
        fontSize: textVar.xs, lineHeight: 1.7, color: 'text.secondary', '& .MuiSvgIcon-root': { fontSize: 13, flexShrink: 0 } }}>
        {paused ? <PauseIcon aria-hidden sx={{ color: 'warning.main' }} /> : <ScheduleOutlinedIcon aria-hidden />}
        <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</Box>
    </Box>;
};

/** One fact of a schedule, as the Schedule tab and a proposal's review show it. */
type ScheduleFact = { key: string; label: string; value: string };

/** What a schedule does, in words: when, with which model, whether it approves requests, and its inputs and instructions. */
export function scheduleFacts(schedule: ScheduleConfig, parameters: WorkflowParameter[], models: { id: string; model?: string }[]): ScheduleFact[] {
    const t = i18n.t.bind(i18n);
    const shown = (value: unknown) => value === undefined || value === null || value === '' ? t('workflow.notSpecified')
        : typeof value === 'boolean' ? (value ? t('workflow.inputYes') : t('workflow.inputNo')) : String(value);
    const values = schedule.setup?.parameters || {};
    return [
        { key: 'when', label: t('schedule.when'), value: `${scheduleCadence(schedule)} (${schedule.timezone})` },
        // A model the server no longer has gives way to its default (the first), as the scheduler does.
        { key: 'model', label: t('schedule.model'), value: models.find(model => model.id === schedule.model_id)?.model
            || (models[0] ? t('schedule.defaultModel', { model: models[0].model }) : schedule.model_id) },
        { key: 'approvals', label: t('schedule.approvals'), value: schedule.auto_approve === true ? t('schedule.approvalsOn') : t('schedule.approvalsOff') },
        { key: 'status', label: t('schedule.status'), value: schedule.enabled === false ? t('schedule.paused') : t('schedule.on') },
        ...parameters.map(parameter => ({ key: `input:${parameter.name}`, label: parameter.label, value: shown(values[parameter.name] ?? parameter.default) })),
        ...(schedule.setup?.instructions ? [{ key: 'instructions', label: t('workflow.additionalInstructions'), value: schedule.setup.instructions }] : []),
    ];
}

const factGridSx = { display: 'grid', gridTemplateColumns: 'minmax(96px, max-content) minmax(0, 1fr)', columnGap: 2, rowGap: 0.75, m: 0,
    fontSize: textVar.sm, lineHeight: 1.6, '& dt': { color: 'text.secondary' }, '& dd': { m: 0, minWidth: 0, overflowWrap: 'anywhere' } } as const;

/** A schedule described: a label and value per fact. */
export const ScheduleSummary: React.FC<{ facts: ScheduleFact[]; label: string }> = ({ facts, label }) =>
    <Box component="dl" aria-label={label} sx={factGridSx}>
        {facts.map(fact => <React.Fragment key={fact.key}><dt>{fact.label}</dt><dd>{fact.value}</dd></React.Fragment>)}
    </Box>;

/** How a revision changes a schedule: each fact that differs, before → after; a new schedule is described in full. */
export const ScheduleChanges: React.FC<{ before?: ScheduleFact[]; after: ScheduleFact[]; label: string }> = ({ before, after, label }) => {
    const { t } = useTranslation();
    if (!before) return <ScheduleSummary facts={after} label={label} />;
    const old = new Map(before.map(fact => [fact.key, fact.value]));
    const changed = after.filter(fact => old.get(fact.key) !== fact.value);
    if (!changed.length) return <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary' }}>{t('schedule.unchanged')}</Typography>;
    return <Box component="dl" aria-label={label} sx={factGridSx}>
        {changed.map(fact => <React.Fragment key={fact.key}><dt>{fact.label}</dt><dd>
            {old.has(fact.key) && <><Box component="span" sx={{ color: 'text.secondary', textDecoration: 'line-through' }}>{old.get(fact.key)}</Box>{' → '}</>}
            <Box component="span" sx={{ fontWeight: weight(500) }}>{fact.value}</Box></dd></React.Fragment>)}
    </Box>;
};

/** The schedule settings being edited on a workflow's page; Save writes them. */
export interface ScheduleDraft { on: boolean; config: ScheduleConfig; dirty: boolean }

/** The draft for a workflow's `schedule:` block, or for a new schedule: 09:00 daily, the default model, approvals on. A block
 *  without `auto_approve` declines, as the scheduler reads it. */
export const scheduleDraftOf = (schedule: ScheduleConfig | undefined, models: { id: string }[], selectedModelId?: string): ScheduleDraft => {
    const config = { ...defaultScheduleConfig(models, selectedModelId), ...schedule, ...(schedule ? { auto_approve: schedule.auto_approve === true } : {}) };
    return { on: !!schedule && schedule.enabled !== false, dirty: false,
        config: { ...config, model_id: availableModel(config.model_id, models, selectedModelId) } };
};

/** What saving a draft writes: the schedule running, in the app's language; off pauses it (kept), or leaves none. */
export const scheduleDraftToSave = (draft: ScheduleDraft, current?: ScheduleConfig): ScheduleConfig | null | undefined =>
    draft.on ? { ...draft.config, enabled: true, language: getAgentLanguage() } : current ? { ...current, enabled: false } : undefined;

const scheduleTimes = Array.from({ length: 48 }, (_, index) => `${String(index >> 1).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);
/** A typed time as `HH:MM`: as the field shows it ("1:55 PM"), with am/pm ("1:55pm", "9 am"), or 24-hour ("13:55"). */
const parseScheduleTime = (text: string) => {
    const typed = text.trim().toLowerCase();
    const shown = scheduleTimes.find(time => clockTime(time).toLowerCase() === typed);
    if (shown) return shown;
    const match = typed.match(/^(\d{1,2})(?::?(\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?$/);
    if (!match) return null;
    let hours = +match[1];
    const minutes = +(match[2] ?? '0');
    if (match[3]) {
        if (hours < 1 || hours > 12) return null;
        hours = hours % 12 + (match[3] === 'p' ? 12 : 0);
    } else if (match[2] === undefined) return null;
    return hours < 24 && minutes < 60 ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` : null;
};

// The page's compact layout, as the map style panel's: small section headings, then one labelled row per setting.
const sectionSx = { fontSize: textVar.xxs, fontWeight: weight(600), letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary', mb: 0.75 } as const;
const rowLabelSx = { fontSize: textVar.sm, color: 'text.secondary', width: 120, flexShrink: 0, lineHeight: 1.5 } as const;
const controlSx = { fontSize: textVar.sm, '& .MuiInputBase-root': { fontSize: textVar.sm }, '& .MuiInputBase-input': { fontSize: textVar.sm, py: 0.5 } } as const;
const captionSx = { fontSize: textVar.xs, color: 'text.secondary', lineHeight: 1.5, minWidth: 0 } as const;

/** A timezone worth naming: only one other than the user's own. */
const otherZone = (timezone: string) => timezone && timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone ? timezone : '';

// What a workflow uses and makes, as quiet reference under its schedule: small grey labels, values and items in the body size.
const referenceGridSx = { display: 'grid', gridTemplateColumns: 'minmax(80px, max-content) minmax(0, 1fr)', columnGap: 2, rowGap: 0.25, m: 0, alignItems: 'baseline',
    fontSize: textVar.sm, lineHeight: 1.5, '& dt': { fontSize: textVar.xs, color: 'text.secondary', maxWidth: 200 },
    '& dd': { m: 0, minWidth: 0, overflowWrap: 'anywhere' } } as const;
const referenceListSx = { m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 0.25,
    fontSize: textVar.sm, lineHeight: 1.5, color: 'text.secondary',
    '& li': { position: 'relative', pl: 1.5, overflowWrap: 'anywhere' },
    '& li::before': { content: '""', position: 'absolute', left: 2, top: '0.62em', width: 4, height: 4, borderRadius: '50%', bgcolor: 'text.disabled' } } as const;

const PageSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) =>
    <Box component="section" aria-label={title}>
        <Typography component="h3" sx={sectionSx}>{title}</Typography>
        {children}
    </Box>;

const SettingRow: React.FC<{ label: React.ReactNode; top?: boolean; children: React.ReactNode }> = ({ label, top, children }) =>
    <Box sx={{ display: 'flex', alignItems: top ? 'flex-start' : 'center', gap: 1.5, minHeight: 32 }}>
        <Typography component="div" sx={{ ...rowLabelSx, ...(top ? { pt: 0.75 } : {}) }}>{label}</Typography>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{children}</Box>
    </Box>;

/** A workflow's schedule settings, one row each: whether it runs on a schedule, when, with which model and instructions, and
 *  whether it approves requests. Its inputs are not set here: the instructions say what to use, and the defaults apply otherwise.
 *  The switch pauses or resumes a saved schedule at once (`onToggle`); the other settings are a draft until saved. */
export const ScheduleSettings: React.FC<{ draft: ScheduleDraft; onChange: (draft: ScheduleDraft) => void; current?: ScheduleConfig;
    onToggle?: (on: boolean) => void; state?: WorkflowScheduleState; copy?: boolean; disabled: boolean }> = ({
    draft, onChange, current, onToggle, state, copy, disabled }) => {
    const { t } = useTranslation();
    const models = useSelector((state: DataFormulatorState) => state.globalModels);
    const [customDays, setCustomDays] = useState(false);
    const [timeText, setTimeText] = useState<string | null>(null);
    const config = draft.config;
    const set = (patch: Partial<ScheduleConfig>) => onChange({ ...draft, dirty: true, config: { ...config, ...patch } });
    const commitTime = (text: string) => {
        const time = parseScheduleTime(text);
        if (time) set({ time });
        setTimeText(null);
    };
    const timeField = <Autocomplete freeSolo disableClearable forcePopupIcon openOnFocus size="small" options={scheduleTimes} disabled={disabled}
        value={config.time} inputValue={timeText ?? clockTime(config.time)} getOptionLabel={clockTime}
        sx={{ width: 130, '& .MuiAutocomplete-inputRoot.MuiInputBase-sizeSmall': { py: '2px' } }}
        onInputChange={(_, text, reason) => { if (reason === 'input') setTimeText(text); }}
        onChange={(_, text) => commitTime(text)} onBlur={() => timeText !== null && commitTime(timeText)}
        slotProps={{ listbox: { sx: { maxHeight: 220, fontSize: textVar.sm } } }}
        renderInput={params => <TextField {...params} sx={controlSx}
            slotProps={{ htmlInput: { ...params.inputProps, 'aria-label': t('schedule.time') } }} />} />;
    const repeat = customDays ? 'custom' : config.weekdays.length === 7 ? 'daily'
        : config.weekdays.length === 5 && [0, 1, 2, 3, 4].every(day => config.weekdays.includes(day)) ? 'weekdays' : 'custom';
    // Running, the rows below say when and the caption says when next; paused, the rows fold away and the caption says when.
    const paused = !!current && current.enabled === false;
    const status = !current ? t('schedule.notScheduled')
        : paused ? `${t('schedule.paused')} · ${scheduleCadence(current)}${otherZone(current.timezone) ? ` (${current.timezone})` : ''}`
        : state?.next_at ? t('schedule.nextRunAt', { time: shortRunTime(state.next_at) }) : '';
    return <>
        <SettingRow label={t('schedule.runOnSchedule')}>
            <Switch size="small" checked={draft.on} disabled={disabled} slotProps={{ input: { 'aria-label': t('schedule.runOnSchedule') } }}
                onChange={event => current && onToggle ? onToggle(event.target.checked) : onChange({ ...draft, on: event.target.checked, dirty: true })} />
            {paused && <PauseIcon aria-hidden sx={{ fontSize: 14, color: 'warning.main', mr: -0.5 }} />}
            <Typography data-schedule-description sx={captionSx}>{status}</Typography>
        </SettingRow>
        {draft.on && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {copy && <Typography sx={{ ...captionSx, pl: '132px' }}>{t('schedule.savesCopy')}</Typography>}
            <SettingRow label={t('schedule.when')}>
                <Select size="small" value={repeat} disabled={disabled} sx={{ ...controlSx, minWidth: 130 }} inputProps={{ 'aria-label': t('schedule.repeat') }}
                    onChange={event => {
                        setCustomDays(event.target.value === 'custom');
                        if (event.target.value !== 'custom') set({ weekdays: event.target.value === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4] });
                    }}>
                    <MenuItem value="daily" sx={controlSx}>{t('schedule.everyDay')}</MenuItem>
                    <MenuItem value="weekdays" sx={controlSx}>{t('schedule.weekdays')}</MenuItem>
                    <MenuItem value="custom" sx={controlSx}>{t('schedule.customDays')}</MenuItem>
                </Select>
                {timeField}
                {otherZone(config.timezone) && <Typography sx={captionSx}>{config.timezone}</Typography>}
            </SettingRow>
            {repeat === 'custom' && <SettingRow label="">
                <Box role="group" aria-label={t('schedule.weekdays')} sx={{ display: 'flex', flexWrap: 'wrap',
                    '& .MuiFormControlLabel-root': { m: 0, mr: 1 }, '& .MuiFormControlLabel-label': { fontSize: textVar.sm }, '& .MuiCheckbox-root': { p: 0.5 } }}>
                    {[0, 1, 2, 3, 4, 5, 6].map(index => <FormControlLabel key={index} label={weekdayName(index)}
                        control={<Checkbox size="small" checked={config.weekdays.includes(index)} disabled={disabled} onChange={event => set({
                            weekdays: event.target.checked ? [...config.weekdays, index].sort() : config.weekdays.filter(day => day !== index) })} />} />)}
                </Box>
            </SettingRow>}
            <SettingRow label={t('schedule.model')}>
                <Select size="small" value={config.model_id} disabled={disabled} sx={{ ...controlSx, minWidth: 160 }} inputProps={{ 'aria-label': t('schedule.model') }}
                    onChange={event => set({ model_id: event.target.value })}>
                    {models.map(model => <MenuItem key={model.id} value={model.id} sx={controlSx}>{model.model}</MenuItem>)}
                </Select>
            </SettingRow>
            <SettingRow label={t('schedule.instructions')} top>
                <TextField size="small" multiline minRows={1} fullWidth placeholder={t('schedule.instructionsPlaceholder')} disabled={disabled}
                    value={config.setup?.instructions || ''} sx={{ '& .MuiInputBase-root': { fontSize: textVar.sm, py: 0.6 } }}
                    slotProps={{ htmlInput: { maxLength: 8000, 'aria-label': t('schedule.instructions') } }}
                    onChange={event => set({ setup: { parameters: config.setup?.parameters || {}, instructions: event.target.value } })} />
            </SettingRow>
            <SettingRow label={t('schedule.autoApprove')}>
                <Tooltip title={config.auto_approve === true ? t('schedule.approveAllOn') : t('schedule.approveAllOff')} placement="right">
                    <Switch size="small" checked={config.auto_approve === true} disabled={disabled}
                        slotProps={{ input: { 'aria-label': t('schedule.approveAll') } }} onChange={event => set({ auto_approve: event.target.checked })} />
                </Tooltip>
            </SettingRow>
        </Box>}
    </>;
};

/** A workflow's page: what it does, its inputs with their defaults and its deliverables, then its schedule settings in a box
 *  (just the switch until it runs on a schedule), in the compact rows of a settings panel. Changes beyond the schedule go
 *  through the agent; the source is a secondary view. */
export const WorkflowPage: React.FC<{ item: WorkflowLibraryItem; deliverables?: string[]; scheduling: boolean; state?: WorkflowScheduleState;
    draft?: ScheduleDraft; onDraftChange: (draft: ScheduleDraft) => void; onToggle?: (on: boolean) => void; busy: boolean }> = ({
    item, deliverables, scheduling, state, draft, onDraftChange, onToggle, busy }) => {
    const { t } = useTranslation();
    const parameters = item.parameters || [];
    return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pb: 1 }}>
        {item.overview && <Typography sx={{ fontSize: textVar.sm, lineHeight: 1.55, color: 'text.primary', overflowWrap: 'anywhere' }}>{item.overview}</Typography>}
        {!!parameters.length && <PageSection title={t('workflow.defaultInputs')}>
            <Box component="dl" sx={referenceGridSx}>
                {parameters.map(parameter => <React.Fragment key={parameter.name}>
                    <Tooltip title={parameter.description || ''} placement="top-start"><dt>{parameter.label}</dt></Tooltip>
                    <dd>{parameter.default === undefined || parameter.default === ''
                        ? <Box component="span" sx={{ color: 'text.disabled' }}>{t('workflow.notSpecified')}</Box> : String(parameter.default)}</dd>
                </React.Fragment>)}
            </Box>
        </PageSection>}
        {!!deliverables?.length && <PageSection title={t('workflow.deliverables')}>
            <Box component="ul" sx={referenceListSx}>
                {deliverables.map((deliverable, index) => <li key={index}>{deliverable}</li>)}</Box>
        </PageSection>}
        {scheduling && draft && <Box component="section" aria-label={t('schedule.action')}
            sx={{ border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: ink(0.02), px: 1.5, py: 0.5 }}>
            <ScheduleSettings draft={draft} onChange={onDraftChange} onToggle={onToggle} current={item.origin === 'user' ? item.schedule : undefined}
                state={state} copy={schedulesByCopy(item)} disabled={busy} />
        </Box>}
    </Box>;
};


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
export const CardRuns: React.FC<{ label: string; runs: RunEntry[] }> = ({ label, runs }) =>
    <RunList label={label} runs={runs.slice(0, 2)} dateOnly />;

/** A run as a shaded chip, like the app's metadata chips: its status icon and when it ran; it opens the run. `dateOnly` drops
 *  the time where the card's schedule line already says it; the tooltip keeps both. */
const RunLink: React.FC<{ status: string; time: string; label?: string; disabled?: boolean; dateOnly?: boolean; onOpen: () => void }> = ({
    status, time, label, disabled, dateOnly, onOpen }) => {
    const display = runStatusDisplay(status);
    return <Tooltip title={`${display.label} · ${shortRunTime(time)}`}>
        <ButtonBase disabled={disabled} aria-label={label ?? `${display.label}, ${shortRunTime(time)}`}
            onClick={event => { event.stopPropagation(); onOpen(); }}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0, px: 0.625, borderRadius: 0.5, bgcolor: mutedChipBg,
                fontSize: textVar.xs, lineHeight: 1.7, color: 'text.secondary', fontVariantNumeric: 'tabular-nums',
                '&:hover': { color: 'text.primary', bgcolor: ink(0.09) },
                '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
            <Box component="span" role="img" aria-label={display.label}
                sx={{ display: 'inline-flex', color: display.color, '& .MuiSvgIcon-root': { fontSize: 12 } }}>{display.icon}</Box>
            <span>{dateOnly ? new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : shortRunTime(time)}</span>
        </ButtonBase>
    </Tooltip>;
};

export type RunEntry = { key: string; status: string; time: string; label?: string; disabled?: boolean; open: () => void };

/** Newest-first run chips; `(more)` reveals the rest in a scrollable area. */
export const RunList: React.FC<{ label: string; runs: RunEntry[]; limit?: number; caption?: string; dateOnly?: boolean }> = ({
    label, runs, limit = 3, caption, dateOnly }) => {
    const { t } = useTranslation();
    const [showAll, setShowAll] = useState(false);
    return <Box role="group" aria-label={label} sx={{ mt: 0.5,
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 0.5, rowGap: 0.5, ...(showAll ? { maxHeight: 160, overflowY: 'auto' } : {}) }}>
        {caption && <Typography component="span" sx={{ fontSize: textVar.xs, color: 'text.secondary', mr: 0.25 }}>{caption}</Typography>}
        {(showAll ? runs : runs.slice(0, limit)).map(run => <RunLink key={run.key} status={run.status} time={run.time}
            label={run.label} disabled={run.disabled} dateOnly={dateOnly} onOpen={run.open} />)}
        {runs.length > limit && <ButtonBase onClick={event => { event.stopPropagation(); setShowAll(previous => !previous); }}
            sx={{ fontSize: textVar.xs, lineHeight: 1.7, color: 'text.secondary', borderRadius: 0.5, '&:hover': { color: 'text.primary', textDecoration: 'underline' } }}>
            {showAll ? t('schedule.less') : t('schedule.more')}
        </ButtonBase>}
    </Box>;
};
