// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Canvas views for the configure skill's setup forms: schedules, sessions, and
 * workflow proposals (connectors render through `ConnectorFormCard`). Each is a
 * prefilled artifact the user reviews and submits through the same APIs as the
 * matching manual dialog. A form revising an existing item lets the user update
 * it or save a new one. A form the agent applied directly submits itself once.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel,
    Radio, RadioGroup, Tab, Tabs, TextField, Typography } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import SaveIcon from '@mui/icons-material/Save';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReactMarkdown from 'react-markdown';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import { ItemCard, ItemCardAction, itemCardGridSx, MetaChip } from '../components/ItemCard';
import { MarkdownEditor } from '../components/MarkdownEditor';
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
import { notifyWorkspaceFilesChanged } from '../app/workspaceService';
import type { ScheduleConfig, ScheduleFormArtifact, SessionsFormArtifact, SetupFormTarget, TextTurn, WorkflowFormArtifact } from '../components/ComponentType';
import { defaultScheduleConfig, listWorkflowLibrary, saveSchedule, ScheduleConfigFields, scheduleCadence, workflowApi, WorkflowLibraryItem,
    WorkflowSetup, WorkflowSetupFields, workflowSetupContentSx } from './WorkflowSchedules';
import { executeWorkflow } from './WorkflowPanel';

const errorMessage = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback;

type TargetMode = 'update' | 'new';

/** Choose whether saving updates the item the agent proposed to revise or creates a new one. */
const TargetChoice: React.FC<{ target: SetupFormTarget; noun: string; value: TargetMode; onChange: (value: TargetMode) => void;
    disabled?: boolean }> = ({ target, noun, value, onChange, disabled }) => {
    const { t } = useTranslation();
    return <RadioGroup row aria-label={t('setupForm.saveTarget', { defaultValue: 'Save as' })} value={value}
        onChange={(_, next) => onChange(next as TargetMode)}
        sx={{ columnGap: 2, '& .MuiFormControlLabel-root': { m: 0, gap: 0.5, minWidth: 0 }, '& .MuiRadio-root': { p: 0.5 },
            '& .MuiFormControlLabel-label': { fontSize: textVar.sm, overflowWrap: 'anywhere' } }}>
        <FormControlLabel value="update" disabled={disabled} control={<Radio size="small" />}
            label={t('setupForm.updateExisting', { defaultValue: 'Update {{name}}', name: target.name })} />
        <FormControlLabel value="new" disabled={disabled} control={<Radio size="small" />}
            label={t('setupForm.saveAsNew', { defaultValue: 'Save as new {{noun}}', noun })} />
    </RadioGroup>;
};

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
    const [mode, setMode] = useState<TargetMode>('update');
    const { schedule } = form;
    const saved = schedule.status === 'saved';
    const updating = !!schedule.target && mode === 'update';
    const config: ScheduleConfig = useMemo(() => ({
        ...defaultScheduleConfig(models, selectedModelId), ...schedule.config,
    }), [models, selectedModelId, schedule.config]);
    const update = (patch: Partial<ScheduleFormArtifact['schedule']>, extra: Partial<TextTurn> = {}) =>
        dispatch(dfActions.updateTextTurn({ id: turn.id, ...extra, form: { ...form, schedule: { ...schedule, ...patch } } }));

    useEffect(() => {
        let cancelled = false;
        Promise.all([listWorkflowLibrary(), apiRequest<{ available: boolean }>('/api/schedules')])
            .then(([library, { data }]) => { if (!cancelled) { setItems(library); setAvailable(data.available); } })
            .catch(reason => { if (!cancelled) { setItems([]); setAvailable(false); setError(errorMessage(reason, t('workflow.loadFailed'))); } });
        return () => { cancelled = true; };
    }, []);

    const problems = [
        !config.workflow || (items && !items.some(item => item.path === config.workflow)) ? t('setupForm.chooseWorkflow', { defaultValue: 'Choose a saved workflow.' }) : '',
        !config.name.trim() ? t('setupForm.nameSchedule', { defaultValue: 'Name the schedule.' }) : '',
        !config.weekdays.length ? t('setupForm.chooseDays', { defaultValue: 'Choose at least one day.' }) : '',
        !config.model_id ? t('setupForm.chooseModel', { defaultValue: 'Choose a server model connection.' }) : '',
    ].filter(Boolean);

    const submit = async () => {
        if (saving || problems.length || !available) return;
        setSaving(true); setError('');
        try {
            const result = await saveSchedule(config, updating ? schedule.target!.id : undefined);
            update({ config, status: 'saved', savedId: result.id, nextAt: result.next_at, issues: [] },
                { answered: true, answer: `Saved schedule ${config.name}` });
        } catch (reason) {
            setError(errorMessage(reason, t('schedule.saveFailed')));
        } finally {
            setSaving(false);
        }
    };

    // A directly applied schedule submits once, after the library loads, when it has no open issues.
    useEffect(() => {
        if (items === null || available === null || saved || !takeAutoSubmit(turn.id)) return;
        // Elevated options always need the user's own Save, even if the agent asked to apply directly.
        if (!problems.length && !schedule.issues?.length && available && !config.auto_approve) void submit();
    }, [items, available]);

    if (saved) {
        return <SetupFormFrame icon={<ScheduleOutlinedIcon />} title={form.title} done>
            <ItemCard compact title={config.name}
                captions={[config.enabled === false
                    ? t('setupForm.schedulePaused', { defaultValue: 'Saved paused. Resume it from the Schedules tab.' })
                    : t('setupForm.scheduleSaved', { defaultValue: 'Saved. Manage it from the Schedules tab.' })]}
                meta={<>
                    <MetaChip icon={<HistoryOutlinedIcon />}>{scheduleCadence(config)} · {config.timezone}</MetaChip>
                    {config.enabled !== false && schedule.nextAt && <MetaChip icon={<ScheduleOutlinedIcon />}
                        label={t('setupForm.nextRun', { defaultValue: 'Next run' })}>{new Date(schedule.nextAt).toLocaleString()}</MetaChip>}
                </>} />
        </SetupFormFrame>;
    }
    return <SetupFormFrame icon={<ScheduleOutlinedIcon />} title={form.title} actions={<Button variant="contained" disableElevation
        disabled={saving || !available || problems.length > 0} onClick={() => void submit()}
        startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}>
        {updating ? t('setupForm.updateSchedule', { defaultValue: 'Update schedule' }) : t('setupForm.saveSchedule', { defaultValue: 'Save schedule' })}
    </Button>}>
        {schedule.target && <TargetChoice target={schedule.target} noun={t('setupForm.scheduleNoun', { defaultValue: 'schedule' })}
            value={mode} onChange={setMode} disabled={saving} />}
        {!!schedule.issues?.length && <Alert severity="warning">{schedule.issues.map(issue => <Box key={issue}>{issue}</Box>)}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        {items === null ? <CircularProgress size={18} /> : available === false
            ? <Alert severity="info">{t('schedule.localOnly')}</Alert>
            : <ScheduleConfigFields items={items} config={config} disabled={saving}
                onChange={next => update({ config: next, issues: [] })} />}
    </SetupFormFrame>;
};

type SessionItem = SessionsFormArtifact['sessions']['items'][number];

const sessionSubtitle = (item: SessionItem) => [
    item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '',
    item.tableCount != null ? i18n.t('setupForm.tableCount', { count: item.tableCount }) : '',
    item.chartCount != null ? i18n.t('setupForm.chartCount', { count: item.chartCount }) : '',
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
    // Patch the stored form, not this render's copy: sequential direct renames must not overwrite each other.
    const setItem = (sessionId: string, patch: Partial<SessionItem>) => dispatch((_: unknown, getState: () => DataFormulatorState) => {
        const latest = getState().textTurns.find(item => item.id === turn.id)?.form;
        if (latest?.kind !== 'sessions') return;
        dispatch(dfActions.updateTextTurn({ id: turn.id, form: { ...latest, sessions: { ...latest.sessions,
            items: latest.sessions.items.map(item => item.sessionId === sessionId ? { ...item, ...patch } : item) } } }));
    });
    const isCurrent = (item: SessionItem) => item.current || item.sessionId === activeId;
    const nameOf = (item: SessionItem) => isCurrent(item) && activeName ? activeName : item.currentName;

    const rename = async (item: SessionItem, value: string) => {
        const next = value.trim();
        setEditing(null);
        if (!next || next === nameOf(item)) return;
        setBusy(item.sessionId); setError('');
        try {
            await dispatch(renameSession(item.sessionId, next));
            setItem(item.sessionId, { currentName: next, suggestedName: undefined, renamed: true });
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
        <Box component="ul" aria-label={form.title} sx={{ listStyle: 'none', m: 0, p: 0, ...itemCardGridSx }}>
            {sessions.items.map(item => {
                const current = isCurrent(item);
                const name = nameOf(item);
                const disabled = readOnly || busy === item.sessionId;
                return <Box component="li" key={item.sessionId} sx={{ minWidth: 0 }}>
                    <ItemCard
                        title={name}
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
                            <ItemCardAction label={t('setupForm.renameNamed', { defaultValue: 'Rename {{name}}', name })} icon={<EditOutlinedIcon />}
                                disabled={disabled} onClick={() => setEditing({ sessionId: item.sessionId, value: item.suggestedName || name })} />
                            {!current && <ItemCardAction label={t('setupForm.openNamedNewTab', { defaultValue: 'Open {{name}} in new tab', name })}
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
                <Button onClick={() => setPendingDelete(null)}>{t('app.cancel')}</Button>
                <Button color="error" variant="contained" disableElevation onClick={() => pendingDelete && void remove(pendingDelete)}>
                    {t('setupForm.delete', { defaultValue: 'Delete' })}
                </Button>
            </DialogActions>
        </Dialog>
    </SetupFormFrame>;
};

const workflowFilename = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow'}.workflow.yaml`;

/** A proposed workflow definition: Illustration/YAML views with Save and Run. Inline (non-canvas) inside conversation history. */
export const WorkflowFormArtifactView: React.FC<{ turn: TextTurn; form: WorkflowFormArtifact; canvas?: boolean }> = ({ turn, form, canvas = false }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const proposal = form.workflow;
    const { definition, target } = proposal;
    const workspaceId = useSelector((state: DataFormulatorState) => state.activeWorkspace?.id);
    const readOnly = useSelector((state: DataFormulatorState) => state.activeWorkspace?.readOnly);
    const hasModel = useSelector((state: DataFormulatorState) => [...state.globalModels, ...state.models].some(model => model.id === state.selectedModelId));
    const busy = useSelector((state: DataFormulatorState) => state.textTurns.some(item => item.workflow?.status === 'running'));
    const [mode, setMode] = useState<TargetMode>('update');
    const [targetHash, setTargetHash] = useState<string>();
    const updating = !!target && mode === 'update';
    const [filename, setFilename] = useState(() => {
        if (proposal.saved && proposal.saved.path !== target?.id) return proposal.saved.path;
        const name = workflowFilename(definition.name);
        return name === target?.id ? name.replace(/\.workflow\.yaml$/, '-2.workflow.yaml') : name;
    });
    const [saving, setSaving] = useState(false);
    const [starting, setStarting] = useState(false);
    const [saveOpen, setSaveOpen] = useState(false);
    const [workflowName, setWorkflowName] = useState(definition.name);
    const [saveError, setSaveError] = useState('');
    const [setupOpen, setSetupOpen] = useState(false);
    const [definitionView, setDefinitionView] = useState<'illustration' | 'yaml'>('illustration');
    const [values, setValues] = useState<WorkflowSetup['parameters']>(() => Object.fromEntries((definition.parameters || [])
        .map(parameter => [parameter.name, parameter.default ?? (parameter.type === 'boolean' ? false : '')])));
    const [instructions, setInstructions] = useState('');
    const [error, setError] = useState('');
    const generation = useRef(0);
    useEffect(() => { generation.current += 1; return () => { generation.current += 1; }; }, [workspaceId, turn.id]);
    const openSave = () => {
        setWorkflowName(definition.name); setSaveError(''); setSaveOpen(true);
        // Read the target's hash when the dialog opens, so edits made after that are not silently overwritten.
        if (target) void workflowApi<{ content_hash?: string }>('read', { path: target.id })
            .then(result => setTargetHash(result.content_hash)).catch(() => setTargetHash(undefined));
    };
    const proseStyle = { fontSize: 'inherit', lineHeight: 1.5, '& p': { my: 0 }, '& ul, & ol': { pl: 2.5, my: 0.5 },
        '& h1, & h2, & h3, & h4': { fontSize: 'inherit', fontWeight: 600, mt: 1, mb: 0.5 },
        '& pre': { overflowX: 'auto', whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1.5, borderRadius: 1 },
        '& code': { fontFamily: 'var(--df-font-mono)', fontSize: '0.95em' }, '& a': { color: 'primary.main' } };
    const renderInput = (value: unknown): React.ReactNode => {
        if (Array.isArray(value) && value.every(item => item === null || typeof item !== 'object')) {
            return <Typography sx={{ fontSize: 'inherit', lineHeight: 1.5 }}>{value.map(item => String(item ?? t('workflow.notSpecified'))).join(', ')}</Typography>;
        }
        if (Array.isArray(value)) return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>{value.map((item, index) =>
            <Box key={index} sx={{ ...(index > 0 && typeof item === 'object' ? { borderTop: 1, borderColor: 'divider', pt: 1 } : {}) }}>{renderInput(item)}</Box>)}</Box>;
        if (value !== null && typeof value === 'object') return <Box component="dl" sx={{ m: 0 }}>
            {Object.entries(value).map(([key, item]) => <Box key={key} sx={{ py: 0.25, display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)', columnGap: 1.5 }}>
                <Typography component="dt" sx={{ fontSize: textVar.sm, color: 'text.secondary', textTransform: 'capitalize', lineHeight: 1.5 }}>{key.replace(/[_-]/g, ' ')}</Typography>
                <Box component="dd" sx={{ m: 0, minWidth: 0 }}>{renderInput(item)}</Box>
            </Box>)}
        </Box>;
        return <Box sx={proseStyle}><ReactMarkdown>{value == null ? t('workflow.notSpecified') : String(value)}</ReactMarkdown></Box>;
    };
    const definitionSection = (label: string, children: React.ReactNode) => <Box component="section" sx={{ mt: 2 }}>
        <Typography component="h2" sx={{ fontSize: 'inherit', fontWeight: 600, mb: 0.5 }}>{label}</Typography>
        {children}
    </Box>;
    return <Box component="section" id={canvas ? 'vis-view-canvas' : undefined} aria-label={t('workflow.definition')} sx={{
        py: canvas ? 0 : 1, minWidth: 0, overflowWrap: 'anywhere', width: '100%', boxSizing: 'border-box',
        fontFamily: theme => theme.typography.fontFamily, fontSize: 14, lineHeight: 1.5, letterSpacing: 0,
        ...(canvas ? { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.paper' } : {}),
    }}>
        <Box sx={{ px: canvas ? { xs: 2, sm: 3 } : 0, pt: canvas ? 2 : 0, flexShrink: 0 }}>
            <Box sx={{ width: '100%', maxWidth: 900, mx: 'auto' }}>
                <Typography component="h1" variant="h6" sx={{ fontWeight: 600, m: 0 }}>{definition.name}</Typography>
                <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary', mt: 0.25, mb: 0.5 }}>
                    {target ? t('workflow.definitionRevises', { name: target.name }) : t('workflow.definition')}</Typography>
                <Tabs value={definitionView} onChange={(_, value) => setDefinitionView(value)} aria-label={t('workflow.definitionView')}
                    sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 36, px: 1.5, fontSize: textVar.sm, textTransform: 'none' } }}>
                    <Tab id={`workflow-illustration-${turn.id}`} aria-controls={`workflow-definition-view-${turn.id}`} value="illustration" label={t('workflow.illustration')} />
                    <Tab id={`workflow-yaml-${turn.id}`} aria-controls={`workflow-definition-view-${turn.id}`} value="yaml" label="YAML" />
                </Tabs>
            </Box>
        </Box>
        <Box data-workflow-definition-content role="tabpanel" id={`workflow-definition-view-${turn.id}`} aria-labelledby={`workflow-${definitionView}-${turn.id}`}
            sx={canvas ? { flex: 1, minHeight: 0, overflowY: 'auto', px: { xs: 2, sm: 3 }, pt: 2, pb: 2 } : { pt: 2 }}>
            <Box sx={{ width: '100%', maxWidth: 900, mx: 'auto', ...(definitionView === 'yaml' ? { height: canvas ? '100%' : 480, minHeight: 160 } : {}) }}>
                {definitionView === 'yaml' ? <MarkdownEditor fileName="definition.workflow.yaml" value={proposal.content} onChange={() => {}} readOnly showToolbar={false} lineWrap /> : <>
                <Box sx={{ ...proseStyle, color: 'text.secondary' }}><ReactMarkdown>{definition.overview}</ReactMarkdown></Box>
                {definition.prompt && definitionSection(definition.steps?.length ? t('workflow.guidelines') : t('workflow.goalAndMethod'), <Box sx={proseStyle}><ReactMarkdown>{definition.prompt}</ReactMarkdown></Box>)}
                {definition.source != null && definitionSection(t('workflow.inputs'), renderInput(definition.source))}
                {!!definition.parameters?.length && definitionSection(t('workflow.parameters'),
                    <Box component="dl" sx={{ m: 0 }}>{definition.parameters.map(parameter => <Box key={parameter.name} sx={{ py: 0.75,
                        display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(130px, 1fr) minmax(0, 2fr)' }, columnGap: 2, rowGap: 0.25 }}>
                        <Typography component="dt" sx={{ fontSize: 'inherit', fontWeight: 500 }}>{parameter.label}
                            {parameter.required && <Box component="span" sx={{ ml: 0.75, fontSize: textVar.sm, color: 'text.secondary' }}>{t('workflow.required')}</Box>}
                        </Typography>
                        <Box component="dd" sx={{ m: 0 }}>
                            {parameter.description && <Box sx={proseStyle}><ReactMarkdown>{parameter.description}</ReactMarkdown></Box>}
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, color: 'text.secondary' }}>
                                {parameter.default !== undefined && <Typography sx={{ fontSize: textVar.sm }}>{t('workflow.defaultValue', { value: String(parameter.default) })}</Typography>}
                                {!!parameter.options?.length && <Typography sx={{ fontSize: textVar.sm }}>{t('workflow.options', { options: parameter.options.join(', ') })}</Typography>}
                            </Box>
                        </Box>
                    </Box>)}</Box>
                )}
                {!!definition.steps?.length && definitionSection(t('workflow.executionSteps'), <Box component="ol" sx={{ my: 0, pl: 2.5 }}>
                    {definition.steps.map(step => <Box component="li" key={step.id} sx={{ mb: 1 }}>
                        <Typography sx={{ fontSize: 'inherit', fontWeight: 500 }}>{step.description || step.id}</Typography>
                        <Box sx={proseStyle}><ReactMarkdown>{step.instructions}</ReactMarkdown></Box>
                        {!!step.checkers?.length && <Box component="ul" sx={{ my: 0.5, pl: 2.5, color: 'text.secondary' }}>
                            {step.checkers.map(check => <Box component="li" key={check.id} sx={proseStyle}>
                                <ReactMarkdown>{t('workflow.checkerLine', { when: t(`workflow.checkWhen.${check.when || 'after'}`), condition: check.condition })
                                    + (check.on_fail ? ` ${t('workflow.onFailureParenthetical', { action: check.on_fail })}` : '')}</ReactMarkdown>
                            </Box>)}
                        </Box>}
                        {step.next && <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary' }}>{t('workflow.nextStep', { step: step.next })}</Typography>}
                    </Box>)}
                </Box>)}
                {definitionSection(t('workflow.deliverables'), <Box component="ul" sx={{ my: 0, pl: 2.5 }}>{definition.deliverables.map((item, index) =>
                    <Box component="li" key={index} sx={proseStyle}><ReactMarkdown>{item}</ReactMarkdown></Box>)}</Box>)}
                </>}
                {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
            </Box>
        </Box>
        <Box role="group" aria-label={t('workflow.actions')} sx={{ display: 'flex', justifyContent: 'center', flexShrink: 0, px: 2, pt: 1.5, pb: canvas ? 3 : 1, bgcolor: 'background.paper' }}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 0.5,
                px: 1, py: 0.5, borderRadius: '8px', border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
                <Button size="small" variant="text" startIcon={<SaveIcon />} disabled={saving}
                    sx={{ textTransform: 'none', flexShrink: 0, color: 'primary.main' }} onClick={openSave}>{t('workflow.saveWorkflow')}</Button>
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.75 }} />
                <Button size="small" variant="text" startIcon={<PlayArrowIcon />} disabled={busy || starting || readOnly || !workspaceId || !hasModel}
                    sx={{ textTransform: 'none', flexShrink: 0, color: 'text.secondary' }} onClick={() => setSetupOpen(true)}>{t('workflow.runWorkflow')}</Button>
            </Box>
        </Box>
        <Dialog open={saveOpen} onClose={() => !saving && setSaveOpen(false)} fullWidth maxWidth="sm" aria-labelledby={`workflow-save-${turn.id}`}>
            <Box component="form" onSubmit={async event => {
                    event.preventDefault();
                    const path = updating ? target!.id : filename.trim();
                    if (saving || !path || !workflowName.trim()) return;
                    const current = generation.current;
                    setSaving(true); setSaveError('');
                    try {
                        const name = workflowName.trim();
                        const content = name === definition.name ? proposal.content
                            : dumpYaml({ ...(loadYaml(proposal.content) as Record<string, unknown>), name }, { lineWidth: -1 });
                        const contentHash = proposal.saved?.path === path ? proposal.saved.content_hash : updating ? targetHash : undefined;
                        const saved = await workflowApi<{ path: string; content_hash: string }>('save', { path, content,
                            ...(contentHash ? { content_hash: contentHash } : {}) });
                        if (current !== generation.current) return;
                        dispatch(dfActions.updateTextTurn({ id: turn.id, form: { ...form, title: name,
                            workflow: { ...proposal, content, definition: { ...definition, name }, saved } } }));
                        setSaveOpen(false);
                        notifyWorkspaceFilesChanged();
                    } catch (reason) { if (current === generation.current) setSaveError(errorMessage(reason, t('workflow.saveFailed'))); }
                    finally { if (current === generation.current) setSaving(false); }
            }}>
                <DialogTitle id={`workflow-save-${turn.id}`}>{t('workflow.saveWorkflow')}</DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
                    {saveError && <Alert severity="error">{saveError}</Alert>}
                    {target && <TargetChoice target={target} noun={t('setupForm.workflowNoun')} value={mode} onChange={setMode} disabled={saving} />}
                    <TextField autoFocus required label={t('workflow.workflowName')} size="small" value={workflowName} disabled={saving}
                        onChange={event => setWorkflowName(event.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
                    {!updating && <TextField required label={t('workflow.filename')} size="small" value={filename} disabled={saving}
                        onChange={event => setFilename(event.target.value)} slotProps={{ htmlInput: { pattern: '[^/\\\\]+\\.workflow\\.ya?ml' } }} />}
                </DialogContent>
                <DialogActions><Button disabled={saving} onClick={() => setSaveOpen(false)}>{t('app.cancel')}</Button>
                    <Button type="submit" startIcon={<SaveIcon />} disabled={saving || (!updating && !filename.trim()) || !workflowName.trim()}>
                        {updating ? t('workflow.update') : t('app.save')}</Button></DialogActions>
            </Box>
        </Dialog>
        <Dialog open={setupOpen} onClose={() => !starting && setSetupOpen(false)} fullWidth maxWidth="sm" aria-labelledby={`workflow-setup-${turn.id}`}>
            <Box component="form" onSubmit={async event => {
                event.preventDefault();
                if (starting || busy || readOnly || !hasModel) return;
                const current = generation.current;
                const parameters = Object.fromEntries((definition.parameters || []).map(parameter => [parameter.name,
                    parameter.type === 'number' && values[parameter.name] !== '' ? Number(values[parameter.name]) : values[parameter.name]]));
                setStarting(true); setError('');
                try { await executeWorkflow({ content: proposal.content, setup: { parameters, instructions: instructions.trim() } }, () => setSetupOpen(false)); }
                catch (reason) { if (current === generation.current) { setError(errorMessage(reason, t('workflow.runFailed'))); setSetupOpen(false); } }
                finally { if (current === generation.current) setStarting(false); }
            }}>
                <DialogTitle id={`workflow-setup-${turn.id}`} sx={{ fontSize: textVar.xl, lineHeight: 1.5, fontWeight: 400, overflowWrap: 'anywhere', pb: 2 }}>
                    <Box component="span" sx={{ color: 'text.primary' }}>{t('workflow.runWorkflowPrefix')}</Box>{' '}
                    <Box component="span" sx={{ color: 'primary.main' }}>{definition.name}</Box>
                </DialogTitle>
                <DialogContent sx={workflowSetupContentSx}>
                    <WorkflowSetupFields parameters={definition.parameters || []} values={values} onChange={setValues} disabled={starting} />
                    <TextField label={t('workflow.additionalInstructions')} size="small" multiline minRows={3} value={instructions} disabled={starting}
                        onChange={event => setInstructions(event.target.value)} slotProps={{ htmlInput: { maxLength: 8000 } }} />
                </DialogContent>
                <DialogActions sx={{ px: 3, py: 1.5, borderTop: 1, borderColor: 'divider' }}><Button disabled={starting} onClick={() => setSetupOpen(false)}>{t('app.cancel')}</Button>
                    <Button type="submit" startIcon={<PlayArrowIcon />} disabled={starting || busy || readOnly || !hasModel}>{t('workflow.runWorkflow')}</Button></DialogActions>
            </Box>
        </Dialog>
    </Box>;
};
