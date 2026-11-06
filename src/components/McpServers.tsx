import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
    IconButton, Switch, TextField, Tooltip, Typography, alpha } from '@mui/material';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import BlockIcon from '@mui/icons-material/Block';
import LanguageIcon from '@mui/icons-material/Language';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import GitHubIcon from '@mui/icons-material/GitHub';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import DatasetOutlinedIcon from '@mui/icons-material/DatasetOutlined';
import CandlestickChartOutlinedIcon from '@mui/icons-material/CandlestickChartOutlined';
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
    /** A `secret` setting (an API key) is typed hidden and stored in the credential vault; a `required` one must be filled to add. */
    settings: { key: string; label: string; description?: string; secret?: boolean; required?: boolean }[];
    /** The server it was added as, if it is. */
    server_id: string | null;
    /** Added: each setting as it stands, a plain one's value or whether a key is set (keys never leave the vault). */
    values?: Record<string, { value?: string; set?: boolean }>;
    /** A toolkit that acts with the user's own account (GitHub) offers click-to-sign-in. */
    signin?: PackSignInState;
}

/** A tool a toolkit offers, as it describes it before it is added. */
export interface PackTool { name: string; description: string; read_only: boolean }

export interface PackSignInState {
    provider: string;
    /** A secret setting that is this sign-in's token, pasted instead of signing in (Hugging Face's `hf_token`). */
    token_setting?: string;
    signed_in?: boolean;
    login?: string | null;
    /** The account already signed in elsewhere in Data Formulator (GitHub Copilot models), usable as it is. */
    reusable_login?: string | null;
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
    /** A call of the agent's browser (the same approval path): its approval is per site. */
    kind?: 'browser';
    site?: string;
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

/**
 * A tool's on/off switch, on its card and in its details. Hovering it says what a click does (a halo and
 * "Turn on"/"Turn off"), and its card stays still meanwhile, so toggling never looks like opening the card.
 */
export const ToolSwitch = ({ checked, disabled, label, onChange, color = 'primary' }: {
    checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void;
    /** `warning` for a tool switched on that cannot run yet, e.g. one whose setup check failed. */
    color?: 'primary' | 'warning';
}) => {
    const { t } = useTranslation();
    return <Tooltip title={checked ? t('mcp.turnOff', { defaultValue: 'Turn off' }) : t('mcp.turnOn', { defaultValue: 'Turn on' })}>
        <Box component="span" className="tool-switch" onClick={event => event.stopPropagation()}
            sx={{ display: 'inline-flex', borderRadius: 999, cursor: disabled ? 'default' : 'pointer',
                '&:hover .MuiSwitch-switchBase:not(.Mui-disabled)': {
                    bgcolor: theme => checked ? alpha(theme.palette[color].main, 0.18) : alpha(theme.palette.text.primary, 0.12) },
                '&:hover .MuiSwitch-track': { opacity: checked ? 0.7 : 0.55 } }}>
            <Switch size="small" color={color} checked={checked} disabled={disabled} slotProps={{ input: { 'aria-label': label } }}
                onChange={(_, value) => onChange(value)} />
        </Box>
    </Tooltip>;
};

const ToolFlags = ({ annotations }: { annotations?: McpTool['annotations'] }) => {
    const { t } = useTranslation();
    const flags = [
        annotations?.readOnly && t('mcp.flag.readOnly', { defaultValue: 'Read-only' }),
        annotations?.destructive && t('mcp.flag.destructive', { defaultValue: 'May change or delete data' }),
        annotations?.openWorld && t('mcp.flag.openWorld', { defaultValue: 'Reaches the internet' }),
    ].filter(Boolean) as string[];
    if (!flags.length) return null;
    return <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {flags.map(flag => <Chip key={flag} label={flag} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.75rem' }} />)}
    </Box>;
};

/** A server's state in a few words: connected with how many tools on, signing in, or failed. */
export const StatusLine = ({ server }: { server: McpServer }) => {
    const { t } = useTranslation();
    const enabledTools = (server.tools || []).filter(tool => tool.enabled !== false && !tool.pending).length;
    const [text, color] = server.status === 'connected'
        ? [t('mcp.status.connected', { defaultValue: 'Connected · {{count}} tools', count: enabledTools }), 'success.main']
        : server.status === 'signing_in' ? [t('mcp.status.signingIn', { defaultValue: 'Waiting for sign-in…' }), 'warning.main']
        : server.status === 'error' ? [t('mcp.status.error', { defaultValue: 'Could not connect' }), 'error.main']
        : server.tools?.length ? [t('mcp.status.saved', { defaultValue: '{{count}} tools', count: enabledTools }), 'text.secondary']
        : [t('mcp.status.notConnected', { defaultValue: 'Not connected yet' }), 'text.secondary'];
    return <Typography component="span" variant="caption" sx={{ color }}>{text}</Typography>;
};

/** One section of a tool's page: a heading, then its content. */
/** A tool page's setup: a solid, tinted container, like a card opened to its form. */
export const setupPanelSx = {
    display: 'flex', flexDirection: 'column', gap: 1.25, p: 1.5, border: '1px solid', borderColor: 'primary.main', borderRadius: 1.5,
    bgcolor: (theme: any) => alpha(theme.palette.primary.main, 0.03), boxShadow: '0 2px 10px rgba(32, 33, 36, 0.08)',
    '& .MuiInputBase-root': { bgcolor: 'background.paper' },
} as const;

const PageSection = ({ title, aside, panel, children }: { title: string; aside?: React.ReactNode; panel?: boolean; children: React.ReactNode }) =>
    <Box component="section" aria-label={title} sx={panel ? setupPanelSx : { display: 'flex', flexDirection: 'column', gap: 1, pt: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 28 }}>
            <Typography variant="subtitle2">{title}</Typography>{aside}
        </Box>
        {children}
    </Box>;

/** A setting of an added toolkit: a plain one edits in place; a key shows only whether it is set, to replace or remove. */
const SavedSetting = ({ pack, setting, state, busy, onSave }: {
    pack: ToolPack; setting: ToolPack['settings'][number]; state?: { value?: string; set?: boolean }; busy: boolean;
    onSave: (changes: Record<string, string>) => Promise<boolean>;
}) => {
    const { t } = useTranslation();
    const label = t(`mcp.pack.${pack.id}.${setting.key}`, { defaultValue: setting.label });
    const hint = setting.description ? t(`mcp.pack.${pack.id}.${setting.key}Hint`, { defaultValue: setting.description }) : undefined;
    const saved = state?.value ?? '';
    const [value, setValue] = useState(saved);
    const [editing, setEditing] = useState(false);
    useEffect(() => setValue(saved), [saved]);
    if (!setting.secret) {
        const changed = value.trim() !== saved;
        return <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <TextField size="small" fullWidth required={setting.required} disabled={busy} label={label} value={value}
                onChange={event => setValue(event.target.value)} helperText={hint} FormHelperTextProps={{ sx: { mx: 0 } }} />
            {changed && <Button size="small" variant="contained" disableElevation disabled={busy || (setting.required && !value.trim())}
                onClick={() => void onSave({ [setting.key]: value })} sx={{ mt: 0.5, textTransform: 'none', flexShrink: 0 }}>
                {t('mcp.save', { defaultValue: 'Save' })}</Button>}
        </Box>;
    }
    const save = async (next: string) => { if (await onSave({ [setting.key]: next })) { setEditing(false); setValue(''); } };
    return <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>{label}</Typography>
                {hint && <Typography variant="caption" component="div" color="text.secondary">{hint}</Typography>}
            </Box>
            {state?.set
                ? <Typography component="span" variant="body2" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'success.main', flexShrink: 0 }}>
                    <CheckCircleOutlineIcon sx={{ fontSize: 16 }} />{t('mcp.key.set', { defaultValue: 'Set' })}</Typography>
                : <Typography component="span" variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>{t('mcp.key.notSet', { defaultValue: 'Not set' })}</Typography>}
            {!editing && <Button size="small" disabled={busy} onClick={() => { setValue(''); setEditing(true); }} sx={{ textTransform: 'none', flexShrink: 0 }}>
                {state?.set ? t('mcp.replaceKey', { defaultValue: 'Replace key' }) : t('mcp.key.add', { defaultValue: 'Add key' })}</Button>}
            {!editing && state?.set && <Button size="small" color="inherit" disabled={busy} onClick={() => void save('')}
                sx={{ textTransform: 'none', flexShrink: 0, color: 'text.secondary' }}>{t('mcp.remove', { defaultValue: 'Remove' })}</Button>}
        </Box>
        {editing && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
            <TextField size="small" fullWidth autoFocus type="password" autoComplete="off" disabled={busy} label={label} value={value}
                onChange={event => setValue(event.target.value)} />
            <Button size="small" disabled={busy} onClick={() => setEditing(false)} sx={{ textTransform: 'none' }}>
                {t('mcp.add.cancel', { defaultValue: 'Cancel' })}</Button>
            <Button size="small" variant="contained" disableElevation disabled={busy || !value.trim()} onClick={() => void save(value)}
                sx={{ textTransform: 'none' }}>{t('mcp.save', { defaultValue: 'Save' })}</Button>
        </Box>}
    </Box>;
};

/** Whether a toolkit's required settings are filled in, to add it. */
export const packReady = (pack: ToolPack, draft: Record<string, string>) =>
    !pack.settings.some(setting => setting.required && !(draft[setting.key] ?? '').trim());

/** A sign-in's token pasted instead (e.g. from huggingface.co/settings/tokens): part of the draft before adding, saved after. */
const TokenPaste = ({ pack, setting, added, busy, draft, onDraft, onSave }: {
    pack: ToolPack; setting: ToolPack['settings'][number]; added: boolean; busy: boolean;
    draft: Record<string, string>; onDraft: (draft: Record<string, string>) => void; onSave: (changes: Record<string, string>) => Promise<boolean>;
}) => {
    const { t } = useTranslation();
    const [value, setValue] = useState('');
    const label = t(`mcp.pack.${pack.id}.${setting.key}`, { defaultValue: setting.label });
    const hint = setting.description ? t(`mcp.pack.${pack.id}.${setting.key}Hint`, { defaultValue: setting.description }) : undefined;
    if (!added) return <TextField size="small" fullWidth type="password" autoComplete="off" disabled={busy} label={label} helperText={hint}
        FormHelperTextProps={{ sx: { mx: 0 } }} value={draft[setting.key] ?? ''} onChange={event => onDraft({ ...draft, [setting.key]: event.target.value })} />;
    return <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <TextField size="small" fullWidth type="password" autoComplete="off" disabled={busy} label={label} helperText={hint}
            FormHelperTextProps={{ sx: { mx: 0 } }} value={value} onChange={event => setValue(event.target.value)} />
        <Button size="small" variant="contained" disableElevation disabled={busy || !value.trim()} sx={{ mt: 0.5, textTransform: 'none' }}
            onClick={async () => { if (await onSave({ [setting.key]: value })) setValue(''); }}>{t('mcp.save', { defaultValue: 'Save' })}</Button>
    </Box>;
};

/**
 * A tool's page in the Tools dialog, the same for a toolkit before and after it is added and for a custom server, in
 * three blocks: what it is (name, description, state, on/off); its setup (sign-in, keys and settings, editable any
 * time) ending in Add (not added yet) or Remove; and the tools it offers (a preview before it is added, then each
 * tool's switches).
 */
export const ToolPage = ({ server, pack, previewTools, draft, onDraft, busy, onAdd, onConnect, onChange, onRemove, onSignOut,
    onPackSignedIn, onSavePack, beforePackSignIn }: {
    server?: McpServer;
    pack?: ToolPack;
    /** A toolkit's tools before it is added. */
    previewTools?: PackTool[];
    draft: Record<string, string>;
    onDraft: (draft: Record<string, string>) => void;
    busy: boolean;
    onAdd: () => void;
    onConnect: () => void;
    onChange: (body: Record<string, unknown>) => void;
    onRemove: () => void;
    onSignOut: () => void;
    onPackSignedIn: (signin: PackSignInState) => void;
    onSavePack: (changes: Record<string, string>) => Promise<boolean>;
    /** Signing in to a toolkit not added yet adds it first. */
    beforePackSignIn: () => Promise<boolean>;
}) => {
    const { t } = useTranslation();
    const [secret, setSecret] = useState('');
    const builtIn = t('mcp.pack.builtIn', { defaultValue: 'Data Formulator toolkit' });
    const name = server?.name ?? (pack ? t(`mcp.pack.${pack.id}.name`, { defaultValue: pack.name }) : '');
    const location = pack ? (server ? builtIn : `${builtIn} · ${t('mcp.pack.notAdded', { defaultValue: 'not added yet' })}`)
        : server?.transport === 'stdio' ? [server.command, ...(server.args || [])].join(' ') : server?.url;
    const needsHeader = server?.auth.type === 'header' && !server.secrets.header;
    const tools = server?.tools || [];
    const pending = tools.filter(tool => tool.pending);
    const headerName = server?.auth.header || 'Authorization';
    const tokenSetting = pack?.signin?.token_setting ? pack.settings.find(setting => setting.key === pack.signin!.token_setting) : undefined;
    const toolName = { fontSize: '0.8125rem', fontFamily: 'monospace', fontWeight: 600 } as const;
    const clamp = { color: 'text.secondary', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as const;
    return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {/* 1. What it is */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
            <Box sx={{ display: 'flex', color: 'primary.main', pt: 0.5, '& svg': { fontSize: 22 } }}>{toolkitIcon(pack?.id ?? server?.pack)}</Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</Typography>
                <Typography variant="caption" component="div" sx={{ color: 'text.secondary', overflowWrap: 'anywhere',
                    fontFamily: pack ? undefined : 'monospace' }}>{location}</Typography>
                {pack && <Typography variant="body2" sx={{ mt: 0.75 }}>{t(`mcp.pack.${pack.id}.description`, { defaultValue: pack.description })}</Typography>}
            </Box>
            {server && <ToolSwitch checked={server.enabled} disabled={busy} onChange={enabled => onChange({ enabled })}
                label={t('mcp.serverEnabled', { defaultValue: 'Use {{name}}', name: server.name })} />}
        </Box>
        {/* 2. Setup: sign-in, keys and settings, then Add or Remove */}
        <PageSection panel title={t('mcp.section.setup', { defaultValue: 'Setup' })}>
            {pack?.signin && <PackSignIn pack={pack} onChanged={onPackSignedIn} beforeStart={server ? undefined : beforePackSignIn}
                paste={tokenSetting && <TokenPaste pack={pack} setting={tokenSetting} added={!!server} busy={busy}
                    draft={draft} onDraft={onDraft} onSave={onSavePack} />} />}
            {pack?.settings.filter(setting => setting !== tokenSetting).map(setting => server
                ? <SavedSetting key={setting.key} pack={pack} setting={setting} state={pack.values?.[setting.key]} busy={busy} onSave={onSavePack} />
                : <TextField key={setting.key} size="small" fullWidth disabled={busy} required={setting.required}
                    type={setting.secret ? 'password' : 'text'} autoComplete={setting.secret ? 'off' : undefined}
                    label={t(`mcp.pack.${pack.id}.${setting.key}`, { defaultValue: setting.label })}
                    helperText={setting.description ? t(`mcp.pack.${pack.id}.${setting.key}Hint`, { defaultValue: setting.description }) : undefined}
                    FormHelperTextProps={{ sx: { mx: 0 } }} value={draft[setting.key] ?? ''}
                    onChange={event => onDraft({ ...draft, [setting.key]: event.target.value })} />)}
            {pack && !pack.signin && pack.settings.length === 0 && <Typography variant="body2" color="text.secondary">
                {t('mcp.pack.noSettings', { defaultValue: 'Nothing to set up: add it and it is ready.' })}</Typography>}
            {needsHeader && <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField size="small" fullWidth type="password" value={secret} onChange={event => setSecret(event.target.value)}
                    label={t('mcp.headerValue', { defaultValue: '{{header}} value', header: headerName })} />
                <Button size="small" disabled={busy || !secret} onClick={() => { onChange({ secrets: { header_value: secret } }); setSecret(''); }}>
                    {t('mcp.save', { defaultValue: 'Save' })}
                </Button>
            </Box>}
            {server?.auth.type === 'header' && server.secrets.header && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ flex: 1 }}>{t('mcp.headerValue', { defaultValue: '{{header}} value', header: headerName })}</Typography>
                <Typography component="span" variant="body2" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'success.main' }}>
                    <CheckCircleOutlineIcon sx={{ fontSize: 16 }} />{t('mcp.key.set', { defaultValue: 'Set' })}</Typography>
                <Button size="small" disabled={busy} onClick={() => onChange({ secrets: {}, clear_secrets: ['header_value'] })} sx={{ textTransform: 'none' }}>
                    {t('mcp.replaceKey', { defaultValue: 'Replace key' })}</Button>
            </Box>}
            {server?.auth.type === 'oauth' && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ flex: 1 }}>{server.secrets.signed_in
                    ? t('mcp.signedIn', { defaultValue: 'Signed in' })
                    : t('mcp.signInHint', { defaultValue: 'Sign in to connect (it opens the provider’s page).' })}</Typography>
                {server.secrets.signed_in
                    ? <Button size="small" disabled={busy} onClick={onSignOut} sx={{ textTransform: 'none' }}>{t('mcp.signOut', { defaultValue: 'Sign out' })}</Button>
                    : <Button size="small" variant="outlined" disabled={busy} onClick={onConnect} sx={{ textTransform: 'none' }}>{t('mcp.signIn', { defaultValue: 'Sign in' })}</Button>}
            </Box>}
            {!server && pack && <Typography variant="caption" color="text.secondary">
                {t('mcp.pack.runsLocally', { defaultValue: 'It runs on this computer with Data Formulator; keys are kept in your credential store.' })}</Typography>}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 0.5 }}>
                {server
                    ? <Button size="small" color="error" variant="outlined" disabled={busy} onClick={onRemove} startIcon={<DeleteOutlineIcon />} sx={{ textTransform: 'none' }}>
                        {t('mcp.removeNamed', { defaultValue: 'Remove {{name}}', name: server.name })}</Button>
                    : pack && <Button variant="contained" disableElevation disabled={busy || !packReady(pack, draft)} onClick={onAdd} sx={{ textTransform: 'none' }}>
                        {t('tools.addToolkit', { defaultValue: 'Add toolkit' })}</Button>}
            </Box>
        </PageSection>
        {/* 3. The tools it offers */}
        <PageSection title={t('mcp.toolList', { defaultValue: 'Tools' })}
            aside={server ? <>
                <StatusLine server={server} />
                <Box sx={{ flex: 1 }} />
                <Button size="small" disabled={busy || needsHeader} onClick={onConnect} sx={{ textTransform: 'none', py: 0 }}>
                    {server.status === 'connected' ? t('mcp.refresh', { defaultValue: 'Refresh' }) : t('mcp.connect', { defaultValue: 'Connect' })}
                </Button>
            </> : <Typography variant="caption" color="text.secondary">
                {t('mcp.pack.toolsPreview', { defaultValue: 'Each can be turned on or off once it is added.' })}</Typography>}>
            {server?.status === 'error' && server.error && <Alert severity="error" sx={{ py: 0,
                whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 160, overflow: 'auto' }}>{server.error}</Alert>}
            {server?.changed && <Alert severity="warning" sx={{ py: 0 }}
                action={<Button color="inherit" size="small" disabled={busy} onClick={() => onChange({ approve_changes: true })}>
                    {t('mcp.approveChanges', { defaultValue: 'Allow' })}</Button>}>
                {t('mcp.toolsChanged', { defaultValue: 'New or changed tools are held until you allow them: {{names}}',
                    names: pending.map(tool => tool.name).join(', ') })}
            </Alert>}
            {!server && (previewTools ?? []).map(tool => <Box key={tool.name}>
                <Typography sx={toolName}>{tool.name}</Typography>
                <Typography variant="caption" component="div" sx={clamp} title={tool.description}>{tool.description}</Typography>
                {tool.read_only && <ToolFlags annotations={{ readOnly: true }} />}
            </Box>)}
            {server && tools.length === 0 && <Typography variant="body2" color="text.secondary">
                {t('mcp.noTools', { defaultValue: 'Connect to list the server’s tools.' })}
            </Typography>}
            {tools.map(tool => <Box key={tool.name} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                <Checkbox size="small" checked={tool.enabled !== false} disabled={busy} sx={{ p: 0.25 }}
                    slotProps={{ input: { 'aria-label': t('mcp.toolEnabled', { defaultValue: 'Use {{name}}', name: tool.name }) } }}
                    onChange={(_, checked) => onChange({ tools: [{ name: tool.name, enabled: checked }] })} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ ...toolName, color: tool.pending ? 'warning.main' : 'text.primary' }}>{tool.name}</Typography>
                    {tool.description && <Typography variant="caption" component="div" sx={clamp} title={tool.description}>{tool.description}</Typography>}
                    <ToolFlags annotations={tool.annotations} />
                </Box>
                {/* Set by "Always allow this tool" when the agent asked; removing it makes the tool ask again. */}
                {tool.always_allow && <Tooltip describeChild title={t('mcp.alwaysAllowedHint', { defaultValue: 'You chose "Always allow this tool" when the agent asked. Remove to be asked again.' })}>
                    <Chip size="small" variant="outlined" disabled={busy} label={t('mcp.alwaysAllowed', { defaultValue: 'Runs without asking' })}
                        onDelete={() => onChange({ tools: [{ name: tool.name, always_allow: false }] })}
                        sx={{ flexShrink: 0, height: 22, fontSize: '0.75rem', color: 'text.secondary' }} />
                </Tooltip>}
            </Box>)}
        </PageSection>
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

/** How to write the configuration, with examples: a quiet section under a blank editor. */
const AddServerHelp = () => {
    const { t } = useTranslation();
    const [selected, setSelected] = useState<typeof HELP_EXAMPLES[number]['key']>('remote');
    const example = HELP_EXAMPLES.find(item => item.key === selected)!;
    return <Box role="region" aria-label={t('mcp.help.toggle', { defaultValue: 'How to add a server' })}
        sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.5, mt: 0.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
            <InfoOutlinedIcon sx={{ fontSize: 18, color: 'primary.main', mt: '1px', flexShrink: 0 }} />
            <span>
                <Box component="span" sx={{ fontWeight: 600, mr: 0.75 }}>{t('mcp.help.toggle', { defaultValue: 'How to add a server' })}</Box>
                {t('mcp.help.intro', { defaultValue: 'Paste one server’s MCP configuration from its docs, like the examples below.' })}
            </span>
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }} role="tablist">
            {HELP_EXAMPLES.map(item => {
                const active = item.key === selected;
                return <Box key={item.key} component="button" type="button" role="tab" aria-selected={active} onClick={() => setSelected(item.key)}
                    sx={{ px: 1, py: 0.375, border: '1px solid', borderRadius: 1, cursor: 'pointer', font: 'inherit', fontSize: '0.8125rem',
                        lineHeight: 1.4, outline: 'none', color: active ? 'text.primary' : 'text.secondary',
                        bgcolor: active ? 'action.selected' : 'transparent', borderColor: active ? 'divider' : 'transparent',
                        '&:hover': { color: 'text.primary', bgcolor: active ? 'action.selected' : 'action.hover' },
                        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 } }}>
                    {t(`mcp.help.${item.key}.title`, { defaultValue: item.title })}
                </Box>;
            })}
        </Box>
        <Box component="pre" sx={{ m: 0, px: 1.25, py: 1, borderRadius: 1, bgcolor: 'action.hover',
            fontFamily: 'monospace', fontSize: '0.8125rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{example.config}</Box>
        <Typography variant="caption" color="text.secondary">
            {t(`mcp.help.${example.key}.note`, { defaultValue: example.note })}
        </Typography>
    </Box>;
};

/**
 * Click-to-sign-in for a toolkit that acts with the user's own account (GitHub): a short code to enter on GitHub,
 * polled until approved; or, already signed in to GitHub for models, that account in one click. Read-only, public data.
 */
const SIGNIN_TEXT: Record<string, Record<string, string>> = {
    github: {
        prompt: 'Sign in with GitHub to search code and use your own rate limits. Read-only: public repositories only.',
        signedInAs: 'Signed in to GitHub as @{{login}} · reads public repositories only',
        start: 'Sign in with GitHub', enterCode: 'Enter this code on GitHub, then approve. This waits for you.',
        open: 'Copy code and open GitHub', failed: 'GitHub sign-in did not finish. Try again.',
    },
    huggingface: {
        prompt: 'Sign in with Hugging Face to open gated datasets you have accepted and use your own rate limits. Read-only.',
        signedInAs: 'Signed in to Hugging Face as @{{login}} · reads public and accepted gated datasets',
        start: 'Sign in with Hugging Face', enterCode: 'Enter this code on Hugging Face, then approve. This waits for you.',
        open: 'Copy code and open Hugging Face', failed: 'Hugging Face sign-in did not finish. Try again.',
    },
};

export const PackSignIn = ({ pack, onChanged, beforeStart, paste }: {
    pack: ToolPack; onChanged: (signin: PackSignInState) => void;
    /** Run first, e.g. to add the toolkit; signing in goes on only if it returns true. */
    beforeStart?: () => Promise<boolean>;
    /** Pasting a token instead, offered while signed out. */
    paste?: React.ReactNode;
}) => {
    const { t: translate } = useTranslation();
    const [pasting, setPasting] = useState(false);
    const provider = pack.signin?.provider ?? 'github';
    // GitHub's text has the original keys; another provider's is under its name.
    const t = (key: string, options: Record<string, unknown> = {}) => {
        const own = SIGNIN_TEXT[provider]?.[key.replace('mcp.signin.', '')];
        return own === undefined ? translate(key, options)
            : translate(provider === 'github' ? key : key.replace('mcp.signin.', `mcp.signin.${provider}.`), { ...options, defaultValue: own });
    };
    const [flow, setFlow] = useState<{ id: string; code: string; url: string; interval: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [working, setWorking] = useState(false);
    const signin = pack.signin!;
    const base = `/api/mcp/packs/${pack.id}`;
    const post = async <T,>(path: string, body: Record<string, unknown> = {}) =>
        (await apiRequest<T>(base + path, { method: 'POST', headers: CONFIG_HEADERS, body: JSON.stringify(body) })).data;
    const act = async (step: () => Promise<void>) => {
        setWorking(true);
        setError(null);
        try { await step(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } finally { setWorking(false); }
    };
    useEffect(() => {
        if (!flow) return;
        let stopped = false;
        const timer = setInterval(async () => {
            try {
                const result = await post<PackSignInState & { flow: { status: string } }>('/signin/poll', { flow_id: flow.id });
                if (stopped) return;
                if (result.flow.status === 'connected') { setFlow(null); onChanged({ ...signin, ...result }); }
                else if (result.flow.status !== 'pending') { setFlow(null); setError(t('mcp.signin.failed', { defaultValue: 'GitHub sign-in did not finish. Try again.' })); }
            } catch (failure) {
                if (!stopped) { setFlow(null); setError(failure instanceof Error ? failure.message : String(failure)); }
            }
        }, Math.max(5, flow.interval) * 1000);
        return () => { stopped = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flow?.id]);
    const start = () => act(async () => {
        if (beforeStart && !await beforeStart()) return;
        const started = await post<{ flow_id: string; user_code: string; authorization_url: string; interval: number }>('/signin/start');
        setFlow({ id: started.flow_id, code: started.user_code, url: started.authorization_url, interval: started.interval });
    });
    const cancel = () => { if (flow) void post('/signin/cancel', { flow_id: flow.id }).catch(() => undefined); setFlow(null); };
    const caption = { fontSize: '0.875rem', color: 'text.primary' } as const;
    return <Box data-pack-signin sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {signin.signed_in
            ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ ...caption, flex: 1 }}>
                    {t('mcp.signin.signedInAs', { defaultValue: 'Signed in to GitHub as @{{login}} · reads public repositories only', login: signin.login || '?' })}
                </Typography>
                <Button size="small" disabled={working} onClick={() => act(async () => onChanged({ ...signin, ...await post<PackSignInState>('/signout') }))}
                    sx={{ textTransform: 'none' }}>{t('mcp.signin.signOut', { defaultValue: 'Sign out' })}</Button>
            </Box>
            : !flow && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography sx={{ ...caption, flex: '1 1 200px' }}>
                    {t('mcp.signin.prompt', { defaultValue: 'Sign in with GitHub to search code and use your own rate limits. Read-only: public repositories only.' })}
                </Typography>
                {signin.reusable_login && <Button size="small" variant="outlined" disabled={working} sx={{ textTransform: 'none' }}
                    onClick={() => act(async () => {
                        if (beforeStart && !await beforeStart()) return;
                        onChanged({ ...signin, ...await post<PackSignInState>('/signin/reuse') });
                    })}>
                    {t('mcp.signin.reuse', { defaultValue: 'Use @{{login}}', login: signin.reusable_login })}
                </Button>}
                <Button size="small" variant={signin.reusable_login ? 'text' : 'outlined'} disabled={working} onClick={() => void start()}
                    sx={{ textTransform: 'none' }}>{t('mcp.signin.start', { defaultValue: 'Sign in with GitHub' })}</Button>
            </Box>}
        {!signin.signed_in && !flow && paste && (pasting ? paste
            : <Box><Button size="small" onClick={() => setPasting(true)} sx={{ textTransform: 'none', px: 0.5, minWidth: 0, color: 'text.secondary' }}>
                {translate('mcp.signin.paste', { defaultValue: 'Or paste a token' })}</Button></Box>)}
        {flow && <Alert severity="info" role="status" sx={{ py: 0.25, '& .MuiAlert-message': { minWidth: 0 } }}
            action={<Button size="small" color="inherit" onClick={cancel} sx={{ textTransform: 'none' }}>{t('mcp.signin.cancel', { defaultValue: 'Cancel' })}</Button>}>
            <Typography variant="body2">
                {t('mcp.signin.enterCode', { defaultValue: 'Enter this code on GitHub, then approve. This waits for you.' })}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
                <Typography component="code" aria-label={t('mcp.signin.code', { defaultValue: 'Sign-in code' })}
                    sx={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '1rem', userSelect: 'all' }}>{flow.code}</Typography>
                <Button size="small" component="a" href={flow.url} target="_blank" rel="noopener noreferrer" sx={{ textTransform: 'none' }}
                    onClick={() => void navigator.clipboard?.writeText(flow.code).catch(() => undefined)}>
                    {t('mcp.signin.open', { defaultValue: 'Copy code and open GitHub' })}
                </Button>
            </Box>
        </Alert>}
        {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}
    </Box>;
};

/** A tool's icon: its toolkit's, or the generic MCP one for a custom server. */
export const toolkitIcon = (packId?: string) => packId === 'github' ? <GitHubIcon />
    : packId === 'research' ? <SchoolOutlinedIcon /> : packId === 'huggingface' ? <DatasetOutlinedIcon />
    : packId === 'finance' ? <CandlestickChartOutlinedIcon /> : <ExtensionOutlinedIcon />;

/** Add one server from its MCP configuration JSON, the format VS Code, Claude and Cursor use; `text` makes it controlled. */
export const AddServerForm = ({ busy, onSubmit, onCancel, initial, text: controlled, onTextChange }: {
    busy: boolean;
    onSubmit?: (config: string) => Promise<boolean>;
    onCancel?: () => void;
    /** Prefilled configuration (an agent proposal). */
    initial?: string;
    text?: string;
    onTextChange?: (text: string) => void;
}) => {
    const { t } = useTranslation();
    const [own, setOwn] = useState(initial ?? '');
    const text = controlled ?? own;
    const setText = onTextChange ?? setOwn;
    const { valid, count, empty, local } = inspectConfig(text);
    const submit = async () => { if (onSubmit && await onSubmit(text) && !initial) setText(''); };
    const problem = count > 1 ? t('mcp.add.oneServer', { defaultValue: 'Add one server at a time.' })
        : empty.length ? t('mcp.add.fillIn', { defaultValue: 'Fill in {{names}}.', names: empty.join(', ') }) : '';
    return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <TextField size="small" fullWidth multiline minRows={5} maxRows={18} disabled={busy} value={text} onChange={event => setText(event.target.value)}
            label={t('mcp.add.configLabel', { defaultValue: 'MCP server configuration (JSON)' })} placeholder={EXAMPLE_CONFIG}
            InputLabelProps={{ shrink: true }} sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.8125rem' } }}
            helperText={problem || undefined} FormHelperTextProps={{ sx: { mx: 0, color: 'warning.main' } }} />
        {local && <Alert severity="warning" sx={{ py: 0 }}>
            {t('mcp.add.localWarning', { defaultValue: 'A local server runs as you, outside any sandbox, with access to your files and network. Add only servers you trust.' })}
        </Alert>}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            {onCancel && <Button size="small" disabled={busy} onClick={onCancel}>{t('mcp.add.cancel', { defaultValue: 'Cancel' })}</Button>}
            <Button variant="contained" size="small" disableElevation disabled={busy || !valid || empty.length > 0} onClick={() => void submit()}>
                {t('mcp.add.addButton', { defaultValue: 'Add and connect' })}
            </Button>
        </Box>
        {/* How to write one, with examples, for a blank form; an agent's proposal comes filled in. */}
        {!initial && <AddServerHelp />}
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
        if (result) {
            apply(result);
            // A removed toolkit is one to add again.
            if (server.pack) {
                setPacks(current => current?.map(pack => pack.id === server.pack ? { ...pack, server_id: null, values: undefined } : pack));
                void loadPacks();
            }
        }
        return !!result;
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
        void loadPacks();
        return server;
    };
    /** Change an added toolkit's settings (keys go to the vault; an empty key removes it). Its server restarts. */
    const savePackSettings = async (packId: string, settings: Record<string, string>) => {
        const pack = await run(async () => (await apiRequest<ToolPack>(`/api/mcp/packs/${packId}/settings`,
            { method: 'PUT', headers: CONFIG_HEADERS, body: JSON.stringify({ settings }) })).data);
        if (pack) setPacks(current => current?.map(item => item.id === packId ? pack : item));
        return !!pack;
    };
    /** The tools a toolkit offers, to show before it is added (read from its code, once). */
    const [packTools, setPackTools] = useState<Record<string, PackTool[]>>({});
    const loadPackTools = async (packId: string) => {
        if (packTools[packId]) return;
        try {
            const tools = (await apiRequest<{ tools: PackTool[] }>(`/api/mcp/packs/${packId}/tools`)).data.tools;
            setPackTools(current => ({ ...current, [packId]: tools }));
        } catch { /* the page shows the tools once added */ }
    };
    /** A toolkit's sign-in changed (its server restarts with or without the account). */
    const packSignedIn = (packId: string, signin: PackSignInState) =>
        setPacks(current => current?.map(pack => pack.id === packId ? { ...pack, signin } : pack));
    return { snapshot, busy, error, setError, notice, setNotice, load, connect, change, remove, signOut, importConfig, setMode,
        packs, loadPacks, addPack, packSignedIn, savePackSettings, packTools, loadPackTools };
};

export type McpDecision = 'approve' | 'always' | 'reject';

/** The agent's browser asks before it opens, reads or scripts a site the user has not allowed. */
const BrowserApprovalDialog = ({ proposal, decide }: { proposal: McpProposal; decide: (decision: McpDecision) => void }) => {
    const { t } = useTranslation();
    const site = proposal.site || '';
    const script = typeof proposal.arguments.script === 'string' ? proposal.arguments.script : '';
    return <Dialog open maxWidth="sm" fullWidth aria-labelledby="browser-approval-title" onClose={() => decide('reject')}>
        <DialogTitle id="browser-approval-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: textVar.lg, overflowWrap: 'anywhere' }}>
            <LanguageIcon sx={{ flexShrink: 0 }} />
            {t('browser.approvalTitle', { defaultValue: 'Let the agent use {{site}} in your browser?', site })}
        </DialogTitle>
        <DialogContent sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {proposal.purpose && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{proposal.purpose}</Typography>}
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                <Box component="span" sx={{ fontWeight: 600 }}>{proposal.title}</Box>
                {typeof proposal.arguments.url === 'string' && <Box component="span" sx={{ color: 'text.secondary' }}> · {proposal.arguments.url}</Box>}
            </Typography>
            {script && <ExecutionCodeBlock code={script} language="javascript"
                label={t('browser.scriptLabel', { defaultValue: 'Script run in the page' })}
                copyLabel={t('browser.copyScript', { defaultValue: 'Copy script' })} />}
            <Typography variant="caption" color="text.secondary">
                {proposal.description} {t('browser.approvalNote', { defaultValue: 'What the agent reads there goes to your model provider.' })}
            </Typography>
        </DialogContent>
        <DialogActions disableSpacing sx={{ flexWrap: 'wrap', gap: 1, p: 2 }}>
            <Button autoFocus startIcon={<BlockIcon />} onClick={() => decide('reject')}>{t('mcp.reject', { defaultValue: 'Reject' })}</Button>
            <Box sx={{ flex: 1 }} />
            <Button onClick={() => decide('always')}>{t('browser.allowAlways', { defaultValue: 'Always allow {{site}}', site })}</Button>
            <Button variant="contained" onClick={() => decide('approve')}>{t('browser.allowChat', { defaultValue: 'Allow in this chat' })}</Button>
        </DialogActions>
    </Dialog>;
};

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
    if (proposal.kind === 'browser') return <BrowserApprovalDialog proposal={proposal} decide={decide} />;
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
