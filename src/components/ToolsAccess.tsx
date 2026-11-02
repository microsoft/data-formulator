// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The composer's Tools chip and dialog: one approval mode the agent's tools share, then each tool with its
 * own switch. The terminal is built in; MCP servers are tools the user adds from their configuration JSON.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Checkbox, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton,
    LinearProgress, Radio, RadioGroup, Switch, TextField, Tooltip, Typography } from '@mui/material';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import TerminalIcon from '@mui/icons-material/Terminal';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import BoltIcon from '@mui/icons-material/Bolt';
import BlockIcon from '@mui/icons-material/Block';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { dfActions, type DataFormulatorState } from '../app/dfSlice';
import { iconVar, textVar } from '../app/layout';
import { loadToolsPolicy, onToolsDialogRequest, saveToolsPolicy, toolsConfig, type ToolsChange, type ToolsMode, type ToolsPolicy } from '../app/toolsSettings';
import { AddServerForm, ServerRow, ToolPackCard, useMcpSettings } from './McpServers';
import { mcpFormDone, McpProposalPanel, useMcpProposal } from './McpProposal';
import { TerminalFilesystemSummary } from './TerminalApprovalDialog';

const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

/** The terminal's row: its switch, and (expanded) what it can do and its sandbox write paths. */
const TerminalRow = ({ policy, busy, onChange }: {
    policy: ToolsPolicy; busy: boolean; onChange: (change: ToolsChange) => Promise<boolean>;
}) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const filesystem = policy.sandboxFilesystem;
    const [useDefaultPaths, setUseDefaultPaths] = useState(!filesystem?.configured);
    const [writePaths, setWritePaths] = useState(filesystem?.requested.join('\n') ?? '');
    useEffect(() => {
        setUseDefaultPaths(!filesystem?.configured);
        setWritePaths(filesystem?.requested.join('\n') ?? '');
    }, [filesystem]);
    const paths = writePaths.split('\n').map(path => path.trim()).filter(Boolean);
    const pathsChanged = !!filesystem && (useDefaultPaths !== !filesystem.configured
        || (!useDefaultPaths && JSON.stringify(paths) !== JSON.stringify(filesystem.requested)));
    const status = !policy.enabled ? t('tools.terminal.off', { defaultValue: 'Off' })
        : policy.sandboxed === false ? t('tools.terminal.unsandboxed', { defaultValue: 'No sandbox installed' })
        : t('tools.terminal.sandboxed', { defaultValue: 'Sandboxed' });
    return <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.75 }}>
            <IconButton size="small" aria-expanded={open} aria-label={t('tools.terminal.details', { defaultValue: 'Terminal details' })}
                onClick={() => setOpen(value => !value)} sx={{ p: 0.25 }}>
                <ChevronRightIcon sx={{ fontSize: 18, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
            </IconButton>
            <TerminalIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                    <Typography sx={{ fontSize: textVar.sm, fontWeight: 600 }}>{t('tools.terminal.name', { defaultValue: 'Terminal' })}</Typography>
                    <Typography component="span" sx={{ fontSize: textVar.xs,
                        color: policy.enabled && policy.sandboxed === false ? 'warning.main' : 'text.secondary' }}>{status}</Typography>
                </Box>
                <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
                    {t('tools.terminal.caption', { defaultValue: 'Run commands on this computer with your CLI logins' })}
                </Typography>
            </Box>
            <Switch size="small" checked={policy.enabled} disabled={busy}
                slotProps={{ input: { 'aria-label': t('tools.terminal.use', { defaultValue: 'Use the terminal' }) } }}
                onChange={(_, checked) => void onChange({ enabled: checked })} />
        </Box>
        {policy.enabled && policy.sandboxed === false && <Alert severity="warning" sx={{ mx: 1, mb: 1, py: 0, fontSize: textVar.xs, overflowWrap: 'anywhere' }}>
            {t('terminal.noSandboxInstalled', { defaultValue: 'No sandbox is installed on this computer, so commands run with your normal access. Each command asks for your approval, even with Auto approve.' })}
            {policy.sandboxInstallHint && <Box component="span" sx={{ display: 'block', mt: 0.5 }}>{policy.sandboxInstallHint}</Box>}
        </Alert>}
        <Collapse in={open} unmountOnExit>
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: 1.5, py: 1, display: 'flex', flexDirection: 'column', gap: 1,
                fontSize: textVar.sm }}>
                <Typography variant="body2" color="text.secondary">
                    {t('terminal.accessBenefit', { defaultValue: 'Terminal access lets the agent read local files, use installed tools and existing CLI logins, and access online sources, expanding its ability to find, acquire, and analyze data.' })}
                    {' '}
                    {t('terminal.sandboxOverview', { defaultValue: 'By default, commands run in a sandbox that limits local writes but does not restrict file reads, network access, or remote changes.' })}
                </Typography>
                {filesystem && <TerminalFilesystemSummary policy={filesystem} inline>
                    <FormControlLabel sx={{ my: 0.5, '& .MuiFormControlLabel-label': { fontSize: textVar.sm } }}
                        control={<Checkbox size="small" checked={useDefaultPaths} disabled={busy}
                            onChange={(_, checked) => setUseDefaultPaths(checked)} />}
                        label={t('terminal.useDefaultWritePaths', { defaultValue: 'Use default CLI state paths' })} />
                    {useDefaultPaths ? filesystem.configured
                        ? <Typography variant="inherit" color="text.secondary">
                            {t('terminal.restoreDefaultWritePaths', { defaultValue: 'Default CLI state paths will be restored on save.' })}
                        </Typography>
                        : <Box component="pre" sx={{ my: 0.5, fontFamily: 'var(--df-font-mono)', fontSize: 'inherit',
                            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{filesystem.requested.join('\n')}</Box>
                        : <TextField fullWidth multiline minRows={3} maxRows={8} size="small" value={writePaths} disabled={busy}
                            onChange={event => setWritePaths(event.target.value)}
                            label={t('terminal.writablePaths', { defaultValue: 'Writable paths (one per line)' })}
                            helperText={t('terminal.writablePathsHint', { defaultValue: 'Absolute or ~/ paths. Empty keeps only scratch and runtime writes. Missing or unsafe paths are not enabled.' })}
                            sx={{ mt: 1, '& textarea': { fontFamily: 'var(--df-font-mono)', fontSize: textVar.sm } }} />}
                    {pathsChanged && <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                        <Button size="small" variant="contained" disableElevation disabled={busy}
                            onClick={() => void onChange({ sandbox: useDefaultPaths ? null : { filesystem: { allowWrite: paths } } })}>
                            {t('terminal.saveAccess', { defaultValue: 'Save' })}
                        </Button>
                    </Box>}
                </TerminalFilesystemSummary>}
            </Box>
        </Collapse>
    </Box>;
};

/** The composer's Tools chip: the shared approval mode, the terminal, and the user's MCP servers. */
export const ToolsAccessButton = () => {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const reduxStore = useStore<DataFormulatorState>();
    const config = useSelector((state: DataFormulatorState) => state.serverConfig);
    const [open, setOpen] = useState(false);
    const [adding, setAdding] = useState(false);
    // What adding offers first: ready-made toolkits, or a custom server's JSON.
    const [addKind, setAddKind] = useState<'packs' | 'custom'>('packs');
    const [policy, setPolicy] = useState<ToolsPolicy>();
    const [saving, setSaving] = useState(false);
    const [policyError, setPolicyError] = useState('');
    const mcp = useMcpSettings(open && !!config.MCP_AVAILABLE);
    // An agent's MCP proposal under review (its text turn), shown at the top of the dialog.
    const [proposalTurnId, setProposalTurnId] = useState<string>();
    const proposal = useMcpProposal(proposalTurnId);

    const applyPolicy = (next: ToolsPolicy) => {
        setPolicy(next);
        dispatch(dfActions.setServerConfig({ ...reduxStore.getState().serverConfig, ...toolsConfig(next) }));
    };
    const loadPolicy = async () => {
        setSaving(true); setPolicyError('');
        try { applyPolicy(await loadToolsPolicy()); }
        catch (reason) { setPolicyError(errorText(reason)); }
        finally { setSaving(false); }
    };
    const change = async (next: ToolsChange) => {
        setSaving(true); setPolicyError('');
        try { applyPolicy(await saveToolsPolicy(next)); return true; }
        catch (reason) { setPolicyError(errorText(reason)); return false; }
        finally { setSaving(false); }
    };
    const show = (turnId?: string) => {
        setOpen(true); setAdding(false); mcp.setNotice(''); setProposalTurnId(turnId);
        void loadPolicy();
        if (config.MCP_AVAILABLE) { void mcp.load(); void mcp.loadPacks(); }
    };
    useEffect(() => onToolsDialogRequest(turnId => show(turnId)), [config.MCP_AVAILABLE]);
    // A reviewed proposal closes the dialog once its new servers are connected; one still signing in or
    // failing stays in view so the user sees why.
    const proposalAdded = proposal?.form.mcp.add.map(item => item.addedId).filter(Boolean) ?? [];
    const proposalSettled = !!proposal && mcpFormDone(proposal.form.mcp) && proposalAdded.every(id =>
        mcp.snapshot?.servers.find(server => server.id === id)?.status === 'connected');
    useEffect(() => {
        if (open && proposalSettled) { setOpen(false); setProposalTurnId(undefined); }
    }, [open, proposalSettled]);

    // A demo's analyst has no tools (design-docs/69).
    if (!config.TOOLS_MODE || config.SITE) return null;
    const busy = saving || mcp.busy;
    const mode: ToolsMode = policy?.mode ?? config.TOOLS_MODE;
    const available = policy ? policy.available || !!config.MCP_AVAILABLE : true;
    const servers = mcp.snapshot?.servers ?? [];
    // Tools that are on: the terminal (when it can run here) and the MCP servers switched on.
    const toolCount = (config.TERMINAL_AVAILABLE && (policy?.enabled ?? config.TERMINAL_ENABLED ?? true) ? 1 : 0)
        + (config.MCP_AVAILABLE ? (mcp.snapshot ? servers.filter(server => server.enabled).length : config.MCP_SERVERS_ON ?? 0) : 0);
    const error = policyError || mcp.error;
    const modes: [ToolsMode, string][] = [['off', 'Off'], ['ask', 'Ask every time'], ['auto', 'Auto when safe']];
    return <>
        <Tooltip describeChild title={t('tools.chipDetails', { defaultValue: 'Tools the agent can use: the terminal and MCP servers' })}>
            <Button size="small" aria-haspopup="dialog" onClick={() => show()}
                aria-label={t('tools.chipLabel', { defaultValue: 'Tools: {{count}} on, {{mode}}', count: toolCount,
                    mode: t(`tools.mode.${mode}`, { defaultValue: { off: 'Off', ask: 'Ask every time', auto: 'Auto when safe' }[mode] }) })}
                sx={{ minWidth: 0, px: 0.75, py: 0.25, flexShrink: 0, textTransform: 'none', fontWeight: 400 }}>
                <ToolsChipFace count={toolCount} mode={mode} />
            </Button>
        </Tooltip>
        <Dialog open={open} onClose={() => { if (!busy) setOpen(false); }} maxWidth="sm" fullWidth aria-labelledby="tools-title">
            <DialogTitle id="tools-title" sx={{ fontSize: textVar.lg }}>{t('tools.title', { defaultValue: 'Tools' })}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ height: 2, flexShrink: 0 }}>{busy && <LinearProgress sx={{ height: 2 }} />}</Box>
                <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary' }}>
                    {t('tools.intro', { defaultValue: 'Tools let the agent reach beyond your workspace: run commands on this computer, or call MCP servers for data and documents.' })}
                </Typography>
                {error && <Alert severity="error" onClose={() => { setPolicyError(''); mcp.setError(''); }}
                    sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{error}</Alert>}
                {mcp.notice && <Alert severity="info" onClose={() => mcp.setNotice('')} sx={{ whiteSpace: 'pre-wrap' }}>{mcp.notice}</Alert>}
                {!available && <Alert severity="info">{config.IS_LOCAL_MODE && config.DISABLE_DATA_CONNECTORS
                    ? t('tools.blocked', { defaultValue: 'The deployment policy turns off user connections and tools.' })
                    : t('tools.localOnly', { defaultValue: 'Tools are available in the single-user local app.' })}</Alert>}
                {available && <>
                    {proposalTurnId && config.MCP_AVAILABLE && <McpProposalPanel turnId={proposalTurnId} settings={mcp}
                        onDismiss={() => setProposalTurnId(undefined)} />}
                    <Box>
                        <RadioGroup row value={mode} aria-label={t('tools.modeLabel', { defaultValue: 'Approval' })}
                            onChange={(_, value) => void change({ mode: value as ToolsMode })}>
                            {modes.map(([value, label]) => <FormControlLabel key={value} value={value} control={<Radio size="small" />}
                                disabled={busy || !policy || policy.locked} label={t(`tools.mode.${value}`, { defaultValue: label })}
                                sx={{ '& .MuiFormControlLabel-label': { fontSize: textVar.sm } }} />)}
                        </RadioGroup>
                        <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
                            {policy?.locked ? t('tools.locked', { defaultValue: 'Set by the server environment variable DF_TERMINAL_MODE.' })
                                : mode === 'auto' ? t('tools.modeHint.auto', { defaultValue: 'Sandboxed commands and read-only MCP tools run without asking; everything else asks first.' })
                                : mode === 'ask' ? t('tools.modeHint.ask', { defaultValue: 'Every command and tool call asks first, except tools you always allow.' })
                                : t('tools.modeHint.off', { defaultValue: 'The agent uses no tools.' })}
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, opacity: mode === 'off' ? 0.6 : 1 }}>
                        {policy?.available && <TerminalRow policy={policy} busy={busy} onChange={change} />}
                        {servers.map(server => <ServerRow key={server.id} server={server} busy={busy}
                            onConnect={() => void mcp.connect(server)} onChange={body => void mcp.change(server, body)}
                            onRemove={() => void mcp.remove(server)} onSignOut={() => void mcp.signOut(server)} />)}
                    </Box>
                    {config.MCP_AVAILABLE && mcp.snapshot && !(proposal && !mcpFormDone(proposal.form.mcp)) && (adding
                        ? <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                            <Box role="tablist" aria-label={t('tools.add.label', { defaultValue: 'Add' })} sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
                                <Box component="span" aria-hidden sx={{ fontSize: textVar.xs, color: 'text.secondary', mr: -0.5 }}>
                                    {t('tools.add.label', { defaultValue: 'Add' })}:</Box>
                                {([['packs', t('tools.add.packs', { defaultValue: 'Data Formulator toolkits' })], ['custom', t('tools.add.custom', { defaultValue: 'Custom MCP server' })]] as const)
                                    .map(([kind, label]) => <Box key={kind} component="button" type="button" role="tab" aria-selected={addKind === kind}
                                        onClick={() => setAddKind(kind)}
                                        sx={{ p: 0, pb: 0.25, border: 0, background: 'none', cursor: 'pointer', font: 'inherit', fontSize: textVar.xs,
                                            color: addKind === kind ? 'text.primary' : 'text.secondary', borderBottom: '1px solid',
                                            borderColor: addKind === kind ? 'primary.main' : 'transparent', '&:hover': { color: 'text.primary' } }}>
                                        {label}</Box>)}
                                <Box sx={{ flex: 1 }} />
                                <Tooltip title={t('tools.add.collapse', { defaultValue: 'Collapse' })}>
                                    <IconButton size="small" onClick={() => setAdding(false)} aria-label={t('tools.add.collapse', { defaultValue: 'Collapse' })}
                                        sx={{ p: 0.25, alignSelf: 'center', color: 'text.secondary' }}>
                                        <ExpandLessIcon sx={{ fontSize: 18 }} />
                                    </IconButton>
                                </Tooltip>
                            </Box>
                            {addKind === 'packs'
                                ? <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    {(mcp.packs ?? []).map(pack => <ToolPackCard key={pack.id} pack={pack} busy={busy}
                                        onAdd={async settings => { if (await mcp.addPack(pack.id, settings)) setAdding(false); }} />)}
                                </Box>
                                : <AddServerForm busy={busy} onSubmit={async text => {
                                    const added = await mcp.importConfig(text);
                                    if (added.length) setAdding(false);
                                    return added.length > 0;
                                }} />}
                        </Box>
                        : <Box><Button size="small" onClick={() => { setAdding(true); setAddKind((mcp.packs ?? []).some(pack => !pack.server_id) ? 'packs' : 'custom'); }}
                            disabled={busy} sx={{ textTransform: 'none' }}>
                            {t('tools.addTool', { defaultValue: '+ Add tool' })}</Button></Box>)}
                </>}
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setOpen(false)} disabled={busy}>{t('tools.close', { defaultValue: 'Close' })}</Button>
            </DialogActions>
        </Dialog>
    </>;
};

/**
 * The Tools chip's face: the plugin icon with a corner badge for the shared mode (⊘ when off, a pencil for
 * ask, a bolt for auto) and how many tools are on. Grey when off, blue otherwise.
 */
export const ToolsChipFace = ({ count, mode }: { count: number; mode: ToolsMode }) => {
    const { t } = useTranslation();
    const off = mode === 'off' || count === 0;
    const label = t('tools.count', { count, defaultValue_one: '{{count}} tool', defaultValue_other: '{{count}} tools' });
    return <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: textVar.xs, whiteSpace: 'nowrap',
        lineHeight: 1, color: off ? 'text.disabled' : 'primary.main' }}>
        <Box component="span" sx={{ position: 'relative', display: 'inline-flex' }}>
            <ExtensionOutlinedIcon sx={{ fontSize: iconVar.md }} />
            <Box component="span" aria-hidden sx={{ position: 'absolute', right: -4, bottom: -3, width: 11, height: 11, borderRadius: '50%',
                bgcolor: 'background.paper', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {off ? <BlockIcon sx={{ fontSize: 9 }} />
                    : mode === 'auto' ? <BoltIcon sx={{ fontSize: 10 }} /> : <EditIcon sx={{ fontSize: 8 }} />}
            </Box>
        </Box>
        {label}
    </Box>;
};
