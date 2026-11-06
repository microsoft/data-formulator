// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The composer's Tools chip and dialog: one approval mode the agent's tools share, then a card for each tool
 * (like the session cards) with its switch, and a dashed card to add one. A card opens the tool's details in the
 * dialog. The terminal is built in; MCP servers are Data Formulator toolkits or servers the user adds from their
 * configuration JSON.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton,
    LinearProgress, Radio, RadioGroup, TextField, Tooltip, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import TerminalIcon from '@mui/icons-material/Terminal';
import LanguageIcon from '@mui/icons-material/Language';
import BoltIcon from '@mui/icons-material/Bolt';
import BlockIcon from '@mui/icons-material/Block';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { dfActions, type DataFormulatorState } from '../app/dfSlice';
import { iconVar, textVar } from '../app/layout';
import { loadToolsPolicy, onToolsDialogRequest, saveToolsPolicy, toolsConfig, type ToolsChange, type ToolsMode, type ToolsPolicy } from '../app/toolsSettings';
import { AddServerForm, setupPanelSx, StatusLine, ToolPage, ToolSwitch, toolkitIcon, useMcpSettings, type McpServer } from './McpServers';
import { ItemCard, itemCardGridSx } from './ItemCard';
import { mcpFormDone, McpProposalPanel, useMcpProposal } from './McpProposal';
import { TerminalFilesystemSummary } from './TerminalApprovalDialog';
import { BrowserDetails, BrowserStatusLabel } from './BrowserAccess';
import { browserConfig, browserOn, checkBrowser, loadBrowserStatus, saveBrowserSettings, type BrowserChoice, type BrowserStatus } from '../app/browserSettings';

const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

/** The terminal's state in a word or two: off, sandboxed, or running without a sandbox. */
const TerminalStatus = ({ policy }: { policy: ToolsPolicy }) => {
    const { t } = useTranslation();
    return <Typography component="span" variant="caption"
        sx={{ color: policy.enabled && policy.sandboxed === false ? 'warning.main' : 'text.secondary' }}>
        {!policy.enabled ? t('tools.terminal.off', { defaultValue: 'Off' })
            : policy.sandboxed === false ? t('tools.terminal.unsandboxed', { defaultValue: 'No sandbox installed' })
            : t('tools.terminal.sandboxed', { defaultValue: 'Sandboxed' })}
    </Typography>;
};

/** The terminal's pane: what it can do, whether it is sandboxed, and its sandbox write paths. */
const TerminalDetails = ({ policy, busy, onChange }: {
    policy: ToolsPolicy; busy: boolean; onChange: (change: ToolsChange) => Promise<boolean>;
}) => {
    const { t } = useTranslation();
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
    return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('tools.terminal.name', { defaultValue: 'Terminal' })}</Typography>
                <TerminalStatus policy={policy} />
                <Box sx={{ flex: 1 }} />
                <ToolSwitch checked={policy.enabled} disabled={busy} onChange={enabled => void onChange({ enabled })}
                    label={t('tools.terminal.use', { defaultValue: 'Use the terminal' })} />
            </Box>
            <Typography variant="body2">
                {t('tools.terminal.caption', { defaultValue: 'Run commands on this computer with your CLI logins' })}
            </Typography>
        </Box>
        {policy.enabled && policy.sandboxed === false && <Alert severity="warning" sx={{ py: 0, overflowWrap: 'anywhere' }}>
            {t('terminal.noSandboxInstalled', { defaultValue: 'No sandbox is installed on this computer, so commands run with your normal access. Each command asks for your approval, even with Auto approve.' })}
            {policy.sandboxInstallHint && <Box component="span" sx={{ display: 'block', mt: 0.5 }}>{policy.sandboxInstallHint}</Box>}
        </Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: '0.875rem' }}>
                <Typography variant="body2">
                    {t('terminal.accessBenefit', { defaultValue: 'Terminal access lets the agent read local files, use installed tools and existing CLI logins, and access online sources, expanding its ability to find, acquire, and analyze data.' })}
                    {' '}
                    {t('terminal.sandboxOverview', { defaultValue: 'By default, commands run in a sandbox that limits local writes but does not restrict file reads, network access, or remote changes.' })}
                </Typography>
                {filesystem && <TerminalFilesystemSummary policy={filesystem} inline>
                    <FormControlLabel sx={{ my: 0.5, '& .MuiFormControlLabel-label': { fontSize: '0.875rem' } }}
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
    </Box>;
};

/**
 * A tool's card on the Tools home page: its name, what it is and its state; the card opens its page. An added tool
 * has its switch (hovering the switch leaves the card still); a toolkit not added yet is a lighter, dashed card.
 */
const ToolCard = ({ icon, name, about, status, onOpen, toggle, available }: {
    icon: React.ReactNode; name: string; about?: string; status: React.ReactNode; onOpen: () => void; toggle?: React.ReactNode;
    /** Not added yet: offered to add. */
    available?: boolean;
}) => <Box sx={{ display: 'grid', '& article:has(.tool-switch:hover)': { transform: 'none', boxShadow: '0 1px 3px rgba(32, 33, 36, 0.06)',
    borderColor: 'rgba(0, 0, 0, 0.18)' }, ...(available ? { '& article': { borderStyle: 'dashed', boxShadow: 'none', bgcolor: 'transparent' } } : {}) }}>
    <ItemCard onOpen={onOpen} persistentActions={!!toggle} actions={toggle}
        title={<Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0,
            '& svg': { fontSize: 18, color: 'primary.main', flexShrink: 0 } }}>{icon}<span>{name}</span></Box>}
        captions={[
            about && <Box component="span" title={about} sx={{ color: 'text.primary', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{about}</Box>,
            status,
        ]} />
</Box>;

/** A home-page section's heading. */
const HomeHeading = ({ children }: { children: React.ReactNode }) =>
    <Typography component="h3" variant="subtitle2" sx={{ mt: 0.5 }}>{children}</Typography>;

/**
 * The page the dialog shows instead of the home page: the terminal, a toolkit (added or not), a custom server, adding
 * a custom server, or an agent's suggestion to review.
 */
type Page = 'terminal' | 'browser' | 'custom' | 'proposal' | `pack:${string}` | `server:${string}`;

/** The composer's Tools chip: the shared approval mode, the terminal, and the user's MCP servers. */
export const ToolsAccessButton = () => {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const reduxStore = useStore<DataFormulatorState>();
    const config = useSelector((state: DataFormulatorState) => state.serverConfig);
    const [open, setOpen] = useState(false);
    const [page, setPage] = useState<Page>();
    // A toolkit's settings typed before it is added, and a custom server's configuration being written.
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [customConfig, setCustomConfig] = useState('');
    const [policy, setPolicy] = useState<ToolsPolicy>();
    const [saving, setSaving] = useState(false);
    const [policyError, setPolicyError] = useState('');
    const [browser, setBrowser] = useState<BrowserStatus>();
    const mcp = useMcpSettings(open && !!config.MCP_AVAILABLE);
    // An agent's MCP proposal under review (its text turn).
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
    const applyBrowser = (next: BrowserStatus) => {
        // A saved change returns no check; keep the last one while the browser stays the same.
        setBrowser(current => next.steps || !current?.steps || current.browser !== next.browser || current.choice !== next.choice
            || !next.enabled ? next : { ...next, steps: current.steps, ready: current.ready });
        dispatch(dfActions.setServerConfig({ ...reduxStore.getState().serverConfig, ...browserConfig(next) }));
    };
    const runBrowser = async (task: () => Promise<BrowserStatus>) => {
        setSaving(true); setPolicyError('');
        try { const next = await task(); applyBrowser(next); return next; }
        catch (reason) { setPolicyError(errorText(reason)); return undefined; }
        finally { setSaving(false); }
    };
    const changeBrowser = async (next: { enabled?: boolean; browser?: BrowserChoice }) => {
        const saved = await runBrowser(() => saveBrowserSettings(next));
        // Turning it on (or picking another browser) checks it right away, from the user's click.
        if (saved?.enabled && (next.enabled || next.browser)) await runBrowser(checkBrowser);
        return !!saved;
    };
    const go = (next?: Page) => { setPage(next); setDraft({}); mcp.setNotice(''); };
    const show = (turnId?: string) => {
        setOpen(true); go(turnId ? 'proposal' : undefined); setProposalTurnId(turnId);
        void loadPolicy();
        if (config.BROWSER_AVAILABLE) void loadBrowserStatus().then(applyBrowser).catch(() => undefined);
        if (config.MCP_AVAILABLE) { void mcp.load(); void mcp.loadPacks(); }
    };
    useEffect(() => onToolsDialogRequest(turnId => show(turnId)), [config.MCP_AVAILABLE]);
    useEffect(() => { if (page?.startsWith('pack:')) void mcp.loadPackTools(page.slice('pack:'.length)); }, [page]);
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
    const packs = mcp.packs ?? [];
    // Tools that are on: the terminal (when it can run here) and the MCP servers switched on.
    const toolCount = (config.TERMINAL_AVAILABLE && (policy?.enabled ?? config.TERMINAL_ENABLED ?? true) ? 1 : 0)
        + (config.BROWSER_AVAILABLE && (browser ? browserOn(browser) : config.BROWSER_ENABLED) ? 1 : 0)
        + (config.MCP_AVAILABLE ? (mcp.snapshot ? servers.filter(server => server.enabled).length : config.MCP_SERVERS_ON ?? 0) : 0);
    const error = policyError || mcp.error;
    const modes: [ToolsMode, string][] = [['off', 'Off'], ['ask', 'Ask every time'], ['auto', 'Auto when safe']];
    const reviewing = !!proposalTurnId && !!config.MCP_AVAILABLE && !!proposal && !mcpFormDone(proposal.form.mcp);
    const canAdd = !!config.MCP_AVAILABLE && !!mcp.snapshot;
    const packServer = (packId: string) => servers.find(server => server.pack === packId);
    const pageOf = (server: McpServer): Page => server.pack && packs.some(pack => pack.id === server.pack) ? `pack:${server.pack}` : `server:${server.id}`;
    // The page shown, while what it shows is still there (a removed server goes back home).
    const shownPack = page?.startsWith('pack:') ? packs.find(pack => `pack:${pack.id}` === page) : undefined;
    const shownServer = page?.startsWith('server:') ? servers.find(server => `server:${server.id}` === page)
        : shownPack ? packServer(shownPack.id) : undefined;
    const shown = page === 'terminal' ? (policy?.available ? page : undefined)
        : page === 'browser' ? (browser?.available ? page : undefined)
        : page === 'custom' ? (canAdd ? page : undefined)
        : page === 'proposal' ? (reviewing ? page : undefined)
        : shownPack || shownServer ? page : undefined;
    const pageTitle = shown === 'terminal' ? t('tools.terminal.name', { defaultValue: 'Terminal' })
        : shown === 'browser' ? t('browser.name', { defaultValue: 'Browser' })
        : shown === 'custom' ? t('tools.add.custom', { defaultValue: 'Custom MCP server' })
        : shown === 'proposal' ? proposal?.form.title
        : shownServer?.name ?? (shownPack ? t(`mcp.pack.${shownPack.id}.name`, { defaultValue: shownPack.name }) : undefined);
    const addPack = async () => { if (shownPack) await mcp.addPack(shownPack.id, draft); };
    const removeServer = async (server: McpServer) => { if (await mcp.remove(server)) go(undefined); };
    const addCustom = async () => {
        const added = await mcp.importConfig(customConfig);
        if (added.length) { setCustomConfig(''); go(`server:${added[0].id}`); }
    };
    const serverActions = (server?: McpServer) => ({
        onConnect: () => { if (server) void mcp.connect(server); },
        onChange: (body: Record<string, unknown>) => { if (server) void mcp.change(server, body); },
        onRemove: () => { if (server) void removeServer(server); },
        onSignOut: () => { if (server) void mcp.signOut(server); },
    });
    const textButton = { textTransform: 'none' } as const;
    return <>
        <Tooltip describeChild title={t('tools.chipDetails', { defaultValue: 'Tools the agent can use: the terminal, the browser and MCP servers' })}>
            <Button size="small" aria-haspopup="dialog" onClick={() => show()}
                aria-label={t('tools.chipLabel', { defaultValue: 'Tools: {{count}} on, {{mode}}', count: toolCount,
                    mode: t(`tools.mode.${mode}`, { defaultValue: { off: 'Off', ask: 'Ask every time', auto: 'Auto when safe' }[mode] }) })}
                sx={{ minWidth: 0, px: 0.75, py: 0.25, flexShrink: 0, textTransform: 'none', fontWeight: 400 }}>
                <ToolsChipFace count={toolCount} mode={mode} />
            </Button>
        </Tooltip>
        <Dialog open={open} onClose={() => { if (!busy) setOpen(false); }} maxWidth="md" fullWidth aria-labelledby="tools-title">
            <DialogTitle id="tools-title" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                {shown && <Tooltip title={t('tools.back', { defaultValue: 'All tools' })}>
                    <IconButton size="small" onClick={() => go(undefined)} aria-label={t('tools.back', { defaultValue: 'All tools' })}
                        sx={{ ml: -0.75 }}><ArrowBackIcon sx={{ fontSize: 18 }} /></IconButton>
                </Tooltip>}
                {shown
                    ? <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
                        <Box component="span" sx={{ color: 'text.secondary', flexShrink: 0 }}>{t('tools.title', { defaultValue: 'Tools' })}</Box>{' '}
                        <Box component="span" sx={{ color: 'text.disabled' }}>›</Box>{' '}
                        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pageTitle}</Box>
                    </Box>
                    : t('tools.title', { defaultValue: 'Tools' })}
            </DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ height: 2, flexShrink: 0 }}>{busy && <LinearProgress sx={{ height: 2 }} />}</Box>
                {error && <Alert severity="error" onClose={() => { setPolicyError(''); mcp.setError(''); }}
                    sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{error}</Alert>}
                {mcp.notice && <Alert severity="info" onClose={() => mcp.setNotice('')} sx={{ whiteSpace: 'pre-wrap' }}>{mcp.notice}</Alert>}
                {shown === 'terminal' && policy && <TerminalDetails policy={policy} busy={busy} onChange={change} />}
                {shown === 'browser' && browser && <BrowserDetails status={browser} busy={busy} onChange={changeBrowser}
                    onCheck={async () => { await runBrowser(checkBrowser); }} />}
                {shown === 'proposal' && <McpProposalPanel turnId={proposalTurnId!} settings={mcp} onDismiss={() => { setProposalTurnId(undefined); go(undefined); }} />}
                {(shownPack || (shown?.startsWith('server:') && shownServer)) && <ToolPage key={shownPack ? `pack:${shownPack.id}` : shown}
                    server={shownServer} pack={shownPack} previewTools={shownPack ? mcp.packTools[shownPack.id] : undefined}
                    draft={draft} onDraft={setDraft} busy={busy} onAdd={() => void addPack()} {...serverActions(shownServer)}
                    onPackSignedIn={signin => { if (shownPack) mcp.packSignedIn(shownPack.id, signin); }}
                    onSavePack={changes => shownPack ? mcp.savePackSettings(shownPack.id, changes) : Promise.resolve(false)}
                    beforePackSignIn={async () => !!shownPack && !!await mcp.addPack(shownPack.id, draft)} />}
                {shown === 'custom' && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
                        <Box sx={{ display: 'flex', color: 'primary.main', pt: 0.5, '& svg': { fontSize: 22 } }}>{toolkitIcon()}</Box>
                        <Box>
                            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('tools.add.custom', { defaultValue: 'Custom MCP server' })}</Typography>
                            <Typography variant="body2">{t('tools.add.customAbout', { defaultValue: 'Any MCP server: a remote one by its URL, or a local command. It uses the same configuration format as VS Code, Claude and Cursor.' })}</Typography>
                        </Box>
                    </Box>
                    <Box component="section" aria-label={t('mcp.section.setup', { defaultValue: 'Setup' })} sx={setupPanelSx}>
                        <Typography variant="subtitle2">{t('mcp.section.setup', { defaultValue: 'Setup' })}</Typography>
                        <AddServerForm busy={busy} text={customConfig} onTextChange={setCustomConfig} onSubmit={async () => { await addCustom(); return true; }} />
                    </Box>
                </Box>}
                {!shown && <>
                    <Typography variant="body2">
                        {t('tools.intro', { defaultValue: 'Tools let the agent reach beyond your workspace: run commands on this computer, browse the web, or call MCP servers for data and documents.' })}
                    </Typography>
                    {!available && <Alert severity="info">{config.IS_LOCAL_MODE && config.DISABLE_DATA_CONNECTORS
                        ? t('tools.blocked', { defaultValue: 'The deployment policy turns off user connections and tools.' })
                        : t('tools.localOnly', { defaultValue: 'Tools are available in the single-user local app.' })}</Alert>}
                    {available && <>
                        <Box>
                            <RadioGroup row value={mode} aria-label={t('tools.modeLabel', { defaultValue: 'Approval' })}
                                onChange={(_, value) => void change({ mode: value as ToolsMode })}>
                                {modes.map(([value, label]) => <FormControlLabel key={value} value={value} control={<Radio size="small" />}
                                    disabled={busy || !policy || policy.locked} label={t(`tools.mode.${value}`, { defaultValue: label })}
                                    sx={{ '& .MuiFormControlLabel-label': { fontSize: '0.875rem' } }} />)}
                            </RadioGroup>
                            <Typography variant="body2" sx={{ mt: 0.25 }}>
                                {policy?.locked ? t('tools.locked', { defaultValue: 'Set by the server environment variable DF_TERMINAL_MODE.' })
                                    : mode === 'auto' ? t('tools.modeHint.auto', { defaultValue: 'Sandboxed commands and read-only MCP tools run without asking; everything else asks first.' })
                                    : mode === 'ask' ? t('tools.modeHint.ask', { defaultValue: 'Every command and tool call asks first, except tools you always allow.' })
                                    : t('tools.modeHint.off', { defaultValue: 'The agent uses no tools.' })}
                            </Typography>
                        </Box>
                        {reviewing && <Box sx={{ display: 'grid' }}>
                            <ToolCard icon={<LightbulbOutlinedIcon />} name={proposal!.form.title} onOpen={() => go('proposal')}
                                status={<Typography component="span" variant="caption" sx={{ color: 'primary.main' }}>
                                    {t('mcp.form.suggested', { defaultValue: 'Suggested by the agent' })}</Typography>} />
                        </Box>}
                        <HomeHeading>{t('tools.home.yours', { defaultValue: 'Your tools' })}</HomeHeading>
                        <Box sx={{ ...itemCardGridSx, opacity: mode === 'off' ? 0.6 : 1 }}>
                            {policy?.available && <ToolCard icon={<TerminalIcon />} name={t('tools.terminal.name', { defaultValue: 'Terminal' })}
                                about={t('tools.terminal.caption', { defaultValue: 'Run commands on this computer with your CLI logins' })}
                                status={<TerminalStatus policy={policy} />} onOpen={() => go('terminal')}
                                toggle={<ToolSwitch checked={policy.enabled} disabled={busy} onChange={enabled => void change({ enabled })}
                                    label={t('tools.terminal.use', { defaultValue: 'Use the terminal' })} />} />}
                            {browser?.available && <ToolCard icon={<LanguageIcon />} name={t('browser.name', { defaultValue: 'Browser' })}
                                about={t('browser.caption', { defaultValue: 'Read web pages in a real browser, including sites you are signed in to' })}
                                status={<BrowserStatusLabel status={browser} />} onOpen={() => go('browser')}
                                // On only once its check passes; turning it on again from here re-runs the check.
                                toggle={<ToolSwitch checked={browserOn(browser)} disabled={busy}
                                    onChange={enabled => { if (enabled) go('browser'); void changeBrowser({ enabled }); }}
                                    label={t('browser.use', { defaultValue: 'Use the browser' })} />} />}
                            {servers.map(server => {
                                const pack = server.pack ? packs.find(item => item.id === server.pack) : undefined;
                                return <ToolCard key={server.id} icon={toolkitIcon(server.pack)} name={server.name}
                                    about={pack ? t(`mcp.pack.${pack.id}.description`, { defaultValue: pack.description })
                                        : server.transport === 'stdio' ? [server.command, ...(server.args || [])].join(' ') : server.url}
                                    status={<StatusLine server={server} />} onOpen={() => go(pageOf(server))}
                                    toggle={<ToolSwitch checked={server.enabled} disabled={busy} onChange={enabled => void mcp.change(server, { enabled })}
                                        label={t('mcp.serverEnabled', { defaultValue: 'Use {{name}}', name: server.name })} />} />;
                            })}
                        </Box>
                        {canAdd && <>
                            <HomeHeading>{t('tools.home.more', { defaultValue: 'Add more' })}</HomeHeading>
                            <Box sx={itemCardGridSx}>
                                {packs.filter(pack => !pack.server_id).map(pack => <ToolCard key={pack.id} available icon={toolkitIcon(pack.id)}
                                    name={t(`mcp.pack.${pack.id}.name`, { defaultValue: pack.name })}
                                    about={t(`mcp.pack.${pack.id}.description`, { defaultValue: pack.description })}
                                    status={<Typography component="span" variant="caption" sx={{ color: 'primary.main' }}>
                                        {t('tools.home.setUp', { defaultValue: '+ Set up and add' })}</Typography>}
                                    onOpen={() => go(`pack:${pack.id}`)} />)}
                                <ToolCard available icon={toolkitIcon()} name={t('tools.add.custom', { defaultValue: 'Custom MCP server' })}
                                    about={t('tools.home.customAbout', { defaultValue: 'Any MCP server, from its configuration JSON.' })}
                                    status={<Typography component="span" variant="caption" sx={{ color: 'primary.main' }}>
                                        {t('tools.home.paste', { defaultValue: '+ Paste its configuration' })}</Typography>}
                                    onOpen={() => go('custom')} />
                            </Box>
                        </>}
                    </>}
                </>}
            </DialogContent>
            <DialogActions>
                {!shown && <Button onClick={() => setOpen(false)} disabled={busy}>{t('tools.close', { defaultValue: 'Close' })}</Button>}
                {((shownPack && !shownServer) || shown === 'custom') && <Button onClick={() => go(undefined)} disabled={busy} sx={textButton}>
                    {t('mcp.add.cancel', { defaultValue: 'Cancel' })}</Button>}
                {shown && shown !== 'custom' && !(shownPack && !shownServer) && <Button onClick={() => go(undefined)} disabled={busy} sx={textButton}>
                    {t('tools.done', { defaultValue: 'Done' })}</Button>}
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
