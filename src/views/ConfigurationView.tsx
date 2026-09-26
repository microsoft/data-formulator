import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dfLogo from '../assets/df-logo.svg';
import { alpha } from '@mui/material/styles';
import { Alert, Box, Button, Card, CardActionArea, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Radio, RadioGroup, Switch, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import AddIcon from '@mui/icons-material/Add';
import { apiRequest } from '../app/apiClient';
import { store } from '../app/store';
import { dfActions, fetchGlobalModelList } from '../app/dfSlice';
import { useBlocker } from 'react-router-dom';
import { ModelSelectionButton } from './ModelSelectionDialog';
import { ConnectorSetupForm } from './UnifiedDataUploadDialog';
import { deriveConnectorDisplayName } from '../app/connectorNames';
import { ArtifactDeleteButton } from './DataThreadCards';
import { iconVar, textVar } from '../app/layout';
import { getConnectorIcon } from '../icons';
import { MarkdownEditor } from '../components/MarkdownEditor';

type Entry = { enabled?: boolean; display_name?: string; description?: string; content?: string; file?: string };
type ConnectionSettings = { credential_ref: string; endpoint?: string; model?: string; api_base?: string; api_version?: string;
    auth_mode?: string; managed_identity_client_id?: string; type?: string; display_name?: string; params?: Record<string, string> };
type Overrides = { models?: Record<string, Entry>; connectors?: Record<string, Entry>; workflows?: Record<string, Entry>;
    app_name?: string; app_tagline?: string;
    disable_user_connectors?: boolean;
    disable_user_models?: boolean;
    default_model?: string; limits?: Record<string, number>; allowed_api_bases?: string[];
    connections?: Partial<Record<'models' | 'connectors', Record<string, string | ConnectionSettings>>> };
type CatalogItem = { id: string; model?: string; endpoint?: string; display_name?: string; description?: string; name?: string; content?: string; source?: string; type?: string;
    params?: Record<string, string>; definition?: Record<string, string> };
type Snapshot = { version?: number; revision: number; overrides: Overrides; catalogs: Record<'models' | 'connectors' | 'workflows', CatalogItem[]>;
    user_connectors?: { disabled: boolean; locked: boolean };
    user_models?: { disabled: boolean; locked: boolean };
    loader_types?: React.ComponentProps<typeof ConnectorSetupForm>['loaderTypes'];
    allowed_api_bases?: { locked: boolean; value: string[] | null };
    limits: Record<string, { value: number; default: number; locked: boolean; source: string }> };

const newWorkflowTemplate = 'version: 1\nname: Team review\noverview: Review the selected data\ndeliverables:\n  - A summary report\nsteps:\n  - id: review\n    instructions: Analyze the data and write a summary report\n';

const withDefaultModel = (overrides: Overrides, models: CatalogItem[]): Overrides => {
    const available = models.filter(model => overrides.models?.[model.id]?.enabled !== false
        && (!model.id.startsWith('installation-') || overrides.connections?.models?.[model.id]));
    const defaultModel = available.find(model => model.id === overrides.default_model)?.id || available[0]?.id;
    const next = { ...overrides };
    if (defaultModel) next.default_model = defaultModel;
    else delete next.default_model;
    return next;
};

export const ConfigurationView = () => {
    const { t } = useTranslation();
    const [saved, setSaved] = useState<Snapshot>();
    const [draft, setDraft] = useState<Overrides>({});
    const [tab, setTab] = useState<'connectors' | 'models' | 'workflows' | 'limits'>('connectors');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [workflowName, setWorkflowName] = useState('');
    const [workflowContent, setWorkflowContent] = useState(newWorkflowTemplate);
    const [adding, setAdding] = useState(false);
    const [view, setView] = useState<'form' | 'json'>('form');
    const [staged, setStaged] = useState<CatalogItem[]>([]);
    const [connectorType, setConnectorType] = useState('');
    const [testing, setTesting] = useState(false);
    const [actionContainer, setActionContainer] = useState<HTMLDivElement | null>(null);
    const [editing, setEditing] = useState<CatalogItem>();
    const [propertyName, setPropertyName] = useState('');
    const [propertyDescription, setPropertyDescription] = useState('');
    const environmentManaged = !!editing && tab !== 'workflows' && !editing.id.startsWith('installation-');
    const modelsDisabled = saved?.user_models?.locked ? saved.user_models.disabled : draft.disable_user_models ?? saved?.user_models?.disabled ?? false;
    const endpointsRestricted = saved?.allowed_api_bases?.locked ? !!saved.allowed_api_bases.value?.length : draft.allowed_api_bases !== undefined;
    const modelPolicy = modelsDisabled ? 'disabled' : endpointsRestricted ? 'restricted' : 'unrestricted';
    const stage = async (section: 'models' | 'connectors', definition: Record<string, any>) => {
        if (!saved) return;
        setTesting(true); setError(''); setNotice('');
        try {
            const previousConnection = editing ? draft.connections?.[section]?.[editing.id] : undefined;
            const { data } = await apiRequest<CatalogItem & { reference: string }>('/api/configurations/test-connection', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DF-Configuration': '1' },
                body: JSON.stringify(environmentManaged ? { section, id: editing!.id }
                    : { section, definition, ...(editing ? { id: editing.id,
                        reference: typeof previousConnection === 'string' ? previousConnection : previousConnection?.credential_ref } : {}) }),
            });
            const testedConnection: ConnectionSettings = { ...(section === 'models' ? data.definition
                : { type: data.type, display_name: data.display_name, params: data.params }), credential_ref: data.reference };
            const withConnection = (overrides: Overrides, connection: string | ConnectionSettings = testedConnection): Overrides => withDefaultModel({ ...overrides,
                ...(!environmentManaged ? { connections: { ...overrides.connections,
                    [section]: { ...overrides.connections?.[section], [data.id]: connection } } } : {}),
                ...(editing ? { [section]: { ...overrides[section], [data.id]: { ...overrides[section]?.[data.id],
                    display_name: section === 'connectors' ? definition.display_name : propertyName,
                    ...(section === 'connectors' ? { description: propertyDescription } : {}) } } } : {}) },
                [...saved.catalogs.models, ...staged.filter(item => !!item.model), ...(section === 'models' ? [data] : [])]);
            const { data: updated } = await apiRequest<Snapshot>('/api/configurations', {
                method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-DF-Configuration': '1' },
                body: JSON.stringify({ revision: saved.revision, overrides: withConnection(saved.overrides) }),
            });
            setSaved(updated);
            setDraft(previous => {
                if (JSON.stringify(previous) === JSON.stringify(saved.overrides)) return updated.overrides;
                const next = withConnection(previous, updated.overrides.connections?.[section]?.[data.id] ?? testedConnection);
                next.connections = { ...next.connections };
                for (const collection of ['models', 'connectors'] as const) {
                    if (!next.connections[collection]) continue;
                    next.connections[collection] = Object.fromEntries(Object.entries(next.connections[collection]!).map(([id, value]) => [id,
                        JSON.stringify(value) === JSON.stringify(saved.overrides.connections?.[collection]?.[id])
                            ? updated.overrides.connections?.[collection]?.[id] ?? value : value]));
                }
                return next;
            });
            if (!environmentManaged) setStaged(previous => [...previous.filter(item => item.id !== data.id), data]);
            setAdding(false); setNotice('Connection saved');
            void store.dispatch(fetchGlobalModelList());
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
            throw reason;
        } finally { setTesting(false); }
    };
    const dirty = !!saved && (adding || JSON.stringify(draft) !== JSON.stringify(saved.overrides));
    const blocker = useBlocker(dirty);
    const load = async () => {
        setBusy(true); setError(''); setNotice('');
        try {
            const { data } = await apiRequest<Snapshot>('/api/configurations');
            setSaved(data); setDraft(data.overrides);
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setBusy(false); }
    };
    useEffect(() => { void load(); }, []);
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);
    const update = (section: 'models' | 'connectors' | 'workflows', id: string, values: Entry) => {
        setNotice('');
        setDraft(previous => ({ ...previous, [section]: { ...previous[section], [id]: { ...previous[section]?.[id], ...values } } }));
    };
    const reset = (section: 'models' | 'connectors' | 'workflows', id: string) => setDraft(previous => {
        const entries = { ...previous[section] }; delete entries[id];
        return { ...previous, [section]: entries };
    });
    const save = async () => {
        if (!saved) return;
        setBusy(true); setError(''); setNotice('');
        try {
            const { data } = await apiRequest<Snapshot>('/api/configurations', { method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-DF-Configuration': '1' },
                body: JSON.stringify({ revision: saved.revision, overrides: withDefaultModel(draft, getRows('models')) }) });
            setSaved(data); setDraft(data.overrides); setNotice('Changes saved');
            const config = await apiRequest('/api/app-config');
            store.dispatch(dfActions.setServerConfig(config.data));
            void store.dispatch(fetchGlobalModelList());
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setBusy(false); }
    };
    const getRows = (tab: 'connectors' | 'models' | 'workflows' | 'limits') => {
    const rows = tab === 'limits' ? [] : [...(saved?.catalogs[tab] || []).map(item => staged.find(candidate => candidate.id === item.id) || item), ...staged.filter(item =>
        (tab === 'models' ? !!item.model : tab === 'connectors' ? !!item.type : false) && !saved?.catalogs[tab].some(savedItem => savedItem.id === item.id))]
        .filter(item => !item.id.startsWith('installation-') || (tab !== 'workflows' && !!draft.connections?.[tab as 'models' | 'connectors']?.[item.id]));
    if (tab === 'workflows') for (const [id, entry] of Object.entries(draft.workflows || {})) {
        if (!rows.some(item => item.id === id)) rows.push({ id, name: id, content: entry.content, source: 'Saved' });
    }
    return rows;
    };
    const workflowId = `server/${workflowName.trim()}`;
    const workflowExists = getRows('workflows').some(item => item.id === workflowId);
    const workflowNameValid = /^[A-Za-z0-9][A-Za-z0-9_-]*\.yaml$/.test(workflowName.trim());
    return <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto', bgcolor: 'background.paper',
        backgroundImage: theme => `linear-gradient(90deg, ${alpha(theme.palette.text.primary, 0.025)} 1px, transparent 1px), linear-gradient(0deg, ${alpha(theme.palette.text.primary, 0.025)} 1px, transparent 1px)`,
        backgroundSize: '16px 16px',
        fontSize: textVar.md,
        '& .MuiTypography-body1, & .MuiTypography-body2, & .MuiInputBase-root, & .MuiInputLabel-root': { fontSize: textVar.md },
        '& .MuiTypography-caption, & .MuiFormHelperText-root': { fontSize: textVar.sm },
        '& .MuiButton-root': { textTransform: 'none', fontSize: textVar.md } }}>
        <Box sx={{ width: '100%', maxWidth: 720, mx: 'auto', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, flexShrink: 0 }}>
                <Typography component="h1" sx={{ fontSize: textVar.xl, fontWeight: 600, flex: 1, minWidth: 0 }}>Administration</Typography>
                <Tooltip title="Reload configuration"><span><IconButton size="small" aria-label="Reload configuration" disabled={busy || dirty} onClick={load}><RefreshIcon sx={{ fontSize: iconVar.md }} /></IconButton></span></Tooltip>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 1.5 }}>
                Configure shared resources and access policies for all users.
            </Typography>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {notice && <Alert severity="success" role="status" sx={{ alignSelf: 'flex-start', alignItems: 'center', mx: 2, mb: 1, p: 0,
                bgcolor: 'transparent', fontSize: textVar.sm,
                '& .MuiAlert-icon': { p: 0, mr: 0.5, fontSize: iconVar.md },
                '& .MuiAlert-message': { py: 0.25 } }}>{notice}</Alert>}
            {blocker.state === 'blocked' && <Alert severity="warning" sx={{ mb: 2 }} action={<Box sx={{ display: 'flex', gap: 1 }}>
                <Button color="inherit" onClick={() => blocker.reset()}>Stay</Button>
                <Button color="inherit" onClick={() => blocker.proceed()}>Discard and leave</Button>
            </Box>}>Unsaved changes</Alert>}
            {busy && !saved && <CircularProgress aria-label="Loading configuration" />}
            {saved && <>
                <Tabs value={view} onChange={(_, value) => setView(value)} aria-label="Configuration view"
                    sx={{ mx: 2, minHeight: 36, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 36, py: 0.75, textTransform: 'none' } }}>
                    <Tab id="configuration-form-tab" aria-controls="configuration-form-panel" value="form" label="Form" />
                    <Tab id="configuration-json-tab" aria-controls="configuration-json-panel" value="json" label="JSON" />
                </Tabs>
                {view === 'json' && <Box role="tabpanel" id="configuration-json-panel" aria-labelledby="configuration-json-tab" sx={{ px: 2, py: 1.5 }}>
                    <Typography component="h2" sx={{ fontSize: textVar.md, fontWeight: 600 }}>Saved configuration JSON</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, mb: 1.5 }}>
                        This JSON contains model and connector settings, but not secrets. Keys and passwords are encrypted in the server credential store and linked by credential_ref. Environment credentials are configured separately on the server.
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                        Custom workflows are YAML files under workflows/. References starting with builtin: point to bundled workflows.
                    </Typography>
                    {dirty && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Unsaved form changes are not included.</Typography>}
                    <Box sx={{ height: 'min(600px, 65vh)', minHeight: 240, minWidth: 0 }}>
                        <MarkdownEditor fileName="configuration.json" readOnly onChange={() => undefined}
                            value={JSON.stringify({ version: saved.version ?? 1, revision: saved.revision,
                                overrides: saved.overrides }, null, 2)} />
                    </Box>
                </Box>}
                <Box role="tabpanel" id="configuration-form-panel" aria-labelledby="configuration-form-tab" hidden={view !== 'form'}>
                <Dialog open={adding} onClose={() => { if (!testing) setAdding(false); }} fullWidth maxWidth={tab === 'models' ? 'sm' : 'md'}
                    slotProps={{ paper: { sx: tab === 'connectors' ? { maxWidth: editing ? 900 : 1120, height: 680 } : {} } }}
                    aria-labelledby="configuration-add-title">
                <DialogTitle id="configuration-add-title" sx={{ fontSize: textVar.xl, fontWeight: 600 }}>{editing ? (tab === 'models' ? 'Edit model' : tab === 'connectors' ? 'Edit data connection' : 'Edit workflow') : (tab === 'models' ? 'Add model' : tab === 'connectors' ? 'Add data connection' : 'Add workflow')}</DialogTitle>
                <DialogContent sx={tab === 'connectors' ? { p: 0, display: 'flex', flexDirection: 'column' } : {}}>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                <Box component="fieldset" disabled={busy || testing} sx={{ border: 0, p: 0, pt: 1, m: 0, minWidth: 0,
                    ...(tab === 'connectors' ? { pt: 0, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : {}) }}>
                {environmentManaged && <Alert severity="info" sx={{ mb: 2 }}>These connection settings come from the server environment and cannot be edited here.</Alert>}
                {editing && tab === 'models' && <Box sx={{ display: 'grid', gap: 1.5, mb: 1.5 }}>
                    <TextField size="small" label="Display name" value={propertyName} onChange={event => setPropertyName(event.target.value)} />
                </Box>}
                {adding && (tab === 'models' || tab === 'connectors') && <Box sx={tab === 'connectors' ? { flex: 1, minHeight: 0, display: 'flex' } : { mb: 2 }}>
                    {adding && tab === 'models' && <Box component="fieldset" disabled={environmentManaged} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
                        <ModelSelectionButton key={editing?.id || 'new'} initialDefinition={editing?.definition || (editing ? { endpoint: editing.endpoint || '', model: editing.model || '' } : undefined)}
                            hasStoredCredentials={!!editing} hideStageAction={environmentManaged} actionContainer={actionContainer} onStageConnection={definition => stage('models', definition)} />
                    </Box>}
                    {adding && tab === 'connectors' && <ConnectorSetupForm
                        loaderTypes={saved.loader_types || []} selectedType={connectorType} onSelectType={editing ? undefined : setConnectorType}
                        connectionProperties={editing ? { displayName: propertyName, description: propertyDescription,
                            onDisplayNameChange: setPropertyName, onDescriptionChange: setPropertyDescription } : undefined}
                        formProps={environmentManaged ? undefined : {
                            dataLoaderType: `configuration:${editing?.id || 'new'}:${connectorType}`,
                            actionContainer, initialConnectionParams: editing?.params, hasStoredCredentials: !!editing,
                            onImport: () => undefined, onFinish: (_, message) => setError(message),
                            onStageConnection: params => stage('connectors', { type: connectorType,
                                display_name: editing ? propertyName.trim() : deriveConnectorDisplayName(
                                    saved.loader_types?.find(loader => loader.type === connectorType)?.name || connectorType, params), params }),
                        }}
                    />}
                </Box>}
                {adding && tab === 'workflows' && <Box component="form" onSubmit={event => {
                    event.preventDefault();
                    if ((!editing && (!workflowNameValid || workflowExists)) || !workflowContent.trim()) return;
                    update('workflows', editing?.id || workflowId, { enabled: editing ? draft.workflows?.[editing.id]?.enabled ?? true : true, content: workflowContent });
                    setAdding(false);
                }} sx={{ display: 'grid', gap: 2 }}>
                    {!editing && <TextField autoFocus size="small" label="New workflow filename" placeholder="team-review.yaml" value={workflowName}
                        onChange={event => setWorkflowName(event.target.value)} error={workflowExists || (!!workflowName && !workflowNameValid)}
                        helperText={workflowExists ? 'A workflow with this filename already exists.' : workflowName && !workflowNameValid ? 'Use letters, numbers, hyphens or underscores, ending in .yaml.' : undefined} />}
                    <Box sx={{ height: 'min(520px, 60vh)', minHeight: 240, minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                        <MarkdownEditor fileName={editing?.id || 'workflow.yaml'} value={workflowContent} onChange={setWorkflowContent} readOnly={busy || testing} />
                    </Box>
                    <Button type="submit" variant="outlined" startIcon={<AddIcon />} sx={{ justifySelf: 'start' }}
                        disabled={(!editing && (!workflowNameValid || workflowExists)) || !workflowContent.trim()}>{editing ? 'Apply to draft' : 'Add to draft'}</Button>
                </Box>}
                </Box>
                </DialogContent>
                <DialogActions sx={{ px: 3, py: 1.5, borderTop: 1, borderColor: 'divider', gap: 1 }}>
                    <Button size="small" disabled={testing} onClick={() => setAdding(false)}>Cancel</Button>
                    <Box ref={setActionContainer} sx={{ display: 'contents' }} />
                    {environmentManaged && <Button size="small" variant="contained" disabled={testing}
                        startIcon={testing ? <CircularProgress size={16} /> : undefined}
                        onClick={() => void stage(tab as 'models' | 'connectors', { display_name: propertyName }).catch(() => undefined)}>
                        Test and save
                    </Button>}
                </DialogActions>
                </Dialog>
                <Box component="fieldset" disabled={busy || testing} sx={{ border: 0, m: 0, px: 2, py: 0, minWidth: 0 }}>
                <Box sx={{ py: 2, borderBottom: 1, borderColor: 'divider', display: 'grid', gap: 1.5 }}>
                    <Typography component="h2" sx={{ fontSize: textVar.lg, fontWeight: 600 }}>Appearance</Typography>
                    <Typography id="appearance-description" variant="body2" color="text.secondary">
                        Customize the front page appearance.
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 2, alignItems: 'stretch' }}>
                        <Box sx={{ display: 'grid', gap: 1.5, minWidth: 0, pt: { xs: 0, sm: '20px' } }}>
                            <TextField size="small" label="App name" placeholder="Data Formulator" value={draft.app_name || ''}
                                slotProps={{ htmlInput: { maxLength: 80, 'aria-describedby': 'appearance-description' } }}
                                onChange={event => { setNotice(''); setDraft(previous => ({ ...previous, app_name: event.target.value })); }} />
                            <TextField size="small" label="Tagline" multiline minRows={2} maxRows={2} value={draft.app_tagline || ''}
                                slotProps={{ htmlInput: { maxLength: 300, 'aria-describedby': 'appearance-description' } }}
                                onChange={event => { setNotice(''); setDraft(previous => ({ ...previous, app_tagline: event.target.value })); }} />
                        </Box>
                        <Box component="figure" aria-label="Appearance preview" sx={{ m: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                            <Typography component="figcaption" variant="caption" color="text.secondary" sx={{ lineHeight: '16px', mb: '4px' }}>Preview</Typography>
                            <Box sx={{ height: 112, flex: 1, overflow: 'auto', px: 1.5, py: 1, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'safe center', textAlign: 'center',
                                border: 1, borderColor: 'divider', borderRadius: 1, backgroundColor: '#ffffff', color: '#202020',
                                backgroundImage: 'linear-gradient(90deg, rgba(0, 0, 0, 0.018) 1px, transparent 1px), linear-gradient(0deg, rgba(0, 0, 0, 0.018) 1px, transparent 1px)',
                                backgroundSize: '12px 12px' }}>
                                <Typography sx={{ fontSize: 18, lineHeight: 1.2, letterSpacing: 0, overflowWrap: 'anywhere' }}>
                                    {draft.app_name?.trim() || 'Data Formulator'}
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 0.5, mt: 0.75 }}>
                                    <Box component="img" src={dfLogo} alt="" sx={{ width: 14, height: 14, flexShrink: 0 }} />
                                    <Typography variant="caption" sx={{ color: '#606060', minWidth: 0, lineHeight: 1.4, overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>
                                        {draft.app_tagline?.trim() || t('landing.tagline', { defaultValue: 'Explore data with visualizations, powered by AI agents.' })}
                                    </Typography>
                                </Box>
                            </Box>
                        </Box>
                    </Box>
                </Box>
                {(['connectors', 'models', 'workflows', 'limits'] as const).map(tab => {
                    const rows = getRows(tab);
                    const demoWorkflows = tab === 'workflows' ? rows.filter(item => item.id.startsWith('demo/')) : [];
                    const cardRows = tab === 'connectors' ? rows.filter(item => item.id !== 'sample_datasets')
                        : tab === 'workflows' ? rows.filter(item => !item.id.startsWith('demo/')) : rows;
                    const availableModels = tab === 'models' ? rows.filter(item => draft.models?.[item.id]?.enabled !== false) : [];
                    const sectionDescription = {
                        connectors: 'Make data connections and example datasets available to all users.',
                        models: 'Choose shared models, set the default, and control whether users can add their own.',
                        workflows: 'Publish reusable analysis workflows to the gallery for all users.',
                        limits: 'Set limits on table previews, temporary workspace storage, and file downloads.',
                    }[tab];
                    const addAction = tab !== 'limits' && <Button size="small" disabled={busy || testing}
                        variant="outlined"
                        sx={{ minHeight: 78, minWidth: 0, borderStyle: 'dashed', borderRadius: 1,
                            borderColor: 'divider', color: 'text.secondary', '&:hover': { borderStyle: 'dashed', borderColor: 'primary.main', color: 'primary.main' } }}
                        startIcon={<AddIcon sx={{ fontSize: iconVar.md }} />} onClick={() => {
                        setTab(tab); setEditing(undefined); setError('');
                        setWorkflowName(''); setWorkflowContent(newWorkflowTemplate);
                        if (tab === 'connectors' && !connectorType) setConnectorType(saved.loader_types?.[0]?.type || '');
                        setAdding(true);
                    }}>{tab === 'models' ? 'Add model' : tab === 'connectors' ? 'Add data connection' : 'Add workflow'}</Button>;
                    return <Box component="section" key={tab} aria-labelledby={`configuration-${tab}-heading`} aria-describedby={`configuration-${tab}-description`} sx={{ mt: 2, mb: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, pb: 0.75, mb: 1.5, borderBottom: 1, borderColor: theme => alpha(theme.palette.text.primary, 0.24) }}>
                    <Typography id={`configuration-${tab}-heading`} component="h2" sx={{ fontSize: textVar.lg, fontWeight: 600, color: 'text.primary', flex: 1 }}>{tab === 'connectors' ? 'Data Sources' : tab === 'models' ? 'Models' : tab === 'workflows' ? 'Workflows' : 'Limits'}</Typography>
                    </Box>
                    <Box sx={{ pl: { xs: 1, sm: 2 }, minWidth: 0 }}>
                    <Typography id={`configuration-${tab}-description`} variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, lineHeight: 1.5 }}>
                        {sectionDescription}
                    </Typography>
                {tab === 'connectors' && <Box sx={{ mb: 1.5 }}>
                    <Typography component="h3" sx={{ fontSize: textVar.md, fontWeight: 600, mb: 0.75 }}>User connections</Typography>
                    <Box sx={{ pl: 2, '& .MuiCheckbox-root': { p: 0.5 }, '& .MuiFormControlLabel-root': { gap: 1 } }}>
                    <FormControlLabel sx={{ mx: 0, gap: 0.5 }} label="Disable user-created connections" control={<Checkbox size="small"
                        disabled={saved.user_connectors?.locked} checked={saved.user_connectors?.locked ? saved.user_connectors.disabled : draft.disable_user_connectors ?? saved.user_connectors?.disabled ?? false}
                        onChange={(_, checked) => setDraft(previous => ({ ...previous, disable_user_connectors: checked }))} />} />
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        When enabled, users can only use shared connections. New and previously saved personal connections are blocked.
                        {saved.user_connectors?.locked && ' Locked by deployment settings; administrators cannot override this policy.'}
                    </Typography>
                    </Box>
                </Box>}
                {tab === 'connectors' && rows.some(item => item.id === 'sample_datasets') && <Box sx={{ mb: 1.5 }}>
                    <Typography component="h3" sx={{ fontSize: textVar.md, fontWeight: 600, mb: 0.75 }}>Example datasets</Typography>
                    <Box sx={{ pl: 2 }}>
                    <FormControlLabel sx={{ mx: 0, gap: 1 }} label="Show built-in example datasets"
                    control={<Switch size="small" checked={draft.connectors?.sample_datasets?.enabled ?? true}
                        slotProps={{ input: { role: 'switch' } }}
                        onChange={(_, enabled) => update('connectors', 'sample_datasets', { enabled })} />} />
                    </Box>
                </Box>}
                {tab === 'workflows' && demoWorkflows.length > 0 && <Box sx={{ mb: 1.5 }}>
                    <FormControlLabel sx={{ mx: 0, gap: 1, userSelect: 'none' }} label="Show demo workflows"
                        control={<Switch size="small" checked={demoWorkflows.every(item => draft.workflows?.[item.id]?.enabled ?? true)}
                            slotProps={{ input: { role: 'switch' } }}
                            onChange={(_, enabled) => setDraft(previous => ({
                                ...previous,
                                workflows: { ...previous.workflows, ...Object.fromEntries(demoWorkflows.map(item =>
                                    [item.id, { ...previous.workflows?.[item.id], enabled }])) },
                                ...(enabled ? { connectors: { ...previous.connectors,
                                    sample_datasets: { ...previous.connectors?.sample_datasets, enabled: true } } } : {}),
                            }))} />} />
                </Box>}
                {tab === 'models' && <Box sx={{ mb: 1.5 }}>
                    <Typography id="configuration-user-models-label" component="h3" sx={{ fontSize: textVar.md, fontWeight: 600, mb: 0.75 }}>User models</Typography>
                    <Box sx={{ pl: 2, '& .MuiRadio-root': { p: 0.5 }, '& .MuiFormControlLabel-root': { gap: 1 } }}>
                    <RadioGroup row aria-labelledby="configuration-user-models-label" aria-describedby="configuration-user-models-description" value={modelPolicy} sx={{ columnGap: 1.5, rowGap: 0.5 }}
                        onChange={(_, value) => setDraft(previous => {
                            const next = { ...previous };
                            if (!saved.user_models?.locked) next.disable_user_models = value === 'disabled';
                            if (!saved.allowed_api_bases?.locked) {
                                if (value === 'restricted') next.allowed_api_bases = previous.allowed_api_bases || [];
                                else delete next.allowed_api_bases;
                            }
                            return next;
                        })}>
                        <FormControlLabel sx={{ mx: 0, gap: 0.5 }} value="unrestricted" label="No restriction"
                            disabled={(saved.user_models?.locked && modelsDisabled) || (saved.allowed_api_bases?.locked && endpointsRestricted)} control={<Radio size="small" />} />
                        <FormControlLabel sx={{ mx: 0, gap: 0.5 }} value="disabled" label="Disable user-created models"
                            disabled={saved.user_models?.locked} control={<Radio size="small" />} />
                        <FormControlLabel sx={{ mx: 0, gap: 0.5 }} value="restricted" label="Restrict endpoint URLs"
                            disabled={(saved.user_models?.locked && modelsDisabled) || (saved.allowed_api_bases?.locked && !endpointsRestricted)} control={<Radio size="small" />} />
                    </RadioGroup>
                    {modelPolicy !== 'restricted' && <Typography id="configuration-user-models-description" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        {modelPolicy === 'disabled' ? 'Users can only use shared models. They cannot add models or use previously saved personal models.'
                            : 'Users can add their own models and custom endpoint URLs.'}
                        {saved.user_models?.locked && ' Locked by deployment settings; administrators cannot override this policy.'}
                    </Typography>}
                    {modelPolicy === 'restricted' && <>
                    <TextField size="small" sx={{ width: 400, maxWidth: '100%', mt: 1.5 }} multiline minRows={2}
                        label="Allowed endpoint URL patterns" disabled={saved.allowed_api_bases?.locked}
                        value={(saved.allowed_api_bases?.locked ? saved.allowed_api_bases.value || [] : draft.allowed_api_bases || []).join('\n')}
                        onChange={event => setDraft(previous => ({ ...previous, allowed_api_bases: event.target.value.split('\n') }))}
                        slotProps={{ htmlInput: { 'aria-describedby': 'configuration-user-models-description' } }} />
                    <Typography id="configuration-user-models-description" component="p" variant="caption" color="text.secondary" sx={{ mt: 0.75, lineHeight: 1.5 }}>
                        Enter one allowed endpoint URL per line; use * as a wildcard. Leave empty to allow only provider-default endpoints.
                        {saved.allowed_api_bases?.locked && ' Set by the server and cannot be changed here.'}
                    </Typography>
                    </>}
                    </Box>
                </Box>}
                {(tab === 'models' || tab === 'connectors') && <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                    <Typography component="h3" sx={{ fontSize: textVar.md, fontWeight: 600, flex: 1 }}>
                        {tab === 'models' ? 'Shared models' : 'Shared connections'}
                    </Typography>
                </Box>}
                <Box sx={{ pl: tab === 'models' || tab === 'connectors' ? 2 : 0, minWidth: 0 }}>
                {tab === 'models' && <TextField size="small" select sx={{ width: 280, maxWidth: '100%', mb: 0.5 }} label="Default model"
                    disabled={!availableModels.length} value={withDefaultModel(draft, rows).default_model || ''}
                    onChange={event => setDraft(previous => ({ ...previous, default_model: event.target.value }))}>
                    {availableModels.map(item => <MenuItem key={item.id} value={item.id}>
                        {draft.models?.[item.id]?.display_name || item.display_name || item.model || item.id}
                    </MenuItem>)}
                </TextField>}
                <Box sx={{ display: 'grid', gridTemplateColumns: tab === 'models' || tab === 'connectors' ? 'repeat(auto-fill, min(100%, 200px))' : 'repeat(auto-fill, minmax(min(100%, 216px), 1fr))', gap: 1, my: 1 }}>
                {cardRows.map(item => {
                    const section = tab as 'models' | 'connectors' | 'workflows';
                    const options = draft[section]?.[item.id] || {};
                    const name = options.display_name || item.model || item.display_name || item.name;
                    const contentSx = { display: 'flex', flex: 1, minWidth: 0, alignItems: 'flex-start', justifyContent: 'flex-start', gap: 0.75, pl: 1, pr: 7, py: 1 };
                    const content = <>
                        {section === 'connectors' && getConnectorIcon(item.type || item.id, { sx: { fontSize: iconVar.lg, color: 'text.secondary', mt: 0.25 } })}
                        <Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ overflowWrap: 'anywhere', fontWeight: 500 }}>{name}</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, overflowWrap: 'anywhere' }}>{item.endpoint || saved.loader_types?.find(loader => loader.type === item.type)?.name || item.source || 'Environment'}</Typography>
                            {section === 'models' && item.definition?.api_base && <Tooltip title={item.definition.api_base}>
                                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.25 }}>{item.definition.api_base}</Typography>
                            </Tooltip>}
                            {options.description && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{options.description}</Typography>}
                        </Box>
                    </>;
                    return <Card variant="outlined" key={item.id} sx={{ position: 'relative', minWidth: 0, minHeight: 76, borderRadius: 1, display: 'flex', flexDirection: 'column',
                        borderColor: theme => alpha(theme.palette.text.primary, 0.18),
                        boxShadow: theme => `0 1px 3px ${alpha(theme.palette.text.primary, 0.06)}`,
                        '& .configuration-card-actions': { opacity: 0, transition: 'opacity 0.15s' },
                        '&:hover .configuration-card-actions, &:focus-within .configuration-card-actions': { opacity: 1 },
                        '@media (hover: none)': { '& .configuration-card-actions': { opacity: 1 } },
                        '&:hover, &:focus-within': { borderColor: 'primary.light', boxShadow: theme => `0 4px 12px ${alpha(theme.palette.text.primary, 0.12)}` } }}>
                        <CardActionArea disabled={busy || testing} aria-label={`Edit ${name}`} onClick={() => {
                            setTab(section); setEditing(item); setError('');
                            setPropertyName(options.display_name ?? item.display_name ?? item.model ?? '');
                            setPropertyDescription(options.description ?? item.description ?? '');
                            setConnectorType(item.type || '');
                            setWorkflowContent(options.content ?? item.content ?? '');
                            setAdding(true);
                        }} sx={contentSx}>{content}</CardActionArea>
                            <Tooltip title={tab === 'workflows' ? 'Published' : 'Visible'}><Switch size="small" sx={{ position: 'absolute', bottom: 0.5, right: 0.5, transform: 'scale(0.8)', transformOrigin: 'bottom right' }} checked={options.enabled ?? true}
                                slotProps={{ input: { role: 'switch', 'aria-label': `${tab === 'workflows' ? 'Published' : 'Visible'}: ${name}` } }}
                                onChange={(_, enabled) => update(section, item.id, { enabled })} /></Tooltip>
                        <Box className="configuration-card-actions" sx={{ position: 'absolute', top: 2, right: 2, display: 'flex', alignItems: 'center' }}>
                            <Tooltip title="Reset to default"><span><IconButton size="small" sx={{ p: 0.5, color: 'text.secondary' }} aria-label={`Reset ${item.id}`} disabled={!draft[section]?.[item.id]} onClick={() => reset(section, item.id)}><RestartAltIcon sx={{ fontSize: iconVar.md }} /></IconButton></span></Tooltip>
                            {item.id.startsWith('installation-') && <ArtifactDeleteButton label={`Remove ${item.model || item.display_name}`} disabled={busy || testing}
                                onClick={() => setDraft(previous => {
                                    const connectionSection = section as 'models' | 'connectors';
                                    const connections = { ...previous.connections?.[connectionSection] }; delete connections[item.id];
                                    const options = { ...previous[connectionSection] }; delete options[item.id];
                                    return { ...previous, [connectionSection]: options, default_model: previous.default_model === item.id ? '' : previous.default_model,
                                        connections: { ...previous.connections, [connectionSection]: connections } };
                                })} />}
                        </Box>
                    </Card>;
                })}
                {addAction}
                </Box>
                {tab === 'connectors' && !cardRows.length && <Typography variant="body2" color="text.secondary">No configured data sources.</Typography>}
                {tab === 'limits' && Object.entries(saved.limits).map(([name, setting]) => {
                    const divisor = name.endsWith('_bytes') ? 1048576 : 1;
                    const labels: Record<string, string> = { max_display_rows: 'Maximum preview rows', scratch_max_bytes: 'Scratch storage per workspace (MiB)',
                        external_table_max_rows: 'Virtual table threshold (rows)', external_table_max_bytes: 'Virtual table threshold (MiB)',
                        scratch_max_file_bytes: 'Maximum remote-fetch file size (MiB)' };
                    const descriptions: Record<string, string> = {
                        max_display_rows: 'Maximum rows shown in a table preview. Full tables remain on the server.',
                        external_table_max_rows: 'Keep external tables virtual above this row count or the size threshold. Applies to new selections with known sizes.',
                        external_table_max_bytes: 'Keep external tables virtual above this size or the row threshold. Existing workspace copies are unchanged.',
                        scratch_max_bytes: 'Temporary file storage per workspace. When exceeded, least-recently-used files are removed; saved datasets are kept.',
                        scratch_max_file_bytes: 'Maximum size per file downloaded from a URL. 1 MiB = 1,048,576 bytes.',
                    };
                    return <Box key={name} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, py: 1 }}>
                        <Box sx={{ width: 280, maxWidth: '100%' }}>
                            <Typography component="label" htmlFor={`configuration-limit-${name}`} sx={{ display: 'block' }}>{labels[name] || name}</Typography>
                            <Typography id={`configuration-limit-${name}-description`} variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, lineHeight: 1.5 }}>
                                {descriptions[name]}{setting.locked && ' Set by the server and cannot be changed here.'}
                            </Typography>
                        </Box>
                        <TextField id={`configuration-limit-${name}`} size="small" sx={{ width: 120, maxWidth: '100%' }} type="number" disabled={setting.locked}
                            slotProps={{ htmlInput: { 'aria-describedby': `configuration-limit-${name}-description` } }}
                            value={(setting.locked ? setting.value : draft.limits?.[name] ?? setting.default) / divisor}
                            onChange={event => setDraft(previous => ({ ...previous, limits: { ...previous.limits, [name]: Number(event.target.value) * divisor } }))} />
                        <Tooltip title="Reset to default"><span><IconButton size="small" aria-label={`Reset ${name}`} disabled={setting.locked || draft.limits?.[name] === undefined}
                            onClick={() => setDraft(previous => { const limits = { ...previous.limits }; delete limits[name]; return { ...previous, limits }; })}><RestartAltIcon sx={{ fontSize: iconVar.md }} /></IconButton></span></Tooltip>
                    </Box>;
                })}
                </Box>
                </Box>
                </Box>;
                })}
                </Box>
                </Box>
            </>}
            <Box sx={{ display: view === 'form' ? 'flex' : 'none', justifyContent: 'flex-end', gap: 1, px: 2, py: 1, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper', position: 'sticky', bottom: 0, zIndex: 1 }}>
                <Button size="small" disabled={!dirty || busy || testing} onClick={() => { setDraft(saved!.overrides); setStaged([]); setAdding(false); setError(''); }}>Discard</Button>
                <Button size="small" variant="contained" startIcon={<SaveOutlinedIcon sx={{ fontSize: iconVar.md }} />} disabled={!dirty || busy || testing || adding} onClick={save}>Save changes</Button>
            </Box>
        </Box>
    </Box>;
};