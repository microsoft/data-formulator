import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
    FormControlLabel, IconButton, Switch, TextField, Tooltip, Typography, alpha } from '@mui/material';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import BlockIcon from '@mui/icons-material/Block';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { useTranslation } from 'react-i18next';
import { useDispatch, useStore } from 'react-redux';
import { dfActions, type DataFormulatorState } from '../app/dfSlice';
import { apiRequest } from '../app/apiClient';
import type { McpServerProposal, ToolCall } from './ComponentType';
import { textVar } from '../app/layout';
import { saveToolsPolicy, toolsConfig } from '../app/toolsSettings';
import { ExecutionCodeBlock } from './TerminalApprovalDialog';

export type McpMode = 'off' | 'ask' | 'auto';

interface McpTool {
    name: string;
    title?: string | null;
    description?: string;
    annotations?: { readOnly?: boolean; destructive?: boolean; idempotent?: boolean; openWorld?: boolean };
    enabled?: boolean;
    always_allow?: boolean;
    pending?: boolean;
}

export interface McpServer {
    id: string;
    name: string;
    transport: 'http' | 'sse' | 'stdio';
    url?: string;
    command?: string;
    args?: string[];
    enabled: boolean;
    auth: { type: 'none' | 'header' | 'oauth'; header?: string; client_id?: string; scope?: string };
    tools?: McpTool[];
    status?: 'connected' | 'signing_in' | 'error' | null;
    error?: string | null;
    changed?: boolean;
    secrets: { header: boolean; env: string[]; client_secret: boolean; signed_in: boolean };
    /** The tool pack this server was added from (see tool_packs). */
    pack?: string;
}

interface McpSnapshot { available: boolean; mode: McpMode; servers: McpServer[] }

/** A ready-made toolkit Data Formulator ships (see py-src/data_formulator/tool_packs). */
export interface ToolPack {
    id: string;
    name: string;
    description: string;
    examples: string[];
    settings: { key: string; label: string; description?: string }[];
    /** The server it was added as, if it is. */
    server_id: string | null;
}

/** A tool call waiting for the user's approval (see mcp_servers/skill.py). */
export interface McpProposal {
    id: string;
    server_id: string;
    server_name: string;
    tool: string;
    title: string;
    description: string;
    annotations: McpTool['annotations'];
    arguments: Record<string, unknown>;
    purpose: string;
}

/** The tool name MCP calls are recorded under on a message. */
export const MCP_CALL_TOOL = 'mcp_call';

export const mcpCallArgs = (proposal: McpProposal) => ({ server: proposal.server_name, tool: proposal.tool,
    arguments: proposal.arguments, ...(proposal.purpose ? { purpose: proposal.purpose } : {}) });

/** What a call returned, as the message records it: the preview and where larger output was saved. */
export const mcpCallRecord = (proposal: McpProposal, status: ToolCall['status'], outcome?: Record<string, any>): ToolCall => {
    const files = Array.isArray(outcome?.files) ? outcome!.files.map((file: any) => file?.path).filter(Boolean) as string[] : [];
    const output = [outcome?.preview, files.length ? `Saved: ${files.join(', ')}` : ''].filter(Boolean).join('\n\n');
    return { id: proposal.id, tool: MCP_CALL_TOOL, createdAt: Date.now(), status, args: mcpCallArgs(proposal),
        ...(output ? { output } : {}),
        ...(outcome?.error ? { error: String(outcome.error) } : outcome?.rejected ? { error: 'Rejected' } : {}) };
};

const CONFIG_HEADERS = { 'Content-Type': 'application/json', 'X-DF-Configuration': '1' };

const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

const ToolFlags = ({ annotations }: { annotations?: McpTool['annotations'] }) => {
    const { t } = useTranslation();
    const flags = [
        annotations?.readOnly && t('mcp.flag.readOnly', { defaultValue: 'Read-only' }),
        annotations?.destructive && t('mcp.flag.destructive', { defaultValue: 'May change or delete data' }),
        annotations?.openWorld && t('mcp.flag.openWorld', { defaultValue: 'Reaches the internet' }),
    ].filter(Boolean) as string[];
    if (!flags.length) return null;
    return <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {flags.map(flag => <Chip key={flag} label={flag} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.6875rem' }} />)}
    </Box>;
};

const StatusLine = ({ server }: { server: McpServer }) => {
    const { t } = useTranslation();
    const enabledTools = (server.tools || []).filter(tool => tool.enabled !== false && !tool.pending).length;
    const [text, color] = server.status === 'connected'
        ? [t('mcp.status.connected', { defaultValue: 'Connected · {{count}} tools', count: enabledTools }), 'success.main']
        : server.status === 'signing_in' ? [t('mcp.status.signingIn', { defaultValue: 'Waiting for sign-in…' }), 'warning.main']
        : server.status === 'error' ? [t('mcp.status.error', { defaultValue: 'Could not connect' }), 'error.main']
        : server.tools?.length ? [t('mcp.status.saved', { defaultValue: '{{count}} tools', count: enabledTools }), 'text.secondary']
        : [t('mcp.status.notConnected', { defaultValue: 'Not connected yet' }), 'text.secondary'];
    return <Typography component="span" sx={{ fontSize: textVar.xs, color }}>{text}</Typography>;
};

export const ServerRow = ({ server, busy, onConnect, onChange, onRemove, onSignOut }: {
    server: McpServer; busy: boolean;
    onConnect: () => void;
    onChange: (body: Record<string, unknown>) => void;
    onRemove: () => void;
    onSignOut: () => void;
}) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [secret, setSecret] = useState('');
    const location = server.pack ? t('mcp.pack.builtIn', { defaultValue: 'Data Formulator toolkit' })
        : server.transport === 'stdio' ? [server.command, ...(server.args || [])].join(' ') : server.url;
    const needsHeader = server.auth.type === 'header' && !server.secrets.header;
    const pending = (server.tools || []).filter(tool => tool.pending);
    return <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.75 }}>
            <IconButton size="small" aria-expanded={open} aria-label={t('mcp.showTools', { defaultValue: 'Show tools' })}
                onClick={() => setOpen(value => !value)} sx={{ p: 0.25 }}>
                <ChevronRightIcon sx={{ fontSize: 18, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
            </IconButton>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: textVar.sm, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {server.name}
                    </Typography>
                    <StatusLine server={server} />
                </Box>
                <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary', fontFamily: 'monospace',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={location}>{location}</Typography>
            </Box>
            <Button size="small" disabled={busy || needsHeader} onClick={onConnect} sx={{ textTransform: 'none', flexShrink: 0 }}>
                {server.auth.type === 'oauth' && !server.secrets.signed_in
                    ? t('mcp.signIn', { defaultValue: 'Sign in' })
                    : server.status === 'connected' ? t('mcp.refresh', { defaultValue: 'Refresh' }) : t('mcp.connect', { defaultValue: 'Connect' })}
            </Button>
            <Tooltip title={t('mcp.remove', { defaultValue: 'Remove' })}>
                <span><IconButton size="small" disabled={busy} onClick={onRemove}
                    aria-label={t('mcp.removeNamed', { defaultValue: 'Remove {{name}}', name: server.name })}
                    sx={{ p: 0.5, color: 'text.secondary', '&:hover': { color: 'error.main' } }}>
                    <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                </IconButton></span>
            </Tooltip>
            <Tooltip title={server.enabled ? t('mcp.turnOff', { defaultValue: 'Turn off' }) : t('mcp.turnOn', { defaultValue: 'Turn on' })}>
                <Switch size="small" checked={server.enabled} disabled={busy}
                    slotProps={{ input: { 'aria-label': t('mcp.serverEnabled', { defaultValue: 'Use {{name}}', name: server.name }) } }}
                    onChange={(_, checked) => onChange({ enabled: checked })} />
            </Tooltip>
        </Box>
        {server.status === 'error' && server.error && <Alert severity="error" sx={{ mx: 1, mb: 1, py: 0, fontSize: textVar.xs,
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 160, overflow: 'auto' }}>{server.error}</Alert>}
        {needsHeader && <Box sx={{ display: 'flex', gap: 1, px: 1, pb: 1 }}>
            <TextField size="small" fullWidth type="password" value={secret} onChange={event => setSecret(event.target.value)}
                label={t('mcp.headerValue', { defaultValue: '{{header}} value', header: server.auth.header || 'Authorization' })} />
            <Button size="small" disabled={busy || !secret} onClick={() => { onChange({ secrets: { header_value: secret } }); setSecret(''); }}>
                {t('mcp.save', { defaultValue: 'Save' })}
            </Button>
        </Box>}
        {server.changed && <Alert severity="warning" sx={{ mx: 1, mb: 1, py: 0, fontSize: textVar.xs }}
            action={<Button color="inherit" size="small" disabled={busy} onClick={() => onChange({ approve_changes: true })}>
                {t('mcp.approveChanges', { defaultValue: 'Allow' })}</Button>}>
            {t('mcp.toolsChanged', { defaultValue: 'New or changed tools are held until you allow them: {{names}}',
                names: pending.map(tool => tool.name).join(', ') })}
        </Alert>}
        <Collapse in={open} unmountOnExit>
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: 1, py: 0.75, display: 'flex', flexDirection: 'column', gap: 0.5,
                maxHeight: 320, overflowY: 'auto' }}>
                {(server.tools || []).length === 0 && <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
                    {t('mcp.noTools', { defaultValue: 'Connect to list the server’s tools.' })}
                </Typography>}
                {(server.tools || []).map(tool => <Box key={tool.name} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                    <Checkbox size="small" checked={tool.enabled !== false} disabled={busy} sx={{ p: 0.25 }}
                        slotProps={{ input: { 'aria-label': t('mcp.toolEnabled', { defaultValue: 'Use {{name}}', name: tool.name }) } }}
                        onChange={(_, checked) => onChange({ tools: [{ name: tool.name, enabled: checked }] })} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: textVar.xs, fontFamily: 'monospace', fontWeight: 600,
                            color: tool.pending ? 'warning.main' : 'text.primary' }}>{tool.name}</Typography>
                        {tool.description && <Typography sx={{ fontSize: '0.6875rem', color: 'text.secondary', display: '-webkit-box',
                            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={tool.description}>{tool.description}</Typography>}
                        <ToolFlags annotations={tool.annotations} />
                    </Box>
                    <FormControlLabel sx={{ mr: 0, flexShrink: 0, '& .MuiFormControlLabel-label': { fontSize: '0.6875rem', color: 'text.secondary' } }}
                        control={<Checkbox size="small" sx={{ p: 0.25 }} checked={!!tool.always_allow} disabled={busy || tool.enabled === false || tool.pending}
                            onChange={(_, checked) => onChange({ tools: [{ name: tool.name, always_allow: checked }] })} />}
                        label={t('mcp.alwaysAllow', { defaultValue: 'Always allow' })} />
                </Box>)}
                {((server.auth.type === 'oauth' && server.secrets.signed_in) || (server.auth.type === 'header' && server.secrets.header)) &&
                <Box sx={{ display: 'flex', gap: 1, pt: 0.5 }}>
                    {server.auth.type === 'oauth' && server.secrets.signed_in && <Button size="small" disabled={busy} onClick={onSignOut}
                        sx={{ textTransform: 'none' }}>{t('mcp.signOut', { defaultValue: 'Sign out' })}</Button>}
                    {server.auth.type === 'header' && server.secrets.header && <Button size="small" disabled={busy}
                        onClick={() => onChange({ secrets: {}, clear_secrets: ['header_value'] })} sx={{ textTransform: 'none' }}>
                        {t('mcp.replaceKey', { defaultValue: 'Replace key' })}</Button>}
                </Box>}
            </Box>
        </Collapse>
    </Box>;
};

const EXAMPLE_CONFIG = `{
  "mcpServers": {
    "docs": { "url": "https://example.com/mcp" }
  }
}`;

/** The JSON an agent proposal starts from: secret values are left as "" for the user to fill in. */
export const proposalConfig = (proposal: McpServerProposal): string => {
    const entry: Record<string, unknown> = proposal.transport === 'stdio'
        ? { command: proposal.command, ...(proposal.args?.length ? { args: proposal.args } : {}), ...(proposal.cwd ? { cwd: proposal.cwd } : {}),
            ...(proposal.envNames?.length ? { env: Object.fromEntries(proposal.envNames.map(name => [name, ''])) } : {}) }
        : { ...(proposal.transport === 'sse' ? { type: 'sse' } : {}), url: proposal.url,
            ...(proposal.auth?.type === 'header' ? { headers: { [proposal.auth.header || 'Authorization']: '' } } : {}),
            ...(proposal.auth?.type === 'oauth' && (proposal.auth.client_id || proposal.auth.scope)
                ? { oauth: { ...(proposal.auth.client_id ? { client_id: proposal.auth.client_id } : {}), ...(proposal.auth.scope ? { scope: proposal.auth.scope } : {}) } } : {}) };
    return JSON.stringify({ mcpServers: { [proposal.name]: entry } }, null, 2);
};

/** What the pasted configuration still needs: whether it parses, empty secret values, and whether it runs local commands. */
const inspectConfig = (text: string): { valid: boolean; count: number; empty: string[]; local: boolean } => {
    let document: any;
    try { document = JSON.parse(text); } catch { return { valid: false, count: 0, empty: [], local: /"command"\s*:/.test(text) }; }
    const servers = document?.mcpServers ?? document?.servers ?? document?.mcp?.servers ?? document;
    const entries = servers && typeof servers === 'object' ? Object.values(servers).filter(entry => entry && typeof entry === 'object') as any[] : [];
    const empty = entries.flatMap(entry => [entry.headers, entry.env].flatMap(values => values && typeof values === 'object'
        ? Object.entries(values).filter(([, value]) => value === '' || /YOUR_KEY/.test(String(value))).map(([key]) => key) : []));
    return { valid: entries.length === 1, count: entries.length, empty, local: entries.some(entry => 'command' in entry) };
};

const HELP_EXAMPLES: { key: 'remote' | 'key' | 'local'; title: string; note: string; config: string }[] = [
    { key: 'remote', title: 'Remote server', note: 'Servers that need sign-in open the provider’s page when you connect.',
        config: '{\n  "mcpServers": {\n    "docs": { "url": "https://example.com/mcp" }\n  }\n}' },
    { key: 'key', title: 'With an API key', note: 'Replace YOUR_KEY with your key. It is kept in your credential store, not in a file.',
        config: '{\n  "mcpServers": {\n    "weather": {\n      "url": "https://example.com/mcp",\n      "headers": { "Authorization": "Bearer YOUR_KEY" }\n    }\n  }\n}' },
    { key: 'local', title: 'Local command', note: 'Runs on this computer, outside the sandbox. Add only servers you trust.',
        config: '{\n  "mcpServers": {\n    "files": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/folder"]\n    }\n  }\n}' },
];

/** How to write the configuration, with examples: a callout under the editor. */
const AddServerHelp = () => {
    const { t } = useTranslation();
    const [selected, setSelected] = useState<typeof HELP_EXAMPLES[number]['key']>('remote');
    const example = HELP_EXAMPLES.find(item => item.key === selected)!;
    return <Box role="region" aria-label={t('mcp.help.toggle', { defaultValue: 'How to add a server' })}
        sx={{ bgcolor: theme => alpha(theme.palette.info.main, 0.06), borderLeft: '3px solid', borderColor: 'info.main',
            borderRadius: '0 6px 6px 0', px: 1.5, py: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
            {t('mcp.help.intro', { defaultValue: 'Paste one server’s MCP configuration from its docs, like the examples below.' })}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }} role="tablist">
            {HELP_EXAMPLES.map(item => {
                const active = item.key === selected;
                return <Box key={item.key} component="button" type="button" role="tab" aria-selected={active} onClick={() => setSelected(item.key)}
                    sx={{ p: 0, pb: 0.25, border: 0, background: 'none', cursor: 'pointer', font: 'inherit', fontSize: textVar.xs,
                        color: active ? 'text.primary' : 'text.secondary', borderBottom: '1px solid',
                        borderColor: active ? 'info.main' : 'transparent', '&:hover': { color: 'text.primary' } }}>
                    {t(`mcp.help.${item.key}.title`, { defaultValue: item.title })}
                </Box>;
            })}
        </Box>
        <Box component="pre" sx={{ m: 0, p: 1, borderRadius: 1, bgcolor: 'background.paper',
            fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{example.config}</Box>
        <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
            {t(`mcp.help.${example.key}.note`, { defaultValue: example.note })}
        </Typography>
    </Box>;
};

/** A toolkit to add in one step: what it does, its optional settings, and Add. */
export const ToolPackCard = ({ pack, busy, onAdd }: {
    pack: ToolPack;
    busy: boolean;
    onAdd: (settings: Record<string, string>) => Promise<unknown>;
}) => {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<Record<string, string>>({});
    const added = !!pack.server_id;
    return <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: textVar.sm, fontWeight: 600 }}>{t(`mcp.pack.${pack.id}.name`, { defaultValue: pack.name })}</Typography>
                <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
                    {t(`mcp.pack.${pack.id}.description`, { defaultValue: pack.description })}</Typography>
            </Box>
            <Button size="small" variant={added ? 'text' : 'contained'} disableElevation disabled={busy || added}
                onClick={() => void onAdd(settings)} sx={{ flexShrink: 0, textTransform: 'none' }}>
                {added ? t('mcp.pack.added', { defaultValue: 'Added' }) : t('mcp.pack.add', { defaultValue: 'Add' })}
            </Button>
        </Box>
        {!added && pack.settings.map(setting => <TextField key={setting.key} size="small" fullWidth disabled={busy}
            label={t(`mcp.pack.${pack.id}.${setting.key}`, { defaultValue: setting.label })}
            helperText={setting.description ? t(`mcp.pack.${pack.id}.${setting.key}Hint`, { defaultValue: setting.description }) : undefined}
            FormHelperTextProps={{ sx: { mx: 0 } }}
            value={settings[setting.key] ?? ''} onChange={event => setSettings(current => ({ ...current, [setting.key]: event.target.value }))} />)}
    </Box>;
};

/** Add one server from its MCP configuration JSON, the format VS Code, Claude and Cursor use. */
export const AddServerForm = ({ busy, onSubmit, onCancel, initial }: {
    busy: boolean;
    onSubmit: (config: string) => Promise<boolean>;
    onCancel?: () => void;
    /** Prefilled configuration (an agent proposal). */
    initial?: string;
}) => {
    const { t } = useTranslation();
    const [text, setText] = useState(initial ?? '');
    const [helpOpen, setHelpOpen] = useState(false);
    const { valid, count, empty, local } = inspectConfig(text);
    const submit = async () => { if (await onSubmit(text) && !initial) setText(''); };
    const problem = count > 1 ? t('mcp.add.oneServer', { defaultValue: 'Add one server at a time.' })
        : empty.length ? t('mcp.add.fillIn', { defaultValue: 'Fill in {{names}}.', names: empty.join(', ') }) : '';
    return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <TextField size="small" fullWidth multiline minRows={5} maxRows={18} disabled={busy} value={text} onChange={event => setText(event.target.value)}
            label={t('mcp.add.configLabel', { defaultValue: 'MCP server configuration (JSON)' })} placeholder={EXAMPLE_CONFIG}
            InputLabelProps={{ shrink: true }} sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.8125rem' } }}
            helperText={problem || undefined} FormHelperTextProps={{ sx: { mx: 0, color: 'warning.main' } }} />
        {local && <Alert severity="warning" sx={{ py: 0, fontSize: textVar.xs }}>
            {t('mcp.add.localWarning', { defaultValue: 'A local server runs as you, outside any sandbox, with access to your files and network. Add only servers you trust.' })}
        </Alert>}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button size="small" aria-expanded={helpOpen} onClick={() => setHelpOpen(value => !value)}
                startIcon={<HelpOutlineIcon sx={{ fontSize: '16px !important' }} />}
                endIcon={<ChevronRightIcon sx={{ fontSize: '16px !important', transform: helpOpen ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />}
                sx={{ textTransform: 'none', fontWeight: 400, fontSize: textVar.xs, color: 'text.secondary', px: 0.5, minWidth: 0,
                    '& .MuiButton-startIcon': { mr: 0.5 }, '& .MuiButton-endIcon': { ml: 0.25 } }}>
                {t('mcp.help.toggle', { defaultValue: 'How to add a server' })}
            </Button>
            <Box sx={{ flex: 1 }} />
            {onCancel && <Button size="small" disabled={busy} onClick={onCancel}>{t('mcp.add.cancel', { defaultValue: 'Cancel' })}</Button>}
            <Button variant="contained" size="small" disableElevation disabled={busy || !valid || empty.length > 0} onClick={() => void submit()}>
                {t('mcp.add.addButton', { defaultValue: 'Add and connect' })}
            </Button>
        </Box>
        <Collapse in={helpOpen} unmountOnExit><AddServerHelp /></Collapse>
    </Box>;
};

/** MCP settings state and calls, shared by the Tools dialog and the agent's MCP setup form. */
export const useMcpSettings = (active: boolean) => {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const reduxStore = useStore<DataFormulatorState>();
    const [snapshot, setSnapshot] = useState<McpSnapshot>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    // The Tools chip counts the servers that are on; keep that in step with every change.
    const countOn = (servers: McpServer[]) => dispatch(dfActions.setServerConfig({ ...reduxStore.getState().serverConfig,
        MCP_SERVERS_ON: servers.filter(server => server.enabled).length }));
    const apply = (next: McpSnapshot) => { setSnapshot(next); countOn(next.servers); };
    const updateServer = (server: McpServer) => setSnapshot(current => {
        if (!current) return current;
        const next = { ...current, servers: current.servers.map(item => item.id === server.id ? server : item) };
        countOn(next.servers);
        return next;
    });
    const load = async (quiet = false) => {
        if (!quiet) { setBusy(true); setError(''); }
        try { apply((await apiRequest<McpSnapshot>('/api/mcp')).data); }
        catch (reason) { if (!quiet) setError(errorText(reason)); }
        finally { if (!quiet) setBusy(false); }
    };
    const run = async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
        setBusy(true); setError(''); setNotice('');
        try { return await work(); }
        catch (reason) { setError(errorText(reason)); return undefined; }
        finally { setBusy(false); }
    };

    // Sign-in finishes in a popup; its page tells us when it is done.
    useEffect(() => {
        if (!active) return;
        const onMessage = (event: MessageEvent) => {
            if (event.origin === window.location.origin && event.data?.type === 'df-mcp-oauth') void load(true);
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [active]);
    const signingIn = snapshot?.servers.some(server => server.status === 'signing_in');
    useEffect(() => {
        if (!active || !signingIn) return;
        const timer = setInterval(() => void load(true), 2500);
        return () => clearInterval(timer);
    }, [active, signingIn]);

    const connect = async (server: McpServer) => {
        // Opened now, while the click still counts as the user's: browsers block popups opened later.
        const popup = server.auth.type === 'oauth' ? window.open('', 'df-mcp-oauth', 'width=560,height=720') : null;
        const result = await run(async () => (await apiRequest<{ status: string; url?: string; server: McpServer }>(
            `/api/mcp/servers/${server.id}/connect`, { method: 'POST', headers: CONFIG_HEADERS, body: '{}' })).data);
        if (result?.server) updateServer(result.server);
        if (result?.status === 'authorize' && result.url) {
            if (popup && !popup.closed) popup.location.href = result.url;
            else window.open(result.url, '_blank', 'noopener');
        } else popup?.close();
    };
    const change = async (server: McpServer, body: Record<string, unknown>) => {
        const result = await run(async () => (await apiRequest<McpServer>(`/api/mcp/servers/${server.id}`,
            { method: 'PUT', headers: CONFIG_HEADERS, body: JSON.stringify(body) })).data);
        if (result) updateServer(result);
        return result;
    };
    const remove = async (server: McpServer) => {
        const result = await run(async () => (await apiRequest<McpSnapshot>(`/api/mcp/servers/${server.id}`,
            { method: 'DELETE', headers: CONFIG_HEADERS })).data);
        if (result) apply(result);
    };
    const signOut = async (server: McpServer) => {
        const result = await run(async () => (await apiRequest<McpServer>(`/api/mcp/servers/${server.id}/sign-out`,
            { method: 'POST', headers: CONFIG_HEADERS, body: '{}' })).data);
        if (result) updateServer(result);
    };
    /** Add the servers in MCP configuration JSON, then connect each. Returns the added servers. */
    const importConfig = async (text: string) => {
        const result = await run(async () => (await apiRequest<McpSnapshot & { added: { id: string; name: string; notes: string[] }[];
            skipped: { name: string; reason: string }[] }>('/api/mcp/import',
            { method: 'POST', headers: CONFIG_HEADERS, body: JSON.stringify({ config: text }) })).data);
        if (!result) return [];
        apply(result);
        const notes = [
            ...result.added.filter(item => item.notes.length).map(item => `${item.name}: ${item.notes.join('; ')}`),
            ...result.skipped.map(item => `${item.name}: ${item.reason}`),
        ];
        if (!result.added.length) { setError(notes.join('\n') || t('mcp.add.nothingAdded', { defaultValue: 'No servers were added.' })); return []; }
        const added = result.servers.filter(server => result.added.some(item => item.id === server.id));
        if (notes.length) setNotice(notes.join('\n'));
        // Connecting (or signing in) continues in the server's row; the add form can close now.
        void (async () => { for (const server of added) if (server.auth.type !== 'header' || server.secrets.header) await connect(server); })();
        return added;
    };
    /** Set the approval mode the agent's tools share (the terminal's too). */
    const setMode = async (mode: McpMode) => {
        const policy = await run(() => saveToolsPolicy({ mode }));
        if (policy) {
            dispatch(dfActions.setServerConfig({ ...reduxStore.getState().serverConfig, ...toolsConfig(policy) }));
            setSnapshot(current => current && { ...current, mode: policy.mode });
        }
        return policy;
    };
    const [packs, setPacks] = useState<ToolPack[]>();
    const loadPacks = async () => {
        try { setPacks((await apiRequest<{ packs: ToolPack[] }>('/api/mcp/packs')).data.packs); }
        catch { setPacks([]); }
    };
    /** Add a tool pack's server, then connect it. Returns the server. */
    const addPack = async (packId: string, settings: Record<string, string>) => {
        const server = await run(async () => (await apiRequest<McpServer>(`/api/mcp/packs/${packId}`,
            { method: 'POST', headers: CONFIG_HEADERS, body: JSON.stringify({ settings }) })).data);
        if (!server) return undefined;
        setSnapshot(current => {
            if (!current) return current;
            const servers = current.servers.some(item => item.id === server.id) ? current.servers : [...current.servers, server];
            countOn(servers);
            return { ...current, servers };
        });
        setPacks(current => current?.map(pack => pack.id === packId ? { ...pack, server_id: server.id } : pack));
        void connect(server);
        return server;
    };
    return { snapshot, busy, error, setError, notice, setNotice, load, connect, change, remove, signOut, importConfig, setMode,
        packs, loadPacks, addPack };
};

export type McpDecision = 'approve' | 'always' | 'reject';

export const McpApprovalDialog = ({ proposal, onDecision }: {
    proposal: McpProposal;
    onDecision: (decision: McpDecision) => void;
}) => {
    const { t } = useTranslation();
    const submitted = useRef(false);
    const decide = (decision: McpDecision) => {
        if (submitted.current) return;
        submitted.current = true;
        onDecision(decision);
    };
    return <Dialog open maxWidth="sm" fullWidth aria-labelledby="mcp-approval-title" onClose={() => decide('reject')}>
        <DialogTitle id="mcp-approval-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: textVar.lg, overflowWrap: 'anywhere' }}>
            <ExtensionOutlinedIcon sx={{ flexShrink: 0 }} />
            {t('mcp.approvalTitle', { defaultValue: 'Allow {{tool}} from {{server}}?', tool: proposal.title || proposal.tool, server: proposal.server_name })}
        </DialogTitle>
        <DialogContent sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {proposal.purpose && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{proposal.purpose}</Typography>}
            <Box>
                <Typography variant="caption" color="text.secondary">
                    {t('mcp.toolLabel', { defaultValue: 'Tool' })} · <Box component="span" sx={{ fontFamily: 'monospace' }}>{proposal.tool}</Box>
                </Typography>
                {proposal.description && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere',
                    maxHeight: 96, overflowY: 'auto', fontSize: textVar.xs }}>{proposal.description}</Typography>}
                <Box sx={{ mt: 0.75 }}><ToolFlags annotations={proposal.annotations} /></Box>
            </Box>
            <ExecutionCodeBlock code={JSON.stringify(proposal.arguments, null, 2)} language="json"
                label={t('mcp.argumentsLabel', { defaultValue: 'Arguments sent to the server' })}
                copyLabel={t('mcp.copyArguments', { defaultValue: 'Copy arguments' })} />
            <Typography variant="caption" color="text.secondary">
                {t('mcp.approvalNote', { defaultValue: 'The server receives these arguments; what it returns goes to your model provider.' })}
            </Typography>
        </DialogContent>
        <DialogActions disableSpacing sx={{ flexWrap: 'wrap', gap: 1, p: 2 }}>
            <Button autoFocus startIcon={<BlockIcon />} onClick={() => decide('reject')}>{t('mcp.reject', { defaultValue: 'Reject' })}</Button>
            <Box sx={{ flex: 1 }} />
            <Button onClick={() => decide('always')}>{t('mcp.allowAlways', { defaultValue: 'Always allow this tool' })}</Button>
            <Button variant="contained" onClick={() => decide('approve')}>{t('mcp.runOnce', { defaultValue: 'Run once' })}</Button>
        </DialogActions>
    </Dialog>;
};
